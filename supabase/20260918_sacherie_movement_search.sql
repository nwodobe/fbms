-- =====================================================================
-- Sacherie AFLP — recherche et pagination SERVEUR du journal des
-- mouvements. Le registre canonique reste `rcn_jute_movements` : aucun
-- second moteur de stock n'est cree.
--
-- CONSTAT D'AUDIT (18/09/2026)
--   `operations/sacherie-operational-p1.js::renderHistory()` charge
--   `.eq('ledger','INTERNE').order('movement_at', desc).limit(300)`
--   sans recherche ni pagination. Une reference de debut de campagne
--   devient introuvable des le 301e mouvement.
--
-- CHOIX D'ARCHITECTURE
--   * pagination par CURSEUR sur (movement_at DESC, id DESC), pas par
--     OFFSET : un mouvement insere pendant la navigation ne provoque ni
--     doublon ni ligne sautee, et le cout reste constant quelle que soit
--     la profondeur.
--   * filtrage et recherche entierement en PostgreSQL. Le navigateur ne
--     recoit jamais plus de `p_limit` lignes.
--   * SECURITY DEFINER avec controle interne du perimetre : la fonction
--     reutilise `private.sacherie_ct_perimetre()` introduit par la
--     migration d'inventaire, donc la meme regle que partout ailleurs.
--
-- INDEXES : deux, chacun justifie. Aucun index d'opportunite.
--
-- ROLLBACK : voir le bloc en fin de fichier.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Extension de recherche texte
-- ---------------------------------------------------------------------
-- `unaccent` est deja installe mais n'est pas IMMUTABLE : inutilisable
-- dans un index. `pg_trgm` permet un index GIN sur des LIKE '%...%',
-- que btree ne sait pas accelerer.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- 2. Index 1 — pagination par curseur (indispensable)
-- ---------------------------------------------------------------------
-- Sert exactement le tri du journal. Partiel sur le grand livre interne :
-- le journal Sacherie n'expose jamais le grand livre fournisseur.
create index if not exists idx_rcn_jute_mv_journal
  on public.rcn_jute_movements (movement_at desc, id desc)
  where ledger = 'INTERNE';

-- ---------------------------------------------------------------------
-- 3. Index 2 — recherche texte multi-colonnes (un seul index, pas neuf)
-- ---------------------------------------------------------------------
-- Une expression unique concatenant les colonnes recherchables evite de
-- creer un index par colonne. `lower()` est IMMUTABLE, `unaccent()` ne
-- l'est pas : la recherche se fait donc en minuscules, sans depliage
-- d'accents. Les identifiants recherches (BAG-…, RT-…, codes
-- d'emplacement) n'en portent pas.
create index if not exists idx_rcn_jute_mv_recherche
  on public.rcn_jute_movements
  using gin ((
    lower(
      coalesce(event_key,'')      || ' ' ||
      coalesce(reference,'')      || ' ' ||
      coalesce(movement_type,'')  || ' ' ||
      coalesce(from_location,'')  || ' ' ||
      coalesce(to_location,'')    || ' ' ||
      coalesce(cluster,'')        || ' ' ||
      coalesce(rt_id,'')          || ' ' ||
      coalesce(producteur_id,'')  || ' ' ||
      coalesce(source_type,'')
    )
  ) gin_trgm_ops)
  where ledger = 'INTERNE';

-- ---------------------------------------------------------------------
-- 4. RPC de recherche paginee
-- ---------------------------------------------------------------------
create or replace function public.sacherie_search_movements(
  p_query         text        default null,
  p_from_date     date        default null,
  p_to_date       date        default null,
  p_movement_type text        default null,
  p_from_location text        default null,
  p_to_location   text        default null,
  p_cluster       text        default null,
  p_rt_id         text        default null,
  p_state         text        default null,
  p_limit         integer     default 50,
  p_cursor_date   timestamptz default null,
  p_cursor_id     text        default null
)
returns table (
  id            text,
  event_key     text,
  movement_at   timestamptz,
  movement_type text,
  source_type   text,
  reference     text,
  qty           integer,
  from_location text,
  to_location   text,
  from_state    text,
  to_state      text,
  cluster       text,
  rt_id         text,
  producteur_id text,
  note          text,
  proof_url     text,
  created_by    uuid
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_per     jsonb   := private.sacherie_ct_perimetre();
  v_bm      boolean := coalesce((v_per->>'bm')::boolean, false);
  v_cluster text    := nullif(v_per->>'cluster','');
  v_limit   integer := least(greatest(coalesce(p_limit,50), 1), 100);
  v_q       text    := lower(nullif(btrim(coalesce(p_query,'')),''));
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise'; end if;
  if not coalesce((v_per->>'autorise')::boolean, false) then
    -- Perimetre nul : ensemble vide. Un filtre frontal n'est jamais un
    -- controle de securite ; celui-ci est serveur.
    return;
  end if;

  return query
  select m.id, m.event_key, m.movement_at, m.movement_type, m.source_type,
         m.reference, m.qty, m.from_location, m.to_location, m.from_state,
         m.to_state, m.cluster, m.rt_id, m.producteur_id, m.note,
         m.proof_url, m.created_by
  from public.rcn_jute_movements m
  left join public.rcn_jute_locations lf on lf.code = m.from_location
  left join public.rcn_jute_locations lt on lt.code = m.to_location
  where m.ledger = 'INTERNE'
    -- Perimetre serveur
    and (
      v_bm
      or v_cluster is null
      or upper(coalesce(m.cluster,'')) = upper(v_cluster)
      or upper(coalesce(lf.cluster,'')) = upper(v_cluster)
      or upper(coalesce(lt.cluster,'')) = upper(v_cluster)
    )
    -- Filtres
    and (p_from_date     is null or m.movement_at >= p_from_date::timestamptz)
    and (p_to_date       is null or m.movement_at <  (p_to_date + 1)::timestamptz)
    and (p_movement_type is null or m.movement_type = p_movement_type)
    and (p_from_location is null or m.from_location = p_from_location)
    and (p_to_location   is null or m.to_location   = p_to_location)
    and (p_cluster       is null or upper(coalesce(m.cluster,'')) = upper(p_cluster))
    and (p_rt_id         is null or m.rt_id = p_rt_id)
    and (p_state         is null or m.from_state = p_state or m.to_state = p_state)
    -- Recherche texte : meme expression que l'index, donc indexable
    and (
      v_q is null
      or lower(
           coalesce(m.event_key,'')     || ' ' ||
           coalesce(m.reference,'')     || ' ' ||
           coalesce(m.movement_type,'') || ' ' ||
           coalesce(m.from_location,'') || ' ' ||
           coalesce(m.to_location,'')   || ' ' ||
           coalesce(m.cluster,'')       || ' ' ||
           coalesce(m.rt_id,'')         || ' ' ||
           coalesce(m.producteur_id,'') || ' ' ||
           coalesce(m.source_type,'')
         ) like '%' || v_q || '%'
    )
    -- Curseur strict : (movement_at, id) < (curseur) en ordre decroissant
    and (
      p_cursor_date is null
      or (m.movement_at, m.id) < (p_cursor_date, coalesce(p_cursor_id, ''))
    )
  order by m.movement_at desc, m.id desc
  limit v_limit;
end
$fn$;

comment on function public.sacherie_search_movements(text,date,date,text,text,text,text,text,text,integer,timestamptz,text) is
  'Sacherie AFLP : recherche et pagination serveur du journal canonique rcn_jute_movements (grand livre INTERNE). Pagination par curseur (movement_at DESC, id DESC) : passer le couple de la derniere ligne recue dans p_cursor_date / p_cursor_id. Perimetre applique cote serveur via private.sacherie_ct_perimetre(). p_limit borne a 100.';

revoke all on function public.sacherie_search_movements(text,date,date,text,text,text,text,text,text,integer,timestamptz,text) from public;
grant execute on function public.sacherie_search_movements(text,date,date,text,text,text,text,text,text,integer,timestamptz,text) to authenticated;

commit;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- begin;
--   drop function if exists public.sacherie_search_movements(text,date,date,text,text,text,text,text,text,integer,timestamptz,text);
--   drop index if exists public.idx_rcn_jute_mv_recherche;
--   drop index if exists public.idx_rcn_jute_mv_journal;
--   -- pg_trgm est laissee en place : d'autres objets peuvent en dependre.
-- commit;
-- Effet du rollback : le journal revient aux 300 dernieres lignes
-- chargees dans le navigateur. Aucune donnee n'est touchee.

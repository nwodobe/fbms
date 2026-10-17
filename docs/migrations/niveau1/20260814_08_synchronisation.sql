-- ============================================================================
-- NIVEAU 1 — Migration 08 : LOT G — hors ligne maîtrisé
-- Date : 2026-08-14 · Dépend de : 20260814_01 à 07
--
-- CE QUE CETTE MIGRATION FERME
--   P1-4  aucun accusé de réception serveur : la file locale peut être purgée
--         sans preuve d'écriture
--
-- RÈGLE CRITIQUE DU PROGRAMME, POSÉE ICI
--   La SAISIE d'un achat peut se faire hors ligne.
--   L'AUTORISATION d'une exposition financière — nouvelle avance, ouverture ou
--   déblocage de cycle, approbation d'exception — ne peut JAMAIS reposer sur un
--   cache local. Ces opérations exigent une décision serveur au moment où elles
--   sont prises. Si le serveur ne peut pas confirmer l'exposition, l'opération
--   est mise en attente ou refusée — jamais accordée « en attendant ».
--
--   Cette règle n'est pas déclarative : les RPC n1_ouvrir_cycle,
--   n1_debloquer_cycle et n1_approuver_ajustement ne sont appelables qu'en
--   ligne, par construction. n1_sync_pousser les REFUSE explicitement.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) File serveur : trace de chaque opération reçue, acceptée ou refusée
-- ---------------------------------------------------------------------------

create table if not exists public.n1_sync_operations (
  id               uuid primary key default gen_random_uuid(),
  cle_idempotence  text not null,
  terminal_id      text not null,
  utilisateur      uuid not null default public.n1_uid(),
  ressource        text not null,
  operation        text not null default 'INSERT',
  charge           jsonb not null,
  cree_le_terminal timestamptz,
  recu_le          timestamptz not null default now(),
  traite_le        timestamptz,
  resultat         text not null default 'EN_ATTENTE',
  enregistrement   uuid,
  message          text,
  tentatives       integer not null default 1,
  constraint n1_sync_resultat_chk check (resultat in
    ('EN_ATTENTE','ACCEPTE','REJETE','DOUBLON','CONFLIT')),
  constraint n1_sync_op_chk check (operation in ('INSERT','UPDATE'))
);

-- L'accusé est indexé sur la clé d'idempotence : rejouer n'écrit jamais deux fois.
create unique index if not exists n1_sync_cle_uidx on public.n1_sync_operations (cle_idempotence);
create index if not exists n1_sync_term_idx on public.n1_sync_operations (terminal_id, recu_le desc);
create index if not exists n1_sync_res_idx  on public.n1_sync_operations (resultat, recu_le desc);

create table if not exists public.n1_sync_conflits (
  id             uuid primary key default gen_random_uuid(),
  operation_id   uuid not null references public.n1_sync_operations(id),
  cle_idempotence text not null,
  terminal_id    text,
  ressource      text not null,
  valeur_serveur jsonb,
  valeur_terminal jsonb,
  type_conflit   text not null,
  statut         text not null default 'OUVERT',
  arbitre_par    uuid,
  arbitre_le     timestamptz,
  decision       text,
  detecte_le     timestamptz not null default now(),
  constraint n1_conflit_statut_chk check (statut in ('OUVERT','ARBITRE','ABANDONNE')),
  constraint n1_conflit_type_chk check (type_conflit in
    ('DOUBLE_TERMINAL','VALEUR_DIVERGENTE','ORDRE_INVERSE','ENREGISTREMENT_VERROUILLE'))
);
create index if not exists n1_conflit_statut_idx on public.n1_sync_conflits (statut, detecte_le desc);

-- ---------------------------------------------------------------------------
-- 2) Opérations interdites hors ligne
-- ---------------------------------------------------------------------------

create or replace function public.n1_sync_ressource_autorisee(p_ressource text)
returns boolean language sql immutable as $$
  select lower(p_ressource) in ('achats','sacs_mouvements','n1_stock_mouvements','reconciliations')
$$;

comment on function public.n1_sync_ressource_autorisee(text) is
  'Ressources dont la SAISIE peut naître hors ligne. Les avances, cycles, '
  'exceptions et ajustements en sont volontairement exclus : ils engagent une '
  'exposition financière que seul le serveur peut arbitrer au moment de la décision.';

-- ---------------------------------------------------------------------------
-- 3) Poussée idempotente avec accusé de réception
-- ---------------------------------------------------------------------------
-- Le terminal ne supprime sa ligne locale QUE sur un accusé portant
-- resultat ACCEPTE ou DOUBLON. Un REJETE part dans sa file des rejets ;
-- l'absence de réponse laisse la ligne en attente et sera rejouée.

create or replace function public.n1_sync_pousser(
  p_cle_idempotence text,
  p_terminal_id text,
  p_ressource text,
  p_charge jsonb,
  p_cree_le timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_op   public.n1_sync_operations%rowtype;
  v_id   uuid;
  v_cols text;
  v_vals text;
  v_msg  text;
begin
  if public.n1_uid() is null then
    raise exception 'Synchronisation refusée hors session authentifiée'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_cle_idempotence,'')),'') is null then
    raise exception 'Clé d''idempotence obligatoire : une opération sans clé ne peut pas être rejouée sans doublon';
  end if;
  if nullif(btrim(coalesce(p_terminal_id,'')),'') is null then
    raise exception 'Identifiant de terminal obligatoire';
  end if;

  -- 3.1 Rejeu : on renvoie l'accusé d'origine, sans réécrire quoi que ce soit.
  select * into v_op from public.n1_sync_operations
  where cle_idempotence = p_cle_idempotence for update;
  if found then
    update public.n1_sync_operations set tentatives = tentatives + 1 where id = v_op.id;

    -- Deux terminaux qui poussent la même clé : c'est un conflit à arbitrer,
    -- mais surtout PAS une seconde écriture.
    if v_op.terminal_id is distinct from p_terminal_id then
      insert into public.n1_sync_conflits(
        operation_id, cle_idempotence, terminal_id, ressource,
        valeur_serveur, valeur_terminal, type_conflit)
      values (v_op.id, p_cle_idempotence, p_terminal_id, p_ressource,
              public.n1_masquer(v_op.charge), public.n1_masquer(p_charge), 'DOUBLE_TERMINAL')
      on conflict do nothing;
      perform public.n1_auditer('CONFLIT_SYNCHRONISATION', p_ressource, v_op.enregistrement::text,
        v_op.charge, p_charge, 'Même clé poussée par deux terminaux', 'REFUSE',
        null, p_terminal_id, p_cle_idempotence);
    end if;

    return jsonb_build_object(
      'resultat', case when v_op.resultat = 'ACCEPTE' then 'DOUBLON' else v_op.resultat end,
      'accuse', true, 'enregistrement', v_op.enregistrement,
      'recu_le', v_op.recu_le, 'message', coalesce(v_op.message, 'Opération déjà reçue'),
      'purge_locale_autorisee', v_op.resultat in ('ACCEPTE','DOUBLON','REJETE'));
  end if;

  -- 3.2 Ressource autorisée hors ligne ?
  if not public.n1_sync_ressource_autorisee(p_ressource) then
    insert into public.n1_sync_operations(
      cle_idempotence, terminal_id, ressource, charge, cree_le_terminal,
      resultat, traite_le, message)
    values (p_cle_idempotence, p_terminal_id, p_ressource, public.n1_masquer(p_charge), p_cree_le,
      'REJETE', now(),
      'Opération à exposition financière : elle exige une décision serveur au moment où elle est prise, '
      || 'et ne peut pas naître d''un cache local.')
    returning * into v_op;
    perform public.n1_auditer('SYNCHRONISATION', p_ressource, null, null, p_charge,
      v_op.message, 'REFUSE', null, p_terminal_id, p_cle_idempotence);
    return jsonb_build_object('resultat','REJETE','accuse',true,'message',v_op.message,
                              'purge_locale_autorisee', true);
  end if;

  -- 3.3 Écriture réelle, dans la même transaction que l'accusé.
  insert into public.n1_sync_operations(
    cle_idempotence, terminal_id, ressource, charge, cree_le_terminal, resultat)
  values (p_cle_idempotence, p_terminal_id, p_ressource, public.n1_masquer(p_charge), p_cree_le, 'EN_ATTENTE')
  returning * into v_op;

  begin
    -- La charge JSON est non typée : `$1->>'date'` produit du texte, que
    -- PostgreSQL refuse d'insérer dans une colonne `date`. On lit donc le type
    -- réel de chaque colonne dans le catalogue et on transtype explicitement.
    -- Les colonnes calculées ou attribuées par le serveur sont exclues : le
    -- terminal ne décide ni de l'identifiant, ni du code métier, ni de la date
    -- de réception serveur.
    select string_agg(quote_ident(c.column_name), ','),
           string_agg(format('($1->>%L)::%s', c.column_name, c.udt_name), ',')
      into v_cols, v_vals
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_ressource
      and c.is_generated = 'NEVER'
      and c.column_name in (select jsonb_object_keys(p_charge))
      and c.column_name not in ('id','serveur_recu_le','campagne','achat_code','avance_code',
                                'sac_code','recon_code','mouvement_code','cle_idempotence',
                                'terminal_id','created_by');

    if v_cols is null then
      raise exception 'Charge vide ou sans colonne exploitable pour la ressource %', p_ressource;
    end if;

    execute format(
      'insert into public.%I (%s, cle_idempotence, terminal_id, created_by)
       select %s, %L, %L, %L returning id',
      p_ressource, v_cols, v_vals, p_cle_idempotence, p_terminal_id, public.n1_uid())
    into v_id using p_charge;

    update public.n1_sync_operations
       set resultat = 'ACCEPTE', traite_le = now(), enregistrement = v_id,
           message = 'Écriture confirmée par le serveur'
     where id = v_op.id;

    perform public.n1_auditer('SYNCHRONISATION', p_ressource, v_id::text, null, p_charge,
      null, 'ACCEPTE', null, p_terminal_id, p_cle_idempotence);

    return jsonb_build_object('resultat','ACCEPTE','accuse',true,'enregistrement',v_id,
                              'recu_le', now(), 'purge_locale_autorisee', true);
  exception
    when others then
      -- Le refus doit être CONSERVÉ, pas perdu avec la transaction : on annule
      -- jusqu'au point de reprise, puis on écrit l'accusé de rejet.
      v_msg := sqlerrm;
      raise warning 'N1_SYNC_REJET cle=% terminal=% ressource=% motif=%',
        p_cle_idempotence, p_terminal_id, p_ressource, v_msg;
      raise exception using errcode = sqlstate, message = v_msg;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Accusé de rejet, écrit hors de la transaction annulée
-- ---------------------------------------------------------------------------
-- Le client qui reçoit une erreur métier rappelle cette RPC : la file des
-- rejets est ainsi alimentée durablement et l'utilisateur voit pourquoi son
-- opération n'est pas passée, au lieu de la voir disparaître.

create or replace function public.n1_sync_enregistrer_rejet(
  p_cle_idempotence text, p_terminal_id text, p_ressource text,
  p_charge jsonb, p_motif text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_op public.n1_sync_operations%rowtype;
begin
  if public.n1_uid() is null then
    raise exception 'Enregistrement de rejet refusé hors session authentifiée';
  end if;

  insert into public.n1_sync_operations(
    cle_idempotence, terminal_id, ressource, charge, resultat, traite_le, message)
  values (p_cle_idempotence, p_terminal_id, p_ressource, public.n1_masquer(p_charge),
          'REJETE', now(), left(coalesce(p_motif,''), 2000))
  on conflict (cle_idempotence) do update
    set tentatives = public.n1_sync_operations.tentatives + 1,
        message = excluded.message
  returning * into v_op;

  perform public.n1_auditer('SYNCHRONISATION', p_ressource, null, null, p_charge,
    p_motif, 'REFUSE', null, p_terminal_id, p_cle_idempotence);

  return jsonb_build_object('resultat','REJETE','accuse',true,
                            'message', v_op.message, 'purge_locale_autorisee', false);
end $$;

-- ---------------------------------------------------------------------------
-- 5) État de synchronisation d'un terminal
-- ---------------------------------------------------------------------------
-- Permet à l'écran d'afficher honnêtement ce qui n'est PAS synchronisé, et de
-- retrouver l'état après perte ou changement de téléphone : la file serveur
-- porte la vérité, pas le téléphone.

create or replace function public.n1_sync_etat(p_terminal_id text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'terminal', p_terminal_id,
    'acceptees', count(*) filter (where resultat = 'ACCEPTE'),
    'rejetees',  count(*) filter (where resultat = 'REJETE'),
    'en_attente',count(*) filter (where resultat = 'EN_ATTENTE'),
    'conflits',  (select count(*) from public.n1_sync_conflits where statut = 'OUVERT'),
    'derniere_reception', max(recu_le),
    'rejets', coalesce((select jsonb_agg(jsonb_build_object(
                  'cle', o.cle_idempotence, 'ressource', o.ressource, 'motif', o.message))
                from public.n1_sync_operations o
                where o.resultat = 'REJETE' and o.utilisateur = public.n1_uid()
                  and (p_terminal_id is null or o.terminal_id = p_terminal_id)), '[]'::jsonb))
  from public.n1_sync_operations
  where utilisateur = public.n1_uid()
    and (p_terminal_id is null or terminal_id = p_terminal_id)
$$;

create or replace function public.n1_sync_arbitrer_conflit(
  p_conflit uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.n1_sync_conflits%rowtype;
begin
  if not public.n1_peut_controler() then
    raise exception 'Rôle insuffisant pour arbitrer un conflit de synchronisation'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_decision,'')),'') is null then
    raise exception 'Décision motivée obligatoire';
  end if;
  update public.n1_sync_conflits
     set statut = 'ARBITRE', arbitre_par = public.n1_uid(), arbitre_le = now(), decision = p_decision
   where id = p_conflit and statut = 'OUVERT' returning * into v_c;
  if not found then raise exception 'Conflit introuvable ou déjà arbitré'; end if;
  perform public.n1_auditer('CONFLIT_SYNCHRONISATION', v_c.ressource, v_c.operation_id::text,
    v_c.valeur_serveur, v_c.valeur_terminal, p_decision, 'ACCEPTE');
  return to_jsonb(v_c);
end $$;

alter table public.n1_sync_operations enable row level security;
alter table public.n1_sync_conflits   enable row level security;
drop policy if exists n1_sync_sel on public.n1_sync_operations;
drop policy if exists n1_conflit_sel on public.n1_sync_conflits;
create policy n1_sync_sel on public.n1_sync_operations for select to authenticated
  using (utilisateur = public.n1_uid() or public.n1_peut_controler());
create policy n1_conflit_sel on public.n1_sync_conflits for select to authenticated
  using (public.n1_peut_controler());
revoke insert, update, delete on public.n1_sync_operations from authenticated, anon;
revoke insert, update, delete on public.n1_sync_conflits from authenticated, anon;

revoke all on function public.n1_sync_pousser(text,text,text,jsonb,timestamptz) from public;
grant execute on function public.n1_sync_pousser(text,text,text,jsonb,timestamptz) to authenticated;
grant execute on function public.n1_sync_enregistrer_rejet(text,text,text,jsonb,text) to authenticated;
grant execute on function public.n1_sync_etat(text) to authenticated;
grant execute on function public.n1_sync_arbitrer_conflit(uuid,text) to authenticated;

commit;

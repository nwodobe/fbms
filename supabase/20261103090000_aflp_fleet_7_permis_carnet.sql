-- =====================================================================
-- AFLP FLEET · Migration 7 : permis des conducteurs, documents numérisés,
-- carnet de suivi par moto.
-- Rejouable. Additive : aucune table supprimée, aucune donnée réelle modifiée.
--
-- 1. Permis de conduire rattaché à la PERSONNE (et non à une moto) :
--    numéro, catégories, dates, autorité, scan recto/verso, vérification sur
--    original (nom du vérificateur RH) par l'ABM ou le BM, jamais par le
--    déposant ni par le titulaire.
-- 2. La remise et le transfert exigent désormais un permis CONFORME et en cours
--    de validité (contrôle serveur, par déclencheur) : la case « permis vérifié »
--    déclarative de la phase 1 ne suffit plus.
-- 3. Carnet de suivi : chronologie de TOUT ce qui est arrivé à une moto, avec
--    les montants visibles selon les droits financiers de la phase 2.
-- Données personnelles : permis lisible par le BM, l'ABM, le coordinateur
-- logistique et le titulaire lui-même ; jamais par anon.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Table des permis
-- ---------------------------------------------------------------------
create table if not exists public.moto_permis (
  id uuid primary key default gen_random_uuid(),
  titulaire_id uuid not null references public.profils(user_id),
  nom_titulaire text not null check (length(btrim(nom_titulaire)) >= 3),
  numero_permis text not null check (numero_permis ~ '^[A-Z0-9][A-Z0-9 /.-]{2,28}[A-Z0-9]$'),
  categories text[] not null check (cardinality(categories) between 1 and 12),
  date_delivrance date,
  date_expiration date,
  sans_expiration boolean not null default false,
  autorite_delivrance text,
  document_path text not null unique,
  nom_fichier text,
  pages integer check (pages is null or pages between 1 and 10),
  statut text not null default 'EN_VERIFICATION',
  verification_rh_nom text,
  categorie_adaptee boolean,
  motif_verification text,
  depose_par uuid not null default auth.uid(),
  depose_at timestamptz not null default now(),
  verifie_par uuid,
  verifie_at timestamptz,
  remplace_par uuid references public.moto_permis(id),
  retire_par uuid,
  retire_at timestamptz,
  motif_retrait text,
  check (date_expiration is null or date_delivrance is null or date_expiration >= date_delivrance),
  check (sans_expiration <> (date_expiration is not null)),
  check (verifie_par is null or (verifie_par <> depose_par and verifie_par <> titulaire_id)),
  check (statut <> 'CONFORME' or (verifie_par is not null and verifie_at is not null
                                   and length(btrim(coalesce(verification_rh_nom, ''))) >= 3 and categorie_adaptee is true)),
  check (statut <> 'NON_CONFORME' or (verifie_par is not null and length(btrim(coalesce(motif_verification, ''))) >= 5))
);
-- Statuts, clé de comparaison du numéro, révocation : contraintes posées hors du CREATE pour rester rejouables.
alter table public.moto_permis add column if not exists retire_par uuid;
alter table public.moto_permis add column if not exists retire_at timestamptz;
alter table public.moto_permis add column if not exists motif_retrait text;
alter table public.moto_permis add column if not exists leve_par uuid;
alter table public.moto_permis add column if not exists leve_at timestamptz;
alter table public.moto_permis add column if not exists motif_levee text;
alter table public.moto_permis add column if not exists annule_par uuid;
alter table public.moto_permis add column if not exists annule_at timestamptz;
alter table public.moto_permis add column if not exists motif_annulation text;
alter table public.moto_permis add column if not exists numero_cle text
  generated always as (regexp_replace(upper(numero_permis), '[^A-Z0-9]', '', 'g')) stored;
alter table public.moto_permis drop constraint if exists moto_permis_statut_check;
alter table public.moto_permis add constraint moto_permis_statut_check
  check (statut in ('EN_VERIFICATION','CONFORME','NON_CONFORME','REMPLACE','RETIRE','RETRAIT_LEVE','ANNULE'));
alter table public.moto_permis drop constraint if exists moto_permis_annulation_check;
alter table public.moto_permis add constraint moto_permis_annulation_check
  check (statut <> 'ANNULE' or (annule_par is not null and annule_at is not null and length(btrim(coalesce(motif_annulation, ''))) >= 15));
alter table public.moto_permis drop constraint if exists moto_permis_levee_check;
alter table public.moto_permis add constraint moto_permis_levee_check
  check (statut <> 'RETRAIT_LEVE' or (leve_par is not null and leve_at is not null and length(btrim(coalesce(motif_levee, ''))) >= 10));
create index if not exists moto_permis_numero_retire_idx on public.moto_permis (numero_cle) where statut = 'RETIRE';
alter table public.moto_permis drop constraint if exists moto_permis_retrait_check;
alter table public.moto_permis add constraint moto_permis_retrait_check
  check (statut <> 'RETIRE' or (retire_par is not null and retire_at is not null and length(btrim(coalesce(motif_retrait, ''))) >= 10));
create index if not exists moto_permis_numero_cle_idx on public.moto_permis (numero_cle) where statut in ('EN_VERIFICATION','CONFORME');
create unique index if not exists moto_permis_un_en_attente on public.moto_permis (titulaire_id) where statut = 'EN_VERIFICATION';
create unique index if not exists moto_permis_un_conforme on public.moto_permis (titulaire_id) where statut = 'CONFORME';
-- Un même numéro peut revenir pour le MÊME titulaire (renouvellement) ; l'unicité entre titulaires
-- est contrôlée dans moto_permis_enregistrer, sous verrou consultatif sur le numéro.
create index if not exists moto_permis_titulaire_idx on public.moto_permis (titulaire_id, statut);

alter table public.moto_affectations add column if not exists permis_id uuid references public.moto_permis(id);

insert into public.moto_parametres (cle, valeur, unite, description, provisoire)
values ('permis_alerte_jours', 30, 'jours', 'Préavis d''alerte avant l''expiration du permis d''un conducteur affecté', true)
on conflict (cle) do nothing;

-- ---------------------------------------------------------------------
-- 2. Règles d'accès et de validité
-- ---------------------------------------------------------------------
-- Lecture d'un permis : BM, ABM, coordinateur logistique, ou le titulaire lui-même.
create or replace function private.moto_lecture_permis(p_titulaire uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select coalesce(private.moto_classe() in ('BM','ABM','LOGISTIQUE'), false)
      or (p_titulaire is not null and p_titulaire = auth.uid() and private.moto_classe() is not null)
$$;

-- Chemin d'un scan de permis : exactement permis/<titulaire>/<uuid>.pdf (aucun sous-dossier, aucun « .. »).
create or replace function private.moto_chemin_permis_valide(p_nom text, p_titulaire uuid)
returns boolean language sql immutable set search_path to 'pg_temp'
as $$
  select p_nom is not null and p_titulaire is not null
     and p_nom ~ ('^permis/' || p_titulaire::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$')
$$;

-- Permis utilisable à une date : CONFORME, et sans expiration ou non expiré.
create or replace function private.moto_permis_valide(p_user uuid, p_date date)
returns public.moto_permis language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select * from public.moto_permis
  where titulaire_id = p_user and statut = 'CONFORME'
    and (sans_expiration or date_expiration >= coalesce(p_date, current_date))
  order by verifie_at desc limit 1
$$;

-- ---------------------------------------------------------------------
-- 3. Enregistrement et vérification
-- ---------------------------------------------------------------------
create or replace function public.moto_permis_enregistrer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text := private.moto_classe(); v_tit uuid := coalesce(private.moto_uuid(p, 'titulaire_id'), auth.uid());
        v_path text := nullif(btrim(p ->> 'document_path'), ''); v_num text; v_cat text[]; v_bad text;
        v_sans boolean := lower(coalesce(p ->> 'sans_expiration', 'false')) in ('true', 't', '1', 'oui');
        v_cle text;
        v_del date := nullif(p ->> 'date_delivrance', '')::date; v_exp date := nullif(p ->> 'date_expiration', '')::date; v_id uuid;
begin
  if v_classe is null then perform private.moto_refus('Accès réservé aux utilisateurs AFLP FLEET.'); end if;
  if v_tit <> auth.uid() and v_classe not in ('BM','ABM','LOGISTIQUE') then
    perform private.moto_refus('Seuls le Branch Manager, l''ABM, le coordinateur logistique ou le titulaire lui-même enregistrent un permis.');
  end if;
  if not private.moto_beneficiaire_valide(v_tit) then
    perform private.moto_erreur('Titulaire invalide : compte inactif ou profil non éligible à une moto AFLP.');
  end if;
  if length(btrim(coalesce(p ->> 'nom_titulaire', ''))) < 3 then perform private.moto_erreur('Nom du titulaire, tel qu''imprimé sur le permis, obligatoire.'); end if;
  v_num := upper(regexp_replace(btrim(coalesce(p ->> 'numero_permis', '')), '\s+', ' ', 'g'));
  if v_num !~ '^[A-Z0-9][A-Z0-9 /.-]{2,28}[A-Z0-9]$' then
    perform private.moto_erreur('Numéro de permis invalide : recopiez-le exactement depuis le document (lettres, chiffres, espaces, / . -).');
  end if;
  select array_agg(distinct upper(btrim(x)) order by upper(btrim(x))) into v_cat
  from jsonb_array_elements_text(coalesce(p -> 'categories', '[]'::jsonb)) x where btrim(x) <> '';
  if v_cat is null then perform private.moto_erreur('Au moins une catégorie de permis est obligatoire.'); end if;
  select c into v_bad from unnest(v_cat) c where c !~ '^[A-Z][A-Z0-9]{0,2}$' limit 1;
  if v_bad is not null then perform private.moto_erreur(format('Catégorie de permis non reconnue : %s.', v_bad)); end if;
  if v_del is not null and v_del > current_date then perform private.moto_erreur('Date de délivrance dans le futur.'); end if;
  if v_sans and v_exp is not null then perform private.moto_erreur('Indiquez une date d''expiration OU « aucune date d''expiration sur le document », pas les deux.'); end if;
  if not v_sans and v_exp is null then
    perform private.moto_erreur('Date d''expiration obligatoire. Si le document n''en porte aucune, cochez « aucune date d''expiration sur le document ».');
  end if;
  if v_exp is not null and v_exp < current_date then perform private.moto_erreur('Permis expiré : il ne peut pas servir de permis de conduite.'); end if;
  if not private.moto_chemin_permis_valide(v_path, v_tit) then
    perform private.moto_erreur('Scan du permis obligatoire (chemin permis/<titulaire>/<identifiant>.pdf).');
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'moto-documents' and name = v_path) then
    perform private.moto_erreur('Fichier introuvable dans le stockage privé : déposez le scan avant d''enregistrer.');
  end if;
  if exists (select 1 from public.moto_permis where titulaire_id = v_tit and statut = 'EN_VERIFICATION') then
    perform private.moto_erreur('Un permis est déjà en attente de vérification pour ce conducteur.');
  end if;
  -- Comparaison sur les seuls lettres et chiffres : « TEST-0004 », « TEST 0004 » et « test0004 » sont le même permis.
  v_cle := regexp_replace(v_num, '[^A-Z0-9]', '', 'g');
  perform pg_advisory_xact_lock(hashtext('moto_permis:' || v_cle));
  if exists (select 1 from public.moto_permis where numero_cle = v_cle and statut = 'RETIRE') then
    perform private.moto_refus('Ce numéro de permis a été retiré : aucun dépôt possible tant que le Branch Manager n''a pas levé le retrait.');
  end if;
  -- Un numéro appartient à une seule personne : réservé dès qu'il a été déposé (hors dépôt rejeté), même retiré, levé ou remplacé.
  if exists (select 1 from public.moto_permis where numero_cle = v_cle and statut not in ('NON_CONFORME','ANNULE') and titulaire_id <> v_tit) then
    perform private.moto_erreur('Ce numéro de permis est déjà enregistré pour un autre conducteur.');
  end if;
  perform private.moto_motif(coalesce(nullif(btrim(p ->> 'motif'), ''), 'Enregistrement du permis de conduire'));
  insert into public.moto_permis (titulaire_id, nom_titulaire, numero_permis, categories, date_delivrance, date_expiration, sans_expiration,
                                  autorite_delivrance, document_path, nom_fichier, pages)
  values (v_tit, btrim(p ->> 'nom_titulaire'), v_num, v_cat, v_del, v_exp, v_sans, nullif(btrim(p ->> 'autorite_delivrance'), ''),
          v_path, nullif(btrim(p ->> 'nom_fichier'), ''), nullif(p ->> 'pages', '')::integer)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'statut', 'EN_VERIFICATION',
    'note', 'Permis enregistré : à vérifier sur l''original par l''ABM ou le Branch Manager (autre personne que le déposant).');
end $$;

create or replace function public.moto_permis_verifier(p_permis uuid, p_statut text, p_verification_rh_nom text default null,
                                                     p_categorie_adaptee boolean default null, p_motif text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare r public.moto_permis; v_dec text := upper(coalesce(p_statut, ''));
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  perform pg_advisory_xact_lock(hashtext('moto_permis:' || (select numero_cle from public.moto_permis where id = p_permis)));   -- numéro, puis ligne
  select * into r from public.moto_permis where id = p_permis for update;
  if not found or r.statut <> 'EN_VERIFICATION' then perform private.moto_erreur('Permis introuvable ou déjà vérifié.'); end if;
  if r.depose_par = auth.uid() then perform private.moto_refus('Séparation des tâches : la personne qui a déposé le permis ne le vérifie pas.'); end if;
  if r.titulaire_id = auth.uid() then perform private.moto_refus('Le titulaire ne vérifie pas son propre permis.'); end if;
  if v_dec = 'CONFORME' then
    perform pg_advisory_xact_lock(hashtext('moto_permis:' || r.numero_cle));
    if exists (select 1 from public.moto_permis where numero_cle = r.numero_cle and statut = 'RETIRE') then
      perform private.moto_refus('Ce numéro de permis a été retiré : il ne peut pas être déclaré conforme tant que le Branch Manager n''a pas levé le retrait.');
    end if;
    if exists (select 1 from public.moto_permis where numero_cle = r.numero_cle and statut not in ('NON_CONFORME','ANNULE') and titulaire_id <> r.titulaire_id) then
      perform private.moto_erreur('Ce numéro de permis est déjà reconnu pour un autre conducteur : déclarez ce dépôt non conforme.');
    end if;
    -- Quatre yeux sur le numéro : qui a annulé un permis portant ce numéro ne valide pas le dépôt suivant.
    if exists (select 1 from public.moto_permis where numero_cle = r.numero_cle and statut = 'ANNULE' and annule_par = auth.uid()) then
      perform private.moto_refus('Quatre yeux : la personne qui a annulé un permis portant ce numéro ne valide pas le nouveau dépôt ; faites-le vérifier par l''ABM.');
    end if;
    if exists (select 1 from public.moto_permis where titulaire_id = r.titulaire_id and statut = 'RETRAIT_LEVE' and leve_par = auth.uid()) then
      perform private.moto_refus('Quatre yeux : la personne qui a levé le retrait ne vérifie pas le nouveau dépôt ; faites-le vérifier par l''ABM.');
    end if;
    if length(btrim(coalesce(p_verification_rh_nom, ''))) < 3 then
      perform private.moto_erreur('Nom de la personne (RH) qui a contrôlé l''original obligatoire.');
    end if;
    if p_categorie_adaptee is not true then
      perform private.moto_erreur('Confirmez que la catégorie du permis est adaptée à la moto confiée.');
    end if;
    if not r.sans_expiration and r.date_expiration < current_date then
      perform private.moto_erreur('Permis expiré : il ne peut pas être déclaré conforme.');
    end if;
    perform private.moto_motif(coalesce(nullif(btrim(p_motif), ''), 'Permis contrôlé sur original'));
    update public.moto_permis set statut = 'REMPLACE', remplace_par = r.id where titulaire_id = r.titulaire_id and statut = 'CONFORME';
    update public.moto_permis set statut = 'CONFORME', verifie_par = auth.uid(), verifie_at = now(),
           verification_rh_nom = btrim(p_verification_rh_nom), categorie_adaptee = true, motif_verification = nullif(btrim(p_motif), '')
    where id = r.id;
  elsif v_dec = 'NON_CONFORME' then
    perform private.moto_motif(p_motif, 5);
    update public.moto_permis set statut = 'NON_CONFORME', verifie_par = auth.uid(), verifie_at = now(), motif_verification = btrim(p_motif)
    where id = r.id;
  else
    perform private.moto_erreur('Décision attendue : CONFORME ou NON_CONFORME.');
  end if;
  return jsonb_build_object('id', r.id, 'statut', v_dec);
end $$;

-- Retrait d'un permis CONFORME (suspension, retrait par l'autorité, fraude découverte) :
-- BM ou ABM, motif obligatoire ; le titulaire ne retire pas son propre permis.
-- Effet immédiat : plus aucune remise ni transfert ; les conducteurs déjà affectés apparaissent
-- dans les alertes (statut RETIRE) pour que le BM retire l'affectation.
create or replace function public.moto_permis_retirer(p_permis uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare r public.moto_permis;
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  -- Ordre des verrous commun à toutes les fonctions : numéro (verrou consultatif), puis ligne.
  perform pg_advisory_xact_lock(hashtext('moto_permis:' || (select numero_cle from public.moto_permis where id = p_permis)));
  select * into r from public.moto_permis where id = p_permis for update;
  if not found or r.statut <> 'CONFORME' then perform private.moto_erreur('Seul un permis CONFORME peut être retiré.'); end if;
  if r.titulaire_id = auth.uid() then perform private.moto_refus('Le titulaire ne retire pas son propre permis.'); end if;
  perform private.moto_motif(p_motif, 10);
  update public.moto_permis set statut = 'RETIRE', retire_par = auth.uid(), retire_at = now(), motif_retrait = btrim(p_motif) where id = r.id;
  return jsonb_build_object('id', r.id, 'statut', 'RETIRE',
    'affectations_actives', (select count(*) from public.moto_affectations a where a.beneficiaire_id = r.titulaire_id and a.statut = 'ACTIVE'
                                                                        and a.type_affectation in ('REMISE','TRANSFERT')));
end $$;

-- Levée d'un retrait (erreur, suspension terminée) : Branch Manager seul, motif obligatoire.
-- Le permis ne redevient PAS valide : le conducteur doit redéposer son permis, qui sera vérifié sur original.
create or replace function public.moto_permis_lever_retrait(p_permis uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare r public.moto_permis;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform pg_advisory_xact_lock(hashtext('moto_permis:' || (select numero_cle from public.moto_permis where id = p_permis)));   -- numéro, puis ligne
  select * into r from public.moto_permis where id = p_permis for update;
  if not found or r.statut <> 'RETIRE' then perform private.moto_erreur('Seul un permis RETIRÉ peut voir son retrait levé.'); end if;
  perform private.moto_motif(p_motif, 10);
  update public.moto_permis set statut = 'RETRAIT_LEVE', leve_par = auth.uid(), leve_at = now(), motif_levee = btrim(p_motif) where id = r.id;
  return jsonb_build_object('id', r.id, 'statut', 'RETRAIT_LEVE',
    'note', 'Retrait levé. Le permis doit être redéposé puis vérifié sur original pour redevenir valide.');
end $$;

-- Annulation pour ERREUR DE TITULAIRE (permis validé sous le numéro d'une autre personne, usurpation) :
-- Branch Manager seul, motif détaillé, quatre yeux (ni le vérificateur de ce permis, ni le titulaire).
-- Le permis devient ANNULE : il ne vaut plus rien et son numéro est libéré pour son vrai titulaire.
create or replace function public.moto_permis_annuler_erreur(p_permis uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare r public.moto_permis;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform pg_advisory_xact_lock(hashtext('moto_permis:' || (select numero_cle from public.moto_permis where id = p_permis)));   -- numéro, puis ligne
  select * into r from public.moto_permis where id = p_permis for update;
  if not found or r.statut not in ('CONFORME','REMPLACE','RETIRE','RETRAIT_LEVE') then
    perform private.moto_erreur('Seul un permis validé (conforme, remplacé, retiré ou levé) s''annule ainsi ; un dépôt en attente se déclare non conforme.');
  end if;
  if r.verifie_par = auth.uid() then perform private.moto_refus('Quatre yeux : la personne qui a validé ce permis ne l''annule pas.'); end if;
  if r.titulaire_id = auth.uid() then perform private.moto_refus('Le titulaire n''annule pas son propre permis.'); end if;
  perform private.moto_motif(p_motif, 15);
  update public.moto_permis set statut = 'ANNULE', annule_par = auth.uid(), annule_at = now(), motif_annulation = btrim(p_motif) where id = r.id;
  return jsonb_build_object('id', r.id, 'statut', 'ANNULE',
    'note', 'Permis annulé pour erreur de titulaire : le numéro est libéré pour son vrai titulaire.',
    'affectations_actives', (select count(*) from public.moto_affectations a where a.beneficiaire_id = r.titulaire_id and a.statut = 'ACTIVE'
                                                                        and a.type_affectation in ('REMISE','TRANSFERT')));
end $$;

-- ---------------------------------------------------------------------
-- 4. Remise et transfert : permis CONFORME et valide exigé côté serveur.
--    Déclencheur : couvre tous les chemins d'écriture d'une affectation.
-- ---------------------------------------------------------------------
create or replace function private.moto_affectation_permis()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare r public.moto_permis;
begin
  if new.type_affectation in ('REMISE','TRANSFERT') and new.statut = 'ACTIVE' then
    if tg_op = 'UPDATE' and new.type_affectation = old.type_affectation and new.beneficiaire_id = old.beneficiaire_id
       and new.permis_id is not distinct from old.permis_id and new.statut = old.statut then
      return new;
    end if;
    r := private.moto_permis_valide(new.beneficiaire_id, coalesce(new.date_debut, current_date));
    -- Verrou partagé : un retrait simultané du permis attend la fin de la remise (ou l'inverse).
    if r.id is not null then
      perform 1 from public.moto_permis where id = r.id and statut = 'CONFORME' for share;
      -- Le permis a changé pendant l'attente (renouvellement vérifié, retrait) : on relit une fois.
      if not found then
        r := private.moto_permis_valide(new.beneficiaire_id, coalesce(new.date_debut, current_date));
        if r.id is not null then
          perform 1 from public.moto_permis where id = r.id and statut = 'CONFORME' for share;
          if not found then r := null; end if;
        end if;
      end if;
    end if;
    if r.id is null then
      perform private.moto_erreur('Remise bloquée : le bénéficiaire n''a pas de permis enregistré, vérifié CONFORME et en cours de validité (Administration › Conducteurs et permis).');
    end if;
    new.permis_id := r.id;
    new.permis_verifie := true;
    new.permis_categorie := array_to_string(r.categories, ', ');
    new.permis_verifie_par_nom := r.verification_rh_nom;
    new.permis_verifie_at := r.verifie_at::date;
  end if;
  return new;
end $$;

drop trigger if exists moto_affectations_permis_trg on public.moto_affectations;
create trigger moto_affectations_permis_trg before insert or update of type_affectation, beneficiaire_id, permis_id, statut on public.moto_affectations
  for each row execute function private.moto_affectation_permis();

-- La case déclarative « permis vérifié » est remplacée par le contrôle du permis enregistré.
create or replace function private.moto_controle_remise(p_moto uuid, p jsonb)
returns void language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_pv uuid := private.moto_uuid(p, 'pv_document_id'); v_req text; v_eq jsonb := coalesce(p -> 'equipements', '{}'::jsonb);
begin
  if not exists (select 1 from public.moto_documents where id = v_pv and moto_id = p_moto and type_document = 'PV_REMISE' and statut = 'CONFORME') then
    perform private.moto_erreur('Procès-verbal signé, numérisé et vérifié CONFORME obligatoire.');
  end if;
  -- Permis : vérifié par le déclencheur moto_affectations_permis_trg (permis enregistré, CONFORME, non expiré).
  for v_req in select jsonb_array_elements_text(valeur_json) from public.moto_parametres where cle = 'equipements_obligatoires' loop
    if coalesce((v_eq ->> v_req)::boolean, false) is not true then
      perform private.moto_erreur(format('Équipement de sécurité manquant : %s.', v_req));
    end if;
  end loop;
  if private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('Relevé du compteur à la remise obligatoire.'); end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Stockage privé : dossier permis/<titulaire>/
-- ---------------------------------------------------------------------
create or replace function private.moto_peut_deposer(p_nom text)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid_ou_null((storage.foldername(p_nom))[1]);
        v_cat text := (storage.foldername(p_nom))[2];
        v_classe text := private.moto_classe();
        v_tit uuid;
begin
  if v_classe is null then return false; end if;
  if (storage.foldername(p_nom))[1] = 'depenses' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and v_cat = auth.uid()::text;
  end if;
  if (storage.foldername(p_nom))[1] = 'finmaint' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and (storage.foldername(p_nom))[3] in ('devis','facture')
       and exists (select 1 from public.moto_motos where id = private.moto_uuid_ou_null((storage.foldername(p_nom))[2]));
  end if;
  if (storage.foldername(p_nom))[1] = 'permis' then
    v_tit := private.moto_uuid_ou_null(v_cat);
    if v_tit is null or not private.moto_chemin_permis_valide(p_nom, v_tit) or not private.moto_beneficiaire_valide(v_tit) then return false; end if;
    return v_tit = auth.uid() or v_classe in ('BM','ABM','LOGISTIQUE');
  end if;
  if v_moto is null then return false; end if;
  if not exists (select 1 from public.moto_motos where id = v_moto) then return false; end if;
  if v_classe in ('BM','ABM') then return true; end if;
  if v_classe = 'LOGISTIQUE' then return v_cat in ('controle','incident','maintenance','photo','justificatif','document'); end if;
  if v_classe = 'ZONE' then return private.moto_peut_operer(v_moto) and v_cat in ('controle','incident','maintenance','photo'); end if;
  if v_classe = 'UNITE' then return private.moto_est_affectataire(v_moto) and v_cat in ('justificatif','incident','photo','controle'); end if;
  return false;
end $$;

alter policy moto_documents_consultation on storage.objects
  using (bucket_id = 'moto-documents'
         and ((private.moto_uuid_ou_null((storage.foldername(name))[1]) is not null
               and private.moto_dans_perimetre(private.moto_uuid_ou_null((storage.foldername(name))[1])))
              or ((storage.foldername(name))[1] = 'depenses'
                  and private.moto_lecture_enveloppe(private.moto_uuid_ou_null((storage.foldername(name))[2])))
              or ((storage.foldername(name))[1] = 'finmaint' and private.moto_lecture_fin_maintenance())
              or ((storage.foldername(name))[1] = 'permis'
                  and private.moto_lecture_permis(private.moto_uuid_ou_null((storage.foldername(name))[2])))));

-- ---------------------------------------------------------------------
-- 6. Lecture des permis (vue appelant : la RLS de moto_permis s'applique)
-- ---------------------------------------------------------------------
drop view if exists public.moto_v_permis;
create view public.moto_v_permis with (security_invoker = true) as
select p.id, p.titulaire_id, private.moto_nom_profil(p.titulaire_id) as titulaire_compte, p.nom_titulaire, p.numero_permis,
       p.categories, p.date_delivrance, p.date_expiration, p.sans_expiration, p.autorite_delivrance, p.document_path, p.nom_fichier, p.pages,
       p.statut, p.verification_rh_nom, p.categorie_adaptee, p.motif_verification, p.depose_par, private.moto_nom_profil(p.depose_par) as depose_par_nom,
       p.depose_at, p.verifie_par, private.moto_nom_profil(p.verifie_par) as verifie_par_nom, p.verifie_at,
       p.retire_par, private.moto_nom_profil(p.retire_par) as retire_par_nom, p.retire_at, p.motif_retrait,
       p.leve_par, private.moto_nom_profil(p.leve_par) as leve_par_nom, p.leve_at, p.motif_levee, p.numero_cle,
       p.annule_par, private.moto_nom_profil(p.annule_par) as annule_par_nom, p.annule_at, p.motif_annulation,
       case when p.sans_expiration or p.date_expiration is null then null else p.date_expiration - current_date end as jours_restants,
       case when p.statut <> 'CONFORME' then p.statut
            when p.sans_expiration then 'VALIDE'
            when p.date_expiration < current_date then 'EXPIRE'
            when p.date_expiration <= current_date + coalesce(private.moto_param('permis_alerte_jours'), 30)::integer then 'EXPIRE_BIENTOT'
            else 'VALIDE' end as statut_validite
from public.moto_permis p;

-- Conducteurs affectés dont le permis est absent, expiré ou proche de l'expiration.
create or replace function public.moto_permis_alertes()
returns table (moto_id uuid, moto_code text, beneficiaire_id uuid, beneficiaire_nom text, type_affectation text,
               permis_id uuid, statut_validite text, date_expiration date, jours_restants integer)
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_alerte integer := coalesce(private.moto_param('permis_alerte_jours'), 30)::integer;
begin
  if coalesce(private.moto_classe() in ('BM','ABM','LOGISTIQUE'), false) is not true then return; end if;
  return query
  select x.moto_id, x.code, x.beneficiaire_id, x.nom, x.type_affectation, x.pid, x.etat, x.exp,
         case when x.exp is null then null else (x.exp - current_date) end
  from (
    select a.moto_id, m.code, a.beneficiaire_id, private.moto_nom_profil(a.beneficiaire_id) nom, a.type_affectation,
           coalesce(v.id, d.id) pid,
           case when v.id is not null then (case when v.sans_expiration then 'VALIDE' when v.date_expiration <= current_date + v_alerte then 'EXPIRE_BIENTOT' else 'VALIDE' end)
                when d.statut = 'RETIRE' then 'RETIRE'
                when d.statut = 'CONFORME' then 'EXPIRE'
                else 'AUCUN_PERMIS_VALIDE' end etat,
           coalesce(v.date_expiration, d.date_expiration) exp
    from public.moto_affectations a
    join public.moto_motos m on m.id = a.moto_id
    left join lateral (select * from private.moto_permis_valide(a.beneficiaire_id, current_date) y where y.id is not null) v on true
    left join lateral (select * from public.moto_permis z where z.titulaire_id = a.beneficiaire_id and z.statut in ('CONFORME','RETIRE')
                       order by coalesce(z.retire_at, z.verifie_at) desc limit 1) d on true
    where a.statut = 'ACTIVE' and a.type_affectation in ('REMISE','TRANSFERT')
  ) x
  where x.etat <> 'VALIDE'
  order by x.exp nulls first, x.code;
end $$;

-- Libellés lisibles (accents) des codes repris dans le carnet.
create or replace function private.moto_lib(p_code text)
returns text language sql immutable set search_path to 'pg_temp'
as $$
  select case upper(coalesce(p_code, ''))
    when 'VIDANGE' then 'vidange' when 'ENTRETIEN_PREVENTIF' then 'entretien préventif' when 'REVISION' then 'révision'
    when 'REPARATION' then 'réparation' when 'PANNE' then 'panne' when 'DIAGNOSTIC' then 'diagnostic' when 'PNEUMATIQUE' then 'pneumatique'
    when 'AUTORISEE' then 'autorisée' when 'REFUSEE' then 'refusée' when 'ANNULEE' then 'annulée' when 'EN_ATTENTE' then 'en attente'
    when 'CARTE_GRISE' then 'carte grise' when 'PLAQUE' then 'plaque d''immatriculation' when 'ASSURANCE' then 'assurance'
    when 'RAPPORT_MECANICIEN' then 'rapport du mécanicien' when 'PV_REMISE' then 'procès-verbal de remise' when 'PHOTO' then 'photographie'
    when 'PERMIS' then 'permis' when 'FACTURE' then 'facture' when 'JUSTIFICATIF' then 'justificatif' when 'AUTRE' then 'autre document'
    when 'ACCIDENT' then 'accident' when 'CREVAISON' then 'crevaison' when 'ANOMALIE' then 'anomalie'
    when 'MINEURE' then 'mineure' when 'MAJEURE' then 'majeure' when 'CRITIQUE' then 'critique'
    when 'RECEPTIONNEE' then 'réceptionnée' when 'PREVUE' then 'acquisition prévue'
    when 'ZONE' then 'Chef de zone' when 'COORDINATION' then 'coordinateur' when 'INDEPENDANTE' then 'contrôle indépendant'
    when 'AVANT' then 'avant' when 'ARRIERE' then 'arrière'
    else lower(replace(coalesce(p_code, ''), '_', ' ')) end
$$;

-- ---------------------------------------------------------------------
-- 7. Carnet de suivi d'une moto : chronologie complète.
--    Montants de maintenance (autorisations, factures, paiements, pneus) :
--    visibles seulement avec la lecture financière (BM, ABM, Finance,
--    Direction, coordinateur), comme en phase 2. Autorisations et factures
--    n'apparaissent pas du tout hors lecture financière.
-- ---------------------------------------------------------------------
create or replace function public.moto_carnet(p_moto uuid)
returns table (date_evenement timestamptz, categorie text, evenement text, detail text, statut text,
               compteur_km numeric, montant numeric, montant_nature text, acteur text, source text, source_id uuid)
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_fin boolean := private.moto_lecture_fin_maintenance();
begin
  if p_moto is null or not private.moto_dans_perimetre(p_moto) then
    perform private.moto_refus('Moto hors de votre périmètre.');
  end if;
  return query
  select * from (
    -- Parc : enregistrement, début d'utilisation déclaré, début du suivi fiable, mise en service
    select m.created_at, 'PARC'::text,
           case when m.origine = 'EN_EXPLOITATION' then 'Intégration dans AFLP FLEET' else 'Enregistrement de la moto' end,
           concat_ws(' · ', nullif(btrim(concat_ws(' ', m.marque, m.modele)), ''),
                     case when m.date_reception is not null then 'réception le ' || to_char(m.date_reception, 'DD/MM/YYYY') end,
                     case when m.situation_parc is not null then private.moto_lib(m.situation_parc) end),
           null::text, m.compteur_reception_km, null::numeric, null::text, private.moto_nom_profil(m.created_by), 'moto_motos'::text, m.id
    from public.moto_motos m where m.id = p_moto
    union all
    select m.date_debut_utilisation::timestamptz, 'PARC', 'Début d''utilisation (déclaré)', coalesce(m.historique_note, 'Historique antérieur non documenté'),
           null, null, null, null, null, 'moto_motos', m.id
    from public.moto_motos m where m.id = p_moto and m.date_debut_utilisation is not null
    union all
    select m.date_debut_suivi::timestamptz, 'PARC', 'Début du suivi fiable', 'Les indicateurs ne remontent pas avant cette date', null, null, null, null, null, 'moto_motos', m.id
    from public.moto_motos m where m.id = p_moto and m.date_debut_suivi is not null
    union all
    select m.mise_en_service_at, 'PARC', 'Mise en service (autorisation de circuler)', m.mise_en_service_motif, null, null, null, null,
           private.moto_nom_profil(m.mise_en_service_par), 'moto_motos', m.id
    from public.moto_motos m where m.id = p_moto and m.mise_en_service_at is not null
    union all
    -- Affectations
    select a.created_at, 'AFFECTATION',
           case a.type_affectation when 'PREAFFECTATION' then 'Préaffectation' when 'REMISE' then 'Remise officielle' else 'Transfert' end,
           'Bénéficiaire : ' || coalesce(private.moto_nom_profil(a.beneficiaire_id), '—')
             || case when a.permis_id is not null then ' · permis vérifié (' || coalesce(a.permis_categorie, '') || ')' else '' end,
           a.statut, a.compteur_km, null, null, private.moto_nom_profil(a.cree_par), 'moto_affectations', a.id
    from public.moto_affectations a where a.moto_id = p_moto
    union all
    -- Contrôles et inspections (les contrôles avant départ n'apparaissent qu'en cas de défaut)
    select c.date_controle, 'CONTROLE',
           case c.type_controle when 'INSPECTION_INITIALE' then 'Inspection mécanique initiale'
                                when 'INSPECTION_MENSUELLE' then 'Inspection mensuelle (' || private.moto_lib(c.niveau) || ')'
                                when 'ETAT_REMISE' then 'État contradictoire avant remise'
                                when 'REMISE_EN_SERVICE' then 'Contrôle de remise en service'
                                else 'Contrôle avant départ : défaut' end,
           concat_ws(' · ', nullif(c.intervenant_nom, ''), nullif(c.garage_nom, ''), nullif(c.observations, ''), nullif(c.besoins_entretien, '')),
           coalesce(c.conformite, c.resultat), c.compteur_km, null, null, private.moto_nom_profil(c.realise_par), 'moto_controles', c.id
    from public.moto_controles c
    where c.moto_id = p_moto and c.remplace_par is null
      and (c.type_controle <> 'AVANT_DEPART' or c.anomalie_critique or c.resultat = 'INAPTE')
    union all
    -- Anomalies et actions correctives
    select ac.constat_at, 'ANOMALIE', 'Anomalie constatée (' || private.moto_lib(ac.gravite) || ')', ac.anomalie, ac.statut, null, null, null,
           private.moto_nom_profil(ac.signale_par), 'moto_actions_correctives', ac.id
    from public.moto_actions_correctives ac where ac.moto_id = p_moto
    union all
    select ac.realise_at, 'ANOMALIE', 'Correction réalisée', coalesce(ac.action_prevue, ac.anomalie), ac.statut, null, null, null,
           private.moto_nom_profil(ac.realise_par), 'moto_actions_correctives', ac.id
    from public.moto_actions_correctives ac where ac.moto_id = p_moto and ac.realise_at is not null
    union all
    select ac.verifie_at, 'ANOMALIE', 'Correction vérifiée', coalesce(ac.verification_note, ac.anomalie), ac.statut, null, null, null,
           private.moto_nom_profil(ac.verifie_par), 'moto_actions_correctives', ac.id
    from public.moto_actions_correctives ac where ac.moto_id = p_moto and ac.verifie_at is not null
    union all
    -- Maintenance : besoin, travaux réalisés, contrôle, clôture, annulation
    select mt.demande_at, 'MAINTENANCE', 'Besoin d''entretien ou de réparation (' || private.moto_lib(mt.type_maintenance) || ')',
           mt.description, mt.statut, mt.compteur_km, null, null, private.moto_nom_profil(mt.demande_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto
    union all
    select coalesce(mt.date_realisation::timestamptz, mt.termine_at), 'MAINTENANCE', 'Travaux réalisés' || coalesce(' chez ' || g.nom, ''),
           concat_ws(' · ', (select string_agg(t.libelle, ', ' order by t.created_at) from public.moto_maintenance_travaux t
                             where t.maintenance_id = mt.id and t.statut = 'REALISE'),
                     case when mt.pieces_remplacees is not null then 'Pièces : ' || mt.pieces_remplacees end, mt.observations_travaux),
           mt.statut, null, null, null, private.moto_nom_profil(mt.termine_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt left join public.moto_garages g on g.id = mt.garage_id
    where mt.moto_id = p_moto and (mt.date_realisation is not null or mt.termine_at is not null)
    union all
    select mt.controle_at, 'MAINTENANCE', 'Contrôle des travaux', mt.controle_note, mt.controle_resultat, null, null, null,
           private.moto_nom_profil(mt.controle_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto and mt.controle_at is not null
    union all
    select mt.cloture_at, 'MAINTENANCE', 'Dossier clôturé', mt.cloture_motif, mt.statut, null, null, null,
           private.moto_nom_profil(mt.cloture_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto and mt.cloture_at is not null
    union all
    select mt.annule_at, 'MAINTENANCE', 'Dossier annulé', mt.annule_motif, mt.statut, null, null, null,
           private.moto_nom_profil(mt.annule_par), 'moto_maintenances', mt.id
    from public.moto_maintenances mt where mt.moto_id = p_moto and mt.annule_at is not null
    union all
    -- Décisions du Branch Manager (lecture financière uniquement)
    select au.decide_at, 'AUTORISATION', 'Décision du Branch Manager : ' || private.moto_lib(au.statut), au.perimetre, au.statut, null,
           au.montant_autorise, 'AUTORISE', private.moto_nom_profil(au.decide_par), 'moto_autorisations', au.id
    from public.moto_autorisations au where v_fin and au.moto_id = p_moto and au.decide_at is not null
    union all
    -- Factures et paiements (lecture financière uniquement)
    select f.date_facture::timestamptz, 'FACTURE', 'Facture n° ' || f.numero_facture || coalesce(' · ' || g.nom, ''),
           coalesce(f.motif_verification, ''), f.statut, null, f.montant, 'FACTURE', private.moto_nom_profil(f.depose_par), 'moto_factures', f.id
    from public.moto_factures f left join public.moto_garages g on g.id = f.garage_id
    where v_fin and f.moto_id = p_moto
    union all
    select f.paiement_date::timestamptz, 'FACTURE', 'Paiement constaté · facture n° ' || f.numero_facture, f.paiement_reference, null, null,
           f.montant_paye, 'PAYE', private.moto_nom_profil(f.paiement_par), 'moto_factures', f.id
    from public.moto_factures f where v_fin and f.moto_id = p_moto and f.paiement_date is not null and f.montant_paye > 0
    union all
    -- Pneumatiques
    select po.pose_date::timestamptz, 'PNEU', 'Pneu monté (' || private.moto_lib(po.position) || ')',
           concat_ws(' ', pn.code, pn.marque, pn.dimensions), null, po.pose_km, null, null, private.moto_nom_profil(po.pose_par), 'moto_pneu_poses', po.id
    from public.moto_pneu_poses po left join public.moto_pneus pn on pn.id = po.pneu_id where po.moto_id = p_moto
    union all
    select po.depose_date::timestamptz, 'PNEU', 'Pneu déposé (' || private.moto_lib(po.position) || ')',
           concat_ws(' · ', concat_ws(' ', pn.code, pn.marque), po.motif_depose,
                     case when po.depose_km is not null and po.pose_km is not null then (po.depose_km - po.pose_km)::text || ' km parcourus' end),
           null, po.depose_km, null, null, private.moto_nom_profil(po.depose_par), 'moto_pneu_poses', po.id
    from public.moto_pneu_poses po left join public.moto_pneus pn on pn.id = po.pneu_id where po.moto_id = p_moto and po.depose_date is not null
    union all
    select pr.date_reparation::timestamptz, 'PNEU', 'Réparation de pneu', pr.description, null, pr.compteur_km,
           case when v_fin then pr.cout end, case when v_fin and pr.cout is not null then 'PNEU' end,
           private.moto_nom_profil(pr.saisi_par), 'moto_pneu_reparations', pr.id
    from public.moto_pneu_reparations pr where pr.moto_id = p_moto
    union all
    -- Carburant : synthèse mensuelle (le détail reste dans l'onglet Carburant)
    select max(c.date_achat), 'CARBURANT', 'Carburant · ' || to_char(date_trunc('month', c.date_achat), 'MM/YYYY'),
           count(*)::text || ' achat(s) · ' || replace(trim(to_char(sum(c.litres), 'FM999990.0')), '.', ',') || ' L'
             || case when count(*) filter (where c.justificatif_statut = 'A_VERIFIER') > 0
                     then ' · ' || count(*) filter (where c.justificatif_statut = 'A_VERIFIER') || ' justificatif(s) à vérifier' else '' end,
           null, max(c.compteur_km), sum(c.montant), 'CARBURANT', null, 'moto_carburant', null::uuid
    from public.moto_carburant c where c.moto_id = p_moto
    group by date_trunc('month', c.date_achat)
    union all
    -- Incidents
    select i.declare_at, 'INCIDENT', 'Incident : ' || private.moto_lib(i.type_incident) || ' (' || private.moto_lib(i.gravite) || ')', i.description, i.etape, i.compteur_km,
           null, null, private.moto_nom_profil(i.declare_par), 'moto_incidents', i.id
    from public.moto_incidents i where i.moto_id = p_moto
    union all
    select i.clos_at, 'INCIDENT', 'Incident clos', i.description, i.etape, null, null, null, private.moto_nom_profil(i.clos_par), 'moto_incidents', i.id
    from public.moto_incidents i where i.moto_id = p_moto and i.clos_at is not null
    union all
    -- Immobilisations
    select im.debut, 'IMMOBILISATION', 'Immobilisation', im.motif, case when im.fin is null then 'EN_COURS' else 'LEVEE' end, null, null, null,
           private.moto_nom_profil(im.ouverte_par), 'moto_immobilisations', im.id
    from public.moto_immobilisations im where im.moto_id = p_moto
    union all
    select im.fin, 'IMMOBILISATION', 'Remise en circulation', im.levee_motif, 'LEVEE', null, null, null,
           private.moto_nom_profil(im.levee_par), 'moto_immobilisations', im.id
    from public.moto_immobilisations im where im.moto_id = p_moto and im.fin is not null
    union all
    -- Documents de la moto
    select d.depose_at, 'DOCUMENT', 'Document déposé : ' || private.moto_lib(d.type_document),
           concat_ws(' · ', d.numero_reference, case when d.date_expiration is not null then 'expire le ' || to_char(d.date_expiration, 'DD/MM/YYYY') end),
           d.statut, null, null, null, private.moto_nom_profil(d.depose_par), 'moto_documents', d.id
    from public.moto_documents d where d.moto_id = p_moto
  ) e (date_evenement, categorie, evenement, detail, statut, compteur_km, montant, montant_nature, acteur, source, source_id)
  where e.date_evenement is not null
  order by e.date_evenement desc, e.categorie;
end $$;

create index if not exists moto_factures_moto_idx on public.moto_factures (moto_id);
create index if not exists moto_autorisations_moto_idx on public.moto_autorisations (moto_id);
create index if not exists moto_pneu_reparations_moto_idx on public.moto_pneu_reparations (moto_id);
create index if not exists moto_actions_correctives_moto_idx on public.moto_actions_correctives (moto_id);
create index if not exists moto_pneu_poses_moto_idx on public.moto_pneu_poses (moto_id);

-- ---------------------------------------------------------------------
-- 8. Sécurité : RLS, journal, droits
-- ---------------------------------------------------------------------
alter table public.moto_permis enable row level security;
revoke all on public.moto_permis from anon;
revoke insert, update, delete, truncate, references, trigger on public.moto_permis from authenticated;
grant select on public.moto_permis to authenticated;
drop policy if exists moto_permis_lecture on public.moto_permis;
create policy moto_permis_lecture on public.moto_permis for select to authenticated using (private.moto_lecture_permis(titulaire_id));
-- Journal des permis : trace des décisions SANS donnée d'identité (ni nom, ni numéro, ni chemin de scan).
create or replace function private.moto_journaliser_permis()
returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then jsonb_build_object('id', old.id, 'titulaire_id', old.titulaire_id, 'statut', old.statut,
                   'depose_par', old.depose_par, 'verifie_par', old.verifie_par, 'retire_par', old.retire_par) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then jsonb_build_object('id', new.id, 'titulaire_id', new.titulaire_id, 'statut', new.statut,
                   'depose_par', new.depose_par, 'verifie_par', new.verifie_par, 'retire_par', new.retire_par, 'leve_par', new.leve_par, 'annule_par', new.annule_par) end;
  v_val text := nullif(current_setting('moto.valideur', true), '');
begin
  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
  insert into public.moto_journal (table_nom, enregistrement_id, action, ancienne_valeur, nouvelle_valeur, auteur, auteur_nom, motif, valideur)
  values (tg_table_name, coalesce(v_new ->> 'id', v_old ->> 'id'), tg_op, v_old, v_new, auth.uid(), private.moto_mon_nom(),
          nullif(current_setting('moto.motif', true), ''), case when v_val is null then null else v_val::uuid end);
  return coalesce(new, old);
end $$;
drop trigger if exists moto_permis_journal_trg on public.moto_permis;
create trigger moto_permis_journal_trg after insert or update or delete on public.moto_permis
  for each row execute function private.moto_journaliser_permis();
-- Défense en profondeur : les entrées de journal des permis restent réservées à ceux qui lisent les permis.
alter policy moto_journal_lecture on public.moto_journal
  using (((private.moto_classe() = any (array['BM','ABM','DIRECTION'])) or private.moto_est_finance_manager())
         and (table_nom <> 'moto_permis' or private.moto_classe() in ('BM','ABM')));

revoke all on public.moto_v_permis from anon;
grant select on public.moto_v_permis to authenticated;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','private') and p.proname like 'moto\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.nspname = 'public' or f.proname in ('moto_classe','moto_classe_de','moto_est_finance_manager','moto_mon_cluster','moto_ma_zone','moto_mon_nom',
        'moto_est_affectataire','moto_dans_perimetre','moto_lecture_finance','moto_lecture_enveloppe','moto_peut_deposer','moto_uuid_ou_null',
        'moto_nom_profil','moto_param','moto_fenetre','moto_lecture_fin_maintenance','moto_lecture_permis') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;

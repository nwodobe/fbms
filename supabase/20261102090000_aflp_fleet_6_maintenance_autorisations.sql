-- =====================================================================
-- AFLP FLEET — migration 6 : maintenance intelligente, garages partenaires,
-- autorisation individuelle préalable du Branch Manager.
--
-- STATUT : PRÉPARÉE ET TESTÉE SUR RÉPLIQUE LOCALE UNIQUEMENT.
-- NON APPLIQUÉE EN PRODUCTION : le mandat « Phase 2 » n'autorise ni
-- migration ni déploiement. Retour arrière :
-- 20261102090100_aflp_fleet_6_rollback.sql.
--
-- Règle fondamentale (mandat, §3.D) : toute dépense d'entretien ou de
-- réparation reçoit une autorisation INDIVIDUELLE et PRÉALABLE du Branch
-- Manager, quel que soit son montant. Une enveloppe approuvée n'est jamais
-- une autorisation. Aucun seuil, aucune approbation implicite, aucune
-- validation par expiration de délai.
--
-- Failles corrigées (constatées en production le 31/10/2026, 0 donnée) :
--  · moto_maintenance_decider acceptait BM, ZONE et ABM ;
--  · moto_incident_avancer('AUTORISATION_DEPENSE') acceptait le Chef de zone ;
--  · moto_maintenance_terminer levait l'immobilisation par une case cochée ;
--  · dépenses d'enveloppe, actions correctives et pneus pouvaient porter un
--    coût de réparation sans aucune autorisation BM ;
--  · les échéances appliquaient toutes les règles à toutes les motos, sans
--    modèle, et pouvaient partir d'une base non vérifiée.
--
-- Principes : additive, rejouable, aucune donnée réelle créée ou modifiée.
-- Les intervalles fournis par le commanditaire sont insérés en BROUILLON,
-- nature HYPOTHESE : ils ne produisent AUCUNE échéance tant que le Branch
-- Manager ne les a pas requalifiés et approuvés.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Modèles techniques et association explicite moto → modèle
-- ---------------------------------------------------------------------
create table if not exists public.moto_modeles_techniques (
  code text primary key check (code ~ '^[A-Z0-9_]{3,40}$'),
  libelle text not null,
  marque_attendue text not null,
  modele_motif text not null,           -- expression régulière (insensible à la casse) sur moto_motos.modele
  note text,
  created_at timestamptz not null default now()
);
insert into public.moto_modeles_techniques (code, libelle, marque_attendue, modele_motif, note)
values ('APSONIC_AP150_30', 'APSONIC AP150-30', 'APSONIC', '^AP ?150[-_ ]?30$',
        'Modèle déclaré par le commanditaire pour les 4 motos des Chefs d''unité. Manuel constructeur non retrouvé au 31/10/2026.')
on conflict (code) do nothing;

alter table public.moto_motos add column if not exists modele_technique_code text references public.moto_modeles_techniques(code);
alter table public.moto_motos add column if not exists modele_technique_par uuid;
alter table public.moto_motos add column if not exists modele_technique_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. Règles versionnées (modèle ou exception documentée par moto)
-- ---------------------------------------------------------------------
create table if not exists public.moto_regles_versions (
  id uuid primary key default gen_random_uuid(),
  regle_code text not null references public.moto_regles_maintenance(code),
  modele_code text references public.moto_modeles_techniques(code),
  moto_id uuid references public.moto_motos(id),
  phase text not null default 'RECURRENT' check (phase in ('RODAGE','RECURRENT')),
  intervalle_km numeric(10,0) check (intervalle_km is null or intervalle_km > 0),
  intervalle_jours integer check (intervalle_jours is null or intervalle_jours > 0),
  rappel_avant_km numeric(10,0) check (rappel_avant_km is null or rappel_avant_km >= 0),
  proche_avant_km numeric(10,0) check (proche_avant_km is null or proche_avant_km >= 0),
  rappel_avant_jours integer check (rappel_avant_jours is null or rappel_avant_jours >= 0),
  proche_avant_jours integer check (proche_avant_jours is null or proche_avant_jours >= 0),
  marge_depassement_km numeric(10,0) not null default 0 check (marge_depassement_km >= 0),
  marge_depassement_jours integer not null default 0 check (marge_depassement_jours >= 0),
  nature_source text not null check (nature_source in ('CONSTRUCTEUR','POLITIQUE_INTERNE','HYPOTHESE')),
  reference_source text,
  version integer not null default 1,
  date_effet date,
  statut text not null default 'BROUILLON' check (statut in ('BROUILLON','APPROUVEE','REMPLACEE','RETIREE')),
  motif text not null check (length(btrim(motif)) >= 10),
  propose_par uuid default auth.uid(),
  propose_at timestamptz not null default now(),
  approuve_par uuid, approuve_at timestamptz, motif_approbation text,
  retire_par uuid, retire_at timestamptz,
  check ((modele_code is null) <> (moto_id is null)),
  check (intervalle_km is not null or intervalle_jours is not null),
  check (rappel_avant_km is null or intervalle_km is null or rappel_avant_km < intervalle_km),
  check (proche_avant_km is null or rappel_avant_km is null or proche_avant_km <= rappel_avant_km),
  check (statut <> 'APPROUVEE' or (approuve_par is not null and date_effet is not null and nature_source <> 'HYPOTHESE'))
);
create unique index if not exists moto_regles_versions_une_active on public.moto_regles_versions
  (regle_code, coalesce(modele_code, ''), coalesce(moto_id::text, ''), phase) where statut = 'APPROUVEE';

-- Valeurs fournies par le commanditaire (§4) : hypothèses, brouillons, jamais actives.
insert into public.moto_regles_versions (regle_code, modele_code, phase, intervalle_km, intervalle_jours,
       rappel_avant_km, proche_avant_km, rappel_avant_jours, proche_avant_jours, nature_source, reference_source, motif, propose_par)
select v.regle, 'APSONIC_AP150_30', 'RECURRENT', v.km, v.j, v.rk, v.pk, v.rj, v.pj, 'HYPOTHESE',
       'Mandat AFLP FLEET Phase 2, §4 : hypothèse interne, non vérifiée constructeur',
       'Valeur provisoire à valider techniquement puis par le Branch Manager', null
from (values ('VIDANGE', 1500, 60, 400, 200, 15, 7), ('ENTRETIEN', 1000, 30, 200, 100, 7, 3), ('REVISION', 5000, 180, 500, 250, 30, 14))
       as v(regle, km, j, rk, pk, rj, pj)
where not exists (select 1 from public.moto_regles_versions x where x.regle_code = v.regle and x.modele_code = 'APSONIC_AP150_30');

-- ---------------------------------------------------------------------
-- 3. Garages partenaires (catalogue léger, indicateurs dérivés des dossiers)
-- ---------------------------------------------------------------------
create table if not exists public.moto_garages (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(btrim(nom)) >= 3),
  localisation text not null check (length(btrim(localisation)) >= 3),
  clusters text[] not null default '{}',
  contact_professionnel text,
  types_interventions text[] not null default '{}',
  specialites text,
  habilitation_constructeur text,
  conditions_garantie text,
  tarifs_documentes text,
  statut text not null default 'CANDIDAT' check (statut in ('CANDIDAT','EVALUE','APPROUVE','SUSPENDU')),
  statut_par uuid, statut_at timestamptz, statut_motif text,
  cree_par uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists moto_garages_nom_lieu on public.moto_garages (upper(btrim(nom)), upper(btrim(localisation)));

-- ---------------------------------------------------------------------
-- 4. Dossier de maintenance (table existante étendue), travaux, autorisations, factures
-- ---------------------------------------------------------------------
alter table public.moto_maintenances drop constraint if exists moto_maintenances_statut_check;
alter table public.moto_maintenances add constraint moto_maintenances_statut_check check (statut in
  ('DEMANDEE','DIAGNOSTIC','DEVIS_RECU','EN_ATTENTE_BM','AUTORISEE','REFUSEE','PROGRAMMEE','EN_COURS','TERMINEE','CONTROLEE','CLOTUREE','ANNULEE'));
alter table public.moto_maintenances drop constraint if exists moto_maintenances_type_maintenance_check;
alter table public.moto_maintenances add constraint moto_maintenances_type_maintenance_check check (type_maintenance in
  ('VIDANGE','ENTRETIEN_PREVENTIF','REVISION','REPARATION','PANNE','DIAGNOSTIC','PNEUMATIQUE'));
alter table public.moto_maintenances add column if not exists garage_id uuid references public.moto_garages(id);
alter table public.moto_maintenances add column if not exists urgence text check (urgence is null or urgence in ('NORMALE','PRIORITAIRE','SECURITE'));
alter table public.moto_maintenances add column if not exists justification text;
alter table public.moto_maintenances add column if not exists consequence_report text;
alter table public.moto_maintenances add column if not exists date_souhaitee date;
alter table public.moto_maintenances add column if not exists diagnostic_note text;
alter table public.moto_maintenances add column if not exists devis_montant numeric(14,0) check (devis_montant is null or devis_montant >= 0);
alter table public.moto_maintenances add column if not exists devis_pieces numeric(14,0) check (devis_pieces is null or devis_pieces >= 0);
alter table public.moto_maintenances add column if not exists devis_main_oeuvre numeric(14,0) check (devis_main_oeuvre is null or devis_main_oeuvre >= 0);
alter table public.moto_maintenances add column if not exists devis_path text;
alter table public.moto_maintenances add column if not exists constat_path text;
alter table public.moto_maintenances add column if not exists dernier_devis_path text;
alter table public.moto_maintenances add column if not exists dernier_devis_justification text;
alter table public.moto_maintenances add column if not exists sans_frais boolean not null default false;
alter table public.moto_maintenances add column if not exists sans_frais_motif text;
alter table public.moto_maintenances add column if not exists date_prevue date;
alter table public.moto_maintenances add column if not exists date_fin_prevue date;
alter table public.moto_maintenances add column if not exists montant_engage numeric(14,0) not null default 0 check (montant_engage >= 0);
alter table public.moto_maintenances add column if not exists programme_par uuid;
alter table public.moto_maintenances add column if not exists programme_at timestamptz;
alter table public.moto_maintenances add column if not exists date_realisation date;
alter table public.moto_maintenances add column if not exists pieces_remplacees text;
alter table public.moto_maintenances add column if not exists observations_travaux text;
alter table public.moto_maintenances add column if not exists controle_resultat text check (controle_resultat is null or controle_resultat in ('CONFORME','NON_CONFORME'));
alter table public.moto_maintenances add column if not exists controle_par uuid;
alter table public.moto_maintenances add column if not exists controle_at timestamptz;
alter table public.moto_maintenances add column if not exists controle_note text;
alter table public.moto_maintenances add column if not exists cloture_par uuid;
alter table public.moto_maintenances add column if not exists cloture_at timestamptz;
alter table public.moto_maintenances add column if not exists cloture_motif text;
alter table public.moto_maintenances add column if not exists annule_par uuid;
alter table public.moto_maintenances add column if not exists annule_at timestamptz;
alter table public.moto_maintenances add column if not exists annule_motif text;
alter table public.moto_maintenances drop constraint if exists moto_maintenances_devis_unique;
alter table public.moto_maintenances add constraint moto_maintenances_devis_unique unique (devis_path);

create table if not exists public.moto_maintenance_travaux (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.moto_maintenances(id),
  operation_code text not null check (operation_code in ('VIDANGE','ENTRETIEN','REVISION','REPARATION','DIAGNOSTIC','PNEUMATIQUE','AUTRE')),
  libelle text not null check (length(btrim(libelle)) >= 3),
  statut text not null default 'PREVU' check (statut in ('PREVU','REALISE','NON_REALISE')),
  autorisation_id uuid,
  cree_par uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists moto_maintenance_travaux_mt on public.moto_maintenance_travaux (maintenance_id);

create table if not exists public.moto_autorisations (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.moto_maintenances(id),
  moto_id uuid not null references public.moto_motos(id),
  rang integer not null,
  objet text not null check (objet in ('DIAGNOSTIC','TRAVAUX','SUPPLEMENT')),
  garage_id uuid references public.moto_garages(id),
  perimetre text not null check (length(btrim(perimetre)) >= 10),
  travaux jsonb not null default '[]',
  montant_demande numeric(14,0) not null check (montant_demande > 0),
  devis_path text,
  justification text not null check (length(btrim(justification)) >= 10),
  consequence_report text not null check (length(btrim(consequence_report)) >= 5),
  urgence text not null default 'NORMALE' check (urgence in ('NORMALE','PRIORITAIRE','SECURITE')),
  statut text not null default 'EN_ATTENTE' check (statut in ('EN_ATTENTE','AUTORISEE','REFUSEE','ANNULEE')),
  soumis_par uuid not null default auth.uid(),
  soumis_at timestamptz not null default now(),
  decide_par uuid, decide_at timestamptz,
  montant_autorise numeric(14,0),
  commentaire_decision text,
  client_op_id uuid unique,
  unique (maintenance_id, rang),
  check (decide_par is null or decide_par <> soumis_par),
  check (statut <> 'AUTORISEE' or (montant_autorise is not null and montant_autorise > 0 and montant_autorise <= montant_demande and decide_par is not null)),
  check (statut <> 'REFUSEE' or decide_par is not null)
);
create unique index if not exists moto_autorisations_une_en_attente on public.moto_autorisations (maintenance_id) where statut = 'EN_ATTENTE';

create table if not exists public.moto_factures (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references public.moto_maintenances(id),
  moto_id uuid not null references public.moto_motos(id),
  garage_id uuid references public.moto_garages(id),
  numero_facture text not null check (length(btrim(numero_facture)) >= 1),
  date_facture date not null,
  montant numeric(14,0) not null check (montant > 0),
  document_path text not null unique,
  statut text not null default 'DEPOSEE' check (statut in ('DEPOSEE','VERIFIEE','REJETEE')),
  depose_par uuid not null default auth.uid(),
  depose_at timestamptz not null default now(),
  verifie_par uuid, verifie_at timestamptz, motif_verification text,
  montant_paye numeric(14,0) not null default 0 check (montant_paye >= 0),
  paiement_reference text, paiement_date date, paiement_par uuid,
  check (verifie_par is null or verifie_par <> depose_par),
  check (montant_paye <= montant),
  check (montant_paye = 0 or statut = 'VERIFIEE')
);
-- Une même facture d'un même garage ne peut pas être enregistrée deux fois.
create unique index if not exists moto_factures_numero_unique on public.moto_factures
  (coalesce(garage_id::text, 'interne'), upper(btrim(numero_facture))) where statut <> 'REJETEE';

-- Rattachement des coûts annexes à une autorisation BM
alter table public.moto_depenses add column if not exists nature text;
alter table public.moto_depenses add column if not exists autorisation_id uuid references public.moto_autorisations(id);
alter table public.moto_depenses drop constraint if exists moto_depenses_nature_check;
alter table public.moto_depenses add constraint moto_depenses_nature_check
  check (nature is null or (nature = 'SUPERVISION' and autorisation_id is null and action_id is null)
                        or (nature = 'MAINTENANCE' and autorisation_id is not null));
alter table public.moto_pneus add column if not exists autorisation_id uuid references public.moto_autorisations(id);
alter table public.moto_pneu_reparations add column if not exists autorisation_id uuid references public.moto_autorisations(id);

-- ---------------------------------------------------------------------
-- 5. Fonctions utilitaires
-- ---------------------------------------------------------------------
create or replace function private.moto_lecture_fin_maintenance()
returns boolean language sql stable security definer set search_path to 'public', 'private', 'pg_temp'
as $$ select coalesce(private.moto_classe() in ('BM','ABM','FINANCE','DIRECTION','LOGISTIQUE'), false) $$;

-- Pièce financière : finmaint/<moto>/<devis|facture>/<fichier>
create or replace function private.moto_piece_fin_valide(p_moto uuid, p_path text, p_cat text)
returns void language plpgsql stable security definer set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if p_path is null then return; end if;
  if (storage.foldername(p_path))[1] is distinct from 'finmaint' or (storage.foldername(p_path))[2] is distinct from p_moto::text
     or (storage.foldername(p_path))[3] is distinct from p_cat then
    perform private.moto_erreur(format('Chemin non conforme : finmaint/<moto>/%s/<fichier> attendu.', p_cat));
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'moto-documents' and name = p_path) then
    perform private.moto_erreur('Fichier introuvable dans le stockage privé : déposez-le avant d''enregistrer.');
  end if;
end $$;

create or replace function private.moto_total_autorise(p_mt uuid)
returns numeric language sql stable security definer set search_path to 'public', 'pg_temp'
as $$ select coalesce(sum(montant_autorise), 0) from public.moto_autorisations where maintenance_id = p_mt and statut = 'AUTORISEE' $$;

create or replace function private.moto_autorisation_valide(p_aut uuid, p_moto uuid)
returns public.moto_autorisations language plpgsql stable security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare a public.moto_autorisations;
begin
  select * into a from public.moto_autorisations where id = p_aut;
  if not found or a.statut <> 'AUTORISEE' then
    perform private.moto_refus('Dépense de maintenance refusée : autorisation individuelle préalable du Branch Manager introuvable ou non accordée.');
  end if;
  if p_moto is not null and a.moto_id <> p_moto then perform private.moto_erreur('L''autorisation BM concerne une autre moto.'); end if;
  return a;
end $$;

-- ---------------------------------------------------------------------
-- 6. Association moto → modèle technique (jamais automatique)
-- ---------------------------------------------------------------------
create or replace function public.moto_modele_technique_definir(p_moto uuid, p_code text, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare m public.moto_motos; mt public.moto_modeles_techniques;
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  perform private.moto_motif(p_motif, 10);
  select * into m from public.moto_motos where id = p_moto for update;
  if not found then perform private.moto_erreur('Moto inconnue.'); end if;
  if nullif(btrim(p_code), '') is not null then
    select * into mt from public.moto_modeles_techniques where code = upper(btrim(p_code));
    if not found then perform private.moto_erreur('Modèle technique inconnu.'); end if;
    -- Interdit d'appliquer des règles d'un modèle à une moto d'une autre marque ou d'un autre modèle.
    if upper(btrim(coalesce(m.marque, ''))) <> upper(mt.marque_attendue) or coalesce(m.modele, '') !~* mt.modele_motif then
      perform private.moto_refus(format('Modèle incompatible : la moto est enregistrée « %s %s », le modèle technique exige %s.',
        coalesce(m.marque, 'marque inconnue'), coalesce(m.modele, 'modèle inconnu'), mt.libelle));
    end if;
  end if;
  update public.moto_motos set modele_technique_code = nullif(upper(btrim(p_code)), ''), modele_technique_par = auth.uid(),
         modele_technique_at = now(), updated_at = now() where id = p_moto;
  return jsonb_build_object('moto_id', p_moto, 'modele_technique_code', nullif(upper(btrim(p_code)), ''));
end $$;

-- ---------------------------------------------------------------------
-- 7. Règles : proposer, approuver (BM seul), retirer
-- ---------------------------------------------------------------------
create or replace function public.moto_regle_version_proposer(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_id uuid; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_modele text := nullif(upper(btrim(p ->> 'modele_code')), '');
        v_nature text := upper(coalesce(p ->> 'nature_source', '')); v_ver integer;
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  perform private.moto_motif(p ->> 'motif', 10);
  if not exists (select 1 from public.moto_regles_maintenance where code = p ->> 'regle_code') then perform private.moto_erreur('Opération inconnue.'); end if;
  if (v_moto is null) = (v_modele is null) then perform private.moto_erreur('Une règle vise soit un modèle technique, soit une moto (exception documentée).'); end if;
  if v_modele is not null and not exists (select 1 from public.moto_modeles_techniques where code = v_modele) then perform private.moto_erreur('Modèle technique inconnu.'); end if;
  if v_moto is not null then
    if not exists (select 1 from public.moto_motos where id = v_moto) then perform private.moto_erreur('Moto inconnue.'); end if;
    if length(btrim(coalesce(p ->> 'reference_source', ''))) < 10 then
      perform private.moto_erreur('Exception par moto : référence documentaire obligatoire (diagnostic, avis technique…).');
    end if;
  end if;
  if v_nature not in ('CONSTRUCTEUR','POLITIQUE_INTERNE','HYPOTHESE') then perform private.moto_erreur('Nature de la source : CONSTRUCTEUR, POLITIQUE_INTERNE ou HYPOTHESE.'); end if;
  if v_nature = 'CONSTRUCTEUR' and length(btrim(coalesce(p ->> 'reference_source', ''))) < 10 then
    perform private.moto_erreur('Prescription constructeur : référence précise du document obligatoire (aucune prescription sans source).');
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.moto_regles_versions
   where regle_code = p ->> 'regle_code' and coalesce(modele_code, '') = coalesce(v_modele, '') and coalesce(moto_id::text, '') = coalesce(v_moto::text, '')
     and phase = coalesce(nullif(upper(p ->> 'phase'), ''), 'RECURRENT');
  insert into public.moto_regles_versions (regle_code, modele_code, moto_id, phase, intervalle_km, intervalle_jours,
         rappel_avant_km, proche_avant_km, rappel_avant_jours, proche_avant_jours, marge_depassement_km, marge_depassement_jours,
         nature_source, reference_source, version, date_effet, motif)
  values (p ->> 'regle_code', v_modele, v_moto, coalesce(nullif(upper(p ->> 'phase'), ''), 'RECURRENT'),
          private.moto_num(p, 'intervalle_km'), private.moto_num(p, 'intervalle_jours')::integer,
          private.moto_num(p, 'rappel_avant_km'), private.moto_num(p, 'proche_avant_km'),
          private.moto_num(p, 'rappel_avant_jours')::integer, private.moto_num(p, 'proche_avant_jours')::integer,
          coalesce(private.moto_num(p, 'marge_depassement_km'), 0), coalesce(private.moto_num(p, 'marge_depassement_jours')::integer, 0),
          v_nature, nullif(btrim(p ->> 'reference_source'), ''), v_ver, nullif(p ->> 'date_effet', '')::date, btrim(p ->> 'motif'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', v_ver, 'statut', 'BROUILLON');
end $$;

create or replace function public.moto_regle_version_approuver(p_version uuid, p_date_effet date, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare r public.moto_regles_versions;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 10);
  select * into r from public.moto_regles_versions where id = p_version for update;
  if not found or r.statut <> 'BROUILLON' then perform private.moto_erreur('Version introuvable ou déjà traitée.'); end if;
  if r.nature_source = 'HYPOTHESE' then
    perform private.moto_refus('Une hypothèse non validée ne peut pas devenir une politique opérationnelle : requalifiez-la (constructeur avec référence, ou politique interne avec validation technique).');
  end if;
  if length(btrim(coalesce(r.reference_source, ''))) < 10 then perform private.moto_erreur('Référence de la source obligatoire avant approbation.'); end if;
  if p_date_effet is null then perform private.moto_erreur('Date d''effet obligatoire.'); end if;
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_regles_versions set statut = 'REMPLACEE', retire_par = auth.uid(), retire_at = now()
   where statut = 'APPROUVEE' and regle_code = r.regle_code and coalesce(modele_code, '') = coalesce(r.modele_code, '')
     and coalesce(moto_id::text, '') = coalesce(r.moto_id::text, '') and phase = r.phase;
  update public.moto_regles_versions set statut = 'APPROUVEE', approuve_par = auth.uid(), approuve_at = now(),
         date_effet = p_date_effet, motif_approbation = btrim(p_motif) where id = r.id;
  return jsonb_build_object('id', r.id, 'statut', 'APPROUVEE', 'date_effet', p_date_effet);
end $$;

create or replace function public.moto_regle_version_retirer(p_version uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare r public.moto_regles_versions;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 10);
  select * into r from public.moto_regles_versions where id = p_version for update;
  if not found or r.statut not in ('BROUILLON','APPROUVEE') then perform private.moto_erreur('Version introuvable ou déjà retirée.'); end if;
  update public.moto_regles_versions set statut = 'RETIREE', retire_par = auth.uid(), retire_at = now() where id = r.id;
  return jsonb_build_object('id', r.id, 'statut', 'RETIREE');
end $$;

-- L'ancien paramétrage global (sans modèle, sans version) est neutralisé.
create or replace function public.moto_regle_maintenance_definir(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.moto_erreur('Paramétrage remplacé : proposez une version de règle par modèle (moto_regle_version_proposer), approuvée par le Branch Manager.');
  return null;
end $$;
update public.moto_regles_maintenance set actif = false where actif;

-- ---------------------------------------------------------------------
-- 8. Garages
-- ---------------------------------------------------------------------
create or replace function public.moto_garage_enregistrer(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_id uuid := private.moto_uuid(p, 'id');
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Fiche garage'));
  if v_id is null then
    insert into public.moto_garages (nom, localisation, clusters, contact_professionnel, types_interventions, specialites,
           habilitation_constructeur, conditions_garantie, tarifs_documentes)
    values (btrim(p ->> 'nom'), btrim(p ->> 'localisation'),
            coalesce(array(select jsonb_array_elements_text(p -> 'clusters')), '{}'), nullif(btrim(p ->> 'contact_professionnel'), ''),
            coalesce(array(select upper(jsonb_array_elements_text(p -> 'types_interventions'))), '{}'), nullif(btrim(p ->> 'specialites'), ''),
            nullif(btrim(p ->> 'habilitation_constructeur'), ''), nullif(btrim(p ->> 'conditions_garantie'), ''), nullif(btrim(p ->> 'tarifs_documentes'), ''))
    returning id into v_id;
  else
    update public.moto_garages set
      nom = coalesce(nullif(btrim(p ->> 'nom'), ''), nom), localisation = coalesce(nullif(btrim(p ->> 'localisation'), ''), localisation),
      clusters = case when p ? 'clusters' then array(select jsonb_array_elements_text(p -> 'clusters')) else clusters end,
      contact_professionnel = coalesce(nullif(btrim(p ->> 'contact_professionnel'), ''), contact_professionnel),
      types_interventions = case when p ? 'types_interventions' then array(select upper(jsonb_array_elements_text(p -> 'types_interventions'))) else types_interventions end,
      specialites = coalesce(nullif(btrim(p ->> 'specialites'), ''), specialites),
      habilitation_constructeur = coalesce(nullif(btrim(p ->> 'habilitation_constructeur'), ''), habilitation_constructeur),
      conditions_garantie = coalesce(nullif(btrim(p ->> 'conditions_garantie'), ''), conditions_garantie),
      tarifs_documentes = coalesce(nullif(btrim(p ->> 'tarifs_documentes'), ''), tarifs_documentes)
    where id = v_id;
    if not found then perform private.moto_erreur('Garage inconnu.'); end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.moto_garage_statut(p_garage uuid, p_statut text, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text := private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']); v_s text := upper(coalesce(p_statut, ''));
begin
  if v_s not in ('CANDIDAT','EVALUE','APPROUVE','SUSPENDU') then perform private.moto_erreur('Statut inconnu.'); end if;
  -- Un garage ne devient « approuvé » ou « suspendu » que par décision du Branch Manager.
  if v_s in ('APPROUVE','SUSPENDU') and v_classe <> 'BM' then perform private.moto_refus('Approbation ou suspension d''un garage réservée au Branch Manager.'); end if;
  perform private.moto_motif(p_motif, 10);
  if v_s = 'APPROUVE' then perform set_config('moto.valideur', auth.uid()::text, true); end if;
  update public.moto_garages set statut = v_s, statut_par = auth.uid(), statut_at = now(), statut_motif = btrim(p_motif) where id = p_garage;
  if not found then perform private.moto_erreur('Garage inconnu.'); end if;
  return jsonb_build_object('id', p_garage, 'statut', v_s);
end $$;

-- ---------------------------------------------------------------------
-- 9. Circuit d'entretien et de réparation
-- ---------------------------------------------------------------------
-- 9.1 Besoin identifié (terrain, inspection, coordinateur). Hors ligne autorisé : ce n'est qu'un signalement.
create or replace function public.moto_maintenance_demander(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_id uuid; v_res jsonb;
        v_type text := upper(coalesce(p ->> 'type_maintenance', ''));
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','UNITE','LOGISTIQUE']);
  perform private.moto_charger(v_moto);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre ou non affectée à votre compte.'); end if;
  if v_type not in ('VIDANGE','ENTRETIEN_PREVENTIF','REVISION','REPARATION','PANNE','DIAGNOSTIC','PNEUMATIQUE') then
    perform private.moto_erreur('Type de maintenance inconnu.');
  end if;
  perform private.moto_motif('Besoin de maintenance signalé');
  -- Les champs de décision éventuellement envoyés (statut, montant autorisé…) sont ignorés : une demande n'est jamais une autorisation.
  insert into public.moto_maintenances (moto_id, type_maintenance, description, compteur_km, cout_estime, incident_id, urgence, client_op_id)
  values (v_moto, v_type, btrim(coalesce(p ->> 'description', '')), private.moto_num(p, 'compteur_km'),
          private.moto_num(p, 'cout_estime'), private.moto_uuid(p, 'incident_id'),
          coalesce(nullif(upper(p ->> 'urgence'), ''), 'NORMALE'), v_client)
  returning id into v_id;
  v_res := jsonb_build_object('id', v_id, 'statut', 'DEMANDEE');
  perform private.moto_op_enregistrer(v_client, 'MAINTENANCE_DEMANDE', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

-- 9.2 Diagnostic à organiser
create or replace function public.moto_maintenance_diagnostic(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances; v_gar uuid := private.moto_uuid(p, 'garage_id');
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  select * into mt from public.moto_maintenances where id = private.moto_uuid(p, 'maintenance_id') for update;
  if not found or mt.statut not in ('DEMANDEE','DIAGNOSTIC') then perform private.moto_erreur('Dossier introuvable ou au-delà du diagnostic.'); end if;
  if v_gar is not null and not exists (select 1 from public.moto_garages where id = v_gar and statut <> 'SUSPENDU') then
    perform private.moto_erreur('Garage inconnu ou suspendu.');
  end if;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Organisation du diagnostic'));
  update public.moto_maintenances set statut = 'DIAGNOSTIC', garage_id = coalesce(v_gar, garage_id),
         diagnostic_note = coalesce(nullif(btrim(p ->> 'note'), ''), diagnostic_note) where id = mt.id;
  return jsonb_build_object('id', mt.id, 'statut', 'DIAGNOSTIC');
end $$;

-- 9.3 Devis reçu (aucun engagement)
create or replace function public.moto_maintenance_devis(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances; v_gar uuid := private.moto_uuid(p, 'garage_id'); t jsonb; v_n integer := 0;
        v_m numeric := private.moto_num(p, 'devis_montant');
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  select * into mt from public.moto_maintenances where id = private.moto_uuid(p, 'maintenance_id') for update;
  if not found or mt.statut not in ('DEMANDEE','DIAGNOSTIC','DEVIS_RECU','AUTORISEE','PROGRAMMEE','EN_COURS','REFUSEE') then
    perform private.moto_erreur('Devis non enregistrable à cette étape.');
  end if;
  if v_gar is null or not exists (select 1 from public.moto_garages where id = v_gar and statut <> 'SUSPENDU') then
    perform private.moto_erreur('Garage proposé obligatoire (enregistré, non suspendu).');
  end if;
  if mt.statut in ('AUTORISEE','PROGRAMMEE','EN_COURS') and mt.garage_id is distinct from v_gar then
    perform private.moto_erreur('Le garage autorisé ne peut pas être changé en cours de dossier : nouvelle demande requise.');
  end if;
  if v_m is null or v_m < 0 then perform private.moto_erreur('Montant du devis obligatoire.'); end if;
  if jsonb_typeof(p -> 'travaux') <> 'array' or jsonb_array_length(p -> 'travaux') = 0 then
    perform private.moto_erreur('Nature des travaux obligatoire : au moins une opération.');
  end if;
  if length(btrim(coalesce(p ->> 'justification', ''))) < 10 then perform private.moto_erreur('Justification obligatoire (10 caractères minimum).'); end if;
  perform private.moto_piece_fin_valide(mt.moto_id, nullif(p ->> 'devis_path', ''), 'devis');
  if nullif(p ->> 'constat_path', '') is not null then perform private.moto_stockage_valide(mt.moto_id, p ->> 'constat_path', array['maintenance','photo','controle']); end if;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Devis reçu'));
  for t in select * from jsonb_array_elements(p -> 'travaux') loop
    insert into public.moto_maintenance_travaux (maintenance_id, operation_code, libelle)
    values (mt.id, upper(coalesce(t ->> 'operation_code', 'AUTRE')), btrim(coalesce(t ->> 'libelle', '')));
    v_n := v_n + 1;
  end loop;
  if mt.statut in ('DEMANDEE','DIAGNOSTIC','REFUSEE','DEVIS_RECU') then
    -- Devis initial (ou remplacé avant toute autorisation)
    update public.moto_maintenances set statut = 'DEVIS_RECU',
      garage_id = v_gar, devis_montant = v_m, devis_pieces = private.moto_num(p, 'devis_pieces'),
      devis_main_oeuvre = private.moto_num(p, 'devis_main_oeuvre'), devis_path = nullif(p ->> 'devis_path', ''),
      dernier_devis_path = nullif(p ->> 'devis_path', ''), dernier_devis_justification = btrim(p ->> 'justification'),
      constat_path = coalesce(nullif(p ->> 'constat_path', ''), constat_path), justification = btrim(p ->> 'justification'),
      urgence = coalesce(nullif(upper(p ->> 'urgence'), ''), urgence, 'NORMALE'), consequence_report = nullif(btrim(p ->> 'consequence_report'), ''),
      date_souhaitee = nullif(p ->> 'date_souhaitee', '')::date, cout_estime = v_m
    where id = mt.id;
  else
    -- Devis complémentaire : il s'AJOUTE à l'estimation, le devis initial est conservé.
    update public.moto_maintenances set devis_montant = coalesce(devis_montant, 0) + v_m, cout_estime = coalesce(cout_estime, 0) + v_m,
      dernier_devis_path = nullif(p ->> 'devis_path', ''), dernier_devis_justification = btrim(p ->> 'justification'),
      constat_path = coalesce(nullif(p ->> 'constat_path', ''), constat_path)
    where id = mt.id;
  end if;
  return jsonb_build_object('id', mt.id, 'statut', case when mt.statut in ('DEMANDEE','DIAGNOSTIC','REFUSEE','DEVIS_RECU') then 'DEVIS_RECU' else mt.statut end, 'travaux', v_n);
end $$;

-- 9.4 Soumission au Branch Manager (diagnostic payant, travaux, supplément)
create or replace function public.moto_autorisation_soumettre(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances; v_objet text := upper(coalesce(p ->> 'objet', '')); v_m numeric := private.moto_num(p, 'montant_demande');
        v_rang integer; v_id uuid; v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_trav jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  -- Le Branch Manager ne se soumet pas de demande à lui-même : il décide.
  perform private.moto_exiger_classe(array['ABM','LOGISTIQUE']);
  select * into mt from public.moto_maintenances where id = private.moto_uuid(p, 'maintenance_id') for update;
  if not found then perform private.moto_erreur('Dossier introuvable.'); end if;
  if exists (select 1 from public.moto_autorisations where maintenance_id = mt.id and statut = 'EN_ATTENTE') then
    perform private.moto_erreur('Une demande d''autorisation est déjà en attente de décision pour ce dossier.');
  end if;
  if v_objet not in ('DIAGNOSTIC','TRAVAUX','SUPPLEMENT') then perform private.moto_erreur('Objet : DIAGNOSTIC, TRAVAUX ou SUPPLEMENT.'); end if;
  if v_objet = 'DIAGNOSTIC' and mt.statut not in ('DEMANDEE','DIAGNOSTIC') then perform private.moto_erreur('Diagnostic payant : à soumettre avant le devis des travaux.'); end if;
  if v_objet = 'TRAVAUX' and mt.statut not in ('DEVIS_RECU') then perform private.moto_erreur('Travaux : un devis enregistré est exigé.'); end if;
  if v_objet = 'SUPPLEMENT' and mt.statut not in ('AUTORISEE','PROGRAMMEE','EN_COURS','TERMINEE') then
    perform private.moto_erreur('Supplément : seulement sur un dossier déjà autorisé et non contrôlé.');
  end if;
  if v_objet = 'SUPPLEMENT' and private.moto_total_autorise(mt.id) = 0 then perform private.moto_erreur('Supplément impossible sans autorisation initiale.'); end if;
  if v_m is null or v_m <= 0 then perform private.moto_erreur('Montant demandé obligatoire et positif.'); end if;
  if v_objet = 'TRAVAUX' and v_m < coalesce(mt.devis_montant, 0) and length(btrim(coalesce(p ->> 'justification', ''))) < 20 then
    perform private.moto_erreur('Montant inférieur au devis : justification détaillée exigée.');
  end if;
  if v_objet <> 'DIAGNOSTIC' and mt.garage_id is null then perform private.moto_erreur('Garage proposé obligatoire.'); end if;
  perform private.moto_piece_fin_valide(mt.moto_id, nullif(p ->> 'devis_path', ''), 'devis');
  if v_objet <> 'DIAGNOSTIC' and coalesce(nullif(p ->> 'devis_path', ''), mt.dernier_devis_path) is null then
    perform private.moto_erreur('Devis documenté obligatoire : déposez la pièce du devis.');
  end if;
  select coalesce(max(rang), 0) + 1 into v_rang from public.moto_autorisations where maintenance_id = mt.id;
  if v_objet = 'DIAGNOSTIC' and not exists (select 1 from public.moto_maintenance_travaux where maintenance_id = mt.id and operation_code = 'DIAGNOSTIC' and statut = 'PREVU') then
    insert into public.moto_maintenance_travaux (maintenance_id, operation_code, libelle) values (mt.id, 'DIAGNOSTIC', 'Diagnostic technique');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'operation_code', operation_code, 'libelle', libelle) order by created_at), '[]')
    into v_trav from public.moto_maintenance_travaux where maintenance_id = mt.id and autorisation_id is null and statut = 'PREVU';
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Soumission au Branch Manager'));
  insert into public.moto_autorisations (maintenance_id, moto_id, rang, objet, garage_id, perimetre, travaux, montant_demande, devis_path,
         justification, consequence_report, urgence, client_op_id)
  values (mt.id, mt.moto_id, v_rang, v_objet, coalesce(private.moto_uuid(p, 'garage_id'), mt.garage_id),
          btrim(coalesce(p ->> 'perimetre', '')), v_trav, v_m, coalesce(nullif(p ->> 'devis_path', ''), case when v_objet <> 'DIAGNOSTIC' then mt.dernier_devis_path end),
          btrim(coalesce(nullif(p ->> 'justification', ''), mt.dernier_devis_justification, mt.justification, '')), btrim(coalesce(p ->> 'consequence_report', mt.consequence_report, '')),
          coalesce(nullif(upper(p ->> 'urgence'), ''), mt.urgence, 'NORMALE'), v_client)
  returning id into v_id;
  update public.moto_maintenance_travaux set autorisation_id = v_id where maintenance_id = mt.id and autorisation_id is null and statut = 'PREVU';
  if mt.statut in ('DEMANDEE','DIAGNOSTIC','DEVIS_RECU') then
    update public.moto_maintenances set statut = 'EN_ATTENTE_BM' where id = mt.id;
  end if;
  perform private.moto_op_enregistrer(v_client, 'AUTORISATION_SOUMISE', 'SYNCHRONISE', jsonb_build_object('id', v_id, 'statut', 'EN_ATTENTE'));
  return jsonb_build_object('id', v_id, 'rang', v_rang, 'statut', 'EN_ATTENTE');
end $$;

-- 9.5 Décision : Branch Manager SEUL, nominative, horodatée, plafonnée.
create or replace function public.moto_autorisation_decider(p_autorisation uuid, p_decision text, p_montant numeric, p_commentaire text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare a public.moto_autorisations; mt public.moto_maintenances; v_dec text := upper(coalesce(p_decision, '')); v_montant numeric;
begin
  perform private.moto_exiger_classe(array['BM']);
  select * into a from public.moto_autorisations where id = p_autorisation for update;
  if not found or a.statut <> 'EN_ATTENTE' then perform private.moto_erreur('Demande introuvable ou déjà décidée.'); end if;
  if a.soumis_par = auth.uid() then perform private.moto_refus('Auto-autorisation interdite.'); end if;
  perform private.moto_exiger_independance(a.moto_id, 'l''autorisation de dépense');
  if v_dec not in ('AUTORISEE','REFUSEE') then perform private.moto_erreur('Décision : AUTORISEE ou REFUSEE.'); end if;
  v_montant := case when v_dec = 'AUTORISEE' then coalesce(p_montant, a.montant_demande) end;
  if v_dec = 'AUTORISEE' and (v_montant <= 0 or v_montant > a.montant_demande) then
    perform private.moto_erreur('Montant autorisé : positif et au plus égal au montant demandé.');
  end if;
  perform private.moto_motif(p_commentaire, case when v_dec = 'REFUSEE' or v_montant < a.montant_demande then 10 else 0 end);
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_autorisations set statut = v_dec, decide_par = auth.uid(), decide_at = now(), montant_autorise = v_montant,
         commentaire_decision = nullif(btrim(p_commentaire), '') where id = a.id;
  select * into mt from public.moto_maintenances where id = a.maintenance_id for update;
  if mt.statut = 'EN_ATTENTE_BM' then
    update public.moto_maintenances set statut = case
        when v_dec = 'AUTORISEE' then 'AUTORISEE'
        when a.objet = 'DIAGNOSTIC' then 'DIAGNOSTIC'
        else 'REFUSEE' end,
      garage_id = coalesce(garage_id, a.garage_id)
    where id = mt.id;
  end if;
  if v_dec = 'REFUSEE' then
    update public.moto_maintenance_travaux set autorisation_id = null where autorisation_id = a.id and statut = 'PREVU' and a.objet <> 'SUPPLEMENT';
    update public.moto_maintenance_travaux set statut = 'NON_REALISE' where autorisation_id = a.id and a.objet = 'SUPPLEMENT';
  end if;
  return jsonb_build_object('id', a.id, 'statut', v_dec, 'montant_autorise', v_montant);
end $$;

-- L'ancienne décision (BM, ZONE, ABM sans montant ni plafond) est neutralisée.
create or replace function public.moto_maintenance_decider(p_maintenance uuid, p_decision text, p_motif text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_erreur('Décision remplacée : le Branch Manager décide chaque demande chiffrée dans « Décisions à prendre » (moto_autorisation_decider).');
  return null;
end $$;

-- 9.6 Programmation et engagement, strictement dans le plafond autorisé
create or replace function public.moto_maintenance_programmer(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances; v_eng numeric := coalesce(private.moto_num(p, 'montant_engage'), 0); v_aut numeric;
        v_sans boolean := coalesce((p ->> 'sans_frais')::boolean, false);
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  select * into mt from public.moto_maintenances where id = private.moto_uuid(p, 'maintenance_id') for update;
  if not found then perform private.moto_erreur('Dossier introuvable.'); end if;
  v_aut := private.moto_total_autorise(mt.id);
  if v_sans then
    -- Intervention sans aucun coût (garantie, intervention interne) : aucun engagement possible.
    if mt.statut not in ('DEMANDEE','DIAGNOSTIC','DEVIS_RECU') or v_aut > 0 then perform private.moto_erreur('« Sans frais » : uniquement avant toute autorisation.'); end if;
    if length(btrim(coalesce(p ->> 'sans_frais_motif', ''))) < 10 then perform private.moto_erreur('Motif « sans frais » obligatoire (garantie, intervention interne…).'); end if;
    if v_eng <> 0 then perform private.moto_refus('Intervention sans frais : aucun montant ne peut être engagé.'); end if;
    if not exists (select 1 from public.moto_maintenance_travaux where maintenance_id = mt.id) then
      perform private.moto_erreur('Nature des travaux obligatoire (enregistrez le devis ou les opérations prévues).');
    end if;
  else
    if mt.statut not in ('AUTORISEE','PROGRAMMEE','EN_COURS') then
      perform private.moto_refus('Engagement impossible : aucune autorisation du Branch Manager enregistrée pour ce dossier.');
    end if;
    if v_aut <= 0 then perform private.moto_refus('Engagement impossible sans autorisation BM.'); end if;
    if v_eng <= 0 then perform private.moto_erreur('Montant engagé obligatoire.'); end if;
    if v_eng > v_aut then
      perform private.moto_refus(format('Engagement de %s FCFA supérieur au plafond autorisé par le BM (%s FCFA) : soumettez un supplément.', v_eng, v_aut));
    end if;
    if v_eng < mt.montant_engage then perform private.moto_erreur('Un engagement ne se réduit pas ici : tracez l''écart à la facture.'); end if;
    if private.moto_uuid(p, 'garage_id') is not null and private.moto_uuid(p, 'garage_id') is distinct from mt.garage_id then
      perform private.moto_refus('Garage différent du garage autorisé : nouvelle autorisation requise.');
    end if;
  end if;
  if mt.statut in ('DEMANDEE','DIAGNOSTIC','DEVIS_RECU','AUTORISEE','PROGRAMMEE') and nullif(p ->> 'date_prevue', '') is null then
    perform private.moto_erreur('Date d''intervention prévue obligatoire.');
  end if;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Programmation des travaux'));
  update public.moto_maintenances set
    statut = case when mt.statut = 'EN_COURS' then 'EN_COURS' else 'PROGRAMMEE' end,
    montant_engage = case when v_sans then 0 else v_eng end, sans_frais = v_sans or mt.sans_frais,
    sans_frais_motif = case when v_sans then btrim(p ->> 'sans_frais_motif') else sans_frais_motif end,
    date_prevue = coalesce(nullif(p ->> 'date_prevue', '')::date, date_prevue),
    date_fin_prevue = coalesce(nullif(p ->> 'date_fin_prevue', '')::date, date_fin_prevue),
    programme_par = auth.uid(), programme_at = now()
  where id = mt.id;
  return jsonb_build_object('id', mt.id, 'statut', case when mt.statut = 'EN_COURS' then 'EN_COURS' else 'PROGRAMMEE' end, 'montant_engage', v_eng);
end $$;

-- 9.7 Début des travaux : immobilisation
create or replace function public.moto_maintenance_demarrer(p_maintenance uuid, p_garage text, p_date date default current_date)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances;
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  select * into mt from public.moto_maintenances where id = p_maintenance for update;
  if not found or mt.statut <> 'PROGRAMMEE' then
    perform private.moto_erreur('Seul un dossier programmé (autorisé par le BM, ou sans frais motivé) peut démarrer.');
  end if;
  if p_date is null or p_date > current_date then perform private.moto_erreur('Date réelle de début obligatoire, pas dans le futur.'); end if;
  perform private.moto_motif('Début d''intervention');
  update public.moto_maintenances set statut = 'EN_COURS', date_intervention = p_date,
         garage_nom = coalesce(nullif(btrim(p_garage), ''), (select nom from public.moto_garages where id = mt.garage_id), garage_nom)
  where id = p_maintenance;
  perform private.moto_ouvrir_immobilisation(mt.moto_id, 'Maintenance '||mt.type_maintenance, 'MAINTENANCE', mt.id);
  perform private.moto_recalculer_statuts(mt.moto_id);
  return jsonb_build_object('id', p_maintenance, 'statut', 'EN_COURS');
end $$;

-- 9.8 Travaux effectués : ce qui a été réellement fait, opération par opération. Jamais de remise en circulation ici.
create or replace function public.moto_maintenance_terminer(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances; t jsonb; v_km numeric := private.moto_num(p, 'compteur_km'); v_n integer;
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  select * into mt from public.moto_maintenances where id = private.moto_uuid(p, 'maintenance_id') for update;
  if not found or mt.statut <> 'EN_COURS' then perform private.moto_erreur('Seule une maintenance en cours peut être terminée.'); end if;
  perform private.moto_exiger_independance(mt.moto_id, 'cette étape');
  if coalesce((p ->> 'remettre_en_service')::boolean, false) then
    perform private.moto_refus('La remise en circulation est une décision distincte : contrôle des travaux, contrôle de remise en service APTE, puis levée par une personne indépendante.');
  end if;
  if v_km is null then perform private.moto_erreur('Kilométrage à la fin des travaux obligatoire (relevé réel).'); end if;
  if nullif(p ->> 'date_realisation', '') is null or (p ->> 'date_realisation')::date > current_date
     or (p ->> 'date_realisation')::date < coalesce(mt.date_intervention, mt.demande_at::date) then
    perform private.moto_erreur('Date réelle de fin obligatoire (ni future, ni antérieure au début).');
  end if;
  if jsonb_typeof(p -> 'travaux') <> 'array' then perform private.moto_erreur('Déclarez chaque opération : réalisée ou non.'); end if;
  for t in select * from jsonb_array_elements(p -> 'travaux') loop
    update public.moto_maintenance_travaux set statut = case when coalesce((t ->> 'realise')::boolean, false) then 'REALISE' else 'NON_REALISE' end
     where id = private.moto_uuid(t, 'id') and maintenance_id = mt.id and statut = 'PREVU'
       and (autorisation_id is null and mt.sans_frais
            or exists (select 1 from public.moto_autorisations a where a.id = autorisation_id and a.statut = 'AUTORISEE'));
  end loop;
  select count(*) into v_n from public.moto_maintenance_travaux where maintenance_id = mt.id and statut = 'PREVU'
    and (autorisation_id is null and mt.sans_frais or exists (select 1 from public.moto_autorisations a where a.id = autorisation_id and a.statut = 'AUTORISEE'));
  if v_n > 0 then perform private.moto_erreur(format('%s opération(s) autorisée(s) non déclarée(s) : précisez réalisée ou non.', v_n)); end if;
  if not exists (select 1 from public.moto_maintenance_travaux where maintenance_id = mt.id and statut = 'REALISE') then
    perform private.moto_erreur('Aucune opération réalisée : annulez le dossier plutôt que de le terminer.');
  end if;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Fin des travaux'));
  update public.moto_maintenances set statut = 'TERMINEE', compteur_km = v_km, date_realisation = (p ->> 'date_realisation')::date,
         pieces_remplacees = nullif(btrim(p ->> 'pieces_remplacees'), ''), observations_travaux = nullif(btrim(p ->> 'observations'), ''),
         termine_par = auth.uid(), termine_at = now()
  where id = mt.id;
  perform private.moto_enregistrer_km(mt.moto_id, v_km, now(), 'MAINTENANCE');
  perform private.moto_recalculer_statuts(mt.moto_id);
  return jsonb_build_object('id', mt.id, 'statut', 'TERMINEE');
end $$;

-- 9.9 Contrôle technique des travaux (par un tiers, indépendant de l'utilisateur)
create or replace function public.moto_maintenance_controler(p_maintenance uuid, p_resultat text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances; v_r text := upper(coalesce(p_resultat, ''));
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','LOGISTIQUE']);
  select * into mt from public.moto_maintenances where id = p_maintenance for update;
  if not found or mt.statut <> 'TERMINEE' then perform private.moto_erreur('Seuls des travaux déclarés terminés peuvent être contrôlés.'); end if;
  if not private.moto_peut_operer(mt.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  perform private.moto_exiger_independance(mt.moto_id, 'le contrôle des travaux');
  if mt.termine_par = auth.uid() then perform private.moto_refus('Séparation des tâches : celui qui déclare les travaux terminés ne les contrôle pas.'); end if;
  if v_r not in ('CONFORME','NON_CONFORME') then perform private.moto_erreur('Résultat : CONFORME ou NON_CONFORME.'); end if;
  perform private.moto_motif(p_note, 10);
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_maintenances set statut = case when v_r = 'CONFORME' then 'CONTROLEE' else 'EN_COURS' end,
         controle_resultat = v_r, controle_par = auth.uid(), controle_at = now(), controle_note = btrim(p_note)
  where id = mt.id;
  if v_r = 'NON_CONFORME' then
    update public.moto_maintenance_travaux set statut = 'PREVU' where maintenance_id = mt.id and statut = 'REALISE';
  end if;
  perform private.moto_recalculer_statuts(mt.moto_id);
  return jsonb_build_object('id', mt.id, 'statut', case when v_r = 'CONFORME' then 'CONTROLEE' else 'EN_COURS' end);
end $$;

-- 9.10 Factures : dépôt, vérification (ABM/Finance), paiement constaté (Finance)
create or replace function public.moto_facture_deposer(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances; v_m numeric := private.moto_num(p, 'montant'); v_id uuid; v_fact numeric;
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  select * into mt from public.moto_maintenances where id = private.moto_uuid(p, 'maintenance_id') for update;
  if not found or mt.statut not in ('PROGRAMMEE','EN_COURS','TERMINEE','CONTROLEE') then perform private.moto_erreur('Facture non enregistrable à cette étape.'); end if;
  if v_m is null or v_m <= 0 then perform private.moto_erreur('Montant de la facture obligatoire et positif.'); end if;
  if nullif(p ->> 'date_facture', '') is null or (p ->> 'date_facture')::date > current_date then perform private.moto_erreur('Date de facture obligatoire, pas dans le futur.'); end if;
  if nullif(btrim(p ->> 'numero_facture'), '') is null then perform private.moto_erreur('Numéro de facture obligatoire.'); end if;
  if nullif(p ->> 'document_path', '') is null then perform private.moto_erreur('Pièce (scan de la facture) obligatoire.'); end if;
  perform private.moto_piece_fin_valide(mt.moto_id, p ->> 'document_path', 'facture');
  perform private.moto_motif('Dépôt de facture');
  insert into public.moto_factures (maintenance_id, moto_id, garage_id, numero_facture, date_facture, montant, document_path)
  values (mt.id, mt.moto_id, mt.garage_id, btrim(p ->> 'numero_facture'), (p ->> 'date_facture')::date, v_m, p ->> 'document_path')
  returning id into v_id;
  select coalesce(sum(montant), 0) into v_fact from public.moto_factures where maintenance_id = mt.id and statut <> 'REJETEE';
  return jsonb_build_object('id', v_id, 'statut', 'DEPOSEE',
    'hors_autorisation', v_fact > private.moto_total_autorise(mt.id));
end $$;

create or replace function public.moto_facture_verifier(p_facture uuid, p_decision text, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare f public.moto_factures; v_dec text := upper(coalesce(p_decision, '')); v_verif numeric; v_aut numeric;
begin
  perform private.moto_exiger_classe(array['ABM','FINANCE']);
  select * into f from public.moto_factures where id = p_facture for update;
  if not found or f.statut <> 'DEPOSEE' then perform private.moto_erreur('Facture introuvable ou déjà vérifiée.'); end if;
  if f.depose_par = auth.uid() then perform private.moto_refus('Auto-vérification interdite.'); end if;
  if v_dec not in ('VERIFIEE','REJETEE') then perform private.moto_erreur('Décision : VERIFIEE ou REJETEE.'); end if;
  if v_dec = 'VERIFIEE' then
    v_aut := private.moto_total_autorise(f.maintenance_id);
    select coalesce(sum(montant), 0) into v_verif from public.moto_factures where maintenance_id = f.maintenance_id and statut = 'VERIFIEE';
    -- Une facture ne régularise jamais une dépense non autorisée.
    if v_verif + f.montant > v_aut then
      perform private.moto_refus(format('Facture hors autorisation : %s FCFA vérifiés + %s > %s FCFA autorisés par le BM. Rejetez-la ou faites autoriser un supplément.',
        v_verif, f.montant, v_aut));
    end if;
  end if;
  perform private.moto_motif(p_motif, case when v_dec = 'REJETEE' then 10 else 0 end);
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_factures set statut = v_dec, verifie_par = auth.uid(), verifie_at = now(), motif_verification = nullif(btrim(p_motif), '') where id = f.id;
  return jsonb_build_object('id', f.id, 'statut', v_dec);
end $$;

-- Constat de paiement par la Finance : enregistrement d'un fait, aucun transfert déclenché.
create or replace function public.moto_facture_paiement_constater(p_facture uuid, p_montant numeric, p_date date, p_reference text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare f public.moto_factures;
begin
  perform private.moto_exiger_classe(array['FINANCE']);
  select * into f from public.moto_factures where id = p_facture for update;
  if not found or f.statut <> 'VERIFIEE' then perform private.moto_erreur('Seule une facture vérifiée peut être constatée payée.'); end if;
  if p_montant is null or p_montant <= 0 or f.montant_paye + p_montant > f.montant then perform private.moto_erreur('Montant payé invalide (au plus le reste dû).'); end if;
  if p_date is null or p_date > current_date then perform private.moto_erreur('Date de paiement réelle obligatoire.'); end if;
  perform private.moto_motif(p_reference, 3);
  update public.moto_factures set montant_paye = montant_paye + p_montant, paiement_date = p_date, paiement_reference = btrim(p_reference),
         paiement_par = auth.uid() where id = f.id;
  return jsonb_build_object('id', f.id, 'montant_paye', f.montant_paye + p_montant);
end $$;

-- 9.11 Clôture financière (distincte de la clôture technique et de la remise en circulation)
create or replace function public.moto_maintenance_cloturer(p_maintenance uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances;
begin
  perform private.moto_exiger_classe(array['ABM','FINANCE']);
  select * into mt from public.moto_maintenances where id = p_maintenance for update;
  if not found or mt.statut <> 'CONTROLEE' then perform private.moto_erreur('Clôture : les travaux doivent être contrôlés conformes.'); end if;
  if exists (select 1 from public.moto_autorisations where maintenance_id = mt.id and statut = 'EN_ATTENTE') then
    perform private.moto_erreur('Clôture impossible : une demande d''autorisation est en attente.');
  end if;
  if exists (select 1 from public.moto_factures where maintenance_id = mt.id and statut = 'DEPOSEE') then
    perform private.moto_erreur('Clôture impossible : facture non vérifiée.');
  end if;
  if not mt.sans_frais and mt.montant_engage > 0 and not exists (select 1 from public.moto_factures where maintenance_id = mt.id and statut = 'VERIFIEE') then
    perform private.moto_motif(p_motif, 20);   -- engagement sans facture : explication détaillée exigée
  else
    perform private.moto_motif(p_motif, 5);
  end if;
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_maintenances set statut = 'CLOTUREE', cloture_par = auth.uid(), cloture_at = now(), cloture_motif = btrim(p_motif) where id = mt.id;
  return jsonb_build_object('id', mt.id, 'statut', 'CLOTUREE');
end $$;

create or replace function public.moto_maintenance_annuler(p_maintenance uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances;
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  perform private.moto_motif(p_motif, 10);
  select * into mt from public.moto_maintenances where id = p_maintenance for update;
  if not found or mt.statut not in ('DEMANDEE','DIAGNOSTIC','DEVIS_RECU','EN_ATTENTE_BM','REFUSEE','AUTORISEE') then
    perform private.moto_erreur('Annulation impossible après engagement : terminez ou contrôlez le dossier.');
  end if;
  update public.moto_autorisations set statut = 'ANNULEE' where maintenance_id = mt.id and statut = 'EN_ATTENTE';
  update public.moto_maintenances set statut = 'ANNULEE', annule_par = auth.uid(), annule_at = now(), annule_motif = btrim(p_motif) where id = mt.id;
  return jsonb_build_object('id', mt.id, 'statut', 'ANNULEE');
end $$;

-- ---------------------------------------------------------------------
-- 10. Remise en circulation : jamais par une facture ni par une case cochée
-- ---------------------------------------------------------------------
create or replace function public.moto_lever_immobilisation(p_immobilisation uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare im public.moto_immobilisations; v_ctrl public.moto_controles;
begin
  perform private.moto_exiger_classe(array['BM','ZONE']);
  perform private.moto_motif(p_motif, 5);
  select * into im from public.moto_immobilisations where id = p_immobilisation for update;
  if not found or im.fin is not null then perform private.moto_erreur('Immobilisation introuvable ou déjà levée.'); end if;
  if not private.moto_peut_operer(im.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if im.source_type = 'INCIDENT' then perform private.moto_erreur('Cette immobilisation se lève par le circuit de l''incident.'); end if;
  if im.source_type = 'MAINTENANCE' and not exists (select 1 from public.moto_maintenances where id = im.source_id and statut in ('CONTROLEE','CLOTUREE')) then
    perform private.moto_erreur('Levée bloquée : les travaux de maintenance ne sont pas contrôlés conformes.');
  end if;
  perform private.moto_exiger_independance(im.moto_id, 'la levée d''immobilisation');
  if not private.moto_controle_apte_depuis(im.moto_id, im.debut) then
    perform private.moto_erreur('Levée bloquée : un contrôle de remise en service APTE est exigé après l''immobilisation.');
  end if;
  if exists (select 1 from public.moto_actions_correctives where moto_id = im.moto_id and gravite = 'CRITIQUE' and statut in ('OUVERTE','PLANIFIEE','REALISEE')) then
    perform private.moto_erreur('Levée bloquée : une anomalie critique n''est pas encore corrigée et vérifiée.');
  end if;
  select * into v_ctrl from public.moto_controles where moto_id = im.moto_id and type_controle = 'REMISE_EN_SERVICE' and resultat = 'APTE'
     and date_controle >= im.debut order by date_controle desc limit 1;
  if v_ctrl.realise_par = auth.uid() then
    perform private.moto_refus('Séparation des tâches : l''auteur du contrôle de remise en service ne lève pas lui-même l''immobilisation.');
  end if;
  update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = btrim(p_motif) where id = im.id;
  perform private.moto_recalculer_statuts(im.moto_id);
  return jsonb_build_object('id', im.id, 'levee', true);
end $$;

-- Circuit incident : l'étape « dépense autorisée » constate une autorisation BM, elle ne la crée pas.
create or replace function public.moto_incident_avancer(p_incident uuid, p_etape text, p_note text, p_cout numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare i public.moto_incidents; v_classe text; v_cible text := upper(coalesce(p_etape, '')); v_ok boolean; v_immo boolean;
begin
  v_classe := private.moto_exiger_classe(array['BM','ZONE','ABM','LOGISTIQUE']);
  select * into i from public.moto_incidents where id = p_incident for update;
  if not found then perform private.moto_erreur('Incident introuvable.'); end if;
  if not private.moto_peut_operer(i.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  perform private.moto_exiger_independance(i.moto_id, 'cette étape');
  perform private.moto_motif(p_note, 5);
  if p_cout is not null then
    perform private.moto_refus('Aucun montant ne se saisit dans le circuit incident : le coût passe par un dossier de maintenance autorisé par le Branch Manager.');
  end if;
  v_immo := exists (select 1 from public.moto_immobilisations where source_type = 'INCIDENT' and source_id = i.id and fin is null);
  v_ok := case i.etape
    when 'SIGNALE' then v_cible in ('IMMOBILISEE','DIAGNOSTIC') or (v_cible = 'CLOS' and i.gravite <> 'CRITIQUE')
    when 'IMMOBILISEE' then v_cible = 'DIAGNOSTIC'
    when 'DIAGNOSTIC' then v_cible in ('AUTORISATION_DEPENSE','REPARATION','CONTROLE') or (v_cible = 'CLOS' and not v_immo and i.gravite <> 'CRITIQUE')
    when 'AUTORISATION_DEPENSE' then v_cible = 'REPARATION'
    when 'REPARATION' then v_cible = 'CONTROLE'
    when 'CONTROLE' then v_cible = 'REMIS_EN_SERVICE'
    when 'REMIS_EN_SERVICE' then v_cible = 'CLOS'
    else false end;
  if not v_ok then perform private.moto_erreur(format('Transition interdite : %s → %s.', i.etape, v_cible)); end if;
  if v_cible = 'IMMOBILISEE' and not v_immo then
    perform private.moto_ouvrir_immobilisation(i.moto_id, 'Incident '||i.type_incident, 'INCIDENT', i.id);
  end if;
  if v_cible = 'AUTORISATION_DEPENSE' and not exists (
       select 1 from public.moto_autorisations a join public.moto_maintenances mt on mt.id = a.maintenance_id
       where mt.incident_id = i.id and a.statut = 'AUTORISEE') then
    perform private.moto_refus('Aucune autorisation du Branch Manager : soumettez le devis dans un dossier de maintenance lié à cet incident.');
  end if;
  if v_cible = 'REMIS_EN_SERVICE' then
    if not private.moto_controle_apte_depuis(i.moto_id, i.declare_at) then
      perform private.moto_erreur('Remise en service bloquée : contrôle de remise en service APTE obligatoire après l''incident.');
    end if;
    if exists (select 1 from public.moto_maintenances where incident_id = i.id and statut not in ('CONTROLEE','CLOTUREE','ANNULEE','REFUSEE')) then
      perform private.moto_erreur('Remise en service bloquée : les travaux liés à l''incident ne sont pas contrôlés conformes.');
    end if;
    if exists (select 1 from public.moto_actions_correctives where moto_id = i.moto_id and gravite = 'CRITIQUE' and statut in ('OUVERTE','PLANIFIEE','REALISEE')) then
      perform private.moto_erreur('Remise en service bloquée : une anomalie critique n''est pas encore corrigée et vérifiée.');
    end if;
    update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = 'Remise en service après incident'
    where source_type = 'INCIDENT' and source_id = i.id and fin is null;
  end if;
  update public.moto_incidents set etape = v_cible,
         clos_par = case when v_cible = 'CLOS' then auth.uid() else clos_par end,
         clos_at = case when v_cible = 'CLOS' then now() else clos_at end
  where id = i.id;
  insert into public.moto_incident_etapes (incident_id, etape, note) values (i.id, v_cible, btrim(p_note));
  perform private.moto_recalculer_statuts(i.moto_id);
  return jsonb_build_object('id', i.id, 'etape', v_cible);
end $$;

-- ---------------------------------------------------------------------
-- 11. Coûts annexes : actions correctives, enveloppes, pneus
-- ---------------------------------------------------------------------
create or replace function public.moto_action_realiser(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare a public.moto_actions_correctives; v_cout numeric := private.moto_num(p, 'cout_reel');
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE','ZONE']);
  select * into a from public.moto_actions_correctives where id = private.moto_uuid(p, 'action_id') for update;
  if not found or a.statut <> 'PLANIFIEE' then perform private.moto_erreur('Seule une action planifiée peut être déclarée réalisée.'); end if;
  if not private.moto_peut_operer(a.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if nullif(p ->> 'realise_at', '') is null or (p ->> 'realise_at')::date > current_date or (p ->> 'realise_at')::date < a.constat_at::date then
    perform private.moto_erreur('Date de réalisation réelle obligatoire (ni future, ni antérieure au constat).');
  end if;
  if v_cout is not null and v_cout > 0 then
    -- Le coût d'une action corrective est celui d'un dossier autorisé par le BM ; il n'est pas compté une seconde fois.
    if a.maintenance_id is null or private.moto_total_autorise(a.maintenance_id) <= 0 then
      perform private.moto_refus('Coût refusé : rattachez l''action à un dossier de maintenance autorisé par le Branch Manager.');
    end if;
    if v_cout > private.moto_total_autorise(a.maintenance_id) then perform private.moto_refus('Coût supérieur au montant autorisé par le BM.'); end if;
    if nullif(p ->> 'justificatif_path', '') is null then perform private.moto_erreur('Facture ou justificatif obligatoire pour une dépense.'); end if;
  end if;
  if nullif(p ->> 'justificatif_path', '') is not null then
    perform private.moto_stockage_valide(a.moto_id, p ->> 'justificatif_path', array['maintenance','justificatif']);
  end if;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Réalisation d''une action corrective'));
  update public.moto_actions_correctives set statut = 'REALISEE', realise_at = (p ->> 'realise_at')::date, realise_par = auth.uid(),
         cout_reel = v_cout, justificatif_path = nullif(p ->> 'justificatif_path', '')
  where id = a.id;
  return jsonb_build_object('id', a.id, 'statut', 'REALISEE');
end $$;

create or replace function public.moto_depense_declarer(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; e public.moto_enveloppes; v_m numeric := private.moto_num(p, 'montant');
        v_conso numeric; v_id uuid; v_res jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_action uuid := private.moto_uuid(p, 'action_id');
        v_aut uuid := private.moto_uuid(p, 'autorisation_id'); v_nature text; a public.moto_autorisations; v_deja numeric;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_classe(array['LOGISTIQUE','BM','ABM']);
  select * into e from public.moto_enveloppes where id = private.moto_uuid(p, 'enveloppe_id') for update;
  if not found or e.statut <> 'APPROUVEE' then perform private.moto_erreur('Enveloppe introuvable ou non approuvée.'); end if;
  if e.titulaire_id <> auth.uid() then perform private.moto_refus('Seul le titulaire déclare les dépenses de son enveloppe.'); end if;
  if v_m is null or v_m <= 0 then perform private.moto_erreur('Montant obligatoire et positif.'); end if;
  if nullif(p ->> 'date_depense', '') is null or (p ->> 'date_depense')::date > current_date
     or date_trunc('month', (p ->> 'date_depense')::date)::date <> e.periode then
    perform private.moto_erreur('Date de dépense obligatoire, dans le mois de l''enveloppe, pas dans le futur.');
  end if;
  v_nature := coalesce(nullif(upper(p ->> 'nature'), ''),
                       case when v_action is not null or v_aut is not null or e.type_enveloppe = 'ENTRETIEN' then 'MAINTENANCE' else 'SUPERVISION' end);
  if v_nature not in ('SUPERVISION','MAINTENANCE') then perform private.moto_erreur('Nature : SUPERVISION ou MAINTENANCE.'); end if;
  if e.type_enveloppe = 'ENTRETIEN' and v_nature <> 'MAINTENANCE' then perform private.moto_erreur('L''enveloppe d''entretien ne finance que des dépenses de maintenance.'); end if;
  if v_nature = 'SUPERVISION' and (v_action is not null or v_aut is not null) then
    perform private.moto_erreur('Une dépense liée à une réparation est une dépense de maintenance.');
  end if;
  if v_nature = 'MAINTENANCE' then
    -- Une enveloppe approuvée n'est jamais une autorisation : chaque dépense de maintenance cite l'autorisation BM individuelle.
    if v_aut is null then
      perform private.moto_refus('Dépense de maintenance refusée : autorisation individuelle préalable du Branch Manager obligatoire, même sur une enveloppe approuvée.');
    end if;
    a := private.moto_autorisation_valide(v_aut, v_moto);
    v_moto := a.moto_id;
    select coalesce(sum(montant), 0) into v_deja from public.moto_depenses where autorisation_id = a.id and statut <> 'REJETEE';
    if v_deja + v_m > a.montant_autorise then
      perform private.moto_refus(format('Montant supérieur à l''autorisation BM (%s FCFA autorisés, %s déjà déclarés).', a.montant_autorise, v_deja));
    end if;
  end if;
  if v_moto is not null and not exists (select 1 from public.moto_motos where id = v_moto) then perform private.moto_erreur('Moto inconnue.'); end if;
  if v_action is not null and not exists (select 1 from public.moto_actions_correctives where id = v_action) then perform private.moto_erreur('Action corrective inconnue.'); end if;
  select coalesce(sum(montant), 0) into v_conso from public.moto_depenses where enveloppe_id = e.id and statut <> 'REJETEE';
  if v_conso + v_m > e.montant_approuve then
    perform private.moto_erreur(format('Dépassement de l''enveloppe : solde disponible %s FCFA.', e.montant_approuve - v_conso));
  end if;
  if nullif(p ->> 'justificatif_path', '') is not null then perform private.moto_justificatif_depense_valide(p ->> 'justificatif_path'); end if;
  perform private.moto_motif('Déclaration de dépense');
  insert into public.moto_depenses (enveloppe_id, date_depense, montant, objet, moto_id, action_id, justificatif_path, statut, client_op_id, nature, autorisation_id)
  values (e.id, (p ->> 'date_depense')::date, v_m, btrim(coalesce(p ->> 'objet', '')), v_moto, v_action, nullif(p ->> 'justificatif_path', ''),
          case when nullif(p ->> 'justificatif_path', '') is null then 'DECLAREE' else 'JUSTIFIEE' end, v_client, v_nature, v_aut)
  returning id into v_id;
  v_res := jsonb_build_object('id', v_id, 'nature', v_nature, 'statut', case when nullif(p ->> 'justificatif_path', '') is null then 'DECLAREE' else 'JUSTIFIEE' end);
  perform private.moto_op_enregistrer(v_client, 'DEPENSE', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_pneu_creer(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_id uuid; v_aut uuid := private.moto_uuid(p, 'autorisation_id'); a public.moto_autorisations; v_cout numeric := private.moto_num(p, 'cout_achat');
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  if nullif(btrim(p ->> 'code'), '') is null or nullif(btrim(p ->> 'marque'), '') is null or nullif(btrim(p ->> 'dimensions'), '') is null then
    perform private.moto_erreur('Code, marque et dimensions obligatoires.');
  end if;
  if nullif(btrim(p ->> 'date_fabrication'), '') is not null and btrim(p ->> 'date_fabrication') !~ '^[0-9]{4}$' then
    perform private.moto_erreur('Date de fabrication : 4 chiffres du marquage DOT (semaine + année, ex. 2526), ou vide si illisible.');
  end if;
  if coalesce(v_cout, 0) > 0 then
    if v_aut is null then perform private.moto_refus('Achat de pneu payant : autorisation individuelle préalable du Branch Manager obligatoire.'); end if;
    a := private.moto_autorisation_valide(v_aut, null);
    if v_cout + coalesce((select sum(cout_achat) from public.moto_pneus where autorisation_id = a.id), 0)
             + coalesce((select sum(cout) from public.moto_pneu_reparations where autorisation_id = a.id), 0) > a.montant_autorise then
      perform private.moto_refus('Coût supérieur au montant autorisé par le BM.');
    end if;
  end if;
  perform private.moto_motif('Entrée en stock pneu');
  insert into public.moto_pneus (code, marque, modele, dimensions, numero_serie, date_achat, cout_achat, fournisseur, date_fabrication, autorisation_id)
  values (upper(btrim(p ->> 'code')), btrim(p ->> 'marque'), nullif(btrim(p ->> 'modele'), ''), btrim(p ->> 'dimensions'),
          nullif(btrim(p ->> 'numero_serie'), ''), nullif(p ->> 'date_achat', '')::date, v_cout,
          nullif(btrim(p ->> 'fournisseur'), ''), nullif(btrim(p ->> 'date_fabrication'), ''), case when coalesce(v_cout, 0) > 0 then v_aut end)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.moto_pneu_reparation(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_id uuid; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_aut uuid := private.moto_uuid(p, 'autorisation_id');
        v_cout numeric := coalesce(private.moto_num(p, 'cout'), 0); a public.moto_autorisations;
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','LOGISTIQUE']);
  if v_moto is not null and not private.moto_peut_operer(v_moto) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if not exists (select 1 from public.moto_pneus where id = private.moto_uuid(p, 'pneu_id')) then perform private.moto_erreur('Pneu introuvable.'); end if;
  if v_cout > 0 then
    if v_aut is null then perform private.moto_refus('Réparation payante : autorisation individuelle préalable du Branch Manager obligatoire.'); end if;
    a := private.moto_autorisation_valide(v_aut, v_moto);
    if v_cout + coalesce((select sum(cout_achat) from public.moto_pneus where autorisation_id = a.id), 0)
             + coalesce((select sum(cout) from public.moto_pneu_reparations where autorisation_id = a.id), 0) > a.montant_autorise then
      perform private.moto_refus('Coût supérieur au montant autorisé par le BM.');
    end if;
  end if;
  perform private.moto_motif('Réparation pneu');
  insert into public.moto_pneu_reparations (pneu_id, moto_id, date_reparation, compteur_km, cout, description, autorisation_id)
  values (private.moto_uuid(p, 'pneu_id'), v_moto, coalesce(nullif(p ->> 'date_reparation', '')::date, current_date),
          private.moto_num(p, 'compteur_km'), v_cout, btrim(coalesce(p ->> 'description', 'Réparation')), case when v_cout > 0 then v_aut end)
  returning id into v_id;
  update public.moto_pneus set statut = 'EN_STOCK' where id = private.moto_uuid(p, 'pneu_id') and statut = 'EN_REPARATION';
  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------------
-- 12. Stockage : pièces financières de maintenance (finmaint/<moto>/<devis|facture>/…)
-- ---------------------------------------------------------------------
create or replace function private.moto_peut_deposer(p_nom text)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid_ou_null((storage.foldername(p_nom))[1]);
        v_cat text := (storage.foldername(p_nom))[2];
        v_classe text := private.moto_classe();
begin
  if v_classe is null then return false; end if;
  if (storage.foldername(p_nom))[1] = 'depenses' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and v_cat = auth.uid()::text;
  end if;
  if (storage.foldername(p_nom))[1] = 'finmaint' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and (storage.foldername(p_nom))[3] in ('devis','facture')
       and exists (select 1 from public.moto_motos where id = private.moto_uuid_ou_null((storage.foldername(p_nom))[2]));
  end if;
  if v_moto is null then return false; end if;
  if not exists (select 1 from public.moto_motos where id = v_moto) then return false; end if;
  if v_classe in ('BM','ABM') then return true; end if;
  if v_classe = 'LOGISTIQUE' then return v_cat in ('controle','incident','maintenance','photo','justificatif','document'); end if;
  if v_classe = 'ZONE' then return private.moto_peut_operer(v_moto) and v_cat in ('controle','incident','maintenance','photo'); end if;
  if v_classe = 'UNITE' then return private.moto_est_affectataire(v_moto) and v_cat in ('justificatif','incident','photo','controle'); end if;
  return false;
end $$;

-- alter policy (et non drop/create) : modification en place, sans fenêtre sans politique.
alter policy moto_documents_consultation on storage.objects
  using (bucket_id = 'moto-documents'
         and ((private.moto_uuid_ou_null((storage.foldername(name))[1]) is not null
               and private.moto_dans_perimetre(private.moto_uuid_ou_null((storage.foldername(name))[1])))
              or ((storage.foldername(name))[1] = 'depenses'
                  and private.moto_lecture_enveloppe(private.moto_uuid_ou_null((storage.foldername(name))[2])))
              or ((storage.foldername(name))[1] = 'finmaint' and private.moto_lecture_fin_maintenance())));

-- ---------------------------------------------------------------------
-- 13. Synchronisation hors ligne : seule la DEMANDE est acceptée hors ligne
--     (inchangée : liste blanche, aucune opération de décision, d'engagement ni de facture).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 14. RLS, journal
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['moto_modeles_techniques','moto_regles_versions','moto_garages','moto_maintenance_travaux','moto_autorisations','moto_factures'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_journal_trg', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.moto_journaliser()', t || '_journal_trg', t);
  end loop;
end $$;
drop policy if exists moto_modeles_techniques_lecture on public.moto_modeles_techniques;
create policy moto_modeles_techniques_lecture on public.moto_modeles_techniques for select to authenticated using (private.moto_classe() is not null);
drop policy if exists moto_regles_versions_lecture on public.moto_regles_versions;
create policy moto_regles_versions_lecture on public.moto_regles_versions for select to authenticated using (private.moto_classe() is not null);
drop policy if exists moto_garages_lecture on public.moto_garages;
create policy moto_garages_lecture on public.moto_garages for select to authenticated
  using (private.moto_classe() in ('BM','ABM','FINANCE','DIRECTION','LOGISTIQUE','ZONE'));
drop policy if exists moto_maintenance_travaux_lecture on public.moto_maintenance_travaux;
create policy moto_maintenance_travaux_lecture on public.moto_maintenance_travaux for select to authenticated
  using (exists (select 1 from public.moto_maintenances mt where mt.id = maintenance_id and private.moto_dans_perimetre(mt.moto_id)));
-- Pièces et montants financiers : BM, ABM, Finance, Direction, coordinateur.
drop policy if exists moto_autorisations_lecture on public.moto_autorisations;
create policy moto_autorisations_lecture on public.moto_autorisations for select to authenticated using (private.moto_lecture_fin_maintenance());
drop policy if exists moto_factures_lecture on public.moto_factures;
create policy moto_factures_lecture on public.moto_factures for select to authenticated using (private.moto_lecture_fin_maintenance());

-- ---------------------------------------------------------------------
-- 15. Moteur d'échéances : premier seuil atteint (km ou jours), base vérifiée
-- ---------------------------------------------------------------------
drop view if exists public.moto_v_exceptions_bm;
drop view if exists public.moto_v_echeances;
create view public.moto_v_echeances with (security_invoker = on) as
with motos as (
  select m.*,
         (select min(r.compteur_km) from public.moto_releves_km r
           where r.moto_id = m.id and r.date_releve >= m.mise_en_service_at - interval '2 days') as km_mise_en_service,
         (select max(r.date_releve) from public.moto_releves_km r where r.moto_id = m.id) as dernier_releve_at
  from public.moto_motos m
  where m.actif and m.mise_en_service_at is not null
), regles as (
  select mo.id as moto_id, rg.code as regle, rg.libelle,
         -- dernière opération réellement réalisée ET contrôlée conforme
         (select t.id from public.moto_maintenance_travaux t join public.moto_maintenances mt on mt.id = t.maintenance_id
           where mt.moto_id = mo.id and t.operation_code = rg.code and t.statut = 'REALISE' and mt.statut in ('CONTROLEE','CLOTUREE')
           order by mt.date_realisation desc, mt.controle_at desc limit 1) as dernier_travail_id
  from motos mo cross join public.moto_regles_maintenance rg
), choix as (
  select r.*, mo.code, mo.modele_technique_code, mo.origine, mo.mise_en_service_at, mo.km_mise_en_service, mo.compteur_actuel_km, mo.dernier_releve_at,
         dmt.date_realisation as dernier_date, dmt.compteur_km as dernier_km, dmt.id as dernier_dossier_id,
         (select v.id from public.moto_regles_versions v
           where v.regle_code = r.regle and v.statut = 'APPROUVEE' and v.date_effet <= current_date
             and (v.moto_id = r.moto_id or (v.moto_id is null and v.modele_code = mo.modele_technique_code))
             and v.phase = case when r.dernier_travail_id is null
                                     and exists (select 1 from public.moto_regles_versions v2 where v2.regle_code = r.regle and v2.statut = 'APPROUVEE'
                                                 and v2.date_effet <= current_date and v2.phase = 'RODAGE'
                                                 and (v2.moto_id = r.moto_id or (v2.moto_id is null and v2.modele_code = mo.modele_technique_code)))
                                     and mo.origine is distinct from 'EN_EXPLOITATION'
                                then 'RODAGE' else 'RECURRENT' end
           order by (v.moto_id is not null) desc limit 1) as version_id
  from regles r join motos mo on mo.id = r.moto_id
  left join public.moto_maintenance_travaux dt on dt.id = r.dernier_travail_id
  left join public.moto_maintenances dmt on dmt.id = dt.maintenance_id
), base as (
  select c.*, v.phase, v.version, v.nature_source, v.reference_source, v.intervalle_km, v.intervalle_jours,
         v.rappel_avant_km, v.proche_avant_km, v.rappel_avant_jours, v.proche_avant_jours, v.marge_depassement_km, v.marge_depassement_jours,
         (v.moto_id is not null) as exception_moto,
         case when c.dernier_travail_id is not null then c.dernier_km
              when c.origine is distinct from 'EN_EXPLOITATION' then c.km_mise_en_service end as base_km,
         case when c.dernier_travail_id is not null then c.dernier_date
              when c.origine is distinct from 'EN_EXPLOITATION' then c.mise_en_service_at::date end as base_date,
         case when c.dernier_travail_id is not null then 'ENTRETIEN_VERIFIE'
              when c.origine is distinct from 'EN_EXPLOITATION' then 'MISE_EN_SERVICE' end as base_origine
  from choix c left join public.moto_regles_versions v on v.id = c.version_id
), calc as (
  select b.*,
         case when b.intervalle_km is not null and b.base_km is not null then b.base_km + b.intervalle_km end as prochaine_km,
         case when b.intervalle_jours is not null and b.base_date is not null then b.base_date + b.intervalle_jours end as prochaine_date
  from base b
), restes as (
  select c.*,
         case when c.prochaine_km is not null and c.compteur_actuel_km is not null then c.prochaine_km - c.compteur_actuel_km end as km_restants,
         case when c.prochaine_date is not null then c.prochaine_date - current_date end as jours_restants
  from calc c
), niveaux as (
  select r.*,
         case when r.km_restants is null then 0
              when r.km_restants < -r.marge_depassement_km then 5 when r.km_restants <= 0 then 4
              when r.km_restants <= coalesce(r.proche_avant_km, -1) then 3 when r.km_restants <= coalesce(r.rappel_avant_km, -1) then 2 else 1 end as niveau_km,
         case when r.jours_restants is null then 0
              when r.jours_restants < -r.marge_depassement_jours then 5 when r.jours_restants <= 0 then 4
              when r.jours_restants <= coalesce(r.proche_avant_jours, -1) then 3 when r.jours_restants <= coalesce(r.rappel_avant_jours, -1) then 2 else 1 end as niveau_jours
  from restes r
)
select n.moto_id, n.code, n.regle, n.libelle, n.modele_technique_code, n.phase, n.version, n.nature_source as source, n.reference_source, n.exception_moto,
       n.dernier_date as dernier_entretien_date, n.dernier_km as dernier_entretien_km, n.dernier_dossier_id,
       n.base_origine, n.base_km, n.base_date, n.intervalle_km, n.intervalle_jours,
       n.prochaine_km, n.prochaine_date, n.km_restants, n.jours_restants, n.compteur_actuel_km, n.dernier_releve_at,
       case
         -- Modèle inconnu et aucune exception documentée : aucune règle d'un autre modèle n'est appliquée.
         when n.modele_technique_code is null and n.version is null then 'DIAGNOSTIC_INITIAL_REQUIS'
         when n.version is null then 'REGLE_NON_APPROUVEE'
         when n.base_km is null and n.base_date is null then 'ETAT_REFERENCE_REQUIS'
         when n.prochaine_km is null and n.prochaine_date is null then 'NON_CALCULABLE'
         when greatest(n.niveau_km, n.niveau_jours) = 0 then 'NON_CALCULABLE'
         else (array['A_JOUR','RAPPEL','PROCHE','ATTEINTE','DEPASSEE'])[greatest(n.niveau_km, n.niveau_jours)]
       end as statut,
       case when greatest(n.niveau_km, n.niveau_jours) < 2 then null
            when n.niveau_km >= n.niveau_jours then 'KM' else 'JOURS' end as declencheur,
       case
         when n.base_origine is null then 'NON_DISPONIBLE'
         when n.dernier_releve_at is null or n.dernier_releve_at < now() - interval '14 days' then 'KM_ANCIEN'
         when n.base_origine = 'MISE_EN_SERVICE' then 'BASE_MISE_EN_SERVICE'
         else 'VERIFIEE'
       end as fiabilite,
       (select mt.id from public.moto_maintenances mt join public.moto_maintenance_travaux t on t.maintenance_id = mt.id
         where mt.moto_id = n.moto_id and t.operation_code = n.regle and t.statut = 'PREVU'
           and mt.statut not in ('CONTROLEE','CLOTUREE','ANNULEE','REFUSEE') limit 1) as dossier_en_cours_id
from niveaux n;

-- ---------------------------------------------------------------------
-- 16. Vues financières : six montants distincts, aucun double comptage
-- ---------------------------------------------------------------------
create or replace view public.moto_v_maintenance_dossiers with (security_invoker = on) as
select mt.id, mt.moto_id, m.code as moto_code, m.cluster_code, m.zone_code, (select private.moto_nom_profil(af.beneficiaire_id) from public.moto_affectations af where af.moto_id = mt.moto_id and af.statut = 'ACTIVE' and af.type_affectation in ('REMISE','TRANSFERT') limit 1) as utilisateur,
       mt.type_maintenance, mt.statut, mt.description, mt.urgence, mt.incident_id, mt.demande_at, mt.demande_par,
       mt.garage_id, g.nom as garage_nom, g.statut as garage_statut, mt.date_souhaitee, mt.date_prevue, mt.date_fin_prevue,
       mt.date_intervention, mt.date_realisation, mt.sans_frais, mt.controle_resultat, mt.controle_at, mt.cloture_at,
       case when private.moto_lecture_fin_maintenance() then mt.devis_montant end as cout_estime,
       case when private.moto_lecture_fin_maintenance() then (select coalesce(sum(az.montant_autorise), 0) from public.moto_autorisations az where az.maintenance_id = mt.id and az.statut = 'AUTORISEE') end as montant_autorise,
       case when private.moto_lecture_fin_maintenance() then (select sum(montant_demande) from public.moto_autorisations a where a.maintenance_id = mt.id and a.statut = 'EN_ATTENTE') end as montant_en_attente,
       case when private.moto_lecture_fin_maintenance() then mt.montant_engage end as montant_engage,
       case when private.moto_lecture_fin_maintenance() then (select coalesce(sum(montant), 0) from public.moto_factures f where f.maintenance_id = mt.id and f.statut <> 'REJETEE') end as montant_facture,
       case when private.moto_lecture_fin_maintenance() then (select coalesce(sum(montant), 0) from public.moto_factures f where f.maintenance_id = mt.id and f.statut = 'VERIFIEE') end as montant_justifie,
       case when private.moto_lecture_fin_maintenance() then (select coalesce(sum(montant_paye), 0) from public.moto_factures f where f.maintenance_id = mt.id) end as montant_paye,
       (select coalesce(sum(montant), 0) from public.moto_factures f where f.maintenance_id = mt.id and f.statut <> 'REJETEE') > (select coalesce(sum(az.montant_autorise), 0) from public.moto_autorisations az where az.maintenance_id = mt.id and az.statut = 'AUTORISEE') as facture_hors_autorisation,
       (select a.id from public.moto_autorisations a where a.maintenance_id = mt.id and a.statut = 'EN_ATTENTE') as autorisation_en_attente_id,
       (select im.debut from public.moto_immobilisations im where im.source_type = 'MAINTENANCE' and im.source_id = mt.id order by im.debut desc limit 1) as immobilisation_debut,
       (select im.fin from public.moto_immobilisations im where im.source_type = 'MAINTENANCE' and im.source_id = mt.id order by im.debut desc limit 1) as immobilisation_fin,
       (mt.statut in ('PROGRAMMEE','EN_COURS') and mt.date_fin_prevue is not null and mt.date_fin_prevue < current_date) as en_retard,
       (select string_agg(t.operation_code || ':' || t.statut, ', ' order by t.created_at) from public.moto_maintenance_travaux t where t.maintenance_id = mt.id) as travaux
from public.moto_maintenances mt join public.moto_motos m on m.id = mt.moto_id left join public.moto_garages g on g.id = mt.garage_id;

-- Décisions à prendre (Branch Manager)
create or replace view public.moto_v_decisions_bm with (security_invoker = on) as
select a.id as autorisation_id, a.maintenance_id, a.rang, a.objet, a.statut, m.code as moto_code, m.cluster_code,
       (select private.moto_nom_profil(af.beneficiaire_id) from public.moto_affectations af where af.moto_id = a.moto_id and af.statut = 'ACTIVE' and af.type_affectation in ('REMISE','TRANSFERT') limit 1) as utilisateur,
       mt.type_maintenance, mt.description as probleme, a.perimetre as proposition, g.nom as garage_nom, g.statut as garage_statut,
       a.montant_demande, mt.devis_montant, a.devis_path, (select coalesce(sum(az.montant_autorise), 0) from public.moto_autorisations az where az.maintenance_id = a.maintenance_id and az.statut = 'AUTORISEE') as deja_autorise,
       a.justification, a.consequence_report, a.urgence, a.travaux,
       a.soumis_par, private.moto_nom_profil(a.soumis_par) as soumis_par_nom, a.soumis_at,
       a.decide_par, private.moto_nom_profil(a.decide_par) as decide_par_nom, a.decide_at, a.montant_autorise, a.commentaire_decision
from public.moto_autorisations a join public.moto_motos m on m.id = a.moto_id join public.moto_maintenances mt on mt.id = a.maintenance_id
left join public.moto_garages g on g.id = a.garage_id;

-- Garages : prestations, délais réels, montants, répétitions (dérivés, jamais saisis)
create or replace view public.moto_v_garages with (security_invoker = on) as
select g.*,
       (select count(*) from public.moto_maintenances mt where mt.garage_id = g.id and mt.statut in ('TERMINEE','CONTROLEE','CLOTUREE')) as prestations,
       (select round(avg(mt.date_realisation - mt.date_intervention), 1) from public.moto_maintenances mt
         where mt.garage_id = g.id and mt.date_realisation is not null and mt.date_intervention is not null) as delai_moyen_jours,
       (select count(*) from public.moto_maintenances mt where mt.garage_id = g.id and mt.controle_resultat = 'NON_CONFORME') as controles_non_conformes,
       case when private.moto_lecture_fin_maintenance() then (select coalesce(sum(f.montant), 0) from public.moto_factures f where f.garage_id = g.id and f.statut = 'VERIFIEE') end as montant_justifie,
       (select count(*) from (select mt.moto_id from public.moto_maintenances mt join public.moto_maintenance_travaux t on t.maintenance_id = mt.id
                               where mt.garage_id = g.id and t.operation_code = 'REPARATION' and t.statut = 'REALISE'
                                 and mt.date_realisation >= current_date - 90 group by mt.moto_id having count(*) >= 2) x) as motos_reparations_repetees_90j
from public.moto_garages g;

-- Coûts de flotte : le coût de maintenance est celui des factures VÉRIFIÉES (source unique).
-- Les dépenses d'enveloppe, coûts d'actions correctives et coûts de pneus rattachés à une autorisation
-- sont des traces de règlement : ils ne sont pas ajoutés une seconde fois.
create or replace view public.moto_v_couts with (security_invoker = on) as
select m.id as moto_id, m.code, m.mise_en_service_at,
  (select min(r.compteur_km) from public.moto_releves_km r where r.moto_id = m.id and m.mise_en_service_at is not null and r.date_releve >= m.mise_en_service_at - interval '2 days') as km_debut,
  m.compteur_actuel_km as km_fin,
  coalesce((select sum(c.montant) from public.moto_carburant c where c.moto_id = m.id and c.justificatif_statut = 'VERIFIE'), 0) as cout_carburant_verifie,
  coalesce((select sum(c.montant) from public.moto_carburant c where c.moto_id = m.id and c.justificatif_statut = 'A_VERIFIER'), 0) as cout_carburant_a_verifier,
  coalesce((select sum(f.montant) from public.moto_factures f where f.moto_id = m.id and f.statut = 'VERIFIEE'), 0)
    + coalesce((select sum(mt.cout_reel) from public.moto_maintenances mt where mt.moto_id = m.id and mt.statut = 'TERMINEE' and mt.cout_reel is not null
                and not exists (select 1 from public.moto_factures f where f.maintenance_id = mt.id)), 0) as cout_maintenance,
  coalesce((select sum(pr.cout) from public.moto_pneu_reparations pr where pr.moto_id = m.id and pr.autorisation_id is null), 0)
    + coalesce((select sum(pn.cout_achat) from public.moto_pneus pn where pn.autorisation_id is null
                and (select po.moto_id from public.moto_pneu_poses po where po.pneu_id = pn.id order by po.pose_date, po.id limit 1) = m.id), 0) as cout_pneus,
  coalesce((select sum(i.cout_reel) from public.moto_incidents i where i.moto_id = m.id and i.etape = 'CLOS'
            and not exists (select 1 from public.moto_maintenances mt where mt.incident_id = i.id)), 0) as cout_incidents,
  coalesce((select sum(greatest(mt.montant_engage - coalesce((select sum(f.montant) from public.moto_factures f
              where f.maintenance_id = mt.id and f.statut <> 'REJETEE'), 0), 0))
            from public.moto_maintenances mt where mt.moto_id = m.id and mt.statut not in ('ANNULEE','CLOTUREE')), 0) as engage_non_facture,
  coalesce((select sum(f.montant) from public.moto_factures f where f.moto_id = m.id and f.statut = 'DEPOSEE'), 0) as facture_non_justifiee,
  coalesce((select sum(f.montant_paye) from public.moto_factures f where f.moto_id = m.id), 0) as maintenance_payee
from public.moto_motos m where m.actif;

-- Exceptions (synthèse hebdomadaire du Branch Manager) : seulement ce qui demande une attention.
create or replace view public.moto_v_exceptions_bm with (security_invoker = on) as
select 'DECISION_EN_ATTENTE'::text as type, d.moto_code, d.objet || ' : ' || d.proposition as libelle, d.montant_demande as montant, d.soumis_at as depuis
  from public.moto_v_decisions_bm d where d.statut = 'EN_ATTENTE'
union all
select 'FACTURE_HORS_AUTORISATION', x.moto_code, 'Factures supérieures au montant autorisé', x.montant_facture - x.montant_autorise, x.demande_at
  from public.moto_v_maintenance_dossiers x where x.facture_hors_autorisation
union all
select 'FACTURE_NON_VERIFIEE', m.code, 'Facture ' || f.numero_facture || ' en attente de vérification', f.montant, f.depose_at
  from public.moto_factures f join public.moto_motos m on m.id = f.moto_id where f.statut = 'DEPOSEE' and f.depose_at < now() - interval '7 days'
union all
select 'REPARATION_EN_RETARD', x.moto_code, coalesce(x.garage_nom, 'Garage') || ' : date cible ' || x.date_fin_prevue, null, x.date_fin_prevue::timestamptz
  from public.moto_v_maintenance_dossiers x where x.en_retard
union all
select 'IMMOBILISATION_LONGUE', m.code, coalesce(im.motif, 'Immobilisation') || ' (' || (current_date - im.debut::date) || ' jours)', null, im.debut
  from public.moto_immobilisations im join public.moto_motos m on m.id = im.moto_id where im.fin is null and im.debut < now() - interval '7 days'
union all
select 'ECHEANCE_DEPASSEE', e.code, e.libelle || ' dépassée, non prise en charge', null, e.prochaine_date::timestamptz
  from public.moto_v_echeances e where e.statut = 'DEPASSEE' and e.dossier_en_cours_id is null
union all
select 'REFERENCE_A_ETABLIR', e.code, case e.statut when 'DIAGNOSTIC_INITIAL_REQUIS' then 'Diagnostic initial et historique d''entretien à établir' else 'Échéance non calculable : état de référence requis' end,
       null, null::timestamptz
  from (select distinct on (moto_id, statut) * from public.moto_v_echeances where statut in ('DIAGNOSTIC_INITIAL_REQUIS','ETAT_REFERENCE_REQUIS')) e
union all
select 'DEPENSE_NON_JUSTIFIEE', m.code, 'Dépense déclarée sans justificatif depuis plus de 7 jours', d.montant, d.declare_at
  from public.moto_depenses d left join public.moto_motos m on m.id = d.moto_id where d.statut = 'DECLAREE' and d.declare_at < now() - interval '7 days';

do $$
declare v text;
begin
  foreach v in array array['moto_v_echeances','moto_v_maintenance_dossiers','moto_v_decisions_bm','moto_v_garages','moto_v_couts','moto_v_exceptions_bm'] loop
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;
-- Les vues financières ne s'appuient que sur des tables à RLS ; décisions et exceptions : lecture financière seulement.

-- ---------------------------------------------------------------------
-- 17. Droits d'exécution (même règle que les migrations 2 et 5)
-- ---------------------------------------------------------------------
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','private') and p.proname like 'moto\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.nspname = 'public' or f.proname in ('moto_classe','moto_classe_de','moto_est_finance_manager','moto_mon_cluster','moto_ma_zone','moto_mon_nom',
        'moto_est_affectataire','moto_dans_perimetre','moto_lecture_finance','moto_lecture_enveloppe','moto_peut_deposer','moto_uuid_ou_null',
        'moto_nom_profil','moto_param','moto_fenetre','moto_lecture_fin_maintenance') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;

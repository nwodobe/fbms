-- =============================================================================
-- AFLP 2027 · Chantier B · Extension traçable du modèle de consentement
-- Mandat du Branch Manager du 25/10/2026.
--
-- Pourquoi une extension : public.farmer_consents est le registre du
-- CONSENTEMENT AUX TRAITEMENTS DE DONNÉES (périmètres identité, GPS, photos,
-- transactions...). Y inscrire l'accord de participation attesté par le
-- Branch Manager ferait passer une attestation de responsable pour un
-- consentement données du producteur et gonflerait le Farmer Passport.
--
-- Deux notions séparées :
--   1. farmer_participation_attestations : accord de PARTICIPATION à AFLP
--      (preuve producteur documentée OU attestation rétrospective du responsable).
--   2. farmer_notice_deliveries : remise EFFECTIVE de la notice d'information,
--      événement terrain horodaté, saisi par l'agent présent.
--   + aflp_notice_versions : textes versionnés de la notice.
--
-- Aucune politique existante n'est modifiée. Tables nouvelles, additives.
-- Retour arrière : 20261025090000_aflp_accords_participation_notice_rollback.sql
-- =============================================================================

create table if not exists public.aflp_notice_versions (
  version text primary key,
  title text not null,
  body_fr text not null,
  legal_review_status text not null default 'PENDING_LEGAL_REVIEW'
    check (legal_review_status in ('PENDING_LEGAL_REVIEW','APPROVED','RETIRED')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
comment on table public.aflp_notice_versions is
  'Textes versionnés de la notice d''information AFLP remise aux producteurs. Une version PENDING_LEGAL_REVIEW peut être utilisée en pilote mais doit être validée juridiquement avant généralisation.';

create table if not exists public.farmer_participation_attestations (
  id uuid primary key default gen_random_uuid(),
  producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
  attestation_type text not null
    check (attestation_type in ('PRODUCER_DOCUMENTED','MANAGER_RETROSPECTIVE_ATTESTATION')),
  agreement_scope text not null default 'AFLP_PARTICIPATION'
    check (agreement_scope = 'AFLP_PARTICIPATION'),
  declared_agreement_date timestamptz,
  enrollment_date_source text not null
    check (enrollment_date_source in ('OFFLINE_SYNC_RECEIPT_CLIENT_TIMESTAMP','SERVER_INSERT_TIMESTAMP','FIELD_DOCUMENT','UNVERIFIED')),
  enrollment_channel_verified text not null,
  evidence_basis text not null,
  producer_signature_exists boolean not null default false,
  covers_personal_data_consent boolean not null default false,
  statement_version text not null,
  statement_text text not null,
  attested_by uuid not null,
  attested_by_role text,
  attested_at timestamptz not null default clock_timestamp(),
  executed_by_note text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','WITHDRAWN','SUPERSEDED')),
  supersedes_id uuid references public.farmer_participation_attestations(id),
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid default auth.uid(),
  -- Une attestation de responsable n'est JAMAIS une signature ni un consentement données.
  constraint fpa_manager_not_signature_chk check (
    attestation_type <> 'MANAGER_RETROSPECTIVE_ATTESTATION'
    or (producer_signature_exists = false and covers_personal_data_consent = false)
  ),
  -- La date d'accord déclarée n'est renseignée que si sa source est vérifiée.
  constraint fpa_date_source_chk check (
    (enrollment_date_source = 'UNVERIFIED' and declared_agreement_date is null)
    or (enrollment_date_source <> 'UNVERIFIED' and declared_agreement_date is not null)
  ),
  constraint fpa_date_not_after_attestation_chk check (
    declared_agreement_date is null or declared_agreement_date <= attested_at
  )
);
create unique index if not exists fpa_one_active_per_producer
  on public.farmer_participation_attestations(producteur_id) where status = 'ACTIVE';
comment on table public.farmer_participation_attestations is
  'Accord de PARTICIPATION au programme AFLP. Distinct du consentement aux traitements de données (farmer_consents). Une attestation MANAGER_RETROSPECTIVE_ATTESTATION est une déclaration du responsable, pas une signature du producteur. Immuable : une correction crée une nouvelle ligne (supersedes_id).';

create table if not exists public.farmer_notice_deliveries (
  id uuid primary key default gen_random_uuid(),
  producteur_id text not null references public.producteurs(id) on update cascade on delete restrict,
  notice_version text not null references public.aflp_notice_versions(version),
  delivered_at timestamptz not null,
  delivery_method text not null
    check (delivery_method in ('READ_ALOUD','READ_BY_PRODUCER','PRINTED_COPY_HANDED','READ_ALOUD_AND_COPY_HANDED')),
  language text not null default 'FR',
  interpreter_used boolean not null default false,
  producer_questions text,
  producer_acknowledged boolean not null,
  acknowledgement_method text
    check (acknowledgement_method is null or acknowledgement_method in ('VERBAL','SIGNATURE','THUMBPRINT','WITNESSED_VERBAL')),
  witness_name text,
  proof_id uuid references public.preuves(id) on update cascade on delete set null,
  delivered_by uuid not null default auth.uid(),
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  constraint fnd_ack_method_chk check (producer_acknowledged = false or acknowledgement_method is not null),
  constraint fnd_not_future_chk check (delivered_at <= created_at + interval '1 day')
);
comment on table public.farmer_notice_deliveries is
  'Remise EFFECTIVE de la notice d''information à un producteur : événement terrain saisi par l''agent présent. Aucune ligne ne doit être créée rétroactivement sans remise réelle.';

-- Audit générique (farmer_change_log)
drop trigger if exists trg_farmer_registry_audit_fpa on public.farmer_participation_attestations;
create trigger trg_farmer_registry_audit_fpa after insert or update or delete
  on public.farmer_participation_attestations for each row execute function public.farmer_registry_audit_trigger();
drop trigger if exists trg_farmer_registry_audit_fnd on public.farmer_notice_deliveries;
create trigger trg_farmer_registry_audit_fnd after insert or update or delete
  on public.farmer_notice_deliveries for each row execute function public.farmer_registry_audit_trigger();

-- RLS
alter table public.aflp_notice_versions enable row level security;
alter table public.farmer_participation_attestations enable row level security;
alter table public.farmer_notice_deliveries enable row level security;

drop policy if exists aflp_notice_versions_select on public.aflp_notice_versions;
create policy aflp_notice_versions_select on public.aflp_notice_versions
  for select to authenticated using (public.est_actif());

drop policy if exists fpa_select on public.farmer_participation_attestations;
create policy fpa_select on public.farmer_participation_attestations
  for select to authenticated
  using (public.est_actif() and private.farmer_registry_can_access_producteur(producteur_id));

-- Attestation rétrospective : réservée au Branch Manager, en son nom propre.
drop policy if exists fpa_insert on public.farmer_participation_attestations;
create policy fpa_insert on public.farmer_participation_attestations
  for insert to authenticated
  with check (
    attested_by = auth.uid()
    and private.farmer_registry_can_access_producteur(producteur_id)
    and (
      (attestation_type = 'MANAGER_RETROSPECTIVE_ATTESTATION'
        and public.mon_role() in ('Branch Manager','Branch Manager / Head of Programme'))
      or (attestation_type = 'PRODUCER_DOCUMENTED' and private.farmer_registry_can_supervise())
    )
  );
-- Pas de politique UPDATE / DELETE : registre immuable côté API.

drop policy if exists fnd_select on public.farmer_notice_deliveries;
create policy fnd_select on public.farmer_notice_deliveries
  for select to authenticated
  using (public.est_actif() and private.farmer_registry_can_access_producteur(producteur_id));

drop policy if exists fnd_insert on public.farmer_notice_deliveries;
create policy fnd_insert on public.farmer_notice_deliveries
  for insert to authenticated
  with check (
    delivered_by = auth.uid()
    and private.farmer_registry_can_capture()
    and private.farmer_registry_can_access_producteur(producteur_id)
  );

grant select on public.aflp_notice_versions to authenticated;
grant select, insert on public.farmer_participation_attestations to authenticated;
grant select, insert on public.farmer_notice_deliveries to authenticated;
revoke all on public.aflp_notice_versions, public.farmer_participation_attestations, public.farmer_notice_deliveries from anon;

-- Vue de régularisation (sans coordonnée GPS ni donnée d'identité sensible)
create or replace view public.farmer_regularisation_status_v
with (security_invoker = true) as
select
  p.id as producteur_id,
  p.code as farmer_id,
  p.village_id,
  coalesce(p.data->>'source','INCONNUE') as source_enrolement,
  p.deleted,
  p.possible_duplicate,
  p.review_required,
  case
    when exists (select 1 from public.farmer_participation_attestations a
                 where a.producteur_id = p.id and a.status='ACTIVE' and a.attestation_type='PRODUCER_DOCUMENTED')
      then 'DOCUMENTE_PRODUCTEUR'
    when exists (select 1 from public.farmer_participation_attestations a
                 where a.producteur_id = p.id and a.status='ACTIVE' and a.attestation_type='MANAGER_RETROSPECTIVE_ATTESTATION')
      then 'ATTESTATION_RESPONSABLE'
    else 'NON_DOCUMENTE'
  end as accord_participation,
  p.consent_status as consentement_donnees,
  exists (select 1 from public.farmer_notice_deliveries n where n.producteur_id = p.id) as notice_remise,
  (select count(*) from public.farmer_plots fp where fp.producteur_id=p.id and not fp.deleted and fp.status='ACTIVE') as parcelles_actives,
  (select count(*) from public.farmer_plots fp where fp.producteur_id=p.id and not fp.deleted and fp.status='REVIEW_REQUIRED') as parcelles_a_verifier,
  (select count(*) from public.farmer_plots fp where fp.producteur_id=p.id and not fp.deleted and fp.gps_status in ('POINT_CAPTURED','GPS_VERIFIED')) as parcelles_geolocalisees,
  (select count(*) from public.farmer_plots fp where fp.producteur_id=p.id and not fp.deleted and fp.gps_status='GPS_VERIFIED') as parcelles_gps_verifiees,
  p.passport_stage,
  (p.consent_status = 'GRANTED'
    and exists (select 1 from public.farmer_notice_deliveries n where n.producteur_id = p.id and n.producer_acknowledged)) as information_et_consentement_complets
from public.producteurs p;
comment on view public.farmer_regularisation_status_v is
  'Statut de régularisation AFLP par producteur. Une complétude n''est pas une certification. information_et_consentement_complets n''est vrai qu''avec un consentement données GRANTED ET une remise de notice reconnue.';
grant select on public.farmer_regularisation_status_v to authenticated;
revoke all on public.farmer_regularisation_status_v from anon;

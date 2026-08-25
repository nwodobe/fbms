begin;

alter table public.producteurs drop constraint if exists producteurs_phone_format_ck;
alter table public.producteurs add constraint producteurs_phone_format_ck
check (
  deleted
  or telephone is null
  or btrim(telephone) = ''
  or regexp_replace(telephone, '[^0-9]', '', 'g') ~ '^0[0-9]{9}$'
);

alter table public.producteurs drop constraint if exists producteurs_nom_no_html_ck;
alter table public.producteurs add constraint producteurs_nom_no_html_ck
check (
  deleted
  or (
    coalesce(nom,'') !~ '[<>]'
    and coalesce(prenoms,'') !~ '[<>]'
  )
);

insert into public.fbms_data_quality_log(fix_batch, entity_type, entity_id, action, details)
select 'FARMER_PILOT_PREP_20260825', 'producteur', p.id, 'TEST_DATA_SOFT_DELETED',
       jsonb_build_object('farmer_code', p.code, 'reason', 'Dossier de test isole avant pilote Farmer Passport')
from public.producteurs p
where p.deleted and p.code like 'SESSEN-%' and upper(coalesce(p.nom,'')) like 'TEST %'
on conflict do nothing;

commit;

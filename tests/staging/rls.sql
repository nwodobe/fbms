-- FBMS ephemeral staging RLS assertions.
\set ON_ERROR_STOP on

-- Active Agent: can read business data, only own profile, cannot BM-update purchase.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
DO $$
DECLARE n bigint; rc bigint;
BEGIN
  select count(*) into n from public.villages;
  if n < 1 then raise exception 'RLS FAIL: active Agent cannot read villages'; end if;

  select count(*) into n from public.profils;
  if n <> 1 then raise exception 'RLS FAIL: Agent should see exactly own profile in base policy, got %', n; end if;

  update public.achats set observation='TEST_AGENT_SHOULD_NOT_UPDATE' where local_id='TEST_ACHAT_A1';
  GET DIAGNOSTICS rc = ROW_COUNT;
  if rc <> 0 then raise exception 'RLS FAIL: Agent updated achat reserved for BM'; end if;

  insert into public.checkins(id,mission_id,village_id,type,horodatage_client,user_id)
  values ('a0000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000001','TEST_VILLAGE_A1','out',now(),'00000000-0000-0000-0000-000000000003');
END $$;
rollback;

-- Agent cannot forge another user's check-in.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
DO $$
BEGIN
  BEGIN
    insert into public.checkins(id,mission_id,village_id,type,horodatage_client,user_id)
    values ('a0000000-0000-0000-0000-000000000098','20000000-0000-0000-0000-000000000001','TEST_VILLAGE_A1','out',now(),'00000000-0000-0000-0000-000000000004');
    raise exception 'RLS FAIL: Agent forged another user check-in';
  EXCEPTION WHEN insufficient_privilege THEN null;
  END;
END $$;
rollback;

-- Inactive account: business reads must return no rows.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
DO $$
DECLARE n bigint;
BEGIN
  select count(*) into n from public.villages;
  if n <> 0 then raise exception 'RLS FAIL: inactive user can read villages'; end if;
  select count(*) into n from public.achats;
  if n <> 0 then raise exception 'RLS FAIL: inactive user can read achats'; end if;
END $$;
rollback;

-- Supervisor: config-level update is allowed, destructive BM-only delete is not.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
DO $$
DECLARE rc bigint;
BEGIN
  update public.missions set notes='TEST_SUPERVISOR_UPDATE' where id='20000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS rc = ROW_COUNT;
  if rc <> 1 then raise exception 'RLS FAIL: Supervisor could not update mission'; end if;

  delete from public.missions where id='20000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS rc = ROW_COUNT;
  if rc <> 0 then raise exception 'RLS FAIL: Supervisor performed BM-only delete'; end if;
END $$;
rollback;

-- Branch Manager: can read all profiles and perform BM-only update.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE n bigint; rc bigint;
BEGIN
  select count(*) into n from public.profils;
  if n < 5 then raise exception 'RLS FAIL: BM cannot read all test profiles'; end if;

  update public.achats set observation='TEST_BM_UPDATE' where local_id='TEST_ACHAT_A1';
  GET DIAGNOSTICS rc = ROW_COUNT;
  if rc <> 1 then raise exception 'RLS FAIL: BM could not update achat'; end if;
END $$;
rollback;

select 'FBMS_STAGING_RLS_PASS' as status;

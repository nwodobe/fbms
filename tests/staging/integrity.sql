-- FBMS ephemeral staging integrity assertions.
\set ON_ERROR_STOP on

DO $$
DECLARE n bigint;
BEGIN
  select count(*) into n from public.villages where id like 'TEST_%';
  if n < 3 then raise exception 'INTEGRITY FAIL: expected >=3 TEST villages, got %', n; end if;

  select count(*) into n from public.rt where id like 'TEST_%';
  if n < 3 then raise exception 'INTEGRITY FAIL: expected >=3 TEST RT, got %', n; end if;

  select count(*) into n from public.producteurs where id like 'TEST_%';
  if n < 2 then raise exception 'INTEGRITY FAIL: expected >=2 TEST producteurs, got %', n; end if;

  select count(*) into n
  from public.producteurs p left join public.villages v on v.id=p.village_id
  where p.id like 'TEST_%' and v.id is null;
  if n <> 0 then raise exception 'INTEGRITY FAIL: % orphan producteurs/villages', n; end if;

  select count(*) into n
  from public.producteurs p left join public.rt r on r.id=p.rt_id
  where p.id like 'TEST_%' and p.rt_id is not null and r.id is null;
  if n <> 0 then raise exception 'INTEGRITY FAIL: % orphan producteurs/RT', n; end if;

  select count(*) into n
  from public.mission_villages mv
  left join public.missions m on m.id=mv.mission_id
  left join public.villages v on v.id=mv.village_id
  where (m.id is null or v.id is null);
  if n <> 0 then raise exception 'INTEGRITY FAIL: % orphan mission_villages', n; end if;

  select count(*) into n
  from public.checkins c
  left join public.missions m on m.id=c.mission_id
  left join public.villages v on v.id=c.village_id
  where m.id is null or v.id is null;
  if n <> 0 then raise exception 'INTEGRITY FAIL: % orphan checkins', n; end if;

  select count(*) into n
  from public.depenses_mission d
  left join public.missions m on m.id=d.mission_id
  left join public.preuves p on p.id=d.preuve_id
  where m.id is null or (d.preuve_id is not null and p.id is null);
  if n <> 0 then raise exception 'INTEGRITY FAIL: % orphan mission expenses/evidence', n; end if;

  select count(*) into n from public.achats
  where abs(montant - poids_net * prix_kg) > 1;
  if n <> 0 then raise exception 'INTEGRITY FAIL: % incoherent purchase amounts', n; end if;

  select count(*) into n from public.achats
  where commission_rt is not null and abs(commission_rt - poids_net * 10) > 1;
  if n <> 0 then raise exception 'INTEGRITY FAIL: % incoherent RT commissions', n; end if;

  select count(*) into n from public.sacs_mouvements where quantite <= 0;
  if n <> 0 then raise exception 'INTEGRITY FAIL: % invalid bag movements', n; end if;

  select count(*) into n from (
    select local_id from public.achats where local_id is not null group by local_id having count(*) > 1
  ) d;
  if n <> 0 then raise exception 'INTEGRITY FAIL: duplicate achats.local_id'; end if;

  select count(*) into n from (
    select local_id from public.avances where local_id is not null group by local_id having count(*) > 1
  ) d;
  if n <> 0 then raise exception 'INTEGRITY FAIL: duplicate avances.local_id'; end if;

  select count(*) into n from (
    select local_id from public.sacs_mouvements where local_id is not null group by local_id having count(*) > 1
  ) d;
  if n <> 0 then raise exception 'INTEGRITY FAIL: duplicate sacs_mouvements.local_id'; end if;
END $$;

-- Uniqueness/idempotence controls must actually reject duplicates.
DO $$
BEGIN
  BEGIN
    insert into public.achats(local_id,date,poids_net,prix_kg,montant)
    values ('TEST_ACHAT_A1',current_date,1,500,500);
    raise exception 'INTEGRITY FAIL: duplicate achats.local_id accepted';
  EXCEPTION WHEN unique_violation THEN null;
  END;

  BEGIN
    insert into public.avances(local_id,date,montant)
    values ('TEST_ADV_A1',current_date,1);
    raise exception 'INTEGRITY FAIL: duplicate avances.local_id accepted';
  EXCEPTION WHEN unique_violation THEN null;
  END;

  BEGIN
    insert into public.achats(local_id,date,poids_net,prix_kg,montant)
    values ('TEST_BAD_AMOUNT',current_date,100,500,49000);
    raise exception 'INTEGRITY FAIL: incoherent purchase amount accepted';
  EXCEPTION WHEN check_violation THEN null;
  END;
END $$;

-- One OPEN financing cycle per RT.
DO $$
BEGIN
  BEGIN
    insert into public.avances(local_id,date,rt_id,montant,cycle_id,cycle_statut)
    values ('TEST_ADV_SECOND_OPEN',current_date,'TEST_RT_A1',1000,'TEST_CYCLE_SECOND','OPEN');
    raise exception 'INTEGRITY FAIL: second OPEN cycle for RT accepted';
  EXCEPTION WHEN unique_violation THEN null;
  END;
END $$;

select 'FBMS_STAGING_INTEGRITY_PASS' as status;

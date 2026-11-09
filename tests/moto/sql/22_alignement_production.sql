-- AFLP FLEET 22 — alignement de la réplique LOCALE sur la production (relevé du 09/11/2026,
-- lecture seule, pg_get_functiondef). La version du dépôt (migration 8) diffère de la
-- production ; c'est ce déclencheur qui protège la correction directe, on teste donc le vrai.
-- Jamais sur une base Supabase.
CREATE OR REPLACE FUNCTION private.moto_mission_releve_coherence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if new.compteur_km is distinct from old.compteur_km then
    if new.compteur_km < (select max(r.compteur_km) from public.moto_releves_km r where r.moto_id = new.moto_id and r.id <> new.id and r.date_releve <= new.date_releve) then
      raise exception 'Correction refusée : la valeur serait inférieure à un relevé antérieur de la moto (le compteur ne recule pas).' using errcode = 'P0001';
    end if;
    if new.compteur_km > (select min(r.compteur_km) from public.moto_releves_km r where r.moto_id = new.moto_id and r.id <> new.id and r.date_releve > new.date_releve) then
      raise exception 'Correction refusée : la valeur dépasserait un relevé postérieur de la moto.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.moto_missions m where m.depart_releve_id = new.id and m.arrivee_km < new.compteur_km) then
      raise exception 'Correction refusée : le compteur de départ dépasserait celui d''arrivée de la mission.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.moto_missions m where m.arrivee_releve_id = new.id and new.compteur_km < m.depart_km) then
      raise exception 'Correction refusée : le compteur d''arrivée serait inférieur à celui du départ de la mission.' using errcode = 'P0001';
    end if;
    update public.moto_missions set depart_km = new.compteur_km where depart_releve_id = new.id;
    update public.moto_missions set arrivee_km = new.compteur_km where arrivee_releve_id = new.id;
    update public.moto_mission_anomalies set detail = detail || format(' [compteur corrigé ensuite : %s → %s km ; se fier aux chiffres recalculés du tableau]', old.compteur_km, new.compteur_km)
    where statut = 'A_VERIFIER' and moto_id = new.moto_id
      and mission_id in (select id from public.moto_missions where depart_releve_id = new.id or arrivee_releve_id = new.id
                         or (moto_id = new.moto_id and depart_at >= new.date_releve));
  end if;
  return new;
end $function$;

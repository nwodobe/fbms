#!/usr/bin/env bash
# Exécute la migration du suivi OTA sur un PostgreSQL LOCAL jetable (jamais Supabase), avec des doublures
# minimales de auth.uid(), public.profils, public.mon_role() et public.est_actif() copiées de supabase/rls.sql.
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin; D=/tmp/pg-ota; PORT=54391; R="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf $D; mkdir -p $D; chown -R postgres:postgres $D 2>/dev/null || true
run(){ if id postgres >/dev/null 2>&1 && [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$PGBIN/initdb -D $D -U postgres -A trust >/dev/null"
run "$PGBIN/pg_ctl -D $D -o '-p $PORT -k /tmp -c listen_addresses=' -l $D/log -w start >/dev/null"
trap 'run "$PGBIN/pg_ctl -D $D -m immediate stop >/dev/null" || true' EXIT
P="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
$P -d postgres -c "create database ota" 
$P -d ota <<'SQL'
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
create table public.profils (user_id uuid primary key, nom text, role text, cluster text, zone text, actif boolean default true);
create or replace function public.mon_role() returns text language sql stable security definer set search_path = public as $$ select role from public.profils where user_id = auth.uid() and actif = true limit 1 $$;
create or replace function public.est_actif() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.profils where user_id = auth.uid() and actif = true) $$;
insert into public.profils values
 ('00000000-0000-4000-8000-0000000000b1','BM FICTIF','Branch Manager',null,null,true),
 ('00000000-0000-4000-8000-0000000000b2','UH FICTIF','Unit Head','BROBO',null,true),
 ('00000000-0000-4000-8000-0000000000b3','INACTIF FICTIF','Unit Head','BOTRO',null,false),
 ('00000000-0000-4000-8000-0000000000b4','ABM FICTIF','Assistant Branch Manager',null,null,true);
SQL
$P -d ota -f $R/supabase/20261122090000_ota_suivi_installations.sql
$P -d ota -f $R/supabase/20261122090000_ota_suivi_installations.sql   # rejouable sans erreur
ok=0; ko=0
t(){ # libellé, attendu (regex), sql exécuté sous le rôle authenticated avec l'identité donnée
  local lib="$1" att="$2" uid="$3" sql="$4" out
  out=$(psql -h /tmp -p $PORT -U postgres -d ota -X -q -At 2>&1 <<SQL || true
begin; set local role authenticated; select set_config('request.jwt.claim.sub','$uid',true);
$sql
commit;
SQL
)
  out=$(echo "$out" | grep -v "^$uid$" | tr '\n' ' ')
  if echo "$out" | grep -Eq "$att"; then ok=$((ok+1)); echo "RÉUSSI  $lib"; else ko=$((ko+1)); echo "ÉCHOUÉ  $lib — obtenu : $out"; fi
}
UH=00000000-0000-4000-8000-0000000000b2; BM=00000000-0000-4000-8000-0000000000b1; IN=00000000-0000-4000-8000-0000000000b3; ABM=00000000-0000-4000-8000-0000000000b4
I1=11111111-1111-4111-8111-111111111111
PAY="{\"installation_id\":\"$I1\",\"app_id\":\"ci.anagroci.fieldbuying\",\"native_version_name\":\"1.4.2\",\"native_version_code\":9,\"android_release\":\"15\",\"updates_enabled\":true,\"channel\":\"stable\",\"web_active_sequence\":1795239403,\"web_active_version\":\"2026.11.21-0536.2420346\",\"web_active_origin\":\"OTA\",\"ota_latest_sequence\":1795239403,\"phase\":\"a_jour\",\"last_check_at\":\"2026-11-21T10:00:00Z\",\"last_activation_at\":\"2026-11-21T09:00:00Z\",\"queue_open\":0}"
t "SQL-01 Un agent actif signale son installation" "RECU" $UH "select public.ota_installation_signaler('$PAY'::jsonb)->>'statut';"
t "SQL-02 Compte, rôle et cluster relus dans profils (pas ceux envoyés par le téléphone)" "UH FICTIF\|Unit Head\|BROBO\|1" $BM "select compte_nom||'|'||role||'|'||cluster||'|'||signalements from public.app_installations;"
t "SQL-03 Second signalement : même ligne mise à jour (pas de doublon), compteur à 2" "1\|2" $UH "select public.ota_installation_signaler('$PAY'::jsonb)->>'x'; set local role postgres; select count(*)||'|'||max(signalements) from public.app_installations;"
t "SQL-04 Une activation constatée n'est pas effacée par un signalement sans date d'activation" "2026-11-21 09" $UH "select public.ota_installation_signaler(('$PAY'::jsonb - 'last_activation_at'))->>'x'; set local role postgres; select last_activation_at at time zone 'UTC' from public.app_installations;"
t "SQL-05 Compte inactif : refusé" "Compte inactif" $IN "select public.ota_installation_signaler('$PAY'::jsonb);"
t "SQL-06 Sans session : refusé" "Accès refusé|invalid input" "" "select public.ota_installation_signaler('$PAY'::jsonb);"
t "SQL-07 Identifiant illisible : refusé" "illisible" $UH "select public.ota_installation_signaler('{\"installation_id\":\"IMEI-123\",\"app_id\":\"ci.anagroci.fieldbuying\"}'::jsonb);"
t "SQL-08 Autre application : refusée" "non suivie" $UH "select public.ota_installation_signaler('{\"installation_id\":\"$I1\",\"app_id\":\"autre.app\"}'::jsonb);"
t "SQL-09 Date dans le futur (horloge déréglée) : ignorée, pas enregistrée" "(^| )t " $UH "select public.ota_installation_signaler(jsonb_set('$PAY'::jsonb,'{last_check_at}','\"2099-01-01T00:00:00Z\"'))->>'x'; set local role postgres; select last_check_at is null from public.app_installations;"
t "SQL-10 Valeurs non numériques ou trop longues : neutralisées sans erreur" "RECU" $UH "select public.ota_installation_signaler(jsonb_set(jsonb_set('$PAY'::jsonb,'{native_version_code}','\"abc\"'),'{last_error}',to_jsonb(repeat('x',5000))))->>'statut';"
t "SQL-11 Erreur tronquée à 300 caractères ; code de version illisible → vide" "300\|true" $BM "select length(last_error)||'|'||(native_version_code is null) from public.app_installations;"
t "SQL-12 RLS : un Chef d'Unité ne lit AUCUNE installation (table)" "^0 " $UH "select count(*) from public.app_installations;"
t "SQL-13 RLS : un Chef d'Unité ne lit AUCUNE installation (vue)" "^0 " $UH "select count(*) from public.ota_installations_v;"
t "SQL-14 RLS : le Branch Manager lit la vue" "^1 " $BM "select count(*) from public.ota_installations_v;"
t "SQL-15 RLS : l'Assistant Branch Manager lit la vue" "^1 " $ABM "select count(*) from public.ota_installations_v;"
t "SQL-16 Écriture directe interdite : insert" "permission denied" $BM "insert into public.app_installations (installation_id, app_id, user_id) values (gen_random_uuid(), 'ci.anagroci.fieldbuying', '$BM');"
t "SQL-17 Écriture directe interdite : update (faux accusé de mise à jour impossible)" "permission denied" $BM "update public.app_installations set web_active_sequence = 9999999999;"
t "SQL-18 Écriture directe interdite : delete" "permission denied" $BM "delete from public.app_installations;"
t "SQL-19 La vue n'expose pas l'identifiant du compte" "^0 " $BM "set local role postgres; select count(*) from information_schema.columns where table_name='ota_installations_v' and column_name='user_id';"
out=$(psql -h /tmp -p $PORT -U postgres -d ota -X -q -At -c "begin; set local role anon; select count(*) from public.ota_installations_v;" 2>&1 || true)
if echo "$out" | grep -q "permission denied"; then ok=$((ok+1)); echo "RÉUSSI  SQL-20 Rôle anonyme : aucune lecture"; else ko=$((ko+1)); echo "ÉCHOUÉ  SQL-20 — $out"; fi
$P -d ota -f $R/supabase/20261122090100_ota_suivi_installations_rollback.sql
n=$(psql -h /tmp -p $PORT -U postgres -d ota -X -q -At -c "select count(*) from pg_class where relname in ('app_installations','ota_installations_v') union all select count(*) from pg_proc where proname='ota_installation_signaler' union all select count(*) from public.profils")
if [ "$(echo $n)" = "0 0 4" ]; then ok=$((ok+1)); echo "RÉUSSI  SQL-21 Retour arrière : objets du suivi supprimés, table profils intacte"; else ko=$((ko+1)); echo "ÉCHOUÉ  SQL-21 — $n"; fi
echo; echo "Suivi OTA (SQL, PostgreSQL local) : $((ok+ko)) tests, $ok réussis, $ko échoués."
[ $ko = 0 ]

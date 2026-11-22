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
create schema private;
create table public.profils (user_id uuid primary key, nom text, role text, cluster text, zone text, actif boolean default true);
create table public.aflp_clusters (code text primary key, label text, zone_code text);
create table public.aflp_zones (code text primary key, label text);
insert into public.aflp_zones values ('GBEKE_1','Gbêkê 1'),('GBEKE_2','Gbêkê 2');
insert into public.aflp_clusters values ('BROBO','Brobo','GBEKE_1'),('SAKASSOU','Sakassou','GBEKE_1'),('BOTRO','Botro','GBEKE_2'),('BEOUMI','Béoumi','GBEKE_2');
grant usage on schema private to authenticated;
create or replace function public.mon_role() returns text language sql stable security definer set search_path = public as $$ select role from public.profils where user_id = auth.uid() and actif = true limit 1 $$;
create or replace function public.est_actif() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.profils where user_id = auth.uid() and actif = true) $$;
insert into public.profils values
 ('00000000-0000-4000-8000-0000000000b1','BM FICTIF','Branch Manager',null,null,true),
 ('00000000-0000-4000-8000-0000000000b2','UH FICTIF','Unit Head','BROBO',null,true),
 ('00000000-0000-4000-8000-0000000000b3','INACTIF FICTIF','Unit Head','BOTRO',null,false),
 ('00000000-0000-4000-8000-0000000000b4','ABM FICTIF','Assistant Branch Manager',null,null,true),
 ('00000000-0000-4000-8000-0000000000b5','ZH1 FICTIF','Zonal Head',null,'GBEKE_1',true),
 ('00000000-0000-4000-8000-0000000000b6','ZH2 FICTIF','Zonal Head',null,'GBEKE_2',true),
 ('00000000-0000-4000-8000-0000000000b7','UH BOTRO FICTIF','Unit Head','Botro',null,true),
 ('00000000-0000-4000-8000-0000000000b8','AUH BROBO FICTIF','Assistant Unit Head','BROBO','GBEKE_1',true),
 ('00000000-0000-4000-8000-0000000000b9','UH SAKASSOU FICTIF','Unit Head','SAKASSOU',null,true);
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
  out=$(echo "$out" | { grep -v "^$uid$" || true; } | tr '\n' ' ')   # résultat vide : un échec lisible, pas un arrêt du script
  if echo "$out" | grep -Eq "$att"; then ok=$((ok+1)); echo "RÉUSSI  $lib"; else ko=$((ko+1)); echo "ÉCHOUÉ  $lib — obtenu : $out"; fi
}
UH=00000000-0000-4000-8000-0000000000b2; BM=00000000-0000-4000-8000-0000000000b1; IN=00000000-0000-4000-8000-0000000000b3; ABM=00000000-0000-4000-8000-0000000000b4
I1=11111111-1111-4111-8111-111111111111
PAY="{\"installation_id\":\"$I1\",\"app_id\":\"ci.anagroci.fieldbuying\",\"native_version_name\":\"1.4.2\",\"native_version_code\":9,\"android_release\":\"15\",\"updates_enabled\":true,\"channel\":\"stable\",\"web_active_sequence\":1795239403,\"web_active_version\":\"2026.11.21-0536.2420346\",\"web_active_origin\":\"OTA\",\"ota_latest_sequence\":1795239403,\"phase\":\"a_jour\",\"last_check_at\":\"2026-11-21T10:00:00Z\",\"last_activation_at\":\"2026-11-21T09:00:00Z\",\"queue_open\":0}"
ZH1=00000000-0000-4000-8000-0000000000b5; ZH2=00000000-0000-4000-8000-0000000000b6; UHB=00000000-0000-4000-8000-0000000000b7; AUH=00000000-0000-4000-8000-0000000000b8; UHS=00000000-0000-4000-8000-0000000000b9
I2=22222222-2222-4222-8222-222222222222; I3=33333333-3333-4333-8333-333333333333
P2=$(echo "$PAY" | sed "s/$I1/$I2/"); P3=$(echo "$PAY" | sed "s/$I1/$I3/")
recul(){ psql -h /tmp -p $PORT -U postgres -d ota -X -q -c "update public.app_installations set last_seen_at = last_seen_at - interval '1 minute'" >/dev/null; }
t "SQL-01 Un Chef d'Unité actif (BROBO) signale son installation" "RECU" $UH "select public.ota_installation_signaler('$PAY'::jsonb)->>'statut';"
t "SQL-02 Compte, rôle, cluster canonique et zone RELUS côté serveur" "UH FICTIF\|Unit Head\|BROBO\|GBEKE_1\|1" $BM "select compte_nom||'|'||role||'|'||cluster||'|'||zone||'|'||signalements from public.app_installations;"
t "SQL-03 Signalement répété dans les 30 s : ignoré (anti-rafale), aucune écriture" "IGNORE" $UH "select public.ota_installation_signaler('$PAY'::jsonb)->>'statut';"
recul
t "SQL-04 Après 30 s : même ligne mise à jour (pas de doublon), compteur à 2" "1\|2" $UH "select public.ota_installation_signaler('$PAY'::jsonb)->>'x'; set local role postgres; select count(*)||'|'||max(signalements) from public.app_installations;"
recul
t "SQL-05 Une activation constatée n'est pas effacée par un signalement sans date" "2026-11-21 09" $UH "select public.ota_installation_signaler(('$PAY'::jsonb - 'last_activation_at'))->>'x'; set local role postgres; select last_activation_at at time zone 'UTC' from public.app_installations;"
t "SQL-06 Compte inactif : refusé" "Compte inactif" $IN "select public.ota_installation_signaler('$PAY'::jsonb);"
t "SQL-07 Sans session : refusé" "Accès refusé|invalid input" "" "select public.ota_installation_signaler('$PAY'::jsonb);"
t "SQL-08 Identifiant illisible (ex. IMEI) : refusé" "illisible" $UH "select public.ota_installation_signaler('{\"installation_id\":\"IMEI-123\",\"app_id\":\"ci.anagroci.fieldbuying\"}'::jsonb);"
t "SQL-09 Autre application : refusée" "non suivie" $UH "select public.ota_installation_signaler('{\"installation_id\":\"$I1\",\"app_id\":\"autre.app\"}'::jsonb);"
recul
t "SQL-10 Date dans le futur (horloge déréglée) : ignorée" "(^| )t " $UH "select public.ota_installation_signaler(jsonb_set('$PAY'::jsonb,'{last_check_at}','\"2099-01-01T00:00:00Z\"'))->>'x'; set local role postgres; select last_check_at is null from public.app_installations;"
recul
t "SQL-11 Valeurs illisibles ou trop longues : neutralisées sans erreur" "RECU" $UH "select public.ota_installation_signaler(jsonb_set(jsonb_set('$PAY'::jsonb,'{native_version_code}','\"abc\"'),'{last_error}',to_jsonb(repeat('x',5000))))->>'statut';"
t "SQL-12 Erreur tronquée à 300 caractères ; version illisible → vide" "300\|true" $BM "select length(last_error)||'|'||(native_version_code is null) from public.app_installations;"
t "SQL-13 Chef d'Unité BOTRO (cluster écrit « Botro ») signale : cluster canonique BOTRO, zone GBEKE_2" "RECU" $UHB "select public.ota_installation_signaler('$P2'::jsonb)->>'statut';"
t "SQL-14 Assistant BROBO signale son appareil" "RECU" $AUH "select public.ota_installation_signaler('$P3'::jsonb)->>'statut';"
t "SQL-15 Périmètres enregistrés : BROBO/GBEKE_1, BOTRO/GBEKE_2, BROBO/GBEKE_1" "BOTRO.GBEKE_2" $BM "select string_agg(cluster||'/'||zone, ',' order by installation_id) from public.app_installations;"
t "SQL-16 Branch Manager : voit les 3 installations" "^3 " $BM "select count(*) from public.ota_installations_v;"
t "SQL-17 Assistant BM : voit les 3" "^3 " $ABM "select count(*) from public.ota_installations_v;"
t "SQL-18 Chef de Zone GBEKE_1 : voit les 2 de sa zone, pas BOTRO" "^2\|0 " $ZH1 "select count(*)||'|'||count(*) filter (where cluster='BOTRO') from public.ota_installations_v;"
t "SQL-19 Chef de Zone GBEKE_2 : voit seulement BOTRO" "^1\|BOTRO " $ZH2 "select count(*)||'|'||max(cluster) from public.ota_installations_v;"
t "SQL-20 Chef d'Unité BROBO : voit son cluster (son appareil + l'assistant)" "^2 " $UH "select count(*) from public.ota_installations_v;"
t "SQL-21 Chef d'Unité SAKASSOU sans appareil : ne voit rien" "^0 " $UHS "select count(*) from public.ota_installations_v;"
t "SQL-22 Assistant (agent) : voit uniquement son propre appareil, marqué comme tel" "^1\|true" $AUH "select count(*)||'|'||bool_and(mon_appareil) from public.ota_installations_v;"
t "SQL-23 Écriture directe interdite : insert" "permission denied" $BM "insert into public.app_installations (installation_id, app_id, user_id) values (gen_random_uuid(), 'ci.anagroci.fieldbuying', '$BM');"
t "SQL-24 Écriture directe interdite : update (aucun faux accusé de mise à jour)" "permission denied" $AUH "update public.app_installations set web_active_sequence = 9999999999;"
t "SQL-25 Écriture directe interdite : delete" "permission denied" $BM "delete from public.app_installations;"
t "SQL-26 La vue n'expose pas l'identifiant du compte" "^0 " $BM "set local role postgres; select count(*) from information_schema.columns where table_name='ota_installations_v' and column_name='user_id';"
t "SQL-27 Plafond : au-delà de 10 installations actives, une 11e est refusée" "Trop d" $AUH "select public.ota_installation_signaler(jsonb_set('$PAY'::jsonb,'{installation_id}',to_jsonb(gen_random_uuid()::text))) from generate_series(1,11);"
t "SQL-28 Purge : refusée à un Chef de Zone" "Réservé au Branch Manager" $ZH1 "select public.ota_installations_purger(180);"
t "SQL-29 Purge : délai minimal 90 jours" "minimal" $BM "select public.ota_installations_purger(30);"
t "SQL-30 Purge : seules les installations muettes depuis plus de 180 jours partent" "^1\|" $BM "set local role postgres; update public.app_installations set last_seen_at = now() - interval '200 days' where installation_id='$I2'; set local role authenticated; select public.ota_installations_purger(180)||'|';"
# ---- Tests négatifs de sécurité (audit du 22/11/2026) : détournement d'une installation dont on connaît l'identifiant.
# $I1 appartient au Chef d'Unité BROBO. L'assistant de BROBO puis le Chef d'Unité de BOTRO signalent avec CE MÊME identifiant.
recul
t "SQL-33 Usurpation : un autre compte signale avec l'identifiant d'autrui, accepté seulement comme SA propre ligne" "RECU" $UHB "select public.ota_installation_signaler(jsonb_set(jsonb_set('$PAY'::jsonb,'{web_active_sequence}','1'),'{web_active_version}','\"FALSIFIE\"'))->>'statut';"
t "SQL-34 Usurpation : la ligne du propriétaire garde son compte, son cluster et ses versions" "^UH FICTIF\|BROBO\|false " $BM "set local role postgres; select compte_nom||'|'||cluster||'|'||(web_active_version='FALSIFIE') from public.app_installations where installation_id='$I1' and user_id='$UH';"
t "SQL-35 Usurpation : le propriétaire voit toujours son appareil" "^1 " $UH "select count(*) from public.ota_installations_v where installation_id='$I1' and mon_appareil;"
t "SQL-36 Usurpation : la ligne de l'usurpateur reste dans SON périmètre (BOTRO), sous SON nom" "^UH BOTRO FICTIF\|BOTRO " $BM "set local role postgres; select compte_nom||'|'||cluster from public.app_installations where installation_id='$I1' and user_id='$UHB';"
t "SQL-37 Appareil partagé : signalé comme tel au pilotage (2 comptes sur le même identifiant)" "^2\|true " $BM "select count(*)||'|'||bool_and(appareil_partage) from public.ota_installations_v where installation_id='$I1';"
t "SQL-38 Appareil partagé : le Chef d'Unité BROBO ne voit pas la ligne BOTRO" "^0 " $UH "select count(*) from public.ota_installations_v where installation_id='$I1' and cluster='BOTRO';"
t "SQL-39 Anti-rafale par compte : le signalement d'un tiers ne bloque pas celui du propriétaire" "RECU" $UH "select public.ota_installation_signaler('$PAY'::jsonb)->>'statut';"
t "SQL-40 Fonctions de périmètre : non appelables par l'API (schéma private), ni par anon" "^false\|false " $BM "set local role postgres; select has_function_privilege('anon','private.ota_mon_cluster()','execute')||'|'||has_function_privilege('anon','public.ota_installation_signaler(jsonb)','execute');"
t "SQL-41 Table : aucun droit d'écriture pour authenticated ni anon" "^false\|false\|false\|false " $BM "set local role postgres; select has_table_privilege('authenticated','public.app_installations','insert')||'|'||has_table_privilege('authenticated','public.app_installations','update')||'|'||has_table_privilege('authenticated','public.app_installations','delete')||'|'||has_table_privilege('anon','public.app_installations','select');"
t "SQL-42 Purge : appelable par le seul Branch Manager, jamais par anon" "^f " $BM "set local role postgres; select has_function_privilege('anon','public.ota_installations_purger(integer)','execute');"
out=$(psql -h /tmp -p $PORT -U postgres -d ota -X -q -At -c "begin; set local role anon; select count(*) from public.ota_installations_v;" 2>&1 || true)
if echo "$out" | grep -q "permission denied"; then ok=$((ok+1)); echo "RÉUSSI  SQL-31 Rôle anonyme : aucune lecture"; else ko=$((ko+1)); echo "ÉCHOUÉ  SQL-31 — $out"; fi
$P -d ota -f $R/supabase/20261122090100_ota_suivi_installations_rollback.sql
n=$(psql -h /tmp -p $PORT -U postgres -d ota -X -q -At -c "select count(*) from pg_class where relname in ('app_installations','ota_installations_v') union all select count(*) from pg_proc where proname='ota_installation_signaler' union all select count(*) from public.profils union all select count(*) from pg_proc where proname in ('ota_mon_cluster','ota_ma_zone','ota_installations_purger')")
if [ "$(echo $n)" = "0 0 9 0" ]; then ok=$((ok+1)); echo "RÉUSSI  SQL-32 Retour arrière : objets du suivi supprimés, table profils intacte"; else ko=$((ko+1)); echo "ÉCHOUÉ  SQL-32 — $n"; fi
echo; echo "Suivi OTA (SQL, PostgreSQL local) : $((ok+ko)) tests, $ok réussis, $ko échoués."
[ $ko = 0 ]

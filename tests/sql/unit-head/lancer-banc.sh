#!/usr/bin/env bash
# Banc isolé Unit Head : PostgreSQL local jetable, aucune connexion à la production.
# Usage : PGBIN=/usr/lib/postgresql/16/bin bash tests/sql/unit-head/lancer-banc.sh
set -euo pipefail
D=$(mktemp -d); PORT=${PORT:-55440}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
"$BIN/initdb" -D "$D" -A trust -U postgres >/dev/null
"$BIN/pg_ctl" -D "$D" -o "-p $PORT -k $D" -l "$D/log" start >/dev/null
trap '"$BIN/pg_ctl" -D "$D" stop >/dev/null; rm -rf "$D"' EXIT
P="psql -h $D -p $PORT -U postgres -X -q -v ON_ERROR_STOP=1"
R=$(dirname "$0"); M=$(cd "$R/../../.." && pwd)/docs/securite
$P -d postgres -c "create database banc" >/dev/null
$P -d banc -f "$R/00_reproduction_production.sql" >/dev/null
$P -d banc -f "$R/01_offline_sync_batch_production.sql" >/dev/null
phase(){ $P -d banc -v phase="$1" -f "$R/02_banc_scenarios.sql" >/dev/null; }
mig(){ $P -d banc -f "$M/$1" >/dev/null 2>&1; }
phase AVANT                                                   # état de production actuel
mig 20261016_unit_head_village_cluster_scope.sql;  phase CLUSTER
mig 20261016_prefixe_farmer_id_nouveaux_villages.sql; phase FARMERID
mig 20261016_producteurs_gps_perimetre.sql;        phase GPS
mig 20261016_rt_insert_cluster_scope_PREPARE.sql;  phase RT
# Réexécution : les trois migrations doivent être sûres une seconde fois.
mig 20261016_unit_head_village_cluster_scope.sql; mig 20261016_prefixe_farmer_id_nouveaux_villages.sql; mig 20261016_producteurs_gps_perimetre.sql
phase REJEU
$P -d banc -c "select phase, statut, count(*) from zz_resultats group by 1,2 order by 1,2"
OUT=${OUT:-$R/resultats-derniere-execution.txt}
$P -d banc -c "select id, attendu,
  max(case when phase='AVANT' then statut end) avant, max(case when phase='CLUSTER' then statut end) cluster,
  max(case when phase='FARMERID' then statut end) farmerid, max(case when phase='GPS' then statut end) gps,
  max(case when phase='RT' then statut end) rt, max(case when phase='REJEU' then statut end) rejeu,
  left(max(case when phase='AVANT' then obtenu end),55) obtenu_avant, left(max(case when phase='REJEU' then obtenu end),55) obtenu_final
  from zz_resultats group by id, attendu order by id" > "$OUT"
FAIL=$($P -d banc -tA -c "select count(*) from zz_resultats where phase in ('RT','REJEU') and statut='FAIL'")
[ "$FAIL" = "0" ] || { echo "ÉCHEC : $FAIL scénario(s) en phase finale"; exit 1; }
echo "BANC OK"

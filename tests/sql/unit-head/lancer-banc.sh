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
$P -d banc -v phase=AVANT -f "$R/02_banc_scenarios.sql" >/dev/null
$P -d banc -f "$M/20261016_unit_head_village_cluster_scope.sql" >/dev/null 2>&1
$P -d banc -v phase=APRES -f "$R/02_banc_scenarios.sql" >/dev/null
$P -d banc -f "$M/20261016_prefixe_farmer_id_nouveaux_villages.sql" >/dev/null 2>&1
$P -d banc -v phase=PREFIXE -f "$R/02_banc_scenarios.sql" >/dev/null
$P -d banc -c "select phase, statut, count(*) from zz_resultats group by 1,2 order by 1,2"
FAIL=$($P -d banc -tA -c "select count(*) from zz_resultats where phase='PREFIXE' and statut='FAIL'")
[ "$FAIL" = "0" ] || { echo "ÉCHEC : $FAIL scénario(s) en phase finale"; exit 1; }
echo "BANC OK"

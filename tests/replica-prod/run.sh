#!/usr/bin/env bash
# Rejoue la réplique isolée : socle, schéma extrait, données fictives, migrations, simulations.
# Usage : PGHOST=... PGPORT=... PGUSER=postgres tests/replica-prod/run.sh [base]
set -euo pipefail
DB=${1:-rt_sop_replica}
cd "$(dirname "$0")/../.."
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run(){ echo "== $1"; psql -q -X -v ON_ERROR_STOP=${STOP:-1} -d "$DB" -f "$1"; }
run tests/replica-prod/00_supabase_stubs.sql
run tests/replica-prod/01_schema_production_extrait.sql
run tests/replica-prod/02_donnees_fictives.sql
MIG="supabase/2026111218*_rt_sop_*.sql"; [ "${AVANT_CORRECTIONS:-0}" = 1 ] || MIG="$MIG supabase/2026111219*_rt_sop_*.sql"
for m in $(ls $MIG 2>/dev/null | sort); do run "$m"; done
for t in $(ls tests/replica-prod/1*_*.sql 2>/dev/null | sort); do run "$t"; done
tests/replica-prod/20_concurrence.sh "$DB"
psql -X -d "$DB" -c "select statut, count(*) from t.results group by 1 order by 1"

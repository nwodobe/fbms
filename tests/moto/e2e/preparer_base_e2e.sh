#!/usr/bin/env bash
# Base LOCALE vierge pour la démonstration de bout en bout (jamais Supabase).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; RACINE="$DIR/../../.."
: "${PGHOST:?}"; : "${PGPORT:?}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
DB="${1:-fbms_moto_e2e}"
"$RACINE/tests/sql/construire_replica.sh" "$DB" >/dev/null
P="psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q"
$P -f "$RACINE/tests/moto/sql/00_complements_replica.sql" >/dev/null
$P -f "$RACINE/supabase/20260925224332_aflp_data_1_referentiels_incidents.sql" 2>&1 | grep -v NOTICE || true
for f in 20261031090000_aflp_moto_manager_1_schema_securite 20261031090100_aflp_moto_manager_2_rpc 20261031090200_aflp_moto_manager_3_vues_kpi 20261031090400_aflp_moto_manager_4_search_path 20261101090000_aflp_fleet_5_coordination_inspections 20261102090000_aflp_fleet_6_maintenance_autorisations 20261103090000_aflp_fleet_7_permis_carnet; do
  $P -f "$RACINE/supabase/$f.sql" 2>&1 | grep -v NOTICE || true
done
# Alignement sur la production : jit = off sur Supabase (vérifié le 31/10/2026).
psql -U postgres -d postgres -q -c "alter database $DB set jit = off"
echo "Base $DB prête."

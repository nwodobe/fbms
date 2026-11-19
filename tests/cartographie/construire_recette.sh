#!/usr/bin/env bash
# CARTOGRAPHIE DES PARCELLES — construit la base de recette LOCALE (jamais Supabase) :
# staging fidèle à la production (13/11/2026) + Observatoire 1 à 6 + cartographie 1 à 3.
# Usage : PGHOST=/tmp PGPORT=54329 ./tests/cartographie/construire_recette.sh [base] [sans_carto]
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; RACINE="$DIR/../.."; DB="${1:-fbms_carto}"
: "${PGHOST:?PGHOST requis}"; : "${PGPORT:?PGPORT requis}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
"$RACINE/tests/observatoire/staging/construire_staging.sh" "$DB" >/dev/null
P="psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q"
for f in 20261113100000_aflp_observatoire_1_schema 20261113100100_aflp_observatoire_2_securite 20261113100200_aflp_observatoire_3_rpc_sync \
         20261113100300_aflp_observatoire_4_vues_pilote 20261119120000_aflp_observatoire_5_fiabilisation 20261120080000_aflp_observatoire_6_point_gps; do
  $P -f "$RACINE/supabase/$f.sql" >/dev/null 2>&1 || { $P -f "$RACINE/supabase/$f.sql"; exit 3; }
done
if [ "${2:-}" != "sans_carto" ]; then
  for f in 20261120090000_aflp_cartographie_1_schema 20261120090100_aflp_cartographie_2_securite_rpc 20261120090200_aflp_cartographie_3_vues_pilotage; do
    $P -f "$RACINE/supabase/$f.sql" 2>&1 | grep -v NOTICE || true
    $P -At -c "select 1" >/dev/null
  done
fi
echo "Recette $DB construite."

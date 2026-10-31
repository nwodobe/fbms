#!/usr/bin/env bash
# AFLP MOTO MANAGER — recette serveur sur réplique LOCALE (jamais Supabase).
# Usage : PGHOST=/srv/pgtest PGPORT=54329 ./tests/moto/executer_tests_moto.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; RACINE="$DIR/../.."
: "${PGHOST:?}"; : "${PGPORT:?}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
DB=fbms_moto_test
"$RACINE/tests/sql/construire_replica.sh" "$DB"
P="psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q"
$P -f "$DIR/sql/00_complements_replica.sql" >/dev/null
$P -f "$RACINE/supabase/20260925224332_aflp_data_1_referentiels_incidents.sql" 2>&1 | grep -v NOTICE || true
appliquer() {  # échoue si la migration produit une erreur
  local sortie; sortie=$($P -f "$RACINE/supabase/$1.sql" 2>&1 | grep -v NOTICE || true)
  if grep -q "ERROR" <<<"$sortie"; then echo "$sortie" >&2; echo "ÉCHEC migration $1" >&2; exit 3; fi
}
for f in 20261031090000_aflp_moto_manager_1_schema_securite 20261031090100_aflp_moto_manager_2_rpc 20261031090200_aflp_moto_manager_3_vues_kpi 20261031090400_aflp_moto_manager_4_search_path; do
  appliquer "$f"
done
echo "Migrations 1 à 4 appliquées (état de la production au 31/10/2026)."
for passe in 1 2; do   # passe 2 = idempotence : la migration 5 doit pouvoir être rejouée
  appliquer 20261101090000_aflp_fleet_5_coordination_inspections
  echo "Passe $passe : migration 5 AFLP FLEET appliquée."
done
python3 "$DIR/tests_serveur_moto.py" "$DB"

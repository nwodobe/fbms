#!/usr/bin/env bash
# Prepare la base LOCALE du banc navigateur (replique + lot 1 + jeu fictif).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; SQL="$DIR/../sql"; DB="${1:-fbms_web}"
: "${PGHOST:?}"; : "${PGPORT:?}"
"$SQL/construire_replica.sh" "$DB"
for f in 20260918a_sacherie_perimetres_permissions 20260918b_comptes_roles_habilitations 20260918c_sacherie_rls_lecture_perimetre; do
  psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$DIR/../../supabase/$f.sql" 2>&1 | grep -v NOTICE || true
done
psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$SQL/jeu_essai.sql" >/dev/null
psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$SQL/banc_vues_referentiel.sql" >/dev/null
psql -U postgres -d "$DB" -qc "grant usage on schema public to authenticator" 2>/dev/null || true
echo "Base $DB prete pour le banc navigateur."

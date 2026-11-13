#!/usr/bin/env bash
# Construit le STAGING LOCAL fidèle : définitions EXACTES de production (lecture seule du
# catalogue du 13/11/2026) pour toutes les tables, fonctions, politiques et déclencheurs dont
# dépend l'Observatoire. Refuse toute cible Supabase.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; DB="${1:-fbms_staging}"
: "${PGHOST:?}"; : "${PGPORT:?}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
dropdb -U postgres --if-exists --force "$DB" 2>/dev/null; createdb -U postgres "$DB"
P="psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q"
psql -U postgres -d postgres -q -c "alter database $DB set check_function_bodies = off" -c "alter database $DB set jit = off"
$P -f "$DIR/00_bootstrap.sql"
$P -f "$DIR/10_tables.sql"
$P -f "$DIR/20_fonctions.sql"
$P -f "$DIR/30_index_rls_politiques.sql"
psql -U postgres -d "$DB" -At -f "$DIR/empreintes.sql" | sort > /tmp/staging_kv.$$; sort "$DIR/empreintes_production.txt" > /tmp/prod_kv.$$
N=$(comm -12 /tmp/prod_kv.$$ /tmp/staging_kv.$$ | wc -l); T=$(wc -l < /tmp/prod_kv.$$); rm -f /tmp/*_kv.$$
if [ "$N" != "$T" ]; then echo "ÉCART avec la production : $N / $T identiques" >&2; exit 4; fi
echo "Fidélité : $N / $T fonctions et politiques identiques à la production."
echo "Staging $DB construit."

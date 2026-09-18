#!/usr/bin/env bash
# Reconstruit la base de test LOCALE (jamais une base Supabase reelle).
# Usage : PGHOST=/tmp PGPORT=54329 ./tests/sql/construire_replica.sh [nom_base]
set -euo pipefail
DB="${1:-fbms_test}"
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${PGHOST:?PGHOST requis}"; : "${PGPORT:?PGPORT requis}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase detectee" >&2; exit 2;; esac
dropdb -U postgres --if-exists --force "$DB"; createdb -U postgres "$DB"
for f in "$DIR"/replica/0*.sql; do psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"; done
# Controle d'exactitude : md5(prosrc) de la replique == production (releve du 18/09/2026)
psql -U postgres -d "$DB" -At -c "select n.nspname||'.'||p.proname||'|'||md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')" | sort > /tmp/replica_md5.$$
sort "$DIR/replica/prod_md5.txt" > /tmp/prod_md5.$$
ECARTS=$(comm -23 /tmp/prod_md5.$$ /tmp/replica_md5.$$ || true)
rm -f /tmp/replica_md5.$$ /tmp/prod_md5.$$
if [ -n "$ECARTS" ]; then echo "ECART avec la production :"; echo "$ECARTS"; exit 1; fi
echo "Replique $DB construite : $(wc -l < "$DIR/replica/prod_md5.txt") fonctions identiques a la production (md5)."

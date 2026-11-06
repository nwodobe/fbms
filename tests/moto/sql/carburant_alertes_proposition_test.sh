#!/bin/sh
# Rejoue la PROPOSITION SQL d'alertes carburant sur un Postgres JETABLE (jamais la production).
# Usage : PGHOST=/tmp PGPORT=55432 PGUSER=postgres sh tests/moto/sql/carburant_alertes_proposition_test.sh
# (variables libpq standard ; refuse de tourner sans PGHOST explicite)
set -eu
RACINE=$(cd "$(dirname "$0")/../../.." && pwd)
: "${PGHOST:?PGHOST requis (Postgres jetable local)}"
psql -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists carb_test" -c "create database carb_test"
BASE="-d carb_test"
psql $BASE -v ON_ERROR_STOP=1 -q -f "$RACINE/tests/moto/sql/carburant_alertes_proposition_stub.sql"
psql $BASE -v ON_ERROR_STOP=1 -q -f "$RACINE/docs/aflp-moto-manager/propositions/20261107_carburant_alertes_serveur_PROPOSITION.sql"
R=$(psql $BASE -tA -c "select string_agg(m.code||':'||e.statut||':'||coalesce(e.stock_l::text,'-')||':'||coalesce(e.cout_fcfa::text,'-'), ' ' order by m.code) from moto_motos m, private.moto_carburant_evaluer(m.id,'2026-11-06T17:44Z') e")
ATTENDU="MOTO-003:CRITIQUE:4.92:9119 MOTO-004:NORMAL:8.62:5774 MOTO-SANS:DONNEES_A_VERIFIER:-:-"
[ "$R" = "$ATTENDU" ] || { echo "ÉCHEC parité JS/SQL : $R"; exit 1; }
psql $BASE -tA -q -c "select private.moto_carburant_recalculer('2026-11-06T17:44Z')" -c "select private.moto_carburant_recalculer('2026-11-06T18:14Z')" >/dev/null
D=$(psql $BASE -tA -c "select count(*)||'/'||sum(occurrences) from moto_carburant_alertes")
[ "$D" = "2/4" ] || { echo "ÉCHEC anti-doublon : $D"; exit 1; }
echo "VALIDÉ : parité JS/SQL et anti-doublon ($R ; $D)"

#!/usr/bin/env bash
# OBSERVATOIRE AFLP 2027 — recette de la migration 7 (codes de suivi A001 à A012).
# Base LOCALE uniquement (refuse toute cible Supabase).
# Usage : PGHOST=/tmp PGPORT=54329 ./tests/observatoire/executer_tests_codes_suivi.sh
# Étapes : staging fidèle + Observatoire 1 à 6 -> migration 7 (deux passes) -> retour arrière
#          (deux passes, désignation de la migration 5 restaurée) -> réapplication -> recette.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; RACINE="$DIR/../.."; DB="${1:-fbms_obs_codes}"
: "${PGHOST:?PGHOST requis}"; : "${PGPORT:?PGPORT requis}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
"$RACINE/tests/cartographie/construire_recette.sh" "$DB" sans_carto >/dev/null
P="psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q"
M7="$RACINE/supabase/20261122140000_aflp_observatoire_7_codes_suivi.sql"
R7="$RACINE/supabase/20261122140100_aflp_observatoire_7_rollback.sql"
src() { psql -U postgres -d "$DB" -At -c "select md5(prosrc) from pg_proc where proname='pheno_arbres_designer'"; }
AVANT=$(src)
$P -f "$M7" 2>/dev/null; $P -f "$M7" 2>/dev/null; echo "RÉUSSI  M7-01 Migration 7 rejouable (deux passes)"
APRES=$(src); [ "$AVANT" != "$APRES" ] && echo "RÉUSSI  M7-02 Désignation remplacée par la version avec codes"
$P -f "$R7" 2>/dev/null; $P -f "$R7" 2>/dev/null
if [ "$(src)" = "$AVANT" ]; then echo "RÉUSSI  M7-03 Retour arrière rejouable : désignation identique à la migration 5"; else echo "ÉCHOUÉ  M7-03 retour arrière"; exit 4; fi
N=$(psql -U postgres -d "$DB" -At -c "select count(*) from pg_proc where proname in ('pheno_arbres_codes_modifier','pheno_obs_code_suivi','pheno_code_suivi')")
if [ "$N" = "0" ]; then echo "RÉUSSI  M7-04 Retour arrière : fonctions de la migration 7 retirées"; else echo "ÉCHOUÉ  M7-04 ($N restantes)"; exit 4; fi
$P -f "$M7" 2>/dev/null; echo "RÉUSSI  M7-05 Réapplication après retour arrière"
python3 "$DIR/tests_codes_suivi.py" "$DB"

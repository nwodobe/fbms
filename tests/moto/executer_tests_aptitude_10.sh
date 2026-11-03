#!/usr/bin/env bash
# AFLP FLEET 10 — recette complète sur réplique LOCALE (jamais Supabase).
#  1. base = réplique + migrations 1 à 9 (état de la production au 03/11/2026) ;
#  2. tests_aptitude_10.py : parc existant créé sous les anciennes règles, migration 10 appliquée deux fois, tests T01-T10 ;
#  3. verifier_rollback_10.sh : retour arrière prouvé par empreinte.
# Usage : PGHOST=… PGPORT=… tests/moto/executer_tests_aptitude_10.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${PGHOST:?}"; : "${PGPORT:?}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
bash "$DIR/e2e/preparer_base_e2e.sh" fbms_apt10_base
# Les réglages de base (jit = off, comme Supabase) ne sont pas copiés par « template » : on les remet.
copie() { psql -U postgres -d postgres -q -c "drop database if exists $1" -c "create database $1 template fbms_apt10_base" -c "alter database $1 set jit = off"; }
copie fbms_apt10_t
python3 "$DIR/tests_aptitude_10.py" fbms_apt10_t
bash "$DIR/verifier_rollback_10.sh" fbms_apt10_base
# Base de la démonstration navigateur : 1-9 + migration 10.
copie fbms_apt10_e2e
psql -U postgres -d fbms_apt10_e2e -v ON_ERROR_STOP=1 -q -f "$DIR/../../supabase/20261106090000_aflp_fleet_10_aptitude_mise_en_service.sql" 2>&1 | grep -v NOTICE || true
if [ "${APTITUDE_E2E:-1}" = "1" ]; then PGDATABASE_E2E=fbms_apt10_e2e node "$DIR/e2e/aptitude-e2e.mjs"; fi

#!/usr/bin/env bash
# AFLP FLEET — preuve du retour arrière de la migration 10 (réplique LOCALE uniquement).
# A = migrations 1-9 (état de la production) ; B = copie de A + migration 10 (deux fois) + retour arrière 10 (deux fois).
# Compare fonctions (définition + droits), vues (définition + droits + options), politiques, colonnes, déclencheurs, paramètres, contraintes.
# Usage : PGHOST=… PGPORT=… tests/moto/verifier_rollback_10.sh [base_A]   (base_A construite par tests/moto/e2e/preparer_base_e2e.sh)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; RACINE="$DIR/../.."
: "${PGHOST:?}"; : "${PGPORT:?}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
A="${1:-fbms_rb10_a}"; B="${A}_b"
if ! psql -U postgres -d postgres -At -c "select 1 from pg_database where datname='$A'" | grep -q 1; then
  bash "$DIR/e2e/preparer_base_e2e.sh" "$A" >/dev/null
fi
psql -U postgres -d postgres -q -c "drop database if exists $B" -c "create database $B template $A"
appliquer() { local s; s=$(psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$RACINE/supabase/$2.sql" 2>&1 | grep -v NOTICE || true)
  if grep -q ERROR <<<"$s"; then echo "$s" >&2; echo "ÉCHEC $2 sur $1" >&2; exit 3; fi; }
empreinte() { psql -U postgres -d "$1" -At -c "
  select md5(string_agg(x, '|' order by x)) from (
    select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||coalesce(array_to_string(p.proacl::text[], ','), '') x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.proname like 'moto\_%'
    union all select 'vue:'||c.relname||':'||md5(pg_get_viewdef(c.oid))||':'||coalesce(array_to_string(c.relacl::text[], ','), '')||':'||coalesce(array_to_string(c.reloptions, ','), '')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'moto\_%'
    union all select 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) from pg_policies where policyname like 'moto%'
    union all select 'col:'||table_name||'.'||column_name||':'||data_type from information_schema.columns where table_schema='public' and table_name like 'moto\_%'
    union all select 'trg:'||tgrelid::regclass::text||'.'||tgname from pg_trigger where not tgisinternal and tgname like 'moto%'
    union all select 'par:'||cle||':'||coalesce(valeur::text,'')||':'||coalesce(valeur_json::text,'') from public.moto_parametres
    union all select 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid::regclass::text like 'moto\_%'
  ) t"; }
# Référence : état 1-9 + le correctif de sécurité volontairement conservé par le retour arrière.
REF="${A}_ref"; psql -U postgres -d postgres -q -c "drop database if exists $REF" -c "create database $REF template $A"
psql -U postgres -d "$REF" -q -c "revoke all on function private.moto_formation_support_immuable() from public, anon" -c "alter function private.moto_formation_support_immuable() set search_path to 'pg_temp'"
EA=$(empreinte "$REF")
appliquer "$B" 20261106090000_aflp_fleet_10_aptitude_mise_en_service
appliquer "$B" 20261106090000_aflp_fleet_10_aptitude_mise_en_service   # rejouable
EM=$(empreinte "$B")
appliquer "$B" 20261106090100_aflp_fleet_10_rollback
appliquer "$B" 20261106090100_aflp_fleet_10_rollback                  # rejouable
EB=$(empreinte "$B")
echo "Empreinte A (1-9 + correctif anon)     : $EA"
echo "Empreinte avec migration 10            : $EM"
echo "Empreinte B (1-9, 10, retour arrière)  : $EB"
[ "$EA" != "$EM" ] || { echo "ANOMALIE : la migration 10 n'a rien changé"; exit 1; }
if [ "$EA" = "$EB" ]; then echo "RETOUR ARRIÈRE 10 VÉRIFIÉ : état identique à 1-9."; else echo "ÉCART DÉTECTÉ"; exit 1; fi

#!/usr/bin/env bash
# AFLP FLEET — preuve du retour arrière de la migration 8 (réplique LOCALE uniquement).
# A = migrations 1-7 ; B = migrations 1-7 + 8 + retour arrière 8.
# Compare fonctions (définition + droits), vues, politiques (stockage compris), colonnes et contraintes.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; RACINE="$DIR/../.."
: "${PGHOST:?}"; : "${PGPORT:?}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
M1_6="20261031090000_aflp_moto_manager_1_schema_securite 20261031090100_aflp_moto_manager_2_rpc 20261031090200_aflp_moto_manager_3_vues_kpi 20261031090400_aflp_moto_manager_4_search_path 20261101090000_aflp_fleet_5_coordination_inspections 20261102090000_aflp_fleet_6_maintenance_autorisations 20261103090000_aflp_fleet_7_permis_carnet"
appliquer() { local s; s=$(psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$RACINE/supabase/$2.sql" 2>&1 | grep -v NOTICE || true)
  if grep -q ERROR <<<"$s"; then echo "$s" >&2; echo "ÉCHEC $2 sur $1" >&2; exit 3; fi; }
preparer() {
  "$RACINE/tests/sql/construire_replica.sh" "$1" >/dev/null
  psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$DIR/sql/00_complements_replica.sql" >/dev/null
  psql -U postgres -d "$1" -q -f "$RACINE/supabase/20260925224332_aflp_data_1_referentiels_incidents.sql" >/dev/null 2>&1 || true
  for f in $M1_6; do appliquer "$1" "$f"; done
}
empreinte() { psql -U postgres -d "$1" -At -c "
  select md5(string_agg(x, '|' order by x)) from (
    select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||coalesce(array_to_string(p.proacl::text[], ','), '') x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.proname like 'moto\_%'
    union all select 'vue:'||viewname||':'||md5(definition) from pg_views where schemaname = 'public' and viewname like 'moto\_%'
    union all select 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) from pg_policies where policyname like 'moto%'
    union all select 'col:'||table_name||'.'||column_name||':'||data_type from information_schema.columns where table_schema='public' and table_name like 'moto\_%'
    union all select 'trg:'||tgrelid::regclass::text||'.'||tgname from pg_trigger where not tgisinternal and tgname like 'moto%'
    union all select 'par:'||cle from public.moto_parametres
    union all select 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid::regclass::text like 'moto\_%'
  ) t"; }
preparer fbms_rb8_a
preparer fbms_rb8_b
appliquer fbms_rb8_b 20261104090000_aflp_fleet_8_missions_kilometrage
appliquer fbms_rb8_b 20261104090100_aflp_fleet_8_rollback
A=$(empreinte fbms_rb8_a); B=$(empreinte fbms_rb8_b)
echo "Empreinte A (1-7)                 : $A"
echo "Empreinte B (1-7, 8, retour 8)    : $B"
if [ "$A" = "$B" ]; then echo "RETOUR ARRIÈRE 8 VÉRIFIÉ : fonctions, droits, vues, politiques (stockage compris), colonnes, déclencheurs, paramètres et contraintes identiques à l'état 1-7 (production actuelle)."; else echo "ÉCART DÉTECTÉ"; exit 1; fi

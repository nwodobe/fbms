#!/usr/bin/env bash
# AFLP FLEET — preuve du retour arrière de la migration 5 (réplique LOCALE uniquement).
# Compare l'empreinte (md5 des définitions) des fonctions, vues et politiques moto
# entre : A = migrations 1-4 ; B = migrations 1-4 + 5 + retour arrière + 1-4.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; RACINE="$DIR/../.."
: "${PGHOST:?}"; : "${PGPORT:?}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
M1_4="20261031090000_aflp_moto_manager_1_schema_securite 20261031090100_aflp_moto_manager_2_rpc 20261031090200_aflp_moto_manager_3_vues_kpi 20261031090400_aflp_moto_manager_4_search_path"
appliquer() { local s; s=$(psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$RACINE/supabase/$2.sql" 2>&1 | grep -v NOTICE || true)
  if grep -q ERROR <<<"$s"; then echo "$s" >&2; echo "ÉCHEC $2 sur $1" >&2; exit 3; fi; }
preparer() {
  "$RACINE/tests/sql/construire_replica.sh" "$1" >/dev/null
  psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$DIR/sql/00_complements_replica.sql" >/dev/null
  psql -U postgres -d "$1" -q -f "$RACINE/supabase/20260925224332_aflp_data_1_referentiels_incidents.sql" >/dev/null 2>&1 || true
  for f in $M1_4; do appliquer "$1" "$f"; done
}
empreinte() { psql -U postgres -d "$1" -At -c "
  select md5(string_agg(x, '|' order by x)) from (
    select n.nspname||'.'||p.proname||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(array_to_string(p.proacl::text[], ','), '') x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.proname like 'moto\_%'
    union all select 'vue:'||viewname||':'||md5(definition) from pg_views where schemaname = 'public' and viewname like 'moto\_%'
    union all select 'pol:'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) from pg_policies where policyname like 'moto%'
  ) t"; }
contraintes() { psql -U postgres -d "$1" -At -c "select conname||':'||md5(pg_get_constraintdef(oid)) from pg_constraint where conname like 'moto\_%' and contype = 'c' order by 1"; }
preparer fbms_rb_a
preparer fbms_rb_b
appliquer fbms_rb_b 20261101090000_aflp_fleet_5_coordination_inspections
appliquer fbms_rb_b 20261101090100_aflp_fleet_5_rollback
for f in $M1_4; do appliquer fbms_rb_b "$f"; done
A=$(empreinte fbms_rb_a); B=$(empreinte fbms_rb_b)
echo "Empreinte A (1-4)              : $A"
echo "Empreinte B (1-4, 5, retour, 1-4): $B"
MANQUE=$(comm -23 <(contraintes fbms_rb_a) <(contraintes fbms_rb_b) | wc -l)
EN_PLUS=$(comm -13 <(contraintes fbms_rb_a) <(contraintes fbms_rb_b) | cut -d: -f1 | tr '\n' ' ')
echo "Contraintes d'origine absentes ou modifiées : $MANQUE"
echo "Contraintes conservées sur les colonnes facultatives ajoutées : $EN_PLUS"
if [ "$A" = "$B" ] && [ "$MANQUE" = 0 ]; then echo "RETOUR ARRIÈRE VÉRIFIÉ : fonctions, droits, vues et politiques identiques à l'état 1-4."; else echo "ÉCART DÉTECTÉ"; exit 1; fi

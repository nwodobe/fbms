#!/usr/bin/env bash
# OBSERVATOIRE AGRONOMIQUE AFLP 2027 — recette serveur sur réplique LOCALE (jamais Supabase).
# Usage : PGHOST=127.0.0.1 PGPORT=54329 [CIBLE=staging] [OBS_E2E=1] ./tests/observatoire/executer_tests_observatoire.sh
#   CIBLE=replique (défaut) : réplique historique tests/sql/replica + compléments.
#   CIBLE=staging           : staging fidèle (définitions exactes de production, voir staging/LISEZMOI.md).
# Étapes : réplique -> compléments -> empreinte de l'existant -> migrations 1 à 4 (deux passes)
#          -> contrôle de non-régression -> retour arrière -> réapplication -> recette par profils fictifs.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; RACINE="$DIR/../.."
: "${PGHOST:?PGHOST requis}"; : "${PGPORT:?PGPORT requis}"
case "$PGHOST" in *supabase*) echo "REFUS : base Supabase détectée" >&2; exit 2;; esac
CIBLE="${CIBLE:-replique}"
construire() {  # $1 = base
  if [ "$CIBLE" = "staging" ]; then "$DIR/staging/construire_staging.sh" "$1"
  else
    "$RACINE/tests/sql/construire_replica.sh" "$1"
    psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$RACINE/tests/moto/sql/00_complements_replica.sql" >/dev/null
    psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f "$DIR/sql/00_complements_replica.sql" >/dev/null
    psql -U postgres -d postgres -q -c "alter database $1 set jit = off"
  fi
}
if [ "$CIBLE" = "staging" ]; then DB=fbms_pheno_staging; else DB=fbms_pheno_test; fi
echo "Cible de recette : $CIBLE ($DB)"
construire "$DB"
P="psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q"

empreinte() {  # tout ce qui n'appartient PAS à l'Observatoire : colonnes, fonctions, politiques, privilèges, déclencheurs
  psql -U postgres -d "$DB" -At <<'SQL' | md5sum | cut -d' ' -f1
select 'col|'||table_schema||'.'||table_name||'.'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'')
  from information_schema.columns where table_schema in ('public','private','storage','auth') and table_name not like 'pheno\_%' order by 1;
select 'fn|'||n.nspname||'.'||p.proname||'|'||md5(p.prosrc)||'|'||coalesce(p.proacl::text,'')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','storage','auth') and p.proname not like 'pheno\_%' order by 1;
select 'pol|'||schemaname||'.'||tablename||'|'||policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')
  from pg_policies where policyname not like 'pheno\_%' order by 1;
select 'acl|'||n.nspname||'.'||c.relname||'|'||coalesce(c.relacl::text,'')||'|'||c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage','auth') and c.relkind in ('r','v') and c.relname not like 'pheno\_%' order by 1;
select 'trg|'||tgrelid::regclass||'|'||tgname from pg_trigger where not tgisinternal and tgname not like 'pheno\_%' order by 1;
select 'bucket|'||id||'|'||public from storage.buckets where id <> 'pheno-preuves' order by 1;
SQL
}
objets_pheno() { psql -U postgres -d "$DB" -At -c "select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relname like 'pheno\_%') + (select count(*) from pg_proc where proname like 'pheno\_%') + (select count(*) from pg_policies where policyname like 'pheno\_%')"; }
appliquer() {
  local sortie; sortie=$($P -f "$RACINE/supabase/$1.sql" 2>&1 | grep -v NOTICE || true)
  if grep -q "ERROR" <<<"$sortie"; then echo "$sortie" >&2; echo "ÉCHEC migration $1" >&2; exit 3; fi
}
MIG="20261113100000_aflp_observatoire_1_schema 20261113100100_aflp_observatoire_2_securite 20261113100200_aflp_observatoire_3_rpc_sync 20261113100300_aflp_observatoire_4_vues_pilote"
NR_OK=0; NR_KO=0
verdict() { if [ "$2" = "$3" ]; then NR_OK=$((NR_OK+1)); echo "RÉUSSI  $1"; else NR_KO=$((NR_KO+1)); echo "ÉCHOUÉ  $1 (attendu $3, obtenu $2)"; fi; }

AVANT=$(empreinte)
for passe in 1 2; do for f in $MIG; do appliquer "$f"; done; echo "Passe $passe : migrations 1 à 4 de l'Observatoire appliquées."; done
verdict "NR-01 Migrations rejouables (deux passes sans erreur)" "ok" "ok"
verdict "NR-02 Existant inchangé après migration (colonnes, fonctions, politiques, privilèges, déclencheurs)" "$(empreinte)" "$AVANT"
if [ "$CIBLE" = "staging" ]; then
  verdict "NR-03 Après migration, les 170 fonctions et politiques de production restent identiques (empreintes)" \
    "$(psql -U postgres -d "$DB" -At -f "$DIR/staging/empreintes.sql" | sort | comm -12 - <(sort "$DIR/staging/empreintes_production.txt") | wc -l)" "$(wc -l < "$DIR/staging/empreintes_production.txt")"
else
  verdict "NR-03 offline_sync_batch et fonctions de la réplique identiques à la production (md5)" \
    "$(psql -U postgres -d "$DB" -At -c "select n.nspname||'.'||p.proname||'|'||md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')" | sort | comm -13 - <(sort "$RACINE/tests/sql/replica/prod_md5.txt") | wc -l)" "0"
fi
verdict "NR-04 farmer_visits et farmer_plots non modifiées par les migrations (aucune instruction)" \
  "$(cat "$RACINE"/supabase/2026111310*_aflp_observatoire_[1-4]_*.sql | grep -v '^ *--' | grep -ciE '(alter|drop|truncate|update|delete from|insert into)[^;]*(farmer_visits|farmer_plots|producteurs|villages|profils|campaigns|offline_sync)' || true)" "0"
appliquer 20261113100400_aflp_observatoire_rollback
verdict "NR-05 Retour arrière : plus aucun objet de l'Observatoire" "$(objets_pheno)" "0"
verdict "NR-06 Retour arrière : existant strictement identique à l'état initial" "$(empreinte)" "$AVANT"
appliquer 20261113100400_aflp_observatoire_rollback
verdict "NR-07 Retour arrière rejouable" "$(objets_pheno)" "0"
for f in $MIG; do appliquer "$f"; done
verdict "NR-08 Réapplication après retour arrière" "$(empreinte)" "$AVANT"
SUF=""; [ "$CIBLE" = "staging" ] && SUF="_staging"
mkdir -p "$DIR/resultats"; printf '{"cible": "%s", "reussis": %s, "echoues": %s}\n' "$CIBLE" "$NR_OK" "$NR_KO" > "$DIR/resultats/non_regression_sql$SUF.json"
echo "Non-régression SQL : $NR_OK réussis, $NR_KO échoués."
OBS_SUFFIXE="$SUF" python3 "$DIR/tests_serveur_observatoire.py" "$DB"
node "$DIR/coeur.test.cjs"
if [ "${OBS_E2E:-0}" = "1" ]; then   # test navigateur de bout en bout (Chromium + Playwright requis)
  E2E=fbms_pheno_e2e$SUF
  construire "$E2E" >/dev/null
  PE="psql -U postgres -d $E2E -v ON_ERROR_STOP=1 -q"
  for f in $MIG; do $PE -f "$RACINE/supabase/$f.sql" >/dev/null; done
  if [ "$CIBLE" = "staging" ]; then $PE -f "$DIR/sql/11_jeu_fictif_e2e_staging.sql" >/dev/null
  else $PE -f "$DIR/sql/10_jeu_fictif_e2e.sql" >/dev/null; fi
  OBS_E2E_DB=$E2E OBS_SUFFIXE="$SUF" node "$DIR/observatoire-e2e.mjs"
fi
[ "$NR_KO" = "0" ]

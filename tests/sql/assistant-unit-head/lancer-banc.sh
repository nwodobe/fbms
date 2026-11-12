#!/usr/bin/env bash
# Banc isolé Assistant Unit Head : PostgreSQL local jetable, AUCUNE connexion à la production.
# Usage : PGBIN=/usr/lib/postgresql/16/bin bash tests/sql/assistant-unit-head/lancer-banc.sh
# (lancer sous un utilisateur non root : initdb refuse root)
set -euo pipefail
D=$(mktemp -d); PORT=${PORT:-55442}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
"$BIN/initdb" -D "$D/data" -A trust -U postgres >/dev/null
"$BIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D" -l "$D/log" start >/dev/null
trap '"$BIN/pg_ctl" -D "$D/data" stop >/dev/null; rm -rf "$D"' EXIT
P="psql -h $D -p $PORT -U postgres -X -q -v ON_ERROR_STOP=1"
R=$(cd "$(dirname "$0")" && pwd); RACINE=$(cd "$R/../../.." && pwd)
UH="$RACINE/tests/sql/unit-head"; SEC="$RACINE/docs/securite"; MIG="$RACINE/supabase"
$P -d postgres -c "create database banc" >/dev/null

# 1. Reproduction de la production (banc Unit Head 16/10 + écarts relevés le 03/11)
$P -d banc -f "$UH/00_reproduction_production.sql" >/dev/null
$P -d banc -f "$UH/01_offline_sync_batch_production.sql" >/dev/null
for f in 20261016_unit_head_village_cluster_scope.sql 20261016_prefixe_farmer_id_nouveaux_villages.sql 20261016_producteurs_gps_perimetre.sql; do
  $P -d banc -f "$SEC/$f" >/dev/null 2>&1; done
$P -d banc -f "$R/00_ecarts_production_20261103.sql" >/dev/null 2>&1
$P -d banc -f "$R/00b_offline_sync_batch_production_20261103.sql" >/dev/null
$P -d banc -f "$R/01_complements_production_20261103.sql" >/dev/null 2>&1

# 2. Fidélité : chaque fonction reproduite doit avoir l'empreinte md5 de la production
ECARTS=0; LOCAL="$D/empreintes_locales.txt"
$P -d banc -tA -c "select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'" > "$LOCAL"
while IFS='|' read -r f h; do
  grep -qxF "$f|$h" "$LOCAL" || { echo "ÉCART D'EMPREINTE : $f"; ECARTS=$((ECARTS+1)); }
done < "$R/empreintes_production_20261103.txt"
[ "$ECARTS" = "0" ] || { echo "Banc non fidèle à la production : $ECARTS écart(s)"; exit 2; }
echo "Fidélité : $(wc -l < "$R/empreintes_production_20261103.txt") fonctions identiques à la production (md5)"

uh(){ $P -d banc -v phase="$1" -f "$UH/02_banc_scenarios.sql" >/dev/null; }

# 3. AVANT : état de production
$P -d banc -f "$R/02a_controles_avant.sql" >/dev/null
uh XAVANT

# 4. APRÈS migration
$P -d banc -f "$MIG/20261103120000_aflp_assistant_unit_head_acces.sql" >/dev/null
$P -d banc -f "$R/02_comptes_essai.sql" >/dev/null
$P -d banc -v phase=APRES -f "$R/03_scenarios.sql" >/dev/null
uh YAPRES
# 4b. Concurrence : le BM approuve une fiche pendant que l'assistant tente de la renvoyer en Brouillon.
$P -d banc -c "insert into villages(id,village,cluster,statut,data,farmer_code_prefix) values ('zzauh-conc-v1','ZZAUH CONC','BOTRO','Soumis','{\"s1\":{\"cluster\":\"Botro\",\"village\":\"ZZAUH CONC\"}}','ZCCBO')" >/dev/null
( $P -d banc -c "begin; select set_config('request.jwt.claim.sub','00000000-0000-4000-9000-000000000001',true); set local role authenticated; update villages set statut='Approuvé BM' where id='zzauh-conc-v1'; select pg_sleep(3); commit;" >/dev/null 2>&1 & )
sleep 1
CONC=$($P -d banc -c "begin; select set_config('request.jwt.claim.sub','00000000-0000-4000-9000-000000000006',true); set local role authenticated; update villages set statut='Brouillon' where id='zzauh-conc-v1'; commit;" 2>&1 | grep -c "Approuvé BM" || true)
sleep 3
FINAL=$($P -d banc -tA -c "select statut from villages where id='zzauh-conc-v1'")
$P -d banc -c "insert into zz_resultats_auh(phase,id,bloc,fonction,compte,attendu,obtenu,statut) values ('APRES','S9-03','S9 Concurrence','Approbation BM concurrente : l''assistant attend le verrou puis est refusé','AUH Botro A + BM','REFUS','refus=$CONC, statut final=$FINAL', case when $CONC=1 and '$FINAL'='Approuvé BM' then 'PASS' else 'FAIL' end)" >/dev/null

# 5. RETOUR ARRIÈRE
$P -d banc -f "$MIG/20261103120100_aflp_assistant_unit_head_acces_rollback.sql" >/dev/null
$P -d banc -f "$R/04_controles_rollback.sql" >/dev/null
uh ZROLLB

# 6. REJEU : migration réappliquée après retour arrière (idempotence), comptes réactivés par le BM
$P -d banc -f "$MIG/20261103120000_aflp_assistant_unit_head_acces.sql" >/dev/null
$P -d banc -c "update public.profils set actif=true where role='Assistant Unit Head' and email like 'zzauh.%'" >/dev/null
$P -d banc -v phase=REJEU -f "$R/03_scenarios.sql" >/dev/null

# 7. Rapport
OUT=${OUT:-$R/resultats-derniere-execution.txt}
{
  echo "Banc Assistant Unit Head — exécution du $(date -u +%Y-%m-%dT%H:%MZ) — PostgreSQL $($P -d banc -tA -c 'show server_version')"
  echo "Fidélité production (03/11/2026) : $(wc -l < "$R/empreintes_production_20261103.txt") fonctions, empreintes md5 identiques"
  echo; echo "== Synthèse par phase"
  $P -d banc -c "select phase, statut, count(*) from zz_resultats_auh group by 1,2 order by 1,2"
  echo "== Détail (phase APRES, REJEU en regard)"
  $P -d banc -c "select a.id, a.compte, left(a.fonction,58) fonction, a.attendu, a.statut apres, r.statut rejeu, left(a.obtenu,70) obtenu
    from zz_resultats_auh a left join zz_resultats_auh r on r.id=a.id and r.phase='REJEU' where a.phase='APRES' order by a.id"
  echo "== Constats AVANT et contrôles ROLLBACK"
  $P -d banc -c "select phase, id, left(fonction,60) fonction, attendu, statut, left(obtenu,80) obtenu from zz_resultats_auh where phase in ('AVANT','ROLLBACK') order by phase, id"
  echo "== Non-régression Unit Head (banc 16/10 rejoué) : scénarios dont le résultat change entre AVANT, APRÈS et ROLLBACK"
  $P -d banc -c "select id, role, max(case when phase='XAVANT' then statut end) avant, max(case when phase='YAPRES' then statut end) apres,
    max(case when phase='ZROLLB' then statut end) rollback from zz_resultats group by id, role
    having count(distinct statut) > 1 order by id"
  $P -d banc -c "select phase, statut, count(*) from zz_resultats group by 1,2 order by 1,2"
} > "$OUT"
FAIL=$($P -d banc -tA -c "select count(*) from zz_resultats_auh where statut='FAIL'")
DIFF=$($P -d banc -tA -c "select count(*) from (select id from zz_resultats group by id having count(distinct statut)>1) s")
cat "$OUT" | head -12
[ "$FAIL" = "0" ] || { echo "ÉCHEC : $FAIL scénario(s) Assistant Unit Head"; exit 1; }
[ "$DIFF" = "0" ] || { echo "ÉCHEC : $DIFF scénario(s) Unit Head changent de résultat (régression)"; exit 1; }
echo "BANC OK"

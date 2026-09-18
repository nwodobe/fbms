#!/usr/bin/env bash
# Construit deux repliques LOCALES (avant / apres migration), charge le jeu
# d'essai fictif et rejoue la batterie de tests serveur sur les deux.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${PGHOST:?}"; : "${PGPORT:?}"
"$DIR/construire_replica.sh" fbms_avant
"$DIR/construire_replica.sh" fbms_apres
for passe in 1 2; do  # passe 2 = idempotence : la migration doit pouvoir etre rejouee
  for f in 20260918a_sacherie_perimetres_permissions 20260918b_comptes_roles_habilitations 20260918c_sacherie_rls_lecture_perimetre; do
    psql -U postgres -d fbms_apres -v ON_ERROR_STOP=1 -q -f "$DIR/../../supabase/$f.sql" 2>&1 | grep -v NOTICE || true
  done
done
for db in fbms_avant fbms_apres; do psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f "$DIR/jeu_essai.sql" >/dev/null; done
python3 "$DIR/tests_serveur.py" fbms_avant fbms_apres

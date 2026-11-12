# Matrice des correctifs · FBMS AFLP 2027 · état au 25/10/2026

Légende statut : **PUBLIÉ** = actif en production · **APPLIQUÉ EN BASE** = écrit dans Supabase, réversible · **EN PR** = code sur la branche `aflp/regularisation-sustainability-20261025` (PR #264, label `human-review`), non publié · **PRÉPARÉ** = script prêt, non appliqué.

Rien de ce qui figure ici ne constitue une certification, ni une validation sur téléphone Android physique (aucun appareil disponible le 25/10/2026).

| # | Problème initial | Fichier ou règle | Test exécuté | Résultat | Statut réel | Risque résiduel | Validation humaine indispensable |
|---|---|---|---|---|---|---|---|
| A1 | 196 superficies historiques sans aucune parcelle | Données : 179 parcelles `REVIEW_REQUIRED` / `NOT_MAPPED` (lot REG-AFLP-A) | Intégrité avant/après, 20 dossiers échantillonnés, sommes, unicité | 281/281 producteurs inchangés (empreinte), 513,85 ha = source, 0 GPS fictif | APPLIQUÉ EN BASE | Superficies déclarées non vérifiées ; 17 M3 + 78 sans superficie | Terrain : relevé des parcelles réelles |
| A2 | Parcelle sans GPS refusée (`DEFERRED`), précision GPS perdue | `operations/field-buying.js` | `01_parcelles_gps_status.sql` ; `regularisation-aflp-static.mjs` (rouge sur main, vert branche) | T1 refus reproduit ; correctif vérifié statiquement | EN PR | Affichage non observé avec un compte connecté | Relecture code + essai avec un compte de test |
| A3 | Statut « À vérifier » invisible dans le passeport | `shared/farmer-registry-passport.js`, `field-buying.js` | statique | badge et surface vérifiée présents | EN PR | idem | idem |
| A4 | Rollback par DELETE pouvant effacer des saisies ultérieures | Migration `20261025093944_…annulation_sure` (fonctions `annuler/restaurer_lot_a/b`) | Transaction annulée : parcelle modifiée simulée | 178/179 désactivées, 1 préservée, 0 DELETE, restauration 178/178 identique, producteurs inchangés | APPLIQUÉ EN BASE (fonctions inactives tant qu'on ne les appelle pas) | Restauration modifie `record_version` / `updated_at` (horodatage) | Décision écrite du BM avant toute annulation |
| A5 | Sauvegarde jamais restaurée | Schéma `backup_avant_regularisation_aflp_20261025` | Restauration de 3 dossiers altérés (transaction annulée) | 0 écart après restauration | APPLIQUÉ EN BASE | Sauvegarde dans la même base (pas hors site) | Export hors base recommandé |
| B1 | Pas de modèle pour l'accord de participation distinct du consentement données | Migration `20261025090000_aflp_accords_participation_notice` | `02_attestations_securite.sql` | 10/10 conformes | APPLIQUÉ EN BASE | — | Revue juridique du modèle |
| B2 | Déclaration du BM non enregistrée | 160 attestations `MANAGER_RETROSPECTIVE_ATTESTATION` (lot REG-AFLP-B) | Concordance dates / registre | 160/160 ; 0 consentement ni passeport modifié | APPLIQUÉ EN BASE | Ne vaut pas consentement données | — |
| B3 | Notice d'information absente | `aflp_notice_versions` AFLP-NOTICE-2026.1 ; fichier 04 | — | enregistrée `PENDING_LEGAL_REVIEW` | APPLIQUÉ EN BASE | Formalité ARTCI / CERTINUM, durée de conservation non arrêtées | **Juriste + Direction** |
| B4 | 104 RT-producteurs d'origine non démontrée | Registre `rt_producteurs_20261025` ; fichier 08 ; classeur terrain | Classement SQL | G1 81, G2 10, G3 8, G4 5 ; aucun consentement créé | APPLIQUÉ EN BASE (registre interne) | Statut producteur à confirmer sur place | Décisions de désactivation par le BM |
| C1 | Unit / Zonal / Assistant Unit Head ne peuvent pas enregistrer un consentement | `PREPARE_20261025_consentements_…` §P0-1 | `03_droits_matrice_roles.sql` (rejoué le 25/10 après le premier rapport) ; `05_restauration_correctifs_prepares.sql` | C0 refus reproduit ; C1–C10 conformes ; retour arrière : politique identique à la production | PRÉPARÉ | — | **Autorisation BM d'application** + relecture technique |
| C2 | Auto-validation du passeport possible | idem §P1-1 (trigger de séparation des tâches) | idem V1–V9 | 9/9 conformes | PRÉPARÉ | Compte Supervisor sans périmètre (inutilisable) | **Autorisation BM** ; périmètre du compte Supervisor |
| C3 | Nouveaux questionnaires créés en version 2026.1 | `shared/farmer-registry-operations.js` | statique | 2026.2 par défaut | EN PR | — | Relecture |
| D1 | Page hors ligne bloquée juste après « Préparer le terrain » (PWA) | `sw.js` | `offline-field-e2e.mjs` (Chrome local) | main ÉCHEC, branche PASS | EN PR | Non reproduit par la CI Chromium ; ampleur réelle sur téléphones inconnue | Relecture obligatoire (`sw.js` survit dans les caches) |
| D2 | CI « Offline Field Buying PR » : Playwright ne s'installe plus sur Ubuntu 26.04, test navigateur non exécuté | `.github/workflows/offline-field-pr.yml` (image Playwright épinglée, comme `agent-quality-gates.yml`) | Exécution locale avec Playwright 1.49.1 ; CI sur `48d8ffa` | 2 E2E PASS ; job `offline-field` **vert** en CI | EN PR | — | **Relecture `.github/`** |
| D3 | Précision GPS ignorée par la synchronisation serveur | `PREPARE_20261025_offline_sync_precision_gps.sql` (remplacement d'un seul bloc) | `04_offline_sync_precision_gps.sql` ; `05_restauration_correctifs_prepares.sql` | AVANT : POINT_CAPTURED sans précision ; APRÈS : précision 6,50 ou NOT_MAPPED + note ; retour arrière : fonction identique (empreinte md5) | PRÉPARÉ | Fonction volumineuse : correctif par remplacement contrôlé | Relecture + autorisation |
| D4 | Registre (parcelles, Sustainability, inspections) : saisie du compte A envoyée sous le compte B | `shared/farmer-registry-sync.js` | `offline-registre-sustainability-e2e.mjs` R8 | main ÉCHEC (envoyée sous B), branche PASS | EN PR | Opérations antérieures sans `user_id` restent envoyables par tout compte | Relecture |
| D5 | Même défaut côté Field Buying | `shared/offline-field.js` | `offline-field-multi-user-e2e.mjs` | traité par la **PR #262** (non dupliqué ici) | EN PR #262 | Conflit de fusion à surveiller | Revue PR #262 |
| D6 | Tests manquants : parcelles, Sustainability, inspections hors ligne, interruption, doublons, GPS | `tests/offline-registre-sustainability-e2e.mjs` | R1–R8, F2 | PASS (33 opérations, coupure, reprise, 0 doublon, précision reçue) | EN PR | Serveur simulé ; **TEST ANDROID PHYSIQUE NON EXÉCUTÉ** | Essai sur téléphone réel |
| E1 | Classeur terrain : colonne « Superficie historique » remplie de Oui/Non ; consentement réduit à Oui/Non | Classeur `AFLP_2027_Pilote_30_et_RT_producteurs_104.xlsx` v1.1 (hors dépôt, données personnelles) | Recalcul LibreOffice, 7 contrôles, essai de saisie simulée sur une copie | 0 erreur de formule ; 27 superficies = 91,40 ha = registre ; Oui / Partiel / Non comptés séparément | REMIS AU BM | 77 RT sans superficie source | — |
| E2 | Aucun enrôlement direct à Béoumi, Brobo, Diabo | Constat : aucun compte Unit Head sur ces clusters ; fichier 11 ; onglet `Enrolement_direct_15` | `06_enrolement_direct_beoumi_brobo_diabo.sql` | Chef de Zone : enrôlement accepté dans les 3 clusters ; Unit Head hors périmètre refusé ; consentement bloqué tant que P0-1 n'est pas appliqué | PRÊT (aucun enrôlement réalisé) | Charge des Chefs de Zone si aucun compte n'est créé | **Création de comptes par cluster (BM)** + P0-1 |
| E3 | Revue humaine #262 / #264 sans dossier commun | Fichier 12 | Fusions simulées dans les deux ordres ; portes et 3 E2E sur l'arbre combiné | Sans conflit ; tout PASS | EN PR | R1 : `?v=` non incrémentés (correctif actif à la 2ᵉ ouverture en ligne) | **Approbation et fusion par le BM** |
| E4 | Recette Android physique absente | Fichier 13 (14 cas, contrôles SQL) | — | — | **TEST ANDROID PHYSIQUE NON EXÉCUTÉ** | Comportement réel inconnu sur appareil | Téléphones + comptes de test |

## Dossier de revue technique (PR #264)

Ordre de lecture conseillé :
1. `docs/regularisation_aflp_20261025/10_matrice_correctifs_et_revue.md` (ce fichier).
2. Code client : `operations/field-buying.js`, `shared/farmer-registry-sync.js`, `shared/farmer-registry-passport.js`, `shared/farmer-registry-operations.js`.
3. Zones sensibles : `sw.js`, `.github/workflows/offline-field-pr.yml`.
4. SQL appliqué (pour contrôle) : `supabase/20261025090000_*`, `supabase/20261025093944_*`.
5. SQL préparé (non appliqué) : `supabase/PREPARE_20261025_*` + fichier 07.

Commandes de vérification :
```bash
node tests/regularisation-aflp-static.mjs
node tests/offline-field-static.mjs
node tests/farmer-registry-complete.mjs
CHROMIUM_PATH=… node tests/offline-field-e2e.mjs
CHROMIUM_PATH=… node tests/offline-registre-sustainability-e2e.mjs
node .github/scripts/verifier-js.mjs && node .github/scripts/verifier-html.mjs && node .github/scripts/verifier-liens.mjs
```

Ne pas fusionner automatiquement. Dossier complet de revue (dépendances, sécurité, risques, ordre de fusion) : **fichier 12**. Décision du 25/10/2026 : le Branch Manager approuve et fusionne lui-même ; ordre recommandé #262 puis #264.

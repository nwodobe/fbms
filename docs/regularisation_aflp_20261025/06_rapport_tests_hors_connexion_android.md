# Rapport des tests hors connexion · FBMS Field Buying

Date : 25/10/2026 · Environnement : poste Linux isolé, serveur HTTP local, Chrome for Testing 153 piloté par Playwright 1.58.2, **données 100 % synthétiques** (bouchon Supabase du test `tests/offline-field-e2e.mjs`). Aucune écriture en production.

> Mise à jour du 25/10/2026 (mandat de finalisation) : D-3 préparé et testé, D-4 corrigé pour le registre (PR #264) et traité pour Field Buying par la PR #262, nouveau test `tests/offline-registre-sustainability-e2e.mjs`, CI corrigée. État consolidé : fichier 10.

## Statut global

**TEST ANDROID PHYSIQUE NON EXÉCUTÉ.**
Contrôle effectué sur l'ordinateur Windows du Branch Manager le 25/10/2026 : ADB présent, **aucun appareil Android connecté** (`adb devices` vide). Aucun téléphone n'a été piloté. Les résultats ci-dessous sont des tests navigateur en émulation : ils ne valent pas validation sur téléphone.

## Deux applications distinctes

| | PWA (navigateur) | APK « ANAGROCI FIELD BUYING » |
|---|---|---|
| Où | `operations/field-buying.html` sur GitHub Pages | branche `android/aflp-2027-apk-v2`, **PR #262 ouverte, non fusionnée** |
| Mode hors ligne | Service Worker + IndexedDB | Service Worker neutralisé ; fichiers servis depuis l'APK ; même IndexedDB |
| Concernée par D-1 | **Oui** | Non (pas de Service Worker) |
| Testée ici | Oui (émulation Chrome) | Non (ni installation, ni téléphone) |

## Architecture vérifiée (lecture du code + exécution)

- File persistante IndexedDB `anagroci_ops_offline` : stores `operations` (clé d'idempotence unique), `mappings`, `bundles`, `meta`.
- Chaque opération porte `idempotency_key`, `device_id`, `created_at_client`, `dependencies` ; l'achat dépend de l'enrôlement local.
- Synchronisation par lot (`offline_sync_batch`, 50 max), reprise automatique (`SYNCING` → `PENDING` au redémarrage), backoff exponentiel plafonné à 300 s, arrêt automatique après 10 tentatives (relance manuelle « Réessayer »).
- Serveur : reçu d'idempotence `private.offline_sync_receipts` (166 reçus réels, tous `SYNCED`, 3 appareils, 14 → 21/10/2026).
- Session expirée : la synchronisation s'arrête avec un message, les opérations restent locales (code lu, non exécuté).
- Fichiers de preuve : envoi impossible hors ligne (limite connue n° 6), formulaires structurés OK.
- Conflits : pas d'arbitrage champ par champ (limite connue n° 8) ; modification d'un producteur existant **désactivée hors ligne** pour éviter les conflits de version.

## Résultats

| Test | Résultat | Preuve |
|---|---|---|
| Ouverture hors ligne juste après « Préparer le terrain » | **ÉCHEC sur `main`** puis **OK après correctif D-1** | `main` : page bloquée sur « Chargement… », 17 scripts en 504 (voir D-1). Branche : PASS ×4 |
| Enrôlement producteur hors ligne | OK (émulation) | opération `FARMER_ENROLL` PENDING |
| Achat dépendant du producteur local | OK (émulation) | dépendance explicite vers l'enrôlement |
| Reprise après fermeture de page hors réseau | OK (émulation) | file identique après réouverture |
| Retour réseau : synchronisation et mapping Farmer local → serveur | OK (émulation, serveur simulé) | l'achat part avec l'ID serveur |
| Double synchronisation / rejeu | OK (émulation) | aucun doublon côté serveur simulé |
| Charge locale 10 / 100 / 500 opérations | OK | écriture 45 ms / 447 ms / 4,9 s |
| Modification producteur hors ligne | **Bloquée par conception** | message explicite, à faire à la reconnexion |
| Ajout de parcelle hors ligne | Code corrigé (précision GPS), non couvert par l'E2E | test statique `tests/regularisation-aflp-static.mjs` |
| Capture GPS Android | NON EXÉCUTÉ (pas d'appareil) | — |
| Accord / questionnaire / inspection hors ligne | Non couverts par l'E2E existant | à ajouter au banc |
| Photo / preuve, envoi différé | Non supporté hors ligne (limite connue) | — |
| Deux appareils modifiant la même fiche | NON EXÉCUTÉ ; seulement possible en ligne (édition offline désactivée) | — |
| Échec de synchronisation visible + nouvelle tentative | Code présent (journal, bouton « Réessayer ») ; non exécuté | — |
| Changement de compte | NON EXÉCUTÉ | anomalie potentielle D-4 |
| Réseau lent / coupure brutale | NON EXÉCUTÉ | — |

## Anomalies

**D-1 · Ouverture hors ligne impossible juste après la préparation (PWA).**
Les pages chargent leurs scripts avec `?v=…` ; le précache les enregistre sans paramètre ; hors ligne, `cacheFirst` cherchait la correspondance exacte → 504. Reproduit sur Chrome 153 avec le test du dépôt ; **non reproduit par la CI** (Chromium Playwright) qui est verte sur `main` : l'ampleur réelle sur les téléphones du terrain n'est pas établie. Correctif : repli sans paramètre **uniquement si le réseau échoue** (le cache-busting en ligne est conservé). Avant/après démontré.

**D-2 · Course de navigation dans le test E2E.** Après un enregistrement, la page se redessine 1,2 s plus tard ; sur une machine lente, le formulaire suivant est détaché. Test stabilisé (attentes explicites), comportement applicatif inchangé.

**D-3 · Précision GPS non transmise côté serveur hors ligne.** Le client envoie maintenant `gps_accuracy_m`, mais la fonction serveur `offline_sync_batch` l'ignore et la contrainte accepte un point sans précision. À corriger côté serveur (zone `supabase/`, non modifiée).

**D-4 · Isolation entre comptes sur un même téléphone.** La file IndexedDB est par appareil, pas par utilisateur. Non testé ; à vérifier avant de partager des téléphones entre agents.

## Pour valider sur téléphone

1. Brancher un Android en USB, débogage activé, ou installer l'APK de la PR #262 après revue.
2. Rejouer les 16 scénarios du mandat en mode avion, puis réseau rétabli, avec un compte de test et un producteur QA (`is_qa = true`).
3. Noter pour chaque scénario : capture d'écran, état du journal de synchronisation, ligne serveur correspondante.

# Démonstration sur téléphone Android réel · 25/10/2026

Appareil : **itel S688LN, Android 15 (API 35), WebView 155**, relié en USB à l'ordinateur du Branch Manager, avec son accord.
Application de test : **« FBMS TEST MAJ »**, identifiant `ci.anagroci.fieldbuying.majtest`, installée **à côté** de l'application déjà présente.
L'application existante **« ANAGROCI FB TEST »** 1.1.0 n'a pas été touchée : version et date d'installation (17/10/2026 05:06) relues avant et après.
Canal : `test`, servi par `raw.githubusercontent.com` (branche `android-updates-test`), publié par `publish-web-update.mjs`.
Données : aucune connexion à un compte et aucune donnée réelle. Les opérations en attente sont **synthétiques** (`RECETTE-SYNTHETIQUE`) et ont été **supprimées** à la fin.

| Étape | Action | Observé sur le téléphone | Résultat |
|---|---|---|---|
| 1 | APK 1.2.0 (3) installé, ouvert en ligne | page servie depuis l'APK, Web `2026.10.25-1153.258cd8f`, « Vérifier » → **à jour** | PASS |
| 7a | 3 opérations synthétiques en attente dans la vraie file IndexedDB | `PENDING : 3` | — |
| B | **Mode avion**, arrêt forcé, relance | l'application démarre entièrement hors réseau (bibliothèques, polices, moteur hors ligne). Écran de connexion : « Hors ligne : une connexion Internet est nécessaire pour vous identifier » ; 3 opérations toujours là | PASS (capture `telephone-hors-ligne-demarrage.png`) |
| 2-3 | Modification fictive v1 (marqueur `DEMO-UNIFICATION v1`) publiée pendant que le téléphone est hors ligne | publication signée, 1 objet | PASS |
| 5 | Toujours hors ligne | « hors ligne : vérification impossible », ancienne version active | PASS |
| 6 | Réseau rétabli | après le délai du cache de `raw.githubusercontent.com` (≈ 3 min) : « version vérifiée : appliquée au prochain démarrage » (1 fichier téléchargé) ; rien remplacé pendant la session | PASS |
| 4/8 | Redémarrage | version v1 active (« mise à jour signée »), marqueur visible dans la page, démarrage confirmé, « Dernière mise à jour réussie 12:06 » | PASS |
| 7b | Opérations après mise à jour | les 3 mêmes identifiants, toujours `PENDING` | PASS |
| 9 | v2 **volontairement défectueuse** publiée (zone principale absente), téléchargée, activée | 60 s sans confirmation → **retour automatique à v1**, v2 refusée définitivement, opérations intactes | PASS |
| 9b | Canal remis en état : v2 **révoquée**, nouvelle référence publiée | `revoked_sequences : [1792930008]` | PASS |
| D | **Mise à jour native** 1.2.1 (4) installée **par-dessus** (même signature de test) | installation acceptée ; 3 opérations synthétiques conservées ; mise à jour Web antérieure abandonnée (« l'APK installé contient une version plus récente ») ; défaut d'affichage corrigé (bouton Version visible au-dessus de l'écran de connexion) | PASS (capture `telephone-version-et-mises-a-jour-1.2.1.png`) |
| 7c | Synchronisation des opérations avec Supabase | **non exécutée** : aucune session, aucun compte de test autorisé ; aucune écriture en production | NON EXÉCUTÉ |

Défaut réel trouvé sur le téléphone et corrigé : l'écran de connexion masquait le bouton « Version et mises à jour ». Il est corrigé en 1.2.1 et le test V19 a été ajouté.

Constat d'exploitation : le canal test hébergé sur `raw.githubusercontent.com` met jusqu'à environ 5 min à servir une nouvelle version. Le canal stable, sur GitHub Pages, met jusqu'à environ 10 min (`max-age=600`).

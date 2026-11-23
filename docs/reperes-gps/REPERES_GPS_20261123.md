# Repères GPS : saisie manuelle et capture hors réseau (23/11/2026)

Mandat du Branch Manager du 23/11/2026. Données de test **fictives** uniquement (base de recette
`fbms-recette-observatoire`). Aucune coordonnée réelle de parcelle dans ce document.

## 1. Ce qui change pour l'agent

Nouvelle rubrique **Réseau → Repères GPS (saisie hors réseau)**, aussi accessible depuis la fiche
d'une parcelle, le parcours « Cartographier le champ » et la fiche d'un champ de l'Observatoire.

Pour une **parcelle**, un **bloc** ou un **arbre suivi** :

- **Utiliser ma position GPS** : position du téléphone, avec sa précision et son heure (refusée au-delà de 50 m).
- **Saisir les coordonnées GPS** : champs **Latitude** et **Longitude** séparés, point ou virgule,
  pour un champ éloigné ou un relevé fait avec un autre appareil.
- **Enregistrer** : sur le téléphone, sans réseau ni carte.
- **Voir sur la carte** : points et identifiants ; sans fond disponible, les points restent affichés sur fond neutre.

## 2. Diagnostic et choix

| Constat (vérifié sur la production, lecture seule) | Conséquence |
|---|---|
| `farmer_plots_gps_metadata_chk` exige précision > 0 et date dès qu'un point existe | Une saisie manuelle à précision inconnue aurait dû inventer une précision |
| L'ancien formulaire parcelle réécrit la ligne entière (`select('*')` puis upsert) | Toute colonne ajoutée à `farmer_plots` serait écrasée par un ancien client |
| Les blocs n'ont aucune voie d'écriture de position après l'installation | Fonction serveur nécessaire |
| Moteur OTA : WebView native maison, paquet signé ECDSA P-256 **vérifié**, activation au redémarrage, retour arrière automatique | Livraison possible sans nouveau binaire, sans dépendance native |

Approches comparées :

| Approche | Utilité terrain | Effort | Risque | OTA |
|---|---|---|---|---|
| 1. Saisie au retour du réseau seulement | Faible : rien sur place | Faible | Faible | Oui |
| **2. Fiche hors ligne + stockage durable + synchronisation** (retenue, couvre aussi la 1) | Forte | Moyen | Maîtrisé (table et base locale séparées) | Oui |
| 3. Cartes satellite hors ligne | Forte | Élevé | Licences des tuiles, taille du paquet (60 Mo max) | À évaluer à part |

Solution : table additive **`geo_reperes`** (une ligne par version : l'historique est la table), fonction
idempotente **`geo_reperes_sync_batch`**, base locale dédiée **`aflp_reperes_gps_db`**. Aucune table, colonne,
contrainte, fonction ni base locale existante n'est modifiée (`queue_schema` inchangé).

## 3. Règles tenues

- WGS84, degrés décimaux, latitude et longitude toujours nommées. 0 ; 0 refusé. Rien n'est corrigé en
  silence : signe oublié, inversion, position hors Côte d'Ivoire produisent une alerte à confirmer.
- Une saisie manuelle n'est pas une capture : `farmer_plots.gps_status`, le point de référence et le
  marquage des arbres ne changent pas ; l'éligibilité à l'installation d'un panel est inchangée.
- Précision et date du relevé inconnues restent `NULL`.
- Un repère est un point : aucun contour, aucune superficie.
- Consentement GPS exigé par le serveur pour les trois types d'objet ; périmètre identique à
  `plot_map_localiser` (parcelle) et `pheno_arbre_marquer` (bloc, arbre).
- Trois états séparés : transmission, validation métier (« Non vérifié »), disponibilité de la carte.

## 4. Exigence / modification / test / résultat / preuve

| Exigence | Modification | Test | Résultat | Preuve |
|---|---|---|---|---|
| Saisie hors réseau, carte jamais chargée | `operations/reperes-gps.js`, `shared/reperes-gps-hors-ligne.js` | Navigateur A1–A8 ; émulateur mode avion | Conforme | `tests/reperes-gps/resultats/navigateur.json`, `preuves-20261123/emu-02` |
| Champ éloigné : point = coordonnées saisies | idem | Navigateur A6, H3 ; émulateur (saisie 7,689950 ≠ position 7,689498) | Conforme | idem |
| GPS refusé ou indisponible | idem | Navigateur E1 | Conforme | `navigateur.json` |
| Fermeture forcée et redémarrage | Transaction IndexedDB `durability: strict` | Navigateur B1–B2 ; émulateur `am force-stop` | Conforme | `emu-03` |
| Retour réseau, reprises répétées, aucun doublon | Clé d'idempotence + reçus serveur | Serveur 03–07 ; navigateur H1–H3 ; émulateur + contrôle SQL | Conforme (2 repères, 1 envoi chacun) | §5 |
| Réseau présent, serveur inaccessible | File conservée, message | Navigateur G1–G2 ; émulateur (serveur bloqué par pare-feu) | Conforme | §5 |
| Coordonnées incorrectes | `shared/reperes-gps-coeur.js` | Cœur 14 cas ; serveur 23–25 ; navigateur C1–C6 | Conforme | sorties des bancs |
| Point, contour, arbre sans position | Liste « Position non renseignée » | Navigateur D1–D5 ; serveur 28 | Conforme | `04-liste-champ-observatoire-360.png` |
| Conflit entre deux appareils | `version_base`, code GR409 | Serveur 16–22 ; navigateur I1–I4 | Conforme | `06-conflit-360.png` |
| Consentement, périmètre, compte | Gardes serveur, file par compte | Serveur 01–02, 10–15 ; navigateur F1, K1–K4 | Conforme | sorties des bancs |
| Parcelle et arbre existants préservés | Table séparée | Serveur 09, 27, 33–35 | Conforme | sortie du banc |
| Ancien client après évolution serveur | Aucune fonction existante modifiée | Serveur 30–32 ; émulateur (ARBRE_MARQUER de l'ancienne version reçu) | Conforme | §5 |
| Ancien client modifiant un objet enrichi | Table inconnue de l'ancien client | Serveur 33 | Conforme | sortie du banc |
| OTA avec données locales en attente | Aucune (mécanisme existant) | Émulateur, canal test | Conforme | §5 |
| Téléchargement OTA interrompu ou paquet refusé | Aucune (mécanisme existant) | **Non rejoué** pour cette livraison ; prouvé le 21–22/11 sur ce même émulateur (paquet mal signé refusé, révocation, retour arrière) et le 25/10 sur l'itel | Non exécuté ici | historique du moteur, `docs/android/preuves-20261025/` |
| Petit écran | `operations/reperes-gps.css` | Navigateur A9–A10, M (360, 390, 768, 1440) | Conforme | captures |
| Capture GPS en ligne puis carte | Ouverture automatique après capture valide | Émulateur : carte ouverte en ligne, 3 points | Conforme, **fond neutre** (pas d'imagerie en recette) | `emu-04` |

Totaux : cœur **14/14**, serveur **35/35**, navigateur **48/48**.

## 5. Recette OTA pilote (émulateur ; réception sur ITEL non vérifiée)

Environnement : émulateur Android 15 (API 35), application `ci.anagroci.fieldbuying.majota` (natif 1.4.2,
versionCode 9, débogable), **canal `test`** (`android-updates-test`), clé de test, base de recette.
Ce n'est **pas** l'APK officielle : celle-ci ne lit que le canal stable.

| Étape | Constat |
|---|---|
| Version « avant » (main `2e67cd9` + base de recette), séquence `1795469205` | Active et confirmée ; module Repères absent |
| Mode avion, marquage d'un arbre avec l'ancienne version | Opération `ARBRE_MARQUER` en attente (précision 5 m) |
| Réseau rendu, **serveur métier bloqué** (pare-feu de l'émulateur), canal de mise à jour joignable | Opération toujours en attente |
| Publication de la version « après » (`0878d28` + base de recette), séquence `1795469206` | Téléchargée, signature vérifiée, « appliquée au prochain démarrage » |
| Arrêt forcé puis redémarrage | Activée `21:34:39Z`, confirmée `21:34:48Z` ; APK non réinstallée (date d'installation inchangée) |
| Après activation | Opération de l'ancienne version intacte, 16 champs préparés intacts, session conservée |
| Mode avion : saisie manuelle d'un arbre, capture GPS d'un bloc, arrêt forcé | 2 repères en attente retrouvés au redémarrage |
| Serveur débloqué, 3 synchronisations | Tout reçu ; côté serveur 2 repères, 1 reçu pour l'ancienne opération, 12 arbres, aucun doublon |

## 6. Notice agent

1. **Choisir** : Réseau → Repères GPS, puis le champ, puis la parcelle, le bloc ou l'arbre.
2. **Capturer ou saisir** : « Utiliser ma position GPS » sur place, ou « Saisir les coordonnées GPS » (latitude, longitude ; la longitude est négative).
3. **Enregistrer** : attendre « Enregistré sur ce téléphone. En attente de synchronisation. »
4. **Synchroniser** : au retour du réseau, toucher « Synchroniser » jusqu'à « Aucun repère en attente ».
5. **Voir sur la carte** : dans la fiche du champ.

Avant de partir : avec du réseau, « Préparer mes champs », et « Préparer le hors-ligne » dans l'Observatoire.

## 7. Limites

- Pas de carte satellite hors ligne (approche 3, à évaluer séparément).
- Un repère reste « Non vérifié » : l'écran de vérification par la supervision n'est pas livré.
- Un repère saisi ne rend pas une parcelle éligible à l'installation d'un panel (règle inchangée : point capturé sur le champ).
- La parcelle n'est repérable que dans un cluster où la localisation est activée (règle existante).
- Le cache des champs de l'Observatoire est commun aux comptes d'un même téléphone (existant, hors périmètre) ; la file des repères, elle, est par compte.
- Deux points au même endroit se superposent sur la carte ; la liste les distingue.
- L'APK 1.4.2 a ses mises à jour désactivées : elle ne recevra pas cette version.

## 8. Récupération

- **Paquet OTA défectueux** : `node android/scripts/publish-web-update.mjs --channel stable --key <clé> --rollback-to <séquence saine> --revoke <séquence fautive> --write-root-version`. Les repères en attente restent dans `aflp_reperes_gps_db`, que l'ancienne version ne lit ni n'efface ; ils repartent dès que la nouvelle version revient.
- **Serveur** : `supabase/20261123100100_aflp_reperes_gps_1_rollback.sql` retire seulement l'écriture. La table et ses lignes sont conservées ; les téléphones gardent leurs repères « en attente ».
- Ne jamais désinstaller l'application ni vider ses données : la file locale serait perdue.

## 9. Publication stable et réception sur l'APK officielle (23/11/2026)

Statut : **LIVRÉ AVEC VÉRIFICATION APPAREIL INCOMPLÈTE** — « émulateur ; réception sur ITEL non vérifiée ».

| Élément | Valeur constatée |
|---|---|
| Code | PR #374, fusion `58e61e8` · publication PR #375, fusion `bceb05b` |
| Serveur | Migration `aflp_reperes_gps_1` appliquée en production avant l'OTA ; empreintes des fonctions, colonnes et contraintes identiques à la recette ; données existantes inchangées |
| Bundle | Séquence `1795470423` · `2026.11.23-2147.58e61e8` · 215 fichiers · canal `stable` · `min_native_version_code` 3 |
| Signature | ECDSA P-256, vérifiée par le script et par `openssl` avec la clé publique embarquée `d5b70040…73f0` ; manifeste servi `2ad21187…1b61` identique au manifeste signé |
| Paquet testé | Identique au paquet du pilote (séquence test `1795469206`) pour 213 fichiers sur 215 ; seuls `shared/auth-gate.js` et `shared/anagroci-config.js` diffèrent (serveur de production) |
| APK de vérification | Officielle `ci.anagroci.fieldbuying` 1.4.3 (code 10), SHA-256 `752fc324…be8e82`, certificat `1f70f69e…1b41`, installée par-dessus la 1.4.1 sur émulateur Android 15 |
| Publié | 23/11/2026, servi par GitHub Pages |
| Téléchargé | `21:55:37Z`, 17 fichiers, signature et empreintes vérifiées par l'application |
| Activé | `21:56:04Z` au redémarrage ; version précédente `1795359754` gardée pour le retour arrière |
| Démarrage confirmé | `21:56:07Z` |
| Fichier actif | `operations/reperes-gps.js` sur l'appareil : empreinte `6c6c83cf…ddaf8`, égale à celle du manifeste |
| Binaire et stockage | APK non remplacée (date de mise à jour du paquet inchangée) ; IndexedDB et stockage local : même nombre de fichiers et même taille avant et après |

Ce qui n'a **pas** été vérifié :

- **Téléphone physique** : aucun appareil n'était branché. La réception sur l'itel S688LN reste à constater (écran « Version et mises à jour », ou tableau « Mises à jour des téléphones »).
- **Parcours connecté sur l'APK officielle** : elle ne parle qu'à la production, où aucun compte de test n'existe et où aucune donnée fictive ne doit être créée. Le scénario « données en attente avant l'OTA, conservées après » a donc été prouvé sur l'application pilote (natif 1.4.2 débogable, canal test, base de recette), pas sur le binaire officiel.
- **Téléchargement interrompu / paquet refusé** : non rejoué pour cette livraison (mécanisme inchangé, prouvé les 25/10 et 21–22/11).
- **Fond satellite** : la recette n'a pas d'imagerie configurée ; la carte a été vue sur fond neutre.

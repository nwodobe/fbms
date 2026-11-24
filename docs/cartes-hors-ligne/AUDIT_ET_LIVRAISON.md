# Cartes satellite hors ligne : audit et conditions de livraison

Date : 24 novembre 2026. Référence inspectée : `a52bc440015c48df977b19512a142d66adf36d87` du dépôt `nwodobe/fbms`.

**Statut : PARTIEL AVEC BLOCAGE, code candidat préparé pour revue, non publié en production.** Aucune recette Android de la nouvelle fonction n'est déclarée exécutée ici. Aucune nouvelle OTA stable n'a été signée, publiée ou observée sur téléphone. Aucun abonnement, service facturable ou achat n'a été engagé. Les [résultats de validation](VALIDATION.md) et les [empreintes du candidat](PREUVES_TESTS.json) distinguent les contrôles exécutés des portes bloquantes.

## 1. Objectif et limites du périmètre

Permettre à l'agent de télécharger dans FBMS un fond satellite préparé pour une petite zone, puis d'afficher ce fond et les repères des parcelles, blocs et arbres sans réseau. Le fond doit être utilisable après fermeture forcée et redémarrage, même dans une partie de la zone jamais consultée en ligne. La saisie manuelle GPS et les files de synchronisation existantes restent les sources des positions métier.

Cette première approche repose sur un catalogue de zones préparées sur un poste de travail. Elle ne promet pas un service permanent qui fabrique instantanément la carte de n'importe quelle zone. La résolution native des bandes visibles de Sentinel-2 est de 10 mètres : agrandir l'affichage n'ajoute aucun détail. Les arbres sont représentés par leurs coordonnées enregistrées ; leurs positions ne sont pas déduites de l'image. Des nuages ou des pixels sans données peuvent rendre un fond peu utile malgré un téléchargement techniquement complet. [Source Sentinel-2](https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2).

Les identifiants des champs, consentements, marquages des arbres, règles d'éligibilité, RPC et bases métier n'ont pas à changer pour ajouter un fond cartographique.

## 2. Preuves tirées du runtime existant

| Élément inspecté | Constat dans les sources | Conséquence |
|---|---|---|
| [Identité Android](../../android/version.properties) | `ci.anagroci.fieldbuying`, version 1.4.3, code 10 ; minimum Android API 24 ; minimum de réception OTA format 2 : code 3 | La cible est l'APK existante ; ne pas augmenter sa version pour ce développement Web |
| [MainActivity](../../android/app/src/main/java/ci/anagroci/fieldbuying/MainActivity.java) | Une activité et un WebView ; JavaScript, DOM storage et base de données activés ; `file://` interdit | Une base IndexedDB et une couche Leaflet sont compatibles avec les capacités prévues ; pas de lecture arbitraire du système de fichiers |
| [AssetServer](../../android/app/src/main/java/ci/anagroci/fieldbuying/AssetServer.java) | Origine locale fixe `https://appassets.androidplatform.net/`, identique pour le contenu embarqué et l'overlay OTA | Le mécanisme observé ne change pas l'origine qui porte IndexedDB |
| [Pont Web Android](../../android/native-web/bridge.js) | Service Workers désactivés et anciens enregistrements supprimés | La lecture des packs ne doit pas dépendre d'un Service Worker |
| [Bibliothèques embarquées](../../android/scripts/prepare-web.mjs) | Leaflet 1.9.4 est figé dans l'APK | Réutiliser Leaflet ; éviter un nouveau moteur téléchargé depuis un CDN |
| [NativeBridge](../../android/app/src/main/java/ci/anagroci/fieldbuying/NativeBridge.java) | États et actions OTA, exports, impression ; aucune API de montage de carte | `saveFile` n'est pas un serveur de cartes ; le stockage des fonds reste Web |
| [Moteur OTA](../../android/app/src/main/java/ci/anagroci/fieldbuying/WebBundleUpdater.java) | Signature ECDSA P-256, empreintes, compatibilité, activation au démarrage, confirmation et retour arrière | Conserver la chaîne de confiance existante ; aucune clé de remplacement ni désactivation des vérifications |

Ces constats portent sur du code inspecté. Ils ne prouvent pas la durabilité effective d'un nouveau pack sur un appareil. Aucun plugin natif, permission Android ou changement de l'origine n'est requis par l'architecture retenue.

Le pont natif diffère toutes les révocations d'URL objet de 60 secondes pour les exports. Le lecteur candidat emploie `Canvas` et `ImageBitmap`, ferme chaque bitmap après dessin et ne crée pas d'URL Blob. Sa couche Leaflet utilise `keepBuffer: 0`. Cette précaution évite ce délai du pont ; la consommation réelle de mémoire reste à mesurer sur l'APK.

## 3. Comparaison des trois approches

| Approche | Avantages | Contraintes et risques | Décision |
|---|---|---|---|
| **Leaflet existant + petites tuiles raster préparées + IndexedDB** | Peu de dépendances ; images décodées par le moteur existant ; téléchargement interruptible et contrôle d'intégrité par fichier ; livraison du code par OTA | Catalogue à préparer ; nombre d'objets à borner ; quota partagé avec les données métier ; durabilité et mémoire à mesurer | **Retenue pour la première version** |
| Archive PMTiles ou MBTiles + lecteur Web | Distribution en un fichier, index compact ; format utile pour de grands catalogues | MBTiles nécessite un lecteur SQLite ; PMTiles nécessite un lecteur adapté ; compatibilité WebView, quota et mémoire à démontrer ; des requêtes HTTP Range vers une archive distante ne constituent pas un téléchargement hors ligne | À réévaluer après preuve sur le runtime existant |
| Raster géoréférencé GeoTIFF lu directement dans le téléphone | Conserve le raster source et son géoréférencement ; peu de fichiers à distribuer | Lecture, reprojection et rendu peuvent consommer beaucoup de mémoire ; bibliothèque supplémentaire ; gros raster difficile à reprendre et à afficher sur téléphone modeste | Réservé à la préparation sur poste ; ne pas en faire une dépendance du téléphone sans mesure |

La chaîne retenue prépare localement les images satellite en petites tuiles puis propose leur téléchargement dans l'application. La préparation n'exige pas un serveur de calcul permanent. [Documentation du format PMTiles](https://docs.protomaps.com/pmtiles/).

## 4. Sources, droits et coûts

| Composant | Droits et coûts établis | Condition de livraison ou incertitude |
|---|---|---|
| Données Copernicus Sentinel-2 | Accès ouvert ; reproduction, adaptation et redistribution permises selon la licence Sentinel | Préserver la source, l'année et l'attribution adaptée ; tracer le produit source, sa date et les traitements |
| Earth Search, collection Sentinel-2 C1 L2A | Le registre AWS décrit un accès public au bucket `e84-earth-search-sentinel-data`, sans compte AWS requis | Vérifier chaque asset choisi et son URL ; refuser une route `Requester Pays`, une authentification facturable ou un basculement implicite vers un autre bucket |
| API de recherche Earth Search | Service public décrit par Element 84 ; disponibilité fournie au mieux | Aucune promesse de disponibilité permanente ; garder les packs préparés utilisables sans API après téléchargement |
| Leaflet | Dépendance libre déjà embarquée | Conserver son attribution/licence ; ne pas ajouter une API cartographique payante |
| Préparation sur poste | Traitement local et outils libres | Utilise du temps, du stockage, de l'électricité et une connexion existants ; ce ne sont pas de nouveaux services cloud gratuits illimités |
| Hébergement Pages existant | Aucun nouvel hébergement ou abonnement souscrit | **Capacité restante et consommation mensuelle non vérifiées. Adéquation de l'usage aux conditions Pages à confirmer avant diffusion des packs** |
| Stockage des images dans le téléphone | Pas de service distant facturable pour lire des blobs déjà présents | Quota, persistance, espace réellement disponible et mémoire dépendent du téléphone |
| Téléchargement par l'agent | Aucune facturation à la requête ajoutée par le code envisagé | Le forfait de données mobiles ou le Wi-Fi restent à la charge de l'utilisateur ou de l'organisation |

Sources primaires vérifiées le 24 novembre 2026 : [licence Copernicus Sentinel](https://cds.climate.copernicus.eu/licences/ec-sentinel), [registre Sentinel-2 COG AWS](https://registry.opendata.aws/sentinel-2-l2a-cogs/), [documentation Earth Search](https://github.com/Element84/earth-search), [collections Sentinel-2](https://github.com/Element84/earth-search/blob/main/docs/collections/sentinel-2-l2a.md), [licence Leaflet](https://github.com/Leaflet/Leaflet/blob/v1.9.4/LICENSE).

Pour des images découpées ou adaptées, l'attribution peut reprendre « Contains modified Copernicus Sentinel data [année] », avec l'année réelle. La gratuité de la donnée n'autorise pas à copier un fond tiers ou à ignorer les conditions d'un hébergeur. Aucune tuile Google, Esri ou du serveur public standard d'OpenStreetMap n'est à aspirer pour constituer les packs.

### Limites de l'hébergement existant

GitHub indique une taille maximale de 1 Go pour le site publié, une limite souple de 100 Go de bande passante par mois et des limitations possibles de service. La taille Git du dépôt ne mesure ni la taille de publication ni le quota de trafic restant. Les conditions excluent aussi certains usages principalement consacrés aux transactions commerciales ou au SaaS. L'application étant déjà hébergée sur Pages, cela ne suffit pas à établir que toute extension de cet usage est admise : l'adéquation doit être examinée avant diffusion des packs. [Limites officielles GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

Avant publication, calculer la taille du site produit et le volume mensuel prévu des packs : somme des octets de chaque zone multipliée par ses téléchargements et mises à jour attendus. Garder une marge explicite pour le reste du site et les OTA. Si ces données ou l'adéquation de l'usage restent inconnues, le verdict « zéro coût additionnel en exploitation » reste **non démontré**. Aucun service payant de remplacement ne doit être activé automatiquement.

## 5. Séparation des cartes et de l'OTA

[La liste du bundle Web](../../android/scripts/web-bundle-lib.mjs) inclut notamment `shared/`, `operations/`, `assets/` et `fbms/`. Les placer sous ces dossiers ferait entrer les images dans chaque bundle. Le répertoire racine `cartes-hors-ligne/` est hors de cette liste.

| Contenu | Emplacement architectural | Diffusion |
|---|---|---|
| Code du gestionnaire et intégration | `shared/`, `operations/` | OTA signée existante |
| Catalogue, manifestes de zones et images | Répertoire racine `cartes-hors-ligne/` | Téléchargement distinct, demandé par l'agent |
| Copie des zones prêtes | IndexedDB dédiée dans l'origine FBMS | Lecture locale après téléchargement |
| Parcelles, arbres, observations, files en attente | Bases métier existantes | Mécanismes existants, inchangés |

Les limites du moteur sont de 12 Mio par fichier et 60 Mio par bundle. Il ne faut pas les contourner en relevant les seuils. Le code du gestionnaire doit rester léger ; les cartes ne sont pas une ressource obligatoire de démarrage de l'application.

Depuis l'APK, une URL relative telle que `../cartes-hors-ligne/catalogue.json` vise `appassets.androidplatform.net` et est interceptée localement. Le catalogue distant et les téléchargements doivent employer une URL HTTPS absolue configurée et autorisée. Le rendu d'une zone prête doit ensuite employer uniquement les blobs locaux. Un jeton distant arrivé à expiration ne doit pas empêcher la lecture d'images légalement conservées.

## 6. Exigences de stockage

- Une zone n'est « prête » qu'après vérification de tous ses fichiers, tailles, empreintes, bornes et niveaux de zoom annoncés. Les fichiers opportunément consultés en ligne ne suffisent pas.
- Le manifeste garde la date de l'image, la résolution réelle, l'attribution, la provenance, les bornes et le contenu attendu. Une zone nuageuse ou sans données doit être signalée et peut être refusée pour la mission.
- La nouvelle version d'une zone reste séparée de la dernière version valide jusqu'à validation complète. Un échec ne doit pas détruire cette dernière.
- Le téléchargement doit prévoir reprise, annulation et erreurs d'écriture. Une zone incomplète ne doit pas recevoir le statut « prête ».
- L'espace nécessaire inclut la nouvelle zone, l'ancienne version conservée, les écritures temporaires et une réserve pour les opérations métier. `navigator.storage.estimate()` est une estimation, pas une réservation ni une preuve d'espace libre natif.
- IndexedDB et les autres stockages de la même origine peuvent partager le quota et subir une éviction commune. Créer une base séparée ne les isole pas de ce risque. La demande de persistance peut être refusée ou indisponible selon le runtime. [Documentation du stockage navigateur](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- Supprimer une zone ne doit toucher que ses fichiers et métadonnées. Aucune opération ne doit vider globalement IndexedDB, CacheStorage, localStorage, les données Android ou les files métier.
- Une bascule de compte ne doit pas exposer les positions ou affectations d'un autre utilisateur. Le fond satellite public et les couches métier doivent conserver leurs règles d'accès respectives.

## 7. État des preuves et portes de livraison

| Porte | État à la rédaction de cet audit | Preuve attendue |
|---|---|---|
| Capacités du runtime | Sources inspectées | Fichiers et commit cités ci-dessus |
| Provenance, droits et préparation du pilote | **Vérifiés pour le pilote public de Bouaké** | [Préparation et sources](PREPARATION.md), [preuves satellite](PREUVES_SATELLITE.json) |
| Capacité et adéquation de l'hébergement | **Non vérifiées** | Taille de publication, consommation existante et projection, décision sur l'usage Pages |
| Contrats et stockage du nouveau gestionnaire | **30 tests de contrat et 11 simulations de stockage réussis** | [Validation et limites](VALIDATION.md) ; le stockage simulé ne constitue pas une preuve Android |
| Affichage et parcours navigateur aux trois tailles | **Non exécutés** | Chromium local échoue avant l'ouverture d'une page ; aucun rendu ni capture d'interface n'est revendiqué |
| Recette sur APK distribuée | **Non exécutée** | [Recette Android](RECETTE_ANDROID.md), binaire et environnement identifiés, preuves expurgées |
| Persistance après OTA avec données en attente | **Non exécutée** | Avant/après sur le runtime exigé, mêmes packs et mêmes opérations |
| Signature officielle | **Non exécutée ; clé non fournie à cet audit** | Signature vérifiée avec la clé publique déjà embarquée |
| Publication stable et réception | **Non exécutées** | Manifeste servi identique, téléchargement et activation observés sur appareil |

Dans cet environnement, les contrôles ciblés ont trouvé Java 21 runtime, mais pas `javac`, `adb`, `emulator`, le JAR `org.json` attendu ni `/dev/kvm`. Ce constat ne déclare pas indisponible un éventuel poste externe. Un résultat Chromium est une preuve navigateur, pas une recette Android.

La version stable inspectée est `1795470423`, `2026.11.23-2147.58e61e8`. [La documentation des repères GPS](../reperes-gps/REPERES_GPS_20261123.md) rapporte sa réception sur l'itel S688LN ; elle ne prouve pas la nouvelle fonction de cartes.

Un contrôle critique non exécuté, une donnée manquante ou un résultat indéterminé bloque la publication stable. Aucun compteur de tests passés ne compense une de ces portes.

## 8. Procédure OTA à exécuter après validation

1. Terminer les modifications dans une branche dédiée. La PR n'est pas une publication. Respecter la revue humaine demandée par `agent-policy.yml` pour le HTML et le JavaScript métier ; aucun push direct sur `main`.
2. Fixer le commit du code et les manifestes des packs à tester. Enregistrer les empreintes des fichiers réellement testés. La recette porte sur la chaîne complète et le binaire officiel identifié, pas sur un APK modifié présenté comme équivalent.
3. Exécuter la recette Android. Une cible de recette doit éviter toute création de données fictives en production. Si le binaire officiel ne peut pas rejoindre un environnement autorisé sans modifier le contenu testé, documenter ce blocage et garder la porte ouverte.
4. Après les contrôles et la revue, comparer le contenu de la fusion au contenu testé. Toute différence applicative exige une vérification proportionnée au changement et un nouveau manifeste de preuves ; ne pas signer silencieusement un autre contenu.
5. Sur le poste autorisé qui possède la clé privée officielle, utiliser le script existant `node android/scripts/publish-web-update.mjs --channel stable --key <chemin-de-la-clé-officielle-hors-dépôt> --write-root-version`, depuis le commit propre exact à publier. Ne jamais copier la clé dans le dépôt, la journaliser, la remplacer ou changer la clé publique embarquée.
6. Exécuter `node android/scripts/publish-web-update.mjs --channel stable --verify`. Contrôler la séquence monotone, le commit, les empreintes et les limites du bundle. Les images ne doivent pas apparaître dans sa table `files`.
7. Soumettre les artefacts signés de `android-updates/stable/` et `version.json` dans une PR de publication, suivant le processus existant. Aucune modification du workflow ou de la politique n'est nécessaire pour contourner une absence de clé.
8. Après publication autorisée, vérifier le manifeste réellement servi, puis distinguer : publié, téléchargé, activé, démarrage confirmé, et parcours métier validé. Relever la version active dans l'application. Ne pas conclure à la réception sur tous les téléphones parce que Pages sert les fichiers.

Le banc `android/tests/jvm/run-format2-e2e.sh` utilise une copie isolée et des clés de test pour vérifier le moteur ; il ne remplace pas la recette WebView. L'ancien `android/tests/jvm/run.sh` refuse une arborescence `android-updates/` existante : ne pas effacer cette arborescence pour faire passer le test.

## 9. Notice courte pour l'agent

La [notice agent](NOTICE_AGENT.md) est prête. Parcours à valider sur la version candidate avant sa diffusion :

1. Avec du réseau, ouvrir les cartes hors ligne dans FBMS, choisir la zone et vérifier sa date, sa résolution, son emprise et son volume.
2. Télécharger et attendre l'état « Disponible hors ligne ». Un téléchargement incomplet ne garantit aucune couverture hors réseau.
3. Préparer également les champs et observations avec les commandes existantes : télécharger un fond ne télécharge pas automatiquement toutes les données métier.
4. Avant de partir, vérifier un déplacement dans la zone sans réseau. Sur le terrain, utiliser les repères GPS ou saisir latitude et longitude comme auparavant.
5. Au retour du réseau, contrôler la synchronisation des opérations. Mettre à jour les fonds séparément si une nouvelle image est utile.
6. Pour libérer de l'espace, supprimer une zone dans le gestionnaire. Ne jamais désinstaller FBMS ni effacer ses données pour supprimer une carte.

## 10. Récupération sans perte des données métier

| Incident | Action attendue | Données à conserver |
|---|---|---|
| Téléchargement interrompu | Reprendre ou annuler la zone partielle | Dernière version prête et toutes les files métier |
| Fichier corrompu ou empreinte incorrecte | Refuser l'activation ; retélécharger les fichiers concernés | Zone valide précédente |
| Espace insuffisant | Arrêter proprement ; supprimer une ancienne zone via le gestionnaire après choix de l'utilisateur | Toutes les opérations non synchronisées |
| Image inutilisable : nuages, mauvaise emprise | Choisir une autre zone/date préparée ; afficher clairement l'absence de fond utile | Coordonnées et couches métier |
| Régression du code | Utiliser le mécanisme OTA existant de retour vers une version saine, avec une nouvelle séquence et signature officielles | Base des packs et bases métier ; ne pas les supprimer lors du retour arrière |
| Perte du stockage par action système/utilisateur | Signaler l'absence réelle de pack et proposer un nouveau téléchargement | Ne pas prétendre que des données effacées sont récupérables depuis un cache inexistant |

Une version antérieure qui ne connaît pas la base des cartes doit la laisser intacte. Un retour arrière ne doit déclencher ni migration destructive ni purge générale. Toute opération en attente doit rester inspectable et synchronisable par les mécanismes métier existants.

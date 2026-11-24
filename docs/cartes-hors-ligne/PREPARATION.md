# Préparer une carte satellite hors ligne gratuite

## Paquet pilote disponible

Le [catalogue](../../cartes-hors-ligne/catalogue.json) contient une **zone urbaine publique de démonstration à Bouaké**, d’environ 2,2 × 2,2 km. Cette emprise ne correspond à aucune parcelle ni à aucun producteur enregistré dans FBMS. Elle sert à la recette et à la démonstration du téléchargement.

Le [manifeste](../../cartes-hors-ligne/bouake-pilote-sentinel2/2026-02-20/manifest.json) référence sept PNG RGBA de 256 × 256 pixels, couvrant tous les zooms XYZ de 12 à 14. Leurs tailles totalisent **184 144 octets**, hors manifeste. Le fond provient de la vraie scène Sentinel-2 L2A `S2B_T30NTP_20260220T104813_L2A`, acquise le **20 février 2026 à 10:59:00 UTC**. Sa résolution source est de **10 mètres**.

Cette image permet de situer le terrain à l’échelle du paysage. Elle ne permet pas de reconnaître chaque arbre individuellement. Les arbres, blocs, parcelles et observations de FBMS doivent être dessinés à partir de leurs propres coordonnées, sans déduire de faux repères de l’image satellite.

Les [preuves de préparation](PREUVES_SATELLITE.json) contiennent les caractéristiques source, les résultats SCL, les contrôles des fichiers et les limites de cette vérification. Elles ne constituent pas une preuve de test Android ni de réception OTA.

## Données autorisées et coût

Les pixels sont issus du jeu public **Sentinel-2 Cloud-Optimized GeoTIFFs**, distribué par Element 84 dans AWS Open Data. Le [registre officiel](https://registry.opendata.aws/sentinel-2-l2a-cogs/) indique l’accès anonyme sans compte AWS. Sa [configuration officielle](https://github.com/awslabs/open-data-registry/blob/main/datasets/sentinel-2-l2a-cogs.yaml) déclare `RequesterPays: False`. La [documentation du producteur du jeu COG](https://github.com/Element84/earth-search/blob/main/docs/collections/sentinel-2-l2a.md) décrit les collections et leur origine.

La [licence Sentinel](https://cds.climate.copernicus.eu/licences/ec-sentinel) autorise reproduction, adaptation et redistribution, avec mention de source. La [présentation officielle Copernicus](https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2) inclut explicitement les utilisateurs commerciaux dans l’accès gratuit. Conserver cette attribution dans le paquet et dans la carte :

`Contains modified Copernicus Sentinel data 2026. COG: Element 84 / AWS Open Data.`

La valeur STAC `license: proprietary` renvoie ici à la licence particulière Sentinel; elle ne constitue pas une exigence d’abonnement. Ne pas la remplacer arbitrairement par CC BY. Ne pas substituer des captures Google, Esri ou des mosaïques soumises à une clause non commerciale.

La préparation utilise Python, GDAL et numpy sur un ordinateur existant. Le pilote a été réalisé sans compte, sans clé API et sans service de calcul cloud. Le RGB source complet pèse **301 124 447 octets** et son SCL **3 787 214 octets**. La lecture partielle COG nécessaire au traitement retenu a transféré **4 849 566 octets** de corps de réponses, selon les en-têtes HTTP Content-Range. Ce chiffre exclut les métadonnées STAC, les en-têtes et la présélection rejetée.

La publication réutilise l’hébergement existant après contrôle de ses quotas. La gratuité de la source ne signifie pas que sa disponibilité ou un volume de diffusion illimité sont garantis. La connexion Internet, le stockage et l’ordinateur restent des ressources existantes utilisées. Aucun abonnement payant ou mécanisme de dépassement facturé ne doit être ajouté pour préparer ces paquets.

## Dimensionnement et enveloppe de diffusion

Le coût en octets dépend de la surface, des zooms, de la compression et du nombre de téléphones. Pour le pilote, les sept tuiles couvrent environ 2,2 × 2,2 km avec des images de 256 × 256 pixels. Le poids réel de chaque nouveau paquet doit être mesuré; il ne doit pas être extrapolé à partir de cette seule zone urbaine.

Une enveloppe initiale de transfert s’estime ainsi : **nombre de téléchargements × poids réel des tuiles**, auquel s’ajoutent manifestes, catalogues, en-têtes, reprises ou répétitions. Ainsi, **100 téléphones × 184 144 octets = 18 414 400 octets, soit environ 18,4 Mo** de tuiles pour un téléchargement complet par téléphone, plus ces autres flux. Deux téléchargements complets par téléphone doubleraient cette charge utile. Ce calcul ne mesure pas les quotas disponibles de l’hébergement.

La capacité publiée à prévoir est la **somme des tailles de toutes les versions encore servies**, plus les métadonnées. Sur chaque téléphone, le remplacement atomique exige temporairement l’ancienne et la nouvelle version, plus les métadonnées et les marges de stockage. L’espace réellement disponible et les quotas de diffusion doivent être contrôlés séparément avant d’élargir le catalogue ou le nombre de téléphones.

## Outils et reproduction

Le [générateur](../../scripts/cartes-hors-ligne/preparer-paquet-sentinel.py) fonctionne avec Python 3, GDAL et numpy. L’environnement de préparation vérifié possède **GDAL 3.10.3 et numpy 2.2.4 dans `/usr/bin/python3`**. Le Python du runtime par défaut ne charge pas nécessairement les mêmes modules.

Pour reproduire les tuiles du pilote à partir des mêmes métadonnées publiques :

```sh
curl --fail --location \
  'https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a/items/S2B_T30NTP_20260220T104813_L2A' \
  --output /tmp/fbms-bouake-source-stac.json

/usr/bin/python3 scripts/cartes-hors-ligne/preparer-paquet-sentinel.py \
  --bbox -5.06 7.67 -5.04 7.69 \
  --id bouake-pilote-sentinel2 \
  --name 'Bouaké • zone pilote publique' \
  --version 2026-02-20 \
  --item /tmp/fbms-bouake-source-stac.json \
  --output /tmp/fbms-bouake-reproduction
```

Le répertoire de sortie doit être vide. L’horodatage `preparedAt` reflète la nouvelle préparation; le hash du manifeste nouvellement produit différera donc de celui du pilote publié, même si les pixels restent identiques. La vérification visuelle n’est pas automatiquement reprise : le nouveau manifeste conserve `quality.reviewStatus: needs-review` jusqu’à l’inspection effective.

Pour une autre zone autorisée, fournir ses bornes WGS84 et omettre `--item`. Les options `--start` et `--end` limitent la période recherchée. Le script présélectionne une scène de moins de 5 % de nuages au total, puis vérifie SCL sur la zone. La limite du pilote est de 25 km², avec chaque côté entre 100 m et 10 km, et un zoom maximal de 14. La préparation ne réalise pas de mosaïque automatique de plusieurs dates.

Une scène rejetée exige de choisir un autre item STAC ou d’élargir explicitement la période. Il faut conserver les métadonnées de la scène retenue pour pouvoir reproduire la préparation.

## Qualité à vérifier avant publication

Le pourcentage nuageux de la scène entière ne garantit pas la qualité d’une petite zone. La première scène envisagée pour ce pilote avait seulement **0,270526 %** de nuages, mais **67,302124 %** de la zone ne possédait aucune donnée. Elle a été rejetée avant la lecture du RGB.

La scène retenue présente **3,299206 %** de nuages au total; le contrôle SCL local donne **0 %** de nuages, ombres de nuage, données absentes/défectueuses et pixels non classés. L’aperçu a été inspecté : stade, routes et tissu urbain visibles. Les [classes SCL documentées par Copernicus](https://sentiwiki.copernicus.eu/web/s2-processing) restent une classification algorithmique, sans garantie absolue contre un voile atmosphérique.

Avant de passer le manifeste à `verified`, examiner l’aperçu réel et les résultats SCL, puis contrôler les tuiles. Toute zone incomplète ou inexploitable doit rester refusée. Ne jamais créer de pixels ou de repères GPS fictifs pour compléter l’image.

Le [validateur indépendant](../../tests/cartes-hors-ligne/valider-paquet.py) relit les fichiers locaux et les vrais pixels. Il vérifie les SHA256, les tailles, le catalogue, la grille XYZ à chaque zoom, les dimensions RGBA et l’absence de trou transparent pour chaque centre de pixel à l’intérieur des bornes annoncées. Il contrôle également que la validation de qualité est renseignée. Il ne refait pas une interprétation visuelle ni le calcul SCL depuis la source distante.

```sh
/usr/bin/python3 tests/cartes-hors-ligne/valider-paquet.py
```

Ce contrôle ne nécessite aucun réseau. Il ne remplace pas la recette de téléchargement et de conservation sur Android.

## Publication d’une nouvelle zone

Conserver chaque version sous **`cartes-hors-ligne/<id>/<version>/`**, en dehors de `assets/`, `shared/` et `operations/`, afin de séparer le poids des cartes de l’OTA applicative. Les deux noms de répertoires doivent correspondre à l’`id` et à la `version` du manifeste. Leurs URL sont immuables : ne jamais écraser le manifeste ou les pixels d’une version déjà publiée.

1. Copier uniquement `manifest.json` et les PNG qu’il référence. Le TIFF intermédiaire, les aperçus, les `.aux.xml` et journaux ne sont pas nécessaires au téléphone.
2. Publier d’abord le dossier complet de la nouvelle version, puis mettre à jour l’entrée dans `cartes-hors-ligne/catalogue.json` avec `manifest: '<id>/<version>/manifest.json'`, l’emprise, les zooms, le poids réel, la résolution et la date d’acquisition. Le catalogue peut changer; les URL des versions qu’il référence restent immuables.
3. Calculer `manifestSha256` sur les octets exacts du manifeste final, après validation visuelle et toute modification de métadonnées.
4. Si un contenu déjà publié change, incrémenter sa `version` avec `--version` et créer un nouveau dossier. La version du paquet et la date d’acquisition sont deux informations distinctes. Conserver les anciennes versions servies pour que les téléchargements interrompus puissent reprendre à leurs URL d’origine; leur retrait exige une règle explicite de rétention.
5. Exécuter le contrôle local puis la recette Android prévue par le projet avant toute activation en production.

Un paquet doit rester autonome après téléchargement, avec son attribution et ses métadonnées. Le lecteur conserve la version valide précédente jusqu’à la vérification complète d’une nouvelle version. Supprimer un paquet de fond de carte ne doit jamais supprimer les données métier.

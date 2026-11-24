# Validation du candidat : cartes satellite hors ligne

Date : 24 novembre 2026. Base inspectée : `a52bc440015c48df977b19512a142d66adf36d87`.

**PARTIEL AVEC BLOCAGE.** Le code et le paquet satellite sont préparés en branche. Ils ne sont pas publiés en production et aucune réception OTA n'est revendiquée. Les empreintes des fichiers concernés sont enregistrées dans [PREUVES_TESTS.json](PREUVES_TESTS.json). La référence finale de commit est celle de la PR qui porte ces fichiers ; comparer ses fichiers à ces empreintes avant reprise.

## Contrôles exécutés

| Contrôle | Résultat observé | Portée exacte |
|---|---|---|
| Contrat du catalogue et des paquets | **30 / 30** | Grille XYZ complète, chemins, types, empreintes et volumes, limites de qualité et droits déclarés, emprises et budget de stockage |
| Gestionnaire avec stockage simulé | **11 / 11** | Vrai code FBMS dans Node, `fake-indexeddb@6.2.4`, transport local simulé ; vraies empreintes et vrais PNG du pilote |
| Cœur GPS existant | **14 / 14** | Formats, signes, bornes, origines, précision et payloads des repères |
| Cœur cartographie existant | **42 / 42** | Géométrie, surfaces, gabarit, déplacement, métadonnées et payload de contour |
| Images du pilote | **7 / 7, 184 144 octets** | SHA256, dimensions 256 × 256, RGBA, grille et absence de pixels transparents à l'intérieur des bornes ; lecture réelle des images par GDAL |
| Syntaxe JavaScript du dépôt | **0 erreur nouvelle** sur 140 fichiers | Une erreur historique de `shared/alis-hardening.js` est déjà admise par le référentiel, inchangé |
| Structure HTML | **0 écart nouveau** sur 40 pages | Trois écarts historiques et trois remarques déjà présents ; aucun seuil abaissé |
| Liens internes | **0 lien cassé nouveau** sur 40 pages | Quatre liens cassés historiques ; référentiel inchangé |
| Diff Git | **Conforme** | Pas d'erreur d'espacement, aucun fichier de politique, base métier ou code natif modifié |
| Inclusion OTA et analyse statique du runtime | **Aucune alerte de l'analyse existante** | Les trois nouveaux fichiers `shared/cartes-hors-ligne*` sont inclus ; aucun fichier de `cartes-hors-ligne/` n'entre dans le bundle |
| CORS du site existant | **HTTP 200, `Access-Control-Allow-Origin: *`** | Contrôle HEAD de l'image publique existante `icon-192.png` ; ne prouve pas la publication du nouveau catalogue |
| Architecture métier Operations Suite | **Conforme après actualisation des attentes de cache** | Le contrôle a détecté des tests figés sur les anciennes versions des scripts Observatoire et Parcelles. Les trois tests concernés attendent désormais les versions exactes chargées ; leurs assertions métier sont conservées. |
| Consentement GPS, parcours existant | **10 / 10** | Enregistrement explicite, absence de présomption, refus/retrait, version de cache et provenance Esri conservés |

### Scénarios de stockage simulés

Les onze cas vérifient le téléchargement complet, la reprise sans retéléchargement des images bonnes, la corruption locale de même taille, la concurrence entre deux gestionnaires, une mise à jour interrompue gardant l'ancienne carte, le refus faute d'espace, la suppression limitée aux cartes, le refus sans compte et la corruption pendant le transport. Deux régressions ciblées vérifient aussi le volume réel après deux interruptions et l'absence de recréation d'une carte supprimée pendant une vérification tardive.

Le banc préserve une file métier, un brouillon et une photo **fictifs**, dans une base distincte. Aucune donnée de production n'est lue ou écrite par ces tests. La nouvelle instance JavaScript du banc partage une base simulée en mémoire : elle **ne prouve pas une conservation sur disque après redémarrage**. La doublure `createImageBitmap` lit les dimensions PNG et ne remplace pas le décodeur d'un navigateur.

### Commandes reproductibles

```sh
node --test tests/cartes-hors-ligne/coeur.test.cjs
FBMS_TEST_MODULES=/chemin/vers/node_modules node --test tests/cartes-hors-ligne/stockage.test.cjs
/usr/bin/python3 tests/cartes-hors-ligne/valider-paquet.py
node tests/reperes-gps/coeur.test.cjs
node tests/cartographie/coeur.test.cjs
node .github/scripts/verifier-js.mjs
node .github/scripts/verifier-html.mjs
node .github/scripts/verifier-liens.mjs
```

Le répertoire `FBMS_TEST_MODULES` doit contenir `fake-indexeddb@6.2.4`. Cette dépendance est réservée aux tests et n'est pas ajoutée à l'application. Le validateur Python utilise GDAL et numpy déjà présents dans l'environnement de préparation.

## Contrôles non exécutés et blocages

| Porte bloquante | État et cause |
|---|---|
| Affichage réel, commandes et performances à 390 × 844, 768 × 1024 et 1440 × 900 | **NON EXÉCUTÉ.** Chromium installé échoue au démarrage : `socket() failed: Operation not permitted`. La tentative d'installation de Chrome Headless Shell par Playwright a reçu HTTP 403. Aucune capture d'écran d'interface n'est fabriquée. |
| Vrai décodage `ImageBitmap`, rendu Leaflet et parcours intégrés | **NON EXÉCUTÉ.** Nécessite un navigateur autorisé et la recette APK. |
| Mode avion, arrêt forcé, redémarrage et secteur jamais consulté | **NON EXÉCUTÉ.** Aucun téléphone ITEL ni émulateur Android accessible dans cette session. |
| Conservation réelle d'une file métier et synchronisation serveur | **NON EXÉCUTÉ pour cette livraison.** Les tests de stockage utilisent des données fictives et un transport simulé. Les contrats métier sont inchangés dans le diff. |
| Compte, consentement et ancien client sur le runtime distribué | **NON EXÉCUTÉ.** Gardes relues, aucune nouvelle migration ou propriété métier ; cette inspection ne remplace pas le scénario demandé. |
| OTA officielle et conservation des cartes lors d'une OTA suivante | **NON EXÉCUTÉ.** APK officielle non exécutée, clé officielle non accessible dans cette session. Aucun remplacement de clé effectué. |
| Réception et activation sur ITEL S688LN | **NON VÉRIFIÉES.** Aucun nouveau bundle stable publié. |
| Gratuité de l'exploitation à l'échelle des missions | **NON DÉMONTRÉE.** Pilote préparé sans dépense ; capacité restante, trafic et adéquation de l'hébergement existant à confirmer. |

Ces portes restent bloquantes même si les tests Node sont verts. Le navigateur de bureau ne remplacera pas la [recette Android](RECETTE_ANDROID.md). Une nouvelle APK de développement ne remplace pas le binaire déjà distribué.

Le contrôle GitHub « Éligibilité à la correction automatique » refuse les modifications HTML/JS métier selon les listes du dépôt. Cette PR porte le label `human-review` et reste en brouillon ; aucune liste, règle, exigence ou valeur de référence n'a été modifiée pour contourner cette revue. Les résultats des autres contrôles GitHub sont visibles dans la PR.

## Reprise sans recommencer le développement

1. Ouvrir la PR candidate et vérifier son commit ainsi que les empreintes jointes. Respecter la revue humaine prévue par `agent-policy.yml`.
2. Exécuter les parcours navigateur dans un environnement qui permet Chromium, avec uniquement des données fictives et des services isolés.
3. Utiliser l'APK officielle sur un téléphone ou un émulateur et exécuter la recette Android complète. Ne pas mélanger le pilote public avec des coordonnées de producteurs dans un rapport public.
4. Confirmer les droits et capacités de distribution, puis préparer les vraies zones de mission autorisées. Le pilote urbain ne représente aucune parcelle FBMS.
5. Après réussite des portes, signer l'exact contenu validé avec la chaîne existante, publier selon les règles du dépôt et observer la version réellement activée. Aucune de ces étapes n'est déclarée accomplie par le présent rapport.

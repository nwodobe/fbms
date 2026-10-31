# AFLP FIELD PROOF — note d'architecture et de compatibilité Android / iOS

Version 1.1.0 · 31/10/2026 · branche `feature/aflp-field-proof`

## 1. Objectif réel

Permettre à un agent AFLP de **documenter une activité terrain sans réseau** (photos et vidéos portant
agent, cluster, village, activité, date, heure, position) et à un responsable de **contrôler** les fichiers
reçus. Ce n'est pas une application caméra : c'est un dossier de preuves cohérent, identifié et vérifiable,
qui ne transite par aucun serveur.

## 2. Ce qui a été trouvé dans FBMS (audit du 31/10/2026, commit `0e69300`)

| Élément | Constat | Conséquence pour le module |
|---|---|---|
| Site statique GitHub Pages, sans build | `.nojekyll`, aucun `package.json` à la racine | Module en JavaScript ES5 sans dépendance ni compilation, comme `moto/` |
| Authentification | `shared/auth-gate.js` (zone interdite) publie `window.ANAGROCI_AUTH` et l'événement `anagroci:authenticated` ; hors ligne, il reprend le profil mis en cache | Identité de l'agent lue sans modifier auth-gate ; clé de module `fbms` (niveaux bm / chef / agent) |
| Rôles et périmètres | `shared/aflp-access.js` : `normalizeUser`, `inScope`, référentiel zones → clusters | Clusters et villages proposés filtrés par périmètre (constaté : un Unit Head Botro ne voit pas Diabo) |
| Référentiel villages | table `villages` (colonnes `id`, `village`, `cluster`, `data.s1`), protégée par RLS | **Lecture seule**, mise en cache locale pour le hors-ligne ; aucune écriture |
| Hors ligne | `sw.js` (zone interdite) : réseau d'abord + cache pour toute page hors `/operations/`, cache d'abord pour les fichiers du site | Module placé dans `fieldproof/` : rouvert hors ligne **sans modifier sw.js** (vérifié, T23) |
| Politique agents | `index.html` et `*.html` exigent une revue humaine ; `supabase/`, `sw.js`, `shared/auth-gate.js` interdits | Aucun de ces fichiers protégés n'est modifié ; `index.html` (carte du portail) passe en revue |

## 3. Trois architectures comparées

| Critère | 1. Module web / PWA dans FBMS | 2. Application hybride (Capacitor) | 3. Composant natif complémentaire |
|---|---|---|---|
| Photo depuis la caméra | Oui (getUserMedia, Android et iOS ≥ 14.3) | Oui | Oui |
| Enregistrement **dans la galerie** | **Non automatique** : téléchargement (Android) ou feuille de partage « Enregistrer » (iPhone). Aucune confirmation possible | Oui (plugin MediaStore / PHPhotoLibrary), confirmé | Oui, confirmé |
| Bandeau permanent sur la vidéo | Oui : réencodage canvas + MediaRecorder (vérifié sur les images décodées par ffmpeg) | Oui, plus efficace (encodeur natif) | Oui |
| Hors ligne | Oui via le SW existant (vérifié) | Oui | Oui |
| Gros fichiers / batterie | Réencodage logiciel du canvas : plus coûteux ; arrêt si l'écran se verrouille | Meilleur | Meilleur |
| Intégration FBMS (comptes, rôles, villages) | Directe (même origine, même session) | À reconstruire (session Supabase dans l'app) | À reconstruire + passerelle |
| Distribution | Aucune : URL FBMS déjà connue | APK (Android) ; iPhone : App Store ou TestFlight, compte Apple Developer | Idem 2, deux bases de code |
| Coût / maintenance | Faible, même dépôt, testable par les portes existantes | Moyen : chaîne de build, signatures, mises à jour | Élevé |

**Choix : solution 1**, la plus simple qui satisfait réellement les exigences, **avec une limite assumée** :
l'écriture dans la galerie reste un geste de l'agent et n'est pas confirmable par le navigateur. Le module
l'affiche honnêtement (« à vérifier » puis « confirmé par l'agent ») au lieu de prétendre le contraire.

**Quand basculer vers la solution 2** : si la recette sur téléphones réels montre (a) que les vidéos H.264
produites ne s'enregistrent pas dans l'app Photos d'iPhone, ou (b) que le réencodage canvas fait chuter la
fluidité sous ~15 images/s sur les téléphones remis aux agents, ou (c) que la direction exige une écriture
galerie confirmée. Le cœur (`fp-core.js`) et le registre sont réutilisables tels quels dans une coque
Capacitor : la bascule ne repart pas de zéro.

## 4. Fonctionnement

```
FBMS (auth-gate, profil en cache) ──► fieldproof/index.html
   fp-core.js    pur : dates Abidjan, identifiants, statut GPS, bandeau, manifeste, SHA-256, CRC-32, ZIP, EXIF
   fp-store.js   IndexedDB « anagroci_fieldproof » : missions, medias, fichiers, morceaux, referentiel
   fp-capture.js caméra, GPS (pendant la capture seulement), photo + EXIF, enregistreur vidéo
   fp-app.js     écrans, galerie de mission, galerie téléphone, partage, export ZIP, contrôle d'un dossier
```

- **Photo** : image de la caméra → canvas agrandi vers le bas → bandeau dessiné **sous** la scène (rien n'est
  masqué) → JPEG qualité 0,90 → segment EXIF (date, auteur, description, GPS, précision).
- **Vidéo** : chaque image de la caméra est redessinée avec le bandeau et le compteur de durée, puis
  réencodée (`canvas.captureStream` + piste micro + `MediaRecorder`). Préférence H.264 dans MP4 ; le format
  obtenu est inscrit au registre. Une **image clé par seconde** est demandée : sans elle, Chrome ne livrait
  aucun segment MP4 avant l'arrêt (défaut constaté par la recette, corrigé).
- **Écriture au fil de l'eau** : chaque seconde de vidéo est écrite en IndexedDB pendant l'enregistrement.
  Stockage saturé, écran verrouillé, appel entrant, fermeture : l'enregistrement s'arrête **en le disant** et
  la partie filmée est conservée ou récupérable au prochain lancement.
- **GPS** : `watchPosition` actif uniquement pendant l'écran de capture, arrêté en le quittant. Photo : position
  au déclenchement. Vidéo : position au **début** (sur le bandeau, libellée comme telle) et position à la fin
  (registre et manifeste). Aucun suivi continu, aucun envoi.
- **Intégrité** : SHA-256 du fichier final (natif < 48 Mo, incrémental par tranches de 4 Mo au-delà). Le
  fichier n'est déclaré conservé qu'après **relecture** (taille et empreinte identiques). Les segments vidéo
  (l'« original ») ne sont supprimés qu'après conservation et contrôle du fichier final.
- **Export** : ZIP standard en mode « stocké » (médias déjà compressés), assemblé en Blob à partir des fichiers
  sur disque, découpé en lots de 450 Mo maximum, avec `manifeste.json`, `manifeste.csv` (séparateur `;`,
  injection de formule neutralisée) et `LISEZ-MOI.txt`.

## 5. Compatibilité attendue (à confirmer sur appareils réels)

| Fonction | Android (Chrome à jour) | iPhone (Safari iOS 15+, écran d'accueil ou navigateur) | Vérifié |
|---|---|---|---|
| Caméra dans l'application | Oui | Oui (HTTPS requis — GitHub Pages l'est) | Chromium simulé |
| Photo + bandeau + EXIF | Oui | Oui | Chromium simulé, fichier contrôlé par PIL |
| Vidéo + bandeau incrusté | Oui | Probable (`captureStream` + MediaRecorder MP4) — **point de vigilance n°1** | Chromium simulé, fichier contrôlé par ffprobe/ffmpeg |
| Codec vidéo / audio | H.264 ; audio AAC si le téléphone l'encode, sinon Opus | H.264 + AAC (natif Safari) | Chromium de test : H.264 + **Opus** (pas d'encodeur AAC) |
| Galerie | Téléchargement → album « Download » de Galerie / Google Photos | Feuille de partage → « Enregistrer l'image / la vidéo » → Photos | Téléchargement vérifié (empreinte identique) |
| Partage WhatsApp | `navigator.share` avec fichiers (Chrome Android) | `navigator.share` avec fichiers | Repli « Télécharger » vérifié ; WhatsApp non testable ici |
| Réouverture hors ligne | Oui (SW existant) | Oui si la page a été ouverte en ligne auparavant | Vérifié (T23, serveur arrêté) |
| Conservation des copies dans l'app | Persistante si `navigator.storage.persist()` accordé | iOS peut purger le stockage d'un site non installé après ~7 jours sans visite : **installer FBMS sur l'écran d'accueil** | Persistance après fermeture vérifiée (Chromium) |

## 6. Stockage : ce qui va où

| Lieu | Contenu | Durabilité |
|---|---|---|
| Galerie Android / Photos iPhone | Copie de référence, déposée par l'agent | Celle du téléphone ; non contrôlable par l'application |
| IndexedDB du navigateur (`anagroci_fieldproof`) | Registre, copie locale des fichiers, segments en cours | Peut être effacée par l'utilisateur ou, sur iPhone, par le système (site non installé). Sert au repartage et à l'export |
| Supabase / serveur | **Rien** | — |

Compromis documenté (exigence §9) : seul le fichier final (avec bandeau) est conservé ; l'image brute de la
caméra n'existe jamais en fichier. Avantage : aucune version « sans bandeau » ne circule. Limite : on ne peut
pas prouver a posteriori que les pixels de la scène n'ont pas été produits autrement — ce que, de toute façon,
aucune empreinte calculée sur le téléphone de l'agent ne prouve.

## 7. Ce que le module ne prétend pas

Horodatage et position viennent du téléphone : ils peuvent être falsifiés (horloge modifiée, GPS simulé).
L'empreinte SHA-256 détecte une modification **après** la création du fichier, pas une mise en scène. Ces
avertissements figurent dans l'interface, le manifeste et le guide. Pour un niveau de preuve opposable, il
faudrait un horodatage serveur (envoi de l'empreinte seule, sans le média) : écarté ici car le mandat interdit
toute transmission automatique ; proposable comme évolution.

## 8. Version 1.1.0 — nom de la localité et galerie automatique

### Nom de la localité sur le bandeau (6e ligne)

| Situation | Source du nom | Exemple de ligne |
|---|---|---|
| Hors réseau | Villages FBMS (`villages.gps_lat/gps_lng` ou `data.s1.gpsLat/gpsLng`, sous-préfecture `s1.sousPrefecture`) **et hubs de cluster de la carte FBMS** (`hubs_clusters.localite`, `gps_lat/gps_lng`), préparés sur le téléphone | `Localité GPS : Village X (S/P Botro) · à 0,4 km — village de la mission` |
| Avec réseau, réglage actif (par défaut) | OpenStreetMap Nominatim + contrôle FBMS | `Localité GPS : Kondrobo, Botro (OSM) · FBMS : Village X — village de la mission` |
| Position loin du village déclaré (> 5 km) | Contrôle FBMS | `… — ÉCART : 6,7 km du village de la mission` (texte en ambre) |
| Sans GPS | — | `Localité : non déterminée (pas de position GPS)` |

Seuils (`fp-core.js`) : au village ≤ 3 km, environs ≤ 15 km, au-delà « hors des villages FBMS » ; écart si le
village déclaré est à plus de 5 km. La vidéo porte la localité **au début** de l'enregistrement.
Couverture constatée en base le 31/10/2026 (lecture seule) : 60/60 villages actifs avec coordonnées et
sous-préfecture, 6/6 hubs avec coordonnées et localité.

**Transmission autorisée** par le Branch Manager (31/10/2026) : avec réseau, les **coordonnées seules** sont
envoyées à `nominatim.openstreetmap.org` (aucun média, aucune identité), pendant l'écran de capture, au plus
une requête toutes les 10 s et seulement après un déplacement de plus de 150 m (politique d'usage Nominatim).
Le nom est préparé avant le déclenchement : aucune attente. Réglage désactivable sur l'accueil.
Google Maps écarté : sa clé API facturée serait lisible dans les pages publiques de FBMS.

### Galerie automatique

Dès « Valider » (réglage actif par défaut) : Android → fichier remis au dossier Téléchargements, indexé par
Galerie / Google Photos (album « Download ») ; iPhone → la fenêtre « Enregistrer l'image / la vidéo » s'ouvre
dans le même geste (Apple exige ce dernier appui). Le statut reste « à vérifier » jusqu'à confirmation de
l'agent, faute de retour du navigateur. Une écriture **garantie et confirmée** dans l'album Photos exige une
application installée (architecture 2, APK Capacitor).

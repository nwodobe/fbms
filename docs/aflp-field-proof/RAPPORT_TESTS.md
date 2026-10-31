# AFLP FIELD PROOF — rapport de tests photo et vidéo

Date d'exécution : 31/10/2026 (GMT) · Navigateur : Google Chrome for Testing 153 (Linux, sans interface) ·
Données : 100 % fictives (agent « AGENT FICTIF E2E », villages « Village Fictif … », coordonnée ronde 7,5 / −5,0).

## 1. Nature des tests — à lire d'abord

| Catégorie | Ce qui est réel | Ce qui est simulé |
|---|---|---|
| Unitaires (`core.test.mjs`) | Code du module exécuté sous Node ; ZIP vérifié par `unzip`, EXIF relu par Pillow, SHA-256 comparé à Node et aux vecteurs NIST | — |
| Navigateur (`fieldproof-e2e.mjs`, `hors-ligne-sw.mjs`) | Pages et scripts du module, IndexedDB, canvas, MediaRecorder, téléchargements, service worker existant ; fichiers produits contrôlés **hors navigateur** (ffprobe, ffmpeg, Pillow, unzip) | Caméra et micro (dispositifs factices Chromium), géolocalisation émulée, `auth-gate.js` et SDK Supabase remplacés par des doublures fictives respectant le même contrat |
| Téléphones Android et iPhone réels | **Non exécutés** : aucun appareil accessible depuis l'environnement de développement | — |

Conséquence : **aucune compatibilité Android ou iPhone n'est déclarée.** Les résultats ci-dessous prouvent
que la logique et les fichiers produits sont corrects dans Chromium ; la recette appareils du §4 reste due.

## 2. Résultats : 32/32 unitaires, 26/26 navigateur, 1/1 hors ligne (deux passes consécutives stables)

| # | Scénario du mandat | Résultat observé | Statut |
|---|---|---|---|
| 1 | Création d'une mission hors ligne | Réseau coupé, badge « Hors ligne », mission créée ; activité non présélectionnée | RÉUSSI (T01) |
| 2 | Plusieurs photos | 2 photos 1920×1350 (1920×1080 + bandeau 270 px), copie relue | RÉUSSI (T02) |
| 3 | Plusieurs vidéos | 2 vidéos H.264 / MP4 de 4,3 s et 2,3 s | RÉUSSI (T03) |
| 4 | Bandeau intégré au fichier | Photo : bas de l'image vert forêt (9,67,39), haut = scène, mesuré par Pillow. Vidéo : bandeau présent sur l'image décodée par ffmpeg au début et à la fin, zone texte différente (compteur de durée) | RÉUSSI (T04a, T06) |
| 5 | Vidéo lisible hors navigateur, image + bandeau + son | ffprobe : MP4, vidéo h264 1280×904, audio présent, durée 4,28 s / registre 4,29 s | RÉUSSI (T05) |
| 6 | GPS activé | Photo : 7,5 / −5,0 ±12 m, relu dans l'EXIF par Pillow. Vidéo : positions début et fin | RÉUSSI (T04b, T07) |
| 7 | Sans GPS | Autorisation retirée : capture permise, avertissement, bandeau « LOCALISATION NON VÉRIFIÉE », pas de GPS EXIF | RÉUSSI (T08) |
| 8 | Caméra / micro refusés | Caméra : message clair, déclencheur inactif, aucun import galerie. Micro : vidéo enregistrée, signalée « MUETTE », ffprobe sans piste audio | RÉUSSI (T16, T17) |
| 9 | Sauvegarde galerie | Fichier téléchargé identique (SHA-256) ; statut « à vérifier » puis « confirmé par l'agent » | RÉUSSI — Chromium bureau seulement (T09) |
| 10 | Réouverture d'une ancienne mission | Nouvelle page : mission, 5 médias et fichiers relus à l'identique | RÉUSSI (T13) |
| 11 | Partage WhatsApp | Jamais automatique ; repli « Télécharger » quand le partage de fichiers est indisponible, consigne « Document » affichée | PARTIEL — WhatsApp non testable hors téléphone (T10) |
| 12 | Export photos + vidéos | ZIP valide (`unzip -t`), 5 médias + manifestes, 5/5 empreintes conformes, CSV 5 lignes ; préparé hors ligne | RÉUSSI (T11) |
| 13 | Stockage presque plein | Espace simulé épuisé en cours de vidéo : arrêt automatique annoncé, 4 s conservées et validables | RÉUSSI (T18) |
| 14 | Vidéo longue ou volumineuse | Hachage incrémental vérifié sur 5 Mo en morceaux irréguliers ; découpage des lots vérifié. **Vidéo réelle de plusieurs minutes non jouée** | PARTIEL |
| 15 | Fermeture / redémarrage | Fermeture pendant l'enregistrement : 3 segments déjà sur disque, vidéo récupérée et lisible (ffprobe). Réouverture hors ligne par `sw.js`, serveur arrêté, nouvelle photo prise | RÉUSSI (T15, T23) |
| 16 | Android et iPhone | Non exécuté | **NON RÉALISÉ** |
| 17 | Non-régression FBMS | `verifier-html` 0 nouveau · `verifier-liens` 0 nouveau · `verifier-js` 0 nouvelle erreur · `verifier-pages` 35 pages × 3 largeurs, 0 nouveau problème | RÉUSSI |
| — | Interfaces 390×844, 768×1024, 1440×900 | Accueil, nouvelle mission, dossier, capture photo, capture vidéo, portail : aucun débordement ; captures dans `tests/fieldproof/resultats/captures/` | RÉUSSI (T20) |
| — | Accessibilité axe-core WCAG 2.1 A/AA | 0 violation sur 6 écrans réels du module (390×844) | RÉUSSI (T22) |
| — | Aucune transmission | 0 écriture Supabase, 0 requête POST/PUT sur toute la recette | RÉUSSI (T19) |
| — | Erreurs console | 0 | RÉUSSI (T21) |

## 3. Défauts trouvés par la recette et corrigés

1. **Segments MP4 non livrés avant l'arrêt** (Chrome, source canvas) : la protection « au fil de l'eau » était
   inopérante, une coupure aurait perdu toute la vidéo. Correction : image clé chaque seconde
   (`videoKeyFrameIntervalDuration`) + alerte à l'agent si un téléphone ne livre toujours rien après 6 s.
2. **Codec** : Chrome produisait du « video/mp4 » contenant du VP9 (mal lu par l'app Photos d'iPhone et
   WhatsApp). Correction : préférence explicite H.264.
3. **Course entre écrans** : une vue asynchrone pouvait écraser l'écran suivant. Correction : jeton de navigation.
4. Libellé manquant (axe-core, critique) sur le commentaire de mission ; barre d'actions collante masquant la
   galerie sur mobile.

## 4. Recette appareils réels à exécuter avant toute déclaration de compatibilité

Sur **un Android d'entrée de gamme** (le modèle remis aux agents) et **un iPhone** (iOS 16 ou plus), FBMS
installé sur l'écran d'accueil :

| # | Geste | Attendu |
|---|---|---|
| A1 | Ouvrir le module en ligne, puis mode avion, fermer et rouvrir | Le module s'ouvre ; badge « Hors ligne » |
| A2 | Mission + 3 photos + 2 vidéos de 2 min, en plein soleil, en mode avion | Fluidité correcte ; bandeau lisible ; son présent |
| A3 | Enregistrer chaque fichier dans la galerie | Présent dans Galerie / Google Photos (Android) et dans Photos (iPhone), avec bandeau, **vidéo lisible dans Photos** |
| A4 | Lire une vidéo depuis la galerie, hors FBMS | Image, bandeau sur toute la durée, son |
| A5 | Partager 1 vidéo vers WhatsApp « Document » puis « Vidéo » | Reçue dans les deux cas ; bandeau visible ; seul « Document » reste « Conforme » au contrôle |
| A6 | Exporter le ZIP, l'envoyer, le contrôler depuis le téléphone d'un responsable | Tous les fichiers « Conforme » |
| A7 | Verrouiller l'écran pendant une vidéo ; refuser le micro ; couper le GPS | Arrêt annoncé et séquence gardée ; vidéo muette signalée ; « LOCALISATION NON VÉRIFIÉE » |
| A8 | Vidéo de 10 min en 1080p | Pas de plantage ; mesurer taille, batterie consommée, température |
| A9 | Revenir 8 jours plus tard (iPhone) | Missions et copies toujours présentes |

Consigner pour chaque ligne : modèle, version du système, version du navigateur, résultat, capture d'écran.

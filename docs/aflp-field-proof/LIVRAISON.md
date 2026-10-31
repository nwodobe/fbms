# AFLP FIELD PROOF — livraison, limites et risques

**Statut : PARTIEL AVEC BLOCAGE** — module développé, intégré au portail et vérifié dans Chromium (32/32
unitaires, 26/26 navigateur, réouverture hors ligne réussie, portes qualité sans nouveau défaut). Blocage :
aucun téléphone Android ni iPhone réel n'était accessible ; la compatibilité n'est donc pas déclarée.

## Livrables

| # | Livrable | Emplacement |
|---|---|---|
| 1-2 | Module et sources | `fieldproof/` |
| 3 | Intégration portail | `index.html`, `fieldproof/portal-fieldproof.css`, `assets/operations/modules/field-proof.webp` |
| 4 | Architecture et compatibilité | `docs/aflp-field-proof/ARCHITECTURE.md` |
| 5 | Rapport de tests | `docs/aflp-field-proof/RAPPORT_TESTS.md`, `tests/fieldproof/resultats/` |
| 6 | Guide agent | `docs/aflp-field-proof/GUIDE_AGENT.md` |
| 7 | Installation et mise à jour | `docs/aflp-field-proof/INSTALLATION.md` |
| 8 | Pull request | branche `feature/aflp-field-proof` |
| 9 | Limites et risques | ce document |

L'image de la carte du portail est une **capture réelle** du module : photo produite par AFLP FIELD PROOF
(bandeau incrusté) et écran du dossier de mission. La caméra était simulée avec la photo de terrain déjà
présente dans le dépôt (`field-buying-real-photo.webp`) ; les noms affichés sont fictifs. Si une photo prise
par un agent AFLP sur le terrain est fournie (avec l'accord des personnes visibles), elle remplacera cette source.

## Limites connues

1. **Galerie automatique mais non confirmable** (v1.1 : déclenchée dès « Valider ») : un navigateur ne peut ni écrire directement dans la galerie ni le vérifier.
   Android : téléchargement (album « Download »). iPhone : feuille de partage « Enregistrer ». Statut affiché
   « à vérifier » tant que l'agent n'a pas confirmé.
2. **Vidéo sur iPhone non vérifiée** : `canvas.captureStream` + MediaRecorder sont pris en charge par Safari
   récent, mais fluidité, format et lecture dans Photos sont à confirmer (recette A2-A4).
3. **Audio Opus possible sur Android** : si le navigateur ne sait pas encoder l'AAC, l'audio est en Opus dans
   le MP4. Lecture correcte dans Chrome, VLC, ffmpeg ; à vérifier dans Photos (iPhone) et WhatsApp.
4. **Réencodage logiciel** : plus de batterie et de chaleur qu'une caméra native ; l'écran doit rester allumé.
5. **Copies dans l'application** : stockage du navigateur, effaçable ; iPhone peut purger un site non installé.
   La copie de référence est celle de la galerie.
6. **Pas de preuve certifiée** : heure et position viennent du téléphone ; l'empreinte détecte seulement une
   modification postérieure. WhatsApp « en photo / vidéo » recompresse (empreinte invalide, EXIF supprimé).
7. **Photo : résolution du flux caméra** (souvent 1920×1080) et non la pleine résolution du capteur.
8. **ZIP ≤ 4 Go par lot** (pas de ZIP64) ; lots plafonnés à 450 Mo.
9. **Liste des activités** proposée (10 entrées) : à valider par le Branch Manager — modifiable dans
   `fp-core.js` (`ACTIVITES`).
10. **Saisie libre d'un village** possible si le référentiel manque ; marquée « village saisi manuellement »
    et sans identifiant FBMS.
11. **Localité** : précision liée aux coordonnées du recensement FBMS (point de référence du village) et, en ligne, à la base OpenStreetMap, inégale en zone rurale. Un « ÉCART » est un signal à vérifier, pas une preuve de fraude (plantation éloignée, mauvais village choisi).
12. **Envoi de la position à OpenStreetMap** (autorisé le 31/10/2026) : coordonnées seules, réglage désactivable ; à mentionner dans l'information des agents.

## Risques résiduels et parades

| Risque | Probabilité | Parade |
|---|---|---|
| Vidéo illisible dans Photos (iPhone) ou refusée par WhatsApp | Moyenne | Recette A3-A5 ; à défaut, coque Capacitor (architecture 2) réutilisant `fp-core.js` |
| Téléphones d'entrée de gamme saccadés en 720p | Moyenne | Mesurer en A2 ; abaisser la qualité standard à 480p si nécessaire |
| Agent qui ne confirme jamais la galerie | Élevée | Suivi par le chef d'unité ; l'export ZIP reste disponible |
| Effacement du stockage du navigateur | Faible à moyenne | Installer sur l'écran d'accueil ; exporter à chaque retour réseau |
| Images de personnes sans consentement | Moyenne | Rappel affiché à chaque capture et dans le guide ; consigne à formaliser par les RH / juridique |

## Étapes nécessitant une autorisation

- Fusion de la PR (revue humaine exigée par `agent-policy.yml` : HTML, logique métier, ressource de marque).
- Recette sur appareils réels (§4 du rapport de tests).
- Validation de la liste des activités et du texte d'information sur l'image des personnes.
- Aucune action Supabase n'est requise.

# AFLP FIELD PROOF 1.2.0 : rafale et appareil photo du téléphone (7 novembre 2026)

Demande du Branch Manager : certains téléphones n'arrivent pas à prendre de photo dans l'APK, parce que l'application leur demande de modifier les réglages. Il veut aussi pouvoir enchaîner les photos, appui après appui, sans limite de nombre. Le compromis anti-fraude a été validé le 7/11/2026.

## 1. Cause constatée dans l'APK (lecture du code, version 1.3.1)

- FIELD PROOF ouvre la caméra **dans** l'application (getUserMedia). L'APK transmet la demande à Android (`onPermissionRequest`). Si l'agent refuse, ou si Android refuse de lui-même après deux refus, l'APK affiche un message qui renvoie vers *Paramètres > Applications*. La page web affichait la même consigne. Ensuite, aucune solution de repli : la galerie était interdite.
- Quand la fenêtre d'autorisation est fermée sans choix, certaines WebView ne répondent jamais. L'écran reste alors bloqué sur « Ouverture de la caméra… ».
- Défaut caché : l'APK **déclare** la permission CAMERA. Android interdit donc à l'application de lancer l'appareil photo du téléphone tant que cette permission n'est pas accordée (SecurityException non interceptée, ce qui ferme l'application).
- Défaut de numérotation : le numéro de la photo suivante était lu sur les 2 derniers caractères (`P99` → `P00`). Au-delà de 99 photos, une photo existante pouvait être écrasée.

## 2. Ce qui change

| Élément | Fichier | Canal de diffusion |
|---|---|---|
| Rafale active par défaut : chaque appui compose et enregistre la photo, file d'enregistrement sans doublon, compteur et vignettes ; désactivable (case « Rafale ») | `fieldproof/fp-app.js`, `fp.css` | Web (Pages) ; APK via mise à jour Web **signée** |
| Numérotation sans limite (`P100`, `P101`…) | `fp-core.js`, `fp-app.js` | idem |
| Caméra refusée ou muette (délai de 15 s) : messages sans renvoi aux réglages, panneau « Prendre les photos avec l'appareil photo du téléphone » ouvert automatiquement ; lien permanent « La caméra ne s'affiche pas ? » | `fp-capture.js`, `fp-app.js` | idem |
| « Prendre une photo » : appareil photo du téléphone, une photo par appui | `fp-app.js` | idem (masqué sur l'APK 1.3.1 quand la caméra est refusée, sinon l'application se fermerait) |
| « Ajouter les photos qui viennent d'être prises » : sélection multiple, contrôle anti-fraude, bandeau AFLP ajouté | `fp-app.js`, `fp-core.js`, `fp-capture.js` | idem, **fonctionne sur l'APK 1.3.1 actuel** |
| Manifeste : colonnes `capture_source` (CAMERA_INTEGREE / APPAREIL_TELEPHONE) et `importe_le_gmt`, ajoutées en fin de ligne | `fp-core.js` | idem |
| APK 1.4.0 (versionCode 7) : appareil photo du téléphone lancé seulement si la caméra est autorisée, SecurityException interceptée, message Android sans renvoi aux paramètres | `android/.../MainActivity.java`, `android/version.properties` | **Nouvel APK** à construire et signer |

## 3. Règle anti-fraude (validée par le Branch Manager)

1. La date de prise de vue écrite par l'appareil photo (EXIF `DateTimeOriginal`) est **obligatoire**. Une capture d'écran ou une image reçue par WhatsApp n'en a pas : elle est refusée.
2. La photo doit avoir **moins de 30 minutes**. Une date dans le futur de plus de 5 minutes est refusée (horloge déréglée).
3. Une même photo ne peut pas être ajoutée deux fois dans la mission.
4. Le bandeau indique « Appareil photo du téléphone, importée à HH:MM ». L'heure affichée est celle de la prise de vue. Le GPS et la localité sont relevés au moment de l'ajout.
5. **Limite assumée :** une photo de la galerie prise ailleurs dans les 30 minutes passe le contrôle. Le contrôleur la reconnaît grâce à la mention sur le bandeau et dans le manifeste.

## 4. Tests réellement exécutés (7/11/2026, Chromium, caméra factice)

| Contrôle | Résultat |
|---|---|
| `node tests/fieldproof/rafale-repli.test.mjs` : règles pures (rang, EXIF, fraîcheur, bandeau, manifeste) | 15/15 |
| `node tests/fieldproof/core.test.mjs` (non-régression) | 46/46 |
| `node tests/fieldproof/e2e/rafale-repli-e2e.mjs` : rafale de 8 appuis, P99 → P100, import de 3 photos lues par OCR, 3 refus anti-fraude, caméra refusée (navigateur, APK 1.3.1 et APK 1.4.0 simulés), caméra muette, 3 largeurs | 16/16 |
| `node tests/fieldproof/e2e/fieldproof-e2e.mjs` (recette complète existante) | 29/29 ; **T17 réécrit** : il vérifiait l'ancienne règle « aucun recours à la galerie », remplacée par décision du Branch Manager |
| `node tests/fieldproof/e2e/hors-ligne-sw.mjs` | réussi (rafale désactivée pour ce parcours « vérifier puis valider ») |
| `verifier-js`, `verifier-html`, `verifier-liens` | 0 nouveau défaut |
| `android/tests/apk-webview-sim.mjs` | ne couvre pas FIELD PROOF ; résultats instables d'une exécution à l'autre, sur `main` comme sur la branche (connexions refusées ici) : non retenu comme preuve |
| Compilation Java de l'APK 1.4.0 | **non exécutée** : SDK Android inaccessible depuis cet environnement |

Rien n'a été testé sur un vrai téléphone.

## 5. Mise en service

1. Revue humaine (le fichier `fieldproof/index.html` est protégé), puis fusion.
2. **Navigateur :** effectif dès la publication GitHub Pages.
3. **APK actuelles (1.3.1) :** signer la mise à jour Web avec la clé privée tenue hors dépôt (`PROCEDURE_MAINTENANCE_APK.md` §2), puis sur chaque téléphone : *Version › Vérifier les mises à jour* → *Redémarrer pour appliquer*. Sans cette signature, les téléphones gardent l'ancienne version.
4. **APK 1.4.0 (facultatif, recommandé) :** construction et signature avec la clé release (§3 de la procédure), installation par-dessus. Ce n'est nécessaire que pour le bouton « Prendre une photo » quand la caméra a été refusée.
5. Essai terrain : un téléphone dont la caméra a été refusée, 10 photos en rafale, puis 5 photos prises avec l'appareil photo et ajoutées en une fois.

# Recette sur l'ITEL S688LN (Android 15)

*Tout ce qui suit distingue trois environnements : (1) l'APK officielle sur l'itel, (2) le navigateur Chrome de l'itel, (3) l'émulateur. Aucun résultat d'émulateur n'est présenté comme un résultat de téléphone.*

## 1. Accès au téléphone le 22/11/2026

- `adb devices` à 11:50 UTC : `192.168.1.174:5555 device` (ADB par Wi-Fi). Pas de câble USB vérifié.
- Le téléphone était **en cours d'utilisation par le Branch Manager** dans l'APK officielle (écran « Cartographier le champ » à 11:51). Je n'ai donc injecté aucun geste et lancé aucun essai intrusif.

## 2. APK officielle : lectures seules du 22/11

| Commande | Résultat |
|---|---|
| `adb shell dumpsys package ci.anagroci.fieldbuying` | versionName 1.4.3, versionCode 10, installateur `com.google.android.packageinstaller` |
| idem, dates | **firstInstallTime = lastUpdateTime = 2026-11-22 11:48:12** (le 21/11 : première installation au 03/11/2026) |
| `adb pull` de l'APK puis `apksigner verify --print-certs` | CN=ANAGROCI FIELD BUYING ; SHA-256 `1f70f69e…a64f1b41` |
| Empreinte du fichier APK | Identique à celle du 21/11 |
| `adb shell screencap` (11:51) | Pastille « v1.4.3 » ; écran « Cartographier le champ » (nouveau parcours actif, donc OTA activée après la réinstallation) |

Conclusion : l'application a été désinstallée puis réinstallée à 11:48. Les données locales antérieures sont perdues. Origine non identifiée par cet audit.

## 3. Essais réels du 21/11 (navigateur Chrome de l'itel, à l'extérieur, doigt du Branch Manager)

Code : commit db61ddd servi au téléphone ; serveur : doublure en mémoire, aucune écriture en production ; parcelle fictive.

| Scénario du mandat | Statut | Constat |
|---|---|---|
| Consentement accordé et confirmé | REUSSI | Décision enregistrée, capture autorisée |
| GPS précis | REUSSI | Précision 1,72 m, capture 23:36:08 UTC |
| Ouverture automatique d'Esri | REUSSI | Carte ouverte sans clic après la capture |
| Image Esri et date | REUSSI | « Image du 11/02/2025 · Vantor · 0,34 m », lue chez Esri |
| Déplacement des points au doigt | REUSSI | Surface 0,52 → 0,41 → 0,40 ha |
| Ajout puis suppression d'un point | REUSSI | Sortie 1 du 21/11 |
| Enregistrement | REUSSI | 4 048 m², 255 m, 4 sommets |
| Comparaison PostGIS | REUSSI | `ST_Area(geography)` WGS 84 : 4 048,17 m² ; périmètre 255,26 m ; écart 0,00 % |
| Vidéo | REUSSI | 2 fichiers, 308 s (dossier de clôture, PREUVES) |

## 4. Scénarios du mandat non exécutés sur le téléphone

| Scénario | Statut | Preuve de remplacement (automatique, Chromium) |
|---|---|---|
| Consentement refusé | NON_EXECUTE sur doigt réel (fait par geste injecté le 21/11) | PG-03, PG-04 |
| Consentement retiré | NON_EXECUTE | PG-29 |
| Absence de consentement | NON_EXECUTE | PG-02, PG-32 |
| GPS imprécis | Constaté le 21/11 à l'intérieur (100 m, capture refusée) | PG-07 |
| Point en attente serveur : brouillon uniquement | NON_EXECUTE | PG-39 (PR #364) |
| Point confirmé : soumission possible | REUSSI le 21/11 (doublure) | PG-21 |
| Réseau coupé avant Esri | NON_EXECUTE | PG-31 |
| Fermeture et réouverture : brouillon récupéré | NON_EXECUTE | PG-25 |
| Déplacer le carré entier, annuler, rétablir | NON_EXECUTE au doigt | PG-16, PG-18 |
| **Parcours complet sur l'APK officielle, données réelles** | **NON_EXECUTE par cet audit** | Aucune |

## 5. Protocole pour fermer ces points (15 minutes, à l'extérieur)

1. Brancher l'itel en USB, vérifier `adb devices`, lancer `adb shell screenrecord`.
2. Dans l'APK officielle, sur un producteur **informé et consentant** : refuser, constater le blocage ; accorder ; capturer ; vérifier l'ouverture d'Esri et la date.
3. Déplacer P1 à P4, déplacer le carré, agrandir, réduire, annuler, rétablir.
4. Mode avion avant l'enregistrement : constater « Brouillon uniquement ». Fermer l'application, la rouvrir : brouillon présent.
5. Réseau rétabli : enregistrer ; relever la superficie ; je la compare à PostGIS en lecture seule.
6. Retirer l'accord en fin d'essai si le producteur le demande : constater le blocage.

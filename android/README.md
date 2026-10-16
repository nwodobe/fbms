# ANAGROCI FIELD BUYING — application Android (APK)

**AFLP 2027 | Field Operations** · identifiant `ci.anagroci.fieldbuying` · Android 7.0 (API 24) et plus

L'APK est la **même application** que la version Web publiée par GitHub Pages
(`operations/field-buying.html`), embarquée dans le téléphone. Comptes, rôles,
politiques RLS et données restent ceux de **Supabase** : il n'existe aucune
seconde base de données.

---

## 1. Architecture en une page

```
Téléphone Android
└─ MainActivity (un seul WebView)
   ├─ AssetServer ── https://appassets.androidplatform.net/…  ← fichiers du dépôt, DANS l'APK
   │                └ cdn.jsdelivr.net, unpkg, cdnjs, Google Fonts ← copies figées (_vendor/)
   ├─ NativeBridge (window.AnagrociNative) : shellStatus · saveFile · print · appInfo
   ├─ bridge.js (APK uniquement) : Service Worker neutralisé, exports → Téléchargements
   └─ réseau ─────────── Supabase (auth, REST, RPC offline_sync_batch) · tuiles de carte
Stockage local : localStorage (session, profil) + IndexedDB anagroci_ops_offline (file hors ligne)
                 dans /data/data/ci.anagroci.fieldbuying — conservé lors des mises à jour.
```

| Fichier | Rôle |
|---|---|
| `version.properties` | **Source unique** : applicationId, versionCode, versionName, SDK |
| `app/src/main/java/…/MainActivity.java` | WebView, retour Android, GPS, appareil photo, fichiers, liens externes |
| `app/src/main/java/…/AssetServer.java` | Sert l'application et les bibliothèques depuis l'APK |
| `app/src/main/java/…/NativeBridge.java` | Pont JavaScript minimal (aucune donnée métier) |
| `app/src/main/java/…/CaptureProvider.java` | Photo de preuve sans permission CAMERA |
| `native-web/bridge.js` | Adaptations navigateur intégré (APK seulement) |
| `scripts/prepare-web.mjs` | Copie l'application Web + bibliothèques figées dans `assets/www` |
| `scripts/build-apk-local.sh` | Compilation sans Gradle (outils SDK seuls) |
| `scripts/render-icons.mjs` | Icônes depuis le logo officiel (tracé de `shared/auth-gate.js`) |
| `tests/jvm/run.sh` | Test JVM du vrai `AssetServer.java` sur le vrai paquet |
| `tests/apk-webview-sim.mjs` | Simulation Android dans Chromium (2 écrans, 41 scénarios × 2) |
| `ci/build-apk.yml.example` | Workflow GitHub Actions à activer **par un humain** |

**Aucune dépendance tierce** côté Android : ni AndroidX, ni Capacitor, ni Cordova.
Seule la plateforme Android est utilisée. Voir le rapport technique pour la justification.

---

## 2. Prérequis

| Outil | Version testée | Pour quoi |
|---|---|---|
| Node.js | 22 | `prepare-web.mjs` (télécharge les bibliothèques depuis npm, une seule fois) |
| JDK | 17 ou 21 | compilation Java |
| **Voie A** Android Studio | Ladybug ou plus récent (AGP 8.7.3, Gradle 8.14.3) | build standard |
| **Voie B** SDK Android en ligne de commande | build-tools ≥ 29, platform ≥ 23 | build sans Gradle |

Bibliothèques embarquées (versions figées dans `prepare-web.mjs`) :
`@supabase/supabase-js 2.118.0`, `leaflet 1.9.4`, `exceljs 4.4.0`, `xlsx 0.18.5`,
`chart.js 4.5.1`, `lucide 1.58.0`, polices `@fontsource` Archivo / IBM Plex Sans / IBM Plex Mono 5.3.0.

> La version Web charge `supabase-js@2` (dernière 2.x) depuis jsDelivr ; l'APK fige
> 2.118.0. Revoir cette version lors de chaque nouvel APK.

---

## 3. Construire

### Voie A — Android Studio (recommandée pour l'équipe)

1. Ouvrir le dossier `android/` dans Android Studio.
2. *Build › Build Bundle(s) / APK(s) › Build APK(s)* → APK **debug**
   (`ci.anagroci.fieldbuying.debug`, nom « ANAGROCI FB TEST »).
3. *Build › Generate Signed App Bundle / APK › APK › release* avec la clé ANAGROCI
   (voir §4) → APK **release** à distribuer.

Le paquet Web est régénéré automatiquement à chaque build (`preBuild → prepareWeb`).
APK produits : `android/app/build/outputs/apk/{debug,release}/`.

En ligne de commande : `cd android && ./gradlew assembleDebug assembleRelease`.

### Voie B — sans Gradle (Linux)

```bash
# Debian / Ubuntu
sudo apt install android-sdk-build-tools android-sdk-platform-23 apksigner zipalign zip
android/scripts/build-apk-local.sh                       # unsigned + debug
KEYSTORE=~/cles/anagroci-release.jks KEY_ALIAS=anagroci \
  android/scripts/build-apk-local.sh --release           # + release signé (mot de passe demandé)
```

Sorties dans `android/build/local/` avec `SHA256SUMS.txt`.

### Les trois types d'APK — ne pas les confondre

| Fichier | Identifiant | Signature | Usage |
|---|---|---|---|
| `…_unsigned.apk` | `ci.anagroci.fieldbuying` | **aucune** — Android refuse de l'installer | à signer avec la clé ANAGROCI |
| `…_debug.apk` | `ci.anagroci.fieldbuying.debug` | clé de debug (non secrète) | essais ; s'installe **à côté** de la version officielle ; débogable via `chrome://inspect` |
| `….apk` (release) | `ci.anagroci.fieldbuying` | **clé ANAGROCI** | seule version à distribuer à l'équipe AFLP |

---

## 4. Clé de signature release — à lire avant la première distribution

**Règle d'or : une seule clé, pour toujours.** Android n'installe une mise à jour que si
elle est signée avec la même clé que la version installée. Perdre la clé = impossible de
mettre à jour = désinstallation = **perte des opérations non synchronisées** sur chaque téléphone.

Créer la clé **une fois**, sur un poste de confiance (JDK requis) :

```bash
keytool -genkeypair -keystore anagroci-release.jks -alias anagroci \
  -keyalg RSA -keysize 4096 -validity 9125 \
  -dname "CN=ANAGROCI FIELD BUYING, O=ANAGROCI, L=Bouake, C=CI"
```

- Conserver `anagroci-release.jks` **et** son mot de passe dans deux endroits sûrs distincts
  (coffre de mots de passe + support hors ligne).
- **Jamais** dans le dépôt GitHub (`*.jks`, `keystore.properties` sont ignorés par git).
- Pour Gradle : créer `android/keystore.properties` (ignoré par git) :
  `storeFile=/chemin/anagroci-release.jks`, `storePassword=…`, `keyAlias=anagroci`, `keyPassword=…`
- Pour la CI : secrets GitHub (voir `ci/build-apk.yml.example`).

Vérifier un APK : `apksigner verify --print-certs ANAGROCI_FIELD_BUYING_AFLP_2027_v1.0.0.apk`
et comparer l'empreinte SHA-256 du certificat avec celle notée lors de la création de la clé.

---

## 5. Publier une nouvelle version

1. Fusionner les changements Web sur `main` (l'APK embarque l'état du dépôt au moment du build).
2. Dans `version.properties` : **`versionCode` + 1** (obligatoire) et `versionName` (ex. 1.0.1).
3. Construire le release signé avec **la même clé**.
4. Vérifier : `aapt2 dump badging <apk> | grep package` (identifiant inchangé, versionCode supérieur)
   et `apksigner verify --print-certs` (même certificat).
5. Lancer `android/tests/jvm/run.sh` et `node android/tests/apk-webview-sim.mjs`.
6. Distribuer par le canal interne (voir guide d'installation). Les téléphones installent
   **par-dessus** : les données locales sont conservées.

Ce que l'APK fige : les pages et scripts. Ce qu'il ne fige pas : les données, les comptes,
les rôles, les politiques RLS et les fonctions Supabase, toujours lus en direct.
**Conséquence** : une évolution de schéma Supabase qui casse l'ancien code casse aussi les
APK déjà installés jusqu'à leur mise à jour. Toute migration doit rester compatible avec
la version APK en circulation.

## 6. Retour arrière

- **Code** : la branche `main` et la version Web ne dépendent pas de `android/`. Supprimer le
  dossier `android/` ou ne pas fusionner la branche n'a aucun effet sur le Web.
- **APK** : Android refuse d'installer un `versionCode` inférieur. Pour revenir à une version
  antérieure, reconstruire l'ancien commit avec un `versionCode` **supérieur** à celui en
  circulation, signé avec la même clé, puis le distribuer comme une mise à jour.
- **Ne jamais** demander aux agents de désinstaller tant que la rubrique Synchronisation
  n'affiche pas 0 opération en attente.

## 7. Limites connues

- Pages historiques `fbms/index.html`, `logistique.html` : chargent `cdn.tailwindcss.com`
  (non embarqué) — affichage dégradé sans réseau. Hors périmètre FIELD BUYING.
- Tuiles de carte : réseau requis (non mises en cache).
- `targetSdk 34` : adapté à une distribution directe ; une publication Play Store exigerait
  d'abord une mise à niveau (et une revue de l'affichage bord à bord d'Android 15).
- `allowBackup=false` : aucune sauvegarde cloud des données locales (choix de confidentialité :
  données producteurs). Les données ne suivent donc pas un changement de téléphone : il faut
  **synchroniser avant**.

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
| `app/src/main/java/…/WebBundleUpdater.java` | Mises à jour Web **signées et vérifiées** (§7) |
| `scripts/web-bundle-lib.mjs` | Règles communes APK / mise à jour (fichiers, format de file, compatibilité) |
| `scripts/sign-web-bundle.mjs` | Création de la clé de publication, signature et contrôle d'une mise à jour |
| `update-keys/` | Clé **publique** de publication (la clé privée n'y entre jamais) |
| `tests/jvm/WebBundleUpdaterTest.java` | 38 scénarios de mise à jour, refus, retour arrière, file locale |
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
sudo apt install android-sdk-build-tools android-sdk-platform-23 apksigner zipalign zip dalvik-exchange
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

Vérifier un APK : `apksigner verify --print-certs ANAGROCI_FIELD_BUYING_AFLP_2027_v1.1.0.apk`
et comparer l'empreinte SHA-256 du certificat avec celle notée lors de la création de la clé.

---

## 5. Publier une nouvelle version

1. Fusionner les changements Web sur `main` (l'APK embarque l'état du dépôt au moment du build).
2. Dans `version.properties` : **`versionCode` + 1** (obligatoire) et `versionName` (ex. 1.0.1).
3. Construire le release signé avec **la même clé**.
4. Vérifier : `aapt2 dump badging <apk> | grep package` (identifiant inchangé, versionCode supérieur)
   et `apksigner verify --print-certs` (même certificat).
5. Lancer `android/tests/jvm/run.sh` et `node android/tests/apk-webview-sim.mjs`
   (et `FBMS_MODE_APK=1 FBMS_LARGEURS=360,412 node tests/unit-head-enrollment-e2e.mjs`).
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

## 7. Mises à jour Web signées (option C hybride)

Problème corrigé : un APK figeait le code Web du jour du build. Un correctif publié sur
GitHub Pages n'atteignait jamais les téléphones (cas constaté : enrôlement Unit Head).

| | |
|---|---|
| Base | l'APK embarque une version complète : démarrage garanti, même sans réseau |
| Source approuvée | **une** URL HTTPS fixée au build (`ANAGROCI_UPDATE_ROOT_URL` = racine du site publié). Aucun autre hôte, aucune redirection |
| Preuve | `android-updates/<canal>/web-bundle.json` liste chaque fichier (SHA-256, taille) ; `web-bundle.json.sig` = signature ECDSA P-256 par la clé de publication ANAGROCI. Clé publique dans l'APK |
| Refus automatique | signature invalide, autre clé, autre application, autre canal, version plus ancienne (rejeu), fichier ≠ empreinte, chemin `../`, tentative sur `_native/` ou `_vendor/`, APK trop ancien (`min_native_version_code`), bibliothèque absente, taille excessive |
| Activation | au **démarrage suivant** seulement, jamais en cours de saisie |
| File locale | si le format de la file IndexedDB change (`queue_schema`), activation **différée** tant qu'une opération n'est pas synchronisée |
| Retour arrière | la page doit confirmer son démarrage en 60 s ; sinon retour automatique à la version précédente, version marquée refusée |
| Jamais par ce canal | code Java, pont natif, bibliothèques figées, permissions, signature : il faut un nouvel APK |

### Mise en service (une fois, par un responsable)

```bash
node android/scripts/sign-web-bundle.mjs --generate-keys ~/cles-anagroci   # HORS du dépôt
cp ~/cles-anagroci/web-bundle-public.pem android/update-keys/              # seule la clé PUBLIQUE
# construire l'APK avec la source approuvée :
ANAGROCI_UPDATE_ROOT_URL=https://<site publié>/ android/scripts/build-apk-local.sh
```

Sauvegarder `web-bundle-private.pem` hors ligne (deux supports). La perdre n'empêche pas
l'application de fonctionner : elle empêche seulement de publier des mises à jour Web, il
faudra alors un nouvel APK avec une nouvelle clé publique.

### Publier une mise à jour Web (sans nouvel APK) · format 2, depuis la 1.2.0

Détails, tests et décisions : `docs/android/UNIFICATION_WEB_APK_20261025.md`.

1. Le correctif est fusionné sur `main`.
2. Une seule commande, qui fait contrôles → magasin d'objets immuable → signature → vérification → journal :
   `node android/scripts/publish-web-update.mjs --channel stable --key ~/cles-anagroci/web-bundle-private.pem --write-root-version`
   (canal test : `--channel test --out <checkout de la branche android-updates-test>/android-updates/test`).
3. Contrôle : `node android/scripts/publish-web-update.mjs --channel stable --verify`.
4. Commiter `android-updates/stable/` et `version.json` dans une pull request, puis la fusionner. Les téléphones récupèrent la
   version à l'ouverture (au plus toutes les 6 h), au retour du réseau, ou via **Version et mises à jour › Vérifier**.
5. Incident : `--rollback-to <version saine> --revoke <version fautive>` (nouveau numéro, retour au démarrage suivant).

Les fichiers ne sont plus lus sur le site en direct mais dans `android-updates/<canal>/objects/` : une fusion Web
postérieure n'invalide plus une version signée. Automatisation prête : `android/ci/publish-web-update.yml.example`.

## 8. Écran « Version et mises à jour »

Bouton **v1.1.0** en bas à gauche (badge orange s'il y a un échec, un conflit ou une mise à
jour en attente ; le nombre d'opérations locales s'y affiche). Montre : version et
`versionCode`, identifiant, **empreinte SHA-256 du certificat de signature** (à comparer avant
une mise à jour), version Web active (APK ou mise à jour signée, commit, numéro), état des mises
à jour et motifs de refus, compteurs de la file locale, et l'avertissement « Ne désinstallez
pas » tant qu'une opération n'est que sur le téléphone.

## 9. Limites connues

- Pages historiques `fbms/index.html`, `logistique.html` : chargent `cdn.tailwindcss.com`
  (non embarqué) — affichage dégradé sans réseau. Hors périmètre FIELD BUYING.
- Tuiles de carte : réseau requis (non mises en cache).
- `targetSdk 34` : adapté à une distribution directe ; une publication Play Store exigerait
  d'abord une mise à niveau (et une revue de l'affichage bord à bord d'Android 15).
- `allowBackup=false` : aucune sauvegarde cloud des données locales (choix de confidentialité :
  données producteurs). Les données ne suivent donc pas un changement de téléphone : il faut
  **synchroniser avant**.

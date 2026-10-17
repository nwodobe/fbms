# Rapport technique — APK ANAGROCI FIELD BUYING v1.0.0

Date : 16 octobre 2026 · Branche : `android/aflp-2027-apk` (base `main` 8f9aac3)
Statut : **PARTIEL AVEC BLOCAGE** — voir §9.

---

## 1. Audit de départ (constaté, pas supposé)

| Point | Constat |
|---|---|
| Chemins du mandat | Tous présents. `operations/field-buying.html` est une page d'une ligne qui charge 13 scripts locaux + Leaflet et supabase-js depuis jsDelivr, polices Google |
| Supabase | Projet `jmbdgpdthzpszfnddwzi`. **6** comptes Auth = **6** profils, tous actifs, aucun compte sans profil : 1 Branch Manager, 2 Zonal Head, 2 Unit Head, 1 Supervisor |
| RLS | Activée sur **les 180** tables `public` (180/180). Une table sans politique (`fbms_data_quality_log`) : RLS active + 0 politique = aucun accès client, sans danger |
| `data-module="portail"` (point d'audit du mandat) | **Cohérent, non modifié.** Toutes les pages `operations/*.html` l'utilisent : la porte vérifie « authentifié + profil actif », puis `field-buying.js` refuse lui-même l'écriture selon le rôle (l. 1563, 2748+), et la RLS tranche côté serveur. Passer à `fbms` exclurait les rôles Consultation / Audit, qui doivent pouvoir lire |
| Service Worker | Précache le shell ; `prepareOfflineMode()` **exige** un Service Worker confirmé → bloquant dans un WebView (voir §3, A1) |
| Tests existants | 11 suites exécutées. `field-buying-e2e` échoue **déjà sur `main`** (doublure périmée) |

## 2. Choix d'architecture

| | A. PWA installable | B. TWA (Trusted Web Activity) | C. Application hybride, fichiers embarqués |
|---|---|---|---|
| Principe | « Ajouter à l'écran d'accueil » depuis Chrome | APK qui ouvre le site dans Chrome plein écran | APK contenant les pages ; WebView |
| Hors ligne | dépend du Service Worker et du cache Chrome (purgeable) | idem A | **fichiers dans l'APK**, démarrage sans réseau garanti |
| Installation | aucune, mais pas d'APK | APK | APK |
| Contraintes | pas d'APK ; cache vidé par Chrome en cas de stockage plein | vérification Digital Asset Links : fichier `/.well-known/assetlinks.json` **à la racine du domaine** `nwodobe.github.io` — impossible depuis un dépôt de projet GitHub Pages sans domaine propre ; dépend de Chrome installé | maintenance d'un projet Android |
| Mises à jour | instantanées (et non maîtrisées) | instantanées | une diffusion d'APK par version |
| Coût | 0 | 0 + domaine propre requis | 0 |

**Retenu : C**, mais **sans Capacitor**. Justification :

1. Capacitor n'apporte ici que deux choses : servir des fichiers locaux et des greffons natifs.
   Aucun greffon n'est nécessaire (GPS, fichiers, photo passent par les API standard du WebView).
   Servir les fichiers tient en 150 lignes (`AssetServer.java`), sans la chaîne AndroidX/Gradle/npm de Capacitor.
2. **Blocage concret** : l'environnement de compilation n'a pas accès à Google Maven ; Capacitor
   (`@capacitor/android` dépend d'AndroidX) n'y est pas compilable. Un shell sans dépendance l'est,
   et reste compilable à l'identique dans Android Studio.
3. Maintenance : 4 classes Java, aucune bibliothèque à mettre à jour, aucune faille de dépendance.
   Le code métier reste **unique** : les mêmes fichiers servent le Web et l'APK.

Origine locale : `https://appassets.androidplatform.net` (domaine réservé par Android à cet usage) :
contexte sécurisé HTTPS, donc `localStorage`, IndexedDB, `crypto.randomUUID`, géolocalisation fonctionnent.

## 3. Anomalies détectées et corrigées

Chaque correctif est démontré par un test qui **échoue sur `main`** et **passe sur la branche**.

| # | Anomalie | Gravité | Correctif | Preuve |
|---|---|---|---|---|
| A1 | « Préparer le mode hors ligne » exige un Service Worker : impossible dans l'APK | Bloquant APK | `offline-field.js` : `prepareShell()` reconnaît le pont natif ; `field-buying.js` accepte le shell embarqué ; Web inchangé | T36, MU-06 |
| A2 | **Téléphone partagé** : l'utilisateur B connecté après A envoyait les opérations locales de A, que le serveur attribuait à B (`auth.uid()`) ; B voyait aussi la file et le cache de référentiels de A | Élevée (traçabilité, données) | file, résumé, cache **par utilisateur** ; synchronisation limitée à la session ; compteur `other_users_open` ; ancien cache sans propriétaire toujours lisible | `tests/offline-field-multi-user-e2e.mjs` (MU-01 échoue sur `main`) |
| A3 | **Course de chargement des rôles** : si le profil arrive avant `aflp-access.js`, Unit Head / Zonal Head étaient classés « agent » (modules caisse, audit, logistique refusés au hasard) | Élevée, intermittente | `auth-gate.js` attend la table des rôles avant de décider (repli 5 s) | T04 (échoue au hasard), T41 (échoue toujours sur `main`) |
| A4 | Toute erreur de connexion affichait « Email ou mot de passe incorrect », y compris **sans réseau** | Moyenne (support terrain) | messages distincts : réseau, compte banni, email non confirmé, trop de tentatives, service indisponible, première connexion hors ligne, session expirée | T06, T20b, T32, T33 |
| A5 | Promesse de connexion rejetée → bouton bloqué sur « Connexion… » | Faible | gestionnaire d'erreur ajouté | revue de code |

Choix volontaire : « compte inexistant » garde le même message que « mot de passe incorrect »
(Supabase ne les distingue pas ; les distinguer révélerait quels emails ont un compte).

## 4. Fichiers créés ou modifiés

**Code Web modifié (revue humaine requise : fichiers en liste de refus d'auto-fusion)** :
`shared/offline-field.js`, `shared/auth-gate.js`, `operations/field-buying.js`,
`operations/field-buying.html` (versions de cache de 2 scripts), `tests/offline-field-static.mjs` (version attendue).
Ajouté : `tests/offline-field-multi-user-e2e.mjs`.

**Non modifiés** : `supabase/**`, politiques RLS, rôles, comptes, `sw.js`, `manifest.webmanifest`, `.github/**`.

**Nouveau dossier `android/`** (détail dans `android/README.md`) et `docs/android/`.

| Commit | Objet |
|---|---|
| `2406f5f` | fix(hors-ligne) : isolation par utilisateur, shell Android embarqué |
| `66d935c` | fix(auth) : attente de la table des rôles, messages distincts |
| `0a376aa` | feat(android) : application, scripts, tests |
| `bdf0b7f` | test(android) : stabilisation de la simulation |
| suivant | docs(android) : guides et rapports |

## 5. Compatibilité Android

- `minSdk 24` (Android 7.0) · `targetSdk 34` (Android 14) · compilé contre l'API 23 (aucune API récente appelée ; les comportements récents sont pris en compte : `exported` explicite, `<queries>`, MediaStore pour Android 10+).
- Signature v2 + v3 (v1 inutile à partir d'Android 7).
- WebView : Chromium système, mis à jour par le Play Store. Un téléphone dont le WebView n'est
  jamais mis à jour (sans Play Store) peut être trop ancien pour supabase-js : **non mesuré**.
- Permissions : Internet, état du réseau, localisation (demandée au moment du GPS), écriture
  Téléchargements (Android ≤ 9 seulement). **Aucune** permission caméra, contacts, SMS, stockage global.

## 6. Authentification

Inchangée sur le fond : Supabase Auth, profil `profils`, `aflp-access.js`, contrôles serveur.
Un APK ne donne **aucun** privilège : il exécute le même code et la RLS reste l'autorité.
Vérifié en simulation (serveur simulé) : connexion, refus, désactivation, profil absent, session
conservée, session expirée, accès hors ligne avec profil en cache, rôle non autorisé.
**Non vérifié sur la vraie base** : aucun compte de test, Supabase injoignable depuis l'environnement.

## 7. Hors ligne et synchronisation

| Exigence | État |
|---|---|
| Fichiers de l'application disponibles sans réseau | ✅ embarqués ; vérifiés au démarrage (`shellStatus`, 29 fichiers critiques) |
| Préparation des données par profil | ✅ mécanisme existant (`offline_prepare_device`, bail RT 18 h) |
| File locale persistante, identifiant unique, statut | ✅ IndexedDB existante |
| Idempotence, pas de doublon | ✅ clé générée à la création, reçus serveur `offline_sync_receipts` |
| Conflit (clé réutilisée, contenu différent) | logique serveur présente → `CONFLICT` ; **non exercée en test** |
| Échecs visibles et reprise | ✅ |
| Fermeture / réouverture | ✅ (sim.) |
| Mise à jour APK sans perte | par construction (même identifiant, même clé) ; **non testé sur téléphone** |
| Isolation entre utilisateurs d'un même téléphone | ✅ corrigé (A2) |
| Avertissement à la déconnexion | ✅ existant, désormais limité aux opérations de l'utilisateur |
| Web ↔ APK | **Stockages distincts** : une opération non synchronisée dans Chrome **n'apparaît pas** dans l'APK. Synchroniser avant de changer d'outil (écrit dans le guide) |

## 8. Risques résiduels

1. **Clé de signature** : sa perte empêche toute mise à jour → désinstallation → perte des files locales. Procédure de garde : `android/README.md` §4.
2. **Décalage de version** : l'APK fige le code ; une migration Supabase non rétro-compatible casserait les APK en circulation. Toute migration doit rester compatible avec la version APK diffusée.
3. **supabase-js figé à 2.118.0** alors que le Web suit `@2` : à réaligner à chaque APK.
4. Pages historiques (Tailwind CDN) dégradées hors ligne ; tuiles de carte en ligne uniquement.
5. Fichiers en liste de refus modifiés (`auth-gate.js`, `offline-field.js`) : la pull request **ne doit pas** être fusionnée sans relecture humaine.
6. `auth-gate.js` est appelé partout avec `?v=82bca416` : après fusion, le correctif A3/A4 n'atteint les navigateurs qu'à l'expiration de leur cache. Incrémenter cette version dans les 24 pages lors de la fusion si l'effet immédiat est souhaité.
7. `field-buying-e2e` reste rouge (hérité) : la couverture Web du recensement village repose sur la simulation APK (T13/T14) tant que la doublure n'est pas réparée.

## 9. Ce qui reste bloqué — et comment le débloquer

| Blocage | Cause | Action |
|---|---|---|
| Tests sur téléphone (installation, caméra, retour, mise à jour) | aucun appareil / émulateur dans l'environnement | Fiche de test §4 du rapport de tests, sur 2 téléphones |
| APK release signé | pas de clé ANAGROCI disponible ; en créer une ici l'aurait exposée | Créer la clé (README §4) puis signer ; le chemin `--release` a été vérifié avec une clé jetable détruite aussitôt |
| Connexion réelle | aucun compte de test ; Supabase injoignable | Le Branch Manager crée un compte de test (rôle Unit Head, cluster fictif) via l'administration |
| Fusion dans `main` | fichiers sensibles modifiés | Relecture humaine de la pull request |
| Build Gradle | Google Maven inaccessible ici : `./gradlew` non exécuté dans cet environnement | Premier build dans Android Studio ou via `ci/build-apk.yml.example` |

## 10. Maintenance

- **Modifier l'application** : modifier les fichiers Web comme d'habitude ; l'APK les reprend au prochain build.
- **Nouvel APK** : `versionCode` + 1 dans `android/version.properties`, build release, mêmes tests (README §5).
- **Ne jamais changer** `applicationId` ni la clé.
- **Retour arrière** : README §6 (reconstruire l'ancien commit avec un `versionCode` supérieur).

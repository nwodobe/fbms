# Unification FBMS Web et APK Android · 25/10/2026

Branche : `android/unification-maj-20261025`, empilée sur la PR #262 (`android/aflp-2027-apk-v2`). Canal de test publié : branche `android-updates-test`.

**Statut : PARTIEL AVEC BLOCAGE.** Le mécanisme est construit et vérifié par exécution : JVM, HTTPS réel en local, simulation WebView, canal de test réellement publié.

**Démonstration exécutée le 25/10/2026 sur un téléphone Android réel** (itel S688LN, Android 15) : réception d'une mise à jour publiée, fonctionnement hors réseau, reprise au retour du réseau, conservation des opérations en attente, refus automatique d'une version défectueuse, mise à jour native par-dessus. Détail : `preuves-20261025/telephone-reel-itel-S688LN.md`.

Restent bloqués :
- la synchronisation avec Supabase après mise à jour sur le téléphone (aucun compte de test autorisé) ;
- les clés officielles ;
- l'activation du workflow.

---

## 1. Diagnostic de l'existant (constaté, pas supposé)

| Point | Constat | Source |
|---|---|---|
| Code Web | `main` = `b8e77c9` (PR #263). #260 et #261 fusionnées ; #262 (Android) et #264 ouvertes, en brouillon | API GitHub |
| Projet Android | Uniquement sur les branches `android/aflp-2027-apk` (1.0.0) et `android/aflp-2027-apk-v2` (1.1.0). Projet natif Java sans Capacitor | dépôt |
| Chargement du Web dans l'APK | `AssetServer` sert les fichiers **embarqués** sous `https://appassets.androidplatform.net` ; Service Worker neutralisé | `MainActivity.java`, `bridge.js` |
| Pourquoi la version est figée | L'APK embarque le Web du jour de sa compilation. Le canal signé de la 1.1.0 n'est **jamais actif** : aucune clé de publication, aucune URL, aucun manifeste publié | `update-config.json` des APK |
| Fragilité du canal 1.1.0 | Les fichiers étaient lus **sur le site en direct**. Toute fusion Web après la signature faisait refuser la mise à jour jusqu'à une nouvelle signature manuelle | `WebBundleUpdater.java` (format 1) |
| APK retrouvés (Téléchargements, OneDrive\Desktop\AFLP) | 1.0.0 debug et 1.1.0 debug (×3). Tous en `ci.anagroci.fieldbuying.debug` (« ANAGROCI FB TEST »), clés de **debug** | `aapt2`, `apksigner` sur l'ordinateur |
| Certificats | 1.0.0 : `42b20b…eec8` ; 1.1.0 : `0958…7a83`. Ni l'un ni l'autre ne correspond à la clé de debug de l'ordinateur (`FCF7…1251`). La clé `0958…` était celle d'un environnement de travail éphémère, aujourd'hui disparu | idem |
| Mise à jour sur place possible ? | **Non** pour les APK en circulation : leur clé de signature est indisponible. Android refusera tout nouvel APK par-dessus | idem |
| Données locales | `localStorage` et IndexedDB (`anagroci_ops_offline`, `aflp_farmer_registry_db`) dans le dossier de l'application, origine `appassets.androidplatform.net`. `allowBackup=false` | code |
| Distribution actuelle | Fichiers APK transmis à la main (aucune release GitHub, aucun Play Store) | — |
| Supabase | Lecture seule : synchronisation par `offline_sync_batch` (reçus idempotents) et RLS par cluster, inchangées | requêtes en lecture seule |
| GitHub Pages | `nwodobe.github.io/fbms/` en ligne. **`nwodobe.github.io/.well-known/assetlinks.json` : 404**, et aucun dépôt `nwodobe.github.io` n'existe | requêtes depuis l'ordinateur |
| Matériel de test | Ordinateur : SDK Android 36, émulateur, image android-35. Un appareil physique apparaît **« offline »** dans adb (non utilisé) | `adb devices` |

## 2. Choix d'architecture

| Critère | A · PWA + TWA | B · Web embarqué + mises à jour signées | C · WebView du site en ligne |
|---|---|---|---|
| Mises à jour automatiques | oui (Service Worker) | **oui (canal signé)** | oui |
| Hors réseau | dépend du Service Worker, qui a déjà eu un défaut (D-1) | **garanti** : version complète dans l'APK + version vérifiée sur le téléphone | fragile (cache HTTP) |
| Conservation des données actuelles | **non** : stockage de Chrome, autre origine | **oui** : même origine, même dossier, même identifiant | **non** : autre origine |
| Prérequis | `assetlinks.json` à la **racine** du domaine (impossible sans créer un dépôt `nwodobe.github.io`), Chrome à jour | clé de publication | aucun |
| Sécurité | celle du site | signature ECDSA + empreintes + préfixe HTTPS | celle du site, sans contrôle d'intégrité |
| Effacement des données Chrome | efface la file hors ligne | sans effet | sans effet |
| Coût | 0 | 0 | 0 |

Capacitor avec mises à jour à distance a été écarté. Changer d'origine (`capacitor://localhost` / `https://localhost`) rendrait inaccessibles les IndexedDB actuelles. Cela ajoute en plus une dépendance tierce.

**Décision : B, dans le projet Android existant.** On conserve l'identifiant `ci.anagroci.fieldbuying`, sans framework ajouté. Le canal signé devient automatique et immuable (format 2).

## 3. Source unique et identité de version

- **Une seule source** : les fichiers Web du dépôt, listés par `web-bundle-lib.mjs`. La même liste sert à embarquer le Web dans l'APK et à publier les mises à jour.
- **Identité** (manifeste signé et `version.json`) :
  - `web_version` (`AAAA.MM.JJ-HHMM.<commit>`, identique dans l'APK et dans la publication du même commit) ;
  - `git_commit` et `published_at` ;
  - `sequence` (monotone, anti-rejeu) ;
  - `min_native_version_code` ;
  - `native` (dernier APK et procédure) ;
  - `supabase_compat` (dernière migration connue) ;
  - `queue_schema` (format des **deux** files locales) ;
  - `status`, `update_policy` (`recommended` / `security`), `channel`, `revoked_sequences`, `rollback_of`.
- **Distinction des états** :
  - la *dernière version disponible* est `latest` dans l'état du téléphone ;
  - la *version installée* est `active_*` ;
  - une version *compatible* signifie : signature valide, même application, même canal, et `min_native_version_code` ≤ celui de l'APK ;
  - une version *recommandée* ou *obligatoire pour sécurité* se lit dans `update_policy` ;
  - le cas *nouvel APK requis* correspond à la phase `nouvel_apk` ;
  - une version est déclarée *installée* seulement après vérification, activation au démarrage, puis confirmation de la page (`last_success_at`).

## 4. Chaîne de publication

`android/scripts/publish-web-update.mjs` enchaîne les étapes suivantes. Un échec à n'importe quelle étape arrête tout.

1. **Préconditions** : arbre Web commité, compatibilité native, clé privée hors du dépôt et correspondant à la clé publique attendue.
2. **Contrôles critiques** : portes JS et liens, tests hors ligne. Un échec renvoie le code 2 et **rien n'est publié**.
3. **Magasin immuable** : `objects/aa/<sha256>`.
4. **Manifeste signé, archivé, puis revérifié** : il est écrit en dernier.
5. **`version.json`** et **journal `releases.json`** (étapes, statut de chaque version).
6. **Retour arrière** (`--rollback-to`) : republie un contenu archivé sous un nouveau numéro.
7. **Révocation** (`--revoke`) : elle est refusée si rien de sain n'est publié à la place.

**Canaux.**
- **test** : branche `android-updates-test`, servie par `raw.githubusercontent.com`. Elle est publiée automatiquement après les contrôles.
- **stable** : `android-updates/stable/` sur GitHub Pages. La publication passe par un déclenchement manuel, l'approbation de l'environnement `android-production`, puis une PR `human-review`.

Le workflow est **préparé** dans `android/ci/publish-web-update.yml.example`. Il n'est pas activé : un agent n'écrit pas dans `.github/`.

**Natif.** Une modification Java, du pont natif, des bibliothèques figées ou des permissions exige un nouvel APK : `versionCode` + 1, signé avec la clé ANAGROCI (`build-apk.yml.example`). Le manifeste Web porte alors `min_native_version_code` : les anciens APK affichent « Nouvel APK requis » et continuent avec leur version.

## 5. Sécurité et préservation des données

- **Sur le téléphone, avant toute activation**, le moteur vérifie :
  - la signature ECDSA P-256 et l'empreinte SHA-256 de chaque fichier ;
  - le préfixe HTTPS exact (hôte et chemin), sans redirection ni `..` ;
  - l'application, le canal et la version native minimale ;
  - les bibliothèques présentes et la taille ;
  - l'anti-rejeu et la liste de révocation.
- **Activation** : au démarrage suivant uniquement, jamais en cours de saisie. Si le format d'une file locale change, elle est différée tant qu'une opération n'est pas synchronisée.
- **Échec** : retour automatique si la page ne confirme pas son démarrage en 60 s. Aucun paquet partiel n'est conservé.
- **Données** : le moteur n'écrit que dans `files/web-updates/`. IndexedDB, `localStorage`, photos et exports ne sont jamais touchés (preuve E2E-22).
- **Serveur** : la RLS Supabase s'applique à chaque synchronisation. Une mise à jour Web ne change aucun droit, et un Chef d'Unité reste limité à son cluster (tests UH-APK de la #262, inchangés).
- **Ce qui ne figure dans aucun journal** : mot de passe, jeton, clé privée.

**Risques résiduels**
- Compromission de la clé privée stable : elle permettrait de publier du Web signé. Mesures : secret limité à l'environnement protégé, approbation humaine, rotation documentée (§8).
- `raw.githubusercontent.com` (canal test) met en cache 5 min.
- `targetSdk 34`.

## 6. Écran « Version et mises à jour » (APK)

L'écran affiche :
- la version installée (application et Web) et la dernière version disponible ;
- le statut : à jour, disponible, téléchargement, prête, différée, nouvel APK, erreur ou désactivée ;
- la connexion Internet et les opérations en attente (Field Buying et registre) ;
- l'état de la synchronisation, la dernière mise à jour réussie et la dernière vérification ;
- le bouton **Vérifier les mises à jour**, qui répond aussi « Aucune mise à jour disponible » ;
- la consigne de sécurité, la procédure en cas de nouvel APK, et des détails techniques repliés.

Au retour du réseau, la page **synchronise d'abord**, puis vérifie les mises à jour (V18).

## 7. Tests exécutés le 25/10/2026 (données synthétiques uniquement)

| Suite | Scénarios | Résultat | Preuve (`docs/android/preuves-20261025/`) |
|---|---:|---|---|
| JVM `AssetServer` (vrai Java, vrai paquet) | 15 | **15/15** | `jvm-assetserver-updater-format1.txt` |
| JVM `WebBundleUpdater` format 1 (non-régression) | 38 | **38/38** | idem |
| **Bout en bout format 2** : vraie chaîne Node, vrai Java, **HTTPS réel local** | 22 | **22/22** | `format2-e2e-resultats.txt` |
| Simulation WebView Android 360×640 et 412×915 (Chromium, `bridge.js` réel) | 60 × 2 | **120/120** | `apk-webview-sim.txt` |
| Tests Web statiques du dépôt | 19 | **19/19** | `tests-web-statiques.txt` |
| Tests navigateur du dépôt | 10 | **8/10**. Échecs identiques sur `main` : `field-buying-e2e` (défaut hérité), `offline-field-e2e` (corrigé par la PR #264) | — |
| Portes qualité (JS, liens, HTML) | 3 | **3/3** | — |
| **Publication réelle du canal de test** (`raw.githubusercontent.com`) | 1 | publiée, puis lue en HTTPS depuis l'extérieur | `canal-test-journal.json`, `canal-test-version.json` |
| **Démonstration sur téléphone Android réel** (itel S688LN, Android 15) | 12 étapes | **11 PASS, 1 NON EXÉCUTÉ** (synchronisation Supabase : pas de compte de test) | `telephone-reel-itel-S688LN.md` + 2 captures |

Le test de bout en bout format 2 couvre :
- E2E-01 à 07 : même commit = à jour ; correction détectée ; hors ligne ; activation au redémarrage ; reconnexion ;
- E2E-08 : téléchargement interrompu puis repris ;
- E2E-09 à 11 : objet altéré refusé, puis détecté par `--verify` ;
- E2E-12 et 13 : révocation et retour arrière ;
- E2E-14 : nouvel APK requis ; E2E-15 : politique de sécurité ; E2E-16 : format de file et opérations en attente ;
- E2E-17 : version défectueuse annulée ; E2E-18 : rejeu ;
- E2E-19 et 20 : blocage sur test critique, arbre non commité, clé dans le dépôt ;
- E2E-21 : journal ; E2E-22 : **données locales identiques avant et après 10 publications**.

## 8. Livraison Android

| Élément | État |
|---|---|
| APK de test 1.2.0 (3), `ci.anagroci.fieldbuying.debug`, canal **test** | compilé (outils SDK, voie B) · SHA-256 `12c96e2f…6183` · certificat de test `9d33504b…95cc` (v2/v3 vérifiées) · non distribué |
| APK de test « FBMS TEST MAJ » `ci.anagroci.fieldbuying.majtest` 1.2.0 (3) puis **1.2.1 (4)** | SHA-256 `40561be3…df3f` puis `ac4a01b2…f00a` · même certificat de test `9d33504b…95cc` · installé **uniquement** sur le téléphone de test du Branch Manager, à côté de l'application existante |
| APK non signé 1.2.0 | `8e374f3d…d2ae` : Android refuse de l'installer, comme attendu |
| APK release signé | **NON PRODUIT** : aucune clé ANAGROCI (création réservée au Branch Manager, README §4) |
| Clé de publication **stable** | **à créer** par le Branch Manager (README §7) ; la clé de test utilisée ici est jetable et n'existe que dans l'environnement de travail |

**Migration depuis les APK actuels (1.0.0 / 1.1.0 debug).** La mise à jour par-dessus est impossible : clé indisponible.
1. Sur chaque téléphone, dans l'ancienne application, synchroniser jusqu'à **0 opération en attente**.
2. Installer le **nouvel APK officiel** `ci.anagroci.fieldbuying`. Il s'installe **à côté** de l'ancien (identifiant différent).
3. Se connecter, faire « Préparer le terrain », puis vérifier une fiche.
4. Seulement ensuite, et toujours avec 0 opération en attente, désinstaller l'ancien « ANAGROCI FB TEST ».

À partir de ce nouvel APK, les corrections Web arrivent seules. Seul un changement natif demande un nouvel APK, installé par-dessus avec la même clé.

**Rotation de la clé de publication** : nouvel APK portant la nouvelle clé publique, puis republication.

## 9. Maintenance : publier une correction

1. Fusionner la correction Web sur `main` (relecture habituelle).
2. Canal test : automatique, une fois le workflow activé. À la main :
   `node android/scripts/publish-web-update.mjs --channel test --key <clé test> --out <branche android-updates-test>/android-updates/test`
3. Vérifier sur un appareil de test : « Version et mises à jour » › Vérifier.
4. Canal stable : déclencher le workflow (`channel=stable`), approuver l'environnement, relire puis fusionner la PR créée.
5. **Incident** : `--rollback-to <version saine> --revoke <version fautive>`.
6. Contrôle : `node android/scripts/publish-web-update.mjs --channel stable --verify`.

## 10. Ce qui reste bloqué et pourquoi

| Bloqué | Cause | Déblocage |
|---|---|---|
| Synchronisation des opérations après mise à jour, sur le téléphone | Aucun compte de test autorisé ; aucune écriture en production pendant la recette | Compte de test créé par le Branch Manager (rôle Unit Head, cluster de test), puis refaire l'étape 7 |
| APK release, canal stable | Clés ANAGROCI (signature APK et publication Web) inexistantes | Branch Manager, README §4 et §7 |
| Workflow automatique | `.github/` interdit aux agents | Copier `android/ci/*.yml.example`, créer les secrets et l'environnement |
| Fusion | PR #262 puis la présente PR, relecture humaine | Branch Manager |

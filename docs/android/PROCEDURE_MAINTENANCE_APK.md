# Procédure de maintenance — APK ANAGROCI FIELD BUYING

Pour le Branch Manager et la personne qui construit les APK. Version de référence : **1.1.0 (versionCode 2)**.

---

## 1. Ce qui se met à jour, et par quel chemin

| Changement | Chemin | Nouvel APK ? |
|---|---|---|
| Correctif des pages / scripts Web (ex. enrôlement Unit Head) | mise à jour Web **signée** (README Android §7) | non |
| Nouvelle bibliothèque externe, changement du pont natif, du Java, des permissions | nouvel APK | **oui** |
| Changement du format de la file locale (`DB_NAME` / `DB_VERSION` de `shared/offline-field.js`) | mise à jour signée, activée seulement quand la file est vide sur le téléphone | non, mais prévenir les équipes de synchroniser |
| Politiques RLS, fonctions, schéma Supabase | Supabase (aucun canal APK) | non, mais **compatibilité obligatoire** avec les APK en circulation |

Un APK construit **sans** clé publique de publication (cas de l'APK de test 1.1.0 produit le
16/10/2026) n'a **aucun** canal de mise à jour : il sert sa version embarquée jusqu'à son remplacement.

## 2. Routine d'une mise à jour Web

1. Fusion du correctif sur `main` ; GitHub Pages publie.
2. `node android/scripts/sign-web-bundle.mjs --key <clé privée hors dépôt>` sur ce commit.
3. `node android/scripts/sign-web-bundle.mjs --verify` → `signature: valide`, `files_differing_from_repo: []`.
4. Pull request contenant **uniquement** `android-updates/` ; fusion.
5. Sur un téléphone de test : **Version › Vérifier les mises à jour** → « vérifiée : appliquée au
   prochain démarrage » → **Redémarrer pour appliquer** → l'écran indique *mise à jour signée* et le bon commit.
6. Après toute autre fusion Web, re-signer (sinon les téléphones refusent : fichier ≠ empreinte).

## 3. Routine d'un nouvel APK

1. `android/version.properties` : `versionCode` + 1 ; `versionName`. Ne **jamais** changer `applicationId`.
2. Si le natif change de façon incompatible avec d'anciens APK : augmenter `webUpdateMinVersionCode`.
3. Construire (Android Studio, `./gradlew assembleRelease`, ou `android/scripts/build-apk-local.sh --release`)
   avec la **même** clé release et `ANAGROCI_UPDATE_ROOT_URL`.
4. Contrôles obligatoires avant diffusion :
   - `aapt dump badging <apk> | grep package` → `ci.anagroci.fieldbuying`, versionCode supérieur ;
   - `apksigner verify --print-certs <apk>` → **même** empreinte SHA-256 que la version en circulation ;
   - `android/tests/jvm/run.sh`, `node android/tests/apk-webview-sim.mjs`,
     `FBMS_MODE_APK=1 FBMS_LARGEURS=360,412 node tests/unit-head-enrollment-e2e.mjs` : 0 échec ;
   - `unzip -p <apk> assets/www/_native/update-config.json` → `"enabled": true` (sinon pas de canal de mise à jour).
5. Installer sur 2 téléphones de test **par-dessus** l'ancienne version, vérifier l'écran Version, puis diffuser
   par le canal interne. Jamais de lien public.

## 4. Téléphone avec un ancien APK d'origine incertaine (cas actuel)

L'APK aujourd'hui installé chez les Unit Heads n'a pas été produit dans ce dépôt de façon traçable
(aucune release GitHub, aucun artefact CI, aucune clé release ANAGROCI créée à ce jour). Avant toute action :

**Étape A — identifier, sans rien modifier.** Sur un ordinateur avec le fichier APK d'origine :
`aapt dump badging ancien.apk | grep package` et `apksigner verify --print-certs ancien.apk`.
Sans le fichier : *Paramètres › Applications › (l'application) › nom et version* ; pour l'identifiant
et le certificat, `adb shell dumpsys package <identifiant> | grep -E "versionCode|signatures"` (câble USB, mode développeur).

**Étape B — mesurer le risque de perte.** Dans l'ancienne application, rubrique **Synchronisation** :
noter « en attente », « en échec », « à revoir ». Faire une capture.

**Étape C — décider :**

| Constat | Action | Perte possible |
|---|---|---|
| Identifiant `ci.anagroci.fieldbuying`, même certificat que le nouvel APK release | installer **par-dessus** | aucune |
| Identifiant différent (ex. `….debug` ou autre) | installer le nouvel APK **à côté** ; synchroniser l'ancien jusqu'à 0 ; ne retirer l'ancien qu'après | aucune si 0 |
| Même identifiant, **certificat différent** | Android refusera la mise à jour. Synchroniser l'ancien jusqu'à **0 en attente et 0 en échec**, capture à l'appui ; **seulement alors** désinstaller puis installer | aucune si 0 ; sinon les opérations restantes seraient perdues : **ne pas désinstaller** |
| Opérations en échec qui ne partent pas | ne rien désinstaller ; transmettre les captures ; traiter côté serveur d'abord | — |

Ne jamais créer une clé et prétendre qu'elle met à jour un APK signé par une autre clé : c'est impossible.

## 5. Garde des clés

| Clé | Où | Si perdue |
|---|---|---|
| Release APK (`anagroci-release.jks`) | coffre + support hors ligne, jamais dans le dépôt | plus aucune mise à jour par-dessus : remplacement complet des installations (§4, ligne « certificat différent ») |
| Publication Web (`web-bundle-private.pem`) | coffre + support hors ligne, jamais dans le dépôt ni la CI | plus de mise à jour Web : nouvel APK avec une nouvelle clé publique |
| Clé de test (debug) | poste du développeur ou secret CI dédié | sans conséquence en production ; une version d'essai signée par une autre clé de test ne s'installe pas par-dessus |

## 6. Incidents

| Symptôme | Cause probable | Action |
|---|---|---|
| Écran Version : *Refusée : signature invalide* | manifeste modifié, ou signé avec une autre clé | re-signer avec la bonne clé ; vérifier `--verify` |
| *fichier non conforme au manifeste signé* | fusion Web après la signature | re-signer sur le commit publié |
| *nouvel APK requis* | `min_native_version_code` ou bibliothèque absente | construire et diffuser un nouvel APK |
| *démarrage non confirmé : retour à la version précédente* | la version Web publiée ne démarre pas dans l'APK | corriger, re-signer : la version refusée n'est plus jamais retéléchargée par ce téléphone |
| *Activation différée* | format de file local modifié et opérations en attente | synchroniser jusqu'à 0, puis redémarrer |

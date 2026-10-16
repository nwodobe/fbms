# Rapport de tests — APK ANAGROCI FIELD BUYING v1.0.0 (AFLP 2027)

Date : 16 octobre 2026 · Branche `android/aflp-2027-apk` · Statut global : **PARTIEL AVEC BLOCAGE**

## 0. Ce qui a été testé, et comment

| Niveau | Outil | Ce qu'il prouve | Ce qu'il ne prouve pas |
|---|---|---|---|
| Structure APK | `aapt2 dump badging`, `apksigner verify`, `zipalign -c`, `dexdump` | identifiant, versions, permissions, signature v2/v3, alignement, classes compilées | le fonctionnement sur téléphone |
| Code Java | `android/tests/jvm/run.sh` — le **vrai** `AssetServer.java` sur le **vrai** paquet `assets/www` | routage local, bibliothèques hors ligne, injection du pont, 404, traversée de chemin | le WebView Android lui-même |
| Application Web dans les conditions de l'APK | `android/tests/apk-webview-sim.mjs` — Chromium réel, origine locale, CDN bloqués, pont natif simulé, écrans 360×640 et 412×915 | authentification, rôles, hors ligne, synchronisation, exports, navigation, petit écran | installation, icône, permissions Android, appareil photo, bouton retour matériel, mise à jour |
| Isolation multi-utilisateurs | `tests/offline-field-multi-user-e2e.mjs` | correctif démontré : échoue sur `main`, passe sur la branche | — |
| Non-régression Web | tests existants du dépôt + portes `.github/scripts` | aucune régression introduite | — |

**Blocages réels de l'environnement de travail** (pas des choix) :
1. Aucun appareil ni émulateur Android : pas de virtualisation (`/dev/kvm` absent) et images système Google inaccessibles (`dl.google.com` refusé par le proxy).
2. Supabase de production **injoignable** depuis l'environnement (connexion refusée par le proxy) : impossible de tester une vraie connexion. Lecture SQL seule via l'outil d'administration.
3. **Aucun compte de test** n'existe (6 comptes réels, tous actifs) ; en créer un aurait modifié les utilisateurs de production, ce que le mandat interdit sans autorisation.

Toutes les données de test sont synthétiques (`example.invalid`, villages et producteurs « FICTIF »).

## 1. Les 30 scénarios du mandat

Légende : **PASS (sim.)** = vérifié en simulation Chromium sur les deux écrans ; **NON TESTÉ** = impossible ici, à faire sur téléphone (fiche §4).

| # | Scénario | Preuve | Statut |
|---|---|---|---|
| 1 | Installation initiale | APK valide (badging, signature v2/v3 vérifiée, alignement) | **NON TESTÉ sur appareil** |
| 2 | Ouverture de l'application | T02 : page servie depuis l'APK en < 0,6 s, 0 requête externe | PASS (sim.) |
| 3 | Écran de connexion | T03 : champs email/mot de passe, clavier email, aucun débordement | PASS (sim.) |
| 4 | Connexion compte de test valide | T04 : Unit Head → niveau chef, pas BM (serveur Supabase simulé) | PASS (sim.) · **réel BLOQUÉ** (aucun compte de test, Supabase injoignable) |
| 5 | Mot de passe incorrect | T05, T05b (compte inexistant : même message, anti-énumération) | PASS (sim.) |
| 6 | Compte désactivé | T06 (banni dans Auth), T06b (profil `actif=false`) | PASS (sim.) |
| 7 | Refus d'une fonction non autorisée | T07 : Unit Head → administration « Accès non autorisé » | PASS (sim.) |
| 8 | Maintien de la session | T08 : rechargement sans nouvelle saisie | PASS (sim.) |
| 9 | Module producteurs | T09 | PASS (sim.) |
| 10 | Consultation des villages | T10 | PASS (sim.) |
| 11 | Recherche d'un producteur | T11 : trouvé / filtré | PASS (sim.) |
| 12 | Informations d'exploitation | jeu synthétique sans parcelle | **NON TESTÉ** |
| 13 | Création d'une fiche (test) | T21 enrôlement producteur ; T13 formulaire village (ouvert, non soumis) | PASS (sim.) / partiel village |
| 14 | Modification d'une fiche (test) | T14 : fiche village préremplie (enregistrement non soumis) | PARTIEL |
| 15 | Vérification des superficies | — | **NON TESTÉ** |
| 16 | Listes déroulantes | T16, T16b (clavier tél.), T16c (clavier numérique) | PASS (sim.) |
| 17 | Navigation entre modules | T17 : 9 rubriques, 0 erreur JS | PASS (sim.) |
| 18 | Petit écran | T18 : 0 px de débordement horizontal à 360 px | PASS (sim.) |
| 19 | Réseau mobile faible | latence non simulée | **NON TESTÉ** |
| 20 | Perte du réseau pendant la saisie | T20b (connexion) ; T21/T21b (saisie hors ligne) | PASS (sim.) |
| 21 | Enregistrement local hors ligne | T21, T21b : PENDING, clé d'idempotence, dépendance | PASS (sim.) |
| 22 | Fermeture et réouverture sans réseau | T21a, T22, T22a | PASS (sim.) |
| 23 | Retour d'Internet | T23 | PASS (sim.) |
| 24 | Synchronisation | T24 : producteur puis achat, rattachement au Farmer serveur | PASS (sim.) |
| 25 | Détection des doublons | T25 : 0 clé renvoyée ; MU-03 | PASS (sim.) |
| 26 | Gestion d'un conflit | logique serveur lue (clé réutilisée avec contenu différent → CONFLICT), non exercée | **NON TESTÉ** |
| 27 | Opération en erreur préservée | T27 : échec explicite, 0 perte | PASS (sim.) |
| 28 | Déconnexion avec opérations en attente | T28 : avertissement affiché | PASS (sim.) |
| 29 | Mise à jour APK sans perte | conception : même identifiant + même clé + versionCode supérieur | **NON TESTÉ sur appareil** |
| 30 | Non-régression de la version Web | §3 | PASS (1 échec hérité, identique sur `main`) |

**Bilan : 22 PASS en simulation, 2 partiels, 6 non testés (dont 2 exigent un téléphone).** Aucun échec.

## 2. Scénarios complémentaires

| ID | Scénario | Statut |
|---|---|---|
| T31 | Service Worker neutralisé dans l'APK (pas de code périmé après mise à jour) | PASS (sim.) |
| T32 | Première connexion sans Internet : message explicite | PASS (sim.) |
| T33 | Session expirée : message explicite, opérations conservées | PASS (sim.) |
| T34 | Compte sans profil : « Profil introuvable » | PASS (sim.) |
| T35 | Aucune erreur JavaScript pendant l'authentification | PASS (sim.) |
| T36 | « Préparer le mode hors ligne » avec le shell embarqué | PASS (sim.) |
| T37 | Export (lien `download` blob:) → Téléchargements/ANAGROCI | PASS (sim., pont simulé) |
| T38 | Impression → service d'impression Android | PASS (sim., pont simulé) |
| T39 | GPS (position simulée) | PASS (sim.) · permission Android **NON TESTÉE** |
| T40 | Aucune requête externe non prévue | PASS (sim.) |
| T41 | Rôle correct même si `aflp-access.js` arrive 2,5 s en retard | PASS (sim.) — **échoue avec `main`** |
| MU-01…06 | Isolation multi-utilisateurs, shell natif | 6 PASS — **MU-01 échoue avec `main`** |
| JVM-01…15 | AssetServer.java | 15 PASS |
| — | Appareil photo (preuve) | **NON TESTÉ** (téléphone requis) |
| — | Bouton retour Android | **NON TESTÉ** (téléphone requis) |

### Avant / après correction (même simulation, seul `auth-gate.js` change)

| Version de `shared/auth-gate.js` | Résultat |
|---|---|
| `main` | 62 PASS / **12 FAIL** (T04, T06, T20b, T32, T33, T41 × 2 écrans) |
| branche | **82 PASS / 0 FAIL** (stable sur 3 exécutions) |

## 3. Non-régression Web (exécutée sur la branche rebasée sur `main` 8f9aac3)

| Test | Branche | `main` |
|---|---|---|
| offline-field-static / offline-field-e2e | PASS / PASS | PASS / PASS |
| offline-field-multi-user-e2e (nouveau) | PASS | **FAIL** (défaut corrigé) |
| field-buying-profiles / performance / prefilled-edit (static) | PASS | PASS |
| operations-suite-static, pjs-export-static, pjs-export-e2e, master-export-producteurs | PASS | PASS |
| field-buying-e2e | FAIL | **FAIL identique** — test périmé : sa doublure ne fournit pas la RPC `procurement_active_rule` désormais exigée par le formulaire village (hérité, hors APK) |
| verifier-js / verifier-html / verifier-liens | 0 nouvelle erreur | — |

## 4. Fiche de test sur téléphone (à exécuter avant diffusion)

Sur **deux téléphones** (un Android 8–10 d'entrée de gamme, un Android 12+), avec l'APK debug
puis avec l'APK release signé. Pour chaque ligne, noter : téléphone, version Android, résultat, capture.

| # | Procédure | Attendu |
|---|---|---|
| A1 | Installer l'APK depuis WhatsApp | Icône ANAGROCI FIELD BUYING |
| A2 | Ouvrir en mode avion (jamais connecté) | Écran de connexion + « Hors ligne : une connexion Internet est nécessaire… » |
| A3 | Se connecter avec un compte **de test** créé par le Branch Manager | Rubrique FIELD BUYING, rôle correct |
| A4 | Synchronisation › Préparer le mode hors ligne | « Prêt pour le terrain » |
| A5 | Mode avion › enrôler un producteur **fictif**, prendre la photo de preuve, autoriser le GPS | « Sauvegardé sur cet appareil », photo jointe |
| A6 | Fermer l'application (balayer), éteindre/rallumer, rouvrir en mode avion | Opération toujours en attente |
| A7 | Bouton retour Android dans les rubriques puis à l'accueil | Revient en arrière, puis met l'app en arrière-plan |
| A8 | Couper le mode avion | Synchronisé, Farmer ID attribué ; vérifier dans la version Web |
| A9 | Exporter un rapport Excel | Fichier dans Téléchargements/ANAGROCI, ouvrable |
| A10 | Installer la v1.0.1 (versionCode 2) par-dessus avec une opération en attente | Mise à jour acceptée, opération conservée, session conservée |
| A11 | Se déconnecter avec une opération en attente | Avertissement |
| A12 | Désactiver le compte de test côté administration, rouvrir avec réseau | « Compte désactivé » |
| A13 | Supprimer le compte de test (Branch Manager) et ses données fictives | — |

## 5. Résultats détaillés de la simulation (machine)

Exécution du 16/10/2026, commit Web `bdf0b7f`, données synthétiques.

| ID | Configuration | Procédure | Résultat attendu | Résultat constaté | Statut |
|---|---|---|---|---|---|
| T02 | Android 360×640 | Ouverture de l’application sans réseau externe (CDN bloqués) | Page chargée depuis l’APK | formulaire en 495 ms, requêtes externes bloquées : 0 | PASS |
| T03 | Android 360×640 | Affichage de l’écran de connexion | Email (clavier email) + mot de passe | types=email/password/username, débordement=0px | PASS |
| T31 | Android 360×640 | Service Worker désactivé dans l’APK (pas de cache périmé après mise à jour) | register() refusé, 0 enregistrement | refusé : Service Worker inutile dans l’application Android : fichiers embarqués. · enregistrements=0 | PASS |
| T05 | Android 360×640 | Mot de passe incorrect | « Email ou mot de passe incorrect. » | message affiché | PASS |
| T05b | Android 360×640 | Compte inexistant | Même message que le mot de passe incorrect (anti-énumération) | message identique | PASS |
| T06 | Android 360×640 | Compte désactivé dans l’authentification (banni) | « Compte désactivé » | message affiché | PASS |
| T20b | Android 360×640 | Réseau coupé au moment de se connecter | Message réseau (pas « mot de passe incorrect ») | message réseau affiché | PASS |
| T32 | Android 360×640 | Première connexion sans Internet (aucune session) | Message : connexion Internet nécessaire | message affiché | PASS |
| T04 | Android 360×640 | Connexion compte de test valide (Unit Head, serveur simulé) | Accès accordé, niveau chef, pas BM | {"role":"Unit Head","niveau":"chef","estBM":false} | PASS |
| T08 | Android 360×640 | Maintien de la session après rechargement | Pas de nouvelle saisie du mot de passe | session conservée | PASS |
| T22a | Android 360×640 | Réouverture hors ligne avec session et profil en cache | Application accessible | accès accordé depuis le cache | PASS |
| T07 | Android 360×640 | Unit Head ouvre l’administration (réservée BM) | « Accès non autorisé » | refusé | PASS |
| T33 | Android 360×640 | Session expirée | Message « Session expirée… opérations conservées » | message affiché | PASS |
| T06b | Android 360×640 | Profil désactivé dans FBMS (actif = false) | « Compte désactivé » | message affiché | PASS |
| T34 | Android 360×640 | Compte sans profil configuré | « Profil introuvable » | message affiché | PASS |
| T41 | Android 360×640 | Rôle résolu même si le fichier des rôles arrive en retard (2,5 s) | Unit Head = niveau chef | niveau=chef | PASS |
| T35 | Android 360×640 | Erreurs JavaScript pendant les parcours d’authentification | Aucune | aucune | PASS |
| T36 | Android 360×640 | Préparer le mode terrain (shell embarqué, sans Service Worker) | « Prêt pour le terrain », native_bundle=true | prêt · {"native_bundle":true,"missing":[]} | PASS |
| T17 | Android 360×640 | Navigation entre les 9 rubriques FIELD BUYING | Chaque rubrique s’affiche | overview, purchases, census, farmers, cooperatives, rt, bags, cash, sync | PASS |
| T18 | Android 360×640 | Petit écran : débordement horizontal de la page | ≤ 0 px sur chaque rubrique | max 0px (aucun) | PASS |
| T09 | Android 360×640 | Ouverture du module Producteurs | Liste/fiche affichée | producteur synthétique listé | PASS |
| T11 | Android 360×640 | Recherche d’un producteur | Trouvé avec « EXISTANT », absent avec un terme inconnu | trouvé=true · filtré=true | PASS |
| T10 | Android 360×640 | Consultation des villages (RT & Villages) | Village synthétique affiché | affiché | PASS |
| T13 | Android 360×640 | Formulaire de recensement village (création) | Fiche à sections s1…s9 avec champs obligatoires | {"sections":13,"requis":2} | PASS |
| T14 | Android 360×640 | Modification d’une fiche existante (préremplie) | Valeurs actuelles chargées dans le formulaire | nom du village prérempli | PASS |
| T21a | Android 360×640 | Fermeture + réouverture complète sans réseau | Application utilisable, état « Hors ligne » visible | utilisable, indicateur Hors ligne affiché | PASS |
| T21 | Android 360×640 | Enrôlement producteur hors ligne | Opération PENDING avec identifiant et clé d’idempotence | PENDING · id=b48f5cfe… · clé=6e87a9cf… | PASS |
| T16b | Android 360×640 | Clavier téléphone pour le numéro | inputmode="tel" | inputmode=tel | PASS |
| T16 | Android 360×640 | Listes déroulantes (village, RT, producteur local) | Options sélectionnables | 3 options producteur, producteur local sélectionné | PASS |
| T21b | Android 360×640 | Achat hors ligne lié au producteur local | PENDING, dépend de l’enrôlement | PENDING · dépend de l’enrôlement : true · message « Achat sauvegardé » vu : true | PASS |
| T16c | Android 360×640 | Clavier numérique pour les poids | type="number" | type=number | PASS |
| T22 | Android 360×640 | Fermeture et réouverture sans réseau : file conservée | Mêmes opérations | 2/2 opérations | PASS |
| T27 | Android 360×640 | Synchronisation tentée sans réseau | Échec explicite, aucune perte | échec explicite · 2 PENDING conservées | PASS |
| T28 | Android 360×640 | Déconnexion avec opérations en attente | Avertissement avant déconnexion, file conservée | 2 opération(s) ne sont pas encore synchronisée(s). Elles resteront sur cet appareil, mais … | PASS |
| T23 | Android 360×640 | Retour d’Internet | Synchronisation déclenchée | 2 appel(s) offline_sync_batch | PASS |
| T24 | Android 360×640 | Synchronisation : producteur puis achat | Les deux SYNCED, achat rattaché au Farmer serveur | SYNCED · farmer envoyé=farmer-server-0 | PASS |
| T25 | Android 360×640 | Rejeu de la synchronisation (doublons) | Aucune opération SYNCED renvoyée | 0 nouvel appel, 0 clé envoyée deux fois | PASS |
| T37 | Android 360×640 | Export de fichier (lien download blob:) | Fichier transmis au pont Android (Téléchargements/ANAGROCI) | export-test-apk.csv · text/csv · 15 o | PASS |
| T38 | Android 360×640 | Impression | window.print() → impression Android | 1 demande(s) | PASS |
| T39 | Android 360×640 | GPS (API navigateur, position simulée) | Position fournie à la page | 7.69,-5.03 | PASS |
| T40 | Android 360×640 | Requêtes réseau externes non prévues | 0 (tout est local, Supabase simulé) | 0 | PASS |
| T02 | Android 412×915 | Ouverture de l’application sans réseau externe (CDN bloqués) | Page chargée depuis l’APK | formulaire en 361 ms, requêtes externes bloquées : 0 | PASS |
| T03 | Android 412×915 | Affichage de l’écran de connexion | Email (clavier email) + mot de passe | types=email/password/username, débordement=0px | PASS |
| T31 | Android 412×915 | Service Worker désactivé dans l’APK (pas de cache périmé après mise à jour) | register() refusé, 0 enregistrement | refusé : Service Worker inutile dans l’application Android : fichiers embarqués. · enregistrements=0 | PASS |
| T05 | Android 412×915 | Mot de passe incorrect | « Email ou mot de passe incorrect. » | message affiché | PASS |
| T05b | Android 412×915 | Compte inexistant | Même message que le mot de passe incorrect (anti-énumération) | message identique | PASS |
| T06 | Android 412×915 | Compte désactivé dans l’authentification (banni) | « Compte désactivé » | message affiché | PASS |
| T20b | Android 412×915 | Réseau coupé au moment de se connecter | Message réseau (pas « mot de passe incorrect ») | message réseau affiché | PASS |
| T32 | Android 412×915 | Première connexion sans Internet (aucune session) | Message : connexion Internet nécessaire | message affiché | PASS |
| T04 | Android 412×915 | Connexion compte de test valide (Unit Head, serveur simulé) | Accès accordé, niveau chef, pas BM | {"role":"Unit Head","niveau":"chef","estBM":false} | PASS |
| T08 | Android 412×915 | Maintien de la session après rechargement | Pas de nouvelle saisie du mot de passe | session conservée | PASS |
| T22a | Android 412×915 | Réouverture hors ligne avec session et profil en cache | Application accessible | accès accordé depuis le cache | PASS |
| T07 | Android 412×915 | Unit Head ouvre l’administration (réservée BM) | « Accès non autorisé » | refusé | PASS |
| T33 | Android 412×915 | Session expirée | Message « Session expirée… opérations conservées » | message affiché | PASS |
| T06b | Android 412×915 | Profil désactivé dans FBMS (actif = false) | « Compte désactivé » | message affiché | PASS |
| T34 | Android 412×915 | Compte sans profil configuré | « Profil introuvable » | message affiché | PASS |
| T41 | Android 412×915 | Rôle résolu même si le fichier des rôles arrive en retard (2,5 s) | Unit Head = niveau chef | niveau=chef | PASS |
| T35 | Android 412×915 | Erreurs JavaScript pendant les parcours d’authentification | Aucune | aucune | PASS |
| T36 | Android 412×915 | Préparer le mode terrain (shell embarqué, sans Service Worker) | « Prêt pour le terrain », native_bundle=true | prêt · {"native_bundle":true,"missing":[]} | PASS |
| T17 | Android 412×915 | Navigation entre les 9 rubriques FIELD BUYING | Chaque rubrique s’affiche | overview, purchases, census, farmers, cooperatives, rt, bags, cash, sync | PASS |
| T18 | Android 412×915 | Petit écran : débordement horizontal de la page | ≤ 0 px sur chaque rubrique | max 0px (aucun) | PASS |
| T09 | Android 412×915 | Ouverture du module Producteurs | Liste/fiche affichée | producteur synthétique listé | PASS |
| T11 | Android 412×915 | Recherche d’un producteur | Trouvé avec « EXISTANT », absent avec un terme inconnu | trouvé=true · filtré=true | PASS |
| T10 | Android 412×915 | Consultation des villages (RT & Villages) | Village synthétique affiché | affiché | PASS |
| T13 | Android 412×915 | Formulaire de recensement village (création) | Fiche à sections s1…s9 avec champs obligatoires | {"sections":13,"requis":2} | PASS |
| T14 | Android 412×915 | Modification d’une fiche existante (préremplie) | Valeurs actuelles chargées dans le formulaire | nom du village prérempli | PASS |
| T21a | Android 412×915 | Fermeture + réouverture complète sans réseau | Application utilisable, état « Hors ligne » visible | utilisable, indicateur Hors ligne affiché | PASS |
| T21 | Android 412×915 | Enrôlement producteur hors ligne | Opération PENDING avec identifiant et clé d’idempotence | PENDING · id=8b4ca6ad… · clé=132d47ea… | PASS |
| T16b | Android 412×915 | Clavier téléphone pour le numéro | inputmode="tel" | inputmode=tel | PASS |
| T16 | Android 412×915 | Listes déroulantes (village, RT, producteur local) | Options sélectionnables | 3 options producteur, producteur local sélectionné | PASS |
| T21b | Android 412×915 | Achat hors ligne lié au producteur local | PENDING, dépend de l’enrôlement | PENDING · dépend de l’enrôlement : true · message « Achat sauvegardé » vu : true | PASS |
| T16c | Android 412×915 | Clavier numérique pour les poids | type="number" | type=number | PASS |
| T22 | Android 412×915 | Fermeture et réouverture sans réseau : file conservée | Mêmes opérations | 2/2 opérations | PASS |
| T27 | Android 412×915 | Synchronisation tentée sans réseau | Échec explicite, aucune perte | échec explicite · 2 PENDING conservées | PASS |
| T28 | Android 412×915 | Déconnexion avec opérations en attente | Avertissement avant déconnexion, file conservée | 2 opération(s) ne sont pas encore synchronisée(s). Elles resteront sur cet appareil, mais … | PASS |
| T23 | Android 412×915 | Retour d’Internet | Synchronisation déclenchée | 2 appel(s) offline_sync_batch | PASS |
| T24 | Android 412×915 | Synchronisation : producteur puis achat | Les deux SYNCED, achat rattaché au Farmer serveur | SYNCED · farmer envoyé=farmer-server-0 | PASS |
| T25 | Android 412×915 | Rejeu de la synchronisation (doublons) | Aucune opération SYNCED renvoyée | 0 nouvel appel, 0 clé envoyée deux fois | PASS |
| T37 | Android 412×915 | Export de fichier (lien download blob:) | Fichier transmis au pont Android (Téléchargements/ANAGROCI) | export-test-apk.csv · text/csv · 15 o | PASS |
| T38 | Android 412×915 | Impression | window.print() → impression Android | 1 demande(s) | PASS |
| T39 | Android 412×915 | GPS (API navigateur, position simulée) | Position fournie à la page | 7.69,-5.03 | PASS |
| T40 | Android 412×915 | Requêtes réseau externes non prévues | 0 (tout est local, Supabase simulé) | 0 | PASS |

Fichier source : `android/build/test-reports/apk-webview-sim.json` (régénéré par `node android/tests/apk-webview-sim.mjs`).

> Écart assumé avec la règle « trois largeurs » de `CLAUDE.md` (390×844, 768×1024, 1440×900) :
> l'APK vise des téléphones ; la simulation utilise deux écrans Android réels (360×640, 412×915).
> Les tests Web existants, relancés sans modification, conservent leurs propres largeurs.

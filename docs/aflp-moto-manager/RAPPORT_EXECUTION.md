# AFLP Moto Manager — rapport d'exécution

Mandat du 30/10/2026 · Livraison du 31/10/2026 · Branche `feat/aflp-moto-manager`

## 1. Statut global : PARTIELLEMENT TERMINÉ AVEC BLOCAGES

Le module est développé, intégré au dépôt FBMS et vérifié sur réplique locale et dans un vrai navigateur. Il **n'est pas en production** : les migrations attendent une autorisation, et la matrice officielle n'a pas pu être exécutée faute de fichier.

| Livrable | Statut | Preuve |
|---|---|---|
| 1. Module intégré dans une branche | TERMINÉ ET VÉRIFIÉ | `moto/`, carte portail dans `index.html` |
| 2. Code, modèle de données, migrations, configuration | TERMINÉ ET VÉRIFIÉ (non appliqué) | `supabase/20261031090000…0300_*.sql` |
| 3. Démonstration vérifiable | TERMINÉ ET VÉRIFIÉ (environnement local) | `tests/moto/e2e/`, captures `tests/moto/resultats/captures/` |
| 4. Matrice Excel renseignée | PARTIELLEMENT TERMINÉ AVEC BLOCAGES | Matrice officielle absente → `AFLP_Moto_Manager_Matrice_Recette_Substitution.xlsx` |
| 5. Guides | TERMINÉ ET VÉRIFIÉ | `docs/aflp-moto-manager/GUIDE.md` |
| 6. Rapport de sécurité | TERMINÉ ET VÉRIFIÉ | `docs/aflp-moto-manager/RAPPORT_SECURITE.md` |
| 7. Rapport d'exécution | Ce document | |

## 2. Résultats des tests (exécutés)

| Campagne | Résultat | Fichier |
|---|---|---|
| Serveur : 186 scénarios sous rôle `authenticated`, réplique PostgreSQL 16 vérifiée md5 contre la production, migrations rejouées 2 fois (idempotence) | **186/186** | `tests/moto/resultats/serveur.json`, `serveur.md` |
| Navigateur de bout en bout : vraie interface → émulateur local d'API → vraies fonctions et RLS ; 390×844, 768×1024, 1440×900 | **54/54** | `navigateur.json`, `navigateur.log`, captures |
| Unitaires du cœur métier (formules miroir des vues SQL) | **10/10** | `unitaires.txt` |
| Portes qualité du dépôt : HTML, liens, syntaxe JS, politique de chemins | 0 nouveau défaut | `portes-qualite.log` |
| Non-régression : 35 pages × 3 largeurs dans Chromium (`verifier-pages.mjs`) | 0 nouveau défaut ; 20 défauts hérités inchangés | `verifier-pages.log` |

Parcours démontrés dans le navigateur : création au passeport (sans châssis inventé), dépôt de documents dans le stockage privé, refus d'auto-vérification, vérification par le BM, inspection initiale, préaffectation, PV numérisé et vérifié, refus de remise sans gilet, remise, autorisation de circulation distincte, contrôle avant départ, **carburant saisi hors connexion puis synchronisé**, **réponse serveur perdue puis renvoi sans doublon**, consommation plein à plein 3,50 L/100 km identique interface/serveur, **immobilisation immédiate hors connexion** puis notification synchronisée, budget, dotation Mobile Money avec frais, confirmation avec écart, vérification Finance, export Excel (11 onglets), quiz, refus des rôles non habilités et du hors-périmètre.

## 3. Défauts trouvés et corrigés pendant la recette

| Défaut | Gravité | Correction |
|---|---|---|
| `FOR UPDATE` incompatible avec un agrégat : toute demande de remboursement échouait | Bloquant | Verrouillage préalable des lignes, puis agrégat |
| Fonctions internes d'écriture (`private.moto_*`) exécutables directement par `authenticated` | Sécurité | Droits retirés ; seules les fonctions de lecture utilisées par la RLS restent exécutables ; tests REG-07/08 |
| Une coupure réseau pendant l'envoi affichait une erreur alors que la saisie était sauvée : risque de double saisie par l'agent | Élevée (données) | Gestion d'erreur de la synchronisation réécrite ; la saisie reste en file, message « en attente » |
| Heure d'achat arrondie à la minute : faux conflit de compteur avec un relevé de la même minute | Moyenne | Instant exact si l'heure proposée n'est pas modifiée |
| Passeport affiché avec des statuts périmés après action d'un autre responsable | Moyenne | Relecture serveur à chaque ouverture |
| Dotation en écart : la part réellement reçue n'entrait pas dans l'avance à apurer (solde négatif trompeur) | Moyenne (finance) | Part reçue comptée ; écart signalé à part ; solde négatif affiché « pré-financé par l'agent » |
| Fenêtre modale restant ouverte après navigation | Faible | Fermeture au changement de route |
| Libellé « Documents en attente » affiché pour la file de synchronisation ; chevauchement de l'en-tête à 390 px | Faible | Libellés dédiés ; en-tête mobile réorganisé |

## 4. Fichiers produits

- Interface : `moto/index.html`, `moto/moto-app.js`, `moto/moto-core.js`, `moto/moto-offline.js`, `moto/moto-formation.js`, `moto/moto.css`, `moto/portal-moto.css`
- Portail : `index.html` (carte n° 6), `assets/operations/modules/moto-manager.webp` (photo d'une APSONIC AP150-30 fournie par M. KOUASSI le 30/10/2026, recadrée 16:9)
- Base : 23 tables `moto_*`, 12 vues, ~45 fonctions, bucket privé `moto-documents`, rollback en deux niveaux
- Tests : `tests/moto/` (serveur, unitaires, E2E, émulateur local, résultats, matrice)
- Documentation : `docs/aflp-moto-manager/`

Fichiers interdits par `CLAUDE.md` **non modifiés** : `shared/auth-gate.js`, `shared/admin.html`, `sw.js`, `manifest.webmanifest`, `.github/**`, migrations existantes. Les nouveaux fichiers `supabase/` et `index.html` relèvent de la revue humaine obligatoire.

## 5. Blocages

1. **Matrice officielle et cahier de cadrage absents de la session** : seul le mandat texte était joint. Les 78 scénarios / 48 P0 n'ont pu être ni lus ni exécutés. Écarts possibles entre mon interprétation et le cadrage (listes de contrôle, équipements, droits Finance/RH).
2. **Migrations non appliquées** : autorisation spécifique requise (mandat § 14).
3. **Aucun compte General Manager ni Finance Manager actif** en production : une correction initiée par le BM n'aurait aujourd'hui aucun valideur.
4. **Aucun rôle RH** dans FBMS : vérification du permis déclarative.
5. **Pas d'appareil iPhone ni Android réel** : seul Chromium (émulation 390×844) a été testé. Safari iOS n'est pas vérifié.
6. **Photo de la carte** : la photo fournie est un visuel commercial APSONIC (marque visible). Usage interne retenu à votre demande ; une photo prise par ANAGROCI d'une des 4 motos réceptionnées éliminerait toute question de droits.

## 6. Prochaines actions

| # | Action | Responsable |
|---|---|---|
| 1 | Facultatif : remplacer le visuel commercial par une photo ANAGROCI d'une moto réceptionnée (même fichier `moto-manager.webp`) | M. KOUASSI |
| 2 | Fournir le cahier de cadrage et la matrice V1 pour exécution des 78 scénarios | M. KOUASSI |
| 3 | Revue de la pull request (supabase, index.html) | Revue humaine |
| 4 | Appliquer les 3 migrations sur une branche Supabase de préproduction, puis contrôles § 3 du guide | Autorisation BM |
| 5 | Créer un compte valideur indépendant (Finance Manager ou GM) ; décider du rôle RH | BM / RH |
| 6 | Valider la liste des points de contrôle et équipements ; paramétrer les règles d'entretien après lecture du manuel AP150-30 | BM / ANAGROCI |
| 7 | Test sur 1 iPhone et 1 Android réels, en zone sans réseau | Pilote |
| 8 | Saisie des 4 motos à réception des documents (annoncés le 02/11/2026, non confirmés) ; mise en service 2 + 2 ; observation 6 semaines | ABM / BM |

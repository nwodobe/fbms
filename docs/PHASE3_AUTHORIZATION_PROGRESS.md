# Savoir+ — Phase 3 : authentification et autorisation

Date : 2026-08-04
Branche : `phase-3/auth-authorization`
Statut : **EN COURS — noyau d’autorisation livré, intégration Auth.js non finalisée**

## Livré

### Politique d’autorisation centralisée

Fichier : `savoir-plus/src/server/authorization/policy.ts`

Gardes disponibles :

- `requireSession`
- `requireActiveAccount`
- `requireRole`
- `requireOwnership`
- `requireActiveParentLink`
- `requirePublishedContent`
- `requireSolutionUnlocked`
- `requireHintUnlocked`
- `assertNoCrossUser`
- `sanitizeClientIdentity`
- `assertExercisePayloadSafe`

Les réponses suivent la matrice : 401 pour absence/expiration de session, 403 pour action interdite, 404 pour non-divulgation des ressources d’autrui.

### Matrice des 18 tests bloquants

Fichier : `savoir-plus/src/server/authorization/policy.test.ts`

Les scénarios T-01 à T-18 de `docs/AUTHORIZATION_MATRIX.md` sont représentés dans le code. Les tests couvrent notamment :

- accès croisé entre élèves ;
- liens parent-enfant absents, en attente ou révoqués ;
- rôle falsifié dans le payload ;
- comptes suspendus ;
- sessions expirées ;
- solution et indices verrouillés ;
- fuite de `correct_answer` ;
- lots de synchronisation multi-utilisateurs ;
- contenu en brouillon ;
- assets appartenant à un autre utilisateur.

### Sessions en base Neon

Fichier : `savoir-plus/src/server/auth/session-service.ts`

Fonctions disponibles :

- création d’un jeton de session aléatoire de 256 bits ;
- expiration à 30 jours ;
- résolution d’une session active ;
- relecture en base du rôle et du statut utilisateur à chaque résolution ;
- révocation d’une session ;
- révocation de toutes les sessions d’un utilisateur.

Cette dernière fonction doit être appelée après tout changement de mot de passe.

## Base de données

Aucune nouvelle migration n’est nécessaire pour ce lot. Les tables `users`, `accounts`, `sessions`, `verification_tokens` et `parent_student_links` existent déjà sur Neon `main`.

## Blocage détecté

L’intégration Auth.js et Argon2id nécessite l’ajout des paquets :

- `next-auth`
- `@auth/drizzle-adapter`
- `argon2`

Le registre npm disponible dans l’environnement d’exécution ne fournit pas actuellement `@auth/drizzle-adapter`. Une tentative de génération du lockfile a retourné une erreur 404. Les changements de dépendances ont donc été retirés afin de ne pas casser `npm ci` et la CI du dépôt.

Aucun code dépendant de paquets non installables n’a été conservé.

## Point d’architecture à résoudre

La combinaison suivante doit être validée par un test d’intégration avant adoption :

- fournisseur email/mot de passe ;
- stratégie de session en base ;
- schéma Drizzle personnalisé existant ;
- Auth.js v5.

L’adaptateur ne doit pas être branché sans confirmer la compatibilité des noms de colonnes existants, notamment `email_verified_at`, et le comportement du fournisseur Credentials avec les sessions en base.

## Critères restant à satisfaire

- installer les dépendances avec un lockfile reproductible ;
- intégrer Auth.js sans modifier les garanties de révocation immédiate ;
- implémenter Argon2id ;
- créer les Route Handlers de connexion et déconnexion ;
- ajouter la vérification d’email et la récupération de mot de passe ;
- ajouter l’audit obligatoire pour T-13 et T-17 ;
- exécuter `npm run verify` dans la CI ;
- ajouter des tests d’intégration HTTP pour T-08 et T-12.

## Décision de sécurité

La Phase 3 ne doit pas être déclarée terminée tant que les dépendances Auth.js/Argon2id ne sont pas installées et que les tests d’intégration ne sont pas exécutés. Le noyau livré constitue la première sous-phase : **3A — autorisation et cycle de session**.

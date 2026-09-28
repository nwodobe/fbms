# FBMS Free Ephemeral Staging

Date: 2026-08-22
Branch: `qa/fbms-offline-sync-hardening`
PR: #177
Production project: `jmbdgpdthzpszfnddwzi` (READ ONLY during this work)

## Decision

Aucun projet Supabase payant et aucune branche Supabase payante ne sont requis pour la campagne QA initiale.

Le staging retenu est un environnement Supabase local ephemere execute dans GitHub Actions. Les conteneurs sont crees pour la campagne de test puis detruits sans backup.

## Protection Production

- Le workflow refuse la presence de l'URL du projet Supabase Production dans sa surface de test.
- Aucun `service_role` de Production n'est utilise.
- Aucun jeu de donnees operationnel n'est copie.
- Les donnees de staging sont exclusivement synthetiques et identifiables par `TEST_*`.
- Aucun test de charge n'est lance contre Production.
- Aucune modification n'est appliquee a `main` automatiquement.

## Composants crees

- `.github/workflows/fbms-free-staging.yml`
- `tests/staging/bootstrap.sql`
- `tests/staging/seed.sql`
- `tests/staging/integrity.sql`
- `tests/staging/rls.sql`
- `shared/offline-outbox.mjs`
- `tests/offline-outbox.test.mjs`

## Perimetre du schema synthetique

Le bootstrap couvre les entites critiques suivantes :

- profils
- villages
- RT
- producteurs
- equipes
- missions
- mission_villages
- checkins
- preuves
- sessions_formation
- depenses_mission
- achats
- avances
- sacs_mouvements
- audit_log

Il reutilise aussi les scripts metier du depot pour RLS, achats, cash et sacherie V2 lorsque possible.

## Donnees synthetiques

Le seed cree notamment :

- 1 Branch Manager
- 1 Supervisor
- 2 Agents Recenseurs actifs sur deux clusters differents
- 1 compte Agent inactif
- 3 villages
- 3 RT
- 2 producteurs
- 2 equipes
- 2 missions
- 1 achat
- 1 avance/cycle
- 1 mouvement de sacs
- 1 preuve
- 1 formation
- 1 depense
- 1 check-in

Aucune donnee reelle ANAGROCI n'est utilisee.

## Assertions d'integrite

Les tests doivent echouer en cas de :

- producteur orphelin de village ou RT
- mission_village orpheline
- check-in orphelin
- depense avec mission/preuve orpheline
- incoherence montant = poids net x prix/kg
- commission RT incoherente
- mouvement de sacs de quantite invalide
- doublon `achats.local_id`
- doublon `avances.local_id`
- doublon `sacs_mouvements.local_id`
- second cycle de financement OPEN sur un meme RT

## Assertions RLS de base

- Agent actif : lecture des donnees autorisees et lecture de son propre profil.
- Agent actif : ne peut pas effectuer une mise a jour d'achat reservee au Branch Manager.
- Agent actif : peut creer son propre check-in.
- Agent actif : ne peut pas forger le check-in d'un autre utilisateur.
- Compte inactif : ne doit pas lire villages/achats.
- Supervisor : peut effectuer l'update mission prevu mais pas un delete reserve au BM.
- Branch Manager : lecture des profils et update BM sur achat.

## Bug offline 24/25

Le composant de protection atomique refuse integralement une transaction lorsque la capacite restante est insuffisante. Les cas de reference sont :

- 24 + 2 operations
- 23 + 3 operations
- 24 + 3 operations
- 25 + 2 operations

Une transaction ne doit jamais etre partiellement acceptee.

## Statut des preuves

| Controle | Statut |
|---|---|
| Cause racine bug queue 25 | CONFIRMEE PAR CODE |
| Composant atomic outbox | CREE |
| Tests unitaires atomic outbox | PREPARES / resultat precedent PASS |
| Staging Supabase local workflow | CREE |
| Schema synthetique | CREE |
| Seed TEST_* | CREE |
| Assertions integrite | CREEES |
| Assertions RLS de base | CREEES |
| Execution GitHub Actions du nouveau workflow | NON TESTE - workflow en attente d'autorisation GitHub |
| Farmer Registry scope complet multi-cluster | NON TESTE |
| Playwright E2E complet | NON TESTE |
| Charge 1/5/10/25/50/75/100 | NON TESTE |
| Capacite Supabase hebergee 100 utilisateurs | NON TESTE |

## Regle de sortie

Aucun statut GO 100 utilisateurs ne peut etre emis tant que la CI, les tests E2E, l'integrite, la securite RLS complete et les paliers de charge ne disposent pas de preuves d'execution.

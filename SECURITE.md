# Sécurité des accès — ANAGROCI Operations Suite

Ce document explique la couche de sécurité ajoutée à la plateforme et **les étapes
à réaliser côté Supabase** pour l'activer.

## Ce qui a été ajouté (côté code)

| Élément | Fichier | Rôle |
|---|---|---|
| Portail d'authentification | `shared/auth-gate.js` | Masque chaque page tant que l'utilisateur n'est pas connecté **et** autorisé pour le module. Login email + mot de passe, chip utilisateur, déconnexion. |
| Page Administration | `shared/admin.html` | Réservée au **Branch Manager** : créer des accès, changer les rôles, activer / désactiver des comptes. |
| Politiques RLS | `supabase/rls.sql` | **La vraie serrure** : la base refuse toute donnée à un utilisateur non connecté ou hors rôle. |
| Fonction de création de comptes | `supabase/functions/admin-create-user/index.ts` | Crée un compte de façon sécurisée (la clé `service_role` reste côté serveur). |

Le verrou est posé sur : portail (`index.html`), ALIS, Audit distances, Hubs, Carte, FBMS (`fbms/app.html`).

## Pourquoi deux couches ?

La clé publique Supabase est visible dans les pages : un écran de login en JavaScript
**seul** ne protège rien (on peut interroger la base directement en le contournant).
La protection réelle vient des **politiques RLS** (`supabase/rls.sql`). Les deux ensemble
donnent : interface verrouillée **+** données verrouillées.

## Rôles et accès par module

| Rôle Supabase (`profils.role`) | Niveau | Portail | FBMS | Hubs | Carte | Audit | ALIS | Admin |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Branch Manager | bm | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Assistant BM / Head of Field / Procurement | bm | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Supervisor | chef | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Agent Recenseur | agent | ✅ | ✅ | ✅ | ✅ | — | — | — |
| Consultation uniquement | direction | ✅ | — | ✅ | ✅ | — | — | — |

> Seul le **Branch Manager** ouvre l'Administration et gère les comptes.

## Déploiement — à faire dans Supabase (ordre important)

### 1. Créer le premier Branch Manager
- Supabase → **Authentication → Users → Add user** : email + mot de passe.
- Copier l'**UUID** du user créé, puis dans **SQL Editor** :
  ```sql
  insert into public.profils (user_id, nom, email, role, actif)
  values ('<UUID_DU_USER>', 'Votre nom', 'bm@anagroci.ci', 'Branch Manager', true);
  ```

### 2. Activer la RLS
- Supabase → **SQL Editor** → coller **tout** `supabase/rls.sql` → **Run**.
- Vérifier :
  ```sql
  select tablename, rowsecurity from pg_tables where schemaname='public' order by 1;
  ```
  `rowsecurity` doit valoir `true` sur `villages`, `hubs_clusters`, `profils`, etc.

### 3. Déployer la fonction de création de comptes
Nécessite le [CLI Supabase](https://supabase.com/docs/guides/cli) :
```bash
supabase functions deploy admin-create-user
supabase secrets set SERVICE_ROLE_KEY=<clé service_role du projet>   # Settings → API
```
> Tant que la fonction n'est pas déployée, l'Administration peut quand même **changer
> les rôles et activer/désactiver** les comptes existants ; seule la **création** d'un
> nouveau compte depuis l'app nécessite la fonction. (Alternative : créer le user dans
> Authentication puis ajouter sa ligne `profils` en SQL, comme à l'étape 1.)

### 4. Tester
- Ouvrir le portail, se connecter avec le compte BM → tout doit s'ouvrir.
- Ouvrir l'Administration (⚙ dans le chip en haut à droite) → créer un agent → se
  connecter avec ce compte → vérifier qu'il n'accède qu'aux modules autorisés.

## ⚠️ Avant de publier sur le site public
Une fois `main` à jour, **le login devient obligatoire pour tout le monde**. Ne pas
publier avant d'avoir réalisé l'étape 1 (au moins un compte BM), sinon plus personne
ne peut entrer.

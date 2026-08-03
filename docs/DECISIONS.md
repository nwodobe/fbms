# Savoir+ — Journal des décisions d'architecture (ADR)

> Agent responsable : **Software Architect**
> Statut : décisions **proposées**, non ratifiées
> Version : 0.1.0 — 2026-08-03

Format : contexte → options → décision → conséquences.
Statuts : `proposé` · `accepté` · `rejeté` · `remplacé`.
**Aucune décision de ce journal n'est ratifiée** : elles engagent du code qui n'existe pas encore.

---

## ADR-001 — Localisation du code Savoir+

**Statut :** `proposé` — **décision humaine requise (OQ-01)**

### Contexte
Le dépôt `nwodobe/fbms` héberge l'application ANAGROCI FBMS : site statique servi par GitHub Pages depuis la racine, `index.html`, `manifest.webmanifest` et `sw.js` à la racine, aucun `package.json`. Savoir+ est un produit sans lien métier, sur une stack incompatible (Next.js, Neon, Drizzle).

### Options

| # | Option | Avantages | Inconvénients |
|---|---|---|---|
| **A** | **Dépôt dédié `savoir-plus`** | séparation nette · structure §9 appliquée telle quelle · CI, secrets et déploiement propres · aucun risque pour FBMS | nécessite la création d'un dépôt (action humaine) |
| **B** | Sous-répertoire `savoir-plus/` dans `fbms` | aucune action externe · FBMS intact | deux produits, deux stacks, deux bases dans un dépôt · CI complexe · confusion durable · conflit de portée du service worker (INC-04) |
| **C** | Next.js à la racine | structure §9 littérale | **casse le déploiement GitHub Pages de FBMS** — inacceptable |

### Décision proposée
**Option A**, dépôt dédié. À défaut, **option B** comme solution transitoire. **L'option C est écartée.**

### Conséquences
- A : la structure du §9 s'applique à la racine du nouveau dépôt, sans adaptation.
- B : la structure du §9 s'applique dans `savoir-plus/` ; le service worker doit avoir une portée distincte ; la CI doit filtrer par chemin.
- Tant que la décision n'est pas prise, **aucun code applicatif n'est écrit**. Seuls les documents existent, et ils sont transférables tels quels vers l'une ou l'autre option.

---

## ADR-002 — Stratégie de session Auth.js : base de données, pas JWT

**Statut :** `proposé`

### Contexte
Auth.js propose deux stratégies : JWT (sans état) ou session en base.

### Options

| Option | Avantages | Inconvénients |
|---|---|---|
| JWT | pas de requête base à chaque appel · adapté au serverless | **révocation impossible avant expiration** · rôle figé dans le jeton |
| **Base de données** | révocation immédiate · rôle et statut relus à chaque requête · déconnexion réelle | une requête base par appel authentifié |

### Décision
**Session en base de données.**

### Justification
Trois exigences du cahier des charges rendent le JWT inacceptable :
1. la révocation d'un lien parent-enfant doit être **immédiate** — il s'agit des données d'un mineur ;
2. un changement de mot de passe doit invalider **toutes** les sessions ;
3. le rôle et le statut du compte doivent être relus en base à chaque requête (§5 du cahier des charges).

Un JWT resterait valide jusqu'à son expiration après révocation. Sur des données de mineurs, ce délai n'est pas acceptable.

### Conséquences
- Une lecture supplémentaire par requête authentifiée. Atténuation : index sur `sessions.session_token`, requête triviale.
- La table `sessions` croît ; purge des sessions expirées par tâche de maintenance.
- **À réévaluer** si la latence devient un problème mesuré — pas avant.

---

## ADR-003 — Le rôle vit sur `users`, pas dans une table de liaison

**Statut :** `proposé`

### Contexte
Trois rôles MVP : `student`, `parent`, `admin`. Un utilisateur en possède exactement un.

### Décision
Colonne `users.role` de type `enum`, source de vérité unique.

### Justification
Le contrôle de rôle s'exécute à **chaque** requête serveur. Une table de liaison imposerait une jointure sur le chemin le plus chaud du système, pour modéliser une cardinalité qui n'existe pas en MVP.

### Conséquences
- Simple et rapide.
- Le cumul de rôles (parent **et** élève) exigera une migration vers `user_roles`. Cette migration est additive (créer la table, migrer, basculer les lectures), donc non destructrice.
- **Signal de réévaluation :** la première demande réelle de cumul de rôles.

---

## ADR-004 — Contenu versionné : identité stable, contenu dans la version

**Statut :** `proposé`

### Contexte
Le contenu pédagogique évolue : correction d'une erreur, reformulation, changement de difficulté. Les tentatives d'élèves y font référence.

### Options

| Option | Problème |
|---|---|
| Écraser le contenu en place | une tentative de 2026 devient inexplicable après modification |
| Historique par journal d'audit | l'audit sert à tracer, pas à reconstituer un état affichable |
| **Table de versions** | complexité supplémentaire, assumée |

### Décision
`lessons` / `exercises` portent l'**identité stable** ; `lesson_versions` / `exercise_versions` portent le **contenu**. `exercise_attempts` référence `exercise_version_id`, jamais `exercise_id`.

### Conséquences
- On peut corriger un exercice sans réécrire le passé.
- Un exercice dépublié reste interprétable pour les tentatives passées (conflit C5 de `OFFLINE_SYNC.md`).
- Coût : une jointure supplémentaire à la lecture, un `current_version_id` à maintenir.

---

## ADR-005 — Le score est calculé exclusivement côté serveur

**Statut :** `proposé`

### Contexte
Le client pourrait calculer le score localement pour un retour immédiat, notamment en mode hors ligne.

### Décision
**Aucun score calculé côté client n'est jamais persisté ni affiché comme définitif.** En mode hors ligne, le client affiche « en attente de validation », pas un score.

### Justification
Un score calculé côté client est falsifiable en trois clics dans les outils de développement. Un élève qui découvre qu'il peut se donner 100 % rend l'ensemble des données de progression — et donc le tableau parent — sans valeur.

### Conséquences
- Le retour en mode hors ligne est moins immédiat. C'est le prix de l'intégrité, et il est accepté.
- `lib/scoring` est du code partagé mais **exécuté uniquement côté serveur**. Une règle ESLint interdit son import depuis un composant client.

---

## ADR-006 — Idempotence par clé générée à la création de l'intention

**Statut :** `proposé`

### Contexte
Le mode hors ligne rejoue des opérations. Sans idempotence, chaque rejeu duplique.

### Décision
- Clé d'idempotence UUID générée par le client **au moment où l'intention est créée**, jamais au moment de l'envoi.
- Réclamée côté serveur **avant** la transaction métier.
- **Doublée** d'une contrainte d'unicité métier en base pour chaque type d'opération.

### Justification
Générer la clé à l'envoi produit une nouvelle clé à chaque rejeu après timeout : le doublon revient. La double barrière (clé + contrainte) couvre les cas où la clé est perdue — réinstallation, purge du stockage.

### Conséquences
- Une table `idempotency_records`, purgée à 30 jours.
- Chaque nouveau type d'opération doit définir sa contrainte d'unicité métier. C'est une exigence de conception, pas une option.

---

## ADR-007 — Autorisation à double barrière

**Statut :** `proposé`

### Contexte
Neon ne dispose pas de l'intégration Auth ↔ RLS de Supabase. L'autorisation est intégralement applicative.

### Décision
Chaque accès à une donnée utilisateur passe par **deux** barrières indépendantes :
1. une garde nommée dans `server/authorization/`, appelée avant toute requête ;
2. une clause d'appartenance dans la requête SQL elle-même.

### Justification
Sans RLS, une seule barrière laisse une seule occasion de se tromper — sur un système où l'oubli est le mode de défaillance le plus probable.

### Conséquences
- Redondance apparente, assumée.
- Un test générique itère sur toutes les actions exportées pour vérifier la présence d'une garde. Une action ajoutée sans garde fait échouer la CI.

---

## ADR-008 — Deux connexions Neon strictement séparées

**Statut :** `proposé`

### Décision
- `DATABASE_URL` (**poolée**) : application uniquement.
- `DATABASE_URL_UNPOOLED` (**directe**) : migrations, seeds, sauvegardes, maintenance uniquement.
- Garde-fou logiciel : le client applicatif refuse de démarrer si `DATABASE_URL` ne contient pas `-pooler` ; les scripts de migration refusent une URL poolée.

### Justification
Une connexion poolée ne convient pas aux migrations (sessions transactionnelles longues, verrous). Une connexion directe ne convient pas au serverless (épuisement des connexions sous charge). L'erreur est facile et ses symptômes sont trompeurs — d'où le garde-fou automatique plutôt qu'une convention documentaire.

---

## ADR-009 — 404 plutôt que 403 sur les ressources d'autrui

**Statut :** `proposé`

### Décision
Une ressource appartenant à un autre utilisateur renvoie **404**. 403 est réservé aux cas où l'existence n'est pas un secret (rôle insuffisant, compte suspendu, action interdite par nature).

### Justification
403 confirme l'existence de la ressource et permet l'énumération d'identifiants.

### Conséquences
- Diagnostic légèrement plus difficile en développement. Atténuation : les journaux serveur, eux, distinguent les deux cas.

---

## ADR-010 — Fenêtre glissante de 10 mesures pour la maîtrise

**Statut :** `proposé` — **à valider pédagogiquement**

### Contexte
Faut-il calculer la maîtrise sur tout l'historique ou sur les mesures récentes ?

### Décision
Fenêtre glissante des **10 dernières mesures**. `evaluated_count` conserve le total.

### Justification
Une moyenne sur tout l'historique enferme un élève qui progresse : 20 échecs en septembre pèsent indéfiniment sur 10 réussites en décembre. Cela contredit directement la promesse du produit.

### Conséquences
- La valeur 10 est un **paramètre de configuration**, pas une constante enfouie.
- La pondération par récence à l'intérieur de la fenêtre reste ouverte (DM-Q4).
- **À réévaluer sur données réelles.**

---

## ADR-011 — Une transaction par opération de synchronisation, pas par lot

**Statut :** `proposé`

### Décision
`POST /api/sync` traite chaque opération dans sa propre transaction.

### Justification
Une transaction englobant tout le lot ferait perdre 49 opérations valides à cause d'une seule anomalie — exactement ce que le mode hors ligne cherche à éviter.

### Conséquences
- Un lot peut être partiellement appliqué. La réponse retourne donc un statut **par opération**, et le client ne purge que les `synced`.

---

## ADR-012 — Vérification d'e-mail non bloquante pour le diagnostic

**Statut :** `proposé`

### Contexte
Exiger la vérification avant tout usage protège la qualité des comptes mais fait perdre des inscriptions.

### Décision
Le diagnostic est accessible sans vérification. L'invitation d'un parent, elle, l'exige.

### Justification
Le diagnostic est le moment où l'élève découvre la valeur du produit. Le bloquer derrière une boîte mail qu'il n'ouvrira peut-être pas ce soir-là est un coût produit supérieur au bénéfice.

### Conséquences
- Comptes non vérifiés en base ; purge après 30 jours d'inactivité sans vérification.
- Le lien parent-enfant, lui, reste protégé — c'est là que la vérification compte réellement.

---

## ADR-013 — Aucune police web en MVP

**Statut :** `proposé`

### Décision
Police système uniquement.

### Justification
Sur données mobiles prépayées, chaque fichier de police est un coût réel pour la famille et un délai d'affichage supplémentaire. L'identité visuelle repose sur la couleur, l'espacement et la hiérarchie, pas sur une police achetée.

---

## ADR-014 — Aucune donnée pédagogique supprimée en cascade

**Statut :** `proposé`

### Décision
Aucune clé étrangère `on delete cascade` sur une donnée produite par un élève. La suppression de contenu est **logique** (`status`), jamais physique.

### Justification
Supprimer un exercice ne doit pas effacer les tentatives d'un élève : ce serait détruire son historique d'apprentissage pour une opération d'administration de contenu.

### Conséquences
- Des lignes « orphelines fonctionnelles » subsistent, par construction et volontairement.
- La suppression réelle de données personnelles (droit à l'effacement) est un traitement **distinct et explicite**, à définir en DM-Q1.

---

## Décisions en attente

| # | Sujet | Bloque | Question |
|---|---|---|---|
| ADR-015 | Hébergement (Vercel ou autre) | Phase 16 | OQ-04 |
| ADR-016 | Fournisseur d'envoi d'e-mails | Phase 3 | OQ-08 |
| ADR-017 | Outil de supervision des erreurs | Phase 16 | OQ-07 |
| ADR-018 | Rendu des expressions mathématiques (KaTeX, MathML, image) | Phase 6 | OQ-09 |
| ADR-019 | Politique de rétention et d'effacement des données | Phase 2 | DM-Q1, DM-Q2, OQ-05 |

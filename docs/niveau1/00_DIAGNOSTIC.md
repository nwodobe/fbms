# Niveau 1 — Règles et intégrité · Diagnostic préalable

Date : 14 août 2026
Dépôt : `nwodobe/fbms` · branche de travail `niveau1-regles-integrite`
Périmètre : ANAGROCI FieldLink Programme (AFLP 2027) — argent, achats, stocks, sacs, preuves.

> Ce document est le diagnostic exigé avant toute écriture de code. Il décrit le
> dépôt **tel qu'il est au commit `4993f33`**, constaté par lecture des fichiers
> et exécution de contrôles, pas par supposition.

---

## 1. Architecture réelle

| Couche | Réalité constatée |
|---|---|
| Frontend | Site **statique** servi tel quel par GitHub Pages (`.nojekyll`). Aucun `package.json` à la racine, aucun build, aucun bundler, aucun harnais de tests. |
| Logique métier | Embarquée dans les pages HTML et dans `shared/*.js`, chargée dans le navigateur. |
| Backend | **Supabase (PostgreSQL)** uniquement. Il n'existe aucun autre serveur applicatif. |
| Authentification | Supabase Auth + `shared/auth-gate.js` (masque l'UI) + table `public.profils`. |
| Autorisation réelle | Politiques RLS de `supabase/rls.sql`. |
| Publication | Fusion sur `main` ⇒ mise en production immédiate. Un fichier poussé **est** un fichier en production. |

**Conséquence structurante pour cette mission** : « contrôle côté serveur » ne peut
signifier qu'une seule chose ici — **contrainte, trigger, fonction RPC ou politique
RLS dans PostgreSQL**. Il n'y a pas d'API intermédiaire où loger une règle.

**Conséquence de sécurité** : la clé publique Supabase est en clair dans
`shared/anagroci-config.js:24` (c'est le fonctionnement normal d'une clé
`publishable`). Tout contrôle laissé dans le navigateur est donc contournable par
un appel direct à PostgREST. **Le frontend ne protège rien.**

---

## 2. Inventaire des tables concernées

### 2.1 Tables dont la DDL est dans le dépôt

| Table | Fichier | Rôle |
|---|---|---|
| `public.achats` | `supabase/achats.sql` | Achats journaliers RCN Producteur → RT |
| `public.avances` | `supabase/cash.sql` | Avances remises au RT ; **porte aussi le cycle** (`cycle_id`, `cycle_statut`) |
| `public.reconciliations` | `supabase/cash.sql` | Enregistrement passif d'une réconciliation |
| `public.sacs_mouvements` | `supabase/sacs.sql` | Registre des mouvements de sacs |
| `public.bag_movement_requests` | `docs/migrations/sacherie_v2_mvp_20260811.sql` | Demande → approbation BM → exécution |
| `public.profils` | (DDL absente) | Rôles ; étendue par la migration Sacherie V2 |
| `rcn_*` (23 tables) | `supabase/rcntrace.sql` | Traçabilité usine (réceptions, lots, calibrage, `rcn_audit`) |

### 2.2 Objets utilisés par le frontend dont la DDL est **absente du dépôt**

Constat vérifié par recherche : ces objets sont appelés par le code publié mais
aucun fichier du dépôt ne les crée.

| Objet | Appelé depuis | Statut réel en base |
|---|---|---|
| `public.sacherie_ct_snapshot`, `sacherie_ct_inventorier`, `sacherie_ct_*` | `shared/anagroci-sacherie-control-tower.js`, `…-control-actions.js` | **Inconnu** — décrits seulement dans `docs/sacherie_control_tower_sql_plan_20260811.md` |
| `public.rcn_jute_settings`, `public.rcn_jute_transfers` | `docs/sacherie_backend_complements_20260812.md` | **Inconnu** |
| Index `achats_numero_recu_unique_idx` | Erreur interceptée dans `shared/anagroci-audit.js:70` | **Inconnu** — le code sait le nommer, le dépôt ne le crée pas |
| `public.audit_log` | Politiques conditionnelles `supabase/rls.sql:117-126` | **Inconnu** — créé « si la table existe » |

> **Dérive de schéma (P1)** : le dépôt n'est pas la source de vérité de la base.
> Toute migration écrite à l'aveugle risque soit d'échouer, soit d'écraser un
> objet existant. C'est la raison d'être des scripts `PRECHECK` livrés ici.

### 2.3 Absent partout — ni en base connue, ni dans le dépôt

`cycles de financement` (table dédiée), `paiements`, `commissions` (table),
`stocks RCN terrain`, `lots RCN terrain`, `mouvements de stock terrain`,
`évacuations`, `réceptions usine côté terrain`, `anomalies`, `décisions/escalades`,
`ajustements`, `plafonds paramétrables`, `registre papier de secours`,
`file de synchronisation serveur`, `journal d'audit applicatif`.

---

## 3. Flux de données

```
Producteur ──achat──> RT ──> cluster ──> stock ──> transport ──> usine
                │
    Wave / Finance ──avance──> RT ──> cash restant ──> réconciliation
```

Chemin d'écriture réel, aujourd'hui :

```
Navigateur (hors ligne, localStorage/IndexedDB)
   └─> file locale (anagroci_achats, anagroci_avances, anagroci_recons)
        └─> supabase-js .insert() direct sur la table
             └─> PostgREST ─> PostgreSQL (RLS uniquement)
```

Il n'y a **aucune RPC transactionnelle** sur le chemin achats / cash. Les seules
écritures passant par une fonction `SECURITY DEFINER` sont celles de la Sacherie V2
(`sacherie_creer_demande`, `sacherie_decider_demande`, `sacherie_executer_demande`).

---

## 4. Contrôles existants

### 4.1 Réellement imposés par le serveur ✅

| Contrôle | Où |
|---|---|
| `poids_net > 0`, `prix_kg > 0` | `achats.sql:23-24` |
| `montant > 0` sur avance | `cash.sql:18` |
| `quantite > 0` sur mouvement de sacs | `sacs.sql:26` |
| `local_id` **unique** (achats, avances, réconciliations, sacs) | 4 fichiers |
| RLS active + rôle actif obligatoire | `rls.sql` |
| Écriture pour son propre compte (`created_by = auth.uid()`) | achats, sacs, recons |
| `avances` : insertion réservée aux chefs/BM | `cash.sql:61` |
| **Sacherie V2** : plafond recalculé serveur, approval à usage unique, verrous `pg_advisory_xact_lock`, `DOTATION_RT` interdite hors RPC | `sacherie_v2_mvp_20260811.sql` |
| Un seul cycle `OPEN` par RT — *à condition que `cycle_id` soit renseigné* | idem, index partiel ligne 52 |

### 4.2 Contrôles **uniquement frontend** ⚠️

Vérifié dans `docs/step3b_cash_avances_controls_20260720.md` §3-5 et
`shared/anagroci-audit.js` : les règles suivantes sont calculées **dans le
navigateur, à partir de `localStorage`**, et disparaissent dès qu'on appelle
PostgREST directement.

1. « Pas de réconciliation, pas de nouvelle avance » — **la règle centrale du programme**.
2. Achat supérieur au solde d'avance disponible.
3. Date d'avance dans le futur.
4. RT hors référentiel / hors cluster.
5. Cash restant négatif, valeur de stock négative.
6. Réconciliation sans activité détectée.
7. Solde de sacs négatif (`shared/anagroci-sacs-guards.js`).

Le document 3B l'écrit lui-même : *« Ce contrôle est volontairement non bloquant si
aucune donnée cash n'est encore chargée sur l'appareil »*. Une exposition
financière est donc autorisée sur la foi d'un cache absent ou périmé.

---

## 5. Contrôles manquants, par risque

### P0 — bloque la mise en service avec de l'argent réel

| # | Manque | Preuve |
|---|---|---|
| P0-1 | **Reçu dupliqué possible** : `numero_recu` n'a aucune contrainte d'unicité dans le dépôt | `supabase/achats.sql:27` |
| P0-2 | **Nouvelle avance possible sur cycle non réconcilié** : règle 100 % frontend ; côté serveur, une avance avec `cycle_id` NULL échappe même à l'index partiel | `cash.sql:61`, `sacherie_v2:52` |
| P0-3 | **Stock RCN et solde de sacs négatifs possibles** : les soldes sont dérivés par somme, aucune contrainte ni trigger ne les borne | `sacs.sql`, aucune table de stock RCN |
| P0-4 | **Opération clôturée modifiable** : `statut_validation` est un `text` libre ; `achats_upd` autorise le BM à modifier n'importe quelle ligne, quel que soit son statut | `achats.sql:85` |
| P0-5 | **Aucun journal d'audit garanti** : `audit_log` n'est créée nulle part ; les politiques la concernant sont conditionnelles | `rls.sql:117` |
| P0-6 | **Auto-approbation possible** : `validated_by` est un `text` non contraint ; rien n'empêche l'auteur d'un achat de le valider | `achats.sql:41` |
| P0-7 | **Achat sans producteur / RT / cycle / campagne valides** : aucune clé étrangère ; `rt_id`, `producteur_id`, `cluster` sont du texte libre | `achats.sql:14-19` |
| P0-8 | **Doublons de synchronisation possibles** : `local_id` est `unique` mais **nullable** ; deux envois sans `local_id` créent deux lignes | 4 tables |
| P0-9 | **`montant` non vérifié** contre `poids_net × prix_kg` : un client peut écrire n'importe quel montant | `achats.sql:25` |

### P1

| # | Manque |
|---|---|
| P1-1 | Dérive de schéma : objets en base absents du dépôt (§2.2) |
| P1-2 | Aucun moteur de réconciliation ; `reconciliations.ecart` est **fourni par le client** |
| P1-3 | Aucune table d'anomalies, aucune criticité, aucun responsable, aucune échéance |
| P1-4 | Aucun accusé de réception serveur : la file locale peut être purgée sans preuve d'écriture |
| P1-5 | Aucun plafond RT/cluster/programme paramétrable et audité |
| P1-6 | Aucun registre papier de secours |
| P1-7 | `SECURITY DEFINER` sans `revoke from public` sur les fonctions de `rls.sql` |
| P1-8 | Dépôt **public** sur GitHub pour une application financière interne |

### P2

Colonne `impuretes` dépréciée non retirée ; `recu_photo` en base64 dans la table ;
`shared/alis-hardening.js` non analysable (accolade ligne 39) donc ses garde-fous
ne s'exécutent jamais ; ~90 violations axe-core.

---

## 6. Données existantes pouvant bloquer les nouvelles contraintes

Ce risque est **réel et non mesurable depuis le dépôt** : la base de production
n'est pas accessible depuis cet environnement, et l'instruction §6 interdit toute
migration en production.

| Contrainte envisagée | Ce qui peut la faire échouer |
|---|---|
| `unique (numero_recu)` | Reçus historiquement dupliqués, ou vides normalisés en `''` |
| `not null (local_id)` | Lignes anciennes créées sans `local_id` |
| FK `achats.rt_id → rt` | `rt_id` textuels ne correspondant à aucun UUID du référentiel |
| FK `achats.village_id → villages` | `village_id` orphelins |
| `check (montant = poids_net * prix_kg)` | Arrondis historiques, montants saisis à la main |
| `check (poids_net <= poids_brut)` | Tares mal saisies |
| Solde de sacs ≥ 0 | Historique déjà négatif sur un RT |

**Décision appliquée** : aucune contrainte n'est livrée en `VALIDATE`. Toutes les
contraintes rétroactives sont posées **`NOT VALID`** (elles protègent les lignes
nouvelles sans juger l'historique), selon le précédent déjà retenu par la Sacherie
V2 (`sacherie_v2_mvp_20260811.sql:64`). Un script `PRECHECK` mesure les violations
existantes **sans rien modifier**, et un script de remédiation est fourni **sans
exécution automatique** (instruction §3.10).

---

## 7. Contrainte de gouvernance du dépôt — et comment elle est respectée

`CLAUDE.md:74-87` et `agent-policy.yml:116-122` interdisent formellement à un agent
de modifier `supabase/**`, `.github/**` (hors `agent-tests`), `shared/auth-gate.js`,
et de modifier un projet Supabase hébergé.

La mission demandée porte précisément sur ces zones. Le conflit est réel ; il est
tranché ainsi, sans contourner la règle :

1. **Aucun fichier de `supabase/**` n'est modifié.** Les migrations sont livrées
   dans `docs/migrations/niveau1/`, où `docs/**` est explicitement
   auto-modifiable (`agent-policy.yml:102-105`) et où la Sacherie V2 a créé le
   précédent exact pour du SQL destiné à une application humaine manuelle.
2. **Aucune migration n'est exécutée sur la production.** Elles sont exécutées et
   testées sur un PostgreSQL 18.3 local éphémère (PGlite, WASM, sans Docker ni
   droits administrateur), puis remises pour application humaine.
3. Le harnais de test est écrit dans `.github/agent-tests/`, seule zone de
   `.github/` volontairement ouverte (`agent-policy.yml:142-157`).
4. Aucun push, aucune fusion, aucun déploiement.

---

## 8. Plan d'implémentation par lots

| Lot | Objet | Livrable |
|---|---|---|
| **A** | Identifiants uniques et idempotence | `20260814_02` + PRECHECK |
| **B** | Contrôles métier serveur (13 invariants) | `20260814_03`, `_04` |
| **C** | Journal d'audit append-only | `20260814_01` |
| **D** | Clôture, machine d'état, ajustements | `20260814_05` |
| **E** | Moteur de réconciliation + blocage refinancement | `20260814_06` |
| **F** | Moteur d'alertes déterministe | `20260814_07` |
| **G** | Hors ligne maîtrisé, accusé serveur, conflits | `20260814_08` |
| **H** | Registre papier de secours numéroté | `20260814_09` |

Chaque lot est livré avec : migration additive, `ROLLBACK`, `VERIFY`, tests exécutés.

## 9. Fichiers et migrations que je compte créer

**Créés** (aucun fichier existant du dépôt n'est modifié à ce stade) :

```
docs/niveau1/                       documentation (14 documents exigés)
docs/migrations/niveau1/            migrations, rollback, verify, precheck
.github/agent-tests/niveau1/        harnais de tests PGlite
```

**Non modifiés** : `supabase/**`, `shared/auth-gate.js`, `shared/admin.html`,
`.github/workflows/**`, `sw.js`, `manifest.webmanifest`, `savoir-plus/**`.

---

## 10. Ce que ce diagnostic ne peut pas affirmer

- L'état réel de la base de production (schéma, volumétrie, doublons existants).
- Si la migration Sacherie V2 a été appliquée, et dans quelle version.
- Si `audit_log`, `achats_numero_recu_unique_idx` ou les fonctions `sacherie_ct_*`
  existent réellement.

Ces trois points sont des **questions ouvertes bloquantes pour la mise en
production**, pas pour l'écriture des migrations. Ils sont repris au registre des
angles morts.

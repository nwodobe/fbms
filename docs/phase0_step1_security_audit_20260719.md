# Phase 0 et Etape 1 - Sauvegarde / Securite / Acces / Audit

Date: 2026-07-19
Projet: ANAGROCI Operations Suite
Depot: nwodobe/fbms
Supabase project: jmbdgpdthzpszfnddwzi

## 1. Phase 0 - Sauvegarde

### GitHub
Branche de sauvegarde creee:

- `backup-before-global-refactor-20260719`

Cette branche conserve l'etat du depot avant le refactoring global.

### Supabase
Sauvegarde non destructive creee dans le schema:

- `backup_before_global_refactor_20260719`

Toutes les tables du schema `public` ont ete copiees dans ce schema de sauvegarde sans suppression, sans reset et sans modification des tables sources.

Table manifeste:

- `backup_before_global_refactor_20260719._backup_manifest`

Le manifeste contient pour chaque table source:

- schema source;
- table source;
- schema backup;
- table backup;
- nombre de lignes sauvegardees;
- horodatage.

## 2. Inventaire critique constate

Tables avec donnees significatives au moment du backup:

- `villages`: 45 lignes
- `rt`: 61 lignes
- `profils`: 3 lignes
- `lignes_tarifaires`: 126 lignes
- `grilles_tarifaires`: 1 ligne
- `parametres_collecte_courte`: 5 lignes
- `grille_collecte_courte`: 5 lignes
- `hubs_clusters`: 5 lignes
- `log_hubs`: 12 lignes
- `rcn_fournisseurs`: 64 lignes
- `rcn_referentiels`: 19 lignes
- `rcn_state`: 13 lignes
- `rcn_audit`: 36 lignes

## 3. Audit securite Supabase

### Point critique detecte
La table suivante avait RLS desactive au moment de l'audit:

- `public.historique_parametres_collecte_courte`

Risque: table exposee aux roles `anon` et `authenticated` si elle est accessible via l'API Supabase.

Action recommandee, a executer seulement apres validation des policies:

```sql
ALTER TABLE public.historique_parametres_collecte_courte ENABLE ROW LEVEL SECURITY;
```

Attention: activer RLS sans politique peut bloquer l'application. Il faut ajouter les policies adaptees avant ou juste apres activation.

### Autres alertes detectees

- `prod_code_seq` : RLS active mais aucune policy.
- Plusieurs fonctions SECURITY DEFINER sont executables par `anon` ou `authenticated`.
- Plusieurs fonctions n'ont pas de `search_path` fixe.
- `rcn_fournisseurs_write` contient une policy trop permissive.
- Le bucket public `photos` autorise le listing large.

Ces points doivent etre traites par lots, avec tests, pour ne pas casser l'application.

## 4. Audit acces modules

Modules visibles dans le portail:

- Command Center
- Achats Terrain
- Caisse & Avances
- Stock & Sacs
- FBMS Referentiel
- Hubs / Clusters
- Cartographie Terrain
- Audit Distances
- ALIS Depuis FBMS
- RCN TRACE

Point d'attention:

- `RCN TRACE` utilise `data-module="rcntrace"`.
- Le fichier `shared/auth-gate.js` doit inclure explicitement ce module dans la matrice d'acces.

Correction cible:

```js
rcntrace:['bm','chef','direction']
```

ou, si RCN TRACE doit etre strictement reserve a la Direction et au Branch Manager:

```js
rcntrace:['bm','direction']
```

## 5. Audit `audit_log`

La table `audit_log` existe et contient les colonnes:

- `id`
- `ts`
- `email`
- `action`
- `details`

Elle possede des policies d'insertion et de lecture, mais elle est encore peu exploitee par les modules.

Actions sensibles a tracer progressivement:

- connexion utilisateur;
- creation / modification / suppression village;
- creation / modification RT;
- creation / modification producteur;
- creation achat;
- modification achat;
- validation / rejet achat;
- avance RT;
- reconciliation cash;
- mouvement sacs;
- correction stock;
- modification distance;
- simulation ALIS;
- modification bareme;
- reception RCN TRACE;
- decision GM;
- export de donnees.

## 6. Decisions non executees volontairement

Aucune action destructive n'a ete executee.

Non execute volontairement sans validation:

- activation RLS sur `historique_parametres_collecte_courte` ;
- restriction des fonctions SECURITY DEFINER ;
- modification des policies existantes ;
- modification du bucket `photos` ;
- modification de la matrice d'acces sans PR controlee.

## 7. Prochaine action technique recommandee

1. Corriger `shared/auth-gate.js` pour ajouter le module `rcntrace`.
2. Preparer une migration RLS non destructive pour `historique_parametres_collecte_courte` avec policies explicites.
3. Ajouter un helper frontend d'audit commun.
4. Brancher progressivement ce helper sur les modules critiques.
5. Refaire l'audit Supabase apres correction.

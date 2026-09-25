# Architecture du Niveau 1 — Règles et intégrité

Date : 14 août 2026

## 1. Le principe directeur

FBMS est un **site statique** servi par GitHub Pages, dont le seul backend est
Supabase. Il n'existe aucune couche applicative intermédiaire où loger une règle.

Il en découle une conséquence qui structure tout le Niveau 1 :

> **Une règle qui n'est pas dans PostgreSQL n'existe pas.**

La clé publique Supabase est en clair dans `shared/anagroci-config.js:24` — c'est
le fonctionnement normal d'une clé `publishable`. N'importe qui disposant de cette
clé peut appeler PostgREST directement et contourner l'intégralité du JavaScript.
Un contrôle dans le navigateur est une commodité d'ergonomie, jamais une
protection.

## 2. Les cinq mécanismes utilisés, et pourquoi

| Mécanisme | Employé pour | Pourquoi celui-là |
|---|---|---|
| **Contrainte `CHECK`** | Solde non négatif, bornes de valeurs | Ne se contourne pas, même par le propriétaire |
| **Index unique partiel** | Reçu unique, un seul cycle actif par RT, anti-doublon d'alerte | Une garantie que le moteur applique lui-même, y compris sous concurrence |
| **Trigger** | Invariants métier, séparation des tâches, verrou de clôture | S'applique à toute écriture, y compris une insertion directe via PostgREST |
| **Fonction RPC `SECURITY DEFINER`** | Cycles, réconciliation, ajustements, papier, synchronisation | Seul chemin d'écriture pour les opérations composées ; garantit l'atomicité |
| **Politique RLS** | Lecture et périmètre | Première barrière, jamais la seule |

## 3. Pourquoi le solde est une colonne et non une somme

C'est la décision de conception la plus importante du Lot B.

Avant : le solde de sacs d'un RT était une **somme calculée à la lecture**
(`Σ entrées − Σ sorties`). On ne peut poser aucune contrainte sur une somme :
deux transactions concurrentes lisent chacune un solde suffisant, et toutes deux
passent. Le solde devient négatif sans qu'aucune règle n'ait été violée
individuellement.

Après : le solde est une **colonne** de `n1_soldes`, portant
`CHECK (quantite >= 0)`, mise à jour dans la même transaction que le mouvement.
Le verrou de ligne pris par l'`UPDATE` sérialise les concurrents ; la seconde
transaction relit le solde déjà décrémenté et échoue.

Deux pièges rencontrés et corrigés en cours d'implémentation, tous deux
documentés dans le fichier de migration :

1. `INSERT … ON CONFLICT DO UPDATE` ne convient pas à un décrément : PostgreSQL
   évalue le `CHECK` sur la ligne **proposée** avant de détecter le conflit. Il
   faut créer la ligne à zéro, puis l'incrémenter.
2. Les entités « non comptées » — ANAGROCI, PERTE, USINE, et le producteur pour
   le RCN — doivent être filtrées **avant** l'écriture, pas corrigées après.

## 4. Les chemins d'écriture

```
                          ┌──────────────────────────────┐
   Navigateur ──────────► │  PostgREST (clé publishable) │
   (hors ligne possible)  └───────────────┬──────────────┘
                                          │
                    ┌─────────────────────┴─────────────────────┐
                    │                                           │
          écriture directe                            RPC SECURITY DEFINER
        (achats, sacs, stock)                  (cycles, réconciliation, papier,
                    │                           ajustements, synchronisation)
                    ▼                                           ▼
        ┌───────────────────────┐                   ┌────────────────────────┐
        │  RLS : qui peut ?     │                   │  Contrôle de rôle      │
        ├───────────────────────┤                   │  dans la fonction      │
        │  05 verrou de clôture │                   └───────────┬────────────┘
        │  10 identité          │                               │
        │  15 champs modifiables│◄──────────────────────────────┘
        │  20 gardes métier     │
        │  30 machine d'état    │
        │  50 soldes physiques  │
        │  60 écriture liée     │
        │  90 audit             │
        └───────────┬───────────┘
                    ▼
              Données + n1_audit (append-only)
```

Les rangs numériques des triggers sont **fonctionnels** : PostgreSQL les exécute
dans l'ordre alphabétique de leur nom. La garde métier (20) doit s'exécuter après
la pose de l'identité (10), sans quoi elle lirait une campagne encore nulle.

## 5. Ce qui a été ajouté

| Domaine | Objets |
|---|---|
| Socle | `n1_parametres`, `n1_audit`, contexte, masquage |
| Identifiants | clés d'idempotence, codes métier, unicité du reçu |
| Cycles | `n1_cycles`, `n1_transitions`, `n1_exceptions` |
| Physique | `n1_soldes`, `n1_stock_mouvements`, `n1_lots`, `n1_evacuations`, `n1_receptions_usine` |
| Correction | `n1_ajustements` |
| Réconciliation | `n1_reconciliation_lignes`, vue `n1_vue_cycles` |
| Alertes | `n1_anomalies`, `n1_anomalies_historique`, vue `n1_vue_anomalies` |
| Hors ligne | `n1_sync_operations`, `n1_sync_conflits` |
| Papier | `n1_papier_series`, `n1_papier_numeros`, vue `n1_vue_registre_papier` |

**Aucune table existante n'a été supprimée ni renommée.** Les colonnes ajoutées le
sont toutes en `add column if not exists`. `statut_validation`, `cash_statut` et
`stock_statut` — les anciens statuts en texte libre — sont conservés tels quels,
à côté du nouveau `n1_statut` normalisé.

## 6. Ce qui n'a pas été touché, et pourquoi

| Zone | Raison |
|---|---|
| `supabase/**` | `CLAUDE.md:74-87` l'interdit à un agent. Les migrations sont donc livrées dans `docs/migrations/niveau1/`, comme la Sacherie V2 |
| `shared/auth-gate.js`, `shared/admin.html` | Authentification et rôles — interdits |
| `.github/workflows/**` | Un agent qui réécrit sa propre politique n'est plus encadré par elle |
| `sw.js`, `manifest.webmanifest` | Un service worker fautif survit au correctif dans le cache des utilisateurs |
| `savoir-plus/**` | Hors périmètre déclaré |
| Le frontend métier | Revue humaine obligatoire — c'est le principal chantier restant (A-08) |

## 7. Coexistence avec la Sacherie V2

La Sacherie V2 (`docs/migrations/sacherie_v2_mvp_20260811.sql`) porte déjà un
cycle sous forme de colonnes sur `public.avances` (`cycle_id`, `cycle_statut`).
Le Niveau 1 **ne le supprime pas** : il ajoute `cycle_uid` pointant vers la table
`n1_cycles`.

Les deux coexistent :

- `avances.cycle_id` (texte) reste lu par `sacherie_calculer_plafond` ;
- `avances.cycle_uid` (uuid) porte la règle de refinancement du Niveau 1.

La faille que cela corrige : l'index partiel de la Sacherie V2 ne s'applique que
si `cycle_id` est renseigné. Une avance créée avec `cycle_id` NULL y échappait
entièrement. `n1_avance_garde` refuse désormais toute avance sans cycle.

**Unifier les deux représentations est un travail de Niveau 2**, à faire une fois
la Sacherie V2 stabilisée en production. Le faire maintenant demanderait de
modifier une migration déjà livrée.

## 8. Limite structurelle assumée

PostgreSQL n'a pas de transaction autonome. Quand un trigger refuse une écriture,
la ligne d'audit correspondante est annulée avec la transaction. Bloquer prime
sur tracer ; trois mesures compensatoires sont en place (`RAISE WARNING` vers le
journal serveur, RPC de journalisation rappelée par le client, détection par
lot). Détail en `13_ANGLES_MORTS.md`, A-01.

# Dictionnaire des données — Niveau 1

Date : 14 août 2026

Ne décrit que les objets **ajoutés ou modifiés** par le Niveau 1. Les tables
préexistantes (`achats`, `avances`, `sacs_mouvements`, `reconciliations`, `rt`,
`villages`, `producteurs`, `profils`, `rcn_*`) restent décrites par
`docs/DATA_MODEL.md` et les fichiers de `supabase/`.

## 1. Colonnes ajoutées aux tables existantes

### `public.achats`, `public.avances`, `public.reconciliations`, `public.sacs_mouvements`

| Colonne | Type | Sens |
|---|---|---|
| `cle_idempotence` | text | Produite par le terminal **avant** tout envoi. Unique. Rejouer n'écrit jamais deux fois |
| `terminal_id` | text | Appareil d'origine de l'écriture |
| `serveur_recu_le` | timestamptz | Horodatage **serveur** de réception. Base de l'alerte de synchronisation tardive |
| `campagne` | text | Renseignée par trigger depuis `campagne_active`. Périmètre d'unicité du reçu |
| `source_saisie` | text | `APPLICATION`, `PAPIER_SECOURS`, `REPRISE`, `AJUSTEMENT` |
| `{achat,avance,recon,sac}_code` | text | Code lisible `ACH-…`, `AVA-…`. **Aucun contrôle n'en dépend** |

### `public.achats` — colonnes spécifiques

| Colonne | Type | Sens |
|---|---|---|
| `numero_recu_norme` | text **généré** | `numero_recu` sans casse ni ponctuation. **Porte l'unicité** |
| `cycle_uid` | uuid → `n1_cycles` | Cycle de financement. Renseigné par trigger |
| `n1_statut` | text | Statut normalisé. Coexiste avec `statut_validation` (texte libre, conservé) |
| `papier_numero_id` | uuid → `n1_papier_numeros` | Formulaire de secours justifiant l'opération |

> `numero_recu_norme` est `GENERATED ALWAYS … STORED` : elle vaut **NULL dans
> `NEW` au sein d'un trigger `BEFORE`**, car elle n'est calculée qu'après. Tout
> code comparant `OLD` et `NEW` doit l'exclure — deux triggers du Niveau 1 le
> font explicitement, via `pg_attribute.attgenerated`.

## 2. Tables créées

### `n1_parametres` — paramétrage administrable

| Colonne | Type | Sens |
|---|---|---|
| `cle` | text | Nom du paramètre |
| `portee` | text | `GLOBAL`, `CAMPAGNE`, `CLUSTER`, `RT` |
| `portee_ref` | text | Référence de la portée. NULL si `GLOBAL` |
| `valeur_num` / `valeur_txt` / `valeur_bool` | | Au moins une non nulle |
| `version` | integer | Incrémentée à chaque modification. **Rien n'est écrasé** |
| `actif` | boolean | Une seule version active par (clé, portée, référence) |
| `motif` | text | **Obligatoire** |
| `valide_par`, `valide_le` | | Qui a décidé, et quand |

### `n1_audit` — journal append-only

| Colonne | Sens |
|---|---|
| `event_uid` | Identifiant de l'événement |
| `ts_serveur` | Horodatage serveur, jamais fourni par le client |
| `utilisateur`, `utilisateur_nom`, `role` | Auteur et son rôle **au moment de l'acte** |
| `action` | 19 valeurs contraintes (CREATION, CLOTURE, DEBLOCAGE, …) |
| `resultat` | `ACCEPTE` ou `REFUSE` |
| `ressource`, `enregistrement` | Table et identifiant concernés |
| `anciennes_valeurs`, `nouvelles_valeurs` | jsonb, **passés par `n1_masquer()`** |
| `motif` | Justification |
| `terminal_id`, `sync_id`, `correlation_id` | Rattachements techniques |
| `campagne`, `cluster`, `rt_id` | Périmètre métier |

Protégée par deux triggers (`UPDATE`/`DELETE` et `TRUNCATE`) qui rejettent
l'opération **y compris pour le propriétaire de la table**.

`n1_masquer()` remplace le contenu de `recu_photo`, `recu_photo_url`, `photo`,
`piece_jointe` par `[masqué:N car]`, et celui de `password`, `token`, `secret`,
`telephone`, … par `[masqué]`.

### `n1_cycles` — cycle de financement

| Colonne | Sens |
|---|---|
| `cycle_code` | `CYC-{CAMPAGNE}-{CLUSTER}-{SEQ}` |
| `campagne`, `cluster`, `rt_id` | Périmètre |
| `statut` | `OUVERT`, `BLOQUE`, `RECONCILIE`, `CLOTURE`, `ANNULE` |
| `montant_autorise` | Plafond du cycle. Le total des avances ne peut le dépasser |
| `volume_finance_kg`, `prix_reference_kg` | Volume autorisé |
| `echeance` | Date limite. Au-delà, alerte de retard |
| `ouvert_par`, `reconcilie_par`, `cloture_par` | Traçabilité des décisions |

**Index déterminant** : `n1_cycles_un_actif_par_rt_uidx` — au plus un cycle
`OUVERT` ou `BLOQUE` par (campagne, RT). C'est le socle de la règle centrale.

### `n1_soldes` — soldes physiques

| Colonne | Sens |
|---|---|
| `article` | `SACS_VIDES`, `SACS_PLEINS`, `RCN_KG` |
| `entite_type` | `ANAGROCI`, `CLUSTER`, `RT`, `PRODUCTEUR`, `HUB`, `USINE`, `PERTE` |
| `entite_ref` | Identifiant de l'entité |
| `quantite` | **`CHECK (quantite >= 0)`** — la contrainte P0-3 |

Unique sur `(campagne, article, entite_type, entite_ref)`.

### `n1_transitions` — machine d'état

`(entite, statut_source, statut_cible)` → `roles_autorises text[]`,
`exige_motif`, `exige_preuve`. Table de données, consultable, pas du code enfoui.

### `n1_exceptions` et `n1_ajustements`

Les deux portent des contraintes SQL de séparation des tâches :
`approuve_par <> demande_par`, et pour les ajustements
`approuve_par <> auteur_origine`. Motif et preuve non vides sont exigés par
contrainte, pas par l'écran.

### `n1_reconciliation_lignes`

Une ligne par dimension contrôlée (`CASH_RESTANT`, `FINANCEMENT_AUTORISE`,
`STOCK_RCN`, `SACS_RT`, `CLUSTER_USINE`) : valeur attendue, valeur constatée,
écart, tolérance appliquée, cause, statut, criticité, responsable, échéance,
preuve requise, preuve fournie.

### `n1_anomalies`

`empreinte` = `TYPE|ressource|enregistrement|rt|cycle`. Index unique partiel sur
les statuts vivants : une seule anomalie ouverte par empreinte, `occurrences`
comptant les récidives.

### `n1_sync_operations` et `n1_sync_conflits`

File serveur. `cle_idempotence` **unique** : c'est elle qui rend le rejeu sûr.
`resultat` ∈ `EN_ATTENTE`, `ACCEPTE`, `REJETE`, `DOUBLON`, `CONFLIT`.

### `n1_papier_series` et `n1_papier_numeros`

Chaque numéro de la plage est matérialisé en ligne dès la création de la série —
c'est ce qui permet de constater qu'un numéro *manque*. Statuts : `DISPONIBLE`,
`ATTRIBUE`, `UTILISE`, `ANNULE`, `PERDU`, `RESTITUE`.

### `n1_stock_mouvements`, `n1_lots`, `n1_evacuations`, `n1_receptions_usine`

Chaîne physique RCN. `n1_receptions_usine.evacuation_id` est `NOT NULL` et
référencé : une réception sans évacuation est structurellement impossible.
`ecart_kg` est calculé **par le serveur**, jamais fourni par le client.

## 3. Vues

| Vue | Usage |
|---|---|
| `n1_vue_cycles` | Cycles ouverts, en retard, réconciliés, bloqués, clôturés avec exception |
| `n1_vue_anomalies` | Alertes ouvertes, par criticité et échéance |
| `n1_vue_registre_papier` | Registre imprimable des formulaires de secours |

## 4. Conventions

| Convention | Raison |
|---|---|
| Préfixe `n1_` sur tout objet créé | Aucune collision possible avec un objet de production dont la DDL n'est pas au dépôt |
| Rang numérique dans le nom des triggers | PostgreSQL les exécute par ordre alphabétique — le rang est fonctionnel |
| Français pour noms métier, anglais toléré pour les statuts techniques hérités | Cohérence avec l'existant (`bag_movement_requests`) |
| `add column if not exists` systématique | Réexécution sans effet de bord |
| Contraintes rétroactives en `NOT VALID` | Protègent le neuf sans juger l'historique |

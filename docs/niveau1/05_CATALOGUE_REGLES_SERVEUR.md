# Catalogue des règles serveur — Niveau 1

Date : 14 août 2026

Chaque règle ci-dessous est **imposée par PostgreSQL**, pas par l'écran. La
colonne « Preuve » renvoie au scénario du banc d'essai qui la vérifie
(`node .github/agent-tests/niveau1/executer.mjs`).

## 1. Les treize invariants

| # | Invariant | Mécanisme | Fichier | Preuve |
|---|---|---|---|---|
| 1 | Aucun achat sans producteur, RT, cycle et campagne valides | trigger `n1_achat_garde` | 03 | T02 |
| 2 | Aucun reçu dupliqué | index unique sur reçu normalisé | 02 | T01 |
| 3 | Aucun achat au-delà du financement disponible, sauf exception approuvée | trigger `n1_achat_garde` §7.7 | 03 | T02 |
| 4 | Aucune nouvelle avance pour un RT au cycle non réconcilié | `n1_ouvrir_cycle` + `n1_avance_garde` + index unique partiel | 03 | T02, T06 |
| 5 | Aucun stock RCN négatif | colonne `n1_soldes.quantite` + `CHECK (>= 0)` | 04 | T04 |
| 6 | Aucun solde de sacs négatif | idem | 04 | T04 |
| 7 | Aucun mouvement sans auteur, date, origine et entité | triggers `n1_achat_garde`, `n1_sacs_soldes` | 03, 04 | T02, T04 |
| 8 | Aucune auto-approbation quand la séparation l'interdit | triggers `n1_pas_auto_approbation`, contraintes `*_pas_auto_appro` | 03, 05 | T05 |
| 9 | Aucun changement de rôle ou de plafond sans trace | triggers `n1_profil_audit`, RPC `n1_definir_parametre` | 01, 03 | T03 |
| 10 | Aucun contournement des plafonds | `n1_param_num_obligatoire` — **absence = refus** | 01, 03 | T02 |
| 11 | Toute exception justifiée, approuvée, liée à l'opération | table `n1_exceptions` + contrainte anti-auto-approbation | 03 | T02 |
| 12 | Montants, quantités et poids strictement typés et validés | `CHECK` + trigger `n1_achat_garde` §7.4 | 03 | T02 |
| 13 | Opérations financières liées dans une transaction atomique | triggers dans la même transaction (achat → stock) | 04 | T04 |

## 2. La règle centrale du programme

> « Aucun cycle non réconcilié ne peut recevoir une nouvelle avance. »

Elle est portée par **quatre mécanismes indépendants**, de sorte qu'aucun ne soit
un point de défaillance unique :

1. **Index unique partiel** `n1_cycles_un_actif_par_rt_uidx` — au plus un cycle
   `OUVERT` ou `BLOQUE` par (campagne, RT). Un index ne se contourne pas.
2. **`n1_ouvrir_cycle`** refuse l'ouverture si `n1_rt_refinancable()` est faux,
   sous verrou consultatif `pg_advisory_xact_lock` contre les ouvertures
   concurrentes.
3. **`n1_avance_garde`** refuse toute avance sans cycle `OUVERT` — y compris une
   insertion directe dans `public.avances`, ce que faisait le frontend.
4. **`n1_reconcilier_cycle`** ne passe le cycle `RECONCILIE` que si aucune
   dimension n'est en écart hors tolérance ; sinon il le passe `BLOQUE`, et un
   cycle bloqué refuse à la fois les avances et les achats.

Avant cette intervention, cette règle vivait **uniquement dans
`shared/anagroci-audit.js`**, à partir de `localStorage` — donc contournable par
un simple appel PostgREST, et inopérante sur un téléphone au cache vide.

## 3. Paramètres administrables

Aucun plafond, aucune tolérance n'est écrite en dur. Tout passe par
`n1_definir_parametre()`, versionné et audité.

**Règle de sûreté : une valeur absente REFUSE l'opération à risque.** Elle ne
l'autorise jamais « en attendant ». C'est pourquoi certains paramètres doivent
être saisis avant la première opération.

| Clé | Effet si absente | Portées |
|---|---|---|
| `campagne_active` | **Toute écriture refusée** | GLOBAL |
| `plafond_cycle_montant_max` | **Ouverture de cycle refusée** | GLOBAL, CAMPAGNE, CLUSTER, RT |
| `plafond_avance_montant_max` | **Avance refusée** | idem |
| `plafond_achat_montant_max` | **Achat refusé** | idem |
| `cycle_duree_jours` | Échéance de cycle non calculée | GLOBAL, CAMPAGNE |
| `tolerance_montant_fcfa` | Tolérance **nulle** — égalité stricte exigée | idem |
| `tolerance_cash_fcfa` | Tolérance nulle | idem |
| `tolerance_poids_kg` | Tolérance nulle | idem |
| `tolerance_sacs_qte` | Tolérance nulle | idem |
| `tolerance_usine_kg` | Tolérance nulle | idem |
| `delai_resolution_ecart_jours` | 3 jours | GLOBAL |
| `delai_resolution_p0_jours` | 1 jour | GLOBAL |
| `seuil_synchronisation_heures` | 48 heures | GLOBAL |
| `format_numero_papier` | `AFLP-{CAMPAGNE}-{CLUSTER}-{RT}-{SEQUENCE}` | GLOBAL |
| `taille_max_serie_papier` | 1000 | GLOBAL |

La résolution va **du plus spécifique au plus général** : RT, puis cluster, puis
campagne, puis global.

> **Aucune de ces valeurs n'est proposée ici comme une décision métier.** Les
> plafonds et tolérances de l'AFLP 2027 ne sont pas encore arrêtés ; les inscrire
> dans le code reviendrait à décider à la place du programme. Les valeurs de
> repli ci-dessus concernent uniquement les paramètres pour lesquels « le plus
> strict » est un défaut sûr — jamais un plafond financier.

### Séquence de mise en service minimale

```sql
select public.n1_definir_parametre('campagne_active', null, 'AFLP2027', null,
       'Ouverture de la campagne 2027', 'GLOBAL');
select public.n1_definir_parametre('plafond_cycle_montant_max',  <montant>, null, null,
       'Décision BM du <date>', 'GLOBAL');
select public.n1_definir_parametre('plafond_avance_montant_max', <montant>, null, null,
       'Décision BM du <date>', 'GLOBAL');
select public.n1_definir_parametre('plafond_achat_montant_max',  <montant>, null, null,
       'Décision BM du <date>', 'GLOBAL');
select public.n1_definir_parametre('cycle_duree_jours', 21, null, null,
       'Durée standard d''un cycle', 'GLOBAL');
```

## 4. Fonctions RPC exposées

| Fonction | Rôle requis | Effet |
|---|---|---|
| `n1_definir_parametre` | Branch Manager | Nouvelle version d'un paramètre, audité |
| `n1_ouvrir_cycle` | `peut_editer_config` | Ouvre un cycle après contrôle de refinançabilité |
| `n1_reconcilier_cycle` | BM, ABM, Head of Field | Calcule toutes les dimensions et statue |
| `n1_debloquer_cycle` | Branch Manager, **≠ ouvreur du cycle** | Déblocage tracé, écarts marqués résolus |
| `n1_demander_ajustement` | rôle de contrôle | Demande motivée et prouvée |
| `n1_approuver_ajustement` | BM, **≠ demandeur, ≠ auteur** | Applique la contre-écriture |
| `n1_resoudre_anomalie` | rôle de contrôle | Résolution avec preuve |
| `n1_detecter_anomalies` | authentifié | Passe de détection par lot, idempotente |
| `n1_sync_pousser` | authentifié | Écriture idempotente avec accusé |
| `n1_sync_enregistrer_rejet` | authentifié | Conserve un refus hors transaction annulée |
| `n1_papier_creer_serie` | Branch Manager | Matérialise une plage de numéros |
| `n1_papier_attribuer` | rôle de contrôle | Attribue la plage à un responsable nommé |
| `n1_papier_consommer` | authentifié | Rapproche formulaire et opération |
| `n1_papier_declarer` | rôle de contrôle | Annulé / perdu / restitué, justifié |
| `n1_journaliser_refus` | authentifié | Conserve un refus après annulation |

Toutes sont `SECURITY DEFINER` avec `search_path = public` figé, et
`revoke all … from public` suivi d'un `grant execute … to authenticated`.

## 5. Ordre d'exécution des triggers — à ne pas casser

PostgreSQL exécute les triggers d'un même événement dans l'**ordre alphabétique
de leur nom**. Le rang numérique est donc fonctionnel :

| Rang | Trigger | Rôle |
|---|---|---|
| 05 | `trg_n1_05_verrou_cloture` | Refuse toute écriture sur une opération close |
| 10 | `trg_n1_10_identite` | Pose campagne, clé d'idempotence, code métier |
| 15 | `trg_n1_15_champs` | Gèle les champs hors statut pour les non-BM |
| 20 | `trg_n1_20_achat_garde` / `_avance_garde` | Invariants métier |
| 30 | `trg_n1_30_statut` | Machine d'état et séparation des tâches |
| 50 | `trg_n1_50_sacs_soldes` / `_stock_soldes` | Mise à jour des soldes |
| 60 | `trg_n1_60_achat_stock` | Écriture de stock liée à l'achat |
| 90 | `trg_n1_90_audit` | Journalisation |

Renommer un trigger sans respecter son rang casserait silencieusement les gardes
suivantes : la garde métier lirait une campagne encore nulle.

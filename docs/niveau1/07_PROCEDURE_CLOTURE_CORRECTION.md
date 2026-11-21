# Procédure de clôture et de correction — Niveau 1

Date : 14 août 2026 · Migrations 03 et 05

## 1. Machine d'état

### Opérations (achat, avance, mouvement)

```
BROUILLON ──► SOUMIS ──► VALIDE ──► RECONCILIE ──► CLOTURE
                 │          │                          │
                 ├─► REJETE │                          │
                 └─► ANNULE └──────────► AJUSTE ◄──────┘
```

### Cycle de financement

```
OUVERT ──► RECONCILIE ──► CLOTURE
   │  ▲         │
   │  │         └──► BLOQUE
   ├──┴─ BLOQUE ─────┘
   └──► ANNULE
```

Les transitions autorisées, **et les rôles qui peuvent les franchir**, sont
déclarées dans la table `public.n1_transitions` — consultable, pas enfouie dans
du code.

```sql
select * from public.n1_transitions order by entite, statut_source;
```

## 2. Trois degrés de fermeture

| Degré | Statuts | Ce qui reste possible |
|---|---|---|
| **Ouvert** | BROUILLON, SOUMIS, VALIDE | Modification selon le rôle ; un non-BM ne touche que le statut |
| **Gelé** | RECONCILIE | **Seul** le passage à CLOTURE. Tout autre champ est figé |
| **Verrouillé** | CLOTURE, ANNULE, AJUSTE | Rien. Ni modification, ni suppression, pour personne |

Le verrou est porté par le trigger `trg_n1_05_verrou_cloture`, de rang 05 : il
s'exécute **avant** toutes les autres gardes. Inutile de vérifier la légitimité
d'une transition sur une écriture déjà close.

**Ce verrou vaut aussi pour le propriétaire de la base** — vérifié en T05.

## 3. Corriger après clôture

On ne corrige pas : **on contre-passe**. L'écriture d'origine reste intacte et
lisible ; la correction est une écriture supplémentaire.

### Étape 1 — Demander

```sql
select public.n1_demander_ajustement(
  'achats',                    -- ressource
  '<uuid de l''achat>',        -- enregistrement d'origine, OBLIGATOIRE
  'CORRECTION_POIDS',          -- type
  'Erreur de pesée constatée au hub le 14/08',   -- motif, OBLIGATOIRE
  'PV-PESEE-2026-0042',        -- preuve, OBLIGATOIRE
  null, -50, null);            -- delta montant, poids, quantité
```

Rôle requis : un rôle de contrôle. Motif **et** preuve sont exigés par contrainte
SQL, pas par l'écran : une chaîne vide est refusée.

### Étape 2 — Approuver

```sql
select public.n1_approuver_ajustement('<uuid de l''ajustement>', true);
```

Trois refus, tous portés par la base :

| Qui | Résultat |
|---|---|
| Un rôle non-BM | refusé — « Seul le Branch Manager approuve un ajustement » |
| Le **demandeur** de l'ajustement | refusé — séparation des tâches |
| L'**auteur de l'écriture d'origine** | refusé — séparation des tâches |

Il faut donc un **tiers** : ni l'auteur, ni le demandeur. C'est ce qui impose
deux Branch Managers actifs (voir angle mort A-04).

### Ce que l'approbation produit

1. Une **contre-écriture de stock** (`n1_stock_mouvements`, type `AJUSTEMENT`) si
   un poids est corrigé — les soldes suivent immédiatement, dans la même
   transaction.
2. L'écriture d'origine passe `AJUSTE`. **Son montant et son poids ne changent
   pas** : l'historique complet reste lisible.
3. Un événement d'audit `APPROBATION` avec valeurs avant et après.

Vérifié en T05 : après un ajustement de −50 kg sur un achat de 1000 kg, l'achat
affiche toujours 1000 kg et 500 000 FCFA, et le solde de stock passe à 950 kg.

### Refuser un ajustement

```sql
select public.n1_approuver_ajustement('<uuid>', false, 'Motif du refus');
```

Le motif est obligatoire.

## 4. Clôturer un cycle

```sql
-- 1. Réconcilier — le serveur calcule, on ne lui souffle pas le résultat
select public.n1_reconcilier_cycle(
  '<uuid du cycle>',
  <cash restant compté>,      -- FCFA réellement en caisse
  <stock physique compté>,    -- kg réellement en magasin
  <sacs comptés>,             -- unités
  'PV-COMPTAGE-2026-0042');   -- preuve, OBLIGATOIRE
```

Le retour indique `RECONCILIE` ou `BLOQUE`, avec le détail par dimension.

**Un seul écart hors tolérance suffit à bloquer.** Un cycle bloqué refuse les
achats, les avances et tout refinancement du RT.

```sql
-- 2. Puis, seulement si RECONCILIE
update public.n1_cycles set statut = 'CLOTURE' where id = '<uuid>';
```

## 5. Débloquer un cycle

```sql
select public.n1_debloquer_cycle('<uuid>',
  'Erreur de comptage corrigée, recomptage contradictoire effectué',
  'PV-CORRECTION-2026-0042',
  'ERREUR_SAISIE');
```

| Condition | Portée par |
|---|---|
| Rôle Branch Manager | `est_bm()` |
| **Différent de celui qui a ouvert le cycle** | contrôle explicite |
| Motif **et** preuve non vides | contrôle explicite |

Le déblocage **ne fait pas disparaître les écarts** : chaque ligne d'écart passe
`RESOLU`, conserve sa valeur, sa cause et la preuve fournie. La trace est
permanente, et un événement d'audit `DEBLOCAGE` est écrit.

## 6. Causes d'écart normalisées

| Cause | Sens |
|---|---|
| `AUCUNE` | Pas d'écart |
| `INCONNUE` | Écart non expliqué — **le plus grave** |
| `DECALAGE_CALENDRIER` | Marchandise en route, pas encore reçue |
| `PERTE` | Perte physique constatée et acceptée |
| `TOLERANCE_QUALITE` | Écart de poids lié à l'humidité |
| `ERREUR_SAISIE` | Erreur humaine identifiée |
| `VOL_SUSPECTE` | Suspicion — déclenche une escalade hors système |

Le moteur distingue automatiquement le **décalage de calendrier** d'une perte :
si des évacuations sont encore `EN_ROUTE`, l'écart cluster-usine n'est pas
compté comme un manquant.

## 7. Ce que le frontend doit afficher

L'écran doit indiquer clairement qu'une opération est verrouillée — mais la
protection réelle est côté serveur. Si l'écran se trompe, la base refuse quand
même.

| État | Affichage attendu |
|---|---|
| SOUMIS | modifiable par un contrôleur |
| VALIDE | modifiable par un contrôleur, statut seulement |
| RECONCILIE | cadenas partiel : « seule la clôture est possible » |
| CLOTURE | cadenas plein : « corriger par ajustement » |
| AJUSTE | cadenas plein + lien vers l'ajustement qui l'a corrigée |

Cette adaptation n'a pas été faite : voir angle mort A-08.

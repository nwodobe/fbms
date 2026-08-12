# Sacherie AFLP — compléments backend requis

Date : 12 août 2026

## Objet

La refonte de l’écran Sacherie applique côté interface les recommandations d’architecture, de décision et de pilotage qui peuvent être établies à partir des données réellement disponibles.

Trois indicateurs ne doivent pas être inventés dans le navigateur :

1. la tolérance d’écart d’inventaire ;
2. le transit réellement ouvert depuis plus de 7 jours ;
3. la valorisation financière et les jours de couverture.

Le dépôt interdit les modifications automatiques de `supabase/**`. Ce document décrit donc le contrat attendu pour une migration humaine dédiée, sans modifier la base de production.

## 1. Tolérance d’inventaire

### Constat vérifié

La fonction `public.sacherie_ct_inventorier` retourne actuellement `PASS` lorsque l’écart vaut zéro et `HOLD` pour tout écart non nul. La fonction `public.sacherie_ct_snapshot` classe également tout écart cluster non nul en `CRITIQUE`.

### Règle proposée

Créer deux paramètres métier explicites et versionnés dans `public.rcn_jute_settings` :

- `inventory_tolerance_qty integer` ;
- `inventory_tolerance_pct numeric`.

La règle serveur doit utiliser la tolérance la plus protectrice validée par le métier. La valeur exacte **n’est pas définie dans ce document** : elle doit être approuvée par le Branch Manager / propriétaire du processus avant migration.

Le snapshot doit ensuite fournir pour chaque inventaire :

- `tolerance_qty` ;
- `tolerance_pct` ;
- `difference_abs` ;
- `difference_pct` ;
- `status` parmi `NORMAL`, `SURVEILLANCE`, `ATTENTION`, `CRITIQUE` ;
- `status_reason`.

L’interface consomme ce statut et l’affiche sans recalculer une règle métier différente.

## 2. Transit > 7 jours

### Constat

Le journal des mouvements ne suffit pas à prouver qu’un transit historique est encore ouvert. Le calcul canonique doit partir de `public.rcn_jute_transfers`, notamment `statut`, `sent_at`, `received_at`, `qty_sent` et `qty_received`.

### Contrat proposé pour le snapshot

Ajouter une section `transit_aging` :

```json
{
  "open_qty": 0,
  "over_7d_qty": 0,
  "buckets": {
    "0_2d": 0,
    "3_7d": 0,
    "over_7d": 0
  },
  "oldest_open_days": null
}
```

Seuls les transferts effectivement expédiés et non complètement reçus doivent alimenter le transit ouvert. Une ligne historique déjà reçue ne doit jamais rester comptée dans `over_7d_qty`.

## 3. Réconciliation patrimoniale

Le snapshot doit exposer une identité de contrôle indépendante :

`parc début + entrées - sorties autorisées - pertes approuvées = parc théorique courant`.

Le résultat attendu :

- `opening_balance` ;
- `entries` ;
- `authorized_outputs` ;
- `approved_losses` ;
- `expected_closing` ;
- `ledger_closing` ;
- `reconciliation_gap` ;
- `status`.

L’écran ne doit afficher « réconcilié » que si cette identité provient du serveur. Comparer deux totaux dérivés de la même vue serait tautologique et ne constituerait pas un contrôle.

## 4. Valorisation financière

Les mouvements possèdent des champs `unit_cost` / `total_cost`, mais la valorisation ne doit être affichée que lorsqu’un coût réel et traçable est disponible.

Contrat proposé :

- `valuation.unit_cost_source` ;
- `valuation.unit_cost` ;
- `valuation.total_value` ;
- `valuation.immobilized_value` ;
- `valuation.loss_value_period` ;
- `valuation.as_of`.

Sans source réelle, l’interface doit afficher « non disponible » et non zéro FCFA.

## 5. Jours de couverture

Les jours de couverture nécessitent un dénominateur opérationnel : consommation / besoin moyen quotidien de sacs sur une fenêtre validée.

Contrat proposé :

- `coverage.available_bags` ;
- `coverage.daily_requirement` ;
- `coverage.window_days` ;
- `coverage.days` ;
- `coverage.source`.

Aucune moyenne arbitraire ne doit être codée dans le client.

## 6. Critères de recette backend

- un écart non nul dans la tolérance validée n’est plus automatiquement `CRITIQUE` ;
- le seuil utilisé est retourné par le serveur et visible dans l’écran ;
- un transfert reçu depuis longtemps ne compte pas comme transit ouvert > 7 jours ;
- la réconciliation patrimoniale est calculée sur des composantes indépendantes ;
- aucune valorisation n’est affichée sans coût unitaire sourcé ;
- aucun jour de couverture n’est affiché sans besoin quotidien sourcé ;
- les contrôles de rôle et RLS existants restent inchangés.

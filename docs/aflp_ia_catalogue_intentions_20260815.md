# Assistant IA AFLP — catalogue des intentions et dictionnaire des formulations

**Version du catalogue : 1.0.0 · 15 août 2026 · validée par le Branch Manager · AFLP 2027**

Source de vérité : `shared/aflp-ia-catalogue.js`.
Ce document décrit le catalogue ; **il ne le remplace pas**. En cas de
divergence, le fichier fait foi — et une divergence est un défaut à corriger.

---

## 1. Ce qu'est une intention, et ce qu'elle n'est pas

Une intention **désigne** une fonction déterministe du moteur. Elle ne contient
jamais de chiffre, jamais de phrase de réponse, jamais de SQL. Le catalogue dit
« cette question se répond avec `couvertureRt` » ; il ne dit jamais ce que
`couvertureRt` doit répondre.

C'est ce qui permet de corriger le vocabulaire sans toucher au calcul, et
réciproquement.

### Champs d'une intention

| Champ | Rôle |
|---|---|
| `code` | Identifiant stable, minuscules et souligné. Il est journalisé : le changer casse l'historique des mesures |
| `nom` | Libellé métier, affiché à l'utilisateur |
| `description` | Ce que l'intention couvre, et ce qu'elle exclut |
| `statut` | `publie` · `brouillon` · `non_disponible` · `desactive` |
| `fonction` | Nom d'une clé du registre `FONCTIONS` du moteur. Toute autre valeur fait refuser l'intention |
| `donneesRequises` | Tables FBMS nécessaires |
| `donneeManquante` | Obligatoire si `statut = non_disponible` : ce qui manque, nommé |
| `porteesAutorisees` | Sous-ensemble de `global · zone · cluster · village · rt` |
| `periodesAutorisees` | Sous-ensemble de `campaign · day · week` |
| `filtresAutorises` | Sous-ensemble de `status · breakdown` |
| `confianceMin` | En dessous, l'assistant demande confirmation plutôt que de répondre |
| `clarification` | Question à poser quand une information indispensable manque |
| `groupes` | Groupes de mots-clés. **ET** entre groupes, **OU** dans un groupe |
| `indices` | Mots qui renforcent sans être nécessaires. Apport plafonné à un demi-groupe |
| `exclusions` | Mots qui **disqualifient** l'intention |
| `formulations` | Au moins cinq formulations validées |
| `version`, `misAJour`, `valideePar` | Métadonnées du catalogue, communes à toutes les intentions |

### Statuts

- **`publie`** — reconnue et répondue.
- **`brouillon`** — reconnue par le banc d'essai, jamais servie en production.
- **`non_disponible`** — comprise, mais la donnée n'existe pas dans FBMS. La
  réponse est un refus explicite qui **nomme** la donnée manquante. C'est un
  état de première classe : simuler une réponse serait pire que ne rien dire.
- **`desactive`** — retirée du service sans être supprimée de l'histoire.

---

## 2. Les 30 intentions

| # | Code | Nom métier | Statut | Fonction déterministe | Portées | Périodes | Formul. |
|---|------|-----------|--------|----------------------|---------|----------|--------:|
| 1 | `coverage_rt_count` | Nombre d'équipes RT | publie | `couvertureRt` | global, zone, cluster, village | campaign | 13 |
| 2 | `coverage_rt_active_count` | Nombre d'équipes RT actives | publie | `couvertureRt` | global, zone, cluster, village | campaign | 7 |
| 3 | `coverage_rt_list` | Liste des équipes RT | publie | `couvertureRt` | global, zone, cluster, village | campaign | 6 |
| 4 | `coverage_rt_members` | Composition nominative des équipes RT | **non_disponible** | — | global, zone, cluster, village, rt | campaign | 6 |
| 5 | `coverage_village_count` | Nombre de villages | publie | `couvertureVillages` | global, zone, cluster | campaign | 6 |
| 6 | `coverage_inactive_villages` | Villages sans achat | publie | `villagesInactifs` | global, zone, cluster | campaign | 6 |
| 7 | `volume_total` | Volume acheté | publie | `volumePortee` | global, zone, cluster, village, rt | campaign, day, week | 6 |
| 8 | `volume_by_scope` | Volume ventilé | publie | `volumeVentile` | global, zone, cluster | campaign, day, week | 6 |
| 9 | `volume_today` | Volume du jour | publie | `volumePortee` | global, zone, cluster, village, rt | day | 6 |
| 10 | `volume_last_7_days` | Volume des 7 derniers jours | publie | `volumePortee` | global, zone, cluster, village, rt | week | 6 |
| 11 | `progress_to_target` | Avancement vers l'objectif | publie | `avancementObjectif` | global, zone, cluster | campaign | 6 |
| 12 | `remaining_target` | Reste à collecter | publie | `avancementObjectif` | global, zone, cluster | campaign | 6 |
| 13 | `cluster_ranking` | Classement des clusters | publie | `classementClusters` | global, zone | campaign | 6 |
| 14 | `purchase_count` | Nombre d'achats | publie | `compteurAchats` | global, zone, cluster, village, rt | campaign, day, week | 6 |
| 15 | `last_purchase` | Dernier achat | publie | `dernierAchat` | global, zone, cluster, village, rt | campaign | 6 |
| 16 | `cash_advances` | Avances aux équipes RT | publie | `caissePortee` | global, zone, cluster, rt | campaign, day | 6 |
| 17 | `cash_paid` | Payé aux producteurs | publie | `caissePortee` | global, zone, cluster, village, rt | campaign, day, week | 6 |
| 18 | `cash_balance` | Solde de caisse | publie | `caissePortee` | global, zone, cluster, rt | campaign | 6 |
| 19 | `cash_open_exposure` | Exposition ouverte | publie | `expositionOuverte` | global, zone, cluster, rt | campaign | 6 |
| 20 | `reconciliation_status` | État des réconciliations | publie | `etatReconciliation` | global, zone, cluster, rt | campaign | 6 |
| 21 | `unreconciled_rt` | Équipes non réconciliées | publie | `rtNonReconcilies` | global, zone, cluster | campaign | 6 |
| 22 | `refinancing_blocked_rt` | Équipes bloquées pour refinancement | publie | `refinancementPortee` | global, zone, cluster, rt | campaign | 6 |
| 23 | `refinancing_eligible_rt` | Équipes éligibles au refinancement | publie | `refinancementPortee` | global, zone, cluster, rt | campaign | 6 |
| 24 | `refinancing_amount` | Montant refinançable | publie | `refinancementPortee` | global, zone, cluster, rt | campaign | 6 |
| 25 | `bags_balance` | Solde de sacs | publie | `sacsPortee` | global, zone, cluster, rt | campaign | 6 |
| 26 | `bags_negative_balance` | Soldes de sacs négatifs | publie | `sacsNegatifs` | global | campaign | 6 |
| 27 | `quality_missing_receipts` | Achats sans reçu | publie | `qualitePortee` | global, zone, cluster, rt | campaign | 6 |
| 28 | `quality_controls` | Contrôles qualité en attente | publie | `qualitePortee` | global, zone, cluster, rt | campaign | 6 |
| 29 | `priority_alerts` | Priorités du jour | publie | `alertesPrioritaires` | global | campaign, day | 6 |
| 30 | `daily_summary` | Synthèse du jour | publie | `syntheseJour` | global | campaign, day | 6 |

**Total : 188 formulations validées**, soit 6,3 par intention. Jamais moins de 5.

### Écarts assumés par rapport à la liste initialement suggérée

| Suggestion | Décision | Motif |
|---|---|---|
| `coverage_rt_active_count` séparée de `coverage_rt_count` | **Conservée séparée** | Deux chiffres différents. Les fondre laisserait le choix au hasard de la formulation |
| `coverage_rt_members` (non listée) | **Ajoutée en `non_disponible`** | C'est l'ambiguïté la plus dangereuse du domaine : répondre « 1 équipe » à « combien de personnes » donne un chiffre juste à une autre question |
| `volume_by_scope` | **Conservée**, restreinte à la ventilation explicite | « par cluster », « répartition ». Un simple « volume à Béoumi » va à `volume_total` |
| `bags_negative_balance` portée `global` seulement | **Restreinte** | FBMS n'agrège pas les soldes négatifs par cluster. Ouvrir la portée aurait produit un zéro trompeur |

---

## 3. Les intentions indisponibles

### `coverage_rt_members`

**Donnée manquante nommée dans la réponse :**
la composition nominative des équipes RT — FBMS ne dispose d'aucune table
`rt_membres` ni d'un champ de composition validé.

**Réponse produite :**

> FBMS ne dispose pas de cette information : la composition nominative des
> équipes RT — FBMS ne dispose d'aucune table `rt_membres` ni d'un champ de
> composition validé. Je préfère le dire plutôt que produire un chiffre voisin —
> le nombre d'ÉQUIPES RT n'est pas le nombre de personnes qui les composent.

Un test vérifie explicitement que « 1 équipe RT enregistrée » **n'apparaît pas**
dans ce refus.

**Pour la rendre disponible**, il faudrait une table `rt_membres` alimentée et
validée, ou un champ de composition dans `rt.data`. Aucun des deux n'existe. Ce
n'est pas un travail de développement : c'est une décision de collecte de
données.

---

## 4. Le dictionnaire des formulations

Les 188 formulations couvrent délibérément :

| Registre | Exemple |
|---|---|
| Français formel | « Quel est le solde de caisse de GBEKE 1 ? » |
| Français courant | « on a combien d equipes rt » |
| Formulation courte | « Volume du jour » |
| Accents absents | « combien de rt a beoumi » |
| Casse différente | « COMBIEN DE RT DANS GBEKE 2 ? » |
| Ordre des mots inversé | « Effectif RT du cluster Béoumi » |
| Expression métier AFLP | « Quels RT sont bloqués pour refinancement ? » |

### Exemple complet — `coverage_rt_count` (13 formulations)

```
Combien de RT avons-nous à Béoumi ?
Combien de RT à Beoumi ?
Nombre de RT à Béoumi.
Nombre d'équipes RT à Béoumi
Combien d'équipes sont affectées à Béoumi ?
Effectif RT du cluster Béoumi
Donne-moi le nombre de RT de Béoumi
Il y a combien d'équipes RT à Beoumi ?
COMBIEN DE RT DANS GBEKE 2 ?
Nombre de RT par cluster
Nombre de RT par zone
combien de rt au total
on a combien d equipes rt
```

### Exemple complet — `cash_balance`

```
Quel est le solde de caisse de GBEKE 1 ?
Combien reste-t-il en caisse dans la zone 1 ?
Solde cash GBEKE 1
Quel montant reste en circulation à GBEKE 1 ?
Caisse disponible dans la zone GBEKE 1
solde de tresorerie du cluster Beoumi
```

---

## 5. Les exclusions ne sont pas décoratives

Deux intentions voisines qui partagent leur vocabulaire produisent une demande de
clarification **à chaque question** — c'est-à-dire un assistant qui ne répond
plus. Chaque `exclusions` du catalogue a été ajoutée parce qu'une formulation
réelle partait vers la mauvaise intention.

Trois cas réels, trouvés par le corpus et non par relecture :

| Question | Partait vers | Devait aller vers | Correction |
|---|---|---|---|
| « Combien avons-nous avancé aux RT ? » | `coverage_rt_count` | `cash_advances` | `X_COUVERTURE` : tout mot d'argent disqualifie une question de comptage |
| « Quelle équipes RT travaillent à Béoumi ? » (faute) | `coverage_rt_active_count` | `coverage_rt_list` | « travaillent » retiré de la liste des marqueurs d'activité — un verbe générique n'est pas un critère d'activité |
| « Quel montan peut-on refinancer ? » (faute) | `refinancing_eligible_rt` | `refinancing_amount` | Les exclusions tolèrent désormais la faute de frappe, comme les groupes |

Le troisième cas est le plus instructif : **une faute de frappe désactivait le
garde-fou tout en conservant le rapprochement**. Les exclusions et les groupes
emploient maintenant la même fonction d'appariement.

> **Retirer une exclusion sans rejouer `.github/agent-tests/aflp-ia-corpus.mjs`
> casse la reconnaissance en silence.**

---

## 6. Ajouter ou modifier une intention

### Règle de version

Toute modification du contenu du catalogue exige d'**incrémenter
`VERSION_CATALOGUE`**. Cette version est journalisée avec chaque question :
sans elle, aucune mesure de compréhension n'est comparable dans le temps.

| Nature du changement | Incrément |
|---|---|
| Ajout d'une formulation à une intention existante | mineur — `1.0.0` → `1.1.0` |
| Ajout d'une intention | mineur |
| Modification d'un `code`, d'une `fonction`, d'une portée | **majeur** — `1.0.0` → `2.0.0` (l'historique n'est plus comparable) |
| Correction d'exclusion ou d'indice | correctif — `1.0.0` → `1.0.1` |

### Procédure

1. Modifier `shared/aflp-ia-catalogue.js` et incrémenter `VERSION_CATALOGUE`.
2. `node .github/agent-tests/aflp-ia-corpus.mjs` — **doit rester à 100 %**.
3. `node .github/agent-tests/aflp-ia-assistant.mjs`.
4. Si l'intention est nouvelle et publiée, ajouter sa fonction au registre
   `FONCTIONS` du moteur. Le banc refuse une intention publiée dont la fonction
   n'existe pas.
5. Ouvrir une version brouillon dans l'écran d'administration, et suivre
   [`aflp_ia_manuel_administration_20260815.md`](aflp_ia_manuel_administration_20260815.md).

### Ne jamais faire

- Publier une intention `publie` sans fonction de calcul — la base le refuse par
  contrainte, mais le fichier ne le refuse pas : le banc, si.
- Répondre approximativement plutôt que déclarer `non_disponible`.
- Ajouter un synonyme très courant (« par », « quel », « total ») dans un groupe
  obligatoire : il capturerait des questions d'autres intentions.

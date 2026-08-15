# Assistant IA AFLP — contrat de compréhension et politique de clarification

**15 août 2026 · `shared/aflp-ia-comprehension.js` v1.0.0**

---

## 1. Pourquoi un contrat

Le contrat est le **seul point de passage** entre « comprendre une question » et
« calculer une réponse ». Tant qu'il est validé contre un schéma fermé, peu
importe d'où il vient : du moteur déterministe, ou d'une couche linguistique.

C'est cette propriété — et elle seule — qui permet d'ajouter un jour un modèle de
langage sans lui donner le moindre pouvoir sur les chiffres. Le modèle ne peut
produire qu'un contrat ; un contrat ne peut déclencher qu'une lecture prévue.

---

## 2. Le contrat

```json
{
  "intent": "coverage_rt_count",
  "scope": {
    "type": "cluster",
    "id": "BEOUMI",
    "label": "Béoumi"
  },
  "period": "campaign",
  "filters": {
    "status": "all"
  },
  "confidence": 0.98,
  "requires_clarification": false,
  "clarification_question": null
}
```

### Vocabulaire FERMÉ

| Champ | Valeurs admises | Refus |
|---|---|---|
| `intent` | un `code` du catalogue, ou `null` | toute autre valeur, une intention `brouillon` ou `desactive` |
| `scope.type` | `global` · `zone` · `cluster` · `village` · `rt` | toute autre valeur ; une portée non autorisée pour l'intention |
| `scope.id` | identifiant du référentiel | absent alors que `type ≠ global` |
| `period` | `day` · `week` · `campaign` | toute autre valeur ; une période non autorisée pour l'intention |
| `filters` | clés `status` · `breakdown` uniquement | toute autre clé ; une clé non autorisée pour l'intention |
| `filters.status` | `all` · `active` · `registered` · `blocked` · `eligible` | toute autre valeur |
| `filters.breakdown` | `zone` · `cluster` · `village` · `rt` | toute autre valeur |
| `confidence` | nombre dans `[0,1]` | hors bornes, non numérique |
| `requires_clarification` | booléen | autre type |
| `clarification_question` | chaîne ou `null` | `null` alors que `requires_clarification` vaut `true` |

**Toute clé supplémentaire fait refuser le contrat.** C'est ce qui empêche un
modèle de glisser un `answer`, un `montant` ou un `sql` dans sa réponse et
d'espérer qu'il soit lu.

### La validation est appliquée trois fois

| Où | Code | Ce qu'elle protège |
|---|---|---|
| Fonction Edge, §5 | `docs/edge-functions/aflp-ia-langue/index.ts` | Rien ne quitte le serveur sans être conforme |
| Client, avant usage | `shared/aflp-ia-langue.js` | Un serveur compromis ne suffit pas |
| Moteur, avant calcul | `AFLP_IA.repondre(…, contratImpose)` | **Aucun contrat n'a de privilège**, d'où qu'il vienne |

Les trois implémentations ne partagent aucun code : elles n'ont donc pas de
défaut commun. La redondance est délibérée.

---

## 3. Les onze étapes du traitement

| # | Étape | Où | Ce qui peut échouer |
|---|---|---|---|
| 1 | Normalisation | `normaliser` | — |
| 2 | Détection d'intention | `detecterIntention` | aucun candidat → refus |
| 3 | Extraction des entités | `detecterPortee` | nom de lieu inconnu → portée globale |
| 4 | Détection de portée | idem | portée interdite pour l'intention → remontée au global |
| 5 | Détection de période | `detecterPeriode` | période non autorisée → repli sur `campaign` |
| 6 | Validation de la combinaison | `valider` | contrat refusé → aucun calcul |
| 7 | Clarification si nécessaire | `comprendre` | — |
| 8 | Appel de la fonction déterministe | `FONCTIONS[intention.fonction]` | fonction absente du registre → refus |
| 9 | Construction de la réponse | moteur | portée sans donnée → refus explicite |
| 10 | Sources et date | `sourcesDe` | — |
| 11 | Journalisation | `AFLP_IA_JOURNAL` | échec sans conséquence sur la réponse |

### Normalisation

Minuscules, accents retirés, ponctuation et apostrophes remplacées par des
espaces. « Béoumi », « BEOUMI » et « beoumi » deviennent le même mot ;
« d'équipes » devient « d equipes », ce qui isole « equipes ».

### Détection d'intention

Chaque groupe de mots-clés est un **ET**, chaque groupe est un **OU** interne.
Une exclusion rencontrée disqualifie l'intention. Les indices ajoutent au plus
un demi-groupe : ils ne peuvent jamais remplacer un groupe manquant.

La tolérance aux fautes est calibrée sur la longueur du mot : aucune sous
5 lettres (sinon « sac » et « sas » se confondraient), une faute jusqu'à
7 lettres, deux au-delà. Elle s'applique **aussi aux exclusions** — sans cette
symétrie, une faute de frappe désactiverait le garde-fou tout en conservant le
rapprochement.

### Confiance

| Situation | Confiance |
|---|---|
| Formulation validée reconnue mot pour mot | 0,98 |
| Tous les groupes appariés exactement | 0,82 à 0,97 selon les indices |
| Au moins un groupe apparié de façon approchée | 0,62 à 0,80 |
| Nom de lieu rattrapé de façon approchée | plafonnée à 0,84 |
| Ambiguïté entre deux intentions | plafonnée à 0,50 |
| Aucune intention | 0 |

**La confiance ne vaut jamais 1.** Un moteur qui affiche une certitude absolue
sur une phrase humaine se trompe sur la nature du problème.

Traduction en niveau affichable : `haute ≥ 0,80` · `moyenne ≥ 0,60` ·
`faible ≥ 0,30` · `nulle` en dessous.

---

## 4. Politique de clarification

L'assistant demande une clarification dans **quatre** situations, et pas
davantage. Demander trop souvent est une autre façon de ne pas répondre.

### 4.1 Aucune intention reconnue

> Je ne sais pas répondre à cette question à partir des données FBMS chargées.
> Je ne devine pas : reformulez avec un mot-clé métier (volume, avance,
> réconciliation, refinancement, sacs, village, RT).

Statut journalisé : `non_compris`.

### 4.2 Deux intentions trop proches

Déclenchée quand l'écart de score est inférieur à 10 % **et** que les deux
intentions ont la même profondeur.

> Votre question peut vouloir dire deux choses : « … » ou « … ». Laquelle vous
> intéresse ?

Statut : `clarification_demandee`.

### 4.3 Portée obligatoire non fournie

**Convention validée : une question de volume sans portée explicite n'est pas
répondue d'office sur le périmètre global.**

Le Branch Manager pilote six clusters. Lui répondre « 20 MT » quand il pensait à
Béoumi est une erreur silencieuse — le chiffre est juste, la réponse est fausse.

> Combien avons-nous acheté ?
> → Sur quel périmètre : l'ensemble du pilote, une zone (GBEKE 1 / GBEKE 2), un
>   cluster ou une équipe RT ?

Un marqueur explicite lève la clarification : « au total », « pour l'ensemble »,
« globalement », « sur tout le pilote ».

Cette convention ne s'applique **qu'à `volume_total`**. Les intentions dont la
réponse globale a un sens évident (`priority_alerts`, `daily_summary`,
`bags_negative_balance`) répondent directement.

### 4.4 Confiance sous le seuil de l'intention

> Je comprends « … » sans en être sûr. Confirmez-vous, ou reformulez avec le mot
> métier exact ?

### Ce que l'interface propose avec la clarification

Des **raccourcis cliquables** construits à partir du référentiel réel : jamais un
lieu inventé. Redemander « précisez » sans dire quoi préciser renvoie le problème
à l'utilisateur.

---

## 5. Cas particuliers écrits noir sur blanc

### « Combien de RT à Béoumi ? »

Les données permettent de distinguer équipes enregistrées et actives : **la
réponse donne les deux**, sans demander de clarification. Le chiffre principal
est celui des équipes **enregistrées**, conformément au référentiel AFLP où
« RT » désigne une équipe.

### « Combien de personnes RT à Béoumi ? »

Intention comprise (`coverage_rt_members`), donnée absente, refus qui **nomme**
ce qui manque. Aucun nombre d'équipes n'est glissé dans la réponse.

### « Combien avons-nous acheté ? »

Clarification demandée — voir §4.3.

### Une portée nommée mais absente des données chargées

> Aucune donnée n'est chargée pour le cluster de X. La question est comprise,
> mais FBMS n'a rien à agréger sur ce périmètre au 10 mars 2027.

Ce n'est **pas** « zéro ». Un zéro affirme une absence de données ; ce message
affirme une absence de **connaissance**, ce qui n'est pas la même chose.

---

## 6. Ce que la couche de compréhension ne voit jamais

Elle reçoit un `contexte` qui ne contient que des **noms** :

```js
{
  zones:    ["GBEKE 1", "GBEKE 2"],
  clusters: [{ cle: "BEOUMI", label: "Béoumi" }, …],
  villages: [{ nom: "…", cluster: "…" }, …],
  rt:       [{ cle: "…", nom: "…" }, …]
}
```

Aucun montant, aucun volume, aucun solde, aucun identifiant de transaction.
Elle sait **où** situer une question ; elle ne sait rien de ce qui s'y passe.

Construit par `AFLP_IA.contexteComprehension(etat)` — le seul point par lequel
des noms sortent du moteur, et il ne laisse passer aucun chiffre. Vérifié par
exécution dans `.github/agent-tests/aflp-ia-securite.mjs` §4.

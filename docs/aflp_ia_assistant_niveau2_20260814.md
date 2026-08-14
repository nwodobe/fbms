# Assistant IA AFLP — Niveau 2 (assistance métier)

> Programme : **ANAGROCI FieldLink Programme (AFLP) 2027**
> Destinataires : Branch Manager et responsables AFLP
> Statut : **en production** — fusionné le 2026-08-14 (PR #155, commit `85334d7`)
> Dernière mise à jour : 2026-08-14 — répartition des zones confirmée par le Branch Manager

---

## 1. Ce que c'est — et ce que ce n'est pas

L'Assistant IA AFLP est une **couche d'assistance métier** dans FBMS. Elle
répond à quatre questions que le Branch Manager se pose tous les jours :

1. **Où en sommes-nous ?** → synthèse quotidienne du pilote
2. **Qu'est-ce qui cloche ?** → alertes et anomalies datées
3. **Qui peut être refinancé ?** → application de la règle AFLP
4. **Combien / où / qui ?** → questions posées en français

Ce n'est **pas** un agent de maintenance du dépôt. Les sept agents de
`.claude/agents/` auditent et corrigent le code ; l'Assistant IA AFLP, lui, ne
touche à rien : il lit les données opérationnelles et rend un avis chiffré.

### Ce qu'il ne fait pas

- Il **n'écrit jamais** dans Supabase. Aucune décision n'est appliquée à sa
  place : il prépare, le BM tranche.
- Il **n'invente pas de seuil métier**. Les seuils de qualité (humidité, KOR,
  rejet) et de prix sont déjà arbitrés en amont par les colonnes
  `qualite_statut` et `statut_validation` de la table `achats`. Le moteur les
  lit. En définir de nouveaux ici créerait une seconde vérité métier.
- Il **ne devine pas**. Quand une question sort de son périmètre, il le dit
  (`confiance: "nulle"`) au lieu de produire une phrase plausible sans fondement.

---

## 2. Choix d'architecture : moteur déterministe, pas d'appel de modèle

Le moteur est **100 % déterministe** : règles et calculs en JavaScript, exécutés
dans le navigateur. Trois raisons, dans cet ordre :

| Raison | Conséquence concrète |
|---|---|
| **Vérifiabilité** | À données identiques, la sortie est identique. Un chiffre affiché peut être retracé jusqu'à la ligne de code qui le produit — ce qu'un modèle de langage ne permet pas. |
| **Sécurité** | FBMS est publié par GitHub Pages. Un appel direct à une API de modèle depuis la page exposerait une clé dans un fichier servi publiquement, ce que `SECURITE.md` interdit. |
| **Terrain** | Le pilote travaille en zone à connexion instable. Le moteur fonctionne hors ligne sur les données déjà chargées. |

### Et si l'on veut une rédaction par modèle de langage plus tard ?

L'architecture le permet sans refonte. Le moteur produit déjà des objets
structurés (`synthese()`, `alertes()`, `refinancement()`). Une couche de
rédaction n'aurait qu'à les recevoir en entrée.

Elle devrait passer par une **fonction Edge Supabase** — jamais depuis le
navigateur — pour que la clé d'API reste côté serveur. `supabase/**` étant une
zone interdite aux agents (§3 de `CLAUDE.md`), ce déploiement est un geste
humain. Le contrat d'entrée est simplement la valeur retournée par
`AFLP_IA.synthese(etat)`.

---

## 3. Fichiers

| Fichier | Rôle | Lignes |
|---|---|---|
| `shared/aflp-ia-moteur.js` | Calcul pur : agrégats, règle de refinancement, alertes, synthèse, questions. Aucun DOM, aucun réseau, aucune clé. | ~1375 |
| `shared/aflp-ia-ui.js` | Affichage : quatre onglets dans le Command Center. Ne calcule rien. | ~455 |
| `terrain/command.html` | Câblage : chargement des deux scripts, conteneur `#aflpIa`, appel après chargement des données. | +6 lignes |
| `.github/agent-tests/aflp-ia-assistant.mjs` | Contrôle de non-régression : câblage, règle AFLP cas par cas, alertes, synthèse, questions, déterminisme. | ~200 |

**Séparation stricte** : si un chiffre devait être recalculé dans l'interface,
ce serait une seconde vérité métier. Deux vérités qui divergent valent moins
qu'aucune.

---

## 4. La règle fondamentale : PAS DE RÉCONCILIATION = PAS DE REFINANCEMENT

Une équipe RT est refinançable **si et seulement si** les quatre conditions
sont réunies :

| # | Condition | Motif de blocage si absente |
|---|---|---|
| R1 | Une réconciliation existe pour ce RT | « Aucune réconciliation enregistrée » |
| R2 | Son statut est `Réconcilié` | « Réconciliation au statut « … » » |
| R3 | Elle est **postérieure ou égale** à la dernière avance reçue | « Réconciliation du JJ antérieure à l'avance du JJ » |
| R4 | Son écart est dans la tolérance (0 F par défaut) | « Écart de X F hors tolérance » |

S'y ajoute un cinquième motif, indépendant de la réconciliation :

| R5 | Le solde de caisse n'est pas négatif | « Dépassement de caisse : payé supérieur à l'avancé de X F » |

**R3 est le point qui distingue une vraie porte d'un affichage décoratif.** Une
équipe réconciliée le 5, qui reçoit une nouvelle avance le 9, n'est plus
couverte : l'argent en circulation n'a pas été justifié. Sans cette condition,
la règle AFLP serait contournable en réconciliant une fois en début de campagne.

### Montant débloquable

Somme des achats **portant un reçu** (`refinancable = true` et `numero_recu`
renseigné) des équipes GO. Un achat sans reçu n'entre dans **aucune** assiette,
ni débloquée ni bloquée : il est hors du refinancement par construction, comme
le prévoit le schéma de la table `achats`.

### Agrégation

- **Par cluster** : `GO` (aucun RT bloqué), `PARTIEL` (les deux), `NO-GO` (aucun RT réconcilié).
- **Global** : même logique sur l'ensemble des équipes évaluées.
- Une équipe sans avance **ni** achat n'est pas comptée — sinon le taux de
  blocage serait gonflé par des équipes inactives.

---

## 5. Codes d'alerte

Chaque code est stable dans le temps : il peut être cité dans un compte rendu
ou une consigne terrain. Une alerte dont le compteur vaut zéro n'est pas
produite.

| Code | Sévérité | Déclencheur |
|---|---|---|
| `AFLP-REFI-01` | critique | RT bloqués pour refinancement |
| `AFLP-REFI-02` | critique | Clusters entièrement bloqués (aucun RT réconcilié) |
| `AFLP-REFI-03` | critique | Avances ouvertes depuis plus de 2 jours |
| `AFLP-CASH-01` | critique | RT en dépassement de caisse |
| `AFLP-CASH-02` | majeure | Réconciliations saisies mais non validées |
| `AFLP-TRAC-01` | critique | Achats sans reçu (non refinançables) |
| `AFLP-QUAL-01` | majeure | Achats en contrôle qualité |
| `AFLP-QUAL-02` | majeure | Achats hors barème de prix |
| `AFLP-SAC-01` | critique | Soldes de sacs négatifs (RT, cluster, producteur) |
| `AFLP-PLAN-01` | majeure | Clusters sous la moitié de leur quote-part |
| `AFLP-PLAN-02` | majeure | Villages sans achat depuis plus de 7 jours |
| `AFLP-PLAN-03` | mineure | Villages sans équipe RT |
| `AFLP-PLAN-04` | mineure | Villages sans coordonnées GPS |
| `AFLP-SYNC-01` | critique | Échecs de synchronisation |
| `AFLP-SYNC-02` | majeure | Opérations locales en attente |

---

## 6. Sources de données

Aucune table nouvelle, aucune migration. L'assistant consomme ce que le Command
Center chargeait déjà — trois colonnes `date` ont dû être ajoutées aux requêtes
existantes, sans quoi la condition R3 ne pouvait pas être évaluée.

| Table | Colonnes utilisées | Ajout |
|---|---|---|
| `achats` | `date, poids_net, montant, commission_rt, cluster, rt_id, rt_nom, village_nom, refinancable, qualite_statut, statut_validation, numero_recu` | — |
| `avances` | `date, montant, rt_id, rt_nom, cluster` | **`date`** |
| `reconciliations` | `date, rt_id, rt_nom, cluster, statut, ecart, cash_restant, valeur_stock, created_at` | **`date`, `cluster`, `cash_restant`, `valeur_stock`** |
| `sacs_mouvements` | `date, type, source, destination, cluster, rt_id, rt_nom, producteur_id, producteur_nom, quantite` | **`date`** |
| `villages`, `rt`, `parametres_calcul` | inchangé | — |

Les clés de regroupement (`rt_id` sinon nom normalisé, cluster sans accents)
sont **identiques** à celles du Command Center. Toute autre convention ferait
diverger les deux écrans sur les mêmes données.

---

## 7. Répartition des zones — confirmée

Le cadrage initial donnait 2 zones et 6 clusters, mais **pas** la correspondance
entre les deux. Le moteur a d'abord appliqué une hypothèse de travail, signalée
par un bandeau dans l'interface.

> **Confirmée par le Branch Manager le 2026-08-14.** Le bandeau ne s'affiche
> plus, et les totaux par zone ne sont plus indicatifs mais fermes.

Répartition en vigueur :

| Zone | Clusters |
|---|---|
| GBEKE 1 | Djébonoua, Brobo, Diabo |
| GBEKE 2 | Sakassou, Béoumi, Botro |

Six assertions de `.github/agent-tests/aflp-ia-assistant.mjs` verrouillent ce
découpage. Le modifier par inadvertance fausserait tous les totaux par zone sans
qu'aucun autre contrôle ne s'en aperçoive.

### La modifier plus tard — deux voies, sans toucher au code

1. **Paramètre en base** (recommandé) — insérer dans `parametres_calcul` :
   ```
   cle    : aflp_zones
   valeur : {"GBEKE 1":["Djébonoua","Brobo","Diabo"],"GBEKE 2":["Sakassou","Béoumi","Botro"]}
   ```
2. **Depuis la page** — `AFLP_IA.referentiel({ zones: { … }, zonesConfirmees: true })`.

Si le découpage redevenait incertain, repasser `zonesConfirmees` à `false` dans
`REFERENTIEL_DEFAUT` fait réapparaître le bandeau d'avertissement de lui-même.

Le même mécanisme permet d'ajuster l'objectif (`objectifMT`), les cibles
villages / RT et les seuils d'alerte.

### Autre hypothèse signalée

La **quote-part par cluster** (500 MT = 3 000 / 6) est une référence de
pilotage à parts égales, faute de plan par cluster. Elle n'est pas
contractuelle. Dès qu'un plan réel existe, il remplacera ce calcul.

---

## 8. Vérifications réellement exécutées

Conformément à `CLAUDE.md` §5.2 — une page « vérifiée » est une page ouverte
dans un navigateur, à une largeur nommée, avec une observation citable.

### Portes du dépôt

| Contrôle | Résultat |
|---|---|
| `node .github/scripts/verifier-js.mjs` | 49 fichiers · 1 erreur héritée (`alis-hardening.js`) · **0 nouvelle** |
| `node .github/scripts/verifier-html.mjs` | 19 pages · 3 écarts historiques · **0 nouveau** |
| `node .github/scripts/verifier-liens.mjs` | 19 pages · 4 liens cassés hérités · **0 nouveau** |
| `node .github/agent-tests/aflp-ia-assistant.mjs` | **OK** — 48 assertions |
| `node .github/agent-tests/politique-chemins.mjs` | **35/35 cas conformes** (les nouveaux fichiers ne rompent pas la cohérence hook / intégration continue) |

Aucune ligne n'a été ajoutée à un référentiel (`*-baseline.json`).

### Navigateur — Chromium, trois largeurs

Le Command Center réel a été ouvert dans Chromium avec des données **fictives**
injectées à la place de Supabase (le script métier de la page n'a pas été
modifié pour l'essai). Observations :

| Largeur | Constat |
|---|---|
| 390 × 844 | Quatre onglets sur deux lignes, listes en colonne unique, tableau des clusters à défilement horizontal interne. Pas de débordement de page. |
| 768 × 1024 | Deux colonnes de blocs. Pas de débordement. |
| 1440 × 900 | Trois à quatre colonnes. Parcours complet effectué : Synthèse → Alertes → Refinancement → Question saisie et répondue. |

- **0 erreur console** et **0 exception** issues du code de l'assistant.
- Seule requête en échec : `fonts.googleapis.com`, dépendance externe
  préexistante de `shared/pjs-theme.css`, bloquée par l'absence de réseau dans
  l'environnement d'essai.
- **0 débordement horizontal** aux trois largeurs (`scrollWidth - innerWidth ≤ 2 px`).
- Hauteur tactile minimale mesurée sur les onglets et boutons : **44 px**,
  conforme au seuil de `agent-policy.yml`.

Aucune donnée réelle n'a été employée : ni nom de producteur, ni numéro de
téléphone, ni montant réel, ni coordonnée GPS de parcelle.

---

## 9. Note de gouvernance — pourquoi ce travail porte `[HUMAN-REVIEW]`

`.github/agent-policy/auto-merge-denylist.txt` couvre `shared/*.js`,
`terrain/**` et **tous** les `*.html` — c'est-à-dire l'intégralité des fichiers
que cette fonctionnalité devait toucher. Le garde-fou
`.claude/hooks/guard-paths.sh` a bloqué les premières écritures.

Le Branch Manager, propriétaire du dépôt, a **explicitement autorisé** ces
écritures après que le blocage lui a été présenté, en fournissant lui-même
l'intervention humaine que la denylist exige. Les commits portent le préfixe
`[HUMAN-REVIEW]`, comme le précédent `230c781`.

Cette pull request **ne doit pas être fusionnée automatiquement**. Trois points
méritent l'attention du relecteur :

1. ~~**La répartition GBEKE 1 / GBEKE 2** (§7) est une hypothèse.~~
   **Réglé le 2026-08-14** : confirmée par le Branch Manager, verrouillée par
   six assertions de non-régression.
2. **La tolérance d'écart de réconciliation est fixée à 0 F.** Si le terrain
   admet un écart de caisse résiduel, c'est un arbitrage du BM, pas du code.
3. **Le délai de réconciliation est fixé à 2 jours** (`AFLP-REFI-03`). À
   confirmer par rapport à la procédure AFLP réelle.

---

## 10. Limites connues

| Limite | Effet | Contournement |
|---|---|---|
| Les volumes du jour et de la semaine ne sont ventilés qu'au niveau global | Une question « combien a acheté Brobo cette semaine ? » renvoie le cumul campagne, **en le disant explicitement** | Ventiler par cluster dans une itération ultérieure |
| La compréhension des questions repose sur des mots-clés, pas sur un modèle de langage | Une formulation très indirecte peut ne pas être reconnue | L'assistant refuse explicitement plutôt que d'improviser ; sept questions types sont proposées en un clic |
| L'assistant reflète les données **synchronisées** | Des saisies terrain non remontées faussent la synthèse | Les alertes `AFLP-SYNC-01/02` signalent la file locale en tête de synthèse |
| Aucun historique n'est conservé | Pas de comparaison semaine N vs N-1 | Le téléchargement `.txt` quotidien permet de constituer une trace hors application |

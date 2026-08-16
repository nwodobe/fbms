# Banc d'essai — Command Center BM

## Pourquoi ce banc existe

Les portes du dépôt ouvrent réellement les pages, mais **sans session**. Sur
`terrain/command.html`, cela signifie que l'événement `anagroci:authenticated`
n'est jamais émis : `loadAll()` ne s'exécute pas, aucun tableau n'est rempli,
l'Assistant IA et les Prévisions ne sont jamais montés. Autrement dit, la
partie de la page qui compte pour un Branch Manager n'était couverte par
**aucune mesure**.

Ce banc comble ce trou. Il ne remplace pas `verifier-pages.mjs` : il le
complète sur l'état « connecté, données chargées ».

## Ce qu'il fait

Il sert le dépôt tel quel et ne substitue que **deux** ressources — même
principe que les doublures de `verifier-pages.mjs` :

| Ressource | Doublure |
|---|---|
| SDK Supabase (CDN) | client déterministe rendant un jeu de données **fictif** |
| `shared/auth-gate.js` | franchit la porte au niveau `bm` |

`terrain/command.html` et les modules `shared/aflp-ia-*.js` sont servis **sans
retouche** : ce qui est mesuré est bien le fichier du dépôt.

Il sert en plus la version d'**avant la refonte** sous `/__avant/command.html`,
ce qui permet de comparer la hauteur de page **à données strictement égales**.
Cette référence est **épinglée au commit `b22d723`**, et non à `HEAD` : `HEAD`
étant devenu la refonte, le contrôle se comparait à lui-même et basculait au
pixel près. `CC_REF_AVANT=<commit>` permet d'en viser une autre.

## Ce qu'il vérifie

Aux trois largeurs imposées par `CLAUDE.md` (390×844, 768×1024, 1440×900) :

- aucune erreur JavaScript, aucune ressource interne manquante ;
- aucun débordement horizontal de la page ;
- cibles tactiles ≥ 44 px sur les contrôles du cockpit ;
- navigation locale réellement collante sous la barre suite ;
- chaque pastille amène sa section sous les en-têtes collants, met l'ancre à
  jour et devient active ;
- une section repliée visée par la navigation s'ouvre ;
- la pastille active suit un défilement libre ;
- le raccourci « Alertes » ouvre l'Assistant IA sur le bon onglet ;
- les résumés d'en-tête viennent bien du moteur (`AFLP_IA_UI.resume()`,
  `AFLP_PRED_UI.resume()`) et non d'un calcul parallèle ;
- dévoilement progressif : RT à risque 3 → tout → 3, anomalies 5 → tout ;
- recherche, tri et état « aucun résultat » des tableaux ;
- « Zones et clusters » : badge de zone sur chaque ligne, recherche par cluster
  **et** par zone, compteur de résultats, tri, repli avec `aria-expanded`, et
  **conservation du focus pendant la frappe** — le module ne doit réécrire que
  le corps du tableau. Les événements y sont émis avec `bubbles: true` : le
  module écoute par délégation, un événement qui ne remonte pas ne serait
  jamais vu, et le contrôle passerait au vert sans rien avoir mesuré ;
- les 8 indicateurs du référentiel et les 8 onglets de Prévisions sont
  conservés ;
- états hors ligne, échec de chargement et squelettes ;
- le repli choisi est retrouvé à la visite suivante.

## Aucune donnée réelle

Le jeu de données est entièrement inventé : `VILLAGE TEST …`, `EQUIPE TEST …`,
`PRODUCTEUR TEST`. Seuls les noms de clusters sont ceux du référentiel
géographique public. Aucun montant, numéro ni coordonnée GPS réels.

## Utilisation

```bash
npm install --no-save playwright@1.49.1        # si nécessaire
node .github/agent-tests/command-center/verifier-command-center.mjs
```

Sortie : une ligne par contrôle, code de sortie 1 si l'un échoue.
`PORT_CC` permet de changer le port (4322 par défaut).

> **Attention** — `npm install --no-save playwright` **désinstalle**
> `@electric-sql/pglite`. Le banc SQL du Niveau 1 et celui-ci ne cohabitent pas
> dans le même `node_modules`.

# Assistant IA AFLP — compréhension du langage et apprentissage

**Rapport consolidé · 15 août 2026 · branche `aflp-ia-langue-apprentissage`**

Ce document est le point d'entrée. Il explique le défaut d'origine, ce qui a été
construit, ce qui a été réellement vérifié, et — surtout — **ce qui reste à faire
par un humain**. Les documents détaillés sont listés au §12.

---

## 1. Le diagnostic, et la cause exacte

### Ce qui se passait

Question posée au Command Center :

> Combien de RT avons-nous à Béoumi ?

Réponse obtenue :

> Je ne sais pas répondre à cette question à partir des données FBMS chargées.
> Je ne devine pas : reformulez avec un mot-clé métier…

avec `confiance: "nulle"`.

### La cause, à la ligne près

Le moteur portait onze intentions, écrites dans un tableau au milieu de
`shared/aflp-ia-moteur.js` :

```js
var INTENTIONS = [
  { code: "refinancement",  mots: ["refinancement", "refinancer", …] },
  …
  { code: "couverture",     mots: ["village", "villages", "equipe", "equipes",
                                   "couverture", "inactif", "sommeil"] },
  …
];
```

**Aucune de ces onze listes ne contenait le mot « rt ».** `detecterIntention`
additionnait la longueur des mots-clés trouvés dans la question ; pour
« combien de rt avons nous a beoumi », le total valait zéro, donc `code` restait
vide, et `repondre` partait sur la branche de refus.

Le plus révélateur : **la portée, elle, était correctement identifiée.**
`detecterPortee` reconnaissait « beoumi » comme cluster. Le moteur savait
*de quoi* on parlait, et ignorait *ce qu'on demandait*. C'est exactement le
symptôme d'un vocabulaire d'intentions trop pauvre — et non d'un problème de
données ou de calcul.

### Pourquoi ce défaut était structurellement difficile à voir

1. Le vocabulaire vivait **dans** le moteur de calcul. Ajouter un mot exigeait
   de toucher 1 400 lignes de JavaScript métier — donc personne ne le faisait.
2. Il n'existait **aucun corpus** : les seuls tests portaient sur quatre
   questions choisies parce qu'elles fonctionnaient.
3. Il n'existait **aucun journal** : une question incomprise ne laissait aucune
   trace. Le seul indicateur disponible était l'absence de plainte.

Les trois manques ci-dessus sont ce que ce lot corrige. Corriger uniquement la
reconnaissance de « RT » aurait résolu la question du jour et laissé le
mécanisme intact.

---

## 2. Ce qui a été construit

```
question (texte libre)
   │
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ COMPRENDRE          shared/aflp-ia-comprehension.js                  │
│ · normalisation → intention → entités → portée → période             │
│ · validation contre un SCHÉMA FERMÉ                                  │
│ · ne voit AUCUN chiffre : uniquement des noms de lieux et d'équipes  │
└──────────────────────────────────────────────────────────────────────┘
   │  contrat JSON  { intent, scope, period, filters, confidence, … }
   │
   ├── confiance suffisante ─────────────────────────────┐
   │                                                      │
   ├── confiance faible et couche linguistique ACTIVE ────┤
   │      shared/aflp-ia-langue.js → fonction Edge        │
   │      → contrat REVALIDÉ par le même schéma fermé     │
   │      → échec ⇒ repli sur le contrat déterministe     │
   │                                                      ▼
   ▼                                        ┌────────────────────────────┐
(désactivée au 15/08/2026)                  │ CALCULER                   │
                                            │ shared/aflp-ia-moteur.js   │
                                            │ registre FONCTIONS, clos   │
                                            │ 19 fonctions de LECTURE    │
                                            └────────────────────────────┘
                                                          │
                                                          ▼
                                            réponse + chiffres + sources + date
                                                          │
                                                          ▼
                                        ┌──────────────────────────────────┐
                                        │ JOURNALISER                      │
                                        │ shared/aflp-ia-journal.js        │
                                        │ file locale idempotente          │
                                        │ → aflp_ia_questions (Supabase)   │
                                        └──────────────────────────────────┘
```

### La règle qui structure tout

> Le langage peut être interprété par une couche intelligente, mais **les
> chiffres, les contrôles et les décisions** sont toujours produits par le moteur
> déterministe.

Elle n'est pas une consigne : elle est **une propriété du code**.

- La couche de compréhension ne reçoit jamais de montant. Vérifié par exécution
  (`aflp-ia-securite.mjs` §4 : on construit la charge réelle et l'on y cherche
  les montants de la fixture — aucun n'y figure).
- Le registre `FONCTIONS` est la **liste close** de ce qu'un contrat peut
  déclencher. Aucun nom n'évoque une mutation, et répondre aux 188 formulations
  du catalogue laisse l'état **strictement inchangé** — vérifié par comparaison
  d'empreinte avant/après.
- Un contrat désignant une intention inconnue est refusé **avant** tout calcul,
  qu'il vienne du moteur ou de l'extérieur.

### Fichiers livrés

| Fichier | Rôle | Lignes |
|---|---|---:|
| `shared/aflp-ia-catalogue.js` | 30 intentions, 188 formulations validées | ~1 010 |
| `shared/aflp-ia-comprehension.js` | Compréhension et contrat fermé | ~470 |
| `shared/aflp-ia-moteur.js` | Moteur déterministe (section 7 réécrite) | ~2 060 |
| `shared/aflp-ia-journal.js` | Journal hors ligne, caviardage, métriques | ~350 |
| `shared/aflp-ia-langue.js` | Client de la couche linguistique, désactivé | ~330 |
| `shared/aflp-ia-ui.js` | Interface : clarification, retours, provenance | ~560 |
| `terrain/aflp-ia-admin.html` | Administration réservée au niveau BM | ~560 |
| `docs/migrations/aflp_ia_journal_*.sql` | Migration, contrôle, retour arrière | ~750 |
| `docs/edge-functions/aflp-ia-langue/index.ts` | Fonction Edge **proposée** | ~300 |
| `.github/agent-tests/aflp-ia-*.mjs` | Cinq bancs de contrôle | ~1 000 |

---

## 3. La correction RT / Béoumi

Le comptage repose sur trois définitions **écrites une seule fois** :

| Terme | Définition retenue | Où |
|---|---|---|
| **Équipe RT enregistrée** | Ligne de la table `rt`, dédoublonnée par identifiant serveur (nom normalisé à défaut). | `construireEtat`, drapeau `enregistre` |
| **Équipe RT active** | Équipe ayant au moins un achat enregistré sur la campagne. | `nbAchats > 0` |
| **Équipe observée** | Identifiant apparaissant dans les achats **sans** figurer au référentiel. Signalée, jamais comptée. | `enregistre === false` |

Sans le drapeau `enregistre`, un achat imputé à un identifiant inconnu faisait
apparaître une équipe inexistante — et le comptage devenait faux sans prévenir.

**Réponse produite sur le jeu d'essai :**

> Le cluster de Béoumi compte 1 équipe RT enregistrée. Données FBMS arrêtées au
> 10 mars 2027. 1 équipe a enregistré au moins un achat sur la campagne.

Les dix formulations exigées sont couvertes, ainsi que les variantes sans accent,
en majuscules et avec faute de frappe sur le nom du lieu (« beoumy » → Béoumi,
avec confiance plafonnée à 0,84 et mention dans la trace).

### La distinction qui compte le plus

> Combien de **personnes** composent les RT de Béoumi ?

FBMS ne connaît pas la composition nominative des équipes. L'intention
`coverage_rt_members` est **comprise** et porte le statut `non_disponible` : la
réponse **nomme la donnée manquante** et ne glisse jamais le nombre d'équipes à
la place. Un test vérifie explicitement que « 1 équipe RT enregistrée »
n'apparaît pas dans ce refus.

C'est la forme d'erreur la plus coûteuse : un chiffre juste, à une question qui
n'a pas été posée. Rien dans la réponse ne l'aurait signalée.

---

## 4. Catalogue et formulations

**30 intentions**, dont 29 publiées et 1 explicitement indisponible.
**188 formulations validées**, soit 6,3 par intention en moyenne, jamais moins
de 5.

Le catalogue détaillé est dans
[`aflp_ia_catalogue_intentions_20260815.md`](aflp_ia_catalogue_intentions_20260815.md).

Deux propriétés vérifiées à chaque exécution du corpus :

- **188/188** formulations routent vers leur intention ;
- **120/120** variantes mécaniques (sans accent, majuscules, sans ponctuation,
  faute de frappe) routent également.

> Un corpus écrit par celui qui écrit le moteur est un corpus complaisant. Ces
> 188 formulations disent que le mécanisme fonctionne, pas que le vocabulaire du
> terrain est couvert. Les formulations réelles arriveront par le journal et
> l'interface d'administration : c'est à ce moment que ce corpus deviendra
> probant. Voir §9, angle mort A-01.

---

## 5. Journal, retours et métriques

### Ce qui est enregistré

Une ligne par question dans `aflp_ia_questions` : question caviardée, intention,
portée, période, confiance, statut du résultat, résumé borné de la réponse,
versions du moteur et du catalogue, latence, date de référence des données,
et si la couche linguistique a été sollicitée.

### Ce qui ne l'est jamais

Aucun détail d'achat, d'avance ou de réconciliation. Aucun nom de producteur.
Le caviardage retire **avant l'envoi** les adresses électroniques, les numéros de
téléphone et les suites de six chiffres ou plus. « 7 jours », « GBEKE 1 » et
« 3000 MT » survivent : ils portent du sens et aucun risque.

### Le mode hors ligne, qui commande la conception

Le terrain travaille sans réseau. La `cle_idempotence` est générée **au moment de
la question**, pas à l'envoi, et l'entrée locale n'est effacée **qu'après accusé
de réception**. L'ordre inverse perd des questions à la première coupure au
mauvais moment — ou les compte deux fois. Les deux faussent la mesure.

Tant que la migration n'est pas appliquée, le premier envoi échoue avec un code
PostgREST de table inconnue et le journal **se met en veille pour la session**.
L'assistant continue de répondre. Le frontend peut donc partir seul.

### Les définitions de mesure

```
Taux de compréhension = questions comprises correctement / questions métier évaluables
Taux de couverture    = questions ayant obtenu une réponse fondée / questions métier évaluables
Exactitude intentions = intentions correctement détectées / questions revues par un humain
Exactitude entités    = portées correctement détectées / questions revues par un humain
Exactitude réponses   = réponses validées correctes / réponses revues par un humain
```

**L'exactitude n'est pas déductible du journal.** Elle exige une revue humaine.
Le tableau de bord affiche « à établir » tant qu'aucune question n'a été revue,
et le libellé des boutons de retour est « Réponse utile » / « À revoir » — jamais
« juste » / « faux ». Un utilisateur ne peut pas certifier un chiffre qu'il n'a
pas recalculé ; laisser croire le contraire fabriquerait une mesure fausse.

Détail dans [`aflp_ia_metriques_20260815.md`](aflp_ia_metriques_20260815.md).

---

## 6. Sécurité

| Exigence | Comment elle est tenue | Vérifiée par |
|---|---|---|
| RLS sur chaque table exposée | 6 tables, `enable row level security` | PGlite, exécuté |
| Aucune lecture publique | `anon` : aucune politique, tous droits révoqués | PGlite : 3 refus constatés |
| Lecture limitée par rôle | Chacun ses questions ; supervision : tout | PGlite : 1 ligne vs 2 |
| Correction réservée | `peut_editer_config()` | PGlite : agent refusé |
| Publication réservée | `est_bm()` | PGlite : superviseur → 0 ligne |
| Modification auditée | Déclencheur → `aflp_ia_audit`, append-only | PGlite : 3 lignes |
| Jamais `user_metadata` | Autorisation via `profils` uniquement | Lecture du SQL |
| Aucune clé `service_role` au navigateur | 7 motifs de secret recherchés | `aflp-ia-securite.mjs` |
| Politiques UPDATE avec `USING` **et** `WITH CHECK` | Les 5 politiques UPDATE | Lecture du SQL |
| Vue en `security_invoker` | `aflp_ia_metriques` | PGlite : agent voit 1, chef voit 2 |
| `SECURITY DEFINER` évité | Un seul, encadré (§ ci-dessous) | Lecture + PGlite |

### Le défaut trouvé par exécution, et pas par relecture

La première version du déclencheur d'audit était une fonction plpgsql ordinaire.
Elle échouait :

```
new row violates row-level security policy for table "aflp_ia_audit"
```

Une fonction de déclencheur s'exécute avec les droits de **l'utilisateur** qui a
déclenché l'écriture, pas du propriétaire de la fonction. Comme `aflp_ia_audit`
n'ouvre aucune politique INSERT — et ne doit surtout pas en ouvrir, sinon
n'importe qui fabriquerait des lignes d'audit — toute modification du catalogue
devenait impossible.

**Ce défaut n'était pas visible à la lecture du script.** Il a fallu appliquer la
migration puis tenter réellement l'insertion. Correction : la fonction devient
`SECURITY DEFINER`, dans le schéma **non exposé** `aflp_ia_interne`, avec
`search_path` figé et `EXECUTE` révoqué à `PUBLIC`, `anon` et `authenticated`.
Les quatre précautions demandées sont donc appliquées, et la justification est
écrite dans le SQL lui-même.

### Le piège des politiques qui « passent » sans rien prouver

PostgreSQL **ne lève pas d'erreur** quand une politique RLS masque les lignes
visées par un `UPDATE` : il n'en modifie simplement aucune. Quatre contrôles du
banc affichaient « conforme » alors qu'ils testaient une exception qui ne
survenait jamais. Ils vérifient désormais que **zéro ligne** a été modifiée.
Sans cette correction, quatre propriétés de sécurité auraient été déclarées
tenues sans l'être.

Détail dans
[`aflp_ia_schema_supabase_rls_20260815.md`](aflp_ia_schema_supabase_rls_20260815.md).

---

## 7. Couche linguistique — statut réel

**AUCUN fournisseur linguistique n'est configuré sur le projet Supabase de FBMS.**

Aucune clé n'a été créée, aucune n'a été demandée, aucune n'a été inventée.
Conformément à la consigne, ce lot livre donc :

- le **client** `shared/aflp-ia-langue.js`, complet et testé, **désactivé** ;
- la **fonction Edge proposée**, dans `docs/edge-functions/aflp-ia-langue/`,
  **non déployée** ;
- le drapeau `aflp_ia_langue_active` à `false`, et un interrupteur d'arrêt
  serveur qui l'emporte sur toute activation cliente.

Le tout est **inerte** : tant que `activee()` retourne faux, aucun appel réseau
n'est émis. Le banc de sécurité le vérifie.

### Ce qui est déjà en place, prêt à servir

Timeout, limitation de débit (client et serveur), plafond par session,
kill switch, feature flag, repli déterministe systématique, journalisation des
tokens, validation stricte du contrat **trois fois** par des codes indépendants
(serveur, client, moteur), refus d'un lieu inventé, refus d'une clarification
contenant un chiffre.

### Ce qu'il reste à faire — action humaine

Voir §11. Aucune de ces étapes ne peut être faite par un agent.

---

## 8. Ce qui a été réellement exécuté

| Contrôle | Commande | Résultat |
|---|---|---|
| Moteur, RT/Béoumi, contrat | `node .github/agent-tests/aflp-ia-assistant.mjs` | **RÉUSSI** |
| Corpus de compréhension | `node .github/agent-tests/aflp-ia-corpus.mjs` | **188/188 · 120/120** |
| Sécurité | `node .github/agent-tests/aflp-ia-securite.mjs` | **RÉUSSI** |
| Migration + RLS sur PostgreSQL | `node .github/agent-tests/aflp-ia-journal-rls.mjs` | **43/43** |
| Structure HTML | `node .github/scripts/verifier-html.mjs` | **0 nouvel écart** |
| Liens internes | `node .github/scripts/verifier-liens.mjs` | **0 nouveau lien cassé** |
| Syntaxe JavaScript | `node .github/scripts/verifier-js.mjs` | **0 nouvelle erreur** |

Tout lancer d'un coup :

```bash
node .github/agent-tests/aflp-ia-executer.mjs
```

### Ce qui n'a PAS été exécuté, et pourquoi

| Contrôle | Pourquoi |
|---|---|
| `verifier-pages.mjs` (Playwright, 3 largeurs) | Voir §10 — état à la date du rapport |
| Migration sur le projet Supabase | `modifying-a-hosted-supabase-project` est interdit (`agent-policy.yml`) |
| Advisors Supabase | Ne s'exécutent que sur une base où la migration est appliquée |
| Smoke production | Nécessite la fusion sur `main` (pousser sur `main` est interdit) |
| Test sur téléphone réel | Aucun appareil accessible depuis cet environnement |

---

## 9. Angles morts et risques résiduels

| Réf | Angle mort | Gravité | Conséquence si ignoré |
|---|---|---|---|
| A-01 | Le corpus est écrit par l'auteur du moteur, pas par le terrain | **P1** | Le taux de 188/188 mesure la cohérence interne, pas la couverture réelle du vocabulaire des utilisateurs |
| A-02 | Les bancs ne sont pas dans l'intégration continue | **P1** | Une régression peut être fusionnée sans qu'aucune porte ne rougisse. `.github/workflows/**` est interdit aux agents ; une ligne humaine suffit (§11) |
| A-03 | La migration n'est appliquée nulle part | **P0 pour l'apprentissage** | Sans elle : aucun journal, aucune métrique, aucune administration. L'assistant répond, mais n'apprend pas |
| A-04 | Le dénominateur « questions métier évaluables » est approximé par le total | **P1** | Les questions hors périmètre font baisser le taux de compréhension sans qu'il y ait rien à corriger. Se corrige dès que la revue humaine tranche (`feedback_type = hors_perimetre`) |
| A-05 | Aucune mesure d'exactitude | **P1** | Elle est structurellement impossible avant la première revue humaine. Le tableau l'affiche « à établir » plutôt que d'inventer un chiffre |
| A-06 | La limitation de débit Edge vit en mémoire d'instance | **P2** | Une instance recyclée remet le compteur à zéro. Ce n'est pas un quota comptable, et c'est écrit dans le code |
| A-07 | Le rattrapage approché des noms de lieux peut se tromper | **P2** | « beoumy » → Béoumi est souhaitable ; deux clusters aux noms proches ne le seraient pas. Aucun couple de ce type dans les six clusters AFLP actuels |
| A-08 | Les seuils de confiance (0,55 · 0,62 · 0,80) sont posés a priori | **P2** | Ils n'ont pas été calibrés sur des données réelles — il n'y en a pas encore. À réviser après 200 questions journalisées |
| A-09 | PGlite tourne en PostgreSQL 18, la production en 17.6 | **P2** | Aucune fonctionnalité employée n'est postérieure à PostgreSQL 15 |
| A-10 | Le banc ne couvre pas PostgREST | **P2** | Un droit peut se comporter différemment via l'API REST. Le contrôle `verify` livré doit être exécuté sur la vraie base |
| A-11 | Aucun test sur téléphone réel | **P1** | La cible est un usage mobile. Les largeurs 390/768/1440 ne sont vérifiées qu'à travers `verifier-pages.mjs` |

---

## 10. État des contrôles Playwright

`node .github/scripts/verifier-pages.mjs` ouvre réellement chaque page dans
Chromium, aux trois largeurs imposées, et relève erreurs de console et
violations d'accessibilité. Il exige `playwright@1.49.1` et le téléchargement
d'un navigateur.

**Statut à la date de ce rapport : voir le §« Journal d'exécution » ci-dessous.**
Si l'installation n'a pas abouti dans cet environnement, la page
`terrain/aflp-ia-admin.html` n'a **pas** été ouverte dans un navigateur, et
aucune affirmation n'est faite sur son rendu réel. C'est un angle mort assumé,
pas un contrôle réussi.

---

## 11. Ce qui reste à faire par un humain

Dans cet ordre. Aucune étape n'est facultative, aucune n'est faisable par un
agent sous la politique en vigueur.

### 11.1 — Appliquer la migration (débloque A-03)

1. Supabase → **SQL Editor** → coller **tout**
   `docs/migrations/aflp_ia_journal_20260815.sql` → **Run**.
2. Coller **tout** `docs/migrations/aflp_ia_journal_verify_20260815.sql`.
   **Chaque bloc doit renvoyer `CONFORME`.** Tout autre verdict se traite avant
   d'ouvrir l'écran d'administration.
3. Lancer les **advisors** Supabase (Security + Performance) et comparer aux
   alertes préexistantes. Aucune nouvelle alerte critique n'est acceptable.
4. Vérifier que **`aflp_ia_interne` n'est PAS** dans
   *Settings → API → Exposed schemas* (seuls `public` et `graphql_public`).

En cas de problème : `docs/migrations/aflp_ia_journal_rollback_20260815.sql`.
Lire son en-tête d'abord — **le retour arrière normal n'exige aucun SQL**.

### 11.2 — Brancher les bancs dans l'intégration continue (débloque A-02)

Une ligne à ajouter dans `.github/workflows/agent-quality-gates.yml`, dans le
job `statique`, après « Cohérence de la politique de chemins » :

```yaml
      - name: Assistant IA AFLP — moteur, corpus, sécurité, RLS
        run: |
          npm install --no-save @electric-sql/pglite@0.5.5
          node .github/agent-tests/aflp-ia-executer.mjs
```

`.github/workflows/**` est interdit aux agents : cette ligne doit être écrite
par un humain, et c'est volontaire.

### 11.3 — Activer la couche linguistique (facultatif, Release 2)

**Ne rien activer tant que 11.1 n'est pas fait.**

```bash
# 1. Copier la fonction proposée dans la zone Supabase
cp -r docs/edge-functions/aflp-ia-langue supabase/functions/

# 2. Poser les secrets — JAMAIS dans un fichier commis
supabase secrets set AFLP_IA_LANGUE_CLE=…
supabase secrets set AFLP_IA_LANGUE_MODELE=…
supabase secrets set AFLP_IA_LANGUE_URL=…

# 3. Déployer
supabase functions deploy aflp-ia-langue

# 4. Vérifier que la fonction refuse un appel non authentifié (attendu : 401)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$SUPABASE_URL/functions/v1/aflp-ia-langue" -d '{}'
```

Puis, dans `parametres_calcul` :

```sql
insert into public.parametres_calcul (cle, valeur)
values ('aflp_ia_langue_active','true')
on conflict (cle) do update set valeur = excluded.valeur;
```

**Conditions d'activation, toutes obligatoires :**

- les secrets serveur existent et **aucun** n'est présent dans le frontend ;
- `node .github/agent-tests/aflp-ia-securite.mjs` passe ;
- la sortie du modèle respecte le schéma sur au moins 20 questions réelles ;
- le moteur déterministe reste responsable de tout chiffre ;
- le kill switch a été testé :
  `supabase secrets set AFLP_IA_LANGUE_KILL=true` → la fonction répond 503 et
  le client retombe sur le déterministe ;
- la latence et le taux d'erreur sont jugés acceptables par le Branch Manager.

Coupure immédiate si besoin, dans l'ordre de rapidité :

1. `update parametres_calcul set valeur='true' where cle='aflp_ia_langue_kill';`
2. `supabase secrets set AFLP_IA_LANGUE_KILL=true`
3. `AFLP_IA_LANGUE.couper()` depuis la console d'un poste

Dans les trois cas, **l'assistant continue de répondre** : le repli déterministe
n'est pas une dégradation, c'est le comportement nominal d'aujourd'hui.

### 11.4 — Contrôles de production après fusion

Voir
[`aflp_ia_deploiement_rollback_20260815.md`](aflp_ia_deploiement_rollback_20260815.md).

---

## 12. Documents détaillés

| Document | Contenu |
|---|---|
| [`aflp_ia_catalogue_intentions_20260815.md`](aflp_ia_catalogue_intentions_20260815.md) | Les 30 intentions, le dictionnaire des formulations, la politique d'ajout |
| [`aflp_ia_contrat_comprehension_20260815.md`](aflp_ia_contrat_comprehension_20260815.md) | Le contrat JSON, le schéma fermé, la politique de clarification |
| [`aflp_ia_metriques_20260815.md`](aflp_ia_metriques_20260815.md) | Définitions des mesures, ce qu'elles ne mesurent pas |
| [`aflp_ia_schema_supabase_rls_20260815.md`](aflp_ia_schema_supabase_rls_20260815.md) | Schéma, politiques RLS, confidentialité, rétention |
| [`aflp_ia_manuel_administration_20260815.md`](aflp_ia_manuel_administration_20260815.md) | Manuel de l'écran d'administration, politique de publication |
| [`aflp_ia_deploiement_rollback_20260815.md`](aflp_ia_deploiement_rollback_20260815.md) | Plan de tests, déploiement, retour arrière, contrôles de production |
| [`aflp_ia_autoevaluation_20260815.md`](aflp_ia_autoevaluation_20260815.md) | Auto-évaluation notée, preuves, angles morts |

Documents antérieurs toujours valables :
[`aflp_ia_assistant_niveau2_20260814.md`](aflp_ia_assistant_niveau2_20260814.md) (moteur, refinancement),
[`aflp_ia_predictif_niveau3_20260814.md`](aflp_ia_predictif_niveau3_20260814.md) (couche prédictive, mode ombre).

---

## 13. Cinq questions à poser en production

À poser dans **Command Center BM → Assistant IA AFLP → Poser une question**,
une fois connecté avec un compte de niveau BM.

1. **`Combien de RT avons-nous à Béoumi ?`**
   Attendu : une phrase nommant Béoumi, un nombre d'équipes **enregistrées**, et
   la date d'arrêté des données. Si la réponse est « je ne sais pas répondre »,
   le lot n'est pas en ligne.
2. **`Combien de personnes composent les RT de Béoumi ?`**
   Attendu : un refus qui **nomme** la donnée manquante. Si un nombre apparaît,
   c'est un défaut grave — le signaler immédiatement.
3. **`Quels RT sont bloqués pour refinancement ?`**
   Attendu : la règle « pas de réconciliation = pas de refinancement » rappelée,
   puis le décompte et les motifs équipe par équipe.
4. **`Quel est le solde de caisse de GBEKE 1 ?`**
   Attendu : avances, payé, solde, et — si le solde est négatif — la phrase qui
   dit que ce n'est pas un excédent mais une saisie manquante.
5. **`Combien avons-nous acheté ?`**
   Attendu : **une question en retour**, pas un chiffre. C'est le comportement
   voulu : sans périmètre précisé, l'assistant demande plutôt que de supposer.

---

## 14. Journal d'exécution

Cette section est mise à jour à chaque étape réellement franchie. Ce qui n'y
figure pas n'a pas été fait.

| Date | Étape | Résultat |
|---|---|---|
| 2026-08-15 | Bancs `aflp-ia-*` (4 fichiers) | Tous verts |
| 2026-08-15 | Portes `verifier-html` / `-liens` / `-js` | 0 nouvel écart |
| 2026-08-15 | Migration exécutée sur PostgreSQL (PGlite) | 43/43 |
| 2026-08-15 | Migration appliquée sur Supabase | **NON** — interdit à un agent |
| 2026-08-15 | Couche linguistique | **Livrée désactivée**, aucun fournisseur configuré |

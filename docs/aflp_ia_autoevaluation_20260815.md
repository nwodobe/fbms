# Assistant IA AFLP — auto-évaluation

**15 août 2026 · deux cycles**

Règle appliquée à toute cette page : **aucun point n'est accordé pour une
intention non testée, une interface non sécurisée, une migration non vérifiée,
un test non exécuté, une fonctionnalité simulée, une couche linguistique sans
validation stricte, ou un déploiement non vérifié.**

---

## Cycle 1 — première notation

| Domaine | Max | Note |
|---|---:|---:|
| Correction RT/Béoumi et tests | 1,00 | **1,00** |
| Catalogue des intentions | 1,25 | **1,20** |
| Formulations et corpus de régression | 1,00 | **0,85** |
| Journalisation et feedback | 1,00 | **0,85** |
| Administration et versionnement | 1,25 | **1,05** |
| Métriques de compréhension et d'exactitude | 1,00 | **0,75** |
| Couche linguistique sécurisée | 1,25 | **1,00** |
| Maintien du moteur déterministe | 1,00 | **1,00** |
| Sécurité, tests, documentation et déploiement | 1,25 | **0,95** |
| **Total** | **10,00** | **8,65** |

### Angles morts identifiés au cycle 1, classés

| Réf | Angle mort | Classe | Traitable par un agent |
|---|---|---|---|
| A-03 | Migration appliquée nulle part → aucune mesure réelle | **P0** | **Non** — `modifying-a-hosted-supabase-project` interdit |
| A-12 | Le mode hors ligne n'était couvert par aucun test exécuté | **P0** | **Oui** |
| A-13 | Le lanceur comptait « réussi » un banc qui s'ignore faute de dépendance | **P0** | **Oui** |
| A-14 | La page d'administration ajoutait 4 requêtes 404 en production | **P0** | **Oui** |
| A-04 | Dénominateur des taux approximé par le total des questions | **P1** | **Oui, partiellement** |
| A-01 | Corpus écrit par l'auteur du moteur | **P1** | Non — exige le terrain |
| A-02 | Bancs hors intégration continue | **P1** | **Non** — `.github/workflows/**` interdit |
| A-05 | Aucune mesure d'exactitude | **P1** | Non — exige une revue humaine |
| A-11 | Aucun test sur téléphone réel | **P1** | Non — aucun appareil accessible |
| A-06 | Débit Edge en mémoire d'instance | P2 | Sans objet tant que non déployée |
| A-07 | Rattrapage approché des noms de lieux | P2 | — |
| A-08 | Seuils de confiance posés a priori | P2 | Non — exige des données réelles |
| A-09 | PGlite en PostgreSQL 18, production en 17.6 | P2 | — |
| A-10 | PostgREST non couvert | P2 | Non |

---

## Cycle 2 — corrections apportées

### A-12 · Mode hors ligne non testé — **fermé**

Le journal implémentait la file locale, la clé d'idempotence et l'effacement
après accusé de réception. **Rien ne le vérifiait.** Une inversion de deux
lignes aurait perdu des questions sans qu'aucun contrôle ne rougisse.

Ajouté : section 6 de `.github/agent-tests/aflp-ia-assistant.mjs`, avec
`localStorage` et `navigator` simulés. Elle vérifie qu'une question posée hors
ligne est mise en file, qu'un **échec d'envoi ne vide pas la file**, que la file
se vide **après** accusé de réception, qu'aucune clé n'est dupliquée, qu'une
table absente met le journal en veille sans erreur, et que l'interrupteur
d'arrêt fonctionne.

**Un défaut réel a été trouvé en l'écrivant.** Les fichiers de `shared/` sont des
UMD dont l'objet global vaut `window` s'il existe, `this` sinon — c'est-à-dire
`module.exports` sous Node. Sans `globalThis.window = globalThis`, le journal
cherchait `localStorage` sur ses propres exports : la file était inopérante dans
le banc, et **le contrôle serait passé au vert sans rien mesurer.**

### A-13 · Le lanceur maquillait un banc ignoré en succès — **fermé**

`npm install --no-save playwright@1.49.1` **désinstalle** `@electric-sql/pglite`.
Le banc RLS s'est alors mis en mode « IGNORÉ », est sorti en code 0, et le
lanceur a affiché **RÉUSSI** pour une migration que plus rien ne vérifiait.

C'est exactement le mensonge commode que le README du dossier interdit :
transformer « je n'ai pas pu vérifier » en « j'ai vérifié, tout va bien ».

Corrigé : le lanceur détecte la sortie `IGNORÉ`, l'affiche comme telle et
**sort en échec**, avec la commande de réinstallation. PGlite réinstallé, le banc
repasse à 43/43.

### A-14 · La page d'administration ajoutait quatre 404 — **fermé**

`node .github/scripts/verifier-pages.mjs` a signalé deux nouveaux problèmes sur
`terrain/aflp-ia-admin.html`. Diagnostic par extraction du JSON d'observations :

```
HTTP 404 http://127.0.0.1:4319/terrain/anagroci-ui.css
HTTP 404 http://127.0.0.1:4319/terrain/alis-premium.css
```

Les quatre `@import` locaux de `shared/pjs-theme.css` sont résolus
**relativement au document** et non à la feuille. Depuis `terrain/`, ils
cherchent `terrain/anagroci-ui.css`, inexistant. C'est le défaut déjà consigné
dans CLAUDE.md §6, qui frappe **toutes** les pages de `terrain/`, `fbms/` et
`logistique/` — quatre 404 chacune.

Corriger la cause exige de toucher toutes les pages du site : pull request
dédiée, pas effet de bord de ce lot. La page d'administration ne charge donc pas
`pjs-theme.css` — elle redéclare la palette PJS et les mêmes familles de police.
Elle **n'ajoute aucune 404** au lieu d'en ajouter quatre.

**Le référentiel n'a pas été élargi.** Y ajouter une ligne pour faire passer la
porte aurait été le contournement que CLAUDE.md §4 nomme explicitement.

Résultat : `19 page(s) × 3 viewport(s) · 20 problème(s) hérité(s) · 0 nouveau(x)`.

### A-04 · Dénominateur des taux — **partiellement fermé**

Le tableau de bord soustrayait `0` question hors périmètre : le code portait un
`Math.max(0, n - 0)` qui documentait l'intention sans la réaliser.

Corrigé : l'écran croise le journal avec `aflp_ia_feedback` et exclut réellement
les questions marquées `hors_perimetre`. Il affiche en outre le nombre de
questions **triées**, pour qu'on sache ce que le taux vaut.

Reste ouvert : tant que la revue n'a pas eu lieu, le taux est **sous-estimé** —
et l'écran le dit, plutôt que de le masquer.

### Défauts trouvés au cycle 1 par exécution, déjà corrigés avant notation

| Défaut | Comment il est apparu |
|---|---|
| Le déclencheur d'audit ne pouvait pas écrire dans sa table (RLS) | Migration exécutée sur PostgreSQL, puis insertion réellement tentée. **Invisible à la lecture** |
| Quatre contrôles RLS attendaient une exception qui ne survient jamais | PostgreSQL ne lève pas d'erreur quand une politique masque les lignes d'un UPDATE : il n'en modifie aucune. Quatre propriétés de sécurité auraient été déclarées tenues sans l'être |
| « Quelle équipes RT travaillent à Béoumi ? » partait vers l'intention « actives » | Corpus, variante mécanique avec faute de frappe |
| « Quel montan peut-on refinancer ? » échappait à son exclusion | Corpus. **Une faute de frappe désactivait le garde-fou tout en gardant le rapprochement** |

---

## Cycle 2 — notation finale

| Domaine | Max | Note | Preuves | Angles morts résiduels |
|---|---:|---:|---|---|
| **Correction RT/Béoumi et tests** | 1,00 | **1,00** | `aflp-ia-assistant.mjs` §3 : intention, portée `cluster`/`BEOUMI`, chiffre, nom du cluster, date en source, confiance ≥ 0,80, phrase exacte attendue. 10 formulations exigées + 7 variantes + faute sur le lieu. Refus explicite sur la composition des équipes, avec vérification qu'aucun nombre d'équipes n'y glisse | Aucun |
| **Catalogue des intentions** | 1,25 | **1,20** | 30 intentions, 15 champs chacune, `verifier()` exécuté à chaque banc, versionné `1.0.0`, statut `non_disponible` de première classe. Toute intention publiée désigne une fonction existante du registre — vérifié | Les tables `aflp_ia_intentions` ne sont pas peuplées : seule la version 1.0.0 est amorcée (A-03) |
| **Formulations et corpus** | 1,00 | **0,90** | 188 formulations, 6,3/intention, minimum 5. `aflp-ia-corpus.mjs` : 188/188 routées, 120/120 variantes mécaniques, 6 questions hors périmètre refusées, ambiguïté détectée, déterminisme vérifié | A-01 : corpus écrit par l'auteur du moteur. Mesure la cohérence interne, pas la couverture du vocabulaire réel |
| **Journalisation et feedback** | 1,00 | **0,95** | Migration exécutée sur PostgreSQL : idempotence, écriture unique (auteur **et** propriétaire), cloisonnement par rôle, workflow de validation. File locale testée : accumulation hors ligne, non-effacement sur échec, effacement après accusé, mise en veille sur table absente, interrupteur d'arrêt. Caviardage testé | A-03 : zéro question réellement journalisée en production |
| **Administration et versionnement** | 1,25 | **1,05** | Toutes les fonctions demandées. Workflow imposé par la BASE et non par l'écran : catalogue publié figé par déclencheur, publication réservée à `est_bm()`, audit append-only — les trois vérifiés par exécution. Contrôle de reconnaissance obligatoire avant publication | L'écran n'a jamais été exercé contre une base réelle (A-03). Aucune capture, aucune donnée |
| **Métriques** | 1,00 | **0,85** | Cinq définitions écrites. Vue `security_invoker` vérifiée par différence de visibilité entre deux rôles. Exclusion réelle des questions hors périmètre. « Exactitude : à établir » tant qu'aucune revue n'a eu lieu | A-05 : aucune mesure réelle. A-04 : taux sous-estimé tant que la revue n'a pas avancé |
| **Couche linguistique sécurisée** | 1,25 | **1,05** | Désactivée par défaut, vérifié. Kill switch vérifié. Validation stricte **trois fois** par des codes indépendants. **Preuve par exécution** qu'aucun chiffre métier n'est dans la charge. Refus d'un lieu inventé, d'une clarification chiffrée, d'une clé en trop. Timeout, débit, plafond, repli, coût | Jamais exercée contre un vrai fournisseur : aucun n'est configuré. Une interface complète et non déployée n'est pas une couche en service |
| **Maintien du moteur déterministe** | 1,00 | **1,00** | Registre `FONCTIONS` clos, 19 fonctions de lecture. **Preuve par exécution** : répondre aux 188 formulations laisse l'état inchangé (empreinte JSON). Aucun verbe d'écriture PostgREST dans le moteur, la compréhension, le catalogue et le client linguistique. Un contrat identique produit la **même réponse mot pour mot**, quel que soit le chemin. Aucun réseau, aucun DOM | Aucun |
| **Sécurité, tests, doc, déploiement** | 1,25 | **1,05** | 4 bancs verts, 4 portes du dépôt vertes dont Chromium aux 3 largeurs (0 nouveau). 8 documents. 43/43 sur PostgreSQL. Aucun secret. Un seul `SECURITY DEFINER`, encadré selon les 4 précautions | A-02 : bancs hors CI (`.github/workflows/**` interdit). A-03 : migration non appliquée. A-11 : aucun test sur téléphone réel |
| **Total** | **10,00** | **9,05** | | |

---

## Ce que la note ne dit pas

**9,05 ne signifie pas « prêt et en service ».** Elle signifie : *le lot livré est
correct, testé et sûr, dans la limite de ce qu'un agent peut faire sous la
politique de ce dépôt.*

Trois choses manquent, et aucune n'est un défaut de ce lot :

1. **La migration n'est appliquée nulle part.** Tant qu'elle ne l'est pas, il n'y
   a ni journal, ni métrique, ni administration. L'assistant répond mieux — il
   n'apprend pas encore. C'est **A-03, un P0 qu'un agent ne peut pas fermer** :
   `modifying-a-hosted-supabase-project` figure parmi les actions interdites
   d'`agent-policy.yml`.
2. **Les bancs ne sont pas dans l'intégration continue.** Une régression peut
   être fusionnée sans qu'aucune porte ne rougisse. Une ligne humaine dans
   `.github/workflows/agent-quality-gates.yml` suffit ; elle est écrite mot pour
   mot dans le rapport consolidé §11.2.
3. **La couche linguistique n'a jamais parlé à un fournisseur.** Aucun n'est
   configuré, aucune clé n'a été créée, aucune n'a été inventée. Ce qui est livré
   est une interface complète et vérifiée, désactivée.

Le point 1 est le seul qui bloque la boucle d'apprentissage. Les points 2 et 3
sont des choix, pas des manques.

## Pourquoi 9,05 et pas davantage

Les 0,95 point manquants sont répartis sur cinq domaines, et chacun correspond à
une chose qui **n'a pas été exercée en conditions réelles** : un corpus qui n'a
pas rencontré le terrain, un écran qui n'a pas rencontré de données, une couche
linguistique qui n'a rencontré aucun fournisseur, une migration qui n'a rencontré
aucune base de production, et un mobile qui n'a rencontré aucun téléphone.

Se les accorder reviendrait à noter l'intention plutôt que le résultat.

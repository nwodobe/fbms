# Assistant IA AFLP — plan de tests, déploiement et retour arrière

**15 août 2026 · branche `aflp-ia-langue-apprentissage`**

---

## 1. Deux releases, et ce qui les sépare

| | Release 1 | Release 2 |
|---|---|---|
| Contenu | Correctif RT/Béoumi, catalogue, formulations, journalisation, retours, administration, métriques, moteur amélioré | Couche linguistique serveur |
| Dépend d'un fournisseur d'IA | **Non** | Oui |
| État au 15/08/2026 | **Livrée sur branche, en attente de fusion** | **Livrée désactivée**, non déployée |

**Release 1 fonctionne sans aucun fournisseur linguistique.** C'est une
contrainte de conception, pas une étape transitoire : le moteur déterministe
reste le seul producteur de chiffres, avec ou sans Release 2.

---

## 2. Plan de tests

### 2.1 Ce qui a été exécuté

| Banc | Commande | Couvre | Résultat |
|---|---|---|---|
| Moteur | `node .github/agent-tests/aflp-ia-assistant.mjs` | Câblage, refinancement, alertes, synthèse, RT/Béoumi, contrat fermé, déterminisme | **RÉUSSI** |
| Corpus | `node .github/agent-tests/aflp-ia-corpus.mjs` | 188 formulations, 120 variantes, refus hors périmètre, ambiguïtés | **188/188 · 120/120** |
| Sécurité | `node .github/agent-tests/aflp-ia-securite.mjs` | Secrets, isolation, charge linguistique, RLS lues, administration | **RÉUSSI** |
| Migration | `node .github/agent-tests/aflp-ia-journal-rls.mjs` | Migration et RLS sur PostgreSQL réel | **43/43** |
| Structure HTML | `node .github/scripts/verifier-html.mjs` | `lang`, titres, `alt`, doublons d'identifiants | **0 nouvel écart** |
| Liens | `node .github/scripts/verifier-liens.mjs` | Liens et ressources internes | **0 nouveau cassé** |
| Syntaxe JS | `node .github/scripts/verifier-js.mjs` | `node --check` sur 57 fichiers | **0 nouvelle erreur** |
| Pages | `node .github/scripts/verifier-pages.mjs` | Chromium réel, 3 largeurs, console, axe-core | **0 nouveau problème** · 95 violations d'accessibilité relevées, non bloquantes |

Tout lancer :

```bash
node .github/agent-tests/aflp-ia-executer.mjs
node .github/scripts/verifier-html.mjs
node .github/scripts/verifier-liens.mjs
node .github/scripts/verifier-js.mjs
npm install --no-save playwright@1.49.1 && npx playwright install chromium
node .github/scripts/verifier-pages.mjs
```

### 2.2 Ce que couvrent les bancs, en détail

**RT et Béoumi** — les cinq questions exigées, plus sept variantes (sans accent,
majuscules, ponctuation, faute sur le nom du lieu), la ventilation par cluster
et par zone, la portée par zone, la liste nominative, et le refus explicite sur
la composition des équipes.

**Intentions** — les 30 intentions publiées ou explicitement indisponibles ;
au moins 5 formulations chacune ; accents, casse, fautes mineures, formulations
courtes, formulations ambiguës, questions hors périmètre.

**Sécurité** — 7 motifs de secret sur 7 fichiers ; absence de réseau, de DOM et
d'écriture dans le moteur et la compréhension ; aucun verbe de mutation
atteignable depuis un contrat ; **preuve par exécution** que répondre aux
188 formulations laisse l'état inchangé ; absence de tout chiffre métier dans la
charge envoyée au fournisseur ; couche linguistique désactivée par défaut ;
kill switch effectif ; refus de quatre formes de contrat non conforme ;
caviardage du journal ; conformité des politiques RLS lues.

**Calculs** — mêmes données + même question ⇒ même résultat (comparaison
d'empreinte JSON) ; un contrat identique produit la **même réponse mot pour mot**
quel que soit le chemin de compréhension ; absence de donnée ⇒ refus explicite ;
source et date affichées ; accord singulier/pluriel.

**Supabase** — migration applicable et **rejouable** ; RLS testée pour six
comptes de rôles différents ; SELECT, INSERT et UPDATE testés ; journalisation
idempotente ; doublons de questions évités ; vue en `security_invoker` vérifiée
par différence de visibilité entre deux rôles ; script de contrôle livré exécuté.

### 2.3 Ce qui n'a PAS été exécuté

| Contrôle | Pourquoi | Qui peut le faire |
|---|---|---|
| Migration sur le projet Supabase | `modifying-a-hosted-supabase-project` interdit (`agent-policy.yml`) | Branch Manager, §3.1 |
| Advisors Supabase | Ne s'exécutent que sur une base où la migration est appliquée | Branch Manager, §3.1 |
| Smoke production | Nécessite la fusion sur `main` ; pousser sur `main` est interdit | après fusion, §3.3 |
| Test sur téléphone réel | Aucun appareil accessible depuis cet environnement | recette terrain |
| PostgREST | Le banc teste PostgreSQL, pas l'API REST | après §3.1 |

---

## 3. Procédure de déploiement

### 3.1 — Appliquer la migration (avant la fusion, de préférence)

1. Supabase → **SQL Editor** → coller **tout**
   `docs/migrations/aflp_ia_journal_20260815.sql` → **Run**.
2. Coller **tout** `docs/migrations/aflp_ia_journal_verify_20260815.sql`.
   **Chaque bloc doit renvoyer `CONFORME`.**
3. Lancer les **advisors** Supabase (Security + Performance). Comparer aux
   alertes préexistantes ; **aucune nouvelle alerte critique** n'est acceptable.
4. Vérifier que **`aflp_ia_interne` n'est PAS** dans
   *Settings → API → Exposed schemas* (seuls `public` et `graphql_public`).
   Cette vérification ne peut pas se faire en SQL.

La migration est **additive** : aucune table existante n'est modifiée, aucune
colonne ajoutée ailleurs, aucun renommage, aucune suppression. Le frontend
fonctionne avant comme après.

**Elle peut être appliquée avant ou après la fusion du frontend** : les deux
ordres sont sûrs, et c'est ce qui rend cette release non coordonnée.

### 3.2 — Fusionner le frontend

1. Relire la pull request. Elle touche `shared/*.js` et `terrain/*.html`, deux
   catégories qui exigent une revue humaine (`agent-policy.yml`,
   `risk_policy.human_review_required`).
2. Vérifier que les portes qualité sont vertes sur la PR.
3. Exécuter localement `node .github/agent-tests/aflp-ia-executer.mjs`.
   Ces bancs **ne sont pas** dans l'intégration continue (voir
   [`aflp_ia_langue_apprentissage_20260815.md`](aflp_ia_langue_apprentissage_20260815.md) §11.2).
4. Fusionner. GitHub Pages publie automatiquement.

### 3.3 — Vérifier en production

Attendre la fin du workflow Pages, puis :

```bash
PRODUCTION_URL=https://nwodobe.github.io/fbms/index.html \
  node .github/scripts/smoke-production.mjs

PRODUCTION_URL=https://nwodobe.github.io/fbms/index.html \
  node .github/scripts/auditer-production.mjs
```

Puis, **connecté avec un compte de niveau BM**, dans le Command Center :

| # | Vérification | Attendu |
|---|---|---|
| 1 | Poser `Combien de RT avons-nous à Béoumi ?` | Phrase nommant Béoumi, nombre d'équipes **enregistrées**, date d'arrêté |
| 2 | Poser `Combien de personnes composent les RT de Béoumi ?` | Refus qui **nomme** la donnée manquante. **Aucun nombre d'équipes** |
| 3 | Poser `Combien avons-nous acheté ?` | Une **question en retour**, pas un chiffre |
| 4 | Pied de l'onglet « Poser une question » | « couche linguistique désactivée » |
| 5 | Ouvrir « Assistant IA · Admin » | L'écran s'ouvre |
| 6 | Ouvrir la même URL avec un compte Agent Recenseur | Écran « Accès non autorisé » |
| 7 | Onglet réseau du navigateur | Aucune requête vers un fournisseur d'IA ; aucune clé autre que la clé publique Supabase |
| 8 | Code source des fichiers livrés | `grep -ri "service_role\|sk-ant\|sk-" shared/aflp-ia-*.js` → aucun résultat |
| 9 | Couper le réseau, poser une question | L'assistant répond ; le pied indique des questions « en attente d'envoi » |
| 10 | Rétablir le réseau, actualiser | La file se vide, sans doublon dans le journal |

Le point **2** est le plus important. Si un nombre apparaît, c'est un défaut
grave : le signaler immédiatement et revenir en arrière (§4).

Le point **9** vérifie que l'ancien comportement hors ligne est intact : c'était
déjà le cas avant ce lot, et cela doit le rester.

---

## 4. Retour arrière

### 4.1 L'ordre, et pourquoi il est dans cet ordre

1. **Désactiver la couche linguistique d'abord.**
   ```sql
   update public.parametres_calcul set valeur='true' where cle='aflp_ia_langue_kill';
   ```
   ou `supabase secrets set AFLP_IA_LANGUE_KILL=true`.
   L'assistant continue de répondre : le repli déterministe **est** le
   comportement nominal d'aujourd'hui.

2. **Conserver le moteur déterministe.** Il ne dépend d'aucun service externe.

3. **Si nécessaire, rétablir le frontend :**
   ```bash
   git revert <sha-de-la-fusion>
   git push origin main   # par un humain : pousser sur main est interdit aux agents
   ```
   GitHub Pages republie. La procédure de retour arrière du dépôt
   (`agent-policy.yml`, `deployment.rollback`) est inchangée.

4. **Ne supprimer AUCUNE donnée de journalisation.** Un journal effacé après un
   incident, c'est l'incident sans ses traces.

5. **Documenter l'incident** dans ce fichier, section 6.

### 4.2 Ce qu'il ne faut PAS faire

**Ne pas exécuter `aflp_ia_journal_rollback_20260815.sql`.**

La migration est additive, et le frontend teste la présence des tables : si elles
disparaissent, le journal se met en veille et l'assistant continue. Revenir en
arrière **ne demande donc aucun SQL**. Les tables restent, inertes et sans coût.

Le script de retour arrière n'existe que pour le cas où le Branch Manager
demande explicitement la suppression du dispositif — et il exige un export
préalable du journal et de l'audit. Son en-tête le dit en trois paragraphes.

### 4.3 Compatibilité ascendante

| Garantie | Vérifiée par |
|---|---|
| Aucune colonne supprimée ou renommée | Lecture de la migration |
| Aucune table existante modifiée | Lecture de la migration |
| Migration rejouable sans erreur | Banc PGlite, contrôle n° 2 |
| Frontend fonctionnel sans les tables | `AFLP_IA_JOURNAL` se met en veille sur `PGRST205` |
| Tables fonctionnelles sans le frontend | Elles ne sont lues par rien d'autre |
| Ancien moteur inchangé hors ligne | Aucun appel réseau dans le moteur, vérifié par le banc de sécurité |

---

## 5. Points de coupure, du plus rapide au plus lourd

| Ce qu'on veut arrêter | Comment | Effet sur l'assistant |
|---|---|---|
| La couche linguistique | `aflp_ia_langue_kill = true` | Aucun — repli déterministe |
| Idem, côté serveur | `supabase secrets set AFLP_IA_LANGUE_KILL=true` | Aucun |
| Idem, depuis un poste | `AFLP_IA_LANGUE.couper()` en console | Aucun, pour cette session |
| La journalisation | `AFLP_IA_JOURNAL.arreter()` — persistant par poste | Aucun — plus de mesure |
| L'écran d'administration | Retirer le rôle BM du compte | Aucun |
| Tout le lot | `git revert` de la fusion | Retour au moteur du 14/08 |

---

## 6. Rapport de mise en production — 15 août 2026

| Étape | Horodatage | Résultat |
|---|---|---|
| Fusion de la PR #160 (squash) | 18:11:43 UTC | Commit `b22d723` |
| Publication GitHub Pages | 18:11:45 UTC | Succès, 29 s |
| Smoke test du dépôt | 18:12:09 UTC | **16/18**, identique à l'avant-fusion |
| Vérification du code servi | 18:20 UTC | 8/8 fichiers en 200, aucun secret |
| Questions de contrôle sur le code déployé | 18:20 UTC | **5/5 conformes** |
| Requêtes en échec sur `command.html` | 18:22 UTC | **0** |
| Migration Supabase | — | **NON APPLIQUÉE** (constaté : aucune table `aflp_ia_*`) |

**Aucune régression.** Le seul défaut du smoke test — `HTTP 404` sur
`shared/anagroci-audit.js` — existait avant la fusion, sur une page que ce lot ne
touche pas.

### Ce qui n'a pas pu être vérifié depuis l'extérieur

Le Command Center est derrière le portail d'authentification. Les cinq questions
de contrôle ont donc été posées **au code téléchargé depuis la production**, sur
le jeu d'essai du dépôt — ce qui prouve que le bon code est déployé et qu'il
répond correctement, mais **pas** ce qu'il répondra sur les données réelles
(125 équipes RT, 76 villages au 15/08). Cette vérification-là appartient au
Branch Manager, connecté.

### Un workflow du dépôt échoue à chaque poussée, indépendamment de ce lot

`.github/workflows/agent-auto-fix.yml` termine en échec en 0 seconde sur
**toutes** les branches depuis au moins le 14/08 — y compris sur la fusion #159
qui précède celle-ci. GitHub indique « This run likely failed because of a
workflow file issue ». Ce n'est pas une conséquence de ce lot, et
`.github/workflows/**` est interdit aux agents : la correction est un geste
humain, dans une pull request dédiée.

## 7. Journal des incidents

*Aucun incident à ce jour. Toute intervention en production est à consigner ici,
avec date, symptôme observé, action menée et résultat.*

| Date | Symptôme | Action | Résultat |
|---|---|---|---|
| — | — | — | — |

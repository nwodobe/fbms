# Campagne de test — 100 utilisateurs simultanés

Ce dossier contient tout ce qui a servi à la campagne d'août 2026 : les scripts, le banc
d'essai et les rapports. Tout est rejouable ; rien n'a été écrit à la main dans les résultats.

**Aucun fichier applicatif n'a été modifié.** Cette campagne établit un état de référence ;
les corrections font l'objet de travaux séparés (08-RECOMMENDATIONS.md).

## Organisation

| Dossier | Contenu |
|---|---|
| `bench/` | Banc d'essai : serveur statique, émulateur Supabase, routage navigateur |
| `e2e/` | Tests Playwright : parcours, intégrité, performance, sécurité, hors ligne, réseau dégradé |
| `load/` | Scripts k6 et lanceur de la campagne de charge |
| `reports/` | Les neuf rapports, plus `donnees/` (résultats bruts JSON, source de tous les chiffres) |

### Les neuf rapports

| Fichier | Contenu | À lire si… |
|---|---|---|
| `01-MAPPING.md` | Cartographie : modules, rôles, formulaires, CRUD, tables, dépendances | vous découvrez l'application |
| `02-FUNCTIONAL-REPORT.md` | 285 ouvertures de pages, matrice d'accès observée, formulaires | vous voulez savoir ce qui s'ouvre pour qui |
| `03-DATA-INTEGRITY-REPORT.md` | 17 scénarios de concurrence, coupure réseau, double-clic, quota | **vous ne devez en lire qu'un seul** |
| `04-LOAD-REPORT.md` | Paliers 1→100, montée, pic, concurrence, simulation hybride | vous dimensionnez le serveur |
| `05-BUGS.md` | 23 anomalies, chacune avec sa preuve | vous corrigez |
| `06-PERFORMANCE.md` | Poids, Web Vitals, demande client, réseau dégradé | vous optimisez |
| `07-SECURITY-ACCESS.md` | Rôles, isolation, cohérence portail ↔ RLS | vous gérez les accès |
| `08-RECOMMENDATIONS.md` | Corrections classées par risque évité / effort | vous planifiez |
| `09-EXECUTIVE-SUMMARY.md` | Synthèse et verdict, sans jargon | vous décidez |

## Prérequis

```bash
npm install --no-save playwright@1.49.1 @supabase/supabase-js@2.47.10
curl -sSL -o k6.tar.gz https://github.com/grafana/k6/releases/download/v0.55.0/k6-v0.55.0-linux-amd64.tar.gz
tar xzf k6.tar.gz && cp k6-v0.55.0-linux-amd64/k6 /usr/local/bin/
```

Aucun `package.json` n'est ajouté à la racine : ce dépôt n'a ni construction ni gestionnaire de
paquets (`CLAUDE.md` §1), et cette campagne ne le change pas. `node_modules/` est déjà ignoré.

## Exécution

```bash
node tests/bench/verifier-banc.mjs          # contrôle du banc lui-même — à lancer en premier
node tests/e2e/01-parcours-pages.mjs        # 19 pages x 5 personas x 3 largeurs (~25 min)
node tests/e2e/02-integrite-donnees.mjs     # 17 scénarios d'intégrité (~12 min)
node tests/e2e/03-performance-demande.mjs   # poids, Web Vitals, demande client (~40 min)
node tests/e2e/04-securite-acces.mjs        # rôles, isolation, accès direct (~6 min)
node tests/e2e/05-hors-ligne-pwa.mjs        # service workers et hors ligne (~3 min)
node tests/e2e/06-reseau-degrade.mjs        # 4G / 3G / 2G (~15 min)
node tests/load/executer.mjs                # campagne de charge complète (~25 min)
```

Ajouter `--rapide` ou `--court` là où l'option existe pour une exécution abrégée.

## Pourquoi un banc d'essai plutôt que la production

L'environnement d'exécution de cette campagne n'a **aucun accès sortant** vers
`nwodobe.github.io` ni vers `*.supabase.co` : la politique de sortie refuse la connexion
(`CONNECT → 403`, constat reproductible en tête de `reports/01-MAPPING.md`).

Le banc exécute donc **les octets exacts du dépôt** (empreintes SHA-256 comparées) avec le
**vrai SDK `@supabase/supabase-js`**, contre un émulateur qui reproduit les contraintes
déclarées dans `supabase/*.sql`. Ce qui est mesurable ainsi l'est réellement ; ce qui ne l'est
pas est marqué `NON TESTÉ` avec sa raison, jamais approximé.

Le jour où l'accès est ouvert, les mêmes scripts visent la production :

```bash
k6 run -e SITE=https://nwodobe.github.io/fbms tests/load/04-statique.js   # lecture seule
```

Lire `load/LISEZ-MOI.md` **avant** tout test d'écriture : le projet n'a qu'un seul
environnement, et c'est la production.

## Données de test

Tout ce que la campagne crée porte le préfixe `TEST_LOAD_`. Aucun nom de producteur, numéro de
téléphone, montant ou coordonnée GPS réels n'apparaît dans les scripts, les résultats ou les
rapports (`CLAUDE.md` §5.4). Les adresses de test utilisent le domaine `.invalid`, réservé par
la RFC 2606.

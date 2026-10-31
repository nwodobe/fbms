# AFLP FIELD PROOF — installation, mise à jour, retour arrière

## Ce que contient la pull request

| Chemin | Nature | Revue |
|---|---|---|
| `fieldproof/index.html`, `fp-*.js`, `fp.css` | Nouveau module, autonome | Humaine (HTML + logique métier) |
| `fieldproof/portal-fieldproof.css` | Mise en page de la 7e carte du portail | — |
| `index.html` | Ajout de la carte + 1 feuille de style + « 7 workspaces » | Humaine |
| `assets/operations/modules/field-proof.webp` | Image de la carte (capture réelle du module) | Humaine (marque) |
| `tests/fieldproof/**` | Tests unitaires et recette navigateur, doublures fictives | — |
| `docs/aflp-field-proof/**` | Documentation | — |

**Aucune modification** de : `supabase/**` (ni table, ni RLS, ni fonction), `shared/auth-gate.js`,
`shared/admin.html`, `shared/aflp-access.js`, `sw.js`, `i18n-sw.js`, `manifest.webmanifest`, `.github/**`,
`.claude/**`. Aucun secret.

## Mise en production

1. Relire et fusionner la PR (aucune étape Supabase n'est nécessaire).
2. GitHub Pages publie automatiquement. Contrôle :
   `PRODUCTION_URL=https://nwodobe.github.io/fbms/index.html node .github/scripts/smoke-production.mjs`
3. Sur un téléphone de chaque type : ouvrir FBMS en ligne, ouvrir AFLP FIELD PROOF une fois (mise en cache
   par le service worker existant), puis dérouler `docs/aflp-field-proof/RAPPORT_TESTS.md` §4.

## Mise à jour du module

Les scripts sont chargés avec `?v=AAAAMMJJ-n`. Après modification d'un fichier `fieldproof/*`, incrémenter
ce suffixe dans `fieldproof/index.html` : le service worker sert d'abord le réseau pour la page, qui appelle
alors les nouveaux fichiers. Le registre local (IndexedDB `anagroci_fieldproof`, version 1) est conservé ;
toute évolution de structure passera par une montée de version dans `fp-store.js`, sans effacement.

## Retour arrière

`git revert` du commit de fusion. Les missions déjà présentes sur les téléphones restent dans IndexedDB et
dans les galeries ; elles redeviennent accessibles si le module est republié.

## Vérifications rejouables

```bash
node tests/fieldproof/core.test.mjs                                   # 32 contrôles du cœur
npm install --no-save playwright@1.49.1                                # une fois
CHROMIUM=/usr/bin/google-chrome node tests/fieldproof/e2e/fieldproof-e2e.mjs   # 26 scénarios (ffmpeg, python3+Pillow, unzip)
CHROMIUM=/usr/bin/google-chrome node tests/fieldproof/e2e/hors-ligne-sw.mjs    # réouverture hors ligne via sw.js
node .github/scripts/verifier-html.mjs && node .github/scripts/verifier-liens.mjs && node .github/scripts/verifier-js.mjs
node .github/scripts/verifier-pages.mjs
```

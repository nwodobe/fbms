# Step 1B - Correction controlee securite / acces / audit

Date: 2026-07-19
Projet: ANAGROCI Operations Suite

## 1. Correction Supabase appliquee

La table suivante avait ete identifiee comme critique parce que RLS etait desactive:

- `public.historique_parametres_collecte_courte`

Correction appliquee de maniere non destructive:

- creation d'une policy SELECT pour les utilisateurs authentifies;
- creation d'une policy INSERT pour les utilisateurs authentifies;
- activation de Row Level Security sur la table.

Aucune suppression, aucun reset, aucune modification de donnees n'a ete effectuee.

## 2. Controle apres correction

Apres correction, `public.historique_parametres_collecte_courte` apparait avec:

- RLS active;
- 0 ligne de donnees;
- policies explicites pour SELECT et INSERT authentifies.

## 3. Acces modules

Le module `rcntrace` est deja present dans la matrice d'acces de `shared/auth-gate.js`:

```js
rcntrace: ["bm", "chef", "agent", "direction"]
```

Correction complementaire appliquee:

- ajout de `rcntrace` dans la detection des sous-repertoires afin que les liens `Portail`, `Administration` et `shared/` soient correctement resolus depuis `/rcntrace/`.

## 4. Audit frontend

Le fichier `shared/anagroci-audit.js` a ete branche automatiquement par `shared/auth-gate.js`.

Le portail expose maintenant:

- `window.ANAGROCI_SUPABASE_URL`;
- `window.ANAGROCI_SUPABASE_ANON`;
- `window.ANAGROCI_MODULE`;
- `window.ANAGROCI_AUTH.module`.

Le helper audit peut donc inserer progressivement dans `audit_log`.

Actions deja tracees globalement:

- acces module: `module_access`;
- deconnexion: `logout`.

## 5. Points restant a faire dans l'Etape 1

Il reste a brancher progressivement les actions metier sensibles:

- creation achat;
- validation / rejet achat;
- avance RT;
- reconciliation cash;
- mouvement sacs;
- correction stock;
- modification distance;
- simulation ALIS;
- decision GM;
- export de donnees.

## 6. Decision de controle

Cette etape est non destructive. Elle consolide la securite et prepare l'audit sans changer la logique metier existante.

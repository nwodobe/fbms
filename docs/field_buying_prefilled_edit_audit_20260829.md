# FIELD BUYING — audit édition préremplie — 2026-08-29

## Diagnostic Supabase

Audit effectué sur **116 RT actifs**.

| Contrôle | Résultat |
|---|---:|
| RT actifs | 116 |
| Sans `id_rt` | 0 |
| Sans nom | 0 |
| Sans téléphone | 0 |
| Sans `village_id` | 0 |
| Sans cluster | 0 |
| `data` non objet JSON | 0 |
| Village référencé introuvable | 0 |

La base n'explique donc pas les échecs d'édition observés.

## Cause principale retrouvée

La couche `field-buying-profiles.js` ajoutée avec les fiches 360° utilisait encore des `prompt()` pour modifier un RT ou un Village. Elle ne réutilisait pas le formulaire exhaustif d'enrôlement et ne préremplissait que 2 champs. Le problème était donc principalement UX / routage de l'édition, pas une corruption des 116 RT.

## Données legacy à préserver

Les 116 RT ont `activite`, `reputation` et `perf` dans `rt.data`. **94 RT** portent encore les clés historiques `photo`, `pieceRecto` et `pieceVerso`. L'édition doit fusionner le JSON existant, jamais le reconstruire à zéro.

## Anti-doublon

Le trigger `guard_rt_duplicate_identity()` est compatible avec UPDATE : il utilise `r.id is distinct from new.id`. La nouvelle couche client applique la même règle en excluant le RT courant avant sauvegarde.

## Correction

`operations/field-buying-prefilled-edit.js` :

- réutilise `ANAGROCI_FB.openRtForm`, `openVillageForm`, `openFarmerForm` ;
- passe le formulaire canonique en `data-mode="edit"` ;
- préremplit les champs depuis les colonnes canoniques + JSON legacy ;
- remplace le CTA par « Enregistrer les modifications » ;
- utilise UPDATE ciblé par l'ID existant ;
- conserve `id`, `id_rt`, Farmer ID et données spécialisées ;
- fusionne les JSON existants afin de conserver photos historiques et champs non édités ;
- retourne à la fiche 360° après sauvegarde ;
- transforme les erreurs techniques en messages utilisateur.

Aucune migration Supabase n'est requise pour cette correction.

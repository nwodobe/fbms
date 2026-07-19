# Etape 2C-A bis - Correction validation distances

Date: 2026-07-19
Module: `fbms/audit_distances.html`

## Objectif

Remplacer le `prompt()` navigateur utilise pour valider une distance par un vrai panneau de validation metier.

## Changements

- Ajout d'un panneau modal de validation.
- Affichage avant validation de:
  - village et cluster;
  - distance GPS;
  - distance saisie;
  - distance routiere deja validee;
  - ecart;
  - impact ALIS.
- Ajout d'un champ obligatoire `Motif / preuve de validation`.
- Enregistrement dans `data.s1` de:
  - `distanceHubRoutiere`;
  - `distanceHubRoutiereValidatedAt`;
  - `distanceHubRoutiereValidationMotif`;
  - `distanceHubRoutierePrevious`;
  - `distanceHubRoutiereValidationSource`;
  - `distanceHubRoutiereHistorique`.
- Conservation d'une fonction `valide(id)` compatible, qui ouvre maintenant le panneau au lieu d'utiliser `prompt()`.
- Traçage audit via `window.ANAGROCI_AUDIT.log('distance_validation_confirmed', ...)` si le helper audit est disponible.

## Audit de securite

- Aucun changement Supabase schema.
- Aucune migration.
- Aucune suppression.
- Aucune modification de table.
- Les donnees ne sont modifiees que lorsque l'utilisateur confirme explicitement la validation.

## Audit fonctionnel

Fonctions principales presentes:

- `load`
- `pickHub`
- `dataRows`
- `render`
- `saveHub`
- `openValidationPanel`
- `closeValidationPanel`
- `confirmValidation`
- `valide`

## Limite restante

Le module stocke l'historique dans le JSON `villages.data.s1`. A terme, une table dediee `distance_validations` serait plus propre pour un audit complet et des rapports filtres.

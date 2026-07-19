# Etape 2C-C - Correction FBMS wrapper / coeur

Date: 2026-07-19
Projet: ANAGROCI Operations Suite

## 1. Objectif

Corriger l'effet double barre du referentiel FBMS et supprimer l'affichage en iframe depuis `fbms/app.html`.

L'objectif est de conserver l'ancien lien du portail tout en orientant l'utilisateur vers le coeur natif FBMS (`fbms/index.html`).

## 2. Changement realise

Le fichier `fbms/app.html` a ete transforme en passerelle premium:

- suppression de l'iframe visible;
- conservation de l'authentification via `shared/auth-gate.js`;
- redirection vers `index.html` apres validation d'acces;
- ajout d'un ecran de transition ANAGROCI / PJS;
- bouton manuel `Ouvrir FBMS` si la redirection automatique tarde;
- bouton `Retour portail`.

## 3. Ce qui n'a pas ete touche

- `fbms/index.html` n'a pas ete modifie dans cette sous-etape.
- Les stores IndexedDB FBMS ne sont pas modifies.
- Les tables Supabase ne sont pas modifiees.
- Aucun reset, aucune suppression, aucune migration.
- La logique metier du referentiel FBMS reste intacte.

## 4. Pourquoi ne pas refondre brutalement `fbms/index.html`

Le coeur FBMS est un gros fichier historique contenant:

- l'interface terrain;
- les stores IndexedDB;
- la synchronisation;
- les modules villages / RT / producteurs;
- les exports;
- la cartographie;
- des dependances CDN et de nombreuses fonctions existantes.

Une refonte directe du coeur sans audit fonctionnel detaille pourrait casser la collecte terrain. Cette etape corrige donc d'abord le probleme visuel du wrapper sans toucher aux donnees ni a la logique.

## 5. Audit de securite

La passerelle conserve:

```html
<script defer src="../shared/auth-gate.js" data-module="fbms"></script>
```

L'utilisateur passe donc encore par le controle d'acces du module FBMS avant l'ouverture automatique du coeur.

## 6. Limite restante

Le coeur `fbms/index.html` reste a harmoniser plus tard:

- integration directe de la coquille commune;
- reduction des styles historiques;
- meilleur header PJS / ANAGROCI;
- meilleure experience mobile;
- verification complete de l'authentification directe sur l'ancien lien.

## 7. Conclusion

Etape 2C-C corrige le probleme principal du wrapper sans prendre de risque sur les donnees ou les fonctions FBMS.

Prochaine etape recommandee: Etape 2C-D - Hubs / Carte, ou une passe specifique FBMS coeur apres audit fonctionnel complet.

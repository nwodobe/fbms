# Etape 2A - Design commun / socle visuel

Date: 2026-07-19
Projet: ANAGROCI Operations Suite

## Objectif

Demarrer l'Etape 2 par un socle visuel commun non destructif, sans refondre brutalement les modules.

Le but est d'harmoniser progressivement:

- couleurs ANAGROCI / PJS;
- polices;
- cartes;
- boutons;
- champs de formulaire;
- badges de statut;
- tableaux;
- scrollbars;
- comportements hover/focus;
- rendu mobile de base.

## Fichiers crees / modifies

### Nouveau fichier

- `shared/anagroci-ui.css`

Role:

- fournir les variables de design communes;
- appliquer un style ERP plus premium;
- harmoniser les composants sans toucher au JavaScript metier.

### Fichier modifie

- `shared/pjs-theme.css`

Role:

- importer `shared/anagroci-ui.css`;
- conserver la compatibilite avec les modules qui utilisaient deja `pjs-theme.css`.

## Choix technique

Les modules qui chargent deja:

```html
<link rel="stylesheet" href="../shared/pjs-theme.css">
```

beneficient automatiquement du nouveau socle visuel.

Aucun module n'a ete reecrit a cette etape.

## Ce qui n'a pas ete fait volontairement

- pas de modification Supabase;
- pas de changement de donnees;
- pas de suppression de CSS existant dans les modules;
- pas de refonte HTML lourde;
- pas de redesign du portail entier;
- pas de suppression des wrappers ou iframes;
- pas de changement de workflow.

## Audit avant PR

Verification realisee:

- changement limite a un fichier CSS partage existant et un nouveau fichier CSS;
- aucun JavaScript metier touche;
- aucun schema Supabase touche;
- approche reversible: retirer l'import `anagroci-ui.css` dans `pjs-theme.css` suffit a revenir au theme precedent.

## Limites actuelles

Cette etape cree la base visuelle, mais ne suffit pas a uniformiser totalement l'application.

Les modules qui ne chargent pas encore `shared/pjs-theme.css` ne seront pas harmonises automatiquement.

## Prochaine sous-etape recommandee

Etape 2B - Audit d'integration design module par module:

1. Portail mere;
2. Command Center;
3. Achats Terrain;
4. Caisse & Avances;
5. Stock & Sacs;
6. FBMS Referentiel;
7. Hubs / Carte / Audit distances;
8. ALIS;
9. RCN TRACE.

Pour chaque module, verifier:

- chargement de `pjs-theme.css`;
- coherence header / sidebar / boutons;
- lisibilite mobile;
- densite visuelle;
- doublons de navigation;
- zones encore trop techniques.

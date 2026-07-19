# Etape 2C-D - Design premium Hubs / Carte

Date: 2026-07-19
Projet: ANAGROCI Operations Suite

## 1. Objectif

Harmoniser visuellement les modules geographiques de FBMS sans toucher a la logique de geolocalisation, aux donnees Supabase, a Leaflet ou aux calculs de distance.

Modules concernes:

- `fbms/fbms_hubs.html`
- `fbms/fbms_carte.html`

## 2. Correction appliquee

Ajout de la couche CSS:

```text
shared/geo-premium.css
```

Chargement via:

```css
@import url('./geo-premium.css');
```

dans:

```text
shared/pjs-theme.css
```

## 3. Principe de securite

La correction est volontairement limitee au design.

Aucune modification de:

- JavaScript metier;
- Supabase;
- tables;
- RLS;
- IndexedDB;
- synchronisation;
- calculs Haversine;
- fonctions GPS;
- logique Leaflet;
- distances validees.

## 4. Scope CSS

La couche utilise le ciblage:

```css
body:has(#map)
```

Ce ciblage vise les pages geographiques qui contiennent une carte Leaflet et qui chargent deja le theme partage.

## 5. Ameliorations visuelles

- Header plus premium avec degrade ANAGROCI/PJS.
- Boutons harmonises.
- Cartes et panneaux plus propres.
- Filtres mieux encadres.
- Tableaux Hubs plus lisibles.
- KPI Cartographie plus professionnels.
- Labels carte plus lisibles.
- Conteneur Leaflet mieux integre.
- Effets d'ombre plus sobres.
- Meilleure coherence mobile.

## 6. Modules controles

### Hubs / Clusters

Le module charge deja:

- `auth-gate.js` avec `data-module="hubs"`;
- Leaflet;
- Supabase;
- `pjs-theme.css`;
- `uppercase.js`.

La correction ne modifie pas les fonctions:

- synchronisation depuis les clusters;
- sauvegarde GPS;
- workflow de validation;
- distances hub-usine;
- carte Leaflet.

### Cartographie FBMS

Le module charge deja:

- `auth-gate.js` avec `data-module="carte"`;
- Leaflet;
- Supabase;
- `pjs-theme.css`;
- `uppercase.js`.

La correction ne modifie pas:

- les layers Leaflet;
- les axes village-hub;
- les labels;
- les distances validees;
- le rafraichissement automatique;
- les abonnements realtime Supabase.

## 7. Limite restante

La cartographie reste dans un fichier tres compacte sur une seule ligne. Une refonte structurelle HTML serait souhaitable plus tard, mais elle doit etre faite prudemment pour ne pas casser les couches Leaflet.

## 8. Conclusion

Etape 2C-D terminee cote design.

La prochaine etape logique est:

```text
Etape 2C-E - Achats / Cash / Sacs / Command : correction fine et coherence mobile
```

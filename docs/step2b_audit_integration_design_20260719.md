# Etape 2B - Audit integration design module par module

Date: 2026-07-19
Projet: ANAGROCI Operations Suite

## 1. Objectif

Verifier module par module si le socle design commun cree en Etape 2A est effectivement charge et si chaque interface est prete pour une refonte progressive.

Cette etape est un audit uniquement:

- aucune logique metier modifiee;
- aucune migration Supabase;
- aucune donnee modifiee;
- aucune suppression;
- aucune correction visuelle directe dans les modules.

## 2. Rappel du socle commun disponible

Le socle design commun est charge via:

```html
<link rel="stylesheet" href="../shared/pjs-theme.css">
```

`shared/pjs-theme.css` importe maintenant:

```css
@import url('./anagroci-ui.css');
```

Cela signifie que tout module qui charge deja `pjs-theme.css` profite automatiquement du socle UI commun.

## 3. Resultat global

| Module | Fichier | pjs-theme | Logo PJS | Auth gate | Niveau integration | Decision |
|---|---|---:|---:|---:|---|---|
| Portail | `index.html` | Non | Oui | Oui | Partiel | Ajouter lien vers `shared/anagroci-ui.css` ou harmoniser sans casser le hero |
| Command Center | `terrain/command.html` | Oui | Oui | Oui | Bon | Passer en correction fine 2C |
| Achats Terrain | `terrain/achats.html` | Oui | Oui | Oui | Bon | Passer en correction fine 2C |
| Caisse & Avances | `terrain/cash.html` | Oui | Oui | Oui | Bon | Passer en correction fine 2C |
| Stock & Sacs | `terrain/sacs.html` | Oui | Oui | Oui | Tres bon | Conserver comme reference visuelle |
| FBMS wrapper | `fbms/app.html` | Oui | Oui | Oui | Partiel | Supprimer l'effet double barre a terme |
| FBMS coeur | `fbms/index.html` | Oui | Oui | via wrapper / existant | Partiel | A harmoniser fortement |
| Hubs / Clusters | `fbms/fbms_hubs.html` | Oui | Oui/partiel | Oui | Moyen | Remplacer le style brut par composants communs |
| Cartographie | `fbms/fbms_carte.html` | Oui | Oui | Oui | Moyen | Adapter au layout carte sans casser Leaflet |
| Audit distances | `fbms/audit_distances.html` | Non ou insuffisant | Non/partiel | Oui | Faible | Priorite design haute |
| ALIS | `logistique/alis_fbms.html` | Oui | Oui | Oui | Moyen | Refaire presentation decisionnelle |
| RCN TRACE | `rcntrace/index.html` | Non | Oui | Oui | Faible a moyen | Ajouter le theme commun progressivement |

## 4. Constats par module

### 4.1 Portail

Le portail a deja une identite forte, un hero propre, des cartes et le logo PJS. Mais il ne charge pas encore `pjs-theme.css` ni `anagroci-ui.css`. Il utilise ses propres variables et son propre CSS interne.

Impact:

- visuellement acceptable;
- pas encore totalement rattache au socle commun;
- risque de divergence progressive si les autres modules evoluent.

Decision 2C:

- ne pas casser le hero;
- ajouter une harmonisation douce;
- idealement charger le socle UI commun avec une version compatible racine: `shared/pjs-theme.css` ou `shared/anagroci-ui.css`.

### 4.2 Command Center

Le module est deja raccorde au theme partage et utilise le logo PJS. Il doit servir de base pour une page de pilotage, mais il doit recevoir une meilleure hierarchie visuelle.

Decision 2C:

- renforcer bandeau decisionnel;
- ajouter alertes par gravite;
- standardiser KPI cards.

### 4.3 Achats Terrain

Le module charge le theme commun et dispose deja d'une structure propre: topbar, KPI, formulaire, liste des derniers achats. Il est integre visuellement mais reste tres formulaire.

Decision 2C:

- transformer le formulaire en experience terrain plus premium;
- mieux separer saisie, controle, statut et pieces justificatives;
- conserver la logique metier existante.

### 4.4 Caisse & Avances

Le module est raccorde au theme commun. Son design doit etre clarifie autour de la fiche RT finance: avance, paye, solde, reconciliation.

Decision 2C:

- faire ressortir le risque financier;
- donner une vue decisionnelle par RT;
- rendre la reconciliation plus visuelle.

### 4.5 Stock & Sacs

C'est le module le plus abouti visuellement. Il charge le theme commun, a des badges, des soldes, une logique d'historique et une structure claire.

Decision 2C:

- utiliser Stock & Sacs comme reference de style pour les autres modules;
- ne pas le refaire brutalement;
- corriger seulement les details d'espacement, header et coherence mobile.

### 4.6 FBMS wrapper et FBMS coeur

`fbms/app.html` charge le theme commun mais reste un wrapper iframe autour de `fbms/index.html`. Cela cree une double logique de navigation et peut donner une impression moins premium.

Decision 2C:

- ameliorer le wrapper immediatement;
- planifier a terme une suppression progressive de l'iframe;
- creer une vraie integration FBMS dans la coquille commune.

### 4.7 Hubs / Clusters

Le module charge le theme commun, mais son CSS interne reste dominant et assez brut. Il doit etre rapproche de la logique cards + tableau + panneau details.

Decision 2C:

- reformater la topbar;
- harmoniser les cards, boutons, filtres, tableau;
- ne pas toucher aux fonctions GPS et sauvegarde.

### 4.8 Cartographie

Le module charge le theme commun, mais la carte Leaflet impose une structure specifique. Le design commun ne doit pas casser la surface carte.

Decision 2C:

- garder l'espace carte prioritaire;
- styliser seulement topbar, sidebar, KPI, filtres et boutons;
- eviter des ombres lourdes qui ralentissent mobile.

### 4.9 Audit distances

C'est le module le plus faible visuellement. Il est compact, technique et moins premium. Il doit devenir une interface de validation avec trois zones: carte, ecarts, justification.

Decision 2C:

- priorite haute;
- ajouter explicitement le socle design si absent;
- refaire la lecture visuelle des statuts OK / a controler / anomalie;
- preparer un panneau de validation plus professionnel.

### 4.10 ALIS

ALIS charge le theme commun mais reste trop compact et technique. Le module doit aider a decider, pas seulement calculer.

Decision 2C:

- rendre le resultat plus executif;
- afficher clairement Acceptable / A surveiller / Validation BM requise;
- creer des cards scenario, cout/kg, quantite minimale, camion recommande;
- conserver le moteur existant.

### 4.11 RCN TRACE

RCN TRACE a sa propre charte interne et ne charge pas encore `pjs-theme.css`. Il a une structure riche mais doit etre raccorde prudemment au socle commun pour eviter de casser sa complexite.

Decision 2C:

- ajouter progressivement le theme commun;
- ne pas casser les modules reception / sampling / BIN / transfert / calibrage;
- faire une passe specifique RCN TRACE plus tard si besoin.

## 5. Priorite de correction 2C

Ordre recommande:

1. Audit distances - module le plus faible et critique pour ALIS.
2. ALIS - decision transport et cout/kg.
3. FBMS wrapper / coeur - perception globale du referentiel.
4. Hubs / Carte - coherence geographique.
5. Achats / Cash / Sacs / Command - deja bons, correction fine.
6. RCN TRACE - grosse refonte a faire prudemment.
7. Portail - harmonisation douce, ne pas casser le hero.

## 6. Conclusion

Le socle design commun est bien installe, mais tous les modules ne le consomment pas au meme niveau.

L'application est maintenant prete pour l'Etape 2C: corrections design module par module, en commencant par Audit distances puis ALIS.

Decision de controle: ne pas passer a l'Etape 3 tant que les corrections 2C n'ont pas ete appliquees puis auditees.

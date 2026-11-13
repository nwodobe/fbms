# FBMS AFLP V2.2 · Diagnostic UX/UI et navigation unique

**Environnement :** PR de conception sur branche isolée, sans modification de la base ni du site GitHub Pages en production.
**Vérifications :** code `main` et portail du 13/11/2026, fichiers `index.html`, `operations/espaces.*`, `navigation-v2.js`, `workspace.js`, `field-buying.html`, `procurement.html`, `reports.html`, `campaigns.html`, `traceability.html`, `moto/index.html`, `fieldproof/index.html`.

## Décision d'architecture
L'utilisateur ne veut pas **deux couches de navigation**. Nous conservons une seule navigation principale, organisée en **six domaines** :
1. Ma journée
2. Réseau
3. Terrain
4. Achats & comptes RT
5. Expédition
6. Pilotage & administration

**Choix V2.2 :** conserver les routeurs métier éprouvés mais remplacer leur menu principal par un composant commun. Les liens profonds existants restent ouverts. Sur ordinateur, cette navigation apparaît dans une barre latérale. Sur mobile, la même navigation fonctionne comme un tiroir unique. Les sous-rubriques ne constituent pas un second portail ; elles n'apparaissent que sous le domaine actif. Les cartes de l'accueil sont des **actions directes**, et non des menus de navigation concurrents.

## Inventaire des couches avant V2.2

| Élément | Source | Constat vérifié | Décision |
|---|---|---|---|
| Portail à six cartes | `index.html` | Chaque carte mène vers `espaces.html#Ex` | Remplacer par l'accueil Ma journée |
| Second écran des espaces | `operations/espaces.html`, `espaces.js` | Affiche des cartes qui ouvrent des pages historiques | Remplacer par une redirection de compatibilité |
| Sidebar Field Buying | `operations/navigation-v2.js` et `workspace.js` | Navigation autonome de module | Remplacer visuellement par le menu canonique |
| Changement de workspace | `operations/workspace.js` | Menu déroulant « Changer d'espace » additionnel | Ne pas afficher dans les pages AFLP unifiées |
| Rapports/Campagnes/Trace | HTML sans `#opsSidebar` | Présentations différentes des principaux workspaces | Ajouter un conteneur partagé à l'affichage |
| Fleet et Field Proof | `moto/index.html`, `fieldproof/index.html` | Micro-apps indépendantes, avec écran et navigation propres | Maintenir provisoirement comme services spécialisés ; intégration complète = chantier complémentaire |
| Warehouse/Transfer/Factory | `operations/navigation-v2.js` | Fonctions physiques après BEV également exposées | Ne pas intégrer aux six espaces AFLP tant que PJS Operations est propriétaire de ces opérations |

### Limite technique importante
Les modules **AFLP Fleet**, **AFLP Field Proof** et l'administration native disposent encore de leur propre interface, et les vues d'achat demeurent rendues par leurs contrôleurs historiques. Cette PR **ne constitue pas encore la preuve d'une expérience complètement unifiée de bout en bout**. Elle supprime la galerie intermédiaire et aligne un premier groupe de modules centraux ; l'intégration des services spécialisés et des liens profonds depuis leurs propres écrans demande une seconde recette.

Les droits visibles sont filtrés pour l'ergonomie. Les autorisations réelles sont exclusivement celles des APIs et RLS existantes.

## Options analysées

| Architecture | UX terrain | Risque technique | Maintenabilité | Décision |
|---|---|---|---|---|
| A. Réécriture SPA complète | Potentiellement excellente | Fort : régression auth, offline, achats et synchronisation | Excellente après migration | Écartée pour cette étape |
| B. Shell partagé sur les écrans existants | Bonne si aucun second menu | Modéré | Bonne | Retenue pour le pilote |
| C. Deux portails en transition prolongée | Faible : clics et confusion | Faible initialement, dette durable | Faible | Écartée |

**Pourquoi B :** le risque de casse du travail bord champ sans connexion est prioritaire sur la pureté architecturale. L'option B doit néanmoins avoir une **date de retrait des derniers menus historiques** et non devenir une transition permanente.

## Parcours directs et anciennes routes

| Point d'entrée ancien | Nouvelle destination fonctionnelle | Périmètre |
|---|---|---|
| `index.html` | Ma journée, six espaces, liens directs | Authentifié |
| `operations/espaces.html#E0` | `index.html` | Tous |
| `operations/espaces.html#E1` | `operations/field-buying.html#farmers` | Réseau |
| `operations/espaces.html#E2` | `operations/field-buying.html#sustainability` | Terrain |
| `operations/espaces.html#E3` | `operations/field-buying.html#purchases` | Achat |
| `operations/espaces.html#E4` | `operations/procurement.html#evacuations` | Expédition |
| `operations/espaces.html#E5` | `operations/field-buying.html#overview` | Pilotage |
| `operations/field-buying.html#farmers` | Même URL, menu AFLP partagé | Producteurs |
| `operations/field-buying.html#cash` | Même URL, menu AFLP partagé | Comptes RT |
| `operations/field-buying.html#bags` | Même URL, menu AFLP partagé | Sacherie |
| `operations/procurement.html#evacuations` | Même URL, menu AFLP partagé | Évacuation |
| `operations/reports.html` | Même URL, menu AFLP partagé | Reporting |
| `operations/aflp-data.html` | Même URL, menu AFLP partagé | Exports |
| `operations/campaigns.html` | Même URL, menu AFLP partagé | Campagnes |
| `operations/traceability.html` | Même URL, menu AFLP partagé | Traçabilité |

## Maquettes et test autonome

Prototype indépendant : `FBMS_V22_Prototype_Navigation_Unique.html`, produit dans la conversation (sans serveur ni données réelles). **28 assertions Playwright réussies** pour les largeurs 360/390/768/1366/1440 px, navigation en menu mobile, compte RT, bouton arrière/avant, rôles fictifs FIN et AUH. Captures ordinateur et smartphone produites. **Ces tests valident le prototype, pas les routes GitHub Pages intégrées**.

## Points ouverts avant le GO

**P0 – vérifier avant toute fusion :** navigation sur un vrai navigateur authentifié par rôle ; aucun lien d'action bloqué ; CSS compatible avec `workspace.js`; interruption/résume hors ligne ; régression des pages initiales sur Chrome Android ; cohérence des URLs GitHub Pages; aucune fuite de droits ; pas d'entrée dans les modules d'entrepôt après BEV.

**P1 – terminer l'unification :** intégrer proprement Fleet, Field Proof et l'administration avec le menu commun ou un mécanisme de retour cohérent sans affichage de deux navs; distinguer les actions « Nouvel achat » et « Achats à valider » dans le contrôleur métier; brancher « Ma journée » sur des données vraies, uniquement si les droits l'autorisent; améliorer les titres et les contrôles d'accessibilité.

**P2 – design premium :** compléter les icônes homogènes, les traductions FR/EN des parcours, les focus clavier, la hauteur des zones tactiles et les états d'erreur réseau.

### Recette d'acceptation

- [ ] Un seul menu principal visible à la fois sur tous les écrans AFLP concernés.
- [ ] Aucune étape galerie intermédiaire.
- [ ] Les liens profonds historiques redirigent vers le bon écran.
- [ ] Les 6 espaces ont une identité et une terminologie communes.
- [ ] Tests réels sur Android 360/390 px, tablette 768 px, ordinateur 1366/1440 px.
- [ ] Tests réels des rôles BM/UH/AUH/ZH/Finance et droits serveur.
- [ ] Continuité des opérations offline, sans perte ni nouvelle attribution à un autre compte.
- [ ] Régressions de Field Buying / Procurement / rapports / campagnes passent.
- [ ] Aucun écran « prochainement disponible » n'est qualifié de fonction opérationnelle.
- [ ] Le rapprochement BEV/GRN reste du côté du détenteur de données officiel.
- [ ] Plan de restauration testé.

**Statut au 13/11/2026 :** prototype UX testé ; migration des principales pages en branche ; **recette complète d'intégration et appareil réel non effectuée**, donc pas de fusion ni déploiement.

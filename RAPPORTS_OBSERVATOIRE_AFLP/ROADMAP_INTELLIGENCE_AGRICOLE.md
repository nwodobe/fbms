# Feuille de route : de l'observation fiable à l'aide à la prévision

Point de départ réel (22/11/2026) : 1 champ réel actif sur 28 prévus, 0 visite. Protocole à arbres désignés.

## Niveau 1 : observation fiable (campagne 2027, à partir de maintenant)

**Objectif** : séries hebdomadaires exactes et traçables sur les six clusters.

| Étape | Livrable | Critère de passage |
|---|---|---|
| 1.1 Installation | 28 champs actifs (plan déclaré) | ≥ 75 % installés dans chaque cluster |
| 1.2 Rythme | 1 visite validée par champ et par semaine | Couverture ≥ 75 % quatre semaines de suite |
| 1.3 Traçabilité | Générateur v1 chaque lundi, registre des décisions tenu | Chaque chiffre publié rapproché de ses visites et validations (empreinte d'instantané, manifeste) |
| 1.4 Qualité | Photos, arbres retrouvés, délais de synchronisation | < 5 % d'arbres non retrouvés ; < 10 % de visites reçues après 48 h |
| 1.5 Corrections SQL | Vues dédoublonnées par champ et semaine (voir proposition) | Sur décision du Branch Manager, recette sur projet de test |

**Mesure de réussite** : pour toute valeur du rapport, on retrouve les visites, observations, validateurs et dates d'origine.

## Niveau 2 : alerte et anticipation (fin de campagne 2027)

**Objectif** : détecter les évolutions précoces et proposer des actions de préparation, sans automatisme de dépense.

- Facteurs explicatifs à ajouter **seulement s'ils sont fiables et sourcés** : pluviométrie observée (station ou pluviomètre
  à relever au village), météo de sources publiques datées, historique de maturation par village, accessibilité des pistes,
  calendrier d'achat réel (FBMS jusqu'au BEV), informations de marché de l'« Intelligence marché AFLP » tenues séparées.
- Règles d'alerte versionnées, chacune avec son taux de fausses alertes mesuré a posteriori.
- Toute relation est étiquetée : **corrélation** (observée), **hypothèse** (à tester), **causalité démontrée** (protocole dédié). Par défaut : corrélation.
- Préalable statistique : si la Direction veut des pourcentages valables pour un cluster, passer à un protocole
  d'échantillonnage probabiliste documenté (tirage des villages, champs, blocs, arbres, probabilités d'inclusion
  enregistrées). Le schéma de FBMS le permet déjà (`mode_selection = TIRAGE`, `pi_village`, `pi_champ`, `proba_inclusion`).

## Niveau 3 : aide à la prévision des volumes (au plus tôt après deux campagnes complètes)

**Objectif** : explorer des prévisions de disponibilité de RCN.

Avant tout modèle, documenter :

1. Représentativité de l'échantillon (protocole probabiliste en place sur au moins une campagne).
2. Surfaces productives réellement établies (cartographie des parcelles FBMS vérifiée terrain, pas les parcelles provisoires).
3. Rendements observés et vérifiés historiquement (pesées, pas déclarations).
4. Récoltes et quantités commercialisées (achats FBMS, données PJS en lecture autorisée).
5. Facteurs climatiques et leurs sources.
6. Précision des prévisions testée sur des périodes indépendantes (validation hors échantillon).
7. Intervalles d'incertitude publiés avec chaque chiffre.

**Interdit à tous les niveaux** : présenter un tonnage comme « prévision ANAGROCI » sans validation méthodologique ;
convertir un pourcentage d'arbres fleuris en tonnage.

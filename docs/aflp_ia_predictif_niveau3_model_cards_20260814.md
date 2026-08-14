# AFLP Niveau 3 — Fiches de modèle (*model cards*)

> Programme : **ANAGROCI FieldLink Programme (AFLP) 2027**
> Version du moteur : `3.0.0` · variables `vars-1.0.0` · date : 2026-08-14
> Statut de tous les modèles : **`NOT_READY` ou `SHADOW_ONLY`** — aucun en production

---

## Avertissement commun aux six fiches

Aucun de ces « modèles » n'est un modèle appris. Ce sont des **statistiques
déterministes** : à données identiques, la sortie est identique, et tout calcul
est reproductible à la main. Le mot « modèle » est employé parce que c'est le
terme du cadrage et celui du registre, pas parce qu'un apprentissage a eu lieu.

**Les métriques ci-dessous ont été mesurées sur un jeu FICTIF** de 120 jours ×
4 villages × 4 équipes (384 achats), reproductible par
`.github/agent-tests/aflp-ia-predictif.mjs`. Elles démontrent que la chaîne de
validation fonctionne. **Elles ne valident rien sur le plan métier** : une
métrique obtenue sur données synthétiques n'est pas une preuve de performance
terrain, et le cadrage l'interdit explicitement.

---

## Fiche 1 — Prévision des volumes par village

| Rubrique | Contenu |
|---|---|
| **Clé** | `volumes` · **Maturité** : R2 · **Statut** : `SHADOW_ONLY` |
| **Question** | Quel volume peut être acheté dans les 1, 7 et 30 prochains jours ? |
| **Cible** | Somme de `achats.poids_net` par jour et par entité, calendrier complet (zéros compris) |
| **Entités** | Programme, cluster, village |
| **Méthodes en lice** | Naïf (dernière fenêtre) · Moyenne mobile 7 j · Médiane mobile 7 j · Moyenne mobile 28 j |
| **Sélection** | Plus petit WAPE en validation à origine glissante. À moins de 5 % d'écart relatif, **la méthode la plus simple l'emporte**. |
| **Validation** | Origines glissantes, espacées de `h`, cibles non chevauchantes, apprentissage tronqué à l'origine |
| **Métrique principale** | **WAPE** — retenu plutôt que MAPE parce que la demande est intermittente : un jour à zéro fait exploser un MAPE |
| **Intervalle** | Quantiles empiriques 10 % / 90 % des résidus relatifs du backtest → intervalle à 80 %. **Absent** si moins de 10 résidus. |

### Résultats mesurés (jeu fictif, 2026-08-14)

| Horizon | Plis | Naïf | Moy. 7 j | Méd. 7 j | Moy. 28 j | Retenue | Prévision | Intervalle 80 % | Confiance |
|---:|---:|---:|---:|---:|---:|---|---:|---|---|
| 1 j | 12 | **55,2 %** | 65,4 % | 64,6 % | 64,8 % | naïf | 3,2 MT | *indisponible* | faible |
| 7 j | 12 | 14,2 % | 14,2 % | 24,0 % | **10,5 %** | moy. 28 j | 17,2 MT | 15,2 – 20,5 MT | **bonne** |
| 30 j | 3 | 5,4 % | **4,3 %** | 21,0 % | 7,0 % | moy. 7 j | 78,2 MT | *indisponible* | faible |

Par cluster, horizon 7 jours : Brobo 6,91 MT (WAPE 12,8 %) · Botro 5,69 MT
(13,7 %) · Diabo 4,55 MT (15,0 %) — tous en moyenne mobile 28 jours,
confiance bonne.

### Ce que ces chiffres disent — et ne disent pas

- **L'horizon 7 jours est le seul exploitable.** La moyenne 28 jours y bat le
  naïf de 26 % en relatif : l'écart dépasse largement les 5 % qui justifient de
  quitter la méthode la plus simple.
- **L'horizon 1 jour est mauvais** (WAPE 55 %) et l'interface le marque comme
  tel. Un volume journalier villageois est trop irrégulier pour être prédit à
  un jour ; il faut le lire comme une fourchette, pas comme un chiffre.
- **L'horizon 30 jours n'a que 3 plis** — en dessous du minimum de 4. Son WAPE
  de 4,3 % est flatteur mais repose sur trois observations : la confiance est
  déclarée faible, et l'intervalle n'est pas produit.
- **Aucun de ces chiffres ne vaut validation métier.** Ils portent sur des
  données fabriquées, régulières par construction. Le terrain ne l'est pas.

### Limites

Une seule campagne (aucune saisonnalité possible) · dates fournies par le client
(N1-08) · les trois niveaux d'agrégation sont prévus séparément, l'écart de
cohérence est **mesuré et affiché**, jamais corrigé en silence · un village de
moins de 14 jours d'historique ne reçoit **aucune** prévision, avec repli
documenté sur le cluster.

---

## Fiche 2 — Estimation du besoin de fonds

| Rubrique | Contenu |
|---|---|
| **Clé** | `fonds` · **Maturité** : R1 · **Statut** : `SHADOW_ONLY` |
| **Question** | De combien de trésorerie aura-t-on **besoin** dans les 7 prochains jours ? |
| **Méthode** | `volume prévu × (prix moyen observé + commission moyenne observée)`, dérivé du cas 1 |
| **Scénarios** | Bas / central / haut, repris des bornes de l'intervalle du cas 1, plus une marge de sécurité configurable (10 % par défaut) |
| **Garde-fous** | **G01** autoriser une avance · **G02** modifier un plafond · **G03** déclencher un transfert Wave |

### Résultats mesurés (jeu fictif)

| Grandeur | Valeur |
|---|---:|
| Besoin central à 7 jours | 6 002 675 F |
| Scénario bas / haut | 5 317 490 F / 7 178 940 F |
| Exposition ouverte à la date de référence | 130 167 300 F |
| **Montant non finançable** (cycles non réconciliés) | **57 094 880 F** |
| Durée de cycle médiane observée | 5 jours |

### Le point qui compte

Le montant non finançable **n'est pas déduit** du besoin : ce sont deux
grandeurs distinctes. Le besoin dit ce qu'il faudrait ; le montant non finançable
dit ce qui reste bloqué **quelle que soit** l'estimation. La règle AFLP prime en
toute circonstance, et les plafonds validés priment sur la prévision.

### Limites explicitement portées dans la sortie

Les **frais de paiement Wave ne sont pas au schéma** : ils ne sont pas inclus ·
la liquidité disponible et le rythme de refinancement ne sont pas au schéma ·
le **pic d'exposition ouverte historique n'est pas calculable** (il exigerait la
série quotidienne des soldes RT, que les réconciliations ne datent pas assez
finement) — et c'est pourtant le pic, non l'enveloppe, qui dimensionne la
trésorerie · le prix employé est le prix **observé**, aucun prix ANAGROCI ni prix
marché n'existe au schéma.

---

## Fiche 3 — Scorecard des équipes RT

| Rubrique | Contenu |
|---|---|
| **Clé** | `scorecardRt` · **Maturité** : R1 · **Statut** : `SHADOW_ONLY` |
| **Nature** | **Descriptive, pas prédictive.** Elle ne prédit rien et ne classe personne. |
| **Score composite** | **Aucun par défaut** — et c'est un choix, pas un manque |
| **Garde-fous** | **G09** sanctionner une équipe · **G10** qualifier quelqu'un de fraudeur |

### Les huit dimensions, séparées

| Dimension | Mesure | Source |
|---|---|---|
| Performance de volume | Volume ÷ médiane des équipes (1,00 = médiane) | `achats.poids_net` |
| Discipline de réconciliation | Règle AFLP : réconciliation valide **et** postérieure à la dernière avance | `reconciliations`, `avances` |
| Qualité des données saisies | Part d'achats portant un reçu | `achats.numero_recu` |
| Respect des délais | Délai médian avance → réconciliation | `avances.date`, `reconciliations.date` |
| Cohérence cash — stock — sacs | Solde de caisse et solde de sacs négatifs | 3 tables |
| Qualité du produit | Humidité et KOR médians | `achats.humidite`, `achats.kor` |
| Stabilité opérationnelle | Coefficient de variation du volume journalier | série complète |
| Incidents validés | **VIDE — inconnue, pas nulle** | *(aucune table)* |

### Pourquoi aucun score unique

Un chiffre unique confondrait trois causes qui appellent trois traitements
différents : **mauvaise performance**, **mauvaise qualité de données** et
**comportement inhabituel**. Une équipe en zone à faible réseau remonte tard :
elle paraît sous-performante alors qu'elle a un problème de couverture. Les
agréger produirait une injustice difficile à défaire.

Si un composite est créé un jour, ses pondérations devront être configurables,
explicables, versionnées et approuvées par la gouvernance AFLP.

### Équité

- Une équipe sous 8 achats est marquée **« données insuffisantes »** et sa
  confiance statistique passe à *faible*. Elle n'est pas mal notée pour cause de
  faible échantillon.
- La dimension « incidents » est **vide, pas à zéro** : la distinction est
  portée par le code (`score: null`, `confiance: "nulle"`).
- **Audit de biais par cluster** : calculé (nombre d'équipes, volume médian, part
  à données insuffisantes).
- **Audit par ancienneté : impossible** — aucune date d'entrée d'équipe au
  schéma. Déclaré, pas simulé.
- **Biais réseau : signalé, non mesurable** — sans identifiant d'appareil ni
  horodatage de synchronisation par équipe.
- Chaque fiche rappelle le **droit de contester** une donnée, via le workflow
  FBMS autorisé.

---

## Fiche 4 — Comportements inhabituels

| Rubrique | Contenu |
|---|---|
| **Clé** | `signaux` · **Maturité** : R1 · **Statut** : `SHADOW_ONLY` |
| **Vocabulaire imposé** | « **signal à examiner** ». Jamais « fraude », jamais « anomalie prouvée », jamais un nom désigné comme responsable. |
| **Architecture** | Hybride : règles déterministes + statistiques robustes. **Pas de détection non supervisée** — les données ne le permettent pas. |
| **Garde-fous** | **G09**, **G10** |

### Les six signaux implémentés

| Code | Déclencheur | Norme de comparaison |
|---|---|---|
| `SIG-POIDS-01` | Part inhabituelle de poids multiples de 5 kg | z modifié > 3,5 sur la distribution inter-équipes |
| `SIG-CONC-01` | Concentration du volume sur peu de producteurs | HHI > 0,40 |
| `SIG-VOL-01` | Volume du jour éloigné de la norme du village | z modifié > 3,5 sur les jours actifs |
| `SIG-RYTH-01` | Arrêt complet de la saisie | 0 jour actif sur 7, après ≥ 4 |
| `SIG-TRAC-01` | Part inhabituelle d'achats sans reçu | z modifié > 3,5 inter-équipes |
| `SIG-SYNC-01` | Échecs de synchronisation en cours | 0 attendu |

### Résultat mesuré (jeu fictif) : **1 signal** — `SIG-CONC-01` sur RT-02

Un seul signal sur 384 achats et 4 équipes. C'est le comportement voulu :
**une multiplication d'alertes inutiles est un échec, pas une preuve
d'efficacité.** Le code surveille son propre volume et alerte au-delà de
20 signaux.

### Chaque signal porte obligatoirement

Observation · norme de comparaison · écart chiffré · **au moins deux explications
légitimes à écarter d'abord** · niveau de confiance · données manquantes ·
action humaine recommandée · rappel de ce que le signal **ne permet pas**.

Exemple : une part élevée de poids ronds propose d'abord *balance à graduation
grossière*, *sacs standardisés pesés par lot*, *arrondi de saisie sur téléphone*,
*pratique de pesée du village* — avant toute autre lecture.

### Faux positifs : suivis, pas mesurés

Le taux de faux positifs **ne peut pas être mesuré aujourd'hui** : aucun signal
n'a encore été confirmé ou infirmé par un humain. Le code le déclare
(`fauxPositifs.mesurables = false`) au lieu d'afficher un chiffre inventé. Il ne
deviendra mesurable qu'après une période d'observation où chaque signal est clos
par un statut humain.

---

## Fiche 5 — Prévision des évacuations

| Rubrique | Contenu |
|---|---|
| **Clé** | `evacuations` · **Maturité** : **R0** · **Statut** : **`NOT_READY`** |
| **Garde-fous** | **G12** créer une mission ou une commande de transport · **G14** sortir du stock |

### Aucun chiffre n'est produit, et ce n'est pas une question de temps

Au périmètre AFLP, **aucune table n'enregistre une sortie de stock**. Le stock
d'un cluster ne peut qu'être supposé égal au cumul acheté — faux dès la première
évacuation. Aucune clé ne relie `achats` à `rcn_receptions`.

### Ce qui existe malgré tout

Le calcul de saturation **est implémenté et testé** : date probable de
saturation, fenêtre recommandée, tonnage à évacuer, risque de rupture, risque de
stockage excessif. Il s'active dès qu'on lui fournit `capacites` et
`evacuations`. Un test dédié le vérifie sur données fournies.

Le **nombre de véhicules n'est volontairement pas calculé** : aucune capacité
utile de véhicule n'est au schéma. Le donner serait une invention.

### Prérequis

Voir `docs/aflp_ia_predictif_niveau3_donnees_20260814.md` §5 — EVAC-P0-1 à
EVAC-P1-3.

---

## Fiche 6 — Écarts de qualité

| Rubrique | Contenu |
|---|---|
| **Clé** | `qualite` · **Maturité** : R1 · **Statut** : `SHADOW_ONLY` |
| **Mesures** | `humidite`, `kor` |
| **Méthode** | z modifié (Iglewicz & Hoaglin, seuil 3,5) sur la médiane du village, **norme calculée en leave-one-out** |
| **Garde-fou** | **G05** valider une perte |

### La précaution qui fait la différence

La norme de comparaison **exclut le village évalué**. Comparer une mesure à une
moyenne qui la contient sous-estime mécaniquement l'écart : plus le village
dévie, plus il tire la référence vers lui. Sur 4 villages, un village aberrant
pèse 25 % de sa propre norme.

### Résultat mesuré (jeu fictif) : **1 écart**

Village Delta, humidité, **z modifié = 33,6** — écart construit volontairement
dans le jeu d'essai (14 % contre 8 % ailleurs) pour vérifier que la détection
fonctionne.

### Ce que la fiche impose de distinguer

Variation naturelle du lot · erreur de mesure (opérateur) · **dérive d'équipement
(humidimètre non étalonné)** · séchage insuffisant · conditions de stockage ·
perte de transport · anomalie à examiner.

L'action recommandée est toujours la même en premier : **faire vérifier
l'étalonnage de l'humidimètre** — c'est la cause la plus fréquente et la moins
coûteuse à écarter.

### Importance économique

Chiffrée **uniquement pour l'humidité** (perte de poids au séchage,
approximation linéaire), et annoncée comme approximation : la courbe réelle
n'est pas au schéma. Ce chiffre **ordonne les priorités, il ne chiffre pas une
perte**. Pour le KOR, aucune grille de réfaction n'existe : rien n'est chiffré.

### Limite décisive

**La comparaison village ↔ usine est indisponible** — aucune jointure entre
`achats` et `rcn_qualites`. Or c'est le seul écart qui porte une conséquence
économique directe. Ce qui est mesuré ici est un écart **entre villages**, utile
pour prioriser un contrôle, insuffisant pour arbitrer une réfaction.

---

## Registre et gouvernance

| Modèle | Maturité | Statut | Validations exigées avant `DECISION_SUPPORT` |
|---|:---:|---|---|
| `volumes` | R2 | `SHADOW_ONLY` | Branch Manager |
| `fonds` | R1 | `SHADOW_ONLY` | **Finance** + Branch Manager |
| `scorecardRt` | R1 | `SHADOW_ONLY` | **Gouvernance AFLP** + Branch Manager |
| `signaux` | R1 | `SHADOW_ONLY` | Branch Manager |
| `evacuations` | R0 | `NOT_READY` | **Logistics** + Branch Manager |
| `qualite` | R1 | `SHADOW_ONLY` | **Quality/Factory** + Branch Manager |

`AFLP_PRED.promouvoir(cle, validations)` refuse toute promotion sans validations
**nominatives** et sans preuve de performance supérieure à la baseline. La même
règle est portée par la contrainte `aflp_registry_promotion_validee` de la
migration : un modèle ne peut pas être promu par un `UPDATE` distrait.

**Interrupteur d'arrêt** : `AFLP_PRED.desactiver(cle, motif)` coupe un modèle
sans rien arrêter d'autre. Vérifié par test : désactiver un modèle n'en désactive
aucun autre, et le Niveau 2 ne dépend en rien du Niveau 3.

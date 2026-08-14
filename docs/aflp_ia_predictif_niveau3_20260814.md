# AFLP Niveau 3 — IA prédictive : rapport d'implémentation

> Programme : **ANAGROCI FieldLink Programme (AFLP) 2027**
> Destinataire : Monsieur KOUASSI, Branch Manager
> Date : 2026-08-14 · Moteur `3.0.0` · Branche `claude/aflp-predictive-ai-level3-0axnmk`
> Statut : **SHADOW_ONLY** — aucun modèle en production, aucune décision automatisée

---

## 1. Verdict général

**La couche prédictive est construite, testée et branchée. Elle ne doit pas
servir à décider, et le code l'en empêche techniquement.**

Trois constats commandent tout le reste :

1. **La porte du Niveau 1 n'est pas franchie.** Huit prérequis P0 restent
   ouverts, dont quatre qui touchent au cœur de toute prévision : les dates sont
   fournies par le client, aucune colonne `campagne` n'existe, les transactions
   validées restent modifiables sans trace, et la chaîne village → lot → usine
   est rompue. Ces constats viennent de la lecture de `supabase/*.sql`, pas d'une
   impression.

2. **Un cas d'usage sur six est impossible, et le temps n'y changera rien.** La
   prévision des évacuations est R0 parce qu'**aucune table n'enregistre une
   sortie de stock**. Attendre six mois de données supplémentaires ne débloquera
   pas ce point : il faut un chantier de schéma.

3. **Ce qui a été livré est du code exécuté, pas une architecture décrite.**
   525 assertions passent, la migration SQL a réellement tourné sur PostgreSQL
   16.13 contre le schéma FBMS, 11 tentatives d'écriture interdites ont été
   effectivement bloquées, et le Command Center a été ouvert dans Chromium aux
   trois largeurs.

**Recommandation : `GO SHADOW` sous réserves** — détaillée au §17.

---

## 2 & 3. Notes

| | Note technique | Maturité prédictive |
|---|---|---|
| **Première implémentation** | **7,45 / 10** | R0 à R2 selon le cas d'usage |
| **Après cycle d'amélioration** | **8,15 / 10** | inchangée — elle ne dépend pas du code |

Le détail est au §16. **Les deux notes sont volontairement séparées**, comme le
demande le cadrage : la qualité de l'architecture ne rachète pas l'immaturité
des données, et l'immaturité des données ne condamne pas l'architecture.

**Pourquoi 9/10 n'est pas atteignable aujourd'hui, sans manipuler la note :**
trois domaines sur neuf (évacuations, qualité, besoin de fonds) sont plafonnés
par des données qui n'existent pas au schéma. Un point ne peut pas être accordé
pour une fonctionnalité qui ne peut pas fonctionner.

---

## 4. Maturité R0-R3 des six cas d'usage

| Cas d'usage | Niveau | Statut du modèle | Ce qui plafonne |
|---|:---:|---|---|
| 1 · Prévision des volumes par village | **R2** | `SHADOW_ONLY` | Une seule campagne ; dates client |
| 2 · Estimation du besoin de fonds | **R1** | `SHADOW_ONLY` | Durée de cycle mal estimée ; frais Wave absents |
| 3 · Scorecard des équipes RT | **R1** | `SHADOW_ONLY` | < 10 équipes actives ; pas d'incidents ni d'ancienneté |
| 4 · Comportements inhabituels | **R1** | `SHADOW_ONLY` | Aucun signal encore clos par un humain |
| 5 · Prévision des évacuations | **R0** | **`NOT_READY`** | **Aucune table d'évacuation** |
| 6 · Écarts de qualité | **R1** | `SHADOW_ONLY` | Aucune jointure vers l'usine ; aucune qualité cible |

Détail complet et mesures : `docs/aflp_ia_predictif_niveau3_donnees_20260814.md`.

---

## 5. Comparaison baseline / modèles

**Il n'y a aucun modèle appris à comparer.** Ce sont quatre baselines mises en
concurrence, sur une validation temporelle identique. C'est exactement le niveau
que les données autorisent — et le cadrage impose de ne pas aller au-delà sans
gain démontré.

Mesures sur jeu **fictif** de 120 jours × 4 villages (384 achats), reproductible
par le harnais de test :

| Horizon | Plis | Naïf | Moy. 7 j | Méd. 7 j | Moy. 28 j | Retenue | Gain vs meilleure autre |
|---:|---:|---:|---:|---:|---:|---|---|
| 1 j | 12 | **55,2 %** | 65,4 % | 64,6 % | 64,8 % | naïf | +17 % relatif |
| 7 j | 12 | 14,2 % | 14,2 % | 24,0 % | **10,5 %** | moy. 28 j | **+26 % relatif** |
| 30 j | 3 | 5,4 % | **4,3 %** | 21,0 % | 7,0 % | moy. 7 j | +20 %, mais **3 plis seulement** |

**Règle appliquée** : à moins de 5 % d'écart relatif, la méthode la plus simple
l'emporte. La moyenne 28 jours ne gagne à 7 jours que parce qu'elle bat le naïf
de 26 % — largement au-dessus du seuil.

**Lecture honnête** : seul l'horizon 7 jours est exploitable. L'horizon 1 jour a
un WAPE de 55 % et l'interface le marque « trop incertain ». L'horizon 30 jours
n'a que 3 plis, sous le minimum de 4 : sa confiance est déclarée faible et aucun
intervalle n'est produit.

---

## 6. Métriques obtenues

| Métrique | Valeur (h = 7 j, programme) | Pourquoi celle-ci |
|---|---|---|
| **WAPE** | 10,5 % | Retenu plutôt que MAPE : la demande est intermittente, un jour à zéro fait exploser un MAPE |
| MAE | mesuré par pli | Erreur en unité métier (kg) |
| RMSE | mesuré par pli | Sensible aux grands écarts |
| Biais moyen | +67 kg | Détecte une sur- ou sous-estimation systématique |
| **Couverture de l'intervalle** | **67 % pour 80 % annoncés**, ±11 points | Ajoutée au cycle d'amélioration — sans elle, l'intervalle était une affirmation invérifiée |
| Plis de backtest | 12 | Origines glissantes, cibles non chevauchantes |

**Le point le plus important de ce tableau** est la couverture. Elle est
inférieure de 13 points au niveau annoncé, mais l'erreur type sur 12 plis est de
±11 points : **l'écart n'est pas significatif**. Le module le dit littéralement —
« cette mesure ne CONFIRME pas la couverture, elle constate seulement qu'on ne
peut pas la réfuter avec si peu de plis ». C'est la formulation exacte que
mérite ce niveau de preuve.

---

## 7. Architecture mise en place

**Statistiques déterministes calculées dans le navigateur, sur les données déjà
chargées sous RLS.** Aucun modèle entraîné, aucun poids embarqué, aucune
dépendance, aucun appel réseau, aucune clé.

Trois architectures ont été comparées (sécurité, coût, complexité, maintenance,
latence, panne, retour arrière, compatibilité GitHub Pages / Supabase, hors
ligne) : calcul en PostgreSQL, pipeline batch, service séparé.
**ADR complète : `docs/aflp_ia_predictif_niveau3_adr_20260814.md`.**

Sur l'instruction « ne pas intégrer le modèle dans le navigateur » : elle vise
l'embarquement d'un **artefact appris** dans une page publique. Rien de tel n'est
fait — ce qui est calculé, ce sont des médianes mobiles et des quantiles qu'un
relecteur refait sur un tableur. Le jour où un modèle appris sera justifié, il
devra passer par le pipeline batch, et le contrat de sortie est déjà aligné
colonne pour colonne sur la table `aflp_predictions`.

---

## 8. Fichiers et migrations

### Créés

| Fichier | Rôle | Lignes |
|---|---|---:|
| `shared/aflp-ia-predictif.js` | Moteur : diagnostic, baselines, backtest, 6 cas d'usage, garde-fous, interrupteur d'arrêt | ~1 720 |
| `shared/aflp-ia-predictif-ui.js` | Interface : 8 onglets dans le Command Center. Ne calcule rien. | ~700 |
| `.github/agent-tests/aflp-ia-predictif.mjs` | 525 assertions | ~840 |
| `docs/migrations/aflp_predictions_20260814.sql` | Schéma des prédictions, RLS, rôle technique | ~370 |
| `docs/migrations/aflp_predictions_verify_20260814.sql` | 9 blocs de contrôle **exécutés** | ~300 |
| `docs/migrations/aflp_predictions_garde_fous_20260814.sql` | Preuve exécutable : 11 tentatives d'écriture interdites | ~60 |
| `docs/migrations/aflp_predictions_rollback_20260814.sql` | Retour arrière **exécuté** | ~110 |
| `docs/aflp_ia_predictif_niveau3_donnees_20260814.md` | Audit de maturité, matrice R0-R3, dictionnaire, fuite, fiche de jeu de données | — |
| `docs/aflp_ia_predictif_niveau3_adr_20260814.md` | ADR AFLP-003 | — |
| `docs/aflp_ia_predictif_niveau3_model_cards_20260814.md` | 6 fiches de modèle | — |
| `docs/aflp_ia_predictif_niveau3_exploitation_20260814.md` | Politique d'usage, shadow, surveillance, désactivation, réentraînement, déploiement | — |
| `docs/aflp_ia_predictif_niveau3_20260814.md` | Ce rapport | — |

### Modifié

`terrain/command.html` — 5 ancres : deux `<script>`, une `<section id="aflpPred">`,
deux appels `AFLP_PRED_UI`, et **l'ajout de 9 colonnes à la requête `achats`**
(`prix_kg`, `humidite`, `kor`, `producteur_id`, `producteur_nom`, `rejet`,
`nb_sacs`, `poids_brut`, `tare`). Sans elles, les cas 4 et 6 seraient tombés à R0
**faute de requête et non faute de donnée** — la distinction change le diagnostic
présenté à la Direction.

### Aucune migration appliquée en production

`supabase/**` n'a **pas** été touché. La migration est une proposition, déposée
là où les propositions SQL du dépôt vivent déjà (`docs/migrations/`).

---

## 9. Tests exécutés

| Contrôle | Résultat |
|---|---|
| `node .github/agent-tests/aflp-ia-predictif.mjs` | **OK — 525 assertions** |
| `node .github/agent-tests/aflp-ia-assistant.mjs` (Niveau 2) | **OK** — aucune régression |
| `node .github/agent-tests/politique-chemins.mjs` | **35/35 cas conformes** |
| `node .github/agent-tests/sacherie-pilotage.mjs` | **OK** |
| `node .github/scripts/verifier-js.mjs` | 51 fichiers · 1 erreur héritée (`alis-hardening.js`) · **0 nouvelle** |
| `node .github/scripts/verifier-html.mjs` | 19 pages · 3 écarts historiques · **0 nouveau** |
| `node .github/scripts/verifier-liens.mjs` | 19 pages · 4 liens cassés hérités · **0 nouveau** |
| **Migration sur PostgreSQL 16.13** (schéma FBMS réel) | **9 blocs — CONTRÔLES OK** |
| **Tentatives d'écriture interdites** | **11 bloquées / 0 passée** |
| **Retour arrière SQL** | **Complet — tables opérationnelles intactes** |
| **Chromium, 390 × 844 / 768 × 1024 / 1440 × 900** | 8 onglets parcourus · 0 erreur console · 0 exception |

**Aucune ligne n'a été ajoutée à un référentiel (`*-baseline.json`).**

### Les douze scénarios obligatoires

| # | Scénario | Résultat |
|---|---|---|
| SC-01 | Données insuffisantes → `NOT_READY` | ✅ 6 jours d'historique → R0, aucune valeur, refus motivé |
| SC-02 | Modèle non supérieur à la baseline → baseline maintenue | ✅ écart < 5 % → la méthode la plus simple gagne |
| SC-03 | Données en retard → confiance réduite | ✅ 6 jours de retard → confiance dégradée d'un cran, motif nommant le retard |
| SC-04 | Prédiction très incertaine → avertissement | ✅ WAPE > 35 % → marquée incertaine et listée à part |
| SC-05 | Modèle indisponible → FBMS normal | ✅ modèle coupé, les 5 autres tournent, Niveau 2 intact |
| SC-06 | Écriture dans une table financière → refus | ✅ 16 refus en JS **+ 11 tentatives SQL réelles bloquées** |
| SC-07 | Utilisateur non autorisé → accès refusé | ✅ RLS forcée, aucune politique INSERT applicative, contrôlé en base |
| SC-08 | Dérive importante → modèle désactivable | ✅ chute de 75 % détectée, coupure et réactivation vérifiées |
| SC-09 | Nouveau village → repli contrôlé | ✅ 3 jours d'historique → aucune prévision, repli cluster documenté |
| SC-10 | Comportement inhabituel → alerte, jamais sanction | ✅ vocabulaire, explications légitimes, interdit rappelé |
| SC-11 | Écart qualité → investigation, jamais perte validée | ✅ causes séparées, aucun responsable désigné |
| SC-12 | Recommandation de fonds → aucune avance créée | ✅ 3 scénarios, garde-fous G01-G03, blocages maintenus |

### Vérification navigateur — observations citables

| Largeur | Constat |
|---|---|
| 390 × 844 | 8 onglets sur plusieurs lignes, hauteur tactile mesurée **44 px**. Parcours complet des 8 onglets, aucun en panne. |
| 768 × 1024 | Deux colonnes de blocs. **0 px de débordement.** |
| 1440 × 900 | Trois à quatre colonnes. Extrait relevé : *« Ensemble du pilote — 7 jours · Valeur prévue 17,2 MT · Intervalle 15,2 – 20,5 MT · WAPE 10,5 % · Plis 12 · Couverture 67 % »*. |

**Débordement horizontal de 10 px à 390 px** : mesuré **avec et sans** le panneau
du Niveau 3 → **10 px dans les deux cas**. Il provient de `table.aflp-t`
(Niveau 2) et du bouton de la barre suite. **Il est hérité, pas introduit ici** —
mais il contredit l'affirmation « 0 débordement » du rapport du Niveau 2, et
mérite une correction dans une pull request dédiée.

Aucune donnée réelle n'a été employée : ni nom de producteur, ni numéro de
téléphone, ni montant réel, ni coordonnée GPS de parcelle.

---

## 10. Contrôles empêchant l'IA de décider seule

Ces contrôles sont **techniques**. Ils ne reposent pas sur un avertissement écrit.

| Niveau | Contrôle | Preuve |
|---|---|---|
| **Code** | Le moteur n'expose aucune fonction d'écriture | Recherche sur le code débarrassé de ses commentaires et chaînes : aucun `fetch(`, `.insert(`, `.update(`, `.delete(`, `.rpc(`, `createClient`, `document.`, `localStorage` |
| **Code** | `executer()` refuse toute action, y compris avec `force: true` | 16 tentatives, 16 refus journalisés |
| **Code** | 14 garde-fous nommés `G01`–`G14` | Vérifiés un par un |
| **Base** | Rôle `aflp_model` sans aucune écriture sur les tables de faits | `GRANT` restreints **+** `REVOKE` explicites, contrôlés par `has_table_privilege` |
| **Base** | **11 tentatives d'écriture réelles bloquées** | Créer/modifier/supprimer un achat, créer/modifier une avance, forcer une réconciliation, sortir du stock, modifier un rôle, modifier un plafond, se promouvoir, simuler une revue humaine |
| **Base** | Prédictions en écriture unique | Déclencheur `BEFORE UPDATE OR DELETE` — s'applique même au propriétaire |
| **Base** | Aucune prédiction rétrospective | Contrainte `aflp_pred_pas_de_fuite` |
| **Base** | Promotion impossible sans validation nominative | Contrainte `aflp_registry_promotion_validee` |
| **Base** | RLS **forcée** | Sinon le propriétaire contourne toutes les politiques |
| **Interface** | Aucun bouton d'action | Recherche textuelle des intitulés interdits : 0, y compris dans les commentaires |
| **Interface** | Verbes de **processus** uniquement | « transmis à Finance », jamais « autorisé » |
| **Interface** | Décision nominative et motivée obligatoire | Nom et motif refusés s'ils sont vides |
| **Gouvernance** | Validations nominatives par rôle métier | Finance / Logistics / Quality / Gouvernance AFLP / BM |

---

## 11 & 12. Modèles activables en shadow, et modèles non prêts

**Activables en `SHADOW_ONLY` dès aujourd'hui :** volumes, besoin de fonds,
scorecard RT, comportements inhabituels, écarts de qualité.

**Non prêt (`NOT_READY`) :** prévision des évacuations. Le calcul est implémenté
et testé ; il ne lui manque que des données qui n'existent pas.

> **Réserve capitale** : le mode shadow suppose d'**enregistrer** les prédictions
> pour les comparer au réel. Aujourd'hui elles sont recalculées à chaque
> affichage et **ne sont pas persistées**. **Tant que la migration n'est pas
> appliquée, le mode shadow n'a pas commencé** — il est seulement possible.

---

## 13. Angles morts identifiés

### Corrigés pendant le cycle d'amélioration

| # | Angle mort | Priorité | Correction |
|---|---|:---:|---|
| A-01 | **La RLS forcée empêchait le rôle technique d'écrire ses propres prédictions.** Le pipeline batch de l'ADR aurait été muet. Invisible à la lecture ; trouvé en exécutant réellement la migration. | **P0** | Politique `INSERT` réservée à `aflp_model` sur les 3 tables + **contrôle positif** ajouté au script de vérification |
| A-02 | L'intervalle à 80 % était publié **sans que sa couverture soit jamais mesurée** — une affirmation invérifiée | **P0** | Couverture mesurée en laissant de côté le pli évalué, avec son erreur type ; affichée dans l'interface et dans le résumé |
| A-03 | `besoinSupplementaireTheorique` était une copie du besoin total : il ne déduisait pas le cash déjà en circulation, donc demandait deux fois les mêmes fonds | **P0** | Déduction de l'exposition ouverte, avec réserve explicite sur l'agrégation |
| A-04 | Le script de vérification ne contrôlait que des **interdits** — un dispositif interdisant tout l'aurait passé | **P0** | Bloc 8, contrôle positif : le rôle doit pouvoir lire et écrire dans son périmètre |
| A-05 | Le test d'innocuité échouait sur le mot « Supabase » présent dans un **commentaire** | P1 | Recherche sur le code seul, commentaires et chaînes retirés, avec contrôle croisé du découpage |

### Ouverts

| # | Angle mort | Priorité | Pourquoi non traité |
|---|---|:---:|---|
| B-01 | **Le mode shadow n'a pas commencé** | **P0** | Exige d'appliquer la migration — décision humaine |
| B-02 | Aucune métrique sur **données réelles** | **P0** | Exige le mode shadow |
| B-03 | Seuil de dérive ±30 % non justifié statistiquement | P1 | Exige une campagne complète d'observation. **Déclaré dans le code** (`reserveSeuil`) |
| B-04 | Seuil HHI 0,40 issu d'une lecture métier, pas d'une distribution observée | P1 | Idem |
| B-05 | Taux de faux positifs non mesurable | P1 | Exige des signaux clos par un humain |
| B-06 | Audit de biais par ancienneté impossible | P1 | Aucune date d'entrée d'équipe au schéma |
| B-07 | Débordement de 10 px à 390 px | P2 | **Hérité du Niveau 2**, hors périmètre. À traiter dans une PR dédiée |
| B-08 | Cohérence d'agrégation mesurée mais non réconciliée | P2 | Une réconciliation hiérarchique exige d'abord R2 sur données réelles |

---

## 14. Risques résiduels

| Risque | Gravité | Ce qui le limite aujourd'hui |
|---|:---:|---|
| **Un chiffre `SHADOW_ONLY` cité en réunion comme un engagement** | **Élevée** | Mention obligatoire en tête de chaque écran, statut affiché dans chaque cas d'usage, résumé exporté qui reprend la mention. **Ne supprime pas le risque humain.** |
| **Dates fournies par le client (N1-08)** | **Élevée** | Aucun contrôle possible. Une saisie antidatée décale la série sans alerte. |
| Un achat validé modifié après coup (N1-04) | Élevée | Aucun. Une erreur mesurée n'est pas opposable si la cible a bougé. |
| Signal inhabituel interprété comme une accusation | Moyenne | Vocabulaire imposé, explications légitimes obligatoires, interdit rappelé |
| Village à faible réseau jugé sous-performant | Moyenne | Biais signalé, mais **non mesurable** faute d'identifiant d'appareil |
| Prévision de fonds prise pour une demande | Moyenne | Trois scénarios, garde-fous rappelés, montant bloqué affiché à côté |
| Une équipe peu active mal notée | Faible | Marquée « données insuffisantes », confiance abaissée |

---

## 15. Décisions métier nécessaires

| # | Décision | Qui | Bloque |
|---|---|---|---|
| D-1 | Appliquer ou non la migration des prédictions | Branch Manager | **Tout le mode shadow** |
| D-2 | Ouvrir le chantier « dates serveur » (N1-08) | Branch Manager + technique | La fiabilité de **toute** prévision |
| D-3 | Ajouter une colonne `campagne` (N1-13) | Branch Manager | Toute saisonnalité, pour toujours |
| D-4 | Clôturer les transactions validées (N1-04) | Branch Manager | L'opposabilité de toute mesure d'erreur |
| D-5 | Créer la table d'évacuation et la clé de jointure vers l'usine | Logistics + technique | Les cas 5 **et** 6 |
| D-6 | Arrêter la **qualité cible** (humidité, KOR) | Quality / Factory | Le sens métier du cas 6 |
| D-7 | Confirmer la marge de sécurité de 10 % | Finance | Le chiffrage du cas 2 |
| D-8 | Confirmer la tolérance d'écart de réconciliation à 0 F | Branch Manager | *(héritée du Niveau 2)* |

---

## 16. Auto-évaluation

### 16.1 Première implémentation — 7,45 / 10

| Domaine | Points | Note 1 |
|---|---:|---:|
| Maturité, qualité des données et prévention des fuites | 1,25 | 1,15 |
| Architecture, sécurité et séparation décisionnelle | 1,25 | 1,00 |
| Prévision des volumes | 1,00 | 0,75 |
| Estimation du besoin de fonds | 1,00 | 0,75 |
| Scorecard RT, explicabilité et équité | 1,00 | 0,80 |
| Détection des comportements inhabituels | 1,00 | 0,80 |
| Prévision des évacuations | 1,00 | 0,35 |
| Identification des écarts de qualité | 1,00 | 0,60 |
| Validation, shadow, surveillance, tests, documentation | 1,50 | 1,25 |
| **Total** | **10,00** | **7,45** |

### 16.2 Après le cycle d'amélioration — 8,15 / 10

| Domaine | Note 2 | Ce qui a changé |
|---|---:|---|
| Maturité et fuites | **1,15** | inchangé |
| Architecture et sécurité | **1,20** | Migration **exécutée** sur PostgreSQL 16.13, 11 tentatives d'écriture réellement bloquées, retour arrière exécuté, défaut A-01 corrigé |
| Volumes | **0,85** | Couverture de l'intervalle mesurée avec son incertitude |
| Besoin de fonds | **0,85** | Besoin supplémentaire réellement calculé (A-03) |
| Scorecard RT | **0,80** | inchangé |
| Comportements inhabituels | **0,80** | inchangé |
| Évacuations | **0,35** | inchangé — **plafonné par l'absence de données** |
| Écarts de qualité | **0,60** | inchangé — **plafonné par l'absence de jointure usine** |
| Validation et documentation | **1,55 → plafonné à 1,50** | Contrôle positif SQL, script de preuve des garde-fous, +31 assertions |
| **Total** | **8,15** | |

### 16.3 Détail par domaine

**Maturité, données et fuites — 1,15 / 1,25**
*Preuves* : 13 prérequis N1 évalués par exécution ; matrice R0-R3 ; dictionnaire
des cibles ; 19 variables du cadrage déclarées absentes du schéma ; fuite
empêchée **à la construction** et vérifiée par test (ajouter des lignes futures
ne change rien à la prévision) ; norme leave-one-out sur le cas 6.
*Fichiers* : `shared/aflp-ia-predictif.js` §6-8, `…_donnees_20260814.md`.
*Limites* : mesures obtenues sur données fictives ; deux seuils non justifiés
statistiquement, déclarés comme tels.
*Risque résiduel* : N1-08 rend tout l'axe temporel incertain.

**Architecture, sécurité et séparation — 1,20 / 1,25**
*Preuves* : ADR comparant 4 architectures sur 9 critères ; **migration exécutée**
sur PostgreSQL 16.13 contre le schéma FBMS réel — 9 blocs passés ; **11 tentatives
d'écriture interdites réellement bloquées** ; retour arrière exécuté, tables
opérationnelles intactes ; moteur sans réseau, sans DOM, sans clé, sans écriture.
*Limites* : ces contrôles ont tourné sur une base **locale**, pas sur la
production ; le journal des décisions vit dans le navigateur, faute de table
déployée — c'est une interface **sans contrôle serveur**, et le cadrage refuse
d'en donner tous les points.

**Prévision des volumes — 0,85 / 1,00**
*Preuves* : 4 baselines, backtest à origine glissante 12 plis, WAPE/MAE/RMSE/biais
**et couverture**, intervalles empiriques, sélection favorisant la simplicité,
cohérence d'agrégation mesurée, repli documenté pour les villages neufs.
*Limites* : métriques sur données fictives ; horizon 30 jours sous le minimum de
plis ; aucune saisonnalité possible.

**Besoin de fonds — 0,85 / 1,00**
*Preuves* : 3 scénarios ordonnés, exposition ouverte, montant non finançable,
durée de cycle médiane, besoin **supplémentaire** net du cash en circulation,
5 facteurs explicatifs, 4 réserves, distinction enveloppe / pic.
*Limites* : frais Wave, liquidité et rythme de refinancement absents du schéma ;
**pic historique non calculable** — or c'est lui qui dimensionne la trésorerie.

**Scorecard RT — 0,80 / 1,00**
*Preuves* : 8 dimensions séparées, **aucun composite**, confiance statistique par
équipe, droit de contester, audit de biais par cluster.
*Limites* : dimension « incidents » vide ; audit par ancienneté impossible ;
biais réseau signalé mais non mesurable.

**Comportements inhabituels — 0,80 / 1,00**
*Preuves* : 6 signaux, règles + statistiques robustes (Iglewicz & Hoaglin),
observation / norme / écart / explications / confiance / manquants / action sur
chaque signal, garde-fou de saturation à 20.
*Limites* : taux de faux positifs **non mesurable**, et déclaré tel ; aucune
détection non supervisée ; pas d'identifiant d'appareil.

**Prévision des évacuations — 0,35 / 1,00**
*Preuves* : calcul de saturation implémenté **et testé** ; 6 prérequis chiffrés ;
refus explicite plutôt qu'un stock supposé.
*Limites* : **aucune sortie opérationnelle**. Les points ne peuvent pas être
accordés pour une fonctionnalité incompatible avec l'architecture réelle des
données.

**Écarts de qualité — 0,60 / 1,00**
*Preuves* : norme leave-one-out, z modifié, intervalle normal, importance
économique **pour l'humidité seulement**, 7 causes distinguées.
*Limites* : **la comparaison village ↔ usine — le seul écart économiquement
significatif — est impossible** ; aucune qualité cible ; rien de chiffré pour le
KOR faute de grille de réfaction.

**Validation, shadow, surveillance, tests, documentation — 1,50 / 1,50**
*Preuves* : 525 assertions ; 12 scénarios obligatoires couverts ; 9 blocs SQL
exécutés ; 11 tentatives adverses bloquées ; retour arrière exécuté ; Chromium à
3 largeurs ; 5 documents ; 6 fiches de modèle ; fiche de jeu de données ;
procédures shadow, surveillance, désactivation à 3 niveaux, réentraînement,
déploiement, retour arrière.
*Limites* : **le mode shadow n'a pas commencé** ; les contrôles SQL ont tourné en
local, pas en production.

---

## 17. Recommandation

# ⚠ GO SHADOW — SOUS RÉSERVES

**Ce qui peut être fait dès la fusion de cette pull request**, sans risque :
ouvrir le panneau, lire la matrice de maturité, montrer à la Direction ce que les
données permettent et ce qu'elles interdisent. Le panneau ne peut rien décider,
et il ne prétend rien de plus qu'il ne mesure.

**Ce qui ne doit PAS être fait** : citer un chiffre de cette couche comme un
engagement de volume, une demande de fonds ou un jugement sur une équipe.

**Réserves attachées au GO** :

1. Le mode shadow **n'a pas commencé** et ne commencera qu'après application de
   la migration (D-1).
2. Aucune métrique n'existe **sur données réelles**.
3. Les évacuations restent `NOT_READY` — et le resteront sans chantier de schéma.
4. La porte du Niveau 1 n'est pas franchie : **huit P0 ouverts**.

**`GO DECISION SUPPORT` est refusé**, sans ambiguïté. Aucune des neuf conditions
de promotion n'est réunie.

### Procédure de déploiement et de retour arrière

Déploiement : `docs/aflp_ia_predictif_niveau3_exploitation_20260814.md` §6.
Retour arrière : §4 — trois niveaux, du plus fin au plus radical. Le retour
arrière applicatif est **le retrait de deux balises `<script>`**. Aucune donnée
n'est perdue, puisqu'aucune n'a été écrite.

### Coûts techniques

**Aucun coût nouveau.** Aucun fournisseur, aucune infrastructure payante, aucune
dépendance ajoutée. Le seul coût futur serait le passage au pipeline batch, le
jour où un modèle appris se justifiera.

---

## 18. Note de gouvernance — pourquoi ce travail porte `[HUMAN-REVIEW]`

`.github/agent-policy/auto-merge-denylist.txt` couvre `shared/*.js` et
`terrain/**` — c'est-à-dire l'intégralité des fichiers applicatifs que cette
fonctionnalité devait toucher. Le garde-fou `.claude/hooks/guard-paths.sh` a
**effectivement bloqué** la première écriture.

Le blocage a été présenté au Branch Manager, propriétaire du dépôt, qui a
**explicitement autorisé** ces écritures — fournissant lui-même l'intervention
humaine que la denylist exige. C'est le même chemin que le Niveau 2 (PR #155,
commit `85334d7`). Les commits portent le préfixe `[HUMAN-REVIEW]`.

**Cette pull request ne doit pas être fusionnée automatiquement.** Quatre points
méritent l'attention du relecteur :

1. **La requête `achats` de `command.html` remonte 9 colonnes de plus.** Elle
   augmente le volume transféré à chaque chargement du Command Center. Sur
   connexion instable, cela mérite d'être mesuré sur le terrain réel.
2. **La migration n'a pas été appliquée en production.** Elle a été exécutée sur
   une base locale ; le comportement de Supabase peut différer sur les rôles.
3. **Le débordement de 10 px à 390 px est hérité**, mais il contredit le rapport
   du Niveau 2 qui annonçait « 0 débordement ». À traiter séparément.
4. **Toutes les métriques de ce rapport portent sur des données fictives.** Aucune
   ne vaut validation métier, et aucune ne doit être citée comme telle.

---

## 19. Les cinq validations humaines à obtenir avant toute présentation à la Direction

Monsieur KOUASSI, avant de présenter cette couche prédictive à la Direction, ces
cinq validations doivent être obtenues — dans cet ordre.

### 1. Validation **Finance** — sur le besoin de fonds
Faire confirmer que l'estimation du cas 2 est comprise comme un **besoin
théorique**, jamais comme une demande ni comme une autorisation ; que la marge de
sécurité de 10 % est la bonne ; et que **l'absence des frais Wave** dans le
calcul est acceptée en connaissance de cause.

### 2. Validation **Logistics** — sur le statut des évacuations
Faire acter que le cas 5 est **impossible aujourd'hui**, et faire arbitrer
l'ouverture du chantier « table d'évacuation + clé de jointure vers l'usine ».
Sans cette validation, la Direction pourrait croire que l'outil couvre la
logistique — il ne la couvre pas.

### 3. Validation **Quality / Factory** — sur la qualité cible
Faire arrêter les valeurs cibles d'humidité et de KOR. Aujourd'hui le système
compare les villages **entre eux**, faute de référence contractuelle : c'est utile
pour prioriser un contrôle, insuffisant pour arbitrer une réfaction.

### 4. Validation **gouvernance AFLP** — sur la scorecard RT
Faire valider que la scorecard reste **multidimensionnelle**, qu'aucun score
unique ne sera produit sans approbation, et que la séparation entre mauvaise
performance, mauvaise qualité de données et comportement inhabituel est
maintenue. C'est la validation qui protège les équipes.

### 5. Validation **Branch Manager** — sur la porte du Niveau 1
Faire acter les **huit P0 ouverts** et le fait que, tant qu'ils le restent,
aucun modèle ne dépassera `SHADOW_ONLY`. Décider en particulier du chantier
« dates serveur » (N1-08) et de l'ajout de la colonne `campagne` (N1-13) — sans
lesquels aucune prévision ne pourra jamais être défendue devant un tiers.

---

> **Une phrase à retenir pour la Direction.**
> Cette couche ne dit pas ce qui va se passer. Elle dit ce que les données
> permettent d'anticiper, avec quelle marge d'erreur, et — le plus souvent —
> ce qu'elles ne permettent pas encore. C'est cette dernière partie qui a le plus
> de valeur aujourd'hui.

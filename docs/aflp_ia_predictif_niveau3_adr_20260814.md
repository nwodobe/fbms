# ADR AFLP-003 — Architecture de la couche prédictive (Niveau 3)

> Programme : **ANAGROCI FieldLink Programme (AFLP) 2027**
> Date : 2026-08-14 · Statut : **acceptée pour le mode shadow**
> Décideurs à confirmer : Branch Manager (propriétaire du dépôt)
> Remplace : néant · Prolonge : l'architecture du Niveau 2 (`docs/aflp_ia_assistant_niveau2_20260814.md` §2)

---

## 1. Contexte

FBMS est publié par **GitHub Pages à la racine du dépôt**, sans build, sans
gestionnaire de paquets, sans bundler. `.nojekyll` est présent : **un fichier
poussé est un fichier en production**. La persistance et la sécurité réelle
viennent de **Supabase** (RLS). Le terrain travaille en connexion instable.

Le Niveau 2 a établi une couche d'assistance métier **déterministe**, calculée
dans le navigateur sur les données déjà chargées par le Command Center.

Le Niveau 3 doit ajouter des prévisions, des scores et des signaux — sans
enfreindre trois contraintes qui, elles, ne se négocient pas :

1. `supabase/**` est **interdit** à toute modification automatique
   (`CLAUDE.md` §3, `auto-merge-denylist.txt`).
2. Aucune clé secrète ne peut vivre dans un fichier servi publiquement
   (`SECURITE.md`).
3. Aucune donnée AFLP ne peut partir vers une API d'IA externe sans
   autorisation écrite.

---

## 2. Décision

**Statistiques déterministes calculées dans le navigateur, sur les données déjà
chargées sous RLS ; schéma de persistance des prédictions livré prêt à appliquer
mais non appliqué ; aucun modèle entraîné, aucun poids embarqué, aucun service
d'inférence.**

Concrètement :

- `shared/aflp-ia-predictif.js` — calcul pur. Aucun appel réseau, aucun accès au
  DOM, aucune clé, **aucune fonction d'écriture**. Vérifié par recherche
  textuelle sur le code débarrassé de ses commentaires et de ses chaînes.
- `shared/aflp-ia-predictif-ui.js` — affichage seul.
- `docs/migrations/aflp_predictions_20260814.sql` — tables, RLS, rôle technique
  en lecture seule sur les sources, interrupteur d'arrêt. **Non exécuté.**

---

## 3. Options évaluées

### Option A — Calculs statistiques et baselines dans PostgreSQL

Vues et fonctions SQL calculant médianes mobiles, quantiles et écarts
directement en base ; le navigateur ne fait que lire.

| Critère | Appréciation |
|---|---|
| Sécurité | **Excellente** — le calcul ne quitte jamais le périmètre RLS |
| Coût | Nul (Supabase déjà en place) |
| Complexité | Moyenne — le backtest à origine glissante en SQL pur est lourd à écrire et à relire |
| Maintenance | **Problématique ici** : `supabase/**` est interdit aux agents. Chaque correctif devient un geste humain. |
| Latence | Excellente |
| Panne | Si Supabase tombe, FBMS ne fonctionne déjà plus : pas de perte relative |
| Retour arrière | Bon (`drop function`) |
| Hors ligne | **Impossible** — c'est rédhibitoire pour le terrain |

**Écartée** : incompatible avec le travail hors ligne, et avec la politique de
contribution du dépôt.

### Option B — Pipeline batch planifié, prédictions stockées dans Supabase

Une fonction Edge ou une action planifiée calcule chaque nuit et écrit dans
`aflp_predictions` ; le navigateur lit les prédictions.

| Critère | Appréciation |
|---|---|
| Sécurité | **Excellente** — rôle technique dédié, secrets côté serveur |
| Coût | Faible, mais **non nul** : ordonnanceur à mettre en place et à surveiller |
| Complexité | Élevée — déploiement Edge, secrets, ordonnancement, reprise sur échec |
| Maintenance | Élevée : une chaîne de plus à surveiller |
| Latence | Bonne pour du J+1, **inadaptée** à une lecture en cours de journée |
| Panne | Prédictions périmées silencieusement si le batch échoue |
| Retour arrière | Bon |
| Hors ligne | Lecture possible via cache, mais **rien de frais** |

**Écartée pour l'instant, retenue comme cible.** C'est la bonne architecture
**quand** les modèles dépasseront les baselines et **quand** la porte du Niveau 1
sera franchie. La monter aujourd'hui reviendrait à ordonnancer le calcul d'une
moyenne mobile — beaucoup de plomberie pour un résultat qu'un navigateur produit
en quelques millisecondes.

### Option C — Service de prédiction séparé, API sécurisée

Service applicatif hébergé, exposant une API d'inférence.

| Critère | Appréciation |
|---|---|
| Sécurité | Bonne si bien fait, **surface d'attaque nouvelle** |
| Coût | **Nouveau fournisseur cloud** — exclu sans décision explicite |
| Complexité | Élevée |
| Maintenance | Élevée (disponibilité, versions, secrets, journalisation) |
| Latence | Bonne |
| Panne | **FBMS deviendrait dépendant d'un tiers** |
| Retour arrière | Moyen |

**Écartée** : le cadrage interdit d'introduire une infrastructure payante ou un
nouveau fournisseur sans décision explicite, et rien dans les données actuelles
ne justifie ce coût.

### Option D — Retenue : statistiques déterministes côté navigateur

| Critère | Appréciation |
|---|---|
| Sécurité | **Bonne.** Les données lues sont exactement celles que la session a déjà le droit de lire, sous RLS. Aucune donnée nouvelle n'est exposée, aucune clé n'est ajoutée, rien ne sort du navigateur. |
| Coût | **Nul** |
| Complexité | Faible — un fichier, sans dépendance |
| Maintenance | Alignée sur le reste du dépôt |
| Latence | Immédiate |
| Panne | **Aucune dépendance ajoutée.** Si la couche échoue, elle affiche un message et FBMS continue. |
| Retour arrière | **Retirer deux balises `<script>`** |
| Hors ligne | **Fonctionne** sur les données déjà chargées |

---

## 4. « Ne pas intégrer le modèle dans le navigateur » — comment cette règle est respectée

Le cadrage est explicite : si l'architecture ne permet pas une inférence serveur
sûre, **ne pas intégrer le modèle dans le navigateur**, et ne pas simuler un
service inexistant.

Cette règle vise un danger précis : embarquer un **artefact de modèle** — des
poids, un arbre entraîné, un fichier appris — dans une page publique, et
présenter sa sortie comme une vérité serveur.

**Rien de tel n'est fait ici, et c'est vérifiable :**

| Ce que la règle interdit | Ce que cette couche contient |
|---|---|
| Un modèle entraîné embarqué | **Aucun.** Aucun poids, aucun coefficient appris, aucun fichier de modèle. |
| Une bibliothèque d'apprentissage | **Aucune.** Zéro dépendance. |
| Une sortie présentée comme autoritative | Chaque écran porte `SHADOW_ONLY` et « aide à la décision ». |
| Un service simulé | Aucun appel réseau n'est feint. Le stockage n'est pas simulé : il est **déclaré non déployé**, dans l'interface elle-même. |

Ce que la couche calcule, ce sont des **statistiques descriptives** — médiane
mobile, moyenne mobile, naïf saisonnier, quantiles empiriques, z modifié — que
n'importe quel relecteur peut refaire sur un tableur. C'est exactement le niveau
que la maturité des données autorise (**R1 pour cinq cas sur six**, voir
`docs/aflp_ia_predictif_niveau3_donnees_20260814.md`).

**Le jour où un modèle entraîné sera justifié — c'est-à-dire quand il battra
réellement la baseline — il devra passer par l'option B.** L'architecture est
prête pour cela : le contrat de sortie (`AFLP_PRED.analyser()` → tableau
`predictions` conforme à `CHAMPS_PREDICTION`) correspond colonne pour colonne à
la table `aflp_predictions`. Le passage ne demandera aucune réécriture du
diagnostic, des baselines ni de l'interface.

---

## 5. Conséquences

### Acceptées

- **Le calcul est refait à chaque affichage.** Coût mesuré : quelques
  millisecondes sur 384 achats. Non problématique aux volumes du pilote ;
  à réévaluer au-delà de ~50 000 achats.
- **Les prédictions ne sont pas persistées** tant que la migration n'est pas
  appliquée. Conséquence directe : **le mode shadow ne peut pas encore
  commencer**, puisqu'il exige de comparer les prédictions au réel. L'interface
  le dit à l'utilisateur au lieu de le masquer.
- **Le journal des décisions vit dans le navigateur** (`localStorage`), et est
  exportable. C'est une trace locale, pas une trace serveur ; l'interface
  l'indique.

### Garanties obtenues

- **Vérifiabilité** : à données et date de référence identiques, la sortie est
  identique au bit près. Un chiffre affiché se retrace jusqu'à la ligne qui le
  produit.
- **Innocuité** : aucune fonction d'écriture n'existe dans l'API. `executer()`
  refuse toute demande d'action et journalise le refus.
- **Réversibilité** : retirer deux balises `<script>` et une `<section>` supprime
  la couche. Aucune donnée n'est perdue, puisqu'aucune n'a été écrite.

---

## 6. Conditions de révision de cette décision

Cette ADR devra être rouverte si **l'un** de ces événements survient :

1. Un modèle bat la meilleure baseline de plus de 10 % en WAPE sur trois fenêtres
   de backtest → passer à l'option B.
2. Le volume dépasse ~50 000 achats et le calcul devient perceptible à
   l'affichage → passer à l'option B.
3. La porte du Niveau 1 est franchie et la gouvernance autorise
   `DECISION_SUPPORT` → l'option B devient nécessaire, car une prédiction qui
   fonde une décision doit être **persistée et auditée**, pas recalculée.
4. Un besoin d'inférence sur données consolidées multi-campagnes apparaît → aucune
   des options actuelles ne convient, tout est à reprendre.

---

## 7. Décision humaine attendue

Cette ADR est **proposée**, pas ratifiée. Elle demande au Branch Manager de
confirmer trois points :

1. Que le calcul côté navigateur, sur données déjà lisibles par la session, est
   acceptable pour une couche `SHADOW_ONLY`.
2. Que la migration `docs/migrations/aflp_predictions_20260814.sql` peut être
   appliquée — **sans quoi le mode shadow ne peut pas démarrer**.
3. Que l'option B est bien la cible, et à quelle échéance.

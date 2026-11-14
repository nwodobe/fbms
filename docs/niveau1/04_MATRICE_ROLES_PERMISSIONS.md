# Matrice des rôles et permissions — Niveau 1

Date : 14 août 2026

## 1. Rôles existants, constatés avant modification

Source : `supabase/rls.sql:43-55`, `SECURITE.md:26-34`, `agent-policy.yml:59-66`.

| Rôle `profils.role` | `est_bm` | `peut_editer_config` | `peut_editer_terrain` |
|---|:--:|:--:|:--:|
| Branch Manager | ✅ | ✅ | ✅ |
| Assistant Branch Manager | — | ✅ | ✅ |
| Head of Field | — | ✅ | ✅ |
| Procurement Officer | — | ✅ | ✅ |
| Supervisor | — | ✅ | ✅ |
| Agent Recenseur | — | — | ✅ |
| Consultation uniquement | — | — | — |

La Sacherie V2 ajoute une seconde dimension, `profils.fonction_operationnelle` :
Unit Head, Assistant Unit Head, Warehouse Keeper, Logistics Coordinator, Zonal Head.

## 2. Le conflit de séparation constaté

**Constat, vérifié dans le code** : avant cette intervention, `achats_upd`
(`supabase/achats.sql:85`) et `avances_upd` (`cash.sql:62`) réservaient toute
modification au **seul Branch Manager**.

Conséquences réelles, l'une aggravant l'autre :

1. Un Supervisor ne pouvait **rien** valider. La « séparation des tâches » était
   en fait une concentration de toutes les tâches sur un seul homme.
2. Le Branch Manager pouvait valider ses **propres** achats et ses propres
   avances. Le contrôle des quatre yeux était structurellement impossible.

Une organisation où une seule personne saisit, contrôle, approuve et clôture n'a
pas de séparation des tâches — quel que soit ce qu'affiche l'écran.

## 3. Correctif appliqué

**⚠ Ce correctif modifie une politique de sécurité existante. Revue humaine obligatoire.**

| Ce qui change | Migration |
|---|---|
| `achats_upd` et `avances_upd` s'ouvrent aux rôles de contrôle (`n1_peut_controler`) | 03 §11 |
| Un rôle de contrôle ne peut modifier **que la colonne de statut** — trigger `n1_champs_modifiables` | 03 §11 |
| Nul ne fait passer en `VALIDE`, `RECONCILIE`, `CLOTURE` ou `AJUSTE` une opération dont il est l'auteur | 03 §8 |
| Les transitions autorisées sont déclarées en table `n1_transitions`, par rôle | 03 §1 |
| Nul n'approuve l'ajustement qu'il a demandé, ni celui d'une écriture dont il est l'auteur | 05, contraintes SQL |
| Nul ne débloque un cycle qu'il a lui-même ouvert | 06 |
| Nul ne modifie son propre rôle ni ne désactive son propre compte | 03 §9 |
| Le responsable d'une anomalie P0 ne la clôt pas lui-même | 07 |

## 4. Matrice cible par étape du cycle de vie

| Étape | Agent Recenseur | Supervisor | ABM / Head of Field / Procurement | Branch Manager |
|---|:--:|:--:|:--:|:--:|
| Saisie d'un achat | ✅ | ✅ | ✅ | ✅ |
| Soumission | ✅ | ✅ | ✅ | ✅ |
| Contrôle / validation | — | ✅ | ✅ | ✅ |
| Réconciliation d'un cycle | — | — | ✅ | ✅ |
| Clôture | — | — | — | ✅ |
| Ouverture d'un cycle | — | ✅ | ✅ | ✅ |
| Déblocage d'un cycle bloqué | — | — | — | ✅ (≠ ouvreur) |
| Demande d'ajustement | — | ✅ | ✅ | ✅ |
| Approbation d'ajustement | — | — | — | ✅ (≠ demandeur, ≠ auteur) |
| Définition d'un plafond | — | — | — | ✅ |
| Attribution de numéros papier | — | ✅ | ✅ | ✅ |
| Création d'une série papier | — | — | — | ✅ |
| Arbitrage d'un conflit de synchro | — | ✅ | ✅ | ✅ |
| Lecture du journal d'audit | ses actions | ses actions | ✅ | ✅ |
| Modification du journal d'audit | **jamais** | **jamais** | **jamais** | **jamais** |

## 5. Interdits vérifiés par le banc d'essai

| Interdit | Résultat | Scénario |
|---|---|---|
| Créer et approuver une avance seul | l'ouverture de cycle et l'approbation d'exception sont disjointes | T02 |
| Valider son propre achat, même en tant que BM | refusé | T05 |
| Modifier le montant d'un achat sous couvert de « validation » | refusé | T05 |
| Franchir une transition non prévue pour son rôle | refusé | T05 |
| Approuver sa propre correction | refusé | T05 |
| Approuver la correction de sa propre écriture | refusé | T05 |
| Débloquer le cycle qu'on a ouvert | refusé | T06 |
| Modifier son propre rôle | refusé | T03 |
| Se désactiver soi-même | refusé | T03 |
| Modifier ou supprimer une ligne d'audit | refusé, **y compris pour le propriétaire de la base** | T03 |
| Supprimer une opération clôturée | refusé | T05 |

## 6. Conflit organisationnel résiduel — décision requise

Le contrôle à quatre yeux sur les ajustements **exige au minimum deux Branch
Managers actifs**. Le banc d'essai le démontre : avec un seul BM qui est aussi
l'auteur de l'écriture, aucune correction ne peut être approuvée — c'est
volontaire, mais cela paralyserait le terrain.

Trois issues possibles, à trancher par le programme :

| Option | Conséquence |
|---|---|
| **A** — Nommer un second Branch Manager | Séparation pleine. Recommandée. |
| **B** — Ouvrir l'approbation d'ajustement à l'Assistant BM | Séparation réelle, autorité un cran plus bas. Modifie `n1_approuver_ajustement`. |
| **C** — Statu quo à un seul BM | Les ajustements sur ses propres écritures deviennent impossibles. À n'accepter que si le BM ne saisit jamais lui-même. |

**Ce choix est organisationnel, pas technique.** Il n'a pas été tranché dans le
code : l'option A est simplement celle qui ne demande aucune modification.

Inscrit au registre des angles morts sous **A-04**.

## 7. Ce qui n'est pas couvert

- `shared/admin.html` et `shared/auth-gate.js` n'ont pas été modifiés : le
  dépôt l'interdit à un agent, et l'écran d'administration ne connaît donc pas
  encore les nouvelles règles. Il continuera d'afficher des actions que le
  serveur refusera — avec un message clair, mais tardif.
- Aucun rôle « consultation d'audit » distinct n'a été créé : la lecture du
  journal est accordée au BM et aux rôles de contrôle. Un auditeur externe
  strictement en lecture reste à définir (**A-06**).

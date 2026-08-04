# Savoir+ — Vérification réelle de la base Neon

> Agents : **Neon Database Architect**, QA Engineer, DevOps Engineer
> Date : 2026-08-04
> Statut : **RÉSULTATS RÉELS** — chaque ligne de ce document est la sortie d'une exécution, pas une intention.

| | |
|---|---|
| Projet Neon | `savoir-plus` — `autumn-heart-85786511` |
| Branche par défaut | `main` — `br-old-dawn-a6idlnjt` |
| Branche vérifiée | `preview/initial-schema` — `br-super-sun-a6lrxz4f` |
| Base | `neondb` |
| Migration appliquée | `0000_initial_schema.sql` (173 instructions) |

---

## 1. Objectif

Vérifier que la migration initiale Drizzle est réellement applicable sur Neon, et que les garanties structurelles annoncées par le schéma sont **effectivement imposées par PostgreSQL** — pas seulement par la discipline du code applicatif.

La vérification a été menée sur une branche de prévisualisation isolée. **La branche Neon `main` n'a pas été modifiée**, conformément à `ARCHITECTURE.md` §6.4.

---

## 2. Limitation d'infrastructure rencontrée

Le proxy sortant du bac à sable de développement **refuse toute connexion vers `*.neon.tech`** (403 sur le tunnel `CONNECT`), quel que soit le transport :

```
curl https://ep-…-pooler.us-west-2.aws.neon.tech/sql  → CONNECT tunnel failed, response 403
WebSocket (pilote Neon)                               → Unexpected server response: 403
```

Conséquences et traitement :

1. **Le script `npm run db:migrate` n'a pas pu s'exécuter depuis ce bac à sable.** Ce n'est pas un défaut du code : le script échoue au bon endroit, avec un message explicite.
2. La migration a donc été appliquée **via le connecteur Neon**, instruction par instruction, en lots transactionnels.
3. Un **transport HTTP de repli** a été ajouté au script (`NEON_MIGRATION_TRANSPORT=http`) pour les environnements dont le réseau interdit la mise à niveau WebSocket. Il est documenté comme **dégradé** : sans session PostgreSQL, il n'y a pas de transaction englobante, donc un échec à mi-parcours laisse un schéma partiellement migré. Il ne doit pas être le mode par défaut en production.
4. Le journal Drizzle (`drizzle.__drizzle_migrations`) a été renseigné avec le hash réel du fichier de migration, afin que la branche soit dans un état cohérent : un `npm run db:migrate` ultérieur la verra comme déjà migrée et ne rejouera rien.

Cette limitation ne remet pas en cause le SQL produit. Elle signifie que le script de migration du dépôt doit encore être exécuté dans un environnement autorisant une connexion à Neon avant toute mise en production.

---

## 3. Garde-fou de connexion (ADR-008) — vérifié sur de vraies chaînes Neon

```
DATABASE_URL poolée ?            true
DATABASE_URL_UNPOOLED poolée ?   false
✓ garde application accepte l’URL poolée
✓ garde migration accepte l’URL directe
✓ garde migration REFUSE l’URL poolée
✓ garde application REFUSE l’URL directe
```

Les quatre cas se comportent comme spécifié. Le garde-fou n'est pas théorique : il refuse effectivement les **deux** inversions possibles.

---

## 4. Conformité du schéma déployé

Requête d'inventaire exécutée sur le catalogue PostgreSQL après migration :

| Objet | Attendu | **Constaté** | |
|---|---:|---:|:--:|
| Tables publiques | 37 | **37** | ✅ |
| Types énumérés | 22 | **22** | ✅ |
| Clés étrangères | 54 | **54** | ✅ |
| Contraintes `CHECK` | 32 | **32** | ✅ |
| Index publics (dont implicites PK/unique) | — | **96** | ✅ |
| **Index partiels** | 5 | **5** | ✅ |
| Entrées du journal Drizzle | 1 | **1** | ✅ |

Les 96 index incluent les index explicites et ceux créés automatiquement par PostgreSQL pour les clés primaires et les contraintes d'unicité.

Les 5 index partiels sont ceux qui portent les garanties d'unicité conditionnelle : lien parent actif, diagnostic en cours, erreurs à réviser, révision active, révisions dues.

---

## 5. Garanties métier vérifiées

Chaque test insère une donnée qui **doit** être refusée. Un test « réussi » signifie que **PostgreSQL a rejeté l'écriture**.

| # | Règle métier | Écriture tentée | Résultat |
|---|---|---|---|
| **IT-01** | Anti-doublon de synchronisation | 2ᵉ tentative n°1 sur le même exercice, même élève | ❌ rejeté — `exercise_attempts_unique_try_uq` ✅ |
| **IT-02** | Maîtrise impossible sous 2 mesures | `status='mastered'` avec `evaluated_count=1` | ❌ rejeté — `student_skill_levels_mastery_requires_two_measures_ck` ✅ |
| **IT-03** | Seuil strict de récurrence | `status='recurrent'` avec `occurrence_count=2` | ❌ rejeté — `error_logs_recurrent_threshold_ck` ✅ |
| **IT-04** | Unicité d'e-mail insensible à la casse | `ANDERSON@Example.CI` après `anderson@example.ci` | ❌ rejeté — `users_email_lower_uq` ✅ |
| **IT-05** | Une seule révision active par cible | 2ᵉ plan `scheduled`, même élève/compétence, `error_log_id` **NULL** | ❌ rejeté — `revision_plans_one_active_uq` ✅ |
| **IT-06** | Auto-lien parent-enfant impossible | lien où parent = élève | ❌ rejeté — `parent_student_links_distinct_ck` ✅ |
| **IT-07** | Contenu publié = 2 indices minimum (CQ-02) | version publiée avec 1 seul indice | ❌ rejeté — `exercise_versions_hints_ck` ✅ |

Le mécanisme anti-doublon (IT-01) est donc porté par la base et ne dépend pas uniquement du code applicatif — c'est ce qui protège la synchronisation hors ligne d'un rejeu déformé, lorsque la clé d'idempotence a été perdue.

### Test complémentaire — l'index partiel n'est pas trop strict

Une révision passée à `done` ne bloque **pas** la programmation de la suivante :

```
status     | n
-----------+---
scheduled  | 1
done       | 1
```

C'est le point qui compte : l'index doit interdire le doublon **sans** casser le cycle de répétition espacée. Les deux comportements sont vérifiés.

### Le point non trivial d'IT-05

Avec un index unique ordinaire, deux lignes portant `error_log_id = NULL` seraient **toutes deux acceptées** — PostgreSQL ne considère pas deux `NULL` comme égaux. La garantie « aucune duplication » de la Phase 9 aurait été silencieusement inopérante sur tous les plans de révision non rattachés à une erreur, c'est-à-dire la majorité.

Le `coalesce(error_log_id, '00000000-…'::uuid)` dans l'index règle ce cas, et le test le prouve.

---

## 6. Données de test résiduelles

La branche de prévisualisation contient les enregistrements créés pour ces tests, dans : `users`, `subjects`, `chapters`, `skills`, `exercises`, `exercise_versions`, `exercise_attempts`, `revision_plans`.

**Ce ne sont pas des données de démonstration** au sens de `seed:demo` : ce sont des fixtures de test. Elles ne doivent pas être promues vers la branche principale. La branche devra être purgée ou recréée avant toute utilisation comme environnement de démonstration.

---

## 7. État de la branche principale

Au moment de cette vérification, la branche Neon `main` ne contient **aucune table applicative Savoir+**. Elle reste volontairement vierge jusqu'à validation du code.

---

## 8. Ce qui n'a PAS été vérifié

Énoncé explicitement, pour ne rien laisser croire de plus que ce qui a été fait.

| # | Point | Raison |
|---|---|---|
| 1 | **`main` n'est pas migrée** | La validation en preview est terminée ; la promotion reste à faire. |
| 2 | **Le script `migrate.ts` de bout en bout** | Bloqué par la limitation réseau du §2. À exécuter depuis un poste de développement ou la CI. |
| 3 | **ADR-014** — la suppression d'un exercice ne détruit pas les tentatives d'un élève | Vérifier cela exige un `DELETE`. Je n'exécute pas de SQL destructif de ma propre initiative. La clé étrangère `ON DELETE restrict` est présente dans le schéma déployé (comptage des 54 FK), mais elle n'a pas été éprouvée par une suppression réelle. |
| 4 | Performances des requêtes chaudes (PF-05, IT-16) | Aucune donnée réaliste en base ; un `EXPLAIN` sur des tables vides n'apprend rien. |
| 5 | Contenu pédagogique de référence | Non chargé — bloqué par OQ-02 et OQ-03. |
| 6 | Authentification Auth.js | Non implémentée — c'est l'objet du Lot 2. |

---

## 9. Verdict

**Phase 2, couche base de données : VALIDÉE sur branche de prévisualisation.**

Le schéma s'exécute réellement sur Neon. Les sept garanties structurelles du modèle de données sont vérifiées : elles ne dépendent pas de la discipline du code applicatif, elles sont portées par PostgreSQL.

La promotion vers Neon `main` reste conditionnée à :

1. la validation de la revue de code ;
2. une CI verte ;
3. l'exécution de la migration depuis un environnement autorisé, ou par un canal Neon contrôlé ;
4. une vérification post-migration sur `main` ;
5. l'absence de données de test.

---

## 10. Prochaine étape

**Lot 2 — authentification et autorisation** : Auth.js avec sessions en base, les 9 gardes serveur, le test générique interdisant toute action non protégée, et les **18 tests d'autorisation bloquants**.

Ce lot précède tout développement fonctionnel : sans filet RLS sur Neon, une garde ajoutée après coup est une garde oubliée.

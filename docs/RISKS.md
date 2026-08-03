# Savoir+ — Registre des risques

> Agents responsables : **Product Manager** (produit), **Software Architect** (technique), **Security Engineer** (sécurité), **Expert pédagogique** (contenu)
> Version : 0.1.0 — 2026-08-03

Cotation : Gravité × Probabilité → Niveau (🔴 Majeur · 🟠 Élevé · 🟡 Moyen · 🟢 Faible).
Stratégies : **Éviter** · **Réduire** · **Transférer** · **Accepter**.

---

## 1. Risques produit

| # | Risque | Gravité | Prob. | Niveau | Stratégie | Traitement | Signal d'alerte |
|---|---|:--:|:--:|:--:|---|---|---|
| **R-P01** | **Savoir+ dérive vers une banque de corrigés.** Sous la pression du confort ou du délai, un bouton « voir la solution » apparaît, et la fonction centrale disparaît. | Critique | **Élevée** | 🔴 | Éviter | verrouillage **serveur** du protocole · E2E-04 · règle explicite dans `PEDAGOGY.md` §6 | toute demande d'accès direct à la solution en revue |
| **R-P02** | **L'élève abandonne pendant le diagnostic** (20 questions, c'est long). | Élevée | Élevée | 🔴 | Réduire | sauvegarde progressive · reprise · progression visible · promesse annoncée avant · « Plus tard » possible | taux d'achèvement < 70 % |
| **R-P03** | **Le rapport de diagnostic démoralise** et l'élève ne revient pas. | Élevée | Moyenne | 🟠 | Réduire | vocabulaire non stigmatisant · points forts d'abord · aucune note globale mise en avant · plan d'action immédiat | rétention J+1 après diagnostic < 50 % |
| **R-P04** | **Élargissement prématuré du périmètre** (2ᵈᵉ matière, Première) avant que la boucle centrale ne fonctionne. | Élevée | **Élevée** | 🔴 | Éviter | liste hors périmètre explicite · le PM refuse · toute extension exige une entrée dans `DECISIONS.md` | toute demande de « juste ajouter la physique » |
| **R-P05** | **Le parent surveille trop**, l'élève se braque et crée un second compte. | Moyenne | Moyenne | 🟡 | Réduire | double consentement · agrégats uniquement · révocation par l'élève | comptes multiples par élève |
| **R-P06** | **Les séances sont trop chargées** et l'élève décroche. | Moyenne | Moyenne | 🟡 | Réduire | plafond strict au temps déclaré · priorité aux retards | séances abandonnées en cours |
| **R-P07** | **Personne ne revient le lendemain** : la répétition espacée s'effondre. | Élevée | Moyenne | 🟠 | Réduire | écran « Aujourd'hui » qui dit quoi faire en 3 secondes · séances courtes · série de jours | rétention J+7 < 35 % |

---

## 2. Risques pédagogiques

| # | Risque | Gravité | Prob. | Niveau | Stratégie | Traitement |
|---|---|:--:|:--:|:--:|---|---|
| **R-E01** | **Le contenu ne correspond pas au programme ivoirien officiel** et est présenté comme conforme. | **Critique** | **Élevée** | 🔴 | Éviter | avertissement en tête de `PEDAGOGY.md` · statut `draft` par défaut · publication interdite sans validation d'un enseignant ivoirien (**OQ-02**) |
| **R-E02** | **Une réponse attendue est mathématiquement fausse.** L'application enseigne une erreur. | Critique | Moyenne | 🔴 | Réduire | Content QA · contrôles CQ-01 à CQ-10 · double relecture · retrait immédiat possible |
| **R-E03** | **Un indice contient la réponse**, annulant le protocole de correction guidée. | Élevée | Moyenne | 🟠 | Réduire | contrôle automatisé CQ-04 · revue de contenu |
| **R-E04** | **La difficulté annoncée ne correspond pas à la difficulté réelle** : progression incohérente. | Moyenne | Élevée | 🟡 | Réduire | revue Content QA · calibrage a posteriori sur les taux de réussite réels |
| **R-E05** | **Les seuils 80/50 sont inadaptés** à la population cible. | Moyenne | Moyenne | 🟡 | Accepter puis ajuster | seuils en configuration, pas en dur · réévaluation sur données réelles |
| **R-E06** | **La catégorisation automatique des erreurs se trompe** et l'élève reçoit un diagnostic faux sur son erreur. | Moyenne | Élevée | 🟡 | Réduire | catégorie par défaut honnête plutôt que devinée · cas non attribuables journalisés · présentée comme une aide, pas un verdict |
| **R-E07** | **Le calendrier de révision n'est pas calibré** sur des lycéens ivoiriens. | Faible | Élevée | 🟢 | Accepter | base raisonnable documentée comme non calibrée · paramétrable |

---

## 3. Risques techniques

| # | Risque | Gravité | Prob. | Niveau | Stratégie | Traitement |
|---|---|:--:|:--:|:--:|---|---|
| **R-T01** | **Perte de données en mode hors ligne.** L'élève travaille 40 minutes, tout disparaît. | **Critique** | Moyenne | 🔴 | Éviter | file persistante · purge après confirmation serveur uniquement · E2E-10/11/12 · 7 garanties de `OFFLINE_SYNC.md` §8 |
| **R-T02** | **Doublons créés par la synchronisation** : progression et statistiques faussées. | Élevée | **Élevée** | 🔴 | Éviter | clé d'idempotence **+** contrainte d'unicité métier (double barrière) |
| **R-T03** | **Une erreur de scoring corrompt silencieusement** la progression de tous les élèves. | Élevée | Moyenne | 🟠 | Réduire | fonctions pures · 100 % de couverture de branches · tests de propriété · script de recalcul complet |
| **R-T04** | **Migration destructive en production.** | Critique | Faible | 🟠 | Éviter | revue obligatoire · rejet par défaut de `DROP`/`TRUNCATE` · migration en trois temps · sauvegarde préalable · staging obligatoire |
| **R-T05** | **Épuisement des connexions Neon** sous charge serverless. | Élevée | Faible | 🟡 | Réduire | connexion poolée imposée · singleton · garde-fou au démarrage · IT-17/18 |
| **R-T06** | **Démarrage à froid du compute Neon** perçu comme une panne. | Faible | Élevée | 🟡 | Réduire | états de chargement · aucun message d'erreur sur un simple délai |
| **R-T07** | **Conflit avec l'existant FBMS** : service worker, GitHub Pages, `manifest`. | Élevée | **Élevée** (si option B) | 🟠 | Éviter | ADR-001 option A (dépôt dédié) · à défaut, portées strictement disjointes |
| **R-T08** | **Fuite de secret par absence de `.gitignore`.** | **Critique** | Moyenne | 🔴 | Éviter | **`.gitignore` créé avant le premier `npm install`** · scan de secrets en CI · scan du bundle client |
| **R-T09** | **Deux bases de données (Supabase + Neon) dans un même dépôt** : confusion de configuration, erreur de connexion. | Moyenne | Élevée | 🟡 | Réduire | ADR-001 option A · à défaut, nommage strict des variables et isolation des répertoires |
| **R-T10** | **Dette d'outillage** : ni CI, ni tests, ni lint à créer intégralement. Charge sous-estimée. | Moyenne | Élevée | 🟡 | Accepter | budget explicite en Phase 2 · CI avant la première fonctionnalité, pas après |
| **R-T11** | **Le rendu des expressions mathématiques alourdit la page** (KaTeX ≈ 250 Ko). | Moyenne | Élevée | 🟡 | Réduire | arbitrage OQ-09 · chargement différé · repli sur du texte simple pour les énoncés élémentaires |

---

## 4. Risques de sécurité

Détail complet et parades dans `SECURITY.md` §3. Rappel des cinq risques majeurs :

| # | Risque | Niveau |
|---|---|:--:|
| **R-S01** | Accès croisé entre élèves | 🔴 |
| **R-S02** | Fuite de réponse correcte avant soumission | 🔴 |
| **R-S03** | Falsification de `user_id` dans un lot de synchronisation | 🔴 |
| **R-S04** | Secret d'infrastructure exposé | 🔴 |
| **R-S05** | Accès parent sans lien actif | 🔴 |

---

## 5. Risques de conformité et juridiques

| # | Risque | Gravité | Prob. | Niveau | Traitement |
|---|---|:--:|:--:|:--:|---|
| **R-C01** | **Traitement de données de mineurs sans base légale vérifiée** en Côte d'Ivoire. | **Critique** | Élevée | 🔴 | **OQ-05** — vérification juridique requise **avant** toute mise en service publique |
| **R-C02** | **Consentement parental insuffisant** au regard du droit applicable. | Élevée | Élevée | 🟠 | OQ-05 · minimisation appliquée par défaut |
| **R-C03** | **Contenu présenté comme officiel sans autorisation** du ministère. | Élevée | Moyenne | 🟠 | OQ-02 · aucune mention de conformité officielle sans validation tracée |
| **R-C04** | **Absence de politique de rétention** documentée. | Moyenne | Élevée | 🟡 | ADR-019 · DM-Q1, DM-Q2 |

---

## 6. Risques de projet

| # | Risque | Gravité | Prob. | Niveau | Traitement |
|---|---|:--:|:--:|:--:|---|
| **R-J01** | **Production de code avant validation du cadrage.** L'architecture est figée par du code écrit trop tôt. | Élevée | Élevée | 🟠 | Phase 0 sans code · portes de validation par phase |
| **R-J02** | **Une phase déclarée terminée sans preuve.** | Élevée | Élevée | 🟠 | format de rapport §16 imposé · sortie de test réelle exigée · pas de « ça devrait marcher » |
| **R-J03** | **OQ-01 et OQ-02 ne sont pas tranchées** et bloquent les Phases 2 et 6. | Élevée | Moyenne | 🟠 | escalade explicite dans le rapport de Phase 0 |
| **R-J04** | **Le volume de contenu (45 exercices vérifiés) est sous-estimé.** La production de contenu est un travail humain, pas une génération. | Élevée | Élevée | 🟠 | budget dédié · Content QA impliqué dès la Phase 1 · production incrémentale par compétence |
| **R-J05** | **Aucun enseignant ivoirien disponible** pour valider le contenu. | **Critique** | Moyenne | 🔴 | identification d'un valideur **avant** la Phase 6 · sans lui, le contenu reste en `draft` et le produit n'est pas publiable |

---

## 7. Les cinq risques à traiter en priorité

Si l'attention doit se concentrer sur un nombre limité de sujets, ce sont ceux-ci :

| Rang | Risque | Pourquoi en tête |
|---|---|---|
| **1** | **R-E01 / R-J05** — contenu non validé présenté comme conforme | atteinte directe à des élèves préparant un examen national. Aucune parade technique ; seule une validation humaine résout ce risque. |
| **2** | **R-T01** — perte de données hors ligne | une seule perte détruit la confiance et l'élève ne revient pas. |
| **3** | **R-S01 / R-S05** — accès croisé et accès parent illégitime | données de mineurs, **sans filet RLS**. Chaque garde oubliée est une fuite. |
| **4** | **R-P01** — dérive vers une banque de corrigés | le produit continuerait de fonctionner tout en ayant perdu sa raison d'être. Défaillance silencieuse, donc la plus dangereuse. |
| **5** | **R-C01** — base légale du traitement de données de mineurs | risque juridique non atténuable par le code. |

---

## 8. Ce qui n'est pas un risque identifié

Pour éviter de disperser l'attention :

- **La montée en charge.** Quelques centaines d'élèves ne posent aucun problème d'échelle à cette architecture.
- **Le choix des technologies imposées.** Next.js, Neon, Drizzle, Auth.js et R2 forment une combinaison cohérente et éprouvée.
- **La complexité algorithmique.** Le scoring, la maîtrise et la répétition espacée sont de l'arithmétique simple. La difficulté est la rigueur, pas la sophistication.

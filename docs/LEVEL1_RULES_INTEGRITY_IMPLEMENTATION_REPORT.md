# Niveau 1 « Règles et intégrité » — Rapport d'implémentation

Projet : ANAGROCI FieldLink Programme (AFLP 2027) · FBMS
Date : 14 août 2026 · Branche : `niveau1-regles-integrite` · Base : commit `4993f33`

---

## 1. Verdict

**Go sous réserves.**

Les neuf risques P0 identifiés au diagnostic sont fermés **côté base de données**,
et chacun est démontré par un test réellement exécuté. Aucune migration n'a été
appliquée à la production, aucun test n'a été déclaré réussi sans l'avoir été.

La réserve porte sur trois points, tous hors de portée de cet environnement :

1. l'état réel de la base de production n'est pas connu (accès interdit) ;
2. le frontend n'a pas été adapté — les modules Cash et Achats cesseront de
   fonctionner si les migrations partent seules ;
3. rien n'a été éprouvé sur un vrai projet Supabase ni sur un vrai téléphone.

## 2. Note

| | Note |
|---|---|
| Auto-évaluation initiale | **8,20 / 10** |
| Après deux cycles d'amélioration | **8,65 / 10** |

Je n'atteins pas 9/10 et je ne gonfle pas la note. Le détail, les preuves et le
plan exact pour y arriver sont aux sections 9 et 10.

## 3. Avant / après

| Risque | Avant | Après | Preuve |
|---|---|---|---|
| P0-1 Reçu dupliqué | possible, aucune contrainte | **impossible**, y compris déguisé par la casse ou la ponctuation | T01 |
| P0-2 Avance sur cycle non réconcilié | règle 100 % navigateur, lue dans `localStorage` | **impossible**, quatre mécanismes serveur indépendants | T02, T06 |
| P0-3 Stock ou sacs négatifs | possible, soldes calculés à la lecture | **impossible**, `CHECK (quantite >= 0)` sur colonne réelle | T04 |
| P0-4 Opération clôturée modifiable | modifiable par le BM | **impossible**, y compris pour le propriétaire de la base | T05 |
| P0-5 Audit modifiable | table inexistante, politiques conditionnelles | **append-only**, `UPDATE`/`DELETE`/`TRUNCATE` rejetés pour tous | T03 |
| P0-6 Auto-approbation | possible, `validated_by` en texte libre | **impossible** sur 5 chemins distincts | T05, T06 |
| P0-7 Achat sans RT/producteur/cycle valides | aucune vérification | **refusé** | T02 |
| P0-8 Doublons de synchronisation | `local_id` unique mais nullable | **impossible**, clé d'idempotence + accusé serveur | T01, T08 |
| P0-9 Montant non vérifié | saisi librement | **refusé** si ≠ poids × prix ± tolérance | T02 |

## 4. Contrôles implémentés

| Lot | Objet | État |
|---|---|---|
| A | Identifiants uniques et idempotence | livré, testé |
| B | 13 invariants métier côté serveur | livré, testé |
| C | Journal d'audit append-only | livré, testé |
| D | Clôture, immutabilité, ajustements | livré, testé |
| E | Moteur de réconciliation déterministe | livré, testé |
| F | Moteur d'alertes explicites | livré, testé |
| G | Hors ligne maîtrisé, accusés, conflits | livré côté serveur, testé |
| H | Registre papier de secours numéroté | livré, testé |

## 5. Migrations créées

Toutes dans `docs/migrations/niveau1/`. **Aucune n'a été exécutée en production.**

| Fichier | Contenu |
|---|---|
| `20260814_01_socle_parametres_audit.sql` | Paramétrage versionné, journal append-only, masquage |
| `20260814_02_identifiants_idempotence.sql` | Clés d'idempotence, unicité du reçu, codes métier |
| `20260814_03_cycles_invariants_metier.sql` | Cycles, machine d'état, exceptions, séparation des tâches |
| `20260814_04_stock_sacs_non_negatifs.sql` | Soldes, stock RCN, lots, évacuations, réceptions usine |
| `20260814_05_cloture_ajustements.sql` | Verrou de clôture, contre-écritures |
| `20260814_06_reconciliation.sql` | Moteur 5 dimensions, déblocage tracé, vue cycles |
| `20260814_07_anomalies.sql` | 21 types d'alerte, anti-doublon, détection par lot |
| `20260814_08_synchronisation.sql` | File serveur, accusés, conflits, file des rejets |
| `20260814_09_papier_secours.sql` | Séries, plages, statuts, rapprochement, clôture |
| `20260814_10_paiements_commissions_detecteurs.sql` | Paiements, commissions, 5 détecteurs de plus |
| `PRECHECK_doublons_et_blocages.sql` | **Lecture seule** — mesure l'historique avant migration |
| `VERIFY_niveau1.sql` | Lecture seule — contrôle d'installation |
| `ROLLBACK_niveau1.sql` | Retour arrière sans perte de donnée |

Toutes additives : aucun `DROP TABLE`, aucun `DROP COLUMN`, aucun `DELETE`.
Contraintes rétroactives en `NOT VALID` — elles protègent le neuf sans juger
l'historique.

## 6. Fichiers modifiés

**Aucun fichier existant du dépôt n'a été modifié.** 36 fichiers créés :

```
docs/niveau1/                  15 documents
docs/migrations/niveau1/       13 fichiers SQL
.github/agent-tests/niveau1/    8 fichiers de test
```

`supabase/**`, `shared/auth-gate.js`, `shared/admin.html`, `.github/workflows/**`,
`sw.js`, `manifest.webmanifest` et `savoir-plus/**` sont intacts, conformément à
`CLAUDE.md:74-87`. Les migrations sont livrées dans `docs/migrations/`, où
`docs/**` est explicitement auto-modifiable — le même emplacement que la
Sacherie V2, pour la même raison.

## 7. Tests exécutés

```bash
npm install --no-save @electric-sql/pglite@0.5.5
node .github/agent-tests/niveau1/executer.mjs
```

**Résultat réel, dernière exécution : 199 / 199 cas conformes, 15,1 s.**

| Scénario | Cas | Objet |
|---|---:|---|
| T01 | 12 | Identifiants uniques et idempotence |
| T02 | 12 | Invariants métier serveur |
| T03 | 11 | Journal d'audit append-only |
| T04 | 12 | Stock RCN et sacs non négatifs |
| T05 | 18 | Clôture, immutabilité, ajustements |
| T06 | 24 | Réconciliation et blocage du refinancement |
| T07 | 13 | Moteur d'alertes |
| T08 | 20 | Hors ligne, idempotence, conflits |
| T09 | 19 | Protocole papier |
| T10 | 29 | Paiements, commissions, détecteurs |
| T11 | 15 | Idempotence des migrations |
| T12 | 15 | Retour arrière |

Le banc s'exécute sur **PostgreSQL 18.3 authentique** (PGlite, WebAssembly),
retenu parce que Docker, WSL 2 et les droits administrateur sont indisponibles
sur ce poste — vérifié, non supposé. Les contraintes, triggers et politiques RLS
sont réellement évalués par PostgreSQL.

Portes du dépôt, en non-régression : `verifier-js.mjs` → **0 nouvelle erreur**
(1 erreur héritée, `shared/alis-hardening.js`, déjà documentée dans `CLAUDE.md` §6).

## 8. Angles morts résiduels

Détail complet dans `docs/niveau1/13_ANGLES_MORTS.md`. Les trois plus lourds :

| Réf | Sujet | Criticité |
|---|---|---|
| **A-03** | État réel de la base de production inconnu | **P0** |
| **A-08** | Frontend non adapté aux nouvelles règles | **P0** |
| A-04 | Le contrôle à quatre yeux exige deux Branch Managers | P1 — décision métier |

## 9. Auto-évaluation détaillée

| Domaine | Barème | Obtenu |
|---|---:|---:|
| Identifiants uniques et idempotence | 1,00 | **0,95** |
| Contrôles serveur, contraintes et RLS | 1,50 | **1,25** |
| Journal d'audit append-only | 1,25 | **1,05** |
| Clôture, verrouillage et ajustements | 1,00 | **0,95** |
| Réconciliation et blocage du refinancement | 1,50 | **1,30** |
| Alertes d'anomalies | 1,00 | **0,85** |
| Hors ligne, synchronisation et conflits | 1,25 | **0,90** |
| Protocole papier numéroté | 0,50 | **0,50** |
| Tests, sécurité, documentation et migrations | 1,00 | **0,90** |
| **Total** | **10,00** | **8,65** |

### Identifiants et idempotence — 0,95 / 1,00
**Preuve** : T01 (12 cas). Reçu dupliqué refusé y compris masqué par la casse et
la ponctuation ; rejeu de clé refusé ; identifiants immuables ; paiements et
commissions dotés d'entités propres au cycle d'amélioration 1.
**Défaut** : `local_id NOT NULL` reste `NOT VALID` — l'historique n'est pas
certifié conforme.
**Risque résiduel** : des lignes anciennes sans identifiant local subsistent.
**Correctif** : régularisation puis `VALIDATE CONSTRAINT`, après pré-contrôle.

### Contrôles serveur, contraintes et RLS — 1,25 / 1,50
**Preuve** : T02, T04, T10. Les 13 invariants sont implémentés et refusent ce
qu'ils doivent refuser.
**Défauts** : aucune vraie clé étrangère (A-02, typage `text` vs `uuid`) ; la RLS
n'a pas été éprouvée à travers PostgREST avec de vrais jetons (A-09) ; le
frontend n'est pas adapté (A-08).
**Risque résiduel** : la suppression d'un RT laisserait des achats orphelins.
**Correctif** : conversion de type en fenêtre de maintenance, tests via
PostgREST sur le projet de recette.

### Journal d'audit append-only — 1,05 / 1,25
**Preuve** : T03. `UPDATE`, `DELETE` et `TRUNCATE` rejetés — y compris pour le
propriétaire de la base. Photos et secrets masqués.
**Défaut** : un refus n'écrit pas sa ligne d'audit dans la même transaction
(A-01, limite structurelle de PostgreSQL).
**Risque résiduel** : un client qui n'appelle pas `n1_journaliser_refus` laisse
le refus visible uniquement dans les journaux serveur.
**Correctif** : câbler l'appel dans le frontend.

### Clôture, verrouillage et ajustements — 0,95 / 1,00
**Preuve** : T05, T10. Opération clôturée non modifiable ni supprimable par
personne ; ajustement exigeant motif, preuve et un tiers approbateur ; écriture
d'origine intacte, contre-écriture produite.
**Défaut** : les preuves sont des références textuelles, non des fichiers (A-13).
**Correctif** : rattachement à Supabase Storage avec empreinte SHA-256.

### Réconciliation et blocage du refinancement — 1,30 / 1,50
**Preuve** : T06 (24 cas), T10. Sept dimensions calculées par le serveur à partir
de composantes indépendantes ; un écart inexplicable bloque le cycle ; le
blocage coupe achats, avances et refinancement ; le déblocage exige un rôle, un
motif, une preuve et un tiers, et laisse une trace permanente.
**Défauts** : le montant Wave transféré et le montant retiré ne sont pas
distinguables — aucune intégration Wave ; les sacs pleins ne sont pas réconciliés
séparément des sacs vides.
**Correctif** : intégration du relevé Wave, dimension `SACS_PLEINS`.

### Alertes d'anomalies — 0,85 / 1,00
**Preuve** : T07, T10. 21 types déclarés, 10 détecteurs actifs, anti-doublon
prouvé (3 détections = 1 anomalie, 3 occurrences), réouverture après récidive
prouvée, criticité, responsable, échéance et preuve de résolution obligatoires.
**Défauts** : quelques types restent garantis par une contrainte sans lever
d'anomalie automatique ; aucun ordonnanceur (A-07) — la détection par lot doit
être déclenchée à la main.
**Correctif** : `pg_cron` ou fonction Edge planifiée.

### Hors ligne, synchronisation et conflits — 0,90 / 1,25
**Preuve** : T08 (20 cas). Accusé serveur, purge locale conditionnée, double clic
et double terminal sans doublon, exposition financière refusée hors ligne, file
des rejets durable, état restituable après perte d'appareil.
**Défaut** : le terminal n'a pas été modifié (A-08). Les cas 1, 5, 6, 9 et 11 du
protocole terrain ne sont pas éprouvés sur un vrai téléphone.
**Risque résiduel** : le comportement réel dépend d'un code non encore écrit.
**Correctif** : adaptation du terminal, puis phase 3 du plan de recette.

### Protocole papier numéroté — 0,50 / 0,50
**Preuve** : T09 (19 cas). Série, plage attribuée à un responsable nommé, six
statuts, justification obligatoire, un formulaire = une opération, numéro hors
registre refusé, clôture quotidienne signalant les trous, registre imprimable,
procédure terrain rédigée.

### Tests, sécurité, documentation et migrations — 0,90 / 1,00
**Preuve** : 199 cas exécutés ; idempotence des 10 migrations vérifiée par rejeu
complet ; retour arrière exécuté et vérifié sans perte de donnée ; 15 documents ;
pré-contrôle, vérification et retour arrière fournis ; aucun secret, aucune
donnée réelle.
**Défauts** : pas de test de concurrence réelle (PGlite est mono-connexion,
A-14) ; rien n'a été exécuté sur un vrai projet Supabase (A-09) ; l'état de la
production reste inconnu (A-03).
**Correctif** : projet de recette Supabase, deux sessions `psql` simultanées.

## 10. Plan exact pour atteindre 9/10

| # | Action | Gain | Ce qu'il faut |
|---|---|---:|---|
| 1 | Exécuter `PRECHECK` sur une restauration de production | +0,10 | **Un projet Supabase de recette** |
| 2 | Rejouer les 199 cas contre ce projet, via PostgREST et de vrais jetons | +0,15 | idem |
| 3 | Test de concurrence à deux sessions `psql` | +0,10 | idem |
| 4 | Adapter le frontend : RPC, accusés, messages d'erreur | +0,25 | Revue humaine, livraison coordonnée |
| 5 | Recette terrain hors ligne sur un vrai téléphone | +0,15 | Un appareil, une équipe |
| **Total** | | **+0,75 → 9,40** | |

Les points 1 à 3 dépendent d'un accès que je n'ai pas et ne dois pas avoir. Le
point 4 relève d'une zone que le dépôt classe en revue humaine obligatoire.

**Ce dont j'ai besoin de vous :**

1. un **projet Supabase de recette**, distinct de `jmbdgpdthzpszfnddwzi`, restauré
   depuis une sauvegarde de production (jamais de mot de passe ni de clé
   `service_role` dans la conversation) ;
2. les **valeurs des plafonds et tolérances** AFLP 2027, ou l'autorisation
   explicite de démarrer avec des valeurs provisoires ;
3. la **décision sur le second Branch Manager** (document 04 §6) ;
4. l'autorisation d'adapter le frontend, en sachant que c'est une livraison
   coordonnée avec les migrations.

## 11. Décisions métier encore nécessaires

| # | Décision | Conséquence si non tranchée |
|---|---|---|
| 1 | Plafonds cycle, avance, achat | Toute opération à risque est **refusée** — c'est voulu |
| 2 | Tolérances cash, poids, sacs, usine | Tolérance nulle : égalité stricte exigée |
| 3 | Second Branch Manager | Aucun ajustement approuvable sur les écritures du BM |
| 4 | Rattachement rétroactif de l'historique aux cycles | L'historique reste hors réconciliation |
| 5 | Taux de commission RT | Le calcul des commissions est refusé |
| 6 | Unicité globale du reçu après le Lot H | Reste par campagne + RT |

## 12. Risques de mise en production

| Risque | Gravité | Atténuation |
|---|---|---|
| Le module Cash cesse de fonctionner | **élevée** | Livraison coordonnée frontend + migrations |
| Réécriture de `achats` (colonne générée) sous verrou exclusif | moyenne | Mesurer la volumétrie, prévoir une fenêtre |
| Historique violant les nouvelles contraintes | moyenne | `NOT VALID` + pré-contrôle |
| Messages d'erreur bruts pour l'utilisateur | moyenne | Traduction côté frontend |
| Plafonds mal calibrés bloquant le terrain | moyenne | Paramètres modifiables à chaud, audités |
| Dépôt public sur GitHub | moyenne | Passer le dépôt en privé (A-11) |

## 13. Instructions de déploiement

Détail complet : `docs/niveau1/10_GUIDE_MIGRATION.md`. Résumé :

1. Sauvegarde de production vérifiée par restauration.
2. Projet de recette restauré depuis cette sauvegarde.
3. `PRECHECK_doublons_et_blocages.sql` — lecture seule, sortie archivée.
4. Migrations 01 à 10, dans l'ordre.
5. `VERIFY_niveau1.sql` — aucun verdict « BLOQUANT ».
6. Paramétrage : `campagne_active` + trois plafonds + taux de commission.
7. Rejouer les 199 cas contre la recette.
8. Test de concurrence.
9. Adapter le frontend.
10. Recette terrain complète.
11. Production, en fenêtre de faible activité.

**Aucun push, aucune fusion, aucun déploiement n'a été effectué.** La branche
`niveau1-regles-integrite` est locale.

## 14. Instructions de retour arrière

`docs/migrations/niveau1/ROLLBACK_niveau1.sql`, exécuté et vérifié (T12) :
aucune donnée perdue, politiques d'origine rétablies, colonnes conservées.

**Le retour arrière fait retomber les neuf verrous P0 en une transaction.** Ce
n'est jamais une position d'attente : il s'accompagne d'une suspension immédiate
des opérations financières. Détail : `docs/niveau1/11_RETOUR_ARRIERE.md`.

## 15. Scénario de recette terrain

`docs/niveau1/12_PLAN_RECETTE_TERRAIN.md` — cinq phases : technique,
fonctionnelle, hors ligne sur vrai téléphone, protocole papier, puis une semaine
d'épreuve d'usage sur un seul cluster, **sans argent réel**.

## 16. Recommandation

**Go sous réserves**, dans cet ordre strict, aucun jalon sautable :

1. projet Supabase de recette ;
2. pré-contrôle et lecture de sa sortie ;
3. migrations et vérification sur la recette ;
4. adaptation du frontend ;
5. recette terrain complète ;
6. décision écrite du propriétaire ;
7. **puis seulement** production.

Une note de 8,65/10 ne signifie pas que FBMS est prêt pour de l'argent réel. Elle
signifie que cette intervention satisfait largement sa grille technique, et que
ce qui manque est identifié, chiffré et planifié.

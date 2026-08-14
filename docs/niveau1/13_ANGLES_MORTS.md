# Registre des angles morts — Niveau 1

Date : 14 août 2026

Ce registre recense ce que cette intervention **ne couvre pas**, ou ne couvre
qu'imparfaitement. Il est délibérément explicite : un angle mort connu et écrit
est un risque géré ; un angle mort tu est un incident à venir.

## Classement

| Réf | Sujet | Criticité | État |
|---|---|---|---|
| A-01 | Un refus n'écrit pas sa ligne d'audit dans la même transaction | P1 | atténué |
| A-02 | Aucune vraie clé étrangère : `rt_id` est `text`, `rt.id` est `uuid` | P1 | atténué |
| A-03 | État réel de la base de production inconnu | ~~P0~~ | **FERMÉ 14/08 — pré-contrôle exécuté** |
| A-04 | Un seul Branch Manager actif en production : contrôle à quatre yeux impossible | **P0** | **confirmé sur pièce** |
| A-05 | Paiements et commissions n'ont pas d'entité propre | P1 | ouvert |
| A-06 | Pas de rôle « auditeur » strictement en lecture | P2 | ouvert |
| A-07 | Aucun ordonnanceur pour la détection par lot | P1 | ouvert |
| A-08 | Le frontend n'a pas été adapté aux nouvelles règles | **P0** | **ouvert** |
| A-09 | Le banc d'essai n'est pas Supabase | P1 | atténué |
| A-10 | Dérive de schéma : 17 fonctions `sacherie_ct_*` en base, aucune DDL au dépôt | P1 | **confirmé et mesuré** |
| A-11 | Dépôt public sur GitHub pour une application financière | P1 | ouvert |
| A-12 | Un propriétaire de base peut désactiver un trigger | P2 | atténué |
| A-13 | Preuves stockées comme références textuelles, pas comme fichiers | P1 | ouvert |
| A-14 | Aucun test de charge ni de concurrence réelle multi-connexions | P1 | partiel |
| A-15 | `TRUNCATE` et `DELETE` accordés à `anon` et `authenticated` sur toutes les tables sensibles | P1 | **découvert 14/08** |

---

## A-01 · L'audit d'un refus ne survit pas au ROLLBACK

**Fait.** PostgreSQL n'a pas de transaction autonome. Quand un trigger refuse une
écriture, il lève une exception ; la ligne `n1_audit` insérée juste avant est
annulée avec le reste.

**Pourquoi ce n'est pas corrigé « proprement ».** Bloquer l'écriture prime sur la
tracer. Les alternatives — procédure avec `COMMIT`, `dblink`, `pg_background` —
ajouteraient une complexité et des dépendances disproportionnées.

**Atténuations en place.** `RAISE WARNING` vers le journal PostgreSQL, non annulé
par le `ROLLBACK` et conservé par Supabase ; `n1_journaliser_refus()` et
`n1_signaler_tentative()` appelées par le client dans une nouvelle transaction ;
détection par lot en rattrapage.

**Risque résiduel.** Un client qui n'appelle pas ces RPC laisse le refus visible
seulement dans les journaux serveur.

---

## A-02 · Aucune vraie clé étrangère sur les liens métier

**Fait.** `achats.rt_id` et `achats.producteur_id` sont de type `text` ; les
référentiels ont des `uuid`. Une vraie FK exigerait de convertir les colonnes,
donc de réécrire l'historique — destructif, exclu par le cadre.

**Atténuation.** `n1_achat_garde()` refuse tout achat dont le RT ou le producteur
est absent du référentiel (T02).

**Risque résiduel.** Une FK protégerait aussi contre la **suppression** d'un RT
encore référencé ; le trigger ne le fait pas. Un RT supprimé laisserait des
achats orphelins.

**Action.** Convertir les colonnes lors d'une fenêtre de maintenance dédiée,
après export vérifié. Hors périmètre du Niveau 1.

---

## A-03 · État réel de la production — FERMÉ le 14/08/2026

**Résolu.** Le pré-contrôle a été exécuté en **lecture seule** sur
`jmbdgpdthzpszfnddwzi` (PostgreSQL 17.6). Résultats complets :
`14_PRECONTROLE_PRODUCTION_20260814.md`.

Les trois inconnues sont levées :

1. la Sacherie V2 **est appliquée**, plus 17 fonctions Control Tower absentes du
   dépôt (voir A-10) ;
2. `audit_log` existe (730 lignes) et `achats_numero_recu_unique_idx` **existe**,
   avec une portée **globale** — le reçu dupliqué n'était donc pas un P0 ouvert
   en production, contrairement à ce que laissait craindre la lecture du dépôt ;
3. l'historique ne contient **aucun** doublon, aucune incohérence, aucun solde
   négatif — et pratiquement aucune donnée : 1 achat, 2 avances, 11 mouvements
   de sacs.

**Conséquence.** Le risque de migration lié aux données est levé. Les contraintes
pourraient même être posées en `VALIDATE` ; elles restent en `NOT VALID` par
prudence si la base évolue d'ici l'application.

---

## A-04 · Un seul Branch Manager actif — CONFIRMÉ SUR PIÈCE, reclassé P0

**Fait, mesuré le 14/08.** La base ne compte que **trois profils actifs** :
1 Branch Manager, 1 Supervisor, 1 Agent Recenseur.

`n1_approuver_ajustement` refuse l'approbation par le demandeur **et** par
l'auteur de l'écriture d'origine. Avec un seul BM qui saisit aussi, **aucune
correction ne peut être approuvée**. Ce n'est plus une hypothèse : c'est l'état
de la production.

**Ce n'est pas un défaut technique** — c'est la traduction fidèle de l'exigence
de séparation. Mais laissé tel quel, il paralysera le terrain dès la première
erreur de pesée à corriger.

**Reclassé P0** parce qu'il bloque une opération courante, pas un cas rare. Le
choix appartient au programme (options A, B ou C, document 04 §6) et n'a
délibérément pas été tranché dans le code.

---

## A-05 · Paiements et commissions n'ont pas d'entité propre

**Fait.** Un paiement est aujourd'hui un attribut de l'achat (`montant`,
`mode_paiement`), et la commission une colonne (`commission_rt`). Le Lot A
demandait des identifiants pour l'un et l'autre.

**Conséquence.** Un paiement partiel, un paiement différé ou un paiement groupé
ne sont pas représentables. La réconciliation calcule les commissions dues, mais
ne peut pas les rapprocher de commissions **payées** — cette donnée n'existe pas.

**Action.** Créer `n1_paiements` et `n1_commissions` au Niveau 2. Cela suppose
d'abord une décision métier sur le mode de règlement des commissions RT.

---

## A-07 · Aucun ordonnanceur

**Fait.** FBMS est un site statique : rien dans le dépôt ne peut exécuter une
tâche périodique. `n1_detecter_anomalies()` et
`n1_papier_cloture_quotidienne()` doivent être déclenchées manuellement.

**Options.** `pg_cron` côté Supabase, une fonction Edge planifiée, ou un
déclenchement depuis le Command Center à l'ouverture de session. Aucune n'a été
mise en place : toutes touchent des zones que le dépôt interdit à un agent.

---

## A-08 · Le frontend n'a pas été adapté — P0

**Fait.** Aucun fichier de `shared/`, `terrain/` ou `fbms/` n'a été modifié.
`CLAUDE.md` classe la logique métier JavaScript en revue humaine obligatoire, et
`shared/auth-gate.js` est formellement interdit.

**Conséquence directe, à ne pas sous-estimer.** Après application des migrations :

- une insertion directe dans `public.avances` échoue — le module Cash cesse de
  fonctionner tant qu'il n'appelle pas `n1_ouvrir_cycle()` ;
- un achat sans campagne active configurée échoue ;
- un achat au reçu dupliqué échoue — `shared/anagroci-audit.js:70` sait déjà
  intercepter ce cas, mais sous un autre nom d'index ;
- les messages d'erreur PostgreSQL remonteront bruts à l'utilisateur.

**Action.** La mise en production doit être **coordonnée** : adaptation du
frontend et migrations livrées ensemble. C'est le principal chantier restant.

---

## A-09 · Le banc d'essai n'est pas Supabase

**Fait.** Les 199 cas s'exécutent sur PGlite — PostgreSQL 18.3 authentique,
compilé en WebAssembly — parce que Docker, WSL et les droits administrateur sont
indisponibles sur ce poste (vérifié).

**Écart de version constaté le 14/08** : la production tourne sur **PostgreSQL
17.6**, le banc sur 18.3. Rien de ce qui est employé ici n'est propre à la 18
(colonnes générées : ≥ 12 ; `ON CONFLICT … WHERE` : ≥ 9.5 ; `attgenerated` :
≥ 12), mais l'écart doit être refermé en rejouant les scénarios sur un projet de
recette en 17.6.

**Ce que le banc prouve.** Que les contraintes, triggers, fonctions et politiques
RLS refusent bien ce qu'ils doivent refuser. C'est du vrai PostgreSQL, pas un
simulacre.

**Ce qu'il ne prouve pas.** Le comportement de PostgREST, des jetons JWT réels,
du rôle `service_role`, ni la version exacte de PostgreSQL de Supabase.
`auth.uid()` est émulée par un paramètre de session.

**Action.** Rejouer les scénarios sur un projet Supabase de recette avant tout
pilote avec de l'argent réel.

---

## A-12 · Un propriétaire de base peut désactiver un trigger

**Fait.** Le journal d'audit est protégé par un trigger `BEFORE UPDATE OR DELETE`
qui rejette l'opération — y compris pour le propriétaire de la table (vérifié,
T03). Mais `ALTER TABLE … DISABLE TRIGGER` reste possible pour le propriétaire.

**Atténuation.** `VERIFY_niveau1.sql` contrôle que chaque trigger est actif
(`tgenabled = 'O'`). Ce contrôle doit être rejoué périodiquement.

**Limite honnête.** Une protection totale contre le propriétaire de la base est
hors de portée d'une solution purement SQL. Elle relève de la gestion des accès
Supabase : qui détient la clé `service_role`, et où elle est stockée.

---

## A-13 · Les preuves sont des références, pas des fichiers

**Fait.** Les champs `preuve`, `preuve_requise`, `preuve_resolution` sont du
texte : « PV-CAISSE-001 ». Rien ne vérifie que ce document existe.

**Conséquence.** Un déblocage de cycle peut être justifié par une référence
inventée. La traçabilité de la décision est assurée ; celle de la pièce ne l'est
pas.

**Action.** Rattacher les preuves à Supabase Storage, avec empreinte SHA-256 —
comme le fait déjà FieldTrack. Niveau 2.

---

## A-14 · Concurrence testée logiquement, pas sous charge

**Fait.** La sérialisation des soldes repose sur le verrou de ligne pris par
`UPDATE`, et les ouvertures de cycle sur `pg_advisory_xact_lock`. Le mécanisme
est correct par construction et vérifié fonctionnellement.

**Limite.** PGlite est mono-connexion : deux transactions réellement simultanées
n'ont pas pu être jouées. Le comportement sous contention — attente, interblocage
éventuel, délai — n'est pas mesuré.

**Action.** Test de concurrence sur le projet de recette : deux sessions
psql simultanées tentant le même décrément de solde et la même ouverture de
cycle. Bloquant avant pilote.

---

## A-15 · `TRUNCATE` et `DELETE` accordés à `anon` et `authenticated` — P1

**Fait, constaté le 14/08.** Sur **toutes** les tables sensibles — `audit_log`,
`achats`, `avances`, `sacs_mouvements`, `reconciliations`, `profils`, `rt`,
`villages`, `producteurs`, `bag_movement_requests` — les rôles `anon` et
`authenticated` détiennent `TRUNCATE` et `DELETE`.

**Ce que la RLS couvre, et ce qu'elle ne couvre pas.**
`DELETE` est neutralisé : sur `audit_log`, `avances`, `reconciliations`,
`sacs_mouvements` et `bag_movement_requests`, aucune politique `DELETE` n'existe,
donc la RLS refuse. **`TRUNCATE`, lui, n'est pas soumis à la RLS** : il effacerait
la table entière, y compris les 730 lignes d'`audit_log`.

**Exploitabilité réelle — sans dramatiser.** PostgREST n'expose aucun verbe
`TRUNCATE`, et la vérification montre qu'**aucune fonction `SECURITY DEFINER`
n'est exécutable par `anon`**. Il faudrait une connexion PostgreSQL directe, donc
le mot de passe de la base. C'est une faiblesse de **défense en profondeur**, pas
une brèche ouverte par la clé publique.

**Pourquoi la fermer quand même** : ces droits ne servent à aucune fonctionnalité
de FBMS. Les laisser, c'est garder une porte dont personne n'a besoin.

**Correctif**, indépendant du Niveau 1 :

```sql
revoke truncate on all tables in schema public from anon, authenticated;
revoke delete on public.audit_log, public.avances, public.reconciliations,
                 public.sacs_mouvements, public.bag_movement_requests
       from anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated;
```

Une fonction, `rcn_etl_refresh` (`SECURITY DEFINER`), contient un `TRUNCATE` —
vraisemblablement sur une table de préparation. Non exécutable par `anon`.
À examiner lors du versement de la dérive de schéma (A-10).

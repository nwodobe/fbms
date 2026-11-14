# Pré-contrôle exécuté sur la base de production — résultats réels

Date d'exécution : 14 août 2026
Projet : `jmbdgpdthzpszfnddwzi` (« FIELD BUYING ANAGROCI ») · **PostgreSQL 17.6**
Nature : **lecture seule.** Uniquement des `SELECT`. Aucune écriture, aucun DDL,
aucune migration. Résultats agrégés — aucun nom de producteur, aucun numéro de
téléphone, aucun montant individuel n'a été extrait.

> Ce document remplace les hypothèses du diagnostic initial (`00_DIAGNOSTIC.md`
> §10) par des faits constatés. Il en corrige trois.

---

## 1. Volumétrie réelle — le fait déterminant

| Table | Lignes |
|---|---:|
| `achats` | **1** |
| `avances` | **2** |
| `reconciliations` | **0** |
| `sacs_mouvements` | **11** |
| `bag_movement_requests` | 0 |
| `audit_log` | 730 |
| `rt` | 125 |
| `villages` | 76 |
| `producteurs` | 7 |
| `profils` | 3 |

**La base ne contient pratiquement aucune donnée opérationnelle.** Le référentiel
est chargé (125 RT, 76 villages), mais les écritures financières se comptent sur
les doigts d'une main.

Conséquence directe : **le risque de migration est quasi nul.** Il n'y a pas
d'historique à régulariser, pas de verrou long à craindre sur la réécriture de
`achats`, pas d'arbitrage à rendre sur le rattachement rétroactif des cycles.

## 2. Aucun obstacle aux nouvelles contraintes

Tous les contrôles bloquants retournent **zéro**.

| Contrôle | Résultat |
|---|---:|
| Reçus dupliqués (par RT, normalisés) | **0** |
| Achats dont le RT est hors référentiel | **0** |
| Achats dont le producteur est hors référentiel | **0** |
| Achats sans identifiant local | **0** |
| Achats sans auteur | **0** |
| Achats datés dans le futur | **0** |
| Montants incohérents avec poids × prix | **0** |
| Pesées incohérentes | **0** |
| RT en solde de sacs négatif | **0** (plus bas solde : +55) |

**Les contraintes pourraient être posées directement en `VALIDATE`.** Elles
restent néanmoins livrées en `NOT VALID` : c'est le comportement sûr si la base
évolue entre ce constat et l'application réelle. La validation se fait ensuite en
une ligne, sans risque.

## 3. Trois corrections à mon diagnostic

### 3.1 P0-1 — le reçu dupliqué était DÉJÀ bloqué en production

`achats_numero_recu_unique_idx` **existe bien** :

```sql
CREATE UNIQUE INDEX achats_numero_recu_unique_idx ON public.achats
  USING btree (lower(TRIM(BOTH FROM numero_recu)))
  WHERE ((numero_recu IS NOT NULL) AND (length(TRIM(BOTH FROM numero_recu)) > 0));
```

Son DDL n'est **nulle part dans le dépôt** — seul `shared/anagroci-audit.js:70`
en connaissait le nom. Mon diagnostic le signalait comme « statut réel inconnu »,
ce qui était exact, mais je l'ai classé P0 ouvert. **En production il ne l'est
pas.** La correction est importante : le risque de double paiement par reçu
dupliqué n'était pas ouvert sur la vraie base.

**Les deux index sont complémentaires, il faut garder les deux :**

| Index | Portée | Normalisation |
|---|---|---|
| `achats_numero_recu_unique_idx` (production) | **globale** — plus stricte | `lower(trim())` seulement |
| `achats_recu_campagne_rt_uidx` (migration 02) | campagne + RT — plus large | supprime **toute** ponctuation : attrape `R/0001` vs `R-0001` |

Aucun des deux ne remplace l'autre. La migration 02 n'en supprime aucun : elle
ajoute le sien. Le résultat est l'union des deux protections.

> Conséquence sur la décision de périmètre documentée en
> `03_MATRICE_IDENTIFIANTS_CONTRAINTES.md` §3 : elle devient largement théorique.
> La production impose déjà l'unicité globale et n'a produit aucun faux rejet —
> sur un volume, il est vrai, très faible. Le sujet est à revoir après la
> première campagne réelle.

### 3.2 A-03 — l'état de la production n'est plus inconnu

L'angle mort A-03 était classé P0 faute d'accès. Il est **fermé** : la base a été
inspectée en lecture seule, sa volumétrie et sa conformité sont connues.

### 3.3 A-10 — la dérive de schéma est confirmée et mesurée

La migration Sacherie V2 **est appliquée** : ses 12 fonctions sont présentes.

S'y ajoutent **17 fonctions `sacherie_ct_*`** (Control Tower) dont **aucune DDL
n'existe dans le dépôt** — elles ne sont décrites que dans
`docs/sacherie_control_tower_sql_plan_20260811.md` :

```
sacherie_ct_assert_location_access   sacherie_ct_locations
sacherie_ct_backfill                 sacherie_ct_pertes
sacherie_ct_bridge_trigger           sacherie_ct_project_mouvement
sacherie_ct_decider_perte            sacherie_ct_slug
sacherie_ct_declarer_perte           sacherie_ct_snapshot
sacherie_ct_inventorier              sacherie_ct_traiter_etat
sacherie_ct_location                 …
```

`rcn_jute_settings` (1 ligne) et `rcn_jute_transfers` (0) existent également,
sans DDL au dépôt.

**Le dépôt n'est pas la source de vérité de la base.** Il faudrait extraire ces
objets de la production et les verser dans `supabase/` — travail à part entière,
hors périmètre du Niveau 1, mais à ne pas laisser dormir : personne ne peut
aujourd'hui reconstruire cette base à partir du dépôt.

## 4. Deux constats nouveaux

### 4.1 A-04 est confirmé sur pièce : il n'y a qu'UN Branch Manager

| Rôle actif | Nombre |
|---|---:|
| Branch Manager | **1** |
| Supervisor | 1 |
| Agent Recenseur | 1 |

Le contrôle à quatre yeux sur les ajustements est donc **actuellement
impossible** : le seul BM ne peut approuver ni sa propre correction, ni celle
d'une écriture dont il est l'auteur. Ce n'est pas un défaut des migrations, c'est
la traduction fidèle de l'exigence de séparation. Décision requise
(`04_MATRICE_ROLES_PERMISSIONS.md` §6).

### 4.2 Droits `TRUNCATE` et `DELETE` accordés à `anon` et `authenticated` — P1

Sur **toutes** les tables sensibles — `audit_log`, `achats`, `avances`,
`sacs_mouvements`, `reconciliations`, `profils`, `rt`, `villages`,
`producteurs`, `bag_movement_requests` — les rôles `anon` et `authenticated`
détiennent les privilèges `TRUNCATE` et `DELETE`.

**Ce que cela veut dire, exactement :**

- **`DELETE` est neutralisé par la RLS.** Sur `audit_log`, `avances`,
  `reconciliations`, `sacs_mouvements` et `bag_movement_requests`, il n'existe
  aucune politique `DELETE` : la RLS refuse donc l'opération. Sur les autres, la
  politique existante la réserve au Branch Manager.
- **`TRUNCATE`, lui, n'est PAS soumis à la RLS.** Un `TRUNCATE` réussi effacerait
  la table entière, politiques comprises — y compris les 730 lignes d'`audit_log`.

**Ce n'est pas exploitable avec la clé publique**, et je ne veux pas dramatiser :
PostgREST n'expose aucun verbe `TRUNCATE`, et la vérification montre qu'**aucune
fonction `SECURITY DEFINER` n'est exécutable par `anon`**. Il faudrait une
connexion PostgreSQL directe — donc le mot de passe de la base — pour s'en
servir.

C'est donc une **faiblesse de défense en profondeur (P1)**, pas une brèche
ouverte. Elle mérite d'être fermée parce qu'elle ne sert à rien : aucune
fonctionnalité de FBMS n'a besoin de ces droits.

Une fonction, `rcn_etl_refresh` (`SECURITY DEFINER`), contient un `TRUNCATE` —
vraisemblablement sur une table de préparation ETL. Elle n'est pas exécutable par
`anon`. À examiner lors du versement de la dérive de schéma.

**Correctif, à appliquer indépendamment du Niveau 1 :**

```sql
-- Aucun rôle applicatif n'a besoin de TRUNCATE. La RLS ne protège pas de lui.
revoke truncate on all tables in schema public from anon, authenticated;

-- DELETE reste utile là où une politique l'encadre ; ailleurs il est inutile.
revoke delete on public.audit_log, public.avances, public.reconciliations,
                 public.sacs_mouvements, public.bag_movement_requests
       from anon, authenticated;

-- Et pour l'avenir :
alter default privileges in schema public revoke truncate on tables from anon, authenticated;
```

> La migration 01 du Niveau 1 pose déjà, sur `n1_audit`, un trigger
> `BEFORE TRUNCATE` qui rejette l'opération **même pour le propriétaire de la
> table**. Le même garde pourrait être posé sur `audit_log`. Ce n'est pas fait
> ici : `audit_log` n'appartient pas au périmètre du Niveau 1 et sa DDL n'est pas
> au dépôt.

## 5. Ce que le pré-contrôle change pour le déploiement

| Jalon du guide de migration | Avant ce constat | Après |
|---|---|---|
| Restaurer une sauvegarde en recette | indispensable pour mesurer l'historique | **toujours recommandé**, mais le risque data est levé |
| Décider de la régularisation de l'historique | attendu | **sans objet** — rien à régulariser |
| Rattachement rétroactif des cycles | arbitrage attendu | **sans objet** — 2 avances, 1 achat |
| Fenêtre de maintenance pour la réécriture de `achats` | à mesurer | **négligeable** — 1 ligne |
| Adapter le frontend | indispensable | **inchangé, et c'est le vrai sujet** |

## 6. Requêtes exécutées

Cinq requêtes, toutes en lecture seule :

1. présence des objets attendus + volumétrie estimée ;
2. comptages exacts, doublons de reçus, intégrité référentielle, cohérence
   monétaire et physique, soldes négatifs, état des cycles ;
3. inventaire des fonctions `sacherie*`, index d'unicité sur `achats`, colonnes
   et politiques d'`audit_log`, tables sans RLS, droits `anon`/`authenticated` ;
4. privilèges `TRUNCATE`/`DELETE` et politiques `DELETE` par table sensible ;
5. fonctions contenant un `TRUNCATE`, fonctions `SECURITY DEFINER` exécutables
   par `anon`, décompte des profils actifs par rôle.

Aucune donnée personnelle n'a été lue ni restituée.

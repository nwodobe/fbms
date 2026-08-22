# 07 — Contrôle d'accès, rôles et isolation entre utilisateurs

**Données brutes** : `tests/reports/donnees/04-securite.json`, `tests/reports/donnees/01-parcours-pages.json`
**Rejouer** : `node tests/e2e/04-securite-acces.mjs`

## Portée : ce que ce rapport prouve, et ce qu'il ne prouve pas

| Type de constat | Portée |
|---|---|
| **Navigation** — quelle page s'ouvre pour quel rôle | **Vaut pour la production.** Exécuté sur les octets réels des pages, dans un vrai navigateur. |
| **Modèle d'accès** — cohérence entre le portail JavaScript et les politiques SQL | **Vaut comme audit de conception.** Lecture croisée du code et de `supabase/*.sql`, plus exécution contre un émulateur qui applique les politiques **telles qu'elles sont déclarées**. |
| **Déploiement effectif de la RLS** sur le projet Supabase | **`NON CONFIRMÉ`.** Cela ne se vérifie qu'en interrogeant la production, injoignable depuis cet environnement (01-MAPPING §0). Toute la sécurité réelle repose sur ce point : `SECURITE.md` le dit lui-même — « le portail JavaScript ne protège rien seul ». |

**La première chose à faire le jour où la production est joignable** est de vérifier que les
politiques sont actives :

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
select proname, prosrc from pg_proc where proname in ('est_bm','est_actif','peut_editer_terrain','peut_editer_config');
```

---

## 1. Architecture de sécurité telle qu'elle est écrite

Deux couches, comme documenté dans `SECURITE.md` :

| Couche | Fichier | Ce qu'elle fait | Ce qu'elle ne fait pas |
|---|---|---|---|
| Portail JavaScript | `shared/auth-gate.js` | Masque l'interface par un calque, vérifie la session Supabase, lit `profils`, applique la table `ACCESS` par module | Ne protège aucune donnée : la clé publiable est visible dans les pages, la base est interrogeable directement |
| Politiques RLS | `supabase/rls.sql` + `achats.sql`, `cash.sql`, `sacs.sql`, `rcntrace.sql` | Refuse les lignes à la source | Ne masque rien à l'écran |

La table `ACCESS` (`shared/auth-gate.js:43`) :

```js
{ portail:["bm","chef","agent","direction"], fbms:["bm","chef","agent"],
  achats:["bm","chef","agent"], cash:["bm","chef"], sacs:["bm","chef","agent"],
  command:["bm","direction"], hubs:["bm","chef","agent","direction"],
  carte:["bm","chef","agent","direction"], audit:["bm","chef"],
  logistique:["bm","chef"], rcntrace:["bm","chef","agent","direction"], admin:["bm"] }
```

Les fonctions d'aide de `supabase/rls.sql` :

```sql
create or replace function public.est_actif() … select exists (
  select 1 from public.profils where user_id = auth.uid() and actif = true)

create or replace function public.est_bm() … select exists (
  select 1 from public.profils
  where user_id = auth.uid() and actif = true and role = 'Branch Manager')

create or replace function public.peut_editer_terrain() … select public.mon_role() in
  ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
   'Supervisor','Agent Recenseur')

create or replace function public.peut_editer_config() … select public.mon_role() in
  ('Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer','Supervisor')
```

---

## 2. Résultats

| ID | Contrôle | Verdict | Portée |
|---|---|---|---|
| S-01 | Clé publiable seule : aucune donnée lisible (7 tables interrogées) | **conforme** — 0 ligne renvoyée | modèle / déploiement `NON CONFIRMÉ` |
| S-02 | Compte désactivé : accès aux données | **conforme** — 0 ligne | modèle / déploiement `NON CONFIRMÉ` |
| S-03 | Matrice d'écriture par rôle (11 combinaisons) | **conforme** — 11/11 | modèle / déploiement `NON CONFIRMÉ` |
| S-04 | Cloisonnement des profils | **conforme** — l'agent voit 1 profil, le BM les voit tous | modèle / déploiement `NON CONFIRMÉ` |
| S-05 | Cloisonnement des données par zone ou cluster | **défaut** — BM 40, Superviseur 40, Agent 40, Consultation 40 : tous voient tout | modèle |
| S-06 | « Consultation uniquement » face aux montants | **défaut** — lit directement `achats` (montants, producteurs, n° de reçus) | modèle |
| S-07 | Accès direct par URL à un module interdit (24 combinaisons) | **conforme** — 24/24 conformes à la table `ACCESS` | **production** |
| S-08 | Rôle falsifié dans le cache local | **conforme** — l'écran d'administration reste fermé ; la base refuse (HTTP 403) | production + modèle |
| S-09 | Secrets serveur dans les fichiers publiés | **conforme** — aucun | **production** |
| S-10 | Deux sessions simultanées | **conforme** — aucun mélange d'identité | **production** |
| S-11 | Jeton fabriqué de toutes pièces | **conforme** — 0 ligne | modèle / déploiement `NON CONFIRMÉ` |
| S-12 | Toutes les pages passent par le portail | **défaut** — 5 pages sans portail | **production** |
| S-13 | FBMS Référentiel sans session / compte désactivé | **défaut** — interface ouverte (23 à 24 boutons actifs), **mais 0 donnée visible** | **production** |
| S-14 | Rôles du portail vs rôles reconnus par la RLS | **défaut** — 8 rôles sur 15 inconnus de `peut_editer_terrain()` | modèle |

**9 conformes sur 14.** Les cinq écarts sont S-05, S-06, S-12, S-13 et S-14.

### Trois précisions qui comptent

**S-13 — l'interface s'ouvre, la donnée ne suit pas.** Sans aucune session, `fbms/index.html`
affiche son interface complète (23 boutons actifs) mais **zéro village** : la RLS de l'émulateur
fait son travail. Avec un compte désactivé, même résultat. Le risque de BUG-001 est donc un
risque **d'exposition d'interface et de cache local**, pas de fuite de données du serveur — à
condition que la RLS soit réellement déployée en production, ce qui reste `NON CONFIRMÉ`.

**S-08 — le repli hors ligne ne se laisse pas détourner.** Falsifier le profil mis en cache
(`anagroci_profile_<uid>` avec `role: "Branch Manager"`) pendant que la lecture de `profils`
échoue **n'ouvre pas** l'écran d'administration, et la base refuse la création de compte
(HTTP 403). Le mécanisme de travail hors ligne n'est pas une porte dérobée.

**Deux corrections apportées à ce rapport de test lui-même.** Une première exécution signalait
un secret dans `fbms/index.html` : le motif de recherche trouvait le mot `service_role` dans le
commentaire de la ligne 269, qui dit précisément de ne jamais y mettre la clé. Le contrôle
cherche désormais du matériel de clé, commentaires retirés. Une autre exécution signalait un
défaut de cloisonnement des profils : l'assertion comptait un nombre fixe de profils alors que
le contrôle S-03 en avait créé un de plus. Les deux verdicts étaient faux ; ils sont corrigés.

---

## 3. Le défaut structurant : les deux couches ne parlent plus des mêmes rôles

C'est le constat le plus important de ce rapport, et il ne demande aucune exécution pour être
vérifié — seulement de lire les deux fichiers côte à côte.

L'écran d'administration (`shared/admin.html:88`) propose les rôles de `shared/aflp-access.js` :

| Rôle proposé par l'administration | Niveau accordé par le portail | Reconnu par `peut_editer_terrain()` | Reconnu par `est_bm()` |
|---|---|---|---|
| Branch Manager | bm | oui | **oui** |
| **Branch Manager / Head of Programme** | bm | **non** | **non** |
| Assistant Branch Manager | bm | oui | non |
| Head of Field | bm | oui | non |
| Procurement Officer | bm | oui | non |
| Supervisor | chef | oui | non |
| Agent Recenseur | agent | oui | non |
| Consultation uniquement | direction | non (normal) | non |
| **Zonal Head** | chef | **non** | non |
| **Logistics Coordinator** | chef | **non** | non |
| **Unit Head** | chef | **non** | non |
| **Assistant Unit Head** | chef | **non** | non |
| **Warehouse Keeper** | agent | **non** | non |
| **Finance / Controller** | chef | **non** | non |
| **RT / Field Partner** | agent | **non** | non |
| **Read Only / Audit** | direction | non (normal) | non |

Sept rôles ouvrent des écrans de saisie que la base refusera d'alimenter.

Et un cas plus sérieux encore, qui existe **déjà avec les libellés historiques** :
`shared/auth-gate.js:estBM()` renvoie vrai pour tout rôle de niveau `bm`, c'est-à-dire pour
**quatre** rôles — Branch Manager, Assistant Branch Manager, Head of Field, Procurement Officer
— plus, depuis AFLP, « Branch Manager / Head of Programme ». Ces cinq comptes voient la roue
crantée, ouvrent l'écran d'administration, et voient la liste des comptes.

Côté base, `est_bm()` compare à la chaîne **exacte** `'Branch Manager'`. Les quatre autres
échouent. Concrètement, un Assistant Branch Manager, un Head of Field, un Procurement Officer
ou un « Branch Manager / Head of Programme » :

- ouvre l'écran d'administration,
- **ne peut créer aucun compte, ne peut changer aucun rôle, ne peut désactiver personne**,
- ne peut supprimer aucun achat,
- ne peut pas lire le journal d'audit.

L'écran s'ouvre et chaque action échoue. Ce n'est pas une faille de confidentialité — la base
tient bon — mais c'est une promesse d'interface que la base ne tient pas, sur la fonction
d'administration des accès.

Le plus révélateur : `supabase/20260818_farmer_registry_phase1_security.sql` **connaît** ces
rôles récents — il les utilise pour son mapping de périmètre (`'Zonal Head' then 'ZONE'`,
`'Unit Head' then 'CLUSTER'`, `'Warehouse Keeper' then 'CLUSTER'`). C'est `rls.sql`, le socle,
qui n'a pas suivi. Les deux moitiés du même modèle d'accès ont divergé.

`SECURITE.md` avertit précisément de ce risque : « Une modification de l'une des deux couches
sans l'autre casse la sécurité **ou** casse l'accès des utilisateurs légitimes. » C'est le
second cas qui s'est produit.

---

## 4. Cinq pages servies sans portail

Détaillé en BUG-001. Résumé : `fbms/index.html`, `logistique/index.html`, `logistique.html`,
`logistique/ancien.html` et `suite/index.html` ne chargent pas `shared/auth-gate.js` et
s'ouvrent entièrement pour un visiteur non connecté comme pour un **compte désactivé**.

Le cas qui compte opérationnellement : **désactiver un compte dans l'écran d'administration ne
referme pas le référentiel FBMS sur l'appareil de la personne.** L'interface reste manipulable
et son cache IndexedDB local reste lisible. Seules les données du serveur sont hors d'atteinte,
et uniquement si la RLS est réellement déployée — ce qui reste `NON CONFIRMÉ`.

---

## 5. Isolation entre utilisateurs

**Aucune fuite entre sessions n'a été observée** (critère NO-GO §19). Deux sessions simultanées
dans le même navigateur affichent chacune leur propre identité, et un agent ne lit que son
propre profil.

En revanche, il n'y a **aucun cloisonnement des données métier** : les politiques de lecture des
tables terrain sont `est_actif()`, sans filtre de périmètre. Tout compte actif lit tous les
villages, tous les producteurs, tous les achats et tous les montants, quels que soient son rôle
et sa zone.

Ce n'est pas une fuite au sens du cahier de charge — c'est un choix de conception, défendable
pour une branche unique où tout le monde travaille sur le même périmètre. Il devient un sujet
le jour où plusieurs branches partagent la base, ou si la confidentialité des montants par
équipe devient une exigence. À noter : `shared/aflp-access.js` et
`docs/migrations/aflp_acces_perimetres_20260816.sql` décrivent déjà un modèle de périmètres
(zone / cluster / village) qui n'est pas appliqué par `rls.sql`.

Cas particulier à trancher : le rôle **« Consultation uniquement »**. Le portail lui ferme les
modules Achats et Caisse ; la RLS le laisse lire directement les tables `achats` et `avances` —
montants, noms de producteurs, numéros de reçus — avec sa session et la clé publiable, qui est
publique par construction. **L'écran est fermé, la donnée ne l'est pas.**

---

## 6. Secrets

Aucune clé de service, jeton privé ou identifiant n'a été trouvé dans les fichiers HTML, JS, CSS
ou JSON servis. La seule clé exposée est la clé **publiable** Supabase
(`sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d`), ce qui est son usage normal et documenté.

La clé `service_role` reste côté serveur, dans la fonction Edge `admin-create-user`
(`supabase/functions/admin-create-user/index.ts`), conformément à ce que décrit `SECURITE.md`.

---

## 7. Ce qui n'a pas été testé

| Élément | Raison |
|---|---|
| Déploiement effectif des politiques RLS en production | `NON CONFIRMÉ` — base injoignable. **C'est la vérification la plus importante de tout ce rapport.** |
| Fonction Edge `admin-create-user` | `NON TESTÉ` — nécessite le projet Supabase |
| Politique du bucket Storage `recus` (les photos de reçus y sont-elles publiques ?) | `NON TESTÉ` — et d'autant plus à vérifier que `uploadRecu()` utilise `getPublicUrl()` |
| Politiques RLS des tables `rcn_*` (≈ 30 tables) | `NON TESTÉ` |
| Expiration et rotation réelles des jetons GoTrue | `NON TESTÉ` — l'émulateur délivre des jetons de durée fixe |
| Force des mots de passe, verrouillage après échecs répétés | `NON TESTÉ` — relève de la configuration du projet Supabase |

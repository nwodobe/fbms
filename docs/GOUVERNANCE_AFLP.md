# Gouvernance AFLP 2027 — rôles, périmètres et permissions

Ce document accompagne la refonte du module **FBMS Référentiel > Administration**
(v0.17). Il décrit le modèle mis en place côté application, et — surtout — **ce
qui reste à faire côté serveur pour que ce modèle devienne une vraie barrière**.

---

## 1. Ce que fait l'application, ce qu'elle ne fait pas

L'application applique désormais le périmètre à l'affichage, à l'édition, à la
validation, aux exports et aux recherches. Elle le fait **dans le navigateur**.

`SECURITE.md` le dit déjà pour le portail, et cela vaut ici mot pour mot : le
JavaScript ne protège rien. La clé publique Supabase est lisible dans les pages,
et n'importe qui peut appeler l'API directement.

> **État au 2026-08-16.** `public.profils` porte `user_id`, `nom`, `email`,
> `role`, `actif`. **Ni zone, ni cluster, ni village.** Les fonctions
> `mon_role()`, `est_bm()` et `peut_editer_terrain()` de `supabase/rls.sql` ne
> connaissent que le rôle. Tant que la section 4 de ce document n'est pas
> appliquée, **un Unit Head de Diabo qui interroge l'API atteint les données de
> Brobo**. L'écran Administration l'affiche explicitement en bandeau ; ce n'est
> pas un avertissement décoratif.

L'application est écrite **contre le schéma cible** : dès que les colonnes
existent, elle les lit et les écrit sans autre changement. Tant qu'elles sont
absentes, l'écran le signale et refuse d'enregistrer un périmètre, plutôt que de
laisser croire à un cloisonnement inexistant.

---

## 2. Modèle

```
USER
 ├── role            libellé AFLP, ou rôle hérité encore reconnu
 ├── zone            GBEKE 1 | GBEKE 2            (selon le rôle)
 ├── cluster         un des 6 clusters            (selon le rôle)
 ├── village         identifiant de fiche village (RT uniquement)
 ├── actif           statut du compte
 └── authorityLevel  déduit du rôle, non stocké
```

Hiérarchie des périmètres : `GLOBAL ▸ ZONE ▸ CLUSTER ▸ VILLAGE`. Un niveau donne
accès à son échelon et à ce qu'il contient, jamais à côté ni au-dessus.

### Référentiel organisationnel

| Zone | Clusters |
|---|---|
| GBEKE 1 | Djébonoua · Brobo · Sakassou |
| GBEKE 2 | Béoumi · Botro · Diabo |

Source unique : `AFLP_IA.referentiel().zones` (`shared/aflp-ia-moteur.js`,
surchargeable par le paramètre `aflp_zones` de `parametres_calcul`), avec le même
défaut recopié dans `AFLP_ZONES_DEFAUT` de `fbms/index.html` pour les pages qui
ne chargent pas le moteur. **Les deux doivent rester identiques.**

> Cette répartition a été rectifiée le 2026-08-16 par le Branch Manager :
> Sakassou et Diabo étaient intervertis dans la version du 2026-08-14.

Les clusters ne sont pas redéclarés ailleurs : les clusters réellement présents
dans les fiches restent lus par `villageClusterOptions()`.

---

## 3. Rôles et permissions

Neuf rôles, définis dans `AFLP_ROLES` / `ROLE_PERMISSIONS` (`fbms/index.html`).

| Rôle | Niveau | Périmètre requis | Domaines |
|---|---|---|---|
| Branch Manager / Head of Programme | GLOBAL | — | tous |
| Zonal Head | ZONE | zone | terrain (lecture/écriture/validation), financier et logistique en lecture |
| Logistics Coordinator | GLOBAL transversal | — | stock, sacs (écriture) ; achats, villages, RT, carto en lecture |
| Unit Head | CLUSTER | zone + cluster | opérationnel complet sur son cluster |
| Assistant Unit Head | CLUSTER | zone + cluster | idem sans `village:approve` ni `recon:write` |
| Warehouse Keeper | CLUSTER | zone + cluster | stock, sacs ; villages en lecture |
| Finance / Controller | GLOBAL transversal | — | caisse, réconciliation (écriture) ; référentiel terrain en lecture seule |
| RT / Field Partner | VILLAGE | zone + cluster + village | lecture de son seul village |
| Read Only / Audit | GLOBAL transversal | — | lecture, aucune écriture |

Vocabulaire des permissions : `domaine:action`, avec
`domaine ∈ {village, rt, producteur, achat, caisse, stock, sac, recon, carto, export, user}`
et `action ∈ {read, write, approve, delete, manage}`. `*` signifie tout.

### Point de décision unique

```js
can(utilisateur, "village:approve", ficheVillage)
```

`can()` croise la permission, le niveau d'autorité et le périmètre de la
ressource. Plus aucune comparaison de nom de rôle ne subsiste dans les écrans :
`canDelete()`, `canEditVillages()`, `canEditVillage()` et `statutsAutorises()`
délèguent toutes à `can()`.

### Rôles hérités

Les sept anciens rôles restent **reconnus avec exactement les droits qu'ils
avaient avant la refonte** (`ROLES_LEGACY`). Aucun compte n'est converti
d'office. L'écran Administration affiche « Utilisateurs à migrer » avec ancien
rôle, suggestion et motif ; la migration est une décision du Branch Manager,
compte par compte, tracée dans `audit_log`.

| Ancien rôle | Suggestion | Motif |
|---|---|---|
| Branch Manager | Branch Manager / Head of Programme | identique |
| Consultation uniquement | Read Only / Audit | équivalent direct |
| Head of Field | Zonal Head | vérifier la zone réellement couverte |
| Supervisor | Unit Head *ou* Zonal Head | selon le nombre de clusters couverts |
| Assistant Branch Manager | à arbitrer | aucun équivalent AFLP |
| Procurement Officer | conservé | peut rester si l'organisation l'utilise |
| Agent Recenseur | conservé | tant que des comptes actifs en dépendent |

---

## 4. À FAIRE côté serveur — sans quoi rien n'est protégé

Ces changements touchent `supabase/**`, hors du périmètre d'écriture des agents
(`agent-policy.yml`, `auto-merge-denylist.txt`). **À appliquer par un humain**,
après revue, sur une base sauvegardée.

### 4.1 Colonnes de périmètre

```sql
alter table public.profils add column if not exists zone    text;
alter table public.profils add column if not exists cluster text;
alter table public.profils add column if not exists village text;
alter table public.profils add column if not exists derniere_connexion timestamptz;

-- Cohérence zone/cluster : la combinaison GBEKE 1 + DIABO doit être impossible
-- en base, pas seulement refusée par le formulaire.
create table if not exists public.aflp_zones_clusters (
  zone    text not null,
  cluster text not null,
  primary key (zone, cluster)
);
insert into public.aflp_zones_clusters (zone, cluster) values
  ('GBEKE 1','Djébonoua'), ('GBEKE 1','Brobo'), ('GBEKE 1','Sakassou'),
  ('GBEKE 2','Béoumi'),    ('GBEKE 2','Botro'), ('GBEKE 2','Diabo')
on conflict do nothing;

alter table public.profils
  add constraint profils_zone_cluster_coherent
  check (
    zone is null or cluster is null
    or exists (select 1 from public.aflp_zones_clusters zc
               where zc.zone = profils.zone and zc.cluster = profils.cluster)
  ) not valid;   -- `not valid` : les lignes existantes ne sont pas rejetées
```

> Une contrainte `check` ne peut pas contenir de sous-requête en PostgreSQL. En
> pratique, remplacer par une clé étrangère composite vers
> `aflp_zones_clusters`, ou par un trigger `before insert or update`. Le point
> important est la règle, pas la forme retenue.

### 4.2 Fonctions d'aide

```sql
create or replace function public.mon_perimetre()
returns table (role text, zone text, cluster text, village text)
language sql stable security definer as $$
  select role, zone, cluster, village
  from public.profils
  where user_id = auth.uid() and actif = true
  limit 1
$$;

create or replace function public.mon_niveau()
returns text language sql stable security definer as $$
  select case public.mon_role()
    when 'Branch Manager' then 'GLOBAL'
    when 'Branch Manager / Head of Programme' then 'GLOBAL'
    when 'Logistics Coordinator' then 'GLOBAL'
    when 'Finance / Controller'  then 'GLOBAL'
    when 'Read Only / Audit'     then 'GLOBAL'
    when 'Zonal Head'            then 'ZONE'
    when 'Unit Head'             then 'CLUSTER'
    when 'Assistant Unit Head'   then 'CLUSTER'
    when 'Warehouse Keeper'      then 'CLUSTER'
    when 'RT / Field Partner'    then 'VILLAGE'
    else 'GLOBAL'   -- rôles hérités : comportement actuel préservé (§13)
  end
$$;

-- Une ligne « terrain » est-elle dans mon périmètre ?
create or replace function public.dans_mon_perimetre(p_cluster text, p_village text)
returns boolean language sql stable security definer as $$
  with moi as (select * from public.mon_perimetre())
  select case public.mon_niveau()
    when 'GLOBAL'  then true
    when 'ZONE'    then exists (
        select 1 from public.aflp_zones_clusters zc, moi
        where zc.cluster = p_cluster and zc.zone = moi.zone)
    when 'CLUSTER' then exists (select 1 from moi where moi.cluster = p_cluster)
    when 'VILLAGE' then exists (select 1 from moi where moi.village = p_village)
    else false
  end
$$;
```

`mon_niveau()` renvoie `GLOBAL` pour tout rôle non listé : c'est délibéré. Un
compte hérité ne doit pas perdre l'accès à cause de la migration (§13). Le
resserrer une fois les comptes migrés.

### 4.3 Politiques RLS

Les politiques `terrain` de `supabase/rls.sql` (lignes 66-78) sont générées en
boucle sur `villages`, `hubs_clusters`, `rt`, `producteurs`. Il faut y ajouter le
périmètre — pour la lecture **comme** pour l'écriture :

```sql
-- Exemple pour villages ; à décliner sur rt et producteurs.
drop policy if exists villages_sel on public.villages;
create policy villages_sel on public.villages for select to authenticated
  using (public.dans_mon_perimetre(cluster, id));

drop policy if exists villages_upd on public.villages;
create policy villages_upd on public.villages for update to authenticated
  using  (public.peut_editer_terrain() and public.dans_mon_perimetre(cluster, id))
  with check (public.peut_editer_terrain() and public.dans_mon_perimetre(cluster, id));
```

`rt` porte déjà `cluster` et `village_id`. `producteurs` doit être joint à
`villages` pour retrouver son cluster, ou porter une colonne dénormalisée
alimentée par trigger.

### 4.4 Gestion des comptes

`profils_upd_bm` réserve déjà l'écriture au Branch Manager : la pose d'un
périmètre est donc protégée. Vérifier qu'aucun rôle intermédiaire n'obtient
`user:manage` côté serveur.

### 4.5 Vérification

Après application, se connecter avec un compte Unit Head et exécuter depuis la
console du navigateur :

```js
await SB.from("villages").select("id, cluster").limit(50)
```

Le résultat **ne doit contenir que le cluster du compte**. Tant qu'il en contient
d'autres, le cloisonnement n'est pas en place, quoi qu'affiche l'application.

---

## 5. Audit

Toute action sensible de l'Administration écrit dans `public.audit_log` via
`auditAdmin()` : `user_create`, `user_role_change`, `user_role_migration`,
`user_perimetre_change`, `user_activate` / `user_deactivate`, `user_pin_reset`.

Chaque entrée porte l'auteur (email et rôle), la cible, l'ancienne et la nouvelle
valeur, l'horodatage client, le module et le chemin. La RLS d'`audit_log` est
déjà correcte : insertion ouverte à tout compte authentifié, lecture réservée au
Branch Manager.

L'échec d'écriture du journal ne bloque jamais l'action — il est signalé en
console. Rendre le journal bloquant est un choix à faire consciemment.

---

## 6. Ce qui n'a pas été touché

- **`shared/auth-gate.js`** — le portail de la suite décide encore de l'accès aux
  modules par `niveau(role)` sur les anciens noms. Les rôles AFLP n'y sont pas
  connus : un compte migré vers « Unit Head » **pourrait se voir refuser des
  modules hors FBMS**. À traiter avant toute migration massive. Fichier en refus
  d'écriture pour les agents.
- **`shared/admin.html`** — console d'administration séparée, non alignée.
- **`shared/anagroci-config.js`**, **`rcntrace/`**, **`terrain/`**,
  **`logistique/`** — comparent encore des noms de rôles littéraux.
- **`shared/i18n.js` / `i18n-extra.js`** — les nouveaux libellés ne sont pas
  traduits en anglais ; l'interface les affiche tels quels en mode EN.

---

## 7. Cas de test

| # | Scénario | Attendu |
|---|---|---|
| 1 | Branch Manager | 2 zones, 6 clusters, tous les écrans |
| 2 | Zonal Head GBEKE 1 | Djébonoua, Brobo, Sakassou uniquement |
| 3 | Unit Head Diabo | voit et gère Diabo ; Béoumi refusé |
| 4 | Assistant Unit Head Diabo | Diabo en écriture, pas d'approbation de fiche |
| 5 | Finance / Controller | données financières sur les 6 clusters, référentiel terrain en lecture |
| 6 | Warehouse Keeper | stock et sacs de son cluster, aucun accès Administration |
| 7 | Read Only / Audit | consultation ; toute écriture refusée |
| 8 | Compte au rôle hérité | fonctionne exactement comme avant la refonte |

Les cas 1 à 8 sont vérifiables dans l'application. **Ils ne valident que la
couche applicative** : la même série doit être rejouée contre l'API, après la
section 4, pour valider le cloisonnement réel.

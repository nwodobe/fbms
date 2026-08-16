# Refonte du module Administration — architecture d'accès AFLP 2027

> 16 août 2026 · demandeur : Branch Manager · portée : `fbms/index.html`,
> `shared/` et une migration Supabase **non appliquée**.

## 1. Ce que faisait FBMS avant

| Point | État constaté |
|---|---|
| Modèle utilisateur | table `profils` : `user_id, nom, email, role, actif`. Rien d'autre. |
| Droits | `user.role` comparé à une chaîne, à sept endroits différents (`AUTH.session.role === "Branch Manager"`, `EDIT_TERRAIN_ROLES`, `statutsAutorises`, `niveau()` dans `shared/auth-gate.js`, `ROLES.niveau()` dans `shared/anagroci-config.js`). |
| Périmètre géographique | **inexistant** côté comptes. Le cluster n'est qu'un texte dans `villages.data.s1.cluster`. |
| Rôles | 7 rôles génériques, sans lien avec l'organisation AFLP. |
| Audit | `audit_log` via `ANAGROCI.audit()` ; la création / le changement de rôle n'y écrivaient rien. |
| « Activation Terrain » | Bouton flottant injecté par **`shared/fbms-field-hardening.js`** (chargé par `fbms/index.html`). Il ouvre un panneau « Contrôle qualité FBMS · villages · RT · producteurs · préparation achats/caisse/sacs » (`renderActivation()`, `copyActivation()`). Il n'active aucun compte et n'a aucun lien avec les rôles. Le même fichier porte par ailleurs des garde-fous (`patchClearLocal`, `patchRemote`) qui, eux, comptent. |

## 2. Ce qui a été mis en place

### `shared/aflp-access.js` — nouveau, source unique de vérité
- Catalogue des **9 rôles AFLP** + **6 rôles historiques** conservés tels quels.
- Hiérarchie `GLOBAL > ZONE > CLUSTER > VILLAGE` (+ `TRANSVERSE` pour Logistique, Finance, Audit : périmètre large, permissions étroites).
- Référentiel **zone → clusters** (la seule donnée qui n'existait nulle part). `hydrateFromVillages()` compare ce référentiel aux clusters réellement écrits dans les fiches et signale les orphelins au lieu d'en inventer.
- Matrice `ROLE -> ["ressource:action"]` sur 18 ressources.
- **`can(user, action, resource, cible)`** : rôle + permission + statut + zone + cluster + village évalués ensemble. `refus()` produit le message.
- `filterByScope()` : à appeler avant tout affichage, recherche, statistique ou export.
- `migrationSuggestion()` : décrit ce qu'il y aurait à faire, ne convertit rien.
- `niveauPortail()` : traduit un rôle en niveau module (`bm/chef/agent/direction`) pour ne casser aucun module existant.

### `fbms/index.html` — patch ciblé
- `ROLES` / `ROLE_RIGHTS` dérivés du catalogue ; plus aucune liste de rôles en dur.
- `ME()` (utilisateur normalisé) et `can()` remplacent les tests dispersés dans `canDelete`, `canEditVillages`, `statutsAutorises`, `exportMaster`, la gestion des utilisateurs.
- `canEditVillages(v)` prend désormais **la fiche** : un Unit Head DIABO ne modifie pas une fiche BROBO, même en forçant l'identifiant.
- `getFilteredVillages()`, `RTView()`, `StatsView()` partent d'une liste déjà filtrée par périmètre — l'affichage, la recherche et les compteurs voient la même chose.
- Administration reconstruite : KPI (données réelles uniquement), cartes rôles + permissions dépliables, rôles historiques dans un bloc à part, tableau utilisateurs à 9 colonnes, 4 filtres combinables + recherche, formulaire de création dynamique (zone → cluster → village dépendants, villages lus dans le référentiel FBMS), fenêtre « Périmètre », panneau **Utilisateurs à migrer**.
- Chaque action sensible écrit dans le journal via `ACL.auditUser()` : création, changement de rôle, changement de périmètre, désactivation, réactivation, reset PIN — avec avant / après.

### `shared/auth-gate.js` et `shared/admin.html`
Modifications minimales : `niveau()` délègue à la couche d'accès (repli sur l'ancienne table si le fichier n'est pas chargé), la liste des rôles de la page Administration partagée suit le catalogue, et le profil est lu en `select("*")` pour rapatrier le périmètre.

> Ces deux fichiers sont sur la liste `auto-merge-denylist.txt`. Le changement est
> volontaire et demandé, mais il doit être relu et fusionné à la main.

### `shared/fbms-field-hardening.js`
Le bouton flottant « Activation Terrain » n'est plus affiché (arbitrage : « je n'ai pas besoin de ce bouton ») — il recouvrait la carte KPI « Villages prioritaires » et s'imposait à tous les rôles, Read Only et RT compris. Le panneau de contrôle qualité reste accessible par `FBMSHardening.openActivation()` et les garde-fous du fichier sont intacts. Aucune logique de compte n'était attachée à ce bouton : rien à reprendre dans le nouveau système de rôles.

### `docs/migrations/aflp_acces_perimetres_20260816.sql` — **non exécuté**
Tables `aflp_zones` / `aflp_clusters`, colonnes de périmètre sur `profils`,
contraintes de cohérence, fonctions `aflp_authority()`, `aflp_clusters_autorises()`,
`aflp_dans_perimetre()` réutilisables dans les politiques RLS. Section 4 (colonne
`villages.cluster_code` + politique d'écriture par cluster) volontairement laissée
à part : c'est elle qui rend le périmètre **opposable côté serveur**.

## 3. Non-régression

- Aucun compte supprimé, aucun rôle converti, aucun renommage en base.
- **Périmètre absent = périmètre non restreint.** Un compte à autorité ZONE / CLUSTER / VILLAGE dont la zone et le cluster ne sont pas encore enregistrés garde exactement son comportement actuel (`scopeOf().unset`), et ressort dans « Comptes à qualifier ». La restriction ne s'applique qu'à partir du moment où un périmètre est saisi — sans quoi tout Supervisor existant ouvrirait des écrans vides le jour du déploiement.
- Une fiche **sans cluster** n'entre dans aucun périmètre restreint : elle reste visible des rôles GLOBAL / TRANSVERSE et doit être rattachée avant d'être confiée à un Unit Head.
- Un rôle inconnu ou illisible tombe en consultation : le compte reste connectable et apparaît dans « Utilisateurs à migrer ».
- Sans les colonnes de périmètre (base non migrée), la page fonctionne : `select("*")` ne demande rien qui n'existe pas et les périmètres s'affichent « à renseigner ».
- Mode local hors ligne inchangé : sans backend ni session, l'appareil reste le périmètre.

## 4. Tests à passer avant fusion

| # | Cas | Attendu |
|---|---|---|
| 1 | Branch Manager | 2 zones, 6 clusters, administration complète |
| 2 | Zonal Head GBEKE 1 | voit Djébonoua / Brobo / Sakassou ; Béoumi, Botro, Diabo absents des listes, de la recherche et des compteurs |
| 3 | Unit Head DIABO | gère DIABO ; `openEdit` sur une fiche BÉOUMI refusé |
| 4 | Assistant Unit Head DIABO | saisie DIABO ; aucun statut de validation proposé |
| 5 | Finance / Controller | données financières sur les 6 clusters ; villages, producteurs, RT en lecture seule |
| 6 | Warehouse Keeper | stock / sacs ; carte Gestion des utilisateurs absente |
| 7 | Read Only / Audit | consultation ; aucune action d'écriture disponible ni acceptée |
| 8 | Compte « Supervisor » existant | se connecte, garde ses droits actuels, apparaît en migration |

Trois largeurs : 390×844, 768×1024, 1440×900.

## 5. Points ouverts

1. **La sécurité réelle reste à poser côté base.** Tant que la section 4 de la
   migration n'est pas appliquée, un utilisateur techniquement averti peut
   interroger Supabase hors application. L'écran est aligné, la serrure ne l'est
   pas encore.
2. Les 16 comptes de l'équipe AFLP ne sont **pas** créés : le Branch Manager les
   crée depuis Administration, rôle par rôle, avec leur périmètre.
3. Les RT n'ont aucun compte : l'architecture les accepte (`RT / Field Partner`,
   niveau VILLAGE), rien n'a été pré-rempli.
4. Le rôle Read Only est un profil global unique, conformément à l'arbitrage —
   la granularité par module reste possible via `profils.permissions` (jsonb).

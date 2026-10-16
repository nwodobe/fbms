# État initial des politiques RLS — villages et producteurs (production, 16/10/2026)

Relevé en lecture seule sur `pg_policies` du projet `jmbdgpdthzpszfnddwzi`, avant application de
`20261016_unit_head_village_cluster_scope.sql`. Sert de référence au retour arrière.

Combinaison PostgreSQL : (OU des politiques PERMISSIVES) ET (chaque politique RESTRICTIVE).

## public.villages

| Politique | Type | Commande | Condition |
|---|---|---|---|
| villages_write | PERMISSIVE | ALL | rôle ≠ Consultation (Agent Recenseur : ses fiches) |
| villages_ins | PERMISSIVE | INSERT | peut_editer_terrain() |
| villages_upd | PERMISSIVE | UPDATE | peut_editer_terrain() |
| villages_sel / villages_select | PERMISSIVE | SELECT | compte actif |
| villages_del | PERMISSIVE | DELETE | est_bm() |
| villages_ecriture_roles_terrain_ins | RESTRICTIVE | INSERT | peut_ecrire_referentiel_terrain() |
| villages_ecriture_roles_terrain_upd | RESTRICTIVE | UPDATE | peut_ecrire_referentiel_terrain() |
| villages_del_admin / villages_delete_bm_only_guard | RESTRICTIVE | DELETE | Branch Manager |

Effet réel pour un Unit Head : INSERT et UPDATE autorisés **sur tous les clusters**
(`villages_write` + `peut_ecrire_referentiel_terrain()` via `peut_modifier_rt_producteur()`).
Aucune condition géographique. **Faille.**

## public.producteurs

| Politique | Type | Commande | Condition |
|---|---|---|---|
| prod_write | PERMISSIVE | ALL | rôle ≠ Consultation |
| producteurs_ins / producteurs_upd | PERMISSIVE | INSERT / UPDATE | peut_editer_terrain() |
| producteurs_update_rt_farmer_roles | PERMISSIVE | UPDATE | peut_modifier_rt_producteur() ET périmètre village |
| farmer_registry_scope_guard | RESTRICTIVE | ALL | private.farmer_registry_can_access_village(village_id, rt_id) |
| producteurs_ecriture_roles_terrain_ins | RESTRICTIVE | INSERT | peut_ecrire_referentiel_terrain() |
| producteurs_update_role_scope_guard | RESTRICTIVE | UPDATE | peut_modifier_rt_producteur() ET périmètre village |
| prod_del_admin / producteurs_delete_bm_only_guard | RESTRICTIVE | DELETE | Branch Manager |

Effet réel pour un Unit Head : écriture limitée aux villages de son cluster (ancienne et nouvelle
ligne). Correct en soi, mais **contournable** tant que le Unit Head peut changer le cluster d'un
village (voir ci-dessus).

## Autres constats (hors périmètre du correctif, non modifiés)

1. `public.offline_sync_batch`, branche `FIELD_GPS_UPDATE` : `SECURITY DEFINER` (propriétaire
   `postgres`, BYPASSRLS), sans contrôle de périmètre. Tout rôle terrain peut modifier le GPS de
   n'importe quel producteur. Correctif possible : appeler
   `private.farmer_registry_can_access_village` avant l'`update`. Non appliqué : la fonction couvre
   aussi achats, sacherie et coopératives, et Supervisor / Agent Recenseur n'ont pas de cluster en
   base (le contrôle les bloquerait).
2. `public.rt` INSERT : même absence de condition géographique que les villages. Le mandat laisse
   les RT « selon les permissions existantes » : non modifié.
3. Préfixe Farmer ID : `farmer_registry_set_code()` exige `villages.farmer_code_prefix`, attribué
   une seule fois par la migration du 18/08/2026. **Aucun village créé depuis ne reçoit de préfixe :
   aucun producteur ne peut y être enrôlé, quel que soit le rôle.** Voir
   `20261016_prefixe_farmer_id_nouveaux_villages.sql` (préparé, non appliqué).
4. `profils_role_check` ne contient pas `Assistant Unit Head` : aucun compte de ce rôle ne peut
   exister aujourd'hui. Le correctif le couvre déjà pour l'avenir.

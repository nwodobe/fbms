# Manifeste des 170 objets comparés (staging fidèle ↔ production)

Source : `tests/observatoire/staging/empreintes_production.txt` (extraction en lecture seule du 13/11/2026), recalculée sur le staging par `empreintes.sql`. Empreinte d'une fonction = md5 de (texte source, SECURITY DEFINER, search_path) ; d'une politique = md5 de (commande, rôles, permissive, USING, WITH CHECK).

- 93 fonctions : fermeture transitive de toutes les fonctions appelées par les politiques et déclencheurs des 9 tables cœur (profils, campaigns, farmer_plots, villages, producteurs, aflp_clusters, aflp_zones, rt, missions) et par les politiques Storage.
- 77 politiques : toutes celles des 9 tables cœur et toutes celles de `storage.objects`.

## Ce qui N'EST PAS couvert par les empreintes

- Les 21 tables secondaires : structure recréée (colonnes, contraintes, index) mais leurs politiques et fonctions propres ne sont pas comparées ; l'Observatoire ne les lit ni ne les écrit.
- Les privilèges (GRANT) : recopiés, non comparés par empreinte.
- Le moteur : PostgreSQL 16 au lieu de 17.6.
- `auth.*` et `storage.*` : simulés (mêmes colonnes et fonctions utilisées par les politiques, sans GoTrue ni API Storage), donc pas de JWT réel, pas de contrôle de type MIME ni d'URL signée.
- PostgREST : absent ; les droits sont testés par `set role authenticated` + identité de session, pas par HTTP.

Ces trous sont précisément ceux que la recette HTTP (`tests/observatoire/recette_http.mjs`) doit couvrir sur un projet Supabase isolé.

## Fonctions

| Fonction (signature) | Empreinte |
|---|---|
| `aflp_auh_actif/` | abb595723e |
| `aflp_auh_cluster/` | 75fc0f723e |
| `aflp_auh_dans_perimetre/p_cluster text, p_village_id text` | 244c75557c |
| `aflp_auh_garde_producteur/` | 114d82557c |
| `aflp_auh_garde_rt/` | 0ca98a557c |
| `aflp_auh_garde_village/` | d4fdbd557c |
| `aflp_can_force_create/` | 19ae926f17 |
| `aflp_cluster_code/p text` | 64294dba8c |
| `aflp_cluster_du_village/p_village_id text` | a871e4723e |
| `aflp_coop_can_edit/p_coop uuid` | 798df86f17 |
| `aflp_coop_can_read/p_coop uuid` | 41c30d6f17 |
| `aflp_coop_is_direction/` | 6a56e36f17 |
| `aflp_coop_roles_direction/` | 5588d5ba8c |
| `aflp_coop_roles_editeurs/` | 88b3e0ba8c |
| `aflp_coop_roles_transverses/` | f95af3ba8c |
| `aflp_coop_scope_global/` | d0106c6f17 |
| `aflp_norm/p text` | 3994c1ba8c |
| `aflp_producteur_rt_obligatoire/` | e6e7a0723e |
| `aflp_village_ecriture_dans_mon_cluster/p_cluster_code text, p_cluster text, p_data jsonb` | 5f7b136f17 |
| `campaigns_sync_legacy/` | 6f2d326f17 |
| `controler_statut_agent/` | 47cc44f1ec |
| `est_actif/` | 0b5326f1ec |
| `est_bm/` | 35358cf1ec |
| `est_equipe_terrain/` | 1ce764f1ec |
| `farmer_controle_doublon/` | 57f1d46f17 |
| `farmer_registry_audit_trigger/` | 1a6d09f1ec |
| `farmer_registry_authority/` | 2a25586f17 |
| `farmer_registry_can_access_producteur/pid text` | 2f17266f17 |
| `farmer_registry_can_access_village/target_village text, target_rt text` | 59e82a6f17 |
| `farmer_registry_can_capture/` | 3736b96f17 |
| `farmer_registry_can_read_sensitive/` | 78fcfb6f17 |
| `farmer_registry_can_supervise/` | 7adf4e6f17 |
| `farmer_registry_max_risk/p_first text, p_second text` | ab5a11a175 |
| `farmer_registry_norm_phone/value text` | 93943da175 |
| `farmer_registry_norm_text/value text` | 27f69da175 |
| `farmer_registry_prepare_plot/` | b34e466f17 |
| `farmer_registry_prepare_producteur/` | 79d469f1ec |
| `farmer_registry_prepare_village_cluster_code/` | f434a8a175 |
| `farmer_registry_refresh_child_trigger/` | a3a3d6f1ec |
| `farmer_registry_refresh_from_producteur_trigger/` | 73e0b2f1ec |
| `farmer_registry_refresh_passport/p_producteur_id text` | 9af5d46f17 |
| `farmer_registry_resolve_cluster_code/value text` | 3c9b61a175 |
| `farmer_registry_risk_rank/p_risk text` | 6e7ef3a175 |
| `farmer_registry_set_code/` | 81a54cf1ec |
| `farmer_registry_touch_child_row/` | 23bdc3f1ec |
| `fb_preserve_media_rt/` | 7070319438 |
| `fb_preserve_media_villages/` | 240e1e9438 |
| `fbms_controler_suppression/` | 2cf96bf1ec |
| `fbms_email/` | fd6ed6f1ec |
| `fbms_role/` | cf3857f1ec |
| `fbms_slug3/txt text` | 26b2f9a175 |
| `fn_sync_villages_colonnes/` | ed8d19ba8c |
| `guard_rt_duplicate_identity/` | 516d9ca175 |
| `mon_role/` | a46a2df1ec |
| `moto_beneficiaire_valide/p_user uuid` | 1acf28557c |
| `moto_chemin_permis_valide/p_nom text, p_titulaire uuid` | 3991742ab1 |
| `moto_classe/` | 90cc26557c |
| `moto_classe_de/p_user uuid` | 9b3553723e |
| `moto_dans_perimetre/p_moto uuid` | 4ba2aa557c |
| `moto_est_affectataire/p_moto uuid` | cde00a723e |
| `moto_formation_peut_deposer/p_nom text` | 1e63e6557c |
| `moto_lecture_enveloppe/p_titulaire uuid` | cc93dc557c |
| `moto_lecture_fin_maintenance/` | 9b26f2557c |
| `moto_lecture_permis/p_titulaire uuid` | 4ce8bf557c |
| `moto_ma_zone/` | b66c41723e |
| `moto_mission_lecture/p_mission moto_missions` | 6d5df3557c |
| `moto_mission_lecture_id/p_mission uuid` | 39c531557c |
| `moto_mission_photo_lecture/p_nom text` | 753a41557c |
| `moto_mon_cluster/` | d2fb70723e |
| `moto_peut_deposer/p_nom text` | 52109a557c |
| `moto_peut_operer/p_moto uuid` | e17061557c |
| `moto_uuid_ou_null/p text` | 0969cffa41 |
| `ops_has_role/allowed text[]` | 28d704723e |
| `peut_ecrire_referentiel_terrain/` | 44cb3df1ec |
| `peut_editer_config/` | a33220f1ec |
| `peut_editer_terrain/` | ff1fc9f1ec |
| `peut_modifier_rt_producteur/` | 9d7a1ff1ec |
| `portee_terrain_globale/` | 0f0d7df1ec |
| `procurement_supplier_editor_roles/` | 40d1e9ba8c |
| `producteur_gps_dans_mon_perimetre/` | 45888b6f17 |
| `profil_auh_coherence/` | 73e511557c |
| `profil_cluster_canonique/` | 17dfdd6f17 |
| `profils_garde_habilitations/` | 624cac557c |
| `profils_journaliser/` | 80c686557c |
| `rcn_est_actif/` | 210bc7f1ec |
| `rcn_proc_active_role/allowed text[]` | 503b2ca175 |
| `sacherie_norm_cluster/p_valeur text` | fc38e0723e |
| `set_rt_cluster_and_code/` | 8f48eaa175 |
| `touch_updated_at/` | 139e92a175 |
| `village_attribuer_prefixe_farmer_id/` | 58b1a76f17 |
| `village_controle_nom/` | 0995956f17 |
| `wms_can/p_action text` | ec6bdbf1ec |
| `wms_param/p_key text` | 567fb3f1ec |

## Politiques

| Table / politique | Empreinte |
|---|---|
| `aflp_clusters/aflp_clusters_select` | 9624b8 |
| `aflp_clusters/aflp_clusters_write` | 512253 |
| `aflp_zones/aflp_zones_select` | 9624b8 |
| `aflp_zones/aflp_zones_write` | 512253 |
| `campaigns/campaigns_read` | 1bbbbb |
| `farmer_plots/farmer_plots_insert` | eab440 |
| `farmer_plots/farmer_plots_select` | 69062a |
| `farmer_plots/farmer_plots_update` | bb8156 |
| `missions/missions_del` | 119785 |
| `missions/missions_ins` | c8c561 |
| `missions/missions_sel` | 5f452c |
| `missions/missions_upd` | 38d3c6 |
| `objects/aflp_coop_docs_insert` | 725c49 |
| `objects/aflp_coop_docs_read` | ca540d |
| `objects/farmer_passport_evidence_insert` | 3aa23b |
| `objects/farmer_passport_evidence_select` | 6ed737 |
| `objects/moto_documents_consultation` | e85766 |
| `objects/moto_documents_depot` | 8c72d7 |
| `objects/moto_formation_consultation` | b48de0 |
| `objects/moto_formation_depot` | a7f65d |
| `objects/photos_delete` | 67cf20 |
| `objects/photos_insert` | 70054c |
| `objects/photos_read` | aab9ee |
| `objects/photos_update` | 4b7826 |
| `objects/procurement_supplier_docs_storage_insert` | b97133 |
| `objects/procurement_supplier_docs_storage_read` | 3c572c |
| `objects/rcn_jute_proofs_insert` | 3753d5 |
| `objects/rcn_jute_proofs_read` | 3623f3 |
| `objects/terrain_preuves_ins` | fcd117 |
| `objects/terrain_preuves_sel` | dc5bc8 |
| `objects/wms_reception_docs_insert` | 204118 |
| `objects/wms_reception_docs_read` | 3f2e1c |
| `producteurs/farmer_registry_scope_guard` | c25be1 |
| `producteurs/prod_del_admin` | e30082 |
| `producteurs/prod_select` | 82438a |
| `producteurs/prod_write` | a58f0c |
| `producteurs/producteurs_del` | bc16af |
| `producteurs/producteurs_delete_bm_only_guard` | 4d8ebc |
| `producteurs/producteurs_ecriture_roles_terrain_ins` | 147998 |
| `producteurs/producteurs_ins` | 3bd77a |
| `producteurs/producteurs_sel` | 9624b8 |
| `producteurs/producteurs_upd` | 1bcba2 |
| `producteurs/producteurs_update_role_scope_guard` | 2dac90 |
| `producteurs/producteurs_update_rt_farmer_roles` | d066a4 |
| `profils/profils_del_bm` | bc16af |
| `profils/profils_ins_bm` | 137939 |
| `profils/profils_sel_bm` | 74c335 |
| `profils/profils_sel_self` | 2eb8cd |
| `profils/profils_select` | 3029cf |
| `profils/profils_upd_bm` | 34dcc0 |
| `profils/profils_update` | 2e579b |
| `rt/rt_auh_perimetre_ins` | 341284 |
| `rt/rt_auh_perimetre_sel` | 241ca3 |
| `rt/rt_del` | bc16af |
| `rt/rt_del_admin` | e30082 |
| `rt/rt_delete_bm_only_guard` | 4d8ebc |
| `rt/rt_ecriture_roles_terrain_ins` | 147998 |
| `rt/rt_ins` | 3bd77a |
| `rt/rt_sel` | 9624b8 |
| `rt/rt_select` | 82438a |
| `rt/rt_upd` | 1bcba2 |
| `rt/rt_update_role_scope_guard` | 3f5b57 |
| `rt/rt_update_rt_farmer_roles` | 2cff92 |
| `rt/rt_write` | a58f0c |
| `villages/villages_auh_perimetre_sel` | 36d54b |
| `villages/villages_cluster_scope_unit_head_ins` | bac68a |
| `villages/villages_cluster_scope_unit_head_upd` | 817f2f |
| `villages/villages_del` | bc16af |
| `villages/villages_del_admin` | e30082 |
| `villages/villages_delete_bm_only_guard` | fd8fce |
| `villages/villages_ecriture_roles_terrain_ins` | 147998 |
| `villages/villages_ecriture_roles_terrain_upd` | a5c211 |
| `villages/villages_ins` | 3bd77a |
| `villages/villages_sel` | 9624b8 |
| `villages/villages_select` | 82438a |
| `villages/villages_upd` | 1bcba2 |
| `villages/villages_write` | a58f0c |

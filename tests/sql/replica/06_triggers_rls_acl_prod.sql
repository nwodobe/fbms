-- Replica locale : triggers, RLS, policies et ACL tels que releves en production (18/09/2026).
create trigger trg_fb_prevent_negative_bag_stock BEFORE INSERT OR UPDATE OF quantite, source, destination, cluster, rt_id, rt_nom, producteur_id, producteur_nom ON public.sacs_mouvements FOR EACH ROW EXECUTE FUNCTION fb_prevent_negative_bag_stock();
create trigger trg_sacherie_ct_bridge AFTER INSERT ON public.sacs_mouvements FOR EACH ROW EXECUTE FUNCTION sacherie_ct_bridge_trigger();
create trigger trg_sacherie_guard_mouvement BEFORE INSERT ON public.sacs_mouvements FOR EACH ROW EXECUTE FUNCTION sacherie_guard_mouvement();
create trigger trg_sacherie_guard_mouvement_delete BEFORE DELETE ON public.sacs_mouvements FOR EACH ROW EXECUTE FUNCTION sacherie_guard_mouvement_delete();
create trigger trg_sacherie_guard_mouvement_update BEFORE UPDATE ON public.sacs_mouvements FOR EACH ROW EXECUTE FUNCTION sacherie_guard_mouvement_update();
create trigger trg_ops_bag_request_guard BEFORE INSERT OR UPDATE ON public.ops_bag_requests FOR EACH ROW EXECUTE FUNCTION ops_bag_request_guard();
create trigger trg_rcn_jute_guard BEFORE INSERT ON public.rcn_jute_movements FOR EACH ROW EXECUTE FUNCTION private.rcn_jute_guard();
create trigger trg_rcn_jute_movements_audit AFTER INSERT OR UPDATE OR DELETE ON public.rcn_jute_movements FOR EACH ROW EXECUTE FUNCTION private.rcn_proc_audit_row();
create trigger trg_rcn_jute_inventories_audit AFTER INSERT OR UPDATE OR DELETE ON public.rcn_jute_inventories FOR EACH ROW EXECUTE FUNCTION private.rcn_proc_audit_row();
create trigger trg_rcn_jute_locations_audit AFTER INSERT OR UPDATE OR DELETE ON public.rcn_jute_locations FOR EACH ROW EXECUTE FUNCTION private.rcn_proc_audit_row();
create trigger trg_rcn_jute_loss_requests_audit AFTER INSERT OR UPDATE OR DELETE ON public.rcn_jute_loss_requests FOR EACH ROW EXECUTE FUNCTION private.rcn_proc_audit_row();
create trigger trg_rcn_jute_transfers_audit AFTER INSERT OR UPDATE OR DELETE ON public.rcn_jute_transfers FOR EACH ROW EXECUTE FUNCTION private.rcn_proc_audit_row();
create trigger trg_aflp_bag_allocation_guard BEFORE INSERT OR UPDATE ON public.aflp_bag_cluster_allocations FOR EACH ROW EXECUTE FUNCTION aflp_bag_allocation_guard();

do $$ declare t text; begin
  foreach t in array array['profils','aflp_zones','aflp_clusters','villages','rt','producteurs','achats','avances','bag_movement_requests','ops_bag_releases','ops_bag_requests','rcn_jute_inventories','rcn_jute_inventory_frequencies','rcn_jute_locations','rcn_jute_loss_requests','rcn_jute_movements','rcn_jute_receipt_lines','rcn_jute_settings','rcn_jute_transfers','sacs_mouvements','aflp_bag_envelopes','aflp_bag_cluster_allocations','audit_log','rcn_proc_audit_central']
  loop execute format('alter table public.%I enable row level security', t); end loop; end $$;

-- profils
create policy profils_del_bm on public.profils for delete to authenticated using (est_bm());
create policy profils_ins_bm on public.profils for insert to authenticated with check (est_bm());
create policy profils_sel_bm on public.profils for select to authenticated using (est_bm());
create policy profils_sel_self on public.profils for select to authenticated using ((user_id = auth.uid()));
create policy profils_select on public.profils for select to public using (((auth.uid() = user_id) OR (fbms_role() = 'Branch Manager'::text)));
create policy profils_upd_bm on public.profils for update to authenticated using (est_bm()) with check (est_bm());
create policy profils_update on public.profils for update to public using ((fbms_role() = 'Branch Manager'::text));
-- sacs_mouvements
create policy sacs_ins on public.sacs_mouvements for insert to authenticated with check ((est_actif() AND (created_by = auth.uid()) AND (type <> 'DOTATION_RT'::text)));
create policy sacs_mouvements_delete_guard on public.sacs_mouvements as restrictive for delete to public using (false);
create policy sacs_mouvements_dotation_insert_guard on public.sacs_mouvements as restrictive for insert to public with check ((type IS DISTINCT FROM 'DOTATION_RT'::text));
create policy sacs_mouvements_upd on public.sacs_mouvements for update to authenticated using (( SELECT peut_editer_config() AS peut_editer_config)) with check (( SELECT peut_editer_config() AS peut_editer_config));
create policy sacs_sel on public.sacs_mouvements for select to authenticated using (est_actif());
-- ops
create policy aflp_allocation_insert on public.aflp_bag_cluster_allocations for insert to authenticated with check (( SELECT private.ops_has_role(ARRAY['General Manager'::text, 'Branch Manager'::text, 'Field Buying Operations Officer'::text]) AS ops_has_role));
create policy aflp_allocation_read on public.aflp_bag_cluster_allocations for select to authenticated using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy aflp_envelope_insert on public.aflp_bag_envelopes for insert to authenticated with check (( SELECT private.ops_has_role(ARRAY['General Manager'::text]) AS ops_has_role));
create policy aflp_envelope_read on public.aflp_bag_envelopes for select to authenticated using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy audit_ins on public.audit_log for insert to authenticated with check ((auth.uid() IS NOT NULL));
create policy audit_sel on public.audit_log for select to authenticated using (est_bm());
create policy bag_req_sel on public.bag_movement_requests for select to authenticated using (sacherie_peut_lire_demande(cluster, zone, requested_by));
create policy ops_bag_release_read on public.ops_bag_releases for select to authenticated using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy ops_bag_request_insert on public.ops_bag_requests for insert to authenticated with check (( SELECT private.ops_has_role(ARRAY['General Manager'::text, 'Branch Manager'::text, 'Procurement Officer'::text, 'LBA Purchase Officer'::text, 'Field Buying Operations Officer'::text, 'Zonal Head'::text, 'Unit Head'::text]) AS ops_has_role));
create policy ops_bag_request_read on public.ops_bag_requests for select to authenticated using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy ops_bag_request_update on public.ops_bag_requests for update to authenticated using (( SELECT private.ops_has_role(ARRAY['General Manager'::text, 'Branch Manager'::text, 'Procurement Officer'::text, 'LBA Purchase Officer'::text, 'Field Buying Operations Officer'::text, 'Zonal Head'::text, 'Unit Head'::text, 'Warehouse Manager'::text, 'Storekeeper'::text]) AS ops_has_role)) with check (( SELECT private.ops_has_role(ARRAY['General Manager'::text, 'Branch Manager'::text, 'Procurement Officer'::text, 'LBA Purchase Officer'::text, 'Field Buying Operations Officer'::text, 'Zonal Head'::text, 'Unit Head'::text, 'Warehouse Manager'::text, 'Storekeeper'::text]) AS ops_has_role));
-- rcn_jute_* (module RCN TRACE, roles historiques)
create policy rcn_jute_inventories_read on public.rcn_jute_inventories for select to authenticated using (rcn_proc_active_role(ARRAY['Procurement Officer'::text, 'Head of Field'::text, 'Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Branch Manager'::text, 'Assistant Branch Manager'::text, 'GM'::text, 'General Manager'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_inventory_insert on public.rcn_jute_inventories for insert to authenticated with check (rcn_proc_active_role(ARRAY['Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_locations_insert on public.rcn_jute_locations for insert to authenticated with check (rcn_proc_active_role(ARRAY['Warehouse Manager'::text, 'Supervisor'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_locations_read on public.rcn_jute_locations for select to authenticated using (rcn_proc_active_role(ARRAY['Procurement Officer'::text, 'Head of Field'::text, 'Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Branch Manager'::text, 'Assistant Branch Manager'::text, 'GM'::text, 'General Manager'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_locations_update on public.rcn_jute_locations for update to authenticated using (rcn_proc_active_role(ARRAY['Warehouse Manager'::text, 'Supervisor'::text, 'Coordination'::text, 'Administrateur'::text])) with check (rcn_proc_active_role(ARRAY['Warehouse Manager'::text, 'Supervisor'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_loss_insert on public.rcn_jute_loss_requests for insert to authenticated with check (rcn_proc_active_role(ARRAY['Procurement Officer'::text, 'Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_loss_requests_read on public.rcn_jute_loss_requests for select to authenticated using (rcn_proc_active_role(ARRAY['Procurement Officer'::text, 'Head of Field'::text, 'Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Branch Manager'::text, 'Assistant Branch Manager'::text, 'GM'::text, 'General Manager'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_loss_update on public.rcn_jute_loss_requests for update to authenticated using (rcn_proc_active_role(ARRAY['Branch Manager'::text, 'Assistant Branch Manager'::text, 'GM'::text, 'General Manager'::text, 'Coordination'::text, 'Administrateur'::text])) with check (rcn_proc_active_role(ARRAY['Branch Manager'::text, 'Assistant Branch Manager'::text, 'GM'::text, 'General Manager'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_movements_insert on public.rcn_jute_movements for insert to authenticated with check (rcn_proc_active_role(ARRAY['Procurement Officer'::text, 'Head of Field'::text, 'Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Branch Manager'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_movements_read on public.rcn_jute_movements for select to authenticated using (rcn_proc_active_role(ARRAY['Procurement Officer'::text, 'Head of Field'::text, 'Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Branch Manager'::text, 'Assistant Branch Manager'::text, 'GM'::text, 'General Manager'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_movements_update on public.rcn_jute_movements for update to authenticated using (rcn_proc_active_role(ARRAY['Coordination'::text, 'Administrateur'::text])) with check (rcn_proc_active_role(ARRAY['Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_transfer_insert on public.rcn_jute_transfers for insert to authenticated with check (rcn_proc_active_role(ARRAY['Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_transfer_update on public.rcn_jute_transfers for update to authenticated using (rcn_proc_active_role(ARRAY['Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Coordination'::text, 'Administrateur'::text])) with check (rcn_proc_active_role(ARRAY['Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_jute_transfers_read on public.rcn_jute_transfers for select to authenticated using (rcn_proc_active_role(ARRAY['Procurement Officer'::text, 'Head of Field'::text, 'Warehouse Manager'::text, 'Entrepôt'::text, 'Supervisor'::text, 'Branch Manager'::text, 'Assistant Branch Manager'::text, 'GM'::text, 'General Manager'::text, 'Coordination'::text, 'Administrateur'::text]));
create policy rcn_proc_audit_central_read on public.rcn_proc_audit_central for select to authenticated using (rcn_proc_active_role(ARRAY['GM'::text, 'General Manager'::text, 'Finance Manager'::text, 'Coordination'::text, 'Administrateur'::text]));
-- Lecture des referentiels (tests) : RT/producteurs/villages/clusters lisibles par tout compte actif.
create policy test_rt_read on public.rt for select to authenticated using (est_actif());
create policy test_clusters_read on public.aflp_clusters for select to authenticated using (true);

-- Vues : ACL de production (authenticated = lecture seule sur les vues ct).
revoke all on public.sacherie_ct_cluster_stock, public.sacherie_ct_latest_inventory, public.sacherie_ct_rt_stock, public.sacherie_ct_global_stock from anon, authenticated;
grant select on public.sacherie_ct_cluster_stock, public.sacherie_ct_latest_inventory, public.sacherie_ct_rt_stock, public.sacherie_ct_global_stock to authenticated;

-- ACL des fonctions (prod) : EXECUTE de PUBLIC retire partout sauf mention.
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace) and p.prokind='f'
    and p.proname not in (select proname from pg_proc where pronamespace='public'::regnamespace and proname like 'gtrgm%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop; end $$;
grant execute on function public.est_actif(), public.est_bm(), public.mon_role(), public.fbms_role(), public.peut_editer_config(),
  public.rcn_proc_active_role(text[]), public.sacherie_mon_contexte(), public.sacherie_peut_lire_demande(text,text,uuid),
  public.portee_terrain_globale(), private.farmer_registry_authority(), private.ops_has_role(text[]),
  public.sacherie_ct_location(text,text,text,text,text,text), public.sacherie_ct_locations(), public.sacherie_ct_pertes(),
  public.sacherie_ct_snapshot(), public.sacherie_ct_inventorier(text,text,integer,text,text),
  public.sacherie_ct_declarer_perte(text,text,integer,text,text), public.sacherie_ct_decider_perte(text,boolean,text),
  public.sacherie_ct_traiter_etat(text,text,text,integer,text,text), public.ops_release_bags(uuid,text,text,text,integer,text,text),
  public.sacherie_calculer_plafond(text,text,numeric), public.sacherie_creer_demande(text,text,text,numeric,integer),
  public.sacherie_decider_demande(uuid,text,integer,text), public.sacherie_executer_demande(uuid,integer,text,text)
  to authenticated;
-- sacherie_ops_* : ouvertes a PUBLIC/anon en production (le corps exige auth.uid()).
grant execute on function public.sacherie_ops_create_transfer(text,text,text,text,integer,text,text,text,text,text),
  public.sacherie_ops_receive_transfer(text,text,integer,text,text,text),
  public.sacherie_ops_network_move(text,text,text,text,text,integer,text,text,text),
  public.sacherie_ops_ensure_locations(), public.sacherie_ops_resolve_cluster_location(text),
  public.portee_terrain_globale(), private.farmer_registry_authority()
  to public;
grant execute on function public.fb_entity_key(text,text), public.fb_prevent_negative_bag_stock(), public.aflp_bag_allocation_guard() to public;

-- Les vues wms_v_* s'exécutent avec les droits de l'appelant : la RLS des tables sous-jacentes s'applique.
alter view public.wms_v_balances set (security_invoker = true);
alter view public.wms_v_bin_contributors set (security_invoker = true);
alter view public.wms_v_bins set (security_invoker = true);
alter view public.wms_v_lots set (security_invoker = true);
alter view public.wms_v_quality_current set (security_invoker = true);
alter view public.wms_v_receptions set (security_invoker = true);
alter view public.wms_v_movements set (security_invoker = true);
alter view public.wms_v_audit set (security_invoker = true);
alter view public.wms_v_bag_supplier_balance set (security_invoker = true);

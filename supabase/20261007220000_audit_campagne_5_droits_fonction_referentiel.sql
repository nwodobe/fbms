-- Audit campagne 2027 · 5/5 — droits d'exécution de peut_ecrire_referentiel_terrain().
--
-- Constat (conseiller de sécurité Supabase, après la migration 2/4) : la fonction créée
-- par 20261007210100 héritait du droit EXECUTE par défaut (PUBLIC), donc appelable par
-- le rôle anon via /rest/v1/rpc. Elle ne renvoie que false pour un visiteur non connecté,
-- mais les autres fonctions de contrôle de rôle du projet ne sont pas exposées à anon :
-- on aligne. authenticated garde le droit (indispensable aux politiques RLS restrictives).

revoke execute on function public.peut_ecrire_referentiel_terrain() from public, anon;
grant execute on function public.peut_ecrire_referentiel_terrain() to authenticated;

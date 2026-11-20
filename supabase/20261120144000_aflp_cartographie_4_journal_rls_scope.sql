-- FBMS Cartographie / AFLP 2027
-- Correctif P0 : la politique de lecture du journal doit être corrélée à CHAQUE événement.
-- Avant : EXISTS (...) ne faisait jamais référence à farmer_plot_map_events.plot_id.
-- Conséquence : un utilisateur ayant accès à une seule parcelle pouvait lire des
-- événements d'autres parcelles, dont les événements administratifs du plot_id nul.
--
-- Après : les événements de parcelles ne sont lisibles que via le périmètre
-- d'accès de cette parcelle ; les événements de configuration (UUID sentinelle)
-- sont réservés au Branch Manager actif.
-- Ce correctif ne modifie aucune donnée et ne révoque pas les accès légitimes
-- au journal d'une parcelle de l'agent.
--
-- Repli sûr en cas d'incident : REVOKE SELECT ON public.farmer_plot_map_events
-- FROM authenticated ; NE PAS rétablir l'ancienne politique non corrélée.

ALTER POLICY plot_map_events_select
ON public.farmer_plot_map_events
TO authenticated
USING (
  public.est_actif()
  AND CASE
    WHEN plot_id = '00000000-0000-0000-0000-000000000000'::uuid
      THEN private.plot_map_classe() = 'BM'
    ELSE EXISTS (
      SELECT 1
      FROM private.plot_map_contexte(farmer_plot_map_events.plot_id) AS ctx
      WHERE ctx.deleted IS FALSE
        AND private.plot_map_peut_lire(ctx.producteur_id, ctx.zone_code)
    )
  END
);

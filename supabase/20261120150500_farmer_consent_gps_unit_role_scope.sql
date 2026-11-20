-- AFLP / consentements GPS : permettre aux chefs d'unité, assistants et chefs de zone
-- de saisir une nouvelle décision explicite, sans ouvrir les villages hors périmètre.
-- Aucune donnée existante n'est modifiée. L'ancienne politique d'insertion reste active.
-- Remarque : les ZH disposent d'une portée de référentiel global héritée :
-- on impose ici une restriction SUPPLÉMENTAIRE par zone de cartographie.
CREATE POLICY farmer_consents_insert_aflp_gps_terrain
ON public.farmer_consents
FOR INSERT TO authenticated
WITH CHECK (
  public.est_actif()
  AND created_by = auth.uid()
  AND agent_id = auth.uid()
  AND private.farmer_registry_can_access_producteur(producteur_id)
  AND source = 'FIELD_GPS_DECISION'
  AND (
    public.mon_role() IN ('Unit Head','Assistant Unit Head')
    OR (
      public.mon_role() = 'Zonal Head'
      AND EXISTS (
        SELECT 1 FROM public.producteurs prod
        JOIN public.villages vil ON vil.id = prod.village_id AND NOT vil.deleted
        JOIN public.aflp_clusters cl
          ON private.plot_map_norm(cl.code) =
             private.plot_map_norm(coalesce(nullif(btrim(vil.cluster_code),''), nullif(btrim(vil.cluster),'')))
        WHERE prod.id = farmer_consents.producteur_id
          AND cl.zone_code = private.plot_map_ma_zone()
      )
    )
  )
);

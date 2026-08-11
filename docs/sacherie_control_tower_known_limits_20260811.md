# Limites connues avant recette finale

1. Le backend Control Tower est pour l'instant testé sur la branche Supabase de développement, pas encore en Production.
2. L'interface GitHub de la branche appellera les nouvelles RPC uniquement après leur déploiement sur la base correspondante.
3. Les pièces justificatives sont prévues dans les fonctions mais l'UI Control Tower ne propose pas encore l'upload Storage ; ce point doit être raccordé au bucket privé existant `rcn-jute-proofs`.
4. La confirmation de réception RT prévue par le SOP-006 n'est pas encore intégrée au nouveau ledger canonique.
5. Les alertes de rupture prévisionnelle doivent être reliées aux cycles de financement réellement configurés ; aucun besoin de sacs n'est inventé à partir d'une avance sans volume financé explicite.
6. Le workflow perte est opérationnel sur le registre test, mais la preuve photo doit être rendue obligatoire selon les seuils métier à définir.
7. Le modèle legacy `DECHIRE_RT` / `DECHIRE_PROD` mélange historiquement déchiré et perdu. Le backfill classe ces lignes en `DECHIRE` afin de ne pas supprimer des actifs sans décision.
8. La politique RLS historique `sacs_mouvements_ins` doit être corrigée avant le rollout, car elle chevauche la policy plus restrictive qui exclut `DOTATION_RT`.
9. Le cycle complet Producteur → RT → Cluster → Factory doit encore être testé avec les opérations réelles de campagne.
10. Les KPI de rotation, durée de détention et besoin futur seront ajoutés seulement lorsque leurs données sources seront suffisamment fiables.

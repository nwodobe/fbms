-- AFLP FLEET 18 : RETOUR ARRIÈRE. Le modèle n'est retiré que s'il n'est plus utilisé
-- (aucune moto rattachée, aucune version de règle) ; sinon, détachez d'abord les motos et retirez les règles.
delete from public.moto_modeles_techniques m
 where m.code = 'APSONIC_AP125'
   and not exists (select 1 from public.moto_motos where modele_technique_code = m.code)
   and not exists (select 1 from public.moto_regles_versions where modele_code = m.code);

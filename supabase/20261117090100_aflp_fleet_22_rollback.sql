-- AFLP FLEET 22 : RETOUR ARRIÈRE (la correction directe BM/ABM disparaît ; les corrections déjà faites restent
-- tracées dans moto_corrections et moto_journal ; le circuit « demande + validation par un autre » demeure).
drop function if exists public.moto_releve_corriger(uuid, numeric, text);

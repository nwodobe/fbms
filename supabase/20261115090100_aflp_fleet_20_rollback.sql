-- AFLP FLEET 20 : RETOUR ARRIÈRE (la suppression par le Branch Manager disparaît ; les suppressions déjà faites restent tracées dans moto_journal).
drop function if exists public.moto_carburant_supprimer(uuid, text);

-- =============================================================================
-- AFLP FLEET 16 : un permis ENREGISTRÉ suffit (vérification sur original facultative)
-- APPLIQUÉ EN PRODUCTION le 04/11/2026 (empreintes des 3 fonctions identiques à la réplique testée).
-- Décision du Branch Manager du 04/11/2026 : « si j'ai déjà enregistré le permis du
-- conducteur, pas nécessaire [...] cela doit être facultatif ».
--
-- Ce qui change :
--   - paramètre permis_verification_obligatoire (0 = permis enregistré suffit, 1 = vérifié exigé), réglé à 0 ;
--   - private.moto_permis_utilisable : permis CONFORME en cours de validité, sinon (paramètre à 0)
--     permis EN_VERIFICATION en cours de validité dont le numéro n'est pas retiré ;
--   - remise, transfert (déclencheur moto_affectation_permis) et démarrage de mission l'utilisent ;
--     l'affectation garde la trace : permis_verifie = false tant que le permis n'est pas vérifié.
--
-- Ce qui ne change pas : sans permis enregistré (scan + numéro + catégorie), pas de remise ni de
-- mission ; un permis expiré, non conforme, retiré ou annulé bloque toujours. Le permis reste
-- « à vérifier » dans l'espace Conducteurs. Le BM rétablit l'obligation par le paramètre.
-- Rejouable. Retour arrière : 20261111090100_aflp_fleet_16_rollback.sql
-- =============================================================================

insert into public.moto_parametres (cle, valeur, description, provisoire)
values ('permis_verification_obligatoire', 0,
        'Permis vérifié sur original exigé pour la remise, le transfert et les missions (1 = oui, 0 = permis enregistré suffit).', true)
on conflict (cle) do nothing;

create or replace function private.moto_permis_utilisable(p_user uuid, p_date date)
 returns public.moto_permis
 language plpgsql
 stable security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare r public.moto_permis;
begin
  r := private.moto_permis_valide(p_user, p_date);
  if r.id is not null or coalesce(private.moto_param('permis_verification_obligatoire'), 0) >= 1 then return r; end if;
  select * into r from public.moto_permis x
  where x.titulaire_id = p_user and x.statut = 'EN_VERIFICATION'
    and (x.sans_expiration or x.date_expiration >= coalesce(p_date, current_date))
    and not exists (select 1 from public.moto_permis y where y.numero_cle = x.numero_cle and y.statut = 'RETIRE')
  order by x.depose_at desc limit 1;
  return r;
end $function$;
revoke all on function private.moto_permis_utilisable(uuid, date) from public, anon;

do $$
declare v text; n text;
begin
  v := pg_get_functiondef('private.moto_affectation_permis()'::regprocedure);
  if position('moto_permis_utilisable' in v) = 0 then
    n := replace(v, 'r := private.moto_permis_valide(new.beneficiaire_id, coalesce(new.date_debut, current_date));',
                    'r := private.moto_permis_utilisable(new.beneficiaire_id, coalesce(new.date_debut, current_date));');
    n := replace(n, $a$statut = 'CONFORME' for share$a$, $b$statut in ('CONFORME','EN_VERIFICATION') for share$b$);
    n := replace(n, 'new.permis_verifie := true;', $b$new.permis_verifie := (r.statut = 'CONFORME');$b$);
    n := replace(n, $a$'Remise bloquée : le bénéficiaire n''a pas de permis enregistré, vérifié CONFORME et en cours de validité (Administration › Conducteurs et permis).'$a$,
                    $b$'Remise bloquée : le bénéficiaire n''a pas de permis enregistré et en cours de validité (Conducteurs et permis : scanner le permis).'$b$);
    if n = v or position('moto_permis_utilisable' in n) = 0 then raise exception 'AFLP FLEET 16 : texte attendu introuvable dans moto_affectation_permis'; end if;
    execute n;
  end if;

  v := pg_get_functiondef('public.moto_mission_demarrer(jsonb)'::regprocedure);
  if position('moto_permis_utilisable' in v) = 0 then
    n := replace(v, 'if private.moto_permis_valide(auth.uid(), current_date) is null or private.moto_permis_valide(auth.uid(), v_at::date) is null then',
                    'if (private.moto_permis_utilisable(auth.uid(), current_date)).id is null or (private.moto_permis_utilisable(auth.uid(), v_at::date)).id is null then');
    n := replace(n, $a$'Aucun permis valide et vérifié à votre nom : mission impossible.'$a$, $b$'Aucun permis valide enregistré à votre nom : mission impossible.'$b$);
    if n = v then raise exception 'AFLP FLEET 16 : texte attendu introuvable dans moto_mission_demarrer'; end if;
    execute n;
  end if;
end $$;

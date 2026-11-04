-- =============================================================================
-- AFLP FLEET 15 : état contradictoire avant remise FACULTATIF
-- APPLIQUÉ EN PRODUCTION le 04/11/2026 (empreintes des 4 fonctions identiques à la réplique testée).
-- Décision du Branch Manager du 04/11/2026 : « supprime état contradictoire avant
-- remise de moto ».
--
-- Ce qui change :
--   - nouveau paramètre etat_remise_obligatoire (0 = facultatif, 1 = obligatoire), réglé à 0 ;
--   - moto_remettre et moto_transferer n'exigent plus d'état contradictoire accepté.
--     S'il en existe un valide, il reste rattaché à l'affectation (preuve conservée) ;
--   - garde-fou : si le dernier état récent avec ce bénéficiaire a été CONTESTÉ par lui,
--     la remise reste bloquée (un désaccord écrit ne s'efface pas en sautant l'étape) ;
--   - moto_aptitude : l'étape affichée devient « Enregistrer la remise ».
--
-- Ce qui ne change pas : permis conforme et valide, moto APTE et CONFORME, compteur,
-- casque et gilet, autorisation de circuler distincte. Aucun état déjà enregistré
-- n'est modifié ni supprimé ; le BM peut rétablir l'obligation par le paramètre.
-- Rejouable. Retour arrière : 20261110090100_aflp_fleet_15_rollback.sql
-- =============================================================================

insert into public.moto_parametres (cle, valeur, description, provisoire)
values ('etat_remise_obligatoire', 0,
        'État contradictoire accepté par le bénéficiaire exigé à la remise et au transfert (1 = oui, 0 = facultatif).', true)
on conflict (cle) do nothing;

create or replace function private.moto_etat_remise_requis(p_moto uuid, p_benef uuid, p_message text)
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v uuid := private.moto_etat_remise_valide(p_moto, p_benef);
begin
  if v is not null then return v; end if;
  if coalesce(private.moto_param('etat_remise_obligatoire'), 0) >= 1 then perform private.moto_erreur(p_message); end if;
  if exists (select 1 from (select confirmation_statut, date_controle from public.moto_controles
                            where moto_id = p_moto and type_controle = 'ETAT_REMISE' and beneficiaire_id = p_benef
                            order by date_controle desc limit 1) c
             where c.confirmation_statut = 'CONTESTEE'
               and c.date_controle >= now() - make_interval(days => coalesce(private.moto_param('etat_remise_validite_jours'), 7)::integer)) then
    perform private.moto_erreur('Remise bloquée : le bénéficiaire a contesté l''état de la moto. Réglez le désaccord (nouvel état accepté) avant la remise.');
  end if;
  return null;
end $function$;
revoke all on function private.moto_etat_remise_requis(uuid, uuid, text) from public, anon;

do $$
declare v text; n text;
begin
  v := pg_get_functiondef('public.moto_remettre(jsonb)'::regprocedure);
  if position('moto_etat_remise_requis' in v) = 0 then
    n := replace(v, $a$  v_etat := private.moto_etat_remise_valide(v_moto, a.beneficiaire_id);
  if v_etat is null then
    perform private.moto_erreur('Remise bloquée : état contradictoire avant remise absent, non accepté par le bénéficiaire, contesté ou trop ancien.');
  end if;$a$, $b$  v_etat := private.moto_etat_remise_requis(v_moto, a.beneficiaire_id,
    'Remise bloquée : état contradictoire avant remise absent, non accepté par le bénéficiaire, contesté ou trop ancien.');$b$);
    if n = v then raise exception 'AFLP FLEET 15 : texte attendu introuvable dans moto_remettre'; end if;
    execute n;
  end if;

  v := pg_get_functiondef('public.moto_transferer(jsonb)'::regprocedure);
  if position('moto_etat_remise_requis' in v) = 0 then
    n := replace(v, $a$  v_etat := private.moto_etat_remise_valide(v_moto, v_benef);
  if v_etat is null then perform private.moto_erreur('Transfert bloqué : état contradictoire avec le nouveau bénéficiaire absent, non accepté ou trop ancien.'); end if;$a$,
      $b$  v_etat := private.moto_etat_remise_requis(v_moto, v_benef, 'Transfert bloqué : état contradictoire avec le nouveau bénéficiaire absent, non accepté ou trop ancien.');$b$);
    if n = v then raise exception 'AFLP FLEET 15 : texte attendu introuvable dans moto_transferer'; end if;
    execute n;
  end if;

  v := pg_get_functiondef('public.moto_aptitude(uuid)'::regprocedure);
  if position('Enregistrer la remise (compteur, casque et gilet)' in v) = 0 then
    n := replace(v, $a$'code', 'REMISE', 'action', 'etat_remise',
              'libelle', 'État contradictoire accepté par le bénéficiaire, puis remise');$a$,
      $b$'code', 'REMISE', 'action', 'remettre',
              'libelle', 'Enregistrer la remise (compteur, casque et gilet)');$b$);
    if n = v then raise exception 'AFLP FLEET 15 : texte attendu introuvable dans moto_aptitude'; end if;
    execute n;
  end if;
end $$;

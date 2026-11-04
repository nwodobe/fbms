-- AFLP FLEET 14 : retour arrière (restaure les définitions de la migration 13, aucune donnée effacée).
-- La contrainte moto_permis_check2 revient en NOT VALID : les permis auto-validés pendant la période
-- restent tels quels et tracés ; tout nouveau contrôle redevient soumis à la séparation des tâches.
alter table public.moto_permis drop constraint if exists moto_permis_verif_titulaire_check;
alter table public.moto_permis drop constraint if exists moto_permis_check2;
alter table public.moto_permis add constraint moto_permis_check2
  check (((verifie_par is null) or ((verifie_par <> depose_par) and (verifie_par <> titulaire_id)))) not valid;
CREATE OR REPLACE FUNCTION public.moto_permis_verifier(p_permis uuid, p_statut text, p_verification_rh_nom text DEFAULT NULL::text, p_categorie_adaptee boolean DEFAULT NULL::boolean, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r public.moto_permis; v_dec text := upper(coalesce(p_statut, ''));
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  perform pg_advisory_xact_lock(hashtext('moto_permis:' || (select numero_cle from public.moto_permis where id = p_permis)));   -- numéro, puis ligne
  select * into r from public.moto_permis where id = p_permis for update;
  if not found or r.statut <> 'EN_VERIFICATION' then perform private.moto_erreur('Permis introuvable ou déjà vérifié.'); end if;
  if r.depose_par = auth.uid() then perform private.moto_refus('Séparation des tâches : la personne qui a déposé le permis ne le vérifie pas.'); end if;
  if r.titulaire_id = auth.uid() then perform private.moto_refus('Le titulaire ne vérifie pas son propre permis.'); end if;
  if v_dec = 'CONFORME' then
    perform pg_advisory_xact_lock(hashtext('moto_permis:' || r.numero_cle));
    if exists (select 1 from public.moto_permis where numero_cle = r.numero_cle and statut = 'RETIRE') then
      perform private.moto_refus('Ce numéro de permis a été retiré : il ne peut pas être déclaré conforme tant que le Branch Manager n''a pas levé le retrait.');
    end if;
    if exists (select 1 from public.moto_permis where numero_cle = r.numero_cle and statut not in ('NON_CONFORME','ANNULE') and titulaire_id <> r.titulaire_id) then
      perform private.moto_erreur('Ce numéro de permis est déjà reconnu pour un autre conducteur : déclarez ce dépôt non conforme.');
    end if;
    -- Quatre yeux sur le numéro : qui a LIBÉRÉ ce numéro (annulation, ou rejet du dépôt d'une autre personne)
    -- ne valide pas un dépôt portant ce numéro ; une seule personne ne peut pas faire passer un numéro d'un titulaire à un autre.
    if exists (select 1 from public.moto_permis
               where numero_cle = r.numero_cle and id <> r.id
                 and ((statut = 'ANNULE' and annule_par = auth.uid())
                   or (statut = 'NON_CONFORME' and verifie_par = auth.uid() and titulaire_id <> r.titulaire_id))) then
      perform private.moto_refus('Quatre yeux : vous avez déjà libéré ce numéro (annulation ou rejet d''un autre conducteur) ; faites vérifier ce dépôt par l''ABM.');
    end if;
    if exists (select 1 from public.moto_permis where titulaire_id = r.titulaire_id and statut = 'RETRAIT_LEVE' and leve_par = auth.uid()) then
      perform private.moto_refus('Quatre yeux : la personne qui a levé le retrait ne vérifie pas le nouveau dépôt ; faites-le vérifier par l''ABM.');
    end if;
    if length(btrim(coalesce(p_verification_rh_nom, ''))) < 3 then
      perform private.moto_erreur('Nom de la personne (RH) qui a contrôlé l''original obligatoire.');
    end if;
    if p_categorie_adaptee is not true then
      perform private.moto_erreur('Confirmez que la catégorie du permis est adaptée à la moto confiée.');
    end if;
    if not r.sans_expiration and r.date_expiration < current_date then
      perform private.moto_erreur('Permis expiré : il ne peut pas être déclaré conforme.');
    end if;
    perform private.moto_motif(coalesce(nullif(btrim(p_motif), ''), 'Permis contrôlé sur original'));
    update public.moto_permis set statut = 'REMPLACE', remplace_par = r.id where titulaire_id = r.titulaire_id and statut = 'CONFORME';
    update public.moto_permis set statut = 'CONFORME', verifie_par = auth.uid(), verifie_at = now(),
           verification_rh_nom = btrim(p_verification_rh_nom), categorie_adaptee = true, motif_verification = nullif(btrim(p_motif), '')
    where id = r.id;
  elsif v_dec = 'NON_CONFORME' then
    perform private.moto_motif(p_motif, 5);
    update public.moto_permis set statut = 'NON_CONFORME', verifie_par = auth.uid(), verifie_at = now(), motif_verification = btrim(p_motif)
    where id = r.id;
  else
    perform private.moto_erreur('Décision attendue : CONFORME ou NON_CONFORME.');
  end if;
  return jsonb_build_object('id', r.id, 'statut', v_dec);
end $function$

;

CREATE OR REPLACE FUNCTION public.moto_etat_remise_confirmer(p_controle uuid, p_decision text, p_commentaire text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.moto_controles; v_dec text := upper(coalesce(p_decision, ''));
begin
  if private.moto_classe() is null then perform private.moto_refus('Accès refusé.'); end if;
  select * into c from public.moto_controles where id = p_controle and type_controle = 'ETAT_REMISE' for update;
  if not found then perform private.moto_erreur('État de remise introuvable.'); end if;
  if c.beneficiaire_id is distinct from auth.uid() then perform private.moto_refus('Seul le bénéficiaire confirme l''état contradictoire.'); end if;
  if c.confirmation_statut <> 'EN_ATTENTE' then perform private.moto_erreur('État déjà confirmé ou contesté.'); end if;
  if v_dec not in ('ACCEPTEE','ACCEPTEE_AVEC_RESERVES','CONTESTEE') then perform private.moto_erreur('Décision inconnue.'); end if;
  if v_dec <> 'ACCEPTEE' then perform private.moto_motif(p_commentaire, 5); else perform private.moto_motif(coalesce(p_commentaire, 'État accepté')); end if;
  update public.moto_controles set confirmation_statut = v_dec, confirmation_at = now(), confirmation_commentaire = nullif(btrim(p_commentaire), '')
  where id = c.id;
  return jsonb_build_object('id', c.id, 'confirmation_statut', v_dec);
end $function$

;


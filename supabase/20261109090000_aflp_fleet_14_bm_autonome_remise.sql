-- AFLP FLEET 14 : le Branch Manager (et l'ABM) peuvent conduire seuls tout le circuit de remise.
-- APPLIQUÉ EN PRODUCTION le 04/11/2026 (empreintes des 2 fonctions identiques à la réplique testée).
--
-- Décision du Branch Manager du 04/11/2026 : « je dois tout pouvoir faire moi-même à partir de mon compte,
-- tout valider et autoriser ».
--
-- Ce qui change (deux fonctions, aucune table, aucun statut nouveau) :
--   1. moto_permis_verifier (et la contrainte moto_permis_check2) : le BM ou l'ABM qui a déposé un permis peut le vérifier lui-même.
--      La décision est tracée « Auto-validation par le déposant ».
--   2. moto_etat_remise_confirmer : le BM ou l'ABM peut confirmer l'état contradictoire pour le compte
--      du bénéficiaire, avec un commentaire obligatoire (15 caractères minimum), préfixé
--      « Confirmé par <nom> pour le compte du bénéficiaire ».
--
-- Ce qui ne change pas (exigences de sécurité conservées) :
--   - permis numérisé, numéro, catégorie et validité obligatoires ; un permis expiré ou retiré n'est jamais conforme ;
--   - personne ne vérifie son propre permis (titulaire) ;
--   - la remise exige toujours un permis conforme et valide, une moto APTE et administrativement CONFORME,
--     un état contradictoire accepté de moins de 7 jours et sans anomalie critique ;
--   - les contrôles financiers (factures, paiements, remboursements) gardent leur séparation des tâches.
-- Retour arrière : 20261109090100_aflp_fleet_14_rollback.sql

-- La contrainte de table interdisait aussi vérificateur = déposant : elle est remplacée par une contrainte
-- qui garde la seule règle conservée (le titulaire ne vérifie pas son propre permis).
alter table public.moto_permis drop constraint if exists moto_permis_check2;
alter table public.moto_permis drop constraint if exists moto_permis_verif_titulaire_check;
alter table public.moto_permis add constraint moto_permis_verif_titulaire_check
  check (verifie_par is null or verifie_par <> titulaire_id);

create or replace function public.moto_permis_verifier(p_permis uuid, p_statut text, p_verification_rh_nom text default null::text,
  p_categorie_adaptee boolean default null::boolean, p_motif text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare r public.moto_permis; v_dec text := upper(coalesce(p_statut, '')); v_auto boolean; v_motif text;
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  perform pg_advisory_xact_lock(hashtext('moto_permis:' || (select numero_cle from public.moto_permis where id = p_permis)));   -- numéro, puis ligne
  select * into r from public.moto_permis where id = p_permis for update;
  if not found or r.statut <> 'EN_VERIFICATION' then perform private.moto_erreur('Permis introuvable ou déjà vérifié.'); end if;
  if r.titulaire_id = auth.uid() then perform private.moto_refus('Le titulaire ne vérifie pas son propre permis.'); end if;
  -- AFLP FLEET 14 : le déposant BM / ABM peut vérifier ; la trace le dit.
  v_auto := r.depose_par = auth.uid();
  if v_dec = 'CONFORME' then
    perform pg_advisory_xact_lock(hashtext('moto_permis:' || r.numero_cle));
    if exists (select 1 from public.moto_permis where numero_cle = r.numero_cle and statut = 'RETIRE') then
      perform private.moto_refus('Ce numéro de permis a été retiré : il ne peut pas être déclaré conforme tant que le Branch Manager n''a pas levé le retrait.');
    end if;
    if exists (select 1 from public.moto_permis where numero_cle = r.numero_cle and statut not in ('NON_CONFORME','ANNULE') and titulaire_id <> r.titulaire_id) then
      perform private.moto_erreur('Ce numéro de permis est déjà reconnu pour un autre conducteur : déclarez ce dépôt non conforme.');
    end if;
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
    v_motif := nullif(btrim(p_motif), '');
    if v_auto then v_motif := 'Auto-validation par le déposant' || coalesce(' : ' || v_motif, ''); end if;
    perform private.moto_motif(coalesce(v_motif, 'Permis contrôlé sur original'));
    update public.moto_permis set statut = 'REMPLACE', remplace_par = r.id where titulaire_id = r.titulaire_id and statut = 'CONFORME';
    update public.moto_permis set statut = 'CONFORME', verifie_par = auth.uid(), verifie_at = now(),
           verification_rh_nom = btrim(p_verification_rh_nom), categorie_adaptee = true, motif_verification = v_motif
    where id = r.id;
  elsif v_dec = 'NON_CONFORME' then
    perform private.moto_motif(p_motif, 5);
    v_motif := btrim(p_motif);
    if v_auto then v_motif := 'Auto-validation par le déposant : ' || v_motif; end if;
    update public.moto_permis set statut = 'NON_CONFORME', verifie_par = auth.uid(), verifie_at = now(), motif_verification = v_motif
    where id = r.id;
  else
    perform private.moto_erreur('Décision attendue : CONFORME ou NON_CONFORME.');
  end if;
  return jsonb_build_object('id', r.id, 'statut', v_dec, 'auto_validation', v_auto);
end $function$;

create or replace function public.moto_etat_remise_confirmer(p_controle uuid, p_decision text, p_commentaire text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare c public.moto_controles; v_dec text := upper(coalesce(p_decision, '')); v_pour_compte boolean; v_com text;
begin
  if private.moto_classe() is null then perform private.moto_refus('Accès refusé.'); end if;
  select * into c from public.moto_controles where id = p_controle and type_controle = 'ETAT_REMISE' for update;
  if not found then perform private.moto_erreur('État de remise introuvable.'); end if;
  -- AFLP FLEET 14 : le BM ou l'ABM peut confirmer pour le compte du bénéficiaire, avec un commentaire tracé.
  v_pour_compte := c.beneficiaire_id is distinct from auth.uid();
  if v_pour_compte and coalesce(private.moto_classe() in ('BM','ABM'), false) is not true then
    perform private.moto_refus('Seul le bénéficiaire, le Branch Manager ou l''Assistant Branch Manager confirme l''état contradictoire.');
  end if;
  if c.confirmation_statut <> 'EN_ATTENTE' then perform private.moto_erreur('État déjà confirmé ou contesté.'); end if;
  if v_dec not in ('ACCEPTEE','ACCEPTEE_AVEC_RESERVES','CONTESTEE') then perform private.moto_erreur('Décision inconnue.'); end if;
  if v_pour_compte then
    perform private.moto_motif(p_commentaire, 15);
    v_com := 'Confirmé par ' || coalesce(private.moto_nom_profil(auth.uid()), 'le responsable') || ' pour le compte du bénéficiaire : ' || btrim(p_commentaire);
  elsif v_dec <> 'ACCEPTEE' then
    perform private.moto_motif(p_commentaire, 5); v_com := nullif(btrim(p_commentaire), '');
  else
    perform private.moto_motif(coalesce(p_commentaire, 'État accepté')); v_com := nullif(btrim(p_commentaire), '');
  end if;
  update public.moto_controles set confirmation_statut = v_dec, confirmation_at = now(), confirmation_commentaire = v_com
  where id = c.id;
  return jsonb_build_object('id', c.id, 'confirmation_statut', v_dec, 'pour_compte', v_pour_compte);
end $function$;

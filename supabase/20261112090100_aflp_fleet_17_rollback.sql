-- AFLP FLEET 17 : RETOUR ARRIÈRE (le BM n'approuve plus ses propres propositions).
-- Les versions auto-approuvées pendant la période restent telles quelles ; la contrainte revient en NOT VALID.
CREATE OR REPLACE FUNCTION public.moto_regle_version_approuver(p_version uuid, p_date_effet date, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r public.moto_regles_versions;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 10);
  select * into r from public.moto_regles_versions where id = p_version for update;
  if not found or r.statut <> 'BROUILLON' then perform private.moto_erreur('Version introuvable ou déjà traitée.'); end if;
  if r.propose_par = auth.uid() then
    perform private.moto_refus('Quatre yeux : le Branch Manager approuve une version proposée par un autre (coordinateur ou ABM).');
  end if;
  if r.nature_source = 'HYPOTHESE' then
    perform private.moto_refus('Une hypothèse non validée ne peut pas devenir une politique opérationnelle : requalifiez-la (constructeur avec référence, ou politique interne avec validation technique).');
  end if;
  if length(btrim(coalesce(r.reference_source, ''))) < 10 then perform private.moto_erreur('Référence de la source obligatoire avant approbation.'); end if;
  if p_date_effet is null then perform private.moto_erreur('Date d''effet obligatoire.'); end if;
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_regles_versions set statut = 'REMPLACEE', retire_par = auth.uid(), retire_at = now()
   where statut = 'APPROUVEE' and regle_code = r.regle_code and coalesce(modele_code, '') = coalesce(r.modele_code, '')
     and coalesce(moto_id::text, '') = coalesce(r.moto_id::text, '') and phase = r.phase;
  update public.moto_regles_versions set statut = 'APPROUVEE', approuve_par = auth.uid(), approuve_at = now(),
         date_effet = p_date_effet, motif_approbation = btrim(p_motif) where id = r.id;
  return jsonb_build_object('id', r.id, 'statut', 'APPROUVEE', 'date_effet', p_date_effet);
end $function$

;
alter table public.moto_regles_versions drop constraint if exists moto_regles_versions_check;
alter table public.moto_regles_versions add constraint moto_regles_versions_check check (((approuve_par is null) or (propose_par is null) or (approuve_par <> propose_par))) not valid;

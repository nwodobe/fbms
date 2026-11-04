-- =============================================================================
-- AFLP FLEET 11 : RETOUR ARRIÈRE de 20261107090000_aflp_fleet_11_auto_validation_documents
-- Restaure la fonction d'origine (auto-validation interdite) et la contrainte
-- moto_documents_check2, en NOT VALID : les documents auto-validés pendant la
-- période restent tels quels (aucune donnée modifiée), seules les nouvelles
-- écritures sont de nouveau contrôlées. Rejouable.
-- =============================================================================
begin;
CREATE OR REPLACE FUNCTION public.moto_document_verifier(p_document uuid, p_statut text, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.moto_documents;
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  select * into d from public.moto_documents where id = p_document for update;
  if not found then perform private.moto_erreur('Document introuvable.'); end if;
  if d.statut <> 'EN_VERIFICATION' then perform private.moto_erreur('Ce document a déjà été vérifié.'); end if;
  if d.depose_par = auth.uid() then perform private.moto_refus('Auto-validation interdite : un autre responsable doit vérifier ce document.'); end if;
  if upper(p_statut) not in ('CONFORME','NON_CONFORME') then perform private.moto_erreur('Statut de vérification inconnu.'); end if;
  perform private.moto_motif(p_motif, case when upper(p_statut) = 'NON_CONFORME' then 5 else 0 end);
  if upper(p_statut) = 'CONFORME' and d.date_expiration is not null and d.date_expiration < current_date then
    perform private.moto_erreur('Document expiré : il ne peut pas être déclaré conforme.');
  end if;
  update public.moto_documents set statut = upper(p_statut), verifie_par = auth.uid(), verifie_at = now(),
         motif_verification = nullif(btrim(p_motif), '')
  where id = p_document;
  if upper(p_statut) = 'CONFORME' and d.type_document in ('CARTE_GRISE','PLAQUE','ASSURANCE') then
    update public.moto_documents set statut = 'REMPLACE'
    where moto_id = d.moto_id and type_document = d.type_document and id <> d.id and statut in ('CONFORME','EN_VERIFICATION','NON_CONFORME');
  end if;
  perform private.moto_recalculer_statuts(d.moto_id);
  return jsonb_build_object('id', p_document, 'statut', upper(p_statut));
end $function$
;

alter table public.moto_documents drop constraint if exists moto_documents_check2;
alter table public.moto_documents add constraint moto_documents_check2 check (((verifie_par IS NULL) OR (verifie_par <> depose_par))) not valid;
commit;

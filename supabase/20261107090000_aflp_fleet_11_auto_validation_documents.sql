-- =============================================================================
-- AFLP FLEET 11 : auto-validation des documents moto par le BM ou l'ABM
-- -----------------------------------------------------------------------------
-- Décision du Branch Manager (04/11/2026) : « pas besoin d'un autre
-- responsable pour vérifier », étendue à TOUS les documents moto (carte
-- grise, plaque, assurance, PV de remise, rapports, factures, photos, autres).
--
-- Avant : seul un BM/ABM DIFFÉRENT du déposant pouvait déclarer un document
--         conforme (fonction + contrainte moto_documents_check2).
-- Après : le BM ou l'ABM qui a déposé peut valider lui-même. La trace reste :
--         verifie_par = deposé_par, motif préfixé « Auto-validation par le
--         déposant », journal immuable inchangé.
--
-- Inchangé : seuls BM et ABM vérifient ; document expiré jamais conforme ;
-- motif obligatoire pour NON_CONFORME ; remplacement de l'ancien document
-- conforme ; recalcul du statut administratif ; aucun document modifié par
-- cette migration ; aucune politique RLS modifiée.
--
-- STATUT : APPLIQUÉ EN PRODUCTION le 04/11/2026 (empreinte identique à la
-- réplique testée). L'écran (bouton « Valider ») suit par la fusion de la PR.
--
-- Rejouable. Retour arrière : 20261107090100_aflp_fleet_11_rollback.sql
-- =============================================================================

alter table public.moto_documents drop constraint if exists moto_documents_check2;

create or replace function public.moto_document_verifier(p_document uuid, p_statut text, p_motif text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare d public.moto_documents; v_auto boolean; v_motif text;
begin
  perform private.moto_exiger_classe(array['BM','ABM']);
  select * into d from public.moto_documents where id = p_document for update;
  if not found then perform private.moto_erreur('Document introuvable.'); end if;
  if d.statut <> 'EN_VERIFICATION' then perform private.moto_erreur('Ce document a déjà été vérifié.'); end if;
  if upper(p_statut) not in ('CONFORME','NON_CONFORME') then perform private.moto_erreur('Statut de vérification inconnu.'); end if;
  v_auto := d.depose_par = auth.uid();
  v_motif := nullif(btrim(p_motif), '');
  if v_auto then v_motif := 'Auto-validation par le déposant' || coalesce(' : ' || v_motif, ''); end if;
  perform private.moto_motif(coalesce(v_motif, p_motif), case when upper(p_statut) = 'NON_CONFORME' then 5 else 0 end);
  if upper(p_statut) = 'NON_CONFORME' and length(btrim(coalesce(p_motif, ''))) < 5 then
    perform private.moto_erreur('Motif obligatoire (5 caractères minimum) pour un document non conforme.');
  end if;
  if upper(p_statut) = 'CONFORME' and d.date_expiration is not null and d.date_expiration < current_date then
    perform private.moto_erreur('Document expiré : il ne peut pas être déclaré conforme.');
  end if;
  update public.moto_documents set statut = upper(p_statut), verifie_par = auth.uid(), verifie_at = now(),
         motif_verification = v_motif
  where id = p_document;
  if upper(p_statut) = 'CONFORME' and d.type_document in ('CARTE_GRISE','PLAQUE','ASSURANCE') then
    update public.moto_documents set statut = 'REMPLACE'
    where moto_id = d.moto_id and type_document = d.type_document and id <> d.id and statut in ('CONFORME','EN_VERIFICATION','NON_CONFORME');
  end if;
  perform private.moto_recalculer_statuts(d.moto_id);
  return jsonb_build_object('id', p_document, 'statut', upper(p_statut), 'auto_validation', v_auto);
end $function$;

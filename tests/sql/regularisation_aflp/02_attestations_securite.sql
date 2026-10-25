-- Tests de sécurité du modèle farmer_participation_attestations / farmer_notice_deliveries.
-- Tout est annulé (RAISE final). Résultat observé le 25/10/2026 :
--   T1 OK refus ; T2 OK refus ; T3 OK refus ; T4 OK ; T5 OK refus doublon ; T7 lignes modifiées=0 ;
--   T8 OK refus ; T9 OK refus ; T10 OK ; audit=2 ; consent_status inchangé (NOT_RECORDED)
-- Remplacer <UUID_BRANCH_MANAGER>, <UUID_UNIT_HEAD> et <VILLAGE_DU_UNIT_HEAD>.
do $$
declare log text:=''; v_pid text; n int;
 bm text:='{"sub":"<UUID_BRANCH_MANAGER>","role":"authenticated"}';
 uh text:='{"sub":"<UUID_UNIT_HEAD>","role":"authenticated"}';
begin
  insert into public.aflp_notice_versions(version,title,body_fr) values ('TEST-NOTICE','t','t');
  select id into v_pid from public.producteurs where not deleted and village_id='<VILLAGE_DU_UNIT_HEAD>' limit 1;
  perform set_config('request.jwt.claims',uh,true); perform set_config('role','authenticated',true);
  begin -- T1 : un Unit Head ne peut pas créer une attestation de responsable
    insert into public.farmer_participation_attestations(producteur_id,attestation_type,declared_agreement_date,enrollment_date_source,enrollment_channel_verified,evidence_basis,statement_version,statement_text,attested_by)
    values (v_pid,'MANAGER_RETROSPECTIVE_ATTESTATION',now()-interval '5 day','SERVER_INSERT_TIMESTAMP','X','X','v','t','<UUID_UNIT_HEAD>');
    log:=log||'T1 ECHEC; ';
  exception when others then log:=log||'T1 OK refus; '; end;
  perform set_config('request.jwt.claims',bm,true);
  begin -- T2 : une attestation de responsable ne peut pas porter de signature producteur
    insert into public.farmer_participation_attestations(producteur_id,attestation_type,declared_agreement_date,enrollment_date_source,enrollment_channel_verified,evidence_basis,statement_version,statement_text,attested_by,producer_signature_exists)
    values (v_pid,'MANAGER_RETROSPECTIVE_ATTESTATION',now()-interval '5 day','SERVER_INSERT_TIMESTAMP','X','X','v','t','<UUID_BRANCH_MANAGER>',true);
    log:=log||'T2 ECHEC; ';
  exception when others then log:=log||'T2 OK refus; '; end;
  begin -- T3 : le Branch Manager ne peut pas attester au nom d'un autre
    insert into public.farmer_participation_attestations(producteur_id,attestation_type,declared_agreement_date,enrollment_date_source,enrollment_channel_verified,evidence_basis,statement_version,statement_text,attested_by)
    values (v_pid,'MANAGER_RETROSPECTIVE_ATTESTATION',now()-interval '5 day','SERVER_INSERT_TIMESTAMP','X','X','v','t','<UUID_UNIT_HEAD>');
    log:=log||'T3 ECHEC; ';
  exception when others then log:=log||'T3 OK refus; '; end;
  insert into public.farmer_participation_attestations(producteur_id,attestation_type,declared_agreement_date,enrollment_date_source,enrollment_channel_verified,evidence_basis,statement_version,statement_text,attested_by)
  values (v_pid,'MANAGER_RETROSPECTIVE_ATTESTATION',now()-interval '5 day','SERVER_INSERT_TIMESTAMP','X','X','v','t','<UUID_BRANCH_MANAGER>');
  log:=log||'T4 OK; ';
  begin -- T5 : une seule attestation active par producteur
    insert into public.farmer_participation_attestations(producteur_id,attestation_type,declared_agreement_date,enrollment_date_source,enrollment_channel_verified,evidence_basis,statement_version,statement_text,attested_by)
    values (v_pid,'MANAGER_RETROSPECTIVE_ATTESTATION',now()-interval '5 day','SERVER_INSERT_TIMESTAMP','X','X','v','t','<UUID_BRANCH_MANAGER>');
    log:=log||'T5 ECHEC; ';
  exception when others then log:=log||'T5 OK refus doublon; '; end;
  update public.farmer_participation_attestations set statement_text='modifié' where producteur_id=v_pid; get diagnostics n = row_count;
  log:=log||'T7 lignes modifiées='||n||'; ';
  perform set_config('request.jwt.claims',uh,true);
  begin insert into public.farmer_notice_deliveries(producteur_id,notice_version,delivered_at,delivery_method,producer_acknowledged) values (v_pid,'TEST-NOTICE',now()+interval '3 day','READ_ALOUD',false); log:=log||'T8 ECHEC; ';
  exception when others then log:=log||'T8 OK refus; '; end;
  begin insert into public.farmer_notice_deliveries(producteur_id,notice_version,delivered_at,delivery_method,producer_acknowledged) values (v_pid,'TEST-NOTICE',now(),'READ_ALOUD',true); log:=log||'T9 ECHEC; ';
  exception when others then log:=log||'T9 OK refus; '; end;
  begin insert into public.farmer_notice_deliveries(producteur_id,notice_version,delivered_at,delivery_method,producer_acknowledged,acknowledgement_method) values (v_pid,'TEST-NOTICE',now(),'READ_ALOUD',true,'VERBAL'); log:=log||'T10 OK; ';
  exception when others then log:=log||'T10 KO '||sqlerrm||'; '; end;
  raise exception 'TESTS B rollback : %', log;
end $$;

-- =====================================================================
-- AFLP FLEET · RETOUR ARRIÈRE de la migration 7 (permis, carnet).
-- Restaure au texte près l'état issu des migrations 1 à 6.
-- REFUSÉ s'il existe déjà un permis enregistré (donnée réelle à préserver) :
-- dans ce cas, exporter puis décider explicitement.
-- Les fichiers déjà déposés sous permis/ dans le stockage ne sont pas supprimés.
-- =====================================================================
begin;

do $$ begin
  if to_regclass('public.moto_permis') is not null and exists (select 1 from public.moto_permis) then
    raise exception 'Retour arrière refusé : des permis sont enregistrés. Exportez-les et décidez explicitement avant toute suppression.';
  end if;
end $$;

drop function if exists public.moto_carnet(uuid);
drop function if exists private.moto_lib(text);
drop function if exists public.moto_permis_alertes();
drop view if exists public.moto_v_permis;
drop trigger if exists moto_affectations_permis_trg on public.moto_affectations;
drop function if exists private.moto_affectation_permis();
drop function if exists public.moto_permis_verifier(uuid, text, text, boolean, text);
drop function if exists public.moto_permis_enregistrer(jsonb);

-- Définitions d'origine (migration 2 pour le contrôle de remise, migration 6 pour le stockage)
create or replace function private.moto_controle_remise(p_moto uuid, p jsonb)
returns void language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_pv uuid := private.moto_uuid(p, 'pv_document_id'); v_req text; v_eq jsonb := coalesce(p -> 'equipements', '{}'::jsonb);
begin
  if not exists (select 1 from public.moto_documents where id = v_pv and moto_id = p_moto and type_document = 'PV_REMISE' and statut = 'CONFORME') then
    perform private.moto_erreur('Procès-verbal signé, numérisé et vérifié CONFORME obligatoire.');
  end if;
  if coalesce((p ->> 'permis_verifie')::boolean, false) is not true or nullif(btrim(p ->> 'permis_categorie'), '') is null
     or nullif(btrim(p ->> 'permis_verifie_par_nom'), '') is null then
    perform private.moto_erreur('Vérification RH du permis adapté obligatoire (catégorie et vérificateur).');
  end if;
  for v_req in select jsonb_array_elements_text(valeur_json) from public.moto_parametres where cle = 'equipements_obligatoires' loop
    if coalesce((v_eq ->> v_req)::boolean, false) is not true then
      perform private.moto_erreur(format('Équipement de sécurité manquant : %s.', v_req));
    end if;
  end loop;
  if private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('Relevé du compteur à la remise obligatoire.'); end if;
end $$;

create or replace function private.moto_peut_deposer(p_nom text)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid_ou_null((storage.foldername(p_nom))[1]);
        v_cat text := (storage.foldername(p_nom))[2];
        v_classe text := private.moto_classe();
begin
  if v_classe is null then return false; end if;
  if (storage.foldername(p_nom))[1] = 'depenses' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and v_cat = auth.uid()::text;
  end if;
  if (storage.foldername(p_nom))[1] = 'finmaint' then
    return v_classe in ('LOGISTIQUE','BM','ABM') and (storage.foldername(p_nom))[3] in ('devis','facture')
       and exists (select 1 from public.moto_motos where id = private.moto_uuid_ou_null((storage.foldername(p_nom))[2]));
  end if;
  if v_moto is null then return false; end if;
  if not exists (select 1 from public.moto_motos where id = v_moto) then return false; end if;
  if v_classe in ('BM','ABM') then return true; end if;
  if v_classe = 'LOGISTIQUE' then return v_cat in ('controle','incident','maintenance','photo','justificatif','document'); end if;
  if v_classe = 'ZONE' then return private.moto_peut_operer(v_moto) and v_cat in ('controle','incident','maintenance','photo'); end if;
  if v_classe = 'UNITE' then return private.moto_est_affectataire(v_moto) and v_cat in ('justificatif','incident','photo','controle'); end if;
  return false;
end $$;

alter policy moto_documents_consultation on storage.objects
  using (bucket_id = 'moto-documents'
         and ((private.moto_uuid_ou_null((storage.foldername(name))[1]) is not null
               and private.moto_dans_perimetre(private.moto_uuid_ou_null((storage.foldername(name))[1])))
              or ((storage.foldername(name))[1] = 'depenses'
                  and private.moto_lecture_enveloppe(private.moto_uuid_ou_null((storage.foldername(name))[2])))
              or ((storage.foldername(name))[1] = 'finmaint' and private.moto_lecture_fin_maintenance())));

alter table public.moto_affectations drop column if exists permis_id;
drop function if exists private.moto_permis_valide(uuid, date);
drop table if exists public.moto_permis;
drop function if exists private.moto_lecture_permis(uuid);
delete from public.moto_parametres where cle = 'permis_alerte_jours';

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','private') and p.proname like 'moto\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.nspname = 'public' or f.proname in ('moto_classe','moto_classe_de','moto_est_finance_manager','moto_mon_cluster','moto_ma_zone','moto_mon_nom',
        'moto_est_affectataire','moto_dans_perimetre','moto_lecture_finance','moto_lecture_enveloppe','moto_peut_deposer','moto_uuid_ou_null',
        'moto_nom_profil','moto_param','moto_fenetre','moto_lecture_fin_maintenance') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;

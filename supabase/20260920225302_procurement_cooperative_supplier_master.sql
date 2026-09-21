
begin;
alter table public.rcn_fournisseurs drop constraint if exists rcn_fournisseurs_categorie_check;
alter table public.rcn_fournisseurs add constraint rcn_fournisseurs_categorie_check
check(categorie in ('LBA','DIRECT','COOPERATIVE'));

create or replace function public.procurement_create_supplier(p jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare c jsonb;v_code text;v_name text;v_cat text;r public.rcn_fournisseurs;
begin
 c:=public.wms_ctx();
 if not private.ops_has_role(array['Branch Manager','Assistant Branch Manager','Procurement Officer','Supervisor','Administrateur'])
 then raise exception 'Droit insuffisant pour créer un Supplier'; end if;
 v_code:=upper(nullif(btrim(p->>'code'),''));
 v_name:=upper(nullif(btrim(p->>'name'),''));
 v_cat:=upper(coalesce(nullif(btrim(p->>'category'),''),'DIRECT'));
 if v_code is null then raise exception 'Supplier Code obligatoire'; end if;
 if v_name is null then raise exception 'Supplier Name obligatoire'; end if;
 if v_cat not in ('DIRECT','COOPERATIVE') then raise exception 'Category invalide pour cette fonction'; end if;
 if exists(select 1 from public.rcn_fournisseurs where code=v_code) then raise exception 'Supplier Code déjà utilisé'; end if;
 if exists(select 1 from public.rcn_fournisseurs where regexp_replace(upper(nom),'\s+',' ','g')=regexp_replace(v_name,'\s+',' ','g')) then
   raise exception 'Supplier avec ce nom déjà existant';
 end if;
 insert into public.rcn_fournisseurs(code,nom,categorie,statut,contrat,origines,sites,source_fichier,source_maj_at,updated_at)
 values(v_code,v_name,v_cat,'ACTIF',coalesce((p->>'contract')::boolean,false),
   case when nullif(btrim(p->>'origin'),'') is null then '{}'::text[] else array[upper(btrim(p->>'origin'))] end,
   case when nullif(btrim(p->>'site'),'') is null then '{}'::text[] else array[upper(btrim(p->>'site'))] end,
   'OPERATIONS_PROCUREMENT_SUPPLIER',now(),now())
 returning * into r;
 perform public.wms_audit(v_code,'procurement.supplier',null,to_jsonb(r),'Création Supplier Master');
 return to_jsonb(r);
end $$;
revoke all on function public.procurement_create_supplier(jsonb) from public,anon;
grant execute on function public.procurement_create_supplier(jsonb) to authenticated;
commit;
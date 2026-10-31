-- =====================================================================
-- AFLP FLEET (ex AFLP Moto Manager) — migration 5 : coordination logistique,
-- inspections, actions correctives, enveloppes, catalogue serveur.
--
-- STATUT : APPLIQUÉE EN PRODUCTION le 31/10/2026 sur autorisation écrite de
-- M. KOUASSI (« Applique »), en parties successives ; empreinte des 106
-- fonctions moto (code + droits) identique à la réplique testée, 28 tables,
-- 15 vues, 30 politiques, 0 droit anon. Rejouable (create or replace / if not exists).
-- Retour arrière : 20261101090100_aflp_fleet_5_rollback.sql.
--
-- Principes :
--  · Additive : aucune table ni colonne existante supprimée, aucune donnée
--    réelle modifiée (au 31/10/2026 : 0 moto en production).
--  · Aucun droit FBMS modifié : le rôle Logistics Coordinator est reconnu
--    par profils.fonction_operationnelle (mécanisme déjà utilisé par la
--    sacherie), la contrainte profils_role_check reste inchangée.
--  · Correctif de sécurité : la gravité d'un point de contrôle vient du
--    catalogue serveur, jamais du champ « critique » envoyé par le client.
--  · Aucune donnée historique inventée : inconnu = NULL (« Non disponible »).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Classe LOGISTIQUE (Logistics Coordinator)
-- ---------------------------------------------------------------------
create or replace function private.moto_classe_de(p_user uuid)
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
           when p.role = 'Branch Manager' then 'BM'
           when p.role = 'Assistant Branch Manager' then 'ABM'
           when p.role in ('Finance','Finance Manager') then 'FINANCE'
           when p.role = 'General Manager' then 'DIRECTION'
           -- Chef de zone et Chef d'unité gardent TOUJOURS leur classe, quelle que soit la fonction saisie.
           when p.role = 'Zonal Head' then 'ZONE'
           when p.role = 'Unit Head' then 'UNITE'
           -- Coordinateur : fonction opérationnelle modifiable par le seul Branch Manager (RLS profils + garde).
           when p.role = 'Logistics Coordinator'
             or public.aflp_norm(p.fonction_operationnelle) in ('LOGISTICS COORDINATOR','LOGISTICS_COORDINATOR','COORDINATEUR LOGISTIQUE')
             then 'LOGISTIQUE'
           else null end
  from public.profils p
  where p.user_id = p_user and p.actif = true
  limit 1
$$;

create or replace function private.moto_classe()
returns text language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$ select private.moto_classe_de(auth.uid()) $$;

-- Affectataire actuel (remise ou transfert actif) d'une moto.
create or replace function private.moto_affectataire(p_moto uuid)
returns uuid language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.beneficiaire_id from public.moto_affectations a
  where a.moto_id = p_moto and a.statut = 'ACTIVE' and a.type_affectation in ('REMISE','TRANSFERT') limit 1
$$;

-- Indépendance : l'affectataire ne contrôle ni ne débloque sa propre moto.
create or replace function private.moto_exiger_independance(p_moto uuid, p_objet text)
returns void language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if private.moto_affectataire(p_moto) = auth.uid() then
    perform private.moto_refus('Indépendance : ' || p_objet || ' ne peut pas être fait par l''utilisateur de la moto.');
  end if;
end $$;

-- Lecture : LOGISTIQUE voit tout le parc AFLP. Un bénéficiaire préaffecté
-- voit la moto pour confirmer l'état contradictoire de remise.
create or replace function private.moto_dans_perimetre(p_moto uuid)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text := private.moto_classe(); m record;
begin
  if v_classe is null then return false; end if;
  if v_classe in ('BM','ABM','FINANCE','DIRECTION','LOGISTIQUE') then return true; end if;
  select cluster_code, zone_code into m from public.moto_motos where id = p_moto;
  if not found then return false; end if;
  if exists (select 1 from public.moto_affectations a where a.moto_id = p_moto and a.statut = 'ACTIVE' and a.beneficiaire_id = auth.uid()) then
    return true;
  end if;
  if v_classe = 'ZONE' then
    -- Décision du 17/09/2026 : portée de LECTURE globale du Chef de Zone.
    if public.portee_terrain_globale() then return true; end if;
    return m.zone_code is not null and m.zone_code = private.moto_ma_zone();
  end if;
  if v_classe = 'UNITE' then
    return private.moto_est_affectataire(p_moto)
        or (m.cluster_code is not null and m.cluster_code = private.moto_mon_cluster());
  end if;
  return false;
end $$;

-- Écriture : le Chef de Zone n'agit que sur SA zone (ou sa propre moto).
-- La lecture reste globale ; l'écriture ne l'est plus (mandat AFLP FLEET, scénario 11).
create or replace function private.moto_peut_operer(p_moto uuid)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v text := private.moto_classe(); v_zone text;
begin
  if v in ('BM','ABM','LOGISTIQUE') then return exists (select 1 from public.moto_motos where id = p_moto); end if;
  if v = 'ZONE' then
    if private.moto_est_affectataire(p_moto) then return true; end if;
    select zone_code into v_zone from public.moto_motos where id = p_moto;
    return v_zone is not null and v_zone = private.moto_ma_zone();
  end if;
  if v = 'UNITE' then return private.moto_est_affectataire(p_moto); end if;
  return false;
end $$;

create or replace function private.moto_exiger_terrain(p_moto uuid)
returns text language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text := private.moto_exiger_classe(array['BM','ABM','ZONE','UNITE','LOGISTIQUE']); m public.moto_motos;
begin
  m := private.moto_charger(p_moto);
  if not private.moto_peut_operer(p_moto) then perform private.moto_refus('Moto hors de votre périmètre ou non affectée à votre compte.'); end if;
  if v_classe not in ('BM','ABM') and m.mise_en_service_at is null then
    perform private.moto_erreur('Moto non mise en service : saisie terrain impossible.');
  end if;
  return v_classe;
end $$;

-- ---------------------------------------------------------------------
-- 2. Situation du parc et dates distinctes (aucune valeur inventée)
-- ---------------------------------------------------------------------
alter table public.moto_motos alter column marque drop not null;
alter table public.moto_motos alter column modele drop not null;
alter table public.moto_motos add column if not exists situation_parc text not null default 'RECEPTIONNEE';
alter table public.moto_motos add column if not exists origine text not null default 'NEUVE';
alter table public.moto_motos add column if not exists date_acquisition date;
alter table public.moto_motos add column if not exists date_debut_utilisation date;
alter table public.moto_motos add column if not exists date_debut_suivi date;
alter table public.moto_motos add column if not exists historique_note text;
alter table public.moto_motos add column if not exists photo_path text;
alter table public.moto_motos add column if not exists compteur_reception_km numeric(10,1);
alter table public.moto_motos add column if not exists beneficiaire_prevu_id uuid references public.profils(user_id);
alter table public.moto_motos add column if not exists beneficiaire_prevu_libelle text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'moto_motos_situation_parc_check') then
    alter table public.moto_motos add constraint moto_motos_situation_parc_check check (situation_parc in ('PREVUE','RECEPTIONNEE'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'moto_motos_origine_check') then
    alter table public.moto_motos add constraint moto_motos_origine_check check (origine in ('NEUVE','EN_EXPLOITATION'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'moto_motos_prevue_check') then
    -- Une moto prévue n'est ni affectée ni en service.
    alter table public.moto_motos add constraint moto_motos_prevue_check
      check (situation_parc <> 'PREVUE' or (statut_affectation = 'NON_AFFECTEE' and mise_en_service_at is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'moto_motos_dates_check') then
    alter table public.moto_motos add constraint moto_motos_dates_check check (
      (date_acquisition is null or date_acquisition <= coalesce(date_debut_suivi, date_acquisition))
      and (date_debut_utilisation is null or date_acquisition is null or date_debut_utilisation >= date_acquisition));
  end if;
end $$;

-- Affectation d'un ABM, d'un Chef de zone ou du coordinateur : pas de cluster.
alter table public.moto_affectations alter column cluster_code drop not null;
alter table public.moto_affectations add column if not exists etat_remise_id uuid;

-- ---------------------------------------------------------------------
-- 3. Paramètres (règles internes explicites, provisoires, modifiables BM)
-- ---------------------------------------------------------------------
insert into public.moto_parametres (cle, valeur, valeur_json, unite, description, provisoire) values
  ('inspection_zone_jour_fin', 15, null, 'jour du mois', 'Fenêtre des inspections du Chef de zone : du 1er à ce jour inclus (mandat AFLP FLEET §8.1).', false),
  ('inspection_coordination_jour_debut', 20, null, 'jour du mois', 'Fenêtre du coordinateur logistique : de ce jour au dernier jour du mois (mandat §8.3). Du 16 au 19 : préparation.', false),
  ('etat_remise_validite_jours', 7, null, 'jours', 'Validité de l''état contradictoire avant remise (règle interne provisoire).', true),
  ('photos_inspection_min', 2, null, 'photos', 'Nombre minimal de photos d''une inspection mensuelle, dont une du compteur (règle interne provisoire).', true),
  ('photos_etat_remise_categories', null, '["AVANT","ARRIERE","GAUCHE","DROITE","COMPTEUR"]'::jsonb, null, 'Photos obligatoires de l''état contradictoire avant remise (mandat §7.B).', false),
  ('photos_reference_min', 5, null, 'photos', 'Inventaire photographique minimal de l''état de référence d''une moto déjà en exploitation, dont le compteur.', true),
  ('inspecteurs_independants', null, '[]'::jsonb, null, 'Comptes désignés par ANAGROCI pour l''inspection indépendante de la moto du coordinateur (en plus du BM et de l''ABM). Liste d''identifiants utilisateur.', false)
on conflict (cle) do nothing;

-- ---------------------------------------------------------------------
-- 4. Catalogue SERVEUR des points de contrôle (correctif de sécurité)
-- ---------------------------------------------------------------------
create table if not exists public.moto_catalogue_points (
  type_controle text not null check (type_controle in ('AVANT_DEPART','INSPECTION_INITIALE','REMISE_EN_SERVICE','ETAT_REMISE','INSPECTION_MENSUELLE')),
  code text not null check (code ~ '^[A-Z0-9_]{2,40}$'),
  libelle text not null,
  critique boolean not null,
  obligatoire boolean not null default true,
  ordre integer not null,
  actif boolean not null default true,
  primary key (type_controle, code)
);
insert into public.moto_catalogue_points (type_controle, code, libelle, critique, ordre)
select t.type_controle, x.code, x.libelle, x.critique, x.ordre
from (values
  ('FREIN_AVANT','Frein avant efficace',true,1), ('FREIN_ARRIERE','Frein arrière efficace',true,2),
  ('PNEUS','Pneus : pression correcte, sans coupure ni hernie',true,3), ('DIRECTION','Direction souple, sans jeu',true,4),
  ('FUITES','Aucune fuite de carburant ou d''huile',true,5), ('CASQUE','Casque porté et attaché',true,6),
  ('ECLAIRAGE','Phare, feu arrière, clignotants',false,7), ('KLAXON','Klaxon',false,8),
  ('RETROVISEURS','Rétroviseurs en place',false,9), ('CHAINE','Chaîne tendue et graissée',false,10),
  ('NIVEAU_HUILE','Niveau d''huile visible',false,11), ('GILET','Gilet haute visibilité porté',false,12)
) x(code, libelle, critique, ordre)
cross join (values ('AVANT_DEPART')) t(type_controle)
on conflict do nothing;
insert into public.moto_catalogue_points (type_controle, code, libelle, critique, ordre)
select t.type_controle, x.code, x.libelle, x.critique, x.ordre
from (values
  ('FREIN_AVANT','Frein avant efficace',true,1), ('FREIN_ARRIERE','Frein arrière efficace',true,2),
  ('PNEUS','Pneus : pression correcte, sans coupure ni hernie',true,3), ('DIRECTION','Direction souple, sans jeu',true,4),
  ('FUITES','Aucune fuite de carburant ou d''huile',true,5), ('ECLAIRAGE','Phare, feu arrière, clignotants',false,6),
  ('KLAXON','Klaxon',false,7), ('RETROVISEURS','Rétroviseurs en place',false,8), ('CHAINE','Chaîne tendue et graissée',false,9),
  ('NIVEAU_HUILE','Niveau d''huile visible',false,10), ('CADRE','Cadre et fourche sans fissure ni déformation',true,11),
  ('NUMEROS','Numéros châssis et moteur lisibles et conformes aux documents',false,12), ('BATTERIE','Batterie et démarrage',false,13)
) x(code, libelle, critique, ordre)
cross join (values ('INSPECTION_INITIALE'), ('REMISE_EN_SERVICE')) t(type_controle)
on conflict do nothing;
insert into public.moto_catalogue_points (type_controle, code, libelle, critique, ordre) values
  ('ETAT_REMISE','CARROSSERIE','Carrosserie, carénages et selle : état constaté et photographié',false,1),
  ('ETAT_REMISE','PNEUS_ETAT','Pneus : usure et état visibles, sans coupure ni hernie',true,2),
  ('ETAT_REMISE','ECLAIRAGE','Éclairage et clignotants fonctionnent',false,3),
  ('ETAT_REMISE','COMPTEUR_FONCTIONNE','Compteur kilométrique lisible et fonctionnel',false,4),
  ('ETAT_REMISE','RETROVISEURS','Rétroviseurs présents',false,5),
  ('ETAT_REMISE','CLES','Clés remises (nombre noté en observation)',false,6),
  ('ETAT_REMISE','OUTILLAGE','Trousse à outils remise',false,7),
  ('ETAT_REMISE','DOCUMENTS_BORD','Copies des documents de bord remises',false,8),
  ('INSPECTION_MENSUELLE','ETAT_GENERAL','État général (carrosserie, selle, cadre visible)',false,1),
  ('INSPECTION_MENSUELLE','COMPTEUR_FONCTIONNE','Compteur kilométrique lisible et fonctionnel',false,2),
  ('INSPECTION_MENSUELLE','PNEUS','Pneus : usure, pression, sans coupure ni hernie',true,3),
  ('INSPECTION_MENSUELLE','FREIN_AVANT','Frein avant efficace',true,4),
  ('INSPECTION_MENSUELLE','FREIN_ARRIERE','Frein arrière efficace',true,5),
  ('INSPECTION_MENSUELLE','DIRECTION','Direction souple, sans jeu',true,6),
  ('INSPECTION_MENSUELLE','FUITES','Aucune fuite de carburant ou d''huile',true,7),
  ('INSPECTION_MENSUELLE','TRANSMISSION','Transmission : chaîne, pignons, tension',false,8),
  ('INSPECTION_MENSUELLE','ECLAIRAGE','Phare, feu arrière, clignotants',false,9),
  ('INSPECTION_MENSUELLE','DOCUMENTS','Documents de bord présents et valides',false,10),
  ('INSPECTION_MENSUELLE','EQUIPEMENTS','Casque et gilet présents et en bon état',false,11)
on conflict do nothing;

-- Validation et normalisation d'une liste de points.
-- Rejette : liste vide, code inconnu ou inactif, doublon, point obligatoire
-- absent, résultat non booléen. La gravité est celle du catalogue.
create or replace function private.moto_items_controles(p_type text, p_items jsonb)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare it jsonb; v_code text; v_vus text[] := '{}'; c public.moto_catalogue_points; v_out jsonb := '[]'::jsonb;
        v_crit boolean := false; v_def integer := 0; v_crit_lib text[] := '{}'; v_manquants text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.moto_erreur('Liste de points de contrôle vide ou invalide.');
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' or jsonb_typeof(it -> 'ok') is distinct from 'boolean' or nullif(it ->> 'code', '') is null then
      perform private.moto_erreur('Point de contrôle invalide : chaque point exige un code et un résultat oui/non.');
    end if;
    v_code := upper(btrim(it ->> 'code'));
    select * into c from public.moto_catalogue_points where type_controle = p_type and code = v_code and actif;
    if not found then perform private.moto_erreur(format('Point de contrôle inconnu pour ce contrôle : %s.', v_code)); end if;
    if v_code = any(v_vus) then perform private.moto_erreur(format('Point de contrôle en double : %s.', v_code)); end if;
    v_vus := v_vus || v_code;
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', c.code, 'libelle', c.libelle, 'critique', c.critique,
               'ok', (it ->> 'ok')::boolean, 'observation', left(nullif(btrim(it ->> 'observation'), ''), 500)));
    if not (it ->> 'ok')::boolean then
      v_def := v_def + 1;
      if c.critique then v_crit := true; v_crit_lib := v_crit_lib || c.libelle; end if;
    end if;
  end loop;
  select string_agg(libelle, ', ' order by ordre) into v_manquants from public.moto_catalogue_points
   where type_controle = p_type and actif and obligatoire and not (code = any(v_vus));
  if v_manquants is not null then perform private.moto_erreur('Points obligatoires non renseignés : '||v_manquants||'.'); end if;
  return jsonb_build_object('items', v_out, 'critique', v_crit, 'defauts', v_def, 'critiques', to_jsonb(v_crit_lib));
end $$;

-- L'ancienne fonction faisait confiance au champ client « critique » :
-- elle est neutralisée (plus aucun appelant après cette migration).
create or replace function private.moto_items_valides(p_items jsonb)
returns boolean language plpgsql immutable as $$
begin
  raise exception 'Fonction retirée : utiliser private.moto_items_controles (catalogue serveur).' using errcode = 'P0001';
end $$;
alter function private.moto_items_valides(jsonb) set search_path = public, private, pg_temp;

-- ---------------------------------------------------------------------
-- 5. Photos datées
-- ---------------------------------------------------------------------
create table if not exists public.moto_photos (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  storage_path text not null unique,
  categorie text not null check (categorie in ('PRINCIPALE','AVANT','ARRIERE','GAUCHE','DROITE','COMPTEUR','ANOMALIE','DOCUMENT','AUTRE')),
  controle_id uuid,
  action_id uuid,
  legende text,
  prise_at timestamptz not null default now(),
  depose_par uuid not null default auth.uid()
);
create index if not exists moto_photos_moto_idx on public.moto_photos (moto_id, prise_at desc);

-- Enregistre un lot de photos [{path, categorie, legende}] déjà déposées.
create or replace function private.moto_photos_enregistrer(p_moto uuid, p_controle uuid, p_photos jsonb, p_min integer, p_requises text[])
returns integer language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare ph jsonb; v_cat text; v_cats text[] := '{}'; v_n integer := 0; v_manque text;
begin
  if p_photos is not null and jsonb_typeof(p_photos) <> 'array' then perform private.moto_erreur('Liste de photos invalide.'); end if;
  for ph in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    v_cat := upper(coalesce(nullif(btrim(ph ->> 'categorie'), ''), 'AUTRE'));
    if v_cat not in ('AVANT','ARRIERE','GAUCHE','DROITE','COMPTEUR','ANOMALIE','DOCUMENT','AUTRE') then
      perform private.moto_erreur('Catégorie de photo inconnue : '||v_cat||'.');
    end if;
    if nullif(ph ->> 'path', '') is null then perform private.moto_erreur('Photo sans fichier.'); end if;
    perform private.moto_stockage_valide(p_moto, ph ->> 'path', array['controle','photo']);
    -- Une photo = un fichier distinct, jamais réutilisé d'un contrôle à l'autre.
    if exists (select 1 from public.moto_photos where storage_path = ph ->> 'path') then
      perform private.moto_erreur('Photo déjà utilisée : chaque vue exige un fichier distinct.');
    end if;
    insert into public.moto_photos (moto_id, storage_path, categorie, controle_id, legende)
    values (p_moto, ph ->> 'path', v_cat, p_controle, left(nullif(btrim(ph ->> 'legende'), ''), 200));
    v_cats := v_cats || v_cat; v_n := v_n + 1;
  end loop;
  if v_n < coalesce(p_min, 0) then
    perform private.moto_erreur(format('Photos insuffisantes : %s exigée(s), %s fournie(s).', p_min, v_n));
  end if;
  select string_agg(r, ', ') into v_manque from unnest(coalesce(p_requises, '{}')) r where not (r = any(v_cats));
  if v_manque is not null then perform private.moto_erreur('Photos obligatoires manquantes : '||v_manque||'.'); end if;
  return v_n;
end $$;

create or replace function public.moto_photo_ajouter(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_classe text; v_principale boolean := coalesce((p ->> 'principale')::boolean, false);
        v_cat text := upper(coalesce(nullif(p ->> 'categorie', ''), case when coalesce((p ->> 'principale')::boolean, false) then 'PRINCIPALE' else 'AUTRE' end));
        v_id uuid;
begin
  v_classe := private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE','ZONE','UNITE']);
  perform private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre.'); end if;
  if v_principale and v_classe not in ('BM','ABM','LOGISTIQUE') then
    perform private.moto_refus('Seuls le Branch Manager, l''ABM et le coordinateur logistique définissent la photo principale.');
  end if;
  if v_cat not in ('PRINCIPALE','AVANT','ARRIERE','GAUCHE','DROITE','COMPTEUR','ANOMALIE','DOCUMENT','AUTRE') then
    perform private.moto_erreur('Catégorie de photo inconnue.');
  end if;
  if nullif(p ->> 'path', '') is null then perform private.moto_erreur('Fichier photo obligatoire.'); end if;
  perform private.moto_stockage_valide(v_moto, p ->> 'path', array['photo']);
  perform private.moto_motif(case when v_principale then 'Photo principale' else 'Ajout de photo' end);
  insert into public.moto_photos (moto_id, storage_path, categorie, legende)
  values (v_moto, p ->> 'path', case when v_principale then 'PRINCIPALE' else v_cat end, left(nullif(btrim(p ->> 'legende'), ''), 200))
  on conflict (storage_path) do update set legende = excluded.legende returning id into v_id;
  if v_principale then update public.moto_motos set photo_path = p ->> 'path', updated_at = now() where id = v_moto; end if;
  return jsonb_build_object('id', v_id, 'principale', v_principale);
end $$;

-- ---------------------------------------------------------------------
-- 6. Contrôles : nouveaux types et champs
-- ---------------------------------------------------------------------
alter table public.moto_controles drop constraint if exists moto_controles_type_controle_check;
alter table public.moto_controles add constraint moto_controles_type_controle_check
  check (type_controle in ('INSPECTION_INITIALE','AVANT_DEPART','REMISE_EN_SERVICE','ETAT_REMISE','INSPECTION_MENSUELLE'));
alter table public.moto_controles add column if not exists niveau text check (niveau is null or niveau in ('ZONE','COORDINATION','INDEPENDANTE'));
alter table public.moto_controles add column if not exists periode date;
alter table public.moto_controles add column if not exists conformite text check (conformite is null or conformite in ('CONFORME','RESERVES','NON_CONFORME','NON_EVALUABLE'));
alter table public.moto_controles add column if not exists observations text;
alter table public.moto_controles add column if not exists besoins_entretien text;
alter table public.moto_controles add column if not exists beneficiaire_id uuid references public.profils(user_id);
alter table public.moto_controles add column if not exists confirmation_statut text
  check (confirmation_statut is null or confirmation_statut in ('EN_ATTENTE','ACCEPTEE','ACCEPTEE_AVEC_RESERVES','CONTESTEE'));
alter table public.moto_controles add column if not exists confirmation_at timestamptz;
alter table public.moto_controles add column if not exists confirmation_commentaire text;
alter table public.moto_controles add column if not exists equipements jsonb;
alter table public.moto_controles add column if not exists documents_presents jsonb;
alter table public.moto_controles add column if not exists date_remise_prevue date;
alter table public.moto_controles add column if not exists inspecteur_externe text;
alter table public.moto_controles add column if not exists compteur_incoherent boolean not null default false;
alter table public.moto_controles add column if not exists actions_ouvertes_avant integer;
alter table public.moto_controles add column if not exists remplace_id uuid;
alter table public.moto_controles add column if not exists remplace_par uuid;
alter table public.moto_controles add column if not exists motif_correction text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'moto_controles_confirmation_check') then
    alter table public.moto_controles add constraint moto_controles_confirmation_check
      check (beneficiaire_id is null or beneficiaire_id <> realise_par);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'moto_controles_mensuelle_check') then
    alter table public.moto_controles add constraint moto_controles_mensuelle_check
      check (type_controle <> 'INSPECTION_MENSUELLE' or (niveau is not null and periode is not null and conformite is not null));
  end if;
end $$;
-- Une inspection mensuelle par moto, par mois et par niveau (hors versions remplacées).
create unique index if not exists moto_controles_mensuelle_unique
  on public.moto_controles (moto_id, periode, niveau)
  where type_controle = 'INSPECTION_MENSUELLE' and remplace_par is null;

-- ---------------------------------------------------------------------
-- 7. Actions correctives (une par anomalie ouverte, jamais dupliquée)
-- ---------------------------------------------------------------------
create table if not exists public.moto_actions_correctives (
  id uuid primary key default gen_random_uuid(),
  moto_id uuid not null references public.moto_motos(id),
  point_code text,
  anomalie text not null check (length(btrim(anomalie)) >= 3),
  gravite text not null check (gravite in ('CRITIQUE','MAJEURE','MINEURE')),
  constat_at timestamptz not null default now(),
  photo_path text,
  signale_par uuid not null default auth.uid(),
  source_controle_id uuid,
  derniere_controle_id uuid,
  derniere_constat_at timestamptz not null default now(),
  occurrences integer not null default 1 check (occurrences >= 1),
  statut text not null default 'OUVERTE' check (statut in ('OUVERTE','PLANIFIEE','REALISEE','CLOTUREE','ANNULEE')),
  responsable_id uuid references public.profils(user_id),
  action_prevue text,
  prestataire text,
  devis_montant numeric(14,0) check (devis_montant is null or devis_montant >= 0),
  devis_path text,
  maintenance_id uuid references public.moto_maintenances(id),
  date_cible date,
  planifie_par uuid,
  realise_at date,
  realise_par uuid,
  cout_reel numeric(14,0) check (cout_reel is null or cout_reel >= 0),
  justificatif_path text,
  verifie_par uuid,
  verifie_at timestamptz,
  verification_note text,
  rejets_verification integer not null default 0,
  annule_par uuid,
  motif_annulation text,
  created_at timestamptz not null default now(),
  check (verifie_par is null or verifie_par <> realise_par),
  check (statut <> 'CLOTUREE' or (verifie_par is not null and verifie_at is not null)),
  check (statut not in ('REALISEE','CLOTUREE') or realise_at is not null)
);
create unique index if not exists moto_actions_ouvertes_unique
  on public.moto_actions_correctives (moto_id, point_code)
  where point_code is not null and statut in ('OUVERTE','PLANIFIEE','REALISEE');

-- Crée ou met à jour (sans doublon) les actions des points KO d'un contrôle.
create or replace function private.moto_actions_depuis_items(p_moto uuid, p_controle uuid, p_items jsonb)
returns integer language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare it jsonb; v_n integer := 0;
begin
  for it in select * from jsonb_array_elements(p_items) where not (value ->> 'ok')::boolean loop
    update public.moto_actions_correctives
       set occurrences = occurrences + 1, derniere_controle_id = p_controle, derniere_constat_at = now()
     where moto_id = p_moto and point_code = it ->> 'code' and statut in ('OUVERTE','PLANIFIEE','REALISEE');
    if not found then
      insert into public.moto_actions_correctives (moto_id, point_code, anomalie, gravite, source_controle_id, derniere_controle_id)
      values (p_moto, it ->> 'code',
              (it ->> 'libelle') || coalesce(' : ' || (it ->> 'observation'), ''),
              case when (it ->> 'critique')::boolean then 'CRITIQUE' else 'MAJEURE' end, p_controle, p_controle);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function private.moto_actions_ouvertes(p_moto uuid)
returns integer language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select count(*)::integer from public.moto_actions_correctives where moto_id = p_moto and statut in ('OUVERTE','PLANIFIEE','REALISEE') $$;

-- Immobilisation unique tant qu'une anomalie critique est ouverte.
create or replace function private.moto_immobiliser_si_critique(p_moto uuid, p_motif text, p_source uuid)
returns void language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if not exists (select 1 from public.moto_immobilisations where moto_id = p_moto and fin is null) then
    perform private.moto_ouvrir_immobilisation(p_moto, p_motif, 'CONTROLE', p_source);
  else
    perform private.moto_recalculer_statuts(p_moto);
  end if;
end $$;

create or replace function public.moto_action_signaler(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id');
        v_grav text := upper(coalesce(p ->> 'gravite', '')); v_id uuid; v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE','ZONE','UNITE']);
  perform private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre ou non affectée à votre compte.'); end if;
  if v_grav not in ('CRITIQUE','MAJEURE','MINEURE') then perform private.moto_erreur('Gravité : CRITIQUE, MAJEURE ou MINEURE.'); end if;
  if length(btrim(coalesce(p ->> 'anomalie', ''))) < 5 then perform private.moto_erreur('Décrivez l''anomalie (5 caractères minimum).'); end if;
  if nullif(p ->> 'photo_path', '') is not null then perform private.moto_stockage_valide(v_moto, p ->> 'photo_path', array['photo','controle','incident']); end if;
  perform private.moto_motif('Signalement d''anomalie');
  insert into public.moto_actions_correctives (moto_id, anomalie, gravite, photo_path)
  values (v_moto, btrim(p ->> 'anomalie'), v_grav, nullif(p ->> 'photo_path', '')) returning id into v_id;
  if v_grav = 'CRITIQUE' then
    perform private.moto_immobiliser_si_critique(v_moto, 'Anomalie critique signalée : '||left(btrim(p ->> 'anomalie'), 120), v_id);
  end if;
  v_res := jsonb_build_object('id', v_id, 'gravite', v_grav, 'immobilisation', v_grav = 'CRITIQUE');
  perform private.moto_op_enregistrer(v_client, 'ACTION_SIGNALER', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_action_planifier(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare a public.moto_actions_correctives; v_resp uuid := private.moto_uuid(p, 'responsable_id'); v_mt uuid := private.moto_uuid(p, 'maintenance_id');
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  select * into a from public.moto_actions_correctives where id = private.moto_uuid(p, 'action_id') for update;
  if not found or a.statut not in ('OUVERTE','PLANIFIEE') then perform private.moto_erreur('Action introuvable ou non planifiable.'); end if;
  if length(btrim(coalesce(p ->> 'action_prevue', ''))) < 5 then perform private.moto_erreur('Action prévue obligatoire (5 caractères minimum).'); end if;
  if nullif(p ->> 'date_cible', '') is null or (p ->> 'date_cible')::date < a.constat_at::date then
    perform private.moto_erreur('Date cible obligatoire, postérieure au constat.');
  end if;
  if v_resp is not null and private.moto_classe_de(v_resp) is null then perform private.moto_erreur('Responsable inconnu ou inactif.'); end if;
  if v_mt is not null and not exists (select 1 from public.moto_maintenances where id = v_mt and moto_id = a.moto_id) then
    perform private.moto_erreur('La maintenance liée doit concerner la même moto.');
  end if;
  if nullif(p ->> 'devis_path', '') is not null then perform private.moto_stockage_valide(a.moto_id, p ->> 'devis_path', array['maintenance']); end if;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Planification d''une action corrective'));
  update public.moto_actions_correctives set statut = 'PLANIFIEE', responsable_id = coalesce(v_resp, auth.uid()),
         action_prevue = btrim(p ->> 'action_prevue'), prestataire = nullif(btrim(p ->> 'prestataire'), ''),
         devis_montant = private.moto_num(p, 'devis_montant'), devis_path = nullif(p ->> 'devis_path', ''),
         maintenance_id = v_mt, date_cible = (p ->> 'date_cible')::date, planifie_par = auth.uid()
  where id = a.id;
  return jsonb_build_object('id', a.id, 'statut', 'PLANIFIEE');
end $$;

create or replace function public.moto_action_realiser(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare a public.moto_actions_correctives; v_cout numeric := private.moto_num(p, 'cout_reel');
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE','ZONE']);
  select * into a from public.moto_actions_correctives where id = private.moto_uuid(p, 'action_id') for update;
  if not found or a.statut <> 'PLANIFIEE' then perform private.moto_erreur('Seule une action planifiée peut être déclarée réalisée.'); end if;
  if not private.moto_peut_operer(a.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if nullif(p ->> 'realise_at', '') is null or (p ->> 'realise_at')::date > current_date or (p ->> 'realise_at')::date < a.constat_at::date then
    perform private.moto_erreur('Date de réalisation réelle obligatoire (ni future, ni antérieure au constat).');
  end if;
  if v_cout is not null and v_cout > 0 and nullif(p ->> 'justificatif_path', '') is null then
    perform private.moto_erreur('Facture ou justificatif obligatoire pour une dépense.');
  end if;
  if nullif(p ->> 'justificatif_path', '') is not null then
    perform private.moto_stockage_valide(a.moto_id, p ->> 'justificatif_path', array['maintenance','justificatif']);
  end if;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Réalisation d''une action corrective'));
  update public.moto_actions_correctives set statut = 'REALISEE', realise_at = (p ->> 'realise_at')::date, realise_par = auth.uid(),
         cout_reel = v_cout, justificatif_path = nullif(p ->> 'justificatif_path', '')
  where id = a.id;
  return jsonb_build_object('id', a.id, 'statut', 'REALISEE');
end $$;

-- Clôture = vérification par une AUTRE personne que celle qui a réalisé.
-- La clôture ne lève jamais l'immobilisation : la remise en service suit son circuit.
create or replace function public.moto_action_verifier(p_action uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare a public.moto_actions_correctives; v_dec text := upper(coalesce(p_decision, ''));
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE','ZONE']);
  select * into a from public.moto_actions_correctives where id = p_action for update;
  if not found or a.statut <> 'REALISEE' then perform private.moto_erreur('Seule une action réalisée peut être vérifiée.'); end if;
  if not private.moto_peut_operer(a.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if a.realise_par = auth.uid() then perform private.moto_refus('Séparation des tâches : la personne qui a réalisé ne vérifie pas son propre travail.'); end if;
  perform private.moto_exiger_independance(a.moto_id, 'la vérification d''une réparation');
  if v_dec not in ('VALIDEE','REJETEE') then perform private.moto_erreur('Décision : VALIDEE ou REJETEE.'); end if;
  perform private.moto_motif(p_note, 5);
  perform set_config('moto.valideur', auth.uid()::text, true);
  if v_dec = 'VALIDEE' then
    update public.moto_actions_correctives set statut = 'CLOTUREE', verifie_par = auth.uid(), verifie_at = now(), verification_note = btrim(p_note)
    where id = a.id;
  else
    update public.moto_actions_correctives set statut = 'PLANIFIEE', realise_at = null, realise_par = null,
           verification_note = btrim(p_note), rejets_verification = rejets_verification + 1
    where id = a.id;
  end if;
  return jsonb_build_object('id', a.id, 'statut', case when v_dec = 'VALIDEE' then 'CLOTUREE' else 'PLANIFIEE' end);
end $$;

create or replace function public.moto_action_annuler(p_action uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare a public.moto_actions_correctives;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 10);
  select * into a from public.moto_actions_correctives where id = p_action for update;
  if not found or a.statut in ('CLOTUREE','ANNULEE') then perform private.moto_erreur('Action introuvable ou déjà close.'); end if;
  if a.signale_par = auth.uid() then perform private.moto_refus('Le signalant n''annule pas son propre signalement.'); end if;
  if a.gravite = 'CRITIQUE' then
    perform private.moto_erreur('Une anomalie critique ne s''annule pas : elle se clôt par une vérification après correction.');
  end if;
  update public.moto_actions_correctives set statut = 'ANNULEE', annule_par = auth.uid(), motif_annulation = btrim(p_motif) where id = a.id;
  return jsonb_build_object('id', a.id, 'statut', 'ANNULEE');
end $$;

-- ---------------------------------------------------------------------
-- 8. Inspection mécanique initiale / état technique de référence
--    (catalogue serveur ; actions correctives ; photos)
-- ---------------------------------------------------------------------
create or replace function public.moto_inspection_initiale(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_chk jsonb; v_crit boolean; v_res text; v_id uuid;
        v_rapport uuid := private.moto_uuid(p, 'rapport_document_id'); m public.moto_motos; v_ref boolean;
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','LOGISTIQUE']);
  m := private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre.'); end if;
  if m.situation_parc = 'PREVUE' then perform private.moto_erreur('Moto non réceptionnée : enregistrez d''abord la réception.'); end if;
  if nullif(btrim(p ->> 'intervenant_nom'), '') is null or nullif(btrim(p ->> 'garage_nom'), '') is null then
    perform private.moto_erreur('Nom du mécanicien et du garage obligatoires.');
  end if;
  if v_rapport is not null and not exists (select 1 from public.moto_documents where id = v_rapport and moto_id = v_moto and type_document = 'RAPPORT_MECANICIEN') then
    perform private.moto_erreur('Le rapport doit être un document RAPPORT_MECANICIEN de cette moto.');
  end if;
  v_ref := m.origine = 'EN_EXPLOITATION';
  if v_ref and private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('État de référence : relevé du compteur obligatoire.'); end if;
  v_chk := private.moto_items_controles('INSPECTION_INITIALE', p -> 'items');
  v_crit := (v_chk ->> 'critique')::boolean;
  v_res := case when v_crit then 'INAPTE' when upper(coalesce(p ->> 'resultat', 'INAPTE')) = 'APTE' then 'APTE' else 'INAPTE' end;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), case when v_ref then 'État technique de référence' else 'Inspection mécanique initiale' end));
  insert into public.moto_controles (moto_id, type_controle, compteur_km, items, anomalie_critique, resultat,
                                     intervenant_nom, garage_nom, avis_mecanicien, rapport_document_id, observations, inspecteur_externe)
  values (v_moto, 'INSPECTION_INITIALE', private.moto_num(p, 'compteur_km'), v_chk -> 'items', v_crit, v_res,
          btrim(p ->> 'intervenant_nom'), btrim(p ->> 'garage_nom'), nullif(btrim(p ->> 'avis_mecanicien'), ''), v_rapport,
          nullif(btrim(p ->> 'observations'), ''), nullif(btrim(p ->> 'inspecteur_externe'), ''))
  returning id into v_id;
  perform private.moto_photos_enregistrer(v_moto, v_id, p -> 'photos',
            case when v_ref then private.moto_param('photos_reference_min')::integer else 0 end,
            case when v_ref then array['COMPTEUR'] else '{}'::text[] end);
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'CONTROLE');
  perform private.moto_actions_depuis_items(v_moto, v_id, v_chk -> 'items');
  if v_ref and m.date_debut_suivi is null then
    update public.moto_motos set date_debut_suivi = current_date, updated_at = now() where id = v_moto;
  end if;
  if v_crit then
    perform private.moto_immobiliser_si_critique(v_moto, 'Anomalie critique à l''inspection '||case when v_ref then 'de référence' else 'initiale' end, v_id);
  end if;
  perform private.moto_recalculer_statuts(v_moto);
  return jsonb_build_object('id', v_id, 'resultat', v_res, 'anomalie_critique', v_crit, 'etat_reference', v_ref);
end $$;

-- Contrôle avant départ : la gravité vient du catalogue serveur.
create or replace function public.moto_controle_depart(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id');
        v_chk jsonb; v_crit boolean; v_res text; v_id uuid; v_inc jsonb; v_out jsonb; m public.moto_motos;
        v_at timestamptz := coalesce(nullif(p ->> 'date_controle', '')::timestamptz, now());
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_terrain(v_moto);
  m := private.moto_charger(v_moto, true);
  v_chk := private.moto_items_controles('AVANT_DEPART', p -> 'items');
  v_crit := (v_chk ->> 'critique')::boolean;
  v_res := case when (v_chk ->> 'defauts')::integer > 0 then 'INAPTE' else 'APTE' end;
  insert into public.moto_controles (moto_id, type_controle, date_controle, compteur_km, items, anomalie_critique, resultat, client_op_id)
  values (v_moto, 'AVANT_DEPART', v_at, private.moto_num(p, 'compteur_km'), v_chk -> 'items', v_crit, v_res, v_client)
  returning id into v_id;
  begin
    perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), v_at, 'CONTROLE');
  exception when sqlstate 'P0001' then null; -- un compteur douteux n'empêche jamais d'enregistrer une anomalie
  end;
  -- Points critiques KO : traités par le circuit incident (pas de second dossier).
  -- Points non critiques KO : une action corrective, sans doublon.
  perform private.moto_actions_depuis_items(v_moto, v_id,
            coalesce((select jsonb_agg(e) from jsonb_array_elements(v_chk -> 'items') e where not (e ->> 'critique')::boolean), '[]'::jsonb));
  if v_crit then
    v_inc := public.moto_incident_declarer(jsonb_build_object('moto_id', v_moto, 'type_incident', 'ANOMALIE', 'gravite', 'CRITIQUE',
             'description', 'Anomalie critique au contrôle avant départ : '||coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v_chk -> 'critiques') x), ''),
             'arret_confirme', true, 'survenu_at', v_at));
  end if;
  v_out := jsonb_build_object('id', v_id, 'resultat', v_res, 'anomalie_critique', v_crit, 'incident', v_inc);
  perform private.moto_op_enregistrer(v_client, 'CONTROLE_DEPART', 'SYNCHRONISE', v_out);
  return v_out;
end $$;

create or replace function public.moto_controle_remise_en_service(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_chk jsonb; v_crit boolean; v_res text; v_id uuid;
begin
  perform private.moto_exiger_classe(array['BM','ZONE','ABM','LOGISTIQUE']);
  perform private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  perform private.moto_exiger_independance(v_moto, 'le contrôle de remise en service');
  if nullif(btrim(p ->> 'intervenant_nom'), '') is null then perform private.moto_erreur('Nom de l''intervenant obligatoire.'); end if;
  v_chk := private.moto_items_controles('REMISE_EN_SERVICE', p -> 'items');
  v_crit := (v_chk ->> 'critique')::boolean;
  v_res := case when (v_chk ->> 'defauts')::integer > 0 then 'INAPTE' else 'APTE' end;
  perform private.moto_motif(p ->> 'motif');
  insert into public.moto_controles (moto_id, type_controle, compteur_km, items, anomalie_critique, resultat, intervenant_nom, garage_nom, avis_mecanicien, rapport_document_id)
  values (v_moto, 'REMISE_EN_SERVICE', private.moto_num(p, 'compteur_km'), v_chk -> 'items', v_crit, v_res, btrim(p ->> 'intervenant_nom'),
          nullif(btrim(p ->> 'garage_nom'), ''), nullif(btrim(p ->> 'avis_mecanicien'), ''), private.moto_uuid(p, 'rapport_document_id'))
  returning id into v_id;
  perform private.moto_photos_enregistrer(v_moto, v_id, p -> 'photos', 0, '{}');
  return jsonb_build_object('id', v_id, 'resultat', v_res);
end $$;

-- Levée d'une immobilisation de contrôle : contrôle APTE postérieur, aucune
-- anomalie critique ouverte (preuve de correction vérifiée), et levée par
-- une autre personne que l'auteur du contrôle de remise en service.
create or replace function public.moto_lever_immobilisation(p_immobilisation uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare im public.moto_immobilisations; v_ctrl public.moto_controles;
begin
  perform private.moto_exiger_classe(array['BM','ZONE']);
  perform private.moto_motif(p_motif, 5);
  select * into im from public.moto_immobilisations where id = p_immobilisation for update;
  if not found or im.fin is not null then perform private.moto_erreur('Immobilisation introuvable ou déjà levée.'); end if;
  if not private.moto_peut_operer(im.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if im.source_type in ('INCIDENT','MAINTENANCE') then perform private.moto_erreur('Cette immobilisation se lève par le circuit de l''incident ou de la maintenance.'); end if;
  perform private.moto_exiger_independance(im.moto_id, 'la levée d''immobilisation');
  if not private.moto_controle_apte_depuis(im.moto_id, im.debut) then
    perform private.moto_erreur('Levée bloquée : un contrôle de remise en service APTE est exigé après l''immobilisation.');
  end if;
  if exists (select 1 from public.moto_actions_correctives where moto_id = im.moto_id and gravite = 'CRITIQUE' and statut in ('OUVERTE','PLANIFIEE','REALISEE')) then
    perform private.moto_erreur('Levée bloquée : une anomalie critique n''est pas encore corrigée et vérifiée.');
  end if;
  select * into v_ctrl from public.moto_controles where moto_id = im.moto_id and type_controle = 'REMISE_EN_SERVICE' and resultat = 'APTE'
     and date_controle >= im.debut order by date_controle desc limit 1;
  if v_ctrl.realise_par = auth.uid() then
    perform private.moto_refus('Séparation des tâches : l''auteur du contrôle de remise en service ne lève pas lui-même l''immobilisation.');
  end if;
  update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = btrim(p_motif) where id = im.id;
  perform private.moto_recalculer_statuts(im.moto_id);
  return jsonb_build_object('id', im.id, 'levee', true);
end $$;

-- ---------------------------------------------------------------------
-- 9. Enregistrement : moto neuve, acquisition prévue, moto en exploitation
-- ---------------------------------------------------------------------
create or replace function public.moto_creer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_cluster text; v_zone text; m public.moto_motos; v_sit text := upper(coalesce(nullif(p ->> 'situation_parc', ''), 'RECEPTIONNEE'));
        v_orig text := upper(coalesce(nullif(p ->> 'origine', ''), 'NEUVE')); v_prevu uuid := private.moto_uuid(p, 'beneficiaire_prevu_id');
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  if v_sit not in ('PREVUE','RECEPTIONNEE') then perform private.moto_erreur('Situation : PREVUE ou RECEPTIONNEE.'); end if;
  if v_orig not in ('NEUVE','EN_EXPLOITATION') then perform private.moto_erreur('Origine : NEUVE ou EN_EXPLOITATION.'); end if;
  if v_orig = 'EN_EXPLOITATION' then v_sit := 'RECEPTIONNEE'; end if;
  if v_orig = 'NEUVE' and v_sit = 'RECEPTIONNEE' and (nullif(btrim(p ->> 'marque'), '') is null or nullif(btrim(p ->> 'modele'), '') is null) then
    perform private.moto_erreur('Marque et modèle obligatoires pour une moto neuve réceptionnée.');
  end if;
  if v_orig = 'NEUVE' and v_sit = 'RECEPTIONNEE' and nullif(p ->> 'date_reception', '') is null then
    perform private.moto_erreur('Date de réception effective obligatoire (sinon : acquisition prévue).');
  end if;
  if v_sit = 'PREVUE' and (nullif(p ->> 'date_reception', '') is not null or private.moto_num(p, 'compteur_km') is not null) then
    perform private.moto_erreur('Une acquisition prévue n''a ni date de réception ni compteur.');
  end if;
  if nullif(p ->> 'date_reception', '') is not null and (p ->> 'date_reception')::date > current_date then
    perform private.moto_erreur('Date de réception dans le futur.');
  end if;
  if (nullif(p ->> 'date_debut_utilisation', '') is not null and (p ->> 'date_debut_utilisation')::date > current_date)
     or (nullif(p ->> 'date_acquisition', '') is not null and (p ->> 'date_acquisition')::date > current_date) then
    perform private.moto_erreur('Date historique dans le futur.');
  end if;
  if v_prevu is not null and not private.moto_beneficiaire_valide(v_prevu) then
    perform private.moto_erreur('Utilisateur prévu invalide.');
  end if;
  v_cluster := public.aflp_cluster_code(p ->> 'cluster_code');
  if nullif(p ->> 'cluster_code', '') is not null and v_cluster is null then
    perform private.moto_erreur('Cluster inconnu du référentiel AFLP.');
  end if;
  select zone_code into v_zone from public.aflp_clusters where code = v_cluster;
  if v_zone is null and nullif(p ->> 'zone_code', '') is not null then
    select code into v_zone from public.aflp_zones where code = upper(p ->> 'zone_code');
    if v_zone is null then perform private.moto_erreur('Zone inconnue du référentiel AFLP.'); end if;
  end if;
  perform private.moto_motif(coalesce(p ->> 'motif', case v_orig when 'EN_EXPLOITATION' then 'Intégration d''une moto déjà en exploitation'
                                                    else case v_sit when 'PREVUE' then 'Acquisition prévue' else 'Création au passeport numérique' end end));
  insert into public.moto_motos (marque, modele, annee, couleur, numero_chassis, numero_moteur, immatriculation,
                                 fournisseur, date_reception, cluster_code, zone_code, observations, situation_parc, origine,
                                 date_acquisition, date_debut_utilisation, historique_note, compteur_reception_km,
                                 beneficiaire_prevu_id, beneficiaire_prevu_libelle)
  values (nullif(btrim(p ->> 'marque'), ''), nullif(btrim(p ->> 'modele'), ''), private.moto_num(p, 'annee')::integer,
          nullif(btrim(p ->> 'couleur'), ''), nullif(upper(btrim(p ->> 'numero_chassis')), ''),
          nullif(upper(btrim(p ->> 'numero_moteur')), ''), nullif(upper(btrim(p ->> 'immatriculation')), ''),
          nullif(btrim(p ->> 'fournisseur'), ''), nullif(p ->> 'date_reception', '')::date, v_cluster, v_zone,
          nullif(btrim(p ->> 'observations'), ''), v_sit, v_orig,
          nullif(p ->> 'date_acquisition', '')::date, nullif(p ->> 'date_debut_utilisation', '')::date,
          nullif(btrim(p ->> 'historique_note'), ''), case when v_orig = 'NEUVE' then private.moto_num(p, 'compteur_km') end,
          v_prevu, nullif(btrim(p ->> 'beneficiaire_prevu_libelle'), ''))
  returning * into m;
  if private.moto_num(p, 'compteur_km') is not null then
    perform private.moto_enregistrer_km(m.id, private.moto_num(p, 'compteur_km'), now(), 'RELEVE');
  end if;
  perform private.moto_recalculer_statuts(m.id);
  return jsonb_build_object('id', m.id, 'code', m.code, 'qr_token', m.qr_token, 'situation_parc', v_sit, 'origine', v_orig);
end $$;

create or replace function public.moto_receptionner(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); m public.moto_motos;
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  m := private.moto_charger(v_moto, true);
  if m.situation_parc <> 'PREVUE' then perform private.moto_erreur('Cette moto est déjà réceptionnée.'); end if;
  if nullif(p ->> 'date_reception', '') is null or (p ->> 'date_reception')::date > current_date then
    perform private.moto_erreur('Date de réception effective obligatoire (pas dans le futur).');
  end if;
  if coalesce(nullif(btrim(p ->> 'marque'), ''), m.marque) is null or coalesce(nullif(btrim(p ->> 'modele'), ''), m.modele) is null then
    perform private.moto_erreur('Marque et modèle obligatoires à la réception.');
  end if;
  if private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('Kilométrage à la réception obligatoire.'); end if;
  perform private.moto_motif(coalesce(nullif(p ->> 'motif', ''), 'Réception physique'));
  update public.moto_motos set situation_parc = 'RECEPTIONNEE', date_reception = (p ->> 'date_reception')::date,
         marque = coalesce(nullif(btrim(p ->> 'marque'), ''), marque), modele = coalesce(nullif(btrim(p ->> 'modele'), ''), modele),
         couleur = coalesce(nullif(btrim(p ->> 'couleur'), ''), couleur), fournisseur = coalesce(nullif(btrim(p ->> 'fournisseur'), ''), fournisseur),
         numero_chassis = coalesce(nullif(upper(btrim(p ->> 'numero_chassis')), ''), numero_chassis),
         numero_moteur = coalesce(nullif(upper(btrim(p ->> 'numero_moteur')), ''), numero_moteur),
         immatriculation = coalesce(nullif(upper(btrim(p ->> 'immatriculation')), ''), immatriculation),
         compteur_reception_km = private.moto_num(p, 'compteur_km'), updated_at = now()
  where id = v_moto;
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'RELEVE');
  perform private.moto_recalculer_statuts(v_moto);
  return jsonb_build_object('id', v_moto, 'situation_parc', 'RECEPTIONNEE');
end $$;

-- ---------------------------------------------------------------------
-- 10. Bénéficiaires, préaffectation, état contradictoire, remise, transfert
-- ---------------------------------------------------------------------
create or replace function private.moto_beneficiaire_valide(p_user uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$ select coalesce(private.moto_classe_de(p_user) in ('UNITE','ZONE','ABM','LOGISTIQUE'), false) $$;

drop function if exists public.moto_beneficiaires();
create or replace function public.moto_beneficiaires()
returns table (user_id uuid, nom text, role text, cluster_code text, classe text)
language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  return query select p.user_id, coalesce(p.nom, p.email), p.role, public.aflp_cluster_code(p.cluster), private.moto_classe_de(p.user_id)
    from public.profils p where p.actif and private.moto_beneficiaire_valide(p.user_id) order by p.role, p.nom;
end $$;

create or replace function public.moto_preaffecter(p_moto uuid, p_beneficiaire uuid, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare b public.profils; v_cluster text; v_zone text; v_id uuid; m public.moto_motos;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 5);
  m := private.moto_charger(p_moto, true);
  if m.situation_parc = 'PREVUE' then perform private.moto_erreur('Acquisition prévue : aucune affectation avant la réception physique.'); end if;
  select * into b from public.profils where user_id = p_beneficiaire and actif;
  if not found then perform private.moto_erreur('Bénéficiaire introuvable ou compte inactif.'); end if;
  if not private.moto_beneficiaire_valide(p_beneficiaire) then
    perform private.moto_erreur('Le bénéficiaire doit être un Chef d''unité, un Chef de zone, l''Assistant Branch Manager ou le coordinateur logistique.');
  end if;
  v_cluster := public.aflp_cluster_code(b.cluster);
  if private.moto_classe_de(p_beneficiaire) = 'UNITE' and v_cluster is null then
    perform private.moto_erreur('Le cluster du Chef d''unité n''est pas renseigné dans son profil FBMS.');
  end if;
  if exists (select 1 from public.moto_affectations where moto_id = p_moto and statut = 'ACTIVE') then
    perform private.moto_erreur('Cette moto a déjà une affectation active : utilisez le transfert.');
  end if;
  v_zone := coalesce((select zone_code from public.aflp_clusters where code = v_cluster), m.zone_code);
  insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, motif)
  values (p_moto, p_beneficiaire, coalesce(v_cluster, m.cluster_code), 'PREAFFECTATION', btrim(p_motif)) returning id into v_id;
  update public.moto_motos set statut_affectation = 'PREAFFECTEE', cluster_code = coalesce(v_cluster, cluster_code), zone_code = v_zone, updated_at = now()
  where id = p_moto;
  return jsonb_build_object('id', v_id, 'statut_affectation', 'PREAFFECTEE');
end $$;

-- État contradictoire avant remise (distinct de l'inspection mécanique).
create or replace function public.moto_etat_remise_enregistrer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_benef uuid := private.moto_uuid(p, 'beneficiaire_id');
        m public.moto_motos; v_chk jsonb; v_id uuid; v_req text[];
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  m := private.moto_charger(v_moto, true);
  if m.situation_parc = 'PREVUE' then perform private.moto_erreur('Moto non réceptionnée.'); end if;
  if v_benef is null then
    select beneficiaire_id into v_benef from public.moto_affectations where moto_id = v_moto and statut = 'ACTIVE' and type_affectation = 'PREAFFECTATION';
  end if;
  if v_benef is null then perform private.moto_erreur('Bénéficiaire inconnu : préaffectez la moto ou indiquez le nouveau bénéficiaire.'); end if;
  if not private.moto_beneficiaire_valide(v_benef) then perform private.moto_erreur('Bénéficiaire invalide.'); end if;
  if v_benef = auth.uid() then perform private.moto_refus('État contradictoire : le bénéficiaire ne l''enregistre pas lui-même.'); end if;
  if private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('Relevé du compteur obligatoire.'); end if;
  if nullif(p ->> 'date_remise_prevue', '') is null then perform private.moto_erreur('Date réelle de remise prévue obligatoire.'); end if;
  v_chk := private.moto_items_controles('ETAT_REMISE', p -> 'items');
  select array(select jsonb_array_elements_text(valeur_json)) into v_req from public.moto_parametres where cle = 'photos_etat_remise_categories';
  perform private.moto_motif('État contradictoire avant remise');
  insert into public.moto_controles (moto_id, type_controle, compteur_km, items, anomalie_critique, resultat, observations,
         beneficiaire_id, confirmation_statut, equipements, documents_presents, date_remise_prevue)
  values (v_moto, 'ETAT_REMISE', private.moto_num(p, 'compteur_km'), v_chk -> 'items', (v_chk ->> 'critique')::boolean,
          case when (v_chk ->> 'critique')::boolean then 'INAPTE' else 'APTE' end, nullif(btrim(p ->> 'observations'), ''),
          v_benef, 'EN_ATTENTE', coalesce(p -> 'equipements', '{}'::jsonb), coalesce(p -> 'documents_presents', '[]'::jsonb),
          (p ->> 'date_remise_prevue')::date)
  returning id into v_id;
  perform private.moto_photos_enregistrer(v_moto, v_id, p -> 'photos', coalesce(array_length(v_req, 1), 0), v_req);
  perform private.moto_actions_depuis_items(v_moto, v_id, v_chk -> 'items');
  if (v_chk ->> 'critique')::boolean then
    perform private.moto_immobiliser_si_critique(v_moto, 'Anomalie critique à l''état avant remise', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'confirmation_statut', 'EN_ATTENTE', 'anomalie_critique', (v_chk ->> 'critique')::boolean);
end $$;

create or replace function public.moto_etat_remise_confirmer(p_controle uuid, p_decision text, p_commentaire text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
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
end $$;

create or replace function public.moto_mes_etats_a_confirmer()
returns setof public.moto_controles language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select * from public.moto_controles where type_controle = 'ETAT_REMISE' and confirmation_statut = 'EN_ATTENTE' and beneficiaire_id = auth.uid() order by date_controle desc $$;

create or replace function private.moto_etat_remise_valide(p_moto uuid, p_benef uuid)
returns uuid language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select c.id from (
    select * from public.moto_controles where moto_id = p_moto and type_controle = 'ETAT_REMISE' and beneficiaire_id = p_benef
    order by date_controle desc limit 1) c
  where c.confirmation_statut in ('ACCEPTEE','ACCEPTEE_AVEC_RESERVES') and not c.anomalie_critique
    and c.date_controle >= now() - make_interval(days => coalesce(private.moto_param('etat_remise_validite_jours'), 7)::integer)
$$;

create or replace function public.moto_remettre(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); m public.moto_motos; a public.moto_affectations; v_id uuid; v_etat uuid;
begin
  -- Le coordinateur logistique peut réaliser la remise physique (tenue des affectations) ;
  -- l'autorisation de circuler reste au Branch Manager (moto_mettre_en_service).
  perform private.moto_exiger_classe(array['ABM','BM','LOGISTIQUE']);
  perform private.moto_recalculer_statuts(v_moto);
  m := private.moto_charger(v_moto, true);
  select * into a from public.moto_affectations where moto_id = v_moto and statut = 'ACTIVE' and type_affectation = 'PREAFFECTATION';
  if not found then perform private.moto_erreur('Aucune préaffectation active : le Branch Manager doit d''abord préaffecter la moto.'); end if;
  if a.beneficiaire_id = auth.uid() then perform private.moto_refus('Séparation des tâches : le bénéficiaire n''enregistre pas sa propre remise.'); end if;
  if m.statut_administratif <> 'CONFORME' then perform private.moto_erreur('Remise bloquée : documents administratifs non conformes ('||m.statut_administratif||').'); end if;
  if m.statut_technique <> 'APTE' then perform private.moto_erreur('Remise bloquée : état technique '||m.statut_technique||'.'); end if;
  perform private.moto_controle_remise(v_moto, p);
  v_etat := private.moto_etat_remise_valide(v_moto, a.beneficiaire_id);
  if v_etat is null then
    perform private.moto_erreur('Remise bloquée : état contradictoire avant remise absent, non accepté par le bénéficiaire, contesté ou trop ancien.');
  end if;
  perform private.moto_motif(coalesce(p ->> 'motif', 'Remise officielle au bureau de Bouaké'));
  update public.moto_affectations set statut = 'CLOTUREE', date_fin = current_date, cloture_par = auth.uid(), cloture_at = now() where id = a.id;
  insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, compteur_km, pv_document_id,
         permis_verifie, permis_categorie, permis_verifie_par_nom, permis_verifie_at, equipements, motif, etat_remise_id)
  values (v_moto, a.beneficiaire_id, a.cluster_code, 'REMISE', private.moto_num(p, 'compteur_km'), private.moto_uuid(p, 'pv_document_id'),
          true, btrim(p ->> 'permis_categorie'), btrim(p ->> 'permis_verifie_par_nom'),
          coalesce(nullif(p ->> 'permis_verifie_at', '')::date, current_date), p -> 'equipements', nullif(btrim(p ->> 'motif'), ''), v_etat)
  returning id into v_id;
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'REMISE');
  update public.moto_documents set affectation_id = v_id where id = private.moto_uuid(p, 'pv_document_id');
  update public.moto_motos set statut_affectation = 'REMISE', updated_at = now() where id = v_moto;
  return jsonb_build_object('id', v_id, 'statut_affectation', 'REMISE', 'etat_remise_id', v_etat,
    'note', 'Remise enregistrée. L''autorisation de circulation (mise en service) reste une décision distincte du Branch Manager.');
end $$;

create or replace function public.moto_transferer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_moto uuid := private.moto_uuid(p, 'moto_id'); v_benef uuid := private.moto_uuid(p, 'beneficiaire_id');
        b public.profils; v_cluster text; a public.moto_affectations; v_id uuid; v_etat uuid; m public.moto_motos;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p ->> 'motif', 5);
  m := private.moto_charger(v_moto, true);
  select * into a from public.moto_affectations where moto_id = v_moto and statut = 'ACTIVE' and type_affectation in ('REMISE','TRANSFERT');
  if not found then perform private.moto_erreur('Transfert impossible : la moto n''a pas été remise.'); end if;
  select * into b from public.profils where user_id = v_benef and actif;
  if not found or not private.moto_beneficiaire_valide(v_benef) then perform private.moto_erreur('Nouveau bénéficiaire invalide.'); end if;
  if v_benef = a.beneficiaire_id then perform private.moto_erreur('Le nouveau bénéficiaire est déjà affectataire.'); end if;
  v_cluster := public.aflp_cluster_code(b.cluster);
  if private.moto_classe_de(v_benef) = 'UNITE' and v_cluster is null then perform private.moto_erreur('Cluster du nouveau bénéficiaire non renseigné.'); end if;
  perform private.moto_controle_remise(v_moto, p);
  v_etat := private.moto_etat_remise_valide(v_moto, v_benef);
  if v_etat is null then perform private.moto_erreur('Transfert bloqué : état contradictoire avec le nouveau bénéficiaire absent, non accepté ou trop ancien.'); end if;
  update public.moto_affectations set statut = 'CLOTUREE', date_fin = current_date, cloture_par = auth.uid(), cloture_at = now() where id = a.id;
  insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, compteur_km, pv_document_id,
         permis_verifie, permis_categorie, permis_verifie_par_nom, permis_verifie_at, equipements, motif, etat_remise_id)
  values (v_moto, v_benef, coalesce(v_cluster, m.cluster_code), 'TRANSFERT', private.moto_num(p, 'compteur_km'), private.moto_uuid(p, 'pv_document_id'),
          true, btrim(p ->> 'permis_categorie'), btrim(p ->> 'permis_verifie_par_nom'),
          coalesce(nullif(p ->> 'permis_verifie_at', '')::date, current_date), p -> 'equipements', btrim(p ->> 'motif'), v_etat)
  returning id into v_id;
  perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), now(), 'REMISE');
  update public.moto_motos set statut_affectation = 'TRANSFEREE', cluster_code = coalesce(v_cluster, cluster_code),
         zone_code = coalesce((select zone_code from public.aflp_clusters where code = v_cluster), zone_code), updated_at = now()
  where id = v_moto;
  return jsonb_build_object('id', v_id, 'statut_affectation', 'TRANSFEREE');
end $$;

-- ---------------------------------------------------------------------
-- 11. Inspections mensuelles : Chef de zone (1-15), coordinateur (20-fin),
--     contrôle indépendant de la moto du coordinateur.
-- ---------------------------------------------------------------------
create or replace function private.moto_fenetre(p_niveau text, p_periode date, out debut date, out fin date)
language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select case when p_niveau = 'ZONE' then p_periode
              else p_periode + (coalesce(private.moto_param('inspection_coordination_jour_debut'), 20)::integer - 1) end,
         case when p_niveau = 'ZONE' then p_periode + (coalesce(private.moto_param('inspection_zone_jour_fin'), 15)::integer - 1)
              else (p_periode + interval '1 month' - interval '1 day')::date end
$$;

create or replace function private.moto_est_inspecteur_independant()
returns boolean language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select coalesce(private.moto_classe() in ('BM','ABM'), false)
      or exists (select 1 from public.moto_parametres p, jsonb_array_elements_text(coalesce(p.valeur_json, '[]'::jsonb)) x
                 where p.cle = 'inspecteurs_independants' and x = auth.uid()::text)
$$;

create or replace function public.moto_inspection_mensuelle(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id');
        v_classe text; v_niveau text; m public.moto_motos; v_benef uuid; v_classe_benef text;
        v_at timestamptz := coalesce(nullif(p ->> 'date_controle', '')::timestamptz, now());
        v_periode date; v_fin date; v_ne boolean := coalesce((p ->> 'non_evaluable')::boolean, false);
        v_chk jsonb; v_crit boolean := false; v_def integer := 0; v_ouv integer; v_conf text; v_id uuid; v_inc boolean := false;
        v_remp public.moto_controles; v_out jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  v_classe := private.moto_exiger_classe(array['ZONE','LOGISTIQUE','BM','ABM']);
  m := private.moto_charger(v_moto, true);
  v_benef := private.moto_affectataire(v_moto);
  if m.situation_parc <> 'RECEPTIONNEE' or m.mise_en_service_at is null or v_benef is null then
    perform private.moto_erreur('Moto non active (non mise en service ou non affectée) : inspection mensuelle non exigible.');
  end if;
  if v_at > now() + interval '15 minutes' then perform private.moto_erreur('Date d''inspection dans le futur.'); end if;
  if v_at < m.mise_en_service_at then perform private.moto_erreur('Inspection antérieure à la mise en service : aucune inspection rétroactive.'); end if;
  if v_at < now() - interval '3 days' then perform private.moto_erreur('Saisie différée limitée à 3 jours : au-delà, utilisez une correction motivée.'); end if;
  if v_benef = auth.uid() then perform private.moto_refus('Indépendance : vous ne pouvez pas réaliser l''inspection mensuelle de votre propre moto.'); end if;
  v_classe_benef := private.moto_classe_de(v_benef);
  v_niveau := upper(coalesce(nullif(p ->> 'niveau', ''), case v_classe when 'ZONE' then 'ZONE' when 'LOGISTIQUE' then 'COORDINATION' else 'INDEPENDANTE' end));
  if v_niveau = 'ZONE' then
    if v_classe <> 'ZONE' then perform private.moto_refus('Le niveau ZONE est réservé au Chef de zone.'); end if;
    if private.moto_ma_zone() is null then perform private.moto_refus('Zone de responsabilité non renseignée sur votre profil FBMS : demandez au Branch Manager de la compléter.'); end if;
    if m.zone_code is distinct from private.moto_ma_zone() then perform private.moto_refus('Moto hors de votre zone de responsabilité.'); end if;
    if v_classe_benef is distinct from 'UNITE' then perform private.moto_refus('Le Chef de zone inspecte les motos des Chefs d''unité de sa zone.'); end if;
  elsif v_niveau = 'COORDINATION' then
    if v_classe <> 'LOGISTIQUE' then perform private.moto_refus('Le niveau COORDINATION est réservé au coordinateur logistique.'); end if;
    if v_classe_benef = 'LOGISTIQUE' then perform private.moto_refus('La moto du coordinateur relève d''un contrôle indépendant.'); end if;
  elsif v_niveau = 'INDEPENDANTE' then
    if not private.moto_est_inspecteur_independant() then perform private.moto_refus('Contrôle indépendant réservé au BM, à l''ABM ou à un inspecteur désigné par ANAGROCI.'); end if;
    if v_classe_benef is distinct from 'LOGISTIQUE' then perform private.moto_erreur('Le contrôle indépendant concerne la moto du coordinateur logistique.'); end if;
  else
    perform private.moto_erreur('Niveau d''inspection inconnu.');
  end if;
  v_periode := date_trunc('month', v_at)::date;
  select f.fin into v_fin from private.moto_fenetre(v_niveau, v_periode) f;
  -- Correction motivée d'une inspection existante (piste d'audit conservée).
  if private.moto_uuid(p, 'remplace_id') is not null then
    select * into v_remp from public.moto_controles where id = private.moto_uuid(p, 'remplace_id') and moto_id = v_moto
       and type_controle = 'INSPECTION_MENSUELLE' and remplace_par is null for update;
    if not found then perform private.moto_erreur('Inspection à corriger introuvable ou déjà corrigée.'); end if;
    if v_remp.realise_par <> auth.uid() and v_classe <> 'BM' then perform private.moto_refus('Seul l''auteur ou le Branch Manager corrige une inspection.'); end if;
    if v_remp.niveau <> v_niveau or v_remp.periode <> v_periode then perform private.moto_erreur('La correction doit porter sur le même mois et le même niveau.'); end if;
    perform private.moto_motif(p ->> 'motif_correction', 10);
    update public.moto_controles set remplace_par = gen_random_uuid() where id = v_remp.id; -- marqueur provisoire, remplacé ci-dessous
  elsif exists (select 1 from public.moto_controles where moto_id = v_moto and type_controle = 'INSPECTION_MENSUELLE'
                and niveau = v_niveau and periode = v_periode and remplace_par is null) then
    perform private.moto_erreur('Inspection déjà enregistrée pour ce mois et ce niveau : utilisez la correction motivée.');
  else
    perform private.moto_motif('Inspection mensuelle '||lower(v_niveau));
  end if;
  v_ouv := private.moto_actions_ouvertes(v_moto);
  if v_ne then
    if m.statut_technique not in ('IMMOBILISEE','EN_REPARATION') then
      perform private.moto_erreur('« Non évaluable » n''est possible que pour une moto immobilisée ou en réparation.');
    end if;
    if length(btrim(coalesce(p ->> 'observations', ''))) < 10 then perform private.moto_erreur('Observations obligatoires (10 caractères) pour une inspection non évaluable.'); end if;
    v_conf := 'NON_EVALUABLE';
  else
    if private.moto_num(p, 'compteur_km') is null then perform private.moto_erreur('Relevé du compteur obligatoire.'); end if;
    v_chk := private.moto_items_controles('INSPECTION_MENSUELLE', p -> 'items');
    v_crit := (v_chk ->> 'critique')::boolean; v_def := (v_chk ->> 'defauts')::integer;
    -- Le résultat est calculé : une visite effectuée ne vaut pas conformité.
    v_conf := case when v_crit then 'NON_CONFORME' when v_def > 0 or v_ouv > 0 then 'RESERVES' else 'CONFORME' end;
  end if;
  insert into public.moto_controles (moto_id, type_controle, date_controle, compteur_km, items, anomalie_critique, resultat,
         niveau, periode, conformite, observations, besoins_entretien, actions_ouvertes_avant, client_op_id, remplace_id, motif_correction,
         inspecteur_externe, intervenant_nom)
  values (v_moto, 'INSPECTION_MENSUELLE', v_at, private.moto_num(p, 'compteur_km'), coalesce(v_chk -> 'items', '[]'::jsonb), v_crit,
          case when v_conf in ('CONFORME','RESERVES') then 'APTE' else 'INAPTE' end,
          v_niveau, v_periode, v_conf, nullif(btrim(p ->> 'observations'), ''), nullif(btrim(p ->> 'besoins_entretien'), ''), v_ouv, v_client,
          v_remp.id, nullif(btrim(p ->> 'motif_correction'), ''), nullif(btrim(p ->> 'inspecteur_externe'), ''), nullif(btrim(p ->> 'intervenant_nom'), ''))
  returning id into v_id;
  if v_remp.id is not null then update public.moto_controles set remplace_par = v_id where id = v_remp.id; end if;
  perform private.moto_photos_enregistrer(v_moto, v_id, p -> 'photos',
            case when v_ne then 1 else coalesce(private.moto_param('photos_inspection_min'), 2)::integer end,
            case when v_ne then '{}'::text[] else array['COMPTEUR'] end);
  if not v_ne then
    begin
      perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'), v_at, 'CONTROLE');
    exception when sqlstate 'P0001' then
      v_inc := true; update public.moto_controles set compteur_incoherent = true where id = v_id;
    end;
    perform private.moto_actions_depuis_items(v_moto, v_id, v_chk -> 'items');
    if v_crit then
      perform private.moto_immobiliser_si_critique(v_moto, 'Anomalie critique à l''inspection mensuelle : '||
        coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v_chk -> 'critiques') x), ''), v_id);
    end if;
  end if;
  v_out := jsonb_build_object('id', v_id, 'niveau', v_niveau, 'periode', v_periode, 'conformite', v_conf,
             'dans_delai', v_at::date <= v_fin, 'anomalie_critique', v_crit, 'compteur_incoherent', v_inc,
             'actions_ouvertes_avant', v_ouv);
  perform private.moto_op_enregistrer(v_client, 'INSPECTION_MENSUELLE', 'SYNCHRONISE', v_out);
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 12. Enveloppes du coordinateur : supervision et entretien
--     Aucun transfert d'argent : on demande, approuve, déclare, justifie.
-- ---------------------------------------------------------------------
create table if not exists public.moto_enveloppes (
  id uuid primary key default gen_random_uuid(),
  type_enveloppe text not null check (type_enveloppe in ('SUPERVISION','ENTRETIEN')),
  periode date not null check (periode = date_trunc('month', periode)::date),
  titulaire_id uuid not null references public.profils(user_id),
  montant_demande numeric(14,0) not null check (montant_demande > 0),
  justification text not null check (length(btrim(justification)) >= 10),
  statut text not null default 'DEMANDEE' check (statut in ('DEMANDEE','APPROUVEE','REFUSEE','CLOTUREE')),
  montant_approuve numeric(14,0) check (montant_approuve is null or (montant_approuve > 0 and montant_approuve <= montant_demande)),
  demande_par uuid not null default auth.uid(),
  demande_at timestamptz not null default now(),
  decide_par uuid,
  decide_at timestamptz,
  motif_decision text,
  check (decide_par is null or (decide_par <> demande_par and decide_par <> titulaire_id)),
  check (statut <> 'APPROUVEE' or montant_approuve is not null)
);
create unique index if not exists moto_enveloppes_unique on public.moto_enveloppes (type_enveloppe, periode, titulaire_id) where statut <> 'REFUSEE';

create table if not exists public.moto_depenses (
  id uuid primary key default gen_random_uuid(),
  enveloppe_id uuid not null references public.moto_enveloppes(id),
  date_depense date not null,
  montant numeric(14,0) not null check (montant > 0),
  objet text not null check (length(btrim(objet)) >= 5),
  moto_id uuid references public.moto_motos(id),
  action_id uuid references public.moto_actions_correctives(id),
  justificatif_path text,
  statut text not null default 'DECLAREE' check (statut in ('DECLAREE','JUSTIFIEE','VALIDEE','REJETEE')),
  declare_par uuid not null default auth.uid(),
  declare_at timestamptz not null default now(),
  verifie_par uuid,
  verifie_at timestamptz,
  motif_verification text,
  client_op_id uuid unique,
  check (verifie_par is null or verifie_par <> declare_par),
  check (statut not in ('JUSTIFIEE','VALIDEE') or justificatif_path is not null)
);

create unique index if not exists moto_depenses_justificatif_unique on public.moto_depenses (justificatif_path) where justificatif_path is not null;

create or replace function private.moto_lecture_enveloppe(p_titulaire uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$ select private.moto_classe() in ('BM','ABM','FINANCE','DIRECTION') or (private.moto_classe() is not null and p_titulaire = auth.uid()) $$;

create or replace function private.moto_justificatif_depense_valide(p_path text)
returns void language plpgsql stable security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if (storage.foldername(p_path))[1] is distinct from 'depenses' or (storage.foldername(p_path))[2] is distinct from auth.uid()::text then
    perform private.moto_erreur('Chemin de justificatif non conforme (depenses/<votre compte>/…).');
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'moto-documents' and name = p_path) then
    perform private.moto_erreur('Justificatif introuvable dans le stockage privé : déposez-le avant d''enregistrer.');
  end if;
end $$;

create or replace function public.moto_enveloppe_demander(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text; v_tit uuid := coalesce(private.moto_uuid(p, 'titulaire_id'), auth.uid()); v_id uuid; v_type text := upper(coalesce(p ->> 'type_enveloppe', ''));
begin
  v_classe := private.moto_exiger_classe(array['LOGISTIQUE','BM','ABM']);
  if v_classe = 'LOGISTIQUE' and v_tit <> auth.uid() then perform private.moto_refus('Le coordinateur demande pour sa propre enveloppe.'); end if;
  if private.moto_classe_de(v_tit) is distinct from 'LOGISTIQUE' then perform private.moto_erreur('Le titulaire doit être le coordinateur logistique.'); end if;
  if v_type not in ('SUPERVISION','ENTRETIEN') then perform private.moto_erreur('Enveloppe : SUPERVISION ou ENTRETIEN.'); end if;
  if nullif(p ->> 'periode', '') is null then perform private.moto_erreur('Mois concerné obligatoire.'); end if;
  if private.moto_num(p, 'montant_demande') is null or private.moto_num(p, 'montant_demande') <= 0 then perform private.moto_erreur('Montant demandé obligatoire et positif.'); end if;
  perform private.moto_motif('Demande d''enveloppe '||lower(v_type));
  insert into public.moto_enveloppes (type_enveloppe, periode, titulaire_id, montant_demande, justification)
  values (v_type, date_trunc('month', (p ->> 'periode')::date)::date, v_tit, private.moto_num(p, 'montant_demande'), btrim(coalesce(p ->> 'justification', '')))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'statut', 'DEMANDEE');
exception when unique_violation then
  perform private.moto_erreur('Une enveloppe de ce type existe déjà pour ce mois.'); return null;
end $$;

-- Délégation existante : le Branch Manager approuve (comme moto_budget_decider).
create or replace function public.moto_enveloppe_decider(p_enveloppe uuid, p_decision text, p_montant numeric, p_motif text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare e public.moto_enveloppes; v_dec text := upper(coalesce(p_decision, ''));
begin
  perform private.moto_exiger_classe(array['BM']);
  select * into e from public.moto_enveloppes where id = p_enveloppe for update;
  if not found or e.statut <> 'DEMANDEE' then perform private.moto_erreur('Enveloppe introuvable ou déjà décidée.'); end if;
  if e.demande_par = auth.uid() or e.titulaire_id = auth.uid() then perform private.moto_refus('Auto-approbation interdite.'); end if;
  if v_dec not in ('APPROUVEE','REFUSEE') then perform private.moto_erreur('Décision : APPROUVEE ou REFUSEE.'); end if;
  perform private.moto_motif(p_motif, case when v_dec = 'REFUSEE' or coalesce(p_montant, e.montant_demande) < e.montant_demande then 5 else 0 end);
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_enveloppes set statut = v_dec, montant_approuve = case when v_dec = 'APPROUVEE' then coalesce(p_montant, e.montant_demande) end,
         decide_par = auth.uid(), decide_at = now(), motif_decision = nullif(btrim(p_motif), '')
  where id = e.id;
  return jsonb_build_object('id', e.id, 'statut', v_dec);
end $$;

create or replace function public.moto_depense_declarer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; e public.moto_enveloppes; v_m numeric := private.moto_num(p, 'montant');
        v_conso numeric; v_id uuid; v_res jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_action uuid := private.moto_uuid(p, 'action_id');
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_classe(array['LOGISTIQUE','BM','ABM']);
  select * into e from public.moto_enveloppes where id = private.moto_uuid(p, 'enveloppe_id') for update;
  if not found or e.statut <> 'APPROUVEE' then perform private.moto_erreur('Enveloppe introuvable ou non approuvée.'); end if;
  if e.titulaire_id <> auth.uid() then perform private.moto_refus('Seul le titulaire déclare les dépenses de son enveloppe.'); end if;
  if v_m is null or v_m <= 0 then perform private.moto_erreur('Montant obligatoire et positif.'); end if;
  if nullif(p ->> 'date_depense', '') is null or (p ->> 'date_depense')::date > current_date
     or date_trunc('month', (p ->> 'date_depense')::date)::date <> e.periode then
    perform private.moto_erreur('Date de dépense obligatoire, dans le mois de l''enveloppe, pas dans le futur.');
  end if;
  if v_moto is not null and not exists (select 1 from public.moto_motos where id = v_moto) then perform private.moto_erreur('Moto inconnue.'); end if;
  if v_action is not null and not exists (select 1 from public.moto_actions_correctives where id = v_action) then perform private.moto_erreur('Action corrective inconnue.'); end if;
  select coalesce(sum(montant), 0) into v_conso from public.moto_depenses where enveloppe_id = e.id and statut <> 'REJETEE';
  if v_conso + v_m > e.montant_approuve then
    perform private.moto_erreur(format('Dépassement de l''enveloppe : solde disponible %s FCFA.', e.montant_approuve - v_conso));
  end if;
  if nullif(p ->> 'justificatif_path', '') is not null then perform private.moto_justificatif_depense_valide(p ->> 'justificatif_path'); end if;
  perform private.moto_motif('Déclaration de dépense');
  insert into public.moto_depenses (enveloppe_id, date_depense, montant, objet, moto_id, action_id, justificatif_path, statut, client_op_id)
  values (e.id, (p ->> 'date_depense')::date, v_m, btrim(coalesce(p ->> 'objet', '')), v_moto, v_action, nullif(p ->> 'justificatif_path', ''),
          case when nullif(p ->> 'justificatif_path', '') is null then 'DECLAREE' else 'JUSTIFIEE' end, v_client)
  returning id into v_id;
  v_res := jsonb_build_object('id', v_id, 'statut', case when nullif(p ->> 'justificatif_path', '') is null then 'DECLAREE' else 'JUSTIFIEE' end);
  perform private.moto_op_enregistrer(v_client, 'DEPENSE', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_depense_justifier(p_depense uuid, p_path text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare d public.moto_depenses;
begin
  perform private.moto_exiger_classe(array['LOGISTIQUE','BM','ABM']);
  select * into d from public.moto_depenses where id = p_depense for update;
  if not found or d.statut not in ('DECLAREE') then perform private.moto_erreur('Dépense introuvable ou déjà justifiée.'); end if;
  if d.declare_par <> auth.uid() then perform private.moto_refus('Seul le déclarant ajoute le justificatif.'); end if;
  perform private.moto_justificatif_depense_valide(p_path);
  perform private.moto_motif('Ajout de justificatif');
  update public.moto_depenses set justificatif_path = p_path, statut = 'JUSTIFIEE' where id = d.id;
  return jsonb_build_object('id', d.id, 'statut', 'JUSTIFIEE');
end $$;

create or replace function public.moto_depense_verifier(p_depense uuid, p_decision text, p_motif text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare d public.moto_depenses; v_dec text := upper(coalesce(p_decision, ''));
begin
  perform private.moto_exiger_classe(array['BM','ABM','FINANCE']);
  select * into d from public.moto_depenses where id = p_depense for update;
  if not found or d.statut <> 'JUSTIFIEE' then perform private.moto_erreur('Seule une dépense justifiée peut être vérifiée.'); end if;
  if d.declare_par = auth.uid() then perform private.moto_refus('Auto-validation interdite.'); end if;
  if v_dec not in ('VALIDEE','REJETEE') then perform private.moto_erreur('Décision : VALIDEE ou REJETEE.'); end if;
  perform private.moto_motif(p_motif, case when v_dec = 'REJETEE' then 5 else 0 end);
  perform set_config('moto.valideur', auth.uid()::text, true);
  update public.moto_depenses set statut = v_dec, verifie_par = auth.uid(), verifie_at = now(), motif_verification = nullif(btrim(p_motif), '') where id = d.id;
  return jsonb_build_object('id', d.id, 'statut', v_dec);
end $$;

-- ---------------------------------------------------------------------
-- 13. Pneus : date de fabrication (marquage DOT) quand lisible
-- ---------------------------------------------------------------------
alter table public.moto_pneus add column if not exists date_fabrication text check (date_fabrication is null or date_fabrication ~ '^[0-9]{4}$');
create or replace function public.moto_pneu_creer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_id uuid;
begin
  perform private.moto_exiger_classe(array['BM','ABM','LOGISTIQUE']);
  if nullif(btrim(p ->> 'code'), '') is null or nullif(btrim(p ->> 'marque'), '') is null or nullif(btrim(p ->> 'dimensions'), '') is null then
    perform private.moto_erreur('Code, marque et dimensions obligatoires.');
  end if;
  if nullif(btrim(p ->> 'date_fabrication'), '') is not null and btrim(p ->> 'date_fabrication') !~ '^[0-9]{4}$' then
    perform private.moto_erreur('Date de fabrication : 4 chiffres du marquage DOT (semaine + année, ex. 2526), ou vide si illisible.');
  end if;
  perform private.moto_motif('Entrée en stock pneu');
  insert into public.moto_pneus (code, marque, modele, dimensions, numero_serie, date_achat, cout_achat, fournisseur, date_fabrication)
  values (upper(btrim(p ->> 'code')), btrim(p ->> 'marque'), nullif(btrim(p ->> 'modele'), ''), btrim(p ->> 'dimensions'),
          nullif(btrim(p ->> 'numero_serie'), ''), nullif(p ->> 'date_achat', '')::date, private.moto_num(p, 'cout_achat'),
          nullif(btrim(p ->> 'fournisseur'), ''), nullif(btrim(p ->> 'date_fabrication'), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- @@GENERE_DEBUT  Copies EXACTES des fonctions de la migration 2, seule la classe 'LOGISTIQUE' est ajoutée à la liste des classes autorisées.
create or replace function public.moto_document_enregistrer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_classe text; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_type text := upper(coalesce(p ->> 'type_document', ''));
        v_path text := nullif(btrim(p ->> 'storage_path'), ''); v_id uuid; m public.moto_motos;
begin
  v_classe := private.moto_exiger_classe(array['BM','ABM','ZONE','UNITE','LOGISTIQUE']);
  m := private.moto_charger(v_moto);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre.'); end if;
  if v_classe = 'ZONE' and v_type not in ('RAPPORT_MECANICIEN','PHOTO','FACTURE') then
    perform private.moto_refus('Le Chef de Zone dépose rapports mécaniciens, photos et factures uniquement.');
  end if;
  if v_classe = 'UNITE' and v_type not in ('PHOTO','JUSTIFICATIF') then
    perform private.moto_refus('Le Chef d''unité dépose photos et justificatifs uniquement.');
  end if;
  if v_type in ('CARTE_GRISE','ASSURANCE','PV_REMISE','RAPPORT_MECANICIEN','PERMIS','FACTURE') and v_path is null then
    perform private.moto_erreur('Ce document exige le fichier numérisé.');
  end if;
  perform private.moto_stockage_valide(v_moto, v_path, array['document','controle','incident','maintenance','photo','justificatif']);
  perform private.moto_motif(p ->> 'motif');
  insert into public.moto_documents (moto_id, affectation_id, type_document, numero_reference, date_emission, date_expiration,
                                     storage_path, nom_fichier)
  values (v_moto, private.moto_uuid(p, 'affectation_id'), v_type, nullif(btrim(p ->> 'numero_reference'), ''),
          nullif(p ->> 'date_emission', '')::date, nullif(p ->> 'date_expiration', '')::date, v_path,
          nullif(btrim(p ->> 'nom_fichier'), ''))
  returning id into v_id;
  perform private.moto_recalculer_statuts(v_moto);
  return jsonb_build_object('id', v_id, 'statut', 'EN_VERIFICATION');
end $$;

create or replace function public.moto_incident_declarer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id');
        v_type text := upper(coalesce(p ->> 'type_incident', '')); v_grav text := upper(coalesce(p ->> 'gravite', ''));
        v_id uuid; v_immo boolean; v_aflp text; v_note text; m public.moto_motos; v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','UNITE','LOGISTIQUE']);
  m := private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre ou non affectée à votre compte.'); end if;
  if v_type not in ('PANNE','ACCIDENT','CREVAISON','ANOMALIE') then perform private.moto_erreur('Type d''incident inconnu.'); end if;
  if v_grav not in ('MINEURE','MAJEURE','CRITIQUE') then perform private.moto_erreur('Gravité inconnue.'); end if;
  if length(btrim(coalesce(p ->> 'description', ''))) < 10 then perform private.moto_erreur('Description trop courte (10 caractères minimum).'); end if;
  -- Règle de sécurité : incident critique ou accident = immobilisation immédiate.
  v_immo := v_grav = 'CRITIQUE' or v_type = 'ACCIDENT' or coalesce((p ->> 'immobiliser')::boolean, false);
  perform private.moto_motif('Déclaration d''incident');
  insert into public.moto_incidents (moto_id, type_incident, gravite, etape, description, lieu, compteur_km, survenu_at,
                                     arret_confirme, client_op_id)
  values (v_moto, v_type, v_grav, case when v_immo then 'IMMOBILISEE' else 'SIGNALE' end, btrim(p ->> 'description'),
          nullif(btrim(p ->> 'lieu'), ''), private.moto_num(p, 'compteur_km'),
          coalesce(nullif(p ->> 'survenu_at', '')::timestamptz, now()), coalesce((p ->> 'arret_confirme')::boolean, false), v_client)
  returning id into v_id;
  insert into public.moto_incident_etapes (incident_id, etape, note) values (v_id, 'SIGNALE', 'Déclaration');
  if v_immo then
    perform private.moto_ouvrir_immobilisation(v_moto, 'Incident '||v_type||' '||v_grav, 'INCIDENT', v_id);
    insert into public.moto_incident_etapes (incident_id, etape, note) values (v_id, 'IMMOBILISEE', 'Immobilisation de sécurité automatique');
  end if;
  -- Registre AFLP existant : un accident moto y est aussi inscrit (pas de double saisie).
  if v_type = 'ACCIDENT' and to_regprocedure('public.aflp_declare_incident(jsonb)') is not null then
    begin
      select public.aflp_declare_incident(jsonb_build_object(
        'incident_type', 'ACCIDENT_MOTO', 'risk_category', 'SECURITE', 'cluster', m.cluster_code,
        'severity', case v_grav when 'MINEURE' then 'FAIBLE' when 'MAJEURE' then 'ELEVEE' else 'CRITIQUE' end,
        'description', 'Moto '||m.code||' : '||btrim(p ->> 'description'),
        'immediate_action', case when v_immo then 'Moto immobilisée (Moto Manager)' else null end,
        'evidence_ref', 'moto_incidents:'||v_id)) ->> 'id' into v_aflp;
      update public.moto_incidents set aflp_incident_id = v_aflp where id = v_id;
    exception when others then
      v_note := 'Inscription au registre AFLP non effectuée : '||sqlerrm;
      insert into public.moto_incident_etapes (incident_id, etape, note) values (v_id, 'SIGNALE', v_note);
    end;
  end if;
  begin
    perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'compteur_km'),
                                        coalesce(nullif(p ->> 'survenu_at', '')::timestamptz, now()), 'INCIDENT');
  exception when sqlstate 'P0001' then
    insert into public.moto_incident_etapes (incident_id, etape, note) values (v_id, 'SIGNALE', 'Compteur non retenu : '||sqlerrm);
  end;
  v_res := jsonb_build_object('id', v_id, 'immobilisee', v_immo, 'aflp_incident_id', v_aflp);
  perform private.moto_op_enregistrer(v_client, 'INCIDENT', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_maintenance_demander(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_client uuid := private.moto_uuid(p, 'client_op_id'); v_prev jsonb; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_id uuid; v_res jsonb;
begin
  v_prev := private.moto_op_existant(v_client); if v_prev is not null then return v_prev; end if;
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','UNITE','LOGISTIQUE']);
  perform private.moto_charger(v_moto);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Moto hors de votre périmètre ou non affectée à votre compte.'); end if;
  if upper(coalesce(p ->> 'type_maintenance', '')) not in ('VIDANGE','ENTRETIEN_PREVENTIF','REVISION','REPARATION','PANNE') then
    perform private.moto_erreur('Type de maintenance inconnu.');
  end if;
  perform private.moto_motif('Demande d''entretien');
  insert into public.moto_maintenances (moto_id, type_maintenance, description, compteur_km, cout_estime, garage_nom, incident_id, client_op_id)
  values (v_moto, upper(p ->> 'type_maintenance'), btrim(coalesce(p ->> 'description', '')), private.moto_num(p, 'compteur_km'),
          private.moto_num(p, 'cout_estime'), nullif(btrim(p ->> 'garage_nom'), ''), private.moto_uuid(p, 'incident_id'), v_client)
  returning id into v_id;
  v_res := jsonb_build_object('id', v_id, 'statut', 'DEMANDEE');
  perform private.moto_op_enregistrer(v_client, 'MAINTENANCE_DEMANDE', 'SYNCHRONISE', v_res);
  return v_res;
end $$;

create or replace function public.moto_maintenance_demarrer(p_maintenance uuid, p_garage text, p_date date default current_date)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances;
begin
  perform private.moto_exiger_classe(array['BM','ZONE','ABM','LOGISTIQUE']);
  select * into mt from public.moto_maintenances where id = p_maintenance for update;
  if not found or mt.statut <> 'AUTORISEE' then perform private.moto_erreur('Seule une maintenance autorisée peut démarrer.'); end if;
  if not private.moto_peut_operer(mt.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if nullif(btrim(p_garage), '') is null then perform private.moto_erreur('Garage intervenant obligatoire.'); end if;
  perform private.moto_motif('Début d''intervention');
  update public.moto_maintenances set statut = 'EN_COURS', garage_nom = btrim(p_garage), date_intervention = p_date where id = p_maintenance;
  perform private.moto_ouvrir_immobilisation(mt.moto_id, 'Maintenance '||mt.type_maintenance, 'MAINTENANCE', mt.id);
  return jsonb_build_object('id', p_maintenance, 'statut', 'EN_COURS');
end $$;

create or replace function public.moto_pneu_poser(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare pn public.moto_pneus; v_moto uuid := private.moto_uuid(p, 'moto_id'); v_id uuid;
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','LOGISTIQUE']);
  perform private.moto_charger(v_moto, true);
  if not private.moto_peut_operer(v_moto) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  select * into pn from public.moto_pneus where id = private.moto_uuid(p, 'pneu_id') for update;
  if not found or pn.statut <> 'EN_STOCK' then perform private.moto_erreur('Pneu introuvable ou non disponible en stock.'); end if;
  if upper(coalesce(p ->> 'position', '')) not in ('AVANT','ARRIERE') then perform private.moto_erreur('Position : AVANT ou ARRIERE.'); end if;
  if exists (select 1 from public.moto_pneu_poses where moto_id = v_moto and position = upper(p ->> 'position') and depose_date is null) then
    perform private.moto_erreur('Un pneu est déjà monté à cette position : déposez-le d''abord.');
  end if;
  if private.moto_num(p, 'pose_km') is null then perform private.moto_erreur('Compteur au montage obligatoire.'); end if;
  perform private.moto_motif('Montage pneu');
  insert into public.moto_pneu_poses (pneu_id, moto_id, position, pose_date, pose_km)
  values (pn.id, v_moto, upper(p ->> 'position'), coalesce(nullif(p ->> 'pose_date', '')::date, current_date), private.moto_num(p, 'pose_km'))
  returning id into v_id;
  update public.moto_pneus set statut = 'MONTE' where id = pn.id;
  begin
    perform private.moto_enregistrer_km(v_moto, private.moto_num(p, 'pose_km'), now(), 'MAINTENANCE');
  exception when sqlstate 'P0001' then null;
  end;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.moto_pneu_deposer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare po public.moto_pneu_poses; v_dest text := upper(coalesce(p ->> 'destination', 'EN_STOCK'));
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','LOGISTIQUE']);
  select * into po from public.moto_pneu_poses where id = private.moto_uuid(p, 'pose_id') for update;
  if not found or po.depose_date is not null then perform private.moto_erreur('Montage introuvable ou déjà déposé.'); end if;
  if not private.moto_peut_operer(po.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if v_dest not in ('EN_STOCK','EN_REPARATION','REFORME') then perform private.moto_erreur('Destination inconnue.'); end if;
  if private.moto_num(p, 'depose_km') is null or private.moto_num(p, 'depose_km') < po.pose_km then
    perform private.moto_erreur('Compteur à la dépose obligatoire et supérieur ou égal au montage.');
  end if;
  perform private.moto_motif(coalesce(p ->> 'motif_depose', 'Dépose pneu'), 3);
  update public.moto_pneu_poses set depose_date = coalesce(nullif(p ->> 'depose_date', '')::date, current_date),
         depose_km = private.moto_num(p, 'depose_km'), motif_depose = btrim(p ->> 'motif_depose'), depose_par = auth.uid()
  where id = po.id;
  update public.moto_pneus set statut = v_dest, motif_reforme = case when v_dest = 'REFORME' then btrim(p ->> 'motif_depose') else motif_reforme end
  where id = po.pneu_id;
  return jsonb_build_object('id', po.id, 'km_parcourus', private.moto_num(p, 'depose_km') - po.pose_km);
end $$;

create or replace function public.moto_pneu_reparation(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare v_id uuid; v_moto uuid := private.moto_uuid(p, 'moto_id');
begin
  perform private.moto_exiger_classe(array['BM','ABM','ZONE','LOGISTIQUE']);
  if v_moto is not null and not private.moto_peut_operer(v_moto) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  if not exists (select 1 from public.moto_pneus where id = private.moto_uuid(p, 'pneu_id')) then perform private.moto_erreur('Pneu introuvable.'); end if;
  perform private.moto_motif('Réparation pneu');
  insert into public.moto_pneu_reparations (pneu_id, moto_id, date_reparation, compteur_km, cout, description)
  values (private.moto_uuid(p, 'pneu_id'), v_moto, coalesce(nullif(p ->> 'date_reparation', '')::date, current_date),
          private.moto_num(p, 'compteur_km'), coalesce(private.moto_num(p, 'cout'), 0), btrim(coalesce(p ->> 'description', 'Réparation')))
  returning id into v_id;
  update public.moto_pneus set statut = 'EN_STOCK' where id = private.moto_uuid(p, 'pneu_id') and statut = 'EN_REPARATION';
  return jsonb_build_object('id', v_id);
end $$;
-- Copies de la migration 2 avec contrôle d'indépendance de l'affectataire ajouté (revue indépendante du 31/10/2026).
create or replace function public.moto_incident_avancer(p_incident uuid, p_etape text, p_note text, p_cout numeric default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare i public.moto_incidents; v_classe text; v_cible text := upper(coalesce(p_etape, '')); v_ok boolean; v_immo boolean;
begin
  v_classe := private.moto_exiger_classe(array['BM','ZONE','ABM']);
  select * into i from public.moto_incidents where id = p_incident for update;
  if not found then perform private.moto_erreur('Incident introuvable.'); end if;
  if not private.moto_peut_operer(i.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  perform private.moto_exiger_independance(i.moto_id, 'cette étape');
  perform private.moto_motif(p_note, 5);
  v_immo := exists (select 1 from public.moto_immobilisations where source_type = 'INCIDENT' and source_id = i.id and fin is null);
  v_ok := case i.etape
    when 'SIGNALE' then v_cible in ('IMMOBILISEE','DIAGNOSTIC') or (v_cible = 'CLOS' and i.gravite <> 'CRITIQUE')
    when 'IMMOBILISEE' then v_cible = 'DIAGNOSTIC'
    when 'DIAGNOSTIC' then v_cible in ('AUTORISATION_DEPENSE','REPARATION','CONTROLE') or (v_cible = 'CLOS' and not v_immo and i.gravite <> 'CRITIQUE')
    when 'AUTORISATION_DEPENSE' then v_cible = 'REPARATION'
    when 'REPARATION' then v_cible = 'CONTROLE'
    when 'CONTROLE' then v_cible = 'REMIS_EN_SERVICE'
    when 'REMIS_EN_SERVICE' then v_cible = 'CLOS'
    else false end;
  if not v_ok then perform private.moto_erreur(format('Transition interdite : %s → %s.', i.etape, v_cible)); end if;
  if v_cible = 'IMMOBILISEE' and not v_immo then
    perform private.moto_ouvrir_immobilisation(i.moto_id, 'Incident '||i.type_incident, 'INCIDENT', i.id);
  end if;
  if v_cible = 'AUTORISATION_DEPENSE' then
    if v_classe not in ('BM','ZONE') then perform private.moto_refus('Autorisation de dépense réservée au Branch Manager ou au Chef de Zone.'); end if;
    if i.declare_par = auth.uid() then perform private.moto_refus('Le déclarant ne peut pas autoriser la dépense de son propre incident.'); end if;
    if p_cout is null or p_cout <= 0 then perform private.moto_erreur('Montant estimé de la dépense obligatoire.'); end if;
    perform set_config('moto.valideur', auth.uid()::text, true);
    update public.moto_incidents set cout_estime = p_cout, depense_autorisee_par = auth.uid() where id = i.id;
  end if;
  if v_cible = 'REMIS_EN_SERVICE' then
    if not private.moto_controle_apte_depuis(i.moto_id, i.declare_at) then
      perform private.moto_erreur('Remise en service bloquée : contrôle de remise en service APTE obligatoire après l''incident.');
    end if;
    update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = 'Remise en service après incident'
    where source_type = 'INCIDENT' and source_id = i.id and fin is null;
  end if;
  if v_cible = 'CLOS' and p_cout is not null then update public.moto_incidents set cout_reel = p_cout where id = i.id; end if;
  update public.moto_incidents set etape = v_cible,
         clos_par = case when v_cible = 'CLOS' then auth.uid() else clos_par end,
         clos_at = case when v_cible = 'CLOS' then now() else clos_at end
  where id = i.id;
  insert into public.moto_incident_etapes (incident_id, etape, note) values (i.id, v_cible, btrim(p_note));
  perform private.moto_recalculer_statuts(i.moto_id);
  return jsonb_build_object('id', i.id, 'etape', v_cible);
end $$;

create or replace function public.moto_maintenance_terminer(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare mt public.moto_maintenances; v_fact uuid := private.moto_uuid(p, 'facture_document_id'); v_remise boolean := coalesce((p ->> 'remettre_en_service')::boolean, false);
begin
  perform private.moto_exiger_classe(array['BM','ZONE','ABM']);
  select * into mt from public.moto_maintenances where id = private.moto_uuid(p, 'maintenance_id') for update;
  if not found or mt.statut <> 'EN_COURS' then perform private.moto_erreur('Seule une maintenance en cours peut être terminée.'); end if;
  if not private.moto_peut_operer(mt.moto_id) then perform private.moto_refus('Hors de votre périmètre.'); end if;
  perform private.moto_exiger_independance(mt.moto_id, 'cette étape');
  if v_fact is not null and not exists (select 1 from public.moto_documents where id = v_fact and moto_id = mt.moto_id and type_document = 'FACTURE') then
    perform private.moto_erreur('La facture doit être un document FACTURE de cette moto.');
  end if;
  if private.moto_num(p, 'cout_reel') is null then perform private.moto_erreur('Coût réel obligatoire (0 si aucune dépense).'); end if;
  if v_remise and private.moto_num(p, 'cout_reel') > 0 and v_fact is null then
    perform private.moto_erreur('Facture obligatoire pour clôturer une intervention payante.');
  end if;
  perform private.moto_motif(coalesce(p ->> 'motif', 'Fin d''intervention'));
  update public.moto_maintenances set statut = 'TERMINEE', cout_reel = private.moto_num(p, 'cout_reel'), facture_document_id = v_fact,
         compteur_km = coalesce(private.moto_num(p, 'compteur_km'), compteur_km), garage_nom = coalesce(nullif(btrim(p ->> 'garage_nom'), ''), garage_nom),
         termine_par = auth.uid(), termine_at = now() where id = mt.id;
  perform private.moto_enregistrer_km(mt.moto_id, private.moto_num(p, 'compteur_km'), now(), 'MAINTENANCE');
  if v_remise then
    update public.moto_immobilisations set fin = now(), levee_par = auth.uid(), levee_motif = 'Fin de maintenance'
    where moto_id = mt.moto_id and source_type = 'MAINTENANCE' and source_id = mt.id and fin is null;
  end if;
  perform private.moto_recalculer_statuts(mt.moto_id);
  return jsonb_build_object('id', mt.id, 'statut', 'TERMINEE', 'remise_en_service', v_remise);
end $$;
-- @@GENERE_FIN

-- ---------------------------------------------------------------------
-- 14. Synchronisation : nouveaux types hors ligne
-- ---------------------------------------------------------------------
create or replace function public.moto_sync_batch(p_operations jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare op jsonb; v_type text; v_client uuid; v_payload jsonb; v_res jsonb; v_out jsonb := '[]'::jsonb; v_state text; v_msg text; v_prev jsonb;
begin
  if auth.uid() is null or private.moto_classe() is null then perform private.moto_refus('Accès AFLP FLEET refusé.'); end if;
  if p_operations is null or jsonb_typeof(p_operations) <> 'array' then perform private.moto_erreur('Lot invalide.'); end if;
  if jsonb_array_length(p_operations) > 50 then perform private.moto_erreur('Lot limité à 50 opérations.'); end if;
  for op in select * from jsonb_array_elements(p_operations) loop
    v_type := upper(coalesce(op ->> 'type', ''));
    v_client := private.moto_uuid_ou_null(op ->> 'client_op_id');
    if v_client is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', op ->> 'client_op_id', 'statut', 'REJETE', 'message', 'Identifiant d''opération manquant ou invalide.'));
      continue;
    end if;
    v_payload := coalesce(op -> 'payload', '{}'::jsonb) || jsonb_build_object('client_op_id', v_client::text);
    begin
      v_prev := private.moto_op_existant(v_client);
      if v_prev is not null then
        v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', coalesce(v_prev ->> 'statut', 'SYNCHRONISE'),
                                                                'doublon', true, 'resultat', v_prev, 'message', v_prev ->> 'message'));
        continue;
      end if;
      v_res := case v_type
        when 'RELEVE_KM' then public.moto_releve_km(v_payload)
        when 'CONTROLE_DEPART' then public.moto_controle_depart(v_payload)
        when 'CARBURANT' then public.moto_carburant_declarer(v_payload)
        when 'INCIDENT' then public.moto_incident_declarer(v_payload)
        when 'DOTATION_CONFIRMER' then public.moto_dotation_confirmer(v_payload)
        when 'MAINTENANCE_DEMANDE' then public.moto_maintenance_demander(v_payload)
        when 'FORMATION' then public.moto_formation_enregistrer(v_payload)
        when 'INSPECTION_MENSUELLE' then public.moto_inspection_mensuelle(v_payload)
        when 'ACTION_SIGNALER' then public.moto_action_signaler(v_payload)
        when 'DEPENSE' then public.moto_depense_declarer(v_payload)
        else null end;
      if v_res is null then perform private.moto_erreur('Type d''opération non synchronisable : '||v_type); end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', 'SYNCHRONISE', 'resultat', v_res));
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      if v_state in ('P0001','42501','23514','23505','23502','23503','22P02','22003','22007','22008','22023','2201B') then
        perform private.moto_op_enregistrer(v_client, v_type, 'REJETE', jsonb_build_object('message', v_msg, 'code', v_state));
        v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', 'REJETE', 'message', v_msg, 'code', v_state));
      else
        v_out := v_out || jsonb_build_array(jsonb_build_object('client_op_id', v_client, 'statut', 'ERREUR_TEMPORAIRE', 'message', v_msg, 'code', v_state));
      end if;
    end;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 15. Stockage : justificatifs de dépenses hors moto (depenses/<compte>/…)
-- ---------------------------------------------------------------------
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
  if v_moto is null then return false; end if;
  if not exists (select 1 from public.moto_motos where id = v_moto) then return false; end if;
  if v_classe in ('BM','ABM') then return true; end if;
  if v_classe = 'LOGISTIQUE' then return v_cat in ('controle','incident','maintenance','photo','justificatif','document'); end if;
  if v_classe = 'ZONE' then return private.moto_peut_operer(v_moto) and v_cat in ('controle','incident','maintenance','photo'); end if;
  if v_classe = 'UNITE' then return private.moto_est_affectataire(v_moto) and v_cat in ('justificatif','incident','photo','controle'); end if;
  return false;
end $$;

drop policy if exists moto_documents_consultation on storage.objects;
create policy moto_documents_consultation on storage.objects for select to authenticated
  using (bucket_id = 'moto-documents'
         and ((private.moto_uuid_ou_null((storage.foldername(name))[1]) is not null
               and private.moto_dans_perimetre(private.moto_uuid_ou_null((storage.foldername(name))[1])))
              or ((storage.foldername(name))[1] = 'depenses'
                  and private.moto_lecture_enveloppe(private.moto_uuid_ou_null((storage.foldername(name))[2])))));

-- ---------------------------------------------------------------------
-- 16. RLS des nouvelles tables (lecture seule, écriture par fonctions)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['moto_catalogue_points','moto_photos','moto_actions_correctives','moto_enveloppes','moto_depenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_lecture', t);
  end loop;
  foreach t in array array['moto_catalogue_points','moto_photos','moto_actions_correctives','moto_enveloppes','moto_depenses'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_journal_trg', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.moto_journaliser()', t || '_journal_trg', t);
  end loop;
end $$;
create policy moto_catalogue_points_lecture on public.moto_catalogue_points for select to authenticated using (private.moto_classe() is not null);
create policy moto_photos_lecture on public.moto_photos for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_actions_correctives_lecture on public.moto_actions_correctives for select to authenticated using (private.moto_dans_perimetre(moto_id));
create policy moto_enveloppes_lecture on public.moto_enveloppes for select to authenticated using (private.moto_lecture_enveloppe(titulaire_id));
create policy moto_depenses_lecture on public.moto_depenses for select to authenticated
  using (exists (select 1 from public.moto_enveloppes e where e.id = enveloppe_id and private.moto_lecture_enveloppe(e.titulaire_id)));
-- Le coordinateur et le Chef de zone consultent le stock de pneus.
drop policy if exists moto_pneus_lecture on public.moto_pneus;
create policy moto_pneus_lecture on public.moto_pneus for select to authenticated using (private.moto_classe() in ('BM','ABM','ZONE','LOGISTIQUE','FINANCE','DIRECTION'));
drop policy if exists moto_pneu_reparations_lecture on public.moto_pneu_reparations;
create policy moto_pneu_reparations_lecture on public.moto_pneu_reparations for select to authenticated
  using (private.moto_classe() in ('BM','ABM','ZONE','LOGISTIQUE','FINANCE','DIRECTION') or (moto_id is not null and private.moto_dans_perimetre(moto_id)));
drop policy if exists moto_formation_resultats_lecture on public.moto_formation_resultats;
create policy moto_formation_resultats_lecture on public.moto_formation_resultats for select to authenticated
  using (user_id = auth.uid() or private.moto_classe() in ('BM','ABM','ZONE','LOGISTIQUE','DIRECTION'));

-- ---------------------------------------------------------------------
-- 17. Vues
-- ---------------------------------------------------------------------
create or replace view public.moto_v_flotte with (security_invoker = on) as
select m.id, m.code, m.qr_token, m.marque, m.modele, m.annee, m.couleur, m.numero_chassis, m.numero_moteur, m.immatriculation,
       m.date_reception, m.cluster_code, m.zone_code, m.statut_administratif, m.statut_affectation, m.statut_technique,
       m.mise_en_service_at, m.compteur_actuel_km, m.row_version, m.observations,
       a.id as affectation_id, a.beneficiaire_id, private.moto_nom_profil(a.beneficiaire_id) as beneficiaire_nom, a.type_affectation,
       (m.mise_en_service_at is not null and m.statut_technique = 'APTE'
        and m.statut_administratif = 'CONFORME' and m.statut_affectation in ('REMISE','TRANSFEREE')) as autorisee_a_circuler,
       (select count(*) from public.moto_incidents i where i.moto_id = m.id and i.etape <> 'CLOS') as incidents_ouverts,
       (select count(*) from public.moto_immobilisations im where im.moto_id = m.id and im.fin is null) as immobilisations_ouvertes,
       (select max(r.date_releve) from public.moto_releves_km r where r.moto_id = m.id) as dernier_releve_at,
       m.situation_parc, m.origine, m.photo_path, m.fournisseur, m.date_acquisition, m.date_debut_utilisation, m.date_debut_suivi,
       m.historique_note, m.compteur_reception_km, m.beneficiaire_prevu_id,
       coalesce(private.moto_nom_profil(m.beneficiaire_prevu_id), m.beneficiaire_prevu_libelle) as beneficiaire_prevu_nom,
       private.moto_classe_de(a.beneficiaire_id) as beneficiaire_classe,
       (m.situation_parc = 'RECEPTIONNEE' and (m.marque is null or m.modele is null or m.numero_chassis is null or m.immatriculation is null
         or m.photo_path is null or m.statut_administratif <> 'CONFORME' or (m.origine = 'NEUVE' and m.date_reception is null))) as dossier_incomplet,
       (select count(*) from public.moto_actions_correctives x where x.moto_id = m.id and x.statut in ('OUVERTE','PLANIFIEE','REALISEE')) as actions_ouvertes,
       (select count(*) from public.moto_actions_correctives x where x.moto_id = m.id and x.gravite = 'CRITIQUE' and x.statut in ('OUVERTE','PLANIFIEE','REALISEE')) as actions_critiques_ouvertes
from public.moto_motos m
left join public.moto_affectations a on a.moto_id = m.id and a.statut = 'ACTIVE'
where m.actif;

-- Inspections exigibles : uniquement les mois où la moto était en service
-- au début de la fenêtre (aucune inspection rétroactive), 12 derniers mois.
-- Limite connue : l'affectataire retenu est l'affectataire ACTUEL.
create or replace view public.moto_v_inspections_exigibles with (security_invoker = on) as
with actives as (
  select m.id, m.code, m.zone_code, m.cluster_code, m.statut_technique, m.mise_en_service_at::date as mes, a.beneficiaire_id,
         private.moto_classe_de(a.beneficiaire_id) as classe_benef
  from public.moto_motos m
  join public.moto_affectations a on a.moto_id = m.id and a.statut = 'ACTIVE' and a.type_affectation in ('REMISE','TRANSFERT')
  where m.actif and m.mise_en_service_at is not null and m.situation_parc = 'RECEPTIONNEE'
), mois as (
  select x.*, g::date as periode from actives x
  cross join lateral generate_series(greatest(date_trunc('month', x.mes::timestamp), date_trunc('month', current_date::timestamp) - interval '11 months'),
                                     date_trunc('month', current_date::timestamp), interval '1 month') g
), slots as (
  select mo.*, n.niveau, f.debut, f.fin
  from mois mo
  cross join lateral (values ('ZONE'), ('COORDINATION'), ('INDEPENDANTE')) n(niveau)
  cross join lateral private.moto_fenetre(n.niveau, mo.periode) f
  where ((n.niveau = 'ZONE' and mo.classe_benef = 'UNITE')
      or (n.niveau = 'COORDINATION' and coalesce(mo.classe_benef, '') <> 'LOGISTIQUE')
      or (n.niveau = 'INDEPENDANTE' and mo.classe_benef = 'LOGISTIQUE'))
    and mo.mes <= f.debut
)
select s.id as moto_id, s.code, s.zone_code, s.cluster_code, s.statut_technique, s.beneficiaire_id,
       private.moto_nom_profil(s.beneficiaire_id) as beneficiaire_nom, s.classe_benef as beneficiaire_classe,
       s.periode, s.niveau, s.debut as fenetre_debut, s.fin as fenetre_fin,
       c.id as inspection_id, c.date_controle, c.conformite, c.realise_par, private.moto_nom_profil(c.realise_par) as inspecteur_nom,
       case when c.id is null and current_date <= s.fin then 'PROGRAMMEE'
            when c.id is null then 'NON_EFFECTUEE'
            when c.date_controle::date > s.fin then 'EFFECTUEE_HORS_DELAI'
            else 'EFFECTUEE' end as statut
from slots s
left join lateral (select * from public.moto_controles c where c.moto_id = s.id and c.type_controle = 'INSPECTION_MENSUELLE'
                   and c.niveau = s.niveau and c.periode = s.periode and c.remplace_par is null
                   order by c.date_controle desc limit 1) c on true;

create or replace view public.moto_v_actions with (security_invoker = on) as
select x.*, m.code as moto_code, private.moto_nom_profil(x.responsable_id) as responsable_nom, private.moto_nom_profil(x.signale_par) as signale_par_nom,
  (x.statut in ('OUVERTE','PLANIFIEE','REALISEE') and x.date_cible is not null and x.date_cible < current_date) as en_retard,
  (x.occurrences >= 2 or exists (select 1 from public.moto_actions_correctives y where y.moto_id = x.moto_id and y.point_code = x.point_code
      and y.id <> x.id and y.statut = 'CLOTUREE' and y.verifie_at > x.constat_at - interval '90 days')) as recurrente,
  (x.statut = 'CLOTUREE' and x.date_cible is not null and x.verifie_at::date <= x.date_cible) as resolue_dans_delai
from public.moto_actions_correctives x join public.moto_motos m on m.id = x.moto_id;

create or replace view public.moto_v_enveloppes with (security_invoker = on) as
select e.*, private.moto_nom_profil(e.titulaire_id) as titulaire_nom,
  coalesce((select sum(d.montant) from public.moto_depenses d where d.enveloppe_id = e.id and d.statut <> 'REJETEE'), 0) as montant_consomme,
  coalesce((select sum(d.montant) from public.moto_depenses d where d.enveloppe_id = e.id and d.statut = 'VALIDEE'), 0) as montant_justifie,
  coalesce((select sum(d.montant) from public.moto_depenses d where d.enveloppe_id = e.id and d.statut = 'DECLAREE'), 0) as en_attente_justificatif,
  coalesce((select sum(d.montant) from public.moto_depenses d where d.enveloppe_id = e.id and d.statut = 'JUSTIFIEE'), 0) as en_attente_verification,
  case when e.statut = 'APPROUVEE' then e.montant_approuve - coalesce((select sum(d.montant) from public.moto_depenses d where d.enveloppe_id = e.id and d.statut <> 'REJETEE'), 0) end as solde_disponible
from public.moto_enveloppes e;

create or replace view public.moto_v_pneus with (security_invoker = on) as
select pn.id, pn.code, pn.marque, pn.modele, pn.dimensions, pn.statut, pn.cout_achat,
  (select po.moto_id from public.moto_pneu_poses po where po.pneu_id = pn.id and po.depose_date is null) as moto_actuelle_id,
  (select po.position from public.moto_pneu_poses po where po.pneu_id = pn.id and po.depose_date is null) as position_actuelle,
  coalesce((select sum(coalesce(po.depose_km, mm.compteur_actuel_km) - po.pose_km) from public.moto_pneu_poses po
            join public.moto_motos mm on mm.id = po.moto_id where po.pneu_id = pn.id), 0) as km_parcourus,
  coalesce((select sum(r.cout) from public.moto_pneu_reparations r where r.pneu_id = pn.id), 0) as cout_reparations,
  (select count(*) from public.moto_pneu_reparations r where r.pneu_id = pn.id) as nb_reparations,
  case when pn.statut = 'REFORME' and pn.cout_achat is not null
         and coalesce((select sum(po.depose_km - po.pose_km) from public.moto_pneu_poses po where po.pneu_id = pn.id), 0) > 0
       then round((pn.cout_achat + coalesce((select sum(r.cout) from public.moto_pneu_reparations r where r.pneu_id = pn.id), 0))
                  / (select sum(po.depose_km - po.pose_km) from public.moto_pneu_poses po where po.pneu_id = pn.id), 2) end as fcfa_km_vie_complete,
  pn.numero_serie, pn.date_fabrication,
  (select sum(coalesce(po.depose_date, current_date) - po.pose_date) from public.moto_pneu_poses po where po.pneu_id = pn.id) as jours_utilisation,
  (select min(po.pose_date) from public.moto_pneu_poses po where po.pneu_id = pn.id) as premiere_pose,
  (select max(po.depose_date) from public.moto_pneu_poses po where po.pneu_id = pn.id and pn.statut = 'REFORME') as date_reforme
from public.moto_pneus pn;

do $$
declare v text;
begin
  foreach v in array array['moto_v_flotte','moto_v_inspections_exigibles','moto_v_actions','moto_v_enveloppes','moto_v_pneus'] loop
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 18. Droits d'exécution (même règle que la migration 2)
-- ---------------------------------------------------------------------
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','private') and p.proname like 'moto\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.nspname = 'public' or f.proname in ('moto_classe','moto_classe_de','moto_est_finance_manager','moto_mon_cluster','moto_ma_zone','moto_mon_nom',
        'moto_est_affectataire','moto_dans_perimetre','moto_lecture_finance','moto_lecture_enveloppe','moto_peut_deposer','moto_uuid_ou_null',
        'moto_nom_profil','moto_param','moto_fenetre') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;

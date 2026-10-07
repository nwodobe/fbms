-- Migration des images terrain — corrections de schéma associées.
--
-- DÉJÀ APPLIQUÉ sur le projet live jmbdgpdthzpszfnddwzi le 2026-08-29.
-- Ce fichier documente et reproduit les deux corrections de schéma qui ont
-- été nécessaires ; il est idempotent et ne touche pas aux données.
--
-- Contexte : les 329 images base64 qui vivaient dans rt.data (photo,
-- pieceRecto, pieceVerso) et villages.data.s7.candidats[] ont été
-- transférées vers le bucket privé terrain-preuves, adressées par contenu
-- sous migration/<sha256>.jpg et référencées par la table preuves
-- (166 lignes entite_type='rt', 163 lignes entite_type='village_candidat').
-- Déduplication par sha256 : 329 références pour 152 objets uniques
-- (7,3 Mo stockés) — un RT et le candidat dont il est issu sont la même
-- personne avec la même photo dans 51 cas. Le JSONB conserve les chemins
-- sous photoPath / pieceRectoPath / pieceVersoPath ; les clés photo,
-- pieceRecto et pieceVerso sont à null, ce qui vaut suppression explicite
-- au sens des triggers fb_preserve_media_*.
--
-- Mesures : rt.data 9,9 Mo → 110 Ko ; villages.data 10,0 Mo → 240 Ko ;
-- les 18 requêtes initiales du shell terminent à 4,0 s contre ~19 s avant.
--
-- Contrôle d'intégrité exécuté : 329 images sauvegardées, 152 sha256
-- uniques, 0 image sans ligne preuves, 0 ligne sans objet dans
-- terrain-preuves, objets identiques octet pour octet aux base64 d'origine.
--
-- Défaut de la Mission 4 révélé par cette migration : les CHECK de la
-- table preuves n'autorisaient ni entite_type='rt' ni les type_preuve
-- photo_profil / piece_recto / piece_verso — uploadPrivateDoc('rt', …)
-- était donc rejeté en base, d'où une table preuves vide en production.
--
-- Ne pas toucher : _fb_media_backup_20260829 (sauvegarde des images,
-- RLS active, droits révoqués pour anon et authenticated) ; la fonction
-- Edge migrer-images-terrain est neutralisée (410) mais doit encore être
-- supprimée depuis le tableau de bord Supabase.

-- 1) CHECK entite_type : listes étendues sans rien retirer.
alter table public.preuves
  drop constraint if exists preuves_entite_type_check;
alter table public.preuves
  add constraint preuves_entite_type_check
  check (entite_type in (
    'achat', 'avance', 'reconciliation', 'inspection', 'visite',
    'rt', 'village', 'village_candidat'
  ));

-- 2) CHECK type_preuve : photo de profil et pièce recto/verso autorisées.
alter table public.preuves
  drop constraint if exists preuves_type_preuve_check;
alter table public.preuves
  add constraint preuves_type_preuve_check
  check (type_preuve in (
    'recu', 'photo', 'signature', 'document', 'gps',
    'photo_profil', 'piece_recto', 'piece_verso'
  ));

-- 3) Anti-doublon sha256 : au périmètre d'une entité, plus jamais global.
--    L'index global interdisait qu'une même image serve de preuve à deux
--    entités distinctes (cas réel : RT et candidat = même personne).
drop index if exists public.uq_preuves_sha256;
create unique index if not exists uq_preuves_sha256_par_entite
  on public.preuves (entite_type, entite_id, type_preuve, sha256)
  where sha256 is not null;

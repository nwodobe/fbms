-- =============================================================================
-- AFLP FLEET 20 : suppression d'un achat de carburant par le Branch Manager seul
-- APPLIQUÉ EN PRODUCTION le 04/11/2026 (empreinte identique à la réplique testée).
-- Décision du Branch Manager du 04/11/2026 : « permettre une option où seul le Branch Manager
-- peut supprimer […] dépense carburant ».
--
-- public.moto_carburant_supprimer(p_carburant, p_motif) :
--   - réservé au Branch Manager (aucun autre rôle, ni le conducteur, ni l'ABM, ni la Finance) ;
--   - motif obligatoire (10 caractères minimum) ;
--   - refusé si l'achat est déjà rattaché à un remboursement, ou si son justificatif a été VÉRIFIÉ
--     par un autre responsable (dans ces deux cas l'argent a déjà été engagé : passer par une correction) ;
--   - la ligne disparaît des consommations, coûts et soldes ; le déclencheur moto_carburant_journal_trg
--     conserve dans moto_journal la ligne complète supprimée, son auteur et le motif (preuve d'audit) ;
--   - le relevé kilométrique associé et la photo du reçu ne sont pas supprimés.
-- Aucune table ni aucun statut ajoutés. Rejouable. Retour arrière : 20261115090100_aflp_fleet_20_rollback.sql
-- =============================================================================
create or replace function public.moto_carburant_supprimer(p_carburant uuid, p_motif text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare c public.moto_carburant;
begin
  perform private.moto_exiger_classe(array['BM']);
  perform private.moto_motif(p_motif, 10);
  select * into c from public.moto_carburant where id = p_carburant for update;
  if not found then perform private.moto_erreur('Achat de carburant introuvable.'); end if;
  if c.remboursement_id is not null then
    perform private.moto_erreur('Achat déjà rattaché à un remboursement : suppression impossible, passez par une correction.');
  end if;
  if c.justificatif_statut = 'VERIFIE' then
    perform private.moto_erreur('Justificatif déjà vérifié par un autre responsable : suppression impossible, passez par une correction.');
  end if;
  delete from public.moto_carburant where id = c.id;
  return jsonb_build_object('id', c.id, 'supprime', true, 'litres', c.litres, 'montant', c.montant,
    'note', 'Achat supprimé. La ligne complète, l''auteur et le motif restent dans le journal d''audit.');
end $function$;

revoke all on function public.moto_carburant_supprimer(uuid, text) from public, anon;
grant execute on function public.moto_carburant_supprimer(uuid, text) to authenticated;

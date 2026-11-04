-- =============================================================================
-- AFLP FLEET 17 : le Branch Manager approuve lui-même les règles d'entretien qu'il propose
-- APPLIQUÉ EN PRODUCTION le 04/11/2026 (empreinte identique à la réplique testée).
-- Décision du Branch Manager du 04/11/2026 (« je dois tout pouvoir faire moi-même à partir de
-- mon compte, tout valider et autoriser » ; plan d'entretien APSONIC AP150-30 « applique et approuve »).
--
-- Ce qui change : moto_regle_version_approuver accepte une version proposée par le BM lui-même ;
-- le motif est préfixé « Auto-approbation par le proposant ». La contrainte de table
-- moto_regles_versions_check (approbateur ≠ proposant) est supprimée.
-- Ce qui ne change pas : seule une version requalifiée (constructeur avec référence, ou politique
-- interne avec référence) est approuvable ; une hypothèse ne l'est jamais ; référence de 10 caractères
-- minimum et date d'effet obligatoires ; réservé au BM.
-- Rejouable. Retour arrière : 20261112090100_aflp_fleet_17_rollback.sql
-- =============================================================================

alter table public.moto_regles_versions drop constraint if exists moto_regles_versions_check;

do $$
declare v text; n text;
begin
  v := pg_get_functiondef('public.moto_regle_version_approuver(uuid, date, text)'::regprocedure);
  if position('Auto-approbation par le proposant' in v) = 0 then
    n := replace(v, $a$  if r.propose_par = auth.uid() then
    perform private.moto_refus('Quatre yeux : le Branch Manager approuve une version proposée par un autre (coordinateur ou ABM).');
  end if;$a$, '');
    n := replace(n, $a$date_effet = p_date_effet, motif_approbation = btrim(p_motif) where id = r.id;$a$,
      $b$date_effet = p_date_effet,
         motif_approbation = case when r.propose_par = auth.uid() then 'Auto-approbation par le proposant : ' || btrim(p_motif) else btrim(p_motif) end
   where id = r.id;$b$);
    if n = v or position('Auto-approbation par le proposant' in n) = 0 or position('Quatre yeux' in n) > 0 then
      raise exception 'AFLP FLEET 17 : texte attendu introuvable dans moto_regle_version_approuver';
    end if;
    execute n;
  end if;
end $$;

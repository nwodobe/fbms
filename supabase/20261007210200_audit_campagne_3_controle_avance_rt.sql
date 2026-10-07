-- Audit campagne 2027 · 3/4 — contrôle « achat ≤ avance RT » sans trou.
--
-- Constat (simulation en transaction annulée) : fb_prevent_achat_over_advance excluait du cumul les
-- achats dont local_id est vide dès que le nouvel achat avait aussi un local_id vide
-- (coalesce(x.local_id,'') <> coalesce(new.local_id,'') est faux pour '' = ''). Un achat inséré sans
-- local_id (API, script, ancien écran) ignorait donc tous les achats précédents : avance de 250 000 FCFA,
-- achats de 200 000 + 80 000 acceptés. L'écran Achat Bord Champ envoie toujours un local_id, d'où un
-- trou côté serveur seulement.
-- Correctif : on exclut uniquement la ligne elle-même (même id) ou sa réécriture hors ligne (même
-- local_id non vide). Règle métier inchangée.

create or replace function public.fb_prevent_achat_over_advance()
returns trigger language plpgsql set search_path = public as $$
declare
  k text;
  total_avance numeric := 0;
  total_achat numeric := 0;
  disponible numeric := 0;
begin
  k := public.fb_rt_key(new.rt_id, new.rt_nom);
  if k is null then
    return new;
  end if;

  select coalesce(sum(a.montant),0) into total_avance
  from public.avances a
  where public.fb_rt_key(a.rt_id, a.rt_nom) = k
    and coalesce(a.statut,'Active') <> 'Annulee';

  select coalesce(sum(x.montant),0) into total_achat
  from public.achats x
  where public.fb_rt_key(x.rt_id, x.rt_nom) = k
    and x.id is distinct from new.id
    and not coalesce(nullif(btrim(coalesce(new.local_id,'')),'') is not null and x.local_id = new.local_id, false);

  disponible := total_avance - total_achat;
  if coalesce(new.montant,0) > disponible then
    raise exception 'Avance RT insuffisante. Disponible: %, achat: %', disponible, new.montant
      using errcode = '23514';
  end if;

  return new;
end $$;

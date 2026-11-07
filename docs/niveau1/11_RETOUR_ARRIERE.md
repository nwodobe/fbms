# Procédure de retour arrière — Niveau 1

Date : 14 août 2026 · Script : `docs/migrations/niveau1/ROLLBACK_niveau1.sql`

## 1. Avertissement — lire avant d'exécuter

Un retour arrière fait **retomber les neuf verrous P0 en une seule transaction** :

- le reçu dupliqué redevient possible ;
- le refinancement d'un cycle non réconcilié redevient possible ;
- le solde de stock ou de sacs négatif redevient possible ;
- une opération clôturée redevient modifiable ;
- le journal d'audit redevient modifiable par son propriétaire.

**Ce n'est donc jamais une position d'attente.** C'est une mesure d'urgence, à
assortir immédiatement d'une **suspension des opérations financières** jusqu'à
correction et nouvelle migration.

## 2. Quand y recourir

| Situation | Retour arrière ? |
|---|---|
| Une règle bloque une opération légitime | **Non** — ajuster le paramètre concerné |
| Un message d'erreur est incompréhensible | **Non** — corriger le frontend |
| Les achats sont bloqués faute de paramètre | **Non** — saisir le paramètre (§5) |
| Une migration a échoué à mi-parcours | **Oui**, puis diagnostic |
| Un défaut de conception bloque toute la campagne | **Oui**, avec suspension des opérations |
| Corruption de données constatée | **Non** — restaurer une sauvegarde, ne pas dérouler ce script |

## 3. Ce que le script fait, et ne fait pas

| Fait | Ne fait pas |
|---|---|
| Supprime les triggers `trg_n1_*` | Supprimer une table |
| Supprime les contraintes et index ajoutés | Supprimer une colonne |
| Supprime les fonctions et vues `n1_*` | Supprimer une donnée |
| Rétablit `achats_upd` et `avances_upd` d'origine | Supprimer le journal d'audit |
| Rend les droits `authenticated` initiaux | Restaurer une sauvegarde |

### Pourquoi les colonnes et les tables sont conservées

Un `DROP COLUMN` détruit irréversiblement des données déjà écrites : clés
d'idempotence, codes métier, rattachements de cycle, références papier,
historique d'audit.

Le retour arrière doit rendre le système **au pire aussi permissif qu'avant,
jamais plus destructeur**. Les colonnes orphelines sont inertes : le code
antérieur ne les connaît pas et ne les lit pas.

Un nettoyage définitif reste possible plus tard, sur décision écrite, après
export et sauvegarde vérifiée. Il n'est volontairement pas fourni ici.

## 4. Exécution

```bash
# 1. Sauvegarder AVANT le retour arrière — l'état actuel a de la valeur
#    (Supabase → Database → Backups, ou pg_dump)

# 2. Relever les comptages de référence
```
```sql
select 'achats' t, count(*) from public.achats
union all select 'avances', count(*) from public.avances
union all select 'sacs_mouvements', count(*) from public.sacs_mouvements
union all select 'n1_audit', count(*) from public.n1_audit
union all select 'n1_cycles', count(*) from public.n1_cycles;
```
```
# 3. Exécuter ROLLBACK_niveau1.sql en entier, dans le SQL Editor
# 4. Contrôler (§5)
# 5. Rejouer le smoke test de production
#    PRODUCTION_URL=… node .github/scripts/smoke-production.mjs
```

## 5. Contrôles après retour arrière — tous obligatoires

```sql
-- 1. Plus aucun trigger Niveau 1 (résultat attendu : 0 ligne)
select tgname, relname from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where tgname like 'trg_n1%' and not tgisinternal;

-- 2. Politiques d'origine rétablies : les deux doivent porter est_bm()
select tablename, policyname, qual from pg_policies
where schemaname='public' and tablename in ('achats','avances') and cmd='UPDATE';

-- 3. Aucune donnée perdue : comparer aux comptages de l'étape 2
select 'achats' t, count(*) from public.achats
union all select 'avances', count(*) from public.avances
union all select 'sacs_mouvements', count(*) from public.sacs_mouvements
union all select 'n1_audit', count(*) from public.n1_audit;
```

Si un comptage a diminué, **arrêter immédiatement** et restaurer la sauvegarde
prise à l'étape 1.

## 6. Retour arrière partiel

Les migrations sont indépendantes dans leur écriture mais **dépendantes dans leur
ordre** : 03 utilise les fonctions de 01, 06 utilise les tables de 03 et 04.

Un retour arrière partiel n'est donc sûr que dans l'ordre **décroissant**, et
seulement pour les migrations situées en fin de chaîne :

| Retirer | Sans risque ? |
|---|---|
| 09 (papier) seul | ✅ |
| 08 (synchronisation) seul | ✅ |
| 07 (anomalies) seul | ⚠ 09 lève des anomalies — retirer 09 d'abord |
| 06 (réconciliation) seul | ⚠ 07 lit les lignes d'écart — retirer 07 d'abord |
| 05, 04, 03, 02, 01 | ❌ Retirer tout le Niveau 1 |

Aucun script de retour arrière partiel n'est fourni : le risque d'un état
intermédiaire incohérent — verrous levés mais règles à moitié actives — dépasse
le bénéfice.

## 7. Après un retour arrière

1. **Suspendre les opérations financières.** Sans les verrous, chaque avance et
   chaque achat non contrôlés créent une exposition non mesurée.
2. Documenter la cause dans `docs/niveau1/13_ANGLES_MORTS.md`.
3. Corriger sur le projet de recette, jamais directement en production.
4. Reprendre le guide de migration au jalon 3 (pré-contrôle).

Le journal `n1_audit` reste intact après le retour arrière : il constitue la
pièce d'analyse la plus utile pour comprendre ce qui a conduit à reculer.

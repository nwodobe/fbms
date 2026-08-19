# Assistant IA AFLP — schéma Supabase, politiques RLS et confidentialité

**15 août 2026 · migration `docs/migrations/aflp_ia_journal_20260815.sql`**

> **La migration n'est appliquée sur aucun projet Supabase.**
> `supabase/**` est interdit à toute modification automatique (CLAUDE.md §3) et
> `modifying-a-hosted-supabase-project` figure parmi les actions interdites
> d'`agent-policy.yml`. Elle a en revanche été **réellement exécutée sur
> PostgreSQL** par `.github/agent-tests/aflp-ia-journal-rls.mjs` : 43 contrôles,
> 43 conformes.

---

## 1. Six tables, un schéma interne, une vue

| Objet | Rôle |
|---|---|
| `public.aflp_ia_questions` | Journal des questions, en écriture unique |
| `public.aflp_ia_feedback` | Retours utilisateurs et corrections de revue |
| `public.aflp_ia_catalogue_versions` | Cycle de vie des versions du catalogue |
| `public.aflp_ia_intentions` | Intentions d'une version |
| `public.aflp_ia_formulations` | Formulations d'une version |
| `public.aflp_ia_audit` | Audit des modifications du catalogue, append-only |
| `aflp_ia_interne` | Schéma **non exposé**, une seule fonction (§6) |
| `public.aflp_ia_metriques` | Vue de mesure, `security_invoker` |

**Aucune colonne n'est ajoutée à `achats`, `avances`, `reconciliations` ou
`sacs_mouvements`.** Une question posée n'est pas un fait de gestion, et le
journal de l'assistant ne doit pas pouvoir peser sur une transaction.

---

## 2. `aflp_ia_questions` — le journal

Colonnes principales : `cle_idempotence` (unique), `user_id`, `user_role`,
`question_raw`, `question_normalized`, `detected_intent`, `detected_scope_type`,
`detected_scope_id`, `detected_period`, `confidence`, `result_status`,
`answer_type`, `answer_summary`, `data_reference_date`, `engine_version`,
`catalog_version`, `language_layer_used`, `latency_ms`, `error_code`, `origine`.

### `cle_idempotence` — le pivot du mode hors ligne

Générée par le client **au moment de la question**. La file locale rejoue ses
envois tant qu'elle n'a pas d'accusé de réception ; c'est cette clé — et elle
seule — qui empêche qu'une question compte deux fois dans les métriques.

Vérifié : un `insert` avec une clé déjà présente est refusé ; le même `insert`
avec `on conflict do nothing` passe **sans créer de doublon**.

### Écriture unique, imposée par un déclencheur

`aflp_ia_q_no_update` refuse tout `UPDATE`.

Au niveau du **déclencheur** et pas seulement de la RLS : la RLS ne s'applique ni
au propriétaire de la table ni à `service_role`. Vérifié dans les deux
positions — l'auteur ne modifie rien, et **le propriétaire de la base non plus**.

Une mesure de compréhension calculée sur un journal réécriturable ne mesure rien.

### Contraintes de taille

`question_raw` entre 1 et 500 caractères, `answer_summary` au plus 500. Le
caviardage client est une réduction de risque ; ces contraintes en sont le second
garde-fou, côté serveur.

---

## 3. Politiques RLS, table par table

### `aflp_ia_questions`

| Politique | Opération | Prédicat |
|---|---|---|
| `aflp_ia_q_sel_self` | SELECT | `est_actif() and user_id = auth.uid()` |
| `aflp_ia_q_sel_revue` | SELECT | `peut_editer_config()` |
| `aflp_ia_q_ins` | INSERT | `est_actif() and user_id = auth.uid()` |
| — | UPDATE / DELETE | **aucune politique** |

Chacun lit ses propres questions ; les rôles de supervision lisent tout. On
journalise pour soi et seulement pour soi.

### `aflp_ia_feedback`

| Politique | Opération | Prédicat |
|---|---|---|
| `aflp_ia_fb_sel_self` | SELECT | `est_actif() and auteur_uid = auth.uid()` |
| `aflp_ia_fb_sel_revue` | SELECT | `peut_editer_config()` |
| `aflp_ia_fb_ins` | INSERT | `est_actif() and auteur_uid = auth.uid() and approval_status = 'en_attente' and reviewed_by is null` |
| `aflp_ia_fb_upd` | UPDATE | `USING peut_editer_config()` · `WITH CHECK peut_editer_config() and reviewed_by = auth.uid()` |

Tout profil actif peut signaler une réponse fausse — c'est le seul moyen de
savoir qu'elle l'était. Mais il ne peut le faire qu'en son nom, et **il ne peut
pas valider son propre signalement**. Le validateur se nomme, et ne peut pas se
nommer à la place d'un autre.

### `aflp_ia_catalogue_versions`

| Politique | Opération | Prédicat |
|---|---|---|
| `aflp_ia_ver_sel` | SELECT | `est_actif()` |
| `aflp_ia_ver_ins` | INSERT | `peut_editer_config() and statut = 'brouillon' and cree_par = auth.uid()` |
| `aflp_ia_ver_upd` | UPDATE | `USING est_bm()` · `WITH CHECK est_bm()` |

Une version **naît toujours en brouillon**. Publier est réservé au Branch
Manager. Vérifié : un superviseur qui tente de publier modifie **zéro ligne**.

### `aflp_ia_intentions` et `aflp_ia_formulations`

SELECT : `est_actif()`. INSERT / UPDATE : `peut_editer_config()`.
DELETE : `est_bm()`. Toutes les politiques UPDATE portent `USING` **et**
`WITH CHECK`.

### `aflp_ia_audit`

SELECT : `peut_editer_config()`. **Aucune politique INSERT**, et c'est
volontaire : si les utilisateurs pouvaient écrire dans l'audit, celui-ci ne
prouverait plus rien.

---

## 4. Les déclencheurs, et ce qu'ils rendent impossible

| Déclencheur | Empêche |
|---|---|
| `aflp_ia_q_no_update` | Réécrire une question, y compris depuis l'éditeur SQL |
| `aflp_ia_int_fige` / `aflp_ia_form_fige` | Modifier ou supprimer une intention ou une formulation d'une version **publiée** |
| `aflp_ia_ver_transition` | Faire redevenir un brouillon une version publiée ; réactiver une version retirée |
| `aflp_ia_int_audit` / `aflp_ia_form_audit` | Modifier le catalogue sans laisser de trace |
| `aflp_ia_audit_no_update` | Réécrire l'audit |

### La règle qui force le versionnement

Sans `aflp_ia_form_fige`, « corriger une formulation » et « publier une nouvelle
version » seraient le même geste. La version journalisée avec chaque question ne
voudrait plus rien dire, et « pourquoi l'assistant a-t-il répondu cela le
12 mars ? » deviendrait sans réponse.

---

## 5. Droits explicites — et pourquoi ils ne sont pas décoratifs

Le pré-contrôle du 14 août 2026 sur la base réelle a montré que `DELETE` et
`TRUNCATE` étaient accordés à `anon` et `authenticated` sur les tables sensibles.
Ce n'est pas exploitable via PostgREST — l'API n'expose pas `TRUNCATE` — mais on
ne construit pas une table de journal en comptant là-dessus.

```sql
revoke all on public.aflp_ia_questions from anon;          -- et les 5 autres
revoke update, delete, truncate on public.aflp_ia_questions from authenticated;
revoke insert on public.aflp_ia_audit from authenticated;
revoke delete on public.aflp_ia_feedback from authenticated;
```

Le projet porte aussi `alter default privileges … grant all on tables to
authenticated` : une table neuve naît donc avec **tous** les privilèges accordés.
Les politiques RLS suffisent à filtrer les lignes, mais un privilège non révoqué
se combine mal avec une politique ajoutée par erreur plus tard.

---

## 6. Le seul `SECURITY DEFINER`, et sa justification

### Le défaut trouvé par exécution

La première version du déclencheur d'audit était une fonction plpgsql ordinaire.
Elle échouait :

```
new row violates row-level security policy for table "aflp_ia_audit"
```

Une fonction de déclencheur s'exécute avec les droits de **l'utilisateur** qui a
déclenché l'écriture, pas du propriétaire de la fonction. Comme `aflp_ia_audit`
n'ouvre aucune politique INSERT, toute modification du catalogue devenait
impossible.

**Ce défaut n'était pas visible à la lecture du script.**

### Les quatre précautions appliquées

```sql
create schema if not exists aflp_ia_interne;
revoke all on schema aflp_ia_interne from public;

create or replace function aflp_ia_interne.auditer()
returns trigger language plpgsql
security definer
set search_path = public, pg_temp
as $$ … $$;

revoke all on function aflp_ia_interne.auditer() from public;
revoke all on function aflp_ia_interne.auditer() from anon;
revoke all on function aflp_ia_interne.auditer() from authenticated;
```

1. **Schéma non exposé** — `aflp_ia_interne` n'est pas dans *Exposed schemas*.
2. **`EXECUTE` révoqué** à `PUBLIC`, `anon` et `authenticated`. Un déclencheur
   n'a pas besoin de ce droit pour s'exécuter ; un appelant direct, si.
3. **`search_path` figé** — pas de détournement par un schéma temporaire.
4. **Périmètre minimal** — elle n'écrit que dans `aflp_ia_audit`, et y inscrit
   `auth.uid()`. Elle ne peut rien falsifier d'autre que l'horodatage.

> **À vérifier à la main après application :** Supabase → *Settings → API →
> Exposed schemas* ne doit contenir que `public` et `graphql_public`.
> Cette vérification ne peut pas se faire en SQL : le réglage vit dans la
> configuration PostgREST.

---

## 7. Confidentialité et rétention

### Minimisation, en trois couches

1. **Caviardage côté client**, avant tout envoi
   (`AFLP_IA_JOURNAL.caviarder`) : adresses électroniques, numéros de téléphone
   ivoiriens, suites de six chiffres ou plus. « 7 jours », « GBEKE 1 » et
   « 3000 MT » survivent.
2. **Bornes serveur** : `question_raw` ≤ 500 caractères, `answer_summary` ≤ 500.
3. **Aucune donnée transactionnelle** : le journal ne porte que la question et
   son interprétation, jamais le détail d'un achat ou d'une avance.

### Rétention configurable

Paramètre `aflp_ia_retention_jours` dans `parametres_calcul`, **180 jours** par
défaut.

```sql
delete from public.aflp_ia_questions
where created_at < now() - (
  coalesce((select valeur from public.parametres_calcul
            where cle = 'aflp_ia_retention_jours'), '180')::int * interval '1 day');
```

Les retours suivent par `on delete cascade`.
**L'audit du catalogue n'est jamais purgé** : il porte la traçabilité des
décisions.

La purge n'est **pas** une fonction appelable : c'est une commande
d'administration, exécutée depuis l'éditeur SQL ou par une tâche planifiée. En
faire une fonction ouverte à PostgREST donnerait au navigateur le moyen
d'effacer les preuves.

---

## 8. Ce que le banc PGlite prouve — et ce qu'il ne prouve pas

**43 contrôles, 43 conformes**, sur PostgreSQL réel compilé en WebAssembly, sans
Docker ni droits administrateur (tous deux indisponibles sur ce poste).

### Prouvé

Application de la migration sur base neuve · rejeu sans erreur · RLS active sur
les six tables · refus complet du rôle `anon` · cloisonnement par rôle ·
écriture unique du journal (auteur **et** propriétaire) · idempotence · workflow
de validation des retours · réservation de la publication au Branch Manager ·
figement du catalogue publié · audit alimenté et non réécriturable ·
`security_invoker` de la vue · exécution du script de contrôle livré.

### Non prouvé

- **PostgREST.** Un droit peut se comporter différemment via l'API REST.
  Le script `verify` livré doit être exécuté sur la vraie base.
- **L'état réel de la base de production.** Le pré-contrôle du 14 août a montré
  que le dépôt n'est pas la source de vérité de cette base.
- **La version exacte de PostgreSQL** : 17.6 en production, 18.x ici. Aucune
  fonctionnalité employée n'est postérieure à PostgreSQL 15.
- **La concurrence.** PGlite est mono-connexion.

### Le piège qui a failli faire passer quatre contrôles pour bons

PostgreSQL **ne lève pas d'erreur** quand une politique RLS masque les lignes
visées par un `UPDATE` : il n'en modifie aucune. Quatre contrôles affichaient
« conforme » alors qu'ils attendaient une exception qui ne survenait jamais.

Ils vérifient désormais que **zéro ligne** a été modifiée. Sans cette correction,
quatre propriétés de sécurité auraient été déclarées tenues sans l'être.

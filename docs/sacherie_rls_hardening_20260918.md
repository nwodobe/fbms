# Sacherie AFLP — durcissement RLS, inventaires périodiques, journal serveur

Date : 18 septembre 2026
Branche : `feat/sacherie-security-inventory-journal`
Périmètre : `FIELD BUYING → SACHERIE AFLP`
Registre canonique inchangé : `public.rcn_jute_movements`

---

## 1. État initial constaté

L'audit a été fait **en base**, pas dans la documentation. Chaque point du
constat P0 du 11/08/2026 a été rejoué.

| Point documenté le 11/08/2026 | État réel au 18/09/2026 |
|---|---|
| Deux policies INSERT sur `sacs_mouvements` (`sacs_ins` + `sacs_mouvements_ins`) | **DÉJÀ CORRIGÉ** — `sacs_mouvements_ins` n'existe plus. Une seule policy permissive INSERT subsiste. |
| `DOTATION_RT` insérable directement | **DÉJÀ CORRIGÉ** — refusé deux fois : par le `WITH CHECK` de `sacs_ins` (`type <> 'DOTATION_RT'`) et, en amont, par le trigger `trg_sacherie_guard_mouvement` qui exige une `bag_movement_requests` APPROVED, non expirée et non consommée. |
| Helpers internes exécutables par `anon`/`authenticated` | **DÉJÀ CORRIGÉ** — `sacherie_ct_assert_location_access`, `sacherie_ct_project_mouvement`, `sacherie_guard_mouvement` et consorts portent `postgres=X \| service_role=X` uniquement. |
| — | **À CORRIGER (nouveau)** — la porte **UPDATE**. |
| — | **À CORRIGER (nouveau)** — journal borné à 300 lignes côté navigateur. |
| — | **À CORRIGER (nouveau)** — KPI « Inventaires à faire » calculé par `nombre de locations − nombre de lignes d'inventaire`. |

### La faille réellement présente

`sacs_mouvements_upd` (PERMISSIVE, UPDATE) autorise les cinq rôles de
`peut_editer_config()` — Branch Manager, Assistant Branch Manager, Head of
Field, Procurement Officer, Supervisor — à modifier **toutes** les colonnes.
Le trigger de garde ne couvrait que l'INSERT.

Reproduit en transaction annulée sur la base de production :

| Test | Avant correctif | Après correctif |
|---|---|---|
| BM : `update sacs_mouvements set type='DOTATION_RT'` | **réussit**, la ligne devient une dotation | refusé — `Requalification en DOTATION_RT interdite` |
| Supervisor : même opération | **réussit** | refusé |
| BM : `update … set quantite = 80` (était 50) | **réussit** | refusé — `Colonne quantite non modifiable` |
| Registre canonique après ce UPDATE | reste `AFLP_RETOUR_RT`, qty 50 : **divergence silencieuse** | divergence impossible : les colonnes projetées sont figées |

Le pont `trg_sacherie_ct_bridge` est `AFTER INSERT` uniquement, et sa
projection est `on conflict (event_key) do nothing`. Un UPDATE n'est donc
jamais rejoué : la table historique et `rcn_jute_movements` divergeaient
sans aucune trace.

---

## 2. Correctif appliqué — policies avant / après

### Avant

| Policy | Commande | Type | Expression |
|---|---|---|---|
| `sacs_ins` | INSERT | PERMISSIVE | `est_actif() AND created_by = auth.uid() AND type <> 'DOTATION_RT'` |
| `sacs_sel` | SELECT | PERMISSIVE | `est_actif()` |
| `sacs_mouvements_upd` | UPDATE | PERMISSIVE | `peut_editer_config()` |
| *(aucune)* | DELETE | — | refus « par absence » |

### Après

| Policy | Commande | Type | Expression |
|---|---|---|---|
| `sacs_ins` | INSERT | PERMISSIVE | *inchangée* |
| **`sacs_mouvements_dotation_insert_guard`** | INSERT | **RESTRICTIVE** | `type IS DISTINCT FROM 'DOTATION_RT'` |
| `sacs_sel` | SELECT | PERMISSIVE | *inchangée* |
| `sacs_mouvements_upd` | UPDATE | PERMISSIVE | *inchangée* |
| **`sacs_mouvements_delete_guard`** | DELETE | **RESTRICTIVE** | `false` |

Plus deux triggers : `trg_sacherie_guard_mouvement_update` (immuabilité
comptable) et `trg_sacherie_guard_mouvement_delete` (filet de sécurité).

**Pourquoi RESTRICTIVE.** PostgreSQL combine les policies permissives par
`OR` : c'est précisément ce qui rendait le P0 fragile. Les policies
restrictives se combinent par `AND`. L'interdiction de `DOTATION_RT` en
écriture directe survit donc à l'ajout futur de n'importe quelle policy
permissive, y compris une policy trop large écrite par erreur.

**Pourquoi un trigger pour l'UPDATE.** Une policy RLS ne peut pas comparer
`OLD` et `NEW`. Un `WITH CHECK (type <> 'DOTATION_RT')` sur l'UPDATE aurait
aussi bloqué l'annotation légitime d'une dotation existante. Le trigger
distingue « devenir une dotation » (interdit) de « rester une dotation »
(autorisé).

**Colonnes figées** : `local_id`, `date`, `type`, `source`, `destination`,
`cluster`, `rt_id`, `rt_nom`, `producteur_id`, `producteur_nom`,
`quantite`, `created_by`, `created_at`, `request_id`, `bag_movement_code`,
`approved_qty`, `executed_qty`, `bag_state`.
**Colonnes restées modifiables** : `observation`, `document_url`,
`business_status`, `lot_id`, `issued_by/at`, `received_by/at`,
`correction_of`, `village_id/nom`, `producteur_code`, `created_by_nom`.

Une correction se fait par **contre-mouvement** : la colonne
`correction_of` existait déjà et n'était pas utilisée.

---

## 3. Tests exécutés — CAS A à E

Batterie SQL jouée contre la **base de production**, à l'intérieur d'un
`begin; … rollback;` : les vraies policies, les vrais triggers et les
vraies contraintes sont exercés, rien n'est écrit.

| Cas | Scénario | Attendu | Obtenu |
|---|---|---|---|
| **A** | Agent actif : `INSERT` direct `DOTATION_RT` | REFUSÉ | REFUSÉ (`Approval BM requis : request_id absent`) |
| **A** | Branch Manager : `INSERT` direct `DOTATION_RT` | REFUSÉ | REFUSÉ |
| **B** | Rôle non habilité : RPC `sacherie_creer_demande` | REFUSÉ | REFUSÉ (`Droit insuffisant pour créer une demande`) |
| **C** | Flux légitimes `USINE_CLUSTER`, `RETOUR_RT`, `RETOUR_PROD`, `DISTRIBUTION`, `ENLEVEMENT`, `DECHIRE_RT` | SUCCÈS | SUCCÈS, 6 projections canoniques créées |
| **D** | Même `local_id` rejoué (`upsert` terrain) | 1 seul mouvement | 1 seul mouvement |
| **E** | `RETOUR_RT` de 99 999 sacs | REFUSÉ | REFUSÉ (`Stock sacs insuffisant. Disponible: 82`) |
| — | UPDATE → `DOTATION_RT` (BM puis Supervisor) | REFUSÉ | REFUSÉ |
| — | UPDATE quantité, `rt_id` | REFUSÉ | REFUSÉ |
| — | UPDATE `observation` | SUCCÈS | SUCCÈS |
| — | DELETE | ligne préservée | ligne préservée |

### Précision honnête sur le DELETE

Pour un rôle `authenticated`, la policy restrictive **filtre la ligne avant
que le trigger ne s'exécute**. La commande ne lève donc aucune erreur : elle
porte sur zéro ligne et la donnée reste intacte. Le trigger
`trg_sacherie_guard_mouvement_delete` n'est pas le refus visible par le
terrain ; il couvre les chemins qui ne passent pas par la RLS (fonction
`SECURITY DEFINER`, rôle `BYPASSRLS`, tâche de maintenance), où une
suppression silencieuse serait réellement destructrice.

---

## 4. Inventaires périodiques

**Fréquence retenue** : 7 jours, **globale et configurable**, stockée dans
la table de paramètres sacherie **déjà existante** `rcn_jute_settings`
(colonne `inventory_frequency_days`, bornée 1–90, modifiable par le Branch
Manager via la RLS existante de cette table).

**Formule.** Les seuils dérivent de la fréquence `f`, ils ne sont codés
nulle part ailleurs :

```
jours = date du jour − date du dernier comptage
  aucun comptage      → JAMAIS INVENTORIÉ
  jours < f           → À JOUR
  f ≤ jours < 2f      → À FAIRE
  jours ≥ 2f          → EN RETARD
```

Avec `f = 7` : 0–6 à jour, 7–13 à faire, 14+ en retard. Changer `f` à 10
déplace automatiquement les deux seuils à 10 et 20.

**Fréquence par type d'emplacement** : le modèle est prêt
(`rcn_jute_inventory_frequencies`, clé = `scope_type`) mais la table est
**vide au déploiement**. Aucune valeur métier différenciée n'a été inventée.
Tant qu'elle est vide, la fréquence globale s'applique partout.

**Calcul serveur** : `public.sacherie_ct_inventaires_dus(p_scope, p_code,
p_pertinents_seulement)`, `SECURITY DEFINER`, périmètre appliqué en interne,
`EXECUTE` accordé explicitement à `authenticated` et retiré à `anon`. La
fonction **réutilise la vue existante** `sacherie_ct_latest_inventory` :
aucun second moteur d'inventaire.

**Emplacements « à enjeu »** : par défaut la fonction ne remonte que les
emplacements qui portent du stock, qui ont déjà été comptés, ou qui portent
un HOLD. Sans ce filtre, les 20 emplacements d'acteurs LBA à zéro sac
noieraient le signal. Passer `p_pertinents_seulement => false` donne la
liste exhaustive des emplacements actifs.

**Cas de test vérifiés** (données synthétiques, transaction annulée) :

| Cas | Dernier comptage | Statut obtenu |
|---|---|---|
| A | J−1 | À JOUR |
| B | J−7 | À FAIRE |
| C | J−15 | EN RETARD |
| D | aucun | JAMAIS INVENTORIÉ |
| E | J−2 avec écart −3 | À JOUR + HOLD |
| F | J−20 avec écart −5 | EN RETARD + HOLD |

Les deux dimensions — **fréquence** et **anomalie** — sont bien montrées
séparément.

**La règle HOLD est intacte.** Un écart d'inventaire pose un HOLD et ne
touche jamais le stock. Vérifié : théorique 200, compté 190, statut HOLD,
stock resté à 200.

---

## 5. Journal : recherche et pagination serveur

**Architecture** : `public.sacherie_search_movements(...)`,
`SECURITY DEFINER`, périmètre contrôlé en interne via
`private.sacherie_ct_perimetre()` — la même définition que celle utilisée
par les inventaires, donc une seule règle de périmètre dans toute la
sacherie. Le journal est restreint au grand livre `INTERNE` : il n'expose
jamais le grand livre fournisseur.

**Pagination par curseur** sur `(movement_at DESC, id DESC)`, pas d'`OFFSET`.
Le client renvoie le couple de la dernière ligne reçue dans
`p_cursor_date` / `p_cursor_id`. `p_limit` est borné à 100 **côté serveur**.

**Indexes ajoutés : deux, chacun justifié.**

| Index | Justification | Taille (40 000 mouvements) |
|---|---|---|
| `idx_rcn_jute_mv_journal (movement_at desc, id desc) where ledger='INTERNE'` | sert exactement le tri du curseur ; sans lui, chaque page profonde retrie la table | 1,6 Mo |
| `idx_rcn_jute_mv_recherche` GIN `gin_trgm_ops` sur une expression unique concaténant les 9 colonnes recherchables, `where ledger='INTERNE'` | un seul index au lieu de neuf ; btree n'accélère pas `LIKE '%…%'` | 6,1 Mo |

`pg_trgm` est installée. `unaccent`, déjà présente, n'est **pas** `IMMUTABLE`
et ne peut donc pas entrer dans un index : la recherche se fait en
minuscules sans dépliage d'accents, ce qui est sans effet sur les
identifiants recherchés (`BAG-…`, `rt_…`, codes d'emplacement).

**Performances mesurées** sur un jeu de 40 012 mouvements :

| Scénario | Temps |
|---|---|
| Première page (50 lignes) | 21,6 ms |
| Recherche d'une référence du tout début de campagne | 5,5 ms |
| Page profonde (curseur au 30 000ᵉ mouvement) | **3,1 ms** |
| Filtre RT | 1,0 ms |
| Recherche texte « beoumi » (10 000 correspondances) | 39,6 ms |
| Filtre plage de dates | 3,0 ms |
| `p_limit = 5000` | ramené à 100, 0,7 ms |

Le coût d'une page profonde est **constant** : c'est le gain réel du
curseur sur l'`OFFSET`.

**Stabilité de la pagination** — trois pages consécutives, avec un
mouvement inséré entre la page 2 et la page 3 :

| Contrôle | Résultat |
|---|---|
| Lignes totales sur 3 pages | 150 |
| Identifiants distincts | 150 — aucun doublon |
| Le mouvement inséré pendant la navigation apparaît-il ? | non |
| Lignes sautées | aucune |

**Périmètre** :

| Acteur | Résultat |
|---|---|
| Unit Head cluster BEOUMI | ne voit que BEOUMI |
| Unit Head BEOUMI filtrant explicitement sur DIABO | 0 ligne |
| Agent Recenseur (hors chaîne sacherie) | 0 ligne |

**Panne du journal** : l'écran affiche « Journal momentanément
indisponible », le motif technique et un bouton Réessayer. Il ne fait jamais
croire qu'aucun mouvement n'existe, et les autres écrans Sacherie restent
fonctionnels.

---

## 6. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `supabase/20260918_sacherie_rls_hardening.sql` | nouveau |
| `supabase/20260918_sacherie_inventory_periodicity.sql` | nouveau |
| `supabase/20260918_sacherie_movement_search.sql` | nouveau |
| `supabase/20260917_sacherie_grant_execute_ct_location.sql` | nouveau — versionne un correctif appliqué en base le 17/09 |
| `operations/sacherie-operational-p1.js` | `renderHistory()` réécrit : recherche et pagination serveur |
| `operations/field-buying.js` | KPI inventaires honnête, tableau de périodicité, `rpcq()`, `bagPanne()`, exceptions inventaires, `openBagControl(mode, lieu)` |
| `operations/operations-v2.css` | styles filtres avancés et pied de pagination |
| `operations/field-buying.html` | cache-busting `?v=20260918-sacherie-2` |
| `tests/sacherie-rls-dotation-rt.mjs` | nouveau |
| `tests/sacherie-inventaires-periodicite.mjs` | nouveau |
| `tests/sacherie-journal-recherche.mjs` | nouveau |
| `tests/sacherie-operational-p1-static.mjs` | assertion `limit(300)` inversée |
| `.github/workflows/operations-suite-pr.yml` | 3 tests câblés en CI |

---

## 7. Risques résiduels

1. **La couche physique reste réservée au Branch Manager.**
   `sacherie_ct_assert_location_access` et
   `private.sacherie_ct_perimetre()` lisent `profils.fonction_operationnelle`,
   colonne qu'aucun écran n'alimente et qui est `NULL` sur les trois comptes
   actifs. Les nouveaux écrans héritent donc de cette limite : pour tout
   utilisateur autre que le Branch Manager, le tableau des inventaires et le
   journal sont **vides**. Ce n'est pas une régression introduite ici : la
   migration reproduit volontairement la règle existante à l'identique
   plutôt que d'élargir un droit hors du périmètre demandé. La correction
   appartient à un chantier « rôles » dédié.

2. **Le périmètre du journal s'élargit par emplacement.** Un mouvement dont
   l'origine ou la destination appartient au cluster de l'utilisateur lui
   est visible, même si la colonne `cluster` du mouvement pointe ailleurs.
   C'est voulu — un transfert entrant dans votre magasin vous concerne —
   mais c'est plus large qu'un filtre sur la seule colonne `cluster`.

3. **`sacs_mouvements_upd` reste PERMISSIVE.** Le trigger d'immuabilité
   protège les colonnes comptables, mais si une policy `UPDATE` permissive
   plus large était ajoutée demain, seules les colonnes d'annotation
   s'ouvriraient. Le risque est borné, pas nul.

4. **Recherche sans dépliage d'accents.** « Beoumi » et « Béoumi » ne se
   trouvent pas mutuellement dans la recherche plein texte. Les noms
   d'emplacement en base sont normalisés sans accent, l'impact est
   théorique, mais il existe pour les références saisies à la main.

5. **Index de recherche à 6 Mo pour 40 000 mouvements.** Sur une campagne à
   500 000 mouvements, compter environ 75 Mo. Acceptable, à surveiller.

6. **Vérification navigateur partielle.** Les écrans ont été vérifiés avec
   le harnais de tolérance aux pannes et les assertions statiques. Une
   recette visuelle desktop / tablette / mobile avec un compte réel reste à
   faire.

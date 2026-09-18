# Sacherie AFLP — Lot 1 : identité, rôles, périmètres

Date : 18 septembre 2026 · Branche : `fix/sacherie-identity-access-hardening`
Commit de départ : `3558695` (`main`, merge PR #226)
Statut : **rien n'est déployé en production.** Production consultée en lecture seule.

---

## 1. État initial effectivement constaté

Relevé en lecture seule sur la production (`jmbdgpdthzpszfnddwzi`) le 18/09/2026.

| Élément | Constat |
|---|---|
| Comptes | **3 profils** : Branch Manager, Supervisor, Zonal Head. Aucun Unit Head, aucun magasinier. `fonction_operationnelle` = NULL sur les 3, `cluster` = NULL sur les 3 |
| `profils_role_check` | 19 valeurs canoniques (dont `Storekeeper`, `Unit Head`, `Field Buying Operations Officer`, `Zonal Head`) |
| Écran « Comptes et rôles » | `shared/admin.html`, liste issue de `shared/aflp-access.js` (libellés AFLP) |
| Fonction `admin-create-user` | **non déployée** (absente de la liste des Edge Functions) : « Créer un accès » échoue en 404 |
| Migrations du 18/09 | 5 appliquées en base (07:10 → 07:57). 4 versionnées sur la branche **non fusionnée** `feat/sacherie-security-inventory-journal`, 1 (`sacherie_rpc_revoke_anon`) versionnée nulle part |
| `ops_bag_requests` | table vide. Le formulaire « Nouvelle demande » ne peut créer aucune demande (voir E) |

## 2. Défauts : revalidation et nouveaux constats

| Réf. | Constat | Statut | Preuve |
|---|---|---|---|
| A | `sacherie_ct_assert_location_access` (et `snapshot`, `locations`, `perimetre`, `peut_demander/executer_sacherie`, `peut_lire_demande`, `creer_demande`, `ops_has_role`) décident sur `fonction_operationnelle`, NULL partout | **CONFIRMÉ** | tests P01, P12, L01, D03 *avant* : « Accès refusé » / « Droit insuffisant » |
| B | L'écran propose des libellés refusés par `profils_role_check` et omet des rôles reconnus | **CONFIRMÉ** | AV4 (navigateur) : « Warehouse Keeper » → violation de contrainte, message brut ; `Storekeeper`, `Field Buying Operations Officer`, `Unit Head` exact… absents de la liste de création |
| C1 | Portée du Zonal Head : `portee_terrain_globale()` (global) ≠ Sacherie (cluster NULL → tout, mais par effet de bord) | **CONFIRMÉ** (incohérence de source, pas d'excès de droit : l'accès passait par `fonction_operationnelle`, NULL) | P09 *avant* : « Accès Control Tower non autorisé » |
| C2 | Compte sans cluster = écriture sur toutes les localisations | **CONFIRMÉ** | P04 *avant* : compte `Supervisor` + fonction « Warehouse Keeper » sans cluster inventorie Diabo → PASS |
| D | Migration `sacherie_grant_execute_ct_location` appliquée hors dépôt | **PARTIELLEMENT CORRIGÉ** avant ce lot (versionnée sur une branche non fusionnée, contenu réécrit) ; **enregistrée verbatim** ici | `supabase/migrations_appliquees/` |
| D bis | Le commentaire de cette migration affirme que `sacherie_ct_location` « applique ses propres contrôles de rôle et de périmètre » : **faux** (aucun contrôle ; `ON CONFLICT DO UPDATE` réactive/renomme tout emplacement) | **CONFIRMÉ** | P20 *avant* : un Unit Head crée/réactive `AFLP-CL-DIABO` |
| E | **Nouveau** : « Nouvelle demande » n'envoie pas `request_code` (NOT NULL, sans défaut) → aucune demande créable, même par le BM | **CONFIRMÉ** | AV3 (navigateur), W02b *avant* |
| F | **Nouveau** : le front réserve les formulaires Sacherie (demande, inventaire, perte, état) à `ROLES_TERRAIN` (référentiel villages), qui exclut Unit Head et Storekeeper | **CONFIRMÉ** | AV1, AV2 (navigateur) |
| G | **Nouveau** : une demande approuvée est modifiable par UPDATE direct (quantité approuvée, destination, statut `FULLY_RELEASED` sans sortie) | **CONFIRMÉ** | W08, W09, W10 *avant* : 1 ligne modifiée |
| H | **Nouveau** : décision de perte par le déclarant, et par un compte sans profil actif (`v_role <> 'Branch Manager'` avec `v_role` NULL ne lève rien) | **CONFIRMÉ** (déclarant) ; compte inactif : non exploitable dans le jeu d'essai *avant* (déclaration préalable impossible) | L03 *avant* : BM déclare puis décide → succès |
| I | **Nouveau** : auto-revue (initiateur = réviseur) non contrôlée | **CONFIRMÉ** | W04b *avant* |
| J | **Nouveau** : lecture RLS de `rcn_jute_*` réservée aux rôles RCN TRACE : Unit Head, Storekeeper, Zonal Head, FBOO voient des stocks vides | **CONFIRMÉ** | P11 *avant* : 0 ligne |
| K | **Nouveau** : `sacherie_ops_*` exécutables par `anon`/PUBLIC (le corps exige `auth.uid()`) | **CONFIRMÉ** (hygiène, pas d'écriture anonyme) | P21 |
| L | **Nouveau** : le BM peut se désactiver / se rétrograder lui-même ; changements de comptes non journalisés | **CONFIRMÉ** | A06, A10 *avant* |
| RLS legacy | `DOTATION_RT` directe et requalification | **DÉJÀ CORRIGÉ** en production (migration 07:55 du 18/09) ; non-régression prouvée | D01, D02 |

## 3. Matrice des permissions et périmètres retenue

Source unique : `profils.role` + `profils.actif` (quoi), `profils.cluster` / `authority_level='GLOBAL'` / `portee_terrain_globale()` (où). Toutes les fonctions citées sont `SECURITY DEFINER`, appelées avec l'identité JWT.

| Opération | Rôles autorisés | Périmètre | Séparation des tâches | Contrôle serveur |
|---|---|---|---|---|
| Créer une demande (AFLP) | Unit Head, BM (+ GM, PO, LBA PO, FBOO, ZH : inchangé) | cluster du demandeur si portée CLUSTER ; RT et emplacements cohérents avec le cluster | — | RLS `ops_bag_request_insert` + `ops_bag_request_guard` (INSERT) + `sacherie_ct_location_rt` |
| Revue | Zonal Head, BM | global | initiateur ≠ réviseur | `ops_bag_request_guard` |
| Consolider | FBOO, BM | global | — | `ops_bag_request_guard` |
| Approuver | BM | global | initiateur ≠ approbateur ; champs d'approbation modifiables uniquement à cet instant | `ops_bag_request_guard` |
| Enregistrer une sortie | Storekeeper, BM, WM, PO | Storekeeper : cluster de l'emplacement **source** | approbateur ≠ exécutant ; `released_qty`/`*_RELEASED` uniquement via la RPC | `ops_release_bags` |
| Confirmer une réception | Unit Head, FBOO, BM | cluster de la demande | réception jamais diminuée ; motif si écart | `ops_bag_request_guard` |
| Expédier un transfert | Unit Head, Storekeeper, BM | écriture sur l'**origine** | — | `sacherie_ops_create_transfer` |
| Réceptionner un transfert | Unit Head, Storekeeper, BM | écriture sur la **destination** | — | `sacherie_ops_receive_transfer` (inchangée) |
| Retour RT / mouvement réseau | Unit Head, Storekeeper, BM | origine et destination dans le cluster | idempotence par clé | `sacherie_ops_network_move` |
| Inventaire | Unit Head, Storekeeper, BM | emplacement du cluster (emplacements sans cluster : portée globale seulement) | écart ⇒ HOLD + motif | `sacherie_ct_inventorier` |
| Déclarer une perte | Unit Head, Storekeeper, BM | idem | — | `sacherie_ct_declarer_perte` |
| Décider une perte | BM actif | global | déclarant ≠ décideur | `sacherie_ct_decider_perte` |
| Changement d'état | Unit Head, Storekeeper, BM ; REFORME : BM | idem | — | `sacherie_ct_traiter_etat` |
| Dotation RT (circuit V2) | demande : Unit Head/BM ; approbation : BM ; exécution : Storekeeper du cluster / BM | cluster | demandeur ≠ approbateur ≠ exécutant | `sacherie_creer/decider/executer_demande` |
| Lecture Sacherie | BM, Zonal Head, FBOO : global ; Unit Head, Storekeeper : cluster | — | — | RPC + RLS `sacherie_perimetre_read` |
| Administrer comptes | BM actif | — | pas sur son propre compte ; BM/GM non attribuables à l'écran | RLS `profils_*_bm` + `trg_profils_garde_habilitations` + journal |

**Nouvelles permissions signalées** (toutes en LECTURE, aucune écriture nouvelle) : lecture Sacherie globale du FBOO ; lecture RLS périmétrée de `rcn_jute_*` pour Unit Head / Storekeeper / Zonal Head / FBOO ; lecture par le BM du journal `rcn_proc_audit_central` limitée à `table_name='profils'`. **À valider.**

**Non accordé, laissé en décision** : `Assistant Unit Head`, `Warehouse Keeper`, `Logistics Coordinator` ne sont pas des rôles attribuables (absents de la contrainte) ; `Warehouse Manager` n'a aucun accès aux emplacements AFLP (inchangé).

## 4. `role` / `fonction_operationnelle`

Usages relevés : `private.ops_has_role` (policies LBA, enveloppes, `ops_bag_requests`), `peut_demander_sacherie`, `peut_executer_sacherie`, `sacherie_peut_lire_demande` (RLS `bag_movement_requests`), `sacherie_ct_assert_location_access`, `sacherie_ct_snapshot`, `sacherie_ct_locations`, `private.sacherie_ct_perimetre`, `sacherie_creer_demande`, `sacherie_mon_contexte` (affichage), front `shared/anagroci-sacherie-v2.js`. Aucun écran ne l'alimente ; 3/3 comptes à NULL.

| Option | Verdict |
|---|---|
| Synchroniser les deux champs | Rejetée : deux sources d'autorité, divergence inévitable |
| **Converger vers `role`** | **Retenue** : seule valeur contrainte en base, saisie par l'écran, déjà utilisée par le front |
| Fonction organisationnelle distincte | Conservée comme **information** (colonne gardée, renvoyée par `sacherie_mon_contexte`), sans aucun effet sur les droits |

Impact sur l'existant : nul (aucun compte ne portait de fonction). Aucun repli permissif : fonction absente ≠ autorisé.

## 5. Rôles à l'écran et valeurs enregistrées

Référentiel serveur `public.fbms_roles_attribuables()` : les **valeurs** sont extraites de `profils_role_check` (source unique), la fonction n'ajoute que libellé, portée, attribuabilité. L'écran et `admin-create-user` le consomment ; plus aucune liste locale.

| Libellé affiché | Valeur enregistrée | Portée | Attribuable par le BM |
|---|---|---|---|
| Branch Manager / Responsable programme | `Branch Manager` | GLOBAL | Non (procédure administrateur) |
| General Manager | `General Manager` | GLOBAL | Non (supérieur au BM) |
| Chef de Zone (Zonal Head) | `Zonal Head` | GLOBAL | Oui |
| Field Buying Operations Officer | `Field Buying Operations Officer` | GLOBAL (lecture) | Oui |
| Chef d'Unité (Unit Head) | `Unit Head` | CLUSTER (obligatoire) | Oui |
| Magasinier (Storekeeper) | `Storekeeper` | CLUSTER (obligatoire) | Oui |
| Responsable entrepôt usine (Warehouse Manager) | `Warehouse Manager` | hors Sacherie AFLP | Oui |
| 12 autres valeurs de la contrainte | identiques | hors Sacherie AFLP | Oui |

`Magasinier → Storekeeper` : retenu parce que `Storekeeper` est le seul rôle canonique déjà habilité à la sortie dans le circuit `ops_bag_requests`, alors que `Warehouse Manager` porte les droits usine de RCN TRACE. **Pas de synonymie décrétée** avec `Warehouse Manager` ni `Warehouse Keeper` (valeur inexistante). À confirmer métier.

## 6. Comptes sans affectation

`cluster = NULL` ne signifie plus « tout ». Un Unit Head / Storekeeper sans cluster valide : aucune écriture, aucune lecture Sacherie, message « Affectation manquante : aucun cluster valide n'est rattaché à ce compte… » (P03), badge rouge dans Comptes et rôles (N14), aucun emplacement proposé dans le formulaire (N12). Portée globale d'un poste limité : uniquement par `authority_level='GLOBAL'` posé explicitement par le BM (tracé au journal, P05). Valeur de cluster inconnue du référentiel : refusée à l'enregistrement (A07).

## 7. Zonal Head

Décision du 17/09/2026 conservée (`portee_terrain_globale()`). La Sacherie l'applique désormais par cette fonction, plus par l'effet de bord `cluster NULL`. Lecture globale (P09 : 2 clusters), revue autorisée (W05, N02), écriture physique refusée avec le message métier (P08). Aucune restriction par cluster réintroduite.

## 8. Policies et fonctions modifiées

Migrations (ordre) : `20260918a_sacherie_perimetres_permissions.sql`, `20260918b_comptes_roles_habilitations.sql`, `20260918c_sacherie_rls_lecture_perimetre.sql`. Idempotentes (rejouées deux fois dans les tests).

- **Nouvelles fonctions** : `private.sacherie_norm_cluster`, `private.sacherie_contexte`, `private.sacherie_exiger_cluster`, `private.sacherie_peut_lire_cluster`, `private.sacherie_peut_lire_emplacement`, `private.sacherie_portee_lecture`, `public.sacherie_ct_location_rt`, `public.fbms_roles_attribuables`, `private.profils_garde_habilitations`, `private.profils_journaliser` ; séquence `ops_bag_request_seq`.
- **Redéfinies** : `sacherie_ct_assert_location_access`, `private.ops_has_role`, `peut_demander_sacherie`, `peut_executer_sacherie`, `sacherie_peut_lire_demande`, `private.sacherie_ct_perimetre` (contrat conservé pour les RPC du 18/09), `sacherie_ct_locations`, `sacherie_ct_pertes`, `sacherie_ct_snapshot`, `sacherie_ct_decider_perte`, `sacherie_ops_create_transfer`, `ops_bag_request_guard`, `ops_release_bags`, `sacherie_creer_demande`, `sacherie_decider_demande`, `sacherie_executer_demande`.
- **Triggers** : `trg_profils_garde_habilitations` (BEFORE), `trg_profils_journal` (AFTER → `rcn_proc_audit_central`, mécanisme existant).
- **Policies ajoutées** (PERMISSIVE, SELECT) : `sacherie_perimetre_read` sur `rcn_jute_locations/movements/transfers/loss_requests/inventories` ; `rcn_proc_audit_central_read_profils_bm`. **Aucune policy supprimée ni modifiée.** RLS jamais désactivée.
- **Droits** : `sacherie_ct_location` retirée à `authenticated` (helper interne) ; `sacherie_ops_*` retirées à `anon`/PUBLIC ; `sacherie_ops_resolve_cluster_location` interne ; `sacherie_ct_assert_location_access` reste interne (postgres/service_role).
- **Front** : `operations/field-buying.js` (RPC contrôlée, garde Sacherie `guardBag`, miroir de rôles canonique), `operations/field-buying.html` (version de cache), `shared/admin.html` (référentiel serveur, cluster, messages lisibles), `supabase/functions/admin-create-user/index.ts` (profil inséré avec le jeton du BM).

## 9. Migration appliquée hors dépôt

`supabase/migrations_appliquees/20260918071044_sacherie_grant_execute_ct_location.sql` et `…075721_sacherie_rpc_revoke_anon.sql` : copies **verbatim** de `supabase_migrations.schema_migrations`, statut « APPLIQUÉE — NE PAS REJOUER ». Réapplication sans effet (GRANT/REVOKE idempotents). Le GRANT du 07:10 est neutralisé par 20260918a (remplacé par la RPC contrôlée). Les trois autres migrations du 18/09 restent à fusionner via `feat/sacherie-security-inventory-journal`.

## 10–11. Tests

- Serveur : `tests/sql/executer_tests.sh` → `tests/sql/resultats_20260918.md` : **71/71 conformes après**, colonne *avant* montrant chaque faille.
- Navigateur : `tests/navigateur/sacherie-lot1-parcours.mjs` → `tests/navigateur/resultats_20260918.md` : **22/22 conformes** (sessions Unit Head, Zonal Head, FBOO, BM, magasinier, réceptionnaire, magasinier sans affectation, compte nouvellement habilité, compte désactivé ; 390×844, 768×1024, 1440×900 pour la demande et Comptes et rôles). Constat *avant* : `tests/navigateur/sacherie-lot1-avant.mjs`. Captures : `docs/captures/sacherie_lot1_20260918/`.

**Limite de l'environnement** : aucun staging FBMS accessible (le projet `FieldTrack-Staging` appartient à une autre application et n'est pas visible par ce connecteur ; une branche Supabase aurait un coût et ne rejouerait pas les objets créés hors migrations). Tests exécutés sur une **réplique locale PostgreSQL 16** (production : 17.6) dont les 49 fonctions concernées sont prouvées identiques par md5, PostgREST 12 local, GoTrue **émulé**. Non couvert : comportement exact de GoTrue/Supabase 17, Storage, Edge Function (non déployée), autres modules que la Sacherie.

## 12. Déploiement et retour arrière

1. Relecture de la PR ; décision écrite sur les points « À VALIDER » (§13).
2. Sauvegarde / point de restauration Supabase.
3. Appliquer `20260918a`, puis `20260918b`, puis `20260918c` (SQL Editor ou `apply_migration`) ; vérifier `select * from public.fbms_roles_attribuables()` avec le compte BM.
4. **Immédiatement après**, fusionner la PR (le front appelle `sacherie_ct_location_rt`, qui n'existe qu'après 20260918a ; entre les deux, seule la première demande d'un RT sans emplacement échouerait — la table est vide aujourd'hui).
5. Créer les comptes réels (Chefs d'Unité, magasiniers) **avec cluster**, via Supabase Auth puis Comptes et rôles (ou déployer `admin-create-user`).
6. Rejouer `tests/navigateur/sacherie-lot1-parcours.mjs` adapté sur un environnement de test, puis contrôle manuel d'un parcours réel.

Retour arrière, du plus ciblé au plus large — **aucun ne rouvre volontairement une faille** sauf le niveau 3, explicitement signalé :
- Niveau 1 (données) : utilisateur bloqué → corriger rôle/cluster dans Comptes et rôles.
- Niveau 2 (ciblé, sans réouverture) : `drop trigger trg_profils_garde_habilitations on public.profils;` si l'administration est bloquée (la RLS BM reste) ; suppression des policies `sacherie_perimetre_read` en cas de lenteur (restreint la lecture, n'ouvre rien).
- Niveau 3 (complet) : `20260918z_sacherie_lot1_rollback_complet.sql`, restauration exacte des définitions de production (vérifiée : 0 écart md5), exige `-v confirmer_reouverture=oui` et une décision écrite du BM : il **rouvre** les failles listées en tête de fichier.

## 13. Risques résiduels et décisions nécessaires

| # | Sujet | Décision attendue |
|---|---|---|
| 1 | Magasinier = `Storekeeper` | confirmer ; sinon ajouter une valeur canonique dédiée (migration de contrainte) |
| 2 | Assistant Unit Head, Logistics Coordinator | ajouter ou non des valeurs canoniques et leurs droits (non accordés) |
| 3 | Lecture globale FBOO ; lecture du journal profils par le BM | valider |
| 4 | Approbateur ≠ réviseur ; libérateur ≠ réceptionnaire | non imposé (le BM reste possible réviseur de secours) |
| 5 | `authority_level='GLOBAL'` sur un Storekeeper/Unit Head | règle d'usage (qui, quand) |
| 6 | `admin-create-user` non déployée | déployer (secret `SERVICE_ROLE_KEY`) ou créer les comptes dans Supabase Auth |
| 7 | `fbms/index.html` (FBMS > Administration) propose encore les libellés AFLP | hors écran traité ; le serveur refuse désormais toute valeur invalide avec un message clair — correction de cet écran dans un lot dédié |
| 8 | `sacherie_ct_inventaires_dus`, `sacherie_search_movements` (branche non fusionnée) comparent des clusters bruts | le lot fournit l'orthographe du registre via `sacherie_ct_perimetre` ; à reprendre lors de leur fusion |
| 9 | Policies de lecture évaluées par ligne | acceptable aux volumes actuels (< 100 emplacements) ; à surveiller |
| 10 | Interactions futures | transitions RECEIVED/CLOSED : s'appuyer sur le marqueur `fbms.ops_release_bags` et les champs figés ; plafonds d'enveloppe et clôture : utiliser `private.sacherie_contexte()` plutôt qu'un nouveau test de rôle |

## 14. Non déployé en production

Tout : les trois migrations, la RPC `sacherie_ct_location_rt`, le référentiel des rôles, les triggers de comptes, les policies de lecture, le front (`field-buying.js/.html`, `admin.html`), la fonction `admin-create-user`. Aucun compte réel créé ou modifié, aucun mouvement de test en production.

# Dossier de revue humaine · PR #262 et PR #264

Version 1.0 · 25/10/2026 · Préparé pour la relecture technique. **Aucune des deux PR n'est fusionnée.** Elles sont toutes deux en brouillon, avec le label `human-review`, et aucune revue n'est enregistrée.

> Décision du Branch Manager (25/10/2026) : c'est lui qui approuve la PR dans GitHub et qui la fusionne. L'agent ne fusionne pas.
> Le contrôle « Éligibilité à la correction automatique » échoue sur les deux PR. **C'est voulu** : elles touchent des chemins de la liste de refus. Il ne faut ni le contourner, ni modifier la règle.

## 1. Les deux PR en bref

| | PR #262 | PR #264 |
|---|---|---|
| Titre | Android 1.1.0 : APK à jour (#260, #261) et mises à jour Web signées | Régularisation AFLP 2027 : parcelles, accords, Sustainability, hors ligne |
| Branche | `android/aflp-2027-apk-v2` | `aflp/regularisation-sustainability-20261025` |
| Volume | 74 fichiers (dont 44 sous `android/`, 15 de documentation et preuves) | 27 fichiers au commit `48d8ffa` (9 de documentation, 5 SQL sous `supabase/`, 7 de tests) ; ce complément ajoute 3 documents et 2 tests SQL |
| Contrôles CI | requis (structure, pages) : verts · offline-field, operations-static, RT clusters, export : verts · éligibilité : **échec voulu** | requis : verts · offline-field, operations-static, RT clusters : verts · éligibilité : **échec voulu** |
| Chemins sensibles touchés | `shared/auth-gate.js`, `shared/offline-field.js`, `.gitignore` | `sw.js`, `.github/workflows/offline-field-pr.yml`, `supabase/**` (copies et scripts non appliqués) |

## 2. Dépendances (vérifiées le 25/10/2026)

**Techniques.** Les deux PR partent du même commit de `main` (`b8e77c9`). Un seul fichier est commun aux deux : `operations/field-buying.js`.

Fusion simulée dans une copie isolée :

| Ordre | Résultat |
|---|---|
| #262 puis #264 | fusion automatique, **sans conflit** |
| #264 puis #262 | fusion automatique, **sans conflit** |

Contrôles sur l'arbre combiné (#262 + #264) :
- `verifier-html`, `verifier-liens`, `verifier-js` : PASS ;
- `offline-field-static`, `regularisation-aflp-static` : PASS ;
- `offline-field-e2e`, `offline-registre-sustainability-e2e`, `offline-field-multi-user-e2e` : PASS.

**Fonctionnelles.**
1. **Téléphone partagé par plusieurs agents.** Les deux moitiés du correctif sont dans des PR différentes :
   - #262 isole les opérations Field Buying par compte (`shared/offline-field.js`) ;
   - #264 isole le registre (parcelles, Sustainability, inspections) dans `shared/farmer-registry-sync.js`.
   - Tant que les deux ne sont pas publiées, la règle « un téléphone = un agent » reste en vigueur.
2. **APK Android.** L'APK de #262 embarque le code Web **du jour de sa construction**. Les correctifs de #264 n'atteignent l'APK que dans deux cas :
   - par une nouvelle construction de l'APK après fusion ;
   - ou par une mise à jour Web signée, mais ce canal est inactif : la clé de publication n'existe pas.
   - La version Web (navigateur / PWA) les reçoit dès la publication GitHub Pages.
3. **SQL.** Fusionner #264 **n'applique aucun SQL**. Aucun workflow ne déploie `supabase/`.
   - Les deux migrations du 25/10 sont déjà en base.
   - Les deux scripts `PREPARE_*` restent non appliqués tant qu'une autorisation écrite ne les déclenche pas.

## 3. Modifications de sécurité à relire

### PR #262
| Fichier | Changement | Point de contrôle |
|---|---|---|
| `shared/auth-gate.js` | Messages de connexion distincts : hors ligne, email non confirmé, compte désactivé, trop de tentatives, service indisponible | « Compte inexistant » et « mot de passe incorrect » restent volontairement un seul message (pas d'énumération des comptes) : **à confirmer** |
| `shared/auth-gate.js` | La décision d'accès attend le chargement de `aflp-access.js`, avec une attente maximale de 5 s | Après 5 s sans script, la décision repart sur l'ancienne table de rôles : comportement d'avant, pas d'élargissement. Le portail JavaScript ne protège rien seul ; la RLS reste la serrure |
| `shared/auth-gate.js` | Message « session expirée » si un profil a déjà été mis en cache | Ne révèle pas d'information de compte |
| `shared/offline-field.js` | Opérations et caches (bundles) rattachés à l'utilisateur ; un autre compte ne les envoie plus | Les opérations créées **avant** la mise à jour, sans `user_id`, restent envoyables par le compte connecté (choix assumé pour ne pas bloquer une file existante) |
| `.gitignore` | Exception pour `android/update-keys/web-bundle-public.pem` | Clé **publique** uniquement : vérifier qu'aucune clé privée n'est commise |
| `android/…/WebBundleUpdater.java` | Mises à jour Web signées ECDSA P-256, SHA-256 par fichier, anti-rejeu, retour arrière | Canal inactif (pas de clé) ; aucun APK release signé |

### PR #264
| Fichier | Changement | Point de contrôle |
|---|---|---|
| `sw.js` | Hors ligne seulement : si la ressource avec `?v=` est absente du cache, on cherche la même sans paramètre | Le repli ne s'active qu'**en cas d'échec réseau** ; en ligne, le cache-busting reste intact |
| `shared/farmer-registry-sync.js` | Chaque opération du registre porte `user_id` ; la session est relue avant chaque envoi ; les opérations d'un autre compte ne partent pas | Même limite que #262 pour les opérations antérieures sans `user_id` |
| `operations/field-buying.js` | Parcelle sans GPS = `NOT_MAPPED` (fin du refus `DEFERRED`) ; précision GPS conservée ; coordonnées tapées à la main stockées en note, jamais comme point GPS | Aucune donnée GPS inventée |
| `.github/workflows/offline-field-pr.yml` | Exécution dans l'image Playwright épinglée par empreinte (`v1.49.1-noble@sha256:70e367e0…`) | Relecture `.github/` obligatoire ; aucune permission ajoutée |
| `supabase/20261025*.sql` | Copies exactes des deux migrations **déjà appliquées** | Lecture seule pour contrôle |
| `supabase/PREPARE_*.sql` | Correctif des consentements (P0-1), séparation des tâches (P1-1), précision GPS (D-3) | **Non appliqués.** Tests et restauration : §5 |

Contrôle effectué : aucune donnée réelle dans les fichiers de #264. Les tests n'utilisent que des valeurs fictives et des marqueurs `<UUID_…>`.

## 4. Risques

| # | Risque | Gravité | Mesure |
|---|---|---|---|
| R1 | **Service worker en cache** : #264 change `field-buying.js` et trois scripts du registre sans changer leur paramètre `?v=`. Le service worker sert la copie en cache et récupère la nouvelle en arrière-plan : le correctif n'est actif qu'à la **deuxième ouverture en ligne** | Moyenne | Après la fusion des deux PR, PR courte qui incrémente les `?v=` de ces quatre scripts. Elle n'est pas faite dans #264, sinon elle entrerait en conflit avec #262 sur `field-buying.html` (fichier d'une seule ligne) |
| R2 | Un `sw.js` fautif survit au correctif dans les téléphones | Moyenne | Changement limité au cas hors ligne ; ouvrir la page une fois en ligne après publication ; test Android physique (fichier 13) |
| R3 | Opérations hors ligne antérieures sans `user_id` | Faible | Vider les files (synchroniser) **avant** la mise à jour et appliquer « un téléphone = un agent » jusque-là |
| R4 | APK non aligné avec le Web après fusion de #264 | Moyenne | Reconstruire l'APK après les deux fusions ; pas de diffusion d'APK tant qu'il n'existe pas de signature release |
| R5 | `unit-head-enrollment-e2e` modifié par #262 : échec hérité de `field-buying-e2e.mjs`, identique sur `main` (selon #262) | Faible | Non corrigé ici ; à suivre séparément |
| R6 | Aucun essai sur téléphone Android physique | Élevée pour le terrain | **TEST ANDROID PHYSIQUE NON EXÉCUTÉ** ; protocole prêt (fichier 13) |

## 5. Scripts SQL préparés : état vérifié le 25/10/2026

Rejoués contre la base de production, dans des transactions annulées (rien n'est conservé) :

| Test | Résultat |
|---|---|
| `03_droits_matrice_roles.sql` (21 cas, 5 rôles réels) | 21/21 conformes. C0 : le refus actuel est reproduit. C1 à C10 et V1 à V9 donnent les résultats attendus |
| `05_restauration_correctifs_prepares.sql` | Avec les deux correctifs appliqués, la précision est conservée : 6,50 → POINT_CAPTURED, et sans précision → NOT_MAPPED. Après le retour arrière, la politique, la fonction de synchronisation et l'absence du trigger et de la fonction de garde sont **identiques** à l'état de production |
| `06_enrolement_direct_beoumi_brobo_diabo.sql` | Enrôlement du Chef de Zone accepté dans les trois clusters ; Unit Head hors périmètre refusé ; consentement refusé avant P0-1, accepté après |

État de production relu : la politique `farmer_consents_insert` utilise toujours `peut_editer_terrain()`, `trg_farmer_verification_separation` est absent, et la notice est en `PENDING_LEGAL_REVIEW` sans approbation.

## 6. Ordre de fusion recommandé

1. **#262 d'abord.** Elle apporte la moitié Field Buying de l'isolation multi-comptes et l'alignement de l'APK sur #260 et #261.
   - Le relecteur Android vérifie : clé publique seule, `applicationId` inchangé, aucun secret.
2. **#264 ensuite.** Rafraîchir la branche sur `main` (fusion sans conflit, simulée), attendre que les contrôles requis soient verts, puis la relecture humaine de `sw.js`, `.github/` et `supabase/`.
3. **PR de suivi** : incrémenter les `?v=` des scripts modifiés (R1). C'est une PR courte, dans une zone non sensible.
4. **Hors GitHub**, sur autorisation écrite du Branch Manager seulement : appliquer `PREPARE_…consentements…` (P0-1 + P1-1), puis `PREPARE_…precision_gps`, et exécuter les contrôles V de chaque fichier.

L'ordre inverse est techniquement possible : les fusions se font sans conflit. Il laisserait cependant le Web et l'APK désalignés plus longtemps.

## 7. Liste de contrôle du relecteur

- [ ] Lire `10_matrice_correctifs_et_revue.md` et ce fichier.
- [ ] #262 : relire `shared/auth-gate.js` (§3), `shared/offline-field.js`, `.gitignore`, `android/update-keys/`.
- [ ] #264 : relire `sw.js` (repli hors ligne), `shared/farmer-registry-sync.js`, `operations/field-buying.js`, `.github/workflows/offline-field-pr.yml`.
- [ ] Vérifier qu'aucune donnée réelle ni aucun secret ne figure dans les fichiers ajoutés.
- [ ] Approuver dans GitHub (revue enregistrée), sortir du brouillon, fusionner. Pas d'auto-fusion.
- [ ] Après publication : ouvrir FBMS une fois en ligne sur chaque téléphone, puis dérouler la recette Android (fichier 13).

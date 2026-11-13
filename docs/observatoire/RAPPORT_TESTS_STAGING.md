# Observatoire AFLP 2027 — tests rejoués sur le staging fidèle

Exécution serveur : 2026-11-13 17:28 UTC ; navigateur : 2026-11-13T17:28 UTC. Base : PostgreSQL 16 local `fbms_pheno_staging`, construite par `tests/observatoire/staging/construire_staging.sh` à partir du catalogue de PRODUCTION extrait en lecture seule (projet jmbdgpdthzpszfnddwzi, PostgreSQL 17.6). Données 100 % fictives ; aucune donnée personnelle recopiée.

## Fidélité du staging

- 170 objets comparés par empreinte individuelle (93 fonctions : texte source, SECURITY DEFINER, search_path ; 77 politiques RLS et Storage) : **170/170 identiques** à la production avant migration, et toujours identiques après application des 4 migrations Observatoire (test NR-03).
- Écarts connus et assumés : PostgreSQL 16 au lieu de 17.6 ; `auth.uid()` et Storage simulés (mêmes tables, mêmes politiques, sans l'API HTTP) ; colonnes d'identité recréées ; pas de PostgREST. Pourquoi pas une branche Supabase : l'historique de migrations n'est pas rejouable (branche existante en MIGRATIONS_FAILED) et une branche est facturée.

## Synthèse

| Suite | Exécutés | Réussis | Échoués |
|---|---|---|---|
| Serveur (RLS, RPC SECURITY DEFINER, preuves photo, synchronisation, droits par campagne) | 223 | 223 | 0 |
| dont droits par campagne (CMP-01 à CMP-13) | 13 | 13 | 0 |
| Non-régression SQL | 8 | 8 | 0 |
| Cœur JavaScript | 21 | 21 | 0 |
| Navigateur de bout en bout (Service Worker réel, hors ligne, reprise de file) | 60 | 60 | 0 |

Mêmes suites rejouées sur la réplique historique : résultats identiques (223 / 8 / 21 / 60, 0 échec).

## Droits par campagne

| Id | Compte | Action | Attendu | Résultat |
|---|---|---|---|---|
| CMP-01 | bm | Graine de la seconde campagne (distincte de la première) | OK ("deja_creee": false) | RÉUSSI |
| CMP-02 | postgres (lecture) | Chaque campagne a sa propre graine | 2 | RÉUSSI |
| CMP-03 | uh_bro | Même parcelle installée dans une autre campagne : autorisé (panel par campagne) | OK | RÉUSSI |
| CMP-04 | uh_bro | Inventaire du bloc tiré (campagne 2) | OK (ACTIF) | RÉUSSI |
| CMP-05 | postgres (lecture) | Tirage de la campagne 2 indépendant de la campagne 1 (graine différente) | t | RÉUSSI |
| CMP-06 | auh_bro | Visite soumise dans la campagne 2 | ACCEPTEE (SOUMIS) | RÉUSSI |
| CMP-07 | postgres (lecture) | Le Zonal Head 1 a des affectations sur la campagne 1 et aucune sur la campagne 2 | true/0 | RÉUSSI |
| CMP-08 | zh1 | Validation dans la campagne 2 avec une affectation de la campagne 1 : refusée | REFUS (affectation) | RÉUSSI |
| CMP-09 | bm | Affectation de validation sur la campagne 2 | OK | RÉUSSI |
| CMP-10 | zh1 | Validation dans la campagne 2 avec l'affectation de la campagne 2 : acceptée | OK (VALIDE) | RÉUSSI |
| CMP-11 | postgres (lecture) | Vues pilotes cloisonnées par campagne (aucune visite de la campagne 2 dans la campagne 1) | 0 | RÉUSSI |
| CMP-12 | auh_bro | Campagne 2 fermée : nouvelle visite refusée | REJETEE (campagne) | RÉUSSI |
| CMP-13 | uh_bro | Campagne fermée : parcelles installables toujours filtrées par cluster | OK (t) | RÉUSSI |

## Contrôle séparé du bucket existant « photos »

Voir `ANOMALIE_BUCKET_PHOTOS.md`.

| Id | Compte | Action | Obtenu |
|---|---|---|---|
| PH-01 | rt | Un RT lit la liste et le portrait du chef d'un village quelconque | AUTORISÉ |
| PH-02 | uh_bot | Un Unit Head d'un autre cluster lit le portrait | AUTORISÉ |
| PH-03 | rt | Un RT dépose un fichier dans le dossier d'un village quelconque | AUTORISÉ |
| PH-04 | rt | Un RT dépose un fichier exécutable (aucun contrôle de type) | AUTORISÉ |
| PH-05 | uh_bot | Un Unit Head d'un autre cluster REMPLACE le portrait du chef | AUTORISÉ |
| PH-06 | inactif | Un compte DÉSACTIVÉ (session encore valide) dépose un fichier | AUTORISÉ |
| PH-07 | sans_profil | Un compte connecté SANS profil FBMS lit le bucket | AUTORISÉ |
| PH-08 | rt | Un RT SUPPRIME le portrait du chef d'un village quelconque | AUTORISÉ |
| PH-09 | None | Un visiteur non connecté (anon) lit via la base | REFUSÉ |
| PH-10 | configuration | Bucket public (URL lisible sans connexion par l'API Storage) ; limite de taille ; types admis | true|aucune|tous |

## Non exécuté

- Aucun test sur l'API HTTP réelle de Supabase (PostgREST, Storage, Auth) : à faire juste après migration, liste de contrôle dans la demande de mise en production.
- Aucun test sur téléphone Android réel ni de charge.

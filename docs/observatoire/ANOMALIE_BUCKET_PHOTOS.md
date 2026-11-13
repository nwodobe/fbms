# Anomalie de sécurité : bucket Storage existant « photos »

Contrôle séparé, demandé par le mandat (étape 5). Ce bucket n'appartient PAS au module Observatoire : il sert aux photos de recensement des villages (`index.html`, objet RemotePhotos, chemin `<villageId>/<slot>.jpg`, emplacements entree, chef, route, lieuCollecte, rt, gps). Aucun correctif n'a été appliqué en production.

## 1. Constat en production (lecture seule, agrégats sans donnée personnelle)

| Mesure | Valeur |
|---|---|
| Objets | 252 |
| Dossiers village | 68 |
| Volume | 107,5 Mo |
| Portraits de personnes identifiables (`chef.jpg`, `rt.jpg`) | 61 |
| Période de dépôt | 03/07/2026 au 12/08/2026 (aucun dépôt depuis 30 jours) |
| Bucket public | oui |
| Limite de taille / types de fichier | aucune / tous |

Politiques `storage.objects` en place : `photos_read`, `photos_insert`, `photos_update`, `photos_delete`, toutes accordées au rôle `authenticated` avec la seule condition `bucket_id = 'photos'`.

## 2. Démonstration sur le staging fidèle (politiques Storage de production à l'identique, comptes et fichiers fictifs)

Script : `tests/observatoire/securite_bucket_photos.py`. Résultats : `tests/observatoire/resultats/securite_bucket_photos.json`.

| Id | Compte | Action | Obtenu | Attendu |
|---|---|---|---|---|
| PH-01 | RT | Lire le portrait du chef d'un village quelconque | AUTORISÉ | limité à son périmètre |
| PH-02 | Unit Head d'un autre cluster | Lire le portrait | AUTORISÉ | REFUSÉ |
| PH-03 | RT | Déposer un fichier dans le dossier d'un village quelconque | AUTORISÉ | limité à son périmètre |
| PH-04 | RT | Déposer un `.exe` | AUTORISÉ | REFUSÉ (images seulement) |
| PH-05 | Unit Head d'un autre cluster | Remplacer le portrait du chef | AUTORISÉ | REFUSÉ |
| PH-06 | Compte DÉSACTIVÉ, session encore valide | Déposer un fichier | AUTORISÉ | REFUSÉ |
| PH-07 | Compte connecté SANS profil FBMS | Lister le bucket | AUTORISÉ | REFUSÉ |
| PH-08 | RT | Supprimer le portrait du chef | AUTORISÉ | REFUSÉ (BM seulement) |
| PH-09 | Visiteur anonyme, via la base | Lister | REFUSÉ | REFUSÉ |
| PH-10 | Configuration | Bucket public, sans limite | public, aucune limite, tous types | privé, 5 Mo, image/jpeg|png|webp |

Remarque sur PH-09 : le refus côté base ne protège rien, car le bucket est public. Toute personne qui connaît ou devine l'URL `.../storage/v1/object/public/photos/<villageId>/chef.jpg` télécharge le fichier sans connexion. Les identifiants de village sont prévisibles.

## 3. Qualification

- **Gravité : ÉLEVÉE.** Exposition publique de 61 portraits de personnes identifiables (données personnelles au sens de la loi ivoirienne n° 2013-450), intégrité des preuves de recensement non garantie (remplacement ou suppression par n'importe quel compte connecté, y compris désactivé ou sans profil), dépôt de fichiers arbitraires sans limite (risque d'hébergement de contenu et de coût).
- **Exploitabilité :** simple. Il suffit d'un compte Supabase connecté (inscription ouverte non vérifiée ici, à contrôler) ou de l'URL publique.
- **Indices d'exploitation :** aucun dépôt depuis le 12/08/2026 ; les journaux d'accès Storage n'ont pas été analysés (hors périmètre lecture des agrégats). À vérifier par l'administrateur.
- **Lien avec l'Observatoire :** aucun. Le module Observatoire utilise son propre bucket privé `pheno-preuves` avec chemins cloisonnés ; il n'aggrave ni ne corrige cette anomalie.

## 4. Correctif proposé (NON appliqué, décision séparée)

Migration distincte `20261113100500_photos_securisation.sql`, à valider à part de l'Observatoire, car elle modifie le comportement de l'application de recensement existante :

1. `update storage.buckets set public = false, file_size_limit = 5242880, allowed_mime_types = '{image/jpeg,image/png,image/webp}' where id = 'photos';`
2. Remplacer les 4 politiques par :
   - lecture : profil actif (`fbms_role()` non nul) et village dans le périmètre du compte (BM, Head of Procurement : tout ; Unit Head : son cluster ; RT : ses villages) ;
   - dépôt et remplacement : mêmes conditions, rôles terrain et BM ;
   - suppression : Branch Manager seulement.
3. Côté `index.html` : remplacer `getPublicUrl` par `createSignedUrl` (durée 1 h) dans RemotePhotos. Ce fichier n'est pas dans la liste interdite aux agents, mais la modification doit être livrée avec la migration, sinon les photos cessent de s'afficher au passage en privé.
4. Contrôle a posteriori : rejouer `securite_bucket_photos.py` (attendu : PH-02, 04, 05, 06, 07, 08 REFUSÉ), vérifier qu'une URL publique renvoie 400/404.

Retour arrière : `update storage.buckets set public = true ...` et restauration des 4 politiques d'origine (texte conservé dans `tests/observatoire/staging/30_index_rls_politiques.sql`).

## 5. Mesure conservatoire immédiate possible sans code

Passer le bucket en privé dans la console coupe l'exposition publique en 1 clic, mais casse l'affichage des photos dans l'application de recensement tant que le point 3 n'est pas livré. Arbitrage à faire par le Branch Manager.

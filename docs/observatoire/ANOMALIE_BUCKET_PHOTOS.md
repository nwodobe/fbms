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

## 2. Démonstration sur le staging fidèle (politiques de production à l'identique, comptes et fichiers fictifs)

Script : `tests/observatoire/securite_bucket_photos.py`, rejoué sur deux copies du staging : AVANT (politiques actuelles) et APRÈS (proposition `photos_securisation_PROPOSITION.sql` appliquée). Résultats : `resultats/securite_bucket_photos.json` et `resultats/securite_bucket_photos_correctif.json`.

| Id | Compte | Action | Avant | Après correctif |
|---|---|---|---|---|
| PH-01 | rt | Un RT lit la liste et le portrait du chef d'un village quelconque | AUTORISÉ | AUTORISÉ |
| PH-02 | uh_bot | Un Unit Head d'un autre cluster lit le portrait | AUTORISÉ | AUTORISÉ |
| PH-03 | rt | Un RT dépose un fichier dans le dossier d'un village quelconque | AUTORISÉ | REFUSÉ |
| PH-04 | rt | Un RT dépose un fichier exécutable (aucun contrôle de type) | AUTORISÉ | REFUSÉ |
| PH-05 | uh_bot | Un Unit Head d'un autre cluster REMPLACE le portrait du chef | AUTORISÉ | REFUSÉ |
| PH-06 | inactif | Un compte DÉSACTIVÉ (session encore valide) dépose un fichier | AUTORISÉ | REFUSÉ |
| PH-07 | sans_profil | Un compte connecté SANS profil FBMS lit le bucket | AUTORISÉ | REFUSÉ |
| PH-11 | bm | Le Branch Manager lit le portrait (contrôle positif) | AUTORISÉ | AUTORISÉ |
| PH-12 | uh_bro | Le Unit Head du cluster du village lit le portrait (contrôle positif) | AUTORISÉ | AUTORISÉ |
| PH-13 | uh_bro | Le Unit Head du cluster du village dépose une photo (contrôle positif) | AUTORISÉ | AUTORISÉ |
| PH-14 | bm | Le Branch Manager remplace une photo (contrôle positif) | AUTORISÉ | AUTORISÉ |
| PH-08 | rt | Un RT SUPPRIME le portrait du chef d'un village quelconque | AUTORISÉ | REFUSÉ |
| PH-09 | None | Un visiteur non connecté (anon) lit via la base | REFUSÉ | REFUSÉ |
| PH-10 | configuration | Bucket public (URL lisible sans connexion par l'API Storage) ; limite de taille ; types admis | true|aucune|tous | false|10485760|image/jpeg,image/png,image/webp |

PH-01/02 restent AUTORISÉS après correctif, volontairement : la fiche village, qui contient déjà l'URL de la photo, est lisible par tout compte actif (`villages_sel`). Restreindre la lecture des photos par cluster serait une décision métier distincte, à prendre en même temps pour la fiche village. PH-04 : le refus du `.exe` en base vient ici du dossier inexistant ; le contrôle de type est assuré par `allowed_mime_types` dans l'API Storage, non testable sans API HTTP. PH-09 : le refus côté base ne protège rien tant que le bucket est public (URL `.../object/public/photos/<villageId>/chef.jpg` prévisible).

## 3. Qualification

- **Gravité : ÉLEVÉE.** Exposition publique de 61 portraits de personnes identifiables (données personnelles au sens de la loi ivoirienne n° 2013-450), intégrité des preuves de recensement non garantie (remplacement ou suppression par n'importe quel compte connecté, y compris désactivé ou sans profil), dépôt de fichiers arbitraires sans limite (risque d'hébergement de contenu et de coût).
- **Exploitabilité :** simple. Il suffit d'un compte Supabase connecté (inscription ouverte non vérifiée ici, à contrôler) ou de l'URL publique.
- **Indices d'exploitation :** aucun dépôt depuis le 12/08/2026 ; les journaux d'accès Storage n'ont pas été analysés (hors périmètre lecture des agrégats). À vérifier par l'administrateur.
- **Lien avec l'Observatoire :** aucun. Le module Observatoire utilise son propre bucket privé `pheno-preuves` avec chemins cloisonnés ; il n'aggrave ni ne corrige cette anomalie.

## 4. Correctif proposé (NON appliqué, livraison séparée et prioritaire)

Fichier : `docs/observatoire/photos_securisation_PROPOSITION.sql` (volontairement hors de `supabase/`, car hors Observatoire et soumis à décision). Les photos suivent exactement les droits de la fiche village : lecture = compte actif ; dépôt et remplacement = mêmes conditions que la modification d'un village (rôle autre que « Consultation uniquement », `peut_ecrire_referentiel_terrain`, cluster pour Unit Head et Assistant Unit Head) ; suppression = Branch Manager. Bucket privé, 10 Mo, jpeg/png/webp (la limite est à confronter aux photos réelles avant validation).

Inventaire des dépendances (recherche dans tout le dépôt) :

| Fichier | Usage | Effet du passage en privé | Adaptation nécessaire |
|---|---|---|---|
| `fbms/index.html` l. 1158-1160 | dépôt `villageId/slot.jpg` puis `getPublicUrl`, URL stockée dans la fiche | URL stockée inutilisable | `createSignedUrl` à l'affichage ; stocker le chemin |
| `fbms/index.html` l. 1169 | suppression d'un emplacement | réservée au BM après correctif | message clair pour les autres rôles |
| `operations/field-buying.js` l. 1093, 4588 | dépôt galerie `villageId/gallery/...` | inchangé si droits de modification du village | aucune |
| `operations/field-buying.js` l. 4614-4616 | `villagePhotoUrl` construit l'URL publique | images cassées | URL signée, mise en cache courte |
| Données : 42 fiches `villages` en production | contiennent une URL publique `/object/public/photos/` | liens cassés | résolution à l'affichage (URL publique → chemin → URL signée), sans réécriture des données |

Politiques concurrentes : les 16 autres politiques de `storage.objects` sont toutes conditionnées à leur propre `bucket_id` ; aucune ne rouvre `photos` (vérifié sur l'extraction de production).

Ordre de déploiement sans rupture : (1) livrer le front qui sait produire des URL signées et résoudre les anciennes URL, en gardant le bucket public ; (2) vérifier l'affichage ; (3) appliquer la migration ; (4) rejouer `securite_bucket_photos.py` et vérifier qu'une URL publique renvoie une erreur.

Limites : rendre le bucket privé ne rappelle pas les copies déjà téléchargées ou mises en cache ; les journaux d'accès Storage n'ont pas été analysés ; une URL signée donne un accès temporaire à quiconque la détient (durée courte, 1 h proposée).

Retour arrière : bloc commenté en fin de fichier, vérifié sur le staging (politiques revenues à l'identique, empreinte égale à l'état initial).

## 5. Mesure conservatoire immédiate possible sans code

Passer le bucket en privé dans la console coupe l'exposition publique en 1 clic, mais casse l'affichage des photos dans l'application de recensement tant que le point 3 n'est pas livré. Arbitrage à faire par le Branch Manager.

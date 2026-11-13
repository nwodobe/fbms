# FBMS AFLP 2027 V2.1 · Plan du lot A (Fondations)

13 novembre 2026 · Référence : `docs/specs/FBMS_AFLP_2027_V2.1.md`, §6 (P0-01 à P0-04)

**Statut :** plan soumis au Branch Manager. Aucun code applicatif n'est écrit dans ce lot avant ses décisions. Aucune fusion, aucune migration, aucune écriture dans la base réelle.

## 1. Objet du lot A

Poser les quatre fondations sans lesquelles aucune correction P0 ne peut être recettée : rôles validés, convention des masses validée, environnement de test fidèle à la production, connaissance du parc de téléphones.

| N° | Livrable | Nature | Qui agit | Preuve d'achèvement |
| --- | --- | --- | --- | --- |
| P0-01 | Matrice des rôles (V2.1 §3) validée ; comptes nominatifs Finance, QFS, ABM | Décision humaine, puis code | BM décide ; l'agent code ensuite | Matrice signée ; comptes créés par le BM |
| P0-02 | Convention des masses (V2.1 §4.2) et seuils qualité | Décision humaine | Procurement, QFS, Finance ; BM arbitre | Note signée + jeu de pesées de référence |
| P0-03 | Staging Supabase complet | Technique, coût et accès à autoriser | L'agent prépare ; le BM autorise la création | Empreinte du schéma identique à la production |
| P0-04 | Inventaire des APK installés et des files non synchronisées | Terrain + lecture | ABM et Chefs de zone relèvent ; l'agent consolide | Liste par appareil |

## 2. Ce que l'agent fait sans attendre (lecture et préparation seulement)

1. **Empreinte du schéma de production (P0-03).** Script de relevé en lecture seule (tables, colonnes, politiques RLS, déclencheurs, fonctions, droits) produisant une empreinte comparable. Base de départ : `tests/replica-prod/empreinte.sql` de la branche de la PR #311. Le script ne lit aucune ligne de données.
2. **Gabarit d'inventaire des appareils (P0-04).** Fiche par téléphone : agent, rôle, cluster, modèle, version Android, version de l'APK et du contenu Web (écran « Version et mises à jour »), nombre d'opérations en attente, date de dernière synchronisation.
3. **Relevé des écarts de rôles (P0-01).** Tableau comparant, rôle par rôle, les permissions actuelles de `shared/aflp-access.js` et celles de la V2.1 §3, sans modifier le fichier.
4. **Jeu de pesées de référence proposé (P0-02).** Dix cas chiffrés fictifs (brut, sacs, humidité, KOR) avec le résultat attendu selon la V2.1 §4.2, à faire valider avec la convention.
5. **Branche de révision de la PR #311.** Créée à partir de sa tête, sans modification, pour servir de base au lot C.

Ces cinq préparations ne touchent ni `supabase/**`, ni l'authentification, ni la production.

## 3. Décisions humaines requises avant tout code applicatif

| N° | Décision attendue du Branch Manager | Bloque |
| --- | --- | --- |
| D1 | Valider la matrice des rôles de la V2.1 §3, notamment : BM sans `*:*` et sans confirmation Wave ; Zonal Head limité à sa zone et sans validation qualité ; Unit Head sans création d'avance | P0-09, lot B |
| D2 | Créer les comptes nominatifs Finance, QFS et Assistant Branch Manager (identités fournies et créées par le BM, jamais par l'agent) | Lots B et D, recette Wave |
| D3 | Faire valider par Procurement, QFS et Finance la convention des masses : tare unitaire, barème de réfaction qualité, seuils d'humidité et de KOR | P0-06, P0-07, lot B |
| D4 | Autoriser la création d'un environnement de staging Supabase et son coût éventuel, ou désigner un projet existant | P0-03, tous les tests serveur |
| D5 | Autoriser la lecture seule du schéma de production pour établir l'empreinte (aucune donnée lue) | P0-03 |
| D6 | Désigner le journal de sacherie canonique après l'audit des écritures (`sacs_mouvements` ou `rcn_jute_movements`) | P0-08 |
| D7 | Faire relever l'inventaire des téléphones par l'ABM et les Chefs de zone, avec une date limite | P0-04, P0-18 |

## 4. Ce que le lot A ne fait pas

- Aucune modification de `supabase/**`, `shared/auth-gate.js`, `shared/admin.html`, `sw.js`, `i18n-sw.js`, `manifest.webmanifest`, `.github/**`.
- Aucune modification de `shared/aflp-access.js` avant la décision D1.
- Aucune création de compte, aucun identifiant manipulé.
- Aucune fusion de la PR #311.

## 5. Critères de fin du lot A

| Critère | État au 13/11/2026 |
| --- | --- |
| V2.1 versionnée dans le dépôt | Fait sur branche, PR ouverte, non fusionnée |
| Matrice des rôles signée (D1) | En attente du BM |
| Comptes nominatifs créés (D2) | En attente du BM |
| Convention des masses signée (D3) | En attente Procurement, QFS, Finance |
| Staging dont l'empreinte égale celle de la production (D4, D5) | Non démarré, autorisation requise |
| Inventaire des appareils complet (D7) | Non démarré |

Le lot B ne démarre que lorsque D1, D3, D4 et D5 sont obtenues.

## 6. Risques

- **Calendrier.** La V2.1 vise une recette des achats avant le 15/12/2026. Chaque semaine d'attente sur D3 décale d'autant les corrections P0-06 et P0-07.
- **Staging incomplet.** Une réplique sans les politiques RLS et les déclencheurs réels donnerait des tests verts sans valeur ; l'empreinte est la seule preuve admise.
- **Parc hétérogène.** Les téléphones restés sur le canal stable du 08/11/2026 n'ont pas les versions fusionnées depuis ; l'inventaire dira lesquels portent des opérations non synchronisées.

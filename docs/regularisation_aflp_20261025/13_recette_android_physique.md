# Recette sur téléphone Android physique, avec un compte FBMS connecté

Version 1.0 · 25/10/2026 · **Statut : TEST ANDROID PHYSIQUE NON EXÉCUTÉ.** Aucun appareil n'était disponible le 25/10/2026. Ce document est le protocole à dérouler ; la colonne « Résultat » reste vide tant qu'un essai réel n'a pas eu lieu.

## 1. Préalables

| Élément | Exigence |
|---|---|
| Version testée | Publication GitHub Pages **après** fusion des PR #262 et #264 (fichier 12). Noter le commit publié. Tester avant fusion n'a pas de sens : le téléphone recevrait l'ancien code |
| Appareils | Au moins **2 téléphones** : un d'entrée de gamme (Android 10 ou 11, 2 à 3 Go de RAM) et un récent. Noter modèle, version Android, version de Chrome |
| Mode | Navigateur Chrome / PWA. Pour l'APK : construction postérieure aux deux fusions, faute de quoi l'APK porte l'ancien code (risque R4) |
| Comptes | 2 comptes terrain distincts (A et B) du **même** périmètre, plus 1 superviseur différent pour la vérification. Pour Béoumi, Brobo ou Diabo : Chef de Zone (fichier 11) |
| Correctifs SQL | Noter s'ils sont appliqués ou non : P0-1 / P1-1 (consentements, séparation) et D-3 (précision GPS). Les cas R11, R12 et R10 en dépendent |
| Données | **Aucune donnée réelle.** Producteur fictif « QA RECETTE », téléphone fictif `0700000xxx`, aucune photo de personne. Les dossiers créés sont désactivés après la recette par le Branch Manager (motif « Recette Android », jamais de suppression) |
| Preuves | Captures d'écran sans nom ni téléphone réels. Résultats SQL en lecture seule (§3) |

## 2. Cas de recette

| # | Cas | Étapes | Résultat attendu | Résultat observé | Preuve |
|---|---|---|---|---|---|
| R0 | Ouverture et version | Ouvrir FBMS, Field Buying | Page chargée ; pour l'APK, écran « À propos » avec version 1.1.0 | | |
| R1 | Connexion en ligne | Compte A | Rôle et périmètre corrects dans la barre du haut | | |
| R2 | Préparer le terrain | Bouton « Préparer le terrain » | « Prêt pour le terrain » ; nombres de villages et de producteurs cohérents avec le périmètre | | |
| R3 | Réouverture hors ligne (D-1) | Mode avion, fermer l'application, la rouvrir | Field Buying s'affiche ; pas de blocage sur « Chargement… » | | |
| R4 | Enrôlement hors ligne avec GPS | Producteur fictif ; parcelle ; bouton GPS au centre | Précision affichée ; ≤ 15 m attendu, sinon nouvel essai | | |
| R5 | Coordonnées tapées à la main | Saisir lat/long sans bouton GPS | Enregistrées en note ; parcelle `NOT_MAPPED`, pas de point GPS | | |
| R6 | Sustainability et inspection hors ligne | 25 réponses, finaliser ; inspection `BASELINE_CHECK` avec GPS inspecteur | Enregistrées localement, en attente de synchronisation | | |
| R7 | Conservation locale | Forcer l'arrêt de l'application, redémarrer le téléphone, rouvrir hors ligne | Toutes les opérations R4 à R6 toujours en attente, aucune perte | | |
| R8 | Interruption de synchronisation | Rétablir le réseau, couper le Wi-Fi ou les données pendant l'envoi, puis rétablir | Reprise automatique ; journal final : 0 en attente, 0 en échec ; **aucun doublon** (§3, requête Q2) | | |
| R9 | Changement de compte | A saisit hors ligne, se déconnecte ; B se connecte en ligne | Les opérations de A **ne partent pas** sous B ; B voit « opérations d'un autre compte » ; A se reconnecte et les envoie sous son nom (§3, Q3) | | |
| R10 | Précision GPS au serveur | Après R8 | Précision présente en base (Q1) **si D-3 est appliqué** ; sinon `NULL`, ce qui est le défaut connu | | |
| R11 | Consentement par le compte terrain | Onglet Consentements : Oui, Partiel puis Non sur 3 dossiers fictifs | Accepté si P0-1 est appliqué ; refusé sinon (défaut connu) | | |
| R12 | Séparation des tâches | L'auteur tente d'approuver son dossier, puis un autre superviseur | Auteur refusé, autre superviseur accepté (si P1-1 est appliqué) | | |
| R13 | Achat Field Buying hors ligne | Achat fictif sur un producteur fictif | Synchronisé une seule fois (reçu idempotent) | | |
| R14 | Batterie et stockage | Après la recette | Stockage persistant accordé ; consommation notée | | |

## 3. Contrôles serveur en lecture seule (Branch Manager, SQL)

```sql
-- Q1 · parcelles de recette : statut GPS et précision
select fp.local_name, fp.gps_status, fp.gps_accuracy_m, fp.notes is not null as note
from public.farmer_plots fp join public.producteurs p on p.id = fp.producteur_id
where p.nom = 'QA RECETTE' and not fp.deleted;

-- Q2 · doublons : un producteur de recette par téléphone, une opération par clé
select telephone, count(*) from public.producteurs where nom = 'QA RECETTE' and not deleted group by 1 having count(*) > 1;
select idempotency_key, count(*) from private.offline_sync_receipts group by 1 having count(*) > 1;

-- Q3 · attribution : chaque saisie de recette porte le compte qui l'a faite
select p.prenoms, p.created_by_user_id from public.producteurs p where p.nom = 'QA RECETTE' order by p.created_at;
```

## 4. Critères d'acceptation

La recette est **réussie** si les conditions suivantes sont toutes réunies :
- R0 à R9 et R13 sont conformes sur les deux téléphones ;
- R10 à R12 sont conformes **ou** donnent le défaut connu documenté, selon l'état des correctifs SQL ;
- il n'y a aucune perte et aucun doublon.

Tout écart est consigné avec modèle, version Android, heure et capture. Le statut « TEST ANDROID PHYSIQUE NON EXÉCUTÉ » ne change que lorsque ce tableau est rempli à partir d'un essai réel.

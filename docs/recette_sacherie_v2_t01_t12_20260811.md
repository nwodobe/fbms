# Recette contrôlée Sacherie V2 MVP - T01 à T12

Date : 11/08/2026  
Programme : AFLP 2027  
Référence : AFLP-SOP-006 / MVP Sacherie V2  
Statut initial : **READY TO EXECUTE**  

> Aucun test ci-dessous ne doit être marqué PASS sans exécution réelle sur un environnement de test Supabase. Ne jamais utiliser des données réelles de producteurs, des numéros personnels ou des données de production dans cette recette.

## 1. Préconditions

1. Utiliser un environnement Supabase de test ou une branche de base isolée.
2. Exécuter `docs/migrations/sacherie_v2_mvp_20260811.sql`.
3. Exécuter ensuite `docs/migrations/sacherie_v2_mvp_verify_20260811.sql`.
4. Préparer des comptes fictifs :
   - 1 Branch Manager ;
   - 1 Unit Head du cluster TEST-A ;
   - 1 Warehouse Keeper du cluster TEST-A ;
   - 1 Unit Head du cluster TEST-B ;
   - 1 profil sans fonction opérationnelle Sacherie.
5. Préparer un RT fictif du cluster TEST-A.
6. Préparer une avance fictive et configurer un cycle `WAVE-TEST-A-001` avec `volume_finance_kg = 2 000`.
7. Alimenter le stock sacs du cluster TEST-A avec une réception fictive suffisante.
8. Aucun nom réel, téléphone réel, GPS réel ou montant réel de campagne ne doit être utilisé.

## 2. Règle de calcul de référence

Pour un RT avec :

- stock RCN vérifié = 0 kg ;
- volume financé restant = 2 000 kg ;
- sacs sous responsabilité = 0 ;
- aucune réservation active ;

le plafond attendu est :

`floor((0 + 2 000) x 1,10 / 80) = 27 sacs`

28 sacs doivent être refusés.

## 3. Matrice T01-T12

| Test | Scénario | Action | Résultat attendu | Preuve | Statut initial |
|---|---|---|---|---|---|
| **T01** | Demande conforme | UH TEST-A demande 27 sacs sur le cycle 2 000 kg, stock RCN vérifié 0 | Demande créée `PENDING_BM` | Request ID + capture | READY TO EXECUTE |
| **T02** | Dépassement plafond | UH demande 28 sacs | Refus serveur, aucune demande créée | Erreur RPC + absence ligne | READY TO EXECUTE |
| **T03** | Remise sans approval | Warehouse Keeper tente d'exécuter une demande PENDING_BM / insertion DOTATION_RT directe | Refus serveur | Erreur serveur | READY TO EXECUTE |
| **T04** | Remise partielle | BM approuve 19, magasin remet 15 | Mouvement = 15, statut `PARTIALLY_EXECUTED`, reliquat 4 inutilisable | Demande + mouvement | READY TO EXECUTE |
| **T05** | Réutilisation approval | Réexécuter la demande T04 | Refus serveur, aucun 2e mouvement | Erreur + count(request_id)=1 | READY TO EXECUTE |
| **T06** | FULL sans Lot ID | Insérer une nouvelle ligne V2 `bag_state=FULL`, `lot_id` vide dans un chemin autorisé de test | Refus contrainte serveur | Erreur check constraint | READY TO EXECUTE |
| **T07** | Marge non cumulée | RT possède déjà des sacs + nouveau cycle/achats | Plafond utilise exposition courante et réservations, pas +10 % par tranche | Résultat RPC documenté | READY TO EXECUTE |
| **T08** | Stock cluster insuffisant | Approval valide mais stock cluster inférieur à remise | Refus serveur | Erreur stock cluster | READY TO EXECUTE |
| **T09** | Idempotence brouillon | Même `client_request_id` envoyé deux fois après retour réseau | Une seule demande serveur, même ID retourné | count(client_request_id)=1 | READY TO EXECUTE |
| **T10** | Écart inventaire | Fonction de réconciliation non incluse dans le lot P0 actuel | **NOT IMPLEMENTED / P1** | N/A | P1 |
| **T11** | Auto-approval UH | UH appelle directement `sacherie_decider_demande` | Refus `Seul le Branch Manager peut approuver` | Erreur RPC | READY TO EXECUTE |
| **T12** | Historique V1 conservé | Comparer nombre et accès aux mouvements V1 avant/après migration | Lignes V1 intactes, colonnes V2 éventuellement nulles | Requête count + échantillon fictif | READY TO EXECUTE |

## 4. Tests supplémentaires issus de la revue de sécurité

### S01 - Périmètre cluster

- UH TEST-B tente de créer une demande pour RT TEST-A.
- Attendu : refus serveur `RT hors du cluster attribué`.

### S02 - Exécution par mauvais cluster

- Warehouse Keeper TEST-B tente d'exécuter un approval TEST-A.
- Attendu : refus serveur.

### S03 - Exécution par Unit Head

- UH TEST-A tente d'exécuter physiquement un approval.
- Attendu : refus serveur. L'exécution est réservée à `Warehouse Keeper` ou `Assistant Unit Head` du cluster, avec BM comme autorité de secours MVP.

### S04 - Deux approvals concurrents

- Créer deux demandes qui, prises séparément, sont conformes mais dont la somme dépasserait le plafond restant.
- Approuver la première.
- Tenter d'approuver la seconde.
- Attendu : seconde approval refusée ou réduite car la première quantité est déjà réservée.

### S05 - Spoof du RT / cluster

- Avec un `request_id` approuvé pour RT-A / TEST-A, tenter une insertion DOTATION_RT mentionnant RT-B ou TEST-B.
- Attendu : refus du trigger serveur.

### S06 - Insertion DOTATION_RT directe

- Utilisateur actif tente `insert into sacs_mouvements` via PostgREST sans RPC d'exécution.
- Attendu : refus RLS même avec un `request_id` renseigné.

### S07 - Un seul cycle OPEN par RT

- Configurer un cycle OPEN pour RT-A.
- Tenter d'en ouvrir un deuxième.
- Attendu : refus.
- Clôturer le premier, puis ouvrir le second.
- Attendu : autorisé.

### S08 - Responsabilité RT après sous-affectation producteur

- Donner 20 sacs au RT.
- Enregistrer 8 sacs RT -> PRODUCTEUR puis 3 PRODUCTEUR -> RT.
- Attendu : `sacherie_sacs_sous_responsabilite_rt()` reste à 20, car la sous-affectation producteur ne libère pas le RT de sa responsabilité.

## 5. Recette interface

Tester `terrain/sacherie_v2.html` aux trois largeurs obligatoires du dépôt :

- 390 x 844 ;
- 768 x 1024 ;
- 1440 x 900.

À contrôler :

1. aucun débordement horizontal hors tables scrollables ;
2. calcul lisible sur mobile ;
3. bouton Soumettre désactivé tant que le calcul n'est pas conforme ;
4. stock RCN non prérempli à zéro ;
5. UH ne voit que les RT de son cluster dans la liste ;
6. Warehouse Keeper ne voit pas de bouton de remise pour un autre cluster ;
7. BM voit l'Inbox approval et les cycles ;
8. HOLD / Rejet exigent un motif ;
9. brouillon hors ligne indique clairement qu'il ne vaut pas approval ;
10. aucune erreur console nouvelle et aucune ressource 404 nouvelle.

## 6. Critère GO MVP

GO uniquement si :

- T01-T09, T11-T12 sont PASS ;
- S01-S08 sont PASS ;
- T10 reste explicitement P1 et n'est pas présenté comme livré ;
- aucune régression critique V1 n'est observée ;
- les trois viewports sont vérifiés ;
- la migration et son rollback ont été testés sur l'environnement de test ;
- aucune preuve critique du futur pilote ne dépend uniquement de `localStorage`.

## 7. Critère NO-GO immédiat

NO-GO si l'un des cas suivants est possible :

- DOTATION_RT sans approval BM ;
- approval réutilisable ;
- remise supérieure à approved_qty ;
- UH d'un cluster agit sur un autre cluster ;
- Unit Head exécute la remise à la place du magasinier ;
- somme de plusieurs approvals dépasse le plafond ;
- stock cluster devient négatif ;
- brouillon hors ligne présenté comme approval ;
- migration détruit ou rend inaccessible l'historique V1.

# Étape 4 — Recette terrain Farmer Buying

Date : 20/07/2026
Projet : ANAGROCI Operations Suite
Périmètre : Programme Farmer Buying
Statut : protocole de test terrain

---

## 1. Objectif

Cette étape vise à tester l'application comme elle sera utilisée sur le terrain :

- par un RT ;
- par un chef terrain ;
- par le Branch Manager ;
- avec connexion instable ;
- avec opérations en attente de synchronisation ;
- avec contrôles Achats, Cash, Sacs et Command Center.

Le but n'est pas d'ajouter de nouvelles fonctionnalités, mais de vérifier que les gardes métier ajoutés en étapes 3A à 3E fonctionnent réellement sur téléphone.

---

## 2. Rappel du périmètre déjà sécurisé

### Étape 3A — Achats Terrain

Contrôles principaux :

- date future bloquée ;
- village hors cluster bloqué si référentiel chargé ;
- RT hors village/cluster bloqué si référentiel chargé ;
- reçu déjà utilisé localement bloqué ;
- paiement bancaire désactivé ;
- achat supérieur au solde d'avance RT bloqué si cache cash disponible ;
- file locale protégée contre la perte d'opérations non synchronisées.

### Étape 3B — Cash / Avances RT

Contrôles principaux :

- avance sans RT bloquée ;
- montant invalide bloqué ;
- nouvelle avance bloquée si solde ouvert non réconcilié ;
- réconciliation sans activité cash/achat bloquée ;
- valeurs négatives bloquées ;
- files locales avances et réconciliations protégées.

### Étape 3C — Sacs / Sacherie

Contrôles principaux :

- date future bloquée ;
- quantité non entière ou négative bloquée ;
- réception usine sans cluster bloquée ;
- mouvement terrain sans RT bloqué ;
- producteur requis pour mouvements producteur ;
- stock négatif cluster, RT ou producteur bloqué ;
- file locale sacs protégée.

### Étape 3D — Command Center BM

Contrôles de pilotage :

- volume acheté ;
- cash engagé ;
- sacs RT ;
- risques critiques ;
- synchronisations en attente ;
- RT à risque ;
- alertes par cluster.

### Étape 3E — Audit final

Correction technique :

- cache bump de `anagroci-audit.js` vers `?v=step3e-farmer-buying` pour forcer le rechargement des gardes 3A et 3B.

---

## 3. Matériel de test requis

Prévoir :

- 1 téléphone Android avec Chrome ;
- 1 téléphone iPhone si disponible ;
- 1 ordinateur pour le Branch Manager ;
- 1 compte RT ou Agent ;
- 1 compte Chef / Supervisor ;
- 1 compte Branch Manager ;
- 2 villages tests ;
- 2 RT tests ;
- 2 producteurs tests ;
- une petite avance RT fictive ;
- quelques mouvements sacs fictifs.

---

## 4. Règles de prudence pendant les tests

Les tests doivent être faits avec des données clairement identifiables :

- village test ;
- RT test ;
- producteur test ;
- reçu test ;
- observation contenant `TEST RECETTE`.

Ne pas utiliser un vrai reçu terrain réel pendant cette phase.

---

## 5. Scénario A — Accès et droits utilisateurs

### Test A1 — Connexion RT / Agent

Action :

1. Ouvrir le portail sur téléphone.
2. Se connecter avec un profil agent.
3. Vérifier l'accès aux modules autorisés.

Résultat attendu :

- l'utilisateur peut accéder aux modules terrain autorisés ;
- le module Cash reste réservé aux profils autorisés ;
- Command Center reste réservé BM / Direction.

### Test A2 — Connexion Branch Manager

Action :

1. Ouvrir le portail sur ordinateur.
2. Se connecter comme BM.
3. Ouvrir Command Center.

Résultat attendu :

- Command Center s'ouvre ;
- les KPIs sont visibles ;
- le bouton actualiser fonctionne ;
- aucun écran blanc.

---

## 6. Scénario B — Cash / Avances RT

### Test B1 — Créer une avance RT valide

Action :

1. Ouvrir Cash.
2. Créer une avance test pour RT test.
3. Synchroniser.

Résultat attendu :

- avance acceptée ;
- ligne visible dans Cash ;
- Command Center augmente le cash engagé.

### Test B2 — Bloquer une avance sans RT

Action :

1. Supprimer le RT du champ.
2. Essayer d'enregistrer une avance.

Résultat attendu :

- blocage ;
- message : RT requis ;
- aucune ligne créée.

### Test B3 — Bloquer une nouvelle avance si solde ouvert

Action :

1. Créer une première avance.
2. Ne pas réconcilier.
3. Tenter une deuxième avance au même RT.

Résultat attendu :

- blocage de la deuxième avance ;
- message indiquant un solde ouvert non réconcilié.

---

## 7. Scénario C — Achats Terrain

### Test C1 — Achat valide dans la limite de l'avance

Action :

1. Ouvrir Achats Terrain.
2. Choisir cluster, village, RT et producteur test.
3. Saisir poids, prix, mode Mobile Money / Wave, reçu test.
4. Enregistrer.

Résultat attendu :

- achat accepté ;
- ligne visible ;
- Command Center augmente volume et montant achats.

### Test C2 — Bloquer paiement bancaire

Action :

1. Choisir mode Virement.
2. Essayer d'enregistrer.

Résultat attendu :

- blocage ;
- message : paiement bancaire désactivé ;
- aucune opération créée.

### Test C3 — Bloquer achat supérieur à l'avance disponible

Action :

1. Mettre un montant d'achat supérieur au solde avance RT.
2. Enregistrer.

Résultat attendu :

- blocage si le cache cash est chargé ;
- message : avance RT insuffisante.

### Test C4 — Bloquer reçu doublon local

Action :

1. Créer un achat avec reçu `TEST-001`.
2. Refaire un achat avec le même reçu sur le même téléphone.

Résultat attendu :

- deuxième achat bloqué ;
- message reçu déjà utilisé.

---

## 8. Scénario D — Sacs / Sacherie

### Test D1 — Réception sacs usine vers cluster

Action :

1. Ouvrir Sacs.
2. Créer une réception Usine → Cluster.
3. Saisir cluster et quantité.

Résultat attendu :

- mouvement accepté ;
- stock cluster augmente.

### Test D2 — Distribution cluster vers RT

Action :

1. Distribuer une quantité inférieure au stock cluster.
2. Choisir RT.

Résultat attendu :

- mouvement accepté ;
- stock cluster baisse ;
- stock RT augmente.

### Test D3 — Bloquer sortie supérieure au stock cluster

Action :

1. Distribuer plus de sacs que le stock cluster disponible.

Résultat attendu :

- blocage ;
- message stock sacs cluster insuffisant.

### Test D4 — Bloquer sortie RT supérieure au stock RT

Action :

1. Faire un mouvement sortant RT avec quantité supérieure au stock RT.

Résultat attendu :

- blocage ;
- message stock sacs RT insuffisant.

---

## 9. Scénario E — Offline / synchronisation

### Test E1 — Achat hors connexion

Action :

1. Mettre le téléphone en mode avion.
2. Créer un achat valide.
3. Vérifier la file locale.

Résultat attendu :

- l'achat reste en attente ;
- aucun écran blanc ;
- aucune donnée ne disparaît.

### Test E2 — Synchronisation après reconnexion

Action :

1. Désactiver le mode avion.
2. Cliquer synchroniser ou attendre la synchro.
3. Ouvrir Command Center.

Résultat attendu :

- l'achat passe synchronisé ;
- le compteur en attente diminue ;
- Command Center reflète l'opération.

### Test E3 — Plusieurs opérations offline

Action :

1. En mode avion, créer plusieurs opérations : achat, sacs, avance si autorisé.
2. Reconnecter.

Résultat attendu :

- aucune opération pending ne disparaît ;
- les statuts évoluent proprement : pending, syncing, synced ou failed.

---

## 10. Scénario F — Command Center BM

### Test F1 — Anomalies visibles

Action :

1. Créer au moins une anomalie contrôlée : reçu manquant, solde RT ouvert ou sacs négatifs si l'ancien historique le permet.
2. Ouvrir Command Center.

Résultat attendu :

- l'anomalie apparaît dans `À faire aujourd'hui` ;
- le RT à risque apparaît dans le tableau ;
- les KPIs restent lisibles sur téléphone et ordinateur.

### Test F2 — Files locales visibles

Action :

1. Laisser une opération en attente sur un appareil.
2. Ouvrir Command Center sur le même appareil.

Résultat attendu :

- compteur achats/cash/sacs en attente visible ;
- échecs de synchronisation visibles si présents.

---

## 11. Critères d'acceptation

L'étape 4 est considérée comme validée si :

- aucun écran blanc n'apparaît ;
- les modules s'ouvrent sur téléphone ;
- les gardes Achats, Cash et Sacs bloquent les cas incohérents ;
- les opérations hors connexion restent présentes ;
- les opérations se synchronisent après reconnexion ;
- Command Center affiche les alertes cohérentes ;
- aucune opération pending n'est supprimée ;
- le BM peut comprendre les risques du jour sans ouvrir chaque module.

---

## 12. Angles morts à ne pas oublier

Même si les tests passent, les points suivants restent à traiter ensuite :

1. contraintes serveur Supabase ;
2. unicité globale du reçu ;
3. stockage distant des reçus/photos ;
4. workflow d'approbation BM ;
5. clôture journalière BM ;
6. exports PDF / Excel ;
7. journal de recette terrain signé ;
8. tests sur plusieurs marques de téléphone.

---

## 13. Décision après test

Si les tests terrain sont concluants :

- valider Farmer Buying v1 ;
- ouvrir la phase RCN Trace.

Si les tests échouent :

- corriger uniquement les points bloquants ;
- refaire la recette sur téléphone ;
- ne pas passer à RCN Trace avant stabilisation.

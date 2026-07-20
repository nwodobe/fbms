# Étape 5 — Pré-production / Go-Live contrôlé Farmer Buying

Date : 20 juillet 2026  
Projet : ANAGROCI Operations Suite / Farmer Buying 2027  
Statut : Pré-production documentaire  
RCN Trace : volontairement maintenu en dernière position

---

## 1. Objectif de l'étape 5

L'étape 5 transforme la recette terrain en plan de déploiement contrôlé.

Le but n'est pas encore de lancer l'application en production réelle. Le but est de préparer un lancement maîtrisé avec :

- des utilisateurs de test identifiés ;
- des téléphones de test ;
- des données clairement marquées `TEST RECETTE` ;
- une procédure GO / NO-GO ;
- une procédure de retour arrière ;
- un registre d'incidents ;
- une décision finale du Branch Manager avant bascule.

---

## 2. Périmètre

Modules concernés :

1. Portail sécurisé ;
2. FBMS / référentiel terrain ;
3. Cash / Avances RT ;
4. Achats Terrain ;
5. Sacs / Sacherie ;
6. Command Center BM ;
7. Audit log.

Modules hors périmètre :

- RCN Trace ;
- ALIS transport ;
- Hubs / carte ;
- modules usine ;
- migrations Supabase.

---

## 3. Règle de prudence

Pendant la pré-production :

- aucune donnée réelle producteur ne doit être saisie sans marquage test ;
- aucun paiement réel ne doit être engagé ;
- aucune avance réelle ne doit être utilisée ;
- aucune suppression massive de données n'est autorisée ;
- aucune migration destructive n'est autorisée ;
- toute anomalie doit être documentée avant correction.

Format obligatoire des libellés test :

```text
TEST RECETTE - NOM
TEST RECETTE - VILLAGE
TEST RECETTE - RT
TEST RECETTE - PRODUCTEUR
TEST RECETTE - RECU-001
```

---

## 4. Équipe de pré-production

| Rôle | Responsabilité |
|---|---|
| Branch Manager | Décision GO / NO-GO |
| Chef terrain | Exécution tests terrain |
| RT test | Saisie achats / sacs |
| Responsable cash | Avance et réconciliation |
| Contrôleur BM | Lecture Command Center |
| Support technique | Analyse incident et correction |

Personnes à désigner avant test :

- BM : à confirmer ;
- Chef terrain : à confirmer ;
- RT test 1 : à confirmer ;
- RT test 2 : à confirmer ;
- Responsable cash : à confirmer ;
- Support technique : à confirmer.

---

## 5. Matériel requis

Minimum :

- 1 téléphone Android entrée de gamme ;
- 1 téléphone Android milieu de gamme ;
- 1 ordinateur BM ;
- 1 connexion mobile instable volontairement testée ;
- 1 connexion Wi-Fi stable ;
- 1 navigateur Chrome mobile ;
- accès au portail GitHub Pages.

À vérifier avant démarrage :

- batterie supérieure à 50 % ;
- heure du téléphone correcte ;
- navigateur à jour ;
- accès internet disponible ;
- possibilité de couper les données mobiles ;
- identifiants utilisateur disponibles.

---

## 6. Données de test à créer

Données recommandées :

| Élément | Valeur type |
|---|---|
| Cluster | TEST RECETTE - CLUSTER 01 |
| Village | TEST RECETTE - VILLAGE 01 |
| RT | TEST RECETTE - RT 01 |
| Producteur | TEST RECETTE - PRODUCTEUR 01 |
| Avance RT | 100 000 FCFA |
| Achat test valide | 50 000 FCFA |
| Achat test bloqué | 150 000 FCFA |
| Sacs cluster | 100 sacs |
| Dotation RT | 50 sacs |
| Distribution producteur | 10 sacs |
| Enlèvement producteur | 5 sacs |
| Sortie sacs bloquée | 99 sacs si stock inférieur |

---

## 7. Scénario GO-LIVE contrôlé

### J-2 — Préparation

Actions :

- confirmer les comptes utilisateurs ;
- confirmer les rôles ;
- confirmer les appareils ;
- ouvrir chaque module une fois ;
- vérifier que le cache est rafraîchi ;
- confirmer que `anagroci-audit.js?v=step3e-farmer-buying` est bien chargé ;
- rappeler que RCN Trace n'est pas dans ce périmètre.

Sortie attendue :

```text
Tous les utilisateurs peuvent ouvrir les modules autorisés.
```

### J-1 — Recette terrain complète

Actions :

- exécuter la procédure de recette de l'étape 4 ;
- noter chaque résultat ;
- capturer les erreurs écran ;
- vérifier le Command Center BM ;
- décider des corrections urgentes.

Sortie attendue :

```text
Aucun bug bloquant sur achat, cash, sacs ou synchronisation.
```

### J0 — Go / No-Go

La décision est prise par le Branch Manager.

Critère GO :

```text
Le système peut être utilisé sur un petit périmètre pilote.
```

Critère NO-GO :

```text
Le système reste en test jusqu'à correction des anomalies critiques.
```

---

## 8. Critères GO

Le Go est autorisé si :

1. connexion utilisateur OK ;
2. droits par rôle OK ;
3. avance RT créée et visible ;
4. achat valide enregistré ;
5. achat supérieur à l'avance bloqué ;
6. mouvement sacs valide enregistré ;
7. sortie sacs supérieure au stock bloquée ;
8. opération offline conservée ;
9. synchronisation après reconnexion OK ;
10. Command Center BM affiche les alertes ;
11. aucune perte d'opération en attente ;
12. aucune erreur bloquante visible sur téléphone.

---

## 9. Critères NO-GO

Le lancement doit être refusé si :

- un achat peut dépasser l'avance RT sans blocage ;
- une sortie sacs peut rendre le stock négatif sans blocage ;
- une opération offline disparaît ;
- un RT peut ouvrir Cash alors qu'il ne doit pas ;
- le Command Center BM ne charge pas ;
- la synchronisation échoue sans message exploitable ;
- le téléphone mobile ne permet pas d'exécuter le parcours terrain ;
- le navigateur charge une ancienne version des gardes métier.

---

## 10. Registre d'incidents

Toute anomalie doit être consignée comme suit :

| Champ | Description |
|---|---|
| ID incident | INC-001, INC-002 |
| Date / heure | Moment de l'anomalie |
| Module | Achats, Cash, Sacs, Command |
| Téléphone | Marque / modèle |
| Utilisateur | Rôle utilisé |
| Étape | Action exacte effectuée |
| Résultat attendu | Ce qui devait arriver |
| Résultat observé | Ce qui est arrivé |
| Capture écran | Oui / Non |
| Criticité | Bloquant / Majeur / Mineur |
| Décision | Corriger / Accepter / Reporter |

---

## 11. Priorité des incidents

### Bloquant

Empêche le lancement pilote.

Exemples :

- perte de données ;
- achat au-delà de l'avance ;
- stock sacs négatif ;
- impossibilité de se connecter ;
- impossibilité de synchroniser.

### Majeur

Permet un test limité mais doit être corrigé rapidement.

Exemples :

- affichage incomplet ;
- lenteur forte ;
- alerte BM manquante ;
- information peu claire pour le RT.

### Mineur

N'empêche pas le pilote.

Exemples :

- libellé à améliorer ;
- couleur ;
- alignement ;
- formulation.

---

## 12. Retour arrière

Si un bug bloquant apparaît :

1. arrêter la saisie terrain ;
2. conserver les téléphones allumés ;
3. ne pas vider le cache ;
4. ne pas supprimer localStorage ;
5. photographier l'écran ;
6. noter l'heure exacte ;
7. informer le BM ;
8. analyser avant toute correction.

Règle importante :

```text
Ne jamais effacer une file locale contenant des opérations pending, syncing ou failed.
```

---

## 13. Pilote recommandé

Périmètre pilote initial :

- 1 cluster ;
- 1 chef terrain ;
- 2 RT maximum ;
- 2 villages maximum ;
- 10 achats test maximum ;
- 1 session offline volontaire ;
- 1 réconciliation cash ;
- 1 contrôle sacs complet.

Durée recommandée :

```text
1 journée de test intensif + 1 journée d'observation.
```

---

## 14. Décision finale BM

La décision doit être formalisée :

| Décision | Signification |
|---|---|
| GO | Pilote limité autorisé |
| GO AVEC RÉSERVES | Pilote autorisé avec suivi renforcé |
| NO-GO | Correction obligatoire avant terrain |

Modèle de décision :

```text
Décision BM : GO / GO AVEC RÉSERVES / NO-GO
Date :
Motif :
Réserves :
Responsable suivi :
```

---

## 15. Points non résolus avant production complète

Même si le pilote est validé, les sujets suivants restent à traiter avant une production large :

1. unicité globale du reçu côté Supabase ;
2. contraintes serveur sur dépassement d'avance ;
3. contraintes serveur sur stock sacs négatif ;
4. stockage distant des reçus et documents sacs ;
5. validation exceptionnelle BM ;
6. clôture journalière BM ;
7. export PDF / Excel ;
8. tableau d'incidents intégré ;
9. sauvegarde automatique des files locales ;
10. formation terrain documentée.

---

## 16. Conclusion

L'étape 5 prépare le passage contrôlé du Farmer Buying vers un pilote terrain.

Elle ne valide pas encore la production générale. Elle permet au Branch Manager de décider proprement :

```text
GO, GO AVEC RÉSERVES, ou NO-GO.
```

RCN Trace reste volontairement maintenu après cette stabilisation Farmer Buying.

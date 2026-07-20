# RCN Trace — Étape 7

## Registre d'incidents terrain et préparation des corrections post-recette

Date : 2026-07-20  
Périmètre : RCN Trace uniquement  
Statut : correction légère pré/post-recette, sans modification Supabase

---

## 1. Contexte

L'étape 5 a formalisé le protocole de recette terrain bout en bout.

L'étape 6 a rendu le workflow visible dans l'interface pour guider l'utilisateur.

L'étape 7 devait normalement traiter les corrections post-recette terrain. Cependant, aucun incident réel de terrain n'a encore été communiqué.

Il serait donc risqué d'inventer des corrections métier sans preuve terrain.

La décision retenue est de créer un registre d'incidents directement dans RCN Trace afin de capter les observations réelles pendant la recette.

---

## 2. Objectif de l'étape 7

Mettre à disposition de l'équipe un outil simple pour enregistrer les incidents observés pendant la recette.

L'objectif est de documenter :

- l'étape du flux concernée ;
- l'écran concerné ;
- la gravité ;
- l'observateur ou responsable ;
- la description précise de l'incident ;
- le contexte de navigation.

Ce registre prépare les vraies corrections post-recette.

---

## 3. Correction appliquée

### 3.1 Fichier ajouté

`rcntrace/field-incident-log.js`

Ce fichier ajoute un panneau flottant intitulé :

`Incidents recette`

Il est visible dans RCN Trace et permet de saisir les incidents localement.

### 3.2 Fichier modifié

`rcntrace/flow-clarity.js`

Le fichier charge désormais automatiquement :

- `transfer-business-locks.js` ;
- `workflow-guide.js` ;
- `field-incident-log.js`.

---

## 4. Fonctionnement du registre

Le registre permet de renseigner :

| Champ | Rôle |
|---|---|
| Étape du flux | Situer l'incident dans le parcours métier |
| Écran concerné | Identifier l'écran RCN Trace concerné |
| Gravité | Bloquant, Majeur, Mineur, Question métier |
| Responsable / observateur | Identifier la personne ayant constaté l'incident |
| Observation terrain | Décrire précisément le problème |

---

## 5. Étapes couvertes

Le registre couvre les étapes suivantes :

1. Réception camion ;
2. Sampling qualité ;
3. Décision GM ;
4. Déchargement / pesée ;
5. Analyse finale ;
6. Lot officiel RCN ;
7. Mise en BIN ;
8. Transfert Bouaké -> Yakro ;
9. Réception Yakro entrepôt ;
10. Transfert Yakro -> Calibrage ;
11. Réception calibrage ;
12. Opération CAL ;
13. Checklist machine ;
14. Sorties / QC ;
15. Bilan matière / audit.

---

## 6. Gravité des incidents

| Gravité | Signification | Décision |
|---|---|---|
| Bloquant | Empêche de continuer le flux | Correction prioritaire |
| Majeur | Le flux continue mais avec risque métier | Correction rapide |
| Mineur | Problème d'ergonomie ou de clarté | Correction planifiée |
| Question métier | Règle à confirmer par l'équipe | Arbitrage métier requis |

---

## 7. Stockage

Le registre utilise uniquement le stockage local du navigateur :

`localStorage`

Aucune écriture n'est faite dans Supabase.

Cela permet de tester sans risque :

- pas de migration ;
- pas de table ajoutée ;
- pas de donnée opérationnelle modifiée ;
- pas de synchronisation automatique ;
- pas d'impact sur les stocks, lots, transferts ou opérations CAL.

---

## 8. Export manuel

Le registre inclut un bouton :

`Copier synthèse`

Il permet de copier les incidents enregistrés afin de les coller dans :

- WhatsApp ;
- email ;
- fichier Excel ;
- rapport de recette ;
- GitHub issue ;
- compte rendu BM / GM.

---

## 9. Tests terrain recommandés

Pendant la recette, l'équipe doit enregistrer un incident chaque fois qu'elle observe :

- une étape impossible à trouver ;
- un bouton ambigu ;
- un blocage inattendu ;
- une règle métier non comprise ;
- une valeur incohérente ;
- une erreur qui n'est pas lisible ;
- une confusion entre Bouaké, Yakro et Calibrage ;
- une confusion entre stock Yakro et matière disponible calibrage ;
- une opération CAL possible alors qu'elle devrait être bloquée ;
- une réception calibrage qui accepte le mauvais type de transfert.

---

## 10. Incident technique pendant l'étape 7

Lors de la première création de `field-incident-log.js`, le contenu transmis a été incomplet.

Le fichier a été immédiatement vérifié, l'anomalie constatée, puis le fichier a été remplacé par une version complète avant toute PR.

Aucune fusion n'a été effectuée avec le fichier incomplet comme état final.

---

## 11. Audit de sécurité

Cette étape respecte les contraintes suivantes :

- aucune suppression ;
- aucune migration Supabase ;
- aucune modification de table ;
- aucune modification de données ;
- aucun reset ;
- aucun changement sur Farmer Buying ;
- `rcntrace.js` non modifié ;
- `rcntrace-ui.js` non modifié.

---

## 12. Limites

Cette étape ne remplace pas une vraie recette terrain.

Elle fournit l'outil de capture des incidents, mais les corrections réelles devront être décidées après analyse des incidents collectés.

---

## 13. Prochaine étape recommandée

Exécuter une recette terrain réelle avec l'équipe.

Ensuite, passer à :

`RCN Trace — Étape 8 : corrections métier sur incidents terrain validés`

Cette étape 8 devra être fondée uniquement sur les incidents réellement observés et documentés.

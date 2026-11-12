# Guide court · Comprendre la situation financière des RT dans FBMS

**Version provisoire (12 novembre 2026) — consultation en environnement de test uniquement.**  
**Ne remplace pas les cartes signées ni les preuves Wave.**

## Ce que les mots veulent dire

| Dans FBMS | Signification simple |
|---|---|
| **Avance enregistrée** | Un montant a été saisi dans l'application. Cela ne prouve pas encore que Finance l'a envoyé. |
| **Achats saisis** | Des achats ont été enregistrés. Tous ne sont pas forcément acceptés par le Chef d'Unité (UH). |
| **Achats vérifiés UH** | Achats portant un statut d'acceptation ET une trace de validation UH reconnue. |
| **Achats en attente** | Une preuve ou une validation manque encore. Ces montants ne sont pas déchargés du compte du RT. |
| **Solde indicatif** | Avances saisies moins achats enregistrés. Ce n'est pas un solde certifié. |
| **Solde à justifier** | Fonds reçus confirmés, moins dépenses acceptées UH et restitutions confirmées, avec ajustements documentés. **Non calculable officiellement avec les champs Wave historiques actuels.** |

## Ce que doit faire le RT

1. Garder les preuves Wave et les reçus d'achat.
2. Suivre les trois cartes papier : noix, argent, sacs de jute.
3. Signer chaque remise importante et le rapprochement hebdomadaire après vérification.
4. Si un chiffre ne correspond pas à ce qu'il détient, écrire « pas d'accord » ou « accord avec réserve » et expliquer la différence.

## Ce que doit faire le Chef d'Unité

1. Vérifier chaque reçu d'achat et sa preuve de paiement.
2. Séparer les achats acceptés des achats restant à contrôler.
3. Comparer les trois cartes avec les ressources réellement présentes.
4. Faire signer la situation hebdomadaire par le RT et contresigner.
5. Signaler immédiatement les écarts au Chef de Zone.

## Ce que doit faire le Chef de Zone

- Vérifier régulièrement les cartes, les documents et les signatures.
- Contrôler physiquement certains stocks sans prévenir.
- Veiller à ce qu'aucun désaccord ne soit effacé ou classé « conforme » sans justification.

## Ce que doit comprendre le Branch Manager

- Le nouvel encart de la branche de test permet de **voir les preuves manquantes**, pas de valider une caisse.
- En l'absence de confirmation Finance/RT, ne pas prendre une avance enregistrée pour de l'argent effectivement reçu.
- Aucune mise à jour en production n'est encore effectuée par cette Pull Request.
- Le contrôle automatique des signatures, de Wave et des BEV nécessite toujours un travail backend testé.

*ANAGROCI / PJS Global — Known for Quality.*

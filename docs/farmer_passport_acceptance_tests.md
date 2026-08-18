# AFLP Farmer Registry — Tests d’acceptation Phase 1

## Résultats serveur exécutés le 18 août 2026

| Test | Résultat |
|---|---|
| Deux producteurs du même village reçoivent des Farmer ID distincts | PASS, `MLAN-0001` et `MLAN-0002` dans une transaction de test |
| RT d’un autre village | PASS, blocage serveur |
| Farmer ID modifié après attribution | PASS, opération refusée |
| Téléphone/nom similaire | PASS, doublon signalé |
| Consentement complet avec périmètres incomplets | PASS, opération refusée |
| Identity + Assignment + consentement complet | PASS, `BASIC`, 65 %, `NOT_ASSESSED` |
| Nouveau consentement partiel | PASS, ancien événement conservé, `INCOMPLETE`, 58 %, `REVIEW_REQUIRED` |
| Numéro de pièce | PASS, stocké dans la table privée seulement |
| Remplacement/retrait d’une pièce | PASS, événement précédent marqué `REPLACED` ou `WITHDRAWN` |
| Audit | PASS, aucun numéro de pièce dans before/after |
| RLS Agent Recenseur | PASS, création et lecture autorisées selon le périmètre |
| Consentement append-only | PASS, UPDATE refusé par les privilèges |
| Journal détaillé pour l’Agent | PASS, inaccessible hors Branch Manager |
| Helpers de périmètre | PASS, déplacés dans le schéma non exposé `private` |
| Nettoyage des données synthétiques | PASS, zéro ligne de test restante |

## Contrôles statiques

```bash
node --check shared/farmer-enrollment-phase1.js
node --check shared/farmer-registry-read-phase1.js
node --check shared/farmer-registry-privacy-phase1.js
node --check shared/uppercase.js
node tests/farmer-registry-phase1.mjs
node .github/scripts/verifier-js.mjs
node .github/scripts/verifier-html.mjs
node .github/scripts/verifier-liens.mjs
```

## Recette navigateur à maintenir

Tester avec données synthétiques aux dimensions :

- 390 × 844
- 768 × 1024
- 1440 × 900

Scénarios : création online, création offline, reprise réseau, tranche d’âge sans année, consentement complet/partiel/refus, doublon confirmé, réouverture de la fiche, pièce privée, changement/retrait de pièce, changement de consentement et affichage sur un second appareil.

Le numéro de pièce ne doit jamais être écrit dans IndexedDB. En ligne, il reste en mémoire jusqu’à l’envoi vers la table privée. Si la synchronisation n’est pas disponible, l’interface avertit l’agent et marque la fiche pour complément ultérieur.

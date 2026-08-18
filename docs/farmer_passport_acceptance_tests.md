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
| Audit | PASS, aucun numéro de pièce dans before/after |
| Nettoyage des données synthétiques | PASS, zéro ligne de test restante |

## Contrôles statiques

```bash
node --check shared/farmer-enrollment-phase1.js
node --check shared/farmer-registry-read-phase1.js
node --check shared/uppercase.js
node .github/agent-tests/farmer-registry-phase1.mjs
node .github/scripts/verifier-js.mjs
node .github/scripts/verifier-html.mjs
node .github/scripts/verifier-liens.mjs
```

## Recette navigateur à maintenir

Tester avec données synthétiques aux dimensions :

- 390 × 844
- 768 × 1024
- 1440 × 900

Scénarios : création online, création offline, reprise réseau, tranche d’âge sans année, consentement complet/partiel/refus, doublon confirmé, réouverture de la fiche, pièce privée, changement de consentement et affichage sur un second appareil.

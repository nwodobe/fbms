# Tests end-to-end (Playwright)

La configuration est en place (`playwright.config.ts`), avec deux profils : bureau et Android
(Pixel 5). Les spécifications des parcours sont écrites dans `TEST_PLAN.md` §6 (E2E-01 → E2E-14).

**Aucun test n'est encore implémenté ici, et c'est volontaire.** Un parcours end-to-end a besoin
d'écrans réels et d'une authentification Supabase raccordée ; les deux arrivent aux phases 2 et 3.
Écrire aujourd'hui des tests qui ne s'exécutent pas donnerait l'illusion d'une couverture qui
n'existe pas — exactement ce que la commande interdit (« Ne prétends jamais qu'une fonction est
terminée avant d'avoir exécuté les tests correspondants »).

Ce que la phase 1 couvre réellement, et qui est exécuté :

| Suite | Ce qu'elle vérifie | Commande |
| --- | --- | --- |
| `tests/db/rls.test.ts` | Isolation multi-tenant, cloisonnement pisteur, immuabilité de l'audit, verrou d'abonnement, assistance auditée | `npm run test:rls` |
| `tests/db/business-rules.test.ts` | Mélange de financements, double réservation, quatre poids, incidents bloquants, idempotence des paiements | `npm run test:rls` |
| `src/domain/*.test.ts` | Contraste des couleurs de marque, arithmétique monétaire et répartition | `npm test` |
| `tests/unit/no-secrets.test.ts` | Aucun secret dans les fichiers versionnés | `npm test` |

## Ordre d'implémentation prévu

| Phase | Parcours |
| --- | --- |
| 2 | E2E-01 (connexion et marque), E2E-02 (société → contrat → prix) |
| 3 | E2E-03 → E2E-05 (financement, avance, achat hors ligne et synchronisation) |
| 4 | E2E-06 → E2E-08 (réservation, quatre poids, incident bloquant) |
| 5 | E2E-09 → E2E-11 (TCB, marge, score expliqué) |
| 6 | E2E-12 → E2E-14 (exports à la marque, cycle d'abonnement, annulation par écriture inverse) |

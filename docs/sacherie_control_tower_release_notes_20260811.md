# Notes de release — Sacherie Control Tower

Version de travail : 2026-08-11 CT1

## Nouveautés visibles

- Command Center Branch Manager.
- Stock global par état.
- Stock par cluster.
- Responsabilité sacs par RT.
- Vue spécifique déchirés / réparation / REBUT.
- Historique du registre canonique.
- Inventaires physiques et écarts.
- Actions de contrôle : inventaire, changement d'état, déclaration de perte et décision BM.
- Workflow SOP-006 conservé dans le même module pour les dotations RT.

## Architecture

Le registre interne `rcn_jute_movements` devient la source de vérité du patrimoine de sacs. `sacs_mouvements` reste compatible pendant la transition et alimente le registre canonique par projection idempotente.

## Statut

Backend testé sur branche Supabase de développement. Frontend isolé sur branche GitHub. Pas encore déployé en Production au moment de la rédaction de cette note.

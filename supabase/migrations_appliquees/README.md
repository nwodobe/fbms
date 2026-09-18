# Migrations appliquées en production hors dépôt

Ce dossier **enregistre** des migrations qui ont été appliquées directement sur
la base de production (projet `jmbdgpdthzpszfnddwzi`) sans passer par le dépôt.

Règles :

- le contenu SQL de chaque fichier est la **copie verbatim** de
  `supabase_migrations.schema_migrations.statements` relevée en lecture seule ;
  rien n'est reconstitué ;
- l'en-tête indique la version, la date réelle d'application et le statut ;
- ces fichiers **ne doivent pas être rejoués** sur la production : la version
  figure déjà dans `supabase_migrations.schema_migrations`. Ils servent à la
  traçabilité et à la reconstruction d'un environnement de test.

| Version | Nom | Statut prod | Versionnée ailleurs ? |
|---|---|---|---|
| 20260918071044 | `sacherie_grant_execute_ct_location` | APPLIQUÉE le 18/09/2026 07:10:44 UTC | Oui, sur la branche non fusionnée `feat/sacherie-security-inventory-journal` sous le nom `supabase/20260917_sacherie_grant_execute_ct_location.sql` (contenu réécrit avec `begin/commit` et commentaires, date de fichier 17/09 ≠ date d'application 18/09) |
| 20260918075721 | `sacherie_rpc_revoke_anon` | APPLIQUÉE le 18/09/2026 07:57:21 UTC | **Non**, nulle part |

Les trois autres migrations du 18/09 (`sacherie_rls_hardening`,
`sacherie_inventory_periodicity`, `sacherie_movement_search`) sont versionnées
sur la branche `feat/sacherie-security-inventory-journal`, pas sur `main`.

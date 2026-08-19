# Plan SQL — Sacherie Control Tower

Ce document décrit les objets testés sur la branche Supabase de développement. Il ne constitue pas une migration automatique de Production.

## Objets ajoutés / étendus en environnement de test

- métadonnées AFLP sur `rcn_jute_locations` : `scope_type`, `cluster`, `rt_id`, `producteur_id` ;
- métadonnées AFLP sur `rcn_jute_movements` : `cluster`, `rt_id`, `producteur_id`, `legacy_sacs_id`, `bag_movement_request_id` ;
- métadonnées de rapprochement sur `rcn_jute_inventories` : `inventory_batch_id`, `reconciliation_status` ;
- helper déterministe de localisation AFLP ;
- bridge idempotent `sacs_mouvements` → `rcn_jute_movements` ;
- backfill historique idempotent ;
- vues `sacherie_ct_global_stock`, `sacherie_ct_cluster_stock`, `sacherie_ct_rt_stock`, `sacherie_ct_latest_inventory` ;
- RPC sécurisée `sacherie_ct_snapshot()` pour le Command Center.

## Règle de déploiement Production

La migration Production devra être adaptée aux contraintes déjà présentes sur les tables `rcn_jute_*`, et non recréer ces tables. Les objets existants RCN TRACE doivent rester compatibles.

Avant le déploiement, il faudra notamment :

1. étendre la contrainte d'état de `rcn_jute_movements` pour prendre en charge `PLEIN` si cet état est conservé dans le ledger ;
2. vérifier les politiques RLS existantes et la compatibilité des rôles AFLP ;
3. corriger le chevauchement des politiques INSERT sur `sacs_mouvements` ;
4. exécuter le backfill sur une copie contrôlée des 11 mouvements historiques avant Production ;
5. comparer les totaux avant / après projection ;
6. préparer le rollback du trigger et des nouvelles vues sans supprimer l'historique canonique.

## Principe de rollback

Un rollback ne doit jamais supprimer les mouvements déjà créés dans le ledger. Il doit uniquement :

- désactiver le bridge ;
- retirer les RPC / vues Control Tower si nécessaire ;
- restaurer les policies précédentes de manière explicite ;
- conserver les colonnes additives et l'historique pour audit.

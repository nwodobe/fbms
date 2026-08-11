# Sacherie Control Tower — guide de lecture

Le travail de cette branche transforme la page `terrain/sacherie_v2.html` en point d'entrée unique pour :

- la visibilité du patrimoine ;
- les vues Cluster et RT ;
- les sacs endommagés ;
- l'inventaire physique ;
- les pertes ;
- l'historique ;
- le workflow d'approval SOP-006 existant.

Les fichiers frontend principaux sont :

- `shared/anagroci-sacherie-control-tower.js` : lecture / dashboard ;
- `shared/anagroci-sacherie-control-actions.js` : opérations de contrôle ;
- `shared/anagroci-sacherie-v2.js` : workflow SOP-006 existant.

Les objets SQL ont été développés et testés sur une branche Supabase dédiée et sont documentés dans les fichiers `sacherie_control_tower_*` de ce dossier. Le déploiement Production reste volontairement séparé de la branche GitHub afin de respecter les protections du repository sur `supabase/**`.

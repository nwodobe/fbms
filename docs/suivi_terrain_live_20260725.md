# Suivi Terrain Live — trajets d'équipe en direct & historique (25/07/2026)

## Objet

Nouveau module `SUI` de la suite ANAGROCI, façon « Uber » interne : chaque membre
de l'équipe terrain démarre un **trajet** depuis son téléphone ; sa position GPS
remonte en continu vers la base et alimente :

- un **cockpit de supervision** (carte live des équipes actives, trace du jour,
  statut En mouvement / À l'arrêt / Signal perdu, distance, batterie) ;
- un **historique des missions** (recherche par jour et par membre, tracé du
  parcours, relecture animée, export CSV).

## Fichiers

| Fichier | Rôle |
|---|---|
| `terrain/suivi.html` | Application 3 onglets : Mon trajet (traceur), Supervision live, Historique |
| `supabase/suivi_terrain.sql` | Tables `suivi_trajets` / `suivi_positions`, index, RLS, publication realtime |
| `shared/auth-gate.js` | Matrice ACCESS : module `suivi` ouvert à bm / chef / agent / direction |
| `shared/suite-bar.js` | Registre MODULES : code `SUI` |
| `index.html` | Carte du portail (groupe Opérations terrain, badge LIVE) |

## Déploiement

1. Exécuter `supabase/suivi_terrain.sql` dans Supabase → SQL Editor
   (**après** `supabase/rls.sql` : les fonctions `est_actif`, `est_bm`,
   `peut_editer_terrain` doivent exister). Script rejouable.
2. Publier le site (les pages sont statiques, rien d'autre à faire).
3. Vérifier : un compte agent démarre un trajet sur téléphone → il apparaît en
   direct sur l'onglet Supervision d'un compte BM.

## Choix techniques

- **Id de trajet généré côté client** (uuid) : permet de démarrer un trajet
  hors couverture réseau ; la ligne `suivi_trajets` est upsertée à la première
  synchronisation.
- **File hors ligne** (`localStorage` : `fbms_suivi_trajet` + `fbms_suivi_q`,
  plafond 800 points) : les points sont insérés par lots de 60 toutes les 15 s
  et ne sont retirés de la file qu'après insertion réussie. Reprise
  automatique du trajet en cours après rechargement de la page.
- **Filtrage GPS** : précision ≤ 150 m ; point retenu si déplacement ≥ 12 m ou
  25 s écoulées ; incrément de distance ignoré au-delà de 55 m/s (rebonds GPS).
- **Dernière position dénormalisée** sur `suivi_trajets`
  (`derniere_lat/lng`, `dernier_point_a`, vitesse, batterie) : le cockpit
  n'interroge pas la table de points pour afficher la flotte.
- **Temps réel** Supabase (`postgres_changes` sur les deux tables, RLS
  respectée) avec repli sur un rafraîchissement toutes les 20 s.
- **RLS** : lecture pour tout profil actif ; chacun n'insère que ses propres
  trajets/points ; clôture par le propriétaire ou le BM (trajet resté « actif »
  après perte d'un téléphone) ; suppression réservée au BM.
- **Rôles dans l'UI** : la direction (consultation) n'a pas d'onglet
  « Mon trajet » ; un agent ne consulte que son propre historique,
  l'encadrement voit toute l'équipe.

## Limites connues (assumées pour ce premier livrable)

- Le suivi s'interrompt si le téléphone verrouille l'écran ou ferme le
  navigateur (pas de service de fond en PWA) ; le Wake Lock est demandé pour
  garder l'écran allumé pendant le trajet.
- Relecture limitée aux 5 000 premiers points d'un trajet ; traces live du
  jour plafonnées à 4 000 points toutes équipes confondues.

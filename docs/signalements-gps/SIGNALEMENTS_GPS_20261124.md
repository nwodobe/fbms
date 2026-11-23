# Signalements GPS : signaler un point douteux sans le modifier (24/11/2026)

Suite du contrôle du 23/11/2026 : un point « capturé sur le champ » avait été pris au village
(à une centaine de mètres du centre), alors que le champ est à plusieurs kilomètres. FBMS n'avait aucun
moyen de le signaler. Données de test **fictives** uniquement (base de recette `fbms-recette-observatoire`).

## 1. Ce qui change à l'écran

| Profil | Fiche parcelle (`#parcelles/p/…`) et Repères GPS (`#reperes/objet/…`) |
|---|---|
| Branch Manager, Chef de Zone (sa zone) | Bouton **« Signaler ce point »** sous le point GPS de référence, et sous un repère reçu par le serveur. Motif à choisir + description obligatoires (10 caractères au moins). Puis **Résoudre**, toujours motivé : point corrigé, point confirmé exact, classé sans suite. |
| Chef d'Unité, assistant (son cluster) | Liste **« Points GPS signalés à faire vérifier »** en tête de Parcelles et de Repères GPS ; ouverture de la fiche, **réponse** écrite (ce qui est fait sur le terrain). Ni signalement ni résolution. |
| Tous | Le signalement ouvert est affiché sur la fiche ; les signalements clos restent dans un historique. |

Le point lui-même n'est **jamais** modifié. Il se corrige par les voies existantes (« Cartographier ce champ »,
Repères GPS) ; le signalement ne peut être déclaré « point corrigé » que si le point a réellement changé.

Hors ligne : la fiche reste utilisable, les signalements s'affichent au retour du réseau (action de supervision,
sans file locale). Serveur sans la migration : « indisponible », rien d'autre ne change.

## 2. Choix technique

`public.farmer_plot_anomalies` n'a pas été relâchée : son `geometry_id NOT NULL` porte sa politique RLS, le compteur
`anomalies_ouvertes` de `plot_map_parcelles_v`, le blocage de la validation des contours et le classement. Les
anciens clients la lisent. Relâcher aurait changé quatre comportements existants.

Migration additive `supabase/20261124090000_aflp_signalements_gps_1.sql` :

- `public.geo_signalements` : cible (`POINT_PARCELLE` ou `REPERE`), copie du point au moment du signalement, motif,
  état `OUVERT → RESOLU | CLASSE`, résolution motivée. Un seul signalement ouvert par cible (index unique partiel).
- `public.geo_signalements_evenements` : journal SIGNALER / REPONDRE / RESOUDRE.
- `public.geo_signalements_v` : vue de lecture (invocateur).
- Écriture **uniquement** par `geo_signalement_creer`, `geo_signalement_repondre`, `geo_signalement_resoudre`
  (SECURITY DEFINER, `search_path` figé). Aucune politique d'écriture ; `anon` sans aucun droit.
- Lecture : même RLS que `farmer_plot_anomalies` (données sensibles du registre + `plot_map_peut_lire`, zone pour un Chef de Zone).
- Le point vu à l'écran est renvoyé au serveur : s'il a changé entre-temps, le signalement est refusé (GS409).
- Distance au centre du village calculée par le serveur (haversine) : indicateur, pas une preuve.
- Aucune table, colonne, contrainte, fonction, vue ni donnée existante modifiée.

Retour arrière : `supabase/20261124090100_aflp_signalements_gps_1_rollback.sql` retire les trois fonctions ; tables et
lignes conservées en lecture. L'écran affiche alors « indisponible ».

## 3. Preuves

| Banc | Où | Résultat |
|---|---|---|
| Serveur (recette `bjhqaofnrptgaxcpmrxi`, transaction annulée) | `tests/signalements-gps/serveur_signalements.sql` | **35/35** ; base identique avant/après (0 signalement, profil fictif retiré) |
| Conseillers de sécurité Supabase (recette) | — | Aucune alerte nouvelle hors les 3 fonctions appelables par les connectés (voulu, même schéma que l'existant) |
| Navigateur (Chromium, serveur simulé dans la page) | `tests/signalements-gps/navigateur.mjs` | **30/30**, 390 / 768 / 1440 px, 0 erreur de console ; captures dans `tests/signalements-gps/resultats/` |
| Portes du dépôt | `verifier-js`, `verifier-html`, `verifier-liens`, tests statiques existants | 0 nouvelle erreur |

Contrôles serveur couverts : droits par rôle (BM, Chef de Zone de la zone / d'une autre zone, Chef d'Unité du cluster /
d'un autre cluster, assistant, compte inactif, anon), motif obligatoire, point vu ≠ serveur, parcelle sans point,
unicité du signalement ouvert, `farmer_plots` et `geo_reperes` intacts, « point corrigé » refusé tant que le point
n'a pas changé puis accepté après reprise, double résolution refusée, écriture directe refusée,
`farmer_plot_anomalies` inchangée.

## 4. Limites

- La recette n'a pas de Chef de Zone : le banc serveur en crée un fictif le temps de la transaction.
- Le banc navigateur simule le serveur ; la combinaison écran + serveur réel n'a pas été jouée connectée (aucun
  compte Branch Manager de recette utilisable par un agent).
- Un signalement ouvert ne bloque rien (ni achat, ni validation de contour, ni éligibilité) : il informe et se suit.
- Aucune notification poussée : le Chef d'Unité voit la liste en ouvrant Parcelles ou Repères GPS.
- Le profil Assistant Branch Manager lit les signalements mais ne signale pas (règle de la demande : BM et Chef de Zone).

## 5. Mise en production (non faite)

Ordre : migration en production → fusion → publication OTA signée stable (`android/README.md`). Sans la migration,
l'écran publié affiche seulement « indisponible ».

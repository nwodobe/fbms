# Architecture du reporting et proposition d'intégration dans FBMS

## 1. Comparaison des trois options

| Critère | A. Manuel depuis un export | B. Extraction lecture seule + génération locale (**réalisé**) | C. Espace intégré à FBMS |
|---|---|---|---|
| Coût | Nul en outil, ~2 h par semaine | Nul (Python local) ; développement fait | Développement + migrations + recette (plusieurs jours) |
| Simplicité d'usage | Faible (copier-coller) | Un double-clic le lundi | Un bouton dans l'application |
| Maintenabilité | Mauvaise (règles dans la tête) | Bonne : règles en code, 15 tests | Bonne si règles en SQL testé ; plus de surfaces |
| Sécurité | Export = fichier qui circule | Compte personnel, RLS, GET seulement, pas de clé de service | La meilleure si fonction serveur dédiée aux rôles de management |
| Connectivité terrain | Sans objet | Requiert Internet au moment du gel (bureau) | Idem ; aucun impact sur la saisie hors ligne |
| Risque d'erreur | Élevé (double comptage, oubli des PAS_VU) | Faible, testé ; dépend de la discipline du gel | Faible ; risque de régression applicative |
| Traçabilité | Faible | Instantané gelé + empreinte + manifeste | Possible (table de rapports gelés) |

**Recommandation** : exploiter B dès maintenant ; préparer C seulement quand le Niveau 1 est atteint (données réelles
pendant au moins quatre semaines), pour intégrer des règles éprouvées plutôt que des hypothèses.

## 2. Option C : conception proposée (non développée, non appliquée)

Principe : ne pas créer de nouvelle architecture ; étendre le module Observatoire existant.

1. **Vues corrigées** (migration proposée `aflp_observatoire_8_rapport`, à recetter sur `fbms-recette-observatoire`) :
   - `pheno_v_champ_semaine_retenue` : une ligne par (campagne, champ, semaine) avec `distinct on (panel_id, semaine_iso)
     order by date_observation desc, valide_le desc` sur visites VALIDE + NORMALE ;
   - `pheno_v_c_cumulatif_cluster` recalculé à partir de cette vue (couverture ≤ 100 %), en tenant compte de la date d'installation ;
   - filtre explicite sur la campagne `REAL` courante.
2. **Fonction serveur** `public.pheno_rapport_direction(p_semaine text)` `security definer`, qui refuse tout appelant dont
   `private.pheno_classe()` n'est pas BM, ABM ou ZH (la RLS actuelle laisse un Unit Head lire les données brutes de son
   cluster, ce qui est voulu pour la collecte mais insuffisant pour un rapport confidentiel). Le masquage d'un bouton n'est pas une protection.
3. **Table** `pheno_rapports_geles` (semaine, gel_le, empreinte, résultats JSON, auteur) : un rapport transmis n'est jamais réécrit ;
   un complément crée une nouvelle ligne liée.
4. **Écran** « Intelligence agricole & rapports » dans l'espace Management de la navigation V2.1, visible pour BM, ABM, ZH,
   lisant la fonction serveur ; export PDF et Excel côté navigateur ou via le générateur B.
5. **Tests** : réutiliser les 12 cas du moteur comme jeux SQL fictifs dans `tests/observatoire/sql`, plus tests de droits
   (UH, AUH, Supervisor refusés).

Tout ce qui touche `supabase/**`, les RLS et la publication exige l'autorisation explicite du Branch Manager.

## 3. Revue contradictoire du système

| Question | Réponse et parade |
|---|---|
| Quels indicateurs peuvent donner une fausse impression de précocité ? | La floraison sur arbres désignés : un Chef d'Unité tend à choisir des arbres vigoureux, visibles, près du chemin, souvent plus précoces. Une semaine à 1 ou 2 champs donne des % instables. Parade : seuil de 10 arbres, mention « non représentative », évolution seulement sur panel apparié. |
| Quels biais de sélection ? | Désignation non probabiliste ; champs choisis chez des producteurs coopératifs et accessibles ; villages proches des routes. Parade : documenter les critères de choix, viser un tirage probabiliste au Niveau 2. |
| Comment une mauvaise synchronisation peut-elle masquer une évolution ? | Des visites restées sur téléphone font baisser la couverture et peuvent faire disparaître un cluster entier d'une semaine. Parade : contrôle des synchronisations le lundi avant le gel ; « reçues après clôture » et compléments tardifs tracés. |
| Comment éviter que l'agronomie soit lue comme une promesse de tonnage ? | Aucun tonnage n'est calculé ; la cible de 3 000 MT est affichée comme cible d'achat ; mention en pied de page ; garde-fou codé contre toute recommandation financière chiffrée. |
| Quelles données réduiraient le plus l'incertitude ? | 1) installation des 27 champs manquants ; 2) visites validées régulières ; 3) premiers achats et BEV enregistrés dans FBMS ; 4) informations de marché structurées (second mandat) ; 5) plus tard, un tirage probabiliste. |
| Quand recommander de ne prendre aucune décision opérationnelle ? | Tant que tous les clusters sont en confiance FAIBLE ou INSUFFISANTE, ou qu'aucune donnée d'achat ni de fonds n'est sourcée. C'est le cas en semaine 47 : le générateur l'écrit explicitement. |

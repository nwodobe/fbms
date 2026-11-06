# AFLP FLEET | Prototype de prévision carburant (6 novembre 2026)

## État de livraison

**Prototype métier calculatoire uniquement**. Aucun composant de l'interface de production ni table Supabase n'a été modifié. Un agent ne doit pas considérer la création de cette branche comme un déploiement. Intégration, notifications serveur, paramètres approuvés et RLS nécessitent une revue distincte.

### Paramètres
- Consommation de base 4 L/100 km; sensibilité +10 % : **4,4 L/100 km**.
- Délai de ravitaillement : **24 heures**.
- Prix de simulation : 905 FCFA/L.
- Besoin dans les prochaines 24 heures : km routiers fiables × 0,044.
- Sécurité : consommation prévue dans la journée suivante ou profil historique journalier validé.
- Seuil d'alerte = besoin des 24 prochaines heures + sécurité.
- Ne pas appliquer une seconde fois les +10 %.

**Exemple fictif** : 60 km/jour pendant 2 jours, 2,64 L/jour; réserve 2,64 L; alerte 5,28 L. En cas de réservoir inférieur à ce niveau, il faut prévoir un ravitaillement intermédiaire; ne pas plafonner la distance.

## API du module sans effet de bord

`moto/moto-carburant-previsionnel.js` expose `MOTO_CARBURANT_PREVISIONNEL` dans le navigateur et `require(...)` sous Node.

- `parametres(options)` contrôle les valeurs.
- `litresPourKm(km, options)` calcule le volume prévisionnel.
- `missionsIntervalle(missions, debutMs, finMs)` rapproche les missions distinctes avec distances documentées.
- `stockEstime(moto, achats, options)` reconstitue la quantité théorique à partir d'une ancre physique vérifiée.
- `prevoir({ moto, achats, missions, maintenant, planning_complet, historique_fiable, km_jour_historique })` fournit les seuils, le statut, le besoin et la proposition de ravitaillement.

La capacité `capacite_l`, l'ancre `stock_initial_l` et le kilométrage initial sont explicitement marqués comme vérifiés. Ils ne correspondent **pas actuellement à des champs identifiés de la base de production**. Ces entrées doivent être obtenues par une procédure d'initialisation et un stockage approuvé, sans les inventer.

Le tableau des missions doit fournir un identifiant, une date de départ, une distance **aller-retour** en kilomètres et un indicateur de fiabilité de la distance. Le planning hebdomadaire Excel n'est pas une table de missions synchronisées dans AFLP FLEET.

**Limites du prototype** :
1. Les vues existantes de consommation ne permettent pas encore d'estimer un niveau physique de réservoir.
2. Les quatre motos observées ont actuellement des pleins non vérifiés (observation du 6/11/2026); aucune quantité actuelle exacte n'est déductible.
3. Si le planning est incomplet, les seuils restent provisoires, même avec une moyenne historique.
4. Les missions en cours, les heures de fin et les parcours multiples nécessitent un rapprochement métier avant intégration.
5. Si des événements historiques sont absents ou enregistrés hors ordre, l'autonomie peut être inexacte; contrôler les anomalies avant décision.
6. Une estimation côté navigateur n'émet aucune notification sans ouverture de l'application. Les notifications proactives nécessitent une tâche serveur planifiée et des accès spécifiquement autorisés.
7. Les suggestions sont des calculs, **ni dotations autorisées ni paiements**.
8. Le paramètre actuel `conso_reference_l100=3` demeure inchangé : sa modification pourrait affecter les alertes historiques de consommation.
9. Le code doit être revu et testé sur trois largeurs d'écran **après** intégration HTML, conformément au dépôt.

## Recette locale déterministe
```sh
node --check moto/moto-carburant-previsionnel.js
node tests/moto/carburant-previsionnel.test.cjs
```

21 cas vérifient la sensibilité, les alertes, les données absentes, les pleins, la capacité, la chronologie, la déduplication, les distances et les suggestions. Tests exécutés localement sur copie de travail le 6/11/2026; aucun test réel de notification ou de navigateur connecté n'a été effectué.

## Séquencement de validation avant une mise en production

1. Faire vérifier les capacités réelles des réservoirs et créer une ancre lors d'un plein confirmé, avec kilométrage et vérification du justificatif.
2. Fixer une source des missions futures, et distinguer le trajet réel, le trajet estimé et l'absence de trajet.
3. Concevoir les migrations et RLS en **proposition soumise à revue humaine**; ne pas modifier `supabase/**` sans permission dédiée.
4. Intégrer le module aux pages de FBMS sur une branche, avec contrôles des autorisations et de la synchronisation hors ligne.
5. Ajouter un moteur d'alertes serveur qui fonctionne sans navigateur ouvert, avec antidoublons, journal et circuit de décision interne.
6. Tester sur 390×844, 768×1024 et 1440×900 et rejouer les vérifications existantes du dépôt.
7. Obtenir l'approbation de publication et valider un plan de retour arrière. Ne rien fusionner automatiquement.

## Audit documentaire à présenter au Branch Manager

- **MOTO-003** : compteur 231 km, dernier achat enregistré à 2 km, soit 229 km entre ces relevés; le stock restant n'est pas déterminable sans quantité d'ancrage vérifiée.
- **MOTO-004** : compteur 150 km, dernier achat à 5 km, soit 145 km.
- **MOTO-005** : compteur 57 km, dernier achat à 2 km, soit 55 km.
- **MOTO-006** : compteur 84 km, dernier achat à 2 km, soit 82 km.

Ces observations sont datées du 6/11/2026 et ne prouvent pas une consommation réelle ni une rupture de carburant.

**État : prototype de calcul testé; intégration produit, schéma de stockage, notifications et validation de production non réalisés.**

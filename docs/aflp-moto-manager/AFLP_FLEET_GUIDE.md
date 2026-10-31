# AFLP FLEET : guide pratique par rôle

AFLP FLEET (ex AFLP Moto Manager) gère le parc de motos AFLP. Adresse inchangée : `moto/index.html`.
Règle d'or : **prévue, réceptionnée, affectée et opérationnelle sont quatre situations différentes**. Seul le Branch Manager autorise une moto à circuler.

## Calendrier mensuel

| Jours | Qui | Quoi |
|---|---|---|
| 1 au 15 | Chef de zone | Une inspection physique par moto active de Chef d'unité de sa zone, pendant la visite terrain habituelle |
| 16 au 19 | Coordinateur logistique | Analyse des inspections, priorisation, programmation des tournées et du garage |
| 20 à la fin du mois | Coordinateur logistique | Inspection de toutes les motos actives, sauf la sienne |
| 20 à la fin du mois | BM, ABM ou inspecteur désigné | Contrôle indépendant de la moto du coordinateur |

Une moto mise en service après le début d'une fenêtre ne doit rien pour ce mois : aucune inspection rétroactive. Une anomalie critique immobilise la moto **immédiatement**, sans attendre l'inspection suivante.

## Branch Manager

1. **Pilotage → Exceptions à traiter** : motos immobilisées, anomalies critiques, réparations en retard, inspections manquantes, enveloppes à autoriser, anomalies récurrentes, risque d'interruption. Le reste ne demande pas votre validation.
2. Vous préaffectez, vous autorisez la circulation (mise en service), vous approuvez les enveloppes du coordinateur et vous levez une immobilisation après contrôle APTE fait **par une autre personne** et anomalie critique vérifiée.
3. Désignation d'un inspecteur indépendant pour la moto du coordinateur : paramètre `inspecteurs_independants` (liste des comptes).
4. **Avant la première utilisation** : renseigner la zone de chaque Chef de zone dans son profil FBMS (sans zone, il ne peut pas inspecter) et la fonction opérationnelle « Logistics Coordinator » du coordinateur.

## Coordinateur logistique (espace « Coordination »)

1. En haut : **Actions prioritaires** (problème, moto, responsable, échéance, statut, bouton). Commencez toujours par là.
2. Enregistrer une moto : neuve réceptionnée, **acquisition prévue**, ou **moto déjà en exploitation** (sans historique inventé : laissez vide ce qui n'est pas justifié).
3. Pour une moto en exploitation : passeport → **État technique de référence** (mécanicien qualifié, compteur, au moins 5 photos dont le compteur). Le suivi fiable commence à cette date.
4. Du 20 à la fin du mois : bouton **Inspecter** sur chaque moto. Le tableau de comparaison montre les inspections précédentes ; l'onglet Photos montre l'historique photographique. Le résultat est calculé par le serveur : une anomalie encore ouverte empêche « Conforme ».
5. Anomalies : **Planifier** (garage, devis, date cible) → **Déclarer réalisée** (facture si dépense) → une autre personne **vérifie**. La clôture ne remet pas la moto en circulation.
6. Enveloppes mensuelles « Déplacements de supervision » et « Entretien et réparation » : vous demandez, le BM approuve, vous déclarez les dépenses avec justificatif, un tiers (BM, ABM ou Finance) les valide. Aucun argent n'est transféré par l'application.
7. Vous ne pouvez pas : mettre en service, lever une immobilisation, approuver vos enveloppes, valider vos dépenses, inspecter votre propre moto, modifier les paramètres.

## Chef de zone

1. **Opérations → Mes inspections du mois** : la liste des motos des Chefs d'unité de votre zone. Bouton **Inspecter**.
2. Photo du compteur obligatoire, au moins 2 photos. Après le 15, l'inspection est enregistrée comme **tardive**.
3. Vous voyez tout le parc, mais vous n'agissez que sur les motos de votre zone (et la vôtre pour les saisies terrain).

## Chef d'unité

1. **Opérations** : contrôle avant départ, relevé, carburant, incident, demande d'entretien, **signaler une anomalie** (avec photo). Tout fonctionne sans réseau ; une saisie n'est « synchronisée » qu'après réponse du serveur.
2. À la remise : **État de remise à confirmer** apparaît. Examinez la moto et les photos avec l'agent, puis acceptez, acceptez avec réserves ou contestez. Sans votre réponse, la remise est bloquée.

## Assistant Branch Manager

1. Enregistre les motos, les documents, l'**inspection mécanique initiale**, puis l'**état contradictoire avant remise** (5 photos : avant, arrière, deux côtés, compteur), puis la remise avec le PV papier signé et vérifié par un autre responsable.
2. Peut effectuer le contrôle indépendant de la moto du coordinateur.
3. Ne peut pas enregistrer l'état ni la remise de sa propre moto : le coordinateur ou le BM s'en chargent.

## QR code

Le QR du passeport ouvre la fiche de la moto dans AFLP FLEET. L'accès reste soumis à la connexion FBMS et au périmètre du compte. Saisie manuelle de secours : le code `MOTO-xxx` dans la liste. Aucune lecture automatique (OCR) n'est proposée.

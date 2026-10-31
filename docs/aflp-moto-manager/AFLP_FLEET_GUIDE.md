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

---

# Maintenance et dépenses (phase 2, migration 6)

**Règle fondamentale.** Aucune dépense d'entretien ou de réparation n'est engagée sans **autorisation individuelle préalable du Branch Manager**, quel que soit le montant. Un budget ou une enveloppe approuvés ne sont jamais une autorisation. En cas de danger : arrêter la moto et déclarer un incident ; l'absence d'autorisation de réparation n'autorise jamais à circuler.

Espace **Maintenance** : Tableau de bord · Décisions à prendre · Dossiers · Garages · Règles d'entretien.

## Coordinateur logistique
1. **Chaque matin** : *Tableau de bord* › « Maintenance à programmer ». Une ligne « Pris en charge » a déjà un dossier : ne rien refaire.
2. **Nouveau dossier** (ou « Créer le dossier » depuis l'alerte) → **Organiser le diagnostic** si nécessaire. Diagnostic payant : « Diagnostic payant : demander au BM » *avant* d'aller au garage.
3. **Enregistrer le devis** : garage, montant, pièces et main-d'œuvre, opérations (jusqu'à 3 par visite), justification, conséquence d'un report, **photo ou PDF du devis**.
4. **Soumettre au Branch Manager**. Rien ne peut être engagé avant sa décision.
5. Après autorisation : **Programmer les travaux** avec un montant engagé **au plus égal** au plafond autorisé. Au-delà : **Soumettre un supplément**.
6. **Démarrer** (la moto est immobilisée), puis **Déclarer les travaux effectués** opération par opération, avec le compteur réel.
7. **Déposer la facture** (scan obligatoire). Une facture au-dessus de l'autorisation est signalée au BM et ne peut pas être vérifiée.
8. Vous ne contrôlez pas vos propres travaux ; vous ne levez pas une immobilisation.
- **Intervention sans frais** (garantie, travail interne) : bouton dédié, motif obligatoire ; aucun montant ne pourra être engagé.
- **Garages** : enregistrer les garages réels (statut *candidat*), puis « Marquer évalué ». Seul le BM approuve.
- **Règles d'entretien** : associer chaque moto à son modèle technique (preuve : plaque, carte grise) ; proposer une version de règle avec sa source. Une proposition reste inactive.

## Branch Manager
- *Maintenance › Décisions à prendre* (s'ouvre par défaut ; rappel en tête du *Pilotage*). Chaque carte : moto et utilisateur, problème, proposition et garage, montant, conséquence d'un report, justification, pièce du devis.
- **Autoriser ou refuser** : montant maximal (≤ demandé ; commentaire obligatoire si réduit ou refusé). Décision nominative et horodatée. Vous ne pouvez pas décider une demande concernant votre propre moto.
- **Synthèse hebdomadaire des exceptions** : factures hors autorisation, factures non vérifiées depuis 7 jours, réparations en retard, immobilisations longues, entretiens dépassés non pris en charge, historiques à établir.
- **Règles** : approuver ou retirer une version (date d'effet, motif). Une *hypothèse* ne peut pas être approuvée : elle doit être requalifiée (constructeur avec référence, ou politique interne validée techniquement).
- **Garages** : approuver ou suspendre.
- **Remise en circulation** : passeport › Entretiens › « Remettre en circulation » (si vous n'avez pas fait le contrôle de remise en service).

## Chef de zone
- Signaler un besoin (passeport › Entretiens, ou Opérations › Demande d'entretien, aussi hors connexion : ce n'est qu'un signalement).
- **Contrôler les travaux** terminés (sauf sur votre propre moto) ; contrôle de remise en service ; levée d'immobilisation si vous n'êtes ni l'auteur du contrôle ni l'utilisateur.
- Aucun pouvoir financier : pas d'autorisation, pas d'engagement, montants masqués.

## Assistant Branch Manager
- Peut préparer et soumettre un dossier en l'absence de coordinateur ; ne décide pas.
- **Vérifie les factures** (pièce conforme, dans le montant autorisé) déposées par un autre ; clôture financière.

## Finance
- Vérifie les factures ; **constate les paiements réels** (montant, date, référence). AFLP FLEET n'exécute aucun paiement.
- Clôture financière lorsque toutes les pièces sont vérifiées.

## Ce qui actualise une échéance
Seule une opération **réalisée et contrôlée conforme** remet à zéro **sa propre** échéance (une vidange ne remet pas à zéro la révision). Une inspection mensuelle ou un contrôle avant départ ne prouvent pas qu'un entretien a été fait et ne créent aucune facture.

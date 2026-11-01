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

# Documents scannés, permis des conducteurs, carnet de suivi (migration 7)

Trois nouveautés :
- **scanner** les documents ;
- rattacher le **permis** au conducteur, et non plus à la moto ;
- consulter le **carnet de suivi**, qui retrace toute la vie d'une moto.

## Scanner un document

1. Touchez **Scanner**.
2. Photographiez la page (**Photographier une page**), ou importez la photo depuis la galerie.
3. Recommencez pour le verso. Une même numérisation peut contenir jusqu'à 6 pages.
4. Si besoin, ajustez chaque page :
   - **Pivoter** la redresse ;
   - **Recadrer** : faites glisser les quatre coins pour ne garder que le document ;
   - **↑** change l'ordre des pages.
5. Laissez le **mode document** coché : le document est plus lisible et le fichier plus léger.
6. Touchez **Valider le document** : les pages forment un seul PDF, assemblé sur le téléphone, même sans réseau.
7. Un PDF déjà numérisé s'ajoute directement avec **Importer un PDF**.

**Rien n'est lu automatiquement.** Vous recopiez les numéros en lisant le document. C'est voulu : une lecture automatique jamais éprouvée sur nos cartes grises et nos permis pourrait inventer un numéro de châssis ou de permis.

Où trouver le scan :
- **Enregistrer une moto**, **Intégrer une moto en exploitation** et **Enregistrer la réception physique** proposent directement la carte grise, l'assurance et la plaque. Pour l'assurance, la date d'expiration est obligatoire.
- Le passeport, onglet **Documents**, permet ensuite de compléter.
- Chaque document reste **En vérification** jusqu'au contrôle par un autre responsable.

## Permis de conduire

Le permis appartient au conducteur : il le suit d'une moto à l'autre.

- **Conducteur** (Chef d'unité, Chef de zone, ABM, coordinateur) :
  - ouvrez **Mes motos**, bloc **Mon permis de conduire**, puis **Scanner mon permis** ;
  - recopiez nom, numéro, catégories, dates ;
  - à l'échéance, touchez **Scanner un permis renouvelé**. L'ancien permis reste valable jusqu'au contrôle du nouveau.
- **BM, ABM, coordinateur**, espace **Conducteurs** : vous voyez tous les conducteurs et pouvez scanner un permis pour l'un d'eux.
- **Contrôle sur original** : il est fait par l'**ABM ou le Branch Manager**, jamais par la personne qui a déposé le permis ni par son titulaire. On ouvre le scan, on le compare à l'original, puis on indique qui (RH) a vu l'original et on confirme que la catégorie est adaptée à la moto.
- **Remise et transfert** : le serveur les refuse sans permis contrôlé conforme et en cours de validité. La catégorie et le nom du vérificateur sont repris du permis enregistré ; il n'y a plus de case à cocher.
- **Alertes** : l'espace Conducteurs signale tout conducteur affecté dont le permis expire dans moins de 30 jours (réglable) ou n'est plus valide.
- **Confidentialité** : un permis n'est visible que du BM, de l'ABM, du coordinateur et de son titulaire. Ni le Chef de zone ni la Finance ni la Direction n'y ont accès.

## Carnet de suivi d'une moto

Dans le passeport, ouvrez l'onglet **Carnet de suivi**. Il présente toute la vie de la moto, du plus récent au plus ancien :
- réception, affectations (avec le permis vérifié), mise en service ;
- inspections et anomalies ;
- entretiens et réparations : besoin, travaux, contrôle, clôture ;
- décisions du BM, factures et paiements ;
- pneus ;
- carburant (un total par mois) ;
- incidents, immobilisations et documents.

En tête du carnet, les coûts :
- coût d'entretien documenté (factures vérifiées, chacune comptée une seule fois) ;
- carburant vérifié ;
- coût direct par kilomètre ;
- nombre d'interventions ;
- jours d'immobilisation cumulés ;
- engagements pas encore facturés.

Les filtres isolent une rubrique (par exemple « Entretiens et réparations »). **Exporter (Excel)** produit un classeur à deux onglets, Synthèse et Carnet ; **Imprimer / PDF** imprime le carnet seul.

Le Chef de zone et le Chef d'unité voient toute la chronologie technique, mais ni les décisions de dépense, ni les factures, ni les montants d'entretien (« Accès réservé »).

Pour une moto intégrée sans historique (cas JACKSON), le carnet commence au début du suivi fiable : rien n'est reconstitué avant.

# Journal de mission et kilométrage contrôlé par photo (migration 8)

Chaque sortie avec une moto est une **mission** : photo du compteur au départ, photo du compteur à l'arrivée. Ce journal sert à connaître la distance parcourue par chaque agent pour les missions, les kilomètres roulés hors mission et le coût d'un kilomètre utile. Il ne sert pas à sanctionner : un écart déclenche une vérification.

## Chef d'unité (et tout conducteur)

**Au départ** (espace Opérations, bloc « Ma mission ») :
1. **Démarrer une mission**.
2. Alignez les chiffres du compteur dans le cadre orange, puis **Photographier le compteur**. La photo est prise par l'application : la galerie n'est pas accessible.
3. Le téléphone **propose** le chiffre lu. Vérifiez-le sur le compteur : s'il est faux, corrigez-le. S'il n'a rien pu lire, saisissez le chiffre en lisant le compteur.
4. Choisissez l'objet et la destination (le choix précédent est repris), puis **Valider le départ**.

**À l'arrivée** : **Terminer la mission**, photographiez, confirmez le chiffre, validez.

**Sans réseau** : tout fonctionne. La mission part automatiquement au retour de la connexion. Gardez le téléphone à l'heure : un écart avec l'heure du serveur est signalé.

**Ce que voient vos responsables** : la photo du compteur (date, heure, moto, votre nom, localité), le chiffre retenu et s'il a été lu, corrigé ou saisi. **Jamais vos coordonnées GPS** sur la photo. La position exacte est conservée à part, pour le Chef de zone, le coordinateur, l'ABM et le BM.

**Le serveur refuse** :
- un compteur inférieur au précédent ;
- une deuxième mission ouverte ;
- une moto immobilisée ou non mise en service ;
- un conducteur sans permis vérifié ;
- une photo absente ou déjà utilisée.

En cas d'erreur sur un compteur déjà envoyé, demandez une correction au Chef de zone. La correction est validée par un autre responsable.

## Chef de zone, coordinateur, ABM

Espace **Missions** :
- missions du mois ;
- km de mission et hors mission par agent et par moto ;
- missions non clôturées à temps ;
- part des relevés corrigés ou saisis ;
- **écarts à vérifier**.

Pour un écart :
1. Ouvrez les photos : cliquez sur le compteur. L'application vérifie que la photo n'a pas été modifiée (empreinte).
2. Entendez l'agent.
3. Décidez « Justifié » ou « Non justifié », avec un motif.

Le conducteur ne tranche jamais ses propres écarts.

Une mission ouverte par erreur ou jamais clôturée s'**annule**, avec un motif. Elle n'est jamais estimée : ses kilomètres apparaîtront comme « hors mission » au départ suivant.

## Branch Manager

Les mêmes vues, plus le **coût par kilomètre de mission** et la **consommation aux 100 km de mission**. L'export Excel contient quatre onglets : Missions, Par agent, Coûts, Écarts.

Les **seuils** se règlent en Administration. Ils sont provisoires, à ajuster après deux semaines d'essai avec les 4 Chefs d'unité :

| Paramètre | Valeur initiale |
|---|---|
| Km hors mission | 5 km |
| Continuité du compteur | 100 km |
| Vitesse moyenne | 90 km/h |
| Distance par mission | 250 km |
| Écart d'horloge | 10 min |
| Délai de synchronisation | 7 jours |
| Conservation des photos | 12 mois |

`moto_missions_photos_a_purger()` liste les photos arrivées en fin de conservation.

## Finance et Direction

Vous voyez les missions, distances, photos et coûts. Vous ne voyez aucune coordonnée GPS.

## Ce que la lecture automatique fait, et ne fait pas

- **Gratuite et locale.** Elle tourne sur le téléphone, hors réseau, sans service payant ; la photo n'est envoyée à aucun tiers.
- **Prudente.** Elle ne propose un chiffre que si chaque chiffre est reconnu nettement et si la valeur est vraisemblable par rapport au dernier relevé ; sinon, elle s'abstient.
- **Non éprouvée sur les vraies motos.** Elle n'a pas encore été mesurée sur des photos réelles de compteurs APSONIC (voir le rapport de livraison).
- **Jamais seule.** Le chiffre retenu reste toujours celui que l'agent confirme.

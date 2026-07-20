# RCN Trace — Étape 2 — Audit écran par écran du flux réel Bouaké / Yakro / Calibrage

Date : 20/07/2026  
Projet : ANAGROCI Operations Suite / RCN Trace  
Statut : Audit fonctionnel écran par écran  
Périmètre : RCN Trace uniquement  
Farmer Buying : non modifié  
Supabase : aucune migration, aucune donnée modifiée

---

## 1. Objectif de l'étape 2

L'étape 1 a confirmé que RCN Trace existe déjà comme module structuré : application protégée, moteur local/offline, synchronisation Supabase, tables RCN avec RLS, base fournisseurs, référentiels et architecture REC → QLT → RCN → BIN → TRF → CAL.

L'étape 2 vérifie maintenant si les écrans correspondent vraiment au flux réel d'exploitation :

- Bouaké réceptionne, échantillonne, décharge, stocke, sèche/tri, transfère ;
- Yakro peut réceptionner des transferts ou des livraisons directes ;
- Yakro stocke en BIN et peut sécher/tri également ;
- le calibrage ne doit consommer que la matière réellement destinée au calibrage ;
- la traçabilité doit rester lisible du fournisseur jusqu'à la sortie calibrée.

Cet audit est documentaire et fonctionnel. Aucune correction technique n'est appliquée dans cette étape.

---

## 2. Références inspectées

Fichiers applicatifs inspectés :

- `rcntrace/index.html`
- `rcntrace/README.md`
- `rcntrace/rcntrace.js`
- `rcntrace/rcntrace-ui.js`
- `rcntrace/rcntrace-sync.js`
- `supabase/rcntrace.sql`
- `supabase/rcntrace_etl.sql`

Points structurants constatés :

- l'application charge `auth-gate.js` avec `data-module="rcntrace"` ;
- le shell SPA est dans `index.html` ;
- les écrans sont routés par `rcntrace-ui.js` ;
- le moteur métier est dans `rcntrace.js` ;
- la synchronisation est dans `rcntrace-sync.js` ;
- le schéma analytique existe dans `supabase/rcntrace.sql` ;
- l'ETL BI existe dans `supabase/rcntrace_etl.sql`.

---

## 3. Architecture écran constatée

RCN Trace est organisé en trois grands espaces actifs.

### 3.1 Procurement

Écrans affichés dans la navigation :

- Tableau de bord Procurement ;
- Engagements ;
- Financements LBA ;
- Prix d'achat & validations ;
- Arrivées prévues ;
- Performance fournisseurs ;
- Base fournisseurs ;
- Sacs de jute ;
- Contrôle & paiements.

### 3.2 Activité entrepôt

Écrans affichés dans la navigation :

- Tableau de bord entrepôt ;
- Réception ;
- Qualité ;
- Stock & BIN ;
- Séchage / triage ;
- Transferts ;
- Rapports entrepôt ;
- Cartographie ;
- Audit.

### 3.3 Calibrage

Écrans affichés dans la navigation :

- Vue d'ensemble calibrage ;
- Transferts attendus ;
- Réception au calibrage ;
- Opérations de calibrage ;
- Saisie des sorties ;
- Contrôle qualité ;
- BIN de calibre ;
- Arrêts & maintenance ;
- Traçabilité ;
- Rapports ;
- Journal d'audit.

### 3.4 Observation

La séparation des espaces est bonne. Elle évite de mélanger le rôle procurement, le rôle entrepôt et le rôle calibrage.

Mais le flux réel Bouaké → Yakro → Calibrage demande une clarification importante : Yakro n'est pas automatiquement le calibrage. Yakro peut être un second entrepôt avec son propre cycle réception → lot → BIN → séchage → transfert vers calibrage.

---

## 4. Audit du flux Procurement

### 4.1 Tableau de bord Procurement

Rôle attendu terrain :

- suivre les promesses fournisseurs ;
- suivre les financements LBA ;
- suivre les arrivées prévues ;
- comparer volume promis, volume livré, reste à livrer ;
- donner au Branch Manager une vue d'exposition financière.

Constat application :

- l'écran existe ;
- il affiche des KPI de volume promis, volume reçu et reste à livrer ;
- il prévoit un export Excel et un rapport PDF ;
- il est situé avant la réception physique.

Points forts :

- bonne logique métier : procurement avant entrepôt ;
- séparation claire entre engagement, financement et réception ;
- lien logique avec les performances fournisseurs.

Angles morts :

- il faut clarifier le lien entre financement LBA et réception réelle ;
- il faut éviter qu'une réception soit attribuée à un fournisseur non validé ;
- le statut financé / DIS doit être visible partout où le fournisseur est choisi ;
- il faut une logique de solde fournisseur : avance, valeur livrée, reste à couvrir.

Niveau de maturité : moyen à bon.

Priorité de correction : moyenne.

---

### 4.2 Engagements fournisseurs

Rôle attendu terrain :

- enregistrer la promesse de volume ;
- définir fournisseur, campagne, volume, prix prévisionnel, échéance ;
- suivre si le fournisseur respecte son engagement.

Constat application :

- l'écran existe dans la navigation ;
- le moteur contient une structure `procurement.engagements` ;
- la synchronisation pousse les engagements vers `rcn_proc_engagements`.

Points forts :

- existence d'une table normalisée dédiée ;
- liaison prévue avec financements et arrivages.

Angles morts :

- il faut verrouiller les modifications après livraison partielle ;
- il faut différencier engagement commercial et financement accordé ;
- il faut gérer les engagements annulés / expirés ;
- il faut prévoir une validation BM / GM selon le montant ou le volume.

Niveau de maturité : moyen.

Priorité de correction : moyenne.

---

### 4.3 Financements LBA

Rôle attendu terrain :

- enregistrer les avances ;
- contrôler les échéances ;
- suivre le risque fournisseur ;
- empêcher qu'un fournisseur financé livre moins que son exposition.

Constat application :

- le module existe ;
- les financements sont synchronisés vers `rcn_proc_financements` ;
- les états de financement existent, mais doivent être rapprochés aux lots réels.

Points forts :

- la base technique existe ;
- l'ordre de synchronisation respecte engagement puis financement / arrivage.

Angles morts :

- pas encore de verrou serveur fort constaté entre financement et livraison ;
- risque de financement non couvert si l'utilisateur ne rapproche pas manuellement ;
- besoin d'un écran d'alerte : fournisseur financé, échéance dépassée, valeur livrée insuffisante.

Niveau de maturité : moyen.

Priorité de correction : haute, car financier.

---

### 4.4 Prix d'achat & validations

Rôle attendu terrain :

- saisir le prix d'achat négocié ;
- faire valider le prix avant valorisation ;
- empêcher une valorisation non validée ;
- relier prix, KOR, humidité, fournisseur, lot.

Constat application :

- l'écran est délégué à un module `RCNPriceUI` ;
- les prix existent dans `rcn_proc_prix` ;
- l'étape est bien séparée du flux entrepôt.

Points forts :

- bonne séparation entre la réception physique et la validation du prix ;
- permet d'éviter que le magasinier décide seul du prix.

Angles morts :

- il faut confirmer si le prix est validé avant ou après analyse finale ;
- il faut préciser qui valide : BM, GM, Finance ;
- il faut empêcher la modification silencieuse du prix après lot officiel ;
- il faut journaliser toute modification de prix.

Niveau de maturité : moyen.

Priorité de correction : haute.

---

### 4.5 Arrivées prévues

Rôle attendu terrain :

- annoncer un camion avant son arrivée ;
- préparer la réception ;
- relier le camion à un engagement fournisseur ;
- éviter les arrivées inconnues ou non planifiées.

Constat application :

- l'écran existe dans la navigation ;
- les arrivages sont synchronisés vers `rcn_proc_arrivages` ;
- la réception physique reste séparée.

Points forts :

- bonne logique : planifié avant réception ;
- utile pour gestion du parking / balance / laboratoire / main-d'œuvre.

Angles morts :

- il faut créer un lien direct arrivée prévue → réception camion ;
- il faut une alerte si camion arrivé sans planning ;
- il faut pouvoir convertir une arrivée prévue en réception sans ressaisie.

Niveau de maturité : moyen.

Priorité de correction : moyenne.

---

## 5. Audit du flux Activité entrepôt

### 5.1 Tableau de bord entrepôt

Rôle attendu terrain :

- voir les camions en attente ;
- voir les lots bloqués qualité ;
- voir les BIN ouvertes ;
- voir les transferts à préparer ou à recevoir ;
- piloter Bouaké et Yakro séparément.

Constat application :

- l'espace entrepôt existe ;
- les raccourcis Réception, Qualité, Stock, Séchage, Transfert sont structurés ;
- les KPI semblent globaux.

Points forts :

- bonne logique d'ensemble ;
- workflow lisible pour un magasinier.

Angles morts :

- séparation Bouaké / Yakro à renforcer ;
- un tableau de bord global ne suffit pas si les deux sites ont des statuts différents ;
- besoin d'un filtre obligatoire par site / entrepôt.

Niveau de maturité : moyen.

Priorité de correction : haute.

---

### 5.2 Réception camion

Rôle attendu terrain :

- créer un dossier temporaire REC ;
- identifier camion, fournisseur, origine, entrepôt, transporteur, chauffeur ;
- saisir poids annoncé et sacs annoncés ;
- ne pas créer de lot officiel à ce stade.

Constat application :

- le formulaire existe ;
- il génère un numéro temporaire REC ;
- le lot reste vide ;
- l'utilisateur choisit l'entrepôt de réception ;
- le fournisseur est sélectionné depuis la base fournisseur ;
- un bouton enregistre et envoie au laboratoire.

Points forts :

- logique correcte : REC temporaire avant lot officiel ;
- champs camion, fournisseur, origine, transporteur, chauffeur et sacs existent ;
- bonne séparation entre arrivée et lot officiel.

Angles morts :

- le doublon camion/créneau est mentionné mais doit être confirmé techniquement ;
- il faut imposer ou recommander la photo du camion / BL / ticket ;
- il faut gérer livraison directe Yakro explicitement ;
- il faut que la réception précise clairement : Bouaké, Yakro, ou autre site ;
- il faut pouvoir relier l'arrivée prévue Procurement à cette réception.

Niveau de maturité : bon.

Priorité de correction : moyenne à haute.

---

### 5.3 Sampling qualité

Rôle attendu terrain :

- saisir GK, spotted, immature, nut count, humidité, défauts ;
- calculer KOR avec la formule officielle ;
- transmettre au GM pour décision ;
- conserver la valeur exacte et l'affichage arrondi.

Constat application :

- le moteur contient la formule KOR officielle ;
- la formule est documentée ;
- le sampling est une étape avant décision GM ;
- l'écran Qualité permet d'accéder au sampling.

Points forts :

- formule KOR conforme ;
- distinction sampling / final ;
- écart KOR final vs sampling prévu.

Angles morts :

- il faut préciser l'obligation de sampling avant déchargement ;
- il faut empêcher le déchargement si sampling absent ;
- il faut gérer plusieurs analyses / contre-analyse avec audit ;
- il faut joindre la fiche labo / photo du résultat.

Niveau de maturité : bon.

Priorité de correction : moyenne.

---

### 5.4 Décision GM

Rôle attendu terrain :

- autoriser ou refuser le déchargement ;
- imposer un commentaire en cas de refus ;
- journaliser le décideur ;
- empêcher la suite si non autorisé.

Constat application :

- une étape GM existe ;
- sans autorisation GM, le déchargement reste indisponible ;
- le commentaire et la délégation sont prévus dans le schéma.

Points forts :

- bon verrou métier dans le flux UI ;
- logique conforme à vos règles : lot officiel seulement après analyse et GM.

Angles morts :

- il faut confirmer que le verrou est aussi côté serveur ;
- il faut gérer délégation nominative ;
- il faut empêcher un utilisateur non autorisé d'approuver via manipulation locale.

Niveau de maturité : bon côté UI, à renforcer côté serveur.

Priorité de correction : haute.

---

### 5.5 Déchargement / pesée

Rôle attendu terrain :

- enregistrer poids brut, tare, net physique ;
- enregistrer le poids payé / réfaction ;
- distinguer poids main-d'œuvre du poids stock ;
- rattacher bordereau, ticket et destination.

Constat application :

- les champs de déchargement existent ;
- le détail REC affiche net physique, réfaction, poids payé, bordereau, poids main-d'œuvre ;
- la distinction poids stock / main-d'œuvre est prévue.

Points forts :

- très bon principe : le stock est piloté par le net physique ;
- poids main-d'œuvre séparé ;
- utile pour éviter confusion entre paiement fournisseur, stock et manutention.

Angles morts :

- il faut préciser la règle officielle de réfaction ;
- il faut relier le ticket de pesée comme preuve obligatoire ;
- il faut gérer double pont bascule si applicable ;
- il faut définir la tolérance entre ticket, GRN, poids payé et stock.

Niveau de maturité : bon.

Priorité de correction : haute, car impact stock et paiement.

---

### 5.6 Analyse finale & création du lot officiel

Rôle attendu terrain :

- faire analyse finale après déchargement ;
- comparer final vs sampling ;
- si écart KOR < 1 : libération possible ;
- si écart KOR >= 1 : blocage qualité ;
- créer un lot officiel RCN ;
- rattacher le lot au fournisseur, origine, KOR, poids et BIN.

Constat application :

- l'analyse finale existe ;
- l'écart KOR est affiché ;
- le lot officiel est créé après libération ;
- l'application prévoit un état bloqué qualité si écart supérieur ou égal à 1.

Points forts :

- bonne règle métier ;
- bon verrou qualité ;
- le lot officiel porte l'identité, la BIN porte la position.

Angles morts :

- il faut formaliser la procédure d'exception si écart >= 1 ;
- il faut empêcher le transfert d'un lot bloqué ;
- il faut définir qui peut débloquer après contre-analyse ;
- il faut prévoir le déclassement ou la renégociation prix si qualité différente.

Niveau de maturité : bon.

Priorité de correction : haute.

---

### 5.7 Stock & BIN

Rôle attendu terrain :

- créer / ouvrir une BIN ;
- y affecter plusieurs lots ;
- gérer stock physique ;
- suivre les contributeurs ;
- fermer une BIN avec justification ;
- préserver la généalogie.

Constat application :

- le moteur applique le principe lot = identité, BIN = position ;
- les cycles BIN et contributeurs sont prévus ;
- les contributeurs sont utilisés pour la généalogie.

Points forts :

- architecture correcte pour les mélanges ;
- généalogie proportionnelle prévue ;
- indispensable pour la traçabilité fournisseur.

Angles morts :

- il faut clarifier la règle physique de sortie d'une BIN mélangée : proportion, FIFO, LIFO ou règle magasin ;
- il faut empêcher une sortie supérieure au stock BIN ;
- il faut gérer résidu et écart d'inventaire ;
- il faut séparer BIN Bouaké, BIN Yakro, BIN calibrage.

Niveau de maturité : moyen à bon.

Priorité de correction : très haute.

---

### 5.8 Séchage / triage

Rôle attendu terrain :

- sortir une quantité d'une BIN ;
- mesurer humidité avant/après ;
- mesurer perte de séchage ;
- créer ou alimenter une BIN après séchage ;
- conserver la généalogie.

Constat application :

- le module existe ;
- le README mentionne séchage/triage avant/après, humidité, NC, KOR, sacs, perte ;
- une BIN after drying est prévue.

Points forts :

- le module répond à un vrai besoin terrain ;
- permet de justifier les pertes ;
- préserve la généalogie.

Angles morts :

- il faut distinguer séchage, triage, reconditionnement et simple mouvement interne ;
- il faut imposer humidité avant/après ;
- il faut gérer le coût main-d'œuvre si nécessaire ;
- il faut empêcher qu'une perte de séchage soit confondue avec perte de transit.

Niveau de maturité : moyen.

Priorité de correction : haute.

---

### 5.9 Sacs de jute RCN

Rôle attendu terrain :

- suivre dotation fournisseur ;
- suivre retours physiques ;
- suivre pertes approuvées ;
- distinguer dette fournisseur et disposition interne ;
- gérer sacs utilisables, à réparer, réparés, rebagging, réformés, déchirés.

Constat application :

- l'écran existe ;
- il distingue dette fournisseur et disposition interne ;
- le rebagging est bien considéré comme consommation interne, pas comme réduction de dette.

Points forts :

- meilleure logique que beaucoup de systèmes terrain ;
- évite double comptage ;
- compte fournisseur prévu avec onglets profil, livraison, traçabilité, sacs, financement.

Angles morts :

- il faut lier les sacs à chaque réception réelle ;
- il faut lier les sacs au fournisseur et éventuellement au lot ;
- il faut prévoir approbation des pertes ;
- il faut gérer inventaire physique périodique ;
- il faut distinguer sacs reçus avec noix et sacs retournés vides.

Niveau de maturité : bon côté modèle, à renforcer côté contrôle.

Priorité de correction : haute.

---

### 5.10 Transfert Bouaké → Yakro

Rôle attendu terrain :

- sélectionner une BIN ou des lots ;
- créer un transfert ;
- valider par entrepôt, QA/lab, réception destination ;
- enregistrer camion, chauffeur, plaques, transporteur ;
- envoyer poids et recevoir poids ;
- calculer écart et perte de transit ;
- appliquer tolérance / pénalité.

Constat application :

- l'écran transfert existe ;
- il prévoit triple validation ;
- le modèle contient poids envoyé, poids reçu, écart, motif ;
- le modèle BI prévoit prix moyen, tolérance, valeur envoyée, valeur reçue, perte tolérable, perte pénalisable, pénalité.

Points forts :

- bonne logique de transfert ;
- bonne préparation à la finance de transit ;
- généalogie des contributeurs prévue.

Angles morts :

- destination doit être typée : entrepôt ou calibrage ;
- Bouaké → Yakro ne doit pas être traité comme entrée calibrage ;
- réception Yakro doit recréer un lot/BIN ou un cycle de stockage local ;
- il faut gérer documents camion : note de transfert, ticket, CCAK si nécessaire ;
- il faut contrôler perte de transit côté serveur.

Niveau de maturité : moyen à bon.

Priorité de correction : très haute.

---

## 6. Audit du flux Yakro

### 6.1 Réception Yakro d'un transfert Bouaké

Rôle attendu terrain :

- recevoir un transfert envoyé de Bouaké ;
- peser à l'arrivée ;
- contrôler qualité si nécessaire ;
- constater écart ;
- créer stock Yakro ;
- conserver généalogie vers Bouaké.

Constat application :

- l'architecture reconnaît Yakro comme second entrepôt dans le README ;
- le transfert peut avoir une destination typée ;
- le calibrage ne doit consommer que les transferts qui lui sont destinés.

Points forts :

- le concept est déjà documenté ;
- l'application n'est pas pensée uniquement pour Bouaké.

Angles morts :

- dans l'UI, il faut rendre cette différence beaucoup plus visible ;
- il faut un écran clair « Réception transfert entrepôt » ;
- il faut séparer réception fournisseur direct Yakro et réception transfert Bouaké ;
- il faut interdire qu'un transfert vers Yakro apparaisse directement comme matière calibrage.

Niveau de maturité : concept bon, UI à clarifier.

Priorité de correction : très haute.

---

### 6.2 Livraison directe fournisseur à Yakro

Rôle attendu terrain :

- un fournisseur peut livrer directement à Yakro ;
- la réception doit suivre le même cycle que Bouaké : REC → sampling → GM → déchargement → analyse finale → lot → BIN ;
- le site doit être Yakro ;
- la traçabilité doit indiquer livraison directe.

Constat application :

- l'écran réception permet de choisir un entrepôt ;
- le README mentionne les livraisons directes à Yakro ;
- le workflow technique peut le supporter.

Points forts :

- pas besoin de créer un nouveau métier ;
- le flux existant peut être réutilisé avec un site Yakro.

Angles morts :

- l'interface doit rendre « livraison directe Yakro » explicite ;
- il faut distinguer origine commerciale et site de réception ;
- il faut éviter que Yakro direct soit confondu avec transfert Bouaké.

Niveau de maturité : moyen.

Priorité de correction : haute.

---

## 7. Audit du flux Calibrage

### 7.1 Vue d'ensemble calibrage

Rôle attendu terrain :

- voir les transferts destinés au calibrage ;
- voir la matière reçue ;
- voir la matière en machine ;
- voir les sorties par calibre ;
- voir les écarts de bilan.

Constat application :

- l'espace calibrage existe ;
- il est séparé de l'espace entrepôt ;
- plusieurs écrans spécialisés sont présents.

Points forts :

- bonne séparation de responsabilité ;
- le calibrage est traité comme module de production, pas comme simple stock.

Angles morts :

- il faut empêcher le calibrage de consommer de la matière non destinée au calibrage ;
- il faut gérer la réception au calibrage comme étape obligatoire ;
- il faut verrouiller les opérations clôturées.

Niveau de maturité : moyen à bon.

Priorité de correction : haute.

---

### 7.2 Transferts attendus au calibrage

Rôle attendu terrain :

- afficher uniquement les transferts dont destination = calibrage ;
- exclure les transferts Bouaké → Yakro entrepôt ;
- permettre de réceptionner au calibrage.

Constat application :

- l'écran existe ;
- le libellé mentionne « sorties de BIN de Yamoussoukro vers le calibrage ».

Points forts :

- bonne intention métier ;
- introduit une étape intermédiaire entre Yakro stock et calibrage.

Angles morts :

- il faut s'assurer que la destination est contrôlée dans les données ;
- il faut une règle serveur empêchant un mauvais type de transfert d'être calibré ;
- il faut rendre visible le site expéditeur.

Niveau de maturité : moyen.

Priorité de correction : très haute.

---

### 7.3 Réception au calibrage

Rôle attendu terrain :

- rapprocher poids envoyé / poids reçu ;
- contrôler écart ;
- déclarer motif d'écart ;
- autoriser ou bloquer l'ouverture d'une opération de calibrage.

Constat application :

- l'écran existe ;
- le libellé prévoit rapprochement envoyé / reçu et écart à traiter.

Points forts :

- l'étape est identifiée ;
- la logique d'écart est prévue.

Angles morts :

- il faut forcer la réception calibrage avant opération ;
- il faut empêcher une opération CAL sans transfert reçu ;
- il faut définir la tolérance d'écart à ce niveau.

Niveau de maturité : moyen.

Priorité de correction : haute.

---

### 7.4 Opérations de calibrage

Rôle attendu terrain :

- ouvrir une opération CAL ;
- sélectionner machine, shift, équipe ;
- saisir quantité reçue / entrée machine ;
- suivre statut : prêt, en cours, pause, partiel, à valider, clos ;
- empêcher une opération sans matière reçue.

Constat application :

- l'opération de calibrage existe ;
- le moteur contient checklist avant démarrage ;
- la clôture vérifie les bloqueurs.

Points forts :

- bonne structuration production ;
- checklist utile ;
- audit et verrouillage après clôture prévus.

Angles morts :

- il faut connecter plus fortement la checklist à l'autorisation de démarrage ;
- il faut une logique de responsable production ;
- il faut gérer arrêt / redémarrage sans casser le bilan matière.

Niveau de maturité : bon.

Priorité de correction : moyenne à haute.

---

### 7.5 Saisie des sorties

Rôle attendu terrain :

- saisir les sorties par neuf calibres ;
- saisir sacs et poids ;
- indiquer BIN destination ;
- saisir rejets, restes, poussières, pertes expliquées ;
- ne jamais mettre tout l'écart en perte.

Constat application :

- les neuf calibres existent ;
- les sorties non-calibre sont catégorisées ;
- la perte inexpliquée est un écart de bilan, pas une catégorie déclarée.

Points forts :

- très bon principe industriel ;
- évite de masquer les pertes ;
- permet un vrai bilan matière.

Angles morts :

- il faut empêcher poids négatif ou incohérent ;
- il faut limiter la sortie totale selon quantité reçue ;
- il faut valider les BIN de destination.

Niveau de maturité : bon.

Priorité de correction : haute côté verrou serveur.

---

### 7.6 Contrôle qualité des sorties

Rôle attendu terrain :

- contrôler chaque calibre ;
- accepter, accepter avec réserve, recalibrer, bloquer ou rejeter ;
- empêcher sortie bloquée de passer au stock final.

Constat application :

- l'écran existe ;
- les décisions QC existent ;
- les sorties bloquées/rejetées sont visibles.

Points forts :

- bonne granularité ;
- logique de blocage prévue.

Angles morts :

- il faut confirmer l'effet réel de `bloqué` / `rejeté` sur la disponibilité du stock ;
- il faut journaliser le contrôleur qualité ;
- il faut lier la décision à une preuve éventuelle.

Niveau de maturité : moyen à bon.

Priorité de correction : moyenne.

---

### 7.7 BIN de calibre

Rôle attendu terrain :

- stocker les sorties calibrées par calibre ;
- suivre capacité, quantité, disponibilité ;
- garder généalogie jusqu'aux lots et fournisseurs ;
- permettre packing plus tard.

Constat application :

- l'écran existe ;
- les BIN de sortie affichent calibre, capacité, quantité, disponible, statut, opérations, âge ;
- la généalogie est prévue.

Points forts :

- excellente base pour la suite packing ;
- permet de garder la trace des contributeurs.

Angles morts :

- il faut prévoir les futurs liens vers cuisson/décorticage/packing ;
- il faut gérer sortie de BIN de calibre ;
- il faut empêcher dépassement de capacité.

Niveau de maturité : bon.

Priorité de correction : moyenne.

---

### 7.8 Bilan matière & clôture

Rôle attendu terrain :

- calculer : reçu = calibres + rejets/restes + écart ;
- appliquer une tolérance ;
- exiger justification si écart ;
- bloquer clôture si données insuffisantes ;
- verrouiller après clôture.

Constat application :

- l'écran bilan existe ;
- il affiche reçu, sorties connues, écart inexpliqué, débit ;
- il prévoit tolérance et validation ;
- il affiche les bloqueurs de clôture.

Points forts :

- très bon cœur industriel ;
- logique de clôture sérieuse ;
- évite de perdre la matière dans les chiffres.

Angles morts :

- il faut clarifier si la tolérance est globale, par machine, par calibre ou par opération ;
- il faut empêcher validation si écart hors tolérance sans justification approuvée ;
- il faut définir qui peut valider : production, qualité, BM.

Niveau de maturité : bon.

Priorité de correction : haute.

---

## 8. Audit des rapports, cartographie et audit

### 8.1 Rapports entrepôt

Rôle attendu terrain :

- stock par site ;
- stock par BIN ;
- qualité moyenne ;
- pertes par séchage ;
- écarts de transfert ;
- délais camion / sampling / GM / déchargement ;
- situation sacs.

Constat application :

- l'écran existe ;
- des vues BI sont prévues dans `rcntrace_etl.sql`.

Points forts :

- bonne base BI ;
- export possible à terme.

Angles morts :

- il faut vérifier que les vues BI exploitent bien les champs enrichis Bouaké/Yakro ;
- il faut séparer reporting opérationnel quotidien et reporting direction ;
- il faut créer un rapport spécifique transfert Bouaké → Yakro.

Priorité : moyenne à haute.

---

### 8.2 Cartographie

Rôle attendu terrain :

- visualiser origine fournisseur ;
- volume par localité / région ;
- qualité par origine ;
- risque fournisseur / zone.

Constat application :

- l'écran existe ;
- l'application contient des localités CI ;
- la cartographie est prévue dans les menus.

Points forts :

- utile pour Procurement et qualité.

Angles morts :

- il ne faut pas confondre origine de la noix et site de réception ;
- il faut relier cartographie au fournisseur et au lot.

Priorité : moyenne.

---

### 8.3 Audit

Rôle attendu terrain :

- tout changement sensible doit être journalisé ;
- aucune correction ne doit effacer le passé ;
- on doit savoir qui a fait quoi, quand, pourquoi.

Constat application :

- le moteur met l'audit au centre ;
- `rcn_audit` contient déjà des lignes ;
- la correction versionnée est prévue.

Points forts :

- bonne philosophie ;
- cohérent avec votre besoin de contrôle.

Angles morts :

- il faut s'assurer que toutes les actions sensibles passent réellement par l'audit ;
- il faut rendre les erreurs de synchronisation plus visibles ;
- il faut empêcher une correction locale non synchronisée d'être considérée comme fiable.

Priorité : haute.

---

## 9. Matrice de maturité par écran

| Écran | Maturité | Risque principal | Priorité |
|---|---:|---|---:|
| Procurement dashboard | Moyen / bon | Solde fournisseur incomplet | Moyenne |
| Engagements | Moyen | Modification après livraison | Moyenne |
| Financements LBA | Moyen | Exposition financière non couverte | Haute |
| Prix & validations | Moyen | Prix modifiable / validation floue | Haute |
| Arrivées prévues | Moyen | Non relié à réception réelle | Moyenne |
| Réception camion | Bon | preuves / doublons / site Yakro | Haute |
| Sampling qualité | Bon | contre-analyse / preuve labo | Moyenne |
| Décision GM | Bon UI | verrou serveur à renforcer | Haute |
| Déchargement / pesée | Bon | règle poids payé / stock / GRN | Haute |
| Analyse finale / lot | Bon | exception KOR >= 1 | Haute |
| Stock & BIN | Moyen / bon | sortie BIN mélangée / stock négatif | Très haute |
| Séchage / triage | Moyen | pertes mal catégorisées | Haute |
| Sacs jute RCN | Bon modèle | approbation pertes / inventaire | Haute |
| Transfert Bouaké → Yakro | Moyen / bon | confusion entrepôt vs calibrage | Très haute |
| Réception Yakro | Moyen | écran pas assez explicite | Très haute |
| Transfert Yakro → calibrage | Moyen | mauvais type de transfert calibré | Très haute |
| Opération calibrage | Bon | checklist et autorisation | Moyenne / haute |
| Sorties calibrage | Bon | dépassement quantité reçue | Haute |
| QC sorties | Moyen / bon | effet du blocage à confirmer | Moyenne |
| BIN de calibre | Bon | lien futur packing | Moyenne |
| Bilan / clôture | Bon | tolérance et validation | Haute |
| Rapports | Moyen | pas encore assez directionnel | Moyenne |
| Audit | Bon principe | exhaustivité à vérifier | Haute |

---

## 10. Angles morts transversaux prioritaires

### 10.1 Site et destination

Le plus grand risque fonctionnel est la confusion entre :

- Bouaké entrepôt ;
- Yakro entrepôt ;
- Calibrage ;
- livraison directe Yakro ;
- transfert Bouaké → Yakro ;
- transfert Yakro → calibrage.

La correction future devra rendre le site et la destination visibles dans tous les écrans critiques.

### 10.2 Verrous serveur

Les verrous UI ne suffisent pas. Les prochains contrôles serveur à envisager :

- pas de déchargement sans décision GM ;
- pas de lot officiel sans analyse finale conforme ou exception validée ;
- pas de sortie BIN supérieure au stock ;
- pas de transfert vers calibrage si destination ≠ calibrage ;
- pas de CAL sans réception calibrage ;
- pas de clôture CAL hors tolérance sans justification approuvée.

### 10.3 Preuves documentaires

Les preuves existent côté local, mais il faut clarifier :

- où sont stockées les pièces ;
- quelles pièces sont obligatoires par étape ;
- qui peut les ajouter ;
- comment elles sont liées aux REC, lots, transferts, CAL.

### 10.4 Rôle Yakro

Yakro doit être explicitement traité comme un second entrepôt, pas comme synonyme de calibrage.

### 10.5 Bilan matière

Le bilan matière est bien pensé, mais il faut fixer les tolérances officielles avant production.

---

## 11. Recommandation de séquence RCN Trace

Après cet audit, la séquence recommandée est :

### RCN Trace — Étape 3 : clarification du flux Bouaké / Yakro / Calibrage dans l'interface

Objectif : rendre visibles partout :

- site d'origine ;
- site de réception ;
- type de destination ;
- statut de transfert ;
- matière disponible pour calibrage ;
- matière seulement stockée en entrepôt.

### RCN Trace — Étape 4 : verrous serveur métier critiques

Objectif : sécuriser les points bloquants côté Supabase.

### RCN Trace — Étape 5 : preuves documentaires et stockage sécurisé

Objectif : relier les pièces aux dossiers REC, lots, transferts et CAL.

### RCN Trace — Étape 6 : protocole de recette terrain Bouaké / Yakro / Calibrage

Objectif : tester un flux réel complet de bout en bout.

---

## 12. Décision recommandée

Ne pas modifier immédiatement tous les écrans.

La première correction utile doit être :

**RCN Trace — Étape 3 : clarification du flux Bouaké / Yakro / Calibrage dans l'interface.**

Cette étape devrait être prioritaire parce qu'elle réduit le risque principal : confondre un transfert vers Yakro entrepôt avec une matière déjà disponible pour le calibrage.

---

## 13. Audit de sécurité de cette étape

- Aucune migration Supabase.
- Aucune modification de table.
- Aucune modification de données.
- Aucune modification du code applicatif.
- Farmer Buying non modifié.
- RCN Trace documenté seulement.

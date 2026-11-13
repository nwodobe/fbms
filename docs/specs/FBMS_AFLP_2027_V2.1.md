# FBMS AFLP 2027 · Spécification fonctionnelle V2.1

13 novembre 2026 · Commanditaire : Branch Manager ANAGROCI Centre · Cahier des charges de référence, version de travail

## 0. Statut, portée et principes

V2.1 est le cahier des charges de référence de FBMS AFLP 2027 : rien n'est développé hors de ce document, et rien n'est mis en production sans les critères du §7. Aucune PR n'est fusionnée et l'application de production n'est pas modifiée au stade de cette version.

**Portée.** FBMS couvre le bord champ, des clusters et villages jusqu'à la remise physique des noix au transporteur, constatée par un BEV signé. PJS Operations couvre la réception, la pesée de réception, le GRN, les entrepôts, les BIN, les transferts et l'usine. FBMS lit les statuts PJS sans jamais les recréer.

**Sept principes non négociables**

1. **Un registre de référence par événement.** Achat, financement confirmé, mouvement de sacs, BEV, réception et GRN ont chacun une seule table maîtresse. Vues, tableaux de bord et exports sont des projections, jamais des registres.
2. **Le geste physique précède la validation informatique.** Le BEV papier signé, horodaté sur le téléphone, prouve le transfert de garde ; la synchronisation et la validation serveur viennent après sans réécrire l'heure réelle.
3. **Aucune valeur par défaut favorable.** Une qualité non mesurée reste NON_MESURÉ ; un solde sans preuve reste « non vérifié », jamais zéro ni « OK ».
4. **Auteur certain.** Toute opération porte l'agent, l'appareil et la campagne ; une opération sans auteur est mise en quarantaine.
5. **Séparation des tâches côté serveur.** Celui qui demande ne confirme pas ; celui qui saisit ne valide pas ; la qualité officielle reste à QFS.
6. **Append-only.** Une correction crée un événement compensateur avec motif ; l'original reste lisible.
7. **Masquer n'est pas supprimer.** Les écrans retirés passent en lecture seule ; leurs tables et historiques sont conservés.

**Hors périmètre V2.1 :** LBA, Warehouse Buying Model, réception usine, stock usine, bilan matière, règlements comptables définitifs. AFLP Fleet reste une application séparée, régie par ses propres spécifications.

## 1. Arborescence finale des six espaces

Six espaces, 27 écrans métier, trois services intégrés. Chaque écran porte un code (E1.2, etc.) repris dans la matrice des droits et les critères de recette.

1. **E0 · Ma journée** (accueil, contenu calculé par rôle)
   1. E0.1 Tâches du jour : validations en attente, BEV à compléter, bilans dus, pièces manquantes
   2. E0.2 Alertes utiles de mon périmètre (calibrées par phase de campagne)
   3. E0.3 Boîte d'envoi : N opérations à envoyer, en erreur, en quarantaine
   4. E0.4 Raccourcis : 4 par rôle + mission/carburant Fleet
2. **E1 · Réseau**
   1. E1.1 Villages & clusters : liste, fiche village, carte, potentiel, statut d'approbation (fusion Recensement + Hubs & Cartographie)
   2. E1.2 RT : liste, fiche RT avec trois comptes (noix, argent, sacs), contrat, compte Wave, historique
   3. E1.3 Producteurs : liste, fiche unique (identité, Farmer Passport, parcelles, consentements, RT de rattachement)
   4. E1.4 Coopératives : fiche, membres, sections, points de collecte, livraisons consolidées
3. **E2 · Terrain**
   1. E2.1 Mobilisation : réunions village, présences
   2. E2.2 Visites & formations : visites producteurs, sessions, présences
   3. E2.3 Durabilité : questionnaires, plans d'action producteurs
   4. E2.4 Observatoire (pilote) : observations floraison/nouaison par protocole versionné, sans indicateur officiel
4. **E3 · Achats & comptes RT**
   1. E3.1 Nouvel achat : producteur, pesée, qualité, prix, reçu papier, preuve
   2. E3.2 Revue UH : achats à valider, à rejeter, à compléter
   3. E3.3 Financements Wave : demandes, versements Finance, accusés RT, remboursements
   4. E3.4 Sacherie RT : dotations, sacs utilisés, sacs pleins, retours
   5. E3.5 Bilan hebdomadaire : comptage, comparaison, décision RT, signature UH, revue ZH
5. **E4 · Expédition**
   1. E4.1 Lots : constitution des lots par RT à partir des achats validés
   2. E4.2 Voyage & BEV : voyage (camion), un BEV par RT, chargement, signatures, remise
   3. E4.3 Suivi aval PJS : statut transport, réception, GRN, écart BEV/GRN, en lecture seule
6. **E5 · Pilotage & Administration**
   1. E5.1 Tableau de bord : cible AFLP, achats, financement, sacs, BEV, par zone/cluster/RT
   2. E5.2 Alertes & anomalies : file de traitement, assignation, clôture motivée
   3. E5.3 Rapports & exports : rapports hebdomadaires, exports Excel, export coopératives
   4. E5.4 Campagnes & règles : campagne, prix, seuils qualité, convention des masses, routes versionnées
   5. E5.5 Utilisateurs & rôles : comptes, rôle, périmètre géographique, appareils
   6. E5.6 Diagnostic synchronisation & appareils : files par agent, versions APK, quarantaine
   7. E5.7 Bibliothèque de preuves & audit : preuves, journal des corrections

**Services intégrés (pas de menu)** : capture de preuve Field Proof dans E3.1, E3.3, E3.5 et E4.2 ; recherche globale (producteur, RT, achat, lot, BEV, référence PJS) dans la barre supérieure ; onglet Historique sur chaque fiche.

**Masqués, lecture seule à la date de bascule :** Entrepôts relais, Transferts relais → usine, Factory, LBA Purchase, Suppliers, Arrivages, Achat RCN. Tables wms_* conservées, aucune nouvelle écriture après bascule du site concerné.

## 2. Écrans exacts par rôle

Chaque rôle voit 4 raccourcis en barre basse et seulement les écrans de son périmètre ; les autres écrans autorisés restent accessibles par le menu. É = écriture, L = lecture seule, — = invisible. Le périmètre géographique est appliqué par le serveur, pas par l'écran.

| Rôle (périmètre) | 4 raccourcis | E0 | E1 Réseau | E2 Terrain | E3 Achats & comptes RT | E4 Expédition | E5 Pilotage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Assistant Unit Head (1 cluster) | Ma journée · Producteurs · Terrain · Achats | É | É E1.1–E1.3, L E1.4 | É | É E3.1, E3.4 ; É préparation E3.5 ; L E3.2, E3.3 | É E4.1 (préparation) ; L E4.2, E4.3 | — (sauf E5.6 pour son appareil) |
| Unit Head (1 cluster) | Ma journée · Achats · Contrôles RT · Expéditions | É | É | É | É E3.1, E3.2, E3.4, E3.5 ; L E3.3 + accusé RT assisté | É E4.1, E4.2 ; L E4.3 | L E5.1, E5.2 de son cluster |
| Zonal Head (sa zone) | Ma journée · RT à risque · Contrôles · Rapports | É | L, É approbation villages/RT | L | L ; É revue ZH du bilan E3.5 | L | L E5.1, É E5.2, L E5.3 |
| Logistics Coordinator (programme) | Ma journée · Voyages · Suivi PJS · Fleet | É | L | — | L E3.4 | É E4.2 (voyage, transporteur) ; L E4.1, E4.3 | L E5.1, É routes E5.4 |
| Assistant Branch Manager (programme) | Ma journée · Suivi des équipes · Pièces manquantes · Fleet | É | L | L | L ; É relances | L | L E5.1–E5.3, E5.6, E5.7 ; É E5.2 |
| Branch Manager (programme) | Ma journée · Pilotage · Anomalies · Administration | É | É approbation | L | É demande d'avance E3.3, dérogation prix ; L le reste | L | É E5.1–E5.7 |
| Finance (programme) | Ma journée · Financements Wave · Remboursements · Rapports | É | L E1.2 | — | É E3.3 (versement, preuve, remboursement) ; L E3.5 | — | L E5.1, E5.3 |
| QFS (programme, qualité seule) | Ma journée · Qualité en attente · Écarts BEV/GRN · Rapports | É | L E1.1 | — | É décision qualité sur E3.1/E3.2 uniquement | L E4.3 | L E5.1, E5.3 |
| Read Only / Audit | Ma journée · Tableau de bord · Rapports · Preuves | L | L | L | L | L | L E5.1, E5.3, E5.7 |

**RT sans smartphone.** Le RT n'a pas de compte obligatoire. Il intervient sur le téléphone de l'UH ou de l'AUH par trois gestes : signature sur écran ou papier photographié (achat, BEV, bilan), accusé de réception Wave dicté et signé, choix accord / réserve / refus au bilan. Chaque geste enregistre le nom du RT, l'agent témoin, l'appareil et l'heure locale.

**Magasinier de relais.** Rôle WAREHOUSE_KEEPER conservé en lecture seule dans FBMS après la bascule de son site ; son travail officiel se fait dans PJS.

## 3. Matrice des permissions métier et serveur

La matrice côté écran (shared/aflp-access.js) n'est qu'un confort d'affichage : chaque ligne ci-dessous est imposée par une RPC `security definer` qui relit le rôle et le périmètre en base (`auth.uid()`), et par la RLS des tables maîtresses. « Interdit » signifie refusé par le serveur même pour le BM.

| Action métier | Réalise | Valide / contresigne | Interdit à | Contrôle serveur exigé |
| --- | --- | --- | --- | --- |
| Créer ou modifier un producteur | AUH, UH | UH (doublon, RT rattaché) | Finance, QFS | Périmètre cluster ; RT obligatoire en canal direct ; historique farmer_change_log |
| Approuver un village ou un RT | ZH, BM | — | AUH, UH | Périmètre zone |
| Enregistrer un achat | AUH, UH | UH (E3.2) | ZH, BM, Finance | Campagne ouverte ; disponible RT suffisant, verrouillé en concurrence ; reçu numéroté unique par RT |
| Valider ou rejeter un achat | UH | — | Auteur de la saisie ; AUH | Valideur ≠ auteur ; décision figée, correction par événement |
| Décider la qualité officielle (hors seuil, dérogation) | QFS | — | UH, ZH, BM | Seul rôle QFS ; UH ne peut que mesurer |
| Prix hors barème | UH (demande) | BM | AUH | Motif obligatoire ; plafond de campagne |
| Demander une avance RT | BM | — | UH, Finance | Montant, RT, campagne ; demande ≠ crédit RT |
| Verser sur Wave et enregistrer la référence | Finance | — | BM, UH, ZH | Référence Wave unique, preuve privée ; seul Finance |
| Accusé de réception du RT | RT (sur téléphone UH) | UH témoin | BM, Finance | Témoin ≠ demandeur ≠ payeur |
| Remboursement RT | RT (remet) | Finance (confirme) | UH, BM | Preuve et référence uniques |
| Mouvement de sacs (dotation, retour) | UH, AUH | UH | Finance | Journal canonique unique (§4) |
| Constituer un lot | AUH, UH | UH | ZH, BM | Achats validés du même RT uniquement ; quantité ≤ disponible |
| Créer un voyage | UH, Logistics Coordinator | — | AUH | Transporteur et camion référencés |
| Signer et enregistrer un BEV | UH (atteste), RT et transporteur (signent) | — | AUH (prépare seulement), BM | Lots du RT du BEV ; quantités allouées ; pas de double sortie ; idempotent |
| Bilan hebdomadaire | UH + RT | ZH (revue) | AUH (signe pour l'UH), BM | Snapshot figé ; versionné ; échéance 7 jours |
| Corriger un enregistrement signé | UH (propose) | ZH ou BM | Auteur seul | Nouvelle version + motif ; original conservé |
| Paramètres de campagne, prix, seuils, routes | BM | — | Tous les autres | Version + date d'effet ; historique intact |
| Comptes et rôles | BM | — | Tous les autres | Journal d'administration |
| Lire réception, GRN, écart (PJS) | Tous selon périmètre | — | Toute écriture FBMS | Lecture seule, source PJS |

**Écarts du code actuel à corriger (vérifiés dans shared/aflp-access.js)**

- BRANCH_MANAGER = `*:*` : à remplacer par une liste explicite, sans confirmation Wave, accusé RT ni décision QFS.
- ZONAL_HEAD a une portée géographique globale et `qualite:validate` : restreindre à sa zone, retirer la validation qualité.
- UNIT_HEAD a `avances:create` : la demande d'avance revient au BM selon le SOP.
- Assistant Branch Manager est un rôle « legacy » : créer ASSISTANT_BRANCH_MANAGER (lecture programme, relances, Fleet) sans droits UH ni Finance.
- Aucun rôle QFS : créer QFS_CONTROLLER limité aux décisions qualité.
- Aucun profil Finance actif en production : créer un compte Finance nominatif avant tout essai Wave.

## 4. Dictionnaire des données et événements FBMS/PJS

Chaque événement métier a une table maîtresse unique. Les noms existants viennent du dépôt (main et branche #311) ; « à créer » signifie absent aujourd'hui. Toutes les tables maîtresses portent : `campaign_id`, `occurred_at` (heure réelle sur le téléphone), `recorded_at` (heure serveur), `actor_user_id`, `device_id`, `idempotency_key`, `version`, `supersedes_id`.

### 4.1 Registres de référence par événement

| Événement | Table maîtresse | État | Champs métier clés | Projections autorisées (lecture seule) |
| --- | --- | --- | --- | --- |
| Producteur enrôlé ou modifié | producteurs + farmer_change_log | Existe ; modification hors ligne à ajouter | identité, village, RT de rattachement, canal, consentement | Farmer Passport, exports |
| Achat bord champ | achats | Existe ; champs masses et qualité à compléter | producteur, RT, n° reçu, masses (§4.2), qualité (§4.3), prix, montant, mode de paiement | rt_sop_purchase_state_v, tableaux de bord |
| Décision UH sur un achat | rt_sop_purchase_reviews | Branche #311 | décision, motif, achat figé (snapshot) | stock sous garde RT |
| Demande d'avance | rt_sop_funding_requests | Branche #311 | RT, montant demandé, demandeur BM | — |
| Versement, accusé, remboursement | rt_sop_cash_events (+ rt_sop_refunds) | Branche #311 | type (PAYMENT, ACK_RT, REFUND), référence Wave unique, preuve | rt_sop_cash_balance_v (remplace la caisse indicative) |
| Mouvement de sacs | sacs_mouvements | Existe ; à confirmer comme journal unique après audit de rcn_jute_movements | type, nombre, état (vide, plein), RT, BEV lié | sacherie_ct_rt_stock, rt_sop_jute_card_v |
| Lot | field_lots + field_lot_contributors | Existe | RT gardien, achats contributeurs, masse nette physique, sacs | — |
| Voyage | trips | À créer | camion, transporteur, chauffeur, route, date | manifeste |
| Expédition individuelle + BEV | field_shipments + rt_sop_bev (1:1) | Existe + branche #311 | n° BEV papier, RT, voyage, destination de route, masses, sacs, signatures | rt_sop_rcn_custody_v |
| Allocation lot → BEV | rt_sop_bev_lots | Branche #311 ; quantité à ajouter | lot, kg alloués, sacs alloués | — |
| Bilan hebdomadaire | rt_sop_weekly_signoffs | Branche #311 | semaine, snapshot noix/argent/sacs, décision RT, signature UH, version | rt_sop_weekly_status_v |
| Réception, pesée, GRN | PJS Operations | Source externe | n° GRN, poids reçu, humidité, KOR, date | pjs_status_snapshots (à créer, copie en lecture) |
| Incident / écart | aflp_incidents + rt_sop_incident_links | Existe + branche #311 | type, objet lié, responsable, statut | alertes E5.2 |
| Réception relais (WMS FBMS) | wms_receptions, wms_grns | Existe ; gelé à la bascule | — | lecture historique seulement |

### 4.2 Convention des masses (à valider par Procurement, QFS, Finance)

| Grandeur | Définition | Formule | Qui la produit |
| --- | --- | --- | --- |
| Poids brut (kg) | Lecture de la bascule, sacs compris | mesuré | UH/AUH |
| Tare (kg) | Poids des sacs | nombre de sacs × tare unitaire de campagne (1 kg proposé) | calculé |
| Poids net physique (kg) | Noix réellement remises | brut − tare | calculé |
| Réfaction qualité (kg) | Déduction liée à l'humidité ou au KOR selon barème | barème versionné de campagne | calculé, décision QFS si hors barème |
| Réfaction totale (kg) | Tare + réfaction qualité | tare + réfaction qualité | calculé |
| Poids payé (kg) | Base du paiement producteur | brut − réfaction totale | calculé |
| Montant (FCFA) | Paiement | poids payé × prix | calculé |

Le BEV et le GRN se comparent sur le **poids net physique**, jamais sur le poids payé. La tare n'est déduite qu'une fois. Les achats déjà enregistrés gardent leur formule d'origine (version de règle 1 : net = brut − tare).

### 4.3 États qualité

| État | Condition | Effet sur le stock |
| --- | --- | --- |
| NON_MESURÉ | Humidité ou KOR absent | Stock sous garde, non libéré ; alerte UH |
| MESURÉ_CONFORME | Les deux mesures présentes et dans les seuils | Libérable après validation UH |
| HORS_SEUIL | Humidité > seuil ou KOR < seuil | À sécher ou à trier ; non libéré |
| EN_ATTENTE_QFS | Dérogation ou litige demandé | Bloqué jusqu'à décision QFS |

### 4.4 Contrat d'échange FBMS → PJS (BEV) et PJS → FBMS (statuts)

| Sens | Données | Clé de rapprochement | Canal phase 1 | Canal cible |
| --- | --- | --- | --- | --- |
| FBMS → PJS | n° BEV, voyage, RT, village, cluster, route, destination, nombre de sacs, brut, tare, net physique, transporteur, camion, chauffeur, heure de remise | n° BEV + n° voyage | Export fichier signé (pjs-export.js existe) importé par PJS | API PJS si Agilemorph la fournit |
| PJS → FBMS | statut (en transit, reçu, GRN émis), n° GRN, poids reçu net, humidité, KOR, date, écart | n° BEV | Import fichier PJS dans pjs_status_snapshots | API ou webhook |

Règle : un GRN manquant laisse le rapprochement ouvert et déclenche une alerte ; il n'annule jamais un BEV signé et ne remet jamais les noix sous la garde du RT. Un écart BEV/GRN ouvre un incident, sans imputation automatique.

## 5. Fonctionnement hors connexion

Toute opération de terrain s'enregistre d'abord sur le téléphone, avec son heure réelle et son auteur, puis part dans la file `offline_sync_batch` ; le serveur accepte, rejette ou met en quarantaine, sans jamais modifier l'heure réelle. Le versement Wave par Finance reste la seule opération financière exclusivement en ligne.

### 5.1 Enveloppe commune d'une opération

| Champ | Règle |
| --- | --- |
| idempotency_key | UUID généré à la création ; un rejeu renvoie le même résultat, jamais un doublon |
| actor_user_id + device_id | Obligatoires ; absents ou différents de la session → QUARANTAINE (corrige ownedBy) |
| campaign_id | Obligatoire ; campagne fermée → REJET motivé |
| occurred_at | Heure du téléphone au geste ; conservée telle quelle ; écart > 72 h avec recorded_at → alerte E5.6 |
| base_version | Version de la fiche lue avant modification ; différente → CONFLIT |
| proof_refs | Photos compressées (reçu, BEV, signature) envoyées avec l'opération ou juste après |

États d'une opération visibles dans E0.3 : LOCALE → ENVOYÉE → ACCEPTÉE, ou REJETÉE (motif lisible, action proposée), ou CONFLIT (arbitrage UH), ou QUARANTAINE (arbitrage BM/ABM). Une opération n'est jamais supprimée en silence. Le téléphone refuse la déconnexion et la mise à jour de l'APK tant que la file n'est pas vide ou exportée.

### 5.2 Catalogue des opérations hors ligne

| Opération | Existe | Contrôle serveur au rejeu | En cas d'échec |
| --- | --- | --- | --- |
| FARMER_ENROLL / COOP_FARMER_ENROLL | Oui | Doublon (téléphone, nom, village), RT obligatoire en canal direct | CONFLIT doublon |
| FARMER_UPDATE | Non, à créer | base_version ; champ par champ | CONFLIT si même champ modifié ailleurs |
| FIELD_GPS_UPDATE | Oui | Périmètre | REJET |
| FIELD_PURCHASE_CREATE | Oui, à compléter | Masses §4.2, qualité §4.3, n° reçu unique par RT, disponible RT | REJET dépassement ; CONFLIT n° reçu |
| BAG_MOVEMENT_CREATE | Oui | Journal canonique, solde non négatif | CONFLIT |
| LOT_CREATE | Non, à créer | Achats validés du même RT, non déjà alloués | CONFLIT |
| TRIP_CREATE | Non, à créer | Transporteur référencé | REJET |
| BEV_SIGN | Non (RPC en ligne aujourd'hui) | Lots du RT, quantités allouées, pas de double sortie, n° BEV papier unique | CONFLIT ; la remise physique reste constatée |
| WAVE_ACK_RT | Non (en ligne dans #311) | Versement Finance existant, témoin ≠ demandeur | En attente du versement |
| WEEKLY_SIGNOFF | Non (en ligne dans #311) | Snapshot figé au moment du comptage | Nouvelle version si données arrivées après |
| WAVE_PAYMENT_CONFIRM | En ligne uniquement | Rôle Finance, référence unique | — |

### 5.3 Achat hors ligne

1. L'agent choisit le village, le RT et le producteur dans les données préchargées (préparation `offline_prepare_device`, valable pour la campagne et un délai fixé).
2. Il saisit le n° du reçu papier, le nombre de sacs, le poids brut, l'humidité et le KOR ; l'écran calcule tare, net physique, réfaction, poids payé et montant.
3. Sans humidité ou sans KOR, l'achat est enregistré NON_MESURÉ et n'alimente pas le stock libéré.
4. Il photographie le reçu ; le RT signe. Le téléphone vérifie un disponible local indicatif ; le serveur tranche au rejeu.
5. L'achat apparaît « enregistré, non validé » jusqu'à la revue UH (E3.2), qui peut se faire plus tard en ligne.

### 5.4 Wave

1. BM crée la demande (en ligne).
2. Finance verse sur Wave, saisit la référence et joint la preuve (en ligne).
3. Le versement est préchargé sur le téléphone de l'UH.
4. Au village, le RT confirme le montant reçu et signe ; l'UH est témoin (WAVE_ACK_RT, hors ligne).
5. Un écart entre montant versé et montant déclaré ouvre un incident.
6. Disponible RT = versé et accusé − achats validés − remboursements confirmés ; les achats saisis non validés sont affichés à part.

### 5.5 Signatures

Trois supports acceptés, dans cet ordre : signature sur écran du téléphone de l'UH ; signature papier photographiée ; refus de signer constaté (motif, témoin, photo). Une signature image attestée par l'UH n'est pas une signature électronique qualifiée : l'original papier est archivé. Au bilan, « désaccord sur le solde » (le RT signe avec réserve) et « refus de signer » sont deux états distincts ; aucun des deux ne bloque la suite, les deux ouvrent un incident ZH.

### 5.6 BEV et transfert de garde

1. Le camion arrive ; l'UH ou le coordinateur crée le Voyage (camion, transporteur, chauffeur, route par défaut du cluster).
2. Pour chaque RT chargé : l'UH choisit ses lots, saisit sacs et kg alloués ; l'écran refuse un lot d'un autre RT ou une quantité supérieure au disponible local.
3. Pesée de départ et comptage des sacs au chargement ; saisie du n° BEV papier pré-imprimé.
4. RT, transporteur et UH signent le BEV papier ; l'UH le photographie. **À cet instant la garde passe au transporteur** : occurred_at est figé et le stock RT affiche « sortie physique constatée, synchronisation en attente ».
5. BEV_SIGN part dans la file. Au rejeu, le serveur vérifie propriété, quantités et unicité ; en cas de conflit, le BEV reste constaté et un incident est ouvert, jamais une seconde remise.
6. Une fois accepté, le BEV entre dans l'export vers PJS. Une réception PJS arrivée avant la synchronisation se rapproche plus tard par le n° BEV.

Le transfert de garde (étape 4) et la validation informatique (étape 5) sont deux événements distincts, datés séparément.

## 6. Corrections P0 classées par dépendance

18 corrections P0 en cinq niveaux : un niveau ne démarre en recette que lorsque ses dépendances sont vertes. Tout se fait sur branche isolée et sur un staging Supabase complet (RLS et déclencheurs réels), jamais en production.

| N° | Niveau | Correction | Dépend de | Preuve d'achèvement |
| --- | --- | --- | --- | --- |
| P0-01 | 0 · Fondations | Matrice des rôles §3 validée ; comptes nominatifs Finance, QFS, ABM créés | Décision BM | Matrice signée |
| P0-02 | 0 | Convention des masses §4.2 et seuils qualité validés | Procurement, QFS, Finance | Note signée + jeu de pesées de référence |
| P0-03 | 0 | Staging Supabase complet (réplique schéma, RLS, déclencheurs) | — | Empreinte schéma = production |
| P0-04 | 0 | Inventaire des APK installés et des files non synchronisées | — | Liste par appareil |
| P0-05 | 1 · Socle | Enveloppe hors ligne §5.1 : auteur et appareil obligatoires, quarantaine (ownedBy) | P0-03 | Test téléphone partagé : 0 opération mal attribuée |
| P0-06 | 1 | Qualité en 4 états, plus de « OK » par défaut | P0-02 | Achat sans mesure = NON_MESURÉ |
| P0-07 | 1 | Champs de masses dans achats, règle de campagne versionnée, historique inchangé | P0-02 | 1 020 kg brut, 20 sacs → 1 000 net, 970 payé (réfaction 30) |
| P0-08 | 1 | Journal sacherie canonique désigné (sacs_mouvements ou rcn_jute_movements), l'autre en projection | P0-03 | Un seul point d'écriture ; vues cohérentes |
| P0-09 | 1 | Séparation des tâches serveur : BM sans `*:*`, ZH limité à sa zone et sans validation qualité, UH sans demande d'avance | P0-01 | Tests de refus par profil |
| P0-10 | 2 · Chaîne | Découpler #311 du GRN interne : supprimer la dépendance trg_051 → wms_grns ; statut aval lu depuis PJS | P0-03 | Expédition clôturable côté FBMS sans GRN FBMS |
| P0-11 | 2 | Objet Voyage ; rt_sop_bev_lots avec kg et sacs ; contrôle du RT gardien ; verrou anti-allocation concurrente | P0-07, P0-08 | 2 allocations simultanées du même lot : 1 refusée |
| P0-12 | 2 | Disponible RT verrouillé en concurrence lors d'un achat | P0-05 | 2 achats simultanés ne dépassent pas le disponible |
| P0-13 | 3 · Terrain | BEV_SIGN dans la file hors ligne, photo du BEV papier, occurred_at figé | P0-05, P0-11 | BEV en mode avion accepté au retour réseau, sans doublon |
| P0-14 | 3 | WAVE_ACK_RT et WEEKLY_SIGNOFF hors ligne ; échéance du bilan à 7 jours | P0-05, P0-09 | Bilan en retard le 8e jour |
| P0-15 | 3 | FARMER_UPDATE hors ligne avec base_version et conflits | P0-05 | Conflit détecté sur un même champ |
| P0-16 | 4 · Intégration | Export BEV → PJS et import des statuts PJS (§4.4) | P0-10, P0-13, audit PJS | BEV reconnu par PJS ; GRN visible dans E4.3 |
| P0-17 | 4 | Routes versionnées : direct Yamoussoukro, N'Djébonoua via Bouaké, relais | P0-16 | Les trois routes testées |
| P0-18 | 4 | Canal APK stable signé contenant P0-05 à P0-15, mise à jour sans perte de file | P0-04, P0-13 à P0-15 | Mise à jour avec 20 opérations en attente : 0 perte |

**P1, après les P0 :** alertes recalibrées par phase (fin des 117 « RT sans activité » avant campagne) ; objectifs Centre et AFLP séparés (40 000 MT affichés contre 3 000 MT AFLP) ; zone de N'Djébonoua corrigée ; parcours coopératif distinct ; navigation V2 ; libellés terrain en français. **P2 :** découpage des fichiers monolithiques, ménage de docs/.

## 7. Critères de recette GO / NO-GO

Huit mises en service, chacune décidée séparément par le BM sur procès-verbal : un critère rouge = NO-GO de cette fonction ou de ce site, quel que soit l'état des autres. Le score de conception (94/100) n'entre pas dans la décision ; seuls comptent les essais ci-dessous.

### 7.1 Conditions d'essai communes

- **Appareils :** au moins 3 téléphones Android réellement distribués aux équipes (dont le modèle le moins puissant), APK du canal à mettre en service, pas un navigateur de bureau.
- **Réseau :** mode avion complet ; coupure pendant une synchronisation ; réseau 2G lent ; retour réseau après 48 h.
- **Situations d'erreur :** téléphone partagé entre deux agents ; horloge du téléphone décalée d'un jour ; batterie coupée pendant l'enregistrement ; double appui sur Enregistrer ; même opération saisie sur deux téléphones.
- **Profils :** chaque scénario est joué par un vrai titulaire du rôle (AUH, UH, ZH, Finance, QFS), sur staging avec données fictives.
- **Mesures relevées :** temps et nombre d'étapes par scénario, erreurs commises, opérations perdues ou dupliquées, refus serveur justifiés ou non.

### 7.2 Critères par mise en service

| Mise en service | Scénarios obligatoires | GO si | NO-GO si |
| --- | --- | --- | --- |
| M1 · Navigation V2, Réseau, Terrain | S1 : AUH enrôle 5 producteurs et modifie 3 fiches en mode avion, puis synchronise | 8/8 opérations acceptées ; 0 doublon ; ≤ 10 étapes par fiche ; l'AUH trouve chaque écran sans aide | Une fiche perdue, une modification écrasée sans conflit signalé, un écran hors périmètre visible |
| M2 · Achats bord champ | S2 : 10 achats dont 2 sans mesure, 1 hors seuil, 1 hors barème, 2 simultanés dépassant le disponible | Masses exactes au kg ; sans mesure = NON_MESURÉ ; dépassement refusé ; n° reçu en double refusé | Un achat « OK » sans mesure ; un écart de calcul ; un dépassement accepté |
| M3 · Wave et comptes RT | S3 : versement 300 000, achats validés 200 000, en attente 40 000, remboursement 10 000 | Reste à justifier = 90 000 FCFA ; 40 000 affichés à part ; BM ne peut ni confirmer le versement ni l'accusé | Un profil contourne Finance ou le RT ; une référence Wave acceptée deux fois |
| M4 · Bilan hebdomadaire | S4 : 3 bilans (accord, réserve, refus de signer) dont un hors ligne et un corrigé après signature | 3 états distincts conservés ; correction = nouvelle version, original lisible ; retard signalé au 8e jour | Signature fabriquée ; original modifié ; retard mesuré à 14 jours |
| M5 · Voyage et BEV | S5 : un camion, 2 RT de 2 villages, 200 kg et 150 kg, en mode avion, puis tentative d'allocation d'un lot d'un 3e RT | 2 BEV, 1 voyage ; heures de remise conservées ; lot étranger refusé ; aucun double départ au rejeu | Un BEV perdu ou dupliqué ; une sortie de stock comptée deux fois ; un lot d'un autre RT accepté |
| M6 · Interface PJS | S6 : 3 BEV exportés, PJS réceptionne 2 (dont un à 195 kg pour 200 kg), le 3e sans GRN | BEV reconnus par n° ; écart −5 kg ouvert en incident ; GRN manquant = alerte, BEV intact ; aucun GRN créé dans FBMS | Ressaisie manuelle du chargement dans PJS ; BEV annulé par l'absence de GRN |
| M7 · Bascule d'un relais vers PJS (par site) | Inventaire physique signé, stock d'ouverture importé dans PJS, expéditions en cours traitées | Écart inventaire/FBMS expliqué ; FBMS du site en lecture seule ; un seul système officiel | Deux systèmes écrivent le stock du même site |
| M8 · Canal APK stable | Mise à jour de 3 téléphones portant chacun 20 opérations en attente ; retour arrière | 0 opération perdue ; empreinte du certificat vérifiée ; retour arrière éprouvé | Une perte de file ; une installation par désinstallation |

### 7.3 Simulations de supervision

- **S6 ZH :** depuis E0, le ZH affiche ses RT à risque (achat hors barème, solde non justifié, bilan en retard, BEV en conflit) en ≤ 3 écrans et ouvre la preuve en 1 clic.
- **S7 BM depuis Bouaké :** E5.1 montre la cible AFLP (pas l'objectif Centre), chaque chiffre avec sa source et son niveau de vérification, et la liste des actions en attente par responsable.

### 7.4 Ordre de mise en service et calendrier cible

| Mise en service | Prérequis P0 | Échéance cible |
| --- | --- | --- |
| M1, M2 | P0-01 à P0-07, P0-12, P0-15 | Recette avant le 15/12/2026 |
| M3, M4 | P0-09, P0-14 | Recette avant le 31/12/2026 ; GO avant le premier versement RT (fin janvier 2027) |
| M5, M6 | P0-10, P0-11, P0-13, P0-16, P0-17 | GO avant la première expédition réelle |
| M7 | Audit PJS multi-sites | Décision par site, à partir du 15/12/2026 |
| M8 | P0-18 | Avec chaque GO ci-dessus |

## 8. Arbitrages ouverts et hypothèses

Six décisions restent au BM avant le développement ; tant qu'elles ne sont pas prises, la ligne de dépendance concernée (§6) reste bloquée.

| Arbitrage | Recommandation | Bloque |
| --- | --- | --- |
| Relais non prêt dans PJS au 15/12 | (a) FBMS officiel temporaire pour ce seul site avec date de migration écrite, ou (b) relais non utilisé pour l'achat, routage direct ; jamais deux systèmes officiels | M7, P0-17 |
| Convention des masses et tare unitaire | Grandeurs §4.2, tare 1 kg/sac déduite une seule fois | P0-02, P0-07, M2 |
| Coopérative qui livre elle-même | Document de remise propre au circuit coopératif ; définir qui remet, transporte et signe | Parcours coopératif (P1) |
| Journal sacherie canonique | sacs_mouvements ou rcn_jute_movements, après audit des écritures existantes | P0-08, P0-11 |
| SOP-AFLP-RT-001 | Obtenir les visas BM, Finance, QFS, Direction (document encore en V1.0 « à approuver ») | M3, M4 |
| Observatoire des vergers | Collecte pilote étiquetée, protocole versionné ; aucun indicateur officiel ni conversion en tonnage | E2.4 |

**Hypothèses à vérifier**

- PJS sait importer un BEV et exporter ses statuts par fichier : non vérifié, PJS n'a pas été audité au-delà de son écran de connexion.
- Les objectifs 40 000 MT affichés correspondent à la Zone Centre et non à l'AFLP (3 000 MT).
- Les cinq relais ne sont utilisés que pour les lots qui y transitent réellement ; la route par défaut des clusters hors N'Djébonoua reste directe vers Yamoussoukro.

**Ce que V2.1 n'autorise pas :** aucune fusion de PR (dont #311), aucune migration en production, aucune écriture dans la base réelle. La prochaine étape autorisée est la préparation des P0 de niveau 0 et 1 sur branche isolée et staging.

**Sources :** dépôt nwodobe/fbms, main a857065 (12/11/2026) et branche de la PR #311 (migrations rt_sop_*, operations/rt-sop-console.js) ; shared/aflp-access.js ; shared/offline-field.js ; operations/field-buying.js ; contre-expertise Claude × ChatGPT du 13/11/2026.

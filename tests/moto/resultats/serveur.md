Replique fbms_moto_test construite : 49 fonctions identiques a la production (md5).
Passe 1 : migrations appliquées.
Passe 2 : migrations appliquées.
| id | exigence | compte | action | attendu | obtenu | résultat |
|---|---|---|---|---|---|---|
| SEC-01 | Accès refusé aux rôles hors périmètre | sup | Supervisor crée une moto | REFUS (rôle) | REFUS : Accès Moto Manager refusé : compte inactif ou rôle non habilité. | RÉUSSI |
| SEC-02 | Accès refusé anonyme | anon | Anonyme lit la flotte | REFUS (permission) | REFUS : permission denied for table moto_motos | RÉUSSI |
| SEC-03 | Pas de création par Chef d'unité | uh_sak | Chef d'unité crée une moto | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| SEC-04 | Écriture directe interdite (RLS + privilèges) | bm | BM insère directement dans moto_motos | REFUS (permission) | REFUS : permission denied for table moto_motos | RÉUSSI |
| INV-01 | Passeport : création sans châssis inventé | abm | ABM crée moto 1 (SAKASSOU) | OK | OK : {"id": "d68bad65-3c69-47b7-af3a-d6485068998f", "code": "MOTO-001", "qr_token": "56ef0 | RÉUSSI |
| INV-02 | Passeport : création sans châssis inventé | abm | ABM crée moto 2 (BOTRO) | OK | OK : {"id": "8e9ab2e1-e172-41b5-a1b0-c32429a0bf18", "code": "MOTO-002", "qr_token": "b4d8e | RÉUSSI |
| INV-03 | Passeport : création sans châssis inventé | abm | ABM crée moto 3 (BROBO) | OK | OK : {"id": "d676f2d6-62cc-41eb-9540-152b51fcdd23", "code": "MOTO-003", "qr_token": "efc46 | RÉUSSI |
| INV-04 | Passeport : création sans châssis inventé | abm | ABM crée moto 4 (N'Djébonoua) | OK | OK : {"id": "6d41d92e-772b-4048-8e10-b20900382357", "code": "MOTO-004", "qr_token": "fb3f4 | RÉUSSI |
| INV-05 | Identifiant et QR uniques | postgres (lecture) | 4 codes et 4 jetons QR distincts | 4/4 | 4/4 | RÉUSSI |
| INV-06 | Châssis non inventé | postgres (lecture) | Châssis et immatriculation vides à la création | 4 | 4 | RÉUSSI |
| INV-07 | Statuts initiaux indépendants | postgres (lecture) | EN_ATTENTE / NON_AFFECTEE / A_CONTROLER | EN_ATTENTE/NON_AFFECTEE/A_CONTROLER | EN_ATTENTE/NON_AFFECTEE/A_CONTROLER | RÉUSSI |
| INV-08 | Unicité châssis | abm | Deux motos avec le même châssis fictif | REFUS (duplicate) | REFUS : duplicate key value violates unique constraint "moto_motos_chassis_uq" | RÉUSSI |
| INV-09 | Saisie identité M1 | abm | Châssis et immatriculation fictifs M1 | OK | OK : {"id": "d68bad65-3c69-47b7-af3a-d6485068998f", "row_version": 2} | RÉUSSI |
| INV-10 | Conflit de version | abm | Modification avec row_version périmée | REFUS (CONFLIT) | REFUS : CONFLIT : la fiche a été modifiée par un autre utilisateur. Rechargez-la. | RÉUSSI |
| JOU-01 | Journal : ancienne/nouvelle valeur, auteur, motif | postgres (lecture) | Journal de M1 avec motif | t | t | RÉUSSI |
| JOU-02 | Journal immuable | bm | BM supprime une ligne de journal | REFUS (permission) | REFUS : permission denied for table moto_journal | RÉUSSI |
| JOU-03 | Journal immuable (même superutilisateur) | postgres (lecture) | Trigger refuse la mise à jour | refuse | refuse | RÉUSSI |
| STO-01 | Stockage privé : dépôt hors périmètre refusé | uh_sak | Chef d'unité dépose dans le dossier d'une moto non affectée | REFUS (row-level security) | REFUS : new row violates row-level security policy for table "objects" | RÉUSSI |
| STO-02 | Stockage privé : chemin non conforme refusé | abm | ABM dépose hors dossier moto | REFUS (row-level security) | REFUS : new row violates row-level security policy for table "objects" | RÉUSSI |
| STO-03 | Stockage privé : dépôt ABM accepté | abm | ABM dépose dans le dossier de M1 | OK | OK :  | RÉUSSI |
| STO-04 | Bucket privé | postgres (lecture) | public = false | f | f | RÉUSSI |
| DOC-01 | Document : fichier obligatoire | abm | Carte grise sans fichier | REFUS (fichier) | REFUS : Ce document exige le fichier numérisé. | RÉUSSI |
| DOC-02 | Document : fichier réellement présent | abm | Carte grise avec chemin inexistant | REFUS (introuvable) | REFUS : Fichier introuvable dans le stockage privé : déposez-le avant d'enregistrer. | RÉUSSI |
| DOC-03 | Documents administratifs | abm | Carte grise M1 | OK | OK : {"id": "11b3c7c3-1ebb-4734-9ef7-bd676f936b91", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-04 | Documents administratifs | abm | Plaque M1 | OK | OK : {"id": "6a36c388-44cc-48df-bb52-a007811635e6", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-05 | Documents administratifs | abm | Assurance M1 | OK | OK : {"id": "7eb1fdf1-c987-483b-88c7-3e96ff4d8d34", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-06 | Statut administratif EN_VERIFICATION | postgres (lecture) | Documents déposés non vérifiés | EN_VERIFICATION | EN_VERIFICATION | RÉUSSI |
| DOC-07 | Auto-vérification interdite | abm | ABM vérifie son propre dépôt | REFUS (Auto-validation) | REFUS : Auto-validation interdite : un autre responsable doit vérifier ce document. | RÉUSSI |
| DOC-08 | Non conforme exige un motif | bm | BM refuse sans motif | REFUS (Motif) | REFUS : Motif obligatoire (5 caractères minimum). | RÉUSSI |
| DOC-09cg1 | Vérification par un tiers | bm | BM vérifie carte grise M1 | OK | OK : {"id": "11b3c7c3-1ebb-4734-9ef7-bd676f936b91", "statut": "CONFORME"} | RÉUSSI |
| DOC-09pl1 | Vérification par un tiers | bm | BM vérifie plaque M1 | OK | OK : {"id": "6a36c388-44cc-48df-bb52-a007811635e6", "statut": "CONFORME"} | RÉUSSI |
| DOC-09as1 | Vérification par un tiers | bm | BM vérifie assurance M1 | OK | OK : {"id": "7eb1fdf1-c987-483b-88c7-3e96ff4d8d34", "statut": "CONFORME"} | RÉUSSI |
| DOC-10 | Conformité administrative | postgres (lecture) | CONFORME après 3 documents vérifiés | CONFORME | CONFORME | RÉUSSI |
| DOC-11 | Documents administratifs | abm | Assurance expirée M2 | OK | OK : {"id": "25418871-58ac-45a8-9b06-627dbc894de3", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-12 | Document expiré non conforme | bm | BM déclare conforme une assurance expirée | REFUS (expiré) | REFUS : Document expiré : il ne peut pas être déclaré conforme. | RÉUSSI |
| DOC-14 | Moto réceptionnée sans documents : non autorisée à circuler | postgres (lecture) | autorisee_a_circuler = false | f | f | RÉUSSI |
| INS-01 | Inspection : mécanicien obligatoire | abm | Inspection sans nom de mécanicien | REFUS (mécanicien) | REFUS : Nom du mécanicien et du garage obligatoires. | RÉUSSI |
| INS-02 | Anomalie critique calculée par le serveur | abm | Inspection M2 avec freins KO déclarée APTE par le client | OK | OK : {"id": "3b5a6786-5752-445d-8a2c-b32101d5c5ce", "resultat": "INAPTE", "anomalie_critiq | RÉUSSI |
| INS-03 | Anomalie critique bloque la mise en service | postgres (lecture) | M2 IMMOBILISEE, résultat INAPTE | IMMOBILISEE/INAPTE | IMMOBILISEE/INAPTE | RÉUSSI |
| INS-04 | Inspection initiale APTE | abm | Inspection M1 APTE | OK | OK : {"id": "2ac25ced-a893-4563-9960-d2bf9ab7c0a6", "resultat": "APTE", "anomalie_critique | RÉUSSI |
| INS-05 | Statut technique APTE | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| AFF-01 | Préaffectation réservée au Branch Manager | abm | ABM préaffecte | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| AFF-02 | Bénéficiaire doit être Chef d'unité/zone | bm | Préaffectation à un Supervisor | REFUS (Chef) | REFUS : Le bénéficiaire doit être un Chef d'unité ou un Chef de zone. | RÉUSSI |
| AFF-03 | Bénéficiaire inactif refusé | bm | Préaffectation à un compte inactif | REFUS (inactif) | REFUS : Bénéficiaire introuvable ou compte inactif. | RÉUSSI |
| AFF-04 | Préaffectation | bm | BM préaffecte M1 à UH Sakassou | OK | OK : {"id": "1414ccd4-58c0-4540-9c37-72e0e40a446d", "statut_affectation": "PREAFFECTEE"} | RÉUSSI |
| AFF-05 | Une seule affectation active | bm | Seconde préaffectation de M1 | REFUS (transfert) | REFUS : Cette moto a déjà une affectation active : utilisez le transfert. | RÉUSSI |
| AFF-06 | Préaffectation M4 cluster normalisé | bm | BM préaffecte M4 à UH N'Djébonoua | OK | OK : {"id": "a040a493-cd84-43c5-b00f-5f244fbb07e0", "statut_affectation": "PREAFFECTEE"} | RÉUSSI |
| AFF-07 | Cluster N'Djébonoua normalisé | postgres (lecture) | DJEBONOUA | DJEBONOUA | DJEBONOUA | RÉUSSI |
| REM-01 | PV papier numérisé et vérifié obligatoire | abm | Remise sans PV | REFUS (Procès-verbal) | REFUS : Procès-verbal signé, numérisé et vérifié CONFORME obligatoire. | RÉUSSI |
| REM-02 | Documents administratifs | abm | Dépôt du PV signé numérisé M1 | OK | OK : {"id": "8e5b324f-3c1d-49e0-a080-b2828f4e5dd4", "statut": "EN_VERIFICATION"} | RÉUSSI |
| REM-03 | PV non vérifié refusé | abm | Remise avec PV non vérifié | REFUS (Procès-verbal) | REFUS : Procès-verbal signé, numérisé et vérifié CONFORME obligatoire. | RÉUSSI |
| REM-04 | Vérification PV par un tiers | bm | BM vérifie le PV | OK | OK : {"id": "8e5b324f-3c1d-49e0-a080-b2828f4e5dd4", "statut": "CONFORME"} | RÉUSSI |
| REM-05 | Permis vérifié RH obligatoire | abm | Remise sans vérification du permis | REFUS (permis) | REFUS : Vérification RH du permis adapté obligatoire (catégorie et vérificateur). | RÉUSSI |
| REM-06 | Équipements de sécurité obligatoires | abm | Remise sans gilet | REFUS (GILET) | REFUS : Équipement de sécurité manquant : GILET_HAUTE_VISIBILITE. | RÉUSSI |
| REM-07 | Documents conformes obligatoires | abm | Remise de M4 (aucun document) | REFUS (non conformes) | REFUS : Remise bloquée : documents administratifs non conformes (EN_ATTENTE). | RÉUSSI |
| REM-08 | Remise complète | abm | ABM enregistre la remise de M1 | OK (REMISE) | OK : {"id": "ec616c0f-336f-4a93-accc-c65bc9a55b86", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| REM-09 | Statut affectation REMISE, pas encore en service | postgres (lecture) | REMISE/false | REMISE/false | REMISE/false | RÉUSSI |
| MES-01 | Chef d'unité : pas de saisie avant mise en service | uh_sak | Relevé km avant mise en service | REFUS (non mise en service) | REFUS : Moto non mise en service : saisie terrain impossible. | RÉUSSI |
| MES-02 | Mise en service réservée au BM | abm | ABM met en service | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| MES-03 | Mise en service (décision distincte de la remise) | bm | BM autorise la circulation de M1 | OK | OK : {"id": "d68bad65-3c69-47b7-af3a-d6485068998f", "mise_en_service": true} | RÉUSSI |
| MES-04 | Moto autorisée à circuler | postgres (lecture) | t | t | t | RÉUSSI |
| PER-01 | Chef d'unité voit sa moto et son cluster | uh_sak | UH Sakassou lit la flotte | OK (1) | OK : 1 | RÉUSSI |
| PER-02 | Chef d'unité ne voit pas les autres clusters | uh_bot | UH Botro lit M1 | OK (0) | OK : 0 | RÉUSSI |
| PER-03 | Chef de zone : portée terrain globale (décision 17/09/2026) | zh | ZH lit la flotte | OK (4) | OK : 4 | RÉUSSI |
| PER-04 | Finance : lecture | fin | Finance lit la flotte | OK (4) | OK : 4 | RÉUSSI |
| PER-05 | Rôle non habilité : rien | agent | Agent recenseur lit la flotte | OK (0) | OK : 0 | RÉUSSI |
| PER-06 | Documents privés : périmètre | uh_bot | UH Botro lit les documents de M1 | OK (0) | OK : 0 | RÉUSSI |
| PER-07 | Stockage : lecture hors périmètre refusée | uh_bot | UH Botro lit les fichiers de M1 | OK (0) | OK : 0 | RÉUSSI |
| PER-08 | Stockage : lecture affectataire | uh_sak | UH Sakassou lit les fichiers de M1 | OK (t) | OK : t | RÉUSSI |
| PER-09 | Journal : non visible du Chef d'unité | uh_sak | UH lit le journal | OK (0) | OK : 0 | RÉUSSI |
| KM-01 | Relevé kilométrique | uh_sak | Relevé 40 km | OK | OK : {"moto_id": "d68bad65-3c69-47b7-af3a-d6485068998f", "compteur_km": 40} | RÉUSSI |
| KM-02 | Idempotence : rejeu du même relevé | uh_sak | Rejeu client_op_id identique | OK (doublon) | OK : {"statut": "SYNCHRONISE", "doublon": true, "moto_id": "d68bad65-3c69-47b7-af3a-d64850 | RÉUSSI |
| KM-03 | Pas de doublon en base | postgres (lecture) | 1 | 1 | 1 | RÉUSSI |
| KM-04 | Compteur décroissant refusé (conflit) | uh_sak | Relevé 30 km après 40 km | REFUS (CONFLIT_COMPTEUR) | REFUS : CONFLIT_COMPTEUR : 30 km est inférieur au relevé antérieur (40.0 km). Demandez une | RÉUSSI |
| KM-05 | Identifiant d'opération d'un autre compte | zh | ZH réutilise le client_op_id de l'UH | REFUS (autre compte) | REFUS : Identifiant d'opération déjà utilisé par un autre compte. | RÉUSSI |
| KM-06 | Chef d'unité : pas de saisie sur une moto non affectée | uh_bro | UH Brobo relève M1 | REFUS (périmètre) | REFUS : Moto hors de votre périmètre ou non affectée à votre compte. | RÉUSSI |
| CTL-01 | Contrôle avant départ APTE | uh_sak | Contrôle OK | OK (APTE) | OK : {"id": "c5b696cb-a664-4d86-87f5-0c00f244e222", "incident": null, "resultat": "APTE",  | RÉUSSI |
| CTL-02 | Contrôle : points invalides refusés | uh_sak | Contrôle sans points | REFUS (vide) | REFUS : Liste de points de contrôle vide ou invalide. | RÉUSSI |
| SYN-01 | Synchronisation par lot | uh_sak | Lot : 1 valide, 1 conflit, 1 id invalide, 1 type interdit | OK | OK : [{"statut": "SYNCHRONISE", "resultat": {"moto_id": "d68bad65-3c69-47b7-af3a-d64850689 | RÉUSSI |
| SYN-02 | Statuts « Synchronisé » / « Rejeté » | uh_sak | Statuts renvoyés par opération | SYNCHRONISE,REJETE,REJETE,REJETE | SYNCHRONISE,REJETE,REJETE,REJETE | RÉUSSI |
| SYN-03 | Rejeu du lot sans doublon | uh_sak | Même lot renvoyé | OK | OK : [{"statut": "SYNCHRONISE", "doublon": true, "message": null, "resultat": {"statut": " | RÉUSSI |
| SYN-04 | Idempotence du lot | uh_sak | Le rejeu renvoie les mêmes statuts marqués doublon | [SYNCHRONISE doublon, REJETE doublon] | [('SYNCHRONISE', True), ('REJETE', True)] | RÉUSSI |
| SYN-05 | Un seul relevé 55 km en base | postgres (lecture) | 1 | 1 | 1 | RÉUSSI |
| SYN-06 | Lot limité | uh_sak | Lot de 51 opérations | REFUS (50) | REFUS : Lot limité à 50 opérations. | RÉUSSI |
| BUD-01 | Budget : Chef d'unité interdit | uh_sak | UH propose un budget | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| BUD-02 | Budget proposé par l'ABM | abm | ABM propose 30 000 FCFA (fictif) | OK (PROPOSE) | OK : {"id": "10165e88-9707-4356-ad40-fee954f04f2a", "statut": "PROPOSE"} | RÉUSSI |
| BUD-03 | Dotation impossible sans budget autorisé | abm | Remise sur budget proposé | REFUS (budget autorisé) | REFUS : Dotation impossible : aucun budget autorisé. | RÉUSSI |
| BUD-04 | Validation du budget par le BM | bm | BM valide le budget | OK (VALIDE) | OK : {"id": "10165e88-9707-4356-ad40-fee954f04f2a", "statut": "VALIDE"} | RÉUSSI |
| DOT-01 | Dotation espèces | abm | ABM remet 10 000 FCFA en espèces | OK (REMISE_DECLAREE) | OK : {"id": "1769855f-be42-49e3-951f-12ed141da5f2", "note": "En attente de confirmation de | RÉUSSI |
| DOT-02 | Mobile Money : référence obligatoire | abm | Mobile Money sans référence | REFUS (Référence) | REFUS : Référence de transaction Mobile Money obligatoire. | RÉUSSI |
| DOT-03 | Mobile Money : frais distincts | abm | Mobile Money 10 000 + 100 de frais | OK | OK : {"id": "e4cb8ce5-3489-4cb7-a335-6fee12e0c8ed", "note": "En attente de confirmation de | RÉUSSI |
| DOT-04 | Mobile Money échoué | abm | Mobile Money 5 000 | OK | OK : {"id": "d071d600-d295-4c66-9985-25841ffc50ce", "note": "En attente de confirmation de | RÉUSSI |
| DOT-05 | Dépassement de budget refusé | abm | Remise de 10 000 au-delà de 30 000 | REFUS (Dépassement) | REFUS : Dépassement du budget autorisé : 25000 déjà remis sur 30000 FCFA. | RÉUSSI |
| DOT-06 | Transaction échouée | abm | ABM déclare l'échec MM-TEST-0002 | OK (ECHOUEE) | OK : {"id": "d071d600-d295-4c66-9985-25841ffc50ce", "statut": "ECHOUEE"} | RÉUSSI |
| DOT-07 | Seul le bénéficiaire confirme | abm | ABM confirme à la place de l'UH | REFUS (bénéficiaire) | REFUS : Seul le bénéficiaire confirme la réception de sa dotation. | RÉUSSI |
| DOT-08 | Échec non confirmable | uh_sak | UH confirme la transaction échouée | REFUS (ECHOUEE) | REFUS : Cette dotation n'est plus en attente de confirmation (ECHOUEE). | RÉUSSI |
| DOT-09 | Confirmation de réception | uh_sak | UH confirme 10 000 espèces | OK (CONFIRMEE) | OK : {"id": "1769855f-be42-49e3-951f-12ed141da5f2", "statut": "CONFIRMEE", "montant_recu": | RÉUSSI |
| DOT-10 | Écart de réception = contestation | uh_sak | UH déclare 9 900 reçus sur 10 000 MM | OK (CONTESTEE) | OK : {"id": "e4cb8ce5-3489-4cb7-a335-6fee12e0c8ed", "statut": "CONTESTEE", "montant_recu": | RÉUSSI |
| CAR-01 | Plein/partiel obligatoire | uh_sak | Achat sans préciser plein | REFUS (plein) | REFUS : Préciser plein complet ou partiel. | RÉUSSI |
| CAR-02 | Carburant | uh_sak | Plein initial complet (référence) | OK | OK : {"id": "9fdd4cbc-bf13-4bfa-a0f5-6d09054f342d", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-03 | Carburant | uh_sak | Plein partiel | OK | OK : {"id": "22350c6d-133e-4e71-bf0d-0abea3d4d0e8", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-04 | Carburant | uh_sak | Plein complet de contrôle | OK | OK : {"id": "fbe826f8-5c60-4642-84fc-425e57c20365", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-05 | Consommation plein à plein vérifiable | postgres (lecture) | 100×(1,5+2,0)/(160−60) = 3,50 L/100 km | 3.50 | 3.50 | RÉUSSI |
| CAR-06 | Plein initial non compté deux fois | postgres (lecture) | Litres de l'intervalle = 3,50 (plein initial de 3 L exclu) | 3.50 | 3.50 | RÉUSSI |
| CAR-07 | Seuils provisoires : 3,50 < 3,6 → NORMAL | postgres (lecture) | NORMAL | NORMAL | NORMAL | RÉUSSI |
| CAR-08 | Données insuffisantes → Non disponible | postgres (lecture) | M3 : l_100km NULL | NULL | NULL | RÉUSSI |
| CAR-09 | Carburant | uh_sak | Achat daté après un relevé supérieur | REFUS (CONFLIT_COMPTEUR) | REFUS : CONFLIT_COMPTEUR : 150 km est inférieur au relevé antérieur (160.0 km). Demandez u | RÉUSSI |
| CAR-10 | Carburant | uh_sak | Avance personnelle de l'agent | OK | OK : {"id": "9c47d80e-6227-48e2-b883-cbba33586575", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| JUS-01 | Auto-vérification interdite | uh_sak | UH vérifie son justificatif | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| JUS-02 | Vérification des justificatifs | fin | Finance vérifie l'achat 1 | OK (VERIFIE) | OK : {"id": "9fdd4cbc-bf13-4bfa-a0f5-6d09054f342d", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-03 | Vérification des justificatifs | fin | Finance vérifie l'achat 2 | OK (VERIFIE) | OK : {"id": "22350c6d-133e-4e71-bf0d-0abea3d4d0e8", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-04 | Vérification des justificatifs | fin | Finance vérifie l'achat 3 | OK (VERIFIE) | OK : {"id": "fbe826f8-5c60-4642-84fc-425e57c20365", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-06 | Vérification des justificatifs | fin | Finance vérifie l'achat 5 | OK (VERIFIE) | OK : {"id": "9c47d80e-6227-48e2-b883-cbba33586575", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| RAP-01 | Rapprochement : remis / reçu / justifié / à apurer | postgres (lecture) | remis 20000 · reçu 19900 (10000 + 9900 en écart) · frais 100 · écart 100 · justifié 5525 · à apurer 14375 | 20000·19900·100·100·5525·14375 | 20000·19900·100·100·5525·14375 | RÉUSSI |
| RES-01 | Restitution > avance refusée | abm | Restitution de 20 000 | REFUS (supérieure) | REFUS : Restitution supérieure à l'avance à apurer (14375 FCFA). | RÉUSSI |
| RES-02 | Restitution d'espèces restantes | abm | Restitution de 475 | OK (13900) | OK : {"id": "aa7e0e87-e253-4954-9ea3-3379c7ab76c4", "solde_restant": 13900} | RÉUSSI |
| RBT-01 | Remboursement d'avance personnelle | abm | ABM demande le remboursement de l'avance | OK (2125) | OK : {"id": "a4c54d20-097c-472e-b6d0-24b5c925a4e8", "statut": "DEMANDE", "montant": 2125} | RÉUSSI |
| RBT-02 | Pas de double remboursement | abm | Deuxième demande sur le même achat | REFUS (non encore remboursée) | REFUS : Chaque achat doit être une avance personnelle de ce bénéficiaire, justifiée VÉRIFI | RÉUSSI |
| RBT-03 | Finance simple : pas de validation | fin | Finance valide le remboursement | REFUS (Finance Manager) | REFUS : Validation réservée au Branch Manager ou au Finance Manager. | RÉUSSI |
| RBT-04 | Validation par le Finance Manager | fm | Finance Manager valide | OK (VALIDE) | OK : {"id": "a4c54d20-097c-472e-b6d0-24b5c925a4e8", "statut": "VALIDE"} | RÉUSSI |
| RBT-05 | Paiement déclaré (non exécuté) | fin | Finance déclare le paiement MM | OK (PAYE_DECLARE) | OK : {"id": "a4c54d20-097c-472e-b6d0-24b5c925a4e8", "statut": "PAYE_DECLARE"} | RÉUSSI |
| RAP-02 | Pas de double comptage dotation/remboursement | postgres (lecture) | reste à rembourser 0 · remboursé 2125 · à apurer 13900 | 0·2125·13900 | 0·2125·13900 | RÉUSSI |
| COR-01 | Correction : demande ABM | abm | ABM demande la correction des frais MM | OK (DEMANDEE) | OK : {"id": "63636e8c-724e-40d5-991b-6dae1ce6ac0f", "statut": "DEMANDEE"} | RÉUSSI |
| COR-02 | Champ non corrigeable | zh | ZH corrige un montant de dotation | REFUS (non corrigeable) | REFUS : Champ non corrigeable par votre rôle. | RÉUSSI |
| COR-03 | ABM ne valide pas une correction | abm | ABM valide sa propre correction | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| COR-04 | Validation BM | bm | BM applique la correction | OK (APPLIQUEE) | OK : {"id": "63636e8c-724e-40d5-991b-6dae1ce6ac0f", "statut": "APPLIQUEE"} | RÉUSSI |
| COR-05 | Valeur corrigée et journal avec valideur | postgres (lecture) | 150 / valideur BM | 150/1 | 150/1 | RÉUSSI |
| COR-06 | BM initie une correction | bm | BM demande correction compteur relevé | OK | OK : {"id": "cc627c1f-eaed-4922-ae22-cc0acdcfd627", "statut": "DEMANDEE"} | RÉUSSI |
| COR-07 | BM ne s'auto-approuve pas | bm | BM valide sa propre demande | REFUS (Auto-approbation) | REFUS : Auto-approbation interdite : un autre responsable doit valider. | RÉUSSI |
| COR-08 | Validation par la Direction | gm | General Manager rejette | OK (REJETEE) | OK : {"id": "cc627c1f-eaed-4922-ae22-cc0acdcfd627", "statut": "REJETEE"} | RÉUSSI |
| INC-01 | Anomalie critique au départ → immobilisation | uh_sak | Contrôle avant départ freins KO | OK (INAPTE) | OK : {"id": "941c75c1-df8f-4174-9232-569bf0ac2163", "incident": {"id": "6422c5f0-6fc6-4fb0 | RÉUSSI |
| INC-02 | Moto immobilisée sans attendre | postgres (lecture) | IMMOBILISEE / non autorisée | IMMOBILISEE/false | IMMOBILISEE/false | RÉUSSI |
| INC-03 | Chef d'unité ne pilote pas le circuit | uh_sak | UH avance l'incident | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| INC-04 | Transition interdite | zh | Saut direct vers REMIS_EN_SERVICE | REFUS (Transition) | REFUS : Transition interdite : IMMOBILISEE → REMIS_EN_SERVICE. | RÉUSSI |
| INC-05 | Diagnostic | zh | ZH : diagnostic | OK | OK : {"id": "6422c5f0-6fc6-4fb0-aa87-3019d66aea56", "etape": "DIAGNOSTIC"} | RÉUSSI |
| INC-06 | Autorisation de dépense : montant obligatoire | zh | Autorisation sans montant | REFUS (Montant) | REFUS : Montant estimé de la dépense obligatoire. | RÉUSSI |
| INC-07 | ABM ne peut pas autoriser la dépense | abm | ABM autorise la dépense | REFUS (réservée) | REFUS : Autorisation de dépense réservée au Branch Manager ou au Chef de Zone. | RÉUSSI |
| INC-08 | Autorisation de dépense | zh | ZH autorise 8 000 (fictif) | OK | OK : {"id": "6422c5f0-6fc6-4fb0-aa87-3019d66aea56", "etape": "AUTORISATION_DEPENSE"} | RÉUSSI |
| INC-09 | Réparation | zh | ZH : réparation | OK | OK : {"id": "6422c5f0-6fc6-4fb0-aa87-3019d66aea56", "etape": "REPARATION"} | RÉUSSI |
| INC-10 | Contrôle | zh | ZH : étape contrôle | OK | OK : {"id": "6422c5f0-6fc6-4fb0-aa87-3019d66aea56", "etape": "CONTROLE"} | RÉUSSI |
| INC-11 | Remise en service exige un contrôle APTE | zh | Remise en service sans contrôle | REFUS (contrôle) | REFUS : Remise en service bloquée : contrôle de remise en service APTE obligatoire après l | RÉUSSI |
| INC-12 | Contrôle de remise en service | zh | ZH enregistre le contrôle APTE | OK (APTE) | OK : {"id": "8549fb7f-84c5-47c4-b3ed-2028623d2099", "resultat": "APTE"} | RÉUSSI |
| INC-13 | Remise en service | zh | ZH remet en service | OK | OK : {"id": "6422c5f0-6fc6-4fb0-aa87-3019d66aea56", "etape": "REMIS_EN_SERVICE"} | RÉUSSI |
| INC-14 | Clôture | zh | ZH clôt l'incident avec coût réel | OK | OK : {"id": "6422c5f0-6fc6-4fb0-aa87-3019d66aea56", "etape": "CLOS"} | RÉUSSI |
| INC-15 | Moto de nouveau APTE | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| INC-16 | Historique complet du circuit | postgres (lecture) | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,C | RÉUSSI |
| INC-17 | Accident : registre AFLP lié (pas de doublon de saisie) | uh_sak | UH déclare un accident | OK (INC-) | OK : {"id": "6ec0aa9a-177e-4dd0-925b-31d37ae7fc61", "immobilisee": true, "aflp_incident_id | RÉUSSI |
| INC-18 | Incident AFLP créé et relié | postgres (lecture) | ACCIDENT_MOTO | ACCIDENT_MOTO | ACCIDENT_MOTO | RÉUSSI |
| INC-19 | Accident = immobilisation | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| INC-20 | Traçabilité : relevé km accepté pendant immobilisation | uh_sak | Relevé km pendant immobilisation | OK | OK : {"moto_id": "d68bad65-3c69-47b7-af3a-d6485068998f", "compteur_km": 207} | RÉUSSI |
| MNT-01 | Demande d'entretien terrain | uh_sak | UH demande une vidange | OK (DEMANDEE) | OK : {"id": "9698aa39-dbce-4d0b-9850-0d422b983f11", "statut": "DEMANDEE"} | RÉUSSI |
| MNT-02 | Autorisation par un tiers | zh | ZH autorise | OK (AUTORISEE) | OK : {"id": "9698aa39-dbce-4d0b-9850-0d422b983f11", "statut": "AUTORISEE"} | RÉUSSI |
| MNT-03 | Démarrage : garage obligatoire | zh | Démarrage sans garage | REFUS (Garage) | REFUS : Garage intervenant obligatoire. | RÉUSSI |
| MNT-04 | Démarrage → immobilisation | zh | ZH démarre au garage fictif | OK | OK : {"id": "9698aa39-dbce-4d0b-9850-0d422b983f11", "statut": "EN_COURS"} | RÉUSSI |
| MNT-05 | Statut EN_REPARATION | postgres (lecture) | EN_REPARATION | EN_REPARATION | EN_REPARATION | RÉUSSI |
| MNT-06 | Clôture payante sans facture refusée | zh | Fin sans facture | REFUS (Facture) | REFUS : Facture obligatoire pour clôturer une intervention payante. | RÉUSSI |
| MNT-07 | Documents administratifs | zh | ZH dépose la facture | OK | OK : {"id": "14123971-d5c6-484d-95a9-80063feeccd7", "statut": "EN_VERIFICATION"} | RÉUSSI |
| MNT-08 | Clôture avec facture | zh | Fin avec facture | OK (TERMINEE) | OK : {"id": "9698aa39-dbce-4d0b-9850-0d422b983f11", "statut": "TERMINEE", "remise_en_servi | RÉUSSI |
| MNT-09 | Immobilisation accident toujours ouverte | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| MNT-10 | Aucune périodicité constructeur inventée | bm | Règle déclarée constructeur sans référence | REFUS (check) | REFUS : new row for relation "moto_regles_maintenance" violates check constraint "moto_reg | RÉUSSI |
| MNT-11 | Règle paramétrée ANAGROCI | bm | BM paramètre vidange 1 000 km (paramètre de test) | OK | OK : {"code": "VIDANGE"} | RÉUSSI |
| MNT-12 | Échéance calculée | postgres (lecture) | A_JOUR, prochaine à 1208 km | A_JOUR,1208.0 | A_JOUR,1208.0 | RÉUSSI |
| MNT-13 | Règles inactives par défaut | postgres (lecture) | 2 règles inactives sans intervalle | 2 | 2 | RÉUSSI |
| PNE-01 | Pneu : identité propre | abm | Entrée en stock d'un pneu fictif | OK | OK : {"id": "553b9525-38a9-4acf-9a74-cf63769dc08e"} | RÉUSSI |
| PNE-02 | Montage | abm | Montage arrière à 208 km | OK | OK : {"id": "227df1f8-f2f8-476f-b9cd-ac79e6b720ea"} | RÉUSSI |
| PNE-03a | Pneu : identité propre | abm | Entrée en stock d'un second pneu fictif | OK | OK : {"id": "90e16abc-9eb9-44c4-bb53-91274677fafd"} | RÉUSSI |
| PNE-03 | Un pneu par position | abm | Second pneu à la même position | REFUS (déjà monté) | REFUS : Un pneu est déjà monté à cette position : déposez-le d'abord. | RÉUSSI |
| PNE-04 | Réparation tracée | zh | Réparation crevaison | OK | OK : {"id": "6acf7210-4914-49ab-a146-dd71db3bb128"} | RÉUSSI |
| PNE-05 | Dépose et réforme | abm | Dépose à 708 km, réforme | OK (500) | OK : {"id": "227df1f8-f2f8-476f-b9cd-ac79e6b720ea", "km_parcourus": 500.0} | RÉUSSI |
| PNE-06 | Coût par km sur données réelles | postgres (lecture) | (12000+1000)/500 = 26.00 FCFA/km | 26.00 | 26.00 | RÉUSSI |
| KPI-01 | Disponibilité : dénominateur présent | postgres (lecture) | taux calculé (non NULL) | true | true | RÉUSSI |
| KPI-02 | Disponibilité : moto non en service → absente (Non disponible) | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| KPI-03 | Coût/km : dotations et remboursements exclus | postgres (lecture) | carburant vérifié 7650 + maintenance 5000 + pneus 13000 + incident 8000 | 7650+5000+13000+8000 | 7650+5000+13000+8000 | RÉUSSI |
| FOR-01 | Formation : résultat | uh_sak | UH réussit un quiz 4/5 | OK (true) | OK : {"id": "1e7522f5-30ca-41cd-8d0e-4ab1ba070fbf", "reussi": true} | RÉUSSI |
| FOR-02 | Formation : score invalide | uh_sak | Score 6/5 | REFUS (invalide) | REFUS : Résultat de quiz invalide. | RÉUSSI |
| REG-01 | Contrainte de rôles FBMS inchangée | postgres (lecture) | 20 rôles | 20 | 20 | RÉUSSI |
| REG-02 | Fonctions FBMS existantes intactes (md5 réplique) | postgres (lecture) | aucune fonction FBMS existante redéfinie | 0 | 0 | RÉUSSI |
| REG-03 | Toutes les tables moto_* sous RLS | postgres (lecture) | 0 table sans RLS | 0 | 0 | RÉUSSI |
| REG-04 | Aucune fonction moto exécutable par anon | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| REG-05 | Aucune table moto écrivable par authenticated | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| REG-06 | Fonctions SECURITY DEFINER avec search_path figé | postgres (lecture) | 0 sans search_path | 0 | 0 | RÉUSSI |
| REG-07 | Fonctions internes d'écriture non appelables directement | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| REG-08 | Contournement : appel direct d'une fonction interne | uh_sak | UH ouvre/ferme une immobilisation en direct | REFUS (permission) | REFUS : permission denied for function moto_ouvrir_immobilisation | RÉUSSI |
| REG-09 | Contournement : lever une immobilisation sans contrôle | zh | ZH lève l'immobilisation accident par la voie générique | REFUS (circuit) | REFUS : Cette immobilisation se lève par le circuit de l'incident ou de la maintenance. | RÉUSSI |
| BEN-01 | Liste des bénéficiaires : ABM | abm | ABM liste les bénéficiaires éligibles (Unit/Zonal Head actifs) | OK (5) | OK : 5 | RÉUSSI |
| BEN-02 | Liste des bénéficiaires : refusée au Chef d'unité | uh_sak | UH liste les bénéficiaires | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |

TOTAL : 186/186 réussis

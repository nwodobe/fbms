Replique fbms_moto_test construite : 49 fonctions identiques a la production (md5).
Passe 1 : migrations appliquées.
Passe 2 : migrations appliquées.
| id | exigence | compte | action | attendu | obtenu | résultat |
|---|---|---|---|---|---|---|
| SEC-01 | Accès refusé aux rôles hors périmètre | sup | Supervisor crée une moto | REFUS (rôle) | REFUS : Accès Moto Manager refusé : compte inactif ou rôle non habilité. | RÉUSSI |
| SEC-02 | Accès refusé anonyme | anon | Anonyme lit la flotte | REFUS (permission) | REFUS : permission denied for table moto_motos | RÉUSSI |
| SEC-03 | Pas de création par Chef d'unité | uh_sak | Chef d'unité crée une moto | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| SEC-04 | Écriture directe interdite (RLS + privilèges) | bm | BM insère directement dans moto_motos | REFUS (permission) | REFUS : permission denied for table moto_motos | RÉUSSI |
| INV-01 | Passeport : création sans châssis inventé | abm | ABM crée moto 1 (SAKASSOU) | OK | OK : {"id": "add96188-93bd-43c0-9310-fcec14e29b93", "code": "MOTO-001", "qr_token": "6abbd | RÉUSSI |
| INV-02 | Passeport : création sans châssis inventé | abm | ABM crée moto 2 (BOTRO) | OK | OK : {"id": "c8101715-ede8-4974-9800-e58cee3cb9a3", "code": "MOTO-002", "qr_token": "12e50 | RÉUSSI |
| INV-03 | Passeport : création sans châssis inventé | abm | ABM crée moto 3 (BROBO) | OK | OK : {"id": "3aca24b9-faa3-4d6a-9440-835e46b8598e", "code": "MOTO-003", "qr_token": "f66a7 | RÉUSSI |
| INV-04 | Passeport : création sans châssis inventé | abm | ABM crée moto 4 (N'Djébonoua) | OK | OK : {"id": "c28be9c6-efa6-4740-892f-d1fce255dce6", "code": "MOTO-004", "qr_token": "352f0 | RÉUSSI |
| INV-05 | Identifiant et QR uniques | postgres (lecture) | 4 codes et 4 jetons QR distincts | 4/4 | 4/4 | RÉUSSI |
| INV-06 | Châssis non inventé | postgres (lecture) | Châssis et immatriculation vides à la création | 4 | 4 | RÉUSSI |
| INV-07 | Statuts initiaux indépendants | postgres (lecture) | EN_ATTENTE / NON_AFFECTEE / A_CONTROLER | EN_ATTENTE/NON_AFFECTEE/A_CONTROLER | EN_ATTENTE/NON_AFFECTEE/A_CONTROLER | RÉUSSI |
| INV-08 | Unicité châssis | abm | Deux motos avec le même châssis fictif | REFUS (duplicate) | REFUS : duplicate key value violates unique constraint "moto_motos_chassis_uq" | RÉUSSI |
| INV-09 | Saisie identité M1 | abm | Châssis et immatriculation fictifs M1 | OK | OK : {"id": "add96188-93bd-43c0-9310-fcec14e29b93", "row_version": 2} | RÉUSSI |
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
| DOC-03 | Documents administratifs | abm | Carte grise M1 | OK | OK : {"id": "3c935712-f12f-4e66-be08-64b7072e2c20", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-04 | Documents administratifs | abm | Plaque M1 | OK | OK : {"id": "7ad23429-9f43-46e8-9447-1a9765074ba4", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-05 | Documents administratifs | abm | Assurance M1 | OK | OK : {"id": "08d8f99c-b16f-4ac5-864e-c060479835a6", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-06 | Statut administratif EN_VERIFICATION | postgres (lecture) | Documents déposés non vérifiés | EN_VERIFICATION | EN_VERIFICATION | RÉUSSI |
| DOC-07 | Auto-vérification interdite | abm | ABM vérifie son propre dépôt | REFUS (Auto-validation) | REFUS : Auto-validation interdite : un autre responsable doit vérifier ce document. | RÉUSSI |
| DOC-08 | Non conforme exige un motif | bm | BM refuse sans motif | REFUS (Motif) | REFUS : Motif obligatoire (5 caractères minimum). | RÉUSSI |
| DOC-09cg1 | Vérification par un tiers | bm | BM vérifie carte grise M1 | OK | OK : {"id": "3c935712-f12f-4e66-be08-64b7072e2c20", "statut": "CONFORME"} | RÉUSSI |
| DOC-09pl1 | Vérification par un tiers | bm | BM vérifie plaque M1 | OK | OK : {"id": "7ad23429-9f43-46e8-9447-1a9765074ba4", "statut": "CONFORME"} | RÉUSSI |
| DOC-09as1 | Vérification par un tiers | bm | BM vérifie assurance M1 | OK | OK : {"id": "08d8f99c-b16f-4ac5-864e-c060479835a6", "statut": "CONFORME"} | RÉUSSI |
| DOC-10 | Conformité administrative | postgres (lecture) | CONFORME après 3 documents vérifiés | CONFORME | CONFORME | RÉUSSI |
| DOC-11 | Documents administratifs | abm | Assurance expirée M2 | OK | OK : {"id": "e02b329d-da2c-4f4f-861f-51650beea7d2", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-12 | Document expiré non conforme | bm | BM déclare conforme une assurance expirée | REFUS (expiré) | REFUS : Document expiré : il ne peut pas être déclaré conforme. | RÉUSSI |
| DOC-14 | Moto réceptionnée sans documents : non autorisée à circuler | postgres (lecture) | autorisee_a_circuler = false | f | f | RÉUSSI |
| INS-01 | Inspection : mécanicien obligatoire | abm | Inspection sans nom de mécanicien | REFUS (mécanicien) | REFUS : Nom du mécanicien et du garage obligatoires. | RÉUSSI |
| INS-02 | Anomalie critique calculée par le serveur | abm | Inspection M2 avec freins KO déclarée APTE par le client | OK | OK : {"id": "6287fffb-aada-4555-8e6d-6114662c5be4", "resultat": "INAPTE", "anomalie_critiq | RÉUSSI |
| INS-03 | Anomalie critique bloque la mise en service | postgres (lecture) | M2 IMMOBILISEE, résultat INAPTE | IMMOBILISEE/INAPTE | IMMOBILISEE/INAPTE | RÉUSSI |
| INS-04 | Inspection initiale APTE | abm | Inspection M1 APTE | OK | OK : {"id": "8b2be05b-adbd-4025-a576-f1321711230d", "resultat": "APTE", "anomalie_critique | RÉUSSI |
| INS-05 | Statut technique APTE | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| AFF-01 | Préaffectation réservée au Branch Manager | abm | ABM préaffecte | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| AFF-02 | Bénéficiaire doit être Chef d'unité/zone | bm | Préaffectation à un Supervisor | REFUS (Chef) | REFUS : Le bénéficiaire doit être un Chef d'unité ou un Chef de zone. | RÉUSSI |
| AFF-03 | Bénéficiaire inactif refusé | bm | Préaffectation à un compte inactif | REFUS (inactif) | REFUS : Bénéficiaire introuvable ou compte inactif. | RÉUSSI |
| AFF-04 | Préaffectation | bm | BM préaffecte M1 à UH Sakassou | OK | OK : {"id": "284165a5-b810-4564-a0b1-fe6abeb1047e", "statut_affectation": "PREAFFECTEE"} | RÉUSSI |
| AFF-05 | Une seule affectation active | bm | Seconde préaffectation de M1 | REFUS (transfert) | REFUS : Cette moto a déjà une affectation active : utilisez le transfert. | RÉUSSI |
| AFF-06 | Préaffectation M4 cluster normalisé | bm | BM préaffecte M4 à UH N'Djébonoua | OK | OK : {"id": "4892494b-ce4e-4ae8-8743-dce46094ab83", "statut_affectation": "PREAFFECTEE"} | RÉUSSI |
| AFF-07 | Cluster N'Djébonoua normalisé | postgres (lecture) | DJEBONOUA | DJEBONOUA | DJEBONOUA | RÉUSSI |
| REM-01 | PV papier numérisé et vérifié obligatoire | abm | Remise sans PV | REFUS (Procès-verbal) | REFUS : Procès-verbal signé, numérisé et vérifié CONFORME obligatoire. | RÉUSSI |
| REM-02 | Documents administratifs | abm | Dépôt du PV signé numérisé M1 | OK | OK : {"id": "98c97883-7e5b-4095-9560-b09fb07bf1ea", "statut": "EN_VERIFICATION"} | RÉUSSI |
| REM-03 | PV non vérifié refusé | abm | Remise avec PV non vérifié | REFUS (Procès-verbal) | REFUS : Procès-verbal signé, numérisé et vérifié CONFORME obligatoire. | RÉUSSI |
| REM-04 | Vérification PV par un tiers | bm | BM vérifie le PV | OK | OK : {"id": "98c97883-7e5b-4095-9560-b09fb07bf1ea", "statut": "CONFORME"} | RÉUSSI |
| REM-05 | Permis vérifié RH obligatoire | abm | Remise sans vérification du permis | REFUS (permis) | REFUS : Vérification RH du permis adapté obligatoire (catégorie et vérificateur). | RÉUSSI |
| REM-06 | Équipements de sécurité obligatoires | abm | Remise sans gilet | REFUS (GILET) | REFUS : Équipement de sécurité manquant : GILET_HAUTE_VISIBILITE. | RÉUSSI |
| REM-07 | Documents conformes obligatoires | abm | Remise de M4 (aucun document) | REFUS (non conformes) | REFUS : Remise bloquée : documents administratifs non conformes (EN_ATTENTE). | RÉUSSI |
| REM-08 | Remise complète | abm | ABM enregistre la remise de M1 | OK (REMISE) | OK : {"id": "c421aa41-c297-4e22-ab48-3825ab44e535", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| REM-09 | Statut affectation REMISE, pas encore en service | postgres (lecture) | REMISE/false | REMISE/false | REMISE/false | RÉUSSI |
| MES-01 | Chef d'unité : pas de saisie avant mise en service | uh_sak | Relevé km avant mise en service | REFUS (non mise en service) | REFUS : Moto non mise en service : saisie terrain impossible. | RÉUSSI |
| MES-02 | Mise en service réservée au BM | abm | ABM met en service | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| MES-03 | Mise en service (décision distincte de la remise) | bm | BM autorise la circulation de M1 | OK | OK : {"id": "add96188-93bd-43c0-9310-fcec14e29b93", "mise_en_service": true} | RÉUSSI |
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
| KM-01 | Relevé kilométrique | uh_sak | Relevé 40 km | OK | OK : {"moto_id": "add96188-93bd-43c0-9310-fcec14e29b93", "compteur_km": 40} | RÉUSSI |
| KM-02 | Idempotence : rejeu du même relevé | uh_sak | Rejeu client_op_id identique | OK (doublon) | OK : {"statut": "SYNCHRONISE", "doublon": true, "moto_id": "add96188-93bd-43c0-9310-fcec14 | RÉUSSI |
| KM-03 | Pas de doublon en base | postgres (lecture) | 1 | 1 | 1 | RÉUSSI |
| KM-04 | Compteur décroissant refusé (conflit) | uh_sak | Relevé 30 km après 40 km | REFUS (CONFLIT_COMPTEUR) | REFUS : CONFLIT_COMPTEUR : 30 km est inférieur au relevé antérieur (40.0 km). Demandez une | RÉUSSI |
| KM-05 | Identifiant d'opération d'un autre compte | zh | ZH réutilise le client_op_id de l'UH | REFUS (autre compte) | REFUS : Identifiant d'opération déjà utilisé par un autre compte. | RÉUSSI |
| KM-06 | Chef d'unité : pas de saisie sur une moto non affectée | uh_bro | UH Brobo relève M1 | REFUS (périmètre) | REFUS : Moto hors de votre périmètre ou non affectée à votre compte. | RÉUSSI |
| CTL-01 | Contrôle avant départ APTE | uh_sak | Contrôle OK | OK (APTE) | OK : {"id": "6dbc4d95-db82-4fb6-9d58-8d7058de3989", "incident": null, "resultat": "APTE",  | RÉUSSI |
| CTL-02 | Contrôle : points invalides refusés | uh_sak | Contrôle sans points | REFUS (vide) | REFUS : Liste de points de contrôle vide ou invalide. | RÉUSSI |
| SYN-01 | Synchronisation par lot | uh_sak | Lot : 1 valide, 1 conflit, 1 id invalide, 1 type interdit | OK | OK : [{"statut": "SYNCHRONISE", "resultat": {"moto_id": "add96188-93bd-43c0-9310-fcec14e29 | RÉUSSI |
| SYN-02 | Statuts « Synchronisé » / « Rejeté » | uh_sak | Statuts renvoyés par opération | SYNCHRONISE,REJETE,REJETE,REJETE | SYNCHRONISE,REJETE,REJETE,REJETE | RÉUSSI |
| SYN-03 | Rejeu du lot sans doublon | uh_sak | Même lot renvoyé | OK | OK : [{"statut": "SYNCHRONISE", "doublon": true, "message": null, "resultat": {"statut": " | RÉUSSI |
| SYN-04 | Idempotence du lot | uh_sak | Le rejeu renvoie les mêmes statuts marqués doublon | [SYNCHRONISE doublon, REJETE doublon] | [('SYNCHRONISE', True), ('REJETE', True)] | RÉUSSI |
| SYN-05 | Un seul relevé 55 km en base | postgres (lecture) | 1 | 1 | 1 | RÉUSSI |
| SYN-06 | Lot limité | uh_sak | Lot de 51 opérations | REFUS (50) | REFUS : Lot limité à 50 opérations. | RÉUSSI |
| BUD-01 | Budget : Chef d'unité interdit | uh_sak | UH propose un budget | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| BUD-02 | Budget proposé par l'ABM | abm | ABM propose 30 000 FCFA (fictif) | OK (PROPOSE) | OK : {"id": "86f6cbae-cf5d-412e-9278-7ab3c724ae8f", "statut": "PROPOSE"} | RÉUSSI |
| BUD-03 | Dotation impossible sans budget autorisé | abm | Remise sur budget proposé | REFUS (budget autorisé) | REFUS : Dotation impossible : aucun budget autorisé. | RÉUSSI |
| BUD-04 | Validation du budget par le BM | bm | BM valide le budget | OK (VALIDE) | OK : {"id": "86f6cbae-cf5d-412e-9278-7ab3c724ae8f", "statut": "VALIDE"} | RÉUSSI |
| DOT-01 | Dotation espèces | abm | ABM remet 10 000 FCFA en espèces | OK (REMISE_DECLAREE) | OK : {"id": "639d7b29-580a-4e1b-b20b-2d133c9f4e1a", "note": "En attente de confirmation de | RÉUSSI |
| DOT-02 | Mobile Money : référence obligatoire | abm | Mobile Money sans référence | REFUS (Référence) | REFUS : Référence de transaction Mobile Money obligatoire. | RÉUSSI |
| DOT-03 | Mobile Money : frais distincts | abm | Mobile Money 10 000 + 100 de frais | OK | OK : {"id": "5521782e-497b-4f0f-9018-18cea823b9cd", "note": "En attente de confirmation de | RÉUSSI |
| DOT-04 | Mobile Money échoué | abm | Mobile Money 5 000 | OK | OK : {"id": "6431849c-da14-4415-a5c6-90d2fa5b139f", "note": "En attente de confirmation de | RÉUSSI |
| DOT-05 | Dépassement de budget refusé | abm | Remise de 10 000 au-delà de 30 000 | REFUS (Dépassement) | REFUS : Dépassement du budget autorisé : 25000 déjà remis sur 30000 FCFA. | RÉUSSI |
| DOT-06 | Transaction échouée | abm | ABM déclare l'échec MM-TEST-0002 | OK (ECHOUEE) | OK : {"id": "6431849c-da14-4415-a5c6-90d2fa5b139f", "statut": "ECHOUEE"} | RÉUSSI |
| DOT-07 | Seul le bénéficiaire confirme | abm | ABM confirme à la place de l'UH | REFUS (bénéficiaire) | REFUS : Seul le bénéficiaire confirme la réception de sa dotation. | RÉUSSI |
| DOT-08 | Échec non confirmable | uh_sak | UH confirme la transaction échouée | REFUS (ECHOUEE) | REFUS : Cette dotation n'est plus en attente de confirmation (ECHOUEE). | RÉUSSI |
| DOT-09 | Confirmation de réception | uh_sak | UH confirme 10 000 espèces | OK (CONFIRMEE) | OK : {"id": "639d7b29-580a-4e1b-b20b-2d133c9f4e1a", "statut": "CONFIRMEE", "montant_recu": | RÉUSSI |
| DOT-10 | Écart de réception = contestation | uh_sak | UH déclare 9 900 reçus sur 10 000 MM | OK (CONTESTEE) | OK : {"id": "5521782e-497b-4f0f-9018-18cea823b9cd", "statut": "CONTESTEE", "montant_recu": | RÉUSSI |
| CAR-01 | Plein/partiel obligatoire | uh_sak | Achat sans préciser plein | REFUS (plein) | REFUS : Préciser plein complet ou partiel. | RÉUSSI |
| CAR-02 | Carburant | uh_sak | Plein initial complet (référence) | OK | OK : {"id": "acccbb09-1fe4-40ec-a3dd-7d34ac23c333", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-03 | Carburant | uh_sak | Plein partiel | OK | OK : {"id": "8cc8c1ff-a4f0-4fa8-b8b1-f873230ddb20", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-04 | Carburant | uh_sak | Plein complet de contrôle | OK | OK : {"id": "c43af086-4d2d-42c0-ae77-e23a60ac0c60", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-05 | Consommation plein à plein vérifiable | postgres (lecture) | 100×(1,5+2,0)/(160−60) = 3,50 L/100 km | 3.50 | 3.50 | RÉUSSI |
| CAR-06 | Plein initial non compté deux fois | postgres (lecture) | Litres de l'intervalle = 3,50 (plein initial de 3 L exclu) | 3.50 | 3.50 | RÉUSSI |
| CAR-07 | Seuils provisoires : 3,50 < 3,6 → NORMAL | postgres (lecture) | NORMAL | NORMAL | NORMAL | RÉUSSI |
| CAR-08 | Données insuffisantes → Non disponible | postgres (lecture) | M3 : l_100km NULL | NULL | NULL | RÉUSSI |
| CAR-09 | Carburant | uh_sak | Achat daté après un relevé supérieur | REFUS (CONFLIT_COMPTEUR) | REFUS : CONFLIT_COMPTEUR : 150 km est inférieur au relevé antérieur (160.0 km). Demandez u | RÉUSSI |
| CAR-10 | Carburant | uh_sak | Avance personnelle de l'agent | OK | OK : {"id": "9c4d7e80-e26f-4dfa-b69f-7f9d99158703", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| JUS-01 | Auto-vérification interdite | uh_sak | UH vérifie son justificatif | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| JUS-02 | Vérification des justificatifs | fin | Finance vérifie l'achat 1 | OK (VERIFIE) | OK : {"id": "acccbb09-1fe4-40ec-a3dd-7d34ac23c333", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-03 | Vérification des justificatifs | fin | Finance vérifie l'achat 2 | OK (VERIFIE) | OK : {"id": "8cc8c1ff-a4f0-4fa8-b8b1-f873230ddb20", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-04 | Vérification des justificatifs | fin | Finance vérifie l'achat 3 | OK (VERIFIE) | OK : {"id": "c43af086-4d2d-42c0-ae77-e23a60ac0c60", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-06 | Vérification des justificatifs | fin | Finance vérifie l'achat 5 | OK (VERIFIE) | OK : {"id": "9c4d7e80-e26f-4dfa-b69f-7f9d99158703", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| RAP-01 | Rapprochement : remis / reçu / justifié / à apurer | postgres (lecture) | remis 20000 · reçu 19900 (10000 + 9900 en écart) · frais 100 · écart 100 · justifié 5525 · à apurer 14375 | 20000·19900·100·100·5525·14375 | 20000·19900·100·100·5525·14375 | RÉUSSI |
| RES-01 | Restitution > avance refusée | abm | Restitution de 20 000 | REFUS (supérieure) | REFUS : Restitution supérieure à l'avance à apurer (14375 FCFA). | RÉUSSI |
| RES-02 | Restitution d'espèces restantes | abm | Restitution de 475 | OK (13900) | OK : {"id": "58aaf0c6-2b4a-4509-ae05-b79e7a2686ed", "solde_restant": 13900} | RÉUSSI |
| RBT-01 | Remboursement d'avance personnelle | abm | ABM demande le remboursement de l'avance | OK (2125) | OK : {"id": "5a16b1d2-e8cd-4c25-a9e4-2dd44ff1f432", "statut": "DEMANDE", "montant": 2125} | RÉUSSI |
| RBT-02 | Pas de double remboursement | abm | Deuxième demande sur le même achat | REFUS (non encore remboursée) | REFUS : Chaque achat doit être une avance personnelle de ce bénéficiaire, justifiée VÉRIFI | RÉUSSI |
| RBT-03 | Finance simple : pas de validation | fin | Finance valide le remboursement | REFUS (Finance Manager) | REFUS : Validation réservée au Branch Manager ou au Finance Manager. | RÉUSSI |
| RBT-04 | Validation par le Finance Manager | fm | Finance Manager valide | OK (VALIDE) | OK : {"id": "5a16b1d2-e8cd-4c25-a9e4-2dd44ff1f432", "statut": "VALIDE"} | RÉUSSI |
| RBT-05 | Paiement déclaré (non exécuté) | fin | Finance déclare le paiement MM | OK (PAYE_DECLARE) | OK : {"id": "5a16b1d2-e8cd-4c25-a9e4-2dd44ff1f432", "statut": "PAYE_DECLARE"} | RÉUSSI |
| RAP-02 | Pas de double comptage dotation/remboursement | postgres (lecture) | reste à rembourser 0 · remboursé 2125 · à apurer 13900 | 0·2125·13900 | 0·2125·13900 | RÉUSSI |
| COR-01 | Correction : demande ABM | abm | ABM demande la correction des frais MM | OK (DEMANDEE) | OK : {"id": "0a9d17a2-ceb1-4443-9e53-ba42aa698c36", "statut": "DEMANDEE"} | RÉUSSI |
| COR-02 | Champ non corrigeable | zh | ZH corrige un montant de dotation | REFUS (non corrigeable) | REFUS : Champ non corrigeable par votre rôle. | RÉUSSI |
| COR-03 | ABM ne valide pas une correction | abm | ABM valide sa propre correction | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| COR-04 | Validation BM | bm | BM applique la correction | OK (APPLIQUEE) | OK : {"id": "0a9d17a2-ceb1-4443-9e53-ba42aa698c36", "statut": "APPLIQUEE"} | RÉUSSI |
| COR-05 | Valeur corrigée et journal avec valideur | postgres (lecture) | 150 / valideur BM | 150/1 | 150/1 | RÉUSSI |
| COR-06 | BM initie une correction | bm | BM demande correction compteur relevé | OK | OK : {"id": "c150e1ca-bb1b-4fe1-9bac-1d934ec5f94c", "statut": "DEMANDEE"} | RÉUSSI |
| COR-07 | BM ne s'auto-approuve pas | bm | BM valide sa propre demande | REFUS (Auto-approbation) | REFUS : Auto-approbation interdite : un autre responsable doit valider. | RÉUSSI |
| COR-08 | Validation par la Direction | gm | General Manager rejette | OK (REJETEE) | OK : {"id": "c150e1ca-bb1b-4fe1-9bac-1d934ec5f94c", "statut": "REJETEE"} | RÉUSSI |
| INC-01 | Anomalie critique au départ → immobilisation | uh_sak | Contrôle avant départ freins KO | OK (INAPTE) | OK : {"id": "691138a4-b8c7-48a4-a8a1-d83bf242389c", "incident": {"id": "0ad6c82c-712d-4df8 | RÉUSSI |
| INC-02 | Moto immobilisée sans attendre | postgres (lecture) | IMMOBILISEE / non autorisée | IMMOBILISEE/false | IMMOBILISEE/false | RÉUSSI |
| INC-03 | Chef d'unité ne pilote pas le circuit | uh_sak | UH avance l'incident | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| INC-04 | Transition interdite | zh | Saut direct vers REMIS_EN_SERVICE | REFUS (Transition) | REFUS : Transition interdite : IMMOBILISEE → REMIS_EN_SERVICE. | RÉUSSI |
| INC-05 | Diagnostic | zh | ZH : diagnostic | OK | OK : {"id": "0ad6c82c-712d-4df8-ad8b-ff29720444b8", "etape": "DIAGNOSTIC"} | RÉUSSI |
| INC-06 | Autorisation de dépense : montant obligatoire | zh | Autorisation sans montant | REFUS (Montant) | REFUS : Montant estimé de la dépense obligatoire. | RÉUSSI |
| INC-07 | ABM ne peut pas autoriser la dépense | abm | ABM autorise la dépense | REFUS (réservée) | REFUS : Autorisation de dépense réservée au Branch Manager ou au Chef de Zone. | RÉUSSI |
| INC-08 | Autorisation de dépense | zh | ZH autorise 8 000 (fictif) | OK | OK : {"id": "0ad6c82c-712d-4df8-ad8b-ff29720444b8", "etape": "AUTORISATION_DEPENSE"} | RÉUSSI |
| INC-09 | Réparation | zh | ZH : réparation | OK | OK : {"id": "0ad6c82c-712d-4df8-ad8b-ff29720444b8", "etape": "REPARATION"} | RÉUSSI |
| INC-10 | Contrôle | zh | ZH : étape contrôle | OK | OK : {"id": "0ad6c82c-712d-4df8-ad8b-ff29720444b8", "etape": "CONTROLE"} | RÉUSSI |
| INC-11 | Remise en service exige un contrôle APTE | zh | Remise en service sans contrôle | REFUS (contrôle) | REFUS : Remise en service bloquée : contrôle de remise en service APTE obligatoire après l | RÉUSSI |
| INC-12 | Contrôle de remise en service | zh | ZH enregistre le contrôle APTE | OK (APTE) | OK : {"id": "3f40db3d-3fd3-409c-82ee-f1d5b15c2a34", "resultat": "APTE"} | RÉUSSI |
| INC-13 | Remise en service | zh | ZH remet en service | OK | OK : {"id": "0ad6c82c-712d-4df8-ad8b-ff29720444b8", "etape": "REMIS_EN_SERVICE"} | RÉUSSI |
| INC-14 | Clôture | zh | ZH clôt l'incident avec coût réel | OK | OK : {"id": "0ad6c82c-712d-4df8-ad8b-ff29720444b8", "etape": "CLOS"} | RÉUSSI |
| INC-15 | Moto de nouveau APTE | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| INC-16 | Historique complet du circuit | postgres (lecture) | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,C | RÉUSSI |
| INC-17 | Accident : registre AFLP lié (pas de doublon de saisie) | uh_sak | UH déclare un accident | OK (INC-) | OK : {"id": "d10ffc0f-850c-4572-969e-9dbdcb0905ba", "immobilisee": true, "aflp_incident_id | RÉUSSI |
| INC-18 | Incident AFLP créé et relié | postgres (lecture) | ACCIDENT_MOTO | ACCIDENT_MOTO | ACCIDENT_MOTO | RÉUSSI |
| INC-19 | Accident = immobilisation | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| INC-20 | Traçabilité : relevé km accepté pendant immobilisation | uh_sak | Relevé km pendant immobilisation | OK | OK : {"moto_id": "add96188-93bd-43c0-9310-fcec14e29b93", "compteur_km": 207} | RÉUSSI |
| MNT-01 | Demande d'entretien terrain | uh_sak | UH demande une vidange | OK (DEMANDEE) | OK : {"id": "938aaa66-fa3b-454f-89e0-ec121e88659c", "statut": "DEMANDEE"} | RÉUSSI |
| MNT-02 | Autorisation par un tiers | zh | ZH autorise | OK (AUTORISEE) | OK : {"id": "938aaa66-fa3b-454f-89e0-ec121e88659c", "statut": "AUTORISEE"} | RÉUSSI |
| MNT-03 | Démarrage : garage obligatoire | zh | Démarrage sans garage | REFUS (Garage) | REFUS : Garage intervenant obligatoire. | RÉUSSI |
| MNT-04 | Démarrage → immobilisation | zh | ZH démarre au garage fictif | OK | OK : {"id": "938aaa66-fa3b-454f-89e0-ec121e88659c", "statut": "EN_COURS"} | RÉUSSI |
| MNT-05 | Statut EN_REPARATION | postgres (lecture) | EN_REPARATION | EN_REPARATION | EN_REPARATION | RÉUSSI |
| MNT-06 | Clôture payante sans facture refusée | zh | Fin sans facture | REFUS (Facture) | REFUS : Facture obligatoire pour clôturer une intervention payante. | RÉUSSI |
| MNT-07 | Documents administratifs | zh | ZH dépose la facture | OK | OK : {"id": "ec7aa740-1384-4410-adfa-45a7fd32d56f", "statut": "EN_VERIFICATION"} | RÉUSSI |
| MNT-08 | Clôture avec facture | zh | Fin avec facture | OK (TERMINEE) | OK : {"id": "938aaa66-fa3b-454f-89e0-ec121e88659c", "statut": "TERMINEE", "remise_en_servi | RÉUSSI |
| MNT-09 | Immobilisation accident toujours ouverte | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| MNT-10 | Aucune périodicité constructeur inventée | bm | Règle déclarée constructeur sans référence | REFUS (check) | REFUS : new row for relation "moto_regles_maintenance" violates check constraint "moto_reg | RÉUSSI |
| MNT-11 | Règle paramétrée ANAGROCI | bm | BM paramètre vidange 1 000 km (paramètre de test) | OK | OK : {"code": "VIDANGE"} | RÉUSSI |
| MNT-12 | Échéance calculée | postgres (lecture) | A_JOUR, prochaine à 1208 km | A_JOUR,1208.0 | A_JOUR,1208.0 | RÉUSSI |
| MNT-13 | Règles inactives par défaut | postgres (lecture) | 2 règles inactives sans intervalle | 2 | 2 | RÉUSSI |
| PNE-01 | Pneu : identité propre | abm | Entrée en stock d'un pneu fictif | OK | OK : {"id": "3ecba36e-4a21-4bd7-a3db-d77dff429181"} | RÉUSSI |
| PNE-02 | Montage | abm | Montage arrière à 208 km | OK | OK : {"id": "ee071411-aab1-41d8-a8d3-585c053643e6"} | RÉUSSI |
| PNE-03a | Pneu : identité propre | abm | Entrée en stock d'un second pneu fictif | OK | OK : {"id": "32ccc9cd-805d-4b16-99ab-cc206d3a1ad7"} | RÉUSSI |
| PNE-03 | Un pneu par position | abm | Second pneu à la même position | REFUS (déjà monté) | REFUS : Un pneu est déjà monté à cette position : déposez-le d'abord. | RÉUSSI |
| PNE-04 | Réparation tracée | zh | Réparation crevaison | OK | OK : {"id": "949ff22b-2890-4a22-952b-08d8738434ac"} | RÉUSSI |
| PNE-05 | Dépose et réforme | abm | Dépose à 708 km, réforme | OK (500) | OK : {"id": "ee071411-aab1-41d8-a8d3-585c053643e6", "km_parcourus": 500.0} | RÉUSSI |
| PNE-06 | Coût par km sur données réelles | postgres (lecture) | (12000+1000)/500 = 26.00 FCFA/km | 26.00 | 26.00 | RÉUSSI |
| KPI-01 | Disponibilité : dénominateur présent | postgres (lecture) | taux calculé (non NULL) | true | true | RÉUSSI |
| KPI-02 | Disponibilité : moto non en service → absente (Non disponible) | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| KPI-03 | Coût/km : dotations et remboursements exclus | postgres (lecture) | carburant vérifié 7650 + maintenance 5000 + pneus 13000 + incident 8000 | 7650+5000+13000+8000 | 7650+5000+13000+8000 | RÉUSSI |
| FOR-01 | Formation : résultat | uh_sak | UH réussit un quiz 4/5 | OK (true) | OK : {"id": "23659c03-3ca5-454b-9c1f-169c230fac3a", "reussi": true} | RÉUSSI |
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

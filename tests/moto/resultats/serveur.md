Replique fbms_moto_test construite : 49 fonctions identiques a la production (md5).
Migrations 1 à 4 appliquées (état de la production au 31/10/2026).
Passe 1 : migration 5 AFLP FLEET appliquée.
Passe 2 : migration 5 AFLP FLEET appliquée.
| id | exigence | compte | action | attendu | obtenu | résultat |
|---|---|---|---|---|---|---|
| SEC-01 | Accès refusé aux rôles hors périmètre | sup | Supervisor crée une moto | REFUS (rôle) | REFUS : Accès Moto Manager refusé : compte inactif ou rôle non habilité. | RÉUSSI |
| SEC-02 | Accès refusé anonyme | anon | Anonyme lit la flotte | REFUS (permission) | REFUS : permission denied for table moto_motos | RÉUSSI |
| SEC-03 | Pas de création par Chef d'unité | uh_sak | Chef d'unité crée une moto | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| SEC-04 | Écriture directe interdite (RLS + privilèges) | bm | BM insère directement dans moto_motos | REFUS (permission) | REFUS : permission denied for table moto_motos | RÉUSSI |
| INV-01 | Passeport : création sans châssis inventé | abm | ABM crée moto 1 (SAKASSOU) | OK | OK : {"id": "3e8e5e5f-0dc2-4943-92a9-ac7bdca8e60f", "code": "MOTO-001", "origine": "NEUVE" | RÉUSSI |
| INV-02 | Passeport : création sans châssis inventé | abm | ABM crée moto 2 (BOTRO) | OK | OK : {"id": "d2209d40-de69-4e8b-9257-ddc6eca7807b", "code": "MOTO-002", "origine": "NEUVE" | RÉUSSI |
| INV-03 | Passeport : création sans châssis inventé | abm | ABM crée moto 3 (BROBO) | OK | OK : {"id": "09cb9485-37f1-425c-a3b8-16c6e50636b4", "code": "MOTO-003", "origine": "NEUVE" | RÉUSSI |
| INV-04 | Passeport : création sans châssis inventé | abm | ABM crée moto 4 (N'Djébonoua) | OK | OK : {"id": "a6146165-138d-4add-9c08-93a75311bef3", "code": "MOTO-004", "origine": "NEUVE" | RÉUSSI |
| INV-05 | Identifiant et QR uniques | postgres (lecture) | 4 codes et 4 jetons QR distincts | 4/4 | 4/4 | RÉUSSI |
| INV-06 | Châssis non inventé | postgres (lecture) | Châssis et immatriculation vides à la création | 4 | 4 | RÉUSSI |
| INV-07 | Statuts initiaux indépendants | postgres (lecture) | EN_ATTENTE / NON_AFFECTEE / A_CONTROLER | EN_ATTENTE/NON_AFFECTEE/A_CONTROLER | EN_ATTENTE/NON_AFFECTEE/A_CONTROLER | RÉUSSI |
| INV-08 | Unicité châssis | abm | Deux motos avec le même châssis fictif | REFUS (duplicate) | REFUS : duplicate key value violates unique constraint "moto_motos_chassis_uq" | RÉUSSI |
| INV-09 | Saisie identité M1 | abm | Châssis et immatriculation fictifs M1 | OK | OK : {"id": "3e8e5e5f-0dc2-4943-92a9-ac7bdca8e60f", "row_version": 2} | RÉUSSI |
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
| DOC-03 | Documents administratifs | abm | Carte grise M1 | OK | OK : {"id": "bd4981cd-8d34-4389-bd13-01ffda6d93dd", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-04 | Documents administratifs | abm | Plaque M1 | OK | OK : {"id": "ab68522a-af4f-448f-8e4d-784d524855eb", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-05 | Documents administratifs | abm | Assurance M1 | OK | OK : {"id": "edd6fa78-7ad1-4511-9f8d-c5a0c1c488ad", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-06 | Statut administratif EN_VERIFICATION | postgres (lecture) | Documents déposés non vérifiés | EN_VERIFICATION | EN_VERIFICATION | RÉUSSI |
| DOC-07 | Auto-vérification interdite | abm | ABM vérifie son propre dépôt | REFUS (Auto-validation) | REFUS : Auto-validation interdite : un autre responsable doit vérifier ce document. | RÉUSSI |
| DOC-08 | Non conforme exige un motif | bm | BM refuse sans motif | REFUS (Motif) | REFUS : Motif obligatoire (5 caractères minimum). | RÉUSSI |
| DOC-09cg1 | Vérification par un tiers | bm | BM vérifie carte grise M1 | OK | OK : {"id": "bd4981cd-8d34-4389-bd13-01ffda6d93dd", "statut": "CONFORME"} | RÉUSSI |
| DOC-09pl1 | Vérification par un tiers | bm | BM vérifie plaque M1 | OK | OK : {"id": "ab68522a-af4f-448f-8e4d-784d524855eb", "statut": "CONFORME"} | RÉUSSI |
| DOC-09as1 | Vérification par un tiers | bm | BM vérifie assurance M1 | OK | OK : {"id": "edd6fa78-7ad1-4511-9f8d-c5a0c1c488ad", "statut": "CONFORME"} | RÉUSSI |
| DOC-10 | Conformité administrative | postgres (lecture) | CONFORME après 3 documents vérifiés | CONFORME | CONFORME | RÉUSSI |
| DOC-11 | Documents administratifs | abm | Assurance expirée M2 | OK | OK : {"id": "3924a7ec-0c2e-4bcd-93a6-809a84258115", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-12 | Document expiré non conforme | bm | BM déclare conforme une assurance expirée | REFUS (expiré) | REFUS : Document expiré : il ne peut pas être déclaré conforme. | RÉUSSI |
| DOC-14 | Moto réceptionnée sans documents : non autorisée à circuler | postgres (lecture) | autorisee_a_circuler = false | f | f | RÉUSSI |
| INS-01 | Inspection : mécanicien obligatoire | abm | Inspection sans nom de mécanicien | REFUS (mécanicien) | REFUS : Nom du mécanicien et du garage obligatoires. | RÉUSSI |
| INS-02 | Anomalie critique calculée par le serveur | abm | Inspection M2 avec freins KO déclarée APTE par le client | OK | OK : {"id": "86019c5f-4131-43ce-82ef-3cb79a2a5d5f", "resultat": "INAPTE", "etat_reference" | RÉUSSI |
| INS-03 | Anomalie critique bloque la mise en service | postgres (lecture) | M2 IMMOBILISEE, résultat INAPTE | IMMOBILISEE/INAPTE | IMMOBILISEE/INAPTE | RÉUSSI |
| INS-04 | Inspection initiale APTE | abm | Inspection M1 APTE | OK | OK : {"id": "7011aa8d-ba3c-4081-89a5-6e8d2ec942b1", "resultat": "APTE", "etat_reference":  | RÉUSSI |
| INS-05 | Statut technique APTE | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| AFF-01 | Préaffectation réservée au Branch Manager | abm | ABM préaffecte | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| AFF-02 | Bénéficiaire doit être Chef d'unité/zone | bm | Préaffectation à un Supervisor | REFUS (Chef) | REFUS : Le bénéficiaire doit être un Chef d'unité, un Chef de zone, l'Assistant Branch Man | RÉUSSI |
| AFF-03 | Bénéficiaire inactif refusé | bm | Préaffectation à un compte inactif | REFUS (inactif) | REFUS : Bénéficiaire introuvable ou compte inactif. | RÉUSSI |
| AFF-04 | Préaffectation | bm | BM préaffecte M1 à UH Sakassou | OK | OK : {"id": "c45c3a94-b540-43d8-b9ec-81adaca5268c", "statut_affectation": "PREAFFECTEE"} | RÉUSSI |
| AFF-05 | Une seule affectation active | bm | Seconde préaffectation de M1 | REFUS (transfert) | REFUS : Cette moto a déjà une affectation active : utilisez le transfert. | RÉUSSI |
| AFF-06 | Préaffectation M4 cluster normalisé | bm | BM préaffecte M4 à UH N'Djébonoua | OK | OK : {"id": "461b2561-4328-4e46-8e31-fbc3c19937f4", "statut_affectation": "PREAFFECTEE"} | RÉUSSI |
| AFF-07 | Cluster N'Djébonoua normalisé | postgres (lecture) | DJEBONOUA | DJEBONOUA | DJEBONOUA | RÉUSSI |
| REM-01 | PV papier numérisé et vérifié obligatoire | abm | Remise sans PV | REFUS (Procès-verbal) | REFUS : Procès-verbal signé, numérisé et vérifié CONFORME obligatoire. | RÉUSSI |
| REM-02 | Documents administratifs | abm | Dépôt du PV signé numérisé M1 | OK | OK : {"id": "921be756-a3cc-4a2f-b67a-bec146eea7d3", "statut": "EN_VERIFICATION"} | RÉUSSI |
| REM-03 | PV non vérifié refusé | abm | Remise avec PV non vérifié | REFUS (Procès-verbal) | REFUS : Procès-verbal signé, numérisé et vérifié CONFORME obligatoire. | RÉUSSI |
| REM-04 | Vérification PV par un tiers | bm | BM vérifie le PV | OK | OK : {"id": "921be756-a3cc-4a2f-b67a-bec146eea7d3", "statut": "CONFORME"} | RÉUSSI |
| REM-05 | Permis vérifié RH obligatoire | abm | Remise sans vérification du permis | REFUS (permis) | REFUS : Vérification RH du permis adapté obligatoire (catégorie et vérificateur). | RÉUSSI |
| REM-06 | Équipements de sécurité obligatoires | abm | Remise sans gilet | REFUS (GILET) | REFUS : Équipement de sécurité manquant : GILET_HAUTE_VISIBILITE. | RÉUSSI |
| REM-07 | Documents conformes obligatoires | abm | Remise de M4 (aucun document) | REFUS (non conformes) | REFUS : Remise bloquée : documents administratifs non conformes (EN_ATTENTE). | RÉUSSI |
| REM-07b | État contradictoire obligatoire (AFLP FLEET §7.B) | abm | Remise de M1 sans état contradictoire | REFUS (état contradictoire) | REFUS : Remise bloquée : état contradictoire avant remise absent, non accepté par le bénéf | RÉUSSI |
| REM-07c | État contradictoire avant remise | abm | ABM enregistre l'état de M1 avec 5 photos | OK (EN_ATTENTE) | OK : {"id": "32e4654f-1a64-4029-bb0f-cb2cd762b19d", "anomalie_critique": false, "confirmat | RÉUSSI |
| REM-07d | Confirmation par le bénéficiaire uniquement | abm | ABM confirme à la place du bénéficiaire | REFUS (bénéficiaire) | REFUS : Seul le bénéficiaire confirme l'état contradictoire. | RÉUSSI |
| REM-07e | Bénéficiaire accepte avec réserves | uh_sak | UH Sakassou accepte avec réserve | OK (RESERVES) | OK : {"id": "32e4654f-1a64-4029-bb0f-cb2cd762b19d", "confirmation_statut": "ACCEPTEE_AVEC_ | RÉUSSI |
| REM-08 | Remise complète | abm | ABM enregistre la remise de M1 | OK (REMISE) | OK : {"id": "1adf3aca-ace7-4471-ae7a-4b50815e37cc", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| REM-09 | Statut affectation REMISE, pas encore en service | postgres (lecture) | REMISE/false | REMISE/false | REMISE/false | RÉUSSI |
| MES-01 | Chef d'unité : pas de saisie avant mise en service | uh_sak | Relevé km avant mise en service | REFUS (non mise en service) | REFUS : Moto non mise en service : saisie terrain impossible. | RÉUSSI |
| MES-02 | Mise en service réservée au BM | abm | ABM met en service | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| MES-03 | Mise en service (décision distincte de la remise) | bm | BM autorise la circulation de M1 | OK | OK : {"id": "3e8e5e5f-0dc2-4943-92a9-ac7bdca8e60f", "mise_en_service": true} | RÉUSSI |
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
| KM-01 | Relevé kilométrique | uh_sak | Relevé 40 km | OK | OK : {"moto_id": "3e8e5e5f-0dc2-4943-92a9-ac7bdca8e60f", "compteur_km": 40} | RÉUSSI |
| KM-02 | Idempotence : rejeu du même relevé | uh_sak | Rejeu client_op_id identique | OK (doublon) | OK : {"statut": "SYNCHRONISE", "doublon": true, "moto_id": "3e8e5e5f-0dc2-4943-92a9-ac7bdc | RÉUSSI |
| KM-03 | Pas de doublon en base | postgres (lecture) | 1 | 1 | 1 | RÉUSSI |
| KM-04 | Compteur décroissant refusé (conflit) | uh_sak | Relevé 30 km après 40 km | REFUS (CONFLIT_COMPTEUR) | REFUS : CONFLIT_COMPTEUR : 30 km est inférieur au relevé antérieur (40.0 km). Demandez une | RÉUSSI |
| KM-05 | Identifiant d'opération d'un autre compte | zh | ZH réutilise le client_op_id de l'UH | REFUS (autre compte) | REFUS : Identifiant d'opération déjà utilisé par un autre compte. | RÉUSSI |
| KM-06 | Chef d'unité : pas de saisie sur une moto non affectée | uh_bro | UH Brobo relève M1 | REFUS (périmètre) | REFUS : Moto hors de votre périmètre ou non affectée à votre compte. | RÉUSSI |
| CTL-01 | Contrôle avant départ APTE | uh_sak | Contrôle OK | OK (APTE) | OK : {"id": "e879fa0e-da20-4fe8-bcd1-951034719c4e", "incident": null, "resultat": "APTE",  | RÉUSSI |
| CTL-02 | Contrôle : points invalides refusés | uh_sak | Contrôle sans points | REFUS (vide) | REFUS : Liste de points de contrôle vide ou invalide. | RÉUSSI |
| SYN-01 | Synchronisation par lot | uh_sak | Lot : 1 valide, 1 conflit, 1 id invalide, 1 type interdit | OK | OK : [{"statut": "SYNCHRONISE", "resultat": {"moto_id": "3e8e5e5f-0dc2-4943-92a9-ac7bdca8e | RÉUSSI |
| SYN-02 | Statuts « Synchronisé » / « Rejeté » | uh_sak | Statuts renvoyés par opération | SYNCHRONISE,REJETE,REJETE,REJETE | SYNCHRONISE,REJETE,REJETE,REJETE | RÉUSSI |
| SYN-03 | Rejeu du lot sans doublon | uh_sak | Même lot renvoyé | OK | OK : [{"statut": "SYNCHRONISE", "doublon": true, "message": null, "resultat": {"statut": " | RÉUSSI |
| SYN-04 | Idempotence du lot | uh_sak | Le rejeu renvoie les mêmes statuts marqués doublon | [SYNCHRONISE doublon, REJETE doublon] | [('SYNCHRONISE', True), ('REJETE', True)] | RÉUSSI |
| SYN-05 | Un seul relevé 55 km en base | postgres (lecture) | 1 | 1 | 1 | RÉUSSI |
| SYN-06 | Lot limité | uh_sak | Lot de 51 opérations | REFUS (50) | REFUS : Lot limité à 50 opérations. | RÉUSSI |
| BUD-01 | Budget : Chef d'unité interdit | uh_sak | UH propose un budget | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| BUD-02 | Budget proposé par l'ABM | abm | ABM propose 30 000 FCFA (fictif) | OK (PROPOSE) | OK : {"id": "c1bd3828-0376-4813-a133-2659f1b368de", "statut": "PROPOSE"} | RÉUSSI |
| BUD-03 | Dotation impossible sans budget autorisé | abm | Remise sur budget proposé | REFUS (budget autorisé) | REFUS : Dotation impossible : aucun budget autorisé. | RÉUSSI |
| BUD-04 | Validation du budget par le BM | bm | BM valide le budget | OK (VALIDE) | OK : {"id": "c1bd3828-0376-4813-a133-2659f1b368de", "statut": "VALIDE"} | RÉUSSI |
| DOT-01 | Dotation espèces | abm | ABM remet 10 000 FCFA en espèces | OK (REMISE_DECLAREE) | OK : {"id": "b749d90b-912d-4ed2-98ac-73428cabaaa2", "note": "En attente de confirmation de | RÉUSSI |
| DOT-02 | Mobile Money : référence obligatoire | abm | Mobile Money sans référence | REFUS (Référence) | REFUS : Référence de transaction Mobile Money obligatoire. | RÉUSSI |
| DOT-03 | Mobile Money : frais distincts | abm | Mobile Money 10 000 + 100 de frais | OK | OK : {"id": "369c4bcf-a7ee-4505-a18b-fd82ffb444b8", "note": "En attente de confirmation de | RÉUSSI |
| DOT-04 | Mobile Money échoué | abm | Mobile Money 5 000 | OK | OK : {"id": "e9623d8c-ef24-4f6b-bc80-abcd460c610d", "note": "En attente de confirmation de | RÉUSSI |
| DOT-05 | Dépassement de budget refusé | abm | Remise de 10 000 au-delà de 30 000 | REFUS (Dépassement) | REFUS : Dépassement du budget autorisé : 25000 déjà remis sur 30000 FCFA. | RÉUSSI |
| DOT-06 | Transaction échouée | abm | ABM déclare l'échec MM-TEST-0002 | OK (ECHOUEE) | OK : {"id": "e9623d8c-ef24-4f6b-bc80-abcd460c610d", "statut": "ECHOUEE"} | RÉUSSI |
| DOT-07 | Seul le bénéficiaire confirme | abm | ABM confirme à la place de l'UH | REFUS (bénéficiaire) | REFUS : Seul le bénéficiaire confirme la réception de sa dotation. | RÉUSSI |
| DOT-08 | Échec non confirmable | uh_sak | UH confirme la transaction échouée | REFUS (ECHOUEE) | REFUS : Cette dotation n'est plus en attente de confirmation (ECHOUEE). | RÉUSSI |
| DOT-09 | Confirmation de réception | uh_sak | UH confirme 10 000 espèces | OK (CONFIRMEE) | OK : {"id": "b749d90b-912d-4ed2-98ac-73428cabaaa2", "statut": "CONFIRMEE", "montant_recu": | RÉUSSI |
| DOT-10 | Écart de réception = contestation | uh_sak | UH déclare 9 900 reçus sur 10 000 MM | OK (CONTESTEE) | OK : {"id": "369c4bcf-a7ee-4505-a18b-fd82ffb444b8", "statut": "CONTESTEE", "montant_recu": | RÉUSSI |
| CAR-01 | Plein/partiel obligatoire | uh_sak | Achat sans préciser plein | REFUS (plein) | REFUS : Préciser plein complet ou partiel. | RÉUSSI |
| CAR-02 | Carburant | uh_sak | Plein initial complet (référence) | OK | OK : {"id": "fca79f3e-9c3a-47ae-998d-2c56dfb52a51", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-03 | Carburant | uh_sak | Plein partiel | OK | OK : {"id": "668b43f5-4189-426c-b4be-dd81e0af3c5e", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-04 | Carburant | uh_sak | Plein complet de contrôle | OK | OK : {"id": "ffa1f5c0-5db0-4a42-a53f-a71abc3b8d48", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-05 | Consommation plein à plein vérifiable | postgres (lecture) | 100×(1,5+2,0)/(160−60) = 3,50 L/100 km | 3.50 | 3.50 | RÉUSSI |
| CAR-06 | Plein initial non compté deux fois | postgres (lecture) | Litres de l'intervalle = 3,50 (plein initial de 3 L exclu) | 3.50 | 3.50 | RÉUSSI |
| CAR-07 | Seuils provisoires : 3,50 < 3,6 → NORMAL | postgres (lecture) | NORMAL | NORMAL | NORMAL | RÉUSSI |
| CAR-08 | Données insuffisantes → Non disponible | postgres (lecture) | M3 : l_100km NULL | NULL | NULL | RÉUSSI |
| CAR-09 | Carburant | uh_sak | Achat daté après un relevé supérieur | REFUS (CONFLIT_COMPTEUR) | REFUS : CONFLIT_COMPTEUR : 150 km est inférieur au relevé antérieur (160.0 km). Demandez u | RÉUSSI |
| CAR-10 | Carburant | uh_sak | Avance personnelle de l'agent | OK | OK : {"id": "bb910448-3727-4488-b38e-9484b832ee72", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| JUS-01 | Auto-vérification interdite | uh_sak | UH vérifie son justificatif | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| JUS-02 | Vérification des justificatifs | fin | Finance vérifie l'achat 1 | OK (VERIFIE) | OK : {"id": "fca79f3e-9c3a-47ae-998d-2c56dfb52a51", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-03 | Vérification des justificatifs | fin | Finance vérifie l'achat 2 | OK (VERIFIE) | OK : {"id": "668b43f5-4189-426c-b4be-dd81e0af3c5e", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-04 | Vérification des justificatifs | fin | Finance vérifie l'achat 3 | OK (VERIFIE) | OK : {"id": "ffa1f5c0-5db0-4a42-a53f-a71abc3b8d48", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-06 | Vérification des justificatifs | fin | Finance vérifie l'achat 5 | OK (VERIFIE) | OK : {"id": "bb910448-3727-4488-b38e-9484b832ee72", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| RAP-01 | Rapprochement : remis / reçu / justifié / à apurer | postgres (lecture) | remis 20000 · reçu 19900 (10000 + 9900 en écart) · frais 100 · écart 100 · justifié 5525 · à apurer 14375 | 20000·19900·100·100·5525·14375 | 20000·19900·100·100·5525·14375 | RÉUSSI |
| RES-01 | Restitution > avance refusée | abm | Restitution de 20 000 | REFUS (supérieure) | REFUS : Restitution supérieure à l'avance à apurer (14375 FCFA). | RÉUSSI |
| RES-02 | Restitution d'espèces restantes | abm | Restitution de 475 | OK (13900) | OK : {"id": "7f1604a5-2b63-4e6d-af9c-296790627b3e", "solde_restant": 13900} | RÉUSSI |
| RBT-01 | Remboursement d'avance personnelle | abm | ABM demande le remboursement de l'avance | OK (2125) | OK : {"id": "d1e5bca2-7ddf-4008-a6de-93375e153600", "statut": "DEMANDE", "montant": 2125} | RÉUSSI |
| RBT-02 | Pas de double remboursement | abm | Deuxième demande sur le même achat | REFUS (non encore remboursée) | REFUS : Chaque achat doit être une avance personnelle de ce bénéficiaire, justifiée VÉRIFI | RÉUSSI |
| RBT-03 | Finance simple : pas de validation | fin | Finance valide le remboursement | REFUS (Finance Manager) | REFUS : Validation réservée au Branch Manager ou au Finance Manager. | RÉUSSI |
| RBT-04 | Validation par le Finance Manager | fm | Finance Manager valide | OK (VALIDE) | OK : {"id": "d1e5bca2-7ddf-4008-a6de-93375e153600", "statut": "VALIDE"} | RÉUSSI |
| RBT-05 | Paiement déclaré (non exécuté) | fin | Finance déclare le paiement MM | OK (PAYE_DECLARE) | OK : {"id": "d1e5bca2-7ddf-4008-a6de-93375e153600", "statut": "PAYE_DECLARE"} | RÉUSSI |
| RAP-02 | Pas de double comptage dotation/remboursement | postgres (lecture) | reste à rembourser 0 · remboursé 2125 · à apurer 13900 | 0·2125·13900 | 0·2125·13900 | RÉUSSI |
| COR-01 | Correction : demande ABM | abm | ABM demande la correction des frais MM | OK (DEMANDEE) | OK : {"id": "4b4e02d3-a3ae-4fb3-8212-7901b5217b54", "statut": "DEMANDEE"} | RÉUSSI |
| COR-02 | Champ non corrigeable | zh | ZH corrige un montant de dotation | REFUS (non corrigeable) | REFUS : Champ non corrigeable par votre rôle. | RÉUSSI |
| COR-03 | ABM ne valide pas une correction | abm | ABM valide sa propre correction | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| COR-04 | Validation BM | bm | BM applique la correction | OK (APPLIQUEE) | OK : {"id": "4b4e02d3-a3ae-4fb3-8212-7901b5217b54", "statut": "APPLIQUEE"} | RÉUSSI |
| COR-05 | Valeur corrigée et journal avec valideur | postgres (lecture) | 150 / valideur BM | 150/1 | 150/1 | RÉUSSI |
| COR-06 | BM initie une correction | bm | BM demande correction compteur relevé | OK | OK : {"id": "85b6ffa8-5ca2-40eb-b67d-2b470553a061", "statut": "DEMANDEE"} | RÉUSSI |
| COR-07 | BM ne s'auto-approuve pas | bm | BM valide sa propre demande | REFUS (Auto-approbation) | REFUS : Auto-approbation interdite : un autre responsable doit valider. | RÉUSSI |
| COR-08 | Validation par la Direction | gm | General Manager rejette | OK (REJETEE) | OK : {"id": "85b6ffa8-5ca2-40eb-b67d-2b470553a061", "statut": "REJETEE"} | RÉUSSI |
| INC-01 | Anomalie critique au départ → immobilisation | uh_sak | Contrôle avant départ freins KO | OK (INAPTE) | OK : {"id": "45483d07-1e9a-4ef7-9791-c5778ad1dbf1", "incident": {"id": "f59e2c8d-73a8-40d4 | RÉUSSI |
| INC-02 | Moto immobilisée sans attendre | postgres (lecture) | IMMOBILISEE / non autorisée | IMMOBILISEE/false | IMMOBILISEE/false | RÉUSSI |
| INC-03 | Chef d'unité ne pilote pas le circuit | uh_sak | UH avance l'incident | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| INC-04 | Transition interdite | zh | Saut direct vers REMIS_EN_SERVICE | REFUS (Transition) | REFUS : Transition interdite : IMMOBILISEE → REMIS_EN_SERVICE. | RÉUSSI |
| INC-05 | Diagnostic | zh | ZH : diagnostic | OK | OK : {"id": "f59e2c8d-73a8-40d4-9874-5c76368ceaae", "etape": "DIAGNOSTIC"} | RÉUSSI |
| INC-06 | Autorisation de dépense : montant obligatoire | zh | Autorisation sans montant | REFUS (Montant) | REFUS : Montant estimé de la dépense obligatoire. | RÉUSSI |
| INC-07 | ABM ne peut pas autoriser la dépense | abm | ABM autorise la dépense | REFUS (réservée) | REFUS : Autorisation de dépense réservée au Branch Manager ou au Chef de Zone. | RÉUSSI |
| INC-08 | Autorisation de dépense | zh | ZH autorise 8 000 (fictif) | OK | OK : {"id": "f59e2c8d-73a8-40d4-9874-5c76368ceaae", "etape": "AUTORISATION_DEPENSE"} | RÉUSSI |
| INC-09 | Réparation | zh | ZH : réparation | OK | OK : {"id": "f59e2c8d-73a8-40d4-9874-5c76368ceaae", "etape": "REPARATION"} | RÉUSSI |
| INC-10 | Contrôle | zh | ZH : étape contrôle | OK | OK : {"id": "f59e2c8d-73a8-40d4-9874-5c76368ceaae", "etape": "CONTROLE"} | RÉUSSI |
| INC-11 | Remise en service exige un contrôle APTE | zh | Remise en service sans contrôle | REFUS (contrôle) | REFUS : Remise en service bloquée : contrôle de remise en service APTE obligatoire après l | RÉUSSI |
| INC-12 | Contrôle de remise en service | zh | ZH enregistre le contrôle APTE | OK (APTE) | OK : {"id": "d265e469-2321-4ea5-b55f-e008ed27b1e7", "resultat": "APTE"} | RÉUSSI |
| INC-13 | Remise en service | zh | ZH remet en service | OK | OK : {"id": "f59e2c8d-73a8-40d4-9874-5c76368ceaae", "etape": "REMIS_EN_SERVICE"} | RÉUSSI |
| INC-14 | Clôture | zh | ZH clôt l'incident avec coût réel | OK | OK : {"id": "f59e2c8d-73a8-40d4-9874-5c76368ceaae", "etape": "CLOS"} | RÉUSSI |
| INC-15 | Moto de nouveau APTE | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| INC-16 | Historique complet du circuit | postgres (lecture) | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,C | RÉUSSI |
| INC-17 | Accident : registre AFLP lié (pas de doublon de saisie) | uh_sak | UH déclare un accident | OK (INC-) | OK : {"id": "38b67866-ef71-482c-ab2f-55239564abcd", "immobilisee": true, "aflp_incident_id | RÉUSSI |
| INC-18 | Incident AFLP créé et relié | postgres (lecture) | ACCIDENT_MOTO | ACCIDENT_MOTO | ACCIDENT_MOTO | RÉUSSI |
| INC-19 | Accident = immobilisation | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| INC-20 | Traçabilité : relevé km accepté pendant immobilisation | uh_sak | Relevé km pendant immobilisation | OK | OK : {"moto_id": "3e8e5e5f-0dc2-4943-92a9-ac7bdca8e60f", "compteur_km": 207} | RÉUSSI |
| MNT-01 | Demande d'entretien terrain | uh_sak | UH demande une vidange | OK (DEMANDEE) | OK : {"id": "921258ca-5498-4a6c-aafe-d1e364efc8a1", "statut": "DEMANDEE"} | RÉUSSI |
| MNT-02 | Autorisation par un tiers | zh | ZH autorise | OK (AUTORISEE) | OK : {"id": "921258ca-5498-4a6c-aafe-d1e364efc8a1", "statut": "AUTORISEE"} | RÉUSSI |
| MNT-03 | Démarrage : garage obligatoire | zh | Démarrage sans garage | REFUS (Garage) | REFUS : Garage intervenant obligatoire. | RÉUSSI |
| MNT-04 | Démarrage → immobilisation | zh | ZH démarre au garage fictif | OK | OK : {"id": "921258ca-5498-4a6c-aafe-d1e364efc8a1", "statut": "EN_COURS"} | RÉUSSI |
| MNT-05 | Statut EN_REPARATION | postgres (lecture) | EN_REPARATION | EN_REPARATION | EN_REPARATION | RÉUSSI |
| MNT-06 | Clôture payante sans facture refusée | zh | Fin sans facture | REFUS (Facture) | REFUS : Facture obligatoire pour clôturer une intervention payante. | RÉUSSI |
| MNT-07 | Documents administratifs | zh | ZH dépose la facture | OK | OK : {"id": "9c4bdff0-6a08-41de-b473-bc939dcdc6ff", "statut": "EN_VERIFICATION"} | RÉUSSI |
| MNT-08 | Clôture avec facture | zh | Fin avec facture | OK (TERMINEE) | OK : {"id": "921258ca-5498-4a6c-aafe-d1e364efc8a1", "statut": "TERMINEE", "remise_en_servi | RÉUSSI |
| MNT-09 | Immobilisation accident toujours ouverte | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| MNT-10 | Aucune périodicité constructeur inventée | bm | Règle déclarée constructeur sans référence | REFUS (check) | REFUS : new row for relation "moto_regles_maintenance" violates check constraint "moto_reg | RÉUSSI |
| MNT-11 | Règle paramétrée ANAGROCI | bm | BM paramètre vidange 1 000 km (paramètre de test) | OK | OK : {"code": "VIDANGE"} | RÉUSSI |
| MNT-12 | Échéance calculée | postgres (lecture) | A_JOUR, prochaine à 1208 km | A_JOUR,1208.0 | A_JOUR,1208.0 | RÉUSSI |
| MNT-13 | Règles inactives par défaut | postgres (lecture) | 2 règles inactives sans intervalle | 2 | 2 | RÉUSSI |
| PNE-01 | Pneu : identité propre | abm | Entrée en stock d'un pneu fictif | OK | OK : {"id": "993f28bf-ef88-4d58-b4e3-c87692fbb0e4"} | RÉUSSI |
| PNE-02 | Montage | abm | Montage arrière à 208 km | OK | OK : {"id": "36d59f31-6761-416e-84f5-8cc82e95d41f"} | RÉUSSI |
| PNE-03a | Pneu : identité propre | abm | Entrée en stock d'un second pneu fictif | OK | OK : {"id": "3b2bc807-3e4d-49f1-b81b-e13c03066660"} | RÉUSSI |
| PNE-03 | Un pneu par position | abm | Second pneu à la même position | REFUS (déjà monté) | REFUS : Un pneu est déjà monté à cette position : déposez-le d'abord. | RÉUSSI |
| PNE-04 | Réparation tracée | zh | Réparation crevaison | OK | OK : {"id": "6b58eeb4-fc1f-443b-a612-8d3c1e26108b"} | RÉUSSI |
| PNE-05 | Dépose et réforme | abm | Dépose à 708 km, réforme | OK (500) | OK : {"id": "36d59f31-6761-416e-84f5-8cc82e95d41f", "km_parcourus": 500.0} | RÉUSSI |
| PNE-06 | Coût par km sur données réelles | postgres (lecture) | (12000+1000)/500 = 26.00 FCFA/km | 26.00 | 26.00 | RÉUSSI |
| KPI-01 | Disponibilité : dénominateur présent | postgres (lecture) | taux calculé (non NULL) | true | true | RÉUSSI |
| KPI-02 | Disponibilité : moto non en service → absente (Non disponible) | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| KPI-03 | Coût/km : dotations et remboursements exclus | postgres (lecture) | carburant vérifié 7650 + maintenance 5000 + pneus 13000 + incident 8000 | 7650+5000+13000+8000 | 7650+5000+13000+8000 | RÉUSSI |
| FOR-01 | Formation : résultat | uh_sak | UH réussit un quiz 4/5 | OK (true) | OK : {"id": "563d4cf6-1672-48af-a1c4-b7cd52ace8bc", "reussi": true} | RÉUSSI |
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
| BEN-01 | Liste des bénéficiaires : ABM | abm | ABM liste les bénéficiaires éligibles (UH, ZH, ABM, coordinateur actifs) | OK (6) | OK : 6 | RÉUSSI |
| BEN-02 | Liste des bénéficiaires : refusée au Chef d'unité | uh_sak | UH liste les bénéficiaires | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-00a | Classe LOGISTIQUE reconnue via fonction_operationnelle | postgres (lecture) | LOGISTIQUE | LOGISTIQUE | LOGISTIQUE | RÉUSSI |
| FL-00b | Aucun droit FBMS modifié : rôle Supervisor inchangé pour le coordinateur | postgres (lecture) | Supervisor | Supervisor | Supervisor | RÉUSSI |
| FL-03a | Enregistrement d'une moto neuve par le coordinateur | lc | Coordinateur crée M5 (Brobo) réceptionnée | OK | OK : {"id": "e82b4d37-72cc-47eb-8920-71b966d3bff4", "code": "MOTO-005", "origine": "NEUVE" | RÉUSSI |
| FL-03b | Réception : date effective obligatoire | lc | Moto neuve réceptionnée sans date | REFUS (Date de réception) | REFUS : Date de réception effective obligatoire (sinon : acquisition prévue). | RÉUSSI |
| FL-03c | Photo principale : réservée BM/ABM/coordinateur | uh_bro | Chef d'unité définit la photo principale | REFUS | REFUS : Moto hors de votre périmètre. | RÉUSSI |
| FL-03d | Photo principale enregistrée | lc | Coordinateur enregistre la photo principale de M5 | OK (true) | OK : {"id": "a01b606f-61a0-4dc1-a86c-399c858bd2f1", "principale": true} | RÉUSSI |
| FL-03e | Photo visible au passeport (vue flotte) | postgres (lecture) | e82b4d37-72cc-47eb-8920-71b966d3bff4/photo/51a0e4a5-dead-4adc-b5e0-c17c3575f83c.jpg | e82b4d37-72cc-47eb-8920-71b966d3bff4/photo/51a0e4a5-dead-4adc-b5e0-c17c3575f83c.jpg | e82b4d37-72cc-47eb-8920-71b966d3bff4/photo/51a0e4a5-dead-4adc-b5e0-c17c3575f83c.jpg | RÉUSSI |
| FL-03f | Photo : fichier d'une autre moto refusé | lc | Photo de M1 rattachée à M5 | REFUS (non conforme) | REFUS : Chemin de fichier non conforme pour cette moto. | RÉUSSI |
| FL-04a | Photo accessible après reconnexion (compte autorisé) | bm | BM lit l'objet photo de M5 | OK (1) | OK : 1 | RÉUSSI |
| FL-04b | Photo protégée hors périmètre | uh_bot | UH Botro lit la photo de M5 | OK (0) | OK : 0 | RÉUSSI |
| FL-05a | Documents : anonyme refusé | anon | Anonyme lit les objets | REFUS (permission) | REFUS : permission denied for table objects | RÉUSSI |
| FL-05b | Galerie photo protégée | uh_bot | UH Botro lit la galerie de M5 | OK (0) | OK : 0 | RÉUSSI |
| FL-05c | Bucket toujours privé | postgres (lecture) | f | f | f | RÉUSSI |
| FL-06a | Intégration d'une moto en exploitation sans marque connue | lc | Coordinateur intègre la moto du Chef de zone (marque inconnue) | OK (EN_EXPLOITATION) | OK : {"id": "fa821283-bee7-49bf-acd4-eeb52c6417f6", "code": "MOTO-006", "origine": "EN_EXP | RÉUSSI |
| FL-06b | Inconnu = Non disponible (NULL), jamais zéro | postgres (lecture) | t | t | t | RÉUSSI |
| FL-07a | Aucune vidange ni dépense passée inventée | postgres (lecture) | 0/0/0 | 0/0/0 | 0/0/0 | RÉUSSI |
| FL-06c | État de référence : inventaire photo exigé | lc | Référence sans photos | REFUS (Photos insuffisantes) | REFUS : Photos insuffisantes : 5 exigée(s), 0 fournie(s). | RÉUSSI |
| FL-06d | État de référence : compteur exigé | lc | Référence sans compteur | REFUS (compteur) | REFUS : État de référence : relevé du compteur obligatoire. | RÉUSSI |
| FL-06e | État technique de référence par un intervenant qualifié | lc | Référence complète, anomalie éclairage existante | OK (etat_reference": true) | OK : {"id": "b7eaed93-7fc1-41f0-84b4-6695c3713874", "resultat": "APTE", "etat_reference":  | RÉUSSI |
| FL-06f | Début du suivi fiable = date de l'état de référence ; anomalie existante identifiée | postgres (lecture) | 2026-10-31/1/APTE | 2026-10-31/1/APTE | 2026-10-31/1/APTE | RÉUSSI |
| FL-07b | Coûts : aucune dépense historique créée | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| FL-15a | Acquisition prévue | lc | Moto prévue pour le 2e Chef de zone | OK (PREVUE) | OK : {"id": "8a31de5d-bf6b-4784-bc0c-e38426e0b31c", "code": "MOTO-007", "origine": "NEUVE" | RÉUSSI |
| FL-15b | Prévue : pas de compteur inventé | lc | Moto prévue avec compteur | REFUS (ni date) | REFUS : Une acquisition prévue n'a ni date de réception ni compteur. | RÉUSSI |
| FL-15c | Prévue : aucune affectation | bm | BM préaffecte la moto prévue | REFUS (réception) | REFUS : Acquisition prévue : aucune affectation avant la réception physique. | RÉUSSI |
| FL-15d | Prévue : aucune inspection | lc | Inspection d'une moto prévue | REFUS (réceptionnée) | REFUS : Moto non réceptionnée : enregistrez d'abord la réception. | RÉUSSI |
| FL-15e | Prévue : jamais comptée opérationnelle | postgres (lecture) | PREVUE/false/false | PREVUE/false/false | PREVUE/false/false | RÉUSSI |
| FL-15f | Réception physique : kilométrage obligatoire | lc | Réception sans compteur | REFUS (Kilométrage) | REFUS : Kilométrage à la réception obligatoire. | RÉUSSI |
| FL-18a | Moto de test M7 | lc | Coordinateur crée M7 | OK | OK : {"id": "dc453d5c-a5f0-4c1d-bdea-b42702476fd8", "code": "MOTO-008", "origine": "NEUVE" | RÉUSSI |
| FL-18b | Code de point inconnu rejeté | lc | Inspection avec un code inventé | REFUS (inconnu) | REFUS : Point de contrôle inconnu pour ce contrôle : BIDON. | RÉUSSI |
| FL-18c | Code dupliqué rejeté | lc | Inspection avec un point en double | REFUS (double) | REFUS : Point de contrôle en double : FREIN_AVANT. | RÉUSSI |
| FL-18d | Point obligatoire omis rejeté | lc | Inspection sans le point freins avant | REFUS (obligatoires) | REFUS : Points obligatoires non renseignés : Frein avant efficace. | RÉUSSI |
| FL-18e | Champ « critique » falsifié par le client : règle serveur maintenue | lc | Freins KO envoyés critique=false, résultat APTE | OK ("anomalie_critique": true) | OK : {"id": "c9060fbb-fbc4-4d5d-aa3a-7a12cb1506b1", "resultat": "INAPTE", "etat_reference" | RÉUSSI |
| FL-17a | Anomalie critique → immobilisation persistante | postgres (lecture) | IMMOBILISEE/INAPTE/CRITIQUE | IMMOBILISEE/INAPTE/CRITIQUE | IMMOBILISEE/INAPTE/CRITIQUE | RÉUSSI |
| FL-18f | Gravité enregistrée = catalogue (pas la valeur client) | postgres (lecture) | true | true | true | RÉUSSI |
| FL-18g | Contrôle départ : critique falsifié | uh_sak | Départ M1 freins KO critique=false | OK ("anomalie_critique": true) | OK : {"id": "60a0cb25-1b48-4ea5-8c2d-31015e75b603", "incident": {"id": "1a629c6c-7606-464f | RÉUSSI |
| FL-20a | Remise en service : le coordinateur ne lève pas seul | lc | Coordinateur lève l'immobilisation | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-20b | Contrôle de remise en service par le coordinateur | lc | Contrôle APTE après réparation | OK (APTE) | OK : {"id": "f8e218f7-8fea-4276-bc5c-aaf1794a7f87", "resultat": "APTE"} | RÉUSSI |
| FL-20c | Levée bloquée tant que l'anomalie n'est pas vérifiée | bm | BM lève avant clôture de l'action | REFUS (anomalie critique) | REFUS : Levée bloquée : une anomalie critique n'est pas encore corrigée et vérifiée. | RÉUSSI |
| FL-20d | Planification de l'action | lc | Coordinateur planifie (garage, devis, date cible) | OK (PLANIFIEE) | OK : {"id": "3168e75a-fcc4-4e78-bc07-437c33929950", "statut": "PLANIFIEE"} | RÉUSSI |
| FL-20e | Réalisation : justificatif exigé si dépense | lc | Réalisation payante sans facture | REFUS (justificatif) | REFUS : Facture ou justificatif obligatoire pour une dépense. | RÉUSSI |
| FL-20f | Réalisation avec facture | lc | Réalisation avec facture fictive | OK (REALISEE) | OK : {"id": "3168e75a-fcc4-4e78-bc07-437c33929950", "statut": "REALISEE"} | RÉUSSI |
| FL-20g | Vérification par un tiers uniquement | lc | Le coordinateur vérifie son propre travail | REFUS (Séparation) | REFUS : Séparation des tâches : la personne qui a réalisé ne vérifie pas son propre travai | RÉUSSI |
| FL-20h | Vérification après réparation | zh | Chef de zone vérifie et clôt | OK (CLOTUREE) | OK : {"id": "3168e75a-fcc4-4e78-bc07-437c33929950", "statut": "CLOTUREE"} | RÉUSSI |
| FL-20i | Levée : auteur du contrôle ≠ décideur | bm | BM lève l'immobilisation (contrôle fait par le coordinateur) | OK (true) | OK : {"id": "f39eb42b-de4e-4ef5-a8f5-922e7108877a", "levee": true} | RÉUSSI |
| FL-20j | Clôture vérifiée ; moto neuve à nouveau « à contrôler » (pas d'aptitude automatique) | postgres (lecture) | CLOTUREE/A_CONTROLER | CLOTUREE/A_CONTROLER | CLOTUREE/A_CONTROLER | RÉUSSI |
| FL-20k | Nouvelle inspection mécanique après réparation | abm | Inspection initiale APTE de M7 | OK (APTE) | OK : {"id": "ae8290cc-8802-4e49-b90d-98ba177c807d", "resultat": "APTE", "etat_reference":  | RÉUSSI |
| FL-20l | Moto apte après preuve de correction | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| FL-09a | Moto M8 (Botro) | lc | Coordinateur crée M8 | OK | OK : {"id": "884dd284-201a-4c11-9dfc-00c134a693f1", "code": "MOTO-009", "origine": "NEUVE" | RÉUSSI |
| FL-SVC-M5 | Chaîne de remise complète (PV + état contradictoire distincts) | abm | Remise de la moto M5 | OK (REMISE) | OK : {"id": "ecde6971-4c0d-4ca5-9cbe-92e203e485b7", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| FL-MES-M5 | Mise en service distincte | bm | Mise en service M5 | OK | OK : {"id": "e82b4d37-72cc-47eb-8920-71b966d3bff4", "mise_en_service": true} | RÉUSSI |
| FL-09b | PV de remise ≠ inspection mécanique ≠ état contradictoire | postgres (lecture) | t | t | t | RÉUSSI |
| FL-16 | Mise en service en cours de mois : aucune inspection rétroactive exigée | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| FL-13a | Moto M9 (ABM) | lc | Moto pour l'ABM | OK | OK : {"id": "b9e75350-704a-4f69-9d6b-a3bd7aac58f3", "code": "MOTO-010", "origine": "NEUVE" | RÉUSSI |
| FL-13b | Moto M10 (coordinateur) | bm | Moto du coordinateur | OK | OK : {"id": "e0f2b46e-8eec-417e-b253-31fb918f1142", "code": "MOTO-011", "origine": "NEUVE" | RÉUSSI |
| FL-SVC-M6 | Chaîne de remise complète (PV + état contradictoire distincts) | abm | Remise de la moto M6 | OK (REMISE) | OK : {"id": "5cdbc840-a504-4574-a21f-ea793a32ee87", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| FL-MES-M6 | Mise en service distincte | bm | Mise en service M6 | OK | OK : {"id": "fa821283-bee7-49bf-acd4-eeb52c6417f6", "mise_en_service": true} | RÉUSSI |
| FL-SVC-M9 | Chaîne de remise complète (PV + état contradictoire distincts) | lc | Remise de la moto M9 | OK (REMISE) | OK : {"id": "0de2b407-a1e0-41ea-a23a-77dbf89740f4", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| FL-MES-M9 | Mise en service distincte | bm | Mise en service M9 | OK | OK : {"id": "b9e75350-704a-4f69-9d6b-a3bd7aac58f3", "mise_en_service": true} | RÉUSSI |
| FL-13g | Moto de l'ABM : remise enregistrée par un tiers (coordinateur), jamais par le bénéficiaire | postgres (lecture) | 00000000-0000-4000-8000-000000000020 | 00000000-0000-4000-8000-000000000020 | 00000000-0000-4000-8000-000000000020 | RÉUSSI |
| FL-SVC-M10 | Chaîne de remise complète (PV + état contradictoire distincts) | abm | Remise de la moto M10 | OK (REMISE) | OK : {"id": "2c1ba6b2-d9db-458d-aa47-f3237db2acc9", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| FL-MES-M10 | Mise en service distincte | bm | Mise en service M10 | OK | OK : {"id": "e0f2b46e-8eec-417e-b253-31fb918f1142", "mise_en_service": true} | RÉUSSI |
| FL-14a | Moto du coordinateur : contrôle indépendant exigé, pas de COORDINATION | postgres (lecture) | INDEPENDANTE | INDEPENDANTE | INDEPENDANTE | RÉUSSI |
| FL-13c | Moto du Chef de zone : COORDINATION uniquement (pas de niveau ZONE) | postgres (lecture) | COORDINATION | COORDINATION | COORDINATION | RÉUSSI |
| FL-13d | Coordinateur inspecte la moto d'un Chef d'unité | lc | COORDINATION sur M1 | OK (COORDINATION) | OK : {"id": "b9209cc8-dad0-484b-a66e-e69401e309a9", "niveau": "COORDINATION", "periode": " | RÉUSSI |
| FL-13e | Coordinateur inspecte la moto du Chef de zone | lc | COORDINATION sur M6 | OK (COORDINATION) | OK : {"id": "d6bcaa53-198e-4d3d-972f-16a1a54f2f5c", "niveau": "COORDINATION", "periode": " | RÉUSSI |
| FL-13f | Coordinateur inspecte la moto de l'ABM (anomalie critique) | lc | COORDINATION sur M9, pneus KO | OK (NON_CONFORME) | OK : {"id": "8d8d3674-9788-4fd0-8676-472f5f89152f", "niveau": "COORDINATION", "periode": " | RÉUSSI |
| FL-17b | Inspection mensuelle critique → immobilisation immédiate | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| FL-14b | Coordinateur : pas d'inspection de sa propre moto | lc | COORDINATION sur M10 | REFUS (propre moto) | REFUS : Indépendance : vous ne pouvez pas réaliser l'inspection mensuelle de votre propre  | RÉUSSI |
| FL-14c | Coordinateur : pas d'auto-contrôle indépendant | lc | INDEPENDANTE sur M10 | REFUS (propre moto) | REFUS : Indépendance : vous ne pouvez pas réaliser l'inspection mensuelle de votre propre  | RÉUSSI |
| FL-14d | Contrôle indépendant : inspecteur désigné requis | zh2 | Chef de zone non désigné, INDEPENDANTE sur M10 | REFUS (désigné) | REFUS : Contrôle indépendant réservé au BM, à l'ABM ou à un inspecteur désigné par ANAGROC | RÉUSSI |
| FL-14e | Désignation d'un inspecteur indépendant par le BM | bm | BM désigne ZH2 | OK | OK : {"cle": "inspecteurs_independants"} | RÉUSSI |
| FL-14f | Contrôle indépendant de la moto du coordinateur | zh2 | ZH2 désigné, INDEPENDANTE sur M10 | OK (INDEPENDANTE) | OK : {"id": "5618f439-d77e-4a98-ad98-f39cd7bdcee0", "niveau": "INDEPENDANTE", "periode": " | RÉUSSI |
| FL-14g | Rapport d'un mécanicien externe saisi par un tiers autorisé | bm | Second contrôle indépendant du mois refusé (doublon) | REFUS (déjà enregistrée) | REFUS : Inspection déjà enregistrée pour ce mois et ce niveau : utilisez la correction mot | RÉUSSI |
| FL-10 | Chef de zone inspecte une moto de Chef d'unité de sa zone | zh | ZONE sur M1 (Sakassou, GBEKE 1), éclairage KO | OK ("dans_delai": false) | OK : {"id": "1ac9da94-bfeb-4f1a-9986-07eb73fa4b02", "niveau": "ZONE", "periode": "2026-10- | RÉUSSI |
| FL-12 | Inspection du Chef de zone après le 15 : tardive | postgres (lecture) | EFFECTUEE_HORS_DELAI | EFFECTUEE_HORS_DELAI | EFFECTUEE_HORS_DELAI | RÉUSSI |
| FL-11a | Chef de zone : pas d'écriture hors de sa zone | zh | ZH (GBEKE 1) demande un entretien sur M8 (Botro, GBEKE 2) | REFUS (périmètre) | REFUS : Moto hors de votre périmètre ou non affectée à votre compte. | RÉUSSI |
| FL-11b | Chef de zone : pas d'inspection hors de sa zone | zh2 | ZH2 (GBEKE 2) inspecte M1 (GBEKE 1) | REFUS (zone) | REFUS : Moto hors de votre zone de responsabilité. | RÉUSSI |
| FL-11c | Chef de zone : lecture globale conservée | zh | ZH lit M8 | OK (1) | OK : 1 | RÉUSSI |
| FL-11d | Chef de zone sans zone renseignée : refus explicite | zh_sz | ZH sans zone inspecte M1 | REFUS (Zone de responsabilité) | REFUS : Zone de responsabilité non renseignée sur votre profil FBMS : demandez au Branch M | RÉUSSI |
| FL-11e | Chef de zone : ne fait pas l'inspection d'un ABM | zh | ZONE sur M9 (ABM) | REFUS (Chefs d'unité) | REFUS : Le Chef de zone inspecte les motos des Chefs d'unité de sa zone. | RÉUSSI |
| FL-12b | Aucune inspection rétroactive (date antérieure) | zh | ZONE datée de 10 jours | REFUS (3 jours) | REFUS : Saisie différée limitée à 3 jours : au-delà, utilisez une correction motivée. | RÉUSSI |
| FL-19a | Doublon artificiel refusé | zh | Seconde inspection ZONE de M1 ce mois | REFUS (déjà enregistrée) | REFUS : Inspection déjà enregistrée pour ce mois et ce niveau : utilisez la correction mot | RÉUSSI |
| FL-19b | Visite effectuée ≠ conforme : anomalie ouverte maintenue | lc | Le coordinateur ne peut pas refaire COORDINATION sur M1 (déjà faite) | REFUS (déjà enregistrée) | REFUS : Inspection déjà enregistrée pour ce mois et ce niveau : utilisez la correction mot | RÉUSSI |
| FL-19c | Correction motivée (piste d'audit) | zh | ZH corrige son inspection, tout OK cette fois | OK (RESERVES) | OK : {"id": "496405d4-6d21-45fb-a563-5b0dbb7a5694", "niveau": "ZONE", "periode": "2026-10- | RÉUSSI |
| FL-19d | Anomalie non corrigée reste ouverte à l'inspection suivante (pas de doublon) | postgres (lecture) | 1/1 | 1/1 | 1/1 | RÉUSSI |
| FL-19e | Version corrigée conservée | postgres (lecture) | 1/1 | 1/1 | 1/1 | RÉUSSI |
| FL-21a | Enveloppe de supervision demandée | lc | Coordinateur demande 50 000 (fictif) | OK (DEMANDEE) | OK : {"id": "16742ec3-865d-4777-b8e7-dfc009d56d55", "statut": "DEMANDEE"} | RÉUSSI |
| FL-21b | Pas d'auto-approbation | lc | Coordinateur approuve sa propre enveloppe | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-21c | Approbation partielle motivée par le BM | bm | BM approuve 40 000 | OK (APPROUVEE) | OK : {"id": "16742ec3-865d-4777-b8e7-dfc009d56d55", "statut": "APPROUVEE"} | RÉUSSI |
| FL-21d | Dépense déclarée sur l'enveloppe | lc | Dépense 30 000 sans justificatif | OK (DECLAREE) | OK : {"id": "e9242b8f-223b-4762-a692-4f3dfca221fa", "statut": "DECLAREE"} | RÉUSSI |
| FL-21e | Dépassement refusé | lc | Dépense 20 000 au-delà du solde | REFUS (solde) | REFUS : Dépassement de l'enveloppe : solde disponible 10000 FCFA. | RÉUSSI |
| FL-21f | Justificatif d'un autre compte refusé | lc | Chemin de justificatif du BM | REFUS (non conforme) | REFUS : Chemin de justificatif non conforme (depenses/<votre compte>/…). | RÉUSSI |
| FL-21g | Justificatif ajouté | lc | Coordinateur ajoute son justificatif | OK (JUSTIFIEE) | OK : {"id": "e9242b8f-223b-4762-a692-4f3dfca221fa", "statut": "JUSTIFIEE"} | RÉUSSI |
| FL-21h | Le coordinateur ne valide pas ses dépenses | lc | Coordinateur valide sa dépense | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-21i | Validation par un tiers habilité | abm | ABM valide | OK (VALIDEE) | OK : {"id": "e9242b8f-223b-4762-a692-4f3dfca221fa", "statut": "VALIDEE"} | RÉUSSI |
| FL-21j | Enveloppe : demandé / approuvé / consommé / justifié / solde | postgres (lecture) | 50000/40000/30000/30000/10000 | 50000/40000/30000/30000/10000 | 50000/40000/30000/30000/10000 | RÉUSSI |
| FL-21k | Enveloppes : Chef d'unité sans accès | uh_sak | UH lit les enveloppes | OK (0) | OK : 0 | RÉUSSI |
| FL-LC1 | Coordinateur : pas de mise en service | lc | Mise en service de M8 | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-LC2 | Coordinateur : pas de décision de dépense de maintenance | lc | Décision maintenance | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-LC3 | Coordinateur : pas d'accès aux dotations Finance | lc | Lecture des dotations | OK (0) | OK : 0 | RÉUSSI |
| FL-LC4 | Coordinateur : pas de modification des paramètres | lc | Modifie un paramètre | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-LC5 | Coordinateur : pas de préaffectation | lc | Préaffecte M8 | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-LC6 | Coordinateur : voit tout le parc | lc | Lecture flotte | OK (t) | OK : t | RÉUSSI |
| FL-LC7 | Coordinateur : demande d'entretien possible | lc | Demande de vidange sur M8 | OK (DEMANDEE) | OK : {"id": "5b39af18-a922-46b4-89ce-47acee2aab9b", "statut": "DEMANDEE"} | RÉUSSI |
| FL-22 | Coût/km : kilomètres comptés depuis le suivi fiable, jamais depuis 0 (historique exclu) | postgres (lecture) | t | t | t | RÉUSSI |
| FL-23 | L/100 km non calculé sans pleins complets | postgres (lecture) | null | null | null | RÉUSSI |
| FL-24a | Pneu : marquage DOT invalide refusé | lc | Date de fabrication « 26 » | REFUS (DOT) | REFUS : Date de fabrication : 4 chiffres du marquage DOT (semaine + année, ex. 2526), ou v | RÉUSSI |
| FL-24b | Pneu : identité complète | lc | Coordinateur entre un pneu | OK | OK : {"id": "a383a236-a31e-444e-9736-27c05d21d9dc"} | RÉUSSI |
| FL-24c | Pneu : pose | lc | Pose arrière sur M5 à 20 km | OK | OK : {"id": "1aa24219-d8b4-4248-be35-c5c713c41a2a"} | RÉUSSI |
| FL-24d | Pneu : dépose et réforme | lc | Dépose à 520 km | OK | OK : {"id": "1aa24219-d8b4-4248-be35-c5c713c41a2a", "km_parcourus": 500.0} | RÉUSSI |
| FL-24e | Historique pneu conservé (dates, km, DOT) | postgres (lecture) | 2526/500.0/2026-10-31 | 2526/500.0/2026-10-31 | 2526/500.0/2026-10-31 | RÉUSSI |
| FL-25a | Synchronisation d'une inspection saisie hors ligne | lc | Lot : M5 valide + M8 non active | OK (SYNCHRONISE,REJETE) | OK : SYNCHRONISE,REJETE | RÉUSSI |
| FL-25b | Rejeu idempotent | lc | Même lot rejoué | OK (true) | OK : true | RÉUSSI |
| FL-25c | Photos rattachées à la bonne moto après synchronisation | postgres (lecture) | 2/e82b4d37-72cc-47eb-8920-71b966d3bff4 | 2/e82b4d37-72cc-47eb-8920-71b966d3bff4 | 2/e82b4d37-72cc-47eb-8920-71b966d3bff4 | RÉUSSI |
| FL-25d | Photo d'une autre moto refusée en synchronisation | lc | Inspection de M6 avec une photo de M5 | OK (déjà enregistrée) | OK : Inspection déjà enregistrée pour ce mois et ce niveau : utilisez la correction motivé | RÉUSSI |
| FL-REG | Ancienne fonction de gravité client neutralisée | postgres (lecture) | retirée | retirée | retirée | RÉUSSI |

TOTAL : 306/306 réussis

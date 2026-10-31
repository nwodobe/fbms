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
| INV-01 | Passeport : création sans châssis inventé | abm | ABM crée moto 1 (SAKASSOU) | OK | OK : {"id": "e26d85bd-e250-42c0-b9f1-a560a6de96b2", "code": "MOTO-001", "origine": "NEUVE" | RÉUSSI |
| INV-02 | Passeport : création sans châssis inventé | abm | ABM crée moto 2 (BOTRO) | OK | OK : {"id": "cffe81c4-d954-49c6-a03d-4c047a3398e3", "code": "MOTO-002", "origine": "NEUVE" | RÉUSSI |
| INV-03 | Passeport : création sans châssis inventé | abm | ABM crée moto 3 (BROBO) | OK | OK : {"id": "73ce4595-fa98-4a3d-9223-1037f773e773", "code": "MOTO-003", "origine": "NEUVE" | RÉUSSI |
| INV-04 | Passeport : création sans châssis inventé | abm | ABM crée moto 4 (N'Djébonoua) | OK | OK : {"id": "2e95876e-fd58-4253-91fc-3274abd0b303", "code": "MOTO-004", "origine": "NEUVE" | RÉUSSI |
| INV-05 | Identifiant et QR uniques | postgres (lecture) | 4 codes et 4 jetons QR distincts | 4/4 | 4/4 | RÉUSSI |
| INV-06 | Châssis non inventé | postgres (lecture) | Châssis et immatriculation vides à la création | 4 | 4 | RÉUSSI |
| INV-07 | Statuts initiaux indépendants | postgres (lecture) | EN_ATTENTE / NON_AFFECTEE / A_CONTROLER | EN_ATTENTE/NON_AFFECTEE/A_CONTROLER | EN_ATTENTE/NON_AFFECTEE/A_CONTROLER | RÉUSSI |
| INV-08 | Unicité châssis | abm | Deux motos avec le même châssis fictif | REFUS (duplicate) | REFUS : duplicate key value violates unique constraint "moto_motos_chassis_uq" | RÉUSSI |
| INV-09 | Saisie identité M1 | abm | Châssis et immatriculation fictifs M1 | OK | OK : {"id": "e26d85bd-e250-42c0-b9f1-a560a6de96b2", "row_version": 2} | RÉUSSI |
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
| DOC-03 | Documents administratifs | abm | Carte grise M1 | OK | OK : {"id": "13826a98-9a02-4bb9-850f-cc369f7a43c2", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-04 | Documents administratifs | abm | Plaque M1 | OK | OK : {"id": "e174817c-cd7b-499e-b90a-81fbd99257f4", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-05 | Documents administratifs | abm | Assurance M1 | OK | OK : {"id": "1e54caa6-04f5-4ac6-a9e9-48c6c90aa301", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-06 | Statut administratif EN_VERIFICATION | postgres (lecture) | Documents déposés non vérifiés | EN_VERIFICATION | EN_VERIFICATION | RÉUSSI |
| DOC-07 | Auto-vérification interdite | abm | ABM vérifie son propre dépôt | REFUS (Auto-validation) | REFUS : Auto-validation interdite : un autre responsable doit vérifier ce document. | RÉUSSI |
| DOC-08 | Non conforme exige un motif | bm | BM refuse sans motif | REFUS (Motif) | REFUS : Motif obligatoire (5 caractères minimum). | RÉUSSI |
| DOC-09cg1 | Vérification par un tiers | bm | BM vérifie carte grise M1 | OK | OK : {"id": "13826a98-9a02-4bb9-850f-cc369f7a43c2", "statut": "CONFORME"} | RÉUSSI |
| DOC-09pl1 | Vérification par un tiers | bm | BM vérifie plaque M1 | OK | OK : {"id": "e174817c-cd7b-499e-b90a-81fbd99257f4", "statut": "CONFORME"} | RÉUSSI |
| DOC-09as1 | Vérification par un tiers | bm | BM vérifie assurance M1 | OK | OK : {"id": "1e54caa6-04f5-4ac6-a9e9-48c6c90aa301", "statut": "CONFORME"} | RÉUSSI |
| DOC-10 | Conformité administrative | postgres (lecture) | CONFORME après 3 documents vérifiés | CONFORME | CONFORME | RÉUSSI |
| DOC-11 | Documents administratifs | abm | Assurance expirée M2 | OK | OK : {"id": "df2f9105-c4c3-455f-a2ec-79cf4dca4e49", "statut": "EN_VERIFICATION"} | RÉUSSI |
| DOC-12 | Document expiré non conforme | bm | BM déclare conforme une assurance expirée | REFUS (expiré) | REFUS : Document expiré : il ne peut pas être déclaré conforme. | RÉUSSI |
| DOC-14 | Moto réceptionnée sans documents : non autorisée à circuler | postgres (lecture) | autorisee_a_circuler = false | f | f | RÉUSSI |
| INS-01 | Inspection : mécanicien obligatoire | abm | Inspection sans nom de mécanicien | REFUS (mécanicien) | REFUS : Nom du mécanicien et du garage obligatoires. | RÉUSSI |
| INS-02 | Anomalie critique calculée par le serveur | abm | Inspection M2 avec freins KO déclarée APTE par le client | OK | OK : {"id": "d255e42d-dccf-4b17-b3dd-a48716b7d118", "resultat": "INAPTE", "etat_reference" | RÉUSSI |
| INS-03 | Anomalie critique bloque la mise en service | postgres (lecture) | M2 IMMOBILISEE, résultat INAPTE | IMMOBILISEE/INAPTE | IMMOBILISEE/INAPTE | RÉUSSI |
| INS-04 | Inspection initiale APTE | abm | Inspection M1 APTE | OK | OK : {"id": "8eda9264-2675-491c-baab-fc97ee2e2dfc", "resultat": "APTE", "etat_reference":  | RÉUSSI |
| INS-05 | Statut technique APTE | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| AFF-01 | Préaffectation réservée au Branch Manager | abm | ABM préaffecte | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| AFF-02 | Bénéficiaire doit être Chef d'unité/zone | bm | Préaffectation à un Supervisor | REFUS (Chef) | REFUS : Le bénéficiaire doit être un Chef d'unité, un Chef de zone, l'Assistant Branch Man | RÉUSSI |
| AFF-03 | Bénéficiaire inactif refusé | bm | Préaffectation à un compte inactif | REFUS (inactif) | REFUS : Bénéficiaire introuvable ou compte inactif. | RÉUSSI |
| AFF-04 | Préaffectation | bm | BM préaffecte M1 à UH Sakassou | OK | OK : {"id": "aad3dd80-4f2b-4df3-a5c3-d1d77f1c0453", "statut_affectation": "PREAFFECTEE"} | RÉUSSI |
| AFF-05 | Une seule affectation active | bm | Seconde préaffectation de M1 | REFUS (transfert) | REFUS : Cette moto a déjà une affectation active : utilisez le transfert. | RÉUSSI |
| AFF-06 | Préaffectation M4 cluster normalisé | bm | BM préaffecte M4 à UH N'Djébonoua | OK | OK : {"id": "9475e64f-2266-41aa-a734-7870ef1d31ea", "statut_affectation": "PREAFFECTEE"} | RÉUSSI |
| AFF-07 | Cluster N'Djébonoua normalisé | postgres (lecture) | DJEBONOUA | DJEBONOUA | DJEBONOUA | RÉUSSI |
| REM-01 | PV papier numérisé et vérifié obligatoire | abm | Remise sans PV | REFUS (Procès-verbal) | REFUS : Procès-verbal signé, numérisé et vérifié CONFORME obligatoire. | RÉUSSI |
| REM-02 | Documents administratifs | abm | Dépôt du PV signé numérisé M1 | OK | OK : {"id": "3166c5f5-d36d-464e-9ef7-f00075c8c3b6", "statut": "EN_VERIFICATION"} | RÉUSSI |
| REM-03 | PV non vérifié refusé | abm | Remise avec PV non vérifié | REFUS (Procès-verbal) | REFUS : Procès-verbal signé, numérisé et vérifié CONFORME obligatoire. | RÉUSSI |
| REM-04 | Vérification PV par un tiers | bm | BM vérifie le PV | OK | OK : {"id": "3166c5f5-d36d-464e-9ef7-f00075c8c3b6", "statut": "CONFORME"} | RÉUSSI |
| REM-05 | Permis vérifié RH obligatoire | abm | Remise sans vérification du permis | REFUS (permis) | REFUS : Vérification RH du permis adapté obligatoire (catégorie et vérificateur). | RÉUSSI |
| REM-06 | Équipements de sécurité obligatoires | abm | Remise sans gilet | REFUS (GILET) | REFUS : Équipement de sécurité manquant : GILET_HAUTE_VISIBILITE. | RÉUSSI |
| REM-07 | Documents conformes obligatoires | abm | Remise de M4 (aucun document) | REFUS (non conformes) | REFUS : Remise bloquée : documents administratifs non conformes (EN_ATTENTE). | RÉUSSI |
| REM-07b | État contradictoire obligatoire (AFLP FLEET §7.B) | abm | Remise de M1 sans état contradictoire | REFUS (état contradictoire) | REFUS : Remise bloquée : état contradictoire avant remise absent, non accepté par le bénéf | RÉUSSI |
| REM-07c | État contradictoire avant remise | abm | ABM enregistre l'état de M1 avec 5 photos | OK (EN_ATTENTE) | OK : {"id": "5901f572-3e6a-4b18-8764-ece35449d42c", "anomalie_critique": false, "confirmat | RÉUSSI |
| REM-07d | Confirmation par le bénéficiaire uniquement | abm | ABM confirme à la place du bénéficiaire | REFUS (bénéficiaire) | REFUS : Seul le bénéficiaire confirme l'état contradictoire. | RÉUSSI |
| REM-07e | Bénéficiaire accepte avec réserves | uh_sak | UH Sakassou accepte avec réserve | OK (RESERVES) | OK : {"id": "5901f572-3e6a-4b18-8764-ece35449d42c", "confirmation_statut": "ACCEPTEE_AVEC_ | RÉUSSI |
| REM-08 | Remise complète | abm | ABM enregistre la remise de M1 | OK (REMISE) | OK : {"id": "c88aaecc-9530-47b6-868c-a01d68b3da26", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| REM-09 | Statut affectation REMISE, pas encore en service | postgres (lecture) | REMISE/false | REMISE/false | REMISE/false | RÉUSSI |
| MES-01 | Chef d'unité : pas de saisie avant mise en service | uh_sak | Relevé km avant mise en service | REFUS (non mise en service) | REFUS : Moto non mise en service : saisie terrain impossible. | RÉUSSI |
| MES-02 | Mise en service réservée au BM | abm | ABM met en service | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| MES-03 | Mise en service (décision distincte de la remise) | bm | BM autorise la circulation de M1 | OK | OK : {"id": "e26d85bd-e250-42c0-b9f1-a560a6de96b2", "mise_en_service": true} | RÉUSSI |
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
| KM-01 | Relevé kilométrique | uh_sak | Relevé 40 km | OK | OK : {"moto_id": "e26d85bd-e250-42c0-b9f1-a560a6de96b2", "compteur_km": 40} | RÉUSSI |
| KM-02 | Idempotence : rejeu du même relevé | uh_sak | Rejeu client_op_id identique | OK (doublon) | OK : {"statut": "SYNCHRONISE", "doublon": true, "moto_id": "e26d85bd-e250-42c0-b9f1-a560a6 | RÉUSSI |
| KM-03 | Pas de doublon en base | postgres (lecture) | 1 | 1 | 1 | RÉUSSI |
| KM-04 | Compteur décroissant refusé (conflit) | uh_sak | Relevé 30 km après 40 km | REFUS (CONFLIT_COMPTEUR) | REFUS : CONFLIT_COMPTEUR : 30 km est inférieur au relevé antérieur (40.0 km). Demandez une | RÉUSSI |
| KM-05 | Identifiant d'opération d'un autre compte | zh | ZH réutilise le client_op_id de l'UH | REFUS (autre compte) | REFUS : Identifiant d'opération déjà utilisé par un autre compte. | RÉUSSI |
| KM-06 | Chef d'unité : pas de saisie sur une moto non affectée | uh_bro | UH Brobo relève M1 | REFUS (périmètre) | REFUS : Moto hors de votre périmètre ou non affectée à votre compte. | RÉUSSI |
| CTL-01 | Contrôle avant départ APTE | uh_sak | Contrôle OK | OK (APTE) | OK : {"id": "c12982bd-083b-4019-ad80-3d9169ed3aba", "incident": null, "resultat": "APTE",  | RÉUSSI |
| CTL-02 | Contrôle : points invalides refusés | uh_sak | Contrôle sans points | REFUS (vide) | REFUS : Liste de points de contrôle vide ou invalide. | RÉUSSI |
| SYN-01 | Synchronisation par lot | uh_sak | Lot : 1 valide, 1 conflit, 1 id invalide, 1 type interdit | OK | OK : [{"statut": "SYNCHRONISE", "resultat": {"moto_id": "e26d85bd-e250-42c0-b9f1-a560a6de9 | RÉUSSI |
| SYN-02 | Statuts « Synchronisé » / « Rejeté » | uh_sak | Statuts renvoyés par opération | SYNCHRONISE,REJETE,REJETE,REJETE | SYNCHRONISE,REJETE,REJETE,REJETE | RÉUSSI |
| SYN-03 | Rejeu du lot sans doublon | uh_sak | Même lot renvoyé | OK | OK : [{"statut": "SYNCHRONISE", "doublon": true, "message": null, "resultat": {"statut": " | RÉUSSI |
| SYN-04 | Idempotence du lot | uh_sak | Le rejeu renvoie les mêmes statuts marqués doublon | [SYNCHRONISE doublon, REJETE doublon] | [('SYNCHRONISE', True), ('REJETE', True)] | RÉUSSI |
| SYN-05 | Un seul relevé 55 km en base | postgres (lecture) | 1 | 1 | 1 | RÉUSSI |
| SYN-06 | Lot limité | uh_sak | Lot de 51 opérations | REFUS (50) | REFUS : Lot limité à 50 opérations. | RÉUSSI |
| BUD-01 | Budget : Chef d'unité interdit | uh_sak | UH propose un budget | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| BUD-02 | Budget proposé par l'ABM | abm | ABM propose 30 000 FCFA (fictif) | OK (PROPOSE) | OK : {"id": "388dae0b-6bb6-4cd0-afa4-df26fae104f3", "statut": "PROPOSE"} | RÉUSSI |
| BUD-03 | Dotation impossible sans budget autorisé | abm | Remise sur budget proposé | REFUS (budget autorisé) | REFUS : Dotation impossible : aucun budget autorisé. | RÉUSSI |
| BUD-04 | Validation du budget par le BM | bm | BM valide le budget | OK (VALIDE) | OK : {"id": "388dae0b-6bb6-4cd0-afa4-df26fae104f3", "statut": "VALIDE"} | RÉUSSI |
| DOT-01 | Dotation espèces | abm | ABM remet 10 000 FCFA en espèces | OK (REMISE_DECLAREE) | OK : {"id": "ac5a11e7-14b8-4b04-a779-64e908d390de", "note": "En attente de confirmation de | RÉUSSI |
| DOT-02 | Mobile Money : référence obligatoire | abm | Mobile Money sans référence | REFUS (Référence) | REFUS : Référence de transaction Mobile Money obligatoire. | RÉUSSI |
| DOT-03 | Mobile Money : frais distincts | abm | Mobile Money 10 000 + 100 de frais | OK | OK : {"id": "7530469c-242e-4aa7-b173-f49ca2b06d8e", "note": "En attente de confirmation de | RÉUSSI |
| DOT-04 | Mobile Money échoué | abm | Mobile Money 5 000 | OK | OK : {"id": "b9601339-17be-4c29-baa3-7a2ab14f527d", "note": "En attente de confirmation de | RÉUSSI |
| DOT-05 | Dépassement de budget refusé | abm | Remise de 10 000 au-delà de 30 000 | REFUS (Dépassement) | REFUS : Dépassement du budget autorisé : 25000 déjà remis sur 30000 FCFA. | RÉUSSI |
| DOT-06 | Transaction échouée | abm | ABM déclare l'échec MM-TEST-0002 | OK (ECHOUEE) | OK : {"id": "b9601339-17be-4c29-baa3-7a2ab14f527d", "statut": "ECHOUEE"} | RÉUSSI |
| DOT-07 | Seul le bénéficiaire confirme | abm | ABM confirme à la place de l'UH | REFUS (bénéficiaire) | REFUS : Seul le bénéficiaire confirme la réception de sa dotation. | RÉUSSI |
| DOT-08 | Échec non confirmable | uh_sak | UH confirme la transaction échouée | REFUS (ECHOUEE) | REFUS : Cette dotation n'est plus en attente de confirmation (ECHOUEE). | RÉUSSI |
| DOT-09 | Confirmation de réception | uh_sak | UH confirme 10 000 espèces | OK (CONFIRMEE) | OK : {"id": "ac5a11e7-14b8-4b04-a779-64e908d390de", "statut": "CONFIRMEE", "montant_recu": | RÉUSSI |
| DOT-10 | Écart de réception = contestation | uh_sak | UH déclare 9 900 reçus sur 10 000 MM | OK (CONTESTEE) | OK : {"id": "7530469c-242e-4aa7-b173-f49ca2b06d8e", "statut": "CONTESTEE", "montant_recu": | RÉUSSI |
| CAR-01 | Plein/partiel obligatoire | uh_sak | Achat sans préciser plein | REFUS (plein) | REFUS : Préciser plein complet ou partiel. | RÉUSSI |
| CAR-02 | Carburant | uh_sak | Plein initial complet (référence) | OK | OK : {"id": "4f65e5b9-3d4a-4cc2-92f4-00c7d93108ad", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-03 | Carburant | uh_sak | Plein partiel | OK | OK : {"id": "78a2cf92-a9e2-4dae-be92-07eaea19a57c", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-04 | Carburant | uh_sak | Plein complet de contrôle | OK | OK : {"id": "3aff0620-0245-41a5-832a-bd2ddefa9efe", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| CAR-05 | Consommation plein à plein vérifiable | postgres (lecture) | 100×(1,5+2,0)/(160−60) = 3,50 L/100 km | 3.50 | 3.50 | RÉUSSI |
| CAR-06 | Plein initial non compté deux fois | postgres (lecture) | Litres de l'intervalle = 3,50 (plein initial de 3 L exclu) | 3.50 | 3.50 | RÉUSSI |
| CAR-07 | Seuils provisoires : 3,50 < 3,6 → NORMAL | postgres (lecture) | NORMAL | NORMAL | NORMAL | RÉUSSI |
| CAR-08 | Données insuffisantes → Non disponible | postgres (lecture) | M3 : l_100km NULL | NULL | NULL | RÉUSSI |
| CAR-09 | Carburant | uh_sak | Achat daté après un relevé supérieur | REFUS (CONFLIT_COMPTEUR) | REFUS : CONFLIT_COMPTEUR : 150 km est inférieur au relevé antérieur (160.0 km). Demandez u | RÉUSSI |
| CAR-10 | Carburant | uh_sak | Avance personnelle de l'agent | OK | OK : {"id": "d71a7162-ef34-465c-8ede-7cfb6f227651", "note": "Achat enregistré. Il ne vaut  | RÉUSSI |
| JUS-01 | Auto-vérification interdite | uh_sak | UH vérifie son justificatif | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| JUS-02 | Vérification des justificatifs | fin | Finance vérifie l'achat 1 | OK (VERIFIE) | OK : {"id": "4f65e5b9-3d4a-4cc2-92f4-00c7d93108ad", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-03 | Vérification des justificatifs | fin | Finance vérifie l'achat 2 | OK (VERIFIE) | OK : {"id": "78a2cf92-a9e2-4dae-be92-07eaea19a57c", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-04 | Vérification des justificatifs | fin | Finance vérifie l'achat 3 | OK (VERIFIE) | OK : {"id": "3aff0620-0245-41a5-832a-bd2ddefa9efe", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| JUS-06 | Vérification des justificatifs | fin | Finance vérifie l'achat 5 | OK (VERIFIE) | OK : {"id": "d71a7162-ef34-465c-8ede-7cfb6f227651", "justificatif_statut": "VERIFIE"} | RÉUSSI |
| RAP-01 | Rapprochement : remis / reçu / justifié / à apurer | postgres (lecture) | remis 20000 · reçu 19900 (10000 + 9900 en écart) · frais 100 · écart 100 · justifié 5525 · à apurer 14375 | 20000·19900·100·100·5525·14375 | 20000·19900·100·100·5525·14375 | RÉUSSI |
| RES-01 | Restitution > avance refusée | abm | Restitution de 20 000 | REFUS (supérieure) | REFUS : Restitution supérieure à l'avance à apurer (14375 FCFA). | RÉUSSI |
| RES-02 | Restitution d'espèces restantes | abm | Restitution de 475 | OK (13900) | OK : {"id": "c5ce63c3-81ff-48a1-9006-10dd8692842c", "solde_restant": 13900} | RÉUSSI |
| RBT-01 | Remboursement d'avance personnelle | abm | ABM demande le remboursement de l'avance | OK (2125) | OK : {"id": "dfff8182-cb65-45ab-abbb-2a3dc08fdd57", "statut": "DEMANDE", "montant": 2125} | RÉUSSI |
| RBT-02 | Pas de double remboursement | abm | Deuxième demande sur le même achat | REFUS (non encore remboursée) | REFUS : Chaque achat doit être une avance personnelle de ce bénéficiaire, justifiée VÉRIFI | RÉUSSI |
| RBT-03 | Finance simple : pas de validation | fin | Finance valide le remboursement | REFUS (Finance Manager) | REFUS : Validation réservée au Branch Manager ou au Finance Manager. | RÉUSSI |
| RBT-04 | Validation par le Finance Manager | fm | Finance Manager valide | OK (VALIDE) | OK : {"id": "dfff8182-cb65-45ab-abbb-2a3dc08fdd57", "statut": "VALIDE"} | RÉUSSI |
| RBT-05 | Paiement déclaré (non exécuté) | fin | Finance déclare le paiement MM | OK (PAYE_DECLARE) | OK : {"id": "dfff8182-cb65-45ab-abbb-2a3dc08fdd57", "statut": "PAYE_DECLARE"} | RÉUSSI |
| RAP-02 | Pas de double comptage dotation/remboursement | postgres (lecture) | reste à rembourser 0 · remboursé 2125 · à apurer 13900 | 0·2125·13900 | 0·2125·13900 | RÉUSSI |
| COR-01 | Correction : demande ABM | abm | ABM demande la correction des frais MM | OK (DEMANDEE) | OK : {"id": "ea709f8a-7250-4f75-b144-2f471f8410fe", "statut": "DEMANDEE"} | RÉUSSI |
| COR-02 | Champ non corrigeable | zh | ZH corrige un montant de dotation | REFUS (non corrigeable) | REFUS : Champ non corrigeable par votre rôle. | RÉUSSI |
| COR-03 | ABM ne valide pas une correction | abm | ABM valide sa propre correction | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| COR-04 | Validation BM | bm | BM applique la correction | OK (APPLIQUEE) | OK : {"id": "ea709f8a-7250-4f75-b144-2f471f8410fe", "statut": "APPLIQUEE"} | RÉUSSI |
| COR-05 | Valeur corrigée et journal avec valideur | postgres (lecture) | 150 / valideur BM | 150/1 | 150/1 | RÉUSSI |
| COR-06 | BM initie une correction | bm | BM demande correction compteur relevé | OK | OK : {"id": "c631b0ae-0da1-4334-b574-474c9c1e119d", "statut": "DEMANDEE"} | RÉUSSI |
| COR-07 | BM ne s'auto-approuve pas | bm | BM valide sa propre demande | REFUS (Auto-approbation) | REFUS : Auto-approbation interdite : un autre responsable doit valider. | RÉUSSI |
| COR-08 | Validation par la Direction | gm | General Manager rejette | OK (REJETEE) | OK : {"id": "c631b0ae-0da1-4334-b574-474c9c1e119d", "statut": "REJETEE"} | RÉUSSI |
| INC-01 | Anomalie critique au départ → immobilisation | uh_sak | Contrôle avant départ freins KO | OK (INAPTE) | OK : {"id": "13344a05-58cd-42f7-9c63-1883feeeae20", "incident": {"id": "ab4fb60f-64fd-483b | RÉUSSI |
| INC-02 | Moto immobilisée sans attendre | postgres (lecture) | IMMOBILISEE / non autorisée | IMMOBILISEE/false | IMMOBILISEE/false | RÉUSSI |
| INC-03 | Chef d'unité ne pilote pas le circuit | uh_sak | UH avance l'incident | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| INC-04 | Transition interdite | zh | Saut direct vers REMIS_EN_SERVICE | REFUS (Transition) | REFUS : Transition interdite : IMMOBILISEE → REMIS_EN_SERVICE. | RÉUSSI |
| INC-05 | Diagnostic | zh | ZH : diagnostic | OK | OK : {"id": "ab4fb60f-64fd-483b-ab03-e5a607bc6180", "etape": "DIAGNOSTIC"} | RÉUSSI |
| INC-06 | Autorisation de dépense : montant obligatoire | zh | Autorisation sans montant | REFUS (Montant) | REFUS : Montant estimé de la dépense obligatoire. | RÉUSSI |
| INC-07 | ABM ne peut pas autoriser la dépense | abm | ABM autorise la dépense | REFUS (réservée) | REFUS : Autorisation de dépense réservée au Branch Manager ou au Chef de Zone. | RÉUSSI |
| INC-08 | Autorisation de dépense | zh | ZH autorise 8 000 (fictif) | OK | OK : {"id": "ab4fb60f-64fd-483b-ab03-e5a607bc6180", "etape": "AUTORISATION_DEPENSE"} | RÉUSSI |
| INC-09 | Réparation | zh | ZH : réparation | OK | OK : {"id": "ab4fb60f-64fd-483b-ab03-e5a607bc6180", "etape": "REPARATION"} | RÉUSSI |
| INC-10 | Contrôle | zh | ZH : étape contrôle | OK | OK : {"id": "ab4fb60f-64fd-483b-ab03-e5a607bc6180", "etape": "CONTROLE"} | RÉUSSI |
| INC-11 | Remise en service exige un contrôle APTE | zh | Remise en service sans contrôle | REFUS (contrôle) | REFUS : Remise en service bloquée : contrôle de remise en service APTE obligatoire après l | RÉUSSI |
| INC-12 | Contrôle de remise en service | zh | ZH enregistre le contrôle APTE | OK (APTE) | OK : {"id": "e976dd3d-3aef-464e-ab20-2baa7c1081a1", "resultat": "APTE"} | RÉUSSI |
| INC-13 | Remise en service | zh | ZH remet en service | OK | OK : {"id": "ab4fb60f-64fd-483b-ab03-e5a607bc6180", "etape": "REMIS_EN_SERVICE"} | RÉUSSI |
| INC-14 | Clôture | zh | ZH clôt l'incident avec coût réel | OK | OK : {"id": "ab4fb60f-64fd-483b-ab03-e5a607bc6180", "etape": "CLOS"} | RÉUSSI |
| INC-15 | Moto de nouveau APTE | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| INC-16 | Historique complet du circuit | postgres (lecture) | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS | SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,C | RÉUSSI |
| INC-17 | Accident : registre AFLP lié (pas de doublon de saisie) | uh_sak | UH déclare un accident | OK (INC-) | OK : {"id": "64a11ced-1f80-413f-b2a8-1f2b97f972ab", "immobilisee": true, "aflp_incident_id | RÉUSSI |
| INC-18 | Incident AFLP créé et relié | postgres (lecture) | ACCIDENT_MOTO | ACCIDENT_MOTO | ACCIDENT_MOTO | RÉUSSI |
| INC-19 | Accident = immobilisation | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| INC-20 | Traçabilité : relevé km accepté pendant immobilisation | uh_sak | Relevé km pendant immobilisation | OK | OK : {"moto_id": "e26d85bd-e250-42c0-b9f1-a560a6de96b2", "compteur_km": 207} | RÉUSSI |
| MNT-01 | Demande d'entretien terrain | uh_sak | UH demande une vidange | OK (DEMANDEE) | OK : {"id": "117f1c99-16d2-4346-bd3e-f510916e812d", "statut": "DEMANDEE"} | RÉUSSI |
| MNT-02 | Autorisation par un tiers | zh | ZH autorise | OK (AUTORISEE) | OK : {"id": "117f1c99-16d2-4346-bd3e-f510916e812d", "statut": "AUTORISEE"} | RÉUSSI |
| MNT-03 | Démarrage : garage obligatoire | zh | Démarrage sans garage | REFUS (Garage) | REFUS : Garage intervenant obligatoire. | RÉUSSI |
| MNT-04 | Démarrage → immobilisation | zh | ZH démarre au garage fictif | OK | OK : {"id": "117f1c99-16d2-4346-bd3e-f510916e812d", "statut": "EN_COURS"} | RÉUSSI |
| MNT-05 | Statut EN_REPARATION | postgres (lecture) | EN_REPARATION | EN_REPARATION | EN_REPARATION | RÉUSSI |
| MNT-06 | Clôture payante sans facture refusée | zh | Fin sans facture | REFUS (Facture) | REFUS : Facture obligatoire pour clôturer une intervention payante. | RÉUSSI |
| MNT-07 | Documents administratifs | zh | ZH dépose la facture | OK | OK : {"id": "61cfe9d4-d727-4e46-ab86-f119497e924a", "statut": "EN_VERIFICATION"} | RÉUSSI |
| MNT-08 | Clôture avec facture | zh | Fin avec facture | OK (TERMINEE) | OK : {"id": "117f1c99-16d2-4346-bd3e-f510916e812d", "statut": "TERMINEE", "remise_en_servi | RÉUSSI |
| MNT-09 | Immobilisation accident toujours ouverte | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| MNT-10 | Aucune périodicité constructeur inventée | bm | Règle déclarée constructeur sans référence | REFUS (check) | REFUS : new row for relation "moto_regles_maintenance" violates check constraint "moto_reg | RÉUSSI |
| MNT-11 | Règle paramétrée ANAGROCI | bm | BM paramètre vidange 1 000 km (paramètre de test) | OK | OK : {"code": "VIDANGE"} | RÉUSSI |
| MNT-12 | Échéance calculée | postgres (lecture) | A_JOUR, prochaine à 1208 km | A_JOUR,1208.0 | A_JOUR,1208.0 | RÉUSSI |
| MNT-13 | Règles inactives par défaut | postgres (lecture) | 2 règles inactives sans intervalle | 2 | 2 | RÉUSSI |
| PNE-01 | Pneu : identité propre | abm | Entrée en stock d'un pneu fictif | OK | OK : {"id": "b77bd97f-817f-4102-acf1-fc5fb24bfe53"} | RÉUSSI |
| PNE-02 | Montage | abm | Montage arrière à 208 km | OK | OK : {"id": "b73a57bc-d380-4f9c-905d-813b5ae674b2"} | RÉUSSI |
| PNE-03a | Pneu : identité propre | abm | Entrée en stock d'un second pneu fictif | OK | OK : {"id": "e99c9436-cfae-4b0b-ad84-b572d3cef28b"} | RÉUSSI |
| PNE-03 | Un pneu par position | abm | Second pneu à la même position | REFUS (déjà monté) | REFUS : Un pneu est déjà monté à cette position : déposez-le d'abord. | RÉUSSI |
| PNE-04 | Réparation tracée | zh | Réparation crevaison | OK | OK : {"id": "b93f8c40-3be1-4ae3-846e-8e266fe3134a"} | RÉUSSI |
| PNE-05 | Dépose et réforme | abm | Dépose à 708 km, réforme | OK (500) | OK : {"id": "b73a57bc-d380-4f9c-905d-813b5ae674b2", "km_parcourus": 500.0} | RÉUSSI |
| PNE-06 | Coût par km sur données réelles | postgres (lecture) | (12000+1000)/500 = 26.00 FCFA/km | 26.00 | 26.00 | RÉUSSI |
| KPI-01 | Disponibilité : dénominateur présent | postgres (lecture) | taux calculé (non NULL) | true | true | RÉUSSI |
| KPI-02 | Disponibilité : moto non en service → absente (Non disponible) | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| KPI-03 | Coût/km : dotations et remboursements exclus | postgres (lecture) | carburant vérifié 7650 + maintenance 5000 + pneus 13000 + incident 8000 | 7650+5000+13000+8000 | 7650+5000+13000+8000 | RÉUSSI |
| FOR-01 | Formation : résultat | uh_sak | UH réussit un quiz 4/5 | OK (true) | OK : {"id": "50ef919b-e970-46be-89e2-6561351f09e2", "reussi": true} | RÉUSSI |
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
| FL-03a | Enregistrement d'une moto neuve par le coordinateur | lc | Coordinateur crée M5 (Brobo) réceptionnée | OK | OK : {"id": "1c0e982e-5e9f-4577-8327-04999e1b0c01", "code": "MOTO-005", "origine": "NEUVE" | RÉUSSI |
| FL-03b | Réception : date effective obligatoire | lc | Moto neuve réceptionnée sans date | REFUS (Date de réception) | REFUS : Date de réception effective obligatoire (sinon : acquisition prévue). | RÉUSSI |
| FL-03c | Photo principale : réservée BM/ABM/coordinateur | uh_bro | Chef d'unité définit la photo principale | REFUS | REFUS : Moto hors de votre périmètre. | RÉUSSI |
| FL-03d | Photo principale enregistrée | lc | Coordinateur enregistre la photo principale de M5 | OK (true) | OK : {"id": "2847d625-4cc0-47a7-8e04-e07c9784f94d", "principale": true} | RÉUSSI |
| FL-03e | Photo visible au passeport (vue flotte) | postgres (lecture) | 1c0e982e-5e9f-4577-8327-04999e1b0c01/photo/fed1898f-869f-4e77-a309-b05f1505a443.jpg | 1c0e982e-5e9f-4577-8327-04999e1b0c01/photo/fed1898f-869f-4e77-a309-b05f1505a443.jpg | 1c0e982e-5e9f-4577-8327-04999e1b0c01/photo/fed1898f-869f-4e77-a309-b05f1505a443.jpg | RÉUSSI |
| FL-03f | Photo : fichier d'une autre moto refusé | lc | Photo de M1 rattachée à M5 | REFUS (non conforme) | REFUS : Chemin de fichier non conforme pour cette moto. | RÉUSSI |
| FL-04a | Photo accessible après reconnexion (compte autorisé) | bm | BM lit l'objet photo de M5 | OK (1) | OK : 1 | RÉUSSI |
| FL-04b | Photo protégée hors périmètre | uh_bot | UH Botro lit la photo de M5 | OK (0) | OK : 0 | RÉUSSI |
| FL-05a | Documents : anonyme refusé | anon | Anonyme lit les objets | REFUS (permission) | REFUS : permission denied for table objects | RÉUSSI |
| FL-05b | Galerie photo protégée | uh_bot | UH Botro lit la galerie de M5 | OK (0) | OK : 0 | RÉUSSI |
| FL-05c | Bucket toujours privé | postgres (lecture) | f | f | f | RÉUSSI |
| FL-06a | Intégration d'une moto en exploitation sans marque connue | lc | Coordinateur intègre la moto du Chef de zone (marque inconnue) | OK (EN_EXPLOITATION) | OK : {"id": "742980d5-a432-48f7-a946-4d12eb8a2f37", "code": "MOTO-006", "origine": "EN_EXP | RÉUSSI |
| FL-06b | Inconnu = Non disponible (NULL), jamais zéro | postgres (lecture) | t | t | t | RÉUSSI |
| FL-07a | Aucune vidange ni dépense passée inventée | postgres (lecture) | 0/0/0 | 0/0/0 | 0/0/0 | RÉUSSI |
| FL-06c | État de référence : inventaire photo exigé | lc | Référence sans photos | REFUS (Photos insuffisantes) | REFUS : Photos insuffisantes : 5 exigée(s), 0 fournie(s). | RÉUSSI |
| FL-06d | État de référence : compteur exigé | lc | Référence sans compteur | REFUS (compteur) | REFUS : État de référence : relevé du compteur obligatoire. | RÉUSSI |
| FL-06e | État technique de référence par un intervenant qualifié | lc | Référence complète, anomalie éclairage existante | OK (etat_reference": true) | OK : {"id": "065c5b5c-adae-46fb-b631-f9d7b5e948c8", "resultat": "APTE", "etat_reference":  | RÉUSSI |
| FL-06f | Début du suivi fiable = date de l'état de référence ; anomalie existante identifiée | postgres (lecture) | 2026-10-31/1/APTE | 2026-10-31/1/APTE | 2026-10-31/1/APTE | RÉUSSI |
| FL-07b | Coûts : aucune dépense historique créée | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| FL-15a | Acquisition prévue | lc | Moto prévue pour le 2e Chef de zone | OK (PREVUE) | OK : {"id": "73c89d77-6019-4621-99cb-d2ec5983cfea", "code": "MOTO-007", "origine": "NEUVE" | RÉUSSI |
| FL-15b | Prévue : pas de compteur inventé | lc | Moto prévue avec compteur | REFUS (ni date) | REFUS : Une acquisition prévue n'a ni date de réception ni compteur. | RÉUSSI |
| FL-15c | Prévue : aucune affectation | bm | BM préaffecte la moto prévue | REFUS (réception) | REFUS : Acquisition prévue : aucune affectation avant la réception physique. | RÉUSSI |
| FL-15d | Prévue : aucune inspection | lc | Inspection d'une moto prévue | REFUS (réceptionnée) | REFUS : Moto non réceptionnée : enregistrez d'abord la réception. | RÉUSSI |
| FL-15e | Prévue : jamais comptée opérationnelle | postgres (lecture) | PREVUE/false/false | PREVUE/false/false | PREVUE/false/false | RÉUSSI |
| FL-15f | Réception physique : kilométrage obligatoire | lc | Réception sans compteur | REFUS (Kilométrage) | REFUS : Kilométrage à la réception obligatoire. | RÉUSSI |
| FL-18a | Moto de test M7 | lc | Coordinateur crée M7 | OK | OK : {"id": "c26c71b7-d634-4ce5-93eb-e769dd9766a3", "code": "MOTO-008", "origine": "NEUVE" | RÉUSSI |
| FL-18b | Code de point inconnu rejeté | lc | Inspection avec un code inventé | REFUS (inconnu) | REFUS : Point de contrôle inconnu pour ce contrôle : BIDON. | RÉUSSI |
| FL-18c | Code dupliqué rejeté | lc | Inspection avec un point en double | REFUS (double) | REFUS : Point de contrôle en double : FREIN_AVANT. | RÉUSSI |
| FL-18d | Point obligatoire omis rejeté | lc | Inspection sans le point freins avant | REFUS (obligatoires) | REFUS : Points obligatoires non renseignés : Frein avant efficace. | RÉUSSI |
| FL-18e | Champ « critique » falsifié par le client : règle serveur maintenue | lc | Freins KO envoyés critique=false, résultat APTE | OK ("anomalie_critique": true) | OK : {"id": "b9c1bda2-2cb7-4c45-bca1-5a9c49a58a9e", "resultat": "INAPTE", "etat_reference" | RÉUSSI |
| FL-17a | Anomalie critique → immobilisation persistante | postgres (lecture) | IMMOBILISEE/INAPTE/CRITIQUE | IMMOBILISEE/INAPTE/CRITIQUE | IMMOBILISEE/INAPTE/CRITIQUE | RÉUSSI |
| FL-18f | Gravité enregistrée = catalogue (pas la valeur client) | postgres (lecture) | true | true | true | RÉUSSI |
| FL-18g | Contrôle départ : critique falsifié | uh_sak | Départ M1 freins KO critique=false | OK ("anomalie_critique": true) | OK : {"id": "4d9eeda3-94f5-4c3d-9680-aae03a886d51", "incident": {"id": "fddf7e51-2201-466b | RÉUSSI |
| FL-20a | Remise en service : le coordinateur ne lève pas seul | lc | Coordinateur lève l'immobilisation | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-20b | Contrôle de remise en service par le coordinateur | lc | Contrôle APTE après réparation | OK (APTE) | OK : {"id": "87669ce8-8b0b-40bb-837d-6e66f2c2ffa0", "resultat": "APTE"} | RÉUSSI |
| FL-20c | Levée bloquée tant que l'anomalie n'est pas vérifiée | bm | BM lève avant clôture de l'action | REFUS (anomalie critique) | REFUS : Levée bloquée : une anomalie critique n'est pas encore corrigée et vérifiée. | RÉUSSI |
| FL-20d | Planification de l'action | lc | Coordinateur planifie (garage, devis, date cible) | OK (PLANIFIEE) | OK : {"id": "857d2fb4-91e7-4b94-ba55-54668b49530d", "statut": "PLANIFIEE"} | RÉUSSI |
| FL-20e | Réalisation : justificatif exigé si dépense | lc | Réalisation payante sans facture | REFUS (justificatif) | REFUS : Facture ou justificatif obligatoire pour une dépense. | RÉUSSI |
| FL-20f | Réalisation avec facture | lc | Réalisation avec facture fictive | OK (REALISEE) | OK : {"id": "857d2fb4-91e7-4b94-ba55-54668b49530d", "statut": "REALISEE"} | RÉUSSI |
| FL-20g | Vérification par un tiers uniquement | lc | Le coordinateur vérifie son propre travail | REFUS (Séparation) | REFUS : Séparation des tâches : la personne qui a réalisé ne vérifie pas son propre travai | RÉUSSI |
| FL-20h | Vérification après réparation | zh | Chef de zone vérifie et clôt | OK (CLOTUREE) | OK : {"id": "857d2fb4-91e7-4b94-ba55-54668b49530d", "statut": "CLOTUREE"} | RÉUSSI |
| FL-20i | Levée : auteur du contrôle ≠ décideur | bm | BM lève l'immobilisation (contrôle fait par le coordinateur) | OK (true) | OK : {"id": "732b7d6d-a5ce-41ac-b9ba-0ed3587d202d", "levee": true} | RÉUSSI |
| FL-20j | Clôture vérifiée ; moto neuve à nouveau « à contrôler » (pas d'aptitude automatique) | postgres (lecture) | CLOTUREE/A_CONTROLER | CLOTUREE/A_CONTROLER | CLOTUREE/A_CONTROLER | RÉUSSI |
| FL-20k | Nouvelle inspection mécanique après réparation | abm | Inspection initiale APTE de M7 | OK (APTE) | OK : {"id": "54131935-b3e6-44dd-b00a-61afd5de68f2", "resultat": "APTE", "etat_reference":  | RÉUSSI |
| FL-20l | Moto apte après preuve de correction | postgres (lecture) | APTE | APTE | APTE | RÉUSSI |
| FL-09a | Moto M8 (Botro) | lc | Coordinateur crée M8 | OK | OK : {"id": "03fd524a-7df1-4f79-a219-6063b7514271", "code": "MOTO-009", "origine": "NEUVE" | RÉUSSI |
| FL-SVC-M5 | Chaîne de remise complète (PV + état contradictoire distincts) | abm | Remise de la moto M5 | OK (REMISE) | OK : {"id": "429e4a5a-d4d2-4386-a80b-712a76db1411", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| FL-MES-M5 | Mise en service distincte | bm | Mise en service M5 | OK | OK : {"id": "1c0e982e-5e9f-4577-8327-04999e1b0c01", "mise_en_service": true} | RÉUSSI |
| FL-09b | PV de remise ≠ inspection mécanique ≠ état contradictoire | postgres (lecture) | t | t | t | RÉUSSI |
| FL-16 | Mise en service en cours de mois : aucune inspection rétroactive exigée | postgres (lecture) | 0 | 0 | 0 | RÉUSSI |
| FL-13a | Moto M9 (ABM) | lc | Moto pour l'ABM | OK | OK : {"id": "9a5f9f8a-f6a6-4bfe-9b3b-0c420aadc395", "code": "MOTO-010", "origine": "NEUVE" | RÉUSSI |
| FL-13b | Moto M10 (coordinateur) | bm | Moto du coordinateur | OK | OK : {"id": "26484855-1fe0-4b8f-8274-ec22e250e892", "code": "MOTO-011", "origine": "NEUVE" | RÉUSSI |
| FL-SVC-M6 | Chaîne de remise complète (PV + état contradictoire distincts) | abm | Remise de la moto M6 | OK (REMISE) | OK : {"id": "61f36039-5d0b-41d0-8eab-d13031e7beaf", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| FL-MES-M6 | Mise en service distincte | bm | Mise en service M6 | OK | OK : {"id": "742980d5-a432-48f7-a946-4d12eb8a2f37", "mise_en_service": true} | RÉUSSI |
| FL-SVC-M9 | Chaîne de remise complète (PV + état contradictoire distincts) | lc | Remise de la moto M9 | OK (REMISE) | OK : {"id": "3cdd1c3e-22b3-493f-a173-7302b759f5ae", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| FL-MES-M9 | Mise en service distincte | bm | Mise en service M9 | OK | OK : {"id": "9a5f9f8a-f6a6-4bfe-9b3b-0c420aadc395", "mise_en_service": true} | RÉUSSI |
| FL-13g | Moto de l'ABM : remise enregistrée par un tiers (coordinateur), jamais par le bénéficiaire | postgres (lecture) | 00000000-0000-4000-8000-000000000020 | 00000000-0000-4000-8000-000000000020 | 00000000-0000-4000-8000-000000000020 | RÉUSSI |
| FL-SVC-M10 | Chaîne de remise complète (PV + état contradictoire distincts) | abm | Remise de la moto M10 | OK (REMISE) | OK : {"id": "2d2f7a05-7010-4f84-b9c7-8714ee7e61c8", "note": "Remise enregistrée. L'autoris | RÉUSSI |
| FL-MES-M10 | Mise en service distincte | bm | Mise en service M10 | OK | OK : {"id": "26484855-1fe0-4b8f-8274-ec22e250e892", "mise_en_service": true} | RÉUSSI |
| FL-14a | Moto du coordinateur : contrôle indépendant exigé, pas de COORDINATION | postgres (lecture) | INDEPENDANTE | INDEPENDANTE | INDEPENDANTE | RÉUSSI |
| FL-13c | Moto du Chef de zone : COORDINATION uniquement (pas de niveau ZONE) | postgres (lecture) | COORDINATION | COORDINATION | COORDINATION | RÉUSSI |
| FL-13d | Coordinateur inspecte la moto d'un Chef d'unité | lc | COORDINATION sur M1 | OK (COORDINATION) | OK : {"id": "29b21b2c-fa2e-49d7-ad05-0a2aab30a61b", "niveau": "COORDINATION", "periode": " | RÉUSSI |
| FL-13e | Coordinateur inspecte la moto du Chef de zone | lc | COORDINATION sur M6 | OK (COORDINATION) | OK : {"id": "98ba61cc-b278-4411-93b8-99af15f8a154", "niveau": "COORDINATION", "periode": " | RÉUSSI |
| FL-13f | Coordinateur inspecte la moto de l'ABM (anomalie critique) | lc | COORDINATION sur M9, pneus KO | OK (NON_CONFORME) | OK : {"id": "2322b0cc-3eab-4fae-9298-a01e20d1f089", "niveau": "COORDINATION", "periode": " | RÉUSSI |
| FL-17b | Inspection mensuelle critique → immobilisation immédiate | postgres (lecture) | IMMOBILISEE | IMMOBILISEE | IMMOBILISEE | RÉUSSI |
| FL-14b | Coordinateur : pas d'inspection de sa propre moto | lc | COORDINATION sur M10 | REFUS (propre moto) | REFUS : Indépendance : vous ne pouvez pas réaliser l'inspection mensuelle de votre propre  | RÉUSSI |
| FL-14c | Coordinateur : pas d'auto-contrôle indépendant | lc | INDEPENDANTE sur M10 | REFUS (propre moto) | REFUS : Indépendance : vous ne pouvez pas réaliser l'inspection mensuelle de votre propre  | RÉUSSI |
| FL-14d | Contrôle indépendant : inspecteur désigné requis | zh2 | Chef de zone non désigné, INDEPENDANTE sur M10 | REFUS (désigné) | REFUS : Contrôle indépendant réservé au BM, à l'ABM ou à un inspecteur désigné par ANAGROC | RÉUSSI |
| FL-14e | Désignation d'un inspecteur indépendant par le BM | bm | BM désigne ZH2 | OK | OK : {"cle": "inspecteurs_independants"} | RÉUSSI |
| FL-14f | Contrôle indépendant de la moto du coordinateur | zh2 | ZH2 désigné, INDEPENDANTE sur M10 | OK (INDEPENDANTE) | OK : {"id": "6bc2bd82-1d93-4617-9a4b-c36fced1c60f", "niveau": "INDEPENDANTE", "periode": " | RÉUSSI |
| FL-14g | Rapport d'un mécanicien externe saisi par un tiers autorisé | bm | Second contrôle indépendant du mois refusé (doublon) | REFUS (déjà enregistrée) | REFUS : Inspection déjà enregistrée pour ce mois et ce niveau : utilisez la correction mot | RÉUSSI |
| FL-10 | Chef de zone inspecte une moto de Chef d'unité de sa zone | zh | ZONE sur M1 (Sakassou, GBEKE 1), éclairage KO | OK ("dans_delai": false) | OK : {"id": "d88a5b8b-5641-47d2-a801-d4ec0abd3513", "niveau": "ZONE", "periode": "2026-10- | RÉUSSI |
| FL-12 | Inspection du Chef de zone après le 15 : tardive | postgres (lecture) | EFFECTUEE_HORS_DELAI | EFFECTUEE_HORS_DELAI | EFFECTUEE_HORS_DELAI | RÉUSSI |
| FL-11a | Chef de zone : pas d'écriture hors de sa zone | zh | ZH (GBEKE 1) demande un entretien sur M8 (Botro, GBEKE 2) | REFUS (périmètre) | REFUS : Moto hors de votre périmètre ou non affectée à votre compte. | RÉUSSI |
| FL-11b | Chef de zone : pas d'inspection hors de sa zone | zh2 | ZH2 (GBEKE 2) inspecte M1 (GBEKE 1) | REFUS (zone) | REFUS : Moto hors de votre zone de responsabilité. | RÉUSSI |
| FL-11c | Chef de zone : lecture globale conservée | zh | ZH lit M8 | OK (1) | OK : 1 | RÉUSSI |
| FL-11d | Chef de zone sans zone renseignée : refus explicite | zh_sz | ZH sans zone inspecte M1 | REFUS (Zone de responsabilité) | REFUS : Zone de responsabilité non renseignée sur votre profil FBMS : demandez au Branch M | RÉUSSI |
| FL-11e | Chef de zone : ne fait pas l'inspection d'un ABM | zh | ZONE sur M9 (ABM) | REFUS (Chefs d'unité) | REFUS : Le Chef de zone inspecte les motos des Chefs d'unité de sa zone. | RÉUSSI |
| FL-12b | Aucune inspection rétroactive (date antérieure) | zh | ZONE datée de 10 jours | REFUS (3 jours) | REFUS : Saisie différée limitée à 3 jours : au-delà, utilisez une correction motivée. | RÉUSSI |
| FL-19a | Doublon artificiel refusé | zh | Seconde inspection ZONE de M1 ce mois | REFUS (déjà enregistrée) | REFUS : Inspection déjà enregistrée pour ce mois et ce niveau : utilisez la correction mot | RÉUSSI |
| FL-19b | Visite effectuée ≠ conforme : anomalie ouverte maintenue | lc | Le coordinateur ne peut pas refaire COORDINATION sur M1 (déjà faite) | REFUS (déjà enregistrée) | REFUS : Inspection déjà enregistrée pour ce mois et ce niveau : utilisez la correction mot | RÉUSSI |
| FL-19c | Correction motivée (piste d'audit) | zh | ZH corrige son inspection, tout OK cette fois | OK (RESERVES) | OK : {"id": "fbd92be9-67f7-495c-83a8-566b6ed81548", "niveau": "ZONE", "periode": "2026-10- | RÉUSSI |
| FL-19d | Anomalie non corrigée reste ouverte à l'inspection suivante (pas de doublon) | postgres (lecture) | 1/1 | 1/1 | 1/1 | RÉUSSI |
| FL-19e | Version corrigée conservée | postgres (lecture) | 1/1 | 1/1 | 1/1 | RÉUSSI |
| FL-21a | Enveloppe de supervision demandée | lc | Coordinateur demande 50 000 (fictif) | OK (DEMANDEE) | OK : {"id": "be7941d8-a89a-4b0a-b75d-027e0553ab29", "statut": "DEMANDEE"} | RÉUSSI |
| FL-21b | Pas d'auto-approbation | lc | Coordinateur approuve sa propre enveloppe | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-21c | Approbation partielle motivée par le BM | bm | BM approuve 40 000 | OK (APPROUVEE) | OK : {"id": "be7941d8-a89a-4b0a-b75d-027e0553ab29", "statut": "APPROUVEE"} | RÉUSSI |
| FL-21d | Dépense déclarée sur l'enveloppe | lc | Dépense 30 000 sans justificatif | OK (DECLAREE) | OK : {"id": "03981a7d-bf29-4b84-8f10-8279b3c60360", "statut": "DECLAREE"} | RÉUSSI |
| FL-21e | Dépassement refusé | lc | Dépense 20 000 au-delà du solde | REFUS (solde) | REFUS : Dépassement de l'enveloppe : solde disponible 10000 FCFA. | RÉUSSI |
| FL-21f | Justificatif d'un autre compte refusé | lc | Chemin de justificatif du BM | REFUS (non conforme) | REFUS : Chemin de justificatif non conforme (depenses/<votre compte>/…). | RÉUSSI |
| FL-21g | Justificatif ajouté | lc | Coordinateur ajoute son justificatif | OK (JUSTIFIEE) | OK : {"id": "03981a7d-bf29-4b84-8f10-8279b3c60360", "statut": "JUSTIFIEE"} | RÉUSSI |
| FL-21h | Le coordinateur ne valide pas ses dépenses | lc | Coordinateur valide sa dépense | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-21i | Validation par un tiers habilité | abm | ABM valide | OK (VALIDEE) | OK : {"id": "03981a7d-bf29-4b84-8f10-8279b3c60360", "statut": "VALIDEE"} | RÉUSSI |
| FL-21j | Enveloppe : demandé / approuvé / consommé / justifié / solde | postgres (lecture) | 50000/40000/30000/30000/10000 | 50000/40000/30000/30000/10000 | 50000/40000/30000/30000/10000 | RÉUSSI |
| FL-21k | Enveloppes : Chef d'unité sans accès | uh_sak | UH lit les enveloppes | OK (0) | OK : 0 | RÉUSSI |
| FL-LC1 | Coordinateur : pas de mise en service | lc | Mise en service de M8 | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-LC2 | Coordinateur : pas de décision de dépense de maintenance | lc | Décision maintenance | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-LC3 | Coordinateur : pas d'accès aux dotations Finance | lc | Lecture des dotations | OK (0) | OK : 0 | RÉUSSI |
| FL-LC4 | Coordinateur : pas de modification des paramètres | lc | Modifie un paramètre | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-LC5 | Coordinateur : pas de préaffectation | lc | Préaffecte M8 | REFUS (rôle) | REFUS : Votre rôle ne permet pas cette opération Moto Manager. | RÉUSSI |
| FL-LC6 | Coordinateur : voit tout le parc | lc | Lecture flotte | OK (t) | OK : t | RÉUSSI |
| FL-LC7 | Coordinateur : demande d'entretien possible | lc | Demande de vidange sur M8 | OK (DEMANDEE) | OK : {"id": "de1a30e7-6368-49fc-9c79-a81494fed336", "statut": "DEMANDEE"} | RÉUSSI |
| FL-22 | Coût/km : kilomètres comptés depuis le suivi fiable, jamais depuis 0 (historique exclu) | postgres (lecture) | t | t | t | RÉUSSI |
| FL-23 | L/100 km non calculé sans pleins complets | postgres (lecture) | null | null | null | RÉUSSI |
| FL-24a | Pneu : marquage DOT invalide refusé | lc | Date de fabrication « 26 » | REFUS (DOT) | REFUS : Date de fabrication : 4 chiffres du marquage DOT (semaine + année, ex. 2526), ou v | RÉUSSI |
| FL-24b | Pneu : identité complète | lc | Coordinateur entre un pneu | OK | OK : {"id": "aeae9241-9ece-4bb4-96de-df209bce4eaf"} | RÉUSSI |
| FL-24c | Pneu : pose | lc | Pose arrière sur M5 à 20 km | OK | OK : {"id": "e5a1b33d-bef1-41b2-b87b-1ec4806d7ecc"} | RÉUSSI |
| FL-24d | Pneu : dépose et réforme | lc | Dépose à 520 km | OK | OK : {"id": "e5a1b33d-bef1-41b2-b87b-1ec4806d7ecc", "km_parcourus": 500.0} | RÉUSSI |
| FL-24e | Historique pneu conservé (dates, km, DOT) | postgres (lecture) | 2526/500.0/2026-10-31 | 2526/500.0/2026-10-31 | 2526/500.0/2026-10-31 | RÉUSSI |
| FL-25a | Synchronisation d'une inspection saisie hors ligne | lc | Lot : M5 valide + M8 non active | OK (SYNCHRONISE,REJETE) | OK : SYNCHRONISE,REJETE | RÉUSSI |
| FL-25b | Rejeu idempotent | lc | Même lot rejoué | OK (true) | OK : true | RÉUSSI |
| FL-25c | Photos rattachées à la bonne moto après synchronisation | postgres (lecture) | 2/1c0e982e-5e9f-4577-8327-04999e1b0c01 | 2/1c0e982e-5e9f-4577-8327-04999e1b0c01 | 2/1c0e982e-5e9f-4577-8327-04999e1b0c01 | RÉUSSI |
| FL-25d | Photo d'une autre moto refusée en synchronisation | lc | Inspection de M6 avec une photo de M5 | OK (déjà enregistrée) | OK : Inspection déjà enregistrée pour ce mois et ce niveau : utilisez la correction motivé | RÉUSSI |
| FL-REG | Ancienne fonction de gravité client neutralisée | postgres (lecture) | retirée | retirée | retirée | RÉUSSI |
| RV-01 | Revue : un Chef d'unité portant la fonction « coordinateur » reste Chef d'unité | postgres (lecture) | UNITE | UNITE | UNITE | RÉUSSI |
| RV-02a | Revue : l'utilisateur ne fait pas le contrôle de remise en service de sa moto | zh | ZH contrôle sa propre moto M6 | REFUS (Indépendance) | REFUS : Indépendance : le contrôle de remise en service ne peut pas être fait par l'utilis | RÉUSSI |
| RV-02b | Revue : le coordinateur ne contrôle pas sa propre moto | lc | Coordinateur, remise en service de M10 | REFUS (Indépendance) | REFUS : Indépendance : le contrôle de remise en service ne peut pas être fait par l'utilis | RÉUSSI |
| RV-02c | Revue : l'utilisateur ne vérifie pas la réparation de sa propre moto | zh | ZH vérifie l'action de M6 | REFUS (Indépendance) | REFUS : Indépendance : la vérification d'une réparation ne peut pas être fait par l'utilis | RÉUSSI |
| RV-02d | Revue : incident sur sa moto | zh | ZH déclare un incident majeur sur M6 | OK | OK : {"id": "953be006-c1d2-46fc-85b8-c4ca4e2755e4", "immobilisee": false, "aflp_incident_i | RÉUSSI |
| RV-02e | Revue : l'utilisateur ne pilote pas le circuit incident de sa moto | zh | ZH avance l'incident de sa propre moto | REFUS (Indépendance) | REFUS : Indépendance : cette étape ne peut pas être fait par l'utilisateur de la moto. | RÉUSSI |
| RV-03 | Revue : une anomalie critique ne s'annule pas | bm | BM annule l'anomalie critique de M9 | REFUS (ne s'annule pas) | REFUS : Une anomalie critique ne s'annule pas : elle se clôt par une vérification après co | RÉUSSI |
| RV-04 | Revue : justificatifs d'autrui illisibles pour le coordinateur | lc | Coordinateur lit un justificatif du BM | OK (0) | OK : 0 | RÉUSSI |
| RV-04b | Revue : le BM lit les justificatifs du coordinateur | bm | BM lit le justificatif du coordinateur | OK (1) | OK : 1 | RÉUSSI |
| RV-05a | Revue : une seule photo citée pour plusieurs vues refusée | lc | Même fichier pour COMPTEUR et AVANT | REFUS (déjà utilisée) | REFUS : Photo déjà utilisée : chaque vue exige un fichier distinct. | RÉUSSI |
| RV-05b | Revue : photo d'un contrôle antérieur refusée | lc | Photos d'une inspection précédente réutilisées | REFUS (déjà utilisée) | REFUS : Photo déjà utilisée : chaque vue exige un fichier distinct. | RÉUSSI |
| RV-06 | Revue : un justificatif ne justifie qu'une dépense | lc | Seconde dépense avec la même facture | REFUS (duplicate) | REFUS : duplicate key value violates unique constraint "moto_depenses_justificatif_unique" | RÉUSSI |

TOTAL : 318/318 réussis

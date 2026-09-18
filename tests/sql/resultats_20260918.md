# Résultats tests serveur — lot 1 Sacherie (18/09/2026)

Réplique LOCALE PostgreSQL 16 (production : 17). 49 fonctions vérifiées identiques à la production (md5 de prosrc). Chaque action est exécutée SOUS `authenticated` avec l'identité JWT du compte fictif (RLS active). Colonne *avant* = état de production reproduit ; *après* = migrations 20260918a/b/c. Les écarts *avant* en cascade (ex. W13) découlent des failles exploitées plus haut dans la même séquence.

| Test | Compte | Action | Attendu | Obtenu fbms_avant | Obtenu fbms_apres |
|---|---|---|---|---|---|
| A01 | bm | BM attribue un role reconnu (Storekeeper + cluster Botro) a un compte a qualifier | OK=1 | CONFORME — OK 1 | CONFORME — OK 1 |
| A02 | bm | BM tente un libelle non reconnu par le serveur ('Warehouse Keeper') | REFUS | CONFORME — REFUS : new row for relation "profils" violates check constraint "profils_role_check" | CONFORME — REFUS : new row for relation "profils" violates check constraint "profils_role_check" |
| A03 | uh_botro | Unit Head tente de se donner le role Branch Manager (appel API direct) | OK=0 | CONFORME — OK 0 | CONFORME — OK 0 |
| A04 | uh_botro | Unit Head tente d'elargir son perimetre (authority_level GLOBAL) | OK=0 | CONFORME — OK 0 | CONFORME — OK 0 |
| A07 | bm | BM saisit un cluster inconnu | REFUS | ÉCART — OK 1 ligne(s) | CONFORME — REFUS : Cluster « BOUAKE-X » inconnu du référentiel AFLP |
| A07b | bm | Changement d'affectation : aucun mouvement de stock cree | OK=0 | CONFORME — OK 0 | CONFORME — OK 0 |
| A08 | bm | Referentiel des roles attribuables lisible par le BM | OK=17 | ÉCART — REFUS : function public.fbms_roles_attribuables() does not exist | CONFORME — OK 17 |
| A09 | uh_botro | Referentiel des roles refuse a un non-BM | REFUS | CONFORME — REFUS : function public.fbms_roles_attribuables() does not exist | CONFORME — REFUS : Réservé au Branch Manager actif |
| A10 | bm | Journal : le changement A01 est trace (auteur, avant/apres) | OK=1 | ÉCART — OK 0 | CONFORME — OK 1 |
| P01 | sk_botro | Magasinier affecte (Botro) realise un inventaire sur son cluster | OK=PASS | ÉCART — REFUS : Accès refusé | CONFORME — OK PASS |
| P02 | sk_botro | Meme magasinier inventorie un emplacement d'un autre cluster (Diabo) | REFUS | CONFORME — REFUS : Accès refusé | CONFORME — REFUS : Localisation hors périmètre cluster : DIABO n'est pas votre cluster (BOTRO) |
| P03 | sk_sans | Magasinier SANS affectation tente une ecriture | REFUS | CONFORME — REFUS : Accès refusé | CONFORME — REFUS : Affectation manquante : aucun cluster valide n'est rattaché à ce compte (rôle « Storekeeper », valeur saisie « vide »). Le Branch Manager doit |
| P04 | fo_sans | Compte Supervisor + fonction_operationnelle 'Warehouse Keeper' sans cluster ecrit sur Diabo | REFUS | ÉCART — OK PASS | CONFORME — REFUS : Accès refusé : le rôle « Supervisor » ne permet pas de mouvementer des sacs sur cet emplacement |
| P05 | sk_global | Magasinier a portee globale EXPLICITE (authority_level GLOBAL) inventorie Diabo | OK=PASS | ÉCART — REFUS : Accès refusé | CONFORME — OK PASS |
| P06 | sk_inactif | Compte inactif tente un inventaire | REFUS | CONFORME — REFUS : Profil actif requis | CONFORME — REFUS : Profil actif requis : compte désactivé ou sans profil |
| P07 | sk_botro | Magasinier ecrit sur un emplacement sans cluster (usine) | REFUS | CONFORME — REFUS : Accès refusé | CONFORME — REFUS : Localisation hors périmètre cluster : cible sans cluster AFLP (« aucun »), réservée aux comptes à portée globale |
| P08 | zh | Zonal Head tente une ecriture physique (inventaire) | REFUS | CONFORME — REFUS : Accès refusé | CONFORME — REFUS : Le Zonal Head contrôle mais ne mouvemente pas physiquement les sacs |
| P09 | zh | Zonal Head consulte le cockpit : tous les clusters (portee globale) | OK=2 | ÉCART — REFUS : Accès Control Tower non autorisé | CONFORME — OK 2 |
| P10 | sk_botro | Magasinier Botro consulte le cockpit : son cluster seulement | OK=1 | ÉCART — REFUS : Accès Control Tower non autorisé | CONFORME — OK 1 |
| P11 | sk_botro | Lecture directe (RLS) du stock cluster par le magasinier Botro | OK=1 | ÉCART — OK 0 | CONFORME — OK 1 |
| P12 | uh_botro | Unit Head Botro : retour RT -> cluster (mouvement reseau) | OK=10 | ÉCART — REFUS : Accès refusé | CONFORME — OK 10 |
| P13 | uh_botro | Meme operation rejouee avec la meme cle (idempotence) | OK=10 | ÉCART — REFUS : Accès refusé | CONFORME — OK 10 |
| P14 | bm | Controle : une seule ligne canonique pour la cle T-NET-1 | OK=1 | ÉCART — OK 0 | CONFORME — OK 1 |
| P15 | uh_diabo | Unit Head Diabo tente un mouvement reseau sur un RT de Botro | REFUS | CONFORME — REFUS : Accès refusé | CONFORME — REFUS : Localisation hors périmètre cluster : BOTRO n'est pas votre cluster (DIABO) |
| P16 | sk_botro | Transfert : le magasinier Botro expedie Botro -> Diabo (droit sur l'origine) | OK=EXPEDIE | ÉCART — REFUS : Accès refusé | CONFORME — OK EXPEDIE |
| P17 | sk_botro | Le meme magasinier tente de receptionner a Diabo (hors perimetre) | REFUS | CONFORME — REFUS : Transfert introuvable | CONFORME — REFUS : Localisation hors périmètre cluster : DIABO n'est pas votre cluster (BOTRO) |
| P18 | sk_diabo | Le magasinier Diabo receptionne (droit sur la destination) | OK=CLOS | ÉCART — REFUS : Transfert introuvable | CONFORME — OK CLOS |
| P19 | sk_diabo | Magasinier Diabo tente d'expedier depuis Botro | REFUS | CONFORME — REFUS : Accès refusé | CONFORME — REFUS : Localisation hors périmètre cluster : BOTRO n'est pas votre cluster (DIABO) |
| P20 | uh_botro | Appel direct du helper sacherie_ct_location (creation/reactivation libre) | REFUS | ÉCART — OK AFLP-CL-DIABO | CONFORME — REFUS : permission denied for function sacherie_ct_location |
| P21 | anon | Appel anonyme de sacherie_ops_network_move | REFUS | CONFORME — REFUS : Connexion requise | CONFORME — REFUS : permission denied for function sacherie_ops_network_move |
| L01 | sk_botro | Magasinier declare une perte sur son cluster | OK=t | ÉCART — REFUS : Accès refusé | CONFORME — OK t |
| L02 | bm | BM decide la perte declaree par une autre personne | OK=t | ÉCART — REFUS : Déclaration de perte introuvable | CONFORME — OK t |
| L03 | bm | BM declare une perte puis tente de la decider lui-meme | REFUS | ÉCART — OK JUT-LOSS-36a633dcab5a1ff6 | CONFORME — REFUS : Séparation des tâches : le déclarant d'une perte ne peut pas la décider |
| L04 | sk_inactif | Compte inactif tente de decider une perte | REFUS | CONFORME — REFUS : Déclaration de perte introuvable | CONFORME — REFUS : Décision perte réservée au Branch Manager (compte actif) |
| D01 | bm | Insertion directe d'une DOTATION_RT (contournement du workflow) | REFUS | CONFORME — REFUS : Approval BM requis : request_id absent | CONFORME — REFUS : Approval BM requis : request_id absent |
| D02 | bm | Requalification d'un mouvement existant en DOTATION_RT | REFUS | CONFORME — REFUS : Requalification en DOTATION_RT interdite : une dotation RT se cree uniquement par le workflow approuve (sacherie_executer_demande) | CONFORME — REFUS : Requalification en DOTATION_RT interdite : une dotation RT se cree uniquement par le workflow approuve (sacherie_executer_demande) |
| D03 | uh_botro | Circuit officiel : le Unit Head cree une demande de dotation | OK=PENDING_BM | ÉCART — REFUS : Droit insuffisant pour créer une demande | CONFORME — OK PENDING_BM |
| D04 | bm | Circuit officiel : le BM approuve | OK=APPROVED | ÉCART — REFUS : Demande introuvable | CONFORME — OK APPROVED |
| D05 | bm | L'approbateur tente d'executer sa propre dotation | REFUS | CONFORME — REFUS : Demande introuvable | CONFORME — REFUS : Séparation des tâches : approbateur et exécutant doivent être différents |
| D06 | sk_botro | Circuit officiel : le magasinier du cluster execute la dotation | OK=DOTATION_RT | ÉCART — REFUS : Demande introuvable | CONFORME — OK DOTATION_RT |
| D07 | bm | Controle : la dotation est projetee une fois dans rcn_jute_movements | OK=1 | ÉCART — OK 0 | CONFORME — OK 1 |
| D08 | uh_botro | Mouvement legacy legitime : retour RT -> cluster (sacs_mouvements) | OK=5 | ÉCART — REFUS : Stock sacs insuffisant. Disponible: 0, sortie: 5 | CONFORME — OK 5 |
| W01 | uh_botro | Unit Head prepare l'emplacement du RT (RPC controlee) | OK=AFLP-RT-RT-TB1 | ÉCART — REFUS : function public.sacherie_ct_location_rt(unknown) does not exist | CONFORME — OK AFLP-RT-RT-TB1 |
| W02 | uh_botro | Unit Head Botro cree une demande pour un RT de son cluster | OK=REQUESTED | CONFORME — OK REQUESTED | CONFORME — OK REQUESTED |
| W02b | uh_botro | Creation sans request_code (charge utile exacte du formulaire) | OK=true | ÉCART — REFUS : null value in column "request_code" of relation "ops_bag_requests" violates not-null constraint | CONFORME — OK true |
| W03 | uh_botro | Unit Head Botro cree une demande pour un RT de Diabo | REFUS | ÉCART — OK  | CONFORME — REFUS : Localisation hors périmètre cluster : DIABO n'est pas votre cluster (BOTRO) |
| W04 | uh_botro | Unit Head (initiateur) tente de revoir sa propre demande | REFUS | CONFORME — REFUS : Review AFLP réservé au Zonal Head | CONFORME — REFUS : Review AFLP réservé au Zonal Head |
| W04b | zh | Zonal Head cree une demande puis tente de la revoir lui-meme (auto-revue) | REFUS | ÉCART — OK 1 ligne(s) | CONFORME — REFUS : Séparation des tâches : l’initiateur ne peut pas revoir sa propre demande |
| W05 | zh | Zonal Head effectue la revue | OK=REVIEWED | CONFORME — OK REVIEWED | CONFORME — OK REVIEWED |
| W06 | fboo | Field Buying Operations Officer consolide | OK=CONSOLIDATED | CONFORME — OK CONSOLIDATED | CONFORME — OK CONSOLIDATED |
| W07 | bm | Branch Manager approuve 40 sacs | OK=BM_APPROVED | CONFORME — OK BM_APPROVED | CONFORME — OK BM_APPROVED |
| W07b | bm | L'approbation ne deplace aucun sac (aucun mouvement lie a la demande) | OK=0 | CONFORME — OK 0 | CONFORME — OK 0 |
| W08 | uh_botro | Unit Head tente de gonfler la quantite approuvee (update direct) | REFUS | ÉCART — OK 1 ligne(s) | CONFORME — REFUS : Approbation non modifiable en dehors de la décision d'approbation |
| W09 | sk_botro | Magasinier tente de detourner la destination de la demande approuvee | REFUS | ÉCART — OK 1 ligne(s) | CONFORME — REFUS : Périmètre de la demande non modifiable après création (cluster, RT, emplacements, campagne) |
| W10 | sk_botro | Magasinier marque FULLY_RELEASED sans sortie physique | REFUS | ÉCART — OK 1 ligne(s) | CONFORME — REFUS : Quantité libérée modifiable uniquement par la sortie officielle (ops_release_bags) |
| W11 | bm | L'approbateur tente la sortie physique | REFUS | CONFORME — REFUS : Séparation des tâches : approbateur et exécutant doivent être différents | CONFORME — REFUS : Séparation des tâches : approbateur et exécutant doivent être différents |
| W12 | sk_diabo | Magasinier d'un autre cluster tente la sortie depuis Botro | REFUS | CONFORME — REFUS : Approval valide requis avant la sortie physique | CONFORME — REFUS : Localisation hors périmètre cluster : BOTRO n'est pas votre cluster (DIABO) |
| W13 | sk_botro | Magasinier Botro enregistre la sortie (40) | OK=40 | ÉCART — REFUS : Approval valide requis avant la sortie physique | CONFORME — OK 40 |
| W14 | sk_botro | Sortie rejouee avec la meme cle : aucun doublon | OK=40 | ÉCART — REFUS : Approval valide requis avant la sortie physique | CONFORME — OK 40 |
| W15 | bm | Controle : une seule sortie et un seul mouvement pour T-REL-1 | OK=1/1 | ÉCART — OK 0/0 | CONFORME — OK 1/1 |
| W16 | uh_diabo | Unit Head d'un autre cluster tente de confirmer la reception | REFUS | ÉCART — OK 1 ligne(s) | CONFORME — REFUS : Localisation hors périmètre cluster : BOTRO n'est pas votre cluster (DIABO) |
| W17 | uh_botro | Unit Head Botro confirme la reception | OK=40 | CONFORME — OK 40 | CONFORME — OK 40 |
| W18 | uh_botro | Demande de 5000 sacs (stock Botro < 5000) | OK=REQUESTED | CONFORME — OK REQUESTED | CONFORME — OK REQUESTED |
| W19 | zh | Revue T-OPS-2 | OK=REVIEWED | CONFORME — OK REVIEWED | CONFORME — OK REVIEWED |
| W20 | fboo | Consolidation T-OPS-2 | OK=CONSOLIDATED | CONFORME — OK CONSOLIDATED | CONFORME — OK CONSOLIDATED |
| W21 | bm | Approbation T-OPS-2 (5000) | OK=BM_APPROVED | CONFORME — OK BM_APPROVED | CONFORME — OK BM_APPROVED |
| W22 | sk_botro | Sortie superieure au stock disponible | REFUS | CONFORME — REFUS : Stock utilisable insuffisant | CONFORME — REFUS : Stock utilisable insuffisant (disponible : 1432) |
| W23 | supervisor | Role non habilite tente une sortie | REFUS | CONFORME — REFUS : Droit insuffisant pour libérer les sacs | CONFORME — REFUS : Droit insuffisant pour libérer les sacs |
| S01 | bm | Solde final Botro = 1000 +500 (usine legacy) +10 (retour) +5 (retour legacy) -20 (transfert) -3 (perte) -20 (dotation) -40 (sortie) | OK=1432 | ÉCART — OK 1498 | CONFORME — OK 1432 |
| A05 | bm | BM tente d'attribuer General Manager depuis l'ecran | REFUS | ÉCART — OK 1 ligne(s) | CONFORME — REFUS : Le rôle « General Manager » ne s'attribue pas depuis l'écran : procédure administrateur requise |
| A06 | bm | BM tente de se desactiver lui-meme | REFUS | ÉCART — OK 1 ligne(s) | CONFORME — REFUS : Vous ne pouvez pas modifier vos propres habilitations (rôle, statut, portée) |

fbms_apres : 71/71 conformes

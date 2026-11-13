# Observatoire agronomique AFLP 2027 — rapport de tests

Dernière exécution serveur : 2026-11-13 17:29 ; navigateur : 2026-11-13T17:29 (UTC). Environnement : PostgreSQL 16 **local** (réplique `tests/sql/replica` + compléments), Chromium + Playwright, données **100 % fictives**. Aucun test n'a touché Supabase.

Commande : `PGHOST=127.0.0.1 PGPORT=54329 OBS_E2E=1 ./tests/observatoire/executer_tests_observatoire.sh` puis `python3 tests/observatoire/generer_rapport.py`.

## Synthèse

| Suite | Exécutés | Réussis | Échoués | Non exécutés |
|---|---|---|---|---|
| Serveur (RLS + RPC, rôle `authenticated`, JWT fictifs) | 223 | 223 | 0 | 0 |
| Non-régression SQL (empreinte de l'existant, retour arrière) | 8 | 8 | 0 | 0 |
| Cœur métier JavaScript | 21 | 21 | 0 | 0 |
| Navigateur de bout en bout (vrai Service Worker, mode avion) | 60 | 60 | 0 | 0 |
| **Total module** | **312** | **312** | **0** | 0 |

Contrôles du dépôt : `verifier-html` 0 nouvel écart (3 historiques) ; `verifier-js` 0 nouvelle erreur (1 historique) ; `verifier-liens` 0 nouveau lien cassé (4 historiques) ; `verifier-pages` (toutes les pages × 3 largeurs) 0 nouveau problème (16 historiques).

Tests existants rejoués : `offline-field-static`, `operations-suite-static`, `field-buying-performance-static`, `field-buying-profiles-static`, `field-buying-prefilled-edit-static`, `rt-sop-integration-static`, `offline-field-multi-user-e2e`, `campagnes-e2e`, `espaces-roles-static` : **réussis**. `offline-field-e2e` et `field-buying-e2e` : **échouent de façon identique sur `main` sans la branche** (attente de `#offPrepare` / `#villageForm`) : défaut antérieur, non causé par l'Observatoire.

**Non exécuté** : aucun test sur un staging Supabase (il n'en existe pas) ; aucun test sur un vrai téléphone Android ; aucun test de charge au-delà du pilote.

## Détail serveur

### Échantillonnage (44/44)

| Id | Compte | Action | Attendu | Résultat |
|---|---|---|---|---|
| ECH-40 | auh_bro | Installation avant création de la graine de campagne : refusée | REFUS (Graine) | RÉUSSI |
| ECH-41 | uh_bro | Graine de campagne créée par un Unit Head : refusé | REFUS (Branch Manager) | RÉUSSI |
| ECH-42 | bm | Le Branch Manager crée la graine aléatoire de la campagne | OK ("deja_creee": false) | RÉUSSI |
| ECH-43 | bm | Deuxième création : la graine existante est rendue, jamais remplacée | OK (5dd787a473f0c17ae19fa765d021f3d8cbeed25b688ce3c8907ad9a67e7994f6) | RÉUSSI |
| ECH-44 | postgres (superutilisateur) | Graine immuable, même pour le superutilisateur | REFUS | RÉUSSI |
| ECH-01 | auh_bro | AUH installe le champ A (B=4, b=2) | OK | RÉUSSI |
| ECH-02 | auh_bro | Blocs tirés = recalcul indépendant sha256 | [4, 1] | RÉUSSI |
| ECH-03 | postgres (lecture) | Tirage verrouillé, b fixé avant tirage | true/TIRAGE_VERROUILLE/true | RÉUSSI |
| ECH-04 | auh_bro | Réinstallation identique : idempotente | OK (deja_installe) | RÉUSSI |
| ECH-05 | auh_bro | Rejouer le tirage avec un autre b : refusé | REFUS (verrouillé) | RÉUSSI |
| ECH-06 | uh_bro | Même parcelle, autre identifiant (autre appareil) : refusé | REFUS (déjà installée) | RÉUSSI |
| ECH-07 | auh_bro | b > B : refusé | REFUS (invalide) | RÉUSSI |
| ECH-08 | auh_bro | Bloc sans repère physique : refusé | REFUS (repère) | RÉUSSI |
| ECH-09 | auh_bro | Liste de blocs incomplète : refusé | REFUS (exactement) | RÉUSSI |
| ECH-10 | auh_bro | Campagne fermée : refusé | REFUS (ouverte) | RÉUSSI |
| ECH-11 | bm | Village sans cluster AFLP : refusé | REFUS (cluster) | RÉUSSI |
| ECH-12 | postgres (lecture) | Journal du tirage : graine non choisie par l'agent (campagne:parcelle), b fixé avant | 5dd787a473f0c17ae19fa765d021f3d8cbeed25b688ce3c8907ad9a67e7994f6:f93c1c6b-41d3-5015-9fcd-57d388d286c8:BLOCS/true/AFLP2027-OBS v0.9 | RÉUSSI |
| ECH-13 | auh_bro | Inventaire d'un bloc non tiré : refusé | REFUS (pas été tiré) | RÉUSSI |
| ECH-14 | auh_bro | Inventaire bloc tiré 1 (N=7) | OK (TIRAGE_VERROUILLE) | RÉUSSI |
| ECH-15 | postgres (lecture) | Aucun arbre tiré tant qu'un bloc tiré n'est pas inventorié | 0 | RÉUSSI |
| ECH-16 | uh_bro | Inventaire bloc tiré 2 (N=9) : le champ devient actif | OK (ACTIF) | RÉUSSI |
| ECH-17 | postgres (lecture) | 10 titulaires et 2 réserves | 10/2/12 | RÉUSSI |
| ECH-18 | postgres (lecture) | Arbres du bloc 1 = recalcul indépendant (5 titulaires puis 1 réserve) | 2,4,1,5,7,3 | RÉUSSI |
| ECH-19 | postgres (lecture) | Identifiant d'arbre déterministe (calculable hors ligne) | 74db2b85-116c-bec9-8fec-684c84a6ea49 | RÉUSSI |
| ECH-20 | postgres (lecture) | Probabilité d'inclusion (2/4)×(5/7) = 0,357 | 0.357 | RÉUSSI |
| ECH-21 | postgres (lecture) | Réserve : en attente, sans probabilité | RESERVE_EN_ATTENTE/null | RÉUSSI |
| ECH-22 | auh_bro | Modifier un inventaire enregistré : refusé | REFUS (ne peut plus être modifié) | RÉUSSI |
| ECH-23 | auh_bro | Inventaire rejoué à l'identique : idempotent | OK (deja_inventorie) | RÉUSSI |
| ECH-24 | uh_bro | Installation du champ B (B=3, b=2) | OK | RÉUSSI |
| ECH-25 | uh_bro | Champ B bloc 1 : N=3 (< 5 titulaires) | OK | RÉUSSI |
| ECH-26 | uh_bro | Champ B bloc 2 : N=12 → incompatibilité signalée | OK (INCOMPATIBLE) | RÉUSSI |
| ECH-27 | postgres (lecture) | Bloc trop petit : aucun arbre tiré, N non gonflé, bloc non remplacé | 0/3/2 | RÉUSSI |
| ECH-28 | bm | BM installe le champ C (B=2, b=2) | OK | RÉUSSI |
| ECH-29 | bm | Champ C bloc 1 : N=5 (5 titulaires, réserve impossible) | OK | RÉUSSI |
| ECH-30 | bm | Champ C bloc 2 : N=20 | OK (ACTIF) | RÉUSSI |
| ECH-31 | postgres (lecture) | Réserve manquante signalée, champ actif | ACTIF/1 | RÉUSSI |
| ECH-32 | uh_bro | Probabilités amont par un Unit Head : refusé | REFUS (Branch Manager) | RÉUSSI |
| ECH-33 | bm | Probabilités amont par le BM (π village 0,5 ; π champ 0,25) | OK | RÉUSSI |
| ECH-34 | postgres (lecture) | π = 0,5 × 0,25 × (2/4) × (5/7) = 0,0446 | 0.0446 | RÉUSSI |
| ECH-35 | postgres (superutilisateur) | Journal immuable, même pour le superutilisateur | REFUS | RÉUSSI |
| ECH-36 | auh_bro | Installation du champ D (B=6, b=3) | OK | RÉUSSI |
| ECH-37 | postgres (lecture) | Répartition 10 titulaires sur 3 blocs : 4+3+3, réserves 1+1+0 | 4+1,3+1,3+0 | RÉUSSI |
| ECH-38 | auh_bro | Marquage GPS d'un arbre | OK | RÉUSSI |
| ECH-39 | auh_bro | GPS invalide : refusé | REFUS (GPS) | RÉUSSI |

### Observation terrain (14/14)

| Id | Compte | Action | Attendu | Résultat |
|---|---|---|---|---|
| OBS-01 | auh_bro | Brouillon partiel (3 arbres, réponses incomplètes) | ACCEPTEE (BROUILLON) | RÉUSSI |
| OBS-02 | postgres (lecture) | Aucun « Non » pré-rempli : les réponses absentes restent vides | 3/0/1 | RÉUSSI |
| OBS-03 | auh_bro | Soumission incomplète : refusée | REJETEE (incomplète) | RÉUSSI |
| OBS-04 | postgres (lecture) | Un refus n'écrit rien (transaction annulée) | BROUILLON/3 | RÉUSSI |
| OBS-05 | auh_bro | « Pas vu » sans raison : refusé | REJETEE (Raison obligatoire) | RÉUSSI |
| OBS-06 | auh_bro | Chute de fruits mûrs sans source de preuve : refusée | REJETEE (preuve) | RÉUSSI |
| OBS-07 | auh_bro | Arbre non retrouvé sans raison : refusé | REJETEE (Raison obligatoire) | RÉUSSI |
| OBS-08 | auh_bro | Observation d'une réserve non activée : refusée | REJETEE (réserve) | RÉUSSI |
| OBS-09 | auh_bro | Semaine incohérente avec la date : refusée | REJETEE (semaine) | RÉUSSI |
| OBS-10 | auh_bro | Date d'observation future : refusée | REJETEE (futur) | RÉUSSI |
| OBS-11 | auh_bro | Ramassage non renseigné : refusé | REJETEE (ramassage) | RÉUSSI |
| OBS-12 | auh_bro | Soumission complète de la semaine 1 | ACCEPTEE (SOUMIS) | RÉUSSI |
| OBS-13 | postgres (lecture) | Trois dates conservées : observation, saisie, réception serveur | true/true | RÉUSSI |
| OBS-14 | postgres (lecture) | Arbre non retrouvé : aucun stade enregistré | vide/vide | RÉUSSI |

### Synchronisation (20/20)

| Id | Compte | Action | Attendu | Résultat |
|---|---|---|---|---|
| SYN-01 | auh_bro | Renvoi de la même opération (même clé) : rejouée, sans doublon | ACCEPTEE (rejoue) | RÉUSSI |
| SYN-02 | postgres (lecture) | Une seule visite, dix observations après renvoi | 1/10 | RÉUSSI |
| SYN-03 | auh_bro | Même clé, contenu différent : refusé | REJETEE (déjà utilisée) | RÉUSSI |
| SYN-04 | uh_bro | Autre appareil, même champ, même semaine : conflit, rien d'écrasé | CONFLIT (DOUBLON_SEMAINE) | RÉUSSI |
| SYN-05 | postgres (lecture) | La visite d'origine est intacte | 1/2 | RÉUSSI |
| SYN-06 | auh_bro | Modification hors ligne d'une visite déjà soumise : proposition, pas d'écrasement | CONFLIT (VISITE_FIGEE) | RÉUSSI |
| SYN-07 | postgres (lecture) | Valeur serveur inchangée, proposition de correction enregistrée | NON/1 | RÉUSSI |
| SYN-08 | auh_bro | Lot de 51 opérations : refusé | REFUS (50) | RÉUSSI |
| SYN-09 | auh_bro | Type d'opération inconnu : refusé | REJETEE (inconnu) | RÉUSSI |
| SYN-10 | auh_bro | Opération sans clé d'idempotence : refusée | REJETEE | RÉUSSI |
| SYN-11 | auh_bro | Brouillon semaine 2 enregistré | ACCEPTEE (BROUILLON) | RÉUSSI |
| SYN-12 | auh_bro | Brouillon modifié avec une version périmée : conflit de version | CONFLIT (VERSION) | RÉUSSI |
| SYN-13 | auh_bro | Semaine 2 soumise avec la bonne version | ACCEPTEE (SOUMIS) | RÉUSSI |
| SYN-14 | auh_bro | Lot mixte : une opération acceptée, une refusée, chacune avec son accusé | ACCEPTEE + REJETEE | RÉUSSI |
| SYN-15 | auh_bro | Transcription papier où l'observateur est le transcripteur : refusée | REJETEE (autre personne) | RÉUSSI |
| SYN-16 | auh_bro | Transcription papier : observateur distinct, tracé | ACCEPTEE (SOUMIS) | RÉUSSI |
| SYN-17 | postgres (lecture) | Observateur et transcripteur distincts enregistrés | true/true | RÉUSSI |
| SYN-18 | auh_bro | Installation hors ligne synchronisée par lot | ACCEPTEE (blocs_tires) | RÉUSSI |
| SYN-19 | uh_bro | Deux envois simultanés de la même opération : les deux reçoivent un accusé « acceptée » | ACCEPTEE ×2 dont 1 rejouée | RÉUSSI |
| SYN-20 | postgres (lecture) | Envois simultanés : une seule visite, aucune erreur de doublon | 1 | RÉUSSI |

### Validation (40/40)

| Id | Compte | Action | Attendu | Résultat |
|---|---|---|---|---|
| VAL-01 | auh_bro2 | Assistant Unit Head vérifie : refusé | REFUS (non autorisée) | RÉUSSI |
| VAL-02 | auh_bro | L'auteur vérifie sa propre visite : refusé | REFUS (observée ou saisie) | RÉUSSI |
| VAL-03 | uh_bot | Unit Head d'un autre cluster vérifie : refusé (visite invisible) | REFUS (introuvable) | RÉUSSI |
| VAL-04 | uh_bro | Unit Head du cluster met en vérification | OK (EN_VERIFICATION) | RÉUSSI |
| VAL-05 | uh_bro | Unit Head valide sans affectation : refusé | REFUS (affectation) | RÉUSSI |
| VAL-06 | zh1 | Zonal Head valide sans affectation agronomique : refusé | REFUS (affectation) | RÉUSSI |
| VAL-07 | uh_bro | Unit Head accorde une affectation : refusé | REFUS (Branch Manager) | RÉUSSI |
| VAL-08 | bm | BM affecte la validation à un Assistant Unit Head : refusé | REFUS (ne peut viser) | RÉUSSI |
| VAL-09 | bm | BM affecte la validation à un RT : refusé | REFUS (ne peut viser) | RÉUSSI |
| VAL-10 | bm | BM accorde une affectation expirée au Zonal Head 1 | OK | RÉUSSI |
| VAL-11 | zh1 | Zonal Head avec affectation expirée : refusé | REFUS (affectation) | RÉUSSI |
| VAL-12 | bm | BM accorde au Zonal Head 2 la validation de BROBO (hors de sa zone) | OK | RÉUSSI |
| VAL-13 | zh2 | Zonal Head hors zone, même affecté : refusé | REFUS (introuvable) | RÉUSSI |
| VAL-14 | bm | BM accorde au Zonal Head 1 la validation de BROBO | OK | RÉUSSI |
| VAL-15 | zh1 | Demande de correction sans motif : refusée | REFUS (Motif) | RÉUSSI |
| VAL-16 | zh1 | Zonal Head affecté demande une correction motivée | OK (CORRECTION_DEMANDEE) | RÉUSSI |
| VAL-17 | zh1 | Valider une visite en correction demandée : refusé | REFUS (soumise ou en vérification) | RÉUSSI |
| VAL-18 | auh_bro | L'auteur soumet à nouveau sans motif : refusé | REJETEE (Motif de correction) | RÉUSSI |
| VAL-19 | auh_bro | L'auteur corrige et soumet avec motif | ACCEPTEE (SOUMIS) | RÉUSSI |
| VAL-20 | postgres (lecture) | Historique : auteur, ancienne et nouvelle valeur, motif | true/NON/OUI/true | RÉUSSI |
| VAL-21 | zh1 | Zonal Head affecté valide la semaine 1 | OK (VALIDE) | RÉUSSI |
| VAL-22 | zh1 | Valider deux fois : refusé | REFUS (soumise ou en vérification) | RÉUSSI |
| VAL-23 | zh1 | Version périmée à la validation : refusée | REFUS (changé) | RÉUSSI |
| VAL-24 | zh1 | Zonal Head affecté valide la semaine 2 | OK (VALIDE) | RÉUSSI |
| VAL-25 | auh_bro | Envoi hors ligne tardif sur une visite VALIDÉE : proposition, jamais d'écrasement | CONFLIT (VISITE_FIGEE) | RÉUSSI |
| VAL-26 | postgres (lecture) | Visite validée intacte | VALIDE/ABSENCE | RÉUSSI |
| VAL-27 | auh_bro | L'auteur décide de sa propre proposition : refusé | REFUS (valideur) | RÉUSSI |
| VAL-28 | uh_bro | Unit Head sans affectation décide : refusé | REFUS (valideur) | RÉUSSI |
| VAL-29 | zh1 | Décision sans motif : refusée | REFUS (Motif) | RÉUSSI |
| VAL-30 | zh1 | Le valideur applique la correction avec motif | OK (APPLIQUEE) | RÉUSSI |
| VAL-31 | postgres (lecture) | Correction appliquée et journalisée (ancienne → nouvelle) | MURE/ABSENCE>MURE | RÉUSSI |
| VAL-32 | zh1 | Application de la preuve associée | OK (APPLIQUEE) | RÉUSSI |
| VAL-33 | bm | BM observe lui-même une visite (champ C, semaine précédente) | ACCEPTEE (SOUMIS) | RÉUSSI |
| VAL-34 | bm | BM valide sa propre visite : refusé | REFUS (observée ou saisie) | RÉUSSI |
| VAL-35 | bm | BM révoque l'affectation du Zonal Head 1 | OK | RÉUSSI |
| VAL-36 | zh1 | Zonal Head révoqué valide : refusé | REFUS (affectation) | RÉUSSI |
| VAL-37 | uh_bro | Activation d'une réserve sans droit de validation : refusé | REFUS (valideur) | RÉUSSI |
| VAL-38 | bm | BM active une réserve (arbre non retrouvé), motif obligatoire | OK (reserve_activee) | RÉUSSI |
| VAL-39 | postgres (lecture) | Titulaire remplacé, réserve activée, probabilité marquée approchée | REMPLACE/1 | RÉUSSI |
| VAL-40 | postgres (lecture) | Événements de maturité : intervalle (dernière visite négative, première positive) | 2026-10-23/2026-10-30 | RÉUSSI |

### Indicateurs pilote (16/16)

| Id | Compte | Action | Attendu | Résultat |
|---|---|---|---|---|
| IND-01 | postgres (lecture) | Seules les visites validées alimentent les vues (V1, V2) | 2 | RÉUSSI |
| IND-02 | postgres (lecture) | Brouillon de la semaine 3 exclu | 0 | RÉUSSI |
| IND-03 | postgres (lecture) | Semaine 1 : part F pondérée, 3 Oui sur 8 réponses définies (« Pas vu » et non retrouvé hors dénominateur) | 0.3281 | RÉUSSI |
| IND-04 | postgres (lecture) | Semaine 2 : part C hebdo pondérée (prématurée et non confirmée ne comptent pas en C) | 0.3151 | RÉUSSI |
| IND-05 | postgres (lecture) | Chutes prématurées et non confirmées comptées à part | 1/1/1 | RÉUSSI |
| IND-06 | postgres (lecture) | Vues étiquetées pilote, non officielles | PILOTE_NON_OFFICIEL | RÉUSSI |
| IND-07 | bm | BM accorde au Zonal Head 1 une nouvelle affectation | OK | RÉUSSI |
| IND-08 | auh_bro | Semaine 3 soumise : aucune chute observée | ACCEPTEE (SOUMIS) | RÉUSSI |
| IND-09 | zh1 | Semaine 3 validée | OK (VALIDE) | RÉUSSI |
| IND-10 | postgres (lecture) | C cumulatif : 0 puis 3 puis 3 (une semaine sans chute n'efface rien) | 0,3,3 | RÉUSSI |
| IND-11 | postgres (lecture) | Réserves (en attente ou activée) et titulaire remplacé hors dénominateur : 9 titulaires suivis | 9 | RÉUSSI |
| IND-12 | postgres (lecture) | Palier expérimental : couverture insuffisante (1 champ validé sur 4 actifs) | COUVERTURE_INSUFFISANTE | RÉUSSI |
| IND-14 | postgres (lecture) | Réserve activée : comptée à part, hors proportions | 1/9 | RÉUSSI |
| IND-15 | postgres (lecture) | Cluster : ratio pondéré (pas une moyenne de proportions) | true | RÉUSSI |
| IND-16 | postgres (lecture) | Non-réponse pondérée publiée (semaine 1 : « Pas vu » et non retrouvé) | true | RÉUSSI |
| IND-13 | postgres (lecture) | Qualité : transcription papier comptée | 1 | RÉUSSI |

### Sécurité (89/89)

| Id | Compte | Action | Attendu | Résultat |
|---|---|---|---|---|
| SEC-01 | uh_bot | Unit Head Botro installe un champ dans SON cluster | OK | RÉUSSI |
| SEC-02 | uh_bot | Unit Head Botro installe un champ à Brobo : refusé | REFUS (réservée aux agents du cluster) | RÉUSSI |
| SEC-03 | anon | Anonyme lit les champs : refusé | REFUS (permission) | RÉUSSI |
| SEC-04 | anon | Anonyme appelle la synchronisation : refusé | REFUS (permission) | RÉUSSI |
| SEC-05 | bm | BM : tous les champs | 6 | RÉUSSI |
| SEC-06 | abm | ABM : tous les champs (lecture) | 6 | RÉUSSI |
| SEC-07 | zh1 | Zonal Head 1 : sa zone seulement | 5 | RÉUSSI |
| SEC-08 | zh2 | Zonal Head 2 : sa zone seulement | 1 | RÉUSSI |
| SEC-09 | uh_bro | Unit Head Brobo : son cluster | 5 | RÉUSSI |
| SEC-10 | uh_bot | Unit Head Botro : son cluster | 1 | RÉUSSI |
| SEC-11 | auh_bro | Assistant Unit Head Brobo : son cluster | 5 | RÉUSSI |
| SEC-12 | rt | RT : aucun champ | 0 | RÉUSSI |
| SEC-13 | sup | Supervisor : aucun champ | 0 | RÉUSSI |
| SEC-14 | gm | General Manager : aucun champ (non prévu au pilote) | 0 | RÉUSSI |
| SEC-15 | uh_inactif | Compte inactif : aucun champ | 0 | RÉUSSI |
| SEC-16 | uh_bot | Unit Head Botro ne lit rien de Brobo dans pheno_visites | 0 | RÉUSSI |
| SEC-17 | uh_bot | Unit Head Botro ne lit rien de Brobo dans pheno_observations | 0 | RÉUSSI |
| SEC-18 | uh_bot | Unit Head Botro ne lit rien de Brobo dans pheno_arbres | 0 | RÉUSSI |
| SEC-19 | uh_bot | Unit Head Botro ne lit rien de Brobo dans pheno_blocs | 0 | RÉUSSI |
| SEC-20 | uh_bot | Unit Head Botro ne lit rien de Brobo dans pheno_journal | 0 | RÉUSSI |
| SEC-21 | uh_bot | Unit Head Botro ne lit rien de Brobo dans pheno_corrections | 0 | RÉUSSI |
| SEC-22 | uh_bot | Unit Head Botro ne lit rien de Brobo dans pheno_evenements_maturite | 0 | RÉUSSI |
| SEC-23 | rt | RT ne lit aucune observation de référence | 0 | RÉUSSI |
| SEC-24 | rt | RT appelle la synchronisation : refusé | REFUS (refusé) | RÉUSSI |
| SEC-25 | sup | Supervisor installe un champ : refusé | REFUS (refusé) | RÉUSSI |
| SEC-26 | uh_inactif | Compte inactif synchronise : refusé | REFUS (refusé) | RÉUSSI |
| SEC-27 | uh_bot | Unit Head Botro envoie une visite sur un champ de Brobo : refusé | REJETEE (PH001) | RÉUSSI |
| SEC-28 | zh1 | Zonal Head collecte une visite : refusé (pas un rôle de collecte) | REJETEE (PH001) | RÉUSSI |
| SEC-29 | bm | Écriture directe refusée, même au BM : insert visite | REFUS (permission) | RÉUSSI |
| SEC-30 | bm | Écriture directe refusée, même au BM : update visite (auto-validation) | REFUS (permission) | RÉUSSI |
| SEC-31 | bm | Écriture directe refusée, même au BM : update observation | REFUS (permission) | RÉUSSI |
| SEC-32 | bm | Écriture directe refusée, même au BM : delete visite | REFUS (permission) | RÉUSSI |
| SEC-33 | bm | Écriture directe refusée, même au BM : insert affectation | REFUS (permission) | RÉUSSI |
| SEC-34 | bm | Écriture directe refusée, même au BM : insert journal | REFUS (permission) | RÉUSSI |
| SEC-35 | bm | Écriture directe refusée, même au BM : update arbre (probabilité) | REFUS (permission) | RÉUSSI |
| SEC-36 | bm | Fonction interne non appelable directement | REFUS (permission) | RÉUSSI |
| SEC-37 | uh_bro | Fonction interne de tirage non appelable | REFUS (permission) | RÉUSSI |
| SEC-38 | zh1 | Zonal Head lit ses seules affectations | t | RÉUSSI |
| SEC-39 | uh_bro | Unit Head ne lit pas les affectations des autres | 0 | RÉUSSI |
| SEC-40 | auh_bro | Preuve : dépôt dans son dossier, champ de son cluster | OK | RÉUSSI |
| SEC-41 | auh_bro | Preuve : dépôt sous l'identité d'un autre : refusé | REFUS (row-level security) | RÉUSSI |
| SEC-42 | uh_bot | Preuve : dépôt sur un champ d'un autre cluster : refusé | REFUS (row-level security) | RÉUSSI |
| SEC-43 | auh_bro | Preuve : chemin non conforme : refusé par défaut | REFUS (row-level security) | RÉUSSI |
| SEC-44 | auh_bro | Preuve : extension non autorisée : refusé | REFUS (row-level security) | RÉUSSI |
| SEC-45 | auh_bro | Preuve : campagne ne correspondant pas au champ : refusé | REFUS (row-level security) | RÉUSSI |
| SEC-46 | rt | Preuve : dépôt par un RT : refusé | REFUS (row-level security) | RÉUSSI |
| SEC-47 | uh_bro | Preuve : lecture par le cluster | 1 | RÉUSSI |
| SEC-48 | uh_bot | Preuve : invisible pour un autre cluster | 0 | RÉUSSI |
| SEC-49 | rt | Preuve : invisible pour un RT | 0 | RÉUSSI |
| SEC-50 | auh_bro | Preuve : suppression impossible (aucune politique) | 0 ligne | RÉUSSI |
| SEC-51 | auh_bro | Preuve : remplacement impossible (aucune politique) | inchangé | RÉUSSI |
| SEC-52 | auh_bro | Référence de preuve pointant hors du champ : refusée | REJETEE (preuve) | RÉUSSI |
| SEC-53 | postgres (lecture) | Bucket de preuves privé | false | RÉUSSI |
| SEC-54 | postgres (lecture) | RLS active sur toutes les tables de l'Observatoire | 11/11 | RÉUSSI |
| SEC-55 | postgres (lecture) | Aucune politique d'écriture sur les tables de l'Observatoire | 0 | RÉUSSI |
| SEC-56 | postgres (lecture) | Toutes les fonctions SECURITY DEFINER du module fixent search_path | 0 | RÉUSSI |
| SEC-57 | postgres (lecture) | Aucune fonction du module exécutable par anon | 0 | RÉUSSI |
| SEC-61 | uh_bro | Fiche papier : observateur d'un autre cluster refusé | REJETEE (cluster) | RÉUSSI |
| SEC-62 | uh_bro | Identité falsifiée dans la charge (user_id, acteur, observateur en mode direct) : envoi accepté… | ACCEPTEE (BROUILLON) | RÉUSSI |
| SEC-63 | postgres (lecture) | … mais l'identité retenue est celle de la session, et le statut n'est pas forcé | true/BROUILLON | RÉUSSI |
| SEC-64 | postgres (lecture) | Toutes les fonctions SECURITY DEFINER du module appartiennent au propriétaire du schéma (pas à authenticated) | 0 | RÉUSSI |
| SEC-65 | postgres (lecture) | Aucune fonction privée du module exécutable par authenticated hors helpers de lecture |  | RÉUSSI |
| SEC-68 | uh_bro | Lecture directe du rôle d'un autre compte : refusée | REFUS (permission) | RÉUSSI |
| SEC-66 | auh_bro | Parcelles installables : seulement son cluster (BROBO) | BROBO | RÉUSSI |
| SEC-67 | rt | Parcelles installables : rien pour un RT | 0 | RÉUSSI |
| SEC-69 | uh_bot | Appel direct d'une RPC d'écriture hors périmètre (marquage d'un arbre de Brobo) : refusé | REFUS (réservé) | RÉUSSI |
| SEC-70 | uh_bot | Appel direct de l'inventaire d'un bloc de Brobo : refusé | REFUS (réservé) | RÉUSSI |
| SEC-71 | postgres (superutilisateur) | Visite dont le cluster diffère de celui de son champ : refusée par la base | REFUS | RÉUSSI |
| SEC-72 | auh_bro | Même clé, même charge, depuis un autre appareil : refusée (empreinte sur l'enveloppe complète) | REJETEE | RÉUSSI |
| SEC-76 | uh_bro | Même enveloppe rejouée par un autre compte : refusée | REJETEE | RÉUSSI |
| SEC-73 | auh_bro | Photo référencée dans le dossier d'un autre agent : refusée | REJETEE (preuve) | RÉUSSI |
| SEC-74 | uh_bro | Erreur technique : aucun détail SQL renvoyé au téléphone, code de diagnostic | TECHNIQUE sans texte SQL | RÉUSSI |
| SEC-75 | postgres (lecture) | Détail technique conservé au journal, invisible des écrans (cluster nul) | 1 | RÉUSSI |
| CMP-01 | bm | Graine de la seconde campagne (distincte de la première) | OK ("deja_creee": false) | RÉUSSI |
| CMP-02 | postgres (lecture) | Chaque campagne a sa propre graine | 2 | RÉUSSI |
| CMP-03 | uh_bro | Même parcelle installée dans une autre campagne : autorisé (panel par campagne) | OK | RÉUSSI |
| CMP-04 | uh_bro | Inventaire du bloc tiré (campagne 2) | OK (ACTIF) | RÉUSSI |
| CMP-05 | postgres (lecture) | Tirage de la campagne 2 indépendant de la campagne 1 (graine différente) | t | RÉUSSI |
| CMP-06 | auh_bro | Visite soumise dans la campagne 2 | ACCEPTEE (SOUMIS) | RÉUSSI |
| CMP-07 | postgres (lecture) | Le Zonal Head 1 a des affectations sur la campagne 1 et aucune sur la campagne 2 | true/0 | RÉUSSI |
| CMP-08 | zh1 | Validation dans la campagne 2 avec une affectation de la campagne 1 : refusée | REFUS (affectation) | RÉUSSI |
| CMP-09 | bm | Affectation de validation sur la campagne 2 | OK | RÉUSSI |
| CMP-10 | zh1 | Validation dans la campagne 2 avec l'affectation de la campagne 2 : acceptée | OK (VALIDE) | RÉUSSI |
| CMP-11 | postgres (lecture) | Vues pilotes cloisonnées par campagne (aucune visite de la campagne 2 dans la campagne 1) | 0 | RÉUSSI |
| CMP-12 | auh_bro | Campagne 2 fermée : nouvelle visite refusée | REJETEE (campagne) | RÉUSSI |
| CMP-13 | uh_bro | Campagne fermée : parcelles installables toujours filtrées par cluster | OK (t) | RÉUSSI |
| SEC-58 | auh_bro | Collègues de collecte : seulement ceux de son cluster, sans soi-même | AUH BROBO 2 FICTIF,UH BROBO FICTIF | RÉUSSI |
| SEC-59 | rt | Collègues de collecte : rien pour un RT | 0 | RÉUSSI |
| SEC-60 | zh1 | Collègues de collecte : rien hors rôles de collecte | 0 | RÉUSSI |

## Détail navigateur

| Id | Famille | Vérification | Résultat |
|---|---|---|---|
| E2E-01 | Parcours terrain | Entrée « Observatoire agronomique » dans le menu FIELD BUYING | RÉUSSI |
| E2E-02 | Parcours terrain | Bandeau pilote : aucun indicateur officiel | RÉUSSI |
| E2E-03 | Parcours terrain | Onglets de l’Assistant Unit Head : collecte seulement (ni Validation ni Affectations) | RÉUSSI |
| E2E-04 | Parcours terrain | Préparation hors-ligne : seules les 2 parcelles du cluster de l’agent sont copiées sur l’appareil | RÉUSSI |
| E2E-05 | Parcours terrain | Hors ligne : l’application fermée puis rouverte se recharge depuis le cache, module compris | RÉUSSI |
| E2E-06 | Parcours terrain | Installation : seules les parcelles du cluster de l’agent sont proposées | RÉUSSI |
| E2E-07 | Parcours terrain | Avertissement avant verrouillage : b ne pourra plus être changé | RÉUSSI |
| E2E-08 | Parcours terrain | Blocs tirés hors ligne = tirage reproductible (recalcul indépendant) | RÉUSSI |
| E2E-09 | Synchronisation | Hors ligne : « Non encore sauvegardée sur le serveur » affiché, jamais « reçu » | RÉUSSI |
| E2E-10 | Parcours terrain | Après inventaire : 10 titulaires et 2 réserves tirés hors ligne, codes permanents | RÉUSSI |
| E2E-11 | Parcours terrain | Inventaire non modifiable à l’écran après enregistrement | RÉUSSI |
| E2E-12 | Parcours terrain | Marquage GPS d’un arbre enregistré sur l’appareil | RÉUSSI |
| E2E-13 | Parcours terrain | Visite : aucune réponse présélectionnée à l’ouverture | RÉUSSI |
| E2E-14 | Parcours terrain | Visite : dix arbres 01 à 10 (réserves exclues) | RÉUSSI |
| E2E-15 | Parcours terrain | Résumé inaccessible à la soumission tant que la visite est incomplète | RÉUSSI |
| E2E-16 | Parcours terrain | Soumission encore bloquée : question du ramassage sans réponse | RÉUSSI |
| E2E-17 | Synchronisation | Visite terminée hors ligne : « Enregistré sur ce téléphone. Non encore sauvegardé sur le serveur. » | RÉUSSI |
| E2E-18 | Synchronisation | Hors ligne : rien n’est arrivé en base (0 champ, 0 visite) | RÉUSSI |
| E2E-19 | Synchronisation | File d’envoi : 5 opérations en attente, aucune « reçue » | RÉUSSI |
| E2E-20 | Synchronisation | La file survit à la fermeture et à la réouverture de l’application hors ligne | RÉUSSI |
| E2E-21 | Synchronisation | Retour du réseau : envoi automatique, 5 accusés de réception du serveur | RÉUSSI |
| E2E-22 | Synchronisation | Serveur : champ actif, mêmes blocs tirés que hors ligne | RÉUSSI |
| E2E-23 | Synchronisation | Serveur : mêmes arbres (identifiants et codes) que ceux tirés hors ligne | RÉUSSI |
| E2E-24 | Synchronisation | Serveur : visite SOUMISE, 10 observations, trois dates, appareil tracé | RÉUSSI |
| E2E-25 | Synchronisation | Serveur : réponses conformes à la saisie (3 F Oui, 1 mûre vue, 1 prématurée déclarée, 1 non retrouvé sans stade) | RÉUSSI |
| E2E-26 | Synchronisation | Serveur : marquage GPS reçu | RÉUSSI |
| E2E-27 | Synchronisation | Renvoi forcé des 5 mêmes opérations : aucun doublon en base | RÉUSSI |
| E2E-28 | Synchronisation | Renvoi : le serveur a bien été rappelé et a répondu « rejoué » | RÉUSSI |
| E2E-29 | Synchronisation | Fiche du champ : visite « Soumis », « Reçue par le serveur le … » | RÉUSSI |
| E2E-30 | Parcours terrain | Visite soumise : lecture seule sur l’appareil | RÉUSSI |
| E2E-31 | Sécurité | RT : accès refusé à l’écran, aucun onglet | RÉUSSI |
| E2E-32 | Sécurité | RT : la base ne renvoie aucun champ, aucune visite, aucune observation (RLS) | RÉUSSI |
| E2E-33 | Sécurité | RT : synchronisation refusée par le serveur | RÉUSSI |
| E2E-34 | Sécurité | Unit Head d’un autre cluster : 0 champ après préparation | RÉUSSI |
| E2E-35 | Sécurité | Assistant Unit Head : écran de validation refusé | RÉUSSI |
| E2E-36 | Sécurité | Assistant Unit Head : validation refusée par le serveur même en appel direct | RÉUSSI |
| E2E-37 | Validation | Zonal Head sans affectation : validation refusée, message clair | RÉUSSI |
| E2E-38 | Validation | Branch Manager : affectation de validation accordée au Zonal Head (BROBO) | RÉUSSI |
| E2E-39 | Validation | Demande de correction sans motif : bloquée à l’écran | RÉUSSI |
| E2E-40 | Validation | Correction demandée avec motif, tracée | RÉUSSI |
| E2E-41 | Validation | L’agent voit la demande de correction et son motif | RÉUSSI |
| E2E-42 | Validation | Nouvelle soumission sans dire ce qui a été corrigé : bloquée | RÉUSSI |
| E2E-43 | Validation | Correction soumise : historique avec ancienne valeur, nouvelle valeur, motif, auteur | RÉUSSI |
| E2E-44 | Validation | Zonal Head affecté : visite validée | RÉUSSI |
| E2E-45 | Validation | Qualité : suivi étiqueté « Non officiel », paliers expérimentaux, aucune prévision | RÉUSSI |
| E2E-58 | Sécurité | Téléphone partagé : l’envoi en attente d’un autre compte n’est pas envoyé sous la session courante | RÉUSSI |
| E2E-59 | Sécurité | Téléphone partagé : le brouillon d’un autre compte ne peut pas être repris | RÉUSSI |
| E2E-60 | Synchronisation | Téléphone partagé : rendu à son auteur, l’envoi part sous sa propre identité | RÉUSSI |
| E2E-46 | Affichage | 390×844 · observatoire/qualite : pas de débordement horizontal | RÉUSSI |
| E2E-47 | Affichage | 390×844 · observatoire/validation : pas de débordement horizontal | RÉUSSI |
| E2E-48 | Affichage | 768×1024 · observatoire/qualite : pas de débordement horizontal | RÉUSSI |
| E2E-49 | Affichage | 768×1024 · observatoire/validation : pas de débordement horizontal | RÉUSSI |
| E2E-50 | Affichage | 1440×900 · observatoire/qualite : pas de débordement horizontal | RÉUSSI |
| E2E-51 | Affichage | 1440×900 · observatoire/validation : pas de débordement horizontal | RÉUSSI |
| E2E-52 | Affichage | 390×844 · Mes champs : pas de débordement, boutons d’au moins 40 px | RÉUSSI |
| E2E-57 | Affichage | 390×844 · résumé de visite : chaque valeur reste dans l’écran (lecture en cartes) | RÉUSSI |
| E2E-53 | Non-régression | FIELD BUYING : la rubrique Synchronisation existante s’affiche toujours | RÉUSSI |
| E2E-54 | Non-régression | FIELD BUYING : la vue d’ensemble existante s’affiche toujours | RÉUSSI |
| E2E-55 | Non-régression | File hors ligne FIELD BUYING intacte : aucune opération de l’Observatoire dans anagroci_ops_offline | RÉUSSI |
| E2E-56 | Non-régression | Aucune erreur JavaScript du module pendant tout le parcours | RÉUSSI |

## Détail cœur JavaScript

| Id | Vérification | Résultat |
|---|---|---|
| JS-01 | SHA-256 identique à la référence Node (ASCII, accents, emoji, 200 car.) | RÉUSSI |
| JS-02 | Tirage reproductible : même graine, même résultat | RÉUSSI |
| JS-03 | Tirage sans remise, dans 1..N | RÉUSSI |
| JS-04 | Tirage k > N : limité à N | RÉUSSI |
| JS-05 | Répartition 10 titulaires et 2 réserves sur 2 blocs : 5+1, 5+1 | RÉUSSI |
| JS-06 | Répartition sur 3 blocs : 4+1, 3+1, 3+0 | RÉUSSI |
| JS-07 | Installation refusée si b > B ou repère vide | RÉUSSI |
| JS-08 | Bloc trop petit : incompatibilité, aucun arbre, N non gonflé | RÉUSSI |
| JS-09 | Arbres : 10 titulaires, 2 réserves, probabilité (2/4)×(5/7) | RÉUSSI |
| JS-10 | Semaine ISO : passages d’année (53e semaine, semaine 1) | RÉUSSI |
| JS-11 | Observation vide : aucune réponse préremplie (jamais « Non ») | RÉUSSI |
| JS-12 | Arbres observés : réserve en attente exclue | RÉUSSI |
| JS-13 | Contrôle de visite : ramassage, « Pas vu » sans raison, chute sans preuve détectés | RÉUSSI |
| JS-14 | Contrôle de visite : visite complète acceptée | RÉUSSI |
| JS-15 | Date future refusée | RÉUSSI |
| JS-16 | Charge envoyée : arbre non retrouvé sans stade, preuve retirée hors chute constatée | RÉUSSI |
| JS-17 | Libellé d’envoi : « Non encore sauvegardé » tant que le serveur n’a pas répondu | RÉUSSI |
| JS-18 | Identifiant d’arbre : format UUID, déterministe | RÉUSSI |
| JS-19 | Graine non choisie par l’agent : réinstaller (nouvel identifiant) donne le même tirage | RÉUSSI |
| JS-20 | Installation refusée sans campagne ni parcelle | RÉUSSI |
| JS-21 | Sans graine de campagne, aucun tirage possible sur l’appareil | RÉUSSI |

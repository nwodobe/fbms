# Résultats banc navigateur — lot 1 Sacherie (18/09/2026)

Chromium 1194 (Playwright 1.49.1), vrais fichiers du dépôt, backend local PostgREST 12.2.3 sur la réplique + migrations du lot. Sessions distinctes par poste. Aucune requête vers la production (0 requête bloquée hors banc).

| Test | Session | Action | Attendu | Obtenu | Verdict |
|---|---|---|---|---|---|
| N01 | uh_botro | Chef d’Unité crée une demande (formulaire réel) | Demande soumise | Demande soumise pour RT test Botro 1 : 30 sac(s). Circuit : revue → consolidation → décision BM. / base : REQUESTED/0/0/0 | CONFORME |
| N01-mobile | uh_botro | Formulaire de demande affiché (390×844) | formulaire visible | bouton Soumettre visible | CONFORME |
| N01-tablette | uh_botro | Formulaire de demande affiché (768×1024) | formulaire visible | bouton Soumettre visible | CONFORME |
| N02 | zh | Zonal Head effectue la revue | REVIEWED | REVIEWED/0/0/0 | CONFORME |
| N03 | fboo | Field Buying Operations Officer consolide | CONSOLIDATED | CONSOLIDATED/0/0/0 | CONFORME |
| N04 | bm | Branch Manager approuve | BM_APPROVED | BM_APPROVED/30/0/0 | CONFORME |
| N05 | bm | L’approbateur tente la sortie | refus affiché (séparation des tâches) | Séparation des tâches : approbateur et exécutant doivent être différents / base : BM_APPROVED/30/0/0 | CONFORME |
| N06 | sk_botro | Magasinier enregistre la sortie | Sortie enregistrée | Sortie enregistrée : 30 sac(s). Reste autorisé : 0. / base : FULLY_RELEASED/30/30/0 | CONFORME |
| N07 | uh_diabo | Chef d’Unité d’un autre cluster confirme la réception | refus affiché | Localisation hors périmètre cluster : BOTRO n'est pas votre cluster (DIABO) / base : FULLY_RELEASED/30/30/0 | CONFORME |
| N08 | uh_botro | Réceptionnaire habilité (Chef d’Unité Botro) confirme | reçu 30 | aucun message / base : FULLY_RELEASED/30/30/30 | CONFORME |
| N09 | sk_botro | Magasinier réalise un inventaire (compté 1470) | inventaire enregistré | Inventaire enregistré : PASS · écart 0 sac(s). / inventaires en base : 1 | CONFORME |
| N10 | sk_botro | Magasinier déclare une perte | déclaration SOUMIS | Perte déclarée — le stock reste inchangé jusqu’à la décision du Branch Manager. / base : SOUMIS | CONFORME |
| N11 | bm | Branch Manager décide la perte (autre personne que le déclarant) | APPROUVE | APPROUVE | CONFORME |
| N12 | sk_sans | Magasinier sans cluster ouvre l’inventaire | aucun emplacement proposé (RLS) ; écriture impossible | 0 emplacement(s) proposé(s) | CONFORME |
| N13 | bm | Rôles proposés = rôles reconnus par le serveur et attribuables | 0 valeur hors contrainte ; libellés anciens absents | 17 rôle(s) ; hors contrainte : 0 ; ex. « Magasinier (Storekeeper) » → Storekeeper | CONFORME |
| N14 | bm | Compte à portée limitée sans affectation signalé | badge « Affectation manquante » | badge présent | CONFORME |
| N15 | bm | Attribution Magasinier + cluster Diabo à un compte à qualifier | enregistré + journalisé | Rôle et affectation enregistrés (changement journalisé). / base : Storekeeper/DIABO / journal : 2 | CONFORME |
| N16 | bm | Désactivation du magasinier Diabo | compte désactivé | Compte désactivé : toutes ses actions sont refusées par le serveur. | CONFORME |
| N13-mobile | bm | Comptes et rôles lisible (390×844) | pas de défilement horizontal de page (tableau défilant seul) | débordement page : 0px | CONFORME |
| N13-tablette | bm | Comptes et rôles lisible (768×1024) | pas de défilement horizontal de page (tableau défilant seul) | débordement page : 0px | CONFORME |
| N17 | nouveau | Après habilitation : le nouveau magasinier Diabo inventorie Diabo | succès ; seuls ses emplacements proposés | Inventaire enregistré : PASS · écart 0 sac(s). / emplacements proposés : AFLP-CL-DIABO, AFLP-FACTORY-YAMOUSSOUKRO, JUTE-TRANSIT | CONFORME |
| N18 | sk_diabo | Compte désactivé : accès au module | accès refusé | portail : Compte désactivé. Contactez le Branch Manager. | CONFORME |

Requêtes bloquées (hors banc) : 0
22/22 conformes

## Constat AVANT (front de `main` + réplique identique à la production)

| Test | Session | Obtenu |
|---|---|---|
| AV1 | uh_botro | « Création non autorisée. Votre profil (Unit Head) ne permet pas de modifier le référentiel terrain. » |
| AV2 | sk_botro | « Création non autorisée. Votre profil (Storekeeper) ne permet pas de modifier le référentiel terrain. » |
| AV3 | bm | « null value in column "request_code" … violates not-null constraint » : aucune demande créable, même par le BM |
| AV4 | bm | 15 options proposées ; choix « Warehouse Keeper » → « violates check constraint profils_role_check » (erreur brute) |

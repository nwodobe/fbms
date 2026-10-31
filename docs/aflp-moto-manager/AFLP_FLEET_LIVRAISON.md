# AFLP FLEET : rapport de livraison (mandat du 31/10/2026)

## A. État du système initial (audit du 31/10/2026)

| Catégorie | Constat |
|---|---|
| Opérationnel en production | Module AFLP Moto Manager publié (PR #266), base appliquée : 23 tables, 12 vues, RLS partout, 0 moto, 0 document. Passeport, documents privés, préaffectation, remise avec PV, mise en service, contrôle avant départ, carburant plein à plein, dotations, maintenance, pneus, incidents, formation, hors ligne idempotent. |
| Présent mais incomplet | Photo de moto (aucun champ) ; inspection initiale sans photos ; pas d'état contradictoire ; pas d'inspection mensuelle ; pas d'action corrective suivie ; pneus sans date DOT ; QR non lié à l'application. |
| Absent | Rôle coordinateur logistique côté moto (le rôle `LOGISTICS_COORDINATOR` n'existe que dans `shared/aflp-access.js` ; la contrainte `profils_role_check` ne le contient pas, aucun compte ne l'a) ; acquisition prévue ; moto déjà en exploitation ; enveloppes du coordinateur ; vue d'exceptions du BM. |
| Faille confirmée | `private.moto_items_valides` décidait la gravité à partir du champ `critique` **envoyé par le client** : un client modifié pouvait déclarer « freins HS » non critique et éviter l'immobilisation. Codes inconnus, doublons et points omis étaient acceptés. |
| Écart de périmètre | Le Chef de zone pouvait écrire sur toutes les motos (portée terrain globale), ce que le scénario 11 interdit. |
| Réutilisable | Journal immuable, file hors ligne, stockage privé, quatre yeux, circuit incident, vues de coût et disponibilité. |

Options comparées : extension du module (retenue : données, droits et hors ligne déjà éprouvés), sous-module séparé (doublerait authentification et stockage), reconstruction (aucune justification technique).

## B. Modifications réalisées (branche `feat/aflp-fleet`)

| Fichier | Nature |
|---|---|
| `supabase/20261101090000_aflp_fleet_5_coordination_inspections.sql` | Migration additive : catalogue serveur, classe LOGISTIQUE, situation du parc, dates distinctes, photos, état contradictoire, inspections mensuelles, actions correctives, enveloppes et dépenses, vues, droits |
| `supabase/20261101090100_aflp_fleet_5_rollback.sql` | Retour arrière (refuse s'il existe des données AFLP FLEET) |
| `moto/moto-core.js`, `moto/moto-app.js`, `moto/moto-offline.js`, `moto/moto.css`, `moto/index.html` | Identité AFLP FLEET, formulaires avec photo et aperçu, parcours « moto en exploitation », état contradictoire et confirmation du bénéficiaire, inspections mensuelles avec comparaison, espace Coordination, exceptions BM, rapport mensuel Excel, photos multiples hors ligne |
| `index.html` | Carte du portail renommée AFLP FLEET |
| `tests/moto/*` | 306 scénarios serveur, 17 tests unitaires, 69 étapes navigateur, preuve du retour arrière |
| `docs/aflp-moto-manager/AFLP_FLEET_GUIDE.md` | Guide par rôle |

Noms techniques (`moto_*`, `/moto/`) inchangés : aucune rupture de lien.

## C. Architecture et droits

- **Coordinateur logistique** : reconnu par `profils.fonction_operationnelle = 'Logistics Coordinator'` (mécanisme déjà utilisé par la sacherie). Aucun rôle FBMS ni contrainte modifiée.
- Il peut : voir tout le parc, enregistrer, réceptionner, photographier, inspecter (20 à fin du mois), signaler, planifier, réaliser et vérifier les actions (jamais son propre travail), faire la remise physique, demander une maintenance, gérer les pneus, demander ses enveloppes, déclarer et justifier ses dépenses, exporter.
- Il ne peut pas : mettre en service, lever une immobilisation, préaffecter, décider une maintenance, approuver une enveloppe, valider une dépense, modifier un paramètre, lire les dotations Finance, inspecter sa propre moto.
- **Inspections** : ZONE (Chef de zone, motos des Chefs d'unité de **sa** zone, 1 au 15), COORDINATION (coordinateur, toutes les motos actives sauf la sienne, 20 à fin), INDÉPENDANTE (BM, ABM ou inspecteur désigné, moto du coordinateur). Une par moto, par mois et par niveau ; correction motivée et tracée. Résultat calculé par le serveur ; une anomalie ouverte interdit « Conforme ».
- **Séparations** : état contradictoire jamais saisi par le bénéficiaire ; remise jamais enregistrée par le bénéficiaire ; vérification d'action ≠ réalisateur ; levée d'immobilisation ≠ auteur du contrôle de remise en service et exige l'anomalie critique vérifiée ; enveloppe approuvée ≠ demandeur ≠ titulaire ; dépense validée ≠ déclarant.
- **Chef de zone** : lecture globale conservée (décision du 17/09/2026), écriture limitée à sa zone et à sa propre moto.

## D. Migrations et sécurité

- Appliquer : migration 5 uniquement (les migrations 1 à 4 sont en production). Rejouable (testé deux fois).
- Retour arrière : `20261101090100_aflp_fleet_5_rollback.sql` puis rejouer 1, 2, 3, 4. Prouvé par `tests/moto/verifier_rollback_5.sh` : fonctions, droits, vues et politiques identiques à l'état 1-4.
- Correctif du champ `critique` : `private.moto_items_controles(type, items)` lit la gravité dans `moto_catalogue_points`, rejette codes inconnus, doublons, points obligatoires absents ; l'ancienne fonction est neutralisée.

## E. Rapport de tests (exécutés sur réplique locale, aucune donnée réelle)

| Suite | Résultat | Preuve |
|---|---|---|
| Serveur (RLS active, rôle `authenticated`) | 318/318 | `tests/moto/resultats/serveur.json` |
| Unitaires cœur | 17/17 | `tests/moto/resultats/unitaires.txt` |
| Navigateur Chromium, 3 largeurs | 69/69, 0 erreur console | `tests/moto/resultats/navigateur.json`, captures |
| Retour arrière | Vérifié | `tests/moto/verifier_rollback_5.sh` |
| Portes qualité HTML, liens, JS | 0 nouveau défaut | sorties des scripts `.github/scripts` |

Les 25 scénarios du mandat : 1-2 (UI-PORT, UI-FL-01), 3 (FL-03a à f, UI-FL-03), 4-5 (FL-04, FL-05), 6-7 (FL-06, FL-07, UI-FL-06), 8 (FL-06e, UI-ETAT-01), 9 (FL-09b, UI-ETAT), 10 (FL-10, UI-FL-10), 11 (FL-11a à e), 12 (FL-12, UI-FL-10), 13 (FL-13d à f, UI-FL-13), 14 (FL-14a à g), 15 (FL-15a à f), 16 (FL-16), 17 (FL-17a-b), 18 (FL-18a à g, FL-REG), 19 (FL-19a à e, UI-FL-13), 20 (FL-20a à l, UI-FL-20), 21 (FL-21a à k), 22 (FL-22), 23 (FL-23), 24 (FL-24), 25 (FL-25a à d, photos hors ligne via la file locale).

Revue de sécurité indépendante (agent distinct, en lecture seule) : premier verdict NO_GO, avec 7 défauts. Tous ont été corrigés et sont couverts par les tests RV-01 à RV-06 :
1. Un Chef d'unité qui portait la fonction « coordinateur » devenait coordinateur. Désormais ZONE et UNITE sont prioritaires.
2. L'utilisateur d'une moto pouvait contrôler, débloquer ou vérifier sa propre moto. La règle d'indépendance couvre aussi le circuit incident et la fin de maintenance.
3. Une anomalie critique pouvait être annulée par une seule personne. C'est désormais impossible.
4. Les justificatifs de dépenses d'autrui étaient lisibles. La politique de stockage est corrigée.
5. Une même photo pouvait servir pour plusieurs vues, ou être réutilisée. C'est refusé.
6. Une facture pouvait justifier plusieurs dépenses. Chaque facture est désormais unique.

Contre-revue : corrections confirmées, 318/318 rejoués par le relecteur, retour arrière identique. Son verdict est HUMAN_REVIEW, pour deux raisons : la zone `supabase/**` est sensible, et l'usage de `fonction_operationnelle` doit être décidé explicitement. Sur le second point, la décision retenue est la suivante. Seul le Branch Manager peut modifier ce champ, ce qui a été vérifié en production (politiques RLS de `profils` et garde `profils_garde_habilitations`). Il désigne le coordinateur sans créer de nouveau rôle ni toucher à `auth-gate.js`. Limite acceptée : il n'existe pas de preuve « rouge avant correction » des tests RV.

Anomalies trouvées et corrigées pendant la recette : préaffectation à un Supervisor acceptée (comparaison avec NULL, corrigée), auto-remise possible pour l'ABM (interdite), ordre des contrôles de remise, réutilisation du gestionnaire de clics entre écrans.

## F. Guide utilisateur

Voir `AFLP_FLEET_GUIDE.md`.

## G. Limites connues et actions humaines requises

1. **Zone du Chef de zone JACKSON non renseignée** dans son profil FBMS : tant qu'elle ne l'est pas, il ne peut inspecter ni agir sur aucune moto (hors la sienne). Action BM dans l'administration FBMS.
2. **Aucun compte coordinateur** n'existe : créer ou désigner le compte (fonction opérationnelle « Logistics Coordinator »). D'ici là, les inspections COORDINATION apparaîtront « non effectuées », ce qui est exact.
3. Réception physique des 4 APSONIC et données de la moto de JACKSON : non vérifiables depuis l'application (0 moto en base). À saisir par l'équipe, rien n'a été inventé.
4. Exigibilité calculée avec l'affectataire **actuel** (un transfert en cours de mois n'est pas reconstitué).
5. Montants d'enveloppes : aucun montant par défaut, faute de source.
6. Tests sur vrais téléphones Android et iPhone : non réalisés (émulation de largeur seulement).
7. OCR : non proposé (fiabilité non démontrée) ; saisie manuelle et QR.

## Mise en production (31/10/2026)

- Migration 5 appliquée en production sur autorisation écrite de M. KOUASSI, en plusieurs parties. Pour les politiques déjà existantes, la commande `alter policy` a remplacé le couple suppression puis recréation.
- Contrôle d'équivalence avec la réplique testée : 106 fonctions, empreinte du code et des droits identique (`16ce54dc…`). Mêmes nombres d'objets : 28 tables, 15 vues, 30 politiques, 25 déclencheurs de journal, 57 points de catalogue.
- Sécurité : RLS active sur toutes les tables moto ; aucune écriture directe ; aucune fonction exécutable par `anon` ; `search_path` figé sur toutes les fonctions.
- Les avertissements « SECURITY DEFINER exécutable par authenticated » du conseiller Supabase sont attendus : ces fonctions sont l'interface prévue, et chacune vérifie le rôle et le périmètre côté serveur.

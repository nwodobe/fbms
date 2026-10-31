# AFLP FLEET phase 2 : maintenance, garages, autorisation BM (rapport de livraison)

Mandat : « AFLP FLEET | PHASE 2 » (31/10/2026). Branche `feat/aflp-fleet-maintenance`.
**Statut de déploiement : développé et testé sur réplique locale ; NON appliqué en production, NON fusionné** (le mandat n'autorise ni migration ni déploiement).

## A. Audit initial (production lue le 31/10/2026, lecture seule)

| Constat | Où | Gravité | Écart au mandat |
|---|---|---|---|
| `moto_maintenance_decider` accepte **BM, ZONE et ABM**, sans montant ni plafond | production, fonction issue de la migration 2 | Critique | §3.D, §11 : seul le BM autorise |
| `moto_incident_avancer('AUTORISATION_DEPENSE')` accepte le **Chef de zone**, montant libre | migration 5 | Critique | §3.D |
| `moto_maintenance_terminer` lève l'immobilisation par une **case cochée** (`remettre_en_service`) | migration 5 | Majeur | §13 |
| Dépenses d'enveloppe, coût d'action corrective, achat et réparation de pneu : **aucun lien** avec une autorisation BM | migrations 2 et 5 | Critique | §11, §12 |
| Échéances : toutes les règles appliquées à **toutes** les motos (produit cartésien), sans modèle ; base = dernière maintenance *terminée* (non vérifiée) ou compteur de remise même pour une moto en exploitation | vue `moto_v_echeances` | Majeur | §5, §6 |
| Une seule « maintenance » = un type : pas de visite groupée, une vidange ne peut pas être distinguée d'une révision faite le même jour | `moto_maintenances` | Majeur | §6, §8 |
| Aucune gestion de garage, de devis, de facture distincte, de paiement constaté | — | Majeur | §9, §10, §12 |
| Coût de flotte = `cout_reel` saisi librement + coût d'incident saisi librement + pneus : double comptage possible | `moto_v_couts` | Majeur | §12 |
| 3 règles d'entretien inactives, sans intervalle (VIDANGE, ENTRETIEN, REVISION) | `moto_regles_maintenance` | Information | conforme : rien d'actif |
| Données : **0 moto, 0 maintenance, 0 enveloppe, 0 dépense, 0 incident** | production | — | aucune exposition réelle à ce jour |

Les failles financières sont donc **présentes en production mais sans effet à ce jour**, faute de données. Elles deviendront effectives à la première moto saisie : la migration 6 doit être appliquée avant.

Documentation constructeur : **manuel APSONIC AP150-30 introuvable en ligne** (recherches du 31/10/2026). Aucune prescription constructeur n'est enregistrée ; voir C.

## B. Modifications réalisées

| Fichier | Nature |
|---|---|
| `supabase/20261102090000_aflp_fleet_6_maintenance_autorisations.sql` | Migration additive et rejouable : modèles techniques, règles versionnées, garages, dossier de maintenance étendu (10 étapes), travaux individuels, autorisations BM, factures, paiements constatés, moteur d'échéances, vues financières, politique de stockage `finmaint/`, neutralisation des anciens chemins |
| `supabase/20261102090100_aflp_fleet_6_rollback.sql` | Retour arrière : refuse s'il existe des données du nouveau circuit ; restaure au texte près fonctions et vues d'origine |
| `moto/moto-maintenance.js` (nouveau) | Espace « Maintenance » : tableau de bord coordinateur, Décisions à prendre (BM), dossiers, garages, règles |
| `moto/moto-app.js`, `moto/moto-core.js`, `moto/moto.css`, `moto/index.html` | Branchement, droits d'interface alignés sur le serveur, incident sans montant, bloc décisions dans le Pilotage, cache `20261102-maint-1` |
| `tests/moto/tests_maintenance_6.py` (nouveau) | 169 contrôles serveur : 25 scénarios du mandat + adversariaux |
| `tests/moto/tests_serveur_moto.py` | Régression adaptée (349) ; comportements volontairement modifiés marqués « M6 » |
| `tests/moto/verifier_rollback_6.sh` (nouveau) | Preuve du retour arrière |
| `tests/moto/e2e/*` | 9 étapes navigateur maintenance + 3 écrans aux 3 largeurs |
| `docs/aflp-moto-manager/AFLP_FLEET_GUIDE.md` | Guide par rôle (section « Maintenance et dépenses ») |

Commits : `235b573` (migration et recette serveur), `7f5358d` (interface), `b8b05f1` (nettoyage), puis corrections de la contre-expertise (section F).

Choix d'architecture des garages (§9) : **catalogue léger + indicateurs dérivés des dossiers**. Comparé à un simple catalogue (ne couvre ni délais réels, ni factures, ni réparations répétées) et à un suivi complet de prestataire (évaluations périodiques, contrats, notation : surcharge sans donnée aujourd'hui). Les prestations, délais, montants justifiés et réparations répétées sont calculés depuis les dossiers, jamais saisis.

## C. Politique de maintenance par modèle

| Modèle | Opération | Prescription constructeur | Valeur du mandat | Statut en base | Décision requise |
|---|---|---|---|---|---|
| APSONIC AP150-30 | Vidange | **Non trouvée** | 1 500 km / 60 j | Brouillon, `HYPOTHESE`, inactif | Validation technique (garage de référence ou concessionnaire APSONIC), puis approbation BM en `POLITIQUE_INTERNE` ou `CONSTRUCTEUR` avec référence |
| APSONIC AP150-30 | Entretien préventif | Non trouvée | 1 000 km / 30 j | Brouillon, `HYPOTHESE` | idem |
| APSONIC AP150-30 | Révision générale | Non trouvée | 5 000 km / 180 j (préavis 500 km) | Brouillon, `HYPOTHESE` | idem |
| APSONIC AP150-30 | Vidange de rodage | Non trouvée | aucune | aucune version | À obtenir du concessionnaire (carnet de garantie) ; phase `RODAGE` prévue |
| Moto ANAGROCI (JACKSON) | toutes | modèle inconnu | aucune | « Diagnostic initial et historique d'entretien à établir » | Diagnostic au garage, puis exception documentée par moto ou association à un modèle |

Garanties techniques : une `HYPOTHESE` ne peut pas être approuvée (refus serveur) ; une règle `CONSTRUCTEUR` exige une référence ; une règle ne s'applique qu'aux motos explicitement associées à son modèle (marque et modèle vérifiés par le serveur) ou à une moto désignée (exception documentée) ; chaque approbation crée une version, la précédente est conservée (`REMPLACEE`).

Calcul (vue `moto_v_echeances`) : premier seuil atteint (km ou jours) ; base = dernière opération **réalisée et contrôlée conforme**, sinon mise en service réelle pour une moto neuve, sinon « état de référence requis » (moto en exploitation) ; une vidange n'actualise que la vidange ; alertes configurables par version (rappel, proche, atteinte, dépassée) ; fiabilité signalée (base, compteur relevé depuis plus de 14 jours).

À fournir par l'équipe : le carnet d'entretien et de garantie APSONIC remis à la livraison (photo des pages « entretien périodique ») ; c'est la source attendue pour passer en `CONSTRUCTEUR`.

## D. Circuit opérationnel

1. **Besoin identifié** (terrain, inspection, coordinateur ; aussi hors connexion, comme simple signalement) → `DEMANDEE`.
2. **Diagnostic à organiser** → `DIAGNOSTIC`. Diagnostic payant : demande d'autorisation BM d'objet `DIAGNOSTIC`.
3. **Devis reçu** : garage, opérations, pièces, main-d'œuvre, montant, justification, urgence, conséquence d'un report, date souhaitée, pièce privée → `DEVIS_RECU`.
4. **En attente BM** : soumission par le coordinateur ou l'ABM (jamais par le BM) → `EN_ATTENTE_BM`. Aucun engagement possible.
5. **Autorisé** par le BM : nominatif, horodaté, moto, garage, périmètre, montant maximal → `AUTORISEE`. Refus motivé → `REFUSEE`.
6. **Travaux programmés** : montant engagé ≤ total autorisé, garage autorisé uniquement → `PROGRAMMEE`.
7. **Travaux effectués** : chaque opération déclarée réalisée ou non, compteur réel, pièces → `TERMINEE`. Supplément : nouvelle autorisation BM avant tout engagement complémentaire.
8. **Contrôle technique** par un tiers (ni le déclarant, ni l'utilisateur) → `CONTROLEE` ; non conforme → reprise (`EN_COURS`).
9. **Justificatifs vérifiés** : facture déposée (numéro unique par garage, pièce unique), vérifiée par l'ABM ou la Finance, jamais au-delà du montant autorisé ; paiement constaté par la Finance.
10. **Clôture financière** (`CLOTUREE`) par l'ABM ou la Finance. **Remise en circulation** : décision distincte (contrôle de remise en service APTE, aucune anomalie critique ouverte, levée par une autre personne).

Urgence : incident critique → immobilisation immédiate (inchangé) ; l'étape « dépense autorisée » de l'incident constate une autorisation BM existante dans un dossier lié ; la remise en service de l'incident exige des travaux liés contrôlés conformes.

## E. Matrice des droits (vérifiée côté serveur)

| Opération | BM | ABM | Coordinateur | Chef de zone | Chef d'unité | Finance |
|---|---|---|---|---|---|---|
| Signaler un besoin | ✓ | ✓ | ✓ | ✓ (sa zone) | ✓ (sa moto) | — |
| Devis, diagnostic, garage | ✓ | ✓ | ✓ | — | — | — |
| Soumettre au BM | — | ✓ | ✓ | — | — | — |
| **Autoriser une dépense** | **✓ seul** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Engager (programmer) | ✓ ¹ | ✓ ¹ | ✓ ¹ | ✗ | ✗ | ✗ |
| Déclarer les travaux | ✓ | ✓ | ✓ | — | — | — |
| Contrôler les travaux | ✓ ² | ✓ ² | ✓ ² | ✓ ² | — | — |
| Déposer une facture | ✓ | ✓ | ✓ | — | — | — |
| Vérifier une facture | — | ✓ ² | — | — | — | ✓ ² |
| Constater un paiement | — | — | — | — | — | ✓ |
| Approuver règle / garage | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Lever une immobilisation | ✓ ² | — | ✗ | ✓ ² | — | — |

¹ uniquement dans le plafond d'une autorisation BM existante. ² jamais sur son propre travail ni sur la moto dont on est l'utilisateur.

Démonstration (tests exécutés) : S10b, S11a-c, S12a-b, ADV-01 à ADV-03, ADV-07, ADV-12, MNT-02 à 02c. Toute fonction qui fait apparaître un montant de maintenance (`programmer`, `depense_declarer` nature maintenance, `action_realiser`, `pneu_creer`, `pneu_reparation`, `facture_verifier`) exige une autorisation BM `AUTORISEE` et en respecte le plafond. Aucune écriture directe n'est permise (RLS active, aucun privilège d'écriture).

## F. Résultats des tests (réplique locale, aucune donnée réelle)

| Suite | Résultat | Preuve |
|---|---|---|
| Migration 6 : 25 scénarios + adversariaux + contre-épreuves de la revue + concurrence | **204/204** | `tests/moto/resultats/maintenance_6.json` |
| Concurrence sans verrous (preuve que les tests détectent la faille) | CONC-A et CONC-B **échouent** (10 000 réglés / vérifiés pour 5 000) | `tests/moto/resultats/maintenance_6_preuve_sans_verrous.json` |
| Régression serveur (comportements M6 inclus) | **352/352** | `tests/moto/resultats/serveur.json` |
| Navigateur Chromium, 3 largeurs | **87/87**, 0 erreur console (un passage à 86/87 juste après un redémarrage de la base : délai dépassé sur UI-MNT-05, état serveur correct ; 87/87 au passage suivant) | `tests/moto/resultats/navigateur.json`, captures `maintenance-*`, `decisions-bm-*`, `entretiens-*` |
| Unitaires cœur | 17/17 | `node tests/moto/core.test.mjs` |
| Retour arrière | empreinte identique à l'état actuel (1-5) | `tests/moto/verifier_rollback_6.sh` |
| Portes HTML, liens, JS, pages ×3 | 0 nouveau défaut | `.github/scripts/verifier-*.mjs` |

Correspondance des 25 scénarios : 1 (S01a-c) · 2 (S02a-i) · 3 (S03a-i, ADV-13 à 16) · 4 (S04a-b) · 5 (S05-1050 à 1501, S05b) · 6 (S06a-b) · 7 (S07a-c, ADV-17) · 8 (S08a-g) · 9 (S09a-g, UI-MNT-05) · 10 (S10a-b, ADV-07 à 09) · 11 (S11a-c, ADV-01 à 03, ADV-11-12, UI-MNT-06) · 12 (S12a-c) · 13 (S13a-d) · 14 (S14a-g, ADV-10) · 15 (S15a-f, ADV-04 à 06, UI-MNT-07-08) · 16 (S16a-e) · 17 (S17a-c) · 18 (S18a-h) · 19 (S19a-l) · 20 (S20a-g) · 21 (S21a-h, ADV-18) · 22 (S22a-d, ADV-16) · 23 (régression 349/349, ADV-19-20, 87/87) · 24 (S24a-f, UI-MNT-09) · 25 (S25a-k, GAR-06).

Anomalies trouvées et corrigées pendant la recette : devis complémentaire qui écrasait le devis initial (estimation fausse) ; mise à jour d'un garage qui effaçait ses clusters ; statut « à jour » affiché quand le compteur est inconnu ; diagnostic payant sans ligne de travaux ; montant « engagé non facturé » négatif ; exception documentée impossible pour une moto sans modèle (JACKSON) ; colonnes de coût absentes du tableau de bord.

Réserve d'environnement : la réplique locale avait le compilateur JIT actif, ce qui bloquait les vues complexes ; la production a `jit = off` (vérifié). Les bases de test sont désormais alignées.

### Contre-expertise indépendante (§19)

Agent distinct, sans accès en écriture au dépôt, preuves exécutées sur des copies de la réplique.

1. **Premier verdict NO_GO (12 défauts)**, dont deux critiques. Une autorisation de 10 000 a permis de tracer 50 000 (enveloppe, facture, pneu, actions). Une réparation déclarée « supervision » échappait au BM. Corrections :
   - la facture devient l'unique pièce d'argent ;
   - une moto citée impose la nature maintenance ;
   - rien ne peut être daté avant la décision BM ;
   - l'annulation rend les autorisations caduques ;
   - garage du devis seul, jamais suspendu ;
   - « sans frais » = décision BM ;
   - droits par colonne et vues financières filtrées ;
   - quatre séparations des tâches ajoutées ; incident lié à la même moto.
2. **Second verdict NO_GO** : double règlement et double vérification **concurrents**. Corrections : verrous sur la facture et sur le dossier ; une facture n'est couverte que par les autorisations décidées à sa date ; aucun engagement chez un garage suspendu. Tests de concurrence réels, rouges sans verrous.
3. **Troisième verdict HUMAN_REVIEW.** A et B sont corrigés. L'interblocage mineur entre décision BM et annulation est corrigé (ordre de verrouillage unique : dossier puis autorisation). Point soumis au Branch Manager : libellé libre en supervision. **Décision du BM (31/10/2026) : bloquer côté serveur les libellés de réparation en supervision** (tests R02d, R02e ; carburant, transport, hébergement et ration restent acceptés).

Risques résiduels acceptés :
- un libellé de supervision volontairement maquillé reste détectable seulement à la vérification ABM/Finance ;
- le Chef de zone lit le coût d'achat des pneus (visibilité de la phase 1) ;
- régler un garage en espèces sur l'enveloppe exige d'abord une facture vérifiée (contrôle voulu, plus lourd pour le coordinateur) ;
- le retour arrière ne réactive pas d'anciennes règles (`actif` = false en production, vérifié).

## G. Guide de prise en main

`docs/aflp-moto-manager/AFLP_FLEET_GUIDE.md`, section « Maintenance et dépenses » (coordinateur, Branch Manager, Chef de zone, ABM, Finance).

## H. Déploiement (en attente d'autorisation)

1. Autorisation écrite du Branch Manager pour la migration 6 **et** pour la fusion.
2. Appliquer `20261102090000_aflp_fleet_6_maintenance_autorisations.sql` (rejouable). Vérifier ensuite : fonctions, droits `anon` = 0, RLS sur les 6 nouvelles tables, 3 brouillons `HYPOTHESE`, 0 version approuvée.
3. Fusionner la PR (publication GitHub Pages : interface `20261102-maint-1`).
4. **Ordre impératif** : migration avant interface. L'interface seule appellerait des fonctions absentes ; la migration seule garde l'ancienne interface fonctionnelle sauf « Décider » (neutralisé, comportement voulu).
5. Retour arrière : `20261102090100_aflp_fleet_6_rollback.sql`, puis rejouer la migration 5. Refusé dès qu'un dossier du nouveau circuit existe. **Rétablit les failles** décrites en A.

## I. Statuts

| Élément | Développé | Testé | Prêt pour déploiement | Déployé en production |
|---|---|---|---|---|
| Autorisation individuelle BM, tous chemins | ✓ | ✓ | ✓ | ✗ |
| Dossier 10 étapes, travaux groupés, supplément | ✓ | ✓ | ✓ | ✗ |
| Règles par modèle, versions, exceptions, rodage | ✓ | ✓ | ✓ | ✗ |
| Moteur d'échéances et alertes | ✓ | ✓ | ✓ | ✗ |
| Garages | ✓ | ✓ | ✓ | ✗ |
| Six montants, anti double comptage | ✓ | ✓ | ✓ | ✗ |
| Tableau coordinateur, Décisions BM, synthèse hebdomadaire | ✓ | ✓ (3 largeurs) | ✓ | ✗ |
| Intervalles APSONIC validés | ✗ | — | — | ✗ (source constructeur manquante) |

Statut global : **PARTIELLEMENT TERMINÉ** : tout ce que le mandat autorise est terminé et testé ; la mise en production et la validation constructeur des intervalles restent des décisions humaines.

Limites connues : notifications seulement dans le tableau de bord (pas de SMS ni de courriel) ; tests sur vrais téléphones non réalisés ; la synthèse hebdomadaire est une vue consultable, pas un envoi automatique ; une dépense de garage étiquetée « supervision » sur une enveloppe de supervision n'est détectable qu'à la vérification (ABM/Finance) ; la file hors ligne ne transporte que la demande, jamais une décision.

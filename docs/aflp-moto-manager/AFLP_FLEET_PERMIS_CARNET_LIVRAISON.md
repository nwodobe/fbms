# AFLP FLEET : documents scannés, permis des conducteurs, carnet de suivi (rapport de livraison)

**Demande du Branch Manager (1er novembre 2026) :**
- scanner les documents de la moto dès son enregistrement ;
- faire de même pour le permis du conducteur, avec ses informations ;
- vérifier l'existence d'un carnet de suivi qui retrace l'historique et le coût des interventions de chaque moto.

**Statut : développé, testé, contre-expertisé (verdict GO) ; migration 7 NON appliquée en production, NON fusionné.**

## A. Constat initial

| Besoin | Avant | Écart |
|---|---|---|
| Scan des documents de la moto | Dépôt d'un fichier ou d'une photo à la fois, après la création, depuis le passeport | Pas de multi-pages, pas de recadrage, rien à l'enregistrement |
| Permis du conducteur | Case « permis vérifié par les RH », catégorie et nom du vérificateur saisis à la main lors de la remise | Ni numéro, ni date d'expiration, ni scan ; le serveur se fiait à la case |
| Carnet de suivi | Historique réparti dans 6 onglets ; montants des interventions absents du passeport | Pas de vue chronologique unique, pas de coût par moto, pas d'export |

## B. Réalisé

**Scanner** (`moto/moto-scan.js`)
- Source : caméra, galerie ou PDF existant (en-tête `%PDF` contrôlé).
- Jusqu'à 6 pages.
- Retouches : recadrage à quatre poignées, rotation, ordre des pages, mode document (gris contrasté).
- Le PDF est écrit sur l'appareil, sans bibliothèque externe, et fonctionne hors réseau. La photo est réduite dès son chargement pour ménager la mémoire du téléphone.
- Où : carte grise, assurance et plaque à l'enregistrement, à l'intégration et à la réception d'une moto ; onglet Documents ; permis.

**Pas de lecture automatique (OCR).** Le choix est volontaire : elle n'a pas pu être éprouvée sur de vrais documents ivoiriens. Les champs sont recopiés en lisant le scan.

**Permis du conducteur** (migration 7 et `moto/moto-permis.js`)
- Le permis est rattaché à la personne : nom tel qu'imprimé, numéro, catégories, délivrance, expiration (ou « aucune date sur le document »), autorité, scan.
- **Dépôt** : par le titulaire lui-même, ou par le BM, l'ABM ou le coordinateur.
- **Vérification sur l'original** : par l'ABM ou le BM, jamais par le déposant ni par le titulaire. Le nom de la personne RH qui a vu l'original est enregistré, et la catégorie adaptée est confirmée.
- **Renouvellement** : l'ancien permis reste valable jusqu'au contrôle du nouveau.
- **Retrait** (BM ou ABM, motif obligatoire) : effet immédiat ; le numéro reste bloqué. **Levée du retrait** : BM seul ; elle ne rend pas le permis valide, il faut le redéposer.
- **Annulation pour erreur de titulaire** (BM, motif détaillé) : libère le numéro pour son vrai titulaire.
- **Règle des quatre yeux** : la personne qui a libéré un numéro, par annulation ou par rejet du dépôt d'un autre titulaire, ne valide pas un dépôt portant ce numéro. Un numéro disputé est tranché par l'ABM.
- **Remise et transfert** : le serveur exige un permis CONFORME et en cours de validité. Ce contrôle s'applique à toute création ou modification d'une affectation active. La catégorie et le vérificateur sont repris du permis enregistré.
- **Alertes** : conducteur affecté sans permis valide, permis expiré, retiré, ou qui expire dans moins de 30 jours (seuil réglable).
- **Confidentialité** :
  - lecture : BM, ABM, coordinateur et le titulaire lui-même ; ni Chef de zone, ni Finance, ni Direction ;
  - journal d'audit : il garde les décisions et leurs motifs, sans nom, numéro ni chemin de scan ;
  - scans : stockés en `permis/<titulaire>/<identifiant>.pdf`.

**Carnet de suivi** (fonction `moto_carnet` et `moto/moto-carnet.js`)
- **Contenu** : chronologie complète de la moto :
  - réception, affectations et permis, mise en service ;
  - inspections et anomalies ;
  - entretiens : besoin, travaux, contrôle, clôture ;
  - décisions du BM, factures et paiements ;
  - pneus, carburant (un total par mois), incidents, immobilisations, documents.
- **Synthèse** : coût d'entretien documenté (factures vérifiées, comptées une seule fois), carburant vérifié, coût par km, nombre d'interventions, jours d'immobilisation, engagé non facturé.
- **Outils** : filtres par rubrique, export Excel (Synthèse et Carnet), impression du seul carnet.
- **Droits** : le Chef de zone et le Chef d'unité voient la chronologie technique, sans décision, facture ni montant d'entretien.
- **Moto sans historique (cas JACKSON)** : aucun événement n'est reconstitué avant le début du suivi fiable.

## C. Recette (réplique locale, données fictives)

| Suite | Résultat |
|---|---|
| Régression serveur (phase 1) | 352/352 |
| Migration 6 | 204/204 |
| Migration 7 : permis, garde de remise, stockage, carnet, contre-épreuves de 6 revues | **140/140** |
| Navigateur Chromium, 390 / 768 / 1440 px | **102/102**, 0 erreur console |
| PDF produits par le scanner | valides, 2 pages (contrôle pypdf) |
| Retrait et vérification simultanés (`tests/moto/concurrence_permis_7.py`) | aucun interblocage |
| Retour arrière 7 | empreinte identique à la production actuelle (fonctions, droits, vues, politiques, stockage, colonnes, contraintes) |
| Contre-épreuve | sans le déclencheur, une remise sans permis valide passe : les tests le détectent |

Deux anciens tests dépendaient du jour d'exécution (dimanche, 1er du mois). Ils ont été rendus indépendants du calendrier ; le même écart existait sans la migration 7.

## D. Contre-expertise indépendante

| Revue | Verdict | Défauts relevés, tous corrigés |
|---|---|---|
| 1 | **NO_GO** | Fuite des permis par le journal d'audit · doublon de numéro en changeant l'écriture · permis conforme impossible à retirer · 6 défauts mineurs (déclencheur, alertes, stockage, retour arrière, index, saisies) |
| 2 | **NO_GO** | Un permis retiré était réactivé par simple redépôt |
| 3 | **HUMAN_REVIEW** | Numéro repris par un tiers après levée · interblocage possible · quatre yeux après levée |
| 4 | **HUMAN_REVIEW** | Numéro validé à tort pour un tiers, sans recours (impasse) |
| 5 | **HUMAN_REVIEW** | Annulation suivie d'une validation par le même BM |
| 6 | **HUMAN_REVIEW** | Rejet abusif suivi d'une validation par le même BM |
| 7 | **GO** | Aucun chemin trouvé pour une personne seule |

**Limite acceptée.** Si le BM et l'ABM ont chacun rejeté un tiers sur le même numéro, plus personne ne peut valider le vrai titulaire dans l'application. Le blocage est sûr (rien de faux n'est validé). Procédure : la Direction, ou un second BM, annule pour erreur de titulaire, puis l'ABM revalide. À défaut, l'administrateur intervient avec une trace écrite.

## E. Décisions et actions humaines restantes

1. **RH** : catégorie exigée pour une APSONIC AP150-30 de 150 cm³ (A ou A1). Elle n'est pas codée en dur ; le vérificateur l'atteste.
2. **Avant les premières remises** : chaque Chef d'unité doit avoir scanné son permis, et l'ABM ou le BM doit l'avoir contrôlé sur l'original. Sinon, le serveur refuse la remise.
3. **OCR** : à envisager seulement après une mesure sur les vraies cartes grises et sur quelques permis.
4. **Hors connexion** : le scan fonctionne, mais l'envoi d'un document ou d'un permis exige le réseau.
5. **Mise en production** : migration 7 (`supabase/20261103090000_aflp_fleet_7_permis_carnet.sql`, rejouable), puis fusion. L'ordre est impératif : migration avant interface.
6. **Retour arrière** : `20261103090100_aflp_fleet_7_rollback.sql`, refusé tant que des permis existent. Les scans du dossier `permis/` et les entrées anonymisées du journal restent à purger. Revenir aussi à l'interface précédente.

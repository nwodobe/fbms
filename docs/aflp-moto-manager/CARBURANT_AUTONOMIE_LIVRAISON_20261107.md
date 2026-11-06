# AFLP FLEET · Carburant & Autonomie : livraison du 7 novembre 2026

**État : développé et testé sur branche, NON fusionné, NON déployé.** La PR n°301 reste en brouillon. `moto/index.html` est un fichier protégé (`*.html` dans `auto-merge-denylist.txt`) : revue humaine obligatoire (label `human-review`).

## 1. Ce qui est livré

| Élément | Fichier | État |
|---|---|---|
| Moteur de production (lecture seule) : `evaluerMoto`, `evaluerFlotte`, `reconstituerStock`, `kmPrevus`, `historiserAlertes` | `moto/moto-carburant-previsionnel.js` | Développé, testé |
| Section **CARBURANT & AUTONOMIE** en tête de Pilotage : 5 indicateurs, tableau classé par urgence, fiche détaillée par moto | `moto/moto-app.js`, `moto/moto.css` | Développé, testé navigateur 3 largeurs |
| Pastille de notification sur l'onglet Pilotage + bandeau d'alerte sur l'accueil du module | `moto/moto-app.js` | Développé, testé |
| Feuille « Carburant autonomie » dans l'export Excel de Pilotage | `moto/moto-app.js` | Développé, non testé en navigateur (export) |
| Chargement du script + version des ressources | `moto/index.html` (**protégé**) | 2 lignes modifiées |
| Proposition serveur : historique dédoublonné, calcul SQL, planification pg_cron | `docs/aflp-moto-manager/propositions/20261107_carburant_alertes_serveur_PROPOSITION.sql` | **Non appliquée** ; rejouée sur Postgres 16 jetable |

Les fonctions du prototype (`prevoir`, `simulerPleinsCompletes`…) sont conservées pour la traçabilité ; l'interface utilise le moteur de production.

## 2. Revue du prototype ChatGPT (PR n°301, avant reprise)

| Constat | Effet | Traitement |
|---|---|---|
| Les « missions prévues » attendent `distance_km`, `date_prevue`, `distance_fiable` | Ces champs **n'existent pas** en production : `moto_missions` est un journal de trajets réalisés (OUVERTE/CLOTUREE/ANNULEE). Avec les vraies données, `prevoir` renvoyait toujours « données insuffisantes » | Moteur fondé sur le compteur ; planning accepté en entrée optionnelle |
| `missionsIntervalle` exclut les missions `CLOTUREE` et `TERMINEE` | Toute l'activité réelle était ignorée | Rythme calculé sur le compteur |
| Un complément supérieur à la place libre rendait le stock « incohérent » (null) | Une simple erreur de déclaration effaçait le calcul de la moto | Réservoir plafonné à 15 L, point à vérifier signalé |
| Le volume conseillé visait `min(capacité, seuil)` | Confondait « repasser le seuil » et « refaire le plein » | Deux valeurs distinctes : plein (privilégié) et minimum pour le seuil |
| Statut supplémentaire `ANOMALIE_A_VERIFIER` | 5 états au lieu des 4 du mandat | Anomalie = indicateur, pas un état |
| Synchronisation tardive, relevé périmé, mission non clôturée non traités | Fiabilité surestimée | Gérés et affichés |

## 3. Règles de calcul (paramètres validés par le Branch Manager)

- Réservoir de référence **15 L** ; un plein complet ramène le réservoir à **15 L au total** (les litres achetés ne s'ajoutent pas à 15 L). Hypothèse BM, non mesure constructeur : affichée sur chaque fiche.
- Reconstitution chronologique depuis le **dernier plein complet non rejeté** : chaque complément ultérieur est ajouté après déduction des km parcourus, plafonné à 15 L ; doublons d'identifiant ignorés.
- Consommation prudente **4,4 L/100 km** (4 L + 10 %, appliqués une seule fois).
- Km prévus sur 24 h : planning s'il existe ; sinon **rythme du compteur** depuis le plus ancien point (achat ou départ de mission) des 14 derniers jours, diviseur minimal 1 jour. Sous 3 jours d'historique : **calcul provisoire**. Sans aucun km : référentiel 70 km/jour, statut « données à vérifier ». L'absence de mission n'est jamais lue comme une absence de déplacement.
- Stock de sécurité = consommation prévue du jour suivant ; **seuil d'alerte = besoin 24 h + stock de sécurité**.
- Mission ouverte : les km non encore relevés sont estimés au rythme prévu (depuis le dernier relevé, plafond 24 h) et déduits.

| État | Condition | Couleur |
|---|---|---|
| **Critique** | stock ≤ stock de sécurité, ou autonomie < km prévus sur 24 h, ou besoin d'une journée > 15 L, ou réserve théorique épuisée | Rouge + libellé |
| **Ravitaillement à planifier** | stock ≤ seuil ; ou, avec planning, seuil atteint sous 24 h ; ou besoin 24 h + sécurité > 15 L (ravitaillement intermédiaire signalé) | Orange + libellé |
| **Données à vérifier** | aucun plein complet, compteur absent ou incohérent, relevé de plus de 48 h, aucun historique | Gris + libellé |
| **Normal** | stock au-dessus du seuil, données suffisantes | Vert + libellé |

Fiabilité : Bonne (plein vérifié, ≥ 3 jours), Moyenne (justificatif en attente ou historique provisoire), Faible (anomalie, référentiel, mission non clôturée, synchronisation tardive), Insuffisante (stock non calculable).

## 4. Résultat sur l'état du 6/11/2026 (contrôle en lecture seule)

Valeurs au dernier relevé, identiques au tableau du mandat : MOTO-003 229 km / 4,92 L / 112 km ; MOTO-004 145 km / 8,62 L / 196 km ; MOTO-005 55 km / 12,58 L / 286 km ; MOTO-006 82 km / 11,39 L / 259 km. Proposition MOTO-003 : **10,08 L, 9 119 FCFA**.

Statuts calculés à 17 h 44 UTC : **MOTO-003 Critique** (≈ 136 km/jour observés, 229 km en 1,7 jour dont des km hors mission : autonomie de 112 km insuffisante pour une journée) ; MOTO-004, -005, -006 Normal. MOTO-004 : mission en cours, 8,04 L estimés, seuil atteint dans ~9 h ; MOTO-005 : mission ouverte depuis le 4/11, fiabilité faible. Les quatre justificatifs de plein sont **en attente de vérification**.

## 5. Recalcul et alertes

| Déclencheur | Mécanisme réel |
|---|---|
| Kilométrage, mission, carburant, correction enregistrés | invalidation du calcul après tout appel serveur correspondant ; recalcul au prochain affichage |
| Synchronisation hors ligne | invalidation dès qu'une opération est envoyée |
| Planning modifié | aucun planning en base : moteur prêt (`planning`), branchement à faire |
| Fréquence automatique | toutes les 10 min **tant que l'application est ouverte** |
| Sans ouverture de l'application | **inexistant aujourd'hui** : pg_cron disponible mais non installé. Proposition SQL prête (30 min), non appliquée |

Anti-doublon : une notification par (moto, statut, jour) ; une aggravation est notifiée ; historique local de 14 jours dans le navigateur (côté serveur : table `moto_carburant_alertes` proposée). Aucun message WhatsApp, SMS ou e-mail.

## 6. Tests réellement exécutés (7/11/2026, poste de travail de la session)

| Contrôle | Commande | Résultat |
|---|---|---|
| Moteur, 18 scénarios du mandat + compléments | `node tests/moto/carburant-autonomie.test.cjs` | **21/21** |
| Prototype conservé | `node tests/moto/carburant-previsionnel.test.cjs` | 26/26 |
| Cœur AFLP FLEET (non-régression) | `node tests/moto/core.test.mjs` | 18/18 |
| Navigateur réel (Chrome), BM / Finance / Unit Head, 390×844, 768×1024, 1440×900 | `node tests/moto/carburant-pilotage-ui.mjs` | **14/14** ; aucune erreur JS, aucune sortie réseau, aucun appel d'écriture |
| Parité JS/SQL et anti-doublon de la proposition serveur | `sh tests/moto/sql/carburant_alertes_proposition_test.sh` (Postgres 16 jetable) | Validé |
| Portes du dépôt | `verifier-js`, `verifier-html`, `verifier-liens` | 0 nouveau défaut (défauts historiques inchangés) |
| `verifier-pages.mjs` | — | **Non exécuté** : le navigateur Playwright attendu n'a pas pu être téléchargé (réseau restreint) |

Scénario 17 (droits) : vérifié côté interface et par lecture du bloc de code (aucune écriture). **Les politiques RLS n'ont pas été testées** avec de vrais comptes : la lecture de `moto_carburant` suit `moto_dans_perimetre`, donc un Chef de zone ne voit que son périmètre.

## 7. Risques résiduels

1. Le rythme sur 1,5 à 2 jours d'historique est fragile : statuts provisoires jusqu'au 7-8/11.
2. Le réservoir de 15 L et les « pleins complétés » sont des hypothèses : un plein partiel déclaré « complet » surestime le stock.
3. Sans planning relié, une mission longue imprévue n'est pas anticipée.
4. Le calcul navigateur n'alerte personne si l'application reste fermée, tant que la proposition serveur n'est pas appliquée.
5. Le service worker (`sw.js`, protégé, non modifié) ne précharge pas le nouveau script : hors connexion, la section n'apparaît que si le fichier a déjà été chargé en ligne.

## 8. Mise en service (sur autorisation du Branch Manager uniquement)

1. Relecture humaine de la PR (fichier protégé `moto/index.html`) ; passer la PR en « prête » ; fusion par le Branch Manager.
2. Après publication GitHub Pages : ouvrir Pilotage avec le compte BM sur téléphone et ordinateur ; comparer MOTO-003 au calcul manuel.
3. Faire vérifier les quatre justificatifs de plein (fiabilité Moyenne → Bonne après 3 jours).
4. Option serveur : autoriser l'installation de pg_cron, copier la proposition en migration `supabase/` datée, appliquer, contrôler `select * from moto_carburant_alertes`.
5. Retour arrière : revert du commit (client) ; section « Retour arrière » du fichier SQL (serveur).

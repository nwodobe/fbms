# Plan de recette terrain — Niveau 1

Date : 14 août 2026

Ce plan se joue **sur un projet Supabase de recette**, avec un vrai téléphone,
et **jamais avec de l'argent réel**. Aucune donnée de producteur réel ne doit y
figurer.

## Conditions préalables — toutes bloquantes

| # | Condition | Vérification |
|---|---|---|
| 1 | Projet de recette restauré depuis une sauvegarde de production | Le projet répond, volumétrie comparable |
| 2 | `PRECHECK` exécuté et sa sortie archivée | Fichier de sortie conservé |
| 3 | Migrations 01 à 09 appliquées sans erreur | Journal de migration |
| 4 | `VERIFY_niveau1.sql` sans verdict « BLOQUANT » | Sortie archivée |
| 5 | Paramètres obligatoires saisis | `campagne_active` + 3 plafonds |
| 6 | Frontend adapté (A-08) | Modules Cash et Achats fonctionnels |
| 7 | Deux Branch Managers actifs | Sinon A-04 bloque les ajustements |

## Phase 1 — Recette technique (bureau, une demi-journée)

| # | Cas | Attendu | Bloquant |
|---|---|---|---|
| 1.1 | Rejouer les 140 cas du banc d'essai contre la recette | 140/140 | ✅ |
| 1.2 | Deux sessions `psql` décrémentent le même solde simultanément | La seconde échoue | ✅ |
| 1.3 | Deux sessions ouvrent un cycle pour le même RT | Une seule passe | ✅ |
| 1.4 | Se connecter en `service_role` et tenter de modifier `n1_audit` | Refusé | ✅ |
| 1.5 | Appeler chaque RPC depuis PostgREST avec un jeton `anon` | Toutes refusées | ✅ |
| 1.6 | Appeler chaque RPC avec un jeton d'Agent Recenseur | Seules les siennes passent | ✅ |
| 1.7 | Vérifier qu'aucune photo n'apparaît en clair dans `n1_audit` | Champ masqué | ✅ |

## Phase 2 — Recette fonctionnelle (bureau, une journée)

| # | Cas | Attendu | Bloquant |
|---|---|---|---|
| 2.1 | Cycle complet : ouverture → avance → 5 achats → réconciliation → clôture | Cycle `CLOTURE` | ✅ |
| 2.2 | Saisir deux fois le même numéro de reçu | Le second refusé, message compréhensible | ✅ |
| 2.3 | Demander une avance sans réconcilier le cycle précédent | Refusé | ✅ |
| 2.4 | Acheter au-delà du financement disponible | Refusé | ✅ |
| 2.5 | Sortir plus de sacs qu'un RT n'en détient | Refusé | ✅ |
| 2.6 | Un agent tente de valider son propre achat | Refusé | ✅ |
| 2.7 | Modifier un achat clôturé | Refusé, message orientant vers l'ajustement | ✅ |
| 2.8 | Ajustement complet : demande → approbation par un tiers → contre-écriture | Stock corrigé, achat intact | ✅ |
| 2.9 | Réconciliation avec écart cash de 100 000 FCFA | Cycle `BLOQUE`, écart P0 | ✅ |
| 2.10 | Débloquer ce cycle avec motif et preuve | Trace permanente conservée | ✅ |
| 2.11 | Réception usine sans évacuation | Refusé | ✅ |
| 2.12 | Lancer `n1_detecter_anomalies()` deux fois | Aucun doublon | ✅ |

## Phase 3 — Recette terrain, hors ligne (un vrai téléphone, deux jours)

C'est la phase que le banc d'essai **ne peut pas** couvrir.

| # | Cas | Protocole | Attendu | Bloquant |
|---|---|---|---|---|
| 3.1 | Saisie hors ligne | Mode avion, saisir 5 achats | Les 5 sont en file locale, visibles | ✅ |
| 3.2 | Retour du réseau | Réactiver le réseau | Les 5 partent, 5 accusés reçus | ✅ |
| 3.3 | Double clic | Appuyer deux fois sur « Enregistrer » | Une seule ligne en base | ✅ |
| 3.4 | Coupure pendant l'envoi | Couper le réseau au moment de l'envoi | Rejeu au retour, aucun doublon | ✅ |
| 3.5 | Deux appareils | Même compte, deux téléphones, même achat | Une ligne, un conflit ouvert | ✅ |
| 3.6 | Ordre inversé | Synchroniser le téléphone B avant le A | Cohérence conservée | ✅ |
| 3.7 | Appareil perdu | Se connecter sur un téléphone neuf | `n1_sync_etat()` restitue tout | ✅ |
| 3.8 | Reconnexion après 3 jours | Garder l'appareil hors ligne 72 h | Tout part, alerte de retard levée | ✅ |
| 3.9 | Stockage saturé | Remplir le stockage local | Message clair, aucune perte serveur | ✅ |
| 3.10 | Refus serveur hors ligne | Saisir un reçu déjà utilisé, hors ligne | Rejet visible et **explicable** à l'agent | ✅ |
| 3.11 | Batterie épuisée en pleine saisie | Laisser le téléphone s'éteindre | Aucune écriture partielle | ✅ |

## Phase 4 — Protocole papier (une journée, avec l'équipe)

| # | Cas | Attendu | Bloquant |
|---|---|---|---|
| 4.1 | Créer une série de 50 numéros, l'attribuer à un chef d'équipe | 50 numéros `ATTRIBUE` | ✅ |
| 4.2 | Imprimer le registre et les formulaires | Lisible sur le terrain | ✅ |
| 4.3 | Remplir 5 formulaires en conditions réelles | Le chef d'équipe y arrive **sans assistance** | ✅ |
| 4.4 | Saisir les 5 dans FBMS et les rapprocher | Références conservées | ✅ |
| 4.5 | Sauter volontairement un numéro | La clôture quotidienne le signale | ✅ |
| 4.6 | Déclarer un formulaire perdu | Justification exigée, anomalie levée | ✅ |
| 4.7 | Réutiliser un numéro déjà utilisé | Refusé | ✅ |

## Phase 5 — Épreuve d'usage (une semaine, un seul cluster)

Un cluster, un cycle complet, en conditions réelles mais **sans argent réel** :
avances fictives, achats fictifs, producteurs de test clairement identifiés.

| Point d'observation | Question à laquelle il faut répondre |
|---|---|
| Ergonomie des refus | Un agent comprend-il **pourquoi** son achat est refusé, sans appeler le siège ? |
| Charge du BM | Combien de déblocages et d'ajustements par semaine ? Est-ce tenable ? |
| Faux positifs | Combien d'alertes se révèlent sans objet ? Les tolérances sont-elles bien calibrées ? |
| Papier | Le protocole est-il réellement suivi, ou contourné ? |
| Synchronisation | Quel délai réel entre saisie et réception, sur le réseau du terrain ? |
| Plafonds | Les valeurs retenues bloquent-elles des opérations légitimes ? |

## Critères d'acceptation

Le Niveau 1 n'est réceptionné que si :

- **tous les cas bloquants** des phases 1 à 4 sont conformes ;
- la phase 5 se termine **sans écart cash inexpliqué** ;
- aucune alerte P0 ne reste ouverte au-delà de son échéance ;
- le BM confirme par écrit que la charge de contrôle est soutenable ;
- au moins un agent de terrain confirme comprendre les messages de refus.

## Ce que la recette ne prouvera toujours pas

- Le comportement sous charge réelle de campagne (plusieurs centaines d'achats
  par jour). Un test de volumétrie séparé reste nécessaire.
- La résistance à une compromission de la clé `service_role`, qui contourne la
  RLS par conception. Cela relève de la gestion des accès Supabase.
- La qualité des données saisies. Aucune règle ne détecte un poids
  volontairement faux mais plausible.

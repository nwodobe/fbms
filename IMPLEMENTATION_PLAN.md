# LBA Control — Plan d'implémentation

**Mis à jour : phase 9 en cours — justificatifs branchés sur tous les écrans qui les exigent.**
Ce fichier est le journal de bord du projet. Il est mis à jour à la fin de chaque phase, avec ce qui
fonctionne, ce qui ne fonctionne pas et les décisions encore ouvertes. Rien n'y est coché par anticipation.

Documents liés : `ARCHITECTURE.md` · `DATABASE_SCHEMA.md` · `SECURITY_MODEL.md` · `TEST_PLAN.md` ·
`DECISIONS_ET_HYPOTHESES.md`

---

## État d'avancement

| Phase | Contenu | État |
| --- | --- | --- |
| **0** | Analyse, documents de conception, hypothèses et incohérences | ✅ **Terminée** |
| **1** | Initialisation, architecture, Supabase local, migrations, auth, tenants, utilisateurs, rôles, RLS, journal d'audit | ✅ **Terminée** |
| **2** | Identité visuelle, sociétés partenaires, campagnes, contrats, prix | ✅ **Terminée** |
| **3** | Pisteurs, financements, avances, achats, synchronisation hors ligne | ✅ **Terminée** |
| **4** | Stocks, réservations, planning, transferts, réceptions, écarts, incidents | ✅ **Terminée** |
| **5** | Dépenses, allocations, TCB, marges, scoring, alertes | ✅ **Terminée** |
| **6** | Abonnements, personnalisation des documents, exports, tableaux de bord | ✅ **Terminée** |
| **7** | Tests complets, audit RLS, audit hors ligne, optimisation mobile, documentation, déploiement | ✅ **Terminée** |
| **8** | Écrans manquants (sacherie, clôture de campagne, console plateforme) et téléversement des justificatifs | ✅ **Terminée** |
| **9** | Justificatifs branchés sur tous les écrans, marque dans les exports, notifications, tâches planifiées | 🟡 **En cours** |

---

## Phase 0 — Cadrage · ✅ Terminée

**Livré**

- Analyse complète des trois documents sources (cahier des charges V3, dossier de conception MVP, dossier de
  maquettes) et de la commande de développement.
- `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `SECURITY_MODEL.md`, `TEST_PLAN.md`.
- `DECISIONS_ET_HYPOTHESES.md` : **8 incohérences** entre documents sources, **14 hypothèses critiques**,
  **12 décisions métier ouvertes**, et la liste des exigences différées — aucune supprimée.
- Arborescence cible proposée et appliquée.

**Points saillants à retenir**

1. `INC-01` — la formule de l'écart d'acceptation diffère entre la commande et le cahier des charges. Les deux
   sont conservées sous des noms distincts ; aucune n'est arbitrée à la place du métier.
2. `INC-03` — la liste de statuts d'abonnement de la commande ne permet pas d'exécuter le cycle qu'elle décrit
   elle-même. `suspended_read_only` a été ajouté depuis le cahier des charges.
3. `INC-05` — le TCB comportait un risque structurel de double comptage du prix d'achat. Neutralisé par des
   catégories réservées au système.

---

## Phase 1 — Socle sécurisé · ✅ Terminée

### Ce qui fonctionne (vérifié par exécution)

| Élément | Vérification (mesurée, pas déclarée) |
| --- | --- |
| Projet Vite 6 + React 18 + **TypeScript strict** | `tsc -b` sans erreur, `npm run build` réussit |
| Tailwind + shadcn/ui, thème piloté par variables CSS de marque | Build OK, deux couleurs à emplacements fixes |
| Dépendances imposées installées | React Router, RHF, Zod, TanStack Query, Supabase, Dexie, Recharts, ExcelJS, jsPDF, Vitest, RTL, Playwright |
| PWA installable | `vite-plugin-pwa` : manifeste, service worker et icônes 192/512 générés |
| **13 migrations SQL versionnées** | Appliquées sans erreur sur PostgreSQL 16 |
| **62 tables**, toutes les tables métier portant `tenant_id` | Schéma complet des 7 phases posé dès maintenant |
| **RLS activée sur 100 % des tables exposées** | 0 table sans RLS — vérifié par test |
| **248 politiques**, les 4 commandes sur chacune des 62 tables | 0 table incomplète — vérifié par test |
| **55 triggers d'audit** | 215 entrées générées par le seul jeu de démonstration |
| Verrou d'écriture selon statut d'abonnement | Testé en lecture seule **et** en suspension complète |
| Mode d'assistance super-admin audité et expirable | Testé : sans session, hors session et après expiration |
| **104 tests de base de données** (`npm run test:rls`) | 104/104 passent |
| **37 tests unitaires** (`npm test`) | 37/37 passent |
| Jeu de démonstration fictif | Volumes exactement conformes à la commande §25 |

**Trois défauts réels ont été trouvés par les tests pendant cette phase**, et corrigés :

1. Le super-administrateur ne pouvait pas administrer les abonnements — les tables commerciales
   étaient soumises au même cloisonnement que les données métier du client, ce qui rendait la console
   plateforme (CDC §20.6) inutilisable. Les abonnements ont été sortis du profil générique.
2. La validation des couleurs de marque acceptait une couleur presque blanche : lisible avec du texte
   noir, mais invisible sur le fond de l'application. Deux contrôles distincts sont désormais faits.
3. La même validation refusait deux couleurs sombres de teintes différentes (un vert et un brun),
   parce qu'elle mesurait un contraste de luminance là où il fallait une distance colorimétrique.

### Ce qui ne fonctionne pas encore / limites assumées

- **Aucun écran métier fonctionnel** au-delà du socle : c'est conforme à la commande §28 (« Ne commence
  pas par l'interface »). Sont livrés la page de connexion, la coquille applicative avec navigation
  filtrée par rôle, et 19 écrans déclarés qui **annoncent explicitement leur phase de livraison**.
  Aucun chiffre n'est simulé nulle part : un tableau de bord rempli de valeurs inventées ferait
  prendre des décisions sur du vide.
- **Tests Playwright non implémentés** : la configuration existe (profils bureau et Android), les 14
  parcours sont spécifiés dans `TEST_PLAN.md`, mais aucun n'est écrit — ils exigent des écrans réels
  et une authentification raccordée. Voir `lba-control/e2e/README.md`.
- **Supabase Auth n'est pas branché sur un projet réel** : le socle est testé contre un PostgreSQL local qui
  reproduit le mécanisme Supabase (`role authenticated` + `request.jwt.claims`). Le raccordement à un projet
  Supabase hébergé demande des identifiants que le dépôt ne doit pas contenir.
- **Edge Functions non déployées** : leur code est présent, leur déploiement dépend d'un projet Supabase.
- **Storage** : buckets et politiques décrits et scriptés, non créés faute de projet hébergé.
- Les **calculs financiers** (TCB, marge, scoring) ont leur schéma en base mais **pas encore leur
  implémentation** : phase 5. Aucun résultat n'est donc affiché aujourd'hui — rien n'est simulé.

### Décisions encore ouvertes à l'issue de la phase 1

Les 12 arbitrages listés en §4 de `DECISIONS_ET_HYPOTHESES.md` restent ouverts. Trois deviennent bloquants
dès la phase 3 :

- **D1** — fait générateur de la couverture d'une avance (défaut implémenté : réception acceptée).
- **D4** — FIFO automatique vs allocation manuelle (défaut : FIFO + correction approuvée).
- **D7** — seuil de blocage d'une nouvelle avance (défaut : exposition > plafond **ou** reliquat > 7 jours).

Ces valeurs sont **paramétrables en base** : les trancher ne demandera pas de migration.

---

## Phase 2 — Identité visuelle et référentiel commercial · ✅ Terminée

Écrans livrés : `H01` marque, `B01` sociétés partenaires, `B02` fiche société, `B03` contrats et prix.

### Ce qui fonctionne (vérifié par exécution)

| Élément | Vérification |
| --- | --- |
| Marque du tenant : nom, slogan, deux couleurs, coordonnées, pied de page | 7 tests de composant |
| **Contraste vérifié côté client ET côté serveur** | Migration 1400 : WCAG implémenté en SQL, concordance avec TypeScript vérifiée par test (21.00, 6.15, distances 221 et 2) |
| Prévisualisation et retour au thème standard | Testé |
| Sociétés partenaires : liste, création, suspension, fiche | 6 tests de composant + 8 parcours E2E |
| Contrats : création, activation contrôlée, tolérances en cascade | E2E |
| **Prix versionnés, jamais écrasés** | `app.revise_price` : clôt la version en cours, en crée une nouvelle, journalise |
| Refus des révisions rétroactives | Testé dans les deux cas (avant la version en cours, et avant toutes les versions) |
| Activation d'un contrat sans prix refusée | Testé |
| **26 parcours end-to-end** (bureau + Android) dans un vrai navigateur | 26/26 |
| **95 tests unitaires et de composants** | 95/95 |
| **122 tests de base de données** | 122/122 |
| Build de production | Réussi |

### Défauts trouvés par les tests pendant la phase 2, et corrigés

1. **Le client Supabase était typé `never` en écriture.** Les lignes étaient déclarées avec
   `interface` ; or une interface n'a pas de signature d'index implicite et échoue la contrainte
   `Record<string, unknown>` de postgrest-js, qui retombe silencieusement sur `never`. Toutes les
   écritures étaient donc impossibles à compiler, avec un message qui ne désignait pas la cause.
   Corrigé et documenté dans `src/types/database.ts` pour éviter la régression.
2. **La liste des sociétés tombait** dès qu'une ligne arrivait sans statut connu. Repli explicite
   ajouté : une valeur inattendue s'affiche telle quelle au lieu de casser l'écran.
3. **Une révision de prix antérieure à toutes les versions existantes** passait le garde-fou et
   échouait sur une contrainte d'exclusion brute, illisible pour l'utilisateur. Deuxième contrôle
   ajouté, avec un message explicite.

### Ce qui ne fonctionne pas encore / limites assumées

- **Les logos ne sont pas encore téléversables** : les champs existent en base et le thème les
  consomme, mais l'envoi de fichier dépend des buckets Storage, donc d'un projet Supabase hébergé.
  Le nom, le slogan et les deux couleurs sont eux pleinement opérationnels.
- **Les parcours E2E s'exécutent contre un Supabase simulé** par interception réseau. C'est un choix
  assumé et documenté dans `e2e/support/session.ts` : ils vérifient l'interface réelle dans un vrai
  navigateur, pas les règles serveur — celles-ci sont couvertes par les 122 tests exécutés contre un
  vrai PostgreSQL. Aucune des deux suites ne remplace l'autre.
- **La gestion des campagnes n'a pas d'écran dédié** : les campagnes sont sélectionnables dans le
  formulaire de contrat et l'API de création existe, mais l'écran de gestion reste à faire.

---

## Phase 3 — Terrain et argent · ✅ Terminée

Écrans livrés : `C01` pisteurs, `C02` fiche pisteur, `C03` avances, `E05` financements, `D01`/`D02`
achats terrain avec saisie hors ligne.

### Ce qui fonctionne (vérifié par exécution)

| Élément | Vérification |
| --- | --- |
| **File hors ligne non bornée** | 1 500 opérations mises en file, aucune perte, aucune limite à 300 |
| **Aucune suppression d'une opération `pending`** | Survit aux échecs répétés, à la fermeture et réouverture de la base ; le module n'expose **aucune** fonction de purge, et un test le vérifie |
| **Synchronisation idempotente** | Trois rejeux → une seule opération ; un doublon serveur compte comme un succès |
| **Conflits affichés, jamais écrasés** | Doublon probable, version divergente, appareil révoqué : l'opération reste en file avec sa charge utile |
| **Journal de synchronisation** | Chaque étape tracée ; la vérification d'intégrité détecte une disparition |
| Compteur de tentatives, dernière erreur, report exponentiel plafonné | Testé |
| **Allocation FIFO** | L'ancienneté suit l'avance d'origine, jamais la dernière remise ; excédent de couverture visible et non absorbé |
| **Exposition décomposée** | Avancé, couvert, adossé à la matière, inexpliqué — aucun « solde » unique |
| **Plafonds d'avance appliqués en base** | Plafond global, plafond par société, ancienneté du reliquat ; dérogation motivée et approuvée par un tiers |
| **Blocages définitifs non contournables** | Pisteur suspendu, société non autorisée : aucune dérogation ne les lève |
| **Détection de doublons d'achat** | Signale sans bloquer ; la géolocalisation pèse 5 points sur 100 et ne déclenche jamais seule |
| Montant d'achat calculé, jamais saisi | Contrainte serveur + interface sans champ montant |
| **169 tests unitaires et de composants** | 169/169 |
| **145 tests de base de données** | 145/145 |
| **46 parcours end-to-end** (bureau + Android) | 46/46 |
| Build de production | Réussi |

### Défauts trouvés par les tests pendant la phase 3, et corrigés

1. **Le score de doublon saturait à 100** dès qu'assez de critères concordaient, ce qui rendait deux
   situations très différentes indiscernables. Le test a été recentré sur un scénario non saturé et
   la limite est désormais documentée.
2. **Le journal hors ligne n'était pas interrogeable par type d'événement** : la vérification
   d'intégrité — celle qui prouve qu'aucune saisie n'a disparu — échouait faute d'index.
3. **Deux erreurs SQL de typage** dans les nouvelles fonctions (littéral texte concaténé à un tableau,
   énumération affectée depuis une chaîne) faisaient échouer toute insertion d'achat.

### Ce qui ne fonctionne pas encore / limites assumées

- **Les photos et justificatifs ne sont pas encore joignables** : la compression et l'envoi dépendent
  des buckets Storage, donc d'un projet Supabase hébergé. La file hors ligne est en revanche prête à
  les transporter.
- **L'allocation FIFO n'est pas encore déclenchée automatiquement** par une réception : la fonction
  serveur existe et est testée, mais l'événement qui l'appelle arrive avec les transferts, en phase 4.
- **Le rattachement d'un achat à une avance précise** n'est pas proposé dans le formulaire : le champ
  existe en base et la cohérence des sociétés est vérifiée, l'écran le proposera avec les stocks.
- **La saisie hors ligne couvre les achats** ; les dépenses terrain suivront en phase 5, la file étant
  déjà générique.

---

## Phase 4 — Matière et logistique · ✅ Terminée

Écrans livrés : `D03` stocks et réservations, `E01` planning, `E02`/`E03` transferts, pesées et
réception, `E14` incidents.

### Ce qui fonctionne (vérifié par exécution)

| Élément | Vérification |
| --- | --- |
| **Quantité disponible ≠ quantité du lot** | La colonne « disponible » retire les réservations actives ; afficher la quantité brute est précisément ce qui produit les doubles promesses |
| **Double réservation impossible** | Fonction transactionnelle avec verrou de ligne + trigger de capacité, testés |
| Un lot affecté à une société n'est pas promettable à une autre | Testé au niveau réservation **et** au chargement |
| **Tolérance résolue en cascade** contrat → société → entreprise | L'origine du seuil est conservée et affichée : « supérieur à la tolérance » sans dire laquelle est ininterprétable |
| **Les cinq écarts** calculés par la base | Les deux formulations divergentes des documents sources sont conservées (INC-01) |
| **Quatre poids distincts** | Aucune colonne ni colonne d'affichage « livré » ; chaîne décroissante vérifiée des deux côtés |
| **Incident automatique au-delà du seuil** | Ouvert avec la mesure, la tolérance et son origine ; bloque la clôture |
| **Aucune imputation automatique** | Responsable présumé « inconnu », causes techniques énumérées avant toute conclusion — vérifié par test |
| Pas d'incident formel sur un poids estimé | Accuser sur la foi d'un poids non pesé serait indéfendable |
| Réception transactionnelle | Poids, écarts, incident et mouvement de stock en une seule transaction |
| **Couverture FIFO déclenchée par la réception acceptée** | Arbitrage D1 branché, valorisation au prix historisé du transfert |
| Départ refusé sans poids chargé ni ticket de pesée « vérifié » | Testé |
| **236 tests unitaires et de composants** | 236/236 |
| **165 tests de base de données** | 165/165 |
| **70 parcours end-to-end** (bureau + Android) | 70/70 |
| Build de production | Réussi |

### Défauts trouvés par les tests pendant la phase 4, et corrigés

1. **Deux erreurs de typage SQL** (énumération `incident_severity` affectée depuis une chaîne) qui
   faisaient échouer toute réception dépassant la tolérance — c'est-à-dire précisément le cas que la
   fonction existe pour traiter.
2. **Les seuils s'affichaient « 0.5000 % »**, suggérant une précision qui n'existe pas. Les zéros non
   significatifs sont désormais supprimés dans les messages.
3. Deux assertions end-to-end ambiguës de ma part (« Chargé » correspondait aussi à « Déchargé »).

### Ce qui ne fonctionne pas encore / limites assumées

- **La création d'un transfert et la pesée au chargement ne sont pas encore un écran** : la réception
  l'est, les règles de départ sont en base et testées, mais le formulaire de chargement reste à faire.
  Les transferts existants sont réceptionnables.
- **Le planning ne se crée pas depuis l'interface** : la liste, les contrôles avant confirmation et la
  confirmation fonctionnent ; le formulaire de création arrive avec la sacherie.
- **La sacherie (`E11`) n'est pas traitée** : les tables et les mouvements existent depuis la phase 1,
  l'écran est reporté — il dépend des dotations aux pisteurs, plus proches du terrain que de la
  logistique.
- **Les tickets de pesée ne sont pas téléversables** (Storage), mais leur présence est déjà exigée pour
  déclarer un poids « vérifié ».

---

## Phase 5 — Rentabilité · ✅ Terminée

Écrans livrés : `F01`/`F02` dépenses, validation et répartition, `F03` TCB et marges, `G02` scoring,
`A03` centre d'alertes.

### Ce qui fonctionne (vérifié par exécution)

| Élément | Vérification |
| --- | --- |
| **La valeur d'achat n'est jamais comptée deux fois** | La catégorie `achat_produit` est refusée en saisie, écartée du calcul du TCB avec son motif affiché, et absente de la liste déroulante — vérifié aux trois niveaux (INC-05) |
| **Une avance n'entre jamais au TCB** | Test de base : décaisser 1 500 000 FCFA ne change pas d'un franc le TCB du périmètre |
| **Validée mais non payée compte ; rejetée ou annulée ne compte pas** | Testé en domaine et en base ; l'écran affiche « compté » / « non compté » par ligne |
| **Une charge indirecte n'entre que par sa quote-part** | Son montant total est explicitement écarté, avec le motif |
| **Répartition refusée plutôt que nulle** | Quand la clé vaut zéro sur le périmètre, la fonction serveur lève une erreur nommée : des quotes-parts nulles feraient disparaître la charge du TCB sans que personne ne le voie |
| **La somme des quotes-parts rend exactement le montant** | Reliquat d'arrondi attribué à la plus grosse part ; testé en domaine et en base |
| **Une nouvelle répartition remplace l'ancienne** | Testé : deux appels successifs laissent une seule ligne et le montant exact |
| **La clé manuelle n'est jamais calculée** | Refusée côté domaine, côté serveur, et absente de la liste déroulante de répartition |
| **TCB/kg `NULL` et non zéro sans poids accepté** | Testé en domaine, en base et à l'écran (« — », jamais « 0 FCFA/kg ») |
| **La décomposition reconstitue le total** | Vérifié par test en domaine, en base et à l'écran (3 526 000 + 250 000 + 100 000 + 54 000 = 3 930 000) |
| **Les deux marges coexistent avec leur écart** | `marge_totale`, `marge_par_kg` et `margin_reconciliation_gap` calculés séparément ; aucune n'est dérivée de l'autre (INC-06) |
| **Neuf composantes, somme des poids = 100** | Vérifié par test sur les valeurs imposées |
| **Une composante non mesurée est exclue, pas notée zéro** | Poids renormalisés sur les composantes observées ; l'écran liste les exclusions et leur poids redistribué |
| **Aucune catégorie sans maturité suffisante** | Un pisteur à 38/100 sur trois semaines reste « non évalué » — vérifié en base et à l'écran |
| **Aucune sanction automatique** | `recommended_ceiling` est une proposition ; test de base : le calcul ne modifie pas `field_agents.ceiling_amount` |
| **Score brut, ajusté aux événements et affiché restent distincts** | Colonne `event_adjusted_score` ajoutée ; un ajustement humain ne touche ni le brut ni les composantes |
| **Un ajustement exige un motif de 10 caractères** | Refusé en base, bouton désactivé à l'écran |
| **Les vingt alertes, à seuils configurables** | Référentiel complet, chaque seuil porte un libellé ; testé règle par règle |
| **Chaque alerte porte sa mesure ET son seuil** | Vérifié en base et à l'écran : sans les deux, on ne peut qu'obéir ou ignorer |
| **Aucune alerte ne désigne un coupable** | Test explicite : le message d'exposition constate, il n'emploie ni « détourne », ni « vole », ni « retient » |
| **Une condition déjà signalée ne rouvre pas d'alerte** | Deuxième évaluation : 0 alerte ouverte, aucune clé dupliquée |
| **317 tests unitaires et de composants** | 317/317 |
| **194 tests de base de données** | 194/194 |
| **108 parcours end-to-end** (bureau + Android) | 108/108 |
| Build de production | Réussi |

### Défauts trouvés par les tests pendant la phase 5, et corrigés

1. **`advances.covered_amount` n'existe pas** : trois calculs de la migration s'appuyaient sur une
   colonne imaginaire. La couverture se lit dans `advance_allocations` + `advance_repayments`. Extrait
   dans `app.advance_covered()` plutôt que recopié trois fois — deux chiffres de couverture divergents
   dans le même écran auraient détruit la crédibilité des deux.
2. **Une condition toujours vraie** dans la composante « respect des délais »
   (`dp.planned_date >= dp.planned_date`) rendait la mesure sans effet. Remplacée par le ratio
   plannings honorés / plannings de la période.
3. **Cinq de mes propres tests de base heurtaient la règle de plafond d'avance de la phase 3** : le
   pisteur du jeu d'essai est déjà à son plafond. C'est la règle qui fonctionne ; les tests ont été
   déplacés sur un pisteur disposant de capacité.
4. **Un motif de test de dix caractères exactement** passait le seuil que le test prétendait
   éprouver — l'assertion vérifiait donc le contraire de ce qu'elle annonçait.
5. Deux assertions end-to-end ambiguës de ma part (« Marge totale » correspondait à la fois à un
   en-tête de colonne et à une étiquette de définition).

### Ce qui ne fonctionne pas encore / limites assumées

- **Le TCB prévisionnel n'est pas alimenté** : la colonne `is_forecast` et le paramètre existent, mais
  aucun écran ne produit encore de prévisionnel. Seul le réel est calculé.
- **Les pertes valorisées ne couvrent que l'écart physique** des transferts réceptionnés, au prix
  historisé du transfert. Les pertes de sacherie et les pertes de stock hors transfert ne sont pas
  encore valorisées — elles dépendent de l'écran de sacherie, toujours reporté.
- **La répartition manuelle n'a pas d'écran** : la validation existe et est testée
  (`validateManualAllocation`), mais la saisie des quotes-parts approuvées reste à faire.
- **L'ajustement du score par événement externe est grossier côté serveur** : un événement validé
  neutralise la pénalité de « respect des délais » en bloc, alors que le domaine sait raisonner
  observation par observation. Affiner exige de rattacher chaque planning à l'événement qui l'explique.
- **Les alertes ne sont évaluées que sur demande** : `app.evaluate_alerts` est appelée depuis l'écran.
  Sa planification périodique arrive avec la phase 6.
- **Aucune notification n'est envoyée** : la table `notifications` existe, les canaux courriel, SMS et
  WhatsApp restent à brancher.
- **Le seuil de dépense sans justificatif est global**, alors que `expense_categories.requires_receipt_above`
  permettrait un seuil par catégorie. Le champ est renseigné, il n'est pas encore lu par la règle.

---

## Phase 6 — Commercial et pilotage · ✅ Terminée

Écrans livrés : `A02` abonnement, `H02`/`H03` tableau de bord dirigeant avec filtres et exports.

### Ce qui fonctionne (vérifié par exécution)

| Élément | Vérification |
| --- | --- |
| **Une déclaration de paiement ne réactive rien** | `app.declare_subscription_payment` laisse statut et période identiques ; l'événement enregistré porte le même ancien et nouveau statut — la preuve est dans la trace elle-même |
| **Un client ne peut pas confirmer son propre paiement** | Trigger d'autorité : passer une ligne à `confirmed` hors de la fonction de vérification est refusé, même en écriture directe |
| **Une même référence ne compte qu'une fois** | Unicité `(tenant, méthode, référence)` testée |
| **Un même paiement ne prolonge jamais deux fois** | Clé d'idempotence ; deuxième confirmation sans effet sur la période (RG-13) |
| **Prolongation à partir de la date de fin existante** | Payer six jours avant l'échéance ne fait pas perdre ces six jours ; une période expirée repart du jour du paiement |
| **Un paiement partiel devient un avoir** | Période inchangée, avoir créé, facture `partially_paid`, paiement `partial` (RG-14) |
| **Le blocage est graduel et annoncé** | Échéance → grâce (J+1 à J+5, accès complet) → lecture seule (J+6 à J+30) → blocage (J+31). Les sept bascules sont testées jour par jour, en base **et** dans le domaine |
| **Aucune donnée n'est supprimée** | Test explicite : après bascule en lecture seule puis en blocage, les comptes d'achats, d'avances et de dépenses sont inchangés |
| **Export et déclaration restent ouverts après blocage** | Retenir les données d'un client en retard serait une prise d'otage ; sans déclaration possible, un client bloqué ne pourrait jamais se débloquer |
| **Les rappels J-7, J-3 et J ne partent qu'une fois** | Clé rattachée à l'échéance, pas au jour d'envoi ; un rappel manqué est rattrapé, un renouvellement rouvre une série |
| **La clôture de campagne énumère ses obstacles** | Incidents ouverts, avances non couvertes, transferts en cours, dépenses non statuées — avec compte et montant (D10) |
| **Une clôture forcée exige 20 caractères de motif** | Les obstacles contournés sont inscrits dans le journal d'audit |
| **Une campagne clôturée refuse les écritures** | Achats, dépenses et avances bloqués par trigger ; la réouverture motivée les rouvre |
| **La réouverture reste réservée au propriétaire** | Testé ; motif d'au moins 10 caractères imposé |
| **Aucune suppression automatique n'existe** | `app.archival_candidates` décrit ce qui dépasse 90 jours et retourne `deletion_performed: false` (D12) |
| **Exports PDF et Excel à la marque du tenant** | En-tête coloré, pied de page, mention « données de démonstration » vérifiée dans le classeur produit |
| **Les montants sortent en nombres, pas en texte** | Vérifié en relisant le classeur généré : un tableur qui ne se somme pas force la ressaisie, et la ressaisie déforme |
| **Aucun indicateur inventé au tableau de bord** | Sur un périmètre vide, tous les indicateurs de mesure valent `null` et affichent « — » ; seuls les compteurs d'événements valent légitimement zéro |
| **Chaque indicateur porte sa lecture et son compte de sources** | « Ce n'est pas le coût de revient », « n'impute aucune responsabilité » : les phrases sont testées, pas seulement écrites |
| **Un seul instantané de TCB par périmètre** | Empiler les recalculs successifs compterait le même coût plusieurs fois |
| **Les jours sans achat sont absents de la courbe** | Une chute à zéro le dimanche ressemble à un effondrement d'activité |
| **391 tests unitaires et de composants** | 391/391 |
| **223 tests de base de données** | 223/223 |
| **146 parcours end-to-end** (bureau + Android) | 146/146 |
| Build de production | Réussi |

### Défauts trouvés par les tests pendant la phase 6, et corrigés

1. **Une préparation de test silencieusement filtrée par RLS.** Les tables de facturation ne sont pas
   écrivables par un client ; mes `update` de préparation touchaient zéro ligne sans erreur, et huit
   tests passaient en vérifiant un état qui n'avait jamais été posé. La préparation vérifie désormais
   qu'elle a bien écrit une ligne, et échoue bruyamment sinon.
2. **Un enchaînement client → administrateur testé dans deux transactions séparées**, donc jamais
   enchaîné : la déclaration était annulée avant que l'administrateur ne la voie. Réécrit avec
   `switchActor` dans une transaction unique.
3. **La contrainte `subscription_suspension_is_justified` refusait mes états de test** — elle faisait
   exactement son travail : une suspension sans motif n'est pas une suspension.
4. **Deux fixtures end-to-end à un jour de la frontière** (six jours de retard pour tester la grâce
   de cinq, huit jours avant échéance pour tester la fenêtre de rappel à sept). Les deux testaient
   donc l'inverse de ce qu'elles annonçaient.
5. **Le test de tableau de bord de la phase 2 vérifiait l'écran d'attente**, remplacé par le vrai
   tableau de bord. Réécrit sur l'invariant qu'il protégeait réellement — aucun chiffre inventé —
   plutôt que supprimé.

### Ce qui ne fonctionne pas encore / limites assumées

- **Le cycle n'avance pas tout seul** : `app.advance_subscription_lifecycle` est idempotente et
  testée, mais rien ne l'appelle périodiquement. Il faut un `pg_cron` ou une tâche planifiée côté
  Supabase — hors de ce dépôt.
- **Aucun courriel n'est envoyé** : les rappels créent des événements, pas des messages. Le
  branchement des canaux reste à faire.
- **La console plateforme (`Z01`) n'a pas d'écran dédié** : la confirmation de paiement est offerte au
  super-administrateur depuis l'écran d'abonnement du tenant, ce qui suffit au MVP mais ne donne pas
  de vue transverse sur tous les clients.
- **La clôture et la réouverture de campagne n'ont pas d'écran** : les fonctions serveur, leurs
  obstacles énumérés et leurs traces sont livrés et testés, l'interface arrive en phase 7.
- **Le logo du tenant n'apparaît pas dans les exports** : seules les couleurs et le pied de page sont
  repris. L'image exige le téléversement Storage, toujours différé.
- **Les exports ne sont pas encore journalisés** : `classifyExport` et `requiresAuditEntry` existent et
  sont testés, mais aucune entrée `sensitive_export` n'est écrite au moment du téléchargement.
- **Le tableau de bord charge tout le périmètre en mémoire** : acceptable sur un jeu de campagne,
  à remplacer par des agrégats serveur au-delà de quelques dizaines de milliers de lignes.

---

## Phase 7 — Stabilisation · ✅ Terminée

Aucune fonctionnalité livrée. Quatre audits, cinq défauts trouvés, cinq corrigés.

### Les audits, et ce qu'ils ont trouvé

**Audit de sécurité piloté par le catalogue** (`tests/db/security-audit.test.ts`, 31 tests). Il ne cite
aucune table par son nom : il interroge `pg_class`, `pg_policy` et `pg_proc` et affirme des invariants.
Une liste écrite à la main vieillit mal — la table ajoutée dans six mois y échapperait sans que
personne ne le voie, et un audit qui ne couvre plus tout est pire qu'un audit absent : il rassure.

Quatre écarts trouvés, tous du même profil — rien de cassé, une porte laissée ouverte par défaut
plutôt que fermée par décision :

1. **Cinq tables à statut terminal restaient supprimables** : `contracts`, `campaigns`,
   `partner_companies`, `field_agents` et surtout `negotiated_prices`. Toute la phase 2 avait été
   construite pour qu'un prix soit versionné et jamais écrasé ; pouvoir supprimer une version close
   annulait ce travail par la porte de service. Corrigé : politique `DELETE using (false)`.
2. **Le rôle `anon` atteignait toutes les fonctions.** PostgreSQL accorde `EXECUTE` à `PUBLIC` par
   défaut. Aucune n'aurait rendu de donnée — elles résolvent d'abord le tenant — mais « la fonction
   refuse » et « la fonction est inatteignable » ne sont pas la même garantie. Révocation générale,
   plus des privilèges par défaut pour que l'écart ne se rouvre pas à la prochaine migration.
3. **`sensitive_export` n'était jamais écrit.** L'action existait dans l'énumération d'audit depuis la
   phase 1, rien ne l'utilisait. `app.log_export` la remplit désormais, et seulement pour les exports
   contenant des montants ou des noms : un journal qui enregistre tout n'est plus relu.
4. **Quatre exclusions du verrou d'abonnement n'étaient nulle part écrites.** Elles sont légitimes —
   un appareil doit pouvoir enregistrer ses échecs de synchronisation, un client suspendu doit pouvoir
   se connecter et recevoir les messages qui lui expliquent comment se débloquer — mais la raison
   vivait dans la tête de l'auteur. Elle est maintenant dans le schéma.

**Audit de la file hors ligne** (`tests/unit/offline-audit.test.ts`, 8 tests). Il vérifie des
propriétés du **code**, pas seulement des comportements : aucun module n'appelle de suppression sur la
file, aucune constante ne la plafonne. Ces garanties ne se cassent pas par un bug de logique mais par
une bonne intention — quelqu'un ajoutera un « nettoyage des anciennes opérations » pour libérer de la
place. S'y ajoute une épreuve d'endurance : 500 opérations, un tiers d'échecs, un dixième de conflits,
quatre passages de synchronisation, fermeture et réouverture de la base. Zéro perte.

**Parcours complet** (`tests/db/demo-walkthrough.test.ts`). Financement → avance → achats → transfert →
réception avec écart → couverture → dépense → TCB → marge → alerte → clôture, en une transaction, avec
changement d'acteur à chaque étape. Il a trouvé le seul défaut fonctionnel de la phase, et il ne
pouvait être trouvé que là :

5. **Une réception sans planning ne couvrait aucune avance.**
   `app.cover_advances_from_reception` remontait au pisteur par `delivery_plans.field_agent_id`. Or
   `transfers.delivery_plan_id` est nullable : un chargement direct, décidé le matin parce qu'un
   camion passait, produit un transfert sans planning. Silencieusement, la fonction retournait zéro.
   Le pisteur avait livré, l'argent restait compté comme étant chez lui, l'alerte « argent chez le
   pisteur depuis N jours » se déclenchait à tort, et la composante « couverture des avances » de son
   score le sanctionnait pour une livraison qu'il avait faite. Chaque règle était juste isolément ;
   c'est la jonction qui ne l'était pas. Corrigé : remontée par les lots réellement chargés, au
   prorata quand plusieurs pisteurs ont alimenté le même camion.

**Budget de chargement** (`tests/unit/bundle-budget.test.ts`) et **affichage des erreurs**
(`tests/unit/error-surfacing.test.ts`). Le premier échoue si le chargement initial dépasse le budget ;
le second, si un écran qui écrit en base n'affiche pas ses échecs.

### Optimisation mobile

| Mesure | Avant | Après |
| --- | --- | --- |
| Point d'entrée (non compressé) | 719 kB | **407 kB** |
| Préchargement du service worker | 2 950 kB | **895 kB** |
| Recharts au premier chargement | oui | non |
| ExcelJS et jsPDF au premier chargement | non | non |

Le pisteur est la raison de ce découpage. Il travaille sur un Android d'entrée de gamme, en 2G,
parfois en payant son forfait au mégaoctet. Lui faire télécharger la bibliothèque de graphiques du
tableau de bord dirigeant pour saisir un achat est un coût qu'il paie réellement, en argent et en
attente.

Le découpage a produit deux régressions, corrigées :

- **L'attente emportait la navigation.** Placée autour de l'ensemble des routes, elle faisait
  disparaître le menu pendant le chargement d'un écran. Elle est descendue autour du seul contenu.
- **Un morceau non téléchargé donnait une page blanche définitive.** Un `ScreenErrorBoundary`
  explique désormais ce qui s'est passé, précise que les saisies déjà enregistrées sur l'appareil ne
  sont pas affectées, et propose de réessayer.

### Ce qui fonctionne (vérifié par exécution)

| Élément | Vérification |
| --- | --- |
| **408 tests unitaires et de composants** | 408/408 |
| **256 tests de base de données** | 256/256 |
| **146 parcours end-to-end** (bureau + Android) | 146/146 |
| Build de production | Réussi |
| Aucun secret versionné | Vérifié par test, fichiers suivis **et** non ignorés |

### Ce qui ne fonctionne pas encore / limites assumées

Ces points sont réels et documentés plutôt que masqués.

- **Deux tâches planifiées restent à installer** côté Supabase : l'avancement du cycle d'abonnement et
  l'évaluation des alertes. Les deux fonctions sont idempotentes et testées, le README donne les
  requêtes exactes. Sans elles, rappels et bascules n'ont lieu qu'à l'appel manuel.
- **Aucun message n'est envoyé** : courriel, SMS et WhatsApp restent à brancher.
- **Trois écrans n'existent pas** : console plateforme (`Z01`), sacherie (`E11`), clôture de campagne.
  Les règles serveur des deux derniers sont livrées et testées ; il manque l'interface.
- **Le téléversement de fichiers n'est pas branché** (Storage) : les tickets de pesée et justificatifs
  sont exigés par les règles mais leur chemin est saisi, pas déposé. Le logo du tenant n'apparaît donc
  pas non plus dans les exports.
- **Le tableau de bord charge son périmètre en mémoire** : acceptable sur une campagne, à remplacer
  par des agrégats serveur au-delà de quelques dizaines de milliers de lignes.
- **Le TCB prévisionnel n'est pas alimenté**, et les pertes valorisées ne couvrent que l'écart
  physique des transferts (H-17).
- **L'ajustement du score par événement externe est grossier côté serveur** : un événement validé
  neutralise « respect des délais » en bloc, là où le domaine sait raisonner observation par
  observation.
- **Aucun déploiement réel n'a été fait** : le produit n'a jamais tourné contre un projet Supabase
  hébergé. Tout est vérifié contre un PostgreSQL local exécutant les migrations réelles et contre un
  PostgREST simulé. C'est la limite la plus importante de cette livraison.

---

## Phase 8 — Écrans manquants et téléversement · ✅ Terminée

Cette phase ferme les manques que la phase 7 avait documentés plutôt que masqués.
Écrans livrés : `E11` sacherie, clôture et réouverture de campagne, `Z01` console plateforme,
et le dépôt de justificatifs vers Storage.

### Ce qui fonctionne (vérifié par exécution)

| Élément | Vérification |
| --- | --- |
| **Le solde de sacs ne se saisit pas** | Il se déduit des mouvements par trigger ; `app.rebuild_bag_stocks` le reconstruit depuis les seuls mouvements. Test : on abîme volontairement le cache, la reconstruction rétablit la vérité |
| **Un mouvement mal formé est refusé avant de fausser deux stocks** | Origine et destination exigées selon le type ; quantité toujours positive, le sens venant des deux bouts |
| **Les sacs de deux sociétés ne se mélangent pas** chez le même détenteur | Testé en domaine et en base |
| **Une perte s'explique** | Refusée sans motif, en base comme à l'écran |
| **Une réaffectation entre sociétés est approuvée et tracée** | Deux mouvements en une transaction, entrée `partner_change` au journal d'audit, réservée au propriétaire et au gestionnaire |
| **Le taux de perte reste vide** quand rien n'a été distribué | 0 % sur une dotation inexistante se lirait comme un excellent résultat |
| **La clôture énumère ses obstacles** | Compte et montant par obstacle ; le forçage exige 20 caractères et inscrit les obstacles contournés à l'audit |
| **La console plateforme ne montre aucune donnée métier** | Test qui inspecte les clés renvoyées : aucune ne porte d'achat, de prix, de marge ni de nom de pisteur |
| **Suspendre un client n'efface rien** | Test comparant les compteurs avant et après ; motif de 20 caractères exigé, décision tracée |
| **Une session d'assistance se révoque avant expiration** | Attendre l'expiration serait une mauvaise réponse à un incident |
| **Le type de fichier est vérifié par sa signature** | Un exécutable renommé `ticket.jpg` est refusé ; un fichier dont le contenu contredit le type annoncé aussi |
| **Les limites diffèrent selon l'usage** | 8 Mo au bureau, 4 Mo pour une preuve envoyée du terrain — le pisteur paie son forfait |
| **Les images sont réduites avant l'envoi**, et l'économie est annoncée | 4 032 px ramenés à 1 600 ; « 4,2 Mo économisés » explique la rapidité |
| **Les buckets sont privés et cloisonnés par chemin** | Premier segment = tenant ; suppression refusée, comme pour les transactions |
| **Le seuil de justificatif est appliqué à la validation, pas à la saisie** | Un pisteur doit pouvoir enregistrer une dépense réelle depuis le terrain |
| **450 tests unitaires et de composants** | 450/450 |
| **282 tests de base de données** | 282/282 |
| **180 parcours end-to-end** (bureau + Android) | 180/180 |
| Build de production | Réussi |

### Défauts trouvés par les tests pendant la phase 8, et corrigés

1. **Une affirmation fausse de la phase 7, démontrée par l'audit.** La migration `1900` prétendait que
   des privilèges par défaut fermeraient la surface d'exécution « à la prochaine migration ». C'était
   inexact : `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC` **ne retire pas** le droit
   intégré de PostgreSQL, qui accorde `EXECUTE` à `PUBLIC` sur toute fonction créée — cette forme
   n'annule que ce qu'un `GRANT` par défaut avait ajouté. Seize nouvelles fonctions sont donc devenues
   appelables par `anon` dès la phase 8, et l'audit du catalogue a échoué à la première exécution.
   Corrigé par une migration `2400` dont le seul objet est la révocation explicite, et qui **doit
   rester la dernière** ; la migration `1900` et `SECURITY_MODEL.md` ont été rectifiés.
2. **Ma propre règle de forme contredisait ma propre implémentation.** Le garde-fou exigeait qu'une
   réaffectation ait une origine *et* une destination, alors que `reassign_bags` l'écrit en deux
   pattes — `partner_company_id` étant une colonne unique, une seule ligne ne peut pas exprimer
   « d'OLAM vers DORADO ». La réaffectation était donc impossible à enregistrer.
3. **Une colonne ambiguë** (`commercial_name` sélectionnée deux fois) et **un `case` non casté** vers
   `audit_action` faisaient échouer la console plateforme à l'exécution.
4. **Une comparaison d'énumération à la chaîne vide** (`coalesce(old.status, '')`) faisait échouer
   toute validation de dépense.
5. Le super-administrateur ne peut pas lire le journal d'un client hors session d'assistance — la
   règle de la phase 1 s'applique aussi à lui. Mon test l'avait oublié.

### Ce qui ne fonctionne pas encore / limites assumées

- **Le téléversement n'a jamais été exercé contre un vrai Storage.** Les règles — signature, taille,
  compression, chemin — sont testées sans navigateur ; les politiques de bucket sont écrites mais la
  base locale n'héberge pas Storage, et la migration `2300` s'y ignore d'elle-même. C'est la partie
  la moins éprouvée de la livraison.
- **Le logo du tenant n'apparaît toujours pas dans les exports** : le composant de dépôt existe, il
  reste à le brancher sur l'écran de marque et à lire l'image au moment de l'export.
- **Les tickets de pesée et preuves d'achat ne sont pas encore reliés au composant de dépôt** : seul
  l'écran des dépenses l'utilise. Les autres écrans conservent la saisie du chemin.
- **La console plateforme ne crée pas de tenant** : elle administre l'existant. La création d'un
  client et l'invitation de son administrateur restent une opération manuelle.
- **Deux tâches planifiées** (cycle d'abonnement, évaluation des alertes) restent à installer.
- **Aucun message n'est envoyé**, et **aucun déploiement réel n'a été fait**.

---

## Phase 9 — Justificatifs, marque et automatisation · 🟡 En cours

### 9.1 · Justificatifs branchés sur tous les écrans qui les exigent — ✅ terminé

Les règles serveur réclamaient depuis la phase 4 un ticket de pesée pour tout poids « vérifié », et
depuis la phase 8 un justificatif au-delà d'un seuil de dépense. Seul l'écran des dépenses savait
déposer un fichier : les autres exigeaient un chemin saisi à la main, c'est-à-dire rien.

**Ce qui fonctionne (vérifié par exécution)**

- **Marque** — trois emplacements distincts, déposés séparément et enregistrés dès le dépôt : logo
  principal, logo mobile, image de connexion. Trois emplacements plutôt qu'un fichier redimensionné,
  parce qu'un logo lisible sur un écran de bureau ne l'est pas dans un menu de téléphone.
- **Transferts** — le ticket du pont-bascule au départ se joint depuis la liste, y compris après le
  départ du camion ; le ticket de réception se joint dans la boîte de réception et part avec elle.
  Les deux sont rangés sous des noms distincts : les confondre effacerait la moitié de la preuve
  d'un écart.
- **Achats** — la preuve d'achat se joint pendant la saisie, avec le même comportement en ligne et
  hors ligne.
- **Hors réseau, le fichier est conservé sur l'appareil** dans une file locale non bornée, et repart
  seul au retour du réseau — après les opérations, jamais avant : un ticket ne peut pas se rattacher
  à un achat que le serveur n'a pas encore reçu.
- **Le chemin n'est écrit dans la ligne métier qu'une fois les octets réellement stockés.** L'ordre
  inverse serait plus simple et produirait des justificatifs fantômes : `proof_path` renseigné,
  aucun fichier au bout, une dépense passant le contrôle de seuil sans pièce jointe et un contrôleur
  ouvrant un lien mort.
- **Liste blanche des rattachements** — quatre tables, huit colonnes, toutes de type chemin. La file
  vit sur un appareil que son porteur contrôle entièrement ; sans cette borne, une entrée modifiée à
  la main deviendrait « écris ce que je veux dans la colonne que je veux ». Vérifiée à la mise en
  file **et** de nouveau à l'envoi.
- **Le type est contrôlé par sa signature binaire avant tout envoi**, et la taille aussi : un fichier
  inutilisable est refusé pendant que le pisteur est encore devant le vendeur.

**Défauts trouvés par les tests, et corrigés**

1. **Les octets des justificatifs disparaissaient de la file locale.** Tant que le tampon vivait dans
   la ligne de suivi, chaque changement de statut passait par `Table.update` de Dexie — et le tampon
   n'y survivait pas. La ligne restait, le fichier devenait vide, la file affichait « en attente »
   pour un contenu inexistant, et le constat n'aurait été fait qu'au moment d'un contrôle. Corrigé
   par un magasin séparé, écrit une seule fois ; un test d'audit épingle désormais la séparation, et
   `verifyAttachmentIntegrity` signale toute ligne dont le contenu a disparu.
2. **Un `Blob` ne survit pas non plus au clonage d'IndexedDB** selon l'implémentation. Les octets
   sont conservés en tampon brut et le `Blob` reconstruit à l'envoi.
3. **Le script `npm run typecheck` du dépôt était défectueux** : `tsc -b --noEmit false` entre en
   conflit avec `allowImportingTsExtensions`, échoue, et sème au passage un fichier `.js` compilé à
   côté de chaque source. Ramené à `tsc -b`.
4. **Un dialogue affichait un instantané périmé** : le transfert reçu en argument ne se met pas à
   jour après l'enregistrement du chemin, et le ticket joint restait invisible.
5. **Mon test de suppression attendait une erreur** là où RLS filtre silencieusement — une
   suppression interdite « réussit » en ne touchant aucune ligne. Même leçon qu'en phase 6 : le
   compte de lignes est la seule vérification qui vaille. C'est d'ailleurs pour cette raison que le
   moteur de rattachement traite « zéro ligne mise à jour » comme un report, pas comme un succès.

**Ce qui ne fonctionne pas encore / limites assumées**

- **Toujours aucun Storage réel.** Les règles sont testées sans navigateur, les parcours contre un
  Storage simulé, les politiques de bucket écrites mais jamais appliquées : la base locale n'héberge
  pas Storage. C'est la partie la moins éprouvée de la livraison.
- **Les octets en attente ne sont pas chiffrés sur l'appareil.** Une photo de ticket reste lisible
  par qui accède au stockage du navigateur. Le cloisonnement local relève du verrouillage de
  l'appareil, pas de l'application.
- **Aucune reprise manuelle** n'est offerte sur un justificatif définitivement en échec : il reste
  visible et conservé, mais c'est un nouveau dépôt qui le remplacera.

### 9.2 · Marque du tenant dans les documents exportés — ✅ terminé

Un rapport PDF et un export Excel circulent hors de l'entreprise. Ils portaient déjà son nom et ses
deux couleurs ; il leur manquait son logo.

**Ce qui fonctionne (vérifié par exécution)**

- Le logo est posé dans l'en-tête du PDF, à l'échelle, proportions conservées, et le titre se décale
  pour ne pas le chevaucher. Une image de 4 000 × 300 pixels ne repousse pas le nom hors de la page.
- Le classeur Excel porte l'image en superposition d'une bande réservée en tête : posée **dans** une
  cellule, elle décalerait les colonnes et casserait les formules du destinataire.
- SVG et WebP — acceptés au dépôt, refusés par jsPDF — sont rastérisés par le canevas avant
  incorporation.
- **Le document sort toujours.** Logo absent, illisible, trop lourd, réseau coupé : le document est
  produit avec le nom commercial, et l'écran dit ensuite pourquoi le logo manque. Sauf quand aucun
  logo n'a été déposé : ce n'est pas un incident, et le signaler à chaque export serait du bruit.
- Le logo apparaît aussi dans la barre latérale de l'application, par lien signé.

**Défauts trouvés par les tests, et corrigés**

1. **La page de connexion posait un chemin de stockage dans `src`.** Le bucket `marque` est privé :
   un chemin n'est pas une adresse. L'image ne se serait jamais affichée — elle aurait rendu une
   icône cassée. Corrigé par un accès systématique via lien signé (`useBrandingImage`).
2. **Une donnée base64 malformée fige jsPDF au lieu de lever.** Le test prévu pour vérifier qu'un
   logo inutilisable n'empêche pas l'export a expiré au lieu d'échouer : sans garde, un logo corrompu
   rendrait le bouton d'export définitivement muet. Le format est désormais validé avant d'être remis
   à l'écrivain, et l'invariant est testé.
3. **Le logo Excel décalait les lignes sans que ce soit voulu** : régler la hauteur de la ligne 1
   créait une ligne vide avant l'en-tête. La bande est maintenant réservée explicitement, d'une
   hauteur connue, et le test vérifie que les colonnes ne bougent pas.

**Limites assumées**

- Le logo n'est posé que sur les exports du tableau de bord : ce sont les seuls documents que
  l'application produit aujourd'hui. Bons de transfert et reçus restent à écrire.
- La rastérisation SVG passe par le canevas du navigateur : un SVG référençant des ressources
  externes perdra ces ressources. C'est le comportement voulu — un document ne doit pas aller
  chercher une image sur un serveur tiers au moment de sa création.

### 9.3 · Centre de notifications alimenté par les alertes — à faire
### 9.4 · Planification serveur des tâches récurrentes — ✅ terminé

Deux traitements font vivre le produit dans le temps, et rien ne les exécutait. Sans eux, un client
impayé garde un accès complet, un client à jour reste bloqué, et la moitié des vingt types d'alerte
ne se déclenche jamais — ce sont ceux qui se mesurent en durées, pas en saisies.

**Ce qui fonctionne (vérifié par exécution)**

- Migration `2500` : `app.run_subscription_lifecycle()` et `app.run_alert_evaluation()` parcourent
  tous les clients, et `pg_cron` les planifie **si l'extension est présente**, avec la même garde que
  les buckets. Sans elle, la migration s'applique sans bruit et le README indique comment appeler les
  deux fonctions depuis un ordonnanceur externe.
- **Un client en erreur n'interrompt pas les autres.** Une boucle qui s'arrête au premier client
  fautif donne l'illusion de fonctionner : le journal dit « exécuté » et quarante clients n'ont rien
  reçu. Chaque échec est consigné avec son identifiant, et la boucle continue.
- Journal `scheduled_task_runs` : tâche, durée, clients parcourus, changements, anomalies. Lisible par
  la seule plateforme — son contenu révélerait le nombre et l'activité des autres clients.
- L'écran *Plateforme* affiche les vingt dernières exécutions, et **dit explicitement qu'aucune n'a
  eu lieu** quand le tableau est vide : « si l'ordonnanceur est censé tourner, il ne tourne pas ».
  Un tableau vide se lit sinon « tout va bien ».
- L'évaluation des alertes se place sur chaque client au lieu d'emprunter un chemin privilégié : les
  mêmes règles s'appliquent qu'à un appel ordinaire, et le contexte est rendu ensuite.

**Défauts trouvés par les tests, et corrigés**

1. **Une table créée après la migration `1200` est inaccessible.** Le `grant … on all tables` de la
   `1200` ne porte que sur les tables existant alors ; `scheduled_task_runs` a été la première créée
   ensuite, et renvoyait « permission denied » — RLS n'avait même pas l'occasion de s'appliquer, et le
   message ne disait rien du cloisonnement. Corrigé, et un audit du catalogue vérifie désormais
   qu'aucune table n'est privée de droit.
2. **L'audit de sécurité a signalé trois invariants** sur la nouvelle table (pas de `tenant_id`,
   politique de lecture sans filtre de tenant, écriture sans `tenant_can_write`). Ce sont des
   exclusions légitimes — une exécution planifiée n'appartient à aucun client — mais elles sont
   maintenant nommées et motivées, pas silencieuses.
3. **Le harnais E2E inventait une ligne pour toute fonction non simulée**, ce qui faisait planter les
   écrans sur un enregistrement aux champs manquants, loin de la cause. Une fonction inconnue ne
   renvoie plus rien.
4. Deux préparations de test violaient la contrainte d'ordre des périodes d'abonnement : c'est la
   contrainte qui faisait son travail, pas la règle testée.

**Limites assumées**

- **`pg_cron` n'a jamais été exercé** : la base locale ne l'héberge pas. Les fonctions, elles, sont
  testées ; c'est la planification elle-même qui reste à vérifier sur le projet hébergé.
- Aucune tâche ne relance automatiquement un client tombé en erreur : l'anomalie est visible dans la
  console, sa reprise est une décision humaine.


---

## Conditions de livraison (commande §27)

| Condition | État |
| --- | --- |
| Toutes les migrations sont versionnées | ✅ 24 migrations ordonnées |
| Toutes les tables exposées ont RLS activée | ✅ vérifié par un audit du catalogue, pas par une liste |
| Les politiques RLS ont des tests | ✅ 292 tests de base, dont 39 d'audit systématique |
| Les parcours P0 ont des tests Playwright | ✅ E2E-01 → E2E-20, 202 tests (bureau + Android) |
| Les calculs financiers ont des tests unitaires | ✅ prix, arithmétique, FIFO, exposition, plafonds, poids, écarts, stock, planning, TCB, marges, scoring, alertes, abonnement, rapports, tableau de bord |
| La synchronisation hors ligne a des tests | ✅ OFF-01 → OFF-14 (38 tests) + audit du code et endurance (11 tests) |
| Les erreurs sont affichées clairement | ✅ vérifié par test : tout écran qui écrit affiche ses échecs |
| Le build de production réussit | ✅ |
| Aucun secret n'est commité | ✅ vérifié par test |
| Le README explique l'installation | ✅ |
| Le README explique le déploiement | ✅ dont les deux tâches planifiées à installer |
| Un compte de démonstration exécute le parcours complet | 🟡 le parcours complet est **exécuté et vérifié en base** (E2E-14) ; `npm run db:seed` prépare le jeu de démonstration. Il n'a jamais été rejoué contre un projet Supabase hébergé |

**La dernière ligne est la seule réserve de cette livraison, et elle est réelle** : le produit n'a
jamais tourné contre une instance Supabase. Toutes les règles serveur sont vérifiées contre un
PostgreSQL exécutant les migrations réelles, et tous les parcours contre un PostgREST simulé. Le
raccordement au projet hébergé reste à faire, et c'est là que se logeront les surprises éventuelles.

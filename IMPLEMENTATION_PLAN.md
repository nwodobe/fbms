# LBA Control — Plan d'implémentation

**Mis à jour : fin de Phase 1.**
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
| 2 | Identité visuelle, sociétés partenaires, campagnes, contrats, prix | ⬜ À faire |
| 3 | Pisteurs, financements, avances, achats, synchronisation hors ligne | ⬜ À faire |
| 4 | Stocks, réservations, planning, transferts, réceptions, écarts, incidents | ⬜ À faire |
| 5 | Dépenses, allocations, TCB, marges, scoring, alertes | ⬜ À faire |
| 6 | Abonnements, personnalisation des documents, exports, tableaux de bord | ⬜ À faire |
| 7 | Tests complets, audit RLS, audit hors ligne, optimisation mobile, documentation, déploiement | ⬜ À faire |

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

## Phases 2 à 7 — Plan détaillé

### Phase 2 — Identité visuelle et référentiel commercial

Écrans `H01`, `B01`, `B02`, `B03`, `A01`.
Marque du tenant (deux couleurs, contraste WCAG vérifié au serveur), sociétés partenaires, campagnes,
contrats, prix négociés versionnés et non écrasables, instantané de prix sur les opérations.
*Terminée quand* : RG-06, RG-07, E2E-01, E2E-02 et le test de contraste passent.

### Phase 3 — Terrain et argent

Écrans `C01`, `C02`, `C03`, `D01`, `D02`.
Pisteurs et plafonds, financements et volume théorique, avances avec contrôle de plafond et dérogation
tracée, achats terrain, **file hors ligne Dexie non bornée**, synchronisation idempotente, détection de
doublons, allocation FIFO.
*Terminée quand* : RG-01, RG-08, RG-12, OFF-01 → OFF-08, E2E-03 → E2E-05 passent.

### Phase 4 — Matière et logistique

Écrans `D03`, `E01`, `E02`, `E03`, `E14`.
Lots, mouvements, réservation transactionnelle, planning, transferts avec **quatre poids distincts**,
réception, cinq écarts calculés, incidents bloquant la clôture.
*Terminée quand* : RG-02 → RG-05, RG-09, RG-10, E2E-06 → E2E-08 passent.

### Phase 5 — Rentabilité

Écrans `F01`, `F02`, `F03`, `G01`, `G02`.
Dépenses et validations, allocations indirectes par six clés, TCB prévisionnel et réel, prix net, marges et
**écart de réconciliation**, score explicable sur 100, alertes.
*Terminée quand* : RG-11 et les tests unitaires de `tcb.ts`, `margin.ts`, `scoring.ts`, `alerts.ts` passent.

### Phase 6 — Commercial et pilotage

Écrans `A02`, `A03`, `H02`, `H03`, `Z01`.
Abonnements (cycle J-7 / J-3 / J / grâce / lecture seule / blocage), confirmation manuelle de paiement,
exports PDF et Excel à la marque du tenant, tableaux de bord dirigeant avec filtres.
*Terminée quand* : RG-13 → RG-15, E2E-12, E2E-13 passent.

### Phase 7 — Stabilisation

Suite de tests complète, audit RLS, audit hors ligne, optimisation mobile Android en réseau faible,
documentation d'installation et de déploiement, compte de démonstration exécutant le parcours complet.

---

## Conditions de livraison (commande §27)

| Condition | État |
| --- | --- |
| Toutes les migrations sont versionnées | ✅ 13 migrations ordonnées |
| Toutes les tables exposées ont RLS activée | ✅ vérifié par test |
| Les politiques RLS ont des tests | ✅ suite dédiée exécutée |
| Les parcours P0 ont des tests Playwright | ⬜ phases 3 à 6 |
| Les calculs financiers ont des tests unitaires | ⬜ phase 5 |
| La synchronisation hors ligne a des tests | ⬜ phase 3 |
| Les erreurs sont affichées clairement | ⬜ au fil des écrans |
| Le build de production réussit | ✅ |
| Aucun secret n'est commité | ✅ vérifié par test |
| Le README explique l'installation | ✅ |
| Le README explique le déploiement | ✅ |
| Un compte de démonstration exécute le parcours complet | ⬜ phase 7 |

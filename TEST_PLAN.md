# LBA Control — Plan de tests

Règle de travail imposée : **aucune fonction n'est déclarée terminée avant l'exécution des tests
correspondants.** Ce document énumère ce qui doit être vérifié, par quel moyen, et à quelle phase.

---

## 1. Pyramide et outillage

| Niveau | Outil | Portée | Commande |
| --- | --- | --- | --- |
| Unitaire | Vitest | `src/domain/*` — calculs financiers purs | `npm test` |
| Composant | Vitest + React Testing Library | Formulaires, gardes de rôle, messages d'erreur | `npm test` |
| Base / RLS | Vitest (runner `node`) + `pg` sur PostgreSQL réel | Isolation, permissions, contraintes, triggers | `npm run test:rls` |
| Hors ligne | Vitest + `fake-indexeddb` | File Dexie, idempotence, non-perte | `npm test` |
| E2E | Playwright | Parcours P0 de bout en bout | `npm run test:e2e` |

Les tests RLS s'exécutent contre un **véritable PostgreSQL** : les migrations sont appliquées telles quelles,
puis chaque cas simule le mécanisme d'authentification Supabase —

```sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"…","app_metadata":{"tenant_id":"…","role":"pisteur"}}', true);
```

C'est le même chemin de code que celui exécuté en production : `auth.uid()` et `auth.jwt()` lisent ces
réglages. Une politique qui passe ici passe chez Supabase.

---

## 2. Tests de sécurité et d'isolation (P0 — bloquants)

| ID | Vérification | Attendu |
| --- | --- | --- |
| SEC-01 | RLS activée sur **toutes** les tables de `public` | Aucune table exposée sans `rowsecurity` |
| SEC-02 | Chaque table possède les 4 politiques `SELECT`/`INSERT`/`UPDATE`/`DELETE` | Aucune table incomplète |
| SEC-03 | Un utilisateur du tenant A lit les données du tenant B | **0 ligne**, y compris par `id` direct |
| SEC-04 | Un utilisateur du tenant A écrit dans le tenant B | Rejet |
| SEC-05 | Un pisteur lit les achats d'un autre pisteur | **0 ligne** |
| SEC-06 | Un pisteur lit `tcb_snapshots` / marges | **0 ligne** |
| SEC-07 | Un auditeur tente une écriture | Rejet sur toutes les tables |
| SEC-08 | Suppression physique d'un achat, d'un transfert, d'une dépense | Rejet (`DELETE` restrictive) |
| SEC-09 | Modification ou suppression d'une entrée `audit_log` | Rejet pour tous les rôles |
| SEC-10 | Écriture avec abonnement `suspended_read_only` | Rejet en écriture, **lecture OK** |
| SEC-11 | Écriture avec abonnement `suspended` | Rejet en écriture |
| SEC-12 | Super-admin lisant un tenant **sans** session d'assistance | **0 ligne** |
| SEC-13 | Super-admin **avec** session active et motivée | Lecture autorisée + entrée d'audit |
| SEC-14 | Session d'assistance expirée | Accès refusé de nouveau |
| SEC-15 | Un comptable modifie un poids de réception | Rejet |
| SEC-16 | Aucun secret dans les fichiers suivis par git | Aucun motif de clé de service / JWT |

---

## 3. Tests des règles métier en base (P0)

| ID | Règle | Attendu |
| --- | --- | --- |
| RG-01 | Financement OLAM couvert par livraison DORADO | Rejet (CA-02) |
| RG-02 | Double réservation du même stock | La seconde échoue (CA-04) |
| RG-03 | Réservation supérieure au disponible | Rejet |
| RG-04 | Stock négatif | Rejet (`CHECK`) |
| RG-05 | Réaffectation inter-sociétés sans motif ni approbateur | Rejet (CA-11) |
| RG-06 | Écrasement d'un prix négocié actif | Rejet — une révision crée une version |
| RG-07 | Chevauchement de deux prix actifs de même type | Rejet (`EXCLUDE`) |
| RG-08 | Achat sans société **et** sans `is_own_account` | Rejet (`CHECK`, arbitrage D9) |
| RG-09 | Les 4 poids restent 4 colonnes distinctes | Aucune colonne générique « livré » (CA-05) |
| RG-10 | Écart supérieur à la tolérance | Incident créé, clôture bloquée (CA-06) |
| RG-11 | Dépense de catégorie `achat_produit` saisie manuellement | Rejet (anti double comptage) |
| RG-12 | Créateur d'une avance = approbateur | Rejet (séparation des tâches) |
| RG-13 | Rejeu du même paiement d'abonnement (`idempotency_key`) | La période n'est prolongée qu'une fois |
| RG-14 | Paiement partiel | Conservé comme avoir, **ne renouvelle pas** |
| RG-15 | Déclaration de paiement par le client | Aucun changement de statut sans confirmation admin |
| RG-16 | Trigger d'audit sur changement de poids / prix / montant / société | Entrée avec ancienne et nouvelle valeur |
| RG-17 | Montant, catégorie ou bénéficiaire d'une **dépense validée** modifié | Rejet — une validation révisable est décorative |
| RG-18 | Dépense validée par la personne qui l'a soumise | Rejet (séparation des tâches) |
| RG-19 | Charge indirecte répartie sur une **clé valant zéro** | Rejet nommé — des quotes-parts nulles feraient disparaître la charge du TCB |
| RG-20 | Répartition rejouée sur le même périmètre | Remplace l'ancienne, une seule ligne, montant exact |
| RG-21 | TCB d'un périmètre après décaissement d'une avance | **Inchangé** — une remise de fonds n'est pas un coût |
| RG-22 | Calcul d'un score | `field_agents.ceiling_amount` **inchangé** — la recommandation ne s'applique jamais seule |
| RG-23 | Ajustement de score sans motif d'au moins 10 caractères | Rejet ; le score brut reste intact après un ajustement valide |
| RG-24 | Évaluation des alertes rejouée | 0 alerte ouverte, aucune clé de déduplication en double |
| RG-25 | Client faisant passer son paiement à `confirmed` par une mise à jour de ligne | Rejet — la confirmation est un chemin de code, pas un champ modifiable |
| RG-26 | Déclaration de paiement sans référence | Rejet — un paiement sans référence est invérifiable |
| RG-27 | Bascule du cycle vers lecture seule puis blocage | Comptes d'achats, d'avances et de dépenses **inchangés** |
| RG-28 | Rappels J-7 / J-3 / J rejoués | Aucun second envoi ; un renouvellement rouvre une série |
| RG-29 | Clôture d'une campagne avec obstacle | Rejet énumérant les obstacles ; forçage exigeant 20 caractères de motif |
| RG-30 | Écriture d'un achat ou d'une dépense sur une campagne clôturée | Rejet ; la réouverture motivée les rouvre |
| RG-31 | Réouverture par un rôle autre que propriétaire | Rejet |
| RG-32 | Appel de la fonction d'archivage | `deletion_performed: false`, aucune ligne supprimée |

### Audits systématiques (phase 7)

Ces tests n'énumèrent aucune table à la main : ils interrogent le catalogue et affirment des
invariants, de sorte qu'une table ou une fonction ajoutée plus tard entre automatiquement dans le
périmètre contrôlé.

| ID | Invariant | Attendu |
| --- | --- | --- |
| AUD-01 | Toute table métier porte un `tenant_id NOT NULL` | Seules `audit_log` et `users` l'acceptent nul, et c'est motivé |
| AUD-02 | Aucune table du schéma public n'échappe à RLS | Liste vide |
| AUD-03 | Chaque table porte les quatre politiques | Liste vide |
| AUD-04 | Chaque politique de lecture filtre sur le tenant | Liste vide |
| AUD-05 | Le tenant B ne voit rien du tenant A, sur **toutes** les tables (> 50) | Liste vide |
| AUD-06 | Toute table à statut terminal refuse la suppression physique | Politique présente **et** `false` |
| AUD-07 | Toute fonction `SECURITY DEFINER` verrouille son `search_path` | Liste vide |
| AUD-08 | Le rôle `anon` n'atteint aucune fonction ni le schéma `app` | Liste vide |
| AUD-09 | Chaque politique d'écriture vérifie le verrou d'abonnement | Exclusions nommées et motivées |
| AUD-10 | Aucun module hors ligne n'appelle de suppression sur la file | Liste vide |
| AUD-11 | Aucune constante ne plafonne la file | Liste vide |
| AUD-12 | 500 opérations, échecs, conflits, réouverture | Zéro perte, intégrité vérifiée |
| AUD-13 | Point d'entrée et préchargement sous budget | < 460 kB et < 1 100 kB |
| AUD-14 | Tout écran qui écrit affiche ses échecs | Liste vide |
| AUD-15 | La console plateforme ne renvoie aucune clé métier | Aucun `purchase`, `price`, `margin`, `agent_name` |
| AUD-16 | Suspendre un client ne supprime rien | Compteurs identiques avant et après |
| AUD-17 | Solde de sacs reconstruit depuis les seuls mouvements | Cache abîmé volontairement, vérité rétablie |
| AUD-18 | Justificatif exigé à la validation, pas à la saisie | Saisie acceptée sans pièce, validation refusée |

---

## 4. Tests unitaires des calculs financiers (P0)

Fonctions pures de `src/domain/`, sans réseau ni base, horloge injectée.

| Module | Cas couverts |
| --- | --- |
| `weights.ts` | Les 5 écarts (physique, acceptation, paiement, total acceptation, financier total), variation de tare, division par zéro, poids négatifs |
| `coverage.ts` | FIFO : une livraison → plusieurs avances ; une avance → plusieurs livraisons ; couverture partielle **conservant la date d'origine** ; correction manuelle approuvée ; taux de couverture > 100 % visible mais plafonné pour le score |
| `tcb.ts` | TCB prévisionnel vs réel ; dépense validée non payée **incluse** ; dépense rejetée/annulée **exclue** ; `achat_produit` **écartée avec motif** ; avance **jamais** incluse ; répartition indirecte par les 6 clés, `manuel` non calculable ; clé nulle ⇒ refus explicite ; décomposition qui reconstitue le total ; poids accepté = 0 ⇒ `null`, pas de division par zéro |
| `margin.ts` | Prix net = négocié + primes − pénalités − retenues ; marge totale ; marge/kg ; **écart de réconciliation** entre les deux (INC-06) ; opération déficitaire détectée |
| `scoring.ts` | Somme des poids = 100 ; chaque composante explicable ; score brut vs ajusté vs affiché ; événements validés seuls retenus ; composante non mesurée **exclue et non notée zéro**, poids renormalisés ; nouveau pisteur `non_evalue` ; aucune sanction automatique produite |
| `alerts.ts` | Les 20 règles, seuils configurables, aucune alerte muette ; chaque candidat porte mesure, seuil et clé de déduplication ; aucun message n'impute de responsabilité |
| `subscription.ts` | Rappels J-7 / J-3 / J avec clé d'idempotence rattachée à l'échéance ; grâce 5 j en accès complet ; lecture seule à J+6 ; blocage à J+31 ; **aucune donnée supprimée à aucune phase** ; prolongation **à partir de la date de fin existante** si encore actif, du jour du paiement sinon ; paiement partiel = avoir sans renouvellement ; export et déclaration restent ouverts après blocage |
| `duplicates.ts` | Doublon probable détecté ; GPS **jamais** preuve unique ; faux positif non bloquant |
| `money.ts` | Arrondis XOF, absence de dérive de flottant, montants négatifs refusés |
| `bags.ts` | Soldes déduits des deux bouts de chaque mouvement ; sacs de deux sociétés non mélangés ; perte et réaffectation justifiées ; taux de perte `null` si rien n'a été distribué |
| `uploads.ts` | Type vérifié par signature ; exécutable renommé refusé ; limites par usage ; chemin portant le tenant et écartant le nom d'origine ; dimensions cibles |
| `reports.ts` | Valeur absente exportée « — » et jamais 0 ; totaux sur les seules colonnes sommables ; colonne entièrement vide sans total ; mention de démonstration ; nom de fichier stable |
| `dashboard.ts` | Indicateur sans source à `null` ; un seul instantané de TCB par périmètre ; exposition jamais négative ; jours sans achat omis de la série |

---

## 5. Tests hors ligne (P0)

| ID | Vérification | Attendu |
| --- | --- | --- |
| OFF-01 | Une opération `pending` n'est jamais supprimée | Présente après échecs, rechargement, purge de cache |
| OFF-02 | File **non bornée** | 1 500 opérations en file, aucune perte, aucune limite à 300 |
| OFF-03 | Synchronisation idempotente | 3 rejeux ⇒ 1 seule ligne serveur (CA-03) |
| OFF-04 | Détection de doublon à la synchronisation | Signalé, non dupliqué |
| OFF-05 | Conflit | **Affiché**, jamais écrasé silencieusement |
| OFF-06 | Compteur de tentatives et dernière erreur | Renseignés après échec |
| OFF-07 | Journal de synchronisation | Prouve qu'aucune opération n'a disparu |
| OFF-08 | Appareil révoqué | Synchronisation refusée |
| OFF-09 | Un justificatif n'est jamais jeté | Présent après échecs répétés et après refus définitif |
| OFF-10 | Octets d'abord, chemin ensuite | Aucun `proof_path` écrit tant que les octets ne sont pas stockés |
| OFF-11 | Photo arrivée avant son opération | « 0 ligne mise à jour » ⇒ report, pas abandon |
| OFF-12 | Un emplacement, un fichier | Re-photographier remplace et journalise ; départ ≠ réception |
| OFF-13 | Intégrité de la file des fichiers | Ligne présente au contenu vide ⇒ signalée, envoi refusé |
| OFF-14 | File des justificatifs **non bornée** | 320 fichiers conservés ; `batchSize` ne borne que l'envoi |

---

## 6. Parcours E2E Playwright (P0)

| ID | Parcours | Critère de succès |
| --- | --- | --- |
| E2E-01 | Connexion personnalisée + marque du tenant | Logo, nom et deux couleurs appliqués ; aucune liste d'autres clients |
| E2E-02 | Société → contrat → prix → activation | CA-01 |
| E2E-03 | Financement reçu + volume théorique | CA-02, P2 du DMQ |
| E2E-04 | Avance avec contrôle de plafond et alerte d'ancienneté | P2, blocage surmontable par dérogation tracée |
| E2E-05 | Achat hors ligne → synchronisation → stock créé | CA-03 |
| E2E-06 | Planning → réservation → double réservation refusée | CA-04 |
| E2E-07 | Transfert : 8 000 kg chargés / 7 940 kg déchargés / accepté / payé | CA-05, quatre poids distincts |
| E2E-08 | Écart au-delà du seuil → incident → clôture bloquée | CA-06 |
| E2E-09 | Dépenses directes et indirectes → TCB/kg accepté | CA-07 |
| E2E-10 | Marge sur prix net reconnu | CA-08 |
| E2E-11 | Score pisteur expliqué composante par composante | CA-10 |
| E2E-14 | **Parcours complet** : financement → avance → achat → transfert → réception → dépense → TCB → marge → alerte → clôture | CA-01 → CA-11 |
| E2E-15 | Sacherie : soldes déduits, perte expliquée, réaffectation approuvée | CA-11 |
| E2E-16 | Clôture de campagne : obstacles énumérés, forçage motivé, réouverture réservée | D10 |
| E2E-17 | Console plateforme : aucune donnée métier, assistance motivée | CMD §4 |
| E2E-12 | Exports PDF/Excel à la marque du tenant, sans données concurrentes | CA-12 |
| E2E-13 | Échéance d'abonnement → lecture seule → réactivation après confirmation | DMQ E18 |
| E2E-14 | Annulation d'une opération clôturée par écriture inverse | CA-13, aucune suppression |
| E2E-18 | Images de marque : trois emplacements, signature contrôlée, lien temporaire | CDC §23.4 |
| E2E-19 | Tickets de pesée : départ et réception distincts, réservés aux rôles qui pèsent | RG-09 |
| E2E-20 | Preuve d'achat hors réseau : fichier conservé, achat annoncé **sans** justificatif | CDC §19 |
| E2E-21 | Logo dans les exports : document produit même sans lui, absence expliquée | CDC §5 |
| E2E-22 | Tâches planifiées : exécutions visibles, anomalies comptées, absence signalée | CDC §20 |
| E2E-23 | Notifications : pastille honnête, urgence avant récence, lue ≠ résolue | CDC §18 |

---

## 7. Tests d'interface et d'accessibilité

- Contraste WCAG AA vérifié pour toute paire de couleurs choisie par un client — une couleur illisible est
  **refusée avec sa mesure** (CDC §23.1).
- Rendu mobile Android (360 × 640) pour les écrans pisteur ; tablette et bureau pour le pilotage.
- Messages d'erreur prioritaires conformes au libellé attendu (DMQ §5.3) : mélange de fonds, stock
  insuffisant, prix dépassé, avance ancienne, pesée incomplète, abonnement suspendu.
- Aucune erreur silencieuse : tout échec réseau ou de validation est affiché à l'utilisateur.

---

## 8. Rattachement aux phases

| Phase | Tests exigés avant de la déclarer terminée |
| --- | --- |
| 1 — Socle, RLS, audit | SEC-01 → SEC-16, RG-16 |
| 2 — Marque, sociétés, contrats, prix | RG-06, RG-07, E2E-01, E2E-02, contraste |
| 3 — Pisteurs, financements, avances, achats, hors ligne | RG-01, RG-08, RG-12, `coverage.ts`, OFF-01 → OFF-08, E2E-03 → E2E-05 |
| 4 — Stocks, planning, transferts, réceptions, incidents | RG-02 → RG-05, RG-09, RG-10, `weights.ts`, E2E-06 → E2E-08 |
| 5 — Dépenses, TCB, marges, scoring, alertes | RG-11, RG-17 → RG-24, `tcb.ts`, `margin.ts`, `scoring.ts`, `alerts.ts`, E2E-09 → E2E-11 |
| 6 — Abonnements, documents, exports, tableaux de bord | RG-13 → RG-15, RG-25 → RG-32, `subscription.ts`, `reports.ts`, `dashboard.ts`, E2E-12, E2E-13 |
| 7 — Stabilisation | AUD-01 → AUD-14, E2E-14, suite complète, build de production |
| 8 — Écrans manquants et fichiers | AUD-15 → AUD-18, `bags.ts`, `uploads.ts`, E2E-15 → E2E-17 |
| 9 — Justificatifs, marque, notifications, planification | `attachments.ts`, `brandmark.ts`, `notifications.ts`, OFF-09 → OFF-14, E2E-18 → E2E-23, rattachements vérifiés en base |
| Clôture — messages sortants, documents, administration, ouverture d'un client | `messaging.ts`, `documents.ts`, `tenants.ts`, E2E-24 → E2E-27, suites `outgoing-messages`, `user-administration` et `tenant-provisioning` en base |

---

## 9. Conditions de livraison (rappel de la commande §27)

- [ ] Toutes les migrations sont versionnées
- [ ] Toutes les tables exposées ont RLS activée
- [ ] Les politiques RLS ont des tests
- [ ] Les parcours P0 ont des tests Playwright
- [ ] Les calculs financiers ont des tests unitaires
- [ ] La synchronisation hors ligne a des tests
- [ ] Les erreurs sont affichées clairement
- [ ] Le build de production réussit
- [ ] Aucun secret n'est commité
- [ ] Le README explique l'installation et le déploiement
- [ ] Un compte de démonstration exécute le parcours complet

L'état réel de ces cases est tenu à jour dans `IMPLEMENTATION_PLAN.md` — **jamais coché par anticipation**.

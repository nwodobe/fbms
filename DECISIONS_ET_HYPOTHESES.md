# LBA Control — Hypothèses critiques, incohérences et arbitrages

Document produit avant toute ligne de code, conformément à la méthode de travail imposée (§1.7 et §1.8 de la
commande : « Présente les hypothèses critiques et les incohérences éventuelles » / « Ne supprime jamais une
exigence métier sans la signaler »).

Sources analysées :

| Réf. | Document | Rôle |
| --- | --- | --- |
| **CMD** | Commande de développement (prompt du 30/07/2026) | **Source contraignante n° 1** |
| **CDC** | Cahier des charges LBA Control V3 — Marque & Abonnements | Source métier de référence |
| **DCP** | Dossier de Conception MVP LBA Control V1 | Périmètre MVP et recette |
| **DMQ** | Dossier Maquettes & Spécifications d'écrans V1 | Écrans, contrôles et messages |

Règle d'arbitrage appliquée : **CMD > CDC > DCP > DMQ**. Quand une source de rang inférieur ajoute une
exigence absente des rangs supérieurs, l'exigence est **conservée** (jamais supprimée) et signalée ici.

---

## 1. Incohérences détectées entre les documents

### INC-01 — Formule de l'écart d'acceptation (contradiction directe) · **Criticité : haute**

| Source | Formule |
| --- | --- |
| CMD §14 | `ecart_acceptation_kg = poids_decharge - poids_accepte` |
| CDC §12.3 | « Écart accepté kg = Poids net chargé − poids accepté » |

Les deux formules sont différentes et **toutes deux métier-valides** : la première isole le refus qualité au
site de réception, la seconde mesure la perte totale entre le départ et la reconnaissance.

**Décision retenue — aucune des deux n'est supprimée.** Quatre écarts nommés sont persistés :

```
ecart_physique_kg          = poids_charge   - poids_decharge      (CMD §14 + CDC §12.3, identiques)
ecart_acceptation_kg       = poids_decharge - poids_accepte       (CMD §14)
ecart_paiement_kg          = poids_accepte  - poids_paye          (CMD §14)
ecart_total_acceptation_kg = poids_charge   - poids_accepte       (CDC §12.3, colonne dérivée)
ecart_financier_total_kg   = poids_charge   - poids_paye          (CDC §12.3, colonne dérivée)
```

Les seuils de tolérance s'appliquent par défaut à `ecart_physique_pct`, avec un seuil séparé et facultatif
sur `ecart_acceptation_kg` (rejet qualité). Voir `DATABASE_SCHEMA.md` § Transferts.

### INC-02 — Le référentiel des rôles diffère dans les trois documents · **Criticité : haute**

| CMD §4 (7 profils) | CDC §5 (9 profils) | DCP §3 (8 profils) |
| --- | --- | --- |
| super_admin | — | super_admin |
| proprietaire | Propriétaire / DG | Propriétaire / DG |
| gestionnaire | Administrateur | Gestionnaire opérations |
| comptable | Finance / Caissier | Comptable / finance |
| responsable_terrain | Responsable achats | — |
| — | **Magasinier** | **Responsable magasin** |
| — | **Logistique** | — |
| pisteur | Pisteur | Pisteur |
| auditeur | Auditeur | Auditeur |
| — | **Société partenaire** | Société partenaire (optionnelle) |

**Décision retenue.** L'énumération `user_role` contient **les 10 rôles de l'union**, pour ne perdre aucune
exigence. Les 7 rôles de la CMD sont **actifs et testés au MVP**. `magasinier`, `logistique` et
`partenaire_externe` existent en base avec leurs politiques RLS, mais **ne sont pas attribuables depuis
l'interface MVP** (drapeau `is_assignable = false`), conformément à DCP §11 qui reporte le portail société
partenaire en P2. Aucune exigence n'est supprimée ; elles sont désactivées de façon réversible.

### INC-03 — Statuts d'abonnement : la liste de la CMD ne permet pas d'exécuter le cycle qu'elle décrit ·
**Criticité : haute**

CMD §20 impose 8 statuts (`trial, pending_payment, active, grace_period, overdue, suspended, cancelled,
expired`) **et** décrit un cycle à deux niveaux de suspension : « après la grâce : lecture seule ; après
30 jours : accès bloqué ». Avec un seul statut `suspended`, les deux niveaux ne sont pas représentables.

CDC §20.6 fournit la liste complète avec `SUSPENDED_READ_ONLY` **et** `SUSPENDED`.

**Décision retenue.** 9 statuts : les 8 de la CMD **plus** `suspended_read_only` (issu du CDC). Le cycle
implémenté est : `active → (J) grace_period → (J+5) suspended_read_only → (J+30) suspended`. `overdue` est
un marqueur de relance renforcée porté par la facture, pas un blocage d'accès.

### INC-04 — Les statuts de stock mélangent trois dimensions indépendantes · **Criticité : moyenne**

CMD §12 impose 9 statuts (`disponible, réservé, chargé, en transit, réceptionné, rejeté, bloqué, en litige,
clôturé`). CDC §11.1 et DMQ §5.2 en ajoutent trois autres : `chez pisteur`, `en magasin`, `déchargé`,
`accepté`.

Ces valeurs relèvent en réalité de **trois axes orthogonaux** : la *localisation* (chez le pisteur / en
magasin / en transit / chez la société), la *disponibilité* (disponible / réservé / bloqué) et l'*avancement
logistique* (chargé / déchargé / accepté / rejeté). Les fusionner produit des états impossibles à maintenir
(un lot « chez pisteur » est aussi « disponible »).

**Décision retenue.** `stock_lots.status` conserve **exactement les 9 valeurs imposées par la CMD** (aucune
exigence supprimée). La localisation est portée par `holder_type` (`field_agent | warehouse | in_transit |
partner_site`) + `holder_id`, ce qui restitue « chez pisteur » et « en magasin » sans état contradictoire.
`déchargé` et `accepté` sont des états du **transfert**, pas du lot, et sont donc portés par `transfers`.

### INC-05 — Risque de double comptage du prix d'achat dans le TCB · **Criticité : haute**

CMD §16 impose la catégorie de dépense « achat produit » **et** la formule
`TCB_total = valeur_achat + dépenses_validées + …`. Si un utilisateur saisit une dépense de catégorie
« achat produit », la valeur d'achat est comptée deux fois.

**Décision retenue.** La catégorie `achat_produit` est **réservée au système** (`is_system_reserved = true`) :
elle existe dans le référentiel (exigence conservée) mais est refusée en saisie manuelle par contrainte
serveur. La valeur d'achat du TCB provient exclusivement de `purchases`. Idem pour `commission_pisteur`
lorsqu'elle est générée automatiquement par la règle de commission du contrat pisteur.

### INC-06 — `marge_totale` et `marge_par_kg` ne sont pas réconciliables entre elles · **Criticité : moyenne**

CMD §16 :
`marge_totale = chiffre_affaires_net − TCB_total` et `marge_par_kg = prix_vente_net − TCB_par_kg_accepte`.

`marge_par_kg × poids_accepté = marge_totale` seulement si le chiffre d'affaires net porte exactement sur le
poids accepté. Dès qu'un avoir, une retenue forfaitaire ou une pénalité non proportionnelle intervient, les
deux indicateurs divergent — sans que cela soit une erreur.

**Décision retenue.** Les deux indicateurs sont calculés et **affichés côte à côte avec leur écart de
réconciliation explicite** (`marge_ecart_reconciliation`). Aucun des deux n'est présenté comme dérivable de
l'autre. L'écart est un élément de contrôle, pas un bug.

### INC-07 — Volumétrie du jeu de démonstration divergente · **Criticité : basse**

| Objet | CMD §25 | DCP §13 |
| --- | --- | --- |
| Contrats | 2 | 3 (dont un prix expiré) |
| Financements | 3 | 4 |
| Avances | 8 | 10 |
| Achats | 25 | 30 (dont 2 doublons, 3 hors ligne) |
| Plannings | 4 | 6 |
| Transferts | 4 | 5 |

**Décision retenue.** Le seed respecte **les volumes de la CMD** (source contraignante) mais intègre les
**caractéristiques qualitatives du DCP** qui sont des exigences de test réelles : un prix expiré, des doublons
probables d'achats, des achats hors ligne non synchronisés, des transferts à écart vert / orange / rouge, un
planning annulé et un planning futur. Rien n'est perdu, seuls les volumes sont alignés.

### INC-08 — Trois formulations du fait générateur de la couverture d'une avance · **Criticité : haute**

CDC §27-D1 laisse la question ouverte. DCP §15 et DMQ §8 recommandent la **livraison réceptionnée et
acceptée**. CMD §10 impose l'affectation FIFO sans trancher le fait générateur.

**Décision retenue.** `contracts.coverage_basis` — énumération à trois valeurs
(`purchase_validated | reception_accepted | payment_received`), **valeur par défaut `reception_accepted`**
conformément à la recommandation DCP/DMQ. La règle est donc paramétrable par contrat, ce qui satisfait CDC
§2.1 (« les formules sensibles doivent être configurables par société et par contrat ») sans figer un
arbitrage qui appartient au métier.

---

## 2. Hypothèses critiques (à valider par le métier)

| ID | Hypothèse retenue pour construire | Impact si fausse |
| --- | --- | --- |
| **H-01** | Devise unique **XOF (FCFA), 0 décimale d'affichage**, montants stockés en `numeric(18,2)`. Le champ `currency` par tenant existe mais aucune conversion multi-devise n'est implémentée. | Faible — ajout d'une table de taux. |
| **H-02** | Le produit est **RCN (noix brutes de cajou)** uniquement au MVP. La table `products` existe et est référencée partout, mais un seul produit est semé. | Faible — le modèle est déjà générique. |
| **H-03** | Un **pisteur = un compte utilisateur** (`field_agents.user_id`). Un pisteur sans compte peut exister (saisie déléguée) mais ne bénéficie alors pas du mode hors ligne. | Moyen — révision du cloisonnement RLS pisteur. |
| **H-04** | Le **poids accepté est le dénominateur par défaut** du TCB (CDC §13.4). Si `poids_accepté = 0`, le TCB/kg est **`NULL` et signalé**, jamais une division par zéro ni un zéro trompeur. | Faible. |
| **H-05** | Les **achats propres du LBA** (sans financement société — décision ouverte D9) sont autorisés : `partner_company_id` peut être `NULL` **uniquement** si `is_own_account = true`, garanti par contrainte `CHECK`. | Moyen — sinon rendre la société obligatoire partout. |
| **H-06** | La **période de grâce vaut 5 jours** (CMD §20 et CDC §20.4), paramétrable par tenant. Décision CDC §27 (3/5/7) non tranchée. | Faible — paramètre. |
| **H-07** | Le **mode d'assistance super-administrateur** est une session explicite, motivée, horodatée et à durée limitée (`platform_support_sessions`), et non un privilège permanent. Hors session active, le super-admin **ne lit aucune donnée métier**. | Élevé si refusé — mais c'est l'exigence CMD §4. |
| **H-08** | Le **journal d'audit est alimenté par triggers PostgreSQL**, pas par le client. Aucune écriture d'audit n'est faite depuis le navigateur. | Faible. |
| **H-09** | Les **seuils d'alerte** sont résolus en cascade : contrat → société partenaire → tenant → défaut produit. | Faible. |
| **H-10** | Le **score pisteur est recalculé par lot** (fonction serveur planifiée + déclenchement manuel), et non à la volée à chaque lecture, pour rester explicable et versionné (RG-12). | Moyen — sinon perte de reproductibilité. |
| **H-11** | **Aucune sanction automatique** : le blocage d'une nouvelle avance produit un **avertissement bloquant surmontable par dérogation tracée**, jamais une suspension automatique du pisteur (CMD §17, §9). | Élevé — exigence explicite. |
| **H-12** | Le tenant est résolu par **code entreprise / sous-chemin d'URL** (`app.lbacontrol.ci/<slug>`), pas par sous-domaine ; les domaines personnalisés sont hors MVP (CDC §20.2). | Faible. |
| **H-13** | Les fichiers (justificatifs, tickets) vont dans des **buckets Supabase privés** avec URLs signées de courte durée ; les images sont **compressées côté client avant upload**. | Faible. |
| **H-14** | Le projet est créé dans le sous-répertoire **`lba-control/`** pour ne pas casser l'application FBMS statique existante hébergée à la racine du dépôt. | Faible. |
| **H-15** | La **maturité d'un score** exige à la fois un volume et une durée : « en observation » à partir de 3 opérations **et** 7 jours, « provisoire » à 10 et 21, « confirmé » à 25 et 45. Quarante achats en cinq jours restent « non évalué » — c'est une pointe de campagne, pas un historique. Sous le seuil d'observation, **aucune catégorie n'est prononcée**. | Faible — seuils paramétrables. |
| **H-16** | Une **composante de score sans observation est exclue du calcul**, et le poids des composantes mesurées est renormalisé à 100. La noter zéro punirait le pisteur pour une chose qui n'a pas eu lieu. Les exclusions et le poids redistribué sont affichés. | Moyen si refusé — sinon les nouveaux pisteurs sont structurellement pénalisés. |
| **H-17** | Les **pertes valorisées du TCB** ne couvrent au MVP que l'**écart physique des transferts réceptionnés**, valorisé au prix historisé du transfert (arbitrage D2). Les pertes de sacherie et de stock hors transfert ne sont pas encore valorisées. | Moyen — sous-estimation du TCB si les pertes hors transport sont significatives. |
| **H-18** | Le **cycle d'abonnement est calculé deux fois** — dans `src/domain/subscription.ts` et dans `app.subscription_phase` — et les deux implémentations sont **vérifiées l'une contre l'autre** par les tests de base. Un serveur et une interface en désaccord sur le jour du blocage produiraient une réclamation client impossible à trancher. | Moyen si la double implémentation dérive ; le test croisé est la protection. |
| **H-19** | **L'export reste ouvert en lecture seule ET après blocage**, et la déclaration de paiement aussi. Retenir les données d'un client en retard serait une prise d'otage ; sans déclaration possible, un client bloqué ne pourrait jamais se débloquer. | Faible — choix commercial explicite. |
| **H-20** | Un **indicateur de tableau de bord sans source vaut `null`**, jamais 0. Seuls les compteurs d'événements (retards, incidents, alertes) valent légitimement zéro : « aucun incident » est une information, « 0 FCFA achetés » sur un périmètre vide n'en est pas une. | Faible. |
| **H-21** | Le **solde de sacs n'est jamais saisi** : `bag_stocks` est un cache tenu par trigger, reconstructible par `app.rebuild_bag_stocks`. La source de vérité reste `bag_movements`. Un solde corrigeable à la main est un solde auquel on ne peut pas se fier. | Faible. |
| **H-22** | Les **sacs appartiennent à une société**. Les déplacer d'un tiers vers un autre est un transfert de valeur : approbation nominative, motif écrit et entrée `partner_change` au journal. La réaffectation s'écrit en **deux mouvements** (une sortie, une entrée), `partner_company_id` étant une colonne unique. | Moyen si contesté — c'est une question commerciale, pas technique. |
| **H-23** | Le **type d'un fichier est établi par sa signature binaire**, jamais par son extension ni par le type annoncé par le navigateur : les deux viennent du client. Les limites de taille diffèrent selon l'usage — 8 Mo au bureau, 4 Mo pour une preuve envoyée du terrain, parce que le pisteur paie son forfait. | Faible. |
| **H-24** | Le seuil `expense_categories.requires_receipt_above` s'applique **à la validation, pas à la saisie**. Un pisteur doit pouvoir enregistrer une dépense réelle depuis le terrain ; la pièce est jointe au bureau. | Faible. |

---

### Correction apportée en phase 8 à une affirmation de la phase 7

La migration `1900` et `SECURITY_MODEL.md` affirmaient que des **privilèges par défaut** suffiraient à
maintenir fermée la surface d'exécution des fonctions. C'était **inexact** :
`ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC` n'annule que ce qu'un `GRANT` par défaut
avait ajouté et laisse intact le droit intégré de PostgreSQL, qui accorde `EXECUTE` à `PUBLIC` sur
toute fonction créée.

L'audit du catalogue l'a démontré dès l'apparition de seize nouvelles fonctions en phase 8. La
révocation explicite vit désormais dans la migration `2400`, qui **doit rester la dernière**, et les
deux documents ont été rectifiés. C'est l'exemple le plus net, dans ce projet, de l'utilité d'un audit
qui affirme des invariants plutôt que de vérifier une liste : la régression était invisible à la
lecture du code.

---

## 3. Exigences conservées mais volontairement différées (aucune supprimée)

| Exigence | Source | Traitement |
| --- | --- | --- |
| Intégration paiement par API + webhook signé | CMD §20, CDC §20.5 | **Architecture préparée** (table `subscription_events`, clé d'idempotence, endpoint réservé) mais **non implémentée avant la fin du MVP**, comme explicitement demandé. |
| Portail externe société partenaire | CDC §5, DCP §11 (P2) | Rôle + politiques RLS écrits et testés ; accès désactivé par drapeau. |
| Notifications WhatsApp / SMS | CDC §19, DCP §11 (P2) | Table `notifications` avec `channel` ; seuls `in_app` et `email` actifs. |
| MFA administrateurs | CMD §23 | « Préparé » comme demandé : champ `mfa_enrolled_at`, politique d'exigence par rôle, activation Supabase Auth documentée, non forcé au MVP. |
| Domaines personnalisés | CDC §20.2 | Hors MVP, `tenants.custom_domain` présent et inutilisé. |
| Comptabilité générale, transformation industrielle, IA prédictive, optimisation de tournées | CDC §3.2 | Hors périmètre déclaré. |

---

## 4. Décisions métier restant ouvertes

Reprises de CDC §27 et DCP §15, avec la position implémentée par défaut. Ces valeurs sont **paramétrables** :
aucune ne fige le produit.

| ID | Question | Défaut implémenté | Phase où l'arbitrage devient bloquant |
| --- | --- | --- | --- |
| ~~D1~~ | Quel événement couvre une avance ? | **Tranchée en phase 4** : `reception_accepted`, branché sur `app.cover_advances_from_reception` | ✅ Phase 4 |
| ~~D2~~ | Quel prix valorise couverture et écarts ? | **Tranchée en phase 5** : prix net reconnu, lu dans `transfers.applied_price_value` (prix historisé du transfert) | ✅ Phase 5 |
| D3 | Tolérances par société ? | Cascade contrat → société → tenant, défaut 0,5 % | Phase 4 |
| D4 | FIFO ou allocation manuelle ? | FIFO + correction validée et auditée | Phase 3 |
| ~~D5~~ | Quelles dépenses au TCB, quelles clés indirectes ? | **Tranchée en phase 5** : les 23 catégories, statuts `validee`/`payee`/`partiellement_payee` retenus, `achat_produit` écartée, six clés dont `manuel` non calculable | ✅ Phase 5 |
| ~~D6~~ | Coûts contrôlables par le pisteur ? | **Tranchée en phase 5** : porté par `expense_categories.is_controllable_by_agent` — commission, collecte, chargement, carburant, sacherie, communication. Seuls ces coûts entrent dans la composante « maîtrise du TCB » | ✅ Phase 5 |
| D7 | Seuil de blocage d'une nouvelle avance ? | Exposition > plafond **ou** reliquat non couvert > 7 j | Phase 3 |
| D8 | Données visibles par une société partenaire ? | Aucune (portail désactivé) | Post-MVP |
| D9 | Achats propres du LBA sans financement société ? | Autorisés via `is_own_account` | Phase 3 |
| ~~D10~~ | Procédure de clôture et de réouverture de campagne ? | **Tranchée en phase 6** : clôture bloquante, obstacles énumérés (incidents, avances non couvertes, transferts en cours, dépenses non statuées), forçage possible avec motif de 20 caractères et obstacles inscrits à l'audit ; réouverture réservée au propriétaire, motivée | ✅ Phase 6 |
| ~~D11~~ | Durée de grâce : 3, 5 ou 7 jours ? | **Tranchée en phase 6** : 5 jours par défaut, paramétrable par abonnement (`grace_days`). Accès complet pendant la grâce, lecture seule ensuite, blocage à J+31 | ✅ Phase 6 |
| ~~D12~~ | Durée de conservation avant archivage ? | **Tranchée en phase 6** : 90 jours, et `app.archival_candidates` **décrit** sans supprimer. Le produit n'a aucun chemin de suppression automatique — une purge programmée qui se déclenche pendant un contentieux détruit la preuve dont on a besoin | ✅ Phase 6 |

---

## 5. Points de vigilance technique relevés dans la commande

| Point | Lecture retenue |
| --- | --- |
| CMD §3 : « Crée des politiques RLS pour SELECT, INSERT, UPDATE et DELETE » **et** « Aucune suppression physique des transactions métier n'est autorisée depuis l'application » | Les deux sont respectés : une politique `DELETE` **existe sur chaque table**, mais elle est **restrictive (`USING (false)`) sur les tables transactionnelles**. La politique est présente et testée ; elle refuse. L'annulation passe par statut + motif + auteur + audit. |
| CMD §19 : « ne jamais limiter la file d'attente à 300 opérations » | La file IndexedDB est **non bornée** et ne purge **jamais** un enregistrement `pending`. Un test automatisé vérifie le comportement au-delà de 1 000 opérations. |
| CMD §3 : « N'utilise jamais la clé `service_role` dans le navigateur » | Aucune variable `VITE_*` ne contient de secret. Les opérations privilégiées passent par fonctions PostgreSQL `SECURITY DEFINER` à `search_path` verrouillé et par Edge Functions. |
| CMD §2 : « jsPDF ou une bibliothèque équivalente » | `jspdf` + `jspdf-autotable` retenus. |
| CMD §1 : « Ne construis pas toute l'application dans un seul fichier » | Découpage par domaine métier (`src/features/<domaine>`), logique de calcul isolée et testable dans `src/domain/` sans dépendance React ni réseau. |

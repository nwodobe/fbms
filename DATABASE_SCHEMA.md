# LBA Control — Schéma de données

PostgreSQL 16 / Supabase. Source de vérité : `lba-control/supabase/migrations/`.
Ce document explique le **pourquoi** ; les migrations portent le **comment**.

---

## 0. Conventions transversales

| Convention | Règle |
| --- | --- |
| Clés primaires | `uuid` — `gen_random_uuid()` côté serveur, **UUID généré par l'appareil** pour tout ce qui est saisi hors ligne (achats, dépenses terrain, mouvements) |
| Isolation | `tenant_id uuid NOT NULL REFERENCES tenants(id)` sur **toutes** les tables métier |
| Montants | `numeric(18,2)` — jamais de flottant. Devise portée par le tenant (XOF par défaut) |
| Poids | `numeric(14,3)` en kilogrammes |
| Pourcentages | `numeric(9,4)` |
| Horodatage | `timestamptz`, **horloge serveur** (`now()`) pour l'audit et le scoring ; l'horloge de l'appareil est stockée séparément et n'est jamais autoritaire |
| Traçabilité | `created_at`, `created_by`, `updated_at`, `updated_by` sur toute table transactionnelle |
| Annulation | `status = 'annule'` + `cancelled_at` + `cancelled_by` + `cancellation_reason`. **Aucune suppression physique** |
| Index | Tout index composite commence par `tenant_id` |
| Schémas | `public` (métier), `app` (fonctions internes), `platform` (hors tenant) |

---

## 1. Plateforme (hors tenant)

| Table | Contenu | Notes |
| --- | --- | --- |
| `platform_admins` | Super-administrateurs | `user_id` unique. Aucun `tenant_id`. |
| `subscription_plans` | Plans commerciaux | Prix, périodicité, limites (`max_users`, `max_field_agents`, `max_partner_companies`, `storage_mb`, modules). Semés : *Standard* 50 000 FCFA/mois + installation 300 000 FCFA. |
| `platform_support_sessions` | **Mode d'assistance audité** | `tenant_id`, `granted_by`, `reason` (obligatoire), `expires_at`, `revoked_at`. Sans session active, un super-admin ne lit **aucune** donnée métier (CMD §4). |

---

## 2. Tenant, identité, marque

### `tenants`
`slug` (unique, sert à la résolution d'URL), `commercial_name`, `legal_name`, `status`
(`active | suspended | archived`), `currency` (XOF), `language` (fr), `timezone`, `custom_domain` (réservé).

### `tenant_branding`
Un enregistrement par tenant : `logo_path`, `logo_mobile_path`, `login_image_path`, `primary_color`,
`secondary_color`, `slogan`, `phone`, `email`, `address`, `tax_id`, `document_footer`.

> **Contrainte de lisibilité** : les couleurs sont validées en hexadécimal (`CHECK`) et le contraste WCAG AA
> est vérifié côté serveur avant enregistrement. Deux couleurs, des emplacements fixes — pas de refonte
> graphique libre (CMD §5, CDC §20.1).

### `tenant_settings`
Paramètres opérationnels par tenant, tous **surchargables au niveau contrat ou société** :
tolérance d'écart par défaut, seuils d'alerte, jours de grâce d'abonnement, délai de justification d'avance,
clé de répartition indirecte par défaut, base de couverture par défaut.

### `users`
`id` = `auth.users.id`. `tenant_id` **nullable** (les super-admins n'appartiennent à aucun tenant).
`role user_role NOT NULL`, `full_name`, `phone`, `email`, `status` (`active | suspended | closed`),
`mfa_enrolled_at`, `last_login_at`, `failed_login_count`, `locked_until`.

`user_role` — **10 valeurs**, union des trois documents (voir `DECISIONS_ET_HYPOTHESES.md` INC-02) :
`super_admin`, `proprietaire`, `gestionnaire`, `comptable`, `responsable_terrain`, `pisteur`, `auditeur`,
`magasinier`¹, `logistique`¹, `partenaire_externe`¹ — ¹ définis et protégés par RLS, non attribuables au MVP.

### `user_devices`
`device_id` (généré et persisté par l'appareil), `label`, `last_seen_at`, `revoked_at`.
Un appareil révoqué ne peut plus synchroniser.

---

## 3. Journal d'audit

### `audit_log`
`tenant_id` (nullable pour les actions plateforme), `user_id`, `device_id`, `action` (`login`, `create`,
`update`, `cancel`, `validate`, `partner_change`, `weight_change`, `price_change`, `amount_change`,
`status_change`, `payment_confirm`, `suspend`, `reactivate`, `sensitive_export`), `table_name`, `record_id`,
`old_value jsonb`, `new_value jsonb`, `occurred_at` (**horloge serveur**), `ip_address inet`, `justification`.

> Alimenté **exclusivement par triggers**. Aucune politique `UPDATE` ni `DELETE` n'est accordée à qui que ce
> soit — le journal est en écriture seule par la base et en lecture seule pour les humains (CMD §22).
> Les changements de poids, de prix, de montant et de société déclenchent une entrée dédiée.

---

## 4. Sociétés partenaires, campagnes, contrats, prix

| Table | Points clés |
| --- | --- |
| `partner_companies` | `code` unique par tenant, contacts, `status`, tolérances par défaut. La désactivation n'efface rien (DMQ E03). |
| `campaigns` | `code`, période, `status` (`ouverte | cloturee | reouverte`). La clôture exige soldes, stock, sacs, litiges et financements traités (RG-13). |
| `products` | RCN au MVP, modèle générique. |
| `sites` | `type` : `warehouse | buying_point | partner_site`. Code unique par tenant. |
| `zones`, `localities` | Découpage géographique des pisteurs. |
| `suppliers` | Producteurs / fournisseurs, avec détection de doublons. |
| `transporters`, `vehicles` | `known_tare_kg` sert à détecter une tare anormale. |
| `weighbridges` | `calibration_status`, `calibrated_at` — permet d'analyser les biais par pont. |

### `contracts`
`partner_company_id`, `campaign_id`, `product_id`, `target_volume_kg`, `start_date`, `end_date`,
`delivery_site_id`, `kor_min`, `humidity_max`, `impurities_max`, `weight_tolerance_pct`,
`acceptance_tolerance_pct`, `payment_terms`, `lba_commission`, `status`,
**`coverage_basis`** (`purchase_validated | reception_accepted | payment_received`, défaut
`reception_accepted` — arbitrage D1) et **`valuation_price_basis`** (défaut `net_recognized` — arbitrage D2).

> Après activation, les conditions d'un contrat sont **immuables** : toute évolution crée une version.

### `negotiated_prices`
`contract_id`, `price`, `valid_from`, `valid_to`, `price_type` (`negocie | plafond_achat | producteur |
net_reconnu | valorisation_ecart`), `quality_conditions jsonb`, `created_by`, `proof_path`, `version`,
`superseded_by`.

> **Un prix n'est jamais écrasé** (CMD §6, RÈGLE PRIX du CDC §7.2). Toute révision insère une nouvelle
> version. Une contrainte `EXCLUDE` empêche deux prix actifs du même type de se chevaucher sur une même
> période pour un même contrat. Un prix expiré reste lié aux opérations passées (DMQ E04).
>
> **Instantané de prix** : `purchases` et `transfers` copient le prix applicable à la date de l'opération
> (`applied_price_id` + `applied_price_value`). Une révision ultérieure ne modifie donc jamais rétroactivement
> une opération déjà enregistrée.

---

## 5. Financements et avances

### `fundings`
`partner_company_id`, `contract_id`, `campaign_id`, `amount`, `received_at`, `reference`, `payment_method`,
`reference_price`, `coverage_deadline`, `proof_path`, `status`.

```sql
theoretical_volume_kg GENERATED ALWAYS AS (
  CASE WHEN reference_price > 0 THEN amount / reference_price END
) STORED
```

> Le volume théorique est **indicatif** et ne remplace jamais le volume réellement accepté (CMD §7).
> Un financement OLAM ne peut pas être couvert par une livraison DORADO : la société portée par l'avance,
> l'achat et le transfert doit correspondre à celle du financement — vérifié par contrainte et par test.

### `field_agents` (pisteurs)
`code`, `user_id` (nullable), `full_name`, `phone`, `id_document`, `zone_id`, `mobile_money_account`,
`ceiling_amount`, `activation_date`, `status` (`actif | suspendu | cloture`), `supervisor_id`,
`commission_mode` (`par_kg | pourcentage | forfait | aucune`), `commission_value`.
Tables liées : `field_agent_localities`, `field_agent_partners` (sociétés autorisées + plafond par société).

### `advances`
`field_agent_id`, `partner_company_id` (**société d'origine des fonds**), `funding_id`, `contract_id`,
`campaign_id`, `amount`, `issued_at`, `payment_method`, `reference`, `zone_id`, `volume_target_kg`,
`max_purchase_price`, `justification_deadline`, `proof_path`,
`status` (`brouillon | soumis | approuve | decaisse | partiellement_couvert | cloture | annule`),
`requires_override`, `override_reason`, `override_approved_by`.

> Contrôles avant décaissement : plafond du pisteur, plafond par société, avances anciennes non couvertes,
> alertes affichées. Un dépassement exige une **dérogation explicite et tracée** — jamais un blocage
> automatique définitif (H-11).
> **Une avance n'est pas une dépense** : elle n'apparaît dans aucune table `expenses` et n'entre jamais dans
> le TCB (RG-05).

### `advance_allocations` — couverture FIFO
`advance_id`, `source_type` (`reception | repayment | authorized_expense | manual_adjustment`), `source_id`,
`amount`, `allocated_at`, `is_manual`, `approved_by`, `reason`.

> FIFO par défaut : les premières livraisons couvrent les premières avances. Une livraison peut couvrir
> plusieurs avances et une avance être couverte par plusieurs livraisons. La correction manuelle est possible
> **uniquement** avec approbation et audit (CMD §10, arbitrage D4). L'**âge du reliquat FIFO** conserve la
> date de l'avance d'origine — pas la date de la dernière remise (DMQ §8).

### `advance_repayments`
Remboursements en numéraire, distincts des couvertures matière.

---

## 6. Achats terrain

### `purchases`
Identifiant **généré par l'appareil** (`id uuid PRIMARY KEY`, fourni par le client) — c'est la clé de
l'idempotence de synchronisation.

Colonnes : `field_agent_id`, `partner_company_id` (nullable ssi `is_own_account`), `campaign_id`,
`contract_id`, `funding_id`, `advance_id`, `supplier_id`, `locality_id`, `gps_lat`, `gps_lng`,
`purchased_at` (réel), `gross_weight_kg`, `tare_kg`, `net_weight_kg`, `price_per_kg`, `amount`, `bag_count`,
`kor`, `humidity`, `impurities`, `payment_method`, `payment_reference`, `proof_path`, `status`,
`applied_price_id`, `applied_price_value`, `price_override_reason`,
puis le bloc hors ligne : `sync_status` (`pending | syncing | synced | failed`), `device_id`,
`created_at_device`, `created_at_server`, `sync_attempts`, `last_sync_error`, `last_sync_attempt_at`,
`local_version`.

```sql
CHECK (partner_company_id IS NOT NULL OR is_own_account)   -- arbitrage D9
CHECK (net_weight_kg > 0 AND price_per_kg > 0)
CHECK (amount = round(net_weight_kg * price_per_kg, 2))    -- tolérance d'arrondi gérée en amont
```

### `purchase_duplicate_flags`
Doublons **probables**, jamais bloquants automatiquement : signature calculée sur
`field_agent + supplier + date + poids + montant + localité + référence de paiement`.
La géolocalisation **n'est pas une preuve unique** (CMD §11) : elle pondère le score de similarité sans
jamais le déterminer seule.

---

## 7. Stock, lots et sacherie

### `stock_lots`
`code`, `campaign_id`, `partner_company_id`, `contract_id`, `field_agent_id`, `product_id`, `site_id`,
`holder_type` (`field_agent | warehouse | in_transit | partner_site`), `holder_id`,
`quantity_kg`, `bag_count`, `kor`, `humidity`,
`status` **— exactement les 9 valeurs imposées** : `disponible | reserve | charge | en_transit | receptionne |
rejete | bloque | en_litige | cloture`.

> « Chez pisteur » et « en magasin » sont exprimés par `holder_type`, pas par `status` (voir INC-04).
> `CHECK (quantity_kg >= 0)` — **stock négatif interdit**, sauf exception journalisée explicitement.

### `stock_movements`
Grand livre matière : `type` (`entree | sortie | transfert | perte | correction | reaffectation`),
`quantity_kg`, référence d'origine. Toute variation de `stock_lots.quantity_kg` a un mouvement correspondant.

### `stock_reservations`
`lot_id`, `delivery_plan_id`, `quantity_kg`, `status` (`active | liberee | consommee`).

> **Double réservation impossible** : un index unique partiel et une fonction transactionnelle
> `app.reserve_stock()` garantissent que la somme des réservations actives d'un lot ne dépasse jamais sa
> quantité. Une quantité réservée pour OLAM n'est plus promise à DORADO (RG-06, CA-04).

### `stock_reassignments`
`from_partner_company_id`, `to_partner_company_id`, `quantity_kg`, `reason` (obligatoire), `approved_by`,
`proof_path`. Workflow d'approbation obligatoire + audit (RG-09, CA-11).

### `bag_stocks` / `bag_movements`
Solde de sacs par détenteur × société, et mouvements
(`reception_societe | dotation_pisteur | utilisation_achat | retour_vide | retour_plein | perte |
reaffectation`).

---

## 8. Planning et transferts

### `delivery_plans`
`partner_company_id`, `contract_id`, `planned_date`, `planned_volume_kg`, `origin_site_id`,
`destination_site_id`, `field_agent_id`, `vehicle_id`, `transporter_id`, `priority`,
`status` : `brouillon | planifie | confirme | en_preparation | chargement | en_transit | arrive | decharge |
receptionne | cloture | reporte | annule` (12 valeurs, CMD §13).

Contrôles avant confirmation : stock disponible, absence de double réservation, capacité du camion,
disponibilité du site de réception, documents obligatoires.

### `transfers` — **les quatre poids**

*Chargement* : `transfer_number` (unique par tenant), `partner_company_id`, `contract_id`,
`delivery_plan_id`, `origin_site_id`, `dispatched_at`, `transporter_id`, `driver_name`, `tractor_plate`,
`trailer_plate`, `gross_weight_kg`, `tare_kg`, **`net_loaded_kg`**, `bag_count_loaded`, `kor_departure`,
`humidity_departure`, `weighbridge_id`, `weighing_ticket_path`, `weight_source`
(`verified | estimated_bags | declared`), `loading_responsible`.

*Réception* : `arrived_at`, `unloaded_at`, `destination_site_id`, `gross_weight_reception_kg`,
`tare_reception_kg`, **`net_unloaded_kg`**, **`accepted_kg`**, **`paid_kg`**, `bag_count_received`,
`bag_count_damaged`, `kor_reception`, `humidity_reception`, `rejected_kg`, `rejection_reason`,
`reception_ticket_path`, `receiver_name`.

**Écarts — colonnes générées** (résolution de INC-01, aucune formule des deux sources n'est perdue) :

```sql
ecart_physique_kg          = net_loaded_kg   - net_unloaded_kg
ecart_physique_pct         = ecart_physique_kg / net_loaded_kg * 100
ecart_acceptation_kg       = net_unloaded_kg - accepted_kg          -- CMD §14
ecart_paiement_kg          = accepted_kg     - paid_kg              -- CMD §14
ecart_total_acceptation_kg = net_loaded_kg   - accepted_kg          -- CDC §12.3
ecart_financier_total_kg   = net_loaded_kg   - paid_kg              -- CDC §12.3
tare_variation_kg          = tare_reception_kg - tare_kg
```

> Les quatre poids sont **quatre colonnes distinctes et non écrasables**. Aucun champ générique « poids
> livré » n'existe dans le schéma (RG-08, CA-05).
> Si `ecart_physique_pct` dépasse la tolérance (contrat → société → tenant), un **incident est créé** et la
> clôture du transfert est **bloquée** tant qu'aucune décision n'est prise. La responsabilité n'est **jamais**
> imputée automatiquement au pisteur (CMD §14, DMQ E14).

### `transfer_lots`
Rattachement transfert ↔ lots avec quantité, pour tracer quelle matière est partie.

---

## 9. Incidents

### `incidents`
`type` : `ecart_poids | tare_anormale | rejet_qualite | perte_sacs | livraison_retard | depense_contestee |
paiement_incomplet | modification_suspecte | melange_financement | stock_introuvable` (10 valeurs, CMD §15).
`severity`, `related_table` + `related_id`, `suspected_responsible_type/id`, `description`, `exposed_amount`,
`status` (`ouvert | en_enquete | decide | cloture | reouvert`), `investigation_notes`, `decision`,
`decision_cause` (`naturelle | technique | qualite | erreur | responsabilite_confirmee | inexpliquee`),
`validated_by`, dates. Table liée : `incident_evidences`.

---

## 10. Dépenses, allocations et TCB

### `expense_categories`
Les **23 catégories imposées** (CMD §16), rattachées aux 9 familles du CDC §13.1, avec `is_direct`,
`requires_receipt_above`, `cap_amount`, `is_system_reserved`, `is_controllable_by_agent`.

> `achat_produit` et `commission_pisteur` (générée) sont **réservées au système** : elles existent au
> référentiel mais sont refusées en saisie manuelle, pour éliminer le double comptage (INC-05).

### `expenses`
`partner_company_id`, `campaign_id`, `contract_id`, `field_agent_id`, `stock_lot_id`, `transfer_id`,
`category_id`, `expense_date`, `amount`, `beneficiary`, `payment_method`, `reference`, `proof_path`,
`nature` (`direct | indirect`), `allocation_key`, `status` (`brouillon | soumise | validee | rejetee | payee |
partiellement_payee | annulee`), plus le bloc hors ligne (identique à `purchases`).

> Une dépense **rejetée ou annulée n'entre jamais dans le TCB**. Une dépense **validée mais non payée y
> entre** (critère de recette DCP §12).
> Détection de doublons sur `montant + date + bénéficiaire + référence + camion + justificatif`.

### `expense_allocations`
`expense_id`, cible (`partner | campaign | contract | field_agent | lot | transfer`), `allocation_key`
(`poids_accepte | valeur_achat | nb_livraisons | nb_sacs | jours_stockage | manuel`), `base_value`,
`share_ratio`, `allocated_amount`. **Chaque clé et chaque résultat sont historisés** (RG-10).

### `tcb_snapshots` / `tcb_snapshot_components`
TCB figé et **explicable** : périmètre, `computed_at`, `rule_version`, poids de référence,
`purchase_value`, `direct_expenses`, `indirect_allocated`, `valued_losses`, `tcb_total`,
`tcb_per_accepted_kg`, `net_sale_price`, `margin_total`, `margin_per_kg`,
`margin_reconciliation_gap` (INC-06), plus les entrées sources (`inputs jsonb`).

```
TCB_total            = valeur_achat + dépenses_validées + pertes_valorisées + charges_indirectes_imputées
TCB_par_kg_accepte   = TCB_total / poids_total_accepte      -- NULL si poids accepté = 0 (H-04)
prix_vente_net       = prix_négocié + primes − pénalités − retenues
marge_totale         = chiffre_affaires_net − TCB_total
marge_par_kg         = prix_vente_net − TCB_par_kg_accepte
```

**Ce qui entre, ce qui n'entre pas** (implémenté par `app.compute_tcb`, migration `1700`) :

| Source | Traitement |
| --- | --- |
| `purchases` en statut `valide` ou `paye` | Entre comme `purchase_value` |
| Dépense `validee`, `payee` ou `partiellement_payee`, nature `direct` | Entre pour son **montant engagé**, pas pour la part décaissée |
| Dépense de catégorie `achat_produit` | **Écartée** — la valeur d'achat vient des achats (INC-05) |
| Dépense `indirect` | Écartée en montant total ; n'entre que par `expense_allocations` |
| Dépense `brouillon`, `soumise`, `rejetee`, `annulee` | N'entre pas |
| **Avance décaissée** | **N'entre jamais** — une remise de fonds n'est pas un coût (RG-21) |
| Écart physique d'un transfert réceptionné | Valorisé au prix historisé du transfert (H-17) |

`app.allocate_indirect_expense` **refuse** de répartir quand la clé vaut zéro sur le périmètre :
imputer des quotes-parts nulles ferait disparaître la charge du TCB sans trace. Le reliquat d'arrondi
va à la plus grosse part, de sorte que la somme des quotes-parts rende exactement le montant réparti.

---

## 11. Scoring des pisteurs

### `agent_scores`
`field_agent_id`, `computed_at`, `period_start/end`, `category`
(`excellent | fiable | sous_surveillance | risque | critique | non_evalue`),
`maturity` (`non_evalue | en_observation | provisoire | confirme`), `rule_version`.

**Trois scores coexistent et restent distinguables** (colonne `event_adjusted_score` ajoutée en
phase 5 par la migration `1700`) :

| Colonne | Contenu |
| --- | --- |
| `raw_score` | Moyenne pondérée des composantes mesurées, sans aucune correction |
| `event_adjusted_score` | Après neutralisation des seules observations couvertes par un **événement externe validé** |
| `adjusted_score` | Score **affiché** : ajusté aux événements puis aux ajustements humains motivés, borné à [0, 100] |

Les confondre effacerait qui a corrigé quoi. `recommended_ceiling` est une **recommandation** :
aucune fonction n'écrit jamais dans `field_agents.ceiling_amount` (vérifié par test).

**Une composante sans observation n'est pas écrite** — elle n'est donc pas notée zéro. Les poids des
composantes présentes sont renormalisés à 100 (H-16).

### `agent_score_components`
Une ligne par composante, avec son **poids**, sa **valeur**, les **données sources** (`jsonb`) et les
**événements exclus**. Somme des poids = 100 :

| Composante | Poids |
| --- | --- |
| Couverture des avances | 20 |
| Respect des délais | 15 |
| Écarts de poids | 15 |
| Respect du prix d'achat | 10 |
| Qualité | 10 |
| Justificatifs et fiabilité des données | 10 |
| Gestion des sacs | 5 |
| Régularité | 5 |
| Maîtrise des dépenses / TCB contrôlable | 10 |

### `agent_score_adjustments` et `external_events`
Ajustements humains (auteur, motif, date) et événements externes validés (camion indisponible, refus de
réception, panne de pont-bascule, pluie, blocage administratif, retard de financement) qui produisent le
**score ajusté** affiché à côté du score brut.

> Le score est **recalculable depuis les données sources** (RG-12) et **ne déclenche jamais de sanction
> automatique** (CMD §17).

---

## 12. Alertes

`alert_rules` (par tenant : `alert_type`, `threshold jsonb`, `severity`, `is_active`) et `alerts` (instances :
périmètre, message, `status`, `acknowledged_by`, `resolved_at`).

Les **20 types d'alerte** imposés (CMD §18) sont semés comme règles par défaut, tous à seuil configurable.

---

## 13. Synchronisation hors ligne

### `sync_operations`
Journal serveur : `id` (UUID de l'appareil), `tenant_id`, `user_id`, `device_id`, `entity_type`, `entity_id`,
`status` (`pending | syncing | synced | failed`), `attempts`, `last_error`, `last_attempt_at`,
`created_at_device`, `created_at_server`, `local_version`, `payload_hash`.

> Idempotence : `INSERT … ON CONFLICT (id) DO NOTHING`. Un rejeu ne crée jamais de doublon (CA-03).
> Miroir côté client dans IndexedDB (Dexie), **non borné**, sans purge des `pending`.

---

## 14. Abonnements

| Table | Contenu |
| --- | --- |
| `subscriptions` | `tenant_id`, `plan_id`, `status` (**9 valeurs**, voir INC-03), `period_start`, `period_end`, `trial_end`, `grace_days` (défaut 5), `read_only_at`, `blocked_at`, `cancelled_at` |
| `invoices` | `number`, `amount`, `currency`, `issued_at`, `due_date`, `status` (`draft | issued | paid | partially_paid | overdue | cancelled`) |
| `subscription_payments` | `amount`, `method` (`wave | orange_money | bank_transfer`), `reference`, `payer`, `declared_at`, `proof_path`, `status` (`declared | confirmed | rejected | partial`), `confirmed_by`, `confirmed_at`, `verifier_note` |
| `subscription_events` | Historique : rappels J-7 / J-3 / J, changements de statut, suspensions, réactivations, `idempotency_key` **unique** |

Règles appliquées en base :

- Une **déclaration de paiement par le client ne change aucun statut**. Seul un super-administrateur confirme
  (`app.confirm_subscription_payment()`, `SECURITY DEFINER`), ce qui rend une capture d'écran structurellement
  insuffisante (CMD §20, DMQ E18).
- Un **paiement partiel** est conservé comme avoir et ne prolonge pas la période.
- La nouvelle date de fin est calculée **à partir de la date de fin existante** si l'abonnement est encore
  actif — les jours déjà payés ne sont jamais perdus (CDC §20.5).
- `idempotency_key` garantit qu'un même paiement ne prolonge jamais deux fois la période (test d'idempotence
  CDC §23.1).

---

## 15. Fonctions internes (schéma `app`)

| Fonction | Rôle |
| --- | --- |
| `app.current_tenant_id()` | Tenant du JWT — socle de toutes les politiques RLS |
| `app.current_role()` | Rôle applicatif du JWT |
| `app.is_platform_admin()` | Super-administrateur |
| `app.has_support_access(tenant)` | Session d'assistance active, motivée et non expirée |
| `app.tenant_can_write()` | `false` si abonnement en lecture seule, suspendu, expiré ou résilié |
| `app.is_agent_owner(agent_id)` | Le pisteur connecté est-il propriétaire de cette ligne |
| `app.reserve_stock(...)` | Réservation transactionnelle, empêche la double réservation |
| `app.confirm_subscription_payment(...)` | Confirmation manuelle idempotente, réservée au super-admin |
| `app.audit_trigger()` | Trigger générique d'audit avec anciennes/nouvelles valeurs |

Toutes les fonctions `SECURITY DEFINER` fixent `search_path = pg_catalog, app, public` pour éviter tout
détournement par table de même nom.

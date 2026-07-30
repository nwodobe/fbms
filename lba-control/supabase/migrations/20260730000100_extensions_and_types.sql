-- =============================================================================
-- LBA Control · 0100 · Extensions, schémas et types énumérés
-- =============================================================================
-- Toutes les énumérations métier sont définies ici afin qu'une valeur de statut
-- ne puisse jamais être inventée par le client. Les listes reprennent
-- littéralement les valeurs imposées par le cahier des charges ; les écarts
-- éventuels sont documentés dans DECISIONS_ET_HYPOTHESES.md.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create schema if not exists app;

comment on schema app is
  'Fonctions internes de sécurité et de logique serveur. Aucun accès direct des clients.';

-- -----------------------------------------------------------------------------
-- Identité et gouvernance
-- -----------------------------------------------------------------------------

-- 10 rôles : union des trois documents sources (voir INC-02).
-- Les 7 premiers sont actifs au MVP ; les 3 derniers sont définis et protégés
-- par RLS mais non attribuables depuis l'interface.
create type user_role as enum (
  'super_admin',
  'proprietaire',
  'gestionnaire',
  'comptable',
  'responsable_terrain',
  'pisteur',
  'auditeur',
  'magasinier',
  'logistique',
  'partenaire_externe'
);

create type user_status  as enum ('active', 'suspended', 'closed');
create type tenant_status as enum ('active', 'suspended', 'archived');

create type audit_action as enum (
  'login',
  'create',
  'update',
  'cancel',
  'validate',
  'partner_change',
  'weight_change',
  'price_change',
  'amount_change',
  'status_change',
  'payment_confirm',
  'suspend',
  'reactivate',
  'sensitive_export'
);

-- -----------------------------------------------------------------------------
-- Abonnements
-- -----------------------------------------------------------------------------

-- 9 statuts : les 8 imposés + suspended_read_only, sans lequel le cycle
-- « lecture seule à J+5 puis blocage à J+30 » n'est pas représentable (INC-03).
create type subscription_status as enum (
  'trial',
  'pending_payment',
  'active',
  'grace_period',
  'overdue',
  'suspended_read_only',
  'suspended',
  'cancelled',
  'expired'
);

create type invoice_status as enum (
  'draft', 'issued', 'paid', 'partially_paid', 'overdue', 'cancelled'
);

create type payment_method as enum (
  'wave', 'orange_money', 'mtn_money', 'moov_money', 'bank_transfer', 'cash', 'cheque', 'other'
);

create type subscription_payment_status as enum ('declared', 'confirmed', 'rejected', 'partial');

create type subscription_event_type as enum (
  'reminder_j7', 'reminder_j3', 'reminder_j0',
  'status_change', 'payment_declared', 'payment_confirmed', 'payment_rejected',
  'suspended', 'reactivated', 'plan_change', 'renewal'
);

-- -----------------------------------------------------------------------------
-- Référentiel commercial
-- -----------------------------------------------------------------------------

create type campaign_status as enum ('ouverte', 'cloturee', 'reouverte');
create type partner_status  as enum ('active', 'suspended', 'closed');
create type contract_status as enum ('brouillon', 'actif', 'suspendu', 'cloture', 'annule');
create type site_type       as enum ('warehouse', 'buying_point', 'partner_site', 'other');

create type price_type as enum (
  'negocie',            -- base commerciale société
  'plafond_achat',      -- discipline terrain
  'producteur',         -- montant payé au vendeur
  'net_reconnu',        -- après primes, pénalités, retenues
  'valorisation_ecart'  -- valeur financière des pertes
);

-- Arbitrage D1 : fait générateur de la couverture d'une avance.
create type coverage_basis as enum ('purchase_validated', 'reception_accepted', 'payment_received');

-- Arbitrage D2 : prix qui valorise la couverture et les écarts.
create type valuation_price_basis as enum ('negocie', 'net_reconnu', 'producteur', 'valorisation_ecart');

create type calibration_status as enum ('valide', 'expire', 'inconnu');

-- -----------------------------------------------------------------------------
-- Finance amont et terrain
-- -----------------------------------------------------------------------------

create type funding_status as enum ('recu', 'affecte', 'engage', 'couvert', 'rembourse', 'cloture', 'annule');

create type agent_status    as enum ('actif', 'suspendu', 'cloture');
create type commission_mode as enum ('par_kg', 'pourcentage', 'forfait', 'aucune');

create type advance_status as enum (
  'brouillon', 'soumis', 'approuve', 'decaisse', 'partiellement_couvert', 'cloture', 'annule'
);

create type advance_allocation_source as enum (
  'reception', 'repayment', 'authorized_expense', 'manual_adjustment'
);

create type purchase_status as enum ('brouillon', 'valide', 'paye', 'annule');

-- État de synchronisation d'une écriture créée hors ligne.
create type sync_status as enum ('pending', 'syncing', 'synced', 'failed');

-- -----------------------------------------------------------------------------
-- Matière
-- -----------------------------------------------------------------------------

-- Exactement les 9 valeurs imposées. La localisation (« chez pisteur »,
-- « en magasin ») est portée par holder_type, pas par le statut (INC-04).
create type stock_status as enum (
  'disponible', 'reserve', 'charge', 'en_transit', 'receptionne',
  'rejete', 'bloque', 'en_litige', 'cloture'
);

create type holder_type as enum ('field_agent', 'warehouse', 'in_transit', 'partner_site');

create type stock_movement_type as enum (
  'entree', 'sortie', 'transfert', 'perte', 'correction', 'reaffectation', 'inventaire'
);

create type reservation_status as enum ('active', 'liberee', 'consommee', 'annulee');

create type bag_movement_type as enum (
  'reception_societe', 'dotation_pisteur', 'utilisation_achat',
  'retour_vide', 'retour_plein', 'perte', 'reaffectation'
);

-- -----------------------------------------------------------------------------
-- Logistique
-- -----------------------------------------------------------------------------

create type delivery_plan_status as enum (
  'brouillon', 'planifie', 'confirme', 'en_preparation', 'chargement',
  'en_transit', 'arrive', 'decharge', 'receptionne', 'cloture', 'reporte', 'annule'
);

create type transfer_status as enum (
  'brouillon', 'chargement', 'charge', 'en_transit', 'arrive',
  'decharge', 'receptionne', 'cloture', 'annule'
);

-- Distingue un poids certifié d'une estimation : sans cela, tout écart devient
-- inattribuable (CDC §12.4).
create type weight_source as enum ('verified', 'estimated_bags', 'declared');

create type priority_level as enum ('basse', 'normale', 'haute', 'critique');

-- -----------------------------------------------------------------------------
-- Incidents
-- -----------------------------------------------------------------------------

create type incident_type as enum (
  'ecart_poids', 'tare_anormale', 'rejet_qualite', 'perte_sacs', 'livraison_retard',
  'depense_contestee', 'paiement_incomplet', 'modification_suspecte',
  'melange_financement', 'stock_introuvable'
);

create type incident_severity as enum ('faible', 'moderee', 'grave', 'critique');
create type incident_status   as enum ('ouvert', 'en_enquete', 'decide', 'cloture', 'reouvert');

create type incident_cause as enum (
  'naturelle', 'technique', 'qualite', 'erreur', 'responsabilite_confirmee', 'inexpliquee'
);

-- -----------------------------------------------------------------------------
-- Coûts
-- -----------------------------------------------------------------------------

create type expense_status as enum (
  'brouillon', 'soumise', 'validee', 'rejetee', 'payee', 'partiellement_payee', 'annulee'
);

create type expense_nature as enum ('direct', 'indirect');

create type allocation_key as enum (
  'poids_accepte', 'valeur_achat', 'nb_livraisons', 'nb_sacs', 'jours_stockage', 'manuel'
);

create type allocation_target as enum ('partner', 'campaign', 'contract', 'field_agent', 'lot', 'transfer');

-- -----------------------------------------------------------------------------
-- Scoring
-- -----------------------------------------------------------------------------

create type score_category as enum (
  'excellent', 'fiable', 'sous_surveillance', 'risque', 'critique', 'non_evalue'
);

-- Un nouveau pisteur ne doit jamais être noté comme un pisteur établi.
create type score_maturity as enum ('non_evalue', 'en_observation', 'provisoire', 'confirme');

create type score_component_code as enum (
  'couverture_avances',      -- 20
  'respect_delais',          -- 15
  'ecarts_poids',            -- 15
  'respect_prix',            -- 10
  'qualite',                 -- 10
  'fiabilite_justificatifs', -- 10
  'gestion_sacs',            --  5
  'regularite',              --  5
  'maitrise_tcb'             -- 10
);

-- -----------------------------------------------------------------------------
-- Alertes · les 20 types imposés (CMD §18), tous à seuil configurable
-- -----------------------------------------------------------------------------

create type alert_type as enum (
  'financement_proche_echeance',
  'avance_sans_achat',
  'avance_non_couverte',
  'argent_chez_pisteur_trop_longtemps',
  'aucune_livraison_depuis_x_jours',
  'livraison_prevue_48h',
  'livraison_prevue_demain',
  'livraison_en_retard',
  'stock_insuffisant',
  'double_reservation',
  'camion_sans_document',
  'transfert_transit_trop_long',
  'reception_non_renseignee',
  'ecart_superieur_tolerance',
  'tare_anormale',
  'depense_sans_justificatif',
  'depense_doublon_probable',
  'tcb_superieur_prix_net',
  'marge_inferieure_seuil',
  'abonnement_proche_echeance'
);

create type alert_severity as enum ('info', 'surveillance', 'critique', 'blocage');
create type alert_status   as enum ('ouverte', 'acquittee', 'resolue', 'ignoree');

create type notification_channel as enum ('in_app', 'email', 'sms', 'whatsapp');

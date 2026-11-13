# Audit des fonctions SECURITY DEFINER du module Observatoire

Inventaire extrait du staging après migration : 45 fonctions `pheno_*`, dont 36 SECURITY DEFINER ; 20 exécutables par `authenticated` ; **0 exécutable par `anon` ou `PUBLIC`**.

Règles vérifiées pour chaque fonction DEFINER : propriétaire `postgres` ; `search_path` figé (`public, private, pg_temp` ou plus restreint) ; `EXECUTE` révoqué de PUBLIC et anon ; pour celles exposées à `authenticated`, contrôle de l'identité et du droit (profil actif, rôle, affectation à la campagne) en tête de fonction, avant toute écriture. Les tests serveur exercent chaque refus (compte désactivé, RT hors périmètre, campagne close, rôle insuffisant).

| Fonction | Mode | search_path | anon | authenticated | PUBLIC | Contrôle d'identité |
|---|---|---|---|---|---|---|
| `private.pheno_a_affectation(p_campaign uuid, p_cluster text, p_droits text[])` | DEFINER | public, private, pg_temp | non | non | non | oui |
| `private.pheno_arbre_id(p_bloc uuid, p_numero integer)` | INVOKER | public, private, pg_temp | non | non | non | — |
| `private.pheno_campagne_ouverte(p_campaign uuid)` | DEFINER | public, pg_temp | non | non | non | — |
| `private.pheno_classe_de(p_user uuid)` | DEFINER | public, pg_temp | non | non | non | — |
| `private.pheno_cluster_du_panel(p_panel uuid)` | DEFINER | public, pg_temp | non | non | non | — |
| `private.pheno_graine(p_campaign uuid)` | DEFINER | public, pg_temp | non | non | non | — |
| `private.pheno_graine_immuable()` | INVOKER | public, pg_temp | non | non | non | contrôle métier |
| `private.pheno_hex(p text)` | INVOKER | public, pg_temp | non | non | non | — |
| `private.pheno_journal_immuable()` | INVOKER | public, pg_temp | non | non | non | contrôle métier |
| `private.pheno_journaliser(p_cluster text, p_entite text, p_id uuid, p_action text, p_ancienne jsonb, p_nouvelle jsonb, p_motif text)` | DEFINER | public, pg_temp | non | non | non | oui |
| `private.pheno_ma_zone()` | DEFINER | public, pg_temp | non | non | non | oui |
| `private.pheno_mon_cluster()` | DEFINER | public, pg_temp | non | non | non | oui |
| `private.pheno_obs_demande(o jsonb)` | INVOKER | public, pg_temp | non | non | non | — |
| `private.pheno_obs_valeurs(o pheno_observations)` | INVOKER | public, pg_temp | non | non | non | — |
| `private.pheno_peut_collecter(p_cluster text)` | DEFINER | public, private, pg_temp | non | non | non | oui |
| `private.pheno_peut_valider(p_campaign uuid, p_cluster text)` | DEFINER | public, private, pg_temp | non | non | non | oui |
| `private.pheno_peut_verifier(p_campaign uuid, p_cluster text)` | DEFINER | public, private, pg_temp | non | non | non | oui |
| `private.pheno_recalculer_evenements(p_panel uuid)` | DEFINER | public, private, pg_temp | non | non | non | — |
| `private.pheno_tirage(p_graine text, p_n integer, p_k integer)` | INVOKER | public, private, pg_temp | non | non | non | — |
| `private.pheno_tirer_arbres(p_panel uuid)` | DEFINER | public, private, pg_temp | non | non | non | — |
| `private.pheno_uuid_ou_null(p text)` | INVOKER | public, pg_temp | non | non | non | — |
| `private.pheno_visite_coherente()` | INVOKER | public, pg_temp | non | non | non | contrôle métier |
| `private.pheno_visite_controler(p_visite uuid)` | DEFINER | public, private, pg_temp | non | non | non | contrôle métier |
| `private.pheno_visite_enregistrer(p jsonb)` | DEFINER | public, private, pg_temp | non | non | non | oui |
| `private.pheno_visite_pour_decision(p_visite uuid, p_version integer)` | DEFINER | public, private, pg_temp | non | non | non | oui |
| `private.pheno_classe()` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `private.pheno_peut_lire_cluster(p_cluster text)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `private.pheno_peut_lire_panel(p_panel uuid)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `private.pheno_peut_lire_visite(p_visite uuid)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `private.pheno_preuve_autorisee(p_name text, p_mode text)` | DEFINER | public, private, storage, pg_temp | non | OUI | non | oui |
| `public.pheno_affectation_accorder(p jsonb)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_affectation_revoquer(p_id uuid, p_motif text)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_arbre_marquer(p jsonb)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_bloc_inventorier(p jsonb)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_correction_decider(p_correction uuid, p_decision text, p_motif text)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_graine_creer(p_campaign uuid)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_observateurs_du_cluster()` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_panel_definir_probabilites(p_panel uuid, p_pi_village numeric, p_pi_champ numeric, p_motif text)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_panel_installer(p jsonb)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_parcelles_disponibles(p_campaign uuid)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_reserve_activer(p_arbre_remplace uuid, p_motif text)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_sync_batch(p_operations jsonb)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_visite_demander_correction(p_visite uuid, p_motif text, p_version integer)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_visite_valider(p_visite uuid, p_version integer)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |
| `public.pheno_visite_verifier(p_visite uuid, p_version integer)` | DEFINER | public, private, pg_temp | non | OUI | non | oui |

# Audit des sources : Intelligence marché AFLP

Audit du 22/11/2026, lecture seule (Supabase Production : `SELECT` uniquement ; dépôt `nwodobe/fbms`, commit `2e67cd9`).
Dépôt public : aucun nom de personne, identifiant ou coordonnée dans ce fichier.

## 1. Cartographie des données

| Rubrique | Source FBMS ou autre | État réel | Classement |
|---|---|---|---|
| Villages de référence | `villages` (statut « Approuvé BM ») | **60 villages** : Sakassou 10, Botro 9, Brobo 9, N'Djébonoua 10, Béoumi 10, Diabo 12 | EXISTANTE, fiable |
| Registre des producteurs | `producteurs`, `farmer_plots` | 1 629 producteurs, 1 625 parcelles (dont parcelles provisoires non vérifiées terrain) | EXISTANTE, à fiabiliser |
| Production déclarée | `farmer_production_baselines` | 89 fiches, source enrôlement coopératif, niveau `DECLARED`, statut `DRAFT` | EXISTANTE, **déclarative** : jamais un stock |
| Coopératives | `aflp_cooperatives`, `aflp_coop_memberships` | 1 coopérative, 89 adhésions | EXISTANTE |
| Mobilisation, visites producteurs | `farmer_visits`, `mission_villages` | 0 ligne | MANQUANTE |
| Observatoire agronomique | `pheno_*` | 1 champ réel, 0 visite (voir `RAPPORTS_OBSERVATOIRE_AFLP/AUDIT_SOURCES.md`) | EXISTANTE, catégorie A |
| Parcelles et cartographie | `farmer_plot_geometries` | 0 géométrie | MANQUANTE |
| Achats terrain jusqu'au BEV | `field_lots`, `field_shipments` | 0 lot, 0 BEV sur la campagne réelle | EXISTANTE, vide (catégorie C) |
| Sacherie | `ops_bag_requests`, `aflp_bag_envelopes` | 0 | EXISTANTE, vide |
| Incidents | `aflp_incidents` | 1 incident (Sakassou, 15/11/2026) | EXISTANTE |
| Qualité RCN | `rcn_qualites` (0), `wms_quality_snapshots` (2, entrepôt) | Aucune mesure bord champ | MANQUANTE côté FBMS ; l'aval relève de PJS |
| Prix de marché | `rcn_proc_prix_marche` (module procurement-control) | **0 ligne** ; table simple (région, prix, source, validité), sans nature de prix ni fiabilité | EXISTANTE, inadaptée à la veille |
| Prix négociés fournisseurs | `rcn_proc_prix` | 1 proposition 2026 annulée (test) | Hors périmètre (LBA / PJS) |
| Rapports existants | vues `reports_v_*` (entrepôt, camions, qualité) | Orientées entrepôt et aval | Hors périmètre FBMS-terrain |
| Cible programme | `aflp_program_targets` | 3 000 MT rattachés à la campagne SIMULATION | À FIABILISER |
| Comptes utilisateurs | `profils` | BM 1, ABM 1, ZH 3, UH 7, AUH 3, Supervisor 1 ; **aucun compte RT** | Contrainte : les RT collectent sur papier |
| Informations marché des RT | Mécanisme hebdomadaire annoncé (groupe WhatsApp à créer) | Rien de structuré dans FBMS | NOUVELLE à collecter |
| CCAK et réglementation | Sources publiques (AIP, Koaci, APA, Abidjan.net) | 9 entrées au registre ; communiqué original non consulté | NOUVELLE, voir `REGISTRE_VEILLE_CCAK.xlsx` |
| Marché international | Commodity Board, APEDA, African Cashew Alliance | 6 entrées, toutes secondaires | NOUVELLE, statut NON_CONFIRME ou CONTESTE |
| Fonds disponibles et approuvés | Aucune source | | MANQUANTE |
| Données PJS (réception, GRN) | Aucun accès autorisé en lecture configuré | | Non consulté |

## 2. Outils et canaux réellement accessibles

- Supabase FBMS : oui, lecture seule utilisée.
- Outlook professionnel : **aucun connecteur** dans cette session. WhatsApp : **aucun accès**. Les messages des groupes AFLP n'ont pas été lus.
- Google Drive et Gmail : connecteurs présents mais non utilisés (la messagerie professionnelle est Outlook ; aucune autorisation de parcourir des échanges privés).
- Web public : recherche documentaire effectuée le 22/11/2026.

## 3. Constats clés

1. **Aucune donnée de marché structurée n'existe** dans FBMS : le premier rapport est un état initial.
2. Ne pas réutiliser `rcn_proc_prix_marche` tel quel : il ne distingue ni prix demandé / proposé / payé, ni stade, ni fiabilité, ni chaîne de source.
3. Les 89 productions déclarées sont des **déclarations d'enrôlement**, à ne jamais lire comme disponibilité.
4. Les RT n'ont pas de compte FBMS : la collecte doit passer par des fiches papier saisies par le Chef d'Unité ou l'assistant.
5. Les prix 2026 sont bien documentés ; **rien n'est publié pour 2027**.

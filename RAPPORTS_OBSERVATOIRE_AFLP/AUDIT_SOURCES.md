# Audit des sources : Observatoire agronomique AFLP 2027

Audit réalisé le 22/11/2026 vers 16 h 25 (heure d'Abidjan), en **lecture seule** sur Supabase Production
(requêtes `SELECT` uniquement ; tests de droits dans des transactions `read only` annulées) et sur le dépôt `nwodobe/fbms`
(commit `2e67cd9`). Aucune donnée n'a été modifiée. Ce fichier est versionné dans un dépôt **public** : il ne contient
aucun identifiant de campagne, de producteur ou de parcelle, ni aucune coordonnée.

## 1. État réel des données au moment du gel

| Élément | Constat | Commentaire |
|---|---|---|
| Protocole | `AFLP2027-OBS v0.9`, statut `PILOTE` | Un seul protocole |
| Champs (`pheno_panels`) | **2 champs**, tous deux à Diabo, mode `DESIGNATION`, statut `ACTIF` | Voir anomalie A1 : un seul appartient à la campagne réelle |
| Blocs | 8 (4 par champ) | |
| Arbres | 24 : 20 titulaires `ACTIF`, 4 réserves `RESERVE_EN_ATTENTE`, tous codés A001 à A012 | Aucune réserve activée |
| Visites / observations | **0 / 0** | Aucune donnée agronomique |
| Événements de maturité, corrections | 0 / 0 | |
| Journal | 13 entrées (choix des blocs, inventaires, désignations, 1 marquage) | Le 22/11/2026 |
| Achats FBMS (campagne réelle) | 0 lot bord champ, 0 BEV, 0 demande de sacs, 0 enveloppe de sacs | 1 incident AFLP enregistré (Sakassou, 15/11) |
| Cible programme | 3 000 MT, source « Branch Manager » | Rattachée à la campagne **SIMULATION** (anomalie A2) |
| Profils FBMS | Branch Manager 1, Assistant BM 1, Zonal Head 3, Unit Head 7, Assistant UH 3, Supervisor 1 | **Aucun compte RT** : cohérent avec l'absence d'accès RT à l'Observatoire |

Par rapport au contrôle du matin du 22/11 (1 champ, 12 arbres), un second champ a été installé à 16 h 14 UTC.

## 2. Anomalies constatées

**A1. Champ installé dans la campagne de simulation, sur une parcelle déjà suivie.**
Le second champ de Diabo est rattaché à la campagne « Simulation AFLP 2027 » (`campaign_type = SIMULATION`) ; il porte
la même parcelle, le même producteur et le même auteur que le champ réel installé quatre heures plus tôt. Hypothèse la plus
probable : installation de démonstration pour le guide en captures d'écran. Le moteur l'exclut (règle R1) et le signale.
Sans ce filtre, toute vue qui ne filtre pas la campagne compterait 2 champs à Diabo.
**Action requise** : décision du Branch Manager (conserver comme essai, ou retirer : modification de production soumise à autorisation).

**A2. Cible de 3 000 MT rattachée à la campagne de simulation.** La table `aflp_program_targets` ne porte la cible que sur
la campagne SIMULATION. Le rapport la cite comme « cible de travail non rattachée », à confirmer contre le plan approuvé.

## 3. Vues analytiques existantes : ce qui est réutilisé, ce qui est corrigé côté générateur

| Vue | Usage | Limite constatée (lecture du SQL, migration 5) |
|---|---|---|
| `pheno_v_champ_semaine` | Règles reprises : VALIDE + NORMALE, titulaires seulement, PAS_VU hors dénominateur | **Une ligne par visite**, pas par champ : deux visites validées du même champ la même semaine sont comptées deux fois |
| `pheno_v_c_cumulatif` | Règle reprise : un arbre compte une fois par campagne pour C | Même granularité par visite |
| `pheno_v_c_cumulatif_cluster` | Statuts `SUIVI_ARBRES_DESIGNES` / `DESCRIPTIF_SANS_PALIER` repris | `champs_valides = count(*)` de visites : **la couverture peut dépasser 100 %** en cas de visites concurrentes ; le CTE `champs` ne tient pas compte de la date d'installation |
| `pheno_v_qualite` | Comptages par statut repris | Agrège toutes campagnes confondues par `campaign_id` : correct si l'on filtre |
| `pheno_v_supervision` | Lu tel quel (contrôle croisé) | `visites_semaine_manquantes` est calculé sur la semaine **courante** (`now()`), pas sur la semaine du rapport : inutilisable pour un rapport du lundi |
| `pheno_v_anomalies_temporelles` | Liste des visites RETROSPECTIVE / INCOHERENTE | Conforme |

Décision : le générateur lit les **tables** (en lecture seule) et applique lui-même le dédoublonnage par champ et par
semaine, la date d'installation et le filtre de campagne. Les vues ne sont pas modifiées (zone `supabase/**` interdite
aux agents). Une correction SQL est proposée dans `PROPOSITION_INTEGRATION_FBMS.md`, à appliquer seulement sur décision.

## 4. Sécurité et droits (vérifiés, pas seulement lus)

- RLS en lecture sur toutes les tables `pheno_*` via `private.pheno_peut_lire_cluster` : BM et ABM tout, Zonal Head sa zone,
  Unit Head et Assistant UH leur cluster, tout autre rôle rien.
- Test en production (transaction `read only` annulée) : rôle `anon` refusé (`permission denied`) ; utilisateur authentifié
  sans profil : 0 ligne sur `pheno_panels`, `pheno_arbres`, `pheno_v_supervision`, `pheno_v_c_cumulatif_cluster`.
  Le rôle `Supervisor` n'a pas de classe Observatoire : 0 ligne.
- Les vues sont `security_invoker` : la RLS de l'utilisateur s'applique.
- **Conséquence pour l'intégration future** : un Unit Head peut lire les données brutes de son cluster (c'est voulu pour la
  collecte). Un rapport de Direction « confidentiel » ne peut donc pas reposer sur ces seules règles : il faudra une fonction
  serveur dédiée réservée à BM, ABM et Zonal Head (voir proposition d'intégration).
- Le front FBMS indique : « Le RT n'a aucun accès à ce module » (`operations/observatoire.js`). Aucun profil RT n'existe en base.

## 5. Périmètre FBMS / PJS

FBMS couvre le terrain jusqu'au BEV (`field_lots`, `field_shipments`, sacherie `ops_bag_requests`, `aflp_bag_envelopes`).
Aucune donnée PJS (réception, GRN, aval) n'a été consultée : aucun accès autorisé en lecture n'est configuré pour cette mission.
Les fonds disponibles et les prix de marché n'ont **aucune source** dans FBMS : ils sont affichés « NON DISPONIBLE ».

## 6. Code existant

- Module : `operations/observatoire.js`, `shared/observatoire-hors-ligne.js` ; migrations `supabase/2026111*_aflp_observatoire_*` (1 à 7).
- Tests existants : `tests/observatoire/` (serveur, cœur, navigateur, codes de suivi). `generer_rapport.py` y produit un rapport **de tests**, pas un rapport de Direction.
- Aucun générateur de rapport de Direction n'existait : celui-ci est nouveau.

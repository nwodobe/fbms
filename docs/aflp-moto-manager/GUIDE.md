# AFLP Moto Manager — guide d'utilisation, d'installation, d'administration et de sauvegarde

Module de la suite ANAGROCI Operations (FBMS). Pilote 2027 : 4 motos APSONIC AP150-30, clusters Sakassou, Botro, Brobo, N'Djébonoua.

> **État à la livraison :** code sur la branche `feat/aflp-moto-manager`. Les migrations SQL ne sont **pas appliquées** en production. Le module ne fonctionne donc pas encore sur le site publié : voir § 3.

---

## 1. Utilisation

Ouvrir le portail FBMS, carte **AFLP MOTO MANAGER** (`moto/index.html`). Les comptes FBMS existants sont utilisés : aucun nouvel identifiant.

| Rôle FBMS | Classe Moto Manager | Ce que l'écran propose |
|---|---|---|
| Unit Head | Chef d'unité | Sa moto, opérations terrain, ses dotations, formation |
| Zonal Head | Chef de zone | Flotte (portée globale, décision du 17/09/2026), inspections, entretiens, incidents, autorisation de dépense, demandes de correction |
| Assistant Branch Manager | ABM | Inventaire, documents, remises, budgets proposés, dotations, restitutions, remboursements, vérification des justificatifs |
| Branch Manager | BM | Tout, dont préaffectation, autorisation de circulation, transferts, validations sensibles, paramètres |
| Finance, Finance Manager | Finance | Lecture, rapprochement, vérification des justificatifs ; le Finance Manager valide remboursements et corrections |
| General Manager | Direction | Lecture, validation des corrections initiées par le BM |
| Autres rôles | — | Message « accès non prévu » ; le serveur ne leur renvoie aucune donnée |

**Ce que l'écran propose n'est pas ce qui protège.** Chaque action est revérifiée par le serveur (fonctions `moto_*` et RLS).

### 1.1 Parcours de mise en service d'une moto (dans l'ordre)

1. **ABM — Administration → Ajouter une moto.** Marque, modèle, date de réception. Châssis et immatriculation restent **vides** tant que la carte grise et la plaque réelles ne sont pas reçues.
2. **ABM — Passeport → Modifier l'identité** à réception de la carte grise (recopie, avec motif).
3. **ABM — Documents** : carte grise, plaque (photo), assurance (avec date d'expiration), chacun numérisé.
4. **BM — Documents → Vérifier.** La personne qui dépose ne peut pas vérifier. Statut administratif CONFORME seulement si carte grise, plaque et assurance sont conformes, non expirées, et châssis + immatriculation renseignés.
5. **ABM ou Chef de zone — Inspection initiale** : nom du mécanicien et du garage obligatoires. Un point critique en défaut rend la moto INAPTE et l'immobilise. L'avis du mécanicien **n'est pas** un certificat réglementaire.
6. **BM — Préaffecter** au Chef d'unité (son cluster vient de son profil FBMS).
7. **Remise au bureau de Bouaké** : PV signé sur papier → **ABM le numérise** (Documents → PV de remise) → **BM le vérifie**.
8. **ABM — Enregistrer la remise** : PV vérifié, compteur, catégorie de permis, nom du vérificateur RH, équipements obligatoires.
9. **BM — Autoriser la circulation.** Décision distincte, refusée si la même personne a enregistré la remise.

Passage en production du logiciel, remise effective et autorisation de circulation restent trois décisions séparées.

### 1.2 Opérations terrain (Chef d'unité, téléphone)

Contrôle avant départ, relevé kilométrique, achat de carburant (photo du reçu obligatoire, plein complet ou partiel), déclaration d'incident, demande d'entretien, confirmation de réception des dotations.

- **Sans réseau** : la saisie est enregistrée sur le téléphone, statut « En attente », puis envoyée automatiquement au retour du réseau. Elle n'est **jamais** considérée validée avant la réponse du serveur.
- **Immobilisation de sécurité** : accident, incident critique ou point critique en défaut au contrôle → la moto est immobilisée **immédiatement** sur le téléphone (bandeau « Ne pas circuler », contrôle de départ bloqué), même sans réseau.
- Une saisie rejetée affiche le motif (ex. compteur incohérent) ; elle se corrige par une nouvelle saisie ou une demande de correction.
- Se déconnecter avec des saisies en attente déclenche un avertissement.

### 1.3 Dotations carburant

Budget autorisé (BM ; une proposition ABM attend le BM) → remise par l'ABM (espèces ou Mobile Money, référence obligatoire en Mobile Money, frais saisis à part) → **confirmation par l'agent du montant réellement reçu** → achats déclarés → justificatifs vérifiés (ABM ou Finance, jamais le déclarant) → avance à apurer → restitutions → avances personnelles et remboursements (validés par BM ou Finance Manager, paiement exécuté hors logiciel puis déclaré).

Une transaction échouée se déclare « échouée » : elle ne compte jamais comme reçue. Un écart de réception est signalé (« écart ») : seule la part réellement reçue entre dans l'avance à apurer.

### 1.4 Consommation et indicateurs

- **Consommation réelle** : méthode plein à plein uniquement. `L/100 km = 100 × litres achetés après le plein initial et jusqu'au plein final inclus ÷ km entre les deux pleins`. Moins de deux pleins complets → « Non disponible ».
- Référence de planification 3 L/100 km ; seuils 3,6 et 4,2 **provisoires, configurables**. Une alerte déclenche une vérification, jamais une accusation.
- **Coût direct (FCFA/km)** : carburant justifié vérifié + maintenances terminées + pneus + incidents clos sans maintenance liée, divisé par les km depuis la mise en service. Dotations et remboursements exclus (flux de trésorerie).
- **Disponibilité technique** : jours opérationnels prévus (paramètre, 6/semaine par défaut, à confirmer) moins les jours chevauchant une immobilisation.
- Avec 4 motos, chaque écran affiche l'avertissement « Observation limitée ».

### 1.5 Incidents critiques

Arrêt → signalement → immobilisation → diagnostic → autorisation de dépense (BM ou Chef de zone, jamais le déclarant) → réparation → contrôle → remise en service (exige un **contrôle de remise en service APTE** enregistré après l'incident) → clôture. Un accident est aussi inscrit automatiquement au registre AFLP existant (`aflp_incidents`, type `ACCIDENT_MOTO`) : pas de double saisie.

### 1.6 Exports

Pilotage → **Exporter Excel** : flotte, consommation, intervalles plein à plein, coûts, disponibilité, rapprochement (si autorisé), échéances, alertes documentaires, pneus, incidents ouverts, limites d'observation.

---

## 2. Architecture retenue

Trois options comparées pendant l'audit :

| Option | Verdict |
|---|---|
| Extension native des pages existantes (Field Buying, `workspace.js`) | Rejetée : fichiers en zone de revue humaine, logique et présentation mêlées, risque de régression élevé |
| **Module isolé dans le dépôt (`moto/`)**, mêmes comptes, même portail, même Supabase | **Retenue** : aucune modification des fichiers d'authentification, du service worker ni des migrations existantes |
| Application séparée | Rejetée : second système d'authentification, interdit par le mandat |

Points de réutilisation : `shared/auth-gate.js` (clé de module `fbms`, inchangé), table `profils` et sa contrainte de rôles (inchangées), référentiel `aflp_clusters`, helpers `est_actif`, `portee_terrain_globale`, `aflp_cluster_code`, registre `aflp_incidents`, service worker `sw.js` (enregistré, non modifié), SheetJS via le même CDN.

File hors connexion : base IndexedDB **dédiée** (`anagroci_moto_offline`) et fonction serveur dédiée `moto_sync_batch`. La file Field Buying (`shared/offline-field.js`, `offline_sync_batch`) n'est ni lue ni modifiée : zéro risque de régression sur les achats.

---

## 3. Installation et déploiement (à faire par une personne autorisée)

Ordre impératif. **Ne pas publier `main` avant l'étape 3.**

1. **Sauvegarde** (§ 5) de la base de production.
2. **Appliquer les migrations** dans Supabase → SQL Editor, dans cet ordre, en vérifiant l'absence d'erreur :
   `supabase/20261031090000_aflp_moto_manager_1_schema_securite.sql`
   `supabase/20261031090100_aflp_moto_manager_2_rpc.sql`
   `supabase/20261031090200_aflp_moto_manager_3_vues_kpi.sql`
   Recommandé : d'abord sur une branche Supabase de préproduction (option payante, non créée sans autorisation).
3. **Contrôles post-migration** (lecture seule) :
   ```sql
   select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'moto\_%';  -- toutes à true
   select id, public from storage.buckets where id='moto-documents';                                     -- public = false
   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like 'moto\_%' and has_function_privilege('anon', p.oid, 'execute');  -- 0
   ```
   Vérifier aussi que le propriétaire des fonctions (`postgres`) peut lire `storage.objects` : `moto_document_enregistrer` contrôle l'existence réelle du fichier déposé.
4. **Fusionner la pull request** (revue humaine obligatoire : `supabase/**`, `*.html`, `index.html` sont en liste de revue humaine).
5. **Paramétrer** (BM) : seuils, jours opérationnels, liste des équipements obligatoires, règles d'entretien **après** vérification du manuel APSONIC AP150-30.
6. **Recette terrain** sur 2 motos, puis 2 autres (§ 6 du rapport d'exécution).

### Retour arrière

`supabase/20261031090300_aflp_moto_manager_rollback.sql` :
- **Niveau 1** (non destructif, immédiat) : retire tous les droits d'exécution et de lecture du module et les politiques de stockage. Les données restent intactes.
- **Niveau 2** (commenté) : suppression du module, qui **refuse de s'exécuter** si une table moto contient des données ou si le bucket contient des fichiers.

Côté site : revenir au commit précédent de `index.html` retire la carte ; le dossier `moto/` est inerte sans les migrations.

---

## 4. Administration

- **Paramètres** (BM, Administration → Paramètres) : seuils de consommation, jours opérationnels, règles d'entretien (intervalle km et/ou jours, source « Paramètre ANAGROCI » ou « Constructeur vérifié » avec référence obligatoire au manuel).
- Équipements et documents obligatoires : table `moto_parametres` (clés `equipements_obligatoires`, `documents_obligatoires`), modifiables par `moto_parametre_modifier` (BM).
- **Corrections** : jamais d'édition directe. Demande (BM, ABM, Chef de zone selon le champ) puis décision par un autre responsable (BM, General Manager, Finance Manager). L'ancienne valeur, la nouvelle, l'auteur, le motif et le valideur sont journalisés.
- **Journal** : `moto_journal`, immuable (déclencheur qui refuse toute modification), lisible par BM, ABM, Direction, Finance Manager.
- **Ajouter une moto ou un cluster** : une moto se crée depuis l'écran ; un cluster s'ajoute dans `aflp_clusters` (référentiel AFLP existant) — rien à changer dans le module.
- **Garage** : pas de compte en V1. Ses rapports et factures sont déposés par l'ABM ou le Chef de zone.

---

## 5. Sauvegarde

- Données : tables `public.moto_*`. Sauvegarde ciblée :
  `pg_dump --data-only --table='public.moto_*' "$DATABASE_URL" > moto_$(date +%F).sql` (variable d'environnement, jamais de mot de passe dans un fichier commis).
- Fichiers : bucket privé `moto-documents` (PV, cartes grises, factures, reçus). Les sauvegardes Supabase de la base **n'incluent pas** les objets du stockage : prévoir une copie périodique du bucket par l'administrateur.
- Téléphones : les saisies en attente vivent dans IndexedDB de l'appareil. Ne pas vider les données du navigateur et ne pas se déconnecter tant que la file n'est pas à « À jour ».

---

## 6. Rejouer les tests

```bash
# Réplique PostgreSQL 16 locale (jamais Supabase)
export PGHOST=/chemin/socket PGPORT=54329
./tests/moto/executer_tests_moto.sh                      # 186 scénarios serveur, migrations rejouées deux fois
node --test tests/moto/core.test.mjs                     # 10 tests unitaires du cœur métier
npm install --no-save playwright@1.49.1 pg@8 @supabase/supabase-js@2 xlsx@0.18.5 qrcode-generator@1.4.4
./tests/moto/e2e/preparer_base_e2e.sh fbms_moto_e2e
CHROMIUM=/chemin/chrome node tests/moto/e2e/moto-e2e.mjs  # parcours réel dans le navigateur, 3 largeurs
```

# FBMS AFLP 2027 · Régularisation producteurs, parcelles, accords, Sustainability et hors connexion

**Rapport d'exécution du mandat du 25/10/2026** · Destinataire : Branch Manager ANAGROCI Bouaké
Exécuté par Claude (assistant IA) avec les accès effectivement disponibles : dépôt GitHub `nwodobe/fbms`, projet Supabase « FIELD BUYING ANAGROCI », terminal de l'ordinateur Windows (contrôle ADB uniquement). Aucun nom, téléphone ni coordonnée de producteur dans ce rapport.

---

## 0. Limites d'accès réelles

| Accès | Disponible | Usage |
|---|---|---|
| Base Supabase (SQL, migrations) | Oui | diagnostic, sauvegarde, écritures A et B, tests transactionnels |
| Dépôt GitHub | Oui (branche + PR, pas de fusion) | correctifs, tests, documentation |
| Interface FBMS connectée | **Non** : aucune session utilisateur ; je n'ai pas saisi de mot de passe | l'affichage réel n'a pas été observé avec un compte |
| Téléphone Android | **Non** : aucun appareil connecté au PC | `TEST ANDROID PHYSIQUE NON EXÉCUTÉ` |

Méthode d'« environnement isolé » : la création d'une branche Supabase est payante ; les tests ont donc été exécutés **dans des transactions annulées** sur le schéma réel (aucune donnée persistée, vérifié après chaque test), plus un banc navigateur local sur données synthétiques.

## 1. Diagnostic initial recalculé (avant toute écriture)

| Indicateur | Pré-audit | Recalculé | Écart |
|---|---:|---:|---|
| Producteurs | 281 | 281 | = |
| Non supprimés | 274 | 274 | = |
| Superficie historique présente (clé `superficieHa`) | 202 « numériques » | 204 clés : 185 nombres + 11 textes (actifs), 7 textes (supprimés), 1 vide | le pré-audit mélangeait nombres et textes |
| Superficie exploitable (actifs, > 0) | — | **196** | |
| Parcelles `farmer_plots` | 0 | 0 | = |
| Consentements NOT_RECORDED / PARTIAL | 268 / 13 | 261 actifs + 7 supprimés / 13 (14 lignes, 1 remplaçante) | = |
| Passeports INCOMPLETE | 281 | 281 | = |
| Baselines, inspections, visites, vérifications | 0 | 0 | = |
| Critères actifs `AFLP-SUST-2026.2` | 25 | 25 (+ 25 inactifs 2026.1) | = |

**Origine réelle des 274 producteurs actifs** (métadonnées `data.source` + reçus de synchronisation serveur) :

| Origine | Nombre | Date d'enrôlement |
|---|---:|---|
| Enrôlement direct FBMS hors ligne (`OPERATIONS_FIELD_BUYING_OFFLINE`) | 166 | **vérifiée** : horodatage client du reçu `offline_sync_receipts` (14 → 21/10/2026), même jour que `created_at` |
| Enrôlement direct FBMS en ligne | 4 | vérifiée : `created_at` (insertion directe, 14/10/2026) |
| RT convertis en producteurs par migration (`RT_AUTO_ENROLLMENT_2026_08_27`) | 104 | **non vérifiable** : `created_at` = date de la migration, pas de l'enrôlement |
| Coopératives | 0 | — |

Les 166 enrôlements hors ligne ont été saisis par **2 Unit Heads et 1 Zonal Head**. La base ne compte aucun compte agent terrain.

**Sauvegarde** : schéma interne `backup_avant_regularisation_aflp_20261025` (non exposé à l'API) : producteurs, consentements, parcelles, enrôlements + empreinte MD5 des 281 dossiers.

## 2. Causes racines trouvées

| Code | Constat | Preuve |
|---|---|---|
| **A-BUG-1** | Le formulaire en ligne crée la parcelle avec `gps_status = 'DEFERRED'`, valeur refusée par la base : toute parcelle sans GPS échouait. | test SQL T1 : violation `farmer_plots_gps_metadata_chk` |
| **A-BUG-2** | Le bouton GPS jetait la précision ; la contrainte accepte pourtant un point sans précision (NULL passe un CHECK). | lecture + test T2 |
| **A-3** | La superficie du formulaire (« Superficie déclarée (ha) », section exploitation) est une **surface globale**, distincte de la section Parcelle facultative, jamais remplie. D'où 0 parcelle. | code `field-buying.js`, 0 parcelle malgré 166 synchronisations réussies |
| **P0-1** | La règle d'insertion des consentements (`peut_editer_terrain()`) exclut Unit Head, Zonal Head, Assistant Unit Head : **l'équipe AFLP ne peut pas enregistrer un consentement**. | test E2E : refus RLS pour un Unit Head ; succès avec la règle corrigée |
| **P1-1** | Un superviseur peut approuver son propre dossier (passeport VERIFIED). | test C-SEP |
| **D-1** | Page hors ligne bloquée juste après la préparation (PWA). | voir rapport 06 |

## 3. Chantier A · Superficies et parcelles

### Comparaison des trois méthodes et règle retenue

| Méthode | Usage retenu | Dossiers |
|---|---|---:|
| **M1** récupération automatique contrôlée | Nombre saisi dans le formulaire FBMS, unité ha explicite, aucune anomalie | **157** |
| **M2** fiche provisoire | Valeur importée du recensement RT (nombre ou texte converti), unité déduite du nom du champ | **22** |
| **M3** vérification terrain | Doublon possible (5), téléphone partagé (5), densité < 20 arbres/ha (5) ou > 300 arbres/ha (2) | **17** |
| Sans superficie | 77 RT + 1 enrôlement | 78 |
| Hors périmètre | 7 dossiers TEST supprimés (dont −5 et 999 999 999 ha) | 7 |

**Décision de modélisation.** Toutes les superficies historiques sont des surfaces globales non localisées. M1 et M2 ont donc produit **le même objet prudent** : une parcelle `EXPLOITATION DÉCLARÉE · À VÉRIFIER`, `status = REVIEW_REQUIRED`, `gps_status = NOT_MAPPED`, `area_source = evidence_level = DECLARED`, sans coordonnée, sans surface GPS, avec en note la valeur d'origine, la méthode, la justification et la référence de lot `REG-AFLP-A-20261025`. La différence M1/M2 est tracée dans le registre et la note.

Conséquences vérifiées : une parcelle `REVIEW_REQUIRED` **n'entre ni dans le score du passeport, ni dans le tableau de bord, ni dans les sommes d'export** (les exports continuent d'afficher la superficie de la fiche, source « Fiche producteur ») : aucun double comptage, aucune fausse géolocalisation.

### Écritures réalisées

- 179 parcelles provisoires créées (lot M2 de 22, puis 3 lots M1), 513,85 ha, compte du Branch Manager, note d'exécution nominative.
- Registre par dossier : `regularisation_aflp.superficies_20261025` (méthode, justification, valeur d'origine, parcelle créée).

### Vérifications (toutes exécutées)

| Contrôle | Résultat |
|---|---|
| Producteurs avant / après | 281 / 281 ; `data` identique 281/281 ; empreinte MD5 inchangée |
| Identifiants, Farmer ID, village, suppression | identiques 281/281 |
| Passeports et consentements | identiques 281/281 |
| Unicité des parcelles | 179 / 179 identifiants uniques ; 1 parcelle par producteur |
| Parcelles avec GPS, polygone ou surface vérifiée | **0** |
| Parcelles ACTIVE (comptées) | 0 |
| Village parcelle = village producteur | 179/179 |
| Somme migrée = somme source | 513,85 = 513,85 ha |
| Journal d'audit | 179 lignes `farmer_change_log` |
| Ajout d'une 2e parcelle à un producteur | OK (test transactionnel) |
| Échantillon de contrôle (20 dossiers tirés au hasard, comparaison programmatique valeur d'origine / parcelle) | 20/20 conformes. Ce n'est pas une vérification terrain. |
| Affichage Passport | code modifié (statut « À vérifier », surface déclarée vs GPS vérifiée) ; **non observé avec un compte connecté** |

Retour arrière : `docs/regularisation_aflp_20261025/sql/rollback_lots_A_B_20261025.sql`.

## 4. Chantier B · Accords et notice

### Pourquoi `farmer_consents` n'a pas été utilisé pour votre déclaration

`farmer_consents` enregistre le **consentement aux traitements de données** (identité, GPS, photos, transactions…). Y inscrire votre attestation aurait fait passer une déclaration de responsable pour un consentement du producteur et gonflé les passeports. J'ai donc créé une extension traçable (migration `20261025090000_aflp_accords_participation_notice.sql`, appliquée, réversible) :

- `farmer_participation_attestations` : accord de participation AFLP. Contraintes : une attestation de responsable ne peut **ni** porter de signature producteur **ni** couvrir le consentement données ; date d'accord renseignée seulement si sa source est vérifiée et antérieure à l'attestation ; une seule attestation active ; aucune modification possible (correction = nouvelle ligne) ; insertion réservée au Branch Manager en son nom propre.
- `farmer_notice_deliveries` : remise effective de la notice (méthode, langue, interprète, accusé, témoin, preuve) ; date future refusée ; accusé sans méthode refusé.
- `aflp_notice_versions` : notice `AFLP-NOTICE-2026.1` enregistrée **en attente de validation juridique**.
- `farmer_regularisation_status_v` : statut par producteur.

10 tests de sécurité exécutés (transaction annulée) : 10/10 conformes.

### Écritures réalisées

160 attestations rétrospectives (lot `REG-AFLP-B-20261025`) : date d'accord = date d'enrôlement vérifiée, date de création distincte, source « déclaration du responsable, pas une signature », note d'exécution. **Aucun consentement données modifié, aucun passeport modifié, aucune notice déclarée remise.**

### Tableau de synthèse B6 (274 producteurs actifs)

| Catégorie | Nombre |
|---|---:|
| Accord historique documenté au dossier | **13** : consentement données PARTIAL, verbal, sans pièce, saisi le 28/08/2026 (RT-producteurs) ; la participation n'y est pas explicitement couverte |
| Concernés par votre attestation rétrospective (enrôlement direct, date vérifiée) | **160** |
| Preuve de remise de notice | **0** |
| Nécessitant information + consentement données sur le terrain | **274** (aucun n'a les deux) |
| Anomalies d'identité (doublon possible ou téléphone partagé), attestation suspendue | **10** |
| RT convertis en producteurs, origine et date à confirmer par vous | **91** (+ les 13 ci-dessus) |
| Statut réellement écrit dans FBMS | 160 attestations ; 0 changement de consentement ; 0 conforme intégralement |

### Cadre juridique ivoirien (à confirmer par un juriste)

Loi n° 2013-450 du 19 juin 2013 relative à la protection des données à caractère personnel ; autorité : **ARTCI**, qui gère depuis 2026 les demandes d'autorisation sur la plateforme **CERTINUM**. Obligations rappelées par les sources consultées : autorisation préalable du traitement, consentement explicite, information des personnes, sécurité, droits d'accès / rectification / opposition. Conséquence pratique : l'accord de participation **ne suffit pas** pour le GPS, les photos ou le partage avec un certificateur ; chaque périmètre doit être recueilli et prouvé. Points ouverts : formalité ARTCI propre à AFLP, durée de conservation, transfert éventuel hors de Côte d'Ivoire.

Livrables : notice (fichier 04), procédure de régularisation à la prochaine visite (fichier 05, §4 étape 3).

## 5. Chantier C · Sustainability et inspections

Parcours complet exécuté avec un compte Unit Head réel sur un producteur synthétique (transaction annulée) : parcelle GPS, 2e parcelle, baseline production finalisée, baseline sustainability 25 réponses finalisée, inspection finalisée avec **9 actions correctives générées**, visite, vérification. Passeport : INCOMPLETE → BASIC → MAPPED → BASELINE (100 %) → VERIFIED.

Blocages : P0-1 (consentement impossible pour l'équipe AFLP) et P1-1 (auto-validation). Correctifs préparés **et testés** : `supabase/PREPARE_20261025_consentements_roles_aflp_et_separation_taches.sql`. **Non appliqués** : modification sensible des droits, votre autorisation est requise.

Correctif client : les nouveaux formulaires créaient encore des fiches en version 2026.1 (convertie côté serveur) ; ils créent désormais 2026.2.

Guide opérationnel, rôles, pilote 30 dossiers / 6 clusters : fichier 05. Aucune inspection réelle n'a été enregistrée.

## 6. Chantier D · Hors connexion

Voir fichier 06. Synthèse : D-1 reproduit et corrigé (avant ÉCHEC, après PASS ×4) ; persistance, dépendances, idempotence et charge 500 opérations OK en émulation ; **TEST ANDROID PHYSIQUE NON EXÉCUTÉ** ; l'APK est dans une PR non fusionnée.

## 7. Code livré (branche `aflp/regularisation-sustainability-20261025`, PR non fusionnée)

| Fichier | Changement |
|---|---|
| `operations/field-buying.js` | `DEFERRED` → `NOT_MAPPED` ; précision et heure GPS conservées ; coordonnées manuelles gardées en note, jamais présentées comme point GPS ; statut de parcelle et surface vérifiée affichés |
| `shared/farmer-registry-passport.js` | badge « À VÉRIFIER », surface déclarée vs GPS vérifiée |
| `shared/farmer-registry-operations.js` | nouveaux questionnaires en 2026.2 |
| `sw.js` | repli hors ligne sans paramètre `?v=` (D-1) |
| `tests/regularisation-aflp-static.mjs` | 8 contrôles ; rouge sur `main`, vert sur la branche |
| `tests/offline-field-e2e.mjs` | stabilisation des attentes, Chrome local optionnel |
| `tests/sql/regularisation_aflp/*` | tests transactionnels reproductibles |
| `supabase/20261025090000_*.sql` | migration B appliquée + retour arrière |
| `supabase/PREPARE_20261025_*.sql` | correctifs de droits préparés, non appliqués |

Portes du dépôt : JS 0 nouvelle erreur, HTML 0 nouveau défaut, liens OK, 10 tests statiques existants verts. `sw.js` et `supabase/` sont des zones à revue humaine obligatoire selon `CLAUDE.md` : ne pas fusionner sans relecture.

## 8. Anomalies résiduelles

| Priorité | Code | Anomalie | Responsable proposé |
|---|---|---|---|
| P0 | P0-1 | Consentement impossible pour Unit / Zonal / Assistant Unit Head | Branch Manager (autoriser) puis administrateur Supabase |
| P0 | — | 274 producteurs sans consentement données ni notice | Chefs de Zone, pendant le pilote puis généralisation |
| P1 | P1-1 | Auto-validation des passeports | Branch Manager (autoriser) |
| P1 | — | Aucun compte agent terrain : collecte et contrôle confondus | Branch Manager / RH |
| P1 | D-1 | Revue et fusion du correctif Service Worker | Développeur FBMS |
| P1 | — | Notice à valider juridiquement, formalité ARTCI / CERTINUM | Direction / juriste |
| P1 | — | 91 RT-producteurs : origine et date d'enrôlement à confirmer | Branch Manager |
| P2 | A | 17 dossiers M3 + 78 sans superficie à visiter | Chefs d'Unité |
| P2 | A | 7 fiches où « nombre d'arbres » contient un âge (« 5 ANS ») | Chefs d'Unité |
| P2 | D-3 | Précision GPS ignorée par la synchronisation serveur ; contrainte accepte un point sans précision | Développeur FBMS |
| P2 | D-4 | File hors ligne partagée entre comptes d'un même téléphone (non testé) | Développeur FBMS |
| P2 | C | Indicateurs de régularisation non affichés dans l'interface (vue disponible) | Développeur FBMS |
| P2 | D | Test sur téléphone réel et revue de l'APK (PR #262) | Branch Manager + Chef de Zone pilote |

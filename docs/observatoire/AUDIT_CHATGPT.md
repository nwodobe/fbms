# Audit contradictoire ChatGPT avant mise en production — 13/11/2026

Conversation utilisée : « Concevoir étude floraison noix anacardier » (seule conversation autorisée). Aucune clé, aucun mot de passe, aucune donnée de producteur transmis. Le code a été communiqué par extraits (sécurité, synchronisation) : la branche n'est pas sur le dépôt distant.

## Tour 1 — « CLAUDE À CHATGPT | AUDIT AVANT MISE EN PRODUCTION FBMS »

Décision ChatGPT : **NO-GO production**, GO limité à la poursuite sur branche isolée. Aucune faille exploitable démontrée.

| Id | Gravité | Objection | Suite donnée |
|---|---|---|---|
| B1 | Bloquant | Réplique de test non fidèle à la production | **Maintenu comme condition** : staging Supabase (P0-03). Réduction du risque : l'installation ne dépend plus de la RLS du registre (RPC `pheno_parcelles_disponibles`) |
| B2 | Bloquant | RPC SECURITY DEFINER non auditables | Code transmis au tour 2 ; tests d'identité falsifiée, de privilèges et de propriétaires ajoutés (SEC-62 à SEC-76) |
| B3 | Bloquant (indicateurs) | C cumulatif cluster = moyenne simple des champs | **Corrigé** : ratio pondéré ; « descriptif » et sans palier si plan incomplet |
| B4 | Bloquant | Téléphone partagé | **Corrigé** : opérations et brouillons attachés à leur auteur (E2E-58 à 60) |
| M1 | Majeur | Tirage manipulable | **Corrigé** : graines non choisies, puis graine aléatoire de campagne (tour 2) |
| M2 | Majeur | Exclusion des champs incompatibles | Champs incompatibles conservés et comptés (écran Qualité, vue cluster) |
| M3 | Majeur | Réserves à probabilité approchée | **Corrigé** : hors proportions, comptées à part |
| M4 | Majeur | Contre-visite bloquée par l'unicité champ × semaine | Hors MVP (V1.1, type de visite distinct) — accepté par ChatGPT au tour 2 |
| M5 | Majeur | Accès RT | Écarté : le mandat exclut l'accès RT ; mode essai RT hors MVP — accepté au tour 2 |
| M6 | Majeur | Synchronisation concurrente | **Corrigé** : verrou par clé, accusé dans la même transaction (SYN-19/20) |
| M7 | Majeur | Droits sur les photos | Tests directs de dépôt/lecture/suppression (SEC-40 à 53), photo limitée au dossier de l'auteur (SEC-73) |
| M8 | Majeur | Biais de non-réponse | **Corrigé** : non-réponse pondérée publiée ; analyse de sensibilité en fin de pilote |
| M9 | Majeur | Date de l'événement C | Déjà conforme : intervalle (dernière visite négative, première positive) |
| m1 | Mineur | Empreinte md5 non canonique | **Corrigé** : SHA-256 sur jsonb |

## Tour 2 — corrections et code de sécurité

Décision ChatGPT : **NO-GO production confirmé** ; « je ne vois pas de preuve d'une escalade effective dans le code d'autorisation fourni ».

| Id | Gravité | Objection | Suite donnée |
|---|---|---|---|
| S1 | Bloquant | RPC publiques appelables directement | Vérifié : chaque RPC contrôle elle-même rôle et périmètre ; tests d'appel direct hors périmètre (SEC-69, SEC-70, ECH-22) |
| S2 | Bloquant | Cluster de la visite ≠ cluster du champ | **Corrigé** : déclencheur de cohérence imposé par la base (SEC-71) |
| S3 | Bloquant | Politiques Storage concurrentes | **Vérifié en production (lecture seule du catalogue)** : toutes les politiques existantes sont limitées à leur bucket ; aucune ne s'applique à `pheno-preuves` |
| T1 | Majeur | Empreinte sans appareil ni date client | **Corrigé** : empreinte sur l'enveloppe complète (SEC-72, SEC-76) |
| T2 | Majeur | Conflits mémorisés | Conforme : un conflit n'est jamais présenté comme reçu ; les écarts deviennent des propositions de correction traitées par un valideur |
| T3 | Majeur | `sqlerrm` renvoyé au téléphone | **Corrigé** : message neutre + code de diagnostic, détail au journal invisible (SEC-74/75) |
| E1 | Bloquant (inférence) | Classement SHA-256 déterministe ≠ tirage aléatoire | **Corrigé** : graine aléatoire de campagne créée par le serveur avant toute installation, immuable (ECH-40 à 44). Reste déclaratif : B et N |
| D1 | Majeur | Rattachement photo / observation | Photo limitée au dossier campagne/champ/auteur et liée à l'arbre et à la visite ; elle suit le statut de la visite |

Conditions posées par ChatGPT pour un futur GO : staging fidèle à la production, revue du code intégral des RPC sur ce staging, version finale des droits, tests de sécurité et de non-régression rejoués sur staging.

Observation hors périmètre relevée pendant la vérification S3 : le bucket existant `photos` est public et ses politiques autorisent tout compte connecté à lire, déposer, modifier et supprimer n'importe quel fichier. Ce risque est antérieur et indépendant de l'Observatoire.

## Tour 3 (13/11/2026) : audit avant mise en production

**Verdict ChatGPT :** NO-GO production ; GO pour la publication de la demande de fusion, la recette sur un Supabase isolé et un correctif `photos` séparé et prioritaire. ChatGPT a vérifié de son côté, en lecture seule : PostgreSQL 17.6, bucket `photos` public sans limite (252 objets, 68 dossiers, politiques limitées à `bucket_id`), branche Supabase en MIGRATIONS_FAILED, aucune table `pheno_*` en production, commit non visible sur GitHub. Gravité ÉLEVÉE de `photos` confirmée.

| Exigence ChatGPT | Réponse | État |
|---|---|---|
| Code inspectable (commit et migrations) | Bundle + procédure `PROCEDURE_TRANSFERT_GITHUB.md` ; l'écriture GitHub est refusée à l'agent | Attend le BM (D1) |
| Manifeste des 170 objets et zones non couvertes | `MANIFESTE_STAGING_170.md` | Fait |
| Recette HTTP sur Supabase isolé (Auth, REST, Storage) | `tests/observatoire/recette_http.mjs`, 18 contrôles ; projet isolé payant, binaires externes refusés | Prêt, NON EXÉCUTÉ (D2) |
| Attaques logiques de synchronisation (clé réutilisée, hors cluster, envoi après désactivation ou mutation, lot mixte, perte de réponse) | SYN-21 à SYN-26 ajoutés ; lot mixte (SYN-14), renvoi (SYN-01), concurrence (SYN-19/20) existaient | 229/229 |
| Dossier `photos` : dépendances, transition, politiques concurrentes, anciennes URL | Inventaire (2 fichiers, 42 fiches avec URL publique), ordre front puis migration, proposition testée avant/après, retour arrière vérifié | Fait, non appliqué (D3) |
| Retour arrière potentiellement destructif | Après données réelles : revert du front seulement | Intégré à la demande |
| Graine non renouvelable | Déjà garanti (ECH-43, ECH-44) | Fait |

Désaccord résiduel : aucun sur le fond. Je partage le NO-GO immédiat ; la demande de mise en production est donc conditionnelle (D4).

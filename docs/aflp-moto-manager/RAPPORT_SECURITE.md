# AFLP Moto Manager — rapport de sécurité

Date : 31/10/2026 · Branche `feat/aflp-moto-manager` · Migrations **non appliquées en production**.

## 1. Modèle

Le portail JavaScript ne protège rien seul (la clé publique Supabase est dans les pages). La sécurité repose sur trois couches serveur :

1. **RLS en lecture** sur les 23 tables `moto_*` : périmètre calculé côté serveur (`private.moto_dans_perimetre`, `private.moto_lecture_finance`).
2. **Aucune écriture directe** : `insert/update/delete` révoqués pour `authenticated` et `anon`. Toute écriture passe par une fonction `public.moto_*` SECURITY DEFINER à `search_path` figé, qui vérifie compte actif, classe métier, périmètre et règles métier.
3. **Journal immuable** `moto_journal` alimenté par déclencheur sur chaque table (ancienne valeur, nouvelle valeur, auteur, date, motif, valideur), protégé par un déclencheur qui refuse toute modification, même superutilisateur.

## 2. Contrôles réalisés (exécutés, pas lus)

Réplique PostgreSQL 16 locale reconstruite à l'identique de la production (contrôle md5 des 49 fonctions existantes), comptes fictifs, actions exécutées **sous le rôle `authenticated`** avec claims JWT. Résultats détaillés : `tests/moto/resultats/serveur.json`.

| Contrôle | Scénarios | Résultat |
|---|---|---|
| Rôles non habilités (Supervisor, Agent Recenseur, anonyme) | SEC-01..03, PER-05 | Refus / zéro ligne |
| Écriture directe en base refusée, même pour le BM | SEC-04, REG-05 | Refus |
| Fonctions internes d'écriture non appelables directement | REG-07, REG-08 | Refus |
| Aucune fonction moto exécutable par `anon` | REG-04 | 0 |
| Toutes les tables moto sous RLS | REG-03 | 0 exception |
| SECURITY DEFINER avec `search_path` figé | REG-06 | 0 exception |
| Périmètres : Chef d'unité limité à sa moto/son cluster, documents et fichiers inclus | PER-01..09 | Conforme |
| Stockage privé : bucket non public, dépôt hors dossier ou hors périmètre refusé | STO-01..04 | Conforme |
| Fichier inexistant refusé (pas de chemin fabriqué) | DOC-02 | Refus |
| Auto-validation interdite : documents, justificatifs, budgets, corrections, remboursements, dépense d'incident, maintenance | DOC-07, JUS-01, BUD, COR-03/07, RBT-03, INC-07 | Refus |
| Séparation remise / autorisation de circulation | MES-02/03 | Conforme |
| Seul le bénéficiaire confirme sa dotation ; échec non confirmable ; dépassement de budget refusé | DOT-05/07/08 | Refus |
| Idempotence : rejeu, identifiant d'un autre compte, lot borné à 50 | KM-02/05, SYN-01..06 | Conforme |
| Contournement : levée d'immobilisation hors circuit | REG-09, INC-11 | Refus |
| Droits FBMS existants non affaiblis (contrainte de rôles et helpers intacts) | REG-01/02 | Conforme |
| Navigateur : rôles non habilités, périmètre Botro/Sakassou | UI-SEC-* | Conforme |

## 3. Données

- Aucune donnée réelle insérée par les migrations : aucune moto, aucun châssis, aucun document. Les règles d'entretien sont créées **sans intervalle et inactives**.
- Numéros de châssis et immatriculation nullables ; conformité administrative impossible tant qu'ils sont vides.
- Tests : uniquement des comptes `*.example.invalid` et des valeurs « FICTIF ».
- Aucun secret commis. La clé publique Supabase visible dans `auth-gate.js` est la clé publiable existante, non modifiée.

## 4. Risques résiduels et limites

| Risque | Gravité | Traitement |
|---|---|---|
| Migrations testées sur réplique, **pas sur l'instance Supabase réelle** (PostgreSQL 17, propriétaires de schémas Supabase) | Élevée tant que non appliqué | Appliquer d'abord sur une branche Supabase de préproduction ; vérifier que `postgres` lit `storage.objects` (contrôle d'existence des fichiers) |
| Le bouchon `storage` de la réplique simule la RLS de Supabase Storage, pas le service Storage lui-même (limites de taille, types MIME) | Moyenne | Test de dépôt réel en préproduction |
| Photos de justificatifs en attente stockées **non chiffrées** dans IndexedDB du téléphone jusqu'à synchronisation | Moyenne | Supprimées automatiquement dès la synchronisation confirmée ; consigne : pas de téléphone partagé, code de verrouillage obligatoire |
| Accès hors connexion basé sur le profil mis en cache par `auth-gate.js` (comportement existant de FBMS) : un compte désactivé reste utilisable hors ligne jusqu'à la reconnexion | Faible | Le serveur refuse toute synchronisation d'un compte inactif |
| Aucun rôle RH dans FBMS : la vérification du permis est déclarée par l'ABM/BM avec le nom du vérificateur RH | Moyenne (traçabilité déclarative) | Créer un rôle RH = modification des permissions de production, **non faite sans autorisation** |
| Le General Manager et le Finance Manager n'ont aucun compte actif en production au 30/10/2026 : une correction initiée par le BM ne peut être validée par personne | Fonctionnelle | Créer au moins un compte valideur indépendant, ou décider d'une délégation |
| Liste des points de contrôle et équipements obligatoires proposée, non validée par ANAGROCI | Faible | Paramétrable |
| Le Chef de zone voit toute la flotte (portée globale décidée le 17/09/2026) | Choix assumé | Réversible via `portee_terrain_globale()` (fonction existante) |
| ~19 contrastes insuffisants préexistants sur le portail (axe-core) | Faible | Hors périmètre, déjà au référentiel |

## 5. Ce qui n'a pas été fait (hors autorisation)

Aucune migration appliquée en production, aucune permission de production modifiée, aucun déploiement sur le portail public, aucune donnée réelle créée ou supprimée, aucun paiement, aucune branche Supabase payante créée. La seule interaction avec la production a été la lecture du catalogue (rôles, fonctions, buckets, absence de tables moto).

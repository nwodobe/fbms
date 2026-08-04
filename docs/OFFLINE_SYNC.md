# Savoir+ — Mode hors ligne et synchronisation

> Agent responsable : **Offline and Sync Engineer**
> Contributeurs : Frontend Engineer, Backend Engineer, Neon Database Architect, QA Engineer
> Statut : **PROPOSITION** — aucun code de synchronisation n'a été écrit
> Version : 0.1.0 — 2026-08-03

---

## 1. Pourquoi c'est un sujet de premier plan

Le contexte d'usage n'est pas « parfois hors ligne ». C'est **régulièrement hors ligne, au milieu d'une action** : données prépayées épuisées, réseau perdu dans un couloir, coupure de courant sur l'antenne.

Deux conséquences :

1. **Le mode hors ligne n'est pas une fonctionnalité annexe.** Si une réponse est perdue, l'élève ne fait pas confiance à l'application et ne revient pas. C'est un risque produit, pas un confort.
2. **La reprise est plus difficile que la coupure.** Écrire dans IndexedDB est simple. Rejouer une file sans créer de doublon, sans perdre d'opération, et en résolvant les conflits multi-appareils, est le vrai problème.

---

## 2. Principes

| # | Principe | Conséquence |
|---|---|---|
| **O1** | **Toute écriture est une opération en file.** | Même en ligne, la soumission passe par la file. Un seul chemin de code, testé une fois. |
| **O2** | **Toute opération porte une clé d'idempotence générée par le client.** | Le rejeu est sûr par construction, pas par prudence. |
| **O3** | **Le serveur est l'autorité.** | Le client ne calcule aucun score, aucun statut de maîtrise, aucune échéance de révision. Il enregistre l'intention. |
| **O4** | **L'horloge du client n'est pas fiable.** | `created_at` client sert à la chronologie **affichée**. L'ordre d'écriture est fixé par le serveur. |
| **O5** | **Aucun échec silencieux.** | Une opération qui échoue reste visible, avec une action de reprise. |
| **O6** | **Aucune perte, aucun doublon.** | Deux propriétés distinctes, testées séparément. |

---

## 3. Contenu d'IndexedDB

| Magasin | Contenu | Durée de vie |
|---|---|---|
| `sessions` | séance en cours, exercices pré-chargés | jusqu'à la fin de la séance |
| `answers` | réponses saisies, y compris non envoyées | jusqu'à synchronisation confirmée |
| `attempts` | tentatives locales (n° d'essai, indices consommés) | jusqu'à synchronisation confirmée |
| `durations` | temps passé par exercice | jusqu'à synchronisation confirmée |
| `errors` | erreurs détectées localement (indicatif) | jusqu'à synchronisation |
| `operations` | **file d'opérations en attente** | jusqu'à `synced` confirmé |
| `content_cache` | leçons et énoncés consultés | 30 jours, purge LRU |
| `snapshot` | dernier état connu (progression, carnet, planning) | remplacé à chaque synchronisation |

> `content_cache` ne contient **jamais** de réponse correcte, d'indice non débloqué, ni de solution non acquise. Ce qui est mis en cache est exactement ce que le serveur a accepté d'envoyer. Un élève qui inspecte IndexedDB ne doit rien y trouver de plus que ce que l'écran affiche.

---

## 4. Modèle d'opération

Champs imposés par le cahier des charges, avec leur rôle exact :

| Champ | Type | Origine | Rôle |
|---|---|---|---|
| `id` | uuid | client | identifiant local |
| `idempotency_key` | uuid | client | **clé de déduplication serveur.** Générée une seule fois, à la création. Jamais régénérée à un rejeu. |
| `user_id` | uuid | client | **informatif uniquement.** Le serveur le remplace par celui de la session. Une divergence est un incident de sécurité. |
| `device_id` | uuid | client | identifiant d'appareil, persistant. Sert à la résolution de conflits multi-appareils. |
| `operation_type` | enum | client | voir §5 |
| `payload` | json | client | données de l'opération, validées par Zod côté serveur |
| `created_at` | timestamptz | **client** | chronologie pédagogique affichée |
| `last_attempt_at` | timestamptz | client | dernière tentative d'envoi |
| `attempt_count` | int | client | pilote le backoff |
| `sync_status` | enum | client | `pending` · `syncing` · `synced` · `failed` · `conflict` |
| `last_error` | text null | serveur | message d'erreur en langage clair |
| `server_version` | int null | serveur | version de l'entité côté serveur, base de la détection de conflit |

**Point critique — `idempotency_key` :** elle est générée à la **création de l'intention**, pas à l'envoi. Si elle était générée à l'envoi, un rejeu après timeout produirait une nouvelle clé et donc un doublon. C'est l'erreur la plus fréquente sur ce type de système.

---

## 5. Types d'opérations

| `operation_type` | Payload | Idempotence garantie par |
|---|---|---|
| `diagnostic.answer` | `{attemptId, questionId, answer, durationMs}` | `unique(diagnostic_attempt_id, question_id)` |
| `diagnostic.complete` | `{attemptId}` | `status` déjà `completed` ⇒ retour du résultat existant |
| `exercise.attempt` | `{exerciseVersionId, attemptNumber, answer, hintsUsed, durationMs}` | `unique(student_user_id, exercise_version_id, attempt_number)` |
| `exercise.hint_request` | `{exerciseVersionId, hintIndex}` | `max(hintsUsed)` — la reprise ne recompte pas |
| `exercise.give_up` | `{exerciseVersionId}` | booléen idempotent |
| `revision.item_result` | `{sessionId, itemId, result}` | `unique(session_id, item_id)` |
| `revision.session_complete` | `{sessionId}` | `status` déjà `completed` |
| `session.heartbeat` | `{sessionId, durationMs}` | agrégation par `max`, non cumulative |

**Chaque type dispose d'une garantie d'idempotence *structurelle* en base**, pas seulement de la clé d'idempotence. Deux barrières : la clé attrape le rejeu exact, la contrainte d'unicité attrape le rejeu déformé (clé perdue, appareil réinstallé).

---

## 6. Moteur de synchronisation

### 6.1 Cycle

```
┌──────────────────────────────────────────────────────────────┐
│ DÉCLENCHEURS                                                 │
│  · retour du réseau (événement `online`)                     │
│  · ouverture de l'application                                │
│  · fin de séance                                             │
│  · minuterie (toutes les 60 s si la file est non vide)       │
│  · action manuelle « Réessayer »                             │
└──────────────────────┬───────────────────────────────────────┘
                       ▼
        Sélection : status ∈ {pending, failed}
                    ET attempt_count < 10
                    ET backoff écoulé
                    ORDER BY created_at ASC   ← ordre de production
                       │
                       ▼
        Lot de 50 maximum → status = syncing
                       │
                       ▼
              POST /api/sync  { operations: [...] }
                       │
        ┌──────────────┼──────────────┬─────────────┐
        ▼              ▼              ▼             ▼
     200 OK        409 Conflict   4xx définitif  échec réseau
        │              │              │             │
    synced         conflict        failed        pending
    purge          UI dédiée       + message     + backoff
```

### 6.2 Backoff

`délai = min(2^attempt_count × 1 s, 5 min)` avec ±20 % de jitter.

Le jitter évite qu'une coupure d'antenne fasse converger tous les appareils du quartier sur la même seconde au retour du réseau.

Au-delà de **10 tentatives**, l'opération passe en `failed` et l'élève voit une action explicite. **On ne réessaie pas indéfiniment en silence.**

### 6.3 Traitement serveur d'un lot

```
POST /api/sync
  1. requireActiveAccount()
  2. Zod : le lot ≤ 50 opérations, chaque opération est bien formée
  3. assertNoCrossUser() ─── si un user_id étranger apparaît :
                             REJET INTÉGRAL du lot + audit_logs + alerte
  4. pour chaque opération, dans l'ordre reçu :
       a. idempotency_records : la clé existe déjà ?
            → oui + même request_hash  ⇒ retourner la réponse mémorisée
            → oui + hash différent     ⇒ 409 CONFLICT (clé réutilisée)
            → non                      ⇒ réserver la clé
       b. UNE TRANSACTION par opération
       c. garde d'autorisation spécifique au type
       d. traitement métier (score, erreur, maîtrise, planning)
       e. mémoriser la réponse dans idempotency_records
  5. retourner un statut PAR OPÉRATION
```

**Une transaction par opération, pas une pour le lot.** Si l'opération 7 échoue, les opérations 1 à 6 restent acquises. Une transaction globale ferait perdre un lot entier pour une seule anomalie — exactement le comportement qu'on cherche à éviter.

### 6.4 Réponse

```json
{
  "results": [
    { "idempotencyKey": "...", "status": "synced",   "serverVersion": 4 },
    { "idempotencyKey": "...", "status": "conflict", "reason": "session_completed_elsewhere",
      "resolution": "server_wins", "serverState": { } },
    { "idempotencyKey": "...", "status": "failed",   "code": "CONTENT_UNPUBLISHED",
      "message": "Cet exercice n'est plus disponible." }
  ]
}
```

Le client purge les `synced`, affiche les `conflict`, conserve les `failed` avec une action de reprise.

---

## 7. Résolution des conflits

### 7.1 Règle de base

**Le serveur gagne par défaut.** Le client n'a jamais raison contre la base, sauf sur les cas listés ci-dessous.

### 7.2 Cas identifiés

| # | Conflit | Résolution | Justification |
|---|---|---|---|
| **C1** | Même tentative envoyée deux fois (rejeu) | déduplication par clé → retour du résultat existant | ce n'est pas un conflit, c'est un rejeu |
| **C2** | Deux appareils, même exercice, même n° d'essai | **la première arrivée gagne**, la seconde est notifiée | la contrainte d'unicité tranche ; un `attempt_number` désigne un événement unique |
| **C3** | Séance terminée sur l'appareil A, poursuivie sur B | **la plus complète gagne** (plus d'items faits) | on ne détruit jamais du travail réel |
| **C4** | Réponse de diagnostic modifiée depuis un autre appareil | **la première réponse fait foi** | le diagnostic interdit le retour en arrière (`PEDAGOGY.md` §3.1) |
| **C5** | Contenu dépublié entre la mise en file et l'envoi | opération acceptée, rattachée à la **version** consultée | l'élève a réellement travaillé ; la version fige ce qu'il a vu |
| **C6** | Planning recalculé serveur pendant le travail hors ligne | **le serveur gagne**, le client rafraîchit son instantané | le planning est dérivé, jamais saisi |
| **C7** | Clé d'idempotence réutilisée avec un contenu différent | **rejet**, journalisé | soit un bug client, soit une manipulation |

### 7.3 Ce que voit l'élève

Un conflit n'est jamais silencieux, et jamais technique :

> « Tu as travaillé cette séance sur un autre téléphone. On a gardé la version la plus avancée. Rien n'est perdu. »

Si du travail est réellement écarté (C2, C4), le message le dit :

> « Cette réponse avait déjà été enregistrée. On a gardé la première. »

**Ne jamais afficher « conflit de synchronisation », « version 4 vs 3 », ni un code d'erreur.**

---

## 8. Garanties et preuves attendues

| Garantie | Mécanisme | Preuve exigée |
|---|---|---|
| **Aucune perte** | file persistante, purge **après** confirmation serveur uniquement | test : 20 opérations, coupure à la 7ᵉ, redémarrage ⇒ 20 opérations en base |
| **Aucun doublon** | clé d'idempotence + contrainte d'unicité | test : rejeu du même lot 3 fois ⇒ compte de lignes inchangé |
| **Reprise après coupure** | `syncing` remis à `pending` au démarrage si obsolète | test : arrêt brutal en `syncing` ⇒ reprise complète |
| **Ordre respecté** | tri par `created_at`, traitement séquentiel | test : réponses de diagnostic dans le désordre ⇒ `current_position` cohérente |
| **Conflit expliqué** | statut `conflict` + message rédigé | test E2E : deux appareils simulés ⇒ message affiché, aucune perte |
| **Aucune fuite** | `content_cache` filtré côté serveur | test : inspection d'IndexedDB ⇒ aucune `correct_answer` |
| **Aucun accès croisé** | `user_id` de session imposé | test : lot avec `user_id` étranger ⇒ 403, aucune écriture |

> Ces sept lignes sont la porte de validation de la Phase 10. Aucune ne peut être déclarée satisfaite sans le test correspondant exécuté et son résultat produit.

---

## 9. Service Worker

| Élément | Stratégie |
|---|---|
| Shell applicatif | *stale-while-revalidate* |
| Assets statiques | *cache-first*, immuables (empreinte dans le nom) |
| Pages de contenu | *network-first*, repli sur le cache |
| Appels API | **jamais mis en cache** — ils passent par la file d'opérations |
| Assets R2 | *cache-first* (l'URL présignée est immuable pendant sa validité) |
| Mise à jour | nouvelle version détectée ⇒ bandeau « Nouvelle version disponible », **jamais de rechargement forcé pendant une séance** |

> **Attention — INC-04 :** un service worker existe déjà à la racine du dépôt pour FBMS (`sw.js`, portée `./`). Deux service workers ne peuvent pas partager la même portée. Celui de Savoir+ doit être enregistré sur une portée distincte, ou déployé sur un domaine séparé. À trancher avec ADR-001.

---

## 10. Quotas de stockage

| Situation | Comportement |
|---|---|
| Quota approché (> 80 %) | purge LRU de `content_cache`, **jamais** de la file d'opérations |
| Quota atteint | message explicite : « Espace insuffisant. Connecte-toi pour envoyer ton travail. » |
| File > 200 opérations | avertissement à l'élève, synchronisation prioritaire |
| Échec d'écriture IndexedDB | l'opération reste en mémoire, l'élève est prévenu **avant** de continuer |

**La file d'opérations n'est jamais purgée pour faire de la place.** Le contenu en cache est reconstructible ; le travail de l'élève ne l'est pas.

---

## 11. Ce que le mode hors ligne ne fait pas (MVP)

Énoncé pour éviter toute ambiguïté :

- **Pas de résolution collaborative de conflits.** Un seul élève par compte ; les conflits multi-appareils sont tranchés par règle, jamais par choix de l'utilisateur.
- **Pas de synchronisation différentielle.** Chaque opération est envoyée entière.
- **Pas de fonctionnement hors ligne intégral.** L'inscription, la connexion, le diagnostic non chargé et l'espace parent exigent le réseau.
- **Pas de chiffrement d'IndexedDB.** Un téléphone compromis expose le cache local. Atténuation : aucune donnée sensible en cache (ni mot de passe, ni jeton de longue durée, ni réponse correcte).

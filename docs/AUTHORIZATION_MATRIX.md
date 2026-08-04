# Savoir+ — Matrice d'autorisation

> Agent responsable : **Authentication and Authorization Engineer**
> Contributeurs : Security Engineer, Backend Engineer, Software Architect
> Statut : **PROPOSITION** — aucune garde n'a été implémentée
> Version : 0.1.0 — 2026-08-03

---

## 1. Authentification ≠ autorisation

| | Authentification | Autorisation |
|---|---|---|
| Question posée | *Qui es-tu ?* | *As-tu le droit de faire ceci, sur cette ressource ?* |
| Assuré par | **Auth.js** | **le code applicatif de Savoir+** |
| Où | `server/auth/` | `server/authorization/` + services + repositories |
| Si absent | l'utilisateur ne peut pas se connecter | **n'importe qui accède aux données de n'importe qui** |

Auth.js ne fournit **aucune** autorisation. Une session valide prouve seulement une identité. Elle ne dit rien sur les droits.

> **Rappel critique dans le contexte Neon.** L'existant du dépôt (FBMS) s'appuie sur la RLS PostgreSQL de Supabase : la base elle-même refuse les lignes interdites. Savoir+ sur Neon **n'a pas ce filet**. Chaque garde manquante est une fuite directe. C'est la raison pour laquelle les tests d'autorisation sont classés bloquants et non optionnels.

---

## 2. Les six contrôles obligatoires

Toute opération sensible vérifie, **côté serveur, dans cet ordre** :

| # | Contrôle | Échec ⇒ |
|---|---|---|
| **1** | L'utilisateur est authentifié (session en base, non expirée) | 401 |
| **2** | Son compte est **actif** (`users.status = 'active'`) | 403 |
| **3** | Son rôle autorise l'action (`users.role` relu en base) | 403 |
| **4** | La ressource **existe** | 404 |
| **5** | Il **possède** la ressource, ou dispose d'un droit explicite dessus | **404** (voir §6) |
| **6** | L'état de la ressource permet l'action (contenu publié, lien actif, tentative non close) | 409 ou 403 |

**Le rôle est toujours relu en base.** Jamais depuis un cookie, un en-tête, un champ de formulaire, un paramètre d'URL, ni depuis un JWT non revérifié.

---

## 3. Rôles du MVP

| Rôle | Population | Portée |
|---|---|---|
| `student` | élève de Seconde C | ses **propres** données uniquement |
| `parent` | parent ou tuteur | les élèves dont le lien est **`active`**, en **lecture seule**, sur des **agrégats** |
| `admin` | responsable de contenu Savoir+ | contenu pédagogique + statistiques agrégées + interventions documentées et auditées |

Un utilisateur a **exactement un rôle** en MVP. Le cumul (parent d'un élève **et** élève lui-même) est hors périmètre et sera traité par une table de liaison le jour venu.

---

## 4. Matrice détaillée

Légende : ✅ autorisé · ❌ interdit · 🔒 conditionnel (condition explicitée) · — sans objet

### 4.1 Compte et profil

| Ressource / Action | student | parent | admin |
|---|:--:|:--:|:--:|
| Lire son propre profil | ✅ | ✅ | ✅ |
| Modifier son propre profil | ✅ | ✅ | ✅ |
| Lire le profil d'un autre utilisateur | ❌ | 🔒 lien `active`, champs limités | 🔒 audité |
| Modifier le profil d'un autre | ❌ | ❌ | 🔒 audité, justification requise |
| Changer son propre rôle | ❌ | ❌ | ❌ |
| Changer le rôle d'un autre | ❌ | ❌ | 🔒 audité |
| Suspendre un compte | ❌ | ❌ | 🔒 audité |
| Supprimer son compte | ✅ | ✅ | ✅ |

> **`admin` ne peut pas se promouvoir ni promouvoir un autre compte sans trace.** Toute écriture sur `users.role` génère une entrée `audit_logs` avec `before` et `after`.

### 4.2 Lien parent-enfant

| Action | student | parent | admin |
|---|:--:|:--:|:--:|
| Générer un code d'invitation pour son compte | ✅ | ✅ | ❌ |
| Accepter une invitation | ✅ | ✅ | ❌ |
| Lister ses liens | ✅ | ✅ | 🔒 audité |
| Révoquer un lien le concernant | ✅ | ✅ | 🔒 audité |
| Créer un lien sans invitation | ❌ | ❌ | 🔒 **audité + justification** |
| Voir les liens d'un tiers | ❌ | ❌ | 🔒 audité |

**Règles :**
- Un lien n'est `active` qu'après action des **deux** parties.
- Le code d'invitation est **haché** en base et expire après 7 jours.
- La révocation est **immédiate** : la requête parent suivante ne retourne plus rien.
- L'élève peut révoquer sans l'accord du parent. L'inverse est également vrai.

### 4.3 Diagnostic

| Action | student | parent | admin |
|---|:--:|:--:|:--:|
| Démarrer un diagnostic | ✅ (le sien) | ❌ | ❌ |
| Répondre à une question | 🔒 sa propre tentative, `in_progress` | ❌ | ❌ |
| Voir son rapport | ✅ | 🔒 lien `active`, **version simplifiée** | 🔒 audité |
| Voir les réponses détaillées | ✅ (les siennes) | ❌ | 🔒 audité |
| Voir la bonne réponse d'une question | 🔒 **après soumission de cette question uniquement** | ❌ | ✅ |
| Créer / modifier un diagnostic | ❌ | ❌ | ✅ |

### 4.4 Contenu pédagogique

| Action | student | parent | admin |
|---|:--:|:--:|:--:|
| Lire une leçon `published` | ✅ | 🔒 lecture seule | ✅ |
| Lire une leçon `draft` | ❌ | ❌ | ✅ |
| Lire l'énoncé d'un exercice `published` | ✅ | ❌ | ✅ |
| **Lire `correct_answer`** | ❌ | ❌ | ✅ |
| **Lire `solution_markdown`** | 🔒 3ᵉ essai ou abandon | ❌ | ✅ |
| **Lire un indice** | 🔒 indice `n` seulement si débloqué | ❌ | ✅ |
| Créer / modifier / publier / désactiver du contenu | ❌ | ❌ | ✅ audité |

> Les trois lignes en gras sont la traduction technique de la fonction centrale du produit. Une garde manquante ici ne provoque pas une fuite de données personnelles : elle détruit la valeur pédagogique. Les deux sont graves.

### 4.5 Tentatives et exercices

| Action | student | parent | admin |
|---|:--:|:--:|:--:|
| Soumettre une tentative | ✅ (pour lui-même) | ❌ | ❌ |
| Voir ses tentatives | ✅ | ❌ (agrégats uniquement) | 🔒 audité |
| Voir les tentatives d'un autre élève | ❌ | ❌ | 🔒 audité |
| Modifier une tentative enregistrée | ❌ | ❌ | ❌ |
| Supprimer une tentative | ❌ | ❌ | 🔒 audité, cas exceptionnel |

**Une tentative est immuable.** Personne — pas même un admin en usage normal — ne réécrit l'historique d'apprentissage d'un élève.

### 4.6 Erreurs, révision, progression

| Action | student | parent | admin |
|---|:--:|:--:|:--:|
| Voir son carnet d'erreurs | ✅ | 🔒 **catégories et fréquences uniquement**, pas les réponses | 🔒 audité |
| Voir son planning de révision | ✅ | 🔒 séances prévues / faites | ❌ |
| Marquer une révision comme faite | ✅ | ❌ | ❌ |
| Voir son tableau de progression | ✅ | 🔒 vue simplifiée | 🔒 agrégé |
| Recalculer une progression | ❌ | ❌ | 🔒 audité |

### 4.7 Espace parent

| Action | student | parent | admin |
|---|:--:|:--:|:--:|
| Lister ses enfants liés | — | ✅ (`status='active'` **uniquement**) | ❌ |
| Voir l'activité d'un enfant lié | — | ✅ | ❌ |
| Voir le rapport hebdomadaire | — | ✅ | ❌ |
| Voir les données d'un enfant **non lié** | — | ❌ **404** | ❌ |
| Répondre / modifier à la place de l'enfant | — | ❌ **403** | ❌ |

### 4.8 Fichiers (R2)

| Action | student | parent | admin |
|---|:--:|:--:|:--:|
| Lire un asset de contenu publié | 🔒 URL présignée, 5 min | 🔒 | ✅ |
| Téléverser un asset de contenu | ❌ | ❌ | ✅ |
| Lire un asset appartenant à un autre utilisateur | ❌ | ❌ | 🔒 audité |
| Supprimer un asset | ❌ | ❌ | ✅ audité |

**Aucun accès direct à R2.** Chaque URL présignée est émise après passage des six contrôles du §2.

### 4.9 Administration et technique

| Action | student | parent | admin |
|---|:--:|:--:|:--:|
| Voir les statistiques agrégées | ❌ | ❌ | ✅ |
| Voir les journaux d'audit | ❌ | ❌ | ✅ (lecture seule) |
| Modifier ou supprimer un journal d'audit | ❌ | ❌ | ❌ |
| Synchroniser ses propres opérations hors ligne | ✅ | ✅ | ✅ |
| Synchroniser au nom d'un autre `user_id` | ❌ | ❌ | ❌ |

> **`POST /api/sync` est le point d'entrée le plus exposé du système.** Le `user_id` d'une opération est **ignoré s'il est fourni par le client** et systématiquement remplacé par celui de la session. Un lot contenant une opération destinée à un autre utilisateur est rejeté intégralement et journalisé comme incident de sécurité.

---

## 5. Gardes serveur

Gardes réutilisables proposées dans `server/authorization/` :

| Garde | Contrat |
|---|---|
| `requireSession()` | retourne `{ userId, role, status }` ou lève 401. Relit la session **en base**. |
| `requireActiveAccount()` | `requireSession` + `status === 'active'`, sinon 403. |
| `requireRole(...roles)` | `requireActiveAccount` + appartenance au rôle, sinon 403. |
| `requireOwnership(table, resourceId)` | la ressource existe **et** appartient à l'utilisateur, sinon 404. |
| `requireActiveParentLink(parentId, studentId)` | lien `status='active'`, sinon 404. |
| `requirePublishedContent(entity, id)` | statut `published`, sinon 404 pour un élève, autorisé pour un admin. |
| `requireHintUnlocked(attemptId, hintIndex)` | l'indice a été légitimement débloqué, sinon 403. |
| `requireSolutionUnlocked(attemptId)` | 3ᵉ essai atteint ou abandon enregistré, sinon 403. |
| `assertNoCrossUser(payload, sessionUserId)` | aucun `user_id` étranger dans un payload de synchronisation, sinon 403 + incident. |

### Règles d'usage

1. **Toute** Server Action et **tout** Route Handler commencent par une garde nommée. Sans exception, y compris les lectures.
2. Une action sans garde ne passe pas la revue de code. Une règle ESLint personnalisée peut le vérifier mécaniquement.
3. La garde s'exécute **avant** la première requête base de données.
4. La clause d'appartenance est **également** portée par la requête SQL (`where student_user_id = $sessionUserId`). Deux barrières indépendantes : si la garde est oubliée, la requête ne retourne rien ; si la requête est mal écrite, la garde bloque.

> Cette redondance est intentionnelle. En l'absence de RLS, une seule barrière laisse une seule occasion de se tromper.

---

## 6. Non-divulgation : 404 plutôt que 403

Pour les ressources appartenant à un autre utilisateur, la réponse est **404**, jamais 403.

| Réponse | Ce qu'elle révèle |
|---|---|
| 403 « interdit » | *cette ressource existe, mais elle n'est pas à toi* → permet d'énumérer les identifiants |
| **404 « introuvable »** | *rien à voir ici* → n'apprend rien |

403 est réservé aux cas où **l'existence n'est pas un secret** : rôle insuffisant sur une action générique, compte suspendu, action interdite par nature (un parent qui tente de répondre).

---

## 7. Ce qui ne constitue pas une protection

Erreurs à ne jamais commettre, listées explicitement :

| Fausse protection | Pourquoi c'est faux |
|---|---|
| Masquer un lien dans le menu | l'URL reste appelable |
| Vérifier le rôle dans un composant React | le code client est modifiable |
| Vérifier le rôle **uniquement** dans le middleware Next.js | le middleware ne couvre pas les Server Actions |
| Faire confiance à un `role` reçu dans le corps d'une requête | trivialement falsifiable |
| Faire confiance à un `user_id` reçu du client | c'est **la** faille classique de toute API de synchronisation |
| Compter sur l'obscurité d'un UUID | un UUID fuité reste valide indéfiniment |
| Filtrer les champs secrets dans le composant d'affichage | la donnée a déjà transité par le réseau |

---

## 8. Procédure de révocation

| Événement | Effet immédiat |
|---|---|
| Changement de mot de passe | **toutes** les sessions de l'utilisateur sont supprimées |
| Révocation d'un lien parent | `status='revoked'` ; la requête parent suivante retourne 404 |
| Suspension d'un compte | `status='suspended'` ; le contrôle n°2 rejette à la requête suivante |
| Suppression d'un compte | sessions supprimées, `status='deleted'`, données traitées selon DM-Q1 |
| Déconnexion | la ligne `sessions` est supprimée |

**La stratégie de session `database` est ce qui rend ces révocations réellement immédiates.** Avec des JWT, une session révoquée resterait valide jusqu'à son expiration — inacceptable pour un lien parent-enfant portant sur les données d'un mineur.

---

## 9. Tests d'autorisation obligatoires

Ces tests sont **bloquants**. Une phase dont ils échouent ne peut pas être déclarée terminée.

| # | Test | Attendu |
|---|---|---|
| T-01 | Élève A lit les tentatives de l'élève B | 404 |
| T-02 | Élève A soumet une tentative avec le `user_id` de B | 403, tentative non créée |
| T-03 | Parent lit un élève sans lien | 404 |
| T-04 | Parent lit un élève dont le lien est `pending` | 404 |
| T-05 | Parent lit un élève dont le lien est `revoked` | 404 |
| T-06 | Parent tente de soumettre une réponse | 403 |
| T-07 | Élève force `role: 'admin'` dans le payload | ignoré, 403 sur l'action admin |
| T-08 | Utilisateur non authentifié appelle chaque Server Action | 401 sur **toutes** |
| T-09 | Compte suspendu appelle une action autorisée à son rôle | 403 |
| T-10 | Élève demande la solution au 1ᵉʳ essai | 403, solution absente du payload |
| T-11 | Élève demande l'indice 2 sans avoir eu l'indice 1 | 403 |
| T-12 | Le payload d'exercice contient `correct_answer` | **échec du test** — le payload doit en être exempt |
| T-13 | Lot de synchronisation mixant deux `user_id` | rejet intégral + incident journalisé |
| T-14 | Élève lit un contenu `draft` | 404 |
| T-15 | Session expirée | 401 |
| T-16 | Mot de passe changé pendant une session active | ancienne session invalidée |
| T-17 | Admin modifie un rôle | action réussie **et** `audit_logs` renseigné |
| T-18 | Élève accède à un asset R2 d'un autre utilisateur | 404, aucune URL présignée émise |

**T-12 est un test de payload, pas un test de code.** Il inspecte la réponse HTTP réelle. C'est le seul moyen de garantir qu'aucune réponse correcte ne fuit, quelle que soit l'implémentation.

---

## 10. Traçabilité

Actions écrivant obligatoirement dans `audit_logs` :

- toute action d'un `admin` sur un compte, un rôle ou un contenu ;
- création, activation et révocation d'un lien parent-enfant ;
- publication et retrait d'un contenu ;
- suppression de quoi que ce soit ;
- toute tentative d'accès croisé détectée (avec l'identifiant de l'acteur et la ressource visée).

`audit_logs` est **append-only**. Aucune route applicative ne permet sa modification ni sa suppression.

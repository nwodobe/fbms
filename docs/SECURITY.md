# Savoir+ — Sécurité

> Agent responsable : **Security Engineer**
> Contributeurs : Authentication and Authorization Engineer, Storage Engineer, DevOps Engineer
> Statut : **PROPOSITION** — threat model préalable, aucune mesure implémentée
> Version : 0.1.0 — 2026-08-03

---

## 1. Ce qui rend Savoir+ particulier

Trois caractéristiques dictent la posture de sécurité :

1. **Les utilisateurs sont des mineurs.** Une fuite de données ne concerne pas des adultes consentants mais des lycéens de 15 à 17 ans. Le seuil d'acceptabilité est plus bas qu'ailleurs.
2. **Il n'y a pas de filet RLS.** Neon ne fournit pas l'intégration Auth ↔ RLS de Supabase. **Chaque garde applicative manquante est une fuite directe**, sans seconde barrière côté base.
3. **Le secret le plus fréquemment exposé n'est pas une donnée personnelle, c'est une réponse d'exercice.** Une fuite de `correct_answer` ne se voit dans aucun scanner de sécurité et détruit pourtant la valeur du produit.

---

## 2. Threat model

Méthode STRIDE, appliquée aux actifs réels.

### 2.1 Actifs à protéger

| # | Actif | Sensibilité | Pourquoi |
|---|---|---|---|
| A1 | Données d'apprentissage d'un élève mineur | **Haute** | données personnelles, révèlent des difficultés scolaires |
| A2 | Identifiants et sessions | **Haute** | prise de contrôle de compte |
| A3 | Réponses correctes, indices, solutions | **Haute** | valeur pédagogique du produit |
| A4 | Liens parent-enfant | **Haute** | un faux lien = accès aux données d'un mineur |
| A5 | Secrets d'infrastructure (`DATABASE_URL`, clés R2, `AUTH_SECRET`) | **Critique** | compromission totale |
| A6 | Contenu pédagogique | Moyenne | atteinte à l'intégrité, désinformation |
| A7 | Journaux d'audit | Moyenne | effacement de traces |

### 2.2 Acteurs de menace

| Acteur | Motivation | Capacité |
|---|---|---|
| **Élève curieux** | obtenir les réponses, voir les notes d'un camarade | outils de développement du navigateur, modification de requêtes |
| **Parent intrusif** | surveiller au-delà du périmètre autorisé | compte légitime, manipulation d'identifiants |
| **Attaquant opportuniste** | credential stuffing, scraping du contenu | scripts automatisés |
| **Attaquant ciblé** | accès aux données d'un mineur identifié | reconnaissance, ingénierie sociale |
| **Interne (admin)** | abus de privilège | accès légitime étendu |

> **L'élève curieux est le premier attaquant réel du système**, pas un cas théorique. Un lycéen qui ouvre l'onglet « Réseau » pour trouver la bonne réponse est le scénario le plus probable, et le plus dommageable pour le produit.

### 2.3 Matrice STRIDE

| Menace | Scénario | Impact | Prob. | Parade |
|---|---|:--:|:--:|---|
| **S**poofing | Falsification du `role` dans un payload | Élevé | Élevée | rôle relu en base à chaque requête ; jamais lu du client |
| **S**poofing | Réutilisation d'un jeton de vérification | Moyen | Moyenne | jeton haché, usage unique, expiration, `purpose` distinct |
| **S**poofing | Credential stuffing | Élevé | Moyenne | Argon2id, limitation de débit par IP **et** par compte, réponses uniformes |
| **T**ampering | `user_id` forgé dans un lot de synchronisation | **Critique** | **Élevée** | `user_id` client **ignoré**, remplacé par celui de la session ; lot mixte rejeté |
| **T**ampering | Score recalculé côté client | Élevé | Élevée | scoring exclusivement serveur ; aucun score client n'est persisté |
| **T**ampering | Injection SQL | **Critique** | Faible | requêtes paramétrées Drizzle, zéro concaténation, Zod en amont |
| **R**epudiation | Un admin nie une action | Moyen | Faible | `audit_logs` append-only |
| **I**nfo. disclosure | **`correct_answer` dans le payload** | **Critique** | **Élevée** | projection SQL filtrante + **test de payload automatisé** |
| **I**nfo. disclosure | Élève A lit les données de B | **Critique** | Moyenne | garde + clause SQL d'appartenance (double barrière) + 404 |
| **I**nfo. disclosure | Parent lit un enfant non lié | **Critique** | Moyenne | `requireActiveParentLink` + index partiel sur `status='active'` |
| **I**nfo. disclosure | Secret dans le bundle client | **Critique** | Moyenne | une seule variable `NEXT_PUBLIC_` ; test CI de scan du bundle |
| **I**nfo. disclosure | Fuite par cache partagé | Élevé | Moyenne | aucun cache partagé sur donnée utilisateur ; clés préfixées par `userId` |
| **I**nfo. disclosure | Énumération d'identifiants via 403 vs 404 | Moyen | Moyenne | 404 uniforme sur ressource d'autrui |
| **D**oS | Boucle de synchronisation agressive | Moyen | Moyenne | plafond de 50 opérations/lot, limitation de débit, backoff client |
| **D**oS | Saturation du pool de connexions | Élevé | Faible | connexion poolée obligatoire, singleton, pas de connexion par requête |
| **E**levation | Auto-promotion en `admin` | **Critique** | Faible | `role` non modifiable par l'utilisateur ; écriture auditée |
| **E**levation | Lien parent créé sans consentement | **Critique** | Faible | double consentement, code haché et expirant |
| **E**levation | Upload arbitraire vers R2 | Élevé | Moyenne | URL présignée après contrôle, MIME vérifié sur octets, taille plafonnée, clé générée serveur |

---

## 3. Matrice des risques

| # | Risque | Gravité | Probabilité | Niveau | Traitement |
|---|---|:--:|:--:|:--:|---|
| **R-S01** | Accès croisé entre élèves | Critique | Moyenne | **🔴 Majeur** | double barrière + 18 tests d'autorisation bloquants |
| **R-S02** | Fuite de réponse avant soumission | Critique | Élevée | **🔴 Majeur** | filtrage au repository + test de payload |
| **R-S03** | Falsification de `user_id` en synchronisation | Critique | Élevée | **🔴 Majeur** | `user_id` de session imposé + rejet du lot mixte |
| **R-S04** | Secret d'infrastructure exposé | Critique | Moyenne | **🔴 Majeur** | `.gitignore` **avant** tout `npm install` · scan de secrets en CI · scan du bundle |
| **R-S05** | Accès parent sans lien actif | Critique | Moyenne | **🔴 Majeur** | `requireActiveParentLink` systématique + tests T-03/04/05 |
| **R-S06** | Prise de contrôle de compte élève | Élevée | Moyenne | 🟠 Élevé | Argon2id · limitation de débit · sessions en base · révocation totale au changement de mot de passe |
| **R-S07** | Upload malveillant vers R2 | Élevée | Moyenne | 🟠 Élevé | liste blanche MIME sur octets réels · plafond de taille · bucket privé |
| **R-S08** | Injection SQL | Critique | Faible | 🟠 Élevé | requêtes paramétrées · interdiction de `sql.raw` avec entrée utilisateur |
| **R-S09** | Abus de privilège admin | Élevée | Faible | 🟡 Moyen | audit append-only · principe du moindre privilège · revue des accès |
| **R-S10** | Dépendance vulnérable | Moyenne | Élevée | 🟡 Moyen | `npm audit` en CI · Dependabot · politique d'ajout de bibliothèque |
| **R-S11** | Fuite par journaux applicatifs | Moyenne | Moyenne | 🟡 Moyen | liste noire de champs dans le logger · aucune réponse d'élève journalisée |
| **R-S12** | Perte de données par migration destructive | Élevée | Faible | 🟡 Moyen | revue obligatoire · sauvegarde préalable · migration en trois temps |

---

## 4. Mesures par domaine

### 4.1 Authentification

| Mesure | Détail |
|---|---|
| Hachage | **Argon2id**, paramètres à jour. Jamais MD5, SHA-1, ni SHA-256 nu. |
| Mot de passe | 10 caractères minimum, vérifié contre une liste de mots de passe compromis courants. Pas de règle de complexité arbitraire (elle produit `Password1!`). |
| Sessions | stratégie **`database`**, cookie `HttpOnly` + `Secure` + `SameSite=Lax`. |
| Expiration | 30 jours d'inactivité, prolongation glissante. |
| Révocation | changement de mot de passe ⇒ **toutes** les sessions supprimées. |
| Jetons | hachés en base, usage unique, expiration (24 h vérification, 1 h réinitialisation), `purpose` distinct. |
| Réponses uniformes | inscription et réinitialisation renvoient le même message que l'e-mail existe ou non. |
| Limitation de débit | connexion : 5 essais / 15 min par compte **et** par IP. Réinitialisation : 3 / heure. |

### 4.2 Autorisation

Voir `AUTHORIZATION_MATRIX.md`. Points de sécurité :

- Six contrôles obligatoires, dans l'ordre, avant toute action.
- **Double barrière** : garde applicative **et** clause d'appartenance SQL.
- 404 uniforme sur les ressources d'autrui.
- 18 tests d'autorisation bloquants.

### 4.3 Validation des entrées

| Règle | Détail |
|---|---|
| Zod partout | tout payload de Server Action et de Route Handler est parsé avant usage. |
| Rejet, pas nettoyage | une entrée invalide est **rejetée**, jamais « corrigée » silencieusement. |
| Schémas partagés | `lib/validation/` sert client (retour immédiat) **et** serveur (autorité). La validation client est un confort, jamais une protection. |
| Plafonds | longueur maximale sur tout champ texte. Un énoncé de 10 Mo est une attaque. |
| Types stricts | `z.string().uuid()` pour tout identifiant. Un identifiant non conforme est rejeté avant d'atteindre la base. |

### 4.4 Sécurité SQL

| Règle | Détail |
|---|---|
| Requêtes paramétrées | **exclusivement**. Aucune concaténation de chaîne avec une entrée utilisateur. |
| `sql.raw` | interdit avec toute donnée d'origine utilisateur. Autorisé uniquement sur des littéraux constants, avec justification en revue. |
| Ne pas se fier à l'ORM | Drizzle paramètre par défaut, mais `sql` template avec interpolation naïve reste vulnérable. La revue vérifie chaque usage. |
| Contraintes en base | clés étrangères, `check`, `unique` : la base est la dernière ligne de défense contre une donnée incohérente. |
| Moindre privilège | le rôle applicatif ne dispose **pas** de `DROP`, `CREATE ROLE`, ni `SUPERUSER`. Les migrations utilisent un rôle distinct sur la connexion directe. |
| Transactions | toute opération multi-étapes critique. Une transaction interrompue ne laisse pas d'état partiel. |

### 4.5 Uploads et stockage (R2)

| Contrôle | Détail |
|---|---|
| Bucket | privé, aucun accès anonyme, testé explicitement |
| URL présignée | émise **après** les six contrôles d'autorisation. Lecture 5 min, écriture 10 min. |
| MIME | liste blanche vérifiée sur les **octets réels** (nombre magique), pas sur l'en-tête déclaré |
| SVG | désinfecté ou refusé — un SVG peut contenir du JavaScript |
| Taille | plafond à la génération de l'URL **et** revérifié à la finalisation |
| Nom de fichier | **jamais** celui fourni par l'utilisateur. Clé générée : `{env}/{entité}/{uuid}/{slug}.{ext}` |
| Traversée de chemin | impossible par construction (la clé est générée serveur) |
| CORS | restreint à `NEXT_PUBLIC_APP_URL`. Jamais `*`. |
| Orphelins | tout objet sans ligne `file_assets` en statut `ready` est purgé |

### 4.6 Secrets

| Règle | Détail |
|---|---|
| `.gitignore` | **créé avant la première commande `npm install`.** Le dépôt n'en a aucun aujourd'hui — c'est la première action de la Phase 2. |
| Portée | secrets exclusivement serveur. Une seule variable `NEXT_PUBLIC_`. |
| Bundle | test de CI qui échoue si un secret apparaît dans le bundle client. |
| Scan | détection de secrets en CI sur chaque *pull request* et sur l'historique. |
| Rotation | procédure documentée pour `AUTH_SECRET`, clés R2 et identifiants Neon. |
| Journaux | liste noire de champs (`password`, `token`, `secret`, `authorization`, `correct_answer`) filtrés avant écriture. |

### 4.7 En-têtes HTTP

| En-tête | Valeur |
|---|---|
| `Content-Security-Policy` | restrictive, sans `unsafe-inline` sur les scripts (nonce si nécessaire) |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | caméra, micro, géolocalisation désactivés (aucun besoin MVP) |

### 4.8 Protection des mineurs

| Mesure | Détail |
|---|---|
| Minimisation | seule l'**année** de naissance est collectée, pas la date complète. Ni adresse, ni téléphone de l'élève, ni photo. |
| Consentement parental | double consentement pour tout lien de suivi. |
| Contrôle par l'élève | l'élève révoque un lien parent sans l'accord du parent. |
| Pas de communication entre élèves | aucune messagerie, aucun profil public, aucune fonction sociale — **choix de sécurité autant que de périmètre**. |
| Suppression | l'élève peut supprimer son compte ; le traitement des données produites suit DM-Q1. |
| Journaux | aucune donnée identifiante dans `application_events`. |

> Le cadre juridique applicable en Côte d'Ivoire (loi sur la protection des données à caractère personnel, autorité compétente, âge du consentement numérique) **n'a pas été vérifié**. Enregistré en **OQ-05**. Les mesures ci-dessus relèvent de bonnes pratiques, pas d'une conformité établie.

---

## 5. Checklist OWASP Top 10 (2021)

| # | Catégorie | Traitement Savoir+ | Statut |
|---|---|---|:--:|
| A01 | Broken Access Control | double barrière, 6 contrôles, 18 tests bloquants, 404 uniforme | 📋 planifié |
| A02 | Cryptographic Failures | Argon2id, jetons hachés, HTTPS strict, R2 privé | 📋 planifié |
| A03 | Injection | requêtes paramétrées, Zod, échappement React par défaut | 📋 planifié |
| A04 | Insecure Design | threat model **avant** le code, protocole de correction verrouillé serveur | ✅ ce document |
| A05 | Security Misconfiguration | en-têtes, CORS restreint, moindre privilège base, pas de valeur par défaut permissive | 📋 planifié |
| A06 | Vulnerable Components | `npm audit` en CI, Dependabot, politique d'ajout de bibliothèque | 📋 planifié |
| A07 | Auth Failures | limitation de débit, sessions en base, révocation, réponses uniformes | 📋 planifié |
| A08 | Data Integrity | migrations versionnées et revues, idempotence, contraintes base | 📋 planifié |
| A09 | Logging Failures | `audit_logs` append-only, journal structuré, alerte sur accès croisé détecté | 📋 planifié |
| A10 | SSRF | aucune requête sortante pilotée par l'utilisateur en MVP | ✅ sans objet |

> Aucun élément n'est marqué « fait ». **Aucune mesure de sécurité n'a été implémentée** — ce document est un plan, pas un rapport de conformité.

---

## 6. Revue des dépendances

Politique d'ajout d'une bibliothèque :

| Critère | Exigence |
|---|---|
| Justification | écrite dans `DECISIONS.md` |
| Alternative native | démontrée insuffisante |
| Maintenance | commit dans les 12 derniers mois |
| Surface | pas de dépendance transitive massive pour une fonction triviale |
| Vulnérabilités | zéro vulnérabilité critique ou élevée connue |
| Licence | compatible avec l'usage prévu |

Les dépendances imposées par le cahier des charges (Next.js, React, Drizzle, Auth.js, Zod, TanStack Query, React Hook Form, Tailwind, shadcn/ui, Vitest, Playwright) sont réputées justifiées.

---

## 7. Réponse à incident

| Étape | Action |
|---|---|
| **Détection** | alerte sur : pic de 403/404, accès croisé détecté, pic d'opérations `failed` en synchronisation, échec du scan de secrets |
| **Confinement** | révocation des sessions concernées · rotation du secret compromis · désactivation du compte fautif |
| **Évaluation** | consultation de `audit_logs` : quelles données, quels utilisateurs, sur quelle période |
| **Notification** | si des données de mineurs sont concernées, notification aux familles — **délai et autorité à confirmer, OQ-05** |
| **Correction** | correctif + **test de non-régression obligatoire** reproduisant l'incident |
| **Bilan** | consigné dans `DECISIONS.md` |

---

## 8. Rapport de sécurité — état à la Phase 0

| Contrôle | Résultat |
|---|---|
| Threat model produit | ✅ |
| Actifs identifiés | ✅ 7 |
| Risques majeurs identifiés | ✅ 5 (R-S01 à R-S05) |
| Mesures implémentées | **❌ aucune — aucun code n'existe** |
| Secrets committés dans le dépôt | ✅ aucun secret privé trouvé |
| `.gitignore` présent | **❌ absent — action prioritaire** |
| Scan de dépendances | ✅ sans objet (aucune dépendance déclarée) |
| CI de sécurité | **❌ absente** |

**Verdict Phase 0 : APPROUVÉ AVEC RÉSERVES.** La réserve principale est l'absence de `.gitignore`, à corriger impérativement avant la première installation de dépendances.

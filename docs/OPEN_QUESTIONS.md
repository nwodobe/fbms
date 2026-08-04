# Savoir+ — Questions ouvertes et décisions humaines requises

> Agent responsable : **Product Manager** (arbitrage), **CTO** (escalade)
> Version : 0.1.0 — 2026-08-03

Chaque question indique **ce qu'elle bloque**, **ce qui se passe sans réponse**, et **la réponse par défaut** appliquée si aucune décision n'est prise.

---

## 🔴 Bloquantes — réponse nécessaire avant la Phase 2

### OQ-01 — Où vit le code de Savoir+ ?

**Contexte.** Le dépôt `nwodobe/fbms` héberge l'application ANAGROCI FBMS : site statique, GitHub Pages depuis la racine, base Supabase. Savoir+ est un produit sans lien métier, sur une stack incompatible (Next.js, Neon, Drizzle). Voir `PHASE0_INSPECTION.md` §3 (INC-01 à INC-05) et `DECISIONS.md` ADR-001.

**Options.**

| # | Option | Recommandation |
|---|---|---|
| **A** | **Dépôt dédié `savoir-plus`** | ✅ **recommandée** — séparation nette, structure §9 littérale, CI et secrets propres, aucun risque pour FBMS |
| **B** | Sous-répertoire `savoir-plus/` dans `fbms` | acceptable en transition — impose une portée de service worker distincte et une CI filtrée par chemin |
| **C** | Next.js à la racine de `fbms` | ❌ **écartée** — casse le déploiement GitHub Pages de FBMS |

**Bloque :** absolument tout le développement.
**Sans réponse :** aucun code n'est écrit. Les 15 documents restent valables et transférables tels quels vers A ou B.
**Défaut appliqué :** option B, documentée comme provisoire (HYP-01).

---

### OQ-02 — Qui valide la conformité au programme ivoirien de Seconde C ?

**Contexte.** Les 3 chapitres, 12 compétences et l'ensemble du contenu proposés dans `PEDAGOGY.md` sont construits sur des connaissances générales du niveau Seconde. **Ils n'ont pas été vérifiés contre le programme officiel du Ministère de l'Éducation Nationale et de l'Alphabétisation de Côte d'Ivoire.**

**Ce qui est demandé :**
1. le **document officiel** du programme de mathématiques de Seconde C ;
2. l'identification d'un **enseignant ivoirien de mathématiques exerçant en Seconde**, mandaté pour valider le contenu ;
3. la position sur la mention « conforme au programme officiel » — l'utiliser exige une autorisation, pas seulement une vérification.

**Bloque :** la publication de tout contenu (Phase 6), et donc toute mise en service publique.
**Sans réponse :** le contenu reste au statut `draft` avec la mention « Contenu provisoire — en attente de validation ». Le produit est développable et testable, mais **non publiable**.
**Risque associé :** R-E01 et R-J05, cotés critiques. Présenter un contenu non validé comme officiel à des élèves préparant un examen national est le risque le plus dommageable du projet.
**Défaut appliqué :** statut `draft`, avertissement affiché, aucune revendication de conformité.

---

### OQ-03 — Qui produit et vérifie les 45 exercices ?

**Contexte.** Le MVP exige 12 leçons, 45 exercices (chacun avec énoncé, réponse attendue, tolérances, 2 indices gradués, solution détaillée), 20 questions de diagnostic et 3 évaluations. C'est un travail de rédaction humaine, pas une génération.

**Ce qui est demandé :** qui rédige, qui vérifie mathématiquement, selon quel calendrier.

**Bloque :** D-09 (`seed:reference`), donc les Phases 5, 6 et 7.
**Sans réponse :** un jeu réduit mais **réel et vérifié** est produit (≈ 12 exercices, 1 par compétence) pour permettre le développement et les tests. Le MVP reste incomplet.
**Risque associé :** R-J04 — sous-estimation systématique de cette charge.
**Défaut appliqué :** jeu réduit, clairement identifié comme incomplet dans les rapports de phase.

---

## 🟠 Importantes — réponse nécessaire avant la Phase 3

### OQ-04 — Où l'application est-elle hébergée ?

Options : Vercel (intégration native Next.js, branches de preview) · Cloudflare Pages/Workers (cohérent avec R2) · autre.
**Bloque :** X-05, la configuration des environnements et le format des secrets.
**Défaut appliqué :** conception agnostique ; aucune dépendance à une fonctionnalité propriétaire d'un hébergeur.

---

### OQ-05 — Quel est le cadre juridique applicable aux données de mineurs en Côte d'Ivoire ?

**Contexte.** Les utilisateurs sont des lycéens de 15 à 17 ans. La loi ivoirienne sur la protection des données à caractère personnel, l'autorité de contrôle compétente, l'âge du consentement numérique, l'obligation de consentement parental et les délais de notification en cas de violation **n'ont pas été vérifiés**.

**Ce qui est demandé :** un avis juridique sur le cadre applicable, le consentement parental exigible, la durée de rétention autorisée et l'obligation de notification.

**Bloque :** la mise en service publique. Ne bloque pas le développement.
**Risque associé :** R-C01, coté critique — non atténuable par le code.
**Défaut appliqué :** minimisation maximale des données (année de naissance seule, ni adresse, ni téléphone de l'élève, ni photo), double consentement, révocation par l'élève. Ces mesures sont de bonnes pratiques, **elles ne constituent pas une conformité établie**.

---

### OQ-06 — Quel plan Neon, et quelle fenêtre de restauration ?

**Ce qui est demandé :** le plan retenu, la fenêtre de *point-in-time restore* associée, le nombre de branches autorisées (une par environnement + une par PR de preview), les limites de calcul et de connexions.
**Bloque :** D-13 (stratégie de sauvegarde) et X-05.
**Défaut appliqué :** on ne compte pas sur le PITR seul. Export logique quotidien chiffré vers R2, rétention 30 jours, avec restauration testée avant la mise en service.

---

### OQ-07 — Quel outil de supervision des erreurs ?

Options : Sentry · alternative · journaux de l'hébergeur uniquement.
**Bloque :** X-08 et la stratégie d'observabilité complète.
**Défaut appliqué :** journal structuré JSON + `audit_logs` + `application_events`. Suffisant pour diagnostiquer, insuffisant pour alerter en temps réel.

---

### OQ-08 — Quel fournisseur d'envoi d'e-mails ?

**Contexte.** Vérification d'adresse, réinitialisation de mot de passe, magic link, rapport hebdomadaire parent. La délivrabilité vers les boîtes utilisées en Côte d'Ivoire (Gmail majoritairement) est le critère déterminant.
**Bloque :** A-03, A-04, A-05, PA-03.
**Défaut appliqué :** interface d'envoi abstraite dans `server/services/email.service.ts`, avec une implémentation de journalisation en développement. Le fournisseur est branché plus tard sans modification du code appelant.

---

## 🟡 À trancher avant la phase concernée

### OQ-09 — Comment rendre les expressions mathématiques ?

| Option | Poids | Qualité | Accessibilité |
|---|---|---|---|
| KaTeX | ≈ 250 Ko | excellente | bonne |
| MathML natif | 0 Ko | variable selon le navigateur | excellente |
| Images pré-rendues | par expression | figée | nécessite un texte alternatif |
| HTML/CSS simple | 0 Ko | limitée aux expressions élémentaires | excellente |

**Contexte :** le contenu MVP (relatifs, fractions, calcul littéral, équations du premier degré) est majoritairement rendable en HTML/CSS. Les fractions et les exposants sont les seuls cas non triviaux.
**Bloque :** L-02 (Phase 6).
**Risque associé :** R-T11 — 250 Ko sur données prépayées est un coût réel.
**Défaut appliqué :** HTML/CSS pour les cas simples, KaTeX chargé à la demande uniquement sur les pages qui en ont besoin.

---

### OQ-10 — Que devient un compte élève supprimé ?

Options : effacement total · anonymisation avec conservation des statistiques agrégées · conservation limitée dans le temps.
**Lié à :** DM-Q1, DM-Q2, OQ-05, ADR-019.
**Bloque :** la politique de rétention (Phase 2).
**Défaut appliqué :** `status = 'deleted'`, sessions supprimées, données conservées jusqu'à arbitrage. **À trancher avant toute mise en service.**

---

### OQ-11 — Les seuils de maîtrise sont-ils les bons ?

80 % / 50 % et la fenêtre glissante de 10 mesures sont des conventions de conception, non calibrées sur des lycéens ivoiriens.
**Bloque :** rien — paramétrable.
**Défaut appliqué :** valeurs du cahier des charges, exposées en configuration, à réévaluer sur données réelles.

---

### OQ-12 — L'espace parent doit-il être un compte séparé ?

**Contexte.** Certaines familles partagent un seul téléphone. Un compte parent distinct impose une seconde inscription, une seconde boîte mail.
Options : compte séparé (retenu) · code de consultation sans compte · basculement de mode dans l'application élève.
**Bloque :** PA-01 et le parcours d'invitation.
**Défaut appliqué :** compte séparé — c'est ce qui rend possible le double consentement et la révocation, deux exigences du cahier des charges.

---

## Questions techniques mineures

| # | Question | Impact | Défaut |
|---|---|---|---|
| DM-Q1 | Anonymiser ou effacer les tentatives d'un compte supprimé ? | conformité | conservation jusqu'à arbitrage |
| DM-Q2 | Rétention de `audit_logs` et `application_events` ? | volume, conformité | 12 mois |
| DM-Q3 | Table par type d'exercice plutôt qu'un `jsonb` polymorphe ? | rigueur du typage | `jsonb` + validation Zod par type |
| DM-Q4 | Pondérer les mesures récentes à l'intérieur de la fenêtre ? | pédagogie | pas de pondération en MVP |
| OQ-13 | Version minimale d'Android et de navigateur supportée ? | compatibilité | Chrome ≥ 100, Android ≥ 8 |
| OQ-14 | Le produit sera-t-il proposé en langue locale ? | i18n | français uniquement en MVP, structure i18n prévue |

---

## Récapitulatif des décisions humaines attendues

| # | Décision | Urgence | Bloque |
|---|---|---|---|
| **OQ-01** | Localisation du code | **immédiate** | tout le développement |
| **OQ-02** | Validation du programme ivoirien | **immédiate** | publication du contenu |
| **OQ-03** | Production des 45 exercices | **immédiate** | Phases 5, 6, 7 |
| OQ-04 | Hébergeur | avant Phase 3 | environnements |
| OQ-05 | Cadre juridique (mineurs) | avant mise en service | conformité |
| OQ-06 | Plan Neon et sauvegardes | avant Phase 3 | restauration |
| OQ-08 | Fournisseur d'e-mails | avant Phase 3 | vérification, récupération |

**Les trois premières sont attendues pour que la Phase 1 puisse démarrer.**

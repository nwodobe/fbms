# Savoir+ — Journal des modifications

> Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
> Versionnage sémantique. Le produit n'est pas encore publié : la version reste en `0.x`.

---

## [Non publié]

### 0.1.0 — 2026-08-03 — Phase 0 : inspection et cadrage documentaire

**Portée :** documentation uniquement. **Aucun code applicatif, aucune migration, aucune dépendance n'a été ajoutée.**

#### Ajouté

| Document | Agent responsable | Contenu |
|---|---|---|
| `docs/PHASE0_INSPECTION.md` | Software Architect, DevOps, Security | état des lieux factuel du dépôt · 8 incompatibilités identifiées · 4 observations de sécurité sur l'existant |
| `docs/PRODUCT_BRIEF.md` | Product Manager | vision · 3 personas · jobs-to-be-done · périmètre et hors-périmètre · 20 user stories avec critères d'acceptation testables · indicateurs de succès |
| `docs/ARCHITECTURE.md` | Software Architect | 8 principes directeurs · vue en couches · frontières de modules · flux de la soumission de tentative · stratégies Neon, Auth, R2, erreurs, cache, observabilité |
| `docs/DATA_MODEL.md` | Neon Database Architect | 37 tables · conventions · index justifiés · transactions obligatoires · liste des données interdites au navigateur · ERD · stratégie de migration et de seed |
| `docs/PEDAGOGY.md` | Expert pédagogique | **avertissement de non-validation du programme ivoirien** · 12 compétences et graphe de prérequis · règles de diagnostic, de scoring, de maîtrise · 10 catégories d'erreurs · protocole de correction en 9 étapes · répétition espacée |
| `docs/UX_FLOWS.md` | UX Researcher, UI Designer | contraintes d'usage réel · arborescence · parcours élève et parent · comportement hors ligne · 10 points de friction · design system · accessibilité |
| `docs/AUTHORIZATION_MATRIX.md` | Auth & Authz Engineer | distinction authentification/autorisation · 6 contrôles obligatoires · matrice complète par rôle et ressource · 9 gardes serveur · 18 tests d'autorisation bloquants · procédure de révocation |
| `docs/SECURITY.md` | Security Engineer | threat model STRIDE · 7 actifs · 5 acteurs de menace · 12 risques cotés · mesures par domaine · checklist OWASP · protection des mineurs · réponse à incident |
| `docs/OFFLINE_SYNC.md` | Offline & Sync Engineer | 6 principes · 8 magasins IndexedDB · modèle d'opération complet · moteur de synchronisation · 7 cas de conflit · 7 garanties avec preuves exigées |
| `docs/TEST_STRATEGY.md` | QA Engineer | pyramide de tests · outillage · ~250 tests unitaires détaillés · 19 tests d'intégration · 15 parcours E2E · 10 contrôles de contenu · CI en 10 étapes · définition de « terminé » |
| `docs/DECISIONS.md` | Software Architect | 14 ADR proposés · 5 décisions en attente |
| `docs/RISKS.md` | tous | 7 risques produit · 7 pédagogiques · 11 techniques · 5 sécurité · 4 conformité · 5 projet · top 5 prioritaire |
| `docs/BACKLOG.md` | Product Manager | 14 lots · ~110 éléments priorisés avec dépendances et portes de sortie · ordonnancement conseillé |
| `docs/OPEN_QUESTIONS.md` | Product Manager | 3 questions bloquantes · 5 importantes · 4 à trancher · 6 mineures · comportement par défaut pour chacune |
| `docs/CHANGELOG.md` | Technical Writer | ce document |

#### Constaté

- Le dépôt `nwodobe/fbms` héberge **ANAGROCI FBMS**, application agro-industrielle statique (HTML/JS + Supabase, GitHub Pages), sans lien avec Savoir+.
- Aucun `package.json`, aucun build, aucun test, aucune CI, **aucun `.gitignore`**.
- Aucun secret privé committé. La clé publique Supabase présente est publiable par conception (sécurité portée par la RLS).
- La stack imposée pour Savoir+ (Next.js, Neon, Drizzle, Auth.js, R2) est **incompatible** avec l'existant. Trois incompatibilités critiques : produit différent, base différente, conflit de racine de déploiement.

#### Décidé (proposé, non ratifié)

14 ADR, dont : sessions Auth.js **en base de données** et non JWT (révocation immédiate exigée) · contenu **versionné** · scoring **exclusivement serveur** · idempotence par clé générée à la **création de l'intention** · autorisation à **double barrière** (absence de RLS sur Neon) · **404 plutôt que 403** sur les ressources d'autrui · une transaction **par opération** de synchronisation.

#### Non fait — volontairement

Conformément à la consigne « ne commence pas le développement métier » :

- aucune page, aucun composant, aucun écran ;
- aucun schéma Drizzle, aucune migration, aucun seed ;
- aucune Server Action, aucun Route Handler, aucun service ;
- aucune installation de dépendance ;
- aucun diagnostic, cours, exercice, carnet d'erreurs ni tableau de bord.

#### Bloquant

Trois décisions humaines sont requises avant la Phase 1 :

| # | Question |
|---|---|
| **OQ-01** | Où vit le code de Savoir+ : dépôt dédié (recommandé) ou sous-répertoire de `fbms` ? |
| **OQ-02** | Qui valide la conformité du contenu au programme ivoirien de Seconde C ? |
| **OQ-03** | Qui produit et vérifie les 45 exercices du MVP ? |

---

## Conventions de ce journal

- Une entrée par phase livrée.
- Sections : `Ajouté` · `Modifié` · `Corrigé` · `Supprimé` · `Sécurité` · `Migrations` · `Non fait`.
- Toute migration de base de données est listée explicitement avec son identifiant.
- Toute décision d'architecture renvoie à son ADR.
- **Aucune fonctionnalité n'est inscrite comme livrée sans la preuve de test correspondante** dans le rapport de phase.

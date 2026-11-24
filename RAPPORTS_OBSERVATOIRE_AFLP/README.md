# RAPPORTS_OBSERVATOIRE_AFLP

Générateur du rapport hebdomadaire de Direction de l'Observatoire agronomique AFLP 2027 (option B : extraction
en lecture seule, calculs testés, génération locale PDF / Excel / Outlook).

> Ce dossier est servi publiquement par GitHub Pages comme le reste du dépôt. Il ne contient que du code, de la
> documentation et des données de test fictives. Les rapports produits restent dans `sorties/`, exclu du dépôt.

| Fichier | Rôle |
|---|---|
| `generer_rapport.py`, `lancer_rapport_lundi.bat` | Lancement hebdomadaire |
| `generateur/` | extraction (lecture seule), moteur de calcul, recommandations, rédaction par gabarits, rendu |
| `tests/test_moteur.py` | 15 tests de non-régression (12 cas du mandat + 3) |
| `DICTIONNAIRE_KPI.md` | Définitions et règles |
| `AUDIT_SOURCES.md` | Inventaire des données réellement disponibles au 22/11/2026 |
| `METHODOLOGIE_REPORTING.md` | Procédure reproductible, gel, circuit de validation |
| `TESTS_ET_PREUVES.md` | Commandes, résultats, limites |
| `ROADMAP_INTELLIGENCE_AGRICOLE.md` | Trois niveaux |
| `PROPOSITION_INTEGRATION_FBMS.md` | Options A/B/C, conception de l'intégration, revue contradictoire |

Démarrage : voir `METHODOLOGIE_REPORTING.md` §2.

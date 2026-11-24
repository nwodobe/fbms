# AFLP_MARKET_INTELLIGENCE : Intelligence marché AFLP

MVP de veille commerciale hebdomadaire sur l'anacarde (Zone Centre, six clusters AFLP), complémentaire de
l'Observatoire agronomique. Dossier servi publiquement comme le reste du dépôt : code, documentation et tests fictifs
uniquement ; la base de collecte et les rapports restent dans `sorties/` (exclu du dépôt).

| Livrable | Fichier |
|---|---|
| 1. Audit des sources | `AUDIT_SOURCES.md` |
| 2. Protocole et calendrier | `PLAN_ENQUETE_MARCHE.md` |
| 3. Questionnaires terrain | `QUESTIONNAIRES_TERRAIN/` (+ `QUESTIONNAIRES_TERRAIN.pdf` imprimable, généré) |
| 4. Indicateurs | `DICTIONNAIRE_KPI.md` |
| 5. Registre CCAK | `REGISTRE_VEILLE_CCAK.xlsx` (généré depuis `veille/sources_publiques.py`) |
| 6. Base de veille | `BASE_VEILLE_MARCHE.xlsx` (générée, vide de toute donnée fictive) |
| 7. Rapport hebdomadaire | `RAPPORT_MARCHE_HEBDO_<semaine>.pdf` (généré) |
| 8. Brouillon Outlook | `OUTLOOK_DIRECTION_<semaine>.txt` (généré, jamais envoyé) |
| 9. Angles morts | `MATRICE_RISQUES.md` |
| 10. Intégration | `PLAN_INTEGRATION_FBMS.md` |

```bash
python -m unittest discover -s tests -v
python generer_rapport_marche.py --semaine 2026-W48 --villages sorties/villages.json \
  --observatoire ../RAPPORTS_OBSERVATOIRE_AFLP/sorties/RESULTATS_2026-W48.json --operationnel sorties/operationnel.json
```

Prérequis : Python 3.10+, `pip install reportlab openpyxl`.

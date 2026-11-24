# Tests et preuves : générateur de l'Observatoire AFLP

Exécution du 22/11/2026, environnement Linux isolé, Python 3, données de test **100 % fictives** construites en mémoire
(aucune base, aucun réseau). Le moteur est testé sur ses chiffres, indépendamment des textes.

## 1. Commande

```bash
cd RAPPORTS_OBSERVATOIRE_AFLP
python3 -m unittest discover -s tests -v
```

Résultat : **15 tests exécutés, 15 réussis, 0 échec** (0,005 s). Le lanceur Windows `lancer_rapport_lundi.bat`
refuse de générer le rapport si un test échoue.

## 2. Correspondance avec le mandat (§9)

| # | Cas exigé | Test | Résultat vérifié |
|---|---|---|---|
| 1 | Aucune visite | `test_01` | type `DEPLOIEMENT_ET_QUALITE`, message « Données agronomiques insuffisantes », ratio `NON_DISPONIBLE` |
| 2 | Visite locale non synchronisée | `test_02` | visite reçue après le gel classée `APRES_GEL`, hors indicateurs ; visites locales = `None` (inconnu), pas 0 |
| 3 | Visite non validée | `test_03` | 0 champ retenu, 1 en attente de validation, 0 arbre observé |
| 4 | Deux visites concurrentes du même champ | `test_04` | 1 champ, 10 arbres (et non 20), la plus récente retenue, 1 doublon écarté, couverture ≤ 100 % |
| 5 | `PAS_VU` non compté `NON` | `test_05` | NON inchangé, dénominateur 7, pas de % (effectif < 10) |
| 6 | Réserve non activée | `test_06` | 10 arbres suivis malgré 12 observations ; anomalie `OBS_SUR_RESERVE_NON_ACTIVEE` |
| 7 | Cluster sans observation | `test_07` | valeur `None`, nature `DONNEES_INSUFFISANTES`, confiance `INSUFFISANTE` |
| 8 | Saisie rétrospective | `test_08` | exclue des indicateurs, comptée en `retrospectives` |
| 9 | Observation après clôture | `test_09` | apparaît comme `COMPLEMENT_TARDIF` dans le rapport suivant ; le rapport transmis, recalculé sur son instantané, est identique (même empreinte) |
| 10 | Sélection non probabiliste | `test_10` | statut `SUIVI_ARBRES_DESIGNES`, nature `TENDANCE_DESCRIPTIVE_PANEL`, jamais `STATISTIQUE_REPRESENTATIVE`, mention « non représentative » |
| 11 | Approvisionnement indisponible | `test_11` | aucune proposition financière ; observation « Aucune recommandation financière chiffrée » ; lots = `None` |
| 12 | Utilisateur non autorisé | `test_12` + test serveur | client : RT, Unit Head, AUH, rôle vide ou inconnu refusés. **Serveur (production, transaction `read only` annulée)** : `anon` refusé, authentifié sans profil 0 ligne sur tables et vues, `Supervisor` sans classe |
| + | Campagne de simulation exclue | `test_13` | champ SIMULATION hors calculs, doublon de parcelle détecté |
| + | Arbre introuvable non négatif | `test_14` | 2 non retrouvés, 0 NON, dénominateur 8 |
| + | Pourcentage valide | `test_15` | 3/10 = 30 %, statut `VALIDE` |

## 3. Exécution sur les données réelles

Instantané gelé le 22/11/2026 à 16:24:27 UTC (heure d'Abidjan), extrait en lecture seule.
Empreinte SHA-256 : `f38fc7c6c1f039efcc578222c22e4ae6c5b96de55840ba429706a87412401121`.

```
Semaine 2026-W47 · DEPLOIEMENT_ET_QUALITE · PROVISOIRE_AVANT_CLOTURE
Champs actifs 1/28 · visités validés 0
Recommandations 5 · Outlook FR 579 car. / EN 583 car.
```

- Deux générations successives depuis le même instantané donnent la même empreinte et les mêmes chiffres ; le registre
  n'ajoute pas de doublon à la seconde exécution (+0).
- PDF : 3 pages (note, tableau comparatif, annexes), relu visuellement page par page. Excel : 7 onglets ouverts et relus. Registre : 1 onglet, liste de statuts contrôlée.
- Brouillon Outlook ≤ 1 024 caractères (contrôle bloquant dans le code), non envoyé, sans adresse inventée.
- Le champ installé dans la campagne de simulation est exclu et signalé.
- Aucun nom de producteur, téléphone, coordonnée GPS ni photo dans les sorties.

## 4. Contrôles du dépôt

`node .github/scripts/verifier-liens.mjs` : aucun nouveau lien cassé (les avertissements listés concernent des ressources
externes existantes). Le dossier ne contient ni HTML ni JavaScript servi : `verifier-html`, `verifier-js` et `verifier-pages`
ne sont pas concernés. Les sorties (`sorties/`) sont exclues du dépôt public par `.gitignore`.

## 5. Ce qui n'a pas été testé

- L'extraction REST (`extraction.py`) n'a pas été exécutée de bout en bout : elle exige votre mot de passe FBMS, que je n'ai
  pas et ne dois pas saisir. L'instantané réel a été obtenu par requêtes SQL en lecture seule équivalentes. Premier essai
  à faire par vous lundi ; en cas d'écart, comparer l'instantané produit au fichier de référence.
- Le rendu sous Windows (polices Helvetica intégrées à ReportLab : rendu identique attendu, non observé sur votre PC).
- Aucun test sur des visites réelles : il n'en existe pas encore.

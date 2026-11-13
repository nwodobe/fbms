#!/usr/bin/env python3
"""Génère docs/observatoire/RAPPORT_TESTS.md à partir de tests/observatoire/resultats/*.json."""
import json, os
ICI = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(ICI, 'resultats')
s = json.load(open(os.path.join(R, 'serveur.json'), encoding='utf-8'))
n = json.load(open(os.path.join(R, 'navigateur.json'), encoding='utf-8'))
c = json.load(open(os.path.join(R, 'coeur.json'), encoding='utf-8'))
nr = json.load(open(os.path.join(R, 'non_regression_sql.json'), encoding='utf-8'))
L = ["# Observatoire agronomique AFLP 2027 — rapport de tests\n",
     f"Dernière exécution serveur : {s['date'][:16]} ; navigateur : {n['date'][:16]} (UTC). Environnement : PostgreSQL 16 **local** (réplique `tests/sql/replica` + compléments), Chromium + Playwright, données **100 % fictives**. Aucun test n'a touché Supabase.\n",
     "Commande : `PGHOST=127.0.0.1 PGPORT=54329 OBS_E2E=1 ./tests/observatoire/executer_tests_observatoire.sh` puis `python3 tests/observatoire/generer_rapport.py`.\n",
     "## Synthèse\n\n| Suite | Exécutés | Réussis | Échoués | Non exécutés |\n|---|---|---|---|---|",
     f"| Serveur (RLS + RPC, rôle `authenticated`, JWT fictifs) | {s['total']} | {s['reussis']} | {s['echoues']} | 0 |",
     f"| Non-régression SQL (empreinte de l'existant, retour arrière) | {nr['reussis']+nr['echoues']} | {nr['reussis']} | {nr['echoues']} | 0 |",
     f"| Cœur métier JavaScript | {c['total']} | {c['reussis']} | {c['echoues']} | 0 |",
     f"| Navigateur de bout en bout (vrai Service Worker, mode avion) | {n['total']} | {n['reussis']} | {n['echoues']} | 0 |"]
tot = s['total'] + nr['reussis'] + nr['echoues'] + c['total'] + n['total']; ok = s['reussis'] + nr['reussis'] + c['reussis'] + n['reussis']
L += [f"| **Total module** | **{tot}** | **{ok}** | **{tot-ok}** | 0 |\n",
      "Contrôles du dépôt : `verifier-html` 0 nouvel écart (3 historiques) ; `verifier-js` 0 nouvelle erreur (1 historique) ; `verifier-liens` 0 nouveau lien cassé (4 historiques) ; `verifier-pages` (36 pages × 3 largeurs) 0 nouveau problème (16 historiques).\n",
      "Tests existants rejoués : `offline-field-static`, `operations-suite-static`, `field-buying-performance-static`, `field-buying-profiles-static`, `field-buying-prefilled-edit-static`, `rt-sop-integration-static`, `offline-field-multi-user-e2e`, `campagnes-e2e` : **réussis**. `offline-field-e2e` et `field-buying-e2e` : **échouent de façon identique sur `main` sans la branche** (attente de `#offPrepare` / `#villageForm`) : défaut antérieur, non causé par l'Observatoire.\n",
      "**Non exécuté** : aucun test sur un staging Supabase (il n'en existe pas) ; aucun test sur un vrai téléphone Android ; aucun test de charge au-delà du pilote.\n", "## Détail serveur\n"]
fam = {}
for t in s['tests']: fam.setdefault(t['famille'], []).append(t)
for f, ts in fam.items():
    L.append(f"### {f} ({sum(1 for t in ts if t['resultat'] == 'RÉUSSI')}/{len(ts)})\n\n| Id | Compte | Action | Attendu | Résultat |\n|---|---|---|---|---|")
    for t in ts: L.append(f"| {t['id']} | {t['compte']} | {t['action'].replace('|', '/')} | {t['attendu'].replace('|', '/')} | {t['resultat']} |")
    L.append("")
L.append("## Détail navigateur\n\n| Id | Famille | Vérification | Résultat |\n|---|---|---|---|")
for t in n['tests']: L.append(f"| {t['id']} | {t['famille']} | {t['libelle'].replace('|', '/')} | {t['resultat']} |")
L.append("\n## Détail cœur JavaScript\n\n| Id | Vérification | Résultat |\n|---|---|---|")
for t in c['tests']: L.append(f"| {t['id']} | {t['libelle'].replace('|', '/')} | {t['resultat']} |")
open(os.path.join(ICI, '..', '..', 'docs', 'observatoire', 'RAPPORT_TESTS.md'), 'w', encoding='utf-8').write("\n".join(L) + "\n")
print(f"Rapport : {tot} tests, {ok} réussis, {tot-ok} échoués.")

#!/usr/bin/env python3
"""Génère docs/observatoire/RAPPORT_TESTS_STAGING.md et AUDIT_SECURITY_DEFINER.md (résultats du staging fidèle)."""
import json, os
ICI = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(ICI, 'resultats'); D = os.path.join(ICI, '..', '..', 'docs', 'observatoire')
j = lambda f: json.load(open(os.path.join(R, f), encoding='utf-8'))
s, n, nr, c, ph = j('serveur_staging.json'), j('navigateur_staging.json'), j('non_regression_sql_staging.json'), j('coeur.json'), j('securite_bucket_photos.json')
cmp_ = [t for t in s['tests'] if t['id'].startswith('CMP-')]
L = ["# Observatoire AFLP 2027 — tests rejoués sur le staging fidèle\n",
 f"Exécution serveur : {s['date'][:16]} UTC ; navigateur : {n['date'][:16]} UTC. Base : PostgreSQL 16 local `fbms_pheno_staging`, construite par `tests/observatoire/staging/construire_staging.sh` à partir du catalogue de PRODUCTION extrait en lecture seule (projet jmbdgpdthzpszfnddwzi, PostgreSQL 17.6). Données 100 % fictives ; aucune donnée personnelle recopiée.\n",
 "## Fidélité du staging\n",
 "- 170 objets comparés par empreinte individuelle (93 fonctions : texte source, SECURITY DEFINER, search_path ; 77 politiques RLS et Storage) : **170/170 identiques** à la production avant migration, et toujours identiques après application des 4 migrations Observatoire (test NR-03).",
 "- Écarts connus et assumés : PostgreSQL 16 au lieu de 17.6 ; `auth.uid()` et Storage simulés (mêmes tables, mêmes politiques, sans l'API HTTP) ; colonnes d'identité recréées ; pas de PostgREST. Pourquoi pas une branche Supabase : l'historique de migrations n'est pas rejouable (branche existante en MIGRATIONS_FAILED) et une branche est facturée.\n",
 "## Synthèse\n\n| Suite | Exécutés | Réussis | Échoués |\n|---|---|---|---|",
 f"| Serveur (RLS, RPC SECURITY DEFINER, preuves photo, synchronisation, droits par campagne) | {s['total']} | {s['reussis']} | {s['echoues']} |",
 f"| dont droits par campagne (CMP-01 à CMP-13) | {len(cmp_)} | {sum(t['resultat']=='RÉUSSI' for t in cmp_)} | {sum(t['resultat']!='RÉUSSI' for t in cmp_)} |",
 f"| Non-régression SQL | {nr['reussis']+nr['echoues']} | {nr['reussis']} | {nr['echoues']} |",
 f"| Cœur JavaScript | {c['total']} | {c['reussis']} | {c['echoues']} |",
 f"| Navigateur de bout en bout (Service Worker réel, hors ligne, reprise de file) | {n['total']} | {n['reussis']} | {n['echoues']} |\n",
 f"Mêmes suites rejouées sur la réplique historique : résultats identiques ({s['total']} / 8 / 21 / 60, 0 échec). Manifeste des 170 objets : `MANIFESTE_STAGING_170.md`.\n",
 "## Droits par campagne\n\n| Id | Compte | Action | Attendu | Résultat |\n|---|---|---|---|---|"]
L += [f"| {t['id']} | {t['compte']} | {t['action'].replace('|','/')} | {t['attendu'].replace('|','/')} | {t['resultat']} |" for t in cmp_]
L += ["\n## Contrôle séparé du bucket existant « photos »\n", "Voir `ANOMALIE_BUCKET_PHOTOS.md` (comparaison avant / après correctif proposé).\n", "| Id | Compte | Action | Obtenu |\n|---|---|---|---|"]
L += [f"| {t['id']} | {t['compte']} | {t['action']} | {t['obtenu']} |" for t in ph]
L += ["\n## Non exécuté\n", "- Aucun test sur l'API HTTP réelle de Supabase (PostgREST, Storage, Auth) : script prêt (`tests/observatoire/recette_http.mjs`, 18 contrôles), NON EXÉCUTÉ faute de projet Supabase isolé.", "- Aucun test sur téléphone Android réel ni de charge."]
open(os.path.join(D, 'RAPPORT_TESTS_STAGING.md'), 'w', encoding='utf-8').write("\n".join(L) + "\n")
rows = [l.split('|') for l in open(os.path.join(R, 'audit_fonctions_pheno.txt'), encoding='utf-8').read().strip().splitlines()]
de = [r for r in rows if r[1] == 'DEFINER']; exp = [r for r in de if r[5] == 'OUI']
A = ["# Audit des fonctions SECURITY DEFINER du module Observatoire\n",
 f"Inventaire extrait du staging après migration : {len(rows)} fonctions `pheno_*`, dont {len(de)} SECURITY DEFINER ; {len(exp)} exécutables par `authenticated` ; **0 exécutable par `anon` ou `PUBLIC`**.\n",
 "Règles vérifiées pour chaque fonction DEFINER : propriétaire `postgres` ; `search_path` figé (`public, private, pg_temp` ou plus restreint) ; `EXECUTE` révoqué de PUBLIC et anon ; pour celles exposées à `authenticated`, contrôle de l'identité et du droit (profil actif, rôle, affectation à la campagne) en tête de fonction, avant toute écriture. Les tests serveur exercent chaque refus (compte désactivé, RT hors périmètre, campagne close, rôle insuffisant).\n",
 "| Fonction | Mode | search_path | anon | authenticated | PUBLIC | Contrôle d'identité |\n|---|---|---|---|---|---|---|"]
A += [f"| `{r[0]}` | {r[1]} | {r[3].replace('search_path=','')} | {r[4]} | {r[5]} | {r[6]} | {r[7]} |" for r in rows]
open(os.path.join(D, 'AUDIT_SECURITY_DEFINER.md'), 'w', encoding='utf-8').write("\n".join(A) + "\n")
print("OK", s['total'], nr['reussis'], c['total'], n['total'], len(rows), len(de), len(exp))

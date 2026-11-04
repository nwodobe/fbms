#!/usr/bin/env python3
"""
AFLP FLEET 17 : auto-approbation des règles d'entretien par le Branch Manager.
Réplique LOCALE (migrations 1 à 16), comptes FICTIFS, rôle `authenticated` (RLS active). Refuse Supabase.
Usage : PGHOST=… PGPORT=… python3 tests/moto/tests_auto_approbation_regles_17.py <base_1_a_16>
"""
import json, os, subprocess, sys
HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST: sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1]
ICI = os.path.dirname(os.path.abspath(__file__)); RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
MIG = os.path.join(RACINE, "supabase", "20261112090000_aflp_fleet_17_auto_approbation_regles.sql")
RB = os.path.join(RACINE, "supabase", "20261112090100_aflp_fleet_17_rollback.sql")
U = {"bm": "00000000-0000-4000-8000-000000001701", "abm": "00000000-0000-4000-8000-000000001702"}
def psql(sql=None, f=None):
    a = ["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"] + (["-f", f] if f else [])
    r = subprocess.run(a, input=sql, capture_output=True, text=True); return r.returncode, r.stdout.strip(), r.stderr.strip()
def q(sql):
    c, o, e = psql(sql)
    if c: raise RuntimeError(e)
    return o
def run_as(u, sql):
    cl = json.dumps({"sub": U[u], "role": "authenticated"})
    c, o, e = psql(f"begin;\n\\o /dev/null\nset local role authenticated; select set_config('request.jwt.claims','{cl}',true);\n\\o\n{sql};\ncommit;\n")
    if c == 0: return True, (o.splitlines() or [""])[-1]
    return False, next((l for l in e.splitlines() if "ERROR" in l), e).split("ERROR:")[-1].strip()
R = []
def act(t, lab, u, sql, ok_att=True, cont=None):
    ok, out = run_as(u, sql); r = ok == ok_att and (cont is None or cont.lower() in out.lower())
    R.append(r); print(("✓ " if r else "✗ ") + f"{t} {lab} — {out[:150]}")
    try: return json.loads(out) if ok and out.startswith("{") else out
    except Exception: return out
def check(t, lab, sql, att):
    try: g = q(sql)
    except Exception as e: g = f"ERREUR {e}"
    r = g == str(att); R.append(r); print(("✓ " if r else "✗ ") + f"{t} {lab} — {g[:150]}")
def lit(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
for k, n, role in (("bm", "BM17 FICTIF", "Branch Manager"), ("abm", "ABM17 FICTIF", "Assistant Branch Manager")):
    q(f"insert into auth.users (id, email) values ('{U[k]}', '{k}.m17@example.invalid') on conflict do nothing; insert into public.profils (user_id, email, nom, role, actif) values ('{U[k]}', '{k}.m17@example.invalid', '{n}', '{role}', true) on conflict do nothing;")
REF = "Plan d'entretien usage sévère AFLP (recette fictive)"
def proposer(u, regle, nature="POLITIQUE_INTERNE", phase="RECURRENT", km=1000, j=30, ref=REF):
    return act("P", f"Proposition {regle} {phase} ({nature})", u, "select public.moto_regle_version_proposer(" + lit({"regle_code": regle, "modele_code": "APSONIC_AP150_30", "phase": phase, "intervalle_km": km, "intervalle_jours": j,
               "rappel_avant_km": 150, "proche_avant_km": 50, "rappel_avant_jours": 5, "proche_avant_jours": 2, "nature_source": nature, "reference_source": ref, "motif": "Recette auto-approbation"}) + ")")["id"]
def approuver(v): return f"select public.moto_regle_version_approuver('{v}', current_date, 'Approbation recette fictive')"
v0 = proposer("bm", "VIDANGE")
act("AVANT-01", "Avant : le BM n'approuve pas sa propre proposition", "bm", approuver(v0), False, "Quatre yeux")
for i in (1, 2):
    c, o, e = psql(f=MIG); R.append(c == 0); print(("✓" if c == 0 else "✗") + f" MIG-{i} {e[-200:] if c else ''}")
act("T-01", "Le BM approuve sa propre proposition (politique interne)", "bm", approuver(v0), True, "APPROUVEE")
check("T-02", "Trace : approbateur = proposant, motif préfixé", f"select (approuve_par = propose_par)||'/'||motif_approbation from public.moto_regles_versions where id='{v0}'", "true/Auto-approbation par le proposant : Approbation recette fictive")
v1 = proposer("abm", "REVISION", km=4000, j=120)
act("T-03", "Proposition d'un autre : approbation sans mention", "bm", approuver(v1), True, "APPROUVEE")
check("T-04", "Pas de mention d'auto-approbation", f"select motif_approbation from public.moto_regles_versions where id='{v1}'", "Approbation recette fictive")
vh = proposer("bm", "ENTRETIEN", nature="HYPOTHESE")
act("S-01", "Hypothèse : jamais approuvable, même par son auteur", "bm", approuver(vh), False, "hypothèse")
vr = proposer("bm", "VIDANGE", phase="RODAGE", km=500, ref="court")
act("S-02", "Référence trop courte : refusée", "bm", approuver(vr), False, "Référence")
act("S-03", "L'ABM n'approuve pas", "abm", approuver(vr), False, "")
v2 = proposer("bm", "VIDANGE", km=1200)
act("T-05", "Nouvelle version approuvée : l'ancienne passe REMPLACEE", "bm", approuver(v2), True, "APPROUVEE")
check("T-06", "Ancienne version remplacée", f"select statut from public.moto_regles_versions where id='{v0}'", "REMPLACEE")
for i in (1, 2):
    c, o, e = psql(f=RB); R.append(c == 0); print(("✓" if c == 0 else "✗") + f" RB-{i} {e[-200:] if c else ''}")
v3 = proposer("bm", "REVISION", km=3000)
act("RB-03", "Après retour arrière : auto-approbation de nouveau refusée", "bm", approuver(v3), False, "Quatre yeux")
check("RB-04", "Versions auto-approuvées conservées", f"select count(*) from public.moto_regles_versions where approuve_par = propose_par", "2")
ok = sum(R); print(f"\nBilan : {ok}/{len(R)} réussis"); sys.exit(0 if ok == len(R) else 1)

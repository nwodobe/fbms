#!/usr/bin/env python3
"""
AFLP FLEET 11 : auto-validation des documents moto par le BM ou l'ABM.

Réplique LOCALE uniquement (migrations 1 à 10), comptes et motos FICTIFS.
Chaque action s'exécute sous le rôle `authenticated` (RLS active).
Usage : PGHOST=… PGPORT=… python3 tests/moto/tests_auto_validation_11.py <base_1_a_10>
"""
import json, os, subprocess, sys, uuid, datetime

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1]
ICI = os.path.dirname(os.path.abspath(__file__)); RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
MIG = os.path.join(RACINE, "supabase", "20261107090000_aflp_fleet_11_auto_validation_documents.sql")
RB = os.path.join(RACINE, "supabase", "20261107090100_aflp_fleet_11_rollback.sql")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
U = {"bm": uid(1101), "abm": uid(1102), "bm2": uid(1103), "uh": uid(1104)}
PROFILS = [("bm", "BM11 FICTIF", "Branch Manager", None), ("abm", "ABM11 FICTIF", "Assistant Branch Manager", None),
           ("bm2", "BM11 BIS FICTIF", "Branch Manager", None), ("uh", "UH11 FICTIF", "Unit Head", "SAKASSOU")]

def psql(sql, f=None):
    a = ["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"] + (["-f", f] if f else [])
    r = subprocess.run(a, input=None if f else sql, capture_output=True, text=True); return r.returncode, r.stdout.strip(), r.stderr.strip()
def q(sql):
    c, o, e = psql(sql)
    if c: raise RuntimeError(e)
    return o
def run_as(user, sql):
    claims = json.dumps({"sub": U[user], "role": "authenticated"})
    c, o, e = psql(f"begin;\n\\o /dev/null\nset local role authenticated; select set_config('request.jwt.claims','{claims}',true);\n\\o\n{sql};\ncommit;\n")
    if c == 0: return True, (o.splitlines() or [""])[-1]
    return False, next((l for l in e.splitlines() if "ERROR" in l), e).split("ERROR:")[-1].strip()
R = []
def act(tid, label, user, sql, ok_attendu=True, contient=None):
    ok, out = run_as(user, sql)
    r = ok == ok_attendu and (contient is None or contient.lower() in out.lower())
    R.append((tid, label, r)); print(("✓ " if r else "✗ ") + f"{tid} {label} — {out[:150]}")
    try: return json.loads(out) if ok and out.startswith("{") else out
    except Exception: return out
def check(tid, label, sql, attendu):
    try: got = q(sql)
    except Exception as e: got = f"ERREUR {e}"
    r = got == str(attendu); R.append((tid, label, r)); print(("✓ " if r else "✗ ") + f"{tid} {label} — {got[:150]}")
def lit(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
def put(p): q(f"insert into storage.objects (bucket_id, name, owner) values ('moto-documents', '{p}', '{U['bm']}') on conflict do nothing")
today = datetime.date.today()
def depot(user, moto, typ, exp=None):
    p = f"{moto}/document/{uuid.uuid4()}.pdf"; put(p)
    ok, out = run_as(user, "select public.moto_document_enregistrer(" + lit({"moto_id": moto, "type_document": typ, "storage_path": p, **({"date_expiration": exp} if exp else {})}) + ")")
    assert ok, out
    return json.loads(out)["id"]

q("\n".join(f"insert into auth.users (id, email) values ('{U[k]}', '{k}.m11@example.invalid') on conflict do nothing; "
            f"insert into public.profils (user_id, email, nom, role, cluster, actif) values ('{U[k]}', '{k}.m11@example.invalid', '{n}', '{r}', {('$c$'+c+'$c$') if c else 'null'}, true) on conflict do nothing;"
            for k, n, r, c in PROFILS))
ok, out = run_as("abm", "select public.moto_creer(" + lit({"marque": "APSONIC", "modele": "AP150-30 FICTIF", "cluster_code": "SAKASSOU", "date_reception": str(today), "compteur_km": 3, "motif": "Recette 11"}) + ")")
M = json.loads(out)["id"]
run_as("abm", f"select public.moto_modifier_identite('{M}', '{{\"numero_chassis\":\"M11-FICTIF-{uuid.uuid4().hex[:6]}\",\"immatriculation\":\"M11 FICTIF {uuid.uuid4().hex[:4]}\"}}'::jsonb, 'Identité recette')")

# Avant migration : la règle actuelle refuse l'auto-validation
d0 = depot("bm", M, "AUTRE")
act("A-01", "Avant : auto-validation refusée", "bm", f"select public.moto_document_verifier('{d0}', 'CONFORME')", False, "Auto-validation interdite")

for passe in (1, 2):
    c, o, e = psql(None, MIG); R.append((f"MIG-{passe}", "Migration 11 appliquée (rejouable)", c == 0)); print(("✓" if c == 0 else "✗") + f" MIG-{passe} {e[-200:] if c else ''}")

act("V-01", "BM valide lui-même son dépôt", "bm", f"select public.moto_document_verifier('{d0}', 'CONFORME')", True, "\"auto_validation\": true")
check("V-02", "Trace : vérificateur = déposant, motif « Auto-validation »", f"select (verifie_par=depose_par)||'/'||motif_verification from public.moto_documents where id='{d0}'", "true/Auto-validation par le déposant")
dg, dp, da = depot("abm", M, "CARTE_GRISE"), depot("abm", M, "PLAQUE"), depot("abm", M, "ASSURANCE", str(today + datetime.timedelta(days=300)))
for t, d in (("V-03", dg), ("V-04", dp), ("V-05", da)):
    act(t, "ABM valide lui-même son dépôt", "abm", f"select public.moto_document_verifier('{d}', 'CONFORME', 'Contrôlé sur l''original')", True, "CONFORME")
check("V-06", "Statut administratif CONFORME après les 3 documents auto-validés", f"select statut_administratif from public.moto_motos where id='{M}'", "CONFORME")
check("V-07", "Motif saisi conservé après la mention", f"select motif_verification from public.moto_documents where id='{dg}'", "Auto-validation par le déposant : Contrôlé sur l'original")
d1 = depot("bm", M, "PV_REMISE")
act("V-08", "Validation par un autre BM : pas de mention d'auto-validation", "bm2", f"select public.moto_document_verifier('{d1}', 'CONFORME')", True, "\"auto_validation\": false")
d2 = depot("bm", M, "AUTRE")
act("S-01", "Chef d'unité : vérification toujours refusée", "uh", f"select public.moto_document_verifier('{d2}', 'CONFORME')", False, "rôle")
act("S-02", "Non conforme sans motif : refusé même en auto-validation", "bm", f"select public.moto_document_verifier('{d2}', 'NON_CONFORME')", False, "Motif obligatoire")
act("S-03", "Non conforme motivé : accepté", "bm", f"select public.moto_document_verifier('{d2}', 'NON_CONFORME', 'Document illisible')", True, "NON_CONFORME")
de = depot("bm", M, "ASSURANCE")
q(f"update public.moto_documents set date_expiration = current_date - 1 where id='{de}'")
act("S-04", "Document expiré : jamais conforme", "bm", f"select public.moto_document_verifier('{de}', 'CONFORME')", False, "expiré")
act("S-05", "Document déjà vérifié : refus", "bm", f"select public.moto_document_verifier('{d0}', 'CONFORME')", False, "déjà été vérifié")
check("S-06", "Journal : la validation est tracée avec son auteur", f"select count(*)>0 from public.moto_journal where table_nom='moto_documents' and enregistrement_id='{d0}' and auteur='{U['bm']}' and action='UPDATE'", "t")

# Retour arrière : la règle d'origine revient, rien n'est effacé
for passe in (1, 2):
    c, o, e = psql(None, RB); R.append((f"RB-{passe}", "Retour arrière appliqué (rejouable)", c == 0)); print(("✓" if c == 0 else "✗") + f" RB-{passe} {e[-200:] if c else ''}")
d3 = depot("bm", M, "AUTRE")
act("RB-03", "Après retour arrière : auto-validation de nouveau refusée", "bm", f"select public.moto_document_verifier('{d3}', 'CONFORME')", False, "Auto-validation interdite")
check("RB-04", "Documents auto-validés conservés", f"select count(*) from public.moto_documents where moto_id='{M}' and verifie_par=depose_par", "5")

ok = sum(1 for r in R if r[2]); print(f"\nBilan : {ok}/{len(R)} réussis"); sys.exit(0 if ok == len(R) else 1)

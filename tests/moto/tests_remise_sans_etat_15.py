#!/usr/bin/env python3
"""
AFLP FLEET 15 : état contradictoire avant remise facultatif.

Réplique LOCALE (migrations 1 à 14 = état de la production), comptes et motos FICTIFS,
chaque action sous le rôle `authenticated` (RLS active). Refuse toute cible Supabase.
Usage : PGHOST=… PGPORT=… python3 tests/moto/tests_remise_sans_etat_15.py <base_1_a_14>
"""
import json, os, subprocess, sys, uuid, datetime

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_apt_t"
ICI = os.path.dirname(os.path.abspath(__file__)); RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
OUT_DIR = os.path.join(ICI, "resultats")
import random; SERIE = random.randint(100, 899)
MIGRATION = os.path.join(RACINE, "supabase", "20261110090000_aflp_fleet_15_remise_sans_etat.sql")
ROLLBACK = os.path.join(RACINE, "supabase", "20261110090100_aflp_fleet_15_rollback.sql")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
U = {"bm": uid(1501), "abm": uid(1502), "lc": uid(1503), "zh": uid(1504), "uh_a": uid(1505), "uh_b": uid(1506), "uh_c": uid(1507)}
PROFILS = [  # (clé, nom, rôle, cluster, zone, fonction opérationnelle)
    ("bm", "BM15 FICTIF", "Branch Manager", None, None, None),
    ("abm", "ABM15 FICTIF", "Assistant Branch Manager", None, None, None),
    ("lc", "COORDINATEUR15 FICTIF", "Supervisor", None, None, "Logistics Coordinator"),
    ("zh", "ZH15 FICTIF", "Zonal Head", None, "GBEKE 1", None),
    ("uh_a", "UH13 A FICTIF", "Unit Head", "SAKASSOU", "GBEKE 1", None),
    ("uh_b", "UH13 B FICTIF", "Unit Head", "BROBO", "GBEKE 1", None),
    ("uh_c", "UH13 C FICTIF", "Unit Head", "BOTRO", "GBEKE 2", None),
]

def psql(sql):
    r = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
                       input=sql, capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()
def q(sql):
    code, out, err = psql(sql)
    if code != 0: raise RuntimeError(err)
    return out
def run_as(user, sql):
    if user == "anon":
        pre = "set local role anon; select set_config('request.jwt.claims','{\"role\":\"anon\"}',true);"
    else:
        claims = json.dumps({"sub": U[user], "role": "authenticated"})
        pre = f"set local role authenticated; select set_config('request.jwt.claims','{claims}',true);"
    code, out, err = psql(f"begin;\n\\o /dev/null\n{pre}\n\\o\n{sql};\ncommit;\n")
    if code == 0:
        lines = [l for l in out.splitlines() if l.strip()]
        return True, (lines[-1] if lines else "")
    lines = err.splitlines()
    msg = next((l for l in lines if "ERROR" in l), lines[0] if lines else "erreur")
    return False, msg.split("ERROR:")[-1].strip()

RESULTS = []
def record(tid, exigence, user, label, attendu, ok, obtenu):
    RESULTS.append({"id": tid, "exigence": exigence, "compte": user, "action": label, "attendu": attendu,
                    "obtenu": obtenu[:300], "resultat": "RÉUSSI" if ok else "ÉCHOUÉ"})
    print(("✓ " if ok else "✗ ") + f"{tid} {label} — {obtenu[:160]}", flush=True)
def act(tid, exigence, user, label, sql, expect_ok=True, contains=None):
    ok, out = run_as(user, sql)
    passed = (ok == expect_ok) and (contains is None or contains.lower() in out.lower())
    record(tid, exigence, user, label, ("OK" if expect_ok else "REFUS") + (f" ({contains})" if contains else ""), passed,
           ("OK : " if ok else "REFUS : ") + out)
    try: return json.loads(out) if ok and out.startswith("{") else out
    except Exception: return out
def check(tid, exigence, label, sql, expected):
    try: got = q(sql)
    except Exception as e: got = f"ERREUR {e}"
    record(tid, exigence, "postgres (lecture)", label, str(expected), got == str(expected), got)
    return got
def must(user, sql):
    ok, out = run_as(user, sql)
    if not ok: raise RuntimeError(f"Préparation impossible ({user}) : {out}\n{sql[:300]}")
    try: return json.loads(out) if out.startswith("{") else out
    except Exception: return out

def lit(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
def put_object(path): q(f"insert into storage.objects (bucket_id, name, owner) values ('moto-documents', '{path}', '{U['abm']}') on conflict do nothing")
def photos(moto, cats):
    out = []
    for c in cats:
        p = f"{moto}/controle/{uuid.uuid4()}.jpg"; put_object(p); out.append({"path": p, "categorie": c})
    return out
def items(typ, ko=(), obs=None):
    rows = json.loads(q(f"select json_agg(json_build_object('code', code, 'critique', critique) order by ordre) from public.moto_catalogue_points where type_controle='{typ}' and actif"))
    return [{"code": r["code"], "ok": r["code"] not in ko, "critique": r["critique"], **({"observation": obs[r["code"]]} if obs and r["code"] in obs else {})} for r in rows]
today = datetime.date.today()
EQ = {"CASQUE": True, "GILET_HAUTE_VISIBILITE": True}
CATS_REMISE = ["AVANT", "ARRIERE", "GAUCHE", "DROITE", "COMPTEUR"]
MECA = {"intervenant_nom": "MECANICIEN QUALIFIE FICTIF"}

# ---------------------------------------------------------------------------
# Comptes fictifs
# ---------------------------------------------------------------------------
setup = []
for k, nom, role, cluster, zone, fonction in PROFILS:
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}.m15@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
                 f"('{U[k]}', '{k}.m15@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, true) on conflict do nothing;")
    if fonction: setup.append(f"update public.profils set fonction_operationnelle = '{fonction}' where user_id = '{U[k]}';")
q("\n".join(setup))

def creer(cluster, origine="NEUVE"):
    p = {"marque": "APSONIC", "modele": "AP150-30 FICTIF", "cluster_code": cluster, "motif": "Moto de recette fictive"}
    p.update({"date_reception": str(today), "compteur_km": 3} if origine == "NEUVE" else {"origine": "EN_EXPLOITATION", "date_debut_utilisation": "2026-02-01"})
    return must("abm", "select public.moto_creer(" + lit(p) + ")")["id"]
def dossier_admin(moto, n):
    must("abm", f"select public.moto_modifier_identite('{moto}', '{{\"numero_chassis\":\"M15-FICTIF-CH-{SERIE}-{n:03d}\",\"immatriculation\":\"M10 {n:04d} FICTIF\"}}'::jsonb, 'Saisie identité recette')")
    for typ in ("CARTE_GRISE", "PLAQUE", "ASSURANCE"):
        p = f"{moto}/document/{uuid.uuid4()}.pdf"; put_object(p)
        d = must("abm", "select public.moto_document_enregistrer(" + lit({"moto_id": moto, "type_document": typ, "storage_path": p,
                 **({"date_expiration": str(today + datetime.timedelta(days=300))} if typ == "ASSURANCE" else {})}) + ")")
        must("bm", f"select public.moto_document_verifier('{d['id']}', 'CONFORME')")
def permis_pour(benef):
    if q(f"select count(*) from public.moto_permis where titulaire_id='{U[benef]}' and statut='CONFORME'") != "0": return
    p = f"permis/{U[benef]}/{uuid.uuid4()}.pdf"; put_object(p)
    r = must("abm", "select public.moto_permis_enregistrer(" + lit({"titulaire_id": U[benef], "nom_titulaire": "TITULAIRE FICTIF " + benef.upper(),
             "numero_permis": "M15-" + U[benef][-6:], "categories": ["A"], "date_expiration": str(today + datetime.timedelta(days=700)), "document_path": p}) + ")")
    must("bm", f"select public.moto_permis_verifier('{r['id']}', 'CONFORME', 'RH FICTIF', true)")
def remise(moto, benef, km=12, er_ko=()):
    """Préaffectation, PV vérifié, état contradictoire accepté, permis, remise. Renvoie l'identifiant du PV."""
    must("bm", f"select public.moto_preaffecter('{moto}', '{U[benef]}', 'Affectation recette')")
    p = f"{moto}/document/{uuid.uuid4()}.pdf"; put_object(p)
    pv = must("abm", "select public.moto_document_enregistrer(" + lit({"moto_id": moto, "type_document": "PV_REMISE", "storage_path": p}) + ")")["id"]
    must("bm", f"select public.moto_document_verifier('{pv}', 'CONFORME')")
    et = must("abm", "select public.moto_etat_remise_enregistrer(" + lit({"moto_id": moto, "items": items("ETAT_REMISE", er_ko), "compteur_km": km,
              "date_remise_prevue": str(today), "photos": photos(moto, CATS_REMISE)}) + ")")
    must(benef, f"select public.moto_etat_remise_confirmer('{et['id']}', 'ACCEPTEE')")
    permis_pour(benef)
    must("abm", "select public.moto_remettre(" + lit({"moto_id": moto, "pv_document_id": pv, "compteur_km": km, "equipements": EQ}) + ")")
def insp(user, moto, ko=(), obs=None, extra=None, km=10):
    return "select public.moto_inspection_initiale(" + lit({"moto_id": moto, "items": items("INSPECTION_INITIALE", ko, obs), "compteur_km": km, **MECA, **(extra or {})}) + ")"
def statut(moto): return q(f"select statut_technique from public.moto_motos where id='{moto}'")
def cloturer_actions(moto, codes):
    for aid in q(f"select string_agg(id::text, ',') from public.moto_actions_correctives where moto_id='{moto}' and point_code = any(array{list(codes)}) and statut='OUVERTE'").split(","):
        if not aid: continue
        must("abm", "select public.moto_action_planifier(" + lit({"action_id": aid, "action_prevue": "Réparation recette fictive", "date_cible": str(today)}) + ")")
        must("abm", "select public.moto_action_realiser(" + lit({"action_id": aid, "realise_at": str(today)}) + ")")
        must("lc", f"select public.moto_action_verifier('{aid}', 'VALIDEE', 'Correction constatée (recette)')")



def psql_f(f):
    r = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", f], capture_output=True, text=True)
    return r.returncode == 0, r.stderr[-300:]
def permis(benef):
    p = f"permis/{U[benef]}/{uuid.uuid4()}.pdf"; put_object(p)
    pid = must("bm", "select public.moto_permis_enregistrer(" + lit({"titulaire_id": U[benef], "nom_titulaire": "TITULAIRE FICTIF " + benef.upper(),
             "numero_permis": "M15-" + U[benef][-6:] + "-" + str(SERIE), "categories": ["A"], "sans_expiration": True, "document_path": p}) + ")")["id"]
    must("bm", f"select public.moto_permis_verifier('{pid}', 'CONFORME', 'RH FICTIF', true)")
def etat(m): return must("bm", "select public.moto_etat_remise_enregistrer(" + lit({"moto_id": m, "items": items("ETAT_REMISE"), "compteur_km": 12, "date_remise_prevue": str(today), "photos": photos(m, CATS_REMISE)}) + ")")["id"]
def remettre(m, km=12): return "select public.moto_remettre(" + lit({"moto_id": m, "compteur_km": km, "equipements": EQ}) + ")"
def prepa(cluster, n, benef):
    m = creer(cluster); dossier_admin(m, n); must("abm", insp("abm", m))
    must("bm", f"select public.moto_preaffecter('{m}', '{U[benef]}', 'Affectation recette')"); return m
EX = "Remise sans état contradictoire"
for b in ("uh_a", "uh_b", "uh_c", "zh"): permis(b)
A = prepa("SAKASSOU", 1, "uh_a"); B = prepa("BROBO", 2, "uh_b"); C = prepa("BOTRO", 3, "uh_c"); D = prepa("SAKASSOU", 4, "zh")
act("AVANT-01", EX, "bm", "Avant : remise sans état refusée", remettre(A), False, "état contradictoire")
for i in (1, 2):
    ok, err = psql_f(MIGRATION); record(f"MIG-0{i}", "Migration rejouable", "postgres", f"Migration 15 (passe {i})", "OK", ok, "OK" if ok else err)
act("T-01", EX, "bm", "Remise sans état contradictoire : acceptée", remettre(A), True, "REMISE")
check("T-02", EX, "Affectation REMISE sans état rattaché", f"select type_affectation||'/'||(etat_remise_id is null) from public.moto_affectations where moto_id='{A}' and statut='ACTIVE'", "REMISE/true")
act("T-03", EX, "bm", "Puis autorisation de circuler", f"select public.moto_mettre_en_service('{A}', 'Autorisation recette')", True, "true")
eb = etat(B); must("uh_b", f"select public.moto_etat_remise_confirmer('{eb}', 'ACCEPTEE')")
act("T-04", EX, "bm", "État accepté existant : remise acceptée", remettre(B), True, "REMISE")
check("T-05", EX, "L'état accepté reste rattaché comme preuve", f"select (etat_remise_id = '{eb}')::text from public.moto_affectations where moto_id='{B}' and statut='ACTIVE'", "true")
ec = etat(C); must("uh_c", f"select public.moto_etat_remise_confirmer('{ec}', 'CONTESTEE', 'Rayure non signalée')")
act("S-01", EX, "bm", "État contesté par le bénéficiaire : remise bloquée", remettre(C), False, "contesté")
act("S-02", EX, "bm", "Sans compteur : toujours refusé", "select public.moto_remettre(" + lit({"moto_id": D, "equipements": EQ}) + ")", False, "compteur")
act("S-03", EX, "bm", "Sans casque ni gilet : toujours refusé", "select public.moto_remettre(" + lit({"moto_id": D, "compteur_km": 12, "equipements": {}}) + ")", False, "Équipement")
E = prepa("BROBO", 5, "lc")
act("S-04", EX, "bm", "Bénéficiaire sans permis conforme : toujours refusé", remettre(E), False, "permis")
act("T-06", EX, "bm", "Exigences : « Enregistrer la remise », plus d'état demandé", f"select public.moto_aptitude('{D}')", True, "Enregistrer la remise (compteur, casque et gilet)")
act("T-07", EX, "bm", "Le BM rétablit l'obligation par paramètre", "select public.moto_parametre_modifier('etat_remise_obligatoire', 1, null, 'Test rétablissement')", True, "etat_remise_obligatoire")
act("T-08", EX, "bm", "État de nouveau exigé", remettre(D), False, "état contradictoire")
must("bm", "select public.moto_parametre_modifier('etat_remise_obligatoire', 0, null, 'Retour au réglage de la décision')")
F = prepa("BOTRO", 6, "uh_c")
act("T-09", EX, "bm", "Transfert sans état : accepté", "select public.moto_transferer(" + lit({"moto_id": A, "beneficiaire_id": U["zh"], "compteur_km": 20, "equipements": EQ, "motif": "Transfert recette"}) + ")", True, "")
check("T-10", EX, "Aucun état existant modifié", f"select confirmation_statut from public.moto_controles where id='{ec}'", "CONTESTEE")
for i in (1, 2):
    ok, err = psql_f(ROLLBACK); record(f"RB-0{i}", "Retour arrière rejouable", "postgres", f"Retour arrière 15 (passe {i})", "OK", ok, "OK" if ok else err)
act("RB-03", EX, "bm", "Après retour arrière : état de nouveau obligatoire", remettre(F), False, "état contradictoire")
check("RB-04", EX, "Remise faite sans état conservée", f"select count(*) from public.moto_affectations where moto_id='{A}' and type_affectation='REMISE' and etat_remise_id is null", "1")
check("RB-05", EX, "Paramètre retiré", "select count(*) from public.moto_parametres where cle='etat_remise_obligatoire'", "0")
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI"); print(f"\nBilan : {ok}/{len(RESULTS)} réussis"); sys.exit(0 if ok == len(RESULTS) else 1)

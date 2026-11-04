#!/usr/bin/env python3
"""
AFLP FLEET 16 : un permis enregistré suffit à la remise (vérification facultative).

Réplique LOCALE (migrations 1 à 15 = état de la production), comptes et motos FICTIFS,
chaque action sous le rôle `authenticated` (RLS active). Refuse toute cible Supabase.
Usage : PGHOST=… PGPORT=… python3 tests/moto/tests_permis_enregistre_16.py <base_1_a_15>
"""
import json, os, subprocess, sys, uuid, datetime

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_apt_t"
ICI = os.path.dirname(os.path.abspath(__file__)); RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
OUT_DIR = os.path.join(ICI, "resultats")
import random; SERIE = random.randint(100, 899)
MIGRATION = os.path.join(RACINE, "supabase", "20261111090000_aflp_fleet_16_permis_enregistre.sql")
ROLLBACK = os.path.join(RACINE, "supabase", "20261111090100_aflp_fleet_16_rollback.sql")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
U = {"bm": uid(1601), "abm": uid(1602), "lc": uid(1603), "zh": uid(1604), "uh_a": uid(1605), "uh_b": uid(1606), "uh_c": uid(1607)}
PROFILS = [  # (clé, nom, rôle, cluster, zone, fonction opérationnelle)
    ("bm", "BM16 FICTIF", "Branch Manager", None, None, None),
    ("abm", "ABM16 FICTIF", "Assistant Branch Manager", None, None, None),
    ("lc", "COORDINATEUR16 FICTIF", "Supervisor", None, None, "Logistics Coordinator"),
    ("zh", "ZH16 FICTIF", "Zonal Head", None, "GBEKE 1", None),
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
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}.m16@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
                 f"('{U[k]}', '{k}.m16@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, true) on conflict do nothing;")
    if fonction: setup.append(f"update public.profils set fonction_operationnelle = '{fonction}' where user_id = '{U[k]}';")
q("\n".join(setup))

def creer(cluster, origine="NEUVE"):
    p = {"marque": "APSONIC", "modele": "AP150-30 FICTIF", "cluster_code": cluster, "motif": "Moto de recette fictive"}
    p.update({"date_reception": str(today), "compteur_km": 3} if origine == "NEUVE" else {"origine": "EN_EXPLOITATION", "date_debut_utilisation": "2026-02-01"})
    return must("abm", "select public.moto_creer(" + lit(p) + ")")["id"]
def dossier_admin(moto, n):
    must("abm", f"select public.moto_modifier_identite('{moto}', '{{\"numero_chassis\":\"M16-FICTIF-CH-{SERIE}-{n:03d}\",\"immatriculation\":\"M10 {n:04d} FICTIF\"}}'::jsonb, 'Saisie identité recette')")
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
def deposer(benef, exp=700):
    p = f"permis/{U[benef]}/{uuid.uuid4()}.pdf"; put_object(p)
    return must("bm", "select public.moto_permis_enregistrer(" + lit({"titulaire_id": U[benef], "nom_titulaire": "TITULAIRE FICTIF " + benef.upper(),
             "numero_permis": "M16-" + U[benef][-6:] + "-" + str(SERIE), "categories": ["A"], "date_expiration": str(today + datetime.timedelta(days=exp)), "document_path": p}) + ")")["id"]
def remettre(m, km=12): return "select public.moto_remettre(" + lit({"moto_id": m, "compteur_km": km, "equipements": EQ}) + ")"
def prepa(cluster, n, benef):
    m = creer(cluster); dossier_admin(m, n); must("abm", insp("abm", m))
    must("bm", f"select public.moto_preaffecter('{m}', '{U[benef]}', 'Affectation recette')"); return m
EX = "Permis enregistré suffit"
pa = deposer("uh_a"); pb = deposer("uh_b"); pc = deposer("uh_c")
A = prepa("SAKASSOU", 1, "uh_a"); B = prepa("BROBO", 2, "uh_b"); C = prepa("BOTRO", 3, "uh_c"); D = prepa("SAKASSOU", 4, "zh"); E = prepa("BROBO", 5, "lc")
act("AVANT-01", EX, "bm", "Avant : permis enregistré non vérifié, remise refusée", remettre(A), False, "vérifié CONFORME")
for i in (1, 2):
    ok, err = psql_f(MIGRATION); record(f"MIG-0{i}", "Migration rejouable", "postgres", f"Migration 16 (passe {i})", "OK", ok, "OK" if ok else err)
act("T-01", EX, "bm", "Permis enregistré (en vérification) : remise acceptée", remettre(A), True, "REMISE")
check("T-02", EX, "Trace : permis rattaché, permis_verifie = false", f"select (permis_id = '{pa}')||'/'||permis_verifie from public.moto_affectations where moto_id='{A}' and statut='ACTIVE'", "true/false")
check("T-03", EX, "Le permis reste « à vérifier »", f"select statut from public.moto_permis where id='{pa}'", "EN_VERIFICATION")
act("T-04", EX, "bm", "Autorisation de circuler ensuite", f"select public.moto_mettre_en_service('{A}', 'Autorisation recette')", True, "true")
def mission(user, m): return "select public.moto_mission_demarrer(" + lit({"client_op_id": str(uuid.uuid4()), "moto_id": m, "compteur_km": 30, "capture_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}) + ")"
ok5, out5 = run_as("uh_a", mission("uh_a", A))
record("T-05", EX, "uh_a", "Mission : le contrôle du permis enregistré passe (refus éventuel pour une autre raison)", "pas de refus permis", "permis" not in out5.lower(), ("OK : " if ok5 else "REFUS : ") + out5)
must("bm", f"select public.moto_permis_verifier('{pb}', 'CONFORME', 'RH FICTIF', true)")
act("T-06", EX, "bm", "Permis vérifié : remise acceptée, permis_verifie = true", remettre(B), True, "REMISE")
check("T-07", EX, "Trace vérifiée", f"select permis_verifie::text from public.moto_affectations where moto_id='{B}' and statut='ACTIVE'", "true")
act("S-01", EX, "bm", "Aucun permis enregistré : remise toujours refusée", remettre(D), False, "permis")
q(f"update public.moto_permis set date_expiration = current_date - 1 where id='{pc}'")
act("S-02", EX, "bm", "Permis enregistré mais expiré : refusé", remettre(C), False, "permis")
q(f"update public.moto_permis set date_expiration = current_date + 700 where id='{pc}'")
must("bm", f"select public.moto_permis_verifier('{pc}', 'NON_CONFORME', null, null, 'Photo illisible')")
act("S-03", EX, "bm", "Permis déclaré non conforme : refusé", remettre(C), False, "permis")
q(f"update public.moto_permis set date_expiration = current_date - 1 where id='{pa}'")
act("S-04", EX, "uh_a", "Mission avec permis enregistré expiré : refusée pour le permis", mission("uh_a", A), False, "permis")
q(f"update public.moto_permis set date_expiration = current_date + 700 where id='{pa}'")
act("T-08", EX, "bm", "Le BM rétablit l'obligation par paramètre", "select public.moto_parametre_modifier('permis_verification_obligatoire', 1, null, 'Test rétablissement')", True, "permis_verification_obligatoire")
pe = deposer("lc")
act("T-09", EX, "bm", "Vérification de nouveau exigée", remettre(E), False, "permis")
must("bm", "select public.moto_parametre_modifier('permis_verification_obligatoire', 0, null, 'Retour au réglage de la décision')")
act("T-10", EX, "bm", "Paramètre à 0 : remise acceptée", remettre(E), True, "REMISE")
for i in (1, 2):
    ok, err = psql_f(ROLLBACK); record(f"RB-0{i}", "Retour arrière rejouable", "postgres", f"Retour arrière 16 (passe {i})", "OK", ok, "OK" if ok else err)
F = prepa("BOTRO", 6, "uh_c")
act("RB-03", EX, "bm", "Après retour arrière : permis vérifié de nouveau exigé", remettre(F), False, "vérifié CONFORME")
check("RB-04", EX, "Remises faites avec permis en vérification conservées", f"select count(*) from public.moto_affectations where statut='ACTIVE' and permis_verifie = false and moto_id in ('{A}','{E}')", "2")
check("RB-05", EX, "Paramètre retiré", "select count(*) from public.moto_parametres where cle='permis_verification_obligatoire'", "0")
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI"); print(f"\nBilan : {ok}/{len(RESULTS)} réussis"); sys.exit(0 if ok == len(RESULTS) else 1)

#!/usr/bin/env python3
"""
AFLP FLEET 19 : auto-remise en service par le BM ou l'ABM.

Réplique LOCALE (migrations 1 à 18 = état de la production), comptes et motos FICTIFS,
chaque action sous le rôle `authenticated` (RLS active). Refuse toute cible Supabase.
Usage : PGHOST=… PGPORT=… python3 tests/moto/tests_auto_remise_19.py <base_1_a_18>
"""
import json, os, subprocess, sys, uuid, datetime

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_apt_t"
ICI = os.path.dirname(os.path.abspath(__file__)); RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
OUT_DIR = os.path.join(ICI, "resultats")
import random; SERIE = random.randint(100, 899)
MIGRATION = os.path.join(RACINE, "supabase", "20261114090000_aflp_fleet_19_auto_remise_en_service.sql")
ROLLBACK = os.path.join(RACINE, "supabase", "20261114090100_aflp_fleet_19_rollback.sql")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
U = {"bm": uid(1901), "abm": uid(1902), "lc": uid(1903), "zh": uid(1904), "uh_a": uid(1905), "uh_b": uid(1906), "uh_c": uid(1907)}
PROFILS = [  # (clé, nom, rôle, cluster, zone, fonction opérationnelle)
    ("bm", "BM19 FICTIF", "Branch Manager", None, None, None),
    ("abm", "ABM19 FICTIF", "Assistant Branch Manager", None, None, None),
    ("lc", "COORDINATEUR19 FICTIF", "Supervisor", None, None, "Logistics Coordinator"),
    ("zh", "ZH19 FICTIF", "Zonal Head", None, "GBEKE 1", None),
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
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}.m19@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
                 f"('{U[k]}', '{k}.m19@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, true) on conflict do nothing;")
    if fonction: setup.append(f"update public.profils set fonction_operationnelle = '{fonction}' where user_id = '{U[k]}';")
q("\n".join(setup))

def creer(cluster, origine="NEUVE"):
    p = {"marque": "APSONIC", "modele": "AP150-30 FICTIF", "cluster_code": cluster, "motif": "Moto de recette fictive"}
    p.update({"date_reception": str(today), "compteur_km": 3} if origine == "NEUVE" else {"origine": "EN_EXPLOITATION", "date_debut_utilisation": "2026-02-01"})
    return must("abm", "select public.moto_creer(" + lit(p) + ")")["id"]
def dossier_admin(moto, n):
    must("abm", f"select public.moto_modifier_identite('{moto}', '{{\"numero_chassis\":\"M19-FICTIF-CH-{SERIE}-{n:03d}\",\"immatriculation\":\"M10 {n:04d} FICTIF\"}}'::jsonb, 'Saisie identité recette')")
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
def deposer(benef):
    p = f"permis/{U[benef]}/{uuid.uuid4()}.pdf"; put_object(p)
    must("bm", "select public.moto_permis_enregistrer(" + lit({"titulaire_id": U[benef], "nom_titulaire": "TITULAIRE FICTIF " + benef.upper(), "numero_permis": "M19-" + U[benef][-6:] + "-" + str(SERIE), "categories": ["A"], "sans_expiration": True, "document_path": p}) + ")")
def en_service(cluster, n, benef):
    m = creer(cluster); dossier_admin(m, n); must("abm", insp("abm", m))
    must("bm", f"select public.moto_preaffecter('{m}', '{U[benef]}', 'Affectation recette')")
    must("bm", "select public.moto_remettre(" + lit({"moto_id": m, "compteur_km": 12, "equipements": EQ}) + ")")
    must("bm", f"select public.moto_mettre_en_service('{m}', 'Autorisation recette')"); return m
def incident(user, m):
    return must(user, "select public.moto_incident_declarer(" + lit({"moto_id": m, "type_incident": "ANOMALIE", "gravite": "CRITIQUE", "description": "Anomalie critique fictive de test", "arret_confirme": True, "client_op_id": str(uuid.uuid4())}) + ")")["id"]
def contre_visite(user, m, ko=()):
    return "select public.moto_controle_remise_en_service(" + lit({"moto_id": m, "items": items("REMISE_EN_SERVICE", ko), "compteur_km": 15, "intervenant_nom": "CONTROLEUR FICTIF", "motif": "Contre-visite recette"}) + ")"
def avancer(i, etape, note="Étape recette fictive"): return f"select public.moto_incident_avancer('{i}', '{etape}', '{note}')"
EX = "Auto-remise en service"
for b in ("uh_a", "uh_b", "uh_c"): deposer(b)
A = en_service("SAKASSOU", 1, "uh_a"); B = en_service("BROBO", 2, "uh_b")
ia = incident("uh_a", A)
check("PRE-01", EX, "Incident critique : moto immobilisée", f"select statut_technique from public.moto_motos where id='{A}'", "IMMOBILISEE")
must("bm", avancer(ia, "DIAGNOSTIC")); must("bm", avancer(ia, "CONTROLE"))
must("bm", contre_visite("bm", A))
act("AVANT-01", EX, "bm", "Avant : le BM auteur de la contre-visite ne remet pas en service", avancer(ia, "REMIS_EN_SERVICE"), False, "Séparation des tâches")
for i in (1, 2):
    ok, err = psql_f(MIGRATION); record(f"MIG-0{i}", "Migration rejouable", "postgres", f"Migration 19 (passe {i})", "OK", ok, "OK" if ok else err)
act("T-01", EX, "bm", "Le BM remet lui-même en service après sa contre-visite", avancer(ia, "REMIS_EN_SERVICE", "Contrôle physique fait"), True, "REMIS_EN_SERVICE")
check("T-02", EX, "Immobilisation levée, tracée « Auto-remise en service »", f"select (fin is not null)||'/'||levee_motif from public.moto_immobilisations where source_id='{ia}'", "true/Auto-remise en service après incident")
check("T-03", EX, "Étape tracée « Auto-remise en service »", f"select note from public.moto_incident_etapes where incident_id='{ia}' and etape='REMIS_EN_SERVICE'", "Auto-remise en service : Contrôle physique fait")
act("T-04", EX, "bm", "Clôture de l'incident", avancer(ia, "CLOS"), True, "CLOS")
check("T-05", EX, "Moto de nouveau apte et autorisée à circuler", f"select statut_technique||'/'||autorisee_a_circuler from public.moto_v_flotte where id='{A}'", "APTE/true")
ib = incident("uh_b", B)
must("abm", avancer(ib, "DIAGNOSTIC")); must("abm", avancer(ib, "CONTROLE"))
act("S-01", EX, "abm", "Sans contre-visite APTE : toujours refusé", avancer(ib, "REMIS_EN_SERVICE"), False, "contrôle de remise en service APTE")
must("abm", contre_visite("abm", B, ("FREIN_AVANT",)))
act("S-02", EX, "abm", "Contre-visite avec défaut critique : toujours refusé", avancer(ib, "REMIS_EN_SERVICE"), False, "")
must("abm", contre_visite("abm", B))
act("S-02b", EX, "abm", "Anomalie critique constatée et non corrigée : toujours refusé", avancer(ib, "REMIS_EN_SERVICE"), False, "anomalie critique")
D = en_service("SAKASSOU", 4, "uh_c"); idd = incident("uh_c", D)
must("abm", avancer(idd, "DIAGNOSTIC")); must("abm", avancer(idd, "CONTROLE")); must("abm", contre_visite("abm", D))
act("T-06", EX, "abm", "L'ABM remet lui-même en service après sa contre-visite", avancer(idd, "REMIS_EN_SERVICE"), True, "REMIS_EN_SERVICE")
C = en_service("BROBO", 3, "uh_b"); ic = incident("uh_b", C)
act("S-03", EX, "uh_b", "L'utilisateur de la moto n'avance pas l'incident", avancer(ic, "DIAGNOSTIC"), False, "")
must("zh", avancer(ic, "DIAGNOSTIC")); must("zh", avancer(ic, "CONTROLE")); must("zh", contre_visite("zh", C))
act("S-04", EX, "zh", "Le Chef de zone reste soumis à la séparation des tâches", avancer(ic, "REMIS_EN_SERVICE"), False, "Séparation des tâches")
for i in (1, 2):
    ok, err = psql_f(ROLLBACK); record(f"RB-0{i}", "Retour arrière rejouable", "postgres", f"Retour arrière 19 (passe {i})", "OK", ok, "OK" if ok else err)
act("RB-03", EX, "zh", "Après retour arrière : séparation rétablie", avancer(ic, "REMIS_EN_SERVICE"), False, "Séparation des tâches")
check("RB-04", EX, "Auto-remises déjà tracées conservées", f"select count(*) from public.moto_immobilisations where levee_motif like 'Auto-remise%' and source_id in ('{ia}','{idd}')", "2")
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI"); print(f"\nBilan : {ok}/{len(RESULTS)} réussis"); sys.exit(0 if ok == len(RESULTS) else 1)

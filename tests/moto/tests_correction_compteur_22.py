#!/usr/bin/env python3
"""
AFLP FLEET 22 : correction directe d'un relevé de compteur par le Branch Manager ou l'ABM.

Réplique LOCALE (migrations 1 à 19 = état de la production), comptes et motos FICTIFS,
chaque action sous le rôle `authenticated` (RLS active). Refuse toute cible Supabase.
Usage : PGHOST=… PGPORT=… python3 tests/moto/tests_correction_compteur_22.py <base_1_a_21 alignée>
"""
import json, os, subprocess, sys, uuid, datetime

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_apt_t"
ICI = os.path.dirname(os.path.abspath(__file__)); RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
OUT_DIR = os.path.join(ICI, "resultats")
import random; SERIE = random.randint(100, 899)
MIGRATION = os.path.join(RACINE, "supabase", "20261117090000_aflp_fleet_22_correction_compteur_bm_abm.sql")
ROLLBACK = os.path.join(RACINE, "supabase", "20261117090100_aflp_fleet_22_rollback.sql")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
U = {"bm": uid(2201), "abm": uid(2202), "lc": uid(2203), "zh": uid(2204), "uh_a": uid(2205), "uh_b": uid(2206), "uh_c": uid(2207), "fin": uid(2208)}
PROFILS = [  # (clé, nom, rôle, cluster, zone, fonction opérationnelle)
    ("bm", "BM22 FICTIF", "Branch Manager", None, None, None),
    ("abm", "ABM22 FICTIF", "Assistant Branch Manager", None, None, None),
    ("lc", "COORDINATEUR20 FICTIF", "Supervisor", None, None, "Logistics Coordinator"),
    ("zh", "ZH20 FICTIF", "Zonal Head", None, "GBEKE 1", None),
    ("uh_a", "UH13 A FICTIF", "Unit Head", "SAKASSOU", "GBEKE 1", None),
    ("uh_b", "UH13 B FICTIF", "Unit Head", "BROBO", "GBEKE 1", None),
    ("uh_c", "UH13 C FICTIF", "Unit Head", "BOTRO", "GBEKE 2", None),
    ("fin", "FINANCE22 FICTIF", "Finance Manager", None, None, None),
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
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}.m22@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
                 f"('{U[k]}', '{k}.m22@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, true) on conflict do nothing;")
    if fonction: setup.append(f"update public.profils set fonction_operationnelle = '{fonction}' where user_id = '{U[k]}';")
q("\n".join(setup))

def creer(cluster, origine="NEUVE"):
    p = {"marque": "APSONIC", "modele": "AP150-30 FICTIF", "cluster_code": cluster, "motif": "Moto de recette fictive"}
    p.update({"date_reception": str(today), "compteur_km": 3} if origine == "NEUVE" else {"origine": "EN_EXPLOITATION", "date_debut_utilisation": "2026-02-01"})
    return must("abm", "select public.moto_creer(" + lit(p) + ")")["id"]
def dossier_admin(moto, n):
    must("abm", f"select public.moto_modifier_identite('{moto}', '{{\"numero_chassis\":\"M22-FICTIF-CH-{SERIE}-{n:03d}\",\"immatriculation\":\"M10 {n:04d} FICTIF\"}}'::jsonb, 'Saisie identité recette')")
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
    must("bm", "select public.moto_permis_enregistrer(" + lit({"titulaire_id": U[benef], "nom_titulaire": "TITULAIRE FICTIF " + benef.upper(), "numero_permis": "M22-" + U[benef][-6:] + "-" + str(SERIE), "categories": ["A"], "sans_expiration": True, "document_path": p}) + ")")
def en_service(cluster, n, benef):
    m = creer(cluster); dossier_admin(m, n); must("abm", insp("abm", m))
    must("bm", f"select public.moto_preaffecter('{m}', '{U[benef]}', 'Affectation recette')")
    must("bm", "select public.moto_remettre(" + lit({"moto_id": m, "compteur_km": 12, "equipements": EQ}) + ")")
    must("bm", f"select public.moto_mettre_en_service('{m}', 'Autorisation recette')"); return m
T0 = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=5)   # après les relevés de mise en service, jamais à plus de 15 min dans le futur
def at(n): return (T0 + datetime.timedelta(seconds=n)).isoformat()   # n : secondes après T0
def releve(user, m, km, minutes): return "select public.moto_releve_km(" + lit({"moto_id": m, "compteur_km": km, "date_releve": at(minutes), "client_op_id": str(uuid.uuid4())}) + ")"
def controle(user, m, km, minutes): return "select public.moto_controle_depart(" + lit({"moto_id": m, "compteur_km": km, "date_controle": at(minutes), "items": items("AVANT_DEPART"), "client_op_id": str(uuid.uuid4())}) + ")"
def rid(m, km, src=None): return q(f"select id from public.moto_releves_km where moto_id='{m}' and compteur_km={km}" + (f" and source='{src}'" if src else "") + " order by date_releve desc limit 1")
def corriger(r, km, motif="Erreur de saisie : un chiffre en trop"): return f"select public.moto_releve_corriger('{r}', {km}, $m${motif}$m$)"
def compteur(m): return q(f"select compteur_actuel_km::numeric::text from public.moto_motos where id='{m}'")
EX = "Correction compteur BM/ABM"

deposer("uh_a"); A = en_service("SAKASSOU", 1, "uh_a")
must("uh_a", releve("uh_a", A, 100, 0))
must("uh_a", releve("uh_a", A, 260, 60)); R260 = rid(A, 260)
# Mission ouverte au départ de 260 km (insérée en fixture, liée au relevé de départ comme en production)
MI = str(uuid.uuid4())
q(f"insert into public.moto_missions (id, moto_id, conducteur_id, objet, destination, depart_releve_id, depart_km, depart_at, depart_origine, depart_gps_statut, depart_client_op_id) "
  f"values ('{MI}', '{A}', '{U['uh_a']}', 'SUPERVISION', 'Village fictif', '{R260}', 260, '{at(60)}', 'SAISI', 'ABSENT', '{uuid.uuid4()}')")
# Le cas de MOTO-003 : contrôle avant départ saisi 2602 au lieu de 260
must("uh_a", controle("uh_a", A, 2602, 61)); RBAD = rid(A, 2602, "CONTROLE")
check("AVANT-01", EX, "Compteur actuel bloqué à 2602 après la faute de frappe", f"select compteur_actuel_km::int from public.moto_motos where id='{A}'", "2602")
act("AVANT-02", EX, "uh_a", "Avant : l'agent ne peut plus relever 290 km (bloqué par 2602)", releve("uh_a", A, 290, 120), False, "CONFLIT_COMPTEUR")
act("AVANT-03", EX, "bm", "Avant migration : fonction absente", corriger(RBAD, 260), False, "")
for i in (1, 2):
    ok, err = psql_f(MIGRATION); record(f"MIG-0{i}", "Migration rejouable", "postgres", f"Migration 22 (passe {i})", "OK", ok, "OK" if ok else err)

for u, lab in (("uh_a", "Le conducteur"), ("zh", "Le chef de zone"), ("lc", "Le coordinateur logistique"), ("fin", "La Finance")):
    act(f"S-0{['uh_a','zh','lc','fin'].index(u)+1}", EX, u, f"{lab} ne corrige pas directement", corriger(RBAD, 260), False, "")
act("S-05", EX, "anon", "Anonyme refusé", corriger(RBAD, 260), False, "")
act("S-06", EX, "abm", "Motif trop court refusé", corriger(RBAD, 260, "erreur"), False, "otif")
act("S-07", EX, "abm", "Valeur identique refusée", corriger(RBAD, 2602), False, "identique")
act("S-08", EX, "abm", "Valeur négative refusée", corriger(RBAD, -5), False, "invalide")
act("S-09", EX, "abm", "Recul sous un relevé antérieur refusé (le compteur ne recule pas)", corriger(RBAD, 90), False, "ne recule pas")

# Une demande en attente (circuit classique) sur le même relevé, faite par le chef de zone
DEM = must("zh", "select public.moto_correction_demander(" + lit({"cible_table": "moto_releves_km", "cible_id": RBAD, "champ": "compteur_km", "nouvelle_valeur": "260", "motif": "Faute de frappe signalée par le chef de zone"}) + ")")["id"]

r = act("T-01", EX, "abm", "L'ABM corrige 2602 → 260 directement", corriger(RBAD, 260), True, '"nouveau_km": 260')
check("T-02", EX, "Relevé corrigé à 260", f"select compteur_km::int from public.moto_releves_km where id='{RBAD}'", "260")
check("T-03", EX, "Contrôle avant départ d'origine aligné à 260", f"select compteur_km::int from public.moto_controles where moto_id='{A}' and type_controle='AVANT_DEPART' order by date_controle desc limit 1", "260")
check("T-04", EX, "Compteur actuel de la moto recalculé à 260", f"select compteur_actuel_km::int from public.moto_motos where id='{A}'", "260")
check("T-05", EX, "Trace : correction APPLIQUEE, auteur ABM, 2602 → 260, motif conservé",
      f"select statut||'/'||(demande_par='{U['abm']}')||'/'||ancienne_valeur::numeric::int||'→'||nouvelle_valeur::numeric::int||'/'||motif from public.moto_corrections where cible_id='{RBAD}' and statut='APPLIQUEE'",
      "APPLIQUEE/true/2602→260/Erreur de saisie : un chiffre en trop")
check("T-06", EX, "Demande en attente close (REJETEE, remplacée)", f"select statut||'/'||decision_motif from public.moto_corrections where id='{DEM}'", "REJETEE/Remplacée par une correction directe du ABM")
check("T-07", EX, "Journal : modification du relevé avec auteur ABM et motif", f"select count(*) from public.moto_journal where table_nom='moto_releves_km' and enregistrement_id='{RBAD}' and action='UPDATE' and auteur='{U['abm']}' and motif like 'Correction du compteur (ABM)%'", "1")
act("T-08", EX, "uh_a", "Après correction : l'agent relève à nouveau 290 km", releve("uh_a", A, 290, 120), True, "290")
act("T-09", EX, "bm", "Le BM corrige le départ de mission 260 → 258 : la mission suit", corriger(R260, 258, "Compteur de départ mal lu sur la photo"), True, '"missions_alignees": 1')
check("T-10", EX, "Départ de la mission aligné à 258", f"select depart_km::int from public.moto_missions where id='{MI}'", "258")
act("S-10", EX, "bm", "Dépassement d'un relevé postérieur refusé", corriger(R260, 295, "Valeur supérieure au relevé suivant"), False, "postérieur")
# Achat de carburant saisi avec un compteur faux
km_achat = 2950
path = f"{A}/justificatif/{uuid.uuid4()}.jpg"; put_object(path)
C1 = must("uh_a", "select public.moto_carburant_declarer(" + lit({"moto_id": A, "date_achat": at(180), "compteur_km": km_achat, "litres": 3, "montant": 2715, "plein_complet": False, "financement": "DOTATION", "client_op_id": str(uuid.uuid4()), "justificatif_path": path}) + ")")["id"]
RC = rid(A, km_achat, "CARBURANT")
act("T-11", EX, "bm", "Le BM corrige le compteur d'un achat de carburant 2950 → 295", corriger(RC, 295, "Faute de frappe sur le reçu carburant"), True, '"achats_alignes": 1')
check("T-12", EX, "Achat de carburant aligné à 295, compteur actuel 295", f"select (select compteur_km::int from public.moto_carburant where id='{C1}')||'/'||(select compteur_actuel_km::int from public.moto_motos where id='{A}')", "295/295")
act("S-11", EX, "abm", "Relevé inexistant", corriger(str(uuid.uuid4()), 300), False, "introuvable")
# Le circuit classique reste disponible
D2 = must("zh", "select public.moto_correction_demander(" + lit({"cible_table": "moto_releves_km", "cible_id": rid(A, 290), "champ": "compteur_km", "nouvelle_valeur": "291", "motif": "Lecture photo : 291 et non 290"}) + ")")["id"]
act("T-13", EX, "bm", "Circuit classique inchangé : demande du chef de zone validée par le BM", f"select public.moto_correction_decider('{D2}', 'APPLIQUEE', null)", True, "APPLIQUEE")
for i in (1, 2):
    ok, err = psql_f(ROLLBACK); record(f"RB-0{i}", "Retour arrière rejouable", "postgres", f"Retour arrière 22 (passe {i})", "OK", ok, "OK" if ok else err)
act("RB-03", EX, "bm", "Après retour arrière : correction directe impossible", corriger(RC, 296), False, "")
check("RB-04", EX, "Traces des corrections conservées", f"select count(*) from public.moto_corrections where cible_table='moto_releves_km' and statut='APPLIQUEE' and decision_motif like 'Correction directe%'", "3")
os.makedirs(OUT_DIR, exist_ok=True)
json.dump({"suite": "correction_compteur_22", "date": datetime.datetime.now().isoformat(), "resultats": RESULTS}, open(os.path.join(OUT_DIR, "correction_compteur_22.json"), "w"), ensure_ascii=False, indent=1)
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI"); print(f"\nBilan : {ok}/{len(RESULTS)} réussis"); sys.exit(0 if ok == len(RESULTS) else 1)

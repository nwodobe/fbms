#!/usr/bin/env python3
"""
AFLP FLEET 20 : suppression d'un achat de carburant par le Branch Manager seul.

Réplique LOCALE (migrations 1 à 19 = état de la production), comptes et motos FICTIFS,
chaque action sous le rôle `authenticated` (RLS active). Refuse toute cible Supabase.
Usage : PGHOST=… PGPORT=… python3 tests/moto/tests_suppression_carburant_20.py <base_1_a_19>
"""
import json, os, subprocess, sys, uuid, datetime

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_apt_t"
ICI = os.path.dirname(os.path.abspath(__file__)); RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
OUT_DIR = os.path.join(ICI, "resultats")
import random; SERIE = random.randint(100, 899)
MIGRATION = os.path.join(RACINE, "supabase", "20261115090000_aflp_fleet_20_suppression_carburant_bm.sql")
ROLLBACK = os.path.join(RACINE, "supabase", "20261115090100_aflp_fleet_20_rollback.sql")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
U = {"bm": uid(2001), "abm": uid(2002), "lc": uid(2003), "zh": uid(2004), "uh_a": uid(2005), "uh_b": uid(2006), "uh_c": uid(2007)}
PROFILS = [  # (clé, nom, rôle, cluster, zone, fonction opérationnelle)
    ("bm", "BM20 FICTIF", "Branch Manager", None, None, None),
    ("abm", "ABM20 FICTIF", "Assistant Branch Manager", None, None, None),
    ("lc", "COORDINATEUR20 FICTIF", "Supervisor", None, None, "Logistics Coordinator"),
    ("zh", "ZH20 FICTIF", "Zonal Head", None, "GBEKE 1", None),
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
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}.m20@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
                 f"('{U[k]}', '{k}.m20@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, true) on conflict do nothing;")
    if fonction: setup.append(f"update public.profils set fonction_operationnelle = '{fonction}' where user_id = '{U[k]}';")
q("\n".join(setup))

def creer(cluster, origine="NEUVE"):
    p = {"marque": "APSONIC", "modele": "AP150-30 FICTIF", "cluster_code": cluster, "motif": "Moto de recette fictive"}
    p.update({"date_reception": str(today), "compteur_km": 3} if origine == "NEUVE" else {"origine": "EN_EXPLOITATION", "date_debut_utilisation": "2026-02-01"})
    return must("abm", "select public.moto_creer(" + lit(p) + ")")["id"]
def dossier_admin(moto, n):
    must("abm", f"select public.moto_modifier_identite('{moto}', '{{\"numero_chassis\":\"M20-FICTIF-CH-{SERIE}-{n:03d}\",\"immatriculation\":\"M10 {n:04d} FICTIF\"}}'::jsonb, 'Saisie identité recette')")
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
    must("bm", "select public.moto_permis_enregistrer(" + lit({"titulaire_id": U[benef], "nom_titulaire": "TITULAIRE FICTIF " + benef.upper(), "numero_permis": "M20-" + U[benef][-6:] + "-" + str(SERIE), "categories": ["A"], "sans_expiration": True, "document_path": p}) + ")")
def en_service(cluster, n, benef):
    m = creer(cluster); dossier_admin(m, n); must("abm", insp("abm", m))
    must("bm", f"select public.moto_preaffecter('{m}', '{U[benef]}', 'Affectation recette')")
    must("bm", "select public.moto_remettre(" + lit({"moto_id": m, "compteur_km": 12, "equipements": EQ}) + ")")
    must("bm", f"select public.moto_mettre_en_service('{m}', 'Autorisation recette')"); return m
km = [20]
def achat(user, m):
    km[0] += 10; path = f"{m}/justificatif/{uuid.uuid4()}.jpg"; put_object(path)
    return must(user, "select public.moto_carburant_declarer(" + lit({"moto_id": m, "date_achat": datetime.datetime.now(datetime.timezone.utc).isoformat(), "compteur_km": km[0], "litres": 3, "montant": 2850, "plein_complet": False, "financement": "DOTATION", "client_op_id": str(uuid.uuid4()), "justificatif_path": path}) + ")")["id"]
def supprimer(c, motif="Saisie de test du Branch Manager"): return f"select public.moto_carburant_supprimer('{c}', $m${motif}$m$)"
EX = "Suppression carburant BM"
deposer("uh_a"); A = en_service("SAKASSOU", 1, "uh_a")
c1 = achat("bm", A); c2 = achat("uh_a", A); c3 = achat("uh_a", A); c4 = achat("uh_a", A)
act("AVANT-01", EX, "bm", "Avant : fonction absente", supprimer(c1), False, "")
for i in (1, 2):
    ok, err = psql_f(MIGRATION); record(f"MIG-0{i}", "Migration rejouable", "postgres", f"Migration 20 (passe {i})", "OK", ok, "OK" if ok else err)
act("S-01", EX, "abm", "L'ABM ne supprime pas", supprimer(c2), False, "rôle")
act("S-02", EX, "uh_a", "Le conducteur ne supprime pas son achat", supprimer(c2), False, "rôle")
act("S-03", EX, "anon", "Anonyme refusé", supprimer(c2), False, "")
act("S-04", EX, "bm", "Motif trop court refusé", supprimer(c1, "test"), False, "otif")
act("T-01", EX, "bm", "Le BM supprime sa saisie de test", supprimer(c1), True, '"supprime": true')
check("T-02", EX, "Ligne absente de moto_carburant", f"select count(*) from public.moto_carburant where id='{c1}'", "0")
check("T-03", EX, "Journal : ligne complète, auteur BM et motif conservés", f"select (ancienne_valeur->>'montant')||'/'||(auteur='{U['bm']}')||'/'||motif from public.moto_journal where table_nom='moto_carburant' and enregistrement_id='{c1}' and action='DELETE'", "2850/true/Saisie de test du Branch Manager")
act("T-04", EX, "bm", "Le BM supprime un achat d'un conducteur (non vérifié)", supprimer(c2, "Doublon de saisie constaté"), True, '"supprime": true')
must("abm", f"select public.moto_justificatif_verifier('{c3}', 'VERIFIE')")
act("S-05", EX, "bm", "Justificatif vérifié par un autre : suppression refusée", supprimer(c3), False, "vérifié")
must("abm", f"select public.moto_justificatif_verifier('{c4}', 'REJETE', 'Reçu illisible')")
act("T-05", EX, "bm", "Justificatif rejeté : suppression acceptée", supprimer(c4, "Reçu rejeté, saisie annulée"), True, '"supprime": true')
check("T-06", EX, "Le relevé kilométrique de l'achat supprimé est conservé", f"select (count(*)>0)::text from public.moto_releves_km where moto_id='{A}' and source='CARBURANT'", "true")
act("S-06", EX, "bm", "Achat inexistant", supprimer(c1), False, "introuvable")
for i in (1, 2):
    ok, err = psql_f(ROLLBACK); record(f"RB-0{i}", "Retour arrière rejouable", "postgres", f"Retour arrière 20 (passe {i})", "OK", ok, "OK" if ok else err)
act("RB-03", EX, "bm", "Après retour arrière : suppression impossible", supprimer(c3), False, "")
check("RB-04", EX, "Traces de suppression conservées", f"select count(*) from public.moto_journal where table_nom='moto_carburant' and action='DELETE' and enregistrement_id in ('{c1}','{c2}','{c4}')", "3")
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI"); print(f"\nBilan : {ok}/{len(RESULTS)} réussis"); sys.exit(0 if ok == len(RESULTS) else 1)

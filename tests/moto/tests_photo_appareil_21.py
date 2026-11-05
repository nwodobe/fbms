#!/usr/bin/env python3
"""
AFLP FLEET 21 — photo du compteur prise avec l'appareil photo du téléphone : acceptée, signalée.
(Tête reprise de la recette 8 : comptes, motos et photos FICTIFS.)

À exécuter après les suites 1 à 7 sur la même base. Chaque action s'exécute
SOUS LE RÔLE `authenticated` (RLS active) ou `anon`, avec des comptes FICTIFS.
Aucune donnée réelle : comptes, motos, compteurs, positions et photos sont
inventés pour le test (positions : points fictifs arrondis, sans lien avec une parcelle).

Usage : PGHOST=/srv/pgtest PGPORT=54329 python3 tests/moto/tests_missions_8.py fbms_moto_test
Sortie : tests/moto/resultats/missions_8.json + tableau Markdown.
"""
import json, os, subprocess, sys, uuid, datetime, threading, secrets

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_test"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultats")

def uid(n): return f"00000000-0000-4000-8000-{n+21000:012d}"
U = {"bm": uid(301), "abm": uid(302), "lc": uid(303), "zh": uid(304), "uh_a": uid(305), "uh_b": uid(306),
     "fin": uid(307), "dir": uid(308), "uh_np": uid(309), "uh_c": uid(310), "zh_b": uid(311)}
PROFILS = [
    ("bm", "BM8 FICTIF", "Branch Manager", None, None, None),
    ("abm", "ABM8 FICTIF", "Assistant Branch Manager", None, None, None),
    ("lc", "COORDINATEUR8 FICTIF", "Supervisor", None, None, "Logistics Coordinator"),
    ("zh", "ZH8 FICTIF", "Zonal Head", None, "GBEKE 1", None),
    ("zh_b", "ZH8 B FICTIF", "Zonal Head", None, "GBEKE 1", None),
    ("uh_a", "UH8 A FICTIF", "Unit Head", "SAKASSOU", "GBEKE 1", None),
    ("uh_b", "UH8 B FICTIF", "Unit Head", "BROBO", "GBEKE 1", None),
    ("uh_c", "UH8 C FICTIF", "Unit Head", "BOTRO", "GBEKE 1", None),
    ("uh_np", "UH8 SANS PERMIS FICTIF", "Unit Head", "SAKASSOU", "GBEKE 1", None),
    ("fin", "FINANCE8 FICTIF", "Finance", None, None, None),
    ("dir", "DIRECTION8 FICTIF", "General Manager", None, None, None),
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
def record(tid, sc, user, label, attendu, ok, obtenu):
    RESULTS.append({"id": tid, "domaine": sc, "compte": user, "action": label, "attendu": attendu,
                    "obtenu": obtenu[:300], "resultat": "RÉUSSI" if ok else "ÉCHOUÉ"})
    if not ok: print(f"ÉCHEC {tid} [{user}] {label} — attendu {attendu} — obtenu {obtenu[:240]}", file=sys.stderr, flush=True)

def act(tid, sc, user, label, sql, expect_ok=True, contains=None):
    ok, out = run_as(user, sql)
    passed = (ok == expect_ok) and (contains is None or contains.lower() in out.lower())
    record(tid, sc, user, label, ("OK" if expect_ok else "REFUS") + (f" ({contains})" if contains else ""), passed,
           ("OK : " if ok else "REFUS : ") + out)
    try: return json.loads(out) if ok and out.startswith(("{", "[")) else out
    except Exception: return out

def check(tid, sc, label, sql, expected):
    try: got = q(sql)
    except Exception as e: got = f"ERREUR {e}"
    record(tid, sc, "postgres (lecture)", label, str(expected), got == str(expected), got)
    return got

def lit(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
now = datetime.datetime.now(datetime.timezone.utc)
def t(minutes): return (now + datetime.timedelta(minutes=minutes)).isoformat()
today = datetime.date.today()
def d(days): return str(today + datetime.timedelta(days=days))

# ---------------------------------------------------------------------------
# Préparation : comptes, permis et motos fictifs
# ---------------------------------------------------------------------------
setup = []
for k, nom, role, cluster, zone, fonction in PROFILS:
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}21@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, fonction_operationnelle, actif) values "
                 f"('{U[k]}', '{k}21@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, {('$f$'+fonction+'$f$') if fonction else 'null'}, true) on conflict do nothing;")
q("\n".join(setup))

def permis_fixture(user):
    dep = U['lc'] if user in ('abm', 'bm') else U['abm']
    verif = U['abm'] if user == 'bm' else U['bm']
    q(f"""insert into public.moto_permis (titulaire_id, nom_titulaire, numero_permis, categories, date_expiration, document_path, statut,
            verification_rh_nom, categorie_adaptee, depose_par, verifie_par, verifie_at)
          select '{U[user]}', 'TITULAIRE FICTIF', 'FX8-{U[user][-6:]}', '{{A}}', current_date + 700, 'permis/{U[user]}/fixture8.pdf', 'CONFORME',
                 'RH FICTIF', true, '{dep}', '{verif}', now()
          where not exists (select 1 from public.moto_permis where titulaire_id = '{U[user]}' and statut = 'CONFORME')""")

def moto(user_benef, km0, cluster="SAKASSOU", en_service=True, permis=True, zone="GBEKE 1"):
    ok, out = run_as("abm", "select public.moto_creer(" + lit({"marque": "APSONIC", "modele": "AP150-30", "cluster_code": cluster,
                     "date_reception": d(-11), "motif": "Moto de test migration 8 (fictive)"}) + ")")
    if not ok: raise RuntimeError(out)
    mid = json.loads(out)["id"]
    if permis: permis_fixture(user_benef)
    debut = "now() - interval '10 days'"
    q(f"""update public.moto_motos set mise_en_service_at = {'(' + debut + ')' if en_service else 'null'}, statut_affectation = 'REMISE',
                 compteur_actuel_km = {km0}, origine = 'NEUVE' where id = '{mid}';
          insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, statut, date_debut, compteur_km, motif, cree_par)
          select '{mid}', '{U[user_benef]}', '{cluster}', 'REMISE', 'ACTIVE', ({debut})::date, {km0}, 'Fixture test M8', '{U['abm']}'
          where {'true' if permis else 'false'};
          insert into public.moto_releves_km (moto_id, date_releve, compteur_km, source, saisi_par) values ('{mid}', {debut}, {km0}, 'REMISE', '{U['abm']}');
          insert into public.moto_controles (moto_id, type_controle, date_controle, compteur_km, items, anomalie_critique, resultat, realise_par)
          values ('{mid}', 'INSPECTION_INITIALE', {debut} - interval '1 hour', {km0}, '[]', false, 'APTE', '{U['abm']}');
          select private.moto_recalculer_statuts('{mid}');""")
    return mid

M1 = moto("uh_a", 1000)                      # moto de l'agent A
M2 = moto("uh_b", 5000, "BROBO")             # moto de l'agent B
M3 = moto("uh_c", 300, "BOTRO", en_service=False)   # pas encore mise en service
M4 = moto("zh", 7000, "SAKASSOU")            # moto du Chef de zone, à immobiliser
M5 = moto("uh_np", 2000, "SAKASSOU", permis=False)  # moto libre (aucune affectation)
permis_fixture("uh_b"); permis_fixture("zh"); permis_fixture("uh_a")

def photo(user, moto_id, client, taille=42000, mime="image/jpeg", deposer=True, deposant=None, etag=None):
    chemin = f"{moto_id}/mission/{client}-photo_path.jpg"
    if deposer:
        m = {"size": taille, "mimetype": mime}
        if etag != "ABSENT": m["eTag"] = '"' + (etag or secrets.token_hex(16)) + '"'
        meta = json.dumps(m)
        ok, out = run_as(deposant or user, f"insert into storage.objects (bucket_id, name, metadata) values ('moto-documents', '{chemin}', '{meta}'::jsonb)")
        if not ok: raise RuntimeError("dépôt photo : " + out)
    return chemin

def charge(user, moto_id, km, minutes, origine="LU_CONFIRME", lu="=", mission_id=None, gps=True, horloge=0, objet="ACHAT_COLLECTE",
           destination="VILLAGE FICTIF A", deposer=True, deposant=None, taille=42000, sha=None, client=None, etag=None, **extra):
    client = client or str(uuid.uuid4())
    p = {"client_op_id": client, "moto_id": moto_id, "compteur_km": km, "capture_at": t(minutes), "origine": origine,
         "objet": objet, "destination": destination, "localite": "LOCALITE FICTIVE", "horloge_envoi": t(-horloge),
         "photo_path": photo(user, moto_id, client, taille=taille, deposer=deposer, deposant=deposant, etag=etag), "photo_sha256": sha or secrets.token_hex(32)}
    if origine != "SAISI": p["lu_km"] = km if lu == "=" else lu
    if mission_id: p["mission_id"] = mission_id
    if gps: p.update({"latitude": 7.5, "longitude": -5.0, "precision_m": 12, "gps_at": t(minutes), "gps_statut": "OK"})
    p.update(extra)
    return p

def demarrer(tid, user, label, p, ok=True, contains=None):
    return act(tid, "Départ", user, label, "select public.moto_mission_demarrer(" + lit(p) + ")", ok, contains)
def cloturer(tid, user, label, p, ok=True, contains=None):
    return act(tid, "Arrivée", user, label, "select public.moto_mission_cloturer(" + lit(p) + ")", ok, contains)


RACINE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
MIG = os.path.join(RACINE, "supabase", "20261116090000_aflp_fleet_21_photo_appareil_telephone.sql")
RB = os.path.join(RACINE, "supabase", "20261116090100_aflp_fleet_21_rollback.sql")
def psql_f(f):
    r = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", f], capture_output=True, text=True)
    return r.returncode == 0, r.stderr[-300:]
def ecarts(mid): return q(f"select coalesce(string_agg(type_anomalie, ',' order by type_anomalie), '') from public.moto_mission_anomalies where mission_id='{mid}'")
EX = "Photo par l'appareil du téléphone"
for i in (1, 2):
    ok, err = psql_f(MIG); record(f"MIG-0{i}", "Migration rejouable", "postgres", f"Migration 21 (passe {i})", "OK", ok, "OK" if ok else err)

# 1. Caméra de l'application (aucun champ photo_source) : rien de nouveau.
r = demarrer("T-01", "uh_a", "Départ caméra de l'application : accepté", charge("uh_a", M1, 1000, -120), True, "OUVERTE")
MA = r["id"]
check("T-02", EX, "Aucun écart PHOTO_IMPORTEE", f"select count(*) from public.moto_mission_anomalies where mission_id='{MA}' and type_anomalie='PHOTO_IMPORTEE'", "0")
cloturer("T-03", "uh_a", "Arrivée caméra de l'application", charge("uh_a", M1, 1010, -60, mission_id=MA), True, "CLOTUREE")

# 2. Appareil photo du téléphone, photo fraîche : acceptée ET signalée.
p = charge("uh_b", M2, 5000, -30, photo_source="APPAREIL", photo_fichier_at=t(-31))
r = demarrer("T-04", "uh_b", "Départ avec l'appareil photo du téléphone : accepté", p, True, "OUVERTE")
MB = r["id"]
check("T-05", EX, "Écart PHOTO_IMPORTEE à vérifier", f"select statut from public.moto_mission_anomalies where mission_id='{MB}' and type_anomalie='PHOTO_IMPORTEE'", "A_VERIFIER")
check("T-06", EX, "Âge du fichier relevé (1 min)", f"select valeur from public.moto_mission_anomalies where mission_id='{MB}' and type_anomalie='PHOTO_IMPORTEE'", "1.0")
check("T-07", EX, "Le détail dit « peut venir de la galerie »", f"select (detail like '%(depart)%galerie%Fichier daté du%')::text from public.moto_mission_anomalies where mission_id='{MB}' and type_anomalie='PHOTO_IMPORTEE'", "true")
check("T-08", EX, "Visible dans la vue des écarts", f"select count(*) from public.moto_v_mission_ecarts where mission_id='{MB}' and type_anomalie='PHOTO_IMPORTEE'", "1")
# Arrivée aussi importée, photo ancienne (galerie) : un seul écart, détail complété.
cloturer("T-09", "uh_b", "Arrivée avec une photo datée de 3 jours : acceptée", charge("uh_b", M2, 5020, -10, mission_id=MB, photo_source="APPAREIL", photo_fichier_at=t(-60*24*3)), True, "CLOTUREE")
check("T-10", EX, "Un seul écart, détail départ + arrivée", f"select count(*)||'/'||(detail like '%(depart)%|%(arrivee)%')::text from public.moto_mission_anomalies where mission_id='{MB}' and type_anomalie='PHOTO_IMPORTEE' group by detail", "1/true")

# 3. Les garde-fous restent.
r = demarrer("S-00", "uh_b", "Nouveau départ appareil (heure de fichier absente) : accepté", charge("uh_b", M2, 5020, -5, photo_source="APPAREIL"), True, "OUVERTE")
MC = r["id"]
check("S-01", EX, "Heure de fichier inconnue : écart quand même", f"select (detail like '%Heure du fichier inconnue%')::text from public.moto_mission_anomalies where mission_id='{MC}' and type_anomalie='PHOTO_IMPORTEE'", "true")
sha_vieux = q(f"select sha256 from public.moto_mission_photos where mission_id='{MB}' and moment='DEPART'")
cloturer("S-02", "uh_b", "Réutiliser une photo déjà envoyée (même empreinte) : refusé", charge("uh_b", M2, 5030, -2, mission_id=MC, photo_source="APPAREIL", photo_fichier_at=t(-3), sha=sha_vieux), False, "déjà été utilisée")
cloturer("S-03", "uh_b", "Compteur d'arrivée qui recule : refusé", charge("uh_b", M2, 5000, -2, mission_id=MC, photo_source="APPAREIL", photo_fichier_at=t(-3)), False, None)
cloturer("S-04", "uh_b", "Photo trop lourde : refusée", charge("uh_b", M2, 5030, -2, mission_id=MC, photo_source="APPAREIL", photo_fichier_at=t(-3), taille=900000), False, "trop lourde")
cloturer("S-05", "uh_b", "Valeur photo_fichier_at illisible : acceptée, signalée", charge("uh_b", M2, 5030, -2, mission_id=MC, photo_source="APPAREIL", photo_fichier_at="pas une date"), True, "CLOTUREE")

for i in (1, 2):
    ok, err = psql_f(RB)
    record(f"RB-0{i}", "Retour arrière", "postgres", f"Retour arrière 21 refusé tant que des écarts existent (passe {i})", "refus", (not ok) and "existent" in err, err[-160:] if err else "OK")
q("alter table public.moto_mission_anomalies disable trigger user; delete from public.moto_mission_anomalies where type_anomalie='PHOTO_IMPORTEE'; alter table public.moto_mission_anomalies enable trigger user")
for i in (3, 4):
    ok, err = psql_f(RB); record(f"RB-0{i}", "Retour arrière", "postgres", f"Retour arrière 21 sur base de recette vidée (passe {i})", "OK", ok, "OK" if ok else err)
check("RB-05", "Retour arrière", "Fonction sans signalement", "select (position('PHOTO_IMPORTEE' in pg_get_functiondef('private.moto_mission_photo(uuid,uuid,uuid,text,jsonb)'::regprocedure)) = 0)::text", "true")
for r in RESULTS: print(("✓ " if r["resultat"] == "RÉUSSI" else "✗ ") + r["id"] + " " + r["action"] + " — " + r["obtenu"][:110])
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI"); print(f"\nBilan : {ok}/{len(RESULTS)} réussis"); sys.exit(0 if ok == len(RESULTS) else 1)

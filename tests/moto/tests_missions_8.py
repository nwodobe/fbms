#!/usr/bin/env python3
"""
AFLP FLEET — recette de la migration 8 (journal de mission, kilométrage contrôlé par photo).

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

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
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
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}8@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, fonction_operationnelle, actif) values "
                 f"('{U[k]}', '{k}8@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
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
        meta = json.dumps({"size": taille, "mimetype": mime, "eTag": '"' + (etag or secrets.token_hex(16)) + '"'})
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

# ===========================================================================
# D. Départ
# ===========================================================================
p1 = charge("uh_a", M1, 1000, -120)
r1 = demarrer("D01", "uh_a", "L'agent démarre une mission (lecture proposée confirmée)", p1, True, "OUVERTE")
MI1 = r1["id"] if isinstance(r1, dict) else None
demarrer("D02", "uh_a", "Renvoi de la même opération (rejeu hors ligne)", p1, True, "doublon")
check("D02b", "Départ", "Le rejeu n'a créé ni mission ni relevé en double",
      f"select (select count(*) from public.moto_missions where moto_id='{M1}')||'/'||(select count(*) from public.moto_releves_km where moto_id='{M1}' and source='MISSION')", "1/1")
demarrer("D03", "uh_a", "Deuxième mission ouverte sur la même moto", charge("uh_a", M1, 1001, -110), False, "déjà ouverte")
demarrer("D04", "uh_b", "Un agent démarre une mission sur la moto d'un autre", charge("uh_b", M1, 1001, -110, deposant="uh_a"), False, "périmètre")
demarrer("D05", "uh_c", "Moto non mise en service", charge("uh_c", M3, 300, -110, deposant="abm"), False, "non mise en service")
q(f"insert into public.moto_immobilisations (moto_id, motif, source_type, ouverte_par) values ('{M4}', 'Immobilisation fictive de test', 'DECISION', '{U['abm']}'); select private.moto_recalculer_statuts('{M4}')")
demarrer("D06", "zh", "Moto immobilisée", charge("zh", M4, 7000, -110), False, "immobilisée")
demarrer("D07", "abm", "Conducteur sans permis vérifié (l'ABM, sur une moto libre)", charge("abm", M5, 2000, -110), False, "permis")
demarrer("D08", "uh_b", "Compteur de départ inférieur au dernier relevé (compteur qui recule)", charge("uh_b", M2, 4990, -110), False, "CONFLIT_COMPTEUR")
pp = charge("uh_b", M2, 5000, -110); pp.pop("photo_path")
demarrer("D09", "uh_b", "Départ sans photo", pp, False, "Photo du compteur obligatoire")
demarrer("D10", "uh_b", "Photo annoncée mais jamais déposée", charge("uh_b", M2, 5000, -110, deposer=False), False, "introuvable")
demarrer("D11", "uh_b", "Photo déposée par une autre personne", charge("uh_b", M2, 5000, -110, deposant="abm"), False, "conducteur lui-même")
demarrer("D12", "uh_b", "Photo trop lourde (non compressée)", charge("uh_b", M2, 5000, -110, taille=900000), False, "trop lourde")
pc = charge("uh_b", M2, 5000, -110); pc["photo_path"] = f"{M2}/mission/{uuid.uuid4()}-photo_path.jpg"
demarrer("D13", "uh_b", "Chemin de photo d'une autre opération", pc, False, "chemin inattendu")
demarrer("D14", "uh_b", "Lecture « confirmée » différente du compteur transmis", charge("uh_b", M2, 5000, -110, lu=5009), False, "LU_CORRIGE attendue")
demarrer("D14b", "uh_b", "Saisie manuelle accompagnée d'une lecture", charge("uh_b", M2, 5000, -110, origine="SAISI", lu=5000, lu_km=5000), False, "aucune lecture")
demarrer("D14c", "uh_b", "Lecture « corrigée » identique à la proposition", charge("uh_b", M2, 5000, -110, origine="LU_CORRIGE", lu=5000), False, "LU_CONFIRME attendue")
demarrer("D15", "uh_b", "Heure de capture dans le futur", charge("uh_b", M2, 5000, 60), False, "futur")
demarrer("D15b", "uh_b", "Capture trop ancienne (au-delà du délai hors connexion)", charge("uh_b", M2, 5000, -60 * 24 * 9), False, "trop ancienne")
demarrer("D16", "uh_b", "Objet de mission inconnu", charge("uh_b", M2, 5000, -110, objet="PROMENADE"), False, "Objet de mission inconnu")
demarrer("D16b", "uh_b", "Objet « autre » sans précision", charge("uh_b", M2, 5000, -110, objet="AUTRE"), False, "check")
demarrer("D17", "uh_b", "Destination vide", charge("uh_b", M2, 5000, -110, destination=" "), False, "Destination obligatoire")
act("D18", "Départ", "fin", "La Finance démarre une mission", "select public.moto_mission_demarrer(" + lit(charge("uh_b", M2, 5000, -110)) + ")", False, "rôle")
act("D19", "Départ", "anon", "Anonyme démarre une mission", "select public.moto_mission_demarrer('{}'::jsonb)", False, "permission")
check("D20", "Départ", "Aucun refus n'a laissé de mission, de relevé ou de photo enregistrée sur la moto B",
      f"select (select count(*) from public.moto_missions where moto_id='{M2}')||'/'||(select count(*) from public.moto_releves_km where moto_id='{M2}' and source='MISSION')||'/'||(select count(*) from public.moto_mission_photos ph join public.moto_missions m on m.id=ph.mission_id where m.moto_id='{M2}')", "0/0/0")

# ===========================================================================
# A. Arrivée
# ===========================================================================
a_autre = charge("uh_a", M1, 1042, -60, mission_id=MI1)
cloturer("A01", "zh", "Un autre que le conducteur clôture la mission", {**a_autre, "client_op_id": str(uuid.uuid4())}, False, "Seul le conducteur")
cloturer("A02", "uh_a", "Compteur d'arrivée inférieur au départ", charge("uh_a", M1, 990, -60, mission_id=MI1), False, "inférieur au compteur de départ")
pa = charge("uh_a", M1, 1042, -60, mission_id=MI1); pa.pop("photo_path")
cloturer("A03", "uh_a", "Arrivée sans photo", pa, False, "Photo du compteur obligatoire")
sha_dep = q(f"select sha256 from public.moto_mission_photos where mission_id='{MI1}' and moment='DEPART'")
cloturer("A04", "uh_a", "Arrivée avec la photo du départ (même empreinte)", charge("uh_a", M1, 1042, -60, mission_id=MI1, sha=sha_dep), False, "déjà été utilisée")
cloturer("A04b", "uh_a", "Heure d'arrivée antérieure au départ", charge("uh_a", M1, 1042, -130, mission_id=MI1), False, "antérieure au départ")
cloturer("A05", "uh_a", "Clôture correcte (lecture corrigée par l'agent)", charge("uh_a", M1, 1042, -60, mission_id=MI1, origine="LU_CORRIGE", lu=1047), True, "CLOTUREE")
check("A05b", "Arrivée", "Distance, origines et lecture proposée conservées",
      f"select distance_km||'|'||depart_origine||'|'||arrivee_origine||'|'||arrivee_lu_km from public.moto_v_missions where id='{MI1}'", "42.0|LU_CONFIRME|LU_CORRIGE|1047.0")
check("A05c", "Arrivée", "Le compteur de la moto est mis à jour (échéances d'entretien)", f"select compteur_actuel_km from public.moto_motos where id='{M1}'", "1042.0")
check("A05d", "Arrivée", "Deux vrais relevés de source MISSION", f"select count(*) from public.moto_releves_km where moto_id='{M1}' and source='MISSION'", "2")
check("A05e", "Arrivée", "Positions de départ et d'arrivée enregistrées à part", f"select count(*) from public.moto_mission_positions where mission_id='{MI1}'", "2")
cloturer("A06", "uh_a", "Seconde clôture de la même mission", charge("uh_a", M1, 1050, -50, mission_id=MI1), False, "déjà clôturée")
cloturer("A07", "uh_a", "Clôture d'une mission inexistante", charge("uh_a", M1, 1050, -50, mission_id=str(uuid.uuid4())), False, "introuvable")

# ===========================================================================
# E. Écarts signalés pour vérification (jamais une sanction)
# ===========================================================================
r2 = demarrer("E01", "uh_a", "Départ 18 km après la fin de la mission précédente", charge("uh_a", M1, 1060, -40, origine="SAISI"), True, "HORS_MISSION")
MI2 = r2["id"] if isinstance(r2, dict) else None
check("E01b", "Écarts", "Kilomètres hors mission calculés", f"select km_hors_mission_avant from public.moto_v_missions where id='{MI2}'", "18.0")
cloturer("E02", "uh_a", "300 km en 10 minutes : vitesse et distance hors norme", charge("uh_a", M1, 1360, -30, mission_id=MI2), True, "VITESSE")
check("E02b", "Écarts", "Écarts VITESSE et DISTANCE enregistrés", f"select string_agg(type_anomalie, ',' order by type_anomalie) from public.moto_mission_anomalies where mission_id='{MI2}'", "DISTANCE,HORS_MISSION,VITESSE")
r3 = demarrer("E03", "uh_a", "Compteur 200 km au-delà du dernier relevé (photo d'une autre moto ?)", charge("uh_a", M1, 1560, -20), True, "CONTINUITE")
MI3 = r3["id"] if isinstance(r3, dict) else None
cloturer("E04", "uh_a", "Horloge du téléphone décalée de 30 minutes, GPS absent", charge("uh_a", M1, 1575, -5, mission_id=MI3, horloge=30, gps=False), True, "HORLOGE")
check("E04b", "Écarts", "Écarts HORLOGE et GPS_ABSENT enregistrés à l'arrivée",
      f"select string_agg(type_anomalie, ',' order by type_anomalie) from public.moto_mission_anomalies where mission_id='{MI3}' and type_anomalie in ('HORLOGE','GPS_ABSENT')", "GPS_ABSENT,HORLOGE")
check("E04c", "Écarts", "Aucune position enregistrée quand le GPS est absent", f"select count(*) from public.moto_mission_positions where mission_id='{MI3}' and moment='ARRIVEE'", "0")
# Mission commencée la veille (hors connexion), non clôturée le jour même
r4 = demarrer("E05", "uh_b", "Départ la veille (synchronisé aujourd'hui)", charge("uh_b", M2, 5000, -60 * 26), True, "OUVERTE")
MI4 = r4["id"] if isinstance(r4, dict) else None
check("E05b", "Écarts", "Mission signalée « non clôturée à temps »", f"select non_cloturee_a_temps from public.moto_v_missions where id='{MI4}'", "t")
cloturer("E06", "uh_b", "Clôture tardive : signalée, jamais estimée", charge("uh_b", M2, 5030, -10, mission_id=MI4), True, "CLOTURE_TARDIVE")
check("E06b", "Écarts", "La distance retenue est celle des deux compteurs photographiés", f"select distance_km from public.moto_v_missions where id='{MI4}'", "30.0")

# ===========================================================================
# T. Traitement des écarts : un responsable, jamais le conducteur
# ===========================================================================
an = q(f"select id from public.moto_mission_anomalies where mission_id='{MI2}' and type_anomalie='HORS_MISSION'")
act("T01", "Écarts", "uh_a", "Le conducteur justifie son propre écart", f"select public.moto_mission_anomalie_traiter('{an}', 'JUSTIFIEE', 'Passage au garage pour un réglage')", False, "rôle")
act("T02", "Écarts", "fin", "La Finance tranche un écart", f"select public.moto_mission_anomalie_traiter('{an}', 'JUSTIFIEE', 'Passage au garage pour un réglage')", False, "rôle")
act("T03", "Écarts", "zh", "Décision sans motif suffisant", f"select public.moto_mission_anomalie_traiter('{an}', 'JUSTIFIEE', 'ok')", False, "motif")
act("T04", "Écarts", "zh", "Le Chef de zone justifie l'écart (motif vérifié)", f"select public.moto_mission_anomalie_traiter('{an}', 'JUSTIFIEE', 'Passage au garage pour un réglage, facture vue')", True, "JUSTIFIEE")
act("T05", "Écarts", "bm", "Seconde décision sur le même écart", f"select public.moto_mission_anomalie_traiter('{an}', 'NON_JUSTIFIEE', 'Revirement sans élément nouveau')", False, "déjà vérifié")

# ===========================================================================
# N. Annulation d'une mission ouverte par erreur (jamais estimée)
# ===========================================================================
r5 = demarrer("N00", "uh_a", "Mission ouverte par erreur", charge("uh_a", M1, 1575, -3), True, "OUVERTE")
MI5 = r5["id"] if isinstance(r5, dict) else None
act("N01", "Annulation", "uh_a", "Le conducteur annule sa propre mission", f"select public.moto_mission_annuler('{MI5}', 'Erreur de saisie de ma part')", False, "rôle")
act("N02", "Annulation", "zh", "Annulation sans motif suffisant", f"select public.moto_mission_annuler('{MI5}', 'erreur')", False, "motif")
act("N03", "Annulation", "zh", "Le Chef de zone annule (motif)", f"select public.moto_mission_annuler('{MI5}', 'Ouverte par erreur, aucun départ réel')", True, "ANNULEE")
act("N04", "Annulation", "zh", "Annulation d'une mission déjà clôturée", f"select public.moto_mission_annuler('{MI1}', 'Tentative sur une mission close')", False, "ouverte")
check("N05", "Annulation", "La mission annulée n'a aucune distance (jamais estimée) et le relevé de départ reste",
      f"select coalesce(distance_km::text,'NULL')||'|'||(select count(*) from public.moto_releves_km r join public.moto_missions m on m.depart_releve_id=r.id where m.id='{MI5}') from public.moto_v_missions where id='{MI5}'", "NULL|1")

# ===========================================================================
# L. Lecture : l'agent ses missions ; la hiérarchie son périmètre ; positions réservées
# ===========================================================================
act("L01", "Lecture", "uh_a", "L'agent voit ses missions", f"select count(*) from public.moto_v_missions where conducteur_id='{U['uh_a']}'", True, "4")
act("L02", "Lecture", "uh_b", "Un autre agent ne voit pas les missions de A", f"select count(*) from public.moto_missions where conducteur_id='{U['uh_a']}'", True, "0")
act("L03", "Lecture", "zh", "Le Chef de zone voit les missions de sa zone", f"select count(*) from public.moto_v_missions where moto_id in ('{M1}','{M2}')", True, "5")
act("L04", "Lecture", "fin", "La Finance voit missions et distances", f"select count(*) from public.moto_v_missions where moto_id='{M1}'", True, "4")
act("L05", "Lecture", "fin", "La Finance ne voit AUCUNE coordonnée", "select count(*) from public.moto_mission_positions", True, "0")
act("L06", "Lecture", "dir", "La Direction ne voit aucune coordonnée", "select count(*) from public.moto_mission_positions", True, "0")
act("L07", "Lecture", "uh_a", "L'agent ne voit pas les coordonnées (même les siennes)", "select count(*) from public.moto_mission_positions", True, "0")
act("L08", "Lecture", "zh", "Le Chef de zone voit les coordonnées", f"select count(*) > 0 from public.moto_mission_positions where mission_id='{MI1}'", True, "t")
act("L09", "Lecture", "lc", "Le coordinateur voit les coordonnées", f"select count(*) > 0 from public.moto_mission_positions where mission_id='{MI1}'", True, "t")
act("L10", "Lecture", "abm", "L'ABM voit les coordonnées", f"select count(*) > 0 from public.moto_mission_positions where mission_id='{MI1}'", True, "t")
act("L11", "Lecture", "anon", "Anonyme lit les missions", "select count(*) from public.moto_v_missions", False, "permission")
act("L12", "Lecture", "anon", "Anonyme lit les positions", "select count(*) from public.moto_mission_positions", False, "permission")
check("L13", "Lecture", "Les vues de mission n'exposent aucune coordonnée",
      "select count(*) from information_schema.columns where table_schema='public' and table_name like 'moto_v_mission%' and (column_name like '%lat%' or column_name like '%lon%')", "0")
check("L14", "Lecture", "Le journal ne contient aucune coordonnée et aucune position n'y est journalisée",
      "select count(*) from public.moto_journal where table_nom like 'moto_mission%' and (nouvelle_valeur ? 'latitude' or nouvelle_valeur ? 'longitude' or table_nom = 'moto_mission_positions')", "0")
act("L15", "Lecture", "uh_a", "L'agent voit les écarts de ses missions (transparence)", f"select count(*) > 0 from public.moto_v_mission_ecarts where conducteur_id='{U['uh_a']}'", True, "t")
act("L16", "Lecture", "fin", "La Finance voit les photos de compteur (contrôle collectif)", f"select count(*) from storage.objects where bucket_id='moto-documents' and name like '{M1}/mission/%'", True, None)
ok_l16, n_l16 = run_as("fin", f"select count(*) from storage.objects where bucket_id='moto-documents' and name like '{M1}/mission/%'")
attendu_l16 = q(f"select count(*) from public.moto_mission_photos ph join public.moto_missions m on m.id = ph.mission_id where m.moto_id='{M1}'")
record("L16b", "Lecture", "fin", "… exactement celles rattachées à une mission (pas les fichiers orphelins de départs refusés)", attendu_l16, ok_l16 and n_l16 == attendu_l16, n_l16)

# ===========================================================================
# W. Écritures directes interdites, photos et positions immuables
# ===========================================================================
act("W01", "Écriture directe", "bm", "Insertion directe d'une mission", f"insert into public.moto_missions (moto_id, conducteur_id, objet, destination, depart_releve_id, depart_km, depart_at, depart_origine, depart_gps_statut, depart_client_op_id) select '{M1}', '{U['bm']}', 'GARAGE', 'X X', id, 1, now(), 'SAISI', 'ABSENT', gen_random_uuid() from public.moto_releves_km limit 1", False, "permission")
act("W02", "Écriture directe", "bm", "Modification directe d'une distance", f"update public.moto_missions set arrivee_km = 2000 where id='{MI1}'", False, "permission")
act("W03", "Écriture directe", "zh", "Suppression directe d'un écart", f"delete from public.moto_mission_anomalies where mission_id='{MI2}'", False, "permission")
try: q(f"delete from public.moto_mission_positions where mission_id='{MI1}'"); w4 = "OK"
except RuntimeError as e: w4 = str(e)
record("W04", "Écriture directe", "postgres (écriture directe)", "Même le propriétaire ne modifie pas une position", "REFUS (immuable)", "ne se modifient pas" in w4, w4[:200])
try: q(f"update public.moto_mission_photos set sha256 = repeat('0', 64) where mission_id='{MI1}'"); w5 = "OK"
except RuntimeError as e: w5 = str(e)
record("W05", "Écriture directe", "postgres (écriture directe)", "Une empreinte de photo ne se réécrit pas", "REFUS (immuable)", "ne se modifient pas" in w5, w5[:200])

# ===========================================================================
# S. Stockage : dossier <moto>/mission/
# ===========================================================================
act("S01", "Stockage", "uh_a", "L'agent dépose une photo de mission pour une moto qui n'est pas la sienne",
    f"insert into storage.objects (bucket_id, name) values ('moto-documents', '{M2}/mission/{uuid.uuid4()}-photo_path.jpg')", False, "row-level security")
act("S02", "Stockage", "fin", "La Finance dépose une photo de mission", f"insert into storage.objects (bucket_id, name) values ('moto-documents', '{M1}/mission/{uuid.uuid4()}-photo_path.jpg')", False, "row-level security")
act("S03", "Stockage", "lc", "Le coordinateur peut déposer (conducteur occasionnel)", f"insert into storage.objects (bucket_id, name) values ('moto-documents', '{M1}/mission/{uuid.uuid4()}-photo_path.jpg')", True)

# ===========================================================================
# C. Correction d'un compteur de mission : circuit à quatre yeux existant
# ===========================================================================
rel_arr = q(f"select arrivee_releve_id from public.moto_missions where id='{MI4}'")
rel_dep = q(f"select depart_releve_id from public.moto_missions where id='{MI4}'")
c1 = act("C01", "Correction", "abm", "Demande : compteur de départ porté au-dessus de l'arrivée",
         "select public.moto_correction_demander(" + lit({"cible_table": "moto_releves_km", "cible_id": rel_dep, "champ": "compteur_km", "nouvelle_valeur": "5040", "motif": "Erreur de lecture supposée au départ"}) + ")", True, "DEMANDEE")
act("C02", "Correction", "bm", "Validation : refusée, le départ dépasserait l'arrivée", f"select public.moto_correction_decider('{c1['id'] if isinstance(c1, dict) else c1}', 'APPLIQUEE', 'Validation du test')", False, "Correction refusée")
c3 = act("C03", "Correction", "abm", "Seconde demande sur le même relevé tant que la première attend",
         "select public.moto_correction_demander(" + lit({"cible_table": "moto_releves_km", "cible_id": rel_dep, "champ": "compteur_km", "nouvelle_valeur": "5033", "motif": "Photo relue : 5033 et non 5030"}) + ")", False, "déjà en attente")
act("C04", "Correction", "bm", "Rejet de la demande incohérente", f"select public.moto_correction_decider('{c1['id'] if isinstance(c1, dict) else c1}', 'REJETEE', 'Incohérent avec la photo')", True, "REJETEE")
c5 = act("C05", "Correction", "abm", "Demande : compteur d'arrivée corrigé (photo relue)",
         "select public.moto_correction_demander(" + lit({"cible_table": "moto_releves_km", "cible_id": rel_arr, "champ": "compteur_km", "nouvelle_valeur": "5033", "motif": "Photo relue : 5033 et non 5030"}) + ")", True, "DEMANDEE")
act("C06", "Correction", "abm", "Auto-approbation de sa propre demande", f"select public.moto_correction_decider('{c5['id'] if isinstance(c5, dict) else c5}', 'APPLIQUEE')", False, None)
act("C07", "Correction", "bm", "Le BM valide la correction", f"select public.moto_correction_decider('{c5['id'] if isinstance(c5, dict) else c5}', 'APPLIQUEE', 'Photo relue, chiffre confirmé')", True, "APPLIQUEE")
check("C08", "Correction", "La distance de la mission suit la correction", f"select distance_km from public.moto_v_missions where id='{MI4}'", "33.0")
check("C09", "Correction", "La correction est journalisée avec son valideur",
      f"select count(*) > 0 from public.moto_journal where table_nom='moto_missions' and enregistrement_id='{MI4}' and valideur='{U['bm']}'", "t")

# ===========================================================================
# B. Synchronisation hors connexion (lot) : départ + arrivée, rejeu, refus en chaîne
# ===========================================================================
mid_b = str(uuid.uuid4())
dep_b = charge("uh_b", M2, 5040, -8, mission_id=mid_b); arr_b = charge("uh_b", M2, 5055, -4, mission_id=mid_b)
lot = [{"client_op_id": dep_b["client_op_id"], "type": "MISSION_DEPART", "payload": dep_b},
       {"client_op_id": arr_b["client_op_id"], "type": "MISSION_ARRIVEE", "payload": arr_b}]
act("B01", "Hors connexion", "uh_b", "Lot : départ puis arrivée saisis sans réseau", "select string_agg(x->>'statut', ',') from jsonb_array_elements(public.moto_sync_batch(" + lit(lot) + ")) x", True, "SYNCHRONISE,SYNCHRONISE")
act("B02", "Hors connexion", "uh_b", "Le même lot renvoyé (réponse perdue)", "select string_agg(coalesce(x->>'doublon','false'), ',') from jsonb_array_elements(public.moto_sync_batch(" + lit(lot) + ")) x", True, "true,true")
check("B03", "Hors connexion", "Une seule mission, deux relevés, distance juste", f"select count(*)||'|'||max(distance_km) from public.moto_v_missions where id='{mid_b}'", "1|15.0")
mid_c = str(uuid.uuid4())
dep_c = charge("uh_b", M2, 5000, -3, mission_id=mid_c); arr_c = charge("uh_b", M2, 5070, -2, mission_id=mid_c)
lot2 = [{"client_op_id": dep_c["client_op_id"], "type": "MISSION_DEPART", "payload": dep_c},
        {"client_op_id": arr_c["client_op_id"], "type": "MISSION_ARRIVEE", "payload": arr_c}]
act("B04", "Hors connexion", "uh_b", "Lot dont le départ recule : départ refusé, arrivée laissée en attente (jamais estimée)",
    "select string_agg(x->>'statut', ',') from jsonb_array_elements(public.moto_sync_batch(" + lit(lot2) + ")) x", True, "REJETE,ERREUR_TEMPORAIRE")
check("B05", "Hors connexion", "Aucune mission créée par le lot refusé", f"select count(*) from public.moto_missions where id='{mid_c}'", "0")
# Trois missions saisies sans réseau, synchronisées en un lot
ops = []; km = 5055
for i in range(3):
    m_id = str(uuid.uuid4()); a = charge("uh_b", M2, km, -1.9 + i * 0.5, mission_id=m_id); km += 4
    b = charge("uh_b", M2, km, -1.8 + i * 0.5, mission_id=m_id, gps=False)
    ops += [{"client_op_id": a["client_op_id"], "type": "MISSION_DEPART", "payload": a}, {"client_op_id": b["client_op_id"], "type": "MISSION_ARRIVEE", "payload": b}]
act("B06", "Hors connexion", "uh_b", "Trois missions saisies sans réseau, un seul lot", "select count(*) filter (where x->>'statut'='SYNCHRONISE') from jsonb_array_elements(public.moto_sync_batch(" + lit(ops) + ")) x", True, "6")
act("B07", "Hors connexion", "uh_b", "Rejeu du lot : aucun doublon", "select count(*) filter (where (x->>'doublon')::boolean) from jsonb_array_elements(public.moto_sync_batch(" + lit(ops) + ")) x", True, "6")

# ===========================================================================
# K. Concurrence : deux départs simultanés sur la même moto
# ===========================================================================
q(f"update public.moto_immobilisations set fin = now(), levee_par = '{U['abm']}', levee_motif = 'Fin de test' where moto_id='{M4}' and fin is null; select private.moto_recalculer_statuts('{M4}')")
pk1 = charge("zh", M4, 7010, -1); permis_fixture("zh_b"); pk2 = charge("zh_b", M4, 7011, -1, deposant="zh_b")
resk = {}
def course(k, u, p): resk[k] = run_as(u, "select public.moto_mission_demarrer(" + lit(p) + ")")
th = [threading.Thread(target=course, args=("a", "zh", pk1)), threading.Thread(target=course, args=("b", "zh_b", pk2))]
[x.start() for x in th]; [x.join() for x in th]
nb_ok = sum(1 for v in resk.values() if v[0])
record("K01", "Concurrence", "zh / zh_b", "Deux départs simultanés sur la même moto : un seul accepté", "1 OK, 1 REFUS", nb_ok == 1, json.dumps({k: v[1][:80] for k, v in resk.items()}, ensure_ascii=False))
check("K02", "Concurrence", "Une seule mission ouverte sur la moto", f"select count(*) from public.moto_missions where moto_id='{M4}' and statut='OUVERTE'", "1")

# ===========================================================================
# R. Carnet, tableaux de bord, coût par km de mission
# ===========================================================================
act("R01", "Carnet", "fin", "Les missions apparaissent dans le carnet de la moto", f"select count(*) from public.moto_carnet('{M1}') where categorie='MISSION'", True, "4")
act("R02", "Carnet", "fin", "Le carnet ne porte aucune coordonnée", f"select count(*) from public.moto_carnet('{M1}') where categorie='MISSION' and (detail like '%7.5%' or detail like '%-5.0%')", True, "0")
q(f"""insert into public.moto_carburant (moto_id, agent_id, date_achat, compteur_km, litres, montant, plein_complet, justificatif_path, justificatif_statut, verifie_par, verifie_at, saisi_par)
      values ('{M1}', '{U['uh_a']}', now() - interval '1 hour', 1500, 10, 8750, true, '{M1}/justificatif/f8.jpg', 'VERIFIE', '{U['lc']}', now(), '{U['uh_a']}')""")
act("R03", "Coûts", "fin", "Coût par km de mission (carburant vérifié du mois)", f"select km_mission||'|'||cout_carburant_verifie from public.moto_v_missions_couts where moto_id='{M1}' and mois = date_trunc('month', now())::date", True, "357.0|8750")
ok_r4, out_r4 = run_as("fin", f"select fcfa_km_mission, litres_100_km_mission from public.moto_v_missions_couts where moto_id='{M1}' and mois = date_trunc('month', now())::date")
attendu_fcfa = round(8750 / 357.0, 1)
record("R04", "Coûts", "fin", "FCFA par km de mission et litres aux 100 km de mission", f"{attendu_fcfa}|2.80", ok_r4 and out_r4.split("|")[0] == f"{attendu_fcfa}" and out_r4.split("|")[1] == "2.80", out_r4)
act("R05", "Tableau", "zh", "Synthèse mensuelle : km de mission et hors mission de l'agent A",
    f"select km_mission||'|'||km_hors_mission||'|'||missions_annulees from public.moto_v_missions_mois where conducteur_id='{U['uh_a']}' and mois = date_trunc('month', now())::date", True, "357.0|218.0|1")
act("R06", "Tableau", "zh", "Part des relevés corrigés et saisis (signal de contrôle)",
    f"select releves_lus_corriges||'|'||releves_saisis from public.moto_v_missions_mois where conducteur_id='{U['uh_a']}' and mois = date_trunc('month', now())::date", True, "1|1")
act("R07", "Purge", "bm", "Le BM liste les photos arrivées en fin de conservation", "select count(*) from public.moto_missions_photos_a_purger()", True, "0")
act("R08", "Purge", "uh_a", "Un agent liste les photos à purger", "select count(*) from public.moto_missions_photos_a_purger()", False, "rôle")
check("R09", "Paramètres", "Seuils paramétrables présents (provisoires)", "select count(*) from public.moto_parametres where cle like 'mission\\_%' and provisoire", "9")

# ===========================================================================
# X. Contre-expertise : défauts prouvés, corrigés et rejoués
# ===========================================================================
q(f"insert into auth.users (id, email) values ('{uid(312)}', 'uhx8@example.invalid'), ('{uid(313)}', 'zhc8@example.invalid'), ('{uid(314)}', 'uhexp8@example.invalid'), ('{uid(315)}', 'uhy8@example.invalid') on conflict do nothing")
q(f"""insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values
      ('{uid(312)}', 'uhx8@example.invalid', 'UH8 X FICTIF', 'Unit Head', 'SAKASSOU', 'GBEKE 1', true),
      ('{uid(313)}', 'zhc8@example.invalid', 'ZH8 GBEKE2 FICTIF', 'Zonal Head', null, 'GBEKE 2', true),
      ('{uid(314)}', 'uhexp8@example.invalid', 'UH8 PERMIS EXPIRE FICTIF', 'Unit Head', 'SAKASSOU', 'GBEKE 1', true),
      ('{uid(315)}', 'uhy8@example.invalid', 'UH8 Y FICTIF', 'Unit Head', 'SAKASSOU', 'GBEKE 1', true) on conflict do nothing""")
U.update({"uh_x": uid(312), "zh_c": uid(313), "uh_exp": uid(314), "uh_y": uid(315)})
M6 = moto("uh_x", 800)
M7 = moto("uh_exp", 900)
q(f"update public.moto_permis set date_expiration = current_date - 1 where titulaire_id = '{U['uh_exp']}'")
act("X01", "Contre-expertise", "uh_x", "Compteur « NaN » (bloquerait la moto)", "select public.moto_mission_demarrer(" + lit(charge("uh_x", M6, "NaN", -30)) + ")", False, "invalide")
act("X01b", "Contre-expertise", "uh_x", "Compteur « Infinity »", "select public.moto_mission_demarrer(" + lit(charge("uh_x", M6, "Infinity", -30)) + ")", False, "invalide")
act("X01c", "Contre-expertise", "uh_x", "Relevé ordinaire « NaN » (moto_num corrigé pour toutes les saisies)", "select public.moto_releve_km(" + lit({"moto_id": M6, "compteur_km": "NaN"}) + ")", False, "invalide")
check("X01d", "Contre-expertise", "Le compteur de la moto est intact", f"select compteur_actuel_km from public.moto_motos where id='{M6}'", "800.0")
act("X02", "Contre-expertise", "uh_x", "Départ à 13 h (capture hors connexion) : accepté et signalé SAISIE_DIFFEREE", "select public.moto_mission_demarrer(" + lit(charge("uh_x", M6, 805, -13 * 60, etag="e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1")) + ")", True, "SAISIE_DIFFEREE_DEPART")
mx = q(f"select id from public.moto_missions where moto_id='{M6}' and statut='OUVERTE'")
act("X03", "Contre-expertise", "uh_x", "Arrivée avec le MÊME fichier (eTag identique) et une empreinte inventée", "select public.moto_mission_cloturer(" + lit(charge("uh_x", M6, 815, -12 * 60, mission_id=mx, etag="e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1")) + ")", False, "déjà été utilisée")
act("X04", "Contre-expertise", "uh_x", "Clôture normale", "select public.moto_mission_cloturer(" + lit(charge("uh_x", M6, 815, -12 * 60, mission_id=mx)) + ")", True, "CLOTUREE")
act("X05", "Contre-expertise", "uh_x", "Départ ANTIDATÉ avant la mission déjà clôturée (chevauchement)", "select public.moto_mission_demarrer(" + lit(charge("uh_x", M6, 815, -12 * 60 - 30)) + ")", False, "antérieure au dernier relevé")
act("X06", "Contre-expertise", "uh_exp", "Permis expiré hier : départ « maintenant »", "select public.moto_mission_demarrer(" + lit(charge("uh_exp", M7, 900, -1)) + ")", False, "Aucun permis valide")
act("X06b", "Contre-expertise", "uh_exp", "Permis expiré hier : départ antidaté de 3 jours", "select public.moto_mission_demarrer(" + lit(charge("uh_exp", M7, 900, -3 * 24 * 60)) + ")", False, "Aucun permis valide")
# Hors connexion : arrivée reçue AVANT son départ = erreur temporaire, puis tout passe
mid = str(uuid.uuid4()); dpx = charge("uh_x", M6, 820, -60, mission_id=mid); arx = charge("uh_x", M6, 830, -50, mission_id=mid)
act("X07", "Contre-expertise", "uh_x", "Lot : arrivée seule (départ pas encore envoyé)", "select string_agg(x->>'statut', ',') from jsonb_array_elements(public.moto_sync_batch(" + lit([{"client_op_id": arx["client_op_id"], "type": "MISSION_ARRIVEE", "payload": arx}]) + ")) x", True, "ERREUR_TEMPORAIRE")
act("X07b", "Contre-expertise", "uh_x", "Lot suivant : départ puis arrivée renvoyée", "select string_agg(x->>'statut', ',') from jsonb_array_elements(public.moto_sync_batch(" + lit([{"client_op_id": dpx["client_op_id"], "type": "MISSION_DEPART", "payload": dpx}, {"client_op_id": arx["client_op_id"], "type": "MISSION_ARRIVEE", "payload": arx}]) + ")) x", True, "SYNCHRONISE,SYNCHRONISE")
check("X07c", "Contre-expertise", "La mission est bien clôturée", f"select statut from public.moto_missions where id='{mid}'", "CLOTUREE")
# Annulation : pas de double comptage des km hors mission
ann = act("X08a", "Contre-expertise", "uh_x", "Départ à 840 (10 km hors mission)", "select public.moto_mission_demarrer(" + lit(charge("uh_x", M6, 840, -40)) + ")", True, "OUVERTE")
act("X08b", "Contre-expertise", "zh", "Annulation de cette mission", f"select public.moto_mission_annuler('{ann['id'] if isinstance(ann, dict) else ann}', 'Mission ouverte par erreur pour le test')", True, "ANNULEE")
act("X08c", "Contre-expertise", "uh_x", "Départ suivant à 860", "select public.moto_mission_demarrer(" + lit(charge("uh_x", M6, 860, -30)) + ")", True, "OUVERTE")
check("X08d", "Contre-expertise", "Km hors mission du mois : 5 + 30 (et non 5 + 10 + 30)", f"select sum(km_hors_mission) from public.moto_v_missions_mois where moto_id='{M6}'", "35.0")
# Correction qui casserait la continuité
rel = q(f"select arrivee_releve_id from public.moto_missions where id='{mid}'")
cc = act("X09a", "Contre-expertise", "abm", "Demande : arrivée corrigée 830 → 900 (au-delà des relevés suivants)", "select public.moto_correction_demander(" + lit({"cible_table": "moto_releves_km", "cible_id": rel, "champ": "compteur_km", "nouvelle_valeur": "900", "motif": "Test de continuité du compteur"}) + ")", True, "DEMANDEE")
act("X09", "Contre-expertise", "bm", "Validation refusée : le compteur dépasserait un relevé postérieur", f"select public.moto_correction_decider('{cc['id'] if isinstance(cc, dict) else cc}', 'APPLIQUEE', 'Validation du test')", False, "relevé postérieur")
# Chef de zone d'une autre zone : lecture, positions et écritures refusées
an6 = q(f"select id from public.moto_mission_anomalies where moto_id='{M6}' and statut='A_VERIFIER' limit 1")
act("X10", "Contre-expertise", "zh_c", "Chef de zone GBEKE 2 : missions d'une moto GBEKE 1", f"select count(*) from public.moto_missions where moto_id='{M6}'", True, "0")
act("X10b", "Contre-expertise", "zh_c", "… positions", f"select count(*) from public.moto_mission_positions pp join public.moto_missions m on m.id = pp.mission_id where m.moto_id='{M6}'", True, "0")
act("X10c", "Contre-expertise", "zh_c", "… justifie un écart", f"select public.moto_mission_anomalie_traiter('{an6}', 'JUSTIFIEE', 'Tentative hors de sa zone de responsabilité')", False, "périmètre")
ouv = q(f"select id from public.moto_missions where moto_id='{M6}' and statut='OUVERTE'")
act("X10d", "Contre-expertise", "zh_c", "… annule une mission", f"select public.moto_mission_annuler('{ouv}', 'Tentative hors de sa zone de responsabilité')", False, "périmètre")
# Photos de mission : un autre Chef d'unité du cluster ne les lit pas
act("X11", "Contre-expertise", "uh_y", "Autre Chef d'unité du cluster : photos de mission de la moto X", f"select count(*) from storage.objects where bucket_id='moto-documents' and name like '{M6}/mission/%'", True, "0")
act("X11b", "Contre-expertise", "zh", "Son Chef de zone les lit", f"select count(*) > 0 from storage.objects where bucket_id='moto-documents' and name like '{M6}/mission/%'", True, "t")
# Le conducteur ne valide pas la correction de son propre relevé
permis_fixture("bm")
rb = act("X12a", "Contre-expertise", "bm", "Le BM conduit lui-même (mission sur la moto B)", "select public.moto_mission_demarrer(" + lit(charge("bm", M2, 5100, 2)) + ")", True, "OUVERTE")
relb = q(f"select depart_releve_id from public.moto_missions where id='{rb['id'] if isinstance(rb, dict) else rb}'")
cb = act("X12b", "Contre-expertise", "abm", "Demande de correction du relevé de départ du BM", "select public.moto_correction_demander(" + lit({"cible_table": "moto_releves_km", "cible_id": relb, "champ": "compteur_km", "nouvelle_valeur": "5101", "motif": "Lecture photo à confirmer"}) + ")", True, "DEMANDEE")
act("X12", "Contre-expertise", "bm", "Le BM valide la correction de son propre relevé", f"select public.moto_correction_decider('{cb['id'] if isinstance(cb, dict) else cb}', 'APPLIQUEE', 'Auto-validation')", False, "propre relevé")
act("X12c", "Contre-expertise", "dir", "La Direction valide (quatre yeux respectés)", f"select public.moto_correction_decider('{cb['id'] if isinstance(cb, dict) else cb}', 'APPLIQUEE', 'Photo relue')", True, "APPLIQUEE")
# Purge réservée au BM, limitée aux photos en fin de conservation
act("X13", "Contre-expertise", "uh_a", "Un agent purge des photos", "select public.moto_missions_photos_purger(array['x'])", False, "rôle")
act("X13b", "Contre-expertise", "bm", "Le BM ne peut pas purger une photo récente", f"select public.moto_missions_photos_purger(array(select chemin from public.moto_mission_photos limit 3))", True, "0")

# ---------------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "missions_8.json"), "w", encoding="utf-8") as f:
    json.dump({"base": DB, "date": datetime.datetime.now(datetime.timezone.utc).isoformat(), "resultats": RESULTS}, f, ensure_ascii=False, indent=1)
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI")
print("| id | domaine | compte | action | attendu | obtenu | résultat |\n|---|---|---|---|---|---|---|")
for r in RESULTS:
    print(f"| {r['id']} | {r['domaine']} | {r['compte']} | {r['action']} | {r['attendu']} | {r['obtenu'][:90]} | {r['resultat']} |")
print(f"TOTAL MIGRATION 8 : {ok}/{len(RESULTS)} réussis")
sys.exit(0 if ok == len(RESULTS) else 1)

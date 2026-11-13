#!/usr/bin/env python3
"""
OBSERVATOIRE AGRONOMIQUE AFLP 2027 — recette serveur sur réplique LOCALE.

Chaque action est exécutée SOUS LE RÔLE `authenticated` (RLS active), avec
l'identité JWT d'un compte FICTIF. Les vérifications d'état lisent la base en
superutilisateur. Refuse toute cible Supabase. Aucune donnée réelle : comptes,
villages, producteurs et parcelles sont fictifs et marqués comme tels.

Usage : PGHOST=127.0.0.1 PGPORT=54329 python3 tests/observatoire/tests_serveur_observatoire.py fbms_pheno_test
Sortie : tests/observatoire/resultats/serveur.json + synthèse sur stdout.
"""
import datetime, hashlib, json, os, subprocess, sys, uuid

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_pheno_test"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultats")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
PROFILS = [  # clé, nom, rôle, cluster, zone, actif
    ("bm", "BM FICTIF", "Branch Manager", None, None, True),
    ("abm", "ABM FICTIF", "Assistant Branch Manager", None, None, True),
    ("zh1", "ZH GBEKE 1 FICTIF", "Zonal Head", None, "GBEKE 1", True),
    ("zh2", "ZH GBEKE 2 FICTIF", "Zonal Head", None, "GBEKE 2", True),
    ("uh_bro", "UH BROBO FICTIF", "Unit Head", "BROBO", "GBEKE 1", True),
    ("uh_bot", "UH BOTRO FICTIF", "Unit Head", "BOTRO", "GBEKE 2", True),
    ("auh_bro", "AUH BROBO FICTIF", "Assistant Unit Head", "BROBO", "GBEKE 1", True),
    ("auh_bro2", "AUH BROBO 2 FICTIF", "Assistant Unit Head", "BROBO", "GBEKE 1", True),
    ("rt", "RT FICTIF", "RT", "BROBO", "GBEKE 1", True),
    ("sup", "SUPERVISOR FICTIF", "Supervisor", "BROBO", None, True),
    ("gm", "GM FICTIF", "General Manager", None, None, True),
    ("uh_inactif", "UH INACTIF FICTIF", "Unit Head", "BROBO", "GBEKE 1", False),
]
U = {p[0]: uid(i + 1) for i, p in enumerate(PROFILS)}

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
        pre = "set local role anon; select set_config('request.jwt.claims','{\"role\":\"anon\"}',true); select set_config('request.jwt.claim.sub','',true);"
    else:
        claims = json.dumps({"sub": U[user], "role": "authenticated"})
        pre = (f"set local role authenticated; select set_config('request.jwt.claims','{claims}',true);"
               f" select set_config('request.jwt.claim.sub','{U[user]}',true);")
    code, out, err = psql(f"begin;\n\\o /dev/null\n{pre}\n\\o\n{sql};\ncommit;\n")
    if code == 0:
        lines = [l for l in out.splitlines() if l.strip()]
        return True, (lines[-1] if lines else "")
    lines = err.splitlines()
    msg = next((l for l in lines if "ERROR" in l), lines[0] if lines else "erreur")
    return False, msg.split("ERROR:")[-1].strip()

RESULTS = []
def record(tid, famille, user, label, attendu, ok, obtenu):
    RESULTS.append({"id": tid, "famille": famille, "compte": user, "action": label, "attendu": attendu,
                    "obtenu": str(obtenu)[:300], "resultat": "RÉUSSI" if ok else "ÉCHOUÉ"})
    if not ok: print(f"ÉCHEC {tid} [{user}] {label} — attendu {attendu} — obtenu {str(obtenu)[:260]}", file=sys.stderr, flush=True)

def lit(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
def jl(out):
    try: return json.loads(out)
    except Exception: return out

def act(tid, famille, user, label, sql, expect_ok=True, contains=None):
    ok, out = run_as(user, sql)
    passed = (ok == expect_ok) and (contains is None or contains.lower() in out.lower())
    record(tid, famille, user, label, ("OK" if expect_ok else "REFUS") + (f" ({contains})" if contains else ""), passed,
           ("OK : " if ok else "REFUS : ") + out)
    return jl(out) if ok else {}

def check(tid, famille, label, sql, expected):
    try: got = q(sql)
    except Exception as e: got = f"ERREUR {e}"
    record(tid, famille, "postgres (lecture)", label, str(expected), got == str(expected), got)
    return got

def vu_par(tid, famille, user, label, sql, expected):
    ok, out = run_as(user, sql)
    record(tid, famille, user, label, str(expected), ok and out == str(expected), ("OK : " if ok else "REFUS : ") + out)

def sync(user, ops):
    ok, out = run_as(user, f"select public.pheno_sync_batch({lit(ops)})")
    if not ok: return {"erreur": out, "resultats": [{"statut": "ERREUR", "message": out}] * len(ops)}
    return json.loads(out)

DATES_CLIENT = {}   # un appareil renvoie toujours la même enveloppe pour une même clé
def sync1(tid, famille, user, label, typ, payload, attendu, contains=None, cle=None):
    cle = cle or str(uuid.uuid4())
    DATES_CLIENT.setdefault(cle, datetime.datetime.now(datetime.timezone.utc).isoformat())
    r = sync(user, [{"idempotency_key": cle, "type": typ, "payload": payload, "device_id": "APPAREIL-FICTIF-" + user,
                     "created_at_client": DATES_CLIENT[cle]}])["resultats"][0]
    passed = r.get("statut") == attendu and (contains is None or contains.lower() in json.dumps(r, ensure_ascii=False).lower())
    record(tid, famille, user, label, attendu + (f" ({contains})" if contains else ""), passed, json.dumps(r, ensure_ascii=False))
    return r

def tirage(graine, n, k):
    return sorted(range(1, n + 1), key=lambda i: (hashlib.sha256(f"{graine}:{i}".encode()).hexdigest(), i))[:k]
def arbre_id(bloc, numero):
    h = hashlib.sha256(f"{bloc}:ARBRE:{numero}".encode()).hexdigest()[:32]
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"

# ---------------------------------------------------------------------------
# Préparation : comptes, référentiel et parcelles FICTIFS
# ---------------------------------------------------------------------------
setup = []
for k, nom, role, cluster, zone, actif in PROFILS:
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
                 f"('{U[k]}', '{k}@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, {str(actif).lower()}) on conflict do nothing;")
CAMP = str(uuid.uuid5(uuid.NAMESPACE_DNS, "campagne-fictive-ouverte")); CAMP_FERMEE = str(uuid.uuid5(uuid.NAMESPACE_DNS, "campagne-fictive-fermee"))
# Sur le staging fidèle, les gardes de production s'appliquent : les écritures du jeu fictif se font
# sous l'identité du Branch Manager fictif (comme une saisie réelle), avec RT et codes à 4 chiffres.
setup.append(f"select set_config('request.jwt.claim.sub', '{U['bm']}', false);")
setup.append(f"insert into public.campaigns (id, code, name, year, status, is_current) values ('{CAMP}', '2097', 'CAMPAGNE FICTIVE', 2097, 'OPEN', true), "
             f"('{CAMP_FERMEE}', '2096', 'CAMPAGNE FICTIVE FERMÉE', 2096, 'CLOSED', false) on conflict do nothing;")
setup.append("insert into public.villages (id, data, village, cluster, cluster_code) values "
             "('V-FICTIF-BRO', '{}', 'VILLAGE FICTIF BROBO', 'Brobo', 'BROBO'), ('V-FICTIF-BOT', '{}', 'VILLAGE FICTIF BOTRO', 'Botro', 'BOTRO'), "
             "('V-FICTIF-SANS', '{}', 'VILLAGE FICTIF SANS CLUSTER', null, null) on conflict do nothing;")
setup.append("insert into public.rt (id, data, nom, village_id) values ('RT-FICTIF-BRO', '{}', 'RT FICTIF BROBO', 'V-FICTIF-BRO'), "
             "('RT-FICTIF-BOT', '{}', 'RT FICTIF BOTRO', 'V-FICTIF-BOT') on conflict do nothing;")
RT_DE = {"V-FICTIF-BRO": "'RT-FICTIF-BRO'", "V-FICTIF-BOT": "'RT-FICTIF-BOT'", "V-FICTIF-SANS": "null"}
PLOTS = {}
for i, (v, nom) in enumerate([("V-FICTIF-BRO", "A"), ("V-FICTIF-BRO", "B"), ("V-FICTIF-BRO", "C"), ("V-FICTIF-BRO", "D"),
                              ("V-FICTIF-BOT", "E"), ("V-FICTIF-SANS", "F"), ("V-FICTIF-BRO", "G")], start=1):
    pid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"parcelle-fictive-{nom}")); PLOTS[nom] = pid
    donnees = '{"source": "COOP_FICTIF"}' if v == "V-FICTIF-SANS" else '{}'   # sans RT : canal coopérative fictif
    setup.append(f"insert into public.producteurs (id, data, nom, village_id, rt_id) values ('P-FICTIF-{nom}', '{donnees}', 'PRODUCTEUR FICTIF {nom}', '{v}', {RT_DE[v]}) on conflict do nothing;")
    setup.append(f"insert into public.farmer_plots (id, producteur_id, village_id, local_name) values ('{pid}', 'P-FICTIF-{nom}', '{v}', 'PARCELLE FICTIVE {nom}') on conflict do nothing;")
q("\n".join(setup))

today = datetime.date.today()
def jour(semaines): return str(today - datetime.timedelta(days=7 * semaines))
def semaine(d): y, w, _ = datetime.date.fromisoformat(d).isocalendar(); return f"{y}-W{w:02d}"
def blocs(n): return [{"id": str(uuid.uuid4()), "numero": i, "repere": f"REPÈRE FICTIF {i}"} for i in range(1, n + 1)]
def panel(plot, B, b, pid=None, camp=CAMP):
    return {"id": pid or str(uuid.uuid4()), "campaign_id": camp, "plot_id": PLOTS[plot], "nb_blocs_total": B, "nb_blocs_tires": b, "blocs": blocs(B)}

E, O, S, V, I, X, N = "Échantillonnage", "Observation terrain", "Synchronisation", "Validation", "Indicateurs pilote", "Sécurité", "Non-régression"

# ---------------------------------------------------------------------------
# A. Échantillonnage
# ---------------------------------------------------------------------------
act("ECH-40", E, "auh_bro", "Installation avant création de la graine de campagne : refusée", f"select public.pheno_panel_installer({lit(panel('A', 4, 2))})", False, "Graine")
act("ECH-41", E, "uh_bro", "Graine de campagne créée par un Unit Head : refusé", f"select public.pheno_graine_creer('{CAMP}')", False, "Branch Manager")
act("ECH-42", E, "bm", "Le Branch Manager crée la graine aléatoire de la campagne", f"select public.pheno_graine_creer('{CAMP}')", True, '"deja_creee": false')
G = q(f"select graine from pheno_graines where campaign_id='{CAMP}'")
act("ECH-43", E, "bm", "Deuxième création : la graine existante est rendue, jamais remplacée", f"select public.pheno_graine_creer('{CAMP}')", True, G)
ok_u = psql(f"update public.pheno_graines set graine=repeat('0',64) where campaign_id='{CAMP}'")[0] == 0
record("ECH-44", E, "postgres (superutilisateur)", "Graine immuable, même pour le superutilisateur", "REFUS", not ok_u, "modifiée" if ok_u else "refusée")
pA = panel("A", 4, 2)
r = act("ECH-01", E, "auh_bro", "AUH installe le champ A (B=4, b=2)", f"select public.pheno_panel_installer({lit(pA)})")
attendu = tirage(f"{G}:{PLOTS['A']}:BLOCS", 4, 2)
record("ECH-02", E, "auh_bro", "Blocs tirés = recalcul indépendant sha256", str(attendu), r.get("blocs_tires") == attendu, r.get("blocs_tires"))
check("ECH-03", E, "Tirage verrouillé, b fixé avant tirage", f"select tirage_verrouille::text || '|' || statut || '|' || (b_fixe_le <= tirage_le)::text from pheno_panels where id='{pA['id']}'", "true|TIRAGE_VERROUILLE|true")
r2 = act("ECH-04", E, "auh_bro", "Réinstallation identique : idempotente", f"select public.pheno_panel_installer({lit(pA)})", True, "deja_installe")
act("ECH-05", E, "auh_bro", "Rejouer le tirage avec un autre b : refusé", f"select public.pheno_panel_installer({lit({**pA, 'nb_blocs_tires': 3})})", False, "verrouillé")
act("ECH-06", E, "uh_bro", "Même parcelle, autre identifiant (autre appareil) : refusé", f"select public.pheno_panel_installer({lit(panel('A', 4, 2))})", False, "déjà installée")
act("ECH-07", E, "auh_bro", "b > B : refusé", f"select public.pheno_panel_installer({lit(panel('B', 2, 3))})", False, "invalide")
bad = panel("B", 3, 1); bad["blocs"][1]["repere"] = " "
act("ECH-08", E, "auh_bro", "Bloc sans repère physique : refusé", f"select public.pheno_panel_installer({lit(bad)})", False, "repère")
bad = panel("B", 3, 1); bad["blocs"] = bad["blocs"][:2]
act("ECH-09", E, "auh_bro", "Liste de blocs incomplète : refusé", f"select public.pheno_panel_installer({lit(bad)})", False, "exactement")
act("ECH-10", E, "auh_bro", "Campagne fermée : refusé", f"select public.pheno_panel_installer({lit(panel('B', 4, 2, camp=CAMP_FERMEE))})", False, "ouverte")
act("ECH-11", E, "bm", "Village sans cluster AFLP : refusé", f"select public.pheno_panel_installer({lit(panel('F', 4, 2))})", False, "cluster")
check("ECH-12", E, "Journal du tirage : graine non choisie par l'agent (campagne:parcelle), b fixé avant", f"select (nouvelle->>'graine') || '|' || (nouvelle->>'b_fixe_avant_tirage') || '|' || (nouvelle->>'protocole') from pheno_journal where entite_id='{pA['id']}' and action='TIRAGE_BLOCS'", f"{G}:{PLOTS['A']}:BLOCS|true|AFLP2027-OBS v0.9")

bl = {b["numero"]: b["id"] for b in pA["blocs"]}
non_tire = next(n for n in bl if n not in attendu)
act("ECH-13", E, "auh_bro", "Inventaire d'un bloc non tiré : refusé", f"select public.pheno_bloc_inventorier({lit({'bloc_id': bl[non_tire], 'nb_arbres': 8})})", False, "pas été tiré")
act("ECH-14", E, "auh_bro", "Inventaire bloc tiré 1 (N=7)", f"select public.pheno_bloc_inventorier({lit({'bloc_id': bl[attendu[0]], 'nb_arbres': 7})})", True, "TIRAGE_VERROUILLE")
check("ECH-15", E, "Aucun arbre tiré tant qu'un bloc tiré n'est pas inventorié", f"select count(*) from pheno_arbres where panel_id='{pA['id']}'", "0")
act("ECH-16", E, "uh_bro", "Inventaire bloc tiré 2 (N=9) : le champ devient actif", f"select public.pheno_bloc_inventorier({lit({'bloc_id': bl[attendu[1]], 'nb_arbres': 9})})", True, "ACTIF")
check("ECH-17", E, "10 titulaires et 2 réserves", f"select count(*) filter (where role='TITULAIRE') || '|' || count(*) filter (where role='RESERVE') || '|' || count(distinct code) from pheno_arbres where panel_id='{pA['id']}'", "10|2|12")
ordre1 = tirage(f"{G}:{PLOTS['A']}:B{attendu[0]}:ARBRES", 7, 6)
check("ECH-18", E, "Arbres du bloc 1 = recalcul indépendant (5 titulaires puis 1 réserve)", f"select string_agg(numero_inventaire::text, ',' order by role desc, rang) from pheno_arbres where bloc_id='{bl[attendu[0]]}'", ",".join(map(str, ordre1)))
check("ECH-19", E, "Identifiant d'arbre déterministe (calculable hors ligne)", f"select id from pheno_arbres where bloc_id='{bl[attendu[0]]}' and numero_inventaire={ordre1[0]}", arbre_id(bl[attendu[0]], ordre1[0]))
check("ECH-20", E, "Probabilité d'inclusion (2/4)×(5/7) = 0,357", f"select round(proba_inclusion, 3) from pheno_arbres where bloc_id='{bl[attendu[0]]}' and role='TITULAIRE' limit 1", "0.357")
check("ECH-21", E, "Réserve : en attente, sans probabilité", f"select string_agg(distinct statut || '|' || coalesce(proba_inclusion::text, 'null'), ',') from pheno_arbres where panel_id='{pA['id']}' and role='RESERVE'", "RESERVE_EN_ATTENTE|null")
act("ECH-22", E, "auh_bro", "Modifier un inventaire enregistré : refusé", f"select public.pheno_bloc_inventorier({lit({'bloc_id': bl[attendu[0]], 'nb_arbres': 12})})", False, "ne peut plus être modifié")
act("ECH-23", E, "auh_bro", "Inventaire rejoué à l'identique : idempotent", f"select public.pheno_bloc_inventorier({lit({'bloc_id': bl[attendu[0]], 'nb_arbres': 7})})", True, "deja_inventorie")

pB = panel("B", 3, 2); act("ECH-24", E, "uh_bro", "Installation du champ B (B=3, b=2)", f"select public.pheno_panel_installer({lit(pB)})")
tB = tirage(f"{G}:{PLOTS['B']}:BLOCS", 3, 2); blB = {b["numero"]: b["id"] for b in pB["blocs"]}
act("ECH-25", E, "uh_bro", "Champ B bloc 1 : N=3 (< 5 titulaires)", f"select public.pheno_bloc_inventorier({lit({'bloc_id': blB[tB[0]], 'nb_arbres': 3})})")
act("ECH-26", E, "uh_bro", "Champ B bloc 2 : N=12 → incompatibilité signalée", f"select public.pheno_bloc_inventorier({lit({'bloc_id': blB[tB[1]], 'nb_arbres': 12})})", True, "INCOMPATIBLE")
check("ECH-27", E, "Bloc trop petit : aucun arbre tiré, N non gonflé, bloc non remplacé", f"select (select count(*) from pheno_arbres where panel_id='{pB['id']}') || '|' || (select nb_arbres_inventories from pheno_blocs where id='{blB[tB[0]]}') || '|' || (select count(*) from pheno_blocs where panel_id='{pB['id']}' and tire)", "0|3|2")

pC = panel("C", 2, 2); act("ECH-28", E, "bm", "BM installe le champ C (B=2, b=2)", f"select public.pheno_panel_installer({lit(pC)})")
tC = tirage(f"{G}:{PLOTS['C']}:BLOCS", 2, 2); blC = {b["numero"]: b["id"] for b in pC["blocs"]}
act("ECH-29", E, "bm", "Champ C bloc 1 : N=5 (5 titulaires, réserve impossible)", f"select public.pheno_bloc_inventorier({lit({'bloc_id': blC[tC[0]], 'nb_arbres': 5})})")
act("ECH-30", E, "bm", "Champ C bloc 2 : N=20", f"select public.pheno_bloc_inventorier({lit({'bloc_id': blC[tC[1]], 'nb_arbres': 20})})", True, "ACTIF")
check("ECH-31", E, "Réserve manquante signalée, champ actif", f"select statut || '|' || reserves_manquantes from pheno_panels where id='{pC['id']}'", "ACTIF|1")
act("ECH-32", E, "uh_bro", "Probabilités amont par un Unit Head : refusé", f"select public.pheno_panel_definir_probabilites('{pA['id']}', 0.5, 0.25, 'essai')", False, "Branch Manager")
act("ECH-33", E, "bm", "Probabilités amont par le BM (π village 0,5 ; π champ 0,25)", f"select public.pheno_panel_definir_probabilites('{pA['id']}', 0.5, 0.25, 'Plan de sondage fictif')")
check("ECH-34", E, "π = 0,5 × 0,25 × (2/4) × (5/7) = 0,0446", f"select round(proba_inclusion, 4) from pheno_arbres where bloc_id='{bl[attendu[0]]}' and role='TITULAIRE' limit 1", "0.0446")
ok, out = psql(f"update public.pheno_journal set motif='falsifié' where entite_id='{pA['id']}'")[0] == 0, ""
record("ECH-35", E, "postgres (superutilisateur)", "Journal immuable, même pour le superutilisateur", "REFUS", not ok, "modification acceptée" if ok else "refusée")
pD = panel("D", 6, 3); act("ECH-36", E, "auh_bro", "Installation du champ D (B=6, b=3)", f"select public.pheno_panel_installer({lit(pD)})")
check("ECH-37", E, "Répartition 10 titulaires sur 3 blocs : 4+3+3, réserves 1+1+0", f"select string_agg(nb_titulaires_prevus || '+' || nb_reserves_prevues, ',' order by rang_tirage) from pheno_blocs where panel_id='{pD['id']}' and tire", "4+1,3+1,3+0")
act("ECH-38", E, "auh_bro", "Marquage GPS d'un arbre", f"select public.pheno_arbre_marquer({lit({'arbre_id': arbre_id(bl[attendu[0]], ordre1[0]), 'latitude': 7.7, 'longitude': -4.8, 'precision_m': 6})})")
act("ECH-39", E, "auh_bro", "GPS invalide : refusé", f"select public.pheno_arbre_marquer({lit({'arbre_id': arbre_id(bl[attendu[0]], ordre1[0]), 'latitude': 97, 'longitude': -4.8})})", False, "GPS")

# ---------------------------------------------------------------------------
# B. Observation terrain et synchronisation
# ---------------------------------------------------------------------------
ARB = json.loads(q(f"select json_agg(json_build_object('id', id, 'code', code, 'role', role, 'rang', rang, 'bloc', bloc_id) order by role desc, rang) from pheno_arbres where panel_id='{pA['id']}'"))
TIT = [a for a in ARB if a["role"] == "TITULAIRE"]; RES = [a for a in ARB if a["role"] == "RESERVE"]
def obs(a, **k):
    base = {"arbre_id": a["id"], "retrouve": True, "f": "NON", "n": "NON", "p": "NON", "chute": "ABSENCE"}
    base.update(k); return base
def visite(vid, sem_back, observations, soumettre=True, **k):
    d = jour(sem_back)
    v = {"id": vid, "panel_id": pA["id"], "date_observation": d, "semaine_iso": semaine(d),
         "saisie_le": datetime.datetime.now(datetime.timezone.utc).isoformat(), "soumettre": soumettre, "ramassage": "NON", "observations": observations}
    v.update(k); return v

V1 = str(uuid.uuid4())
r = sync1("OBS-01", O, "auh_bro", "Brouillon partiel (3 arbres, réponses incomplètes)", "VISITE_ENREGISTRER",
          visite(V1, 3, [{"arbre_id": TIT[0]["id"], "retrouve": True, "f": "OUI"}, {"arbre_id": TIT[1]["id"]}, {"arbre_id": TIT[2]["id"], "retrouve": True}], soumettre=False, ramassage=None), "ACCEPTEE", "BROUILLON")
check("OBS-02", O, "Aucun « Non » pré-rempli : les réponses absentes restent vides", f"select count(*) filter (where n is null) || '|' || count(*) filter (where n='NON') || '|' || count(*) filter (where retrouve is null) from pheno_observations where visite_id='{V1}'", "3|0|1")
r = sync1("OBS-03", O, "auh_bro", "Soumission incomplète : refusée", "VISITE_ENREGISTRER", visite(V1, 3, [obs(a) for a in TIT[:4]], base_version=None), "REJETEE", "incomplète")
check("OBS-04", O, "Un refus n'écrit rien (transaction annulée)", f"select statut || '|' || (select count(*) from pheno_observations where visite_id='{V1}') from pheno_visites where id='{V1}'", "BROUILLON|3")
sync1("OBS-05", O, "auh_bro", "« Pas vu » sans raison : refusé", "VISITE_ENREGISTRER", visite(V1, 3, [obs(a) for a in TIT[:9]] + [obs(TIT[9], f="PAS_VU")]), "REJETEE", "Raison obligatoire")
sync1("OBS-06", O, "auh_bro", "Chute de fruits mûrs sans source de preuve : refusée", "VISITE_ENREGISTRER", visite(V1, 3, [obs(a) for a in TIT[:9]] + [obs(TIT[9], chute="MURE")]), "REJETEE", "preuve")
sync1("OBS-07", O, "auh_bro", "Arbre non retrouvé sans raison : refusé", "VISITE_ENREGISTRER", visite(V1, 3, [obs(a) for a in TIT[:9]] + [{"arbre_id": TIT[9]["id"], "retrouve": False}]), "REJETEE", "Raison obligatoire")
sync1("OBS-08", O, "auh_bro", "Observation d'une réserve non activée : refusée", "VISITE_ENREGISTRER", visite(V1, 3, [obs(a) for a in TIT] + [obs(RES[0])]), "REJETEE", "réserve")
sync1("OBS-09", O, "auh_bro", "Semaine incohérente avec la date : refusée", "VISITE_ENREGISTRER", visite(V1, 3, [obs(a) for a in TIT], semaine_iso="2020-W01"), "REJETEE", "semaine")
sync1("OBS-10", O, "auh_bro", "Date d'observation future : refusée", "VISITE_ENREGISTRER", visite(str(uuid.uuid4()), -2, [obs(a) for a in TIT]), "REJETEE", "futur")
sync1("OBS-11", O, "auh_bro", "Ramassage non renseigné : refusé", "VISITE_ENREGISTRER", visite(V1, 3, [obs(a) for a in TIT], ramassage=None), "REJETEE", "ramassage")
CLE1 = str(uuid.uuid4())
obs_s1 = [obs(TIT[0], f="OUI"), obs(TIT[1], f="OUI"), obs(TIT[2], f="PAS_VU", pas_vu_motif="Branches trop hautes")] + [obs(a) for a in TIT[3:9]] + [{"arbre_id": TIT[9]["id"], "retrouve": False, "pas_vu_motif": "Marque effacée", "f": "OUI"}]
v1_payload = visite(V1, 3, obs_s1)
r = sync1("OBS-12", O, "auh_bro", "Soumission complète de la semaine 1", "VISITE_ENREGISTRER", v1_payload, "ACCEPTEE", "SOUMIS", cle=CLE1)
check("OBS-13", O, "Trois dates conservées : observation, saisie, réception serveur", f"select (date_observation is not null and saisie_le is not null and recu_serveur_le is not null)::text || '|' || (device_id is not null)::text from pheno_visites where id='{V1}'", "true|true")
check("OBS-14", O, "Arbre non retrouvé : aucun stade enregistré", f"select coalesce(f, 'vide') || '|' || coalesce(chute, 'vide') from pheno_observations where visite_id='{V1}' and arbre_id='{TIT[9]['id']}'", "vide|vide")

r = sync1("SYN-01", S, "auh_bro", "Renvoi de la même opération (même clé) : rejouée, sans doublon", "VISITE_ENREGISTRER", v1_payload, "ACCEPTEE", "rejoue", cle=CLE1)
check("SYN-02", S, "Une seule visite, dix observations après renvoi", f"select count(*) || '|' || (select count(*) from pheno_observations where visite_id='{V1}') from pheno_visites where panel_id='{pA['id']}'", "1|10")
sync1("SYN-03", S, "auh_bro", "Même clé, contenu différent : refusé", "VISITE_ENREGISTRER", visite(V1, 3, [obs(a, f="OUI") for a in TIT]), "REJETEE", "déjà utilisée", cle=CLE1)
sync1("SYN-04", S, "uh_bro", "Autre appareil, même champ, même semaine : conflit, rien d'écrasé", "VISITE_ENREGISTRER", visite(str(uuid.uuid4()), 3, [obs(a, f="OUI") for a in TIT]), "CONFLIT", "DOUBLON_SEMAINE")
check("SYN-05", S, "La visite d'origine est intacte", f"select count(*) || '|' || (select count(*) from pheno_observations o join pheno_visites v on v.id=o.visite_id where v.panel_id='{pA['id']}' and o.f='OUI') from pheno_visites where panel_id='{pA['id']}'", "1|2")
modif = [dict(o) for o in obs_s1]; modif[3] = obs(TIT[3], f="OUI")
r = sync1("SYN-06", S, "auh_bro", "Modification hors ligne d'une visite déjà soumise : proposition, pas d'écrasement", "VISITE_ENREGISTRER", visite(V1, 3, modif), "CONFLIT", "VISITE_FIGEE")
check("SYN-07", S, "Valeur serveur inchangée, proposition de correction enregistrée", f"select (select f from pheno_observations where visite_id='{V1}' and arbre_id='{TIT[3]['id']}') || '|' || (select count(*) from pheno_corrections where visite_id='{V1}' and statut='PROPOSEE' and champ='f' and nouvelle_valeur='OUI')", "NON|1")
r = sync("auh_bro", [{"idempotency_key": str(uuid.uuid4()), "type": "VISITE_ENREGISTRER", "payload": {}}] * 51)
record("SYN-08", S, "auh_bro", "Lot de 51 opérations : refusé", "REFUS (50)", "50" in r.get("erreur", ""), r.get("erreur", "accepté"))
sync1("SYN-09", S, "auh_bro", "Type d'opération inconnu : refusé", "SUPPRIMER_TOUT", {}, "REJETEE", "inconnu")
r = sync("auh_bro", [{"type": "VISITE_ENREGISTRER", "payload": {}}])["resultats"][0]
record("SYN-10", S, "auh_bro", "Opération sans clé d'idempotence : refusée", "REJETEE", r.get("statut") == "REJETEE", json.dumps(r, ensure_ascii=False))
V2 = str(uuid.uuid4()); CLE2 = str(uuid.uuid4())
r = sync1("SYN-11", S, "auh_bro", "Brouillon semaine 2 enregistré", "VISITE_ENREGISTRER", visite(V2, 2, [obs(a) for a in TIT[:5]], soumettre=False), "ACCEPTEE", "BROUILLON", cle=CLE2)
sync1("SYN-12", S, "auh_bro", "Brouillon modifié avec une version périmée : conflit de version", "VISITE_ENREGISTRER", visite(V2, 2, [obs(a) for a in TIT[:6]], soumettre=False, base_version=99), "CONFLIT", "VERSION")
obs_s2 = [obs(TIT[0], f="OUI", n="OUI"), obs(TIT[1], f="OUI", chute="MURE", chute_preuve="VUE_AGENT"), obs(TIT[2], chute="PREMATUREE", chute_preuve="VUE_AGENT"),
          obs(TIT[3], f="OUI", chute="NON_CONFIRME"), obs(TIT[4], chute="MURE", chute_preuve="DECLAREE_PRODUCTEUR")] + [obs(a) for a in TIT[5:]]
r = sync1("SYN-13", S, "auh_bro", "Semaine 2 soumise avec la bonne version", "VISITE_ENREGISTRER", visite(V2, 2, obs_s2, base_version=r.get("row_version")), "ACCEPTEE", "SOUMIS")
ops = [{"idempotency_key": str(uuid.uuid4()), "type": "VISITE_ENREGISTRER", "payload": visite(str(uuid.uuid4()), 1, [obs(a) for a in TIT[:2]], soumettre=False)},
       {"idempotency_key": str(uuid.uuid4()), "type": "BLOC_INVENTORIER", "payload": {"bloc_id": str(uuid.uuid4()), "nb_arbres": 4}}]
r = sync("auh_bro", ops)["resultats"]
record("SYN-14", S, "auh_bro", "Lot mixte : une opération acceptée, une refusée, chacune avec son accusé", "ACCEPTEE + REJETEE", [x.get("statut") for x in r] == ["ACCEPTEE", "REJETEE"] and all("recu_serveur_le" in x for x in r), json.dumps([x.get("statut") for x in r]))
V3 = ops[0]["payload"]["id"]
VT = str(uuid.uuid4())
sync1("SYN-15", S, "auh_bro", "Transcription papier où l'observateur est le transcripteur : refusée", "VISITE_ENREGISTRER",
      {**visite(VT, 0, [obs(a) for a in TIT]), "panel_id": pC["id"], "mode_saisie": "TRANSCRIPTION_PAPIER", "observateur_id": U["auh_bro"]}, "REJETEE", "autre personne")
ARBC = json.loads(q(f"select json_agg(json_build_object('id', id)) from pheno_arbres where panel_id='{pC['id']}' and role='TITULAIRE'"))
sync1("SYN-16", S, "auh_bro", "Transcription papier : observateur distinct, tracé", "VISITE_ENREGISTRER",
      {**visite(VT, 0, [obs(a) for a in ARBC]), "panel_id": pC["id"], "mode_saisie": "TRANSCRIPTION_PAPIER", "observateur_id": U["auh_bro2"]}, "ACCEPTEE", "SOUMIS")
check("SYN-17", S, "Observateur et transcripteur distincts enregistrés", f"select (observateur_id='{U['auh_bro2']}')::text || '|' || (transcripteur_id='{U['auh_bro']}')::text from pheno_visites where id='{VT}'", "true|true")
sync1("SYN-18", S, "auh_bro", "Installation hors ligne synchronisée par lot", "PANEL_INSTALLER", panel("G", 4, 1), "ACCEPTEE", "blocs_tires")

# ---------------------------------------------------------------------------
# C. Circuit de validation
# ---------------------------------------------------------------------------
act("VAL-01", V, "auh_bro2", "Assistant Unit Head vérifie : refusé", f"select public.pheno_visite_verifier('{V1}')", False, "non autorisée")
act("VAL-02", V, "auh_bro", "L'auteur vérifie sa propre visite : refusé", f"select public.pheno_visite_verifier('{V1}')", False, "observée ou saisie")
act("VAL-03", V, "uh_bot", "Unit Head d'un autre cluster vérifie : refusé (visite invisible)", f"select public.pheno_visite_verifier('{V1}')", False, "introuvable")
act("VAL-04", V, "uh_bro", "Unit Head du cluster met en vérification", f"select public.pheno_visite_verifier('{V1}')", True, "EN_VERIFICATION")
act("VAL-05", V, "uh_bro", "Unit Head valide sans affectation : refusé", f"select public.pheno_visite_valider('{V1}')", False, "affectation")
act("VAL-06", V, "zh1", "Zonal Head valide sans affectation agronomique : refusé", f"select public.pheno_visite_valider('{V1}')", False, "affectation")
aff = {"campaign_id": CAMP, "user_id": U["zh1"], "cluster_codes": ["BROBO"], "droit": "VALIDATION", "motif": "Affectation fictive"}
act("VAL-07", V, "uh_bro", "Unit Head accorde une affectation : refusé", f"select public.pheno_affectation_accorder({lit(aff)})", False, "Branch Manager")
act("VAL-08", V, "bm", "BM affecte la validation à un Assistant Unit Head : refusé", f"select public.pheno_affectation_accorder({lit({**aff, 'user_id': U['auh_bro2']})})", False, "ne peut viser")
act("VAL-09", V, "bm", "BM affecte la validation à un RT : refusé", f"select public.pheno_affectation_accorder({lit({**aff, 'user_id': U['rt']})})", False, "ne peut viser")
act("VAL-10", V, "bm", "BM accorde une affectation expirée au Zonal Head 1", f"select public.pheno_affectation_accorder({lit({**aff, 'valide_du': str(today - datetime.timedelta(days=30)), 'valide_au': str(today - datetime.timedelta(days=1))})})")
act("VAL-11", V, "zh1", "Zonal Head avec affectation expirée : refusé", f"select public.pheno_visite_valider('{V1}')", False, "affectation")
act("VAL-12", V, "bm", "BM accorde au Zonal Head 2 la validation de BROBO (hors de sa zone)", f"select public.pheno_affectation_accorder({lit({**aff, 'user_id': U['zh2']})})")
act("VAL-13", V, "zh2", "Zonal Head hors zone, même affecté : refusé", f"select public.pheno_visite_valider('{V1}')", False, "introuvable")
a1 = act("VAL-14", V, "bm", "BM accorde au Zonal Head 1 la validation de BROBO", f"select public.pheno_affectation_accorder({lit(aff)})")
act("VAL-15", V, "zh1", "Demande de correction sans motif : refusée", f"select public.pheno_visite_demander_correction('{V1}', ' ')", False, "Motif")
act("VAL-16", V, "zh1", "Zonal Head affecté demande une correction motivée", f"select public.pheno_visite_demander_correction('{V1}', 'Arbre 4 : floraison à revoir')", True, "CORRECTION_DEMANDEE")
act("VAL-17", V, "zh1", "Valider une visite en correction demandée : refusé", f"select public.pheno_visite_valider('{V1}')", False, "soumise ou en vérification")
rv = int(q(f"select row_version from pheno_visites where id='{V1}'"))
sync1("VAL-18", V, "auh_bro", "L'auteur soumet à nouveau sans motif : refusé", "VISITE_ENREGISTRER", visite(V1, 3, modif, base_version=rv), "REJETEE", "Motif de correction")
sync1("VAL-19", V, "auh_bro", "L'auteur corrige et soumet avec motif", "VISITE_ENREGISTRER", visite(V1, 3, modif, base_version=rv, motif_correction="Relecture de la fiche : fleurs ouvertes sur l'arbre 4"), "ACCEPTEE", "SOUMIS")
check("VAL-20", V, "Historique : auteur, ancienne et nouvelle valeur, motif", f"select (acteur='{U['auh_bro']}')::text || '|' || (ancienne->>'valeur') || '|' || (nouvelle->>'valeur') || '|' || (motif is not null)::text from pheno_journal where action='CORRECTION_AUTEUR' and nouvelle->>'champ'='f'", "true|NON|OUI|true")
act("VAL-21", V, "zh1", "Zonal Head affecté valide la semaine 1", f"select public.pheno_visite_valider('{V1}')", True, "VALIDE")
act("VAL-22", V, "zh1", "Valider deux fois : refusé", f"select public.pheno_visite_valider('{V1}')", False, "soumise ou en vérification")
act("VAL-23", V, "zh1", "Version périmée à la validation : refusée", f"select public.pheno_visite_valider('{V2}', 1)", False, "changé")
act("VAL-24", V, "zh1", "Zonal Head affecté valide la semaine 2", f"select public.pheno_visite_valider('{V2}')", True, "VALIDE")
modif2 = [dict(o) for o in obs_s2]; modif2[5] = obs(TIT[5], chute="MURE", chute_preuve="VUE_AGENT")
sync1("VAL-25", V, "auh_bro", "Envoi hors ligne tardif sur une visite VALIDÉE : proposition, jamais d'écrasement", "VISITE_ENREGISTRER", visite(V2, 2, modif2), "CONFLIT", "VISITE_FIGEE")
check("VAL-26", V, "Visite validée intacte", f"select statut || '|' || (select chute from pheno_observations where visite_id='{V2}' and arbre_id='{TIT[5]['id']}') from pheno_visites where id='{V2}'", "VALIDE|ABSENCE")
cid = q(f"select id from pheno_corrections where visite_id='{V2}' and champ='chute' and statut='PROPOSEE'")
act("VAL-27", V, "auh_bro", "L'auteur décide de sa propre proposition : refusé", f"select public.pheno_correction_decider('{cid}', 'APPLIQUEE', 'ok')", False, "valideur")
act("VAL-28", V, "uh_bro", "Unit Head sans affectation décide : refusé", f"select public.pheno_correction_decider('{cid}', 'APPLIQUEE', 'ok')", False, "valideur")
act("VAL-29", V, "zh1", "Décision sans motif : refusée", f"select public.pheno_correction_decider('{cid}', 'APPLIQUEE', '')", False, "Motif")
act("VAL-30", V, "zh1", "Le valideur applique la correction avec motif", f"select public.pheno_correction_decider('{cid}', 'APPLIQUEE', 'Confirmé par contre-visite fictive')", True, "APPLIQUEE")
check("VAL-31", V, "Correction appliquée et journalisée (ancienne → nouvelle)", f"select (select chute from pheno_observations where visite_id='{V2}' and arbre_id='{TIT[5]['id']}') || '|' || (select (ancienne->>'valeur') || '>' || (nouvelle->>'valeur') from pheno_journal where action='CORRECTION_APPLIQUEE')", "MURE|ABSENCE>MURE")
cid2 = q(f"select id from pheno_corrections where visite_id='{V2}' and champ='chute_preuve' and statut='PROPOSEE'")
act("VAL-32", V, "zh1", "Application de la preuve associée", f"select public.pheno_correction_decider('{cid2}', 'APPLIQUEE', 'Même contre-visite fictive')", True, "APPLIQUEE")
VBM = str(uuid.uuid4())
ARBG = None
sync1("VAL-33", V, "bm", "BM observe lui-même une visite (champ C, semaine précédente)", "VISITE_ENREGISTRER", {**visite(VBM, 1, [obs(a) for a in ARBC]), "panel_id": pC["id"]}, "ACCEPTEE", "SOUMIS")
act("VAL-34", V, "bm", "BM valide sa propre visite : refusé", f"select public.pheno_visite_valider('{VBM}')", False, "observée ou saisie")
act("VAL-35", V, "bm", "BM révoque l'affectation du Zonal Head 1", f"select public.pheno_affectation_revoquer('{a1.get('affectation_id')}', 'Fin de mission fictive')")
act("VAL-36", V, "zh1", "Zonal Head révoqué valide : refusé", f"select public.pheno_visite_valider('{VBM}')", False, "affectation")
act("VAL-37", V, "uh_bro", "Activation d'une réserve sans droit de validation : refusé", f"select public.pheno_reserve_activer('{TIT[9]['id']}', 'Arbre perdu')", False, "valideur")
act("VAL-38", V, "bm", "BM active une réserve (arbre non retrouvé), motif obligatoire", f"select public.pheno_reserve_activer('{TIT[9]['id']}', 'Arbre fictif non retrouvé deux semaines')", True, "reserve_activee")
check("VAL-39", V, "Titulaire remplacé, réserve activée, probabilité marquée approchée", f"select (select statut from pheno_arbres where id='{TIT[9]['id']}') || '|' || count(*) filter (where statut='RESERVE_ACTIVEE' and proba_approchee and proba_inclusion is not null) from pheno_arbres where panel_id='{pA['id']}'", "REMPLACE|1")
check("VAL-40", V, "Événements de maturité : intervalle (dernière visite négative, première positive)", f"select (derniere_visite_negative)::text || '|' || premiere_visite_positive::text from pheno_evenements_maturite where arbre_id='{TIT[5]['id']}' and stade='C'", f"{jour(3)}|{jour(2)}")

# ---------------------------------------------------------------------------
# D. Indicateurs pilote (visites validées uniquement)
# ---------------------------------------------------------------------------
check("IND-01", I, "Seules les visites validées alimentent les vues (V1, V2)", f"select count(*) from pheno_v_champ_semaine where panel_id='{pA['id']}'", "2")
check("IND-02", I, "Brouillon de la semaine 3 exclu", f"select count(*) from pheno_v_champ_semaine where visite_id='{V3}'", "0")
w = {a["id"]: (7 / 5 if a["bloc"] == bl[attendu[0]] else 9 / 5) for a in TIT}  # poids relatifs (π amont commun)
num = sum(w[TIT[i]["id"]] for i in (0, 1, 3)); den = sum(w[TIT[i]["id"]] for i in range(10) if i not in (2, 9))
check("IND-03", I, "Semaine 1 : part F pondérée, 3 Oui sur 8 réponses définies (« Pas vu » et non retrouvé hors dénominateur)", f"select part_f from pheno_v_champ_semaine where visite_id='{V1}'", f"{num / den:.4f}")
# Semaine 2 : MÛRE sur TIT[1], TIT[4], TIT[5] ; « non confirmé » (TIT[3]) hors dénominateur.
num = sum(w[TIT[i]["id"]] for i in (1, 4, 5)); den = sum(w[TIT[i]["id"]] for i in range(10) if i != 3)
check("IND-04", I, "Semaine 2 : part C hebdo pondérée (prématurée et non confirmée ne comptent pas en C)", f"select part_c_hebdo from pheno_v_champ_semaine where visite_id='{V2}'", f"{num / den:.4f}")
check("IND-05", I, "Chutes prématurées et non confirmées comptées à part", f"select chutes_prematurees || '|' || chutes_non_confirmees || '|' || c_declarees_producteur from pheno_v_champ_semaine where visite_id='{V2}'", "1|1|1")
check("IND-06", I, "Vues étiquetées pilote, non officielles", "select string_agg(distinct nature, ',') from pheno_v_champ_semaine", "PILOTE_NON_OFFICIEL")
# Semaine 3 (jour(1)) validée sans aucune chute : le cumul ne doit pas redescendre.
act("IND-07", I, "bm", "BM accorde au Zonal Head 1 une nouvelle affectation", f"select public.pheno_affectation_accorder({lit(aff)})")
ARB2 = json.loads(q(f"select json_agg(json_build_object('id', id, 'bloc', bloc_id, 'statut', statut)) from pheno_arbres where panel_id='{pA['id']}' and statut in ('ACTIF','RESERVE_ACTIVEE')"))
rv3 = int(q(f"select row_version from pheno_visites where id='{V3}'"))
sync1("IND-08", I, "auh_bro", "Semaine 3 soumise : aucune chute observée", "VISITE_ENREGISTRER", visite(V3, 1, [obs(a) for a in ARB2], base_version=rv3), "ACCEPTEE", "SOUMIS")
act("IND-09", I, "zh1", "Semaine 3 validée", f"select public.pheno_visite_valider('{V3}')", True, "VALIDE")
cum = q(f"select string_agg(arbres_c_cumules::text, ',' order by date_observation) from pheno_v_c_cumulatif where panel_id='{pA['id']}'")
record("IND-10", I, "postgres (lecture)", "C cumulatif : 0 puis 3 puis 3 (une semaine sans chute n'efface rien)", "0,3,3", cum == "0,3,3", cum)
check("IND-11", I, "Réserves (en attente ou activée) et titulaire remplacé hors dénominateur : 9 titulaires suivis", f"select string_agg(distinct arbres_suivis::text, ',') from pheno_v_c_cumulatif where panel_id='{pA['id']}'", "9")
check("IND-12", I, "Palier expérimental : couverture insuffisante (1 champ validé sur 4 actifs)", f"select palier_experimental from pheno_v_c_cumulatif_cluster where cluster_code='BROBO' and semaine_iso='{semaine(jour(1))}'", "COUVERTURE_INSUFFISANTE")
check("IND-14", I, "Réserve activée : comptée à part, hors proportions", f"select reserves_activees_observees || '|' || arbres_observes from pheno_v_champ_semaine where visite_id='{V3}'", "1|9")
check("IND-15", I, "Cluster : ratio pondéré (pas une moyenne de proportions)", f"select (part_c_cumulatif_ratio = (select round(sum(poids_c)/sum(poids_total),4) from pheno_v_c_cumulatif where cluster_code='BROBO' and semaine_iso='{semaine(jour(1))}'))::text from pheno_v_c_cumulatif_cluster where cluster_code='BROBO' and semaine_iso='{semaine(jour(1))}'", "true")
check("IND-16", I, "Non-réponse pondérée publiée (semaine 1 : « Pas vu » et non retrouvé)", f"select (non_reponse_f > 0)::text from pheno_v_champ_semaine where visite_id='{V1}'", "true")
check("IND-13", I, "Qualité : transcription papier comptée", f"select sum(transcriptions_papier) from pheno_v_qualite where cluster_code='BROBO'", "1")

# ---------------------------------------------------------------------------
# E. Sécurité : RLS positive et négative par profil fictif
# ---------------------------------------------------------------------------
pE = panel("E", 4, 2); act("SEC-01", X, "uh_bot", "Unit Head Botro installe un champ dans SON cluster", f"select public.pheno_panel_installer({lit(pE)})")
act("SEC-02", X, "uh_bot", "Unit Head Botro installe un champ à Brobo : refusé", f"select public.pheno_panel_installer({lit(panel('D', 4, 2))})", False, "réservée aux agents du cluster")
act("SEC-03", X, "anon", "Anonyme lit les champs : refusé", "select count(*) from public.pheno_panels", False, "permission")
act("SEC-04", X, "anon", "Anonyme appelle la synchronisation : refusé", "select public.pheno_sync_batch('[]'::jsonb)", False, "permission")
nb = q("select count(*) from pheno_panels"); nb_bro = q("select count(*) from pheno_panels where cluster_code='BROBO'")
for i, (u, exp, lab) in enumerate([("bm", nb, "BM : tous les champs"), ("abm", nb, "ABM : tous les champs (lecture)"), ("zh1", nb_bro, "Zonal Head 1 : sa zone seulement"),
        ("zh2", "1", "Zonal Head 2 : sa zone seulement"), ("uh_bro", nb_bro, "Unit Head Brobo : son cluster"), ("uh_bot", "1", "Unit Head Botro : son cluster"),
        ("auh_bro", nb_bro, "Assistant Unit Head Brobo : son cluster"), ("rt", "0", "RT : aucun champ"), ("sup", "0", "Supervisor : aucun champ"),
        ("gm", "0", "General Manager : aucun champ (non prévu au pilote)"), ("uh_inactif", "0", "Compte inactif : aucun champ")], start=5):
    vu_par(f"SEC-{i:02d}", X, u, lab, "select count(*) from public.pheno_panels", exp)
for i, t in enumerate(["pheno_visites", "pheno_observations", "pheno_arbres", "pheno_blocs", "pheno_journal", "pheno_corrections", "pheno_evenements_maturite"], start=16):
    vu_par(f"SEC-{i}", X, "uh_bot", f"Unit Head Botro ne lit rien de Brobo dans {t}", f"select count(*) from public.{t} x where " + {
        "pheno_visites": "x.cluster_code='BROBO'", "pheno_journal": "x.cluster_code='BROBO'",
        "pheno_observations": f"x.visite_id in ('{V1}','{V2}')", "pheno_corrections": f"x.visite_id in ('{V1}','{V2}')",
        "pheno_arbres": f"x.panel_id='{pA['id']}'", "pheno_blocs": f"x.panel_id='{pA['id']}'", "pheno_evenements_maturite": f"x.panel_id='{pA['id']}'"}[t], "0")
vu_par("SEC-23", X, "rt", "RT ne lit aucune observation de référence", "select (select count(*) from public.pheno_observations) + (select count(*) from public.pheno_visites) + (select count(*) from public.pheno_v_champ_semaine)", "0")
act("SEC-24", X, "rt", "RT appelle la synchronisation : refusé", "select public.pheno_sync_batch('[]'::jsonb)", False, "refusé")
act("SEC-25", X, "sup", "Supervisor installe un champ : refusé", f"select public.pheno_panel_installer({lit(panel('D', 4, 2))})", False, "refusé")
act("SEC-26", X, "uh_inactif", "Compte inactif synchronise : refusé", "select public.pheno_sync_batch('[]'::jsonb)", False, "refusé")
sync1("SEC-27", X, "uh_bot", "Unit Head Botro envoie une visite sur un champ de Brobo : refusé", "VISITE_ENREGISTRER", visite(str(uuid.uuid4()), 0, [obs(a) for a in ARB2]), "REJETEE", "PH001")
sync1("SEC-28", X, "zh1", "Zonal Head collecte une visite : refusé (pas un rôle de collecte)", "VISITE_ENREGISTRER", visite(str(uuid.uuid4()), 0, [obs(a) for a in ARB2]), "REJETEE", "PH001")
for i, (t, sql) in enumerate([("insert visite", f"insert into public.pheno_visites (id, panel_id, campaign_id, cluster_code, semaine_iso, date_observation, observateur_id) values (gen_random_uuid(), '{pA['id']}', '{CAMP}', 'BROBO', '2026-W01', current_date, '{U['bm']}')"),
        ("update visite (auto-validation)", f"update public.pheno_visites set statut='VALIDE' where id='{VBM}'"),
        ("update observation", f"update public.pheno_observations set f='OUI' where visite_id='{V1}'"),
        ("delete visite", f"delete from public.pheno_visites where id='{V1}'"),
        ("insert affectation", f"insert into public.pheno_affectations (campaign_id, user_id, cluster_codes, droit, accorde_par) values ('{CAMP}', '{U['bm']}', '{{BROBO}}', 'VALIDATION', '{U['bm']}')"),
        ("insert journal", "insert into public.pheno_journal (entite, action) values ('X', 'Y')"),
        ("update arbre (probabilité)", f"update public.pheno_arbres set proba_inclusion=1 where panel_id='{pA['id']}'")], start=29):
    act(f"SEC-{i}", X, "bm", f"Écriture directe refusée, même au BM : {t}", sql, False, "permission")
act("SEC-36", X, "bm", "Fonction interne non appelable directement", "select private.pheno_visite_enregistrer('{}'::jsonb)", False, "permission")
act("SEC-37", X, "uh_bro", "Fonction interne de tirage non appelable", f"select private.pheno_tirer_arbres('{pA['id']}')", False, "permission")
vu_par("SEC-38", X, "zh1", "Zonal Head lit ses seules affectations", "select count(*) = count(*) filter (where user_id = auth.uid()) and count(*) > 0 from public.pheno_affectations", "t")
vu_par("SEC-39", X, "uh_bro", "Unit Head ne lit pas les affectations des autres", "select count(*) from public.pheno_affectations", "0")
chemin = f"{CAMP}/{pA['id']}/{U['auh_bro']}/arbre01.jpg"
def depot(u, path): return f"insert into storage.objects (bucket_id, name, owner) values ('pheno-preuves', '{path}', '{U.get(u, U['bm'])}')"
act("SEC-40", X, "auh_bro", "Preuve : dépôt dans son dossier, champ de son cluster", depot("auh_bro", chemin))
act("SEC-41", X, "auh_bro", "Preuve : dépôt sous l'identité d'un autre : refusé", depot("auh_bro", f"{CAMP}/{pA['id']}/{U['uh_bro']}/x.jpg"), False, "row-level security")
act("SEC-42", X, "uh_bot", "Preuve : dépôt sur un champ d'un autre cluster : refusé", depot("uh_bot", f"{CAMP}/{pA['id']}/{U['uh_bot']}/x.jpg"), False, "row-level security")
act("SEC-43", X, "auh_bro", "Preuve : chemin non conforme : refusé par défaut", depot("auh_bro", "n-importe-quoi/x.jpg"), False, "row-level security")
act("SEC-44", X, "auh_bro", "Preuve : extension non autorisée : refusé", depot("auh_bro", f"{CAMP}/{pA['id']}/{U['auh_bro']}/x.exe"), False, "row-level security")
act("SEC-45", X, "auh_bro", "Preuve : campagne ne correspondant pas au champ : refusé", depot("auh_bro", f"{CAMP_FERMEE}/{pA['id']}/{U['auh_bro']}/x.jpg"), False, "row-level security")
act("SEC-46", X, "rt", "Preuve : dépôt par un RT : refusé", depot("rt", f"{CAMP}/{pA['id']}/{U['rt']}/x.jpg"), False, "row-level security")
vu_par("SEC-47", X, "uh_bro", "Preuve : lecture par le cluster", "select count(*) from storage.objects where bucket_id='pheno-preuves'", "1")
vu_par("SEC-48", X, "uh_bot", "Preuve : invisible pour un autre cluster", "select count(*) from storage.objects where bucket_id='pheno-preuves'", "0")
vu_par("SEC-49", X, "rt", "Preuve : invisible pour un RT", "select count(*) from storage.objects where bucket_id='pheno-preuves'", "0")
ok, out = run_as("auh_bro", f"delete from storage.objects where bucket_id='pheno-preuves' returning 1")
record("SEC-50", X, "auh_bro", "Preuve : suppression impossible (aucune politique)", "0 ligne", q("select count(*) from storage.objects where bucket_id='pheno-preuves'") == "1", out)
ok, out = run_as("auh_bro", f"update storage.objects set name='{CAMP}/{pA['id']}/{U['auh_bro']}/autre.jpg' where bucket_id='pheno-preuves' returning 1")
record("SEC-51", X, "auh_bro", "Preuve : remplacement impossible (aucune politique)", "inchangé", q("select name from storage.objects where bucket_id='pheno-preuves'") == chemin, out)
sync1("SEC-52", X, "auh_bro", "Référence de preuve pointant hors du champ : refusée", "VISITE_ENREGISTRER", visite(str(uuid.uuid4()), 0, [obs(ARB2[0], photo_ref="autre-dossier/x.jpg")], soumettre=False), "REJETEE", "preuve")
check("SEC-53", X, "Bucket de preuves privé", "select public::text from storage.buckets where id='pheno-preuves'", "false")
check("SEC-54", X, "RLS active sur toutes les tables de l'Observatoire", "select count(*) filter (where relrowsecurity) || '/' || count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'pheno\\_%'", "11/11")
check("SEC-55", X, "Aucune politique d'écriture sur les tables de l'Observatoire", "select count(*) from pg_policies where schemaname='public' and tablename like 'pheno\\_%' and cmd <> 'SELECT'", "0")
check("SEC-56", X, "Toutes les fonctions SECURITY DEFINER du module fixent search_path", "select count(*) from pg_proc p where p.proname like 'pheno\\_%' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')", "0")
check("SEC-57", X, "Aucune fonction du module exécutable par anon", "select count(*) from pg_proc p where p.proname like 'pheno\\_%' and has_function_privilege('anon', p.oid, 'execute')", "0")

sync1("SEC-61", X, "uh_bro", "Fiche papier : observateur d'un autre cluster refusé", "VISITE_ENREGISTRER",
      {**visite(str(uuid.uuid4()), 0, [obs(a) for a in ARB2]), "mode_saisie": "TRANSCRIPTION_PAPIER", "observateur_id": U["uh_bot"]}, "REJETEE", "cluster")
VS = str(uuid.uuid4())
sync1("SEC-62", X, "uh_bro", "Identité falsifiée dans la charge (user_id, acteur, observateur en mode direct) : envoi accepté…", "VISITE_ENREGISTRER",
      {**visite(VS, 2, [obs(a) for a in ARBC], soumettre=False), "panel_id": pC["id"], "observateur_id": U["bm"], "user_id": U["bm"], "acteur": U["bm"], "statut": "VALIDE"}, "ACCEPTEE", "BROUILLON")
check("SEC-63", X, "… mais l'identité retenue est celle de la session, et le statut n'est pas forcé", f"select (observateur_id='{U['uh_bro']}')::text || '|' || statut from pheno_visites where id='{VS}'", "true|BROUILLON")
check("SEC-64", X, "Toutes les fonctions SECURITY DEFINER du module appartiennent au propriétaire du schéma (pas à authenticated)", "select count(*) from pg_proc p where p.proname like 'pheno\\_%' and p.prosecdef and pg_get_userbyid(p.proowner) in ('authenticated','anon')", "0")
check("SEC-65", X, "Aucune fonction privée du module exécutable par authenticated hors helpers de lecture", "select string_agg(proname, ',' order by proname) from pg_proc where pronamespace='private'::regnamespace and proname like 'pheno\\_%' and has_function_privilege('authenticated', oid, 'execute') and proname not in ('pheno_classe','pheno_peut_lire_cluster','pheno_peut_lire_panel','pheno_peut_lire_visite','pheno_preuve_autorisee')", "")
act("SEC-68", X, "uh_bro", "Lecture directe du rôle d'un autre compte : refusée", f"select private.pheno_classe_de('{U['bm']}')", False, "permission")
vu_par("SEC-66", X, "auh_bro", "Parcelles installables : seulement son cluster (BROBO)", "select string_agg(distinct cluster_code, ',') from public.pheno_parcelles_disponibles('" + CAMP + "')", "BROBO")
vu_par("SEC-67", X, "rt", "Parcelles installables : rien pour un RT", "select count(*) from public.pheno_parcelles_disponibles('" + CAMP + "')", "0")
# Concurrence : deux envois simultanés de la même opération (coupure après traitement, renvoi immédiat)
import threading
VC = str(uuid.uuid4()); CLEC = str(uuid.uuid4())
opc = [{"idempotency_key": CLEC, "type": "VISITE_ENREGISTRER", "payload": {**visite(VC, 3, [obs(a) for a in ARBC], soumettre=False), "panel_id": pC["id"]}}]
res = [None, None]
def envoi(k): res[k] = sync("uh_bro", opc)["resultats"][0]
th = [threading.Thread(target=envoi, args=(k,)) for k in (0, 1)]; [t.start() for t in th]; [t.join() for t in th]
record("SYN-19", S, "uh_bro", "Deux envois simultanés de la même opération : les deux reçoivent un accusé « acceptée »", "ACCEPTEE ×2 dont 1 rejouée",
       [r.get("statut") for r in res] == ["ACCEPTEE", "ACCEPTEE"] and sum(1 for r in res if r.get("rejoue")) == 1, json.dumps([[r.get("statut"), r.get("rejoue")] for r in res]))
check("SYN-20", S, "Envois simultanés : une seule visite, aucune erreur de doublon", f"select count(*) from pheno_visites where id='{VC}'", "1")
act("SEC-69", X, "uh_bot", "Appel direct d'une RPC d'écriture hors périmètre (marquage d'un arbre de Brobo) : refusé", f"select public.pheno_arbre_marquer({lit({'arbre_id': TIT[0]['id'], 'latitude': 7, 'longitude': -5})})", False, "réservé")
act("SEC-70", X, "uh_bot", "Appel direct de l'inventaire d'un bloc de Brobo : refusé", f"select public.pheno_bloc_inventorier({lit({'bloc_id': bl[attendu[0]], 'nb_arbres': 7})})", False, "réservé")
ok_i = psql(f"insert into public.pheno_visites (id, panel_id, campaign_id, cluster_code, semaine_iso, date_observation, observateur_id) values (gen_random_uuid(), '{pA['id']}', '{CAMP}', 'BOTRO', '2020-W01', '2020-01-01', '{U['bm']}')")[0] == 0
record("SEC-71", X, "postgres (superutilisateur)", "Visite dont le cluster diffère de celui de son champ : refusée par la base", "REFUS", not ok_i, "acceptée" if ok_i else "refusée")
r71 = sync("auh_bro", [{"idempotency_key": CLE1, "type": "VISITE_ENREGISTRER", "payload": v1_payload, "device_id": "AUTRE-APPAREIL", "created_at_client": "2026-01-01T00:00:00Z"}])["resultats"][0]
record("SEC-72", X, "auh_bro", "Même clé, même charge, depuis un autre appareil : refusée (empreinte sur l'enveloppe complète)", "REJETEE", r71.get("statut") == "REJETEE", json.dumps(r71, ensure_ascii=False))
r72 = sync("uh_bro", [{"idempotency_key": CLE1, "type": "VISITE_ENREGISTRER", "payload": v1_payload, "device_id": "APPAREIL-FICTIF-auh_bro", "created_at_client": DATES_CLIENT[CLE1]}])["resultats"][0]
record("SEC-76", X, "uh_bro", "Même enveloppe rejouée par un autre compte : refusée", "REJETEE", r72.get("statut") == "REJETEE", json.dumps(r72, ensure_ascii=False))
sync1("SEC-73", X, "auh_bro", "Photo référencée dans le dossier d'un autre agent : refusée", "VISITE_ENREGISTRER", visite(str(uuid.uuid4()), 0, [obs(ARB2[0], photo_ref=f"{CAMP}/{pA['id']}/{U['uh_bro']}/x.jpg")], soumettre=False), "REJETEE", "preuve")
r74 = sync("uh_bro", [{"idempotency_key": str(uuid.uuid4()), "type": "VISITE_ENREGISTRER", "payload": {"id": "pas-un-uuid", "panel_id": pA["id"]}}])["resultats"][0]
record("SEC-74", X, "uh_bro", "Erreur technique : aucun détail SQL renvoyé au téléphone, code de diagnostic", "TECHNIQUE sans texte SQL",
       r74.get("code") == "TECHNIQUE" and "uuid" not in r74.get("message", "").lower() and bool(r74.get("diagnostic")), json.dumps(r74, ensure_ascii=False))
check("SEC-75", X, "Détail technique conservé au journal, invisible des écrans (cluster nul)", f"select count(*) from pheno_journal where action='ERREUR_TECHNIQUE' and nouvelle->>'diagnostic'='{r74.get('diagnostic')}' and cluster_code is null", "1")
# --- Droits par campagne : une affectation ne vaut que pour SA campagne -----------------------
CAMP2 = str(uuid.uuid5(uuid.NAMESPACE_DNS, "campagne-fictive-simulation"))
q(f"select set_config('request.jwt.claim.sub', '{U['bm']}', false); insert into public.campaigns (id, code, name, year, status, is_current, campaign_type) values ('{CAMP2}', '2098', 'CAMPAGNE FICTIVE SIMULATION', 2098, 'OPEN', false, 'SIMULATION') on conflict do nothing;")
act("CMP-01", X, "bm", "Graine de la seconde campagne (distincte de la première)", f"select public.pheno_graine_creer('{CAMP2}')", True, '"deja_creee": false')
check("CMP-02", X, "Chaque campagne a sa propre graine", f"select count(distinct graine) from pheno_graines where campaign_id in ('{CAMP}','{CAMP2}')", "2")
pK = panel("A", 2, 1, camp=CAMP2)
act("CMP-03", X, "uh_bro", "Même parcelle installée dans une autre campagne : autorisé (panel par campagne)", f"select public.pheno_panel_installer({lit(pK)})")
G2 = q(f"select graine from pheno_graines where campaign_id='{CAMP2}'")
blK = {b["numero"]: b["id"] for b in pK["blocs"]}; tK = tirage(f"{G2}:{PLOTS['A']}:BLOCS", 2, 1)
act("CMP-04", X, "uh_bro", "Inventaire du bloc tiré (campagne 2)", f"select public.pheno_bloc_inventorier({lit({'bloc_id': blK[tK[0]], 'nb_arbres': 15})})", True, "ACTIF")
check("CMP-05", X, "Tirage de la campagne 2 indépendant de la campagne 1 (graine différente)", f"select (select string_agg(numero::text, ',' order by rang_tirage) from pheno_blocs where panel_id='{pK['id']}' and tire) = '{tK[0]}'", "t")
ARBK = json.loads(q(f"select json_agg(json_build_object('id', id)) from pheno_arbres where panel_id='{pK['id']}' and role='TITULAIRE'"))
VK = str(uuid.uuid4())
sync1("CMP-06", X, "auh_bro", "Visite soumise dans la campagne 2", "VISITE_ENREGISTRER", {**visite(VK, 1, [obs(a) for a in ARBK]), "panel_id": pK["id"]}, "ACCEPTEE", "SOUMIS")
check("CMP-07", X, "Le Zonal Head 1 a des affectations sur la campagne 1 et aucune sur la campagne 2", f"select (count(*) filter (where campaign_id='{CAMP}') > 0)::text || '/' || count(*) filter (where campaign_id='{CAMP2}') from pheno_affectations where user_id='{U['zh1']}' and actif", "true/0")
act("CMP-08", X, "zh1", "Validation dans la campagne 2 avec une affectation de la campagne 1 : refusée", f"select public.pheno_visite_valider('{VK}')", False, "affectation")
act("CMP-09", X, "bm", "Affectation de validation sur la campagne 2", f"select public.pheno_affectation_accorder({lit({**aff, 'campaign_id': CAMP2})})")
act("CMP-10", X, "zh1", "Validation dans la campagne 2 avec l'affectation de la campagne 2 : acceptée", f"select public.pheno_visite_valider('{VK}')", True, "VALIDE")
check("CMP-11", X, "Vues pilotes cloisonnées par campagne (aucune visite de la campagne 2 dans la campagne 1)", f"select count(*) from pheno_v_champ_semaine where campaign_id='{CAMP}' and panel_id='{pK['id']}'", "0")
q(f"select set_config('request.jwt.claim.sub', '{U['bm']}', false); update public.campaigns set status='CLOSED' where id='{CAMP2}';")
sync1("CMP-12", X, "auh_bro", "Campagne 2 fermée : nouvelle visite refusée", "VISITE_ENREGISTRER", {**visite(str(uuid.uuid4()), 0, [obs(a) for a in ARBK]), "panel_id": pK["id"]}, "REJETEE", "campagne")
act("CMP-13", X, "uh_bro", "Campagne fermée : parcelles installables toujours filtrées par cluster", "select count(*) = count(*) filter (where cluster_code='BROBO') from public.pheno_parcelles_disponibles('" + CAMP2 + "')", True, "t")

vu_par("SEC-58", X, "auh_bro", "Collègues de collecte : seulement ceux de son cluster, sans soi-même", "select string_agg(nom, ',' order by nom) from public.pheno_observateurs_du_cluster()", "AUH BROBO 2 FICTIF,UH BROBO FICTIF")
vu_par("SEC-59", X, "rt", "Collègues de collecte : rien pour un RT", "select count(*) from public.pheno_observateurs_du_cluster()", "0")
vu_par("SEC-60", X, "zh1", "Collègues de collecte : rien hors rôles de collecte", "select count(*) from public.pheno_observateurs_du_cluster()", "0")

# Attaques logiques sur la synchronisation (demandées par la contre-expertise, tour 3)
nE = lambda: q(f"select count(*) from pheno_panels where plot_id='{PLOTS['E']}'")
n0 = nE()
sync1("SYN-21", S, "auh_bro", "Clé d'opération légitime réutilisée avec un champ d'un autre cluster : refusée", "PANEL_INSTALLER", panel("E", 3, 1), "REJETEE", cle=CLE1)
sync1("SYN-22", S, "auh_bro", "Nouvelle clé, installation sur un champ d'un autre cluster : refusée", "PANEL_INSTALLER", panel("E", 3, 1), "REJETEE")
check("SYN-23", S, "Aucun champ installé hors cluster après les deux tentatives", f"select count(*) from pheno_panels where plot_id='{PLOTS['E']}'", n0)
nv = q(f"select count(*) from pheno_visites where panel_id='{pC['id']}'")
psql(f"update public.profils set actif=false where user_id='{U['auh_bro2']}'")
sync1("SYN-24", S, "auh_bro2", "Saisie hors ligne envoyée après désactivation du compte : refusée (accès coupé, opération conservée sur le téléphone)", "VISITE_ENREGISTRER", {**visite(str(uuid.uuid4()), 4, [obs(a) for a in ARBC]), "panel_id": pC["id"]}, "ERREUR", "accès à l'observatoire refusé")
psql(f"update public.profils set actif=true, cluster='BOTRO' where user_id='{U['auh_bro2']}'")
sync1("SYN-25", S, "auh_bro2", "Saisie hors ligne envoyée après mutation de l'agent dans un autre cluster : refusée", "VISITE_ENREGISTRER", {**visite(str(uuid.uuid4()), 4, [obs(a) for a in ARBC]), "panel_id": pC["id"]}, "REJETEE")
psql(f"update public.profils set cluster='BROBO' where user_id='{U['auh_bro2']}'")
check("SYN-26", S, "Aucune visite écrite par ces envois tardifs", f"select count(*) from pheno_visites where panel_id='{pC['id']}'", nv)

# ---------------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
tot = len(RESULTS); ok_n = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI")
par = {}
for r in RESULTS:
    d = par.setdefault(r["famille"], [0, 0]); d[0] += 1; d[1] += r["resultat"] == "RÉUSSI"
json.dump({"date": str(datetime.datetime.now()), "base": DB, "hote": HOST, "total": tot, "reussis": ok_n, "echoues": tot - ok_n,
           "par_famille": {k: {"total": v[0], "reussis": v[1], "echoues": v[0] - v[1]} for k, v in par.items()}, "tests": RESULTS},
          open(os.path.join(OUT_DIR, "serveur" + os.environ.get("OBS_SUFFIXE", "") + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("| Famille | Tests | Réussis | Échoués |\n|---|---|---|---|")
for k, v in par.items(): print(f"| {k} | {v[0]} | {v[1]} | {v[0] - v[1]} |")
print(f"| TOTAL | {tot} | {ok_n} | {tot - ok_n} |")
sys.exit(0 if ok_n == tot else 1)

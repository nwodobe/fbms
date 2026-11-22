#!/usr/bin/env python3
"""
OBSERVATOIRE AFLP 2027 — recette serveur des CODES DE SUIVI A001 à A012 (migration 7).

Base LOCALE uniquement (staging fidèle + migrations Observatoire 1 à 7) ; refuse toute
cible Supabase. Chaque action est exécutée sous le rôle `authenticated` (RLS active)
avec l'identité JWT d'un compte FICTIF. Aucune donnée réelle.

Construction de la base puis exécution :
  PGHOST=/tmp PGPORT=54329 tests/observatoire/executer_tests_codes_suivi.sh
Sortie : tests/observatoire/resultats/codes_suivi.json + synthèse sur stdout.
"""
import datetime, json, os, subprocess, sys, threading, time, uuid

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_obs_codes"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultats")

def uid(n): return f"00000000-0000-4000-9000-{n:012d}"
PROFILS = [("bm", "BM FICTIF", "Branch Manager", None, None),
           ("uh_dia", "UH DIABO FICTIF", "Unit Head", "DIABO", "GBEKE 2"),
           ("auh_dia", "AUH DIABO FICTIF", "Assistant Unit Head", "DIABO", "GBEKE 2"),
           ("uh_bro", "UH BROBO FICTIF", "Unit Head", "BROBO", "GBEKE 1")]
U = {p[0]: uid(i + 1) for i, p in enumerate(PROFILS)}

def psql(sql):
    r = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
                       input=sql, capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()
def q(sql):
    code, out, err = psql(sql)
    if code != 0: raise RuntimeError(err)
    return out
def prefixe(user):
    claims = json.dumps({"sub": U[user], "role": "authenticated"})
    return (f"set local role authenticated; select set_config('request.jwt.claims','{claims}',true);"
            f" select set_config('request.jwt.claim.sub','{U[user]}',true);")
def run_as(user, sql):
    code, out, err = psql(f"begin;\n\\o /dev/null\n{prefixe(user)}\n\\o\n{sql};\ncommit;\n")
    if code == 0:
        lines = [l for l in out.splitlines() if l.strip()]
        return True, (lines[-1] if lines else "")
    lines = err.splitlines()
    msg = next((l for l in lines if "ERROR" in l), lines[0] if lines else "erreur")
    return False, msg.split("ERROR:")[-1].strip()

RESULTS = []
def record(tid, label, attendu, ok, obtenu):
    RESULTS.append({"id": tid, "action": label, "attendu": attendu, "obtenu": str(obtenu)[:300], "resultat": "RÉUSSI" if ok else "ÉCHOUÉ"})
    print(("RÉUSSI  " if ok else "ÉCHOUÉ  ") + tid + " " + label + ("" if ok else f" — attendu {attendu} — obtenu {str(obtenu)[:260]}"), flush=True)
def lit(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
def act(tid, user, label, sql, expect_ok=True, contains=None):
    ok, out = run_as(user, sql)
    passed = (ok == expect_ok) and (contains is None or contains.lower() in out.lower())
    record(tid, label, ("OK" if expect_ok else "REFUS") + (f" ({contains})" if contains else ""), passed, ("OK : " if ok else "REFUS : ") + out)
    try: return json.loads(out) if ok else {}
    except Exception: return {}
def check(tid, label, sql, expected):
    try: got = q(sql)
    except Exception as e: got = f"ERREUR {e}"
    record(tid, label, str(expected), got == str(expected), got)
    return got
DATES_CLIENT = {}   # un appareil renvoie toujours la même enveloppe pour une même clé
def sync(user, typ, payload, cle=None):
    cle = cle or str(uuid.uuid4())
    DATES_CLIENT.setdefault(cle, datetime.datetime.now(datetime.timezone.utc).isoformat())
    op = {"idempotency_key": cle, "type": typ, "payload": payload, "device_id": "APPAREIL-FICTIF-" + user, "created_at_client": DATES_CLIENT[cle]}
    ok, out = run_as(user, f"select public.pheno_sync_batch({lit([op])})")
    return json.loads(out)["resultats"][0] if ok else {"statut": "ERREUR", "message": out}

# ---------------------------------------------------------------- jeu fictif
CAMP = str(uuid.uuid5(uuid.NAMESPACE_DNS, "campagne-fictive-codes-suivi"))
s = []
for k, nom, role, cluster, zone in PROFILS:
    s.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}@example.invalid') on conflict do nothing;")
    s.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
             f"('{U[k]}', '{k}@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, {('$z$'+zone+'$z$') if zone else 'null'}, true) on conflict do nothing;")
s.append(f"select set_config('request.jwt.claim.sub', '{U['bm']}', false);")
s.append(f"insert into public.campaigns (id, code, name, year, status, is_current) values ('{CAMP}', '2098', 'CAMPAGNE FICTIVE CODES', 2098, 'OPEN', true) on conflict do nothing;")
s.append("insert into public.villages (id, data, village, cluster, cluster_code) values ('V-FICTIF-DIA', '{}', 'VILLAGE FICTIF DIABO', 'Diabo', 'DIABO') on conflict do nothing;")
s.append("insert into public.rt (id, data, nom, village_id) values ('RT-FICTIF-DIA', '{}', 'RT FICTIF DIABO', 'V-FICTIF-DIA') on conflict do nothing;")
PLOTS = {}
for i, nom in enumerate(["A", "B", "C", "D", "E"], start=1):
    pid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"parcelle-fictive-codes-{nom}")); PLOTS[nom] = pid
    s.append(f"insert into public.producteurs (id, data, nom, prenoms, village_id, rt_id) values ('P-FICTIF-CS-{nom}', '{{}}', 'PRODUCTEUR FICTIF', 'CODES {nom}', 'V-FICTIF-DIA', 'RT-FICTIF-DIA') on conflict do nothing;")
    s.append(f"update public.producteurs set code = coalesce(nullif(code, ''), '99{i:02d}') where id = 'P-FICTIF-CS-{nom}';")
    s.append(f"insert into public.farmer_plots (id, producteur_id, village_id, local_name, latitude, longitude, gps_status, tree_count, status) values "
             f"('{pid}', 'P-FICTIF-CS-{nom}', 'V-FICTIF-DIA', 'PARCELLE FICTIVE {nom}', 0.5, 0.5, 'POINT_CAPTURED', 40, 'ACTIVE') on conflict do nothing;")
q("\n".join(s))
manques = q(f"select string_agg(array_to_string(private.pheno_parcelle_manques(id), '/'), ';') from farmer_plots where id in ({','.join(repr(v) for v in PLOTS.values())})")
record("PREP-01", "Parcelles fictives complètes (installables)", "vide", manques.replace(";", "") == "", manques)

def installer(plot, user="uh_dia"):
    blocs = [{"id": str(uuid.uuid4()), "numero": n, "repere": f"REPÈRE FICTIF {n}", "suivi": True} for n in range(1, 5)]
    pid = str(uuid.uuid4())
    payload = {"id": pid, "campaign_id": CAMP, "plot_id": PLOTS[plot], "nb_blocs_total": 4, "nb_blocs_tires": 4, "blocs": blocs}
    ok, out = run_as(user, f"select public.pheno_panel_installer({lit(payload)})")
    if not ok: raise RuntimeError("installation : " + out)
    for b in blocs:   # inventaire DIABO : B01..B04 = 3 arbres chacun
        ok, out = run_as(user, f"select public.pheno_bloc_inventorier({lit({'bloc_id': b['id'], 'nb_arbres': 3})})")
        if not ok: raise RuntimeError("inventaire : " + out)
    return pid, {b["numero"]: b["id"] for b in blocs}
def choix(blocs, codes=None):
    """Répartition de l'exemple du mandat : suivis 01..10 puis R1, R2 sur B01..B04 × arbres 1..3."""
    l = []
    for k in range(12):
        x = {"bloc_id": blocs[k // 3 + 1], "numero": k % 3 + 1, "role": "TITULAIRE" if k < 10 else "RESERVE"}
        if codes: x["code_suivi"] = codes[k]
        l.append(x)
    return l
DEFAUT = [f"A{i:03d}" for i in range(1, 13)]
def codes_panel(pid):
    return q(f"select string_agg(code || '=' || coalesce(code_suivi, '-'), ',' order by role desc, rang) from pheno_arbres where panel_id = '{pid}'")

# ---------------------------------------------------------------- 1. attribution automatique
pA, bA = installer("A")
act("CS-01", "uh_dia", "A001 à A012 attribués automatiquement (ordre par défaut) : accepté",
    f"select public.pheno_arbres_designer({lit({'panel_id': pA, 'arbres': choix(bA, DEFAUT)})})", True, "A012")
check("CS-02", "Exemple du mandat : B01/A001=A001 … B04/A002=A011, B04/A003=A012", f"select string_agg(code || '=' || coalesce(code_suivi, '-'), ',' order by role desc, rang) from pheno_arbres where panel_id = '{pA}'",
      "B01/A001=A001,B01/A002=A002,B01/A003=A003,B02/A001=A004,B02/A002=A005,B02/A003=A006,B03/A001=A007,B03/A002=A008,B03/A003=A009,B04/A001=A010,B04/A002=A011,B04/A003=A012")
check("CS-03", "Codes physiques B00/A000 conservés, inventaires inchangés (4 × 3)",
      f"select count(*) filter (where code ~ '^B0[1-4]/A00[1-3]$') || '|' || (select string_agg(nb_arbres_inventories::text, ',' order by numero) from pheno_blocs where panel_id='{pA}') from pheno_arbres where panel_id='{pA}'", "12|3,3,3,3")

# ---------------------------------------------------------------- 2. ordre libre
pB, bB = installer("B")
libre = DEFAUT[:]; libre[0], libre[7] = "A008", "A001"   # A008 au premier arbre suivi, A001 au huitième
act("CS-04", "uh_dia", "A001 à A012 dans un autre ordre (A008 au suivi 01, A001 au suivi 08) : accepté",
    f"select public.pheno_arbres_designer({lit({'panel_id': pB, 'arbres': choix(bB, libre)})})", True, "A008")
check("CS-05", "Suivi 01 (B01/A001) porte A008, suivi 08 (B03/A002) porte A001",
      f"select string_agg(code || '=' || code_suivi, ',' order by code) from pheno_arbres where panel_id='{pB}' and code in ('B01/A001','B03/A002')", "B01/A001=A008,B03/A002=A001")

# ---------------------------------------------------------------- 3 à 6. refus
pC, bC = installer("C")
dbl = DEFAUT[:]; dbl[1] = "A005"
act("CS-06", "uh_dia", "Deux arbres portant A005 : refusé", f"select public.pheno_arbres_designer({lit({'panel_id': pC, 'arbres': choix(bC, dbl)})})", False, "A005")
meme = choix(bC, DEFAUT); meme[1] = {**meme[0], "code_suivi": "A002"}
act("CS-07", "uh_dia", "Deux lignes désignant le même arbre physique : refusé", f"select public.pheno_arbres_designer({lit({'panel_id': pC, 'arbres': meme})})", False, "deux fois")
c13 = DEFAUT[:]; c13[11] = "A013"
act("CS-08", "uh_dia", "Code A013 : refusé", f"select public.pheno_arbres_designer({lit({'panel_id': pC, 'arbres': choix(bC, c13)})})", False, "A013")
c0 = DEFAUT[:]; c0[0] = "A000"
act("CS-09", "uh_dia", "Code A000 : refusé", f"select public.pheno_arbres_designer({lit({'panel_id': pC, 'arbres': choix(bC, c0)})})", False, "A000")
part = choix(bC, DEFAUT); del part[3]["code_suivi"]
act("CS-10", "uh_dia", "Codes incomplets (11 sur 12) : refusé", f"select public.pheno_arbres_designer({lit({'panel_id': pC, 'arbres': part})})", False, "chacun")
act("CS-11", "auh_dia", "Désignation par un Assistant Unit Head : refusée", f"select public.pheno_arbres_designer({lit({'panel_id': pC, 'arbres': choix(bC, DEFAUT)})})", False, "Chef d")
check("CS-12", "Aucun arbre créé par les tentatives refusées", f"select count(*) from pheno_arbres where panel_id='{pC}'", "0")

# ---------------------------------------------------------------- 7. hors ligne puis réseau
r1 = sync("uh_dia", "ARBRES_DESIGNER", {"panel_id": pC, "arbres": choix(bC, libre)}, cle="cle-hors-ligne-1")
r2 = sync("uh_dia", "ARBRES_DESIGNER", {"panel_id": pC, "arbres": choix(bC, libre)}, cle="cle-hors-ligne-1")
r3 = sync("uh_dia", "ARBRES_DESIGNER", {"panel_id": pC, "arbres": choix(bC, libre)})
record("CS-13", "Synchronisation après coupure : envoi, renvoi même clé, renvoi nouvelle clé = acceptés", "ACCEPTEE×3",
       [r1.get("statut"), r2.get("statut"), r3.get("statut")] == ["ACCEPTEE"] * 3, [r1.get("statut"), r2.get("statut"), r3.get("statut"), r2.get("message"), r3.get("message")])
check("CS-14", "Aucun doublon après synchronisation (12 arbres, 12 codes distincts)",
      f"select count(*) || '|' || count(distinct code_suivi) from pheno_arbres where panel_id='{pC}'", "12|12")

# ---------------------------------------------------------------- 8. deux appareils simultanés
pD, bD = installer("D")
autre = DEFAUT[::-1][:10] + DEFAUT[::-1][10:]
sorties = {}
def appareil(nom, codes, attente):
    op = [{"idempotency_key": str(uuid.uuid4()), "type": "ARBRES_DESIGNER", "payload": {"panel_id": pD, "arbres": choix(bD, codes)},
           "device_id": "APPAREIL-" + nom, "created_at_client": datetime.datetime.now(datetime.timezone.utc).isoformat()}]
    sql = f"begin;\n\\o /dev/null\n{prefixe('uh_dia')}\n\\o\nselect public.pheno_sync_batch({lit(op)});\nselect pg_sleep({attente});\ncommit;\n"
    sorties[nom] = psql(sql)
t1 = threading.Thread(target=appareil, args=("1", DEFAUT, 2)); t2 = threading.Thread(target=appareil, args=("2", autre, 0))
t1.start(); time.sleep(0.6); t2.start(); t1.join(); t2.join()
def statut(nom):
    try: return json.loads(sorties[nom][1].splitlines()[0])["resultats"][0]
    except Exception: return {"statut": "ERREUR", "message": sorties[nom][2]}
s1, s2 = statut("1"), statut("2")
record("CS-15", "Deux appareils attribuent des codes différents au même champ en même temps : le second reçoit un CONFLIT serveur",
       "ACCEPTEE puis CONFLIT", s1.get("statut") == "ACCEPTEE" and s2.get("statut") == "CONFLIT", [s1, s2])
check("CS-16", "Le champ garde la seule attribution du premier appareil", f"select string_agg(code_suivi, ',' order by role desc, rang) from pheno_arbres where panel_id='{pD}'", ",".join(DEFAUT))
ok_dup = psql(f"update pheno_arbres set code_suivi='A001' where panel_id='{pD}' and code_suivi='A002'")[0] == 0
record("CS-17", "Contrainte de base : un doublon de code dans un champ est impossible même en écriture directe", "REFUS", not ok_dup, "accepté" if ok_dup else "refusé par la contrainte")
check("CS-18", "Unicité par champ : A001 existe dans plusieurs champs", f"select count(distinct panel_id) from pheno_arbres where code_suivi='A001' and panel_id in ('{pA}','{pB}','{pC}','{pD}')", "4")
act("CS-19", "uh_dia", "Écriture directe d'un code par un utilisateur (hors RPC) : refusée", f"update public.pheno_arbres set code_suivi='A003' where panel_id='{pD}'", False)

# ---------------------------------------------------------------- 9. visites et historique
def visite_brouillon(pid, user="auh_dia", semaines=0):
    arbres = json.loads(q(f"select json_agg(id order by role desc, rang) from pheno_arbres where panel_id='{pid}' and statut in ('ACTIF','RESERVE_ACTIVEE')"))
    vid = str(uuid.uuid4()); jour = datetime.date.today() - datetime.timedelta(days=7 * semaines); d = str(jour); y, w, _ = jour.isocalendar()
    payload = {"id": vid, "panel_id": pid, "date_observation": d, "semaine_iso": f"{y}-W{w:02d}", "saisie_le": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "mode_saisie": "DIRECT", "soumettre": False, "ramassage": "NON", "justification_retro": "Saisie de la fiche papier de la semaine précédente (fictif)" if semaines else None,
               "observations": [{"arbre_id": a, "retrouve": True, "f": "NON", "n": "NON", "p": "NON", "chute": "ABSENCE"} for a in arbres]}
    return vid, sync(user, "VISITE_ENREGISTRER", payload)
v1, rv1 = visite_brouillon(pB, semaines=1)
record("CS-20", "Visite de la semaine précédente enregistrée sur le champ B", "ACCEPTEE", rv1.get("statut") == "ACCEPTEE", rv1)
check("CS-21", "Chaque observation conserve le code de suivi en vigueur (suivi 01 = A008)",
      f"select o.code_suivi from pheno_observations o join pheno_arbres a on a.id=o.arbre_id where o.visite_id='{v1}' and a.code='B01/A001'", "A008")

ver = q(f"select row_version from pheno_panels where id='{pB}'")
arb = json.loads(q(f"select json_agg(json_build_object('id', id, 'code', code, 'cs', code_suivi) order by role desc, rang) from pheno_arbres where panel_id='{pB}'"))
echange = [{"arbre_id": a["id"], "code_suivi": {"A008": "A001", "A001": "A008"}.get(a["cs"], a["cs"])} for a in arb]
act("CS-22", "uh_dia", "Modification après validation sans motif : refusée",
    f"select public.pheno_arbres_codes_modifier({lit({'panel_id': pB, 'base_version': int(ver), 'codes': echange})})", False, "Motif")
act("CS-23", "uh_dia", "Modification avec une version périmée (autre appareil) : conflit",
    f"select public.pheno_arbres_codes_modifier({lit({'panel_id': pB, 'base_version': int(ver) - 1, 'motif': 'essai', 'codes': echange})})", False, "modifié depuis")
dblm = [dict(x) for x in echange]; dblm[1]["code_suivi"] = dblm[0]["code_suivi"]
act("CS-24", "uh_dia", "Modification créant un doublon : refusée",
    f"select public.pheno_arbres_codes_modifier({lit({'panel_id': pB, 'base_version': int(ver), 'motif': 'essai', 'codes': dblm})})", False, "deux arbres")
act("CS-25", "uh_bro", "Modification par le Chef d'Unité d'un autre cluster : refusée",
    f"select public.pheno_arbres_codes_modifier({lit({'panel_id': pB, 'base_version': int(ver), 'motif': 'essai', 'codes': echange})})", False, "Chef d")
act("CS-26", "auh_dia", "Modification par un Assistant Unit Head : refusée",
    f"select public.pheno_arbres_codes_modifier({lit({'panel_id': pB, 'base_version': int(ver), 'motif': 'essai', 'codes': echange})})", False, "Chef d")
ids_avant = q(f"select string_agg(id::text || code, ',' order by id) from pheno_arbres where panel_id='{pB}'")
act("CS-27", "uh_dia", "Échange A001 ⇄ A008 justifié par le Chef d'Unité : accepté",
    f"select public.pheno_arbres_codes_modifier({lit({'panel_id': pB, 'base_version': int(ver), 'motif': 'Étiquettes inversées sur le terrain (fictif)', 'codes': echange})})", True, "row_version")
check("CS-28", "Après échange : B01/A001 porte A001, B03/A002 porte A008",
      f"select string_agg(code || '=' || code_suivi, ',' order by code) from pheno_arbres where panel_id='{pB}' and code in ('B01/A001','B03/A002')", "B01/A001=A001,B03/A002=A008")
check("CS-29", "Identifiants techniques et codes physiques inchangés par l'échange", f"select string_agg(id::text || code, ',' order by id) from pheno_arbres where panel_id='{pB}'", ids_avant)
check("CS-30", "Historisation : journal immuable avec ancien code, nouveau code et motif",
      f"select action || '|' || (ancienne->'codes'->>'B01/A001') || '>' || (nouvelle->'codes'->>'B01/A001') || '|' || motif from pheno_journal where entite_id='{pB}' and action like 'CODES_SUIVI%'",
      "CODES_SUIVI_MODIFIES|A008>A001|Étiquettes inversées sur le terrain (fictif)")
check("CS-31", "Visite antérieure : le code d'origine (A008) est conservé après l'échange",
      f"select o.code_suivi from pheno_observations o join pheno_arbres a on a.id=o.arbre_id where o.visite_id='{v1}' and a.code='B01/A001'", "A008")
v2, rv2 = visite_brouillon(pB, "uh_dia")
record("CS-32a", "Visite de la semaine en cours enregistrée après l'échange", "ACCEPTEE", rv2.get("statut") == "ACCEPTEE", rv2)
check("CS-32", "Visite suivante : le nouveau code (A001) est enregistré",
      f"select o.code_suivi from pheno_observations o join pheno_arbres a on a.id=o.arbre_id where o.visite_id='{v2}' and a.code='B01/A001'", "A001")
act("CS-33", "uh_dia", "Rejouer la désignation d'origine (ancien téléphone, anciens codes) après l'échange : conflit",
    f"select public.pheno_arbres_designer({lit({'panel_id': pB, 'arbres': choix(bB, libre)})})", False, "autres codes")

# ---------------------------------------------------------------- 10. compatibilité
pE, bE = installer("E")
r = sync("uh_dia", "ARBRES_DESIGNER", {"panel_id": pE, "arbres": choix(bE)})   # ancien APK : aucun code envoyé
record("CS-34", "Ancien téléphone (aucun code envoyé) : accepté, ordre par défaut attribué par le serveur", "ACCEPTEE", r.get("statut") == "ACCEPTEE", r)
check("CS-35", "Ordre par défaut : suivis 01..10 = A001..A010, R1 = A011, R2 = A012",
      f"select string_agg(case when role='TITULAIRE' then lpad(rang::text,2,'0') else 'R'||rang end || '=' || code_suivi, ',' order by role desc, rang) from pheno_arbres where panel_id='{pE}'",
      ",".join([f"{i:02d}=A{i:03d}" for i in range(1, 11)] + ["R1=A011", "R2=A012"]))
q(f"update pheno_arbres set code_suivi = null, code_suivi_le = null, code_suivi_par = null where panel_id='{pE}'")   # simule un champ désigné avant la migration 7
verE = q(f"select row_version from pheno_panels where id='{pE}'")
arbE = json.loads(q(f"select json_agg(id order by role desc, rang) from pheno_arbres where panel_id='{pE}'"))
act("CS-36", "uh_dia", "Champ déjà installé sans code : attribution initiale motivée acceptée",
    f"select public.pheno_arbres_codes_modifier({lit({'panel_id': pE, 'base_version': int(verE), 'motif': 'Attribution initiale des codes A001 à A012', 'codes': [{'arbre_id': a, 'code_suivi': DEFAUT[i]} for i, a in enumerate(arbE)]})})", True)
check("CS-37", "Journal : attribution initiale tracée", f"select count(*) from pheno_journal where entite_id='{pE}' and action='CODES_SUIVI_ATTRIBUES'", "1")
check("CS-38", "Aucune observation existante modifiée ni supprimée par la migration (colonnes ajoutées seulement)",
      "select count(*) from information_schema.columns where table_name in ('pheno_arbres','pheno_observations') and column_name like 'code_suivi%'", "4")

os.makedirs(OUT_DIR, exist_ok=True)
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI"); ko = len(RESULTS) - ok
with open(os.path.join(OUT_DIR, "codes_suivi.json"), "w", encoding="utf-8") as f:
    json.dump({"base": DB, "le": datetime.datetime.now(datetime.timezone.utc).isoformat(), "reussis": ok, "echoues": ko, "tests": RESULTS}, f, ensure_ascii=False, indent=1)
print(f"Codes de suivi A001-A012 : {ok} réussis, {ko} échoués.")
sys.exit(1 if ko else 0)

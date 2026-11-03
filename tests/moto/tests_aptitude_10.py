#!/usr/bin/env python3
"""
AFLP FLEET — recette de la migration 10 (aptitude technique et mise en service).

Déroulé, sur une réplique LOCALE portant les migrations 1 à 9 (état de la production) :
  phase A : création d'un « parc existant » FICTIF avec les règles actuelles
            (dont une inspection APTE malgré un éclairage en défaut, comme le
            permettait la conclusion manuelle) ;
  phase B : application de la migration 10 (deux fois : rejouable) et preuve
            qu'aucun statut ni aucun contrôle existant n'a changé ;
  phase C : les 10 tests d'acceptation T01 à T10 sous le rôle `authenticated`
            (RLS active), avec des comptes et des motos FICTIFS.

Refuse toute cible Supabase. Aucune donnée réelle.
Usage : PGHOST=… PGPORT=… python3 tests/moto/tests_aptitude_10.py fbms_moto_apt_t
Sortie : tests/moto/resultats/aptitude_10.json + tableau Markdown sur stdout.
"""
import json, os, subprocess, sys, uuid, datetime

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_apt_t"
ICI = os.path.dirname(os.path.abspath(__file__)); RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
OUT_DIR = os.path.join(ICI, "resultats")
MIGRATION = os.path.join(RACINE, "supabase", "20261106090000_aflp_fleet_10_aptitude_mise_en_service.sql")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
U = {"bm": uid(1001), "abm": uid(1002), "lc": uid(1003), "zh": uid(1004), "uh_a": uid(1005), "uh_b": uid(1006), "uh_c": uid(1007)}
PROFILS = [  # (clé, nom, rôle, cluster, zone, fonction opérationnelle)
    ("bm", "BM10 FICTIF", "Branch Manager", None, None, None),
    ("abm", "ABM10 FICTIF", "Assistant Branch Manager", None, None, None),
    ("lc", "COORDINATEUR10 FICTIF", "Supervisor", None, None, "Logistics Coordinator"),
    ("zh", "ZH10 FICTIF", "Zonal Head", None, "GBEKE 1", None),
    ("uh_a", "UH10 A FICTIF", "Unit Head", "SAKASSOU", "GBEKE 1", None),
    ("uh_b", "UH10 B FICTIF", "Unit Head", "BROBO", "GBEKE 1", None),
    ("uh_c", "UH10 C FICTIF", "Unit Head", "BOTRO", "GBEKE 2", None),
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
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}.m10@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
                 f"('{U[k]}', '{k}.m10@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, true) on conflict do nothing;")
    if fonction: setup.append(f"update public.profils set fonction_operationnelle = '{fonction}' where user_id = '{U[k]}';")
q("\n".join(setup))

def creer(cluster, origine="NEUVE"):
    p = {"marque": "APSONIC", "modele": "AP150-30 FICTIF", "cluster_code": cluster, "motif": "Moto de recette fictive"}
    p.update({"date_reception": str(today), "compteur_km": 3} if origine == "NEUVE" else {"origine": "EN_EXPLOITATION", "date_debut_utilisation": "2026-02-01"})
    return must("abm", "select public.moto_creer(" + lit(p) + ")")["id"]
def dossier_admin(moto, n):
    must("abm", f"select public.moto_modifier_identite('{moto}', '{{\"numero_chassis\":\"M10-FICTIF-CH-{n:03d}\",\"immatriculation\":\"M10 {n:04d} FICTIF\"}}'::jsonb, 'Saisie identité recette')")
    for typ in ("CARTE_GRISE", "PLAQUE", "ASSURANCE"):
        p = f"{moto}/document/{uuid.uuid4()}.pdf"; put_object(p)
        d = must("abm", "select public.moto_document_enregistrer(" + lit({"moto_id": moto, "type_document": typ, "storage_path": p,
                 **({"date_expiration": str(today + datetime.timedelta(days=300))} if typ == "ASSURANCE" else {})}) + ")")
        must("bm", f"select public.moto_document_verifier('{d['id']}', 'CONFORME')")
def permis_pour(benef):
    if q(f"select count(*) from public.moto_permis where titulaire_id='{U[benef]}' and statut='CONFORME'") != "0": return
    p = f"permis/{U[benef]}/{uuid.uuid4()}.pdf"; put_object(p)
    r = must("abm", "select public.moto_permis_enregistrer(" + lit({"titulaire_id": U[benef], "nom_titulaire": "TITULAIRE FICTIF " + benef.upper(),
             "numero_permis": "M10-" + U[benef][-6:], "categories": ["A"], "date_expiration": str(today + datetime.timedelta(days=700)), "document_path": p}) + ")")
    must("bm", f"select public.moto_permis_verifier('{r['id']}', 'CONFORME', 'RH FICTIF', true)")
def remise(moto, benef, km=12):
    """Préaffectation, PV vérifié, état contradictoire accepté, permis, remise. Renvoie l'identifiant du PV."""
    must("bm", f"select public.moto_preaffecter('{moto}', '{U[benef]}', 'Affectation recette')")
    p = f"{moto}/document/{uuid.uuid4()}.pdf"; put_object(p)
    pv = must("abm", "select public.moto_document_enregistrer(" + lit({"moto_id": moto, "type_document": "PV_REMISE", "storage_path": p}) + ")")["id"]
    must("bm", f"select public.moto_document_verifier('{pv}', 'CONFORME')")
    et = must("abm", "select public.moto_etat_remise_enregistrer(" + lit({"moto_id": moto, "items": items("ETAT_REMISE"), "compteur_km": km,
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

EMPREINTE = """select md5(string_agg(x, '|' order by x)) from (
  select id||':'||statut_technique||':'||statut_administratif||':'||statut_affectation||':'||coalesce(mise_en_service_at::text,'') x from public.moto_motos
  union all select id||':'||type_controle||':'||resultat||':'||md5(items::text)||':'||coalesce(garage_nom,'') from public.moto_controles
  union all select id||':'||statut||':'||gravite from public.moto_actions_correctives) t"""
RLS = "select md5(string_agg(schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,'')||permissive||array_to_string(roles,','), '|' order by schemaname, tablename, policyname)) from pg_policies"

# ===========================================================================
# Phase A : parc « existant » sous les règles actuelles (migration 10 absente)
# ===========================================================================
assert q("select to_regprocedure('public.moto_aptitude(uuid)') is null") == "t", "La base porte déjà la migration 10 : utiliser une base 1-9."
E1 = creer("SAKASSOU")      # APTE malgré éclairage en défaut (ancienne conclusion manuelle), puis en service
dossier_admin(E1, 1)
must("abm", insp("abm", E1, ko=("ECLAIRAGE",), extra={"resultat": "APTE", "garage_nom": "GARAGE FICTIF"}))
remise(E1, "uh_a"); must("bm", f"select public.moto_mettre_en_service('{E1}', 'Mise en service avant migration (recette)')")
E2 = creer("BROBO")         # inspection INAPTE (freins), immobilisée
must("abm", insp("abm", E2, ko=("FREIN_AVANT",), extra={"resultat": "APTE", "garage_nom": "GARAGE FICTIF"}))
E3 = creer("BOTRO")         # jamais contrôlée
avant = q(EMPREINTE); rls_avant = q(RLS)
etats_avant = q("select string_agg(code||'='||statut_technique, ',' order by code) from public.moto_motos")

# ===========================================================================
# Phase B : migration 10 appliquée deux fois
# ===========================================================================
for passe in (1, 2):
    r = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", MIGRATION], capture_output=True, text=True)
    record(f"MIG-0{passe}", "Migration rejouable", "postgres", f"Application de la migration 10 (passe {passe})", "OK", r.returncode == 0,
           "OK" if r.returncode == 0 else r.stderr[-300:])

# ===========================================================================
# Phase C : tests d'acceptation
# ===========================================================================
EX = "Aucun changement rétroactif"
check("T09a", EX, "Statuts, contrôles et actions existants identiques après migration", EMPREINTE, avant)
check("T09b", EX, "Politiques RLS strictement identiques (aucun droit réel modifié)", RLS, rls_avant)
q(f"select private.moto_recalculer_statuts(id) from public.moto_motos where id in ('{E1}','{E2}','{E3}')")
check("T09c", EX, "Recalcul forcé des motos existantes : aucun statut technique ne change",
      "select string_agg(code||'='||statut_technique, ',' order by code) from public.moto_motos", etats_avant)
check("T09d", EX, "Contrôle historique conservé tel quel (APTE avec éclairage en défaut, garage renseigné)",
      f"select resultat||'/'||garage_nom from public.moto_controles where moto_id='{E1}' and type_controle='INSPECTION_INITIALE'", "APTE/GARAGE FICTIF")
check("T09e", "Défaut de sécurité ouvert = circulation suspendue (vue), sans écriture sur la moto",
      "Moto en service avec éclairage non corrigé : autorisée_a_circuler=false, défaut compté, mise_en_service_at conservée",
      f"select autorisee_a_circuler||'/'||defauts_bloquants_ouverts||'/'||(mise_en_service_at is not null) from public.moto_v_flotte where id='{E1}'", "false/1/true")

# T01 — Résultat jamais pré-rempli ni imposé par le client ----------------------------------
EX = "T01 Résultat calculé, jamais pré-rempli favorable"
M1 = creer("SAKASSOU")
act("T01a", EX, "abm", "Points non renseignés : refus (aucune valeur par défaut « conforme »)",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M1, "items": [i for i in items("INSPECTION_INITIALE") if i["code"] != "KLAXON"], **MECA}) + ")", False, "non renseignés")
act("T01b", EX, "abm", "Client envoie « APTE » avec klaxon en défaut : le serveur calcule INAPTE",
    insp("abm", M1, ko=("KLAXON",), extra={"resultat": "APTE"}), True, "\"resultat\": \"INAPTE\"")
check("T01c", EX, "Statut technique non apte", f"select statut_technique from public.moto_motos where id='{M1}'", "A_CONTROLER")

# T02 — Défaut critique : inapte et immobilisée (non-régression) ----------------------------
EX = "T02 Point critique = immobilisation"
M2 = creer("SAKASSOU")
act("T02a", EX, "abm", "Freins arrière en défaut", insp("abm", M2, ko=("FREIN_ARRIERE",)), True, "INAPTE_IMMOBILISEE")
check("T02b", EX, "Moto immobilisée, contrôle INAPTE critique",
      f"select statut_technique||'/'||(select resultat||':'||anomalie_critique from public.moto_controles where moto_id='{M2}') from public.moto_motos where id='{M2}'", "IMMOBILISEE/INAPTE:true")

# T03 — Défaut bloquant non critique : bloque la circulation --------------------------------
EX = "T03 Défaut de sécurité non critique bloque la circulation"
M3 = creer("BROBO"); dossier_admin(M3, 3)
act("T03a", EX, "abm", "Éclairage en défaut : INAPTE, défaut bloquant listé", insp("abm", M3, ko=("ECLAIRAGE",)), True, "\"defauts_bloquants\": [\"")
apt = act("T03b", EX, "uh_b", "Liste courte des exigences (Chef d'unité du cluster)", f"select public.moto_aptitude('{M3}')", True, "CONTRE_VISITE")
check("T03c", EX, "Action corrective ouverte comptée comme bloquante dans la vue", f"select defauts_bloquants_ouverts from public.moto_v_flotte where id='{M3}'", "1")

# T04 — Apte avec réserves, uniquement si justifié -------------------------------------------
EX = "T04 Apte avec réserves justifiées"
M4 = creer("BROBO")
act("T04a", EX, "abm", "Batterie faible sans justification : refus", insp("abm", M4, ko=("BATTERIE",)), False, "Réserve non justifiée")
act("T04b", EX, "abm", "Batterie faible justifiée : APTE avec réserves",
    insp("abm", M4, ko=("BATTERIE",), obs={"BATTERIE": "Démarrage lent, à remplacer sous 30 jours (fictif)"}), True, "APTE_RESERVES")
act("T04c", EX, "abm", "Lecture : aptitude APTE_RESERVES et réserve affichée", f"select public.moto_aptitude('{M4}')", True, "\"aptitude\": \"APTE_RESERVES\"")
check("T04d", EX, "Statut technique APTE (aucun statut nouveau)", f"select statut_technique from public.moto_motos where id='{M4}'", "APTE")

# T05 — Avis défavorable du mécanicien ---------------------------------------------------------
EX = "T05 Avis défavorable du mécanicien"
M5 = creer("BOTRO")
act("T05a", EX, "abm", "Avis défavorable sans texte : refus", insp("abm", M5, extra={"avis_defavorable": True}), False, "précisez")
act("T05b", EX, "abm", "Avis défavorable motivé : INAPTE malgré tous points conformes",
    insp("abm", M5, extra={"avis_defavorable": True, "avis_mecanicien": "Jeu anormal à l'arrière, contrôle complémentaire (fictif)"}), True, "\"resultat\": \"INAPTE\"")
act("T05c", EX, "abm", "Ancien écran en cache (conclusion INAPTE) toujours respecté", insp("abm", M5, extra={"resultat": "INAPTE"}), True, "\"resultat\": \"INAPTE\"")

# T06 — Aucun contournement : mécanicien nommé obligatoire, pas de « forcer apte » ------------
EX = "T06 Pas d'aptitude sans contrôle physique attesté"
M6 = creer("BOTRO")
act("T06a", EX, "abm", "Évaluation sans mécanicien nommé : refus",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M6, "items": items("INSPECTION_INITIALE"), "compteur_km": 5}) + ")", False, "mécanicien")
act("T06b", EX, "bm", "Écriture directe du statut technique : refus", f"update public.moto_motos set statut_technique='APTE' where id='{M6}'", False, "permission")
act("T06c", EX, "bm", "Lecture d'aptitude sans effet de bord", f"select public.moto_aptitude('{M6}')", True, "\"aptitude\": \"A_CONTROLER\"")
check("T06d", EX, "Toujours à contrôler, aucun contrôle créé", f"select statut_technique||'/'||(select count(*) from public.moto_controles where moto_id='{M6}') from public.moto_motos where id='{M6}'", "A_CONTROLER/0")
check("T06e", EX, "Aucune fonction « forcer » exposée", "select count(*) from pg_proc where proname ilike '%forcer%' or proname ilike '%force_apte%'", "0")
act("T06f", EX, "abm", "Garage facultatif, mécanicien suffisant : APTE", insp("abm", M6), True, "\"resultat\": \"APTE\"")
check("T06g", EX, "Garage enregistré vide, mécanicien conservé",
      f"select coalesce(garage_nom,'(vide)')||'/'||intervenant_nom from public.moto_controles where moto_id='{M6}'", "(vide)/MECANICIEN QUALIFIE FICTIF")

# T07 — Contre-visite après réparation, sans refaire l'inspection initiale ---------------------
EX = "T07 Contre-visite après réparation"
M7 = creer("SAKASSOU"); dossier_admin(M7, 7)
must("abm", insp("abm", M7, ko=("KLAXON",)))
remise_items = items("REMISE_EN_SERVICE")
must("bm", f"select public.moto_preaffecter('{M7}', '{U['uh_a']}', 'Affectation recette')")
cloturer_actions(M7, ["KLAXON"])
act("T07a", EX, "lc", "Contre-visite APTE par un tiers : moto apte sans nouvelle inspection initiale",
    "select public.moto_controle_remise_en_service(" + lit({"moto_id": M7, "items": remise_items, "compteur_km": 11, **MECA, "motif": "Contre-visite après réparation klaxon"}) + ")", True, "APTE")
check("T07b", EX, "Statut technique APTE ; une seule inspection initiale", f"select statut_technique||'/'||(select count(*) from public.moto_controles where moto_id='{M7}' and type_controle='INSPECTION_INITIALE') from public.moto_motos where id='{M7}'", "APTE/1")
act("T07c", EX, "lc", "Contre-visite INAPTE ultérieure : la moto n'est plus apte",
    "select public.moto_controle_remise_en_service(" + lit({"moto_id": M7, "items": items("REMISE_EN_SERVICE", ko=("RETROVISEURS",)), "compteur_km": 12, **MECA, "motif": "Contre-visite (rétroviseur cassé)"}) + ")", True, "INAPTE")
check("T07d", EX, "Statut technique repassé à contrôler", f"select statut_technique from public.moto_motos where id='{M7}'", "A_CONTROLER")
M7b = creer("BOTRO")
act("T07e", EX, "lc", "Contre-visite seule, sans inspection initiale : jamais apte",
    "select public.moto_controle_remise_en_service(" + lit({"moto_id": M7b, "items": remise_items, "compteur_km": 4, **MECA, "motif": "Tentative de raccourci"}) + ")", True, "APTE")
check("T07f", EX, "Reste à contrôler (l'inspection initiale reste exigée)", f"select statut_technique from public.moto_motos where id='{M7b}'", "A_CONTROLER")

M7c = creer("BROBO"); must("abm", insp("abm", M7c))
act("T07g", "T07 Contre-visite après réparation", "lc", "Contre-visite avec direction en défaut (critique)",
    "select public.moto_controle_remise_en_service(" + lit({"moto_id": M7c, "items": items("REMISE_EN_SERVICE", ko=("DIRECTION",)), "compteur_km": 6, **MECA, "motif": "Contre-visite direction"}) + ")", True, "\"anomalie_critique\": true")
check("T07h", "T07 Contre-visite après réparation", "Point critique à la contre-visite : moto immobilisée (auparavant : aucun effet)",
      f"select statut_technique from public.moto_motos where id='{M7c}'", "IMMOBILISEE")

# T08 — Circulation : refus tant que le défaut persiste, autorisation après correction vérifiée
EX = "T08 Mise en service et circulation"
M8 = creer("BROBO"); dossier_admin(M8, 8)
act("T08a", EX, "abm", "Inspection : klaxon en défaut (INAPTE)", insp("abm", M8, ko=("KLAXON",)), True, "INAPTE")
# Contre-visite APTE alors que l'action corrective n'a pas encore été vérifiée par une autre personne
must("lc", "select public.moto_controle_remise_en_service(" + lit({"moto_id": M8, "items": items("REMISE_EN_SERVICE"), "compteur_km": 11, **MECA, "motif": "Contre-visite recette"}) + ")")
remise(M8, "uh_b")
act("T08b", EX, "bm", "Autorisation de circulation refusée tant que le klaxon n'est pas corrigé ET vérifié",
    f"select public.moto_mettre_en_service('{M8}', 'Autorisation recette')", False, "sécurité de circulation")
cloturer_actions(M8, ["KLAXON"])
act("T08c", EX, "bm", "Après correction vérifiée : autorisation accordée", f"select public.moto_mettre_en_service('{M8}', 'Autorisation recette')", True, "true")
check("T08d", EX, "Vue flotte : autorisée à circuler", f"select autorisee_a_circuler::text from public.moto_v_flotte where id='{M8}'", "true")
act("T08e", EX, "uh_b", "Nouveau défaut (rétroviseurs) au départ", "select public.moto_controle_depart(" + lit({"moto_id": M8, "items": items("AVANT_DEPART", ko=("RETROVISEURS",)), "compteur_km": 15, "client_op_id": str(uuid.uuid4())}) + ")", True, "INAPTE")
check("T08f", EX, "Circulation suspendue tant que le défaut persiste", f"select autorisee_a_circuler||'/'||defauts_bloquants_ouverts from public.moto_v_flotte where id='{M8}'", "false/1")
cloturer_actions(M8, ["RETROVISEURS"])
check("T08g", EX, "Circulation rétablie après correction vérifiée par une autre personne", f"select autorisee_a_circuler::text from public.moto_v_flotte where id='{M8}'", "true")
act("T08h", EX, "uh_b", "Défaut non bloquant (gilet oublié) : circulation non suspendue par la vue",
    "select public.moto_controle_depart(" + lit({"moto_id": M8, "items": items("AVANT_DEPART", ko=("GILET",)), "compteur_km": 16, "client_op_id": str(uuid.uuid4())}) + ")", True, "")
check("T08i", EX, "Gilet hors liste bloquante : autorisée (décision métier paramétrable)", f"select autorisee_a_circuler::text from public.moto_v_flotte where id='{M8}'", "true")

# T09 (suite) — État de référence d'une moto en exploitation : exigences inchangées -----------
EX = "T09 Exigences réglementaires conservées"
M9 = creer("SAKASSOU", "EN_EXPLOITATION")
act("T09f", EX, "lc", "État de référence sans compteur : refus", "select public.moto_inspection_initiale(" + lit({"moto_id": M9, "items": items("INSPECTION_INITIALE"), **MECA}) + ")", False, "compteur")
act("T09g", EX, "lc", "État de référence avec 2 photos : refus (5 exigées)", insp("lc", M9, extra={"photos": photos(M9, ["COMPTEUR", "AVANT"])}, km=18000), False, "Photos insuffisantes")
act("T09h", EX, "lc", "État de référence complet : APTE", insp("lc", M9, extra={"photos": photos(M9, ["COMPTEUR", "AVANT", "ARRIERE", "GAUCHE", "DROITE"])}, km=18000), True, "\"etat_reference\": true")

# T10 — Droits et cohérence écran / serveur ----------------------------------------------------
EX = "T10 Droits et cohérence des exigences"
act("T10a", EX, "anon", "Anonyme : lecture d'aptitude refusée", f"select public.moto_aptitude('{M3}')", False, "permission")
act("T10b", EX, "uh_c", "Chef d'unité hors cluster : refus", f"select public.moto_aptitude('{M3}')", False, "périmètre")
act("T10c", EX, "uh_a", "Chef d'unité : évaluation interdite (rôle)", insp("uh_a", M1), False, "")
apt = run_as("bm", f"select public.moto_aptitude('{M3}')")[1]; apt = json.loads(apt)
codes = sorted(set(e["code"] for e in apt["exigences"]))
ok_mes, msg_mes = run_as("bm", f"select public.moto_mettre_en_service('{M3}', 'Tentative recette')")
record("T10d", EX, "bm", "Le refus serveur correspond à une exigence listée", "refus + exigences listées",
       (not ok_mes) and {"CONTRE_VISITE", "DEFAUT", "PREAFFECTER", "AUTORISER"} <= set(codes),
       f"refus : {msg_mes[:120]} | exigences : {', '.join(codes)}")
check("T10e", EX, "Nouvelles fonctions : aucun droit pour anon",
      "select count(*) from pg_proc p where p.proname in ('moto_aptitude','moto_defauts_bloquants','moto_points_bloquants') and has_function_privilege('anon', p.oid, 'execute')", "0")
check("T10f", EX, "Aucune table ni colonne de table nouvelle (seule la vue gagne une colonne)",
      "select count(*) from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema='public' and t.table_type='BASE TABLE' and c.column_name in ('defauts_bloquants_ouverts','aptitude')", "0")
check("T10g", EX, "Aucun statut technique nouveau (contrainte inchangée)",
      "select pg_get_constraintdef(oid) like '%A_CONTROLER%APTE%IMMOBILISEE%EN_REPARATION%' and pg_get_constraintdef(oid) not like '%RESERVE%' from pg_constraint where conrelid='public.moto_motos'::regclass and pg_get_constraintdef(oid) like '%statut_technique%'", "t")

# ---------------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI")
with open(os.path.join(OUT_DIR, "aptitude_10.json"), "w", encoding="utf-8") as f:
    json.dump({"base": DB, "date": datetime.datetime.now().isoformat(timespec="seconds"), "reussis": ok, "total": len(RESULTS), "resultats": RESULTS}, f, ensure_ascii=False, indent=1)
print(f"\n| ID | Exigence | Compte | Action | Attendu | Résultat |\n|---|---|---|---|---|---|")
for r in RESULTS: print(f"| {r['id']} | {r['exigence']} | {r['compte']} | {r['action']} | {r['attendu']} | {r['resultat']} |")
print(f"\nBilan : {ok}/{len(RESULTS)} réussis")
sys.exit(0 if ok == len(RESULTS) else 1)

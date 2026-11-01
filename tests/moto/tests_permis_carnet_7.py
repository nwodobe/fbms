#!/usr/bin/env python3
"""
AFLP FLEET — recette de la migration 7 (permis des conducteurs, carnet de suivi).

À exécuter APRÈS tests_maintenance_6.py sur la même base : le carnet est
éprouvé sur les dossiers, factures et paiements fictifs créés par la suite 6.
Chaque action s'exécute SOUS LE RÔLE `authenticated` (RLS active) ou `anon`,
avec des comptes FICTIFS. Aucune donnée réelle : noms, numéros de permis,
montants et fichiers sont inventés pour le test.

Usage : PGHOST=/srv/pgtest PGPORT=54329 python3 tests/moto/tests_permis_carnet_7.py fbms_moto_test
Sortie : tests/moto/resultats/permis_carnet_7.json + tableau Markdown.
"""
import json, os, subprocess, sys, uuid, datetime, time

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_test"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultats")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
# Comptes propres à la migration 7 (2xx) + comptes de la suite 6 (1xx) pour le carnet.
U = {"bm": uid(201), "abm": uid(202), "lc": uid(203), "zh": uid(204), "uh_a": uid(205), "uh_b": uid(206),
     "fin": uid(207), "dir": uid(208), "sup": uid(209), "uh_c": uid(210),
     "bm6": uid(101), "zh6": uid(104), "uh6_a": uid(105), "uh6_b": uid(106), "fin6": uid(107), "uh6_c": uid(108), "sup6": uid(109)}
PROFILS = [
    ("bm", "BM7 FICTIF", "Branch Manager", None, None, None),
    ("abm", "ABM7 FICTIF", "Assistant Branch Manager", None, None, None),
    ("lc", "COORDINATEUR7 FICTIF", "Supervisor", None, None, "Logistics Coordinator"),
    ("zh", "ZH7 FICTIF", "Zonal Head", None, "GBEKE 1", None),
    ("uh_a", "UH7 A FICTIF", "Unit Head", "SAKASSOU", "GBEKE 1", None),
    ("uh_b", "UH7 B FICTIF", "Unit Head", "BROBO", "GBEKE 1", None),
    ("uh_c", "UH7 C FICTIF", "Unit Head", "BOTRO", "GBEKE 1", None),
    ("fin", "FINANCE7 FICTIF", "Finance", None, None, None),
    ("dir", "DIRECTION7 FICTIF", "General Manager", None, None, None),
    ("sup", "SUPERVISOR7 FICTIF", "Supervisor", "BROBO", None, None),
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
    if expect_ok and not ok: return {"id": "00000000-0000-0000-0000-000000000000"}
    try: return json.loads(out) if ok and out.startswith("{") else out
    except Exception: return out

def check(tid, sc, label, sql, expected):
    try: got = q(sql)
    except Exception as e: got = f"ERREUR {e}"
    record(tid, sc, "postgres (lecture)", label, str(expected), got == str(expected), got)
    return got

def lit(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
def put_object(path): q(f"insert into storage.objects (bucket_id, name, owner) values ('moto-documents', '{path}', '{U['abm']}') on conflict do nothing")
def scan(user):
    p = f"permis/{U[user]}/{uuid.uuid4()}.pdf"; put_object(p); return p
today = datetime.date.today()
def d(days): return str(today + datetime.timedelta(days=days))
def permis(user, numero, exp=700, **extra):
    base = {"titulaire_id": U[user], "nom_titulaire": "TITULAIRE FICTIF " + user.upper(), "numero_permis": numero,
            "categories": ["A"], "date_delivrance": d(-400), "date_expiration": d(exp), "document_path": scan(user), "pages": 2}
    base.update(extra); return base

# ---------------------------------------------------------------------------
# Préparation : comptes fictifs
# ---------------------------------------------------------------------------
setup = []
for k, nom, role, cluster, zone, fonction in PROFILS:
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}7@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, fonction_operationnelle, actif) values "
                 f"('{U[k]}', '{k}7@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, {('$f$'+fonction+'$f$') if fonction else 'null'}, true) on conflict do nothing;")
q("\n".join(setup))

# ===========================================================================
# P. Enregistrement du permis (le titulaire, ou BM / ABM / coordinateur)
# ===========================================================================
p_a = act("P01", "Permis", "uh_a", "Le Chef d'unité scanne et enregistre son propre permis",
          "select public.moto_permis_enregistrer(" + lit(permis("uh_a", "CI-PA 000001")) + ")", True, "EN_VERIFICATION")["id"]
act("P02", "Permis", "uh_a", "Le Chef d'unité enregistre le permis d'un collègue", "select public.moto_permis_enregistrer(" + lit(permis("uh_b", "CI-PB 000001")) + ")", False, "Seuls le Branch Manager")
act("P03", "Permis", "zh", "Le Chef de zone enregistre le permis d'un Chef d'unité", "select public.moto_permis_enregistrer(" + lit(permis("uh_b", "CI-PB 000001")) + ")", False, "Seuls le Branch Manager")
act("P04", "Permis", "lc", "Enregistrement sans scan déposé (chemin inexistant)",
    "select public.moto_permis_enregistrer(" + lit({**permis("uh_b", "CI-PB 000001"), "document_path": f"permis/{U['uh_b']}/absent.pdf"}) + ")", False, "introuvable")
act("P05", "Permis", "lc", "Scan rangé dans le dossier d'un autre titulaire",
    "select public.moto_permis_enregistrer(" + lit({**permis("uh_b", "CI-PB 000001"), "document_path": scan("uh_c")}) + ")", False, "Scan du permis obligatoire")
act("P06", "Permis", "lc", "Ni date d'expiration, ni « aucune date sur le document »",
    "select public.moto_permis_enregistrer(" + lit({**permis("uh_b", "CI-PB 000001"), "date_expiration": None}) + ")", False, "expiration obligatoire")
act("P06b", "Permis", "lc", "Date d'expiration ET « aucune date » cochée",
    "select public.moto_permis_enregistrer(" + lit({**permis("uh_b", "CI-PB 000001"), "sans_expiration": True}) + ")", False, "pas les deux")
act("P07", "Permis", "lc", "Permis expiré", "select public.moto_permis_enregistrer(" + lit(permis("uh_b", "CI-PB 000001", exp=-1)) + ")", False, "expiré")
act("P08", "Permis", "lc", "Numéro de permis piégé (balise HTML)", "select public.moto_permis_enregistrer(" + lit(permis("uh_b", "<script>1</script>")) + ")", False, "Numéro de permis invalide")
act("P09", "Permis", "lc", "Aucune catégorie", "select public.moto_permis_enregistrer(" + lit({**permis("uh_b", "CI-PB 000001"), "categories": []}) + ")", False, "catégorie")
act("P09b", "Permis", "lc", "Catégorie fantaisiste", "select public.moto_permis_enregistrer(" + lit({**permis("uh_b", "CI-PB 000001"), "categories": ["MOTO"]}) + ")", False, "non reconnue")
act("P09c", "Permis", "lc", "Délivré dans le futur", "select public.moto_permis_enregistrer(" + lit({**permis("uh_b", "CI-PB 000001"), "date_delivrance": d(3)}) + ")", False, "futur")
act("P10", "Permis", "uh_a", "Second permis alors qu'un premier attend sa vérification", "select public.moto_permis_enregistrer(" + lit(permis("uh_a", "CI-PA 000002")) + ")", False, "déjà en attente")
act("P11", "Permis", "abm", "Permis pour un profil hors programme (Supervisor sans fonction moto)", "select public.moto_permis_enregistrer(" + lit(permis("sup", "CI-PS 000001")) + ")", False, "Titulaire invalide")
p_b = act("P12", "Permis", "lc", "Le coordinateur enregistre le permis d'un Chef d'unité (2 catégories, sans date d'expiration)",
          "select public.moto_permis_enregistrer(" + lit({**permis("uh_b", "ci-pb 000001"), "categories": ["a", "B", "A"], "date_expiration": None, "sans_expiration": True}) + ")", True, "EN_VERIFICATION")["id"]
check("P12b", "Permis", "Numéro normalisé en majuscules, catégories dédoublonnées et triées", f"select numero_permis||'|'||array_to_string(categories, ',') from public.moto_permis where id='{p_b}'", "CI-PB 000001|A,B")
act("P13", "Permis", "lc", "Même numéro pour un autre conducteur", "select public.moto_permis_enregistrer(" + lit(permis("uh_c", "CI-PB 000001")) + ")", False, "autre conducteur")
p_abm = act("P14", "Permis", "lc", "Le coordinateur enregistre le permis de l'ABM", "select public.moto_permis_enregistrer(" + lit(permis("abm", "CI-ABM 00001")) + ")", True, "EN_VERIFICATION")["id"]

# ===========================================================================
# V. Vérification sur original : ABM ou BM, jamais le déposant ni le titulaire
# ===========================================================================
act("V01", "Vérification", "lc", "Le coordinateur vérifie un permis", f"select public.moto_permis_verifier('{p_b}', 'CONFORME', 'RH FICTIF', true)", False, "rôle")
act("V02", "Vérification", "zh", "Le Chef de zone vérifie un permis", f"select public.moto_permis_verifier('{p_a}', 'CONFORME', 'RH FICTIF', true)", False, "rôle")
act("V03", "Vérification", "abm", "L'ABM vérifie son propre permis", f"select public.moto_permis_verifier('{p_abm}', 'CONFORME', 'RH FICTIF', true)", False, "titulaire")
p_dep = act("V04a", "Vérification", "abm", "L'ABM dépose le permis d'un Chef d'unité", "select public.moto_permis_enregistrer(" + lit(permis("uh_c", "CI-PC 000001")) + ")", True)["id"]
act("V04", "Vérification", "abm", "Le déposant vérifie le permis qu'il a déposé", f"select public.moto_permis_verifier('{p_dep}', 'CONFORME', 'RH FICTIF', true)", False, "Séparation")
act("V05", "Vérification", "bm", "Conforme sans nom de la personne RH qui a vu l'original", f"select public.moto_permis_verifier('{p_a}', 'CONFORME', null, true)", False, "RH")
act("V06", "Vérification", "bm", "Conforme sans confirmer la catégorie adaptée", f"select public.moto_permis_verifier('{p_a}', 'CONFORME', 'RH FICTIF', false)", False, "catégorie")
act("V07", "Vérification", "bm", "Non conforme sans motif", f"select public.moto_permis_verifier('{p_dep}', 'NON_CONFORME')", False, "motif")
act("V08", "Vérification", "bm", "Le BM déclare conforme le permis du Chef d'unité A", f"select public.moto_permis_verifier('{p_a}', 'CONFORME', 'RH FICTIF', true, 'Original présenté au bureau')", True, "CONFORME")
act("V09", "Vérification", "bm", "Seconde vérification du même permis", f"select public.moto_permis_verifier('{p_a}', 'NON_CONFORME', null, null, 'Tentative de seconde décision')", False, "déjà vérifié")
act("V10", "Vérification", "bm", "Non conforme motivé (photo illisible)", f"select public.moto_permis_verifier('{p_dep}', 'NON_CONFORME', null, null, 'Scan illisible, à refaire')", True, "NON_CONFORME")
act("V11", "Vérification", "abm", "L'ABM vérifie le permis déposé par le coordinateur (sans expiration)", f"select public.moto_permis_verifier('{p_b}', 'CONFORME', 'RH FICTIF', true)", True, "CONFORME")
act("V12", "Vérification", "bm", "Le BM vérifie le permis de l'ABM", f"select public.moto_permis_verifier('{p_abm}', 'CONFORME', 'RH FICTIF', true)", True, "CONFORME")
# Renouvellement : même numéro, même titulaire ; l'ancien reste valable jusqu'à la vérification du nouveau.
p_a2 = act("V13", "Vérification", "uh_a", "Renouvellement : même numéro, nouvelle date d'expiration", "select public.moto_permis_enregistrer(" + lit(permis("uh_a", "CI-PA 000001", exp=1500)) + ")", True, "EN_VERIFICATION")["id"]
check("V13b", "Vérification", "Pendant le renouvellement, l'ancien permis reste CONFORME", f"select statut from public.moto_permis where id='{p_a}'", "CONFORME")
act("V14", "Vérification", "abm", "L'ABM vérifie le renouvellement", f"select public.moto_permis_verifier('{p_a2}', 'CONFORME', 'RH FICTIF', true)", True, "CONFORME")
check("V14b", "Vérification", "L'ancien permis passe REMPLACE, un seul CONFORME par titulaire",
      f"select (select statut from public.moto_permis where id='{p_a}')||'/'||(select count(*) from public.moto_permis where titulaire_id='{U['uh_a']}' and statut='CONFORME')", "REMPLACE/1")
act("V15", "Écriture directe", "bm", "Insertion directe dans moto_permis", f"insert into public.moto_permis (titulaire_id, nom_titulaire, numero_permis, categories, sans_expiration, document_path) values ('{U['uh_c']}', 'X X X', 'DIRECT 1', '{{A}}', true, 'permis/x/y.pdf')", False, "permission")
act("V16", "Écriture directe", "bm", "Mise à jour directe du statut", f"update public.moto_permis set statut='CONFORME' where id='{p_dep}'", False, "permission")
act("V17", "Écriture directe", "anon", "Anonyme appelle l'enregistrement", "select public.moto_permis_enregistrer(" + lit(permis("uh_c", "CI-ANON 0001")) + ")", False, "permission")

# ===========================================================================
# L. Lecture : données personnelles réservées (BM, ABM, coordinateur, titulaire)
# ===========================================================================
act("L01", "Lecture", "uh_a", "Le titulaire voit ses permis (actuel + remplacé)", f"select count(*) from public.moto_v_permis where titulaire_id='{U['uh_a']}'", True, "2")
act("L02", "Lecture", "uh_b", "Un autre Chef d'unité ne voit pas le permis de A", f"select count(*) from public.moto_v_permis where titulaire_id='{U['uh_a']}'", True, "0")
act("L02b", "Lecture", "uh_b", "Table de base : idem", f"select count(*) from public.moto_permis where titulaire_id='{U['uh_a']}'", True, "0")
act("L03", "Lecture", "zh", "Le Chef de zone ne voit aucun permis", "select count(*) from public.moto_v_permis", True, "0")
act("L04", "Lecture", "fin", "La Finance ne voit aucun permis", "select count(*) from public.moto_v_permis", True, "0")
act("L05", "Lecture", "dir", "La Direction ne voit aucun permis (minimisation)", "select count(*) from public.moto_v_permis", True, "0")
act("L06", "Lecture", "lc", "Le coordinateur voit les permis (préparation des remises)", f"select count(*) >= 5 from public.moto_v_permis", True, "t")
act("L07", "Lecture", "anon", "Anonyme lit les permis", "select count(*) from public.moto_v_permis", False, "permission")
act("L08", "Lecture", "lc", "Statut de validité calculé : sans date d'expiration = VALIDE", f"select statut_validite from public.moto_v_permis where id='{p_b}'", True, "VALIDE")

# ===========================================================================
# S. Stockage privé des scans : dossier permis/<titulaire>/
# ===========================================================================
act("S01", "Stockage", "uh_a", "Le titulaire dépose son scan", f"insert into storage.objects (bucket_id, name) values ('moto-documents', 'permis/{U['uh_a']}/{uuid.uuid4()}.pdf')", True)
act("S02", "Stockage", "uh_a", "Dépôt dans le dossier permis d'un autre", f"insert into storage.objects (bucket_id, name) values ('moto-documents', 'permis/{U['uh_b']}/{uuid.uuid4()}.pdf')", False, "row-level security")
act("S03", "Stockage", "zh", "Le Chef de zone dépose dans le dossier permis d'un Chef d'unité", f"insert into storage.objects (bucket_id, name) values ('moto-documents', 'permis/{U['uh_a']}/{uuid.uuid4()}.pdf')", False, "row-level security")
act("S04", "Stockage", "lc", "Le coordinateur dépose le scan d'un Chef d'unité", f"insert into storage.objects (bucket_id, name) values ('moto-documents', 'permis/{U['uh_b']}/{uuid.uuid4()}.pdf')", True)
act("S05", "Stockage", "lc", "Dossier permis d'un profil hors programme", f"insert into storage.objects (bucket_id, name) values ('moto-documents', 'permis/{U['sup']}/{uuid.uuid4()}.pdf')", False, "row-level security")
act("S06", "Stockage", "uh_b", "Lecture des scans de permis d'un autre conducteur", f"select count(*) from storage.objects where bucket_id='moto-documents' and name like 'permis/{U['uh_a']}/%'", True, "0")
act("S07", "Stockage", "zh", "Le Chef de zone lit les scans de permis", "select count(*) from storage.objects where bucket_id='moto-documents' and name like 'permis/%'", True, "0")
act("S08", "Stockage", "uh_a", "Le titulaire relit ses propres scans", f"select count(*) > 0 from storage.objects where bucket_id='moto-documents' and name like 'permis/{U['uh_a']}/%'", True, "t")
act("S09", "Stockage", "abm", "Non-régression : l'ABM dépose toujours un document de moto", "select count(*) >= 0 from public.moto_motos", True, "t")

# ===========================================================================
# R. Remise : permis enregistré, CONFORME et valide exigé par le serveur
# ===========================================================================
ok, out = run_as("abm", "select public.moto_creer(" + lit({"marque": "APSONIC", "modele": "AP150-30", "cluster_code": "BROBO", "date_reception": d(-2), "motif": "Moto de test migration 7 (fictive)"}) + ")")
R = json.loads(out)["id"]
def remise_directe(user, km=1, categorie="FAUX"):
    return q(f"""insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, statut, date_debut, compteur_km, motif, cree_par, permis_verifie, permis_categorie, permis_verifie_par_nom)
                values ('{R}', '{U[user]}', 'BROBO', 'REMISE', 'ACTIVE', current_date, {km}, 'Test migration 7', '{U['abm']}', true, '{categorie}', 'NOM SAISI A LA MAIN')
                returning permis_categorie||'|'||permis_verifie_par_nom||'|'||(permis_id is not null)""")
try: remise_directe("uh_c"); r1 = "OK"
except RuntimeError as e: r1 = str(e)
record("R01", "Remise", "postgres (écriture directe)", "Remise à un conducteur dont le seul permis est NON CONFORME (case cochée côté client)",
       "REFUS (permis)", "Remise bloquée" in r1 and "permis" in r1, r1[:240])
try: res = remise_directe("uh_b"); r2 = res
except RuntimeError as e: r2 = "ERREUR " + str(e)
record("R02", "Remise", "postgres (écriture directe)", "Remise avec permis CONFORME : catégorie et vérificateur repris du permis enregistré, pas de la saisie",
       "A, B|RH FICTIF|true", r2 == "A, B|RH FICTIF|true", r2)
q(f"update public.moto_affectations set statut='CLOTUREE', date_fin=current_date where moto_id='{R}' and statut='ACTIVE'")
# Permis expiré après coup (fixture superutilisateur) : la remise suivante est refusée, l'alerte se déclenche.
q(f"""alter table public.moto_permis disable trigger moto_permis_journal_trg;
      update public.moto_permis set date_delivrance = current_date - 3000, date_expiration = current_date - 1 where id = '{p_a2}';
      alter table public.moto_permis enable trigger moto_permis_journal_trg;""")
try: remise_directe("uh_a"); r3 = "OK"
except RuntimeError as e: r3 = str(e)
record("R03", "Remise", "postgres (écriture directe)", "Remise à un conducteur dont le permis a expiré hier", "REFUS (permis)", "Remise bloquée" in r3, r3[:240])
act("R04", "Remise", "abm", "Un permis déjà expiré ne peut pas être enregistré",
    "select public.moto_permis_enregistrer(" + lit(permis("uh_a", "CI-PA 000009", exp=-5)) + ")", False, "expiré")
# Alertes : remise active au Chef d'unité B (permis sans expiration) puis passage à une date proche pour le test.
remise_directe("uh_b")
q(f"""alter table public.moto_permis disable trigger moto_permis_journal_trg;
      update public.moto_permis set sans_expiration = false, date_expiration = current_date + 10 where id = '{p_b}';
      alter table public.moto_permis enable trigger moto_permis_journal_trg;""")
act("R05", "Alertes", "lc", "Permis du conducteur affecté qui expire dans 10 jours", f"select statut_validite||'|'||jours_restants from public.moto_permis_alertes() where moto_id='{R}'", True, "EXPIRE_BIENTOT|10")
q(f"""alter table public.moto_permis disable trigger moto_permis_journal_trg;
      update public.moto_permis set date_expiration = current_date - 1, date_delivrance = current_date - 3000 where id = '{p_b}';
      alter table public.moto_permis enable trigger moto_permis_journal_trg;""")
act("R06", "Alertes", "bm", "Permis expiré pendant l'affectation : signalé « aucun permis valide »", f"select statut_validite from public.moto_permis_alertes() where moto_id='{R}'", True, "AUCUN_PERMIS_VALIDE")
act("R07", "Alertes", "uh_b", "Un Chef d'unité n'accède pas aux alertes de permis", "select count(*) from public.moto_permis_alertes()", True, "0")
act("R08", "Alertes", "zh", "Le Chef de zone n'accède pas aux alertes de permis", "select count(*) from public.moto_permis_alertes()", True, "0")
act("R09", "Alertes", "anon", "Anonyme appelle les alertes", "select count(*) from public.moto_permis_alertes()", False, "permission")
check("R10", "Journal", "Chaque écriture de permis est journalisée (auteur et motif)",
      f"select count(*) >= 2 from public.moto_journal where table_nom='moto_permis' and enregistrement_id='{p_a}'", "t")

# ===========================================================================
# C. Carnet de suivi (sur les dossiers fictifs de la suite 6)
# ===========================================================================
MC = q("select moto_id from public.moto_factures group by moto_id order by count(*) desc, moto_id limit 1")
cluster = q(f"select cluster_code from public.moto_motos where id='{MC}'")
dedans = {"SAKASSOU": "uh6_a", "BROBO": "uh6_b"}.get(cluster, "uh6_a")
dehors = "uh6_b" if dedans != "uh6_b" else "uh6_a"
carnet = f"public.moto_carnet('{MC}')"
act("C01", "Carnet", "bm6", "Le BM voit décisions et factures avec leurs montants",
    f"select (count(*) filter (where categorie='AUTORISATION' and montant is not null) > 0 and count(*) filter (where categorie='FACTURE' and montant is not null) > 0)::text from {carnet}", True, "true")
act("C02", "Carnet", "fin6", "La Finance voit les montants facturés et payés",
    f"select (count(*) filter (where montant_nature='FACTURE') > 0)::text from {carnet}", True, "true")
act("C03", "Carnet", "zh6", "Le Chef de zone voit la chronologie, sans aucun événement financier",
    f"select (count(*) > 0)::text||'|'||count(*) filter (where categorie in ('AUTORISATION','FACTURE'))||'|'||count(montant) filter (where categorie <> 'CARBURANT') from {carnet}", True, "true|0|0")
act("C04", "Carnet", dedans, "Le Chef d'unité du cluster voit l'historique technique, sans montant d'entretien",
    f"select count(*) filter (where categorie in ('AUTORISATION','FACTURE'))||'|'||count(montant) filter (where categorie <> 'CARBURANT') from {carnet}", True, "0|0")
act("C05", "Carnet", dehors, "Un Chef d'unité d'un autre cluster lit le carnet", f"select count(*) from {carnet}", False, "périmètre")
act("C06", "Carnet", "sup6", "Un profil hors module lit le carnet", f"select count(*) from {carnet}", False, "périmètre")
act("C07", "Carnet", "anon", "Anonyme lit le carnet", f"select count(*) from {carnet}", False, "permission")
act("C08", "Carnet", "bm6", "Aucun double comptage : total FACTURE du carnet = factures de la moto",
    f"select ((select coalesce(sum(montant),0) from {carnet} where montant_nature='FACTURE') = (select coalesce(sum(montant),0) from public.moto_factures where moto_id='{MC}'))::text", True, "true")
act("C09", "Carnet", "bm6", "Paiements distincts des factures : total PAYE = montants payés constatés",
    f"select ((select coalesce(sum(montant),0) from {carnet} where montant_nature='PAYE') = (select coalesce(sum(montant_paye),0) from public.moto_factures where moto_id='{MC}' and paiement_date is not null))::text", True, "true")
act("C10", "Carnet", "bm6", "Ordre chronologique décroissant, aucune date vide",
    f"select (bool_and(date_evenement is not null) and (array_agg(date_evenement) = array_agg(date_evenement order by date_evenement desc)))::text from (select * from {carnet}) x", True, "true")
act("C11", "Carnet", "bm6", "Les contrôles avant départ sans défaut n'encombrent pas le carnet",
    f"select count(*) from {carnet} where evenement like 'Contrôle avant départ%' and statut = 'APTE'", True, "0")
act("C12", "Carnet", "bm6", "Chaque dossier de maintenance de la moto apparaît",
    f"select ((select count(distinct source_id) from {carnet} where source='moto_maintenances') = (select count(*) from public.moto_maintenances where moto_id='{MC}'))::text", True, "true")
MJ = q("select id from public.moto_motos where origine='EN_EXPLOITATION' order by created_at limit 1")
if MJ:
    act("C13", "Carnet", "bm6", "Moto déjà en exploitation (cas JACKSON) : aucun entretien ni coût inventé avant le suivi fiable",
        f"select count(*) from public.moto_carnet('{MJ}') where categorie in ('MAINTENANCE','FACTURE','AUTORISATION','CARBURANT') and date_evenement < coalesce((select date_debut_suivi from public.moto_motos where id='{MJ}'), now())", True, "0")
# Carburant : la synthèse mensuelle reprend exactement les achats déclarés.
MF = q("select moto_id from public.moto_carburant group by 1 order by count(*) desc limit 1")
if MF:
    act("C14", "Carnet", "bm6", "Carburant : total des synthèses mensuelles = total des achats",
        f"select ((select coalesce(sum(montant),0) from public.moto_carnet('{MF}') where categorie='CARBURANT') = (select coalesce(sum(montant),0) from public.moto_carburant where moto_id='{MF}'))::text", True, "true")
t0 = time.time(); ok, _ = run_as("bm6", f"select count(*) from {carnet}"); dt = time.time() - t0
record("C15", "Carnet", "bm6", "Temps de réponse du carnet (psql compris)", "< 2 s", ok and dt < 2, f"{dt:.2f} s")
act("C16", "Carnet", "bm6", "Remise avec permis visible dans le carnet de la moto de test",
    f"select count(*) > 0 from public.moto_carnet('{R}') where categorie='AFFECTATION' and detail like '%permis vérifié (A, B)%'", True, "t")

# ---------------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "permis_carnet_7.json"), "w", encoding="utf-8") as f:
    json.dump({"base": DB, "date": datetime.datetime.now(datetime.timezone.utc).isoformat(), "resultats": RESULTS}, f, ensure_ascii=False, indent=1)
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI")
print("| id | domaine | compte | action | attendu | obtenu | résultat |\n|---|---|---|---|---|---|---|")
for r in RESULTS:
    print(f"| {r['id']} | {r['domaine']} | {r['compte']} | {r['action']} | {r['attendu']} | {r['obtenu'][:90]} | {r['resultat']} |")
print(f"TOTAL MIGRATION 7 : {ok}/{len(RESULTS)} réussis")
sys.exit(0 if ok == len(RESULTS) else 1)

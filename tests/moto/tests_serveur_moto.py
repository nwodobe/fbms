#!/usr/bin/env python3
"""
AFLP MOTO MANAGER — recette serveur sur réplique LOCALE.

Chaque action est exécutée SOUS LE RÔLE `authenticated` (RLS active, aucun
contournement superutilisateur), avec l'identité JWT d'un compte FICTIF.
Les vérifications d'état (assert) lisent la base en superutilisateur.
Refuse toute cible Supabase. Aucune donnée réelle : comptes, châssis,
immatriculations et montants sont fictifs et marqués comme tels.

Usage : PGHOST=/srv/pgtest PGPORT=54329 python3 tests/moto/tests_serveur_moto.py fbms_moto_test
Sortie : tests/moto/resultats/serveur.json + tableau Markdown sur stdout.
"""
import json, os, subprocess, sys, uuid, datetime

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_test"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultats")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
U = {
    "bm": uid(1), "abm": uid(2), "zh": uid(3), "uh_sak": uid(4), "uh_bot": uid(5), "uh_bro": uid(6), "uh_ndj": uid(7),
    "fin": uid(8), "fm": uid(9), "gm": uid(10), "sup": uid(11), "agent": uid(12), "uh_inactif": uid(13),
}
PROFILS = [
    ("bm", "BM FICTIF", "Branch Manager", None, None, True),
    ("abm", "ABM FICTIF", "Assistant Branch Manager", None, None, True),
    ("zh", "ZH FICTIF", "Zonal Head", None, "GBEKE 1", True),
    ("uh_sak", "UH SAKASSOU FICTIF", "Unit Head", "SAKASSOU", "GBEKE 1", True),
    ("uh_bot", "UH BOTRO FICTIF", "Unit Head", "BOTRO", "GBEKE 2", True),
    ("uh_bro", "UH BROBO FICTIF", "Unit Head", "BROBO", "GBEKE 1", True),
    ("uh_ndj", "UH NDJEBONOUA FICTIF", "Unit Head", "N'Djébonoua", "GBEKE 1", True),
    ("fin", "FINANCE FICTIF", "Finance", None, None, True),
    ("fm", "FINANCE MANAGER FICTIF", "Finance Manager", None, None, True),
    ("gm", "GM FICTIF", "General Manager", None, None, True),
    ("sup", "SUPERVISOR FICTIF", "Supervisor", "BROBO", None, True),
    ("agent", "AGENT FICTIF", "Agent Recenseur", "BROBO", None, True),
    ("uh_inactif", "UH INACTIF FICTIF", "Unit Head", "BOTRO", "GBEKE 2", False),
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
    if not ok: print(f"ÉCHEC {tid} [{user}] {label} — attendu {attendu} — obtenu {obtenu[:240]}", file=sys.stderr, flush=True)

def act(tid, exigence, user, label, sql, expect_ok=True, contains=None):
    ok, out = run_as(user, sql)
    passed = (ok == expect_ok) and (contains is None or contains.lower() in out.lower())
    record(tid, exigence, user, label, ("OK" if expect_ok else "REFUS") + (f" ({contains})" if contains else ""), passed,
           ("OK : " if ok else "REFUS : ") + out)
    VIDE = {"id": "00000000-0000-0000-0000-000000000000"}  # l'échec est déjà enregistré ; les tests dépendants échoueront visiblement
    if expect_ok and not ok: return VIDE
    try: return json.loads(out) if ok and out.startswith("{") else out
    except Exception: return out

def check(tid, exigence, label, sql, expected):
    try: got = q(sql)
    except Exception as e: got = f"ERREUR {e}"
    record(tid, exigence, "postgres (lecture)", label, str(expected), got == str(expected), got)
    return got

def lit(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"

def items(typ, ko=(), falsifier=False):
    """Liste complète du catalogue SERVEUR ; `falsifier` envoie critique=false (tentative de neutralisation)."""
    rows = json.loads(q(f"select json_agg(json_build_object('code', code, 'critique', critique) order by ordre) from public.moto_catalogue_points where type_controle='{typ}' and actif"))
    return [{"code": r["code"], "ok": r["code"] not in ko, **({"critique": False} if falsifier else {"critique": r["critique"]})} for r in rows]

def put_object(path):
    q(f"insert into storage.objects (bucket_id, name, owner) values ('moto-documents', '{path}', '{U['abm']}') on conflict do nothing")

def permis_pour(benef):
    """Migration 7 : la remise exige un permis enregistré, vérifié CONFORME (autre personne) et valide."""
    if q("select to_regclass('public.moto_permis') is not null") != "t": return
    if q(f"select count(*) from public.moto_permis where titulaire_id='{U[benef]}' and statut='CONFORME'") != "0": return
    pth = f"permis/{U[benef]}/{uuid.uuid4()}.pdf"; put_object(pth)
    deposant = "lc" if benef == "abm" else "abm"
    ok, out = run_as(deposant, "select public.moto_permis_enregistrer(" + lit({"titulaire_id": U[benef], "nom_titulaire": "TITULAIRE FICTIF " + benef.upper(),
                     "numero_permis": "TEST-" + U[benef][-6:], "categories": ["A"], "date_expiration": str(today + datetime.timedelta(days=700)),
                     "document_path": pth}) + ")")
    assert ok, out
    ok, out = run_as("bm", f"select public.moto_permis_verifier('{json.loads(out)['id']}', 'CONFORME', 'RH FICTIF', true)")
    assert ok, out

# ---------------------------------------------------------------------------
# Préparation : comptes fictifs
# ---------------------------------------------------------------------------
setup = []
for k, nom, role, cluster, zone, actif in PROFILS:
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
                 f"('{U[k]}', '{k}@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, {str(actif).lower()}) on conflict do nothing;")
q("\n".join(setup))

now = datetime.datetime.now(datetime.timezone.utc)
def ts(days=0, hours=0): return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=days, hours=hours)).isoformat()
today = datetime.date.today()

# ---------------------------------------------------------------------------
# A. Inventaire et passeport
# ---------------------------------------------------------------------------
act("SEC-01", "Accès refusé aux rôles hors périmètre", "sup", "Supervisor crée une moto",
    "select public.moto_creer('{\"marque\":\"APSONIC\",\"modele\":\"AP150-30\"}'::jsonb)", False, "rôle")
act("SEC-02", "Accès refusé anonyme", "anon", "Anonyme lit la flotte", "select count(*) from public.moto_motos", False, "permission")
act("SEC-03", "Pas de création par Chef d'unité", "uh_sak", "Chef d'unité crée une moto",
    "select public.moto_creer('{\"marque\":\"APSONIC\",\"modele\":\"AP150-30\"}'::jsonb)", False, "rôle")
act("SEC-04", "Écriture directe interdite (RLS + privilèges)", "bm", "BM insère directement dans moto_motos",
    "insert into public.moto_motos (marque, modele) values ('X','Y')", False, "permission")

motos = {}
for i, cl in enumerate(["SAKASSOU", "BOTRO", "BROBO", "N'Djébonoua"], start=1):
    r = act(f"INV-0{i}", "Passeport : création sans châssis inventé", "abm", f"ABM crée moto {i} ({cl})",
            "select public.moto_creer(" + lit({"marque": "APSONIC", "modele": "AP150-30", "cluster_code": cl,
                                                 "date_reception": "2026-10-30", "motif": "Réception physique pilote"}) + ")")
    motos[i] = r["id"] if isinstance(r, dict) else None
M1, M2, M3, M4 = motos[1], motos[2], motos[3], motos[4]
check("INV-05", "Identifiant et QR uniques", "4 codes et 4 jetons QR distincts",
      "select count(distinct code)||'/'||count(distinct qr_token) from public.moto_motos", "4/4")
check("INV-06", "Châssis non inventé", "Châssis et immatriculation vides à la création",
      "select count(*) from public.moto_motos where numero_chassis is null and immatriculation is null", "4")
check("INV-07", "Statuts initiaux indépendants", "EN_ATTENTE / NON_AFFECTEE / A_CONTROLER",
      f"select statut_administratif||'/'||statut_affectation||'/'||statut_technique from public.moto_motos where id='{M1}'",
      "EN_ATTENTE/NON_AFFECTEE/A_CONTROLER")
act("INV-08", "Unicité châssis", "abm", "Deux motos avec le même châssis fictif",
    f"select public.moto_modifier_identite('{M1}', '{{\"numero_chassis\":\"TEST-FICTIF-CH-01\",\"immatriculation\":\"TEST 0001 FICTIF\"}}'::jsonb, 'Saisie carte grise test');"
    f"select public.moto_modifier_identite('{M2}', '{{\"numero_chassis\":\"test-fictif-ch-01\"}}'::jsonb, 'Saisie doublon test')", False, "duplicate")
act("INV-09", "Saisie identité M1", "abm", "Châssis et immatriculation fictifs M1",
    f"select public.moto_modifier_identite('{M1}', '{{\"numero_chassis\":\"TEST-FICTIF-CH-01\",\"immatriculation\":\"TEST 0001 FICTIF\"}}'::jsonb, 'Saisie carte grise test')")
act("INV-10", "Conflit de version", "abm", "Modification avec row_version périmée",
    f"select public.moto_modifier_identite('{M1}', '{{\"couleur\":\"ROUGE\",\"row_version\":1}}'::jsonb, 'Test conflit version')", False, "CONFLIT")
check("JOU-01", "Journal : ancienne/nouvelle valeur, auteur, motif", "Journal de M1 avec motif",
      f"select count(*)>0 from public.moto_journal where table_nom='moto_motos' and enregistrement_id='{M1}' and action='UPDATE' "
      f"and motif='Saisie carte grise test' and auteur='{U['abm']}' and ancienne_valeur->>'numero_chassis' is null "
      f"and nouvelle_valeur->>'numero_chassis'='TEST-FICTIF-CH-01'", "t")
act("JOU-02", "Journal immuable", "bm", "BM supprime une ligne de journal", "delete from public.moto_journal", False, "permission")
check("JOU-03", "Journal immuable (même superutilisateur)", "Trigger refuse la mise à jour",
      "do $$ begin begin update public.moto_journal set motif='x'; exception when others then raise notice 'refus'; return; end; raise exception 'mise a jour acceptee'; end $$; select 'refuse'", "refuse")

# ---------------------------------------------------------------------------
# B. Documents privés et conformité
# ---------------------------------------------------------------------------
docs = {}
def depot(user, moto, typ, cat, ref=None, exp=None, label=None, tid=None, expect_ok=True, contains=None, put=True):
    path = f"{moto}/{cat}/{uuid.uuid4()}.pdf"
    if put: put_object(path)
    p = {"moto_id": moto, "type_document": typ, "storage_path": path, "numero_reference": ref, "date_expiration": exp}
    return act(tid or f"DOC-{typ}", "Documents administratifs", user, label or f"Dépôt {typ}",
               "select public.moto_document_enregistrer(" + lit({k: v for k, v in p.items() if v is not None}) + ")", expect_ok, contains)

# --- Migration 6 : circuit de dossier jusqu'à l'autorisation individuelle du BM ---------------
GAR = {}
def garage(user="abm"):
    if "id" not in GAR:
        r = act("GAR-00", "Garage enregistré (fiche fictive)", user, "Fiche garage fictive",
                "select public.moto_garage_enregistrer(" + lit({"nom": "GARAGE FICTIF TEST", "localisation": "LOCALITE FICTIVE", "types_interventions": ["ENTRETIEN", "REPARATION"]}) + ")")
        GAR["id"] = r["id"]
    return GAR["id"]

def piece(moto, cat):
    path = f"finmaint/{moto}/{cat}/{uuid.uuid4()}.pdf"; put_object(path); return path

def dossier_autorise(tid, moto, montant, type_m="REPARATION", op="REPARATION", incident=None, demandeur="abm", soumetteur="abm"):
    """Besoin → devis → soumission → autorisation BM. Renvoie (dossier, autorisation)."""
    p = {"moto_id": moto, "type_maintenance": type_m, "description": f"Dossier de test {tid} (fictif)"}
    if incident: p["incident_id"] = incident
    mt = act(f"{tid}-a", "Dossier : besoin identifié", demandeur, "Demande", "select public.moto_maintenance_demander(" + lit(p) + ")", True, "DEMANDEE")
    act(f"{tid}-b", "Dossier : devis enregistré", soumetteur, "Devis fictif",
        "select public.moto_maintenance_devis(" + lit({"maintenance_id": mt["id"], "garage_id": garage(), "devis_montant": montant, "devis_path": piece(moto, "devis"),
              "travaux": [{"operation_code": op, "libelle": f"Opération {op} (fictif)"}], "justification": "Besoin constaté lors du test",
              "consequence_report": "Risque d'aggravation"}) + ")", True, "DEVIS_RECU")
    au = act(f"{tid}-c", "Dossier : soumission au BM", soumetteur, "Soumission",
             "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mt["id"], "objet": "TRAVAUX", "montant_demande": montant,
                   "perimetre": f"Travaux {op} selon devis fictif"}) + ")", True, "EN_ATTENTE")
    act(f"{tid}-d", "Dossier : autorisation individuelle du BM", "bm", "Décision BM",
        f"select public.moto_autorisation_decider('{au['id']}', 'AUTORISEE', {montant}, null)", True, "AUTORISEE")
    return mt["id"], au["id"]

def travaux_realises(mt):
    return json.loads(q(f"select coalesce(json_agg(json_build_object('id', id, 'realise', true)), '[]') from public.moto_maintenance_travaux where maintenance_id='{mt}' and statut='PREVU'"))

act("STO-01", "Stockage privé : dépôt hors périmètre refusé", "uh_sak", "Chef d'unité dépose dans le dossier d'une moto non affectée",
    f"insert into storage.objects (bucket_id, name) values ('moto-documents', '{M2}/justificatif/x.jpg')", False, "row-level security")
act("STO-02", "Stockage privé : chemin non conforme refusé", "abm", "ABM dépose hors dossier moto",
    "insert into storage.objects (bucket_id, name) values ('moto-documents', 'divers/x.pdf')", False, "row-level security")
act("STO-03", "Stockage privé : dépôt ABM accepté", "abm", "ABM dépose dans le dossier de M1",
    f"insert into storage.objects (bucket_id, name) values ('moto-documents', '{M1}/document/carte-grise-test.pdf')")
check("STO-04", "Bucket privé", "public = false", "select public from storage.buckets where id='moto-documents'", "f")
act("DOC-01", "Document : fichier obligatoire", "abm", "Carte grise sans fichier",
    "select public.moto_document_enregistrer(" + lit({"moto_id": M1, "type_document": "CARTE_GRISE"}) + ")", False, "fichier")
act("DOC-02", "Document : fichier réellement présent", "abm", "Carte grise avec chemin inexistant",
    "select public.moto_document_enregistrer(" + lit({"moto_id": M1, "type_document": "CARTE_GRISE",
        "storage_path": f"{M1}/document/inexistant.pdf"}) + ")", False, "introuvable")
r = depot("abm", M1, "CARTE_GRISE", "document", ref="TEST-CG-FICTIF", tid="DOC-03", label="Carte grise M1")
docs["cg1"] = r["id"]
r = depot("abm", M1, "PLAQUE", "document", tid="DOC-04", label="Plaque M1"); docs["pl1"] = r["id"]
r = depot("abm", M1, "ASSURANCE", "document", exp=str(today + datetime.timedelta(days=365)), tid="DOC-05", label="Assurance M1"); docs["as1"] = r["id"]
check("DOC-06", "Statut administratif EN_VERIFICATION", "Documents déposés non vérifiés",
      f"select statut_administratif from public.moto_motos where id='{M1}'", "EN_VERIFICATION")
act("DOC-07", "Auto-vérification interdite", "abm", "ABM vérifie son propre dépôt",
    f"select public.moto_document_verifier('{docs['cg1']}', 'CONFORME')", False, "Auto-validation")
act("DOC-08", "Non conforme exige un motif", "bm", "BM refuse sans motif",
    f"select public.moto_document_verifier('{docs['pl1']}', 'NON_CONFORME', '')", False, "Motif")
for k, lab in (("cg1", "carte grise"), ("pl1", "plaque"), ("as1", "assurance")):
    act(f"DOC-09{k}", "Vérification par un tiers", "bm", f"BM vérifie {lab} M1", f"select public.moto_document_verifier('{docs[k]}', 'CONFORME')")
check("DOC-10", "Conformité administrative", "CONFORME après 3 documents vérifiés",
      f"select statut_administratif from public.moto_motos where id='{M1}'", "CONFORME")
r = depot("abm", M2, "ASSURANCE", "document", exp=str(today - datetime.timedelta(days=1)), tid="DOC-11", label="Assurance expirée M2")
act("DOC-12", "Document expiré non conforme", "bm", "BM déclare conforme une assurance expirée",
    f"select public.moto_document_verifier('{r['id']}', 'CONFORME')", False, "expiré")
check("DOC-14", "Moto réceptionnée sans documents : non autorisée à circuler", "autorisee_a_circuler = false",
      f"select autorisee_a_circuler from public.moto_v_flotte where id='{M3}'", "f")

# ---------------------------------------------------------------------------
# C. Inspection, préaffectation, remise, mise en service
# ---------------------------------------------------------------------------
items_ok = items("INSPECTION_INITIALE")
items_crit = items("INSPECTION_INITIALE", ko=("FREIN_AVANT",), falsifier=True)  # le client prétend « non critique »
act("INS-01", "Inspection : mécanicien obligatoire", "abm", "Inspection sans nom de mécanicien",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M1, "items": items_ok, "resultat": "APTE"}) + ")", False, "mécanicien")
r = act("INS-02", "Anomalie critique calculée par le serveur", "abm", "Inspection M2 avec freins KO déclarée APTE par le client",
        "select public.moto_inspection_initiale(" + lit({"moto_id": M2, "items": items_crit, "resultat": "APTE",
              "intervenant_nom": "MECANICIEN FICTIF", "garage_nom": "GARAGE FICTIF", "compteur_km": 3}) + ")")
check("INS-03", "Anomalie critique bloque la mise en service", "M2 IMMOBILISEE, résultat INAPTE",
      f"select statut_technique||'/'||(select resultat from public.moto_controles where moto_id='{M2}' limit 1) from public.moto_motos where id='{M2}'",
      "IMMOBILISEE/INAPTE")
act("INS-04", "Inspection initiale APTE", "abm", "Inspection M1 APTE",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M1, "items": items_ok, "resultat": "APTE",
      "intervenant_nom": "MECANICIEN FICTIF", "garage_nom": "GARAGE FICTIF", "avis_mecanicien": "Avis technique, non réglementaire", "compteur_km": 2}) + ")")
check("INS-05", "Statut technique APTE", "APTE", f"select statut_technique from public.moto_motos where id='{M1}'", "APTE")

act("AFF-01", "Préaffectation réservée au Branch Manager", "abm", "ABM préaffecte",
    f"select public.moto_preaffecter('{M1}', '{U['uh_sak']}', 'Pilote Sakassou')", False, "rôle")
act("AFF-02", "Bénéficiaire doit être Chef d'unité/zone", "bm", "Préaffectation à un Supervisor",
    f"select public.moto_preaffecter('{M1}', '{U['sup']}', 'Test refus rôle')", False, "Chef")
act("AFF-03", "Bénéficiaire inactif refusé", "bm", "Préaffectation à un compte inactif",
    f"select public.moto_preaffecter('{M1}', '{U['uh_inactif']}', 'Test refus inactif')", False, "inactif")
act("AFF-04", "Préaffectation", "bm", "BM préaffecte M1 à UH Sakassou", f"select public.moto_preaffecter('{M1}', '{U['uh_sak']}', 'Pilote Sakassou')")
act("AFF-05", "Une seule affectation active", "bm", "Seconde préaffectation de M1",
    f"select public.moto_preaffecter('{M1}', '{U['uh_bot']}', 'Doublon test')", False, "transfert")
act("AFF-06", "Préaffectation M4 cluster normalisé", "bm", "BM préaffecte M4 à UH N'Djébonoua",
    f"select public.moto_preaffecter('{M4}', '{U['uh_ndj']}', 'Pilote Djébonoua')")
check("AFF-07", "Cluster N'Djébonoua normalisé", "DJEBONOUA", f"select cluster_code from public.moto_motos where id='{M4}'", "DJEBONOUA")

eq_ok = {"CASQUE": True, "GILET_HAUTE_VISIBILITE": True}
remise_base = {"moto_id": M1, "permis_verifie": True, "permis_categorie": "A", "permis_verifie_par_nom": "RH FICTIF",
               "equipements": eq_ok, "compteur_km": 5}
act("REM-01", "PV papier numérisé et vérifié obligatoire", "abm", "Remise sans PV",
    "select public.moto_remettre(" + lit(remise_base) + ")", False, "Procès-verbal")
pv = depot("abm", M1, "PV_REMISE", "document", tid="REM-02", label="Dépôt du PV signé numérisé M1")
act("REM-03", "PV non vérifié refusé", "abm", "Remise avec PV non vérifié",
    "select public.moto_remettre(" + lit({**remise_base, "pv_document_id": pv["id"]}) + ")", False, "Procès-verbal")
act("REM-04", "Vérification PV par un tiers", "bm", "BM vérifie le PV", f"select public.moto_document_verifier('{pv['id']}', 'CONFORME')")
act("REM-06", "Équipements de sécurité obligatoires", "abm", "Remise sans gilet",
    "select public.moto_remettre(" + lit({**remise_base, "pv_document_id": pv["id"], "equipements": {"CASQUE": True}}) + ")", False, "GILET")
act("REM-07", "Documents conformes obligatoires", "abm", "Remise de M4 (aucun document)",
    "select public.moto_remettre(" + lit({**remise_base, "moto_id": M4, "pv_document_id": pv["id"]}) + ")", False, "non conformes")
act("REM-07b", "État contradictoire obligatoire (AFLP FLEET §7.B)", "abm", "Remise de M1 sans état contradictoire",
    "select public.moto_remettre(" + lit({**remise_base, "pv_document_id": pv["id"]}) + ")", False, "état contradictoire")
def photos(moto, cats, prefixe="controle"):
    out = []
    for c in cats:
        pth = f"{moto}/{prefixe}/{uuid.uuid4()}.jpg"; put_object(pth); out.append({"path": pth, "categorie": c})
    return out
CATS_REMISE = ["AVANT", "ARRIERE", "GAUCHE", "DROITE", "COMPTEUR"]
etat = act("REM-07c", "État contradictoire avant remise", "abm", "ABM enregistre l'état de M1 avec 5 photos",
    "select public.moto_etat_remise_enregistrer(" + lit({"moto_id": M1, "items": items("ETAT_REMISE"), "compteur_km": 5,
      "date_remise_prevue": str(today), "photos": photos(M1, CATS_REMISE), "observations": "Rayure légère carénage gauche (fictif)"}) + ")", True, "EN_ATTENTE")
act("REM-07d", "Confirmation par le bénéficiaire uniquement", "abm", "ABM confirme à la place du bénéficiaire",
    f"select public.moto_etat_remise_confirmer('{etat['id']}', 'ACCEPTEE')", False, "bénéficiaire")
act("REM-07e", "Bénéficiaire accepte avec réserves", "uh_sak", "UH Sakassou accepte avec réserve",
    f"select public.moto_etat_remise_confirmer('{etat['id']}', 'ACCEPTEE_AVEC_RESERVES', 'Rayure notée au PV')", True, "RESERVES")
act("REM-05", "Permis vérifié obligatoire (migration 7 : permis enregistré et CONFORME, la case déclarative ne suffit plus)", "abm",
    "Remise avec la case « permis vérifié » cochée mais sans permis enregistré",
    "select public.moto_remettre(" + lit({**remise_base, "pv_document_id": pv["id"]}) + ")", False, "permis") if q("select to_regclass('public.moto_permis') is not null") == "t" else None
permis_pour("uh_sak")
act("REM-08", "Remise complète", "abm", "ABM enregistre la remise de M1",
    "select public.moto_remettre(" + lit({**remise_base, "pv_document_id": pv["id"]}) + ")", True, "REMISE")
check("REM-09", "Statut affectation REMISE, pas encore en service", "REMISE/false",
      f"select statut_affectation||'/'||(mise_en_service_at is not null) from public.moto_motos where id='{M1}'", "REMISE/false")
act("MES-01", "Chef d'unité : pas de saisie avant mise en service", "uh_sak", "Relevé km avant mise en service",
    "select public.moto_releve_km(" + lit({"moto_id": M1, "compteur_km": 6}) + ")", False, "non mise en service")
act("MES-02", "Mise en service réservée au BM", "abm", "ABM met en service", f"select public.moto_mettre_en_service('{M1}', 'Autorisation test')", False, "rôle")
act("MES-03", "Mise en service (décision distincte de la remise)", "bm", "BM autorise la circulation de M1",
    f"select public.moto_mettre_en_service('{M1}', 'Autorisation de circulation pilote')")
check("MES-04", "Moto autorisée à circuler", "t", f"select autorisee_a_circuler from public.moto_v_flotte where id='{M1}'", "t")

# ---------------------------------------------------------------------------
# D. Périmètres de lecture
# ---------------------------------------------------------------------------
act("PER-01", "Chef d'unité voit sa moto et son cluster", "uh_sak", "UH Sakassou lit la flotte", "select count(*) from public.moto_motos", True, "1")
act("PER-02", "Chef d'unité ne voit pas les autres clusters", "uh_bot", "UH Botro lit M1", f"select count(*) from public.moto_motos where id='{M1}'", True, "0")
act("PER-03", "Chef de zone : portée terrain globale (décision 17/09/2026)", "zh", "ZH lit la flotte", "select count(*) from public.moto_motos", True, "4")
act("PER-04", "Finance : lecture", "fin", "Finance lit la flotte", "select count(*) from public.moto_motos", True, "4")
act("PER-05", "Rôle non habilité : rien", "agent", "Agent recenseur lit la flotte", "select count(*) from public.moto_motos", True, "0")
act("PER-06", "Documents privés : périmètre", "uh_bot", "UH Botro lit les documents de M1", f"select count(*) from public.moto_documents where moto_id='{M1}'", True, "0")
act("PER-07", "Stockage : lecture hors périmètre refusée", "uh_bot", "UH Botro lit les fichiers de M1",
    f"select count(*) from storage.objects where bucket_id='moto-documents' and name like '{M1}/%'", True, "0")
act("PER-08", "Stockage : lecture affectataire", "uh_sak", "UH Sakassou lit les fichiers de M1",
    f"select count(*)>0 from storage.objects where bucket_id='moto-documents' and name like '{M1}/%'", True, "t")
act("PER-09", "Journal : non visible du Chef d'unité", "uh_sak", "UH lit le journal", "select count(*) from public.moto_journal", True, "0")

# ---------------------------------------------------------------------------
# E. Relevés, contrôles avant départ, hors connexion (idempotence)
# ---------------------------------------------------------------------------
op1 = str(uuid.uuid4())
act("KM-01", "Relevé kilométrique", "uh_sak", "Relevé 40 km", "select public.moto_releve_km(" + lit({"moto_id": M1, "compteur_km": 40, "client_op_id": op1}) + ")")
act("KM-02", "Idempotence : rejeu du même relevé", "uh_sak", "Rejeu client_op_id identique",
    "select public.moto_releve_km(" + lit({"moto_id": M1, "compteur_km": 40, "client_op_id": op1}) + ")", True, "doublon")
check("KM-03", "Pas de doublon en base", "1", f"select count(*) from public.moto_releves_km where client_op_id='{op1}'", "1")
act("KM-04", "Compteur décroissant refusé (conflit)", "uh_sak", "Relevé 30 km après 40 km",
    "select public.moto_releve_km(" + lit({"moto_id": M1, "compteur_km": 30}) + ")", False, "CONFLIT_COMPTEUR")
act("KM-05", "Identifiant d'opération d'un autre compte", "zh", "ZH réutilise le client_op_id de l'UH",
    "select public.moto_releve_km(" + lit({"moto_id": M1, "compteur_km": 41, "client_op_id": op1}) + ")", False, "autre compte")
act("KM-06", "Chef d'unité : pas de saisie sur une moto non affectée", "uh_bro", "UH Brobo relève M1",
    "select public.moto_releve_km(" + lit({"moto_id": M1, "compteur_km": 45}) + ")", False, "périmètre")
act("CTL-01", "Contrôle avant départ APTE", "uh_sak", "Contrôle OK",
    "select public.moto_controle_depart(" + lit({"moto_id": M1, "items": items("AVANT_DEPART"), "compteur_km": 41, "client_op_id": str(uuid.uuid4())}) + ")", True, "APTE")
act("CTL-02", "Contrôle : points invalides refusés", "uh_sak", "Contrôle sans points",
    "select public.moto_controle_depart(" + lit({"moto_id": M1, "items": [], "compteur_km": 41}) + ")", False, "vide")

# Lot de synchronisation (rejeu, rejet, ordre)
batch_ok = str(uuid.uuid4()); batch_bad = str(uuid.uuid4())
batch = [{"client_op_id": batch_ok, "type": "RELEVE_KM", "payload": {"moto_id": M1, "compteur_km": 55}},
         {"client_op_id": batch_bad, "type": "RELEVE_KM", "payload": {"moto_id": M1, "compteur_km": 1}},
         {"client_op_id": "pas-un-uuid", "type": "RELEVE_KM", "payload": {"moto_id": M1, "compteur_km": 56}},
         {"client_op_id": str(uuid.uuid4()), "type": "DOTATION_REMETTRE", "payload": {}}]
r = act("SYN-01", "Synchronisation par lot", "uh_sak", "Lot : 1 valide, 1 conflit, 1 id invalide, 1 type interdit",
        "select public.moto_sync_batch(" + lit(batch) + ")::text")
try:
    res = json.loads(r); statuts = [x["statut"] for x in res]
except Exception: statuts = []
record("SYN-02", "Statuts « Synchronisé » / « Rejeté »", "uh_sak", "Statuts renvoyés par opération",
       "SYNCHRONISE,REJETE,REJETE,REJETE", statuts == ["SYNCHRONISE", "REJETE", "REJETE", "REJETE"], ",".join(statuts))
r2 = act("SYN-03", "Rejeu du lot sans doublon", "uh_sak", "Même lot renvoyé", "select public.moto_sync_batch(" + lit(batch[:2]) + ")::text")
try:
    res2 = json.loads(r2); flags = [(x["statut"], bool(x.get("doublon"))) for x in res2]
except Exception: flags = []
record("SYN-04", "Idempotence du lot", "uh_sak", "Le rejeu renvoie les mêmes statuts marqués doublon",
       "[SYNCHRONISE doublon, REJETE doublon]", flags == [("SYNCHRONISE", True), ("REJETE", True)], str(flags))
check("SYN-05", "Un seul relevé 55 km en base", "1", f"select count(*) from public.moto_releves_km where moto_id='{M1}' and compteur_km=55", "1")
act("SYN-06", "Lot limité", "uh_sak", "Lot de 51 opérations",
    "select public.moto_sync_batch(" + lit([{"client_op_id": str(uuid.uuid4()), "type": "RELEVE_KM", "payload": {}}] * 51) + ")", False, "50")

# ---------------------------------------------------------------------------
# F. Budgets, dotations, Mobile Money, rapprochement
# ---------------------------------------------------------------------------
per = {"periode_debut": str(today - datetime.timedelta(days=1)), "periode_fin": str(today + datetime.timedelta(days=30))}
act("BUD-01", "Budget : Chef d'unité interdit", "uh_sak", "UH propose un budget",
    "select public.moto_budget_proposer(" + lit({**per, "beneficiaire_id": U["uh_sak"], "montant_autorise": 30000, "motif": "test refus"}) + ")", False, "rôle")
b_abm = act("BUD-02", "Budget proposé par l'ABM", "abm", "ABM propose 30 000 FCFA (fictif)",
            "select public.moto_budget_proposer(" + lit({**per, "moto_id": M1, "beneficiaire_id": U["uh_sak"], "montant_autorise": 30000, "motif": "Dotation pilote test"}) + ")", True, "PROPOSE")
act("BUD-03", "Dotation impossible sans budget autorisé", "abm", "Remise sur budget proposé",
    "select public.moto_dotation_remettre(" + lit({"budget_id": b_abm["id"], "mode_paiement": "ESPECES", "montant_remis": 10000}) + ")", False, "budget autorisé")
act("BUD-04", "Validation du budget par le BM", "bm", "BM valide le budget", f"select public.moto_budget_decider('{b_abm['id']}', 'VALIDE', null)", True, "VALIDE")
d1 = act("DOT-01", "Dotation espèces", "abm", "ABM remet 10 000 FCFA en espèces",
         "select public.moto_dotation_remettre(" + lit({"budget_id": b_abm["id"], "mode_paiement": "ESPECES", "montant_remis": 10000, "reference": "BON-TEST-01"}) + ")", True, "REMISE_DECLAREE")
act("DOT-02", "Mobile Money : référence obligatoire", "abm", "Mobile Money sans référence",
    "select public.moto_dotation_remettre(" + lit({"budget_id": b_abm["id"], "mode_paiement": "MOBILE_MONEY", "montant_remis": 10000}) + ")", False, "Référence")
d2 = act("DOT-03", "Mobile Money : frais distincts", "abm", "Mobile Money 10 000 + 100 de frais",
         "select public.moto_dotation_remettre(" + lit({"budget_id": b_abm["id"], "mode_paiement": "MOBILE_MONEY", "operateur_mobile_money": "OPERATEUR FICTIF",
                                                         "montant_remis": 10000, "frais_transaction": 100, "reference": "MM-TEST-0001"}) + ")")
d3 = act("DOT-04", "Mobile Money échoué", "abm", "Mobile Money 5 000",
         "select public.moto_dotation_remettre(" + lit({"budget_id": b_abm["id"], "mode_paiement": "MOBILE_MONEY", "montant_remis": 5000, "reference": "MM-TEST-0002"}) + ")")
act("DOT-05", "Dépassement de budget refusé", "abm", "Remise de 10 000 au-delà de 30 000",
    "select public.moto_dotation_remettre(" + lit({"budget_id": b_abm["id"], "mode_paiement": "ESPECES", "montant_remis": 10000}) + ")", False, "Dépassement")
act("DOT-06", "Transaction échouée", "abm", "ABM déclare l'échec MM-TEST-0002", f"select public.moto_dotation_signaler_echec('{d3['id']}', 'Transaction non aboutie')", True, "ECHOUEE")
act("DOT-07", "Seul le bénéficiaire confirme", "abm", "ABM confirme à la place de l'UH",
    "select public.moto_dotation_confirmer(" + lit({"dotation_id": d1["id"], "montant_recu": 10000}) + ")", False, "bénéficiaire")
act("DOT-08", "Échec non confirmable", "uh_sak", "UH confirme la transaction échouée",
    "select public.moto_dotation_confirmer(" + lit({"dotation_id": d3["id"], "montant_recu": 5000}) + ")", False, "ECHOUEE")
act("DOT-09", "Confirmation de réception", "uh_sak", "UH confirme 10 000 espèces",
    "select public.moto_dotation_confirmer(" + lit({"dotation_id": d1["id"], "montant_recu": 10000, "client_op_id": str(uuid.uuid4())}) + ")", True, "CONFIRMEE")
act("DOT-10", "Écart de réception = contestation", "uh_sak", "UH déclare 9 900 reçus sur 10 000 MM",
    "select public.moto_dotation_confirmer(" + lit({"dotation_id": d2["id"], "montant_recu": 9900, "motif": "Montant net reçu inférieur"}) + ")", True, "CONTESTEE")

# Carburant (plein à plein) : 55 km actuel. Plein initial à 60, partiel à 120, complet à 160.
def carb(tid, user, km, litres, montant, plein, fin="DOTATION", justif=True, expect=True, contains=None, label=None, at=None):
    path = None
    if justif:
        path = f"{M1}/justificatif/{uuid.uuid4()}.jpg"; put_object(path)
    p = {"moto_id": M1, "date_achat": at or ts(), "compteur_km": km, "litres": litres, "montant": montant,
         "plein_complet": plein, "financement": fin, "client_op_id": str(uuid.uuid4())}
    if path: p["justificatif_path"] = path
    return act(tid, "Carburant", user, label or f"Achat {litres} L à {km} km", "select public.moto_carburant_declarer(" + lit(p) + ")", expect, contains)

act("CAR-01", "Plein/partiel obligatoire", "uh_sak", "Achat sans préciser plein",
    "select public.moto_carburant_declarer(" + lit({"moto_id": M1, "date_achat": ts(), "compteur_km": 60, "litres": 2, "montant": 1700}) + ")", False, "plein")
c1 = carb("CAR-02", "uh_sak", 60, 3.0, 2550, True, label="Plein initial complet (référence)")
c2 = carb("CAR-03", "uh_sak", 120, 1.5, 1275, False, label="Plein partiel")
c3 = carb("CAR-04", "uh_sak", 160, 2.0, 1700, True, label="Plein complet de contrôle")
check("CAR-05", "Consommation plein à plein vérifiable", "100×(1,5+2,0)/(160−60) = 3,50 L/100 km",
      "select l_100km from public.moto_v_conso_intervalles where moto_id='" + M1 + "'", "3.50")
check("CAR-06", "Plein initial non compté deux fois", "Litres de l'intervalle = 3,50 (plein initial de 3 L exclu)",
      "select litres from public.moto_v_conso_intervalles where moto_id='" + M1 + "'", "3.50")
check("CAR-07", "Seuils provisoires : 3,50 < 3,6 → NORMAL", "NORMAL", "select statut_alerte from public.moto_v_conso_intervalles where moto_id='" + M1 + "'", "NORMAL")
check("CAR-08", "Données insuffisantes → Non disponible", "M3 : l_100km NULL", f"select coalesce(l_100km::text,'NULL') from public.moto_v_conso_moto where moto_id='{M3}'", "NULL")
carb("CAR-09", "uh_sak", 150, 1.0, 850, True, expect=False, contains="CONFLIT_COMPTEUR", label="Achat daté après un relevé supérieur")
c5 = carb("CAR-10", "uh_sak", 200, 2.5, 2125, True, fin="AVANCE_PERSONNELLE", label="Avance personnelle de l'agent")
act("JUS-01", "Auto-vérification interdite", "uh_sak", "UH vérifie son justificatif", f"select public.moto_justificatif_verifier('{c1['id']}', 'VERIFIE')", False, "rôle")
for k, c in (("1", c1), ("2", c2), ("3", c3), ("5", c5)):
    act(f"JUS-0{int(k)+1}", "Vérification des justificatifs", "fin", f"Finance vérifie l'achat {k}", f"select public.moto_justificatif_verifier('{c['id']}', 'VERIFIE')", True, "VERIFIE")
check("RAP-01", "Rapprochement : remis / reçu / justifié / à apurer",
      "remis 20000 · reçu 19900 (10000 + 9900 en écart) · frais 100 · écart 100 · justifié 5525 · à apurer 14375",
      f"select dotations_remises||'·'||dotations_recues||'·'||frais_mobile_money||'·'||ecarts_contestes||'·'||justifies_verifies||'·'||avance_a_apurer "
      f"from public.moto_v_rapprochement where beneficiaire_id='{U['uh_sak']}'", "20000·19900·100·100·5525·14375")
act("RES-01", "Restitution > avance refusée", "abm", "Restitution de 20 000",
    "select public.moto_restitution_enregistrer(" + lit({"beneficiaire_id": U["uh_sak"], "montant": 20000}) + ")", False, "supérieure")
act("RES-02", "Restitution d'espèces restantes", "abm", "Restitution de 475",
    "select public.moto_restitution_enregistrer(" + lit({"beneficiaire_id": U["uh_sak"], "montant": 475, "mode_paiement": "ESPECES"}) + ")", True, "13900")
rb = act("RBT-01", "Remboursement d'avance personnelle", "abm", "ABM demande le remboursement de l'avance",
         "select public.moto_remboursement_demander(" + lit({"beneficiaire_id": U["uh_sak"], "carburant_ids": [c5["id"]]}) + ")", True, "2125")
act("RBT-02", "Pas de double remboursement", "abm", "Deuxième demande sur le même achat",
    "select public.moto_remboursement_demander(" + lit({"beneficiaire_id": U["uh_sak"], "carburant_ids": [c5["id"]]}) + ")", False, "non encore remboursée")
act("RBT-03", "Finance simple : pas de validation", "fin", "Finance valide le remboursement", f"select public.moto_remboursement_decider('{rb['id']}', 'VALIDE')", False, "Finance Manager")
act("RBT-04", "Validation par le Finance Manager", "fm", "Finance Manager valide", f"select public.moto_remboursement_decider('{rb['id']}', 'VALIDE')", True, "VALIDE")
act("RBT-05", "Paiement déclaré (non exécuté)", "fin", "Finance déclare le paiement MM",
    f"select public.moto_remboursement_declarer_paye('{rb['id']}', 'MOBILE_MONEY', 'MM-TEST-RBT-1')", True, "PAYE_DECLARE")
check("RAP-02", "Pas de double comptage dotation/remboursement", "reste à rembourser 0 · remboursé 2125 · à apurer 13900",
      f"select reste_a_rembourser||'·'||remboursements_valides||'·'||avance_a_apurer from public.moto_v_rapprochement where beneficiaire_id='{U['uh_sak']}'", "0·2125·13900")

# Corrections sensibles (quatre yeux)
cr = act("COR-01", "Correction : demande ABM", "abm", "ABM demande la correction des frais MM",
         "select public.moto_correction_demander(" + lit({"cible_table": "moto_dotations", "cible_id": d2["id"], "champ": "frais_transaction",
                                                         "nouvelle_valeur": "150", "motif": "Relevé opérateur : frais réels 150"}) + ")", True, "DEMANDEE")
act("COR-02", "Champ non corrigeable", "zh", "ZH corrige un montant de dotation",
    "select public.moto_correction_demander(" + lit({"cible_table": "moto_dotations", "cible_id": d2["id"], "champ": "montant_remis",
                                                    "nouvelle_valeur": "1", "motif": "tentative non autorisee"}) + ")", False, "non corrigeable")
act("COR-03", "ABM ne valide pas une correction", "abm", "ABM valide sa propre correction", f"select public.moto_correction_decider('{cr['id']}', 'APPLIQUEE')", False, "rôle")
act("COR-04", "Validation BM", "bm", "BM applique la correction", f"select public.moto_correction_decider('{cr['id']}', 'APPLIQUEE', 'Conforme au relevé')", True, "APPLIQUEE")
check("COR-05", "Valeur corrigée et journal avec valideur", "150 / valideur BM",
      f"select (select frais_transaction from public.moto_dotations where id='{d2['id']}')||'/'||(select count(*) from public.moto_journal where table_nom='moto_dotations' "
      f"and enregistrement_id='{d2['id']}' and valideur='{U['bm']}')", "150/1")
cr2 = act("COR-06", "BM initie une correction", "bm", "BM demande correction compteur relevé",
          "select public.moto_correction_demander(" + lit({"cible_table": "moto_carburant", "cible_id": c3["id"], "champ": "litres",
                                                          "nouvelle_valeur": "2.2", "motif": "Erreur de saisie constatée sur le ticket"}) + ")")
act("COR-07", "BM ne s'auto-approuve pas", "bm", "BM valide sa propre demande", f"select public.moto_correction_decider('{cr2['id']}', 'APPLIQUEE')", False, "Auto-approbation")
act("COR-08", "Validation par la Direction", "gm", "General Manager rejette", f"select public.moto_correction_decider('{cr2['id']}', 'REJETEE', 'Ticket illisible, maintenir')", True, "REJETEE")

# ---------------------------------------------------------------------------
# G. Incidents critiques, immobilisation, remise en service
# ---------------------------------------------------------------------------
crit_items = items("AVANT_DEPART", ko=("FREIN_AVANT",))
r = act("INC-01", "Anomalie critique au départ → immobilisation", "uh_sak", "Contrôle avant départ freins KO",
        "select public.moto_controle_depart(" + lit({"moto_id": M1, "items": crit_items, "compteur_km": 205, "client_op_id": str(uuid.uuid4())}) + ")", True, "INAPTE")
check("INC-02", "Moto immobilisée sans attendre", "IMMOBILISEE / non autorisée", f"select statut_technique||'/'||(select autorisee_a_circuler from public.moto_v_flotte where id='{M1}') from public.moto_motos where id='{M1}'", "IMMOBILISEE/false")
inc = q(f"select id from public.moto_incidents where moto_id='{M1}' order by declare_at desc limit 1")
act("INC-03", "Chef d'unité ne pilote pas le circuit", "uh_sak", "UH avance l'incident", f"select public.moto_incident_avancer('{inc}', 'DIAGNOSTIC', 'tentative')", False, "rôle")
act("INC-04", "Transition interdite", "zh", "Saut direct vers REMIS_EN_SERVICE", f"select public.moto_incident_avancer('{inc}', 'REMIS_EN_SERVICE', 'saut interdit')", False, "Transition")
act("INC-05", "Diagnostic", "zh", "ZH : diagnostic", f"select public.moto_incident_avancer('{inc}', 'DIAGNOSTIC', 'Plaquettes usées')")
act("INC-06", "M6 : l'étape « dépense autorisée » exige une autorisation BM existante", "zh", "ZH passe à AUTORISATION_DEPENSE sans dossier autorisé",
    f"select public.moto_incident_avancer('{inc}', 'AUTORISATION_DEPENSE', 'Remplacement plaquettes')", False, "Branch Manager")
act("INC-07", "M6 : aucun montant saisi dans le circuit incident", "zh", "ZH tente d'autoriser 8 000 dans l'incident",
    f"select public.moto_incident_avancer('{inc}', 'AUTORISATION_DEPENSE', 'Remplacement plaquettes', 8000)", False, "Aucun montant")
mt_inc, au_inc = dossier_autorise("INC-07x", M1, 8000, incident=inc)
act("INC-08", "Étape « dépense autorisée » constatée après décision BM", "zh", "ZH constate l'autorisation BM", f"select public.moto_incident_avancer('{inc}', 'AUTORISATION_DEPENSE', 'Autorisation BM du dossier constatée')")
act("INC-08b", "Engagement dans le plafond", "abm", "ABM programme 8 000",
    "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt_inc, "montant_engage": 8000, "date_prevue": str(today)}) + ")", True, "PROGRAMMEE")
act("INC-08c", "Début des travaux", "abm", "ABM démarre", f"select public.moto_maintenance_demarrer('{mt_inc}', null, current_date)", True, "EN_COURS")
act("INC-09", "Réparation", "zh", "ZH : réparation", f"select public.moto_incident_avancer('{inc}', 'REPARATION', 'Garage fictif intervient')")
act("INC-09b", "Travaux déclarés effectués", "abm", "ABM déclare les travaux",
    "select public.moto_maintenance_terminer(" + lit({"maintenance_id": mt_inc, "compteur_km": 206, "date_realisation": str(today), "travaux": travaux_realises(mt_inc)}) + ")", True, "TERMINEE")
act("INC-10", "Contrôle", "zh", "ZH : étape contrôle", f"select public.moto_incident_avancer('{inc}', 'CONTROLE', 'Contrôle à réaliser')")
act("INC-11", "Remise en service exige un contrôle APTE", "zh", "Remise en service sans contrôle",
    f"select public.moto_incident_avancer('{inc}', 'REMIS_EN_SERVICE', 'tentative sans controle')", False, "contrôle")
act("INC-12", "Contrôle de remise en service", "abm", "ABM enregistre le contrôle APTE",
    "select public.moto_controle_remise_en_service(" + lit({"moto_id": M1, "items": items("REMISE_EN_SERVICE"), "intervenant_nom": "MECANICIEN FICTIF", "compteur_km": 206}) + ")", True, "APTE")
act("INC-12b", "M6 : remise en service bloquée tant que les travaux ne sont pas contrôlés", "zh", "Remise en service, travaux non contrôlés",
    f"select public.moto_incident_avancer('{inc}', 'REMIS_EN_SERVICE', 'Freins conformes')", False, "travaux")
act("INC-12c", "Contrôle technique des travaux par un tiers", "zh", "ZH contrôle les travaux", f"select public.moto_maintenance_controler('{mt_inc}', 'CONFORME', 'Freinage vérifié après remplacement')", True, "CONTROLEE")
act("INC-13a", "M6 : le contrôleur des travaux ne remet pas lui-même en service", "zh", "ZH (contrôleur des travaux) remet en service", f"select public.moto_incident_avancer('{inc}', 'REMIS_EN_SERVICE', 'Freins conformes')", False, "Séparation")
act("INC-13", "Remise en service par une personne indépendante", "bm", "BM remet en service", f"select public.moto_incident_avancer('{inc}', 'REMIS_EN_SERVICE', 'Freins conformes')")
act("INC-13b", "Immobilisation de maintenance levée par une personne indépendante", "bm", "BM lève l'immobilisation de maintenance",
    f"select public.moto_lever_immobilisation((select id from public.moto_immobilisations where source_type='MAINTENANCE' and source_id='{mt_inc}' and fin is null), 'Travaux contrôlés et contrôle APTE')", True, "true")
act("INC-14", "Clôture (sans montant : le coût est celui du dossier)", "zh", "ZH clôt l'incident", f"select public.moto_incident_avancer('{inc}', 'CLOS', 'Incident clos')")
act("INC-14b", "Facture déposée", "abm", "ABM dépose la facture 8 000",
    "select public.moto_facture_deposer(" + lit({"maintenance_id": mt_inc, "numero_facture": "F-TEST-INC-01", "date_facture": str(today), "montant": 8000, "document_path": piece(M1, "facture")}) + ")", True, "DEPOSEE")
act("INC-14c", "Facture vérifiée par la Finance", "fin", "Finance vérifie",
    f"select public.moto_facture_verifier((select id from public.moto_factures where numero_facture='F-TEST-INC-01'), 'VERIFIEE', null)", True, "VERIFIEE")
check("INC-15", "Moto de nouveau APTE", "APTE", f"select statut_technique from public.moto_motos where id='{M1}'", "APTE")
check("INC-16", "Historique complet du circuit", "SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS",
      f"select string_agg(etape, ',' order by id) from public.moto_incident_etapes where incident_id='{inc}' and note not like 'Compteur%'",
      "SIGNALE,IMMOBILISEE,DIAGNOSTIC,AUTORISATION_DEPENSE,REPARATION,CONTROLE,REMIS_EN_SERVICE,CLOS")
r = act("INC-17", "Accident : registre AFLP lié (pas de doublon de saisie)", "uh_sak", "UH déclare un accident",
        "select public.moto_incident_declarer(" + lit({"moto_id": M1, "type_incident": "ACCIDENT", "gravite": "MAJEURE",
              "description": "Chute à faible vitesse, scénario fictif de test", "client_op_id": str(uuid.uuid4())}) + ")", True, "INC-")
check("INC-18", "Incident AFLP créé et relié", "ACCIDENT_MOTO", f"select incident_type from public.aflp_incidents where evidence_ref like 'moto_incidents:%' limit 1", "ACCIDENT_MOTO")
check("INC-19", "Accident = immobilisation", "IMMOBILISEE", f"select statut_technique from public.moto_motos where id='{M1}'", "IMMOBILISEE")
act("INC-20", "Traçabilité : relevé km accepté pendant immobilisation", "uh_sak", "Relevé km pendant immobilisation",
    "select public.moto_releve_km(" + lit({"moto_id": M1, "compteur_km": 207}) + ")")

# ---------------------------------------------------------------------------
# H. Maintenance, échéances, pneus
# ---------------------------------------------------------------------------
mt = act("MNT-01", "Demande d'entretien terrain ; champs de décision injectés ignorés", "uh_sak", "UH demande une vidange (statut AUTORISEE injecté)",
         "select public.moto_maintenance_demander(" + lit({"moto_id": M1, "type_maintenance": "VIDANGE", "description": "Vidange à prévoir", "cout_estime": 5000,
               "statut": "AUTORISEE", "montant_autorise": 5000, "client_op_id": str(uuid.uuid4())}) + ")", True, "DEMANDEE")
act("MNT-02", "M6 : le Chef de zone ne décide plus une maintenance", "zh", "ZH autorise (ancienne fonction)", f"select public.moto_maintenance_decider('{mt['id']}', 'AUTORISEE')", False, "rôle")
act("MNT-02b", "M6 : l'ABM ne décide pas une maintenance", "abm", "ABM autorise (ancienne fonction)", f"select public.moto_maintenance_decider('{mt['id']}', 'AUTORISEE')", False, "rôle")
act("MNT-02c", "M6 : ancienne décision sans montant neutralisée, même pour le BM", "bm", "BM (ancienne fonction)", f"select public.moto_maintenance_decider('{mt['id']}', 'AUTORISEE')", False, "remplacée")
act("MNT-02d", "Devis du garage", "abm", "ABM enregistre le devis 5 000",
    "select public.moto_maintenance_devis(" + lit({"maintenance_id": mt["id"], "garage_id": garage(), "devis_montant": 5000, "devis_path": piece(M1, "devis"),
          "travaux": [{"operation_code": "VIDANGE", "libelle": "Vidange huile moteur"}], "justification": "Échéance de vidange signalée"}) + ")", True, "DEVIS_RECU")
au = act("MNT-02e", "Soumission au BM", "abm", "ABM soumet 5 000",
         "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mt["id"], "objet": "TRAVAUX", "montant_demande": 5000, "perimetre": "Vidange selon devis",
               "consequence_report": "Usure moteur"}) + ")", True, "EN_ATTENTE")
act("MNT-02f", "Autorisation individuelle du BM", "bm", "BM autorise 5 000", f"select public.moto_autorisation_decider('{au['id']}', 'AUTORISEE', 5000, null)", True, "AUTORISEE")
act("MNT-03", "Engagement au-delà du plafond refusé", "abm", "ABM engage 6 000",
    "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt["id"], "montant_engage": 6000, "date_prevue": str(today)}) + ")", False, "plafond")
act("MNT-03b", "Programmation dans le plafond", "abm", "ABM engage 5 000",
    "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt["id"], "montant_engage": 5000, "date_prevue": str(today)}) + ")", True, "PROGRAMMEE")
act("MNT-04", "Démarrage → immobilisation", "abm", "ABM démarre au garage fictif", f"select public.moto_maintenance_demarrer('{mt['id']}', 'GARAGE FICTIF')")
check("MNT-05", "Statut EN_REPARATION", "EN_REPARATION", f"select statut_technique from public.moto_motos where id='{M1}'", "EN_REPARATION")
act("MNT-06", "M6 : pas de remise en circulation par case cochée", "abm", "Fin avec remettre_en_service=true",
    "select public.moto_maintenance_terminer(" + lit({"maintenance_id": mt["id"], "remettre_en_service": True, "compteur_km": 208, "date_realisation": str(today), "travaux": travaux_realises(mt["id"])}) + ")", False, "distincte")
act("MNT-07", "Facture déposée (pièce financière privée)", "abm", "ABM dépose la facture",
    "select public.moto_facture_deposer(" + lit({"maintenance_id": mt["id"], "numero_facture": "F-TEST-MNT-01", "date_facture": str(today), "montant": 5000, "document_path": piece(M1, "facture")}) + ")", True, "DEPOSEE")
act("MNT-08", "Travaux déclarés effectués", "abm", "Fin des travaux",
    "select public.moto_maintenance_terminer(" + lit({"maintenance_id": mt["id"], "compteur_km": 208, "date_realisation": str(today), "travaux": travaux_realises(mt["id"])}) + ")", True, "TERMINEE")
check("MNT-09", "Immobilisation accident toujours ouverte", "IMMOBILISEE", f"select statut_technique from public.moto_motos where id='{M1}'", "IMMOBILISEE")
act("MNT-10", "M6 : ancien paramétrage global neutralisé", "bm", "BM paramètre une règle globale",
    "select public.moto_regle_maintenance_definir(" + lit({"code": "VIDANGE", "intervalle_km": 1000, "source": "PARAMETRE_ANAGROCI", "actif": True, "motif": "Paramètre de test local"}) + ")", False, "remplacé")
check("MNT-11", "Valeurs du mandat : 3 brouillons « hypothèse », aucun approuvé", "3/0",
      "select count(*) filter (where statut='BROUILLON' and nature_source='HYPOTHESE')||'/'||count(*) filter (where statut='APPROUVEE') from public.moto_regles_versions", "3/0")
check("MNT-12", "Moto sans modèle technique : diagnostic initial à établir", "DIAGNOSTIC_INITIAL_REQUIS",
      f"select statut from public.moto_v_echeances where moto_id='{M1}' and regle='VIDANGE'", "DIAGNOSTIC_INITIAL_REQUIS")
check("MNT-13", "Anciennes règles globales inactives", "3", "select count(*) from public.moto_regles_maintenance where not actif", "3")
act("MNT-14", "Contrôle des travaux par un tiers", "zh", "ZH contrôle la vidange", f"select public.moto_maintenance_controler('{mt['id']}', 'CONFORME', 'Niveau et étanchéité vérifiés')", True, "CONTROLEE")
act("MNT-15", "Facture vérifiée par la Finance", "fin", "Finance vérifie", f"select public.moto_facture_verifier((select id from public.moto_factures where numero_facture='F-TEST-MNT-01'), 'VERIFIEE', null)", True, "VERIFIEE")

act("PNE-00", "M6 : achat de pneu payant sans facture autorisée refusé", "abm", "Pneu à 12 000 sans facture",
    "select public.moto_pneu_creer(" + lit({"code": "PN-TEST-00", "marque": "MARQUE FICTIVE", "dimensions": "2.75-18", "cout_achat": 12000}) + ")", False, "Branch Manager")
mt_pn, au_pn = dossier_autorise("PNE-00x", M1, 13000, type_m="PNEUMATIQUE", op="PNEUMATIQUE")
run_as("abm", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt_pn, "montant_engage": 13000, "date_prevue": str(today)}) + ")")
act("PNE-00y", "Facture du fournisseur de pneus", "abm", "Facture 13 000", "select public.moto_facture_deposer(" + lit({"maintenance_id": mt_pn, "numero_facture": "F-TEST-PNEU-01",
    "date_facture": str(today), "montant": 13000, "document_path": piece(M1, "facture")}) + ")", True, "DEPOSEE")
fa_pn = q("select id from public.moto_factures where numero_facture='F-TEST-PNEU-01'")
act("PNE-00z", "Facture vérifiée", "fin", "Finance vérifie", f"select public.moto_facture_verifier('{fa_pn}', 'VERIFIEE', null)", True, "VERIFIEE")
pn = act("PNE-01", "Pneu : identité propre", "abm", "Entrée en stock d'un pneu fictif",
         "select public.moto_pneu_creer(" + lit({"code": "PN-TEST-01", "marque": "MARQUE FICTIVE", "dimensions": "2.75-18", "cout_achat": 12000, "facture_id": fa_pn}) + ")")
pose = act("PNE-02", "Montage", "abm", "Montage arrière à 208 km", "select public.moto_pneu_poser(" + lit({"pneu_id": pn["id"], "moto_id": M1, "position": "ARRIERE", "pose_km": 208}) + ")")
pn2 = act("PNE-03a", "Pneu : identité propre", "abm", "Entrée en stock d'un second pneu fictif",
          "select public.moto_pneu_creer(" + lit({"code": "PN-TEST-02", "marque": "MARQUE FICTIVE", "dimensions": "2.75-18"}) + ")")
act("PNE-03", "Un pneu par position", "abm", "Second pneu à la même position",
    "select public.moto_pneu_poser(" + lit({"pneu_id": pn2["id"], "moto_id": M1, "position": "ARRIERE", "pose_km": 208}) + ")", False, "déjà monté")
act("PNE-04", "Réparation tracée", "zh", "Réparation crevaison", "select public.moto_pneu_reparation(" + lit({"pneu_id": pn["id"], "moto_id": M1, "cout": 1000, "description": "Crevaison", "facture_id": fa_pn}) + ")")
act("PNE-05", "Dépose et réforme", "abm", "Dépose à 708 km, réforme",
    "select public.moto_pneu_deposer(" + lit({"pose_id": pose["id"], "depose_km": 708, "motif_depose": "Usure fictive", "destination": "REFORME"}) + ")", True, "500")
check("PNE-06", "Coût par km sur données réelles", "(12000+1000)/500 = 26.00 FCFA/km", "select fcfa_km_vie_complete from public.moto_v_pneus where code='PN-TEST-01'", "26.00")

# ---------------------------------------------------------------------------
# I. Indicateurs, formation, régression
# ---------------------------------------------------------------------------
# Indépendant du jour d'exécution : un dimanche (hors 6 jours opérationnels), une moto mise en service le jour même
# n'a encore aucun jour opérationnel prévu → « Non disponible » est la bonne réponse (constaté le dimanche 01/11/2026).
if int(q("select extract(isodow from current_date)::int")) > int(float(q("select private.moto_param('jours_operationnels_semaine')"))):
    check("KPI-01", "Disponibilité : aucun jour opérationnel écoulé (dimanche) → Non disponible", "aucune ligne", f"select count(*) from public.moto_v_disponibilite where moto_id='{M1}'", "0")
else:
    check("KPI-01", "Disponibilité : dénominateur présent", "taux calculé (non NULL)", f"select (taux_disponibilite_pct is not null)::text from public.moto_v_disponibilite where moto_id='{M1}'", "true")
check("KPI-02", "Disponibilité : moto non en service → absente (Non disponible)", "0", f"select count(*) from public.moto_v_disponibilite where moto_id='{M3}'", "0")
act("KPI-03", "M6 : coût = factures vérifiées (5 000 + 8 000 + pneus 13 000) ; pneus et incident non recomptés", "bm", "Lecture du coût/km de M1",
    f"select cout_carburant_verifie||'+'||cout_maintenance||'+'||cout_pneus||'+'||cout_incidents from public.moto_v_cout_km where moto_id='{M1}'", True, "7650+26000+0+0")
act("FOR-01", "Formation : résultat", "uh_sak", "UH réussit un quiz 4/5",
    "select public.moto_formation_enregistrer(" + lit({"module_code": "CONTROLE_SECURITE", "score": 4, "total": 5, "client_op_id": str(uuid.uuid4())}) + ")", True, "true")
act("FOR-02", "Formation : score invalide", "uh_sak", "Score 6/5", "select public.moto_formation_enregistrer(" + lit({"module_code": "X", "score": 6, "total": 5}) + ")", False, "invalide")
check("REG-01", "Contrainte de rôles FBMS inchangée", "20 rôles", "select array_length(regexp_split_to_array(pg_get_constraintdef(oid), '::text,'),1) from pg_constraint where conname='profils_role_check'", "20")
check("REG-02", "Fonctions FBMS existantes intactes (md5 réplique)", "aucune fonction FBMS existante redéfinie",
      "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('est_bm','est_actif','mon_role','fbms_role','portee_terrain_globale') and p.prosrc like '%moto%'", "0")
check("REG-03", "Toutes les tables moto_* sous RLS", "0 table sans RLS", "select count(*) from pg_tables where schemaname='public' and tablename like 'moto\\_%' and not rowsecurity", "0")
check("REG-04", "Aucune fonction moto exécutable par anon", "0",
      "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'moto\\_%' and has_function_privilege('anon', p.oid, 'execute')", "0")
check("REG-05", "Aucune table moto écrivable par authenticated", "0",
      "select count(*) from pg_tables where schemaname='public' and tablename like 'moto\\_%' and (has_table_privilege('authenticated', 'public.'||tablename, 'insert') or has_table_privilege('authenticated', 'public.'||tablename, 'update') or has_table_privilege('authenticated', 'public.'||tablename, 'delete'))", "0")
check("REG-06", "Fonctions SECURITY DEFINER avec search_path figé", "0 sans search_path",
      "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'moto\\_%' and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')", "0")

check("REG-07", "Fonctions internes d'écriture non appelables directement", "0",
      "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('moto_enregistrer_km','moto_ouvrir_immobilisation','moto_op_enregistrer','moto_recalculer_statuts','moto_charger','moto_controle_remise','moto_solde_a_apurer') and has_function_privilege('authenticated', p.oid, 'execute')", "0")
act("REG-08", "Contournement : appel direct d'une fonction interne", "uh_sak", "UH ouvre/ferme une immobilisation en direct",
    f"select private.moto_ouvrir_immobilisation('{M1}', 'contournement', 'DECISION', null)", False, "permission")
act("REG-09", "Contournement : lever une immobilisation sans contrôle", "zh", "ZH lève l'immobilisation accident par la voie générique",
    f"select public.moto_lever_immobilisation((select id from public.moto_immobilisations where moto_id='{M1}' and fin is null limit 1), 'tentative de levee')", False, "circuit")
act("BEN-01", "Liste des bénéficiaires : ABM", "abm", "ABM liste les bénéficiaires éligibles (UH, ZH, ABM, coordinateur actifs)", "select count(*) from public.moto_beneficiaires()", True, "6")
act("BEN-02", "Liste des bénéficiaires : refusée au Chef d'unité", "uh_sak", "UH liste les bénéficiaires", "select count(*) from public.moto_beneficiaires()", False, "rôle")
# ---------------------------------------------------------------------------
# J. AFLP FLEET (mandat du 31/10/2026) — 25 scénarios de recette + sécurité
# ---------------------------------------------------------------------------
U.update({"lc": uid(20), "zh2": uid(21), "zh_sz": uid(22)})
q("\n".join([
  f"insert into auth.users (id, email) values ('{U['lc']}', 'lc@example.invalid'), ('{U['zh2']}', 'zh2@example.invalid'), ('{U['zh_sz']}', 'zhsz@example.invalid') on conflict do nothing;",
  # Le coordinateur : rôle FBMS existant + fonction opérationnelle (mécanisme déjà utilisé par la sacherie).
  f"insert into public.profils (user_id, email, nom, role, fonction_operationnelle, actif) values ('{U['lc']}', 'lc@example.invalid', 'COORDINATEUR FICTIF', 'Supervisor', 'Logistics Coordinator', true) on conflict do nothing;",
  f"insert into public.profils (user_id, email, nom, role, zone, actif) values ('{U['zh2']}', 'zh2@example.invalid', 'ZH2 FICTIF', 'Zonal Head', 'GBEKE 2', true) on conflict do nothing;",
  f"insert into public.profils (user_id, email, nom, role, zone, actif) values ('{U['zh_sz']}', 'zhsz@example.invalid', 'ZH SANS ZONE FICTIF', 'Zonal Head', null, true) on conflict do nothing;",
]))
J = {}
check("FL-00a", "Classe LOGISTIQUE reconnue via fonction_operationnelle", "LOGISTIQUE",
      f"select private.moto_classe_de('{U['lc']}')", "LOGISTIQUE")
check("FL-00b", "Aucun droit FBMS modifié : rôle Supervisor inchangé pour le coordinateur", "Supervisor",
      f"select role from public.profils where user_id='{U['lc']}'", "Supervisor")

def chaine_service(moto, benef, label, chassis, km=12):
    """Chaîne réelle complète : identité, 3 documents vérifiés, inspection, préaffectation, PV, état contradictoire, remise, mise en service."""
    run_as("abm", f"select public.moto_modifier_identite('{moto}', '{{\"numero_chassis\":\"{chassis}\",\"immatriculation\":\"{chassis} IM\"}}'::jsonb, 'Saisie identité test')")
    for typ in ("CARTE_GRISE", "PLAQUE", "ASSURANCE"):
        pth = f"{moto}/document/{uuid.uuid4()}.pdf"; put_object(pth)
        ok, out = run_as("abm", "select public.moto_document_enregistrer(" + lit({"moto_id": moto, "type_document": typ, "storage_path": pth,
                         **({"date_expiration": str(today + datetime.timedelta(days=300))} if typ == "ASSURANCE" else {})}) + ")")
        run_as("bm", f"select public.moto_document_verifier('{json.loads(out)['id']}', 'CONFORME')")
    if q(f"select statut_technique from public.moto_motos where id='{moto}'") != "APTE":
        run_as("abm", "select public.moto_inspection_initiale(" + lit({"moto_id": moto, "items": items("INSPECTION_INITIALE"), "resultat": "APTE",
               "intervenant_nom": "MECANICIEN FICTIF", "garage_nom": "GARAGE FICTIF", "compteur_km": km - 2, "photos": photos(moto, ["COMPTEUR","AVANT","ARRIERE","GAUCHE","DROITE"])}) + ")")
    run_as("bm", f"select public.moto_preaffecter('{moto}', '{U[benef]}', 'Affectation test {label}')")
    pth = f"{moto}/document/{uuid.uuid4()}.pdf"; put_object(pth)
    ok, out = run_as("abm", "select public.moto_document_enregistrer(" + lit({"moto_id": moto, "type_document": "PV_REMISE", "storage_path": pth}) + ")")
    pvid = json.loads(out)["id"]; run_as("bm", f"select public.moto_document_verifier('{pvid}', 'CONFORME')")
    agent = "lc" if benef == "abm" else "abm"   # jamais le bénéficiaire lui-même
    ok, out = run_as(agent, "select public.moto_etat_remise_enregistrer(" + lit({"moto_id": moto, "items": items("ETAT_REMISE"), "compteur_km": km,
                     "date_remise_prevue": str(today), "photos": photos(moto, CATS_REMISE)}) + ")")
    run_as(benef, f"select public.moto_etat_remise_confirmer('{json.loads(out)['id']}', 'ACCEPTEE')")
    permis_pour(benef)
    r = act(f"FL-SVC-{label}", "Chaîne de remise complète (PV + état contradictoire distincts)", agent, f"Remise de la moto {label}",
            "select public.moto_remettre(" + lit({**remise_base, "moto_id": moto, "pv_document_id": pvid, "compteur_km": km}) + ")", True, "REMISE")
    act(f"FL-MES-{label}", "Mise en service distincte", "bm", f"Mise en service {label}", f"select public.moto_mettre_en_service('{moto}', 'Autorisation test {label}')")
    return pvid

# --- 3. Nouvelle moto avec photo ----------------------------------------------------------
r = act("FL-03a", "Enregistrement d'une moto neuve par le coordinateur", "lc", "Coordinateur crée M5 (Brobo) réceptionnée",
        "select public.moto_creer(" + lit({"marque": "APSONIC", "modele": "AP150-30", "cluster_code": "BROBO", "couleur": "ROUGE (fictif)",
              "fournisseur": "FOURNISSEUR FICTIF", "date_reception": str(today), "compteur_km": 3, "observations": "Test"}) + ")")
M5 = r["id"]
act("FL-03b", "Réception : date effective obligatoire", "lc", "Moto neuve réceptionnée sans date",
    "select public.moto_creer(" + lit({"marque": "APSONIC", "modele": "AP150-30"}) + ")", False, "Date de réception")
ph = f"{M5}/photo/{uuid.uuid4()}.jpg"; put_object(ph)
act("FL-03c", "Photo principale : réservée BM/ABM/coordinateur", "uh_bro", "Chef d'unité définit la photo principale",
    "select public.moto_photo_ajouter(" + lit({"moto_id": M5, "path": ph, "principale": True}) + ")", False, "")
act("FL-03d", "Photo principale enregistrée", "lc", "Coordinateur enregistre la photo principale de M5",
    "select public.moto_photo_ajouter(" + lit({"moto_id": M5, "path": ph, "principale": True}) + ")", True, "true")
check("FL-03e", "Photo visible au passeport (vue flotte)", ph, f"select photo_path from public.moto_v_flotte where id='{M5}'", ph)
act("FL-03f", "Photo : fichier d'une autre moto refusé", "lc", "Photo de M1 rattachée à M5",
    "select public.moto_photo_ajouter(" + lit({"moto_id": M5, "path": f"{M1}/photo/x.jpg"}) + ")", False, "non conforme")
# --- 4 et 5. Photo et documents protégés ----------------------------------------------------
act("FL-04a", "Photo accessible après reconnexion (compte autorisé)", "bm", "BM lit l'objet photo de M5",
    f"select count(*) from storage.objects where bucket_id='moto-documents' and name='{ph}'", True, "1")
act("FL-04b", "Photo protégée hors périmètre", "uh_bot", "UH Botro lit la photo de M5",
    f"select count(*) from storage.objects where bucket_id='moto-documents' and name='{ph}'", True, "0")
act("FL-05a", "Documents : anonyme refusé", "anon", "Anonyme lit les objets", "select count(*) from storage.objects", False, "permission")
act("FL-05b", "Galerie photo protégée", "uh_bot", "UH Botro lit la galerie de M5", f"select count(*) from public.moto_photos where moto_id='{M5}'", True, "0")
check("FL-05c", "Bucket toujours privé", "f", "select public from storage.buckets where id='moto-documents'", "f")
# --- 6 et 7. Moto déjà en exploitation, sans historique inventé ------------------------------
r = act("FL-06a", "Intégration d'une moto en exploitation sans marque connue", "lc", "Coordinateur intègre la moto du Chef de zone (marque inconnue)",
        "select public.moto_creer(" + lit({"origine": "EN_EXPLOITATION", "zone_code": "GBEKE_1", "date_debut_utilisation": "2026-02-01",
              "historique_note": "Utilisée depuis février 2026 ; historique d'entretien non disponible (fictif)"}) + ")", True, "EN_EXPLOITATION")
M6 = r["id"]
check("FL-06b", "Inconnu = Non disponible (NULL), jamais zéro", "t",
      f"select marque is null and modele is null and numero_chassis is null and compteur_reception_km is null and compteur_actuel_km is null and date_acquisition is null and date_debut_suivi is null and date_debut_utilisation='2026-02-01' from public.moto_motos where id='{M6}'", "t")
check("FL-07a", "Aucune vidange ni dépense passée inventée", "0/0/0",
      f"select (select count(*) from public.moto_maintenances where moto_id='{M6}')||'/'||(select count(*) from public.moto_carburant where moto_id='{M6}')||'/'||(select count(*) from public.moto_releves_km where moto_id='{M6}')", "0/0/0")
act("FL-06c", "État de référence : inventaire photo exigé", "lc", "Référence sans photos",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M6, "items": items("INSPECTION_INITIALE"), "resultat": "APTE",
      "intervenant_nom": "MECANICIEN QUALIFIE FICTIF", "garage_nom": "GARAGE FICTIF", "compteur_km": 18450}) + ")", False, "Photos insuffisantes")
act("FL-06d", "État de référence : compteur exigé", "lc", "Référence sans compteur",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M6, "items": items("INSPECTION_INITIALE"), "resultat": "APTE",
      "intervenant_nom": "MECANICIEN QUALIFIE FICTIF", "garage_nom": "GARAGE FICTIF"}) + ")", False, "compteur")
act("FL-06e", "État technique de référence par un intervenant qualifié", "lc", "Référence complète, anomalie éclairage existante",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M6, "items": items("INSPECTION_INITIALE", ko=("ECLAIRAGE",)), "resultat": "APTE",
      "intervenant_nom": "MECANICIEN QUALIFIE FICTIF", "garage_nom": "GARAGE FICTIF", "compteur_km": 18450,
      "inspecteur_externe": "Rapport du mécanicien saisi par le coordinateur",
      "photos": photos(M6, ["COMPTEUR", "AVANT", "ARRIERE", "GAUCHE", "DROITE"])}) + ")", True, "etat_reference\": true")
check("FL-06f", "Début du suivi fiable = date de l'état de référence ; anomalie existante identifiée", f"{today}/1/APTE",
      f"select date_debut_suivi||'/'||(select count(*) from public.moto_actions_correctives where moto_id='{M6}' and point_code='ECLAIRAGE' and statut='OUVERTE')||'/'||statut_technique from public.moto_motos where id='{M6}'", f"{today}/1/APTE")
check("FL-07b", "Coûts : aucune dépense historique créée", "0", f"select count(*) from public.moto_maintenances where moto_id='{M6}'", "0")
# --- 15. Acquisition prévue ----------------------------------------------------------------
r = act("FL-15a", "Acquisition prévue", "lc", "Moto prévue pour le 2e Chef de zone",
        "select public.moto_creer(" + lit({"situation_parc": "PREVUE", "beneficiaire_prevu_libelle": "Deuxième Chef de zone (compte à créer)"}) + ")", True, "PREVUE")
M11 = r["id"]
act("FL-15b", "Prévue : pas de compteur inventé", "lc", "Moto prévue avec compteur", "select public.moto_creer(" + lit({"situation_parc": "PREVUE", "compteur_km": 0}) + ")", False, "ni date")
act("FL-15c", "Prévue : aucune affectation", "bm", "BM préaffecte la moto prévue", f"select public.moto_preaffecter('{M11}', '{U['zh2']}', 'Test prévue')", False, "réception")
act("FL-15d", "Prévue : aucune inspection", "lc", "Inspection d'une moto prévue",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M11, "items": items("INSPECTION_INITIALE"), "intervenant_nom": "X", "garage_nom": "Y"}) + ")", False, "réceptionnée")
check("FL-15e", "Prévue : jamais comptée opérationnelle", "PREVUE/false/false",
      f"select situation_parc||'/'||autorisee_a_circuler||'/'||coalesce(dossier_incomplet::text,'false') from public.moto_v_flotte where id='{M11}'", "PREVUE/false/false")
act("FL-15f", "Réception physique : kilométrage obligatoire", "lc", "Réception sans compteur",
    "select public.moto_receptionner(" + lit({"moto_id": M11, "date_reception": str(today), "marque": "APSONIC", "modele": "AP150-30"}) + ")", False, "Kilométrage")
# --- 17, 18, 20. Champ « critique » falsifié, immobilisation, réparation jusqu'à clôture -----
r = act("FL-18a", "Moto de test M7", "lc", "Coordinateur crée M7", "select public.moto_creer(" + lit({"marque": "TEST", "modele": "FICTIF", "cluster_code": "SAKASSOU", "date_reception": str(today)}) + ")")
M7 = r["id"]
act("FL-18b", "Code de point inconnu rejeté", "lc", "Inspection avec un code inventé",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M7, "items": items("INSPECTION_INITIALE") + [{"code": "BIDON", "ok": True}],
      "intervenant_nom": "MECANICIEN FICTIF", "garage_nom": "GARAGE FICTIF"}) + ")", False, "inconnu")
act("FL-18c", "Code dupliqué rejeté", "lc", "Inspection avec un point en double",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M7, "items": items("INSPECTION_INITIALE") + [{"code": "FREIN_AVANT", "ok": True}],
      "intervenant_nom": "MECANICIEN FICTIF", "garage_nom": "GARAGE FICTIF"}) + ")", False, "double")
act("FL-18d", "Point obligatoire omis rejeté", "lc", "Inspection sans le point freins avant",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M7, "items": [i for i in items("INSPECTION_INITIALE") if i["code"] != "FREIN_AVANT"],
      "intervenant_nom": "MECANICIEN FICTIF", "garage_nom": "GARAGE FICTIF"}) + ")", False, "obligatoires")
r = act("FL-18e", "Champ « critique » falsifié par le client : règle serveur maintenue", "lc", "Freins KO envoyés critique=false, résultat APTE",
        "select public.moto_inspection_initiale(" + lit({"moto_id": M7, "items": items("INSPECTION_INITIALE", ko=("FREIN_AVANT",), falsifier=True), "resultat": "APTE",
              "intervenant_nom": "MECANICIEN FICTIF", "garage_nom": "GARAGE FICTIF", "compteur_km": 4}) + ")", True, "\"anomalie_critique\": true")
check("FL-17a", "Anomalie critique → immobilisation persistante", "IMMOBILISEE/INAPTE/CRITIQUE",
      f"select statut_technique||'/'||(select resultat from public.moto_controles where moto_id='{M7}' order by date_controle desc limit 1)||'/'||(select gravite from public.moto_actions_correctives where moto_id='{M7}' and point_code='FREIN_AVANT') from public.moto_motos where id='{M7}'",
      "IMMOBILISEE/INAPTE/CRITIQUE")
check("FL-18f", "Gravité enregistrée = catalogue (pas la valeur client)", "true",
      f"select (items->0->>'critique') from public.moto_controles where moto_id='{M7}' order by date_controle desc limit 1", "true")
act("FL-18g", "Contrôle départ : critique falsifié", "uh_sak", "Départ M1 freins KO critique=false",
    "select public.moto_controle_depart(" + lit({"moto_id": M1, "items": items("AVANT_DEPART", ko=("FREIN_ARRIERE",), falsifier=True), "compteur_km": 900, "client_op_id": str(uuid.uuid4())}) + ")", True, "\"anomalie_critique\": true")
im7 = q(f"select id from public.moto_immobilisations where moto_id='{M7}' and fin is null")
act("FL-20a", "Remise en service : le coordinateur ne lève pas seul", "lc", "Coordinateur lève l'immobilisation", f"select public.moto_lever_immobilisation('{im7}', 'tentative coordinateur')", False, "rôle")
act("FL-20b", "Contrôle de remise en service par le coordinateur", "lc", "Contrôle APTE après réparation",
    "select public.moto_controle_remise_en_service(" + lit({"moto_id": M7, "items": items("REMISE_EN_SERVICE"), "intervenant_nom": "MECANICIEN FICTIF", "compteur_km": 5}) + ")", True, "APTE")
act("FL-20c", "Levée bloquée tant que l'anomalie n'est pas vérifiée", "bm", "BM lève avant clôture de l'action", f"select public.moto_lever_immobilisation('{im7}', 'Levée test')", False, "anomalie critique")
a7 = q(f"select id from public.moto_actions_correctives where moto_id='{M7}' and point_code='FREIN_AVANT'")
act("FL-20d", "Planification de l'action", "lc", "Coordinateur planifie (garage, devis, date cible)",
    "select public.moto_action_planifier(" + lit({"action_id": a7, "action_prevue": "Remplacement plaquettes avant", "prestataire": "GARAGE FICTIF",
      "devis_montant": 9000, "date_cible": str(today + datetime.timedelta(days=3))}) + ")", True, "PLANIFIEE")
act("FL-20e", "M6 : aucun montant sur une action corrective", "lc", "Réalisation payante hors dossier",
    "select public.moto_action_realiser(" + lit({"action_id": a7, "realise_at": str(today), "cout_reel": 9000}) + ")", False, "Aucun montant")
mt7, au7 = dossier_autorise("FL-20x", M7, 9000, soumetteur="lc", demandeur="lc")
run_as("lc", "select public.moto_action_planifier(" + lit({"action_id": a7, "action_prevue": "Remplacement plaquettes avant", "prestataire": "GARAGE FICTIF",
      "devis_montant": 9000, "maintenance_id": mt7, "date_cible": str(today + datetime.timedelta(days=3))}) + ")")
act("FL-20e2", "M6 : même rattachée à un dossier autorisé, l'action ne porte pas de second montant", "lc", "Réalisation à 9 000 avec dossier",
    "select public.moto_action_realiser(" + lit({"action_id": a7, "realise_at": str(today), "cout_reel": 9000}) + ")", False, "Aucun montant")
fac = f"{M7}/maintenance/{uuid.uuid4()}.pdf"; put_object(fac)
act("FL-20f", "Réalisation avec facture", "lc", "Réalisation avec facture fictive",
    "select public.moto_action_realiser(" + lit({"action_id": a7, "realise_at": str(today), "justificatif_path": fac}) + ")", True, "REALISEE")
act("FL-20g", "Vérification par un tiers uniquement", "lc", "Le coordinateur vérifie son propre travail", f"select public.moto_action_verifier('{a7}', 'VALIDEE', 'auto-vérification')", False, "Séparation")
act("FL-20h", "Vérification après réparation", "zh", "Chef de zone vérifie et clôt", f"select public.moto_action_verifier('{a7}', 'VALIDEE', 'Freinage contrôlé sur place')", True, "CLOTUREE")
act("FL-20i", "Levée : auteur du contrôle ≠ décideur", "bm", "BM lève l'immobilisation (contrôle fait par le coordinateur)", f"select public.moto_lever_immobilisation('{im7}', 'Correction vérifiée')", True, "true")
check("FL-20j", "Clôture vérifiée ; moto neuve à nouveau « à contrôler » (pas d'aptitude automatique)", "CLOTUREE/A_CONTROLER",
      f"select (select statut from public.moto_actions_correctives where id='{a7}')||'/'||statut_technique from public.moto_motos where id='{M7}'", "CLOTUREE/A_CONTROLER")
act("FL-20k", "Nouvelle inspection mécanique après réparation", "abm", "Inspection initiale APTE de M7",
    "select public.moto_inspection_initiale(" + lit({"moto_id": M7, "items": items("INSPECTION_INITIALE"), "resultat": "APTE",
      "intervenant_nom": "MECANICIEN FICTIF", "garage_nom": "GARAGE FICTIF", "compteur_km": 6}) + ")", True, "APTE")
check("FL-20l", "Moto apte après preuve de correction", "APTE", f"select statut_technique from public.moto_motos where id='{M7}'", "APTE")
# --- 9. PV distinct de l'inspection ; état contesté ---------------------------------------
r = act("FL-09a", "Moto M8 (Botro)", "lc", "Coordinateur crée M8", "select public.moto_creer(" + lit({"marque": "APSONIC", "modele": "AP150-30", "cluster_code": "BOTRO", "date_reception": str(today)}) + ")")
M8 = r["id"]
pv5 = chaine_service(M5, "uh_bro", "M5", "TEST-FL-CH-05")
check("FL-09b", "PV de remise ≠ inspection mécanique ≠ état contradictoire", "t",
      f"select a.pv_document_id is not null and a.etat_remise_id is not null and (select type_controle from public.moto_controles where id=a.etat_remise_id)='ETAT_REMISE' "
      f"and exists (select 1 from public.moto_controles where moto_id='{M5}' and type_controle='INSPECTION_INITIALE') from public.moto_affectations a where a.moto_id='{M5}' and a.statut='ACTIVE'", "t")
# Le 1er du mois, une mise en service le jour même couvre tout le mois : l'inspection du mois est due (règle
# « mise en service ≤ début de fenêtre »). On vérifie alors l'absence d'inspection pour les mois ANTÉRIEURS.
if datetime.date.today().day == 1:
    check("FL-16", "Mise en service le 1er : aucune inspection exigée pour une période antérieure", "0",
          f"select count(*) from public.moto_v_inspections_exigibles where moto_id='{M5}' and periode < date_trunc('month', current_date)::date", "0")
else:
    check("FL-16", "Mise en service en cours de mois : aucune inspection rétroactive exigée", "0",
          f"select count(*) from public.moto_v_inspections_exigibles where moto_id='{M5}' and periode=date_trunc('month', current_date)::date", "0")
# --- 13, 14. Motos du Chef de zone, de l'ABM, du coordinateur -------------------------------
r = act("FL-13a", "Moto M9 (ABM)", "lc", "Moto pour l'ABM", "select public.moto_creer(" + lit({"marque": "APSONIC", "modele": "AP150-30", "zone_code": "GBEKE_1", "date_reception": str(today)}) + ")")
M9 = r["id"]
r = act("FL-13b", "Moto M10 (coordinateur)", "bm", "Moto du coordinateur", "select public.moto_creer(" + lit({"marque": "APSONIC", "modele": "AP150-30", "zone_code": "GBEKE_1", "date_reception": str(today)}) + ")")
M10 = r["id"]
chaine_service(M6, "zh", "M6", "TEST-FL-CH-06", km=18455)
chaine_service(M9, "abm", "M9", "TEST-FL-CH-09")
check("FL-13g", "Moto de l'ABM : remise enregistrée par un tiers (coordinateur), jamais par le bénéficiaire", U["lc"],
      f"select cree_par from public.moto_affectations where moto_id='{M9}' and type_affectation='REMISE'", U["lc"])
chaine_service(M10, "lc", "M10", "TEST-FL-CH-10")
# Données de test : les motos actives sont datées en service le 20 du mois précédent pour rendre le mois courant exigible.
q(f"update public.moto_motos set mise_en_service_at = date_trunc('month', current_date) - interval '11 days' where id in ('{M1}','{M5}','{M6}','{M9}','{M10}')")
check("FL-14a", "Moto du coordinateur : contrôle indépendant exigé, pas de COORDINATION", "INDEPENDANTE",
      f"select string_agg(distinct niveau, ',') from public.moto_v_inspections_exigibles where moto_id='{M10}' and periode=date_trunc('month', current_date)::date", "INDEPENDANTE")
check("FL-13c", "Moto du Chef de zone : COORDINATION uniquement (pas de niveau ZONE)", "COORDINATION",
      f"select string_agg(distinct niveau, ',') from public.moto_v_inspections_exigibles where moto_id='{M6}' and periode=date_trunc('month', current_date)::date", "COORDINATION")
def insp(user, moto, ko=(), niveau=None, cats=("COMPTEUR", "AVANT"), km=None, extra=None):
    p = {"moto_id": moto, "items": items("INSPECTION_MENSUELLE", ko=ko), "compteur_km": km or 1000, "photos": photos(moto, list(cats)), "client_op_id": str(uuid.uuid4())}
    if niveau: p["niveau"] = niveau
    if extra: p.update(extra)
    return "select public.moto_inspection_mensuelle(" + lit(p) + ")"
act("FL-13d", "Coordinateur inspecte la moto d'un Chef d'unité", "lc", "COORDINATION sur M1", insp("lc", M1, km=1001), True, "COORDINATION")
act("FL-13e", "Coordinateur inspecte la moto du Chef de zone", "lc", "COORDINATION sur M6", insp("lc", M6, km=18460), True, "COORDINATION")
act("FL-13f", "Coordinateur inspecte la moto de l'ABM (anomalie critique)", "lc", "COORDINATION sur M9, pneus KO", insp("lc", M9, ko=("PNEUS",), km=20), True, "NON_CONFORME")
check("FL-17b", "Inspection mensuelle critique → immobilisation immédiate", "IMMOBILISEE", f"select statut_technique from public.moto_motos where id='{M9}'", "IMMOBILISEE")
act("FL-14b", "Coordinateur : pas d'inspection de sa propre moto", "lc", "COORDINATION sur M10", insp("lc", M10, km=20), False, "propre moto")
act("FL-14c", "Coordinateur : pas d'auto-contrôle indépendant", "lc", "INDEPENDANTE sur M10", insp("lc", M10, niveau="INDEPENDANTE", km=20), False, "propre moto")
act("FL-14d", "Contrôle indépendant : inspecteur désigné requis", "zh2", "Chef de zone non désigné, INDEPENDANTE sur M10", insp("zh2", M10, niveau="INDEPENDANTE", km=20), False, "désigné")
act("FL-14e", "Désignation d'un inspecteur indépendant par le BM", "bm", "BM désigne ZH2",
    f"select public.moto_parametre_modifier('inspecteurs_independants', null, '[\"{U['zh2']}\"]'::jsonb, 'Désignation inspecteur indépendant test')")
act("FL-14f", "Contrôle indépendant de la moto du coordinateur", "zh2", "ZH2 désigné, INDEPENDANTE sur M10", insp("zh2", M10, niveau="INDEPENDANTE", km=21), True, "INDEPENDANTE")
act("FL-14g", "Rapport d'un mécanicien externe saisi par un tiers autorisé", "bm", "Second contrôle indépendant du mois refusé (doublon)",
    insp("bm", M10, niveau="INDEPENDANTE", km=22, extra={"intervenant_nom": "MECANICIEN EXTERNE FICTIF", "inspecteur_externe": "Rapport saisi par le BM"}), False, "déjà enregistrée")
# --- 10, 11, 12, 19. Chef de zone ------------------------------------------------------------
jour = today.day
act("FL-10", "Chef de zone inspecte une moto de Chef d'unité de sa zone", "zh", "ZONE sur M1 (Sakassou, GBEKE 1), éclairage KO",
    insp("zh", M1, ko=("ECLAIRAGE",), km=1002), True, "\"dans_delai\": " + ("true" if jour <= 15 else "false"))
check("FL-12", "Inspection du Chef de zone après le 15 : tardive", "EFFECTUEE_HORS_DELAI" if jour > 15 else "EFFECTUEE",
      f"select statut from public.moto_v_inspections_exigibles where moto_id='{M1}' and niveau='ZONE' and periode=date_trunc('month', current_date)::date",
      "EFFECTUEE_HORS_DELAI" if jour > 15 else "EFFECTUEE")
act("FL-11a", "Chef de zone : pas d'écriture hors de sa zone", "zh", "ZH (GBEKE 1) demande un entretien sur M8 (Botro, GBEKE 2)",
    "select public.moto_maintenance_demander(" + lit({"moto_id": M8, "type_maintenance": "VIDANGE", "description": "Tentative hors zone"}) + ")", False, "périmètre")
act("FL-11b", "Chef de zone : pas d'inspection hors de sa zone", "zh2", "ZH2 (GBEKE 2) inspecte M1 (GBEKE 1)", insp("zh2", M1, km=1003), False, "zone")
act("FL-11c", "Chef de zone : lecture globale conservée", "zh", "ZH lit M8", f"select count(*) from public.moto_motos where id='{M8}'", True, "1")
act("FL-11d", "Chef de zone sans zone renseignée : refus explicite", "zh_sz", "ZH sans zone inspecte M1", insp("zh_sz", M1, km=1003), False, "Zone de responsabilité")
act("FL-11e", "Chef de zone : ne fait pas l'inspection d'un ABM", "zh", "ZONE sur M9 (ABM)", insp("zh", M9, km=21), False, "Chefs d'unité")
act("FL-12b", "Aucune inspection rétroactive (date antérieure)", "zh", "ZONE datée de 10 jours",
    insp("zh", M5, km=13, extra={"date_controle": ts(days=-10)}), False, "3 jours")
act("FL-19a", "Doublon artificiel refusé", "zh", "Seconde inspection ZONE de M1 ce mois", insp("zh", M1, km=1004), False, "déjà enregistrée")
act("FL-19b", "Visite effectuée ≠ conforme : anomalie ouverte maintenue", "lc", "Le coordinateur ne peut pas refaire COORDINATION sur M1 (déjà faite)", insp("lc", M1, km=1004), False, "déjà enregistrée")
prev = q(f"select id from public.moto_controles where moto_id='{M1}' and niveau='ZONE' and remplace_par is null")
act("FL-19c", "Correction motivée (piste d'audit)", "zh", "ZH corrige son inspection, tout OK cette fois",
    insp("zh", M1, km=1004, extra={"remplace_id": prev, "motif_correction": "Ampoule remplacée sur place, contrôle refait"}), True, "RESERVES")
check("FL-19d", "Anomalie non corrigée reste ouverte à l'inspection suivante (pas de doublon)", "1/1",
      f"select count(*) filter (where statut='OUVERTE')||'/'||count(*) from public.moto_actions_correctives where moto_id='{M1}' and point_code='ECLAIRAGE'", "1/1")
check("FL-19e", "Version corrigée conservée", "1/1",
      f"select count(*) filter (where remplace_par is not null)||'/'||count(*) filter (where remplace_par is null) from public.moto_controles where moto_id='{M1}' and niveau='ZONE'", "1/1")
# --- 21. Enveloppes du coordinateur ------------------------------------------------------------
per = str(today.replace(day=1))
r = act("FL-21a", "Enveloppe de supervision demandée", "lc", "Coordinateur demande 50 000 (fictif)",
        "select public.moto_enveloppe_demander(" + lit({"type_enveloppe": "SUPERVISION", "periode": per, "montant_demande": 50000, "justification": "Tournées du 20 au 31 (fictif)"}) + ")", True, "DEMANDEE")
env = r["id"]
act("FL-21b", "Pas d'auto-approbation", "lc", "Coordinateur approuve sa propre enveloppe", f"select public.moto_enveloppe_decider('{env}', 'APPROUVEE', null, null)", False, "rôle")
act("FL-21c", "Approbation partielle motivée par le BM", "bm", "BM approuve 40 000", f"select public.moto_enveloppe_decider('{env}', 'APPROUVEE', 40000, 'Ajusté au plan de tournée')", True, "APPROUVEE")
r = act("FL-21d", "Dépense déclarée sur l'enveloppe", "lc", "Dépense 30 000 sans justificatif",
        "select public.moto_depense_declarer(" + lit({"enveloppe_id": env, "date_depense": str(today), "montant": 30000, "objet": "Carburant tournée (fictif)", "client_op_id": str(uuid.uuid4())}) + ")", True, "DECLAREE")
dep = r["id"]
act("FL-21e", "Dépassement refusé", "lc", "Dépense 20 000 au-delà du solde",
    "select public.moto_depense_declarer(" + lit({"enveloppe_id": env, "date_depense": str(today), "montant": 20000, "objet": "Dépassement test"}) + ")", False, "solde")
jp = f"depenses/{U['lc']}/{uuid.uuid4()}.pdf"; put_object(jp)
act("FL-21f", "Justificatif d'un autre compte refusé", "lc", "Chemin de justificatif du BM",
    f"select public.moto_depense_justifier('{dep}', 'depenses/{U['bm']}/x.pdf')", False, "non conforme")
act("FL-21g", "Justificatif ajouté", "lc", "Coordinateur ajoute son justificatif", f"select public.moto_depense_justifier('{dep}', '{jp}')", True, "JUSTIFIEE")
act("FL-21h", "Le coordinateur ne valide pas ses dépenses", "lc", "Coordinateur valide sa dépense", f"select public.moto_depense_verifier('{dep}', 'VALIDEE')", False, "rôle")
act("FL-21i", "Validation par un tiers habilité", "abm", "ABM valide", f"select public.moto_depense_verifier('{dep}', 'VALIDEE')", True, "VALIDEE")
check("FL-21j", "Enveloppe : demandé / approuvé / consommé / justifié / solde", "50000/40000/30000/30000/10000",
      f"select montant_demande||'/'||montant_approuve||'/'||montant_consomme||'/'||montant_justifie||'/'||solde_disponible from public.moto_v_enveloppes where id='{env}'", "50000/40000/30000/30000/10000")
act("FL-21k", "Enveloppes : Chef d'unité sans accès", "uh_sak", "UH lit les enveloppes", "select count(*) from public.moto_enveloppes", True, "0")
# --- Droits du coordinateur (moindre privilège) ------------------------------------------------
act("FL-LC1", "Coordinateur : pas de mise en service", "lc", "Mise en service de M8", f"select public.moto_mettre_en_service('{M8}', 'tentative coordinateur')", False, "rôle")
act("FL-LC2", "Coordinateur : pas de décision de dépense de maintenance", "lc", "Décision maintenance",
    f"select public.moto_maintenance_decider((select id from public.moto_maintenances limit 1), 'AUTORISEE')", False, "rôle")
act("FL-LC3", "Coordinateur : pas d'accès aux dotations Finance", "lc", "Lecture des dotations", "select count(*) from public.moto_dotations", True, "0")
act("FL-LC4", "Coordinateur : pas de modification des paramètres", "lc", "Modifie un paramètre",
    "select public.moto_parametre_modifier('photos_inspection_min', 0, null, 'tentative de contournement')", False, "rôle")
act("FL-LC5", "Coordinateur : pas de préaffectation", "lc", "Préaffecte M8", f"select public.moto_preaffecter('{M8}', '{U['uh_bot']}', 'tentative coordinateur')", False, "rôle")
act("FL-LC6", "Coordinateur : voit tout le parc", "lc", "Lecture flotte", "select count(*) >= 10 from public.moto_motos", True, "t")
act("FL-LC7", "Coordinateur : demande d'entretien possible", "lc", "Demande de vidange sur M8",
    "select public.moto_maintenance_demander(" + lit({"moto_id": M8, "type_maintenance": "VIDANGE", "description": "Vidange à programmer (fictif)"}) + ")", True, "DEMANDEE")
# --- 22, 23. Indicateurs sur données réelles ---------------------------------------------------
act("FL-22", "Coût/km : kilomètres comptés depuis le suivi fiable, jamais depuis 0 (historique exclu)", "bm", "Lecture du coût/km de M6",
    f"select (km_debut >= 18450 and km_parcourus < 100)::text from public.moto_v_cout_km where moto_id='{M6}'", True, "true")
check("FL-23", "L/100 km non calculé sans pleins complets", "null", f"select coalesce(l_100km::text, 'null') from public.moto_v_conso_moto where moto_id='{M6}'", "null")
# --- 24. Pneus ---------------------------------------------------------------------------------
act("FL-24a", "Pneu : marquage DOT invalide refusé", "lc", "Date de fabrication « 26 »",
    "select public.moto_pneu_creer(" + lit({"code": "PN-FL-X", "marque": "TEST", "dimensions": "2.75-18", "date_fabrication": "26"}) + ")", False, "DOT")
r = act("FL-24b", "Pneu : identité complète", "lc", "Coordinateur entre un pneu",
        "select public.moto_pneu_creer(" + lit({"code": "PN-FL-01", "marque": "TEST", "modele": "FICTIF", "dimensions": "2.75-18", "numero_serie": "SER-FICTIF-1", "date_fabrication": "2526"}) + ")")
pn = r["id"]
r = act("FL-24c", "Pneu : pose", "lc", "Pose arrière sur M5 à 20 km", "select public.moto_pneu_poser(" + lit({"moto_id": M5, "pneu_id": pn, "position": "ARRIERE", "pose_km": 20}) + ")")
act("FL-24d", "Pneu : dépose et réforme", "lc", "Dépose à 520 km", "select public.moto_pneu_deposer(" + lit({"pose_id": r["id"], "depose_km": 520, "motif_depose": "Usure (fictif)", "destination": "REFORME"}) + ")")
check("FL-24e", "Historique pneu conservé (dates, km, DOT)", "2526/500.0/" + str(today),
      f"select date_fabrication||'/'||km_parcourus||'/'||premiere_pose from public.moto_v_pneus where id='{pn}'", "2526/500.0/" + str(today))
# --- 25. Hors ligne : synchronisation d'une inspection, idempotence, photo liée à la bonne moto
cop = str(uuid.uuid4()); ph9 = photos(M5, ["COMPTEUR", "AVANT"])
lot = [{"type": "INSPECTION_MENSUELLE", "client_op_id": cop, "payload": {"moto_id": M5, "items": items("INSPECTION_MENSUELLE"), "compteur_km": 530, "photos": ph9}},
       {"type": "INSPECTION_MENSUELLE", "client_op_id": str(uuid.uuid4()), "payload": {"moto_id": M8, "items": items("INSPECTION_MENSUELLE"), "compteur_km": 3, "photos": ph9}}]
act("FL-25a", "Synchronisation d'une inspection saisie hors ligne", "lc", "Lot : M5 valide + M8 non active",
    "select string_agg(x->>'statut', ',') from jsonb_array_elements(public.moto_sync_batch(" + lit(lot) + ")) x", True, "SYNCHRONISE,REJETE")
act("FL-25b", "Rejeu idempotent", "lc", "Même lot rejoué", "select string_agg((x->>'doublon')::text, ',') from jsonb_array_elements(public.moto_sync_batch(" + lit(lot[:1]) + ")) x", True, "true")
check("FL-25c", "Photos rattachées à la bonne moto après synchronisation", "2/" + M5,
      f"select count(*)||'/'||min(moto_id::text) from public.moto_photos where controle_id=(select id from public.moto_controles where client_op_id='{cop}')", "2/" + M5)
act("FL-25d", "Photo d'une autre moto refusée en synchronisation", "lc", "Inspection de M6 avec une photo de M5",
    "select string_agg(x->>'message', ',') from jsonb_array_elements(public.moto_sync_batch(" + lit([{"type": "INSPECTION_MENSUELLE", "client_op_id": str(uuid.uuid4()),
      "payload": {"moto_id": M6, "niveau": "COORDINATION", "items": items("INSPECTION_MENSUELLE"), "compteur_km": 18470, "photos": photos(M5, ["COMPTEUR", "AVANT"])}}]) + ")) x", True, "déjà enregistrée")
check("FL-REG", "Ancienne fonction de gravité client neutralisée", "retirée",
      "do $$ begin perform private.moto_items_valides('[]'::jsonb); exception when others then raise notice '%', sqlerrm; end $$; select 'retirée'", "retirée")
# --- Corrections issues de la revue indépendante (NO_GO initial) -------------------------------
q(f"update public.profils set fonction_operationnelle='Logistics Coordinator' where user_id='{U['uh_bro']}'")
check("RV-01", "Revue : un Chef d'unité portant la fonction « coordinateur » reste Chef d'unité", "UNITE", f"select private.moto_classe_de('{U['uh_bro']}')", "UNITE")
q(f"update public.profils set fonction_operationnelle=null where user_id='{U['uh_bro']}'")
act("RV-02a", "Revue : l'utilisateur ne fait pas le contrôle de remise en service de sa moto", "zh", "ZH contrôle sa propre moto M6",
    "select public.moto_controle_remise_en_service(" + lit({"moto_id": M6, "items": items("REMISE_EN_SERVICE"), "intervenant_nom": "X", "compteur_km": 18470}) + ")", False, "Indépendance")
act("RV-02b", "Revue : le coordinateur ne contrôle pas sa propre moto", "lc", "Coordinateur, remise en service de M10",
    "select public.moto_controle_remise_en_service(" + lit({"moto_id": M10, "items": items("REMISE_EN_SERVICE"), "intervenant_nom": "X", "compteur_km": 30}) + ")", False, "Indépendance")
a6 = q(f"select id from public.moto_actions_correctives where moto_id='{M6}' and point_code='ECLAIRAGE'")
run_as("lc", "select public.moto_action_planifier(" + lit({"action_id": a6, "action_prevue": "Ampoule à remplacer", "date_cible": str(today + datetime.timedelta(days=2))}) + ")")
run_as("lc", "select public.moto_action_realiser(" + lit({"action_id": a6, "realise_at": str(today)}) + ")")
act("RV-02c", "Revue : l'utilisateur ne vérifie pas la réparation de sa propre moto", "zh", "ZH vérifie l'action de M6", f"select public.moto_action_verifier('{a6}', 'VALIDEE', 'constat personnel')", False, "Indépendance")
inc6 = act("RV-02d", "Revue : incident sur sa moto", "zh", "ZH déclare un incident majeur sur M6",
           "select public.moto_incident_declarer(" + lit({"moto_id": M6, "type_incident": "PANNE", "gravite": "MAJEURE", "description": "Panne fictive de test revue", "client_op_id": str(uuid.uuid4())}) + ")")
act("RV-02e", "Revue : l'utilisateur ne pilote pas le circuit incident de sa moto", "zh", "ZH avance l'incident de sa propre moto",
    f"select public.moto_incident_avancer((select id from public.moto_incidents where moto_id='{M6}' order by declare_at desc limit 1), 'DIAGNOSTIC', 'auto-diagnostic')", False, "Indépendance")
a9 = q(f"select id from public.moto_actions_correctives where moto_id='{M9}' and gravite='CRITIQUE' limit 1")
act("RV-03", "Revue : une anomalie critique ne s'annule pas", "bm", "BM annule l'anomalie critique de M9", f"select public.moto_action_annuler('{a9}', 'Annulation sans vérification test')", False, "ne s'annule pas")
put_object(f"depenses/{U['bm']}/note-bm-fictive.pdf")
act("RV-04", "Revue : justificatifs d'autrui illisibles pour le coordinateur", "lc", "Coordinateur lit un justificatif du BM",
    f"select count(*) from storage.objects where bucket_id='moto-documents' and name like 'depenses/{U['bm']}/%'", True, "0")
act("RV-04b", "Revue : le BM lit les justificatifs du coordinateur", "bm", "BM lit le justificatif du coordinateur",
    f"select count(*) from storage.objects where bucket_id='moto-documents' and name='{jp}'", True, "1")
dup = photos(M6, ["COMPTEUR"])
corr6 = {"remplace_id": q(f"select id from public.moto_controles where moto_id='{M6}' and niveau='COORDINATION' and remplace_par is null"), "motif_correction": "Correction pour test de photos"}
act("RV-05a", "Revue : une seule photo citée pour plusieurs vues refusée", "lc", "Même fichier pour COMPTEUR et AVANT",
    insp("lc", M6, km=18480, extra={**corr6, "photos": dup + [{"path": dup[0]["path"], "categorie": "AVANT"}]}), False, "déjà utilisée")
act("RV-05b", "Revue : photo d'un contrôle antérieur refusée", "lc", "Photos d'une inspection précédente réutilisées",
    insp("lc", M6, km=18480, extra={**corr6, "photos": [{"path": q(f"select storage_path from public.moto_photos where moto_id='{M6}' and categorie='COMPTEUR' order by prise_at limit 1"), "categorie": "COMPTEUR"}] + photos(M6, ["AVANT"])}), False, "déjà utilisée")
act("RV-06", "Revue : un justificatif ne justifie qu'une dépense", "lc", "Seconde dépense avec la même facture",
    "select public.moto_depense_declarer(" + lit({"enveloppe_id": env, "date_depense": str(today), "montant": 5000, "objet": "Doublon de facture", "justificatif_path": jp}) + ")", False, "duplicate")
# ---------------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "serveur.json"), "w", encoding="utf-8") as f:
    json.dump({"base": DB, "date": now.isoformat(), "resultats": RESULTS}, f, ensure_ascii=False, indent=1)
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI")
print(f"| id | exigence | compte | action | attendu | obtenu | résultat |\n|---|---|---|---|---|---|---|")
for r in RESULTS:
    print(f"| {r['id']} | {r['exigence']} | {r['compte']} | {r['action']} | {r['attendu']} | {r['obtenu'][:90]} | {r['resultat']} |")
print(f"\nTOTAL : {ok}/{len(RESULTS)} réussis")
sys.exit(0 if ok == len(RESULTS) else 1)

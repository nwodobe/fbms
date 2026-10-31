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

def put_object(path):
    q(f"insert into storage.objects (bucket_id, name, owner) values ('moto-documents', '{path}', '{U['abm']}') on conflict do nothing")

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
items_ok = [{"code": "FREINS", "libelle": "Freins", "ok": True, "critique": True},
            {"code": "PNEUS", "libelle": "Pneus", "ok": True, "critique": True},
            {"code": "ECLAIRAGE", "libelle": "Éclairage", "ok": True, "critique": False}]
items_crit = [{"code": "FREINS", "libelle": "Freins", "ok": False, "critique": True},
              {"code": "PNEUS", "libelle": "Pneus", "ok": True, "critique": True}]
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
act("REM-05", "Permis vérifié RH obligatoire", "abm", "Remise sans vérification du permis",
    "select public.moto_remettre(" + lit({**remise_base, "pv_document_id": pv["id"], "permis_verifie": False}) + ")", False, "permis")
act("REM-06", "Équipements de sécurité obligatoires", "abm", "Remise sans gilet",
    "select public.moto_remettre(" + lit({**remise_base, "pv_document_id": pv["id"], "equipements": {"CASQUE": True}}) + ")", False, "GILET")
act("REM-07", "Documents conformes obligatoires", "abm", "Remise de M4 (aucun document)",
    "select public.moto_remettre(" + lit({**remise_base, "moto_id": M4, "pv_document_id": pv["id"]}) + ")", False, "non conformes")
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
    "select public.moto_controle_depart(" + lit({"moto_id": M1, "items": items_ok, "compteur_km": 41, "client_op_id": str(uuid.uuid4())}) + ")", True, "APTE")
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
crit_items = [{"code": "FREINS", "libelle": "Freins", "ok": False, "critique": True}, {"code": "PNEUS", "ok": True, "critique": True}]
r = act("INC-01", "Anomalie critique au départ → immobilisation", "uh_sak", "Contrôle avant départ freins KO",
        "select public.moto_controle_depart(" + lit({"moto_id": M1, "items": crit_items, "compteur_km": 205, "client_op_id": str(uuid.uuid4())}) + ")", True, "INAPTE")
check("INC-02", "Moto immobilisée sans attendre", "IMMOBILISEE / non autorisée", f"select statut_technique||'/'||(select autorisee_a_circuler from public.moto_v_flotte where id='{M1}') from public.moto_motos where id='{M1}'", "IMMOBILISEE/false")
inc = q(f"select id from public.moto_incidents where moto_id='{M1}' order by declare_at desc limit 1")
act("INC-03", "Chef d'unité ne pilote pas le circuit", "uh_sak", "UH avance l'incident", f"select public.moto_incident_avancer('{inc}', 'DIAGNOSTIC', 'tentative')", False, "rôle")
act("INC-04", "Transition interdite", "zh", "Saut direct vers REMIS_EN_SERVICE", f"select public.moto_incident_avancer('{inc}', 'REMIS_EN_SERVICE', 'saut interdit')", False, "Transition")
act("INC-05", "Diagnostic", "zh", "ZH : diagnostic", f"select public.moto_incident_avancer('{inc}', 'DIAGNOSTIC', 'Plaquettes usées')")
act("INC-06", "Autorisation de dépense : montant obligatoire", "zh", "Autorisation sans montant",
    f"select public.moto_incident_avancer('{inc}', 'AUTORISATION_DEPENSE', 'Remplacement plaquettes')", False, "Montant")
act("INC-07", "ABM ne peut pas autoriser la dépense", "abm", "ABM autorise la dépense",
    f"select public.moto_incident_avancer('{inc}', 'AUTORISATION_DEPENSE', 'Remplacement plaquettes', 8000)", False, "réservée")
act("INC-08", "Autorisation de dépense", "zh", "ZH autorise 8 000 (fictif)", f"select public.moto_incident_avancer('{inc}', 'AUTORISATION_DEPENSE', 'Remplacement plaquettes', 8000)")
act("INC-09", "Réparation", "zh", "ZH : réparation", f"select public.moto_incident_avancer('{inc}', 'REPARATION', 'Garage fictif intervient')")
act("INC-10", "Contrôle", "zh", "ZH : étape contrôle", f"select public.moto_incident_avancer('{inc}', 'CONTROLE', 'Contrôle à réaliser')")
act("INC-11", "Remise en service exige un contrôle APTE", "zh", "Remise en service sans contrôle",
    f"select public.moto_incident_avancer('{inc}', 'REMIS_EN_SERVICE', 'tentative sans controle')", False, "contrôle")
act("INC-12", "Contrôle de remise en service", "zh", "ZH enregistre le contrôle APTE",
    "select public.moto_controle_remise_en_service(" + lit({"moto_id": M1, "items": items_ok, "intervenant_nom": "MECANICIEN FICTIF", "compteur_km": 206}) + ")", True, "APTE")
act("INC-13", "Remise en service", "zh", "ZH remet en service", f"select public.moto_incident_avancer('{inc}', 'REMIS_EN_SERVICE', 'Freins conformes')")
act("INC-14", "Clôture", "zh", "ZH clôt l'incident avec coût réel", f"select public.moto_incident_avancer('{inc}', 'CLOS', 'Incident clos', 8000)")
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
mt = act("MNT-01", "Demande d'entretien terrain", "uh_sak", "UH demande une vidange",
         "select public.moto_maintenance_demander(" + lit({"moto_id": M1, "type_maintenance": "VIDANGE", "description": "Vidange à prévoir", "cout_estime": 5000, "client_op_id": str(uuid.uuid4())}) + ")", True, "DEMANDEE")
act("MNT-02", "Autorisation par un tiers", "zh", "ZH autorise", f"select public.moto_maintenance_decider('{mt['id']}', 'AUTORISEE')", True, "AUTORISEE")
act("MNT-03", "Démarrage : garage obligatoire", "zh", "Démarrage sans garage", f"select public.moto_maintenance_demarrer('{mt['id']}', '')", False, "Garage")
act("MNT-04", "Démarrage → immobilisation", "zh", "ZH démarre au garage fictif", f"select public.moto_maintenance_demarrer('{mt['id']}', 'GARAGE FICTIF')")
check("MNT-05", "Statut EN_REPARATION", "EN_REPARATION", f"select statut_technique from public.moto_motos where id='{M1}'", "EN_REPARATION")
act("MNT-06", "Clôture payante sans facture refusée", "zh", "Fin sans facture",
    "select public.moto_maintenance_terminer(" + lit({"maintenance_id": mt["id"], "cout_reel": 5000, "remettre_en_service": True, "compteur_km": 208}) + ")", False, "Facture")
fac = depot("zh", M1, "FACTURE", "maintenance", tid="MNT-07", label="ZH dépose la facture")
act("MNT-08", "Clôture avec facture", "zh", "Fin avec facture",
    "select public.moto_maintenance_terminer(" + lit({"maintenance_id": mt["id"], "cout_reel": 5000, "facture_document_id": fac["id"], "remettre_en_service": True, "compteur_km": 208}) + ")", True, "TERMINEE")
check("MNT-09", "Immobilisation accident toujours ouverte", "IMMOBILISEE", f"select statut_technique from public.moto_motos where id='{M1}'", "IMMOBILISEE")
act("MNT-10", "Aucune périodicité constructeur inventée", "bm", "Règle déclarée constructeur sans référence",
    "select public.moto_regle_maintenance_definir(" + lit({"code": "VIDANGE", "intervalle_km": 1000, "source": "CONSTRUCTEUR_VERIFIE", "actif": True, "motif": "test refus"}) + ")", False, "check")
act("MNT-11", "Règle paramétrée ANAGROCI", "bm", "BM paramètre vidange 1 000 km (paramètre de test)",
    "select public.moto_regle_maintenance_definir(" + lit({"code": "VIDANGE", "intervalle_km": 1000, "source": "PARAMETRE_ANAGROCI", "actif": True, "motif": "Paramètre de test local"}) + ")")
check("MNT-12", "Échéance calculée", "A_JOUR, prochaine à 1208 km", f"select statut||','||prochaine_km from public.moto_v_echeances where moto_id='{M1}' and regle='VIDANGE'", "A_JOUR,1208.0")
check("MNT-13", "Règles inactives par défaut", "2 règles inactives sans intervalle", "select count(*) from public.moto_regles_maintenance where not actif and intervalle_km is null", "2")

pn = act("PNE-01", "Pneu : identité propre", "abm", "Entrée en stock d'un pneu fictif",
         "select public.moto_pneu_creer(" + lit({"code": "PN-TEST-01", "marque": "MARQUE FICTIVE", "dimensions": "2.75-18", "cout_achat": 12000}) + ")")
pose = act("PNE-02", "Montage", "abm", "Montage arrière à 208 km", "select public.moto_pneu_poser(" + lit({"pneu_id": pn["id"], "moto_id": M1, "position": "ARRIERE", "pose_km": 208}) + ")")
pn2 = act("PNE-03a", "Pneu : identité propre", "abm", "Entrée en stock d'un second pneu fictif",
          "select public.moto_pneu_creer(" + lit({"code": "PN-TEST-02", "marque": "MARQUE FICTIVE", "dimensions": "2.75-18"}) + ")")
act("PNE-03", "Un pneu par position", "abm", "Second pneu à la même position",
    "select public.moto_pneu_poser(" + lit({"pneu_id": pn2["id"], "moto_id": M1, "position": "ARRIERE", "pose_km": 208}) + ")", False, "déjà monté")
act("PNE-04", "Réparation tracée", "zh", "Réparation crevaison", "select public.moto_pneu_reparation(" + lit({"pneu_id": pn["id"], "moto_id": M1, "cout": 1000, "description": "Crevaison"}) + ")")
act("PNE-05", "Dépose et réforme", "abm", "Dépose à 708 km, réforme",
    "select public.moto_pneu_deposer(" + lit({"pose_id": pose["id"], "depose_km": 708, "motif_depose": "Usure fictive", "destination": "REFORME"}) + ")", True, "500")
check("PNE-06", "Coût par km sur données réelles", "(12000+1000)/500 = 26.00 FCFA/km", "select fcfa_km_vie_complete from public.moto_v_pneus where code='PN-TEST-01'", "26.00")

# ---------------------------------------------------------------------------
# I. Indicateurs, formation, régression
# ---------------------------------------------------------------------------
check("KPI-01", "Disponibilité : dénominateur présent", "taux calculé (non NULL)", f"select (taux_disponibilite_pct is not null)::text from public.moto_v_disponibilite where moto_id='{M1}'", "true")
check("KPI-02", "Disponibilité : moto non en service → absente (Non disponible)", "0", f"select count(*) from public.moto_v_disponibilite where moto_id='{M3}'", "0")
check("KPI-03", "Coût/km : dotations et remboursements exclus", "carburant vérifié 7650 + maintenance 5000 + pneus 13000 + incident 8000",
      f"select cout_carburant_verifie||'+'||cout_maintenance||'+'||cout_pneus||'+'||cout_incidents from public.moto_v_cout_km where moto_id='{M1}'", "7650+5000+13000+8000")
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
act("BEN-01", "Liste des bénéficiaires : ABM", "abm", "ABM liste les bénéficiaires éligibles (Unit/Zonal Head actifs)", "select count(*) from public.moto_beneficiaires()", True, "5")
act("BEN-02", "Liste des bénéficiaires : refusée au Chef d'unité", "uh_sak", "UH liste les bénéficiaires", "select count(*) from public.moto_beneficiaires()", False, "rôle")
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

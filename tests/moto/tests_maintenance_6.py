#!/usr/bin/env python3
"""
AFLP FLEET — recette de la migration 6 (maintenance, garages, autorisation BM).

Les 25 scénarios du mandat « Phase 2 » (§17) et des tests adversariaux
(appels RPC directs, écritures directes, hors ligne, contournements).
Chaque action s'exécute SOUS LE RÔLE `authenticated` (RLS active), avec un
compte FICTIF. Seule la préparation des motos de test (mise en service,
affectation) passe par le superutilisateur, pour isoler le circuit testé.
Aucune donnée réelle : comptes, motos, garages, montants sont fictifs.

Usage : PGHOST=/srv/pgtest PGPORT=54329 python3 tests/moto/tests_maintenance_6.py fbms_moto_test
Sortie : tests/moto/resultats/maintenance_6.json + tableau Markdown.
"""
import json, os, subprocess, sys, uuid, datetime

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST:
    sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_moto_test"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultats")

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
U = {"bm": uid(101), "abm": uid(102), "lc": uid(103), "zh": uid(104), "uh_a": uid(105), "uh_b": uid(106),
     "fin": uid(107), "uh_c": uid(108), "sup": uid(109), "bm2": uid(110)}
PROFILS = [
    ("bm", "BM6 FICTIF", "Branch Manager", None, None, None),
    ("bm2", "BM6 BIS FICTIF", "Branch Manager", None, None, None),
    ("abm", "ABM6 FICTIF", "Assistant Branch Manager", None, None, None),
    ("lc", "COORDINATEUR6 FICTIF", "Supervisor", None, None, "Logistics Coordinator"),
    ("zh", "ZH6 FICTIF (JACKSON simulé)", "Zonal Head", None, "GBEKE 1", None),
    ("uh_a", "UH6 A FICTIF", "Unit Head", "SAKASSOU", "GBEKE 1", None),
    ("uh_b", "UH6 B FICTIF", "Unit Head", "BROBO", "GBEKE 1", None),
    ("uh_c", "UH6 C FICTIF", "Unit Head", "SAKASSOU", "GBEKE 1", None),
    ("fin", "FINANCE6 FICTIF", "Finance", None, None, None),
    ("sup", "SUPERVISOR6 FICTIF", "Supervisor", "BROBO", None, None),
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
    RESULTS.append({"id": tid, "scenario": sc, "compte": user, "action": label, "attendu": attendu,
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
def piece(moto, cat):
    path = f"finmaint/{moto}/{cat}/{uuid.uuid4()}.pdf"; put_object(path); return path
def items(typ, ko=()):
    rows = json.loads(q(f"select json_agg(json_build_object('code', code, 'critique', critique) order by ordre) from public.moto_catalogue_points where type_controle='{typ}' and actif"))
    return [{"code": r["code"], "ok": r["code"] not in ko, "critique": r["critique"]} for r in rows]
def ech(moto, regle, cols="statut"):
    return f"select {cols} from public.moto_v_echeances where moto_id='{moto}' and regle='{regle}'"
def travaux_realises(mt, sauf=()):
    rows = json.loads(q(f"select coalesce(json_agg(json_build_object('id', id, 'op', operation_code)), '[]') from public.moto_maintenance_travaux where maintenance_id='{mt}' and statut='PREVU'"))
    return [{"id": r["id"], "realise": r["op"] not in sauf} for r in rows]

today = datetime.date.today()
def d(days): return str(today + datetime.timedelta(days=days))

# ---------------------------------------------------------------------------
# Préparation (superutilisateur) : comptes et motos fictifs mis en service
# ---------------------------------------------------------------------------
setup = []
for k, nom, role, cluster, zone, fonction in PROFILS:
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}6@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, fonction_operationnelle, actif) values "
                 f"('{U[k]}', '{k}6@example.invalid', '{nom}', '{role}', {('$c$'+cluster+'$c$') if cluster else 'null'}, "
                 f"{('$z$'+zone+'$z$') if zone else 'null'}, {('$f$'+fonction+'$f$') if fonction else 'null'}, true) on conflict do nothing;")
q("\n".join(setup))

def moto(user_benef, marque, modele, origine, jours_service, km0, cluster="SAKASSOU"):
    ok, out = run_as("abm", "select public.moto_creer(" + lit({k: v for k, v in {"marque": marque, "modele": modele, "cluster_code": cluster,
                     "date_reception": d(-jours_service - 1), "origine": origine, "motif": "Moto de test migration 6 (fictive)"}.items() if v is not None}) + ")")
    if not ok: raise RuntimeError(out)
    mid = json.loads(out)["id"]
    debut = f"now() - interval '{jours_service} days'"
    q(f"""update public.moto_motos set mise_en_service_at = {debut}, statut_affectation = 'REMISE', compteur_actuel_km = {km0}, origine = '{origine}' where id = '{mid}';
          insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, statut, date_debut, compteur_km, motif, cree_par)
          values ('{mid}', '{U[user_benef]}', '{cluster}', 'REMISE', 'ACTIVE', ({debut})::date, {km0}, 'Fixture test M6', '{U['abm']}');
          insert into public.moto_releves_km (moto_id, date_releve, compteur_km, source, saisi_par) values ('{mid}', {debut}, {km0}, 'REMISE', '{U['abm']}');
          insert into public.moto_controles (moto_id, type_controle, date_controle, compteur_km, items, anomalie_critique, resultat, realise_par)
          values ('{mid}', 'INSPECTION_INITIALE', {debut} - interval '1 hour', {km0}, '[]', false, 'APTE', '{U['abm']}');
          select private.moto_recalculer_statuts('{mid}');""")
    return mid

A1 = moto("uh_a", "APSONIC", "AP150-30", "NEUVE", 10, 0)            # neuve, suivi de km
A2 = moto("uh_b", "APSONIC", "AP150-30", "NEUVE", 65, 50, "BROBO")   # neuve, ancienne mise en service : échéance calendaire
A3 = moto("uh_c", "APSONIC", "AP150-30", "EN_EXPLOITATION", 5, 4200) # APSONIC déjà en exploitation, sans historique
J1 = moto("zh", None, None, "EN_EXPLOITATION", 270, 9000)            # moto ANAGROCI de JACKSON : modèle et historique inconnus
q(f"update public.moto_motos set observations='Moto ANAGROCI, modèle à confirmer (fictif)' where id='{J1}'")

# ---------------------------------------------------------------------------
# Règles : modèle, hypothèses, approbation BM
# ---------------------------------------------------------------------------
check("S03a", "3", "Les valeurs du mandat sont des brouillons « hypothèse » non approuvés", "select count(*) from public.moto_regles_versions where modele_code='APSONIC_AP150_30' and nature_source='HYPOTHESE' and statut='BROUILLON'", "3")
check("S01a", "1", "Avant association, une APSONIC n'a aucune règle (diagnostic à établir)", ech(A1, "VIDANGE"), "DIAGNOSTIC_INITIAL_REQUIS")
act("S01b", "1", "lc", "Coordinateur associe A1 au modèle APSONIC_AP150_30", f"select public.moto_modele_technique_definir('{A1}', 'APSONIC_AP150_30', 'Plaque constructeur et carte grise vérifiées (fictif)')", True, "APSONIC")
for m in (A2, A3): run_as("lc", f"select public.moto_modele_technique_definir('{m}', 'APSONIC_AP150_30', 'Plaque constructeur vérifiée (fictif)')")
act("S02a", "2", "lc", "Association du modèle APSONIC à la moto de JACKSON (marque inconnue)", f"select public.moto_modele_technique_definir('{J1}', 'APSONIC_AP150_30', 'Tentative d''application arbitraire')", False, "incompatible")
q(f"update public.moto_motos set marque='ANAGROCI' where id='{J1}'")
act("S02b", "2", "bm", "Même tentative par le BM, marque ANAGROCI", f"select public.moto_modele_technique_definir('{J1}', 'APSONIC_AP150_30', 'Tentative d''application arbitraire')", False, "incompatible")
check("S03b", "3", "Brouillons seulement : aucune échéance n'est produite pour A1", ech(A1, "VIDANGE"), "REGLE_NON_APPROUVEE")
hyp = q("select id from public.moto_regles_versions where modele_code='APSONIC_AP150_30' and regle_code='VIDANGE' and nature_source='HYPOTHESE'")
act("S03c", "3", "bm", "BM approuve une hypothèse non validée", f"select public.moto_regle_version_approuver('{hyp}', current_date, 'Approbation sans validation technique')", False, "hypothèse")
act("S03d", "3", "lc", "Coordinateur approuve une règle", f"select public.moto_regle_version_approuver('{hyp}', current_date, 'Tentative coordinateur sur une règle')", False, "rôle")
act("S03e", "3", "abm", "ABM approuve une règle", f"select public.moto_regle_version_approuver('{hyp}', current_date, 'Tentative ABM sur une règle de maintenance')", False, "rôle")
act("S03f", "3", "lc", "Règle « constructeur » sans référence documentaire", "select public.moto_regle_version_proposer(" + lit({"regle_code": "VIDANGE", "modele_code": "APSONIC_AP150_30",
    "intervalle_km": 1500, "nature_source": "CONSTRUCTEUR", "motif": "Prétendue prescription constructeur"}) + ")", False, "référence")
VERS = {}
for regle, km, j, rk, pk, rj, pj in (("VIDANGE", 1500, 60, 400, 200, 15, 7), ("ENTRETIEN", 1000, 30, 200, 100, 7, 3), ("REVISION", 5000, 180, 500, 250, 30, 14)):
    r = act(f"S03g-{regle}", "3", "lc", f"Coordinateur requalifie {regle} en politique interne (avis technique fictif)", "select public.moto_regle_version_proposer(" + lit({
        "regle_code": regle, "modele_code": "APSONIC_AP150_30", "intervalle_km": km, "intervalle_jours": j, "rappel_avant_km": rk, "proche_avant_km": pk,
        "rappel_avant_jours": rj, "proche_avant_jours": pj, "nature_source": "POLITIQUE_INTERNE",
        "reference_source": "Avis technique garage de référence FICTIF n° T-001", "motif": "Validation technique obtenue (scénario fictif)"}) + ")", True, "BROUILLON")
    VERS[regle] = r["id"]
check("S03h", "3", "Proposition validée mais non approuvée : toujours inactive", ech(A1, "VIDANGE"), "REGLE_NON_APPROUVEE")
for regle in VERS:
    act(f"S03i-{regle}", "3", "bm", f"BM approuve {regle} avec date d'effet", f"select public.moto_regle_version_approuver('{VERS[regle]}', current_date, 'Décision BM de test : politique interne')", True, "APPROUVEE")
check("S01c", "1", "A1 reçoit les 3 règles de son modèle, version et source tracées", f"select count(*)||'/'||min(source)||'/'||min(version) from public.moto_v_echeances where moto_id='{A1}' and version is not null", "3/POLITIQUE_INTERNE/2")
check("S02c", "2", "JACKSON ne reçoit pas les règles APSONIC", f"select string_agg(distinct statut, ',') from public.moto_v_echeances where moto_id='{J1}'", "DIAGNOSTIC_INITIAL_REQUIS")
check("S04a", "4", "APSONIC en exploitation sans entretien vérifié : état de référence requis, aucune base inventée", ech(A3, "VIDANGE", "statut||'/'||coalesce(prochaine_km::text,'null')"), "ETAT_REFERENCE_REQUIS/null")
check("S04b", "4", "Moto neuve : base = mise en service réelle, fiabilité signalée", ech(A1, "VIDANGE", "base_origine||'/'||base_km||'/'||prochaine_km"), "MISE_EN_SERVICE/0.0/1500.0")

# ---------------------------------------------------------------------------
# 5, 6. Alertes kilométriques et calendaires
# ---------------------------------------------------------------------------
palier = {}
for km, attendu in ((1050, "A_JOUR"), (1100, "RAPPEL"), (1300, "PROCHE"), (1500, "ATTEINTE"), (1501, "DEPASSEE")):
    run_as("uh_a", "select public.moto_releve_km(" + lit({"moto_id": A1, "compteur_km": km}) + ")")
    palier[km] = check(f"S05-{km}", "5", f"Vidange à {km} km depuis 0 : {attendu}", ech(A1, "VIDANGE", "statut||'/'||coalesce(declencheur,'-')"),
                       attendu + "/" + ("-" if attendu == "A_JOUR" else "KM"))
check("S05b", "5", "Seuils calculés depuis la base vérifiée (km restants exacts)", ech(A1, "VIDANGE", "km_restants"), "-1.0")
check("S06a", "6", "A2 : 65 jours, 50 km : l'échéance calendaire arrive avant le kilométrage", ech(A2, "VIDANGE", "statut||'/'||declencheur||'/'||(km_restants>1000)"), "DEPASSEE/JOURS/true")
check("S06b", "6", "Révision A2 (180 j, 5000 km) toujours à jour", ech(A2, "REVISION"), "A_JOUR")

# ---------------------------------------------------------------------------
# Garages
# ---------------------------------------------------------------------------
g = act("GAR-01", "9", "lc", "Coordinateur enregistre un garage fictif", "select public.moto_garage_enregistrer(" + lit({"nom": "GARAGE FICTIF CLUSTER", "localisation": "VILLAGE FICTIF",
        "clusters": ["SAKASSOU"], "types_interventions": ["VIDANGE", "ENTRETIEN", "REPARATION"], "conditions_garantie": "Aucune (fictif)"}) + ")")
G = g["id"]
check("GAR-02", "9", "Enregistré ne veut pas dire agréé : statut CANDIDAT", f"select statut from public.moto_garages where id='{G}'", "CANDIDAT")
act("GAR-03", "9", "lc", "Coordinateur approuve le garage", f"select public.moto_garage_statut('{G}', 'APPROUVE', 'Tentative d''agrément par le coordinateur')", False, "Branch Manager")
act("GAR-04", "9", "lc", "Coordinateur marque le garage évalué", f"select public.moto_garage_statut('{G}', 'EVALUE', 'Visite et essai réalisés (fictif)')", True, "EVALUE")
act("GAR-05", "9", "bm", "BM approuve le garage", f"select public.moto_garage_statut('{G}', 'APPROUVE', 'Agrément de test par le Branch Manager')", True, "APPROUVE")
act("GAR-06", "25", "uh_a", "Chef d'unité lit les garages", "select count(*) from public.moto_garages", True, "0")
act("GAR-07", "9", "lc", "Mise à jour partielle sans perte des clusters", "select public.moto_garage_enregistrer(" + lit({"id": G, "specialites": "Freinage (fictif)"}) + ")")
check("GAR-08", "9", "Clusters conservés après mise à jour partielle", f"select array_to_string(clusters, ',') from public.moto_garages where id='{G}'", "SAKASSOU")

# ---------------------------------------------------------------------------
# 7, 9-16. Circuit vidange A1 (devis 50 000, autorisé 40 000, supplément 10 000)
# ---------------------------------------------------------------------------
mt = act("S09a", "9", "uh_a", "Chef d'unité signale la vidange", "select public.moto_maintenance_demander(" + lit({"moto_id": A1, "type_maintenance": "VIDANGE",
         "description": "Vidange dépassée selon l'alerte", "client_op_id": str(uuid.uuid4())}) + ")", True, "DEMANDEE")["id"]
act("S09b", "9", "lc", "Coordinateur organise le diagnostic", "select public.moto_maintenance_diagnostic(" + lit({"maintenance_id": mt, "garage_id": G, "note": "Diagnostic gratuit au garage"}) + ")", True, "DIAGNOSTIC")
dev = piece(A1, "devis")
act("S09c", "9", "lc", "Devis sans pièce dans le stockage", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mt, "garage_id": G, "devis_montant": 50000,
    "devis_path": f"finmaint/{A1}/devis/absent.pdf", "travaux": [{"operation_code": "VIDANGE", "libelle": "Vidange"}], "justification": "Vidange dépassée de 1 km"}) + ")", False, "introuvable")
act("S09d", "9", "lc", "Coordinateur enregistre le devis (vidange + révision + pièces + main-d'œuvre)", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mt, "garage_id": G,
    "devis_montant": 50000, "devis_pieces": 30000, "devis_main_oeuvre": 20000, "devis_path": dev, "urgence": "PRIORITAIRE",
    "travaux": [{"operation_code": "VIDANGE", "libelle": "Vidange huile moteur"}, {"operation_code": "ENTRETIEN", "libelle": "Tension chaîne, freins"}],
    "justification": "Vidange dépassée selon l'échéance approuvée", "consequence_report": "Usure accélérée du moteur", "date_souhaitee": d(2)}) + ")", True, "DEVIS_RECU")
act("S14a", "14", "lc", "Programmation sans autorisation BM", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt, "montant_engage": 50000, "date_prevue": d(1)}) + ")", False, "autorisation")
act("S10a", "10", "bm", "BM se soumet une demande à lui-même", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mt, "objet": "TRAVAUX", "montant_demande": 50000, "perimetre": "Vidange et entretien selon devis"}) + ")", False, "rôle")
au = act("S09e", "9", "lc", "Coordinateur soumet 50 000 au BM", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mt, "objet": "TRAVAUX", "montant_demande": 50000,
         "perimetre": "Vidange et entretien selon devis du garage", "consequence_report": "Usure accélérée du moteur"}) + ")", True, "EN_ATTENTE")["id"]
act("S09f", "9", "lc", "Seconde demande simultanée sur le même dossier", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mt, "objet": "TRAVAUX", "montant_demande": 1000, "perimetre": "Doublon de demande"}) + ")", False, "déjà en attente")
check("S09g", "9", "Dossier en attente BM, aucun engagement", f"select statut||'/'||montant_engage from public.moto_maintenances where id='{mt}'", "EN_ATTENTE_BM/0")
act("S10b", "10", "lc", "Coordinateur autorise sa propre demande", f"select public.moto_autorisation_decider('{au}', 'AUTORISEE', 50000, null)", False, "rôle")
act("S11a", "11", "zh", "Chef de zone autorise la dépense", f"select public.moto_autorisation_decider('{au}', 'AUTORISEE', 50000, null)", False, "rôle")
act("S11b", "11", "zh", "Chef de zone engage (programme) la dépense", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt, "montant_engage": 50000, "date_prevue": d(1)}) + ")", False, "rôle")
act("S11c", "11", "zh", "Chef de zone par l'ancienne fonction de décision", f"select public.moto_maintenance_decider('{mt}', 'AUTORISEE')", False, "rôle")
act("S12a", "12", "abm", "ABM autorise à la place du BM", f"select public.moto_autorisation_decider('{au}', 'AUTORISEE', 50000, null)", False, "rôle")
act("S12b", "12", "abm", "ABM engage sans décision BM", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt, "montant_engage": 50000, "date_prevue": d(1)}) + ")", False, "autorisation")
act("ADV-01", "11", "lc", "Écriture directe : insertion d'une autorisation", f"insert into public.moto_autorisations (maintenance_id, moto_id, rang, objet, perimetre, montant_demande, justification, consequence_report, statut) values ('{mt}', '{A1}', 9, 'TRAVAUX', 'contournement direct', 1, 'contournement direct', 'aucune', 'AUTORISEE')", False, "permission")
act("ADV-02", "11", "bm", "Écriture directe : BM passe la demande en AUTORISEE", f"update public.moto_autorisations set statut='AUTORISEE', montant_autorise=50000 where id='{au}'", False, "permission")
act("ADV-03", "11", "lc", "Écriture directe : montant engagé modifié", f"update public.moto_maintenances set montant_engage=50000, statut='PROGRAMMEE' where id='{mt}'", False, "permission")
act("ADV-04", "15", "bm", "BM autorise plus que demandé", f"select public.moto_autorisation_decider('{au}', 'AUTORISEE', 60000, null)", False, "au plus")
act("ADV-05", "15", "bm", "BM réduit le montant sans commentaire", f"select public.moto_autorisation_decider('{au}', 'AUTORISEE', 40000, null)", False, "Motif")
act("S15a", "15", "bm", "BM autorise 40 000 sur un devis de 50 000, commenté", f"select public.moto_autorisation_decider('{au}', 'AUTORISEE', 40000, 'Entretien chaîne à refaire chiffrer séparément')", True, "40000")
act("ADV-06", "15", "bm", "Décider deux fois la même demande", f"select public.moto_autorisation_decider('{au}', 'AUTORISEE', 50000, 'Seconde décision')", False, "déjà décidée")
check("S15b", "15", "Décision nominative et horodatée conservée", f"select (decide_par='{U['bm']}')::text||'/'||(decide_at is not null)::text||'/'||montant_autorise from public.moto_autorisations where id='{au}'", "true/true/40000")
act("S15c", "15", "lc", "Engager la totalité du devis (50 000) avec 40 000 autorisés", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt, "montant_engage": 50000, "date_prevue": d(0)}) + ")", False, "plafond")
act("S15d", "15", "lc", "Garage différent du garage autorisé", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt, "montant_engage": 40000, "date_prevue": d(0), "garage_id": str(uuid.uuid4())}) + ")", False, "Garage différent")
act("S15e", "15", "lc", "Programmation dans le plafond (40 000)", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt, "montant_engage": 40000, "date_prevue": d(0), "date_fin_prevue": d(1)}) + ")", True, "PROGRAMMEE")
act("S15f", "15", "lc", "Démarrage des travaux", f"select public.moto_maintenance_demarrer('{mt}', null, current_date)", True, "EN_COURS")
# Supplément : travaux supplémentaires découverts au garage
act("S16a", "16", "lc", "Supplément chiffré par le garage", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mt, "garage_id": G, "devis_montant": 10000, "devis_path": piece(A1, "devis"),
    "travaux": [{"operation_code": "REPARATION", "libelle": "Remplacement plaquettes arrière"}], "justification": "Usure plaquettes constatée au démontage"}) + ")", True, "EN_COURS")
au2 = act("S16b", "16", "lc", "Supplément soumis au BM", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mt, "objet": "SUPPLEMENT", "montant_demande": 10000,
          "perimetre": "Plaquettes arrière découvertes au démontage", "consequence_report": "Freinage dégradé"}) + ")", True, "EN_ATTENTE")["id"]
act("S16c", "16", "lc", "Engager le supplément avant décision", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt, "montant_engage": 50000}) + ")", False, "plafond")
act("S24a", "24", "bm", "« Décisions à prendre » : seulement la demande en attente, montant demandé et déjà autorisé distincts", f"select count(*)||'/'||max(montant_demande)||'/'||max(deja_autorise) from public.moto_v_decisions_bm where statut='EN_ATTENTE' and maintenance_id='{mt}'", True, "1/10000/40000")
act("S16d", "16", "bm", "BM autorise le supplément", f"select public.moto_autorisation_decider('{au2}', 'AUTORISEE', 10000, null)", True, "AUTORISEE")
act("S16e", "16", "lc", "Engagement porté à 50 000 après le supplément", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt, "montant_engage": 50000}) + ")", True, "50000")
# Factures
fp = piece(A1, "facture")
f1 = act("S18a", "18", "lc", "Facture garage 50 000 déposée", "select public.moto_facture_deposer(" + lit({"maintenance_id": mt, "numero_facture": "FG-TEST-001", "date_facture": d(0), "montant": 50000, "document_path": fp}) + ")", True, "\"hors_autorisation\": false")["id"]
act("S18b", "18", "lc", "Même numéro de facture, même garage", "select public.moto_facture_deposer(" + lit({"maintenance_id": mt, "numero_facture": "fg-test-001 ", "date_facture": d(0), "montant": 50000, "document_path": piece(A1, "facture")}) + ")", False, "duplicate")
act("S18c", "18", "lc", "Même pièce pour une seconde facture", "select public.moto_facture_deposer(" + lit({"maintenance_id": mt, "numero_facture": "FG-TEST-002", "date_facture": d(0), "montant": 1000, "document_path": fp}) + ")", False, "duplicate")
act("S18d", "18", "lc", "Pièce d'une autre moto", "select public.moto_facture_deposer(" + lit({"maintenance_id": mt, "numero_facture": "FG-TEST-003", "date_facture": d(0), "montant": 1000, "document_path": piece(A2, "facture")}) + ")", False, "non conforme")
# 7, 21. Travaux effectués, pas encore vérifiés
act("S21a", "21", "uh_a", "Utilisateur déclare les travaux de sa moto terminés", "select public.moto_maintenance_terminer(" + lit({"maintenance_id": mt, "compteur_km": 1510, "date_realisation": d(0), "travaux": travaux_realises(mt)}) + ")", False, "rôle")
act("S21b", "21", "lc", "Fin des travaux sans kilométrage (inconnu ≠ 0)", "select public.moto_maintenance_terminer(" + lit({"maintenance_id": mt, "date_realisation": d(0), "travaux": travaux_realises(mt)}) + ")", False, "Kilométrage")
act("S21c", "21", "lc", "Fin des travaux : vidange et plaquettes faites, entretien chaîne non fait", "select public.moto_maintenance_terminer(" + lit({"maintenance_id": mt, "compteur_km": 1510,
    "date_realisation": d(0), "pieces_remplacees": "Huile, filtre, plaquettes AR (fictif)", "travaux": travaux_realises(mt, sauf=("ENTRETIEN",))}) + ")", True, "TERMINEE")
check("S21d", "21", "Terminé ≠ vérifié : l'échéance de vidange n'est pas encore actualisée", ech(A1, "VIDANGE", "base_origine||'/'||statut"), "MISE_EN_SERVICE/DEPASSEE")
im = q(f"select id from public.moto_immobilisations where source_type='MAINTENANCE' and source_id='{mt}' and fin is null")
act("S20a", "20", "bm", "Levée de l'immobilisation avant contrôle des travaux", f"select public.moto_lever_immobilisation('{im}', 'Travaux annoncés terminés')", False, "pas contrôlés")
act("S21e", "21", "lc", "Celui qui déclare les travaux les contrôle", f"select public.moto_maintenance_controler('{mt}', 'CONFORME', 'Auto-contrôle des travaux')", False, "Séparation")
act("S21f", "21", "zh", "Contrôle technique NON CONFORME (fuite)", f"select public.moto_maintenance_controler('{mt}', 'NON_CONFORME', 'Fuite au bouchon de vidange constatée')", True, "EN_COURS")
act("S21g", "21", "lc", "Reprise des travaux déclarée", "select public.moto_maintenance_terminer(" + lit({"maintenance_id": mt, "compteur_km": 1512, "date_realisation": d(0), "travaux": travaux_realises(mt)}) + ")", True, "TERMINEE")
act("S21h", "21", "zh", "Contrôle technique CONFORME", f"select public.moto_maintenance_controler('{mt}', 'CONFORME', 'Étanchéité et freinage vérifiés')", True, "CONTROLEE")
check("S07a", "7", "Vidange vérifiée : son échéance repart de la réalisation contrôlée", ech(A1, "VIDANGE", "base_origine||'/'||base_km||'/'||prochaine_km||'/'||statut"), "ENTRETIEN_VERIFIE/1512.0/3012.0/A_JOUR")
check("S07b", "7", "La révision générale n'est pas remise à zéro par la vidange", ech(A1, "REVISION", "base_origine||'/'||base_km"), "MISE_EN_SERVICE/0.0")
check("S07c", "7", "L'entretien non réalisé n'est pas actualisé", ech(A1, "ENTRETIEN", "base_origine"), "MISE_EN_SERVICE")
check("S22a", "22", "Historique individuel des travaux conservé", f"select string_agg(operation_code||':'||statut, ',' order by created_at) from public.moto_maintenance_travaux where maintenance_id='{mt}'",
      "VIDANGE:REALISE,ENTRETIEN:NON_REALISE,REPARATION:REALISE")
check("S22b", "22", "Journal : chaque étape du dossier tracée", f"select (count(*) >= 10)::text from public.moto_journal where table_nom='moto_maintenances' and enregistrement_id='{mt}'", "true")
check("S22c", "22", "Deux autorisations conservées (initiale + supplément)", f"select string_agg(objet||':'||montant_autorise, ',' order by rang) from public.moto_autorisations where maintenance_id='{mt}'", "TRAVAUX:40000,SUPPLEMENT:10000")
# 20. Remise en circulation
act("S20b", "20", "bm", "Levée sans contrôle de remise en service APTE", f"select public.moto_lever_immobilisation('{im}', 'Travaux contrôlés')", False, "APTE")
act("S20c", "20", "lc", "Contrôle de remise en service APTE (coordinateur)", "select public.moto_controle_remise_en_service(" + lit({"moto_id": A1, "items": items("REMISE_EN_SERVICE"), "intervenant_nom": "MECANICIEN FICTIF", "compteur_km": 1512}) + ")", True, "APTE")
act("S20d", "20", "lc", "Le coordinateur lève lui-même", f"select public.moto_lever_immobilisation('{im}', 'Levée par le coordinateur')", False, "rôle")
act("S20e", "20", "bm", "Levée par le BM, indépendant du contrôle", f"select public.moto_lever_immobilisation('{im}', 'Travaux contrôlés, contrôle APTE')", True, "true")
# Vérification et paiement
act("S18e", "18", "lc", "Le déposant vérifie sa facture", f"select public.moto_facture_verifier('{f1}', 'VERIFIEE', null)", False, "rôle")
act("S12c", "12", "abm", "ABM vérifie la facture (pièces), dans le plafond autorisé", f"select public.moto_facture_verifier('{f1}', 'VERIFIEE', null)", True, "VERIFIEE")
act("S24b", "24", "bm", "Six montants distincts : estimé / autorisé / engagé / facturé / justifié / payé", f"select cout_estime||'/'||montant_autorise||'/'||montant_engage||'/'||montant_facture||'/'||montant_justifie||'/'||montant_paye from public.moto_v_maintenance_dossiers where id='{mt}'",
    True, "60000/50000/50000/50000/50000/0")
act("S24c", "24", "abm", "L'ABM ne constate pas un paiement (Finance seulement)", f"select public.moto_facture_paiement_constater('{f1}', 50000, current_date, 'VIR-TEST')", False, "rôle")
act("S24d", "24", "fin", "Finance constate un paiement partiel", f"select public.moto_facture_paiement_constater('{f1}', 30000, current_date, 'VIR-TEST-01')", True, "30000")
act("S24e", "24", "bm", "Payé ≠ justifié : aucun paiement déduit de la validation", f"select montant_justifie||'/'||montant_paye from public.moto_v_maintenance_dossiers where id='{mt}'", True, "50000/30000")
act("S22d", "22", "fin", "Clôture financière (distincte de la technique)", f"select public.moto_maintenance_cloturer('{mt}', 'Pièces vérifiées')", True, "CLOTUREE")
act("S18f", "18", "bm", "Coût de flotte : la facture est comptée une seule fois", f"select cout_maintenance from public.moto_v_couts where moto_id='{A1}'", True, "50000")

# ---------------------------------------------------------------------------
# 13, 14, 17, 18. Enveloppe, hors ligne, dépenses rattachées
# ---------------------------------------------------------------------------
per = str(today.replace(day=1))
env = act("S13a", "13", "lc", "Coordinateur demande une enveloppe d'entretien", "select public.moto_enveloppe_demander(" + lit({"type_enveloppe": "ENTRETIEN", "periode": per, "montant_demande": 100000,
          "justification": "Budget mensuel entretien (fictif)"}) + ")", True, "DEMANDEE")["id"]
act("S13b", "13", "bm", "BM approuve le budget mensuel", f"select public.moto_enveloppe_decider('{env}', 'APPROUVEE', null, null)", True, "APPROUVEE")
act("S13c", "13", "lc", "Dépense de maintenance sur budget approuvé, sans autorisation individuelle", "select public.moto_depense_declarer(" + lit({"enveloppe_id": env, "date_depense": d(0), "montant": 5000,
    "objet": "Huile achetée en urgence", "moto_id": A2}) + ")", False, "même sur une enveloppe approuvée")
act("S13d", "13", "lc", "Même dépense étiquetée « supervision » sur l'enveloppe d'entretien", "select public.moto_depense_declarer(" + lit({"enveloppe_id": env, "date_depense": d(0), "montant": 5000,
    "objet": "Huile achetée en urgence", "nature": "SUPERVISION"}) + ")", False, "Branch Manager")
act("S14b", "14", "lc", "Dépense rattachée à une facture inexistante", "select public.moto_depense_declarer(" + lit({"enveloppe_id": env, "date_depense": d(0), "montant": 5000,
    "objet": "Huile achetée en urgence", "facture_id": str(uuid.uuid4())}) + ")", False, "Branch Manager")
act("S14c", "14", "lc", "Règlement au-delà du reste dû (50 000 facturés, 30 000 déjà payés)", "select public.moto_depense_declarer(" + lit({"enveloppe_id": env, "date_depense": d(0), "montant": 25000,
    "objet": "Règlement garage au-delà", "facture_id": f1}) + ")", False, "reste dû")
act("S18g", "18", "lc", "Règlement du reste dû par l'enveloppe (20 000), rattaché à la facture vérifiée", "select public.moto_depense_declarer(" + lit({"enveloppe_id": env, "date_depense": d(0), "montant": 20000,
    "objet": "Règlement facture FG-TEST-001", "facture_id": f1}) + ")", True, "MAINTENANCE")
act("R01a", "18", "fin", "Revue : paiement constaté au-delà du reste dû (enveloppe comprise)", f"select public.moto_facture_paiement_constater('{f1}', 1, current_date, 'VIR-TEST-X')", False, "reste dû")
act("S18h", "18", "bm", "Le règlement par enveloppe n'est pas ajouté une seconde fois au coût du parc", f"select cout_maintenance from public.moto_v_couts where moto_id='{A1}'", True, "50000")
act("S14d", "14", "lc", "Réparation de pneu payante sans autorisation", "select public.moto_pneu_reparation(" + lit({"pneu_id": q("select id from public.moto_pneus limit 1") or str(uuid.uuid4()), "moto_id": A2, "cout": 2000, "description": "Crevaison"}) + ")", False, "Branch Manager")
# Hors ligne
cop = str(uuid.uuid4())
lot = [{"type": "MAINTENANCE_DEMANDE", "client_op_id": cop, "payload": {"moto_id": A2, "type_maintenance": "VIDANGE", "description": "Vidange signalée hors ligne",
        "statut": "AUTORISEE", "montant_autorise": 30000, "autorise_par": U["bm"]}},
       {"type": "AUTORISATION_DECIDER", "client_op_id": str(uuid.uuid4()), "payload": {"autorisation_id": au2, "decision": "AUTORISEE"}},
       {"type": "DEPENSE", "client_op_id": str(uuid.uuid4()), "payload": {"enveloppe_id": env, "date_depense": d(0), "montant": 3000, "objet": "Dépense saisie hors ligne", "moto_id": A2}}]
act("S17a", "17", "uh_b", "Lot hors ligne : demande avec « autorisation » injectée, décision, dépense", "select string_agg(x->>'statut', ',') from jsonb_array_elements(public.moto_sync_batch(" + lit(lot) + ")) x", True, "SYNCHRONISE,REJETE,REJETE")
check("S17b", "17", "La demande hors ligne reste une demande, sans autorisation créée", f"select statut||'/'||(select count(*) from public.moto_autorisations a where a.maintenance_id=mt.id) from public.moto_maintenances mt where client_op_id='{cop}'", "DEMANDEE/0")
act("S17c", "17", "lc", "Dépense de maintenance hors ligne sans autorisation", "select string_agg(x->>'message', ',') from jsonb_array_elements(public.moto_sync_batch(" + lit([{**lot[2], "client_op_id": str(uuid.uuid4())}]) + ")) x", True, "Branch Manager")

# ---------------------------------------------------------------------------
# 8. Contrôle préventif ≠ facture ; intervention interne sans frais
# ---------------------------------------------------------------------------
avant = q("select count(*)||'/'||(select count(*) from public.moto_maintenances) from public.moto_factures")
act("S08a", "8", "uh_b", "Contrôle avant départ conforme", "select public.moto_controle_depart(" + lit({"moto_id": A2, "items": items("AVANT_DEPART"), "compteur_km": 60, "client_op_id": str(uuid.uuid4())}) + ")", True, "APTE")
check("S08b", "8", "Le contrôle ne crée ni dossier ni facture", "select count(*)||'/'||(select count(*) from public.moto_maintenances) from public.moto_factures", avant)
mt8 = act("S08c", "8", "lc", "Entretien préventif interne demandé", "select public.moto_maintenance_demander(" + lit({"moto_id": A2, "type_maintenance": "ENTRETIEN_PREVENTIF", "description": "Contrôle préventif chaîne et freins"}) + ")", True, "DEMANDEE")["id"]
act("S08d", "8", "lc", "Opérations prévues (sans devis payant)", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mt8, "garage_id": G, "devis_montant": 0,
    "travaux": [{"operation_code": "ENTRETIEN", "libelle": "Tension chaîne, réglage freins"}], "justification": "Contrôle préventif sans pièce à remplacer"}) + ")", True, "DEVIS_RECU")
act("R05", "14", "lc", "Revue : le coordinateur qualifie seul « sans frais »", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt8, "sans_frais": True, "sans_frais_motif": "Intervention interne du coordinateur", "date_prevue": d(0)}) + ")", False, "Branch Manager")
act("S08e", "8", "bm", "« Sans frais » avec un montant engagé", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt8, "sans_frais": True, "sans_frais_motif": "Intervention interne du coordinateur", "montant_engage": 2000, "date_prevue": d(0)}) + ")", False, "aucun montant")
act("S08f", "8", "bm", "Intervention interne qualifiée sans frais par le BM", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt8, "sans_frais": True, "sans_frais_motif": "Intervention interne du coordinateur", "date_prevue": d(0)}) + ")", True, "PROGRAMMEE")
act("S08g", "8", "lc", "Démarrage", f"select public.moto_maintenance_demarrer('{mt8}', null, current_date)", True, "EN_COURS")
f8 = act("S14e", "14", "lc", "Facture déposée sur une intervention sans frais", "select public.moto_facture_deposer(" + lit({"maintenance_id": mt8, "numero_facture": "FG-TEST-SF", "date_facture": d(0), "montant": 7000, "document_path": piece(A2, "facture")}) + ")", True, "\"hors_autorisation\": true")["id"]
act("S14f", "14", "fin", "Une facture ne régularise pas une dépense non autorisée", f"select public.moto_facture_verifier('{f8}', 'VERIFIEE', null)", False, "hors autorisation")
act("S24f", "24", "bm", "Exception BM : facture hors autorisation signalée", f"select count(*) from public.moto_v_exceptions_bm where type='FACTURE_HORS_AUTORISATION' and moto_code=(select code from public.moto_motos where id='{A2}')", True, "1")
act("S14g", "14", "fin", "Rejet motivé de la facture", f"select public.moto_facture_verifier('{f8}', 'REJETEE', 'Aucune autorisation BM préalable')", True, "REJETEE")

# ---------------------------------------------------------------------------
# 19, 20. Défaut critique : facture payée ≠ moto apte
# ---------------------------------------------------------------------------
act("S19a", "19", "uh_c", "Freins avant KO au départ sur A3", "select public.moto_controle_depart(" + lit({"moto_id": A3, "items": items("AVANT_DEPART", ko=("FREIN_AVANT",)), "compteur_km": 4210, "client_op_id": str(uuid.uuid4())}) + ")", True, "INAPTE")
inc = q(f"select id from public.moto_incidents where moto_id='{A3}' order by declare_at desc limit 1")
act("S19b", "19", "zh", "Diagnostic de l'incident", f"select public.moto_incident_avancer('{inc}', 'DIAGNOSTIC', 'Disque et plaquettes usés')", True, "DIAGNOSTIC")
act("S19c", "19", "zh", "Le Chef de zone « autorise » la dépense dans l'incident", f"select public.moto_incident_avancer('{inc}', 'AUTORISATION_DEPENSE', 'Accord du chef de zone', 15000)", False, "Aucun montant")
mt19 = act("S19d", "19", "lc", "Dossier lié à l'incident", "select public.moto_maintenance_demander(" + lit({"moto_id": A3, "type_maintenance": "REPARATION", "description": "Remplacement disque et plaquettes", "incident_id": inc, "urgence": "SECURITE"}) + ")", True, "DEMANDEE")["id"]
run_as("lc", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mt19, "garage_id": G, "devis_montant": 15000, "devis_path": piece(A3, "devis"),
       "travaux": [{"operation_code": "REPARATION", "libelle": "Disque et plaquettes avant"}], "justification": "Freinage avant inopérant", "urgence": "SECURITE"}) + ")")
au19 = act("S19e", "19", "lc", "Soumission urgente au BM", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mt19, "objet": "TRAVAUX", "montant_demande": 15000, "perimetre": "Disque et plaquettes avant selon devis", "consequence_report": "Moto dangereuse, à l'arrêt"}) + ")", True, "EN_ATTENTE")["id"]
check("S19f", "19", "En attente de décision, la moto reste immobilisée", f"select statut_technique from public.moto_motos where id='{A3}'", "IMMOBILISEE")
act("S19g", "19", "bm", "BM autorise", f"select public.moto_autorisation_decider('{au19}', 'AUTORISEE', 15000, null)", True, "AUTORISEE")
run_as("lc", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mt19, "montant_engage": 15000, "date_prevue": d(0)}) + ")")
run_as("lc", f"select public.moto_maintenance_demarrer('{mt19}', null, current_date)")
f19 = act("S19h", "19", "lc", "Facture déposée", "select public.moto_facture_deposer(" + lit({"maintenance_id": mt19, "numero_facture": "FG-TEST-019", "date_facture": d(0), "montant": 15000, "document_path": piece(A3, "facture")}) + ")", True, "DEPOSEE")["id"]
act("S19i", "19", "abm", "Facture vérifiée", f"select public.moto_facture_verifier('{f19}', 'VERIFIEE', null)", True, "VERIFIEE")
act("S19j", "19", "fin", "Facture payée en totalité", f"select public.moto_facture_paiement_constater('{f19}', 15000, current_date, 'VIR-TEST-19')", True, "15000")
check("S19k", "19", "Facture payée, travaux non déclarés : la moto reste immobilisée", f"select statut_technique||'/'||(select autorisee_a_circuler from public.moto_v_flotte where id='{A3}') from public.moto_motos where id='{A3}'", "EN_REPARATION/false")
act("S19l", "19", "bm", "Levée de l'immobilisation d'incident par la levée simple", f"select public.moto_lever_immobilisation((select id from public.moto_immobilisations where source_type='INCIDENT' and source_id='{inc}'), 'Facture payée')", False, "circuit de l'incident")
run_as("zh", f"select public.moto_incident_avancer('{inc}', 'AUTORISATION_DEPENSE', 'Autorisation BM du dossier constatée')")
run_as("zh", f"select public.moto_incident_avancer('{inc}', 'REPARATION', 'Garage intervient')")
run_as("zh", f"select public.moto_incident_avancer('{inc}', 'CONTROLE', 'Contrôle à réaliser')")
act("S20f", "20", "abm", "Contrôle de remise en service APTE", "select public.moto_controle_remise_en_service(" + lit({"moto_id": A3, "items": items("REMISE_EN_SERVICE"), "intervenant_nom": "MECANICIEN FICTIF", "compteur_km": 4210}) + ")", True, "APTE")
act("S20g", "20", "zh", "Remise en service : travaux payés mais non contrôlés", f"select public.moto_incident_avancer('{inc}', 'REMIS_EN_SERVICE', 'Facture payée, tout est réglé')", False, "travaux")

# ---------------------------------------------------------------------------
# 2 (suite). JACKSON : diagnostic initial, exception documentée, sans historique inventé
# ---------------------------------------------------------------------------
act("S02d", "2", "lc", "Exception par moto sans référence documentaire", "select public.moto_regle_version_proposer(" + lit({"regle_code": "VIDANGE", "moto_id": J1, "intervalle_km": 1500,
    "nature_source": "POLITIQUE_INTERNE", "motif": "Exception pour la moto de JACKSON"}) + ")", False, "référence")
vj = act("S02e", "2", "lc", "Exception documentée après diagnostic (fictif)", "select public.moto_regle_version_proposer(" + lit({"regle_code": "VIDANGE", "moto_id": J1, "intervalle_km": 1500, "intervalle_jours": 60,
    "nature_source": "POLITIQUE_INTERNE", "reference_source": "Diagnostic initial garage FICTIF D-77", "motif": "Exception pour la moto de JACKSON après diagnostic"}) + ")", True, "BROUILLON")["id"]
act("S02f", "2", "bm", "BM approuve l'exception", f"select public.moto_regle_version_approuver('{vj}', current_date, 'Exception documentée validée')", True, "APPROUVEE")
check("S02g", "2", "Exception approuvée, mais aucun entretien vérifié : état de référence requis (pas d'échéance depuis février)", ech(J1, "VIDANGE", "statut||'/'||coalesce(base_date::text,'null')"), "ETAT_REFERENCE_REQUIS/null")
check("S02h", "2", "Les autres opérations de JACKSON restent à établir", ech(J1, "REVISION"), "DIAGNOSTIC_INITIAL_REQUIS")
check("S02i", "2", "L'exception de JACKSON ne s'applique à aucune autre moto", f"select count(*) from public.moto_v_echeances where moto_id<>'{J1}' and exception_moto", "0")

# ---------------------------------------------------------------------------
# 25. Confidentialité des pièces et montants
# ---------------------------------------------------------------------------
act("S25a", "25", "uh_a", "Chef d'unité lit les autorisations", "select count(*) from public.moto_autorisations", True, "0")
act("S25b", "25", "zh", "Chef de zone lit les factures", "select count(*) from public.moto_factures", True, "0")
act("S25c", "25", "zh", "Chef de zone : montants masqués dans les dossiers", f"select coalesce(montant_autorise::text,'masqué')||'/'||coalesce(cout_estime::text,'masqué') from public.moto_v_maintenance_dossiers where id='{mt}'", True, "masqué/masqué")
act("S25d", "25", "uh_a", "Chef d'unité lit les pièces financières stockées", "select count(*) from storage.objects where bucket_id='moto-documents' and name like 'finmaint/%'", True, "0")
act("S25e", "25", "uh_a", "Chef d'unité dépose une pièce financière", f"insert into storage.objects (bucket_id, name) values ('moto-documents', 'finmaint/{A1}/facture/x.pdf')", False, "row-level security")
act("S25f", "25", "lc", "Coordinateur lit les pièces financières", "select (count(*) > 0)::text from storage.objects where bucket_id='moto-documents' and name like 'finmaint/%'", True, "true")
act("S25g", "25", "anon", "Anonyme lit les décisions", "select count(*) from public.moto_v_decisions_bm", False, "permission")
act("S25h", "25", "sup", "Supervisor hors module lit les factures", "select count(*) from public.moto_factures", True, "0")
act("S25i", "25", "uh_a", "Chef d'unité lit « Décisions à prendre »", "select count(*) from public.moto_v_decisions_bm", True, "0")
check("S25j", "25", "Aucune fonction moto exécutable par anon", "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'moto%' and has_function_privilege('anon', p.oid, 'execute')", "0")
check("S25k", "25", "RLS active sur toutes les tables de la migration 6", "select count(*) from pg_class where relname in ('moto_modeles_techniques','moto_regles_versions','moto_garages','moto_maintenance_travaux','moto_autorisations','moto_factures') and relrowsecurity", "6")

# ---------------------------------------------------------------------------
# Adversariaux complémentaires
# ---------------------------------------------------------------------------
q(f"update public.moto_affectations set statut='CLOTUREE' where moto_id='{A2}' and statut='ACTIVE'")
q(f"insert into public.moto_affectations (moto_id, beneficiaire_id, cluster_code, type_affectation, statut, date_debut, motif, cree_par) values ('{A2}', '{U['bm2']}', 'BROBO', 'REMISE', 'ACTIVE', current_date, 'Fixture : moto du BM', '{U['abm']}')")
mtb = run_as("lc", "select public.moto_maintenance_demander(" + lit({"moto_id": A2, "type_maintenance": "REPARATION", "description": "Réparation sur la moto du BM"}) + ")")
mtb = json.loads(mtb[1])["id"]
run_as("lc", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mtb, "garage_id": G, "devis_montant": 5000, "devis_path": piece(A2, "devis"), "travaux": [{"operation_code": "REPARATION", "libelle": "Rétroviseur"}], "justification": "Rétroviseur cassé (fictif)"}) + ")")
aub = json.loads(run_as("lc", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mtb, "objet": "TRAVAUX", "montant_demande": 5000, "perimetre": "Rétroviseur selon devis", "consequence_report": "Visibilité réduite"}) + ")")[1])["id"]
act("ADV-07", "10", "bm2", "Le BM utilisateur de la moto autorise sa propre réparation", f"select public.moto_autorisation_decider('{aub}', 'AUTORISEE', 5000, null)", False, "Indépendance")
act("ADV-08", "10", "bm", "Un autre BM décide (refus motivé)", f"select public.moto_autorisation_decider('{aub}', 'REFUSEE', null, null)", False, "Motif")
act("ADV-09", "10", "bm", "Refus motivé par un BM indépendant", f"select public.moto_autorisation_decider('{aub}', 'REFUSEE', null, 'Réparation à reporter au mois prochain')", True, "REFUSEE")
act("ADV-10", "14", "lc", "Programmation après refus", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mtb, "montant_engage": 5000, "date_prevue": d(0)}) + ")", False, "autorisation")
act("ADV-11", "11", "zh", "Chef de zone : constat de paiement", f"select public.moto_facture_paiement_constater('{f1}', 1, current_date, 'X-TEST')", False, "rôle")
act("ADV-12", "11", "uh_a", "Chef d'unité appelle directement la décision BM", f"select public.moto_autorisation_decider('{aub}', 'AUTORISEE', 5000, null)", False, "rôle")
act("ADV-13", "3", "bm", "Approuver une version déjà approuvée", f"select public.moto_regle_version_approuver('{VERS['VIDANGE']}', current_date, 'Seconde approbation')", False, "déjà traitée")
vbm = json.loads(run_as("bm", "select public.moto_regle_version_proposer(" + lit({"regle_code": "REVISION", "modele_code": "APSONIC_AP150_30", "intervalle_km": 4000, "nature_source": "POLITIQUE_INTERNE",
      "reference_source": "Note BM FICTIVE de test quatre yeux", "motif": "Proposition du BM lui-même (revue)"}) + ")")[1])["id"]
act("R08c", "3", "bm", "Revue : le BM approuve sa propre proposition", f"select public.moto_regle_version_approuver('{vbm}', current_date, 'contrôle quatre yeux revue')", False, "Quatre yeux")
act("ADV-14", "3", "lc", "Nouvelle version VIDANGE (1 200 km) proposée par le coordinateur", "select public.moto_regle_version_proposer(" + lit({"regle_code": "VIDANGE", "modele_code": "APSONIC_AP150_30", "intervalle_km": 1200, "intervalle_jours": 60,
    "nature_source": "POLITIQUE_INTERNE", "reference_source": "Note technique FICTIVE v2 (conditions poussiéreuses)", "motif": "Raccourcissement pour pistes poussiéreuses"}) + ")", True, "BROUILLON")
v3 = q("select id from public.moto_regles_versions where regle_code='VIDANGE' and modele_code='APSONIC_AP150_30' and statut='BROUILLON' and intervalle_km=1200")
act("ADV-15", "3", "bm", "Approbation de la version 3", f"select public.moto_regle_version_approuver('{v3}', current_date, 'Nouvelle politique interne')", True, "APPROUVEE")
check("ADV-16", "22", "Historique des paramètres : v2 remplacée conservée, v3 active", "select string_agg(version||':'||statut, ',' order by version) from public.moto_regles_versions where regle_code='VIDANGE' and modele_code='APSONIC_AP150_30' and nature_source<>'HYPOTHESE'", "2:REMPLACEE,3:APPROUVEE")
check("ADV-17", "7", "La nouvelle version recalcule depuis le même entretien vérifié", ech(A1, "VIDANGE", "version||'/'||prochaine_km"), "3/2712.0")
act("ADV-18", "21", "lc", "Annuler un dossier après engagement", f"select public.moto_maintenance_annuler('{mt19}', 'Annulation pour masquer la dépense')", False, "Annulation impossible")
act("ADV-19", "23", "uh_a", "Régression : le Chef d'unité lit toujours sa moto et ses échéances", f"select count(*) from public.moto_v_echeances where moto_id='{A1}'", True, "3")
act("ADV-20", "23", "bm", "Régression : flotte lisible", f"select (count(*) >= 4)::text from public.moto_v_flotte", True, "true")

# ---------------------------------------------------------------------------
# Contre-épreuves de la revue indépendante (NO_GO initial)
# ---------------------------------------------------------------------------
# R01 : une autorisation ne sert qu'une fois — la facture est l'unique pièce d'argent
mtr = json.loads(run_as("lc", "select public.moto_maintenance_demander(" + lit({"moto_id": A1, "type_maintenance": "PNEUMATIQUE", "description": "Pneu arrière à remplacer (revue)"}) + ")")[1])["id"]
run_as("lc", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mtr, "garage_id": G, "devis_montant": 10000, "devis_path": piece(A1, "devis"), "travaux": [{"operation_code": "PNEUMATIQUE", "libelle": "Pneu arrière"}], "justification": "Usure pneu arrière (revue)"}) + ")")
aur = json.loads(run_as("lc", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mtr, "objet": "TRAVAUX", "montant_demande": 10000, "perimetre": "Pneu arrière selon devis", "consequence_report": "Crevaisons"}) + ")")[1])["id"]
run_as("bm", f"select public.moto_autorisation_decider('{aur}', 'AUTORISEE', 10000, null)")
run_as("lc", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mtr, "montant_engage": 10000, "date_prevue": d(0)}) + ")")
fr = act("R01b", "18", "lc", "Revue : facture 10 000 pour l'autorisation de 10 000", "select public.moto_facture_deposer(" + lit({"maintenance_id": mtr, "numero_facture": "FG-REVUE-01", "date_facture": d(0), "montant": 10000, "document_path": piece(A1, "facture")}) + ")", True, "DEPOSEE")["id"]
act("R01c", "18", "lc", "Revue : seconde facture sur la même autorisation", "select public.moto_facture_deposer(" + lit({"maintenance_id": mtr, "numero_facture": "FG-REVUE-02", "date_facture": d(0), "montant": 10000, "document_path": piece(A1, "facture")}) + ")", True, "\"hors_autorisation\": true")
run_as("abm", f"select public.moto_facture_verifier('{fr}', 'VERIFIEE', null)")
act("R01d", "18", "abm", "Revue : la seconde facture ne peut pas être vérifiée", f"select public.moto_facture_verifier((select id from public.moto_factures where numero_facture='FG-REVUE-02'), 'VERIFIEE', null)", False, "hors autorisation")
act("R01e", "18", "lc", "Revue : pneu de 10 000 réparti sur la facture vérifiée", "select public.moto_pneu_creer(" + lit({"code": "PN-REVUE-1", "marque": "TEST", "dimensions": "2.75-18", "cout_achat": 10000, "facture_id": fr}) + ")")
act("R01f", "18", "lc", "Revue : second pneu sur la même facture épuisée", "select public.moto_pneu_creer(" + lit({"code": "PN-REVUE-2", "marque": "TEST", "dimensions": "2.75-18", "cout_achat": 10000, "facture_id": fr}) + ")", False, "restant")
act("R01g", "18", "bm", "Revue : coût tracé = 10 000 facturés vérifiés, pas davantage", f"select (select coalesce(sum(montant),0) from public.moto_factures where maintenance_id='{mtr}' and statut='VERIFIEE') + (select coalesce(sum(montant),0) from public.moto_depenses where facture_id='{fr}')", True, "10000")
# R02 : réparation déguisée en supervision
envs = json.loads(run_as("lc", "select public.moto_enveloppe_demander(" + lit({"type_enveloppe": "SUPERVISION", "periode": per, "montant_demande": 50000, "justification": "Tournées de supervision (revue)"}) + ")")[1])["id"]
run_as("bm", f"select public.moto_enveloppe_decider('{envs}', 'APPROUVEE', null, null)")
act("R02a", "13", "lc", "Revue : réparation déclarée « supervision » avec une moto", "select public.moto_depense_declarer(" + lit({"enveloppe_id": envs, "date_depense": d(0), "montant": 15000, "objet": "Réparation frein et plaquettes moto", "moto_id": A2, "nature": "SUPERVISION"}) + ")", False, "Branch Manager")
act("R02b", "17", "lc", "Revue : même tentative hors ligne", "select string_agg(x->>'statut', ',') from jsonb_array_elements(public.moto_sync_batch(" + lit([{"type": "DEPENSE", "client_op_id": str(uuid.uuid4()), "payload": {"enveloppe_id": envs, "date_depense": d(0), "montant": 12000, "objet": "Remplacement embrayage", "moto_id": A2}}]) + ")) x", True, "REJETE")
act("R02c", "13", "lc", "Revue : vraie dépense de supervision (sans moto) acceptée", "select public.moto_depense_declarer(" + lit({"enveloppe_id": envs, "date_depense": d(0), "montant": 5000, "objet": "Transport tournée de supervision"}) + ")", True, "SUPERVISION")
# R03 : rien d'antérieur à la décision BM
mtd = json.loads(run_as("lc", "select public.moto_maintenance_demander(" + lit({"moto_id": A1, "type_maintenance": "REPARATION", "description": "Rétroviseur (revue dates)"}) + ")")[1])["id"]
run_as("lc", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mtd, "garage_id": G, "devis_montant": 3000, "devis_path": piece(A1, "devis"), "travaux": [{"operation_code": "REPARATION", "libelle": "Rétroviseur"}], "justification": "Rétroviseur cassé (revue)"}) + ")")
aud = json.loads(run_as("lc", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mtd, "objet": "TRAVAUX", "montant_demande": 3000, "perimetre": "Rétroviseur selon devis", "consequence_report": "Visibilité"}) + ")")[1])["id"]
run_as("bm", f"select public.moto_autorisation_decider('{aud}', 'AUTORISEE', 3000, null)")
run_as("lc", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mtd, "montant_engage": 3000, "date_prevue": d(0)}) + ")")
act("R03a", "14", "lc", "Revue : début des travaux daté avant la décision BM", f"select public.moto_maintenance_demarrer('{mtd}', null, current_date - 20)", False, "antérieurs")
act("R03b", "14", "lc", "Revue : facture datée avant la décision BM", "select public.moto_facture_deposer(" + lit({"maintenance_id": mtd, "numero_facture": "FG-REVUE-ANT", "date_facture": d(-20), "montant": 3000, "document_path": piece(A1, "facture")}) + ")", False, "antérieure")
# R04 : annulation → autorisation caduque
mta = json.loads(run_as("lc", "select public.moto_maintenance_demander(" + lit({"moto_id": A1, "type_maintenance": "REPARATION", "description": "Selle (revue annulation)"}) + ")")[1])["id"]
run_as("lc", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mta, "garage_id": G, "devis_montant": 4000, "devis_path": piece(A1, "devis"), "travaux": [{"operation_code": "REPARATION", "libelle": "Selle"}], "justification": "Selle déchirée (revue)"}) + ")")
aua = json.loads(run_as("lc", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mta, "objet": "TRAVAUX", "montant_demande": 4000, "perimetre": "Selle selon devis", "consequence_report": "Confort"}) + ")")[1])["id"]
run_as("bm", f"select public.moto_autorisation_decider('{aua}', 'AUTORISEE', 4000, null)")
act("R04a", "14", "lc", "Revue : annulation d'un dossier autorisé, non engagé", f"select public.moto_maintenance_annuler('{mta}', 'Réparation finalement inutile (revue)')", True, "ANNULEE")
check("R04b", "14", "Revue : l'autorisation tombe avec le dossier", f"select statut from public.moto_autorisations where id='{aua}'", "ANNULEE")
act("R04c", "14", "lc", "Revue : programmer un dossier annulé", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mta, "montant_engage": 4000, "date_prevue": d(0)}) + ")", False, "autorisation")
# R06 : le garage soumis au BM est celui du dossier
g2 = json.loads(run_as("lc", "select public.moto_garage_enregistrer(" + lit({"nom": "GARAGE REVUE B", "localisation": "AUTRE VILLAGE FICTIF"}) + ")")[1])["id"]
mtg = json.loads(run_as("lc", "select public.moto_maintenance_demander(" + lit({"moto_id": A1, "type_maintenance": "REPARATION", "description": "Phare (revue garage)"}) + ")")[1])["id"]
run_as("lc", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mtg, "garage_id": G, "devis_montant": 2000, "devis_path": piece(A1, "devis"), "travaux": [{"operation_code": "REPARATION", "libelle": "Phare"}], "justification": "Phare cassé (revue)"}) + ")")
act("R06a", "15", "lc", "Revue : soumettre au BM un autre garage que celui du devis", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mtg, "objet": "TRAVAUX", "montant_demande": 2000, "garage_id": g2, "perimetre": "Phare selon devis", "consequence_report": "Éclairage"}) + ")", False, "garage")
run_as("bm", f"select public.moto_garage_statut('{G}', 'SUSPENDU', 'Suspension de test (revue garage)')")
act("R06b", "15", "lc", "Revue : soumission avec un garage suspendu", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mtg, "objet": "TRAVAUX", "montant_demande": 2000, "perimetre": "Phare selon devis", "consequence_report": "Éclairage"}) + ")", False, "suspendu")
run_as("bm", f"select public.moto_garage_statut('{G}', 'APPROUVE', 'Réapprobation de test (revue garage)')")
# R07 : montants illisibles hors lecture financière
act("R07a", "25", "zh", "Revue : Chef de zone lit le devis dans la table", f"select devis_montant from public.moto_maintenances where id='{mt}'", False, "permission")
act("R07b", "25", "uh_a", "Revue : Chef d'unité lit le montant engagé", f"select montant_engage from public.moto_maintenances where id='{mt}'", False, "permission")
act("R07c", "25", "zh", "Revue : Chef de zone lit les montants de maintenance du coût de flotte", f"select coalesce(cout_maintenance::text,'masqué')||'/'||coalesce(engage_non_facture::text,'masqué') from public.moto_v_couts where moto_id='{A1}'", True, "masqué/masqué")
act("R07d", "25", "uh_a", "Revue : le Chef d'unité garde la lecture non financière de son dossier", f"select statut from public.moto_maintenances where id='{mt}'", True, "CLOTUREE")
act("R07e", "25", "sup", "Revue : un profil hors module ne voit aucun dossier", "select count(*) from public.moto_v_maintenance_dossiers", True, "0")
# R08 : séparations
act("R08a", "12", "lc", "Revue : le soumetteur vérifie la facture (coordinateur non habilité)", f"select public.moto_facture_verifier((select id from public.moto_factures where numero_facture='FG-REVUE-02'), 'REJETEE', 'tentative du soumetteur')", False, "rôle")
mtv = json.loads(run_as("abm", "select public.moto_maintenance_demander(" + lit({"moto_id": A1, "type_maintenance": "REPARATION", "description": "Klaxon (revue séparation)"}) + ")")[1])["id"]
run_as("abm", "select public.moto_maintenance_devis(" + lit({"maintenance_id": mtv, "garage_id": G, "devis_montant": 1500, "devis_path": piece(A1, "devis"), "travaux": [{"operation_code": "REPARATION", "libelle": "Klaxon"}], "justification": "Klaxon muet (revue)"}) + ")")
auv = json.loads(run_as("abm", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mtv, "objet": "TRAVAUX", "montant_demande": 1500, "perimetre": "Klaxon selon devis", "consequence_report": "Sécurité routière"}) + ")")[1])["id"]
run_as("bm", f"select public.moto_autorisation_decider('{auv}', 'AUTORISEE', 1500, null)")
run_as("abm", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": mtv, "montant_engage": 1500, "date_prevue": d(0)}) + ")")
fv = json.loads(run_as("lc", "select public.moto_facture_deposer(" + lit({"maintenance_id": mtv, "numero_facture": "FG-REVUE-SEP", "date_facture": d(0), "montant": 1500, "document_path": piece(A1, "facture")}) + ")")[1])["id"]
act("R08b", "12", "abm", "Revue : l'ABM qui a soumis la demande vérifie la facture", f"select public.moto_facture_verifier('{fv}', 'VERIFIEE', null)", False, "Séparation")
act("R08d", "12", "fin", "Revue : la Finance vérifie", f"select public.moto_facture_verifier('{fv}', 'VERIFIEE', null)", True, "VERIFIEE")
act("R08e", "24", "fin", "Revue : le vérificateur constate lui-même le paiement", f"select public.moto_facture_paiement_constater('{fv}', 1500, current_date, 'VIR-REVUE')", False, "Séparation")
# R09 : incident d'une autre moto
inc_a2 = q(f"select id from public.moto_incidents where moto_id='{A3}' limit 1")
act("R09", "19", "lc", "Revue : dossier de A1 lié à un incident de A3", "select public.moto_maintenance_demander(" + lit({"moto_id": A1, "type_maintenance": "REPARATION", "description": "Lien incident croisé (revue)", "incident_id": inc_a2}) + ")", False, "même moto")

# ---------------------------------------------------------------------------
# Concurrence (contre-revue) : deux sessions réellement simultanées
# ---------------------------------------------------------------------------
def en_parallele(a, b, pause=5):
    """a est lancé, garde sa transaction ouverte `pause` s, b démarre pendant ce temps. Renvoie (ok_a, ok_b, msg_b)."""
    def proc(user, sql, attente):
        claims = json.dumps({"sub": U[user], "role": "authenticated"})
        script = (f"begin;\n\\o /dev/null\nset local role authenticated; select set_config('request.jwt.claims','{claims}',true);\n\\o\n"
                  f"{sql};\nselect pg_sleep({attente});\ncommit;\n")
        return subprocess.Popen(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True), script
    import time
    pa, sa = proc(a[0], a[1], pause); pa.stdin.write(sa); pa.stdin.close()
    time.sleep(1.5)   # B démarre pendant que la transaction de A est ouverte (A reste ouverte 5 s)
    pb, sb = proc(b[0], b[1], 0); pb.stdin.write(sb); pb.stdin.close()
    pa.wait(); pb.wait()
    eb = pb.stderr.read(); return pa.returncode == 0, pb.returncode == 0, (eb.split("ERROR:")[-1].strip() if eb else "OK")

def dossier_facture(montant, num):
    m_ = json.loads(run_as("lc", "select public.moto_maintenance_demander(" + lit({"moto_id": A1, "type_maintenance": "REPARATION", "description": f"Concurrence {num}"}) + ")")[1])["id"]
    run_as("lc", "select public.moto_maintenance_devis(" + lit({"maintenance_id": m_, "garage_id": G, "devis_montant": montant, "devis_path": piece(A1, "devis"), "travaux": [{"operation_code": "REPARATION", "libelle": "Test concurrence"}], "justification": "Test de concurrence (fictif)"}) + ")")
    a_ = json.loads(run_as("lc", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": m_, "objet": "TRAVAUX", "montant_demande": montant, "perimetre": "Travaux de test de concurrence", "consequence_report": "Aucune"}) + ")")[1])["id"]
    run_as("bm", f"select public.moto_autorisation_decider('{a_}', 'AUTORISEE', {montant}, null)")
    run_as("lc", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": m_, "montant_engage": montant, "date_prevue": d(0)}) + ")")
    return m_

q(f"insert into auth.users (id, email) values ('{uid(111)}', 'fin2@example.invalid') on conflict do nothing; insert into public.profils (user_id, email, nom, role, actif) values ('{uid(111)}', 'fin2@example.invalid', 'FINANCE6 BIS FICTIF', 'Finance', true) on conflict do nothing;")
U["fin2"] = uid(111)
# A : paiement Finance et règlement par enveloppe simultanés sur une facture de 5 000
mc = dossier_facture(5000, "A")
fc = json.loads(run_as("lc", "select public.moto_facture_deposer(" + lit({"maintenance_id": mc, "numero_facture": "FG-CONC-A", "date_facture": d(0), "montant": 5000, "document_path": piece(A1, "facture")}) + ")")[1])["id"]
run_as("abm", f"select public.moto_facture_verifier('{fc}', 'VERIFIEE', null)")
oka, okb, msg = en_parallele(("fin", f"select public.moto_facture_paiement_constater('{fc}', 5000, current_date, 'VIR-CONC')"),
                             ("lc", "select public.moto_depense_declarer(" + lit({"enveloppe_id": env, "date_depense": d(0), "montant": 5000, "objet": "Règlement concurrent", "facture_id": fc}) + ")"))
total = q(f"select montant_paye + coalesce((select sum(montant) from public.moto_depenses where facture_id='{fc}' and statut<>'REJETEE'),0) from public.moto_factures where id='{fc}'")
record("CONC-A", "18", "fin + lc", "Concurrence : paiement Finance et règlement enveloppe simultanés (facture 5 000)", "1 seul passe ; total réglé 5000",
       oka and not okb and total == "5000", f"paiement={oka} enveloppe={okb} ({msg[:120]}) total={total}")
# B : deux vérifications simultanées pour une autorisation de 5 000
mb_ = dossier_facture(5000, "B")
f1b = json.loads(run_as("lc", "select public.moto_facture_deposer(" + lit({"maintenance_id": mb_, "numero_facture": "FG-CONC-B1", "date_facture": d(0), "montant": 5000, "document_path": piece(A1, "facture")}) + ")")[1])["id"]
f2b = json.loads(run_as("lc", "select public.moto_facture_deposer(" + lit({"maintenance_id": mb_, "numero_facture": "FG-CONC-B2", "date_facture": d(0), "montant": 5000, "document_path": piece(A1, "facture")}) + ")")[1])["id"]
oka, okb, msg = en_parallele(("fin", f"select public.moto_facture_verifier('{f1b}', 'VERIFIEE', null)"), ("fin2", f"select public.moto_facture_verifier('{f2b}', 'VERIFIEE', null)"))
tv = q(f"select coalesce(sum(montant),0) from public.moto_factures where maintenance_id='{mb_}' and statut='VERIFIEE'")
record("CONC-B", "18", "fin + fin2", "Concurrence : deux vérifications simultanées (autorisé 5 000)", "1 seule passe ; 5000 vérifiés",
       oka and not okb and tv == "5000", f"v1={oka} v2={okb} ({msg[:120]}) vérifié={tv}")
# C : facture antérieure au supplément qui devrait la couvrir
mcc = dossier_facture(5000, "C")
run_as("lc", f"select public.moto_maintenance_demarrer('{mcc}', null, current_date)")
q(f"update public.moto_autorisations set decide_at = decide_at - interval '3 days' where maintenance_id='{mcc}'")   # décision initiale à J-3 (fixture)
fcc = json.loads(run_as("lc", "select public.moto_facture_deposer(" + lit({"maintenance_id": mcc, "numero_facture": "FG-CONC-C", "date_facture": d(-1), "montant": 8000, "document_path": piece(A1, "facture")}) + ")")[1])["id"]
a2c = json.loads(run_as("lc", "select public.moto_autorisation_soumettre(" + lit({"maintenance_id": mcc, "objet": "SUPPLEMENT", "montant_demande": 3000, "perimetre": "Supplément demandé après la facture", "consequence_report": "Aucune"}) + ")")[1])["id"]
run_as("bm", f"select public.moto_autorisation_decider('{a2c}', 'AUTORISEE', 3000, null)")
act("CONC-C", "14", "fin", "Facture d'hier non couverte par un supplément décidé aujourd'hui", f"select public.moto_facture_verifier('{fcc}', 'VERIFIEE', null)", False, "date de la facture")
# D : garage suspendu après décision
md_ = dossier_facture(2000, "D")
run_as("bm", f"select public.moto_garage_statut('{G}', 'SUSPENDU', 'Suspension de test (concurrence D)')")
act("CONC-D", "15", "lc", "Engagement supplémentaire chez un garage suspendu après la décision", "select public.moto_maintenance_programmer(" + lit({"maintenance_id": md_, "montant_engage": 2000}) + ")", False, "suspendu")
run_as("bm", f"select public.moto_garage_statut('{G}', 'APPROUVE', 'Réapprobation de test (concurrence D)')")

# ---------------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "maintenance_6.json"), "w", encoding="utf-8") as f:
    json.dump({"base": DB, "date": datetime.datetime.now(datetime.timezone.utc).isoformat(), "resultats": RESULTS}, f, ensure_ascii=False, indent=1)
ok = sum(1 for r in RESULTS if r["resultat"] == "RÉUSSI")
print("| id | scénario | compte | action | attendu | obtenu | résultat |\n|---|---|---|---|---|---|---|")
for r in RESULTS:
    print(f"| {r['id']} | {r['scenario']} | {r['compte']} | {r['action']} | {r['attendu']} | {r['obtenu'][:90]} | {r['resultat']} |")
couverts = sorted({int(r["scenario"]) for r in RESULTS})
print(f"\nScénarios du mandat couverts : {couverts}")
print(f"TOTAL MIGRATION 6 : {ok}/{len(RESULTS)} réussis")
sys.exit(0 if ok == len(RESULTS) else 1)

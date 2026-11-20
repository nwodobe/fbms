#!/usr/bin/env python3
"""
CARTOGRAPHIE DES PARCELLES AFLP — recette serveur sur base LOCALE (jamais Supabase).

Chaque action s'exécute SOUS LE RÔLE `authenticated` (RLS active) avec l'identité JWT d'un
compte FICTIF. Les vérifications d'état lisent la base en superutilisateur. Données 100 %
fictives : comptes, villages, producteurs, parcelles et coordonnées (point fictif autour de
7,70° N / 5,03° O, aucune parcelle réelle).

Déroulé : base SANS cartographie -> jeu fictif -> empreinte de l'existant -> migrations 1 à 3
(deux passes) -> recette par profils -> retour arrière -> empreinte -> réapplication.

Usage : PGHOST=/tmp PGPORT=54329 python3 tests/cartographie/tests_serveur_cartographie.py
Sortie : tests/cartographie/resultats/serveur.json + synthèse.
"""
import json, math, os, subprocess, sys, uuid
from geographiclib.geodesic import Geodesic

HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST or not HOST: sys.exit("REFUS : cible absente ou Supabase détectée")
ICI = os.path.dirname(os.path.abspath(__file__)); RACINE = os.path.abspath(os.path.join(ICI, "..", ".."))
DB = os.environ.get("CARTO_DB", "fbms_carto_test"); OUT = os.path.join(ICI, "resultats")
G = Geodesic.WGS84
MIG = ["20261120090000_aflp_cartographie_1_schema", "20261120090100_aflp_cartographie_2_securite_rpc", "20261120090200_aflp_cartographie_3_vues_pilotage"]
ROLLBACK = "20261120090300_aflp_cartographie_rollback"

def uid(n): return f"00000000-0000-4000-8000-{n:012d}"
PROFILS = [  # clé, nom, rôle, cluster, zone, actif
    ("bm", "BM FICTIF", "Branch Manager", None, None, True),
    ("abm", "ABM FICTIF", "Assistant Branch Manager", None, None, True),
    ("zh1", "ZH GBEKE 1 FICTIF", "Zonal Head", None, "GBEKE_1", True),
    ("zh2", "ZH GBEKE 2 FICTIF", "Zonal Head", None, "GBEKE_2", True),
    ("zh_sans", "ZH SANS ZONE FICTIF", "Zonal Head", None, None, True),
    ("uh_bro", "UH BROBO FICTIF", "Unit Head", "BROBO", None, True),
    ("auh_bro", "AUH BROBO FICTIF", "Assistant Unit Head", "BROBO", "GBEKE_1", True),
    ("uh_bot", "UH BOTRO FICTIF", "Unit Head", "BOTRO", None, True),
    ("rt", "RT FICTIF", "RT", "BROBO", None, True),
    ("sup", "SUPERVISOR SANS PERIMETRE FICTIF", "Supervisor", None, None, True),
    ("fin", "FINANCE FICTIF", "Finance", None, None, True),
    ("uh_inactif", "UH INACTIF FICTIF", "Unit Head", "BROBO", None, False),
]
U = {p[0]: uid(i + 1) for i, p in enumerate(PROFILS)}

def psql(sql, db=None):
    r = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", db or DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
                       input=sql, capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()
def q(sql):
    c, o, e = psql(sql)
    if c != 0: raise RuntimeError(e)
    return o
def appliquer(nom):
    c, o, e = psql(open(os.path.join(RACINE, "supabase", nom + ".sql")).read())
    if c != 0: raise RuntimeError(f"migration {nom} : {e}")
def run_as(user, sql):
    if user == "anon":
        pre = "set local role anon; select set_config('request.jwt.claims','{\"role\":\"anon\"}',true); select set_config('request.jwt.claim.sub','',true);"
    else:
        claims = json.dumps({"sub": U[user], "role": "authenticated"})
        pre = f"set local role authenticated; select set_config('request.jwt.claims','{claims}',true); select set_config('request.jwt.claim.sub','{U[user]}',true);"
    c, o, e = psql(f"begin;\n\\o /dev/null\n{pre}\n\\o\n{sql};\ncommit;\n")
    if c == 0:
        lines = [l for l in o.splitlines() if l.strip()]
        return True, (lines[-1] if lines else "")
    lines = e.splitlines(); msg = next((l for l in lines if "ERROR" in l), lines[0] if lines else "erreur")
    return False, msg.split("ERROR:")[-1].strip()

R = []
def note(tid, fam, user, label, attendu, ok, obtenu):
    R.append({"id": tid, "famille": fam, "compte": user, "action": label, "attendu": attendu, "obtenu": str(obtenu)[:300], "resultat": "RÉUSSI" if ok else "ÉCHOUÉ"})
    print(("RÉUSSI  " if ok else "ÉCHOUÉ  ") + f"{tid} [{user}] {label}" + ("" if ok else f" — attendu {attendu} — obtenu {str(obtenu)[:220]}"), flush=True)
def lit(v): return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
def jl(o):
    try: return json.loads(o)
    except Exception: return o
def act(tid, fam, user, label, sql, ok_attendu=True, contient=None):
    ok, out = run_as(user, sql)
    passe = (ok == ok_attendu) and (contient is None or contient.lower() in out.lower())
    note(tid, fam, user, label, ("OK" if ok_attendu else "REFUS") + (f" ({contient})" if contient else ""), passe, ("OK : " if ok else "REFUS : ") + out)
    return jl(out) if ok else {}
def verif(tid, fam, label, obtenu, attendu):
    note(tid, fam, "postgres", label, attendu, obtenu == attendu, obtenu)
def verif_vrai(tid, fam, label, cond, detail=""):
    note(tid, fam, "postgres", label, True, bool(cond), detail)

# ------------------------------------------------------------------ géométrie de référence
LAT0, LON0 = 7.70, -5.03          # point FICTIF (aucune parcelle réelle)
def pt(x, y, ox=0, oy=0):
    x += ox; y += oy; d = math.hypot(x, y); az = math.degrees(math.atan2(x, y))
    r = G.Direct(LAT0, LON0, az, d); return [round(r["lon2"], 9), round(r["lat2"], 9)]
def anneau(pts, ox=0, oy=0):
    c = [pt(x, y, ox, oy) for x, y in pts]; return c + [c[0]]
def poly(pts, ox=0, oy=0): return {"type": "Polygon", "coordinates": [anneau(pts, ox, oy)]}
def ref(geo):  # superficie et périmètre GeographicLib (ellipsoïde WGS84) : référence INDÉPENDANTE de PostGIS
    p = G.Polygon()
    for lon, lat in geo["coordinates"][0][:-1]: p.AddPoint(lat, lon)
    n, per, a = p.Compute(False, True); return abs(a), per
RECT = [(0, 0), (250, 0), (250, 200), (0, 200)]
IRREG = [(0, 0), (180, -20), (310, 40), (360, 170), (300, 260), (190, 240), (120, 300), (30, 220), (-20, 110)]
GRAND = [(0, 0), (520, 0), (520, 300), (260, 300), (260, 180), (0, 180)]
PETIT = [(0, 0), (50, 0), (50, 50), (0, 50)]
PAPILLON = [(0, 0), (100, 100), (100, 0), (0, 100)]
def contour(pid, geo, user_dev="dev-fictif", method="SATELLITE", conf="VISIBLES", base=None, gid=None, client_area=True, **extra):
    a, per = ref(geo)
    d = {"id": gid or str(uuid.uuid4()), "plot_id": pid, "geometrie": geo, "method": method, "boundary_confidence": conf,
         "base_geometry_id": base, "area_m2_client": round(a, 2) if client_area else None, "perimeter_m_client": round(per, 2),
         "imagery_source": "AUCUNE (recette)", "device_id": user_dev}
    d.update(extra); return d

# ------------------------------------------------------------------ 0. base sans cartographie + jeu fictif
subprocess.run([os.path.join(ICI, "construire_recette.sh"), DB, "sans_carto"], check=True, stdout=subprocess.DEVNULL)
setup = []
for k, nom, role, cluster, zone, actif in PROFILS:
    setup.append(f"insert into auth.users (id, email) values ('{U[k]}', '{k}@example.invalid') on conflict do nothing;")
    setup.append("insert into public.profils (user_id, email, nom, role, cluster, zone, actif) values "
                 f"('{U[k]}', '{k}@example.invalid', '{nom}', '{role}', {repr(cluster) if cluster else 'null'}, {repr(zone) if zone else 'null'}, {str(actif).lower()}) on conflict do nothing;")
setup.append(f"select set_config('request.jwt.claim.sub', '{U['bm']}', false);")
setup.append("insert into public.villages (id, data, village, cluster, cluster_code) values ('V-FICTIF-BRO', '{}', 'VILLAGE FICTIF BROBO', 'Brobo', 'BROBO'), "
             "('V-FICTIF-BOT', '{}', 'VILLAGE FICTIF BOTRO', 'Botro', 'BOTRO') on conflict do nothing;")
setup.append("insert into public.rt (id, data, nom, village_id) values ('RT-FICTIF-BRO', '{}', 'RT FICTIF BROBO', 'V-FICTIF-BRO'), ('RT-FICTIF-BOT', '{}', 'RT FICTIF BOTRO', 'V-FICTIF-BOT') on conflict do nothing;")
PL = {}
PRODS = [("A", "V-FICTIF-BRO", "RT-FICTIF-BRO", "OUI", 5.0), ("B", "V-FICTIF-BRO", "RT-FICTIF-BRO", "OUI", 2.0), ("C", "V-FICTIF-BRO", "RT-FICTIF-BRO", "OUI", None),
         ("D", "V-FICTIF-BRO", "RT-FICTIF-BRO", "OUI", 12.0), ("E", "V-FICTIF-BOT", "RT-FICTIF-BOT", "OUI", 3.0),
         ("N", "V-FICTIF-BRO", "RT-FICTIF-BRO", "AUCUN", 1.0), ("R", "V-FICTIF-BRO", "RT-FICTIF-BRO", "REFUS_GPS", 1.0), ("V", "V-FICTIF-BRO", "RT-FICTIF-BRO", "OUI", 1.5)]
for nom, v, rt, cons, decl in PRODS:
    pid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"carto-parcelle-{nom}")); PL[nom] = pid
    setup.append(f"insert into public.producteurs (id, data, nom, village_id, rt_id) values ('P-CARTO-{nom}', '{{}}', 'PRODUCTEUR FICTIF {nom}', '{v}', '{rt}') on conflict do nothing;")
    setup.append(f"insert into public.farmer_plots (id, producteur_id, village_id, local_name, declared_area, tree_count) values ('{pid}', 'P-CARTO-{nom}', '{v}', 'PARCELLE FICTIVE {nom}', {decl if decl else 'null'}, 120) on conflict do nothing;")
    if cons != "AUCUN":
        scopes = '{"identity": true, "gps": %s}' % ("true" if cons == "OUI" else "false")
        setup.append(f"insert into public.farmer_consents (producteur_id, status, scopes, consent_at, text_version, method, created_at) values "
                     f"('P-CARTO-{nom}', '{'GRANTED' if cons == 'OUI' else 'PARTIAL'}', '{scopes}', now(), 'AFLP-DATA-CONSENT-2026.1', 'VERBAL', now());")
q("\n".join(setup))
# Parcelle V : point déjà VÉRIFIÉ par la supervision (cas Observatoire).
q(f"select set_config('request.jwt.claim.sub', '{U['bm']}', false); update public.farmer_plots set latitude = 7.7, longitude = -5.03, gps_accuracy_m = 5, gps_captured_at = now(), gps_status = 'GPS_VERIFIED' where id = '{PL['V']}';")

EMPREINTE = """select md5(string_agg(x, '|' order by x)) from (
  select fp.id::text||fp.producteur_id||fp.village_id||coalesce(fp.declared_area::text,'')||coalesce(fp.gps_verified_area::text,'')||fp.status||fp.gps_status||coalesce(fp.latitude::text,'') x from public.farmer_plots fp
  union all select pr.id||pr.nom||pr.village_id from public.producteurs pr
  union all select c.producteur_id||c.status||c.scopes::text from public.farmer_consents c) t"""
def objets_carto(): return q("select (select count(*) from pg_proc where proname like 'plot\\_map\\_%') + (select count(*) from pg_class where relname like 'farmer_plot_geometries' or relname like 'farmer_plot_anomalies' or relname like 'plot_map_%') + (select count(*) from information_schema.columns where table_name='farmer_plots' and column_name in ('plot_code','mapping_status','mapped_area_ha'))")
AVANT = q(EMPREINTE); NB_AVANT = q("select count(*) from public.farmer_plots")

# ------------------------------------------------------------------ 1. migrations (deux passes)
F = "Migrations"
try:
    for passe in (1, 2):
        for m in MIG: appliquer(m)
    note("M-01", F, "postgres", "Migrations 1 à 3 rejouables (deux passes sans erreur)", "ok", True, "ok")
except Exception as e:
    note("M-01", F, "postgres", "Migrations 1 à 3 rejouables", "ok", False, e); json.dump(R, open(os.path.join(OUT, "serveur.json"), "w")); sys.exit(1)
verif("M-02", F, "Parcelles, producteurs et consentements existants inchangés après migration (empreinte)", q(EMPREINTE), AVANT)
verif("M-03", F, "Nombre de parcelles inchangé après migration", q("select count(*) from public.farmer_plots"), NB_AVANT)
verif("M-04", F, "Aucune parcelle existante ne reçoit de statut cartographique à la migration", q("select count(*) from public.farmer_plots where mapping_status is not null or plot_code is not null"), "0")
verif("M-05", F, "Fonctions désactivées par défaut (localisation et contours)", q("select valeur->>'localisation' || '/' || (valeur->>'contours') from public.plot_map_parametres where cle='activation'"), "false/false")

# ------------------------------------------------------------------ 2. activation et paramètres
F = "Activation"
act("A-01", F, "uh_bro", "Localisation refusée tant que la fonction est désactivée",
    f"select public.plot_map_localiser({lit({'plot_id': PL['A'], 'latitude': 7.7, 'longitude': -5.03, 'precision_m': 6})})", False, "pas encore activée")
act("A-02", F, "uh_bro", "Un Unit Head ne peut pas activer la cartographie",
    f"select public.plot_map_parametre_definir('activation', {lit({'localisation': True})})", False, "réservé")
act("A-03", F, "bm", "Imagerie satellite refusée sans licence confirmée",
    f"select public.plot_map_parametre_definir('imagerie', {lit({'fournisseur': 'esri', 'licence_confirmee': False})})", False, "licence")
act("A-04", F, "bm", "Le Branch Manager active la localisation (tous clusters) et les contours (pilote BROBO)",
    f"select public.plot_map_parametre_definir('activation', {lit({'localisation': True, 'contours': True, 'clusters_pilotes': ['BROBO']})})")
act("A-05", F, "uh_bot", "Contour refusé hors cluster pilote (BOTRO)",
    f"select public.plot_map_soumettre({lit(contour(PL['E'], poly(RECT, 5000, 5000)))})", False, "pas activée pour ce cluster")
act("A-06", F, "bm", "Le Branch Manager ajoute BOTRO au pilote",
    f"select public.plot_map_parametre_definir('activation', {lit({'localisation': True, 'contours': True, 'clusters_pilotes': ['BROBO', 'BOTRO']})})")

# ------------------------------------------------------------------ 3. localiser le champ
F = "Localisation"
LOC = lambda pid, prec=6, lat=7.7012, lng=-5.0291: lit({"plot_id": pid, "latitude": lat, "longitude": lng, "precision_m": prec})
act("L-01", F, "uh_bro", "Le Chef d'Unité localise un champ de son cluster (consentement GPS accordé)", f"select public.plot_map_localiser({LOC(PL['A'])})")
verif("L-02", F, "Le point est enregistré, statut POINT_CAPTURED, auteur tracé", q(f"select gps_status||'|'||latitude||'|'||gps_accuracy_m||'|'||(gps_captured_by='{U['uh_bro']}') from public.farmer_plots where id='{PL['A']}'"), "POINT_CAPTURED|7.7012000|6.00|true")
verif("L-03", F, "Un point GPS ne crée aucune superficie cartographiée ni validée", q(f"select coalesce(mapped_area_ha::text,'null')||'|'||coalesce(gps_verified_area::text,'null')||'|'||coalesce(mapping_status,'null') from public.farmer_plots where id='{PL['A']}'"), "null|null|null")
act("L-04", F, "uh_bro", "Précision insuffisante refusée avec message compréhensible", f"select public.plot_map_localiser({LOC(PL['B'], 120)})", False, "précision insuffisante")
act("L-05", F, "uh_bro", "Position hors Côte d'Ivoire refusée", f"select public.plot_map_localiser({LOC(PL['B'], 6, 48.85, 2.35)})", False, "hors de la côte")
act("L-06", F, "auh_bro", "Assistant de BROBO : parcelle de BOTRO refusée", f"select public.plot_map_localiser({LOC(PL['E'])})", False, "hors de votre périmètre")
act("L-07", F, "zh1", "Un Zonal Head ne saisit pas", f"select public.plot_map_localiser({LOC(PL['B'])})", False, "périmètre")
act("L-08", F, "rt", "Un RT est refusé", f"select public.plot_map_localiser({LOC(PL['B'])})", False, "refusé")
act("L-09", F, "sup", "Supervisor sans affectation : aucune escalade de droits", f"select public.plot_map_localiser({LOC(PL['B'])})", False)
act("L-10", F, "uh_bro", "Producteur sans consentement enregistré : refus", f"select public.plot_map_localiser({LOC(PL['N'])})", False, "accord")
act("L-11", F, "uh_bro", "Producteur ayant refusé la portée GPS : refus", f"select public.plot_map_localiser({LOC(PL['R'])})", False, "accord")
act("L-12", F, "uh_inactif", "Compte inactif refusé", f"select public.plot_map_localiser({LOC(PL['B'])})", False, "refusé")
act("L-13", F, "auh_bro", "L'assistant localise un champ de son cluster", f"select public.plot_map_localiser({LOC(PL['B'], 8, 7.7031, -5.0262)})")
act("L-14", F, "uh_bro", "Relocaliser un point VÉRIFIÉ ne le rétrograde pas", f"select public.plot_map_localiser({LOC(PL['V'], 4, 7.7001, -5.0301)})")
verif("L-15", F, "Le statut GPS_VERIFIED est conservé", q(f"select gps_status from public.farmer_plots where id='{PL['V']}'"), "GPS_VERIFIED")
verif("L-16", F, "Chaque localisation est journalisée avec l'état précédent", q(f"select count(*) from public.farmer_plot_map_events where plot_id='{PL['V']}' and action='LOCALISER' and avant is not null"), "1")

# ------------------------------------------------------------------ 4. Observatoire (migration 6)
F = "Observatoire"
verif("O-01", F, "Parcelle localisée (POINT_CAPTURED) : plus de manque « position GPS »", q(f"select not ('position GPS relevée sur le champ' = any(private.pheno_parcelle_manques('{PL['A']}')))"), "t")
verif("O-02", F, "Parcelle au point VÉRIFIÉ : reconnue localisée (avant la correction : refusée)", q(f"select not ('position GPS relevée sur le champ' = any(private.pheno_parcelle_manques('{PL['V']}')))"), "t")
verif("O-03", F, "Parcelle non localisée : toujours refusée", q(f"select 'position GPS relevée sur le champ' = any(private.pheno_parcelle_manques('{PL['C']}'))"), "t")
verif("O-04", F, "Les autres exigences restent appliquées (producteur sans code signalé)", q(f"select array_length(private.pheno_parcelle_manques('{PL['A']}'), 1) >= 1"), "t")

# ------------------------------------------------------------------ 5. contours : géométrie
F = "Géométrie"
def surface_ok(tid, label, nom, pts, ox, oy, user="auh_bro"):
    geo = poly(pts, ox, oy); a, per = ref(geo)
    r = act(tid, F, user, label, f"select public.plot_map_soumettre({lit(contour(PL[nom], geo))})")
    if r:
        ea = abs(float(r["area_m2"]) - a) / a * 100; ep = abs(float(r["perimeter_m"]) - per) / per * 100
        verif_vrai(tid + "b", F, f"{label} : surface et périmètre serveur (PostGIS) = référence GeographicLib à 0,01 % près", ea < 0.01 and ep < 0.01,
                   f"serveur {r['area_m2']} m² / {r['perimeter_m']} m ; référence {a:.2f} m² / {per:.2f} m ; écarts {ea:.5f} % / {ep:.5f} %")
    return r
RA = surface_ok("G-01", "Champ rectangulaire de 5 ha (250 × 200 m)", "A", RECT, 0, 0)
RC = surface_ok("G-02", "Champ irrégulier à 9 sommets", "C", IRREG, 1500, 0)
RD = surface_ok("G-03", "Champ de plus de 10 ha (12,48 ha en L)", "D", GRAND, 3000, 0)
q(f"select set_config('request.jwt.claim.sub', '{U['bm']}', false); insert into public.farmer_plots (id, producteur_id, village_id, local_name, declared_area) values ('{uuid.uuid5(uuid.NAMESPACE_DNS, 'carto-petite')}', 'P-CARTO-C', 'V-FICTIF-BRO', 'PETITE PARCELLE FICTIVE', 0.25)")
PETITE = str(uuid.uuid5(uuid.NAMESPACE_DNS, "carto-petite"))
geo_p = poly(PETIT, 4500, 0); a_p, _ = ref(geo_p)
rp = act("G-04", F, "auh_bro", "Petite parcelle (0,25 ha)", f"select public.plot_map_soumettre({lit(contour(PETITE, geo_p))})")
verif_vrai("G-04b", F, "Petite parcelle : surface conforme à la référence", rp and abs(float(rp['area_m2']) - a_p) / a_p * 100 < 0.01, rp)
act("G-05", F, "auh_bro", "Polygone auto-intersecté refusé", f"select public.plot_map_soumettre({lit(contour(PL['B'], poly(PAPILLON, 6000, 0), client_area=False))})", False, "se croisent")
act("G-06", F, "auh_bro", "Polygone incomplet (2 sommets) refusé",
    f"select public.plot_map_soumettre({lit(contour(PL['B'], {'type': 'Polygon', 'coordinates': [[pt(0, 0, 6000), pt(50, 0, 6000), pt(0, 0, 6000)]]}, client_area=False))})", False)
act("G-07", F, "auh_bro", "Contour non fermé refusé",
    f"select public.plot_map_soumettre({lit(contour(PL['B'], {'type': 'Polygon', 'coordinates': [[pt(0, 0, 6000), pt(90, 0, 6000), pt(90, 90, 6000), pt(0, 90, 6000)]]}, client_area=False))})", False, "fermé")
act("G-08", F, "auh_bro", "Écart de calcul téléphone / serveur au-delà de la tolérance refusé",
    f"select public.plot_map_soumettre({lit(dict(contour(PL['B'], poly(RECT, 6000, 0)), area_m2_client=51000))})", False, "écart de calcul")
act("G-09", F, "auh_bro", "Contour minuscule (25 m²) refusé", f"select public.plot_map_soumettre({lit(contour(PL['B'], poly([(0,0),(5,0),(5,5),(0,5)], 6000, 0)))})", False, "trop petit")
act("G-10", F, "auh_bro", "Mesure GPS avec moins de 3 points refusée",
    f"select public.plot_map_soumettre({lit(contour(PL['B'], poly(RECT, 6000, 0), method='GPS_POINTS', gps_points=2))})", False, "au moins 3 points")
act("G-11", F, "auh_bro", "Contour pour un producteur sans consentement GPS refusé", f"select public.plot_map_soumettre({lit(contour(PL['N'], poly(RECT, 8000, 0)))})", False, "accord")

# ------------------------------------------------------------------ 6. données : versions, doublons, plusieurs parcelles
F = "Données"
gid = str(uuid.uuid4()); payload = contour(PL['B'], poly(RECT, 6000, 0), gid=gid)
r1 = act("D-01", F, "auh_bro", "Soumission d'un contour (parcelle B)", f"select public.plot_map_soumettre({lit(payload)})")
r2 = act("D-02", F, "auh_bro", "Rejeu de la même soumission : aucun doublon", f"select public.plot_map_soumettre({lit(payload)})")
verif_vrai("D-03", F, "Le rejeu renvoie le même contour (rejoue = vrai)", r2 and r2.get("rejoue") is True and r2.get("geometry_id") == gid, r2)
verif("D-04", F, "Une seule version enregistrée pour B", q(f"select count(*) from public.farmer_plot_geometries where plot_id='{PL['B']}'"), "1")
act("D-05", F, "auh_bro", "Même identifiant, autre tracé : refus", f"select public.plot_map_soumettre({lit(contour(PL['B'], poly(PETIT, 6000, 0), gid=gid))})", False, "déjà utilisé")
NP = str(uuid.uuid4())
act("D-06", F, "uh_bro", "Ajouter une deuxième parcelle au même producteur, traçable comme division",
    f"select public.plot_map_ajouter_parcelle({lit({'id': NP, 'producteur_id': 'P-CARTO-A', 'local_name': 'PARCELLE FICTIVE A2', 'split_from_plot_id': PL['A']})})")
verif("D-07", F, "Le producteur A a 2 parcelles ; la parcelle d'origine est conservée", q(f"select count(*) from public.farmer_plots where producteur_id='P-CARTO-A' and not deleted"), "2")
act("D-08", F, "uh_bro", "Rejeu de l'ajout : aucun doublon", f"select public.plot_map_ajouter_parcelle({lit({'id': NP, 'producteur_id': 'P-CARTO-A', 'local_name': 'PARCELLE FICTIVE A2', 'split_from_plot_id': PL['A']})})")
verif("D-09", F, "Toujours 2 parcelles après rejeu", q(f"select count(*) from public.farmer_plots where producteur_id='P-CARTO-A' and not deleted"), "2")
act("D-10", F, "uh_bro", "Division depuis la parcelle d'un autre producteur refusée",
    f"select public.plot_map_ajouter_parcelle({lit({'producteur_id': 'P-CARTO-A', 'local_name': 'X', 'split_from_plot_id': PL['B']})})", False, "même producteur")
verif("D-11", F, "Superficie déclarée et superficie GPS saisie jamais écrasées par un contour",
      q(f"select declared_area||'|'||coalesce(gps_verified_area::text,'null') from public.farmer_plots where id='{PL['A']}'"), "5.000|null")
verif("D-12", F, "Écart déclaré (2 ha) / cartographié (5 ha) signalé, non bloquant",
      q(f"select type||'|'||bloquante from public.farmer_plot_anomalies where plot_id='{PL['B']}' and type='ECART_SUPERFICIE'"), "ECART_SUPERFICIE|false")

# ------------------------------------------------------------------ 7. chevauchement
F = "Chevauchement"
# Parcelle E (BOTRO) n'est pas voisine ; on crée un chevauchement entre C (irrégulier) et une nouvelle version de la petite parcelle.
geo_chev = poly(RECT, 6200, 0)   # recouvre B (décalé de 200 m sur 250 m de large → 50 × 200 m)
P2 = str(uuid.uuid4())
act("X-00", F, "uh_bro", "Nouvelle parcelle voisine (producteur C)", f"select public.plot_map_ajouter_parcelle({lit({'id': P2, 'producteur_id': 'P-CARTO-C', 'local_name': 'VOISINE FICTIVE'})})")
rx = act("X-01", F, "uh_bro", "Contour qui recouvre la parcelle B", f"select public.plot_map_soumettre({lit(contour(P2, geo_chev))})")
over = q(f"select overlap_m2 from public.farmer_plot_anomalies where plot_id='{P2}' and type='CHEVAUCHEMENT'")
inter_ref = ref(poly([(200, 0), (250, 0), (250, 200), (200, 200)], 6000, 0))[0]
verif_vrai("X-02", F, "Chevauchement détecté, superficie concernée affichée (≈ 1 ha)", over and abs(float(over) - inter_ref) / inter_ref < 0.01, f"serveur {over} m², référence {inter_ref:.1f} m²")
verif("X-03", F, "Chevauchement bloquant, aucune géométrie modifiée ni supprimée", q(f"select bloquante||'|'||(select count(*) from public.farmer_plot_geometries where plot_id in ('{P2}','{PL['B']}') and status='SOUMIS') from public.farmer_plot_anomalies where plot_id='{P2}' and type='CHEVAUCHEMENT'"), "true|2")
GX = rx.get("geometry_id")
act("X-04", F, "zh1", "Validation refusée tant que le chevauchement est ouvert", f"select public.plot_map_decider('{GX}', 'VALIDER', null)", False, "anomalie")
ANO = q(f"select id from public.farmer_plot_anomalies where plot_id='{P2}' and type='CHEVAUCHEMENT'")
act("X-05", F, "zh2", "Chef de Zone d'une autre zone : classement refusé", f"select public.plot_map_classer_anomalie('{ANO}', 'LIMITE_PARTAGEE', 'Limite commune reconnue sur place.')", False, "zone")
act("X-06", F, "zh1", "Classement sans justification refusé", f"select public.plot_map_classer_anomalie('{ANO}', 'LIMITE_PARTAGEE', 'ok')", False, "justification")
act("X-07", F, "zh1", "Le Chef de Zone classe le cas (limite partagée) avec justification",
    f"select public.plot_map_classer_anomalie('{ANO}', 'LIMITE_PARTAGEE', 'Bande commune exploitée par les deux familles, reconnue sur place.')")
verif("X-08", F, "Classement, justification et auteur enregistrés", q(f"select statut||'|'||classification||'|'||(decided_by='{U['zh1']}') from public.farmer_plot_anomalies where id='{ANO}'"), "RESOLUE|LIMITE_PARTAGEE|true")

# ------------------------------------------------------------------ 8. validation
F = "Validation"
GA = RA.get("geometry_id"); GB = r1.get("geometry_id")
act("V-01", F, "auh_bro", "L'auteur ne valide pas son propre contour", f"select public.plot_map_decider('{GA}', 'VALIDER', null)", False)
act("V-02", F, "uh_bro", "Le Chef d'Unité ne valide pas", f"select public.plot_map_decider('{GA}', 'VALIDER', null)", False, "chef de zone")
act("V-03", F, "uh_bro", "Le Chef d'Unité pré-vérifie le tracé de son assistant", f"select public.plot_map_preverifier('{GA}', 'Limites contrôlées avec le producteur.')")
act("V-04", F, "uh_bro", "Le Chef d'Unité ne pré-vérifie pas son propre tracé", f"select public.plot_map_preverifier('{GX}', null)", False, "propre tracé")
act("V-05", F, "zh2", "Chef de Zone GBEKE 2 : contour de BROBO (GBEKE 1) refusé", f"select public.plot_map_decider('{GA}', 'VALIDER', null)", False, "votre zone")
act("V-06", F, "zh_sans", "Chef de Zone sans zone renseignée : refus par défaut", f"select public.plot_map_decider('{GA}', 'VALIDER', null)", False, "zone n'est pas renseignée")
act("V-07", F, "zh1", "Demande de correction sans commentaire refusée", f"select public.plot_map_decider('{GA}', 'A_CORRIGER', '')", False, "expliquez")
ver = q(f"select row_version from public.farmer_plot_geometries where id='{GA}'")
act("V-08", F, "zh1", "Version périmée refusée (contrôle de version)", f"select public.plot_map_decider('{GA}', 'VALIDER', null, {int(ver) + 5})", False, "rechargez")
act("V-09", F, "zh1", "Le Chef de Zone compétent valide", f"select public.plot_map_decider('{GA}', 'VALIDER', 'Conforme au terrain.', {ver})")
verif("V-10", F, "Parcelle VALIDE : superficie validée = surface serveur, méthode « satellite estimée », déclaré inchangé",
      q(f"select mapping_status||'|'||mapped_area_ha||'|'||mapped_area_method||'|'||declared_area||'|'||(current_geometry_id='{GA}') from public.farmer_plots where id='{PL['A']}'"),
      f"VALIDE|{round(float(RA['area_m2'])/10000, 4):.4f}|SATELLITE_ESTIMEE|5.000|true")
act("V-11", F, "zh1", "Un contour déjà validé ne peut pas être revalidé", f"select public.plot_map_decider('{GA}', 'VALIDER', null)", False, "plus en attente")
act("V-12", F, "bm", "Branch Manager sans drapeau d'exception : refus", f"select public.plot_map_decider('{GB}', 'VALIDER', 'x')", False, "exception")
act("V-13", F, "bm", "Exception avec justification trop courte : refus", f"select public.plot_map_decider('{GB}', 'VALIDER', 'urgent', null, true)", False, "15 caractères")
act("V-14", F, "zh1", "Un Chef de Zone ne peut pas utiliser l'exception", f"select public.plot_map_decider('{GB}', 'VALIDER', 'Justification suffisamment longue', null, true)", False, "réservée")
act("V-15", F, "bm", "Exception Branch Manager justifiée et journalisée",
    f"select public.plot_map_decider('{GB}', 'VALIDER', 'Chef de Zone absent, contrôle terrain fait par le BM le jour même.', null, true)")
verif("V-16", F, "Exception tracée, auteur du tracé inchangé", q(f"select decision_exception||'|'||(created_by='{U['auh_bro']}')||'|'||(decided_by='{U['bm']}') from public.farmer_plot_geometries where id='{GB}'"), "true|true|true")
verif("V-17", F, "Journal : action VALIDER_EXCEPTION_BM avec motif", q(f"select count(*) from public.farmer_plot_map_events where geometry_id='{GB}' and action='VALIDER_EXCEPTION_BM' and length(motif) > 15"), "1")
act("V-18", F, "zh1", "Le Chef de Zone renvoie un contour en correction avec commentaire", f"select public.plot_map_decider('{RD['geometry_id']}', 'A_CORRIGER', 'La limite est suit la piste, pas la haie.')")
verif("V-19", F, "Commentaire et statut À CORRIGER conservés", q(f"select status||'|'||decision_comment from public.farmer_plot_geometries where id='{RD['geometry_id']}'"), "A_CORRIGER|La limite est suit la piste, pas la haie.")
# correction d'une version validée : nouvelle version sur la base validée, l'ancienne reste VALIDE jusqu'à la nouvelle validation
rc2 = act("V-20", F, "auh_bro", "Correction d'un contour validé : nouvelle version sur la base validée",
          f"select public.plot_map_soumettre({lit(contour(PL['A'], poly([(0,0),(240,0),(240,200),(0,200)], 0, 0), base=GA))})")
verif("V-21", F, "La version validée n'est pas écrasée pendant la correction", q(f"select status from public.farmer_plot_geometries where id='{GA}'"), "VALIDE")
act("V-22", F, "zh1", "Validation de la correction", f"select public.plot_map_decider('{rc2['geometry_id']}', 'VALIDER', 'Correction conforme.')")
verif("V-23", F, "Ancienne version REMPLACÉE, une seule version VALIDE, superficie mise à jour",
      q(f"select (select status from public.farmer_plot_geometries where id='{GA}')||'|'||(select count(*) from public.farmer_plot_geometries where plot_id='{PL['A']}' and status='VALIDE')||'|'||(select current_geometry_id='{rc2['geometry_id']}' from public.farmer_plots where id='{PL['A']}')"), "REMPLACE|1|true")
act("V-24", F, "auh_bro", "Écriture directe dans les contours refusée (UPDATE)", f"update public.farmer_plot_geometries set area_m2 = 1 where id = '{GA}'", False)
act("V-25", F, "auh_bro", "Écriture directe dans les anomalies refusée (DELETE)", f"delete from public.farmer_plot_anomalies", False)
act("V-26", F, "zh1", "Écriture directe des paramètres refusée", f"update public.plot_map_parametres set valeur = '{{}}'", False)
# conflit entre deux agents
base_c = q(f"select id from public.farmer_plot_geometries where plot_id='{PL['C']}' and status='SOUMIS'")
act("V-27", F, "uh_bro", "Agent 1 corrige le contour C sur la dernière version", f"select public.plot_map_soumettre({lit(contour(PL['C'], poly(IRREG, 1500, 10), base=base_c))})")
rk = act("V-28", F, "auh_bro", "Agent 2 soumet une correction sur l'ANCIENNE version", f"select public.plot_map_soumettre({lit(contour(PL['C'], poly(IRREG, 1500, -10), base=base_c))})")
verif_vrai("V-29", F, "Conflit détecté : les deux versions conservées, anomalie bloquante, aucune perte", rk.get("conflit") is True and q(f"select count(*) from public.farmer_plot_geometries where plot_id='{PL['C']}' and status='SOUMIS'") == "2" and
           q(f"select count(*) from public.farmer_plot_anomalies where plot_id='{PL['C']}' and type='CONFLIT_VERSION' and bloquante and statut='OUVERTE'") == "1", rk)

# ------------------------------------------------------------------ 9. synchronisation
F = "Synchronisation"
SP = str(uuid.uuid4())
lot = [{"idempotency_key": "carto-cle-1", "type": "AJOUTER_PARCELLE", "device_id": "tel-fictif", "payload": {"id": SP, "producteur_id": "P-CARTO-B", "local_name": "PARCELLE FICTIVE B2"}},
       {"idempotency_key": "carto-cle-2", "type": "LOCALISER", "device_id": "tel-fictif", "payload": {"plot_id": SP, "latitude": 7.709, "longitude": -5.021, "precision_m": 7}},
       {"idempotency_key": "carto-cle-3", "type": "SOUMETTRE_CONTOUR", "device_id": "tel-fictif", "payload": contour(SP, poly(RECT, 9000, 0))},
       {"idempotency_key": "carto-cle-4", "type": "LOCALISER", "device_id": "tel-fictif", "payload": {"plot_id": SP, "latitude": 7.709, "longitude": -5.021, "precision_m": 400}}]
s1 = act("S-01", F, "auh_bro", "Lot hors ligne (ajout, localisation, contour, localisation imprécise)", f"select public.plot_map_sync_batch({lit(lot)})")
st = [x.get("statut") for x in s1.get("resultats", [])]
verif("S-02", F, "Statuts serveur : 3 acceptées, l'imprécise rejetée avec motif", st, ["ACCEPTEE", "ACCEPTEE", "ACCEPTEE", "REJETEE"])
s2 = act("S-03", F, "auh_bro", "Renvoi du même lot (réseau coupé avant la réponse)", f"select public.plot_map_sync_batch({lit(lot)})")
verif_vrai("S-04", F, "Renvoi : rejoué sans doublon (même contour, même parcelle)", all(x.get("rejoue") for x in s2.get("resultats", [])[:3]) and
           q(f"select count(*) from public.farmer_plots where id='{SP}'") == "1" and q(f"select count(*) from public.farmer_plot_geometries where plot_id='{SP}'") == "1", s2)
verif("S-05", F, "Une opération rejetée n'est pas mémorisée : elle peut être corrigée et renvoyée", q("select count(*) from private.plot_map_sync_recus where idempotency_key='carto-cle-4'"), "0")
lot2 = [dict(lot[1], payload={"plot_id": SP, "latitude": 7.70, "longitude": -5.0, "precision_m": 5})]
s3 = act("S-06", F, "auh_bro", "Même clé, contenu différent : refus explicite", f"select public.plot_map_sync_batch({lit(lot2)})")
verif("S-07", F, "Clé réutilisée détectée", (s3.get("resultats") or [{}])[0].get("statut"), "REJETEE")
s4 = act("S-08", F, "rt", "Lot envoyé par un RT : refus global", f"select public.plot_map_sync_batch({lit(lot)})", False, "refusé")

# ------------------------------------------------------------------ 10. lectures et périmètres (accès direct, sans l'interface)
F = "Sécurité"
def nb(user, sql):
    ok, out = run_as(user, sql); return out if ok else "REFUS"
verif_vrai("R-01", F, "Assistant BROBO : voit les contours BROBO, aucun de BOTRO",
           int(nb("auh_bro", "select count(*) from public.farmer_plot_geometries where cluster_code='BROBO'")) > 0 and nb("auh_bro", "select count(*) from public.farmer_plot_geometries where cluster_code='BOTRO'") == "0")
act("R-02", F, "uh_bot", "Contour BOTRO par le Chef d'Unité de BOTRO", f"select public.plot_map_soumettre({lit(contour(PL['E'], poly(RECT, 5000, 5000)))})")
verif("R-03", F, "Assistant BROBO : contour BOTRO invisible (accès direct)", nb("auh_bro", "select count(*) from public.farmer_plot_geometries where cluster_code='BOTRO'"), "0")
verif("R-04", F, "Chef de Zone GBEKE 1 : contours de BOTRO (GBEKE 2) invisibles", nb("zh1", "select count(*) from public.farmer_plot_geometries where zone_code='GBEKE_2'"), "0")
verif_vrai("R-05", F, "Chef de Zone GBEKE 2 : voit BOTRO", int(nb("zh2", "select count(*) from public.farmer_plot_geometries where zone_code='GBEKE_2'")) >= 1)
verif("R-06", F, "Chef de Zone sans zone : aucun contour visible", nb("zh_sans", "select count(*) from public.farmer_plot_geometries"), "0")
verif("R-07", F, "RT : aucun contour", nb("rt", "select count(*) from public.farmer_plot_geometries"), "0")
verif("R-08", F, "Finance : aucun contour ni coordonnée", nb("fin", "select count(*) from public.farmer_plot_geometries"), "0")
verif("R-09", F, "Supervisor sans affectation : aucun contour", nb("sup", "select count(*) from public.farmer_plot_geometries"), "0")
verif("R-10", F, "Anonyme : refus", nb("anon", "select count(*) from public.farmer_plot_geometries"), "REFUS")
verif("R-11", F, "Reçus de synchronisation inaccessibles", nb("auh_bro", "select count(*) from private.plot_map_sync_recus"), "REFUS")
verif("R-12", F, "Vue parcelles : l'assistant BROBO ne voit aucune parcelle BOTRO", nb("auh_bro", "select count(*) from public.plot_map_parcelles_v where cluster_code='BOTRO'"), "0")
verif("R-13", F, "Vue contours : GeoJSON lisible par le Chef de Zone compétent", nb("zh1", f"select geojson->>'type' from public.plot_map_geometries_v where id='{GA}'"), "Polygon")
act("R-14", F, "uh_bro", "Tableau de bord refusé au Chef d'Unité", "select public.plot_map_tableau('{}')", False, "réservé")
act("R-15", F, "zh_sans", "Tableau de bord refusé au Chef de Zone sans zone", "select public.plot_map_tableau('{}')", False, "zone")
tz = act("R-16", F, "zh2", "Tableau de bord du Chef de Zone GBEKE 2", "select public.plot_map_tableau('{}')")
verif_vrai("R-17", F, "Tableau du Chef de Zone limité à sa zone (aucune parcelle BROBO)", tz.get("perimetre") == "GBEKE_2" and all(c["cluster_code"] == "BOTRO" for c in tz.get("par_cluster", [])), tz.get("par_cluster"))

# ------------------------------------------------------------------ 11. pilotage
F = "Pilotage"
# Valider la parcelle voisine (chevauchement classé « limite partagée ») pour mesurer l'emprise unique.
act("P-00", F, "zh1", "Validation de la parcelle voisine (chevauchement classé)", f"select public.plot_map_decider('{GX}', 'VALIDER', 'Limite partagée reconnue.')")
tb = act("P-01", F, "bm", "Tableau de bord du Branch Manager", "select public.plot_map_tableau('{\"detail\": \"oui\"}')")
union_ok = tb and tb.get("emprise_unique_validee_ha") is not None and float(tb["emprise_unique_validee_ha"]) < float(tb["superficie_validee_somme_ha"])
verif_vrai("P-02", F, "Emprise unique < somme des superficies validées quand deux parcelles validées se recouvrent", union_ok,
           f"somme {tb.get('superficie_validee_somme_ha')} ha, emprise {tb.get('emprise_unique_validee_ha')} ha")
attendu_union = None
if union_ok:
    diff = float(tb["superficie_validee_somme_ha"]) - float(tb["emprise_unique_validee_ha"])
    verif_vrai("P-03", F, "La différence somme − emprise correspond au chevauchement (≈ 1 ha)", abs(diff - inter_ref / 10000) < 0.02, f"différence {diff:.4f} ha ; chevauchement {inter_ref/10000:.4f} ha")
verif_vrai("P-04", F, "Compteurs cohérents avec la base (localisées, validées, à corriger)",
           tb.get("parcelles_localisees") == int(q("select count(*) from public.farmer_plots where latitude is not null and not deleted")) and
           tb.get("parcelles_validees") == int(q("select count(*) from public.farmer_plots where mapping_status='VALIDE'")) and
           tb.get("parcelles_a_corriger") == int(q("select count(*) from public.farmer_plots where mapping_status='A_CORRIGER'")), {k: tb.get(k) for k in ("parcelles_localisees", "parcelles_validees", "parcelles_a_corriger")})
verif_vrai("P-05", F, "Le tableau ne renvoie aucune coordonnée", "latitude" not in json.dumps(tb) and "coordinates" not in json.dumps(tb))
verif_vrai("P-06", F, "Superficie déclarée sans double comptage des divisions (la parcelle A2 issue de A n'est pas recomptée)",
           tb.get("superficie_declaree_ha") is not None and abs(float(tb["superficie_declaree_ha"]) - float(q("select sum(declared_area) from public.farmer_plots where split_from_plot_id is null and not deleted"))) < 0.001)
tf = act("P-07", F, "bm", "Filtre par cluster", "select public.plot_map_tableau('{\"cluster\": \"BOTRO\"}')")
verif_vrai("P-08", F, "Filtre cluster appliqué", tf.get("parcelles") == int(q("select count(*) from public.farmer_plots fp join public.villages v on v.id=fp.village_id where v.cluster_code='BOTRO' and not fp.deleted")), tf.get("parcelles"))
verif_vrai("P-09", F, "Travail par agent présent (auteurs des contours)", len(tb.get("par_agent", [])) >= 2, tb.get("par_agent"))

verif("D-20", "Données", "Numéros de parcelle uniques (séquence ; non-régression de la collision d'identifiants du 20/11/2026)",
      q("select (count(plot_code) = count(distinct plot_code) and count(plot_code) > 0 and bool_and(plot_code ~ '^PLT-[A-Z0-9_]+-[0-9]{6}$'))::text from public.farmer_plots where plot_code is not null"), "true")

# ------------------------------------------------------------------ 12. retour arrière
F = "Retour arrière"
avant_rb = q(EMPREINTE)
appliquer(ROLLBACK)
verif("B-01", F, "Retour arrière : plus aucun objet de la cartographie", objets_carto(), "0")
verif_vrai("B-02", F, "Retour arrière : parcelles ajoutées conservées, points GPS conservés, aucune parcelle supprimée",
           int(q("select count(*) from public.farmer_plots")) >= int(NB_AVANT) and q(f"select gps_status from public.farmer_plots where id='{PL['A']}'") == "POINT_CAPTURED")
appliquer(ROLLBACK)
verif("B-03", F, "Retour arrière rejouable", objets_carto(), "0")
for m in MIG: appliquer(m)
verif_vrai("B-04", F, "Réapplication après retour arrière", int(objets_carto()) > 20)

# ------------------------------------------------------------------ synthèse
os.makedirs(OUT, exist_ok=True)
fam = {}
for r in R:
    f = fam.setdefault(r["famille"], {"total": 0, "reussis": 0, "echoues": 0}); f["total"] += 1; f["reussis" if r["resultat"] == "RÉUSSI" else "echoues"] += 1
ok = sum(1 for r in R if r["resultat"] == "RÉUSSI"); ko = len(R) - ok
json.dump({"base": DB, "hote": "local", "total": len(R), "reussis": ok, "echoues": ko, "par_famille": fam, "tests": R}, open(os.path.join(OUT, "serveur.json"), "w"), ensure_ascii=False, indent=1)
print(f"Recette serveur cartographie : {len(R)} tests, {ok} réussis, {ko} échoués.")
sys.exit(0 if ko == 0 else 1)

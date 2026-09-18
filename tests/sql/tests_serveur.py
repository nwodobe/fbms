#!/usr/bin/env python3
"""
Tests serveur Sacherie AFLP — Lot 1 (identite, roles, perimetres).

Execute chaque action SOUS LE ROLE `authenticated` (RLS active, aucun
contournement superutilisateur) avec l'identite JWT du compte de test, sur une
replique LOCALE construite par construire_replica.sh. Refuse toute cible
Supabase.

Usage :
  PGHOST=/tmp PGPORT=54329 python3 tests/sql/tests_serveur.py fbms_avant fbms_apres
Sortie : tableau Markdown (contexte, action, attendu, obtenu avant / apres).
"""
import json, os, subprocess, sys

HOST = os.environ.get("PGHOST", "")
PORT = os.environ.get("PGPORT", "")
if "supabase" in HOST:
    sys.exit("REFUS : cible Supabase detectee")

U = {
    "bm": "00000000-0000-0000-0000-0000000000b1", "zh": "00000000-0000-0000-0000-0000000000a1",
    "fboo": "00000000-0000-0000-0000-0000000000f1", "uh_botro": "00000000-0000-0000-0000-0000000000c1",
    "uh_diabo": "00000000-0000-0000-0000-0000000000c2", "sk_botro": "00000000-0000-0000-0000-0000000000d1",
    "sk_diabo": "00000000-0000-0000-0000-0000000000d2", "sk_sans": "00000000-0000-0000-0000-0000000000d3",
    "sk_inactif": "00000000-0000-0000-0000-0000000000d4", "sk_global": "00000000-0000-0000-0000-0000000000d5",
    "supervisor": "00000000-0000-0000-0000-0000000000e1", "fo_sans": "00000000-0000-0000-0000-0000000000e2",
    "nouveau": "00000000-0000-0000-0000-0000000000e3", "anon": None,
}

def psql(db, sql, superuser=False):
    r = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", db, "-X", "-q", "-At",
                        "-v", "ON_ERROR_STOP=1"], input=sql, capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()

def run_as(db, user, sql):
    if user == "anon":
        pre = "set local role anon; select set_config('request.jwt.claims','{\"role\":\"anon\"}',true);"
    else:
        claims = json.dumps({"sub": U[user], "role": "authenticated"})
        pre = f"set local role authenticated; select set_config('request.jwt.claims','{claims}',true);"
    code, out, err = psql(db, f"begin;\n\\o /dev/null\n{pre}\n\\o\n{sql};\ncommit;\n")
    if code == 0:
        lines = [l for l in out.splitlines() if l.strip()]
        return True, (lines[-1] if lines else "")
    msg = err.splitlines()
    msg = next((l for l in msg if "ERROR" in l), msg[0] if msg else "erreur")
    return False, msg.replace("psql:<stdin>:", "").split("ERROR:")[-1].strip()

def q(db, sql):
    return psql(db, sql)[1]

REQ = "(select id from public.ops_bag_requests where client_request_id='{}')"

# (id, compte, description, sql, attendu : 'OK' | 'REFUS' | 'OK=<valeur>')
T = [
 # --- Comptes et roles ---
 ("A01", "bm", "BM attribue un role reconnu (Storekeeper + cluster Botro) a un compte a qualifier",
  "with u as (update public.profils set role='Storekeeper', cluster='BOTRO' where email='nouveau@test.invalid' returning 1) select count(*) from u", "OK=1"),
 ("A02", "bm", "BM tente un libelle non reconnu par le serveur ('Warehouse Keeper')",
  "with u as (update public.profils set role='Warehouse Keeper' where email='nouveau@test.invalid' returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("A03", "uh_botro", "Unit Head tente de se donner le role Branch Manager (appel API direct)",
  "with u as (update public.profils set role='Branch Manager' where user_id=auth.uid() returning 1) select count(*) from u", "OK=0"),
 ("A04", "uh_botro", "Unit Head tente d'elargir son perimetre (authority_level GLOBAL)",
  "with u as (update public.profils set authority_level='GLOBAL', cluster=null where user_id=auth.uid() returning 1) select count(*) from u", "OK=0"),
 ("A07", "bm", "BM saisit un cluster inconnu",
  "with u as (update public.profils set cluster='BOUAKE-X' where email='sk.sans.cluster@test.invalid' returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("A07b", "bm", "Changement d'affectation : aucun mouvement de stock cree",
  "update public.profils set cluster='DIABO' where email='sk.global@test.invalid'; select count(*) from public.rcn_jute_movements where created_at = now()", "OK=0"),
 ("A08", "bm", "Referentiel des roles attribuables lisible par le BM",
  "select count(*) from public.fbms_roles_attribuables() where attribuable", "OK=17"),
 ("A09", "uh_botro", "Referentiel des roles refuse a un non-BM", "select count(*) from public.fbms_roles_attribuables()", "REFUS"),
 ("A10", "bm", "Journal : le changement A01 est trace (auteur, avant/apres)",
  "select count(*) from public.rcn_proc_audit_central where table_name='profils' and actor_id=auth.uid() and before_data->>'role'='Consultation uniquement' and after_data->>'role'='Storekeeper'", "OK=1"),
 # --- Perimetres physiques ---
 ("P01", "sk_botro", "Magasinier affecte (Botro) realise un inventaire sur son cluster",
  "select public.sacherie_ct_inventorier('AFLP-CL-BOTRO','UTILISABLE',1500,null,null)->>'status'", "OK=PASS"),
 ("P02", "sk_botro", "Meme magasinier inventorie un emplacement d'un autre cluster (Diabo)",
  "select public.sacherie_ct_inventorier('AFLP-CL-DIABO','UTILISABLE',1000,null,null)", "REFUS"),
 ("P03", "sk_sans", "Magasinier SANS affectation tente une ecriture",
  "select public.sacherie_ct_inventorier('AFLP-CL-BOTRO','UTILISABLE',1000,null,null)", "REFUS"),
 ("P04", "fo_sans", "Compte Supervisor + fonction_operationnelle 'Warehouse Keeper' sans cluster ecrit sur Diabo",
  "select public.sacherie_ct_inventorier('AFLP-CL-DIABO','UTILISABLE',1000,null,null)->>'status'", "REFUS"),
 ("P05", "sk_global", "Magasinier a portee globale EXPLICITE (authority_level GLOBAL) inventorie Diabo",
  "select public.sacherie_ct_inventorier('AFLP-CL-DIABO','UTILISABLE',1000,null,null)->>'status'", "OK=PASS"),
 ("P06", "sk_inactif", "Compte inactif tente un inventaire",
  "select public.sacherie_ct_inventorier('AFLP-CL-BOTRO','UTILISABLE',1000,null,null)", "REFUS"),
 ("P07", "sk_botro", "Magasinier ecrit sur un emplacement sans cluster (usine)",
  "select public.sacherie_ct_inventorier('AFLP-FACTORY-YAMOUSSOUKRO','UTILISABLE',0,null,null)", "REFUS"),
 ("P08", "zh", "Zonal Head tente une ecriture physique (inventaire)",
  "select public.sacherie_ct_inventorier('AFLP-CL-BOTRO','UTILISABLE',1000,null,null)", "REFUS"),
 ("P09", "zh", "Zonal Head consulte le cockpit : tous les clusters (portee globale)",
  "select jsonb_array_length(public.sacherie_ct_snapshot()->'clusters')", "OK=2"),
 ("P10", "sk_botro", "Magasinier Botro consulte le cockpit : son cluster seulement",
  "select jsonb_array_length(public.sacherie_ct_snapshot()->'clusters')", "OK=1"),
 ("P11", "sk_botro", "Lecture directe (RLS) du stock cluster par le magasinier Botro",
  "select count(*) from public.sacherie_ct_cluster_stock", "OK=1"),
 ("P12", "uh_botro", "Unit Head Botro : retour RT -> cluster (mouvement reseau)",
  "select (public.sacherie_ops_network_move('T-NET-1','RT_TO_CLUSTER','BOTRO','RT-TB1',null,10,null,'test',null))->>'qty'", "OK=10"),
 ("P13", "uh_botro", "Meme operation rejouee avec la meme cle (idempotence)",
  "select (public.sacherie_ops_network_move('T-NET-1','RT_TO_CLUSTER','BOTRO','RT-TB1',null,10,null,'test',null))->>'qty'", "OK=10"),
 ("P14", "bm", "Controle : une seule ligne canonique pour la cle T-NET-1",
  "select count(*) from public.rcn_jute_movements where event_key='SACH-P1:T-NET-1'", "OK=1"),
 ("P15", "uh_diabo", "Unit Head Diabo tente un mouvement reseau sur un RT de Botro",
  "select public.sacherie_ops_network_move('T-NET-2','RT_TO_CLUSTER','BOTRO','RT-TB1',null,5,null,'test',null)", "REFUS"),
 ("P16", "sk_botro", "Transfert : le magasinier Botro expedie Botro -> Diabo (droit sur l'origine)",
  "select (public.sacherie_ops_create_transfer('T-TR-1','AFLP-CL-BOTRO','AFLP-CL-DIABO','UTILISABLE',20,'VH-T','Chauffeur test','BL-T1',null,null))->>'statut'", "OK=EXPEDIE"),
 ("P17", "sk_botro", "Le meme magasinier tente de receptionner a Diabo (hors perimetre)",
  "select public.sacherie_ops_receive_transfer('T-RC-0',(select id from public.rcn_jute_transfers where document_ref='BL-T1'),20,null,'BL-T1',null)", "REFUS"),
 ("P18", "sk_diabo", "Le magasinier Diabo receptionne (droit sur la destination)",
  "select (public.sacherie_ops_receive_transfer('T-RC-1',(select id from public.rcn_jute_transfers where document_ref='BL-T1'),20,null,'BL-T1',null))->>'statut'", "OK=CLOS"),
 ("P19", "sk_diabo", "Magasinier Diabo tente d'expedier depuis Botro",
  "select public.sacherie_ops_create_transfer('T-TR-2','AFLP-CL-BOTRO','AFLP-CL-DIABO','UTILISABLE',5,null,null,'BL-T2',null,null)", "REFUS"),
 ("P20", "uh_botro", "Appel direct du helper sacherie_ct_location (creation/reactivation libre)",
  "select public.sacherie_ct_location('CLUSTER','DIABO',null,null,null,null)", "REFUS"),
 ("P21", "anon", "Appel anonyme de sacherie_ops_network_move",
  "select public.sacherie_ops_network_move('T-ANON','RT_TO_CLUSTER','BOTRO','RT-TB1',null,1,null,null,null)", "REFUS"),
 # --- Pertes ---
 ("L01", "sk_botro", "Magasinier declare une perte sur son cluster",
  "select public.sacherie_ct_declarer_perte('AFLP-CL-BOTRO','UTILISABLE',3,'Sacs voles test',null) like 'JLS-CT-%'", "OK=t"),
 ("L02", "bm", "BM decide la perte declaree par une autre personne",
  "select public.sacherie_ct_decider_perte((select id from public.rcn_jute_loss_requests where motif='Sacs voles test'),true,'ok') like 'JUT-LOSS-%'", "OK=t"),
 ("L03", "bm", "BM declare une perte puis tente de la decider lui-meme",
  "select public.sacherie_ct_decider_perte(public.sacherie_ct_declarer_perte('AFLP-CL-BOTRO','UTILISABLE',2,'Perte auto test',null),true,'auto')", "REFUS"),
 ("L04", "sk_inactif", "Compte inactif tente de decider une perte",
  "select public.sacherie_ct_decider_perte((select 'x'),true,null)", "REFUS"),
 # --- DOTATION_RT et circuit legacy V2 ---
 ("D01", "bm", "Insertion directe d'une DOTATION_RT (contournement du workflow)",
  "insert into public.sacs_mouvements(local_id,type,source,destination,cluster,rt_id,quantite,created_by,bag_state) values ('T-DOT-DIRECT','DOTATION_RT','CLUSTER','RT','BOTRO','RT-TB1',5,auth.uid(),'EMPTY')", "REFUS"),
 ("D02", "bm", "Requalification d'un mouvement existant en DOTATION_RT",
  "with u as (update public.sacs_mouvements set type='DOTATION_RT' where local_id='T-LEG-USINE-1' returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("D03", "uh_botro", "Circuit officiel : le Unit Head cree une demande de dotation",
  "select (public.sacherie_creer_demande('T-LEG-REQ-1','RT-TB1','CY-T1',0,20))->>'status'", "OK=PENDING_BM"),
 ("D04", "bm", "Circuit officiel : le BM approuve",
  "select (public.sacherie_decider_demande((select id from public.bag_movement_requests where client_request_id='T-LEG-REQ-1'),'APPROVE',20,'ok'))->>'status'", "OK=APPROVED"),
 ("D05", "bm", "L'approbateur tente d'executer sa propre dotation",
  "select public.sacherie_executer_demande((select id from public.bag_movement_requests where client_request_id='T-LEG-REQ-1'),20,'EMPTY',null)", "REFUS"),
 ("D06", "sk_botro", "Circuit officiel : le magasinier du cluster execute la dotation",
  "select (public.sacherie_executer_demande((select id from public.bag_movement_requests where client_request_id='T-LEG-REQ-1'),20,'EMPTY',null))->>'type'", "OK=DOTATION_RT"),
 ("D07", "bm", "Controle : la dotation est projetee une fois dans rcn_jute_movements",
  "select count(*) from public.rcn_jute_movements where source_type='AFLP_DOTATION_RT'", "OK=1"),
 ("D08", "uh_botro", "Mouvement legacy legitime : retour RT -> cluster (sacs_mouvements)",
  "insert into public.sacs_mouvements(local_id,type,source,destination,cluster,rt_id,rt_nom,quantite,created_by) values ('T-LEG-RET-1','RETOUR_RT','RT','CLUSTER','BOTRO','RT-TB1','RT test Botro 1',5,auth.uid()) returning quantite", "OK=5"),
 # --- Circuit central ops_bag_requests ---
 ("W01", "uh_botro", "Unit Head prepare l'emplacement du RT (RPC controlee)",
  "select public.sacherie_ct_location_rt('RT-TB1')", "OK=AFLP-RT-RT-TB1"),
 ("W02", "uh_botro", "Unit Head Botro cree une demande pour un RT de son cluster",
  "insert into public.ops_bag_requests(client_request_id,request_code,channel,campaign,cluster,rt_id,source_location_code,destination_location_code,requested_qty,status,requested_by) values ('T-OPS-1','T-OPS-1','AFLP','2027','BOTRO','RT-TB1','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',50,'REQUESTED',auth.uid()) returning status", "OK=REQUESTED"),
 ("W02b", "uh_botro", "Creation sans request_code (charge utile exacte du formulaire)",
  "insert into public.ops_bag_requests(client_request_id,channel,campaign,cluster,rt_id,source_location_code,destination_location_code,requested_qty,notes,status) values ('T-OPS-FORM','AFLP','2027','BOTRO','RT-TB1','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',5,'form','REQUESTED') returning (request_code like 'AFLP-%')::text", "OK=true"),
 ("W03", "uh_botro", "Unit Head Botro cree une demande pour un RT de Diabo",
  "insert into public.ops_bag_requests(client_request_id,request_code,channel,campaign,cluster,rt_id,source_location_code,destination_location_code,requested_qty,status,requested_by) values ('T-OPS-X','T-OPS-X','AFLP','2027','DIABO','RT-TD1','AFLP-CL-DIABO','AFLP-RT-RT-TB1',50,'REQUESTED',auth.uid())", "REFUS"),
 ("W04", "uh_botro", "Unit Head (initiateur) tente de revoir sa propre demande",
  f"with u as (update public.ops_bag_requests set status='REVIEWED' where id={REQ.format('T-OPS-1')} returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("W04b", "zh", "Zonal Head cree une demande puis tente de la revoir lui-meme (auto-revue)",
  "with i as (insert into public.ops_bag_requests(client_request_id,request_code,channel,campaign,cluster,rt_id,source_location_code,destination_location_code,requested_qty,status,requested_by) values ('T-OPS-ZH','T-OPS-ZH','AFLP','2027','BOTRO','RT-TB1','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',5,'REQUESTED',auth.uid()) returning id) select 1; with u as (update public.ops_bag_requests set status='REVIEWED' where client_request_id='T-OPS-ZH' returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("W05", "zh", "Zonal Head effectue la revue",
  f"update public.ops_bag_requests set status='REVIEWED' where id={REQ.format('T-OPS-1')} returning status", "OK=REVIEWED"),
 ("W06", "fboo", "Field Buying Operations Officer consolide",
  f"update public.ops_bag_requests set status='CONSOLIDATED' where id={REQ.format('T-OPS-1')} returning status", "OK=CONSOLIDATED"),
 ("W07", "bm", "Branch Manager approuve 40 sacs",
  f"update public.ops_bag_requests set status='BM_APPROVED', approved_qty=40, expires_at=now()+interval '24 hours' where id={REQ.format('T-OPS-1')} returning status", "OK=BM_APPROVED"),
 ("W07b", "bm", "L'approbation ne deplace aucun sac (aucun mouvement lie a la demande)",
  f"select count(*) from public.rcn_jute_movements where source_id = {REQ.format('T-OPS-1')}::text", "OK=0"),
 ("W08", "uh_botro", "Unit Head tente de gonfler la quantite approuvee (update direct)",
  f"with u as (update public.ops_bag_requests set approved_qty=50 where id={REQ.format('T-OPS-1')} returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("W09", "sk_botro", "Magasinier tente de detourner la destination de la demande approuvee",
  f"with u as (update public.ops_bag_requests set destination_location_code='AFLP-CL-DIABO' where id={REQ.format('T-OPS-1')} returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("W10", "sk_botro", "Magasinier marque FULLY_RELEASED sans sortie physique",
  f"with u as (update public.ops_bag_requests set status='FULLY_RELEASED', released_qty=40 where id={REQ.format('T-OPS-1')} returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("W11", "bm", "L'approbateur tente la sortie physique",
  f"select public.ops_release_bags({REQ.format('T-OPS-1')},'T-REL-BM','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',10,null,null)", "REFUS"),
 ("W12", "sk_diabo", "Magasinier d'un autre cluster tente la sortie depuis Botro",
  f"select public.ops_release_bags({REQ.format('T-OPS-1')},'T-REL-D','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',10,null,null)", "REFUS"),
 ("W13", "sk_botro", "Magasinier Botro enregistre la sortie (40)",
  f"select (public.ops_release_bags({REQ.format('T-OPS-1')},'T-REL-1','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',40,null,null))->>'qty'", "OK=40"),
 ("W14", "sk_botro", "Sortie rejouee avec la meme cle : aucun doublon",
  f"select (public.ops_release_bags({REQ.format('T-OPS-1')},'T-REL-1','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',40,null,null))->>'qty'", "OK=40"),
 ("W15", "bm", "Controle : une seule sortie et un seul mouvement pour T-REL-1",
  "select (select count(*) from public.ops_bag_releases where client_release_id='T-REL-1')||'/'||(select count(*) from public.rcn_jute_movements where event_key='OPS-BAG-RELEASE:T-REL-1')", "OK=1/1"),
 ("W16", "uh_diabo", "Unit Head d'un autre cluster tente de confirmer la reception",
  f"with u as (update public.ops_bag_requests set received_qty=40 where id={REQ.format('T-OPS-1')} returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("W17", "uh_botro", "Unit Head Botro confirme la reception",
  f"update public.ops_bag_requests set received_qty=40 where id={REQ.format('T-OPS-1')} returning received_qty", "OK=40"),
 ("W18", "uh_botro", "Demande de 5000 sacs (stock Botro < 5000)",
  "insert into public.ops_bag_requests(client_request_id,request_code,channel,campaign,cluster,rt_id,source_location_code,destination_location_code,requested_qty,status,requested_by) values ('T-OPS-2','T-OPS-2','AFLP','2027','BOTRO','RT-TB1','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',5000,'REQUESTED',auth.uid()) returning status", "OK=REQUESTED"),
 ("W19", "zh", "Revue T-OPS-2", f"update public.ops_bag_requests set status='REVIEWED' where id={REQ.format('T-OPS-2')} returning status", "OK=REVIEWED"),
 ("W20", "fboo", "Consolidation T-OPS-2", f"update public.ops_bag_requests set status='CONSOLIDATED' where id={REQ.format('T-OPS-2')} returning status", "OK=CONSOLIDATED"),
 ("W21", "bm", "Approbation T-OPS-2 (5000)", f"update public.ops_bag_requests set status='BM_APPROVED', approved_qty=5000, expires_at=now()+interval '24 hours' where id={REQ.format('T-OPS-2')} returning status", "OK=BM_APPROVED"),
 ("W22", "sk_botro", "Sortie superieure au stock disponible",
  f"select public.ops_release_bags({REQ.format('T-OPS-2')},'T-REL-2','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',5000,null,null)", "REFUS"),
 ("W23", "supervisor", "Role non habilite tente une sortie",
  f"select public.ops_release_bags({REQ.format('T-OPS-2')},'T-REL-3','AFLP-CL-BOTRO','AFLP-RT-RT-TB1',1,null,null)", "REFUS"),
 # --- Soldes ---
 ("S01", "bm", "Solde final Botro = 1000 +500 (usine legacy) +10 (retour) +5 (retour legacy) -20 (transfert) -3 (perte) -20 (dotation) -40 (sortie)",
  "select sum(qty) from public.rcn_jute_v_stock where location_code='AFLP-CL-BOTRO' and state='UTILISABLE'", "OK=1432"),
 # --- Tests destructifs pour le contexte, joues en dernier ---
 ("A05", "bm", "BM tente d'attribuer General Manager depuis l'ecran",
  "with u as (update public.profils set role='General Manager' where email='supervisor@test.invalid' returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
 ("A06", "bm", "BM tente de se desactiver lui-meme",
  "with u as (update public.profils set actif=false where user_id=auth.uid() returning 1) select count(*)||' ligne(s)' from u", "REFUS"),
]

def verdict(ok, val, attendu):
    if attendu == "REFUS":
        # refus explicite (exception) ou refus silencieux RLS (0 ligne modifiee)
        return (not ok) or val.startswith("0 ligne")
    if attendu == "OK":
        return ok
    return ok and val == attendu.split("=", 1)[1]

def main():
    dbs = sys.argv[1:] or ["fbms_apres"]
    res = {db: {} for db in dbs}
    for db in dbs:
        for tid, user, desc, sql, att in T:
            ok, val = run_as(db, user, sql)
            res[db][tid] = (ok, val, verdict(ok, val, att))
    print("| Test | Compte | Action | Attendu | " + " | ".join(f"Obtenu {d}" for d in dbs) + " |")
    print("|---|---|---|---|" + "---|" * len(dbs))
    for tid, user, desc, sql, att in T:
        cells = []
        for db in dbs:
            ok, val, v = res[db][tid]
            obt = ("OK " + val) if ok else ("REFUS : " + val)
            cells.append(("CONFORME" if v else "ÉCART") + " — " + obt.replace("|", "/")[:150])
        print(f"| {tid} | {user} | {desc} | {att} | " + " | ".join(cells) + " |")
    last = dbs[-1]
    ko = [t for t in res[last] if not res[last][t][2]]
    print(f"\n{last} : {len(T)-len(ko)}/{len(T)} conformes" + (f" ; écarts : {', '.join(ko)}" if ko else ""))
    sys.exit(1 if ko else 0)

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
CONTRÔLE DE SÉCURITÉ SÉPARÉ — bucket Storage EXISTANT « photos » (hors Observatoire).
Rejoue, sur le STAGING FIDÈLE (politiques Storage de production, à l'identique), ce qu'un compte
connecté quelconque peut faire dans ce bucket. Comptes et fichiers FICTIFS. Refuse toute cible Supabase.
Usage : PGHOST=127.0.0.1 PGPORT=54329 python3 tests/observatoire/securite_bucket_photos.py fbms_pheno_staging
"""
import json, os, subprocess, sys
HOST = os.environ.get("PGHOST", ""); PORT = os.environ.get("PGPORT", "")
if not HOST or "supabase" in HOST: sys.exit("REFUS : cible absente ou Supabase détectée")
DB = sys.argv[1] if len(sys.argv) > 1 else "fbms_pheno_staging"
VIL = os.environ.get("PHOTOS_VILLAGE", "V-FICTIF-PHOTOS"); SORTIE = os.environ.get("PHOTOS_SORTIE", "securite_bucket_photos.json")
def psql(sql):
    r = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], input=sql, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1] if r.returncode == 0 else r.stderr.strip().split("ERROR:")[-1].strip()
def comme(uid, sql):
    pre = "set local role anon;" if uid is None else f"set local role authenticated; select set_config('request.jwt.claim.sub','{uid}',true);"
    return psql(f"begin;\n\\o /dev/null\n{pre}\n\\o\n{sql};\ncommit;")
U = {"bm": "00000000-0000-4000-8000-0000000000b1", "rt": "00000000-0000-4000-8000-0000000000b2",
     "uh_bot": "00000000-0000-4000-8000-0000000000b3", "inactif": "00000000-0000-4000-8000-0000000000b4", "sans_profil": "00000000-0000-4000-8000-0000000000b5", "uh_bro": "00000000-0000-4000-8000-0000000000b6"}
psql("insert into auth.users (id, email) values " + ",".join(f"('{v}','{k}.photos@example.invalid')" for k, v in U.items()) + " on conflict do nothing;"
     "insert into public.profils (user_id, email, nom, role, cluster, actif) values "
     f"('{U['bm']}','bm.photos@example.invalid','BM FICTIF','Branch Manager',null,true),('{U['rt']}','rt.photos@example.invalid','RT FICTIF','RT','BROBO',true),"
     f"('{U['uh_bot']}','uhbot.photos@example.invalid','UH BOTRO FICTIF','Unit Head','BOTRO',true),('{U['inactif']}','inactif.photos@example.invalid','COMPTE DÉSACTIVÉ FICTIF','Unit Head','BROBO',false),('{U['uh_bro']}','uhbro.photos@example.invalid','UH BROBO FICTIF','Unit Head','BROBO',true) on conflict do nothing;"
     f"insert into public.villages (id, data, village, cluster, cluster_code) values ('{VIL}', '{{}}', 'VILLAGE FICTIF PHOTOS', 'Brobo', 'BROBO') on conflict do nothing;"
     "insert into storage.objects (bucket_id, name, owner) values ('photos','"+VIL+"/chef.jpg', null) on conflict do nothing;")
R = []
def t(i, compte, action, sql, dangereux_si_ok=True):
    ok, out = comme(U.get(compte), sql)
    R.append({"id": i, "compte": compte, "action": action, "obtenu": "AUTORISÉ" if ok and out not in ("0", "") else "REFUSÉ", "detail": out[:160]})
t("PH-01", "rt", "Un RT lit la liste et le portrait du chef d'un village quelconque", "select count(*) from storage.objects where bucket_id='photos' and name like '%/chef.jpg'")
t("PH-02", "uh_bot", "Un Unit Head d'un autre cluster lit le portrait", f"select count(*) from storage.objects where bucket_id='photos' and name='{VIL}/chef.jpg'")
t("PH-03", "rt", "Un RT dépose un fichier dans le dossier d'un village quelconque", f"insert into storage.objects (bucket_id, name) values ('photos','{VIL}/rt.jpg') returning 1")
t("PH-04", "rt", "Un RT dépose un fichier exécutable (aucun contrôle de type)", "insert into storage.objects (bucket_id, name) values ('photos','V-AUTRE/programme.exe') returning 1")
t("PH-05", "uh_bot", "Un Unit Head d'un autre cluster REMPLACE le portrait du chef", f"update storage.objects set metadata='{{\"remplace\":true}}' where bucket_id='photos' and name='{VIL}/chef.jpg' returning 1")
t("PH-06", "inactif", "Un compte DÉSACTIVÉ (session encore valide) dépose un fichier", f"insert into storage.objects (bucket_id, name) values ('photos','{VIL}/intrus.jpg') returning 1")
t("PH-07", "sans_profil", "Un compte connecté SANS profil FBMS lit le bucket", "select count(*) from storage.objects where bucket_id='photos'")
t("PH-11", "bm", "Le Branch Manager lit le portrait (contrôle positif)", f"select count(*) from storage.objects where bucket_id='photos' and name='{VIL}/chef.jpg'")
t("PH-12", "uh_bro", "Le Unit Head du cluster du village lit le portrait (contrôle positif)", f"select count(*) from storage.objects where bucket_id='photos' and name='{VIL}/chef.jpg'")
t("PH-13", "uh_bro", "Le Unit Head du cluster du village dépose une photo (contrôle positif)", f"insert into storage.objects (bucket_id, name) values ('photos','{VIL}/route.jpg') returning 1")
t("PH-14", "bm", "Le Branch Manager remplace une photo (contrôle positif)", f"update storage.objects set metadata='{{}}' where bucket_id='photos' and name='{VIL}/chef.jpg' returning 1")
t("PH-08", "rt", "Un RT SUPPRIME le portrait du chef d'un village quelconque", f"delete from storage.objects where bucket_id='photos' and name='{VIL}/chef.jpg' returning 1")
t("PH-09", None, "Un visiteur non connecté (anon) lit via la base", "select count(*) from storage.objects where bucket_id='photos'")
ok, pub = psql("select public::text || '|' || coalesce(file_size_limit::text,'aucune') || '|' || coalesce(array_to_string(allowed_mime_types,','),'tous') from storage.buckets where id='photos'")
R.append({"id": "PH-10", "compte": "configuration", "action": "Bucket public (URL lisible sans connexion par l'API Storage) ; limite de taille ; types admis", "obtenu": pub, "detail": ""})
os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultats"), exist_ok=True)
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultats", SORTIE), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for r in R: print(f"{r['id']} | {r['compte']} | {r['action']} | {r['obtenu']} | {r['detail']}")

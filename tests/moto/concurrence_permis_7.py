#!/usr/bin/env python3
# AFLP FLEET migration 7 : retrait et vérification simultanés du même numéro (réplique LOCALE, copie jetable fbms_dl).
# Usage : createdb -h /srv/pgtest -p 54329 -U postgres -T fbms_moto_test fbms_dl ; python3 tests/moto/concurrence_permis_7.py ; dropdb ... fbms_dl
import subprocess, time, json, uuid
H,P,D="/srv/pgtest","54329","fbms_dl"
def q(sql): return subprocess.run(["psql","-h",H,"-p",P,"-U","postgres","-d",D,"-XAtq","-c",sql],capture_output=True,text=True).stdout.strip()
u=lambda n: f"00000000-0000-4000-8000-{n:012d}"
TIT, BM, ABM, LC = u(210), u(201), u(202), u(203)
def preparer(num):
    q(f"update public.moto_permis set statut='NON_CONFORME', verifie_par='{BM}', verifie_at=now(), motif_verification='nettoyage du test' where titulaire_id='{TIT}' and statut in ('EN_VERIFICATION')")
    q(f"update public.moto_permis set statut='REMPLACE' where titulaire_id='{TIT}' and statut='CONFORME'")
    old=q(f"insert into public.moto_permis (titulaire_id, nom_titulaire, numero_permis, categories, sans_expiration, document_path, statut, verification_rh_nom, categorie_adaptee, depose_par, verifie_par, verifie_at) values ('{TIT}','X X X','{num}','{{A}}',true,'permis/{TIT}/{uuid.uuid4()}.pdf','CONFORME','RH FICTIF',true,'{LC}','{BM}',now()) returning id").splitlines()[0]
    new=q(f"insert into public.moto_permis (titulaire_id, nom_titulaire, numero_permis, categories, sans_expiration, document_path, depose_par) values ('{TIT}','X X X','{num}','{{A}}',true,'permis/{TIT}/{uuid.uuid4()}.pdf','{LC}') returning id").splitlines()[0]
    return old,new
def lancer(user, sql, pause):
    cl=json.dumps({"sub":user,"role":"authenticated"})
    p=subprocess.Popen(["psql","-h",H,"-p",P,"-U","postgres","-d",D,"-XAtq","-v","ON_ERROR_STOP=1"],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    p.stdin.write(f"begin;\nset local role authenticated;\nselect set_config('request.jwt.claims','{cl}',true);\n{sql};\nselect pg_sleep({pause});\ncommit;\n"); p.stdin.close(); return p
for ordre in ("vérification puis retrait", "retrait puis vérification"):
    old,new=preparer("DL-" + str(int(time.time()*1000))[-7:])
    ver=(ABM, f"select public.moto_permis_verifier('{new}','CONFORME','RH FICTIF',true)")
    ret=(BM, f"select public.moto_permis_retirer('{old}','Retrait concurrent de test fictif')")
    a,b = (ver,ret) if ordre.startswith("vér") else (ret,ver)
    pa=lancer(a[0],a[1],3); time.sleep(1); pb=lancer(b[0],b[1],0); pa.wait(); pb.wait()
    ea=pa.stderr.read(); eb=pb.stderr.read()
    etat=q(f"select (select statut from public.moto_permis where id='{old}')||'/'||(select statut from public.moto_permis where id='{new}')")
    print(f"{ordre} : A={'OK' if pa.returncode==0 else 'ERREUR '+ea.split('ERROR:')[-1].strip()[:90]} · B={'OK' if pb.returncode==0 else 'ERREUR '+eb.split('ERROR:')[-1].strip()[:90]} · ancien/nouveau={etat} · interblocage={'deadlock' in (ea+eb)}")

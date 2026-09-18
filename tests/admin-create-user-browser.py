"""Recette DOM Chromium hors reseau. Auth, SDK et fetch simules; aucune production."""
import asyncio
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('ADMIN_TEST_OUTPUT', str(Path(tempfile.gettempdir())/'fbms-admin-validation')))
OUT.mkdir(parents=True, exist_ok=True)
SDK = r'''
window.__cas='succes';window.__refresh=0;window.__profils=[];
window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:window.__cas==='sans-session'?null:{access_token:'jeton-test-non-reel',expires_at:window.__cas==='session-expiree'?1:9999999999}}}),refreshSession:async()=>{window.__refresh++;return {data:{session:{access_token:'jeton-test-renouvele',expires_at:9999999999}}};}},
 rpc:async()=>({data:[{valeur:'Zonal Head',libelle:'Chef de Zone (Zonal Head)',attribuable:true,cluster_requis:false,note:'Portee globale explicite.'},{valeur:'Unit Head',libelle:"Chef d'Unite",attribuable:true,cluster_requis:true}]}),
 from:t=>({select:()=>({order:async()=>({data:t==='profils'?window.__profils:[{code:'CL-TEST',label:'Cluster fictif',active:true}]})})})
})};
'''
FETCH = r'''
window.__calls=[];
window.fetch=async (_url,opts)=>{
 const d=JSON.parse(opts.body);window.__calls.push(d);
 if(window.__cas==='reseau')throw new TypeError('Failed to fetch');
 await new Promise(r=>setTimeout(r,50));
 let status=201,data={ok:true,user_id:'22222222-2222-4222-8222-222222222222',email:d.email,role:d.role,cluster:d.cluster,profile_verified:true,request_id:'11111111-1111-4111-8111-111111111111'};
 if(window.__cas==='404'){status=404;data={error:'not found'};}
 else if(window.__cas==='401'){status=401;data={error:'bad jwt'};}
 else if(window.__cas==='doublon-email'){status=409;data={code:'EMAIL_EXISTANT'};}
 else if(window.__cas==='reponse-incomplete'){status=200;data={ok:true};}
 else if(window.__cas==='erreur-redaction'){status=500;data={code:'COHERENCE_A_VERIFIER',error:d.password+' NEVER_SHOW_TOKEN'};}
 if(status===201)window.__profils.push({user_id:'22222222-2222-4222-8222-222222222222',nom:d.nom,email:d.email,role:d.role,actif:true,cluster:d.cluster});
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
'''
async def main():
    results=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
        for w,h in [(390,844),(768,1024),(1440,900)]:
            for cas in ['masque','succes','404','401','doublon-email','reponse-incomplete','reseau','sans-session','cluster-requis','double-clic','session-expiree','erreur-redaction']:
                ctx=await browser.new_context(viewport={'width':w,'height':h})
                page=await ctx.new_page()
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                # Refuser tout acces externe: seules des doublures en memoire sont utilisees.
                await page.route('**/*',lambda r:r.abort())
                try:
                    html=ROOT.joinpath('shared/admin.html').read_text()
                    html=re.sub(r'<script[^>]*src="[^"]*"[^>]*></script>', '',html)
                    html=html.replace('<script>','<script>'+SDK+FETCH,1)
                    await page.set_content(html)
                    await page.evaluate("document.dispatchEvent(new CustomEvent('anagroci:authenticated',{detail:{profile:{user_id:'11111111-1111-4111-8111-111111111111',role:'Branch Manager',actif:true}}}))")
                    await page.wait_for_function('document.querySelector("#nRole").options.length>0')
                    await page.evaluate('(c)=>window.__cas=c',cas)
                    await page.fill('#nNom','Agent fictif')
                    await page.fill('#nEmail','agent@example.invalid')
                    await page.fill('#nPass','Mot-Fictif-123!')
                    await page.select_option('#nRole','Unit Head' if cas=='cluster-requis' else 'Zonal Head')
                    if cas=='masque':
                        assert await page.get_attribute('#nPass','type')=='password'
                        await page.click('#togglePass')
                        assert await page.get_attribute('#nPass','type')=='text'
                        await page.click('#togglePass')
                        assert await page.get_attribute('#nPass','type')=='password'
                    else:
                        if cas=='double-clic':
                            await page.evaluate('Promise.all([createUser(),createUser()])')
                        else:
                            await page.click('#btnCreate')
                            await page.wait_for_function('document.querySelector("#cMsg").classList.contains("show")')
                        texte=await page.text_content('#cMsg')
                        calls=await page.evaluate('window.__calls')
                        if cas in ['succes','double-clic','session-expiree']:
                            assert 'Profil enregistr' in texte,texte
                            assert len(calls)==1
                            assert await page.input_value('#nPass')==''
                            assert 'Agent fictif' in await page.inner_text('#rows')
                            if cas=='session-expiree':
                                assert await page.evaluate('window.__refresh')==1
                            if cas=='succes':
                                await page.screenshot(path=str(OUT/f'creation-locale-{w}.png'),full_page=True)
                        elif cas=='404':
                            assert "n'est pas disponible" in texte and 'connexion' not in texte.lower()
                        elif cas=='401':
                            assert 'Reconnectez-vous' in texte
                        elif cas=='doublon-email':
                            assert 'existe d' in texte
                        elif cas=='reponse-incomplete':
                            assert 'confirm' in texte and 'REPONSE_INCOMPLETE' in texte
                        elif cas=='reseau':
                            assert 'inconnu' in texte and 'RESEAU_OU_CORS' in texte
                        elif cas=='sans-session':
                            assert 'Reconnectez-vous' in texte and len(calls)==0
                        elif cas=='cluster-requis':
                            assert 'cluster' in texte and len(calls)==0
                        elif cas=='erreur-redaction':
                            assert 'NEVER_SHOW_TOKEN' not in texte and 'Mot-Fictif' not in texte and 'incompl' in texte
                        assert await page.is_enabled('#btnCreate')
                    assert not errors,errors
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Debordement horizontal'
                    assert 'localStorage' not in html[html.index('async function createUser(){'):]
                    results.append({'scenario':cas,'viewport':f'{w}x{h}','result':'PASS'})
                except Exception as e:
                    results.append({'scenario':cas,'viewport':f'{w}x{h}','result':'FAIL','error':str(e)})
                    await page.screenshot(path=str(OUT/f'echec-{cas}-{w}.png'),full_page=True)
                await ctx.close()
        await browser.close()
    rapport={'nature':'DOM Chromium avec fetch, SDK et session simules; pas de validation CORS transport ni Auth/RLS reelle','tests':results,'site_public':{'result':'NON_TESTE','raison':'Cette recette ne contacte aucun serveur distant.'}}
    (OUT/'browser-results.json').write_text(json.dumps(rapport,ensure_ascii=False,indent=2))
    print(json.dumps({'pass':sum(r['result']=='PASS' for r in results),'fail':sum(r['result']=='FAIL' for r in results)}))
    for r in results:
        if r['result']=='FAIL':print(r)
    assert all(r['result']=='PASS' for r in results)
asyncio.run(main())

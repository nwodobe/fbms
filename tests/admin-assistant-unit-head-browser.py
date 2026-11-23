"""Recette DOM Chromium hors réseau : création d'un Assistant Unit Head depuis
shared/admin.html. Auth, SDK et fetch simulés ; aucune production contactée.
Vérifie : rôle proposé, cohérence zone/cluster, détail des droits, lien
d'activation (mot de passe jamais saisi ni affiché), statut inactif,
3 largeurs sans débordement horizontal."""
import asyncio, json, os, re, shutil, tempfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('ADMIN_TEST_OUTPUT', str(Path(tempfile.gettempdir())/'fbms-admin-auh')))
OUT.mkdir(parents=True, exist_ok=True)
SDK = r'''
window.__reset=[];window.__updates=[];window.__profils=[];window.__calls=[];
const CL=[{code:'BOTRO',label:'Botro',active:true,zone_code:'GBEKE_2'},{code:'BROBO',label:'Brobo',active:true,zone_code:'GBEKE_1'},
  {code:'DIABO',label:'Diabo',active:true,zone_code:'GBEKE_2'},{code:'SAKASSOU',label:'Sakassou',active:true,zone_code:'GBEKE_1'}];
const ZO=[{code:'GBEKE_1',label:'GBEKE 1'},{code:'GBEKE_2',label:'GBEKE 2'}];
window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:{access_token:'jeton-test-non-reel',expires_at:9999999999}}}),
   resetPasswordForEmail:async(e,o)=>{window.__reset.push({e,o});return {data:{},error:null};}},
 rpc:async()=>({data:[{valeur:'Unit Head',libelle:"Chef d'Unité",attribuable:true,cluster_requis:true,note:'UH.'},
   {valeur:'Assistant Unit Head',libelle:"Assistant Chef d'Unité (Assistant Unit Head)",portee:'CLUSTER',attribuable:true,cluster_requis:true,note:'Appui du Chef d’Unité.'}]}),
 from:t=>({select:()=>({order:async()=>({data:t==='profils'?window.__profils:(t==='aflp_zones'?ZO:CL)})}),
   update:p=>({eq:(k,v)=>({select:async()=>{window.__updates.push({t,p,v});const r=window.__profils.find(x=>x.user_id===v);if(r)Object.assign(r,p);return {data:[{user_id:v}],error:null};}})})})
})};
window.fetch=async (_u,opts)=>{const d=JSON.parse(opts.body);window.__calls.push(d);
 window.__profils.push({user_id:'22222222-2222-4222-8222-222222222222',nom:d.nom,email:d.email,role:d.role,actif:true,cluster:d.cluster,zone:'GBEKE_2'});
 return new Response(JSON.stringify({ok:true,user_id:'22222222-2222-4222-8222-222222222222',email:d.email,role:d.role,cluster:d.cluster,profile_verified:true,request_id:'11111111-1111-4111-8111-111111111111'}),{status:201,headers:{'Content-Type':'application/json'}});};
'''
async def main():
    res=[]
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
        for w,h in [(390,844),(768,1024),(1440,900)]:
            for cas in ['lien-actif','inactif','zone-incoherente']:
                ctx=await b.new_context(viewport={'width':w,'height':h}); page=await ctx.new_page(); err=[]
                page.on('pageerror',lambda e:err.append(str(e))); await page.route('**/*',lambda r:r.abort())
                try:
                    html=ROOT.joinpath('shared/admin.html').read_text()
                    html=re.sub(r'<script[^>]*src="[^"]*"[^>]*></script>','',html).replace('<script>','<script>'+SDK,1)
                    await page.set_content(html)
                    await page.evaluate("document.dispatchEvent(new CustomEvent('anagroci:authenticated',{detail:{profile:{user_id:'11111111-1111-4111-8111-111111111111',role:'Branch Manager',actif:true}}}))")
                    await page.wait_for_function('document.querySelector("#nRole").options.length>0')
                    await page.select_option('#nRole','Assistant Unit Head')
                    droits=await page.text_content('#nDroits')
                    assert 'Refusé par le serveur' in droits and 'autre cluster' in droits, droits
                    assert await page.is_hidden('#zonePass'), 'mot de passe visible en mode lien'
                    await page.select_option('#nZone','GBEKE_2')
                    opts=await page.eval_on_selector_all('#nCluster option','o=>o.map(x=>x.value).filter(Boolean)')
                    assert sorted(opts)==['BOTRO','DIABO'], opts
                    await page.fill('#nNom','Assistant fictif'); await page.fill('#nEmail','auh@example.invalid')
                    if cas=='zone-incoherente':
                        await page.select_option('#nZone','')
                        await page.select_option('#nCluster','BROBO')
                        assert await page.input_value('#nZone')=='GBEKE_1', 'le cluster doit imposer sa zone'
                        await page.evaluate("document.querySelector('#nZone').value='GBEKE_2'")
                        await page.click('#btnCreate'); txt=await page.text_content('#cMsg')
                        assert "n'appartient pas" in txt and not await page.evaluate('window.__calls.length'), txt
                    else:
                        await page.select_option('#nCluster','BOTRO')
                        if cas=='inactif': await page.select_option('#nStatut','inactif')
                        await page.click('#btnCreate')
                        await page.wait_for_function('document.querySelector("#cMsg").classList.contains("show")')
                        txt=await page.text_content('#cMsg'); calls=await page.evaluate('window.__calls')
                        assert 'Profil enregistr' in txt and "Lien d'activation envoy" in txt, txt
                        assert len(calls)==1 and calls[0]['role']=='Assistant Unit Head' and calls[0]['cluster']=='BOTRO'
                        assert len(calls[0]['password'])>=30 and calls[0]['password'] not in txt
                        reset=await page.evaluate('window.__reset')
                        assert reset and reset[0]['e']=='auh@example.invalid' and reset[0]['o']['redirectTo'].endswith('password-reset.html')
                        ups=await page.evaluate('window.__updates')
                        if cas=='inactif': assert ups and ups[0]['p']=={'actif':False} and 'désactivé' in txt, (ups,txt)
                        else: assert not ups
                        rows=await page.inner_text('#rows'); assert 'Assistant fictif' in rows and 'GBEKE 2' in rows, rows
                        if cas=='lien-actif': await page.screenshot(path=str(OUT/f'auh-creation-{w}.png'),full_page=True)
                    assert not err, err
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Débordement horizontal'
                    res.append({'cas':cas,'largeur':f'{w}x{h}','resultat':'PASS'})
                except Exception as e:
                    res.append({'cas':cas,'largeur':f'{w}x{h}','resultat':'FAIL','erreur':str(e)})
                    await page.screenshot(path=str(OUT/f'echec-{cas}-{w}.png'),full_page=True)
                await ctx.close()
        await b.close()
    (OUT/'resultats.json').write_text(json.dumps(res,ensure_ascii=False,indent=2))
    print(json.dumps({'pass':sum(r['resultat']=='PASS' for r in res),'fail':sum(r['resultat']=='FAIL' for r in res)}))
    for r in res:
        if r['resultat']=='FAIL': print(r)
    assert all(r['resultat']=='PASS' for r in res)
asyncio.run(main())

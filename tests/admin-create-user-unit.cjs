/** Tests de logique avec doublures. Aucune ecriture distante; ne prouve pas Auth/RLS reel. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('typescript');
const f=path.join(__dirname,'../supabase/functions/admin-create-user/handler.ts');
const m=new Module(f,module);m.filename=f;
m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,f);
const {creerGestionnaire}=m.exports;
const ID='22222222-2222-4222-8222-222222222222',REF='11111111-1111-4111-8111-111111111111';
const entree={nom:'Agent fictif',email:'agent@example.invalid',password:'Fictif-test-123!',role:'Zonal Head',cluster:null};
function banc(mods={},vars={}){
 const appels=[],logs=[];let profil=null,auth=null;
 const s={
  identite:async()=>({data:{id:'acteur-fictif'}}),
  appelant:async()=>({data:{role:'Branch Manager',actif:true}}),
  roles:async()=>({data:[{valeur:'Zonal Head',attribuable:true,cluster_requis:false},{valeur:'Unit Head',attribuable:true,cluster_requis:true},{valeur:'General Manager',attribuable:false,cluster_requis:false}]}),
  cluster:async code=>({data:code==='CL-TEST'?{code,active:true}:null}),
  creerAuth:async()=>{auth={id:ID};return{data:auth};},
  insererProfil:async p=>{profil={...p};return{data:profil};},
  verifierProfil:async()=>({data:profil}),
  supprimerAuth:async()=>{auth=null;return{data:{}};},
  verifierAuth:async()=>auth?{data:auth}:{data:null,error:{status:404,code:'user_not_found'}}
 };
 Object.assign(s,mods);
 for(const k of Object.keys(s)){const fn=s[k];s[k]=async(...args)=>{appels.push({nom:k,args});return fn(...args);};}
 const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'public-fictif',SUPABASE_SERVICE_ROLE_KEY:'secret-fictif',...vars};
 const handler=creerGestionnaire({env:k=>env[k],services:(config,token)=>{appels.push({nom:'services',args:[config,token]});return s;},reference:()=>REF,journal:x=>logs.push(x)});
 const run=async(body=entree,opts={})=>{
  const req=new Request('https://fixture.invalid/admin-create-user',{method:opts.method||'POST',
   headers:{Origin:'https://nwodobe.github.io','Content-Type':'application/json',Authorization:'Bearer token-fictif',...opts.headers},
   ...(!['OPTIONS','GET'].includes(opts.method)?{body:opts.raw!==undefined?opts.raw:JSON.stringify(body)}:{})});
  const r=await handler(req);return{r,j:r.status===204?null:await r.json()};
 };
 return{run,appels,logs};
}
function aucuneEcriture(b){assert.equal(b.appels.some(x=>['creerAuth','insererProfil','supprimerAuth'].includes(x.nom)),false);}
test('succes: Auth puis profil, role global sans cluster',async()=>{const b=banc(),{r,j}=await b.run();assert.equal(r.status,201);assert.equal(j.profile_verified,true);assert.equal(j.user_id,ID);assert.equal(j.cluster,null);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('access-control-allow-origin'),'https://nwodobe.github.io');assert.deepEqual(b.appels.filter(x=>['creerAuth','insererProfil'].includes(x.nom)).map(x=>x.nom),['creerAuth','insererProfil']);});
for(const [nom,mods,body,status,code] of [
 ['session invalide',{identite:async()=>({data:null,error:{status:401}})},entree,401,'SESSION_INVALIDE'],
 ['profil absent',{appelant:async()=>({data:null})},entree,403,'ACCES_REFUSE'],
 ['BM inactif',{appelant:async()=>({data:{role:'Branch Manager',actif:false}})},entree,403,'ACCES_REFUSE'],
 ['non BM',{appelant:async()=>({data:{role:'Unit Head',actif:true}})},entree,403,'ACCES_REFUSE'],
 ['erreur lecture profil',{appelant:async()=>({data:null,error:{code:'42501'}})},entree,503,'SERVICE_INDISPONIBLE'],
 ['role non attribuable',{}, {...entree,role:'General Manager'},403,'ROLE_NON_ATTRIBUABLE'],
 ['role invente',{}, {...entree,role:'Superadmin'},403,'ROLE_NON_ATTRIBUABLE'],
 ['cluster manquant',{}, {...entree,role:'Unit Head'},400,'CLUSTER_REQUIS'],
 ['cluster inconnu',{}, {...entree,role:'Unit Head',cluster:'FAUX'},400,'CLUSTER_INVALIDE'],
 ['cluster inactif',{cluster:async()=>({data:{code:'CL-TEST',active:false}})}, {...entree,role:'Unit Head',cluster:'CL-TEST'},400,'CLUSTER_INVALIDE'],
 ['referentiel absent',{roles:async()=>({data:null,error:{code:'PGRST202'}})},entree,503,'REFERENTIEL_INDISPONIBLE'],
 ['email invalide',{}, {...entree,email:'pas-un-email'},400,'DONNEES_INVALIDES'],
 ['mot de passe court',{}, {...entree,password:'123'},400,'DONNEES_INVALIDES'],
 ['nom invalide',{}, {...entree,nom:{}},400,'DONNEES_INVALIDES'],
 ['mot de passe objet',{}, {...entree,password:{}},400,'DONNEES_INVALIDES'],
 ['cluster objet',{}, {...entree,cluster:{}},400,'DONNEES_INVALIDES'],
 ['payload null',{},null,400,'DONNEES_INVALIDES']
])test(nom,async()=>{const b=banc(mods),{r,j}=await b.run(body);assert.equal(r.status,status);assert.equal(j.code,code);aucuneEcriture(b);});
for(const valeur of ['', 'Bearer null','Bearer undefined','Basic abc'])test('jeton absent: '+valeur,async()=>{const b=banc(),{r}=await b.run(entree,{headers:{Authorization:valeur}});assert.equal(r.status,401);aucuneEcriture(b);});
test('OPTIONS sans auth, pas de client initialise',async()=>{const b=banc(),{r}=await b.run(null,{method:'OPTIONS',headers:{Authorization:''}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-methods'),'POST, OPTIONS');assert.equal(b.appels.length,0);});
test('origine interdite',async()=>{const b=banc(),{r}=await b.run(entree,{headers:{Origin:'https://attaquant.invalid'}});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);aucuneEcriture(b);});
test('origine staging autorisee explicitement',async()=>{const b=banc({}, {ADMIN_ALLOWED_ORIGINS:'https://nwodobe.github.io,http://127.0.0.1:8123'}),{r}=await b.run(entree,{headers:{Origin:'http://127.0.0.1:8123'}});assert.equal(r.status,201);});
test('GET refuse',async()=>{const b=banc(),{r}=await b.run(null,{method:'GET'});assert.equal(r.status,405);aucuneEcriture(b);});
test('secret absent',async()=>{const b=banc({}, {SUPABASE_SERVICE_ROLE_KEY:undefined}),{r,j}=await b.run();assert.equal(r.status,503);assert.equal(j.code,'CONFIGURATION_INCOMPLETE');aucuneEcriture(b);});
test('secret legacy compatible',async()=>{const b=banc({}, {SUPABASE_SERVICE_ROLE_KEY:undefined,SERVICE_ROLE_KEY:'autre-fictif'}),{r}=await b.run();assert.equal(r.status,201);});
test('dictionnaires modernes compatibles',async()=>{const b=banc({}, {SUPABASE_SERVICE_ROLE_KEY:undefined,SUPABASE_ANON_KEY:undefined,SUPABASE_SECRET_KEYS:'{"default":"fictif"}',SUPABASE_PUBLISHABLE_KEYS:'{"default":"fictif-public"}'}),{r}=await b.run();assert.equal(r.status,201);});
test('JSON mal forme',async()=>{const b=banc(),{r}=await b.run(entree,{raw:'{'});assert.equal(r.status,400);aucuneEcriture(b);});
test('type contenu refuse',async()=>{const b=banc(),{r}=await b.run(entree,{headers:{'Content-Type':'text/plain'}});assert.equal(r.status,400);aucuneEcriture(b);});
test('corps trop volumineux',async()=>{const b=banc(),{r}=await b.run(entree,{raw:'x'.repeat(17000)});assert.equal(r.status,413);aucuneEcriture(b);});
test('unit head et cluster valide',async()=>{const b=banc(),{r}=await b.run({...entree,role:'Unit Head',cluster:'CL-TEST'});assert.equal(r.status,201);});
test('champs privilegies ignores',async()=>{const b=banc();await b.run({...entree,user_id:'pirate',authority_level:'GLOBAL',actif:false,permissions:['*']});const p=b.appels.find(x=>x.nom==='insererProfil').args[0];assert.equal(p.user_id,ID);assert.equal(p.actif,true);assert.equal('authority_level' in p,false);assert.equal('permissions' in p,false);});
for(const code of ['email_exists','user_already_exists'])test('email existant '+code,async()=>{const b=banc({creerAuth:async()=>({data:null,error:{code,status:422}})}),{r,j}=await b.run();assert.equal(r.status,409);assert.equal(j.code,'EMAIL_EXISTANT');assert.equal(b.appels.some(x=>['supprimerAuth','insererProfil'].includes(x.nom)),false);});
test('mot de passe refuse par Auth',async()=>{const b=banc({creerAuth:async()=>({data:null,error:{code:'weak_password',status:422}})}),{r,j}=await b.run();assert.equal(r.status,400);assert.equal(j.code,'MOT_DE_PASSE_REFUSE');});
test('timeout Auth: compte inconnu jamais supprime',async()=>{const b=banc({creerAuth:async()=>{throw Error('SECRET A NE PAS RENVOYER');}}),{r,j}=await b.run();assert.equal(r.status,503);assert.equal(j.code,'CREATION_INCERTAINE');assert.equal(b.appels.some(x=>x.nom==='supprimerAuth'),false);assert.equal(JSON.stringify(j).includes('SECRET'),false);});
test('profil refuse: compensation ciblee verifiee',async()=>{const b=banc({insererProfil:async()=>({data:null,error:{code:'42501'}})}),{r,j}=await b.run();assert.equal(r.status,422);assert.equal(j.code,'PROFIL_REFUSE_COMPENSE');assert.deepEqual(b.appels.find(x=>x.nom==='supprimerAuth').args,[ID]);assert.equal(b.appels.some(x=>x.nom==='verifierAuth'),true);});
test('INSERT timeout mais commis: succes apres verification',async()=>{const p={...entree,user_id:ID,actif:true};delete p.password;const b=banc({insererProfil:async()=>{throw Error('timeout');},verifierProfil:async()=>({data:p})}),{r}=await b.run();assert.equal(r.status,201);assert.equal(b.appels.some(x=>x.nom==='supprimerAuth'),false);});
test('profil divergent: pas de suppression',async()=>{const b=banc({insererProfil:async()=>({data:null,error:{code:'23505'}}),verifierProfil:async()=>({data:{...entree,user_id:ID,actif:true,role:'Viewer / Auditor'}})}),{j}=await b.run();assert.equal(j.code,'COHERENCE_A_VERIFIER');assert.equal(b.appels.some(x=>x.nom==='supprimerAuth'),false);});
test('lecture profil indisponible: pas de suppression',async()=>{const b=banc({insererProfil:async()=>({data:null,error:{code:'NETWORK'}}),verifierProfil:async()=>({data:null,error:{status:503}})}),{j}=await b.run();assert.equal(j.code,'COHERENCE_A_VERIFIER');assert.equal(b.appels.some(x=>x.nom==='supprimerAuth'),false);});
test('compensation echouee signalee',async()=>{const b=banc({insererProfil:async()=>({data:null,error:{code:'42501'}}),supprimerAuth:async()=>({data:null,error:{status:500}})}),{r,j}=await b.run();assert.equal(r.status,500);assert.equal(j.code,'COHERENCE_A_VERIFIER');assert.equal(b.logs[0].compte,ID);});
test('erreur suppression mais absence confirmee',async()=>{const b=banc({insererProfil:async()=>({data:null,error:{code:'42501'}}),supprimerAuth:async()=>({data:null,error:{status:503}}),verifierAuth:async()=>({data:null,error:{status:404}})}),{j}=await b.run();assert.equal(j.code,'PROFIL_REFUSE_COMPENSE');});
test('aucun secret dans reponse ou journal',async()=>{const b=banc({insererProfil:async()=>({data:null,error:{code:'42501',message:entree.password+' token-fictif secret-fictif'}})}),{j}=await b.run();const t=JSON.stringify({j,logs:b.logs});for(const secret of [entree.password,'token-fictif','secret-fictif'])assert.equal(t.includes(secret),false);});
test('email normalise',async()=>{const b=banc(),{r,j}=await b.run({...entree,email:' Agent@Example.Invalid '});assert.equal(r.status,201);assert.equal(j.email,entree.email);});
test('meme email: unicite Auth SIMULEE, un seul profil',async()=>{let existe=false;const b=banc({creerAuth:async()=>{if(existe)return{data:null,error:{code:'email_exists',status:422}};existe=true;return{data:{id:ID}};}});const a=await b.run(),c=await b.run();assert.equal(a.r.status,201);assert.equal(c.r.status,409);assert.equal(b.appels.filter(x=>x.nom==='insererProfil').length,1);});

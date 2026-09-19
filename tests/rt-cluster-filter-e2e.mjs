/* Real Chromium, synthetic records with production cluster codes/counts.
   No real login, no Supabase connection, no production data writes. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const output = resolve(process.env.RT_TEST_OUTPUT || 'rt-cluster-test-results');
mkdirSync(output, {recursive:true});
const before = process.argv.includes('--expect-bug');
const browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const results=[];
function check(value, message){assert.ok(value,message);results.push(message);}
function fixture({role,allowed}) {
  const clusters=[
    {code:'BEOUMI',label:'B\u00e9oumi',aliases:['BEOUMI'],zone_code:'GBEKE_2',v:10,r:24},
    {code:'BOTRO',label:'Botro',aliases:['BOTRO'],zone_code:'GBEKE_2',v:9,r:16},
    {code:'BROBO',label:'Brobo',aliases:['BROBO'],zone_code:'GBEKE_1',v:9,r:17},
    {code:'DIABO',label:'Diabo',aliases:['DIABO'],zone_code:'GBEKE_2',v:12,r:26},
    {code:'DJEBONOUA',label:'Dj\u00e9bonoua',aliases:['DJEBONOUA',"N'DJEBONOUA",'DJEBONOU','DJEBONOA'],zone_code:'GBEKE_1',v:10,r:18},
    {code:'SAKASSOU',label:'Sakassou',aliases:['SAKASSOU'],zone_code:'GBEKE_1',v:10,r:15}
  ].map(c=>({...c,active:true}));
  const villages=[],rts=[],farmers=[];
  clusters.filter(c=>!allowed||allowed.includes(c.code)).forEach(c=>{
    const stored=c.code==='DJEBONOUA'?"N'DJEBONOUA":c.code;
    for(let i=1;i<=c.v;i++) villages.push({id:c.code+'-v-'+i,village:'VILLAGE TEST '+c.code+' '+String(i).padStart(2,'0'),cluster:stored,cluster_code:c.code,region:'Gbeke',statut:'Confirme',score:70,deleted:false,data:{s3:{potentielMT:50}}});
    for(let i=1;i<=c.r;i++) {
      const village=villages.find(v=>v.id===c.code+'-v-'+((i-1)%c.v+1));
      rts.push({id:c.code+'-r-'+i,id_rt:'RT-TEST-'+c.code+'-'+i,nom:'RT TEST '+c.code+' '+String(i).padStart(2,'0'),cluster:stored,village_id:village.id,village_nom:village.village,telephone:'0700000000',statut:'Confirme',deleted:false,data:{activite:'Pisteur'}});
      farmers.push({producteur_id:c.code+'-p-'+i,farmer_id:'F-TEST-'+c.code+'-'+i,nom:'PRODUCTEUR TEST '+c.code+' '+i,cluster_code:c.code,cluster_label:c.label,village_id:village.id,village_nom:village.village,rt_id:c.code+'-r-'+i,deleted:false,possible_duplicate:false});
    }
  });
  const me={user_id:'test-fixture',nom:'TEST SIMULE',role,actif:true};
  const tables={villages_light_v:villages,rt_light_v:rts,farmer_passport_summary_v:farmers,achats:[],aflp_clusters:clusters,aflp_zones:[{code:'GBEKE_1',label:'GBEKE 1',active:true},{code:'GBEKE_2',label:'GBEKE 2',active:true}],profils:[me]};
  window.__rtTest={clusters,tables,reads:[],writes:[],fail:false};
  function query(table){
    let data=tables[table]||[],cols='*',single=false,limit=null;
    const q={select(v){cols=v||'*';return q;},eq(k,v){data=data.filter(x=>x[k]===v);return q;},order(){return q;},limit(n){limit=n;return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},in(k,vs){data=data.filter(x=>vs.includes(x[k]));return q;},then(ok,bad){
      window.__rtTest.reads.push(table);
      if(window.__rtTest.fail&&table==='villages_light_v')return Promise.resolve({data:null,error:{message:'SIMULATED_NETWORK_FAILURE'}}).then(ok,bad);
      let rows=limit?data.slice(0,limit):data.slice();
      if(cols!=='*'&&/^[a-z_,]+$/i.test(cols))rows=rows.map(x=>Object.fromEntries(cols.split(',').map(k=>[k,x[k]])));
      return Promise.resolve({data:single?(rows[0]||null):rows,error:null}).then(ok,bad);
    }};
    for(const verb of ['insert','update','upsert','delete'])q[verb]=()=>{window.__rtTest.writes.push(verb+':'+table);throw new Error('Writes forbidden');};
    return q;
  }
  window.supabase={createClient:()=>({from:query,auth:{getSession:()=>Promise.resolve({data:{session:{user:{id:me.user_id},access_token:'fixture-not-a-real-token'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:()=>Promise.resolve({data:[],error:null})})};
  window.ANAGROCI_SUPABASE_URL='https://fixture.invalid';
  window.ANAGROCI_SUPABASE_ANON='fixture';
  window.requestIdleCallback=()=>0;
}
async function openFixture(page,role,allowed) {
  // Render the actual shipped DOM/CSS/JS entirely offline. Auth and SDK are
  // explicit test doubles; this is not an authenticated production session.
  await page.route('**/*',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* isolated */'}));
  const html=readFileSync('operations/field-buying.html','utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await page.setContent(html);
  for(const file of ['operations/operations.css','operations/operations-v2.css'])
    await page.addStyleTag({content:readFileSync(file,'utf8')});
  await page.evaluate(fixture,{role,allowed});
  await page.evaluate(()=>{location.hash='#rt/villages';});
  for(const file of ['operations/workspace.js','operations/navigation-v2.js','operations/field-buying.js','operations/rt-farmer-rights.js','operations/sacherie-operational-p1.js'])
    await page.addScriptTag({content:readFileSync(file,'utf8')});
  await ready(page);
}
async function ready(page){await page.waitForSelector('#rtCluster');await page.waitForFunction(()=>!!document.querySelector('#rtBody')&&!document.querySelector('#opsRouteView .skeleton'));}
async function rows(page){return page.locator('#rtBody tbody tr').count();}
async function tab(page,name){
  await page.evaluate(async t=>{location.hash='#rt/'+t;await window.ANAGROCI_FB.render();},name);
  await ready(page);
}
try {
  for(const width of (before?[1440]:[1440,390]))for(const role of (before?['Zonal Head']:['Zonal Head','Branch Manager'])){
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await openFixture(page,role,null);
    check(await rows(page)===60,width+' '+role+' all villages=60');
    if(before){
      await page.selectOption('#rtCluster',{label:'B\u00e9oumi'});
      check(await rows(page)===0,'BUG REPRODUCED: selecting Beoumi incorrectly hides 10 villages');
      await page.screenshot({path:resolve(output,'before-beoumi.png'),fullPage:true});
      await context.close();continue;
    }
    const cs=await page.evaluate(()=>window.__rtTest.clusters);
    for(const c of cs){
      await page.selectOption('#rtCluster',{label:c.label});
      check(await page.inputValue('#rtCluster')===c.code,width+' '+role+' canonical option '+c.code);
      check(await rows(page)===c.v,width+' '+role+' villages '+c.code+'='+c.v);
      await tab(page,'rts');check(await page.inputValue('#rtCluster')===c.code,'selection persists to RT '+c.code);check(await rows(page)===c.r,'RT count '+c.code+'='+c.r);
      await tab(page,'assign');check(await rows(page)===c.r,'assign count '+c.code+'='+c.r);
      await tab(page,'anomalies');check(await rows(page)===c.r,'anomalies restricted to '+c.code);
      await tab(page,'villages');
    }
    await page.selectOption('#rtCluster','BEOUMI');
    await page.fill('#rtQ','VILLAGE TEST BEOUMI 01');check(await rows(page)===1,'village text search combines with cluster');
    await page.fill('#rtQ','IMPOSSIBLE_MATCH');check(await rows(page)===0,'empty search yields 0');
    await page.fill('#rtQ','');check(await rows(page)===10,'clearing text restores Beoumi=10');
    await page.screenshot({path:resolve(output,'after-beoumi-'+width+'-'+role.replace(/ /g,'-')+'.png'),fullPage:true});
    for(const name of ['rts','assign','anomalies']){
      await tab(page,name);await page.fill('#rtQ','RT TEST BEOUMI 01');check(await rows(page)===1,name+' search combines with cluster');await page.fill('#rtQ','');
    }
    await tab(page,'villages');await page.selectOption('#rtCluster','');check(await rows(page)===60,'Tous restores 60 villages');
    await tab(page,'rts');check(await rows(page)===116,'Tous restores 116 RT');
    const reads=await page.evaluate(()=>window.__rtTest.reads.filter(x=>x==='villages_light_v').length);check(reads===1,'filtering reuses base cache, no extra data reads');
    check(await page.evaluate(()=>window.__rtTest.writes.length)===0,'No writes');
    check(errors.length===0,'No uncaught JS errors: '+errors.join('; '));
    await page.evaluate(()=>{window.__rtTest.fail=true;window.ANAGROCI_FB.reload();});
    await page.waitForSelector('#opsRouteView .notice.danger');
    check((await page.locator('#opsRouteView').innerText()).includes('SIMULATED_NETWORK_FAILURE'),'API error is shown, not swallowed as empty table');
    await context.close();
  }
  if(!before){
    const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();
    await openFixture(page,'Zonal Head',['BEOUMI']);
    check(await rows(page)===10,'Server-scoped fixture exposes only 10 authorised villages');
    await page.selectOption('#rtCluster','DIABO');check(await rows(page)===0,'Filter cannot invent inaccessible rows');
    await page.selectOption('#rtCluster','BEOUMI');check(await rows(page)===10,'Allowed scope still works');
    await context.close();
  }
  writeFileSync(resolve(output,'results.json'),JSON.stringify({mode:before?'bug-reproduction':'regression',passed:results.length,checks:results,realSupabaseLogin:false},null,2));
  console.log(JSON.stringify({mode:before?'bug-reproduction':'regression',passed:results.length,output}));
} finally {await browser.close();}

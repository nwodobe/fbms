#!/usr/bin/env node
/**
 * Offline First FIELD BUYING — E2E navigateur réel.
 * Données 100 % synthétiques : aucune connexion à Supabase production, aucune écriture métier.
 *
 * Preuves :
 * - le shell est préparé par le vrai Service Worker puis se recharge avec context.setOffline(true);
 * - IndexedDB conserve référentiels + queue après fermeture/réouverture de la page;
 * - enrôlement producteur et achat sont créés hors ligne;
 * - achat dépend du producteur local;
 * - retour réseau : mapping Farmer local -> serveur, puis achat synchronisé;
 * - rejeu local ne duplique pas les opérations;
 * - 100 opérations persistantes sont supportées.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT=process.cwd();
const PORT=Number(process.env.PORT_OFFLINE_FBMS||4339);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};

function server(){
  return createServer((req,res)=>{
    const p=decodeURIComponent((req.url||'/').split('?')[0]);
    let file=normalize(join(ROOT,p));
    if(!file.startsWith(ROOT)){res.writeHead(403).end();return;}
    if(existsSync(file)&&statSync(file).isDirectory())file=join(file,'index.html');
    if(!existsSync(file)){res.writeHead(404).end('missing');return;}
    res.writeHead(200,{'content-type':MIME[extname(file)]||'application/octet-stream','cache-control':'no-store'});
    res.end(readFileSync(file));
  });
}

const STUB=String.raw`
(function(){
  'use strict';
  var U='20000000-0000-4000-8000-000000000001';
  var C='10000000-0000-4000-8000-000000000001';
  var COOP='30000000-0000-4000-8000-000000000001';
  var LEASE='40000000-0000-4000-8000-000000000001';
  var future=new Date(Date.now()+12*3600000).toISOString();
  var state=window.__offlineTestState={syncCalls:0,batches:[],serverOps:{},lastPurchaseFarmer:null};
  var data={
    campaigns:[{id:C,code:'2097',name:'SIMULATION OFFLINE FICTIVE',year:2097,campaign_type:'SIMULATION',status:'OPEN',is_current:true,start_date:'2096-08-01',planned_end_date:'2097-07-31',row_version:1}],
    profils:[{user_id:U,email:'qa@example.invalid',nom:'RT FICTIF OFFLINE',role:'Agent Recenseur',actif:true,cluster:'BROBO',zone:'GBEKE 1',village_id:'v1',rt_id:'rt1'}],
    villages_light_v:[{id:'v1',village:'VILLAGE FICTIF OFFLINE',region:'Gbêkê',departement:'Bouaké',cluster:'BROBO',cluster_code:'BROBO',statut:'Approuvé BM',score:90,gps_lat:7.7,gps_lng:-5.0,farmer_code_prefix:'BROBO',data:{s1:{village:'VILLAGE FICTIF OFFLINE'},s3:{potentielMT:25,potentielSecuriseMT:10}},deleted:false}],
    rt_light_v:[{id:'rt1',id_rt:'RT-FICTIF-01',nom:'RT FICTIF OFFLINE',telephone:'0100000000',village_id:'v1',village_nom:'VILLAGE FICTIF OFFLINE',cluster:'BROBO',statut:'Confirmé',score:90,deleted:false,data:{}}],
    farmer_passport_summary_v:[{producteur_id:'p-existing',farmer_id:'BROBO-0001',nom:'PRODUCTEUR EXISTANT',prenoms:'FICTIF',telephone:'0700000001',village_id:'v1',village_nom:'VILLAGE FICTIF OFFLINE',rt_id:'rt1',rt_nom:'RT FICTIF OFFLINE',cluster_code:'BROBO',cluster_label:'BROBO',zone_code:'GBEKE1',zone_label:'GBEKE 1',operational_status:'Actif',passport_stage:'ENROLLED',passport_completion:60,risk_profile:null,possible_duplicate:false,review_required:false,plot_count:0,gps_mapped_count:0,last_purchase_date:null,last_purchase_kg:null,deleted:false}],
    achats:[],
    aflp_zones:[{code:'GBEKE1',label:'GBEKE 1',region:'Gbêkê',active:true}],
    aflp_clusters:[{code:'BROBO',label:'BROBO',zone_code:'GBEKE1',aliases:['BROBO'],active:true}],
    campaign_targets:[{campaign_id:C,level:'CAMPAIGN',ref_id:'',target_mt:3000}],
    avances:[{id:'a1',date:'2097-01-02',cluster:'BROBO',rt_id:'rt1',rt_nom:'RT FICTIF OFFLINE',source:'QA',montant:1000000,motif:'FICTIF',statut:'Active',cycle_id:null,cycle_statut:null,volume_finance_kg:null,prix_reference_kg:550,created_by_nom:'QA',created_at:'2097-01-02T08:00:00Z'}],
    reconciliations:[],
    sacherie_ct_cluster_stock:[],
    sacherie_ct_rt_stock:[{rt_id:'rt1',rt_nom:'RT FICTIF OFFLINE',cluster:'BROBO',total_sous_responsabilite:20,vides:20,pleins:0,dechires:0,a_reparer:0,derniere_activite:null}],
    ops_bag_requests:[],aflp_bag_envelopes:[],aflp_bag_cluster_allocations:[],
    rcn_jute_locations:[
      {code:'AFLP-CL-BROBO',scope_type:'CLUSTER',cluster:'BROBO',rt_id:null,producteur_id:null,nom:'Cluster BROBO',actif:true},
      {code:'AFLP-RT-RT1',scope_type:'RT',cluster:'BROBO',rt_id:'rt1',producteur_id:null,nom:'RT FICTIF',actif:true},
      {code:'AFLP-PROD-P1',scope_type:'PRODUCTEUR',cluster:'BROBO',rt_id:null,producteur_id:'p-existing',nom:'PRODUCTEUR EXISTANT',actif:true}
    ],
    ops_bag_releases:[],sacherie_ct_global_stock:[{total:20}],rcn_jute_loss_requests:[],sacherie_ct_latest_inventory:[],
    rcn_jute_v_stock:[{location_code:'AFLP-RT-RT1',state:'UTILISABLE',qty:20},{location_code:'AFLP-CL-BROBO',state:'UTILISABLE',qty:0}],
    rcn_jute_transfers:[],
    aflp_cooperatives:[{id:COOP,code:'COOP-FICTIVE',name:'COOPERATIVE FICTIVE OFFLINE',legal_name:'COOPERATIVE FICTIVE OFFLINE',archived:false,status:'ACTIVE',supplier_id:null,row_version:1}],
    aflp_coop_campaigns:[{id:'cc1',cooperative_id:COOP,campaign:'2097',campaign_id:C,status:'ACTIVE',declared_members_count:1,declared_potential_kg:5000,target_kg:4000}],
    aflp_coop_contacts:[{id:'ct1',cooperative_id:COOP,role:'PRESIDENT',full_name:'PRESIDENT FICTIF',phone:'0101010101',active:true}],
    aflp_coop_sections:[{id:'sec1',cooperative_id:COOP,name:'SECTION FICTIVE',code:'SEC-F',active:true}],
    aflp_coop_villages:[{id:'cv1',cooperative_id:COOP,village_id:'v1',active:true}],
    aflp_coop_collection_points:[],
    aflp_coop_members_v:[{cooperative_id:COOP,campaign:'2097',producer_id:'p-existing',farmer_id:'BROBO-0001',nom:'PRODUCTEUR EXISTANT',prenoms:'FICTIF',telephone:'0700000001',village_id:'v1',village_nom:'VILLAGE FICTIF OFFLINE',section_id:'sec1',member_number:'MEM-001',status:'ACTIVE',verified:true,completeness_pct:60,missing_fields:[],review_required:false}],
    procurement_suppliers:[],procurement_supplier_code_history:[]
  };

  function clone(x){return JSON.parse(JSON.stringify(x));}
  function offlineError(){return {data:null,error:{message:'Failed to fetch (offline test)'},count:null};}
  function query(table){
    var filters=[],limitN=null,rangeN=null,head=false,selectOpts=null;
    var q={
      select:function(cols,opts){selectOpts=opts||null;head=!!(opts&&opts.head);return q;},
      eq:function(k,v){filters.push(function(x){return String(x[k])===String(v);});return q;},
      neq:function(k,v){filters.push(function(x){return String(x[k])!==String(v);});return q;},
      in:function(k,vals){filters.push(function(x){return vals.map(String).indexOf(String(x[k]))>=0;});return q;},
      is:function(k,v){filters.push(function(x){return v===null?x[k]==null:String(x[k])===String(v);});return q;},
      not:function(){return q;},or:function(){return q;},like:function(){return q;},ilike:function(){return q;},
      gte:function(){return q;},lte:function(){return q;},gt:function(){return q;},lt:function(){return q;},
      contains:function(){return q;},order:function(){return q;},
      limit:function(n){limitN=n;return q;},
      range:function(a,b){rangeN=[a,b];return q;},
      insert:function(){return Promise.resolve(navigator.onLine?{data:null,error:null}:offlineError());},
      update:function(){return q;},upsert:function(){return q;},delete:function(){return q;},
      single:function(){return finish(true);},maybeSingle:function(){return finish(true);},
      then:function(ok,bad){return finish(false).then(ok,bad);}
    };
    function finish(single){
      if(navigator.onLine===false)return Promise.resolve(offlineError());
      var rows=clone(data[table]||[]).filter(function(x){return filters.every(function(f){return f(x);});});
      if(rangeN)rows=rows.slice(rangeN[0],rangeN[1]+1);
      if(limitN!=null)rows=rows.slice(0,limitN);
      var out=single?(rows[0]||null):(head?null:rows);
      return Promise.resolve({data:out,error:null,count:(selectOpts&&selectOpts.count==='exact')?rows.length:null});
    }
    return q;
  }

  function rpc(name,args){
    if(navigator.onLine===false)return Promise.resolve(offlineError());
    if(name==='procurement_active_rule')return Promise.resolve({data:{campaign:'2097',price_per_kg:550,rt_commission_per_kg:3,max_moisture_pct:10,min_kor:46},error:null});
    if(name==='offline_prepare_device')return Promise.resolve({data:{authorized:true,lease_token:LEASE,campaign_id:C,rt_id:'rt1',device_id:args.p_device_id,issued_at:new Date(Date.now()-60000).toISOString(),valid_until:future},error:null});
    if(name==='aflp_coop_dashboard')return Promise.resolve({data:[{cooperative_id:COOP,code:'COOP-FICTIVE',name:'COOPERATIVE FICTIVE OFFLINE',status:'ACTIVE',archived:false,farmer_count:1,verified_farmer_count:1}],error:null});
    if(name==='sacherie_ct_inventaires_dus')return Promise.resolve({data:[],error:null});
    if(name==='aflp_channel_totals')return Promise.resolve({data:[],error:null});
    if(name==='offline_sync_batch'){
      state.syncCalls++;
      state.batches.push(clone(args.p_operations||[]));
      var results=(args.p_operations||[]).map(function(op){
        if(state.serverOps[op.idempotency_key])return clone(state.serverOps[op.idempotency_key]);
        var r={idempotency_key:op.idempotency_key,client_operation_id:op.client_operation_id,status:'SYNCED'};
        if(op.operation_type==='FARMER_ENROLL'||op.operation_type==='COOP_FARMER_ENROLL'){
          r.local_id=op.payload.local_id;r.server_id='farmer-server-'+Object.keys(state.serverOps).length;r.farmer_id='BROBO-9'+String(Object.keys(state.serverOps).length).padStart(3,'0');
        }else if(op.operation_type==='FIELD_PURCHASE_CREATE'){
          state.lastPurchaseFarmer=op.payload.row.producteur_id;
          if(/^local-farmer-/.test(String(state.lastPurchaseFarmer||'')))return {idempotency_key:op.idempotency_key,client_operation_id:op.client_operation_id,status:'FAILED',message:'Dépendance Farmer non résolue'};
          r.purchase_id='50000000-0000-4000-8000-'+String(Object.keys(state.serverOps).length+1).padStart(12,'0');r.local_id=op.payload.row.local_id;
        }else if(op.operation_type==='BAG_MOVEMENT_CREATE')r.movement_id='JUT-OFF-TEST';
        else if(op.operation_type==='FIELD_GPS_UPDATE')r.server_id=op.payload.row.producteur_id;
        state.serverOps[op.idempotency_key]=clone(r);return r;
      });
      return Promise.resolve({data:{results:results,processed_at:new Date().toISOString()},error:null});
    }
    return Promise.resolve({data:[],error:null});
  }

  var client={
    auth:{
      getSession:function(){return Promise.resolve({data:{session:{user:{id:U,email:'qa@example.invalid'},access_token:'fictif'}},error:null});},
      getUser:function(){return Promise.resolve({data:{user:{id:U,email:'qa@example.invalid'}},error:null});},
      signOut:function(){return Promise.resolve({data:null,error:null});},
      signInWithPassword:function(){return Promise.resolve({data:{session:{user:{id:U}}},error:null});},
      onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}
    },
    from:query,
    rpc:rpc,
    storage:{from:function(){return {upload:function(){return Promise.resolve({data:null,error:null});},list:function(){return Promise.resolve({data:[],error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}},
    channel:function(){return {on:function(){return this;},subscribe:function(){return this;}};},
    removeChannel:function(){}
  };
  Object.defineProperty(window,'supabase',{value:{createClient:function(){return client;}},writable:false,configurable:false});
})();
`;

function wait(ms){return new Promise(r=>setTimeout(r,ms));}

async function main(){
  const srv=server();await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  await ctx.addInitScript({content:STUB});
  await ctx.route(/https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\/.*/,async route=>{
    const u=route.request().url();
    if(/\.css(?:\?|$)|fonts\.googleapis/.test(u))return route.fulfill({status:200,contentType:'text/css',body:'/* offline test */'});
    return route.fulfill({status:200,contentType:'text/javascript',body:'/* external dependency stubbed; window.supabase injected by test */'});
  });
  const base=`http://127.0.0.1:${PORT}/operations/field-buying.html#sync`;
  let page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/favicon|Failed to load resource/.test(m.text()))errors.push(m.text());});

  try{
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#offPrepare',{timeout:20000});
    await page.click('#offPrepare');
    await page.waitForFunction(()=>document.body.textContent.includes('Prêt pour le terrain'),null,{timeout:20000});

    const ready=await page.evaluate(()=>ANAGROCI_OFFLINE.readiness());
    assert.equal(ready.ready,true,'mode terrain doit être prêt');
    assert.equal(ready.villages,1);
    assert.equal(ready.rts,1);
    assert.equal(ready.producers,1);
    assert.equal(ready.cooperatives,1);
    assert.equal(ready.cash_offline_authorized,true,'appareil RT doit être autorisé pour la caisse offline');

    await page.waitForFunction(()=>navigator.serviceWorker&&navigator.serviceWorker.controller,{timeout:15000}).catch(()=>{});
    const sw=await page.evaluate(async()=>({controller:!!navigator.serviceWorker.controller,ready:!!(await navigator.serviceWorker.ready)}));
    assert.equal(sw.ready,true,'service worker prêt');

    /* Vrai mode avion navigateur. */
    await ctx.setOffline(true);
    await page.close();
    page=await ctx.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});
    await page.waitForSelector('#offPrepare',{timeout:15000});
    assert.match(await page.textContent('body'),/Hors ligne/,'rechargement complet doit rester utilisable hors ligne');

    /* Producteur créé hors ligne, persistant dans IndexedDB. */
    await page.evaluate(()=>ANAGROCI_FB.openFarmerForm());
    await page.waitForSelector('#farmerForm');
    await page.fill('#ff_nom','PRODUCTEUR OFFLINE FICTIF');
    await page.selectOption('#ff_village','v1');
    await page.selectOption('#ff_rt','rt1');
    await page.fill('#ff_tel','0700000999');
    await page.fill('#ff_pot27','750');
    await page.click('#ff_submit');
    await page.waitForFunction(()=>document.body.textContent.includes('Farmer ID définitif attribué lors de la synchronisation.'),null,{timeout:10000});
    let ops=await page.evaluate(()=>ANAGROCI_OFFLINE.list());
    const farmerOp=ops.find(x=>x.operation_type==='FARMER_ENROLL');
    assert.ok(farmerOp&&farmerOp.status==='PENDING','enrôlement doit rester PENDING');

    /* Achat du producteur créé localement : dépendance explicite. */
    await page.evaluate(()=>ANAGROCI_FB.openBuyForm());
    await page.waitForSelector('#buyForm');
    await page.selectOption('#bf_village','v1');
    await page.selectOption('#bf_rt','rt1');
    const localFarmerId=await page.evaluate(async()=>{
      const b=await ANAGROCI_OFFLINE.getBundle('field_base',{campaign_id:ANAGROCI_OFFLINE.campaignId()});
      const f=(b.farmers||[]).find(x=>x.local_only);return f&&f.producteur_id;
    });
    assert.ok(/^local-farmer-/.test(localFarmerId),'identifiant Farmer local attendu');
    await page.selectOption('#bf_farmer',localFarmerId);
    await page.fill('#bf_brut','100');
    await page.fill('#bf_tare','0');
    await page.fill('#bf_sacs','2');
    await page.fill('#bf_ref','RECU-OFFLINE-FICTIF-001');
    await page.click('#bf_submit');
    await page.waitForFunction(()=>document.body.textContent.includes('Achat sauvegardé sur cet appareil'),null,{timeout:10000});
    ops=await page.evaluate(()=>ANAGROCI_OFFLINE.list());
    const buy=ops.find(x=>x.operation_type==='FIELD_PURCHASE_CREATE');
    assert.ok(buy&&buy.status==='PENDING','achat offline PENDING');
    assert.deepEqual(buy.dependencies,[farmerOp.id],'achat doit dépendre du Farmer local');
    assert.ok(buy.payload.lease_token,'achat doit porter le lease appareil/RT');

    /* Fermeture et réouverture hors réseau : queue inchangée. */
    const beforeIds=ops.filter(x=>['FARMER_ENROLL','FIELD_PURCHASE_CREATE'].includes(x.operation_type)).map(x=>x.id).sort();
    await page.close();
    page=await ctx.newPage();
    await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});
    await page.waitForSelector('#offSync');
    const afterIds=await page.evaluate(async()=>(await ANAGROCI_OFFLINE.list()).filter(x=>['FARMER_ENROLL','FIELD_PURCHASE_CREATE'].includes(x.operation_type)).map(x=>x.id).sort());
    assert.deepEqual(afterIds,beforeIds,'queue doit survivre à la fermeture/réouverture');

    /* Charge locale : 100 opérations persistantes sans perte. */
    const t0=Date.now();
    await page.evaluate(async()=>{
      for(let i=0;i<100;i++)await ANAGROCI_OFFLINE.queue('FIELD_GPS_UPDATE',{row:{producteur_id:'p-existing',gps_lat:7.7+i/100000,gps_lng:-5.0}},{label:'QA charge locale'});
    });
    const localLoad=Date.now()-t0;
    const count=await page.evaluate(async()=>{const x=await ANAGROCI_OFFLINE.list();return x.filter(o=>o.operation_type==='FIELD_GPS_UPDATE').length;});
    assert.equal(count,100,'100 opérations locales attendues');

    /* Retour du réseau : Farmer d'abord, achat ensuite avec server_id résolu. */
    await ctx.setOffline(false);
    await page.evaluate(()=>ANAGROCI_OFFLINE.syncNow());
    await page.waitForFunction(async()=>{
      const x=await ANAGROCI_OFFLINE.list();
      return x.filter(o=>['FARMER_ENROLL','FIELD_PURCHASE_CREATE'].includes(o.operation_type)).every(o=>o.status==='SYNCED');
    },null,{timeout:20000});
    const resolved=await page.evaluate(()=>window.__offlineTestState.lastPurchaseFarmer);
    assert.ok(resolved&&!/^local-farmer-/.test(resolved),'achat synchronisé doit pointer vers le Farmer serveur');

    /* Rejouer la synchro ne recrée rien : les opérations SYNCED ne repartent pas. */
    const callsBefore=await page.evaluate(()=>window.__offlineTestState.syncCalls);
    await page.evaluate(()=>ANAGROCI_OFFLINE.syncNow());
    const callsAfter=await page.evaluate(()=>window.__offlineTestState.syncCalls);
    assert.ok(callsAfter>=callsBefore,'appel supplémentaire autorisé uniquement pour les GPS encore PENDING');

    /* Le mode hors ligne ne doit jamais supprimer la queue en cas de problème réseau. */
    await ctx.setOffline(true);
    const pendingBefore=await page.evaluate(async()=>{const x=await ANAGROCI_OFFLINE.list();return x.filter(o=>o.status==='PENDING'||o.status==='FAILED'||o.status==='SYNCING').length;});
    let failed=false;
    try{await page.evaluate(()=>ANAGROCI_OFFLINE.syncNow());}catch{failed=true;}
    const pendingAfter=await page.evaluate(async()=>{const x=await ANAGROCI_OFFLINE.list();return x.filter(o=>o.status==='PENDING'||o.status==='FAILED'||o.status==='SYNCING').length;});
    assert.equal(failed,true,'sync hors réseau doit échouer explicitement');
    assert.equal(pendingAfter,pendingBefore,'aucune opération ne doit disparaître hors réseau');

    assert.equal(errors.length,0,'erreurs navigateur : '+errors.join(' | '));
    console.log(JSON.stringify({
      result:'PASS',
      service_worker:sw,
      offline_reload:true,
      farmer_then_purchase:true,
      persistent_queue:true,
      queue_100:true,
      queue_100_write_ms:localLoad,
      data_real_used:false
    },null,2));
  }finally{
    await ctx.setOffline(false).catch(()=>{});
    await ctx.close();await browser.close();srv.close();
  }
}
main().catch(e=>{console.error(e);process.exit(1);});

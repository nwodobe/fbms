#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';

const ROOT=process.cwd(),PORT=4337;
const mime={'.js':'text/javascript; charset=utf-8','.png':'image/png','.html':'text/html; charset=utf-8'};
const harness=`<!doctype html><html><head><meta charset="utf-8">
<script src="/node_modules/exceljs/dist/exceljs.min.js"></script>
<script>
window.ANAGROCI_SUPABASE_URL='https://example.test';
window.ANAGROCI_SUPABASE_ANON='public-test-key';
window.ANAGROCI_CAMPAIGN={
 get:()=>({id:'camp-current',code:'2027',campaign_type:'SIMULATION',status:'OPEN'}),
 id:()=> 'camp-current', code:()=> '2027',
 list:()=>[
  {id:'camp-current',code:'2027',campaign_type:'SIMULATION',name:'Simulation'},
  {id:'camp-hist',code:'2028',campaign_type:'REAL',name:'Campagne 2028'}
 ]
};
window.__DATA={profils:[{nom:'QA Branch Manager',role:'Branch Manager',actif:true}],purchases:[]};
function Q(table){
 this.table=table;this.filters=[];this.a=0;this.b=999;
}
Q.prototype.select=function(){return this};
Q.prototype.eq=function(k,v){this.filters.push(r=>String(r[k])===String(v));return this};
Q.prototype.neq=function(k,v){this.filters.push(r=>String(r[k])!==String(v));return this};
Q.prototype.gt=function(k,v){this.filters.push(r=>Number(r[k])>Number(v));return this};
Q.prototype.order=function(){return this};
Q.prototype.range=function(a,b){this.a=a;this.b=b;return Promise.resolve(this._result())};
Q.prototype.maybeSingle=function(){const x=this._rows()[0]||null;return Promise.resolve({data:x,error:null})};
Q.prototype._rows=function(){let r=(this.table==='achats'?window.__DATA.purchases:(window.__DATA[this.table]||[])).slice();for(const f of this.filters)r=r.filter(f);return r};
Q.prototype._result=function(){return {data:this._rows().slice(this.a,this.b+1),error:null}};
Q.prototype.then=function(res,rej){return Promise.resolve(this._result()).then(res,rej)};
const fake={
 auth:{getSession:()=>Promise.resolve({data:{session:{user:{id:'u-1',email:'qa@example.test'}}}})},
 from:(t)=>new Q(t)
};
window.supabase={createClient:()=>fake};
</script>
<script src="/operations/pjs-export.js"></script></head><body data-workspace="none"></body></html>`;

const server=createServer((req,res)=>{
 const u=new URL(req.url,'http://x').pathname;
 if(u==='/operations/__pjs_test.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end(harness);return;}
 let p=join(ROOT,u.replace(/^\//,''));
 if(!existsSync(p)){res.writeHead(404);res.end('missing');return;}
 res.writeHead(200,{'Content-Type':mime[extname(p)]||'application/octet-stream'});res.end(readFileSync(p));
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/operations/__pjs_test.html`,{waitUntil:'load'});
await page.waitForFunction(()=>window.ANAGROCI_PJS_EXPORT&&window.ExcelJS);

function makeRows(n){
 return Array.from({length:n},(_,i)=>({
  id:'a-'+i,campaign_id:'camp-hist',date:'2028-02-'+String(i%27+1).padStart(2,'0'),
  numero_recu:'RCPT-'+String(i+1).padStart(6,'0'),producteur_code:'F-'+String(i+1).padStart(6,'0'),
  producteur_nom:i===0?'=HYPERLINK("https://evil.invalid","x")':'Producteur '+(i+1),
  rt_nom:'RT '+(i%50+1),village_id:'v-'+(i%60+1),village_nom:'Village '+(i%60+1),
  cluster:'CL-'+(i%6+1),sourcing_channel:i%2?'AFLP_DIRECT':'COOPERATIVE',
  poids_net:500+i%300,nb_sacs:7,prix_kg:550,montant:(500+i%300)*550,
  kor:47.5,humidite:8.2,mode_paiement:'WAVE',statut_validation:'VALIDE',stock_statut:'LIBERE'
 }));
}
const results=[];
for(const count of [100,1000,5000,10000]){
 const rows=makeRows(count);
 await page.evaluate(rows=>{window.__DATA.purchases=rows},rows);
 const started=Date.now();
 const b64=await page.evaluate(async()=>{
  const x=await ANAGROCI_PJS_EXPORT.workbook('purchases',{campaign_id:'camp-hist',campaign_code:'2028'});
  const buf=await x.wb.xlsx.writeBuffer();
  let s='',a=new Uint8Array(buf);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));
  return {b64:btoa(s),rows:x.rows.length,meta:x.meta};
 });
 const buf=Buffer.from(b64.b64,'base64');
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(buf);
 const ws=wb.getWorksheet('Achats campagne');
 assert.ok(ws,'business sheet missing');
 assert.equal(b64.rows,count,'source reconciliation failed');
 assert.equal(ws.rowCount-8,count,'xlsx row reconciliation failed');
 assert.equal(ws.getCell('A1').value,'PJS / ANAGROCI OPERATIONS');
 assert.equal(ws.getCell('A8').fill.fgColor.argb,'FF053B23');
 assert.ok(ws.autoFilter,'AutoFilter missing');
 const af=typeof ws.autoFilter==='string'?ws.autoFilter:JSON.stringify(ws.autoFilter);
 assert.match(af,/8/,'AutoFilter must start on business header row 8');
 assert.equal(ws.views[0].state,'frozen');
 assert.equal(wb.getWorksheet('EXPORT_INFO').getCell('B6').value,'2028','selected historical campaign metadata incorrect');
 assert.ok(String(ws.getCell(9,4).value).startsWith("'="),'formula injection not neutralized');
 assert.equal(typeof ws.getCell(9,9).value,'number','weight must remain numeric');
 results.push({count,ms:Date.now()-started,bytes:buf.length});
}
/* Non-régression 2026-10-16 : données agricoles producteurs.
   Avant correctif, `data` n'était pas lu et la superficie ne venait que des membres coopérative :
   toutes les cellules agricoles étaient vides pour les producteurs AFLP directs. Données synthétiques. */
const agri=await page.evaluate(async()=>{
 const D=window.__DATA;
 D.villages_light_v=[{id:'v-1',village:'Village Test',region:'R',departement:'D',cluster:'CL-1',deleted:false,data:{}}];
 D.rt_light_v=[{id:'rt-1',id_rt:'RT-T1',nom:'RT Test',deleted:false}];
 const base={nom:'Test',village_id:'v-1',rt_id:'rt-1',deleted:false,is_qa:false};
 D.producteurs=[
  {...base,id:'p1',code:'TST-0001',data:{superficieHa:5,nbArbres:750,prodPrecKg:3000,potentiel2027Kg:3000,agePlantation:45,anneesAnacarde:45,engagementKg:1000,autresCultures:'Igname'}},
  {...base,id:'p2',code:'TST-0002',data:{superficieHa:'0.50',nbArbres:'5 ANS',prodPrecKg:'0',engagementKg:'300'}},
  {...base,id:'p3',code:'TST-0003',data:{}},
  {...base,id:'p4',code:'TST-0004',data:{superficieHa:9,nbArbres:999}},
  {...base,id:'p5',code:'TST-0005',data:{superficieHa:7,potentiel2027Kg:9999,engagementKg:7777}},
  {...base,id:'p6',code:'TST-0006',data:'{"superficieHa":"3,5","prodPrecKg":"700"}'}
 ];
 D.farmer_plots=[
  {producteur_id:'p4',declared_area:1.5,area_unit:'HA',tree_count:100,latitude:7.1,longitude:-5.1,gps_status:'GPS_VERIFIED',gps_verified_area:1.4,status:'ACTIVE',deleted:false},
  {producteur_id:'p4',declared_area:5000,area_unit:'M2',tree_count:50,status:'ACTIVE',deleted:false},
  {producteur_id:'p4',declared_area:80,area_unit:'HA',tree_count:9000,status:'ARCHIVED',deleted:false}
 ];
 D.farmer_production_baselines=[
  {producteur_id:'p5',campaign_id:'camp-current',version:1,status:'DRAFT',productive_area_ha:3,forecast_kg:1000},
  {producteur_id:'p5',campaign_id:'camp-current',version:2,status:'FINAL',productive_area_ha:4,forecast_kg:2500,previous_production_kg:2000}
 ];
 const x=await ANAGROCI_PJS_EXPORT.workbook('producers',{});
 const buf=await x.wb.xlsx.writeBuffer();
 let s='',a=new Uint8Array(buf);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));
 return btoa(s);
});
{
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(agri,'base64'));
 const ws=wb.getWorksheet('Base Producteurs');assert.ok(ws,'feuille Base Producteurs absente');
 const H=ws.getRow(8).values.slice(1),col=h=>{const i=H.indexOf(h);assert.ok(i>=0,'colonne absente : '+h);return i+1;};
 const rows={};for(let r=9;r<=ws.rowCount;r++){const id=ws.getCell(r,col('Farmer ID')).value;assert.ok(!rows[id],'ligne producteur dupliquée : '+id);rows[id]=r;}
 assert.equal(Object.keys(rows).length,6,'une ligne par producteur attendue');
 const v=(id,h)=>ws.getCell(rows[id],col(h)).value;
 const SUP='Superficie anacarde (ha)',ARB='Nombre d’arbres',PREV='Production précédente (kg)',POT='Potentiel / prévision (kg)';
 // Repli sur producteurs.data, valeurs numériques réelles
 assert.equal(v('TST-0001',SUP),5);assert.equal(v('TST-0001',ARB),750);assert.equal(v('TST-0001',PREV),3000);
 assert.equal(v('TST-0001',POT),3000);assert.equal(v('TST-0001','Potentiel / prévision (MT)'),3);
 assert.equal(v('TST-0001','Âge plantation (ans)'),45);assert.equal(v('TST-0001','Ancienneté anacarde (ans)'),45);
 assert.equal(v('TST-0001','Autres cultures'),'Igname');assert.equal(v('TST-0001','Rendement historique (kg/ha)'),600);
 assert.equal(v('TST-0001','Engagement AFLP (kg)'),1000);assert.equal(v('TST-0001','Source superficie'),'Fiche producteur');
 assert.equal(typeof v('TST-0001',SUP),'number','superficie doit être un nombre Excel');
 // Chaînes normalisées, zéro réel conservé, saisie non numérique non convertie et signalée
 assert.equal(v('TST-0002',SUP),0.5);assert.equal(v('TST-0002',PREV),0);assert.equal(v('TST-0002','Rendement historique (kg/ha)'),0);
 assert.equal(v('TST-0002',ARB),null,'« 5 ANS » ne doit pas devenir un nombre d’arbres');
 assert.match(String(v('TST-0002','Saisies agricoles non numériques')),/5 ANS/);
 assert.equal(v('TST-0002',POT),null,'engagementKg ne doit jamais servir de potentiel');
 // Absence : cellules vides, jamais 0
 for(const h of [SUP,ARB,PREV,POT,'Nombre de parcelles','Rendement historique (kg/ha)'])assert.equal(v('TST-0003',h),null,'absence convertie : '+h);
 // Parcelles prioritaires, jamais additionnées à la fiche ; parcelle archivée ignorée
 assert.equal(v('TST-0004',SUP),2);assert.equal(v('TST-0004',ARB),150);assert.equal(v('TST-0004','Nombre de parcelles'),2);
 assert.equal(v('TST-0004','Parcelles GPS'),1);assert.equal(v('TST-0004','Superficie GPS vérifiée (ha)'),1.4);
 assert.equal(v('TST-0004','Source superficie'),'Parcelles');
 // Baseline : dernière version, prioritaire sur la fiche ; engagement jamais utilisé comme potentiel
 assert.equal(v('TST-0005',SUP),4);assert.equal(v('TST-0005',POT),2500);assert.equal(v('TST-0005',PREV),2000);
 assert.equal(v('TST-0005','Source potentiel'),'Baseline');assert.equal(v('TST-0005','Engagement AFLP (kg)'),7777);
 // `data` stocké en chaîne JSON, virgule décimale
 assert.equal(v('TST-0006',SUP),3.5);assert.equal(v('TST-0006',PREV),700);assert.equal(v('TST-0006','Rendement historique (kg/ha)'),200);
 results.push({producers_agri:'PASS'});
}
await browser.close();server.close();
console.log(JSON.stringify({result:'PASS',reconciliation:true,brand:true,formula_injection:true,performance:results},null,2));

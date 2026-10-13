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
await browser.close();server.close();
console.log(JSON.stringify({result:'PASS',reconciliation:true,brand:true,formula_injection:true,performance:results},null,2));

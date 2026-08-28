/* ANAGROCI Operations — export XLSX consolidé depuis Supabase.
   Pas de formule externe, pas de lien inter-workbook : les valeurs sont des projections de la base. */
(function(g){'use strict';
function toast(msg){var el=document.getElementById('exportStatus');if(el)el.textContent=msg;}
function waitClient(){return new Promise(function(resolve){var n=0,t=setInterval(function(){n++;if(g.supabase&&g.ANAGROCI_SUPABASE_URL&&g.ANAGROCI_SUPABASE_ANON){clearInterval(t);resolve(g.supabase.createClient(g.ANAGROCI_SUPABASE_URL,g.ANAGROCI_SUPABASE_ANON));}else if(n>100){clearInterval(t);resolve(null);}},80);});}
async function q(sb,table,cols,limit){try{var r=await sb.from(table).select(cols||'*').limit(limit||5000);if(r.error)throw r.error;return r.data||[];}catch(e){console.warn('[Reports Export]',table,e&&e.message?e.message:e);return [];}}
function clean(rows){return rows.map(function(row){var out={};Object.keys(row).forEach(function(k){var v=row[k];if(v&&typeof v==='object')out[k]=JSON.stringify(v);else out[k]=v;});return out;});}
function add(wb,name,rows){var data=clean(rows||[]);var ws=g.XLSX.utils.json_to_sheet(data.length?data:[{Information:'Aucune donnée pour les filtres sélectionnés'}]);ws['!cols']=Object.keys(data[0]||{Information:''}).map(function(k){return{wch:Math.min(36,Math.max(12,k.length+3))};});g.XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));}
async function exportWorkbook(){if(!g.XLSX){alert('Moteur Excel indisponible. Rechargez la page.');return;}var sb=await waitClient();if(!sb){alert('Connexion aux données indisponible.');return;}var btn=document.getElementById('exportXlsx');if(btn)btn.disabled=true;toast('Préparation du classeur…');try{
var generated=new Date();var wb=g.XLSX.utils.book_new();
var lba=await q(sb,'rcn_fournisseurs','*');lba=lba.filter(function(x){return String(x.code||'').indexOf('LBA-')===0;});
var funding=await q(sb,'lba_funding_cycle_status_v','*');
var limits=await q(sb,'lba_funding_limit_history','*');
var arrivals=await q(sb,'rcn_proc_arrivages','*');
var receptions=await q(sb,'rcn_v_receptions','*');
var bags=await q(sb,'rcn_jute_movements','*');
var bagBal=await q(sb,'rcn_jute_v_supplier_profile','*');
var bin=await q(sb,'rcn_bi_stock_bin','*');
var trf=await q(sb,'rcn_v_transferts','*');
var cal=await q(sb,'rcn_v_calibrages','*');
var trace=await q(sb,'operations_traceability_search_v','*');
var audit=await q(sb,'rcn_audit','*',5000);
var totalLbaKg=lba.reduce(function(t,x){return t+Number(x.volume_livre_kg||0);},0);var bagDue=bagBal.reduce(function(t,x){return t+Number(x.balance||0);},0);var binKg=bin.reduce(function(t,x){return t+Number(x.stock_physique_kg||0);},0);
add(wb,'Metadata',[{campaign:'2027',generated_at:generated.toISOString(),source:'ANAGROCI Operations Suite',schema_version:'Operations Suite MVP 2026-08-28',formula_policy:'VALUES_ONLY_NO_EXTERNAL_LINKS',note:'Les règles financières marquées À CONFIRMER ne sont pas recalculées arbitrairement.'}]);
add(wb,'Dashboard',[{indicator:'LBA master',value:lba.length,unit:'count'},{indicator:'Historical LBA volume',value:totalLbaKg,unit:'kg'},{indicator:'Funding cycles',value:funding.length,unit:'count'},{indicator:'Bag balance LBA',value:bagDue,unit:'bags'},{indicator:'Warehouse BIN stock',value:binKg,unit:'kg'},{indicator:'Stock transfers',value:trf.length,unit:'count'},{indicator:'Processing batches',value:cal.length,unit:'count'}]);
add(wb,'LBA Master',lba);add(wb,'Funding Status',funding);add(wb,'Funding Limits',limits);add(wb,'RCN Deliveries',arrivals);add(wb,'Offloadings',receptions);add(wb,'Bag Movements',bags);add(wb,'Bag Balances',bagBal);add(wb,'Warehouse Stock',bin);add(wb,'Stock Transfers',trf);add(wb,'Factory Unloading',receptions.filter(function(x){return /YAK|FACTORY/i.test(String(x.destination||'')+' '+String(x.site||''));}));add(wb,'Processing',cal);add(wb,'Traceability',trace);add(wb,'Audit',audit);
g.XLSX.writeFile(wb,'ANAGROCI_Operations_Consolidated_'+generated.toISOString().slice(0,10)+'.xlsx',{compression:true});toast('Classeur généré : '+wb.SheetNames.length+' onglets.');
}catch(e){console.error(e);toast('Échec export : '+(e&&e.message?e.message:e));alert('Export impossible : '+(e&&e.message?e.message:e));}finally{if(btn)btn.disabled=false;}}
g.ANAGROCI_REPORTS={exportWorkbook:exportWorkbook};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('exportXlsx');if(b)b.addEventListener('click',exportWorkbook);});else{var b=document.getElementById('exportXlsx');if(b)b.addEventListener('click',exportWorkbook);}
})(window);
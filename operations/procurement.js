/* ANAGROCI Procurement — orchestration des canaux d'achat vers Warehouse. */
(function(global){'use strict';
var root,sb,state={};
function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function n(v){var x=Number(v||0);return isFinite(x)?x:0;}
function num(v,d){return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:d==null?0:d}).format(n(v));}
function money(v){return num(v,0)+' FCFA';}
function kg(v){return num(v,1)+' kg';}
function mt(v){return num(n(v)/1000,2)+' MT';}
function dt(v){if(!v)return'—';try{return new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch(e){return esc(v);}}
function route(){return (location.hash||'#overview').slice(1).split('/')[0]||'overview';}
function badge(s){var x=String(s||'').toUpperCase(),c=/REJECT|REFUS|BLOQ|VARIANCE|FAILED|INACT/.test(x)?'danger':/ACTIVE|ACTIF|APPROUV|BALANCED|RECEIVED|CLOSED|PAID/.test(x)?'ok':/PENDING|ATTENT|DISPATCH|TRANSIT|DRAFT|REVIEW/.test(x)?'warn':'info';return'<span class="badge '+c+'">'+esc(s||'—')+'</span>';}
function head(t,s,a){return'<div class="ops-route-head"><div><h1>'+esc(t)+'</h1><p>'+esc(s||'')+'</p></div><div class="ops-route-actions">'+(a||'')+'</div></div>';}
function table(h,r){if(!r.length)return'<div class="ops-empty">Aucune donnée.</div>';return'<div class="table-wrap"><table><thead><tr>'+h.map(function(x){return'<th>'+esc(x)+'</th>';}).join('')+'</tr></thead><tbody>'+r.join('')+'</tbody></table></div>';}
function kpis(a){return'<section class="kpi-grid">'+a.map(function(x){return'<div class="kpi '+(x[3]||'')+'"><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b><span>'+esc(x[2]||'')+'</span></div>';}).join('')+'</section>';}
function field(l,nm,type,val,attr){return'<div class="ops-field"><label>'+esc(l)+'</label><input name="'+esc(nm)+'" type="'+(type||'text')+'" value="'+esc(val||'')+'" '+(attr||'')+'></div>';}
function select(l,nm,opts,val,attr){return'<div class="ops-field"><label>'+esc(l)+'</label><select name="'+esc(nm)+'" '+(attr||'')+'>'+opts.map(function(o){return'<option value="'+esc(o[0])+'" '+(String(o[0])===String(val||'')?'selected':'')+'>'+esc(o[1])+'</option>';}).join('')+'</select></div>';}
function formObj(f){var o={};new FormData(f).forEach(function(v,k){o[k]=String(v).trim();});return o;}
function waitClient(){return new Promise(function(resolve){var i=0,t=setInterval(function(){i++;if(global.supabase&&global.ANAGROCI_SUPABASE_URL&&global.ANAGROCI_SUPABASE_ANON){clearInterval(t);resolve(global.supabase.createClient(global.ANAGROCI_SUPABASE_URL,global.ANAGROCI_SUPABASE_ANON));}else if(i>100){clearInterval(t);resolve(null);}},80);});}
async function q(name,cols,build){var x=sb.from(name).select(cols||'*');if(build)x=build(x);var r=await x;if(r.error)throw new Error(r.error.message);return r.data||[];}
async function rpc(name,args){var r=await sb.rpc(name,args||{});if(r.error)throw new Error(r.error.message);return r.data;}
async function load(){
 var rs=await Promise.all([
  q('procurement_v_purchase_feed','*',function(x){return x.order('purchase_at',{ascending:false}).limit(1000);}),
  q('rcn_fournisseurs','code,nom,categorie,statut,origines,sites,volume_livre_kg,kor_moyen,humidite_moyenne',function(x){return x.order('code').limit(1000);}),
  q('field_lots','*',function(x){return x.order('created_at',{ascending:false}).limit(500);}),
  q('field_lot_contributors','*',function(x){return x.eq('status','ACTIVE').limit(2000);}),
  q('field_shipments','*',function(x){return x.order('created_at',{ascending:false}).limit(500);}),
  q('procurement_v_pending_receptions','*',function(x){return x.order('source_date',{ascending:false}).limit(500);}),
  q('procurement_v_reconciliation','*',function(x){return x.order('departed_at',{ascending:false}).limit(500);}),
  q('procurement_campaign_rules','*',function(x){return x.order('effective_from',{ascending:false}).limit(200);}),
  q('procurement_purchase_types','*',function(x){return x.eq('active',true).order('code');}),
  q('procurement_payment_methods','*',function(x){return x.eq('active',true).order('code');}),
  q('wms_warehouses','id,code,name,status',function(x){return x.eq('status','ACTIVE').order('code');})
 ]);
 state={purchases:rs[0],suppliers:rs[1],lots:rs[2],contributors:rs[3],shipments:rs[4],pending:rs[5],recon:rs[6],rules:rs[7],types:rs[8],payments:rs[9],warehouses:rs[10]};
}
function overview(){
 var p=state.purchases,field=p.filter(function(x){return x.procurement_channel==='FIELD_BUYING';}),lba=p.filter(function(x){return x.procurement_channel==='LBA';});
 var total=p.reduce(function(t,x){return t+n(x.field_or_net_kg);},0),val=p.reduce(function(t,x){return t+n(x.amount);},0);
 root.innerHTML=head('Procurement Control Tower','Une vue transverse; les opérations spécialisées restent dans Field Buying, LBA Purchase et Warehouse.')+
 kpis([['Purchased',mt(total),p.length+' transaction(s)'],['Field Buying',mt(field.reduce(function(t,x){return t+n(x.field_or_net_kg);},0)),field.length+' achat(s)'],['LBA',mt(lba.reduce(function(t,x){return t+n(x.field_or_net_kg);},0)),lba.length+' dossier(s)'],['Pending Warehouse',String(state.pending.length),'évacuation / arrivage'],['Unreconciled',String(state.recon.filter(function(x){return x.reconciliation_status!=='BALANCED';}).length),'Field ↔ Warehouse','attn'],['Procurement Value',money(val),'tous canaux']])+
 '<div class="grid-2"><section class="card"><h2>Work Queue</h2>'+table(['Source','Référence','Canal','Truck','Expected','Warehouse'],state.pending.slice(0,20).map(function(x){return'<tr><td>'+esc(x.source_type)+'</td><td class="mono">'+esc(x.source_ref)+'</td><td>'+badge(x.procurement_channel)+'</td><td>'+esc(x.truck||'—')+'</td><td>'+kg(x.expected_kg)+'</td><td>'+esc(x.warehouse_code||'À confirmer')+'</td></tr>';}))+'</section>'+
 '<section class="card"><h2>Architecture</h2><div class="notice info"><b>Field Buying</b> = achat terrain · <b>Procurement</b> = vérité commerciale · <b>Warehouse</b> = vérité physique · <b>Movement Ledger</b> = vérité stock.</div><div class="ops-actions" style="margin-top:12px"><a class="btn secondary" href="field-buying.html#purchases">Achat Bord Champ</a><a class="btn secondary" href="lba-purchase.html#registry">LBA</a><a class="btn secondary" href="warehouse.html#inbound">Warehouse</a></div></section></div>';
}
function purchases(){
 root.innerHTML=head('Purchases','Flux consolidé Field Buying + LBA + Cooperative + Direct.')+
 '<section class="card">'+table(['Date','Canal','Counterparty','RT','Village','kg','Paid kg','Prix','Montant','Paiement','Statut'],state.purchases.map(function(x){return'<tr><td>'+dt(x.purchase_at)+'</td><td>'+badge(x.procurement_channel)+'</td><td><b>'+esc(x.counterparty_code||'—')+'</b><br>'+esc(x.counterparty_name||'—')+'</td><td>'+esc(x.rt_id||'—')+'</td><td>'+esc(x.village_nom||'—')+'</td><td>'+kg(x.field_or_net_kg)+'</td><td>'+kg(x.paid_weight_kg)+'</td><td>'+money(x.unit_price)+'</td><td>'+money(x.amount)+'</td><td>'+esc(x.payment_method||x.payment_status||'—')+'</td><td>'+badge(x.status)+'</td></tr>'; }))+'</section>';
}
function fieldBuying(){
 var p=state.purchases.filter(function(x){return x.procurement_channel==='FIELD_BUYING';});
 root.innerHTML=head('Field Buying','RT → Producteur → Achat → Consolidation → Evacuation → Warehouse.','<a class="btn primary" href="field-buying.html#purchases">Ouvrir Field Buying</a>')+
 kpis([['Achats',String(p.length),'transactions producteurs'],['Volume terrain',mt(p.reduce(function(t,x){return t+n(x.field_or_net_kg);},0)),'avant reconciliation Warehouse'],['Lots terrain',String(state.lots.length),'consolidations'],['Evacuations',String(state.shipments.length),'shipments']])+
 '<section class="card"><h2>Point de contrôle</h2><p>Un RT n’est pas un Supplier. Les producteurs restent les contributeurs du Lot; l’Evacuation est la source Procurement transmise au Warehouse.</p></section>';
}
function lba(){
 var l=state.suppliers.filter(function(x){return x.categorie==='LBA'||String(x.code).indexOf('LBA-')===0;});
 root.innerHTML=head('LBA','Registry LBA et passerelle vers les achats/financements.','<button class="btn primary" onclick="ANAGROCI_PROC.toggleLba()">+ Nouveau LBA</button><a class="btn secondary" href="lba-purchase.html">Workspace LBA</a>')+
 '<section id="procLbaForm" class="ops-form-card" hidden><h2>Créer un LBA</h2><form id="lbaForm"><div class="ops-form-grid">'+field('Nom','nom','text','','required')+field('Code','code','text','','required placeholder="LBA-..."')+field('Origine','origine','text','','required')+field('Site','site','text','')+select('Contrat','contrat',[['false','Non'],['true','Oui']],'false')+'</div><div class="ops-actions" style="margin-top:12px"><button class="btn primary">Créer</button></div><div id="lbaMsg" class="muted"></div></form></section>'+
 '<section class="card">'+table(['Code','Nom','Origines','Sites','Volume livré','KOR','Moisture','Statut'],l.map(function(x){return'<tr><td class="mono"><b>'+esc(x.code)+'</b></td><td>'+esc(x.nom)+'</td><td>'+esc((x.origines||[]).join(', ')||'—')+'</td><td>'+esc((x.sites||[]).join(', ')||'—')+'</td><td>'+mt(x.volume_livre_kg)+'</td><td>'+esc(x.kor_moyen==null?'—':x.kor_moyen)+'</td><td>'+esc(x.humidite_moyenne==null?'—':x.humidite_moyenne+' %')+'</td><td>'+badge(x.statut)+'</td></tr>'; }))+'</section>';
 bindLba();
}
function suppliers(){
 root.innerHTML=head('Suppliers','Supplier Master unique utilisé par Procurement et Warehouse.')+
 '<section class="card">'+table(['Code','Name','Category','Origins','Sites','Delivered','KOR','Moisture','Status'],state.suppliers.map(function(x){return'<tr><td class="mono"><b>'+esc(x.code)+'</b></td><td>'+esc(x.nom)+'</td><td>'+esc(x.categorie)+'</td><td>'+esc((x.origines||[]).join(', ')||'—')+'</td><td>'+esc((x.sites||[]).join(', ')||'—')+'</td><td>'+mt(x.volume_livre_kg)+'</td><td>'+esc(x.kor_moyen==null?'—':x.kor_moyen)+'</td><td>'+esc(x.humidite_moyenne==null?'—':x.humidite_moyenne+' %')+'</td><td>'+badge(x.statut)+'</td></tr>'; }))+'</section>';
}
function usedMap(){var m={};state.contributors.forEach(function(c){m[c.achat_id]=(m[c.achat_id]||0)+n(c.qty_kg);});return m;}
function evacuations(){
 var used=usedMap(),available=state.purchases.filter(function(x){return x.procurement_channel==='FIELD_BUYING'&&n(x.field_or_net_kg)-n(used[x.purchase_id])>0;});
 var lotOpts=state.lots.filter(function(x){return['SEALED','IN_STOCK'].indexOf(x.status)>=0;});
 root.innerHTML=head('Evacuations','Consolider les achats producteurs puis expédier les Lots vers un Warehouse.')+
 '<div class="grid-2"><section class="ops-form-card"><h2>1. Nouveau Lot terrain</h2><form id="lotForm"><div class="ops-form-grid">'+select('Scope Type','scope_type',[['VILLAGE','Village'],['CLUSTER','Cluster'],['MIXED','Mixed']],'VILLAGE')+field('Scope ID','scope_id')+field('Scope Label','scope_label','text','','required')+field('Notes','notes')+'</div><h3>Achats disponibles</h3><div class="table-wrap"><table><thead><tr><th></th><th>Purchase</th><th>Producteur</th><th>Village</th><th>Disponible</th><th>Qty Lot</th><th>Sacs</th></tr></thead><tbody>'+available.slice(0,150).map(function(x){var av=n(x.field_or_net_kg)-n(used[x.purchase_id]);return'<tr><td><input type="checkbox" name="pick" value="'+esc(x.purchase_id)+'"></td><td class="mono">'+esc(x.purchase_id)+'</td><td>'+esc(x.counterparty_name||'—')+'</td><td>'+esc(x.village_nom||'—')+'</td><td>'+kg(av)+'</td><td><input name="qty_'+esc(x.purchase_id)+'" type="number" step="0.001" min="0" max="'+av+'" value="'+av+'"></td><td><input name="bags_'+esc(x.purchase_id)+'" type="number" min="0"></td></tr>';}).join('')+'</tbody></table></div><div class="ops-actions"><button class="btn primary">Seal Field Lot</button></div><div id="lotMsg" class="muted"></div></form></section>'+
 '<section class="ops-form-card"><h2>2. Nouvelle Evacuation</h2><form id="shipForm"><div class="ops-form-grid">'+select('Lot','lot_id',[['','Choisir…']].concat(lotOpts.map(function(x){return[x.id,x.lot_code+' · '+x.scope_label];})),'','required')+field('Loaded kg','loaded_qty_kg','number','','required step="0.001" min="0.001"')+select('Origin Type','origin_type',[['VILLAGE','Village'],['OTHER','Other']],'VILLAGE')+field('Origin ID','origin_id')+field('Origin','origin_label','text','','required')+select('Destination Warehouse','destination_id',[['','Choisir…']].concat(state.warehouses.map(function(w){return[w.id,w.code+' - '+w.name];})),'','required')+field('Truck','vehicle_plate','text','','required')+field('Driver','driver_name')+field('Document Ref','document_ref')+field('Departure','departed_at','datetime-local')+'</div><div class="ops-actions"><button class="btn primary">Dispatch Evacuation</button></div><div id="shipMsg" class="muted"></div></form></section></div>'+
 '<section class="card"><h2>Evacuations</h2>'+table(['Shipment','Origin','Destination','Truck','Dispatched','Received','Status','WMS Reception'],state.shipments.map(function(x){return'<tr><td class="mono">'+esc(x.shipment_code)+'</td><td>'+esc(x.origin_label)+'</td><td>'+esc(x.destination_label)+'</td><td>'+esc(x.vehicle_plate||'—')+'</td><td>'+kg(x.dispatched_qty_kg)+'</td><td>'+kg(x.received_qty_kg)+'</td><td>'+badge(x.status)+'</td><td class="mono">'+esc(x.wms_reception_id||'—')+'</td></tr>'; }))+'</section>';
 bindEvac();
}
function reconciliation(){
 root.innerHTML=head('Reconciliation','Comparer le poids expédié terrain au Net Weight certifié Warehouse.')+
 '<section class="card"><div class="notice info">Un écart n’est jamais redistribué automatiquement aux producteurs. Toute règle de répartition reste une décision métier explicite.</div>'+table(['Shipment','Origin','Truck','Field kg','Warehouse REC','Warehouse Net','Variance kg','Variance %','Status'],state.recon.map(function(x){return'<tr><td class="mono">'+esc(x.shipment_code)+'</td><td>'+esc(x.origin_label)+'</td><td>'+esc(x.vehicle_plate||'—')+'</td><td>'+kg(x.field_dispatched_kg)+'</td><td class="mono">'+esc(x.wms_reception_id||'—')+'</td><td>'+kg(x.warehouse_net_kg)+'</td><td>'+kg(x.variance_kg)+'</td><td>'+esc(x.variance_pct==null?'—':x.variance_pct+' %')+'</td><td>'+badge(x.reconciliation_status)+'</td></tr>'; }))+'</section>';
}
function settings(){
 root.innerHTML=head('Settings','Règles Procurement versionnées; les anciennes constantes JS sont désormais visibles et auditables.')+
 '<section class="card"><h2>Campaign Rules</h2>'+table(['Campaign','Channel','Zone','Price/kg','RT Commission/kg','Max Moisture','Min KOR','From','To','Source','Status'],state.rules.map(function(x){return'<tr><td>'+esc(x.campaign)+'</td><td>'+esc(x.channel_code)+'</td><td>'+esc(x.zone_code||'GLOBAL')+'</td><td>'+money(x.price_per_kg)+'</td><td>'+money(x.rt_commission_per_kg)+'</td><td>'+esc(x.max_moisture_pct==null?'—':x.max_moisture_pct+' %')+'</td><td>'+esc(x.min_kor==null?'—':x.min_kor)+'</td><td>'+esc(x.effective_from)+'</td><td>'+esc(x.effective_to||'—')+'</td><td>'+esc(x.source||'—')+'</td><td>'+badge(x.status)+'</td></tr>'; }))+'</section>'+
 '<section class="card"><h2>Business Decisions Required</h2><ul><li>Validation officielle du prix campagne / commission RT / seuils qualité migrés du legacy.</li><li>Règle de répartition des écarts Field → Warehouse entre producteurs.</li><li>Autorité métier qui décide la Refraction.</li><li>Disposition finale d’un camion rejeté.</li><li>Politique d’ajustement commercial lorsqu’un producteur est déjà payé avant constat d’écart Warehouse.</li></ul></section>';
}
async function audit(){
 var rows=await q('rcn_audit','id,objet,champ,motif,auteur,role,created_at',function(x){return x.order('created_at',{ascending:false}).limit(300);});
 root.innerHTML=head('Procurement Audit','Historique transverse des actions Procurement/Warehouse.')+'<section class="card">'+table(['Date','Object','Action','Reason','User','Role'],rows.map(function(x){return'<tr><td>'+dt(x.created_at)+'</td><td class="mono">'+esc(x.objet||'—')+'</td><td>'+esc(x.champ||'—')+'</td><td>'+esc(x.motif||'—')+'</td><td>'+esc(x.auteur||'—')+'</td><td>'+esc(x.role||'—')+'</td></tr>'; }))+'</section>';
}
function bindLba(){
 var f=document.getElementById('lbaForm');if(!f)return;f.onsubmit=async function(e){e.preventDefault();var d=formObj(f),m=document.getElementById('lbaMsg');try{m.textContent='Création…';await rpc('lba_create',{p_nom:d.nom,p_code:d.code,p_origine:d.origine,p_site:d.site||null,p_contrat:d.contrat==='true'});m.className='ops-ok-text';m.textContent='LBA créé.';await load();lba();}catch(err){m.className='ops-danger-text';m.textContent=err.message;}};
}
function bindEvac(){
 var lf=document.getElementById('lotForm');if(lf)lf.onsubmit=async function(e){e.preventDefault();var d=formObj(lf),picks=[].slice.call(lf.querySelectorAll('input[name="pick"]:checked')),msg=document.getElementById('lotMsg');try{if(!picks.length)throw new Error('Sélectionnez au moins un achat.');var ps=picks.map(function(x){return{achat_id:x.value,qty_kg:Number(lf.querySelector('[name="qty_'+x.value+'"]').value),bag_count:Number(lf.querySelector('[name="bags_'+x.value+'"]').value||0)};});await rpc('procurement_field_create_lot',{p:{scope_type:d.scope_type,scope_id:d.scope_id||null,scope_label:d.scope_label,notes:d.notes||null,purchases:ps}});msg.className='ops-ok-text';msg.textContent='Lot terrain créé et scellé.';await load();evacuations();}catch(err){msg.className='ops-danger-text';msg.textContent=err.message;}};
 var sf=document.getElementById('shipForm');if(sf)sf.onsubmit=async function(e){e.preventDefault();var d=formObj(sf),msg=document.getElementById('shipMsg'),wh=state.warehouses.filter(function(w){return String(w.id)===String(d.destination_id);})[0];try{await rpc('procurement_field_create_shipment',{p:{origin_type:d.origin_type,origin_id:d.origin_id||null,origin_label:d.origin_label,destination_type:'WAREHOUSE',destination_id:d.destination_id,destination_label:wh?wh.code:d.destination_id,vehicle_plate:d.vehicle_plate,driver_name:d.driver_name||null,document_ref:d.document_ref||null,departed_at:d.departed_at||null,lots:[{lot_id:d.lot_id,loaded_qty_kg:Number(d.loaded_qty_kg)}]}});msg.className='ops-ok-text';msg.textContent='Evacuation dispatchée; elle apparaît maintenant dans Warehouse / New Reception.';await load();evacuations();}catch(err){msg.className='ops-danger-text';msg.textContent=err.message;}};
}
var ROUTES={overview:overview,field:fieldBuying,lba:lba,purchases:purchases,suppliers:suppliers,evacuations:evacuations,reconciliation:reconciliation,settings:settings,audit:audit};
async function render(){root=document.getElementById('opsRouteView');try{if(!state.purchases)await load();(ROUTES[route()]||overview)();}catch(e){root.innerHTML=head('Rubrique indisponible','Erreur Procurement')+'<div class="notice danger">'+esc(e.message)+'</div>';}}
global.ANAGROCI_OPS_ROUTE=render;
global.ANAGROCI_PROC={render:render,toggleLba:function(){var x=document.getElementById('procLbaForm');if(x)x.hidden=!x.hidden;}};
async function boot(){root=document.getElementById('opsRouteView');sb=await waitClient();if(!sb){root.innerHTML='<div class="notice danger">Supabase indisponible.</div>';return;}await render();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})(window);

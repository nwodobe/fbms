/* RCN TRACE — Sacherie v2 : rapprochement et pilotage opérationnel. */
(function(g){"use strict";
var URL="https://jmbdgpdthzpszfnddwzi.supabase.co",KEY="sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d",sb,state=null,loading=null,seq=0;
function c(){if(!sb&&g.supabase)sb=g.supabase.createClient(URL,KEY);return sb;}
function n(x){return Number(x||0);}
function id(p){seq++;return p+"-"+Date.now().toString(36).toUpperCase()+"-"+seq.toString(36).toUpperCase();}
function run(name,args){return c().rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});}
function load(){if(loading)return loading;if(!c())return Promise.resolve(null);/* hors connexion / supabase absent : pas de crash */loading=Promise.all([
 c().from("rcn_jute_settings").select("*").eq("id","DEFAULT").maybeSingle(),
 c().from("rcn_jute_reconciliations").select("*").order("created_at",{ascending:false}),
 c().from("rcn_jute_receipt_lines").select("*").order("received_at",{ascending:false}).limit(500),
 c().from("rcn_jute_v_supplier_profile").select("*"),
 c().from("rcn_jute_v_stock").select("*"),
 c().from("rcn_jute_purchases").select("*").order("created_at",{ascending:false}),
 c().from("rcn_jute_transfers").select("*").order("created_at",{ascending:false}),
 c().from("rcn_jute_repairs").select("*").order("sent_at",{ascending:false})
 ]).then(function(rs){rs.forEach(function(r){if(r.error)throw r.error;});state={settings:rs[0].data||{bags_per_bale:500,alert_threshold:100000,average_fill_kg:80,initial_reference:300000},reconciliations:rs[1].data||[],receipts:rs[2].data||[],profiles:rs[3].data||[],stock:rs[4].data||[],purchases:rs[5].data||[],transfers:rs[6].data||[],repairs:rs[7].data||[]};return state;}).finally(function(){loading=null;});return loading;}
function reload(){state=null;return load().then(function(x){if(g.RCNTRACE_RERENDER)g.RCNTRACE_RERENDER();return x;});}
function pendingReception(rec){var d=rec&&rec.dechargement||{},total=n(d.sacs),loc=rec&&(rec.warehouse||rec.site);if(!rec||!total)return Promise.resolve();var row={id:"JREC-"+String(rec.id).replace(/[^A-Za-z0-9_-]/g,"-"),reception_id:rec.id,supplier_code:rec.lba||null,location_code:loc||null,campaign:rec.campaign||"2026",total_unloaded:total,company_bags:0,supplier_bags:0,unknown_bags:total,usable_bags:0,humid_bags:0,torn_bags:0,repaired_bags:0,other_company_bags:0,bales:Math.floor(total/500),loose_bags:total%500,status:"A_COMPLETER",note:"À rapprocher après déchargement",created_by:null};
 function save(){return c().from("rcn_jute_reconciliations").upsert(row,{onConflict:"reception_id",ignoreDuplicates:true}).then(function(r){if(r.error)throw r.error;return reload();});}
 return (g.RCNJuteControl&&g.RCNJuteControl.setupLocations?g.RCNJuteControl.setupLocations().catch(function(){return null;}):Promise.resolve()).then(save);
}
function reconcile(d){return run("rcn_jute_reconcile_reception",{p_reception_id:d.receptionId,p_supplier_code:d.supplierCode,p_location:d.location,p_campaign:d.campaign||"2026",p_total:n(d.total),p_company:n(d.company),p_supplier:n(d.supplier),p_unknown:n(d.unknown),p_usable:n(d.usable),p_humid:n(d.humid),p_torn:n(d.torn),p_repaired:n(d.repaired),p_other:n(d.other),p_bales:n(d.bales),p_loose:n(d.loose),p_reference:d.reference,p_note:d.note||null,p_proof:d.proof||null}).then(reload);}
function transition(d){return run("rcn_jute_transition",{p_location:d.location,p_from:d.from,p_to:d.to,p_qty:n(d.qty),p_reference:d.reference,p_note:d.note||null}).then(reload);}
function partial(type,d){return run("rcn_jute_receive_partial",{p_type:type,p_id:d.id,p_qty:n(d.qty),p_outcome:d.outcome||"CONFORME",p_document:d.document,p_proof:d.proof||null}).then(reload);}
function repairPartial(d){return run("rcn_jute_receive_repair_partial",{p_id:d.id,p_repaired:n(d.repaired),p_irreparable:n(d.irreparable),p_document:d.document,p_proof:d.proof||null}).then(reload);}
function updateSettings(d){return c().from("rcn_jute_settings").update({bags_per_bale:n(d.bagsPerBale),alert_threshold:n(d.threshold),average_fill_kg:n(d.avgKg),initial_reference:n(d.initialReference),updated_at:new Date().toISOString()}).eq("id","DEFAULT").then(function(r){if(r.error)throw r.error;return reload();});}
function rebag(d){var mid=id("JUT"),cost=n(d.cost);return c().from("rcn_jute_movements").insert({id:mid,event_key:"REBAG:"+d.reference,movement_type:"REBAGING",ledger:"INTERNE",qty:n(d.qty),from_location:d.location,from_state:"UTILISABLE",reception_id:d.receptionId||null,lot_id:d.lotId||null,bin_id:d.binId||null,source_type:"REBAGING",source_id:d.reference,reference:d.reference,note:d.note||null,owner_type:"ANAGROCI",unit_cost:cost,total_cost:cost*n(d.qty)}).then(function(r){if(r.error)throw r.error;return reload();});}
function uploadProof(file){if(!file)return Promise.resolve(null);return c().auth.getUser().then(function(u){if(u.error||!u.data.user)throw u.error||new Error("Connexion requise");var safe=file.name.replace(/[^A-Za-z0-9._-]/g,"-");var path=u.data.user.id+"/"+Date.now()+"-"+safe;return c().storage.from("rcn-jute-proofs").upload(path,file,{upsert:false,contentType:file.type}).then(function(r){if(r.error)throw r.error;return r.data.path;});});}
function signedProof(path){if(!path)return Promise.resolve(null);return c().storage.from("rcn-jute-proofs").createSignedUrl(path,300).then(function(r){if(r.error)throw r.error;return r.data.signedUrl;});}
function profiles(){return state&&state.profiles||[];}
function profile(code){return profiles().filter(function(x){return x.supplier_code===code;})[0]||null;}
function unsynced(){var synced={};(state&&state.reconciliations||[]).forEach(function(x){if(x.status==="SYNCHRONISE")synced[x.reception_id]=1;});return (g.RCN&&g.RCN.receptions?g.RCN.receptions():[]).filter(function(r){return r.dechargement&&n(r.dechargement.sacs)>0&&!synced[r.id];});}
function forecast(){var settings=state&&state.settings||{},kg=n(settings.average_fill_kg)||80,qty=0;try{var arr=g.RCN.procArrivages?g.RCN.procArrivages():[];arr.filter(function(x){return x.statut==="ANNONCÉ";}).forEach(function(x){qty+=Math.ceil(n(x.volumeKg)/kg);});}catch(e){}return qty;}
function metrics(){var st=state&&state.stock||[],usable=0,total=0,transit=0,repair=0,reformed=0;st.forEach(function(x){var q=n(x.qty);total+=q;if(x.state==="UTILISABLE")usable+=q;if(x.state==="EN_TRANSIT")transit+=q;if(x.state==="A_REPARER"||x.state==="REPARE")repair+=q;if(x.state==="REFORME")reformed+=q;});var f=forecast(),threshold=n(state&&state.settings&&state.settings.alert_threshold)||100000;return {total:total,usable:usable,transit:transit,repair:repair,reformed:reformed,forecast:f,free:usable-f,threshold:threshold,alert:usable-f<threshold,unsynced:unsynced().length};}
function supplierMovements(code){var base=g.RCNJuteControl&&g.RCNJuteControl.data&&g.RCNJuteControl.data();return (base&&base.movements||[]).filter(function(x){return x.supplier_code===code;});}
function init(){var old=g.RCNJuteControl&&g.RCNJuteControl.recordReception;if(g.RCNJuteControl){g.RCNJuteControl.recordReception=pendingReception;g.RCNJuteControl.receivePurchase=function(pid,qty,quality){return partial("ACHAT",{id:pid,qty:qty,outcome:quality||"CONFORME",document:id("BR")});};g.RCNJuteControl.receiveTransfer=function(tid,qty,motif){return partial("TRANSFERT",{id:tid,qty:qty,outcome:motif||"CONFORME",document:id("BRT")});};g.RCNJuteControl.receiveRepair=function(rid,ok,bad){return repairPartial({id:rid,repaired:ok,irreparable:bad,document:id("BRR")});};g.RCNJuteControl.rebag=function(d){d.cost=document.getElementById("jr_cost")?document.getElementById("jr_cost").value:0;return rebag(d);};g.RCNJuteControl.recordReceptionLegacy=old;}
 var setup=g.RCNJuteControl&&g.RCNJuteControl.setupLocations?g.RCNJuteControl.setupLocations().catch(function(){return null;}):Promise.resolve();
 setup.then(load).then(function(){if(g.RCNTRACE_RERENDER)g.RCNTRACE_RERENDER();}).catch(function(e){console.warn("Sacherie v2",e);});
}
g.RCNJuteV2={load:load,reload:reload,data:function(){return state;},pendingReception:pendingReception,reconcile:reconcile,transition:transition,partial:partial,repairPartial:repairPartial,updateSettings:updateSettings,rebag:rebag,uploadProof:uploadProof,signedProof:signedProof,profiles:profiles,profile:profile,unsynced:unsynced,forecast:forecast,metrics:metrics,supplierMovements:supplierMovements};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){setTimeout(init,100);});else setTimeout(init,100);
})(window);

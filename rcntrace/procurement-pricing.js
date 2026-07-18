/* RCN TRACE — Workflow sécurisé des prix d'achat
   Procurement prépare → BM soumet → GM approuve. Aucune donnée n'est embarquée. */
(function(global){
"use strict";
var URL="https://jmbdgpdthzpszfnddwzi.supabase.co",KEY="sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d";
var sb=null,cache=null,purchases=null,loading=null,profile=null;
function client(){if(!sb&&global.supabase)sb=global.supabase.createClient(URL,KEY);return sb;}
function rerender(){if(global.RCNTRACE_RERENDER)global.RCNTRACE_RERENDER();}
function load(){
 var c=client();if(!c)return Promise.resolve([]);
 if(loading)return loading;
 loading=c.auth.getSession().then(function(s){var sess=s.data&&s.data.session;if(!sess){cache=[];return [];}
  return Promise.all([
   c.from("profils").select("nom,role,actif").eq("user_id",sess.user.id).single(),
   c.from("rcn_proc_prix").select("*").order("created_at",{ascending:false}),
   c.from("rcn_proc_validations_achat").select("*").order("submitted_at",{ascending:false})
  ]).then(function(x){if(x[0].error)throw x[0].error;if(x[1].error)throw x[1].error;if(x[2].error)throw x[2].error;profile=x[0].data;cache=x[1].data||[];purchases=x[2].data||[];rerender();return cache.slice();});
 }).catch(function(e){console.warn("Prix d'achat indisponibles",e);cache=[];purchases=[];return [];}).then(function(x){loading=null;return x;});
 return loading;
}
function ensure(){return cache===null?load():Promise.resolve(cache.slice());}
function rows(){return cache===null?null:cache.slice();}
function role(){return profile&&profile.role||((global.RCN&&global.RCN.db().user)||{}).role||"";}
function canDraft(){return ["Procurement Officer","Head of Field","Branch Manager","Assistant Branch Manager","Supervisor","Coordination","Administrateur"].indexOf(role())>=0;}
function canSubmit(){return ["Branch Manager","Assistant Branch Manager","Coordination","Administrateur"].indexOf(role())>=0;}
function canDecide(){return ["GM","General Manager","Coordination","Administrateur"].indexOf(role())>=0;}
function id(){return "PRX-"+new Date().getFullYear()+"-"+Date.now().toString(36).toUpperCase();}
function create(d){
 if(!canDraft())return Promise.reject(new Error("Votre rôle ne peut pas préparer un prix."));
 var c=client(),row={id:id(),supplier_code:d.supplierCode,supplier_name:d.supplierName,campagne:d.campagne||String(new Date().getFullYear()),engagement_id:d.engagementId||null,
 version:Number(d.version||1),previous_id:d.previousId||null,prix_propose:Number(d.prixPropose),volume_kg:d.volumeKg?Number(d.volumeKg):null,
 kor_min:d.korMin?Number(d.korMin):null,humidite_max:d.humiditeMax?Number(d.humiditeMax):null,site:d.site||null,
 valide_du:d.valideDu,valide_au:d.valideAu,justification:d.justification,statut:"BROUILLON"};
 return c.from("rcn_proc_prix").insert(row).then(function(r){if(r.error)throw r.error;cache=null;return load();});
}
function patch(id,data){return client().from("rcn_proc_prix").update(data).eq("id",id).then(function(r){if(r.error)throw r.error;cache=null;return load();});}
function submit(id,price,comment){if(!canSubmit())return Promise.reject(new Error("Seul le BM peut confirmer le prix négocié."));return patch(id,{prix_bm:Number(price),commentaire_bm:comment||"",statut:"NEGOCIE_BM"});}
function decide(id,decision,price,comment){
 if(!canDecide())return Promise.reject(new Error("Seul le GM peut décider du prix."));
 var d={statut:decision,commentaire_gm:comment||""};if(decision==="APPROUVE")d.prix_approuve=Number(price);
 return patch(id,d);
}
function close(id,status,comment){if(!canDecide())return Promise.reject(new Error("Seul le GM peut clôturer un prix."));return patch(id,{statut:status||"EXPIRE",commentaire_gm:comment||""});}
function activeFor(code,at){
 if(cache===null)return null;var day=(at?new Date(at):new Date()).toISOString().slice(0,10);
 return cache.filter(function(x){return x.supplier_code===code&&(x.statut==="NEGOCIE_BM"||x.statut==="APPROUVE")&&x.valide_du<=day&&x.valide_au>=day;})
  .sort(function(a,b){return Number(b.version)-Number(a.version)||new Date(b.submitted_at||b.decided_at)-new Date(a.submitted_at||a.decided_at);})[0]||null;
}
function purchaseRows(){return purchases===null?null:purchases.slice();}
function purchaseForReception(id){return (purchases||[]).filter(function(x){return x.reception_id===id;})[0]||null;}
function submitPurchase(rec,price,priceBm,comment){
 if(!canSubmit())return Promise.reject(new Error("Seul le BM peut soumettre le dossier après déchargement."));
 if(!rec||!rec.dechargement)return Promise.reject(new Error("Le déchargement doit être enregistré avant soumission."));
 var d=rec.dechargement||{},row={id:"ACH-"+new Date().getFullYear()+"-"+Date.now().toString(36).toUpperCase(),reception_id:rec.id,price_ref:price.id,
  supplier_code:rec.lba,supplier_name:rec.fournisseur,poids_net_kg:Number(d.net||0),refraction_kg:Number(d.refraction||0),poids_paye_kg:Number(d.poidsPaye||0),
  prix_negocie:Number(price.prix_bm||price.prix_propose),prix_soumis_bm:Number(priceBm),montant_soumis:Number(d.poidsPaye||0)*Number(priceBm),
  kor_sampling:rec.sampling&&rec.sampling.korDisplay,kor_final:rec.finale&&rec.finale.korDisplay,commentaire_bm:comment||"",statut:"SOUMIS_GM"};
 return client().from("rcn_proc_validations_achat").insert(row).then(function(r){if(r.error)throw r.error;cache=null;purchases=null;return load();});
}
function decidePurchase(id,decision,price,comment){
 if(!canDecide())return Promise.reject(new Error("Seul le GM peut décider du paiement."));
 var d={statut:decision,commentaire_gm:comment||""};if(decision==="APPROUVE")d.prix_approuve_gm=Number(price);
 return client().from("rcn_proc_validations_achat").update(d).eq("id",id).then(function(r){if(r.error)throw r.error;cache=null;purchases=null;return load();});
}
function updateDraft(id,d){
 if(!canDraft())return Promise.reject(new Error("Votre rôle ne peut pas modifier une proposition."));
 var row=(cache||[]).filter(function(x){return x.id===id;})[0];if(!row)return Promise.reject(new Error("Prix introuvable."));
 if(["BROUILLON","A_CORRIGER"].indexOf(row.statut)<0)return Promise.reject(new Error("Ce prix est déjà confirmé : créez une version corrigée."));
 var x={supplier_code:d.supplierCode,supplier_name:d.supplierName,prix_propose:Number(d.prixPropose),volume_kg:d.volumeKg?Number(d.volumeKg):null,kor_min:d.korMin?Number(d.korMin):null,humidite_max:d.humiditeMax?Number(d.humiditeMax):null,site:d.site||null,valide_du:d.valideDu,valide_au:d.valideAu,justification:d.justification||row.justification};
 return patch(id,x);
}
function removePrice(id,comment){
 var row=(cache||[]).filter(function(x){return x.id===id;})[0];if(!row)return Promise.reject(new Error("Prix introuvable."));
 if(["BROUILLON","A_CORRIGER"].indexOf(row.statut)>=0){
  if(!canDraft())return Promise.reject(new Error("Votre rôle ne peut pas supprimer ce brouillon."));
  return client().from("rcn_proc_prix").delete().eq("id",id).then(function(r){if(r.error)throw r.error;cache=null;return load();});
 }
 if(!canSubmit()&&!canDecide())return Promise.reject(new Error("Seul le BM ou le GM peut annuler un prix confirmé."));
 return patch(id,{statut:"ANNULE",commentaire_gm:comment||"Annulation demandée"});
}
function revise(id,d){
 var row=(cache||[]).filter(function(x){return x.id===id;})[0];if(!row)return Promise.reject(new Error("Prix introuvable."));
 if(["BROUILLON","A_CORRIGER"].indexOf(row.statut)>=0)return updateDraft(id,d);
 if(!canSubmit()&&!canDecide())return Promise.reject(new Error("Seul le BM ou le GM peut remplacer un prix confirmé."));
 return create({supplierCode:d.supplierCode,supplierName:d.supplierName,engagementId:row.engagement_id,prixPropose:d.prixPropose,volumeKg:d.volumeKg,korMin:d.korMin,humiditeMax:d.humiditeMax,site:d.site||row.site,campagne:row.campagne,valideDu:d.valideDu,valideAu:d.valideAu,justification:d.justification,version:Number(row.version||1)+1,previousId:row.id}).then(function(){return patch(id,{statut:"REMPLACE",commentaire_gm:"Remplacé par une version corrigée"});});
}
function stats(){var a=cache||[];return {total:a.length,draft:a.filter(function(x){return x.statut==="BROUILLON"||x.statut==="A_CORRIGER";}).length,pending:a.filter(function(x){return x.statut==="SOUMIS_GM";}).length,active:a.filter(function(x){return x.statut==="NEGOCIE_BM"||x.statut==="APPROUVE";}).length};}
global.RCNPricing={load:load,ensure:ensure,rows:rows,role:role,canDraft:canDraft,canSubmit:canSubmit,canDecide:canDecide,create:create,submit:submit,decide:decide,close:close,activeFor:activeFor,purchaseRows:purchaseRows,purchaseForReception:purchaseForReception,submitPurchase:submitPurchase,decidePurchase:decidePurchase,updateDraft:updateDraft,removePrice:removePrice,revise:revise,stats:stats};
})(window);

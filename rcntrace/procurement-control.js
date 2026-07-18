/* RCN TRACE — Contrôle Procurement central : paramètres, conformité, paiement, audit. */
(function(global){"use strict";
var URL="https://jmbdgpdthzpszfnddwzi.supabase.co",KEY="sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d",sb=null,data=null,loading=null,profile=null;
function client(){if(!sb&&global.supabase)sb=global.supabase.createClient(URL,KEY);return sb;}
function id(p){return p+"-"+new Date().getFullYear()+"-"+Date.now().toString(36).toUpperCase();}
function n(x){x=Number(x);return isFinite(x)?x:0;}
function rerender(){if(global.RCNTRACE_RERENDER)global.RCNTRACE_RERENDER();}
function load(){
 if(loading)return loading;var c=client();if(!c)return Promise.resolve(null);
 loading=c.auth.getSession().then(function(s){var sess=s.data&&s.data.session;if(!sess){data={};return data;}
  return Promise.all([
   c.from("profils").select("nom,role,actif").eq("user_id",sess.user.id).single(),
   c.from("rcn_proc_parametres").select("*").eq("id","GLOBAL").single(),
   c.from("rcn_proc_controles_fournisseur").select("*"),
   c.from("rcn_proc_prix_marche").select("*").order("valable_du",{ascending:false}).limit(100),
   c.from("rcn_proc_v_volume_prix").select("*"),
   c.from("rcn_proc_validations_achat").select("*").order("submitted_at",{ascending:false}),
   c.from("rcn_proc_v_paiements").select("*").order("prepared_at",{ascending:false}),
   c.from("rcn_proc_paiements").select("*").order("date_paiement",{ascending:false}),
   c.from("rcn_proc_affectations_financement").select("*").order("created_at",{ascending:false}),
   c.from("rcn_proc_audit_central").select("*").order("created_at",{ascending:false}).limit(150)
  ]).then(function(x){if(x[0].error)throw x[0].error;profile=x[0].data;for(var i=1;i<x.length;i++)if(x[i].error)throw x[i].error;
   data={settings:x[1].data,controls:x[2].data||[],market:x[3].data||[],volumes:x[4].data||[],purchases:x[5].data||[],orders:x[6].data||[],payments:x[7].data||[],allocations:x[8].data||[],audit:x[9].data||[]};rerender();return data;
  });
 }).catch(function(e){console.warn("Contrôle Procurement indisponible",e);data=data||{settings:null,controls:[],market:[],volumes:[],purchases:[],orders:[],payments:[],allocations:[],audit:[]};return data;}).then(function(x){loading=null;return x;});
 return loading;
}
function ensure(){return data?Promise.resolve(data):load();}
function rows(k){return data?(data[k]||[]):null;}
function role(){return profile&&profile.role||"";}
function allowed(a){return a.indexOf(role())>=0;}
function reload(){data=null;return load();}
function control(code){return (data&&data.controls||[]).filter(function(x){return x.supplier_code===code;})[0]||null;}
function volume(priceId){return (data&&data.volumes||[]).filter(function(x){return x.price_id===priceId;})[0]||null;}
function checkPrice(p,opt){opt=opt||{};var errors=[],warnings=[],ctl=control(p.supplier_code),vol=volume(p.id),settings=data&&data.settings;
 if(ctl&&ctl.statut!=="ACTIF")errors.push("Fournisseur "+ctl.statut.toLowerCase()+": "+(ctl.motif_blocage||"aucun nouvel achat autorisé"));
 if(ctl&&ctl.kyc_status!=="VALIDE")warnings.push("KYC fournisseur "+ctl.kyc_status.toLowerCase());
 if(p.site&&opt.site&&p.site!==opt.site)errors.push("Prix valable pour "+p.site+", pas pour "+opt.site);
 if(vol&&p.volume_kg&&n(vol.volume_restant_kg)<n(opt.qty||0))errors.push("Volume négocié insuffisant : "+n(vol.volume_restant_kg)+" kg restants");
 if(!settings||settings.statut!=="VALIDE")warnings.push("Paramètres Procurement non encore validés par la direction");
 return {ok:!errors.length,errors:errors,warnings:warnings,control:ctl,volume:vol};
}
function upsert(table,row,onConflict){return client().from(table).upsert(row,{onConflict:onConflict||"id"}).then(function(r){if(r.error)throw r.error;return reload();});}
function saveSettings(d){if(!allowed(["GM","General Manager","Coordination","Administrateur"]))return Promise.reject(new Error("Validation réservée à la Direction."));
 return upsert("rcn_proc_parametres",{id:"GLOBAL",seuil_bm_fcfa:d.seuilBm||null,seuil_gm_fcfa:d.seuilGm||null,prix_ecart_alerte_pct:d.ecartPrix||null,depassement_volume_pct:d.depVolume||0,ponderations_score:d.weights||{},regles_qualite:d.quality||{},statut:d.status||"A_VALIDER",commentaire:d.comment||null,updated_at:new Date().toISOString()},"id");
}
function saveControl(d){if(!allowed(["Branch Manager","Assistant Branch Manager","GM","General Manager","Coordination","Administrateur"]))return Promise.reject(new Error("Rôle non autorisé."));
 return upsert("rcn_proc_controles_fournisseur",{supplier_code:d.code,statut:d.status||"ACTIF",kyc_status:d.kyc||"INCOMPLET",plafond_engagement_kg:d.limitKg||null,plafond_financement_fcfa:d.limitFinance||null,raison_sociale:d.legalName||null,contacts_autorises:d.contacts||[],documents_legaux:d.documents||[],comptes_bancaires:d.banks||[],contrat_valide_au:d.contractUntil||null,motif_blocage:d.reason||null,updated_at:new Date().toISOString()},"supplier_code");
}
function addMarket(d){return client().from("rcn_proc_prix_marche").insert({id:id("MKT"),region:d.region,origine:d.origin||null,prix_kg:n(d.price),source:d.source,valable_du:d.from,valable_au:d.to}).then(function(r){if(r.error)throw r.error;return reload();});}
function createOrder(purchaseId,invoiceRef,invoiceDate){var p=(data.purchases||[]).filter(function(x){return x.id===purchaseId;})[0];if(!p||p.statut!=="APPROUVE")return Promise.reject(new Error("L’achat doit être approuvé par le GM."));
 return client().from("rcn_proc_bons_payer").upsert({id:id("BAP"),purchase_validation_id:p.id,reception_id:p.reception_id,supplier_code:p.supplier_code,supplier_name:p.supplier_name,montant_approuve:n(p.montant_approuve),facture_ref:invoiceRef||null,facture_date:invoiceDate||null,statut:"BROUILLON"},{onConflict:"purchase_validation_id"}).then(function(r){if(r.error)throw r.error;return reload();});
}
function updateOrder(id,status,comment){return client().from("rcn_proc_bons_payer").update({statut:status,commentaire:comment||null,updated_at:new Date().toISOString()}).eq("id",id).then(function(r){if(r.error)throw r.error;return reload();});}
function addPayment(d){return client().from("rcn_proc_paiements").insert({id:id("PAY"),bon_payer_id:d.orderId,montant:n(d.amount),mode:d.method,banque:d.bank||null,reference_bancaire:d.reference||null,date_paiement:d.date,preuve_url:d.proof||null,statut:"ENREGISTRE",motif:d.note||null}).then(function(r){if(r.error)throw r.error;return reload();});}
function reconcilePayment(id,ok,reason){return client().from("rcn_proc_paiements").update({statut:ok?"RAPPROCHE":"REJETE",motif:reason||null,rapproche_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).then(function(r){if(r.error)throw r.error;return reload();});}
function allocate(d){return client().from("rcn_proc_affectations_financement").upsert({id:id("AFF"),financement_id:d.financingId,purchase_validation_id:d.purchaseId,montant_affecte:n(d.amount)},{onConflict:"financement_id,purchase_validation_id"}).then(function(r){if(r.error)throw r.error;return reload();});}
function clamp(x){return Math.max(0,Math.min(100,x));}
function supplierScore(f){var cfg=data&&data.settings,w=cfg&&cfg.ponderations_score||{},q=cfg&&cfg.regles_qualite||{};if(!cfg||cfg.statut!=="VALIDE"||!Object.keys(w).length)return {score:null,status:"PARAMETRES_A_VALIDER",details:{}};var details={},sum=0,total=0,kor=n(f.kor_moyen),hum=n(f.humidite_moyenne),vol=n(f.volume_livre_kg),bags=global.RCN&&global.RCN.juteBalance?global.RCN.juteBalance(f.code).solde:0,account=global.RCNProc&&global.RCNProc.account?global.RCNProc.account(f.code,f.nom):{soldeFcfa:0,financeFcfa:0};
 if(w.kor){details.kor=q.kor_cible&&q.kor_min?clamp((kor-n(q.kor_min))/(n(q.kor_cible)-n(q.kor_min))*100):(kor?100:null);if(details.kor!=null){sum+=details.kor*n(w.kor);total+=n(w.kor);}}
 if(w.humidite){details.humidite=q.humidite_max?clamp(100-Math.max(0,hum-n(q.humidite_max))*n(q.penalite_humidite||20)):(hum?100:null);if(details.humidite!=null){sum+=details.humidite*n(w.humidite);total+=n(w.humidite);}}
 if(w.volume){details.volume=q.volume_cible_kg?clamp(vol/n(q.volume_cible_kg)*100):null;if(details.volume!=null){sum+=details.volume*n(w.volume);total+=n(w.volume);}}
 if(w.sacs){details.sacs=clamp(100-Math.max(0,n(bags))*n(q.penalite_sac||2));sum+=details.sacs*n(w.sacs);total+=n(w.sacs);}
 if(w.finance){details.finance=account.financeFcfa?clamp(100-(Math.max(0,n(account.soldeFcfa))/n(account.financeFcfa)*100)):100;sum+=details.finance*n(w.finance);total+=n(w.finance);}
 return {score:total?Math.round(sum/total*10)/10:null,status:total?"CALCULE":"DONNEES_INSUFFISANTES",details:details};
}
function stats(){var d=data||{},today=new Date(),pending=(d.purchases||[]).filter(function(x){return x.statut==="SOUMIS_GM";}),unpaid=(d.orders||[]).filter(function(x){return n(x.reste_a_payer)>0&&x.statut!=="ANNULE";}),blocked=(d.controls||[]).filter(function(x){return x.statut!=="ACTIF";}),expired=(d.controls||[]).filter(function(x){return x.contrat_valide_au&&new Date(x.contrat_valide_au)<today;});return {pending:pending.length,unpaid:unpaid.length,unpaidAmount:unpaid.reduce(function(t,x){return t+n(x.reste_a_payer);},0),blocked:blocked.length,expired:expired.length};}
global.RCNProcControl={load:load,ensure:ensure,data:function(){return data;},rows:rows,role:role,control:control,volume:volume,checkPrice:checkPrice,saveSettings:saveSettings,saveControl:saveControl,addMarket:addMarket,createOrder:createOrder,updateOrder:updateOrder,addPayment:addPayment,reconcilePayment:reconcilePayment,allocate:allocate,supplierScore:supplierScore,stats:stats};
})(window);

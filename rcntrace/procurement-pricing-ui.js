/* RCN TRACE — Interface additionnelle Prix d'achat.
   Isolée du cœur afin de préserver la stabilité de l'application. */
(function(global){
"use strict";
function E(v){return String(v==null?"":v).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function v(id){var x=document.getElementById(id);return x?x.value:"";}
function toast(m,bad){var t=document.getElementById("toast");if(!t){alert(m);return;}t.textContent=m;t.className="toast show"+(bad?" err":"");setTimeout(function(){t.className="toast";},2800);}
function suppliers(){return (global.RCN&&global.RCN.referentials().fournisseurs)||[];}
function supplierOptions(){return suppliers().map(function(f,i){return '<option value="'+i+'">'+E(f.lba+" · "+f.nom)+'</option>';}).join("");}
function engagementOptions(){return '<option value="">— Sans engagement —</option>'+global.RCN.procEngagements().filter(function(e){return e.statut==="ACTIF";}).map(function(e){return '<option value="'+E(e.id)+'">'+E(e.id+" · "+e.supplierNom)+'</option>';}).join("");}
function pbadge(s){var cl=s==="APPROUVE"?"b-ok":(s==="REFUSE"||s==="ANNULE"?"b-danger":(s==="SOUMIS_GM"||s==="A_CORRIGER"?"b-warn":"b-neutral"));return '<span class="badge '+cl+'">'+E(s)+'</span>';}
function render(){
 if(location.hash.replace("#","").split("/")[0]!=="procprix")return;
 var view=document.getElementById("view"),crumb=document.getElementById("crumb");if(!view)return;
 if(crumb)crumb.innerHTML='Prix d’achat & validations<small>Proposition BM, décision GM et prix officiel</small>';
 var P=global.RCNPricing;if(!P){view.innerHTML='<div class="alert">Moteur des prix indisponible.</div>';return;}
 var prices=P.rows();if(prices===null){view.innerHTML='<div class="pagehead"><h1>Prix d’achat & validations</h1></div><div class="card"><div class="empty">Chargement du registre sécurisé…</div></div>';P.ensure();return;}
 var st=P.stats(),role=P.role();
 var rows=prices.map(function(p){var action="—";
  if((p.statut==="BROUILLON"||p.statut==="A_CORRIGER")&&P.canSubmit())action='<button class="btn sm" onclick="RCNPriceUI.submit(\''+p.id+'\','+Number(p.prix_bm||p.prix_propose)+')">Soumettre au GM</button>';
  if(p.statut==="SOUMIS_GM"&&P.canDecide())action='<button class="btn sm" onclick="RCNPriceUI.decide(\''+p.id+'\',\'APPROUVE\','+Number(p.prix_bm||p.prix_propose)+')">Approuver</button> <button class="btn warn sm" onclick="RCNPriceUI.decide(\''+p.id+'\',\'A_CORRIGER\')">À corriger</button> <button class="btn danger sm" onclick="RCNPriceUI.decide(\''+p.id+'\',\'REFUSE\')">Refuser</button>';
  if(p.statut==="APPROUVE"&&P.canDecide())action='<button class="btn ghost sm" onclick="RCNPriceUI.close(\''+p.id+'\')">Clôturer</button>';
  return '<tr><td class="mono"><b>'+E(p.id)+'</b><small style="display:block;color:var(--n500)">v'+Number(p.version||1)+'</small></td><td><b>'+E(p.supplier_name)+'</b><small style="display:block;color:var(--n500)">'+E(p.supplier_code)+'</small></td><td class="mono">'+Number(p.prix_propose).toLocaleString("fr-FR")+'</td><td class="mono">'+(p.prix_bm==null?"—":Number(p.prix_bm).toLocaleString("fr-FR"))+'</td><td class="mono"><b>'+(p.prix_approuve==null?"—":Number(p.prix_approuve).toLocaleString("fr-FR"))+'</b></td><td>'+E(p.valide_du)+' → '+E(p.valide_au)+'</td><td>'+pbadge(p.statut)+'</td><td>'+action+'</td></tr>';
 }).join("")||'<tr><td colspan="8" class="empty">Aucune proposition de prix.</td></tr>';
 function k(label,num,sub,cls){return '<div class="kpi '+(cls||"")+'"><small>'+E(label)+'</small><b>'+E(num)+'</b><span>'+E(sub)+'</span></div>';}
 view.innerHTML='<div class="pagehead"><span class="eyebrow">Procurement · Prix approuvés</span><h1>Prix d’achat & validations</h1><p>Procurement prépare, le BM recommande, le GM décide. Seul le prix approuvé alimente la Réception.</p></div>'+
  '<div class="kpis">'+k("Propositions",st.total,"toutes versions","")+k("À préparer/corriger",st.draft,"action Procurement / BM",st.draft?"warn":"")+k("En attente GM",st.pending,"décision requise",st.pending?"danger":"")+k("Prix approuvés",st.active,"actifs ou à venir","")+'</div>'+
  '<div class="grid2" style="align-items:start"><div class="card"><h2>Nouvelle proposition</h2><div class="cbody"><div class="rule" style="margin:0 0 12px"><b>Votre rôle : '+E(role||"—")+'.</b> Le prix reste inutilisable tant que le GM ne l’a pas approuvé.</div>'+
  '<label>Fournisseur</label><select id="pp_supplier">'+supplierOptions()+'</select><label>Engagement lié</label><select id="pp_eng">'+engagementOptions()+'</select>'+
  '<div class="row"><div><label>Prix proposé (FCFA/kg)</label><input id="pp_price" type="number"></div><div><label>Volume négocié (kg)</label><input id="pp_qty" type="number"></div></div>'+
  '<div class="row"><div><label>KOR minimum</label><input id="pp_kor" type="number" value="47"></div><div><label>Humidité maximum (%)</label><input id="pp_hum" type="number" value="10"></div></div>'+
  '<div class="row"><div><label>Valide du</label><input id="pp_from" type="date"></div><div><label>Valide au</label><input id="pp_to" type="date"></div></div>'+
  '<div class="row"><div><label>Site</label><select id="pp_site">'+global.RCN.ENTREPOTS.map(function(x){return '<option value="'+E(x.code)+'">'+E(x.nom)+'</option>';}).join("")+'</select></div><div><label>Campagne</label><input id="pp_campaign" value="'+new Date().getFullYear()+'"></div></div>'+
  '<label>Justification / contexte du marché</label><textarea id="pp_reason" rows="3" placeholder="Prix marché, concurrence, qualité attendue, volume…"></textarea><div class="actions"><button class="btn" onclick="RCNPriceUI.create()">Créer le brouillon</button></div></div></div>'+
  '<div class="rule"><b>Règle de paiement.</b><br>Montant d’achat = poids payé × prix approuvé par le GM.<br><br>Un prix décidé ne peut pas être écrasé : toute modification exige une nouvelle version et une nouvelle validation.</div></div>'+
  '<div class="card" style="margin-top:18px"><h2>Registre des prix</h2><div class="cbody" style="padding:0"><div class="tablewrap"><table><thead><tr><th>Référence</th><th>Fournisseur</th><th>Proposé</th><th>BM</th><th>GM approuvé</th><th>Validité</th><th>Statut</th><th>Action</th></tr></thead><tbody>'+rows+'</tbody></table></div></div></div>';
 injectNav();
}
function injectNav(){
 var nav=document.getElementById("nav");if(!nav)return;
 if(!nav.querySelector('a[href="#procprix"]')){
  var links=nav.querySelectorAll("a"),after=null;Array.prototype.forEach.call(links,function(a){if(a.getAttribute("href")==="#procfin")after=a;});
  var a=document.createElement("a");a.href="#procprix";a.textContent="Prix d’achat & validations";if(after&&after.parentNode)after.parentNode.insertBefore(a,after.nextSibling);else nav.appendChild(a);
 }
 Array.prototype.forEach.call(nav.querySelectorAll("a"),function(a){a.classList.toggle("on",a.getAttribute("href")==="#procprix"&&location.hash.indexOf("#procprix")===0);});
}
function injectDashboard(){
 if(location.hash.indexOf("#procurement")!==0)return;
 var head=document.querySelector("#view .pagehead");if(!head||document.getElementById("priceShortcut"))return;
 var b=document.createElement("button");b.id="priceShortcut";b.className="btn";b.textContent="Prix d’achat & validations";b.onclick=function(){location.hash="procprix";};head.appendChild(b);
}
function priceForForm(){
 if(location.hash.indexOf("#reception/new")!==0)return;
 var sel=document.getElementById("f_fournisseur");if(!sel||document.getElementById("approvedPriceBox"))return;
 sel.addEventListener("change",refreshPrice);var box=document.createElement("div");box.id="approvedPriceBox";sel.parentNode.insertBefore(box,sel.nextSibling);refreshPrice();
}
function refreshPrice(){
 var sel=document.getElementById("f_fournisseur"),box=document.getElementById("approvedPriceBox");if(!sel||!box)return;
 var f=suppliers()[Number(sel.value)||0]||{},at=v("f_arrivee"),p=global.RCNPricing&&global.RCNPricing.activeFor(f.lba,at);
 box.className=p?"okbox":"alert";box.innerHTML=p?'<b>Prix officiel GM : '+Number(p.prix_approuve).toLocaleString("fr-FR")+' FCFA/kg</b><br>'+E(p.id+' · valide du '+p.valide_du+' au '+p.valide_au):'<b>Aucun prix GM actif pour ce fournisseur.</b><br>La réception sera bloquée jusqu’à validation du prix.';
}
var API={
 create:function(){var f=suppliers()[Number(v("pp_supplier"))||0]||{},reason=v("pp_reason");if(!v("pp_price")||!v("pp_from")||!v("pp_to")||!reason)return toast("Prix, période et justification sont obligatoires.",true);global.RCNPricing.create({supplierCode:f.lba,supplierName:f.nom,engagementId:v("pp_eng"),prixPropose:v("pp_price"),volumeKg:v("pp_qty"),korMin:v("pp_kor"),humiditeMax:v("pp_hum"),site:v("pp_site"),campagne:v("pp_campaign"),valideDu:v("pp_from"),valideAu:v("pp_to"),justification:reason}).then(function(){toast("Proposition créée.");render();}).catch(function(e){toast(e.message,true);});},
 submit:function(id,price){var p=prompt("Prix recommandé par le BM (FCFA/kg)",price);if(p===null)return;var c=prompt("Commentaire du BM / justification","")||"";global.RCNPricing.submit(id,p,c).then(function(){toast("Prix soumis au GM.");render();}).catch(function(e){toast(e.message,true);});},
 decide:function(id,d,price){var p=price;if(d==="APPROUVE"){p=prompt("Prix final approuvé par le GM (FCFA/kg)",price);if(p===null)return;}var c=prompt(d==="APPROUVE"?"Commentaire GM (facultatif)":"Commentaire GM obligatoire","")||"";if(d!=="APPROUVE"&&!c)return toast("Le commentaire GM est obligatoire.",true);global.RCNPricing.decide(id,d,p,c).then(function(){toast("Décision GM enregistrée.");render();}).catch(function(e){toast(e.message,true);});},
 close:function(id){if(!confirm("Clôturer ce prix approuvé ?"))return;global.RCNPricing.close(id,"EXPIRE","Clôture par le GM").then(function(){toast("Prix clôturé.");render();}).catch(function(e){toast(e.message,true);});},
 refresh:refreshPrice
};
function injectReceptionPrice(){
 var h=location.hash.replace("#","").split("/");if(h[0]!=="reception"||!h[1]||h[1]==="new")return;
 var rec=global.RCN.getRec(decodeURIComponent(h[1]));if(!rec||!rec.prixRef||document.getElementById("recPriceOfficial"))return;
 var card=document.querySelector("#view .card .cbody");if(!card)return;
 var paid=rec.dechargement&&rec.dechargement.poidsPaye!=null?Number(rec.dechargement.poidsPaye):null;
 var amount=paid==null?null:paid*Number(rec.prixApprouve||rec.prixUnitaire||0);
 var box=document.createElement("div");box.id="recPriceOfficial";box.className="okbox";
 box.innerHTML="<b>Prix officiel GM : "+Number(rec.prixApprouve||rec.prixUnitaire).toLocaleString("fr-FR")+" FCFA/kg</b><br>"+E(rec.prixRef)+(amount==null?"":"<br><b>Montant d’achat : "+amount.toLocaleString("fr-FR")+" FCFA</b>");
 card.appendChild(box);
}
function enhance(){setTimeout(function(){injectNav();injectDashboard();priceForForm();injectReceptionPrice();render();},30);}
function wrapReception(){
 if(!global.RCNUI||global.RCNUI.__priceWrapped)return;
 var old=global.RCNUI.createReception;
 global.RCNUI.createReception=function(){
  var f=suppliers()[Number(v("f_fournisseur"))||0]||{},p=global.RCNPricing&&global.RCNPricing.activeFor(f.lba,v("f_arrivee"));
  if(!p)return toast("Réception bloquée : aucun prix approuvé par le GM n’est valide pour ce fournisseur à cette date.",true);
  var orig=global.RCN.createReception;
  global.RCN.createReception=function(d){d.prixUnitaire=p.prix_approuve;var r=orig(d);r.prixRef=p.id;r.prixApprouve=Number(p.prix_approuve);r.prixValideDu=p.valide_du;r.prixValideAu=p.valide_au;global.RCN.save();return r;};
  try{return old();}finally{global.RCN.createReception=orig;}
 };
 var oldArrival=global.RCNUI.arriveProc;
 global.RCNUI.arriveProc=function(id){
  var a=global.RCN.procArrivages().filter(function(x){return x.id===id;})[0],p=a&&global.RCNPricing&&global.RCNPricing.activeFor(a.supplierLba,new Date());
  if(!p)return toast("Arrivée bloquée : aucun prix approuvé par le GM n’est actif pour ce fournisseur.",true);
  var orig=global.RCN.receptionFromProcArrivage;
  global.RCN.receptionFromProcArrivage=function(x){var r=orig(x);r.prixUnitaire=Number(p.prix_approuve);r.prixRef=p.id;r.prixApprouve=Number(p.prix_approuve);r.prixValideDu=p.valide_du;r.prixValideAu=p.valide_au;global.RCN.save();return r;};
  try{return oldArrival(id);}finally{global.RCN.receptionFromProcArrivage=orig;}
 };
 global.RCNUI.__priceWrapped=true;
}
global.RCNPriceUI=API;
global.addEventListener("hashchange",enhance);
var timer=setInterval(function(){if(global.RCNUI&&global.RCN){clearInterval(timer);wrapReception();global.RCNPricing.ensure().then(enhance);enhance();}},80);
})(window);

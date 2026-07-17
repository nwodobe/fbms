/* RCN TRACE — Calculs Procurement V2
   Aucune donnée fournisseur n'est intégrée à ce fichier public. */
(function (global) {
  "use strict";
  function R() { return global.RCN; }
  function n(v) { var x=Number(v); return isFinite(x)?x:0; }
  function same(r,lba,nom){ return (lba && r.lba===lba) || (!lba && r.fournisseur===nom); }
  function delivered(lba,nom,opt){
    opt=opt||{}; var rows=R().receptions().filter(function(r){
      if(!same(r,lba,nom)||r.source==="inter-entrepôt") return false;
      if(opt.engagementId && r.procEngagementId!==opt.engagementId) return false;
      if(opt.campagne && String(new Date(r.arriveeAt||r.createdAt||0).getFullYear())!==String(opt.campagne)) return false;
      return true;
    }), volume=0,accepted=0,value=0;
    rows.forEach(function(r){var d=r.dechargement||{},net=n(d.net),paid=d.poidsPaye==null?net:n(d.poidsPaye),price=n(r.prixUnitaire);volume+=net;if(r.etat===R().ETAT_REC.LIBERE){accepted+=net;value+=paid*price;}});
    return {livraisons:rows.length,volumeKg:volume,accepteKg:accepted,valeurFcfa:value,receptions:rows};
  }
  function coverage(fin){
    var fs=R().procFinancements().filter(function(f){return f.statut==="APPROUVÉ"&&((fin.supplierLba&&f.supplierLba===fin.supplierLba)||(!fin.supplierLba&&f.supplierNom===fin.supplierNom));})
      .slice().sort(function(a,b){return new Date(a.decaisseAt||a.createdAt||0)-new Date(b.decaisseAt||b.createdAt||0);});
    var eng={};fs.forEach(function(f){if(f.engagementId)eng[f.engagementId]=true;});
    var hasEng=Object.keys(eng).length>0;
    var credit=delivered(fin.supplierLba,fin.supplierNom).receptions.reduce(function(t,r){if(hasEng&&!eng[r.procEngagementId])return t;var d=r.dechargement||{},net=n(d.net),paid=d.poidsPaye==null?net:n(d.poidsPaye);return t+(r.etat===R().ETAT_REC.LIBERE?paid*n(r.prixUnitaire):0);},0);
    var rem=credit,cov=0;fs.some(function(f){var p=Math.min(n(f.montant),Math.max(0,rem));rem-=p;if(f.id===fin.id){cov=p;return true;}return false;});
    return {financeFcfa:n(fin.montant),couvertFcfa:cov,expositionFcfa:Math.max(0,n(fin.montant)-cov)};
  }
  function account(lba,nom){
    var lines=[];
    R().procFinancements().filter(function(f){return f.statut==="APPROUVÉ"&&((lba&&f.supplierLba===lba)||(!lba&&f.supplierNom===nom));}).forEach(function(f){lines.push({at:f.decaisseAt||f.createdAt,type:"FINANCEMENT",ref:f.id,debit:n(f.montant),credit:0,engagementId:f.engagementId||null});});
    delivered(lba,nom).receptions.forEach(function(r){if(r.etat!==R().ETAT_REC.LIBERE)return;var d=r.dechargement||{},net=n(d.net),paid=d.poidsPaye==null?net:n(d.poidsPaye);lines.push({at:r.arriveeAt||r.createdAt,type:"LIVRAISON",ref:r.lotId||r.id,debit:0,credit:paid*n(r.prixUnitaire),engagementId:r.procEngagementId||null});});
    lines.sort(function(a,b){return new Date(a.at||0)-new Date(b.at||0);});var bal=0;lines.forEach(function(l){bal+=l.debit-l.credit;l.solde=bal;});
    return {lignes:lines,soldeFcfa:bal,financeFcfa:lines.reduce(function(t,l){return t+l.debit;},0),livreFcfa:lines.reduce(function(t,l){return t+l.credit;},0)};
  }
  function summary(){
    var active=R().procEngagements().filter(function(e){return e.statut==="ACTIF";});
    var promised=active.reduce(function(t,e){return t+n(e.volumeKg);},0);
    var received=active.reduce(function(t,e){return t+delivered(e.supplierLba,e.supplierNom,{engagementId:e.id,campagne:e.campagne}).accepteKg;},0);
    var approved=R().procFinancements().filter(function(f){return f.statut==="APPROUVÉ";});
    var financed=approved.reduce(function(t,f){return t+n(f.montant);},0),covered=approved.reduce(function(t,f){return t+coverage(f).couvertFcfa;},0);
    return {promisKg:promised,livreKg:received,restantKg:Math.max(0,promised-received),financeFcfa:financed,couvertFcfa:Math.min(financed,covered),expositionFcfa:Math.max(0,financed-covered),arrivages7j:R().procArrivages().filter(function(a){if(!a.prevuAt||a.statut!=="ANNONCÉ")return false;var x=new Date(a.prevuAt).getTime()-Date.now();return x>=0&&x<=604800000;}).length};
  }
  global.RCNProc={delivered:delivered,coverage:coverage,account:account,summary:summary};
})(window);

/* RCN TRACE — Exports Procurement (Excel + rapport imprimable PDF)
   Les données sont lues à l'exécution après authentification. */
(function (global) {
  "use strict";
  function esc(v){return String(v==null?"":v).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function money(v){return Number(v||0).toLocaleString("fr-FR")+" FCFA";}
  function kg(v){return Number(v||0).toLocaleString("fr-FR")+" kg";}
  function date(v){if(!v)return "—";var d=new Date(v);return isNaN(d)?String(v):d.toLocaleDateString("fr-FR");}
  function data(){
    var R=global.RCN,P=global.RCNProc,s=P?P.summary():R.procurementSummary();
    var suppliers=(global.RCNSync&&global.RCNSync.suppliers&&global.RCNSync.suppliers())||[];
    return {R:R,P:P,s:s,suppliers:suppliers,eng:R.procEngagements(),fin:R.procFinancements(),arr:R.procArrivages(),generated:new Date()};
  }
  function requireAuth(){
    return !!(global.RCNSync&&global.RCNSync.status&&global.RCNSync.status().hasSession);
  }
  function exportExcel(){
    if(!requireAuth()){alert("Connexion requise pour exporter les données Procurement.");return;}
    if(!global.XLSX){alert("Le moteur Excel n'est pas encore chargé. Actualisez la page puis réessayez.");return;}
    var d=data(),X=global.XLSX,wb=X.utils.book_new();
    function add(name,rows){var ws=X.utils.json_to_sheet(rows);ws["!cols"]=Object.keys(rows[0]||{}).map(function(k){return {wch:Math.min(34,Math.max(12,k.length+3))};});X.utils.book_append_sheet(wb,ws,name);}
    add("Synthèse",[
      {"Indicateur":"Volume promis (kg)","Valeur":d.s.promisKg},
      {"Indicateur":"Volume livré lié (kg)","Valeur":d.s.livreKg},
      {"Indicateur":"Reste à livrer (kg)","Valeur":d.s.restantKg},
      {"Indicateur":"Financements approuvés (FCFA)","Valeur":d.s.financeFcfa},
      {"Indicateur":"Valeur couverte (FCFA)","Valeur":d.s.couvertFcfa},
      {"Indicateur":"Exposition (FCFA)","Valeur":d.s.expositionFcfa},
      {"Indicateur":"Arrivées sous 7 jours","Valeur":d.s.arrivages7j}
    ]);
    add("Engagements",d.eng.map(function(e){var x=d.P?d.P.delivered(e.supplierLba,e.supplierNom,{engagementId:e.id,campagne:e.campagne}):{accepteKg:0};return {
      "Référence":e.id,"Code fournisseur":e.supplierLba,"Fournisseur":e.supplierNom,"Campagne":e.campagne,"Type":e.type,
      "Volume promis kg":e.volumeKg,"Volume livré lié kg":x.accepteKg,"Reste kg":Math.max(0,Number(e.volumeKg||0)-Number(x.accepteKg||0)),
      "Prix prévu FCFA/kg":e.prixKg,"KOR minimum":e.korMin,"Humidité max %":e.humiditeMax,"Site":e.site,"Échéance":e.echeance,"Statut":e.statut
    };}));
    add("Financements",d.fin.map(function(f){var x=d.P?d.P.coverage(f):{couvertFcfa:0,expositionFcfa:f.montant};return {
      "Référence":f.id,"Engagement":f.engagementId,"Code fournisseur":f.supplierLba,"Fournisseur":f.supplierNom,"Banque":f.banque,
      "Référence paiement":f.reference,"Montant FCFA":f.montant,"Couvert FCFA":x.couvertFcfa,"Exposition FCFA":x.expositionFcfa,
      "Décaissement":f.decaisseAt,"Échéance":f.echeance,"Statut":f.statut,"Approuvé par":f.approuvePar
    };}));
    add("Arrivées",d.arr.map(function(a){return {
      "Référence":a.id,"Engagement":a.engagementId,"Code fournisseur":a.supplierLba,"Fournisseur":a.supplierNom,"Camion":a.camion,
      "Chauffeur":a.chauffeur,"Téléphone":a.telephone,"Volume annoncé kg":a.volumeKg,"Sacs":a.sacs,"Site":a.site,
      "Date prévue":a.prevuAt,"Statut":a.statut,"Réception créée":a.recId
    };}));
    add("Fournisseurs",d.suppliers.map(function(f){return {
      "Code":f.code,"Fournisseur":f.nom,"Catégorie":f.categorie,"Sites":(f.sites||[]).join(", "),"Livraisons":f.nb_livraisons,
      "Volume livré kg":f.volume_livre_kg,"Sacs":f.sacs_livres,"KOR moyen":f.kor_moyen,"Humidité moyenne %":f.humidite_moyenne,
      "Nut Count moyen":f.nut_count_moyen,"Première livraison":f.premiere_livraison,"Dernière livraison":f.derniere_livraison
    };}));
    var stamp=d.generated.toISOString().slice(0,10);
    X.writeFile(wb,"RCN_TRACE_Procurement_"+stamp+".xlsx",{compression:true});
  }
  function table(headers,rows){
    return '<table><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>';}).join("")+'</tr></thead><tbody>'+ rows.map(function(r){return '<tr>'+r.map(function(v){return '<td>'+esc(v)+'</td>';}).join("")+'</tr>';}).join("")+'</tbody></table>';
  }
  function exportPdf(){
    if(!requireAuth()){alert("Connexion requise pour exporter les données Procurement.");return;}
    var d=data(),w=global.open("","_blank");
    if(!w){alert("Autorisez les fenêtres contextuelles pour générer le PDF.");return;}
    var engagementRows=d.eng.map(function(e){var x=d.P?d.P.delivered(e.supplierLba,e.supplierNom,{engagementId:e.id,campagne:e.campagne}):{accepteKg:0};return [e.id,e.supplierNom,kg(e.volumeKg),kg(x.accepteKg),kg(Math.max(0,Number(e.volumeKg||0)-Number(x.accepteKg||0))),e.echeance||"—"];});
    var financeRows=d.fin.map(function(f){var x=d.P?d.P.coverage(f):{couvertFcfa:0,expositionFcfa:f.montant};return [f.id,f.supplierNom,money(f.montant),money(x.couvertFcfa),money(x.expositionFcfa),f.statut];});
    var html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport Procurement</title><style>'+ '@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#26352d;margin:0}header{background:#053b23;color:white;padding:22px;border-radius:10px}h1{margin:0 0 5px;font-size:25px}header p{margin:0;color:#cfe3d3}.k{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.k div{border:1px solid #dce8df;border-radius:9px;padding:12px}.k small{display:block;color:#6c7d72;text-transform:uppercase;font-size:9px}.k b{display:block;color:#053b23;font-size:18px;margin-top:4px}h2{color:#053b23;font-size:16px;margin:22px 0 8px}table{width:100%;border-collapse:collapse;font-size:9px}th{background:#e8f3eb;text-align:left;color:#053b23}th,td{padding:7px;border:1px solid #dfe7e1}footer{margin-top:16px;color:#77847b;font-size:9px}.no-print{position:fixed;right:15px;top:15px;background:#8dc556;color:#053b23;border:0;border-radius:8px;padding:10px 16px;font-weight:bold;cursor:pointer}@media print{.no-print{display:none}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}</style></head><body>'+ '<button class="no-print" onclick="window.print()">Enregistrer en PDF</button><header><h1>RCN TRACE · Rapport Procurement</h1><p>ANAGROCI / PJS Global · Généré le '+esc(d.generated.toLocaleString("fr-FR"))+'</p></header>'+ '<div class="k"><div><small>Volume promis</small><b>'+kg(d.s.promisKg)+'</b></div><div><small>Volume livré lié</small><b>'+kg(d.s.livreKg)+'</b></div><div><small>Reste à livrer</small><b>'+kg(d.s.restantKg)+'</b></div>'+ '<div><small>Financements approuvés</small><b>'+money(d.s.financeFcfa)+'</b></div><div><small>Valeur couverte</small><b>'+money(d.s.couvertFcfa)+'</b></div><div><small>Exposition</small><b>'+money(d.s.expositionFcfa)+'</b></div></div>'+ '<h2>Engagements fournisseurs</h2>'+table(["Réf.","Fournisseur","Promis","Livré lié","Reste","Échéance"],engagementRows)+ '<h2>Financements et exposition FIFO</h2>'+table(["Réf.","Fournisseur","Financé","Couvert","Exposition","Statut"],financeRows)+ '<footer>Document confidentiel · Les données proviennent de la base sécurisée RCN TRACE.</footer></body></html>';
    w.document.open();w.document.write(html);w.document.close();w.focus();
  }
  global.RCNProcExport={excel:exportExcel,pdf:exportPdf};
})(window);

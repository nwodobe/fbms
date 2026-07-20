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
    var suppliers=(global.RCNSync&&
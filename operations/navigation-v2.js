/* Operations Suite v2 — navigation interne sans retour vers les anciens shells. */
(function(global){
'use strict';
var page=(document.body&&document.body.dataset&&document.body.dataset.workspace)||'';
var defs={
 field:{title:'FIELD BUYING',routes:[['overview','Vue d’ensemble'],['purchases','Achat Bord Champ'],['farmers','Farmer Registry'],['rt','RT & Villages'],['bags','Sacherie AFLP'],['cash','Caisse & Avances'],['command','Command Center'],['logistics','Cartographie & Logistique'],['sustainability','Sustainability'],['traceability','Traceability']]},
 lba:{title:'LBA PURCHASE',routes:[['overview','Vue d’ensemble'],['registry','LBA Registry'],['purchases','Achats RCN'],['limits','Limites de financement'],['financing','Financements'],['cycles','Cycles de financement'],['deliveries','Livraisons RCN'],['bags','Gestion sacherie'],['balances','Balances'],['aging','Aging & Alertes'],['performance','Performance'],['documents','Documents'],['audit','Audit']]},
 warehouse:{title:'WAREHOUSE OPERATIONS',routes:[['overview','Overview'],['inbound','Inbound'],['quality','Quality'],['lots','RCN Lots'],['bins','Stock & BIN'],['drying','Drying / Sorting'],['bags','Bag Management'],['inventory','Inventory'],['audit','Audit']]},
 transfer:{title:'STOCK TRANSFER',routes:[['overview','Overview'],['requests','Requests'],['ready','Ready to Load'],['transit','In Transit'],['arrivals','Arrivals'],['reconciliation','Reconciliation'],['audit','Audit']]},
 factory:{title:'FACTORY',routes:[['overview','Overview'],['reception','Factory Reception'],['warehouse','Factory Warehouse'],['bins','Factory BIN'],['processing','Processing'],['calibration','Calibration'],['mass-balance','Mass Balance'],['audit','Audit']]},
 trace:{title:'TRACEABILITY 360',routes:[]},reports:{title:'REPORTS & EXPORT',routes:[]}
};
function esc(v){return String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function route(){return (location.hash||'#overview').slice(1).split('/')[0]||'overview';}
function ensureChrome(){
 var main=document.querySelector('.ops-main'); if(!main)return;
 if(!document.getElementById('opsPortalLink')){
   var a=document.createElement('a');a.id='opsPortalLink';a.className='ops-portal-link';a.href='../index.html';a.innerHTML='← Portail Operations';main.insertBefore(a,main.firstChild);
 }
 if(!document.getElementById('opsBreadcrumbs')){
   var b=document.createElement('div');b.id='opsBreadcrumbs';b.className='ops-breadcrumbs';var link=document.getElementById('opsPortalLink');link.insertAdjacentElement('afterend',b);
 }
}
function renderNav(){
 var d=defs[page]; if(!d)return;
 var side=document.getElementById('opsSidebar');
 if(side&&d.routes.length){var r=route();side.innerHTML='<div class="ops-side-head">'+esc(d.title)+'</div><nav class="ops-nav">'+d.routes.map(function(x){return '<a class="'+(r===x[0]?'active':'')+'" href="#'+x[0]+'"><span class="nav-dot"></span>'+esc(x[1])+'</a>';}).join('')+'</nav>';}
 var bc=document.getElementById('opsBreadcrumbs'); if(bc){var label=(d.routes.filter(function(x){return x[0]===route();})[0]||['',d.title])[1];bc.innerHTML='<a href="../index.html">Portail</a><span class="sep">›</span><a href="#overview">'+esc(d.title)+'</a>'+(label&&label!==d.title?'<span class="sep">›</span><strong>'+esc(label)+'</strong>':'');}
}
function harmonizeActions(){
 document.querySelectorAll('.ops-actions a[href*="rcntrace/index.html"],.ops-actions a[href*="terrain/traceability.html"]').forEach(function(a){
   if(page==='lba')a.href='#'+(a.textContent.toLowerCase().indexOf('sacher')>=0?'bags':'registry');
   else if(page==='warehouse')a.href='#inbound';
   else if(page==='transfer')a.href='#requests';
   else if(page==='factory')a.href='#reception';
   else if(page==='trace')a.href='../index.html';
   else if(page==='reports')a.href= a.textContent.toLowerCase().indexOf('procurement')>=0 ? 'lba-purchase.html#overview' : 'traceability.html';
 });
}
function makeActionOverflow(){
 document.querySelectorAll('.ops-pagehead .ops-actions').forEach(function(bar){var els=[].slice.call(bar.children);if(els.length<=3)return;var extra=els.slice(2);var box=document.createElement('div');box.className='ops-overflow';box.innerHTML='<button type="button" class="btn secondary" aria-expanded="false">⋯ Plus d’actions</button><div class="ops-overflow-menu"></div>';extra.forEach(function(e){box.querySelector('.ops-overflow-menu').appendChild(e);});bar.appendChild(box);box.querySelector('button').addEventListener('click',function(ev){ev.stopPropagation();box.classList.toggle('open');this.setAttribute('aria-expanded',box.classList.contains('open')?'true':'false');});});
 document.addEventListener('click',function(){document.querySelectorAll('.ops-overflow.open').forEach(function(x){x.classList.remove('open');});},{once:true});
}
function init(){ensureChrome();renderNav();harmonizeActions();makeActionOverflow();}
window.addEventListener('hashchange',function(){renderNav();if(global.ANAGROCI_OPS_ROUTE)global.ANAGROCI_OPS_ROUTE();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
global.ANAGROCI_OPS_NAV={route:route,render:renderNav,defs:defs};
})(window);

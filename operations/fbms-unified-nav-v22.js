
// The only app-level menu is the six-space menu; legacy operation workspaces keep
// their context actions, but their second nav shell is replaced.
/* FBMS V2.2 - one shared navigation across bord-champ workspaces.
 * Read-only navigation UI. Authorization stays server-side.
 * Do not treat invisible menu entries as RLS permission checks.
 */
(function(global){
'use strict';
var MENU=[
 {id:'E0',fr:'Ma journée',en:'My day',icon:'⌂',items:[
  ['Accueil','Home','../index.html'],
  ['Missions & carburant','Missions & fuel','../moto/index.html','external'],
  ['Preuves terrain','Field evidence','../fieldproof/index.html','external']]},
 {id:'E1',fr:'Réseau',en:'Field network',icon:'♧',items:[
  ['Producteurs','Farmers','field-buying.html#farmers'],
  ['Représentants RT','RT representatives','field-buying.html#rt'],
  ['Villages & clusters','Villages & clusters','field-buying.html#census'],
  ['Coopératives','Cooperatives','field-buying.html#cooperatives'],
  ['Carte des villages','Village map','field-buying.html#hubs']]},
 {id:'E2',fr:'Terrain',en:'Field activities',icon:'✿',items:[
  ['Durabilité','Sustainability','field-buying.html#sustainability'],
  ['Photos et vidéos','Photos & videos','../fieldproof/index.html','external'],
  ['Missions terrain','Field missions','../moto/index.html','external']]},
 {id:'E3',fr:'Achats & comptes RT',en:'Buying & RT accounts',icon:'▣',items:[
  ['Achats RCN','RCN buying','field-buying.html#purchases'],
  ['Caisse & avances','Cash & advances','field-buying.html#cash'],
  ['Sacherie RT','RT bags','field-buying.html#bags'],
  ['Bilan RT à imprimer','Print RT reconciliation','rt-sop-weekly-print.html','document']]},
 {id:'E4',fr:'Expédition',en:'Dispatch',icon:'⇢',items:[
  ['Lots & départs','Lots & dispatch','procurement.html#evacuations'],
  ['Rapprochement','Reconciliation','procurement.html#reconciliation']]},
 {id:'E5',fr:'Pilotage & administration',en:'Management & settings',icon:'▦',items:[
  ['Tableau de bord','Dashboard','field-buying.html#overview'],
  ['Alertes terrain','Field alerts','field-buying.html#command'],
  ['Rapports et exports','Reports & export','reports.html'],
  ['AFLP DATA','AFLP DATA','aflp-data.html'],
  ['Campagnes','Campaigns','campaigns.html'],
  ['Traçabilité','Traceability','traceability.html'],
  ['Comptes et rôles','Users & roles','../shared/admin.html','external']]}
];
var ROLE={BM:['E0','E1','E2','E3','E4','E5'],ABM:['E0','E1','E2','E3','E4','E5'],
 UH:['E0','E1','E2','E3','E4','E5'],AUH:['E0','E1','E2','E3'],
 ZH:['E0','E1','E2','E3','E4','E5'],LOG:['E0','E1','E3','E4','E5'],
 FIN:['E0','E3','E5'],RO:['E0','E1','E2','E5']};
var MAP={BRANCH_MANAGER:'BM',ZONAL_HEAD:'ZH',UNIT_HEAD:'UH',ASSISTANT_UNIT_HEAD:'AUH',
 LOGISTICS_COORDINATOR:'LOG',FINANCE_CONTROLLER:'FIN',LEGACY_ASSISTANT_BM:'ABM',
 READ_ONLY_AUDIT:'RO',WAREHOUSE_KEEPER:'RO',RT_FIELD_PARTNER:'RO'};
var ROLE_NAME={BM:'Branch Manager',ABM:'Assistant Branch Manager',UH:'Unit Head',
 AUH:'Assistant Unit Head',ZH:'Zonal Head',LOG:'Logistics',FIN:'Finance',RO:'Consultation'};
function role(){
 var p=global.ANAGROCI_AUTH&&global.ANAGROCI_AUTH.profile;
 var name=p&&p.role||'',code='';
 try{var normalized=global.AFLP_ACCESS&&global.AFLP_ACCESS.role(name);
  code=normalized&&normalized.code||'';}catch(e){}
 if(!code&&global.ANAGROCI_AUTH&&global.ANAGROCI_AUTH.estBM)code='BRANCH_MANAGER';
 return MAP[code]||'RO';
}
function language(){try{return localStorage.getItem('anagroci_lang')==='en'?'en':'fr';}catch(e){return 'fr';}}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(x){
 return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]})}
function canonical(path){var url=new URL(path,global.location.href);
 return url.pathname.replace(/\/+/g,'/')+'#'+(url.hash||'').slice(1);
}
function pathId(){
 var file=global.location.pathname.split('/').pop(),hash=(global.location.hash||'').toLowerCase();
 if(/\/fieldproof\//.test(global.location.pathname))return 'E2';
 if(/\/moto\//.test(global.location.pathname))return 'E0';
 if(file==='espaces.html'||file==='index.html')return 'E0';
 if(file==='procurement.html')return 'E4';
 if(file==='reports.html'||file==='aflp-data.html'||file==='campaigns.html'||file==='traceability.html')return 'E5';
 if(file==='field-buying.html'){
  if(/#(farmers|rt|census|cooperatives|hubs)/.test(hash))return 'E1';
  if(/#sustainability/.test(hash))return 'E2';
  if(/#(purchases|cash|bags)/.test(hash))return 'E3';
  if(/#(overview|command|sync|aflp-data|traceability)/.test(hash))return 'E5';
  return 'E0';
 }
 return 'E0';
}
function hrefInApp(path){
 // One URL convention from the operations directory, including root index.html.
 var dir=global.location.pathname.replace(/[^/]*$/,'');
 var root=/(?:\/)(operations|moto|fieldproof|shared)\/$/.test(dir)?dir.replace(/(?:operations|moto|fieldproof|shared)\/$/,''):dir;
 var base=new URL(root+'operations/',global.location.origin);
 // This app also runs under GitHub Pages /fbms/, so paths resolve relative to base.
 return new URL(path,base).pathname+new URL(path,base).search+new URL(path,base).hash;
}
function ensureShell(){
 var side=document.getElementById('opsSidebar');
 if(side)return side;
 // Adapt older reports/campaigns/trace pages and specialized field apps.
 var main=document.querySelector('body > main.ops-main, #motoApp > main.mm-main, body > main.fp-main');
 if(!main)return null;
 var shell=document.createElement('div');shell.className='ops-shell';
 if(main.matches('.mm-main,.fp-main'))document.body.classList.add('fbms-v22-specialized');
 main.parentNode.insertBefore(shell,main);
 side=document.createElement('aside');side.className='ops-sidebar';side.id='opsSidebar';
 side.setAttribute('aria-label','Navigation principale FBMS');
 shell.appendChild(side);shell.appendChild(main);
 main.style.maxWidth='';main.style.margin='';main.style.width='';
 return side;
}
function render(){
 var host=ensureShell();
 if(!host)return;
 var r=role(),en=language()==='en',active=pathId(),file=global.location.pathname.split('/').pop();
 if(!ROLE[r].includes(active))active='E0';
 var header='<div class="fbms-v22-logo"><span class="fbms-v22-mark" aria-hidden="true">P</span><span><strong>FBMS</strong><small>ANAGROCI · AFLP 2027</small></span></div>';
 var links=MENU.filter(function(s){return ROLE[r].includes(s.id)}).map(function(s){
  var isActive=s.id===active;
  var target=s.items[0][2];
  var top=s.id==='E0'?'../index.html':target;
  var topLabel=(en?s.en:s.fr);
  var block='<a class="fbms-v22-main'+(isActive?' active':'')+'" href="'+esc(hrefInApp(top))+'"'+(isActive?' aria-current="page"':'')+'>'+
    '<span aria-hidden="true" class="fbms-v22-icon">'+s.icon+'</span>'+esc(topLabel)+'</a>';
  if(isActive){
   block+='<div class="fbms-v22-context">';
   s.items.forEach(function(x){
    if(x[3]==='document'&&r==='RO')return;
    if(x[0]==='Comptes et rôles'&&r!=='BM')return;
    if(x[0]==='Campagnes'&&r!=='BM'&&r!=='ABM')return;
    if(s.id==='E3'&&(x[0]==='Achats RCN')&&r==='FIN')return;
    var label=en?x[1]:x[0],href=hrefInApp(x[2]),absolute=new URL(href,global.location.href);
    var selected=file===absolute.pathname.split('/').pop()&&global.location.hash===absolute.hash;
    block+='<a class="fbms-v22-action'+(selected?' selected':'')+'" href="'+esc(href)+'"'+
      (x[3]==='document'?' target="_blank" rel="noopener"':'')+'>'+
      esc(label)+(x[3]==='external'?' <span aria-label="Service distinct">↗</span>':'')+'</a>';
   });
   // Specialized apps retain their original route logic and permissions,
   // but their native *navigation bar* is hidden: route links live here.
   var special=s.id==='E0'?'#motoNav':s.id==='E2'?'nav.fp-nav':null;
   if(special && ((s.id==='E0'&&/\/moto\//.test(global.location.pathname)) ||
                 (s.id==='E2'&&/\/fieldproof\//.test(global.location.pathname)))){
     var nativeNav=document.querySelector(special);
     if(nativeNav){
       Array.prototype.forEach.call(nativeNav.querySelectorAll('a[href^="#"]'),function(a){
         var item=global.location.pathname+a.getAttribute('href');
         var selected=a.getAttribute('href')===global.location.hash;
         block+='<a class="fbms-v22-action'+(selected?' selected':'')+
           '" href="'+esc(item)+'">'+esc(a.textContent.replace(/\s+/g,' ').trim())+'</a>';
       });
     }
   }
   block+='</div>';
  }
  return block;
 }).join('');
 host.classList.add('fbms-v22-side');
 host.innerHTML=header+'<nav class="fbms-v22-navigation" aria-label="'+(en?'FBMS navigation':'Navigation unique FBMS')+'">'+links+'</nav>'+
  '<div class="fbms-v22-bottom">AFLP · '+esc(ROLE_NAME[r])+'</div>';
 document.body.classList.add('fbms-v22');
 var old=document.getElementById('opsPortalLink');
 if(old)old.remove();
 var bc=document.getElementById('opsBreadcrumbs');
 if(bc){var item=MENU.filter(function(s){return s.id===active})[0];
  bc.innerHTML='<span>FBMS</span><span class="sep">›</span><strong>'+esc(en?item.en:item.fr)+'</strong>';}
 ensureMobileToggle();
}
function ensureMobileToggle(){
 if(document.getElementById('fbmsMenuToggle'))return;
 var host=document.querySelector('.ops-main,.esp-main,.mm-main,.fp-main');
 if(!host)return;
 var btn=document.createElement('button');
 btn.id='fbmsMenuToggle';btn.type='button';btn.className='fbms-v22-toggle';
 btn.setAttribute('aria-label','Ouvrir le menu FBMS');btn.setAttribute('aria-expanded','false');
 btn.setAttribute('aria-controls','opsSidebar');btn.textContent='☰  Menu';
 var overlay=document.createElement('div');overlay.id='fbmsMenuVeil';overlay.className='fbms-v22-veil';
 host.insertBefore(btn,host.firstChild);document.body.appendChild(overlay);
 function close(){document.body.classList.remove('fbms-v22-open');btn.setAttribute('aria-expanded','false');}
 btn.addEventListener('click',function(){
  var open=!document.body.classList.contains('fbms-v22-open');
  document.body.classList.toggle('fbms-v22-open',open);btn.setAttribute('aria-expanded',String(open));});
 overlay.addEventListener('click',close);
 var sidebar=document.getElementById('opsSidebar');
 if(sidebar)sidebar.addEventListener('click',function(e){if(e.target.closest('a'))close()});
 document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
}
function init(){
 render();
 // Fleet writes role-filtered route links asynchronously after auth.
 // Observe link insertion only; the original nav remains mounted for the
 // Fleet controller but it is not displayed as a competing navigation.
 var moto=document.getElementById('motoNav');
 if(moto && typeof MutationObserver!=='undefined'){
   var observer=new MutationObserver(function(list){
     if(list.some(function(m){return m.type==='childList'}))render();
   });
   observer.observe(moto,{childList:true});
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
document.addEventListener('anagroci:authenticated',render);
document.addEventListener('anagroci:language',render);
global.addEventListener('hashchange',render);
global.FBMS_UNIFIED_NAV={MENU:MENU,ROLES:ROLE,MAP:MAP,role:role,pathId:pathId,render:render};
})(window);
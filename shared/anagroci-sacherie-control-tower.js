/* ANAGROCI Operations Suite - Sacherie AFLP - Control Tower metier */
(function(){
'use strict';
if(window.__ANAGROCI_SACHERIE_CT)return;window.__ANAGROCI_SACHERIE_CT=true;
var SB=null,DATA=null,TAB='pilotage',FILTER={cluster:'',rt:'',q:'',from:'',to:'',state:'',page:1},COUNTS={requests:0,losses:0,expiring:0};
var TABS=[['pilotage','Pilotage'],['reseau','Réseau'],['flux','Flux'],['parc','État du parc'],['controles','Contrôles']];
function $(id){return document.getElementById(id);}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function n(v){var x=Number(v||0);return Number.isFinite(x)?x:0;}
function fmt(v){return n(v).toLocaleString('fr-FR');}
function dt(v){if(!v)return 'Jamais';try{return new Date(v).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'});}catch(e){return String(v);}}
function age(v){if(!v)return 'âge inconnu';var ms=Date.now()-new Date(v).getTime();if(!Number.isFinite(ms))return 'âge inconnu';var m=Math.max(0,Math.floor(ms/60000));if(m<60)return 'il y a '+m+' min';var h=Math.floor(m/60);return h<48?'il y a '+h+' h':'il y a '+Math.floor(h/24)+' j';}
function days(v){if(!v)return null;var x=(Date.now()-new Date(v).getTime())/86400000;return Number.isFinite(x)?Math.max(0,Math.floor(x)):null;}
function client(){if(SB)return SB;if(window.supabase&&window.ANAGROCI_SUPABASE_URL&&window.ANAGROCI_SUPABASE_ANON)SB=window.supabase.createClient(window.ANAGROCI_SUPABASE_URL,window.ANAGROCI_SUPABASE_ANON);return SB;}
function audit(action,details){try{window.ANAGROCI_AUDIT&&window.ANAGROCI_AUDIT.log(action,details||{});}catch(e){}}
function riskRank(s){return {CRITIQUE:4,ATTENTION:3,SURVEILLANCE:2,NORMAL:1}[String(s||'').toUpperCase()]||0;}
function normalizedStatus(s){s=String(s||'NORMAL').toUpperCase();if(['CRITIQUE','ATTENTION','SURVEILLANCE','NORMAL'].indexOf(s)>=0)return s;if(/FAIL|CRIT|BLOCK/.test(s))return 'CRITIQUE';if(/WARN|RISQUE|HOLD/.test(s))return 'ATTENTION';return 'NORMAL';}
function status(s){s=normalizedStatus(s);var c=s==='CRITIQUE'?'bad':s==='ATTENTION'?'warn':s==='SURVEILLANCE'?'watch':'ok';return '<span class="ct-pill '+c+'">'+esc(s)+'</span>';}
function stateLabel(s){return ({UTILISABLE:'Vide',PLEIN:'Plein',EN_TRANSIT:'En transit',DECHIRE:'Abîmé',A_REPARER:'À réparer',REPARE:'Réparé',REFORME:'Rebut',HUMIDE:'Humide',A_CLASSER:'À classer'})[s]||s||'—';}
function locLabel(code){if(!code)return 'Extérieur';return String(code).replace(/^AFLP-CL-/,'Cluster ').replace(/^AFLP-RT-/,'RT ').replace(/^AFLP-PROD-/,'Producteur ').replace(/^AFLP-HUB-/,'Hub ').replace(/^AFLP-FACTORY-/,'Usine ');}
function stockTerrain(){return (DATA.rts||[]).reduce(function(t,r){return t+n(r.total_sous_responsabilite);},0);}
function transitAncien(){var a=DATA.transit_aging||{};return a.over_7d_qty==null?null:n(a.over_7d_qty);}
function ecartOuvert(){return openGaps().reduce(function(t,i){return t+Math.abs(n(i.difference_qty));},0);}
function immobilise(){var g=DATA.global||{};return n(g.dechires)+n(g.a_reparer)+n(g.rebut);}
function latestMoves(){return (DATA.movements||[]).slice().sort(function(a,b){return new Date(b.movement_at||0)-new Date(a.movement_at||0);}).slice(0,5);}
function scoreRT(r){var s=0,detail=[];var imm=n(r.dechires)+n(r.a_reparer)+n(r.rebut),d=days(r.derniere_activite);if(n(r.total_sous_responsabilite)<0){s+=45;detail.push('stock incohérent');}if(imm){s+=Math.min(25,5+Math.round(imm/50));detail.push(fmt(imm)+' immobilisé(s)');}if(d!=null&&d>14){s+=20;detail.push('activité '+d+' j');}else if(d!=null&&d>7){s+=10;detail.push('activité '+d+' j');}if(normalizedStatus(r.risk_level)==='CRITIQUE')s=Math.max(s,75);if(normalizedStatus(r.risk_level)==='ATTENTION')s=Math.max(s,45);return {score:Math.min(100,s),detail:detail.join(' · ')||'aucun signal majeur'};}
function riskFromScore(v){return v>=75?'CRITIQUE':v>=45?'ATTENTION':v>=20?'SURVEILLANCE':'NORMAL';}
/* ============================ Validations partagées ==========================
   Un seul endroit pour les règles de saisie, de transition et de preuve. Les
   trois formulaires (inventaire, état, perte) et le workflow de dotation les
   consomment via window.ANAGROCI_SACHERIE_CT.helpers : deux listes divergentes
   finissent toujours par diverger pour de bon. */

/* Une saisie vide n'est PAS zéro. `Number('')` vaut 0, et c'est ainsi qu'un
   champ laissé vide devenait un comptage physique à zéro — donc un écart
   massif inventé de toutes pièces. */
function parseBagQty(raw,opts){
opts=opts||{};
var brut=raw==null?'':String(raw).trim();
if(brut==='')return {ok:false,error:opts.emptyMessage||'Quantité obligatoire. Saisissez le nombre de sacs réellement comptés.'};
if(!/^[+-]?\d+$/.test(brut)){
  if(/^[+-]?\d*[.,]\d+$/.test(brut))return {ok:false,error:'La quantité de sacs doit être un nombre entier.'};
  return {ok:false,error:'Quantité invalide : saisissez un nombre entier de sacs.'};
}
var v=Number(brut);
if(!Number.isFinite(v)||!Number.isInteger(v))return {ok:false,error:'La quantité de sacs doit être un nombre entier.'};
var min=opts.min==null?0:opts.min;
if(v<min)return {ok:false,error:min>0?'La quantité doit être supérieure à zéro.':'La quantité ne peut pas être négative.'};
if(opts.max!=null&&v>opts.max)return {ok:false,error:'Quantité supérieure au stock disponible : '+fmt(opts.max)+' sac(s).'};
return {ok:true,value:v};
}

/* Transitions d'état : une seule table, qui pilote à la fois les options
   proposées et la validation avant appel serveur. Le serveur reste l'autorité
   finale ; l'interface ne doit simplement plus proposer l'impossible. */
var TRANSITIONS={DECHIRE:['A_REPARER','REFORME'],A_REPARER:['REPARE','REFORME'],REPARE:['UTILISABLE'],REFORME:[],UTILISABLE:[],PLEIN:[],EN_TRANSIT:[]};
function transitionTargets(from){return (TRANSITIONS[String(from||'').toUpperCase()]||[]).slice();}
function transitionAllowed(from,to){
from=String(from||'').toUpperCase();to=String(to||'').toUpperCase();
if(!from||!to)return {ok:false,error:'État de départ et état d’arrivée requis.'};
if(from===to)return {ok:false,error:'L’état d’arrivée doit être différent de l’état de départ.'};
if(transitionTargets(from).indexOf(to)<0)return {ok:false,error:'Transition interdite : '+stateLabel(from)+' → '+stateLabel(to)+'. Passez par les étapes de contrôle prévues.'};
return {ok:true};
}

/* Pièce justificative : l'attribut accept d'un input file est une suggestion,
   pas un contrôle. On vérifie extension, type MIME et taille. */
var EVIDENCE_MAX=1572864;
var EVIDENCE_TYPES={'jpg':['image/jpeg'],'jpeg':['image/jpeg'],'png':['image/png'],'pdf':['application/pdf']};
function validateEvidenceFile(f){
if(!f)return {ok:true,value:null};
var nom=String(f.name||''),pt=nom.lastIndexOf('.'),ext=pt<0?'':nom.slice(pt+1).toLowerCase();
if(!Object.prototype.hasOwnProperty.call(EVIDENCE_TYPES,ext))return {ok:false,error:'Format refusé : seuls JPG, PNG et PDF sont acceptés.'};
var mime=String(f.type||'').toLowerCase();
if(mime&&EVIDENCE_TYPES[ext].indexOf(mime)<0)return {ok:false,error:'Le contenu du fichier ne correspond pas à son extension. Fichier refusé.'};
if(!mime)return {ok:false,error:'Type de fichier non reconnu par le navigateur. Fichier refusé.'};
if(!(Number(f.size)>0))return {ok:false,error:'Fichier vide ou illisible.'};
if(Number(f.size)>EVIDENCE_MAX)return {ok:false,error:'Pièce justificative trop volumineuse : maximum 1,5 Mo.'};
return {ok:true,value:f};
}

/* Un message serveur n'est pas un message utilisateur : « permission denied for
   function … » nomme une fonction Postgres et n'aide personne sur le terrain. */
function friendlyError(err){
var raw=String((err&&err.message)||(err&&err.details)||err||'');
try{if(window.ANAGROCI_AUDIT&&typeof window.ANAGROCI_AUDIT.friendlyServerError==='function'){var f=window.ANAGROCI_AUDIT.friendlyServerError(err);if(f&&!/permission denied|relation |function /i.test(f))return f;}}catch(e){}
var low=raw.toLowerCase();
if(/permission denied|row-level security|not authorized|policy/.test(low))return 'Action refusée par vos droits d’accès. Votre fonction ne permet pas cette opération sur ce périmètre.';
if(/does not exist|undefined function|schema cache/.test(low))return 'Cette fonction n’est pas encore activée sur cette base. Contactez le Branch Manager.';
if(/insuffis|negative|négatif|stock/.test(low))return 'Opération bloquée : le stock disponible ne permet pas cette quantité.';
if(/motif|reason|justif/.test(low))return 'Un motif est obligatoire pour cette opération.';
if(/timeout/.test(low))return 'Le serveur n’a pas répondu dans le délai imparti. Les chiffres affichés ne sont pas à jour.';
if(/failed to fetch|networkerror|réseau|network/.test(low))return 'Réseau indisponible. Réessayez une fois la connexion revenue.';
if(/jwt|expired|session/.test(low))return 'Session expirée. Reconnectez-vous pour continuer.';
return 'Opération impossible. Réessayez, puis signalez le problème si elle échoue à nouveau.';
}

/* Inventaires : ne retenir que le DERNIER comptage par périmètre. Cumuler tout
   l'historique faisait grossir l'écart « ouvert » à chaque nouveau comptage,
   même après régularisation. */
function inventoryKey(i){return [String(i.cluster||''),String(i.scope_type||''),String(i.rt_id||''),String(i.state||'')].join('|');}
function inventoryResolved(i){var st=String(i.status||i.reconciliation_status||'').toUpperCase();return st==='RESOLU'||st==='RESOLVED'||st==='CLOS'||st==='CLOSED'||st==='NORMAL'||st==='OK';}
function latestInventories(){
var m={};
(DATA&&DATA.inventories||[]).forEach(function(i){
  var k=inventoryKey(i),prev=m[k];
  if(!prev||new Date(i.counted_at||0)>new Date(prev.counted_at||0))m[k]=i;
});
return Object.keys(m).map(function(k){return m[k];});
}
function openGaps(){return latestInventories().filter(function(i){return n(i.difference_qty)!==0&&!inventoryResolved(i);});}

/* « Disponibles en Cluster » : ce que le management peut encore doter depuis
   les magasins cluster. Somme d'un champ canonique (stock_cluster_vide), pas
   d'une formule inventée. Les manques constatés au dernier comptage et non
   régularisés sont retirés — le stock canonique ne les a pas encore absorbés,
   donc il n'y a pas de double décompte. */
function clusterAvailable(){
var brut=(DATA&&DATA.clusters||[]).reduce(function(t,c){return t+n(c.stock_cluster_vide);},0);
var manque=openGaps().reduce(function(t,i){
  var scope=String(i.scope_type||'').toUpperCase();
  if(scope&&scope.indexOf('CLUSTER')<0)return t;
  if(String(i.state||'').toUpperCase()!=='UTILISABLE')return t;
  var d=n(i.difference_qty);
  return d<0?t+Math.abs(d):t;
},0);
return {brut:brut,manque:manque,value:Math.max(0,brut-manque)};
}
function css(){if($('ctStyle'))return;var s=document.createElement('style');s.id='ctStyle';s.textContent='\
#sacherieApp{font-family:"IBM Plex Sans",Arial,sans-serif;display:flex;flex-direction:column;gap:12px}#sacherieApp button,#sacherieApp select,#sacherieApp input{font:inherit}.ct-nav{display:flex;gap:3px;overflow:auto;background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:5px;position:sticky;top:6px;z-index:20;box-shadow:0 3px 12px rgba(5,59,35,.05)}.ct-tab{white-space:nowrap;min-height:44px;border:0;background:transparent;padding:9px 13px;border-radius:8px;color:#6F746F;font-weight:800;cursor:pointer}.ct-tab[aria-selected="true"]{background:#E5F4DF;color:#053B23}.ct-tab:focus-visible,.ct-link:focus-visible,.ct-action:focus-visible,.ct-kpi[role="button"]:focus-visible,.ct-alert:focus-visible{outline:3px solid #8DC556;outline-offset:2px}.ct-badge{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:10px;background:#C0392B;color:#fff;font-size:11px;margin-left:5px;padding:0 5px}.ct-decision{background:#fff;border:1px solid #E8E7E7;border-left:7px solid #C0392B;border-radius:11px;padding:12px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.ct-decision strong{color:#053B23}.ct-decision-items{display:flex;gap:7px;flex-wrap:wrap}.ct-decision button{min-height:36px;border:0;background:#FFF4F2;color:#8F2D22;border-radius:999px;padding:7px 10px;font-weight:750;cursor:pointer}.ct-decision .ok{background:#F1F9EF;color:#1C7A3F;padding:6px 9px;border-radius:999px}.ct-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.ct-kpi{background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:13px 14px;min-width:0}.ct-kpi small{display:block;color:#6F746F;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.ct-kpi b{display:block;font:800 23px Archivo,Arial;color:#053B23;margin:5px 0 2px;font-variant-numeric:tabular-nums}.ct-kpi span{font-size:11px;color:#747A75}.ct-kpi.ct-click{cursor:pointer}.ct-kpi.ct-click:hover{border-color:#8DC556}.ct-kpi.danger b{color:#B23A2A}.ct-kpi.warning b{color:#9A6500}.ct-grid{display:grid;grid-template-columns:1.08fr .92fr;gap:12px}.ct-card{background:#fff;border:1px solid #E8E7E7;border-radius:12px;padding:15px;min-width:0}.ct-card h2{font:750 16px Archivo,Arial;color:#053B23;margin:0 0 4px}.ct-card h3{font:750 14px Archivo,Arial;color:#053B23;margin:16px 0 7px}.ct-hint{margin:0 0 12px;color:#747A75;font-size:12px;line-height:1.45}.ct-section-state{padding:22px;text-align:center;color:#747A75;background:#fff;border:1px dashed #D2D0D0;border-radius:11px}.ct-section-state.good{background:#F1F9EF;color:#1C7A3F}.ct-section-state.bad{color:#8F2D22;background:#FFF4F2}.ct-alert{width:100%;text-align:left;border:1px solid #F0D38B;background:#FFF9EA;border-radius:9px;padding:10px;margin-bottom:7px;cursor:pointer}.ct-alert.critical{border-color:#F0C3BC;background:#FFF4F2}.ct-alert b{display:block;color:#323131;font-size:12px}.ct-alert small{color:#747A75}.ct-total{font-size:11px;color:#747A75;margin-top:6px}.ct-tools{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.ct-tools select,.ct-tools input{min-height:40px;border:1px solid #D2D0D0;border-radius:8px;padding:7px 9px;background:#fff}.ct-tools input{min-width:190px}.ct-action{min-height:40px;border:0;border-radius:8px;padding:8px 11px;background:#008F37;color:#fff;font-weight:800;cursor:pointer}.ct-action.ghost{background:#fff;color:#053B23;border:1px solid #D2D0D0}.ct-link{border:0;background:none;color:#00712C;text-decoration:underline;font-weight:800;cursor:pointer;padding:2px}.ct-table{overflow:auto}.ct-table table{width:100%;border-collapse:collapse;font-size:12px;min-width:680px}.ct-table th{text-align:left;color:#5F665F;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #008F37;padding:9px 7px;white-space:nowrap}.ct-table td{padding:9px 7px;border-bottom:1px solid #EEEEEC;vertical-align:top}.ct-table td.num,.ct-table th.num{text-align:right;font-variant-numeric:tabular-nums}.ct-pill{display:inline-block;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:850}.ct-pill.ok{background:#E3F5E8;color:#1C7A3F}.ct-pill.watch{background:#EEF4E9;color:#55733C}.ct-pill.warn{background:#FDEFCE;color:#80600F}.ct-pill.bad{background:#FDECE9;color:#A83225}.ct-breadcrumb{font-size:12px;color:#6F746F;margin-bottom:9px}.ct-pagination{display:flex;justify-content:flex-end;gap:7px;align-items:center;margin-top:10px;font-size:12px;color:#6F746F}.ct-activity{display:grid;gap:7px}.ct-activity-row{display:grid;grid-template-columns:82px 1fr auto;gap:10px;padding:8px 0;border-bottom:1px solid #EEEEEC;align-items:baseline}.ct-activity-row time{font-size:11px;color:#747A75}.ct-activity-row b{font-size:12px}.ct-360{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0}.ct-360 div{background:#F7FAF6;border:1px solid #E8E7E7;border-radius:9px;padding:10px}.ct-360 small{display:block;color:#747A75}.ct-360 b{display:block;color:#053B23;font-size:18px;margin-top:3px}.ct-note{font-size:11px;color:#6F746F;background:#F7FAF6;border-radius:8px;padding:9px;margin-top:10px}@media(max-width:1000px){.ct-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.ct-360{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:850px){.ct-grid{grid-template-columns:1fr}.ct-table table{min-width:620px}.ct-nav{top:4px}}@media(max-width:520px){.ct-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.ct-kpi b{font-size:20px}.ct-tab{padding:9px 10px}.ct-card{padding:12px}.ct-tools>*{flex:1 1 140px}.ct-table th{font-size:11px}.ct-activity-row{grid-template-columns:70px 1fr}.ct-activity-row b{grid-column:2}}';document.head.appendChild(s);}
var TAB_INVALIDE='';
function readUrl(){try{var p=new URLSearchParams(location.search),t=p.get('tab');TAB_INVALIDE=(t&&!TABS.some(function(x){return x[0]===t;}))?t:'';TAB=TABS.some(function(x){return x[0]===t;})?t:'pilotage';['cluster','rt','q','from','to','state'].forEach(function(k){FILTER[k]=p.get(k)||'';});FILTER.page=Math.max(1,Number(p.get('page'))||1);}catch(e){TAB='pilotage';}}
function writeUrl(){try{var u=new URL(location.href);u.searchParams.set('tab',TAB);['cluster','rt','q','from','to','state'].forEach(function(k){FILTER[k]?u.searchParams.set(k,FILTER[k]):u.searchParams.delete(k);});FILTER.page>1?u.searchParams.set('page',String(FILTER.page)):u.searchParams.delete('page');history.replaceState(null,'',u);}catch(e){}}
function mount(){var root=$('sacherieApp');if(!root)return;css();readUrl();root.innerHTML='<div class="ct-nav" role="tablist" aria-label="Navigation Sacherie">'+TABS.map(function(t){return '<button type="button" class="ct-tab" role="tab" data-tab="'+t[0]+'" aria-selected="'+(TAB===t[0]?'true':'false')+'">'+t[1]+(t[0]==='flux'?'<span id="ctDecisionBadge" class="ct-badge" hidden>0</span>':'')+'</button>';}).join('')+'</div><div id="ctDecisionBand"></div><div id="ctBody"><div class="ct-section-state">Chargement des données réelles…</div></div>';root.addEventListener('click',onRootClick);root.addEventListener('keydown',onRootKey);root.addEventListener('change',onRootChange);root.addEventListener('input',onRootInput);var op=$('sacNewOperation');if(op)op.onclick=function(){if(window.ANAGROCI_SACHERIE_CT_ACTIONS&&window.ANAGROCI_SACHERIE_CT_ACTIONS.open)window.ANAGROCI_SACHERIE_CT_ACTIONS.open('menu',{});else setTab('controles');};load();}
function actionable(target){return target.closest('[data-cluster-reset],[data-tab],[data-cluster],[data-rt],[data-drill],[data-decision],[data-operation],[data-export],[data-page],[data-clear-rt],[data-retry]');}
function activate(el){if(!el)return;if(el.dataset.retry)return load();if(el.dataset.clusterReset!==undefined){FILTER.cluster='';FILTER.rt='';writeUrl();return render();}if(el.dataset.tab)return setTab(el.dataset.tab);if(el.dataset.decision)return openDecisions(el.dataset.decision);if(el.dataset.operation)return openOperation(el.dataset.operation,el.dataset.cluster||'',el.dataset.rt||'',el.dataset.state||'');if(el.dataset.export)return exportTable(el.dataset.export);if(el.dataset.page){FILTER.page=Math.max(1,Number(el.dataset.page)||1);writeUrl();return render();}if(el.dataset.clearRt!==undefined){FILTER.rt='';writeUrl();return render();}if(el.dataset.drill)return drill(el.dataset.drill,el.dataset.cluster||'',el.dataset.rt||'',el.dataset.state||'');if(el.dataset.rt)return openRT(el.dataset.rt);if(el.dataset.cluster)return openCluster(el.dataset.cluster);}
function onRootClick(e){activate(actionable(e.target));}
function onRootKey(e){if(e.target.id==='ctMoveSearch'&&e.key==='Enter'){e.preventDefault();FILTER.q=e.target.value;FILTER.page=1;writeUrl();render();return;}if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role="button"][data-drill]')){e.preventDefault();activate(e.target);}}
function onRootChange(e){var el=e.target;if(el.id==='ctClusterFilter'){FILTER.cluster=el.value;FILTER.rt='';FILTER.page=1;}else if(el.id==='ctMoveState'){FILTER.state=el.value;FILTER.page=1;}else if(el.id==='ctMoveFrom'){FILTER.from=el.value;FILTER.page=1;}else if(el.id==='ctMoveTo'){FILTER.to=el.value;FILTER.page=1;}else if(el.id==='ctMoveSearch'){FILTER.q=el.value;FILTER.page=1;}else return;writeUrl();render();}
function onRootInput(e){if(e.target.id!=='ctMoveSearch')return;FILTER.q=e.target.value;FILTER.page=1;writeUrl();}
var LAST_OK=null,SYNC='init';
function hhmm(v){try{return new Date(v).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});}catch(e){return '—';}}
/* Le bandeau reflète la dernière actualisation RÉUSSIE, pas l'ouverture de la
   page. Un manager doit voir immédiatement qu'il regarde des données figées. */
function setSync(state,detail){
SYNC=state;
var up=$('sacUpdatedLabel');if(!up)return;
var t=LAST_OK?hhmm(LAST_OK):null;
if(state==='ok'){up.textContent='🟢 Synchronisé · mis à jour à '+t;up.className='sac-sync ok';}
else if(state==='offline'){up.textContent='🔴 Hors ligne · vous consultez des données enregistrées'+(t?' à '+t:' précédemment');up.className='sac-sync off';}
else if(state==='stale'){up.textContent='🟠 Données non actualisées'+(t?' · dernière mise à jour réussie à '+t:' · aucune donnée chargée');up.className='sac-sync stale';}
else{up.textContent='Chargement…';up.className='sac-sync';}
up.setAttribute('title',detail||'');
up.setAttribute('role','status');
}
function retryBar(message){
return '<div class="ct-section-state bad"><b>'+esc(message)+'</b>'+(LAST_OK?'<div style="margin-top:6px;font-size:12px">Les chiffres affichés datent de '+esc(hhmm(LAST_OK))+'. Ne décidez pas sur cette base sans actualiser.</div>':'')+'<div style="margin-top:10px"><button type="button" class="ct-action" data-retry="1">Réessayer</button></div></div>';
}
/* Réglable pour la recette ; 15 s en exploitation. Sans délai de garde, une
   requête qui ne revient jamais laisse « Chargement… » à l'écran pour
   toujours — c'est le pire des trois états, parce qu'il n'alerte personne. */
function timeoutMs(){var v=Number(window.ANAGROCI_SACHERIE_TIMEOUT_MS);return Number.isFinite(v)&&v>0?v:15000;}
function avecDelai(promesse){
return new Promise(function(res,rej){
  var fini=false;
  var t=setTimeout(function(){if(!fini){fini=true;rej(new Error('timeout: le serveur n’a pas répondu dans le délai imparti.'));}},timeoutMs());
  Promise.resolve(promesse).then(function(v){if(!fini){fini=true;clearTimeout(t);res(v);}},function(e){if(!fini){fini=true;clearTimeout(t);rej(e);}});
});
}
async function load(){
var c=client();
if(!c){setSync('stale','client indisponible');return sectionError('Module de sécurité non chargé. Rechargez la page.');}
if(!navigator.onLine){setSync('offline','navigateur hors ligne');if(!DATA)sectionError('Vous êtes hors ligne et aucune donnée n’a encore été chargée sur cet appareil.');else banner();return;}
setSync('init');
try{
  var r=await avecDelai(c.rpc('sacherie_ct_snapshot'));
  if(r.error)throw r.error;
  DATA=r.data||{};
  LAST_OK=DATA.generated_at||new Date().toISOString();
  setSync('ok');
  render();
}catch(e){
  var brut=String((e&&e.message)||e);
  try{console.error('[sacherie] échec du chargement du registre :',e);}catch(x){}
  setSync('stale',brut);
  if(DATA){render();banner(friendlyError(e));}
  else sectionError(friendlyError(e),true);
}
}
/* Données déjà à l'écran mais actualisation échouée : on ne remplace pas le
   contenu, on l'ourle d'un avertissement — effacer priverait le manager de ce
   qu'il regardait sans rien lui apprendre. */
function banner(message){
var b=$('ctBody');if(!b)return;
var old=$('ctStaleBanner');if(old)old.remove();
var d=document.createElement('div');d.id='ctStaleBanner';
d.innerHTML=retryBar(message||'Actualisation impossible : vous consultez des données enregistrées.');
b.insertBefore(d,b.firstChild);
}
function sectionError(t,retry){var b=$('ctBody');if(b)b.innerHTML=retry?retryBar(t):'<div class="ct-section-state bad">'+esc(t)+'</div>';}
function setTab(t){if(!TABS.some(function(x){return x[0]===t;}))return;TAB=t;FILTER.page=1;writeUrl();document.querySelectorAll('.ct-tab').forEach(function(x){x.setAttribute('aria-selected',String(x.dataset.tab===TAB));});render();}
function setCounts(d){COUNTS.requests=n(d&&d.requests);COUNTS.losses=n(d&&d.losses);COUNTS.expiring=n(d&&d.expiring);updateDecisionBand();}
function updateDecisionBand(){var badge=$('ctDecisionBadge'),band=$('ctDecisionBand'),total=COUNTS.requests+COUNTS.losses+COUNTS.expiring;if(badge){badge.textContent=String(total);badge.hidden=!total;}if(!band)return;var parts=[];if(COUNTS.requests)parts.push('<button type="button" data-decision="requests">'+fmt(COUNTS.requests)+' demande(s) en attente</button>');if(COUNTS.losses)parts.push('<button type="button" data-decision="losses">'+fmt(COUNTS.losses)+' perte(s) à décider</button>');if(COUNTS.expiring)parts.push('<button type="button" data-decision="expiring">'+fmt(COUNTS.expiring)+' approbation(s) proche(s) de l’échéance</button>');band.innerHTML='<div class="ct-decision"><strong>À décider</strong><div class="ct-decision-items">'+(parts.length?parts.join(''):'<span class="ok">Aucune décision signalée</span>')+'</div></div>';}
function kpi(label,value,sub,cls,drill){var shown=value==null?'—':fmt(value);return '<div class="ct-kpi '+(cls||'')+(drill?' ct-click':'')+'"'+(drill?' data-drill="'+esc(drill)+'" role="button" tabindex="0"':'')+'><small>'+esc(label)+'</small><b>'+shown+'</b><span>'+esc(sub||'sacs')+'</span></div>';}
function alerts(){var a=DATA.alerts||[];if(!a.length)return '<div class="ct-section-state good">Aucune exception active.</div>';var rows=a.slice().sort(function(x,y){var rr=riskRank(y.severity)-riskRank(x.severity);if(rr)return rr;return new Date(x.created_at||x.opened_at||0)-new Date(y.created_at||y.opened_at||0);});return rows.slice(0,9).map(function(x){return '<button class="ct-alert '+(normalizedStatus(x.severity)==='CRITIQUE'?'critical':'')+'" type="button" data-drill="alert" data-cluster="'+esc(x.cluster||'')+'"><b>'+esc(x.message)+'</b><small>'+esc(x.cluster||'Global')+' · '+esc(normalizedStatus(x.severity))+' · '+age(x.created_at||x.opened_at||x.generated_at)+'</small></button>';}).join('')+'<div class="ct-total">'+fmt(a.length)+' exception(s) active(s) au total</div>';}
function activity(){var ms=latestMoves();if(!ms.length)return '<div class="ct-section-state">Aucun mouvement récent.</div>';return '<div class="ct-activity">'+ms.map(function(m){return '<div class="ct-activity-row"><time>'+esc(age(m.movement_at))+'</time><span>'+esc(m.cluster||'Global')+(m.rt_id?' · '+esc(m.rt_id):'')+' · '+esc(m.reference||m.movement_type||'Mouvement')+'</span><b>'+fmt(m.qty)+' sacs</b></div>';}).join('')+'</div><button class="ct-link" data-tab="flux" type="button">Journal complet des mouvements →</button>';}
function pilotage(){var g=DATA.global||{},cs=DATA.clusters||[],imm=immobilise(),terrain=stockTerrain(),oldTransit=transitAncien(),gap=ecartOuvert();var rows=cs.slice().sort(function(x,y){return riskRank(y.status)-riskRank(x.status);}).slice(0,8).map(function(c){return '<tr><td>'+status(c.status)+'</td><td><button class="ct-link" type="button" data-cluster="'+esc(c.cluster)+'">'+esc(c.cluster)+'</button></td><td class="num">'+fmt(c.total_reseau||n(c.stock_cluster_vide)+n(c.stock_chez_rt)+n(c.stock_chez_producteur)+n(c.stock_hub_plein))+'</td><td class="num">'+fmt(n(c.stock_chez_rt)+n(c.stock_chez_producteur))+'</td><td class="num">'+(c.inventory_gap==null?'—':fmt(c.inventory_gap))+'</td></tr>';}).join('')||'<tr><td colspan="5">Aucun stock cluster.</td></tr>';var dispo=clusterAvailable();
var disponSub=dispo.manque?'en magasin cluster · '+fmt(dispo.manque)+' retiré(s) pour écart non régularisé':'en magasin cluster, hors RT et producteurs';
/* Un KPI sans donnée serveur n'est pas un KPI : tant que l'ancienneté du
   transit n'est pas fournie, on ne montre pas une carte vide permanente. */
var cards=kpi('Parc total',g.total,'tous états','','all')
 +kpi('Disponibles en Cluster',dispo.value,disponSub,'','UTILISABLE')
 +kpi('Sous responsabilité terrain',terrain,'RT et producteurs','','terrain')
 +kpi('Parc immobilisé',imm,'abîmés, réparation, rebut',imm?'danger':'','immobilise')
 +(oldTransit==null?'':kpi('Transit > 7 jours',oldTransit,'à confirmer / régulariser',oldTransit>0?'warning':'','old_transit'))
 +kpi('Écarts absolus ouverts',gap,'somme des écarts non régularisés',gap?'danger':'','inventory');
return '<div class="ct-kpis">'+cards+'</div><div class="ct-grid"><div class="ct-card"><h2>Exceptions</h2><p class="ct-hint">Priorité : gravité puis ancienneté. L’objectif est de piloter par exception.</p>'+alerts()+'</div><div class="ct-card"><h2>Réseau condensé</h2><p class="ct-hint">Risque en premier ; détail complet dans Réseau.</p><div class="ct-table"><table><thead><tr><th scope="col">Risque</th><th scope="col">Cluster</th><th scope="col" class="num">Parc</th><th scope="col" class="num">Terrain</th><th scope="col" class="num">Écart</th></tr></thead><tbody>'+rows+'</tbody></table></div><button class="ct-link" data-tab="reseau" type="button">Voir tout le réseau →</button></div></div><div class="ct-card"><h2>Activité récente</h2><p class="ct-hint">Les cinq derniers mouvements significatifs du registre.</p>'+activity()+'</div>';}
function clusterOptions(){return '<option value="">Tous les clusters</option>'+(DATA.clusters||[]).map(function(c){return '<option value="'+esc(c.cluster)+'" '+(FILTER.cluster===String(c.cluster)?'selected':'')+'>'+esc(c.cluster)+'</option>';}).join('');}
function rt360(r){if(!r)return '';var sc=scoreRT(r),inv=(DATA.inventories||[]).filter(function(i){return String(i.rt_id||'')===String(r.rt_id||'');}).sort(function(a,b){return new Date(b.counted_at||0)-new Date(a.counted_at||0);})[0],moves=(DATA.movements||[]).filter(function(m){return String(m.rt_id||'')===String(r.rt_id||'');}).slice(0,5);var imm=n(r.dechires)+n(r.a_reparer)+n(r.rebut);return '<div class="ct-card"><div class="ct-breadcrumb"><button class="ct-link" data-clear-rt type="button">Réseau</button> › '+esc(r.cluster||'—')+' › '+esc(r.rt_nom||r.rt_id)+'</div><h2>Fiche RT 360°</h2><p class="ct-hint">Responsabilité, santé du parc, fraîcheur des contrôles et mouvements récents.</p><div class="ct-360"><div><small>Risque indicatif</small><b>'+sc.score+'/100</b>'+status(riskFromScore(sc.score))+'</div><div><small>Sous responsabilité</small><b>'+fmt(r.total_sous_responsabilite)+'</b></div><div><small>Vides / Pleins</small><b>'+fmt(r.vides)+' / '+fmt(r.pleins)+'</b></div><div><small>Immobilisés</small><b>'+fmt(imm)+'</b></div><div><small>Dernière activité</small><b style="font-size:14px">'+esc(age(r.derniere_activite))+'</b></div><div><small>Dernier inventaire</small><b style="font-size:14px">'+esc(inv?age(inv.counted_at):'Aucun')+'</b></div><div><small>Écart inventaire</small><b>'+(inv?fmt(inv.difference_qty):'—')+'</b></div><div><small>Cycle financé OPEN</small><b>'+fmt(r.volume_finance_kg_open)+' kg</b></div></div><div class="ct-note"><b>Lecture du score :</b> '+esc(sc.detail)+'. Ce score est un indicateur d’orientation, pas une décision serveur.</div><div class="ct-tools" style="margin-top:12px"><button class="ct-action" data-operation="inventory" data-cluster="'+esc(r.cluster||'')+'" data-rt="'+esc(r.rt_id||'')+'">Faire un inventaire</button><button class="ct-action ghost" data-operation="state" data-cluster="'+esc(r.cluster||'')+'" data-rt="'+esc(r.rt_id||'')+'" data-state="DECHIRE">Traiter le parc</button><button class="ct-action ghost" data-drill="rt" data-cluster="'+esc(r.cluster||'')+'" data-rt="'+esc(r.rt_id||'')+'">Voir les mouvements</button></div><h3>Mouvements récents du RT</h3>'+(moves.length?'<div class="ct-table"><table><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col" class="num">Qté</th><th scope="col">Référence</th></tr></thead><tbody>'+moves.map(function(m){return '<tr><td>'+dt(m.movement_at)+'</td><td>'+esc(m.movement_type||m.source_type||'—')+'</td><td class="num">'+fmt(m.qty)+'</td><td>'+esc(m.reference||'—')+'</td></tr>';}).join('')+'</tbody></table></div>':'<div class="ct-section-state">Aucun mouvement pour ce RT.</div>')+'</div>';}
function reseau(){var rs=(DATA.rts||[]).filter(function(r){return !FILTER.cluster||String(r.cluster)===FILTER.cluster;}).map(function(r){var sc=scoreRT(r);r.__score=sc.score;r.__risk=riskFromScore(sc.score);return r;}).sort(function(a,b){return b.__score-a.__score;});if(FILTER.rt){var one=rs.find(function(r){return String(r.rt_id)===String(FILTER.rt);})||(DATA.rts||[]).find(function(r){return String(r.rt_id)===String(FILTER.rt);});if(one)return rt360(one);return '<div class="ct-card"><div class="ct-section-state bad">RT « '+esc(FILTER.rt)+' » introuvable dans le registre. Le filtre a été conservé pour que vous sachiez ce qui a été demandé.<div style="margin-top:10px"><button type="button" class="ct-action" data-clear-rt>Revenir au réseau</button></div></div></div>';}var rows=rs.map(function(r){var imm=n(r.dechires)+n(r.a_reparer)+n(r.rebut);return '<tr><td>'+status(r.__risk)+'</td><td class="num"><b>'+r.__score+'</b></td><td>'+esc(r.cluster||'—')+'</td><td><button class="ct-link" data-rt="'+esc(r.rt_id)+'">'+esc(String(r.rt_nom||r.rt_id||'').replace(/^RT\s+/i,''))+'</button></td><td class="num">'+fmt(r.total_sous_responsabilite)+'</td><td class="num">'+fmt(r.vides)+'</td><td class="num">'+fmt(r.pleins)+'</td><td class="num">'+fmt(imm)+'</td><td>'+age(r.derniere_activite)+'</td></tr>';}).join('');
/* Un cluster peut être critique sans qu'aucun RT ne porte le signal : filtrer
   sur ce cluster ne doit pas faire disparaître le risque de l'écran. */
var clusterCard='';
if(FILTER.cluster){
  var cc=(DATA.clusters||[]).find(function(c){return String(c.cluster)===FILTER.cluster;});
  if(cc)clusterCard='<div class="ct-note"><b>Cluster '+esc(cc.cluster)+' — '+status(cc.status)+'</b><br>Parc '+fmt(cc.total_reseau||n(cc.stock_cluster_vide)+n(cc.stock_chez_rt)+n(cc.stock_chez_producteur)+n(cc.stock_hub_plein))+' · magasin cluster '+fmt(cc.stock_cluster_vide)+' · terrain '+fmt(n(cc.stock_chez_rt)+n(cc.stock_chez_producteur))+' · écart '+(cc.inventory_gap==null?'—':fmt(cc.inventory_gap))+(rows?'':'<br>Aucun RT rattaché à ce cluster : le risque ci-dessus reste porté par le cluster lui-même.')+'</div>';
  else clusterCard='<div class="ct-section-state bad">Cluster « '+esc(FILTER.cluster)+' » inconnu dans le registre. <button type="button" class="ct-link" data-cluster-reset="1">Voir tout le réseau</button></div>';
}
if(!rows)rows='<tr><td colspan="9">Aucun RT pour ce filtre.</td></tr>';
return '<div class="ct-breadcrumb">Réseau'+(FILTER.cluster?' › '+esc(FILTER.cluster):'')+'</div><div class="ct-card"><h2>Réseau Cluster → RT</h2><p class="ct-hint">Le score de risque indicatif combine incohérence de stock, immobilisation, fraîcheur d’activité et statut serveur. Cliquez sur un RT pour sa fiche 360°.</p><div class="ct-tools"><select id="ctClusterFilter" aria-label="Filtrer par cluster">'+clusterOptions()+'</select><button class="ct-action ghost" data-export="reseau">Exporter CSV</button></div>'+clusterCard+'<div class="ct-table"><table id="ctTable-reseau"><thead><tr><th scope="col">Risque</th><th scope="col" class="num">Score</th><th scope="col">Cluster</th><th scope="col">RT</th><th scope="col" class="num">Total</th><th scope="col" class="num">Vides</th><th scope="col" class="num">Pleins</th><th scope="col" class="num">Immobilisés</th><th scope="col">Activité</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';}
function movementFiltered(){var ms=(DATA.movements||[]).slice();if(FILTER.cluster)ms=ms.filter(function(m){return String(m.cluster||'')===FILTER.cluster;});if(FILTER.rt)ms=ms.filter(function(m){return String(m.rt_id||'')===FILTER.rt;});if(FILTER.state)ms=ms.filter(function(m){return m.from_state===FILTER.state||m.to_state===FILTER.state;});if(FILTER.from)ms=ms.filter(function(m){return String(m.movement_at||'')>=FILTER.from;});if(FILTER.to)ms=ms.filter(function(m){return String(m.movement_at||'').slice(0,10)<=FILTER.to;});if(FILTER.q){var q=FILTER.q.toLowerCase();ms=ms.filter(function(m){return [m.reference,m.source_type,m.movement_type,m.cluster,m.rt_id].some(function(v){return String(v||'').toLowerCase().indexOf(q)>=0;});});}return ms;}
function movementJournal(){var ms=movementFiltered(),per=25,pages=Math.max(1,Math.ceil(ms.length/per));FILTER.page=Math.min(FILTER.page,pages);var start=(FILTER.page-1)*per,show=ms.slice(start,start+per);var rows=show.map(function(m){return '<tr><td>'+dt(m.movement_at)+'</td><td>'+esc(m.source_type||m.movement_type||'—')+'</td><td>'+esc(m.cluster||'—')+(m.rt_id?'<br><small>'+esc(m.rt_id)+'</small>':'')+'</td><td class="num"><b>'+fmt(m.qty)+'</b></td><td>'+esc(locLabel(m.from_location))+' → '+esc(locLabel(m.to_location))+'</td><td>'+esc(stateLabel(m.from_state))+' → '+esc(stateLabel(m.to_state))+'</td><td>'+esc(m.reference||'—')+'</td></tr>';}).join('')||'<tr><td colspan="7">Aucun mouvement pour ces filtres.</td></tr>';return '<div class="ct-card"><h2>Journal des mouvements</h2><p class="ct-hint">Registre transactionnel, filtrable, partageable via URL et exportable.</p><div class="ct-tools"><input id="ctMoveSearch" value="'+esc(FILTER.q)+'" placeholder="Référence, type, cluster…"><input id="ctMoveFrom" type="date" value="'+esc(FILTER.from)+'"><input id="ctMoveTo" type="date" value="'+esc(FILTER.to)+'"><select id="ctMoveState"><option value="">Tous les états</option>'+['UTILISABLE','PLEIN','EN_TRANSIT','DECHIRE','A_REPARER','REPARE','REFORME'].map(function(s){return '<option value="'+s+'" '+(FILTER.state===s?'selected':'')+'>'+esc(stateLabel(s))+'</option>';}).join('')+'</select><button class="ct-action ghost" data-export="flux">Exporter CSV</button></div><div class="ct-table"><table id="ctTable-flux"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Cluster / RT</th><th scope="col" class="num">Qté</th><th scope="col">Trajet</th><th scope="col">État</th><th scope="col">Référence</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="ct-pagination"><button class="ct-action ghost" data-page="'+(FILTER.page-1)+'" '+(FILTER.page<=1?'disabled':'')+'>Précédent</button><span>Page '+FILTER.page+' / '+pages+' · '+fmt(ms.length)+' mouvement(s)</span><button class="ct-action ghost" data-page="'+(FILTER.page+1)+'" '+(FILTER.page>=pages?'disabled':'')+'>Suivant</button></div></div>';}
function flux(){return '<div id="ctFluxWorkflow"><div class="ct-section-state">Chargement du workflow des demandes…</div></div>'+movementJournal();}
function parc(){var rs=(DATA.rts||[]).filter(function(r){return n(r.dechires)+n(r.a_reparer)+n(r.rebut)>0;}).sort(function(a,b){return n(b.dechires)+n(b.a_reparer)+n(b.rebut)-n(a.dechires)-n(a.a_reparer)-n(a.rebut);});var damaged=rs.map(function(r){return '<tr><td>'+esc(r.cluster||'—')+'</td><td><button class="ct-link" data-rt="'+esc(r.rt_id||'')+'">'+esc(String(r.rt_nom||r.rt_id||'').replace(/^RT\s+/i,''))+'</button></td><td class="num">'+fmt(r.dechires)+'</td><td class="num">'+fmt(r.a_reparer)+'</td><td class="num">'+fmt(r.repares)+'</td><td class="num">'+fmt(r.rebut)+'</td><td>'+age(r.derniere_activite)+'</td><td><button class="ct-action ghost" data-operation="state" data-cluster="'+esc(r.cluster||'')+'" data-rt="'+esc(r.rt_id||'')+'" data-state="DECHIRE">Traiter</button></td></tr>';}).join('')||'<tr><td colspan="8">Aucun sac immobilisé.</td></tr>';var inv=(DATA.inventories||[]).map(function(i){var raw=String(i.status||i.reconciliation_status||'').toUpperCase(),s=raw?normalizedStatus(raw):(n(i.difference_qty)===0?'NORMAL':'ATTENTION');return '<tr><td>'+dt(i.counted_at)+'</td><td>'+esc(i.cluster||'—')+'</td><td>'+esc(i.scope_type||'—')+'</td><td>'+esc(stateLabel(i.state))+'</td><td class="num">'+fmt(i.theoretical_qty)+'</td><td class="num">'+fmt(i.counted_qty)+'</td><td class="num">'+fmt(i.difference_qty)+'</td><td>'+status(s)+'</td></tr>';}).join('')||'<tr><td colspan="8">Aucun inventaire physique enregistré : contrôle à planifier.</td></tr>';return '<div class="ct-card"><h2>État du parc</h2><p class="ct-hint">Les états immobilisés sont traités depuis leur ligne, avec contexte pré-rempli.</p><div class="ct-table"><table id="ctTable-parc"><thead><tr><th scope="col">Cluster</th><th scope="col">Responsable</th><th scope="col" class="num">Abîmés</th><th scope="col" class="num">À réparer</th><th scope="col" class="num">Réparés</th><th scope="col" class="num">Rebut</th><th scope="col">Ancienneté</th><th scope="col">Action</th></tr></thead><tbody>'+damaged+'</tbody></table></div><h3>Inventaires physiques</h3><div class="ct-note">Tolérance métier : la classification définitive doit être fournie par le serveur. Tant qu’elle n’est pas configurée, tout écart non nul reste signalé en ATTENTION et n’est jamais masqué.</div><div class="ct-table"><table><thead><tr><th scope="col">Date</th><th scope="col">Cluster</th><th scope="col">Niveau</th><th scope="col">État</th><th scope="col" class="num">Théorique</th><th scope="col" class="num">Physique</th><th scope="col" class="num">Écart</th><th scope="col">Statut</th></tr></thead><tbody>'+inv+'</tbody></table></div></div>';}
function controles(){return '<div id="ctControlsHost"><div class="ct-section-state">Chargement des contrôles…</div></div><div id="ctSettingsHost"></div>';}
function render(){if(!DATA)return;var b=$('ctBody');if(!b)return;var avis=TAB_INVALIDE?'<div class="ct-section-state bad" role="status">L’onglet « '+esc(TAB_INVALIDE)+' » n’existe pas. Vous avez été ramené au Pilotage.</div>':'';TAB_INVALIDE='';b.innerHTML=avis+(TAB==='pilotage'?pilotage():TAB==='reseau'?reseau():TAB==='flux'?flux():TAB==='parc'?parc():controles());updateDecisionBand();if(TAB==='flux')setTimeout(function(){if(window.ANAGROCI_SACHERIE_V2&&window.ANAGROCI_SACHERIE_V2.renderInto)window.ANAGROCI_SACHERIE_V2.renderInto($('ctFluxWorkflow'));},0);if(TAB==='controles')setTimeout(function(){if(window.ANAGROCI_SACHERIE_CT_ACTIONS&&window.ANAGROCI_SACHERIE_CT_ACTIONS.renderControlsInto)window.ANAGROCI_SACHERIE_CT_ACTIONS.renderControlsInto($('ctControlsHost'));if(window.ANAGROCI_SACHERIE_V2&&window.ANAGROCI_SACHERIE_V2.renderSettingsInto)window.ANAGROCI_SACHERIE_V2.renderSettingsInto($('ctSettingsHost'));},0);}
function openCluster(c){FILTER.cluster=String(c||'');FILTER.rt='';setTab('reseau');}
function openRT(id){FILTER.rt=String(id||'');var r=(DATA.rts||[]).find(function(x){return String(x.rt_id)===FILTER.rt;});if(r)FILTER.cluster=String(r.cluster||'');setTab('reseau');}
function drill(kind,cluster,rt,state){FILTER.cluster=cluster||FILTER.cluster;FILTER.rt=rt||FILTER.rt;FILTER.state=state||'';if(kind==='inventory'){setTab('parc');return;}if(kind==='alert'){setTab('controles');return;}if(kind==='immobilise'){FILTER.state='DECHIRE';setTab('parc');return;}if(kind==='terrain'){setTab('reseau');return;}if(kind==='old_transit'){FILTER.state='EN_TRANSIT';setTab('flux');return;}if(kind==='cluster'||kind==='rt'||kind==='all'){setTab('flux');return;}if(['UTILISABLE','PLEIN','EN_TRANSIT','DECHIRE','A_REPARER','REPARE','REFORME'].indexOf(kind)>=0)FILTER.state=kind;setTab('flux');}
function openDecisions(kind){setTab('flux');setTimeout(function(){if(window.ANAGROCI_SACHERIE_V2&&window.ANAGROCI_SACHERIE_V2.showDecisions)window.ANAGROCI_SACHERIE_V2.showDecisions(kind);},0);}
function openOperation(kind,cluster,rt,state){if(window.ANAGROCI_SACHERIE_CT_ACTIONS&&window.ANAGROCI_SACHERIE_CT_ACTIONS.open)window.ANAGROCI_SACHERIE_CT_ACTIONS.open(kind,{cluster:cluster,rt_id:rt,state:state});else setTab('controles');}
/* Le CSV se construit à partir des données, pas du tableau affiché : lire le
   DOM exportait « Aucun RT pour ce filtre. » comme une ligne métier, et
   « il y a 35 j » à la place d'une date exploitable. */
function iso(v){if(!v)return '';try{var d=new Date(v);return isNaN(d.getTime())?'':d.toISOString();}catch(e){return '';}}
function csvCell(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}
function csvBuild(head,rows){return [head.map(csvCell).join(';')].concat(rows.map(function(r){return r.map(csvCell).join(';');})).join('\r\n');}
function exportData(which){
if(which==='reseau'){
  var rs=(DATA.rts||[]).filter(function(r){return !FILTER.cluster||String(r.cluster)===FILTER.cluster;});
  return {head:['cluster','rt_id','rt_nom','risque','score','total_sous_responsabilite','vides','pleins','abimes','a_reparer','rebut','immobilises','derniere_activite_iso'],
    rows:rs.map(function(r){var sc=scoreRT(r);return [r.cluster||'',r.rt_id||'',r.rt_nom||'',riskFromScore(sc.score),sc.score,n(r.total_sous_responsabilite),n(r.vides),n(r.pleins),n(r.dechires),n(r.a_reparer),n(r.rebut),n(r.dechires)+n(r.a_reparer)+n(r.rebut),iso(r.derniere_activite)];})};
}
var ms=movementFiltered();
return {head:['movement_at_iso','type','cluster','rt_id','quantite','from_location','to_location','from_state','to_state','reference'],
  rows:ms.map(function(m){return [iso(m.movement_at),m.source_type||m.movement_type||'',m.cluster||'',m.rt_id||'',n(m.qty),m.from_location||'',m.to_location||'',m.from_state||'',m.to_state||'',m.reference||''];})};
}
function exportTable(which){
var d=exportData(which);
if(!d.rows.length){
  var b=$('ctBody');
  if(b){var old=$('ctExportMsg');if(old)old.remove();var w=document.createElement('div');w.id='ctExportMsg';w.className='ct-section-state bad';w.setAttribute('role','status');w.textContent='Aucune donnée à exporter pour les filtres sélectionnés.';b.insertBefore(w,b.firstChild);setTimeout(function(){if(w.parentNode)w.remove();},6000);}
  audit('sacherie_export_vide',{vue:which});
  return;
}
var blob=new Blob(['\ufeff'+csvBuild(d.head,d.rows)],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');
a.href=URL.createObjectURL(blob);
a.download='sacherie-'+which+'-'+new Date().toISOString().slice(0,10)+'.csv';
a.click();
setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
audit('sacherie_export',{vue:which,lignes:d.rows.length});}
window.addEventListener('online',function(){load();});window.addEventListener('offline',function(){setSync('offline','navigateur hors ligne');if(DATA)banner('Vous êtes hors ligne : les chiffres affichés ne sont plus rafraîchis.');});window.addEventListener('sacherie:counts',function(e){setCounts(e.detail||{});});window.addEventListener('sacherie:ready',function(){if(TAB==='flux'||TAB==='controles')render();});
window.ANAGROCI_SACHERIE_CT={reload:load,setTab:setTab,setCounts:setCounts,openCluster:openCluster,openRT:openRT,esc:esc,snapshot:function(){return DATA;},syncState:function(){return {state:SYNC,lastOk:LAST_OK};},helpers:{parseBagQty:parseBagQty,transitionTargets:transitionTargets,transitionAllowed:transitionAllowed,validateEvidenceFile:validateEvidenceFile,friendlyError:friendlyError,stateLabel:stateLabel,clusterAvailable:clusterAvailable,openGaps:openGaps,fmt:fmt}};
function boot(){if((window.ANAGROCI_MODULE||(window.ANAGROCI_AUTH&&window.ANAGROCI_AUTH.module))==='sacs')mount();else setTimeout(boot,120);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(boot,80);});else setTimeout(boot,80);
})();
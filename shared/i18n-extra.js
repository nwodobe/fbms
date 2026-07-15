/* ANAGROCI FR/EN extra translations - UI hotfix */
(function(){
  "use strict";
  if(window.ANAGROCI_I18N_EXTRA_READY) return;
  window.ANAGROCI_I18N_EXTRA_READY=true;
  var KEY="anagroci_lang", busy=false, timer=null;
  var originals=new WeakMap(), attrOriginals=new WeakMap();
  var D={
    "FBMS Referentiel":"FBMS Master Data","FBMS Référentiel":"FBMS Master Data","Référentiel FBMS":"FBMS Master Data",
    "Accès total : validation, exports, administration.":"Full access: validation, exports, administration.",
    "Accès total":"Full access","validation, exports, administration":"validation, exports, administration",
    "Synchronisé":"Synced","Synchronisé à":"Synced at","conflit(s)":"conflict(s)","conflit":"conflict","conflits":"conflicts","à arbitrer":"to resolve","Base de données":"Database",
    "Connexion rétablie — synchronisation…":"Connection restored — syncing...","Hors ligne — enregistrement local uniquement":"Offline — local saving only",
    "Réduire":"Collapse","Nouveau village":"New village","Se déconnecter":"Sign out","Synchroniser":"Sync","Connexion FBMS Cloud":"FBMS Cloud sign-in",
    "Mode local":"Local mode","Non connecté · appuyer Sync":"Not connected · tap Sync","Connecté":"Connected","Non connecté au Cloud":"Not connected to Cloud",
    "Rechercher un village, un enquêteur, un cluster…":"Search a village, surveyor, cluster...",
    "Accès total en lecture/écriture, sans gestion des utilisateurs.":"Full read/write access, without user management.",
    "Supervision recensements, validation RT, cartographie.":"Census supervision, RT validation, mapping.",
    "Consultation complète, exports, priorisation achats.":"Full consultation, exports, purchase prioritization.",
    "Validation des fiches de son périmètre géographique.":"Validates forms within own geographic scope.",
    "Création et modification de ses propres fiches uniquement.":"Creates and edits own forms only.",
    "Lecture seule, aucun export sensible.":"Read-only, no sensitive exports.",
    "Tableau de bord":"Dashboard","Recensement":"Census","Base de données":"Database","Base RT":"RT Base","Producteurs":"Producers","Cartographie":"Map","Galerie photos":"Photo gallery","Statistiques":"Statistics","Administration":"Administration"
  };
  function lang(){return localStorage.getItem(KEY)==="en"?"en":"fr"}
  function clean(s){return String(s==null?"":s).replace(/\u00a0/g," ").replace(/\s+/g," ").trim()}
  function keys(){return Object.keys(D).sort(function(a,b){return b.length-a.length})}
  var sortedKeys=null;
  function tr(s){
    if(lang()!=="en") return s;
    var a=String(s==null?"":s), lead=(a.match(/^\s*/)||[""])[0], tail=(a.match(/\s*$/)||[""])[0], x=clean(a);
    if(!x) return s;
    if(D[x]) return lead+D[x]+tail;
    var out=x;(sortedKeys||(sortedKeys=keys())).forEach(function(k){if(k.length>2&&out.indexOf(k)>=0)out=out.split(k).join(D[k])});
    return lead+out+tail;
  }
  function skip(n){var e=n.nodeType===3?n.parentElement:n;return !e||e.closest("script,style,noscript,svg,[data-i18n-ignore]")}
  function eachText(root,fn){var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return skip(n)||!clean(n.nodeValue)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}}),n;while((n=w.nextNode()))fn(n)}
  function amap(e){var m=attrOriginals.get(e);if(!m){m={};attrOriginals.set(e,m)}return m}
  function apply(){
    if(!document.body||busy) return; busy=true;
    eachText(document.body,function(n){var src=originals.get(n),cur=n.nodeValue;if(lang()==="en"){if(!src||(cur!==src&&cur!==tr(src)))src=cur;originals.set(n,src);n.nodeValue=tr(src)}else if(src){n.nodeValue=src}});
    document.querySelectorAll("[placeholder],[title],[aria-label],input[type=button],input[type=submit],button").forEach(function(e){var m=amap(e);["placeholder","title","aria-label"].forEach(function(a){if(!e.hasAttribute(a))return;var cur=e.getAttribute(a),src=m[a];if(lang()==="en"){if(!src||(cur!==src&&cur!==tr(src)))src=cur;m[a]=src;e.setAttribute(a,tr(src))}else if(src)e.setAttribute(a,src)});if((e.tagName==="INPUT"||e.tagName==="BUTTON")&&e.value){var v=e.value,sv=m.value;if(lang()==="en"){if(!sv||(v!==sv&&v!==tr(sv)))sv=v;m.value=sv;e.value=tr(sv)}else if(sv)e.value=sv}});
    busy=false;
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(apply,60)}
  function init(){apply();new MutationObserver(function(){if(!busy)schedule()}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["placeholder","title","aria-label","value"]});document.addEventListener("anagroci:language",schedule);document.addEventListener("anagroci:authenticated",schedule);window.addEventListener("online",schedule);window.addEventListener("offline",schedule);window.ANAGROCI_I18N_EXTRA={apply:apply,t:tr}}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();

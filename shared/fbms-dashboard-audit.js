/* ============================================================================
   ANAGROCI FBMS - DASHBOARD AUDIT 2026-08-07
   Applies the dashboard visual language supplied in "Audit application FBMS"
   without replacing the FBMS application or its data/runtime features.
   ========================================================================== */
(function(){
  'use strict';
  if(!/\/fbms\/index\.html$/.test(location.pathname)) return;

  var P1_THRESHOLD = 85;
  var TARGET_VILLAGES = 50;
  var TARGET_RT = 150;

  var CSS = ''+
  ':root{--audit-green-forest:#053B23;--audit-green-pine:#00712C;--audit-green-emerald:#008F37;--audit-green-lime:#8DC556;--audit-green-pale:#E0F3DE;--audit-green-mist:#F1F9EF;--audit-orange:#EE9E00;--audit-ink:#323131;--audit-neutral-500:#7A7878;--audit-neutral-400:#A3A1A1;--audit-border:#E8E7E7}'+
  '#content .audit-page{padding:26px 28px 40px;background:var(--audit-green-mist);min-height:100%}'+
  '#content .audit-page *{box-sizing:border-box}'+
  '#content .audit-eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;color:var(--audit-neutral-500)}'+
  '#content .audit-eyebrow.brand{color:var(--audit-green-emerald)}'+
  '#content .audit-num{font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:600;letter-spacing:-.02em}'+
  '#content .audit-pagehead{display:flex;align-items:flex-end;gap:40px;margin-bottom:22px}'+
  '#content .audit-pagehead h1{font-family:Archivo,system-ui,sans-serif;font-weight:700;font-size:30px;letter-spacing:-.02em;line-height:1.1;margin:8px 0 6px;color:var(--audit-ink)}'+
  '#content .audit-pagehead p{font-size:14px;color:var(--audit-neutral-500);margin:0}'+
  '#content .audit-goal{margin-left:auto;width:min(420px,42vw)}'+
  '#content .audit-goal-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:8px}'+
  '#content .audit-goal-value{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:14px;white-space:nowrap;color:var(--audit-ink)}'+
  '#content .audit-goal-value strong{font-size:20px}'+
  '#content .audit-bar{height:8px;border-radius:999px;background:var(--audit-green-pale);overflow:hidden}'+
  '#content .audit-bar>span{display:block;height:100%;background:var(--audit-green-emerald);transform-origin:left;animation:auditDashBar .75s cubic-bezier(.22,1,.36,1)}'+
  '#content .audit-goal-meta{display:flex;justify-content:space-between;margin-top:7px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--audit-neutral-500)}'+
  '#content .audit-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:20px}'+
  '#content .audit-card{background:#fff;border:1px solid var(--audit-border);border-radius:12px}'+
  '#content .audit-kpi{padding:18px 20px}'+
  '#content .audit-kpi-val{display:flex;align-items:baseline;gap:8px;margin:10px 0 8px}'+
  '#content .audit-kpi-val .audit-num{font-size:34px;color:var(--audit-ink)}'+
  '#content .audit-kpi-unit{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;color:var(--audit-neutral-400)}'+
  '#content .audit-kpi-note{font-size:12px;color:var(--audit-neutral-500)}'+
  '#content .audit-grid{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:20px;align-items:start}'+
  '#content .audit-col{display:flex;flex-direction:column;gap:20px;min-width:0}'+
  '#content .audit-pad{padding:22px 24px}'+
  '#content .audit-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px}'+
  '#content .audit-title{display:flex;align-items:center;gap:10px;font-family:Archivo,system-ui,sans-serif;font-weight:700;font-size:17px;color:var(--audit-ink);margin:0}'+
  '#content .audit-title:before{content:"";width:4px;height:18px;border-radius:2px;background:var(--audit-green-lime);flex:none}'+
  '#content .audit-legend{display:flex;align-items:center;gap:16px;font-size:12px;color:var(--audit-neutral-500);flex-wrap:wrap}'+
  '#content .audit-legend span{display:flex;align-items:center;gap:6px}'+
  '#content .audit-swatch{width:10px;height:10px;border-radius:2px;display:inline-block}'+
  '#content .audit-regions{display:flex;flex-direction:column;gap:18px;margin-top:20px}'+
  '#content .audit-region-row{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:8px}'+
  '#content .audit-region-name{font-size:14px;font-weight:600;color:var(--audit-ink)}'+
  '#content .audit-region-name span{font-weight:400;color:var(--audit-neutral-500)}'+
  '#content .audit-region-val{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;color:var(--audit-neutral-500);white-space:nowrap}'+
  '#content .audit-region-val b{color:var(--audit-ink)}'+
  '#content .audit-region-track{height:22px;border-radius:4px;background:var(--audit-green-pale);overflow:hidden;min-width:8px}'+
  '#content .audit-region-fill{height:100%;background:var(--audit-green-emerald);transform-origin:left;animation:auditDashBar .8s cubic-bezier(.22,1,.36,1)}'+
  '#content .audit-totals{display:flex;gap:48px;margin-top:24px;padding-top:18px;border-top:1px solid var(--audit-border);flex-wrap:wrap}'+
  '#content .audit-totals .audit-num{font-size:19px;display:block;margin-top:6px}'+
  '#content .audit-totals small{font-size:12px;color:var(--audit-neutral-400);font-weight:400}'+
  '#content .audit-chart{display:grid;grid-template-columns:repeat(6,1fr);gap:20px;align-items:end;height:190px;border-bottom:1px solid var(--audit-border);margin-top:24px}'+
  '#content .audit-chart-col{display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end}'+
  '#content .audit-chart-val{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;color:var(--audit-neutral-500)}'+
  '#content .audit-chart-bar{width:100%;max-width:72px;background:var(--audit-green-emerald);border-radius:3px 3px 0 0;transform-origin:bottom;animation:auditDashRise .75s cubic-bezier(.22,1,.36,1)}'+
  '#content .audit-chart-col.now .audit-chart-val{color:var(--audit-ink);font-weight:600}'+
  '#content .audit-chart-col.now .audit-chart-bar{background:var(--audit-green-forest)}'+
  '#content .audit-chart-x{display:grid;grid-template-columns:repeat(6,1fr);gap:20px;margin-top:8px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--audit-neutral-500);text-align:center}'+
  '#content .audit-chart-x b{color:var(--audit-ink)}'+
  '#content .audit-tablehead{display:flex;align-items:center;gap:14px;padding:8px 22px;background:var(--audit-green-mist);border-top:1px solid var(--audit-border);border-bottom:1px solid var(--audit-border);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--audit-neutral-500);font-weight:600}'+
  '#content .audit-vrow{display:flex;align-items:center;gap:14px;padding:13px 22px;border:0;border-bottom:1px solid var(--audit-border);width:100%;background:#fff;text-align:left;cursor:pointer;transition:background .14s cubic-bezier(.22,1,.36,1)}'+
  '#content .audit-vrow:hover{background:var(--audit-green-mist)}'+
  '#content .audit-rank{width:18px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;color:var(--audit-neutral-400);flex:none}'+
  '#content .audit-village-id{flex:1;min-width:0}'+
  '#content .audit-village-name{display:block;font-size:15px;font-weight:600;color:var(--audit-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
  '#content .audit-village-sub{display:block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--audit-neutral-500);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
  '#content .audit-score-wrap{display:flex;align-items:center;gap:10px;flex:none}'+
  '#content .audit-tier{padding:3px 8px;border-radius:4px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.06em;background:#F4F4F3;color:var(--audit-neutral-500)}'+
  '#content .audit-tier.p1{background:var(--audit-green-pale);color:var(--audit-green-pine)}'+
  '#content .audit-score{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:20px;font-weight:600;width:30px;text-align:right;color:var(--audit-ink)}'+
  '#content .audit-linkbtn{border:0;background:none;padding:13px 22px;color:var(--audit-green-emerald);font:500 13px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;text-align:left}'+
  '#content .audit-linkbtn:hover{color:var(--audit-green-pine);text-decoration:underline}'+
  '#content .audit-panel-dark{background:var(--audit-green-forest);border-radius:12px;padding:20px 22px;color:#fff}'+
  '#content .audit-panel-dark h2{font-family:Archivo,system-ui,sans-serif;font-weight:700;font-size:17px;margin:0}'+
  '#content .audit-surveyor-row{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:8px;background:rgba(255,255,255,.08);margin-top:8px}'+
  '#content .audit-panel-note{margin-top:14px;font-size:12px;color:#9FC2A9;line-height:1.6}'+
  '#content .audit-empty{padding:18px 22px;color:var(--audit-neutral-500);font-size:13px}'+
  '@keyframes auditDashBar{from{transform:scaleX(0)}to{transform:scaleX(1)}}'+
  '@keyframes auditDashRise{from{transform:scaleY(0)}to{transform:scaleY(1)}}'+
  '@media(max-width:1100px){#content .audit-grid{grid-template-columns:minmax(0,1fr) 360px}#content .audit-goal{width:min(360px,42vw)}}'+
  '@media(max-width:900px){#content .audit-pagehead{align-items:flex-start;flex-direction:column;gap:18px}#content .audit-goal{width:100%;margin-left:0}#content .audit-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}#content .audit-grid{grid-template-columns:1fr}}'+
  '@media(max-width:600px){#content .audit-page{padding:18px 14px 120px}#content .audit-pagehead h1{font-size:25px}#content .audit-kpis{grid-template-columns:1fr}#content .audit-card-head{align-items:flex-start;flex-direction:column}#content .audit-pad{padding:18px}#content .audit-chart{gap:8px;height:170px}#content .audit-chart-x{gap:8px}#content .audit-totals{gap:22px}#content .audit-region-row{align-items:flex-start;flex-direction:column;gap:4px}}';

  function addStyle(){
    if(document.getElementById('fbms-dashboard-audit-style')) return;
    var s=document.createElement('style');
    s.id='fbms-dashboard-audit-style';
    s.textContent=CSS;
    document.head.appendChild(s);
  }

  function tr(label){ try{return typeof t==='function'?t(label):label;}catch(e){return label;} }
  function e(value){ try{return typeof esc==='function'?esc(value):String(value==null?'':value);}catch(err){return String(value==null?'':value);} }
  function fmt(value){ return Math.round(Number(value)||0).toLocaleString('fr-FR'); }
  function num(value){ var n=Number(value); return isFinite(n)?n:0; }
  function candidates(v){ return v&&v.s7&&Array.isArray(v.s7.candidats)?v.s7.candidats.filter(function(c){return c&&c.nom;}):[]; }
  function score(v){ try{return typeof scoreOf==='function'?Number(scoreOf(v))||0:0;}catch(err){return 0;} }
  function villageName(v){ return v&&v.s1&&v.s1.village?v.s1.village:tr('Sans nom'); }
  function villageSub(v){ return v&&v.s1?(v.s1.sousPrefecture||v.s1.departement||v.s1.cluster||''):''; }
  function surveyorKey(raw){ return String(raw||'—').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')||'—'; }

  function DashboardViewAudit(){
    var villages=(typeof STATE!=='undefined'&&Array.isArray(STATE.villages))?STATE.villages:[];
    var scored=villages.map(function(v){return {v:v,score:score(v)};});
    var totalMT=villages.reduce(function(a,v){return a+num(v&&v.s3&&v.s3.potentielMT);},0);
    var totalSecure=villages.reduce(function(a,v){return a+num(v&&v.s3&&v.s3.potentielSecuriseMT);},0);
    var pct=totalMT>0?Math.round(totalSecure/totalMT*100):0;
    var reste=Math.max(0,totalMT-totalSecure);
    var nbRT=villages.reduce(function(a,v){return a+candidates(v).length;},0);
    var nbPrioritaires=scored.filter(function(x){return x.score>=P1_THRESHOLD;}).length;
    var top=[].concat(scored).sort(function(a,b){return b.score-a.score;}).slice(0,5);

    var rmap={};
    villages.forEach(function(v){
      var name=(v&&v.s1&&v.s1.region)||tr('Non renseigné');
      if(!rmap[name]) rmap[name]={name:name,villages:0,mt:0,sec:0};
      rmap[name].villages+=1;
      rmap[name].mt+=num(v&&v.s3&&v.s3.potentielMT);
      rmap[name].sec+=num(v&&v.s3&&v.s3.potentielSecuriseMT);
    });
    var regions=Object.keys(rmap).map(function(k){return rmap[k];}).sort(function(a,b){return b.mt-a.mt;});
    var maxRegMt=Math.max.apply(Math,[1].concat(regions.map(function(r){return r.mt;})));

    var weeks;
    try{ weeks=typeof computeEvolution==='function'?computeEvolution():null; }catch(err){ weeks=null; }
    if(!Array.isArray(weeks)||!weeks.length){
      weeks=Array.from({length:6}).map(function(_,i){return {semaine:'S'+(i+1),n:Math.round(villages.length/6*(i+1))};});
    }
    var maxN=Math.max.apply(Math,[1].concat(weeks.map(function(w){return num(w.n);})));

    var rankMap={},rankLabel={};
    villages.forEach(function(v){
      var raw=(v&&v.s1&&v.s1.enqueteur)||'—';
      var k=surveyorKey(raw);
      rankMap[k]=(rankMap[k]||0)+1;
      if(!rankLabel[k]) rankLabel[k]=String(raw||'—').trim().toUpperCase()||'—';
    });
    var ranking=Object.keys(rankMap).map(function(k){return [rankLabel[k],rankMap[k]];}).sort(function(a,b){return b[1]-a[1];});

    var villageNote=tr('Objectif campagne atteint');
    var rtNote=nbRT>=TARGET_RT?tr('Objectif de qualification atteint'):(TARGET_RT-nbRT)+' '+tr('candidats à qualifier');

    var html='<div class="audit-page">';
    html+='<div class="audit-pagehead">'+
      '<div><div class="audit-eyebrow brand">'+e(tr('Campagne census · Field Buying 2027'))+'</div>'+
      '<h1>'+e(tr('Tableau de bord exécutif'))+'</h1>'+
      '<p>'+e(tr('Vue consolidée de la campagne de recensement villages — Field Buying 2027.'))+'</p></div>'+
      '<div class="audit-goal"><div class="audit-goal-row"><div class="audit-eyebrow">'+e(tr('Potentiel sécurisé'))+'</div>'+
      '<div class="audit-goal-value"><strong class="audit-num">'+fmt(totalSecure)+'</strong> / '+fmt(totalMT)+' MT</div></div>'+
      '<div class="audit-bar"><span style="width:'+Math.max(0,Math.min(100,pct))+'%"></span></div>'+
      '<div class="audit-goal-meta"><span>'+pct+' % '+e(tr("de l'objectif"))+'</span><span>'+e(tr('reste'))+' '+fmt(reste)+' MT</span></div></div></div>';

    var kpis=[
      {label:tr('Villages recensés'),value:fmt(villages.length),unit:'/ '+villages.length,note:villageNote,color:''},
      {label:tr('Potentiel total'),value:fmt(totalMT),unit:'MT',note:fmt(totalSecure)+' '+tr('MT sécurisés'),color:''},
      {label:tr('RT identifiés'),value:fmt(nbRT),unit:'/ '+TARGET_RT,note:rtNote,color:''},
      {label:tr('Villages prioritaires'),value:fmt(nbPrioritaires),unit:'P1',note:tr("Score ≥ 85 · à activer d'abord"),color:'color:var(--audit-orange)'}
    ];
    html+='<div class="audit-kpis">'+kpis.map(function(k){return '<div class="audit-card audit-kpi"><div class="audit-eyebrow">'+e(k.label)+'</div><div class="audit-kpi-val"><span class="audit-num" style="'+k.color+'">'+e(k.value)+'</span><span class="audit-kpi-unit">'+e(k.unit)+'</span></div><div class="audit-kpi-note">'+e(k.note)+'</div></div>';}).join('')+'</div>';

    html+='<div class="audit-grid"><div class="audit-col">';
    html+='<section class="audit-card audit-pad"><div class="audit-card-head"><h2 class="audit-title">'+e(tr('Potentiel par région'))+'</h2><div class="audit-legend"><span><i class="audit-swatch" style="background:var(--audit-green-emerald)"></i>'+e(tr('Sécurisé'))+'</span><span><i class="audit-swatch" style="background:var(--audit-green-pale)"></i>'+e(tr('Reste à sécuriser'))+'</span></div></div>';
    if(!regions.length){ html+='<div class="audit-empty">'+e(tr('Aucune donnée de recensement — lancez le Recensement pour voir le potentiel par région.'))+'</div>'; }
    else {
      html+='<div class="audit-regions">';
      regions.forEach(function(r){
        var trackPct=Math.max(3,Math.min(100,r.mt/maxRegMt*100));
        var fillPct=r.mt>0?Math.max(0,Math.min(100,r.sec/r.mt*100)):0;
        html+='<div><div class="audit-region-row"><div class="audit-region-name">'+e(r.name)+' <span>· '+r.villages+' '+e(tr('villages'))+'</span></div><div class="audit-region-val"><b>'+fmt(r.sec)+'</b> / '+fmt(r.mt)+' MT</div></div><div class="audit-region-track" style="width:'+trackPct+'%"><div class="audit-region-fill" style="width:'+fillPct+'%"></div></div></div>';
      });
      html+='</div>';
    }
    html+='<div class="audit-totals"><div><div class="audit-eyebrow">'+e(tr('Total potentiel'))+'</div><span class="audit-num">'+fmt(totalMT)+' <small>MT</small></span></div><div><div class="audit-eyebrow">'+e(tr('Sécurisé'))+'</div><span class="audit-num" style="color:var(--audit-green-emerald)">'+fmt(totalSecure)+' <small>MT</small></span></div><div><div class="audit-eyebrow">'+e(tr('Reste à sécuriser'))+'</div><span class="audit-num" style="color:var(--audit-orange)">'+fmt(reste)+' <small>MT</small></span></div></div></section>';

    html+='<section class="audit-card audit-pad"><div class="audit-card-head"><h2 class="audit-title">'+e(tr('Progression du census'))+'</h2><div style="font-family:IBM Plex Mono,ui-monospace,monospace;font-size:12px;color:var(--audit-neutral-500)">'+e(tr('villages cumulés'))+' · S1 → S6</div></div><div class="audit-chart">';
    weeks.slice(0,6).forEach(function(w,i){ var h=Math.max(5,Math.round(num(w.n)/maxN*180)); var now=i===Math.min(5,weeks.length-1); html+='<div class="audit-chart-col'+(now?' now':'')+'"><span class="audit-chart-val">'+fmt(w.n)+'</span><div class="audit-chart-bar" style="height:'+h+'px"></div></div>'; });
    html+='</div><div class="audit-chart-x">'+weeks.slice(0,6).map(function(w,i){var val=e(w.semaine||('S'+(i+1)));return '<div>'+(i===Math.min(5,weeks.length-1)?'<b>'+val+'</b>':val)+'</div>';}).join('')+'</div></section>';
    html+='</div><div class="audit-col">';

    html+='<section class="audit-card" style="overflow:hidden"><div class="audit-card-head" style="padding:20px 22px 14px"><h2 class="audit-title">'+e(tr('Top villages'))+'</h2><div style="font-size:12px;color:var(--audit-neutral-500)">'+e(tr('trié par score'))+'</div></div><div class="audit-tablehead"><span style="width:18px">#</span><span style="flex:1">'+e(tr('Village · sous-préfecture'))+'</span><span>'+e(tr('Score'))+'</span></div>';
    if(!top.length) html+='<div class="audit-empty">'+e(tr("Aucun village recensé — commencez par l'onglet Recensement."))+'</div>';
    top.forEach(function(item,i){ var p1=item.score>=P1_THRESHOLD; html+='<button type="button" class="audit-vrow" onclick="openVillage(\''+e(item.v.id)+'\')"><span class="audit-rank">'+(i+1)+'</span><span class="audit-village-id"><span class="audit-village-name">'+e(villageName(item.v))+'</span><span class="audit-village-sub">'+e(villageSub(item.v))+'</span></span><span class="audit-score-wrap"><span class="audit-tier'+(p1?' p1':'')+'">'+(p1?'P1':'P2')+'</span><span class="audit-score">'+Math.round(item.score)+'</span></span></button>'; });
    html+='<button type="button" class="audit-linkbtn" onclick="handleNavClick(\'database\')">'+e(tr('Voir les'))+' '+villages.length+' '+e(tr('villages'))+'</button></section>';

    html+='<section class="audit-panel-dark"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px"><h2>'+e(tr('Enquêteurs'))+'</h2><span style="font-size:12px;color:#9FC2A9">'+e(tr('campagne en cours'))+'</span></div>';
    if(!ranking.length) html+='<div style="font-size:13px;color:#9FC2A9;padding:10px 0">'+e(tr('Aucun enquêteur — le classement arrive après les premières fiches.'))+'</div>';
    ranking.slice(0,6).forEach(function(r,i){ html+='<div class="audit-surveyor-row"><span style="font-family:IBM Plex Mono,ui-monospace,monospace;font-size:12px;color:#9FC2A9">'+(i+1)+'</span><span style="flex:1;font-weight:600;font-size:15px">'+e(r[0])+'</span><span style="font-family:IBM Plex Mono,ui-monospace,monospace;font-size:18px;font-weight:600;color:var(--audit-green-lime)">'+r[1]+'</span></div>'; });
    var topCount=ranking.length?ranking[0][1]:0;
    var note=ranking.length===1?e(ranking[0][0])+' · '+topCount+' '+e(tr('villages recensés')):ranking.length+' '+e(tr('enquêteurs actifs'))+' · '+villages.length+' '+e(tr('villages recensés'));
    html+='<p class="audit-panel-note">'+note+'</p></section>';
    html+='</div></div></div>';
    return html;
  }

  function install(){
    addStyle();
    try{
      if(typeof DashboardView==='function') DashboardView=DashboardViewAudit;
      else window.DashboardView=DashboardViewAudit;
      if(typeof STATE!=='undefined' && STATE.active==='dashboard' && typeof renderContent==='function'){
        renderContent();
        if(window.lucide) window.lucide.createIcons();
      }
    }catch(err){
      console.error('[FBMS] Dashboard audit non appliqué :',err);
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();

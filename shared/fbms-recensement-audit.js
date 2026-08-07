/* ============================================================================
   ANAGROCI FBMS - RECENSEMENT AUDIT UI 2026-08-07
   Applies the visual/interaction direction from the supplied audit mockup to
   the live FBMS census form without replacing its data model or save logic.
   ========================================================================== */
(function(){
  'use strict';
  if(!/\/fbms\/index\.html$/.test(location.pathname)) return;

  var CSS=''+
  ':root{--fra-forest:#053B23;--fra-pine:#00712C;--fra-emerald:#008F37;--fra-lime:#8DC556;--fra-pale:#E0F3DE;--fra-mist:#F1F9EF;--fra-orange:#EE9E00;--fra-ink:#323131;--fra-muted:#7A7878;--fra-border:#E8E7E7;--fra-border2:#D2D0D0}'+
  '#recensement-form.fra-ready{padding:26px 28px 40px!important;max-width:none!important;background:var(--fra-mist)}'+
  '#recensement-form.fra-ready>.flex.items-start.justify-between{max-width:none!important;margin-bottom:22px!important;align-items:flex-end!important}'+
  '#recensement-form.fra-ready h1{font-size:30px!important;line-height:1.1!important;letter-spacing:-.02em!important}'+
  '#recensement-form.fra-ready #scoreBadgeTop{display:none!important}'+
  '#recensement-form.fra-ready>.flex.items-center.gap-2.mb-3{max-width:none!important;background:#fff;border:1px solid var(--fra-border);border-radius:999px;padding:7px 12px;width:max-content;max-width:100%!important}'+
  '#recensement-form.fra-ready>.space-y-3{max-width:none!important;display:grid!important;grid-template-columns:minmax(0,1fr) 340px!important;gap:24px!important;align-items:start!important}'+
  '#recensement-form.fra-ready>.space-y-3>.fra-formcol{display:flex;flex-direction:column;gap:12px;min-width:0}'+
  '#recensement-form.fra-ready details{border:1px solid var(--fra-border)!important;border-radius:12px!important;background:#fff!important;overflow:hidden!important}'+
  '#recensement-form.fra-ready details summary{background:#fff!important;padding:16px 22px!important;min-height:54px}'+
  '#recensement-form.fra-ready details[open] summary{border-bottom:1px solid var(--fra-border)}'+
  '#recensement-form.fra-ready details summary>span:first-child:before{content:"";display:block;width:4px;height:18px;border-radius:2px;background:var(--fra-border2);margin-right:2px}'+
  '#recensement-form.fra-ready details[open] summary>span:first-child:before{background:var(--fra-lime)}'+
  '#recensement-form.fra-ready details summary .ff-body{font-family:Archivo,system-ui,sans-serif!important;font-size:16px!important;font-weight:700!important;color:var(--fra-ink)!important}'+
  '#recensement-form.fra-ready details>div{padding:22px!important;background:#fff!important}'+
  '#recensement-form.fra-ready label>span:first-child{text-transform:uppercase!important;letter-spacing:.14em!important;font-size:10px!important;font-weight:600!important;color:var(--fra-muted)!important;margin-bottom:7px!important}'+
  '#recensement-form.fra-ready input:not([type=checkbox]):not([type=range]),#recensement-form.fra-ready select,#recensement-form.fra-ready textarea{min-height:42px!important;border:1px solid var(--fra-border2)!important;border-radius:8px!important;background:#fff!important;font-size:15px!important;padding-left:14px!important;padding-right:14px!important;box-shadow:none!important}'+
  '#recensement-form.fra-ready input:focus,#recensement-form.fra-ready select:focus,#recensement-form.fra-ready textarea:focus{border-color:var(--fra-emerald)!important;box-shadow:0 0 0 3px rgba(0,143,55,.18)!important;outline:none!important}'+
  '#recensement-form.fra-ready .fra-rail{position:sticky;top:18px;display:flex;flex-direction:column;gap:16px}'+
  '#recensement-form.fra-ready .fra-score{background:var(--fra-forest);border-radius:12px;padding:20px 22px;color:#fff}'+
  '#recensement-form.fra-ready .fra-score-label{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#9FC2A9;font-weight:600}'+
  '#recensement-form.fra-ready .fra-score-num{font-family:"IBM Plex Mono",monospace;font-size:44px;font-weight:600;letter-spacing:-.02em;color:#CFE3D3;margin:8px 0 4px}'+
  '#recensement-form.fra-ready .fra-score-num small{font-size:15px;color:#9FC2A9}'+
  '#recensement-form.fra-ready .fra-pill{display:inline-block;padding:4px 11px;border-radius:999px;font-size:12px;font-weight:600;background:rgba(255,255,255,.12);color:#CFE3D3}'+
  '#recensement-form.fra-ready .fra-score-note{margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12);font-size:12px;color:#9FC2A9;line-height:1.6}'+
  '#recensement-form.fra-ready .fra-toc{background:#fff;border:1px solid var(--fra-border);border-radius:12px;padding:16px 18px}'+
  '#recensement-form.fra-ready .fra-toc-title{font-family:Archivo,system-ui,sans-serif;font-size:14px;font-weight:700;color:var(--fra-ink);margin-bottom:8px}'+
  '#recensement-form.fra-ready .fra-toc a{display:flex;align-items:center;gap:10px;padding:7px 0;color:var(--fra-muted);font-size:13px;text-decoration:none}'+
  '#recensement-form.fra-ready .fra-toc a:hover{color:var(--fra-ink)}'+
  '#recensement-form.fra-ready .fra-dot{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--fra-border2);flex:none}'+
  '#recensement-form.fra-ready .fra-toc a.fra-current{font-weight:600;color:var(--fra-ink)}'+
  '#recensement-form.fra-ready .fra-toc a.fra-current .fra-dot{background:var(--fra-emerald);border-color:var(--fra-emerald)}'+
  '#recensement-form.fra-ready .fra-actions{background:#fff;border:1px solid var(--fra-border);border-radius:12px;padding:16px}'+
  '#recensement-form.fra-ready .fra-actions button{width:100%;border-radius:999px!important;margin:0 0 8px!important;justify-content:center!important}'+
  '#recensement-form.fra-ready>.flex.items-center.gap-3.mt-6{display:none!important}'+
  '#recensement-form.fra-ready #sec9 input[type=range]{display:none!important}'+
  '#recensement-form.fra-ready .fra-step-wrap{display:flex;gap:6px;flex:1}'+
  '#recensement-form.fra-ready .fra-step{flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--fra-border2);background:#fff;color:var(--fra-muted);font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:600;cursor:pointer}'+
  '#recensement-form.fra-ready .fra-step:hover{border-color:var(--fra-emerald)}'+
  '#recensement-form.fra-ready .fra-step.on{background:var(--fra-emerald);border-color:var(--fra-emerald);color:#fff}'+
  '#recensement-form.fra-ready .fra-live{font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;color:var(--fra-ink);min-width:40px;text-align:right}'+
  '#recensement-form.fra-ready .fra-step-row{display:flex;align-items:center;gap:12px;width:100%}'+
  '@media(max-width:1050px){#recensement-form.fra-ready>.space-y-3{grid-template-columns:minmax(0,1fr) 300px!important}}'+
  '@media(max-width:900px){#recensement-form.fra-ready>.space-y-3{grid-template-columns:1fr!important}#recensement-form.fra-ready .fra-rail{position:static;order:-1}#recensement-form.fra-ready .fra-toc{display:none}}'+
  '@media(max-width:600px){#recensement-form.fra-ready{padding:18px 14px 120px!important}#recensement-form.fra-ready h1{font-size:25px!important}#recensement-form.fra-ready details>div{padding:16px!important}#recensement-form.fra-ready .grid-cols-2{grid-template-columns:1fr!important}.fra-step-wrap{gap:4px!important}.fra-step{font-size:11px!important}}';

  function addStyle(){
    if(document.getElementById('fbms-recensement-audit-style')) return;
    var st=document.createElement('style'); st.id='fbms-recensement-audit-style'; st.textContent=CSS; document.head.appendChild(st);
  }
  function cleanText(s){ return String(s||'').replace(/\s+/g,' ').trim(); }
  function score(){
    var ids=['note_potentiel','note_route','note_rt','note_conc','note_pay'];
    return ids.reduce(function(a,id){var el=document.getElementById(id);return a+(el?Number(el.value)||0:0);},0);
  }
  function verdict(sc){ if(sc>=85)return 'Village prioritaire'; if(sc>=70)return 'Village secondaire'; if(sc>=50)return 'À approfondir'; return 'Rejet'; }
  function updateRail(){
    var root=document.getElementById('recensement-form'); if(!root)return;
    var sc=score(), n=root.querySelector('.fra-score-num'), p=root.querySelector('.fra-pill'), note=root.querySelector('.fra-score-note');
    if(n)n.innerHTML=sc+' <small>/ 100</small>'; if(p)p.textContent=verdict(sc);
    if(note)note.textContent=sc>=85?'Priorité élevée : sécuriser RT, paiement et potentiel.':sc>=70?'Village secondaire : compléter les points faibles avant activation.':sc>=50?'Données ou conditions à approfondir avant décision.':'Village non prioritaire selon les critères actuels.';
  }
  function buildSteps(root){
    ['note_potentiel','note_route','note_rt','note_conc','note_pay'].forEach(function(id){
      var range=root.querySelector('#'+id); if(!range||range.dataset.fraSteps)return; range.dataset.fraSteps='1';
      var host=range.parentElement; if(!host)return;
      var row=document.createElement('div'); row.className='fra-step-row';
      var wrap=document.createElement('div'); wrap.className='fra-step-wrap';
      [0,5,10,15,20].forEach(function(v){
        var b=document.createElement('button'); b.type='button'; b.className='fra-step'+(Number(range.value)===v?' on':''); b.textContent=v;
        b.addEventListener('click',function(){ range.value=String(v); range.dispatchEvent(new Event('input',{bubbles:true})); wrap.querySelectorAll('.fra-step').forEach(function(x){x.classList.toggle('on',Number(x.textContent)===v);}); live.textContent=v+'/20'; updateRail(); });
        wrap.appendChild(b);
      });
      var live=document.createElement('span'); live.className='fra-live'; live.textContent=(Number(range.value)||0)+'/20';
      row.appendChild(wrap); row.appendChild(live); host.appendChild(row);
      range.addEventListener('input',function(){ var v=Number(range.value)||0; live.textContent=v+'/20'; wrap.querySelectorAll('.fra-step').forEach(function(x){x.classList.toggle('on',Number(x.textContent)===v);}); updateRail(); });
    });
  }
  function buildRail(root, sections){
    if(root.querySelector('.fra-rail'))return;
    var rail=document.createElement('aside'); rail.className='fra-rail';
    rail.innerHTML='<div class="fra-score"><div class="fra-score-label">Score global</div><div class="fra-score-num">0 <small>/ 100</small></div><span class="fra-pill">Non évalué</span><div class="fra-score-note">Renseignez les 5 critères pour obtenir le classement.</div></div>'+
      '<div class="fra-toc"><div class="fra-toc-title">Sections du formulaire</div><div class="fra-toc-links"></div></div>'+
      '<div class="fra-actions"><button type="button" class="ff-body text-sm font-semibold px-5 py-2.5" style="background:#008F37;color:#fff" data-fra-save>Enregistrer la fiche</button><button type="button" class="ff-body text-sm font-semibold px-5 py-2.5" style="background:#fff;color:#008F37;border:1px solid #008F37" data-fra-cancel>Annuler</button></div>';
    var links=rail.querySelector('.fra-toc-links');
    sections.forEach(function(sec,i){
      var a=document.createElement('a'); a.href='#'+sec.id; a.innerHTML='<span class="fra-dot"></span><span>'+(i+1)+' · '+cleanText(sec.querySelector('summary')?sec.querySelector('summary').textContent:'Section')+'</span>'; if(i===0)a.classList.add('fra-current');
      a.addEventListener('click',function(ev){ev.preventDefault();sec.open=true;sec.scrollIntoView({behavior:'smooth',block:'start'});links.querySelectorAll('a').forEach(function(x){x.classList.remove('fra-current');});a.classList.add('fra-current');});
      links.appendChild(a);
    });
    rail.querySelector('[data-fra-save]').addEventListener('click',function(){ if(typeof window.saveForm==='function')window.saveForm(); else if(typeof saveForm==='function')saveForm(); });
    rail.querySelector('[data-fra-cancel]').addEventListener('click',function(){ if(typeof window.cancelForm==='function')window.cancelForm(); else if(typeof cancelForm==='function')cancelForm(); });
    var holder=root.querySelector(':scope > .space-y-3'); if(holder)holder.appendChild(rail);
  }
  function wrapFormColumn(root, sections){
    var holder=root.querySelector(':scope > .space-y-3'); if(!holder||holder.querySelector('.fra-formcol'))return;
    var col=document.createElement('div'); col.className='fra-formcol';
    sections.forEach(function(sec){col.appendChild(sec);});
    holder.insertBefore(col,holder.firstChild);
  }
  function apply(){
    var root=document.getElementById('recensement-form'); if(!root||root.classList.contains('fra-ready'))return;
    root.classList.add('fra-ready');
    var holder=root.querySelector(':scope > .space-y-3'); if(!holder)return;
    var sections=Array.prototype.slice.call(holder.querySelectorAll(':scope > details'));
    wrapFormColumn(root,sections); buildRail(root,sections); buildSteps(root); updateRail();
  }
  function observe(){
    apply();
    var c=document.getElementById('content'); if(!c)return;
    new MutationObserver(function(){apply();}).observe(c,{childList:true,subtree:true});
  }
  addStyle();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true}); else observe();
})();

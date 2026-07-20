/* ANAGROCI Operations Suite - gardes metier Sacs / Sacherie terrain
   Non destructif : bloque les mouvements incoherents et protege la file locale.
*/
(function(){
  'use strict';
  if(window.__ANAGROCI_SACS_GUARDS_SCRIPT) return;
  window.__ANAGROCI_SACS_GUARDS_SCRIPT = true;

  function moduleName(){ return window.ANAGROCI_MODULE || (window.ANAGROCI_AUTH && window.ANAGROCI_AUTH.module) || 'unknown'; }
  function readStore(k, def){ try{ var s=localStorage.getItem(k); return s ? JSON.parse(s) : def; }catch(e){ return def; } }
  function writeStore(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
  function key(s){ return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
  function num(x){ var v=parseFloat(String(x == null ? '' : x).replace(',','.')); return Number.isFinite(v) ? v : null; }
  function field(id){ var e=document.getElementById(id); return e ? String(e.value || '').trim() : ''; }
  function opts(id){ var d=document.getElementById(id); if(!d) return []; return Array.prototype.slice.call(d.querySelectorAll('option')).map(function(o){return o.value || '';}).filter(Boolean); }
  function msg(text, kind){ try{ var el=document.getElementById('m_msg'); if(typeof window.msg === 'function' && el) window.msg(el, text, kind || 'err'); else if(el){ el.className='alert show '+(kind||'err'); el.textContent=text; } else alert(text); }catch(e){} }
  function audit(action, details){ try{ window.ANAGROCI_AUDIT && window.ANAGROCI_AUDIT.log(action, details || {}); }catch(e){} }
  function deviceId(){ var k='anagroci_device_id'; var id=localStorage.getItem(k); if(!id){ try{id='dev-'+crypto.randomUUID();}catch(e){id='dev-'+Date.now()+'-'+Math.round(Math.random()*1e9);} localStorage.setItem(k,id); } return id; }

  function typeDef(){
    var k = field('m_type');
    var list = window.TYPES || [];
    for(var i=0;i<list.length;i++){ if(list[i].k === k) return list[i]; }
    return {k:k,src:'',dst:'',prod:false};
  }
  function allMov(){
    var seen={}, out=[];
    (readStore('anagroci_sacs', []) || []).forEach(function(m){ var id=m && m.local_id || ('q'+out.length); if(!seen[id]){ seen[id]=1; out.push(m); } });
    var ref = readStore('anagroci_ref_sacs', {}) || {};
    (ref.server || []).forEach(function(m){ var id=m && m.local_id || ('s'+out.length); if(!seen[id]){ seen[id]=1; out.push(m); } });
    return out;
  }
  function balanceMaps(){
    var rt={}, prod={}, clus={};
    var ref = readStore('anagroci_ref_sacs', {}) || {};
    (ref.rt || []).forEach(function(r){ var id=String(r.id || key((r.data && (r.data.nom || r.data.rt)) || r.nom || r.village_nom || '')); if(id && !rt[id]) rt[id]={q:0, nom:(r.data && (r.data.nom || r.data.rt)) || r.nom || r.village_nom || ''}; });
    allMov().forEach(function(m){
      if(!m) return;
      var q = Number(m.quantite) || 0;
      var rk = m.rt_id || key(m.rt_nom || '');
      if(rk){ if(!rt[rk]) rt[rk]={q:0, nom:m.rt_nom||''}; if(m.destination==='RT') rt[rk].q += q; if(m.source==='RT') rt[rk].q -= q; }
      var pk = m.producteur_id || key(m.producteur_nom || '');
      if(pk && (m.source==='PRODUCTEUR' || m.destination==='PRODUCTEUR')){ if(!prod[pk]) prod[pk]={q:0, nom:m.producteur_nom||''}; if(m.destination==='PRODUCTEUR') prod[pk].q += q; if(m.source==='PRODUCTEUR') prod[pk].q -= q; }
      var ck = key(m.cluster || '');
      if(ck && (m.source==='CLUSTER' || m.destination==='CLUSTER')){ if(!clus[ck]) clus[ck]={q:0, nom:m.cluster||''}; if(m.destination==='CLUSTER') clus[ck].q += q; if(m.source==='CLUSTER') clus[ck].q -= q; }
    });
    return {rt:rt, prod:prod, clus:clus};
  }
  function findRtKey(rtName){
    try{ if(typeof window.D === 'object' && Array.isArray(window.D.rt)){ var r=window.D.rt.find(function(x){ var label=(x.data && (x.data.nom || x.data.rt)) || x.nom || x.village_nom || ''; return key(label)===key(rtName); }); if(r && r.id) return String(r.id); } }catch(e){}
    var ref = readStore('anagroci_ref_sacs', {}) || {};
    var rr = (ref.rt || []).find(function(x){ var label=(x.data && (x.data.nom || x.data.rt)) || x.nom || x.village_nom || ''; return key(label)===key(rtName); });
    return rr && rr.id ? String(rr.id) : key(rtName);
  }
  function findProdKey(prodName){
    try{ if(typeof window.curProdList === 'function' && typeof window.prodLabel === 'function'){ var p=window.curProdList().find(function(x){ return key(window.prodLabel(x))===key(prodName); }); if(p) return String(p.code || p.id || key(prodName)); } }catch(e){}
    return key(prodName);
  }
  function currentBalances(){
    var b = balanceMaps();
    var t = typeDef();
    var rtName = field('m_rt'), prodName = field('m_prod'), cluster = field('m_cluster');
    var rk = rtName ? findRtKey(rtName) : '';
    var pk = prodName ? findProdKey(prodName) : '';
    var ck = key(cluster || '');
    return {type:t, rt_key:rk, prod_key:pk, cluster_key:ck, rt_balance:rk && b.rt[rk] ? b.rt[rk].q : 0, prod_balance:pk && b.prod[pk] ? b.prod[pk].q : 0, cluster_balance:ck && b.clus[ck] ? b.clus[ck].q : 0};
  }

  function normalizeQueue(queue, beforeMap){
    var now = new Date().toISOString(), dev = deviceId();
    var out = Array.isArray(queue) ? queue.slice() : [];
    var seen = {};
    out.forEach(function(r){ if(r && r.local_id) seen[String(r.local_id)] = true; });
    if(beforeMap){ Object.keys(beforeMap).forEach(function(id){ var old = beforeMap[id]; if(!seen[id] && old && old._status !== 'synced'){ old._status = old._status || 'pending'; old.recovered_at = now; out.push(old); } }); }
    out.forEach(function(r){ if(!r) return; if(!r.device_id) r.device_id = dev; if(r.sync_attempts == null) r.sync_attempts = 0; if(!r._status) r._status = 'pending'; if(r._status === 'syncing') r._status = 'failed'; if(r._error && !r.last_error) r.last_error = r._error; });
    out.sort(function(a,b){ return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    return out;
  }
  function pendingMap(queue){ var m={}; (queue||[]).forEach(function(r){ if(r && r.local_id && r._status !== 'synced') m[String(r.local_id)] = Object.assign({}, r); }); return m; }
  function syncPayload(queue){
    return (queue||[]).slice().sort(function(a,b){
      return String(a.created_at || a.date || '').localeCompare(String(b.created_at || b.date || ''));
    }).map(function(r){ var x=Object.assign({}, r||{}); delete x.device_id; delete x.sync_attempts; delete x.last_attempt_at; delete x.last_error; delete x.recovered_at; delete x._error; return x; });
  }
  function mergeSyncResult(originalQueue, syncQueue){ var sm={}; (syncQueue||[]).forEach(function(r){ if(r && r.local_id) sm[String(r.local_id)] = r; }); return normalizeQueue((originalQueue||[]).map(function(r){ if(!r || !r.local_id) return r; var s=sm[String(r.local_id)]||{}; if(s._status==='synced'){ r._status='synced'; delete r._error; r.last_error=null; } else if(s._error){ r._status='failed'; r._error=s._error; r.last_error=s._error; } else if(r._status==='syncing'){ r._status='pending'; } return r; })); }

  function validateMovement(){
    if(moduleName() !== 'sacs') return {ok:true};
    var t = typeDef();
    var qte = num(field('m_qte'));
    var date = field('m_date');
    var cluster = field('m_cluster');
    var village = field('m_village');
    var rt = field('m_rt');
    var prod = field('m_prod');
    if(date){ var today = new Date(); today.setHours(23,59,59,999); var d = new Date(date + 'T00:00:00'); if(d > today) return {ok:false, reason:'date_future', message:'Date future interdite pour un mouvement de sacs.'}; }
    if(qte == null || qte <= 0 || Math.round(qte) !== qte) return {ok:false, reason:'quantity_invalid', message:'Nombre de sacs invalide : saisissez un entier positif.'};
    if(t.k === 'USINE_CLUSTER' && !cluster) return {ok:false, reason:'cluster_required', message:'Cluster requis pour une réception Usine → Cluster.'};
    if(t.k !== 'USINE_CLUSTER' && !rt) return {ok:false, reason:'rt_required', message:'RT requis : tout mouvement terrain doit être rattaché à une équipe RT.'};
    if(t.prod && !prod) return {ok:false, reason:'producer_required', message:'Producteur requis pour ce mouvement de sacs.'};
    var villages = opts('dl_vil');
    if(cluster && village && villages.length && villages.map(key).indexOf(key(village)) === -1) return {ok:false, reason:'village_out_of_cluster', message:'Village hors cluster ou non reconnu. Choisissez un village du référentiel.'};
    var rts = opts('dl_rt');
    if(rt && rts.length && rts.map(key).indexOf(key(rt)) === -1) return {ok:false, reason:'rt_out_of_scope', message:'RT hors village/cluster. Choisissez un RT proposé par le référentiel.'};
    var prods = opts('dl_prod');
    if(t.prod && prod && prods.length && prods.map(key).indexOf(key(prod)) === -1) return {ok:false, reason:'producer_out_of_scope', message:'Producteur hors village ou non autorisé pour ce mouvement.'};

    var bal = currentBalances();
    if(t.src === 'CLUSTER' && bal.cluster_balance < qte) return {ok:false, reason:'negative_cluster_stock', message:'Stock sacs cluster insuffisant. Solde disponible : '+Math.round(bal.cluster_balance).toLocaleString('fr-FR')+' sacs.'};
    if(t.src === 'RT' && bal.rt_balance < qte) return {ok:false, reason:'negative_rt_stock', message:'Stock sacs RT insuffisant. Solde disponible : '+Math.round(bal.rt_balance).toLocaleString('fr-FR')+' sacs.'};
    if(t.src === 'PRODUCTEUR' && bal.prod_balance < qte) return {ok:false, reason:'negative_producer_stock', message:'Stock sacs producteur insuffisant. Solde disponible : '+Math.round(bal.prod_balance).toLocaleString('fr-FR')+' sacs.'};
    return {ok:true};
  }

  function install(){
    if(moduleName() !== 'sacs') return false;
    if(window.__ANAGROCI_SACS_GUARDS_INSTALLED) return true;
    if(typeof window.saveMov !== 'function' || typeof window.syncAll !== 'function') return false;
    var originalSave = window.saveMov;
    var originalSync = window.syncAll;
    window.saveMov = function(){
      var validation = validateMovement();
      if(!validation.ok){ audit('bag_movement_blocked_by_guard', {reason:validation.reason, fields:{type:field('m_type'), cluster:field('m_cluster'), village:field('m_village'), rt:field('m_rt'), producteur:field('m_prod'), qte:field('m_qte')}}); msg(validation.message, 'err'); return false; }
      var before = pendingMap(readStore('anagroci_sacs', []));
      var result = originalSave.apply(this, arguments);
      writeStore('anagroci_sacs', normalizeQueue(readStore('anagroci_sacs', []), before));
      if(typeof window.render === 'function') try{ window.render(); }catch(e){}
      return result;
    };
    window.saveMov.__anagroci_sacs_guarded = true;
    window.syncAll = function(){
      var originalQueue = normalizeQueue(readStore('anagroci_sacs', []));
      var now = new Date().toISOString();
      originalQueue.forEach(function(r){ if(r && r._status !== 'synced'){ r._status='syncing'; r.sync_attempts=Number(r.sync_attempts||0)+1; r.last_attempt_at=now; r.last_error=null; } });
      writeStore('anagroci_sacs', syncPayload(originalQueue));
      var result = originalSync.apply(this, arguments);
      if(result && typeof result.then === 'function') return result.finally(function(){ var syncResult=readStore('anagroci_sacs', []); writeStore('anagroci_sacs', mergeSyncResult(originalQueue, syncResult)); if(typeof window.render === 'function') try{ window.render(); }catch(e){}; });
      var syncResult=readStore('anagroci_sacs', []); writeStore('anagroci_sacs', mergeSyncResult(originalQueue, syncResult)); if(typeof window.render === 'function') try{ window.render(); }catch(e){}; return result;
    };
    window.syncAll.__anagroci_sacs_guarded = true;
    window.__ANAGROCI_SACS_GUARDS_INSTALLED = true;
    audit('sacs_sacherie_guards_installed', {module:'sacs', step:'6'});
    return true;
  }
  function start(){ var tries=0; var timer=setInterval(function(){ tries++; if(install() || tries>=24) clearInterval(timer); }, 500); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  document.addEventListener('anagroci:authenticated', function(){ setTimeout(start, 300); });
})();
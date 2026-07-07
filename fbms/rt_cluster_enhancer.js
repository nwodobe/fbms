(function(){
  'use strict';
  var SUPABASE_URL='https://jmbdgpdthzpszfnddwzi.supabase.co';
  var SUPABASE_ANON='sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d';
  var CDN='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  var villages=[], rts=[], byVillage={}, done=new WeakSet();
  function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function ensureSupabase(cb){if(window.supabase&&window.supabase.createClient)return cb();var s=document.createElement('script');s.src=CDN;s.onload=cb;document.head.appendChild(s);}
  async function loadData(){
    var sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON);
    var vr=await sb.from('villages').select('id,village,cluster,data').eq('deleted',false);
    var rr=await sb.from('rt').select('id,id_rt,nom,village_id,village_nom,cluster,statut,data').eq('deleted',false);
    villages=(vr.data||[]).map(function(v){var name=v.village||(v.data&&v.data.s1&&v.data.s1.village)||'';var cl=v.cluster||(v.data&&v.data.s1&&v.data.s1.cluster)||'';return {id:v.id,name:name,cluster:String(cl||'').trim()};});
    rts=(rr.data||[]).map(function(r){return {id:r.id,id_rt:r.id_rt||'',nom:r.nom||'',village_id:r.village_id||'',village_nom:r.village_nom||'',cluster:String(r.cluster||'').trim(),statut:r.statut||''};});
    byVillage={}; villages.forEach(function(v){byVillage[norm(v.name)]=v;});
  }
  function makeCell(doc,tag,text){var c=doc.createElement(tag);c.textContent=text||'';c.className='px-3 py-2 whitespace-nowrap';return c;}
  function findVillageIndex(cells){for(var i=0;i<cells.length;i++){if(byVillage[norm(cells[i].textContent)])return i;}return -1;}
  function matchRt(rowText){var nr=norm(rowText);for(var i=0;i<rts.length;i++){var r=rts[i];if(r.nom&&nr.indexOf(norm(r.nom))>=0)return r;}return null;}
  function enhanceVillageTable(doc,table){
    var rows=[].slice.call(table.querySelectorAll('tr')); if(rows.length<2)return false;
    var bodyRows=rows.slice(1), hits=0, idx=-1;
    bodyRows.forEach(function(tr){var cells=[].slice.call(tr.children);var vi=findVillageIndex(cells);if(vi>=0){hits++;if(idx<0)idx=vi;}});
    if(hits<2)return false;
    var head=rows[0], heads=[].slice.call(head.children); if(head.textContent.indexOf('Cluster')>=0)return false;
    var th=makeCell(doc,'th','Cluster'); head.insertBefore(th, heads[idx+1]||null);
    bodyRows.forEach(function(tr){var cells=[].slice.call(tr.children);var vi=findVillageIndex(cells);var v=vi>=0?byVillage[norm(cells[vi].textContent)]:null;var td=makeCell(doc,'td',v?v.cluster:'');tr.insertBefore(td,cells[(vi>=0?vi:idx)+1]||null);});
    done.add(table);return true;
  }
  function enhanceRtTable(doc,table){
    var rows=[].slice.call(table.querySelectorAll('tr')); if(rows.length<2)return false;
    var bodyRows=rows.slice(1), hits=0;
    bodyRows.forEach(function(tr){if(matchRt(tr.textContent))hits++;});
    if(hits<2)return false;
    var head=rows[0]; if(head.textContent.indexOf('ID RT')>=0)return false;
    head.insertBefore(makeCell(doc,'th','ID RT'), head.children[0]||null);
    head.appendChild(makeCell(doc,'th','Cluster'));
    bodyRows.forEach(function(tr){var r=matchRt(tr.textContent);tr.insertBefore(makeCell(doc,'td',r?r.id_rt:''), tr.children[0]||null);tr.appendChild(makeCell(doc,'td',r?r.cluster:''));});
    done.add(table);return true;
  }
  function scan(){
    var iframe=document.querySelector('iframe'); if(!iframe||!iframe.contentDocument)return;
    var doc=iframe.contentDocument;
    [].slice.call(doc.querySelectorAll('table')).forEach(function(t){if(done.has(t))return;if(!enhanceRtTable(doc,t))enhanceVillageTable(doc,t);});
  }
  ensureSupabase(function(){loadData().then(function(){setInterval(scan,1200);scan();});});
})();
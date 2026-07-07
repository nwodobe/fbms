(function(){
  'use strict';
  var SUPABASE_URL='https://jmbdgpdthzpszfnddwzi.supabase.co';
  var SUPABASE_ANON='sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d';
  var CDN='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  var villages=[], rts=[], byVillage={}, clusters=[], done=new WeakSet();
  var FILTER_ID='fbms-cluster-filter';
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
    var seen={}; clusters=[];
    villages.concat(rts).forEach(function(x){var c=String(x.cluster||'').trim(); if(c&&!seen[norm(c)]){seen[norm(c)]=1; clusters.push(c);}});
    clusters.sort(function(a,b){return a.localeCompare(b,'fr');});
  }
  function makeCell(doc,tag,text){var c=doc.createElement(tag);c.textContent=text||'';c.className='px-3 py-2 whitespace-nowrap';return c;}
  function findVillageIndex(cells){for(var i=0;i<cells.length;i++){if(byVillage[norm(cells[i].textContent)])return i;}return -1;}
  function matchRt(rowText){var nr=norm(rowText);for(var i=0;i<rts.length;i++){var r=rts[i];if(r.nom&&nr.indexOf(norm(r.nom))>=0)return r;}return null;}
  function getSelectedCluster(doc){var s=doc.getElementById(FILTER_ID);return s?String(s.value||''):'';}
  function applyClusterFilter(doc){
    var selected=norm(getSelectedCluster(doc));
    var visible=0,total=0;
    [].slice.call(doc.querySelectorAll('tr[data-fbms-cluster]')).forEach(function(tr){
      total++; var ok=!selected || norm(tr.getAttribute('data-fbms-cluster'))===selected;
      tr.style.display=ok?'':'none'; if(ok)visible++;
    });
    var n=doc.getElementById('fbms-cluster-filter-note'); if(n)n.textContent=selected?visible+' ligne(s) affichée(s) sur '+total:'Tous les clusters affichés';
  }
  function ensureFilter(doc){
    var host=doc.querySelector('#content')||doc.body; if(!host)return;
    var firstTable=doc.querySelector('table'); if(!firstTable)return;
    if(doc.getElementById(FILTER_ID))return;
    var box=doc.createElement('div');
    box.id='fbms-cluster-filter-box';
    box.setAttribute('style','margin:10px 0 12px;padding:12px;border:1px solid #E4DFD1;border-radius:14px;background:#fff;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 4px 14px rgba(5,59,35,.06)');
    box.innerHTML='<label for="'+FILTER_ID+'" style="font-weight:800;color:#053B23;font-size:13px">Filtrer par cluster</label><select id="'+FILTER_ID+'" style="border:1px solid #D9D3C3;border-radius:10px;padding:8px 10px;min-width:220px"><option value="">Tous les clusters</option>'+clusters.map(function(c){return '<option value="'+esc(c)+'">'+esc(c)+'</option>';}).join('')+'</select><span id="fbms-cluster-filter-note" style="font-size:12px;color:#6B6458">Tous les clusters affichés</span>';
    var tableWrap=firstTable.closest('.rounded-xl,.overflow-hidden,section,div')||firstTable;
    tableWrap.parentNode.insertBefore(box,tableWrap);
    var saved=localStorage.getItem('fbms_cluster_filter')||'';
    var sel=doc.getElementById(FILTER_ID); if(saved)sel.value=saved;
    sel.addEventListener('change',function(){localStorage.setItem('fbms_cluster_filter',this.value||'');applyClusterFilter(doc);});
  }
  function enhanceVillageTable(doc,table){
    var rows=[].slice.call(table.querySelectorAll('tr')); if(rows.length<2)return false;
    var bodyRows=rows.slice(1), hits=0, idx=-1;
    bodyRows.forEach(function(tr){var cells=[].slice.call(tr.children);var vi=findVillageIndex(cells);if(vi>=0){hits++;if(idx<0)idx=vi;}});
    if(hits<2)return false;
    var head=rows[0], heads=[].slice.call(head.children); if(head.textContent.indexOf('Cluster')<0){head.insertBefore(makeCell(doc,'th','Cluster'), heads[idx+1]||null);}
    bodyRows.forEach(function(tr){var cells=[].slice.call(tr.children);var vi=findVillageIndex(cells);var v=vi>=0?byVillage[norm(cells[vi].textContent)]:null;var cluster=v?v.cluster:'';tr.setAttribute('data-fbms-cluster',cluster);if(head.textContent.indexOf('Cluster')>=0 && !tr.getAttribute('data-fbms-cluster-added')){tr.insertBefore(makeCell(doc,'td',cluster),cells[(vi>=0?vi:idx)+1]||null);tr.setAttribute('data-fbms-cluster-added','1');}});
    done.add(table);return true;
  }
  function enhanceRtTable(doc,table){
    var rows=[].slice.call(table.querySelectorAll('tr')); if(rows.length<2)return false;
    var bodyRows=rows.slice(1), hits=0;
    bodyRows.forEach(function(tr){if(matchRt(tr.textContent))hits++;});
    if(hits<2)return false;
    var head=rows[0]; if(head.textContent.indexOf('ID RT')<0)head.insertBefore(makeCell(doc,'th','ID RT'), head.children[0]||null); if(head.textContent.indexOf('Cluster')<0)head.appendChild(makeCell(doc,'th','Cluster'));
    bodyRows.forEach(function(tr){var r=matchRt(tr.textContent);var cluster=r?r.cluster:'';tr.setAttribute('data-fbms-cluster',cluster);if(!tr.getAttribute('data-fbms-rt-added')){tr.insertBefore(makeCell(doc,'td',r?r.id_rt:''),tr.children[0]||null);tr.appendChild(makeCell(doc,'td',cluster));tr.setAttribute('data-fbms-rt-added','1');}});
    done.add(table);return true;
  }
  function scan(){
    var iframe=document.querySelector('iframe'); if(!iframe||!iframe.contentDocument)return;
    var doc=iframe.contentDocument;
    var touched=false;
    [].slice.call(doc.querySelectorAll('table')).forEach(function(t){if(done.has(t))return;if(enhanceRtTable(doc,t)||enhanceVillageTable(doc,t))touched=true;});
    if(doc.querySelector('tr[data-fbms-cluster]')){ensureFilter(doc);applyClusterFilter(doc);}
  }
  ensureSupabase(function(){loadData().then(function(){setInterval(scan,1200);scan();});});
})();
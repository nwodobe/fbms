(function(){
  'use strict';
  var SUPABASE_URL='https://jmbdgpdthzpszfnddwzi.supabase.co';
  var SUPABASE_ANON='sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d';
  var CDN='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  var villages=[], rts=[], byVillage={}, clusters=[], done=new WeakSet();
  var FILTER_ID='fbms-cluster-filter';
  // Normalisation robuste : ignore casse, accents, espaces ET ponctuation
  // (apostrophes, tirets\u2026), pour que "YAO N'GUESSAN TH\u00c9ODORE" == "YAO NGUESSAN THEODORE".
  function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function ensureSupabase(cb){if(window.supabase&&window.supabase.createClient)return cb();var s=document.createElement('script');s.src=CDN;s.onload=cb;document.head.appendChild(s);}
  async function loadData(){
    var sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON);
    var vr=await sb.from('villages').select('id,village,cluster,data').eq('deleted',false);
    var rr=await sb.from('rt').select('id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,score,data').eq('deleted',false);
    villages=(vr.data||[]).map(function(v){var name=v.village||(v.data&&v.data.s1&&v.data.s1.village)||'';var cl=v.cluster||(v.data&&v.data.s1&&v.data.s1.cluster)||'';return {id:v.id,name:name,cluster:String(cl||'').trim()};});
    rts=(rr.data||[]).map(function(r){return {id:r.id,id_rt:r.id_rt||(r.data&&r.data.idRt)||'',nom:r.nom||(r.data&&r.data.nom)||'',telephone:r.telephone||(r.data&&r.data.telephone)||'',village_id:r.village_id||(r.data&&r.data.villageId)||'',village_nom:r.village_nom||(r.data&&r.data.villageNom)||'',cluster:String(r.cluster||(r.data&&r.data.cluster)||'').trim(),statut:r.statut||(r.data&&r.data.statut)||'Pressenti',score:r.score||(r.data&&r.data.score)||50};});
    byVillage={}; villages.forEach(function(v){byVillage[norm(v.name)]=v;});
    var seen={}; clusters=[];
    villages.concat(rts).forEach(function(x){var c=String(x.cluster||'').trim(); if(c&&!seen[norm(c)]){seen[norm(c)]=1; clusters.push(c);}});
    clusters.sort(function(a,b){return a.localeCompare(b,'fr');});
  }
  function makeCell(doc,tag,text){var c=doc.createElement(tag);c.textContent=text||'';c.className='px-3 py-2 whitespace-nowrap';return c;}
  // Cellule HTML (pour réutiliser le design natif : pastille, jauge, icônes).
  function makeHTMLCell(doc,html,cls,style){var c=doc.createElement('td');c.className=cls||'px-4 py-2.5 whitespace-nowrap';if(style)c.setAttribute('style',style);c.innerHTML=html==null?'':html;return c;}
  // Fonctions natives de l'app (même domaine → accessibles via l'iframe), avec repli.
  function appWin(doc){return (doc&&doc.defaultView)||((document.querySelector('iframe')||{}).contentWindow)||null;}
  function nPill(w,s){s=s||'Pressenti';try{if(w&&typeof w.rtStatutPill==='function')return w.rtStatutPill(s);}catch(e){}var m={'Confirmé':'#8DC556','Confirme':'#8DC556','Actif':'#008F37','Écarté':'#C0392B','Ecarté':'#C0392B'},c=m[s]||'#7A7878';return '<span style="display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;white-space:nowrap;background:'+c+'1A;color:'+c+'">'+esc(s)+'</span>';}
  function nGauge(w,sc){var v=Number(sc)||0;try{if(w&&typeof w.scoreCompassSVG==='function')return w.scoreCompassSVG(v,30);}catch(e){}return '<span style="font-family:ui-monospace,monospace;font-weight:700;color:#053B23">'+v+'</span>';}
  function nIcon(w,name){try{if(w&&typeof w.icon==='function')return w.icon(name,'w-4 h-4');}catch(e){}return '';}
  function nCanDelete(w){try{if(w&&typeof w.canDelete==='function')return !!w.canDelete();}catch(e){}return false;}
  function findVillageIndex(cells){for(var i=0;i<cells.length;i++){if(byVillage[norm(cells[i].textContent)])return i;}return -1;}
  function matchRt(rowText){var nr=norm(rowText);for(var i=0;i<rts.length;i++){var r=rts[i];if(r.nom&&nr.indexOf(norm(r.nom))>=0)return r;}return null;}
  function getSelectedCluster(doc){var s=doc.getElementById(FILTER_ID);return s?String(s.value||''):'';}
  function applyClusterFilter(doc){
    var selected=norm(getSelectedCluster(doc));
    var visible=0,total=0;
    [].slice.call(doc.querySelectorAll('tr[data-fbms-cluster]')).forEach(function(tr){total++; var ok=!selected || norm(tr.getAttribute('data-fbms-cluster'))===selected; tr.style.display=ok?'':'none'; if(ok)visible++;});
    var n=doc.getElementById('fbms-cluster-filter-note'); if(n)n.textContent=selected?visible+' ligne(s) affichée(s) sur '+total:'Tous les clusters affichés';
  }
  function sortClusterRows(doc,dir){
    [].slice.call(doc.querySelectorAll('table')).forEach(function(table){var rows=[].slice.call(table.querySelectorAll('tr[data-fbms-cluster]')); if(rows.length<2)return; rows.sort(function(a,b){var ca=norm(a.getAttribute('data-fbms-cluster'));var cb=norm(b.getAttribute('data-fbms-cluster'));var c=ca.localeCompare(cb,'fr');if(c===0)c=norm(a.textContent).localeCompare(norm(b.textContent),'fr');return dir==='desc'?-c:c;});var parent=rows[0].parentNode;rows.forEach(function(r){parent.appendChild(r);});});
    localStorage.setItem('fbms_cluster_sort',dir||'asc'); applyClusterFilter(doc); var n=doc.getElementById('fbms-cluster-filter-note'); if(n)n.textContent=(n.textContent||'')+' · tri cluster '+(dir==='desc'?'Z→A':'A→Z');
  }
  function ensureFilter(doc){
    if(!doc.querySelector('table'))return; if(doc.getElementById(FILTER_ID))return;
    var firstTable=doc.querySelector('table'), box=doc.createElement('div'); box.id='fbms-cluster-filter-box';
    box.setAttribute('style','margin:10px 0 12px;padding:12px;border:1px solid #E4DFD1;border-radius:14px;background:#fff;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 4px 14px rgba(5,59,35,.06)');
    box.innerHTML='<label for="'+FILTER_ID+'" style="font-weight:800;color:#053B23;font-size:13px">Cluster</label><select id="'+FILTER_ID+'" style="border:1px solid #D9D3C3;border-radius:10px;padding:8px 10px;min-width:220px"><option value="">Tous les clusters</option>'+clusters.map(function(c){return '<option value="'+esc(c)+'">'+esc(c)+'</option>';}).join('')+'</select><button type="button" id="fbms-cluster-sort-asc" style="border:0;border-radius:10px;background:#053B23;color:#fff;font-weight:800;padding:8px 10px;cursor:pointer">Trier A→Z</button><button type="button" id="fbms-cluster-sort-desc" style="border:0;border-radius:10px;background:#8DC556;color:#053B23;font-weight:800;padding:8px 10px;cursor:pointer">Trier Z→A</button><button type="button" id="fbms-cluster-clear" style="border:1px solid #D9D3C3;border-radius:10px;background:#fff;color:#053B23;font-weight:800;padding:8px 10px;cursor:pointer">Réinitialiser</button><span id="fbms-cluster-filter-note" style="font-size:12px;color:#6B6458">Tous les clusters affichés</span>';
    var tableWrap=firstTable.closest('.rounded-xl,.overflow-hidden,section,div')||firstTable; tableWrap.parentNode.insertBefore(box,tableWrap);
    var saved=localStorage.getItem('fbms_cluster_filter')||'', sel=doc.getElementById(FILTER_ID); if(saved)sel.value=saved;
    sel.addEventListener('change',function(){localStorage.setItem('fbms_cluster_filter',this.value||'');applyClusterFilter(doc);}); doc.getElementById('fbms-cluster-sort-asc').addEventListener('click',function(){sortClusterRows(doc,'asc');}); doc.getElementById('fbms-cluster-sort-desc').addEventListener('click',function(){sortClusterRows(doc,'desc');}); doc.getElementById('fbms-cluster-clear').addEventListener('click',function(){sel.value='';localStorage.removeItem('fbms_cluster_filter');applyClusterFilter(doc);});
  }
  function enhanceVillageTable(doc,table){
    var rows=[].slice.call(table.querySelectorAll('tr')); if(rows.length<2)return false; var bodyRows=rows.slice(1), hits=0, idx=-1;
    bodyRows.forEach(function(tr){var cells=[].slice.call(tr.children);var vi=findVillageIndex(cells);if(vi>=0){hits++;if(idx<0)idx=vi;}}); if(hits<2)return false;
    var head=rows[0], heads=[].slice.call(head.children); if(head.textContent.indexOf('Cluster')<0){var th=makeCell(doc,'th','Cluster');th.title='Cluster ajouté automatiquement';head.insertBefore(th, heads[idx+1]||null);}
    bodyRows.forEach(function(tr){var cells=[].slice.call(tr.children);var vi=findVillageIndex(cells);var v=vi>=0?byVillage[norm(cells[vi].textContent)]:null;var cluster=v?v.cluster:'';tr.setAttribute('data-fbms-cluster',cluster);if(!tr.getAttribute('data-fbms-cluster-added')){tr.insertBefore(makeCell(doc,'td',cluster),cells[(vi>=0?vi:idx)+1]||null);tr.setAttribute('data-fbms-cluster-added','1');}});
    done.add(table);return true;
  }
  function isRtTable(table){var h=norm((table.querySelector('thead')||table.rows[0]||table).textContent);return h.indexOf('TELEPHONE')>=0 && h.indexOf('VILLAGE')>=0 && h.indexOf('STATUT')>=0 && (h.indexOf('PRODUCTEURS')>=0 || h.indexOf('SCORE')>=0);}
  function appendMissingRtRows(doc,table){
    var tbody=table.querySelector('tbody')||table; var text=norm(table.textContent); var head=table.querySelector('tr'); if(!head)return;
    if(head.textContent.indexOf('ID RT')<0)head.insertBefore(makeCell(doc,'th','ID RT'),head.children[0]||null); if(head.textContent.indexOf('Cluster')<0)head.appendChild(makeCell(doc,'th','Cluster'));
    var w=appWin(doc);
    rts.forEach(function(r){
      if(!r.nom||text.indexOf(norm(r.nom))>=0)return;
      var tr=doc.createElement('tr');
      tr.setAttribute('data-fbms-cluster',r.cluster||'');
      tr.setAttribute('data-fbms-forced-rt','1');
      tr.setAttribute('style','border-top:1px solid #E4DFD1');
      // Mêmes colonnes et même design que les lignes natives de la Base RT.
      tr.appendChild(makeHTMLCell(doc,esc(r.id_rt||'—'),'px-4 py-2.5 ff-mono text-xs','color:#7A7878'));
      tr.appendChild(makeHTMLCell(doc,esc(r.nom),'px-4 py-2.5 ff-body font-medium','color:#323131'));
      tr.appendChild(makeHTMLCell(doc,esc(r.telephone||'—'),'px-4 py-2.5 ff-mono text-xs','color:#7A7878'));
      tr.appendChild(makeHTMLCell(doc,esc(r.village_nom||'—'),'px-4 py-2.5 ff-body text-xs','color:#7A7878'));
      tr.appendChild(makeHTMLCell(doc,nPill(w,r.statut||'Pressenti'),'px-4 py-2.5'));
      tr.appendChild(makeHTMLCell(doc,nGauge(w,r.score||50),'px-4 py-2.5'));
      tr.appendChild(makeHTMLCell(doc,'—','px-4 py-2.5 ff-mono text-xs','color:#7A7878'));
      var pen=nIcon(w,'pencil'), tra=nIcon(w,'trash-2'), act='';
      if(pen)act+='<button class="p-1.5" title="Éditer" onclick="openRTModal(\''+esc(r.id)+'\')">'+pen+'</button>';
      if(tra&&nCanDelete(w))act+='<button class="p-1.5" title="Supprimer" onclick="deleteRT(\''+esc(r.id)+'\')">'+tra+'</button>';
      tr.appendChild(makeHTMLCell(doc,act,'px-4 py-2.5 text-right whitespace-nowrap'));
      tr.appendChild(makeHTMLCell(doc,esc(r.cluster||''),'px-4 py-2.5'));
      tbody.appendChild(tr); text+=' '+norm(r.nom);
    });
  }
  function enhanceRtTable(doc,table){
    var rows=[].slice.call(table.querySelectorAll('tr')); if(rows.length<1)return false; var bodyRows=rows.slice(1), hits=0; bodyRows.forEach(function(tr){if(matchRt(tr.textContent))hits++;});
    if(hits<2 && !isRtTable(table))return false; var head=rows[0]; if(head.textContent.indexOf('ID RT')<0)head.insertBefore(makeCell(doc,'th','ID RT'), head.children[0]||null); if(head.textContent.indexOf('Cluster')<0)head.appendChild(makeCell(doc,'th','Cluster'));
    bodyRows.forEach(function(tr){var r=matchRt(tr.textContent);var cluster=r?r.cluster:'';tr.setAttribute('data-fbms-cluster',cluster);if(!tr.getAttribute('data-fbms-rt-added')){tr.insertBefore(makeCell(doc,'td',r?r.id_rt:''),tr.children[0]||null);tr.appendChild(makeCell(doc,'td',cluster));tr.setAttribute('data-fbms-rt-added','1');}});
    appendMissingRtRows(doc,table); done.add(table);return true;
  }
  function scan(){
    var iframe=document.querySelector('iframe'); if(!iframe||!iframe.contentDocument)return; var doc=iframe.contentDocument;
    [].slice.call(doc.querySelectorAll('table')).forEach(function(t){if(done.has(t))return;if(!enhanceRtTable(doc,t))enhanceVillageTable(doc,t);});
    if(doc.querySelector('tr[data-fbms-cluster]')){ensureFilter(doc);var savedSort=localStorage.getItem('fbms_cluster_sort');if(savedSort&&!doc.body.getAttribute('data-fbms-cluster-sorted')){sortClusterRows(doc,savedSort);doc.body.setAttribute('data-fbms-cluster-sorted','1');}applyClusterFilter(doc);}
  }
  ensureSupabase(function(){loadData().then(function(){setInterval(scan,1200);scan();});});
})();
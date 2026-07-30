/* ============================================================================
   ANAGROCI FBMS - AUDIT DISTANCES FIX
   Fix hub GPS save: hubs_clusters primary key is id_hub, not id.
   This version does not depend on window.H. It resolves id_hub directly from Supabase.
   Non-destructive runtime patch for fbms/audit_distances.html only.
   ========================================================================== */
(function(){
  'use strict';
  if(!/\/fbms\/audit_distances\.html$/.test(location.pathname)) return;

  function el(id){ return document.getElementById(id); }
  function num(x){ var v=parseFloat(String(x==null?'':x).replace(',','.')); return Number.isFinite(v)?v:null; }
  function show(message, ok){
    var m=el('msg');
    if(!m){ alert(message); return; }
    m.className='msg '+(ok?'good':'');
    if(!ok) m.style.borderColor='#e7b7b0';
    if(!ok) m.style.background='#fff1f1';
    if(!ok) m.style.color='#8f2d22';
    if(ok){ m.style.borderColor=''; m.style.background=''; m.style.color=''; }
    m.textContent=message;
  }

  async function resolveHubByName(hubName){
    if(!window.SB) throw new Error('Connexion Supabase indisponible sur cette page.');
    var name = String(hubName||'').trim();
    if(!name) throw new Error('Aucun hub sélectionné.');
    var res = await window.SB
      .from('hubs_clusters')
      .select('id_hub,nom,gps_lat,gps_lng')
      .eq('deleted', false)
      .eq('nom', name)
      .maybeSingle();
    if(res.error) throw new Error(res.error.message || 'Erreur Supabase lors de la recherche du hub.');
    if(!res.data || !res.data.id_hub) throw new Error('Hub introuvable ou id_hub manquant pour : '+name+'. Rechargez les données puis réessayez.');
    return res.data;
  }

  function patchSaveHub(){
    if(typeof window.saveHub!=='function' || window.saveHub.__idHubFixDirect) return;
    window.saveHub = async function(){
      try{
        var hubName = el('hub') ? el('hub').value : '';
        var la = num(el('lat') && el('lat').value);
        var ln = num(el('lng') && el('lng').value);
        if(la==null || ln==null) return show('GPS hub invalide : latitude et longitude obligatoires.', false);
        if(la < -90 || la > 90 || ln < -180 || ln > 180) return show('GPS hub invalide : coordonnées hors limites.', false);

        show('Recherche du hub et enregistrement GPS en cours...', true);
        var hub = await resolveHubByName(hubName);
        var idHub = hub.id_hub;
        var res = await window.SB
          .from('hubs_clusters')
          .update({ gps_lat: la, gps_lng: ln, updated_at: new Date().toISOString() })
          .eq('id_hub', idHub)
          .select('id_hub,nom,gps_lat,gps_lng')
          .maybeSingle();

        if(res.error){
          console.error('[Audit distances] Erreur sauvegarde GPS hub', res.error);
          return show('Échec sauvegarde GPS hub : '+(res.error.message || 'Erreur Supabase inconnue.'), false);
        }
        if(!res.data){
          return show('Échec sauvegarde GPS hub : aucune ligne mise à jour pour id_hub='+idHub+'.', false);
        }
        if(typeof window.load==='function') await window.load();
        show('GPS hub enregistré.', true);
      }catch(e){
        console.error('[Audit distances] Exception sauvegarde GPS hub', e);
        show('Échec sauvegarde GPS hub : '+(e && e.message ? e.message : e), false);
      }
    };
    window.saveHub.__idHubFixDirect=true;
  }

  function init(){ patchSaveHub(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 500); });
  else setTimeout(init, 500);
})();

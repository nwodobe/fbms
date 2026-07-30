/* ============================================================================
   ANAGROCI FBMS - AUDIT DISTANCES FIX
   Fix hub GPS save: hubs_clusters primary key is id_hub, not id.
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

  function patchSaveHub(){
    if(typeof window.saveHub!=='function' || window.saveHub.__idHubFix) return;
    window.saveHub = async function(){
      try{
        var hubName = el('hub') ? el('hub').value : '';
        var h = (window.H || []).find(function(x){ return x && x.nom === hubName; });
        var la = num(el('lat') && el('lat').value);
        var ln = num(el('lng') && el('lng').value);
        if(!h) return show('Impossible d’enregistrer : hub introuvable en mémoire.', false);
        var idHub = h.id_hub || h.ID_HUB || h.idHub || h.id;
        if(!idHub){
          return show('Impossible d’enregistrer : identifiant id_hub manquant pour le hub '+(h.nom||hubName)+'. Rechargez les données puis réessayez.', false);
        }
        if(la==null || ln==null) return show('GPS hub invalide : latitude et longitude obligatoires.', false);
        if(la < -90 || la > 90 || ln < -180 || ln > 180) return show('GPS hub invalide : coordonnées hors limites.', false);
        if(!window.SB) return show('Connexion Supabase indisponible sur cette page.', false);

        show('Enregistrement GPS hub en cours...', true);
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
        show('GPS hub enregistré pour '+(res.data.nom || h.nom || hubName)+' avec id_hub='+idHub+'.', true);
      }catch(e){
        console.error('[Audit distances] Exception sauvegarde GPS hub', e);
        show('Échec sauvegarde GPS hub : '+(e && e.message ? e.message : e), false);
      }
    };
    window.saveHub.__idHubFix=true;
  }

  function init(){ patchSaveHub(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 500); });
  else setTimeout(init, 500);
})();

/* Doublure de shared/auth-gate.js pour la recette AFLP FIELD PROOF.
   Reproduit le contrat public du vrai portail (window.ANAGROCI_AUTH +
   événement « anagroci:authenticated ») avec un profil FICTIF.
   Le niveau est lu dans localStorage (fp_test_niveau) pour jouer plusieurs rôles. */
(function () {
  'use strict';
  window.ANAGROCI_SUPABASE_URL = 'https://jmbdgpdthzpszfnddwzi.supabase.co';
  window.ANAGROCI_SUPABASE_ANON = 'doublure-sans-secret';
  var niveau = 'chef'; try { niveau = localStorage.getItem('fp_test_niveau') || 'chef'; } catch (e) {}
  var prof = { user_id: '00000000-0000-4000-9000-0000000000f1', nom: 'AGENT FICTIF E2E', email: 'agent@example.invalid', role: niveau === 'agent' ? 'Agent Recenseur' : 'Unit Head', cluster: 'BOTRO', actif: true };
  function go() {
    var slot = document.getElementById('anagroci-userslot'); if (slot) slot.textContent = prof.nom;
    window.ANAGROCI_AUTH = { profile: prof, niveau: niveau, estBM: false, module: 'fbms', signOut: function () {} };
    document.dispatchEvent(new CustomEvent('anagroci:authenticated', { detail: window.ANAGROCI_AUTH }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 0); }); else setTimeout(go, 0);
})();

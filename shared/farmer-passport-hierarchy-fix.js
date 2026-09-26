/* ANAGROCI FBMS - Farmer Passport canonical hierarchy resolver
   Ensures passport opens the canonical server-side farmer row when a stale
   local TMP record still exists for the same person. */
(function (global) {
  'use strict';

  if (global.FARMER_PASSPORT_HIERARCHY_FIX) return;

  var VERSION = '1.0.0';
  var originalOpen = null;

  function digits(value) {
    var d = String(value || '').replace(/\D/g, '');
    if (d.length === 13 && d.slice(0, 3) === '225') d = d.slice(3);
    return d;
  }

  function producerFromState(id) {
    return typeof STATE !== 'undefined' && STATE.producteurs
      ? STATE.producteurs.find(function (p) { return p && p.id === id; }) : null;
  }

  function online() {
    return typeof SB !== 'undefined' && !!SB
      && typeof isSupabase === 'function' && isSupabase()
      && global.navigator && navigator.onLine;
  }

  async function canonicalId(id) {
    if (!online()) return id;

    var direct = await SB.from('farmer_passport_summary_v')
      .select('producteur_id,farmer_id,telephone,village_id,rt_id,cluster_label,zone_label,rt_nom')
      .eq('producteur_id', id).eq('deleted', false).maybeSingle();
    if (!direct.error && direct.data) return direct.data.producteur_id;

    var local = producerFromState(id);
    if (!local) return id;

    var phone = digits(local.telephone);
    var villageId = local.villageId || '';
    if (!phone || !villageId) return id;

    var response = await SB.from('farmer_passport_summary_v')
      .select('producteur_id,farmer_id,telephone,village_id,rt_id,cluster_label,zone_label,rt_nom')
      .eq('village_id', villageId).eq('deleted', false);
    if (response.error || !response.data) return id;

    var matches = response.data.filter(function (row) {
      return digits(row.telephone) === phone;
    });
    return matches.length === 1 ? matches[0].producteur_id : id;
  }

  function patch() {
    if (typeof global.openFarmerPassport !== 'function' || originalOpen) return false;
    originalOpen = global.openFarmerPassport;
    global.openFarmerPassport = async function (id) {
      var resolved = id;
      try { resolved = await canonicalId(id); } catch (error) { resolved = id; }
      return originalOpen.call(this, resolved);
    };
    if (global.AFLP_FARMER_REGISTRY && global.AFLP_FARMER_REGISTRY.passportUI) {
      global.AFLP_FARMER_REGISTRY.passportUI.open = global.openFarmerPassport;
    }
    return true;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (patch() || tries > 120) clearInterval(timer);
  }, 100);

  global.FARMER_PASSPORT_HIERARCHY_FIX = {
    version: VERSION,
    canonicalId: canonicalId
  };
})(window);

/* ANAGROCI FBMS - Farmer Registry append-only sync and evidence policy */
(function (global) {
  'use strict';

  function loadPrivateEvidence() {
    if (document.getElementById('farmer-registry-evidence-script')) return;
    var script = document.createElement('script');
    script.id = 'farmer-registry-evidence-script';
    script.defer = true;
    script.src = '../shared/farmer-registry-evidence.js?v=20260818-complete-1';
    document.head.appendChild(script);
  }

  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    var registry = global.AFLP_FARMER_REGISTRY;
    if (!registry || !registry.syncEngine || !registry.syncEngine.save) {
      if (attempts > 120) clearInterval(timer);
      return;
    }
    if (!registry.syncEngine.__appendOnlyPolicy) {
      var originalSave = registry.syncEngine.save;
      var appendOnly = {
        farmer_verifications: true,
        participants_formation: true
      };
      registry.syncEngine.save = function (table, row, options) {
        options = Object.assign({}, options || {});
        if (appendOnly[table]) options.insertOnly = true;
        return originalSave.call(this, table, row, options);
      };
      registry.syncEngine.__appendOnlyPolicy = true;
    }
    loadPrivateEvidence();
    clearInterval(timer);
  }, 50);
})(window);

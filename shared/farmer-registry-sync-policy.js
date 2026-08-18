/* ANAGROCI FBMS - Farmer Registry append-only sync policy */
(function (global) {
  'use strict';
  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    var registry = global.AFLP_FARMER_REGISTRY;
    if (!registry || !registry.syncEngine || !registry.syncEngine.save) {
      if (attempts > 120) clearInterval(timer);
      return;
    }
    if (registry.syncEngine.__appendOnlyPolicy) {
      clearInterval(timer);
      return;
    }
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
    clearInterval(timer);
  }, 50);
})(window);

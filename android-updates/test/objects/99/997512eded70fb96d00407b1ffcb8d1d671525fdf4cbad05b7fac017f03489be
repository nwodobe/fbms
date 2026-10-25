/* ANAGROCI FBMS - Farmer Registry runtime safety guards */
(function (global) {
  'use strict';
  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    var FR = global.AFLP_FARMER_REGISTRY;
    if (!FR || !FR.operations || !FR.syncEngine
        || typeof global.openSustainabilityBaselineForm !== 'function'
        || typeof global.openFarmerInspectionForm !== 'function'
        || typeof global.openFarmerVerificationForm !== 'function'
        || typeof global.saveFarmerVerification !== 'function') {
      if (attempts > 140) clearInterval(timer);
      return;
    }
    clearInterval(timer);
    if (FR.runtimeGuards) return;

    var originals = {
      sustainability: global.openSustainabilityBaselineForm,
      inspection: global.openFarmerInspectionForm,
      verification: global.openFarmerVerificationForm,
      saveVerification: global.saveFarmerVerification,
    };

    function catalogReady() {
      var catalog = FR.state && FR.state.data && FR.state.data.catalog;
      if (Array.isArray(catalog) && catalog.length > 0) return true;
      alert(
        'Le catalogue Sustainability n’est pas encore disponible sur cet appareil. '
        + 'Ouvrez une fois le Farmer Passport avec une connexion, puis reprenez la saisie hors ligne.'
      );
      return false;
    }

    async function verificationReady() {
      if (!FR.syncEngine.online()) {
        alert('La vérification du Farmer Passport exige une connexion active.');
        return false;
      }
      var producteurId = FR.state && FR.state.producerId;
      var pending = await FR.syncEngine.pendingCount(producteurId);
      if (pending > 0) {
        alert(
          'Vérification bloquée : ' + pending
          + ' opération(s) de ce producteur doivent d’abord être synchronisées.'
        );
        return false;
      }
      return true;
    }

    global.openSustainabilityBaselineForm = function () {
      if (!catalogReady()) return false;
      return originals.sustainability.apply(this, arguments);
    };
    global.openFarmerInspectionForm = function () {
      if (!catalogReady()) return false;
      return originals.inspection.apply(this, arguments);
    };
    global.openFarmerVerificationForm = async function () {
      if (!(await verificationReady())) return false;
      return originals.verification.apply(this, arguments);
    };
    global.saveFarmerVerification = async function () {
      if (!(await verificationReady())) return false;
      return originals.saveVerification.apply(this, arguments);
    };

    FR.runtimeGuards = {
      version: '1.0.0',
      installed: true,
      catalogRequiredOffline: true,
      verificationRequiresOnlineSync: true,
    };
  }, 100);
})(window);

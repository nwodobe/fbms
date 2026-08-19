/* ANAGROCI FBMS - Farmer Registry Phase 1 read model */
(function (global) {
  'use strict';

  if (global.FARMER_REGISTRY_READ_PHASE1) return;

  function supabaseReady() {
    return typeof SB !== 'undefined' && !!SB
      && typeof isSupabase === 'function' && isSupabase();
  }

  function install() {
    if (typeof RemoteProducteurs === 'undefined' || !RemoteProducteurs
        || typeof RemoteProducteurs.listByVillage !== 'function'
        || RemoteProducteurs.listByVillage.__farmerRegistryRead) return false;

    var original = RemoteProducteurs.listByVillage;
    var patched = async function (villageId) {
      if (!supabaseReady()) return original.apply(this, arguments);

      var response = await SB.from('producteurs')
        .select('data,code,created_at,updated_at,created_by,updated_by,passport_stage,passport_completion,risk_profile,consent_status,possible_duplicate,review_required,review_reason,record_version,operational_status,prenoms,age_band,telephone_alt,preferred_language,id_document_type,sexe,birth_year')
        .eq('village_id', villageId)
        .eq('deleted', false);
      if (response.error) throw new Error(response.error.message);

      return (response.data || []).map(function (row) {
        var legacy = row.data || {};
        return Object.assign({}, legacy, {
          code: row.code,
          prenoms: row.prenoms || legacy.prenoms || '',
          sexe: legacy.sexe || (row.sexe === 'M' ? 'Homme' : row.sexe === 'F' ? 'Femme' : ''),
          anneeNaissance: legacy.anneeNaissance || row.birth_year || '',
          ageBand: row.age_band || legacy.ageBand || '',
          telephoneAlt: row.telephone_alt || legacy.telephoneAlt || '',
          preferredLanguage: row.preferred_language || legacy.preferredLanguage || 'FR',
          pieceType: row.id_document_type || legacy.pieceType || '',
          operationalStatus: row.operational_status || 'ACTIVE',
          passportStage: row.passport_stage || 'INCOMPLETE',
          passportCompletion: Number(row.passport_completion) || 0,
          riskProfile: row.risk_profile || 'NOT_ASSESSED',
          consentStatus: row.consent_status || 'NOT_RECORDED',
          possibleDuplicate: !!row.possible_duplicate,
          reviewRequired: !!row.review_required,
          reviewReason: row.review_reason || '',
          recordVersion: row.record_version || 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          createdBy: row.created_by || '',
          updatedBy: row.updated_by || ''
        });
      });
    };

    patched.__farmerRegistryRead = true;
    patched.__original = original;
    RemoteProducteurs.listByVillage = patched;
    global.FARMER_REGISTRY_READ_PHASE1 = { version: '1.0.0', installed: true };
    return true;
  }

  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    if (install() || attempts > 80) clearInterval(timer);
  }, 100);
})(window);

/* ANAGROCI FBMS - Farmer Registry Phase 1 privacy compatibility guards */
(function (global) {
  'use strict';

  if (global.FARMER_REGISTRY_PRIVACY_PHASE1) return;

  var originals = {};

  function field(id) { return document.getElementById(id); }
  function newUuid() {
    try { return crypto.randomUUID(); }
    catch (error) {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
        var random = Math.random() * 16 | 0;
        var value = char === 'x' ? random : (random & 3 | 8);
        return value.toString(16);
      });
    }
  }

  function connected() {
    return navigator.onLine !== false
      && typeof AUTH !== 'undefined'
      && typeof AUTH.isConnected === 'function'
      && AUTH.isConnected();
  }

  function supabaseReady() {
    return connected() && typeof SB !== 'undefined' && !!SB
      && typeof isSupabase === 'function' && isSupabase();
  }

  function appendReason(current, reason) {
    var text = String(current || '').trim();
    if (text.indexOf(reason) >= 0) return text;
    return text ? text + ' · ' + reason : reason;
  }

  function patchSave() {
    if (typeof global.saveProducteur !== 'function' || originals.save) return;
    originals.save = global.saveProducteur;

    global.saveProducteur = async function () {
      var pieceField = field('pPieceNum');
      var pieceNumber = pieceField ? String(pieceField.value || '').trim() : '';

      if (pieceNumber && !connected() && typeof PROD_EDIT !== 'undefined' && PROD_EDIT) {
        alert(
          'Protection des données personnelles : le numéro de pièce ne sera pas conservé hors ligne. '
          + 'Le producteur peut être enrôlé maintenant, puis la pièce complétée après reconnexion.'
        );
        pieceField.value = '';
        PROD_EDIT.pieceNum = '';
        PROD_EDIT.reviewRequired = true;
        PROD_EDIT.reviewReason = appendReason(
          PROD_EDIT.reviewReason,
          'DOCUMENT IDENTITE A COMPLETER EN LIGNE'
        );
      }

      return originals.save.apply(this, arguments);
    };
  }

  async function latestIdentityDocument(producteurId) {
    if (!supabaseReady() || !producteurId) return null;
    try {
      var response = await SB.from('farmer_identity_documents')
        .select('id,document_type,document_number,status,created_at')
        .eq('producteur_id', producteurId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (response.error) return null;
      return response.data || null;
    } catch (error) {
      return null;
    }
  }

  function patchRemoteUpsert() {
    if (typeof RemoteProducteurs === 'undefined' || !RemoteProducteurs
        || typeof RemoteProducteurs.upsert !== 'function' || originals.upsert) return;
    originals.upsert = RemoteProducteurs.upsert;

    RemoteProducteurs.upsert = async function (producer) {
      if (!supabaseReady() || !producer || !producer.id) {
        return originals.upsert.apply(this, arguments);
      }

      var current = await latestIdentityDocument(producer.id);
      var nextNumber = String(producer.pieceNum || '').trim();
      var nextType = String(producer.pieceType || '').trim();
      var withdrawalRequested = current
        && current.status !== 'WITHDRAWN'
        && (!nextNumber || !nextType || nextType === 'Aucune');

      if (current && nextNumber && nextType && nextType !== 'Aucune') {
        if (current.document_number === nextNumber && current.document_type === nextType) {
          producer.identityDocumentId = current.id;
          producer.identityDocumentOriginalNumber = current.document_number;
          producer.identityDocumentOriginalType = current.document_type;
        } else {
          producer.identityDocumentId = null;
        }
      } else if (!current) {
        producer.identityDocumentId = null;
      }

      var result = await originals.upsert.apply(this, arguments);

      if (withdrawalRequested) {
        var withdrawalId = newUuid();
        var response = await SB.from('farmer_identity_documents').insert({
          id: withdrawalId,
          producteur_id: producer.id,
          status: 'WITHDRAWN',
          source: 'FIELD_ENROLLMENT',
          supersedes_id: current.id
        });
        if (response.error) throw new Error(response.error.message);
        producer.identityDocumentId = withdrawalId;
        producer.identityDocumentOriginalNumber = '';
        producer.identityDocumentOriginalType = '';
        if (result && result.producteur) {
          result.producteur.identityDocumentId = withdrawalId;
          result.producteur.pieceNum = '';
          result.producteur.pieceType = nextType || 'Aucune';
        }
      }

      return result;
    };
  }

  function install() {
    if (!global.FARMER_ENROLLMENT_PHASE1
        || !global.FARMER_ENROLLMENT_PHASE1.installed) return false;
    if (typeof global.saveProducteur !== 'function'
        || typeof RemoteProducteurs === 'undefined') return false;

    patchSave();
    patchRemoteUpsert();
    global.FARMER_REGISTRY_PRIVACY_PHASE1 = {
      version: '1.0.0',
      installed: true
    };
    return true;
  }

  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    if (install() || attempts > 100) clearInterval(timer);
  }, 100);
})(window);

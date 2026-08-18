/* ANAGROCI FBMS - Farmer Registry Phase 1 privacy compatibility guards */
(function (global) {
  'use strict';

  if (global.FARMER_REGISTRY_PRIVACY_PHASE1) return;

  var originals = {};

  function field(id) { return document.getElementById(id); }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

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

  function sanitizedLocalProducer(producer) {
    var safe = clone(producer);
    delete safe.pieceNum;
    delete safe.idDocumentNumber;
    delete safe.identityDocumentOriginalNumber;
    return safe;
  }

  function patchLocalAdapter() {
    if (typeof PROD_ADAPTER === 'undefined' || !PROD_ADAPTER
        || typeof PROD_ADAPTER.upsert !== 'function' || originals.adapterUpsert) return;

    originals.adapterUpsert = PROD_ADAPTER.upsert;
    PROD_ADAPTER.upsert = function (producer) {
      return originals.adapterUpsert.call(this, sanitizedLocalProducer(producer));
    };

    Promise.resolve(PROD_ADAPTER.list()).then(function (rows) {
      return Promise.all((rows || []).filter(function (row) {
        return row && (row.pieceNum || row.idDocumentNumber || row.identityDocumentOriginalNumber);
      }).map(function (row) {
        return PROD_ADAPTER.upsert(row);
      }));
    }).catch(function () { /* nettoyage local non bloquant */ });
  }

  function patchSave() {
    if (typeof global.saveProducteur !== 'function' || originals.save) return;
    originals.save = global.saveProducteur;

    global.saveProducteur = async function () {
      var producer = typeof PROD_EDIT !== 'undefined' ? PROD_EDIT : null;
      var pieceField = field('pPieceNum');
      var pieceNumber = pieceField ? String(pieceField.value || '').trim() : '';
      var couldSendPrivately = pieceNumber && supabaseReady();

      var result = await originals.save.apply(this, arguments);
      if (!result || !pieceNumber || !producer) return result;

      if (!couldSendPrivately || producer._sync !== 'synced') {
        producer.pieceNum = '';
        producer.reviewRequired = true;
        producer.reviewReason = appendReason(
          producer.reviewReason,
          'DOCUMENT IDENTITE A COMPLETER EN LIGNE'
        );
        try {
          await PROD_ADAPTER.upsert(producer);
          if (typeof STATE !== 'undefined') STATE.producteurs = await PROD_ADAPTER.list();
          if (typeof renderContent === 'function') renderContent();
        } catch (error) { /* le garde-fou local reste best-effort */ }

        alert(
          'Protection des données personnelles : le numéro de pièce n’a pas été conservé sur le téléphone. '
          + 'L’enrôlement est sauvegardé, mais la pièce doit être complétée après une synchronisation disponible.'
        );
      }

      return result;
    };
  }

  async function latestIdentityDocument(producteurId) {
    if (!supabaseReady() || !producteurId) return null;
    try {
      var response = await SB.from('farmer_identity_documents')
        .select('id,document_type,document_number,status,event_order,created_at')
        .eq('producteur_id', producteurId)
        .eq('status', 'ACTIVE')
        .order('event_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (response.error) return null;
      return response.data || null;
    } catch (error) {
      return null;
    }
  }

  function stripSensitiveResult(result) {
    if (!result || !result.producteur) return result;
    delete result.producteur.pieceNum;
    delete result.producteur.idDocumentNumber;
    delete result.producteur.identityDocumentOriginalNumber;
    return result;
  }

  function patchRemoteUpsert() {
    if (typeof RemoteProducteurs === 'undefined' || !RemoteProducteurs
        || typeof RemoteProducteurs.upsert !== 'function' || originals.upsert) return;
    originals.upsert = RemoteProducteurs.upsert;

    RemoteProducteurs.upsert = async function (producer) {
      if (!supabaseReady() || !producer || !producer.id) {
        return stripSensitiveResult(await originals.upsert.apply(this, arguments));
      }

      var current = await latestIdentityDocument(producer.id);
      var nextNumber = String(producer.pieceNum || '').trim();
      var nextType = String(producer.pieceType || '').trim();
      var withdrawalRequested = current
        && (!nextNumber || !nextType || nextType === 'Aucune');

      if (current && nextNumber && nextType && nextType !== 'Aucune') {
        if (current.document_number === nextNumber && current.document_type === nextType) {
          producer.identityDocumentId = current.id;
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
        producer.identityDocumentOriginalType = '';
        if (result && result.producteur) {
          result.producteur.identityDocumentId = withdrawalId;
          result.producteur.pieceType = nextType || 'Aucune';
        }
      }

      return stripSensitiveResult(result);
    };
  }

  function install() {
    if (!global.FARMER_ENROLLMENT_PHASE1
        || !global.FARMER_ENROLLMENT_PHASE1.installed) return false;
    if (typeof global.saveProducteur !== 'function'
        || typeof RemoteProducteurs === 'undefined'
        || typeof PROD_ADAPTER === 'undefined') return false;

    patchLocalAdapter();
    patchSave();
    patchRemoteUpsert();
    global.FARMER_REGISTRY_PRIVACY_PHASE1 = {
      version: '1.2.0',
      installed: true,
      localIdentityNumbersPersisted: false
    };
    return true;
  }

  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    if (install() || attempts > 100) clearInterval(timer);
  }, 100);
})(window);

/* ANAGROCI FBMS - Farmer Registry Phase 1 enrollment extension */
(function (global) {
  'use strict';

  if (global.FARMER_ENROLLMENT_PHASE1) return;

  var VERSION = '1.1.0';
  var CONSENT_VERSION = 'AFLP-DATA-CONSENT-2026.1';
  var SCOPES = [
    'identity', 'agriculture', 'gps', 'photos',
    'training', 'inspections', 'transactions'
  ];
  var originals = {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>\"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[char];
    });
  }

  function norm(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, '');
  }

  function phoneDigits(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 13 && digits.slice(0, 3) === '225') digits = digits.slice(3);
    return digits;
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

  function profile() {
    return (global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile)
      || (typeof AUTH !== 'undefined' && AUTH.session)
      || {};
  }

  function supabaseReady() {
    return typeof SB !== 'undefined' && !!SB
      && typeof isSupabase === 'function' && isSupabase();
  }

  function field(id) { return document.getElementById(id); }
  function value(id) { var element = field(id); return element ? String(element.value || '').trim() : ''; }
  function checked(id) { var element = field(id); return !!(element && element.checked); }
  function setValue(id, next) { var element = field(id); if (element) element.value = next == null ? '' : next; }
  function setChecked(id, next) { var element = field(id); if (element) element.checked = !!next; }
  function asBoolean(value) { return value === true || value === 'true'; }

  function consentFingerprint(consent) {
    return JSON.stringify({
      status: consent.status || '',
      method: consent.method || '',
      scopes: consent.scopes || {},
      textVersion: consent.textVersion || ''
    });
  }

  function showMessage(text, kind) {
    var element = field('frpMsg');
    if (!element) {
      if (text && kind === 'error') alert(text);
      return;
    }
    element.style.display = text ? 'block' : 'none';
    element.style.background = kind === 'ok' ? '#E3F5E8' : kind === 'info' ? '#E9F1FB' : '#FDECE9';
    element.style.color = kind === 'ok' ? '#1C7A3F' : kind === 'info' ? '#2B5F9E' : '#8F2D22';
    element.style.border = '1px solid ' + (kind === 'ok' ? '#BFE3B6' : kind === 'info' ? '#BFD1E8' : '#E7B7B0');
    element.textContent = text || '';
  }

  function sexCode(value) {
    var key = norm(value);
    if (key === 'HOMME' || key === 'MALE' || key === 'M') return 'M';
    if (key === 'FEMME' || key === 'FEMALE' || key === 'F') return 'F';
    if (key === 'OTHER') return 'OTHER';
    return 'UNKNOWN';
  }

  function validBirthYear(value) {
    var year = Number(value);
    var current = new Date().getFullYear();
    return Number.isInteger(year) && year >= 1900 && year <= current ? year : null;
  }

  function defaultConsent() {
    return {
      id: newUuid(),
      status: 'NOT_RECORDED',
      method: 'VERBAL',
      consentAt: new Date().toISOString(),
      textVersion: CONSENT_VERSION,
      scopes: SCOPES.reduce(function (result, key) { result[key] = false; return result; }, {}),
      pending: true,
      originalFingerprint: '',
      pendingFingerprint: ''
    };
  }

  function ensureModel(producer) {
    if (!producer) return;
    producer.prenoms = producer.prenoms || '';
    producer.ageBand = producer.ageBand || '';
    producer.telephoneAlt = producer.telephoneAlt || '';
    producer.preferredLanguage = producer.preferredLanguage || 'FR';
    producer.operationalStatus = producer.operationalStatus || (producer.statut === 'Inactif' ? 'INACTIVE' : 'ACTIVE');
    producer.possibleDuplicate = !!producer.possibleDuplicate;
    producer.reviewRequired = !!producer.reviewRequired;
    producer.reviewReason = producer.reviewReason || '';
    producer.passportStage = producer.passportStage || 'INCOMPLETE';
    producer.passportCompletion = Number(producer.passportCompletion) || 0;
    producer.riskProfile = producer.riskProfile || 'NOT_ASSESSED';
    if (!producer.consent) producer.consent = defaultConsent();
    producer.consent.scopes = producer.consent.scopes || {};
    SCOPES.forEach(function (key) {
      if (producer.consent.scopes[key] == null) producer.consent.scopes[key] = false;
    });
    producer.consent.textVersion = producer.consent.textVersion || CONSENT_VERSION;
    producer.consent.method = producer.consent.method || 'VERBAL';
  }

  function computePassport(producer) {
    var identity = producer.nom && producer.sexe
      && (validBirthYear(producer.anneeNaissance) || producer.ageBand)
      && phoneDigits(producer.telephone).length === 10 ? 30 : 0;
    var assignment = producer.villageId && producer.rtId ? 20 : 0;
    var consent = producer.consent && producer.consent.status === 'GRANTED'
      ? 15 : producer.consent && producer.consent.status === 'PARTIAL' ? 8 : 0;

    producer.passportCompletion = identity + assignment + consent;
    producer.passportStage = identity === 30 && assignment === 20
      && producer.consent && producer.consent.status === 'GRANTED'
      ? 'BASIC' : 'INCOMPLETE';
    producer.riskProfile = producer.reviewRequired || producer.possibleDuplicate
      || (producer.consent && ['PARTIAL', 'REFUSED', 'WITHDRAWN'].indexOf(producer.consent.status) >= 0)
      ? 'REVIEW_REQUIRED' : 'NOT_ASSESSED';
    producer.consentStatus = producer.consent ? producer.consent.status : 'NOT_RECORDED';
  }

  function sectionHtml() {
    var labels = {
      identity: 'Données d’identité', agriculture: 'Données agricoles', gps: 'Données GPS',
      photos: 'Photos', training: 'Historique de formation', inspections: 'Données d’inspection',
      transactions: 'Transactions AFLP'
    };

    return '<section id="frpSection" style="margin-top:18px;border:1px solid #D7E3D6;border-radius:12px;background:#F8FBF7;padding:16px">'
      + '<h3 style="margin:0 0 12px;font:800 15px Archivo,Arial;color:#053B23">Farmer Passport · Phase 1</h3>'
      + '<div id="frpMsg" style="display:none;border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:12px"></div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">'
      + '<label class="frpField">Prénoms<input id="frpPrenoms" type="text"></label>'
      + '<label class="frpField">Tranche d’âge<select id="frpAgeBand"><option value="">—</option><option>18-24</option><option>25-34</option><option>35-44</option><option>45-54</option><option>55-64</option><option>65+</option><option>UNKNOWN</option></select></label>'
      + '<label class="frpField">Téléphone alternatif<input id="frpTelAlt" type="tel" class="no-up"></label>'
      + '<label class="frpField">Langue préférée<select id="frpLanguage"><option value="FR">Français</option><option value="BAOULE">Baoulé</option><option value="DIOULA">Dioula</option><option value="SENOUFO">Sénoufo</option><option value="AUTRE">Autre</option></select></label>'
      + '<label class="frpField">Statut opérationnel<select id="frpOperational"><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option><option value="SUSPENDED">Suspendu</option><option value="REVIEW_REQUIRED">À revoir</option></select></label>'
      + '</div>'
      + '<div style="margin-top:16px;border-top:1px solid #D7E3D6;padding-top:14px">'
      + '<h4 style="margin:0 0 10px;color:#053B23;font-size:13px">AFLP Data Consent</h4>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">'
      + '<label class="frpField">Statut du consentement<select id="frpConsentStatus"><option value="NOT_RECORDED">Non recueilli</option><option value="GRANTED">Accord complet</option><option value="PARTIAL">Accord partiel</option><option value="REFUSED">Refus</option><option value="WITHDRAWN">Retiré</option></select></label>'
      + '<label class="frpField">Mode de consentement<select id="frpConsentMethod"><option value="VERBAL">Verbal</option><option value="WRITTEN">Écrit</option><option value="DIGITAL">Numérique</option><option value="WITNESSED">Avec témoin</option></select></label>'
      + '</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:7px;margin-top:10px">'
      + SCOPES.map(function (key) {
        return '<label style="display:flex;gap:8px;align-items:flex-start;border:1px solid #E3E8E1;border-radius:8px;background:#fff;padding:9px;font-size:12px"><input id="frpScope_'
          + key + '" type="checkbox" style="width:auto;margin-top:2px">' + labels[key] + '</label>';
      }).join('')
      + '</div><div style="font-size:10px;color:#68736B;margin-top:8px">Version du texte : '
      + CONSENT_VERSION + '. Une preuve numérique pourra être ajoutée ultérieurement.</div></div>'
      + '<div id="frpPassport" style="margin-top:14px;border-radius:9px;background:#E0F3DE;color:#053B23;padding:10px 12px;font-size:12px;font-weight:700"></div>'
      + '</section>'
      + '<style id="frpStyle">#frpSection .frpField{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;color:#4F4E4E}#frpSection input,#frpSection select{width:100%;border:1px solid #CBD4C8;border-radius:7px;padding:9px 10px;font:14px IBM Plex Sans,Arial;background:#fff}</style>';
  }

  function captureExtension() {
    if (typeof PROD_EDIT === 'undefined' || !PROD_EDIT || !field('frpSection')) return;
    ensureModel(PROD_EDIT);
    PROD_EDIT.prenoms = value('frpPrenoms');
    PROD_EDIT.ageBand = value('frpAgeBand');
    PROD_EDIT.telephoneAlt = value('frpTelAlt');
    PROD_EDIT.preferredLanguage = value('frpLanguage') || 'FR';
    PROD_EDIT.operationalStatus = value('frpOperational') || 'ACTIVE';

    var consent = PROD_EDIT.consent;
    consent.status = value('frpConsentStatus') || 'NOT_RECORDED';
    consent.method = value('frpConsentMethod') || 'VERBAL';
    consent.textVersion = CONSENT_VERSION;
    consent.consentAt = consent.consentAt || new Date().toISOString();
    SCOPES.forEach(function (key) { consent.scopes[key] = checked('frpScope_' + key); });

    var fingerprint = consentFingerprint(consent);
    if (consent.originalFingerprint && fingerprint !== consent.originalFingerprint) {
      if (consent.pendingFingerprint !== fingerprint) {
        consent.id = newUuid();
        consent.pendingFingerprint = fingerprint;
        consent.consentAt = new Date().toISOString();
      }
      consent.pending = true;
    } else if (!consent.originalFingerprint) {
      consent.pending = consent.status !== 'NOT_RECORDED';
      consent.pendingFingerprint = fingerprint;
    } else {
      consent.pending = false;
      consent.pendingFingerprint = '';
    }
    computePassport(PROD_EDIT);
  }

  function refreshPassportBox() {
    if (typeof PROD_EDIT === 'undefined' || !PROD_EDIT) return;
    captureExtension();
    computePassport(PROD_EDIT);
    var element = field('frpPassport');
    if (element) {
      element.textContent = 'Farmer Passport Completion : ' + PROD_EDIT.passportCompletion
        + '% · Maturité : ' + PROD_EDIT.passportStage + ' · Risque : ' + PROD_EDIT.riskProfile;
    }
  }

  function populateExtension() {
    if (typeof PROD_EDIT === 'undefined' || !PROD_EDIT) return;
    ensureModel(PROD_EDIT);
    setValue('frpPrenoms', PROD_EDIT.prenoms);
    setValue('frpAgeBand', PROD_EDIT.ageBand);
    setValue('frpTelAlt', PROD_EDIT.telephoneAlt);
    setValue('frpLanguage', PROD_EDIT.preferredLanguage);
    setValue('frpOperational', PROD_EDIT.operationalStatus);
    setValue('frpConsentStatus', PROD_EDIT.consent.status);
    setValue('frpConsentMethod', PROD_EDIT.consent.method);
    SCOPES.forEach(function (key) { setChecked('frpScope_' + key, asBoolean(PROD_EDIT.consent.scopes[key])); });
    refreshPassportBox();
  }

  function enhanceModal() {
    var root = field('modal-root');
    if (!root || !field('pNom') || field('frpSection')) return;
    var dialog = root.querySelector('[style*="max-width:600px"]') || root.firstElementChild;
    if (!dialog) return;
    var actions = dialog.querySelector('.flex.items-center.gap-2');
    if (actions) actions.insertAdjacentHTML('beforebegin', sectionHtml());
    else dialog.insertAdjacentHTML('beforeend', sectionHtml());
    populateExtension();

    if (!root.__farmerRegistryListeners) {
      root.addEventListener('input', refreshPassportBox, true);
      root.addEventListener('change', refreshPassportBox, true);
      root.__farmerRegistryListeners = true;
    }
  }

  function validatePhase1(producer) {
    var errors = [];
    var currentYear = new Date().getFullYear();
    var birthYear = validBirthYear(producer.anneeNaissance);

    if (!producer.nom) errors.push('Nom et prénoms obligatoires.');
    if (!producer.sexe) errors.push('Sexe obligatoire.');
    if (!birthYear && !producer.ageBand) errors.push('Année de naissance ou tranche d’âge obligatoire.');
    if (birthYear && (birthYear < 1930 || birthYear > currentYear - 16)) {
      errors.push('Année de naissance attendue entre 1930 et ' + (currentYear - 16) + '.');
    }
    if (phoneDigits(producer.telephone).length !== 10) errors.push('Téléphone ivoirien à 10 chiffres obligatoire.');
    if (producer.telephoneAlt && phoneDigits(producer.telephoneAlt).length !== 10) errors.push('Téléphone alternatif invalide.');
    if (!producer.campement) errors.push('Campement ou hameau obligatoire.');
    if (!producer.villageId) errors.push('Village obligatoire.');
    if (!producer.rtId) errors.push('RT référent obligatoire.');

    var area = Number(producer.superficieHa);
    if (!Number.isFinite(area) || area <= 0 || area > 100) errors.push('Superficie attendue entre 0 et 100 ha.');
    var previousProduction = Number(producer.prodPrecKg);
    if (!Number.isFinite(previousProduction) || previousProduction < 0 || previousProduction > 1000000) {
      errors.push('Production précédente attendue entre 0 et 1 000 000 kg.');
    }
    if (producer.mobileMoneyNum && phoneDigits(producer.mobileMoneyNum).length !== 10) errors.push('Numéro Mobile Money invalide.');

    if (producer.rtId && typeof STATE !== 'undefined' && STATE.rt) {
      var rt = STATE.rt.find(function (row) { return row.id === producer.rtId; });
      if (!rt) errors.push('RT inconnu du référentiel.');
      else if (rt.villageId && rt.villageId !== producer.villageId) errors.push('Le RT sélectionné n’appartient pas au village.');
    }

    var consent = producer.consent || {};
    if (consent.status === 'NOT_RECORDED') errors.push('Statut du consentement obligatoire.');
    var scopeCount = SCOPES.filter(function (key) { return asBoolean(consent.scopes && consent.scopes[key]); }).length;
    if (consent.status === 'GRANTED' && scopeCount !== SCOPES.length) {
      errors.push('Un accord complet exige toutes les catégories de données.');
    }
    if (consent.status === 'PARTIAL' && scopeCount === 0) {
      errors.push('Un accord partiel doit autoriser au moins une catégorie.');
    }
    return errors;
  }

  async function findDuplicates(producer) {
    var localRows = (typeof STATE !== 'undefined' && STATE.producteurs || [])
      .filter(function (row) { return row && row.id !== producer.id && !row.deleted; })
      .filter(function (row) {
        return (phoneDigits(row.telephone) && phoneDigits(row.telephone) === phoneDigits(producer.telephone))
          || (norm(row.nom) === norm(producer.nom) && row.villageId === producer.villageId);
      });
    var matches = localRows.map(function (row) {
      return { farmer_id: row.code, nom: row.nom, reason: 'LOCAL_MATCH', confidence: 75 };
    });

    if (supabaseReady()) {
      try {
        var response = await SB.rpc('farmer_possible_duplicates', {
          p_nom: producer.nom || '',
          p_telephone: producer.telephone || '',
          p_village_id: producer.villageId || '',
          p_exclude_id: producer.id || null
        });
        if (!response.error) matches = response.data || matches;
      } catch (error) { /* repli local */ }
    }
    return matches;
  }

  async function loadLatestConsent(producteurId) {
    if (!supabaseReady() || !producteurId || typeof PROD_EDIT === 'undefined' || !PROD_EDIT) return;
    try {
      var response = await SB.from('farmer_consents')
        .select('id,status,scopes,consent_at,text_version,method,created_at')
        .eq('producteur_id', producteurId)
        .order('created_at', { ascending: false })
        .order('consent_at', { ascending: false })
        .limit(1).maybeSingle();
      if (response.error || !response.data) return;
      PROD_EDIT.consent = {
        id: response.data.id,
        status: response.data.status,
        scopes: response.data.scopes || {},
        consentAt: response.data.consent_at,
        textVersion: response.data.text_version,
        method: response.data.method,
        pending: false,
        pendingFingerprint: ''
      };
      PROD_EDIT.consent.originalFingerprint = consentFingerprint(PROD_EDIT.consent);
      populateExtension();
    } catch (error) { /* non bloquant */ }
  }

  async function loadLatestIdentityDocument(producteurId) {
    if (!supabaseReady() || !producteurId || typeof PROD_EDIT === 'undefined' || !PROD_EDIT) return;
    try {
      var response = await SB.from('farmer_identity_documents')
        .select('id,document_type,document_number,status,created_at')
        .eq('producteur_id', producteurId)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle();
      if (response.error || !response.data) return;
      PROD_EDIT.identityDocumentId = response.data.id;
      PROD_EDIT.pieceType = response.data.document_type || PROD_EDIT.pieceType || '';
      PROD_EDIT.pieceNum = response.data.document_number || '';
      setValue('pPieceType', PROD_EDIT.pieceType);
      setValue('pPieceNum', PROD_EDIT.pieceNum);
    } catch (error) { /* droits ou réseau : ne pas bloquer la fiche */ }
  }

  async function insertIdentityDocument(producerCopy, producerObject) {
    var number = String(producerCopy.pieceNum || '').trim();
    var type = String(producerCopy.pieceType || '').trim();
    if (!number || !type || type === 'Aucune') return;

    var documentId = producerCopy.identityDocumentId || newUuid();
    var response = await SB.from('farmer_identity_documents').insert({
      id: documentId,
      producteur_id: producerCopy.id,
      document_type: type,
      document_number: number,
      status: 'ACTIVE',
      source: 'FIELD_ENROLLMENT'
    });
    if (response.error && response.error.code !== '23505') throw new Error(response.error.message);
    producerObject.identityDocumentId = documentId;
  }

  async function insertConsent(producerCopy, producerObject) {
    if (!producerCopy.consent || producerCopy.consent.status === 'NOT_RECORDED'
        || producerCopy.consent.pending === false) return;

    var consent = {
      id: producerCopy.consent.id || newUuid(),
      producteur_id: producerCopy.id,
      status: producerCopy.consent.status,
      scopes: producerCopy.consent.scopes || {},
      consent_at: producerCopy.consent.consentAt || new Date().toISOString(),
      agent_name: profile().nom || profile().email || null,
      text_version: CONSENT_VERSION,
      method: producerCopy.consent.method || 'VERBAL',
      source: 'FIELD_ENROLLMENT'
    };
    var response = await SB.from('farmer_consents')
      .upsert(consent, { onConflict: 'id', ignoreDuplicates: true });
    if (response.error) throw new Error(response.error.message);

    producerObject.consent.id = consent.id;
    producerObject.consent.pending = false;
    producerObject.consent.pendingFingerprint = '';
    producerObject.consent.originalFingerprint = consentFingerprint(producerObject.consent);
  }

  function patchCapture() {
    if (typeof global.captureProdModalFields !== 'function' || originals.capture) return;
    originals.capture = global.captureProdModalFields;
    global.captureProdModalFields = function () {
      var result = originals.capture.apply(this, arguments);
      captureExtension();
      return result;
    };
  }

  function patchOpen() {
    if (typeof global.openProdModal !== 'function' || originals.open) return;
    originals.open = global.openProdModal;
    global.openProdModal = function (id) {
      var result = originals.open.apply(this, arguments);
      setTimeout(function () {
        enhanceModal();
        if (id) {
          loadLatestConsent(id);
          loadLatestIdentityDocument(id);
        }
      }, 0);
      return result;
    };
  }

  function patchView() {
    if (typeof global.ProducteursView !== 'function' || originals.view) return;
    originals.view = global.ProducteursView;
    global.ProducteursView = function () {
      var html = originals.view.apply(this, arguments);
      return String(html).replace(
        'Registre par village — l\'application ne charge que les producteurs du village sélectionné.',
        'AFLP Farmer Registry · Farmer Passport · consentement · traçabilité, avec cache par village.'
      );
    };
  }

  function patchRemote() {
    if (typeof RemoteProducteurs === 'undefined' || !RemoteProducteurs
        || typeof RemoteProducteurs.upsert !== 'function' || originals.upsert) return;
    originals.upsert = RemoteProducteurs.upsert;

    RemoteProducteurs.upsert = async function (producer) {
      ensureModel(producer);
      computePassport(producer);
      if (!supabaseReady()) return originals.upsert.apply(this, arguments);

      var copy = typeof structuredClone === 'function'
        ? structuredClone(producer) : JSON.parse(JSON.stringify(producer));
      var safeData = typeof structuredClone === 'function'
        ? structuredClone(copy) : JSON.parse(JSON.stringify(copy));
      ['_sync', '_serverUpdatedAt', 'consent', 'pieceNum', 'idDocumentNumber', 'identityDocumentId']
        .forEach(function (key) { delete safeData[key]; });

      var row = {
        id: copy.id,
        data: safeData,
        code: copy.code && String(copy.code).indexOf('TMP') !== 0 ? copy.code : null,
        nom: copy.nom || '',
        prenoms: copy.prenoms || null,
        sexe: sexCode(copy.sexe),
        birth_year: validBirthYear(copy.anneeNaissance),
        age_band: copy.ageBand || null,
        telephone: copy.telephone || '',
        telephone_alt: copy.telephoneAlt || null,
        preferred_language: copy.preferredLanguage || null,
        id_document_type: copy.pieceType || null,
        id_document_number: null,
        village_id: copy.villageId,
        village_nom: copy.villageNom || '',
        rt_id: copy.rtId || null,
        statut: copy.statut || 'Identifié',
        operational_status: copy.operationalStatus || 'ACTIVE',
        possible_duplicate: !!copy.possibleDuplicate,
        review_required: !!copy.reviewRequired,
        review_reason: copy.reviewReason || null,
        created_by: copy.createdBy || (typeof AUTH !== 'undefined' && AUTH.session && AUTH.session.email) || null,
        deleted: false
      };

      var response = await SB.from('producteurs').upsert(row)
        .select('data,code,updated_at,passport_stage,passport_completion,risk_profile,consent_status,possible_duplicate,review_required,record_version')
        .single();
      if (response.error) throw new Error(response.error.message);

      producer.code = response.data.code || producer.code;
      producer._serverUpdatedAt = response.data.updated_at || producer._serverUpdatedAt;
      await insertIdentityDocument(copy, producer);
      await insertConsent(copy, producer);

      var refreshed = await SB.from('producteurs')
        .select('data,code,updated_at,passport_stage,passport_completion,risk_profile,consent_status,possible_duplicate,review_required,record_version')
        .eq('id', copy.id).single();
      var data = refreshed.error ? response.data : refreshed.data;

      producer.passportStage = data.passport_stage || producer.passportStage;
      producer.passportCompletion = Number(data.passport_completion) || 0;
      producer.riskProfile = data.risk_profile || producer.riskProfile;
      producer.consentStatus = data.consent_status || producer.consentStatus;
      producer.possibleDuplicate = !!data.possible_duplicate;
      producer.reviewRequired = !!data.review_required;
      producer.recordVersion = data.record_version || producer.recordVersion;

      return {
        ok: true,
        producteur: Object.assign(data.data || {}, {
          code: data.code,
          updatedAt: data.updated_at,
          passportStage: producer.passportStage,
          passportCompletion: producer.passportCompletion,
          riskProfile: producer.riskProfile,
          consentStatus: producer.consentStatus,
          possibleDuplicate: producer.possibleDuplicate,
          reviewRequired: producer.reviewRequired,
          recordVersion: producer.recordVersion,
          consent: producer.consent,
          pieceType: producer.pieceType,
          pieceNum: producer.pieceNum,
          identityDocumentId: producer.identityDocumentId
        })
      };
    };
  }

  async function savePhase1Producer(producer) {
    producer.updatedAt = new Date().toISOString();
    if (typeof AUTH !== 'undefined' && AUTH.isConnected()) {
      if (!producer.createdBy) producer.createdBy = AUTH.session.email;
      producer.updatedBy = AUTH.session.email;
    }
    producer._sync = 'pending';
    await PROD_ADAPTER.upsert(producer);

    if (typeof AUTH !== 'undefined' && AUTH.isConnected()) {
      try {
        var response = await RemoteProducteurs.upsert(producer);
        var serverProducer = response && response.producteur;
        if (serverProducer) {
          producer.code = serverProducer.code || producer.code;
          producer._serverUpdatedAt = serverProducer.updatedAt || producer._serverUpdatedAt;
          Object.assign(producer, serverProducer);
        }
        producer._sync = 'synced';
        await PROD_ADAPTER.upsert(producer);
      } catch (error) {
        producer._sync = 'pending';
        producer._error = error && error.message ? error.message : String(error);
        await PROD_ADAPTER.upsert(producer);
        console.warn('[FBMS] Farmer Passport en attente de synchronisation :', producer._error);
      }
    }

    STATE.producteurs = await PROD_ADAPTER.list();
    if (global.ANAGROCI_AUDIT && typeof global.ANAGROCI_AUDIT.log === 'function') {
      global.ANAGROCI_AUDIT.log('farmer_registry_enrollment_saved', {
        producteur_id: producer.id,
        farmer_id: producer.code,
        village_id: producer.villageId,
        rt_id: producer.rtId,
        passport_stage: producer.passportStage,
        passport_completion: producer.passportCompletion,
        sync_status: producer._sync
      });
    }
    closeProdModal();
    renderContent();
    return true;
  }

  function patchSave() {
    if (typeof global.saveProducteur !== 'function' || originals.save) return;
    originals.save = global.saveProducteur;

    global.saveProducteur = async function () {
      if (typeof global.captureProdModalFields === 'function') global.captureProdModalFields();
      if (typeof PROD_EDIT === 'undefined' || !PROD_EDIT) return false;
      ensureModel(PROD_EDIT);

      var validationErrors = validatePhase1(PROD_EDIT);
      if (validationErrors.length) {
        showMessage('Corrigez avant d’enregistrer :\n• ' + validationErrors.join('\n• '), 'error');
        return false;
      }

      var duplicates = await findDuplicates(PROD_EDIT);
      if (duplicates.length) {
        var names = duplicates.slice(0, 3).map(function (row) {
          return (row.farmer_id || 'ID EN ATTENTE') + ' · ' + (row.nom || '')
            + ' (' + (row.confidence || 0) + '%)';
        }).join('\n');
        if (!confirm('POSSIBLE DUPLICATE\n\n' + names
            + '\n\nConfirmer malgré tout la création ou la mise à jour ?')) return false;
        PROD_EDIT.possibleDuplicate = true;
        PROD_EDIT.reviewRequired = true;
        PROD_EDIT.reviewReason = 'POSSIBLE DUPLICATE confirmé par '
          + (profile().nom || profile().email || 'agent');
      }

      computePassport(PROD_EDIT);
      showMessage('Enregistrement du Farmer Passport…', 'info');
      return savePhase1Producer(PROD_EDIT);
    };
  }

  function install() {
    if (typeof global.openProdModal !== 'function'
        || typeof global.saveProducteur !== 'function'
        || typeof global.ProducteursView !== 'function'
        || typeof RemoteProducteurs === 'undefined') return false;

    patchCapture();
    patchOpen();
    patchView();
    patchRemote();
    patchSave();

    var root = field('modal-root');
    if (root && global.MutationObserver) {
      new MutationObserver(function () { setTimeout(enhanceModal, 0); })
        .observe(root, { childList: true, subtree: true });
    }

    global.FARMER_ENROLLMENT_PHASE1 = {
      version: VERSION,
      consentVersion: CONSENT_VERSION,
      installed: true
    };
    return true;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (install() || tries > 80) clearInterval(timer);
  }, 100);
})(window);

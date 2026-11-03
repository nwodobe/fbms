/* ANAGROCI FBMS - RT -> Producteur bridge
   Transforme un RT dont l'activite inclut "Producteur" en pre-remplissage
   du Farmer Registry, sans dupliquer l'identite et sans contourner les
   validations Farmer Passport (sexe, age, campement, superficie, production,
   consentement restent a completer par l'agent). */
(function (global) {
  'use strict';

  if (global.RT_TO_PRODUCER) return;

  var VERSION = '1.0.0';
  var originals = {};
  var currentRtId = null;

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

  function isProducerActivity(value) {
    return norm(value).indexOf('PRODUCTEUR') >= 0;
  }

  function getRt(id) {
    if (typeof STATE === 'undefined' || !STATE.rt) return null;
    return STATE.rt.find(function (row) { return row && row.id === id && !row.deleted; }) || null;
  }

  function villageName(rt) {
    if (rt && rt.villageNom) return rt.villageNom;
    if (!rt || typeof STATE === 'undefined' || !STATE.villages) return '';
    var village = STATE.villages.find(function (row) { return row && row.id === rt.villageId; });
    return village ? ((village.s1 && village.s1.village) || village.village || '') : '';
  }

  function sameIdentity(producer, rt) {
    if (!producer || producer.deleted || !rt) return false;
    if (producer.sourceRtId && producer.sourceRtId === rt.id) return true;
    if (producer.villageId !== rt.villageId) return false;
    var pPhone = phoneDigits(producer.telephone);
    var rPhone = phoneDigits(rt.telephone);
    if (pPhone && rPhone && pPhone === rPhone && norm(producer.nom) === norm(rt.nom)) return true;
    return false;
  }

  async function refreshVillageFarmers(rt) {
    if (typeof PROD_ADAPTER !== 'undefined' && PROD_ADAPTER && typeof PROD_ADAPTER.list === 'function') {
      try { STATE.producteurs = await PROD_ADAPTER.list(); } catch (error) { /* cache local indisponible */ }
    }
    if (typeof loadProducteursVillage === 'function'
        && typeof AUTH !== 'undefined' && AUTH && typeof AUTH.isConnected === 'function'
        && AUTH.isConnected() && global.navigator && navigator.onLine) {
      try { await loadProducteursVillage(rt.villageId, true); } catch (error) { /* repli cache local */ }
    }
  }

  function findExisting(rt) {
    var rows = (typeof STATE !== 'undefined' && STATE.producteurs) || [];
    return rows.find(function (producer) { return sameIdentity(producer, rt); }) || null;
  }

  function addSourceNote(producer, rt) {
    var tag = 'Enrolement initie depuis la fiche RT ' + (rt.idRt || rt.id || '') + '.';
    var existing = String(producer.notes || '').trim();
    if (existing.indexOf(tag) >= 0) return;
    producer.notes = existing ? (existing + '\n' + tag) : tag;
  }

  function prefillFromRt(rt) {
    if (typeof PROD_EDIT === 'undefined' || !PROD_EDIT) return false;
    PROD_EDIT.nom = rt.nom || '';
    PROD_EDIT.telephone = rt.telephone || '';
    PROD_EDIT.telTitulaire = 'Propre';
    PROD_EDIT.villageId = rt.villageId || '';
    PROD_EDIT.villageNom = villageName(rt);
    PROD_EDIT.rtId = rt.id;
    PROD_EDIT.sourceRtId = rt.id;
    PROD_EDIT.sourceType = 'RT_TO_PRODUCER';
    PROD_EDIT.sourceRtCode = rt.idRt || '';
    addSourceNote(PROD_EDIT, rt);
    return true;
  }

  async function openFromRt(rtId) {
    var rt = getRt(rtId);
    if (!rt) {
      alert('RT introuvable dans le referentiel. Synchronisez la Base RT puis reessayez.');
      return false;
    }
    if (!rt.villageId) {
      alert('Ce RT doit d’abord etre rattache a un village avant de devenir producteur.');
      return false;
    }
    if (!isProducerActivity(rt.activite)) {
      alert('L’activite de ce RT ne contient pas « Producteur ». Mettez d’abord sa fiche RT a jour, puis enregistrez-la.');
      return false;
    }

    await refreshVillageFarmers(rt);
    var existing = findExisting(rt);
    if (existing) {
      if (typeof STATE !== 'undefined') STATE.prodVillageId = rt.villageId;
      if (typeof closeRTModal === 'function') closeRTModal();
      if (typeof openProdModal === 'function') openProdModal(existing.id);
      return true;
    }

    if (typeof STATE !== 'undefined') STATE.prodVillageId = rt.villageId;
    if (typeof closeRTModal === 'function') closeRTModal();
    if (typeof openProdModal !== 'function') {
      alert('Le module Producteurs n’est pas encore disponible. Rechargez la page.');
      return false;
    }

    openProdModal(null);
    if (!prefillFromRt(rt)) {
      alert('Impossible de preparer la fiche producteur. Rechargez la page et reessayez.');
      return false;
    }
    if (typeof renderProdModal === 'function') renderProdModal();
    return true;
  }

  function injectAction() {
    var root = document.getElementById('modal-root');
    if (!root || !currentRtId || document.getElementById('rtToProducerAction')) return;
    var rt = getRt(currentRtId);
    if (!rt) return;

    var saveButton = root.querySelector('button[onclick="saveRT()"]');
    if (!saveButton || !saveButton.parentElement) return;
    var actionRow = saveButton.parentElement;

    var wrapper = document.createElement('div');
    wrapper.id = 'rtToProducerAction';
    wrapper.style.marginBottom = '12px';
    wrapper.style.padding = '11px 12px';
    wrapper.style.borderRadius = '10px';
    wrapper.style.border = '1px solid #BFE3B6';
    wrapper.style.background = '#F1F9EF';

    var eligible = isProducerActivity(rt.activite);
    var existing = findExisting(rt);
    var title = existing ? 'Double role RT + Producteur' : 'Ce RT est aussi producteur ?';
    var description = existing
      ? 'Une fiche producteur liee a ce RT existe deja. Ouvrez-la sans recreer la personne.'
      : (eligible
        ? 'Nom, telephone, village et RT referent seront repris automatiquement. Les donnees agricoles et le consentement resteront a completer.'
        : 'Son activite actuelle ne contient pas « Producteur ». Modifiez et enregistrez d’abord la fiche RT si necessaire.');

    wrapper.innerHTML = '<div style="font:700 12px IBM Plex Sans,Arial;color:#053B23;margin-bottom:4px">'
      + title + '</div><div style="font:400 11px IBM Plex Sans,Arial;color:#5B665E;line-height:1.35;margin-bottom:8px">'
      + description + '</div>';

    var button = document.createElement('button');
    button.type = 'button';
    button.style.width = '100%';
    button.style.border = '0';
    button.style.borderRadius = '8px';
    button.style.padding = '9px 12px';
    button.style.font = '700 12px IBM Plex Sans,Arial';
    button.style.cursor = eligible || existing ? 'pointer' : 'not-allowed';
    button.style.background = eligible || existing ? '#00712C' : '#D8DED9';
    button.style.color = eligible || existing ? '#FFFFFF' : '#778078';
    button.disabled = !(eligible || existing);
    button.textContent = existing ? 'Ouvrir la fiche producteur' : 'RT → Producteur';
    button.addEventListener('click', function () { openFromRt(rt.id); });
    wrapper.appendChild(button);
    actionRow.parentElement.insertBefore(wrapper, actionRow);
  }

  function patchRtModal() {
    if (typeof global.openRTModal !== 'function' || typeof global.renderRTModal !== 'function') return false;
    if (originals.openRT) return true;

    originals.openRT = global.openRTModal;
    originals.renderRT = global.renderRTModal;

    global.openRTModal = function (id) {
      currentRtId = id || null;
      var result = originals.openRT.apply(this, arguments);
      setTimeout(injectAction, 0);
      return result;
    };

    global.renderRTModal = function () {
      var result = originals.renderRT.apply(this, arguments);
      setTimeout(injectAction, 0);
      return result;
    };

    return true;
  }

  function install() {
    if (typeof STATE === 'undefined'
        || typeof global.openRTModal !== 'function'
        || typeof global.renderRTModal !== 'function'
        || typeof global.openProdModal !== 'function') return false;
    if (!patchRtModal()) return false;

    global.RT_TO_PRODUCER = {
      version: VERSION,
      installed: true,
      isProducerActivity: isProducerActivity,
      open: openFromRt,
      findExisting: function (rtId) {
        var rt = getRt(rtId);
        return rt ? findExisting(rt) : null;
      }
    };
    return true;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (install() || tries > 120) clearInterval(timer);
  }, 100);
})(window);

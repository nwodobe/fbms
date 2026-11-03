/* ANAGROCI FBMS - Farmer Registry private evidence storage */
(function (global) {
  'use strict';
  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    var registry = global.AFLP_FARMER_REGISTRY;
    if (!registry || !registry.syncEngine || !registry.syncEngine.uuid) {
      if (attempts > 120) clearInterval(timer);
      return;
    }
    if (registry.syncEngine.__privateEvidence) {
      clearInterval(timer);
      return;
    }

    async function sessionUserId() {
      var response = await SB.auth.getSession();
      return response.data && response.data.session && response.data.session.user
        ? response.data.session.user.id : null;
    }

    async function sha256(file) {
      if (!global.crypto || !crypto.subtle || !file || !file.arrayBuffer) return null;
      var digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return Array.from(new Uint8Array(digest)).map(function (value) {
        return value.toString(16).padStart(2, '0');
      }).join('');
    }

    registry.syncEngine.uploadEvidence = async function (
      file, producteurId, entityType, entityId, proofType
    ) {
      if (!registry.syncEngine.online()) {
        throw new Error('La preuve doit être envoyée avec une connexion disponible.');
      }
      if (!file) throw new Error('Fichier de preuve absent.');
      if (file.size > 10485760) throw new Error('La preuve dépasse la limite de 10 Mo.');
      var allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (allowed.indexOf(file.type) < 0) {
        throw new Error('Format de preuve non autorisé. Utilisez JPEG, PNG, WEBP ou PDF.');
      }
      var userId = await sessionUserId();
      if (!userId) throw new Error('Session utilisateur absente.');
      var safeName = String(file.name || 'preuve')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-100);
      var objectPath = userId + '/' + producteurId + '/' + entityType + '/'
        + entityId + '/' + registry.syncEngine.uuid() + '-' + safeName;
      var upload = await SB.storage.from('farmer-passport-evidence').upload(objectPath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      });
      if (upload.error) throw upload.error;

      var proof = {
        id: registry.syncEngine.uuid(),
        entite_type: entityType,
        entite_id: String(entityId),
        type_preuve: proofType || 'document',
        storage_path: objectPath,
        horodatage_client: new Date().toISOString(),
        sha256: await sha256(file),
      };
      var inserted = await SB.from('preuves').insert(proof).select('*').single();
      if (inserted.error) {
        await SB.storage.from('farmer-passport-evidence').remove([objectPath]).catch(function () {});
        throw inserted.error;
      }
      return inserted.data;
    };

    registry.syncEngine.__privateEvidence = true;
    clearInterval(timer);
  }, 50);
})(window);

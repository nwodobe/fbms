/* SUIVI DES MISES À JOUR — fonctions pures de shared/ota-suivi.js (lecture de l'état du téléphone, classement).
   Lancer : node tests/ota/suivi-coeur.test.cjs. Aucune donnée réelle : installations et versions fictives. */
const S = require('../../shared/ota-suivi.js');
const R = [];
function t(id, lib, fn) { let ok = false, d = ''; try { const r = fn(); ok = r === true || (r && r.ok); d = r && r.detail !== undefined ? r.detail : ''; } catch (e) { d = e.message; } R.push({ id, lib, ok, d }); console.log((ok ? 'RÉUSSI  ' : 'ÉCHOUÉ  ') + id + ' ' + lib + (ok ? '' : ' — ' + JSON.stringify(d))); }
const ID = '11111111-1111-4111-8111-111111111111', H = 3600e3, T = Date.parse('2026-11-22T12:00:00Z');
const PUB = { sequence: 2000, web_version: '2026.11.22-0900.abcdef0', min_native_version_code: 3 };
const INFO = { app: 'ANAGROCI FIELD BUYING', version: '1.4.2 (9)', android_release: '15', android_sdk: 35, package: 'ci.anagroci.fieldbuying', signer_sha256: 'AA:BB' };
const UP = { enabled: true, channel: 'stable', active: 'mise à jour signée', active_sequence: 2000, active_web_version: '2026.11.22-0900.abcdef0', pending_sequence: 0, phase: 'a_jour',
  last_check_at: '2026-11-22T10:00:00Z', last_success_at: '2026-11-22T09:30:00Z', last_result: 'à jour', latest: { sequence: 2000, web_version: '2026.11.22-0900.abcdef0' }, queue_open: 0, rejected: {} };
const inst = (o) => Object.assign({ installation_id: ID, native_version_code: 9, updates_enabled: true, web_active_sequence: 2000, phase: 'a_jour', last_error: null, last_seen_at: new Date(T - 2 * H).toISOString() }, o);

t('OTA-01', 'État local : versions lues dans la réponse du pont natif', () => { const e = S.etatLocal(INFO, UP, ID); return { ok: e.native_version_name === '1.4.2' && e.native_version_code === 9 && e.android_release === '15' && e.web_active_sequence === 2000 && e.web_active_origin === 'OTA' && e.ota_latest_sequence === 2000 && e.phase === 'a_jour' && e.last_error === null && e.queue_open === 0, detail: e }; });
t('OTA-02', 'État local : aucun identifiant matériel ni donnée personnelle dans ce qui est envoyé', () => { const k = Object.keys(S.etatLocal(INFO, UP, ID)).join(','); const interdits = ['imei', 'serial', 'android_id', 'advertising_id', 'signer_sha256', 'model', 'manufacturer', 'latitude', 'longitude', 'gps', 'phone', 'telephone', 'email', 'nom', 'user_id']; return { ok: k.split(',').every(x => interdits.indexOf(x) < 0) && k.split(',').length === 19, detail: k }; });
t('OTA-03', 'État local : version intégrée à l\'APK distinguée d\'une mise à jour signée', () => S.etatLocal(INFO, Object.assign({}, UP, { active: "intégrée à l'APK" }), ID).web_active_origin === 'APK');
t('OTA-04', 'État local : échec, refus et incompatibilité remontés comme erreur ; « à jour » n\'en est pas une', () => ['échec : HTTP 500', 'refusée : signature invalide', 'incompatible : nouvel APK requis'].every(r => S.etatLocal(INFO, Object.assign({}, UP, { last_result: r }), ID).last_error === r) && S.etatLocal(INFO, UP, ID).last_error === null);
t('OTA-05', 'État local : version refusée sur le téléphone remontée avec son motif', () => /signature invalide/.test(S.etatLocal(INFO, Object.assign({}, UP, { rejected: { 1999: 'signature invalide' } }), ID).last_error));
t('OTA-06', 'État local : réponses vides ou illisibles → champs vides, rien d\'inventé', () => { const e = S.etatLocal({}, {}, ID); return e.native_version_code === null && e.web_active_sequence === null && e.last_activation_at === null && e.updates_enabled === false && e.phase === null; });
t('OTA-07', 'État local : date d\'activation illisible → vide', () => S.etatLocal(INFO, Object.assign({}, UP, { last_success_at: 'hier' }), ID).last_activation_at === null);
t('OTA-08', 'Classement : version active = version publiée, signalée il y a 2 h → À jour', () => S.classer(inst({}), PUB, T) === 'A_JOUR');
t('OTA-09', 'Classement : version active plus ancienne → En attente', () => S.classer(inst({ web_active_sequence: 1990, phase: 'disponible' }), PUB, T) === 'EN_ATTENTE');
t('OTA-10', 'Classement : téléchargée mais pas encore activée (prête) → En attente, jamais À jour', () => S.classer(inst({ web_active_sequence: 1990, phase: 'prete', ota_pending_sequence: 2000 }), PUB, T) === 'EN_ATTENTE');
t('OTA-11', 'Classement : silence de plus de 72 h → Non confirmé récemment, même si le dernier état était « à jour »', () => S.classer(inst({ last_seen_at: new Date(T - 73 * H).toISOString() }), PUB, T) === 'NON_CONFIRME');
t('OTA-12', 'Classement : 71 h → encore confirmé', () => S.classer(inst({ last_seen_at: new Date(T - 71 * H).toISOString() }), PUB, T) === 'A_JOUR');
t('OTA-13', 'Classement : date de signalement absente → Non confirmé récemment', () => S.classer(inst({ last_seen_at: null }), PUB, T) === 'NON_CONFIRME');
t('OTA-14', 'Classement : nouvel APK requis → Incompatible', () => S.classer(inst({ web_active_sequence: 1990, phase: 'nouvel_apk' }), PUB, T) === 'INCOMPATIBLE');
t('OTA-15', 'Classement : APK plus ancien que le minimum publié → Incompatible', () => S.classer(inst({ native_version_code: 2, web_active_sequence: 1500 }), PUB, T) === 'INCOMPATIBLE');
t('OTA-16', 'Classement : mises à jour désactivées dans l\'APK → Incompatible', () => S.classer(inst({ updates_enabled: false, web_active_sequence: 1500 }), PUB, T) === 'INCOMPATIBLE');
t('OTA-17', 'Classement : erreur de téléchargement ou de signature → Erreur', () => S.classer(inst({ web_active_sequence: 1990, phase: 'erreur', last_error: 'refusée : signature invalide' }), PUB, T) === 'ERREUR');
t('OTA-18', 'Classement : erreur ancienne mais version publiée bien active → À jour', () => S.classer(inst({ last_error: 'échec : HTTP 500' }), PUB, T) === 'A_JOUR');
t('OTA-19', 'Classement : version publiée illisible → on s\'en remet à l\'état signalé, sans présumer', () => S.classer(inst({}), null, T) === 'A_JOUR' && S.classer(inst({ phase: 'disponible' }), null, T) === 'EN_ATTENTE');
t('OTA-20', 'Libellés exigés : à jour, en attente, erreur, incompatible, non confirmé récemment', () => JSON.stringify(Object.values(S.LIBELLES)) === JSON.stringify(['À jour', 'En attente', 'Erreur', 'Incompatible', 'Non confirmé récemment']));
const ok = R.filter(x => x.ok).length;
console.log(`\nSuivi OTA (cœur) : ${R.length} tests, ${ok} réussis, ${R.length - ok} échoués.`);
process.exit(ok === R.length ? 0 : 1);

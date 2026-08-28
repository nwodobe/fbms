import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../shared/rt-to-producer.js', import.meta.url), 'utf8');

const sandbox = {
  console,
  navigator: { onLine: false },
  alertMessages: [],
  alert(message) { this.alertMessages.push(message); },
  document: {
    getElementById() { return null; },
    createElement() {
      return { style: {}, appendChild() {}, addEventListener() {} };
    }
  },
  STATE: {
    rt: [{
      id: 'rt1', idRt: 'RT-MGB-01', nom: 'KOUAKOU KOFFI JEANNOT',
      telephone: '0709225944', villageId: 'v1', villageNom: "M'GBRENZUE",
      activite: 'Commerçant/Producteur', compteWave: true
    }],
    villages: [{ id: 'v1', s1: { village: "M'GBRENZUE" } }],
    producteurs: [],
    prodVillageId: ''
  },
  AUTH: { isConnected: () => false },
  PROD_ADAPTER: null,
  PROD_EDIT: null,
  openRTModal() {},
  renderRTModal() {},
  closeRTModal() {},
  renderProdModal() {},
  setTimeout(fn) { fn(); return 1; },
  setInterval(fn) { fn(); return 1; },
  clearInterval() {}
};

sandbox.PROD_ADAPTER = { list: async () => sandbox.STATE.producteurs };
sandbox.openProdModal = function (id) {
  if (id) {
    sandbox.PROD_EDIT = sandbox.STATE.producteurs.find((row) => row.id === id) || null;
    return;
  }
  sandbox.PROD_EDIT = {
    id: 'p1', nom: '', telephone: '', villageId: '', villageNom: '', rtId: '',
    notes: '', telTitulaire: '', paiementMode: '', mobileMoneyNum: '', mobileMoneyTitulaire: ''
  };
};

sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'rt-to-producer.js' });

assert.equal(sandbox.RT_TO_PRODUCER.installed, true);
assert.equal(sandbox.RT_TO_PRODUCER.isProducerActivity('Commerçant / Producteur'), true);
assert.equal(sandbox.RT_TO_PRODUCER.isProducerActivity('Commerçant'), false);

assert.equal(await sandbox.RT_TO_PRODUCER.open('rt1'), true);
assert.equal(sandbox.PROD_EDIT.nom, 'KOUAKOU KOFFI JEANNOT');
assert.equal(sandbox.PROD_EDIT.telephone, '0709225944');
assert.equal(sandbox.PROD_EDIT.villageId, 'v1');
assert.equal(sandbox.PROD_EDIT.villageNom, "M'GBRENZUE");
assert.equal(sandbox.PROD_EDIT.rtId, 'rt1');
assert.equal(sandbox.PROD_EDIT.sourceRtId, 'rt1');
assert.equal(sandbox.PROD_EDIT.sourceType, 'RT_TO_PRODUCER');

sandbox.STATE.producteurs.push({ ...sandbox.PROD_EDIT, code: 'MGBR-0001' });
sandbox.PROD_EDIT = null;
assert.equal(await sandbox.RT_TO_PRODUCER.open('rt1'), true);
assert.equal(sandbox.PROD_EDIT.code, 'MGBR-0001');

console.log('PASS RT -> Producteur');

#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 4339;
const legacy = readFileSync(join(ROOT, 'tests/field-buying-e2e.mjs'), 'utf8');
const match = legacy.match(/const DOUBLURE = `([\s\S]*?)`;\n\nconst echecs/);
if (!match) throw new Error('Doublure FIELD BUYING introuvable');
const DOUBLURE = match[1] + `
(function () {
  var create = window.supabase.createClient;
  window.supabase.createClient = function () {
    var c = create.apply(this, arguments);
    var rpc = c.rpc;
    c.rpc = function (name, args) {
      if (name === 'farmer_possible_duplicates' && args && args.p_nom === 'DUPLICATE TEST') {
        return Promise.resolve({ data: [{ producteur_id: 'p_test_1', farmer_id: 'FICT-1001' }], error: null });
      }
      if (name === 'farmer_registry_refresh_passport') return Promise.resolve({ data: null, error: null });
      return rpc.call(c, name, args);
    };
    return c;
  };
})();`;

const TYPES = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png' };
function server() {
  return createServer((req,res) => {
    const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = normalize(join(ROOT, pathname));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file,'index.html');
    if (!existsSync(file)) return res.writeHead(404).end('missing');
    res.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream'});
    res.end(readFileSync(file));
  });
}
const failures = [];
function check(ok, label) { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures.push(label); }
async function go(page, hash) {
  await page.evaluate(h => { location.hash = h; }, hash);
  await page.waitForFunction(() => !document.querySelector('#opsRouteView .skeleton'), null, {timeout:15000});
}
async function set(page, values) {
  await page.evaluate((vals) => {
    for (const [id,value] of Object.entries(vals)) {
      const el = document.getElementById(id); if (!el) continue;
      el.value = value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }, values);
}
async function submit(page, id) { await page.evaluate((formId) => document.getElementById(formId).requestSubmit(), id); }
async function msg(page) { await page.waitForTimeout(180); return page.evaluate(() => (document.querySelector('[data-rich-msg]') || {}).textContent || ''); }
async function settle(page) { await page.waitForTimeout(1100); }

async function main() {
  const s = server(); await new Promise(r => s.listen(PORT,r));
  const browser = await chromium.launch();
  const context = await browser.newContext({viewport:{width:1440,height:950}});
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('JS: ' + e.message));
  await page.addInitScript(DOUBLURE);
  await page.route('**/*', route => {
    const u = route.request().url();
    if (/fonts\.(googleapis|gstatic)|cdn\.jsdelivr|unpkg|cdnjs|tile\.openstreetmap/i.test(u)) {
      const css = /\.css(?:\?|$)/.test(u);
      return route.fulfill({status:200,contentType:css?'text/css':'text/javascript',body:css?'':'/* neutralisé par le test */'});
    }
    return route.continue();
  });
  const base = `http://127.0.0.1:${PORT}/operations/field-buying.html`;
  try {
    await page.goto(base + '#census', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.ANAGROCI_FB_RICH && window.ANAGROCI_FB, null, {timeout:15000});

    // 1. Village complet
    await page.evaluate(() => ANAGROCI_FB.openVillageForm());
    await page.waitForSelector('#richVillageForm');
    check(await page.locator('.rich-step').count() === 8, '1 · village complet : 8 sections métier');
    await set(page,{rv_nom:'VILLAGE COMPLET TEST',rv_cluster:'BROBO',rv_region:'Gbêkê',rv_dept:'Bouaké',rv_sp:'Brobo',rv_lat:'7.5',rv_lng:'-5.1',rv_precision:'8',rv_prod_est:'25000',rv_nb_prod:'60',rv_route:'B',rv_type_acces:'Piste',rv_competition:'Oui',rv_chef:'CHEF TEST',rv_leader:'LEADER TEST',rv_pref_paie:'Wave',rv_decision:'Retenir'});
    await submit(page,'richVillageForm');
    check(/créé/i.test(await msg(page)), '1 · village complet : sauvegarde acceptée');
    await settle(page);

    // 2. Village minimum opérationnel : aucun GPS requis
    await go(page,'#census'); await page.evaluate(() => ANAGROCI_FB.openVillageForm()); await page.waitForSelector('#richVillageForm');
    const reqVillage = await page.evaluate(() => [...document.querySelectorAll('#richVillageForm [required]')].map(x=>x.id));
    check(reqVillage.length === 2 && reqVillage.includes('rv_nom') && reqVillage.includes('rv_cluster'), '2 · village minimum : nom + cluster seulement');
    await set(page,{rv_nom:'VILLAGE MINIMUM TEST',rv_cluster:'DIABO'}); await submit(page,'richVillageForm');
    check(/créé/i.test(await msg(page)), '2 · village minimum : création sans GPS');
    await settle(page);

    // 3. RT standard
    await go(page,'#census'); await page.evaluate(() => ANAGROCI_FB.openRtForm()); await page.waitForSelector('#richRTForm');
    const rtText = await page.evaluate(() => document.getElementById('fbFormHost').textContent || '');
    check(/Expérience achat RCN/.test(rtText) && /Réputation locale/.test(rtText) && /Capacité d’achat/.test(rtText), '3 · RT : capacité, finance et évaluation présentes');
    await set(page,{rr_nom:'RT TEST STANDARD',rr_tel:'0701020304',rr_village:'v_test_2',rr_activite:'Pisteur'}); await submit(page,'richRTForm');
    check(/RT créé/i.test(await msg(page)), '3 · RT : création standard');
    await settle(page);

    // 4. RT producteur
    await go(page,'#census'); await page.evaluate(() => ANAGROCI_FB.openRtForm()); await page.waitForSelector('#richRTForm');
    await set(page,{rr_nom:'RT PRODUCTEUR TEST',rr_tel:'0701020305',rr_village:'v_test_3',rr_activite:'Producteur',rr_producteur:'Oui'}); await submit(page,'richRTForm');
    check(/Enrôler comme producteur/i.test(await msg(page)), '4 · RT producteur : double rôle détecté');
    await settle(page);

    // 5. Pont RT → Producteur avec préremplissage
    await go(page,'#census'); await page.evaluate(() => ANAGROCI_FB.rtToFarmer('rt_test_1')); await page.waitForSelector('#richFarmerForm');
    const prefill = await page.evaluate(() => ({nom:document.getElementById('rp_nom').value,tel:document.getElementById('rp_tel').value,village:document.getElementById('rp_village').value,rt:document.getElementById('rp_rt').value}));
    check(prefill.nom === 'RT FICTIF 1' && prefill.village === 'v_test_1' && prefill.rt === 'rt_test_1', '5 · RT → Producteur : identité et rattachement préremplis');

    // 6. Producteur sans parcelle
    await go(page,'#census'); await page.evaluate(() => ANAGROCI_FB.openFarmerForm()); await page.waitForSelector('#richFarmerForm');
    const reqFarmer = await page.evaluate(() => [...document.querySelectorAll('#richFarmerForm [required]')].map(x=>x.id));
    check(reqFarmer.length === 2 && reqFarmer.includes('rp_nom') && reqFarmer.includes('rp_village'), '6 · producteur : nom + village seulement requis');
    const farmerText = await page.evaluate(() => document.getElementById('fbFormHost').textContent || '');
    check(/Parcelle à compléter après campagne/i.test(farmerText), '6 · producteur : mention parcelle après campagne');
    await set(page,{rp_nom:'PRODUCTEUR SANS PARCELLE',rp_village:'v_test_4'}); await submit(page,'richFarmerForm');
    check(/Producteur créé/i.test(await msg(page)), '6 · producteur sans parcelle : création autorisée');
    await settle(page);

    // 7. Producteur avec parcelle + GPS
    await go(page,'#census'); await page.evaluate(() => ANAGROCI_FB.openFarmerForm()); await page.waitForSelector('#richFarmerForm');
    await set(page,{rp_nom:'PRODUCTEUR PARCELLE GPS',rp_village:'v_test_5',rp_add_plot:'Oui',rp_plot_name:'PARCELLE TEST',rp_plot_area:'3.5',rp_plot_lat:'7.42',rp_plot_lng:'-5.09',rp_plot_acc:'6',rp_prod_2027:'1800'}); await submit(page,'richFarmerForm');
    check(/Producteur créé/i.test(await msg(page)), '7 · producteur avec parcelle/GPS : création autorisée');
    await settle(page);

    // 8. Doublon producteur via RPC canonique
    await go(page,'#census'); await page.evaluate(() => ANAGROCI_FB.openFarmerForm()); await page.waitForSelector('#richFarmerForm');
    await set(page,{rp_nom:'DUPLICATE TEST',rp_village:'v_test_1'}); await submit(page,'richFarmerForm');
    check(/Doublon possible détecté/i.test(await msg(page)), '8 · doublon producteur : bloqué avant insertion');

    // 9. Farmer Passport 360 dans le shell
    await page.evaluate(() => { location.hash = '#farmers/p_test_1'; });
    await page.waitForSelector('.rich-pass-tabs',{timeout:15000});
    check(await page.locator('.rich-pass-tab').count() === 12, '9 · Farmer Passport : 12 rubriques dans Operations');
    const shellState = await page.evaluate(() => ({sidebar:!!document.getElementById('opsSidebar'),path:location.pathname}));
    check(shellState.sidebar && shellState.path.endsWith('/operations/field-buying.html'), '9 · Farmer Passport : reste dans le shell Operations');

    // 10. Complétude progressive Niveau 1 → Niveau 3
    await go(page,'#census'); await page.evaluate(() => ANAGROCI_FB.openFarmerForm()); await page.waitForSelector('#richFarmerForm');
    await set(page,{rp_nom:'COMPLETUDE TEST',rp_village:'v_test_2'});
    check(/Niveau 1/.test(await page.locator('[data-rich-level]').innerText()), '10 · complétude : Niveau 1 après minimum opérationnel');
    await page.evaluate(() => {
      document.querySelectorAll('#richFarmerForm [data-complete="1"]').forEach(el => {
        if (el.value) return;
        if (el.tagName === 'SELECT') { const o=[...el.options].find(x=>x.value); if(o) el.value=o.value; }
        else if (el.type === 'number') el.value='1'; else el.value='TEST';
        el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
      });
    });
    check(/Niveau 3/.test(await page.locator('[data-rich-level]').innerText()), '10 · complétude : Niveau 3 lorsque le dossier est largement complété');

    // 11. Achat possible sans parcelle
    await go(page,'#purchases'); await page.click('#newBuyBtn'); await page.waitForSelector('#buyForm');
    const hasParcelRequirement = await page.evaluate(() => [...document.querySelectorAll('#buyForm [required]')].some(x => /plot|parcel|gps/i.test(x.id + ' ' + (x.name||''))));
    check(!hasParcelRequirement, '11 · achat : aucune parcelle/GPS exigée');
    await page.selectOption('#bf_village','v_test_2'); await page.selectOption('#bf_farmer','p_test_2');
    await page.fill('#bf_brut','500'); await page.fill('#bf_sacs','6'); await page.fill('#bf_ref','RC-RICH-001');
    await page.click('#bf_submit'); await page.waitForTimeout(200);
    check(!/parcelle|gps/i.test((await page.locator('#bf_msg').innerText()) || ''), '11 · achat : producteur non cartographié non bloqué');

    const hard = errors.filter(e => !/favicon|manifest|Failed to load resource|leaflet/i.test(e));
    check(hard.length === 0, 'console : aucune nouvelle erreur JavaScript');
  } finally {
    await context.close(); await browser.close(); s.close();
  }
  console.log(failures.length ? `\n${failures.length} échec(s)` : '\nFIELD BUYING rich enrollment E2E : PASS — 11 scénarios');
  if (failures.length) { failures.forEach(x=>console.error('- '+x)); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });

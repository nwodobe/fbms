#!/usr/bin/env node
/**
 * Campagnes — contrôle en navigateur réel (données FICTIVES, doublure locale).
 *
 * Vérifie, aux largeurs 390, 768, 1024 et 1440 :
 *   · la pastille de campagne dans l'en-tête (code + type), visible ;
 *   · le tableau de bord : héros, sections réelles / simulations, badge SIMULATION ;
 *   · l'assistant 8 étapes (navigation, étape Résumé atteinte) ;
 *   · les onglets Préparer l'ouverture, Clôture, Archive & suppression ;
 *   · la modale de suppression exige la saisie exacte « SUPPRIMER SIMULATION <code> » ;
 *   · aucun défilement horizontal, aucune erreur console.
 *
 * Aucune donnée réelle : codes 2097 / 2098 réservés aux tests, noms « FICTIF ».
 * Usage : node tests/campagnes-e2e.mjs [--screenshots dossier]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const RACINE = process.cwd();
const PORT = Number(process.env.PORT_FBMS ?? 4327);
const LARGEURS = [390, 768, 1024, 1440];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

function servir() {
  return createServer((req, res) => {
    const chemin = decodeURIComponent((req.url || '/').split('?')[0]);
    let cible = normalize(join(RACINE, chemin));
    if (!cible.startsWith(RACINE)) { res.writeHead(403).end(); return; }
    if (existsSync(cible) && statSync(cible).isDirectory()) cible = join(cible, 'index.html');
    if (!existsSync(cible)) { res.writeHead(404).end('introuvable'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(cible)] ?? 'application/octet-stream' });
    res.end(readFileSync(cible));
  });
}

const DOUBLURE = `
(function () {
  'use strict';
  window.__rpc = [];
  var SIM = { id: '00000000-0000-4000-8000-000000002097', code: '2097', name: 'SIMULATION FICTIVE 2097', year: 2097, campaign_type: 'SIMULATION',
    status: 'OPEN', is_current: true, start_date: '2096-08-01', planned_end_date: '2097-07-31', currency: 'XOF', row_version: 1, config: {} };
  var REAL = { id: '00000000-0000-4000-8000-000000002098', code: '2098', name: 'CAMPAGNE FICTIVE 2098', year: 2098, campaign_type: 'REAL',
    status: 'PLANNING', is_current: false, start_date: '2097-08-01', planned_end_date: '2098-07-31', currency: 'XOF', row_version: 1, config: {} };
  var DASH = [Object.assign({ achats_kg: 12000, recu_kg: 9000, target_mt: 50, achats: 4, receptions: 2, stock_lots: 1, factory_recu_kg: 0, transferts: 0, producteurs: 3 }, SIM),
    Object.assign({ achats_kg: 0, recu_kg: 0, target_mt: 100, achats: 0, receptions: 0, stock_lots: 0, factory_recu_kg: 0, transferts: 0, producteurs: 0 }, REAL)];
  var TABLES = {
    campaigns: [SIM, REAL],
    campaign_events: [{ event: 'CAMPAIGN_CREATED', actor_role: 'Branch Manager', actor_email: null, reason: 'Test fictif', at: '2096-08-01T08:00:00Z', details: {} }],
    campaign_participants: [{ kind: 'ZONE', ref_id: 'Z-FICTIVE', ref_label: 'ZONE FICTIVE', active: true }],
    campaign_targets: [{ level: 'CAMPAIGN', ref_id: null, ref_label: null, target_mt: 50 }],
    campaign_snapshots: [],
    aflp_zones: [{ code: 'Z1', label: 'ZONE FICTIVE', active: true }],
    aflp_clusters: [{ code: 'C1', label: 'CLUSTER FICTIF', zone_code: 'Z1', active: true }],
    villages_light_v: [{ id: 'v1', village: 'VILLAGE FICTIF', cluster: 'CLUSTER FICTIF' }],
    rt_light_v: [{ id: 'r1', id_rt: 'RT-FICTIF-1', nom: 'RT FICTIF' }],
    wms_warehouses: [{ id: 'w1', code: 'WH-FICTIF', name: 'MAGASIN FICTIF', status: 'ACTIVE', is_factory: false }],
    profils: { nom: 'PROFIL DE TEST', role: 'Branch Manager', actif: true }
  };
  var RPC = {
    campaign_dashboard: DASH,
    campaign_open_checklist: [{ code: 'IDENTITY', label: 'Identité complète', ok: true, blocking: true, detail: '' },
      { code: 'PRICE', label: 'Prix d achat', ok: false, blocking: true, detail: 'Aucune règle de prix' },
      { code: 'TARGETS', label: 'Objectifs', ok: false, blocking: false, detail: '' }],
    campaign_close_checklist: [{ domain: 'Field Buying', code: 'ACHATS_BROUILLON', label: 'Achats non validés', severity: 'BLOQUANT', n: 0, link: 'field-buying.html' },
      { domain: 'Stock Transfer', code: 'TRF_OUVERTS', label: 'Transferts non clôturés', severity: 'BLOQUANT', n: 1, link: 'stock-transfer.html' },
      { domain: 'Sacherie', code: 'SACS', label: 'Sacs non retournés', severity: 'RÉSERVE', n: 3, link: 'field-buying.html' }],
    campaign_purge_preview: [{ object: 'Achats', table_name: 'achats', n: 4, action: 'SUPPRIMER' },
      { object: 'Producteurs (Farmer ID)', table_name: 'producteurs', n: 3, action: 'CONSERVER' }]
  };
  function requete(nom) {
    var data = TABLES[nom]; var liste = Array.isArray(data) ? data : []; var unique = Array.isArray(data) ? (data[0] || null) : (data || null);
    var c = { then: function (r, j) { return Promise.resolve({ data: liste, error: null }).then(r, j); },
      single: function () { return Promise.resolve({ data: unique, error: null }); }, maybeSingle: function () { return Promise.resolve({ data: unique, error: null }); } };
    ['select','insert','update','upsert','delete','eq','neq','in','is','not','or','like','ilike','gte','lte','gt','lt','order','limit','range','contains'].forEach(function (k) { c[k] = function () { return c; }; });
    return c;
  }
  window.supabase = { createClient: function () { return {
    auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'utilisateur-de-test' } } }, error: null }); },
      getUser: function () { return Promise.resolve({ data: { user: { id: 'utilisateur-de-test' } }, error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return Promise.resolve({ data: null, error: null }); } },
    from: requete,
    rpc: function (nom) { window.__rpc.push(nom); return Promise.resolve({ data: RPC[nom] === undefined ? null : RPC[nom], error: null }); },
    storage: { from: function () { return { list: function () { return Promise.resolve({ data: [], error: null }); } }; } },
    channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; }, removeChannel: function () {}
  }; } };
  window.ANAGROCI_SUPABASE_URL = 'https://doublure.local';
  window.ANAGROCI_SUPABASE_ANON = 'doublure';
})();
`;

const echecs = [], notes = [];
function verifier(ok, msg) { notes.push((ok ? '  ok   ' : '  ÉCHEC ') + msg); if (!ok) echecs.push(msg); }
const debordement = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
async function attendre(page, fn, arg) { await page.waitForFunction(fn, arg, { timeout: 15000 }); }

async function main() {
  const captures = process.argv.includes('--screenshots') ? process.argv[process.argv.indexOf('--screenshots') + 1] : null;
  if (captures) mkdirSync(captures, { recursive: true });
  const serveur = servir(); await new Promise((r) => serveur.listen(PORT, r));
  const nav = await chromium.launch();
  const base = `http://127.0.0.1:${PORT}/operations/campaigns.html`;
  try {
    for (const w of LARGEURS) {
      const ctx = await nav.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 } });
      const page = await ctx.newPage(); const erreurs = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push(m.text()); });
      page.on('pageerror', (e) => erreurs.push('JS: ' + e.message));
      await page.addInitScript(DOUBLURE);
      await page.route('**/*', (route) => /supabase|jsdelivr|cdnjs|tailwindcss|fonts\.(googleapis|gstatic)/i.test(route.request().url())
        ? route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '/* doublure */' }) : route.continue());
      notes.push(`\n── ${w} px ──`);

      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await attendre(page, () => !!document.querySelector('.camp-hero') && document.querySelectorAll('.camp-card').length >= 2);
      const dash = await page.evaluate(() => ({
        pastille: (document.querySelector('#opsCampaignSlot') || {}).textContent || '',
        sims: document.querySelectorAll('.camp-card.is-sim .camp-sim-badge').length,
        img: !!document.querySelector('.camp-hero img[alt]')
      }));
      verifier(/2097/.test(dash.pastille), `${w}px · en-tête : campagne courante affichée (« ${dash.pastille.trim().slice(0, 40)} »)`);
      verifier(dash.sims >= 1, `${w}px · tableau de bord : badge SIMULATION sur la carte de simulation`);
      verifier(dash.img, `${w}px · héros : photo agricole avec texte alternatif`);
      verifier(!(await debordement(page)), `${w}px · tableau de bord : aucun défilement horizontal`);
      if (captures) await page.screenshot({ path: `${captures}/campagnes-dashboard-${w}.png`, fullPage: true });

      await page.evaluate(() => { location.hash = '#new'; });
      await attendre(page, () => document.querySelectorAll('.camp-steps li').length === 8);
      for (let i = 0; i < 7; i++) {
        if (i === 0) await page.evaluate(() => { document.getElementById('wCode').value = '2099'; document.getElementById('wName').value = 'FICTIVE'; const s = document.getElementById('wStart'); if (s) s.value = '2098-08-01'; const e = document.getElementById('wEnd'); if (e) e.value = '2099-07-31'; });
        await page.click('#wNext');
        await page.waitForTimeout(80);
      }
      const resume = await page.evaluate(() => !!document.querySelector('.camp-summary') && !!document.getElementById('wSave'));
      verifier(resume, `${w}px · assistant : 8 étapes parcourues jusqu'au Résumé`);
      verifier(!(await debordement(page)), `${w}px · assistant : aucun défilement horizontal`);
      if (captures) await page.screenshot({ path: `${captures}/campagnes-assistant-${w}.png`, fullPage: true });

      await page.evaluate(() => { location.hash = '#c/00000000-0000-4000-8000-000000002098/ouverture'; });
      await attendre(page, () => document.querySelectorAll('#campTab .camp-checklist li').length >= 3);
      verifier(await page.evaluate(() => !!document.querySelector('#campTab .camp-ready.ko')), `${w}px · ouverture : campagne incomplète signalée « À COMPLÉTER »`);

      await page.evaluate(() => { location.hash = '#c/00000000-0000-4000-8000-000000002097/cloture'; });
      await attendre(page, () => document.querySelectorAll('#campTab .camp-checklist li').length >= 3);
      verifier(await page.evaluate(() => /empêchent la clôture/.test(document.getElementById('campTab').textContent)), `${w}px · clôture : transfert ouvert bloque la clôture`);
      verifier(!(await debordement(page)), `${w}px · clôture : aucun défilement horizontal`);

      await page.evaluate(() => { location.hash = '#c/00000000-0000-4000-8000-000000002097/suppression'; });
      await attendre(page, () => !!document.getElementById('btnPreview'));
      await page.click('#btnPreview');
      await attendre(page, () => document.querySelectorAll('#prevBox tbody tr').length === 2);
      await page.click('#btnPurge');
      await attendre(page, () => !!document.querySelector('.camp-modal'));
      const modale = await page.evaluate(() => ({ texte: document.querySelector('.camp-modal').textContent, dans: (() => { const r = document.querySelector('.camp-modal-box').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })() }));
      verifier(/SUPPRIMER SIMULATION 2097/.test(modale.texte), `${w}px · suppression : confirmation exacte « SUPPRIMER SIMULATION 2097 » exigée`);
      verifier(modale.dans, `${w}px · suppression : modale entièrement dans l'écran`);
      await page.fill('#cmReason', 'Motif de test fictif');
      await page.fill('#cmTyped', 'SUPPRIMER SIMULATION 2096');
      await page.click('#cmOk');
      await page.waitForTimeout(150);
      const refuse = await page.evaluate(() => !!document.querySelector('.camp-modal') && !window.__rpc.includes('campaign_purge'));
      verifier(refuse, `${w}px · suppression : saisie inexacte refusée, aucun appel serveur`);
      if (captures) await page.screenshot({ path: `${captures}/campagnes-suppression-${w}.png` });
      await page.click('#cmCancel');

      verifier(erreurs.length === 0, `${w}px · aucune erreur console${erreurs.length ? ' : ' + erreurs.slice(0, 3).join(' | ') : ''}`);
      await ctx.close();
    }
  } finally { await nav.close(); serveur.close(); }
  console.log(notes.join('\n'));
  if (echecs.length) { console.error(`\nCampagnes E2E : ${echecs.length} ÉCHEC(S)`); process.exit(1); }
  console.log(`\nCampagnes E2E : PASS (${LARGEURS.length} largeurs)`);
}
main().catch((e) => { console.error(e); process.exit(1); });

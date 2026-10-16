#!/usr/bin/env node
/**
 * Enrôlement par les Chefs d'Unité (Unit Head) — contrôle en navigateur réel.
 *
 * Réutilise la doublure de données de tests/field-buying-e2e.mjs (données
 * FICTIVES) et ne change que le profil connecté. Vérifie, à 390, 768 et 1440 px :
 *   · le Unit Head ouvre les formulaires village et producteur ;
 *   · seul son cluster et seuls ses villages lui sont proposés ;
 *   · l'écriture est envoyée avec le bon cluster / village ;
 *   · une sélection falsifiée hors cluster est refusée AVANT tout envoi ;
 *   · l'édition d'une fiche d'un autre cluster est refusée avec un message explicite ;
 *   · un Unit Head sans cluster reste bloqué ; les achats restent inchangés ;
 *   · le Branch Manager conserve tous les clusters ;
 *   · aucune erreur console, aucun défilement horizontal.
 * La sécurité réelle est vérifiée côté base par tests/sql/unit-head/.
 *
 * Usage : npm install --no-save playwright && node tests/unit-head-enrollment-e2e.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const RACINE = process.cwd();
const PORT = Number(process.env.PORT_FBMS ?? 4341);
const LARGEURS = [390, 768, 1440];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const source = readFileSync(join(RACINE, 'tests/field-buying-e2e.mjs'), 'utf8');
const m = source.match(/const DOUBLURE = `([\s\S]*?)`;\n/);
if (!m) throw new Error('Doublure introuvable dans tests/field-buying-e2e.mjs');
const LIGNE_PROFIL = "profils: { nom: 'PROFIL DE TEST', role: 'Branch Manager', actif: true }";
if (!m[1].includes(LIGNE_PROFIL)) throw new Error('Ligne de profil de la doublure introuvable');
const doublure = (profil) => m[1].replace(LIGNE_PROFIL, 'profils: ' + JSON.stringify(profil));

const PROFILS = {
  UH_BOTRO: { nom: 'UH FICTIF BOTRO', role: 'Unit Head', actif: true, cluster: 'BOTRO', zone: null },
  UH_SANS: { nom: 'UH FICTIF SANS CLUSTER', role: 'Unit Head', actif: true, cluster: null, zone: null },
  BM: { nom: 'BM FICTIF', role: 'Branch Manager', actif: true, cluster: null, zone: null },
};

let ok = 0; const echecs = []; const journal = [];
function verifier(c, libelle) { journal.push((c ? 'PASS ' : 'FAIL ') + libelle); if (c) ok++; else echecs.push(libelle); }

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

async function ouvrir(navigateur, largeur, profil) {
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 500 ? 844 : 900 } });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('console', (x) => { if (x.type() === 'error') erreurs.push(x.text()); });
  page.on('pageerror', (e) => erreurs.push('JS: ' + e.message));
  await page.addInitScript(doublure(profil));
  /* Règle de prix FICTIVE : la doublure partagée ne répond pas à procurement_active_rule. */
  await page.addInitScript(() => {
    const cc = window.supabase.createClient;
    window.supabase.createClient = function () {
      const c = cc.apply(this, arguments), rpc = c.rpc;
      c.rpc = function (nom, args) {
        if (nom === 'procurement_active_rule') {
          return Promise.resolve({ data: { price_per_kg: 400, rt_commission_per_kg: 10, max_moisture_pct: 10, min_kor: 46 }, error: null });
        }
        return rpc.call(this, nom, args);
      };
      return c;
    };
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (/supabase|jsdelivr|cdnjs|tailwindcss|fonts\.(googleapis|gstatic)|tile\.openstreetmap/i.test(url)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '/* doublure */' });
    }
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${PORT}/operations/field-buying.html#census`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ANAGROCI_FB && !document.querySelector('#opsRouteView .skeleton'), null, { timeout: 20000 });
  return { contexte, page, erreurs };
}
const attendreForm = (page) => page.waitForFunction(() => {
  const h = document.getElementById('fbFormHost');
  return h && !h.hidden && !/Ouverture du formulaire/.test(h.textContent);
}, null, { timeout: 15000 });
const texteForm = (page) => page.evaluate(() => document.getElementById('fbFormHost').textContent);
const ecritures = (page) => page.evaluate(() => (window.__writes || []).filter((w) => w.t === 'villages' || w.t === 'producteurs'));
const debordement = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

async function main() {
  const serveur = servir();
  await new Promise((r) => serveur.listen(PORT, r));
  const navigateur = await chromium.launch();
  try {
    for (const L of LARGEURS) {
      /* ---------------------------------------------------- Unit Head Botro */
      let { contexte, page, erreurs } = await ouvrir(navigateur, L, PROFILS.UH_BOTRO);
      const boutons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()));
      verifier(boutons.includes('+ Nouveau village') && boutons.includes('+ Nouveau producteur'), `${L}px · UH : boutons « Nouveau village » et « Nouveau producteur » présents`);

      await page.getByRole('button', { name: '+ Nouveau village' }).first().click();
      await attendreForm(page);
      let t = await texteForm(page);
      verifier(!/Création non autorisée/.test(t), `${L}px · UH : formulaire village ouvert (plus de refus de rôle)`);
      const opts = await page.evaluate(() => [...document.querySelectorAll('#vf_cluster option')].filter((o) => o.value).map((o) => [o.value, o.selected]));
      verifier(opts.length === 1 && opts[0][0] === 'Botro' && opts[0][1], `${L}px · UH : seul le cluster Botro est proposé et présélectionné (${JSON.stringify(opts)})`);
      await page.fill('#vf_nom', 'VILLAGE FICTIF UH ' + L);
      await page.click('#vf_submit');
      await page.waitForFunction(() => /Village créé|refusé|impossible/i.test(document.getElementById('vf_msg').textContent), null, { timeout: 10000 });
      let w = await ecritures(page);
      const insV = w.filter((x) => x.op === 'insert' && x.t === 'villages');
      verifier(insV.length === 1 && insV[0].row.cluster === 'Botro', `${L}px · UH : village envoyé une fois, avec le cluster Botro`);
      await page.waitForTimeout(1500);

      /* Sélection falsifiée : option Diabo injectée dans la liste. */
      await page.evaluate(() => window.ANAGROCI_FB.openVillageForm());
      await attendreForm(page);
      await page.evaluate(() => { const s = document.getElementById('vf_cluster'); const o = document.createElement('option'); o.value = 'Diabo'; o.textContent = 'Diabo'; s.appendChild(o); s.value = 'Diabo'; });
      await page.fill('#vf_nom', 'VILLAGE FALSIFIE ' + L);
      const avant = (await ecritures(page)).length;
      await page.click('#vf_submit');
      await page.waitForTimeout(400);
      t = await page.evaluate(() => document.getElementById('vf_msg').textContent);
      verifier(/refusé/i.test(t) && (await ecritures(page)).length === avant, `${L}px · UH : cluster falsifié (Diabo) refusé avant envoi`);

      /* Édition d'un village d'un autre cluster (v_test_5 = Diabo). */
      await page.evaluate(() => window.ANAGROCI_FB.openVillageForm('v_test_5'));
      await attendreForm(page);
      t = await texteForm(page);
      verifier(/Modification non autorisée/.test(t) && /hors de votre périmètre/.test(t), `${L}px · UH : édition d'un village Diabo refusée avec message explicite`);

      /* Producteur : seuls les villages Botro (v_test_4, v_test_10) sont proposés. */
      await page.evaluate(() => window.ANAGROCI_FB.openFarmerForm());
      await attendreForm(page);
      const vOpts = await page.evaluate(() => [...document.querySelectorAll('#ff_village option')].filter((o) => o.value).map((o) => o.value).sort());
      verifier(JSON.stringify(vOpts) === JSON.stringify(['v_test_10', 'v_test_4']), `${L}px · UH : seuls les villages de Botro proposés (${vOpts.join(', ')})`);
      await page.fill('#ff_nom', 'PRODUCTEUR FICTIF UH ' + L);
      await page.selectOption('#ff_village', 'v_test_4');
      const avantP = (await ecritures(page)).length;
      await page.click('#ff_submit');
      await page.waitForFunction((n) => (window.__writes || []).filter((x) => x.t === 'producteurs').length > 0 ||
        /refusé|impossible|Doublon/i.test(document.getElementById('ff_msg').textContent), avantP, { timeout: 10000 });
      w = await ecritures(page);
      const insP = w.filter((x) => x.op === 'insert' && x.t === 'producteurs');
      verifier(insP.length === 1 && insP[0].row.village_id === 'v_test_4', `${L}px · UH : producteur envoyé, rattaché au village Botro v_test_4`);
      /* L'application ouvre le Farmer Passport 1,2 s après l'enrôlement : on attend cette navigation. */
      await page.waitForFunction(() => /^#farmers\//.test(location.hash), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);

      /* Village falsifié pour le producteur. */
      await page.evaluate(() => window.ANAGROCI_FB.openFarmerForm());
      await attendreForm(page);
      await page.fill('#ff_nom', 'PRODUCTEUR FALSIFIE ' + L);
      await page.evaluate(() => { const s = document.getElementById('ff_village'); const o = document.createElement('option'); o.value = 'v_test_5'; o.textContent = 'x'; s.appendChild(o); s.value = 'v_test_5'; });
      const avantF = (await ecritures(page)).length;
      await page.click('#ff_submit');
      await page.waitForTimeout(400);
      t = await page.evaluate(() => document.getElementById('ff_msg').textContent);
      verifier(/refusé/i.test(t) && (await ecritures(page)).length === avantF, `${L}px · UH : village falsifié (Diabo) refusé avant envoi`);

      /* Édition d'un producteur Diabo (p_test_5, village v_test_5). */
      await page.evaluate(() => window.ANAGROCI_FB.openFarmerForm(null, 'p_test_5'));
      await attendreForm(page);
      t = await texteForm(page);
      verifier(/Modification non autorisée/.test(t), `${L}px · UH : édition d'un producteur Diabo refusée`);

      /* Achats : comportement inchangé (hors périmètre du correctif). */
      await page.evaluate(() => window.ANAGROCI_FB.openBuyForm && window.ANAGROCI_FB.openBuyForm());
      await page.waitForTimeout(800);
      t = await texteForm(page);
      verifier(/Création non autorisée/.test(t), `${L}px · UH : formulaire d'achat toujours fermé (module achats inchangé)`);

      const erreursEnLigne = erreurs.slice();
      /* Hors ligne : paquet préparé lors du chargement en ligne, puis réseau coupé. */
      if (L === 390) {
        await page.waitForTimeout(1500);
        await contexte.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.ANAGROCI_FB && window.ANAGROCI_OFFLINE && !window.ANAGROCI_OFFLINE.isOnline(), null, { timeout: 20000 });
        await page.evaluate(() => window.ANAGROCI_FB.openVillageForm());
        await attendreForm(page);
        t = await texteForm(page);
        const optsOff = await page.evaluate(() => [...document.querySelectorAll('#vf_cluster option')].filter((o) => o.value).map((o) => o.value));
        verifier(!/non autorisée|Aucun cluster/.test(t) && JSON.stringify(optsOff) === '["Botro"]', `${L}px · UH hors ligne : formulaire village ouvert, cluster Botro seul (${JSON.stringify(optsOff)})`);
        await page.evaluate(() => window.ANAGROCI_FB.openFarmerForm());
        await attendreForm(page);
        const vOff = await page.evaluate(() => [...document.querySelectorAll('#ff_village option')].filter((o) => o.value).length);
        verifier(vOff === 2, `${L}px · UH hors ligne : formulaire producteur ouvert, 2 villages Botro (${vOff})`);
      }
      verifier(!(await debordement(page)), `${L}px · UH : aucun défilement horizontal`);
      verifier(erreursEnLigne.length === 0, `${L}px · UH : aucune erreur console en ligne ${erreursEnLigne.length ? JSON.stringify(erreursEnLigne.slice(0, 3)) : ''}`);
      await contexte.close();

      /* ---------------------------------------------------- Unit Head sans cluster */
      ({ contexte, page, erreurs } = await ouvrir(navigateur, L, PROFILS.UH_SANS));
      await page.evaluate(() => window.ANAGROCI_FB.openVillageForm());
      await attendreForm(page);
      t = await texteForm(page);
      verifier(/Création non autorisée/.test(t) && /Aucun cluster d’affectation/.test(t), `${L}px · UH sans cluster : écriture bloquée, message explicite`);
      await contexte.close();

      /* ---------------------------------------------------- Branch Manager */
      ({ contexte, page, erreurs } = await ouvrir(navigateur, L, PROFILS.BM));
      await page.evaluate(() => window.ANAGROCI_FB.openVillageForm());
      await attendreForm(page);
      const nb = await page.evaluate(() => [...document.querySelectorAll('#vf_cluster option')].filter((o) => o.value).length);
      verifier(nb === 6, `${L}px · BM : les 6 clusters restent proposés (${nb})`);
      await page.evaluate(() => window.ANAGROCI_FB.openVillageForm('v_test_5'));
      await attendreForm(page);
      t = await texteForm(page);
      verifier(!/non autorisée/.test(t), `${L}px · BM : édition d'un village Diabo toujours possible`);
      await page.evaluate(() => window.ANAGROCI_FB.openFarmerForm());
      await attendreForm(page);
      const nbV = await page.evaluate(() => [...document.querySelectorAll('#ff_village option')].filter((o) => o.value).length);
      verifier(nbV === 12, `${L}px · BM : les 12 villages restent proposés au producteur (${nbV})`);
      verifier(erreurs.length === 0, `${L}px · BM : aucune erreur console ${erreurs.length ? JSON.stringify(erreurs.slice(0, 3)) : ''}`);
      await contexte.close();
    }
  } finally {
    await navigateur.close();
    serveur.close();
  }
  console.log(journal.join('\n'));
  console.log(JSON.stringify({ resultat: echecs.length ? 'FAIL' : 'PASS', reussis: ok, echecs: echecs.length }));
  if (echecs.length) process.exit(1);
}
main().catch((e) => { console.log(journal.join("\n")); console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * LBA Purchase — contrôle en navigateur réel.
 *
 * Ce fichier existe à cause d'un défaut précis : le bouton « + Nouveau LBA » et la
 * rubrique « Achats RCN » avaient été écrits, commités et déployés, et restaient
 * pourtant invisibles. Deux scripts publiaient tour à tour ANAGROCI_OPS_ROUTE ;
 * le dernier à finir son init() asynchrone écrasait l'autre. Aucun contrôle de
 * fichier ne pouvait le voir : il fallait ouvrir la page.
 *
 * Le contrôle ouvre donc réellement la page, aux sept largeurs de la politique, et
 * vérifie ce qu'un utilisateur voit :
 *
 *   · « + Nouveau LBA » visible sur Vue d'ensemble ET LBA Registry ;
 *   · hauteur ≥ 44 px, dans le viewport, sans débordement horizontal ;
 *   · « Achats RCN » présent dans la barre latérale et réellement rendu ;
 *   · le changement de rubrique reste dans operations/lba-purchase.html ;
 *   · le cache évite de relancer les requêtes de base à chaque clic ;
 *   · aucune erreur console.
 *
 * Les données sont FICTIVES et servies par une doublure locale : aucun nom de
 * producteur, aucun montant, aucune coordonnée réels n'entre dans un test.
 *
 * Usage : node tests/lba-purchase-e2e.mjs [--screenshots dossier]
 * Prérequis : playwright installé et Chromium disponible.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const RACINE = process.cwd();
const PORT = Number(process.env.PORT_FBMS ?? 4321);
const SEUIL_TACTILE = 44;

/** Les sept largeurs demandées. 360 px est le cas qui casse en premier. */
const LARGEURS = [1920, 1440, 1366, 1024, 768, 390, 360];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

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

/* --------------------------------------------------------- doublure de données */
/* Même forme d'API que le SDK réel, mais avec des données inventées et un compteur
   de lectures : c'est ce compteur qui prouve que le cache sert à quelque chose. */

const DOUBLURE = `
(function () {
  'use strict';
  window.__lectures = [];
  var LBAS = [], CAPS = [], BAGS = [], ACHATS = [], RECEPTIONS = [];
  for (var i = 1; i <= 23; i++) {
    var code = 'LBA-' + String(i).padStart(3, '0') + '-' + String.fromCharCode(64 + ((i % 26) || 26)).repeat(3);
    LBAS.push({ code: code, nom: 'COOPERATIVE FICTIVE ' + i, categorie: 'LBA', statut: 'ACTIF',
      contrat: i % 3 === 0, origines: ['ZONE ' + (i % 4)], sites: ['SITE ' + (i % 3)],
      volume_livre_kg: 1000 * i, sacs_livres: 10 * i, nb_livraisons: i,
      kor_moyen: 45 + (i % 5), humidite_moyenne: 7 + (i % 3),
      premiere_livraison: '2026-01-01', derniere_livraison: '2026-06-0' + ((i % 9) + 1) });
    if (i % 2 === 0) CAPS.push({ lba_code: code, lba_name: 'COOPERATIVE FICTIVE ' + i,
      approved_limit: 1000000 * i, current_exposure: 200000 * i, available_capacity: 800000 * i,
      utilization_pct: 20, capacity_status: 'AVAILABLE', effective_from: '2026-01-01',
      next_limit: null, next_limit_from: null });
    BAGS.push({ supplier_code: code, balance: i, issued: 10 * i, returned: 9 * i,
      bucket_90_plus: i % 4, return_rate: 90, last_movement: '2026-06-01' });
    RECEPTIONS.push({ id: 'REC-' + i, site_code: 'SITE ' + (i % 3), warehouse_code: 'WH-' + (i % 2),
      origine: 'ZONE ' + (i % 4), camion: 'CAM-' + i, arrivee_at: '2026-06-01T08:00:00Z' });
    ACHATS.push({ id: 'ACH-' + i, reception_id: 'REC-' + i, supplier_code: code,
      supplier_name: 'COOPERATIVE FICTIVE ' + i, poids_net_kg: 1000 + i, refraction_kg: i,
      poids_paye_kg: 1000, prix_negocie: 400, prix_soumis_bm: 400, montant_soumis: 400000,
      prix_approuve_gm: i % 2 ? 410 : null, montant_approuve: i % 2 ? 410000 : null,
      kor_sampling: 46, kor_final: 47, humidite_finale: 8,
      statut: i % 2 ? 'APPROUVÉ' : 'SOUMIS',
      submitted_at: '2026-06-0' + ((i % 9) + 1) + 'T09:00:00Z', decided_at: null });
  }
  var TABLES = {
    rcn_fournisseurs: LBAS,
    lba_funding_capacity_v: CAPS,
    rcn_jute_v_supplier_profile: BAGS,
    lba_funding_cycle_status_v: [],
    rcn_proc_validations_achat: ACHATS,
    rcn_receptions: RECEPTIONS,
    rcn_proc_financements: [],
    rcn_proc_arrivages: [],
    lba_funding_limit_history: [],
    lba_funding_limit_audit: [],
    profils: { nom: 'PROFIL DE TEST', role: 'Procurement Officer', actif: true }
  };
  function requete(nom) {
    window.__lectures.push(nom);
    var data = TABLES[nom];
    var liste = Array.isArray(data) ? data : [];
    var unique = Array.isArray(data) ? null : (data || null);
    var c = {
      select: f, insert: f, update: f, upsert: f, delete: f, eq: f, neq: f, in: f, like: f,
      ilike: f, gte: f, lte: f, order: f, limit: f, range: f,
      single: function () { return Promise.resolve({ data: unique, error: null }); },
      maybeSingle: function () { return Promise.resolve({ data: unique, error: null }); },
      then: function (r) { return Promise.resolve({ data: liste, error: null }).then(r); }
    };
    function f() { return c; }
    return c;
  }
  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () {
            return Promise.resolve({ data: { session: { user: { id: 'utilisateur-de-test' } } }, error: null });
          },
          getUser: function () {
            return Promise.resolve({ data: { user: { id: 'utilisateur-de-test' } }, error: null });
          },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signOut: function () { return Promise.resolve({ data: null, error: null }); }
        },
        from: requete,
        rpc: function (nom, args) {
          window.__lectures.push('rpc:' + nom);
          if (nom === 'lba_create') {
            return Promise.resolve({ data: { code: 'LBA-024-NEW', nom: args && args.p_nom, categorie: 'LBA', statut: 'ACTIF' }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        storage: { from: function () { return { list: function () { return Promise.resolve({ data: [], error: null }); } }; } },
        channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
        removeChannel: function () {}
      };
    }
  };
  window.ANAGROCI_SUPABASE_URL = 'https://doublure.local';
  window.ANAGROCI_SUPABASE_ANON = 'doublure';
})();
`;

/* ------------------------------------------------------------------ contrôles */

const echecs = [];
const notes = [];
function verifier(condition, message) {
  if (condition) notes.push('  ok   ' + message);
  else { echecs.push(message); notes.push('  ÉCHEC ' + message); }
}

async function mesurerBouton(page) {
  return page.evaluate((seuil) => {
    const b = document.getElementById('newLbaBtn');
    if (!b) return { present: false };
    const r = b.getBoundingClientRect();
    const s = getComputedStyle(b);
    return {
      present: true,
      texte: (b.textContent || '').trim(),
      hauteur: Math.round(r.height),
      assezHaut: r.height >= seuil,
      visible: s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0
        && r.width > 0 && r.height > 0,
      dansEcran: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1,
      couleur: s.backgroundColor,
      debordement: document.documentElement.scrollWidth > window.innerWidth + 1,
      dansMenuPlus: !!b.closest('.ops-overflow-menu')
    };
  }, SEUIL_TACTILE);
}

async function allerA(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction(
    () => !document.querySelector('#opsRouteView .skeleton'),
    null, { timeout: 15000 }
  );
}

async function main() {
  const dossierCaptures = process.argv.includes('--screenshots')
    ? process.argv[process.argv.indexOf('--screenshots') + 1] : null;
  if (dossierCaptures) mkdirSync(dossierCaptures, { recursive: true });

  const serveur = servir();
  await new Promise((r) => serveur.listen(PORT, r));
  const navigateur = await chromium.launch();
  const base = `http://127.0.0.1:${PORT}/operations/lba-purchase.html`;

  try {
    for (const largeur of LARGEURS) {
      const hauteur = largeur < 500 ? 844 : 900;
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur } });
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
      page.on('pageerror', (e) => erreurs.push('JS: ' + e.message));
      await page.addInitScript(DOUBLURE);
      /* Le SDK tiers n'est pas joignable depuis l'intégration : on sert la doublure. */
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (/supabase|jsdelivr|cdnjs|tailwindcss|fonts\.(googleapis|gstatic)/i.test(url)) {
          return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '/* doublure */' });
        }
        return route.continue();
      });

      notes.push(`\n── ${largeur} px ──`);

      // 1. Vue d'ensemble
      await page.goto(base + '#overview', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!document.getElementById('newLbaBtn'), null, { timeout: 15000 });
      let b = await mesurerBouton(page);
      verifier(b.present, `${largeur}px · Vue d'ensemble : « + Nouveau LBA » présent`);
      verifier(b.visible, `${largeur}px · Vue d'ensemble : bouton visible`);
      verifier(b.assezHaut, `${largeur}px · Vue d'ensemble : hauteur ${b.hauteur}px ≥ ${SEUIL_TACTILE}px`);
      verifier(b.dansEcran, `${largeur}px · Vue d'ensemble : bouton entièrement dans l'écran`);
      verifier(!b.dansMenuPlus, `${largeur}px · Vue d'ensemble : bouton hors du menu « Plus d'actions »`);
      verifier(!b.debordement, `${largeur}px · Vue d'ensemble : aucun défilement horizontal`);
      verifier(/Nouveau LBA/.test(b.texte || ''), `${largeur}px · libellé « + Nouveau LBA »`);

      // 2. LBA Registry
      await allerA(page, '#registry');
      await page.waitForFunction(() => !!document.getElementById('newLbaBtn'), null, { timeout: 15000 });
      b = await mesurerBouton(page);
      verifier(b.present && b.visible, `${largeur}px · LBA Registry : « + Nouveau LBA » visible`);
      verifier(b.assezHaut, `${largeur}px · LBA Registry : hauteur ${b.hauteur}px ≥ ${SEUIL_TACTILE}px`);
      verifier(b.dansEcran, `${largeur}px · LBA Registry : bouton entièrement dans l'écran`);
      verifier(!b.debordement, `${largeur}px · LBA Registry : aucun défilement horizontal`);

      // 3. Achats RCN : présente dans la barre latérale et réellement rendue
      const lienAchats = await page.evaluate(() => {
        const a = [...document.querySelectorAll('.ops-nav a')]
          .find((x) => /Achats RCN/i.test(x.textContent || ''));
        return a ? a.getAttribute('href') : null;
      });
      verifier(lienAchats === '#purchases', `${largeur}px · « Achats RCN » dans la barre latérale`);
      await allerA(page, '#purchases');
      const achats = await page.evaluate(() => ({
        titre: (document.querySelector('.ops-route-head h1') || {}).textContent || '',
        colonnes: [...document.querySelectorAll('#purchaseTable th')].map((t) => t.textContent.trim()),
        indicateurs: document.querySelectorAll('#purchaseKpis .kpi').length,
        filtres: ['pfLba', 'pfFrom', 'pfTo', 'pfStatut', 'pfSite'].filter((i) => document.getElementById(i)).length,
        url: location.pathname
      }));
      verifier(/Achats RCN/i.test(achats.titre), `${largeur}px · rubrique Achats RCN rendue (titre « ${achats.titre} »)`);
      verifier(achats.url.endsWith('/operations/lba-purchase.html'),
        `${largeur}px · Achats RCN reste dans lba-purchase.html`);
      if (largeur === 1440) {
        for (const col of ['Date', 'LBA', 'Nom du LBA', 'Réception', 'Poids net', 'Poids payé',
                           'Prix', 'Montant', 'KOR', 'Humidité', 'Statut', 'Site / destination']) {
          verifier(achats.colonnes.includes(col), `Achats RCN : colonne « ${col} »`);
        }
        verifier(achats.indicateurs === 6, `Achats RCN : 6 indicateurs (vu ${achats.indicateurs})`);
        verifier(achats.filtres === 5, `Achats RCN : 5 filtres (vu ${achats.filtres})`);
      }

      // 4. Le formulaire de création s'ouvre et porte les champs attendus
      if (largeur === 1440 || largeur === 360) {
        await allerA(page, '#registry');
        await page.click('#newLbaBtn');
        await page.waitForSelector('#lbaCreateForm', { timeout: 15000 });
        const form = await page.evaluate(() => ({
          champs: ['nl_nom', 'nl_code', 'nl_zone', 'nl_site', 'nl_contrat'].filter((i) => document.getElementById(i)).length,
          codePropose: (document.getElementById('nl_code') || {}).value || '',
          debordement: document.documentElement.scrollWidth > window.innerWidth + 1
        }));
        verifier(form.champs === 5, `${largeur}px · formulaire de création : 5 champs (vu ${form.champs})`);
        verifier(/^LBA-024-/.test(form.codePropose),
          `${largeur}px · code suivant proposé (vu « ${form.codePropose} », attendu LBA-024-…)`);
        verifier(!form.debordement, `${largeur}px · formulaire : aucun défilement horizontal`);

        // Anti-doublon : un nom déjà présent doit déclencher une alerte avant l'envoi.
        await page.fill('#nl_nom', 'COOPERATIVE FICTIVE 3');
        await page.waitForTimeout(120);
        const doublon = await page.evaluate(() => (document.getElementById('nl_dup') || {}).innerHTML || '');
        verifier(/existe déjà/i.test(doublon), `${largeur}px · alerte anti-doublon sur un nom déjà présent`);
      }

      // 5. Navigation et réutilisation du cache
      if (largeur === 1440) {
        await allerA(page, '#registry');
        await page.evaluate(() => { window.__lectures.length = 0; });
        const chrono = {};
        for (const [libelle, hash] of [['Registry → Limites', '#limits'],
                                       ['Limites → Registry', '#registry'],
                                       ['Registry → Achats RCN', '#purchases'],
                                       ['Achats RCN → Limites', '#limits']]) {
          const t0 = Date.now();
          await allerA(page, hash);
          chrono[libelle] = Date.now() - t0;
        }
        const lectures = await page.evaluate(() => window.__lectures.slice());
        const basesRelues = lectures.filter((t) => t === 'lba_funding_capacity_v').length;
        notes.push('  chronos (cache chaud) : ' + JSON.stringify(chrono));
        notes.push('  lectures pendant ces 4 changements : ' + (lectures.join(', ') || 'aucune'));
        verifier(basesRelues === 0,
          `cache : les données de base ne sont pas relues au changement de rubrique (relues ${basesRelues} fois)`);
        for (const [libelle, ms] of Object.entries(chrono)) {
          verifier(ms < 300, `changement de rubrique « ${libelle} » en ${ms} ms (< 300 ms)`);
        }

        // Retour arrière du navigateur
        await page.goBack();
        await page.waitForTimeout(400);
        const apresRetour = await page.evaluate(() => ({ hash: location.hash, path: location.pathname }));
        verifier(apresRetour.path.endsWith('/operations/lba-purchase.html'),
          'retour arrière : on reste dans lba-purchase.html');
      }

      // 6. Captures
      if (dossierCaptures) {
        for (const [nom, hash] of [['overview', '#overview'], ['registry', '#registry'], ['achats-rcn', '#purchases']]) {
          await allerA(page, hash);
          await page.screenshot({ path: join(dossierCaptures, `lba-${nom}-${largeur}.png`), fullPage: false });
        }
      }

      // 7. Console propre
      const dures = erreurs.filter((e) => !/favicon|manifest|Failed to load resource/i.test(e));
      verifier(dures.length === 0, `${largeur}px · aucune erreur console` + (dures.length ? ' — ' + dures[0] : ''));

      await contexte.close();
    }
  } finally {
    await navigateur.close();
    serveur.close();
  }

  console.log(notes.join('\n'));
  console.log('\n' + (echecs.length ? `${echecs.length} ÉCHEC(S)\n- ` + echecs.join('\n- ')
    : `LBA Purchase E2E : PASS (${LARGEURS.length} largeurs)`));
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

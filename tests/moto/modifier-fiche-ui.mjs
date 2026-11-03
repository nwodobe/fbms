#!/usr/bin/env node
/**
 * Régression ciblée : modification d'une fiche moto incomplète.
 *
 * Sert le véritable moto/index.html et ses scripts locaux. Seuls la session,
 * le client Supabase et le générateur QR externe sont doublés. L'état fictif
 * reste dans ce processus pour vérifier la persistance après rechargement.
 * Ce test vérifie l'interface et son contrat RPC, pas les politiques RLS.
 *
 * Aucune connexion au service de production : toutes les sorties réseau
 * du navigateur sont interceptées, sauf le serveur statique local.
 *
 * Exécution : node tests/moto/modifier-fiche-ui.mjs
 * Facultatif : CHROMIUM=/chemin/chrome MOTO_MODIFICATION_PREUVES=/tmp/preuves
 *              FBMS_PLAYWRIGHT_MODULE=/chemin/node_modules/playwright
 * Dépendance : Playwright installé ou fourni par le runtime Codex.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
let playwright;
if (process.env.FBMS_PLAYWRIGHT_MODULE) {
  playwright = require(process.env.FBMS_PLAYWRIGHT_MODULE);
} else {
  try {
    playwright = require('playwright');
  } catch (erreur) {
    const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (!modules) throw erreur;
    playwright = createRequire(join(modules, '__resolution_tests_moto__.cjs'))('playwright');
  }
}

const SORTIE = resolve(process.env.MOTO_MODIFICATION_PREUVES ||
  join(tmpdir(), 'fbms-modification-fiche-' + Date.now()));
assert.ok(SORTIE !== RACINE && !SORTIE.startsWith(RACINE + sep),
  'Les preuves doivent rester hors du dépôt, dans un répertoire temporaire.');
mkdirSync(SORTIE, { recursive: true });

const LARGEURS = [
  { nom: 'mobile', width: 390, height: 844 },
  { nom: 'tablette', width: 768, height: 1024 },
  { nom: 'bureau', width: 1440, height: 900 }
];
const ROLES = {
  BM: 'Branch Manager', ABM: 'Assistant Branch Manager',
  UH: 'Unit Head', ZH: 'Zonal Head'
};
const MOTO_ID = '00000000-0000-4000-9000-000000000901';
const CHAMPS = new Set([
  'marque', 'modele', 'annee', 'couleur', 'numero_chassis', 'numero_moteur',
  'immatriculation', 'fournisseur', 'date_reception', 'observations', 'row_version'
]);
const RESULTATS = [];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};

function fixture(role) {
  const profil = {
    user_id: '00000000-0000-4000-9000-00000000090' + (Object.keys(ROLES).indexOf(role) + 2),
    nom: role + ' FICTIF', role: ROLES[role], actif: true, cluster: 'SAKASSOU'
  };
  return {
    profil, appels: [], lecturesFlotte: 0, sortiesInterdites: [], erreurs: [],
    moto: {
      id: MOTO_ID, code: 'MOTO-FICTIVE-901', marque: null, modele: null,
      annee: null, couleur: null, numero_chassis: 'CHASSIS-TEST-FICTIF',
      numero_moteur: null, immatriculation: null, fournisseur: null,
      date_reception: null, situation_parc: 'RECEPTIONNEE', origine: 'EN_EXPLOITATION',
      cluster_code: 'SAKASSOU', zone_code: 'GBEKE_1', statut_administratif: 'EN_ATTENTE',
      statut_affectation: 'REMISE', type_affectation: 'REMISE',
      statut_technique: 'A_CONTROLER', autorisee_a_circuler: false,
      mise_en_service_at: null, compteur_actuel_km: null, compteur_reception_km: null,
      beneficiaire_id: profil.user_id, beneficiaire_nom: 'BENEFICIAIRE FICTIF',
      beneficiaire_classe: 'UNITE', beneficiaire_prevu_id: profil.user_id,
      beneficiaire_prevu_nom: 'BENEFICIAIRE FICTIF', incidents_ouverts: 0,
      actions_ouvertes: 0, actions_critiques_ouvertes: 0, dossier_incomplet: true,
      observations: 'Observation initiale fictive.', historique_note: null,
      photo_path: null, row_version: 7
    }
  };
}

function installerDoublure(profil) {
  window.ANAGROCI_AUTH = { profile: profil };
  window.ANAGROCI_SUPABASE_URL = 'https://donnees-fictives.example.invalid';
  window.ANAGROCI_SUPABASE_ANON = 'cle-fictive-de-test-sans-acces';
  window.supabase = {
    createClient: function () {
      return {
        from: function (table) {
          var singulier = false, filtres = [];
          var q = {
            select: function () { return q; },
            eq: function (champ, valeur) { filtres.push([champ, valeur]); return q; },
            neq: function () { return q; },
            in: function () { return q; },
            is: function () { return q; },
            order: function () { return q; },
            limit: function () { return q; },
            single: function () { singulier = true; return q; },
            maybeSingle: function () { singulier = true; return q; },
            then: function (ok, ko) {
              return window.__motoTestLire(table, filtres).then(function (lignes) {
                return { data: singulier ? lignes[0] || null : lignes, error: null };
              }).then(ok, ko);
            }
          };
          return q;
        },
        rpc: function (nom, args) { return window.__motoTestRpc(nom, args); }
      };
    }
  };
  // Le QR n'intervient pas dans l'édition. Aucun CDN n'est chargé pour le test.
  window.qrcode = function () {
    return {
      addData: function () {}, make: function () {},
      createSvgTag: function () {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" role="img" aria-label="QR fictif"><rect width="64" height="64" fill="#eee"/></svg>';
      }
    };
  };
}

const serveur = createServer((req, res) => {
  try {
    const chemin = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let fichier = resolve(RACINE, '.' + chemin);
    if (!fichier.startsWith(RACINE + sep)) { res.writeHead(403).end(); return; }
    if (existsSync(fichier) && statSync(fichier).isDirectory()) fichier = join(fichier, 'index.html');
    if (!existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404).end('Absent'); return; }
    res.writeHead(200, {
      'content-type': TYPES[extname(fichier)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(readFileSync(fichier));
  } catch {
    res.writeHead(400).end('Chemin invalide');
  }
});
await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
const BASE = 'http://127.0.0.1:' + serveur.address().port;
let navigateur;
let navigation = 0;

function noter(cas, preuve) {
  RESULTATS.push({ cas, resultat: 'REUSSI', preuve: preuve || null });
  console.log('OK ' + cas);
}
async function capture(page, nom) {
  const chemin = join(SORTIE, nom + '.png');
  // Une capture pleine page agrandirait artificiellement le viewport du dialogue.
  const modaleOuverte = await page.locator('dialog.mm-modale[open]').count();
  await page.screenshot({ path: chemin, fullPage: modaleOuverte === 0 });
  return chemin;
}
async function pret(page) {
  await page.waitForFunction(() => {
    const vue = document.querySelector('#motoVue');
    return vue && !vue.querySelector('.mm-chargement') && vue.querySelector('h1');
  });
}
async function ouvrirParc(page) {
  await page.goto(BASE + '/moto/index.html?controle=' + (++navigation) + '#/motos');
  await pret(page);
}
async function ouvrirFiche(page) {
  await page.goto(BASE + '/moto/index.html?controle=' + (++navigation) + '#/moto/' + MOTO_ID);
  await pret(page);
  await page.locator('#mmOnglet .mm-chargement').waitFor({ state: 'hidden' });
}
async function ouvrirEdition(page, depuisParc = false) {
  const bouton = depuisParc
    ? page.locator('[data-modifier-moto="' + MOTO_ID + '"]')
    : page.locator('.mm-passeport [data-action="identite"]');
  await bouton.click();
  const dlg = page.locator('dialog.mm-modale');
  await dlg.waitFor({ state: 'visible' });
  assert.match(await dlg.locator('h2').innerText(), /^Modifier la fiche.*MOTO-FICTIVE-901/);
  return dlg;
}
async function verifierGeometrie(page, bouton, largeur) {
  const boite = await bouton.boundingBox();
  assert.ok(boite && boite.width >= 44 && boite.height >= 44,
    'La cible de modification doit mesurer au moins 44 x 44 px.');
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(deborde, false, 'Débordement horizontal à ' + largeur.width + ' px.');
}

async function contexte(role, largeur, etat) {
  const ctx = await navigateur.newContext({
    viewport: { width: largeur.width, height: largeur.height }, serviceWorkers: 'block'
  });
  await ctx.exposeBinding('__motoTestLire', (_source, table, filtres) => {
    if (table === 'moto_v_flotte') {
      etat.lecturesFlotte++;
      return [structuredClone(etat.moto)].filter(m =>
        (filtres || []).every(([cle, valeur]) => m[cle] === valeur));
    }
    return [];
  });
  await ctx.exposeBinding('__motoTestRpc', (_source, nom, args) => {
    etat.appels.push({ nom, args: structuredClone(args) });
    if (nom !== 'moto_modifier_identite') {
      return { data: null, error: { message: 'RPC non prévue par ce test : ' + nom } };
    }
    assert.ok(['BM', 'ABM'].includes(role), 'Un rôle non habilité ne doit émettre aucun RPC de modification.');
    assert.equal(args.p_moto, MOTO_ID, 'La modification doit cibler la fiche affichée.');
    assert.equal(typeof args.p_motif, 'string');
    assert.ok(args.p_motif.trim().length >= 5, 'Motif obligatoire transmis séparément.');
    assert.ok(args.p && Object.hasOwn(args.p, 'row_version'), 'Version nécessaire au contrôle de concurrence.');
    assert.ok(Object.keys(args.p).every(cle => CHAMPS.has(cle)),
      'Aucun statut, compte utilisateur ou paramètre d’affectation ne doit être envoyé.');
    if (args.p.row_version !== etat.moto.row_version) {
      return { data: null, error: { message: 'CONFLIT : la fiche a été modifiée par un autre utilisateur. Rechargez-la.' } };
    }
    for (const [cle, valeur] of Object.entries(args.p)) {
      if (cle === 'row_version') continue;
      if ((cle === 'marque' || cle === 'modele') && !valeur) continue;
      etat.moto[cle] = valeur;
    }
    etat.moto.row_version++;
    return { data: { id: MOTO_ID, row_version: etat.moto.row_version }, error: null };
  });
  await ctx.addInitScript(installerDoublure, etat.profil);
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === BASE) {
      if (url.pathname === '/shared/auth-gate.js') {
        await route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* Session fictive installée par le test. */' });
      } else {
        await route.continue();
      }
      return;
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js')) {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* Client doublé, sans réseau. */' });
      return;
    }
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      return;
    }
    // Aucune exception pour Supabase, même si le code local était modifié.
    etat.sortiesInterdites.push(url.origin + url.pathname);
    await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Sortie réseau interdite dans ce test.' });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => etat.erreurs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') etat.erreurs.push(m.text()); });
  return { ctx, page };
}

async function testerEdition(page, etat, largeur) {
  const prefixe = 'BM ' + largeur.nom + ' ' + largeur.width + 'x' + largeur.height;
  await ouvrirParc(page);
  const boutonParc = page.locator('[data-modifier-moto="' + MOTO_ID + '"]');
  assert.equal(await boutonParc.count(), 1);
  assert.equal(await boutonParc.evaluate(el => !!el.closest('a')), false,
    'Un bouton de modification ne doit pas être imbriqué dans le lien de consultation.');
  await verifierGeometrie(page, boutonParc, largeur);
  noter(prefixe + ' : accès depuis le parc', await capture(page, largeur.nom + '-parc'));

  let dlg = await ouvrirEdition(page, true);
  assert.equal(await dlg.locator('[name="marque"]').getAttribute('required'), null);
  assert.equal(await dlg.locator('[name="modele"]').getAttribute('required'), null);
  assert.equal(await dlg.locator('[name="observations"]').inputValue(), etat.moto.observations);
  assert.equal(await dlg.locator('[name="fournisseur"]').count(), 1);
  const boite = await dlg.boundingBox();
  assert.ok(boite && boite.x >= -1 && boite.x + boite.width <= largeur.width + 1,
    'Le formulaire doit rester dans la largeur de l’écran.');
  assert.ok(boite && boite.y >= -1 && boite.y + boite.height <= largeur.height + 1,
    'Le dialogue doit rester dans la hauteur de l’écran, son corps pouvant défiler.');
  noter(prefixe + ' : formulaire incomplet utilisable', await capture(page, largeur.nom + '-formulaire'));

  const appelsAvantAnnulation = etat.appels.length;
  await dlg.locator('[name="observations"]').fill('Modification fictive à annuler.');
  await dlg.getByRole('button', { name: 'Annuler', exact: true }).click();
  await dlg.waitFor({ state: 'hidden' });
  assert.equal(etat.appels.length, appelsAvantAnnulation);
  assert.equal(etat.moto.observations, 'Observation initiale fictive.');
  noter(prefixe + ' : annulation sans RPC ni changement');

  dlg = await ouvrirEdition(page, true);
  await dlg.locator('[name="observations"]').fill('Observation fictive conservée après rechargement.');
  const enregistrer = dlg.getByRole('button', { name: 'Enregistrer les modifications', exact: true });
  await enregistrer.click();
  await dlg.locator('.mm-erreur:not([hidden])').waitFor();
  assert.equal(etat.appels.length, appelsAvantAnnulation, 'Le motif vide doit bloquer avant le RPC.');
  const motif = dlg.locator('[name="motif"]');
  assert.equal(await motif.getAttribute('minlength'), '5');
  await motif.fill('abcd');
  await enregistrer.click();
  assert.equal(await motif.evaluate(el => el.checkValidity()), false);
  assert.equal(etat.appels.length, appelsAvantAnnulation, 'Un motif trop court doit bloquer avant le RPC.');
  await motif.fill('Correction fictive de contrôle');
  await enregistrer.click();
  await dlg.waitFor({ state: 'hidden' });
  assert.equal(etat.appels.length, appelsAvantAnnulation + 1);
  assert.equal(etat.moto.marque, null);
  assert.equal(etat.moto.modele, null);
  assert.equal(etat.moto.observations, 'Observation fictive conservée après rechargement.');
  noter(prefixe + ' : motif obligatoire et modification sans marque ni modèle');
  await pret(page);
  await boutonParc.waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '#/motos');
  assert.equal(await page.locator('.mm-passeport').count(), 0);
  noter(prefixe + ' : sauvegarde depuis le parc conserve la liste et sa route');

  await ouvrirFiche(page);
  const lecturesAvant = etat.lecturesFlotte;
  await page.reload();
  await pret(page);
  await page.locator('#mmOnglet .mm-chargement').waitFor({ state: 'hidden' });
  assert.ok(etat.lecturesFlotte > lecturesAvant, 'Le rechargement doit relire les données de la doublure.');
  assert.equal(await page.locator('[data-action="identite"]').count(), 1,
    'Une seule action de modification sur le passeport.');
  dlg = await ouvrirEdition(page);
  assert.equal(await dlg.locator('[name="observations"]').inputValue(),
    'Observation fictive conservée après rechargement.');
  await dlg.getByRole('button', { name: 'Annuler', exact: true }).click();
  noter(prefixe + ' : persistance prouvée après rechargement');

  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.locator('.mm-onglets a[aria-current="page"][href$="/documents"]').waitFor();
  await page.locator('#mmOnglet .mm-chargement').waitFor({ state: 'hidden' });
  dlg = await ouvrirEdition(page);
  assert.equal(await dlg.locator('[name="observations"]').inputValue(), etat.moto.observations);
  await dlg.locator('[name="fournisseur"]').fill('FOURNISSEUR FICTIF');
  await dlg.locator('[name="motif"]').fill('Complément fictif du fournisseur');
  const appelsAvantDocuments = etat.appels.length;
  await dlg.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
  await dlg.waitFor({ state: 'hidden' });
  await pret(page);
  assert.equal(etat.appels.length, appelsAvantDocuments + 1);
  assert.equal(etat.moto.fournisseur, 'FOURNISSEUR FICTIF');
  assert.equal(new URL(page.url()).hash, '#/moto/' + MOTO_ID + '/documents');
  await page.locator('.mm-onglets a[aria-current="page"][href$="/documents"]').waitFor();
  dlg = await ouvrirEdition(page);
  assert.equal(await dlg.locator('[name="fournisseur"]').inputValue(), 'FOURNISSEUR FICTIF');
  await dlg.getByRole('button', { name: 'Annuler', exact: true }).click();
  noter(prefixe + ' : fournisseur enregistré et onglet Documents conservé après sauvegarde');

  dlg = await ouvrirEdition(page);
  const appelsAvantConflit = etat.appels.length;
  etat.moto.row_version++;
  etat.moto.observations = 'Mise à jour concurrente fictive.';
  await dlg.locator('[name="observations"]').fill('Saisie concurrente à ne pas appliquer.');
  await dlg.locator('[name="motif"]').fill('Contrôle fictif de concurrence');
  await dlg.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
  await dlg.locator('.mm-erreur:not([hidden])').waitFor();
  assert.match(await dlg.locator('.mm-erreur').innerText(), /CONFLIT/);
  assert.equal(etat.appels.length, appelsAvantConflit + 1);
  assert.equal(etat.moto.observations, 'Mise à jour concurrente fictive.');
  assert.equal(await dlg.locator('[name="observations"]').inputValue(), 'Saisie concurrente à ne pas appliquer.');
  await dlg.getByRole('button', { name: 'Annuler', exact: true }).click();
  noter(prefixe + ' : conflit de version affiché, saisie conservée, aucun écrasement');

  etat.moto.marque = 'MARQUE FICTIVE';
  etat.moto.modele = 'MODELE FICTIF';
  await ouvrirFiche(page);
  dlg = await ouvrirEdition(page);
  assert.notEqual(await dlg.locator('[name="marque"]').getAttribute('required'), null);
  assert.notEqual(await dlg.locator('[name="modele"]').getAttribute('required'), null);
  const nbAppels = etat.appels.length;
  await dlg.locator('[name="marque"]').fill('');
  await dlg.locator('[name="motif"]').fill('Tentative fictive d’effacement');
  await dlg.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
  assert.equal(etat.appels.length, nbAppels);
  await dlg.getByRole('button', { name: 'Annuler', exact: true }).click();
  noter(prefixe + ' : identité déjà connue protégée contre un effacement silencieux');

  etat.moto.marque = null;
  etat.moto.modele = null;
  etat.moto.origine = 'NEUVE';
  etat.moto.situation_parc = 'RECEPTIONNEE';
  await ouvrirFiche(page);
  dlg = await ouvrirEdition(page);
  assert.notEqual(await dlg.locator('[name="marque"]').getAttribute('required'), null);
  assert.notEqual(await dlg.locator('[name="modele"]').getAttribute('required'), null);
  await dlg.getByRole('button', { name: 'Annuler', exact: true }).click();
  noter(prefixe + ' : marque et modèle restent requis pour une neuve réceptionnée');
}

async function testerDroits(page, etat, role, largeur) {
  const prefixe = role + ' ' + largeur.nom + ' ' + largeur.width + 'x' + largeur.height;
  const habilite = role === 'ABM';
  await ouvrirParc(page);
  assert.equal(await page.locator('[data-modifier-moto]').count(), habilite ? 1 : 0);
  await ouvrirFiche(page);
  assert.equal(await page.locator('[data-action="identite"]').count(), habilite ? 1 : 0);
  if (habilite) {
    const dlg = await ouvrirEdition(page);
    await dlg.locator('[name="observations"]').fill('Observation fictive saisie par ABM.');
    await dlg.locator('[name="motif"]').fill('Complément fictif ABM');
    await dlg.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
    await dlg.waitFor({ state: 'hidden' });
    assert.equal(etat.appels.length, 1);
    assert.equal(etat.moto.observations, 'Observation fictive saisie par ABM.');
  } else {
    assert.equal(etat.appels.length, 0);
  }
  noter(prefixe + (habilite ? ' : modification autorisée et enregistrée' : ' : aucun accès de modification ni RPC'));
}

try {
  navigateur = await playwright.chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM || undefined,
    args: ['--no-sandbox']
  });
  for (const largeur of LARGEURS) {
    for (const role of Object.keys(ROLES)) {
      const etat = fixture(role);
      let ctx, page;
      try {
        ({ ctx, page } = await contexte(role, largeur, etat));
        if (role === 'BM') await testerEdition(page, etat, largeur);
        else await testerDroits(page, etat, role, largeur);
        assert.deepEqual(etat.sortiesInterdites, [], 'Aucune tentative vers une API ou un service externe inattendu.');
        assert.deepEqual(etat.erreurs, [], 'Aucune erreur JavaScript dans les pages testées.');
      } catch (erreur) {
        let preuve = null;
        try { if (page) preuve = await capture(page, 'echec-' + role + '-' + largeur.nom); } catch {}
        const cas = role + ' ' + largeur.nom;
        RESULTATS.push({ cas, resultat: 'ECHEC', erreur: erreur.message, preuve });
        console.error('ECHEC ' + cas + ' : ' + erreur.message);
      } finally {
        if (ctx) await ctx.close();
      }
    }
  }
} finally {
  if (navigateur) await navigateur.close();
  await new Promise(ok => serveur.close(ok));
  const rapport = {
    portee: 'Interface locale et contrat RPC avec doublure ; aucune validation de RLS ou base de production.',
    donnees: 'Toutes fictives ; captures et rapport hors dépôt.',
    largeurs: LARGEURS, resultats: RESULTATS
  };
  writeFileSync(join(SORTIE, 'resultats.json'), JSON.stringify(rapport, null, 2) + '\n');
}
const echecs = RESULTATS.filter(r => r.resultat === 'ECHEC').length;
console.log('Résultat : ' + RESULTATS.length + ' contrôles, ' + echecs + ' échec(s). Preuves : ' + SORTIE);
if (echecs) process.exitCode = 1;

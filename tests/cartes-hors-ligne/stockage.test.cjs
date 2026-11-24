/* Recette de stockage SIMULÉE sous Node.
   Charge les vrais cœur et gestionnaire FBMS dans des contextes vm indépendants.
   fake-indexeddb remplace le disque ; fetch lit seulement le catalogue, le manifeste
   et les sept vrais PNG du dépôt. Aucun accès réseau ni compte de production.
   createImageBitmap est une DOUBLURE qui lit les dimensions de l'en-tête PNG :
   ces tests ne prouvent ni le décodage navigateur, ni Android, ni l'OTA.

   Dépendance de TEST hors dépôt : fake-indexeddb@6.2.4.
   FBMS_TEST_MODULES=/chemin/vers/node_modules node --test tests/cartes-hors-ligne/stockage.test.cjs
*/
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');

if (!process.env.FBMS_TEST_MODULES) {
  throw new Error('Indiquez FBMS_TEST_MODULES : dossier de test externe contenant fake-indexeddb@6.2.4. Aucune dépendance de production n’est installée par cette recette.');
}
const { IDBFactory, IDBKeyRange } = require(path.join(process.env.FBMS_TEST_MODULES, 'fake-indexeddb'));
const RACINE = path.resolve(__dirname, '../..');
const DOSSIER_CARTES = path.join(RACINE, 'cartes-hors-ligne');
const BASE = 'https://nwodobe.github.io/fbms/cartes-hors-ligne/';
const BASE_CARTES = 'fbms_cartes_satellite_v1';
const coeur = fs.readFileSync(path.join(RACINE, 'shared/cartes-hors-ligne-coeur.js'), 'utf8');
const gestionnaire = fs.readFileSync(path.join(RACINE, 'shared/cartes-hors-ligne.js'), 'utf8');
const catalogueOriginal = JSON.parse(fs.readFileSync(path.join(DOSSIER_CARTES, 'catalogue.json'), 'utf8'));
const zone = catalogueOriginal.zones.find(z => z.id === 'bouake-pilote-sentinel2');
assert.ok(zone, 'Le paquet satellite pilote du dépôt est présent.');
const manifesteOriginal = JSON.parse(fs.readFileSync(path.join(DOSSIER_CARTES, zone.manifest), 'utf8'));
const CENTRE = [(zone.bounds[1] + zone.bounds[3]) / 2, (zone.bounds[0] + zone.bounds[2]) / 2];
const hacher = b => createHash('sha256').update(b).digest('hex');
const copier = x => JSON.parse(JSON.stringify(x));

function signalDiffere() {
  let resoudre, rejeter;
  const promesse = new Promise((ok, ko) => { resoudre = ok; rejeter = ko; });
  return { promesse, resoudre, rejeter };
}

function transportLocal() {
  const contenus = new Map(), appels = [];
  const transport = { contenus, appels, horsLigne: false, porte: null };
  transport.fetch = async (url, options = {}) => {
    assert.ok(String(url).startsWith(BASE), 'Le test interdit toute adresse extérieure au catalogue FBMS simulé.');
    const u = new URL(url);
    assert.equal(u.search, ''); assert.equal(u.hash, '');
    const relatif = u.href.slice(BASE.length);
    const fichier = path.resolve(DOSSIER_CARTES, relatif);
    assert.ok(fichier.startsWith(DOSSIER_CARTES + path.sep), 'Aucun chemin extérieur au paquet.');
    const appel = { relatif, signal: options.signal, client: options.clientRecette };
    appels.push(appel);
    if (transport.horsLigne) throw new TypeError('Réseau coupé par le banc de test.');
    if (options.signal?.aborted) throw new DOMException('Transport interrompu', 'AbortError');
    if (transport.porte && relatif.endsWith('.png')) await transport.porte(attenteSignal(options.signal), appel);
    if (options.signal?.aborted) throw new DOMException('Transport interrompu', 'AbortError');
    const octets = contenus.has(relatif) ? contenus.get(relatif) : fs.readFileSync(fichier);
    return new Response(octets, { status: 200, headers: { 'content-length': String(octets.length) } });
  };
  transport.imagesDepuis = position => appels.slice(position).filter(a => a.relatif.endsWith('.png')).map(a => a.relatif);
  return transport;
}

/* Une porte de transport est libérée ou annulée : pas de promesse oubliée après
   un arrêt demandé au gestionnaire. Les vrais délais réseau ne sont pas simulés. */
function attenteSignal(signal) {
  return async promesse => {
    if (signal?.aborted) throw new DOMException('Transport interrompu', 'AbortError');
    let annuler;
    const interruption = new Promise((ok, ko) => {
      annuler = () => ko(new DOMException('Transport interrompu', 'AbortError'));
      signal?.addEventListener('abort', annuler, { once: true });
    });
    try { return await Promise.race([promesse, interruption]); }
    finally { signal?.removeEventListener('abort', annuler); }
  };
}

function contexte(t, options = {}) {
  const fabrique = options.fabrique || new IDBFactory();
  const transport = options.transport || transportLocal();
  const client = Symbol('contexte VM de recette');
  const minuteries = new Set(), intervalles = new Set();
  const boite = {
    indexedDB: fabrique, IDBKeyRange, crypto: options.crypto || webcrypto, Blob, Response, URL,
    TextDecoder, TextEncoder, AbortController, DOMException, Uint8Array, ArrayBuffer,
    navigator: { onLine: true, storage: {
      estimate: async () => options.estimation || { quota: 1024 ** 3, usage: 1024 ** 2 },
      persist: async () => true
    } },
    fetch: (url, options) => transport.fetch(url, { ...options, clientRecette: client }),
    setTimeout(fn, ms) { const id = setTimeout(() => { minuteries.delete(id); fn(); }, ms); minuteries.add(id); return id; },
    clearTimeout(id) { clearTimeout(id); minuteries.delete(id); },
    setInterval(fn, ms) { const id = setInterval(fn, ms); intervalles.add(id); return id; },
    clearInterval(id) { clearInterval(id); intervalles.delete(id); },
    /* Dimensions seulement : cette doublure n'exécute PAS le décodeur du navigateur. */
    async createImageBitmap(blob) {
      const b = Buffer.from(await blob.arrayBuffer());
      assert.ok(b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Le fixture est un PNG réel.');
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), close() {} };
    }
  };
  if (options.authentifie !== false) boite.ANAGROCI_AUTH = { profile: { user_id: 'compte-fictif-recette-cartes' } };
  boite.window = boite;
  vm.createContext(boite);
  vm.runInContext(coeur, boite, { filename: 'shared/cartes-hors-ligne-coeur.js' });
  vm.runInContext(gestionnaire, boite, { filename: 'shared/cartes-hors-ligne.js' });
  t.after(() => { minuteries.forEach(clearTimeout); intervalles.forEach(clearInterval); });
  return { api: boite.ANAGROCI_CARTES_HORS_LIGNE, fabrique, transport, boite, client };
}

async function ouvrirBase(fabrique, nom, magasins = []) {
  return new Promise((ok, ko) => {
    const r = fabrique.open(nom, 1);
    r.onupgradeneeded = () => magasins.forEach(m => r.result.createObjectStore(m, { keyPath: 'id' }));
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}

async function transaction(fabrique, nom, magasin, mode, operation) {
  const d = await ouvrirBase(fabrique, nom);
  try {
    return await new Promise((ok, ko) => {
      const tr = d.transaction(magasin, mode), s = tr.objectStore(magasin);
      let resultat;
      const r = operation(s); if (r) r.onsuccess = () => { resultat = r.result; };
      tr.oncomplete = () => ok(resultat); tr.onabort = tr.onerror = () => ko(tr.error);
    });
  } finally { d.close(); }
}
const toutes = (h, magasin) => transaction(h.fabrique, BASE_CARTES, magasin, 'readonly', s => s.getAll());

async function donneesMetier(fabrique) {
  const jeux = [
    { nom: 'aflp_reperes_gps_db', magasin: 'file', lignes: [{ id: 'repere-fictif-en-attente', etat: 'ATTENTE', idempotency_key: 'operation-fictive-unique', payload: { objet_id: 'parcelle-fictive' } }] },
    { nom: 'aflp_plot_map_db', magasin: 'brouillons', lignes: [{ id: 'brouillon-fictif', note: 'Donnée métier fictive à conserver', version: 3 }] },
    { nom: 'anagroci_observatoire', magasin: 'fichiers', lignes: [{ id: 'photo-fictive-non-envoyee', statut: 'ATTENTE', blob: new Blob(['PHOTO FICTIVE NON ENVOYÉE'], { type: 'application/octet-stream' }) }] }
  ];
  for (const jeu of jeux) {
    const d = await ouvrirBase(fabrique, jeu.nom, [jeu.magasin]); d.close();
    await transaction(fabrique, jeu.nom, jeu.magasin, 'readwrite', s => { jeu.lignes.forEach(x => s.put(x)); });
  }
  return async () => {
    const sortie = [];
    for (const jeu of jeux) {
      const lignes = await transaction(fabrique, jeu.nom, jeu.magasin, 'readonly', s => s.getAll());
      for (const ligne of lignes) if (ligne.blob) {
        ligne.empreintePhoto = hacher(Buffer.from(await ligne.blob.arrayBuffer()));
        ligne.taillePhoto = ligne.blob.size; delete ligne.blob;
      }
      sortie.push({ nom: jeu.nom, magasin: jeu.magasin, lignes });
    }
    return sortie;
  };
}

function cheminImage(manifeste, tuile) { return path.posix.join(path.posix.dirname(zone.manifest), tuile.path); }

test('simulation : paquet complet, sept PNG et leurs empreintes, réouverture sans réseau', async t => {
  const h = contexte(t);
  assert.equal(manifesteOriginal.tileCount, 7, 'Le fixture réel contient sept images.');
  const resultat = await h.api.telecharger(zone.id);
  assert.equal(resultat.etat, 'DISPONIBLE'); assert.equal(resultat.nombre, 7);
  assert.equal(resultat.octets, manifesteOriginal.totalBytes);
  const liste = await h.api.liste();
  assert.equal(liste.length, 1); assert.equal(liste[0].actif, true);
  const images = await toutes(h, 'tuiles'); assert.equal(images.length, 7);
  const empreintes = new Set();
  for (const image of images) empreintes.add(hacher(Buffer.from(await image.blob.arrayBuffer())));
  for (const tuile of manifesteOriginal.tiles) assert.ok(empreintes.has(tuile.sha256), 'Chaque image attendue est effectivement stockée.');
  assert.equal(h.transport.imagesDepuis(0).length, 7, 'Le transfert charge toute la grille, sans navigation préalable.');
  const avant = h.transport.appels.length;
  h.transport.horsLigne = true;
  const reprise = contexte(t, { fabrique: h.fabrique, transport: h.transport });
  assert.equal(await reprise.api.disponible(CENTRE), true);
  assert.equal((await reprise.api.verifier(liste[0].cle)).ok, true);
  assert.equal(h.transport.appels.length, avant, 'La réouverture vérifie les images locales sans réseau.');
});

test('simulation : interruption, nouvelle instance et reprise sans retélécharger les images bonnes', async t => {
  const h = contexte(t);
  await assert.rejects(h.api.telecharger(zone.id, p => { if (p.nombre >= 2) h.api.interrompre(zone.id); }), e => e.name === 'AbortError');
  const partiels = await h.api.liste(), images = await toutes(h, 'tuiles');
  assert.equal(partiels.length, 1); assert.equal(partiels[0].etat, 'INTERROMPU'); assert.equal(partiels[0].actif, false);
  assert.ok(images.length > 0 && images.length < 7, 'L’arrêt a lieu après écriture d’une partie des images.');
  const bonnes = new Set();
  for (const im of images) bonnes.add(hacher(Buffer.from(await im.blob.arrayBuffer())));
  const position = h.transport.appels.length;
  const nouveau = contexte(t, { fabrique: h.fabrique, transport: h.transport });
  await nouveau.api.telecharger(zone.id);
  const relues = h.transport.imagesDepuis(position);
  for (const tuile of manifesteOriginal.tiles) if (bonnes.has(tuile.sha256)) {
    assert.ok(!relues.includes(cheminImage(manifesteOriginal, tuile)), 'Une image valide déjà écrite n’est pas téléchargée de nouveau.');
  }
  assert.equal((await nouveau.api.liste())[0].etat, 'DISPONIBLE');
  assert.equal((await toutes(nouveau, 'tuiles')).length, 7);
});

test('simulation : corruption locale de même taille, état À réparer et réparation ciblée', async t => {
  const h = contexte(t), p = await h.api.telecharger(zone.id);
  const images = await toutes(h, 'tuiles'), choisie = images[0];
  const octets = Buffer.from(await choisie.blob.arrayBuffer());
  const avant = hacher(octets); octets[octets.length - 1] ^= 1;
  choisie.blob = new Blob([octets], { type: 'image/png' });
  await transaction(h.fabrique, BASE_CARTES, 'tuiles', 'readwrite', s => s.put(choisie));
  assert.equal((await h.api.verifier(p.cle)).ok, false);
  assert.equal((await h.api.liste())[0].etat, 'A_REPARER');
  assert.equal(await h.api.disponible(CENTRE), false, 'Une carte corrompue ne reste pas annoncée disponible.');
  const position = h.transport.appels.length;
  await h.api.telecharger(zone.id);
  const tuile = manifesteOriginal.tiles.find(x => x.sha256 === avant);
  assert.deepEqual(h.transport.imagesDepuis(position), [cheminImage(manifesteOriginal, tuile)]);
  assert.equal((await h.api.verifier(p.cle)).ok, true);
  assert.equal((await h.api.liste())[0].etat, 'DISPONIBLE');
});

test('simulation : deux gestionnaires partagent le verrou, aucune suppression pendant le transfert', async t => {
  const transport = transportLocal(), entree = signalDiffere(), sortie = signalDiffere();
  transport.porte = async attendre => { entree.resoudre(); await attendre(sortie.promesse); };
  const a = contexte(t, { transport }), b = contexte(t, { transport, fabrique: a.fabrique });
  const transfert = a.api.telecharger(zone.id);
  await entree.promesse;
  try {
    await assert.rejects(b.api.telecharger(zone.id), /déjà en cours|autre fenêtre/);
    await assert.rejects(b.api.supprimer(zone.id), /déjà en cours|autre fenêtre/);
    assert.equal(transport.appels.filter(a => a.client === b.client).length, 0, 'La seconde fenêtre ne commence pas un transfert concurrent.');
  } finally { sortie.resoudre(); await transfert; }
  const liste = await b.api.liste();
  assert.equal(liste.length, 1); assert.equal(liste[0].actif, true); assert.equal(liste[0].etat, 'DISPONIBLE');
  assert.equal((await toutes(b, 'tuiles')).length, 7);
});

test('simulation : une mise à jour interrompue garde la dernière version complète active', async t => {
  const h = contexte(t), ancien = await h.api.telecharger(zone.id);
  /* Nouvelle version du PAQUET DE TEST, avec les mêmes images et la même date réelle.
     Aucun nouveau millésime d’imagerie n’est inventé. */
  const nouveauManifeste = copier(manifesteOriginal); nouveauManifeste.version = 'recette-v2';
  const octetsManifeste = Buffer.from(JSON.stringify(nouveauManifeste));
  const nouveauCatalogue = copier(catalogueOriginal), nouvelleZone = nouveauCatalogue.zones.find(z => z.id === zone.id);
  nouvelleZone.version = nouveauManifeste.version; nouvelleZone.manifestSha256 = hacher(octetsManifeste);
  h.transport.contenus.set(zone.manifest, octetsManifeste);
  h.transport.contenus.set('catalogue.json', Buffer.from(JSON.stringify(nouveauCatalogue)));
  await h.api.catalogue(true);
  await assert.rejects(h.api.telecharger(zone.id, p => { if (p.nombre >= 2) h.api.interrompre(zone.id); }), e => e.name === 'AbortError');
  const liste = await h.api.liste();
  assert.equal(liste.length, 2);
  const actifs = liste.filter(p => p.actif);
  assert.equal(actifs.length, 1); assert.equal(actifs[0].cle, ancien.cle); assert.equal(actifs[0].etat, 'DISPONIBLE');
  assert.equal(liste.find(p => p.cle !== ancien.cle).etat, 'INTERROMPU');
  h.transport.horsLigne = true;
  const redemarrage = contexte(t, { fabrique: h.fabrique, transport: h.transport });
  assert.equal(await redemarrage.api.disponible(CENTRE), true, 'La version complète demeure utilisable après réouverture hors réseau.');
  assert.equal((await redemarrage.api.verifier(ancien.cle)).ok, true);
  h.transport.horsLigne = false;
  const nouveau = await redemarrage.api.telecharger(zone.id);
  assert.notEqual(nouveau.cle, ancien.cle);
  const fin = await redemarrage.api.liste();
  assert.deepEqual(fin.filter(p => p.actif).map(p => p.cle), [nouveau.cle]);
  assert.equal((await redemarrage.api.verifier(ancien.cle)).ok, true, 'La bascule n’efface pas prématurément l’ancienne version.');
});

test('simulation : réserve de stockage insuffisante, refus avant les PNG et données métier intactes', async t => {
  const h = contexte(t, { estimation: { quota: 128 * 1024 ** 2, usage: 120 * 1024 ** 2 } });
  const photographier = await donneesMetier(h.fabrique), avant = await photographier();
  await assert.rejects(h.api.telecharger(zone.id), /Espace insuffisant/);
  assert.equal(h.transport.imagesDepuis(0).length, 0, 'Le refus intervient avant le transfert des images.');
  assert.equal((await h.api.liste()).length, 0);
  assert.deepEqual(await photographier(), avant, 'Files, brouillon et photo non transmise sont conservés.');
});

test('simulation : suppression d’une carte sans suppression des données métier', async t => {
  const h = contexte(t), photographier = await donneesMetier(h.fabrique), avant = await photographier();
  await h.api.telecharger(zone.id); await h.api.supprimer(zone.id);
  assert.equal((await h.api.liste()).length, 0);
  assert.equal((await toutes(h, 'tuiles')).length, 0);
  assert.equal((await toutes(h, 'actifs')).length, 0);
  assert.equal(await h.api.disponible(CENTRE), false);
  assert.deepEqual(await photographier(), avant);
});

test('simulation : sans compte, téléchargement et suppression refusés sans altérer une carte existante', async t => {
  const h = contexte(t, { authentifie: false });
  await assert.rejects(h.api.telecharger(zone.id), /Connectez-vous/);
  assert.equal(h.transport.appels.length, 0, 'Aucune requête n’est commencée sans compte.');
  const autorise = contexte(t, { fabrique: h.fabrique, transport: h.transport });
  const p = await autorise.api.telecharger(zone.id);
  await assert.rejects(h.api.supprimer(zone.id), /Connectez-vous/);
  const actifs = (await autorise.api.liste()).filter(p => p.actif);
  assert.equal(actifs.length, 1); assert.equal(actifs[0].cle, p.cle);
  assert.equal((await autorise.api.verifier(p.cle)).ok, true);
});

test('simulation : PNG altéré pendant le transport, aucun paquet incomplet activé', async t => {
  const h = contexte(t), tuile = manifesteOriginal.tiles[0], relatif = cheminImage(manifesteOriginal, tuile);
  const octets = Buffer.from(fs.readFileSync(path.join(DOSSIER_CARTES, relatif)));
  octets[octets.length - 1] ^= 1; h.transport.contenus.set(relatif, octets);
  await assert.rejects(h.api.telecharger(zone.id), /corrompue|intégrité/);
  const liste = await h.api.liste();
  assert.ok(liste.length > 0); assert.ok(liste.every(p => !p.actif && p.etat !== 'DISPONIBLE'));
  assert.equal((await toutes(h, 'actifs')).length, 0);
  assert.equal(await h.api.disponible(CENTRE), false);
});

test('simulation : après une seconde interruption, les tuiles précédemment reçues hors ordre restent comptées', { timeout: 10000 }, async t => {
  const transport = transportLocal(), bloquerPremiere = signalDiffere();
  const premiere = manifesteOriginal.tiles[0];
  const cheminPremiere = cheminImage(manifesteOriginal, premiere);
  /* Le premier transfert reçoit les six images suivantes pendant que la première
     attend. C'est un ordre réel de réponses possible avec deux téléchargements. */
  transport.porte = async (attendre, appel) => {
    if (appel.relatif === cheminPremiere) await attendre(bloquerPremiere.promesse);
  };
  const initial = contexte(t, { transport });
  await assert.rejects(initial.api.telecharger(zone.id, p => {
    if (p.nombre >= manifesteOriginal.tileCount - 1) initial.api.interrompre(zone.id);
  }), e => e.name === 'AbortError');
  const imagesInitiales = await toutes(initial, 'tuiles');
  assert.equal(imagesInitiales.length, 6);
  const derniere = manifesteOriginal.tiles.at(-1);
  assert.ok(imagesInitiales.some(im => im.cle.endsWith('/' + derniere.z + '/' + derniere.x + '/' + derniere.y)), 'Une tuile tardive de la liste est déjà persistée.');
  transport.porte = null;

  /* À la reprise, la première image manquante peut être écrite avant qu'une
     image déjà stockée ait terminé sa vérification. On coupe à cet instant.
     Le calcul SHA-256 demeure réel ; seule sa résolution est retardée. */
  const seconde = manifesteOriginal.tiles[1], porteVerification = signalDiffere();
  const octetsSeconde = fs.readFileSync(path.join(DOSSIER_CARTES, cheminImage(manifesteOriginal, seconde)));
  const cryptoRetarde = { randomUUID: () => webcrypto.randomUUID(), subtle: {
    async digest(algorithme, octets) {
      if (Buffer.from(octets).equals(octetsSeconde)) await porteVerification.promesse;
      return webcrypto.subtle.digest(algorithme, octets);
    }
  } };
  const reprise = contexte(t, { transport, fabrique: initial.fabrique, crypto: cryptoRetarde });
  await assert.rejects(reprise.api.telecharger(zone.id, p => {
    if (p.nombre >= 1) { reprise.api.interrompre(zone.id); porteVerification.resoudre(); }
  }), e => e.name === 'AbortError');
  const images = await toutes(reprise, 'tuiles'), paquet = (await reprise.api.liste())[0];
  assert.equal(images.length, 7, 'La tuile manquante a bien été écrite avant la seconde coupure.');
  assert.equal(paquet.etat, 'INTERROMPU'); assert.equal(paquet.actif, false);
  assert.equal(paquet.octets, images.reduce((s, im) => s + im.blob.size, 0), 'Le volume inclut les tuiles reçues lors des deux tentatives.');
  assert.equal(paquet.nombre, images.length, 'Le compteur ne revient pas au nombre parcouru depuis la reprise.');
});

test('simulation : une vérification tardive ne recrée pas une carte supprimée entre-temps', { timeout: 10000 }, async t => {
  const entree = signalDiffere(), sortie = signalDiffere();
  let aRetarder = null;
  const cryptoRetarde = { randomUUID: () => webcrypto.randomUUID(), subtle: {
    async digest(algorithme, octets) {
      if (aRetarder && Buffer.from(octets).equals(aRetarder)) { entree.resoudre(); await sortie.promesse; }
      return webcrypto.subtle.digest(algorithme, octets);
    }
  } };
  const h = contexte(t, { crypto: cryptoRetarde }), paquet = await h.api.telecharger(zone.id);
  const images = await toutes(h, 'tuiles');
  const premiere = manifesteOriginal.tiles[0];
  const image = images.find(im => im.cle.endsWith('/' + premiere.z + '/' + premiere.x + '/' + premiere.y));
  const octets = Buffer.from(await image.blob.arrayBuffer()); octets[octets.length - 1] ^= 1;
  image.blob = new Blob([octets], { type: 'image/png' });
  await transaction(h.fabrique, BASE_CARTES, 'tuiles', 'readwrite', s => s.put(image));
  aRetarder = octets;
  const lecture = h.api.verifier(paquet.cle);
  await entree.promesse;
  let resultat;
  try {
    await h.api.supprimer(zone.id);
    assert.equal((await h.api.liste()).length, 0, 'La suppression est terminée avant la réponse de vérification.');
  } finally { sortie.resoudre(); resultat = await lecture; }
  assert.equal(resultat.ok, false, 'La lecture en cours détecte bien la corruption.');
  assert.equal((await h.api.liste()).length, 0, 'Son résultat tardif ne recrée aucun paquet À réparer.');
  assert.equal((await toutes(h, 'tuiles')).length, 0);
  assert.equal((await toutes(h, 'actifs')).length, 0);
});

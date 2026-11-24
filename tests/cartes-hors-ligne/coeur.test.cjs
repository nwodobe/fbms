/* Contrats de sécurité et de couverture des cartes téléchargées.
   Point de départ : le vrai pilote public publié dans le catalogue du dépôt.
   Aucun réseau, aucune donnée de parcelle ni dépendance de test externe. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const C = require('../../shared/cartes-hors-ligne-coeur.js');

const MIO = 1024 * 1024;
const RACINE = path.resolve(__dirname, '../../cartes-hors-ligne');
const catalogue = JSON.parse(readFileSync(path.join(RACINE, 'catalogue.json'), 'utf8'));
const zone = catalogue.zones.find((z) => z.id === 'bouake-pilote-sentinel2');
assert.ok(zone, 'Le pilote satellite public doit être présent pour vérifier le contrat réel.');
const cheminManifeste = path.resolve(RACINE, zone.manifest);
assert.ok(cheminManifeste.startsWith(RACINE + path.sep), 'Le manifeste pilote doit rester dans les packs.');
const octetsManifeste = readFileSync(cheminManifeste);
const manifeste = JSON.parse(octetsManifeste.toString('utf8'));
const copie = (objet) => JSON.parse(JSON.stringify(objet));
const empreinte = (octets) => createHash('sha256').update(octets).digest('hex');

function modifierManifeste(changer) {
  const m = copie(manifeste);
  changer(m);
  return m;
}
function modifierCatalogue(changer) {
  const c = { schemaVersion: 1, zones: [copie(zone)] };
  changer(c.zones[0], c);
  return c;
}
function recompter(m) {
  m.tileCount = m.tiles.length;
  m.totalBytes = m.tiles.reduce((total, t) => total + t.bytes, 0);
}
function refuserManifeste(changer, motif, contexte) {
  assert.throws(() => C.validerManifeste(modifierManifeste(changer)), motif, contexte);
}
function refuserCatalogue(changer, motif, contexte) {
  assert.throws(() => C.validerCatalogue(modifierCatalogue(changer)), motif, contexte);
}

test('le catalogue et le vrai pilote décrivent les mêmes images, octets et empreintes', () => {
  assert.doesNotThrow(() => C.validerCatalogue(catalogue));
  assert.doesNotThrow(() => C.validerManifeste(manifeste, zone));
  assert.equal(empreinte(octetsManifeste), zone.manifestSha256, 'Manifeste copié ou catalogue obsolète.');
  let total = 0;
  for (const tuile of manifeste.tiles) {
    const octets = readFileSync(path.join(path.dirname(cheminManifeste), tuile.path));
    assert.equal(octets.length, tuile.bytes, tuile.path + ' : taille');
    assert.equal(empreinte(octets), tuile.sha256, tuile.path + ' : intégrité');
    total += octets.length;
  }
  assert.equal(total, manifeste.totalBytes);
  assert.equal(manifeste.tileCount, 7, 'Le pilote Bouaké préparé et contrôlé contient sept images.');
});

test('la grille couvre le pilote à chacun des trois zooms annoncés', () => {
  const bornes = [-5.06, 7.67, -5.04, 7.69];
  assert.deepEqual(manifeste.bounds, bornes);
  assert.deepEqual(C.plage(bornes, 12), { x0: 1990, x1: 1990, y0: 1960, y1: 1960 });
  assert.deepEqual(C.plage(bornes, 13), { x0: 3980, x1: 3981, y0: 3920, y1: 3920 });
  assert.deepEqual(C.plage(bornes, 14), { x0: 7961, x1: 7962, y0: 7840, y1: 7841 });
  assert.equal(C.contient(bornes, [7.68, -5.05]), true);
  assert.equal(C.contient(bornes, [-5.05, 7.68]), false, 'Les points Leaflet sont latitude, longitude.');
  assert.equal(C.contient(bornes, [7.68, -5.20]), false);
});

test('une tuile absente est refusée même si les compteurs ont été recalculés', () => {
  refuserManifeste((m) => { m.tiles.splice(3, 1); recompter(m); }, /incomplet/i);
});

test('un zoom entier absent ne peut pas être présenté comme téléchargé', () => {
  refuserManifeste((m) => { m.tiles = m.tiles.filter((t) => t.z !== 13); recompter(m); }, /incomplet/i);
});

test('une tuile dupliquée ne remplace pas une tuile manquante', () => {
  refuserManifeste((m) => { m.tiles[1] = copie(m.tiles[0]); recompter(m); }, /double|hors de la zone/i);
});

test('une tuile hors emprise ou hors zoom est refusée même avec un chemin cohérent', () => {
  for (const changement of [(t) => { t.x += 100; }, (t) => { t.z = 11; }]) {
    refuserManifeste((m) => {
      changement(m.tiles[0]);
      const t = m.tiles[0]; t.path = `tiles/${t.z}/${t.x}/${t.y}.${m.format}`;
    }, /hors de la zone/i);
  }
});

test('les emprises inversées, traversant l’antiméridien ou hors projection sont refusées', () => {
  for (const bornes of [
    [179.5, 0, -179.5, 1], [-181, 0, -180, 1], [179.5, 0, 180.5, 1],
    [-5.06, 85.0, -5.04, 85.1], [-5.06, -85.1, -5.04, -85.0],
    [-5.04, 7.67, -5.06, 7.69], [-5.06, 7.69, -5.04, 7.67],
    [-5.06, 7.67, -5.06, 7.69], [-5.06, 7.67, -5.04, 7.67],
    [-5.06, 7.67, -2.0, 7.69], [-5.06, 7.67, -5.04, NaN],
  ]) {
    refuserManifeste((m) => { m.bounds = bornes; }, /emprise|zone trop grande/i, String(bornes));
  }
});

test('une grille démesurée est rejetée avant de créer des milliers d’entrées', () => {
  refuserManifeste((m) => { m.bounds = [-5.5, 7, -4, 8.5]; m.minZoom = 16; m.maxZoom = 16; }, /trop de tuiles/i);
});

test('le contrat refuse une autre projection de tuiles ou des dimensions incompatibles', () => {
  for (const [champ, valeur] of [['scheme', 'tms'], ['tileSize', 512], ['format', 'svg'], ['minZoom', 0], ['maxZoom', 17]]) {
    refuserManifeste((m) => { m[champ] = valeur; }, /incompatibles|niveaux/i, champ);
  }
});

test('un identifiant de manifeste absent ou d’un autre type n’est jamais converti en texte', () => {
  for (const valeur of [undefined, null, 123, true, ['zone-valide'], {}]) {
    refuserManifeste((m) => { m.id = valeur; }, /identité/i, `id=${String(valeur)}`);
  }
});

test('une version de manifeste absente ou d’un autre type est refusée', () => {
  for (const valeur of [undefined, null, 20260220, true, ['v1'], {}]) {
    refuserManifeste((m) => { m.version = valeur; }, /identité/i, `version=${String(valeur)}`);
  }
});

test('les identifiants et versions du catalogue doivent eux aussi être des chaînes', () => {
  for (const valeur of [undefined, null, 123, true, ['zone-valide']]) {
    refuserCatalogue((z) => { z.id = valeur; z.manifest = String(valeur) + '/manifest.json'; }, /zone.*invalide/i, 'id catalogue');
    refuserCatalogue((z) => { z.version = valeur; }, /zone.*invalide/i, 'version catalogue');
  }
});

test('les identifiants et versions ne permettent pas une injection HTML ou un chemin', () => {
  for (const valeur of ['../zone', 'zone/voisine', '<img>', 'zone" onclick="x', 'zone?x=1']) {
    refuserManifeste((m) => { m.id = valeur; }, /identité/i);
    refuserManifeste((m) => { m.version = valeur; }, /identité/i);
  }
});

test('les chemins de manifeste ne peuvent pas sortir du répertoire de la zone', () => {
  for (const suffixe of ['../manifest.json', '%2e%2e/manifest.json', './manifest.json', '/manifest.json', '..\\manifest.json', 'manifest.json?x=1', 'manifest.json#x']) {
    refuserCatalogue((z) => { z.manifest = z.id + '/' + suffixe; }, /chemin/i, suffixe);
  }
  for (const chemin of ['https://autre.invalid/manifest.json', '//autre.invalid/manifest.json', '/manifest.json', 'autre-zone/manifest.json']) {
    refuserCatalogue((z) => { z.manifest = chemin; }, /chemin/i, chemin);
  }
});

test('une tuile ne peut référencer ni une URL externe ni un chemin détourné', () => {
  for (const chemin of ['https://autre.invalid/image.png', '../image.png', '/image.png', 'tiles/12/1990/../../image.png', 'tiles/12/1990/1960.png?x=1', 'tiles\\12\\1990\\1960.png']) {
    refuserManifeste((m) => { m.tiles[0].path = chemin; }, /chemin/i, chemin);
  }
});

test('la source et la licence exigent des URL HTTPS sans identifiants incorporés', () => {
  for (const champ of ['url', 'licenceUrl']) {
    for (const valeur of ['http://source.invalid/', 'javascript:alert(1)', 'data:text/plain,source', 'https://user:password@source.invalid/']) {
      refuserManifeste((m) => { m.source[champ] = valeur; }, /source|licence|attribution/i, champ);
    }
  }
});

test('un catalogue ne peut annoncer un autre contenu que le manifeste téléchargé', () => {
  const changements = [
    (z) => { z.id = 'autre-zone'; }, (z) => { z.version = 'autre-version'; },
    (z) => { z.totalBytes += 1; }, (z) => { z.bounds[0] -= 0.001; },
    (z) => { z.minZoom -= 1; }, (z) => { z.maxZoom += 1; },
    (z) => { z.resolutionMetres = 1; }, (z) => { z.acquiredAt = '2025-01-01'; },
  ];
  for (const changer of changements) {
    const annonce = copie(zone); changer(annonce);
    assert.throws(() => C.validerManifeste(copie(manifeste), annonce), /diffère/i);
  }
});

test('une empreinte absente, mal formée ou convertie depuis un tableau est refusée', () => {
  for (const valeur of [undefined, null, 'a'.repeat(63), 'g'.repeat(64), ['a'.repeat(64)]]) {
    refuserManifeste((m) => { m.tiles[0].sha256 = valeur; }, /empreinte/i, 'tuile');
    refuserCatalogue((z) => { z.manifestSha256 = valeur; }, /intégrité/i, 'catalogue');
  }
});

test('les tailles de tuiles doivent être des entiers positifs bornés', () => {
  for (const valeur of [0, -1, 1.5, '100', NaN, MIO + 1]) {
    refuserManifeste((m) => { m.tiles[0].bytes = valeur; }, /taille|empreinte/i, String(valeur));
  }
});

test('le volume et le nombre annoncés doivent correspondre à la liste réelle', () => {
  refuserManifeste((m) => { m.totalBytes += 1; }, /volume/i);
  refuserManifeste((m) => { m.tileCount -= 1; }, /liste/i);
});

test('un paquet complet dépassant 20 Mio est refusé même si chaque tuile respecte sa limite', () => {
  refuserManifeste((m) => {
    m.maxZoom = 16;
    // Grilles XYZ de la même emprise de Bouaké, calculées indépendamment du validateur.
    for (const [z, x0, x1, y0, y1] of [[15, 15923, 15925, 15681, 15683], [16, 31846, 31850, 31363, 31367]]) {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        m.tiles.push({ z, x, y, path: `tiles/${z}/${x}/${y}.png`, bytes: MIO / 2, sha256: 'a'.repeat(64) });
      }
    }
    for (const t of m.tiles) t.bytes = MIO / 2;
    recompter(m);
    assert.equal(m.tiles.length, 41);
    assert.equal(m.totalBytes, 20.5 * MIO);
  }, /volume.*20 Mio/i);
});

test('un fond dont la qualité ou les droits ne sont pas confirmés ne peut devenir prêt', () => {
  refuserManifeste((m) => { m.quality.reviewStatus = 'pending'; }, /qualité/i);
  refuserManifeste((m) => { m.source.allowOffline = false; }, /droits/i);
  refuserManifeste((m) => { m.source.allowCommercial = false; }, /droits/i);
  refuserManifeste((m) => { delete m.source.acquiredAt; }, /date|résolution/i);
  refuserManifeste((m) => { m.source.resolutionMetres = 0; }, /date|résolution/i);
});

test('la couverture refuse les pixels sans données et les nuages au-delà du seuil annoncé', () => {
  refuserManifeste((m) => { m.quality.zoneNoDataPercent = 0.01; }, /sans données/i);
  refuserManifeste((m) => { m.quality.zoneCloudPercent = 10.01; }, /nuageuse/i);
  for (const champ of ['zoneCloudPercent', 'zoneNoDataPercent', 'zoneUnclassifiedPercent']) {
    refuserManifeste((m) => { delete m.quality[champ]; }, /couverture/i, champ);
    refuserManifeste((m) => { m.quality[champ] = -1; }, /couverture/i, champ);
  }
  assert.doesNotThrow(() => C.validerManifeste(modifierManifeste((m) => { m.quality.zoneCloudPercent = 10; })));
});

test('deux entrées du catalogue ne peuvent pas désigner le même identifiant', () => {
  refuserCatalogue((z, c) => { c.zones.push(copie(z)); }, /zone.*invalide/i);
});

test('le remplacement compte simultanément la nouvelle zone et les anciennes versions', () => {
  const estimation = { quota: 1024 * MIO, usage: 128 * MIO };
  assert.doesNotThrow(() => C.prevoirEspace(4 * MIO, 60 * MIO, estimation));
  assert.throws(() => C.prevoirEspace(5 * MIO, 60 * MIO, estimation), /limite prudente/i);
  assert.throws(() => C.prevoirEspace(20 * MIO, 50 * MIO, estimation), /limite prudente/i);
  assert.deepEqual(estimation, { quota: 1024 * MIO, usage: 128 * MIO }, 'Le calcul ne modifie pas l’estimation.');
});

test('le téléchargement laisse une réserve minimale pour les données métier et les écritures', () => {
  assert.throws(() => C.prevoirEspace(1 * MIO, 0, { quota: 256 * MIO, usage: 192 * MIO }), /espace insuffisant/i);
  assert.doesNotThrow(() => C.prevoirEspace(4 * MIO, 0, { quota: 256 * MIO, usage: 128 * MIO }));
});

test('un grand quota garde aussi la réserve proportionnelle, même s’il reste plus de 64 Mio', () => {
  assert.throws(() => C.prevoirEspace(4 * MIO, 0, { quota: 1024 * MIO, usage: 820 * MIO }), /espace insuffisant/i);
});

test('sans estimation le plafond prudent est de 16 Mio, anciennes cartes incluses', () => {
  for (const estimation of [null, undefined, {}, { quota: 0, usage: 0 }, { quota: Infinity, usage: 0 }, { quota: 1024 * MIO, usage: NaN }]) {
    const p = C.prevoirEspace(4 * MIO, 12 * MIO, estimation);
    assert.equal(p.mesure, false);
    assert.equal(p.limite, 16 * MIO);
    assert.throws(() => C.prevoirEspace(4 * MIO, 13 * MIO, estimation), /limite prudente/i);
  }
});

test('un usage négatif ne doit pas fabriquer de l’espace libre mesuré', () => {
  let resultat;
  try { resultat = C.prevoirEspace(4 * MIO, 0, { quota: 1024 * MIO, usage: -MIO }); }
  catch (e) { assert.ok(e instanceof Error); return; }
  assert.equal(resultat.mesure, false, 'Une estimation incohérente doit être refusée ou traitée comme inconnue.');
});

test('des volumes inconnus ou négatifs ne peuvent autoriser un téléchargement', () => {
  for (const [nouveau, occupe] of [[-1, 0], [0, -1], [NaN, 0], [0, Infinity], ['100', 0]]) {
    assert.throws(() => C.prevoirEspace(nouveau, occupe, null), /stockage inconnu/i);
  }
});

#!/usr/bin/env node
/* AFLP FIELD PROOF — tests du cœur pur (fieldproof/fp-core.js).
   Usage : node tests/fieldproof/core.test.mjs
   Données 100 % fictives. Les contrôles ZIP et EXIF s'appuient sur des
   outils externes (unzip, Python/PIL) lorsqu'ils sont présents. */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const C = require('../../fieldproof/fp-core.js');
let ok = 0, ko = 0;
function t(nom, f) {
  try { const r = f(); if (r === false) throw new Error('assertion fausse'); ok++; console.log('✓ ' + nom); }
  catch (e) { ko++; console.log('✗ ' + nom + ' — ' + e.message); }
}
function eq(a, b) { if (a !== b) throw new Error(`attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }
const tmp = mkdtempSync(join(tmpdir(), 'fp-core-'));

/* Dates Abidjan */
t('Date et heure affichées en GMT (Abidjan)', () => { eq(C.dateHeureAbj('2026-10-31T17:35:09Z'), '31/10/2026 17:35:09 GMT'); });
t('Heure indépendante du fuseau local (minuit)', () => { eq(C.dateAbj('2026-12-31T23:59:59Z'), '31/12/2026'); });
t('Durée mm:ss et h:mm:ss', () => { eq(C.duree(125000), '02:05'); eq(C.duree(3725000), '1:02:05'); });

/* Identifiants */
t('Identifiant de mission au format FP-AAAAMMJJ-XXXXXX', () => /^FP-\d{8}-[A-HJ-NP-Z2-9]{6}$/.test(C.idMission('2026-10-31T08:00:00Z')));
t('Identifiants de mission distincts (10 000 tirages)', () => { const s = new Set(); for (let i = 0; i < 10000; i++) s.add(C.idMission()); return s.size === 10000; });
t('Identifiant média P01 / V02', () => { eq(C.idMedia('FP-20261031-ABCDEF', 'PHOTO', 1), 'FP-20261031-ABCDEF-P01'); eq(C.idMedia('FP-20261031-ABCDEF', 'VIDEO', 2), 'FP-20261031-ABCDEF-V02'); });

/* GPS */
const now = '2026-10-31T10:00:00Z';
t('GPS absent → LOCALISATION NON VÉRIFIÉE', () => { eq(C.statutGps(null, now).libelle, 'LOCALISATION NON VÉRIFIÉE'); });
t('GPS précis récent → OK', () => { eq(C.statutGps({ lat: 7.1, lon: -5.1, precision: 12, horodatage: now }, now).code, 'OK'); });
t('GPS imprécis (>50 m) → IMPRECIS', () => { eq(C.statutGps({ lat: 7.1, lon: -5.1, precision: 180, horodatage: now }, now).code, 'IMPRECIS'); });
t('GPS ancien (>2 min) → ANCIEN et non vérifié', () => { const s = C.statutGps({ lat: 7.1, lon: -5.1, precision: 10, horodatage: '2026-10-31T09:50:00Z' }, now); eq(s.code, 'ANCIEN'); return /NON VÉRIFIÉE/.test(s.libelle); });
t('Aucun statut ne prétend à une certification', () => ['OK', 'IMPRECIS'].every(c => !/CERTIFI|VÉRIFIÉ[E]? $/.test(C.statutGps({ lat: 1, lon: 1, precision: c === 'OK' ? 5 : 500, horodatage: now }, now).libelle)));
t('Lien Google Maps', () => { eq(C.lienCarte({ lat: 7.123456789, lon: -5.5 }), 'https://www.google.com/maps?q=7.123457,-5.5'); });

/* Bandeau */
const base = { idMedia: 'FP-20261031-ABCDEF-P01', type: 'PHOTO', agent: 'AGENT FICTIF', cluster: 'Botro', village: 'Village Fictif A', activite: 'Formation des producteurs', debut: now };
t('Bandeau photo : 5 lignes avec tous les champs', () => {
  const l = C.lignesBandeau({ ...base, gpsDebut: { lat: 7.1, lon: -5.1, precision: 12, horodatage: now } }, now).join('\n');
  return ['AFLP · ANAGROCI', 'AGENT FICTIF', 'Botro', 'Village Fictif A', 'Formation des producteurs', '31/10/2026', '10:00:00', '7.10000, -5.10000', '±12 m', 'GPS DU TÉLÉPHONE', 'FP-20261031-ABCDEF-P01'].every(x => l.includes(x));
});
t('Bandeau photo sans GPS : mention explicite', () => C.lignesBandeau({ ...base, gpsDebut: null }, now).join('\n').includes('LOCALISATION NON VÉRIFIÉE'));
t('Bandeau vidéo : position annoncée comme celle du DÉBUT', () => {
  const l = C.lignesBandeau({ ...base, type: 'VIDEO', dureeMs: 42000, gpsDebut: { lat: 7.1, lon: -5.1, precision: 8, horodatage: now } }).join('\n');
  return l.includes('Position au DÉBUT') && l.includes('Durée : 00:42') && l.includes('Début : 31/10/2026');
});

/* Fichiers / manifeste */
const mission = { id: 'FP-20261031-ABCDEF', creeLe: now, agent: 'AGENT FICTIF', agentId: 'u-1', role: 'Unit Head', cluster: 'Botro', village: 'Village Fictif A', villageId: 'v1', activite: 'Formation des producteurs', commentaire: '=SOMME(A1)' };
const medias = [
  { id: 'FP-20261031-ABCDEF-P01', type: 'PHOTO', cluster: 'Botro', village: 'Village Fictif A', debut: now, mime: 'image/jpeg', largeur: 1280, hauteur: 960, taille: 100, sha256: 'ab', gpsDebut: null, commentaire: '=1+1' },
  { id: 'FP-20261031-ABCDEF-V01', type: 'VIDEO', cluster: 'Botro', village: 'Village Fictif A', debut: now, fin: now, dureeMs: 3000, mime: 'video/webm;codecs=vp8,opus', taille: 200, sha256: 'cd', micro: false }
];
t('Nom de fichier normalisé sans accents', () => { eq(C.nomFichier(medias[0]), 'AFLP_FP-20261031-ABCDEF-P01_BOTRO_VILLAGE-FICTIF-A_20261031-100000.jpg'); });
t('Extension vidéo déduite du type MIME', () => { eq(C.extension('video/mp4;codecs=avc1'), 'mp4'); eq(C.extension('video/webm;codecs=vp8'), 'webm'); });
t('CSV : en-tête complet et injection de formule neutralisée', () => {
  const csv = C.manifesteCsv(mission, medias);
  return csv.startsWith('﻿mission_id;') && csv.includes("'=1+1") && csv.split('\r\n').length === 4 && csv.includes('NON (vidéo muette)');
});
t('Manifeste JSON : avertissement de non-certification présent', () => /ne constituent pas une preuve certifiée/.test(C.manifesteJson(mission, medias).avertissement));

/* SHA-256 */
const v = [['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'], ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1']];
v.forEach(([m, h]) => t(`SHA-256 vecteur NIST (${m.length} octets)`, () => eq(C.sha256Hex(new TextEncoder().encode(m)), h)));
t('SHA-256 incrémental = SHA-256 Node (5 Mo en morceaux irréguliers)', () => {
  const buf = new Uint8Array(5 * 1048576 + 37); for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) >>> 24;
  const h = new C.Sha256(); let p = 0; const pas = [1, 63, 64, 65, 4096, 99991];
  for (let i = 0; p < buf.length; i++) { const n = pas[i % pas.length]; h.update(buf.subarray(p, p + n)); p += n; }
  eq(h.hex(), createHash('sha256').update(buf).digest('hex'));
});

/* CRC / ZIP */
t('CRC-32 de « 123456789 » = cbf43926', () => eq(C.crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926'));
t('CRC-32 incrémental identique', () => { const a = new TextEncoder().encode('12345'), b = new TextEncoder().encode('6789'); eq(C.crc32(b, C.crc32(a)), 0xcbf43926); });
function construireZip(fichiers) {
  const ent = fichiers.map(f => ({ nom: f.nom, taille: f.data.length, crc: C.crc32(f.data), quand: now }));
  const plan = C.planZip(ent);
  const parts = plan.segments.map(s => s.octets ? Buffer.from(s.octets) : Buffer.from(fichiers[s.fichier].data));
  const z = Buffer.concat(parts); if (z.length !== plan.tailleTotale) throw new Error('taille annoncée fausse'); return z;
}
const fichiersZip = [{ nom: 'manifeste.json', data: new TextEncoder().encode('{"a":1}') }, { nom: 'médias/vidéo é.bin', data: new Uint8Array(70000).map((_, i) => i & 255) }];
t('ZIP stocké valide (unzip -t) avec nom UTF-8', () => {
  const z = construireZip(fichiersZip); const f = join(tmp, 'a.zip'); writeFileSync(f, z);
  const out = execFileSync('unzip', ['-t', f]).toString(); return /No errors detected/.test(out) && out.includes('vidéo é.bin');
});
t('ZIP relu par lireZip (noms, tailles, CRC)', () => {
  const z = new Uint8Array(construireZip(fichiersZip)); const e = C.lireZip(z);
  return e.length === 2 && e[1].nom === 'médias/vidéo é.bin' && e[1].taille === 70000 && C.crc32(z.subarray(e[1].debut, e[1].debut + e[1].taille)) === e[1].crc;
});
t('Découpage en lots sous le plafond', () => { const l = C.lots([{ taille: 60 }, { taille: 60 }, { taille: 60 }, { taille: 500 }], 150); eq(l.length, 4); });

/* EXIF */
t('EXIF inséré : date, GPS et auteur relus par PIL', () => {
  const jpg = join(tmp, 'b.jpg');
  execFileSync('python3', ['-c', `from PIL import Image; Image.new('RGB',(64,48),(30,140,60)).save('${jpg}','JPEG')`]);
  const seg = C.segmentExif({ date: '2026-10-31T10:00:00Z', description: 'FP-20261031-ABCDEF-P01 Botro', artiste: 'AGENT FICTIF', gps: { lat: 7.5, lon: -5.25, precision: 12 } });
  const sortie = C.insererExif(new Uint8Array(readFileSync(jpg)), seg); writeFileSync(jpg, sortie);
  const py = `from PIL import Image
im=Image.open('${jpg}'); im.load(); e=im.getexif(); g=e.get_ifd(0x8825); x=e.get_ifd(0x8769)
lat=float(g[2][0])+float(g[2][1])/60+float(g[2][2])/3600; lon=float(g[4][0])+float(g[4][1])/60+float(g[4][2])/3600
print(e[0x0132], e[0x013B], g[1], round(lat,5), g[3], round(lon,5), x[0x9003], float(g[31]))`;
  const out = execFileSync('python3', ['-c', py]).toString().trim();
  eq(out, '2026:10:31 10:00:00 AGENT FICTIF N 7.5 W 5.25 2026:10:31 10:00:00 12.0');
});
t('EXIF sans GPS : image toujours lisible', () => {
  const jpg = join(tmp, 'c.jpg');
  execFileSync('python3', ['-c', `from PIL import Image; Image.new('RGB',(32,32)).save('${jpg}','JPEG')`]);
  writeFileSync(jpg, C.insererExif(new Uint8Array(readFileSync(jpg)), C.segmentExif({ date: now, description: 'x', artiste: 'y' })));
  return execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${jpg}'); im.load(); print(im.size, 0x8825 in im.getexif())`]).toString().trim() === '(32, 32) False';
});

/* Vérification de dossier */
t('Vérification : conforme, modifié, absent, hors manifeste', () => {
  const m = { medias: [{ fichier: 'a.jpg', sha256: 'AA' }, { fichier: 'b.jpg', sha256: 'bb' }, { fichier: 'c.jpg', sha256: 'cc' }] };
  const r = C.verifierDossier(m, { 'a.jpg': 'aa', 'b.jpg': 'zz', 'd.jpg': 'dd' });
  return r.map(x => x.statut).join(',') === 'CONFORME,MODIFIE,ABSENT,HORS_MANIFESTE';
});
t('Estimation taille vidéo 2 min 720p ≈ 39 Mo', () => { const n = C.tailleVideoEstimee('STANDARD', 120); return n > 35e6 && n < 45e6; });

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);

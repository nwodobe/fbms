#!/usr/bin/env node
/* AFLP FIELD PROOF 1.2.0 — rafale et appareil photo du téléphone : règles pures.
   Usage : node tests/fieldproof/rafale-repli.test.mjs   (données fictives) */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../fieldproof/fp-core.js');
let ok = 0, ko = 0;
function t(nom, f) { try { const r = f(); if (r === false) throw new Error('assertion fausse'); ok++; console.log('✓ ' + nom); } catch (e) { ko++; console.log('✗ ' + nom + ' — ' + e.message); } }
function eq(a, b) { if (a !== b) throw new Error(`attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }

const MID = 'FP-20261107-ABCDEF';
t('Rang lu sans limite : P07 → 7, P99 → 99, P100 → 100, P1234 → 1234', () => { eq(C.rangMedia(MID + '-P07'), 7); eq(C.rangMedia(MID + '-P99'), 99); eq(C.rangMedia(MID + '-P100'), 100); eq(C.rangMedia(MID + '-V1234'), 1234); });
t('Après P99, le numéro suivant est P100 (plus de retour à P00)', () => { eq(C.idMedia(MID, 'PHOTO', C.rangMedia(MID + '-P99') + 1), MID + '-P100'); });
t('Identifiant illisible → rang 0, jamais NaN', () => { eq(C.rangMedia('n-importe-quoi'), 0); eq(C.rangMedia(null), 0); });

const N = Date.parse('2026-11-07T10:00:00Z');
t('Date EXIF avec décalage +00:00 lue en UTC', () => { eq(C.dateExif('2026:11:07 09:55:00', '+00:00').toISOString(), '2026-11-07T09:55:00.000Z'); });
t('Date EXIF avec décalage +02:00 convertie', () => { eq(C.dateExif('2026:11:07 11:55:00', '+02:00').toISOString(), '2026-11-07T09:55:00.000Z'); });
t('Date EXIF vide, nulle ou « 0000:00:00 » → null', () => { eq(C.dateExif(''), null); eq(C.dateExif(null), null); eq(C.dateExif('0000:00:00 00:00:00'), null); });
t('Photo prise il y a 5 min → acceptée', () => { const r = C.controleFraicheur(new Date(N - 5 * 60000), N); eq(r.ok, true); eq(r.ageMin, 5); });
t('Photo prise il y a 29 min → acceptée ; 31 min → refusée', () => { eq(C.controleFraicheur(new Date(N - 29 * 60000), N).ok, true); const r = C.controleFraicheur(new Date(N - 31 * 60000), N); eq(r.ok, false); eq(r.code, 'ANCIENNE'); });
t('Photo de la veille → refusée, motif en heures', () => { const r = C.controleFraicheur(new Date(N - 26 * 3600000), N); eq(r.ok, false); return /26 h/.test(r.motif); });
t('Sans date de prise de vue (capture d\'écran, WhatsApp) → refusée', () => { const r = C.controleFraicheur(null, N); eq(r.ok, false); eq(r.code, 'SANS_DATE'); return /WhatsApp/.test(r.motif); });
t('Date dans le futur (> 5 min) → refusée ; petit écart d\'horloge (2 min) toléré', () => { eq(C.controleFraicheur(new Date(N + 10 * 60000), N).code, 'FUTUR'); eq(C.controleFraicheur(new Date(N + 2 * 60000), N).ok, true); });
t('Délai par défaut = 30 min (décision du Branch Manager)', () => { eq(C.FRAICHEUR_IMPORT_MIN, 30); });

const meta = { type: 'PHOTO', idMedia: MID + '-P01', agent: 'AGENT FICTIF', cluster: 'Botro', village: 'Village Fictif', activite: 'Visite', debut: '2026-11-07T09:55:00Z', gpsDebut: null };
t('Bandeau : mention « Appareil photo du téléphone » et heure d\'import', () => { const l = C.lignesBandeau(Object.assign({}, meta, { source: 'APPAREIL_TELEPHONE', importeLe: '2026-11-07T10:00:00Z' }), N); return /Appareil photo du téléphone, importée à 10:00/.test(l[2]); });
t('Bandeau : aucune mention pour la caméra intégrée', () => !/Appareil photo/.test(C.lignesBandeau(meta, N).join('|')));
t('Manifeste : colonnes capture_source et importe_le_gmt ajoutées en fin (compatibles)', () => {
  const k = C.COLONNES_CSV; eq(k[k.length - 2], 'capture_source'); eq(k[k.length - 1], 'importe_le_gmt'); eq(k.indexOf('commentaire'), k.length - 3);
  const mi = { id: MID, agent: 'A', cluster: 'Botro', village: 'V', activite: 'X' };
  const csv = C.manifesteCsv(mi, [{ id: MID + '-P01', type: 'PHOTO', debut: meta.debut, mime: 'image/jpeg', source: 'APPAREIL_TELEPHONE', importeLe: '2026-11-07T10:00:00Z' }, { id: MID + '-P02', type: 'PHOTO', debut: meta.debut, mime: 'image/jpeg' }]);
  return /;APPAREIL_TELEPHONE;2026-11-07T10:00:00Z/.test(csv) && /;CAMERA_INTEGREE;/.test(csv);
});

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);

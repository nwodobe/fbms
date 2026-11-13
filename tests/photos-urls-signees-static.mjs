// Test statique du correctif « photos » (URL signées à l'affichage, repli sur l'URL d'origine).
// Données fictives ; aucun appel réseau : le client Supabase est simulé.
import fs from 'node:fs';
const s = fs.readFileSync(new URL('../fbms/index.html', import.meta.url), 'utf8');
const i = s.indexOf('const PhotoSigner = {'); const j = s.indexOf('\n};\n', i) + 3;
if (i < 0) { console.error('PhotoSigner introuvable'); process.exit(1); }
const appels = []; let rendu = 0;
globalThis.STATE = { villages: [{ photos: { chef: 'https://x.supabase.co/storage/v1/object/public/photos/V-1/chef.jpg?t=1', entree: 'data:image/jpeg;base64,AA', rt: 'https://drive.google.com/x' } }], drawerId: null };
globalThis.isSupabase = () => true; globalThis.AUTH = { isConnected: () => true }; globalThis.initSupabase = () => {};
globalThis.renderContent = () => { rendu++; }; globalThis.renderDrawer = () => {};
globalThis.SB = { storage: { from: b => ({ createSignedUrls: async (paths, ttl) => { appels.push([b, paths, ttl]); return { data: paths.map(p => ({ path: p, signedUrl: 'https://x.supabase.co/storage/v1/object/sign/photos/' + p + '?token=T' })), error: null }; } }) } };
(0, eval)(s.slice(i, j).replace('const PhotoSigner', 'globalThis.PhotoSigner'));
const P = globalThis.PhotoSigner; let ko = 0;
const ok = (c, m) => { if (!c) ko++; console.log((c ? 'RÉUSSI ' : 'ÉCHEC  ') + m); };
const u = STATE.villages[0].photos.chef;
ok(P.chemin(u) === 'V-1/chef.jpg', 'chemin extrait de l’URL publique, paramètre anti-cache retiré');
ok(P.src(u) === u, 'avant signature : URL d’origine en repli');
ok(P.src('data:image/jpeg;base64,AA').startsWith('data:'), 'photo locale non modifiée');
ok(await P.prefetch(STATE.villages) && appels.length === 1 && appels[0][0] === 'photos' && appels[0][1].join() === 'V-1/chef.jpg' && appels[0][2] === 3600, 'une demande, bucket photos, 1 h, URL Supabase seulement');
ok(P.src(u).includes('/object/sign/photos/V-1/chef.jpg'), 'après signature : URL signée');
ok(P.src('https://drive.google.com/x') === 'https://drive.google.com/x', 'URL Drive historique inchangée');
ok(await P.prefetch(STATE.villages) === false && appels.length === 1, 'cache valide : aucune nouvelle demande');
globalThis.AUTH = { isConnected: () => false }; P.cache.clear();
ok(await P.prefetch(STATE.villages) === false, 'hors connexion : aucune demande');
globalThis.AUTH = { isConnected: () => true }; P.planifier(); await new Promise(r => setTimeout(r, 20));
ok(rendu === 1, 'un seul nouveau rendu après signature');
P.planifier(); await new Promise(r => setTimeout(r, 20));
ok(rendu === 1, 'pas de boucle de rendu');
const fb = fs.readFileSync(new URL('../operations/field-buying.js', import.meta.url), 'utf8');
ok(/function signerPhotosGalerie/.test(fb) && /createSignedUrls\(manquants, 3600\)/.test(fb), 'galerie des villages : URL signées prévues');
console.log(ko ? ko + ' échec(s)' : 'Correctif photos : tous les tests réussis.'); process.exit(ko ? 1 : 0);

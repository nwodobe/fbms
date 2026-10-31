#!/usr/bin/env node
/**
 * AFLP FIELD PROOF — réouverture HORS LIGNE par le service worker EXISTANT (sw.js, non modifié).
 * 1) première ouverture en ligne (installation du SW) ; 2) rechargement (page contrôlée, mise en cache) ;
 * 3) serveur ARRÊTÉ + réseau coupé ; 4) rechargement, création de mission et capture photo.
 * Doublures : auth-gate (profil fictif) et SDK Supabase (villages fictifs). Navigateur : Chromium.
 * Usage : CHROMIUM=/usr/bin/google-chrome node tests/fieldproof/e2e/hors-ligne-sw.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ICI = dirname(fileURLToPath(import.meta.url)), R = normalize(join(ICI, '..', '..', '..'));
const AUTH = readFileSync(join(ICI, 'doublures', 'auth-gate.js')), SUPA = readFileSync(join(ICI, 'doublures', 'supabase.js'));
const T = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
const PORT = Number(process.env.PORT_FP_SW || 4396);
const srv = createServer((q, s) => { const c = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (c === '/shared/auth-gate.js') { s.writeHead(200, { 'content-type': T['.js'] }); return s.end(AUTH); } let f = normalize(join(R, c)); if (!f.startsWith(R)) { s.writeHead(403); return s.end(); } if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html'); if (!existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': T[extname(f)] || 'application/octet-stream' }); s.end(readFileSync(f)); }).listen(PORT);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation', 'camera'], geolocation: { latitude: 7.5, longitude: -5, accuracy: 10 } });
await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const p = await ctx.newPage(), U = `http://127.0.0.1:${PORT}/fieldproof/index.html`;
await p.goto(U); await p.waitForSelector('text=Préparation du téléphone');
await p.evaluate(() => navigator.serviceWorker.ready);
await p.reload(); await p.waitForSelector('text=Préparation du téléphone');
const ctrl = await p.evaluate(() => !!navigator.serviceWorker.controller);
srv.close(); await ctx.setOffline(true);
let ok = false, detail = '';
try {
  await p.reload({ timeout: 20000 }); await p.waitForSelector('text=Préparation du téléphone', { timeout: 20000 });
  detail = 'réseau affiché : ' + (await p.textContent('#fpReseau'));
  await p.goto(U + '#nouvelle'); await p.waitForSelector('#fpCluster'); await p.selectOption('#fpCluster', 'Botro'); await p.selectOption('#fpVillage', { index: 1 }); await p.selectOption('#fpActivite', { index: 1 }); await p.click('button[type=submit]'); await p.waitForURL(/#mission\//);
  const mid = p.url().split('#mission/')[1];
  await p.goto(U + `#capture/${mid}/PHOTO`); await p.waitForSelector('#fpDeclencheur:not([disabled])', { timeout: 20000 }); await p.click('#fpDeclencheur'); await p.waitForSelector('[data-valider]'); await p.click('[data-valider]'); await p.waitForSelector('.fp-revue-ok', { timeout: 20000 });
  detail += ' · mission ' + mid + ' créée et photo validée, serveur arrêté'; ok = ctrl;
} catch (e) { detail = 'ÉCHEC : ' + e.message.split('\n')[0]; }
console.log(`${ok ? '✓' : '✗'} T23 Réouverture hors ligne via sw.js existant — contrôlée par le SW : ${ctrl} · ${detail}`);
await b.close(); process.exit(ok ? 0 : 1);

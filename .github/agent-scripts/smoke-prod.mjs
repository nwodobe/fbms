#!/usr/bin/env node
/* ============================================================================
 * FBMS — Smoke test de PRODUCTION (GitHub Pages).
 * Vérifie la page réellement en ligne, sans session (elle affiche l'écran
 * d'accès ANAGROCI — c'est le point d'entrée légitime à contrôler).
 *
 * Contrôles (tous bloquants) :
 *  1. HTTP 200 sur la page principale.
 *  2. Contenu principal présent ("ANAGROCI").
 *  3. Au moins une feuille de style et un script chargés (200).
 *  4. Aucune ressource ESSENTIELLE (même origine) en 404.
 *  5. Aucune exception JavaScript non interceptée.
 *  6. Rendu utilisable en mobile (390x844) ET desktop (1440x900).
 *
 * Usage : node smoke-prod.mjs https://nwodobe.github.io/fbms/index.html
 * ==========================================================================*/
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://nwodobe.github.io/fbms/index.html';
const origin = new URL(url).origin;
const fail = [];

// 1. HTTP 200 + contenu
const res = await fetch(url);
if (!res.ok) fail.push(`HTTP ${res.status} sur ${url}`);
const html = await res.text();
if (!/ANAGROCI/i.test(html)) fail.push('Contenu principal "ANAGROCI" absent du HTML.');

const browser = await chromium.launch();
let cssLoaded = false, jsLoaded = false;
const essential404 = [];
const jsErrors = [];

for (const vp of [{ n: 'mobile', w: 390, h: 844 }, { n: 'desktop', w: 1440, h: 900 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  page.on('pageerror', e => jsErrors.push(`[${vp.n}] ${e.message || e}`));
  page.on('response', r => {
    const u = r.url(), s = r.status(), type = r.request().resourceType();
    if (s < 400) {
      if (type === 'stylesheet') cssLoaded = true;
      if (type === 'script') jsLoaded = true;
    } else if (u.startsWith(origin) && (type === 'stylesheet' || type === 'script' || type === 'document')) {
      essential404.push(`[${vp.n}] ${s} ${u}`);
    }
  });
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1500);
    const bodyText = (await page.textContent('body')) || '';
    if (!/ANAGROCI/i.test(bodyText)) fail.push(`[${vp.n}] "ANAGROCI" non rendu dans le body.`);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 2) console.log(`⚠️  [${vp.n}] débordement horizontal +${overflow}px`);
  } catch (e) {
    fail.push(`[${vp.n}] chargement échoué : ${e.message}`);
  }
  await ctx.close();
}
await browser.close();

if (!cssLoaded) fail.push('Aucune feuille de style chargée (200).');
if (!jsLoaded) fail.push('Aucun script chargé (200).');
if (essential404.length) fail.push('Ressources essentielles en 404 :\n   ' + essential404.join('\n   '));
if (jsErrors.length) fail.push('Exceptions JavaScript :\n   ' + jsErrors.join('\n   '));

if (fail.length) {
  console.error('❌ Smoke test PRODUCTION échoué :');
  fail.forEach(f => console.error('   - ' + f));
  process.exit(1);
}
console.log('✅ Smoke test PRODUCTION réussi : page en ligne, CSS+JS chargés, pas de 404 essentiel, pas d\'erreur JS, rendu mobile+desktop.');

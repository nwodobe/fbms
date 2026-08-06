#!/usr/bin/env node
/* ============================================================================
 * FBMS — Contrôles runtime via Playwright (Chromium) aux viewports desktop et
 * mobile. Nécessite `playwright` installé (le workflow le fait).
 *
 * BLOQUANT   : toute exception JavaScript non interceptée (pageerror).
 * SIGNALÉ    : console.error, requêtes réseau échouées, manquements a11y de base
 *              (html[lang], images sans alt). Non bloquant (bruit CDN externe).
 *
 * Usage : node checks.mjs http://localhost:8080/index.html
 * ==========================================================================*/
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) { console.error('Usage: node checks.mjs <url>'); process.exit(2); }

const VIEWPORTS = [
  { name: 'mobile',  width: 390,  height: 844 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

let fatal = 0;
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedReq = [];

  page.on('pageerror', e => pageErrors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) failedReq.push(`${r.status()} ${r.url()}`); });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    console.error(`[${vp.name}] ❌ échec de chargement : ${e.message}`);
    fatal++;
    await ctx.close();
    continue;
  }

  // a11y de base (report-only)
  const a11y = await page.evaluate(() => {
    const out = [];
    if (!document.documentElement.getAttribute('lang')) out.push('html[lang] absent');
    const imgs = [...document.images].filter(i => !i.hasAttribute('alt'));
    if (imgs.length) out.push(`${imgs.length} image(s) sans attribut alt`);
    return out;
  });
  // Débordement horizontal (report-only)
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

  console.log(`\n=== ${vp.name} ${vp.width}x${vp.height} ===`);
  console.log(pageErrors.length ? `❌ JS pageerror: ${pageErrors.length}` : '✅ aucune exception JS');
  pageErrors.forEach(e => console.log(`   JSERR ${e}`));
  if (consoleErrors.length) { console.log(`⚠️  console.error: ${consoleErrors.length}`); consoleErrors.slice(0,5).forEach(e=>console.log(`   ${e}`)); }
  if (failedReq.length)     { console.log(`⚠️  requêtes échouées: ${failedReq.length}`); failedReq.slice(0,5).forEach(e=>console.log(`   ${e}`)); }
  if (a11y.length)          { console.log(`⚠️  a11y: ${a11y.join(' · ')}`); }
  if (overflow > 1)         { console.log(`⚠️  débordement horizontal: +${overflow}px`); }

  if (pageErrors.length) fatal++;
  await ctx.close();
}

await browser.close();
if (fatal) { console.error(`\n❌ ${fatal} viewport(s) avec exception JS non interceptée.`); process.exit(1); }
console.log('\n✅ Aucune exception JS non interceptée sur les 3 viewports.');

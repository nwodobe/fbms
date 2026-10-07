#!/usr/bin/env node
/* Recette visuelle du module Coopératives AFLP, aux 3 largeurs imposées (CLAUDE.md §5.3).
   Serveur statique local + doublure Supabase AVEC session (données fictives QA).
   Relève : erreurs console / JS, débordement horizontal, libellés techniques bruts
   visibles, présence des éléments clés ; capture chaque écran dans --out.
   Usage : NODE_PATH=… node tests/cooperatives/recette-ui.mjs --out <dossier> */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const RACINE = process.cwd(), PORT = 4391
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '/tmp/recette-coop'
mkdirSync(OUT, { recursive: true })
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const srv = createServer((req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const f = join(RACINE, p.endsWith('/') ? p + 'index.html' : p)
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f))
}).listen(PORT)
const DOUBLE = readFileSync(join(RACINE, 'tests/cooperatives/doublure-supabase-coop.js'), 'utf8')
const VEND = (n) => readFileSync(join(RACINE, '.github/vendor/doublures', n), 'utf8')
/* Import Excel : vraie bibliothèque SheetJS si fournie (XLSX_REEL=chemin), sinon doublure. */
const XLSX_JS = process.env.XLSX_REEL && existsSync(process.env.XLSX_REEL) ? readFileSync(process.env.XLSX_REEL, 'utf8') : VEND('xlsx.js')
const CSV_QA = join(OUT, 'import-qa.csv')
{
  const lignes = ['Nom,Prénoms,Téléphone,Village,Member ID,Sexe,Année de naissance,Superficie (ha),Potentiel (kg)']
  for (let i = 1; i <= 30; i++) lignes.push(`QA IMPORT ${i},TEST,${i === 3 ? '0700010011' : i === 4 ? '0799999' : ''},${i === 5 ? 'QA INCONNU' : i % 2 ? 'QA BROBO' : 'QA TAKIKRO'},IMP-${i},${i % 2 ? 'M' : 'F'},${1970 + i},${i % 3 ? '1.5' : ''},${i % 4 ? '900' : ''}`)
  lignes.push('QA IMPORT 1,TEST,,QA BROBO,IMP-31,M,1971,,')
  writeFileSync(CSV_QA, lignes.join('\n'))
}
const VIEWPORTS = [{ nom: '390', width: 390, height: 844 }, { nom: '768', width: 768, height: 1024 }, { nom: '1440', width: 1440, height: 900 }]
const C1 = '11111111-1111-4111-8111-111111111111'
const ECRANS = [
  ['fb-overview', 'operations/field-buying.html#overview', '.coop-hero'],
  ['coop-dashboard', 'operations/field-buying.html#cooperatives', '.coop-card'],
  ['coop-new', 'operations/field-buying.html#cooperatives/new', '#coopForm'],
  ...['overview', 'producers', 'villages', 'contacts', 'potential', 'purchases', 'bags', 'sustainability', 'documents', 'history'].map((t) => ['fiche-' + t, `operations/field-buying.html#cooperatives/${C1}/${t}`, '.coop-fiche']),
  ['coop-import', `operations/field-buying.html#cooperatives/${C1}/import`, '#impFile'],
  ['enrol-formulaire', `operations/field-buying.html#cooperatives/${C1}/producers`, '#enForm', async (p) => { await p.waitForSelector('#mfTable table'); await p.evaluate((c) => ANAGROCI_COOP.enroll(c), C1); await p.waitForSelector('#enForm') }],
  ['enrol-doublon', `operations/field-buying.html#cooperatives/${C1}/producers`, '#enMatches .coop-match', async (p) => {
    await p.waitForSelector('#mfTable table'); await p.evaluate((c) => ANAGROCI_COOP.enroll(c), C1); await p.waitForSelector('#enForm')
    await p.fill('#enForm [name=nom]', 'QA PRODUCTEUR 11'); await p.selectOption('#enForm [name=village_id]', 'v-qa-1'); await p.fill('#enForm [name=telephone]', '0700010011')
    await p.click('#enGo') }],
  ['enrol-nouveau', `operations/field-buying.html#cooperatives/${C1}/producers`, '.notice.ok', async (p) => {
    await p.waitForSelector('#mfTable table'); await p.evaluate((c) => ANAGROCI_COOP.enroll(c), C1); await p.waitForSelector('#enForm')
    await p.fill('#enForm [name=nom]', 'QA NOUVEAU'); await p.selectOption('#enForm [name=village_id]', 'v-qa-2'); await p.click('#enAddPlot'); await p.click('#enGo') }],
  ['associer-existant', `operations/field-buying.html#cooperatives/${C1}/producers`, '#lkRes .coop-match', async (p) => {
    await p.waitForSelector('#mfTable table'); await p.evaluate((c) => ANAGROCI_COOP.linkExisting(c), C1); await p.waitForSelector('#lkForm')
    await p.fill('#lkForm [name=telephone]', '0700010011'); await p.click('#lkSearch') }],
  ['a-verifier', `operations/field-buying.html#cooperatives/${C1}/producers`, '.coop-review', async (p) => { await p.waitForSelector('#mfTable table'); await p.evaluate((c) => ANAGROCI_COOP.reviews(c), C1) }],
  ['import-classement', `operations/field-buying.html#cooperatives/${C1}/import`, '.coop-steps .on', async (p) => {
    await p.waitForSelector('#impFile'); await p.setInputFiles('#impFile', CSV_QA)
    if (!process.env.XLSX_REEL) return
    await p.waitForSelector('#impNext'); await p.click('#impNext'); await p.waitForSelector('#impBack'); await p.click('#impNext')
    await p.waitForSelector('select[data-vk]'); await p.click('#impNext'); await p.waitForFunction(() => /Classement|Classification/.test(document.querySelector('.coop-steps .on')?.textContent || ''), null, { timeout: 8000 }) }],
  ['import-rapport', `operations/field-buying.html#cooperatives/${C1}/import`, '.coop-steps .on', async (p) => {
    await p.waitForSelector('#impFile'); await p.setInputFiles('#impFile', CSV_QA)
    if (!process.env.XLSX_REEL) return
    await p.waitForSelector('#impNext'); await p.click('#impNext'); await p.waitForSelector('#impBack'); await p.click('#impNext')
    await p.waitForSelector('select[data-vk]'); await p.click('#impNext'); await p.waitForSelector('#impNext'); await p.click('#impNext'); await p.waitForSelector('#impGo')
    await p.click('#impGo'); await p.waitForSelector('#impRep', { timeout: 10000 }) }],
  ['procurement-delivery-plan', 'operations/procurement.html#arrivals', '#arrFilter', async (p) => { await p.waitForSelector('#arrFilter', { timeout: 10000 }); await p.click('#arrFilter [data-arrf="COOPERATIVE"]'); await p.waitForSelector('#coopDeliveriesHost table') }],
  ['passport-canal', 'operations/field-buying.html#farmers/p-qa-1', '#fbCoopChannel'],
  ['reports', 'operations/reports.html#cooperatives', '#coopReport table'],
  ['portail', 'index.html', '.portal-card']
]
const BRUTS = /\b(cooperative_id|membership_status|producer_id|sourcing_channel|INDIVIDUAL_FARMER|COOPERATIVE_CONSOLIDATED|ALLOCATION_A_COMPLETER|NON_EVALUE|EN_EVALUATION|DOUBLON_A_VERIFIER|NOUVEAU_ENROLE|TELEPHONE_MEME_VILLAGE|ORGANISATION_SEULEMENT|undefined|NaN|\[object Object\])\b/
/* Libellés français restés en anglais (module coopératives uniquement). */
const FR_EN = /(Enrôler|Associer un producteur|À vérifier|Qualité des données|Complétude|NON COLLECTÉ|Producteurs membres|Formations|Livraisons de la coopérative|Coopérative principale|Correspondance|Village du référentiel|Classement proposé|Livraisons coopératives|Tous)/
const bilan = []
const browser = await chromium.launch()
for (const lang of ['fr', 'en']) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    await ctx.addInitScript((l) => { try { localStorage.setItem('anagroci_lang', l) } catch (e) {} }, lang)
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      const u = route.request().url()
      if (/supabase-js/.test(u)) return route.fulfill({ contentType: 'text/javascript', body: DOUBLE })
      if (/leaflet.*\.js/.test(u)) return route.fulfill({ contentType: 'text/javascript', body: VEND('leaflet.js') })
      if (/xlsx/.test(u)) return route.fulfill({ contentType: 'text/javascript', body: XLSX_JS })
      if (/\.css/.test(u) || /fonts\.googleapis/.test(u)) return route.fulfill({ contentType: 'text/css', body: '' })
      if (/tile\.openstreetmap/.test(u)) return route.fulfill({ status: 204, body: '' })
      return route.fulfill({ status: 204, body: '' })
    })
    for (const [nom, url, attendu, action] of ECRANS) {
      if (nom === 'portail' && lang === 'en') continue
      const page = await ctx.newPage(), erreurs = []
      page.on('console', (m) => { if (m.type() === 'error') erreurs.push('console: ' + m.text()) })
      page.on('pageerror', (e) => erreurs.push('js: ' + e.message))
      await page.goto(`http://127.0.0.1:${PORT}/${url}`, { waitUntil: 'load' })
      let trouve = true
      try { if (action) await action(page); await page.waitForSelector(attendu, { timeout: 8000 }) } catch (e) { trouve = false; erreurs.push('attendu: ' + String(e.message).split('\n')[0]) }
      await page.waitForTimeout(700)
      const m = await page.evaluate(([re, fr]) => {
        const view = document.getElementById('coopReport') || document.getElementById('opsRouteView') || document.body
        const txt = view.innerText || ''
        const coopTxt = [].slice.call(document.querySelectorAll('[data-i18n-ignore], #coopReport, #coopDeliveriesHost')).map((e) => e.innerText).join(' ')
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, brut: (txt.match(new RegExp(re)) || [null])[0], longueur: txt.length,
          fr: (coopTxt.match(new RegExp(fr)) || [null])[0],
          enMarker: /AFLP COOPERATIVES|Cooperative|Farmers|Overview|Members|channel|Arrivals|Delivery|Report/i.test(txt) }
      }, [BRUTS.source, FR_EN.source])
      const fichier = `${OUT}/${lang}-${vp.nom}-${nom}.png`
      await page.screenshot({ path: fichier, fullPage: vp.width !== 390 })
      const frReste = lang === 'en' && /^(fiche-|enrol|associer|a-verifier|import|coop-|passport|reports|procurement)/.test(nom) ? m.fr : null
      const ok = trouve && !erreurs.length && m.overflow <= 1 && !m.brut && !frReste && (lang === 'fr' || m.enMarker)
      bilan.push({ lang, vp: vp.nom, nom, ok, trouve, overflow: m.overflow, brut: m.brut + (frReste ? ' FR:' + frReste : ''), erreurs: erreurs.slice(0, 3) })
      await page.close()
    }
    await ctx.close()
  }
}
await browser.close(); srv.close()
const ko = bilan.filter((b) => !b.ok)
for (const b of bilan) console.log((b.ok ? 'OK ' : 'KO ') + `${b.lang} ${b.vp.padStart(4)} ${b.nom}` + (b.ok ? '' : ` · trouvé=${b.trouve} débordement=${b.overflow} brut=${b.brut} ${b.erreurs.join(' | ')}`))
console.log(`\n${bilan.length} écran(s) · ${ko.length} écart(s) · captures : ${OUT}`)
process.exit(ko.length ? 1 : 0)

#!/usr/bin/env node
/* Recette visuelle du module Coopératives AFLP, aux 3 largeurs imposées (CLAUDE.md §5.3).
   Serveur statique local + doublure Supabase AVEC session (données fictives QA).
   Relève : erreurs console / JS, débordement horizontal, libellés techniques bruts
   visibles, présence des éléments clés ; capture chaque écran dans --out.
   Usage : NODE_PATH=… node tests/cooperatives/recette-ui.mjs --out <dossier> */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
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
const VIEWPORTS = [{ nom: '390', width: 390, height: 844 }, { nom: '768', width: 768, height: 1024 }, { nom: '1440', width: 1440, height: 900 }]
const C1 = '11111111-1111-4111-8111-111111111111'
const ECRANS = [
  ['fb-overview', 'operations/field-buying.html#overview', '.coop-hero'],
  ['coop-dashboard', 'operations/field-buying.html#cooperatives', '.coop-card'],
  ['coop-new', 'operations/field-buying.html#cooperatives/new', '#coopForm'],
  ...['overview', 'producers', 'villages', 'contacts', 'potential', 'purchases', 'bags', 'sustainability', 'documents', 'history'].map((t) => ['fiche-' + t, `operations/field-buying.html#cooperatives/${C1}/${t}`, '.coop-fiche']),
  ['coop-import', `operations/field-buying.html#cooperatives/${C1}/import`, '#impFile'],
  ['passport-canal', 'operations/field-buying.html#farmers/p-qa-1', '#fbCoopChannel'],
  ['reports', 'operations/reports.html#cooperatives', '#coopReport table'],
  ['portail', 'index.html', '.portal-card']
]
const BRUTS = /\b(cooperative_id|membership_status|producer_id|sourcing_channel|INDIVIDUAL_FARMER|COOPERATIVE_CONSOLIDATED|ALLOCATION_A_COMPLETER|NON_EVALUE|EN_EVALUATION|undefined|NaN|\[object Object\])\b/
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
      if (/xlsx/.test(u)) return route.fulfill({ contentType: 'text/javascript', body: VEND('xlsx.js') })
      if (/\.css/.test(u) || /fonts\.googleapis/.test(u)) return route.fulfill({ contentType: 'text/css', body: '' })
      if (/tile\.openstreetmap/.test(u)) return route.fulfill({ status: 204, body: '' })
      return route.fulfill({ status: 204, body: '' })
    })
    for (const [nom, url, attendu] of ECRANS) {
      if (lang === 'en' && !/coop-dashboard|fiche-overview|fiche-producers|coop-new|passport-canal|fb-overview/.test(nom)) continue
      const page = await ctx.newPage(), erreurs = []
      page.on('console', (m) => { if (m.type() === 'error') erreurs.push('console: ' + m.text()) })
      page.on('pageerror', (e) => erreurs.push('js: ' + e.message))
      await page.goto(`http://127.0.0.1:${PORT}/${url}`, { waitUntil: 'load' })
      let trouve = true
      try { await page.waitForSelector(attendu, { timeout: 8000 }) } catch (e) { trouve = false }
      await page.waitForTimeout(700)
      const m = await page.evaluate((re) => {
        const view = document.getElementById('opsRouteView') || document.body
        const txt = view.innerText || ''
        const rx = new RegExp(re)
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, brut: (txt.match(rx) || [null])[0], longueur: txt.length,
          enMarker: /AFLP COOPERATIVES|Cooperative|Farmers|Overview|Members|channel/i.test(txt) }
      }, BRUTS.source)
      const fichier = `${OUT}/${lang}-${vp.nom}-${nom}.png`
      await page.screenshot({ path: fichier, fullPage: vp.width !== 390 })
      const ok = trouve && !erreurs.length && m.overflow <= 1 && !m.brut && (lang === 'fr' || m.enMarker)
      bilan.push({ lang, vp: vp.nom, nom, ok, trouve, overflow: m.overflow, brut: m.brut, erreurs: erreurs.slice(0, 3) })
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

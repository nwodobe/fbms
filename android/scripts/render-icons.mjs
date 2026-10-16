// Génère les icônes Android à partir du logo officiel PJS/ANAGROCI (le même tracé
// SVG que l'écran de connexion shared/auth-gate.js). Usage : node android/scripts/render-icons.mjs
// Nécessite Playwright + Chromium (voir android/README.md).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const RES = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'src', 'main', 'res');
const MARK = '<path d="M46 14 A21 21 0 1 0 51 42" fill="none" stroke="#F0A500" stroke-width="9" stroke-linecap="round"/><path d="M31 50 C22 39 22 25 30 13 C38 25 38 39 31 50 Z" transform="rotate(-14 31 50)" fill="#1E8E3E"/><path d="M31 50 C22 39 22 25 30 13 C38 25 38 39 31 50 Z" transform="rotate(8 31 50)" fill="#34A853"/><path d="M31 50 C24 40 25 28 31 17 C37 28 37 40 31 50 Z" transform="rotate(30 31 50)" fill="#7CB342"/>';
const icon = (round) => `<html><body style="margin:0;background:transparent"><svg width="512" height="512" viewBox="0 0 512 512">
 ${round ? '<circle cx="256" cy="256" r="256" fill="#053B23"/>' : '<rect width="512" height="512" rx="104" fill="#053B23"/>'}
 <circle cx="256" cy="232" r="150" fill="#fff"/>
 <g transform="translate(256 232) scale(4.4) translate(-32 -32)">${MARK}</g>
 <text x="256" y="452" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="62" fill="#8DC556" letter-spacing="2">AFLP</text>
</svg></body></html>`;
const splash = `<html><body style="margin:0;background:transparent"><svg width="720" height="560" viewBox="0 0 720 560">
 <circle cx="360" cy="170" r="140" fill="#fff"/>
 <g transform="translate(360 170) scale(4.1) translate(-32 -32)">${MARK}</g>
 <text x="360" y="400" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="50" fill="#fff">ANAGROCI FIELD BUYING</text>
 <text x="360" y="455" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="600" font-size="30" fill="#BFF0CF" letter-spacing="1">AFLP 2027 | Field Operations</text>
</svg></body></html>`;
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const b = await chromium.launch();
async function shot(html, w, h, scale, file) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await p.setContent(html); mkdirSync(dirname(file), { recursive: true });
  await p.locator('svg').screenshot({ path: file, omitBackground: true }); await p.close();
}
for (const [d, px] of Object.entries(sizes)) {
  await shot(icon(false), 512, 512, px / 512, join(RES, `mipmap-${d}`, 'ic_launcher.png'));
}
await shot(splash, 720, 560, 1, join(RES, 'drawable-xxhdpi', 'splash_logo.png'));
await shot(icon(false), 512, 512, 1, join(dirname(RES), '..', '..', '..', 'store', 'icon-512.png'));
await b.close();
console.log('Icônes générées dans', RES);

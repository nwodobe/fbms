#!/usr/bin/env node
/* ============================================================================
 * FBMS — Vérificateur de liens internes (sans dépendance : fetch natif Node).
 * Bloque si un lien MÊME ORIGINE renvoie >= 400 (404 interne). Les liens
 * externes (autres hôtes) sont seulement signalés, jamais bloquants.
 *
 * Usage : node link-check.mjs http://localhost:8080/index.html
 * ==========================================================================*/
const base = process.argv[2];
if (!base) { console.error('Usage: node link-check.mjs <url>'); process.exit(2); }

const origin = new URL(base).origin;
const seen = new Set();
const broken = [];
const external = [];

async function collectLinks(url) {
  const res = await fetch(url);
  if (!res.ok) return [];
  let html = await res.text();
  // Ne pas extraire depuis le code JS/CSS : les gabarits (ex. src="${m.photo}")
  // ne sont pas des liens réels. On retire <script> et <style> avant analyse.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const out = [];
  const re = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') ||
        raw.startsWith('tel:') || raw.startsWith('data:') ||
        raw.startsWith('javascript:')) continue;
    // Ignorer les gabarits non résolus et les valeurs manifestement non-URL.
    if (/[${}<>\s]/.test(raw) || raw.includes('{{')) continue;
    try { out.push(new URL(raw, url).toString()); } catch { /* ignore */ }
  }
  return out;
}

async function check(url) {
  try {
    let res = await fetch(url, { method: 'HEAD' });
    if (res.status === 405 || res.status === 501) res = await fetch(url, { method: 'GET' });
    return res.status;
  } catch (e) { return 0; }
}

const links = await collectLinks(base);
for (const link of links) {
  if (seen.has(link)) continue;
  seen.add(link);
  if (new URL(link).origin !== origin) { external.push(link); continue; }
  const status = await check(link);
  const label = link.replace(origin, '');
  if (status >= 400 || status === 0) broken.push(`${status || 'ERR'}  ${label}`);
  else console.log(`ok   ${status}  ${label}`);
}

if (external.length) {
  console.log(`\nLiens externes (non bloquants) : ${external.length}`);
  external.forEach(l => console.log(`ext       ${l}`));
}
if (broken.length) {
  console.error(`\n❌ Liens internes cassés : ${broken.length}`);
  broken.forEach(b => console.error(`   ${b}`));
  process.exit(1);
}
console.log(`\n✅ Aucun lien interne cassé (${seen.size} liens même origine vérifiés).`);

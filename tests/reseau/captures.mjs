#!/usr/bin/env node
/**
 * Captures d'écran du module Réseau à 360 px (largeur CSS d'un téléphone d'entrée de gamme
 * type itel S688LN), profil Unit Head FICTIF. Même script avant et après correctif :
 *   RESEAU_CAPTURES=<dossier> node tests/reseau/captures.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { servir, ouvrir, passerHorsLigne, PROFILS } from './banc.mjs';

const DOSSIER = process.env.RESEAU_CAPTURES;
if (!DOSSIER) throw new Error('RESEAU_CAPTURES non défini');
mkdirSync(DOSSIER, { recursive: true });
const PORT = Number(process.env.PORT_FBMS ?? 4352);
const notes = [];
const cap = async (page, nom, plein = false) => { await page.screenshot({ path: join(DOSSIER, nom + '.png'), fullPage: plein }); };

const serveur = servir();
await new Promise((r) => serveur.listen(PORT, r));
const nav = await chromium.launch();
try {
  let { contexte, page } = await ouvrir(nav, { port: PORT, profil: PROFILS.UH_BOTRO, hash: '#census' });
  await page.waitForTimeout(1200);
  await cap(page, '01-recensement-haut');

  /* Menu Réseau : on suit le lien « Représentants RT » tel que le menu le définit. */
  const lienRt = await page.evaluate(() => { const a = [...document.querySelectorAll('a')].find((x) => /Représentants RT/.test(x.textContent)); return a ? a.getAttribute('href') : null; });
  const lienV = await page.evaluate(() => { const a = [...document.querySelectorAll('a')].find((x) => /Villages & clusters/.test(x.textContent)); return a ? a.getAttribute('href') : null; });
  notes.push('menu Représentants RT -> ' + lienRt, 'menu Villages & clusters -> ' + lienV);
  if (lienRt) { await page.goto(new URL(lienRt, page.url()).href); await page.waitForTimeout(1500); }
  await cap(page, '02-menu-representants-rt');
  notes.push('onglet actif après « Représentants RT » : ' + await page.evaluate(() => { const b = document.querySelector('#opsRouteView .ops-actions .btn.primary'); return b ? b.textContent : '?'; }));

  /* Recherche d'un village à apostrophe saisi sans apostrophe. */
  await page.goto(page.url().replace(/#.*$/, '#rt/villages')); await page.waitForTimeout(1200);
  const champ = await page.$('#rtQ, #rsQ');
  if (champ) { await champ.fill('nguessankro'); await page.waitForTimeout(600); }
  await cap(page, '03-recherche-nguessankro', true);
  notes.push('résultats « nguessankro » : ' + await page.evaluate(() => (document.getElementById('rtBody') || document.getElementById('rsBody') || document.body).innerText.slice(0, 200).replace(/\s+/g, ' ')));

  /* Hors ligne : « + Nouveau village ». */
  await page.goto(page.url().replace(/#.*$/, '#census')); await page.waitForTimeout(2500);
  await passerHorsLigne(contexte, page);
  await page.waitForTimeout(800);
  notes.push('voile auth hors ligne : ' + await page.evaluate(() => { const g = document.getElementById('anagroci-authgate'); return g ? (getComputedStyle(g).display + ' ' + g.innerText.slice(0, 80).replace(/s+/g, ' ')) : 'absent'; })); await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Nouveau village/.test(b.textContent)).click());
  await page.waitForTimeout(5000);
  await cap(page, '04-hors-ligne-nouveau-village');
  notes.push('hors ligne, Nouveau village : ' + await page.evaluate(() => (document.getElementById('fbFormHost') || {}).innerText || '').then((t) => t.slice(0, 160).replace(/\s+/g, ' ')));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Nouveau RT/.test(b.textContent)).click());
  await page.waitForTimeout(2500);
  await cap(page, '05-hors-ligne-nouveau-rt');
  notes.push('hors ligne, Nouveau RT : ' + await page.evaluate(() => (document.getElementById('fbFormHost') || {}).innerText || '').then((t) => t.slice(0, 200).replace(/\s+/g, ' ')));
  /* Carte des villages hors ligne, puis en ligne avec recherche. */
  await page.goto(page.url().replace(/#.*$/, '#hubs')); await page.waitForTimeout(2500);
  await cap(page, '06-hors-ligne-carte-villages');
  notes.push('hors ligne, carte : ' + await page.evaluate(() => document.querySelectorAll('#fbMap [data-village]').length + ' éléments de village'));
  await contexte.close();
  ({ contexte, page } = await ouvrir(nav, { port: PORT, profil: PROFILS.UH_BOTRO, hash: '#rt/recherche' }));
  await page.waitForTimeout(800);
  await cap(page, '07-recherche-accueil');
  if (await page.$('#rsQ')) {
    await page.fill('#rsQ', 'konankro'); await page.waitForTimeout(600);
    await page.evaluate(() => document.getElementById('rsRes').scrollIntoView()); await page.waitForTimeout(200);
    await cap(page, '08-recherche-homonymes');
    await page.fill('#rsQ', ''); await page.click('[data-rs-cluster="BOTRO"]'); await page.waitForTimeout(400);
    await page.selectOption('#rsVillage', 'v_hom_1'); await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('rsActifs').scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
    await cap(page, '09-filtres-combines');
  }
  await page.goto(page.url().replace(/#.*$/, '#hubs')); await page.waitForTimeout(2500);
  await cap(page, '10-carte-villages-en-ligne');
  await contexte.close();
} finally {
  await nav.close(); serveur.close();
}
console.log(notes.join('\n'));

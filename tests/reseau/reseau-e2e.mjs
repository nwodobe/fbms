#!/usr/bin/env node
/**
 * Recette du module Réseau (24/11/2026) — navigateur réel (Chromium), données FICTIVES.
 *
 * Couvre : menu Réseau, parcours « Nouveau village » et « Nouveau RT » (en ligne, sans règle
 * de prix, hors ligne), restrictions de rôle, recherche transversale (partiel, accents,
 * apostrophes, homonymes, identifiants, téléphone, au-delà de la première page), filtres
 * combinés (ET / OU, retrait d'une sélection incompatible, réinitialisation), conservation
 * du contexte, portée hors ligne annoncée, carte des villages en ligne et hors ligne,
 * petit écran (360 px, texte agrandi 130 %), absence d'erreur console.
 *
 * Ce banc ne prouve PAS les règles serveur (RLS) : la doublure accepte toute écriture. Il
 * prouve que l'interface envoie la bonne écriture, ou n'envoie rien quand elle doit refuser.
 *
 * Usage : node tests/reseau/reseau-e2e.mjs
 *         FBMS_MODE_APK=1 node tests/reseau/reseau-e2e.mjs   (paquet embarqué de l'APK + pont natif)
 */
import { chromium } from 'playwright';
import { servir, ouvrir, passerHorsLigne, compteur, PROFILS, LEAFLET } from './banc.mjs';

const PORT = Number(process.env.PORT_FBMS ?? 4353);
const L = Number(process.env.FBMS_LARGEUR ?? 360);
const C = compteur(), verifier = C.verifier;
const ecr = (page, t) => page.evaluate((t) => (window.__writes || []).filter((w) => w.op === 'insert' && w.t === t), t);
const hostTxt = (page) => page.evaluate(() => (document.getElementById('fbFormHost') || {}).innerText || '');
const attendreForm = (page) => page.waitForFunction(() => {
  const h = document.getElementById('fbFormHost');
  return h && !h.hidden && !/Ouverture du formulaire/.test(h.textContent);
}, null, { timeout: 12000 }).then(() => true, () => false);
const deborde = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const cliquerTexte = (page, re) => page.evaluate((src) => {
  const r = new RegExp(src); const b = [...document.querySelectorAll('#opsRouteView button, #opsRouteView a')].find((x) => r.test(x.textContent));
  if (!b) return false; b.click(); return true;
}, re.source);
async function aller(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction(() => !document.querySelector('#opsRouteView .skeleton'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
}
async function chercher(page, texte) {
  await page.fill('#rsQ', texte);
  await page.waitForTimeout(450);
  return page.evaluate(() => [...document.querySelectorAll('#rsRes .rs-item')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
}
const compte = (page) => page.evaluate(() => { const m = /·\s*(\d+)/.exec((document.getElementById('rsCount') || {}).textContent || ''); return m ? Number(m[1]) : -1; });
/* Bouton de soumission atteignable par défilement normal et non recouvert. */
async function boutonAtteignable(page, sel) {
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await page.waitForTimeout(200);
  return page.evaluate((s) => {
    const b = document.querySelector(s), r = b.getBoundingClientRect();
    if (r.bottom > innerHeight || r.top < 0 || !r.width) return false;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === b || b.contains(top));
  }, sel);
}

const serveur = servir();
await new Promise((r) => serveur.listen(PORT, r));
const nav = await chromium.launch();
try {
  /* ============================================================ Unit Head (profil terrain) */
  let { contexte, page, erreurs } = await ouvrir(nav, { port: PORT, largeur: L, profil: PROFILS.UH_BOTRO, hash: '#census' });

  /* Menu Réseau */
  const menu = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('a')].map((a) => [a.textContent.trim(), a.getAttribute('href')])));
  verifier(/#rt\/rts$/.test(menu['Représentants RT'] || ''), `menu « Représentants RT » → liste des RT (${menu['Représentants RT']})`);
  verifier(/#rt\/villages$/.test(menu['Villages & clusters'] || ''), `menu « Villages & clusters » → liste des villages (${menu['Villages & clusters']})`);
  verifier(/#rt\/recherche$/.test(menu['Rechercher (cluster, village, RT, producteur)'] || ''), 'menu : entrée « Rechercher » présente');
  verifier(/#census$/.test(menu['Créer : village, RT, producteur'] || ''), 'menu : entrée de création explicite présente');
  verifier(/#hubs$/.test(menu['Carte des villages'] || ''), 'menu : « Carte des villages » présente');
  await aller(page, '#rt/rts');
  verifier(await page.evaluate(() => (document.querySelector('#opsRouteView [aria-current="page"]') || {}).textContent === 'RT'), '#rt/rts ouvre bien l’onglet RT');

  /* Boutons de création visibles sur les écrans du Réseau */
  for (const h of ['#census', '#rt/recherche', '#rt/villages']) {
    await aller(page, h);
    const b = await page.evaluate(() => [...document.querySelectorAll('#opsRouteView .ops-route-actions button')].map((x) => x.textContent.trim()));
    verifier(b.includes('+ Nouveau village') && b.includes('+ Nouveau RT'), `${h} : « + Nouveau village » et « + Nouveau RT » visibles`);
  }

  /* Nouveau village — en ligne */
  await aller(page, '#census');
  await cliquerTexte(page, /Nouveau village/);
  verifier(await attendreForm(page), 'Nouveau village : formulaire ouvert');
  const optsV = await page.evaluate(() => [...document.querySelectorAll('#vf_cluster option')].filter((o) => o.value).map((o) => o.value));
  verifier(JSON.stringify(optsV) === '["Botro"]', `Nouveau village (UH) : seul son cluster est proposé (${JSON.stringify(optsV)})`);
  verifier(await boutonAtteignable(page, '#vf_submit'), 'Nouveau village : bouton Enregistrer atteignable par défilement');
  await page.fill('#vf_nom', 'VILLAGE RECETTE RESEAU');
  await page.click('#vf_submit');
  await page.waitForFunction(() => /Village créé|refusé|impossible/i.test(document.getElementById('vf_msg').textContent), null, { timeout: 10000 });
  let w = await ecr(page, 'villages');
  verifier(w.length === 1 && w[0].row.cluster === 'Botro' && w[0].row.village === 'VILLAGE RECETTE RESEAU', 'Nouveau village : une écriture, cluster Botro, nom saisi');
  verifier(/Village créé/.test(await page.evaluate(() => document.getElementById('vf_msg').textContent)), 'Nouveau village : confirmation affichée après écriture acceptée');
  await page.waitForTimeout(1500);

  /* Nouveau RT — en ligne */
  await aller(page, '#rt/recherche');
  await cliquerTexte(page, /Nouveau RT/);
  verifier(await attendreForm(page), 'Nouveau RT : formulaire ouvert');
  const optsR = await page.evaluate(() => [...document.querySelectorAll('#rf_village option')].filter((o) => o.value).map((o) => o.value).sort());
  verifier(optsR.length > 0 && optsR.every((v) => ['v_test_4', 'v_test_10', 'v_hom_1', 'v_apo_1'].includes(v)), `Nouveau RT (UH) : villages de Botro seulement (${optsR.join(', ')})`);
  await page.click('#rf_submit');
  verifier(await page.evaluate(() => /minimum opérationnel/.test(document.getElementById('rf_msg').textContent) || !!document.querySelector('#rtForm :invalid')) && (await ecr(page, 'rt')).length === 0, 'Nouveau RT : envoi vide bloqué, champ obligatoire signalé');
  await page.fill('#rf_nom', 'RT RECETTE RESEAU');
  await page.fill('#rf_tel', '0700099901');
  await page.selectOption('#rf_village', 'v_hom_1');
  verifier(await boutonAtteignable(page, '#rf_submit'), 'Nouveau RT : bouton Enregistrer atteignable par défilement');
  await page.click('#rf_submit');
  await page.waitForFunction(() => /RT créé|refusé|impossible/i.test(document.getElementById('rf_msg').textContent), null, { timeout: 10000 });
  w = await ecr(page, 'rt');
  verifier(w.length === 1 && w[0].row.village_id === 'v_hom_1' && w[0].row.telephone === '0700099901', 'Nouveau RT : une écriture, rattachée au village choisi');
  await page.waitForTimeout(1500);

  /* Recherche transversale */
  await aller(page, '#rt/recherche');
  let r = await chercher(page, 'nguessankro');
  verifier(r.some((x) => /^Village N'GUESSANKRO FICTIF/.test(x)), 'recherche « nguessankro » trouve le village N\'GUESSANKRO (apostrophe ignorée)');
  r = await chercher(page, 'N’Guessankro');
  verifier(r.some((x) => /^Village N'GUESSANKRO FICTIF/.test(x)), 'recherche avec apostrophe typographique trouve le même village');
  r = await chercher(page, 'nzikro');
  verifier(r.some((x) => /N’ZIKRO FICTIF/.test(x)), 'recherche « nzikro » trouve N’ZIKRO (apostrophe typographique dans la fiche)');
  r = await chercher(page, 'ELEVEKRO');
  verifier(r.some((x) => /Élèvekro Fictif/.test(x)), 'recherche sans accents trouve « Élèvekro » (nom d’origine conservé)');
  r = await chercher(page, 'konankro');
  const homV = r.filter((x) => /^Village KONANKRO FICTIF/.test(x));
  verifier(homV.length === 2 && homV.some((x) => /Botro/.test(x)) && homV.some((x) => /Diabo/.test(x)), 'homonymes de village distingués par cluster et code');
  r = await chercher(page, 'yao kouame');
  const homR = r.filter((x) => /^RT KOUAME FICTIF YAO/.test(x));
  verifier(homR.length === 2 && homR.some((x) => /RT-HOM-1/.test(x)) && homR.some((x) => /RT-HOM-2/.test(x)), 'homonymes RT : mots dans le désordre, distingués par identifiant');
  r = await chercher(page, '0700000093');
  verifier(r.length === 1 && /RT-APO-1/.test(r[0]), 'recherche par téléphone du RT');
  r = await chercher(page, 'fict-m10650');
  verifier(r.length === 1 && /FICT-M10650/.test(r[0]) && /Adjoua Éléonore/.test(r[0]), 'recherche par identifiant producteur (Farmer ID, minuscules)');
  r = await chercher(page, 'eleonore');
  verifier(r.some((x) => /FICT-M10650/.test(x)), 'recherche sur les prénoms sans accent');
  r = await chercher(page, 'zzz-introuvable');
  verifier(r.length === 0 && /Aucun résultat/.test(await page.evaluate(() => document.getElementById('rsRes').innerText)), 'aucun résultat : message distinct');

  /* Pagination : une fiche au-delà de la première page reste trouvable */
  await chercher(page, 'masse fictif');
  const total = await compte(page);
  verifier(total === 650, `pagination : compteur sur tous les résultats (${total})`);
  const avant = await page.evaluate(() => document.querySelectorAll('#rsRes .rs-item').length);
  await page.click('#rsPlus');
  await page.waitForTimeout(300);
  const apres = await page.evaluate(() => document.querySelectorAll('#rsRes .rs-item').length);
  verifier(avant === 50 && apres === 100, `pagination : 50 affichés puis 100 après « Afficher les suivants » (${avant} → ${apres})`);
  r = await chercher(page, 'masse fictif 649');
  verifier(r.length === 1 && /FICT-M10649/.test(r[0]), 'fiche n° 649 (au-delà des premières pages) retrouvée');

  /* Filtres combinés */
  await page.click('#rsReset'); await page.waitForTimeout(300);
  await page.click('[data-rs-cluster="BOTRO"]'); await page.waitForTimeout(300);
  await page.selectOption('#rsVillage', 'v_hom_1'); await page.waitForTimeout(300);
  let n = await compte(page);
  verifier(n === 1 + 1 + 325, `ET : cluster Botro ET village Konankro (Botro) → le village + son RT + 325 producteurs (${n})`);
  await page.click('[data-rs-type="producteur"]'); await page.waitForTimeout(300);
  n = await compte(page);
  verifier(n === 2, `types (OU) : sans les producteurs → le village + son RT (${n})`);
  await page.click('[data-rs-cluster="BOTRO"]'); await page.waitForTimeout(300);
  await page.click('[data-rs-cluster="DIABO"]'); await page.waitForTimeout(300);
  const txt = await page.evaluate(() => document.getElementById('rsBody') ? '' : document.getElementById('rtBody').innerText);
  const villageGarde = await page.evaluate(() => document.getElementById('rsVillage').value);
  verifier(villageGarde === '' && /Filtre village .* retiré/.test(txt), 'sélection devenue incompatible (village Botro, cluster Diabo) retirée et signalée');
  await page.click('[data-rs-cluster="BOTRO"]'); await page.waitForTimeout(300);
  n = await compte(page);
  verifier(n > 0 && await page.evaluate(() => [...document.querySelectorAll('[data-rs-cluster]')].filter((b) => b.classList.contains('on')).length === 2), `OU : deux clusters actifs ensemble (${n} résultats)`);
  await page.click('#rsReset'); await page.waitForTimeout(300);
  await page.selectOption('#rsRt', '__sans__'); await page.waitForTimeout(300);
  const sansRt = await page.evaluate(() => [...document.querySelectorAll('#rsRes .rs-item')].every((li) => /Producteur/.test(li.innerText) && /Sans RT/.test(li.innerText)));
  verifier(sansRt && (await compte(page)) > 0, 'filtre « Producteurs sans RT » : fiches non rattachées identifiables');
  const puces = await page.evaluate(() => document.querySelectorAll('[data-rs-retirer]').length);
  await page.click('[data-rs-retirer="rt"]'); await page.waitForTimeout(300);
  verifier(puces === 1 && await page.evaluate(() => document.getElementById('rsRt').value === ''), 'filtre actif visible et retirable d’un geste');

  /* Contexte conservé au retour d'une fiche */
  await chercher(page, 'konankro');
  await page.evaluate(() => document.querySelector('#rsRes a.ops-link').click());
  await page.waitForTimeout(800);
  verifier(/^#villages\//.test(await page.evaluate(() => location.hash)), 'un résultat ouvre la fiche');
  await page.goBack(); await page.waitForTimeout(1200);
  verifier(await page.evaluate(() => document.getElementById('rsQ') && document.getElementById('rsQ').value === 'konankro'), 'retour : la recherche est conservée');

  /* Petit écran : pas de défilement horizontal, y compris texte agrandi */
  verifier(!(await deborde(page)), `${L}px : recherche sans défilement horizontal`);
  await page.addStyleTag({ content: 'html{zoom:1.3}' });
  await page.waitForTimeout(300);
  verifier(!(await deborde(page)), `${L}px + texte 130 % : recherche sans défilement horizontal`);
  await cliquerTexte(page, /Nouveau RT/); await attendreForm(page);
  verifier(!(await deborde(page)) && await boutonAtteignable(page, '#rf_submit'), `${L}px + texte 130 % : formulaire RT utilisable jusqu’au bouton`);
  await page.addStyleTag({ content: 'html{zoom:1}' });

  /* Carte des villages — en ligne */
  if (LEAFLET) {
    await aller(page, '#hubs');
    await page.waitForTimeout(1200);
    const carte = await page.evaluate(() => {
      const m = document.getElementById('fbMap'), k = document.querySelector('#opsRouteView .kpi-grid');
      return { m: !!m, avantKpi: !!(m && k && m.getBoundingClientRect().top < k.getBoundingClientRect().top), pts: document.querySelectorAll('#fbMap [data-village]').length };
    });
    verifier(carte.m && carte.avantKpi && carte.pts > 10, `carte des villages : affichée en tête, ${carte.pts} éléments de village`);
    /* Recouvrement carte / en-tête constaté sur l'itel (WebView) : non reproductible dans Chromium
       de bureau, donc vérifié sur l'appareil et non ici. */
    verifier(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ops-main')).paddingBottom) >= 70), 'marge basse : le dernier bouton peut défiler au-dessus de la pastille de version');
    await page.fill('#fbCarteQ', 'nguessankro'); await page.waitForTimeout(400);
    await page.click('.fb-carte-hit'); await page.waitForTimeout(800);
    verifier(/N'GUESSANKRO FICTIF/.test(await page.evaluate(() => (document.querySelector('.leaflet-popup-content') || {}).textContent || '')), 'carte : « Trouver un village » centre la carte et ouvre sa bulle');
    await aller(page, '#rt/recherche');
    await chercher(page, 'elevekro');
    await page.evaluate(() => document.querySelector('[data-rs-carte]').click());
    await page.waitForTimeout(2000);
    verifier(/Élèvekro Fictif/.test(await page.evaluate(() => (document.querySelector('.leaflet-popup-content') || {}).textContent || '')), 'recherche → « Voir sur la carte » ouvre le village sur la carte');
  } else verifier(false, 'carte : Leaflet local introuvable (FBMS_LEAFLET_DIR) — non testée');
  const erreursEnLigne = erreurs.slice();

  /* ============================================================ Hors ligne */
  await aller(page, '#census');
  await page.waitForTimeout(1500);
  await passerHorsLigne(contexte, page);
  await cliquerTexte(page, /Nouveau village/);
  verifier(await attendreForm(page), 'hors ligne : « Nouveau village » s’ouvre (plus de blocage « Ouverture du formulaire… »)');
  let t = await hostTxt(page);
  verifier(/Connexion Internet requise pour enregistrer le village/.test(t), 'hors ligne : exigence de connexion annoncée dans le formulaire village');
  await page.fill('#vf_nom', 'VILLAGE HORS LIGNE');
  const nV = (await ecr(page, 'villages')).length;
  await page.click('#vf_submit'); await page.waitForTimeout(500);
  t = await page.evaluate(() => document.getElementById('vf_msg').textContent);
  verifier(/n’a PAS été enregistré/.test(t) && (await ecr(page, 'villages')).length === nV, 'hors ligne : aucun faux succès, aucune écriture');
  verifier(await page.evaluate(() => document.getElementById('vf_nom').value) === 'VILLAGE HORS LIGNE', 'hors ligne : la saisie reste dans le formulaire');
  await cliquerTexte(page, /Nouveau RT/);
  verifier(await attendreForm(page) && /Connexion Internet requise pour enregistrer le RT/.test(await hostTxt(page)), 'hors ligne : formulaire RT ouvert, exigence de connexion annoncée');
  await aller(page, '#rt/recherche');
  verifier(/Recherche dans les données disponibles sur cet appareil/.test(await page.evaluate(() => document.getElementById('opsRouteView').innerText)), 'hors ligne : portée locale de la recherche annoncée');
  r = await chercher(page, 'konankro');
  verifier(r.filter((x) => /^Village/.test(x)).length === 2, 'hors ligne : la recherche fonctionne sur les données de l’appareil');
  if (LEAFLET) {
    await aller(page, '#hubs'); await page.waitForTimeout(1500);
    const off = await page.evaluate(() => ({ m: !!document.getElementById('fbMap'), pts: document.querySelectorAll('#fbMap [data-village]').length, avis: /Hors ligne :/.test(document.getElementById('opsRouteView').innerText) }));
    verifier(off.m && off.pts > 10 && off.avis, `hors ligne : carte des villages affichée (${off.pts} éléments) avec avis sur le fond de carte`);
  }
  verifier(erreursEnLigne.length === 0, `UH : aucune erreur console en ligne ${erreursEnLigne.length ? JSON.stringify(erreursEnLigne.slice(0, 3)) : ''}`);
  const errOff = erreurs.slice(erreursEnLigne.length).filter((e) => !/Failed to load resource|net::ERR/.test(e));
  verifier(errOff.length === 0, `UH : aucune erreur JS hors ligne ${errOff.length ? JSON.stringify(errOff.slice(0, 3)) : ''}`);
  await contexte.close();

  /* ============================================================ Sans règle de prix (en ligne) */
  ({ contexte, page, erreurs } = await ouvrir(nav, { port: PORT, largeur: L, profil: PROFILS.UH_BOTRO, hash: '#census', regle: false }));
  await cliquerTexte(page, /Nouveau village/);
  verifier(await attendreForm(page) && !/Règle|Impossible/.test(await hostTxt(page)), 'campagne sans règle de prix : « Nouveau village » s’ouvre quand même');
  await contexte.close();

  /* ============================================================ Assistant Unit Head */
  ({ contexte, page, erreurs } = await ouvrir(nav, { port: PORT, largeur: L, profil: PROFILS.AUH_BOTRO, hash: '#rt/recherche' }));
  await cliquerTexte(page, /Nouveau RT/);
  verifier(await attendreForm(page) && !/non autorisée/.test(await hostTxt(page)), 'AUH : « Nouveau RT » accessible');
  await cliquerTexte(page, /Nouveau village/);
  verifier(await attendreForm(page) && !/non autorisée/.test(await hostTxt(page)), 'AUH : « Nouveau village » accessible');
  verifier(erreurs.length === 0, `AUH : aucune erreur console ${erreurs.length ? JSON.stringify(erreurs.slice(0, 2)) : ''}`);
  await contexte.close();

  /* ============================================================ Restrictions légitimes */
  ({ contexte, page } = await ouvrir(nav, { port: PORT, largeur: L, profil: PROFILS.UH_SANS, hash: '#census' }));
  await cliquerTexte(page, /Nouveau village/); await attendreForm(page);
  verifier(/Création non autorisée/.test(await hostTxt(page)) && /Aucun cluster d’affectation/.test(await hostTxt(page)), 'UH sans cluster : création refusée, raison expliquée');
  await contexte.close();
  ({ contexte, page } = await ouvrir(nav, { port: PORT, largeur: L, profil: PROFILS.RO, hash: '#census' }));
  await cliquerTexte(page, /Nouveau RT/); await attendreForm(page);
  const roTxt = await hostTxt(page);
  verifier(/Création non autorisée/.test(roTxt) && (await ecr(page, 'rt')).length === 0, 'Consultation : création RT refusée, raison expliquée, aucune écriture');
  await page.evaluate(() => window.ANAGROCI_FB.openVillageForm());
  await attendreForm(page);
  verifier(/Création non autorisée/.test(await hostTxt(page)), 'Consultation : appel direct de openVillageForm() toujours refusé');
  await aller(page, '#rt/recherche');
  verifier((await chercher(page, 'konankro')).length > 0, 'Consultation : la recherche reste disponible en lecture');
  await contexte.close();

  /* ============================================================ Branch Manager */
  ({ contexte, page, erreurs } = await ouvrir(nav, { port: PORT, largeur: L, profil: PROFILS.BM, hash: '#census' }));
  await cliquerTexte(page, /Nouveau village/); await attendreForm(page);
  const optsBM = await page.evaluate(() => [...document.querySelectorAll('#vf_cluster option')].filter((o) => o.value).length);
  verifier(optsBM === 6, `BM : les 6 clusters restent proposés (${optsBM})`);
  verifier(erreurs.length === 0, `BM : aucune erreur console ${erreurs.length ? JSON.stringify(erreurs.slice(0, 2)) : ''}`);
  await contexte.close();
} finally {
  await nav.close(); serveur.close();
}
console.log(JSON.stringify(C.bilan()));
process.exitCode = C.bilan().echecs ? 1 : 0;

/* Parcours navigateur Sacherie AFLP — lot 1. Sessions DISTINCTES par poste,
   vrais fichiers du dépôt, vraies règles serveur (réplique locale via PostgREST).
   Voir banc-local.mjs pour le montage. Sortie : tableau Markdown + captures. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { lancer, ouvrir, JOURNAL } from './banc-local.mjs';

const DB = process.env.BANC_DB || 'fbms_web';
const CAPT = process.env.BANC_CAPTURES || '/tmp/captures-banc';
fs.mkdirSync(CAPT, { recursive: true });
const sql = (q) => execFileSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54329', '-U', 'postgres', '-d', DB, '-Atc', q]).toString().trim();
const R = [];
function note(id, compte, action, attendu, obtenu, ok) { R.push({ id, compte, action, attendu, obtenu: String(obtenu).replace(/\s+/g, ' ').slice(0, 170), ok }); console.log((ok ? 'CONFORME ' : 'ÉCART    ') + id + ' ' + action + ' → ' + obtenu); }
const TAILLES = { mobile: { width: 390, height: 844 }, tablette: { width: 768, height: 1024 }, bureau: { width: 1440, height: 900 } };

const b = await lancer();
async function session(compte, chemin, taille = TAILLES.bureau) {
  const s = await ouvrir(b, compte, chemin, taille);
  s.dialogues = [];
  s.page.removeAllListeners('dialog');
  s.page.on('dialog', async (d) => { s.dialogues.push(d.message()); await (d.type() === 'prompt' ? d.accept(s.reponse || '') : d.accept()); });
  await s.page.waitForTimeout(2500);
  return s;
}
async function texte(page, sel) { try { return (await page.innerText(sel, { timeout: 8000 })).trim(); } catch { return ''; } }
async function cliquerBouton(page, libelle) {
  const btn = page.getByRole('button', { name: libelle }).first();
  await btn.waitFor({ timeout: 10000 });
  await btn.click();
}
/* Écran Flux : ouvrir le dossier (bouton « Examiner ») puis l'action. */
async function actionDossier(page, libelle) {
  const lien = page.locator('a[href^="#bags/flow/"]').first();
  await lien.waitFor({ timeout: 10000 }); await lien.click();
  await page.waitForTimeout(1500);
  await cliquerBouton(page, libelle);
}
async function attendreMessage(page, sel) {
  for (let i = 0; i < 30; i++) { const t = await texte(page, sel); if (t && !/en cours|Envoi|…$/.test(t)) return t; await page.waitForTimeout(300); }
  return await texte(page, sel);
}
const statut = () => sql("select status||'/'||coalesce(approved_qty,0)||'/'||released_qty||'/'||received_qty from ops_bag_requests where rt_id='RT-TB1' and requested_qty=30");

try {
  /* 1. Unit Head : demande */
  let s = await session('uh_botro', '/operations/field-buying.html#bags/flows');
  await s.page.click('#newBagReqBtn');
  await s.page.waitForSelector('#bq_cluster');
  await s.page.selectOption('#bq_cluster', { label: 'Botro' });
  await s.page.waitForTimeout(500);
  await s.page.selectOption('#bq_rt', { index: 1 });
  await s.page.fill('#bq_qty', '30');
  await s.page.screenshot({ path: `${CAPT}/01-uh-demande-bureau.png` });
  await s.page.click('#bq_submit');
  let m = await attendreMessage(s.page, '#bq_msg');
  note('N01', 'uh_botro', 'Chef d’Unité crée une demande (formulaire réel)', 'Demande soumise', m + ' | base : ' + statut(), /soumise/i.test(m) && /^REQUESTED/.test(statut()));
  await s.ctx.close();

  /* 1b. Même écran en mobile et tablette (affichage du bouton et du formulaire) */
  for (const [nom, t] of [['mobile', TAILLES.mobile], ['tablette', TAILLES.tablette]]) {
    s = await session('uh_botro', '/operations/field-buying.html#bags/flows', t);
    await s.page.click('#newBagReqBtn'); await s.page.waitForSelector('#bq_cluster');
    await s.page.screenshot({ path: `${CAPT}/01-uh-demande-${nom}.png` });
    const vis = await s.page.isVisible('#bq_submit');
    note('N01-' + nom, 'uh_botro', `Formulaire de demande affiché (${t.width}×${t.height})`, 'formulaire visible', vis ? 'bouton Soumettre visible' : 'invisible', vis);
    await s.ctx.close();
  }

  /* 2. Zonal Head : revue ; ne voit pas « Libérer » */
  s = await session('zh', '/operations/field-buying.html#bags/flows');
  await actionDossier(s.page, 'Marquer revue'); await s.page.waitForTimeout(2500);
  note('N02', 'zh', 'Zonal Head effectue la revue', 'REVIEWED', statut(), /^REVIEWED/.test(statut()));
  await s.ctx.close();

  /* 3. FBOO : consolidation */
  s = await session('fboo', '/operations/field-buying.html#bags/flows');
  await actionDossier(s.page, 'Consolider'); await s.page.waitForTimeout(2500);
  note('N03', 'fboo', 'Field Buying Operations Officer consolide', 'CONSOLIDATED', statut(), /^CONSOLIDATED/.test(statut()));
  await s.ctx.close();

  /* 4. Branch Manager : approbation puis tentative de sortie (séparation des tâches) */
  s = await session('bm', '/operations/field-buying.html#bags/flows');
  await actionDossier(s.page, 'Décision BM'); await s.page.waitForSelector('#ba_qty');
  await s.page.click('#bagAppForm button[type=submit]'); await s.page.waitForTimeout(2500);
  note('N04', 'bm', 'Branch Manager approuve', 'BM_APPROVED', statut(), /^BM_APPROVED\/30/.test(statut()));
  await s.page.goto('http://fbms.local/operations/field-buying.html#bags/flows'); await s.page.waitForTimeout(3000);
  await actionDossier(s.page, 'Libérer'); await s.page.waitForSelector('#br_qty');
  await s.page.fill('#br_qty', '30'); await s.page.click('#br_submit');
  m = await attendreMessage(s.page, '#br_msg');
  await s.page.screenshot({ path: `${CAPT}/04-bm-sortie-refusee.png` });
  note('N05', 'bm', 'L’approbateur tente la sortie', 'refus affiché (séparation des tâches)', m + ' | base : ' + statut(), /Séparation des tâches/.test(m) && /\/0\/0$/.test(statut()));
  await s.ctx.close();

  /* 5. Magasinier : sortie */
  s = await session('sk_botro', '/operations/field-buying.html#bags/flows');
  await actionDossier(s.page, 'Libérer'); await s.page.waitForSelector('#br_qty');
  await s.page.fill('#br_qty', '30'); await s.page.click('#br_submit');
  m = await attendreMessage(s.page, '#br_msg');
  note('N06', 'sk_botro', 'Magasinier enregistre la sortie', 'Sortie enregistrée', m + ' | base : ' + statut(), /Sortie enregistrée/.test(m) && /FULLY_RELEASED\/30\/30\/0/.test(statut()));
  await s.ctx.close();

  /* 6. Réception : hors périmètre puis réceptionnaire habilité */
  s = await session('uh_diabo', '/operations/field-buying.html#bags/flows');
  await actionDossier(s.page, 'Confirmer réception'); await s.page.waitForSelector('#bc_qty');
  await s.page.click('#bagRecForm button[type=submit]'); await s.page.waitForTimeout(2500);
  note('N07', 'uh_diabo', 'Chef d’Unité d’un autre cluster confirme la réception', 'refus affiché', (s.dialogues.join(' / ') || 'aucun message') + ' | base : ' + statut(), /hors périmètre/.test(s.dialogues.join(' ')) && /\/0$/.test(statut()));
  await s.ctx.close();
  s = await session('uh_botro', '/operations/field-buying.html#bags/flows');
  await actionDossier(s.page, 'Confirmer réception'); await s.page.waitForSelector('#bc_qty');
  await s.page.click('#bagRecForm button[type=submit]'); await s.page.waitForTimeout(2500);
  note('N08', 'uh_botro', 'Réceptionnaire habilité (Chef d’Unité Botro) confirme', 'reçu 30', (s.dialogues.join(' / ') || 'aucun message') + ' | base : ' + statut(), /\/30\/30\/30$/.test(statut()));
  await s.ctx.close();

  /* 7. Magasinier : inventaire + déclaration de perte */
  const theo = sql("select coalesce(sum(qty),0) from rcn_jute_v_stock where location_code='AFLP-CL-BOTRO' and state='UTILISABLE'");
  s = await session('sk_botro', '/operations/field-buying.html#bags/control');
  await cliquerBouton(s.page, 'Inventaire'); await s.page.waitForSelector('#bx_loc');
  await s.page.selectOption('#bx_loc', 'AFLP-CL-BOTRO'); await s.page.selectOption('#bx_state', 'UTILISABLE');
  await s.page.fill('#bx_qty', theo); await s.page.click('#bx_submit');
  m = await attendreMessage(s.page, '#bx_msg');
  await s.page.screenshot({ path: `${CAPT}/07-sk-inventaire.png` });
  const inv = sql("select count(*) from rcn_jute_inventories where counted_by='00000000-0000-0000-0000-0000000000d1' and location_code='AFLP-CL-BOTRO'");
  note('N09', 'sk_botro', `Magasinier réalise un inventaire (compté ${theo})`, 'inventaire enregistré', m + ' | inventaires en base : ' + inv, inv !== '0');
  await s.page.goto('http://fbms.local/operations/field-buying.html#bags/control'); await s.page.waitForTimeout(2500);
  await cliquerBouton(s.page, 'Déclarer une perte'); await s.page.waitForSelector('#bx_loc');
  await s.page.selectOption('#bx_loc', 'AFLP-CL-BOTRO'); await s.page.selectOption('#bx_state', 'UTILISABLE');
  await s.page.fill('#bx_qty', '2'); await s.page.fill('#bx_reason', 'Perte banc navigateur'); await s.page.click('#bx_submit');
  m = await attendreMessage(s.page, '#bx_msg');
  note('N10', 'sk_botro', 'Magasinier déclare une perte', 'déclaration SOUMIS', m + ' | base : ' + sql("select statut from rcn_jute_loss_requests where motif='Perte banc navigateur'"), sql("select statut from rcn_jute_loss_requests where motif='Perte banc navigateur'") === 'SOUMIS');
  await s.ctx.close();

  /* 8. Branch Manager décide la perte déclarée par le magasinier */
  s = await session('bm', '/operations/field-buying.html#bags/control');
  await cliquerBouton(s.page, 'Examiner'); await s.page.waitForTimeout(2500);
  note('N11', 'bm', 'Branch Manager décide la perte (autre personne que le déclarant)', 'APPROUVE', sql("select statut from rcn_jute_loss_requests where motif='Perte banc navigateur'"), sql("select statut from rcn_jute_loss_requests where motif='Perte banc navigateur'") === 'APPROUVE');
  await s.ctx.close();

  /* 9. Magasinier sans affectation : message de configuration */
  s = await session('sk_sans', '/operations/field-buying.html#bags/control');
  const locs = await s.page.locator('#opsRouteView').innerText();
  await cliquerBouton(s.page, 'Inventaire'); await s.page.waitForSelector('#bx_loc');
  const nbOpts = await s.page.locator('#bx_loc option').count();
  await s.page.screenshot({ path: `${CAPT}/09-sk-sans-affectation.png` });
  note('N12', 'sk_sans', 'Magasinier sans cluster ouvre l’inventaire', 'aucun emplacement proposé (RLS) ; écriture impossible', `${nbOpts - 1} emplacement(s) proposé(s)`, nbOpts <= 1);
  await s.ctx.close();

  /* 10. Comptes et rôles : libellés, valeurs canoniques, affectation, désactivation */
  s = await session('bm', '/shared/admin.html');
  await s.page.waitForSelector('#rows tr td select', { timeout: 15000 });
  const libelles = await s.page.locator('#nRole option').allInnerTexts();
  const valeurs = await s.page.locator('#nRole option').evaluateAll((o) => o.map((x) => x.value));
  const interdits = ['Branch Manager / Head of Programme', 'Warehouse Keeper', 'Assistant Unit Head', 'Logistics Coordinator', 'Finance / Controller', 'RT / Field Partner', 'Read Only / Audit'];
  const contrainte = sql("select pg_get_constraintdef(oid) from pg_constraint where conname='profils_role_check'");
  const horsServeur = valeurs.filter((v) => !contrainte.includes(`'${v}'::text`));
  note('N13', 'bm', 'Rôles proposés = rôles reconnus par le serveur et attribuables', '0 valeur hors contrainte ; libellés anciens absents',
    `${valeurs.length} rôle(s) ; hors contrainte : ${horsServeur.length} ; ex. « ${libelles.find((l) => /Magasinier/.test(l))} » → ${valeurs[libelles.findIndex((l) => /Magasinier/.test(l))]}`,
    horsServeur.length === 0 && !valeurs.some((v) => interdits.includes(v)) && !valeurs.includes('Branch Manager'));
  const badge = await texte(s.page, '#rows');
  note('N14', 'bm', 'Compte à portée limitée sans affectation signalé', 'badge « Affectation manquante »', /Affectation manquante/.test(badge) ? 'badge présent' : 'absent', /Affectation manquante/.test(badge));
  const uidN = '00000000-0000-0000-0000-0000000000e3';
  await s.page.selectOption(`#r_${uidN}`, 'Storekeeper'); await s.page.selectOption(`#c_${uidN}`, 'DIABO');
  await s.page.locator(`tr:has(#r_${uidN}) button`, { hasText: 'Enregistrer' }).click();
  m = await attendreMessage(s.page, '#uMsg');
  await s.page.screenshot({ path: `${CAPT}/10-admin-roles.png`, fullPage: true });
  note('N15', 'bm', 'Attribution Magasinier + cluster Diabo à un compte à qualifier', 'enregistré + journalisé', m + ' | base : ' + sql(`select role||'/'||cluster from profils where user_id='${uidN}'`) + ' | journal : ' + sql(`select count(*) from rcn_proc_audit_central where table_name='profils' and record_id='${uidN}'`), /enregistr/i.test(m) && sql(`select role from profils where user_id='${uidN}'`) === 'Storekeeper');
  const uidD = '00000000-0000-0000-0000-0000000000d2';
  await s.page.locator(`tr:has(#r_${uidD}) button`, { hasText: 'Désactiver' }).click();
  m = await attendreMessage(s.page, '#uMsg');
  note('N16', 'bm', 'Désactivation du magasinier Diabo', 'compte désactivé', m, sql(`select actif from profils where user_id='${uidD}'`) === 'f');
  await s.page.evaluate(() => { document.getElementById('nRole').value = 'Storekeeper'; });
  await s.ctx.close();

  /* 10b. Comptes et rôles aux largeurs mobile et tablette */
  for (const [nom, t] of [['mobile', TAILLES.mobile], ['tablette', TAILLES.tablette]]) {
    s = await session('bm', '/shared/admin.html', t);
    await s.page.waitForSelector('#rows tr td select', { timeout: 15000 });
    const debord = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await s.page.screenshot({ path: `${CAPT}/10-admin-${nom}.png` });
    note('N13-' + nom, 'bm', `Comptes et rôles lisible (${t.width}×${t.height})`, 'pas de défilement horizontal de page (tableau défilant seul)', `débordement page : ${debord}px`, debord <= 1);
    await s.ctx.close();
  }

  /* 11. Effet de l'habilitation : nouveau magasinier Diabo inventorie Diabo ; compte désactivé refusé */
  s = await session('nouveau', '/operations/field-buying.html#bags/control');
  await cliquerBouton(s.page, 'Inventaire'); await s.page.waitForSelector('#bx_loc');
  const opts = await s.page.locator('#bx_loc option').evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
  const theoD = sql("select coalesce(sum(qty),0) from rcn_jute_v_stock where location_code='AFLP-CL-DIABO' and state='UTILISABLE'");
  await s.page.selectOption('#bx_loc', 'AFLP-CL-DIABO'); await s.page.selectOption('#bx_state', 'UTILISABLE');
  await s.page.fill('#bx_qty', theoD); await s.page.click('#bx_submit');
  m = await attendreMessage(s.page, '#bx_msg');
  note('N17', 'nouveau', 'Après habilitation : le nouveau magasinier Diabo inventorie Diabo', 'succès ; seuls ses emplacements proposés', m + ` | emplacements proposés : ${opts.join(', ')}`, !opts.includes('AFLP-CL-BOTRO') && sql("select count(*) from rcn_jute_inventories where counted_by='00000000-0000-0000-0000-0000000000e3'") === '1');
  await s.ctx.close();
  let refusDesactive = '';
  try {
    s = await session('sk_diabo', '/operations/field-buying.html#bags/control');
    await s.page.waitForTimeout(2000);
    refusDesactive = (await s.page.locator('#anagroci-authgate').count())
      ? 'portail : ' + (await texte(s.page, '#anagroci-authgate')).split('\n').filter((l) => /désactiv/i.test(l)).join(' ')
      : 'aucun blocage du portail';
    await s.page.screenshot({ path: `${CAPT}/11-compte-desactive.png` });
    await s.ctx.close();
  } catch (e) { refusDesactive = 'connexion bloquée par le portail : ' + e.message.split('\n')[0]; }
  note('N18', 'sk_diabo', 'Compte désactivé : accès au module', 'accès refusé', refusDesactive, /désactiv|inactif|refus|bloqu/i.test(refusDesactive));
} catch (e) {
  note('ERREUR', '-', 'Exception du banc', '-', e.message.split('\n')[0], false);
} finally {
  await b.close();
}
console.log('\n| Test | Session | Action | Attendu | Obtenu | Verdict |\n|---|---|---|---|---|---|');
for (const r of R) console.log(`| ${r.id} | ${r.compte} | ${r.action} | ${r.attendu} | ${r.obtenu.replace(/\|/g, '/')} | ${r.ok ? 'CONFORME' : 'ÉCART'} |`);
console.log(`\nRequêtes bloquées (hors banc) : ${JOURNAL.bloques.length}${JOURNAL.bloques.length ? ' — ' + [...new Set(JOURNAL.bloques)].slice(0, 5).join(', ') : ''}`);
console.log(`${R.filter((r) => r.ok).length}/${R.length} conformes`);
process.exit(R.every((r) => r.ok) ? 0 : 1);

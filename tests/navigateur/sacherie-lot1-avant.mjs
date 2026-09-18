/* Constat navigateur AVANT correction : front de `main` (BANC_RACINE) + réplique
   identique à la production (sans le lot 1). Documente les blocages réels. */
import { lancer, ouvrir } from './banc-local.mjs';
const b = await lancer(); const R = [];
async function essai(id, compte, chemin, action) {
  const { page, ctx } = await ouvrir(b, compte, chemin); const dial = [];
  page.on('dialog', async (d) => { dial.push(d.message()); await d.accept(); });
  await page.waitForTimeout(3000);
  let obtenu; try { obtenu = await action(page, dial); } catch (e) { obtenu = 'exception : ' + e.message.split('\n')[0]; }
  R.push([id, compte, obtenu]); console.log(id, compte, '→', obtenu); await ctx.close();
}
const txt = async (p, s) => (await p.innerText(s).catch(() => '')).replace(/\s+/g, ' ').trim();
await essai('AV1', 'uh_botro', '/operations/field-buying.html#bags/flows', async (p) => { await p.click('#newBagReqBtn'); await p.waitForTimeout(1500); return txt(p, '#fbFormHost'); });
await essai('AV2', 'sk_botro', '/operations/field-buying.html#bags/control', async (p) => { await p.getByRole('button', { name: 'Inventaire' }).first().click(); await p.waitForTimeout(1500); return txt(p, '#fbFormHost'); });
await essai('AV3', 'bm', '/operations/field-buying.html#bags/flows', async (p) => {
  await p.click('#newBagReqBtn'); await p.waitForSelector('#bq_cluster'); await p.selectOption('#bq_cluster', { label: 'Botro' });
  await p.waitForTimeout(500); await p.selectOption('#bq_rt', { index: 1 }); await p.fill('#bq_qty', '30'); await p.click('#bq_submit');
  await p.waitForTimeout(3000); return txt(p, '#bq_msg'); });
await essai('AV4', 'bm', '/shared/admin.html', async (p) => {
  await p.waitForSelector('#rows select', { timeout: 15000 }); const v = await p.locator('#nRole option').allInnerTexts();
  const u = '00000000-0000-0000-0000-0000000000e3';
  await p.locator('tr', { hasText: 'nouveau@test.invalid' }).locator('select').selectOption('Warehouse Keeper');
  await p.waitForTimeout(2000); return `options proposées : ${v.length} ; changement vers « Warehouse Keeper » : ${await txt(p, '#uMsg')}`; });
await b.close();

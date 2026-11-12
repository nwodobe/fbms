// Test navigateur (Chrome) de operations/rt-sop-console.html à 390, 768 et 1440 px.
// Prérequis : npm install --no-save playwright@1.49.1 ; python3 -m http.server 8765 à la racine.
// Le client Supabase est remplacé par fake-supabase.js (résultats de la réplique isolée, aucune donnée réelle).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const fix = readFileSync('./tests/replica-prod/navigateur/fixtures.json','utf8');
const fake = readFileSync('./tests/replica-prod/navigateur/fake-supabase.js','utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args:['--no-sandbox'] });
const out = [];
for (const [w,h] of [[390,844],[768,1024],[1440,900]]) {
  const p = await b.newPage({ viewport:{width:w,height:h} });
  const errors=[]; p.on('pageerror', e=>errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, r=>r.abort());
  await p.route('**/supabase-js@2/**', r=>r.fulfill({contentType:'application/javascript', body:'window.__FIX__='+fix+';\n'+fake}));
  await p.route('**/shared/auth-gate.js*', r=>r.fulfill({contentType:'application/javascript', body:'/* test : portail neutralisé */'}));
  await p.goto('http://127.0.0.1:8765/operations/rt-sop-console.html', {waitUntil:'networkidle'});
  await p.waitForFunction(()=>document.querySelectorAll('#rt option').length>1);
  await p.selectOption('#rt','RT-A1');
  await p.waitForFunction(()=>document.querySelector('#situation table'), null, {timeout:8000}).catch(()=>{});
  const txt = await p.locator('#situation').innerText();
  const overflow = await p.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth + 1);
  await p.screenshot({ path:`/tmp/console-${w}.png`, fullPage:w===390 });
  await p.click('[data-go="zh"]'); const zhVisible = await p.locator('#zhForm').isVisible();
  await p.click('[data-go="wave"]'); const cashVisible = await p.locator('#cashForm').isVisible();
  out.push({largeur:w, erreurs_js:errors, debordement_horizontal:overflow, onglet_zh:zhVisible, form_especes:cashVisible,
    sans_undefined: !/undefined/.test(txt), extrait: txt.split('\n').filter(l=>/Reste à justifier|garde du RT|Sacs vides|Écarts ouverts|Dernier bilan/.test(l))});
  await p.close();
}
await b.close();
console.log(JSON.stringify(out,null,1));

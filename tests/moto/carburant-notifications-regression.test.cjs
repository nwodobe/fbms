/* Non-régression des notifications Carburant & Autonomie.
   Fichier de test sans données de production.
   Exécution : node tests/moto/carburant-notifications-regression.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../../moto/moto-carburant-previsionnel.js');
const NOW = '2026-11-06T14:00:00.000Z';
const L = (statut) => [{ moto_id:'m-1', code:'MOTO-T', statut }];
let n=0;function check(nom,fn){fn();n++;console.log('OK '+n+' '+nom);}
check('Alerte initiale : une seule notification',()=>{
  const r=F.historiserAlertes({},L('RAVITAILLEMENT_A_PLANIFIER'),NOW);
  assert.equal(r.nouvelles.length,1);
  assert.equal(Object.values(r.journal)[0].actif,true);
});
check('Alerte inchangée : ne pas redoubler',()=>{
  const r=F.historiserAlertes({},L('RAVITAILLEMENT_A_PLANIFIER'),NOW);
  const s=F.historiserAlertes(r.journal,L('RAVITAILLEMENT_A_PLANIFIER'),'2026-11-06T14:15:00.000Z');
  assert.equal(s.nouvelles.length,0);
});
check('Retour à normal : fermer l’épisode de l’alerte',()=>{
  const r=F.historiserAlertes({},L('CRITIQUE'),NOW);
  const s=F.historiserAlertes(r.journal,L('NORMAL'),'2026-11-06T14:15:00.000Z');
  assert.equal(Object.values(s.journal)[0].actif,false);
  assert.ok(Object.values(s.journal)[0].resolue);
});
check('Même journée : réapparition du risque = nouvelle notification',()=>{
  const a=F.historiserAlertes({},L('CRITIQUE'),NOW);
  const b=F.historiserAlertes(a.journal,L('NORMAL'),'2026-11-06T14:15:00.000Z');
  const c=F.historiserAlertes(b.journal,L('CRITIQUE'),'2026-11-06T15:00:00.000Z');
  assert.equal(c.nouvelles.length,1);
  assert.equal(Object.values(c.journal)[0].reprises,1);
});
check('Aggravation à critique : notifier un nouvel état',()=>{
  const a=F.historiserAlertes({},L('RAVITAILLEMENT_A_PLANIFIER'),NOW);
  const b=F.historiserAlertes(a.journal,L('CRITIQUE'),'2026-11-06T14:15:00.000Z');
  assert.equal(b.nouvelles.length,1);
  assert.equal(Object.values(b.journal).filter(v=>v.actif).length,1);
});
check('Deux motos : ne pas confondre les épisodes',()=>{
  const a=F.historiserAlertes({},[{moto_id:'a',code:'A',statut:'CRITIQUE'},{moto_id:'b',code:'B',statut:'CRITIQUE'}],NOW);
  assert.equal(a.nouvelles.length,2);
  const b=F.historiserAlertes(a.journal,[{moto_id:'a',code:'A',statut:'NORMAL'},{moto_id:'b',code:'B',statut:'CRITIQUE'}],'2026-11-06T14:15:00.000Z');
  assert.equal(b.nouvelles.length,0);
  assert.equal(Object.values(b.journal).filter(v=>v.actif).length,1);
});
check('Journal isolé par utilisateur : vérification du code de l’interface',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../../moto/moto-app.js'),'utf8');
  const i=app.indexOf('  function carbCleJournal() {');
  const j=app.indexOf('\n  async function majIndicateurCarburant(',i);
  assert.ok(i>0 && j>i,'blocs de code carburant non trouvés');
  const code=app.slice(i,j);
  assert.match(code,/S\.profil\s*&&\s*S\.profil\.user_id/);
  assert.match(code,/CARB_JOURNAL\s*\+\s*':'\s*\+\s*String\(u\)/);
  assert.ok(!/getItem\(CARB_JOURNAL\)/.test(code),'ne doit pas lire le journal global');
  assert.ok(!/setItem\(CARB_JOURNAL,/.test(code),'ne doit pas écrire le journal global');
});
console.log('VALIDÉ : '+n+' tests de non-régression.');

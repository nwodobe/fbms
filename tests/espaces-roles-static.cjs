// Simulation des raccourcis et de la visibilité par rôle (sans navigateur).
const fs=require('fs');const src=fs.readFileSync('operations/espaces.js','utf8');
const accessSrc=fs.readFileSync('shared/aflp-access.js','utf8');
function run(role,hash){
  const els={};const doc={getElementById:id=>els[id]||(els[id]={innerHTML:'',textContent:'',scrollIntoView(){}}),addEventListener(){} };
  const g={document:doc,location:{hash:hash||''},addEventListener(){},scrollTo(){},ANAGROCI_AUTH:{profile:{role},estBM:false}};
  new Function('window','document','location',accessSrc)(g,doc,g.location);
  new Function('window','document','location',src)(g,doc,g.location);
  return {bar:els.espBar.innerHTML,nav:els.espNav.innerHTML,view:els.espView.innerHTML,who:els.espRole?els.espRole.textContent:''};
}
const cases=[['Assistant Unit Head','AUH',['Producteurs','Terrain','Achats']],['Unit Head','UH',['Achats','Contrôles RT','Expédition']],['Zonal Head','ZH',['RT','Contrôles','Rapports']],['BRANCH_MANAGER','BM',['Pilotage','Anomalies','Administration']],['inconnu','RO',['Tableau de bord']]];
let ok=true;
for(const [raw,exp,labels] of cases){const r=run(raw,'#E0');const pass=labels.every(l=>r.bar.includes('>'+l+'<'))&&r.bar.includes('Ma journée');const links=(r.bar.match(/href="#[^"]+"/g)||[]).length;console.log((pass&&links===4?'OK ':'KO ')+raw+' → '+r.who+' · raccourcis: '+labels.join(', ')+' · liens='+links);ok=ok&&pass&&links===4;}
// AUH ne voit pas Administration ; BM voit E5.5
const auh=run('Assistant Unit Head','#E5');console.log((auh.view.includes('admin.html')?'KO':'OK')+' AUH : Pilotage limité à la synchronisation de son appareil, pas d’Administration');
const bm=run('BRANCH_MANAGER','#E5-E5-5');console.log((bm.view.includes('../shared/admin.html')?'OK':'KO')+' BM voit Utilisateurs & rôles');
const fin=run('Finance / Controller','#E3');console.log('Finance → '+fin.who+' ; E3 cartes : '+((fin.view.match(/<h2>/g)||[]).length));
process.exit(ok?0:1);

/* Tests de calcul hors production : node tests/moto/carburant-previsionnel.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const F = require('../../moto/moto-carburant-previsionnel.js');
const now = '2026-11-06T12:00:00.000Z';
const moto = {capacite_l:12,capacite_verifiee:true,stock_initial_l:10,stock_initial_verifie:true,compteur_initial_km:10,compteur_actuel_km:10};
const mission = (id,h,km,status='PLANIFIEE',distance_fiable=true) => ({id,depart_at:new Date(Date.parse(now)+h*3600000).toISOString(),distance_km:km,statut:status,distance_fiable});
const base = {maintenant:now,moto,achats:[],planning_complet:true,missions:[mission('a',2,60),mission('b',26,60)],historique_fiable:true,km_jour_historique:60};
let n=0;
function test(nom,fonction){fonction(); n++; console.log('OK '+String(n).padStart(2,'0')+' '+nom);}
test('paramètres 4 L et 10 % = 4,4 L/100',()=>assert.equal(F.parametres().conso_prudente,4.4));
test('60 km = 2,64 L',()=>assert.equal(F.litresPourKm(60),2.64));
test('seuil 2 jours à 60 km = 5,28 L',()=>{let r=F.prevoir(base);assert.equal(r.besoin_24h_l,2.64);assert.equal(r.stock_securite_l,2.64);assert.equal(r.seuil_alerte_l,5.28);});
test('stock initial non vérifié',()=>assert.equal(F.stockEstime({...moto,stock_initial_verifie:false},[]).litres,null));
test('capacité non vérifiée',()=>assert.equal(F.prevoir({...base,moto:{...moto,capacite_verifiee:false}}).statut,'DONNEES_INSUFFISANTES'));
test('60 km consommés sur compteur',()=>assert.equal(F.stockEstime({...moto,compteur_actuel_km:70},[]).litres,7.36));
test('alerte avant réserve',()=>assert.equal(F.prevoir({...base,moto:{...moto,stock_initial_l:4}}).statut,'RAVITAILLEMENT_A_PLANIFIER'));
test('critique au stock de sécurité',()=>assert.equal(F.prevoir({...base,moto:{...moto,stock_initial_l:2.64}}).statut,'CRITIQUE'));
test('plein complet vérifié',()=>assert.equal(F.stockEstime({...moto,compteur_actuel_km:110},[{id:'f',compteur_km:60,litres:6,plein_complet:true,justificatif_statut:'VERIFIE'}]).litres,9.8));
test('plein initial non recompter',()=>assert.equal(F.stockEstime(moto,[{id:'a',compteur_km:10,litres:10,plein_complet:true,justificatif_statut:'VERIFIE'}]).litres,10));
test('plein partiel',()=>assert.equal(F.stockEstime({...moto,compteur_actuel_km:60},[{id:'p',compteur_km:30,litres:1,plein_complet:false,justificatif_statut:'VERIFIE'}]).litres,8.8));
test('achat à vérifier incertain',()=>assert.equal(F.stockEstime({...moto,compteur_actuel_km:60},[{id:'p',compteur_km:30,litres:1,plein_complet:false,justificatif_statut:'A_VERIFIER'}]).fiable,false));
test('mission annulée exclue',()=>assert.equal(F.missionsIntervalle([mission('x',2,100,'ANNULEE'),mission('y',4,40)],Date.parse(now),Date.parse(now)+86400000).km,40));
test('mission dupliquée exclue',()=>assert.equal(F.missionsIntervalle([mission('x',2,40),mission('x',2,40)],Date.parse(now),Date.parse(now)+86400000).km,40));
test('distance absente non calculable',()=>assert.equal(F.prevoir({...base,missions:[mission('a',2,null),mission('b',26,60)]}).besoin_24h_l,null));
test('planning incomplet déclaré',()=>assert.equal(F.prevoir({...base,planning_complet:false,historique_fiable:false,missions:[]}).statut,'DONNEES_INSUFFISANTES'));
test('ravitaillement intermédiaire',()=>assert.equal(F.prevoir({...base,missions:[mission('a',2,250),mission('b',26,60)]}).statut,'CRITIQUE'));
test('aucune dotation exacte sans stock',()=>assert.equal(F.prevoir({...base,moto:{...moto,stock_initial_verifie:false}}).ravitaillement_conseille_l,null));
test('suggestion 1,28 L à 905 FCFA',()=>{let r=F.prevoir({...base,moto:{...moto,stock_initial_l:4}});assert.equal(r.ravitaillement_conseille_l,1.28);assert.equal(r.cout_fcfa,1158);});
test('compteur décroissant',()=>assert.equal(F.stockEstime({...moto,compteur_actuel_km:5},[]).litres,null));
test('valeur négative interdite',()=>assert.throws(()=>F.parametres({base_l100:-1})));

test('scénario BM 15 L, plein complété sans additionner les litres achetés',()=>{
  const x=F.simulerPleinsCompletes({maintenant:now,planning_complet:false,missions:[],
    moto:{compteur_actuel_km:231},achats:[{id:'plein',compteur_km:2,litres:9.95,plein_complet:true,date_achat:'2026-11-04T17:15:19Z',justificatif_statut:'A_VERIFIER'}]});
  assert.equal(x.stock_estime_l,4.924);
  assert.equal(x.autonomie_km,111.9);
  assert.equal(x.fiabilite,'HYPOTHESE_BM_NON_VERIFIEE');
  assert.equal(x.stock_physiquement_verifie,false);
});
test('scénario de plein manquant reste inconnu',()=>{
  const x=F.simulerPleinsCompletes({maintenant:now,moto:{compteur_actuel_km:50},achats:[]});
  assert.equal(x.stock_estime_l,null);
});
test('plein déclaré rejeté ne sert pas de référence',()=>{
  const x=F.simulerPleinsCompletes({maintenant:now,moto:{compteur_actuel_km:50},
    achats:[{id:'x',date_achat:'2026-11-05T12:00:00Z',compteur_km:2,litres:10,plein_complet:true,justificatif_statut:'REJETE'}]});
  assert.equal(x.stock_estime_l,null);
});
test('plein de 15 L à l’origine = 15 L, pas 15 L + achat',()=>{
  const x=F.simulerPleinsCompletes({maintenant:now,moto:{compteur_actuel_km:2},
    achats:[{id:'x',date_achat:'2026-11-05T12:00:00Z',compteur_km:2,litres:12,plein_complet:true,justificatif_statut:'A_VERIFIER'}]});
  assert.equal(x.stock_estime_l,15);
});
test('4 motos du 6 novembre reconstituées sur hypothèse 15 L',()=>{
  const rows=[[231,2,9.95,4.924],[150,5,12.16,8.62],[57,2,11.05,12.58],[84,2,9.95,11.392]];
  for (let i=0;i<rows.length;i++){
    const [courant,k,litres,reste]=rows[i];
    const x=F.simulerPleinsCompletes({maintenant:now,moto:{compteur_actuel_km:courant},
      achats:[{id:'f'+i,date_achat:'2026-11-04T17:15:19Z',compteur_km:k,litres,plein_complet:true,justificatif_statut:'A_VERIFIER'}]});
    assert.equal(x.stock_estime_l,reste);
  }
});

console.log('VALIDÉ : '+n+' tests déterministes.');

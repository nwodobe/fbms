/* AFLP FLEET — calculs prévisionnels carburant, sans accès réseau ni écriture.
 * Prototype de revue humaine : ne modifie pas le paramètre historique 3 L/100 km.
 * Contrat : valeurs manquantes => null, jamais zéro ; aucune dépense créée.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MOTO_CARBURANT_PREVISIONNEL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var REGLAGES = Object.freeze({ base_l100: 4, sensibilite: 0.10, delai_h: 24, prix_fcfa_l: 905 });
  function num(x) { return x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null; }
  function ronde(x, d) { return x == null ? null : Math.round((x + Number.EPSILON) * Math.pow(10,d)) / Math.pow(10,d); }
  function date(x) { var n = x ? Date.parse(x) : NaN; return Number.isFinite(n) ? n : null; }
  function parametres(p) {
    p = Object.assign({}, REGLAGES, p || {});
    for (var k of ['base_l100','sensibilite','delai_h','prix_fcfa_l']) if (num(p[k]) === null || Number(p[k]) < 0) throw new Error('Paramètre invalide : '+k);
    if (p.delai_h <= 0) throw new Error('Délai de ravitaillement invalide');
    p.conso_prudente = num(p.base_l100) * (1 + num(p.sensibilite));
    return p;
  }
  function litresPourKm(km,p) { var n=num(km); return n === null || n<0 ? null : n * parametres(p).conso_prudente / 100; }
  function missionsIntervalle(missions, debut, fin) {
    var vues = new Set(), total = 0, erreurs = [], nb = 0;
    (missions || []).forEach(function(m) {
      if (!m || ['ANNULEE','CLOTUREE','TERMINEE'].includes(String(m.statut||'').toUpperCase())) return;
      var id = m.id == null ? null : String(m.id);
      if (id && vues.has(id)) return;
      if (id) vues.add(id);
      var d=date(m.depart_at || m.date_prevue);
      if (d === null) { erreurs.push('Date de mission absente'); return; }
      if (d < debut || d >= fin) return;
      var k=num(m.distance_km);
      if (k === null || k<0 || m.distance_fiable === false) { erreurs.push('Distance routière non confirmée : '+(id||'mission')); return; }
      nb++; total += k;
    });
    return { km: ronde(total,3), missions: nb, complet: erreurs.length===0, erreurs:erreurs };
  }
  function stockEstime(moto, achats, p) {
    moto=moto||{}; p=parametres(p);
    var cap=num(moto.capacite_l), s=num(moto.stock_initial_l), k=num(moto.compteur_initial_km), actuel=num(moto.compteur_actuel_km);
    var valide=moto.stock_initial_verifie===true && moto.capacite_verifiee===true;
    if (!valide || cap===null || cap<=0 || s===null || k===null || actuel===null) return { litres:null, autonomie_km:null, fiable:false, raison:'STOCK_NON_DETERMINABLE', anomalies:['Capacité ou stock initial vérifié absent'] };
    if (s<0 || s>cap || actuel<k) return { litres:null, autonomie_km:null, fiable:false, raison:'COMPTEUR_OU_STOCK_INCOHERENT', anomalies:['Stock initial, capacité ou compteur invalide'] };
    var last=k, alerte=[], events=(achats||[]).filter(function(a){return a && a.justificatif_statut!=='REJETE';})
      .map(function(a){return Object.assign({},a,{km:num(a.compteur_km),l:num(a.litres)});})
      .filter(function(a){return a.km!==null&&a.km>k&&a.km<=actuel;})
      .sort(function(a,b){return a.km-b.km || String(a.date_achat||'').localeCompare(String(b.date_achat||''));});
    var seen=new Set();
    for (var i=0;i<events.length;i++) {
      var e=events[i];
      if (e.id && seen.has(String(e.id))) continue;
      if (e.id) seen.add(String(e.id));
      if (e.l===null || e.l<=0 || e.km<last) return {litres:null,autonomie_km:null,fiable:false,raison:'EVENEMENT_INCOHERENT',anomalies:['Achat ou compteur incohérent']};
      s-=litresPourKm(e.km-last,p);
      if (s < -0.001) alerte.push('Réserve théorique négative avant ravitaillement');
      if (e.plein_complet===true && e.justificatif_statut==='VERIFIE') s=cap;
      else { s+=e.l; if (e.justificatif_statut!=='VERIFIE') alerte.push('Achat non encore vérifié'); }
      if (s>cap+0.001) alerte.push('Litres calculés supérieurs à la capacité du réservoir');
      last=e.km;
    }
    s-=litresPourKm(actuel-last,p);
    if (s < 0 || s>cap+0.001) alerte.push('Stock calculé hors limites physiques');
    if (alerte.some(function(a){return /hors limites|supérieurs|négative/.test(a);})) return { litres:null,autonomie_km:null,fiable:false,raison:'EVENEMENT_INCOHERENT',anomalies:alerte };
    return { litres:ronde(s,3), autonomie_km:ronde(100*s/p.conso_prudente,1), fiable:alerte.length===0, raison:alerte.length?'ESTIMATION_A_VERIFIER':'CALCUL_VERIFIABLE', anomalies:alerte };
  }
  function prevoir(input, p) {
    input=input||{}; p=parametres(p);
    var maintenant=date(input.maintenant) || Date.now(), heure=3600000, delai=p.delai_h*heure;
    var plan=Array.isArray(input.missions) ? input.missions : [];
    var m24=missionsIntervalle(plan,maintenant,maintenant+delai), m48=missionsIntervalle(plan,maintenant+delai,maintenant+2*delai);
    var distanceHistorique=num(input.km_jour_historique), historiqueFiable=input.historique_fiable===true;
    var remplacement=m24.missions===0 && !input.planning_complet && historiqueFiable && distanceHistorique!==null;
    var besoinDelai=remplacement?litresPourKm(distanceHistorique,p):m24.complet?litresPourKm(m24.km,p):null;
    var sec=m48.complet && m48.missions>0 ? litresPourKm(m48.km,p) : (historiqueFiable && distanceHistorique!==null ? litresPourKm(distanceHistorique,p):null);
    var alert=besoinDelai!==null && sec!==null ? besoinDelai+sec : null;
    var st=stockEstime(input.moto,input.achats,p), cap=num((input.moto||{}).capacite_l);
    var manque=!input.planning_complet && !remplacement || besoinDelai===null || sec===null;
    var erreurs=m24.erreurs.concat(m48.erreurs).concat(st.anomalies);
    if (!input.planning_complet && !remplacement) erreurs.push('Planning incomplet ou absent');
    var statut='NORMAL', actions=[];
    if ((input.moto||{}).capacite_verifiee===true && cap!==null && alert!==null && alert>cap) { statut='CRITIQUE'; actions.push('Prévoir un ravitaillement intermédiaire : trajet + réserve supérieurs au réservoir'); }
    else if (st.litres===null || manque) { statut='DONNEES_INSUFFISANTES'; actions.push('Vérifier stock initial, capacité, planning et compteur'); }
    else if (st.litres <= sec || (besoinDelai!==null && st.litres<besoinDelai)) { statut='CRITIQUE'; actions.push('Ravitailler avant le prochain déplacement'); }
    else if (st.litres <= alert) { statut='RAVITAILLEMENT_A_PLANIFIER'; actions.push('Organiser le ravitaillement sous 24 heures'); }
    if (statut==='NORMAL' && st.fiable===false) { statut='ANOMALIE_A_VERIFIER';actions.push('Contrôler les justificatifs et la chronologie'); }
    if (statut==='NORMAL' && erreurs.length) {statut='DONNEES_INSUFFISANTES';actions.push('Contrôler les données des prochaines missions');}
    var cible=(cap!==null && cap>0 && alert!==null) ? Math.min(cap,alert) : null;
    var ajout=st.litres!==null && cible!==null ? Math.max(0,cible-st.litres) : null;
    return { statut:statut, consommation_l100:ronde(p.conso_prudente,2), besoin_24h_l:ronde(besoinDelai,3), stock_securite_l:ronde(sec,3), seuil_alerte_l:ronde(alert,3), stock_estime_l:st.litres, autonomie_km:st.autonomie_km, ravitaillement_conseille_l:ronde(ajout,2), cout_fcfa:ajout===null?null:Math.round(ajout*p.prix_fcfa_l), fiabilite:st.fiable && !manque && m24.complet && m48.complet?'VERIFIABLE':'A_VERIFIER', actions:actions, erreurs:erreurs, mise_a_jour: new Date(maintenant).toISOString() };
  }
  return { REGLAGES:REGLAGES, parametres:parametres, litresPourKm:litresPourKm, missionsIntervalle:missionsIntervalle, stockEstime:stockEstime, prevoir:prevoir };
});

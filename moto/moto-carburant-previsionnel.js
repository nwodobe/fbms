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

  /* -- Simulation autorisée par le BM, 06/11/2026 ---------------------------
     Une mention « plein complet » + une capacité de travail de 15 L permet
     de calculer un stock HYPOTHÉTIQUE. Ne marque jamais la capacité et le
     justificatif comme physiquement vérifiés. Ce scénario ne réécrit aucune
     opération ni aucun paramètre de la base de production. */
  function simulerPleinsCompletes(input, p) {
    input=input||{};
    var config=parametres(p), cap=15;
    if (p && p.capacite_hypothese_l!==undefined) {
      cap=num(p.capacite_hypothese_l);
      if (cap===null || cap<=0) throw new Error('Capacité de scénario invalide');
    }
    var achats=Array.isArray(input.achats)?input.achats:[], moto=input.moto||{}, compteur=num(moto.compteur_actuel_km);
    var pleins=achats.filter(function(a) {
      return a && a.plein_complet===true && a.justificatif_statut!=='REJETE' &&
        num(a.compteur_km)!==null && num(a.compteur_km)>=0 &&
        date(a.date_achat)!==null;
    }).sort(function(a,b){
      return date(b.date_achat)-date(a.date_achat) || Number(b.compteur_km)-Number(a.compteur_km);
    });
    if (!pleins.length || compteur===null) return {
      statut:'DONNEES_INSUFFISANTES',stock_estime_l:null,autonomie_km:null,
      scenario:'HYPOTHESE_PLEIN_15_L',capacite_hypothese_l:cap,
      fiabilite:'HYPOTHESE_NON_CALCULABLE',motif:'Plein complet daté ou compteur absent'
    };
    var dernier=pleins[0], kmPlein=num(dernier.compteur_km), instant=date(dernier.date_achat);
    if (compteur<kmPlein || num(dernier.litres)===null || num(dernier.litres)<=0 || num(dernier.litres)>cap) return {
      statut:'ANOMALIE_A_VERIFIER',stock_estime_l:null,autonomie_km:null,
      scenario:'HYPOTHESE_PLEIN_15_L',capacite_hypothese_l:cap,
      fiabilite:'HYPOTHESE_NON_CALCULABLE',motif:'Compteur ou achat du plein incohérent'
    };
    var vus=new Set(), suivants=[], anomalies=[];
    achats.forEach(function(a) {
      if (!a || a===dernier || a.id && String(a.id)===String(dernier.id) || a.justificatif_statut==='REJETE') return;
      var km=num(a.compteur_km), quand=date(a.date_achat);
      if (quand===null || quand<=instant) return;
      if (a.id && vus.has(String(a.id))) return;
      if (a.id) vus.add(String(a.id));
      if (km===null || km<kmPlein || km>compteur) { anomalies.push('Achat postérieur au plein, kilométrage incohérent ou absent'); return; }
      suivants.push(a);
    });
    if (anomalies.length) return {
      statut:'ANOMALIE_A_VERIFIER',stock_estime_l:null,autonomie_km:null,
      scenario:'HYPOTHESE_PLEIN_15_L',capacite_hypothese_l:cap,
      fiabilite:'HYPOTHESE_NON_CALCULABLE',motif:anomalies.join('; ')
    };
    var hypothese=Object.assign({}, moto, {
      capacite_l:cap,capacite_verifiee:true,
      stock_initial_l:cap,stock_initial_verifie:true,
      compteur_initial_km:kmPlein
    });
    var resultat=prevoir(Object.assign({},input,{moto:hypothese,achats:suivants}),config);
    resultat.scenario='HYPOTHESE_PLEIN_15_L';
    resultat.capacite_hypothese_l=cap;
    resultat.fiabilite='HYPOTHESE_BM_NON_VERIFIEE';
    resultat.stock_physiquement_verifie=false;
    resultat.plein_ancre={id:dernier.id||null,date_achat:dernier.date_achat,compteur_km:kmPlein,
      statut_justificatif:dernier.justificatif_statut||null};
    if (dernier.justificatif_statut!=='VERIFIE') resultat.erreurs.push('Justificatif du plein à vérifier');
    resultat.erreurs.push('Capacité de 15 L et plein complet postulés par le Branch Manager, non mesurés');
    return resultat;
  }
  /* ==========================================================================
     MOTEUR DE PRODUCTION (07/11/2026) — tableau « Carburant & Autonomie »
     --------------------------------------------------------------------------
     Lit les données RÉELLES d'AFLP FLEET, sans aucune écriture :
       - moto_v_flotte   : compteur_actuel_km, dernier_releve_at, beneficiaire_nom
       - moto_carburant  : date_achat, compteur_km, litres, plein_complet,
                           justificatif_statut, created_at
       - moto_v_missions : statut OUVERTE/CLOTUREE/ANNULEE, depart_at, km_depart…
       - planning (optionnel) : [{ moto_id, jour:'AAAA-MM-JJ', km, annule }]
         AUCUNE table de planning n'existe en production au 07/11/2026 ;
         le moteur l'accepte dès qu'une source fiable sera reliée.
     Hypothèses du Branch Manager (non mesurées) : réservoir 15 L, chaque
     « plein complet » ramène le réservoir à 15 L au TOTAL (on n'ajoute jamais
     les litres achetés à 15 L). Consommation prudente 4,4 L/100 km.
     Aucun résultat ne crée de dotation, de paiement ni de remboursement.
     ======================================================================== */
  var PROD = Object.freeze({
    capacite_l: 15,               // hypothèse BM (06/11/2026), non mesure constructeur
    km_jour_referentiel: 70,      // référentiel budgétaire AFLP, utilisé seulement en repli signalé
    historique_min_jours: 3,      // en deçà, la moyenne historique est « provisoire »
    releve_perime_h: 48,          // au-delà, le compteur est considéré périmé
    mission_ouverte_max_h: 24,    // mission non clôturée au-delà : journal à vérifier
    sync_tardive_h: 24,           // achat saisi plus de 24 h après la date d'achat
    projection_max_h: 24          // km estimés pendant une mission ouverte, plafonnés
  });
  var ETATS = Object.freeze({
    CRITIQUE: { rang: 0, libelle: 'Critique', ton: 'ko' },
    RAVITAILLEMENT_A_PLANIFIER: { rang: 1, libelle: 'Ravitaillement à planifier', ton: 'warn' },
    DONNEES_A_VERIFIER: { rang: 2, libelle: 'Données à vérifier', ton: 'neutre' },
    NORMAL: { rang: 3, libelle: 'Normal', ton: 'ok' }
  });
  var FIABILITE = Object.freeze({ BONNE: 'Bonne', MOYENNE: 'Moyenne', FAIBLE: 'Faible', INSUFFISANTE: 'Insuffisante' });
  var H = 3600000, J = 24 * H;

  function reglagesProd(p) {
    var base = parametres(p);
    var r = Object.assign({}, PROD, base, p || {});
    if (num(r.capacite_l) === null || r.capacite_l <= 0) throw new Error('Capacité de référence invalide');
    if (num(r.km_jour_referentiel) === null || r.km_jour_referentiel < 0) throw new Error('Référentiel km/jour invalide');
    r.conso_prudente = base.conso_prudente;
    return r;
  }
  function fr(x, d) { return x == null ? '—' : String(ronde(x, d == null ? 2 : d)).replace('.', ','); }
  function jourIso(ms) { return new Date(ms).toISOString().slice(0, 10); }

  /* Reconstitution chronologique du stock depuis le DERNIER plein complet.
     Retourne aussi l'historique lisible pour la fiche détaillée. */
  function reconstituerStock(achats, compteurActuel, r) {
    var vus = new Set(), points = [], anomalies = [], aVerifier = [];
    var valides = (achats || []).filter(function (a) {
      if (!a || a.justificatif_statut === 'REJETE') return false;
      if (a.id != null) { if (vus.has(String(a.id))) return false; vus.add(String(a.id)); }
      return num(a.compteur_km) !== null && num(a.litres) !== null && num(a.litres) > 0 && date(a.date_achat) !== null;
    }).map(function (a) { return Object.assign({}, a, { _km: num(a.compteur_km), _l: num(a.litres), _t: date(a.date_achat) }); })
      .sort(function (a, b) { return a._km - b._km || a._t - b._t; });
    var pleins = valides.filter(function (a) { return a.plein_complet === true; });
    if (!pleins.length) return { stock: null, ancre: null, motif: 'Aucun plein complet enregistré : stock de départ inconnu', anomalies: anomalies, a_verifier: aVerifier, points: points };
    var ancre = pleins[pleins.length - 1];
    if (compteurActuel === null) return { stock: null, ancre: ancre, motif: 'Compteur actuel absent', anomalies: anomalies, a_verifier: aVerifier, points: points };
    if (compteurActuel < ancre._km) {
      anomalies.push('Compteur actuel (' + compteurActuel + ' km) inférieur au compteur du dernier plein (' + ancre._km + ' km)');
      return { stock: null, ancre: ancre, motif: 'Compteur incohérent', incoherent: true, anomalies: anomalies, a_verifier: aVerifier, points: points };
    }
    var cap = r.capacite_l, s = cap, dernier = ancre._km;
    if (ancre._l > cap + 0.05) anomalies.push('Le plein enregistré (' + ancre._l + ' L) dépasse la capacité de référence de ' + cap + ' L');
    if (ancre.justificatif_statut !== 'VERIFIE') aVerifier.push('Justificatif du dernier plein en attente de vérification');
    points.push({ date: ancre.date_achat, km: ancre._km, type: 'PLEIN', litres: ancre._l, stock_l: ronde(s, 2) });
    var suivants = valides.filter(function (a) { return a !== ancre && (a._km > ancre._km || (a._km === ancre._km && a._t > ancre._t)); });
    for (var i = 0; i < suivants.length; i++) {
      var a = suivants[i];
      if (a._km > compteurActuel) {
        anomalies.push('Achat déclaré à ' + a._km + ' km, au-delà du compteur actuel (' + compteurActuel + ' km) : relevé en retard ou saisie erronée');
        return { stock: null, ancre: ancre, motif: 'Compteur incohérent', incoherent: true, anomalies: anomalies, a_verifier: aVerifier, points: points };
      }
      s -= litresPourKm(a._km - dernier, r);
      if (s < -0.05) anomalies.push('Réserve théorique épuisée avant l\'achat du ' + String(a.date_achat).slice(0, 10) + ' : ravitaillement non déclaré ou consommation réelle inférieure à 4,4 L/100 km');
      s = Math.max(0, s) + a._l;
      if (s > cap + 0.05) { aVerifier.push('Achat de ' + a._l + ' L supérieur à la place disponible estimée : réservoir ramené à ' + cap + ' L'); s = cap; }
      if (a.justificatif_statut !== 'VERIFIE') aVerifier.push('Justificatif carburant en attente (' + String(a.date_achat).slice(0, 10) + ')');
      points.push({ date: a.date_achat, km: a._km, type: 'COMPLEMENT', litres: a._l, stock_l: ronde(s, 2) });
      dernier = a._km;
    }
    s -= litresPourKm(compteurActuel - dernier, r);
    var epuise = false;
    if (s < -0.05) { epuise = true; anomalies.push('Réserve théorique épuisée au compteur actuel : vérifier un ravitaillement non déclaré ou le relevé (aucune faute présumée)'); }
    valides.forEach(function (a) {
      var c = date(a.created_at);
      if (c !== null && c - a._t > r.sync_tardive_h * H) aVerifier.push('Achat du ' + String(a.date_achat).slice(0, 10) + ' synchronisé tardivement');
    });
    return { stock: Math.max(0, s), ancre: ancre, epuise: epuise, anomalies: anomalies, a_verifier: aVerifier, points: points,
             consomme_l: litresPourKm(compteurActuel - ancre._km, r) };
  }

  /* Km prévus par jour : planning fiable > historique compteur > référentiel. */
  function kmPrevus(moto, origines, planning, maintenant, r) {
    var jours = [jourIso(maintenant), jourIso(maintenant + J)], plan = {}, annules = 0;
    (planning || []).forEach(function (p) {
      if (!p || (moto.id && p.moto_id && p.moto_id !== moto.id)) return;
      if (p.annule === true || String(p.statut || '').toUpperCase() === 'ANNULEE') { annules++; return; }
      var k = num(p.km); if (k === null || k < 0 || jours.indexOf(p.jour) < 0) return;
      plan[p.jour] = (plan[p.jour] || 0) + k;
    });
    var hist = null, span = null, provisoire = true;
    var compteur = num(moto.compteur_actuel_km), releve = date(moto.dernier_releve_at);
    /* Origine de la moyenne : le plus ancien point compteur (achat ou départ de
       mission) des 14 derniers jours, sinon le plus récent avant. La moyenne
       repose sur le COMPTEUR, pas sur les missions : une absence de mission
       n'est jamais lue comme une absence de déplacement. */
    var fenetre = maintenant - 14 * J, origine = null;
    (origines || []).forEach(function (o) {
      if (!o || o.t === null || o.km === null || o.t > maintenant) return;
      if (o.t >= fenetre) { if (!origine || origine.t < fenetre || o.t < origine.t) origine = o; }
      else if (!origine || (origine.t < fenetre && o.t > origine.t)) origine = o;
    });
    if (origine && compteur !== null) {
      var fin = releve !== null ? releve : maintenant;
      span = (fin - origine.t) / J;
      var parcourus = compteur - origine.km;
      // Diviseur minimal d'un jour : une demi-journée n'est pas extrapolée à 24 h.
      if (parcourus > 0 && span > 0) { hist = parcourus / Math.max(1, span); provisoire = span < r.historique_min_jours; }
    }
    var source = hist !== null ? 'HISTORIQUE' : 'REFERENTIEL', jourType = hist !== null ? hist : r.km_jour_referentiel;
    var km1 = plan[jours[0]] != null ? plan[jours[0]] : jourType, km2 = plan[jours[1]] != null ? plan[jours[1]] : jourType;
    if (plan[jours[0]] != null && plan[jours[1]] != null) source = 'PLANNING';
    else if (plan[jours[0]] != null || plan[jours[1]] != null) source = 'PLANNING_PARTIEL';
    return { km_24h: ronde(km1, 1), km_jour_suivant: ronde(km2, 1), source: source, km_jour_historique: ronde(hist, 1),
             historique_jours: ronde(span, 2), provisoire: source !== 'PLANNING' && (source === 'REFERENTIEL' || provisoire),
             planning_jours: plan, planning_annules: annules };
  }

  function evaluerMoto(entree, p) {
    entree = entree || {}; var r = reglagesProd(p);
    var moto = entree.moto || {}, maintenant = date(entree.maintenant) || Date.now();
    var compteur = num(moto.compteur_actuel_km), releve = date(moto.dernier_releve_at);
    var rec = reconstituerStock(entree.achats, compteur, r);
    var origines = (entree.achats || []).filter(function (a) { return a && a.justificatif_statut !== 'REJETE'; })
      .map(function (a) { return { t: date(a.date_achat), km: num(a.compteur_km) }; })
      .concat((entree.missions || []).map(function (m) { return m ? { t: date(m.depart_at), km: num(m.km_depart != null ? m.km_depart : m.depart_km) } : null; }));
    var prev = kmPrevus(moto, origines, entree.planning, maintenant, r);
    var aVerifier = rec.a_verifier.slice(), anomalies = rec.anomalies.slice(), justification = [];
    var bloquant = false;

    if (compteur === null) { aVerifier.push('Compteur actuel absent'); bloquant = true; }
    if (releve === null) { aVerifier.push('Aucun relevé de compteur'); bloquant = true; }
    else if (maintenant - releve > r.releve_perime_h * H) { aVerifier.push('Dernier relevé de plus de ' + r.releve_perime_h + ' h'); bloquant = true; }
    if (prev.source === 'REFERENTIEL') { aVerifier.push('Aucun historique kilométrique exploitable : référentiel de ' + r.km_jour_referentiel + ' km/jour utilisé'); bloquant = true; }
    if (rec.incoherent) bloquant = true;

    // Mission ouverte : la moto roule, des km non relevés s'ajoutent (projection prudente).
    var missions = (entree.missions || []).filter(function (m) { return m && (!moto.id || !m.moto_id || m.moto_id === moto.id); });
    var ouverte = missions.filter(function (m) { return String(m.statut).toUpperCase() === 'OUVERTE'; })
      .sort(function (a, b) { return date(b.depart_at) - date(a.depart_at); })[0] || null;
    var kmEnCours = 0;
    if (ouverte) {
      var dep = date(ouverte.depart_at);
      if (dep !== null && maintenant - dep > r.mission_ouverte_max_h * H) aVerifier.push('Mission ouverte depuis plus de ' + r.mission_ouverte_max_h + ' h sans clôture');
      var debut = Math.max(dep || 0, releve || 0);
      var heures = Math.min(r.projection_max_h, Math.max(0, (maintenant - debut) / H));
      kmEnCours = prev.km_24h * heures / 24;
    }

    var stockReleve = rec.stock, stock = stockReleve === null ? null : Math.max(0, stockReleve - litresPourKm(kmEnCours, r));
    var besoin = litresPourKm(prev.km_24h, r), secu = litresPourKm(prev.km_jour_suivant, r), seuil = besoin + secu;
    var cap = r.capacite_l, autonomie = stock === null ? null : 100 * stock / r.conso_prudente;
    var depasse = seuil > cap + 1e-9, jourImpossible = besoin > cap + 1e-9;
    var statut;
    if (stock === null) { statut = 'DONNEES_A_VERIFIER'; justification.push(rec.motif || 'Stock non calculable'); }
    else if (rec.incoherent) { statut = 'DONNEES_A_VERIFIER'; justification.push('Compteur ou achat incohérent'); }
    else if (rec.epuise || stock <= secu + 1e-9 || besoin > stock + 1e-9 || jourImpossible) {
      statut = 'CRITIQUE';
      if (rec.epuise) justification.push('Réserve théorique épuisée');
      else if (jourImpossible) justification.push('Les ' + fr(prev.km_24h, 0) + ' km des prochaines 24 h exigent plus que le réservoir de ' + cap + ' L');
      else if (besoin > stock) justification.push('Autonomie (' + fr(autonomie, 0) + ' km) inférieure aux ' + fr(prev.km_24h, 0) + ' km prévus sur 24 h');
      else justification.push('Stock estimé (' + fr(stock, 2) + ' L) au niveau du stock de sécurité (' + fr(secu, 2) + ' L)');
    } else if (stock <= seuil + 1e-9 || (prev.source !== 'HISTORIQUE' && prev.source !== 'REFERENTIEL' && stock - besoin <= seuil + 1e-9) || depasse) {
      // L'anticipation « seuil atteint dans moins de 24 h » ne s'applique qu'aux
      // missions PRÉVUES (planning) : sur simple moyenne historique, l'alerte
      // part au seuil, qui intègre déjà le délai de 24 h.
      statut = 'RAVITAILLEMENT_A_PLANIFIER';
      if (depasse) justification.push('Besoin de 24 h + sécurité (' + fr(seuil, 2) + ' L) supérieur au réservoir : ravitaillement intermédiaire nécessaire');
      else if (stock <= seuil) justification.push('Stock estimé (' + fr(stock, 2) + ' L) sous le seuil d\'alerte (' + fr(seuil, 2) + ' L)');
      else justification.push('Les missions prévues porteront le stock sous le seuil d\'alerte (' + fr(seuil, 2) + ' L) dans moins de 24 h');
    } else if (bloquant) { statut = 'DONNEES_A_VERIFIER'; justification.push('Stock suffisant en apparence, mais donnée indispensable absente ou périmée'); }
    else { statut = 'NORMAL'; justification.push('Le stock couvre les 24 prochaines heures et le stock de sécurité'); }
    if (prev.provisoire && stock !== null) justification.push('Calcul provisoire : ' + (prev.source === 'REFERENTIEL' ? 'référentiel budgétaire' : 'historique de ' + fr(prev.historique_jours, 1) + ' jour(s)') + ', planning non relié');

    var fiab;
    if (stock === null) fiab = 'INSUFFISANTE';
    else if (anomalies.length || bloquant || prev.source === 'REFERENTIEL' || aVerifier.some(function (x) { return /Mission ouverte|tardivement|dépasse/.test(x); })) fiab = 'FAIBLE';
    else if (aVerifier.length || prev.provisoire) fiab = 'MOYENNE';
    else fiab = 'BONNE';

    var plein = stock === null ? null : Math.max(0, cap - stock);
    var pente = besoin > 0 ? besoin / 24 : null;
    var heuresAvantSeuil = stock === null || pente === null ? null : Math.max(0, (stock - seuil) / pente);
    return {
      moto_id: moto.id || null, code: moto.code || null, agent: moto.beneficiaire_nom || null, cluster: moto.cluster_code || null,
      statut: statut, statut_libelle: ETATS[statut].libelle, ton: ETATS[statut].ton, rang: ETATS[statut].rang,
      dernier_plein: rec.ancre ? { date: rec.ancre.date_achat, compteur_km: rec.ancre._km, litres: rec.ancre._l, justificatif: rec.ancre.justificatif_statut || null } : null,
      compteur_km: compteur, dernier_releve_at: moto.dernier_releve_at || null,
      km_depuis_plein: rec.ancre && compteur !== null && compteur >= rec.ancre._km ? ronde(compteur - rec.ancre._km, 1) : null,
      consommation_theorique_l: ronde(rec.consomme_l, 2),
      km_en_cours_estimes: ronde(kmEnCours, 1), mission_ouverte: ouverte ? { id: ouverte.id || null, depart_at: ouverte.depart_at } : null,
      stock_au_releve_l: ronde(stockReleve, 2), stock_l: ronde(stock, 2), autonomie_km: ronde(autonomie, 0),
      km_24h: prev.km_24h, km_jour_suivant: prev.km_jour_suivant, source_km: prev.source, km_jour_historique: prev.km_jour_historique,
      historique_jours: prev.historique_jours, calcul_provisoire: prev.provisoire, planning: prev.planning_jours, planning_annules: prev.planning_annules,
      besoin_24h_l: ronde(besoin, 2), stock_securite_l: ronde(secu, 2), seuil_alerte_l: ronde(seuil, 2),
      depasse_reservoir: depasse, heures_avant_seuil: ronde(heuresAvantSeuil, 1),
      plein_conseille_l: ronde(plein, 2), cout_plein_fcfa: plein === null ? null : Math.round(plein * r.prix_fcfa_l),
      minimum_pour_seuil_l: stock === null ? null : ronde(Math.max(0, Math.min(cap, seuil) - stock), 2),
      ravitaillement_propose: statut === 'CRITIQUE' || statut === 'RAVITAILLEMENT_A_PLANIFIER',
      fiabilite: fiab, fiabilite_libelle: FIABILITE[fiab],
      justification: justification, points_a_verifier: aVerifier, anomalies: anomalies, evenements: rec.points,
      hypotheses: 'Réservoir ' + cap + ' L et plein complet postulés par le Branch Manager (non mesurés) ; ' + String(r.conso_prudente).replace('.', ',') + ' L/100 km ; ' + r.prix_fcfa_l + ' FCFA/L',
      calcule_le: new Date(maintenant).toISOString()
    };
  }

  /* Motos suivies : mises en service, remises, ou ayant au moins un achat. */
  function evaluerFlotte(entree, p) {
    entree = entree || {};
    var carb = entree.carburant || [], mis = entree.missions || [], plan = entree.planning || [];
    var suivies = (entree.flotte || []).filter(function (m) {
      return m && (m.mise_en_service_at || ['REMISE', 'TRANSFEREE'].indexOf(m.statut_affectation) >= 0 || carb.some(function (c) { return c.moto_id === m.id; }));
    });
    var lignes = suivies.map(function (m) {
      return evaluerMoto({ moto: m, maintenant: entree.maintenant,
        achats: carb.filter(function (c) { return c.moto_id === m.id; }),
        missions: mis.filter(function (x) { return x.moto_id === m.id; }),
        planning: plan.filter(function (x) { return x.moto_id === m.id; }) }, p);
    }).sort(function (a, b) {
      return a.rang - b.rang || (a.autonomie_km == null ? 1e9 : a.autonomie_km) - (b.autonomie_km == null ? 1e9 : b.autonomie_km) || String(a.code).localeCompare(String(b.code));
    });
    var compte = function (s) { return lignes.filter(function (l) { return l.statut === s; }).length; };
    return { lignes: lignes, synthese: { suivies: lignes.length, normal: compte('NORMAL'), a_planifier: compte('RAVITAILLEMENT_A_PLANIFIER'),
             critique: compte('CRITIQUE'), donnees: compte('DONNEES_A_VERIFIER') },
             a_traiter: lignes.filter(function (l) { return l.statut !== 'NORMAL'; }).length };
  }

  /* Historisation anti-doublon : une alerte (moto, statut, jour) n'est notifiée
     qu'une fois ; une aggravation (à planifier → critique) est une nouvelle alerte.
     Le journal est purgé au-delà de `garder_jours`. Fonction pure. */
  function historiserAlertes(journal, lignes, maintenant, garderJours) {
    var t = date(maintenant) || Date.now(), jour = jourIso(t), limite = t - (garderJours || 14) * J;
    var j = {}; Object.keys(journal || {}).forEach(function (k) { var v = journal[k]; if (v && date(v.premiere) !== null && date(v.premiere) >= limite) j[k] = v; });
    var nouvelles = [];
    (lignes || []).forEach(function (l) {
      if (!l || l.statut === 'NORMAL') return;
      var cle = [l.moto_id || l.code, l.statut, jour].join('|');
      if (j[cle]) { j[cle].derniere = new Date(t).toISOString(); j[cle].occurrences++; return; }
      j[cle] = { moto: l.code, statut: l.statut, premiere: new Date(t).toISOString(), derniere: new Date(t).toISOString(), occurrences: 1 };
      nouvelles.push(cle);
    });
    return { journal: j, nouvelles: nouvelles };
  }

  return { REGLAGES:REGLAGES, PROD:PROD, ETATS:ETATS, parametres:parametres, litresPourKm:litresPourKm, missionsIntervalle:missionsIntervalle, stockEstime:stockEstime, prevoir:prevoir, simulerPleinsCompletes:simulerPleinsCompletes,
           reconstituerStock:reconstituerStock, kmPrevus:kmPrevus, evaluerMoto:evaluerMoto, evaluerFlotte:evaluerFlotte, historiserAlertes:historiserAlertes };
});

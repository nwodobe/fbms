/* ============================================================================
   AFLP MOTO MANAGER — cœur métier pur (moto/moto-core.js)
   ----------------------------------------------------------------------------
   Aucune dépendance au navigateur : chargé par la page ET par les tests Node
   (tests/moto/core.test.mjs). Les formules sont le miroir exact des vues SQL
   (supabase/20261031090200_aflp_moto_manager_3_vues_kpi.sql) : le serveur
   reste l'autorité, le client affiche et prévisualise.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MOTO_CORE = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ND = 'Non disponible';

  /* -- 1. Classes métier (miroir de private.moto_classe) ------------------ */
  var CLASSES = {
    'Branch Manager': 'BM',
    'Assistant Branch Manager': 'ABM',
    'Zonal Head': 'ZONE',
    'Unit Head': 'UNITE',
    'Finance': 'FINANCE',
    'Finance Manager': 'FINANCE',
    'General Manager': 'DIRECTION'
  };
  function classeDepuisRole(role) { return CLASSES[String(role || '').trim()] || null; }
  /* Même règle que private.moto_classe_de (serveur) : le coordinateur logistique
     est reconnu par sa fonction opérationnelle FBMS, sans nouveau rôle. */
  function normaliser(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase(); }
  function classeDepuisProfil(p) {
    p = p || {};
    var c = classeDepuisRole(p.role);
    if (c === 'BM' || c === 'ABM' || c === 'FINANCE' || c === 'DIRECTION') return c;
    var f = normaliser(p.fonction_operationnelle);
    if (String(p.role || '').trim() === 'Logistics Coordinator' || f === 'LOGISTICS COORDINATOR' || f === 'LOGISTICS_COORDINATOR' || f === 'COORDINATEUR LOGISTIQUE') return 'LOGISTIQUE';
    return c;
  }

  /* Ce que l'interface PROPOSE. La décision réelle est prise par le serveur
     (fonctions SECURITY DEFINER + RLS) : masquer un bouton ne protège rien. */
  var DROITS = {
    BM:        ['lire', 'pilotage', 'admin', 'inventaire', 'documents', 'verifier_documents', 'preaffecter', 'remettre', 'mettre_en_service', 'transferer',
                'budgets', 'valider_budget', 'dotations', 'rapprochement', 'verifier_justificatifs', 'valider_corrections', 'valider_remboursements',
                'incident_piloter', 'pneus', 'parametres', 'journal', 'terrain', 'exports',
                'coordination', 'etat_remise', 'photo_principale', 'actions', 'actions_verifier', 'inspection_independante', 'valider_enveloppe', 'verifier_depense', 'exceptions',
                // Migration 6 : le BM est le SEUL à autoriser une dépense d'entretien ou de réparation.
                'maintenance_voir', 'maintenance_finances', 'maintenance_autoriser', 'maintenance_organiser', 'maintenance_controler', 'garages', 'garage_approuver',
                'regle_proposer', 'regle_approuver', 'modele_definir', 'lever_immobilisation', 'maintenance_demande',
                // Migration 7 : permis des conducteurs (contrôle sur original par le BM ou l'ABM).
                'permis_voir', 'permis_enregistrer', 'permis_verifier',
                // Migration 8 : journal de mission (photo du compteur au départ et à l'arrivée).
                'missions', 'missions_suivi', 'missions_traiter', 'missions_couts'],
    ABM:       ['lire', 'pilotage', 'admin', 'inventaire', 'documents', 'verifier_documents', 'remettre', 'budgets', 'dotations', 'rapprochement',
                'verifier_justificatifs', 'demander_correction', 'incident_piloter', 'pneus', 'journal', 'terrain', 'exports',
                'coordination', 'etat_remise', 'photo_principale', 'actions', 'actions_verifier', 'inspection_independante', 'verifier_depense',
                'maintenance_voir', 'maintenance_finances', 'maintenance_preparer', 'maintenance_organiser', 'maintenance_controler', 'facture_verifier', 'cloture_financiere',
                'garages', 'regle_proposer', 'modele_definir', 'maintenance_demande', 'permis_voir', 'permis_enregistrer', 'permis_verifier', 'mon_permis',
                'missions', 'missions_suivi', 'missions_traiter', 'missions_couts'],
    LOGISTIQUE: ['lire', 'pilotage', 'coordination', 'inventaire_logistique', 'photo_principale', 'etat_remise', 'remettre', 'inspection',
                'inspection_mensuelle', 'actions', 'actions_verifier', 'pneus', 'documents_logistique', 'maintenance_demande', 'terrain', 'exports', 'enveloppes',
                'maintenance_voir', 'maintenance_finances', 'maintenance_preparer', 'maintenance_organiser', 'maintenance_controler', 'garages', 'regle_proposer', 'modele_definir',
                'permis_voir', 'permis_enregistrer', 'mon_permis', 'missions', 'missions_suivi', 'missions_traiter', 'missions_couts'],
    ZONE:      ['lire', 'pilotage', 'inspection', 'documents_zone', 'demander_correction', 'incident_piloter',
                'pneus', 'terrain', 'exports', 'inspection_mensuelle', 'actions_verifier', 'maintenance_voir', 'maintenance_controler', 'lever_immobilisation', 'maintenance_demande', 'mon_permis',
                'missions', 'missions_suivi', 'missions_traiter'],
    UNITE:     ['lire', 'terrain', 'mes_dotations', 'confirmer_etat', 'mon_permis', 'missions'],
    FINANCE:   ['lire', 'pilotage', 'rapprochement', 'verifier_justificatifs', 'exports', 'verifier_depense',
                'maintenance_voir', 'maintenance_finances', 'facture_verifier', 'paiement_constater', 'cloture_financiere', 'missions', 'missions_suivi', 'missions_couts'],
    DIRECTION: ['lire', 'pilotage', 'rapprochement', 'valider_corrections', 'journal', 'exports', 'maintenance_voir', 'maintenance_finances', 'missions', 'missions_suivi', 'missions_couts']
  };
  function peut(classe, droit) { return !!(classe && DROITS[classe] && DROITS[classe].indexOf(droit) >= 0); }

  /* -- 2. Libellés ---------------------------------------------------------- */
  var LIBELLES = {
    EN_ATTENTE: 'Documents en attente', EN_VERIFICATION: 'En vérification', CONFORME: 'Conforme', NON_CONFORME: 'Non conforme',
    NON_AFFECTEE: 'Non affectée', PREAFFECTEE: 'Préaffectée', REMISE: 'Remise', TRANSFEREE: 'Transférée',
    A_CONTROLER: 'À contrôler', APTE: 'Apte', IMMOBILISEE: 'Immobilisée', EN_REPARATION: 'En réparation',
    REMISE_DECLAREE: 'Remise déclarée', CONFIRMEE: 'Réception confirmée', CONTESTEE: 'Écart signalé', ECHOUEE: 'Échouée', ANNULEE: 'Annulée',
    A_VERIFIER: 'À vérifier', VERIFIE: 'Vérifié', REJETE: 'Rejeté',
    SIGNALE: 'Signalé', DIAGNOSTIC: 'Diagnostic', AUTORISATION_DEPENSE: 'Dépense autorisée', REPARATION: 'Réparation', CONTROLE: 'Contrôle',
    REMIS_EN_SERVICE: 'Remis en service', CLOS: 'Clos',
    DEMANDEE: 'Demandée', AUTORISEE: 'Autorisée', EN_COURS: 'En cours', TERMINEE: 'Terminée', REFUSEE: 'Refusée',
    DEVIS_RECU: 'Devis reçu', EN_ATTENTE_BM: 'En attente du Branch Manager', PROGRAMMEE: 'Programmée', CONTROLEE: 'Contrôlée conforme',
    PNEUMATIQUE: 'Pneumatique', RAPPEL: 'Rappel de planification', ATTEINTE: 'Échéance atteinte', MAINTENANCE: 'Maintenance',
    PROPOSE: 'Proposé', VALIDE: 'Validé', DEMANDE: 'Demandé', PAYE_DECLARE: 'Paiement déclaré', APPLIQUEE: 'Appliquée', REJETEE: 'Rejetée',
    ESPECES: 'Espèces', MOBILE_MONEY: 'Mobile Money', DOTATION: 'Dotation', AVANCE_PERSONNELLE: 'Avance personnelle',
    NORMAL: 'Normal', VERIFICATION: 'À vérifier', VERIFICATION_PRIORITAIRE: 'Vérification prioritaire', INVALIDE: 'Intervalle invalide',
    A_JOUR: 'À jour', PROCHE: 'Proche', DEPASSEE: 'Dépassée', NON_DISPONIBLE: ND,
    MANQUANT: 'Manquant', EXPIRE: 'Expiré', EXPIRE_BIENTOT: 'Expire bientôt', OK: 'OK',
    EN_STOCK: 'En stock', MONTE: 'Monté', REFORME: 'Réformé',
    PANNE: 'Panne', ACCIDENT: 'Accident', CREVAISON: 'Crevaison', ANOMALIE: 'Anomalie',
    MINEURE: 'Mineure', MAJEURE: 'Majeure', CRITIQUE: 'Critique',
    PREVUE: 'Acquisition prévue', RECEPTIONNEE: 'Réceptionnée', AFFECTEE: 'Affectée', OPERATIONNELLE: 'Opérationnelle',
    NEUVE: 'Moto neuve', EN_EXPLOITATION: 'Déjà en exploitation',
    OUVERTE: 'Ouverte', PLANIFIEE: 'Planifiée', REALISEE: 'Réalisée, à vérifier', CLOTUREE: 'Clôturée (vérifiée)',
    RESERVES: 'Conforme avec réserves', NON_EVALUABLE: 'Non évaluable (immobilisée)',
    PROGRAMMEE: 'Programmée', EFFECTUEE: 'Effectuée dans les délais', EFFECTUEE_HORS_DELAI: 'Effectuée hors délai', NON_EFFECTUEE: 'Non effectuée',
    SUPERVISION: 'Déplacements de supervision', ENTRETIEN: 'Entretien et réparation du parc', APPROUVEE: 'Approuvée',
    DECLAREE: 'Déclarée, justificatif attendu', JUSTIFIEE: 'Justifiée, à vérifier', VALIDEE: 'Validée',
    ACCEPTEE: 'Acceptée', ACCEPTEE_AVEC_RESERVES: 'Acceptée avec réserves',
    ETAT_REMISE: 'État contradictoire avant remise', INSPECTION_MENSUELLE: 'Inspection mensuelle', INSPECTION_INITIALE: 'Inspection mécanique initiale',
    AVANT_DEPART: 'Contrôle avant départ', REMISE_EN_SERVICE: 'Contrôle de remise en service',
    ZONE: 'Chef de zone', COORDINATION: 'Coordinateur logistique', INDEPENDANTE: 'Contrôle indépendant',
    VIDANGE: 'Vidange', ENTRETIEN_PREVENTIF: 'Entretien préventif', REVISION: 'Révision',
    CARTE_GRISE: 'Carte grise', PLAQUE: 'Plaque d\'immatriculation', ASSURANCE: 'Assurance', RAPPORT_MECANICIEN: 'Rapport du mécanicien',
    PV_REMISE: 'Procès-verbal de remise', PHOTO: 'Photographie', PERMIS: 'Permis', FACTURE: 'Facture', JUSTIFICATIF: 'Justificatif', AUTRE: 'Autre',
    PREAFFECTATION: 'Préaffectation', TRANSFERT: 'Transfert', ACTIVE: 'Active', CLOTUREE: 'Clôturée',
    SYNCHRONISE: 'Synchronisé', BLOQUE: 'Bloqué (relance manuelle)',
    REMPLACE: 'Remplacé', RETIRE: 'Retiré', RETRAIT_LEVE: 'Retrait levé', ANNULE: 'Annulé', AUCUN_PERMIS_VALIDE: 'Aucun permis valide', LEVEE: 'Levée', EN_COURS_IMMO: 'En cours'
  };
  function libelle(code) { return code == null || code === '' ? ND : (LIBELLES[code] || String(code)); }

  /* -- 3. Formatage --------------------------------------------------------- */
  function estNombre(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }
  function fcfa(v) { return estNombre(v) ? Math.round(Number(v)).toLocaleString('fr-FR').replace(/ | /g, ' ') + ' FCFA' : ND; }
  function km(v) { return estNombre(v) ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 }).replace(/ | /g, ' ') + ' km' : ND; }
  function l100(v) { return estNombre(v) ? Number(v).toFixed(2).replace('.', ',') + ' L/100 km' : ND; }
  function pct(v) { return estNombre(v) ? Number(v).toFixed(1).replace('.', ',') + ' %' : ND; }
  function dateFr(v) {
    if (!v) return ND;
    var d = new Date(v); if (isNaN(d)) return ND;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function dateHeureFr(v) {
    if (!v) return ND;
    var d = new Date(v); if (isNaN(d)) return ND;
    return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function nombreSaisi(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }

  /* -- 4. Consommation plein à plein (miroir moto_v_conso_intervalles) ------
     Intervalle entre deux pleins complets consécutifs (triés par compteur) :
     litres = somme des achats strictement après le plein initial et jusqu'au
     plein final inclus ; km = compteur final − compteur initial. Les achats
     au justificatif REJETÉ sont exclus. */
  function consoPleinAPlein(achats, seuils) {
    seuils = seuils || {};
    var valides = (achats || []).filter(function (a) { return a && a.justificatif_statut !== 'REJETE' && estNombre(a.compteur_km) && estNombre(a.litres); })
      .map(function (a) { return Object.assign({}, a, { compteur_km: Number(a.compteur_km), litres: Number(a.litres) }); })
      .sort(function (a, b) { return a.compteur_km - b.compteur_km || String(a.date_achat).localeCompare(String(b.date_achat)); });
    var pleins = valides.filter(function (a) { return a.plein_complet === true; });
    var intervalles = [];
    for (var i = 1; i < pleins.length; i++) {
      var deb = pleins[i - 1], fin = pleins[i];
      var kmp = fin.compteur_km - deb.compteur_km;
      var dedans = valides.filter(function (a) { return a.compteur_km > deb.compteur_km && a.compteur_km <= fin.compteur_km; });
      var litres = arrondi(dedans.reduce(function (t, a) { return t + a.litres; }, 0), 2);
      var conso = kmp > 0 ? arrondi(100 * litres / kmp, 2) : null;
      intervalles.push({ debut_id: deb.id, fin_id: fin.id, debut_km: deb.compteur_km, fin_km: fin.compteur_km, km: kmp, litres: litres,
                         nb_achats: dedans.length, l_100km: conso, statut_alerte: statutAlerte(conso, kmp, seuils) });
    }
    var ok = intervalles.filter(function (x) { return x.statut_alerte !== 'INVALIDE'; });
    var kmTot = ok.reduce(function (t, x) { return t + x.km; }, 0);
    var lTot = ok.reduce(function (t, x) { return t + x.litres; }, 0);
    return { intervalles: intervalles, nb_intervalles: ok.length, km_mesures: kmTot, litres_mesures: arrondi(lTot, 2),
             l_100km: kmTot > 0 ? arrondi(100 * lTot / kmTot, 2) : null };
  }
  function statutAlerte(conso, kmp, seuils) {
    if (!(kmp > 0) || conso === null) return 'INVALIDE';
    var s1 = estNombre(seuils.seuil1) ? Number(seuils.seuil1) : 3.6, s2 = estNombre(seuils.seuil2) ? Number(seuils.seuil2) : 4.2;
    if (conso >= s2) return 'VERIFICATION_PRIORITAIRE';
    if (conso >= s1) return 'VERIFICATION';
    return 'NORMAL';
  }
  function arrondi(v, n) { var f = Math.pow(10, n); return Math.round((Number(v) + Number.EPSILON) * f) / f; }

  /* -- 5. Rapprochement des dotations (miroir moto_v_rapprochement) -------- */
  function rapprochement(d) {
    d = d || {};
    var dot = d.dotations || [], carb = d.carburant || [], rest = d.restitutions || [], rbt = d.remboursements || [], bud = d.budgets || [];
    function som(rows, f, k) { return rows.filter(f).reduce(function (t, r) { return t + Number(r[k] || 0); }, 0); }
    var recues = som(dot, function (r) { return r.statut === 'CONFIRMEE' || r.statut === 'CONTESTEE'; }, 'montant_recu');
    var justif = som(carb, function (r) { return r.financement === 'DOTATION' && r.justificatif_statut === 'VERIFIE'; }, 'montant');
    var restit = som(rest, function () { return true; }, 'montant');
    return {
      budget_autorise: som(bud, function (r) { return r.statut === 'VALIDE'; }, 'montant_autorise'),
      dotations_remises: som(dot, function (r) { return ['REMISE_DECLAREE', 'CONFIRMEE', 'CONTESTEE'].indexOf(r.statut) >= 0; }, 'montant_remis'),
      frais_mobile_money: som(dot, function (r) { return ['REMISE_DECLAREE', 'CONFIRMEE', 'CONTESTEE'].indexOf(r.statut) >= 0; }, 'frais_transaction'),
      remises_non_confirmees: som(dot, function (r) { return r.statut === 'REMISE_DECLAREE'; }, 'montant_remis'),
      dotations_recues: recues,
      achats_declares: som(carb, function (r) { return r.financement === 'DOTATION' && r.justificatif_statut !== 'REJETE'; }, 'montant'),
      justifies_verifies: justif,
      restitutions: restit,
      avance_a_apurer: recues - justif - restit,
      avances_personnelles_verifiees: som(carb, function (r) { return r.financement === 'AVANCE_PERSONNELLE' && r.justificatif_statut === 'VERIFIE'; }, 'montant'),
      remboursements_valides: som(rbt, function (r) { return r.statut === 'VALIDE' || r.statut === 'PAYE_DECLARE'; }, 'montant'),
      reste_a_rembourser: som(carb, function (r) { return r.financement === 'AVANCE_PERSONNELLE' && r.justificatif_statut === 'VERIFIE' && !r.remboursement_id; }, 'montant')
    };
  }

  /* -- 6. Disponibilité technique (miroir moto_v_disponibilite) ------------ */
  function jourIso(d) { var x = new Date(d); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())); }
  function disponibilite(miseEnService, immobilisations, aujourdhui, joursSemaine) {
    if (!miseEnService) return { jours_prevus: null, jours_indisponibles: null, taux: null };
    var js = estNombre(joursSemaine) ? Number(joursSemaine) : 6;
    var debut = jourIso(miseEnService), fin = jourIso(aujourdhui || new Date());
    var prevus = 0, indispo = 0;
    for (var d = new Date(debut); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
      var iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      if (iso > js) continue;
      prevus++;
      var t = d.getTime();
      var bloque = (immobilisations || []).some(function (im) {
        var a = jourIso(im.debut).getTime(), b = jourIso(im.fin || aujourdhui || new Date()).getTime();
        return a <= t && b >= t;
      });
      if (bloque) indispo++;
    }
    return { jours_prevus: prevus, jours_indisponibles: indispo, taux: prevus > 0 ? arrondi(100 * (prevus - indispo) / prevus, 1) : null };
  }

  /* -- 7. Coût direct au km (miroir moto_v_cout_km) ------------------------ */
  function coutKm(c) {
    if (!c) return null;
    var kmp = estNombre(c.km_fin) && estNombre(c.km_debut) ? Number(c.km_fin) - Number(c.km_debut) : null;
    var total = Number(c.cout_carburant_verifie || 0) + Number(c.cout_maintenance || 0) + Number(c.cout_pneus || 0) + Number(c.cout_incidents || 0);
    return { km_parcourus: kmp, cout_direct_total: total, fcfa_km: kmp > 0 ? arrondi(total / kmp, 1) : null };
  }

  /* -- 8. Contrôles de sécurité -------------------------------------------
     Liste proposée pour le pilote : elle est à valider par ANAGROCI. Le
     caractère critique d'un point est recalculé par le serveur. */
  var CONTROLE_DEPART = [
    { code: 'FREIN_AVANT', libelle: 'Frein avant efficace', critique: true },
    { code: 'FREIN_ARRIERE', libelle: 'Frein arrière efficace', critique: true },
    { code: 'PNEUS', libelle: 'Pneus : pression correcte, sans coupure ni hernie', critique: true },
    { code: 'DIRECTION', libelle: 'Direction souple, sans jeu', critique: true },
    { code: 'FUITES', libelle: 'Aucune fuite de carburant ou d\'huile', critique: true },
    { code: 'CASQUE', libelle: 'Casque porté et attaché', critique: true },
    { code: 'ECLAIRAGE', libelle: 'Phare, feu arrière, clignotants', critique: false },
    { code: 'KLAXON', libelle: 'Klaxon', critique: false },
    { code: 'RETROVISEURS', libelle: 'Rétroviseurs en place', critique: false },
    { code: 'CHAINE', libelle: 'Chaîne tendue et graissée', critique: false },
    { code: 'NIVEAU_HUILE', libelle: 'Niveau d\'huile visible', critique: false },
    { code: 'GILET', libelle: 'Gilet haute visibilité porté', critique: false }
  ];
  var INSPECTION_INITIALE = CONTROLE_DEPART.concat([
    { code: 'CADRE', libelle: 'Cadre et fourche sans fissure ni déformation', critique: true },
    { code: 'NUMEROS', libelle: 'Numéros châssis et moteur lisibles et conformes aux documents', critique: false },
    { code: 'BATTERIE', libelle: 'Batterie et démarrage', critique: false }
  ]).filter(function (x) { return x.code !== 'CASQUE' && x.code !== 'GILET'; });
  function anomalieCritique(items) {
    return (items || []).some(function (i) { return i && i.critique === true && i.ok === false; });
  }
  function resultatControle(items) {
    if (!items || !items.length) return null;
    return items.some(function (i) { return i.ok === false; }) ? 'INAPTE' : 'APTE';
  }

  /* -- 9. Validations de saisie terrain (avant mise en file) --------------- */
  function validerCarburant(f) {
    var e = [];
    if (!f.moto_id) e.push('Moto obligatoire.');
    if (!f.date_achat) e.push('Date d\'achat obligatoire.');
    else if (new Date(f.date_achat).getTime() > Date.now() + 15 * 60000) e.push('Date d\'achat dans le futur.');
    if (!(nombreSaisi(f.compteur_km) >= 0)) e.push('Compteur obligatoire.');
    var l = nombreSaisi(f.litres);
    if (!(l > 0 && l <= 60)) e.push('Litres : entre 0 et 60.');
    if (!(nombreSaisi(f.montant) > 0)) e.push('Montant payé obligatoire.');
    if (f.plein_complet !== true && f.plein_complet !== false) e.push('Préciser plein complet ou partiel.');
    if (f.financement !== 'DOTATION' && f.financement !== 'AVANCE_PERSONNELLE') e.push('Préciser le financement.');
    if (!f.avec_justificatif) e.push('Photographie du justificatif obligatoire.');
    return e;
  }
  function validerReleve(f, compteurConnu) {
    var e = [], v = nombreSaisi(f.compteur_km);
    if (!(v >= 0)) e.push('Compteur obligatoire.');
    else if (estNombre(compteurConnu) && v < Number(compteurConnu)) e.push('Compteur inférieur au dernier relevé connu (' + km(compteurConnu) + ') : demandez une correction.');
    return e;
  }
  function validerIncident(f) {
    var e = [];
    if (['PANNE', 'ACCIDENT', 'CREVAISON', 'ANOMALIE'].indexOf(f.type_incident) < 0) e.push('Type d\'incident obligatoire.');
    if (['MINEURE', 'MAJEURE', 'CRITIQUE'].indexOf(f.gravite) < 0) e.push('Gravité obligatoire.');
    if (String(f.description || '').trim().length < 10) e.push('Description : 10 caractères minimum.');
    return e;
  }
  /* Une immobilisation de sécurité ne doit pas attendre le réseau. */
  function exigeImmobilisation(op) {
    if (!op) return false;
    if (op.type === 'INCIDENT') return op.payload.gravite === 'CRITIQUE' || op.payload.type_incident === 'ACCIDENT' || op.payload.immobiliser === true;
    if (op.type === 'CONTROLE_DEPART' || op.type === 'INSPECTION_MENSUELLE') return anomalieCritique(op.payload.items);
    if (op.type === 'ACTION_SIGNALER') return op.payload.gravite === 'CRITIQUE';
    return false;
  }

  /* -- 10. File hors connexion : planification et application ------------ */
  var MAX_TENTATIVES = 5;
  var TYPES_HORS_LIGNE = ['RELEVE_KM', 'CONTROLE_DEPART', 'CARBURANT', 'INCIDENT', 'DOTATION_CONFIRMER', 'MAINTENANCE_DEMANDE', 'FORMATION',
                          'INSPECTION_MENSUELLE', 'ACTION_SIGNALER', 'DEPENSE', 'MISSION_DEPART', 'MISSION_ARRIVEE'];
  function delaiReprise(tentatives) { return Math.min(30 * 60000, 15000 * Math.pow(2, Math.max(0, tentatives - 1))); }
  function operationsEligibles(ops, maintenant, limite) {
    var t = maintenant || Date.now();
    // Une fin de mission ne part jamais avant que son départ soit reçu par le serveur.
    var departsNonRecus = {};
    (ops || []).forEach(function (o) { if (o.type === 'MISSION_DEPART' && o.statut !== 'SYNCHRONISE' && o.payload) departsNonRecus[o.payload.mission_id] = true; });
    return (ops || []).filter(function (o) {
      if (o.statut !== 'EN_ATTENTE') return false;
      if (o.type === 'MISSION_ARRIVEE' && o.payload && departsNonRecus[o.payload.mission_id]) return false;
      if ((o.tentatives || 0) >= MAX_TENTATIVES) return false;
      return !o.prochaine_tentative || new Date(o.prochaine_tentative).getTime() <= t;
    }).sort(function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); }).slice(0, limite || 20);
  }
  /* Résultat serveur → nouvel état local. Une opération n'est réputée faite
     QUE sur réponse SYNCHRONISE du serveur. */
  function appliquerResultat(op, res, maintenant) {
    var t = maintenant || Date.now();
    var o = Object.assign({}, op);
    var st = res && res.statut;
    if (st === 'SYNCHRONISE') { o.statut = 'SYNCHRONISE'; o.message = res.doublon ? 'Déjà reçu par le serveur (aucun doublon créé).' : null; o.resultat = res.resultat || null; o.synchronise_le = new Date(t).toISOString(); }
    else if (st === 'REJETE') { o.statut = 'REJETE'; o.message = res.message || 'Rejeté par le serveur.'; }
    else {
      o.tentatives = (o.tentatives || 0) + 1;
      o.message = (res && res.message) || 'Réseau ou serveur indisponible : nouvelle tentative automatique.';
      if (o.tentatives >= MAX_TENTATIVES) { o.statut = 'BLOQUE'; o.message = 'Échecs répétés : relance manuelle nécessaire. ' + o.message; }
      else { o.statut = 'EN_ATTENTE'; o.prochaine_tentative = new Date(t + delaiReprise(o.tentatives)).toISOString(); }
    }
    return o;
  }
  function resumeFile(ops) {
    var r = { EN_ATTENTE: 0, SYNCHRONISE: 0, REJETE: 0, BLOQUE: 0 };
    (ops || []).forEach(function (o) { if (r[o.statut] !== undefined) r[o.statut]++; });
    return r;
  }

  /* -- 11. Limites d'observation (jamais de statistique sans contexte) ---- */
  function avertissementEchantillon(nbMotos, nbIntervalles) {
    if (!nbMotos) return 'Aucune moto en service : indicateurs non disponibles.';
    if (nbMotos < 10 || (nbIntervalles !== undefined && nbIntervalles < 10)) {
      return 'Observation limitée : ' + nbMotos + ' moto(s)' + (nbIntervalles !== undefined ? ', ' + nbIntervalles + ' intervalle(s) plein à plein' : '') +
        '. Ces valeurs décrivent le pilote ; elles ne constituent pas une référence statistique.';
    }
    return null;
  }


  /* -- 12. AFLP FLEET : inspections, actions, exceptions ------------------ */
  /* Copies de secours (hors connexion) du catalogue serveur moto_catalogue_points.
     La gravité RÉELLE est toujours celle du serveur : ces listes ne servent qu'à l'affichage. */
  var ETAT_REMISE = [
    { code: 'CARROSSERIE', libelle: 'Carrosserie, carénages et selle : état constaté et photographié', critique: false },
    { code: 'PNEUS_ETAT', libelle: 'Pneus : usure et état visibles, sans coupure ni hernie', critique: true },
    { code: 'ECLAIRAGE', libelle: 'Éclairage et clignotants fonctionnent', critique: false },
    { code: 'COMPTEUR_FONCTIONNE', libelle: 'Compteur kilométrique lisible et fonctionnel', critique: false },
    { code: 'RETROVISEURS', libelle: 'Rétroviseurs présents', critique: false },
    { code: 'CLES', libelle: 'Clés remises (nombre noté en observation)', critique: false },
    { code: 'OUTILLAGE', libelle: 'Trousse à outils remise', critique: false },
    { code: 'DOCUMENTS_BORD', libelle: 'Copies des documents de bord remises', critique: false }
  ];
  var INSPECTION_MENSUELLE = [
    { code: 'ETAT_GENERAL', libelle: 'État général (carrosserie, selle, cadre visible)', critique: false },
    { code: 'COMPTEUR_FONCTIONNE', libelle: 'Compteur kilométrique lisible et fonctionnel', critique: false },
    { code: 'PNEUS', libelle: 'Pneus : usure, pression, sans coupure ni hernie', critique: true },
    { code: 'FREIN_AVANT', libelle: 'Frein avant efficace', critique: true },
    { code: 'FREIN_ARRIERE', libelle: 'Frein arrière efficace', critique: true },
    { code: 'DIRECTION', libelle: 'Direction souple, sans jeu', critique: true },
    { code: 'FUITES', libelle: 'Aucune fuite de carburant ou d\'huile', critique: true },
    { code: 'TRANSMISSION', libelle: 'Transmission : chaîne, pignons, tension', critique: false },
    { code: 'ECLAIRAGE', libelle: 'Phare, feu arrière, clignotants', critique: false },
    { code: 'DOCUMENTS', libelle: 'Documents de bord présents et valides', critique: false },
    { code: 'EQUIPEMENTS', libelle: 'Casque et gilet présents et en bon état', critique: false }
  ];
  var CATALOGUE_SECOURS = { AVANT_DEPART: CONTROLE_DEPART, INSPECTION_INITIALE: INSPECTION_INITIALE, REMISE_EN_SERVICE: INSPECTION_INITIALE,
                            ETAT_REMISE: ETAT_REMISE, INSPECTION_MENSUELLE: INSPECTION_MENSUELLE };
  /* Catalogue serveur (lignes moto_catalogue_points) → liste d'affichage d'un type ; secours si absent. */
  function listeControle(type, lignes) {
    var l = (lignes || []).filter(function (x) { return x.type_controle === type && x.actif !== false; })
      .sort(function (a, b) { return a.ordre - b.ordre; }).map(function (x) { return { code: x.code, libelle: x.libelle, critique: !!x.critique }; });
    return l.length ? l : (CATALOGUE_SECOURS[type] || []);
  }

  /* Fenêtres mensuelles (mandat §8) : ZONE du 1er au 15, préparation du 16 au 19,
     COORDINATION et contrôle INDÉPENDANT du 20 au dernier jour. */
  function fenetreInspection(niveau, dateRef, params) {
    params = params || {};
    var d = new Date(dateRef || Date.now()), an = d.getUTCFullYear(), mo = d.getUTCMonth();
    var fin = new Date(Date.UTC(an, mo + 1, 0)).getUTCDate();
    var jf = params.zone_fin || 15, jd = params.coordination_debut || 20;
    var iso = function (j) { return new Date(Date.UTC(an, mo, j)).toISOString().slice(0, 10); };
    return niveau === 'ZONE' ? { debut: iso(1), fin: iso(jf) } : { debut: iso(jd), fin: iso(fin) };
  }
  function phaseDuMois(dateRef, params) {
    params = params || {};
    var j = new Date(dateRef || Date.now()).getUTCDate();
    if (j <= (params.zone_fin || 15)) return { code: 'ZONE', libelle: 'Inspections des Chefs de zone (du 1er au ' + (params.zone_fin || 15) + ')' };
    if (j < (params.coordination_debut || 20)) return { code: 'PREPARATION', libelle: 'Préparation des visites du coordinateur (du ' + ((params.zone_fin || 15) + 1) + ' au ' + ((params.coordination_debut || 20) - 1) + ')' };
    return { code: 'COORDINATION', libelle: 'Inspections du coordinateur logistique (du ' + (params.coordination_debut || 20) + ' à la fin du mois)' };
  }
  /* Couverture = inspections faites dans la période / inspections exigibles échues ou faites.
     Une inspection encore programmée (fenêtre ouverte) n'entre pas au dénominateur. */
  function couvertureInspections(lignes) {
    var echues = (lignes || []).filter(function (x) { return x.statut !== 'PROGRAMMEE'; });
    var ok = echues.filter(function (x) { return x.statut === 'EFFECTUEE'; }).length;
    return { exigibles: echues.length, dans_delai: ok, hors_delai: echues.filter(function (x) { return x.statut === 'EFFECTUEE_HORS_DELAI'; }).length,
             non_effectuees: echues.filter(function (x) { return x.statut === 'NON_EFFECTUEE'; }).length,
             programmees: (lignes || []).filter(function (x) { return x.statut === 'PROGRAMMEE'; }).length,
             taux: echues.length ? arrondi(100 * ok / echues.length, 1) : null };
  }
  /* Résolution dans les délais = actions clôturées à temps / actions arrivées à échéance (date cible passée ou clôturées). */
  function resolutionActions(actions, aujourdhuiIso) {
    var t = aujourdhuiIso || new Date().toISOString().slice(0, 10);
    var echues = (actions || []).filter(function (a) { return a.date_cible && a.statut !== 'ANNULEE' && (a.statut === 'CLOTUREE' || a.date_cible < t); });
    var ok = echues.filter(function (a) { return a.statut === 'CLOTUREE' && a.verifie_at && String(a.verifie_at).slice(0, 10) <= a.date_cible; }).length;
    return { echues: echues.length, a_temps: ok, taux: echues.length ? arrondi(100 * ok / echues.length, 1) : null };
  }
  /* Situation lisible : prévue, réceptionnée, affectée, opérationnelle (4 situations distinctes). */
  function situationMoto(m) {
    if (!m) return null;
    if (m.situation_parc === 'PREVUE') return { code: 'PREVUE', libelle: 'Acquisition prévue' };
    if (m.autorisee_a_circuler) return { code: 'OPERATIONNELLE', libelle: 'Opérationnelle' };
    if (['REMISE', 'TRANSFEREE', 'PREAFFECTEE'].indexOf(m.statut_affectation) >= 0) return { code: 'AFFECTEE', libelle: m.statut_affectation === 'PREAFFECTEE' ? 'Préaffectée' : 'Affectée, non opérationnelle' };
    return { code: 'RECEPTIONNEE', libelle: 'Réceptionnée' };
  }
  /* Exceptions pour le Branch Manager : uniquement ce qui exige une décision. */
  function exceptionsDirection(flotte, exigibles, actions, enveloppes, aujourdhuiIso) {
    var t = aujourdhuiIso || new Date().toISOString().slice(0, 10), out = [];
    (flotte || []).forEach(function (m) {
      if (m.situation_parc !== 'PREVUE' && ['IMMOBILISEE', 'EN_REPARATION'].indexOf(m.statut_technique) >= 0)
        out.push({ gravite: 1, type: 'Moto immobilisée', moto: m.code, detail: libelle(m.statut_technique) + (m.actions_critiques_ouvertes ? ' · ' + m.actions_critiques_ouvertes + ' anomalie(s) critique(s) ouverte(s)' : ''), moto_id: m.id });
      else if (Number(m.actions_critiques_ouvertes) > 0)
        out.push({ gravite: 1, type: 'Anomalie critique ouverte', moto: m.code, detail: m.actions_critiques_ouvertes + ' anomalie(s)', moto_id: m.id });
    });
    (actions || []).forEach(function (a) {
      if (['OUVERTE', 'PLANIFIEE', 'REALISEE'].indexOf(a.statut) < 0) return;
      if (a.date_cible && a.date_cible < t) out.push({ gravite: 2, type: 'Réparation en retard', moto: a.moto_code, detail: a.anomalie + ' · échéance ' + a.date_cible, moto_id: a.moto_id });
      else if (a.recurrente) out.push({ gravite: 3, type: 'Anomalie récurrente', moto: a.moto_code, detail: a.anomalie + ' · ' + a.occurrences + ' constat(s)', moto_id: a.moto_id });
    });
    (exigibles || []).forEach(function (x) {
      if (x.statut === 'NON_EFFECTUEE') out.push({ gravite: 2, type: 'Inspection manquante', moto: x.code, detail: libelleNiveau(x.niveau) + ' · ' + x.periode.slice(0, 7), moto_id: x.moto_id });
    });
    (enveloppes || []).forEach(function (e) {
      if (e.statut === 'DEMANDEE') out.push({ gravite: 3, type: 'Dépense à autoriser', moto: '—', detail: 'Enveloppe ' + libelle(e.type_enveloppe) + ' · ' + fcfa(e.montant_demande), enveloppe_id: e.id });
    });
    var actives = (flotte || []).filter(function (m) { return m.mise_en_service_at; });
    var indispo = actives.filter(function (m) { return !m.autorisee_a_circuler; }).length;
    if (actives.length && indispo / actives.length >= 0.25)
      out.push({ gravite: 1, type: 'Risque d\'interruption AFLP', moto: '—', detail: indispo + ' moto(s) active(s) sur ' + actives.length + ' ne peuvent pas circuler' });
    return out.sort(function (a, b) { return a.gravite - b.gravite; });
  }
  function libelleNiveau(n) { return { ZONE: 'Chef de zone', COORDINATION: 'Coordinateur logistique', INDEPENDANTE: 'Contrôle indépendant' }[n] || n; }

  return {
    classeDepuisProfil: classeDepuisProfil, ETAT_REMISE: ETAT_REMISE, INSPECTION_MENSUELLE: INSPECTION_MENSUELLE, listeControle: listeControle,
    fenetreInspection: fenetreInspection, phaseDuMois: phaseDuMois, couvertureInspections: couvertureInspections, resolutionActions: resolutionActions,
    situationMoto: situationMoto, exceptionsDirection: exceptionsDirection, libelleNiveau: libelleNiveau,
    ND: ND, CLASSES: CLASSES, DROITS: DROITS, classeDepuisRole: classeDepuisRole, peut: peut, libelle: libelle,
    fcfa: fcfa, km: km, l100: l100, pct: pct, dateFr: dateFr, dateHeureFr: dateHeureFr, nombreSaisi: nombreSaisi, estNombre: estNombre,
    consoPleinAPlein: consoPleinAPlein, statutAlerte: statutAlerte, rapprochement: rapprochement, disponibilite: disponibilite, coutKm: coutKm,
    CONTROLE_DEPART: CONTROLE_DEPART, INSPECTION_INITIALE: INSPECTION_INITIALE, anomalieCritique: anomalieCritique, resultatControle: resultatControle,
    validerCarburant: validerCarburant, validerReleve: validerReleve, validerIncident: validerIncident, exigeImmobilisation: exigeImmobilisation,
    MAX_TENTATIVES: MAX_TENTATIVES, TYPES_HORS_LIGNE: TYPES_HORS_LIGNE, delaiReprise: delaiReprise, operationsEligibles: operationsEligibles,
    appliquerResultat: appliquerResultat, resumeFile: resumeFile, avertissementEchantillon: avertissementEchantillon
  };
});

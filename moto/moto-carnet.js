/* ============================================================================
   AFLP FLEET — carnet de suivi d'une moto (moto/moto-carnet.js)
   ----------------------------------------------------------------------------
   Toute la vie de la moto sur une seule page, de la plus récente à la plus
   ancienne : réception, affectations, inspections, anomalies, entretiens et
   réparations (besoin → travaux → contrôle → clôture), décisions du Branch
   Manager, factures et paiements, pneus, carburant (synthèse mensuelle),
   incidents, immobilisations, documents.
   Source : fonction serveur moto_carnet (migration 7), qui applique le
   périmètre et masque les montants d'entretien sans droit financier.
   Coûts : vues moto_v_couts et moto_v_cout_km existantes (aucun double
   comptage : une facture n'est comptée qu'une fois, le paiement est distinct).
   ========================================================================== */
(function (g) {
  'use strict';
  g.MOTO_CARNET = function (I) {
    var C = I.C, esc = I.esc, $$ = I.$$, rpc = I.rpc, lire = I.lireTable, kpi = I.kpi, ND = C.ND;
    var FILTRES = [['TOUT', 'Tout'], ['MAINTENANCE', 'Entretiens et réparations'], ['FINANCES', 'Décisions et factures'], ['CONTROLE', 'Contrôles et anomalies'],
      ['PNEU', 'Pneus'], ['CARBURANT', 'Carburant'], ['INCIDENT', 'Incidents et immobilisations'], ['AFFECTATION', 'Affectations et parc'], ['DOCUMENT', 'Documents']];
    var GROUPE = { MAINTENANCE: 'MAINTENANCE', AUTORISATION: 'FINANCES', FACTURE: 'FINANCES', CONTROLE: 'CONTROLE', ANOMALIE: 'CONTROLE', PNEU: 'PNEU',
      CARBURANT: 'CARBURANT', INCIDENT: 'INCIDENT', IMMOBILISATION: 'INCIDENT', AFFECTATION: 'AFFECTATION', PARC: 'AFFECTATION', DOCUMENT: 'DOCUMENT' };
    var LIB_CAT = { MAINTENANCE: 'Entretien', AUTORISATION: 'Décision BM', FACTURE: 'Facture', CONTROLE: 'Contrôle', ANOMALIE: 'Anomalie', PNEU: 'Pneu',
      CARBURANT: 'Carburant', INCIDENT: 'Incident', IMMOBILISATION: 'Immobilisation', AFFECTATION: 'Affectation', PARC: 'Parc', DOCUMENT: 'Document' };
    var LIB_NATURE = { AUTORISE: 'autorisé', FACTURE: 'facturé', PAYE: 'payé', PNEU: 'pneu', CARBURANT: 'carburant' };
    var cache = { moto: null, lignes: [], couts: null, km: null, filtre: 'TOUT' };

    function mois(d) { var x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); }
    function joursImmobilisation(lignes) {
      var par = {};
      lignes.filter(function (l) { return l.categorie === 'IMMOBILISATION'; }).forEach(function (l) {
        var x = par[l.source_id] || (par[l.source_id] = {});
        if (l.evenement === 'Immobilisation') x.debut = new Date(l.date_evenement); else x.fin = new Date(l.date_evenement);
      });
      var total = 0;
      Object.keys(par).forEach(function (k) { var x = par[k]; if (x.debut) total += Math.max(0, ((x.fin || new Date()) - x.debut) / 86400000); });
      return Math.round(total * 10) / 10;
    }

    async function onglet(m) {
      var r = await Promise.all([rpc('moto_carnet', { p_moto: m.id }),
        lire('moto_v_couts', function (q) { return q.eq('moto_id', m.id); }).catch(function () { return []; }),
        lire('moto_v_cout_km', function (q) { return q.eq('moto_id', m.id); }).catch(function () { return []; })]);
      cache = { moto: m, lignes: r[0] || [], couts: (r[1] || [])[0] || null, km: (r[2] || [])[0] || null, filtre: cache.moto && cache.moto.id === m.id ? cache.filtre : 'TOUT' };
      return rendu();
    }
    function rendu() {
      var m = cache.moto, L = cache.lignes, c = cache.couts || {}, k = cache.km || {}, fin = c.cout_maintenance != null;
      var dossiers = {}; L.forEach(function (l) { if (l.source === 'moto_maintenances') dossiers[l.source_id] = 1; });
      var nbDossiers = Object.keys(dossiers).length, travaux = L.filter(function (l) { return l.evenement.indexOf('Travaux réalisés') === 0; }).length;
      var inc = {}; L.forEach(function (l) { if (l.categorie === 'INCIDENT') inc[l.source_id] = 1; });
      var vis = L.filter(function (l) { return cache.filtre === 'TOUT' || GROUPE[l.categorie] === cache.filtre; });
      var html = '<div class="mm-carnet" data-carnet>' +
        '<div class="mm-carnet-entete"><div><h2>Carnet de suivi · ' + esc(m.code) + '</h2><p class="mm-note">' + esc(I.nomMoto(m)) + ' · ' + esc(m.immatriculation || 'immatriculation en attente') +
        (m.date_debut_suivi ? ' · suivi fiable depuis le ' + esc(C.dateFr(m.date_debut_suivi)) : '') + '</p></div>' +
        '<div class="mm-actions mm-sans-impression">' + I.action('carnet_export', 'Exporter (Excel)', {}, 'mm-primaire') + ' ' + I.action('carnet_imprimer', 'Imprimer / PDF', {}) + '</div></div>' +
        '<div class="mm-kpis">' +
        kpi('Coût d\'entretien documenté', fin ? C.fcfa(c.cout_maintenance) : 'Accès réservé', fin ? 'factures vérifiées (une seule fois chacune)' : 'montants visibles du BM, de l\'ABM, de la Finance, de la Direction et du coordinateur') +
        kpi('Carburant vérifié', C.fcfa(c.cout_carburant_verifie), c.cout_carburant_a_verifier ? C.fcfa(c.cout_carburant_a_verifier) + ' encore à vérifier' : 'justificatifs vérifiés') +
        kpi('Coût direct par km', k.fcfa_km != null && fin ? C.fcfa(k.fcfa_km) + '/km' : ND, k.km_parcourus != null ? C.km(k.km_parcourus) + ' depuis la mise en service' : 'kilométrage fiable insuffisant') +
        kpi('Interventions', String(nbDossiers), travaux + ' réalisée(s) · ' + Object.keys(inc).length + ' incident(s)') +
        kpi('Immobilisation cumulée', joursImmobilisation(L).toString().replace('.', ',') + ' j', 'depuis le début du suivi') +
        (fin ? kpi('Engagé non facturé', C.fcfa(c.engage_non_facture), 'factures en attente de vérification : ' + C.fcfa(c.facture_non_justifiee)) : '') + '</div>' +
        '<nav class="mm-carnet-filtres mm-sans-impression" aria-label="Filtrer le carnet">' + FILTRES.map(function (f) {
          var n = f[0] === 'TOUT' ? L.length : L.filter(function (l) { return GROUPE[l.categorie] === f[0]; }).length;
          if (!n && f[0] !== 'TOUT') return '';
          return '<button type="button" class="mm-filtre' + (cache.filtre === f[0] ? ' mm-actif' : '') + '" data-action="carnet_filtre" data-f="' + f[0] + '" aria-pressed="' + (cache.filtre === f[0]) + '">' + esc(f[1]) + ' <span>' + n + '</span></button>';
        }).join('') + '</nav>';
      if (!vis.length) return html + '<div class="mm-vide">Aucun événement enregistré' + (cache.filtre === 'TOUT' ? ' pour cette moto.' : ' dans cette rubrique.') + '</div></div>';
      var courant = '';
      html += '<ol class="mm-carnet-liste">';
      vis.forEach(function (l) {
        var mo = mois(l.date_evenement);
        if (mo !== courant) { courant = mo; html += '<li class="mm-carnet-mois" aria-hidden="false"><h3>' + esc(mo.charAt(0).toUpperCase() + mo.slice(1)) + '</h3></li>'; }
        html += '<li class="mm-carnet-ev mm-cat-' + esc(GROUPE[l.categorie] || 'AUTRE').toLowerCase() + '">' +
          '<div class="mm-carnet-date"><b>' + esc(C.dateFr(l.date_evenement)) + '</b><span class="mm-carnet-cat">' + esc(LIB_CAT[l.categorie] || l.categorie) + '</span></div>' +
          '<div class="mm-carnet-corps"><b>' + esc(l.evenement) + '</b>' + (l.detail ? '<p>' + esc(l.detail) + '</p>' : '') +
          '<div class="mm-carnet-meta">' + (l.statut ? I.badge(l.statut) : '') + (l.compteur_km != null ? '<span>' + esc(C.km(l.compteur_km)) + '</span>' : '') +
          (l.acteur ? '<span>' + esc(l.acteur) + '</span>' : '') + '</div></div>' +
          (l.montant != null ? '<div class="mm-carnet-montant"><b>' + esc(C.fcfa(l.montant)) + '</b><small>' + esc(LIB_NATURE[l.montant_nature] || '') + '</small></div>' : '') + '</li>';
      });
      return html + '</ol><p class="mm-note">Les contrôles avant départ sans défaut, les relevés kilométriques et le détail des pleins restent dans leurs onglets. Aucun événement antérieur au suivi n\'est reconstitué : ce qui n\'a pas été documenté n\'apparaît pas.</p></div>';
    }

    var ACT = {
      carnet_filtre: function (d) { cache.filtre = d.f; var z = document.querySelector('[data-carnet]'); if (z) z.outerHTML = rendu(); },
      carnet_imprimer: function () {
        document.body.classList.add('mm-impression-carnet');
        var fin = function () { document.body.classList.remove('mm-impression-carnet'); window.removeEventListener('afterprint', fin); };
        window.addEventListener('afterprint', fin); window.print(); setTimeout(fin, 60000);
      },
      carnet_export: async function () {
        try {
          if (!g.XLSX) await I.chargerScript(I.CDN_XLSX);
          var m = cache.moto, c = cache.couts || {}, k = cache.km || {}, wb = g.XLSX.utils.book_new();
          var rows = cache.lignes.map(function (l) {
            return { 'Date': C.dateFr(l.date_evenement), 'Rubrique': LIB_CAT[l.categorie] || l.categorie, 'Événement': l.evenement, 'Détail': l.detail || '',
              'Statut': l.statut ? C.libelle(l.statut) : '', 'Compteur (km)': l.compteur_km == null ? '' : Number(l.compteur_km),
              'Montant (FCFA)': l.montant == null ? '' : Number(l.montant), 'Nature du montant': LIB_NATURE[l.montant_nature] || '', 'Par': l.acteur || '' };
          });
          var synth = [
            { Indicateur: 'Moto', Valeur: m.code + ' · ' + I.nomMoto(m) }, { Indicateur: 'Immatriculation', Valeur: m.immatriculation || 'En attente' },
            { Indicateur: 'Coût d\'entretien documenté (factures vérifiées)', Valeur: c.cout_maintenance == null ? 'Accès réservé' : Number(c.cout_maintenance) },
            { Indicateur: 'Carburant vérifié', Valeur: Number(c.cout_carburant_verifie || 0) }, { Indicateur: 'Kilomètres fiables parcourus', Valeur: k.km_parcourus == null ? ND : Number(k.km_parcourus) },
            { Indicateur: 'Coût direct par km', Valeur: k.fcfa_km == null || c.cout_maintenance == null ? ND : Number(k.fcfa_km) },
            { Indicateur: 'Immobilisation cumulée (jours)', Valeur: joursImmobilisation(cache.lignes) },
            { Indicateur: 'Exporté le', Valeur: C.dateHeureFr(new Date().toISOString()) }];
          g.XLSX.utils.book_append_sheet(wb, g.XLSX.utils.json_to_sheet(synth), 'Synthèse');
          g.XLSX.utils.book_append_sheet(wb, g.XLSX.utils.json_to_sheet(rows.length ? rows : [{ Information: 'Aucun événement' }]), 'Carnet');
          g.XLSX.writeFile(wb, 'ANAGROCI_AFLP_FLEET_Carnet_' + m.code + '_' + I.aujourdhui() + '.xlsx', { compression: true });
        } catch (e) { I.toast('Export impossible : ' + I.messageErreur(e), 'ko'); }
      }
    };
    return { onglet: onglet, actions: ACT };
  };
})(window);

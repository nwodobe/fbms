/* ============================================================================
   AFLP FLEET — maintenance, garages, autorisation BM (moto/moto-maintenance.js)
   ----------------------------------------------------------------------------
   Espace « Maintenance » : tableau de bord du coordinateur, « Décisions à
   prendre » du Branch Manager, dossiers, garages, règles versionnées.
   Règle fondamentale : aucune dépense d'entretien ou de réparation n'est
   engagée sans autorisation individuelle préalable du Branch Manager.
   Les boutons ne sont que des propositions : chaque étape est vérifiée par
   les fonctions serveur (migration 6). Masquer un bouton ne protège rien.
   ========================================================================== */
(function (g) {
  'use strict';
  g.MOTO_MAINTENANCE = function (I) {
    var C = I.C, esc = I.esc, $ = I.$, $$ = I.$$, tableau = I.tableau, action = I.action, champ = I.champ, modale = I.modale,
        rpc = I.rpc, lire = I.lireTable, peut = I.peut, kpi = I.kpi, ND = C.ND;

    /* -- Libellés et tons ---------------------------------------------------- */
    var LIB = {
      DEMANDEE: 'Besoin identifié', DIAGNOSTIC: 'Diagnostic à organiser', DEVIS_RECU: 'Devis reçu', EN_ATTENTE_BM: 'En attente du Branch Manager',
      AUTORISEE: 'Autorisé par le BM', REFUSEE: 'Refusé par le BM', PROGRAMMEE: 'Travaux programmés', EN_COURS: 'Travaux en cours',
      TERMINEE: 'Travaux effectués, à contrôler', CONTROLEE: 'Contrôlé conforme', CLOTUREE: 'Dossier clôturé', ANNULEE: 'Annulé',
      A_JOUR: 'À jour', RAPPEL: 'Rappel de planification', PROCHE: 'Échéance proche', ATTEINTE: 'Échéance atteinte', DEPASSEE: 'Entretien dépassé',
      DIAGNOSTIC_INITIAL_REQUIS: 'Diagnostic initial et historique d\'entretien à établir', ETAT_REFERENCE_REQUIS: 'Échéance non calculable : état de référence requis',
      REGLE_NON_APPROUVEE: 'Règle non approuvée par le BM', NON_CALCULABLE: 'Non calculable (compteur inconnu)',
      CANDIDAT: 'Candidat', EVALUE: 'Évalué', APPROUVE: 'Approuvé par le BM', SUSPENDU: 'Suspendu',
      BROUILLON: 'Brouillon (inactif)', APPROUVEE: 'Approuvée (active)', REMPLACEE: 'Remplacée', RETIREE: 'Retirée',
      CONSTRUCTEUR: 'Prescription constructeur', POLITIQUE_INTERNE: 'Politique interne', HYPOTHESE: 'Hypothèse non validée',
      DEPOSEE: 'Déposée, à vérifier', VERIFIEE: 'Vérifiée', REJETEE: 'Rejetée', EN_ATTENTE: 'En attente de décision',
      PREVU: 'Prévu', REALISE: 'Réalisé', NON_REALISE: 'Non réalisé', DIAGNOSTIC_OP: 'Diagnostic',
      VIDANGE: 'Vidange', ENTRETIEN: 'Entretien préventif', REVISION: 'Révision générale', REPARATION: 'Réparation', PNEUMATIQUE: 'Pneumatique', AUTRE: 'Autre',
      TRAVAUX: 'Travaux', SUPPLEMENT: 'Supplément', NORMALE: 'Normale', PRIORITAIRE: 'Prioritaire', SECURITE: 'Sécurité',
      ENTRETIEN_VERIFIE: 'Dernier entretien vérifié', MISE_EN_SERVICE: 'Mise en service', VERIFIEE_F: 'Fiable', KM_ANCIEN: 'Compteur à relever (> 14 j)',
      BASE_MISE_EN_SERVICE: 'Base : mise en service', NON_DISPONIBLE: ND, RODAGE: 'Rodage', RECURRENT: 'Récurrent'
    };
    var TON = { A_JOUR: 'ok', RAPPEL: 'info', PROCHE: 'warn', ATTEINTE: 'warn', DEPASSEE: 'ko', DIAGNOSTIC_INITIAL_REQUIS: 'warn', ETAT_REFERENCE_REQUIS: 'warn',
      REGLE_NON_APPROUVEE: 'neutre', CONTROLEE: 'ok', CLOTUREE: 'ok', AUTORISEE: 'ok', REFUSEE: 'ko', EN_ATTENTE_BM: 'warn', EN_ATTENTE: 'warn', APPROUVE: 'ok',
      APPROUVEE: 'ok', SUSPENDU: 'ko', HYPOTHESE: 'warn', VERIFIEE: 'ok', REJETEE: 'ko', DEPOSEE: 'warn', REALISE: 'ok', NON_REALISE: 'neutre',
      TERMINEE: 'warn', EN_COURS: 'info', PROGRAMMEE: 'info', SECURITE: 'ko', PRIORITAIRE: 'warn' };
    var PRIO = ['DEPASSEE', 'ATTEINTE', 'PROCHE', 'RAPPEL', 'ETAT_REFERENCE_REQUIS', 'DIAGNOSTIC_INITIAL_REQUIS'];
    function lib(c) { return LIB[c] || C.libelle(c); }
    function b(code, texte) { return '<span class="mm-badge mm-' + (TON[code] || 'neutre') + '">' + esc(texte || lib(code)) + '</span>'; }
    function fc(v) { return v == null ? ND : C.fcfa(v); }
    function jours(v) { return v == null ? ND : (v < 0 ? 'dépassé de ' + (-v) + ' j' : v + ' j'); }
    function kms(v) { return v == null ? ND : (v < 0 ? 'dépassé de ' + C.km(-v) : C.km(v)); }
    function fin() { return peut('maintenance_finances'); }
    function moi() { return I.S.profil.user_id; }
    function q(t, f) { return lire(t, f).catch(function () { return []; }); }
    function ops() { return ['VIDANGE', 'ENTRETIEN', 'REVISION', 'REPARATION', 'DIAGNOSTIC', 'PNEUMATIQUE', 'AUTRE'].map(function (o) { return [o, o === 'DIAGNOSTIC' ? 'Diagnostic' : lib(o)]; }); }
    function typesDossier() { return ['VIDANGE', 'ENTRETIEN_PREVENTIF', 'REVISION', 'REPARATION', 'PANNE', 'DIAGNOSTIC', 'PNEUMATIQUE'].map(function (t) { return [t, t === 'DIAGNOSTIC' ? 'Diagnostic' : t === 'PNEUMATIQUE' ? 'Pneumatique' : C.libelle(t)]; }); }
    function typeDepuisRegle(r) { return { VIDANGE: 'VIDANGE', ENTRETIEN: 'ENTRETIEN_PREVENTIF', REVISION: 'REVISION' }[r] || 'REPARATION'; }

    /* Pièce financière privée : finmaint/<moto>/<devis|facture>/<fichier> (lecture BM, ABM, Finance, Direction, coordinateur). */
    async function deposerPiece(motoId, cat, fichier) {
      if (!fichier) return null;
      if (fichier.size > 10 * 1048576) throw new Error('Fichier trop volumineux (10 Mo maximum).');
      var ext = /\.pdf$/i.test(fichier.name || '') || fichier.type === 'application/pdf' ? 'pdf' : (fichier.type === 'image/png' ? 'png' : 'jpg');
      var chemin = 'finmaint/' + motoId + '/' + cat + '/' + I.OFF.uuid() + '.' + ext;
      var r = await I.S.sb.storage.from('moto-documents').upload(chemin, fichier, { upsert: false, contentType: fichier.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg') });
      if (r.error) throw new Error('Dépôt de la pièce refusé : ' + I.messageErreur(r.error));
      return chemin;
    }

    /* -- Données ------------------------------------------------------------- */
    async function donnees() {
      var r = await Promise.all([
        q('moto_v_echeances'), q('moto_v_maintenance_dossiers', function (x) { return x.order('demande_at', { ascending: false }); }),
        fin() ? q('moto_v_decisions_bm', function (x) { return x.order('soumis_at', { ascending: false }).limit(200); }) : Promise.resolve([]),
        q('moto_v_garages', function (x) { return x.order('nom'); }), q('moto_regles_versions', function (x) { return x.order('regle_code').order('version', { ascending: false }); }),
        q('moto_modeles_techniques'), q('moto_v_cout_km'), fin() ? q('moto_v_exceptions_bm') : Promise.resolve([]), q('moto_regles_maintenance'), q('moto_v_couts')]);
      // moto_v_cout_km donne les kilomètres suivis ; moto_v_couts les montants engagés, non vérifiés et payés.
      var couts = r[6].map(function (c) { var x = r[9].filter(function (y) { return y.moto_id === c.moto_id; })[0] || {}; return Object.assign({}, x, c); });
      return { ech: r[0], dossiers: r[1], decisions: r[2], garages: r[3], versions: r[4], modeles: r[5], couts: couts, exceptions: r[7], regles: r[8] };
    }
    function garageEnvisage(D, m) {
      if (!m) return null;
      var gs = D.garages.filter(function (x) { return x.statut !== 'SUSPENDU' && (x.clusters || []).indexOf(m.cluster_code) >= 0; });
      gs.sort(function (a, c) { return (a.statut === 'APPROUVE' ? 0 : 1) - (c.statut === 'APPROUVE' ? 0 : 1); });
      return gs[0] || null;
    }

    /* -- Espace Maintenance --------------------------------------------------- */
    var ONGLETS = [['tableau', 'Tableau de bord'], ['decisions', 'Décisions à prendre'], ['dossiers', 'Dossiers'], ['garages', 'Garages'], ['regles', 'Règles d\'entretien']];
    async function vue(onglet) {
      onglet = onglet || (peut('maintenance_autoriser') ? 'decisions' : 'tableau');
      await I.chargerFlotte();
      var D = await donnees();
      var attente = D.decisions.filter(function (x) { return x.statut === 'EN_ATTENTE'; }).length;
      var nav = '<nav class="mm-onglets" aria-label="Sections maintenance">' + ONGLETS.filter(function (o) { return o[0] !== 'decisions' || fin(); }).map(function (o) {
        return '<a href="#/maintenance/' + o[0] + '"' + (o[0] === onglet ? ' class="mm-actif" aria-current="page"' : '') + '>' + esc(o[1]) + (o[0] === 'decisions' && attente ? ' (' + attente + ')' : '') + '</a>';
      }).join('') + '</nav>';
      var corps = { tableau: tableauBord, decisions: decisions, dossiers: dossiers, garages: garages, regles: regles }[onglet] || tableauBord;
      I.vue().innerHTML = '<div class="mm-entete"><div><h1>Maintenance du parc</h1><p>Le coordinateur organise ; le Branch Manager autorise chaque dépense, individuellement et avant tout engagement.</p></div>' +
        (peut('maintenance_preparer') ? '<button type="button" class="mm-btn mm-primaire" data-mnt="nouveau">Nouveau dossier</button>' : '') + '</div>' + nav + corps(D);
      brancher(I.vue(), D);
    }

    function tableauBord(D) {
      var flotte = I.S.flotte;
      var aProg = D.ech.filter(function (e) { return PRIO.indexOf(e.statut) >= 0; }).sort(function (a, c) {
        return PRIO.indexOf(a.statut) - PRIO.indexOf(c.statut) || (a.km_restants == null ? 1e9 : a.km_restants) - (c.km_restants == null ? 1e9 : c.km_restants);
      });
      var ref = {}; aProg = aProg.filter(function (e) {  // un seul message « à établir » par moto
        if (e.statut !== 'DIAGNOSTIC_INITIAL_REQUIS' && e.statut !== 'ETAT_REFERENCE_REQUIS') return true;
        var k = e.moto_id + e.statut; if (ref[k]) return false; ref[k] = 1; return true;
      });
      var enAttente = D.dossiers.filter(function (x) { return x.autorisation_en_attente_id || x.statut === 'EN_ATTENTE_BM'; });
      var recents = D.decisions.filter(function (x) { return x.statut !== 'EN_ATTENTE' && x.decide_at && (Date.now() - new Date(x.decide_at)) < 14 * 864e5; });
      var cours = D.dossiers.filter(function (x) { return ['PROGRAMMEE', 'EN_COURS', 'TERMINEE'].indexOf(x.statut) >= 0 || (x.statut === 'CONTROLEE' && x.immobilisation_debut && !x.immobilisation_fin); });
      var parMotoCout = function (id) { return D.couts.filter(function (c) { return c.moto_id === id; })[0] || {}; };
      var nbOp = function (id, op) { return D.dossiers.filter(function (x) { return x.moto_id === id && ['CONTROLEE', 'CLOTUREE'].indexOf(x.statut) >= 0 && (x.travaux || '').indexOf(op + ':REALISE') >= 0; }).length; };
      var immoJ = function (id) { return D.dossiers.filter(function (x) { return x.moto_id === id && x.immobilisation_debut; }).reduce(function (t, x) {
        return t + Math.max(0, Math.round(((x.immobilisation_fin ? new Date(x.immobilisation_fin) : new Date()) - new Date(x.immobilisation_debut)) / 864e5)); }, 0); };
      var html = '<div class="mm-kpis">' + kpi('À programmer', String(aProg.filter(function (e) { return !e.dossier_en_cours_id && ['DEPASSEE', 'ATTEINTE', 'PROCHE'].indexOf(e.statut) >= 0; }).length), 'échéances proches, atteintes ou dépassées sans dossier') +
        kpi('En attente du BM', String(enAttente.length), 'aucun engagement possible avant décision') + kpi('Réparations en cours', String(cours.length), cours.filter(function (x) { return x.en_retard; }).length + ' en retard') +
        kpi('Diagnostics à établir', String(aProg.filter(function (e) { return e.statut === 'DIAGNOSTIC_INITIAL_REQUIS' || e.statut === 'ETAT_REFERENCE_REQUIS'; }).length), 'aucune échéance inventée') + '</div>';
      html += '<section class="mm-bloc"><h2>Maintenance à programmer</h2>' + tableau(['Moto', 'Cluster', 'Utilisateur', 'Prochaine opération', 'Km restants', 'Jours restants', 'Priorité', 'Garage envisagé', ''], aProg.map(function (e) {
        var m = I.motoParId(e.moto_id) || {}, ga = garageEnvisage(D, m);
        var a = e.dossier_en_cours_id ? b('PROGRAMMEE', 'Pris en charge') + ' ' + action('mnt_dossier', 'Ouvrir', { id: e.dossier_en_cours_id }) :
          (['DIAGNOSTIC_INITIAL_REQUIS', 'ETAT_REFERENCE_REQUIS'].indexOf(e.statut) >= 0 && peut('maintenance_preparer') ? action('mnt_nouveau', 'Organiser le diagnostic', { moto: e.moto_id, type: 'DIAGNOSTIC' }) :
           peut('maintenance_preparer') && e.statut !== 'RAPPEL' ? action('mnt_nouveau', 'Créer le dossier', { moto: e.moto_id, type: typeDepuisRegle(e.regle) }, 'mm-primaire') : '');
        var op = ['DIAGNOSTIC_INITIAL_REQUIS', 'ETAT_REFERENCE_REQUIS'].indexOf(e.statut) >= 0 ? '—' : esc(e.libelle) + (e.phase === 'RODAGE' ? ' (rodage)' : '');
        return ['<a class="mm-lien" href="#/moto/' + esc(e.moto_id) + '/entretiens">' + esc(e.code) + '</a>', esc(m.cluster_code || ND), esc(m.beneficiaire_nom || ND), op,
          esc(kms(e.km_restants)), esc(jours(e.jours_restants)), b(e.statut) + (e.fiabilite === 'KM_ANCIEN' ? ' ' + b('PROCHE', lib('KM_ANCIEN')) : ''), esc(ga ? ga.nom + (ga.statut !== 'APPROUVE' ? ' (' + lib(ga.statut) + ')' : '') : ND), a];
      }), 'Aucune échéance proche. Les règles non approuvées par le BM ne produisent aucune alerte.') +
        '<p class="mm-note">L\'échéance est atteinte au premier des deux seuils (kilomètres ou jours), calculée depuis le dernier entretien réalisé et contrôlé conforme. Une alerte signale un entretien nécessaire ; elle ne déclare pas une moto dangereuse ni apte.</p></section>';
      html += '<section class="mm-bloc"><h2>Autorisations en attente</h2>' + tableau(['Moto', 'Intervention', 'Coût prévu', 'Justification', 'Soumis le', 'Décision BM', 'Prochaine action'], enAttente.map(function (x) {
        var dcs = D.decisions.filter(function (y) { return y.maintenance_id === x.id && y.statut === 'EN_ATTENTE'; })[0] || {};
        return [esc(x.moto_code), esc(C.libelle(x.type_maintenance)) + '<small class="mm-aide">' + esc(dcs.proposition || x.description) + '</small>', esc(fc(x.montant_en_attente)), esc(dcs.justification || ND),
          esc(dcs.soumis_at ? C.dateFr(dcs.soumis_at) : ND), b('EN_ATTENTE'), (peut('maintenance_autoriser') ? action('mnt_decider', 'Décider', { id: dcs.autorisation_id }, 'mm-primaire') + ' ' : '') + action('mnt_dossier', 'Ouvrir', { id: x.id })];
      }), 'Aucune demande en attente.') +
        (recents.length ? '<h3>Décisions récentes (14 jours)</h3>' + tableau(['Moto', 'Objet', 'Demandé', 'Autorisé', 'Décision', 'Par', 'Le', 'Prochaine action'], recents.map(function (x) {
          var dos = D.dossiers.filter(function (y) { return y.id === x.maintenance_id; })[0] || {};
          var suite = x.statut === 'AUTORISEE' ? (dos.statut === 'AUTORISEE' ? 'Programmer les travaux' : lib(dos.statut)) : 'Revoir le devis ou annuler';
          return [esc(x.moto_code), esc(lib(x.objet)), esc(fc(x.montant_demande)), esc(fc(x.montant_autorise)), b(x.statut), esc(x.decide_par_nom || ND), esc(C.dateFr(x.decide_at)), esc(suite) + ' ' + action('mnt_dossier', 'Ouvrir', { id: x.maintenance_id })];
        }), '') : '') + '</section>';
      html += '<section class="mm-bloc"><h2>Réparations en cours</h2>' + tableau(['Moto', 'Garage', 'Nature des travaux', 'Début', 'Date cible', 'Retard', 'Reste à faire', ''], cours.map(function (x) {
        var reste = x.statut === 'PROGRAMMEE' ? 'Démarrer les travaux' : x.statut === 'EN_COURS' ? 'Déclarer les travaux effectués' : x.statut === 'TERMINEE' ? 'Contrôle technique des travaux' :
          'Contrôle de remise en service APTE, puis levée par une personne indépendante';
        return [esc(x.moto_code) + (x.immobilisation_debut && !x.immobilisation_fin ? ' ' + b('DEPASSEE', 'Immobilisée') : ''), esc(x.garage_nom || ND), esc(travauxTexte(x.travaux)), esc(x.date_intervention ? C.dateFr(x.date_intervention) : ND),
          esc(x.date_fin_prevue ? C.dateFr(x.date_fin_prevue) : ND), x.en_retard ? b('DEPASSEE', 'En retard') : '—', esc(reste), action('mnt_dossier', 'Ouvrir', { id: x.id })];
      }), 'Aucune réparation en cours.') + '</section>';
      html += '<section class="mm-bloc"><h2>Dépenses et performance</h2>' + tableau(['Moto', 'Coût documenté (factures vérifiées)', 'Coût maintenance / km', 'Vidanges vérifiées', 'Réparations', 'Jours d\'immobilisation', 'Factures non vérifiées', 'Engagé non facturé'], flotte.map(function (m) {
        var c = parMotoCout(m.id), km = Number(c.km_parcourus);
        var rep = nbOp(m.id, 'REPARATION');
        return ['<span class="mm-nowrap">' + esc(m.code) + '</span>', esc(fin() ? fc(c.cout_maintenance) : ND), esc(fin() && km > 0 && c.cout_maintenance != null ? C.fcfa(Math.round(10 * c.cout_maintenance / km) / 10) + '/km' : ND), esc(String(nbOp(m.id, 'VIDANGE'))),
          esc(String(rep)) + (rep >= 2 ? ' ' + b('PROCHE', 'Répétées') : ''), esc(String(immoJ(m.id))), esc(fin() ? fc(c.facture_non_justifiee) : ND), esc(fin() ? fc(c.engage_non_facture) : ND)];
      }), 'Aucune moto.') + '<h3>Par garage</h3>' + tableau(['Garage', 'Statut', 'Prestations', 'Délai moyen', 'Contrôles non conformes', 'Montant justifié', 'Motos à réparations répétées (90 j)'], D.garages.map(function (x) {
        return [esc(x.nom), b(x.statut), esc(String(x.prestations)), esc(x.delai_moyen_jours == null ? ND : x.delai_moyen_jours + ' j'), esc(String(x.controles_non_conformes)), esc(fc(x.montant_justifie)), esc(String(x.motos_reparations_repetees_90j))];
      }), 'Aucun garage enregistré.') +
        '<p class="mm-note">Le coût de maintenance est celui des factures vérifiées, compté une seule fois : un règlement par enveloppe, un coût de pneu ou d\'action corrective rattaché à la même autorisation n\'est pas ajouté. Coût/km : seulement sur des kilomètres suivis ; sinon « Non disponible ».</p></section>';
      return html;
    }
    function travauxTexte(t) { return (t || '').split(', ').filter(Boolean).map(function (x) { var p = x.split(':'); return (p[0] === 'DIAGNOSTIC' ? 'Diagnostic' : lib(p[0])) + (p[1] && p[1] !== 'PREVU' ? ' (' + lib(p[1]).toLowerCase() + ')' : ''); }).join(', ') || ND; }

    function decisions(D) {
      var att = D.decisions.filter(function (x) { return x.statut === 'EN_ATTENTE'; });
      var html = '<section class="mm-bloc"><h2>Décisions à prendre (' + att.length + ')</h2>' + (att.length ? '<div class="mm-cartes-decision">' + att.map(function (x) {
        return '<article class="mm-decision"><header><b>' + esc(x.moto_code) + '</b> · ' + esc(x.utilisateur || 'utilisateur non renseigné') + ' ' + b(x.urgence) + ' ' + b('TRAVAUX', lib(x.objet)) + '</header>' +
          '<dl><div><dt>Problème</dt><dd>' + esc(x.probleme) + '</dd></div>' +
          '<div><dt>Proposition</dt><dd>' + esc(x.proposition) + ' · ' + esc(x.garage_nom || 'garage non précisé') + (x.garage_statut && x.garage_statut !== 'APPROUVE' ? ' ' + b('PROCHE', 'Garage ' + lib(x.garage_statut).toLowerCase()) : '') + '</dd></div>' +
          '<div><dt>Montant</dt><dd><b>' + esc(fc(x.montant_demande)) + '</b>' + (x.deja_autorise > 0 ? ' · déjà autorisé sur ce dossier : ' + esc(fc(x.deja_autorise)) : '') + (x.devis_montant != null ? ' · devis : ' + esc(fc(x.devis_montant)) : '') + '</dd></div>' +
          '<div><dt>Conséquence d\'un report</dt><dd>' + esc(x.consequence_report) + '</dd></div>' +
          '<div><dt>Justification</dt><dd>' + esc(x.justification) + '</dd></div>' +
          '<div><dt>Soumis</dt><dd>' + esc(x.soumis_par_nom || ND) + ' · ' + esc(C.dateHeureFr(x.soumis_at)) + '</dd></div></dl>' +
          '<footer>' + (x.devis_path ? action('voir_piece', 'Voir le devis', { chemin: x.devis_path }) + ' ' : '') + action('mnt_dossier', 'Dossier', { id: x.maintenance_id }) + ' ' +
          (peut('maintenance_autoriser') ? action('mnt_decider', 'Autoriser ou refuser', { id: x.autorisation_id }, 'mm-primaire') : '') + '</footer></article>';
      }).join('') + '</div>' : '<div class="mm-vide">Aucune décision en attente. Les opérations courantes sans incidence financière ne vous sont pas soumises.</div>') +
        '<p class="mm-note">Chaque autorisation est nominative, horodatée, liée à une moto, un garage, un périmètre et un montant maximal. Une enveloppe approuvée n\'est jamais une autorisation. Aucune validation implicite ni par expiration de délai.</p></section>';
      var semaine = D.exceptions.filter(function (x) { return x.type !== 'DECISION_EN_ATTENTE'; });
      html += '<section class="mm-bloc mm-bloc-alerte"><h2>Synthèse hebdomadaire des exceptions (' + semaine.length + ')</h2>' + tableau(['Exception', 'Moto', 'Détail', 'Montant', 'Depuis'], semaine.map(function (x) {
        return [b(['FACTURE_HORS_AUTORISATION', 'ECHEANCE_DEPASSEE', 'IMMOBILISATION_LONGUE'].indexOf(x.type) >= 0 ? 'DEPASSEE' : 'PROCHE', LIBEXC[x.type] || x.type), esc(x.moto_code || '—'), esc(x.libelle), esc(x.montant == null ? '—' : C.fcfa(x.montant)), esc(x.depuis ? C.dateFr(x.depuis) : '—')];
      }), 'Aucune exception cette semaine.') + '</section>';
      return html;
    }
    var LIBEXC = { FACTURE_HORS_AUTORISATION: 'Facture hors autorisation', FACTURE_NON_VERIFIEE: 'Facture non vérifiée > 7 j', REPARATION_EN_RETARD: 'Réparation en retard',
      IMMOBILISATION_LONGUE: 'Immobilisation > 7 j', ECHEANCE_DEPASSEE: 'Entretien dépassé non pris en charge', REFERENCE_A_ETABLIR: 'Historique à établir', DEPENSE_NON_JUSTIFIEE: 'Dépense non justifiée > 7 j' };

    function dossiers(D) {
      return '<section class="mm-bloc"><h2>Dossiers de maintenance (' + D.dossiers.length + ')</h2>' + tableau(['Moto', 'Type', 'Statut', 'Garage', 'Estimé', 'Autorisé', 'Engagé', 'Facturé', 'Justifié', 'Payé', ''], D.dossiers.map(function (x) {
        return [esc(x.moto_code), esc(C.libelle(x.type_maintenance)), b(x.statut) + (x.facture_hors_autorisation ? ' ' + b('DEPASSEE', 'Facture hors autorisation') : ''), esc(x.garage_nom || ND),
          esc(fc(x.cout_estime)), esc(fc(x.montant_autorise)), esc(fc(x.montant_engage)), esc(fc(x.montant_facture)), esc(fc(x.montant_justifie)), esc(fc(x.montant_paye)), action('mnt_dossier', 'Ouvrir', { id: x.id })];
      }), 'Aucun dossier.') + '<p class="mm-note">Six montants distincts : estimé (devis), autorisé (BM), engagé (commande au garage), facturé, justifié (vérifié par l\'ABM ou la Finance), payé (constaté par la Finance). Une facture vérifiée ne prouve pas un paiement.</p></section>';
    }

    function garages(D) {
      return '<section class="mm-bloc"><h2>Garages partenaires (' + D.garages.length + ')</h2>' + tableau(['Garage', 'Localisation', 'Clusters', 'Interventions', 'Habilitation / garantie', 'Statut', 'Prestations', ''], D.garages.map(function (x) {
        var a = [];
        if (peut('garages')) a.push(action('mnt_garage', 'Modifier', { id: x.id }));
        if (peut('garages') && x.statut === 'CANDIDAT') a.push(action('mnt_garage_statut', 'Marquer évalué', { id: x.id, statut: 'EVALUE' }));
        if (peut('garage_approuver') && x.statut !== 'APPROUVE') a.push(action('mnt_garage_statut', 'Approuver', { id: x.id, statut: 'APPROUVE' }, 'mm-primaire'));
        if (peut('garage_approuver') && x.statut !== 'SUSPENDU') a.push(action('mnt_garage_statut', 'Suspendre', { id: x.id, statut: 'SUSPENDU' }));
        return [esc(x.nom) + (x.contact_professionnel ? '<small class="mm-aide">' + esc(x.contact_professionnel) + '</small>' : ''), esc(x.localisation), esc((x.clusters || []).join(', ') || ND),
          esc((x.types_interventions || []).map(lib).join(', ') || ND) + (x.specialites ? '<small class="mm-aide">' + esc(x.specialites) + '</small>' : ''),
          esc([x.habilitation_constructeur, x.conditions_garantie].filter(Boolean).join(' · ') || ND), b(x.statut), esc(String(x.prestations)) + (x.delai_moyen_jours != null ? ' · ' + esc(x.delai_moyen_jours) + ' j' : ''), a.join(' ')];
      }), 'Aucun garage enregistré. Aucun garage n\'est créé par l\'application : saisissez les garages réels.') +
        (peut('garages') ? '<div class="mm-actions"><button type="button" class="mm-btn mm-secondaire mm-petit" data-mnt="garage">Enregistrer un garage</button></div>' : '') +
        '<p class="mm-note">Un garage enregistré n\'est pas « partenaire agréé » : il est candidat, puis évalué, puis approuvé par le Branch Manager. Prestations, délais réels et réparations répétées sont calculés à partir des dossiers, jamais saisis.</p></section>';
    }

    function regles(D) {
      var html = '<section class="mm-bloc"><h2>Règles d\'entretien par modèle</h2><div class="mm-bandeau mm-info">Manuel constructeur APSONIC AP150-30 non retrouvé (recherche du 31/10/2026) : aucune prescription constructeur n\'est enregistrée. Les valeurs du mandat sont des hypothèses inactives ; seule une version requalifiée (constructeur avec référence, ou politique interne validée techniquement) et approuvée par le BM produit des échéances.</div>';
      D.modeles.forEach(function (mo) {
        var vs = D.versions.filter(function (v) { return v.modele_code === mo.code; });
        html += '<h3>' + esc(mo.libelle) + '</h3>' + tableauVersions(vs, D);
      });
      var exc = D.versions.filter(function (v) { return v.moto_id; });
      html += '<h3>Exceptions documentées par moto</h3>' + tableauVersions(exc, D, true);
      if (peut('regle_proposer')) html += '<div class="mm-actions"><button type="button" class="mm-btn mm-secondaire mm-petit" data-mnt="version">Proposer une version de règle</button></div>';
      html += '</section><section class="mm-bloc"><h2>Modèle technique de chaque moto</h2>' + tableau(['Moto', 'Marque / modèle enregistrés', 'Modèle technique', 'Origine', ''], I.S.flotte.map(function (m) {
        return [esc(m.code), esc([m.marque, m.modele].filter(Boolean).join(' ') || ND), esc(m.modele_technique_code || 'Non associé'), esc(C.libelle(m.origine || 'NEUVE')),
          peut('modele_definir') ? action('mnt_modele', 'Définir', { moto: m.id, code: m.modele_technique_code || '' }) : ''];
      }), 'Aucune moto.') + '<p class="mm-note">L\'association est explicite et contrôlée par le serveur : les règles APSONIC ne s\'appliquent jamais à une moto d\'une autre marque ou d\'un autre modèle.</p></section>';
      return html;
    }
    function tableauVersions(vs, D, avecMoto) {
      return tableau((avecMoto ? ['Moto'] : []).concat(['Opération', 'Phase', 'Version', 'Intervalle', 'Alertes (km / jours avant)', 'Source', 'Statut', 'Effet', '']), vs.map(function (v) {
        var a = [];
        if (peut('regle_approuver') && v.statut === 'BROUILLON') a.push(action('mnt_version_approuver', 'Approuver', { id: v.id, nature: v.nature_source }, 'mm-primaire'));
        if (peut('regle_approuver') && ['BROUILLON', 'APPROUVEE'].indexOf(v.statut) >= 0) a.push(action('mnt_version_retirer', 'Retirer', { id: v.id }));
        var rg = D.regles.filter(function (r) { return r.code === v.regle_code; })[0] || {};
        return (avecMoto ? [esc(I.codeMoto(v.moto_id))] : []).concat([esc(rg.libelle || v.regle_code), esc(lib(v.phase)), 'v' + esc(v.version),
          esc([v.intervalle_km ? C.km(v.intervalle_km) : null, v.intervalle_jours ? v.intervalle_jours + ' j' : null].filter(Boolean).join(' ou ')),
          esc([v.rappel_avant_km != null ? v.rappel_avant_km + ' / ' + v.proche_avant_km + ' km' : null, v.rappel_avant_jours != null ? v.rappel_avant_jours + ' / ' + v.proche_avant_jours + ' j' : null].filter(Boolean).join(' · ') || ND),
          b(v.nature_source) + (v.reference_source ? '<small class="mm-aide">' + esc(v.reference_source) + '</small>' : ''), b(v.statut),
          esc(v.date_effet ? C.dateFr(v.date_effet) : '—'), a.join(' ')]);
      }), 'Aucune version.');
    }

    /* -- Dossier ---------------------------------------------------------- */
    var ETAPES = ['DEMANDEE', 'DIAGNOSTIC', 'DEVIS_RECU', 'EN_ATTENTE_BM', 'AUTORISEE', 'PROGRAMMEE', 'EN_COURS', 'TERMINEE', 'CONTROLEE', 'CLOTUREE'];
    async function ouvrir(id) {
      var r = await Promise.all([lire('moto_v_maintenance_dossiers', function (x) { return x.eq('id', id); }), lire('moto_maintenance_travaux', function (x) { return x.eq('maintenance_id', id).order('created_at'); }),
        fin() ? q('moto_v_decisions_bm', function (x) { return x.eq('maintenance_id', id).order('rang'); }) : Promise.resolve([]),
        fin() ? q('moto_factures', function (x) { return x.eq('maintenance_id', id).order('depose_at'); }) : Promise.resolve([])]);
      var x = r[0][0]; if (!x) return I.toast('Dossier introuvable ou hors de votre périmètre.', 'ko');
      var tr = r[1], au = r[2], fa = r[3];
      var idx = ETAPES.indexOf(x.statut);
      var frise = '<ol class="mm-frise">' + ETAPES.map(function (e, i) { return '<li class="' + (i < idx ? 'mm-fait' : i === idx ? 'mm-courant' : '') + '">' + esc(lib(e)) + '</li>'; }).join('') + '</ol>';
      var boutons = boutonsDossier(x, au, fa);
      var corps = frise + (['REFUSEE', 'ANNULEE'].indexOf(x.statut) >= 0 ? '<p class="mm-bandeau mm-ko">' + esc(lib(x.statut)) + '</p>' : '') +
        '<dl class="mm-mini"><div><dt>Moto</dt><dd>' + esc(x.moto_code) + ' · ' + esc(x.utilisateur || ND) + '</dd></div><div><dt>Besoin</dt><dd>' + esc(C.libelle(x.type_maintenance)) + ' · ' + esc(x.description) + '</dd></div>' +
        '<div><dt>Garage</dt><dd>' + esc(x.garage_nom || ND) + (x.garage_statut ? ' ' + b(x.garage_statut) : '') + '</dd></div><div><dt>Urgence</dt><dd>' + b(x.urgence || 'NORMALE') + '</dd></div>' +
        (x.sans_frais ? '<div><dt>Sans frais</dt><dd>Aucun engagement possible</dd></div>' : '') + '</dl>' +
        (fin() ? '<div class="mm-kpis mm-kpis-serres">' + kpi('Estimé', fc(x.cout_estime)) + kpi('Autorisé BM', fc(x.montant_autorise), x.montant_en_attente ? fc(x.montant_en_attente) + ' en attente' : '') + kpi('Engagé', fc(x.montant_engage)) +
          kpi('Facturé', fc(x.montant_facture), x.facture_hors_autorisation ? 'HORS AUTORISATION' : '') + kpi('Justifié', fc(x.montant_justifie)) + kpi('Payé (constaté)', fc(x.montant_paye)) + '</div>' : '') +
        '<h3>Travaux</h3>' + tableau(['Opération', 'Détail', 'Statut'], tr.map(function (t) { return [esc(t.operation_code === 'DIAGNOSTIC' ? 'Diagnostic' : lib(t.operation_code)), esc(t.libelle), b(t.statut)]; }), 'Aucune opération enregistrée.') +
        (fin() ? '<h3>Autorisations du Branch Manager</h3>' + tableau(['N°', 'Objet', 'Demandé', 'Autorisé', 'Statut', 'Décidé par', 'Le', 'Commentaire'], au.map(function (a) {
          return [esc(a.rang), esc(lib(a.objet)), esc(fc(a.montant_demande)), esc(fc(a.montant_autorise)), b(a.statut), esc(a.decide_par_nom || '—'), esc(a.decide_at ? C.dateHeureFr(a.decide_at) : '—'), esc(a.commentaire_decision || '—')];
        }), 'Aucune demande d\'autorisation.') + '<h3>Factures</h3>' + tableau(['N°', 'Date', 'Montant', 'Statut', 'Payé', ''], fa.map(function (f) {
          var a = [action('voir_piece', 'Pièce', { chemin: f.document_path })];
          if (f.statut === 'DEPOSEE' && peut('facture_verifier') && f.depose_par !== moi()) a.push(action('mnt_facture_verifier', 'Vérifier', { id: f.id, dossier: x.id }, 'mm-primaire'));
          if (f.statut === 'VERIFIEE' && peut('paiement_constater') && f.montant_paye < f.montant) a.push(action('mnt_paiement', 'Constater un paiement', { id: f.id, dossier: x.id, reste: f.montant - f.montant_paye }));
          return [esc(f.numero_facture), esc(C.dateFr(f.date_facture)), esc(C.fcfa(f.montant)), b(f.statut), esc(C.fcfa(f.montant_paye)), a.join(' ')];
        }), 'Aucune facture.') : '<p class="mm-note">Montants, autorisations et factures : accès réservé au Branch Manager, à l\'ABM, à la Finance, à la Direction et au coordinateur.</p>') +
        (boutons ? '<div class="mm-actions mm-actions-dossier">' + boutons + '</div>' : '') +
        '<p class="mm-note">Clôture technique (contrôle conforme), clôture financière (pièces vérifiées) et remise en circulation (contrôle de remise en service APTE puis levée par une personne indépendante) sont trois décisions distinctes.</p>';
      var d = modale('Dossier de maintenance · ' + x.moto_code, corps, null);
      d.classList.add('mm-modale-large');
      d.addEventListener('click', function (e) {
        var bt = e.target.closest('[data-action]'); if (!bt) return;
        var f = ACT[bt.dataset.action]; if (!f) return;
        try { d.close(); } catch (er) {} d.remove();
        f(Object.assign({}, bt.dataset), x, tr);
      });
    }
    function boutonsDossier(x, au, fa) {
      var s = x.statut, a = [], prep = peut('maintenance_preparer'), org = peut('maintenance_organiser');
      var attente = (au || []).filter(function (y) { return y.statut === 'EN_ATTENTE'; })[0];
      if (['DEMANDEE', 'DIAGNOSTIC'].indexOf(s) >= 0 && org) a.push(action('mnt_diagnostic', 'Organiser le diagnostic', { id: x.id }));
      if (['DEMANDEE', 'DIAGNOSTIC', 'DEVIS_RECU', 'REFUSEE'].indexOf(s) >= 0 && prep) a.push(action('mnt_devis', s === 'DEVIS_RECU' ? 'Remplacer le devis' : 'Enregistrer le devis', { id: x.id }, 'mm-primaire'));
      if (['DEMANDEE', 'DIAGNOSTIC'].indexOf(s) >= 0 && prep) a.push(action('mnt_soumettre', 'Diagnostic payant : demander au BM', { id: x.id, objet: 'DIAGNOSTIC' }));
      if (s === 'DEVIS_RECU' && prep) a.push(action('mnt_soumettre', 'Soumettre au Branch Manager', { id: x.id, objet: 'TRAVAUX' }, 'mm-primaire'));
      if (['DEMANDEE', 'DIAGNOSTIC', 'DEVIS_RECU'].indexOf(s) >= 0 && org) a.push(action('mnt_sans_frais', 'Intervention sans frais', { id: x.id }));
      if (attente && peut('maintenance_autoriser')) a.push(action('mnt_decider', 'Autoriser ou refuser', { id: attente.autorisation_id }, 'mm-primaire'));
      if (['AUTORISEE', 'PROGRAMMEE', 'EN_COURS'].indexOf(s) >= 0 && org && !x.sans_frais) a.push(action('mnt_programmer', s === 'AUTORISEE' ? 'Programmer les travaux' : 'Ajuster l\'engagement', { id: x.id }, s === 'AUTORISEE' ? 'mm-primaire' : ''));
      if (s === 'PROGRAMMEE' && org) a.push(action('mnt_demarrer', 'Démarrer les travaux', { id: x.id }, 'mm-primaire'));
      if (['PROGRAMMEE', 'EN_COURS'].indexOf(s) >= 0 && prep && !x.sans_frais) a.push(action('mnt_devis', 'Devis complémentaire', { id: x.id }));
      if (['AUTORISEE', 'PROGRAMMEE', 'EN_COURS', 'TERMINEE'].indexOf(s) >= 0 && prep && !attente && !x.sans_frais) a.push(action('mnt_soumettre', 'Soumettre un supplément', { id: x.id, objet: 'SUPPLEMENT' }));
      if (s === 'EN_COURS' && org) a.push(action('mnt_terminer', 'Déclarer les travaux effectués', { id: x.id }, 'mm-primaire'));
      if (s === 'TERMINEE' && peut('maintenance_controler')) a.push(action('mnt_controler', 'Contrôler les travaux', { id: x.id }, 'mm-primaire'));
      if (['PROGRAMMEE', 'EN_COURS', 'TERMINEE', 'CONTROLEE'].indexOf(s) >= 0 && org) a.push(action('mnt_facture', 'Déposer une facture', { id: x.id, moto: x.moto_id }));
      if (s === 'CONTROLEE' && peut('cloture_financiere')) a.push(action('mnt_cloturer', 'Clôture financière', { id: x.id }));
      if (['DEMANDEE', 'DIAGNOSTIC', 'DEVIS_RECU', 'EN_ATTENTE_BM', 'REFUSEE', 'AUTORISEE'].indexOf(s) >= 0 && org) a.push(action('mnt_annuler', 'Annuler', { id: x.id }));
      if (x.immobilisation_debut && !x.immobilisation_fin) a.push('<a class="mm-btn mm-secondaire mm-petit" href="#/moto/' + esc(x.moto_id) + '/entretiens">Remise en circulation</a>');
      return a.join(' ');
    }
    function apres(id) { return function () { return I.router().then(function () { if (id) ouvrir(id); }); }; }
    function terminerOk(id, msg) { apres(id)(); return msg || 'Enregistré.'; }

    var ACT = {
      mnt_dossier: function (d) { ouvrir(d.id); },
      voir_piece: function (d) { I.ouvrirFichier(d.chemin); },
      mnt_nouveau: function (d) { nouveau(d.moto, d.type); },
      mnt_diagnostic: function (d, x) {
        lire('moto_garages', function (q2) { return q2.neq('statut', 'SUSPENDU').order('nom'); }).catch(function () { return []; }).then(function (gs) {
          modale('Organiser le diagnostic · ' + x.moto_code, champ({ n: 'garage_id', l: 'Garage ou intervenant pressenti', t: 'select', o: gs.map(function (y) { return [y.id, y.nom + ' · ' + lib(y.statut)]; }) }) +
            champ({ n: 'note', l: 'Organisation (date, lieu, constat)', t: 'textarea' }) + '<p class="mm-note">Un diagnostic payant doit être autorisé par le BM avant d\'être engagé.</p>',
            function (v) { v.maintenance_id = d.id; return rpc('moto_maintenance_diagnostic', { p: v }).then(function () { return terminerOk(d.id); }); });
        });
      },
      mnt_devis: function (d, x) {
        lire('moto_garages', function (q2) { return q2.neq('statut', 'SUSPENDU').order('nom'); }).catch(function () { return []; }).then(function (gs) {
          var comp = ['PROGRAMMEE', 'EN_COURS', 'AUTORISEE'].indexOf(x.statut) >= 0;
          modale((comp ? 'Devis complémentaire · ' : 'Devis reçu · ') + x.moto_code, '<div class="mm-grille-form">' +
            champ({ n: 'garage_id', l: 'Garage proposé', t: 'select', req: true, v: x.garage_id, o: gs.map(function (y) { return [y.id, y.nom + ' · ' + lib(y.statut)]; }), aide: gs.length ? '' : 'Enregistrez d\'abord le garage (onglet Garages).' }) +
            champ({ n: 'devis_montant', l: comp ? 'Montant complémentaire (FCFA)' : 'Coût total du devis (FCFA)', t: 'nombre', req: true, pas: 1 }) +
            champ({ n: 'devis_pieces', l: 'Dont pièces (FCFA)', t: 'nombre', pas: 1 }) + champ({ n: 'devis_main_oeuvre', l: 'Dont main-d\'œuvre (FCFA)', t: 'nombre', pas: 1 }) +
            champ({ n: 'op1', l: 'Opération 1', t: 'select', req: true, o: ops() }) + champ({ n: 'lib1', l: 'Détail opération 1', req: true }) +
            champ({ n: 'op2', l: 'Opération 2 (facultatif)', t: 'select', o: ops() }) + champ({ n: 'lib2', l: 'Détail opération 2' }) +
            champ({ n: 'op3', l: 'Opération 3 (facultatif)', t: 'select', o: ops() }) + champ({ n: 'lib3', l: 'Détail opération 3' }) +
            champ({ n: 'urgence', l: 'Niveau d\'urgence', t: 'select', vide: false, o: [['NORMALE', 'Normale'], ['PRIORITAIRE', 'Prioritaire'], ['SECURITE', 'Sécurité (moto à l\'arrêt)']] }) +
            champ({ n: 'date_souhaitee', l: 'Date souhaitée', t: 'date' }) +
            champ({ n: 'justification', l: 'Justification', t: 'textarea', req: true, min: 10 }) + champ({ n: 'consequence_report', l: 'Conséquence d\'un report', t: 'textarea' }) +
            champ({ n: 'fichier', l: 'Pièce du devis (photo ou PDF)', t: 'fichier', req: !comp && x.statut !== 'DEVIS_RECU', capture: true }) + '</div>' +
            '<p class="mm-note">Aucun engagement à cette étape : le devis sera soumis au Branch Manager.</p>',
            async function (v) {
              var travaux = [1, 2, 3].map(function (i) { return v['op' + i] ? { operation_code: v['op' + i], libelle: v['lib' + i] || lib(v['op' + i]) } : null; }).filter(Boolean);
              var chemin = await deposerPiece(x.moto_id, 'devis', v.fichier);
              await rpc('moto_maintenance_devis', { p: { maintenance_id: d.id, garage_id: v.garage_id, devis_montant: C.nombreSaisi(v.devis_montant), devis_pieces: C.nombreSaisi(v.devis_pieces),
                devis_main_oeuvre: C.nombreSaisi(v.devis_main_oeuvre), devis_path: chemin, travaux: travaux, urgence: v.urgence, date_souhaitee: v.date_souhaitee,
                justification: v.justification, consequence_report: v.consequence_report } });
              return terminerOk(d.id, 'Devis enregistré.');
            });
        });
      },
      mnt_soumettre: function (d, x) {
        var titre = { DIAGNOSTIC: 'Diagnostic payant', TRAVAUX: 'Travaux', SUPPLEMENT: 'Supplément' }[d.objet];
        modale('Demande d\'autorisation au Branch Manager · ' + titre, '<div class="mm-grille-form">' +
          champ({ n: 'montant_demande', l: 'Montant demandé (FCFA)', t: 'nombre', req: true, pas: 1, v: d.objet === 'TRAVAUX' ? x.cout_estime : null }) +
          champ({ n: 'perimetre', l: 'Périmètre exact des travaux', t: 'textarea', req: true, min: 10 }) +
          champ({ n: 'consequence_report', l: 'Conséquence d\'un report', t: 'textarea', req: true, min: 5 }) +
          champ({ n: 'justification', l: 'Justification (si différente du devis)', t: 'textarea' }) +
          (d.objet !== 'TRAVAUX' ? champ({ n: 'fichier', l: 'Pièce (devis complémentaire)', t: 'fichier' }) : '') + '</div>' +
          '<p class="mm-note">Le Branch Manager décide seul, montant maximal compris. Tant que sa décision n\'est pas enregistrée sur le serveur, rien ne peut être engagé.</p>',
          async function (v) {
            var chemin = v.fichier ? await deposerPiece(x.moto_id, 'devis', v.fichier) : null;
            await rpc('moto_autorisation_soumettre', { p: { maintenance_id: d.id, objet: d.objet, montant_demande: C.nombreSaisi(v.montant_demande), perimetre: v.perimetre,
              consequence_report: v.consequence_report, justification: v.justification, devis_path: chemin, client_op_id: I.OFF.uuid() } });
            return terminerOk(d.id, 'Demande transmise au Branch Manager.');
          }, 'Soumettre');
      },
      mnt_decider: function (d) {
        lire('moto_v_decisions_bm', function (q2) { return q2.eq('autorisation_id', d.id); }).then(function (r) {
          var a = r[0]; if (!a) return I.toast('Demande introuvable.', 'ko');
          modale('Décision du Branch Manager · ' + a.moto_code, '<dl class="mm-mini"><div><dt>Problème</dt><dd>' + esc(a.probleme) + '</dd></div><div><dt>Proposition</dt><dd>' + esc(a.proposition) + ' · ' + esc(a.garage_nom || ND) + '</dd></div>' +
            '<div><dt>Montant demandé</dt><dd><b>' + esc(fc(a.montant_demande)) + '</b></dd></div><div><dt>Conséquence d\'un report</dt><dd>' + esc(a.consequence_report) + '</dd></div></dl>' +
            champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['AUTORISEE', 'Autoriser'], ['REFUSEE', 'Refuser']] }) +
            champ({ n: 'montant', l: 'Montant maximal autorisé (FCFA)', t: 'nombre', pas: 1, v: a.montant_demande, aide: 'Au plus le montant demandé. Un montant réduit exige un commentaire.' }) +
            champ({ n: 'commentaire', l: 'Commentaire (obligatoire si refus ou réduction)', t: 'textarea' }),
            function (v) { return rpc('moto_autorisation_decider', { p_autorisation: d.id, p_decision: v.decision, p_montant: v.decision === 'AUTORISEE' ? C.nombreSaisi(v.montant) : null, p_commentaire: v.commentaire })
              .then(function () { return terminerOk(null, v.decision === 'AUTORISEE' ? 'Autorisation enregistrée et horodatée.' : 'Refus enregistré.'); }); }, 'Enregistrer la décision');
        });
      },
      mnt_sans_frais: function (d) {
        modale('Intervention sans frais', champ({ n: 'sans_frais_motif', l: 'Motif (garantie, intervention interne…)', t: 'textarea', req: true, min: 10 }) + champ({ n: 'date_prevue', l: 'Date prévue', t: 'date', req: true, v: I.aujourdhui() }) +
          '<p class="mm-note">Aucun montant ne pourra être engagé ni justifié sur ce dossier. Toute facture reçue devra faire l\'objet d\'une autorisation BM.</p>',
          function (v) { return rpc('moto_maintenance_programmer', { p: { maintenance_id: d.id, sans_frais: true, sans_frais_motif: v.sans_frais_motif, date_prevue: v.date_prevue } }).then(function () { return terminerOk(d.id); }); });
      },
      mnt_programmer: function (d, x) {
        modale('Programmation · ' + x.moto_code, '<p>Plafond autorisé par le BM : <b>' + esc(fc(x.montant_autorise)) + '</b></p><div class="mm-grille-form">' +
          champ({ n: 'montant_engage', l: 'Montant engagé auprès du garage (FCFA)', t: 'nombre', req: true, pas: 1, v: x.montant_engage || x.montant_autorise }) +
          (x.statut !== 'EN_COURS' ? champ({ n: 'date_prevue', l: 'Date d\'intervention', t: 'date', req: true, v: x.date_prevue || I.aujourdhui() }) : '') +
          champ({ n: 'date_fin_prevue', l: 'Date cible de fin', t: 'date', v: x.date_fin_prevue }) + '</div><p class="mm-note">Strictement dans le périmètre et le montant autorisés. Au-delà : soumettre un supplément.</p>',
          function (v) { v.maintenance_id = d.id; v.montant_engage = C.nombreSaisi(v.montant_engage); return rpc('moto_maintenance_programmer', { p: v }).then(function () { return terminerOk(d.id); }); });
      },
      mnt_demarrer: function (d) {
        modale('Début des travaux', champ({ n: 'date', l: 'Date réelle de début', t: 'date', req: true, v: I.aujourdhui(), max: I.aujourdhui() }) + '<p class="mm-note">La moto est immobilisée pendant les travaux.</p>',
          function (v) { return rpc('moto_maintenance_demarrer', { p_maintenance: d.id, p_garage: null, p_date: v.date }).then(function () { return terminerOk(d.id); }); }, 'Démarrer');
      },
      mnt_terminer: function (d, x, tr) {
        var prevus = tr.filter(function (t) { return t.statut === 'PREVU'; });
        modale('Travaux effectués · ' + x.moto_code, '<div class="mm-grille-form">' + champ({ n: 'date_realisation', l: 'Date réelle de fin', t: 'date', req: true, v: I.aujourdhui(), max: I.aujourdhui() }) +
          champ({ n: 'compteur_km', l: 'Compteur relevé (km)', t: 'nombre', req: true, aide: 'Relevé réel : un compteur inconnu n\'est jamais remplacé par 0.' }) +
          prevus.map(function (t) { return champ({ n: 'tr_' + t.id, l: (t.operation_code === 'DIAGNOSTIC' ? 'Diagnostic' : lib(t.operation_code)) + ' · ' + t.libelle, t: 'oui_non', req: true, oui: 'Réalisé', non: 'Non réalisé' }); }).join('') +
          champ({ n: 'pieces_remplacees', l: 'Pièces remplacées', t: 'textarea' }) + champ({ n: 'observations', l: 'Observations', t: 'textarea' }) + '</div>' +
          '<p class="mm-note">Seules les opérations réellement réalisées actualiseront leur échéance, après contrôle conforme. La remise en circulation est une décision distincte.</p>',
          function (v) {
            var travaux = prevus.map(function (t) { return { id: t.id, realise: v['tr_' + t.id] === true }; });
            return rpc('moto_maintenance_terminer', { p: { maintenance_id: d.id, date_realisation: v.date_realisation, compteur_km: C.nombreSaisi(v.compteur_km), travaux: travaux,
              pieces_remplacees: v.pieces_remplacees, observations: v.observations } }).then(function () { return terminerOk(d.id); });
          });
      },
      mnt_controler: function (d, x) {
        modale('Contrôle technique des travaux · ' + x.moto_code, champ({ n: 'resultat', l: 'Résultat', t: 'select', req: true, o: [['CONFORME', 'Conforme'], ['NON_CONFORME', 'Non conforme : reprise des travaux']] }) +
          champ({ n: 'note', l: 'Constat (10 caractères minimum)', t: 'textarea', req: true, min: 10 }) + '<p class="mm-note">Contrôle par une autre personne que celle qui a déclaré les travaux, et jamais par l\'utilisateur de la moto.</p>',
          function (v) { return rpc('moto_maintenance_controler', { p_maintenance: d.id, p_resultat: v.resultat, p_note: v.note }).then(function () { return terminerOk(d.id); }); });
      },
      mnt_facture: function (d, x) {
        modale('Facture du garage · ' + x.moto_code, '<div class="mm-grille-form">' + champ({ n: 'numero_facture', l: 'N° de facture', req: true }) + champ({ n: 'date_facture', l: 'Date de facture', t: 'date', req: true, max: I.aujourdhui() }) +
          champ({ n: 'montant', l: 'Montant (FCFA)', t: 'nombre', req: true, pas: 1 }) + champ({ n: 'fichier', l: 'Scan de la facture', t: 'fichier', req: true, capture: true }) + '</div>' +
          '<p class="mm-note">Une facture supérieure au montant autorisé est signalée au BM et ne peut pas être vérifiée sans nouvelle autorisation : elle ne régularise jamais une dépense.</p>',
          async function (v) {
            var chemin = await deposerPiece(x.moto_id, 'facture', v.fichier);
            var r = await rpc('moto_facture_deposer', { p: { maintenance_id: d.id, numero_facture: v.numero_facture, date_facture: v.date_facture, montant: C.nombreSaisi(v.montant), document_path: chemin } });
            return terminerOk(d.id, r && r.hors_autorisation ? 'Facture déposée : HORS AUTORISATION, signalée au Branch Manager.' : 'Facture déposée, à vérifier.');
          });
      },
      mnt_facture_verifier: function (d) {
        modale('Vérification de la facture', champ({ n: 'decision', l: 'Décision', t: 'select', req: true, o: [['VERIFIEE', 'Vérifiée : pièce conforme, dans l\'autorisation'], ['REJETEE', 'Rejetée']] }) + champ({ n: 'motif', l: 'Motif (obligatoire si rejet)', t: 'textarea' }),
          function (v) { return rpc('moto_facture_verifier', { p_facture: d.id, p_decision: v.decision, p_motif: v.motif }).then(function () { return terminerOk(d.dossier); }); });
      },
      mnt_paiement: function (d) {
        modale('Constat de paiement (Finance)', champ({ n: 'montant', l: 'Montant payé (FCFA)', t: 'nombre', req: true, pas: 1, v: d.reste }) + champ({ n: 'date', l: 'Date du paiement', t: 'date', req: true, max: I.aujourdhui() }) +
          champ({ n: 'reference', l: 'Référence du paiement', req: true }) + '<p class="mm-note">AFLP FLEET n\'exécute aucun paiement : la Finance paie selon ses procédures puis constate ici le paiement réel.</p>',
          function (v) { return rpc('moto_facture_paiement_constater', { p_facture: d.id, p_montant: C.nombreSaisi(v.montant), p_date: v.date, p_reference: v.reference }).then(function () { return terminerOk(d.dossier); }); });
      },
      mnt_cloturer: function (d) {
        modale('Clôture financière', champ({ n: 'motif', l: 'Motif', t: 'textarea', req: true, min: 5, aide: 'Explication détaillée exigée si un montant engagé n\'a donné lieu à aucune facture vérifiée.' }),
          function (v) { return rpc('moto_maintenance_cloturer', { p_maintenance: d.id, p_motif: v.motif }).then(function () { return terminerOk(d.id); }); }, 'Clôturer');
      },
      mnt_annuler: function (d) {
        modale('Annuler le dossier', champ({ n: 'motif', l: 'Motif (10 caractères minimum)', t: 'textarea', req: true, min: 10 }),
          function (v) { return rpc('moto_maintenance_annuler', { p_maintenance: d.id, p_motif: v.motif }).then(function () { return terminerOk(null, 'Dossier annulé.'); }); }, 'Annuler le dossier');
      },
      mnt_garage: function (d, D) { formGarage(d.id ? (D && D.garages || []).filter(function (x) { return x.id === d.id; })[0] : null); },
      mnt_garage_statut: function (d) {
        modale('Statut du garage : ' + lib(d.statut), champ({ n: 'motif', l: 'Motif (10 caractères minimum)', t: 'textarea', req: true, min: 10 }),
          function (v) { return rpc('moto_garage_statut', { p_garage: d.id, p_statut: d.statut, p_motif: v.motif }).then(function () { return terminerOk(null); }); });
      },
      mnt_version_approuver: function (d) {
        if (d.nature === 'HYPOTHESE') return I.toast('Une hypothèse non validée ne peut pas être approuvée : proposez une version requalifiée (constructeur avec référence, ou politique interne validée techniquement).', 'ko');
        modale('Approuver la version de règle', champ({ n: 'date_effet', l: 'Date d\'effet', t: 'date', req: true, v: I.aujourdhui() }) + champ({ n: 'motif', l: 'Motif de l\'approbation (10 caractères minimum)', t: 'textarea', req: true, min: 10 }) +
          '<p class="mm-note">La version précédente est conservée dans l\'historique (remplacée).</p>',
          function (v) { return rpc('moto_regle_version_approuver', { p_version: d.id, p_date_effet: v.date_effet, p_motif: v.motif }).then(function () { return terminerOk(null, 'Version approuvée.'); }); }, 'Approuver');
      },
      mnt_version_retirer: function (d) {
        modale('Retirer la version', champ({ n: 'motif', l: 'Motif (10 caractères minimum)', t: 'textarea', req: true, min: 10 }),
          function (v) { return rpc('moto_regle_version_retirer', { p_version: d.id, p_motif: v.motif }).then(function () { return terminerOk(null); }); }, 'Retirer');
      },
      mnt_modele: function (d) {
        q('moto_modeles_techniques').then(function (ms) {
          modale('Modèle technique de la moto', champ({ n: 'code', l: 'Modèle technique', t: 'select', v: d.code, o: ms.map(function (m) { return [m.code, m.libelle]; }), aide: 'Laisser vide si le modèle n\'est pas confirmé.' }) +
            champ({ n: 'motif', l: 'Preuve (plaque constructeur, carte grise…)', t: 'textarea', req: true, min: 10 }),
            function (v) { return rpc('moto_modele_technique_definir', { p_moto: d.moto, p_code: v.code, p_motif: v.motif }).then(function () { return terminerOk(null); }); });
        });
      }
    };

    function nouveau(motoId, type) {
      var motos = I.S.flotte.map(function (m) { return [m.id, m.code + ' · ' + (m.beneficiaire_nom || 'non remise')]; });
      modale('Nouveau dossier de maintenance', '<div class="mm-grille-form">' + champ({ n: 'moto_id', l: 'Moto', t: 'select', req: true, v: motoId, o: motos }) +
        champ({ n: 'type_maintenance', l: 'Besoin', t: 'select', req: true, v: type, o: typesDossier() }) +
        champ({ n: 'urgence', l: 'Urgence', t: 'select', vide: false, o: [['NORMALE', 'Normale'], ['PRIORITAIRE', 'Prioritaire'], ['SECURITE', 'Sécurité (moto à l\'arrêt)']] }) +
        champ({ n: 'compteur_km', l: 'Compteur relevé (km)', t: 'nombre' }) + champ({ n: 'description', l: 'Description du besoin', t: 'textarea', req: true, min: 5 }) + '</div>' +
        '<p class="mm-note">En cas de danger : arrêtez la moto et déclarez un incident (immobilisation immédiate). L\'absence d\'autorisation de réparation n\'autorise jamais à circuler.</p>',
        function (v) { v.client_op_id = I.OFF.uuid(); v.compteur_km = C.nombreSaisi(v.compteur_km); return rpc('moto_maintenance_demander', { p: v }).then(function (r) { apres(r && r.id)(); return 'Dossier créé.'; }); }, 'Créer');
    }
    function formGarage(x) {
      x = x || {};
      modale(x.id ? 'Modifier le garage' : 'Enregistrer un garage', '<div class="mm-grille-form">' + champ({ n: 'nom', l: 'Nom', req: !x.id, v: x.nom }) + champ({ n: 'localisation', l: 'Localisation', req: !x.id, v: x.localisation }) +
        champ({ n: 'clusters', l: 'Clusters desservis (séparés par des virgules)', v: (x.clusters || []).join(', '), ph: 'SAKASSOU, BROBO' }) +
        champ({ n: 'contact_professionnel', l: 'Contact professionnel', v: x.contact_professionnel }) +
        champ({ n: 'types_interventions', l: 'Interventions possibles (virgules)', v: (x.types_interventions || []).join(', '), ph: 'VIDANGE, ENTRETIEN, REPARATION' }) +
        champ({ n: 'specialites', l: 'Qualification et spécialités documentées', t: 'textarea', v: x.specialites }) +
        champ({ n: 'habilitation_constructeur', l: 'Habilitation constructeur (si documentée)', v: x.habilitation_constructeur }) +
        champ({ n: 'conditions_garantie', l: 'Conditions de garantie', t: 'textarea', v: x.conditions_garantie }) +
        champ({ n: 'tarifs_documentes', l: 'Tarifs documentés (source)', t: 'textarea', v: x.tarifs_documentes }) + '</div>' +
        '<p class="mm-note">Statut initial : candidat. L\'approbation relève du Branch Manager.</p>',
        function (v) {
          var p = { id: x.id || null, nom: v.nom, localisation: v.localisation, contact_professionnel: v.contact_professionnel, specialites: v.specialites,
                    habilitation_constructeur: v.habilitation_constructeur, conditions_garantie: v.conditions_garantie, tarifs_documentes: v.tarifs_documentes };
          if (v.clusters != null) p.clusters = v.clusters.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
          if (v.types_interventions != null) p.types_interventions = v.types_interventions.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
          return rpc('moto_garage_enregistrer', { p: p }).then(function () { return terminerOk(null, 'Garage enregistré (candidat).'); });
        });
    }
    function formVersion() {
      Promise.all([q('moto_modeles_techniques'), q('moto_regles_maintenance')]).then(function (r) {
        modale('Proposer une version de règle', '<div class="mm-grille-form">' + champ({ n: 'regle_code', l: 'Opération', t: 'select', req: true, o: r[1].map(function (x) { return [x.code, x.libelle]; }) }) +
          champ({ n: 'modele_code', l: 'Modèle technique', t: 'select', o: r[0].map(function (x) { return [x.code, x.libelle]; }), aide: 'Ou une moto précise (exception documentée), pas les deux.' }) +
          champ({ n: 'moto_id', l: 'Moto (exception)', t: 'select', o: I.S.flotte.map(function (m) { return [m.id, m.code]; }) }) +
          champ({ n: 'phase', l: 'Phase', t: 'select', vide: false, o: [['RECURRENT', 'Entretien récurrent'], ['RODAGE', 'Entretien de rodage (premier entretien)']] }) +
          champ({ n: 'intervalle_km', l: 'Intervalle (km)', t: 'nombre', pas: 1 }) + champ({ n: 'intervalle_jours', l: 'Intervalle (jours calendaires)', t: 'nombre', pas: 1 }) +
          champ({ n: 'rappel_avant_km', l: 'Rappel de planification (km avant)', t: 'nombre', pas: 1 }) + champ({ n: 'proche_avant_km', l: 'Échéance proche (km avant)', t: 'nombre', pas: 1 }) +
          champ({ n: 'rappel_avant_jours', l: 'Rappel (jours avant)', t: 'nombre', pas: 1 }) + champ({ n: 'proche_avant_jours', l: 'Proche (jours avant)', t: 'nombre', pas: 1 }) +
          champ({ n: 'nature_source', l: 'Nature de la source', t: 'select', req: true, o: [['CONSTRUCTEUR', 'Prescription constructeur documentée'], ['POLITIQUE_INTERNE', 'Politique interne ANAGROCI (validée techniquement)'], ['HYPOTHESE', 'Hypothèse de planification (jamais active)']] }) +
          champ({ n: 'reference_source', l: 'Référence de la source (document, page, avis technique)', t: 'textarea' }) +
          champ({ n: 'motif', l: 'Motif (10 caractères minimum)', t: 'textarea', req: true, min: 10 }) + '</div>' +
          '<p class="mm-note">La proposition reste un brouillon inactif jusqu\'à l\'approbation du Branch Manager. Aucune prescription constructeur sans référence.</p>',
          function (v) {
            ['intervalle_km', 'intervalle_jours', 'rappel_avant_km', 'proche_avant_km', 'rappel_avant_jours', 'proche_avant_jours'].forEach(function (k) { v[k] = C.nombreSaisi(v[k]); });
            return rpc('moto_regle_version_proposer', { p: v }).then(function () { return terminerOk(null, 'Version proposée (brouillon).'); });
          }, 'Proposer');
      });
    }

    function brancher(zone, D) {
      $$('[data-mnt]', zone).forEach(function (x) {
        x.onclick = function () { ({ nouveau: function () { nouveau(); }, garage: function () { formGarage(); }, version: formVersion })[x.dataset.mnt](); };
      });
      zone.onclick = function (e) {
        var bt = e.target.closest('[data-action]'); if (!bt) return;
        var f = ACT[bt.dataset.action]; if (f) f(Object.assign({}, bt.dataset), D, []);
      };
    }

    /* -- Onglet « Entretiens » du passeport ----------------------------------- */
    async function ongletMoto(m) {
      var r = await Promise.all([q('moto_v_echeances', function (x) { return x.eq('moto_id', m.id); }), q('moto_v_maintenance_dossiers', function (x) { return x.eq('moto_id', m.id).order('demande_at', { ascending: false }); }),
        q('moto_immobilisations', function (x) { return x.eq('moto_id', m.id).is('fin', null); })]);
      var ech = r[0], dos = r[1], immo = r[2];
      var refx = ech.filter(function (e) { return e.statut === 'DIAGNOSTIC_INITIAL_REQUIS' || e.statut === 'ETAT_REFERENCE_REQUIS'; });
      var html = (refx.length ? '<p class="mm-bandeau mm-warn">' + esc(lib(refx[0].statut)) + '. Aucune échéance n\'est calculée depuis une date ou un kilométrage supposés.</p>' : '') +
        '<h3>Échéances</h3>' + tableau(['Opération', 'Dernier entretien vérifié', 'Intervalle', 'Prochaine cible', 'Restant', 'Statut', 'Fiabilité', 'Règle'], ech.map(function (e) {
          return [esc(e.libelle), esc(e.dernier_entretien_date ? C.dateFr(e.dernier_entretien_date) + ' · ' + C.km(e.dernier_entretien_km) : (e.base_origine === 'MISE_EN_SERVICE' ? 'Aucun (base : mise en service)' : ND)),
            esc([e.intervalle_km ? C.km(e.intervalle_km) : null, e.intervalle_jours ? e.intervalle_jours + ' j' : null].filter(Boolean).join(' ou ') || ND),
            esc([e.prochaine_km != null ? C.km(e.prochaine_km) : null, e.prochaine_date ? C.dateFr(e.prochaine_date) : null].filter(Boolean).join(' ou ') || ND),
            esc([e.km_restants != null ? kms(e.km_restants) : null, e.jours_restants != null ? jours(e.jours_restants) : null].filter(Boolean).join(' · ') || ND),
            b(e.statut) + (e.declencheur ? '<small class="mm-aide">Seuil atteint en premier : ' + (e.declencheur === 'KM' ? 'kilomètres' : 'jours') + '</small>' : ''),
            esc(lib(e.fiabilite)), esc(e.version ? 'v' + e.version + ' · ' + lib(e.source) + (e.exception_moto ? ' · exception moto' : '') : '—')];
        }), 'Moto non mise en service : aucune échéance.') +
        '<h3>Dossiers de maintenance</h3>' + tableau(['Demandé le', 'Besoin', 'Statut', 'Garage', 'Travaux', ''], dos.map(function (x) {
          return [esc(C.dateFr(x.demande_at)), esc(C.libelle(x.type_maintenance)) + '<small class="mm-aide">' + esc(x.description) + '</small>', b(x.statut), esc(x.garage_nom || ND), esc(travauxTexte(x.travaux)), action('mnt_dossier', 'Ouvrir', { id: x.id })];
        }), 'Aucun dossier.') +
        (peut('maintenance_demande') || peut('maintenance_preparer') ? '<div class="mm-actions">' + action('mnt_nouveau', 'Signaler un besoin d\'entretien', { moto: m.id }) + '</div>' : '');
      if (immo.length) {
        html += '<h3>Immobilisations en cours</h3>' + tableau(['Depuis', 'Motif', 'Origine', ''], immo.map(function (im) {
          return [esc(C.dateHeureFr(im.debut)), esc(im.motif || ND), esc(C.libelle(im.source_type) || im.source_type), peut('lever_immobilisation') && im.source_type !== 'INCIDENT' ? action('mnt_lever', 'Remettre en circulation', { id: im.id, moto: m.id }, 'mm-primaire') :
            (im.source_type === 'INCIDENT' ? '<small class="mm-aide">Levée par le circuit de l\'incident</small>' : '')];
        }), '') + '<p class="mm-note">Remise en circulation : travaux contrôlés conformes, contrôle de remise en service APTE enregistré après l\'immobilisation, aucune anomalie critique ouverte, levée par une autre personne que l\'auteur du contrôle et que l\'utilisateur. Une facture payée ne suffit jamais.</p>';
      }
      return html;
    }
    ACT.mnt_lever = function (d) {
      modale('Remettre en circulation', champ({ n: 'motif', l: 'Motif (5 caractères minimum)', t: 'textarea', req: true, min: 5 }) +
        '<p class="mm-note">Le serveur refuse la levée si une condition de sécurité manque.</p>',
        function (v) { return rpc('moto_lever_immobilisation', { p_immobilisation: d.id, p_motif: v.motif }).then(function () { return terminerOk(null, 'Immobilisation levée.'); }); }, 'Lever');
    };

    return { vue: vue, ongletMoto: ongletMoto, ouvrir: ouvrir, actions: ACT, nouveau: nouveau };
  };
})(window);

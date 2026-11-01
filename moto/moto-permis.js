/* ============================================================================
   AFLP FLEET — permis des conducteurs (moto/moto-permis.js)
   ----------------------------------------------------------------------------
   Le permis appartient au CONDUCTEUR, pas à la moto : il le suit d'une moto à
   l'autre. Il est scanné (recto/verso dans un PDF), ses informations sont
   recopiées par la personne qui lit le document, puis contrôlé sur l'original
   par l'ABM ou le Branch Manager (jamais le déposant ni le titulaire).
   Le serveur refuse toute remise ou tout transfert sans permis CONFORME et
   en cours de validité (migration 7). Les boutons ne protègent rien.
   Données personnelles : visibles du BM, de l'ABM, du coordinateur et du
   titulaire seulement.
   ========================================================================== */
(function (g) {
  'use strict';
  g.MOTO_PERMIS = function (I) {
    var C = I.C, S = I.S, esc = I.esc, $$ = I.$$, tableau = I.tableau, action = I.action, champ = I.champ, modale = I.modale,
        rpc = I.rpc, lire = I.lireTable, peut = I.peut, ND = C.ND;
    var CATEGORIES = ['A1', 'A', 'B', 'C', 'D', 'E'];
    var LIB = { VALIDE: 'Valide', EXPIRE_BIENTOT: 'Expire bientôt', EXPIRE: 'Expiré', EN_VERIFICATION: 'À vérifier sur l\'original',
      CONFORME: 'Conforme', NON_CONFORME: 'Non conforme', REMPLACE: 'Remplacé (renouvelé)', AUCUN_PERMIS_VALIDE: 'Aucun permis valide', AUCUN: 'Aucun permis enregistré' };
    var TON = { VALIDE: 'ok', CONFORME: 'ok', EXPIRE_BIENTOT: 'warn', EN_VERIFICATION: 'warn', EXPIRE: 'ko', NON_CONFORME: 'ko', AUCUN_PERMIS_VALIDE: 'ko', AUCUN: 'ko', REMPLACE: 'neutre' };
    function b(code, texte) { return '<span class="mm-badge mm-badge-long mm-' + (TON[code] || 'neutre') + '">' + esc(texte || LIB[code] || code) + '</span>'; }
    function validite(p) {
      if (!p) return b('AUCUN');
      if (p.statut !== 'CONFORME') return b(p.statut);
      var t = p.sans_expiration ? 'Valide · sans date d\'expiration sur le document'
        : (LIB[p.statut_validite] || p.statut_validite) + ' · jusqu\'au ' + C.dateFr(p.date_expiration) + (p.jours_restants != null && p.jours_restants >= 0 ? ' (' + p.jours_restants + ' j)' : '');
      return b(p.statut_validite, t);
    }
    // Permis de référence d'un conducteur : CONFORME, sinon celui en vérification, sinon le plus récent.
    function principal(liste, uid) {
      var l = liste.filter(function (p) { return p.titulaire_id === uid && p.statut !== 'REMPLACE'; });
      return l.filter(function (p) { return p.statut === 'CONFORME'; })[0] || l.filter(function (p) { return p.statut === 'EN_VERIFICATION'; })[0] || l[0] || null;
    }
    function fonction(x) { return { LOGISTIQUE: 'Coordinateur logistique', ABM: 'Assistant Branch Manager', ZONE: 'Chef de zone', UNITE: 'Chef d\'unité', BM: 'Branch Manager' }[x.classe] || x.role; }
    function enAttente(liste, uid) { return liste.filter(function (p) { return p.titulaire_id === uid && p.statut === 'EN_VERIFICATION'; })[0] || null; }

    /* -- Dépôt du scan dans le stockage privé ---------------------------------- */
    async function deposer(titulaire, fichier) {
      var chemin = 'permis/' + titulaire + '/' + I.OFF.uuid() + '.pdf';
      var r = await S.sb.storage.from('moto-documents').upload(chemin, fichier, { upsert: false, contentType: 'application/pdf' });
      if (r.error) throw new Error('Dépôt du scan refusé : ' + I.messageErreur(r.error));
      return chemin;
    }

    /* -- Formulaire d'enregistrement (titulaire, ou BM / ABM / coordinateur) ----- */
    function enregistrer(titulaire, nomCompte, apres) {
      var soi = titulaire === S.profil.user_id;
      modale(soi ? 'Scanner mon permis de conduire' : 'Permis de conduire · ' + nomCompte,
        '<p class="mm-note">1. Scannez le permis (recto, puis verso). 2. Recopiez les informations en lisant le document : rien n\'est rempli automatiquement. 3. L\'ABM ou le Branch Manager le contrôlera sur l\'original.</p>' +
        champ({ n: 'scan', l: 'Permis numérisé (recto et verso)', t: 'scan', req: true }) +
        '<div class="mm-grille-form">' +
        champ({ n: 'nom_titulaire', l: 'Nom et prénoms, tels qu\'imprimés', req: true, v: nomCompte || '' }) +
        champ({ n: 'numero_permis', l: 'Numéro du permis', req: true, aide: 'Recopié caractère par caractère : lettres, chiffres, espaces, / . -' }) +
        champ({ n: 'date_delivrance', l: 'Date de délivrance', t: 'date', max: I.aujourdhui() }) +
        champ({ n: 'date_expiration', l: 'Date d\'expiration', t: 'date' }) +
        champ({ n: 'sans_expiration', l: 'Aucune date d\'expiration sur le document', t: 'checkbox' }) +
        champ({ n: 'autorite_delivrance', l: 'Délivré par (autorité, lieu)' }) +
        '<fieldset class="mm-champ mm-large mm-categories"><legend>Catégories portées sur le permis *</legend>' +
        CATEGORIES.map(function (c) { return '<label class="mm-case"><input type="checkbox" name="cat_' + c + '"> ' + c + '</label>'; }).join('') +
        '<label class="mm-cat-autre">Autre(s) : <input type="text" name="cat_autres" placeholder="Ex. BE, CE" autocomplete="off"></label></fieldset></div>',
        async function (v) {
          var cats = CATEGORIES.filter(function (c) { return v['cat_' + c]; }).concat(String(v.cat_autres || '').split(/[,;\s]+/).filter(Boolean));
          if (!cats.length) throw new Error('Cochez au moins une catégorie.');
          if (!v.sans_expiration && !v.date_expiration) throw new Error('Date d\'expiration obligatoire, ou cochez « aucune date d\'expiration sur le document ».');
          if (v.sans_expiration && v.date_expiration) throw new Error('Date d\'expiration ET « aucune date » : choisissez l\'un ou l\'autre.');
          var chemin = await deposer(titulaire, v.scan);
          var r = await rpc('moto_permis_enregistrer', { p: { titulaire_id: titulaire, nom_titulaire: v.nom_titulaire, numero_permis: v.numero_permis, categories: cats,
            date_delivrance: v.date_delivrance, date_expiration: v.sans_expiration ? null : v.date_expiration, sans_expiration: !!v.sans_expiration,
            autorite_delivrance: v.autorite_delivrance, document_path: chemin, nom_fichier: v.scan.name } });
          if (apres) apres();
          return r.note;
        }, 'Enregistrer le permis');
    }

    /* -- Vérification sur original (ABM, BM) ----------------------------------- */
    function verifier(p, apres) {
      modale('Vérifier le permis · ' + p.nom_titulaire,
        '<dl class="mm-mini mm-permis-recap"><div><dt>Numéro</dt><dd>' + esc(p.numero_permis) + '</dd></div><div><dt>Catégories</dt><dd>' + esc((p.categories || []).join(', ')) + '</dd></div>' +
        '<div><dt>Délivré le</dt><dd>' + esc(C.dateFr(p.date_delivrance)) + '</dd></div><div><dt>Expire le</dt><dd>' + esc(p.sans_expiration ? 'Aucune date sur le document' : C.dateFr(p.date_expiration)) + '</dd></div>' +
        '<div><dt>Déposé par</dt><dd>' + esc(p.depose_par_nom || ND) + ' · ' + esc(C.dateHeureFr(p.depose_at)) + '</dd></div></dl>' +
        '<p>' + action('voir_fichier', 'Ouvrir le scan', { chemin: p.document_path }, 'mm-primaire') + '</p>' +
        '<p class="mm-note">Comparez le scan ET les informations saisies avec l\'original présenté. Un permis douteux, illisible ou dont la catégorie ne convient pas à la moto doit être déclaré non conforme.</p>' +
        '<div class="mm-grille-form">' + champ({ n: 'statut', l: 'Décision', t: 'select', req: true, o: [['CONFORME', 'Conforme à l\'original'], ['NON_CONFORME', 'Non conforme']] }) +
        champ({ n: 'rh', l: 'Original contrôlé par (nom, RH)', aide: 'Obligatoire si conforme.' }) +
        champ({ n: 'adaptee', l: 'La catégorie est adaptée à la moto qui sera confiée', t: 'checkbox' }) +
        champ({ n: 'motif', l: 'Motif (obligatoire si non conforme)', t: 'textarea' }) + '</div>',
        function (v) {
          return rpc('moto_permis_verifier', { p_permis: p.id, p_statut: v.statut, p_verification_rh_nom: v.rh, p_categorie_adaptee: !!v.adaptee, p_motif: v.motif })
            .then(function () { if (apres) apres(); return v.statut === 'CONFORME' ? 'Permis conforme : le conducteur peut recevoir une moto.' : 'Permis déclaré non conforme.'; });
        }, 'Enregistrer la décision');
      var d = $$('dialog.mm-modale').pop(); if (d) d.addEventListener('click', function (e) { var x = e.target.closest('[data-action="voir_fichier"]'); if (x) I.ouvrirFichier(x.dataset.chemin); });
    }
    function peutVerifier(p) { return peut('permis_verifier') && p && p.statut === 'EN_VERIFICATION' && p.depose_par !== S.profil.user_id && p.titulaire_id !== S.profil.user_id; }

    /* -- Espace « Conducteurs » ------------------------------------------------ */
    async function vue() {
      var r = await Promise.all([I.beneficiaires(), lire('moto_v_permis', function (q) { return q.order('depose_at', { ascending: false }); }),
        rpc('moto_permis_alertes').catch(function () { return []; })]);
      var benef = r[0] || [], permis = r[1], alertes = r[2] || [];
      var attente = permis.filter(function (p) { return p.statut === 'EN_VERIFICATION'; });
      I.vue().innerHTML = '<div class="mm-entete"><div><h1>Conducteurs et permis</h1><p>Le permis suit le conducteur. Remise et transfert sont refusés par le serveur sans permis contrôlé conforme et en cours de validité.</p></div></div>' +
        (alertes.length ? '<section class="mm-bloc mm-alerte-bloc"><h2>À traiter : conducteurs affectés</h2>' + tableau(['Moto', 'Conducteur', 'Situation', 'Expiration'], alertes.map(function (a) {
          return [esc(a.moto_code), esc(a.beneficiaire_nom || ND), b(a.statut_validite, a.statut_validite === 'EXPIRE_BIENTOT' ? 'Expire dans ' + a.jours_restants + ' j' : null), esc(a.date_expiration ? C.dateFr(a.date_expiration) : ND)];
        }), '') + '<p class="mm-note">Un conducteur sans permis valide ne doit pas circuler : faites renouveler le permis ou retirez l\'affectation.</p></section>' : '') +
        (attente.length ? '<section class="mm-bloc"><h2>Permis à vérifier sur l\'original (' + attente.length + ')</h2>' + tableau(['Conducteur', 'Numéro', 'Catégories', 'Déposé par', ''], attente.map(function (p) {
          return [esc(p.nom_titulaire), esc(p.numero_permis), esc((p.categories || []).join(', ')), esc((p.depose_par_nom || ND) + ' · ' + C.dateFr(p.depose_at)),
            action('pm_scan', 'Scan', { chemin: p.document_path }) + (peutVerifier(p) ? ' ' + action('pm_verifier', 'Vérifier', { id: p.id }, 'mm-primaire') : '')];
        }), '') + '</section>' : '') +
        '<section class="mm-bloc"><h2>Conducteurs (' + benef.length + ')</h2>' + tableau(['Conducteur', 'Fonction', 'Permis', 'Catégories', 'Validité', ''], benef.map(function (x) {
          var p = principal(permis, x.user_id), att = enAttente(permis, x.user_id);
          return [esc(x.nom), esc(fonction(x) + (x.cluster_code ? ' · ' + x.cluster_code : '')), esc(p ? p.numero_permis : ND), esc(p ? (p.categories || []).join(', ') : ND), validite(p),
            (p ? action('pm_scan', 'Scan', { chemin: p.document_path }) + ' ' : '') +
            (peut('permis_enregistrer') && !att && x.user_id !== S.profil.user_id ? action('pm_enregistrer', p ? 'Renouveler' : 'Scanner le permis', { uid: x.user_id, nom: x.nom }, p ? 'mm-secondaire' : 'mm-primaire') : '')];
        }), 'Aucun conducteur éligible (Chef d\'unité, Chef de zone, ABM, coordinateur).') + '</section>' +
        '<p class="mm-note">Catégorie adaptée : la règle légale applicable aux APSONIC AP150-30 (cylindrée 150 cm³) est à confirmer par les RH ; le vérificateur l\'atteste pour chaque permis.</p>';
      I.vue().onclick = function (e) {
        var x = e.target.closest('[data-action]'); if (!x) return;
        if (x.dataset.action === 'pm_scan') I.ouvrirFichier(x.dataset.chemin);
        if (x.dataset.action === 'pm_enregistrer') enregistrer(x.dataset.uid, x.dataset.nom, vue);
        if (x.dataset.action === 'pm_verifier') verifier(permis.filter(function (p) { return p.id === x.dataset.id; })[0], vue);
      };
    }

    /* -- Bloc « Mon permis » (accueil du conducteur) ---------------------------- */
    async function blocMonPermis() {
      if (!peut('mon_permis')) return '';
      var l = await lire('moto_v_permis', function (q) { return q.eq('titulaire_id', S.profil.user_id).order('depose_at', { ascending: false }); }).catch(function () { return null; });
      if (!l) return '';
      var p = principal(l, S.profil.user_id), att = enAttente(l, S.profil.user_id), nc = l.filter(function (x) { return x.statut === 'NON_CONFORME'; })[0];
      return '<section class="mm-bloc mm-mon-permis"><h2>Mon permis de conduire</h2><div class="mm-mon-permis-ligne">' + validite(p) +
        (p ? '<span>' + esc(p.numero_permis) + ' · catégories ' + esc((p.categories || []).join(', ')) + '</span>' : '<span>Obligatoire pour recevoir une moto.</span>') + '</div>' +
        (att && att !== p ? '<p class="mm-note">Renouvellement déposé le ' + esc(C.dateFr(att.depose_at)) + ', en attente de vérification.</p>' : '') +
        (nc && (!p || p.statut !== 'CONFORME') ? '<p class="mm-bandeau mm-ko">Dernier dépôt non conforme : ' + esc(nc.motif_verification || '') + '</p>' : '') +
        (!att ? '<div class="mm-actions"><button type="button" class="mm-btn ' + (p && p.statut === 'CONFORME' && p.statut_validite === 'VALIDE' ? 'mm-secondaire' : 'mm-primaire') + ' mm-petit" data-mon-permis>' +
          (p ? 'Scanner un permis renouvelé' : 'Scanner mon permis') + '</button></div>' : '') + '</section>';
    }
    function brancherMonPermis(racine, apres) {
      $$('[data-mon-permis]', racine).forEach(function (x) { x.onclick = function () { enregistrer(S.profil.user_id, S.profil.nom, apres); }; });
    }

    /* -- Information dans la remise et le transfert ----------------------------- */
    async function infoRemise(uid) {
      if (!uid) return '<p class="mm-bandeau mm-warn">Choisissez le bénéficiaire : son permis sera contrôlé par le serveur.</p>';
      var l = await lire('moto_v_permis', function (q) { return q.eq('titulaire_id', uid); }).catch(function () { return []; });
      var p = l.filter(function (x) { return x.statut === 'CONFORME'; })[0];
      if (p && p.statut_validite !== 'EXPIRE') {
        return '<p class="mm-bandeau mm-ok">Permis du bénéficiaire : conforme (contrôlé par ' + esc(p.verification_rh_nom || ND) + '), catégories ' + esc((p.categories || []).join(', ')) +
          ', ' + esc(p.sans_expiration ? 'sans date d\'expiration' : 'valable jusqu\'au ' + C.dateFr(p.date_expiration)) + '. Repris automatiquement dans la remise.</p>';
      }
      return '<p class="mm-bandeau mm-ko">Aucun permis conforme et valide pour ce bénéficiaire : la remise sera refusée. Faites scanner et vérifier son permis (espace Conducteurs).</p>';
    }

    return { vue: vue, blocMonPermis: blocMonPermis, brancherMonPermis: brancherMonPermis, infoRemise: infoRemise, enregistrer: enregistrer };
  };
})(window);

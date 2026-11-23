/* SIGNALEMENTS GPS AFLP · signaler un point GPS de parcelle douteux, sans le modifier
   ---------------------------------------------------------------------------------
   Module partagé par la fiche parcelle (operations/parcelles.js) et par la rubrique
   Repères GPS (operations/reperes-gps.js). Il n'écrit RIEN localement et ne touche à
   aucun point : il lit public.geo_signalements_v et appelle trois fonctions serveur
   (geo_signalement_creer / _repondre / _resoudre), qui portent toutes les règles.
   L'interface n'est qu'un reflet : un bouton masqué n'est pas une sécurité.

   Qui fait quoi (appliqué par le serveur) :
     Signaler, résoudre : Branch Manager, Chef de Zone de la zone.
     Répondre           : Chef d'Unité et assistant du cluster (et le Branch Manager).
     Lire               : périmètre de lecture des parcelles.
   Les actions exigent une connexion (supervision, pas de file hors ligne).
   Données de test : fictives uniquement. */
(function (global) {
'use strict';

var MOTIFS = {
  CAPTURE_HORS_CHAMP: 'Point pris hors du champ (au village, sur la route…)',
  POSITION_INCOHERENTE: 'Position incohérente avec le champ connu',
  PRECISION_DOUTEUSE: 'Précision douteuse',
  AUTRE: 'Autre motif'
};
var RESOLUTIONS = {
  POINT_CORRIGE: 'Point corrigé (repris sur le champ)',
  POINT_CONFIRME: 'Point confirmé exact',
  SANS_SUITE: 'Classé sans suite'
};
var ROLES = { BM: 'Branch Manager', ABM: 'Assistant Branch Manager', ZH: 'Chef de Zone', UH: 'Chef d\'Unité', AUH: 'Assistant du Chef d\'Unité' };
var STATUTS = { OUVERT: 'Ouvert', RESOLU: 'Résolu', CLASSE: 'Classé' };
var COLS = 'id,cible_type,plot_id,repere_id,repere_objet_type,repere_objet_id,cluster_code,zone_code,point_latitude,point_longitude,point_precision_m,point_releve_le,point_etat,distance_village_m,motif_code,motif,statut,signale_par,signale_role,signale_le,resolution_code,resolution_motif,resolu_role,resolu_le,plot_code,local_name,village_nom,producteur_code,producteur_nom,producteur_prenoms,signale_par_nom,resolu_par_nom,journal';
var MIN = 10, MAX = 1000;

var hotes = {};            // hote → { rpc, apres }
var cibles = {};           // clé → cible rendue (pour l'envoi)
var etat = { form: null, messages: {}, enCours: false };

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function nb2(n) { return ('0' + n).slice(-2); }
function heureFr(d) { if (!d) return '—'; var t = new Date(d); if (isNaN(t)) return String(d); return nb2(t.getDate()) + '/' + nb2(t.getMonth() + 1) + '/' + t.getFullYear() + ' ' + nb2(t.getHours()) + ':' + nb2(t.getMinutes()); }
function fmt(x) { return x == null || x === '' ? '—' : Number(x).toFixed(6); }
function avis(type, html) { return '<div class="sg-avis sg-avis-' + type + '" role="' + (type === 'erreur' ? 'alert' : 'status') + '">' + html + '</div>'; }
function bouton(hote, libelle, action, cls, cle, attrs) {
  return '<button type="button" class="btn sg-btn ' + (cls || 'secondary') + '" data-sg="' + esc(action) + '" data-sg-hote="' + esc(hote) + '" data-sg-cle="' + esc(cle || '') + '"' + (attrs || '') + '>' + esc(libelle) + '</button>';
}
function cleCible(c) { return c.type === 'REPERE' ? 'REPERE:' + c.objet_type + ':' + c.objet_id : 'POINT_PARCELLE:' + c.plot_id; }
function cleSignalement(s) { return s.cible_type === 'REPERE' ? 'REPERE:' + s.repere_objet_type + ':' + s.repere_objet_id : 'POINT_PARCELLE:' + s.plot_id; }

/* Distance (m) d'après la formule de haversine ; indicateur affiché, pas une preuve. */
function distance(la1, lo1, la2, lo2) {
  if ([la1, lo1, la2, lo2].some(function (v) { return v == null || v === '' || isNaN(Number(v)); })) return null;
  var r = Math.PI / 180, a = Math.pow(Math.sin((la2 - la1) * r / 2), 2) + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.pow(Math.sin((lo2 - lo1) * r / 2), 2);
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(a)));
}
function texteDistance(m) { return m == null ? '' : m >= 1000 ? (String((m / 1000).toFixed(1)).replace('.', ',') + ' km') : (m + ' m'); }

/* La table absente (migration non appliquée ou retirée) n'est pas une panne : on le dit. */
function indisponible(e) { var m = String(e && e.message || e || ''); return /geo_signalement|PGRST20[25]|42P01|42883|schema cache|does not exist/i.test(m); }

function charger(lire, plotId) {
  return lire('geo_signalements_v', COLS, function (r) { return r.eq('plot_id', plotId).order('signale_le', { ascending: false }); })
    .then(function (l) { return { dispo: true, liste: l || [] }; }, function (e) { return { dispo: !indisponible(e), erreur: e && e.message, liste: [] }; });
}
function ouverts(lire) {
  return lire('geo_signalements_v', COLS, function (r) { return r.eq('statut', 'OUVERT').order('signale_le', { ascending: true }).limit(200); })
    .then(function (l) { return { dispo: true, liste: l || [] }; }, function (e) { return { dispo: !indisponible(e), erreur: e && e.message, liste: [] }; });
}
/* Repère actif sur le serveur (son identifiant n'est pas gardé dans la file locale des repères). */
function repereServeur(lire, type, id) {
  return lire('geo_reperes', 'id,objet_type,objet_id,plot_id,latitude,longitude,origine,precision_m,version_no', function (r) { return r.eq('objet_type', type).eq('objet_id', id).eq('actif', true).limit(1); })
    .then(function (l) { return (l && l[0]) || null; }, function () { return null; });
}

function peutSignaler(classe) { return classe === 'BM' || classe === 'ZH'; }
function peutResoudre(classe) { return classe === 'BM' || classe === 'ZH'; }
function peutRepondre(classe) { return classe === 'BM' || classe === 'UH' || classe === 'AUH'; }

function journal(s) {
  var l = (s.journal || []).filter(function (e) { return e.action !== 'SIGNALER'; });
  if (!l.length) return '';
  return '<ul class="sg-journal">' + l.map(function (e) {
    return '<li><b>' + esc(e.action === 'REPONDRE' ? 'Réponse' : 'Résolution') + '</b> · ' + esc(e.nom || ROLES[e.role] || e.role) + ' (' + esc(ROLES[e.role] || e.role) + '), ' + esc(heureFr(e.le)) + '<br>' + esc(e.texte) + '</li>';
  }).join('') + '</ul>';
}
function resume(s) {
  return '<p class="sg-ligne"><b>' + esc(MOTIFS[s.motif_code] || s.motif_code) + '</b> — ' + esc(s.motif) + '</p>' +
    '<p class="sg-meta">Signalé par ' + esc(s.signale_par_nom || ROLES[s.signale_role] || s.signale_role) + ' (' + esc(ROLES[s.signale_role] || s.signale_role) + ') le ' + esc(heureFr(s.signale_le)) +
    ' · point signalé <span class="mono">' + esc(fmt(s.point_latitude)) + ' ; ' + esc(fmt(s.point_longitude)) + '</span>' +
    (s.distance_village_m != null ? ' · à ' + esc(texteDistance(s.distance_village_m)) + ' du centre du village' : '') + '</p>';
}

/* Formulaires d'un signalement OUVERT, selon le profil. */
function actionsOuvert(hote, s, classe, enLigne) {
  if (!enLigne) return '<p class="sg-note">Connexion requise pour répondre ou résoudre.</p>';
  var h = '';
  if (peutRepondre(classe)) {
    h += '<label class="sg-champ" for="sgRep_' + esc(s.id) + '"><span>' + (classe === 'BM' ? 'Ajouter une réponse' : 'Votre réponse (ce qui est fait sur le terrain)') + '</span>' +
      '<textarea id="sgRep_' + esc(s.id) + '" maxlength="' + MAX + '" rows="2"></textarea></label>' +
      '<div class="sg-actions">' + bouton(hote, 'Envoyer la réponse', 'repondre', 'secondary', s.id) + '</div>';
  }
  if (peutResoudre(classe)) {
    h += '<fieldset class="sg-resoudre"><legend>Résoudre le signalement</legend>' +
      Object.keys(RESOLUTIONS).map(function (k) {
        return '<label class="sg-radio"><input type="radio" name="sgRes_' + esc(s.id) + '" value="' + k + '"> <span>' + esc(RESOLUTIONS[k]) + '</span></label>';
      }).join('') +
      '<label class="sg-champ" for="sgResM_' + esc(s.id) + '"><span>Motif de la résolution (obligatoire)</span><textarea id="sgResM_' + esc(s.id) + '" maxlength="' + MAX + '" rows="2"></textarea></label>' +
      '<p class="sg-note">« Point corrigé » n\'est accepté que si le point a réellement été repris depuis le signalement.</p>' +
      '<div class="sg-actions">' + bouton(hote, 'Résoudre', 'resoudre', 'primary', s.id) + '</div></fieldset>';
  }
  return h;
}

/* Section « Signalement » pour UNE cible (point de référence ou repère).
   opts : { hote, cible:{type, plot_id, objet_type, objet_id, repere_id, latitude, longitude, village_latitude, village_longitude, titre}, donnees, classe, enLigne } */
function section(opts) {
  var c = opts.cible, hote = opts.hote, d = opts.donnees, classe = opts.classe, cle = cleCible(c);
  if (c.latitude == null || c.longitude == null) return '';
  if (!d) return opts.enLigne ? '' : '<div class="sg-section"><p class="sg-note">Hors ligne : les signalements de ce point seront affichés au retour du réseau.</p></div>';
  cibles[cle] = c;
  var liste = (d.liste || []).filter(function (s) { return cleSignalement(s) === cle; });
  var ouvert = liste.filter(function (s) { return s.statut === 'OUVERT'; })[0];
  var clos = liste.filter(function (s) { return s.statut !== 'OUVERT'; });
  var msg = etat.messages[cle]; delete etat.messages[cle];
  var h = '<div class="sg-section" data-sg-cible="' + esc(cle) + '">' + (msg ? avis(msg[0], msg[1]) : '');
  if (d.dispo === false) return h + '<p class="sg-note">Signalement des points GPS indisponible sur ce serveur pour le moment.</p></div>';
  if (ouvert) {
    h += avis('alerte', '<b>Point GPS signalé par la supervision.</b> Le point n\'a pas été modifié : il doit être vérifié sur le champ.' + resume(ouvert) + journal(ouvert)) +
      actionsOuvert(hote, ouvert, classe, opts.enLigne);
  } else if (!opts.enLigne) {
    h += '<p class="sg-note">Connexion requise pour signaler ce point.</p>';
  } else if (peutSignaler(classe)) {
    if (etat.form === cle) {
      var dist = distance(Number(c.latitude), Number(c.longitude), c.village_latitude != null ? Number(c.village_latitude) : null, c.village_longitude != null ? Number(c.village_longitude) : null);
      h += '<div class="sg-form"><h3>Signaler ce point</h3>' +
        '<p class="sg-note">Point concerné : <span class="mono">' + esc(fmt(c.latitude)) + ' ; ' + esc(fmt(c.longitude)) + '</span>' + (dist != null ? ' · à ' + esc(texteDistance(dist)) + ' du centre du village' : '') +
        '. Le point ne sera <b>pas modifié</b> : le Chef d\'Unité du cluster verra le signalement et devra le faire vérifier.</p>' +
        '<fieldset class="sg-motifs"><legend>Motif (obligatoire)</legend>' + Object.keys(MOTIFS).map(function (k) {
          return '<label class="sg-radio"><input type="radio" name="sgMotifCode" value="' + k + '"> <span>' + esc(MOTIFS[k]) + '</span></label>';
        }).join('') + '</fieldset>' +
        '<label class="sg-champ" for="sgMotif"><span>Décrivez ce qui ne va pas (obligatoire)</span><textarea id="sgMotif" maxlength="' + MAX + '" rows="3" placeholder="Exemple : point pris au village, le champ est à environ 4 km"></textarea></label>' +
        '<div class="sg-actions">' + bouton(hote, 'Envoyer le signalement', 'envoyer', 'primary', cle) + bouton(hote, 'Annuler', 'annuler', 'secondary', cle) + '</div></div>';
    } else {
      h += '<div class="sg-actions">' + bouton(hote, 'Signaler ce point', 'ouvrir', 'signal', cle) + '</div>';
    }
  }
  if (clos.length) {
    h += '<details class="sg-historique"><summary>Signalements clos (' + clos.length + ')</summary>' + clos.map(function (s) {
      return '<div class="sg-clos"><span class="sg-pastille sg-p-' + esc(s.statut.toLowerCase()) + '">' + esc(STATUTS[s.statut]) + ' · ' + esc(RESOLUTIONS[s.resolution_code] || '') + '</span>' + resume(s) +
        '<p class="sg-meta">Résolu par ' + esc(s.resolu_par_nom || ROLES[s.resolu_role] || '') + ' (' + esc(ROLES[s.resolu_role] || '') + ') le ' + esc(heureFr(s.resolu_le)) + ' : ' + esc(s.resolution_motif) + '</p></div>';
    }).join('') + '</details>';
  }
  return h + '</div>';
}

/* Liste des signalements ouverts du périmètre (Chef d'Unité : ceux de son cluster, filtrés par le serveur).
   opts : { hote, donnees, classe, lien: function (s) → hash } */
function listeOuverts(opts) {
  var d = opts.donnees || { liste: [] };
  if (d.dispo === false || !(d.liste || []).length) return '';
  var titre = peutRepondre(opts.classe) && opts.classe !== 'BM' ? 'Points GPS signalés à faire vérifier' : 'Points GPS signalés en cours';
  return '<section class="card sg-liste"><div class="card-head"><div><h2>' + esc(titre) + ' (' + d.liste.length + ')</h2>' +
    '<p>Signalés par la supervision. Le point n\'est jamais modifié par un signalement : faites-le reprendre sur le champ, répondez, puis la supervision résout.</p></div></div>' +
    d.liste.map(function (s) {
      var nom = [s.producteur_nom, s.producteur_prenoms].filter(Boolean).join(' ') || s.producteur_code || 'Producteur';
      var cible = s.cible_type === 'REPERE' ? 'Repère ' + ({ PARCELLE: 'de parcelle', BLOC: 'de bloc', ARBRE: 'd\'arbre' }[s.repere_objet_type] || '') : 'Point GPS de référence';
      var nbRep = (s.journal || []).filter(function (e) { return e.action === 'REPONDRE'; }).length;
      return '<a class="sg-item" href="#' + esc(opts.lien(s)) + '"><span><b>' + esc(nom) + '</b><small>' + esc(s.local_name || 'Champ') + (s.plot_code ? ' · ' + esc(s.plot_code) : '') + ' · ' + esc(s.village_nom || '—') + ' · ' + esc(s.cluster_code || '—') + '</small>' +
        '<small>' + esc(cible) + ' · ' + esc(MOTIFS[s.motif_code] || s.motif_code) + ' · signalé le ' + esc(heureFr(s.signale_le)) + '</small></span>' +
        '<span class="sg-pastille ' + (nbRep ? 'sg-p-repondu' : 'sg-p-ouvert') + '">' + (nbRep ? nbRep + ' réponse' + (nbRep > 1 ? 's' : '') : 'Sans réponse') + '</span></a>';
    }).join('') + '</section>';
}

/* ------------------------------------------------------------------ actions */
function messageServeur(e) {
  var m = String(e && e.message || e || 'Erreur inconnue.');
  if (/Failed to fetch|NetworkError|réseau|Pas de réponse/i.test(m)) return 'Le serveur n\'a pas répondu. Rien n\'a été enregistré : réessayez avec une meilleure connexion.';
  if (indisponible(e)) return 'Signalement des points GPS indisponible sur ce serveur pour le moment.';
  return m;
}
function appeler(hote, nom, args) {
  var H = hotes[hote]; if (!H) return Promise.reject(new Error('Écran non prêt.'));
  return Promise.resolve(H.rpc(nom, args)).then(function (x) { if (x && x.error) throw x.error; return x ? x.data : null; });
}
function fini(hote) { etat.enCours = false; var H = hotes[hote]; if (H && H.apres) return H.apres(); }
function valeurRadio(nom) { var x = document.querySelector('input[name="' + nom + '"]:checked'); return x ? x.value : ''; }
function texte(id) { var x = document.getElementById(id); return x ? String(x.value || '').trim() : ''; }
function erreurLocale(bouton, texteErreur) {
  var z = bouton.closest('.sg-form, .sg-section, fieldset') || bouton.parentNode, old = z.querySelector('.sg-erreur-locale');
  if (old) old.remove();
  z.insertAdjacentHTML('afterbegin', '<div class="sg-avis sg-avis-erreur sg-erreur-locale" role="alert">' + esc(texteErreur) + '</div>');
}

function surClic(ev) {
  var b = ev.target.closest ? ev.target.closest('[data-sg]') : null;
  if (!b || b.disabled) return;
  var a = b.getAttribute('data-sg'), hote = b.getAttribute('data-sg-hote'), cle = b.getAttribute('data-sg-cle');
  if (!hotes[hote]) return;
  if (a === 'ouvrir') { etat.form = cle; return fini(hote); }
  if (a === 'annuler') { etat.form = null; return fini(hote); }
  if (etat.enCours) return;
  if (a === 'envoyer') {
    var c = cibles[cle]; if (!c) return;
    var code = valeurRadio('sgMotifCode'), motif = texte('sgMotif');
    if (!code) return erreurLocale(b, 'Choisissez le motif du signalement.');
    if (motif.length < MIN) return erreurLocale(b, 'Décrivez le motif en quelques mots (' + MIN + ' caractères au moins).');
    etat.enCours = true; b.disabled = true; b.textContent = 'Envoi…';
    var p = { cible_type: c.type, motif_code: code, motif: motif, point_latitude: c.latitude, point_longitude: c.longitude };
    if (c.type === 'REPERE') p.repere_id = c.repere_id; else p.plot_id = c.plot_id;
    return appeler(hote, 'geo_signalement_creer', { p: p }).then(function (r) {
      etat.form = null;
      etat.messages[cle] = ['succes', '<b>Point signalé.</b> Le Chef d\'Unité du cluster le voit dans sa liste. Le point n\'a pas été modifié.' + (r && r.distance_village_m != null ? ' Distance calculée par le serveur : ' + esc(texteDistance(r.distance_village_m)) + ' du centre du village.' : '')];
    }, function (e) { etat.messages[cle] = ['erreur', '<b>Signalement non enregistré.</b> ' + esc(messageServeur(e))]; if (/déjà signalé/.test(String(e && e.message))) etat.form = null; })
      .then(function () { return fini(hote); });
  }
  if (a === 'repondre') {
    var t = texte('sgRep_' + cle);
    if (t.length < MIN) return erreurLocale(b, 'Votre réponse doit compter au moins ' + MIN + ' caractères.');
    etat.enCours = true; b.disabled = true; b.textContent = 'Envoi…';
    var k = (b.closest('[data-sg-cible]') || {}).getAttribute ? b.closest('[data-sg-cible]').getAttribute('data-sg-cible') : null;
    return appeler(hote, 'geo_signalement_repondre', { p_signalement: cle, p_texte: t }).then(function () {
      if (k) etat.messages[k] = ['succes', 'Réponse enregistrée. Le signalement reste ouvert jusqu\'à la décision de la supervision.'];
    }, function (e) { if (k) etat.messages[k] = ['erreur', '<b>Réponse non enregistrée.</b> ' + esc(messageServeur(e))]; else global.alert(messageServeur(e)); })
      .then(function () { return fini(hote); });
  }
  if (a === 'resoudre') {
    var res = valeurRadio('sgRes_' + cle), m = texte('sgResM_' + cle);
    if (!res) return erreurLocale(b, 'Choisissez la résolution.');
    if (m.length < MIN) return erreurLocale(b, 'Motivez la résolution (' + MIN + ' caractères au moins).');
    etat.enCours = true; b.disabled = true; b.textContent = 'Envoi…';
    var k2 = b.closest('[data-sg-cible]') ? b.closest('[data-sg-cible]').getAttribute('data-sg-cible') : null;
    return appeler(hote, 'geo_signalement_resoudre', { p_signalement: cle, p_resolution: res, p_motif: m }).then(function (r) {
      if (k2) etat.messages[k2] = ['succes', 'Signalement ' + (r && r.statut === 'RESOLU' ? 'résolu' : 'classé') + ' : ' + esc(RESOLUTIONS[res]) + '.'];
    }, function (e) { if (k2) etat.messages[k2] = ['erreur', '<b>Résolution non enregistrée.</b> ' + esc(messageServeur(e))]; })
      .then(function () { return fini(hote); });
  }
}

document.addEventListener('click', surClic);

global.ANAGROCI_SIGNALEMENTS_GPS = {
  MOTIFS: MOTIFS, RESOLUTIONS: RESOLUTIONS,
  brancher: function (hote, h) { hotes[hote] = h; },
  charger: charger, ouverts: ouverts, repereServeur: repereServeur,
  section: section, listeOuverts: listeOuverts, distance: distance,
  peutSignaler: peutSignaler, peutRepondre: peutRepondre, peutResoudre: peutResoudre,
  _etat: etat
};
})(typeof window !== 'undefined' ? window : globalThis);

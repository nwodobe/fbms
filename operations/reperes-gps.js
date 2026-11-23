/* REPÈRES GPS AFLP · écran (rubrique #reperes de FIELD BUYING)
   --------------------------------------------------------------------------------
   Capturer OU saisir à la main les coordonnées d'une parcelle, d'un bloc ou d'un
   arbre suivi, les garder sur le téléphone hors réseau, les transmettre ensuite, puis
   les retrouver sur la carte avec leurs identifiants.
   · La fiche et la liste fonctionnent SANS carte, SANS tuile et SANS réponse du serveur :
     elles lisent seulement ce qui a été préparé sur le téléphone.
   · Trois états distincts, jamais confondus : transmission (en attente / transmis),
     validation métier (non vérifié / vérifié), disponibilité de la carte.
   · Une saisie manuelle n'est jamais présentée comme une capture, ni comme une preuve
     de présence sur le champ. Elle ne modifie pas le « point GPS de référence » de la
     parcelle ni le marquage d'un arbre fait par l'Observatoire.
   · Un repère est un point : aucun contour, aucune superficie n'en est déduit.
   Dépend de ANAGROCI_REPERES_COEUR et ANAGROCI_REPERES_LOCAL. Lit (sans les modifier) les
   références préparées par Parcelles (ANAGROCI_PARCELLES_LOCAL) et l'Observatoire
   (ANAGROCI_OBS_LOCAL). Expose ANAGROCI_REPERES. */
(function (global) {
'use strict';
var C = global.ANAGROCI_REPERES_COEUR, L = global.ANAGROCI_REPERES_LOCAL;
var sb = null, clientPromise = null, carte = null, minuterieBrouillon = null;
var etat = { recherche: '', message: null, capture: null, mode: null, confirmerHorsZone: false, alertes: null, erreurs: null, dernierPlot: null };

/* ------------------------------------------------------------------ utilitaires */
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function root() { return document.getElementById('opsRouteView'); }
function parts() { return (location.hash || '#reperes').slice(1).split('/').map(decodeURIComponent); }
function surRubrique() { return /^#reperes(\/|$)/.test(location.hash || ''); }
function aller(h) { if (location.hash === '#' + h) rendre(); else location.hash = h; }
function enLigne() { return navigator.onLine !== false; }
function peindre(h) { var r = root(); if (r) r.innerHTML = h; }
function nb2(n) { return ('0' + n).slice(-2); }
function heureFr(d) { if (!d) return '—'; try { var t = new Date(d); if (isNaN(t)) return String(d); return nb2(t.getDate()) + '/' + nb2(t.getMonth() + 1) + '/' + t.getFullYear() + ' ' + nb2(t.getHours()) + ':' + nb2(t.getMinutes()); } catch (e) { return String(d); } }
function tete(titre, sous, actions) { return '<div class="ops-route-head"><div><h1>' + esc(titre) + '</h1><p>' + esc(sous || '') + '</p></div><div class="ops-route-actions">' + (actions || '') + '</div></div>'; }
function avis(type, html) { return '<div class="rg-avis rg-avis-' + type + '" role="' + (type === 'erreur' ? 'alert' : 'status') + '">' + html + '</div>'; }
function bouton(libelle, action, cls, attrs) { return '<button type="button" class="btn rg-btn ' + (cls || 'secondary') + '" data-rg="' + esc(action) + '"' + (attrs || '') + '>' + esc(libelle) + '</button>'; }
function lien(libelle, h, cls) { return '<a class="btn rg-btn ' + (cls || 'secondary') + '" href="#' + esc(h) + '">' + esc(libelle) + '</a>'; }
function pastille(texte, cls) { return '<span class="rg-pastille rg-p-' + esc(cls || 'neutre') + '">' + esc(texte) + '</span>'; }
function profil() { return (global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile) || {}; }
function classe() { return { 'Branch Manager': 'BM', 'Branch Manager / Head of Programme': 'BM', 'Assistant Branch Manager': 'ABM', 'Zonal Head': 'ZH', 'Unit Head': 'UH', 'Assistant Unit Head': 'AUH' }[profil().role] || null; }
/* Autorisation LOCALE de préparer une saisie. Le serveur revérifie périmètre et consentement. */
function peutSaisir() { return !!L.compte() && ['BM', 'UH', 'AUH'].indexOf(classe()) >= 0; }

function fetchBorne(url, opts) {
  opts = opts || {}; if (typeof AbortController === 'undefined') return fetch(url, opts);
  var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 25000), o = {};
  for (var k in opts) o[k] = opts[k]; o.signal = ac.signal;
  return fetch(url, o).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw new Error('Pas de réponse du serveur (' + (e && e.message || 'réseau') + ').'); });
}
function client() {
  if (sb) return Promise.resolve(sb);
  if (clientPromise) return clientPromise;
  clientPromise = new Promise(function (ok) {
    var k = 0, t = setInterval(function () {
      k++;
      if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) { clearInterval(t); sb = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON, { global: { fetch: fetchBorne } }); ok(sb); }
      else if (k > 40) { clearInterval(t); clientPromise = null; ok(null); }
    }, 80);
  });
  return clientPromise;
}
function rpcBrut(nom, args) {
  return client().then(function (c) { if (!c) return { data: null, error: { message: 'Connexion aux données indisponible.' } }; return c.rpc(nom, args || {}); })
    .then(function (x) { return x; }, function (e) { return { data: null, error: { message: e && e.message || 'Pas de réponse du serveur.' } }; });
}
function lireServeur(table, cols, mod) {
  return client().then(function (c) { if (!c) throw new Error('Connexion aux données indisponible.'); var r = c.from(table).select(cols || '*'); if (mod) r = mod(r); return r; })
    .then(function (x) { if (x.error) throw new Error(x.error.message); return x.data || []; });
}

/* ------------------------------------------------------------------ références préparées */
/* Signalements GPS (module partagé, facultatif : son absence n'empêche rien). */
function SG() { return global.ANAGROCI_SIGNALEMENTS_GPS || null; }
var COLS_PARCELLES = 'plot_id,plot_code,producteur_id,producteur_code,producteur_nom,producteur_prenoms,village_id,village_nom,village_latitude,village_longitude,cluster_code,zone_code,local_name,tree_count,latitude,longitude,gps_accuracy_m,gps_captured_at,gps_status,current_geometry_id,consentement_gps';
function parcellesPreparees() {
  var P = global.ANAGROCI_PARCELLES_LOCAL;
  return L.cache.lire('parcelles').then(function (x) {
    if (x && x.valeur && x.valeur.length) return { liste: x.valeur, le: x.le };
    if (!P || !P.cache) return { liste: [], le: null };
    return P.cache.lire('parcelles').then(function (l) { return { liste: l || [], le: null }; }).catch(function () { return { liste: [], le: null }; });
  }).catch(function () { return { liste: [], le: null }; });
}
function panelsPrepares() {
  var O = global.ANAGROCI_OBS_LOCAL;
  if (!O || !O.panels) return Promise.resolve({ panels: [], ref: null });
  return Promise.all([O.panels(), O.referentiel ? O.referentiel() : null]).then(function (r) { return { panels: r[0] || [], ref: r[1] }; })
    .catch(function () { return { panels: [], ref: null }; });
}
/* Rassemble, par champ, la parcelle et ses panels. Lecture seule de l'appareil. */
function champs() {
  return Promise.all([parcellesPreparees(), panelsPrepares()]).then(function (r) {
    var par = {}, ordre = [];
    r[0].liste.forEach(function (x) { par[x.plot_id] = { plot_id: x.plot_id, parcelle: x, panels: [] }; ordre.push(x.plot_id); });
    var ref = r[1].ref || {}, plots = {}, pros = {}, vils = {};
    (ref.plots || []).forEach(function (p) { plots[p.id] = p; }); (ref.producteurs || []).forEach(function (p) { pros[p.id] = p; }); (ref.villages || []).forEach(function (v) { vils[v.id] = v; });
    r[1].panels.forEach(function (p) {
      if (!p.plot_id) return;
      if (!par[p.plot_id]) {
        var rp = plots[p.plot_id] || {}, pr = pros[rp.producteur_id] || {}, vi = vils[rp.village_id] || {};
        par[p.plot_id] = { plot_id: p.plot_id, panels: [], parcelle: { plot_id: p.plot_id, plot_code: null, producteur_id: rp.producteur_id || null, producteur_nom: pr.nom_famille || pr.nom || null, producteur_prenoms: pr.prenoms || null,
          producteur_code: pr.code || null, village_nom: vi.village || null, cluster_code: p.cluster_code || vi.cluster_code || null, local_name: rp.local_name || null, consentement_gps: null, _observatoireSeul: true } };
        ordre.push(p.plot_id);
      }
      par[p.plot_id].panels.push(p);
    });
    return { liste: ordre.map(function (id) { return par[id]; }), par: par, preparationLe: r[0].le, nbParcelles: r[0].liste.length, nbPanels: r[1].panels.length };
  });
}
function nomChamp(ch) {
  var x = ch.parcelle || {};
  return { producteur: [x.producteur_nom, x.producteur_prenoms].filter(Boolean).join(' ') || 'Producteur non précisé',
    champ: (x.local_name || 'Champ') + (x.plot_code ? ' · ' + x.plot_code : ''), village: x.village_nom || '—', cluster: x.cluster_code || '—' };
}
/* Objets repérables d'un champ : la parcelle, ses blocs, ses arbres. Identité et
   rattachements viennent des références existantes : rien n'est créé ni renuméroté. */
function objetsDuChamp(ch) {
  var n = nomChamp(ch), out = [];
  out.push({ type: 'PARCELLE', id: ch.plot_id, plot_id: ch.plot_id, panel_id: null, bloc_id: null, titre: 'Parcelle', identifiant: (ch.parcelle.plot_code || ch.parcelle.local_name || 'Champ'),
    libelle: 'Parcelle ' + n.champ + ' · ' + n.producteur, rattachement: 'Producteur ' + n.producteur,
    existant: ch.parcelle.latitude != null ? { latitude: Number(ch.parcelle.latitude), longitude: Number(ch.parcelle.longitude), precision_m: ch.parcelle.gps_accuracy_m, le: ch.parcelle.gps_captured_at, nom: 'Point GPS de référence (capturé sur le champ)' } : null });
  ch.panels.forEach(function (p) {
    var num = {};
    (p.blocs || []).slice().sort(function (a, b) { return a.numero - b.numero; }).forEach(function (b) {
      num[b.id] = b.numero;
      out.push({ type: 'BLOC', id: b.id, plot_id: ch.plot_id, panel_id: p.id, bloc_id: b.id, titre: 'Bloc', identifiant: 'B' + nb2(b.numero),
        libelle: 'Bloc B' + nb2(b.numero) + ' · ' + n.champ, rattachement: 'Parcelle ' + n.champ + (b.repere ? ' · repère : ' + b.repere : ''), panelLocal: !!p.local, existant: null });
    });
    (p.arbres || []).slice().sort(function (a, b) { return String(a.code_suivi || a.code) < String(b.code_suivi || b.code) ? -1 : 1; }).forEach(function (a) {
      var bn = a.bloc_numero != null ? a.bloc_numero : num[a.bloc_id];
      out.push({ type: 'ARBRE', id: a.id, plot_id: ch.plot_id, panel_id: p.id, bloc_id: a.bloc_id || null, titre: 'Arbre suivi', identifiant: a.code_suivi || a.code,
        libelle: 'Arbre ' + (a.code_suivi ? a.code_suivi + ' (' + a.code + ')' : a.code) + ' · ' + n.champ,
        rattachement: (bn != null ? 'Bloc B' + nb2(bn) + ' · ' : '') + 'arbre physique ' + a.code + (a.role === 'RESERVE' ? ' · réserve' : ''),
        remplace: a.statut === 'REMPLACE', panelLocal: !!p.local,
        existant: a.latitude != null ? { latitude: Number(a.latitude), longitude: Number(a.longitude), precision_m: a.gps_precision_m, le: a.marque_le, nom: 'Position marquée près de l\'arbre (Observatoire)' } : null });
    });
  });
  return out;
}
function indexReperes() { return L.reperes().then(function (l) { var m = {}; l.forEach(function (r) { m[r.objet_type + ':' + r.objet_id] = r; }); return m; }).catch(function () { return {}; }); }

/* Préparation en ligne : la liste des parcelles du périmètre de l'agent (filtrée par le
   serveur) et les repères déjà transmis. Rien hors périmètre n'est téléchargé. */
function preparer() {
  if (!enLigne()) return Promise.reject(new Error('Pas de réseau : la préparation se fait avec une connexion.'));
  var tout = [], pas = 1000;
  function page(i) {
    return lireServeur('plot_map_parcelles_v', COLS_PARCELLES, function (r) { return r.order('village_nom').order('producteur_nom').range(i, i + pas - 1); }).then(function (l) { tout = tout.concat(l); return l.length === pas && i < 20000 ? page(i + pas) : tout; });
  }
  return page(0).then(function (l) { return L.cache.ecrire('parcelles', l).then(function () { return rafraichirReperes(null).then(function (n) { return { parcelles: l.length, reperes: n }; }); }); });
}
/* Lit les repères actifs du serveur (tous, ou ceux d'un champ) et les fusionne sans
   jamais écraser une saisie locale non confirmée. Serveur pas encore prêt : silencieux. */
function rafraichirReperes(plotId) {
  if (!enLigne()) return Promise.resolve(0);
  var out = [], pas = 1000;
  function page(i) {
    return lireServeur('geo_reperes', 'objet_type,objet_id,plot_id,panel_id,bloc_id,latitude,longitude,origine,source_externe,releve_le,precision_m,hors_zone_attendue,version_no,statut,motif,saisi_le_client,created_at',
      function (r) { r = r.eq('actif', true); if (plotId) r = r.eq('plot_id', plotId); return r.order('created_at').range(i, i + pas - 1); })
      .then(function (l) { out = out.concat(l); return l.length === pas && i < 20000 ? page(i + pas) : out; });
  }
  return page(0).then(function (l) { return L.integrerServeur(l); }).catch(function () { return 0; });
}
function contour(ch) {
  var id = ch.parcelle && ch.parcelle.current_geometry_id, cle = 'contour:' + ch.plot_id;
  if (!id || !enLigne()) return L.cache.lire(cle).then(function (x) { return x ? x.valeur : null; }).catch(function () { return null; });
  return lireServeur('plot_map_geometries_v', 'id,geojson,status,version_no', function (r) { return r.eq('id', id).limit(1); }).then(function (l) {
    var g = l[0] ? { geojson: l[0].geojson, status: l[0].status, version_no: l[0].version_no } : null;
    if (g) L.cache.ecrire(cle, g).catch(function () {}); return g;
  }).catch(function () { return L.cache.lire(cle).then(function (x) { return x ? x.valeur : null; }).catch(function () { return null; }); });
}

/* ------------------------------------------------------------------ synchronisation */
function synchroniser(silencieux) {
  return L.synchroniser(rpcBrut).then(function (b) {
    if (!silencieux) {
      etat.message = b.sansCompte ? ['alerte', 'Aucun compte connecté : rien n\'a été envoyé.']
        : b.horsLigne ? ['info', 'Pas de réseau : les repères restent sur ce téléphone et partiront au retour du réseau.']
        : b.erreurReseau ? ['alerte', 'Le serveur n\'a pas répondu : ' + esc(b.erreurReseau) + ' Rien n\'est perdu, les repères restent en attente.']
        : b.envoyees ? [b.refusees || b.conflits ? 'alerte' : 'succes', b.recues + ' repère(s) transmis au serveur' + (b.conflits ? ', ' + b.conflits + ' conflit(s) à résoudre' : '') + (b.refusees ? ', ' + b.refusees + ' refusé(s) : voir le journal' : '') + '.']
        : b.retenues ? ['info', b.retenues + ' repère(s) attendent que le champ de l\'Observatoire soit lui-même reçu par le serveur.']
        : ['info', 'Aucun repère en attente.'];
    }
    return b;
  }).catch(function (e) { if (!silencieux) etat.message = ['erreur', esc(e.message)]; return null; });
}
function barreSync() {
  return L.compter().then(function (n) {
    return '<div class="rg-sync' + (n.aTraiter ? ' rg-sync-alerte' : n.enAttente ? ' rg-sync-attente' : '') + '" aria-live="polite">' +
      '<span><b>' + (n.enAttente ? n.enAttente + ' repère' + (n.enAttente > 1 ? 's' : '') + ' en attente de synchronisation' : 'Aucun repère en attente') + '</b>' +
      (n.aTraiter ? ' · ' + n.aTraiter + ' à traiter (refus ou conflit)' : '') + (enLigne() ? '' : ' · hors ligne') + '</span>' +
      '<span class="rg-sync-act">' + bouton('Synchroniser', 'sync') + lien('Journal', 'reperes/journal') + '</span></div>';
  }).catch(function (e) { return avis('erreur', esc(e.message)); });
}
function messageEtat() { var m = etat.message; etat.message = null; return m ? avis(m[0], m[1]) : ''; }

/* ------------------------------------------------------------------ rendu d'un repère */
function ligneRepere(r) {
  if (!r) return '<span class="rg-vide">Position non renseignée</span>';
  var transmission = r.etat === 'RECU' ? pastille('Transmis au serveur', 'ok') : r.etat === 'CONFLIT' ? pastille('Conflit à résoudre', 'alerte') : r.etat === 'REJETE' ? pastille('Refusé par le serveur', 'alerte') : pastille('Sur ce téléphone · en attente', 'attente');
  var validation = r.statut === 'VERIFIE' ? pastille('Vérifié', 'ok') : r.statut === 'REJETE' ? pastille('Écarté par la supervision', 'alerte') : pastille('Non vérifié', 'neutre');
  return '<span class="rg-coord mono">' + esc(C.fmt(r.latitude)) + ' ; ' + esc(C.fmt(r.longitude)) + '</span> ' +
    pastille(r.origine === 'GPS_APPAREIL' ? 'Capturé par téléphone' : 'Saisi à la main', r.origine === 'GPS_APPAREIL' ? 'gps' : 'manuel') + ' ' + transmission + ' ' + validation +
    '<small>Précision ' + (r.precision_m != null ? Math.round(r.precision_m) + ' m' : 'inconnue') + ' · relevé le ' + (r.releve_le ? esc(heureFr(r.releve_le)) : 'date inconnue') +
    (r.source_externe ? ' · source : ' + esc(r.source_externe) : '') + (r.hors_zone ? ' · hors Côte d\'Ivoire (confirmé par l\'agent)' : '') + '</small>';
}

/* ------------------------------------------------------------------ 1. accueil */
function vueAccueil() {
  var S = SG();
  return Promise.all([champs(), indexReperes(), barreSync(), S && enLigne() ? S.ouverts(lireServeur) : Promise.resolve(null)]).then(function (r) {
    var cs = r[0], idx = r[1], q = etat.recherche.trim().toLowerCase();
    var signales = S && r[3] ? S.listeOuverts({ hote: 'rg', classe: classe(), donnees: r[3], lien: function (s) {
      return s.cible_type === 'REPERE' ? 'reperes/objet/' + s.repere_objet_type + '/' + s.repere_objet_id : 'reperes/objet/PARCELLE/' + s.plot_id; } }) : '';
    var filtres = cs.liste.filter(function (ch) {
      if (!q) return true; var n = nomChamp(ch), x = ch.parcelle || {};
      return [n.producteur, n.champ, n.village, n.cluster, x.producteur_code].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var lignes = filtres.slice(0, 60).map(function (ch) {
      var n = nomChamp(ch), objs = objetsDuChamp(ch), avec = objs.filter(function (o) { return idx[o.type + ':' + o.id]; }).length;
      var att = objs.filter(function (o) { var z = idx[o.type + ':' + o.id]; return z && z.etat !== 'RECU'; }).length;
      return '<a class="rg-champ" href="#reperes/champ/' + esc(ch.plot_id) + '"><span class="rg-champ-nom"><b>' + esc(n.producteur) + '</b><small>' + esc(n.champ) + ' · ' + esc(n.village) + ' · ' + esc(n.cluster) + '</small></span>' +
        '<span class="rg-champ-etat">' + (ch.panels.length ? pastille('Observatoire', 'gps') : '') + pastille(avec + ' repère' + (avec > 1 ? 's' : ''), avec ? 'ok' : 'neutre') + (att ? pastille(att + ' en attente', 'attente') : '') + '</span></a>';
    }).join('');
    var vide = !cs.liste.length;
    var preparation = '<section class="card rg-prep"><div class="card-head"><div><h2>Travailler hors réseau</h2></div></div>' +
      '<p class="rg-note">' + (vide ? '<b>Aucun champ n\'est préparé sur ce téléphone.</b> ' : '<b>' + cs.nbParcelles + ' parcelle(s)</b> et <b>' + cs.nbPanels + ' champ(s) de l\'Observatoire</b> sont disponibles sur ce téléphone' + (cs.preparationLe ? ' (parcelles préparées le ' + esc(heureFr(cs.preparationLe)) + ')' : '') + '. ') +
      'Avec une connexion, touchez « Préparer mes champs » : la liste de vos parcelles est copiée sur le téléphone. Pour les blocs et les arbres, ouvrez l\'Observatoire et touchez « Préparer le hors-ligne ». Ensuite, la saisie fonctionne sans réseau et sans carte.</p>' +
      '<div class="rg-actions">' + bouton('Préparer mes champs', 'preparer', enLigne() ? 'primary' : 'secondary', enLigne() ? '' : ' disabled') + lien('Ouvrir l\'Observatoire', 'observatoire') + '</div>' +
      (enLigne() ? '' : '<p class="rg-note">Hors ligne : la préparation attend le retour du réseau. Les champs déjà préparés restent utilisables.</p>') + '</section>';
    peindre(tete('Repères GPS', 'Capturer ou saisir les coordonnées d\'une parcelle, d\'un bloc ou d\'un arbre suivi') + messageEtat() + r[2] + signales +
      (enLigne() ? '' : avis('info', 'Carte indisponible. Vous pouvez enregistrer les coordonnées sur ce téléphone.')) +
      (peutSaisir() ? '' : avis('info', 'Votre profil consulte les repères. La saisie est réservée au Chef d\'Unité, à son assistant et au Branch Manager.')) +
      (vide ? '' : '<section class="card"><div class="card-head"><div><h2>1. Choisir le champ</h2></div></div>' +
        '<label class="rg-recherche"><span>Rechercher un producteur, un champ, un village</span><input type="search" id="rgRecherche" value="' + esc(etat.recherche) + '" autocomplete="off"></label>' +
        '<div class="rg-liste">' + (lignes || '<div class="ops-empty">Aucun champ ne correspond à cette recherche.</div>') + '</div>' +
        (filtres.length > 60 ? '<p class="rg-note">' + filtres.length + ' champs correspondent : affinez la recherche pour voir les suivants.</p>' : '') + '</section>') +
      preparation);
    var champ = document.getElementById('rgRecherche');
    if (champ && q) { champ.focus(); try { champ.setSelectionRange(champ.value.length, champ.value.length); } catch (e) {} }
  });
}

/* ------------------------------------------------------------------ 2. fiche du champ : liste + carte */
function vueChamp(plotId, ouvrirCarte) {
  etat.dernierPlot = plotId;
  return champs().then(function (cs) {
    var ch = cs.par[plotId];
    if (!ch) { peindre(tete('Champ introuvable sur ce téléphone', '', lien('← Repères GPS', 'reperes')) + avis('alerte', 'Ce champ n\'a pas été préparé sur ce téléphone. Avec une connexion, revenez à « Repères GPS » et touchez « Préparer mes champs ».')); return; }
    var apresServeur = enLigne() ? rafraichirReperes(plotId) : Promise.resolve(0);
    return apresServeur.then(function () { return Promise.all([indexReperes(), barreSync(), contour(ch)]); }).then(function (r) {
      var idx = r[0], geo = r[2], n = nomChamp(ch), objs = objetsDuChamp(ch);
      var aPosition = objs.some(function (o) { return idx[o.type + ':' + o.id] || o.existant; });
      var consent = ch.parcelle.consentement_gps;
      var groupe = function (type, titre, aide) {
        var l = objs.filter(function (o) { return o.type === type; });
        if (!l.length) return type === 'PARCELLE' ? '' : '<h3 class="rg-titre-groupe">' + titre + '</h3><p class="rg-note">' + aide + '</p>';
        return '<h3 class="rg-titre-groupe">' + titre + '</h3>' + l.map(function (o) {
          var rp = idx[o.type + ':' + o.id], ctl = '';
          if (o.type !== 'PARCELLE' && geo && geo.geojson) {
            var pos = rp || o.existant;
            if (pos) { var k = C.positionDansContour(pos.latitude, pos.longitude, geo.geojson, pos.precision_m); if (k.connu && k.signale) ctl = '<small class="rg-alerte-ligne">Semble hors du contour de la parcelle (' + k.distance_m + ' m, tolérance ' + Math.round(k.tolerance_m) + ' m). La position n\'a pas été modifiée : vérifiez sur place.</small>'; }
          }
          return '<div class="rg-objet rg-objet-' + o.type.toLowerCase() + (o.remplace ? ' rg-objet-inactif' : '') + '"><div class="rg-objet-id"><span class="rg-symbole rg-sym-' + o.type.toLowerCase() + '" aria-hidden="true"></span><b>' + esc(o.identifiant) + '</b><small>' + esc(o.rattachement) + (o.remplace ? ' · arbre remplacé' : '') + '</small></div>' +
            '<div class="rg-objet-pos">' + ligneRepere(rp) + (o.existant ? '<small class="rg-existant">' + esc(o.existant.nom) + ' : <span class="mono">' + esc(C.fmt(o.existant.latitude)) + ' ; ' + esc(C.fmt(o.existant.longitude)) + '</span></small>' : '') + ctl + '</div>' +
            '<div class="rg-objet-act">' + lien(rp ? 'Ouvrir' : (peutSaisir() && !o.remplace ? 'Renseigner' : 'Ouvrir'), 'reperes/objet/' + o.type + '/' + o.id, rp ? 'secondary' : 'primary') + '</div></div>';
        }).join('');
      };
      var blocCarte = '<section class="card" id="rgCarteSection"><div class="card-head"><div><h2>Carte du champ</h2></div></div>' +
        (aPosition ? '<div class="rg-actions">' + bouton('Voir sur la carte', 'carte', 'primary', ' data-v="' + esc(plotId) + '"') + '</div>' : '<p class="rg-note">Aucune position enregistrée pour ce champ : la carte s\'ouvrira dès qu\'un repère existera.</p>') +
        '<div id="rgCarteMessage" aria-live="polite"></div><div id="rgCarte" class="rg-carte" hidden></div>' +
        '<div class="rg-legende"><span><i class="rg-symbole rg-sym-parcelle"></i> Parcelle</span><span><i class="rg-symbole rg-sym-bloc"></i> Bloc</span><span><i class="rg-symbole rg-sym-arbre"></i> Arbre suivi</span><span><i class="rg-symbole rg-sym-existant"></i> Point déjà capturé (Parcelles / Observatoire)</span></div>' +
        '<p class="rg-note">Un repère est un point. Il ne remplace pas le contour de la parcelle et ne permet pas de calculer une superficie.</p></section>';
      peindre(tete(n.producteur, n.champ + ' · ' + n.village + ' · ' + n.cluster, lien('← Repères GPS', 'reperes')) + messageEtat() + r[1] +
        (consent === false ? avis('alerte', '<b>Accord GPS non enregistré pour ce producteur.</b> Aucune coordonnée ne peut être enregistrée tant qu\'il n\'a pas donné son accord. ' + lien('Recueillir l\'accord', 'parcelles/parcours/' + plotId, 'secondary rg-mini')) : '') +
        (consent == null ? avis('info', 'L\'accord GPS du producteur n\'est pas connu sur ce téléphone. Vous pouvez préparer la saisie : le serveur vérifiera l\'accord à la synchronisation et refusera le repère s\'il manque.') : '') +
        (enLigne() ? '' : avis('info', 'Carte indisponible. Vous pouvez enregistrer les coordonnées sur ce téléphone.')) +
        '<section class="card"><div class="card-head"><div><h2>Positions de ce champ</h2></div></div>' +
        groupe('PARCELLE', 'Parcelle', '') +
        groupe('BLOC', 'Blocs', 'Aucun bloc préparé sur ce téléphone pour ce champ. Si le champ est suivi par l\'Observatoire, ouvrez l\'Observatoire avec une connexion et touchez « Préparer le hors-ligne ».') +
        groupe('ARBRE', 'Arbres suivis', 'Aucun arbre suivi préparé sur ce téléphone pour ce champ.') + '</section>' + blocCarte);
      if (ouvrirCarte && aPosition) afficherCarte(ch, objs, idx, geo);
      etat._carte = { ch: ch, objs: objs, idx: idx, geo: geo };
    });
  });
}

/* Fond de carte : même paramétrage que Parcelles (lu, jamais modifié). Aucune tuile n'est
   conservée hors ligne : sans réseau, les points sont affichés sur FOND NEUTRE, annoncé comme tel. */
function fondCarte(map) {
  var P = global.ANAGROCI_PARCELLES_LOCAL;
  var lecture = P && P.cache ? P.cache.lire('parametres').catch(function () { return null; }) : Promise.resolve(null);
  return lecture.then(function (params) {
    if (!enLigne()) return { satellite: false, message: 'Hors ligne : fond de carte indisponible. Les points sont affichés sur un fond neutre, sans image satellite.' };
    var im = (params || {}).imagerie || {}, couche = null, sat = false;
    if (im.fournisseur === 'esri' && im.licence_confirmee && im.cle) {
      couche = global.L.tileLayer('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + encodeURIComponent(im.cle),
        { maxNativeZoom: 18, maxZoom: 21, attribution: 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Esri, Vantor, Earthstar Geographics, and the GIS User Community' }); sat = true;
    } else if (im.fournisseur === 'tms' && im.licence_confirmee && im.url) {
      couche = global.L.tileLayer(im.url, { maxNativeZoom: Number(im.zoom_max) || 20, maxZoom: 22, attribution: esc(im.attribution || '') }); sat = true;
    } else if (im.fournisseur === 'osm') {
      couche = global.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 21, attribution: '© contributeurs OpenStreetMap' });
    }
    if (!couche) return { satellite: false, message: 'Aucun fond de carte activé sur ce téléphone : les points sont affichés sur un fond neutre.' };
    var ok = 0, ko = 0, zone = document.getElementById('rgCarteMessage');
    couche.on('tileload', function () { ok++; });
    couche.on('tileerror', function () { ko++; if (ko >= 3 && ko > ok && zone && !zone.getAttribute('data-ko')) { zone.setAttribute('data-ko', '1'); zone.insertAdjacentHTML('beforeend', avis('alerte', 'L\'image de fond ne se charge pas (réseau faible ?). Les points restent exacts sur le fond neutre.')); } });
    couche.addTo(map);
    return { satellite: sat, message: sat ? 'Fond : image satellite.' : 'Fond : plan (pas une image satellite).' };
  });
}
function icone(type, texte) {
  return global.L.divIcon({ className: 'rg-marqueur rg-marqueur-' + type, html: '<i class="rg-symbole rg-sym-' + type + '"></i><span>' + esc(texte) + '</span>', iconSize: [14, 14], iconAnchor: [7, 7] });
}
function afficherCarte(ch, objs, idx, geo) {
  var el = document.getElementById('rgCarte'), zone = document.getElementById('rgCarteMessage');
  if (!el) return;
  if (!global.L) { if (zone) zone.innerHTML = avis('info', 'Carte indisponible. Vous pouvez enregistrer les coordonnées sur ce téléphone. La liste ci-dessus reste complète.'); return; }
  if (carte) { try { carte.remove(); } catch (e) {} carte = null; }
  el.hidden = false; el.innerHTML = '';
  var points = [];
  objs.forEach(function (o) {
    var rp = idx[o.type + ':' + o.id];
    if (rp) points.push({ lat: rp.latitude, lng: rp.longitude, type: o.type.toLowerCase(), texte: o.identifiant, info: o.titre + ' ' + o.identifiant + ' · ' + (rp.origine === 'GPS_APPAREIL' ? 'capturé par téléphone' : 'saisi à la main') + ' · ' + (rp.etat === 'RECU' ? 'transmis' : 'en attente sur ce téléphone') + ' · ' + (rp.statut === 'VERIFIE' ? 'vérifié' : 'non vérifié') });
    if (o.existant) points.push({ lat: o.existant.latitude, lng: o.existant.longitude, type: 'existant', texte: o.identifiant, info: o.existant.nom + ' · ' + o.titre + ' ' + o.identifiant });
  });
  var map = global.L.map(el, { zoomControl: true, attributionControl: true });
  carte = map;
  var bornes = null;
  var couche = geo && geo.geojson ? global.L.geoJSON(geo.geojson, { style: { color: '#053B23', weight: 2, fillColor: '#8DC556', fillOpacity: 0.18 } }) : null;
  if (couche) { try { bornes = couche.getBounds(); } catch (e) { bornes = null; } }
  points.forEach(function (p) { var ll = [p.lat, p.lng]; if (bornes && bornes.isValid && bornes.isValid()) bornes.extend(ll); else bornes = global.L.latLngBounds([ll, ll]); });
  /* La vue est fixée avant d'ajouter le contour (Leaflet ne dessine pas un polygone sans centre). */
  if (bornes && bornes.isValid()) map.fitBounds(bornes.pad(0.35), { maxZoom: 18 }); else map.setView([7.69, -5.03], 12);
  if (couche) couche.addTo(map);
  points.forEach(function (p) { global.L.marker([p.lat, p.lng], { icon: icone(p.type, p.texte), keyboard: false }).addTo(map).bindPopup(esc(p.info) + '<br><span class="mono">' + esc(C.fmt(p.lat)) + ' ; ' + esc(C.fmt(p.lng)) + '</span>'); });
  setTimeout(function () { try { map.invalidateSize(); if (bornes && bornes.isValid()) map.fitBounds(bornes.pad(0.35), { maxZoom: 18 }); } catch (e) {} }, 180);
  fondCarte(map).then(function (f) {
    if (zone) zone.insertAdjacentHTML('afterbegin', '<p class="rg-note" id="rgFond">' + esc(f.message) + ' ' + points.length + ' point(s) affiché(s)' + (couche ? ', avec le contour ' + (geo.status === 'VALIDE' ? 'validé' : 'en cours') + ' de la parcelle.' : '. Aucun contour enregistré pour cette parcelle.') + '</p>');
  });
  try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
}

/* ------------------------------------------------------------------ 3. fiche d'un objet */
function trouverObjet(type, id) {
  return champs().then(function (cs) {
    for (var i = 0; i < cs.liste.length; i++) {
      var o = objetsDuChamp(cs.liste[i]).filter(function (x) { return x.type === type && x.id === id; })[0];
      if (o) return { ch: cs.liste[i], objet: o };
    }
    return null;
  });
}
function champSaisie(id, libelle, valeur, aide, attrs) {
  return '<label class="rg-champ-saisie" for="' + id + '"><span>' + libelle + '</span><input id="' + id + '" value="' + esc(valeur || '') + '" autocomplete="off" ' + (attrs || '') + '>' + (aide ? '<small>' + aide + '</small>' : '') + '<small class="rg-erreur" id="' + id + 'Err" aria-live="polite"></small></label>';
}
function vueObjet(type, id) {
  if (!C.TYPES[type]) { peindre(tete('Repère introuvable', '', lien('← Repères GPS', 'reperes'))); return Promise.resolve(); }
  var S = SG();
  return Promise.all([trouverObjet(type, id), L.repere(type, id), L.brouillon(type, id), barreSync(), L.file(),
    S && enLigne() ? trouverObjet(type, id).then(function (x) { return x ? S.charger(lireServeur, x.ch.plot_id) : null; }) : Promise.resolve(null),
    S && enLigne() ? S.repereServeur(lireServeur, type, id) : Promise.resolve(null)]).then(function (r) {
    var t = r[0];
    if (!t) { peindre(tete('Objet introuvable sur ce téléphone', '', lien('← Repères GPS', 'reperes')) + avis('alerte', 'Cet objet n\'est pas préparé sur ce téléphone. Avec une connexion, revenez à « Repères GPS » et préparez vos champs.')); return; }
    var o = t.objet, ch = t.ch, rp = r[1], br = (r[2] && r[2].champs) || {}, n = nomChamp(ch), consent = ch.parcelle.consentement_gps;
    etat.dernierPlot = ch.plot_id;
    var op = rp && rp.op_cle ? r[4].filter(function (x) { return x.idempotency_key === rp.op_cle; })[0] : null;
    var saisieOuverte = peutSaisir() && !o.remplace && consent !== false;
    var correction = !!(rp && (rp.version_no > 0 || rp.etat === 'RECU'));
    var mode = etat.mode || (br.lat || br.lng ? 'manuel' : null);
    etat.mode = mode;   // un brouillon rouvert est une saisie manuelle : « Enregistrer » doit le traiter comme telle
    var bandeau = '';
    if (rp && rp.etat === 'CONFLIT') {
      var s = rp.serveur || (op && op.serveur);
      bandeau = avis('alerte', '<b>Conflit : ce repère a été modifié depuis un autre téléphone.</b> Rien n\'a été écrasé. Votre saisie et celle du serveur sont toutes deux conservées : choisissez.' +
        '<div class="rg-compare"><div><b>Votre saisie (sur ce téléphone)</b><span class="mono">' + esc(C.fmt(rp.latitude)) + ' ; ' + esc(C.fmt(rp.longitude)) + '</span><small>' + (rp.origine === 'GPS_APPAREIL' ? 'capturé par téléphone' : 'saisi à la main') + ' · ' + esc(heureFr(rp.saisi_le)) + '</small></div>' +
        '<div><b>Sur le serveur' + (s ? ' (version ' + esc(s.version_no) + ')' : '') + '</b>' + (s ? '<span class="mono">' + esc(C.fmt(s.latitude)) + ' ; ' + esc(C.fmt(s.longitude)) + '</span><small>' + (s.origine === 'GPS_APPAREIL' ? 'capturé par téléphone' : 'saisi à la main') + ' · reçu le ' + esc(heureFr(s.created_at)) + '</small>' : '<small>repère absent du serveur</small>') + '</div></div>' +
        '<label class="rg-champ-saisie" for="rgMotifConflit"><span>Motif si vous maintenez votre saisie</span><input id="rgMotifConflit" maxlength="300" autocomplete="off"></label>' +
        '<div class="rg-actions">' + bouton('Garder la position du serveur', 'conflit-serveur', 'secondary', ' data-v="' + esc(rp.op_cle) + '"') + bouton('Maintenir ma saisie', 'conflit-local', 'primary', ' data-v="' + esc(rp.op_cle) + '"') + '</div>');
    } else if (rp && rp.etat === 'REJETE') {
      bandeau = avis('alerte', '<b>Le serveur a refusé ce repère.</b> ' + esc(rp.message || '') + '<br>Votre saisie est conservée sur ce téléphone. Corrigez-la ci-dessous puis enregistrez de nouveau, ou relancez l\'envoi si la cause est réglée (accord GPS recueilli, réseau).' +
        '<div class="rg-actions">' + bouton('Relancer l\'envoi', 'reessayer', 'secondary', ' data-v="' + esc(rp.op_cle) + '"') + bouton('Abandonner cette saisie', 'abandonner', 'secondary', ' data-v="' + esc(rp.op_cle) + '"') + '</div>');
    }
    var cap = etat.capture && etat.capture.cle === type + ':' + id ? etat.capture : null;
    var blocCapture = cap ? (cap.erreur ? avis('alerte', esc(cap.erreur) + ' <b>La saisie manuelle reste possible ci-dessous.</b>')
      : cap.attente ? avis('info', 'Recherche de la position… Restez à découvert, téléphone immobile (25 secondes au plus).')
      : '<div class="rg-capture"><b>Position de ce téléphone</b><span class="mono">' + esc(C.fmt(cap.latitude)) + ' ; ' + esc(C.fmt(cap.longitude)) + '</span><small>Précision ' + Math.round(cap.precision_m) + ' m · ' + esc(heureFr(cap.releve_le)) + '</small>' +
        '<small>C\'est la position du téléphone, maintenant. Pour un champ éloigné, utilisez « Saisir les coordonnées GPS ».</small></div>') : '';
    var er = etat.erreurs || {};
    var formManuel = mode === 'manuel' ? '<div class="rg-form" id="rgForm">' +
      '<p class="rg-note"><b>Degrés décimaux (WGS84).</b> Le point ou la virgule sont acceptés. En Côte d\'Ivoire la latitude est positive (4 à 11) et la longitude est <b>négative</b> (-9 à -2). Ces coordonnées peuvent être celles d\'un champ éloigné : la position du téléphone n\'est pas utilisée.</p>' +
      '<div class="rg-deux">' +
      '<div>' + champSaisie('rgLat', 'Latitude', br.lat, 'Exemple : 7,689512', 'inputmode="decimal" maxlength="16" data-rg-champ="lat"') + bouton('± signe', 'signe', 'secondary rg-mini', ' data-v="rgLat" aria-label="Changer le signe de la latitude"') + '</div>' +
      '<div>' + champSaisie('rgLng', 'Longitude', br.lng, 'Exemple : -5,031245', 'inputmode="decimal" maxlength="16" data-rg-champ="lng"') + bouton('± signe', 'signe', 'secondary rg-mini', ' data-v="rgLng" aria-label="Changer le signe de la longitude"') + '</div></div>' +
      '<details class="rg-plus"' + (br.date || br.source || br.precision ? ' open' : '') + '><summary>Informations sur le relevé (facultatif)</summary>' +
      '<div class="rg-deux">' + champSaisie('rgDate', 'Date du relevé, si elle est connue', br.date, '', 'type="date" data-rg-champ="date"') + champSaisie('rgHeure', 'Heure du relevé', br.heure, '', 'type="time" data-rg-champ="heure"') + '</div>' +
      champSaisie('rgSource', 'D\'où viennent ces coordonnées ?', br.source, 'Exemple : GPS Garmin, carnet de terrain, autre téléphone', 'maxlength="200" data-rg-champ="source"') +
      champSaisie('rgPrecision', 'Précision annoncée par l\'appareil, en mètres', br.precision, 'Laissez vide si vous ne la connaissez pas : elle restera « inconnue ».', 'inputmode="decimal" maxlength="8" data-rg-champ="precision"') + '</details></div>' : '';
    var alertes = etat.alertes && etat.alertes.length ? avis('alerte', etat.alertes.map(esc).join('<br>') + (etat.horsZone ? '<label class="rg-case"><input type="checkbox" id="rgConfirmer"' + (etat.confirmerHorsZone ? ' checked' : '') + '> <span>Je confirme que ces coordonnées sont exactes</span></label>' : '')) : '';
    var motif = correction && saisieOuverte && (mode === 'manuel' || (cap && !cap.erreur && !cap.attente)) ? champSaisie('rgMotif', 'Motif de la correction (obligatoire)', br.motif, 'L\'ancienne position reste dans l\'historique.', 'maxlength="300" data-rg-champ="motif"') : '';
    var pretAEnregistrer = saisieOuverte && (mode === 'manuel' || (cap && !cap.erreur && !cap.attente));
    /* Signaler ce point (supervision) : ni le repère ni le point de référence ne sont modifiés. */
    var sigRepere = '', sigPoint = '', rs = r[6];
    if (S && rs && rp && rp.etat === 'RECU' && Number(rs.latitude) === Number(rp.latitude) && Number(rs.longitude) === Number(rp.longitude))
      sigRepere = S.section({ hote: 'rg', classe: classe(), enLigne: enLigne(), donnees: r[5],
        cible: { type: 'REPERE', plot_id: ch.plot_id, repere_id: rs.id, objet_type: type, objet_id: id, latitude: Number(rs.latitude), longitude: Number(rs.longitude), village_latitude: ch.parcelle.village_latitude, village_longitude: ch.parcelle.village_longitude } });
    if (S && type === 'PARCELLE' && o.existant)
      sigPoint = S.section({ hote: 'rg', classe: classe(), enLigne: enLigne(), donnees: r[5],
        cible: { type: 'POINT_PARCELLE', plot_id: ch.plot_id, latitude: o.existant.latitude, longitude: o.existant.longitude, village_latitude: ch.parcelle.village_latitude, village_longitude: ch.parcelle.village_longitude } });
    peindre(tete(o.titre + ' ' + o.identifiant, n.producteur + ' · ' + n.champ, lien('← Positions du champ', 'reperes/champ/' + ch.plot_id)) + messageEtat() + r[3] + bandeau +
      '<section class="card"><div class="card-head"><div><h2>' + esc(o.titre) + ' ' + esc(o.identifiant) + '</h2></div></div>' +
      '<p class="rg-note">Rattachement : ' + esc(o.rattachement) + ' · village ' + esc(n.village) + ' · cluster ' + esc(n.cluster) + '</p>' +
      '<div class="rg-actuel"><b>Repère enregistré</b>' + ligneRepere(rp) + sigRepere + '</div>' +
      (o.existant ? '<div class="rg-actuel rg-actuel-existant"><b>' + esc(o.existant.nom) + '</b><span class="mono">' + esc(C.fmt(o.existant.latitude)) + ' ; ' + esc(C.fmt(o.existant.longitude)) + '</span><small>Précision ' + (o.existant.precision_m != null ? Math.round(o.existant.precision_m) + ' m' : 'inconnue') + '. Ce point n\'est pas modifié par le repère.</small>' + sigPoint + '</div>' : '') + '</section>' +
      (consent === false ? avis('alerte', '<b>Accord GPS non enregistré pour ce producteur.</b> Aucune coordonnée ne peut être enregistrée. ' + lien('Recueillir l\'accord', 'parcelles/parcours/' + ch.plot_id, 'secondary rg-mini')) : '') +
      (consent == null && peutSaisir() ? avis('info', 'Accord GPS non connu sur ce téléphone : vous pouvez préparer la saisie, le serveur le vérifiera à la synchronisation.') : '') +
      (o.remplace ? avis('info', 'Cet arbre a été remplacé : son repère est consultable, mais plus modifiable.') : '') +
      (o.panelLocal ? avis('info', 'Ce champ de l\'Observatoire n\'est pas encore reçu par le serveur. Le repère sera envoyé juste après lui, automatiquement.') : '') +
      (enLigne() ? '' : avis('info', 'Carte indisponible. Vous pouvez enregistrer les coordonnées sur ce téléphone.')) +
      (saisieOuverte ? '<section class="card rg-saisie"><div class="card-head"><div><h2>' + (correction ? 'Corriger le repère' : 'Renseigner le repère') + '</h2></div></div>' +
        '<div class="rg-actions rg-actions-choix">' + bouton('Utiliser ma position GPS', 'capturer', mode === 'gps' ? 'primary' : 'secondary') + bouton('Saisir les coordonnées GPS', 'manuel', mode === 'manuel' ? 'primary' : 'secondary') + '</div>' +
        blocCapture + formManuel + (er.general ? avis('erreur', esc(er.general)) : '') + alertes + motif +
        '<div class="rg-actions rg-actions-fin">' + bouton('Enregistrer', 'enregistrer', 'primary rg-grand', pretAEnregistrer ? '' : ' disabled') + '</div>' +
        '<p class="rg-note">L\'enregistrement se fait sur ce téléphone, sans réseau. Il part au serveur à la prochaine synchronisation.</p></section>'
        : (peutSaisir() ? '' : avis('info', 'Votre profil consulte les repères. La saisie est réservée au Chef d\'Unité, à son assistant et au Branch Manager.'))) +
      '<div class="rg-actions">' + ((rp || o.existant) ? lien('Voir sur la carte', 'reperes/champ/' + ch.plot_id + '/carte', 'secondary') : '') + lien('Positions du champ', 'reperes/champ/' + ch.plot_id) + '</div>');
    etat._objet = { objet: o, ch: ch, repere: rp, correction: correction };
    if (er.latitude) { var a = document.getElementById('rgLatErr'); if (a) a.textContent = er.latitude; }
    if (er.longitude) { var b = document.getElementById('rgLngErr'); if (b) b.textContent = er.longitude; }
    if (er.precision) { var c = document.getElementById('rgPrecisionErr'); if (c) c.textContent = er.precision; }
    if (er.date) { var d = document.getElementById('rgDateErr'); if (d) d.textContent = er.date; }
    if (er.motif) { var m = document.getElementById('rgMotifErr'); if (m) m.textContent = er.motif; }
  });
}

/* ------------------------------------------------------------------ 4. journal */
function vueJournal() {
  return Promise.all([L.file(), barreSync()]).then(function (r) {
    var l = r[0].slice().reverse();
    var lignes = l.map(function (o) {
      var cls = o.etat === 'RECU' ? 'ok' : o.etat === 'ATTENTE' || o.etat === 'ENVOI' ? 'attente' : o.etat === 'ANNULE' ? 'neutre' : 'alerte';
      return '<div class="rg-journal-ligne">' + pastille(C.ETATS[o.etat] || o.etat, cls) + ' <b>' + esc(o.libelle) + '</b>' +
        '<small><span class="mono">' + esc(C.fmt(o.payload.latitude)) + ' ; ' + esc(C.fmt(o.payload.longitude)) + '</span> · ' + (o.payload.origine === 'GPS_APPAREIL' ? 'capturé par téléphone' : 'saisi à la main') +
        ' · enregistré le ' + esc(heureFr(o.cree_le)) + (o.recu_le ? ' · reçu par le serveur le ' + esc(heureFr(o.recu_le)) : '') + (o.tentatives ? ' · ' + o.tentatives + ' envoi(s)' : '') + '</small>' +
        (o.message ? '<small class="rg-alerte-ligne">' + esc(o.message) + '</small>' : '') +
        '<span class="rg-actions">' + lien('Ouvrir', 'reperes/objet/' + o.payload.objet_type + '/' + o.payload.objet_id, 'secondary rg-mini') +
        (o.etat === 'REJETE' ? bouton('Relancer l\'envoi', 'reessayer', 'secondary rg-mini', ' data-v="' + esc(o.idempotency_key) + '"') : '') + '</span></div>';
    }).join('');
    peindre(tete('Journal des repères GPS', 'Ce que ce téléphone a enregistré pour votre compte, et ce que le serveur a répondu', lien('← Repères GPS', 'reperes')) + messageEtat() + r[1] +
      '<section class="card"><div class="card-head"><div><h2>Opérations de ce téléphone</h2></div></div>' + (lignes || '<div class="ops-empty">Aucun repère n\'a encore été enregistré sur ce téléphone avec ce compte.</div>') + '</section>');
  });
}

/* ------------------------------------------------------------------ actions */
function lireChamps() {
  var v = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
  return { lat: v('rgLat'), lng: v('rgLng'), date: v('rgDate'), heure: v('rgHeure'), source: v('rgSource'), precision: v('rgPrecision'), motif: v('rgMotif') };
}
function garderBrouillon() {
  var ctx = etat._objet; if (!ctx || !document.getElementById('rgForm')) return;
  clearTimeout(minuterieBrouillon);
  var ch = lireChamps();
  minuterieBrouillon = setTimeout(function () { L.ecrireBrouillon(ctx.objet.type, ctx.objet.id, ch).catch(function () {}); }, 350);
}
function capturer() {
  var ctx = etat._objet; if (!ctx) return;
  var cle = ctx.objet.type + ':' + ctx.objet.id;
  etat.mode = 'gps'; etat.erreurs = null; etat.alertes = null;
  if (!navigator.geolocation) { etat.capture = { cle: cle, erreur: 'Ce téléphone ne donne pas accès au GPS.' }; return rendre(); }
  etat.capture = { cle: cle, attente: true }; rendre();
  navigator.geolocation.getCurrentPosition(function (p) {
    if (!etat.capture || etat.capture.cle !== cle) return;
    var c = p.coords, prec = Number(c.accuracy);
    if (!(prec > 0)) etat.capture = { cle: cle, erreur: 'Le GPS n\'a pas indiqué sa précision : rien n\'a été retenu.' };
    else if (prec > C.PRECISION_CAPTURE_MAX_M) etat.capture = { cle: cle, erreur: 'Précision insuffisante (' + Math.round(prec) + ' m, maximum ' + C.PRECISION_CAPTURE_MAX_M + ' m) : rien n\'a été retenu. Placez-vous à découvert et réessayez.' };
    else if (c.latitude === 0 && c.longitude === 0) etat.capture = { cle: cle, erreur: 'Le GPS a renvoyé une position vide : rien n\'a été retenu.' };
    else etat.capture = { cle: cle, latitude: c.latitude, longitude: c.longitude, precision_m: prec, releve_le: new Date(p.timestamp || Date.now()).toISOString() };
    if (surRubrique()) rendre();
  }, function (e) {
    if (!etat.capture || etat.capture.cle !== cle) return;
    etat.capture = { cle: cle, erreur: e && e.code === 1 ? 'L\'accès au GPS a été refusé sur ce téléphone.' : e && e.code === 3 ? 'Le GPS n\'a pas trouvé la position à temps (25 secondes).' : 'Position GPS introuvable pour le moment.' };
    if (surRubrique()) rendre();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 });
}
function enregistrer() {
  var ctx = etat._objet; if (!ctx) return;
  var o = ctx.objet, cle = o.type + ':' + o.id, saisie = null, er = {}, champsLus = lireChamps();
  etat.erreurs = null; etat.alertes = null; etat.horsZone = false;
  var caseConf = document.getElementById('rgConfirmer'); if (caseConf) etat.confirmerHorsZone = caseConf.checked;
  if (ctx.ch.parcelle.consentement_gps === false) { etat.message = ['erreur', 'Accord GPS non enregistré pour ce producteur : rien n\'a été enregistré.']; return rendre(); }
  if (etat.mode === 'manuel') {
    var k = C.lireCoordonnees(champsLus.lat, champsLus.lng);
    if (!k.ok) er = k.erreurs;
    var prec = null, releve = null;
    if (String(champsLus.precision || '').trim()) { var p = C.lireNombre(champsLus.precision, 'Précision'); if (!p.ok || !(p.valeur > 0) || p.valeur > 10000) er.precision = 'Précision illisible : un nombre de mètres supérieur à 0, ou rien.'; else prec = p.valeur; }
    if (champsLus.date) {
      var d = new Date(champsLus.date + 'T' + (champsLus.heure || '12:00') + ':00');
      if (isNaN(d)) er.date = 'Date du relevé illisible.'; else if (d.getTime() > Date.now() + 600000) er.date = 'La date du relevé est dans le futur.'; else releve = d.toISOString();
    } else if (champsLus.heure) er.date = 'Indiquez aussi la date du relevé, ou effacez l\'heure.';
    if (ctx.correction && !String(champsLus.motif || '').trim()) er.motif = 'Indiquez le motif de la correction.';
    if (er.latitude || er.longitude || er.general || er.precision || er.date || er.motif) { etat.erreurs = er; return L.ecrireBrouillon(o.type, o.id, champsLus).catch(function () {}).then(rendre); }
    if (k.alertes.length && !(etat._alertesVues === cle + '|' + champsLus.lat + '|' + champsLus.lng && (!k.horsZone || etat.confirmerHorsZone))) {
      /* Valeur suspecte : on la MONTRE et on s'arrête. L'agent relit, corrige ou confirme ; rien n'est modifié pour lui. */
      etat.alertes = k.alertes; etat.horsZone = k.horsZone; etat._alertesVues = cle + '|' + champsLus.lat + '|' + champsLus.lng;
      return L.ecrireBrouillon(o.type, o.id, champsLus).catch(function () {}).then(rendre);
    }
    saisie = { latitude: k.latitude, longitude: k.longitude, origine: 'SAISIE_MANUELLE', source_externe: champsLus.source, releve_le: releve, precision_m: prec, motif: champsLus.motif, confirmer_hors_zone: k.horsZone && etat.confirmerHorsZone };
  } else {
    var cap = etat.capture;
    if (!cap || cap.cle !== cle || cap.erreur || cap.attente) { etat.message = ['erreur', 'Aucune position GPS retenue : touchez « Utiliser ma position GPS » ou saisissez les coordonnées.']; return rendre(); }
    if (ctx.correction && !String(champsLus.motif || '').trim()) { etat.erreurs = { motif: 'Indiquez le motif de la correction.' }; return rendre(); }
    saisie = { latitude: cap.latitude, longitude: cap.longitude, origine: 'GPS_APPAREIL', precision_m: cap.precision_m, releve_le: cap.releve_le, motif: champsLus.motif, confirmer_hors_zone: !C.dansZone(cap.latitude, cap.longitude) };
  }
  var origine = saisie.origine;
  return L.enregistrer({ type: o.type, id: o.id, plot_id: o.plot_id, panel_id: o.panel_id, bloc_id: o.bloc_id, libelle: o.libelle }, saisie).then(function () {
    /* Confirmé seulement ici : la transaction est sur le disque. */
    etat.capture = null; etat.mode = null; etat.erreurs = null; etat.alertes = null; etat.confirmerHorsZone = false; etat._alertesVues = null;
    etat.message = ['succes', '<b>Enregistré sur ce téléphone. En attente de synchronisation.</b>' + (enLigne() ? '' : ' Carte indisponible hors réseau : la position est dans la liste du champ.')];
    if (enLigne()) {
      return synchroniser(true).then(function (b) {
        if (b && b.recues) etat.message = ['succes', '<b>Enregistré sur ce téléphone, puis transmis au serveur.</b> Le repère reste « non vérifié » tant que la supervision n\'a pas statué.'];
        else if (b && (b.refusees || b.conflits)) etat.message = ['alerte', '<b>Enregistré sur ce téléphone.</b> Le serveur demande une action : voir ci-dessous.'];
        else if (b && b.erreurReseau) etat.message = ['succes', '<b>Enregistré sur ce téléphone. En attente de synchronisation.</b> Le serveur n\'a pas répondu : l\'envoi sera repris automatiquement.'];
        /* Après une capture GPS valide, la carte s'ouvre d'elle-même (réseau présent, accord donné). */
        if (origine === 'GPS_APPAREIL' && global.L && !(b && (b.refusees || b.conflits))) return aller('reperes/champ/' + o.plot_id + '/carte');
        return rendre();
      });
    }
    return rendre();
  }).catch(function (e) {
    etat.message = ['erreur', '<b>Rien n\'a été enregistré.</b> ' + esc(e && e.message || 'Écriture impossible sur ce téléphone.') + ' Vos valeurs sont toujours à l\'écran.'];
    return rendre();
  });
}
function resoudreConflit(cleOp, garderLocal) {
  var ctx = etat._objet; if (!ctx || !ctx.repere) return;
  var rp = ctx.repere, s = rp.serveur, o = ctx.objet;
  if (!garderLocal) return L.abandonner(cleOp, s || null).then(function () { etat.message = ['succes', 'La position du serveur est conservée. Votre saisie reste consultable dans le journal.']; rendre(); });
  var motif = (document.getElementById('rgMotifConflit') || {}).value || '';
  if (s && !motif.trim()) { etat.message = ['erreur', 'Indiquez le motif pour maintenir votre saisie : elle remplacera la position du serveur, qui restera dans l\'historique.']; return rendre(); }
  var saisie = { latitude: rp.latitude, longitude: rp.longitude, origine: rp.origine, source_externe: rp.source_externe, releve_le: rp.releve_le, precision_m: rp.precision_m, motif: motif.trim() || rp.motif, confirmer_hors_zone: rp.hors_zone };
  return L.enregistrer({ type: o.type, id: o.id, plot_id: o.plot_id, panel_id: o.panel_id, bloc_id: o.bloc_id, libelle: o.libelle }, saisie, { version_base: s ? s.version_no : 0, confirme: s || null })
    .then(function () { etat.message = ['succes', '<b>Enregistré sur ce téléphone. En attente de synchronisation.</b> Votre saisie sera proposée au serveur comme correction de sa version.']; return enLigne() ? synchroniser(true) : null; })
    .then(rendre, function (e) { etat.message = ['erreur', esc(e.message)]; rendre(); });
}
function surClic(ev) {
  var b = ev.target.closest ? ev.target.closest('[data-rg]') : null;
  if (!b || !surRubrique() || b.disabled) return;
  var a = b.getAttribute('data-rg'), v = b.getAttribute('data-v');
  if (a === 'sync') { b.disabled = true; return synchroniser(false).then(rendre); }
  if (a === 'preparer') { b.disabled = true; b.textContent = 'Préparation…'; return preparer().then(function (x) { etat.message = ['succes', x.parcelles + ' parcelle(s) de votre périmètre sont maintenant disponibles sur ce téléphone, hors réseau.']; rendre(); }, function (e) { etat.message = ['erreur', 'Préparation impossible : ' + esc(e.message)]; rendre(); }); }
  if (a === 'capturer') return capturer();
  if (a === 'manuel') { etat.mode = 'manuel'; etat.capture = null; etat.erreurs = null; etat.alertes = null; return rendre(); }
  if (a === 'signe') { var c = document.getElementById(v); if (c) { var t = c.value.trim(); c.value = /^[-−]/.test(t) ? t.slice(1) : (t ? '-' + t.replace(/^\+/, '') : '-'); c.focus(); garderBrouillon(); } return; }
  if (a === 'enregistrer') { b.disabled = true; return enregistrer(); }
  if (a === 'carte') { var k = etat._carte; if (k) afficherCarte(k.ch, k.objs, k.idx, k.geo); return; }
  if (a === 'reessayer') { b.disabled = true; return L.reessayer(v).then(function () { return synchroniser(false); }).then(rendre); }
  if (a === 'abandonner') { if (!global.confirm('Abandonner cette saisie ? Elle restera visible dans le journal, mais ne sera plus envoyée.')) return; return L.abandonner(v, null).then(function () { etat.message = ['info', 'Saisie abandonnée. Elle reste consultable dans le journal.']; rendre(); }); }
  if (a === 'conflit-serveur') return resoudreConflit(v, false);
  if (a === 'conflit-local') return resoudreConflit(v, true);
}
function surSaisie(ev) {
  if (!surRubrique()) return;
  var t = ev.target;
  if (t && t.id === 'rgRecherche') { etat.recherche = t.value; clearTimeout(etat._rech); etat._rech = setTimeout(rendre, 250); return; }
  if (t && t.getAttribute && t.getAttribute('data-rg-champ')) garderBrouillon();
}

/* ------------------------------------------------------------------ routeur */
function rendre() {
  var p = parts();
  if (carte) { try { carte.remove(); } catch (e) {} carte = null; }
  var suite;
  try {
    if (p[1] === 'champ' && p[2]) suite = vueChamp(p[2], p[3] === 'carte');
    else if (p[1] === 'objet' && p[2] && p[3]) suite = vueObjet(p[2], p[3]);
    else if (p[1] === 'journal') suite = vueJournal();
    else suite = vueAccueil();
  } catch (e) { suite = Promise.reject(e); }
  return Promise.resolve(suite).catch(function (e) {
    peindre(tete('Repères GPS', '') + avis('erreur', 'Cet écran n\'a pas pu s\'afficher : ' + esc(e && e.message || 'erreur inconnue') + ' Vos repères enregistrés ne sont pas touchés.') + '<div class="rg-actions">' + lien('Revenir aux repères', 'reperes') + '</div>');
  });
}
function render(p) {
  var cle = (p && p[1] === 'objet') ? p[2] + ':' + p[3] : null;
  if (!etat._objet || !cle || (etat._objet.objet.type + ':' + etat._objet.objet.id) !== cle) { etat.mode = null; etat.capture = null; etat.erreurs = null; etat.alertes = null; etat.confirmerHorsZone = false; etat._alertesVues = null; etat._objet = null; }
  return rendre();
}

document.addEventListener('click', surClic);
document.addEventListener('input', surSaisie);
global.addEventListener('online', function () { synchroniser(true).then(function () { if (surRubrique() && !document.getElementById('rgForm')) rendre(); }); });
global.addEventListener('offline', function () { if (surRubrique() && !document.getElementById('rgForm')) rendre(); });
setInterval(function () { if (enLigne()) synchroniser(true); }, 120000);
setTimeout(function () { if (enLigne()) synchroniser(true); }, 6000);

if (SG()) SG().brancher('rg', { rpc: rpcBrut, apres: function () { return surRubrique() ? rendre() : null; } });
global.ANAGROCI_REPERES = { render: render, synchroniser: synchroniser, preparer: preparer };
})(window);

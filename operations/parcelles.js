/* FIELD BUYING · Parcelles & cartographie (AFLP 2027)
   --------------------------------------------------------------------------------
   Rubrique de l'espace Réseau (E1) ; pilotage dans l'espace E5.
     · terrain (Unit Head, Assistant Unit Head) : choisir un producteur et sa parcelle,
       localiser le champ (point GPS), tracer le contour sur l'image ou au GPS, envoyer ;
     · validation (Chef de Zone de la zone ; Branch Manager en exception justifiée) ;
     · pilotage (Branch Manager, Assistant BM, Chef de Zone limité à sa zone).
   Règles d'écran :
     · « Enregistré sur ce téléphone » ≠ « Reçu par le serveur » (reçu = réponse serveur) ;
     · superficies distinctes : déclarée, cartographique estimée, mesurée GPS, validée ;
       aucune n'en écrase une autre ; aucune n'est présentée comme cadastrale ;
     · aucune imagerie satellite sans licence confirmée (paramètre serveur) ;
     · les droits affichés sont indicatifs : le serveur décide (RLS + RPC plot_map_*).
   Routes : #parcelles · /p/<plot> · /localiser/<plot> · /tracer/<plot>/<sat|gps|import> ·
            /ajouter/<producteur> · /validation · /valider/<contour> · /pilotage · /journal
   Écritures : uniquement par la file locale (plot_map_sync_batch) ou par les RPC de décision. */
(function (global) {
'use strict';
var C = global.ANAGROCI_PARCELLES_COEUR, L = global.ANAGROCI_PARCELLES_LOCAL;
var sb = null, clientPromise = null, carte = null, ed = null, minuterie = null, gpsVeille = null;
var etat = { filtre: null, recherche: '', village: '', params: null, liste: null, listeLe: null, message: null };

/* ------------------------------------------------------------------ utilitaires */
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function root() { return document.getElementById('opsRouteView'); }
function parts() { return (location.hash || '#parcelles').slice(1).split('/').map(decodeURIComponent); }
function aller(h) { if (location.hash === '#' + h) rendre(); else location.hash = h; }
function enLigne() { return navigator.onLine !== false; }
function dateFr(d) { if (!d) return '—'; var x = String(d).slice(0, 10).split('-'); return x.length === 3 ? x[2] + '/' + x[1] + '/' + x[0] : d; }
function heureFr(d) { if (!d) return '—'; try { var t = new Date(d); return ('0' + t.getDate()).slice(-2) + '/' + ('0' + (t.getMonth() + 1)).slice(-2) + ' ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); } catch (e) { return d; } }
function ha(m2) { return m2 == null ? '—' : C.hectares(m2) + ' ha'; }
function haDirect(v) { return v == null ? '—' : String(Number(v).toFixed(2)).replace('.', ',') + ' ha'; }
function peindre(h) { var r = root(); if (r) r.innerHTML = h; }
function tete(titre, sous, actions) { return '<div class="ops-route-head"><div><h1>' + esc(titre) + '</h1><p>' + esc(sous || '') + '</p></div><div class="ops-route-actions">' + (actions || '') + '</div></div>'; }
function avis(type, html) { return '<div class="pc-avis pc-avis-' + type + '" role="' + (type === 'erreur' ? 'alert' : 'status') + '">' + html + '</div>'; }
function bouton(libelle, action, cls, attrs) { return '<button type="button" class="btn ' + (cls || '') + '" data-pc="' + esc(action) + '"' + (attrs || '') + '>' + esc(libelle) + '</button>'; }
function lien(libelle, h, cls) { return '<a class="btn ' + (cls || '') + '" href="#' + esc(h) + '">' + esc(libelle) + '</a>'; }
function fetchBorne(url, opts) {
  opts = opts || {}; if (typeof AbortController === 'undefined') return fetch(url, opts);
  var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 25000), o = {};
  for (var k in opts) o[k] = opts[k]; o.signal = ac.signal;
  return fetch(url, o).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw new Error('réseau indisponible (' + (e && e.message || 'fetch') + ')'); });
}
function client() {
  if (sb) return Promise.resolve(sb);
  if (clientPromise) return clientPromise;
  clientPromise = new Promise(function (ok) {
    var k = 0, t = setInterval(function () {
      k++;
      if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) { clearInterval(t); sb = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON, { global: { fetch: fetchBorne } }); ok(sb); }
      else if (k > 60) { clearInterval(t); clientPromise = null; ok(null); }
    }, 80);
  });
  return clientPromise;
}
function rpcBrut(nom, args) { return client().then(function (c) { if (!c) return { data: null, error: { message: 'Connexion aux données indisponible.' } }; return c.rpc(nom, args || {}); }); }
function rpc(nom, args) { return rpcBrut(nom, args).then(function (x) { if (x.error) throw new Error(x.error.message || 'Erreur serveur'); return x.data; }); }
function lire(nom, cols, mod) {
  return client().then(function (c) { if (!c) throw new Error('Connexion aux données indisponible.'); var r = c.from(nom).select(cols || '*'); if (mod) r = mod(r); return r; })
    .then(function (x) { if (x.error) throw new Error(x.error.message); return x.data || []; });
}
function profil() { return (global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile) || {}; }
function classe() { return { 'Branch Manager': 'BM', 'Branch Manager / Head of Programme': 'BM', 'Assistant Branch Manager': 'ABM', 'Zonal Head': 'ZH', 'Unit Head': 'UH', 'Assistant Unit Head': 'AUH' }[profil().role] || null; }
function peutSaisir() { return ['BM', 'UH', 'AUH'].indexOf(classe()) >= 0; }
function peutValider() { return ['BM', 'ZH'].indexOf(classe()) >= 0; }
function peutPiloter() { return ['BM', 'ABM', 'ZH'].indexOf(classe()) >= 0; }

/* ------------------------------------------------------------------ données */
function parametres() {
  if (etat.params) return Promise.resolve(etat.params);
  return lire('plot_map_parametres', 'cle,valeur').then(function (l) {
    var p = {}; l.forEach(function (x) { p[x.cle] = x.valeur || {}; }); etat.params = p; L.cache.ecrire('parametres', p); return p;
  }).catch(function () { return L.cache.lire('parametres').then(function (p) { etat.params = p || {}; return etat.params; }); });
}
function actif(quoi, cluster) {
  var a = (etat.params || {}).activation || {};
  if (quoi === 'localisation') return !!a.localisation;
  return !!a.contours && (a.clusters_pilotes || []).some(function (x) { return String(x).toUpperCase() === String(cluster || '').toUpperCase(); });
}
function seuil(nom, d) { var s = (etat.params || {}).seuils || {}; return s[nom] != null ? Number(s[nom]) : d; }
var COLS = 'plot_id,plot_code,producteur_id,producteur_code,producteur_nom,producteur_prenoms,village_id,village_nom,cluster_code,zone_code,local_name,declared_area,area_unit,tree_count,latitude,longitude,gps_accuracy_m,gps_captured_at,gps_status,mapping_status,mapped_area_ha,mapped_area_method,current_geometry_id,split_from_plot_id,consentement_gps,derniere_geometry_id,derniere_status,derniere_version,derniere_area_m2,derniere_method,derniere_le,anomalies_ouvertes';
function chargerListe(forcer) {
  if (etat.liste && !forcer) return Promise.resolve(etat.liste);
  if (!enLigne()) return L.cache.lire('parcelles').then(function (l) { etat.liste = l || []; etat.listeHorsLigne = true; return etat.liste; });
  var tout = [], pas = 1000;
  function page(i) {
    return lire('plot_map_parcelles_v', COLS, function (r) { return r.order('village_nom').order('producteur_nom').range(i, i + pas - 1); }).then(function (l) {
      tout = tout.concat(l); return l.length === pas ? page(i + pas) : tout;
    });
  }
  return page(0).then(function (l) { etat.liste = l; etat.listeLe = new Date().toISOString(); etat.listeHorsLigne = false; L.cache.ecrire('parcelles', l); return l; })
    .catch(function (e) { return L.cache.lire('parcelles').then(function (l) { if (!l) throw e; etat.liste = l; etat.listeHorsLigne = true; return l; }); });
}
function parcelle(id) { return chargerListe().then(function (l) { return l.filter(function (x) { return x.plot_id === id; })[0] || null; }); }
function statutParcelle(x) { return x.mapping_status || (x.latitude != null ? 'LOCALISEE' : 'NON_LOCALISEE'); }
function badge(st) { return '<span class="pc-badge pc-st-' + esc(String(st).toLowerCase()) + '">' + esc(C.STATUTS[st] || st) + '</span>'; }
function badgeEtat(e) { return '<span class="pc-badge pc-et-' + esc(String(e).toLowerCase()) + '">' + esc(C.ETATS[e] || e) + '</span>'; }

/* ------------------------------------------------------------------ synchronisation */
function synchroniser(silencieux) {
  return L.synchroniser(rpcBrut).then(function (b) {
    if (b && b.recues) { etat.liste = null; L.file.toutes().then(function (l) { l.forEach(function (o) { if (o.etat === 'RECU' && o.type === 'SOUMETTRE_CONTOUR' && o.payload) L.brouillon.lire(o.payload.plot_id).then(function (br) { if (br && br.op_cle === o.idempotency_key) L.brouillon.effacer(o.payload.plot_id); }); }); }); }
    if (!silencieux) { etat.message = b.horsLigne ? 'Pas de réseau : les envois partiront au retour du réseau.' : b.erreurReseau ? 'Synchronisation interrompue : ' + b.erreurReseau : (b.envoyees ? (b.recues + ' reçue(s) par le serveur' + (b.refusees ? ', ' + b.refusees + ' refusée(s)' : '') + (b.conflits ? ', ' + b.conflits + ' conflit(s)' : '')) : 'Rien à envoyer.'); }
    return b;
  });
}
function barreSync() {
  return L.compter().then(function (n) {
    var att = (n.ATTENTE || 0) + (n.ENVOI || 0), pb = (n.REJETE || 0) + (n.CONFLIT || 0);
    return '<div class="pc-sync' + (pb ? ' pc-sync-alerte' : att ? ' pc-sync-attente' : '') + '">' +
      '<span><b>' + (att ? att + ' ' + esc(C.ETATS.ATTENTE).toLowerCase() : 'Tout est reçu par le serveur') + '</b>' +
      (pb ? ' · ' + pb + ' à traiter (refus ou conflit)' : '') + (enLigne() ? '' : ' · hors ligne') + '</span>' +
      '<span class="pc-sync-act">' + bouton('Synchroniser', 'sync', 'secondary') + lien('Journal', 'parcelles/journal', 'secondary') + '</span></div>';
  });
}

/* ------------------------------------------------------------------ 1. accueil */
function accueil() {
  peindre(tete('Parcelles & cartographie', 'Localiser les champs, tracer leurs contours, suivre leur validation.') + '<div class="ops-empty">Chargement des parcelles…</div>');
  return Promise.all([parametres(), chargerListe(), barreSync(), L.brouillon.tous()]).then(function (r) {
    var liste = r[1], sync = r[2], brouillons = r[3], parBr = {};
    brouillons.forEach(function (b) { if (b.sommets && b.sommets.length) parBr[b.plot_id] = b; });
    var c = { NON_LOCALISEE: 0, A_CORRIGER: 0, SOUMIS: 0, VALIDE: 0 };
    liste.forEach(function (x) { var s = statutParcelle(x); if (c[s] != null) c[s]++; });
    var q = etat.recherche.toLowerCase(), villages = {};
    liste.forEach(function (x) { villages[x.village_id] = x.village_nom; });
    var vue = liste.filter(function (x) {
      if (etat.village && x.village_id !== etat.village) return false;
      if (etat.filtre === 'brouillons' && !parBr[x.plot_id]) return false;
      if (etat.filtre && etat.filtre !== 'brouillons' && statutParcelle(x) !== etat.filtre) return false;
      if (q && (x.producteur_code + ' ' + x.producteur_nom + ' ' + (x.producteur_prenoms || '') + ' ' + (x.local_name || '') + ' ' + (x.plot_code || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var a = (etat.params || {}).activation || {};
    var bandeau = !a.localisation && !a.contours ? avis('info', '<b>Fonction en préparation.</b> La localisation et le tracé ne sont pas encore activés par le Branch Manager. Vous pouvez consulter les parcelles.')
      : !a.contours ? avis('info', 'La localisation des champs est ouverte. Le tracé des contours n\'est pas encore activé.')
      : avis('info', 'Tracé des contours ouvert en pilote pour : <b>' + esc((a.clusters_pilotes || []).join(', ') || 'aucun cluster') + '</b>.');
    var tuiles = [['NON_LOCALISEE', 'Non localisées', c.NON_LOCALISEE], ['brouillons', 'Brouillons sur ce téléphone', Object.keys(parBr).length], ['A_CORRIGER', 'À corriger', c.A_CORRIGER], ['SOUMIS', 'Soumises au Chef de Zone', c.SOUMIS], ['VALIDE', 'Validées', c.VALIDE]];
    var h = tete('Parcelles & cartographie', 'Localiser les champs, tracer leurs contours, suivre leur validation.',
      (peutValider() ? lien('À valider', 'parcelles/validation', 'secondary') : '') + (peutPiloter() ? lien('Carte des parcelles', 'parcelles/pilotage', 'secondary') : '')) +
      (etat.message ? avis('ok', esc(etat.message)) : '') + bandeau + sync +
      (etat.listeHorsLigne ? avis('info', 'Hors ligne : liste enregistrée sur ce téléphone' + (etat.listeLe ? ' le ' + heureFr(etat.listeLe) : '') + '.') : '') +
      '<div class="pc-tuiles">' + tuiles.map(function (t) {
        return '<button type="button" class="pc-tuile' + (etat.filtre === t[0] ? ' actif' : '') + '" data-pc="filtre" data-v="' + t[0] + '"><b>' + t[2] + '</b><span>' + esc(t[1]) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="pc-filtres"><label class="pc-champ"><span>Rechercher (code producteur, nom, parcelle)</span><input id="pcRecherche" type="search" value="' + esc(etat.recherche) + '" placeholder="Ex. code producteur"></label>' +
      '<label class="pc-champ"><span>Village</span><select id="pcVillage"><option value="">Tous les villages</option>' +
      Object.keys(villages).sort(function (x, y) { return String(villages[x]).localeCompare(villages[y]); }).map(function (v) { return '<option value="' + esc(v) + '"' + (etat.village === v ? ' selected' : '') + '>' + esc(villages[v]) + '</option>'; }).join('') +
      '</select></label></div>' +
      '<p class="pc-compte">' + vue.length + ' parcelle(s)' + (etat.filtre ? ' · filtre actif ' + bouton('Retirer le filtre', 'filtre', 'secondary pc-mini', ' data-v=""') : '') + '</p>' +
      (vue.length ? '<div class="pc-liste">' + vue.slice(0, 200).map(function (x) {
        var br = parBr[x.plot_id];
        return '<a class="pc-ligne" href="#parcelles/p/' + esc(x.plot_id) + '"><div><b class="mono">' + esc(x.producteur_code || x.producteur_id) + '</b> · ' + esc(x.producteur_nom || '') + ' ' + esc(x.producteur_prenoms || '') +
          '<small>' + esc(x.village_nom || '') + ' · ' + esc(x.cluster_code || 'sans cluster') + ' · ' + esc(x.local_name || 'Parcelle sans nom') + '</small></div>' +
          '<div class="pc-ligne-d">' + badge(statutParcelle(x)) + (br ? '<span class="pc-badge pc-et-local">Brouillon</span>' : '') +
          '<small>Déclarée ' + (x.declared_area != null ? esc(String(x.declared_area).replace('.', ',')) + ' ' + esc((x.area_unit || 'HA').toLowerCase()) : '—') +
          (x.derniere_area_m2 ? ' · Tracée ' + ha(x.derniere_area_m2) : '') + '</small></div></a>';
      }).join('') + (vue.length > 200 ? '<p class="pc-compte">Affinez la recherche : 200 premières parcelles affichées.</p>' : '') + '</div>' : '<div class="ops-empty">Aucune parcelle pour ce filtre dans votre périmètre.</div>');
    etat.message = null; peindre(h);
    var champ = document.getElementById('pcRecherche');
    if (champ) champ.addEventListener('input', function () { etat.recherche = champ.value; clearTimeout(champ._t); champ._t = setTimeout(function () { accueil().then(function () { var c2 = document.getElementById('pcRecherche'); if (c2) { c2.focus(); c2.setSelectionRange(c2.value.length, c2.value.length); } }); }, 350); });
    var vs = document.getElementById('pcVillage'); if (vs) vs.addEventListener('change', function () { etat.village = vs.value; accueil(); });
  });
}

/* ------------------------------------------------------------------ 2. fiche parcelle */
function fiche(id) {
  peindre(tete('Parcelle', '') + '<div class="ops-empty">Chargement…</div>');
  return Promise.all([parametres(), parcelle(id), L.file.pourParcelle(id), L.brouillon.lire(id),
    enLigne() ? lire('plot_map_geometries_v', 'id,version_no,status,method,area_m2,perimeter_m,boundary_confidence,producer_confirmation,auteur_nom,created_by_role,created_at,preverifie_par_nom,decide_par_nom,decided_at,decision_comment,decision_exception,geojson,imagery_source,gps_accuracy_max_m', function (r) { return r.eq('plot_id', id).order('version_no', { ascending: false }); }).catch(function () { return null; }) : Promise.resolve(null),
    enLigne() ? lire('farmer_plot_anomalies', 'id,type,statut,bloquante,overlap_m2,detail,classification,justification,geometry_id', function (r) { return r.eq('plot_id', id); }).catch(function () { return []; }) : Promise.resolve([])
  ]).then(function (r) {
    var x = r[1], ops = r[2], br = r[3], versions = r[4], anomalies = r[5] || [];
    if (!x) {
      var ajout = ops.filter(function (o) { return o.type === 'AJOUTER_PARCELLE' && o.payload.id === id; })[0];
      if (!ajout) { peindre(tete('Parcelle introuvable', '') + avis('erreur', 'Cette parcelle n\'est pas dans votre périmètre ou n\'existe plus.') + lien('Retour aux parcelles', 'parcelles', 'secondary')); return; }
      peindre(tete(ajout.payload.local_name || 'Nouvelle parcelle', 'Parcelle créée sur ce téléphone') + avis('info', badgeEtat(ajout.etat) + ' Elle apparaîtra dans la liste après réception par le serveur.' + (ajout.message ? '<br>' + esc(ajout.message) : '')) + lien('Retour aux parcelles', 'parcelles', 'secondary'));
      return;
    }
    var st = statutParcelle(x), consent = x.consentement_gps === true, active = (versions || []).filter(function (v) { return ['SOUMIS', 'A_CORRIGER', 'VALIDE'].indexOf(v.status) >= 0; })[0];
    var validee = (versions || []).filter(function (v) { return v.status === 'VALIDE'; })[0];
    var actions = '';
    if (peutSaisir()) {
      if (!consent) actions += avis('alerte', '<b>Consentement GPS non enregistré pour ce producteur.</b> Aucune localisation ni aucun contour ne peut être enregistré. Recueillez d\'abord son accord dans son passeport (portée « Données GPS »).');
      else {
        if (actif('localisation')) actions += bouton(x.latitude != null ? 'Relocaliser mon champ' : 'Localiser mon champ', 'localiser', x.latitude != null ? 'secondary' : '');
        if (actif('contours', x.cluster_code)) actions += lien(br && br.sommets && br.sommets.length ? 'Reprendre le tracé (' + br.sommets.length + ' sommets)' : 'Tracer sur la carte', 'parcelles/tracer/' + id + '/sat') + lien('Mesurer avec GPS', 'parcelles/tracer/' + id + '/gps', 'secondary') + lien('Importer un fichier', 'parcelles/tracer/' + id + '/import', 'secondary');
        else if (actif('localisation')) actions += '<p class="pc-note">Tracé des contours non activé pour le cluster ' + esc(x.cluster_code || '—') + '.</p>';
      }
      if (actif('contours', x.cluster_code)) actions += lien('Ajouter une parcelle à ce producteur', 'parcelles/ajouter/' + encodeURIComponent(x.producteur_id) + '/' + id, 'secondary');
    }
    var decl = x.declared_area != null ? String(x.declared_area).replace('.', ',') + ' ' + (x.area_unit || 'HA').toLowerCase() : 'non déclarée';
    var supers = '<div class="pc-superficies">' +
      '<div><span>Superficie déclarée par le producteur</span><b>' + esc(decl) + '</b></div>' +
      '<div><span>' + esc(active && active.method === 'GPS_POINTS' ? 'Superficie mesurée par GPS (en cours)' : 'Superficie cartographique estimée (en cours)') + '</span><b>' + (active ? ha(active.area_m2) : '—') + '</b>' + (active ? '<small>' + esc(C.STATUTS[active.status]) + ' · v' + active.version_no + '</small>' : '') + '</div>' +
      '<div><span>Superficie validée par le Chef de Zone</span><b>' + (x.mapped_area_ha != null ? haDirect(x.mapped_area_ha) : '—') + '</b>' + (x.mapped_area_method ? '<small>' + esc(C.SUPERFICIES[x.mapped_area_method] || x.mapped_area_method) + '</small>' : '') + '</div>' +
      '<div><span>Superficie productive en anacardiers</span><b>non vérifiée</b><small>Le contour ne mesure pas la surface plantée.</small></div></div>' +
      '<p class="pc-note">Superficie cartographique : estimation pour le suivi AFLP, <b>pas un bornage ni une limite cadastrale</b>.</p>';
    var point = x.latitude != null ? '<div class="pc-point"><b>Point GPS de référence</b><span class="mono">' + Number(x.latitude).toFixed(6) + ' ; ' + Number(x.longitude).toFixed(6) + '</span><small>Précision ' + (x.gps_accuracy_m != null ? Math.round(x.gps_accuracy_m) + ' m' : 'inconnue') + ' · ' + heureFr(x.gps_captured_at) + (x.gps_status === 'GPS_VERIFIED' ? ' · vérifié par la supervision' : '') + '</small><small>Un point localise le champ ; il ne mesure pas sa superficie.</small></div>'
      : '<div class="pc-point pc-point-vide"><b>Champ non localisé</b><small>Rendez-vous dans la plantation et appuyez sur « Localiser mon champ ».</small></div>';
    var envois = ops.length ? '<section class="card"><div class="card-head"><div><h2>Envois depuis ce téléphone</h2></div></div>' + ops.slice().reverse().slice(0, 8).map(function (o) {
      return '<div class="pc-envoi">' + badgeEtat(o.etat) + ' <span>' + esc(o.resume) + ' · ' + heureFr(o.cree_le) + '</span>' + (o.message ? '<small>' + esc(o.message) + '</small>' : '') +
        (o.etat === 'REJETE' && o.code === 'TECHNIQUE' ? bouton('Réessayer', 'reessayer', 'secondary pc-mini', ' data-v="' + esc(o.idempotency_key) + '"') : '') + '</div>';
    }).join('') + '</section>' : '';
    var hist = versions === null ? avis('info', 'Hors ligne : l\'historique des contours sera affiché au retour du réseau.') : versions.length ? '<section class="card"><div class="card-head"><div><h2>Historique des contours</h2></div></div>' + versions.map(function (v) {
      return '<div class="pc-version"><div>' + badge(v.status) + ' <b>v' + v.version_no + '</b> · ' + esc(C.METHODES[v.method] || v.method) + ' · ' + ha(v.area_m2) + ' · périmètre ' + C.metres(v.perimeter_m) + ' m</div>' +
        '<small>' + esc(C.CONFIANCE[v.boundary_confidence] || '') + ' · par ' + esc(v.auteur_nom || '—') + ' le ' + heureFr(v.created_at) + (v.preverifie_par_nom ? ' · pré-vérifié par ' + esc(v.preverifie_par_nom) : '') + '</small>' +
        (v.decision_comment ? '<small><b>' + (v.status === 'A_CORRIGER' ? 'À corriger' : 'Décision') + ' (' + esc(v.decide_par_nom || '') + (v.decision_exception ? ', exception Branch Manager' : '') + ') :</b> ' + esc(v.decision_comment) + '</small>' : '') + '</div>';
    }).join('') + '</section>' : '';
    var anos = anomalies.filter(function (a) { return a.statut === 'OUVERTE'; });
    var anoH = anos.length ? avis('alerte', '<b>' + anos.length + ' anomalie(s) ouverte(s)</b> : ' + anos.map(function (a) { return esc(libAnomalie(a)); }).join(' ; ')) : '';
    peindre(tete(x.local_name || 'Parcelle sans nom', (x.producteur_code || '') + ' · ' + (x.producteur_nom || '') + ' ' + (x.producteur_prenoms || '') + ' · ' + (x.village_nom || '') + ' · ' + (x.cluster_code || ''), lien('Retour', 'parcelles', 'secondary')) +
      '<div class="pc-fiche-tete">' + badge(st) + (x.plot_code ? '<span class="mono">' + esc(x.plot_code) + '</span>' : '') + '</div>' + anoH +
      '<div class="pc-grille"><div>' + point + supers + '<div class="pc-actions">' + actions + '</div></div><div id="pcMiniCarte" class="pc-carte pc-carte-mini" aria-label="Carte de la parcelle"></div></div>' + envois + hist);
    miniCarte('pcMiniCarte', x, active || validee);
  });
}
function libAnomalie(a) {
  if (a.type === 'CHEVAUCHEMENT') return 'chevauchement de ' + C.hectares(a.overlap_m2, 2) + ' ha avec une parcelle voisine';
  if (a.type === 'ECART_SUPERFICIE') return 'écart de ' + (a.detail && a.detail.ecart_pct) + ' % avec la superficie déclarée';
  if (a.type === 'CONFLIT_VERSION') return 'deux tracés concurrents de cette parcelle';
  if (a.type === 'PRECISION_GPS') return 'précision GPS faible (' + (a.detail && a.detail.precision_max_m) + ' m)';
  return a.type;
}

/* ------------------------------------------------------------------ cartes (Leaflet) */
/* Fond de carte : uniquement ce que la licence permet. Aucun préchargement de tuiles. */
function fond(map) {
  var im = (etat.params || {}).imagerie || {}, f = im.fournisseur || 'aucun';
  if (!enLigne()) return { nom: 'aucun', satellite: false, message: 'Hors ligne : pas de fond de carte. Le tracé GPS reste possible.' };
  if (f === 'esri' && im.licence_confirmee && im.cle) {
    global.L.tileLayer('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + encodeURIComponent(im.cle), { maxZoom: 19, attribution: 'Source : Esri, Maxar, Earthstar Geographics' }).addTo(map);
    return { nom: 'Esri World Imagery', satellite: true, message: 'Date de l\'image inconnue : vérifiez qu\'elle correspond au terrain.' };
  }
  if (f === 'osm') {
    global.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© contributeurs OpenStreetMap' }).addTo(map);
    return { nom: 'Plan OpenStreetMap', satellite: false, message: 'Plan, pas une image satellite : les limites des champs n\'y figurent pas.' };
  }
  return { nom: 'aucun', satellite: false, message: 'Image satellite non activée (licence à confirmer par écrit). Utilisez « Mesurer avec GPS » ou l\'import de fichier.' };
}
function centre(x) { return x && x.latitude != null ? [Number(x.latitude), Number(x.longitude)] : [7.69, -5.03]; }
function miniCarte(idEl, x, version) {
  var el = document.getElementById(idEl); if (!el || !global.L) { if (el) el.innerHTML = '<div class="ops-empty">Carte indisponible.</div>'; return; }
  var m = global.L.map(el, { zoomControl: true, attributionControl: true }); fond(m);
  var bornes = [];
  if (version && version.geojson) { var p = global.L.geoJSON(version.geojson, { style: { color: '#053B23', weight: 2, fillColor: '#8DC556', fillOpacity: 0.3 } }).addTo(m); bornes.push(p.getBounds()); }
  if (x.latitude != null) { var pt = global.L.circleMarker(centre(x), { radius: 7, color: '#fff', weight: 2, fillColor: '#1E6FD9', fillOpacity: 1 }).addTo(m).bindTooltip('Point de référence'); bornes.push(global.L.latLngBounds([centre(x), centre(x)])); }
  if (bornes.length) { var b = bornes[0]; bornes.slice(1).forEach(function (z) { b.extend(z); }); m.fitBounds(b.pad(0.4), { maxZoom: 18 }); } else { m.setView(centre(x), 13); el.insertAdjacentHTML('beforeend', '<div class="pc-carte-voile">Champ non localisé</div>'); }
  setTimeout(function () { m.invalidateSize(); }, 150);
}

/* ------------------------------------------------------------------ GPS (aucune position simulée) */
function lecturesGps(maxMs, maxLectures, rappel) {
  return new Promise(function (ok, ko) {
    if (!navigator.geolocation) { ko(new Error('Ce téléphone ne fournit pas de position GPS à l\'application.')); return; }
    var l = [], fini = false, t;
    function terminer() { if (fini) return; fini = true; clearTimeout(t); try { navigator.geolocation.clearWatch(gpsVeille); } catch (e) {} gpsVeille = null; ok(l); }
    gpsVeille = navigator.geolocation.watchPosition(function (p) {
      l.push({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy, le: new Date(p.timestamp || Date.now()).toISOString() });
      if (rappel) rappel(l); if (l.length >= maxLectures) terminer();
    }, function (e) {
      if (fini) return; fini = true; clearTimeout(t); try { navigator.geolocation.clearWatch(gpsVeille); } catch (x) {}
      ko(new Error(e.code === 1 ? 'Localisation refusée : autorisez la localisation pour FBMS dans les réglages du téléphone.' : e.code === 2 ? 'Position introuvable : activez le GPS et placez-vous à découvert.' : 'Le GPS ne répond pas : réessayez à découvert.'));
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs });
    t = setTimeout(terminer, maxMs);
  });
}
function localiser(id) {
  return Promise.all([parametres(), parcelle(id)]).then(function (r) {
    var x = r[1]; if (!x) return aller('parcelles/p/' + id);
    var max = seuil('precision_localisation_max_m', 50);
    peindre(tete('Localiser mon champ', (x.producteur_code || '') + ' · ' + (x.local_name || ''), lien('Annuler', 'parcelles/p/' + id, 'secondary')) +
      avis('info', 'Placez-vous <b>dans la plantation</b>, à découvert si possible, puis patientez. Il n\'est pas nécessaire de faire le tour du champ.') +
      '<div class="pc-gps" id="pcGps"><b>Recherche de la position…</b><span>0 lecture</span></div>');
    return lecturesGps(20000, 8, function (l) {
      var b = C.combinerLectures(l), el = document.getElementById('pcGps');
      if (el && b) el.innerHTML = '<b>Précision actuelle : ' + Math.round(b.precision) + ' m</b><span>' + l.length + ' lecture(s)</span>';
    }).then(function (l) {
      var b = C.combinerLectures(l);
      if (!b) throw new Error('Aucune position reçue : activez le GPS et réessayez.');
      var bon = b.precision <= max;
      peindre(tete('Localiser mon champ', (x.producteur_code || '') + ' · ' + (x.local_name || ''), lien('Annuler', 'parcelles/p/' + id, 'secondary')) +
        (bon ? avis('ok', 'Position obtenue : précision <b>' + Math.round(b.precision) + ' m</b> (' + b.lectures + ' lecture(s) retenue(s)).')
             : avis('alerte', 'Précision insuffisante : <b>' + Math.round(b.precision) + ' m</b> (maximum ' + max + ' m). Avancez à découvert, loin des grands arbres, puis réessayez.')) +
        '<div class="pc-actions">' + (bon ? bouton('Enregistrer ce point', 'enregistrer-point') : '') + bouton('Réessayer', 'localiser', bon ? 'secondary' : '') + '</div>');
      ed = { localisation: { plot_id: id, latitude: b.lat, longitude: b.lng, precision_m: Math.round(b.precision * 100) / 100, capture_le: l[l.length - 1].le } };
    });
  }).catch(function (e) {
    peindre(tete('Localiser mon champ', '', lien('Retour', 'parcelles/p/' + id, 'secondary')) + avis('erreur', esc(e.message)) + '<div class="pc-actions">' + bouton('Réessayer', 'localiser') + '</div>');
  });
}

/* ------------------------------------------------------------------ 3. éditeur de contour */
function nouvelEtatEditeur(x, mode, br, active) {
  var base = active ? active.id : null;
  var e = br && br.sommets ? br : {
    sommets: active && active.geojson ? C.nettoyer(active.geojson.coordinates[0]) : [], sommets_gps: [],
    methode: mode === 'gps' ? 'GPS_POINTS' : mode === 'import' ? 'IMPORT_FICHIER' : 'SATELLITE', confiance: null, confirmation: 'NON_DEMANDEE', base_geometry_id: base,
    geometry_id: C.uuid()
  };
  if (!br) e.base_geometry_id = base;
  if (br && mode === 'gps' && e.methode === 'SATELLITE' && e.sommets.length) e.methode = 'MIXTE';
  if (br && mode === 'gps' && !e.sommets.length) e.methode = 'GPS_POINTS';
  e.historique = []; e.selection = null; e.mode = mode; e.x = x;
  return e;
}
function tracer(id, mode) {
  peindre(tete('Tracé du contour', '') + '<div class="ops-empty">Préparation…</div>');
  return Promise.all([parametres(), parcelle(id), L.brouillon.lire(id),
    enLigne() ? lire('plot_map_geometries_v', 'id,status,version_no,geojson', function (r) { return r.eq('plot_id', id).in('status', ['SOUMIS', 'A_CORRIGER', 'VALIDE']).order('version_no', { ascending: false }).limit(1); }).catch(function () { return []; }) : Promise.resolve([])
  ]).then(function (r) {
    var x = r[1]; if (!x) return aller('parcelles/p/' + id);
    if (!actif('contours', x.cluster_code) || !peutSaisir() || !x.consentement_gps) return aller('parcelles/p/' + id);
    ed = nouvelEtatEditeur(x, mode, r[2], r[3][0]);
    peindre(tete(mode === 'gps' ? 'Mesurer avec GPS' : mode === 'import' ? 'Importer un contour' : 'Tracer sur la carte', (x.producteur_code || '') + ' · ' + (x.local_name || 'Parcelle') + ' · déclarée ' + (x.declared_area != null ? String(x.declared_area).replace('.', ',') + ' ha' : '—'), lien('Fermer', 'parcelles/p/' + id, 'secondary')) +
      '<div id="pcFond"></div><div class="pc-editeur"><div id="pcCarte" class="pc-carte pc-carte-ed" aria-label="Carte de tracé"></div><div class="pc-panneau" id="pcPanneau"></div></div>');
    construireCarte();
    peindrePanneau();
  });
}
function construireCarte() {
  if (carte) { try { carte.remove(); } catch (e) {} carte = null; }
  var el = document.getElementById('pcCarte'); if (!el) return;
  if (!global.L) { el.innerHTML = '<div class="ops-empty">Bibliothèque de carte indisponible.</div>'; return; }
  carte = global.L.map(el, { zoomControl: true });
  var f = fond(carte); ed.fond = f.nom === 'aucun' ? null : f.nom;
  var zf = document.getElementById('pcFond'); if (zf) zf.innerHTML = avis(f.satellite ? 'info' : 'alerte', esc(f.message));
  carte._couche = global.L.layerGroup().addTo(carte);
  if (ed.x.latitude != null) global.L.circleMarker(centre(ed.x), { radius: 6, color: '#fff', weight: 2, fillColor: '#1E6FD9', fillOpacity: 1, interactive: false }).addTo(carte);
  if (ed.sommets.length >= 2) carte.fitBounds(global.L.latLngBounds(ed.sommets.map(function (s) { return [s[1], s[0]]; })).pad(0.3), { maxZoom: 18 });
  else carte.setView(centre(ed.x), ed.x.latitude != null ? 17 : 13);
  carte.on('click', function (ev) { if (ed.mode !== 'sat') return; modifier(function () { ed.sommets.push([ev.latlng.lng, ev.latlng.lat]); ed.selection = ed.sommets.length - 1; }); });
  dessiner();
  setTimeout(function () { carte && carte.invalidateSize(); }, 200);
}
function icone(cls, txt) { return global.L.divIcon({ className: 'pc-sommet ' + cls, html: '<span>' + (txt || '') + '</span>', iconSize: [30, 30], iconAnchor: [15, 15] }); }
function dessiner() {
  if (!carte) return; var g = carte._couche; g.clearLayers();
  var ll = ed.sommets.map(function (s) { return [s[1], s[0]]; });
  if (ll.length >= 3) global.L.polygon(ll, { color: '#053B23', weight: 2, fillColor: '#8DC556', fillOpacity: 0.3, interactive: false }).addTo(g);
  else if (ll.length === 2) global.L.polyline(ll, { color: '#053B23', weight: 2, dashArray: '6 6', interactive: false }).addTo(g);
  ll.forEach(function (p, i) {
    var mk = global.L.marker(p, { draggable: ed.mode !== 'gps' || ed.methode === 'MIXTE', icon: icone(i === ed.selection ? 'pc-sel' : '', i + 1), keyboard: false, title: 'Sommet ' + (i + 1) }).addTo(g);
    mk.on('click', function (ev) { global.L.DomEvent.stopPropagation(ev); ed.selection = i; dessiner(); peindrePanneau(); });
    mk.on('dragstart', function () { ed.historique.push(JSON.stringify(ed.sommets)); });
    mk.on('dragend', function (ev) { var q = ev.target.getLatLng(); ed.sommets[i] = [q.lng, q.lat]; ed.selection = i; apresModif(); });
  });
  if (ll.length >= 3 && ed.mode === 'sat') ll.forEach(function (p, i) {          // milieux : toucher pour insérer un sommet
    var n = ll[(i + 1) % ll.length], mid = [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2];
    var mk = global.L.marker(mid, { icon: icone('pc-milieu', '+'), keyboard: false, title: 'Insérer un sommet' }).addTo(g);
    mk.on('click', function (ev) { global.L.DomEvent.stopPropagation(ev); modifier(function () { ed.sommets.splice(i + 1, 0, [mid[1], mid[0]]); ed.selection = i + 1; }); });
  });
}
function modifier(fn) { ed.historique.push(JSON.stringify(ed.sommets)); if (ed.historique.length > 100) ed.historique.shift(); fn(); apresModif(); }
function apresModif() { sauver(); dessiner(); peindrePanneau(); }
function sauver() {
  var b = {}; ['sommets', 'sommets_gps', 'methode', 'confiance', 'confirmation', 'confirmation_note', 'base_geometry_id', 'geometry_id', 'fond', 'notes', 'op_cle'].forEach(function (k) { b[k] = ed[k]; });
  return L.brouillon.ecrire(ed.x.plot_id, b).then(function () { ed.sauveLe = new Date().toISOString(); var s = document.getElementById('pcSauve'); if (s) s.textContent = C.ETATS.LOCAL + ' · ' + heureFr(ed.sauveLe); })
    .catch(function (e) { var s = document.getElementById('pcSauve'); if (s) s.textContent = 'ATTENTION : brouillon non enregistré (' + e.message + ')'; });
}
function peindrePanneau() {
  var p = document.getElementById('pcPanneau'); if (!p || !ed) return;
  var v = C.verifier(ed.sommets, (etat.params || {}).seuils), ecart = v.sommets >= 3 ? C.ecartDeclare(v.area_m2, ed.x.declared_area, ed.x.area_unit) : null;
  var lim = seuil('ecart_superficie_pct', 20), st = C.statsPrecision((ed.sommets_gps || []).map(function (s) { return s.precision; }));
  var h = '<div class="pc-mesure"><span class="pc-etq">' + (v.sommets >= 3 ? 'Calcul provisoire sur ce téléphone' : 'Placez au moins 3 sommets') + '</span>' +
    '<b class="pc-surface">' + (v.sommets >= 3 ? C.hectares(v.area_m2) + ' ha' : '—') + '</b>' +
    '<span class="mono">' + (v.sommets >= 3 ? C.metres(v.area_m2) + ' m² · ' : '') + 'périmètre ' + (v.sommets >= 2 ? C.metres(v.perimeter_m) + ' m' : '—') + ' · ' + v.sommets + ' sommet(s)</span>' +
    (ecart != null && Math.abs(ecart) > lim ? '<span class="pc-ecart">Écart de ' + (ecart > 0 ? '+' : '') + String(ecart).replace('.', ',') + ' % avec la superficie déclarée : vérifiez les limites avec le producteur.</span>' : '') +
    (st ? '<span class="pc-note">Précision GPS : ' + Math.round(st.min) + ' à ' + Math.round(st.max) + ' m (médiane ' + Math.round(st.mediane) + ' m)</span>' : '') +
    (v.sommets >= 3 && v.erreurs.length ? '<span class="pc-erreur">' + v.erreurs.map(esc).join('<br>') + '</span>' : '') + '</div>';
  h += '<div class="pc-outils">';
  if (ed.mode === 'sat') h += '<p class="pc-note">Touchez la carte pour poser un sommet ; faites glisser un sommet pour le déplacer ; touchez « + » pour en insérer un.</p>';
  if (ed.mode === 'gps') h += '<p class="pc-note">Marchez jusqu\'à chaque coin du champ, puis appuyez sur le bouton. Le contour se ferme automatiquement.</p>' + bouton('Ajouter ma position comme sommet', 'gps-sommet');
  if (ed.mode === 'import') h += '<label class="pc-champ"><span>Fichier GeoJSON ou KML (un seul contour)</span><input type="file" id="pcFichier" accept=".geojson,.json,.kml,application/geo+json,application/vnd.google-earth.kml+xml"></label>';
  h += bouton('Annuler la dernière action', 'annuler', 'secondary', ed.historique.length ? '' : ' disabled') +
    bouton(ed.selection != null ? 'Supprimer le sommet ' + (ed.selection + 1) : 'Supprimer le sommet', 'supprimer', 'secondary', ed.selection != null ? '' : ' disabled') + '</div>';
  h += '<fieldset class="pc-choix"><legend>Les limites sont-elles visibles ?</legend>' + Object.keys(C.CONFIANCE).map(function (k) {
    return '<label class="pc-puce' + (ed.confiance === k ? ' actif' : '') + '"><input type="radio" name="pcConf" value="' + k + '"' + (ed.confiance === k ? ' checked' : '') + '> ' + esc(C.CONFIANCE[k]) + '</label>';
  }).join('') + '</fieldset>';
  h += '<label class="pc-champ"><span>Confirmation des limites par le producteur</span><select id="pcConfirm">' +
    [['NON_DEMANDEE', 'Non demandée'], ['CONFIRMEE_SUR_PLACE', 'Confirmée sur place par le producteur'], ['CONTESTEE', 'Contestée par le producteur'], ['PRODUCTEUR_ABSENT', 'Producteur absent']].map(function (o) {
      return '<option value="' + o[0] + '"' + (ed.confirmation === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
    '</select><small>N\'indiquez « confirmée » que si le producteur l\'a réellement dit. Aucune signature n\'est demandée ni simulée.</small></label>';
  h += '<label class="pc-champ"><span>Observation (facultatif)</span><input id="pcNote" type="text" maxlength="300" value="' + esc(ed.notes || '') + '"></label>';
  h += '<p class="pc-sauve" id="pcSauve">' + (ed.sauveLe ? C.ETATS.LOCAL + ' · ' + heureFr(ed.sauveLe) : 'Brouillon enregistré automatiquement à chaque sommet') + '</p>';
  h += '<div class="pc-actions pc-actions-fin">' + bouton('Envoyer au Chef de Zone', 'envoyer', '', v.ok && ed.confiance ? '' : ' disabled') + '</div>';
  if (!ed.confiance && v.ok) h += '<p class="pc-note">Indiquez si les limites sont visibles pour pouvoir envoyer.</p>';
  p.innerHTML = h;
  Array.prototype.forEach.call(p.querySelectorAll('input[name=pcConf]'), function (r) { r.addEventListener('change', function () { ed.confiance = r.value; sauver(); peindrePanneau(); }); });
  var cf = document.getElementById('pcConfirm'); if (cf) cf.addEventListener('change', function () { ed.confirmation = cf.value; sauver(); });
  var nt = document.getElementById('pcNote'); if (nt) nt.addEventListener('change', function () { ed.notes = nt.value; sauver(); });
  var fi = document.getElementById('pcFichier'); if (fi) fi.addEventListener('change', function () { importer(fi.files && fi.files[0]); });
}
function importer(f) {
  if (!f) return;
  var r = new FileReader();
  r.onload = function () {
    try {
      var t = String(r.result), s = /<kml/i.test(t) ? C.sommetsDepuisKML(t) : C.sommetsDepuisGeoJSON(JSON.parse(t));
      modifier(function () { ed.sommets = s; ed.methode = 'IMPORT_FICHIER'; ed.selection = null; ed.notes = (ed.notes ? ed.notes + ' · ' : '') + 'Import : ' + f.name; });
      if (carte && s.length >= 2) carte.fitBounds(global.L.latLngBounds(s.map(function (z) { return [z[1], z[0]]; })).pad(0.3), { maxZoom: 18 });
    } catch (e) { var z = document.getElementById('pcFond'); if (z) z.insertAdjacentHTML('beforeend', avis('erreur', 'Fichier non accepté : ' + esc(e.message))); }
  };
  r.readAsText(f);
}
function sommetGps() {
  var max = seuil('precision_gps_max_m', 30), btn = document.querySelector('[data-pc="gps-sommet"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Lecture de la position…'; }
  lecturesGps(12000, 6, function (l) { var b = C.combinerLectures(l); if (btn && b) btn.textContent = 'Précision ' + Math.round(b.precision) + ' m · ' + l.length + ' lecture(s)'; }).then(function (l) {
    var b = C.combinerLectures(l); if (!b) throw new Error('Aucune position reçue : réessayez à découvert.');
    modifier(function () { ed.sommets.push([b.lng, b.lat]); ed.sommets_gps.push({ precision: b.precision, lectures: b.lectures }); ed.selection = ed.sommets.length - 1; if (ed.methode === 'SATELLITE' && ed.sommets.length > 1) ed.methode = 'MIXTE'; });
    if (carte) carte.setView([b.lat, b.lng], Math.max(carte.getZoom(), 17));
    if (b.precision > max) { var z = document.getElementById('pcFond'); if (z) z.innerHTML = avis('alerte', 'Sommet ajouté avec une précision faible (' + Math.round(b.precision) + ' m). Il sera signalé au Chef de Zone. Vous pouvez le supprimer et réessayer.'); }
  }).catch(function (e) { var z = document.getElementById('pcFond'); if (z) z.innerHTML = avis('erreur', esc(e.message)); peindrePanneau(); });
}
function envoyer() {
  var v = C.verifier(ed.sommets, (etat.params || {}).seuils);
  if (!v.ok || !ed.confiance) return peindrePanneau();
  var payload = C.soumission(ed.x.plot_id, ed, v, L.appareil());
  var o = C.operation('SOUMETTRE_CONTOUR', payload, L.appareil());
  ed.op_cle = o.idempotency_key;
  return sauver().then(function () { return L.file.ajouter(o, 'Contour ' + C.hectares(v.area_m2) + ' ha · ' + (ed.x.producteur_code || '') + ' · ' + (ed.x.local_name || 'parcelle')); })
    .then(function () { etat.message = 'Contour enregistré sur ce téléphone. Envoi au serveur…'; return synchroniser(); })
    .then(function () { aller('parcelles/p/' + ed.x.plot_id); });
}

/* ------------------------------------------------------------------ 4. ajouter une parcelle */
function ajouter(prodId, depuis) {
  return Promise.all([parametres(), chargerListe()]).then(function (r) {
    var mesParcelles = r[1].filter(function (x) { return x.producteur_id === prodId; }), x = mesParcelles[0];
    if (!x) return aller('parcelles');
    peindre(tete('Ajouter une parcelle', (x.producteur_code || '') + ' · ' + (x.producteur_nom || '') + ' ' + (x.producteur_prenoms || ''), lien('Annuler', 'parcelles/p/' + (depuis || x.plot_id), 'secondary')) +
      avis('info', 'À utiliser quand le producteur exploite plusieurs champs séparés. La parcelle déclarée existante est conservée.') +
      '<form id="pcAjout" class="card pc-form"><label class="pc-champ"><span>Nom du champ (repère connu du producteur)</span><input id="pcNom" required maxlength="80"></label>' +
      '<label class="pc-champ"><span>Superficie déclarée par le producteur (ha, facultatif)</span><input id="pcDecl" type="number" min="0.01" step="0.01" inputmode="decimal"></label>' +
      '<label class="pc-champ"><span>Ce champ fait-il partie d\'une parcelle déjà déclarée ?</span><select id="pcParent"><option value="">Non, c\'est un champ distinct</option>' +
      mesParcelles.map(function (p) { return '<option value="' + esc(p.plot_id) + '">Oui, division de « ' + esc(p.local_name || 'parcelle sans nom') + ' »</option>'; }).join('') +
      '</select><small>En cas de division, la superficie déclarée d\'origine n\'est pas comptée deux fois.</small></label>' +
      '<div class="pc-actions">' + bouton('Enregistrer la parcelle', 'ajout-ok') + '</div></form>');
    ed = { ajout: { producteur_id: prodId, cluster: x.cluster_code } };
  });
}
function validerAjout() {
  var nom = (document.getElementById('pcNom') || {}).value, decl = (document.getElementById('pcDecl') || {}).value, parent = (document.getElementById('pcParent') || {}).value;
  if (!nom || !nom.trim()) { var n = document.getElementById('pcNom'); if (n) { n.focus(); n.setCustomValidity('Nom obligatoire'); n.reportValidity(); } return; }
  var id = C.uuid(), o = C.operation('AJOUTER_PARCELLE', { id: id, producteur_id: ed.ajout.producteur_id, local_name: nom.trim(), declared_area: decl ? Number(decl) : null, split_from_plot_id: parent || null }, L.appareil());
  return L.file.ajouter(o, 'Nouvelle parcelle « ' + nom.trim() + ' »').then(function () { return synchroniser(); }).then(function () { etat.liste = null; aller('parcelles/p/' + id); });
}

/* ------------------------------------------------------------------ 5. validation (Chef de Zone ; BM en exception) */
function validation() {
  if (!peutValider()) { peindre(tete('À valider', '') + avis('erreur', 'Réservé au Chef de Zone et au Branch Manager.')); return Promise.resolve(); }
  peindre(tete('Contours à valider', '') + '<div class="ops-empty">Chargement…</div>');
  return Promise.all([lire('plot_map_geometries_v', 'id,plot_id,cluster_code,zone_code,version_no,method,area_m2,boundary_confidence,producer_confirmation,auteur_nom,created_by_role,created_at,preverifie_par_nom,row_version', function (r) { return r.eq('status', 'SOUMIS').order('created_at'); }),
    lire('farmer_plot_anomalies', 'geometry_id,type,bloquante', function (r) { return r.eq('statut', 'OUVERTE'); }), chargerListe()]).then(function (r) {
    var anos = {}, parc = {};
    r[1].forEach(function (a) { (anos[a.geometry_id] = anos[a.geometry_id] || []).push(a); });
    r[2].forEach(function (x) { parc[x.plot_id] = x; });
    var p = profil();
    peindre(tete('Contours à valider', classe() === 'ZH' ? 'Zone ' + (p.zone || 'non renseignée') : 'Branch Manager · décision en exception justifiée uniquement', lien('Retour', 'parcelles', 'secondary')) +
      (classe() === 'ZH' && !p.zone ? avis('erreur', 'Votre zone n\'est pas renseignée dans votre profil : le serveur refusera toute validation. Contactez le Branch Manager.') : '') +
      (r[0].length ? '<div class="pc-liste">' + r[0].map(function (g) {
        var x = parc[g.plot_id] || {}, a = anos[g.id] || [], bl = a.filter(function (z) { return z.bloquante; }).length;
        return '<a class="pc-ligne" href="#parcelles/valider/' + esc(g.id) + '"><div><b class="mono">' + esc(x.producteur_code || '') + '</b> · ' + esc(x.local_name || 'Parcelle') + '<small>' + esc(x.village_nom || '') + ' · ' + esc(g.cluster_code) + ' · v' + g.version_no + ' · ' + esc(C.METHODES[g.method]) + ' · par ' + esc(g.auteur_nom || '') + ' le ' + heureFr(g.created_at) + (g.preverifie_par_nom ? ' · pré-vérifié' : '') + '</small></div>' +
          '<div class="pc-ligne-d"><b>' + ha(g.area_m2) + '</b>' + (bl ? '<span class="pc-badge pc-st-a_corriger">' + bl + ' anomalie(s) bloquante(s)</span>' : a.length ? '<span class="pc-badge pc-st-soumis">' + a.length + ' signalement(s)</span>' : '') + '</div></a>';
      }).join('') + '</div>' : '<div class="ops-empty">Aucun contour en attente dans votre périmètre.</div>'));
  }).catch(function (e) { peindre(tete('Contours à valider', '') + avis('erreur', esc(e.message))); });
}
function valider(gid) {
  peindre(tete('Vérifier un contour', '') + '<div class="ops-empty">Chargement…</div>');
  return lire('plot_map_geometries_v', '*', function (r) { return r.eq('id', gid); }).then(function (l) {
    var g = l[0]; if (!g) throw new Error('Contour introuvable ou hors de votre zone.');
    return Promise.all([g, parcelle(g.plot_id), lire('farmer_plot_anomalies', '*', function (r) { return r.eq('geometry_id', gid); }), parametres()]);
  }).then(function (r) {
    var g = r[0], x = r[1] || {}, anos = r[2], ouvertes = anos.filter(function (a) { return a.statut === 'OUVERTE'; }), bloq = ouvertes.filter(function (a) { return a.bloquante; });
    var ecart = C.ecartDeclare(g.area_m2, x.declared_area, x.area_unit), bm = classe() === 'BM';
    var ids = ouvertes.map(function (a) { return a.other_geometry_id; }).filter(Boolean);
    var h = tete('Vérifier un contour', (x.producteur_code || '') + ' · ' + (x.local_name || '') + ' · ' + (x.village_nom || '') + ' · ' + g.cluster_code, lien('Retour', 'parcelles/validation', 'secondary')) +
      '<div class="pc-grille"><div>' +
      '<div class="pc-superficies"><div><span>Superficie du contour (serveur)</span><b>' + ha(g.area_m2) + '</b><small>' + C.metres(g.area_m2) + ' m² · périmètre ' + C.metres(g.perimeter_m) + ' m · ' + g.vertex_count + ' sommets</small></div>' +
      '<div><span>Superficie déclarée</span><b>' + (x.declared_area != null ? String(x.declared_area).replace('.', ',') + ' ha' : '—') + '</b>' + (ecart != null ? '<small>Écart ' + (ecart > 0 ? '+' : '') + String(ecart).replace('.', ',') + ' %</small>' : '') + '</div>' +
      '<div><span>Méthode</span><b>' + esc(C.METHODES[g.method]) + '</b><small>' + esc(C.CONFIANCE[g.boundary_confidence]) + '</small></div>' +
      '<div><span>Producteur</span><b>' + esc({ NON_DEMANDEE: 'Confirmation non demandée', CONFIRMEE_SUR_PLACE: 'A confirmé sur place', CONTESTEE: 'Conteste les limites', PRODUCTEUR_ABSENT: 'Absent' }[g.producer_confirmation] || '') + '</b>' + (g.producer_confirmation_note ? '<small>' + esc(g.producer_confirmation_note) + '</small>' : '') + '</div></div>' +
      '<p class="pc-note">Auteur : ' + esc(g.auteur_nom || '—') + ' (' + esc(g.created_by_role || '') + ') · ' + heureFr(g.created_at) + (g.preverifie_par_nom ? ' · pré-vérifié par ' + esc(g.preverifie_par_nom) + (g.preverification_note ? ' : ' + esc(g.preverification_note) : '') : '') +
      (g.imagery_source ? ' · fond : ' + esc(g.imagery_source) : '') + (g.gps_accuracy_max_m ? ' · précision GPS max ' + Math.round(g.gps_accuracy_max_m) + ' m' : '') + (g.notes ? ' · ' + esc(g.notes) : '') + '</p>' +
      (anos.length ? '<section class="card"><div class="card-head"><div><h2>Anomalies</h2></div></div>' + anos.map(function (a) {
        return '<div class="pc-ano"><div>' + (a.statut === 'OUVERTE' ? '<span class="pc-badge ' + (a.bloquante ? 'pc-st-a_corriger">Bloquante' : 'pc-st-soumis">À examiner') + '</span>' : '<span class="pc-badge pc-st-valide">Traitée</span>') + ' ' + esc(libAnomalie(a)) + '</div>' +
          (a.statut === 'OUVERTE' ? '<div class="pc-ano-form"><select data-ano="' + esc(a.id) + '">' + optionsClassement(a.type) + '</select><input type="text" placeholder="Justification (obligatoire)" data-ano-j="' + esc(a.id) + '" maxlength="300">' + bouton('Enregistrer le classement', 'classer', 'secondary pc-mini', ' data-v="' + esc(a.id) + '"') + '</div>'
            : '<small>' + esc(a.classification || '') + ' : ' + esc(a.justification || '') + '</small>') + '</div>';
      }).join('') + '</section>' : '') +
      '<section class="card pc-decision"><div class="card-head"><div><h2>Décision</h2></div></div>' +
      (bloq.length ? avis('alerte', 'Validation impossible tant que les anomalies bloquantes ne sont pas classées.') : '') +
      '<label class="pc-champ"><span>Commentaire (obligatoire pour une correction)</span><textarea id="pcComment" rows="3" maxlength="500"></textarea></label>' +
      (bm ? '<label class="pc-case"><input type="checkbox" id="pcException"> Décision exceptionnelle du Branch Manager (justification d\'au moins 15 caractères, journalisée)</label>' : '') +
      '<div class="pc-actions">' + bouton('Valider le contour', 'decider', '', (bloq.length ? ' disabled' : '') + ' data-v="VALIDER"') + bouton('Demander une correction', 'decider', 'secondary', ' data-v="A_CORRIGER"') + '</div>' +
      '<p class="pc-note">Valider confirme le contour pour le suivi AFLP : ce n\'est pas une certification topographique.</p></section>' +
      '</div><div id="pcCarteVal" class="pc-carte pc-carte-mini" aria-label="Carte du contour et des parcelles voisines"></div></div>';
    peindre(h);
    ed = { validation: g };
    var el = document.getElementById('pcCarteVal');
    if (el && global.L) {
      var m = global.L.map(el); fond(m);
      var p = global.L.geoJSON(g.geojson, { style: { color: '#053B23', weight: 2, fillColor: '#8DC556', fillOpacity: 0.35 } }).addTo(m);
      m.fitBounds(p.getBounds().pad(0.4), { maxZoom: 18 });
      if (ids.length) lire('plot_map_geometries_v', 'id,geojson', function (r) { return r.in('id', ids); }).then(function (v) { v.forEach(function (o) { global.L.geoJSON(o.geojson, { style: { color: '#B45309', weight: 2, dashArray: '5 4', fillColor: '#EE9E00', fillOpacity: 0.25 } }).addTo(m); }); }).catch(function () {});
      setTimeout(function () { m.invalidateSize(); }, 150);
    }
  }).catch(function (e) { peindre(tete('Vérifier un contour', '', lien('Retour', 'parcelles/validation', 'secondary')) + avis('erreur', esc(e.message))); });
}
function optionsClassement(t) {
  var o = { CHEVAUCHEMENT: [['LIMITE_PARTAGEE', 'Limite partagée'], ['LEGITIME_FAMILIAL', 'Exploitation familiale'], ['SUPERPOSITION_DECLAREE', 'Superposition déclarée'], ['ERREUR_TRACE', 'Erreur de tracé (renvoi en correction)']],
    CONFLIT_VERSION: [['CONFLIT_TRAITE', 'Conflit examiné : je valide un tracé et renvoie l\'autre']], ECART_SUPERFICIE: [['ECART_CONFIRME', 'Écart confirmé (déclaration inexacte)'], ['ECART_A_CORRIGER', 'Tracé à corriger']],
    PRECISION_GPS: [['PRECISION_ACCEPTEE', 'Précision acceptable pour ce champ'], ['ERREUR_TRACE', 'Mesure à refaire']] }[t] || [];
  return '<option value="">Classer…</option>' + o.map(function (z) { return '<option value="' + z[0] + '">' + esc(z[1]) + '</option>'; }).join('');
}

/* ------------------------------------------------------------------ 6. pilotage (carte des parcelles) */
function pilotage() {
  if (!peutPiloter()) { peindre(tete('Carte des parcelles', '') + avis('erreur', 'Réservé au Branch Manager, à son assistant et aux Chefs de Zone.')); return Promise.resolve(); }
  var f = etat.filtresPilotage || (etat.filtresPilotage = {});
  peindre(tete('Carte des parcelles', 'Pilotage de la cartographie') + '<div class="ops-empty">Calcul des indicateurs…</div>');
  return rpc('plot_map_tableau', { p: Object.assign({ detail: 'oui' }, f) }).then(function (t) {
    etat.tableau = t;
    function k(lib, val, note) { return '<div class="kpi"><span>' + esc(lib) + '</span><b>' + (val == null ? '—' : esc(val)) + '</b>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>'; }
    var clusters = (t.par_cluster || []).map(function (c) { return c.cluster_code; });
    var h = tete('Carte des parcelles', 'Périmètre : ' + (t.perimetre === 'TOUTES_ZONES' ? 'toutes les zones' : t.perimetre) + ' · calculé le ' + heureFr(t.genere_le), lien('Retour', 'parcelles', 'secondary')) +
      '<form class="pc-filtres" id="pcFiltresPil"><label class="pc-champ"><span>Cluster</span><select name="cluster"><option value="">Tous</option>' + ['BEOUMI', 'BOTRO', 'BROBO', 'DIABO', 'DJEBONOUA', 'SAKASSOU'].map(function (c) { return '<option' + (f.cluster === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label class="pc-champ"><span>Statut</span><select name="statut"><option value="">Tous</option>' + ['NON_LOCALISEE', 'LOCALISEE', 'SOUMIS', 'A_CORRIGER', 'VALIDE'].map(function (s) { return '<option value="' + s + '"' + (f.statut === s ? ' selected' : '') + '>' + esc(C.STATUTS[s]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="pc-champ"><span>Code producteur</span><input name="producteur" value="' + esc(f.producteur || '') + '"></label>' +
      '<label class="pc-champ"><span>Contours du</span><input type="date" name="du" value="' + esc(f.du || '') + '"></label><label class="pc-champ"><span>au</span><input type="date" name="au" value="' + esc(f.au || '') + '"></label>' +
      '<div class="pc-actions">' + bouton('Appliquer', 'filtrer-pilotage', 'secondary') + '</div></form>' +
      '<div class="kpi-grid pc-kpi">' +
      k('Producteurs avec un champ localisé', t.producteurs_localises + ' / ' + t.producteurs) + k('Parcelles localisées', t.parcelles_localisees + ' / ' + t.parcelles, t.parcelles_non_localisees + ' non localisée(s)') +
      k('Parcelles avec contour', t.parcelles_avec_contour) + k('Soumises', t.parcelles_soumises) + k('Validées', t.parcelles_validees) + k('À corriger', t.parcelles_a_corriger) +
      k('Superficie déclarée', t.superficie_declaree_ha == null ? null : haDirect(t.superficie_declaree_ha), 'Déclarations des producteurs') +
      k('Superficie cartographiée', t.superficie_cartographiee_ha == null ? null : haDirect(t.superficie_cartographiee_ha), 'Dernier contour de chaque parcelle') +
      k('Superficie validée (somme)', t.superficie_validee_somme_ha == null ? null : haDirect(t.superficie_validee_somme_ha), 'Somme des contours validés') +
      k('Emprise unique validée', t.emprise_unique_validee_ha == null ? null : haDirect(t.emprise_unique_validee_ha), 'Sans double comptage géographique') +
      k('Chevauchements ouverts', t.chevauchements_ouverts, t.chevauchements_ouverts_ha == null ? '' : String(t.chevauchements_ouverts_ha).replace('.', ',') + ' ha concernés') +
      k('Anomalies ouvertes', Object.keys(t.anomalies_ouvertes || {}).reduce(function (s, x) { return s + t.anomalies_ouvertes[x]; }, 0)) + '</div>' +
      '<p class="pc-note">Superficies cartographiques : estimations pour le suivi AFLP, non cadastrales. Aucune production ni aucun rendement n\'est déduit de la superficie.</p>' +
      '<section class="card"><div class="card-head"><div><h2>Évolution par cluster</h2></div><div class="pc-actions">' + bouton('Export Excel (CSV)', 'export-csv', 'secondary pc-mini') + bouton('Export GeoJSON (contours validés)', 'export-geojson', 'secondary pc-mini') + '</div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Cluster</th><th>Parcelles</th><th>Localisées</th><th>Avec contour</th><th>Soumises</th><th>Validées</th><th>À corriger</th><th>Déclarée</th><th>Cartographiée</th><th>Validée</th></tr></thead><tbody>' +
      (t.par_cluster || []).map(function (c) { return '<tr><td><b>' + esc(c.cluster_code || 'Sans cluster') + '</b></td><td>' + c.parcelles + '</td><td>' + c.localisees + '</td><td>' + c.avec_contour + '</td><td>' + c.soumises + '</td><td>' + c.validees + '</td><td>' + c.a_corriger + '</td><td>' + haDirect(c.declaree_ha) + '</td><td>' + haDirect(c.cartographiee_ha) + '</td><td>' + haDirect(c.validee_ha) + '</td></tr>'; }).join('') +
      '</tbody></table></div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Travail par agent</h2></div></div><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Rôle</th><th>Contours</th><th>Soumis</th><th>Validés</th><th>À corriger</th></tr></thead><tbody>' +
      ((t.par_agent || []).length ? t.par_agent.map(function (a) { return '<tr><td>' + esc(a.agent) + '</td><td>' + esc(a.role || '') + '</td><td>' + a.contours + '</td><td>' + a.soumis + '</td><td>' + a.valides + '</td><td>' + a.a_corriger + '</td></tr>'; }).join('') : '<tr><td colspan="6">Aucun contour sur la période.</td></tr>') +
      '</tbody></table></div></section>';
    peindre(h);
  }).catch(function (e) { peindre(tete('Carte des parcelles', '', lien('Retour', 'parcelles', 'secondary')) + avis('erreur', esc(e.message))); });
}
function telecharger(nom, contenu, type) {
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([contenu], { type: type })); a.download = nom;
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function exporterCsv() {
  var t = etat.tableau || {}, d = new Date().toISOString().slice(0, 10);
  telecharger('FBMS_Parcelles_' + d + '.csv', C.csv(t.parcelles_detail || [], [['plot_code', 'Code parcelle'], ['producteur_code', 'Code producteur'], ['village', 'Village'], ['cluster', 'Cluster'], ['parcelle', 'Parcelle'],
    ['statut', 'Statut'], ['declaree_ha', 'Superficie déclarée (ha)'], ['cartographiee_ha', 'Superficie cartographiée (ha)'], ['methode', 'Méthode'], ['confiance', 'Visibilité des limites'], ['validee_ha', 'Superficie validée (ha)'], ['anomalies', 'Anomalies ouvertes']]), 'text/csv;charset=utf-8');
}
function exporterGeojson() {
  return lire('plot_map_geometries_v', 'id,plot_id,cluster_code,version_no,method,area_m2,perimeter_m,boundary_confidence,decided_at,geojson', function (r) { return r.eq('status', 'VALIDE'); }).then(function (l) {
    var parc = {}; (etat.liste || []).forEach(function (x) { parc[x.plot_id] = x; });
    var fc = { type: 'FeatureCollection', name: 'FBMS_contours_valides', features: l.map(function (g) {
      var x = parc[g.plot_id] || {};
      return { type: 'Feature', geometry: g.geojson, properties: { plot_code: x.plot_code || null, producteur_code: x.producteur_code || null, cluster: g.cluster_code, version: g.version_no, methode: g.method, superficie_ha: Math.round(g.area_m2) / 10000, perimetre_m: Math.round(g.perimeter_m), visibilite_limites: g.boundary_confidence, valide_le: g.decided_at, avertissement: 'Superficie cartographique non cadastrale' } };
    }) };
    telecharger('FBMS_Contours_valides_' + new Date().toISOString().slice(0, 10) + '.geojson', JSON.stringify(fc), 'application/geo+json');
  });
}

/* ------------------------------------------------------------------ 7. journal */
function journalVue() {
  return Promise.all([L.file.toutes(), L.journal.derniers(60), barreSync()]).then(function (r) {
    peindre(tete('Journal de la cartographie', 'Opérations de ce compte sur ce téléphone', lien('Retour', 'parcelles', 'secondary')) + r[2] +
      '<section class="card"><div class="card-head"><div><h2>File d\'envoi</h2></div></div>' + (r[0].length ? r[0].slice().reverse().map(function (o) {
        return '<div class="pc-envoi">' + badgeEtat(o.etat) + ' <span>' + esc(o.resume) + ' · créé ' + heureFr(o.cree_le) + (o.recu_le ? ' · reçu ' + heureFr(o.recu_le) : '') + '</span>' + (o.message ? '<small>' + esc(o.message) + '</small>' : '') +
          (o.etat === 'REJETE' && o.code === 'TECHNIQUE' ? bouton('Réessayer', 'reessayer', 'secondary pc-mini', ' data-v="' + esc(o.idempotency_key) + '"') : '') + '</div>';
      }).join('') : '<div class="ops-empty">Aucune opération.</div>') + '</section>' +
      '<section class="card"><div class="card-head"><div><h2>Événements</h2></div></div>' + (r[1].length ? r[1].map(function (j) { return '<div class="pc-envoi"><span>' + heureFr(j.le) + ' · ' + esc(j.message) + '</span>' + (j.detail ? '<small>' + esc(j.detail) + '</small>' : '') + '</div>'; }).join('') : '<div class="ops-empty">Aucun événement.</div>') + '</section>');
  });
}

/* ------------------------------------------------------------------ routage et actions */
function nettoyerCarte() { if (carte) { try { carte.remove(); } catch (e) {} carte = null; } if (gpsVeille != null) { try { navigator.geolocation.clearWatch(gpsVeille); } catch (e) {} gpsVeille = null; } }
function rendre() {
  nettoyerCarte();
  var p = parts();
  if (!global.ANAGROCI_AUTH) { peindre('<div class="ops-empty">Chargement de votre profil…</div>'); return Promise.resolve(); }
  if (!classe() && !(global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.estBM)) { peindre(tete('Parcelles & cartographie', '') + avis('erreur', 'Cette rubrique est réservée aux équipes AFLP (Chefs d\'Unité, assistants, Chefs de Zone, Branch Manager).')); return Promise.resolve(); }
  var r;
  switch (p[1]) {
    case 'p': r = fiche(p[2]); break;
    case 'localiser': r = localiser(p[2]); break;
    case 'tracer': r = tracer(p[2], p[3] || 'sat'); break;
    case 'ajouter': r = ajouter(p[2], p[3]); break;
    case 'validation': r = validation(); break;
    case 'valider': r = valider(p[2]); break;
    case 'pilotage': r = pilotage(); break;
    case 'journal': r = journalVue(); break;
    default: r = accueil();
  }
  return Promise.resolve(r).catch(function (e) { console.error('[PARCELLES]', e); peindre(tete('Parcelles & cartographie', '') + avis('erreur', esc(e && e.message || 'Erreur inconnue')) + lien('Retour', 'parcelles', 'secondary')); });
}
document.addEventListener('click', function (ev) {
  var b = ev.target.closest ? ev.target.closest('[data-pc]') : null;
  if (!b || !document.getElementById('opsRouteView') || !/^#parcelles/.test(location.hash)) return;
  var a = b.getAttribute('data-pc'), v = b.getAttribute('data-v'), p = parts();
  if (b.tagName === 'BUTTON') ev.preventDefault();
  if (a === 'filtre') { etat.filtre = v || null; accueil(); }
  else if (a === 'sync') { synchroniser().then(rendre); }
  else if (a === 'reessayer') { L.file.reessayer(v).then(function () { return synchroniser(); }).then(rendre); }
  else if (a === 'localiser') aller('parcelles/localiser/' + p[2]);
  else if (a === 'enregistrer-point' && ed && ed.localisation) {
    var loc = ed.localisation, o = C.operation('LOCALISER', loc, L.appareil());
    b.disabled = true;
    L.file.ajouter(o, 'Point GPS ' + Math.round(loc.precision_m) + ' m').then(function () { etat.message = 'Point enregistré sur ce téléphone. Envoi au serveur…'; return synchroniser(); })
      .then(function () { etat.liste = null; aller('parcelles/p/' + loc.plot_id); });
  }
  else if (a === 'gps-sommet') sommetGps();
  else if (a === 'annuler' && ed && ed.historique && ed.historique.length) { ed.sommets = JSON.parse(ed.historique.pop()); ed.selection = null; apresModif(); }
  else if (a === 'supprimer' && ed && ed.selection != null) { modifier(function () { ed.sommets.splice(ed.selection, 1); if (ed.sommets_gps && ed.sommets_gps.length > ed.selection) ed.sommets_gps.splice(ed.selection, 1); ed.selection = null; }); }
  else if (a === 'envoyer' && ed) { b.disabled = true; envoyer(); }
  else if (a === 'ajout-ok') validerAjout();
  else if (a === 'classer') {
    var sel = document.querySelector('[data-ano="' + v + '"]'), j = document.querySelector('[data-ano-j="' + v + '"]');
    rpc('plot_map_classer_anomalie', { p_anomalie: v, p_classification: sel && sel.value, p_justification: j && j.value }).then(function () { valider(p[2]); })
      .catch(function (e) { alerteDecision(e.message); });
  }
  else if (a === 'decider' && ed && ed.validation) {
    var com = (document.getElementById('pcComment') || {}).value || '', exc = !!(document.getElementById('pcException') || {}).checked;
    rpc('plot_map_decider', { p_geometry: ed.validation.id, p_decision: v, p_commentaire: com, p_version: ed.validation.row_version, p_exception: exc })
      .then(function () { etat.liste = null; etat.message = v === 'VALIDER' ? 'Contour validé.' : 'Correction demandée à l\'agent.'; aller('parcelles/validation'); })
      .catch(function (e) { alerteDecision(e.message); });
  }
  else if (a === 'filtrer-pilotage') {
    var fd = document.getElementById('pcFiltresPil'), f = {};
    Array.prototype.forEach.call(fd.querySelectorAll('[name]'), function (i) { if (i.value) f[i.name] = i.value; });
    etat.filtresPilotage = f; pilotage();
  }
  else if (a === 'export-csv') exporterCsv();
  else if (a === 'export-geojson') exporterGeojson().catch(function (e) { alert('Export impossible : ' + e.message); });
});
function alerteDecision(m) { var z = document.querySelector('.pc-decision'); if (z) { var x = z.querySelector('.pc-avis-erreur'); if (x) x.remove(); z.insertAdjacentHTML('afterbegin', avis('erreur', esc(m))); } }
global.addEventListener('online', function () { if (/^#parcelles/.test(location.hash)) synchroniser(true); });
function demarrer() {
  if (minuterie) return;
  minuterie = setInterval(function () { if (enLigne()) synchroniser(true); }, 120000);
  setTimeout(function () { if (enLigne()) synchroniser(true); }, 4000);
}
if (global.ANAGROCI_AUTH) demarrer(); else { var att = setInterval(function () { if (global.ANAGROCI_AUTH) { clearInterval(att); demarrer(); } }, 1000); setTimeout(function () { clearInterval(att); }, 120000); }
global.ANAGROCI_PARCELLES = { render: rendre, synchroniser: synchroniser };
})(window);

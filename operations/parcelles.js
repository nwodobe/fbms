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
var etat = { filtre: null, recherche: '', village: '', params: null, liste: null, listeLe: null, message: null, documentFiche: null };

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
function peutPreverifier() { return classe() === 'UH'; }   // Chef d'Unité : pré-vérifie le travail de ses assistants, ne décide pas
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
  /* Même règle que le serveur (correctif 11.2) : les deux fonctions sont limitées aux clusters pilotes. */
  return !!a[quoi === 'localisation' ? 'localisation' : 'contours'] && (a.clusters_pilotes || []).some(function (x) { return String(x).toUpperCase() === String(cluster || '').toUpperCase(); });
}
function seuil(nom, d) { var s = (etat.params || {}).seuils || {}; return s[nom] != null ? Number(s[nom]) : d; }
var COLS = 'plot_id,plot_code,producteur_id,producteur_code,producteur_nom,producteur_prenoms,village_id,village_nom,cluster_code,zone_code,local_name,declared_area,area_unit,tree_count,latitude,longitude,gps_accuracy_m,gps_captured_at,gps_status,mapping_status,mapped_area_ha,mapped_area_method,current_geometry_id,split_from_plot_id,consentement_gps,derniere_geometry_id,derniere_status,derniere_version,derniere_area_m2,derniere_method,derniere_le,anomalies_ouvertes,village_latitude,village_longitude';
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
      (peutValider() ? lien('À valider', 'parcelles/validation', 'secondary') : peutPreverifier() ? lien('À pré-vérifier', 'parcelles/validation', 'secondary') : '') + (peutPiloter() ? lien('Carte des parcelles', 'parcelles/pilotage', 'secondary') : '')) +
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
    enLigne() ? lire('plot_map_geometries_v', 'id,plot_id,version_no,status,method,area_m2,perimeter_m,boundary_confidence,producer_confirmation,producer_confirmation_note,auteur_nom,created_by_role,created_at,preverifie_par_nom,decide_par_nom,decided_at,decision_comment,decision_exception,geojson,imagery_source,imagery_date,gps_points,gps_accuracy_max_m,localisation_source', function (r) { return r.eq('plot_id', id).order('version_no', { ascending: false }); }).catch(function () { return null; }) : Promise.resolve(null),
    enLigne() ? lire('farmer_plot_anomalies', 'id,type,statut,bloquante,overlap_m2,detail,classification,justification,geometry_id', function (r) { return r.eq('plot_id', id); }).catch(function () { return []; }) : Promise.resolve([]),
    enLigne() ? lire('farmer_plot_ra_field_references', 'id,geometry_id,plot_id,status,accuracy_m,captured_at_client,recorded_at,created_by,note,reviewed_at,review_comment', function (r) { return r.eq('plot_id', id).order('recorded_at', { ascending: false }); }).catch(function () { return null; }) : Promise.resolve(null),
    enLigne() ? lire('plot_map_ra_preparation_v', 'geometry_id,plot_id,contour_status,references_en_attente,references_confirmees,references_rejetees,statut_preparation', function (r) { return r.eq('plot_id', id); }).catch(function () { return null; }) : Promise.resolve(null),
    enLigne() ? lire('farmer_plot_ra_units', 'plot_id,farm_id,farm_unit_id,source_reference,status,created_by,verified_at,review_comment', function (r) { return r.eq('plot_id', id).maybeSingle(); }).catch(function () { return null; }) : Promise.resolve(null),
    enLigne() ? lire('farmer_plot_ra_documents', 'id,plot_id,geometry_id,storage_path,claimed_sha256,created_at,geometry_version,farm_unit_id', function (r) { return r.eq('plot_id', id).order('created_at', { ascending: false }).limit(20); }).catch(function () { return null; }) : Promise.resolve(null)
  ]).then(function (r) {
    var x = r[1], ops = r[2], br = r[3], versions = r[4], anomalies = r[5] || [], referencesTerrain = r[6], preparations = r[7], raUnit = r[8], raDocuments = r[9];
    if (!x) {
      var ajout = ops.filter(function (o) { return o.type === 'AJOUTER_PARCELLE' && o.payload.id === id; })[0];
      if (!ajout) { peindre(tete('Parcelle introuvable', '') + avis('erreur', 'Cette parcelle n\'est pas dans votre périmètre ou n\'existe plus.') + lien('Retour aux parcelles', 'parcelles', 'secondary')); return; }
      peindre(tete(ajout.payload.local_name || 'Nouvelle parcelle', 'Parcelle créée sur ce téléphone') + avis('info', badgeEtat(ajout.etat) + ' Elle apparaîtra dans la liste après réception par le serveur.' + (ajout.message ? '<br>' + esc(ajout.message) : '')) + lien('Retour aux parcelles', 'parcelles', 'secondary'));
      return;
    }
    var st = statutParcelle(x), consent = x.consentement_gps === true, active = (versions || []).filter(function (v) { return ['SOUMIS', 'A_CORRIGER', 'VALIDE'].indexOf(v.status) >= 0; })[0];
    var geomDoc = (versions || []).filter(function (v) { return v.status === 'VALIDE' && v.geojson; })[0]
      || (versions || []).filter(function (v) { return ['SOUMIS','A_CORRIGER'].indexOf(v.status) >= 0 && v.geojson; })[0] || null;
    var preparationDoc = geomDoc && (preparations || []).filter(function(v){return v.geometry_id === geomDoc.id;})[0];
    if (geomDoc) {
      geomDoc.ra_statut_preparation = preparationDoc ? preparationDoc.statut_preparation : 'NON_VERIFIE';
      geomDoc.ra_references_confirmees = preparationDoc ? preparationDoc.references_confirmees : 0;
    }
    etat.raUnit = raUnit || null;
    etat.raDocuments = raDocuments || [];
    var documentApi = global.ANAGROCI_CARTE_PLANTATION;
    etat.documentFiche = (peutPiloter() && consent && geomDoc && documentApi
      && documentApi.eligible(x, geomDoc))
      ? { x: x, geometry: geomDoc } : null;
    var validee = (versions || []).filter(function (v) { return v.status === 'VALIDE'; })[0];
    var actions = '';
    if (peutSaisir()) {
      if (!consent) actions += avis('alerte', '<b>Consentement GPS non enregistré pour ce producteur.</b> Aucun point ni contour ne peut être envoyé sans décision explicite. Confirmez-la avec le producteur et enregistrez-la dans son passeport.') + '<p><a class="btn secondary" href="#farmers/' + encodeURIComponent(x.producteur_id) + '/consents">Ouvrir le consentement du producteur</a></p>';
      else {
        if (actif('localisation', x.cluster_code)) actions += bouton(x.latitude != null ? 'Relocaliser mon champ' : 'Localiser mon champ', 'localiser', x.latitude != null ? 'secondary' : '');
        if (actif('contours', x.cluster_code)) actions += lien(br && br.sommets && br.sommets.length ? 'Reprendre le tracé (' + br.sommets.length + ' sommets)' : 'Tracer sur la carte', 'parcelles/tracer/' + id + '/sat') + lien('Mesurer avec GPS', 'parcelles/tracer/' + id + '/gps', 'secondary') + lien('Importer un fichier', 'parcelles/tracer/' + id + '/import', 'secondary');
        else if (actif('localisation', x.cluster_code)) actions += '<p class="pc-note">Tracé des contours non activé pour le cluster ' + esc(x.cluster_code || '—') + '.</p>';
      }
      if (actif('contours', x.cluster_code)) actions += lien('Ajouter une parcelle à ce producteur', 'parcelles/ajouter/' + encodeURIComponent(x.producteur_id) + '/' + id, 'secondary');
    }
    if (etat.documentFiche) {
      actions += '<div class="pc-actions" role="group" aria-label="Documents de plantation">'
        + bouton('Carte de plantation · Imprimer / PDF', 'carte-pdf', 'secondary')
        + bouton('GeoJSON de la parcelle', 'carte-geojson', 'secondary')
        + '</div>'
        + avis('info', '<b>Documents internes Rainforest Alliance :</b> seuls les contours reçus par le serveur sont exportés. La carte est vectorielle, sans copie des tuiles Esri. Le statut de validation FBMS ne vaut pas acceptation Rainforest Alliance.');
    } else if (peutPiloter() && !consent) {
      actions += avis('info', 'Carte PDF et GeoJSON indisponibles sans consentement GPS actif.');
    }
    var raActive = (versions || []).filter(function (v) { return ['SOUMIS','VALIDE'].indexOf(v.status) >= 0; })[0] || null;
    var raPreparation = raActive && (preparations || []).find(function (v) { return v.geometry_id === raActive.id; });
    var raReferences = (referencesTerrain || []).filter(function (v) { return raActive && v.geometry_id === raActive.id; });
    etat.raGeometry = raActive && consent ? { geometry_id: raActive.id, plot_id:x.plot_id } : null;
    var raInfo = '';
    if (raActive) {
      raInfo = '<section class="card"><div class="card-head"><div><h2>Preuves terrain · Rainforest Alliance</h2>'
        + '<p>Relevés GPS proches des limites du champ, soumis puis vérifiés par la supervision. Le compteur de points déclaré dans le tracé ne constitue pas une preuve validée.</p></div></div>'
        + (raPreparation
          ? avis('info', '<b>État de préparation interne :</b> ' + esc(raPreparation.statut_preparation)
            + ' · Confirmés : ' + Number(raPreparation.references_confirmees || 0)
            + ' · En attente : ' + Number(raPreparation.references_en_attente || 0))
          : avis('alerte','Contrôle RA non disponible ou non synchronisé. Aucune conformité présumée.'))
        + (consent && peutSaisir() && enLigne()
          ? '<div class="pc-actions">' + bouton('Relever un repère GPS sur le terrain', 'ra-relever', 'secondary') + '</div>' : '')
        + (raReferences.length ? raReferences.map(function (ref) {
            var info = '<div class="pc-version"><b>Repère ' + esc(ref.id.slice(0, 8)) + '</b> · ' + esc(ref.status)
              + ' · précision ' + Number(ref.accuracy_m).toFixed(1) + ' m'
              + '<small>Capturé le ' + esc(heureFr(ref.captured_at_client))
              + (ref.note ? ' · ' + esc(ref.note) : '') + '</small>'
              + (ref.review_comment ? '<small>Observation supervision : ' + esc(ref.review_comment) + '</small>' : '');
            if (consent && peutValider() && ref.status === 'A_VERIFIER' && enLigne()) {
              info += '<div class="pc-actions"><input type="text" id="pcRaMotif_' + esc(ref.id)
                + '" maxlength="500" placeholder="Motif de contrôle / exception BM" aria-label="Motif de décision GPS">'
                + bouton('Confirmer', 'ra-decider', 'secondary',' data-v="' + esc(ref.id) + '" data-decision="CONFIRMER"')
                + bouton('Rejeter', 'ra-decider', 'secondary',' data-v="' + esc(ref.id) + '" data-decision="REJETER"')
                + '</div>';
            }
            return info + '</div>';
          }).join('') : '<p class="pc-note">Aucune référence terrain indépendante reçue par le serveur pour cette géométrie.</p>')
        + '<p class="pc-note">Deux références indépendantes confirmées sont une règle de préparation ANAGROCI, pas une certification Rainforest Alliance.</p></section>';
    }
    var raCanPrepare = enLigne() && consent && peutPiloter();
    var raReady = !!(raCanPrepare && raUnit && raUnit.status === 'VERIFIE' && etat.documentFiche
      && etat.documentFiche.geometry.status === 'VALIDE'
      && etat.documentFiche.geometry.ra_statut_preparation === 'REVUE_DOCUMENTAIRE_RA_REQUISE');
    var raDocsHTML = '<section class="card"><div class="card-head"><div><h2>Registre Rainforest Alliance · Cartes archivées</h2>'
       + '<p>Farm ID et Farm Unit ID exacts du registre officiel. Aucune création automatique d’identifiant ni transmission automatique à la plateforme RA.</p></div></div>';
    if (!consent) raDocsHTML += avis('alerte','Consentement GPS non actif : saisie et export RA suspendus.');
    else if (!enLigne()) raDocsHTML += avis('info','Connexion requise pour consulter ou actualiser le registre RA.');
    else if (!raUnit) raDocsHTML += avis('info','Aucun identifiant Rainforest Alliance saisi pour cette parcelle.');
    else raDocsHTML += avis(raUnit.status === 'VERIFIE' ? 'ok':'info',
       'Farm ID : <b>' + esc(raUnit.farm_id) + '</b> · Farm Unit ID : <b>' + esc(raUnit.farm_unit_id)
       + '</b> · Statut : <b>' + esc(raUnit.status) + '</b> · Référence : ' + esc(raUnit.source_reference));
    if (raCanPrepare && (!raUnit || raUnit.status !== 'VERIFIE')) {
       raDocsHTML += '<div class="ops-form-grid">'
         + '<label>Farm ID exact<input type="text" id="pcRaFarmId" maxlength="128" autocomplete="off" value="' + esc(raUnit&&raUnit.farm_id||'') + '"></label>'
         + '<label>Farm Unit ID exact<input type="text" id="pcRaFarmUnitId" maxlength="128" autocomplete="off" value="' + esc(raUnit&&raUnit.farm_unit_id||'') + '"></label>'
         + '<label>Référence du registre officiel<input type="text" id="pcRaSource" maxlength="300" autocomplete="off" value="' + esc(raUnit&&raUnit.source_reference||'') + '"></label>'
         + '</div><div class="pc-actions">' + bouton('Soumettre les identifiants à vérification','ra-unit-saisir','secondary') + '</div>';
       if (raUnit && raUnit.status === 'A_VERIFIER' && peutValider()) {
          raDocsHTML += '<label>Commentaire de rapprochement (12 caractères minimum)<input type="text" id="pcRaUnitComment" maxlength="500" placeholder="Référence et vérification indépendante"></label>'
           + '<div class="pc-actions">' + bouton('Vérifier les identifiants','ra-unit-verifier','secondary')
           + bouton('Rejeter les identifiants','ra-unit-rejeter','secondary') + '</div>';
       }
    }
    if (raReady) {
      raDocsHTML += '<div class="pc-actions">'
        + bouton('Export GeoJSON RA','ra-export-geojson','secondary')
        + bouton('Export KML RA','ra-export-kml','secondary')
        + (['BM','ZH'].includes(classe()) ? bouton('Archiver une carte PDF privée','ra-pdf-archiver','primary') : '')
        + '</div>' + avis('info','Préparation documentaire interne seulement. L’import réel et l’acceptation sur la plateforme Rainforest Alliance restent à confirmer.');
    } else if (consent) {
      raDocsHTML += avis('info','Export officiel bloqué tant que le Farm Unit ID, le contour validé et les preuves terrain confirmées ne sont pas réunis.');
    }
    if (raDocuments && raDocuments.length) {
      raDocsHTML += '<h3>Historique des cartes PDF archivées</h3>' + raDocuments.map(function (d) {
        return '<div class="pc-version"><b>' + esc(d.farm_unit_id) + '</b> · version géométrie ' + esc(d.geometry_version)
          + ' · ' + esc(dateFr(d.created_at)) + ' · Empreinte SHA-256 déclarée : <span class="mono">' + esc(d.claimed_sha256.slice(0,16)) + '…</span>'
          + (raCanPrepare ? '<div class="pc-actions">' + bouton('Ouvrir le PDF privé','ra-pdf-lire','secondary',' data-v="'+esc(d.id)+'"') + '</div>' : '')
          + '</div>';
      }).join('');
    }
    raDocsHTML += '</section>';
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
      '<div class="pc-grille"><div>' + point + supers + '<div class="pc-actions">' + actions + '</div></div><div id="pcMiniCarte" class="pc-carte pc-carte-mini" aria-label="Carte de la parcelle"></div></div>' + raInfo + raDocsHTML + envois + hist);
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
/* Imagerie : uniquement ce que la licence permet, configurée par le Branch Manager (plot_map_parametres.imagerie).
   - « esri » : ArcGIS Location Platform, tuiles World Imagery du Basemap Styles service, clé d'API à portée
     « basemaps » restreinte au site FBMS. Esri autorise la collecte et l'édition de données sur World Imagery.
   - « tms » : orthophoto dont ANAGROCI détient les droits, ou sous licence libre (attribution obligatoire).
   - « osm » : plan seulement (jamais présenté comme une image satellite).
   Aucune tuile n'est préchargée ni conservée pour un usage hors ligne (licences). */
var ESRI_STATIQUE = 'https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/';
var ESRI_IMAGERIE = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
var ESRI_ATTRIBUTION = 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Esri, Vantor, Earthstar Geographics, and the GIS User Community';
function couchesImagerie() {
  var im = (etat.params || {}).imagerie || {}, f = im.fournisseur || 'aucun', c = { satellite: null, plan: null, nom: null, licence: null };
  if (!global.L) return c;
  if (f === 'esri' && im.licence_confirmee && im.cle) {
    var jeton = '?token=' + encodeURIComponent(im.cle);
    /* Image : service de tuiles World Imagery du Basemap Styles service (le service « static » ne propose pas
       d'imagerie, seulement ses étiquettes : vérifié avec une vraie clé le 20/11/2026). Plan : tuiles statiques 512 px. */
    /* Niveau natif 18 : l'image Vantor 0,6 m des clusters s'arrête au niveau 18 (le 19 répond 404, vérifié à Diabo) ;
       au-delà, Leaflet agrandit la tuile du niveau 18 au lieu d'afficher du gris. */
    c.satellite = global.L.tileLayer(ESRI_IMAGERIE + '/tile/{z}/{y}/{x}' + jeton, { maxNativeZoom: 18, maxZoom: 21, attribution: ESRI_ATTRIBUTION });
    c.plan = global.L.tileLayer(ESRI_STATIQUE + 'arcgis/navigation/static/tile/{z}/{y}/{x}' + jeton, { tileSize: 512, zoomOffset: -1, maxNativeZoom: 19, maxZoom: 21, attribution: 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Esri, TomTom, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS User Community' });
    c.nom = 'Esri World Imagery (ArcGIS Location Platform)'; c.licence = 'Conditions Esri · ArcGIS Location Platform';
  } else if (f === 'tms' && im.licence_confirmee && im.url) {
    c.satellite = global.L.tileLayer(im.url, { maxNativeZoom: Number(im.zoom_max) || 20, maxZoom: 22, attribution: esc(im.attribution || '') + (im.licence ? ' · ' + esc(im.licence) : '') });
    c.nom = im.nom || 'Orthophoto sous licence'; c.licence = im.licence || null;
  }
  if (f === 'osm' || (f === 'tms' && im.plan_osm)) c.plan = global.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 21, attribution: '© contributeurs OpenStreetMap' });
  return c;
}
/* Ajoute le fond à la carte et surveille son chargement. Si l'image n'arrive pas (coupure réseau, quota, clé
   refusée), le contour reste visible et modifiable sur fond neutre : rien n'est perdu. */
function fond(map, surEtat) {
  var c = couchesImagerie();
  if (!enLigne()) return { nom: 'aucun', satellite: false, couches: c, message: 'Hors ligne : pas d\'image. Le contour reste modifiable sur fond neutre et sera envoyé au retour du réseau.' };
  var couche = c.satellite || c.plan;
  if (!couche) return { nom: 'aucun', satellite: false, couches: c, message: 'Aucune image satellite activée (licence à confirmer par le Branch Manager). Utilisez « Mesurer avec GPS » ou l\'import de fichier.' };
  couche.addTo(map); veillerTuiles(couche, surEtat);
  return { nom: c.satellite ? c.nom : 'Plan', satellite: !!c.satellite, couches: c, actuelle: c.satellite ? 'satellite' : 'plan',
    message: c.satellite ? 'Image : ' + c.nom + '. La date de prise de vue varie selon les secteurs : vérifiez sur place qu\'elle correspond au terrain.' : 'Plan, pas une image satellite : les limites des champs n\'y figurent pas.' };
}
function veillerTuiles(couche, surEtat) {
  /* Compteurs remis à zéro à chaque nouvelle vue (« loading ») : une zone ou un niveau de zoom sans image est
     signalé même si les vues précédentes s'étaient bien chargées (constaté dans Chrome réel le 20/11/2026). */
  var ok = 0, ko = 0, signale = false;
  couche.on('loading', function () { ok = 0; ko = 0; });
  couche.on('tileload', function () { ok++; if (signale && surEtat) { signale = false; surEtat('ok'); } });
  couche.on('tileerror', function () { ko++; if (!signale && ko >= 3 && ko > ok && surEtat) { signale = true; surEtat('indisponible'); } });
}
function centre(x) { return x && x.latitude != null ? [Number(x.latitude), Number(x.longitude)] : [7.69, -5.03]; }
function miniCarte(idEl, x, version) {
  var el = document.getElementById(idEl); if (!el || !global.L) { if (el) el.innerHTML = '<div class="ops-empty">Carte indisponible.</div>'; return; }
  /* La vue doit être fixée AVANT d'ajouter un contour : Leaflet ne sait pas dessiner un polygone
     sur une carte sans centre (erreur _clipPoints constatée au test navigateur du 20/11/2026). */
  var m = global.L.map(el, { zoomControl: true, attributionControl: true }); fond(m);
  var contour = version && version.geojson ? global.L.geoJSON(version.geojson, { style: { color: '#053B23', weight: 2, fillColor: '#8DC556', fillOpacity: 0.3 } }) : null;
  var b = contour ? contour.getBounds() : null;
  if (x.latitude != null) { if (b) b.extend(centre(x)); else b = global.L.latLngBounds([centre(x), centre(x)]); }
  if (b && b.isValid()) m.fitBounds(b.pad(0.4), { maxZoom: 18 }); else { m.setView(centre(x), 13); el.insertAdjacentHTML('beforeend', '<div class="pc-carte-voile">Champ non localisé</div>'); }
  if (contour) contour.addTo(m);
  if (x.latitude != null) global.L.circleMarker(centre(x), { radius: 7, color: '#fff', weight: 2, fillColor: '#1E6FD9', fillOpacity: 1 }).addTo(m).bindTooltip('Point de référence');
  setTimeout(function () { m.invalidateSize(); }, 150);
  /* Arbres suivis de l'Observatoire, quand ils ont une position : ils situent les observations,
     ils ne représentent pas toute la parcelle (aucune extrapolation). */
  if (enLigne()) lire('pheno_panels', 'id', function (r) { return r.eq('plot_id', x.plot_id); }).then(function (pa) {
    if (!pa.length) return;
    return lire('pheno_arbres', 'code,latitude,longitude,statut', function (r) { return r.in('panel_id', pa.map(function (z) { return z.id; })); }).then(function (ar) {
      var n = 0;
      ar.forEach(function (a) { if (a.latitude == null || a.statut === 'REMPLACE') return; n++; global.L.circleMarker([Number(a.latitude), Number(a.longitude)], { radius: 4, color: '#7C2D12', weight: 1, fillColor: '#EE9E00', fillOpacity: 0.9 }).addTo(m).bindTooltip('Arbre suivi ' + a.code); });
      if (n) el.insertAdjacentHTML('beforeend', '<div class="pc-carte-voile">' + n + ' arbre(s) suivi(s) par l\'Observatoire (points orange)</div>');
    });
  }).catch(function () {});
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
        (bon && x.gps_status === 'GPS_VERIFIED' ? '<label class="pc-case"><input type="checkbox" id="pcRemplacer"> Ce champ a déjà un <b>point vérifié</b>. Je confirme le remplacer : la vérification sera annulée et devra être refaite.</label>' : '') +
        '<div class="pc-actions">' + (bon ? bouton('Enregistrer ce point', 'enregistrer-point') : '') + bouton('Réessayer', 'localiser', bon ? 'secondary' : '') + '</div>');
      ed = { localisation: { plot_id: id, latitude: b.lat, longitude: b.lng, precision_m: Math.round(b.precision * 100) / 100, capture_le: l[l.length - 1].le }, pointVerifie: x.gps_status === 'GPS_VERIFIED' };
    });
  }).catch(function (e) {
    peindre(tete('Localiser mon champ', '', lien('Retour', 'parcelles/p/' + id, 'secondary')) + avis('erreur', esc(e.message)) + '<div class="pc-actions">' + bouton('Réessayer', 'localiser') + '</div>');
  });
}

/* ------------------------------------------------------------------ 3. éditeur de contour */
/* Principes : le GPS sert à RETROUVER le champ, pas à fixer ses limites ; un sommet ne s'ajoute jamais par
   accident (viseur fixe au centre de la carte, ajout au toucher désactivé par défaut) ; chaque modification est
   enregistrée sur le téléphone ; la superficie vient des coordonnées WGS84 (GeographicLib), jamais des pixels. */
function nouvelEtatEditeur(x, mode, br, active) {
  var base = active ? active.id : null;
  var e = br && br.sommets ? br : {
    sommets: active && active.geojson ? C.nettoyer(active.geojson.coordinates[0]) : [], sommets_gps: [],
    methode: mode === 'gps' ? 'GPS_POINTS' : mode === 'import' ? 'IMPORT_FICHIER' : 'SATELLITE', confiance: null, confirmation: 'NON_DEMANDEE', base_geometry_id: base,
    geometry_id: C.uuid(), identite: false,
    source: active ? 'CONTOUR_EXISTANT' : x.latitude != null ? 'POINT_EXISTANT' : null
  };
  if (!br) e.base_geometry_id = base;
  if (br && mode === 'gps' && e.methode === 'SATELLITE' && e.sommets.length) e.methode = 'MIXTE';
  if (br && mode === 'gps' && !e.sommets.length) e.methode = 'GPS_POINTS';
  e.historique = []; e.retablir = []; e.selection = null; e.mode = mode; e.x = x; e.toucher = false; e.reperes = true; e.effacer = false;
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
    var titre = mode === 'gps' ? 'Mesurer en marchant (GPS)' : mode === 'import' ? 'Importer un contour' : 'Tracer sur l\'image satellite';
    peindre('<div class="pc-ed-tete"><div><b>' + esc(titre) + '</b><span><b class="mono">' + esc(x.producteur_code || '') + '</b> ' + esc((x.producteur_nom || '') + ' ' + (x.producteur_prenoms || '')) + '</span>' +
      '<span>' + esc(x.village_nom || '') + ' · ' + esc(x.cluster_code || '') + ' · ' + esc(x.local_name || 'Parcelle') + ' · déclarée ' + (x.declared_area != null ? String(x.declared_area).replace('.', ',') + ' ha' : '—') + '</span></div>' +
      '<div class="pc-ed-droite"><span id="pcConnexion" class="pc-badge"></span>' + lien('Fermer', 'parcelles/p/' + id, 'secondary pc-mini') + '</div></div>' +
      '<div id="pcFond"><div id="pcFondImage"></div><div id="pcFondMsg"></div></div>' +
      '<div class="pc-editeur"><div class="pc-carte-zone"><div id="pcCarte" class="pc-carte pc-carte-ed" aria-label="Carte de tracé"></div>' +
      (mode === 'sat' ? '<div class="pc-viseur" aria-hidden="true"></div>' : '') + '</div>' +
      '<div class="pc-barre" id="pcBarre"></div><div class="pc-outils" id="pcOutils"></div><div class="pc-panneau" id="pcPanneau"></div></div>');
    connexion(); construireCarte(); peindreBarre(); peindrePanneau();
  });
}
function connexion() {
  var el = document.getElementById('pcConnexion'); if (!el) return;
  el.className = 'pc-badge ' + (enLigne() ? 'pc-et-recu' : 'pc-et-attente'); el.textContent = enLigne() ? 'En ligne' : 'Hors ligne';
}
global.addEventListener('online', connexion); global.addEventListener('offline', connexion);
function construireCarte() {
  if (carte) { try { carte.remove(); } catch (e) {} carte = null; }
  var el = document.getElementById('pcCarte'); if (!el) return;
  if (!global.L || !global.L.version) { el.innerHTML = '<div class="ops-empty">Bibliothèque de carte indisponible ou incomplète : vérifiez le réseau puis rouvrez cette page. Votre brouillon est conservé.</div>'; return; }   // L.version absent : bibliothèque partielle ou doublure
  carte = global.L.map(el, { zoomControl: true, maxZoom: 21, tapTolerance: 12, inertia: false });   // sans inertie : l'image s'arrête où le doigt la lâche (précision du viseur, constaté le 20/11/2026)
  var f = fond(carte, function (etatFond) {
    var z = document.getElementById('pcFondImage'); if (!z) return;
    z.innerHTML = etatFond === 'indisponible' ? avis('alerte', '<b>Image satellite indisponible ici</b> (réseau faible, zone ou niveau de zoom non couverts, service ou clé refusés). Dézoomez d\'un cran si besoin. Votre contour est conservé et reste modifiable sur fond neutre ; l\'image reviendra avec le réseau.') : avis('info', esc(ed.fondInfo || ''));
  });
  ed.fond = f.nom === 'aucun' ? null : f.nom; ed.fondInfo = f.message; ed.couches = f.couches; ed.fondActuel = f.actuelle || null;
  var zi = document.getElementById('pcFondImage'); if (zi) zi.innerHTML = avis(f.satellite ? 'info' : 'alerte', esc(f.message));
  var zf = document.getElementById('pcFondMsg');
  /* Vue initiale : contour existant > point du champ > village (avec avertissement) > Gbêkê. */
  if (ed.sommets.length >= 2) carte.fitBounds(global.L.latLngBounds(ed.sommets.map(function (s) { return [s[1], s[0]]; })).pad(0.3), { maxZoom: 19 });
  else if (ed.x.latitude != null) carte.setView(centre(ed.x), 18);
  else if (ed.x.village_latitude != null) carte.setView([Number(ed.x.village_latitude), Number(ed.x.village_longitude)], 16);
  else carte.setView(centre(ed.x), 13);
  carte._reperes = global.L.layerGroup().addTo(carte);
  if (ed.x.latitude != null) global.L.circleMarker(centre(ed.x), { radius: 6, color: '#fff', weight: 2, fillColor: '#1E6FD9', fillOpacity: 1, interactive: false }).addTo(carte._reperes).bindTooltip('Point GPS enregistré du champ');
  if (ed.x.village_latitude != null) global.L.circleMarker([Number(ed.x.village_latitude), Number(ed.x.village_longitude)], { radius: 6, color: '#fff', weight: 2, fillColor: '#7C3AED', fillOpacity: 1, interactive: false }).addTo(carte._reperes).bindTooltip('Village ' + (ed.x.village_nom || ''));
  carte._couche = global.L.layerGroup().addTo(carte);   // couches ajoutées APRÈS la vue (exigence Leaflet)
  /* Ajout au toucher : seulement si l'agent l'a activé ; Leaflet n'émet pas de « click » après un glissement de carte. */
  carte.on('click', function (ev) { if (ed.mode !== 'sat' || !ed.toucher) return; ajouterSommet([ev.latlng.lng, ev.latlng.lat]); });
  if (ed.x.latitude == null && ed.x.village_latitude != null && !ed.sommets.length) {
    ed.source = ed.source || 'VILLAGE';
    zf && zf.insertAdjacentHTML('beforeend', avis('alerte', 'Carte centrée sur le <b>village ' + esc(ed.x.village_nom || '') + '</b> (point violet). Retrouvez le champ avec le producteur, ou appuyez sur « Je suis dans mon champ » si vous y êtes. <b>La proximité du village ne prouve pas que c\'est le bon champ.</b>'));
  }
  dessiner();
  setTimeout(function () { carte && carte.invalidateSize(); }, 200);
}
function ajouterSommet(c) { modifier(function () { ed.sommets.push(c); ed.selection = ed.sommets.length - 1; }); }
function icone(cls, txt) { return global.L.divIcon({ className: 'pc-sommet ' + cls, html: '<span>' + (txt || '') + '</span>', iconSize: [30, 30], iconAnchor: [15, 15] }); }
function dessiner() {
  if (!carte) return; var g = carte._couche; g.clearLayers();
  var ll = ed.sommets.map(function (s) { return [s[1], s[0]]; });
  if (ll.length >= 3) global.L.polygon(ll, { color: '#FACC15', weight: 3, fillColor: '#8DC556', fillOpacity: 0.22, interactive: false }).addTo(g);
  else if (ll.length === 2) global.L.polyline(ll, { color: '#FACC15', weight: 3, dashArray: '6 6', interactive: false }).addTo(g);
  if (!ed.reperes) return;
  ll.forEach(function (p, i) {
    var mk = global.L.marker(p, { draggable: ed.mode !== 'gps' || ed.methode === 'MIXTE', icon: icone(i === ed.selection ? 'pc-sel' : '', i + 1), keyboard: false, title: 'Sommet ' + (i + 1) }).addTo(g);
    mk.on('click', function (ev) { global.L.DomEvent.stopPropagation(ev); ed.selection = i; dessiner(); peindreBarre(); });
    mk.on('dragstart', function () { ed.historique.push(JSON.stringify(ed.sommets)); ed.retablir = []; });
    mk.on('dragend', function (ev) { var q = ev.target.getLatLng(); ed.sommets[i] = [q.lng, q.lat]; ed.selection = i; apresModif(); });
  });
  if (ll.length >= 3 && ed.mode === 'sat') ll.forEach(function (p, i) {          // milieux : toucher pour insérer un sommet
    var n = ll[(i + 1) % ll.length], mid = [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2];
    var mk = global.L.marker(mid, { icon: icone('pc-milieu', '+'), keyboard: false, title: 'Insérer un sommet' }).addTo(g);
    mk.on('click', function (ev) { global.L.DomEvent.stopPropagation(ev); modifier(function () { ed.sommets.splice(i + 1, 0, [mid[1], mid[0]]); ed.selection = i + 1; }); });
  });
}
function modifier(fn) { ed.historique.push(JSON.stringify(ed.sommets)); if (ed.historique.length > 200) ed.historique.shift(); ed.retablir = []; ed.effacer = false; fn(); apresModif(); }
function apresModif() { sauver(); dessiner(); peindreBarre(); peindrePanneau(); }
function sauver() {
  var b = {}; ['sommets', 'sommets_gps', 'methode', 'confiance', 'confirmation', 'confirmation_note', 'base_geometry_id', 'geometry_id', 'fond', 'notes', 'op_cle', 'identite', 'source'].forEach(function (k) { b[k] = ed[k]; });
  return L.brouillon.ecrire(ed.x.plot_id, b).then(function () { ed.sauveLe = new Date().toISOString(); var s = document.getElementById('pcSauve'); if (s) s.textContent = C.ETATS.LOCAL + ' · ' + heureFr(ed.sauveLe); })
    .catch(function (e) { var s = document.getElementById('pcSauve'); if (s) s.textContent = 'ATTENTION : brouillon non enregistré (' + e.message + ')'; });
}
/* Barre compacte (mesure + commandes de tracé), fixée en bas de l'écran du téléphone pendant le tracé.
   Grille à positions FIXES : un bouton inutilisable reste à sa place, grisé. Sur l'itel S688LN (20/11/2026), la
   réorganisation des boutons après « Annuler » a fait toucher « Je suis dans mon champ » au lieu de « Rétablir ». */
function peindreBarre() {
  var p = document.getElementById('pcBarre'); if (!p || !ed) return;
  var v = C.verifier(ed.sommets, (etat.params || {}).seuils), sat = ed.mode === 'sat', sel = ed.selection != null;
  var h = '<div class="pc-mesure-barre"><div><span>Superficie calculée</span><b class="pc-surface">' + (v.sommets >= 3 ? C.hectares(v.area_m2) + ' ha' : '—') + '</b></div>' +
    '<div><span>Périmètre</span><b class="pc-perimetre">' + (v.sommets >= 2 ? C.metres(v.perimeter_m) + ' m' : '—') + '</b></div><div><span>Sommets</span><b>' + v.sommets + '</b></div></div>' +
    (v.sommets >= 3 && v.erreurs.length ? '<p class="pc-erreur">' + v.erreurs.map(esc).join('<br>') + '</p>' : '');
  h += '<div class="pc-cmd pc-cmd-grille">';
  if (sat) h += bouton('Poser un sommet au viseur', 'viseur-sommet', 'pc-cmd-principal') + bouton(sel ? 'Placer le sommet ' + (ed.selection + 1) + ' au viseur' : 'Placer le sommet au viseur', 'viseur-deplacer', 'secondary', sel ? '' : ' disabled');
  else if (ed.mode === 'gps') h += bouton('Ajouter ma position comme sommet', 'gps-sommet', 'pc-cmd-principal pc-cmd-large');
  h += bouton('↶ Annuler', 'annuler', 'secondary', ed.historique.length ? '' : ' disabled') + bouton('↷ Rétablir', 'retablir', 'secondary', ed.retablir.length ? '' : ' disabled') +
    bouton(sel ? 'Supprimer le sommet ' + (ed.selection + 1) : 'Supprimer le sommet', 'supprimer', 'secondary', sel ? '' : ' disabled') +
    bouton('Terminer le contour', 'terminer', '', v.ok ? '' : ' disabled') + '</div>';
  p.innerHTML = h;
  peindreOutils(v, sat);
}
/* Outils secondaires, sous la barre (hors zone de pouce : ils ne se déclenchent pas par erreur pendant le tracé). */
function peindreOutils(v, sat) {
  var p = document.getElementById('pcOutils'); if (!p) return;
  var coordOuvert = (function () { var c = document.getElementById('pcCoord'); return c && !c.hidden; })(), coordVal = (document.getElementById('pcCoordVal') || {}).value || '';
  var h = '<div class="pc-cmd pc-cmd-sec">' + bouton('Je suis dans mon champ', 'ici', 'secondary') + bouton('Recentrer sur le contour', 'centrer-contour', 'secondary', v.sommets >= 1 ? '' : ' disabled') +
    bouton('Aller à des coordonnées', 'coord-ouvrir', 'secondary') + bouton(ed.reperes ? 'Masquer les repères' : 'Afficher les repères', 'reperes', 'secondary') +
    (ed.couches && ed.couches.satellite && ed.couches.plan ? bouton(ed.fondActuel === 'plan' ? 'Fond satellite' : 'Fond plan', 'fond', 'secondary') : '') +
    (sat ? bouton(ed.toucher ? 'Ajout au toucher : activé' : 'Ajout au toucher : désactivé', 'toucher', 'secondary' + (ed.toucher ? ' pc-actif' : ''), ' aria-pressed="' + ed.toucher + '"') : '') +
    bouton('Enregistrer le brouillon', 'brouillon', 'secondary') +
    (ed.effacer ? bouton('Confirmer : effacer tout le tracé', 'effacer-ok', 'danger') + bouton('Garder le tracé', 'effacer-non', 'secondary') : bouton('Effacer le tracé', 'effacer', 'secondary', v.sommets ? '' : ' disabled')) + '</div>' +
    '<div id="pcCoord" class="pc-coord"' + (coordOuvert ? '' : ' hidden') + '><label class="pc-champ"><span>Coordonnées GPS en degrés décimaux (latitude, longitude)</span><input id="pcCoordVal" type="text" inputmode="decimal" placeholder="7.79512, -5.18245" value="' + esc(coordVal) + '"></label>' + bouton('Centrer la carte ici', 'coord-aller', 'secondary') + '</div>' +
    (sat ? '<p class="pc-note">Déplacez l\'image sous la croix du viseur, puis « Poser un sommet au viseur » : votre doigt ne cache jamais le point visé. Pour corriger un sommet : touchez-le, placez le viseur au bon endroit, puis « Placer le sommet au viseur » (ou faites-le glisser).</p>' : '') +
    (ed.mode === 'gps' ? '<p class="pc-note">Marchez jusqu\'à chaque coin du champ, puis appuyez sur le bouton. Le contour se ferme automatiquement.</p>' : '') +
    (ed.mode === 'import' ? '<label class="pc-champ"><span>Fichier GeoJSON ou KML (un seul contour)</span><input type="file" id="pcFichier" accept=".geojson,.json,.kml,application/geo+json,application/vnd.google-earth.kml+xml"></label>' : '');
  p.innerHTML = h;
  var fi = document.getElementById('pcFichier'); if (fi) fi.addEventListener('change', function () { importer(fi.files && fi.files[0]); });
}
var NIVEAUX = { VISIBLES: 'Niveau 1 · Limites visibles et confirmées par le producteur', PARTIELLES: 'Niveau 2 · Limites partiellement visibles (estimation à vérifier)', INCERTAINES: 'Niveau 3 · Limites incertaines', VERIFICATION_TERRAIN: 'Niveau 3 · Vérification terrain nécessaire' };
/* Finalisation : fiabilité, confirmation du producteur, identité de la parcelle, envoi. */
function peindrePanneau() {
  var p = document.getElementById('pcPanneau'); if (!p || !ed) return;
  var v = C.verifier(ed.sommets, (etat.params || {}).seuils), ecart = v.sommets >= 3 ? C.ecartDeclare(v.area_m2, ed.x.declared_area, ed.x.area_unit) : null;
  var lim = seuil('ecart_superficie_pct', 20), st = C.statsPrecision((ed.sommets_gps || []).map(function (s) { return s.precision; }));
  var conf = ed.confirmation === 'CONFIRMEE_SUR_PLACE';
  if (ed.confiance === 'VISIBLES' && !conf) ed.confiance = null;   // le niveau 1 exige la confirmation du producteur
  var pret = v.ok && ed.confiance && ed.identite;
  var h = '<div class="pc-mesure" id="pcFin"><span class="pc-etq">' + (v.sommets >= 3 ? 'Calcul provisoire sur ce téléphone (vérifié par le serveur à l\'envoi)' : 'Placez au moins 3 sommets') + '</span>' +
    '<span class="mono">' + (v.sommets >= 3 ? C.hectares(v.area_m2) + ' ha · ' + C.metres(v.area_m2) + ' m² · ' : '') + 'périmètre ' + (v.sommets >= 2 ? C.metres(v.perimeter_m) + ' m' : '—') + '</span>' +
    (ecart != null && Math.abs(ecart) > lim ? '<span class="pc-ecart">Écart de ' + (ecart > 0 ? '+' : '') + String(ecart).replace('.', ',') + ' % avec la superficie déclarée : vérifiez les limites avec le producteur.</span>' : '') +
    (st ? '<span class="pc-note">Précision GPS : ' + Math.round(st.min) + ' à ' + Math.round(st.max) + ' m (médiane ' + Math.round(st.mediane) + ' m)</span>' : '') + '</div>';
  h += '<label class="pc-champ"><span>Confirmation des limites par le producteur</span><select id="pcConfirm">' +
    [['NON_DEMANDEE', 'Non demandée'], ['CONFIRMEE_SUR_PLACE', 'Confirmée sur place par le producteur'], ['CONTESTEE', 'Contestée par le producteur'], ['PRODUCTEUR_ABSENT', 'Producteur absent']].map(function (o) {
      return '<option value="' + o[0] + '"' + (ed.confirmation === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
    '</select><small>N\'indiquez « confirmée » que si le producteur l\'a réellement dit. Aucune signature n\'est demandée ni simulée.</small></label>';
  h += '<fieldset class="pc-choix pc-niveaux"><legend>Fiabilité des limites tracées</legend>' + Object.keys(NIVEAUX).map(function (k) {
    var off = k === 'VISIBLES' && !conf;
    return '<label class="pc-puce' + (ed.confiance === k ? ' actif' : '') + (off ? ' pc-off' : '') + '"><input type="radio" name="pcConf" value="' + k + '"' + (ed.confiance === k ? ' checked' : '') + (off ? ' disabled' : '') + '> ' + esc(NIVEAUX[k]) + '</label>';
  }).join('') + (!conf ? '<small>Le niveau 1 n\'est possible qu\'après confirmation des limites par le producteur sur place.</small>' : '') + '</fieldset>';
  if (ed.confiance === 'INCERTAINES' || ed.confiance === 'VERIFICATION_TERRAIN') h += avis('alerte', '<b>Limites incertaines.</b> La superficie restera une estimation à vérifier. Si la séparation avec les champs voisins ne se voit pas sur l\'image, complétez par une mesure en marchant sur les côtés douteux (« Mesurer avec GPS »).');
  h += '<label class="pc-case pc-identite"><input type="checkbox" id="pcIdentite"' + (ed.identite ? ' checked' : '') + '> J\'ai vérifié avec le producteur que ce contour est bien celui de la parcelle « ' + esc(ed.x.local_name || 'sans nom') + ' » de <b>' + esc(ed.x.producteur_code || '') + '</b>, et non celle d\'un voisin.</label>';
  h += '<label class="pc-champ"><span>Observation (facultatif)</span><input id="pcNote" type="text" maxlength="300" value="' + esc(ed.notes || '') + '"></label>';
  h += '<p class="pc-sauve" id="pcSauve">' + (ed.sauveLe ? C.ETATS.LOCAL + ' · ' + heureFr(ed.sauveLe) : 'Brouillon enregistré automatiquement à chaque modification') + '</p>';
  h += '<div class="pc-actions pc-actions-fin">' + bouton('Envoyer au Chef de Zone', 'envoyer', '', pret ? '' : ' disabled') + '</div>';
  if (v.ok && !pret) h += '<p class="pc-note">Pour envoyer : indiquez la fiabilité des limites et confirmez l\'identité de la parcelle.</p>';
  h += '<p class="pc-note">Superficie cartographique : estimation pour le suivi AFLP calculée sur l\'ellipsoïde WGS84, <b>pas une superficie foncière certifiée</b>.</p>';
  p.innerHTML = h;
  Array.prototype.forEach.call(p.querySelectorAll('input[name=pcConf]'), function (r) { r.addEventListener('change', function () { ed.confiance = r.value; sauver(); peindrePanneau(); }); });
  var cf = document.getElementById('pcConfirm'); if (cf) cf.addEventListener('change', function () { ed.confirmation = cf.value; sauver(); peindrePanneau(); });
  var idt = document.getElementById('pcIdentite'); if (idt) idt.addEventListener('change', function () { ed.identite = idt.checked; sauver(); peindrePanneau(); });
  var nt = document.getElementById('pcNote'); if (nt) nt.addEventListener('change', function () { ed.notes = nt.value; sauver(); });
}
/* Méthode 1 : « Je suis dans mon champ ». Le GPS retrouve le champ ; il ne trace aucune limite. */
var marqueurIci = null;
function vousEtesIci() {
  var btn = document.querySelector('[data-pc="ici"]'); if (btn) { btn.disabled = true; btn.textContent = 'Recherche de votre position…'; }
  lecturesGps(10000, 4).then(function (l) {
    var b = C.combinerLectures(l); if (!b) throw new Error('Aucune position reçue : activez le GPS et réessayez à découvert.');
    if (carte) {
      if (marqueurIci) { try { carte._reperes.removeLayer(marqueurIci); } catch (e) {} }
      marqueurIci = global.L.layerGroup([global.L.circle([b.lat, b.lng], { radius: b.precision, color: '#1E6FD9', weight: 1, fillOpacity: 0.08, interactive: false }),
        global.L.circleMarker([b.lat, b.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1E6FD9', fillOpacity: 1, interactive: false }).bindTooltip('Vous êtes ici', { permanent: true, direction: 'top', className: 'pc-ici' })]).addTo(carte._reperes);
      carte.setView([b.lat, b.lng], Math.max(carte.getZoom(), 18));
    }
    if (!ed.sommets.length) ed.source = 'GPS_SUR_PLACE';
    var z = document.getElementById('pcFondMsg'); if (z) z.innerHTML = avis('ok', '<b>Vous êtes ici</b> (précision ' + Math.round(b.precision) + ' m). Agrandissez l\'image jusqu\'à voir les arbres et les limites, puis placez les sommets. Le point bleu sert à retrouver le champ, pas à fixer ses limites.');
  }).catch(function (e) { var z = document.getElementById('pcFondMsg'); if (z) z.innerHTML = avis('erreur', esc(e.message)); })
    .then(function () { peindreBarre(); });
}
/* Méthode 3 : coordonnées saisies ou collées (degrés décimaux, « lat, lon »). */
function lireCoordonnees(t) {
  var m = String(t || '').replace(/[;]/g, ',').match(/(-?\d+(?:[.,]\d+)?)\s*[, ]\s*(-?\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  var a = Number(m[1].replace(',', '.')), b = Number(m[2].replace(',', '.'));
  if (a >= 4 && a <= 11 && b >= -9 && b <= -2) return [a, b];
  if (b >= 4 && b <= 11 && a >= -9 && a <= -2) return [b, a];   // ordre longitude, latitude collé depuis un SIG
  return null;
}
function importer(f) {
  if (!f) return;
  var r = new FileReader();
  r.onload = function () {
    try {
      var t = String(r.result), s = /<kml/i.test(t) ? C.sommetsDepuisKML(t) : C.sommetsDepuisGeoJSON(JSON.parse(t));
      modifier(function () { ed.sommets = s; ed.methode = 'IMPORT_FICHIER'; ed.selection = null; ed.notes = (ed.notes ? ed.notes + ' · ' : '') + 'Import : ' + f.name; });
      if (carte && s.length >= 2) carte.fitBounds(global.L.latLngBounds(s.map(function (z) { return [z[1], z[0]]; })).pad(0.3), { maxZoom: 18 });
    } catch (e) { var z = document.getElementById('pcFondMsg'); if (z) z.insertAdjacentHTML('beforeend', avis('erreur', 'Fichier non accepté : ' + esc(e.message))); }
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
    if (b.precision > max) { var z = document.getElementById('pcFondMsg'); if (z) z.innerHTML = avis('alerte', 'Sommet ajouté avec une précision faible (' + Math.round(b.precision) + ' m). Il sera signalé au Chef de Zone. Vous pouvez le supprimer et réessayer.'); }
  }).catch(function (e) { var z = document.getElementById('pcFondMsg'); if (z) z.innerHTML = avis('erreur', esc(e.message)); peindrePanneau(); });
}
function envoyer() {
  var v = C.verifier(ed.sommets, (etat.params || {}).seuils);
  if (!v.ok || !ed.confiance || !ed.identite) return peindrePanneau();
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
  if (!peutValider() && !peutPreverifier()) { peindre(tete('À valider', '') + avis('erreur', 'Réservé au Chef de Zone, au Chef d\'Unité (pré-vérification) et au Branch Manager.')); return Promise.resolve(); }
  peindre(tete('Contours à valider', '') + '<div class="ops-empty">Chargement…</div>');
  return Promise.all([lire('plot_map_geometries_v', 'id,plot_id,cluster_code,zone_code,version_no,method,area_m2,boundary_confidence,producer_confirmation,auteur_nom,created_by_role,created_at,preverifie_par_nom,row_version', function (r) { return r.eq('status', 'SOUMIS').order('created_at'); }),
    lire('farmer_plot_anomalies', 'geometry_id,type,bloquante', function (r) { return r.eq('statut', 'OUVERTE'); }), chargerListe()]).then(function (r) {
    if (peutPreverifier()) r[0] = r[0].filter(function (g) { return g.created_by_role === 'AUH' && !g.preverifie_par_nom; });   // la lecture reste limitée au cluster par le serveur
    var anos = {}, parc = {};
    r[1].forEach(function (a) { (anos[a.geometry_id] = anos[a.geometry_id] || []).push(a); });
    r[2].forEach(function (x) { parc[x.plot_id] = x; });
    var p = profil();
    peindre(tete(peutPreverifier() ? 'Contours à pré-vérifier' : 'Contours à valider', peutPreverifier() ? 'Cluster ' + (p.cluster || 'non renseigné') + ' · tracés de vos assistants, avant la décision du Chef de Zone' : classe() === 'ZH' ? 'Zone ' + (p.zone || 'non renseignée') : 'Branch Manager · décision en exception justifiée uniquement', lien('Retour', 'parcelles', 'secondary')) +
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
      (peutPreverifier() ? '<section class="card pc-decision"><div class="card-head"><div><h2>Pré-vérification</h2></div></div>' + (g.preverifie_par_nom ? avis('info', 'Déjà pré-vérifié par ' + esc(g.preverifie_par_nom) + '.') :
        '<label class="pc-champ"><span>Observation pour le Chef de Zone (facultatif)</span><textarea id="pcComment" rows="3" maxlength="500"></textarea></label><div class="pc-actions">' + bouton('Pré-vérifier et transmettre au Chef de Zone', 'preverifier') + '</div>') +
        '<p class="pc-note">La pré-vérification ne valide pas : seul le Chef de Zone décide. Une correction se demande au Chef de Zone.</p></section>' :
      '<section class="card pc-decision"><div class="card-head"><div><h2>Décision</h2></div></div>' +
      (bloq.length ? avis('alerte', 'Validation impossible tant que les anomalies bloquantes ne sont pas classées.') : '') +
      '<label class="pc-champ"><span>Commentaire (obligatoire pour une correction)</span><textarea id="pcComment" rows="3" maxlength="500"></textarea></label>' +
      (bm ? '<label class="pc-case"><input type="checkbox" id="pcException"> Décision exceptionnelle du Branch Manager (justification d\'au moins 15 caractères, journalisée)</label>' : '') +
      '<div class="pc-actions">' + bouton('Valider le contour', 'decider', '', (bloq.length ? ' disabled' : '') + ' data-v="VALIDER"') + bouton('Demander une correction', 'decider', 'secondary', ' data-v="A_CORRIGER"') + '</div>' +
      '<p class="pc-note">Valider confirme le contour pour le suivi AFLP : ce n\'est pas une certification topographique.</p></section>') +
      '</div><div id="pcCarteVal" class="pc-carte pc-carte-mini" aria-label="Carte du contour et des parcelles voisines"></div></div>';
    peindre(h);
    ed = { validation: g };
    var el = document.getElementById('pcCarteVal');
    if (el && global.L) {
      var m = global.L.map(el); fond(m);
      var p = global.L.geoJSON(g.geojson, { style: { color: '#053B23', weight: 2, fillColor: '#8DC556', fillOpacity: 0.35 } });
      m.fitBounds(p.getBounds().pad(0.4), { maxZoom: 18 }); p.addTo(m);   // vue d'abord, contour ensuite
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
  return parametres().then(function () { return rpc('plot_map_tableau', { p: Object.assign({ detail: 'oui' }, f) }); }).then(function (t) {
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
      '</tbody></table></div></section>' + panneauActivation();
    peindre(h);
  }).catch(function (e) { peindre(tete('Carte des parcelles', '', lien('Retour', 'parcelles', 'secondary')) + avis('erreur', esc(e.message))); });
}
/* Activation progressive (indicateurs de fonctionnalité) : Branch Manager uniquement, contrôlé par le serveur
   (plot_map_parametre_definir). Couper = décocher : les contours reçus restent, le registre n'est pas touché. */
function panneauActivation() {
  if (classe() !== 'BM') return '';
  var a = (etat.params || {}).activation || {}, pil = a.clusters_pilotes || [], im = (etat.params || {}).imagerie || {}, f = im.fournisseur || 'aucun';
  function opt(v, l) { return '<option value="' + v + '"' + (f === v ? ' selected' : '') + '>' + l + '</option>'; }
  return '<section class="card pc-decision" id="pcActivation"><div class="card-head"><div><h2>Activation (Branch Manager)</h2></div></div>' +
    '<label class="pc-case"><input type="checkbox" id="pcActLoc"' + (a.localisation ? ' checked' : '') + '> Localiser mon champ</label>' +
    '<label class="pc-case"><input type="checkbox" id="pcActCont"' + (a.contours ? ' checked' : '') + '> Tracé des contours</label>' +
    '<fieldset class="pc-choix"><legend>Clusters pilotes (les deux fonctions ne s\'ouvrent que dans ces clusters)</legend>' + ['BEOUMI', 'BOTRO', 'BROBO', 'DIABO', 'DJEBONOUA', 'SAKASSOU'].map(function (c) {
      return '<label class="pc-puce' + (pil.indexOf(c) >= 0 ? ' actif' : '') + '"><input type="checkbox" name="pcActCl" value="' + c + '"' + (pil.indexOf(c) >= 0 ? ' checked' : '') + '> ' + c + '</label>'; }).join('') + '</fieldset>' +
    '<div class="pc-actions">' + bouton('Enregistrer l\'activation', 'activer') + '</div>' +
    '<h3>Image satellite</h3>' +
    '<label class="pc-champ"><span>Fournisseur</span><select id="pcImF">' + opt('aucun', 'Aucune image') + opt('esri', 'Esri World Imagery (ArcGIS Location Platform)') + opt('tms', 'Orthophoto sous licence (adresse TMS)') + opt('osm', 'Plan OpenStreetMap (pas une image)') + '</select></label>' +
    '<label class="pc-champ"><span>Clé d\'API Esri (portée « basemaps », restreinte au site FBMS)</span><input id="pcImCle" type="password" autocomplete="off" placeholder="' + (im.cle ? 'Clé enregistrée (…' + esc(String(im.cle).slice(-4)) + ') : laisser vide pour la garder' : 'AAPT…') + '"></label>' +
    '<label class="pc-champ"><span>Orthophoto : adresse https avec {z}/{x}/{y}</span><input id="pcImUrl" type="url" value="' + esc(im.url || '') + '"></label>' +
    '<label class="pc-champ"><span>Orthophoto : attribution et licence</span><input id="pcImAttr" type="text" value="' + esc(im.attribution || '') + '" placeholder="Attribution"><input id="pcImLic" type="text" value="' + esc(im.licence || '') + '" placeholder="Licence (ex. droits ANAGROCI, CC BY 4.0)"></label>' +
    '<label class="pc-case"><input type="checkbox" id="pcImLicOk"' + (im.licence_confirmee ? ' checked' : '') + '> Je confirme qu\'ANAGROCI dispose des droits d\'utilisation de cette image, y compris le tracé des limites (conditions du fournisseur acceptées).</label>' +
    '<div class="pc-actions">' + bouton('Enregistrer l\'image satellite', 'imagerie') + '</div>' +
    '<p class="pc-note">Actuellement : ' + esc(f === 'aucun' ? 'aucune image' : f) + (im.licence_confirmee ? ' (licence confirmée)' : '') + '. Aucune tuile n\'est conservée sur les téléphones. Commencez par un seul cluster.</p></section>';
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
/* Lien direct ou rechargement sur #parcelles : la rubrique peut s'afficher avant la fin de l'authentification.
   On réaffiche dès que le profil est prêt (constaté en production le 20/11/2026 : écran bloqué sur « Chargement de votre profil »). */
var attenteProfil = null;
function attendreProfil() {
  if (attenteProfil) return;
  var debut = Date.now();
  attenteProfil = setInterval(function () {
    if (global.ANAGROCI_AUTH || Date.now() - debut > 120000) { clearInterval(attenteProfil); attenteProfil = null; if (global.ANAGROCI_AUTH && /^#parcelles/.test(location.hash)) rendre(); }
  }, 500);
}
document.addEventListener('anagroci:authenticated', function () { if (/^#parcelles/.test(location.hash)) rendre(); });
function rendre() {
  nettoyerCarte();
  var p = parts();
  if (!global.ANAGROCI_AUTH) { peindre('<div class="ops-empty">Chargement de votre profil…</div>'); attendreProfil(); return Promise.resolve(); }
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
  if (['ra-unit-saisir','ra-unit-verifier','ra-unit-rejeter',
    'ra-export-geojson','ra-export-kml','ra-pdf-archiver','ra-pdf-lire'].indexOf(a)>=0) {
    if (!enLigne() || !peutPiloter() || !p[2] || p[2] !== (etat.documentFiche && etat.documentFiche.x.plot_id ||
        (etat.raGeometry && etat.raGeometry.plot_id))) {
      alert('Fiche ou autorisation indisponible. Rechargez la parcelle avec une connexion active.'); return;
    }
    var unit=etat.raUnit;
    var d=etat.documentFiche;
    var engine=global.ANAGROCI_RA_LOT3;
    if (a === 'ra-unit-saisir') {
      var fid=((document.getElementById('pcRaFarmId')||{}).value||'');
      var uid=((document.getElementById('pcRaFarmUnitId')||{}).value||'');
      var src=((document.getElementById('pcRaSource')||{}).value||'');
      if (!fid || !uid || !src) { alert('Tous les identifiants et la référence du registre RA sont obligatoires.');return; }
      b.disabled=true;
      rpc('plot_map_ra_unite_saisir',{
        p_plot:p[2],p_farm_id:fid,p_farm_unit_id:uid,p_source_reference:src
      }).then(function(){return fiche(p[2]);}).catch(function(e){b.disabled=false;alert('Saisie RA refusée : '+e.message);});
      return;
    }
    if (a==='ra-unit-verifier' || a==='ra-unit-rejeter') {
      if (!peutValider() || !unit || unit.status!=='A_VERIFIER') {
        alert('Contrôle indépendant indisponible.');return;
      }
      var comment=((document.getElementById('pcRaUnitComment')||{}).value||'').trim();
      if(comment.length<12){alert('Référence de rapprochement obligatoire (12 caractères minimum).');return;}
      b.disabled=true;
      rpc('plot_map_ra_unite_verifier',{
        p_plot:p[2],p_decision:a==='ra-unit-verifier'?'VERIFIER':'REJETER',p_commentaire:comment
      }).then(function(){return fiche(p[2]);}).catch(function(e){b.disabled=false;alert('Vérification RA refusée : '+e.message);});
      return;
    }
    if (a==='ra-pdf-lire') {
      var item=(etat.raDocuments||[]).find(function(q){return q.id===v;});
      if(!item || !engine){alert('Document privé indisponible.');return;}
      b.disabled=true;
      client().then(function(cl){
        return engine.urlPrivee(cl,item.storage_path);
      }).then(function(url){ global.open(url,'_blank','noopener,noreferrer');b.disabled=false; })
        .catch(function(e){b.disabled=false;alert('Lecture privée refusée : '+e.message);});
      return;
    }
    if(!d || !unit || !engine || !d.x.consentement_gps
       || unit.status!=='VERIFIE' || d.geometry.status!=='VALIDE'
       || d.geometry.ra_statut_preparation!=='REVUE_DOCUMENTAIRE_RA_REQUISE') {
      alert('Dossier RA incomplet. Aucun export RA possible.');return;
    }
    if (a==='ra-export-geojson'||a==='ra-export-kml') {
      try{engine.exporter(d.x,d.geometry,unit,a==='ra-export-kml'?'kml':'geojson');}
      catch(e){alert('Export RA refusé : '+e.message);}return;
    }
    if(a==='ra-pdf-archiver'){
      b.disabled=true;
      client().then(function(cl){return engine.archive(d.x,d.geometry,unit,cl,C.uuid);})
        .then(function(){return fiche(p[2]);})
        .catch(function(e){b.disabled=false;alert('Archivage PDF non confirmé : '+e.message);});
      return;
    }
  }
  if (a === 'ra-relever' || a === 'ra-decider') {
    if (!enLigne() || !etat.raGeometry || p[2] !== etat.raGeometry.plot_id) {
      alert('Fiche ou connexion indisponible : rechargez la parcelle.'); return;
    }
    var raContext = etat.raGeometry;
    if (a === 'ra-relever') {
      if (!peutSaisir() || !navigator.geolocation) { alert('Droit terrain ou GPS indisponible.'); return; }
      b.disabled = true;
      navigator.geolocation.getCurrentPosition(function (position) {
        var gps = position.coords;
        var payload = {
          id:C.uuid(), geometry_id:raContext.geometry_id,
          latitude:gps.latitude, longitude:gps.longitude,
          accuracy_m:gps.accuracy,
          captured_at_client:new Date(position.timestamp).toISOString()
        };
        rpc('plot_map_ra_ref_ajouter', { p:payload })
          .then(function () { etat.liste = null; return fiche(raContext.plot_id); })
          .catch(function(e) { b.disabled = false; alert('Repère GPS NON enregistré : '+e.message); });
      }, function(e) { b.disabled = false; alert('GPS non acquis : '+e.message); },
      {enableHighAccuracy:true, timeout:25000, maximumAge:0});
    } else {
      if (!peutValider()) { alert('Validation réservée au Chef de Zone ou au Branch Manager en exception.'); return; }
      var decision = b.getAttribute('data-decision');
      if (decision !== 'CONFIRMER' && decision !== 'REJETER') return;
      var texte = ((document.getElementById('pcRaMotif_' + v) || {}).value || '').trim();
      var exception = classe() === 'BM';
      if (exception && texte.length < 15) { alert('Exception BM : justifiez en 15 caractères minimum.'); return; }
      if (decision === 'REJETER' && texte.length < 8) { alert('Expliquez le rejet en 8 caractères minimum.'); return; }
      b.disabled = true;
      rpc('plot_map_ra_ref_decider', {
        p_reference:v, p_decision:decision, p_commentaire:texte || null, p_exception:exception
      }).then(function () { etat.liste = null; return fiche(raContext.plot_id); })
        .catch(function(e) { b.disabled = false; alert('Décision non enregistrée : '+e.message); });
    }
    return;
  }
  if (a === 'carte-pdf' || a === 'carte-geojson') {
    try {
      if (!peutPiloter() || !etat.documentFiche || parts()[2] !== etat.documentFiche.x.plot_id)
        throw new Error('Document inaccessible ou fiche de parcelle périmée.');
      var d = etat.documentFiche;
      if (a === 'carte-pdf') global.ANAGROCI_CARTE_PLANTATION.imprimer(d.x, d.geometry);
      else global.ANAGROCI_CARTE_PLANTATION.telechargerGeojson(d.x, d.geometry);
    } catch (e) { alert('Export cartographique refusé : ' + (e.message || e)); }
    return;
  }
  if (a === 'filtre') { etat.filtre = v || null; accueil(); }
  else if (a === 'sync') { synchroniser().then(rendre); }
  else if (a === 'reessayer') { L.file.reessayer(v).then(function () { return synchroniser(); }).then(rendre); }
  else if (a === 'localiser') aller('parcelles/localiser/' + p[2]);
  else if (a === 'enregistrer-point' && ed && ed.localisation) {
    if (ed.pointVerifie) { var rc = document.getElementById('pcRemplacer'); if (!rc || !rc.checked) { if (rc) rc.parentNode.classList.add('pc-requis'); return; } ed.localisation.remplacer_point_verifie = true; }
    var loc = ed.localisation, o = C.operation('LOCALISER', loc, L.appareil());
    b.disabled = true;
    L.file.ajouter(o, 'Point GPS ' + Math.round(loc.precision_m) + ' m').then(function () { etat.message = 'Point enregistré sur ce téléphone. Envoi au serveur…'; return synchroniser(); })
      .then(function () { etat.liste = null; aller('parcelles/p/' + loc.plot_id); });
  }
  else if (a === 'gps-sommet') sommetGps();
  else if (a === 'annuler' && ed && ed.historique && ed.historique.length) { ed.retablir.push(JSON.stringify(ed.sommets)); ed.sommets = JSON.parse(ed.historique.pop()); ed.selection = null; apresModif(); }
  else if (a === 'retablir' && ed && ed.retablir && ed.retablir.length) { ed.historique.push(JSON.stringify(ed.sommets)); ed.sommets = JSON.parse(ed.retablir.pop()); ed.selection = null; apresModif(); }
  else if (a === 'viseur-sommet' && ed && carte) { var c0 = carte.getCenter(); ajouterSommet([c0.lng, c0.lat]); }
  else if (a === 'viseur-deplacer' && ed && carte && ed.selection != null) { var c1 = carte.getCenter(), i1 = ed.selection; modifier(function () { ed.sommets[i1] = [c1.lng, c1.lat]; ed.selection = i1; }); }
  else if (a === 'ici' && ed) vousEtesIci();
  else if (a === 'centrer-contour' && ed && carte && ed.sommets.length) { if (ed.sommets.length === 1) carte.setView([ed.sommets[0][1], ed.sommets[0][0]], Math.max(carte.getZoom(), 18)); else carte.fitBounds(global.L.latLngBounds(ed.sommets.map(function (z) { return [z[1], z[0]]; })).pad(0.25), { maxZoom: 20 }); }
  else if (a === 'coord-ouvrir') { var zc = document.getElementById('pcCoord'); if (zc) { zc.hidden = !zc.hidden; var iv = document.getElementById('pcCoordVal'); if (iv && !zc.hidden) iv.focus(); } }
  else if (a === 'coord-aller' && ed && carte) {
    var cc = lireCoordonnees((document.getElementById('pcCoordVal') || {}).value), zf = document.getElementById('pcFondMsg');
    if (!cc) { if (zf) zf.innerHTML = avis('erreur', 'Coordonnées illisibles ou hors de Côte d\'Ivoire. Exemple : 7.79512, -5.18245'); }
    else { carte.setView(cc, 18); global.L.circleMarker(cc, { radius: 7, color: '#fff', weight: 2, fillColor: '#DC2626', fillOpacity: 1, interactive: false }).addTo(carte._reperes).bindTooltip('Coordonnées saisies');
      if (!ed.sommets.length) ed.source = 'COORDONNEES';
      if (zf) zf.innerHTML = avis('info', 'Carte centrée sur les coordonnées saisies (point rouge). Vérifiez avec le producteur que c\'est bien son champ avant de tracer.'); }
  }
  else if (a === 'reperes' && ed) { ed.reperes = !ed.reperes; dessiner(); peindreBarre(); }
  else if (a === 'toucher' && ed) { ed.toucher = !ed.toucher; peindreBarre(); }
  else if (a === 'fond' && ed && carte && ed.couches) {
    var vers = ed.fondActuel === 'plan' ? 'satellite' : 'plan', avant = ed.couches[ed.fondActuel], apres = ed.couches[vers];
    if (apres) { if (avant) carte.removeLayer(avant); apres.addTo(carte); ed.fondActuel = vers; peindreBarre(); }
  }
  else if (a === 'brouillon' && ed) { sauver().then(function () { var zb = document.getElementById('pcFondMsg'); if (zb) zb.innerHTML = avis('ok', 'Brouillon enregistré sur ce téléphone (' + ed.sommets.length + ' sommet(s)).'); }); }
  else if (a === 'effacer' && ed) { ed.effacer = true; peindreBarre(); }
  else if (a === 'effacer-non' && ed) { ed.effacer = false; peindreBarre(); }
  else if (a === 'effacer-ok' && ed) { modifier(function () { ed.sommets = []; ed.sommets_gps = []; ed.selection = null; }); }
  else if (a === 'terminer' && ed) { var fin = document.getElementById('pcPanneau'); if (fin) fin.scrollIntoView({ behavior: 'smooth', block: 'start' }); var zt = document.getElementById('pcFondMsg'); if (zt) zt.innerHTML = avis('ok', 'Contour terminé : vérifiez-le avec le producteur, indiquez la fiabilité des limites puis envoyez.'); }
  else if (a === 'supprimer' && ed && ed.selection != null) { modifier(function () { ed.sommets.splice(ed.selection, 1); if (ed.sommets_gps && ed.sommets_gps.length > ed.selection) ed.sommets_gps.splice(ed.selection, 1); ed.selection = null; }); }
  else if (a === 'envoyer' && ed) { b.disabled = true; envoyer(); }
  else if (a === 'ajout-ok') validerAjout();
  else if (a === 'classer') {
    var sel = document.querySelector('[data-ano="' + v + '"]'), j = document.querySelector('[data-ano-j="' + v + '"]');
    rpc('plot_map_classer_anomalie', { p_anomalie: v, p_classification: sel && sel.value, p_justification: j && j.value }).then(function () { valider(p[2]); })
      .catch(function (e) { alerteDecision(e.message); });
  }
  else if (a === 'preverifier' && ed && ed.validation) {
    b.disabled = true;
    rpc('plot_map_preverifier', { p_geometry: ed.validation.id, p_note: (document.getElementById('pcComment') || {}).value || null })
      .then(function () { etat.message = 'Contour pré-vérifié : transmis au Chef de Zone.'; aller('parcelles/validation'); })
      .catch(function (e) { b.disabled = false; alerteDecision(e.message); });
  }
  else if (a === 'decider' && ed && ed.validation) {
    var com = (document.getElementById('pcComment') || {}).value || '', exc = !!(document.getElementById('pcException') || {}).checked;
    rpc('plot_map_decider', { p_geometry: ed.validation.id, p_decision: v, p_commentaire: com, p_version: ed.validation.row_version, p_exception: exc })
      .then(function () { etat.liste = null; etat.message = v === 'VALIDER' ? 'Contour validé.' : 'Correction demandée à l\'agent.'; aller('parcelles/validation'); })
      .catch(function (e) { alerteDecision(e.message); });
  }
  else if (a === 'activer') {
    var obj = { localisation: !!(document.getElementById('pcActLoc') || {}).checked, contours: !!(document.getElementById('pcActCont') || {}).checked,
      clusters_pilotes: Array.prototype.map.call(document.querySelectorAll('input[name=pcActCl]:checked'), function (i) { return i.value; }) };
    if (obj.contours && !obj.clusters_pilotes.length) { alerteDecision('Choisissez au moins un cluster pilote pour le tracé des contours.'); return; }
    b.disabled = true;
    rpc('plot_map_parametre_definir', { p_cle: 'activation', p_valeur: obj }).then(function () { etat.params = null; return parametres(); })
      .then(function () { etat.message = 'Activation enregistrée.'; pilotage(); }).catch(function (e) { b.disabled = false; alerteDecision(e.message); });
  }
  else if (a === 'imagerie') {
    var im0 = (etat.params || {}).imagerie || {}, fv = (document.getElementById('pcImF') || {}).value || 'aucun', cle = ((document.getElementById('pcImCle') || {}).value || '').trim();
    var ob = { fournisseur: fv, licence_confirmee: !!(document.getElementById('pcImLicOk') || {}).checked };
    if (fv === 'esri') ob.cle = cle || im0.cle || '';
    if (fv === 'tms') { ob.url = ((document.getElementById('pcImUrl') || {}).value || '').trim(); ob.attribution = ((document.getElementById('pcImAttr') || {}).value || '').trim(); ob.licence = ((document.getElementById('pcImLic') || {}).value || '').trim(); }
    b.disabled = true;
    rpc('plot_map_parametre_definir', { p_cle: 'imagerie', p_valeur: ob }).then(function () { etat.params = null; return parametres(); })
      .then(function () { etat.message = 'Image satellite enregistrée.'; pilotage(); }).catch(function (e) { b.disabled = false; alerteDecision(e.message); });
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

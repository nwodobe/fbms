/* FIELD BUYING · Observatoire agronomique AFLP 2027 (PILOTE)
   --------------------------------------------------------------------------------
   Une seule donnée agronomique, deux usages :
     · terrain (Assistant Unit Head, Unit Head) : installer un champ, tirer blocs et
       arbres, visiter chaque semaine les mêmes arbres marqués, envoyer ;
     · pilotage (Unit Head, Zonal Head, Assistant Branch Manager, Branch Manager) :
       vérifier, demander une correction, valider, suivre la qualité.
   Collecte pilote (spécification V2.1, E2.4) : aucun indicateur officiel, aucune
   prévision, aucun tonnage. Le RT n'a aucun accès à ce module.
   Règles d'écran :
     · aucune réponse n'est préremplie ;
     · « Enregistré sur ce téléphone » ≠ « Envoyé et reçu par le serveur » ;
     · les droits affichés sont indicatifs : le serveur décide (RLS + RPC).
   Routes : #observatoire · /installer · /champ/<id> · /visite/<panel>/<visite> ·
            /envois · /validation[/<visite>] · /qualite · /affectations
   Dépend de ANAGROCI_OBS_COEUR et ANAGROCI_OBS_LOCAL. Aucune écriture hors RPC pheno_*. */
(function (global) {
'use strict';
var C = global.ANAGROCI_OBS_COEUR, L = global.ANAGROCI_OBS_LOCAL;
var sb = null, clientPromise = null, minuterie = null, brouillon = null, etat = { idx: 0, message: null };

/* ------------------------------------------------------------------ utilitaires */
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function root() { return document.getElementById('opsRouteView'); }
function parts() { return (location.hash || '#observatoire').slice(1).split('/').map(decodeURIComponent); }
function aller(h) { if (location.hash === '#' + h) rendre(); else location.hash = h; }
function enLigne() { return navigator.onLine !== false; }
function dateFr(d) { if (!d) return '—'; var x = String(d).slice(0, 10).split('-'); return x.length === 3 ? x[2] + '/' + x[1] + '/' + x[0] : d; }
function heureFr(d) { if (!d) return '—'; try { var t = new Date(d); return dateFr(t.toISOString()) + ' ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); } catch (e) { return d; } }
/* S17 · Un réseau qui revient « à moitié » laissait une requête suspendue plusieurs minutes,
   et toute la file attendait derrière elle. Chaque appel est borné : passé le délai, il échoue
   comme une coupure et sera repris (même clé d'idempotence, donc sans doublon). */
function fetchBorne(url, opts) {
  opts = opts || {};
  var long = /\/storage\/v1\/object\//.test(String(url)), ms = long ? 90000 : 25000;
  if (typeof AbortController === 'undefined') return fetch(url, opts);
  var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, ms);
  if (opts.signal) { try { opts.signal.addEventListener('abort', function () { ac.abort(); }); } catch (e) {} }
  var o = {}; for (var k in opts) o[k] = opts[k]; o.signal = ac.signal;
  return fetch(url, o).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw new Error('timeout ou réseau indisponible (' + (e && e.message || 'fetch') + ')'); });
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
function rpc(nom, args) { return client().then(function (c) { if (!c) throw new Error('Connexion aux données indisponible.'); return c.rpc(nom, args || {}); }).then(function (x) { if (x.error) throw new Error(x.error.message); return x.data; }); }
function lireTable(nom, cols, mod) { return client().then(function (c) { if (!c) throw new Error('Connexion aux données indisponible.'); var r = c.from(nom).select(cols || '*'); if (mod) r = mod(r); return r; }).then(function (x) { if (x.error) throw new Error(x.error.message); return x.data || []; }); }
function profil() { return (global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile) || {}; }
function classe() { return { 'Branch Manager': 'BM', 'Assistant Branch Manager': 'ABM', 'Zonal Head': 'ZH', 'Unit Head': 'UH', 'Assistant Unit Head': 'AUH' }[profil().role] || null; }
function peutCollecter() { return ['BM', 'UH', 'AUH'].indexOf(classe()) >= 0; }
function peutPiloter() { return ['BM', 'ABM', 'ZH', 'UH'].indexOf(classe()) >= 0; }
function campagne() { var c = global.ANAGROCI_CAMPAIGN; return c && c.id() ? { id: c.id(), code: c.code(), ouverte: c.isOpen() } : null; }
function peindre(html) { var r = root(); if (r) { r.setAttribute('data-i18n-ignore', '1'); r.innerHTML = '<div class="obs">' + html + '</div>'; } }
function badge(txt, ton) { return '<span class="badge ' + (ton || '') + '">' + esc(txt) + '</span>'; }
function tonStatut(s) { return { VALIDE: 'ok', SOUMIS: 'info', EN_VERIFICATION: 'info', CORRECTION_DEMANDEE: 'warn', BROUILLON: '', LOCAL: '', ACTIF: 'ok', INCOMPATIBLE: 'danger', TIRAGE_VERROUILLE: 'warn' }[s] || ''; }
function note(txt, ton) { return '<div class="notice ' + (ton || 'info') + '"><span>' + txt + '</span></div>'; }

/* Dialogue intégré à la page (aucune boîte de dialogue du navigateur). */
function dialogue(titre, corps, boutons) {
  return new Promise(function (ok) {
    var h = document.createElement('div'); h.className = 'obs-voile'; h.setAttribute('data-i18n-ignore', '1');
    h.innerHTML = '<div class="obs-dialogue" role="dialog" aria-modal="true"><h3>' + esc(titre) + '</h3><div class="obs-dialogue-corps">' + corps + '</div><div class="obs-dialogue-actions">' +
      boutons.map(function (b, i) { return '<button type="button" class="btn ' + (b[2] || 'secondary') + '" data-i="' + i + '">' + esc(b[0]) + '</button>'; }).join('') + '</div></div>';
    document.body.appendChild(h);
    h.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]'); if (!b) return;
      var v = boutons[+b.getAttribute('data-i')][1], champ = h.querySelector('[data-champ]');
      if (v && champ && !String(champ.value).trim()) { champ.classList.add('obs-erreur'); champ.focus(); return; }
      var ef = h.querySelector('[data-effet]'); etat.dialogueEffet = ef ? ef.value : null;
      document.body.removeChild(h); ok(v ? (champ ? String(champ.value).trim() : true) : null);
    });
  });
}
function confirmer(titre, texte, libelle) { return dialogue(titre, '<p>' + texte + '</p>', [['Annuler', false], [libelle || 'Confirmer', true, 'primary']]); }
function demanderMotif(titre, texte) { return dialogue(titre, '<p>' + texte + '</p><textarea data-champ rows="3" class="obs-zone" placeholder="Motif (obligatoire)"></textarea>', [['Annuler', false], ['Enregistrer', true, 'primary']]); }

/* ------------------------------------------------------------------ cadre commun */
function onglets(actif) {
  var t = [];
  if (peutCollecter()) t.push(['', 'Mes champs'], ['envois', 'Envois']);
  if (peutPiloter()) t.push(['validation', 'Validation'], ['qualite', 'Tableau de bord']);
  if (classe() === 'BM') t.push(['affectations', 'Affectations']);
  return '<nav class="obs-onglets">' + t.map(function (x) { return '<a class="' + (x[0] === actif ? 'actif' : '') + '" href="#observatoire' + (x[0] ? '/' + x[0] : '') + '">' + esc(x[1]) + '</a>'; }).join('') + '</nav>';
}
function entete(sous, actif, actions) {
  return '<div class="ops-route-head"><div><h1>Observatoire agronomique</h1><p>' + esc(sous) + '</p></div><div class="ops-route-actions">' + (actions || '') + '</div></div>' +
    '<div class="obs-bandeau"><b>Collecte pilote</b> · protocole ' + esc(C.PROTOCOLE) + ' · aucun indicateur officiel, aucune prévision</div>' + onglets(actif) + '<div id="obsEnvoi"></div>';
}
function barreEnvoi() {
  var h = document.getElementById('obsEnvoi'); if (!h || !peutCollecter()) return;
  Promise.all([L.compter(), L.espace()]).then(function (r) {
    if (!document.getElementById('obsEnvoi')) return;
    var n = r[0], e = r[1], ops = n.attente + n.echec_reseau, txt = [];
    if (ops) txt.push('<b>' + ops + ' envoi' + (ops > 1 ? 's' : '') + ' en attente</b>');
    if (n.photos_attente) txt.push('<b>' + n.photos_attente + ' photo' + (n.photos_attente > 1 ? 's' : '') + ' à envoyer</b>' + (n.photos_echec ? ' (' + n.photos_echec + ' en échec, nouvel essai automatique)' : ''));
    if (n.refus) txt.push('<b>' + n.refus + ' refus ou conflit</b> à voir dans « Envois »');
    var place = e && e.libre != null && e.libre < 80 * 1024 * 1024 ? '<div class="obs-envoi attente"><span><b>Mémoire du téléphone presque pleine</b> (' + Math.max(0, Math.round(e.libre / 1048576)) + ' Mo libres). Envoyez vos données avant de prendre d’autres photos.</span></div>' : '';
    h.innerHTML = place + (txt.length
      ? '<div class="obs-envoi attente"><span>' + txt.join(' · ') + '. Enregistré sur ce téléphone, pas encore reçu par FBMS.</span><button type="button" class="btn primary" data-act="sync">Envoyer maintenant</button></div>'
      : '');
  }).catch(function () {});
}
function synchroniser(manuel) {
  return client().then(function (c) {
    if (!c || !enLigne()) { if (manuel) etat.message = ['warn', 'Pas de réseau. Vos saisies restent enregistrées sur ce téléphone et seront envoyées dès que possible.']; return null; }
    return L.synchroniser(c).then(function (b) {
      if (manuel || b.envoyees || b.photos_envoyees) {
        var ph = b.photos_envoyees ? ' ' + b.photos_envoyees + ' photo(s) reçue(s) par FBMS.' : '';
        var att = b.en_attente_photos ? ' ' + b.en_attente_photos + ' visite(s) attendent encore leurs photos.' : '';
        etat.message = b.reseau ? ['warn', 'Le serveur n’a pas répondu. Vos saisies restent sur ce téléphone ; un nouvel essai sera fait automatiquement.' + ph]
          : b.conflits || b.refusees ? ['warn', b.recues + ' reçu(s) par FBMS, ' + b.conflits + ' conflit(s), ' + b.refusees + ' refus. Ouvrez « Envois » pour le détail.' + ph]
          : b.envoyees || b.photos_envoyees ? ['ok', b.recues + ' envoi(s) reçu(s) par FBMS.' + ph + att] : ['info', 'Rien à envoyer.' + att];
      }
      return b;
    });
  }).then(function (b) {
    /* Une synchronisation automatique ne redessine jamais un écran en cours de saisie
       (installation, choix des arbres, dialogue ouvert) : elle effacerait ce qui est tapé. */
    if (manuel || (b && (b.envoyees || b.photos_envoyees))) { if (!manuel && saisieEnCours()) barreEnvoi(); else rendre(); }
    return b;
  });
}
function saisieEnCours() {
  if (document.querySelector('.obs-voile')) return true;
  var f = document.querySelector('#obsInstall, #obsChoixArbres'); if (!f) return false;
  return [].some.call(f.querySelectorAll('input, textarea, select'), function (x) { return x.type === 'checkbox' ? x.checked : x.tagName === 'SELECT' ? (x.id === 'obsPlot' && !!x.value) : !!String(x.value || '').trim(); });
}
/* Toute erreur d'enregistrement local est montrée à l'agent : jamais d'échec silencieux. */
function echec(e) { console.error('[OBSERVATOIRE]', e); etat.message = ['danger', 'Enregistrement impossible sur cet appareil : ' + (e && e.message ? e.message : 'erreur inconnue') + '. Rien n’a été envoyé. Réessayez.']; rendre(); }
function message() { var m = etat.message; etat.message = null; return m ? note(esc(m[1]), m[0]) : ''; }
function nomParcelle(ref, panel) {
  var pl = (ref.plots || []).filter(function (x) { return x.id === panel.plot_id; })[0] || {};
  var pr = (ref.producteurs || []).filter(function (x) { return x.id === (pl.producteur_id || panel.producteur_id); })[0] || {};
  var vi = (ref.villages || []).filter(function (x) { return x.id === (pl.village_id || panel.village_id); })[0] || {};
  return { producteur: pr.nom || panel.producteur_nom || 'Producteur', parcelle: pl.local_name || panel.parcelle_nom || 'Parcelle', village: vi.village || panel.village_nom || '',
    code: pr.code || '', cluster: vi.cluster_code || panel.cluster_code || '', village_id: vi.id || pl.village_id || panel.village_id || '' };
}

/* ------------------------------------------------------------------ Mes champs */
function vueChamps() {
  var camp = campagne();
  if (!peutCollecter()) { return peutPiloter() ? aller('observatoire/validation') : vueRefus(); }
  return Promise.all([L.panels(camp && camp.id), L.visites(), L.referentiel(), L.dernierePreparation()]).then(function (r) {
    var semaine = C.semaineIso(C.aujourdhui()), ref = r[2], prep = r[3];
    /* Ergonomie S02 : la première ouverture avec réseau charge les champs sans geste supplémentaire. */
    if (camp && enLigne() && (!prep || prep.campaign_id !== camp.id) && !etat.autoPrep) {
      etat.autoPrep = true;
      peindre(entete('Les mêmes arbres suivis, visités chaque semaine.', '') + note('Chargement de vos champs sur ce téléphone… (une seule fois, avec du réseau)', 'info'));
      return client().then(function (c) { if (!c) throw new Error('Connexion indisponible.'); return L.synchroniser(c).then(function () { return L.preparer(c, camp.id); }); })
        .then(function (x) { etat.message = ['ok', 'Téléphone prêt pour le terrain : ' + x.champs + ' champ(s)' + (x.parcelles == null ? '' : ', ' + x.parcelles + ' parcelle(s) du registre') + '. Vous pouvez maintenant travailler sans réseau.']; })
        .catch(function (e) { etat.message = ['warn', 'Chargement impossible (' + e.message + '). Touchez « Préparer le hors-ligne » quand le réseau est bon.']; })
        .then(function () { return rendre(); });
    }
    var fiches = [];
    var cartes = r[0].sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? 1 : -1; }).map(function (p) {
      var n = nomParcelle(ref, p), v = r[1].filter(function (x) { return x.panel_id === p.id && C.semaineIso(x.date_observation) === semaine; })[0];
      var statut = p.statut_local || p.statut, action;
      if (statut === 'ACTIF') action = '<a class="btn primary" href="#observatoire/visite/' + p.id + '/' + (v ? v.id : 'nouvelle') + '">' + (v ? (v.statut_serveur && v.statut_serveur !== 'BROUILLON' && v.statut_serveur !== 'CORRECTION_DEMANDEE' ? 'Voir la visite' : 'Reprendre la visite') : 'Visite de la semaine') + '</a>';
      else if (statut === 'TIRAGE_VERROUILLE') action = '<a class="btn signal" href="#observatoire/champ/' + p.id + '">Continuer l’installation</a>';
      else action = '';
      /* Filtre « Mes champs » (demande M. KOUASSI 19/11) : cluster, village, producteur, visites à faire. */
      var aFaire = statut === 'TIRAGE_VERROUILLE' || (statut === 'ACTIF' && (!v || !v.statut_serveur || ['BROUILLON', 'CORRECTION_DEMANDEE', 'LOCAL'].indexOf(v.statut_serveur) >= 0));
      fiches.push({ cl: n.cluster, vil: n.village_id || n.village, vilNom: n.village || 'Village non renseigné' });
      return '<article class="obs-carte" data-cl="' + esc(n.cluster) + '" data-vil="' + esc(n.village_id || n.village) + '" data-afaire="' + (aFaire ? 1 : 0) + '" data-q="' + esc(sansAccent(n.producteur + ' ' + n.code + ' ' + n.parcelle + ' ' + n.village)) + '"><div class="obs-carte-tete"><div><h3>' + esc(n.producteur) + '</h3><p>' + esc(n.parcelle) + (n.village ? ' · ' + esc(n.village) : '') + '</p></div>' +
        badge(statut === 'ACTIF' ? 'Actif' : statut === 'TIRAGE_VERROUILLE' ? 'Installation en cours' : statut === 'INCOMPATIBLE' ? 'Incompatible' : statut, tonStatut(statut)) + '</div>' +
        '<div class="obs-carte-etat">' + (p.local ? badge('Installation non encore reçue par le serveur', 'warn') : '') +
        (statut === 'ACTIF' ? 'Semaine ' + esc(semaine.slice(-2)) + ' : ' + (v ? badge(C.LIBELLES.statut_visite[v.statut_serveur || 'LOCAL'], tonStatut(v.statut_serveur)) + (v.etat_envoi && v.etat_envoi !== 'RECU' ? ' ' + badge('non envoyée', 'warn') : '') : badge('à faire', 'warn')) : '') + '</div>' +
        '<div class="obs-carte-actions">' + action + '<a class="btn secondary" href="#observatoire/champ/' + p.id + '">Fiche du champ</a></div></article>';
    }).join('');
    peindre(entete('Les mêmes arbres marqués, visités chaque semaine.', '',
      '<button type="button" class="btn secondary" data-act="preparer">Préparer le hors-ligne</button><a class="btn primary" href="#observatoire/installer">Installer un champ</a>') + message() +
      (camp ? '' : note('Aucune campagne sélectionnée. Choisissez la campagne en haut de l’écran.', 'warn')) +
      (camp && !camp.ouverte ? note('La campagne sélectionnée n’est pas ouverte : la saisie sera refusée par le serveur.', 'warn') : '') +
      '<p class="obs-info">Dernière préparation hors-ligne : ' + (prep ? esc(heureFr(prep.le)) + ' (' + prep.champs + ' champ(s))' : 'jamais. Faites-la avant de partir sur le terrain.') + '</p>' +
      (cartes ? barreFiltreChamps(fiches) + '<div class="obs-grille" id="obsGrilleChamps">' + cartes + '</div>' : '<div class="ops-empty">Aucun champ installé sur cet appareil. Touchez « Préparer le hors-ligne » pour charger vos champs, ou « Installer un champ ».</div>'));
    etat.fichesChamps = fiches;
    filtrerChamps();
    barreEnvoi();
  });
}
/* Barre de filtre de « Mes champs » : fonctionne hors ligne (filtre local des cartes), garde le choix
   pendant la session (les re-rendus après synchronisation ne l'effacent pas). */
function villagesChamps(cluster) {
  var vus = {}, l = [];
  (etat.fichesChamps || []).forEach(function (f) {
    if (cluster && f.cl !== cluster) return;
    if (!vus[f.vil]) { vus[f.vil] = { id: f.vil, nom: f.vilNom, n: 0 }; l.push(vus[f.vil]); }
    vus[f.vil].n++;
  });
  l.sort(function (a, b) { return a.nom.localeCompare(b.nom); });
  var choix = (etat.filtreChamps || {}).vil || '';
  return '<option value="">Tous les villages</option>' + l.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === choix ? ' selected' : '') + '>' + esc(v.nom) + ' (' + v.n + ')</option>'; }).join('');
}
function barreFiltreChamps(fiches) {
  etat.fichesChamps = fiches;
  var f = etat.filtreChamps || {}, cl = {};
  fiches.forEach(function (x) { if (x.cl) cl[x.cl] = (cl[x.cl] || 0) + 1; });
  var lc = Object.keys(cl).sort();
  return '<fieldset class="card obs-filtres obs-filtres-champs"><legend>Retrouver un champ</legend><div class="obs-duo">' +
    (lc.length > 1 ? '<div class="field"><label for="obsChCluster">Cluster</label><select id="obsChCluster"><option value="">Tous les clusters</option>' +
      lc.map(function (c) { return '<option value="' + esc(c) + '"' + (c === f.cl ? ' selected' : '') + '>' + esc(c) + ' (' + cl[c] + ')</option>'; }).join('') + '</select></div>' : '') +
    '<div class="field"><label for="obsChVillage">Village</label><select id="obsChVillage">' + villagesChamps(lc.length > 1 ? f.cl : '') + '</select></div></div>' +
    '<div class="field"><label for="obsChTexte">Producteur (nom ou code)</label><input id="obsChTexte" type="search" inputmode="search" maxlength="80" placeholder="Ex. Kouakou ou SAK-0012" value="' + esc(f.q || '') + '"></div>' +
    '<label class="obs-case-ligne"><input type="checkbox" id="obsChAFaire"' + (f.aFaire ? ' checked' : '') + '> Seulement les champs à visiter cette semaine</label>' +
    '<p class="obs-info" id="obsChCompte" aria-live="polite"></p></fieldset>';
}
function filtrerChamps(e) {
  var g = document.getElementById('obsGrilleChamps'); if (!g) return;
  var fc = document.getElementById('obsChCluster'), fv = document.getElementById('obsChVillage'), ft = document.getElementById('obsChTexte'), fa = document.getElementById('obsChAFaire');
  var f = etat.filtreChamps = { cl: fc ? fc.value : '', vil: fv ? fv.value : '', q: ft ? ft.value : '', aFaire: !!(fa && fa.checked) };
  if (e && e.target === fc && fv) { f.vil = ''; fv.innerHTML = villagesChamps(f.cl); }
  var mots = sansAccent(f.q).split(/\s+/).filter(Boolean), cartes = g.querySelectorAll('.obs-carte'), vues = 0;
  [].forEach.call(cartes, function (c) {
    var ok = (!f.cl || c.getAttribute('data-cl') === f.cl) && (!f.vil || c.getAttribute('data-vil') === f.vil) &&
      (!f.aFaire || c.getAttribute('data-afaire') === '1') && mots.every(function (m) { return c.getAttribute('data-q').indexOf(m) >= 0; });
    c.hidden = !ok; if (ok) vues++;
  });
  var n = document.getElementById('obsChCompte');
  if (n) n.textContent = vues === cartes.length ? cartes.length + ' champ(s).' : vues + ' champ(s) sur ' + cartes.length + (vues ? '.' : ' : aucun ne correspond, modifiez le filtre.');
}
function vueRefus() { peindre('<div class="ops-route-head"><div><h1>Observatoire agronomique</h1><p>Accès réservé.</p></div></div>' + note('Votre profil n’a pas accès à l’Observatoire agronomique. Ce module est réservé aux équipes agronomiques AFLP désignées.', 'warn')); }

/* ------------------------------------------------------------------ Installer un champ */
function vueInstaller() {
  var camp = campagne();
  if (!peutCollecter()) return vueRefus();
  return Promise.all([L.referentiel(), L.panels(camp && camp.id), L.protocole()]).then(function (r) {
    var ref = r[0], pris = {}, proto = r[2]; r[1].forEach(function (p) { pris[p.plot_id] = 1; }); (ref.plots || []).forEach(function (p) { if (p.deja_installee) pris[p.id] = 1; });
    etat.protocole = proto;
    var pros = {}, vils = {};
    (ref.producteurs || []).forEach(function (x) { pros[x.id] = x; });
    (ref.villages || []).forEach(function (x) { vils[x.id] = x; });
    var libres = (ref.plots || []).filter(function (p) { return !pris[p.id]; });
    var options = libres.filter(function (p) { return p.eligible !== false; }).map(function (p) {
      var pr = pros[p.producteur_id] || {}, vi = vils[p.village_id] || {};
      /* La liste vient du serveur (pheno_parcelles_disponibles) : seules les parcelles de son périmètre y figurent. */
      var txt = (pr.nom || 'Producteur') + (pr.code ? ' (' + pr.code + ')' : '') + ' — ' + (p.local_name || 'Parcelle') + ' — ' + (vi.village || '') + (p.tree_count ? ' (' + p.tree_count + ' arbres déclarés)' : '');
      return { id: p.id, txt: txt, cl: vi.cluster_code || '', vil: p.village_id || '', vilNom: vi.village || '', q: sansAccent(txt) };
    }).sort(function (a, b) { return a.txt.localeCompare(b.txt); });
    /* D3 · Parcelles à compléter dans le registre FBMS : visibles, jamais modifiées ici. */
    var incompletes = libres.filter(function (p) { return p.eligible === false; }).map(function (p) {
      var pr = pros[p.producteur_id] || {}, vi = vils[p.village_id] || {};
      return '<li><b>' + esc(pr.nom || 'Producteur') + '</b>' + (pr.code ? ' (' + esc(pr.code) + ')' : '') + ' · ' + esc(p.local_name || 'Parcelle') + ' · ' + esc(vi.village || '') + '<br><span class="obs-detail">Manque : ' + esc((p.manques || []).join(', ')) + '</span>' +
        (['BM', 'UH'].indexOf(classe()) >= 0 ? ' <a href="#farmers/' + encodeURIComponent(p.producteur_id) + '">Fiche du producteur</a>' : '') + '</li>';
    });
    etat.parcellesInstall = options;
    var clusters = {}; options.forEach(function (o) { if (o.cl) clusters[o.cl] = (clusters[o.cl] || 0) + 1; });
    var listeClusters = Object.keys(clusters).sort(), designation = proto.mode_selection !== 'TIRAGE';
    var lienRegistre = ['BM', 'UH'].indexOf(classe()) >= 0 ? ' <a href="#farmers">Ouvrir le registre des producteurs</a>' : ' Prévenez votre Chef d’Unité.';
    peindre(entete(designation ? 'Installer un champ : blocs, blocs suivis, puis choix des arbres.' : 'Installation d’un champ : blocs, tirage, verrouillage.', '', '<a class="btn secondary" href="#observatoire">Retour</a>') +
      (camp ? '' : note('Aucune campagne sélectionnée.', 'warn')) +
      (options.length ? '' : note('Aucun champ prêt pour l’Observatoire sur ce téléphone. Revenez à « Mes champs » et touchez « Préparer le hors-ligne » avec du réseau. Le champ doit être complet dans le registre FBMS.', 'warn')) +
      (incompletes.length ? '<details class="card obs-a-completer"><summary><b>' + incompletes.length + ' champ(s) à compléter dans le registre FBMS</b> avant de commencer l’Observatoire</summary><p class="obs-info">Ces champs ne peuvent pas être installés : il manque des informations dans le registre. À corriger par le RT ou le Chef d’Unité dans le registre des producteurs.' + lienRegistre + '</p><ul class="obs-liste">' + incompletes.join('') + '</ul></details>' : '') +
      '<form id="obsInstall" class="card obs-form" autocomplete="off" novalidate>' +
      (options.length ? '<fieldset class="obs-filtres"><legend>Trouver la parcelle</legend><div class="obs-duo">' +
        (listeClusters.length > 1 ? '<div class="field"><label for="obsFiltreCluster">Cluster</label><select id="obsFiltreCluster"><option value="">Tous les clusters</option>' +
          listeClusters.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + ' (' + clusters[c] + ')</option>'; }).join('') + '</select></div>' : '') +
        '<div class="field"><label for="obsFiltreVillage">Village</label><select id="obsFiltreVillage">' + optionsVillages('') + '</select></div></div>' +
        '<div class="field"><label for="obsFiltreTexte">Producteur (nom ou code)</label><input id="obsFiltreTexte" type="search" inputmode="search" maxlength="80" placeholder="Ex. Kouakou ou SAK-0012"></div>' +
        '<p class="obs-info" id="obsFiltreCompte" aria-live="polite"></p></fieldset>' : '') +
      '<div class="field"><label for="obsPlot">1. Quel champ installez-vous ?</label><select id="obsPlot">' + optionsParcelles(options) + '</select></div>' +
      '<div class="obs-duo"><div class="field"><label for="obsB">2. Combien de blocs compte ce champ ?</label><input id="obsB" type="number" inputmode="numeric" min="1" max="60"></div>' +
      '<div class="field"><label for="obsb">3. Combien de blocs allons-nous suivre ?</label><input id="obsb" type="number" inputmode="numeric" min="1" max="10"></div></div>' +
      '<p class="obs-info">Découpez le champ en blocs qui ne se chevauchent pas, délimités par des repères visibles (piste, termitière, gros arbre, borne).' +
        (designation ? ' Cochez ensuite les blocs que vous allez suivre. Après l’installation, comptez les arbres de ces blocs : le Chef d’Unité choisira les 10 arbres suivis et les 2 réserves.' : ' <b>Le nombre de blocs suivis est fixé avant le tirage et ne pourra plus être changé.</b>') + '</p>' +
      '<div id="obsReperes"></div><div id="obsInstallErr" aria-live="polite"></div>' +
      '<div class="obs-actions"><button type="submit" class="btn primary">' + (designation ? 'Enregistrer l’installation' : 'Tirer les blocs et verrouiller') + '</button></div></form>');
    filtrerParcelles();
    barreEnvoi();
  });
}
/* Filtre de la liste des parcelles : cluster → village → nom ou code du producteur.
   La liste est reconstruite (et non masquée) : masquer une <option> ne marche pas sur iPhone. */
function sansAccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function optionsVillages(cluster) {
  var vus = {}, l = [];
  (etat.parcellesInstall || []).forEach(function (o) { if ((!cluster || o.cl === cluster) && o.vil && !vus[o.vil]) { vus[o.vil] = { id: o.vil, nom: o.vilNom || o.vil, n: 0 }; l.push(vus[o.vil]); } if (vus[o.vil] && (!cluster || o.cl === cluster)) vus[o.vil].n++; });
  l.sort(function (a, b) { return a.nom.localeCompare(b.nom); });
  return '<option value="">Tous les villages</option>' + l.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.nom) + ' (' + v.n + ')</option>'; }).join('');
}
function optionsParcelles(liste, choisie) {
  return '<option value="">— Choisir —</option>' + liste.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === choisie ? ' selected' : '') + '>' + esc(o.txt) + '</option>'; }).join('');
}
function filtrerParcelles(e) {
  var tout = etat.parcellesInstall || [], sel = document.getElementById('obsPlot'); if (!sel) return;
  var fc = document.getElementById('obsFiltreCluster'), fv = document.getElementById('obsFiltreVillage'), ft = document.getElementById('obsFiltreTexte');
  var cl = fc ? fc.value : '';
  if (e && e.target === fc && fv) fv.innerHTML = optionsVillages(cl);
  var vil = fv ? fv.value : '', mots = sansAccent(ft ? ft.value : '').split(/\s+/).filter(Boolean);
  var liste = tout.filter(function (o) {
    return (!cl || o.cl === cl) && (!vil || o.vil === vil) && mots.every(function (m) { return o.q.indexOf(m) >= 0; });
  });
  var choisie = sel.value;
  sel.innerHTML = optionsParcelles(liste, liste.some(function (o) { return o.id === choisie; }) ? choisie : (liste.length === 1 ? liste[0].id : ''));
  var c = document.getElementById('obsFiltreCompte');
  if (c) c.textContent = liste.length === tout.length ? tout.length + ' parcelle(s) disponibles.'
    : liste.length + ' parcelle(s) sur ' + tout.length + (liste.length ? '.' : ' : aucune ne correspond, modifiez le filtre.');
}
/* Lignes des blocs : générées quand le nombre est valide (pas à chaque frappe d'un chiffre
   intermédiaire), avec la case « Suivre ce bloc » en mode désignation. */
function majReperes() {
  var h = document.getElementById('obsReperes'); if (!h) return;
  var brut = parseInt((document.getElementById('obsB') || {}).value, 10), B = brut >= 1 && brut <= 60 ? brut : 0;
  var designation = !etat.protocole || etat.protocole.mode_selection !== 'TIRAGE';
  var anciens = [].map.call(h.querySelectorAll('input[type=text]'), function (i) { return i.value; }), coches = [].map.call(h.querySelectorAll('input[type=checkbox]'), function (i) { return i.checked; }), s = '';
  for (var i = 1; i <= B; i++) {
    var nn = ('0' + i).slice(-2);
    s += '<div class="field obs-bloc-ligne"><label for="obsRep' + i + '">Bloc ' + nn + ' : repère visible sur le terrain</label><input id="obsRep' + i + '" type="text" maxlength="120" value="' + esc(anciens[i - 1] || '') + '" placeholder="Ex. entre la piste et la termitière">' +
      (designation ? '<label class="obs-case"><input type="checkbox" id="obsSuivi' + i + '"' + (coches[i - 1] ? ' checked' : '') + '> Suivre ce bloc</label>' : '') + '</div>';
  }
  h.innerHTML = B ? '<h3 class="obs-titre">4. Les ' + B + ' blocs du champ' + (designation ? ' : écrivez le repère et cochez les blocs suivis' : '') + '</h3>' + s : '';
  var err = document.getElementById('obsInstallErr'); if (err) err.innerHTML = '';
}
function soumettreInstallation(form) {
  var camp = campagne(), err = document.getElementById('obsInstallErr');
  var B = parseInt(form.querySelector('#obsB').value, 10), b = parseInt(form.querySelector('#obsb').value, 10), plot = form.querySelector('#obsPlot').value;
  var blocs = []; for (var i = 1; i <= B; i++) blocs.push({ id: C.uuid(), repere: (form.querySelector('#obsRep' + i) || {}).value, suivi: !!(form.querySelector('#obsSuivi' + i) || {}).checked });
  err.innerHTML = '';
  if (!camp) { err.innerHTML = note('Aucune campagne sélectionnée.', 'danger'); return; }
  Promise.all([L.graine(camp.id), L.protocole()]).then(function (r) { installerAvecGraine(form, err, camp, plot, B, b, blocs, r[0], r[1]); }).catch(echec);
}
function installerAvecGraine(form, err, camp, plot, B, b, blocs, graineCampagne, proto) {
  var designation = !proto || proto.mode_selection !== 'TIRAGE', id = C.uuid();
  var res = designation ? C.installerDesignation({ id: id, campaign_id: camp.id, plot_id: plot, nb_blocs_total: B, nb_blocs_tires: b, blocs: blocs, titulaires: proto && proto.titulaires, reserves: proto && proto.reserves })
    : C.installer({ id: id, campaign_id: camp.id, plot_id: plot, graine_campagne: graineCampagne, nb_blocs_total: B, nb_blocs_tires: b, blocs: blocs });
  if (!plot) res.erreurs = ['Choisissez le champ à installer.'].concat(res.erreurs || []);
  if (res.erreurs && res.erreurs.length) { err.innerHTML = note(res.erreurs.map(esc).join('<br>'), 'danger'); err.scrollIntoView({ block: 'center' }); return; }
  var texte = designation ? 'Le champ compte <b>' + B + ' blocs</b> et vous suivez les blocs <b>' + res.blocs_tires.map(function (x) { return ('0' + x).slice(-2); }).join(', ') + '</b>. Après confirmation, ces choix ne pourront plus être changés.'
    : 'Vous avez décrit <b>' + B + ' blocs</b> et vous en tirez <b>' + b + '</b>. Après confirmation, le tirage est définitif : ni le nombre de blocs, ni les blocs tirés ne pourront être changés.';
  confirmer(designation ? 'Enregistrer l’installation ?' : 'Verrouiller le tirage ?', texte, designation ? 'Enregistrer' : 'Tirer et verrouiller').then(function (oui) {
    if (!oui) return;
    return L.referentiel().then(function (ref) {
      var pl = (ref.plots || []).filter(function (x) { return x.id === plot; })[0] || {}, n = nomParcelle(ref, { plot_id: plot });
      var panel = { id: id, campaign_id: camp.id, plot_id: plot, producteur_id: pl.producteur_id, village_id: pl.village_id, producteur_nom: n.producteur, parcelle_nom: n.parcelle, village_nom: n.village,
        nb_blocs_total: B, nb_blocs_tires: b, statut: 'TIRAGE_VERROUILLE', tirage_graine: res.graine, graine_campagne: graineCampagne, tirage_le: new Date().toISOString(), blocs: res.blocs, arbres: [], local: true, created_at: new Date().toISOString(),
        mode_selection: designation ? 'DESIGNATION' : 'TIRAGE' };
      return L.enregistrerPanel(panel).then(function () {
        return L.mettreEnFile('PANEL_INSTALLER', { id: id, campaign_id: camp.id, plot_id: plot, nb_blocs_total: B, nb_blocs_tires: b,
          blocs: res.blocs.map(function (x) { return { id: x.id, numero: x.numero, repere: x.repere, suivi: !!x.tire }; }) }, { entite: 'PANEL', entite_id: id, libelle: 'Installation : ' + n.producteur + ' — ' + n.parcelle });
      }).then(function () { etat.message = ['ok', (designation ? 'Installation enregistrée : blocs suivis ' : 'Tirage verrouillé : blocs ') + res.blocs_tires.map(function (x) { return ('0' + x).slice(-2); }).join(', ') + '. Enregistré sur ce téléphone. Comptez maintenant les arbres de ces blocs.']; synchroniser(false); aller('observatoire/champ/' + id); });
    });
  }).catch(echec);
}

/* ------------------------------------------------------------------ Fiche du champ */
function vueChamp(id) {
  return Promise.all([L.panel(id), L.referentiel(), L.visites(id), L.protocole()]).then(function (r) {
    etat.protocole = r[3];
    var p = r[0]; if (!p) { peindre(entete('Champ introuvable sur cet appareil.', '') + note('Ce champ n’est pas chargé sur cet appareil. Revenez à « Mes champs » et touchez « Préparer le hors-ligne ».', 'warn')); return; }
    var n = nomParcelle(r[1], p), statut = p.statut_local || p.statut, tires = p.blocs.filter(function (b) { return b.tire; }).sort(function (a, b) { return a.rang_tirage - b.rang_tirage; });
    var desig = p.mode_selection === 'DESIGNATION', nb = function (x) { return ('0' + x).slice(-2); };
    var invFaits = tires.every(function (b) { return b.nb_arbres_inventories != null; });
    var blocs = '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Bloc</th><th>Repère</th><th>' + (desig ? 'Suivi' : 'Tirage') + '</th><th>Arbres comptés</th></tr></thead><tbody>' + p.blocs.map(function (b) {
      var inv = !b.tire ? '<span class="obs-gris">non compté (bloc non suivi)</span>' : b.nb_arbres_inventories != null ? '<b>' + b.nb_arbres_inventories + '</b>'
        : (peutCollecter() ? '<span class="obs-inventaire"><input type="number" inputmode="numeric" min="0" max="2000" aria-label="Nombre d’arbres du bloc ' + nb(b.numero) + '" id="obsInv' + b.numero + '"><button type="button" class="btn primary" data-act="inventaire" data-bloc="' + esc(b.id) + '" data-num="' + b.numero + '">Enregistrer</button></span>' : 'à compter');
      return '<tr class="' + (b.tire ? 'obs-tire' : '') + '"><td data-l="Bloc"><b>B' + nb(b.numero) + '</b></td><td data-l="Repère">' + esc(b.repere) + '</td><td data-l="' + (desig ? 'Suivi' : 'Tirage') + '">' +
        (b.tire ? badge(desig ? 'Bloc suivi' : 'Tiré (rang ' + b.rang_tirage + ') · ' + b.nb_titulaires_prevus + ' titulaires' + (b.nb_reserves_prevues ? ' + ' + b.nb_reserves_prevues + ' réserve' : ''), 'ok') : badge(desig ? 'Non suivi' : 'Non tiré')) + '</td><td data-l="Arbres comptés">' + inv + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    var arbres = (p.arbres || []).slice().sort(function (a, b) { return (a.role === b.role ? 0 : a.role === 'TITULAIRE' ? -1 : 1) || a.rang - b.rang; });
    /* S09 · Boutons séparés : marquer le GPS (geste courant) et remplacer un arbre (acte rare, motivé)
       ne sont plus côte à côte. Alerte si deux arbres ont exactement la même position. */
    var memesGps = {}; arbres.forEach(function (a) { if (a.latitude != null) { var k = a.latitude + ',' + a.longitude; memesGps[k] = (memesGps[k] || 0) + 1; } });
    var peutRemplacer = !p.local && (peutPiloter() || (desig && classe() === 'UH'));
    var liste = arbres.length ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>N°</th><th>Code terrain</th><th>Rôle</th><th>Repère GPS</th>' + (peutRemplacer ? '<th>Remplacement</th>' : '') + '</tr></thead><tbody>' + arbres.map(function (a) {
      var st = { ACTIF: ['Arbre suivi', 'ok'], RESERVE_EN_ATTENTE: ['Réserve (non observée)', ''], RESERVE_ACTIVEE: ['Réserve devenue suivie', 'info'], REMPLACE: ['Remplacé' + (a.date_effet ? ' le ' + dateFr(a.date_effet) : ''), 'warn'] }[a.statut] || [a.statut, ''];
      var dbl = a.latitude != null && memesGps[a.latitude + ',' + a.longitude] > 1;
      return '<tr><td data-l="N°"><b>' + (a.role === 'TITULAIRE' ? nb(a.rang) : 'R' + a.rang) + '</b></td><td data-l="Code"><b>' + esc(a.code) + '</b></td><td data-l="Rôle">' + badge(st[0], st[1]) + '</td><td data-l="Repère GPS">' +
        (a.latitude != null ? (dbl ? badge('Même position qu’un autre arbre : à refaire près de cet arbre', 'warn') + ' ' : 'Position enregistrée ') : '') +
        (peutCollecter() && a.statut !== 'REMPLACE' && (a.latitude == null || dbl) ? '<button type="button" class="btn secondary" data-act="marquer" data-arbre="' + esc(a.id) + '" data-panel="' + esc(p.id) + '">Enregistrer la position près de cet arbre</button>' : (a.latitude == null ? '—' : '')) + '</td>' +
        (peutRemplacer ? '<td data-l="Remplacement">' + ((a.statut === 'ACTIF' || a.statut === 'RESERVE_ACTIVEE') ? '<button type="button" class="btn danger-outline obs-loin" data-act="reserve" data-arbre="' + esc(a.id) + '" data-code="' + esc(a.code) + '">Remplacer…</button>' : '') + '</td>' : '') + '</tr>';
    }).join('') + '</tbody></table></div><p class="obs-info">Marquez chaque arbre de façon durable (peinture, étiquette) avec son code terrain, exactement comme sur la fiche papier (ex. B03/A010).</p>' : '';
    /* D2 · Choix libre des arbres par le Chef d'Unité, quand tous les blocs suivis sont comptés. */
    var choixArbres = '';
    if (desig && statut === 'TIRAGE_VERROUILLE' && invFaits && !arbres.length) {
      var proto = etat.protocole || { titulaires: 10, reserves: 2 }, T = proto.titulaires || 10, R = proto.reserves == null ? 2 : proto.reserves;
      if (classe() === 'UH' || classe() === 'BM') {
        var opts = tires.map(function (b) { return '<option value="' + esc(b.id) + '">B' + nb(b.numero) + ' (' + b.nb_arbres_inventories + ' arbres)</option>'; }).join('');
        var ligne = function (k, role) { var lab = role === 'TITULAIRE' ? 'Arbre suivi ' + nb(k) : 'Réserve R' + k;
          return '<div class="obs-choix-arbre" data-role="' + role + '"><span class="obs-choix-nom">' + lab + '</span><select aria-label="' + lab + ' : bloc" data-choix="bloc">' + opts + '</select><input type="number" inputmode="numeric" min="1" aria-label="' + lab + ' : numéro de l’arbre dans le bloc" placeholder="N° dans le bloc" data-choix="num"></div>'; };
        var lignes = ''; for (var k = 1; k <= T; k++) lignes += ligne(k, 'TITULAIRE'); for (k = 1; k <= R; k++) lignes += ligne(k, 'RESERVE');
        choixArbres = '<section class="card obs-form" id="obsChoixArbres"><div class="card-head"><h2>Choisir les ' + T + ' arbres suivis et les ' + R + ' réserves</h2></div>' +
          note('Pour chaque arbre : choisissez son bloc, puis écrivez son numéro (l’ordre dans lequel vous avez compté les arbres du bloc). Un même arbre ne peut pas être choisi deux fois. <b>Suivi d’arbres désignés : ce n’est pas un échantillon statistiquement représentatif.</b>', 'info') +
          lignes + '<div id="obsChoixErr" aria-live="polite"></div><div class="obs-actions"><button type="button" class="btn primary" data-act="designer" data-panel="' + esc(p.id) + '">Enregistrer le choix des arbres</button></div></section>';
      } else choixArbres = note('Tous les blocs suivis sont comptés. <b>Le Chef d’Unité doit maintenant choisir les ' + T + ' arbres suivis et les ' + R + ' réserves</b> sur ce champ.', 'warn');
    }
    var vis = r[2].sort(function (a, b) { return a.date_observation < b.date_observation ? 1 : -1; });
    var qui = classe() === 'UH' ? 'votre Chef de Zone' : classe() === 'BM' ? 'l’équipe du cluster' : 'votre Chef d’Unité';
    peindre(entete(n.producteur + ' — ' + n.parcelle + (n.village ? ' · ' + n.village : ''), '', '<a class="btn secondary" href="#observatoire">Retour</a>' + (p.plot_id && global.ANAGROCI_PARCELLES ? '<a class="btn secondary" href="#parcelles/p/' + esc(p.plot_id) + '">Contour de la parcelle</a>' : '') + (statut === 'ACTIF' && peutCollecter() ? '<a class="btn primary" href="#observatoire/visite/' + p.id + '/nouvelle">Visite de la semaine</a>' : '')) + message() +
      (p.local ? note('Installation enregistrée sur ce téléphone. <b>Pas encore reçue par FBMS.</b>', 'warn') : '') + (p.dernier_message ? note('Réponse du serveur : ' + esc(p.dernier_message), 'danger') : '') +
      (statut === 'INCOMPATIBLE' ? note('<b>Ce champ ne peut pas être suivi :</b> ' + esc(p.incompatibilite || '') + '. Il n’est ni complété ni remplacé. Prévenez ' + qui + ' pour choisir un autre champ.', 'danger') : '') +
      (statut === 'TIRAGE_VERROUILLE' && !invFaits ? note((desig ? 'Blocs suivis : <b>' : 'Tirage verrouillé : blocs <b>') + tires.map(function (b) { return 'B' + nb(b.numero); }).join(', ') + '</b>. Comptez maintenant <b>tous</b> les arbres de chaque bloc suivi, dans un ordre fixe (du repère d’entrée, rang par rang). Le nombre saisi ne pourra plus être modifié.', 'info') : '') +
      (p.reserves_manquantes ? note(p.reserves_manquantes + ' réserve(s) manquante(s) : bloc trop petit pour fournir une réserve.', 'warn') : '') +
      choixArbres +
      '<section class="card"><div class="card-head"><h2>Blocs (' + p.nb_blocs_tires + (desig ? ' suivis' : ' tirés') + ' sur ' + p.nb_blocs_total + ')</h2>' + badge((desig ? 'Installé le ' : 'Tirage verrouillé le ') + dateFr(p.tirage_le || p.created_at), 'ok') + '</div>' + blocs + '</section>' +
      (liste ? '<section class="card"><div class="card-head"><h2>Arbres suivis</h2></div>' + liste + '</section>' : '') +
      '<section class="card"><div class="card-head"><h2>Visites</h2></div>' + (vis.length ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Semaine</th><th>Observée le</th><th>Statut</th><th>Envoi</th><th></th></tr></thead><tbody>' + vis.map(function (v) {
        return '<tr><td data-l="Semaine">' + esc(C.semaineIso(v.date_observation)) + '</td><td data-l="Observée le">' + dateFr(v.date_observation) + '</td><td data-l="Statut">' + badge(C.LIBELLES.statut_visite[v.statut_serveur || 'LOCAL'], tonStatut(v.statut_serveur)) + '</td><td data-l="Envoi">' + (v.etat_envoi === 'RECU' ? 'Reçue par le serveur le ' + esc(heureFr(v.recu_serveur_le)) : v.etat_envoi ? esc(C.LIBELLES.statut_envoi[v.etat_envoi] || v.etat_envoi) : 'Sur ce téléphone uniquement') + '</td><td><a class="btn secondary" href="#observatoire/visite/' + p.id + '/' + v.id + '">Ouvrir</a></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="ops-empty">Aucune visite sur cet appareil.</div>') + '</section>');
    barreEnvoi();
  });
}
function enregistrerInventaire(blocId, numero) {
  var champ = document.getElementById('obsInv' + numero), n = parseInt(champ && champ.value, 10), pid = parts()[2];
  if (!(n >= 0) || n > 2000) { if (champ) champ.classList.add('obs-erreur'); return; }
  confirmer('Enregistrer le comptage ?', 'Bloc B' + ('0' + numero).slice(-2) + ' : <b>' + n + ' arbres</b> comptés. Ce nombre ne pourra plus être modifié.', 'Enregistrer').then(function (oui) {
    if (!oui) return;
    return L.panel(pid).then(function (p) {
      p.blocs.forEach(function (b) { if (b.id === blocId) b.nb_arbres_inventories = n; });
      if (p.mode_selection === 'DESIGNATION') {
        etat.message = ['ok', 'Comptage enregistré sur ce téléphone.' + (p.blocs.every(function (b) { return !b.tire || b.nb_arbres_inventories != null; }) ? ' Tous les blocs suivis sont comptés : le Chef d’Unité peut choisir les arbres.' : '')];
        return L.enregistrerPanel(p).then(function () { return L.mettreEnFile('BLOC_INVENTORIER', { bloc_id: blocId, nb_arbres: n }, { entite: 'BLOC', entite_id: blocId, libelle: 'Comptage du bloc B' + ('0' + numero).slice(-2) + ' : ' + n + ' arbres' }); });
      }
      var t = C.tirerArbres(p);
      if (t.statut === 'ACTIF') { p.statut_local = 'ACTIF'; p.arbres = t.arbres; p.reserves_manquantes = t.reserves_manquantes; etat.message = ['ok', 'Arbres tirés : ' + t.arbres.filter(function (a) { return a.role === 'TITULAIRE'; }).length + ' titulaires. Marquez-les avec leur code.']; }
      else if (t.statut === 'INCOMPATIBLE') { p.statut_local = 'INCOMPATIBLE'; p.incompatibilite = t.incompatibilite; }
      return L.enregistrerPanel(p).then(function () { return L.mettreEnFile('BLOC_INVENTORIER', { bloc_id: blocId, nb_arbres: n }, { entite: 'BLOC', entite_id: blocId, libelle: 'Inventaire du bloc ' + numero + ' : ' + n + ' arbres' }); });
    }).then(function () { synchroniser(false); rendre(); });
  }).catch(echec);
}
function position() {
  return new Promise(function (ok) {
    if (!navigator.geolocation) { ok(null); return; }
    navigator.geolocation.getCurrentPosition(function (g) { ok({ latitude: +g.coords.latitude.toFixed(6), longitude: +g.coords.longitude.toFixed(6), precision_m: Math.round(g.coords.accuracy) }); }, function () { ok(null); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
function marquerArbre(panelId, arbreId) {
  position().then(function (g) {
    if (!g) { etat.message = ['warn', 'Position GPS indisponible. Activez la localisation puis réessayez près de l’arbre.']; rendre(); return; }
    return L.panel(panelId).then(function (p) {
      var code = ''; (p.arbres || []).forEach(function (a) { if (a.id === arbreId) { a.latitude = g.latitude; a.longitude = g.longitude; code = a.code; } });
      return L.enregistrerPanel(p).then(function () { return L.mettreEnFile('ARBRE_MARQUER', { arbre_id: arbreId, latitude: g.latitude, longitude: g.longitude, precision_m: g.precision_m }, { entite: 'ARBRE', entite_id: arbreId, libelle: 'Marquage GPS de l’arbre ' + code }); });
    }).then(function () { etat.message = ['ok', 'Position enregistrée sur ce téléphone (précision ' + g.precision_m + ' m).']; synchroniser(false); rendre(); });
  }).catch(echec);
}
/* D2 · Désignation par le Chef d'Unité : enregistrée sur le téléphone (hors ligne possible),
   puis envoyée ; le serveur refait tous les contrôles et refuse les doublons. */
function designer(panelId) {
  var zone = document.getElementById('obsChoixArbres'), err = document.getElementById('obsChoixErr'); if (!zone) return;
  var choix = [].map.call(zone.querySelectorAll('.obs-choix-arbre'), function (l) { return { role: l.getAttribute('data-role'), bloc_id: l.querySelector('[data-choix=bloc]').value, numero: l.querySelector('[data-choix=num]').value }; });
  L.panel(panelId).then(function (p) {
    var proto = etat.protocole || {}, res = C.designerArbres(p, choix, proto.titulaires, proto.reserves);
    if (res.erreurs.length) { err.innerHTML = note(res.erreurs.map(esc).join('<br>'), 'danger'); err.scrollIntoView({ block: 'center' }); return; }
    var resume = res.arbres.map(function (a) { return (a.role === 'TITULAIRE' ? 'suivi ' : 'réserve ') + a.code; }).join(', ');
    return confirmer('Enregistrer le choix des arbres ?', 'Vous avez choisi : <b>' + esc(resume) + '</b>. Après confirmation, un arbre ne pourra être changé que par un remplacement motivé et daté.', 'Enregistrer').then(function (oui) {
      if (!oui) return;
      p.arbres = res.arbres; p.statut_local = 'ACTIF';
      return L.enregistrerPanel(p).then(function () {
        return L.mettreEnFile('ARBRES_DESIGNER', { panel_id: p.id, arbres: res.arbres.map(function (a) { return { bloc_id: a.bloc_id, numero: a.numero_inventaire, role: a.role }; }) },
          { entite: 'PANEL', entite_id: p.id, libelle: 'Choix des arbres : ' + (p.producteur_nom || 'champ') });
      }).then(function () { etat.message = ['ok', 'Arbres choisis et enregistrés sur ce téléphone. Marquez-les sur le terrain avec leur code.']; synchroniser(false); rendre(); });
    });
  }).catch(echec);
}
function activerReserve(arbreId, code) {
  dialogue('Remplacer l’arbre ' + code, '<p>À faire seulement si l’arbre ne peut plus être suivi (mort, coupé, inaccessible durablement). Ses observations passées sont conservées. Une réserve du champ devient arbre suivi. Réseau nécessaire.</p>' +
    '<label class="obs-champ-dialogue">Date à partir de laquelle le remplacement s’applique<input type="date" data-effet value="' + C.aujourdhui() + '" max="' + C.aujourdhui() + '"></label>' +
    '<textarea data-champ rows="3" class="obs-zone" placeholder="Motif du remplacement (obligatoire)"></textarea>', [['Annuler', false], ['Remplacer', true, 'primary']]).then(function (motif) {
    if (!motif) return;
    var effet = etat.dialogueEffet || C.aujourdhui();
    return rpc('pheno_reserve_activer', { p_arbre_remplace: arbreId, p_motif: motif, p_date_effet: effet }).then(function (r) {
      etat.message = ['ok', 'L’arbre ' + r.reserve_activee + ' remplace ' + r.arbre_remplace + ' à partir du ' + dateFr(r.date_effet) + '. Les anciennes observations sont conservées.'];
      var camp = campagne(); return client().then(function (c) { return L.preparer(c, camp.id); });
    }).catch(function (e) { etat.message = ['danger', e.message]; }).then(rendre);
  });
}

/* ------------------------------------------------------------------ Visite hebdomadaire */
function choix(nom, valeur, options) {
  return '<div class="obs-choix" role="radiogroup">' + options.map(function (o) {
    return '<button type="button" role="radio" aria-checked="' + (valeur === o[0]) + '" class="' + (valeur === o[0] ? 'actif' : '') + '" data-act="rep" data-champ="' + nom + '" data-val="' + esc(String(o[0])) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>';
}
var ONP = [['OUI', 'Oui'], ['NON', 'Non'], ['PAS_VU', 'Pas vu']];
/* Figée : soumise sur le serveur, OU soumise sur ce téléphone et pas encore refusée
   (on ne laisse pas modifier une soumission en attente : elle deviendrait un conflit). */
function figee(v) { return ['SOUMIS', 'EN_VERIFICATION', 'VALIDE'].indexOf(v.statut_serveur) >= 0 || (v.intention === 'SOUMETTRE' && v.etat_envoi !== 'REJETE' && v.etat_envoi !== 'CONFLIT' && v.etat_envoi !== 'RECU'); }
function chargerVisite(panelId, visiteId) {
  if (brouillon && brouillon.visite.id === visiteId && brouillon.panel.id === panelId) return Promise.resolve(brouillon);
  return Promise.all([L.panel(panelId), visiteId === 'nouvelle' ? null : L.visite(visiteId), L.visites(panelId)]).then(function (r) {
    var p = r[0]; if (!p) return null;
    var v = r[1], semaine = C.semaineIso(C.aujourdhui());
    if (!v && visiteId === 'nouvelle') v = r[2].filter(function (x) { return C.semaineIso(x.date_observation) === semaine; })[0] || null;
    if (!v) v = { id: /^[0-9a-f-]{36}$/i.test(visiteId) ? visiteId : C.uuid(), panel_id: p.id, date_observation: C.aujourdhui(), mode_saisie: 'DIRECT', ramassage: null, anomalies: null, observations: [], statut_serveur: null, etat_envoi: null, cree_le: new Date().toISOString() };
    var arbres = C.arbresObserves(p.arbres), par = {}; (v.observations || []).forEach(function (o) { par[o.arbre_id] = o; });
    v.observations = arbres.map(function (a) { return par[a.id] || C.observationVide(a.id); });
    /* S18 · Reprise après interruption : on revient au premier arbre non terminé, pas à l'arbre 1. */
    var k = v.observations.findIndex(function (o) { return !C.observationComplete(o); });
    brouillon = { panel: p, visite: v, arbres: arbres }; etat.idx = k < 0 ? Math.max(0, arbres.length - 1) : k; return brouillon;
  });
}
function vueVisite(panelId, visiteId, ecran) {
  if (!peutCollecter() && !peutPiloter()) return vueRefus();
  return Promise.all([chargerVisite(panelId, visiteId).then(function (b0) {
    if (!b0) return b0;
    var refs = b0.visite.observations.map(function (o) { return o.photo_ref; }).filter(Boolean);
    return L.fichiersDe(refs).then(function (f) { etat.photosEtat = {}; refs.forEach(function (c, k) { etat.photosEtat[c] = f[k] ? f[k].statut : (b0.visite.etat_envoi === 'RECU' ? 'RECU' : null); }); return b0; });
  }), L.referentiel()]).then(function (r) {
    var b = r[0]; if (!b) { peindre(entete('Champ introuvable sur cet appareil.', '') + note('Touchez « Préparer le hors-ligne » depuis « Mes champs ».', 'warn')); return; }
    if (visiteId === 'nouvelle') { history.replaceState(null, '', '#observatoire/visite/' + panelId + '/' + b.visite.id); }
    var n = nomParcelle(r[1], b.panel), v = b.visite, lecture = figee(v) || !peutCollecter();
    if (!b.arbres.length) { peindre(entete(n.producteur + ' — ' + n.parcelle, '') + note('Ce champ n’a pas encore d’arbres tirés. Terminez l’installation.', 'warn') + '<a class="btn secondary" href="#observatoire/champ/' + panelId + '">Fiche du champ</a>'); return; }
    /* Téléphone partagé : un brouillon non encore reçu appartient à son auteur ; un autre compte ne peut ni le reprendre ni l'envoyer. */
    if (v.proprietaire && v.proprietaire !== L.utilisateur() && v.etat_envoi !== 'RECU') {
      peindre(entete(n.producteur + ' — ' + n.parcelle, '') + note('Cette visite a été commencée sur ce téléphone par un <b>autre compte</b> et n’est pas encore reçue par le serveur. Elle ne peut être reprise ou envoyée que par son auteur. Rien n’a été modifié.', 'warn') + '<a class="btn secondary" href="#observatoire">Retour</a>');
      return;
    }
    if (ecran === 'resume' || lecture) return ecranResume(b, n, lecture);
    var i = Math.min(etat.idx, b.arbres.length - 1), a = b.arbres[i], o = v.observations[i], bloc = (b.panel.blocs || []).filter(function (x) { return x.id === a.bloc_id; })[0] || {};
    var pasVu = o.retrouve === false || [o.f, o.n, o.p, o.chute].indexOf('PAS_VU') >= 0;
    var corps = '<div class="obs-q"><h3>Avez-vous retrouvé cet arbre marqué ?</h3>' + choix('retrouve', o.retrouve, [[true, 'Oui'], [false, 'Non']]) + '</div>';
    if (o.retrouve === true) {
      corps += '<div class="obs-q"><h3>F · Voyez-vous des fleurs ouvertes ?</h3>' + choix('f', o.f, ONP) + '</div>' +
        '<div class="obs-q"><h3>N · Voyez-vous de jeunes noix ?</h3>' + choix('n', o.n, ONP) + '</div>' +
        '<div class="obs-q"><h3>P · Voyez-vous des pommes formées ?</h3>' + choix('p', o.p, ONP) + '</div>' +
        '<div class="obs-q"><h3>C · Y a-t-il des fruits tombés sous cet arbre ?</h3>' + choix('chute', o.chute, ['MURE', 'PREMATUREE', 'ABSENCE', 'NON_CONFIRME', 'PAS_VU'].map(function (k) { return [k, C.LIBELLES.chute[k]]; })) + '</div>';
      if (o.chute === 'MURE' || o.chute === 'PREMATUREE') corps += '<div class="obs-q"><h3>Comment le savez-vous ?</h3>' + choix('chute_preuve', o.chute_preuve, [['VUE_AGENT', C.LIBELLES.preuve.VUE_AGENT], ['DECLAREE_PRODUCTEUR', C.LIBELLES.preuve.DECLAREE_PRODUCTEUR]]) + '</div>';
    }
    if (pasVu) corps += '<div class="obs-q"><h3>' + (o.retrouve === false ? 'Pourquoi l’arbre n’a-t-il pas été retrouvé ?' : 'Pourquoi « Pas vu » ?') + '</h3>' + choix('pas_vu_motif', o.pas_vu_motif, C.LIBELLES.pas_vu.map(function (x) { return [x, x]; })) + '</div>';
    /* D5 · Une photo par arbre retrouvé, prise pendant la visite. Arbre introuvable : photo facultative
       du repère ou de l'emplacement, présentée comme telle (jamais comme une photo de l'arbre). */
    if (o.retrouve != null) {
      var etatPhoto = o.photo_ref ? (etat.photosEtat && etat.photosEtat[o.photo_ref] === 'RECU' ? badge('Photo reçue par FBMS', 'ok') : badge('Photo enregistrée sur ce téléphone, pas encore envoyée', 'warn')) + (o.photo_prise_le ? ' <span class="obs-detail">prise le ' + esc(heureFr(o.photo_prise_le)) + '</span>' : '') : '';
      corps += o.retrouve === true
        ? '<div class="obs-q obs-q-photo"><h3>Photo de cet arbre (obligatoire)</h3>' + (o.photo_exception ? note('Photo impossible : ' + esc(o.photo_exception) + '. Votre responsable verra cette exception.', 'warn') : '') + etatPhoto +
          '<label class="btn primary obs-photo">' + (o.photo_ref ? 'Reprendre la photo de l’arbre ' + esc(a.code) : 'Prendre la photo de l’arbre ' + esc(a.code)) + '<input type="file" accept="image/*" capture="environment" data-photo hidden></label>' +
          (o.photo_ref ? '' : '<button type="button" class="btn secondary obs-loin" data-act="photo_exception">Impossible de photographier ?</button>') + '</div>'
        : '<div class="obs-q obs-q-photo"><h3>Photo du repère ou de l’emplacement (facultatif)</h3><p class="obs-info">Cette photo montre l’endroit où l’arbre devrait être. Elle ne remplace pas une photo de l’arbre.</p>' + etatPhoto +
          '<label class="btn secondary obs-photo">' + (o.photo_ref ? 'Reprendre la photo de l’emplacement' : 'Photographier l’emplacement') + '<input type="file" accept="image/*" capture="environment" data-photo hidden></label></div>';
      corps += '<div class="obs-q"><h3>Anomalie sur cet arbre (facultatif)</h3><textarea class="obs-zone" rows="2" data-saisie="anomalie" maxlength="300" placeholder="Ex. branche cassée, feu, maladie">' + esc(o.anomalie || '') + '</textarea></div>';
    }
    peindre('<div class="obs-visite"><div class="obs-visite-tete"><a href="#observatoire" class="obs-retour">← Mes champs</a><div><b>' + esc(n.producteur) + '</b><span>' + esc(n.parcelle) + ' · observée le ' + dateFr(v.date_observation) + '</span></div></div>' +
      (v.statut_serveur === 'CORRECTION_DEMANDEE' ? note('<b>Correction demandée :</b> ' + esc(v.correction_motif || ''), 'warn') : '') +
      '<div class="obs-pastilles">' + b.arbres.map(function (x, k) { var oo = v.observations[k]; return '<button type="button" data-act="aller" data-i="' + k + '" class="' + (k === i ? 'courant ' : '') + (C.observationComplete(oo) ? 'fait' : oo.retrouve != null ? 'partiel' : '') + '" aria-label="Arbre ' + (k + 1) + '">' + ('0' + (k + 1)).slice(-2) + '</button>'; }).join('') + '</div>' +
      '<div class="obs-arbre"><div class="obs-arbre-tete"><span class="obs-numero">' + ('0' + (i + 1)).slice(-2) + '</span><div><b>Arbre ' + (i + 1) + ' sur ' + b.arbres.length + '</b><span>Code ' + esc(a.code) + ' · bloc ' + esc(bloc.numero || a.bloc_numero || '') + (bloc.repere ? ' (' + esc(bloc.repere) + ')' : '') + '</span></div></div>' + corps + '</div>' +
      '<div class="obs-pied"><button type="button" class="btn secondary" data-act="prec"' + (i === 0 ? ' disabled' : '') + '>Précédent</button>' +
      (i < b.arbres.length - 1 ? '<button type="button" class="btn primary" data-act="suiv">Arbre suivant</button>' : '<button type="button" class="btn primary" data-act="resume">Voir le résumé</button>') + '</div>' +
      '<p class="obs-info centre">Chaque réponse est enregistrée sur ce téléphone au fur et à mesure.</p></div>');
  });
}
function sauverBrouillon() { if (!brouillon) return Promise.resolve(); if (!brouillon.visite.proprietaire) brouillon.visite.proprietaire = L.utilisateur(); return L.enregistrerVisite(brouillon.visite); }
function repondre(champ, val) {
  if (!brouillon) return; var o = brouillon.visite.observations[etat.idx];
  if (champ === 'retrouve') { o.retrouve = val === 'true'; if (!o.retrouve) { o.f = o.n = o.p = o.chute = o.chute_preuve = null; } }
  else { o[champ] = val; if (champ === 'chute' && val !== 'MURE' && val !== 'PREMATUREE') o.chute_preuve = null; }
  if (o.retrouve !== false && [o.f, o.n, o.p, o.chute].indexOf('PAS_VU') < 0) o.pas_vu_motif = null;
  var y = global.scrollY; sauverBrouillon().then(function () { return rendre(); }).then(function () { global.scrollTo(0, y); });
}
function ecranResume(b, n, lecture) {
  var v = b.visite, erreurs = lecture ? [] : C.controlerVisite(v, b.arbres), val = function (x) { return x == null ? '<span class="obs-manque">—</span>' : esc({ OUI: 'Oui', NON: 'Non', PAS_VU: 'Pas vu' }[x] || x); };
  var lignes = b.arbres.map(function (a, k) { var o = v.observations[k], so = o.retrouve === false;
    val = function (x) { return so ? '<span class="obs-gris">sans objet</span>' : x == null ? '<span class="obs-manque">—</span>' : esc({ OUI: 'Oui', NON: 'Non', PAS_VU: 'Pas vu' }[x] || x); };
    return '<tr><td data-l="Arbre"><b>' + ('0' + (k + 1)).slice(-2) + '</b> ' + esc(a.code) + '</td><td data-l="Retrouvé">' + (o.retrouve == null ? '<span class="obs-manque">—</span>' : o.retrouve ? 'Oui' : 'Non') + '</td><td data-l="F">' + val(o.f) + '</td><td data-l="N">' + val(o.n) + '</td><td data-l="P">' + val(o.p) + '</td><td data-l="Chute">' + (o.chute ? esc(C.LIBELLES.chute[o.chute]) + (o.chute_preuve ? ' · ' + esc(C.LIBELLES.preuve[o.chute_preuve]) : '') : val(null)) + '</td><td data-l="Remarque">' + esc(o.pas_vu_motif || '') + (o.anomalie ? ' ' + esc(o.anomalie) : '') + '</td><td data-l="Photo">' +
      (o.photo_ref ? (etat.photosEtat && etat.photosEtat[o.photo_ref] === 'RECU' ? badge('Reçue', 'ok') : badge('Sur le téléphone', 'warn')) : o.photo_exception ? badge('Exception : ' + o.photo_exception, 'warn') : so ? '<span class="obs-gris">sans objet</span>' : '<span class="obs-manque">manquante</span>') + '</td>' + (lecture ? '' : '<td><button type="button" class="btn secondary" data-act="aller" data-i="' + k + '">Modifier</button></td>') + '</tr>'; }).join('');
  var envoi = v.etat_envoi === 'RECU' ? note('Envoyée et reçue par le serveur le ' + esc(heureFr(v.recu_serveur_le)) + '. Statut : <b>' + esc(C.LIBELLES.statut_visite[v.statut_serveur] || '') + '</b>.', 'ok')
    : v.etat_envoi === 'EN_ATTENTE' ? note('Votre visite est enregistrée sur ce téléphone. <b>Elle n’est pas encore envoyée.</b>', 'warn')
    : v.etat_envoi ? note(esc(C.LIBELLES.statut_envoi[v.etat_envoi] || v.etat_envoi) + (v.dernier_message ? ' : ' + esc(v.dernier_message) : ''), 'danger') : '';
  peindre('<div class="obs-visite"><div class="obs-visite-tete"><a href="#observatoire" class="obs-retour">← Mes champs</a><div><b>' + esc(n.producteur) + '</b><span>' + esc(n.parcelle) + ' · semaine ' + esc(C.semaineIso(v.date_observation)) + '</span></div></div>' + message() + envoi +
    (lecture && figee(v) ? note('Cette visite est ' + esc((C.LIBELLES.statut_visite[v.statut_serveur] || '').toLowerCase()) + ' : elle ne peut plus être modifiée ici. ' + (v.statut_serveur === 'VALIDE' ? '' : 'Votre responsable doit encore vérifier cette visite. ') + 'Une erreur se signale à votre responsable, qui demandera une correction.', 'info') : '') +
    (v.statut_serveur === 'CORRECTION_DEMANDEE' ? note('<b>Correction demandée :</b> ' + esc(v.correction_motif || ''), 'warn') : '') +
    '<section class="card"><div class="card-head"><h2>Résumé de la visite</h2></div><div class="table-wrap"><table class="obs-table"><thead><tr><th>Arbre</th><th>Retrouvé</th><th>F</th><th>N</th><th>P</th><th>Chute</th><th>Remarque</th><th>Photo</th>' + (lecture ? '' : '<th></th>') + '</tr></thead><tbody>' + lignes + '</tbody></table></div></section>' +
    (lecture ? '<section class="card"><p>Observée le <b>' + dateFr(v.date_observation) + '</b> · saisie le ' + esc(heureFr(v.saisie_le)) + ' · reçue par le serveur le ' + esc(heureFr(v.recu_serveur_le)) + '<br>Ramassage : ' + esc({ OUI: 'Oui', NON: 'Non', NE_SAIT_PAS: 'Ne sait pas' }[v.ramassage] || '—') + (v.anomalies ? '<br>Remarques : ' + esc(v.anomalies) : '') + '</p></section>'
    : '<section class="card obs-form"><div class="obs-duo"><div class="field"><label for="obsDate">Date d’observation sur le terrain</label><input id="obsDate" type="date" max="' + C.aujourdhui() + '" value="' + esc(v.date_observation) + '" data-visite="date_observation"></div>' +
      (v.date_observation && v.date_observation < String(v.saisie_le || new Date().toISOString()).slice(0, 10) ? '</div><div class="field"><label for="obsRetro">Pourquoi cette visite est-elle enregistrée après le jour de l’observation ? (obligatoire)</label><textarea id="obsRetro" class="obs-zone" rows="2" maxlength="300" data-visite="justification_retro" placeholder="Ex. recopie de la fiche papier du ' + dateFr(v.date_observation) + '">' + esc(v.justification_retro || '') + '</textarea><p class="obs-info">La date d’observation est conservée telle quelle. Votre responsable vérifiera cette visite avant qu’elle compte dans les suivis.</p></div><div class="obs-duo">' : '') +
      '<div class="field"><label for="obsMode">Mode de saisie</label><select id="obsMode" data-visite="mode_saisie"><option value="DIRECT"' + (v.mode_saisie !== 'TRANSCRIPTION_PAPIER' ? ' selected' : '') + '>J’ai observé moi-même</option><option value="TRANSCRIPTION_PAPIER"' + (v.mode_saisie === 'TRANSCRIPTION_PAPIER' ? ' selected' : '') + '>Je recopie la fiche papier d’un collègue</option></select></div></div>' +
      (v.mode_saisie === 'TRANSCRIPTION_PAPIER' ? '<div class="field"><label for="obsObservateur">Collègue qui a observé (réseau nécessaire pour charger la liste)</label><select id="obsObservateur" data-visite="observateur_id"><option value="">— Choisir —</option>' + (etat.collegues || []).map(function (c) { return '<option value="' + esc(c.user_id) + '"' + (v.observateur_id === c.user_id ? ' selected' : '') + '>' + esc(c.nom) + '</option>'; }).join('') + '</select></div>' : '') +
      '<div class="obs-q"><h3>Le producteur a-t-il ramassé des noix sous ces arbres depuis la dernière visite ?</h3>' + choix('ramassage', v.ramassage, [['OUI', 'Oui'], ['NON', 'Non'], ['NE_SAIT_PAS', 'Ne sait pas']]).replace(/data-act="rep"/g, 'data-act="repv"') + '</div>' +
      '<div class="field"><label for="obsAnomalies">Remarques sur le champ (facultatif)</label><textarea id="obsAnomalies" class="obs-zone" rows="2" maxlength="500" data-visite="anomalies">' + esc(v.anomalies || '') + '</textarea></div>' +
      (v.statut_serveur === 'CORRECTION_DEMANDEE' ? '<div class="field"><label for="obsMotif">Ce que vous avez corrigé (obligatoire)</label><textarea id="obsMotif" class="obs-zone" rows="2" maxlength="300" data-visite="motif_correction">' + esc(v.motif_correction || '') + '</textarea></div>' : '') + '</section>' +
      (erreurs.length ? note('<b>Avant de soumettre, complétez :</b><br>' + erreurs.map(esc).join('<br>'), 'warn') : note('La visite est complète.', 'ok')) +
      '<div class="obs-pied"><button type="button" class="btn secondary" data-act="brouillon">Enregistrer le brouillon</button><button type="button" class="btn primary" data-act="soumettre"' + (erreurs.length ? ' disabled' : '') + '>Terminer et soumettre</button></div>') +
    '</div>');
}
function finirVisite(soumettre) {
  if (!brouillon) return; var b = brouillon, v = b.visite;
  if (soumettre) {
    var e = C.controlerVisite(v, b.arbres);
    if (v.mode_saisie === 'TRANSCRIPTION_PAPIER' && !v.observateur_id) e.push('Désignez le collègue qui a observé.');
    if (v.statut_serveur === 'CORRECTION_DEMANDEE' && !String(v.motif_correction || '').trim()) e.push('Indiquez ce que vous avez corrigé.');
    if (e.length) { etat.message = ['warn', e.join(' ')]; rendre(); return; }
  }
  var n = b.panel.producteur_nom || 'champ';
  L.envoyerVisite(v, soumettre, (soumettre ? 'Visite soumise' : 'Brouillon de visite') + ' : ' + n + ' · ' + C.semaineIso(v.date_observation)).then(function () {
    etat.message = ['warn', (soumettre ? 'Votre visite est enregistrée sur ce téléphone. Elle n’est pas encore envoyée. ' : 'Brouillon enregistré sur ce téléphone, pas encore envoyé. ') + 'L’envoi se fera tout seul dès qu’il y aura du réseau.'];
    brouillon = null;
    return synchroniser(false);
  }).then(function () { aller('observatoire/visite/' + b.panel.id + '/' + v.id + '/resume'); }).catch(echec);
}
/* D5 · Compression contrôlée : côté le plus long ramené à 1600 px, JPEG qualité 0,78
   (preuve lisible, environ 150 à 400 Ko au lieu de 3 à 6 Mo). Si le téléphone ne sait pas
   recompresser, l'original est gardé tant qu'il fait moins de 6 Mo. */
function compresser(fichier) {
  return new Promise(function (ok) {
    if (!/^image\//.test(fichier.type || 'image/jpeg') || typeof document.createElement('canvas').toBlob !== 'function') { ok(fichier); return; }
    var url = URL.createObjectURL(fichier), img = new Image();
    img.onload = function () {
      try {
        var max = 1600, k = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        cv.toBlob(function (b) { ok(b && b.size < fichier.size ? b : fichier); }, 'image/jpeg', 0.78);
      } catch (e) { URL.revokeObjectURL(url); ok(fichier); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); ok(fichier); };
    img.src = url;
  });
}
function joindrePhoto(fichier) {
  if (!brouillon || !fichier) return; var camp = campagne(), u = L.utilisateur();
  if (!camp || !u) { etat.message = ['danger', 'Photo non enregistrée : profil ou campagne non chargés. Rechargez la page.']; rendre(); return; }
  var idx = etat.idx, a = brouillon.arbres[idx], visiteId = brouillon.visite.id, prise = new Date().toISOString();
  Promise.all([compresser(fichier), L.espace()]).then(function (r) {
    var blob = r[0], e = r[1];
    if (blob.size > 6 * 1024 * 1024) throw new Error('Photo trop lourde (6 Mo au plus).');
    if (e && e.libre != null && e.libre < blob.size * 4) throw new Error('Mémoire du téléphone pleine : envoyez vos données avant de prendre d’autres photos.');
    var chemin = camp.id + '/' + brouillon.panel.id + '/' + u + '/' + C.nomPhoto(visiteId, a.id, blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg');
    return L.ajouterFichier(chemin, blob, { visite_id: visiteId, arbre_id: a.id, prise_le: prise }).then(function () {
      var o = brouillon.visite.observations[idx]; o.photo_ref = chemin; o.photo_prise_le = prise; o.photo_exception = null;
      etat.message = ['ok', 'Photo de l’arbre ' + a.code + ' enregistrée sur ce téléphone (' + Math.round(blob.size / 1024) + ' Ko).'];
      return sauverBrouillon();
    }).then(function () {
      /* Position au moment de la photo, si le GPS répond vite ; sinon la photo reste valable sans position. */
      return position().then(function (g) { if (g && brouillon && brouillon.visite.id === visiteId) { var o = brouillon.visite.observations[idx]; if (o.photo_ref) { o.photo_latitude = g.latitude; o.photo_longitude = g.longitude; return sauverBrouillon(); } } });
    });
  }).catch(function (e) { etat.message = ['danger', e.message]; }).then(rendre);
}
/* D5 · Exception motivée : la visite pourra être soumise, mais le validateur devra la justifier. */
function exceptionPhoto() {
  if (!brouillon) return; var idx = etat.idx;
  dialogue('Photo impossible', '<p>Pourquoi ne pouvez-vous pas photographier cet arbre ? Votre responsable verra ce motif. Une visite avec exception n’est jamais validée automatiquement.</p><textarea data-champ rows="3" class="obs-zone" placeholder="Ex. téléphone en panne d’appareil photo, pluie forte"></textarea>',
    [['Annuler', false], ['Enregistrer', true, 'primary']]).then(function (m) {
    if (!m) return; brouillon.visite.observations[idx].photo_exception = m; return sauverBrouillon().then(rendre);
  });
}
/* Photo vue par le validateur : lien signé de courte durée, jamais public. */
function voirPhoto(ref) {
  client().then(function (c) { return c.storage.from(L.BUCKET).createSignedUrl(ref, 300); }).then(function (x) {
    if (x.error || !x.data) throw new Error(x.error ? x.error.message : 'Photo introuvable.');
    /* Recette APK 19/11 : window.open() après l'appel réseau était bloqué par la WebView
       (plus de geste utilisateur) : « Voir la photo » ne faisait rien. La photo s'affiche ici. */
    return dialogue('Photo de la visite', '<img class="obs-photo-vue" alt="Photo de l’arbre" src="' + esc(x.data.signedUrl) + '">', [['Fermer', false, 'primary']]);
  }).catch(function (e) { etat.message = ['danger', 'Photo non disponible : ' + e.message]; rendre(); });
}

/* ------------------------------------------------------------------ Envois */
function vueEnvois() {
  return L.file().then(function (l) {
    var lignes = l.slice().reverse().map(function (o) {
      var ton = { RECU: 'ok', EN_ATTENTE: 'warn', ECHEC_RESEAU: 'warn', ENVOI: 'info', REJETE: 'danger', CONFLIT: 'danger' }[o.statut];
      var autre = o.user_id && o.user_id !== L.utilisateur() && o.statut !== 'RECU';
      return '<tr><td data-l="Opération">' + esc(o.libelle) + (autre ? ' ' + badge('Autre compte : envoi réservé à son auteur', 'warn') : '') + '</td><td data-l="Saisie le">' + esc(heureFr(o.created_at_client)) + '</td><td data-l="État">' + badge(C.LIBELLES.statut_envoi[o.statut] || o.statut, ton) + (o.dernier_message ? '<div class="obs-detail">' + esc(o.dernier_message) + '</div>' : '') + '</td><td data-l="Reçu serveur">' + (o.statut === 'RECU' || o.statut === 'CONFLIT' ? esc(heureFr(o.recu_serveur_le)) : '—') + '</td><td>' + (o.statut === 'REJETE' ? '<button type="button" class="btn secondary" data-act="reessayer" data-cle="' + esc(o.idempotency_key) + '">Renvoyer</button>' : '') + '</td></tr>';
    }).join('');
    peindre(entete('Ce qui est sur ce téléphone, et ce que le serveur a réellement reçu.', 'envois', '<button type="button" class="btn primary" data-act="sync">Envoyer maintenant</button>') + message() +
      note('Une ligne n’est « reçue » que lorsque le serveur a répondu avec sa date de réception. Renvoyer une opération ne crée jamais de doublon.', 'info') +
      (lignes ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Opération</th><th>Saisie le</th><th>État</th><th>Reçu par le serveur</th><th></th></tr></thead><tbody>' + lignes + '</tbody></table></div>' : '<div class="ops-empty">Aucun envoi sur cet appareil.</div>'));
    barreEnvoi();
  });
}

/* ------------------------------------------------------------------ Validation (réseau) */
function horsReseau(actif) { peindre(entete('Écran de pilotage.', actif) + note('Cet écran a besoin du réseau. La collecte terrain, elle, fonctionne hors ligne.', 'warn')); }
function vueValidation(id) {
  if (!peutPiloter()) return vueRefus();
  if (!enLigne()) return horsReseau('validation');
  var camp = campagne(); if (!camp) { peindre(entete('Validation.', 'validation') + note('Aucune campagne sélectionnée.', 'warn')); return; }
  if (id) return vueDecision(id);
  return Promise.all([
    rpc('pheno_visites_a_traiter', { p_campaign: camp.id }),
    lireTable('pheno_corrections', 'id,visite_id,arbre_id,champ,ancienne_valeur,nouvelle_valeur,motif,origine,proposee_le', function (q) { return q.eq('statut', 'PROPOSEE').order('proposee_le'); }),
    lireTable('pheno_panels', 'id,producteur_id,village_id,cluster_code', function (q) { return q.eq('campaign_id', camp.id); })
  ]).then(function (r) {
    /* D4 · Liste lisible : qui, où, quoi, combien de preuves, et si c'est à MOI de décider. */
    r[0] = r[0] || [];
    var aMoi = r[0].filter(function (v) { return v.droit; }), autres = r[0].filter(function (v) { return !v.droit; });
    var ligne = function (v) {
      var ph = v.photos_attendues ? v.photos_recues + ' / ' + v.photos_attendues + (v.photos_exceptions ? ' · ' + v.photos_exceptions + ' exception(s)' : '') : '—';
      return '<tr><td data-l="Cluster">' + esc(v.cluster_code) + '</td><td data-l="Village">' + esc(v.village || '') + '</td><td data-l="Producteur">' + esc(v.producteur || '') + '</td><td data-l="Parcelle">' + esc(v.parcelle || '') + '</td><td data-l="Observateur">' + esc(v.observateur || '') + (v.role_observateur ? ' <span class="obs-detail">(' + esc(v.role_observateur === 'Unit Head' ? 'Chef d’Unité' : v.role_observateur === 'Assistant Unit Head' ? 'Assistant' : v.role_observateur) + ')</span>' : '') + '</td><td data-l="Observée le">' + dateFr(v.date_observation) + (v.temporalite !== 'NORMALE' ? ' ' + badge(v.temporalite === 'INCOHERENTE' ? 'Date à vérifier' : 'Saisie après coup', 'warn') : '') + '</td><td data-l="Photos reçues">' + (v.photos_attendues && v.photos_recues < v.photos_attendues && !v.photos_exceptions ? badge(ph, 'warn') : ph) + '</td><td data-l="Statut">' + badge(C.LIBELLES.statut_visite[v.statut], tonStatut(v.statut)) + (v.mode_saisie === 'TRANSCRIPTION_PAPIER' ? ' ' + badge('Fiche papier', 'warn') : '') + '</td><td><a class="btn ' + (v.droit ? 'primary' : 'secondary') + '" href="#observatoire/validation/' + v.visite_id + '">' + (v.droit ? 'Traiter' : 'Voir') + '</a></td></tr>'; };
    var tete = '<thead><tr><th>Cluster</th><th>Village</th><th>Producteur</th><th>Parcelle</th><th>Observateur</th><th>Observée le</th><th>Photos reçues</th><th>Statut</th><th></th></tr></thead>';
    var lignes = aMoi.map(ligne).join('');
    var lignesAutres = autres.length ? '<section class="card"><div class="card-head"><h2>Autres visites de votre périmètre (' + autres.length + ')</h2><p>Vous ne les validez pas : soit vous les avez observées, soit leur validateur est une autre personne (Chef d’Unité pour un Assistant, Chef de Zone pour un Chef d’Unité).</p></div><div class="table-wrap"><table class="obs-table">' + tete + '<tbody>' + autres.map(ligne).join('') + '</tbody></table></div></section>' : '';
    var props = r[1].map(function (c) {
      return '<tr><td data-l="Champ modifié">' + esc(c.champ) + '</td><td data-l="Valeur serveur">' + esc(c.ancienne_valeur == null ? '—' : c.ancienne_valeur) + '</td><td data-l="Valeur proposée">' + esc(c.nouvelle_valeur == null ? '—' : c.nouvelle_valeur) + '</td><td data-l="Origine">' + (c.origine === 'CONFLIT_HORS_LIGNE' ? 'Envoi hors ligne tardif' : 'Auteur') + '</td><td data-l="Le">' + esc(heureFr(c.proposee_le)) + '</td><td><a class="btn secondary" href="#observatoire/validation/' + c.visite_id + '">Voir la visite</a> <button type="button" class="btn primary" data-act="corr" data-id="' + esc(c.id) + '" data-dec="APPLIQUEE">Appliquer</button> <button type="button" class="btn secondary" data-act="corr" data-id="' + esc(c.id) + '" data-dec="REJETEE">Rejeter</button></td></tr>'; }).join('');
    peindre(entete('Vérifier, demander une correction, valider. Vos droits réels sont décidés par le serveur.', 'validation') + message() +
      '<section class="card"><div class="card-head"><h2>Visites à traiter par vous (' + aMoi.length + ')</h2>' + (classe() === 'BM' ? '<p>Branch Manager : supervision des six clusters. Une validation par vous est une <b>exception</b>, avec justification obligatoire, tracée au journal.</p>' : '') + '</div>' + (lignes ? '<div class="table-wrap"><table class="obs-table">' + tete + '<tbody>' + lignes + '</tbody></table></div>' : '<div class="ops-empty">Aucune visite ne vous attend.</div>') + '</section>' + lignesAutres +
      '<section class="card"><div class="card-head"><h2>Propositions de correction (' + r[1].length + ')</h2><p>Une visite soumise ou validée n’est jamais écrasée : les écarts arrivent ici.</p></div>' + (props ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Champ modifié</th><th>Valeur serveur</th><th>Valeur proposée</th><th>Origine</th><th>Le</th><th></th></tr></thead><tbody>' + props + '</tbody></table></div>' : '<div class="ops-empty">Aucune proposition en attente.</div>') + '</section>');
  }).catch(function (e) { peindre(entete('Validation.', 'validation') + note(esc(e.message), 'danger')); });
}
function vueDecision(id) {
  return Promise.all([
    lireTable('pheno_visites', '*', function (q) { return q.eq('id', id); }),
    lireTable('pheno_observations', '*', function (q) { return q.eq('visite_id', id); }),
    lireTable('pheno_journal', 'le,action,ancienne,nouvelle,motif', function (q) { return q.eq('entite_id', id).order('le'); }),
    rpc('pheno_visites_a_traiter', { p_campaign: (campagne() || {}).id }).catch(function () { return []; })
  ]).then(function (r) {
    var v = r[0][0]; if (!v) { peindre(entete('Visite introuvable dans votre périmètre.', 'validation')); return; }
    var info = (r[3] || []).filter(function (x) { return x.visite_id === id; })[0] || {};
    etat.decision = { id: id, droit: info.droit || null, exceptions: info.photos_exceptions || 0, temporalite: v.temporalite };
    return lireTable('pheno_arbres', 'id,code,role,rang,statut', function (q) { return q.eq('panel_id', v.panel_id); }).then(function (arbres) {
      var par = {}; arbres.forEach(function (a) { par[a.id] = a; });
      var t = function (x) { return x == null ? '—' : esc({ OUI: 'Oui', NON: 'Non', PAS_VU: 'Pas vu' }[x] || x); };
      var lignes = r[1].sort(function (a, b) { return (par[a.arbre_id] || {}).rang - (par[b.arbre_id] || {}).rang; }).map(function (o) { var a = par[o.arbre_id] || {};
        return '<tr><td data-l="Arbre">' + esc(a.code || '') + '</td><td data-l="Retrouvé">' + (o.retrouve == null ? '—' : o.retrouve ? 'Oui' : 'Non') + '</td><td data-l="F">' + t(o.f) + '</td><td data-l="N">' + t(o.n) + '</td><td data-l="P">' + t(o.p) + '</td><td data-l="Chute">' + (o.chute ? esc(C.LIBELLES.chute[o.chute]) : '—') + '</td><td data-l="Preuve">' + (o.chute_preuve ? esc(C.LIBELLES.preuve[o.chute_preuve]) : '—') + '</td><td data-l="Remarque">' + esc(o.pas_vu_motif || '') + ' ' + esc(o.anomalie || '') + '</td><td data-l="Photo">' +
          (o.photo_ref ? '<button type="button" class="btn secondary" data-act="voir_photo" data-ref="' + esc(o.photo_ref) + '">' + (o.retrouve === false ? 'Voir l’emplacement' : 'Voir la photo') + '</button>' + (o.photo_prise_le ? ' <span class="obs-detail">' + esc(heureFr(o.photo_prise_le)) + (o.photo_latitude != null ? ' · GPS' : '') + '</span>' : '')
            : o.photo_exception ? badge('Exception : ' + o.photo_exception, 'warn') : o.retrouve ? badge('Manquante', 'danger') : '—') + '</td></tr>'; }).join('');
      var hist = r[2].map(function (j) { return '<li><b>' + esc(heureFr(j.le)) + '</b> · ' + esc(j.action.replace(/_/g, ' ').toLowerCase()) + (j.motif ? ' — ' + esc(j.motif) : '') + '</li>'; }).join('');
      /* D4 · Les boutons n'apparaissent que si le serveur dit que c'est à vous (le serveur revérifie de toute façon). */
      var ouverte = v.statut === 'SOUMIS' || v.statut === 'EN_VERIFICATION', aide = !!etat.decision.droit;
      var pourquoi = !ouverte ? '' : aide ? (etat.decision.droit === 'EXCEPTIONNEL' ? note('Vous n’êtes pas le validateur ordinaire de cette visite : une décision de votre part est une <b>exception</b>, justification obligatoire.', 'warn') : '')
        : note(auteurDe(v) ? 'Vous avez observé ou saisi cette visite : vous ne pouvez ni la vérifier ni la valider.' : 'Cette visite est validée par une autre personne (Chef d’Unité pour un Assistant, Chef de Zone pour un Chef d’Unité).', 'info');
      peindre(entete('Visite ' + v.semaine_iso + ' · cluster ' + v.cluster_code, 'validation', '<a class="btn secondary" href="#observatoire/validation">Retour</a>') + message() +
        '<section class="card"><p>Statut : ' + badge(C.LIBELLES.statut_visite[v.statut], tonStatut(v.statut)) + ' · observée le <b>' + dateFr(v.date_observation) + '</b> · saisie le ' + esc(heureFr(v.saisie_le)) + ' · reçue par le serveur le ' + esc(heureFr(v.recu_serveur_le)) + (v.mode_saisie === 'TRANSCRIPTION_PAPIER' ? ' · ' + badge('Fiche papier recopiée', 'warn') : '') + '<br>Ramassage : ' + esc({ OUI: 'Oui', NON: 'Non', NE_SAIT_PAS: 'Ne sait pas' }[v.ramassage] || '—') + (v.anomalies ? ' · Remarques : ' + esc(v.anomalies) : '') + (v.correction_motif ? '<br>Correction demandée : ' + esc(v.correction_motif) : '') + '</p>' +
        (ouverte && aide ? '<div class="obs-actions">' + (v.statut === 'SOUMIS' ? '<button type="button" class="btn secondary" data-act="dec" data-dec="verifier" data-id="' + esc(v.id) + '" data-v="' + v.row_version + '">Mettre en vérification</button>' : '') + '<button type="button" class="btn signal" data-act="dec" data-dec="corriger" data-id="' + esc(v.id) + '" data-v="' + v.row_version + '">Demander une correction</button><button type="button" class="btn primary" data-act="dec" data-dec="valider" data-id="' + esc(v.id) + '" data-v="' + v.row_version + '">Valider</button></div>' : '') + pourquoi + (v.temporalite !== 'NORMALE' ? note('<b>Saisie après le jour de l’observation</b>' + (v.temporalite === 'INCOHERENTE' ? ' (date incohérente avec la campagne ou le champ)' : '') + '. Justification de l’agent : ' + esc(v.justification_retro || '—') + '. Elle n’entre pas dans les suivis ordinaires sans votre décision justifiée.', 'warn') : '') + '</section>' +
        '<section class="card"><div class="card-head"><h2>Observations (' + r[1].length + ' arbres)</h2></div><div class="table-wrap"><table class="obs-table"><thead><tr><th>Arbre</th><th>Retrouvé</th><th>F</th><th>N</th><th>P</th><th>Chute</th><th>Preuve</th><th>Remarque</th><th>Photo</th></tr></thead><tbody>' + lignes + '</tbody></table></div></section>' +
        '<section class="card"><div class="card-head"><h2>Historique</h2></div>' + (hist ? '<ul class="obs-histo">' + hist + '</ul>' : '<div class="ops-empty">Aucun événement.</div>') + '</section>');
    });
  }).catch(function (e) { peindre(entete('Validation.', 'validation') + note(esc(e.message), 'danger')); });
}
function auteurDe(v) { var u = L.utilisateur(); return !!u && (v.observateur_id === u || v.transcripteur_id === u); }
function decider(dec, id, version) {
  var p;
  if (dec === 'verifier') p = rpc('pheno_visite_verifier', { p_visite: id, p_version: version });
  else if (dec === 'valider') {
    var d = etat.decision && etat.decision.id === id ? etat.decision : {};
    var justif = d.droit === 'EXCEPTIONNEL' || d.exceptions > 0 || (d.temporalite && d.temporalite !== 'NORMALE');
    p = (justif ? demanderMotif('Valider cette visite : justification', (d.droit === 'EXCEPTIONNEL' ? 'Validation exceptionnelle par le Branch Manager. ' : '') + (d.exceptions ? d.exceptions + ' photo(s) manquent avec un motif. ' : '') + (d.temporalite && d.temporalite !== 'NORMALE' ? 'Visite saisie après coup. ' : '') + 'Expliquez pourquoi vous validez malgré tout. La justification est conservée dans l’historique.')
      : confirmer('Valider cette visite ?', 'Une visite validée alimente les suivis pilotes et ne peut plus être modifiée que par une correction tracée.', 'Valider'))
      .then(function (oui) { return oui ? rpc('pheno_visite_valider', { p_visite: id, p_version: version, p_justification: typeof oui === 'string' ? oui : null }) : null; });
  }
  else p = demanderMotif('Demander une correction', 'Expliquez à l’agent ce qu’il doit revoir. Le motif est conservé dans l’historique.').then(function (m) { return m ? rpc('pheno_visite_demander_correction', { p_visite: id, p_motif: m, p_version: version }) : null; });
  p.then(function (r) { if (r) etat.message = ['ok', 'Décision enregistrée : ' + (C.LIBELLES.statut_visite[r.statut_visite] || '') + '.']; }).catch(function (e) { etat.message = ['danger', e.message]; }).then(rendre);
}
function deciderCorrection(id, dec) {
  demanderMotif(dec === 'APPLIQUEE' ? 'Appliquer la correction' : 'Rejeter la proposition', 'Le motif est obligatoire et conservé dans l’historique.').then(function (m) {
    if (!m) return; return rpc('pheno_correction_decider', { p_correction: id, p_decision: dec, p_motif: m }).then(function () { etat.message = ['ok', 'Décision enregistrée.']; }).catch(function (e) { etat.message = ['danger', e.message]; }).then(rendre);
  });
}

/* ------------------------------------------------------------------ Qualité (réseau) */
function pct(x) { return x == null ? '—' : (Math.round(x * 1000) / 10).toLocaleString('fr-FR') + ' %'; }
function vueQualite() {
  if (!peutPiloter()) return vueRefus();
  if (!enLigne()) return horsReseau('qualite');
  var camp = campagne(); if (!camp) { peindre(entete('Qualité.', 'qualite') + note('Aucune campagne sélectionnée.', 'warn')); return; }
  return Promise.all([
    lireTable('pheno_v_qualite', '*', function (q) { return q.eq('campaign_id', camp.id).order('semaine_iso', { ascending: false }).order('cluster_code'); }),
    lireTable('pheno_v_c_cumulatif_cluster', '*', function (q) { return q.eq('campaign_id', camp.id).order('semaine_iso', { ascending: false }).order('cluster_code'); }),
    lireTable('pheno_panels', 'id,cluster_code,statut,pi_village,pi_champ,reserves_manquantes', function (q) { return q.eq('campaign_id', camp.id); }),
    lireTable('pheno_v_supervision', '*', function (q) { return q.eq('campaign_id', camp.id).order('cluster_code'); }).catch(function () { return []; }),
    ['BM', 'ABM', 'ZH'].indexOf(classe()) >= 0 ? rpc('pheno_preparation_clusters', { p_campaign: camp.id }).catch(function () { return null; }) : Promise.resolve(null)
  ]).then(function (r) {
    /* §8 · Supervision : uniquement ce que le serveur a reçu (une visite restée sur un téléphone n'y figure pas). */
    var sup = (r[3] || []).map(function (s) {
      return '<tr><td data-l="Cluster"><b>' + esc(s.cluster_code) + '</b></td><td data-l="Champs actifs">' + s.champs_actifs + (s.champs_en_preparation ? ' <span class="obs-detail">+' + s.champs_en_preparation + ' en préparation</span>' : '') + '</td><td data-l="Visites manquantes cette semaine">' + (s.visites_semaine_manquantes ? badge(s.visites_semaine_manquantes, 'warn') : '0') + '</td><td data-l="Soumises">' + s.soumises + '</td><td data-l="En vérification">' + s.en_verification + '</td><td data-l="Corrections">' + s.corrections_demandees + '</td><td data-l="Validées">' + s.validees + '</td><td data-l="Bloquées > 72 h">' + (s.validations_bloquees_72h ? badge(s.validations_bloquees_72h, 'danger') : '0') + '</td><td data-l="Photos reçues">' + s.photos_recues + ' / ' + s.photos_attendues + (s.exceptions_photo ? ' · ' + s.exceptions_photo + ' exception(s)' : '') + '</td><td data-l="Dates à vérifier">' + (s.anomalies_temporelles ? badge(s.anomalies_temporelles, 'warn') : '0') + '</td><td data-l="Arbres introuvables">' + s.arbres_introuvables + '</td><td data-l="Remplacements">' + s.remplacements_arbres + '</td><td data-l="Validations exceptionnelles">' + s.validations_exceptionnelles + '</td></tr>'; }).join('');
    var prep = r[4] ? r[4].map(function (c) {
      var st = { PRET_TECHNIQUE: ['Prêt techniquement', 'ok'], PARTIEL: ['Partiel', 'warn'], NON_PRET: ['Non prêt', 'danger'] }[c.statut] || [c.statut, ''];
      return '<tr><td data-l="Cluster"><b>' + esc(c.cluster_code) + '</b> <span class="obs-detail">' + esc(c.zone_code || '') + '</span></td><td data-l="Parcelles complètes / registre">' + c.parcelles_eligibles + ' / ' + c.parcelles_registre + '</td><td data-l="Champs installés">' + c.parcelles_installees + ' (' + c.champs_actifs + ' actifs)</td><td data-l="Chefs d’Unité">' + c.chefs_unite + '</td><td data-l="Assistants">' + c.assistants + '</td><td data-l="Chef de Zone">' + c.chef_zone + '</td><td data-l="Statut">' + badge(st[0], st[1]) + '</td><td data-l="À régler">' + esc((c.motifs || []).join(' ; ')) + '</td></tr>'; }).join('') : '';
    var p = r[2], actifs = p.filter(function (x) { return x.statut === 'ACTIF'; }).length, sansPi = p.filter(function (x) { return x.statut === 'ACTIF' && (x.pi_village == null || x.pi_champ == null); }).length;
    var q = r[0].map(function (x) { var couv = x.champs_actifs ? x.visites / x.champs_actifs : null;
      return '<tr><td data-l="Semaine">' + esc(x.semaine_iso) + '</td><td data-l="Cluster">' + esc(x.cluster_code) + '</td><td data-l="Champs actifs">' + x.champs_actifs + '</td><td data-l="Visites reçues">' + x.visites + ' (' + pct(couv) + ')</td><td data-l="Brouillons">' + x.brouillons + '</td><td data-l="À traiter">' + (x.soumises + x.en_verification) + '</td><td data-l="Corrections">' + x.corrections_demandees + '</td><td data-l="Validées">' + x.validees + '</td><td data-l="Fiches papier">' + x.transcriptions_papier + '</td><td data-l="Reçues après 48 h">' + x.recues_apres_48h + '</td><td data-l="Arbres non retrouvés">' + x.arbres_non_retrouves + '</td><td data-l="Arbres avec « Pas vu »">' + x.arbres_avec_pas_vu + '</td><td data-l="Écarts en attente">' + x.corrections_en_attente + '</td></tr>'; }).join('');
    var c = r[1].map(function (x) { var pal = { DESCRIPTIF_SANS_PALIER: ['Descriptif : pas de palier', ''], COUVERTURE_INSUFFISANTE: ['Couverture insuffisante', ''], AUCUN: ['Aucun palier', ''], PREALERTE_10: ['Préalerte 10 %', 'warn'], PREALERTE_20: ['Préalerte 20 %', 'warn'], PREALERTE_30: ['Préalerte 30 %', 'danger'] }[x.palier_experimental] || [x.palier_experimental, ''];
      return '<tr><td data-l="Semaine">' + esc(x.semaine_iso) + '</td><td data-l="Cluster">' + esc(x.cluster_code) + '</td><td data-l="Champs validés">' + x.champs_valides + ' / ' + x.champs_actifs + ' (' + pct(x.couverture) + ')' + (x.champs_incompatibles ? ' · ' + x.champs_incompatibles + ' incompatible(s)' : '') + '</td><td data-l="Part d’arbres avec chute de fruits mûrs (cumul)">' + pct(x.part_c_cumulatif_ratio) + '</td><td data-l="Estimation">' + (x.type_estimation === 'SUIVI_ARBRES_DESIGNES' ? 'Arbres désignés : descriptif, non représentatif' : x.type_estimation === 'PLAN_COMPLET' ? 'Pondérée (plan complet)' : 'Descriptive (pondération intra-champ)') + '</td><td data-l="Palier expérimental">' + badge(pal[0], pal[1]) + '</td></tr>'; }).join('');
    peindre(entete('Tableau de bord : préparation des six clusters, supervision et qualité des données.', 'qualite') +
      (prep ? '<section class="card"><div class="card-head"><h2>Préparation des clusters</h2><p>Faits relevés dans la base. Un cluster « prêt techniquement » n’est pas encore autorisé pour la collecte officielle : il faut aussi les agents formés, les téléphones testés et une première visite réelle vérifiée.</p></div><div class="table-wrap"><table class="obs-table"><thead><tr><th>Cluster</th><th>Parcelles complètes / registre</th><th>Champs installés</th><th>Chefs d’Unité</th><th>Assistants</th><th>Chef de Zone</th><th>Statut</th><th>À régler</th></tr></thead><tbody>' + prep + '</tbody></table></div></section>' : '') +
      '<section class="card"><div class="card-head"><h2>Supervision des visites</h2><p>Ce que FBMS a reçu. Une visite restée sur un téléphone sans réseau n’apparaît pas ici.</p></div>' + (sup ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Cluster</th><th>Champs actifs</th><th>Visites manquantes cette semaine</th><th>Soumises</th><th>En vérification</th><th>Corrections</th><th>Validées</th><th>Bloquées &gt; 72 h</th><th>Photos reçues</th><th>Dates à vérifier</th><th>Introuvables</th><th>Remplacements</th><th>Validations exceptionnelles</th></tr></thead><tbody>' + sup + '</tbody></table></div>' : '<div class="ops-empty">Aucun champ installé dans votre périmètre.</div>') + '</section>' +
      '<div class="kpi-grid"><div class="kpi"><small>Champs installés</small><b>' + p.length + '</b><span>' + actifs + ' actifs</span></div><div class="kpi ' + (p.length - actifs ? 'attn' : '') + '"><small>Installation en cours ou incompatible</small><b>' + (p.length - actifs) + '</b><span>à traiter</span></div><div class="kpi ' + (sansPi ? 'attn' : '') + '"><small>Probabilités amont non renseignées</small><b>' + sansPi + '</b><span>poids limités au champ</span></div></div>' +
      '<section class="card"><div class="card-head"><h2>Qualité par semaine et par cluster</h2><p>Tous statuts confondus. Outil de pilotage de la collecte.</p></div>' + (q ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Semaine</th><th>Cluster</th><th>Champs actifs</th><th>Visites reçues</th><th>Brouillons</th><th>À traiter</th><th>Corrections</th><th>Validées</th><th>Fiches papier</th><th>Reçues après 48 h</th><th>Non retrouvés</th><th>« Pas vu »</th><th>Écarts</th></tr></thead><tbody>' + q + '</tbody></table></div>' : '<div class="ops-empty">Aucune visite reçue pour cette campagne.</div>') + '</section>' +
      '<section class="card"><div class="card-head"><h2>Chute de fruits mûrs, cumul (PILOTE)</h2><p>Visites validées uniquement. Titulaires seulement : réserves (même activées) et brouillons exclus. Ratio pondéré sur l’ensemble des arbres des champs validés.</p></div>' + note('<b>Non officiel.</b> Paliers 10/20/30 % expérimentaux : simple préalerte, sans intervalle de confiance, affichée seulement si les probabilités de tirage sont toutes connues et la couverture suffisante. Aucune prévision ni tonnage ne peut en être tiré en 2027.', 'warn') + (c ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Semaine</th><th>Cluster</th><th>Champs validés</th><th>Part d’arbres avec chute de fruits mûrs (cumul)</th><th>Estimation</th><th>Palier expérimental</th></tr></thead><tbody>' + c + '</tbody></table></div>' : '<div class="ops-empty">Aucune visite validée.</div>') + '</section>');
  }).catch(function (e) { peindre(entete('Qualité.', 'qualite') + note(esc(e.message), 'danger')); });
}

/* ------------------------------------------------------------------ Affectations (BM, réseau) */
function vueAffectations() {
  if (classe() !== 'BM') return vueRefus();
  if (!enLigne()) return horsReseau('affectations');
  var camp = campagne(); if (!camp) { peindre(entete('Affectations.', 'affectations') + note('Aucune campagne sélectionnée.', 'warn')); return; }
  return Promise.all([
    lireTable('pheno_affectations', '*', function (q) { return q.eq('campaign_id', camp.id).order('created_at', { ascending: false }); }),
    lireTable('profils', 'user_id,nom,role', function (q) { return q.eq('actif', true).in('role', ['Zonal Head', 'Unit Head', 'Assistant Branch Manager']).order('nom'); }),
    lireTable('aflp_clusters', 'code,label', function (q) { return q.order('code'); }),
    lireTable('pheno_graines', 'campaign_id,graine,cree_le', function (q) { return q.eq('campaign_id', camp.id); }).then(function (l) { return l[0] || null; })
  ]).then(function (r) {
    var noms = {}; r[1].forEach(function (x) { noms[x.user_id] = x.nom + ' (' + x.role + ')'; });
    var lignes = r[0].map(function (a) { var exp = a.valide_au && a.valide_au < C.aujourdhui();
      return '<tr><td data-l="Personne">' + esc(noms[a.user_id] || a.user_id) + '</td><td data-l="Droit">' + (a.droit === 'VALIDATION' ? 'Validation finale' : 'Vérification') + '</td><td data-l="Clusters">' + esc((a.cluster_codes || []).join(', ')) + '</td><td data-l="Période">' + dateFr(a.valide_du) + ' → ' + (a.valide_au ? dateFr(a.valide_au) : 'sans fin') + '</td><td data-l="État">' + (!a.actif ? badge('Révoquée') : exp ? badge('Expirée', 'warn') : badge('Active', 'ok')) + '</td><td>' + (a.actif ? '<button type="button" class="btn secondary" data-act="revoquer" data-id="' + esc(a.id) + '">Révoquer</button>' : '') + '</td></tr>'; }).join('');
    peindre(entete('Qui peut vérifier et valider, sur quels clusters, pour quelle période.', 'affectations') + message() +
      '<section class="card"><div class="card-head"><h2>Graine de tirage de la campagne</h2></div>' + (r[3] ? '<p>Créée le ' + esc(heureFr(r[3].cree_le)) + '. Immuable. Empreinte : <code>' + esc(r[3].graine.slice(0, 12)) + '…</code></p>'
        : '<p>Aucune graine : aucune installation de champ n’est possible. Créez-la <b>une seule fois, avant toute installation</b>. Elle est tirée au hasard par le serveur et ne pourra plus être changée.</p><div class="obs-actions"><button type="button" class="btn primary" data-act="graine">Créer la graine de la campagne</button></div>') + '</section>' +
      note('Ces droits sont propres à l’Observatoire : ils ne donnent aucun autre accès dans FBMS. Un Assistant Unit Head ou un RT ne peut pas recevoir de droit de validation.', 'info') +
      '<form id="obsAff" class="card obs-form"><div class="card-head"><h2>Nouvelle affectation</h2></div><div class="obs-duo"><div class="field"><label for="affUser">Personne</label><select id="affUser" required><option value="">— Choisir —</option>' + r[1].map(function (x) { return '<option value="' + esc(x.user_id) + '">' + esc(x.nom) + ' (' + esc(x.role) + ')</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="affDroit">Droit</label><select id="affDroit"><option value="VALIDATION">Validation finale</option><option value="VERIFICATION">Vérification</option></select></div></div>' +
      '<fieldset class="obs-cases"><legend>Clusters</legend>' + r[2].map(function (c) { return '<label><input type="checkbox" name="cl" value="' + esc(c.code) + '"> ' + esc(c.label || c.code) + '</label>'; }).join('') + '</fieldset>' +
      '<div class="obs-duo"><div class="field"><label for="affDu">Du</label><input id="affDu" type="date" value="' + C.aujourdhui() + '" required></div><div class="field"><label for="affAu">Au (facultatif)</label><input id="affAu" type="date"></div></div>' +
      '<div class="field"><label for="affMotif">Motif</label><input id="affMotif" type="text" maxlength="200" required></div><div id="affErr"></div><div class="obs-actions"><button type="submit" class="btn primary">Accorder</button></div></form>' +
      '<section class="card"><div class="card-head"><h2>Affectations de la campagne</h2></div>' + (lignes ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Personne</th><th>Droit</th><th>Clusters</th><th>Période</th><th>État</th><th></th></tr></thead><tbody>' + lignes + '</tbody></table></div>' : '<div class="ops-empty">Aucune affectation.</div>') + '</section>');
  }).catch(function (e) { peindre(entete('Affectations.', 'affectations') + note(esc(e.message), 'danger')); });
}
function accorder(form) {
  var cl = [].map.call(form.querySelectorAll('input[name=cl]:checked'), function (x) { return x.value; }), err = form.querySelector('#affErr');
  if (!cl.length) { err.innerHTML = note('Cochez au moins un cluster.', 'danger'); return; }
  rpc('pheno_affectation_accorder', { p: { campaign_id: campagne().id, user_id: form.querySelector('#affUser').value, droit: form.querySelector('#affDroit').value, cluster_codes: cl,
    valide_du: form.querySelector('#affDu').value, valide_au: form.querySelector('#affAu').value || null, motif: form.querySelector('#affMotif').value } })
    .then(function () { etat.message = ['ok', 'Affectation accordée.']; rendre(); }).catch(function (e) { err.innerHTML = note(esc(e.message), 'danger'); });
}

/* ------------------------------------------------------------------ routeur et événements */
function rendre(p) {
  p = Array.isArray(p) ? p : parts();   /* appelé aussi en fin de promesse : toute autre valeur est ignorée */
  if (p[0] !== 'observatoire') return Promise.resolve();
  if (!C || !L) { peindre(note('Module Observatoire incomplet : rechargez la page avec du réseau.', 'danger')); return Promise.resolve(); }
  if (!global.ANAGROCI_AUTH) { peindre('<div class="ops-empty">Chargement de votre profil…</div>'); return Promise.resolve(); }
  if (!classe()) { vueRefus(); return Promise.resolve(); }
  var v = p[1] || '';
  if (v !== 'visite') brouillon = null;
  return Promise.resolve(
    v === 'installer' ? vueInstaller() : v === 'champ' ? vueChamp(p[2]) : v === 'visite' ? vueVisite(p[2], p[3], p[4]) : v === 'envois' ? vueEnvois()
    : v === 'validation' ? vueValidation(p[2]) : v === 'qualite' ? vueQualite() : v === 'affectations' ? vueAffectations() : vueChamps()
  ).catch(function (e) { console.error('[OBSERVATOIRE]', e); peindre(entete('Rubrique indisponible.', '') + note(esc(e && e.message ? e.message : 'Erreur inconnue'), 'danger')); });
}
function surClic(e) {
  if (parts()[0] !== 'observatoire') return;
  var b = e.target.closest('[data-act]'); if (!b || !root() || !root().contains(b)) return;
  var act = b.getAttribute('data-act');
  if (act === 'sync') { b.disabled = true; synchroniser(true); }
  else if (act === 'preparer') {
    var camp = campagne(); if (!camp) return; b.disabled = true; b.textContent = 'Préparation…';
    client().then(function (c) { if (!c || !enLigne()) throw new Error('Pas de réseau : la préparation hors-ligne se fait avec une connexion.'); return L.synchroniser(c).then(function () { return L.preparer(c, camp.id); }); })
      .then(function (r) { etat.message = r.graine || r.mode === 'DESIGNATION' ? ['ok', 'Téléphone prêt pour le terrain : ' + r.champs + ' champ(s) chargés' + (r.parcelles == null ? '' : ', ' + r.parcelles + ' parcelle(s) du registre dont ' + r.eligibles + ' prête(s) pour une installation') + '. Vous pouvez travailler sans réseau.']
        : ['warn', 'Appareil prêt : ' + r.champs + ' champ(s) chargés, mais la graine de tirage de la campagne n’existe pas encore : aucune installation possible avant que le Branch Manager la crée (écran Affectations).']; })
      .catch(function (e2) { etat.message = ['danger', e2.message]; }).then(rendre);
  }
  else if (act === 'inventaire') enregistrerInventaire(b.getAttribute('data-bloc'), b.getAttribute('data-num'));
  else if (act === 'marquer') marquerArbre(b.getAttribute('data-panel'), b.getAttribute('data-arbre'));
  else if (act === 'reserve') activerReserve(b.getAttribute('data-arbre'), b.getAttribute('data-code'));
  else if (act === 'designer') designer(b.getAttribute('data-panel'));
  else if (act === 'photo_exception') exceptionPhoto();
  else if (act === 'voir_photo') voirPhoto(b.getAttribute('data-ref'));
  else if (act === 'rep') repondre(b.getAttribute('data-champ'), b.getAttribute('data-val'));
  else if (act === 'repv') { if (brouillon) { brouillon.visite.ramassage = b.getAttribute('data-val'); sauverBrouillon().then(rendre); } }
  else if (act === 'aller') { etat.idx = +b.getAttribute('data-i'); var p = parts(); aller('observatoire/visite/' + p[2] + '/' + p[3]); global.scrollTo(0, 0); }
  else if (act === 'prec') { etat.idx = Math.max(0, etat.idx - 1); rendre(); global.scrollTo(0, 0); }
  else if (act === 'suiv') { etat.idx += 1; rendre(); global.scrollTo(0, 0); }
  else if (act === 'resume') { var q = parts(); aller('observatoire/visite/' + q[2] + '/' + q[3] + '/resume'); global.scrollTo(0, 0); }
  else if (act === 'brouillon') finirVisite(false);
  else if (act === 'soumettre') finirVisite(true);
  else if (act === 'reessayer') L.reessayer(b.getAttribute('data-cle')).then(function () { return synchroniser(true); });
  else if (act === 'dec') decider(b.getAttribute('data-dec'), b.getAttribute('data-id'), +b.getAttribute('data-v'));
  else if (act === 'corr') deciderCorrection(b.getAttribute('data-id'), b.getAttribute('data-dec'));
  else if (act === 'graine') confirmer('Créer la graine de tirage ?', 'La graine est tirée au hasard par le serveur, une seule fois pour toute la campagne. Elle ne pourra plus être changée.', 'Créer').then(function (oui) { if (!oui) return; return rpc('pheno_graine_creer', { p_campaign: campagne().id }).then(function () { etat.message = ['ok', 'Graine de campagne créée. Les agents doivent préparer le hors-ligne avant d’installer.']; }).catch(function (e4) { etat.message = ['danger', e4.message]; }).then(rendre); });
  else if (act === 'revoquer') demanderMotif('Révoquer l’affectation', 'Le droit est retiré immédiatement.').then(function (m) { if (!m) return; return rpc('pheno_affectation_revoquer', { p_id: b.getAttribute('data-id'), p_motif: m }).then(function () { etat.message = ['ok', 'Affectation révoquée.']; }).catch(function (e3) { etat.message = ['danger', e3.message]; }).then(rendre); });
}
function surSaisie(e) {
  if (parts()[0] !== 'observatoire') return; var t = e.target;
  if (t.id === 'obsB') { clearTimeout(etat.minuteB); etat.minuteB = setTimeout(majReperes, e.type === 'change' ? 0 : 700); return; }
  if (t.id === 'obsb' || /^obsRep|^obsSuivi/.test(t.id || '')) { var er = document.getElementById('obsInstallErr'); if (er) er.innerHTML = ''; }
  if (t.id === 'obsFiltreCluster' || t.id === 'obsFiltreVillage' || t.id === 'obsFiltreTexte') return filtrerParcelles(e);
  if (/^obsCh(Cluster|Village|Texte|AFaire)$/.test(t.id || '')) return filtrerChamps(e);
  if (t.hasAttribute && t.hasAttribute('data-saisie') && brouillon) { brouillon.visite.observations[etat.idx][t.getAttribute('data-saisie')] = t.value.trim() || null; sauverBrouillon(); }
  if (t.hasAttribute && t.hasAttribute('data-visite') && brouillon) {
    var k = t.getAttribute('data-visite'); brouillon.visite[k] = t.value.trim() || null;
    sauverBrouillon().then(function () {
      if (e.type !== 'change') return;
      if (k === 'mode_saisie' && t.value === 'TRANSCRIPTION_PAPIER' && !etat.collegues) return rpc('pheno_observateurs_du_cluster').then(function (l) { etat.collegues = l || []; }).catch(function () { etat.collegues = []; }).then(rendre);
      if (k === 'mode_saisie' || k === 'date_observation' || k === 'justification_retro') return rendre();
    });
  }
}
document.addEventListener('click', surClic);
document.addEventListener('input', surSaisie);
document.addEventListener('change', function (e) {
  if (parts()[0] !== 'observatoire') return;
  if (e.target.hasAttribute && e.target.hasAttribute('data-photo')) return joindrePhoto(e.target.files && e.target.files[0]);
  surSaisie(e);
});
document.addEventListener('submit', function (e) {
  if (e.target.id === 'obsInstall') { e.preventDefault(); soumettreInstallation(e.target); }
  if (e.target.id === 'obsAff') { e.preventDefault(); accorder(e.target); }
});
/* S17 · Reprise automatique. Causes identifiées dans le code (19/11/2026) :
   1) aucune requête n'était bornée dans le temps : une requête lancée pendant la coupure pouvait
      rester suspendue, et la synchronisation suivante attendait cette même requête (verrou enCours) ;
   2) la minuterie n'était armée que sur l'événement « anagroci:authenticated » : si la session était
      déjà ouverte avant le chargement de ce fichier, aucun essai périodique n'avait lieu ;
   3) un seul essai au retour du réseau, souvent trop tôt (réseau pas encore utilisable).
   Désormais : démarrage dans tous les cas, essais à 3 s, 15 s et 45 s après le retour du réseau,
   à chaque retour au premier plan, puis toutes les 30 s tant qu'il reste quelque chose à envoyer.
   Limite assumée : application fermée ou téléphone en veille, rien ne part (pas de synchronisation
   en arrière-plan promise) ; tout part à la réouverture. */
var relances = [];
function essayerPlusTard(delais) {
  relances.forEach(clearTimeout); relances = [];
  (delais || [0]).forEach(function (ms) { relances.push(setTimeout(function () { if (enLigne() && peutCollecter()) synchroniser(false); }, ms)); });
}
function battement() {
  if (!peutCollecter() || !enLigne() || !L) return;
  L.compter().then(function (n) { if (n.attente + n.echec_reseau + n.photos_attente > 0) synchroniser(false); }).catch(function () {});
}
function demarrer() {
  if (minuterie || !global.ANAGROCI_AUTH || !peutCollecter()) return;
  minuterie = setInterval(battement, 30000);
  essayerPlusTard([1500]);
}
global.addEventListener('online', function () { essayerPlusTard([3000, 15000, 45000]); });
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') essayerPlusTard([1000]); });
global.addEventListener('focus', function () { essayerPlusTard([1000]); });
global.addEventListener('pageshow', function () { essayerPlusTard([1500]); });
document.addEventListener('anagroci:authenticated', function () { demarrer(); if (parts()[0] === 'observatoire') rendre(); });
if (global.ANAGROCI_AUTH) demarrer(); else { var attente = setInterval(function () { if (global.ANAGROCI_AUTH) { clearInterval(attente); demarrer(); } }, 1000); setTimeout(function () { clearInterval(attente); }, 120000); }
document.addEventListener('anagroci:campaign', function () { if (parts()[0] === 'observatoire') rendre(); });
if (L) L.surChangement(function () { if (parts()[0] === 'observatoire') barreEnvoi(); });

global.ANAGROCI_OBSERVATOIRE = { render: rendre, synchroniser: synchroniser };
})(window);

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
function client() {
  if (sb) return Promise.resolve(sb);
  if (clientPromise) return clientPromise;
  clientPromise = new Promise(function (ok) {
    var k = 0, t = setInterval(function () {
      k++;
      if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) { clearInterval(t); sb = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON); ok(sb); }
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
  if (peutPiloter()) t.push(['validation', 'Validation'], ['qualite', 'Qualité']);
  if (classe() === 'BM') t.push(['affectations', 'Affectations']);
  return '<nav class="obs-onglets">' + t.map(function (x) { return '<a class="' + (x[0] === actif ? 'actif' : '') + '" href="#observatoire' + (x[0] ? '/' + x[0] : '') + '">' + esc(x[1]) + '</a>'; }).join('') + '</nav>';
}
function entete(sous, actif, actions) {
  return '<div class="ops-route-head"><div><h1>Observatoire agronomique</h1><p>' + esc(sous) + '</p></div><div class="ops-route-actions">' + (actions || '') + '</div></div>' +
    '<div class="obs-bandeau"><b>Collecte pilote</b> · protocole ' + esc(C.PROTOCOLE) + ' · aucun indicateur officiel, aucune prévision</div>' + onglets(actif) + '<div id="obsEnvoi"></div>';
}
function barreEnvoi() {
  var h = document.getElementById('obsEnvoi'); if (!h || !peutCollecter()) return;
  L.enAttente().then(function (l) {
    if (!document.getElementById('obsEnvoi')) return;
    h.innerHTML = l.length
      ? '<div class="obs-envoi attente"><span><b>' + l.length + ' envoi' + (l.length > 1 ? 's' : '') + ' en attente.</b> Enregistré sur ce téléphone. Non encore sauvegardé sur le serveur.</span><button type="button" class="btn primary" data-act="sync">Envoyer maintenant</button></div>'
      : '';
  });
}
function synchroniser(manuel) {
  return client().then(function (c) {
    if (!c || !enLigne()) { if (manuel) etat.message = ['warn', 'Pas de réseau. Vos saisies restent enregistrées sur ce téléphone et seront envoyées dès que possible.']; return null; }
    return L.synchroniser(c).then(function (b) {
      if (manuel || b.envoyees) {
        etat.message = b.reseau ? ['warn', 'Le serveur n’a pas répondu. Vos saisies restent sur ce téléphone ; un nouvel essai sera fait automatiquement.']
          : b.conflits || b.refusees ? ['warn', b.recues + ' reçu(s) par le serveur, ' + b.conflits + ' conflit(s), ' + b.refusees + ' refus. Ouvrez « Envois » pour le détail.']
          : b.envoyees ? ['ok', b.recues + ' envoi(s) reçu(s) par le serveur.'] : ['info', 'Rien à envoyer.'];
      }
      return b;
    });
  }).then(function (b) { if (manuel || (b && b.envoyees)) rendre(); return b; });
}
/* Toute erreur d'enregistrement local est montrée à l'agent : jamais d'échec silencieux. */
function echec(e) { console.error('[OBSERVATOIRE]', e); etat.message = ['danger', 'Enregistrement impossible sur cet appareil : ' + (e && e.message ? e.message : 'erreur inconnue') + '. Rien n’a été envoyé. Réessayez.']; rendre(); }
function message() { var m = etat.message; etat.message = null; return m ? note(esc(m[1]), m[0]) : ''; }
function nomParcelle(ref, panel) {
  var pl = (ref.plots || []).filter(function (x) { return x.id === panel.plot_id; })[0] || {};
  var pr = (ref.producteurs || []).filter(function (x) { return x.id === (pl.producteur_id || panel.producteur_id); })[0] || {};
  var vi = (ref.villages || []).filter(function (x) { return x.id === (pl.village_id || panel.village_id); })[0] || {};
  return { producteur: pr.nom || panel.producteur_nom || 'Producteur', parcelle: pl.local_name || panel.parcelle_nom || 'Parcelle', village: vi.village || panel.village_nom || '' };
}

/* ------------------------------------------------------------------ Mes champs */
function vueChamps() {
  var camp = campagne();
  if (!peutCollecter()) { return peutPiloter() ? aller('observatoire/validation') : vueRefus(); }
  return Promise.all([L.panels(camp && camp.id), L.visites(), L.referentiel(), L.dernierePreparation()]).then(function (r) {
    var semaine = C.semaineIso(C.aujourdhui()), ref = r[2], prep = r[3];
    var cartes = r[0].sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? 1 : -1; }).map(function (p) {
      var n = nomParcelle(ref, p), v = r[1].filter(function (x) { return x.panel_id === p.id && C.semaineIso(x.date_observation) === semaine; })[0];
      var statut = p.statut_local || p.statut, action;
      if (statut === 'ACTIF') action = '<a class="btn primary" href="#observatoire/visite/' + p.id + '/' + (v ? v.id : 'nouvelle') + '">' + (v ? (v.statut_serveur && v.statut_serveur !== 'BROUILLON' && v.statut_serveur !== 'CORRECTION_DEMANDEE' ? 'Voir la visite' : 'Reprendre la visite') : 'Visite de la semaine') + '</a>';
      else if (statut === 'TIRAGE_VERROUILLE') action = '<a class="btn signal" href="#observatoire/champ/' + p.id + '">Continuer l’installation</a>';
      else action = '';
      return '<article class="obs-carte"><div class="obs-carte-tete"><div><h3>' + esc(n.producteur) + '</h3><p>' + esc(n.parcelle) + (n.village ? ' · ' + esc(n.village) : '') + '</p></div>' +
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
      (cartes ? '<div class="obs-grille">' + cartes + '</div>' : '<div class="ops-empty">Aucun champ installé sur cet appareil. Touchez « Préparer le hors-ligne » pour charger vos champs, ou « Installer un champ ».</div>'));
    barreEnvoi();
  });
}
function vueRefus() { peindre('<div class="ops-route-head"><div><h1>Observatoire agronomique</h1><p>Accès réservé.</p></div></div>' + note('Votre profil n’a pas accès à l’Observatoire agronomique. Ce module est réservé aux équipes agronomiques AFLP désignées.', 'warn')); }

/* ------------------------------------------------------------------ Installer un champ */
function vueInstaller() {
  var camp = campagne();
  if (!peutCollecter()) return vueRefus();
  return Promise.all([L.referentiel(), L.panels(camp && camp.id)]).then(function (r) {
    var ref = r[0], pris = {}; r[1].forEach(function (p) { pris[p.plot_id] = 1; });
    var norme = function (x) { return String(x || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase(); }, monCluster = norme(profil().cluster);
    var options = (ref.plots || []).filter(function (p) { return !pris[p.id]; }).map(function (p) {
      var pr = (ref.producteurs || []).filter(function (x) { return x.id === p.producteur_id; })[0] || {}, vi = (ref.villages || []).filter(function (x) { return x.id === p.village_id; })[0] || {};
      return { id: p.id, txt: (pr.nom || 'Producteur') + ' — ' + (p.local_name || 'Parcelle') + ' — ' + (vi.village || '') + (p.tree_count ? ' (' + p.tree_count + ' arbres déclarés)' : ''), cluster: norme(vi.cluster_code || vi.cluster) };
    }).filter(function (o) { return classe() === 'BM' || !monCluster || !o.cluster || o.cluster.indexOf(monCluster) >= 0 || monCluster.indexOf(o.cluster) >= 0; })
      .sort(function (a, b) { return a.txt.localeCompare(b.txt); });
    peindre(entete('Installation d’un champ : blocs, tirage, verrouillage.', '', '<a class="btn secondary" href="#observatoire">Retour</a>') +
      (camp ? '' : note('Aucune campagne sélectionnée.', 'warn')) +
      (options.length ? '' : note('Aucune parcelle disponible sur cet appareil. Revenez à « Mes champs » et touchez « Préparer le hors-ligne » avec du réseau. La parcelle doit exister dans le registre des producteurs.', 'warn')) +
      '<form id="obsInstall" class="card obs-form" autocomplete="off">' +
      '<div class="field"><label for="obsPlot">1. Parcelle du registre producteurs</label><select id="obsPlot" required><option value="">— Choisir —</option>' + options.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.txt) + '</option>'; }).join('') + '</select></div>' +
      '<div class="obs-duo"><div class="field"><label for="obsB">2. Nombre total de blocs du champ (B)</label><input id="obsB" type="number" inputmode="numeric" min="1" max="60" required></div>' +
      '<div class="field"><label for="obsb">3. Nombre de blocs à tirer (b)</label><input id="obsb" type="number" inputmode="numeric" min="1" max="10" required></div></div>' +
      '<p class="obs-info">Découpez le champ en blocs qui ne se chevauchent pas, délimités par des repères visibles (piste, termitière, gros arbre, borne). <b>b est fixé avant le tirage et ne pourra plus être changé.</b></p>' +
      '<div id="obsReperes"></div><div id="obsInstallErr"></div>' +
      '<div class="obs-actions"><button type="submit" class="btn primary">Tirer les blocs et verrouiller</button></div></form>');
    barreEnvoi();
  });
}
function majReperes() {
  var B = Math.min(60, Math.max(0, parseInt((document.getElementById('obsB') || {}).value, 10) || 0)), h = document.getElementById('obsReperes'); if (!h) return;
  var anciens = [].map.call(h.querySelectorAll('input'), function (i) { return i.value; }), s = '';
  for (var i = 1; i <= B; i++) s += '<div class="field"><label for="obsRep' + i + '">Bloc ' + i + ' : repère physique</label><input id="obsRep' + i + '" type="text" maxlength="120" required value="' + esc(anciens[i - 1] || '') + '" placeholder="Ex. entre la piste et la termitière"></div>';
  h.innerHTML = B ? '<h3 class="obs-titre">4. Repères des ' + B + ' blocs</h3>' + s : '';
}
function soumettreInstallation(form) {
  var camp = campagne(), err = document.getElementById('obsInstallErr');
  var B = parseInt(form.querySelector('#obsB').value, 10), b = parseInt(form.querySelector('#obsb').value, 10), plot = form.querySelector('#obsPlot').value;
  var blocs = []; for (var i = 1; i <= B; i++) blocs.push({ id: C.uuid(), repere: (form.querySelector('#obsRep' + i) || {}).value });
  var id = C.uuid(), res = C.installer({ id: id, nb_blocs_total: B, nb_blocs_tires: b, blocs: blocs });
  if (!camp) res.erreurs = (res.erreurs || []).concat('Aucune campagne sélectionnée.');
  if (!plot) res.erreurs = (res.erreurs || []).concat('Choisissez la parcelle.');
  if (res.erreurs && res.erreurs.length) { err.innerHTML = note(res.erreurs.map(esc).join('<br>'), 'danger'); return; }
  confirmer('Verrouiller le tirage ?', 'Vous avez décrit <b>' + B + ' blocs</b> et vous en tirez <b>' + b + '</b>. Après confirmation, le tirage est définitif : ni B, ni b, ni les blocs tirés ne pourront être changés.', 'Tirer et verrouiller').then(function (oui) {
    if (!oui) return;
    return L.referentiel().then(function (ref) {
      var pl = (ref.plots || []).filter(function (x) { return x.id === plot; })[0] || {}, n = nomParcelle(ref, { plot_id: plot });
      var panel = { id: id, campaign_id: camp.id, plot_id: plot, producteur_id: pl.producteur_id, village_id: pl.village_id, producteur_nom: n.producteur, parcelle_nom: n.parcelle, village_nom: n.village,
        nb_blocs_total: B, nb_blocs_tires: b, statut: 'TIRAGE_VERROUILLE', tirage_graine: res.graine, tirage_le: new Date().toISOString(), blocs: res.blocs, arbres: [], local: true, created_at: new Date().toISOString() };
      return L.enregistrerPanel(panel).then(function () {
        return L.mettreEnFile('PANEL_INSTALLER', { id: id, campaign_id: camp.id, plot_id: plot, nb_blocs_total: B, nb_blocs_tires: b,
          blocs: res.blocs.map(function (x) { return { id: x.id, numero: x.numero, repere: x.repere }; }) }, { entite: 'PANEL', entite_id: id, libelle: 'Installation : ' + n.producteur + ' — ' + n.parcelle });
      }).then(function () { etat.message = ['ok', 'Tirage verrouillé : blocs ' + res.blocs_tires.join(' et ') + '. Enregistré sur ce téléphone.']; synchroniser(false); aller('observatoire/champ/' + id); });
    });
  }).catch(echec);
}

/* ------------------------------------------------------------------ Fiche du champ */
function vueChamp(id) {
  return Promise.all([L.panel(id), L.referentiel(), L.visites(id)]).then(function (r) {
    var p = r[0]; if (!p) { peindre(entete('Champ introuvable sur cet appareil.', '') + note('Ce champ n’est pas chargé sur cet appareil. Revenez à « Mes champs » et touchez « Préparer le hors-ligne ».', 'warn')); return; }
    var n = nomParcelle(r[1], p), statut = p.statut_local || p.statut, tires = p.blocs.filter(function (b) { return b.tire; }).sort(function (a, b) { return a.rang_tirage - b.rang_tirage; });
    var blocs = '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Bloc</th><th>Repère</th><th>Tirage</th><th>Arbres inventoriés (N)</th></tr></thead><tbody>' + p.blocs.map(function (b) {
      var inv = !b.tire ? '<span class="obs-gris">non inventorié (bloc non tiré)</span>' : b.nb_arbres_inventories != null ? '<b>' + b.nb_arbres_inventories + '</b>'
        : (peutCollecter() ? '<span class="obs-inventaire"><input type="number" inputmode="numeric" min="0" max="2000" aria-label="Nombre d’arbres du bloc ' + b.numero + '" id="obsInv' + b.numero + '"><button type="button" class="btn primary" data-act="inventaire" data-bloc="' + esc(b.id) + '" data-num="' + b.numero + '">Enregistrer</button></span>' : 'à inventorier');
      return '<tr class="' + (b.tire ? 'obs-tire' : '') + '"><td data-l="Bloc"><b>' + b.numero + '</b></td><td data-l="Repère">' + esc(b.repere) + '</td><td data-l="Tirage">' + (b.tire ? badge('Tiré (rang ' + b.rang_tirage + ') · ' + b.nb_titulaires_prevus + ' titulaires' + (b.nb_reserves_prevues ? ' + ' + b.nb_reserves_prevues + ' réserve' : ''), 'ok') : badge('Non tiré')) + '</td><td data-l="Arbres (N)">' + inv + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    var arbres = (p.arbres || []).slice().sort(function (a, b) { return (a.role === b.role ? 0 : a.role === 'TITULAIRE' ? -1 : 1) || a.rang - b.rang; });
    var liste = arbres.length ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Arbre</th><th>Code permanent</th><th>Bloc</th><th>N° d’inventaire</th><th>Statut</th><th>GPS</th></tr></thead><tbody>' + arbres.map(function (a) {
      var st = { ACTIF: ['Titulaire', 'ok'], RESERVE_EN_ATTENTE: ['Réserve (non observée)', ''], RESERVE_ACTIVEE: ['Réserve activée', 'info'], REMPLACE: ['Remplacé', 'warn'] }[a.statut] || [a.statut, ''];
      return '<tr><td data-l="Arbre"><b>' + (a.role === 'TITULAIRE' ? ('0' + a.rang).slice(-2) : 'R' + a.rang) + '</b></td><td data-l="Code">' + esc(a.code) + '</td><td data-l="Bloc">' + esc(a.bloc_numero == null ? '' : a.bloc_numero) + '</td><td data-l="N° inventaire">' + a.numero_inventaire + '</td><td data-l="Statut">' + badge(st[0], st[1]) + '</td><td data-l="GPS">' +
        (a.latitude != null ? 'marqué' : (peutCollecter() && a.statut !== 'REMPLACE' ? '<button type="button" class="btn secondary" data-act="marquer" data-arbre="' + esc(a.id) + '" data-panel="' + esc(p.id) + '">Marquer ici</button>' : '—')) +
        (peutPiloter() && (a.statut === 'ACTIF' || a.statut === 'RESERVE_ACTIVEE') && !p.local ? ' <button type="button" class="btn secondary" data-act="reserve" data-arbre="' + esc(a.id) + '" data-code="' + esc(a.code) + '">Remplacer par une réserve</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="obs-info">Comptez les arbres du bloc dans un ordre fixe (du repère d’entrée, rang par rang). L’arbre à marquer est celui dont le numéro d’inventaire est indiqué. Marquez-le de façon durable (peinture, étiquette) avec son code.</p>' : '';
    var vis = r[2].sort(function (a, b) { return a.date_observation < b.date_observation ? 1 : -1; });
    peindre(entete(n.producteur + ' — ' + n.parcelle + (n.village ? ' · ' + n.village : ''), '', '<a class="btn secondary" href="#observatoire">Retour</a>' + (statut === 'ACTIF' && peutCollecter() ? '<a class="btn primary" href="#observatoire/visite/' + p.id + '/nouvelle">Visite de la semaine</a>' : '')) + message() +
      (p.local ? note('Installation enregistrée sur ce téléphone. <b>Non encore sauvegardée sur le serveur.</b>', 'warn') : '') + (p.dernier_message ? note('Réponse du serveur : ' + esc(p.dernier_message), 'danger') : '') +
      (statut === 'INCOMPATIBLE' ? note('<b>Champ incompatible avec le protocole :</b> ' + esc(p.incompatibilite || '') + '. Le bloc tiré n’est ni remplacé ni complété. Signalez ce champ à votre Unit Head.', 'danger') : '') +
      (statut === 'TIRAGE_VERROUILLE' ? note('Tirage verrouillé : blocs <b>' + tires.map(function (b) { return b.numero; }).join(', ') + '</b>. Comptez maintenant <b>tous</b> les arbres de chaque bloc tiré. Le nombre saisi ne pourra plus être modifié.', 'info') : '') +
      (p.reserves_manquantes ? note(p.reserves_manquantes + ' réserve(s) manquante(s) : bloc trop petit pour fournir une réserve.', 'warn') : '') +
      '<section class="card"><div class="card-head"><h2>Blocs (' + p.nb_blocs_tires + ' tirés sur ' + p.nb_blocs_total + ')</h2>' + badge('Tirage verrouillé le ' + dateFr(p.tirage_le), 'ok') + '</div>' + blocs + '</section>' +
      (liste ? '<section class="card"><div class="card-head"><h2>Arbres marqués</h2></div>' + liste + '</section>' : '') +
      '<section class="card"><div class="card-head"><h2>Visites</h2></div>' + (vis.length ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Semaine</th><th>Observée le</th><th>Statut</th><th>Envoi</th><th></th></tr></thead><tbody>' + vis.map(function (v) {
        return '<tr><td data-l="Semaine">' + esc(C.semaineIso(v.date_observation)) + '</td><td data-l="Observée le">' + dateFr(v.date_observation) + '</td><td data-l="Statut">' + badge(C.LIBELLES.statut_visite[v.statut_serveur || 'LOCAL'], tonStatut(v.statut_serveur)) + '</td><td data-l="Envoi">' + (v.etat_envoi === 'RECU' ? 'Reçue par le serveur le ' + esc(heureFr(v.recu_serveur_le)) : v.etat_envoi ? esc(C.LIBELLES.statut_envoi[v.etat_envoi] || v.etat_envoi) : 'Sur ce téléphone uniquement') + '</td><td><a class="btn secondary" href="#observatoire/visite/' + p.id + '/' + v.id + '">Ouvrir</a></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="ops-empty">Aucune visite sur cet appareil.</div>') + '</section>');
    barreEnvoi();
  });
}
function enregistrerInventaire(blocId, numero) {
  var champ = document.getElementById('obsInv' + numero), n = parseInt(champ && champ.value, 10), pid = parts()[2];
  if (!(n >= 0) || n > 2000) { if (champ) champ.classList.add('obs-erreur'); return; }
  confirmer('Enregistrer l’inventaire ?', 'Bloc ' + numero + ' : <b>' + n + ' arbres</b> comptés. Ce nombre ne pourra plus être modifié.', 'Enregistrer').then(function (oui) {
    if (!oui) return;
    return L.panel(pid).then(function (p) {
      p.blocs.forEach(function (b) { if (b.id === blocId) b.nb_arbres_inventories = n; });
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
function activerReserve(arbreId, code) {
  demanderMotif('Remplacer l’arbre ' + code + ' par une réserve', 'Action officielle, réservée au valideur agronomique, réseau nécessaire. L’arbre remplacé sort du suivi ; la réserve entre avec une probabilité marquée « approchée ».').then(function (motif) {
    if (!motif) return;
    return rpc('pheno_reserve_activer', { p_arbre_remplace: arbreId, p_motif: motif }).then(function (r) {
      etat.message = ['ok', 'Réserve ' + r.reserve_activee + ' activée à la place de ' + r.arbre_remplace + '.'];
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
function figee(v) { return ['SOUMIS', 'EN_VERIFICATION', 'VALIDE'].indexOf(v.statut_serveur) >= 0; }
function chargerVisite(panelId, visiteId) {
  if (brouillon && brouillon.visite.id === visiteId && brouillon.panel.id === panelId) return Promise.resolve(brouillon);
  return Promise.all([L.panel(panelId), visiteId === 'nouvelle' ? null : L.visite(visiteId), L.visites(panelId)]).then(function (r) {
    var p = r[0]; if (!p) return null;
    var v = r[1], semaine = C.semaineIso(C.aujourdhui());
    if (!v && visiteId === 'nouvelle') v = r[2].filter(function (x) { return C.semaineIso(x.date_observation) === semaine; })[0] || null;
    if (!v) v = { id: /^[0-9a-f-]{36}$/i.test(visiteId) ? visiteId : C.uuid(), panel_id: p.id, date_observation: C.aujourdhui(), mode_saisie: 'DIRECT', ramassage: null, anomalies: null, observations: [], statut_serveur: null, etat_envoi: null, cree_le: new Date().toISOString() };
    var arbres = C.arbresObserves(p.arbres), par = {}; (v.observations || []).forEach(function (o) { par[o.arbre_id] = o; });
    v.observations = arbres.map(function (a) { return par[a.id] || C.observationVide(a.id); });
    brouillon = { panel: p, visite: v, arbres: arbres }; etat.idx = 0; return brouillon;
  });
}
function vueVisite(panelId, visiteId, ecran) {
  if (!peutCollecter() && !peutPiloter()) return vueRefus();
  return Promise.all([chargerVisite(panelId, visiteId), L.referentiel()]).then(function (r) {
    var b = r[0]; if (!b) { peindre(entete('Champ introuvable sur cet appareil.', '') + note('Touchez « Préparer le hors-ligne » depuis « Mes champs ».', 'warn')); return; }
    if (visiteId === 'nouvelle') { history.replaceState(null, '', '#observatoire/visite/' + panelId + '/' + b.visite.id); }
    var n = nomParcelle(r[1], b.panel), v = b.visite, lecture = figee(v) || !peutCollecter();
    if (!b.arbres.length) { peindre(entete(n.producteur + ' — ' + n.parcelle, '') + note('Ce champ n’a pas encore d’arbres tirés. Terminez l’installation.', 'warn') + '<a class="btn secondary" href="#observatoire/champ/' + panelId + '">Fiche du champ</a>'); return; }
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
    if (o.retrouve != null) corps += '<div class="obs-q"><h3>Anomalie sur cet arbre (facultatif)</h3><textarea class="obs-zone" rows="2" data-saisie="anomalie" maxlength="300" placeholder="Ex. branche cassée, feu, maladie">' + esc(o.anomalie || '') + '</textarea>' +
      '<label class="btn secondary obs-photo">' + (o.photo_ref ? 'Photo jointe · remplacer' : 'Joindre une photo') + '<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-photo hidden></label></div>';
    peindre('<div class="obs-visite"><div class="obs-visite-tete"><a href="#observatoire" class="obs-retour">← Mes champs</a><div><b>' + esc(n.producteur) + '</b><span>' + esc(n.parcelle) + ' · observée le ' + dateFr(v.date_observation) + '</span></div></div>' +
      (v.statut_serveur === 'CORRECTION_DEMANDEE' ? note('<b>Correction demandée :</b> ' + esc(v.correction_motif || ''), 'warn') : '') +
      '<div class="obs-pastilles">' + b.arbres.map(function (x, k) { var oo = v.observations[k]; return '<button type="button" data-act="aller" data-i="' + k + '" class="' + (k === i ? 'courant ' : '') + (C.observationComplete(oo) ? 'fait' : oo.retrouve != null ? 'partiel' : '') + '" aria-label="Arbre ' + (k + 1) + '">' + ('0' + (k + 1)).slice(-2) + '</button>'; }).join('') + '</div>' +
      '<div class="obs-arbre"><div class="obs-arbre-tete"><span class="obs-numero">' + ('0' + (i + 1)).slice(-2) + '</span><div><b>Arbre ' + (i + 1) + ' sur ' + b.arbres.length + '</b><span>Code ' + esc(a.code) + ' · bloc ' + esc(bloc.numero || a.bloc_numero || '') + (bloc.repere ? ' (' + esc(bloc.repere) + ')' : '') + '</span></div></div>' + corps + '</div>' +
      '<div class="obs-pied"><button type="button" class="btn secondary" data-act="prec"' + (i === 0 ? ' disabled' : '') + '>Précédent</button>' +
      (i < b.arbres.length - 1 ? '<button type="button" class="btn primary" data-act="suiv">Arbre suivant</button>' : '<button type="button" class="btn primary" data-act="resume">Voir le résumé</button>') + '</div>' +
      '<p class="obs-info centre">Chaque réponse est enregistrée sur ce téléphone au fur et à mesure.</p></div>');
  });
}
function sauverBrouillon() { if (brouillon) return L.enregistrerVisite(brouillon.visite); return Promise.resolve(); }
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
    return '<tr><td data-l="Arbre"><b>' + ('0' + (k + 1)).slice(-2) + '</b> ' + esc(a.code) + '</td><td data-l="Retrouvé">' + (o.retrouve == null ? '<span class="obs-manque">—</span>' : o.retrouve ? 'Oui' : 'Non') + '</td><td data-l="F">' + val(o.f) + '</td><td data-l="N">' + val(o.n) + '</td><td data-l="P">' + val(o.p) + '</td><td data-l="Chute">' + (o.chute ? esc(C.LIBELLES.chute[o.chute]) + (o.chute_preuve ? ' · ' + esc(C.LIBELLES.preuve[o.chute_preuve]) : '') : val(null)) + '</td><td data-l="Remarque">' + esc(o.pas_vu_motif || '') + (o.anomalie ? ' ' + esc(o.anomalie) : '') + (o.photo_ref ? ' 📷' : '') + '</td>' + (lecture ? '' : '<td><button type="button" class="btn secondary" data-act="aller" data-i="' + k + '">Modifier</button></td>') + '</tr>'; }).join('');
  var envoi = v.etat_envoi === 'RECU' ? note('Envoyée et reçue par le serveur le ' + esc(heureFr(v.recu_serveur_le)) + '. Statut : <b>' + esc(C.LIBELLES.statut_visite[v.statut_serveur] || '') + '</b>.', 'ok')
    : v.etat_envoi === 'EN_ATTENTE' ? note('Enregistré sur ce téléphone. <b>Non encore sauvegardé sur le serveur.</b>', 'warn')
    : v.etat_envoi ? note(esc(C.LIBELLES.statut_envoi[v.etat_envoi] || v.etat_envoi) + (v.dernier_message ? ' : ' + esc(v.dernier_message) : ''), 'danger') : '';
  peindre('<div class="obs-visite"><div class="obs-visite-tete"><a href="#observatoire" class="obs-retour">← Mes champs</a><div><b>' + esc(n.producteur) + '</b><span>' + esc(n.parcelle) + ' · semaine ' + esc(C.semaineIso(v.date_observation)) + '</span></div></div>' + message() + envoi +
    (lecture && figee(v) ? note('Cette visite est ' + esc((C.LIBELLES.statut_visite[v.statut_serveur] || '').toLowerCase()) + ' : elle ne peut plus être modifiée ici. Une erreur se signale à votre Unit Head, qui demandera une correction.', 'info') : '') +
    (v.statut_serveur === 'CORRECTION_DEMANDEE' ? note('<b>Correction demandée :</b> ' + esc(v.correction_motif || ''), 'warn') : '') +
    '<section class="card"><div class="card-head"><h2>Résumé de la visite</h2></div><div class="table-wrap"><table class="obs-table"><thead><tr><th>Arbre</th><th>Retrouvé</th><th>F</th><th>N</th><th>P</th><th>Chute</th><th>Remarque</th>' + (lecture ? '' : '<th></th>') + '</tr></thead><tbody>' + lignes + '</tbody></table></div></section>' +
    (lecture ? '<section class="card"><p>Observée le <b>' + dateFr(v.date_observation) + '</b> · saisie le ' + esc(heureFr(v.saisie_le)) + ' · reçue par le serveur le ' + esc(heureFr(v.recu_serveur_le)) + '<br>Ramassage : ' + esc({ OUI: 'Oui', NON: 'Non', NE_SAIT_PAS: 'Ne sait pas' }[v.ramassage] || '—') + (v.anomalies ? '<br>Remarques : ' + esc(v.anomalies) : '') + '</p></section>'
    : '<section class="card obs-form"><div class="obs-duo"><div class="field"><label for="obsDate">Date d’observation sur le terrain</label><input id="obsDate" type="date" max="' + C.aujourdhui() + '" value="' + esc(v.date_observation) + '" data-visite="date_observation"></div>' +
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
    etat.message = ['warn', (soumettre ? 'Visite terminée. ' : 'Brouillon enregistré. ') + 'Enregistré sur ce téléphone. Non encore sauvegardé sur le serveur.'];
    brouillon = null;
    return synchroniser(false);
  }).then(function () { aller('observatoire/visite/' + b.panel.id + '/' + v.id + '/resume'); }).catch(echec);
}
function joindrePhoto(fichier) {
  if (!brouillon || !fichier) return; var camp = campagne(), u = L.utilisateur();
  if (fichier.size > 6 * 1024 * 1024) { etat.message = ['warn', 'Photo trop lourde (6 Mo au plus).']; rendre(); return; }
  if (!camp || !u) return;
  var a = brouillon.arbres[etat.idx], ext = { 'image/png': 'png', 'image/webp': 'webp' }[fichier.type] || 'jpg';
  var chemin = camp.id + '/' + brouillon.panel.id + '/' + u + '/' + brouillon.visite.id.slice(0, 8) + '_' + a.code + '.' + ext;
  L.ajouterFichier(chemin, fichier).then(function () { brouillon.visite.observations[etat.idx].photo_ref = chemin; return sauverBrouillon(); }).then(rendre);
}

/* ------------------------------------------------------------------ Envois */
function vueEnvois() {
  return L.file().then(function (l) {
    var lignes = l.slice().reverse().map(function (o) {
      var ton = { RECU: 'ok', EN_ATTENTE: 'warn', ECHEC_RESEAU: 'warn', ENVOI: 'info', REJETE: 'danger', CONFLIT: 'danger' }[o.statut];
      return '<tr><td data-l="Opération">' + esc(o.libelle) + '</td><td data-l="Saisie le">' + esc(heureFr(o.created_at_client)) + '</td><td data-l="État">' + badge(C.LIBELLES.statut_envoi[o.statut] || o.statut, ton) + (o.dernier_message ? '<div class="obs-detail">' + esc(o.dernier_message) + '</div>' : '') + '</td><td data-l="Reçu serveur">' + (o.statut === 'RECU' || o.statut === 'CONFLIT' ? esc(heureFr(o.recu_serveur_le)) : '—') + '</td><td>' + (o.statut === 'REJETE' ? '<button type="button" class="btn secondary" data-act="reessayer" data-cle="' + esc(o.idempotency_key) + '">Renvoyer</button>' : '') + '</td></tr>';
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
    lireTable('pheno_visites', 'id,panel_id,cluster_code,semaine_iso,date_observation,saisie_le,recu_serveur_le,statut,mode_saisie,row_version', function (q) { return q.eq('campaign_id', camp.id).in('statut', ['SOUMIS', 'EN_VERIFICATION', 'CORRECTION_DEMANDEE']).order('date_observation'); }),
    lireTable('pheno_corrections', 'id,visite_id,arbre_id,champ,ancienne_valeur,nouvelle_valeur,motif,origine,proposee_le', function (q) { return q.eq('statut', 'PROPOSEE').order('proposee_le'); }),
    lireTable('pheno_panels', 'id,producteur_id,village_id,cluster_code', function (q) { return q.eq('campaign_id', camp.id); })
  ]).then(function (r) {
    var lignes = r[0].map(function (v) {
      return '<tr><td data-l="Cluster">' + esc(v.cluster_code) + '</td><td data-l="Semaine">' + esc(v.semaine_iso) + '</td><td data-l="Observée le">' + dateFr(v.date_observation) + '</td><td data-l="Reçue le">' + esc(heureFr(v.recu_serveur_le)) + '</td><td data-l="Saisie">' + (v.mode_saisie === 'TRANSCRIPTION_PAPIER' ? badge('Fiche papier recopiée', 'warn') : 'Directe') + '</td><td data-l="Statut">' + badge(C.LIBELLES.statut_visite[v.statut], tonStatut(v.statut)) + '</td><td><a class="btn secondary" href="#observatoire/validation/' + v.id + '">Ouvrir</a></td></tr>'; }).join('');
    var props = r[1].map(function (c) {
      return '<tr><td data-l="Champ modifié">' + esc(c.champ) + '</td><td data-l="Valeur serveur">' + esc(c.ancienne_valeur == null ? '—' : c.ancienne_valeur) + '</td><td data-l="Valeur proposée">' + esc(c.nouvelle_valeur == null ? '—' : c.nouvelle_valeur) + '</td><td data-l="Origine">' + (c.origine === 'CONFLIT_HORS_LIGNE' ? 'Envoi hors ligne tardif' : 'Auteur') + '</td><td data-l="Le">' + esc(heureFr(c.proposee_le)) + '</td><td><a class="btn secondary" href="#observatoire/validation/' + c.visite_id + '">Voir la visite</a> <button type="button" class="btn primary" data-act="corr" data-id="' + esc(c.id) + '" data-dec="APPLIQUEE">Appliquer</button> <button type="button" class="btn secondary" data-act="corr" data-id="' + esc(c.id) + '" data-dec="REJETEE">Rejeter</button></td></tr>'; }).join('');
    peindre(entete('Vérifier, demander une correction, valider. Vos droits réels sont décidés par le serveur.', 'validation') + message() +
      '<section class="card"><div class="card-head"><h2>Visites à traiter (' + r[0].length + ')</h2></div>' + (lignes ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Cluster</th><th>Semaine</th><th>Observée le</th><th>Reçue le</th><th>Saisie</th><th>Statut</th><th></th></tr></thead><tbody>' + lignes + '</tbody></table></div>' : '<div class="ops-empty">Aucune visite en attente dans votre périmètre.</div>') + '</section>' +
      '<section class="card"><div class="card-head"><h2>Propositions de correction (' + r[1].length + ')</h2><p>Une visite soumise ou validée n’est jamais écrasée : les écarts arrivent ici.</p></div>' + (props ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Champ modifié</th><th>Valeur serveur</th><th>Valeur proposée</th><th>Origine</th><th>Le</th><th></th></tr></thead><tbody>' + props + '</tbody></table></div>' : '<div class="ops-empty">Aucune proposition en attente.</div>') + '</section>');
  }).catch(function (e) { peindre(entete('Validation.', 'validation') + note(esc(e.message), 'danger')); });
}
function vueDecision(id) {
  return Promise.all([
    lireTable('pheno_visites', '*', function (q) { return q.eq('id', id); }),
    lireTable('pheno_observations', '*', function (q) { return q.eq('visite_id', id); }),
    lireTable('pheno_journal', 'le,action,ancienne,nouvelle,motif', function (q) { return q.eq('entite_id', id).order('le'); })
  ]).then(function (r) {
    var v = r[0][0]; if (!v) { peindre(entete('Visite introuvable dans votre périmètre.', 'validation')); return; }
    return lireTable('pheno_arbres', 'id,code,role,rang,statut', function (q) { return q.eq('panel_id', v.panel_id); }).then(function (arbres) {
      var par = {}; arbres.forEach(function (a) { par[a.id] = a; });
      var t = function (x) { return x == null ? '—' : esc({ OUI: 'Oui', NON: 'Non', PAS_VU: 'Pas vu' }[x] || x); };
      var lignes = r[1].sort(function (a, b) { return (par[a.arbre_id] || {}).rang - (par[b.arbre_id] || {}).rang; }).map(function (o) { var a = par[o.arbre_id] || {};
        return '<tr><td data-l="Arbre">' + esc(a.code || '') + '</td><td data-l="Retrouvé">' + (o.retrouve == null ? '—' : o.retrouve ? 'Oui' : 'Non') + '</td><td data-l="F">' + t(o.f) + '</td><td data-l="N">' + t(o.n) + '</td><td data-l="P">' + t(o.p) + '</td><td data-l="Chute">' + (o.chute ? esc(C.LIBELLES.chute[o.chute]) : '—') + '</td><td data-l="Preuve">' + (o.chute_preuve ? esc(C.LIBELLES.preuve[o.chute_preuve]) : '—') + '</td><td data-l="Remarque">' + esc(o.pas_vu_motif || '') + ' ' + esc(o.anomalie || '') + '</td></tr>'; }).join('');
      var hist = r[2].map(function (j) { return '<li><b>' + esc(heureFr(j.le)) + '</b> · ' + esc(j.action.replace(/_/g, ' ').toLowerCase()) + (j.motif ? ' — ' + esc(j.motif) : '') + '</li>'; }).join('');
      var ouverte = v.statut === 'SOUMIS' || v.statut === 'EN_VERIFICATION', aide = classe() !== 'AUH';
      peindre(entete('Visite ' + v.semaine_iso + ' · cluster ' + v.cluster_code, 'validation', '<a class="btn secondary" href="#observatoire/validation">Retour</a>') + message() +
        '<section class="card"><p>Statut : ' + badge(C.LIBELLES.statut_visite[v.statut], tonStatut(v.statut)) + ' · observée le <b>' + dateFr(v.date_observation) + '</b> · saisie le ' + esc(heureFr(v.saisie_le)) + ' · reçue par le serveur le ' + esc(heureFr(v.recu_serveur_le)) + (v.mode_saisie === 'TRANSCRIPTION_PAPIER' ? ' · ' + badge('Fiche papier recopiée', 'warn') : '') + '<br>Ramassage : ' + esc({ OUI: 'Oui', NON: 'Non', NE_SAIT_PAS: 'Ne sait pas' }[v.ramassage] || '—') + (v.anomalies ? ' · Remarques : ' + esc(v.anomalies) : '') + (v.correction_motif ? '<br>Correction demandée : ' + esc(v.correction_motif) : '') + '</p>' +
        (ouverte && aide ? '<div class="obs-actions">' + (v.statut === 'SOUMIS' ? '<button type="button" class="btn secondary" data-act="dec" data-dec="verifier" data-id="' + esc(v.id) + '" data-v="' + v.row_version + '">Mettre en vérification</button>' : '') + '<button type="button" class="btn signal" data-act="dec" data-dec="corriger" data-id="' + esc(v.id) + '" data-v="' + v.row_version + '">Demander une correction</button><button type="button" class="btn primary" data-act="dec" data-dec="valider" data-id="' + esc(v.id) + '" data-v="' + v.row_version + '">Valider</button></div>' : '') + '</section>' +
        '<section class="card"><div class="card-head"><h2>Observations (' + r[1].length + ' arbres)</h2></div><div class="table-wrap"><table class="obs-table"><thead><tr><th>Arbre</th><th>Retrouvé</th><th>F</th><th>N</th><th>P</th><th>Chute</th><th>Preuve</th><th>Remarque</th></tr></thead><tbody>' + lignes + '</tbody></table></div></section>' +
        '<section class="card"><div class="card-head"><h2>Historique</h2></div>' + (hist ? '<ul class="obs-histo">' + hist + '</ul>' : '<div class="ops-empty">Aucun événement.</div>') + '</section>');
    });
  }).catch(function (e) { peindre(entete('Validation.', 'validation') + note(esc(e.message), 'danger')); });
}
function decider(dec, id, version) {
  var p;
  if (dec === 'verifier') p = rpc('pheno_visite_verifier', { p_visite: id, p_version: version });
  else if (dec === 'valider') p = confirmer('Valider cette visite ?', 'Une visite validée alimente les suivis pilotes et ne peut plus être modifiée que par une correction tracée.', 'Valider').then(function (oui) { return oui ? rpc('pheno_visite_valider', { p_visite: id, p_version: version }) : null; });
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
    lireTable('pheno_panels', 'id,cluster_code,statut,pi_village,pi_champ,reserves_manquantes', function (q) { return q.eq('campaign_id', camp.id); })
  ]).then(function (r) {
    var p = r[2], actifs = p.filter(function (x) { return x.statut === 'ACTIF'; }).length, sansPi = p.filter(function (x) { return x.statut === 'ACTIF' && (x.pi_village == null || x.pi_champ == null); }).length;
    var q = r[0].map(function (x) { var couv = x.champs_actifs ? x.visites / x.champs_actifs : null;
      return '<tr><td data-l="Semaine">' + esc(x.semaine_iso) + '</td><td data-l="Cluster">' + esc(x.cluster_code) + '</td><td data-l="Champs actifs">' + x.champs_actifs + '</td><td data-l="Visites reçues">' + x.visites + ' (' + pct(couv) + ')</td><td data-l="Brouillons">' + x.brouillons + '</td><td data-l="À traiter">' + (x.soumises + x.en_verification) + '</td><td data-l="Corrections">' + x.corrections_demandees + '</td><td data-l="Validées">' + x.validees + '</td><td data-l="Fiches papier">' + x.transcriptions_papier + '</td><td data-l="Reçues après 48 h">' + x.recues_apres_48h + '</td><td data-l="Arbres non retrouvés">' + x.arbres_non_retrouves + '</td><td data-l="Arbres avec « Pas vu »">' + x.arbres_avec_pas_vu + '</td><td data-l="Écarts en attente">' + x.corrections_en_attente + '</td></tr>'; }).join('');
    var c = r[1].map(function (x) { var pal = { COUVERTURE_INSUFFISANTE: ['Couverture insuffisante', ''], AUCUN: ['Aucun palier', ''], PREALERTE_10: ['Préalerte 10 %', 'warn'], PREALERTE_20: ['Préalerte 20 %', 'warn'], PREALERTE_30: ['Préalerte 30 %', 'danger'] }[x.palier_experimental] || [x.palier_experimental, ''];
      return '<tr><td data-l="Semaine">' + esc(x.semaine_iso) + '</td><td data-l="Cluster">' + esc(x.cluster_code) + '</td><td data-l="Champs validés">' + x.champs_valides + ' / ' + x.champs_actifs + ' (' + pct(x.couverture) + ')</td><td data-l="C cumulatif (moyenne des champs)">' + pct(x.part_c_cumulatif_moyenne) + '</td><td data-l="Palier expérimental">' + badge(pal[0], pal[1]) + '</td></tr>'; }).join('');
    peindre(entete('Qualité des données et suivis pilotes.', 'qualite') +
      '<div class="kpi-grid"><div class="kpi"><small>Champs installés</small><b>' + p.length + '</b><span>' + actifs + ' actifs</span></div><div class="kpi ' + (p.length - actifs ? 'attn' : '') + '"><small>Installation en cours ou incompatible</small><b>' + (p.length - actifs) + '</b><span>à traiter</span></div><div class="kpi ' + (sansPi ? 'attn' : '') + '"><small>Probabilités amont non renseignées</small><b>' + sansPi + '</b><span>poids limités au champ</span></div></div>' +
      '<section class="card"><div class="card-head"><h2>Qualité par semaine et par cluster</h2><p>Tous statuts confondus. Outil de pilotage de la collecte.</p></div>' + (q ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Semaine</th><th>Cluster</th><th>Champs actifs</th><th>Visites reçues</th><th>Brouillons</th><th>À traiter</th><th>Corrections</th><th>Validées</th><th>Fiches papier</th><th>Reçues après 48 h</th><th>Non retrouvés</th><th>« Pas vu »</th><th>Écarts</th></tr></thead><tbody>' + q + '</tbody></table></div>' : '<div class="ops-empty">Aucune visite reçue pour cette campagne.</div>') + '</section>' +
      '<section class="card"><div class="card-head"><h2>Chute de fruits mûrs, cumul (PILOTE)</h2><p>Visites validées uniquement. Réserves non activées et brouillons exclus.</p></div>' + note('<b>Non officiel.</b> Paliers 10/20/30 % expérimentaux : simple préalerte, sans intervalle de confiance. Aucune prévision ni tonnage ne peut en être tiré en 2027.', 'warn') + (c ? '<div class="table-wrap"><table class="obs-table"><thead><tr><th>Semaine</th><th>Cluster</th><th>Champs validés</th><th>C cumulatif (moyenne des champs)</th><th>Palier expérimental</th></tr></thead><tbody>' + c + '</tbody></table></div>' : '<div class="ops-empty">Aucune visite validée.</div>') + '</section>');
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
    lireTable('aflp_clusters', 'code,label', function (q) { return q.order('code'); })
  ]).then(function (r) {
    var noms = {}; r[1].forEach(function (x) { noms[x.user_id] = x.nom + ' (' + x.role + ')'; });
    var lignes = r[0].map(function (a) { var exp = a.valide_au && a.valide_au < C.aujourdhui();
      return '<tr><td data-l="Personne">' + esc(noms[a.user_id] || a.user_id) + '</td><td data-l="Droit">' + (a.droit === 'VALIDATION' ? 'Validation finale' : 'Vérification') + '</td><td data-l="Clusters">' + esc((a.cluster_codes || []).join(', ')) + '</td><td data-l="Période">' + dateFr(a.valide_du) + ' → ' + (a.valide_au ? dateFr(a.valide_au) : 'sans fin') + '</td><td data-l="État">' + (!a.actif ? badge('Révoquée') : exp ? badge('Expirée', 'warn') : badge('Active', 'ok')) + '</td><td>' + (a.actif ? '<button type="button" class="btn secondary" data-act="revoquer" data-id="' + esc(a.id) + '">Révoquer</button>' : '') + '</td></tr>'; }).join('');
    peindre(entete('Qui peut vérifier et valider, sur quels clusters, pour quelle période.', 'affectations') + message() +
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
      .then(function (r) { etat.message = ['ok', 'Appareil prêt : ' + r.champs + ' champ(s)' + (r.parcelles == null ? '' : ', ' + r.parcelles + ' parcelle(s) du registre') + ' chargés.']; })
      .catch(function (e2) { etat.message = ['danger', e2.message]; }).then(rendre);
  }
  else if (act === 'inventaire') enregistrerInventaire(b.getAttribute('data-bloc'), b.getAttribute('data-num'));
  else if (act === 'marquer') marquerArbre(b.getAttribute('data-panel'), b.getAttribute('data-arbre'));
  else if (act === 'reserve') activerReserve(b.getAttribute('data-arbre'), b.getAttribute('data-code'));
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
  else if (act === 'revoquer') demanderMotif('Révoquer l’affectation', 'Le droit est retiré immédiatement.').then(function (m) { if (!m) return; return rpc('pheno_affectation_revoquer', { p_id: b.getAttribute('data-id'), p_motif: m }).then(function () { etat.message = ['ok', 'Affectation révoquée.']; }).catch(function (e3) { etat.message = ['danger', e3.message]; }).then(rendre); });
}
function surSaisie(e) {
  if (parts()[0] !== 'observatoire') return; var t = e.target;
  if (t.id === 'obsB') return majReperes();
  if (t.hasAttribute && t.hasAttribute('data-saisie') && brouillon) { brouillon.visite.observations[etat.idx][t.getAttribute('data-saisie')] = t.value.trim() || null; sauverBrouillon(); }
  if (t.hasAttribute && t.hasAttribute('data-visite') && brouillon) {
    var k = t.getAttribute('data-visite'); brouillon.visite[k] = t.value.trim() || null;
    sauverBrouillon().then(function () {
      if (e.type !== 'change') return;
      if (k === 'mode_saisie' && t.value === 'TRANSCRIPTION_PAPIER' && !etat.collegues) return rpc('pheno_observateurs_du_cluster').then(function (l) { etat.collegues = l || []; }).catch(function () { etat.collegues = []; }).then(rendre);
      if (k === 'mode_saisie' || k === 'date_observation') return rendre();
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
global.addEventListener('online', function () { if (peutCollecter()) synchroniser(false); });
document.addEventListener('anagroci:authenticated', function () { if (peutCollecter()) { synchroniser(false); if (!minuterie) minuterie = setInterval(function () { if (enLigne()) synchroniser(false); }, 90000); } if (parts()[0] === 'observatoire') rendre(); });
document.addEventListener('anagroci:campaign', function () { if (parts()[0] === 'observatoire') rendre(); });
if (L) L.surChangement(function () { if (parts()[0] === 'observatoire') barreEnvoi(); });

global.ANAGROCI_OBSERVATOIRE = { render: rendre, synchroniser: synchroniser };
})(window);

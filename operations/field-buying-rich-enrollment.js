/* FIELD BUYING — enrôlement riche OLD → NEW.
   Couche UI progressive au-dessus du moteur operations/field-buying.js.
   Aucune table parallèle : villages.data s1…s9, rt.data et Farmer Registry canonique.
*/
(function (global) {
'use strict';
if (global.ANAGROCI_FB_RICH) return;

var core = global.ANAGROCI_FB;
var coreRoute = global.ANAGROCI_OPS_ROUTE;
var richClient = null;
var refsCache = null;
var profileCache = null;

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>\"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function norm(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
function n(v) { if (v == null || String(v).trim() === '') return null; var x = Number(v); return isFinite(x) ? x : null; }
function val(id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; }
function checked(id) { var e = document.getElementById(id); return !!(e && e.checked); }
function checks(name) {
  return [].slice.call(document.querySelectorAll('input[name="' + name + '"]:checked')).map(function (x) { return x.value; });
}
function uid(prefix) { return (prefix || 'fb') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9); }
function today() { return new Date().toISOString().slice(0, 10); }
function phone(v) {
  var d = String(v || '').replace(/\D/g, '');
  if (d.length === 13 && d.slice(0, 3) === '225') d = d.slice(3);
  return d;
}
function getClient() {
  if (richClient) return Promise.resolve(richClient);
  return new Promise(function (resolve) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) {
        clearInterval(timer);
        richClient = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON);
        resolve(richClient);
      } else if (tries > 120) {
        clearInterval(timer); resolve(null);
      }
    }, 50);
  });
}
function query(table, cols, modifier) {
  return getClient().then(function (c) {
    if (!c) throw new Error('Supabase indisponible.');
    var q = c.from(table).select(cols || '*');
    if (modifier) q = modifier(q);
    return q.then(function (r) { if (r.error) throw new Error(r.error.message); return r.data || []; });
  });
}
function profile() {
  if (profileCache) return Promise.resolve(profileCache);
  return getClient().then(function (c) {
    if (!c) return {};
    return c.auth.getSession().then(function (s) {
      var u = s.data && s.data.session && s.data.session.user;
      if (!u) return {};
      return c.from('profils').select('nom,role,actif').eq('user_id', u.id).maybeSingle().then(function (r) {
        profileCache = { userId: u.id, nom: r.data && r.data.nom || '', role: r.data && r.data.role || '', actif: !r.data || r.data.actif !== false };
        return profileCache;
      });
    });
  }).catch(function () { return {}; });
}
function refs(force) {
  if (refsCache && !force) return Promise.resolve(refsCache);
  return Promise.all([
    query('villages', 'id,village,region,departement,cluster,cluster_code,gps_lat,gps_lng,statut,data,deleted', function (q) { return q.eq('deleted', false).limit(800); }),
    query('rt', 'id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,data,deleted', function (q) { return q.eq('deleted', false).limit(800); }),
    query('aflp_clusters', 'code,label,zone_code,active', function (q) { return q.eq('active', true).limit(50); })
  ]).then(function (rs) {
    refsCache = { villages: rs[0], rts: rs[1], clusters: rs[2] };
    return refsCache;
  });
}
function invalidate() {
  refsCache = null;
  if (core && core.store && core.store.invalidate) core.store.invalidate('base', 'farmers', 'sustainability');
}
function host() {
  var h = document.getElementById('fbFormHost');
  if (!h) {
    h = document.createElement('section'); h.id = 'fbFormHost'; h.className = 'ops-form-card';
    var head = document.querySelector('.ops-route-head');
    var root = document.getElementById('opsRouteView');
    if (head) head.insertAdjacentElement('afterend', h); else if (root) root.prepend(h);
  }
  h.hidden = false;
  setTimeout(function () { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 0);
  return h;
}
function close() {
  var h = document.getElementById('fbFormHost');
  if (h) { h.hidden = true; h.innerHTML = ''; }
}
function input(id, label, type, attrs, complete) {
  return '<div class="rich-field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + (type || 'text') + '" ' +
    (attrs || '') + (complete ? ' data-complete="1"' : '') + '></div>';
}
function select(id, label, opts, attrs, complete) {
  return '<div class="rich-field"><label for="' + id + '">' + label + '</label><select id="' + id + '" ' + (attrs || '') +
    (complete ? ' data-complete="1"' : '') + '>' + opts + '</select></div>';
}
function textarea(id, label, attrs, complete) {
  return '<div class="rich-field rich-span-2"><label for="' + id + '">' + label + '</label><textarea id="' + id + '" ' +
    (attrs || '') + (complete ? ' data-complete="1"' : '') + '></textarea></div>';
}
function options(rows, value, label, placeholder) {
  var o = '<option value="">' + esc(placeholder || 'Sélectionner…') + '</option>';
  return o + rows.map(function (r) { return '<option value="' + esc(r[value]) + '">' + esc(r[label]) + '</option>'; }).join('');
}
function yesNo(id, label, complete) {
  return select(id, label, '<option value="">Sélectionner…</option><option value="Oui">Oui</option><option value="Non">Non</option>', '', complete);
}
function checkboxGroup(name, label, values) {
  return '<div class="rich-field rich-span-2"><label>' + label + '</label><div class="rich-checks">' + values.map(function (v) {
    var x = Array.isArray(v) ? v : [v, v];
    return '<label><input type="checkbox" name="' + name + '" value="' + esc(x[0]) + '"> ' + esc(x[1]) + '</label>';
  }).join('') + '</div></div>';
}
function section(step, title, help, html) {
  return '<fieldset class="rich-step" data-step="' + step + '"' + (step === 1 ? '' : ' hidden') + '><legend>' + title + '</legend>' +
    '<p class="rich-help">' + help + '</p><div class="rich-grid">' + html + '</div></fieldset>';
}
function shell(title, subtitle, stepNames, content, formId) {
  var pills = stepNames.map(function (s, i) { return '<button type="button" class="rich-step-pill' + (i === 0 ? ' active' : '') + '" data-go="' + (i + 1) + '"><span>' + (i + 1) + '</span>' + esc(s) + '</button>'; }).join('');
  return '<div class="rich-form-head"><div><h2>' + title + '</h2><p>' + subtitle + '</p></div><button type="button" class="btn secondary" data-rich-close>Fermer</button></div>' +
    '<div class="rich-rule"><b>Campagne 2027 :</b> dossier incomplet ≠ dossier inutilisable. Les informations non bloquantes peuvent être complétées plus tard.</div>' +
    '<div class="rich-completion"><div><b data-rich-percent>0 %</b><span>Complétude du dossier</span></div><div class="rich-bar"><i data-rich-bar></i></div><span data-rich-level>Niveau 1 — minimum opérationnel</span></div>' +
    '<div class="rich-stepper">' + pills + '</div>' +
    '<form id="' + formId + '" novalidate>' + content +
    '<div class="rich-form-actions"><button class="btn secondary" type="button" data-rich-prev>← Précédent</button><button class="btn secondary" type="button" data-rich-next>Suivant →</button><button class="btn primary" type="submit" data-rich-save hidden>Enregistrer</button></div><div class="rich-form-msg" data-rich-msg></div></form>';
}
function wireStepper(h, requiredIds) {
  var steps = [].slice.call(h.querySelectorAll('.rich-step'));
  var current = 1;
  function update() {
    steps.forEach(function (s, i) { s.hidden = (i + 1) !== current; });
    [].slice.call(h.querySelectorAll('.rich-step-pill')).forEach(function (p, i) { p.classList.toggle('active', (i + 1) === current); });
    var prev = h.querySelector('[data-rich-prev]'), next = h.querySelector('[data-rich-next]'), save = h.querySelector('[data-rich-save]');
    if (prev) prev.disabled = current === 1;
    if (next) next.hidden = current === steps.length;
    if (save) save.hidden = current !== steps.length;
    completion();
  }
  function completion() {
    var fields = [].slice.call(h.querySelectorAll('[data-complete="1"]'));
    var filled = fields.filter(function (e) { return e.type === 'checkbox' ? e.checked : String(e.value || '').trim() !== ''; }).length;
    var pct = fields.length ? Math.round(filled * 100 / fields.length) : 0;
    var hardOk = (requiredIds || []).every(function (id) { var e = h.querySelector('#' + id); return e && String(e.value || '').trim(); });
    var display = h.querySelector('[data-rich-percent]'), bar = h.querySelector('[data-rich-bar]'), level = h.querySelector('[data-rich-level]');
    if (display) display.textContent = pct + ' %';
    if (bar) bar.style.width = pct + '%';
    if (level) level.textContent = !hardOk ? 'À compléter — minimum opérationnel manquant' : pct >= 85 ? 'Niveau 3 — dossier complet' : pct >= 55 ? 'Niveau 2 — profil enrichi' : 'Niveau 1 — opérationnel ✓';
  }
  h.addEventListener('input', completion);
  h.addEventListener('change', completion);
  h.querySelector('[data-rich-prev]').addEventListener('click', function () { if (current > 1) { current--; update(); } });
  h.querySelector('[data-rich-next]').addEventListener('click', function () { if (current < steps.length) { current++; update(); } });
  [].slice.call(h.querySelectorAll('.rich-step-pill')).forEach(function (p) { p.addEventListener('click', function () { current = Number(p.dataset.go); update(); }); });
  var c = h.querySelector('[data-rich-close]'); if (c) c.addEventListener('click', close);
  update();
}
function message(h, text, kind) {
  var m = h.querySelector('[data-rich-msg]');
  if (!m) return;
  m.className = 'rich-form-msg ' + (kind || ''); m.textContent = text || '';
}
function setBusy(h, busy) { var b = h.querySelector('[data-rich-save]'); if (b) b.disabled = !!busy; }
function currentPosition(latId, lngId, accId) {
  if (!navigator.geolocation) return alert('Géolocalisation indisponible sur cet appareil.');
  navigator.geolocation.getCurrentPosition(function (p) {
    var la = document.getElementById(latId), lo = document.getElementById(lngId), ac = accId && document.getElementById(accId);
    if (la) la.value = p.coords.latitude.toFixed(6); if (lo) lo.value = p.coords.longitude.toFixed(6); if (ac) ac.value = Math.round(p.coords.accuracy || 0);
    if (la) la.dispatchEvent(new Event('input', { bubbles: true }));
  }, function () { alert('Impossible de récupérer la position. Vérifiez les autorisations GPS.'); }, { enableHighAccuracy: true, timeout: 15000 });
}

/* ---------------------------------------------------------------- Village */
function openVillage() {
  var h = host(); h.innerHTML = '<p class="muted">Préparation du recensement village…</p>';
  Promise.all([refs(), profile()]).then(function (rs) {
    var r = rs[0], p = rs[1];
    var cOpts = '<option value="">Sélectionner le cluster…</option>' + r.clusters.map(function (c) { return '<option value="' + esc(c.code) + '" data-zone="' + esc(c.zone_code || '') + '">' + esc(c.code + ' — ' + c.label) + '</option>'; }).join('');
    var steps = ['Identification', 'Localisation', 'Production', 'Accessibilité', 'Concurrence', 'Organisation', 'Paiement & risques', 'Validation'];
    var html = '';
    html += section(1, '1. Identification du village', 'Les informations structurantes du référentiel.',
      input('rv_nom', 'Nom du village *', 'text', 'required autocomplete="off"', true) +
      input('rv_code', 'Code / référence locale', 'text', 'placeholder="Si disponible"', true) +
      select('rv_cluster', 'Cluster *', cOpts, 'required', true) +
      input('rv_zone', 'Zone', 'text', 'readonly placeholder="Déduite du cluster"', true) +
      input('rv_region', 'Région', 'text', '', true) + input('rv_dept', 'Département', 'text', '', true) +
      input('rv_sp', 'Sous-préfecture', 'text', '', true) + input('rv_commune', 'Commune / localité de rattachement', 'text', '', true));
    html += section(2, '2. Localisation', 'Le GPS reste recommandé mais non bloquant pour 2027.',
      input('rv_lat', 'Latitude', 'number', 'step="0.000001" min="-90" max="90"', true) + input('rv_lng', 'Longitude', 'number', 'step="0.000001" min="-180" max="180"', true) +
      input('rv_precision', 'Précision GPS (m)', 'number', 'min="0"', true) + '<div class="rich-field"><label>GPS terrain</label><button class="btn secondary" type="button" id="rv_gps_btn">Utiliser ma position</button></div>' +
      input('rv_dist_hub', 'Distance village → hub (km)', 'number', 'min="0" step="0.1"', true) + input('rv_dist_bouake', 'Distance vers Bouaké / point logistique (km)', 'number', 'min="0" step="0.1"', true) +
      select('rv_route', 'Type de route', '<option value="">Sélectionner…</option><option value="A">A — Bitume</option><option value="B">B — Mixte</option><option value="C">C — Piste</option>', '', true) +
      input('rv_hub', 'Hub / entrepôt de rattachement', 'text', 'placeholder="Hub prévu"', true));
    html += section(3, '3. Production & potentiel', 'Conserver le potentiel commercial même si certaines valeurs restent estimatives.',
      input('rv_nb_prod', 'Nombre estimé de producteurs RCN', 'number', 'min="0"', true) + input('rv_prod_est', 'Production estimée RCN (kg)', 'number', 'min="0" step="1"', true) +
      input('rv_vol_local', 'Quantité vendue localement (kg)', 'number', 'min="0"', true) + input('rv_vol_saison', 'Quantité vendue la saison précédente (kg)', 'number', 'min="0"', true) +
      input('rv_cible', 'Volume cible ANAGROCI (kg)', 'number', 'min="0"', true) + input('rv_periode', 'Période forte RCN', 'text', 'placeholder="Ex. février–avril"', true) +
      select('rv_potentiel', 'Appréciation du potentiel', '<option value="">Sélectionner…</option><option>Fort</option><option>Moyen</option><option>Faible</option>', '', true) +
      yesNo('rv_interet', 'Intérêt du village pour ANAGROCI', true));
    html += section(4, '4. Accessibilité & logistique', 'Évaluer l’évacuation réelle pendant la campagne.',
      select('rv_type_acces', 'Accès principal', '<option value="">Sélectionner…</option><option>Bitume</option><option>Route latéritique</option><option>Piste</option><option>Mixte</option>', '', true) +
      select('rv_pluie', 'Accès en saison des pluies', '<option value="">Sélectionner…</option><option>Bon</option><option>Moyen</option><option>Difficile</option><option>Impraticable</option>', '', true) +
      checkboxGroup('rv_vehicules', 'Véhicules pouvant accéder au village', [['VL','Véhicule léger'],['4-7T','Camion 4–7 T'],['15-17T','Camion 15–17 T'],['30-40T','Camion 30–40 T']]) +
      yesNo('rv_ponts', 'Ponts / rivières / franchissements sensibles', true) + input('rv_temps', 'Temps estimatif vers hub (min)', 'number', 'min="0"', true) +
      yesNo('rv_stockage', 'Point de stockage disponible', true) + textarea('rv_points_critiques', 'Points critiques / contraintes d’évacuation', 'rows="3"', true));
    html += section(5, '5. Achat & concurrence', 'Documenter la pression concurrentielle et les habitudes d’achat.',
      yesNo('rv_competition', 'Présence d’acheteurs concurrents', true) +
      select('rv_niveau_conc', 'Niveau de concurrence', '<option value="">Sélectionner…</option><option>Faible</option><option>Moyen</option><option>Élevé</option><option>Très élevé</option>', '', true) +
      input('rv_acheteur1', 'Principal concurrent / acheteur', 'text', '', true) + input('rv_acheteur_tel', 'Contact concurrent si connu', 'tel', '', false) +
      input('rv_prix_obs', 'Prix observé (FCFA/kg)', 'number', 'min="0"', true) + input('rv_historique', 'Historique / canal d’achat dominant', 'text', '', true) +
      select('rv_fidelite', 'Fidélité aux acheteurs actuels', '<option value="">Sélectionner…</option><option>Faible</option><option>Moyenne</option><option>Forte</option>', '', true));
    html += section(6, '6. Organisation locale', 'Identifier les relais réels du village.',
      input('rv_chef', 'Chef de village', 'text', '', true) + input('rv_chef_tel', 'Téléphone chef', 'tel', '', true) +
      input('rv_leader', 'Leader / représentant producteurs', 'text', '', true) + input('rv_leader_tel', 'Téléphone leader', 'tel', '', true) +
      input('rv_structure', 'Organisation / coopérative locale', 'text', '', true) + input('rv_nb_membres', 'Nombre de membres', 'number', 'min="0"', true) +
      input('rv_candidat_rt', 'Candidat RT principal', 'text', '', true) + input('rv_candidat_tel', 'Téléphone candidat RT', 'tel', '', true) +
      textarea('rv_org_obs', 'Observations organisation locale', 'rows="3"', true));
    html += section(7, '7. Paiement, conformité & risques', 'Les habitudes de paiement et les risques conditionnent l’exécution terrain.',
      select('rv_pref_paie', 'Préférence de paiement', '<option value="">Sélectionner…</option><option>Wave</option><option>Mobile Money</option><option>Espèces</option><option>Virement</option><option>Mixte</option>', '', true) +
      yesNo('rv_recu', 'Reçu écrit habituellement utilisé', true) + yesNo('rv_info_avant', 'Prix communiqué avant paiement', true) + yesNo('rv_acceptation', 'Acceptation du processus ANAGROCI', true) +
      yesNo('rv_exclusivite', 'Exclusivité avec un acheteur existant', true) + yesNo('rv_litige', 'Litige ou conflit connu', true) +
      checkboxGroup('rv_risques', 'Risques identifiés', [['Concurrence','Concurrence'],['Accessibilité','Accessibilité'],['Sécurité','Sécurité'],['Qualité','Qualité'],['Faible volume','Faible volume'],['Logistique','Logistique'],['Paiement','Paiement']]) +
      textarea('rv_contraintes', 'Contraintes complémentaires', 'rows="3"', true));
    html += section(8, '8. Validation & plan d’action', 'La création peut rester en Brouillon ; la gouvernance de validation demeure côté serveur.',
      select('rv_decision', 'Décision terrain', '<option value="">Sélectionner…</option><option>À approfondir</option><option>Retenir</option><option>Prioritaire</option><option>Écarter</option>', '', true) +
      select('rv_priorite', 'Priorité', '<option value="">Sélectionner…</option><option>Haute</option><option>Moyenne</option><option>Basse</option>', '', true) +
      textarea('rv_actions', 'Actions à mener', 'rows="3"', true) + textarea('rv_besoins', 'Besoins / appuis nécessaires', 'rows="3"', true) + textarea('rv_commentaire', 'Commentaire final', 'rows="3"', true));

    h.innerHTML = shell('Nouveau village — recensement complet', 'Ancien FBMS restauré dans le shell Operations · sections s1 à s9 · aucune donnée parallèle.', steps, html, 'richVillageForm');
    wireStepper(h, ['rv_nom', 'rv_cluster']);
    h.querySelector('#rv_gps_btn').addEventListener('click', function () { currentPosition('rv_lat','rv_lng','rv_precision'); });
    h.querySelector('#rv_cluster').addEventListener('change', function () {
      var o = this.options[this.selectedIndex]; var z = h.querySelector('#rv_zone'); if (z) z.value = o ? (o.dataset.zone || '') : '';
    });
    h.querySelector('#richVillageForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = val('rv_nom'), cluster = val('rv_cluster');
      if (!name || !cluster) return message(h, 'Nom du village et cluster sont obligatoires pour le minimum opérationnel.', 'error');
      var duplicate = r.villages.find(function (v) { return norm(v.village) === norm(name) && norm(v.cluster || v.cluster_code) === norm(cluster); });
      if (duplicate) return message(h, 'Doublon probable : un village de même nom existe déjà dans ce cluster (' + (duplicate.village || duplicate.id) + ').', 'error');
      var lat = n(val('rv_lat')), lng = n(val('rv_lng')), precision = n(val('rv_precision'));
      var buyer = val('rv_acheteur1') ? [{ nom: val('rv_acheteur1'), telephone: val('rv_acheteur_tel'), prixObserve: n(val('rv_prix_obs')) }] : [];
      var candidate = val('rv_candidat_rt') ? [{ nom: val('rv_candidat_rt'), telephone: val('rv_candidat_tel'), statut: 'Pressenti' }] : [];
      var riskList = checks('rv_risques');
      var data = {
        id: uid('village'), statut: 'Brouillon', createdAt: new Date().toISOString(), createdBy: p.nom || '',
        s1: { nom: name, village: name, code: val('rv_code'), cluster: cluster, zone: val('rv_zone'), region: val('rv_region'), departement: val('rv_dept'), sousPrefecture: val('rv_sp'), commune: val('rv_commune'), gps: (lat != null && lng != null) ? (lat + ',' + lng) : '', gpsLat: lat, gpsLng: lng, precision: precision, distanceHubKm: n(val('rv_dist_hub')), distanceHub: n(val('rv_dist_hub')), distanceBouakeKm: n(val('rv_dist_bouake')), hub: val('rv_hub'), route: val('rv_route'), dateRecensement: today(), enqueteur: p.nom || '' },
        s2: { chef: { nom: val('rv_chef'), telephone: val('rv_chef_tel') }, leader: { nom: val('rv_leader'), telephone: val('rv_leader_tel') }, structure: val('rv_structure'), nbMembres: n(val('rv_nb_membres')), nbProducteursRCN: n(val('rv_nb_prod')), observations: val('rv_org_obs') },
        s3: { periodeForte: val('rv_periode'), productionEstimee: n(val('rv_prod_est')), quantiteVendueLocale: n(val('rv_vol_local')), quantiteVendueSaison: n(val('rv_vol_saison')), volumeCibleAnagroci: n(val('rv_cible')), potentiel: val('rv_potentiel') },
        s4: { acheteurs: buyer, competition: val('rv_competition'), niveauConcurrence: val('rv_niveau_conc'), prixObserve: n(val('rv_prix_obs')), historiqueAchat: val('rv_historique'), fidelite: val('rv_fidelite'), interetAnagroci: val('rv_interet') },
        s5: { typeAcces: val('rv_type_acces'), route: val('rv_route'), pluie: val('rv_pluie'), ponts: val('rv_ponts'), typeVehicules: checks('rv_vehicules'), tempsHubMin: n(val('rv_temps')), pointsCritiques: val('rv_points_critiques') },
        s6: { preference: val('rv_pref_paie'), infoAvantPaiement: val('rv_info_avant'), recuEcrit: val('rv_recu') },
        s7: { candidats: candidate },
        s8: { organisation: val('rv_structure'), contraintes: val('rv_contraintes'), acceptation: val('rv_acceptation'), litige: val('rv_litige'), exclusiviteAcheteur: val('rv_exclusivite'), lieuStockage: val('rv_stockage'), zoneCluster: cluster, risques: riskList },
        s9: { decision: val('rv_decision'), potentiel: val('rv_potentiel'), priorite: val('rv_priorite'), actions: val('rv_actions') ? [val('rv_actions')] : [], besoins: val('rv_besoins') ? [val('rv_besoins')] : [], risques: riskList, commentaire: val('rv_commentaire'), date: today(), redacteur: p.nom || '', validationBM: false }
      };
      setBusy(h, true); message(h, 'Création du village et enregistrement du recensement s1…s9…');
      getClient().then(function (c) {
        return c.from('villages').insert({ id: data.id, village: name, region: val('rv_region') || null, departement: val('rv_dept') || null, statut: 'Brouillon', cluster: cluster, cluster_code: cluster, gps_lat: lat, gps_lng: lng, data: data });
      }).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        invalidate(); message(h, 'Village créé avec son dossier de recensement complet.', 'success');
        setTimeout(function () { close(); if (core && core.render) core.render(); }, 800);
      }).catch(function (e) { setBusy(h, false); message(h, e.message || 'Création impossible.', 'error'); });
    });
  }).catch(function (e) { h.innerHTML = '<div class="notice danger">' + esc(e.message || 'Chargement impossible.') + '</div>'; });
}

/* ---------------------------------------------------------------- RT */
function openRT() {
  var h = host(); h.innerHTML = '<p class="muted">Préparation du dossier RT…</p>';
  refs().then(function (r) {
    var villageOpts = options(r.villages, 'id', 'village', 'Sélectionner le village…');
    var steps = ['Identité', 'Activité', 'Capacité', 'Finance & achat', 'Évaluation'];
    var html = '';
    html += section(1, '1. Identité & rattachement', 'Le village est obligatoire avant activation du RT.',
      input('rr_nom', 'Nom et prénoms *', 'text', 'required', true) + input('rr_tel', 'Téléphone principal *', 'tel', 'required placeholder="0XXXXXXXXX"', true) +
      input('rr_tel2', 'Téléphone secondaire', 'tel', '', true) + select('rr_village', 'Village *', villageOpts, 'required', true) +
      input('rr_localite', 'Adresse / localité', 'text', '', true) + select('rr_statut', 'Statut', '<option>Pressenti</option><option>Confirmé</option><option>Actif</option><option>Écarté</option>', '', true));
    html += section(2, '2. Activité & rôle terrain', 'Le statut Producteur permet ensuite le pont RT → Producteur.',
      select('rr_activite', 'Activité principale', '<option value="">Sélectionner…</option><option>Producteur</option><option>Pisteur</option><option>Commerçant</option><option>Producteur / Pisteur</option><option>Producteur / Commerçant</option><option>Autre</option>', '', true) +
      yesNo('rr_producteur', 'Est lui-même producteur ?', true) + input('rr_autre_activite', 'Autre activité / précision', 'text', '', true) +
      input('rr_zone_influence', 'Zone d’influence', 'text', '', true) + yesNo('rr_disponible', 'Disponible pendant la campagne', true));
    html += section(3, '3. Capacité opérationnelle', 'Reprendre les critères historiques d’évaluation RT.',
      input('rr_experience', 'Expérience achat RCN (années)', 'number', 'min="0"', true) + input('rr_reseau', 'Nombre de producteurs connus / mobilisables', 'number', 'min="0"', true) +
      input('rr_volume_est', 'Volume potentiel estimé (kg)', 'number', 'min="0"', true) + input('rr_volume_souhaite', 'Volume cible / souhaité (kg)', 'number', 'min="0"', true) +
      select('rr_moyen', 'Moyen de déplacement', '<option value="">Sélectionner…</option><option>Moto</option><option>Véhicule</option><option>Vélo</option><option>À pied</option><option>Autre</option>', '', true) +
      select('rr_niveau', 'Connaissance terrain', '<option value="">Sélectionner…</option><option>Très bonne</option><option>Bonne</option><option>Moyenne</option><option>Faible</option>', '', true) +
      input('rr_saches', 'Sacs pouvant être prépositionnés', 'number', 'min="0"', true));
    html += section(4, '4. Finance & achat', 'Les données financières restent informatives ; les règles d’avances sont gérées par le moteur central.',
      yesNo('rr_credit', 'Besoin d’avance / crédit', true) + input('rr_capacite', 'Capacité d’achat déclarée (FCFA)', 'number', 'min="0"', true) +
      select('rr_paiement', 'Canal de paiement préféré', '<option value="">Sélectionner…</option><option>Wave</option><option>Mobile Money</option><option>Espèces</option><option>Virement</option>', '', true) +
      input('rr_comp', 'Commission attendue (FCFA/kg)', 'number', 'min="0" step="0.1"', true) + input('rr_tolerance', 'Tolérance écart déclarée (%)', 'number', 'min="0" step="0.1"', true) +
      yesNo('rr_endettement', 'Endettement / engagement concurrent connu', true));
    html += section(5, '5. Évaluation & décision', 'La fiche reste exploitable même si l’évaluation détaillée est complétée plus tard.',
      select('rr_reputation', 'Réputation locale', '<option value="">Sélectionner…</option><option>Très bonne</option><option>Bonne</option><option>Moyenne</option><option>À vérifier</option><option>Défavorable</option>', '', true) +
      select('rr_fiabilite', 'Fiabilité opérationnelle', '<option value="">Sélectionner…</option><option>Élevée</option><option>Moyenne</option><option>Faible</option><option>À vérifier</option>', '', true) +
      select('rr_risque', 'Niveau de risque', '<option value="">Sélectionner…</option><option>Faible</option><option>Moyen</option><option>Élevé</option>', '', true) +
      select('rr_reco', 'Recommandation', '<option value="">Sélectionner…</option><option>Retenir</option><option>Retenir sous condition</option><option>À approfondir</option><option>Écarter</option>', '', true) +
      textarea('rr_obs', 'Observations', 'rows="4"', true));
    h.innerHTML = shell('Nouveau RT — dossier enrichi', 'Identité, capacité, finance, réputation et double rôle RT/Producteur.', steps, html, 'richRTForm');
    wireStepper(h, ['rr_nom','rr_tel','rr_village']);
    h.querySelector('#richRTForm').addEventListener('submit', function (ev) {
      ev.preventDefault(); var name = val('rr_nom'), tel = phone(val('rr_tel')), vid = val('rr_village');
      if (!name || !tel || !vid) return message(h, 'Nom, téléphone et village sont obligatoires.', 'error');
      var v = r.villages.find(function (x) { return x.id === vid; }) || {};
      var dupe = r.rts.find(function (x) { return (phone(x.telephone) === tel && tel) || (norm(x.nom) === norm(name) && x.village_id === vid); });
      if (dupe) return message(h, 'Doublon RT probable détecté : ' + (dupe.nom || dupe.id_rt || dupe.id) + '. Le garde serveur reste également actif.', 'error');
      var isProducer = val('rr_producteur') === 'Oui' || /PRODUCTEUR/.test(norm(val('rr_activite')));
      var id = uid('rt');
      var data = {
        id: id, activite: val('rr_activite') || val('rr_autre_activite'), activite_autre: val('rr_autre_activite'), producteur: isProducer,
        telephone_secondaire: val('rr_tel2'), localite: val('rr_localite'), zone_influence: val('rr_zone_influence'), disponible: val('rr_disponible'),
        experience: n(val('rr_experience')), reseau: n(val('rr_reseau')), volume_estime: n(val('rr_volume_est')), volume_souhaite: n(val('rr_volume_souhaite')),
        moyen_deplacement: val('rr_moyen'), niveau: val('rr_niveau'), saches_preposition: n(val('rr_saches')), credit_souhaite: val('rr_credit'),
        capacite: n(val('rr_capacite')), paiement: val('rr_paiement'), commission: n(val('rr_comp')), tolerance_ecart: n(val('rr_tolerance')), endettement: val('rr_endettement'),
        reputation: val('rr_reputation'), fiabilite: val('rr_fiabilite'), risque: val('rr_risque'), recommandation: val('rr_reco'), observations: val('rr_obs'),
        date_creation: new Date().toISOString(), source: 'OPERATIONS_FIELD_BUYING_RICH'
      };
      setBusy(h, true); message(h, 'Contrôle serveur et création du RT…');
      getClient().then(function (c) { return c.from('rt').insert({ id: id, nom: name, telephone: tel, village_id: vid, village_nom: v.village || null, statut: val('rr_statut') || 'Pressenti', cluster: v.cluster || v.cluster_code || null, data: data }); })
        .then(function (res) { if (res.error) throw new Error(res.error.message); invalidate(); message(h, 'RT créé. ' + (isProducer ? 'Le bouton « Enrôler comme producteur » sera disponible.' : ''), 'success'); setTimeout(function () { close(); if (core && core.render) core.render(); }, 900); })
        .catch(function (e) { setBusy(h, false); message(h, e.message || 'Création impossible.', 'error'); });
    });
  }).catch(function (e) { h.innerHTML = '<div class="notice danger">' + esc(e.message || 'Chargement impossible.') + '</div>'; });
}

/* ---------------------------------------------------------------- Producteur */
function farmerForm(prefill) {
  var h = host(); h.innerHTML = '<p class="muted">Préparation du Farmer Registry…</p>';
  refs().then(function (r) {
    prefill = prefill || {};
    var villageOpts = options(r.villages, 'id', 'village', 'Sélectionner le village…');
    var rtOpts = options(r.rts, 'id', 'nom', 'Aucun RT / sélectionner…');
    var steps = ['Identité', 'Profil agricole', 'Parcelle', 'Production', 'Consentement', 'Validation'];
    var html = '';
    html += section(1, '1. Identité producteur', 'Minimum 2027 : nom + village. La parcelle, le GPS et Sustainability ne bloquent jamais la création.',
      input('rp_nom', 'Nom *', 'text', 'required', true) + input('rp_prenoms', 'Prénoms', 'text', '', true) +
      select('rp_sexe', 'Sexe', '<option value="">Non renseigné</option><option value="M">M</option><option value="F">F</option><option value="OTHER">Autre</option><option value="UNKNOWN">Inconnu</option>', '', true) +
      input('rp_birth', 'Année de naissance', 'number', 'min="1900" max="' + new Date().getFullYear() + '"', true) +
      input('rp_tel', 'Téléphone', 'tel', 'placeholder="0XXXXXXXXX"', true) + input('rp_tel2', 'Téléphone alternatif', 'tel', '', true) +
      select('rp_village', 'Village *', villageOpts, 'required', true) + select('rp_rt', 'RT référent', rtOpts, '', true) +
      select('rp_lang', 'Langue préférée', '<option value="">Non renseigné</option><option>Français</option><option>Baoulé</option><option>Dioula</option><option>Autre</option>', '', true) +
      select('rp_piece_type', 'Type de pièce', '<option value="">À compléter</option><option>CNI</option><option>Attestation identité</option><option>Passeport</option><option>Permis</option><option>Autre</option>', '', true) + input('rp_piece_num', 'Numéro de pièce', 'text', '', true));
    html += section(2, '2. Profil agricole', 'Ces données enrichissent le Farmer Passport sans bloquer l’achat.',
      input('rp_annees', 'Années d’expérience en anacarde', 'number', 'min="0"', true) + input('rp_nb_parcelles', 'Nombre de parcelles déclaré', 'number', 'min="0"', true) +
      input('rp_superficie', 'Superficie productive déclarée (ha)', 'number', 'min="0" step="0.01"', true) + input('rp_age_verger', 'Âge moyen du verger (ans)', 'number', 'min="0" step="0.1"', true) +
      input('rp_arbres', 'Nombre d’arbres productifs', 'number', 'min="0"', true) + input('rp_prod_prev', 'Production campagne précédente (kg)', 'number', 'min="0"', true) +
      input('rp_prod_2027', 'Potentiel campagne 2027 (kg)', 'number', 'min="0"', true) + input('rp_canal_prev', 'Canal de vente précédent', 'text', '', true) +
      yesNo('rp_deja_anagroci', 'Déjà fournisseur ANAGROCI', true) + yesNo('rp_coop', 'Membre d’une coopérative', true) +
      input('rp_autres_cultures', 'Autres cultures', 'text', '', true) + select('rp_mode_paie', 'Mode de paiement préféré', '<option value="">À préciser</option><option>Wave</option><option>Mobile Money</option><option>Espèces</option><option>Virement</option>', '', true));
    html += section(3, '3. Parcelle — facultative en 2027', '<b>Parcelle à compléter après campagne</b> si elle n’est pas disponible maintenant. Les données sont écrites dans farmer_plots, jamais dans un faux champ parallèle.',
      yesNo('rp_add_plot', 'Renseigner une parcelle maintenant ?', true) + input('rp_plot_name', 'Nom local de la parcelle', 'text', '', true) +
      input('rp_plot_area', 'Superficie déclarée (ha)', 'number', 'min="0" step="0.01"', true) + select('rp_tenure', 'Statut foncier', '<option value="UNKNOWN">Inconnu</option><option value="OWNER">Propriétaire</option><option value="FAMILY">Familial</option><option value="LEASED">Loué</option><option value="BORROWED">Prêté</option><option value="CUSTOMARY">Coutumier</option><option value="SHARED">Partagé</option><option value="OTHER">Autre</option>', '', true) +
      input('rp_plot_age', 'Âge du verger (ans)', 'number', 'min="0" step="0.1"', true) + input('rp_plot_lat', 'Latitude', 'number', 'step="0.000001" min="-90" max="90"', true) + input('rp_plot_lng', 'Longitude', 'number', 'step="0.000001" min="-180" max="180"', true) +
      input('rp_plot_acc', 'Précision GPS (m)', 'number', 'min="0"', true) + '<div class="rich-field"><label>GPS parcelle</label><button class="btn secondary" type="button" id="rp_plot_gps">Utiliser ma position</button></div>' +
      textarea('rp_plot_notes', 'Notes parcelle', 'rows="3"', true));
    html += section(4, '4. Baseline production', 'La baseline est créée en DRAFT uniquement si des valeurs sont renseignées.',
      input('rp_base_area', 'Superficie productive baseline (ha)', 'number', 'min="0" step="0.01"', true) + input('rp_base_prev', 'Production précédente baseline (kg)', 'number', 'min="0"', true) +
      input('rp_base_forecast', 'Prévision 2027 baseline (kg)', 'number', 'min="0"', true) + input('rp_base_trees', 'Arbres productifs baseline', 'number', 'min="0"', true) +
      textarea('rp_base_notes', 'Notes baseline', 'rows="3"', true));
    html += section(5, '5. Consentement & Sustainability', 'Le consentement peut être enregistré maintenant ou plus tard. Sustainability reste non bloquant.',
      select('rp_consent', 'Statut du consentement', '<option value="">À enregistrer plus tard</option><option value="GRANTED">Accordé</option><option value="PARTIAL">Partiel</option><option value="REFUSED">Refusé</option>', '', true) +
      select('rp_consent_method', 'Méthode', '<option value="VERBAL">Verbal</option><option value="WRITTEN">Écrit</option><option value="DIGITAL">Digital</option><option value="WITNESSED">Avec témoin</option>', '', true) +
      checkboxGroup('rp_scope', 'Portée du consentement', [['data_collection','Collecte de données'],['purchasing','Achat RCN'],['gps','GPS / parcelle'],['sustainability','Sustainability']]) +
      textarea('rp_consent_notes', 'Notes de consentement', 'rows="3"', true));
    html += section(6, '6. Validation', 'Le producteur devient opérationnel avec le minimum ; le passeport peut être enrichi progressivement.',
      select('rp_statut', 'Statut référentiel', '<option value="Identifié">Identifié</option><option value="Enrôlé">Enrôlé</option><option value="Actif">Actif</option><option value="Inactif">Inactif</option>', '', true) +
      textarea('rp_obs', 'Observations générales', 'rows="4"', true) +
      '<div class="rich-field rich-span-2"><div class="rich-rule rich-soft"><b>Rappel :</b> absence de parcelle/GPS = producteur autorisé. L’achat RCN doit rester possible.</div></div>');
    h.innerHTML = shell('Nouveau producteur — entrée Farmer Passport', 'Création rapide + enrichissement progressif · Farmer ID attribué par le moteur canonique.', steps, html, 'richFarmerForm');
    wireStepper(h, ['rp_nom','rp_village']);
    h.querySelector('#rp_plot_gps').addEventListener('click', function () { currentPosition('rp_plot_lat','rp_plot_lng','rp_plot_acc'); });
    if (prefill.nom) h.querySelector('#rp_nom').value = prefill.nom;
    if (prefill.telephone) h.querySelector('#rp_tel').value = phone(prefill.telephone);
    if (prefill.village_id) h.querySelector('#rp_village').value = prefill.village_id;
    if (prefill.id) h.querySelector('#rp_rt').value = prefill.id;
    if (prefill.data && prefill.data.superficie) h.querySelector('#rp_superficie').value = prefill.data.superficie;
    h.querySelectorAll('[data-complete="1"]')[0] && h.querySelectorAll('[data-complete="1"]')[0].dispatchEvent(new Event('input', { bubbles: true }));
    h.querySelector('#richFarmerForm').addEventListener('submit', function (ev) {
      ev.preventDefault(); var name = val('rp_nom'), vid = val('rp_village'), telRaw = val('rp_tel'), tel = phone(telRaw);
      if (!name || !vid) return message(h, 'Nom et village sont obligatoires. La parcelle/GPS ne le sont pas.', 'error');
      if (tel && !/^0[0-9]{9}$/.test(tel)) return message(h, 'Téléphone producteur invalide : utilisez 10 chiffres commençant par 0, ou laissez vide.', 'error');
      var v = r.villages.find(function (x) { return x.id === vid; }) || {};
      var id = uid('farmer');
      setBusy(h, true); message(h, 'Contrôle des doublons dans Farmer Registry…');
      getClient().then(function (c) {
        return c.rpc('farmer_possible_duplicates', { p_nom: name, p_telephone: tel || null, p_village_id: vid, p_exclude_id: null }).then(function (dup) {
          if (dup.error) throw new Error(dup.error.message);
          if ((dup.data || []).length) throw new Error('Doublon possible détecté (' + dup.data.length + '). Vérifiez le Farmer Registry avant de recréer cette personne.');
          var producerData = {
            id: id, source: 'OPERATIONS_FIELD_BUYING_RICH', rt_source_id: prefill.id || val('rp_rt') || null,
            annees_anacarde: n(val('rp_annees')), nombre_parcelles_declare: n(val('rp_nb_parcelles')), superficie: n(val('rp_superficie')), age_verger_ans: n(val('rp_age_verger')),
            arbres_productifs: n(val('rp_arbres')), production_precedente_kg: n(val('rp_prod_prev')), potentiel_2027_kg: n(val('rp_prod_2027')), canal_vente_precedent: val('rp_canal_prev'),
            membre_cooperative: val('rp_coop'), autres_cultures: val('rp_autres_cultures'), mode_paiement: val('rp_mode_paie'), observations: val('rp_obs'), contact_secondaire: val('rp_tel2')
          };
          var row = { id: id, nom: name, prenoms: val('rp_prenoms') || null, telephone: tel || null, telephone_alt: phone(val('rp_tel2')) || null,
            village_id: vid, village_nom: v.village || null, rt_id: val('rp_rt') || null, sexe: val('rp_sexe') || null, birth_year: n(val('rp_birth')),
            preferred_language: val('rp_lang') || null, id_document_type: val('rp_piece_type') || null, id_document_number: val('rp_piece_num') || null,
            statut: val('rp_statut') || 'Identifié', data: producerData };
          return c.from('producteurs').insert(row).then(function (ins) { if (ins.error) throw new Error(ins.error.message); return c; });
        });
      }).then(function (c) {
        var jobs = [];
        var addPlot = val('rp_add_plot') === 'Oui';
        var plat = n(val('rp_plot_lat')), plng = n(val('rp_plot_lng')), pacc = n(val('rp_plot_acc'));
        if (addPlot || val('rp_plot_name') || n(val('rp_plot_area')) != null || plat != null || plng != null) {
          var gpsReady = plat != null && plng != null && pacc != null && pacc > 0;
          jobs.push(c.from('farmer_plots').insert({ producteur_id: id, village_id: vid, local_name: val('rp_plot_name') || 'Parcelle principale', declared_area: n(val('rp_plot_area')), area_unit: 'HA', land_tenure_status: val('rp_tenure') || 'UNKNOWN', orchard_age_years: n(val('rp_plot_age')), latitude: plat, longitude: plng, gps_accuracy_m: gpsReady ? pacc : null, gps_captured_at: gpsReady ? new Date().toISOString() : null, gps_status: gpsReady ? 'POINT_CAPTURED' : 'NOT_MAPPED', area_source: 'DECLARED', evidence_level: 'DECLARED', notes: val('rp_plot_notes') || null, status: 'ACTIVE' }));
        }
        var baseArea = n(val('rp_base_area')) != null ? n(val('rp_base_area')) : n(val('rp_superficie'));
        var basePrev = n(val('rp_base_prev')) != null ? n(val('rp_base_prev')) : n(val('rp_prod_prev'));
        var baseForecast = n(val('rp_base_forecast')) != null ? n(val('rp_base_forecast')) : n(val('rp_prod_2027'));
        var baseTrees = n(val('rp_base_trees')) != null ? n(val('rp_base_trees')) : n(val('rp_arbres'));
        if (baseArea != null || basePrev != null || baseForecast != null || baseTrees != null) {
          jobs.push(c.from('farmer_production_baselines').insert({ producteur_id: id, campaign: '2027', version: 1, productive_area_ha: baseArea, previous_production_kg: basePrev, forecast_kg: baseForecast, productive_tree_count: baseTrees, previous_sales_channel: val('rp_canal_prev') || null, already_anagroci_supplier: val('rp_deja_anagroci') === 'Oui', data_source: 'DECLARED', evidence_level: 'DECLARED', status: 'DRAFT', captured_at: new Date().toISOString(), notes: val('rp_base_notes') || null }));
        }
        if (val('rp_consent')) {
          var scope = {}; checks('rp_scope').forEach(function (x) { scope[x] = true; });
          jobs.push(c.from('farmer_consents').insert({ producteur_id: id, status: val('rp_consent'), scopes: scope, consent_at: new Date().toISOString(), agent_name: '', text_version: 'AFLP-2027', method: val('rp_consent_method') || 'VERBAL', notes: val('rp_consent_notes') || null, source: 'OPERATIONS_FIELD_BUYING_RICH' }));
        }
        return Promise.all(jobs.map(function (j) { return j.then(function (rj) { if (rj.error) throw new Error(rj.error.message); return rj; }); })).then(function () {
          return c.rpc('farmer_registry_refresh_passport', { p_producteur_id: id }).then(function () { return id; }).catch(function () { return id; });
        });
      }).then(function () {
        invalidate(); message(h, 'Producteur créé. Farmer Passport initialisé. Parcelle/GPS restent non bloquants.', 'success');
        setTimeout(function () { close(); location.hash = '#farmers/' + encodeURIComponent(id); }, 1000);
      }).catch(function (e) { setBusy(h, false); message(h, e.message || 'Création impossible.', 'error'); });
    });
  }).catch(function (e) { h.innerHTML = '<div class="notice danger">' + esc(e.message || 'Chargement impossible.') + '</div>'; });
}
function rtToFarmer(rtId) {
  refs().then(function (r) {
    var rt = r.rts.find(function (x) { return x.id === rtId; });
    if (!rt) return alert('RT introuvable.');
    var eligible = (rt.data && rt.data.producteur) || /PRODUCTEUR/.test(norm(rt.data && rt.data.activite));
    if (!eligible) return alert('Ce RT n’est pas identifié comme producteur. Complétez d’abord sa fiche RT.');
    farmerForm(rt);
  });
}

/* --------------------------------------------------------------- Farmer Passport */
function card(title, value, sub) { return '<div class="rich-pass-card"><small>' + esc(title) + '</small><b>' + esc(value == null || value === '' ? '—' : value) + '</b><span>' + esc(sub || '') + '</span></div>'; }
function miniTable(headers, rows) {
  if (!rows.length) return '<div class="ops-empty">Aucune donnée enregistrée.</div>';
  return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}
function renderPassport(id) {
  var root = document.getElementById('opsRouteView'); if (!root) return Promise.resolve();
  root.innerHTML = '<div class="ops-route-head"><div><h1>Farmer Passport</h1><p>Chargement de la fiche 360°…</p></div></div><div class="rich-pass-loading">Chargement des rubriques…</div>';
  return getClient().then(function (c) {
    if (!c) throw new Error('Supabase indisponible.');
    return Promise.all([
      c.from('farmer_passport_summary_v').select('*').eq('producteur_id', id).maybeSingle(),
      c.from('producteurs').select('*').eq('id', id).maybeSingle(),
      c.from('farmer_plots').select('*').eq('producteur_id', id).eq('deleted', false).order('created_at', { ascending: false }),
      c.from('farmer_production_baselines').select('*').eq('producteur_id', id).order('version', { ascending: false }),
      c.from('farmer_sustainability_baselines').select('*').eq('producteur_id', id).order('version', { ascending: false }),
      c.from('farmer_consents').select('*').eq('producteur_id', id).order('consent_at', { ascending: false }),
      c.from('farmer_visits').select('*').eq('producteur_id', id).order('visit_date', { ascending: false }).limit(50),
      c.from('farmer_inspections').select('*').eq('producteur_id', id).order('inspection_date', { ascending: false }).limit(50),
      c.from('farmer_verifications').select('*').eq('producteur_id', id).order('verified_at', { ascending: false }).limit(50),
      c.from('farmer_action_plans').select('*').eq('producteur_id', id).order('created_at', { ascending: false }).limit(50),
      c.from('achats').select('id,date,poids_net,prix_kg,montant,numero_recu,qualite_statut,statut_validation,stock_statut,producteur_id').eq('producteur_id', id).order('date', { ascending: false }).limit(100)
    ]).then(function (rs) {
      rs.forEach(function (x) { if (x.error) throw new Error(x.error.message); });
      return { summary: rs[0].data || {}, farmer: rs[1].data || {}, plots: rs[2].data || [], production: rs[3].data || [], sustainability: rs[4].data || [], consents: rs[5].data || [], visits: rs[6].data || [], inspections: rs[7].data || [], verifications: rs[8].data || [], actions: rs[9].data || [], purchases: rs[10].data || [] };
    });
  }).then(function (d) {
    var s = d.summary, f = d.farmer, fd = f.data || {};
    var totalKg = d.purchases.reduce(function (a, x) { return a + Number(x.poids_net || 0); }, 0);
    var plotStatus = d.plots.length ? (d.plots.filter(function (p) { return p.gps_status === 'GPS_VERIFIED' || p.gps_status === 'POINT_CAPTURED'; }).length + '/' + d.plots.length + ' GPS') : 'À compléter après campagne';
    var tabs = ['Identité','Exploitation','Parcelles','Production','Sustainability','Consentements','Visites','Inspections','Achats','Lots / Traceability','Actions','Historique'];
    var tabBtns = tabs.map(function (t, i) { return '<button class="rich-pass-tab' + (i === 0 ? ' active' : '') + '" type="button" data-pass-tab="' + i + '">' + esc(t) + '</button>'; }).join('');
    var sections = '';
    sections += '<section class="rich-pass-pane" data-pass-pane="0"><div class="rich-pass-grid">' + card('Farmer ID', s.farmer_id || f.code) + card('Nom', (f.nom || '') + ' ' + (f.prenoms || '')) + card('Téléphone', f.telephone) + card('Sexe', f.sexe) + card('Naissance', f.birth_year) + card('Village', s.village_nom || f.village_nom) + card('RT référent', s.rt_nom || f.rt_id) + card('Statut opérationnel', s.operational_status || f.operational_status || f.statut) + '</div></section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="1" hidden><div class="rich-pass-grid">' + card('Années anacarde', fd.annees_anacarde) + card('Parcelles déclarées', fd.nombre_parcelles_declare || d.plots.length) + card('Superficie déclarée', fd.superficie ? fd.superficie + ' ha' : '') + card('Âge verger', fd.age_verger_ans ? fd.age_verger_ans + ' ans' : '') + card('Arbres productifs', fd.arbres_productifs) + card('Potentiel 2027', fd.potentiel_2027_kg ? fd.potentiel_2027_kg + ' kg' : '') + card('Coopérative', fd.membre_cooperative) + card('Paiement préféré', fd.mode_paiement) + '</div></section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="2" hidden><div class="rich-pass-summary">' + card('État parcelles', plotStatus) + '</div>' + miniTable(['Parcelle','Surface','Foncier','GPS','Statut'], d.plots.map(function (p) { return '<tr><td>' + esc(p.local_name || 'Parcelle') + '</td><td>' + esc(p.declared_area ? p.declared_area + ' ha' : '—') + '</td><td>' + esc(p.land_tenure_status || '—') + '</td><td>' + esc(p.gps_status || 'NOT_MAPPED') + '</td><td>' + esc(p.status || '—') + '</td></tr>'; })) + '</section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="3" hidden>' + miniTable(['Campagne','Surface productive','Production précédente','Prévision','Rendement','Statut'], d.production.map(function (b) { return '<tr><td>' + esc(b.campaign) + '</td><td>' + esc(b.productive_area_ha || '—') + '</td><td>' + esc(b.previous_production_kg || '—') + '</td><td>' + esc(b.forecast_kg || '—') + '</td><td>' + esc(b.yield_kg_ha || '—') + '</td><td>' + esc(b.status || '—') + '</td></tr>'; })) + '</section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="4" hidden>' + miniTable(['Campagne','Réponses','Risque','Statut','Date'], d.sustainability.map(function (b) { return '<tr><td>' + esc(b.campaign) + '</td><td>' + esc((b.answered_count || 0) + '/' + (b.required_count || 0)) + '</td><td>' + esc(b.risk_profile || 'NOT_ASSESSED') + '</td><td>' + esc(b.status || '—') + '</td><td>' + esc(b.inspection_date || '—') + '</td></tr>'; })) + '</section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="5" hidden>' + miniTable(['Date','Statut','Méthode','Version','Notes'], d.consents.map(function (x) { return '<tr><td>' + esc(x.consent_at ? String(x.consent_at).slice(0,10) : '—') + '</td><td>' + esc(x.status) + '</td><td>' + esc(x.method) + '</td><td>' + esc(x.text_version || '—') + '</td><td>' + esc(x.notes || '') + '</td></tr>'; })) + '</section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="6" hidden>' + miniTable(['Date','Type','Objet','Résultat','Prochaine action'], d.visits.map(function (x) { return '<tr><td>' + esc(x.visit_date ? String(x.visit_date).slice(0,10) : '—') + '</td><td>' + esc(x.visit_type || '—') + '</td><td>' + esc(x.purpose || '—') + '</td><td>' + esc(x.outcome || '—') + '</td><td>' + esc(x.next_action || '—') + '</td></tr>'; })) + '</section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="7" hidden>' + miniTable(['Date','Type','Statut','Risque','Inspecteur'], d.inspections.map(function (x) { return '<tr><td>' + esc(x.inspection_date || '—') + '</td><td>' + esc(x.inspection_type || '—') + '</td><td>' + esc(x.status || '—') + '</td><td>' + esc(x.risk_profile || '—') + '</td><td>' + esc(x.inspector_name || '—') + '</td></tr>'; })) + '</section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="8" hidden><div class="rich-pass-summary">' + card('Achats cumulés', Math.round(totalKg) + ' kg', d.purchases.length + ' achat(s)') + '</div>' + miniTable(['Date','Poids net','Prix','Montant','Reçu','Qualité'], d.purchases.map(function (x) { return '<tr><td>' + esc(x.date || '—') + '</td><td>' + esc(x.poids_net || 0) + ' kg</td><td>' + esc(x.prix_kg || 0) + '</td><td>' + esc(x.montant || 0) + '</td><td>' + esc(x.numero_recu || '—') + '</td><td>' + esc(x.qualite_statut || '—') + '</td></tr>'; })) + '</section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="9" hidden><div class="rich-trace-box"><b>Chaîne canonique</b><p>Farmer ID → Achat → Lot → Expédition → Réception. Utilisez la rubrique <a href="#traceability">Traceability</a> pour la recherche complète sans quitter Operations.</p><div class="rich-pass-grid">' + card('Farmer ID', s.farmer_id || f.code) + card('Achats liés', d.purchases.length) + card('Poids traçable', Math.round(totalKg) + ' kg') + '</div></div></section>';
    sections += '<section class="rich-pass-pane" data-pass-pane="10" hidden>' + miniTable(['Priorité','Catégorie','Problème','Action corrective','Responsable','Échéance','Statut'], d.actions.map(function (x) { return '<tr><td>' + esc(x.priority || '—') + '</td><td>' + esc(x.category || '—') + '</td><td>' + esc(x.issue || '—') + '</td><td>' + esc(x.corrective_action || '—') + '</td><td>' + esc(x.responsible_name || '—') + '</td><td>' + esc(x.due_date || '—') + '</td><td>' + esc(x.status || '—') + '</td></tr>'; })) + '</section>';
    var history = d.verifications.map(function (x) { return { date: x.verified_at, type: 'Vérification', detail: x.verification_method || x.status, actor: x.verifier_name }; }).concat(d.inspections.map(function (x) { return { date: x.inspection_date, type: 'Inspection', detail: x.inspection_type, actor: x.inspector_name }; })).concat(d.visits.map(function (x) { return { date: x.visit_date, type: 'Visite', detail: x.visit_type, actor: x.agent_name }; })).sort(function (a,b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    sections += '<section class="rich-pass-pane" data-pass-pane="11" hidden>' + miniTable(['Date','Événement','Détail','Acteur'], history.map(function (x) { return '<tr><td>' + esc(x.date ? String(x.date).slice(0,10) : '—') + '</td><td>' + esc(x.type) + '</td><td>' + esc(x.detail || '—') + '</td><td>' + esc(x.actor || '—') + '</td></tr>'; })) + '</section>';
    root.innerHTML = '<div class="ops-route-head"><div><h1>Farmer Passport · ' + esc(s.farmer_id || f.code || id) + '</h1><p>Fiche 360° progressive — les données manquantes ne bloquent pas l’achat 2027.</p></div><div class="ops-route-actions"><a class="btn secondary" href="#farmers">← Producteurs</a><button class="btn primary" type="button" id="richPassportRefresh">Actualiser</button></div></div>' +
      '<div class="rich-pass-hero"><div><span>Opérationnel</span><b>' + esc(s.operational_status || f.operational_status || 'ACTIVE') + '</b></div><div><span>Complétude Farmer Passport</span><b>' + esc((s.passport_completion == null ? f.passport_completion : s.passport_completion) || 0) + ' %</b></div><div><span>Parcelle</span><b>' + esc(plotStatus) + '</b></div><div><span>Risque</span><b>' + esc(s.risk_profile || f.risk_profile || 'NOT_ASSESSED') + '</b></div></div>' +
      '<div class="rich-pass-tabs">' + tabBtns + '</div><div class="rich-pass-body">' + sections + '</div>';
    [].slice.call(root.querySelectorAll('[data-pass-tab]')).forEach(function (btn) { btn.addEventListener('click', function () {
      var idx = btn.dataset.passTab;
      root.querySelectorAll('[data-pass-tab]').forEach(function (x) { x.classList.toggle('active', x === btn); });
      root.querySelectorAll('[data-pass-pane]').forEach(function (x) { x.hidden = x.dataset.passPane !== idx; });
    }); });
    var refresh = root.querySelector('#richPassportRefresh'); if (refresh) refresh.addEventListener('click', function () {
      getClient().then(function (c) { return c.rpc('farmer_registry_refresh_passport', { p_producteur_id: id }); }).then(function () { renderPassport(id); });
    });
  }).catch(function (e) { root.innerHTML = '<div class="ops-route-head"><div><h1>Farmer Passport</h1></div></div><div class="notice danger"><b>Impossible de charger la fiche :</b> ' + esc(e.message || e) + '</div><a class="btn secondary" href="#farmers">Retour Producteurs</a>'; });
}

/* -------------------------------------------------------------- installation */
function richRoute() {
  var parts = (location.hash || '#overview').slice(1).split('/').map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
  if (parts[0] === 'farmers' && parts[1]) return renderPassport(parts[1]);
  return coreRoute ? coreRoute() : Promise.resolve();
}
function install() {
  core = global.ANAGROCI_FB || core;
  coreRoute = global.ANAGROCI_OPS_ROUTE || coreRoute;
  if (!core || !coreRoute) return false;
  core.openVillageForm = openVillage;
  core.openRtForm = openRT;
  core.openFarmerForm = farmerForm;
  core.rtToFarmer = rtToFarmer;
  core.openRichFarmerPassport = renderPassport;
  core.closeForm = close;
  global.ANAGROCI_OPS_ROUTE = richRoute;
  global.ANAGROCI_FB_RICH = { version: '1.0.0', installed: true, openVillage: openVillage, openRT: openRT, openFarmer: farmerForm, rtToFarmer: rtToFarmer, passport: renderPassport, audit: 'OLD_TO_NEW_S1_S9' };
  return true;
}
var tries = 0;
var timer = setInterval(function () { tries++; if (install() || tries > 120) clearInterval(timer); }, 50);
})(window);

/* FIELD BUYING — droits ciblés RT / Producteurs.
   But : permettre au Zonal Head (Chef de Zone) de modifier les fiches RT et
   Producteurs de son périmètre sans lui ouvrir les autres écritures terrain.
   L'Agent Recenseur conserve les formulaires natifs du moteur principal.
   La base reste l'arbitre : RLS + peut_modifier_rt_producteur().
*/
(function (global) {
'use strict';

var sb = null;
var me = null;
var observer = null;

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
function val(id) {
  var el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}
function numOrNull(v) {
  if (v === '') return null;
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function client() {
  if (sb) return sb;
  if (!global.supabase || !global.ANAGROCI_SUPABASE_URL || !global.ANAGROCI_SUPABASE_ANON) return null;
  sb = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON);
  return sb;
}
function loadMe() {
  var c = client();
  if (!c) return Promise.resolve(null);
  return c.auth.getSession().then(function (s) {
    var u = s.data && s.data.session && s.data.session.user;
    if (!u) return null;
    return c.from('profils').select('user_id,nom,role,actif,zone,cluster,village_id,rt_id')
      .eq('user_id', u.id).maybeSingle();
  }).then(function (r) {
    me = r && !r.error ? r.data : null;
    return me;
  }).catch(function () { return null; });
}
function isZonal() {
  return !!(me && me.actif !== false && String(me.role || '').toLowerCase() === 'zonal head');
}
function routeParts() {
  return (location.hash || '').replace(/^#/, '').split('/').map(function (x) {
    try { return decodeURIComponent(x); } catch (e) { return x; }
  });
}
function host() {
  return document.getElementById('fbFormHost');
}
function showMessage(msg, bad) {
  var h = host();
  if (!h) return;
  var box = h.querySelector('[data-role="msg"]');
  if (box) box.innerHTML = '<div class="notice ' + (bad ? 'danger' : 'ok') + '">' + esc(msg) + '</div>';
}
function closeEditor() {
  var h = host();
  if (!h) return;
  h.hidden = true;
  h.innerHTML = '';
}
function optionRows(rows, valueKey, labelFn, selected) {
  return (rows || []).map(function (x) {
    var v = x[valueKey];
    return '<option value="' + esc(v) + '"' + (String(v) === String(selected || '') ? ' selected' : '') + '>' +
      esc(labelFn(x)) + '</option>';
  }).join('');
}
function field(label, input) {
  return '<div class="ops-field"><label>' + esc(label) + '</label>' + input + '</div>';
}
function formShell(title, body) {
  return '<div class="card-head"><div><h2>' + esc(title) + '</h2><p>Modification autorisée dans votre périmètre. La suppression reste interdite.</p></div></div>' +
    '<div class="ops-form-grid">' + body + '</div>' +
    '<div data-role="msg"></div>' +
    '<div class="ops-actions"><button class="btn primary" type="button" data-role="save">Enregistrer</button>' +
    '<button class="btn secondary" type="button" data-role="cancel">Annuler</button></div>';
}
function openRt(id) {
  if (!isZonal() || !id) return;
  var c = client(), h = host();
  if (!c || !h) return;
  h.hidden = false;
  h.innerHTML = '<p class="muted">Chargement du RT…</p>';
  Promise.all([
    c.from('rt').select('id,id_rt,nom,telephone,village_id,village_nom,cluster,statut,data,deleted').eq('id', id).maybeSingle(),
    c.from('villages_light_v').select('id,village,cluster,deleted').eq('deleted', false).limit(500)
  ]).then(function (rs) {
    var r = rs[0];
    if (r.error || !r.data) throw new Error((r.error && r.error.message) || 'RT introuvable');
    var row = r.data, d = row.data || {}, villages = (rs[1].data || []).filter(function (v) { return !v.deleted; });
    h.innerHTML = formShell('Modifier le RT ' + (row.id_rt || row.nom || ''),
      field('Nom', '<input id="zrNom" value="' + esc(row.nom || '') + '">') +
      field('Téléphone', '<input id="zrTel" inputmode="tel" value="' + esc(row.telephone || '') + '">') +
      field('Statut', '<select id="zrStatut"><option>Pressenti</option><option>Confirmé</option><option>Actif</option><option>Inactif</option></select>') +
      field('Village', '<select id="zrVillage"><option value="">—</option>' + optionRows(villages, 'id', function (v) { return v.village + ' · ' + (v.cluster || '—'); }, row.village_id) + '</select>') +
      field('Activité', '<input id="zrActivite" value="' + esc(d.activite || '') + '">') +
      field('Réputation', '<input id="zrReputation" value="' + esc(d.reputation || '') + '">')
    );
    var st = document.getElementById('zrStatut'); if (st) st.value = row.statut || 'Pressenti';
    h.querySelector('[data-role="cancel"]').onclick = closeEditor;
    h.querySelector('[data-role="save"]').onclick = function () {
      var villageId = val('zrVillage');
      var village = villages.filter(function (v) { return String(v.id) === String(villageId); })[0] || {};
      var nd = Object.assign({}, d, {
        nom: val('zrNom'), telephone: val('zrTel'), statut: val('zrStatut'),
        villageId: villageId || null, villageNom: village.village || row.village_nom || null,
        cluster: village.cluster || row.cluster || null,
        activite: val('zrActivite'), reputation: val('zrReputation'),
        updatedAt: new Date().toISOString(), updatedBy: me && me.nom ? me.nom : 'Zonal Head'
      });
      c.from('rt').update({
        nom: val('zrNom'), telephone: val('zrTel'), statut: val('zrStatut'),
        village_id: villageId || row.village_id, village_nom: village.village || row.village_nom,
        cluster: village.cluster || row.cluster, data: nd
      }).eq('id', row.id).select('id').single().then(function (u) {
        if (u.error) throw new Error(u.error.message);
        showMessage('RT modifié avec succès.', false);
        if (global.ANAGROCI_FB && global.ANAGROCI_FB.store) global.ANAGROCI_FB.store.clear();
        setTimeout(function () { closeEditor(); if (global.ANAGROCI_FB) global.ANAGROCI_FB.reload(); }, 600);
      }).catch(function (e) { showMessage(e.message || String(e), true); });
    };
    h.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }).catch(function (e) { h.innerHTML = '<div class="notice danger"><b>Impossible d’ouvrir le RT :</b> ' + esc(e.message || e) + '</div>'; });
}
function openFarmer(id) {
  if (!isZonal() || !id) return;
  var c = client(), h = host();
  if (!c || !h) return;
  h.hidden = false;
  h.innerHTML = '<p class="muted">Chargement du producteur…</p>';
  Promise.all([
    c.from('producteurs').select('id,nom,prenoms,sexe,birth_year,telephone,telephone_alt,id_document_type,id_document_number,village_id,rt_id,statut,operational_status,data,deleted').eq('id', id).maybeSingle(),
    c.from('villages_light_v').select('id,village,cluster,deleted').eq('deleted', false).limit(500),
    c.from('rt_light_v').select('id,id_rt,nom,village_id,cluster,deleted').eq('deleted', false).limit(500)
  ]).then(function (rs) {
    var r = rs[0];
    if (r.error || !r.data) throw new Error((r.error && r.error.message) || 'Producteur introuvable');
    var row = r.data, d = row.data || {};
    var villages = (rs[1].data || []).filter(function (v) { return !v.deleted; });
    var rts = (rs[2].data || []).filter(function (x) { return !x.deleted; });
    h.innerHTML = formShell('Modifier le producteur ' + (row.nom || ''),
      field('Nom', '<input id="zfNom" value="' + esc(row.nom || '') + '">') +
      field('Prénoms', '<input id="zfPrenoms" value="' + esc(row.prenoms || '') + '">') +
      field('Sexe', '<select id="zfSexe"><option value="">—</option><option value="M">M · Homme</option><option value="F">F · Femme</option></select>') +
      field('Année de naissance', '<input id="zfBirth" inputmode="numeric" value="' + esc(row.birth_year || '') + '">') +
      field('Téléphone', '<input id="zfTel" inputmode="tel" value="' + esc(row.telephone || '') + '">') +
      field('Téléphone alternatif', '<input id="zfTelAlt" inputmode="tel" value="' + esc(row.telephone_alt || '') + '">') +
      field('Type pièce', '<input id="zfDocType" value="' + esc(row.id_document_type || '') + '">') +
      field('N° pièce', '<input id="zfDocNum" value="' + esc(row.id_document_number || '') + '">') +
      field('Village', '<select id="zfVillage"><option value="">—</option>' + optionRows(villages, 'id', function (v) { return v.village + ' · ' + (v.cluster || '—'); }, row.village_id) + '</select>') +
      field('RT', '<select id="zfRt"><option value="">—</option>' + optionRows(rts, 'id', function (x) { return (x.id_rt || x.id) + ' · ' + (x.nom || ''); }, row.rt_id) + '</select>') +
      field('Statut', '<input id="zfStatut" value="' + esc(row.statut || '') + '">') +
      field('Statut opérationnel', '<select id="zfOp"><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select>') +
      field('Superficie (ha)', '<input id="zfSurf" inputmode="decimal" value="' + esc(d.superficieHa == null ? '' : d.superficieHa) + '">') +
      field('Engagement 2027 (kg)', '<input id="zfEng" inputmode="decimal" value="' + esc(d.engagementKg == null ? '' : d.engagementKg) + '">') +
      field('Potentiel 2027 (kg)', '<input id="zfPot" inputmode="decimal" value="' + esc(d.potentiel2027Kg == null ? '' : d.potentiel2027Kg) + '">') +
      field('Coopérative', '<input id="zfCoop" value="' + esc(d.cooperative || '') + '">')
    );
    var sx = document.getElementById('zfSexe'); if (sx) sx.value = row.sexe || '';
    var op = document.getElementById('zfOp'); if (op) op.value = row.operational_status || 'ACTIVE';
    h.querySelector('[data-role="cancel"]').onclick = closeEditor;
    h.querySelector('[data-role="save"]').onclick = function () {
      var villageId = val('zfVillage');
      var village = villages.filter(function (v) { return String(v.id) === String(villageId); })[0] || {};
      var nd = Object.assign({}, d, {
        nom: val('zfNom'), prenoms: val('zfPrenoms'), sexe: val('zfSexe') === 'M' ? 'Homme' : val('zfSexe') === 'F' ? 'Femme' : '',
        anneeNaissance: numOrNull(val('zfBirth')), telephone: val('zfTel'), telephoneAlt: val('zfTelAlt'),
        villageId: villageId || null, villageNom: village.village || d.villageNom || null,
        cluster: village.cluster || d.cluster || null, rtId: val('zfRt') || null,
        statut: val('zfStatut'), operationalStatus: val('zfOp'), superficieHa: numOrNull(val('zfSurf')),
        engagementKg: numOrNull(val('zfEng')), potentiel2027Kg: numOrNull(val('zfPot')), cooperative: val('zfCoop'),
        updatedAt: new Date().toISOString(), updatedBy: me && me.nom ? me.nom : 'Zonal Head'
      });
      c.from('producteurs').update({
        nom: val('zfNom'), prenoms: val('zfPrenoms'), sexe: val('zfSexe') || null,
        birth_year: numOrNull(val('zfBirth')), telephone: val('zfTel'), telephone_alt: val('zfTelAlt') || null,
        id_document_type: val('zfDocType') || null, id_document_number: val('zfDocNum') || null,
        village_id: villageId || row.village_id, rt_id: val('zfRt') || null,
        statut: val('zfStatut'), operational_status: val('zfOp'), data: nd
      }).eq('id', row.id).select('id').single().then(function (u) {
        if (u.error) throw new Error(u.error.message);
        showMessage('Producteur modifié avec succès.', false);
        if (global.ANAGROCI_FB && global.ANAGROCI_FB.store) global.ANAGROCI_FB.store.clear();
        setTimeout(function () { closeEditor(); if (global.ANAGROCI_FB) global.ANAGROCI_FB.reload(); }, 600);
      }).catch(function (e) { showMessage(e.message || String(e), true); });
    };
    h.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }).catch(function (e) { h.innerHTML = '<div class="notice danger"><b>Impossible d’ouvrir le producteur :</b> ' + esc(e.message || e) + '</div>'; });
}
function ensureButton() {
  if (!isZonal()) return;
  var p = routeParts();
  if (p.length < 2) return;
  var type = p[0], id = p[1];
  if (type !== 'rt' && type !== 'farmers') return;
  var actions = document.querySelector('#opsRouteView .ops-route-actions');
  if (!actions || actions.querySelector('[data-zonal-edit]')) return;
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn secondary';
  b.setAttribute('data-zonal-edit', '1');
  b.textContent = 'Modifier';
  b.onclick = function () { if (type === 'rt') openRt(id); else openFarmer(id); };
  actions.insertBefore(b, actions.firstChild || null);
}
function install() {
  var root = document.getElementById('opsRouteView');
  if (!root || observer) return;
  observer = new MutationObserver(function () { ensureButton(); });
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('hashchange', function () { setTimeout(ensureButton, 50); });
  ensureButton();
}
function boot() {
  loadMe().then(function () {
    if (!isZonal()) return;
    install();
  });
}

global.ANAGROCI_FB_ROLE_EDIT = { openRt: openRt, openFarmer: openFarmer, close: closeEditor };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})(window);

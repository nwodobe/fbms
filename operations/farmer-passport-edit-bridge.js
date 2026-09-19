/* FIELD BUYING — bridge d'edition Farmer Passport.
   Adapte les formulaires Farmer Registry historiques au shell Operations
   sans recreer un second moteur metier. Les droits restent arbitres par RLS. */
(function (global) {
'use strict';

var FR = global.AFLP_FARMER_REGISTRY = global.AFLP_FARMER_REGISTRY || {};

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
  });
}
function fmt(value, digits) {
  var x = Number(value);
  if (!isFinite(x)) return '—';
  return x.toLocaleString('fr-FR', { maximumFractionDigits: digits == null ? 1 : digits });
}
function dateFmt(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleDateString('fr-FR'); }
  catch (e) { return String(value); }
}
function profile() {
  return (global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile) || {};
}
function supervisor() {
  return ['Branch Manager','Assistant Branch Manager','Head of Field','Procurement Officer',
    'Supervisor','Zonal Head','Unit Head','Administrateur'].indexOf(String(profile().role || '')) >= 0;
}
function refresh() {
  var st = FR.state || {};
  if (global.ANAGROCI_FB && typeof global.ANAGROCI_FB.refreshFarmerPassport === 'function') {
    return global.ANAGROCI_FB.refreshFarmerPassport(st.producerId, st.tab);
  }
  if (global.ANAGROCI_FB && typeof global.ANAGROCI_FB.reload === 'function') {
    return global.ANAGROCI_FB.reload();
  }
  return Promise.resolve();
}
function sync(ctx) {
  ctx = ctx || {};
  var f = ctx.summary || {};
  var p = ctx.data || {};
  var st = FR.state = FR.state || {};
  st.producerId = ctx.pid || f.producteur_id || null;
  st.tab = ctx.tab || st.tab || 'overview';
  st.loading = false;
  st.error = null;
  st.summary = Object.assign({}, f, { producteur_id: st.producerId });
  st.producer = {
    id: st.producerId,
    code: f.farmer_id || null,
    nom: f.nom || null,
    prenoms: f.prenoms || null,
    telephone: f.telephone || null,
    villageId: f.village_id || null,
    villageNom: f.village_nom || null
  };
  st.data = {
    plots: p.plots || [],
    production: p.baselines || p.production || [],
    sustainability: p.sustainability || [],
    consents: p.consents || [],
    visits: p.visits || [],
    inspections: p.inspections || [],
    actions: p.actions || [],
    catalog: p.catalog || []
  };
  return st;
}

/* farmer-registry-operations.js exige passportUI comme contrat d'adaptation.
   Ici il pointe vers le Farmer Passport du nouveau shell, pas vers l'ancien overlay. */
FR.passportUI = {
  version: 'field-buying-bridge-1.0.0',
  refresh: refresh,
  supervisor: supervisor,
  escape: esc,
  format: fmt,
  dateFmt: dateFmt
};

global.ANAGROCI_FARMER_EDIT_BRIDGE = {
  sync: sync,
  refresh: refresh,
  supervisor: supervisor
};

})(window);

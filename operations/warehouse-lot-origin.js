/* WAREHOUSE · Origine d'un LOT (canal AFLP, coopérative, producteurs, villages).
   Panneau en lecture seule ajouté à la fiche LOT (#lots/<id>) à partir de la vue
   aflp_lot_origin_v : aucune ressaisie, la réception et la qualité restent celles du WMS. */
(function (g) {
'use strict';
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
var sb = null, busy = false, last = '';
function client() { if (sb) return Promise.resolve(sb); return new Promise(function (res) { var k = 0, t = setInterval(function () { k++; if (g.supabase && g.ANAGROCI_SUPABASE_URL && g.ANAGROCI_SUPABASE_ANON) { clearInterval(t); sb = g.supabase.createClient(g.ANAGROCI_SUPABASE_URL, g.ANAGROCI_SUPABASE_ANON); res(sb); } else if (k > 120) { clearInterval(t); res(null); } }, 80); }); }
var CH = { COOPERATIVE: 'Coopérative', AFLP_DIRECT: 'AFLP Direct (RT)', MIXTE: 'Mixte (Direct + Coopérative)', LBA: 'LBA', DIRECT: 'Supplier direct', NON_RENSEIGNE: 'Non renseigné' };
var TR = { TRACABLE_PRODUCTEUR: ['Traçable jusqu’au producteur', 'ok'], ALLOCATION_A_COMPLETER: ['Allocation producteurs à compléter', 'warn'], ORGANISATION_SEULEMENT: ['Traçable jusqu’à l’organisation', 'info'] };
function lotId() { var h = (location.hash || '').slice(1).split('/'); return h[0] === 'lots' && h[1] ? decodeURIComponent(h[1]) : ''; }
function inject() {
  var id = lotId(), view = document.getElementById('opsRouteView');
  if (!id || !view || busy || document.getElementById('lotOriginCard')) return;
  if (!view.querySelector('.ops-route-head, .ops-pagehead, h1')) return;
  busy = true; last = id;
  client().then(function (c) { return c ? c.from('aflp_lot_origin_v').select('*').eq('lot_id', id).limit(1) : { data: [] }; }).then(function (r) {
    busy = false;
    var o = (r && r.data && r.data[0]); if (!o || lotId() !== id || document.getElementById('lotOriginCard')) return;
    var t = TR[o.traceability_level] || [o.traceability_level, 'info'];
    var sec = document.createElement('section'); sec.className = 'card'; sec.id = 'lotOriginCard';
    sec.innerHTML = '<div class="card-head"><div><h2>Origine du LOT</h2><p>Canal d’approvisionnement et provenance producteurs (Traceability 360).</p></div>' +
      '<div class="ops-route-actions"><a class="btn secondary" href="traceability.html#q=' + encodeURIComponent(o.lot_id) + '">Traceability 360 →</a></div></div>' +
      '<div class="ops-def-grid"><div><small>Canal d’origine</small><b>' + esc(CH[o.origin_channel] || o.origin_channel) + '</b></div>' +
      '<div><small>Coopérative(s)</small><b>' + esc(o.cooperative_codes || '—') + '</b></div><div><small>Producteurs</small><b>' + esc(o.farmers || 0) + '</b></div>' +
      '<div><small>Villages</small><b>' + esc(o.villages || 0) + '</b></div><div><small>Traçabilité</small><b><span class="badge ' + t[1] + '">' + esc(t[0]) + '</span></b></div></div>';
    var head = view.querySelector('.ops-route-head, .ops-pagehead'); if (head && head.nextSibling) head.parentNode.insertBefore(sec, head.nextSibling); else view.appendChild(sec);
  }).catch(function () { busy = false; });
}
function start() {
  var view = document.getElementById('opsRouteView'); if (!view) return;
  new MutationObserver(function () { if (lotId()) inject(); }).observe(view, { childList: true, subtree: false });
  g.addEventListener('hashchange', function () { setTimeout(inject, 400); });
  setTimeout(inject, 800);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);

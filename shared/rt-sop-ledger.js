/* FBMS AFLP RT SOP 2027 - deterministic read-only accounting helpers.
 * Does not create financial transactions or validate purchases.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ANAGROCI_RT_SOP = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';
  function amount(v) { var n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; }
  function status(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase(); }
  function purchaseState(p) {
    if (!p || p.rejet === true || /^(REJETE|ANNULE|VOID)$/.test(status(p.statut_validation))) return 'REJECTED';
    var s = status(p.statut_validation);
    if (p.validated_by && p.validated_at && status(p.validated_by_role) === 'UNIT HEAD' && /^(VALIDE|VALIDEE|APPROUVE|APPROUVEE|ACCEPTE|ACCEPTEE|CONFIRME|CONFIRMEE)$/.test(s)) return 'VALIDATED';
    return 'PENDING';
  }
  function fundingConfirmed(a) {
    return !!(a && a.wave_transaction_ref && a.finance_confirmed_at && a.finance_confirmed_by && a.rt_ack_at && a.rt_ack_document_ref && !/ANNULE/.test(status(a.statut)));
  }
  function summarizeCash(advances, purchases, refunds) {
    var out = { advancesRecorded: 0, advancesConfirmed: 0, advancesUnverified: 0,
      purchasesRecorded: 0, purchasesValidated: 0, purchasesPending: 0,
      refundsConfirmed: 0, refundsPending: 0, remainingToJustify: null, provisionalRemaining: null };
    (advances || []).forEach(function (a) {
      if (!a || /ANNULE/.test(status(a.statut))) return;
      var v = amount(a.montant);
      out.advancesRecorded += v;
      if (fundingConfirmed(a)) out.advancesConfirmed += v;
      else out.advancesUnverified += v;
    });
    (purchases || []).forEach(function (p) {
      var state = purchaseState(p);
      if (state === 'REJECTED') return;
      var v = amount(p.montant);
      out.purchasesRecorded += v;
      if (state === 'VALIDATED') out.purchasesValidated += v;
      else out.purchasesPending += v;
    });
    (refunds || []).forEach(function (r) {
      var v = amount(r.montant);
      if (r && r.confirmed_at && r.document_ref) out.refundsConfirmed += v;
      else out.refundsPending += v;
    });
    out.provisionalRemaining = out.advancesRecorded - out.purchasesRecorded - out.refundsConfirmed;
    if (out.advancesUnverified === 0) {
      out.remainingToJustify = out.advancesConfirmed - out.purchasesValidated - out.refundsConfirmed;
    }
    return out;
  }
  function rcnStock(purchasedKg, releasedBevKg, receivedGrnKg) {
    var purchased = amount(purchasedKg), bev = amount(releasedBevKg);
    return { rtKg: purchased - bev, inTransitKg: bev,
      bevVsGrnKg: receivedGrnKg == null ? null : bev - amount(receivedGrnKg) };
  }
  function juteBalance(receivedBags, usedBags, dispatchedFullBags) {
    var r = amount(receivedBags), u = amount(usedBags), d = amount(dispatchedFullBags);
    return { emptyBags: r - u, fullAtRtBags: u - d, underRtResponsibilityBags: r - d };
  }
  return { purchaseState: purchaseState, fundingConfirmed: fundingConfirmed,
    summarizeCash: summarizeCash, rcnStock: rcnStock, juteBalance: juteBalance };
});

/* FIELD BUYING - compatibilite sexe Producteur.
   UI canonique: Homme/Femme. Stockage canonique: M/F.
   Supporte aussi les anciennes variantes (Homme/Femme, Masculin/Feminin, Male/Female).
*/
(function (global) {
'use strict';
if (global.ANAGROCI_FB_SEX_COMPAT) return;

function clean(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}
function normalizeDbSex(v) {
  var x = clean(v);
  if (x === 'M' || x === 'HOMME' || x === 'MASCULIN' || x === 'MALE') return 'M';
  if (x === 'F' || x === 'FEMME' || x === 'FEMININ' || x === 'FEMALE') return 'F';
  return '';
}
function normalizeUiSex(v) {
  var x = normalizeDbSex(v);
  return x === 'M' ? 'Homme' : x === 'F' ? 'Femme' : '';
}
function ensureAlias(select, value, label) {
  if ([].slice.call(select.options || []).some(function (o) { return o.value === value; })) return;
  var o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  o.hidden = true;
  select.appendChild(o);
}
function prepareSexSelect(select) {
  if (!select || select.dataset.sexCompat === '1') return;
  [].slice.call(select.options || []).forEach(function (o) {
    if (clean(o.textContent) === 'HOMME') o.value = 'M';
    if (clean(o.textContent) === 'FEMME') o.value = 'F';
  });
  ensureAlias(select, 'Homme', 'Homme');
  ensureAlias(select, 'Femme', 'Femme');
  ensureAlias(select, 'Masculin', 'Homme');
  ensureAlias(select, 'Féminin', 'Femme');
  ensureAlias(select, 'Male', 'Homme');
  ensureAlias(select, 'Female', 'Femme');
  select.dataset.sexCompat = '1';
}
function normalizeBeforeSubmit(form) {
  var select = form && form.querySelector ? form.querySelector('#ff_sexe') : null;
  if (!select) return;
  var canonical = normalizeDbSex(select.value);
  if (canonical) select.value = canonical;
}
function prepare(root) {
  if (!root || !root.querySelectorAll) return;
  var one = root.id === 'ff_sexe' ? root : null;
  if (one) prepareSexSelect(one);
  root.querySelectorAll('#ff_sexe').forEach(prepareSexSelect);
  var form = root.id === 'farmerForm' ? root : (root.closest && root.closest('#farmerForm'));
  if (form && form.dataset.sexSubmitCompat !== '1') {
    form.addEventListener('submit', function () { normalizeBeforeSubmit(form); }, true);
    form.dataset.sexSubmitCompat = '1';
  }
}

if (typeof document !== 'undefined') {
  prepare(document);
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        [].slice.call(m.addedNodes || []).forEach(function (n) {
          if (n && n.nodeType === 1) prepare(n);
        });
      });
    }).observe(document.documentElement || document.body, { childList: true, subtree: true });
  }
}

global.ANAGROCI_FB_SEX_COMPAT = {
  normalizeDbSex: normalizeDbSex,
  normalizeUiSex: normalizeUiSex,
  prepareSexSelect: prepareSexSelect,
  normalizeBeforeSubmit: normalizeBeforeSubmit
};
})(window);

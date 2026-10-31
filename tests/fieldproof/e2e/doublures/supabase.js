/* Doublure de @supabase/supabase-js : table « villages » FICTIVE, lecture seule.
   Toute tentative d'écriture est comptée dans window.__FP_ECRITURES_SUPABASE
   (la recette exige qu'elle reste à 0 : aucun envoi serveur). */
(function () {
  'use strict';
  window.__FP_ECRITURES_SUPABASE = 0; window.__FP_LECTURES_SUPABASE = [];
  var VILLAGES = [
    { id: 'v-fictif-1', village: 'Village Fictif Alpha', cluster: 'Botro', s1: {} },
    { id: 'v-fictif-2', village: 'Village Fictif Beta', cluster: 'Botro', s1: {} },
    { id: 'v-fictif-3', village: 'Village Fictif Gamma', cluster: 'Diabo', s1: {} }
  ];
  function req(table) {
    var c = {
      select: function () { window.__FP_LECTURES_SUPABASE.push(table); return c; },
      eq: function () { return c; }, order: function () { return c; },
      insert: function () { window.__FP_ECRITURES_SUPABASE++; return c; }, update: function () { window.__FP_ECRITURES_SUPABASE++; return c; },
      upsert: function () { window.__FP_ECRITURES_SUPABASE++; return c; }, delete: function () { window.__FP_ECRITURES_SUPABASE++; return c; },
      then: function (ok, ko) { return Promise.resolve({ data: table === 'villages' ? VILLAGES : [], error: null }).then(ok, ko); }
    };
    return c;
  }
  window.supabase = { createClient: function () { return { from: req, auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); } }, storage: { from: function () { window.__FP_ECRITURES_SUPABASE++; return {}; } } }; } };
})();

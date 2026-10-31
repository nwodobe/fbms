/* Doublure de @supabase/supabase-js : table « villages » FICTIVE, lecture seule.
   Toute tentative d'écriture est comptée dans window.__FP_ECRITURES_SUPABASE
   (la recette exige qu'elle reste à 0 : aucun envoi serveur). */
(function () {
  'use strict';
  window.__FP_ECRITURES_SUPABASE = 0; window.__FP_LECTURES_SUPABASE = [];
  var VILLAGES = [
    /* Coordonnées FICTIVES rondes (aucune parcelle réelle). Beta est à ~6,7 km au nord d'Alpha. */
    { id: 'v-fictif-1', village: 'Village Fictif Alpha', cluster: 'Botro', gps_lat: 7.5, gps_lng: -5.0, s1: { sousPrefecture: 'S/P Fictive Une', departement: 'Dept Fictif' } },
    { id: 'v-fictif-2', village: 'Village Fictif Beta', cluster: 'Botro', gps_lat: null, gps_lng: null, s1: { gpsLat: '7.56', gpsLng: '-5.0', sousPrefecture: 'S/P Fictive Deux' } },
    { id: 'v-fictif-3', village: 'Village Fictif Gamma', cluster: 'Diabo', gps_lat: 7.6, gps_lng: -5.2, s1: {} }
  ];
  var HUBS = [{ id_hub: 'h-fictif-1', nom: 'Botro', localite: 'Localité Hub Fictive', departement: 'Dept Fictif', gps_lat: 7.70, gps_lng: -5.0 }];
  function req(table) {
    var c = {
      select: function () { window.__FP_LECTURES_SUPABASE.push(table); return c; },
      eq: function () { return c; }, order: function () { return c; },
      insert: function () { window.__FP_ECRITURES_SUPABASE++; return c; }, update: function () { window.__FP_ECRITURES_SUPABASE++; return c; },
      upsert: function () { window.__FP_ECRITURES_SUPABASE++; return c; }, delete: function () { window.__FP_ECRITURES_SUPABASE++; return c; },
      then: function (ok, ko) { return Promise.resolve({ data: table === 'villages' ? VILLAGES : table === 'hubs_clusters' ? HUBS : [], error: null }).then(ok, ko); }
    };
    return c;
  }
  window.supabase = { createClient: function () { return { from: req, auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); } }, storage: { from: function () { window.__FP_ECRITURES_SUPABASE++; return {}; } } }; } };
})();

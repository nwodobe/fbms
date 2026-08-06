/**
 * Doublure déterministe de @supabase/supabase-js pour les contrôles de pages.
 *
 * Les pages de FBMS chargent le SDK Supabase depuis un CDN tiers. Deux raisons
 * de ne pas dépendre de ce CDN dans une porte de fusion : sa disponibilité ne
 * nous appartient pas, et l'environnement d'intégration peut n'avoir aucun
 * accès sortant. Sans doublure, chaque page lèverait « createClient is
 * undefined » — une erreur induite par le harnais, qui masquerait les vraies.
 *
 * Cette doublure répond ce que répond Supabase à un visiteur SANS session :
 * c'est exactement l'état que les contrôles observent, puisqu'ils n'ouvrent
 * aucune session.
 */
(function () {
  'use strict';
  function reponseVide() { return Promise.resolve({ data: null, error: null }); }
  function listeVide() { return Promise.resolve({ data: [], error: null }); }

  function requete() {
    var chainable = {
      select: function () { return chainable; },
      insert: function () { return chainable; },
      update: function () { return chainable; },
      upsert: function () { return chainable; },
      delete: function () { return chainable; },
      eq: function () { return chainable; },
      neq: function () { return chainable; },
      in: function () { return chainable; },
      gte: function () { return chainable; },
      lte: function () { return chainable; },
      order: function () { return chainable; },
      limit: function () { return chainable; },
      range: function () { return chainable; },
      single: reponseVide,
      maybeSingle: reponseVide,
      then: function (resoudre) { return listeVide().then(resoudre); }
    };
    return chainable;
  }

  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
          getUser: function () { return Promise.resolve({ data: { user: null }, error: null }); },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signInWithPassword: function () {
            return Promise.resolve({ data: null, error: { message: 'doublure de contrôle : aucune connexion' } });
          },
          signOut: reponseVide
        },
        from: requete,
        rpc: reponseVide,
        storage: { from: function () { return { list: listeVide, download: reponseVide, upload: reponseVide }; } },
        channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
        removeChannel: function () {}
      };
    }
  };
})();

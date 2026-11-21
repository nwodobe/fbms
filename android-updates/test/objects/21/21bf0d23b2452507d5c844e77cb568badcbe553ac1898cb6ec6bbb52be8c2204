/* SUIVI DES MISES À JOUR DES TÉLÉPHONES (AFLP 2027)
   --------------------------------------------------------------------------------
   Deux rôles, dans un seul fichier Web (donc diffusable par mise à jour signée, sans nouvel APK) :

   1. SIGNALEMENT (dans l'APK uniquement) : le téléphone lit l'état réel de son mécanisme de mise à jour
      (pont natif AnagrociNative.appInfo / updateStatus, en lecture seule) et le transmet au serveur par la
      RPC ota_installation_signaler. Rien n'est déduit : ce qui n'est pas lu n'est pas envoyé.
        · identifiant d'installation : un UUID tiré au hasard et gardé dans l'application. Ce n'est NI l'IMEI,
          NI le numéro de série, NI l'identifiant publicitaire, NI l'identifiant Android ;
        · aucune position, aucun contact, aucun nom de modèle, aucune donnée métier ;
        · le compte et le cluster sont ceux de la session, relus côté serveur (jamais crus sur parole).
      Si la RPC n'existe pas encore (migration non appliquée), le signalement s'arrête sans bruit.

   2. TABLEAU DU BRANCH MANAGER (#mises-a-jour) : ce que chaque installation a réellement signalé, comparé à la
      version publiée sur le canal. Un téléphone qui ne s'est pas signalé récemment est « Non confirmé récemment »,
      jamais « à jour ». Publier une mise à jour ne prouve pas qu'elle est active sur les téléphones.

   Ce fichier ne déclenche AUCUNE activation : l'activation reste celle du code natif (au démarrage suivant,
   jamais pendant une saisie). Il demande seulement une vérification périodique quand l'application reste ouverte. */
(function (global) {
  'use strict';
  var CLE_ID = 'anagroci_installation_id', CLE_ENVOI = 'anagroci_ota_dernier_signalement', CLE_VU = 'anagroci_ota_derniere_activation_vue';
  var CANAL_URL = 'https://nwodobe.github.io/fbms/android-updates/stable/version.json';
  var FRAIS_H = 72;                              // au-delà, l'installation n'est plus « confirmée récemment »
  var RENVOI_MIN_MS = 12 * 3600 * 1000;          // sans changement, pas plus d'un signalement toutes les 12 h
  var VERIF_MS = 3 * 3600 * 1000;                // application laissée ouverte : vérification toutes les 3 h
  var natif = global.AnagrociNative, sb = null, arret = false;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function json(t) { try { return JSON.parse(t) || {}; } catch (e) { return {}; } }
  function uuid() {
    try { if (global.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function installation() { try { var v = localStorage.getItem(CLE_ID); if (!/^[0-9a-f-]{36}$/.test(v || '')) { v = uuid(); localStorage.setItem(CLE_ID, v); } return v; } catch (e) { return null; } }
  function client() {
    if (sb) return sb;
    if (global.supabase && global.ANAGROCI_SUPABASE_URL && global.ANAGROCI_SUPABASE_ANON) sb = global.supabase.createClient(global.ANAGROCI_SUPABASE_URL, global.ANAGROCI_SUPABASE_ANON);
    return sb;
  }
  function enApk() { return !!(natif && typeof natif.updateStatus === 'function' && typeof natif.appInfo === 'function'); }
  function date(v) { return v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null; }

  /* État lu sur le téléphone. Fonction pure à partir des deux réponses du pont (testée sous Node). */
  function etatLocal(info, up, id) {
    info = info || {}; up = up || {};
    var m = String(info.version || '').match(/^\s*([^\s(]+)\s*\((\d+)\)/), latest = up.latest || {};
    var res = String(up.last_result || ''), erreur = /^(échec|refusée|incompatible)/.test(res) ? res.slice(0, 300) : null;
    var rej = up.rejected || {}, k = Object.keys(rej);
    if (!erreur && k.length) erreur = ('version ' + k[k.length - 1] + ' refusée : ' + rej[k[k.length - 1]]).slice(0, 300);
    return {
      installation_id: id, app_id: info.package || null,
      native_version_name: m ? m[1] : null, native_version_code: m ? Number(m[2]) : null,
      android_release: info.android_release != null ? String(info.android_release).slice(0, 20) : null,
      updates_enabled: up.enabled === true, channel: up.channel || null,
      web_active_sequence: Number(up.active_sequence) || null, web_active_version: up.active_web_version || null,
      web_active_origin: up.active === 'mise à jour signée' ? 'OTA' : 'APK',
      ota_latest_sequence: Number(latest.sequence) || null, ota_latest_version: latest.web_version || null,
      ota_pending_sequence: Number(up.pending_sequence) || null, deferred_reason: up.deferred_reason ? String(up.deferred_reason).slice(0, 300) : null,
      phase: up.phase || null, last_check_at: date(up.last_check_at), last_activation_at: date(up.last_success_at),
      last_error: erreur, queue_open: typeof up.queue_open === 'number' && up.queue_open >= 0 ? up.queue_open : null
    };
  }
  function signaler(force) {
    if (arret || !enApk() || global.navigator.onLine === false || !global.ANAGROCI_AUTH) return Promise.resolve(null);
    var id = installation(), c = client(); if (!id || !c) return Promise.resolve(null);
    var e = etatLocal(json(natif.appInfo()), json(natif.updateStatus()), id), empreinte = JSON.stringify(e), memo = {};
    try { memo = JSON.parse(localStorage.getItem(CLE_ENVOI) || '{}'); } catch (x) {}
    if (!force && memo.e === empreinte && Date.now() - (memo.t || 0) < RENVOI_MIN_MS) return Promise.resolve(null);
    return c.rpc('ota_installation_signaler', { p: e }).then(function (r) {
      if (r && r.error) {
        /* Fonction absente (migration non appliquée) ou refus de droits : on n'insiste pas pendant cette session. */
        if (/PGRST202|42883|404|does not exist|Could not find/i.test((r.error.code || '') + ' ' + (r.error.message || ''))) arret = true;
        return null;
      }
      try { localStorage.setItem(CLE_ENVOI, JSON.stringify({ e: empreinte, t: Date.now() })); } catch (x) {}
      return e;
    }).catch(function () { return null; });
  }
  /* Message discret, une seule fois par version réellement activée (confirmée par le code natif). */
  function annoncerActivation() {
    if (!enApk()) return;
    var up = json(natif.updateStatus());
    if (up.active !== 'mise à jour signée' || !up.last_success_at || up.awaiting_confirm) return;
    var cle = String(up.active_sequence);
    try { if (localStorage.getItem(CLE_VU) === cle) return; localStorage.setItem(CLE_VU, cle); } catch (e) { return; }
    var t = document.createElement('div');
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(64px + env(safe-area-inset-bottom,0px));z-index:2147483000;background:#053B23;color:#fff;font:600 14px/1.3 system-ui,sans-serif;padding:10px 16px;border-radius:22px;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:86vw;text-align:center;pointer-events:none';
    t.textContent = 'FBMS est à jour';
    document.documentElement.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5000);
  }
  /* Application laissée ouverte : on demande au code natif de vérifier. Il télécharge et vérifie en arrière-plan ;
     il n'active rien avant le prochain démarrage. Jamais pendant qu'un formulaire ou la carte est ouvert. */
  function saisieEnCours() { return !!document.querySelector('#frSubDialog, .pc-editeur, .fb-modal-open, dialog[open]'); }
  function verifier() {
    if (!enApk() || typeof natif.checkUpdate !== 'function' || global.navigator.onLine === false || document.hidden || saisieEnCours()) return;
    try { natif.checkUpdate(); } catch (e) {}
    setTimeout(function () { signaler(false); }, 90000);
  }
  if (enApk()) {
    document.addEventListener('anagroci:authenticated', function () { setTimeout(function () { annoncerActivation(); signaler(false); }, 8000); });
    if (global.ANAGROCI_AUTH) setTimeout(function () { annoncerActivation(); signaler(false); }, 8000);
    global.addEventListener('online', function () { setTimeout(function () { signaler(false); }, 45000); });
    setInterval(verifier, VERIF_MS);
  }

  /* ------------------------------------------------------------------ tableau du Branch Manager */
  var LIB = { A_JOUR: 'À jour', EN_ATTENTE: 'En attente', ERREUR: 'Erreur', INCOMPATIBLE: 'Incompatible', NON_CONFIRME: 'Non confirmé récemment' };
  var COULEUR = { A_JOUR: 'ok', EN_ATTENTE: 'warn', ERREUR: 'danger', INCOMPATIBLE: 'danger', NON_CONFIRME: 'neutral' };
  /* État d'une installation, d'après ce qu'ELLE a signalé et la version publiée. Fonction pure (testée sous Node).
     Ordre : un silence prolongé l'emporte sur tout (on ne sait plus) ; puis l'incompatibilité ; puis l'erreur. */
  function classer(i, publie, maintenant) {
    var vu = Date.parse(i.last_seen_at || ''), t = maintenant || Date.now();
    if (!isFinite(vu) || t - vu > FRAIS_H * 3600 * 1000) return 'NON_CONFIRME';
    var min = publie && Number(publie.min_native_version_code) || 0;
    if (i.phase === 'nouvel_apk' || i.updates_enabled === false || (min && i.native_version_code != null && Number(i.native_version_code) < min)) return 'INCOMPATIBLE';
    if (publie && publie.sequence && Number(i.web_active_sequence) >= Number(publie.sequence)) return 'A_JOUR';
    if (i.phase === 'erreur' || i.last_error) return 'ERREUR';
    if (!publie || !publie.sequence) return i.phase === 'a_jour' ? 'A_JOUR' : 'EN_ATTENTE';
    return 'EN_ATTENTE';
  }
  function quand(v) { if (!v) return '—'; try { var d = new Date(v); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); } catch (e) { return v; } }
  function racine() { return document.getElementById('opsRouteView'); }
  function tete(sous, actions) { return '<div class="ops-route-head"><div><h1>Mises à jour des téléphones</h1><p>' + esc(sous || '') + '</p></div><div class="ops-route-actions">' + (actions || '') + '</div></div>'; }
  function estPilote() { var r = global.ANAGROCI_AUTH && global.ANAGROCI_AUTH.profile && global.ANAGROCI_AUTH.profile.role; return ['Branch Manager', 'Branch Manager / Head of Programme', 'Assistant Branch Manager'].indexOf(r) >= 0; }
  function csv(lignes) {
    var col = [['etat', 'État'], ['installation', 'Installation'], ['cluster', 'Cluster'], ['compte', 'Dernier compte'], ['natif', 'Version Android (APK)'], ['web', 'Version Web active'], ['origine', 'Origine'], ['dispo', 'Version OTA vue par le téléphone'], ['verif', 'Dernière vérification'], ['activation', 'Dernière activation réussie'], ['vu', 'Dernier signalement'], ['erreur', 'Dernière erreur']];
    function c(v) { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    return '﻿' + [col.map(function (x) { return c(x[1]); }).join(';')].concat(lignes.map(function (l) { return col.map(function (x) { return c(l[x[0]]); }).join(';'); })).join('\n');
  }
  var derniereVue = [];
  function render() {
    var r = racine(); if (!r) return Promise.resolve();
    if (!estPilote()) { r.innerHTML = tete('') + '<div class="notice warn">Réservé au Branch Manager et à son assistant.</div>'; return Promise.resolve(); }
    r.innerHTML = tete('Lecture en cours…') + '<div class="ops-empty">Chargement…</div>';
    var c = client(); if (!c) { r.innerHTML = tete('') + '<div class="notice danger">Connexion aux données indisponible.</div>'; return Promise.resolve(); }
    var publie = fetch(CANAL_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; });
    var liste = c.from('ota_installations_v').select('*').order('last_seen_at', { ascending: false }).limit(1000).then(function (x) { return x; });
    return Promise.all([publie, liste]).then(function (z) {
      var pub = z[0], rep = z[1];
      if (rep.error) {
        var absent = /PGRST205|42P01|does not exist|Could not find/i.test((rep.error.code || '') + ' ' + (rep.error.message || ''));
        r.innerHTML = tete('') + '<div class="notice ' + (absent ? 'warn' : 'danger') + '">' + (absent
          ? '<b>Suivi non activé.</b> La table de suivi n\'existe pas encore sur le serveur : la migration <span class="mono">20261122090000_ota_suivi_installations</span> attend l\'autorisation du Branch Manager. Aucun téléphone n\'est donc confirmé à ce jour.'
          : 'Lecture impossible : ' + esc(rep.error.message)) + '</div>';
        return;
      }
      var maintenant = Date.now(), lignes = (rep.data || []).map(function (i) {
        var e = classer(i, pub, maintenant);
        return { code: e, etat: LIB[e], installation: String(i.installation_id || '').slice(0, 8), cluster: i.cluster || '—', compte: i.compte_nom || '—',
          natif: (i.native_version_name || '?') + (i.native_version_code != null ? ' (' + i.native_version_code + ')' : ''), web: i.web_active_version || (i.web_active_sequence || '—'), origine: i.web_active_origin === 'OTA' ? 'Mise à jour signée' : 'Intégrée à l\'APK',
          dispo: i.ota_latest_version || '—', verif: quand(i.last_check_at), activation: quand(i.last_activation_at), vu: quand(i.last_seen_at), erreur: i.last_error || (i.deferred_reason ? 'Activation différée : ' + i.deferred_reason : '') };
      });
      derniereVue = lignes;
      var n = { A_JOUR: 0, EN_ATTENTE: 0, ERREUR: 0, INCOMPATIBLE: 0, NON_CONFIRME: 0 }; lignes.forEach(function (l) { n[l.code]++; });
      var confirmes = lignes.length - n.NON_CONFIRME, taux = lignes.length ? Math.round(1000 * n.A_JOUR / lignes.length) / 10 : null;
      function k(lib, val, note) { return '<div class="kpi"><span>' + esc(lib) + '</span><b>' + esc(val) + '</b>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>'; }
      var h = tete(pub && pub.sequence ? 'Version publiée sur le canal stable : ' + (pub.web_version || pub.sequence) + ' · le ' + quand(pub.published_at) + ' · APK minimum : versionCode ' + (pub.min_native_version_code || '?') : 'Version publiée illisible pour l\'instant : les états ci-dessous reposent sur le seul signalement des téléphones.',
        '<button type="button" class="btn secondary" data-ota="rafraichir">Actualiser</button><button type="button" class="btn secondary" data-ota="csv"' + (lignes.length ? '' : ' disabled') + '>Export CSV</button>') +
        '<div class="notice info"><b>Lecture honnête :</b> une mise à jour publiée n\'est pas une mise à jour installée. Seules les installations qui se sont signalées depuis moins de ' + FRAIS_H + ' h comptent comme confirmées. Un téléphone éteint, hors réseau ou jamais ouvert depuis la publication reste « Non confirmé récemment ». Les téléphones qui n\'ont jamais ouvert une version contenant ce suivi n\'apparaissent pas du tout.</div>' +
        '<div class="kpi-grid">' + k('Installations connues', lignes.length, confirmes + ' signalée(s) depuis moins de ' + FRAIS_H + ' h') + k('À jour (confirmé)', n.A_JOUR, taux == null ? '' : String(taux).replace('.', ',') + ' % des installations connues') +
        k('En attente', n.EN_ATTENTE) + k('Erreur', n.ERREUR) + k('Incompatible (nouvel APK)', n.INCOMPATIBLE) + k('Non confirmé récemment', n.NON_CONFIRME) + '</div>' +
        (lignes.length ? '<div class="table-wrap"><table><thead><tr><th>État</th><th>Installation</th><th>Cluster</th><th>Dernier compte</th><th>Android (APK)</th><th>Web active</th><th>OTA vue</th><th>Dernière vérification</th><th>Dernière activation</th><th>Dernier signalement</th><th>Dernière erreur</th></tr></thead><tbody>' +
          lignes.map(function (l) { return '<tr><td><span class="badge ' + COULEUR[l.code] + '">' + esc(l.etat) + '</span></td><td class="mono">' + esc(l.installation) + '</td><td>' + esc(l.cluster) + '</td><td>' + esc(l.compte) + '</td><td>' + esc(l.natif) + '</td><td>' + esc(l.web) + '<br><small>' + esc(l.origine) + '</small></td><td>' + esc(l.dispo) + '</td><td>' + esc(l.verif) + '</td><td>' + esc(l.activation) + '</td><td>' + esc(l.vu) + '</td><td>' + esc(l.erreur) + '</td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="ops-empty">Aucune installation ne s\'est encore signalée. Aucun téléphone n\'est donc confirmé à jour.</div>') +
        '<p class="ops-note" style="font-size:13px;color:#5E5C5C">Identifiant d\'installation : numéro tiré au hasard par l\'application, sans lien avec le matériel du téléphone. Aucune position ni donnée personnelle n\'est collectée par ce suivi.</p>';
      r.innerHTML = h;
    });
  }
  if (typeof document !== 'undefined') document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-ota]') : null; if (!b) return;
    if (b.getAttribute('data-ota') === 'rafraichir') render();
    else if (b.getAttribute('data-ota') === 'csv' && derniereVue.length) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(derniereVue)], { type: 'text/csv;charset=utf-8' })); a.download = 'FBMS_Suivi_mises_a_jour_' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
  });
  var api = { render: render, signaler: signaler, etatLocal: etatLocal, classer: classer, LIBELLES: LIB, FRAIS_H: FRAIS_H };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.ANAGROCI_OTA_SUIVI = api;
})(typeof window !== 'undefined' ? window : globalThis);

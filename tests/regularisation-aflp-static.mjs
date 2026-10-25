#!/usr/bin/env node
/**
 * Régularisation AFLP 25/10/2026 — contrôles statiques de non-régression.
 * Chaque assertion correspond à une anomalie reproduite avant correctif (voir
 * docs/regularisation_aflp_20261025/01_rapport_diagnostic_et_resultats.md).
 * Aucune donnée réelle.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const fb = readFileSync('operations/field-buying.js', 'utf8');
const sw = readFileSync('sw.js', 'utf8');
const ops = readFileSync('shared/farmer-registry-operations.js', 'utf8');
const pass = readFileSync('shared/farmer-registry-passport.js', 'utf8');

// A-BUG-1 : 'DEFERRED' n'est pas une valeur autorisée de farmer_plots.gps_status (test SQL T1).
assert.ok(!/gps_status:\s*[^,]*'DEFERRED'/.test(fb), "field-buying ne doit plus écrire gps_status 'DEFERRED'");
assert.ok(/gps_status: hasPoint \? 'POINT_CAPTURED' : 'NOT_MAPPED'/.test(fb), 'parcelle sans précision GPS : NOT_MAPPED');
// A-BUG-2 : la précision GPS était perdue.
assert.ok(/data-gps-acc/.test(fb) && /gps_accuracy_m: hasPoint \? plotGps\.acc : null/.test(fb), 'précision GPS transmise');
assert.ok(/gps_accuracy_m: gpsMeta\('ff_plot_lat'\)\.acc/.test(fb), 'précision GPS conservée dans la file hors ligne');
// Coordonnées manuelles : jamais perdues, jamais présentées comme point GPS.
assert.ok(/Coordonnées saisies manuellement, sans précision GPS/.test(fb), 'coordonnées manuelles conservées en note');
// Statut de parcelle et surface mesurée visibles (Passport opérations + Passport partagé).
assert.ok(/TT\('À vérifier', 'To verify'\)/.test(fb) && /Superficie GPS vérifiée/.test(fb), 'statut et surface GPS affichés (opérations)');
assert.ok(/À VÉRIFIER/.test(pass) && /GPS vérifiée : /.test(pass), 'statut et surface GPS affichés (passport partagé)');
// C : nouveaux questionnaires sur la version courante.
assert.ok(!/catalog_version:'AFLP-SUST-2026\.1'/.test(ops), 'les nouveaux formulaires ne doivent plus créer de 2026.1');
// D-1 : repli ignoreSearch uniquement après échec réseau.
const cf = sw.slice(sw.indexOf('function cacheFirst'), sw.indexOf("self.addEventListener('fetch'"));
assert.ok(/return caches\.match\(req\)\.then/.test(cf), 'recherche exacte conservée en premier (cache-busting en ligne)');
assert.ok(/if \(resp\) return resp;\s*[\s\S]*caches\.match\(req, \{ ignoreSearch: true \}\)/.test(cf), 'repli sans paramètre après échec réseau');

console.log('Régularisation AFLP static: PASS (8 contrôles)');

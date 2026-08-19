#!/usr/bin/env node
/**
 * Non-régression P0 — échappement et absence de gestionnaires en ligne
 * (module Sacherie AFLP).
 *
 * Le défaut corrigé : `esc()` échappait `& < > "` mais pas l'apostrophe, alors
 * que des noms de clusters et de RT étaient injectés dans des attributs
 * `onclick` délimités par des apostrophes :
 *
 *     onclick="…openCluster('CLUSTER')"
 *
 * Un cluster nommé `N'DA` cassait la navigation ; une valeur fabriquée
 * exécutait du code. Les noms ivoiriens comportant une apostrophe sont
 * fréquents : ce n'était pas un cas théorique.
 *
 * Ce contrôle vérifie DEUX choses, parce qu'une seule ne suffit pas :
 *
 *   1. les fonctions d'échappement traitent bien l'apostrophe ;
 *   2. plus aucun gestionnaire en ligne (`onclick=`, `onchange=`…) construit
 *      par concaténation n'existe dans les fichiers du module.
 *
 * Le point 2 est le seul qui protège réellement : dans un attribut `onclick`,
 * le parseur HTML décode `&#39;` AVANT que le JavaScript ne soit compilé, donc
 * échapper l'apostrophe ne rend pas un gestionnaire en ligne sûr.
 *
 * Contrairement à `parcours-pratiques.mjs`, qui constate, ce script JUGE :
 * il sort en 1 si la régression revient. C'est un test de non-régression.
 *
 * Usage : node .github/agent-tests/sacherie-securite-echappement.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const FICHIERS = [
  'shared/anagroci-sacherie-control-tower.js',
  'shared/anagroci-sacherie-control-actions.js',
  'shared/anagroci-sacherie-v2.js',
  'terrain/sacherie_v2.html'
]

const resultats = []
const constat = (statut, quoi, preuve) => resultats.push({ statut, quoi, preuve })

/* ------------------------------------------------------------------ 1. Échappement
   On extrait la fonction d'échappement de chaque fichier et on l'exécute
   réellement. Lire le code ne suffit pas : c'est le comportement qui compte. */
/* Le nom et la forme de la fonction ont changé entre la découverte du défaut
   et sa correction : `escapeHtml()` avec une table `ENTITIES` séparée d'un
   côté, `esc()` avec sa table en ligne de l'autre. Figer l'un des deux ferait
   échouer ce contrôle sur un code pourtant sain — un test qui crie au loup
   finit ignoré. On extrait donc par appariement d'accolades, quel que soit le
   nom retenu, et c'est toujours le COMPORTEMENT qui est jugé ensuite. */
const NOMS_ADMIS = ['escapeHtml', 'esc']

function extraireEchappement (source) {
  for (const nom of NOMS_ADMIS) {
    const debut = source.search(new RegExp(`function\\s+${nom}\\s*\\(`))
    if (debut < 0) continue

    let i = source.indexOf('{', debut)
    if (i < 0) continue
    let profondeur = 0
    for (; i < source.length; i++) {
      if (source[i] === '{') profondeur++
      else if (source[i] === '}' && --profondeur === 0) { i++; break }
    }
    if (profondeur !== 0) continue

    const table = source.match(/var ENTITIES = \{[^}]*\};/)
    return { nom, code: `${table ? table[0] + '\n' : ''}${source.slice(debut, i)}` }
  }
  return null
}

for (const rel of FICHIERS.filter((f) => f.endsWith('.js'))) {
  const source = readFileSync(join(RACINE, rel), 'utf8')

  const extrait = extraireEchappement(source)

  if (!extrait) {
    constat('defaut', `${rel} — fonction d'échappement introuvable`,
      `Le module doit exposer une fonction unique et analysable parmi : ${NOMS_ADMIS.join(', ')}.`)
    continue
  }

  const bac = { resultat: null }
  vm.createContext(bac)
  vm.runInContext(`${extrait.code}\nresultat = ${extrait.nom};`, bac)
  const escapeHtml = bac.resultat

  const cas = [
    ["N'DA", '&#39;', 'apostrophe (le défaut P0)'],
    ['a"b', '&quot;', 'guillemet droit'],
    ['<script>', '&lt;', 'chevron ouvrant'],
    ['a&b', '&amp;', 'esperluette'],
    ['a`b', '&#96;', 'rétro-accent']
  ]
  for (const [entree, attendu, quoi] of cas) {
    const sortie = escapeHtml(entree)
    if (sortie.includes(attendu)) {
      constat('ok', `${rel} — échappe ${quoi}`, `escapeHtml(${JSON.stringify(entree)}) = ${JSON.stringify(sortie)}`)
    } else {
      constat('defaut', `${rel} — n'échappe PAS ${quoi}`,
        `escapeHtml(${JSON.stringify(entree)}) = ${JSON.stringify(sortie)}, attendu contenant ${attendu}`)
    }
  }

  /* La valeur échappée ne doit plus pouvoir fermer une chaîne JavaScript. */
  const charge = "x'); window.__pwned = 1; //"
  const echappe = escapeHtml(charge)
  if (echappe.includes("'")) {
    constat('defaut', `${rel} — une charge d'injection conserve son apostrophe`,
      `escapeHtml(${JSON.stringify(charge)}) = ${JSON.stringify(echappe)}`)
  } else {
    constat('ok', `${rel} — la charge d'injection perd son apostrophe`, JSON.stringify(echappe))
  }
}

/* --------------------------------------------- 2. Aucun gestionnaire en ligne
   On cherche `on…="` suivi, dans le même attribut, d'une concaténation. C'est
   la forme exacte du défaut : `onclick="f(\'' + esc(x) + '\')"`. */
const GESTIONNAIRE_CONCAT = /\bon[a-z]+\s*=\s*\\?["'][^"'\n]*'\s*\+/gi
const GESTIONNAIRE_TOUT = /\bon(click|change|input|submit|load|error|focus|blur|keyup|keydown)\s*=\s*\\?["']/gi

for (const rel of FICHIERS) {
  const source = readFileSync(join(RACINE, rel), 'utf8')
  /* Les commentaires décrivent le défaut corrigé : on ne les compte pas. */
  const sansCommentaires = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  const concat = sansCommentaires.match(GESTIONNAIRE_CONCAT) || []
  const tout = sansCommentaires.match(GESTIONNAIRE_TOUT) || []

  if (concat.length) {
    constat('defaut', `${rel} — ${concat.length} gestionnaire(s) en ligne construit(s) par concaténation`,
      concat.slice(0, 3).join(' · '))
  } else if (tout.length) {
    constat('defaut', `${rel} — ${tout.length} gestionnaire(s) en ligne subsistant(s)`,
      tout.slice(0, 3).join(' · '))
  } else {
    constat('ok', `${rel} — aucun gestionnaire en ligne`,
      'le contexte passe par des attributs data-* et des écouteurs délégués')
  }
}

/* ------------------------------- 3. Aucune boîte native pour une décision
   prompt() et confirm() ne montrent pas le contexte de la ligne, ne valident
   rien avant l'envoi et perdent la saisie si l'utilisateur annule. Sur une
   décision à effet comptable, c'est le composant le moins adapté qui existe. */
for (const rel of FICHIERS.filter((f) => f.endsWith('.js'))) {
  const source = readFileSync(join(RACINE, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const boites = source.match(/(^|[^.\w])(prompt|confirm)\s*\(/g) || []
  if (boites.length) {
    constat('defaut', `${rel} — ${boites.length} boîte(s) native(s) prompt()/confirm() pour une saisie`,
      boites.slice(0, 3).map((s) => s.trim()).join(' · '))
  } else {
    constat('ok', `${rel} — aucune boîte native`, 'les décisions passent par le panneau contextualisé')
  }
}

/* ------------------------------------------------------------------- Rapport */
const defauts = resultats.filter((r) => r.statut === 'defaut')
for (const r of resultats) {
  const marque = r.statut === 'ok' ? '·' : '✗'
  console.log(`${marque} ${r.quoi}`)
  if (r.statut !== 'ok') console.log(`    ${r.preuve}`)
}
console.log('')
console.log(`${resultats.length} contrôle(s) · ${defauts.length} défaut(s)`)

if (defauts.length) {
  /* Tous les défauts ne se valent pas, et un verdict qui les confond fait
     douter du test plutôt que du code. On distingue donc ce qui signe le
     retour du défaut P0 — apostrophe non échappée, gestionnaire en ligne,
     boîte native — de ce qui n'est qu'un durcissement incomplet. */
  const P0 = /apostrophe|gestionnaire en ligne|boîte\(s\) native|introuvable|charge d'injection/
  const regression = defauts.some((r) => P0.test(r.quoi))

  console.log('')
  console.log(regression
    ? 'Régression de sécurité : le correctif P0 du module Sacherie a été perdu.'
    : 'Durcissement incomplet : le correctif P0 tient, mais tous les caractères '
      + 'dangereux ne sont pas échappés. Voir le détail ci-dessus.')
  process.exit(1)
}

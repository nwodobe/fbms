#!/usr/bin/env node
/**
 * Contrôle de structure des pages HTML de FBMS.
 *
 * Pas de validateur W3C : il exigerait un service réseau, et ce dépôt n'a aucun
 * gestionnaire de paquets à la racine pour en installer un. On vérifie donc, à
 * la lecture, les défauts qui cassent réellement une page ou son
 * accessibilité — et rien d'autre, pour qu'un échec veuille dire quelque chose.
 *
 * Usage : node .github/scripts/verifier-html.mjs
 * Sortie : 0 si aucun défaut bloquant, 1 sinon.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const RACINE = process.cwd()
const REFERENTIEL = '.github/agent-policy/html-baseline.json'

/**
 * Écarts déjà présents sur `main` au moment de l'installation des agents.
 *
 * Ils ne sont pas pardonnés : ils sont datés. Sans ce référentiel, la porte
 * serait rouge dès la première pull request et plus personne ne la lirait — la
 * façon la plus sûre de rendre un contrôle inutile. Chaque entrée retirée d'ici
 * est un défaut réellement corrigé ; aucune ne doit y être ajoutée pour faire
 * passer une régression.
 */
const accepte = existsSync(REFERENTIEL)
  ? new Set(JSON.parse(readFileSync(REFERENTIEL, 'utf8')).accepted)
  : new Set()

/**
 * Fichiers suivis par git : on ne contrôle pas ce que le dépôt ne livre pas.
 *
 * `-z` est indispensable ici : sans lui, git échappe les chemins non-ASCII
 * entre guillemets, et « FBMS · Sauvegarde Master.html » devient illisible.
 */
const pages = execFileSync('git', ['ls-files', '-z', '*.html'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  // `savoir-plus/` est une application Next.js avec sa propre CI.
  .filter((chemin) => !chemin.startsWith('savoir-plus/'))

const defauts = []
const remarques = []

/** Compte les balises ouvrantes et fermantes d'un élément non auto-fermant. */
function equilibre(html, balise) {
  const ouvrantes = (html.match(new RegExp(`<${balise}[\\s>]`, 'gi')) ?? []).length
  const fermantes = (html.match(new RegExp(`</${balise}>`, 'gi')) ?? []).length
  return { ouvrantes, fermantes }
}

for (const page of pages) {
  const html = readFileSync(`${RACINE}/${page}`, 'utf8')
  const signaler = (regle, message) => defauts.push({ page, regle, message })

  if (!/<!doctype html>/i.test(html)) {
    signaler('doctype', 'aucune déclaration <!DOCTYPE html>')
  }

  const lang = html.match(/<html[^>]*\slang\s*=\s*["']([^"']+)["']/i)
  if (!lang) {
    signaler('lang', "l'élément <html> ne déclare pas d'attribut lang")
  }

  if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(html)) {
    signaler('viewport', 'aucune balise meta viewport : la page ne s’adapte pas au mobile')
  }

  const titre = html.match(/<title>([^<]*)<\/title>/i)
  if (!titre || titre[1].trim() === '') {
    signaler('title', '<title> absent ou vide')
  }

  if (!/<meta[^>]+charset/i.test(html)) {
    signaler('charset', 'aucun encodage déclaré')
  }

  // Une image sans alternative textuelle est invisible à un lecteur d'écran.
  // `alt=""` est valide et volontaire : il déclare une image décorative.
  const images = html.match(/<img\b[^>]*>/gi) ?? []
  const sansAlt = images.filter((balise) => !/\salt\s*=/i.test(balise))
  if (sansAlt.length > 0) {
    signaler('img-alt', `${sansAlt.length} image(s) sans attribut alt`)
  }

  // Un déséquilibre franc de ces conteneurs produit une page tronquée.
  for (const balise of ['html', 'head', 'body']) {
    const { ouvrantes, fermantes } = equilibre(html, balise)
    if (ouvrantes !== fermantes) {
      signaler('structure', `<${balise}> : ${ouvrantes} ouvrante(s) pour ${fermantes} fermante(s)`)
    }
  }

  // Remarque, pas défaut : un identifiant dupliqué ne casse pas toujours la
  // page, mais il casse `aria-labelledby`, `label[for]` et les ancres.
  const identifiants = [...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
  const doublons = identifiants.filter((id, index) => identifiants.indexOf(id) !== index)
  if (doublons.length > 0) {
    remarques.push({ page, regle: 'id-unique', message: `identifiant(s) dupliqué(s) : ${[...new Set(doublons)].join(', ')}` })
  }
}

const cle = (d) => `${d.page}|${d.regle}`
const historiques = defauts.filter((d) => accepte.has(cle(d)))
const nouveaux = defauts.filter((d) => !accepte.has(cle(d)))
const disparus = [...accepte].filter((c) => !defauts.some((d) => cle(d) === c))

for (const r of remarques) {
  process.stdout.write(`· remarque   ${r.page} — ${r.regle} : ${r.message}\n`)
}
for (const d of historiques) {
  process.stdout.write(`~ historique ${d.page} — ${d.regle} : ${d.message}\n`)
}
for (const d of nouveaux) {
  process.stdout.write(`✗ NOUVEAU    ${d.page} — ${d.regle} : ${d.message}\n`)
}
for (const c of disparus) {
  process.stdout.write(`✓ corrigé    ${c} — à retirer du référentiel\n`)
}

process.stdout.write(
  `\n${pages.length} page(s) · ${historiques.length} écart(s) historique(s) · ` +
    `${nouveaux.length} nouveau(x) · ${remarques.length} remarque(s)\n`,
)

if (nouveaux.length > 0) {
  process.stdout.write('\nUne régression nouvelle bloque la porte. Corrigez-la, ne l’ajoutez pas au référentiel.\n')
}
process.exit(nouveaux.length > 0 ? 1 : 0)

/**
 * Serveur statique du banc d'essai.
 *
 * Il sert les octets EXACTS du dépôt, sans transformation, comme le fait
 * GitHub Pages (`.nojekyll` : aucune génération). Un chemin supplémentaire
 * `/__vendor/` expose les bibliothèques tierces installées depuis npm, afin
 * que les pages exécutent le VRAI SDK Supabase et non une doublure.
 *
 * Chaque requête est journalisée (méthode, chemin, octets, durée) : c'est la
 * source des mesures de poids de page du rapport 06-PERFORMANCE.md.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
}

export function demarrerServeurStatique({ racine, port = 0, vendor = null } = {}) {
  const journal = []
  const serveur = createServer((req, res) => {
    const debut = process.hrtime.bigint()
    const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let fichier
    if (vendor && chemin.startsWith('/__vendor/')) {
      fichier = join(vendor, normalize(chemin.slice('/__vendor/'.length)).replace(/^(\.\.[/\\])+/, ''))
    } else {
      fichier = join(racine, normalize(chemin).replace(/^(\.\.[/\\])+/, ''))
    }
    if (existsSync(fichier) && statSync(fichier).isDirectory()) fichier = join(fichier, 'index.html')
    if (!existsSync(fichier)) {
      journal.push({ methode: req.method, chemin, statut: 404, octets: 0, ms: 0 })
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('introuvable')
    }
    const corps = readFileSync(fichier)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(fichier)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(corps)
    journal.push({
      methode: req.method,
      chemin,
      statut: 200,
      octets: corps.length,
      ms: Number(process.hrtime.bigint() - debut) / 1e6,
    })
  })
  return new Promise((resolve) => {
    serveur.listen(port, '127.0.0.1', () => {
      resolve({
        port: serveur.address().port,
        base: `http://127.0.0.1:${serveur.address().port}`,
        journal,
        fermer: () => new Promise((r) => serveur.close(r)),
      })
    })
  })
}

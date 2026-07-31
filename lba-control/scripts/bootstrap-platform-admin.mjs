#!/usr/bin/env node
/**
 * Amorçage du premier administrateur de plateforme.
 *
 * Ce script existe parce que le produit a un problème d'œuf et de poule :
 * `app.create_tenant` exige un administrateur de plateforme, et la table
 * `platform_admins` est vide sur un projet neuf. Sans ce geste initial, aucun
 * client ne peut être ouvert.
 *
 * Trois précautions, et elles ne sont pas décoratives.
 *
 *  1. **La clé `service_role` n'est jamais écrite sur disque.** Elle est lue
 *     dans l'environnement du processus, le temps d'un appel. Cette clé
 *     contourne Row Level Security : posée dans un fichier, elle finit un jour
 *     dans un dépôt.
 *
 *  2. **L'amorçage n'a lieu qu'une fois.** Si la table contient déjà un
 *     administrateur actif, le script refuse et le dit. Promouvoir un second
 *     compte est une décision de gouvernance qui passe par la console, pas par
 *     un script qu'on relance « au cas où ».
 *
 *  3. **Il montre avant de faire.** Le compte visé est résolu et affiché ; rien
 *     n'est écrit sans `--confirmer`. Promouvoir la mauvaise adresse donne à
 *     quelqu'un la capacité d'ouvrir, suspendre et assister tous les clients.
 *
 * Usage :
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/bootstrap-platform-admin.mjs --email moi@exemple.ci --nom "KOUASSI Innocent"
 *
 * Ajoutez `--confirmer` pour écrire réellement.
 */

const args = process.argv.slice(2)

const flag = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const email = flag('email')?.trim().toLowerCase()
const fullName = flag('nom')?.trim()
const confirmed = args.includes('--confirmer')

const url = process.env.SUPABASE_URL?.replace(/\/+$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

if (!url || !serviceKey) {
  fail(
    'SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être présentes dans l’environnement.\n' +
      '  Elles se trouvent dans Project Settings → API. La clé service_role contourne RLS :\n' +
      '  passez-la en variable d’environnement, ne l’écrivez jamais dans un fichier du dépôt.',
  )
}

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  fail('Renseignez une adresse valide : --email moi@exemple.ci')
}

if (!fullName || fullName.length < 2) {
  fail('Renseignez le nom affiché : --nom "KOUASSI Innocent"')
}

const rest = async (path, init = {}) => {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const text = await response.text()
  const body = text ? JSON.parse(text) : null

  if (!response.ok) {
    const detail = body?.message ?? body?.msg ?? text
    fail(`Appel ${path} refusé (HTTP ${response.status}) : ${detail}`)
  }

  return body
}

// --- 1. L'amorçage n'a-t-il pas déjà eu lieu ? -------------------------------

const existing = await rest('/rest/v1/platform_admins?select=user_id,email,is_active')

if (existing.length > 0) {
  const actifs = existing.filter((row) => row.is_active)
  console.error('\n✗ L’amorçage a déjà été fait. Administrateurs enregistrés :\n')
  for (const row of existing) {
    console.error(`    ${row.email}${row.is_active ? '' : '  (désactivé)'}`)
  }
  console.error(
    actifs.length > 0
      ? '\n  Pour en promouvoir un second, passez par la console plateforme : c’est une décision\n' +
          '  de gouvernance, elle doit laisser une trace dans le journal d’audit.\n'
      : '\n  Aucun n’est actif. Réactivez-en un depuis la base plutôt que d’en créer un autre.\n',
  )
  process.exit(1)
}

// --- 2. Le compte existe-t-il dans Supabase Auth ? ---------------------------
// L'identité vient de Supabase Auth, jamais d'ici. Ce script promeut un compte
// existant ; il n'en crée aucun et n'invente aucun mot de passe.

const found = await rest(`/auth/v1/admin/users?page=1&per_page=200`)
const users = Array.isArray(found) ? found : (found.users ?? [])
const account = users.find((user) => (user.email ?? '').toLowerCase() === email)

if (!account) {
  fail(
    `Aucun compte Supabase Auth pour « ${email} ».\n` +
      '  Créez-le d’abord : tableau de bord → Authentication → Users → Add user,\n' +
      '  ou par l’écran d’inscription de l’application. Ce script ne crée pas de compte\n' +
      '  et n’invente pas de mot de passe.',
  )
}

// --- 3. Montrer, puis faire ---------------------------------------------------

console.log('\nCompte à promouvoir administrateur de plateforme :\n')
console.log(`    identifiant : ${account.id}`)
console.log(`    adresse     : ${account.email}`)
console.log(`    nom affiché : ${fullName}`)
console.log(`    projet      : ${url}`)

if (!confirmed) {
  console.log(
    '\n  Rien n’a été écrit. Relancez la même commande avec --confirmer pour appliquer.\n' +
      '  Ce compte pourra ouvrir, suspendre et assister TOUS les clients : vérifiez l’adresse.\n',
  )
  process.exit(0)
}

await rest('/rest/v1/platform_admins', {
  method: 'POST',
  headers: { prefer: 'return=representation' },
  body: JSON.stringify({ user_id: account.id, full_name: fullName, email: account.email }),
})

console.log('\n✓ Compte promu administrateur de plateforme.\n')
console.log('  Reconnectez-vous : le jeton en cours a été émis avant la promotion et ne porte')
console.log('  pas encore le rôle. Sans le déclencheur « Customize Access Token » activé,')
console.log('  il ne le portera jamais — voir README §2.\n')

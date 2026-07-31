import { describe, expect, it } from 'vitest'
import {
  CHANNELS_BY_SEVERITY,
  countMessages,
  decideChannels,
  describeOutbox,
  isQuietHour,
  isSendRetryable,
  MAX_SEND_ATTEMPTS,
  normalizePhone,
  renderShortMessage,
  sendBackoffMs,
  smsSegments,
  type Recipient,
} from './messaging'

const joint = (over: Partial<Recipient> = {}): Recipient => ({
  userId: 'u-1',
  role: 'proprietaire',
  phone: '+2250700000001',
  email: 'chef@demo.test',
  channels: ['sms', 'whatsapp', 'email'],
  ...over,
})

describe('choix des canaux', () => {
  it('une information reste dans l’application', () => {
    // Envoyer un SMS pour chaque information ferait du produit une source de
    // bruit, et le premier réflexe serait de ne plus rien lire.
    expect(decideChannels('info', joint(), 10).channels).toEqual(['in_app'])
  })

  it('un blocage sort par tous les canaux consentis', () => {
    expect(decideChannels('blocage', joint(), 10).channels).toEqual([
      'in_app',
      'whatsapp',
      'sms',
    ])
  })

  it('l’échelle ne fait que croître avec la gravité', () => {
    const tailles = (['info', 'surveillance', 'critique', 'blocage'] as const).map(
      (gravite) => CHANNELS_BY_SEVERITY[gravite].length,
    )
    expect(tailles).toEqual([...tailles].sort((a, b) => a - b))
  })
})

describe('consentement', () => {
  it('sans consentement, rien ne sort de l’application', () => {
    const decision = decideChannels('blocage', joint({ channels: [] }), 10)
    expect(decision.channels).toEqual(['in_app'])
  })

  it('un canal consenti sans coordonnée est écarté', () => {
    // Donnée manquante, pas refus : on n'invente pas un numéro.
    const decision = decideChannels('blocage', joint({ phone: null }), 10)
    expect(decision.channels).toEqual(['in_app'])
  })

  it('le consentement d’un canal n’ouvre pas les autres', () => {
    const decision = decideChannels('blocage', joint({ channels: ['whatsapp'] }), 10)
    expect(decision.channels).toEqual(['in_app', 'whatsapp'])
  })
})

describe('heures calmes', () => {
  it('reconnaît la nuit', () => {
    expect(isQuietHour(22)).toBe(true)
    expect(isQuietHour(3)).toBe(true)
    expect(isQuietHour(6)).toBe(false)
    expect(isQuietHour(20)).toBe(false)
  })

  it('reporte une alerte critique nocturne au lieu de la perdre', () => {
    const decision = decideChannels('critique', joint(), 2)
    expect(decision.deferred).toBe(true)
    expect(decision.channels).toEqual(['in_app'])
    expect(decision.reason).toMatch(/reporté au matin/)
  })

  it('un blocage franchit les heures calmes', () => {
    // C'est le seul cas où réveiller quelqu'un se justifie.
    const decision = decideChannels('blocage', joint(), 2)
    expect(decision.deferred).toBe(false)
    expect(decision.channels).toContain('sms')
  })

  it('ne reporte rien quand rien ne devait sortir', () => {
    const decision = decideChannels('info', joint(), 2)
    expect(decision.deferred).toBe(false)
  })
})

describe('numéros de téléphone', () => {
  it('accepte un numéro ivoirien à dix chiffres', () => {
    expect(normalizePhone('07 00 00 00 01')).toBe('+2250700000001')
    expect(normalizePhone('0700000001')).toBe('+2250700000001')
  })

  it('accepte le même numéro déjà international', () => {
    expect(normalizePhone('+225 07 00 00 00 01')).toBe('+2250700000001')
    expect(normalizePhone('002250700000001')).toBe(null)
  })

  it('refuse un ancien numéro à huit chiffres au lieu de le deviner', () => {
    // La Côte d'Ivoire est passée à dix chiffres en 2021. Deviner enverrait des
    // montants et des noms de vendeurs chez un inconnu.
    expect(normalizePhone('07000001')).toBeNull()
    expect(normalizePhone('+22507000001')).toBeNull()
  })

  it('conserve un indicatif étranger plausible', () => {
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678')
  })

  it('refuse le vide et l’absurde', () => {
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('téléphone du bureau')).toBeNull()
  })
})

describe('contenu du message', () => {
  it('nomme l’entreprise en tête', () => {
    // Sans elle, le destinataire reçoit un message anonyme parlant d'argent.
    const message = renderShortMessage({
      tenantName: 'LBA Bouaké',
      title: 'Avance non couverte',
      body: 'ADV-0004, 2 400 000 FCFA, 9 jours.',
    })
    expect(message.startsWith('LBA Bouaké · ')).toBe(true)
  })

  it('tronque le corps, jamais le titre', () => {
    const message = renderShortMessage({
      tenantName: 'LBA',
      title: 'Écart supérieur à la tolérance',
      body: 'x'.repeat(500),
      limit: 90,
    })
    expect(message).toContain('Écart supérieur à la tolérance')
    expect(message.length).toBeLessThanOrEqual(90)
    expect(message.endsWith('…')).toBe(true)
  })

  it('garde le titre seul quand il ne reste plus de place', () => {
    const message = renderShortMessage({
      tenantName: 'LBA',
      title: 'Transfert bloqué',
      body: 'Détail très long qui ne tiendra pas.',
      limit: 26,
    })
    expect(message.length).toBeLessThanOrEqual(26)
  })
})

describe('facturation SMS', () => {
  it('un message court sans accent tient en un segment', () => {
    expect(smsSegments('Transfert TR-0002 bloque.')).toBe(1)
  })

  it('un accent fait basculer en segments de 70 caractères', () => {
    // Compter en 160 sous-estimerait la facture de plus du double : le français
    // contient presque toujours un caractère hors GSM-7.
    const accentue = 'Écart supérieur à la tolérance sur le transfert TR-0001 — vérifiez le ticket.'
    expect(accentue.length).toBeGreaterThan(70)
    expect(smsSegments(accentue)).toBeGreaterThan(1)
  })

  it('compte les segments d’un long message', () => {
    expect(smsSegments('a'.repeat(300))).toBe(2)
    expect(smsSegments('a'.repeat(500))).toBe(4)
  })
})

describe('réessais', () => {
  it('réessaie après une panne d’opérateur', () => {
    expect(isSendRetryable('502 Bad Gateway from provider')).toBe(true)
    expect(isSendRetryable('timeout')).toBe(true)
  })

  it('n’insiste pas sur un numéro invalide ou un désabonnement', () => {
    // Insister coûte de l'argent sans rien changer.
    expect(isSendRetryable('Numéro invalide')).toBe(false)
    expect(isSendRetryable('recipient has opted out')).toBe(false)
    expect(isSendRetryable('Destinataire inconnu')).toBe(false)
  })

  it('espace les tentatives sans dépasser une heure', () => {
    expect(sendBackoffMs(0)).toBe(30_000)
    expect(sendBackoffMs(3)).toBe(240_000)
    expect(sendBackoffMs(20)).toBe(60 * 60_000)
  })

  it('borne le nombre de tentatives', () => {
    expect(MAX_SEND_ATTEMPTS).toBeLessThanOrEqual(5)
  })
})

describe('état de la file d’envoi', () => {
  it('compte par statut', () => {
    expect(
      countMessages([
        { status: 'sent' },
        { status: 'sent' },
        { status: 'failed' },
        { status: 'queued' },
      ]),
    ).toEqual({ queued: 1, sending: 0, sent: 2, failed: 1, cancelled: 0 })
  })

  it('annonce les échecs avant les succès', () => {
    // « 412 envoyés » laisse croire que tout va bien alors que les douze qui ont
    // échoué sont peut-être les seuls qui comptaient.
    const message = describeOutbox({ queued: 0, sending: 0, sent: 412, failed: 12, cancelled: 0 })
    expect(message).toMatch(/^12 message\(s\) non délivré/)
  })

  it('annonce l’attente quand il n’y a pas d’échec', () => {
    expect(describeOutbox({ queued: 3, sending: 1, sent: 10, failed: 0, cancelled: 0 })).toMatch(
      /4 message\(s\) en attente/,
    )
  })

  it('dit franchement qu’aucun message n’est parti', () => {
    expect(describeOutbox({ queued: 0, sending: 0, sent: 0, failed: 0, cancelled: 0 })).toMatch(
      /Aucun message envoyé/,
    )
  })
})

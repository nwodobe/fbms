import { describe, expect, it } from 'vitest'
import {
  daysLeft,
  describeInvitation,
  emailIssue,
  invitationLink,
  invitationState,
  isResendable,
  slugFromName,
  slugIssue,
  sortInvitations,
  SLUG_MAX_LENGTH,
  type Invitation,
} from './tenants'

const maintenant = new Date('2026-03-10T08:00:00Z')

const invitation = (patch: Partial<Invitation> = {}): Invitation => ({
  id: 'i1',
  email: 'proprietaire@lba-seguela.ci',
  full_name: 'TRAORE Bakary',
  role: 'proprietaire',
  status: 'pending',
  expires_at: '2026-03-24T08:00:00Z',
  invited_at: '2026-03-10T08:00:00Z',
  ...patch,
})

describe('identifiant d’entreprise', () => {
  it('déshabille les accents plutôt que de les laisser dans une adresse', () => {
    // « lba-séguéla » percenté dans une URL ne se dicte pas au téléphone.
    expect(slugFromName('LBA Séguéla')).toBe('lba-seguela')
    expect(slugFromName('Coopérative Agricole d’Odienné')).toBe('cooperative-agricole-d-odienne')
  })

  it('ne finit jamais par un tiret, même après troncature', () => {
    // Le serveur refuse un identifiant terminé par un tiret : proposer un
    // identifiant refusé serait pire que ne rien proposer.
    const long = slugFromName(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} cooperative`)
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(long.endsWith('-')).toBe(false)
    expect(slugIssue(long)).toBeNull()
  })

  it('accepte ce que le serveur accepte', () => {
    expect(slugIssue('lba-seguela')).toBeNull()
    expect(slugIssue('lba2026')).toBeNull()
    expect(slugIssue('abc')).toBeNull()
  })

  it('dit pourquoi il refuse, au lieu de refuser en silence', () => {
    expect(slugIssue('')).toMatch(/obligatoire/)
    expect(slugIssue('ab')).toMatch(/3 caractères/)
    expect(slugIssue('a'.repeat(51))).toMatch(/50 caractères/)
    expect(slugIssue('LBA')).toMatch(/[Mm]inuscules/)
    expect(slugIssue('lba séguéla')).toMatch(/[Ll]ettres non accentuées/)

    // Une valeur à la fois majuscule et hors alphabet : dire « minuscules
    // uniquement » ferait croire qu'il suffit de baisser la casse.
    expect(slugIssue('LBA Séguéla!')).toMatch(/[Ll]ettres non accentuées/)
    expect(slugIssue('-lba')).toMatch(/tiret/)
    expect(slugIssue('lba-')).toMatch(/tiret/)
  })

  it('reprend le même contrôle d’adresse que le serveur', () => {
    expect(emailIssue('proprietaire@lba-seguela.ci')).toBeNull()
    expect(emailIssue('pas-une-adresse')).toMatch(/invalide/)
    expect(emailIssue('a@b')).toMatch(/invalide/)
    expect(emailIssue('  ')).toMatch(/obligatoire/)
  })
})

describe('état d’une invitation', () => {
  it('une invitation périmée n’est plus « en attente »', () => {
    // Rien ne repasse sur la table pour fermer une invitation à sa date : sans
    // ce calcul, on attendrait indéfiniment quelqu'un qu'il faut réinviter.
    const perimee = invitation({ expires_at: '2026-03-09T08:00:00Z' })
    expect(perimee.status).toBe('pending')
    expect(invitationState(perimee, maintenant)).toBe('expired')
    expect(describeInvitation(perimee, maintenant)).toMatch(/renvoyer/)
  })

  it('un statut décidé reste ce qu’il est, même après la date', () => {
    const acceptee = invitation({ status: 'accepted', expires_at: '2026-03-01T08:00:00Z' })
    expect(invitationState(acceptee, maintenant)).toBe('accepted')
    expect(describeInvitation(acceptee, maintenant)).toBe('compte créé')
  })

  it('compte les jours restants sans jamais descendre sous zéro', () => {
    expect(daysLeft(invitation(), maintenant)).toBe(14)
    expect(daysLeft(invitation({ expires_at: '2026-02-01T08:00:00Z' }), maintenant)).toBe(0)
  })

  it('parle au singulier le dernier jour', () => {
    const demain = invitation({ expires_at: '2026-03-10T20:00:00Z' })
    expect(describeInvitation(demain, maintenant)).toBe('expire aujourd’hui')
  })

  it('ne propose de renvoyer que ce qui peut l’être', () => {
    expect(isResendable(invitation(), maintenant)).toBe(true)
    expect(isResendable(invitation({ expires_at: '2026-01-01T00:00:00Z' }), maintenant)).toBe(true)
    expect(isResendable(invitation({ status: 'accepted' }), maintenant)).toBe(false)
    expect(isResendable(invitation({ status: 'revoked' }), maintenant)).toBe(false)
  })
})

describe('ordre d’affichage', () => {
  it('met en tête ce qui demande une action', () => {
    // Trier par date pousserait les périmées — les seules à traiter — au bas
    // d'une liste qui s'allonge à chaque recrutement.
    const liste = [
      invitation({ id: 'acceptee', status: 'accepted' }),
      invitation({ id: 'attente' }),
      invitation({ id: 'revoquee', status: 'revoked' }),
      invitation({ id: 'perimee', expires_at: '2026-03-01T08:00:00Z' }),
    ]

    expect(sortInvitations(liste, maintenant).map((i) => i.id)).toEqual([
      'perimee',
      'attente',
      'acceptee',
      'revoquee',
    ])
  })

  it('à état égal, la plus récente d’abord', () => {
    const liste = [
      invitation({ id: 'ancienne', invited_at: '2026-03-01T08:00:00Z' }),
      invitation({ id: 'recente', invited_at: '2026-03-09T08:00:00Z' }),
    ]
    expect(sortInvitations(liste, maintenant).map((i) => i.id)).toEqual(['recente', 'ancienne'])
  })

  it('ne modifie pas la liste reçue', () => {
    const liste = [invitation({ id: 'a' }), invitation({ id: 'b', status: 'revoked' })]
    sortInvitations(liste, maintenant)
    expect(liste.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('lien d’acceptation', () => {
  it('se construit sur l’origine réelle', () => {
    // Un domaine codé en dur pointerait ailleurs dès la première mise en
    // production.
    expect(invitationLink('https://lba.example.ci', 'abc123')).toBe(
      'https://lba.example.ci/invitation/abc123',
    )
  })

  it('tolère une origine terminée par une barre oblique', () => {
    expect(invitationLink('https://lba.example.ci/', 'abc123')).toBe(
      'https://lba.example.ci/invitation/abc123',
    )
  })
})

import { describe, expect, it } from 'vitest'
import {
  MIN_PASSWORD_LENGTH,
  assessPassword,
  describeDiagnosis,
  diagnoseActivation,
  readTokenClaims,
  type AccountRow,
} from './activation'

/** Fabrique un jeton non signé : seule la charge utile compte pour la lecture. */
const jeton = (payload: object): string => {
  const base64url = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${base64url({ alg: 'HS256' })}.${base64url(payload)}.signature`
}

describe('force du mot de passe', () => {
  it('refuse en dessous de la longueur du serveur', () => {
    const resultat = assessPassword('Court1!')
    expect(resultat.accepted).toBe(false)
    expect(resultat.issues[0]).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('annonce la longueur atteinte, pas seulement le seuil', () => {
    // « Trop court » sans dire de combien oblige à tâtonner.
    expect(assessPassword('abcdefgh').issues[0]).toContain('8')
  })

  it('accepte une phrase de passe longue et simple', () => {
    // Une phrase se retient ; une suite de symboles se note sur un papier.
    expect(assessPassword('le camion part a 6h').accepted).toBe(true)
  })

  it('refuse une suite de lettres seules, même longue', () => {
    const resultat = assessPassword('abcdefghijklmnop')
    expect(resultat.accepted).toBe(false)
    expect(resultat.issues[0]).toMatch(/chiffre|ponctuation/)
  })

  it('signale une confirmation qui diverge', () => {
    const resultat = assessPassword('le camion part a 6h', 'le camion part a 7h')
    expect(resultat.accepted).toBe(false)
    expect(resultat.issues).toContain('Les deux saisies ne correspondent pas.')
  })

  it('ne réclame pas de confirmation quand aucune n’est demandée', () => {
    expect(assessPassword('le camion part a 6h').accepted).toBe(true)
  })
})

const compte = (over: Partial<AccountRow> = {}): AccountRow => ({
  tenantId: 'tenant-a',
  role: 'proprietaire',
  status: 'active',
  ...over,
})

describe('diagnostic d’activation', () => {
  it('ne signale rien quand le jeton porte une entreprise', () => {
    expect(
      diagnoseActivation({
        claims: { tenantId: 'tenant-a', role: 'proprietaire' },
        account: compte(),
      }),
    ).toEqual({ kind: 'active' })
  })

  it('reconnaît l’administrateur de plateforme avant tout le reste', () => {
    // Il n'a légitimement aucune entreprise. Le confondre avec un compte cassé
    // enverrait un super-administrateur chercher un défaut inexistant.
    expect(
      diagnoseActivation({
        claims: { tenantId: null, role: 'super_admin' },
        account: null,
      }),
    ).toEqual({ kind: 'platform_admin' })
  })

  it('distingue un compte jamais rattaché', () => {
    expect(
      diagnoseActivation({ claims: { tenantId: null, role: null }, account: null }),
    ).toEqual({ kind: 'unattached' })
  })

  it('distingue un compte suspendu', () => {
    expect(
      diagnoseActivation({
        claims: { tenantId: null, role: null },
        account: compte({ status: 'suspended' }),
      }),
    ).toEqual({ kind: 'suspended' })
  })

  it('déduit l’absence du hook d’un écart que rien d’autre n’explique', () => {
    // La base dit « ce compte appartient à l'entreprise A et il est actif », le
    // jeton ne porte aucune entreprise : rien ne recopie l'une dans l'autre.
    expect(
      diagnoseActivation({ claims: { tenantId: null, role: null }, account: compte() }),
    ).toEqual({ kind: 'hook_missing', tenantId: 'tenant-a' })
  })

  it('retombe sur « non rattaché » plutôt que d’accuser le serveur à tort', () => {
    // Ligne active sans entreprise : forme d'un compte de plateforme dont le
    // jeton n'a pas été réémis. Dans le doute, on oriente vers l'action utile.
    expect(
      diagnoseActivation({
        claims: { tenantId: null, role: null },
        account: compte({ tenantId: null, role: null }),
      }),
    ).toEqual({ kind: 'unattached' })
  })
})

describe('messages du diagnostic', () => {
  it('adresse le défaut de configuration à l’exploitant, pas à l’utilisateur', () => {
    const message = describeDiagnosis({ kind: 'hook_missing', tenantId: 'tenant-a' })
    expect(message.audience).toBe('exploitant')
    // L'utilisateur ne doit pas croire que son compte est en cause.
    expect(message.body).toContain('Ce n’est pas un problème de votre compte')
    expect(message.action).toContain('Customize Access Token')
  })

  it('donne une action à qui peut agir, et rien à qui ne le peut pas', () => {
    // Un compte suspendu ne se débloque pas lui-même : lui proposer un bouton
    // serait une fausse piste.
    expect(describeDiagnosis({ kind: 'suspended' }).action).toBeNull()
    expect(describeDiagnosis({ kind: 'unattached' }).action).not.toBeNull()
  })

  it('explique au super-administrateur pourquoi il ne voit aucune donnée client', () => {
    const message = describeDiagnosis({ kind: 'platform_admin' })
    expect(message.body).toContain('session')
    expect(message.action).toBe('Ouvrir la console plateforme')
  })
})

describe('lecture du jeton signé', () => {
  it('lit le tenant et le rôle portés par le jeton', () => {
    // C'est le jeton qui compte, et non l'objet utilisateur rendu par la
    // bibliothèque : le premier est ce que RLS recevra.
    const lu = readTokenClaims(
      jeton({ sub: 'u1', app_metadata: { tenant_id: 'tenant-a', role: 'proprietaire' } }),
    )

    expect(lu?.claims).toEqual({ tenantId: 'tenant-a', role: 'proprietaire' })
    expect(lu?.carriesMetadata).toBe(true)
  })

  it('signale un jeton émis sans le déclencheur', () => {
    // Le cas exact d'un projet dont le hook n'est pas activé : le jeton est
    // valide, il ne porte simplement rien.
    const lu = readTokenClaims(jeton({ sub: 'u1', app_metadata: {} }))

    expect(lu?.claims).toEqual({ tenantId: null, role: null })
    expect(lu?.carriesMetadata).toBe(false)
  })

  it('distingue un jeton illisible d’un jeton sans revendications', () => {
    // Les confondre ferait accuser le déclencheur à tort.
    expect(readTokenClaims('pas-un-jeton')).toBeNull()
    expect(readTokenClaims(null)).toBeNull()
    expect(readTokenClaims('a.charge-utile-invalide.c')).toBeNull()
  })

  it('ignore un tenant qui ne serait pas une chaîne', () => {
    const lu = readTokenClaims(jeton({ app_metadata: { tenant_id: 42, role: null } }))
    expect(lu?.claims).toEqual({ tenantId: null, role: null })
  })
})

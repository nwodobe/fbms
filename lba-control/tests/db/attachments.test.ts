/**
 * Phase 9 · rattachement des justificatifs, vérifié en base.
 *
 * La file locale des justificatifs suppose une chose que rien n'avait encore
 * démontrée : que les rôles qui prennent les photos ont bien le droit d'écrire
 * le chemin sur la ligne concernée. Si RLS le refusait, la photo partirait dans
 * le bucket, le rattachement échouerait indéfiniment, et l'application
 * afficherait « en attente » pour toujours sans que personne comprenne pourquoi.
 *
 * Ces tests cadrent donc les quatre emplacements que la liste blanche autorise,
 * et vérifient aussi ce qui doit rester refusé.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actors, ids, seedFixtures } from './fixtures'
import { pool, withUser } from './helpers'

beforeAll(async () => {
  await seedFixtures()
}, 60_000)

afterAll(async () => {
  await pool.end()
})

const PATH = '00000000-0000-4000-8000-000000000001/preuve_achat/2026-07-31/x.jpg'

// ---------------------------------------------------------------------------
// Ce que la file doit pouvoir écrire
// ---------------------------------------------------------------------------

describe('rattachement d’une preuve d’achat', () => {
  it('un pisteur renseigne le chemin sur son propre achat', async () => {
    // C'est le cas central du produit : la photo est prise sur le terrain, elle
    // repart quand le réseau revient, et c'est le pisteur qui la porte.
    const { rowCount } = await withUser(actors.agentA1, (c) =>
      c.query(`update purchases set proof_path = $1 where id = $2`, [PATH, ids.purchaseA1]),
    )
    expect(rowCount).toBe(1)
  })

  it('un pisteur ne renseigne rien sur l’achat d’un autre', async () => {
    // Aucune erreur : RLS filtre, la mise à jour ne touche simplement personne.
    // C'est exactement pourquoi le moteur d'envoi compte les lignes affectées
    // au lieu de se fier à l'absence d'erreur.
    const { rowCount } = await withUser(actors.agentA1, (c) =>
      c.query(`update purchases set proof_path = $1 where id = $2`, [PATH, ids.purchaseA2]),
    )
    expect(rowCount).toBe(0)
  })

  it('un auditeur ne rattache aucun justificatif', async () => {
    const { rowCount } = await withUser(actors.auditorA, (c) =>
      c.query(`update purchases set proof_path = $1 where id = $2`, [PATH, ids.purchaseA1]),
    )
    expect(rowCount).toBe(0)
  })
})

describe('rattachement d’un ticket de pesée', () => {
  it('un gestionnaire renseigne le ticket de départ', async () => {
    const { rowCount } = await withUser(actors.managerA, (c) =>
      c.query(`update transfers set weighing_ticket_path = $1 where id = $2`, [
        PATH,
        ids.transferA1,
      ]),
    )
    expect(rowCount).toBe(1)
  })

  it('un comptable ne touche pas aux tickets de pesée', async () => {
    // Le comptable ne constate pas une pesée : il ne l'a pas vue. La même règle
    // qui lui interdit de saisir un poids lui interdit d'en produire la preuve.
    const { rowCount } = await withUser(actors.accountantA, (c) =>
      c.query(`update transfers set weighing_ticket_path = $1 where id = $2`, [
        PATH,
        ids.transferA1,
      ]),
    )
    expect(rowCount).toBe(0)
  })

  it('les deux tickets d’un transfert coexistent', async () => {
    const { rows } = await withUser(actors.managerA, async (c) => {
      await c.query(
        `update transfers set weighing_ticket_path = $1, reception_ticket_path = $2 where id = $3`,
        [`${PATH}#depart`, `${PATH}#reception`, ids.transferA1],
      )
      return c.query(
        `select weighing_ticket_path, reception_ticket_path from transfers where id = $1`,
        [ids.transferA1],
      )
    })

    expect(rows[0].weighing_ticket_path).toMatch(/#depart$/)
    expect(rows[0].reception_ticket_path).toMatch(/#reception$/)
  })
})

describe('rattachement d’une image de marque', () => {
  it('un propriétaire renseigne les trois emplacements', async () => {
    const { rows } = await withUser(actors.ownerA, async (c) => {
      await c.query(
        `update tenant_branding
            set logo_path = $1, logo_mobile_path = $2, login_image_path = $3
          where tenant_id = $4`,
        ['marque/logo.png', 'marque/logo-mobile.png', 'marque/connexion.png', ids.tenantA],
      )
      return c.query(
        `select logo_path, logo_mobile_path, login_image_path from tenant_branding where tenant_id = $1`,
        [ids.tenantA],
      )
    })

    expect(rows[0]).toEqual({
      logo_path: 'marque/logo.png',
      logo_mobile_path: 'marque/logo-mobile.png',
      login_image_path: 'marque/connexion.png',
    })
  })

  it('un pisteur ne modifie pas la marque de l’entreprise', async () => {
    const { rowCount } = await withUser(actors.agentA1, (c) =>
      c.query(`update tenant_branding set logo_path = $1 where tenant_id = $2`, [
        'marque/pirate.png',
        ids.tenantA,
      ]),
    )
    expect(rowCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Ce qui reste hors de portée
// ---------------------------------------------------------------------------

describe('cloisonnement', () => {
  it('le justificatif d’un autre tenant reste invisible et intouchable', async () => {
    const { rowCount } = await withUser(actors.ownerB, (c) =>
      c.query(`update purchases set proof_path = $1 where id = $2`, [PATH, ids.purchaseA1]),
    )
    expect(rowCount).toBe(0)
  })

  it('un justificatif ne peut pas être effacé en supprimant sa ligne', async () => {
    // Le chemin peut être remplacé, la transaction jamais supprimée : c'est ce
    // qui garantit qu'un contrôleur retrouve au moins la trace de l'opération.
    //
    // Noter la forme du refus : RLS ne lève PAS d'erreur sur un DELETE interdit,
    // il filtre. La suppression « réussit » en ne touchant aucune ligne. C'est
    // pourquoi le compte de lignes est la seule vérification qui vaille.
    const { rows } = await withUser(actors.ownerA, async (c) => {
      const deletion = await c.query(`delete from purchases where id = $1`, [ids.purchaseA1])
      expect(deletion.rowCount).toBe(0)
      return c.query(`select id from purchases where id = $1`, [ids.purchaseA1])
    })

    expect(rows).toHaveLength(1)
  })
})

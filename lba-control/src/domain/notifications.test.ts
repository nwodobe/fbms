import { describe, expect, it } from 'vitest'
import {
  badgeLabel,
  countStillOpen,
  dayLabel,
  groupByDay,
  sortNotifications,
  stillOpen,
  unreadCount,
  type NotificationItem,
} from './notifications'

const NOW = new Date('2026-07-31T10:00:00.000Z')

const item = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n-1',
  title: 'Titre',
  body: 'Corps',
  severity: 'info',
  createdAt: '2026-07-31T08:00:00.000Z',
  readAt: null,
  alertId: 'a-1',
  ...over,
})

describe('ordre d’affichage', () => {
  it('met les non-lues devant', () => {
    const sorted = sortNotifications([
      item({ id: 'lue', readAt: '2026-07-31T09:00:00.000Z', severity: 'blocage' }),
      item({ id: 'non-lue', severity: 'info' }),
    ])
    expect(sorted[0]!.id).toBe('non-lue')
  })

  it('classe par gravité avant la date', () => {
    // Trier d'abord par date ferait glisser un blocage hors de l'écran à mesure
    // que des informations arrivent.
    const sorted = sortNotifications([
      item({ id: 'recent-info', severity: 'info', createdAt: '2026-07-31T09:59:00.000Z' }),
      item({ id: 'vieux-blocage', severity: 'blocage', createdAt: '2026-07-30T06:00:00.000Z' }),
    ])
    expect(sorted[0]!.id).toBe('vieux-blocage')
  })

  it('à gravité égale, le plus récent d’abord', () => {
    const sorted = sortNotifications([
      item({ id: 'ancien', createdAt: '2026-07-29T08:00:00.000Z' }),
      item({ id: 'recent', createdAt: '2026-07-31T08:00:00.000Z' }),
    ])
    expect(sorted.map((n) => n.id)).toEqual(['recent', 'ancien'])
  })

  it('ne modifie pas le tableau reçu', () => {
    const input = [item({ id: 'a', severity: 'info' }), item({ id: 'b', severity: 'blocage' })]
    sortNotifications(input)
    expect(input.map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('pastille de non-lues', () => {
  it('compte les non-lues', () => {
    expect(
      unreadCount([item(), item({ readAt: '2026-07-31T09:00:00.000Z' }), item()]),
    ).toBe(2)
  })

  it('n’affiche rien à zéro', () => {
    // Une pastille à zéro attire l'œil pour rien.
    expect(badgeLabel(0)).toBeNull()
    expect(badgeLabel(-3)).toBeNull()
  })

  it('plafonne au-delà de 99', () => {
    expect(badgeLabel(99)).toBe('99')
    expect(badgeLabel(100)).toBe('99+')
    expect(badgeLabel(4210)).toBe('99+')
  })
})

describe('lue n’est pas résolue', () => {
  it('une notification lue dont l’alerte reste ouverte est signalée comme telle', () => {
    // Vider la liste d'un clic ne règle rien : confondre les deux états ferait
    // disparaître un problème d'un simple coup d'œil.
    const read = item({ readAt: '2026-07-31T09:30:00.000Z', alertStatus: 'ouverte' })
    expect(stillOpen(read)).toBe(true)
  })

  it('une alerte résolue ne compte plus', () => {
    expect(stillOpen(item({ alertStatus: 'resolue' }))).toBe(false)
    expect(stillOpen(item({ alertStatus: null }))).toBe(false)
    expect(stillOpen(item())).toBe(false)
  })

  it('compte les situations encore ouvertes indépendamment de la lecture', () => {
    expect(
      countStillOpen([
        item({ alertStatus: 'ouverte', readAt: '2026-07-31T09:00:00.000Z' }),
        item({ alertStatus: 'ouverte' }),
        item({ alertStatus: 'resolue' }),
      ]),
    ).toBe(2)
  })
})

describe('regroupement par jour', () => {
  it('nomme aujourd’hui et hier', () => {
    expect(dayLabel('2026-07-31T02:00:00.000Z', NOW)).toBe('Aujourd’hui')
    expect(dayLabel('2026-07-30T23:00:00.000Z', NOW)).toBe('Hier')
  })

  it('compte en jours calendaires, pas en tranches de 24 heures', () => {
    // 23h59 plus tôt mais la veille : « hier », pas « aujourd'hui ».
    expect(dayLabel('2026-07-30T10:01:00.000Z', NOW)).toBe('Hier')
  })

  it('bascule sur la date au-delà d’une semaine', () => {
    expect(dayLabel('2026-07-24T10:00:00.000Z', NOW)).toBe('2026-07-24')
  })

  it('groupe en conservant l’ordre d’urgence', () => {
    const groups = groupByDay(
      [
        item({ id: 'info-jour', severity: 'info', createdAt: '2026-07-31T09:00:00.000Z' }),
        item({ id: 'bloc-jour', severity: 'blocage', createdAt: '2026-07-31T07:00:00.000Z' }),
        item({ id: 'hier', createdAt: '2026-07-30T07:00:00.000Z' }),
      ],
      NOW,
    )

    expect(groups[0]!.label).toBe('Aujourd’hui')
    expect(groups[0]!.items.map((n) => n.id)).toEqual(['bloc-jour', 'info-jour'])
    expect(groups[1]!.label).toBe('Hier')
  })

  it('ne perd aucune notification au regroupement', () => {
    const items = [
      item({ id: '1', createdAt: '2026-07-31T09:00:00.000Z' }),
      item({ id: '2', createdAt: '2026-07-30T09:00:00.000Z' }),
      item({ id: '3', createdAt: '2026-07-10T09:00:00.000Z' }),
    ]
    const total = groupByDay(items, NOW).reduce((sum, group) => sum + group.items.length, 0)
    expect(total).toBe(items.length)
  })
})

import { describe, expect, it } from 'vitest'
import {
  aggregateReconciliation,
  buildLockedLines,
  catalogFromDefs,
  denominationTotal,
  diffTone,
  enteredDiff,
  expectedCash,
  noteRequired,
  periodBoundIso,
  RECONCILIATION_TOLERANCE,
} from '../../src/lib/cashReconciliation'

describe('hesap alma', () => {
  it('aralık saniye sınırını kapsar', () => {
    const start = periodBoundIso('2026-10-15T22:14:07', 'start')
    const end = periodBoundIso('2026-10-16T14:02:31', 'end')
    expect(start).toBeTruthy()
    expect(end).toBeTruthy()
    const atStart = new Date(2026, 9, 15, 22, 14, 7, 0).toISOString()
    const justBefore = new Date(2026, 9, 15, 22, 14, 6, 999).toISOString()
    const atEnd = new Date(2026, 9, 16, 14, 2, 31, 500).toISOString()
    const after = new Date(2026, 9, 16, 14, 2, 32, 0).toISOString()
    expect(atStart >= start! && atStart <= end!).toBe(true)
    expect(justBefore >= start!).toBe(false)
    expect(atEnd <= end!).toBe(true)
    expect(after <= end!).toBe(false)
    expect(start! > end!).toBe(false)
  })

  it('kartı bankaya böler, iadeyi düşer, tanımsız bankayı sıfırlar', () => {
    const snap = aggregateReconciliation({
      banks: [
        { acquirerId: '10', label: 'AktifBank' },
        { acquirerId: '20', label: 'Ziraat' },
      ],
      brands: [
        { brandId: 3, mediator: 14, label: 'Multinet' },
        { brandId: 4, mediator: 15, label: 'Sodexo' },
      ],
      sales: [
        { id: 's1', isReturn: false, netAmount: 1250, discountAmount: 0, cashAmount: 0, cardAmount: 1250 },
        { id: 's2', isReturn: true, netAmount: 30, discountAmount: 0, cashAmount: 0, cardAmount: 30 },
        { id: 's3', isReturn: false, netAmount: 100, discountAmount: 10, cashAmount: 0, cardAmount: 0 },
      ],
      payments: [
        { saleId: 's1', method: 'card', amount: 1250, mediator: 2, acquirerId: '10', acquirerName: 'AktifBank', isReturn: false },
        { saleId: 's2', method: 'card', amount: 30, mediator: 2, acquirerId: '10', acquirerName: 'AktifBank', isReturn: true },
        { saleId: 's3', method: 'other', amount: 40, mediator: 14, acquirerId: null, acquirerName: null, isReturn: false },
        { saleId: 's3', method: 'card', amount: 44, mediator: 2, acquirerId: '99', acquirerName: 'Bilinmeyen', isReturn: false },
      ],
      collections: [
        { amount: 150, method: 'cash' },
        { amount: 20, method: 'card' },
      ],
    })
    expect(snap.cards.map(c => [c.label, c.system])).toEqual([
      ['AktifBank', 1220],
      ['Ziraat', 0],
      ['Diğer banka', 64],
    ])
    expect(snap.others.map(c => [c.label, c.system])).toEqual([
      ['Multinet', 40],
      ['Sodexo', 0],
    ])
    expect(snap.cashCollections).toBe(150)
    expect(snap.onAccount).toBe(16)
    expect(snap.discount).toBe(10)
    expect(snap.saleCount).toBe(2)
    expect(snap.refundCount).toBe(1)
  })

  it('nakit formülü ve küpür toplamı', () => {
    expect(expectedCash({
      opening: 500,
      cashSales: 3200,
      cashCollections: 150,
      cashRefunds: 80,
      cashOut: 0,
    })).toBe(3770)
    expect(enteredDiff(3765, 3770)).toBe(-5)
    expect(denominationTotal({ '200': 1, '100': 1, '050': 2, '005': 1 })).toBe(301.05)
    expect(diffTone(0)).toBe('ok')
    expect(diffTone(-5)).toBe('warn')
    expect(diffTone(-5.01)).toBe('bad')
    expect(diffTone(null)).toBe('empty')
    expect(noteRequired(RECONCILIATION_TOLERANCE)).toBe(false)
    expect(noteRequired(-5.01)).toBe(true)
  })

  it('katalog tutar taşımaz, kilit satırı farkı girilen eksi sistemdir', () => {
    const catalog = catalogFromDefs(
      [{ acquirerId: '10', label: 'AktifBank' }, { acquirerId: '20', label: 'Ziraat' }],
      [
        { brandId: 3, mediator: 14, label: 'Multinet' },
        { brandId: 999, mediator: 2, label: 'Taksit' },
        { brandId: 1, mediator: 1, label: 'Nakit' },
      ],
    )
    expect(catalog.banks.map(b => b.label)).toEqual(['AktifBank', 'Ziraat', 'Diğer banka'])
    expect(catalog.others.map(b => b.label)).toEqual(['Multinet'])
    expect(JSON.stringify(catalog)).not.toMatch(/system|amount/)
    const built = buildLockedLines({
      cards: [
        { group: 'card', key: '10', label: 'AktifBank', system: 1250 },
        { group: 'card', key: '20', label: 'Ziraat', system: 430 },
        { group: 'card', key: '__unknown__', label: 'Diğer banka', system: 44 },
      ],
      others: [{ group: 'other', key: '14', label: 'Multinet', system: 120 }],
      cashSales: 3200,
      cashCollections: 150,
      cashRefunds: 80,
      onAccount: 900,
      discount: 45,
      saleCount: 87,
      refundCount: 2,
    }, catalog.banks, catalog.others, {
      opening: 500,
      cashOut: 0,
      counted: 3765,
      cards: { '10': 1250, '20': 400, __unknown__: 0 },
      others: { '14': 120 },
    })
    expect(built.expected).toBe(3770)
    expect(built.totalDiff).toBe(-79)
    expect(built.lines.find(l => l.key === '20')?.diff).toBe(-30)
  })
})

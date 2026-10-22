import { describe, expect, it } from 'vitest'
import { nextDayEndReport, paymentDocKey, planDayEndDocs, type DayEndSale } from '../../src/lib/dayEndRun'

function sale(partial: Partial<DayEndSale> & Pick<DayEndSale, 'id'>): DayEndSale {
  return {
    createdAt: '2026-10-20T10:00:00.000Z',
    customerId: null,
    customerName: null,
    receiptNo: '42',
    isReturn: false,
    netAmount: 10,
    ...partial,
  }
}

describe('admin gün sonu planı', () => {
  it('z_single carisizleri tek faturada, cariyi ayrı tutar', () => {
    const docs = planDayEndDocs([
      sale({ id: 'a' }),
      sale({ id: 'b', createdAt: '2026-10-20T11:00:00.000Z' }),
      sale({ id: 'r', isReturn: true, createdAt: '2026-10-20T12:00:00.000Z' }),
      sale({ id: 'c', customerId: '9', customerName: 'Ahmet', createdAt: '2026-10-20T13:00:00.000Z' }),
    ], 'z_single')
    expect(docs.map(d => d.docKey)).toEqual(['retail:1', 'retail_refund:1', 'sale:c'])
    expect(docs[0].sales.map(s => s.id)).toEqual(['a', 'b'])
    expect(docs[0].queueType).toBe('invoice')
    expect(docs[1].queueType).toBe('return_invoice')
  })

  it('per_sale her carisiz satışı ayrı belge yapar', () => {
    const docs = planDayEndDocs([
      sale({ id: 'a' }),
      sale({ id: 'b' }),
    ], 'per_sale')
    expect(docs.map(d => d.docKey)).toEqual(['sale:a', 'sale:b'])
  })

  it('200 satışı aşan perakende faturayı böler', () => {
    const rows = Array.from({ length: 201 }, (_, i) => sale({
      id: String(i).padStart(3, '0'),
      createdAt: `2026-10-20T10:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}.000Z`,
    }))
    const docs = planDayEndDocs(rows, 'z_single')
    expect(docs.map(d => d.docKey)).toEqual(['retail:1', 'retail:2'])
    expect(docs[0].sales).toHaveLength(200)
    expect(docs[1].sales).toHaveLength(1)
  })

  it('failed run yeniden pending olunca processing, hepsi success olunca completed bildirir', () => {
    expect(nextDayEndReport('failed', ['success', 'pending'])).toBe('processing')
    expect(nextDayEndReport('processing', ['success', 'pending'])).toBeNull()
    expect(nextDayEndReport('processing', ['success', 'success'])).toBe('completed')
    expect(nextDayEndReport('failed', ['failed', 'success'])).toBeNull()
    expect(nextDayEndReport('completed', ['success'])).toBeNull()
  })

  it('tahsilat anahtarını yöntem ve bankaya göre kurar', () => {
    expect(paymentDocKey('retail:1', 'cash')).toBe('pay:retail:1:cash')
    expect(paymentDocKey('retail:1', 'card', '62')).toBe('pay:retail:1:card:62')
  })
})

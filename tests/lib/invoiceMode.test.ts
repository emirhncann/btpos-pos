import { describe, expect, it } from 'vitest'
import {
  formatDayEndInvoiceLabel,
  formatSentInvoice,
  formatDayEndPaymentLabel,
  formatPerSaleInvoiceLabel,
  groupDayEndSales,
  istanbulDayKey,
  parseInvoiceMode,
} from '../../src/lib/invoiceMode'

describe('invoice mode', () => {
  it('başarılı belgede fatura numarasını, boşsa gönderildi yazar', () => {
    expect(formatSentInvoice('0000000000000013')).toBe('✓ Fatura 0000000000000013')
    expect(formatSentInvoice('')).toBe('✓ Gönderildi')
    expect(formatSentInvoice(null)).toBe('✓ Gönderildi')
  })

  it('boş veya bilinmeyen ayarı z_single sayar', () => {
    expect(parseInvoiceMode(undefined)).toBe('z_single')
    expect(parseInvoiceMode('')).toBe('z_single')
    expect(parseInvoiceMode('per_sale')).toBe('per_sale')
  })

  it('İstanbul günü gece yarısını UTC gününden ayırır', () => {
    expect(istanbulDayKey('2026-10-21T20:00:00.000Z')).toBe('2026-10-21')
    expect(istanbulDayKey('2026-10-21T21:30:00.000Z')).toBe('2026-10-22')
  })

  it('aynı gün yeniden açılışta bugünü paketlemez, ertesi gün dünü paketler', () => {
    const sales = [
      { id: 'a', createdAt: '2026-10-21T10:00:00.000Z' },
      { id: 'b', createdAt: '2026-10-21T15:00:00.000Z' },
    ]
    expect(groupDayEndSales(sales, 'previous_days', '2026-10-21T18:00:00.000Z')).toEqual([])
    const next = groupDayEndSales(sales, 'previous_days', '2026-10-22T06:00:00.000Z')
    expect(next).toHaveLength(1)
    expect(next[0].day).toBe('2026-10-21')
    expect(next[0].sales.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('Z gece yarısından sonra önceki günü kendi gününde tutar', () => {
    const sales = [
      { id: 'dun', createdAt: '2026-10-21T18:00:00.000Z' },
      { id: 'gece', createdAt: '2026-10-21T21:40:00.000Z' },
    ]
    const packs = groupDayEndSales(sales, 'z', '2026-10-21T21:30:00.000Z')
    expect(packs.map(p => p.day)).toEqual(['2026-10-21', '2026-10-22'])
    expect(packs[0].sales.map(s => s.id)).toEqual(['dun'])
    expect(packs[1].sales.map(s => s.id)).toEqual(['gece'])
  })

  it('200 satırı aşan günü birden fazla pakete böler', () => {
    const sales = Array.from({ length: 201 }, (_, i) => ({
      id: String(i),
      createdAt: `2026-10-21T${String(8 + Math.floor(i / 60)).padStart(2, '0')}:00:00.000Z`,
    }))
    const packs = groupDayEndSales(sales, 'z', '2026-10-21T20:00:00.000Z')
    expect(packs).toHaveLength(2)
    expect(packs[0].sales).toHaveLength(200)
    expect(packs[1].sales).toHaveLength(1)
    expect(packs.every(p => p.day === '2026-10-21')).toBe(true)
  })

  it('belge satır başlıklarını kurar', () => {
    expect(formatPerSaleInvoiceLabel(42)).toBe('Fatura — Satış 0042')
    expect(formatDayEndInvoiceLabel('2026-10-21', 37)).toBe('Gün sonu faturası — 21.10.2026 (37 satış)')
    expect(formatDayEndPaymentLabel({
      dayLabel: '21.10.2026',
      cashAmount: 4250,
      cardByBank: {
        g: { amount: 1200, acquirerName: 'Garanti' },
        z: { amount: 800, acquirerName: 'Ziraat' },
      },
    })).toBe('Tahsilat — Gün sonu 21.10.2026 · Nakit 4.250,00 · Garanti 1.200,00 · Ziraat 800,00')
  })
})

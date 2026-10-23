import { describe, expect, it } from 'vitest'
import { collectDayEndProblems, dayEndProgressCaption } from '../../src/lib/dayEndPrecheck'

describe('gün sonu ön kontrol', () => {
  it('carisiz satış torba kontrolü üretmez', () => {
    const problems = collectDayEndProblems({
      sales: [{ receiptNo: '7', customerName: 'Perakende', customerId: null, hasErp: false }],
      tenders: [],
      lines: [],
    })
    expect(problems).toEqual([])
  })

  it('cari, banka, diğer ödeme ve kalem sorunlarını birlikte listeler', () => {
    const problems = collectDayEndProblems({
      sales: [{ receiptNo: '42', customerName: 'Ahmet Yılmaz', customerId: 'c1', hasErp: false }],
      tenders: [
        { method: 'card', acquirerId: '62', acquirerName: 'Garanti', accountMatched: false },
        { method: 'meal_card', acquirerId: '9', acquirerName: 'Multinet', accountMatched: false },
        { method: 'cash', acquirerId: null, acquirerName: 'Nakit', accountMatched: false },
      ],
      lines: [{ receiptNo: '42', name: 'Ekmek', productCode: '', unit: 'Adet', vatRate: 1 }],
    })
    expect(problems.map(p => p.message)).toEqual([
      'Fiş 0042: Ahmet Yılmaz carisinin ERP kaydı yok.',
      'Garanti (62) için banka hesabı eşlenmemiş.',
      'Multinet için hesap eşlenmemiş.',
      'Nakit kasa hesabı eşlenmemiş.',
      "Fiş 0042: 'Ekmek' ürün kodu yok.",
    ])
  })

  it('ilerleme satırını gün ve sayı ile kurar', () => {
    expect(dayEndProgressCaption('21.10.2026 00:00 – 21.10.2026 15:30', 3, 5))
      .toBe('Gün sonu 21.10.2026 · 3/5 gönderildi')
  })
})

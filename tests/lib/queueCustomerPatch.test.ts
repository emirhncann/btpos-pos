import { describe, expect, it } from 'vitest'
import {
  applyCustomerPatch,
  formatCariLine,
  isTorbaCariError,
  queueCustomerKind,
  sameTorba,
} from '../../src/lib/queueCustomerPatch'

const body = {
  items: [{ product_code: 'P1', net_amount: 10 }],
  expected_total: 10,
  invoice_date: '2026-10-21 15:30:00',
  day_end_run_id: 'run-1',
  doc_key: 'retail:1',
  doc_kind: 'retail_invoice',
  customer_ref: { type: 'torba' },
  customer: { name: 'PERAKENDE MÜŞTERİ', code: '120.01.001' },
  customer_erp_id: 100,
}

describe('kuyruk cari yaması', () => {
  it('torba belgesinde cariyi merkezden yazar', () => {
    expect(formatCariLine(body)).toBe('Torba cari (merkezden)')
    expect(formatCariLine({
      doc_kind: 'customer_invoice',
      customer_ref: { type: 'customer', id: '9' },
      customer: { name: 'Ahmet', code: 'C1' },
    })).toBe('Ahmet · C1')
  })

  it('perakende ve cari belgelerini ayırır', () => {
    expect(queueCustomerKind('invoice', body)).toBe('torba')
    expect(queueCustomerKind('day_end_invoice', {})).toBe('torba')
    expect(queueCustomerKind('invoice', { doc_kind: 'customer_invoice' })).toBe('cari')
    expect(queueCustomerKind('return_invoice', { customer_ref: { type: 'customer', id: '9' } })).toBe('cari')
    expect(queueCustomerKind('payment', {})).toBe('other')
  })

  it('aynı kod ve işbaşı kimliğinde güncel sayar', () => {
    expect(sameTorba(body, { code: '120.01.001', erpId: 100 })).toBe(true)
    expect(sameTorba(body, { code: '120.01.050', erpId: 200 })).toBe(false)
    expect(sameTorba(body, { code: '120.01.001', erpId: 200 })).toBe(false)
  })

  it('yalnızca cari alanlarını değiştirir', () => {
    const next = applyCustomerPatch(body, {
      ref: { type: 'torba' },
      customer: { name: 'TORBA CARİ', code: '120.01.050', taxNo: '111' },
      customerErpId: 200,
      touchName: false,
    }, '120.01.001', '2026-10-22T06:58:00.000Z')
    expect(next.items).toEqual(body.items)
    expect(next.expected_total).toBe(10)
    expect(next.invoice_date).toBe(body.invoice_date)
    expect(next.day_end_run_id).toBe('run-1')
    expect(next.doc_key).toBe('retail:1')
    expect(next.customer_erp_id).toBe(200)
    expect((next._meta as { previous_customer_code: string }).previous_customer_code).toBe('120.01.001')
  })

  it('cari ve bulunamadı hatalarını torba şeridine alır', () => {
    expect(isTorbaCariError('TORBA_CARI_YOK: Torba cari tanımlı değil')).toBe(true)
    expect(isTorbaCariError('Cari yerel listede bulunamadı')).toBe(true)
    expect(isTorbaCariError('Ürün kodu eksik')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  computeBeforeAfter,
  newBalancePrintSession,
  onAccountAmount,
  schemaWantsCustomerBalance,
  shouldFetchCustomerBalance,
  templateUsesBalance,
} from '../../src/lib/customerBalance'
import { buildPdfmeInputs, formatPdfmeValue as formatValue } from '../../src/lib/templateEngine'

describe('cari bakiye hesabı', () => {
  it('tamamı peşin satılırsa eski ve yeni aynı kalır', () => {
    expect(onAccountAmount(500, 500)).toBe(0)
    const math = computeBeforeAfter({
      incoming: 1000,
      source: 'merkez',
      saleTotal: 500,
      paidTotal: 500,
      invoiceSent: false,
      paymentsSentTotal: 0,
    })
    expect(math.before).toBe(1000)
    expect(math.after).toBe(1000)
    expect(math.note).toBe('')
  })

  it('veresiye kısmı yeni bakiyeye eklenir', () => {
    const math = computeBeforeAfter({
      incoming: 1000,
      source: 'merkez',
      saleTotal: 500,
      paidTotal: 200,
      invoiceSent: false,
      paymentsSentTotal: 0,
    })
    expect(math.before).toBe(1000)
    expect(math.after).toBe(1300)
  })

  it('işbaşına gitmiş satış yeniden yazdırılınca çift sayılmaz', () => {
    const math = computeBeforeAfter({
      incoming: 1300,
      source: 'merkez',
      saleTotal: 500,
      paidTotal: 200,
      invoiceSent: true,
      paymentsSentTotal: 200,
    })
    expect(math.before).toBe(1000)
    expect(math.after).toBe(1300)
  })

  it('yerel kayıt not düşer ve etkiyi geri almaz', () => {
    const math = computeBeforeAfter({
      incoming: 400,
      source: 'kasa',
      saleTotal: 500,
      paidTotal: 200,
      invoiceSent: true,
      paymentsSentTotal: 200,
    })
    expect(math.before).toBe(400)
    expect(math.after).toBe(700)
    expect(math.note).toBe('(kasa kaydı, güncel olmayabilir)')
  })

  it('şablon metninde customer.balance aranır', () => {
    expect(schemaWantsCustomerBalance('{"text":"{customer.balance}"}')).toBe(true)
    expect(schemaWantsCustomerBalance('{"text":"{customers.balance_before}"}')).toBe(true)
    expect(schemaWantsCustomerBalance('{"text":"{customers.name}"}')).toBe(false)
    expect(templateUsesBalance({ schemas: [[{ text: '{customer.balance_after}' }]] })).toBe(true)
    expect(templateUsesBalance({ schemas: [[{ text: '{customers.name}' }]] })).toBe(false)
  })

  it('bakiye yalnızca bu şablon istiyorsa ve satışta henüz sorulmadıysa istenir', () => {
    const data = { customers: { id: '12', code: 'C00123' }, sales: { order_no: '001' } }
    const withField = { schema: '{"text":"{customer.balance}"}' }
    const without = { schema: '{"text":"{customers.name}"}' }
    const session = newBalancePrintSession()
    expect(shouldFetchCustomerBalance(data, without, session, null)).toBe(false)
    expect(shouldFetchCustomerBalance(data, withField, session, 'C00123')).toBe(false)
    expect(shouldFetchCustomerBalance({ customers: {} }, withField, session, null)).toBe(false)
    expect(shouldFetchCustomerBalance(data, withField, session, null)).toBe(true)
    session.fetched = true
    expect(shouldFetchCustomerBalance(data, withField, session, null)).toBe(false)
  })
})

describe('fiş değerleri', () => {
  it('undefined ve NaN boş basılır', () => {
    expect(formatValue(undefined)).toBe('')
    expect(formatValue(null)).toBe('')
    expect(formatValue(Number.NaN)).toBe('')
  })

  it('olmayan değişken boş kalır', () => {
    const inputs = buildPdfmeInputs(
      { customers: { name: 'Ali' } },
      [{ name: 'bakiye', type: 'text', text: 'Bakiye {customer.balance}' }],
    )
    const customer = inputs.customer as Record<string, string>
    expect(customer.balance).toBe('')
    expect(inputs.bakiye).toBe('Bakiye ')
  })
})

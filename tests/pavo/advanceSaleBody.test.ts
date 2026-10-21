import { describe, expect, it } from 'vitest'
import { buildPavoAdvanceSale, type PavoSettings } from '../../src/lib/pavoService'

const settings: PavoSettings = {
  ipAddress: '127.0.0.1',
  port: 4568,
  serialNo: 'PAV860085386',
  cardReadTimeout: 30,
  printWidth: '80mm',
}

function customer(partial: Partial<CustomerRow>): CustomerRow {
  return {
    id: '1',
    companyId: 'c',
    code: '120',
    name: 'EMİR TORBA CARİ',
    phone: '',
    taxNo: '2222222222',
    address: 'Bolu Merkez',
    balance: 0,
    isPerson: false,
    firstName: '',
    lastName: '',
    postalCode: '',
    city: 'Bolu',
    district: 'Bolu',
    type: 'corporate',
    ...partial,
  }
}

describe('buildPavoAdvanceSale', () => {
  it('kurumsal gövde referanstaki alanları taşır', () => {
    const built = buildPavoAdvanceSale({
      settings,
      seq: 8070,
      orderNo: '000260717102002',
      appVersion: '1.0.11',
      amount: 100,
      mediator: 2,
      customer: customer({}),
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.TransactionHandle.SerialNumber).toBe('PAV860085386')
    expect(built.body.TransactionHandle.TransactionSequence).toBe(8070)
    expect(built.body.TransactionHandle.TransactionDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/)
    expect(built.body.TransactionHandle.TransactionDate.endsWith('Z')).toBe(false)
    expect(built.body.Sale.RefererAppVersion).toBe('1.0.11')
    expect(built.body.Sale.TotalAmount).toBe(100)
    expect(built.body.Sale.SkipAmountCash).toBe(false)
    expect(built.body.Sale.CardReadTimeout).toBe(60)
    expect(built.body.Sale.PaymentInformations).toEqual([
      { Mediator: 2, Amount: 100, CurrencyCode: 'TRY', ExchangeRate: 1, IsVoid: false },
    ])
    expect(built.body.Sale.CustomerParty.CustomerType).toBe(2)
    expect(built.body.Sale.CustomerParty.CompanyName).toBe('EMİR TORBA CARİ')
    expect(built.body.Sale.CustomerParty.TaxNumber).toBe('2222222222')
    expect(JSON.stringify(built.body)).not.toMatch(/null/)
    expect(built.body.Sale).not.toHaveProperty('BottomPrintableItems')
  })

  it('boş ilçe ve adresi il ile doldurur, eksik vergi no gövde üretmez', () => {
    const filled = buildPavoAdvanceSale({
      settings,
      seq: 1,
      orderNo: '001261021094600',
      appVersion: '1.0.11',
      amount: 10.005,
      mediator: 1,
      customer: customer({
        district: '',
        address: '',
        city: '',
      }),
      workplaceCity: 'Bolu',
    })
    expect(filled.ok).toBe(true)
    if (!filled.ok) return
    expect(filled.body.Sale.TotalAmount).toBe(10.01)
    expect(filled.body.Sale.CustomerParty.City).toBe('Bolu')
    expect(filled.body.Sale.CustomerParty.District).toBe('Bolu')
    expect(filled.body.Sale.CustomerParty.Address).toBe('Bolu Merkez')
    expect(filled.body.Sale.PaymentInformations[0].Mediator).toBe(1)
    expect(filled.body.Sale.SkipAmountCash).toBe(true)

    const missing = buildPavoAdvanceSale({
      settings,
      seq: 1,
      orderNo: '001261021094600',
      appVersion: '1.0.11',
      amount: 10,
      mediator: 2,
      customer: customer({ taxNo: '' }),
    })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.message).toContain('vergi/TC')
  })

  it('bireysel caride ad ve soyadı ayırır', () => {
    const built = buildPavoAdvanceSale({
      settings,
      seq: 2,
      orderNo: '001261021094601',
      appVersion: '1.0.11',
      amount: 50,
      mediator: 2,
      customer: customer({
        name: 'Ahmet Yılmaz',
        type: 'individual',
        isPerson: true,
        taxNo: '10000000146',
        firstName: '',
        lastName: '',
      }),
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.Sale.CustomerParty.CustomerType).toBe(1)
    expect(built.body.Sale.CustomerParty.FirstName).toBe('Ahmet')
    expect(built.body.Sale.CustomerParty.FamilyName).toBe('Yılmaz')
    expect(built.body.Sale.CustomerParty.CompanyName).toBe('')
  })
})

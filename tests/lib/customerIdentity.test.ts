import { describe, expect, it } from 'vitest'
import {
  customerPatchRequest,
  customerPayload,
  formsEqual,
  isValidTckn,
  isValidVkn,
  mapServerFields,
  prefillFromQuery,
  snapshotOf,
  splitPersonName,
  validateCustomerForm,
  emptyForm,
} from '../../src/lib/customerIdentity'

describe('müşteri kimlik', () => {
  it('TCKN ve VKN örnekleri', () => {
    expect(isValidTckn('10000000146')).toBe(true)
    expect(isValidTckn('10000000140')).toBe(false)
    expect(isValidVkn('1234567890')).toBe(true)
    expect(isValidVkn('1234567891')).toBe(false)
  })

  it('bireyselde ad ve soyad zorunlu, boş soyad istekten önce kesilir', () => {
    const bad = validateCustomerForm({
      ...emptyForm(),
      first_name: 'Ahmet',
      last_name: '  ',
      tax_number: '10000000146',
    })
    expect(bad.errors.last_name).toBeTruthy()
    expect(bad.errors.first_name).toBeUndefined()
  })

  it('kurumsal vergi dairesi boşsa kaydı keser, VKN uyarısı kesmez', () => {
    const bad = validateCustomerForm({
      ...emptyForm(),
      type: 'corporate',
      name: 'Bolu Gıda',
      tax_number: '1234567891',
      tax_office: '',
    })
    expect(bad.errors.tax_office).toBeTruthy()
    expect(bad.vknWarning).toContain('kontrol hanesi')
    const warn = validateCustomerForm({
      ...emptyForm(),
      type: 'corporate',
      name: 'Bolu Gıda',
      tax_number: '1234567891',
      tax_office: 'Bolu',
    })
    expect(warn.errors.tax_number).toBeUndefined()
    expect(warn.vknWarning).toContain('kontrol hanesi')
  })

  it('kurumsal vergi no boş veya 10 hane değilse hata', () => {
    const base = { ...emptyForm(), type: 'corporate' as const, name: 'Bolu Gıda', tax_office: 'Bolu' }
    expect(validateCustomerForm(base).errors.tax_number).toBeTruthy()
    expect(validateCustomerForm({ ...base, tax_number: '123' }).errors.tax_number).toBeTruthy()
  })

  it('rakam araması vergi veya telefona, ad araması ad ve soyada yazılır', () => {
    expect(prefillFromQuery('Ahmet Yılmaz').first_name).toBe('Ahmet')
    expect(prefillFromQuery('Ahmet Yılmaz').last_name).toBe('Yılmaz')
    expect(prefillFromQuery('10000000146').tax_number).toBe('10000000146')
    expect(prefillFromQuery('05321234567').phone).toBe('05321234567')
    expect(prefillFromQuery('1234567890').type).toBe('corporate')
    expect(prefillFromQuery('1234567890').tax_number).toBe('1234567890')
  })

  it('son kelime soyad olur', () => {
    expect(splitPersonName('Ahmet Ali Yılmaz')).toEqual({ first_name: 'Ahmet Ali', last_name: 'Yılmaz' })
  })

  it('gövde tax_number ve bireysel adı birlikte taşır', () => {
    const payload = customerPayload({
      ...emptyForm(),
      first_name: 'Ahmet',
      last_name: 'Yılmaz',
      tax_number: '10000000146',
      name: 'eski unvan',
    }, 'k1')
    expect(payload.type).toBe('individual')
    expect(payload.first_name).toBe('Ahmet')
    expect(payload.last_name).toBe('Yılmaz')
    expect(payload.name).toBe('Ahmet Yılmaz')
    expect(payload.tax_number).toBe('10000000146')
    expect(payload.tax_office).toBe('')
    const corp = customerPayload({
      ...emptyForm(),
      type: 'corporate',
      name: 'Bolu Gıda',
      first_name: 'Ahmet',
      tax_number: '1234567890',
      tax_office: 'Bolu',
    }, 'k1')
    expect(corp.first_name).toBe('')
    expect(corp.name).toBe('Bolu Gıda')
    expect(corp.tax_number).toBe('1234567890')
    expect(corp.tax_office).toBe('Bolu')
  })

  it('tür değişince vergi numarası formda kalır', () => {
    const withVkn = { ...emptyForm(), tax_number: '1234567890' }
    const corporate = { ...withVkn, type: 'corporate' as const }
    expect(corporate.tax_number).toBe('1234567890')
    expect(formsEqual(withVkn, { ...withVkn })).toBe(true)
  })

  it('düzenleme yolu İşbaşı id ve before taşır', () => {
    const before = snapshotOf({
      name: 'Ahmet Yılmaz', firstName: 'Ahmet', lastName: 'Yılmaz', taxNo: '10000000146', type: 'individual',
    })
    const req = customerPatchRequest('88421', {
      ...emptyForm(),
      first_name: 'Ahmet',
      last_name: 'Yılmaz',
      tax_number: '10000000146',
    }, 'k1', before)
    expect(req.path).toBe('/pos/customers/88421')
    expect(req.payload.erp_id).toBe('88421')
    expect(req.payload.before).toEqual(before)
    expect(req.payload.tax_number).toBe('10000000146')
    expect(customerPatchRequest('', emptyForm(), 'k1', null).path).toBe('/pos/customers/')
    expect(customerPatchRequest('', emptyForm(), 'k1', null).payload.erp_id).toBeNull()
  })

  it('slim hataları alan adlarına yazılır', () => {
    expect(mapServerFields({ last_name: 'Soyad zorunlu', tax_number: ['VKN geçersiz'] })).toEqual({
      last_name: 'Soyad zorunlu',
      tax_number: 'VKN geçersiz',
    })
  })
})

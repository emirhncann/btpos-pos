import { describe, it, expect } from 'vitest'
import {
  normalizeBarcodeFormatRow,
  parseBarcodeFormatsResponse,
  parseBarcodeEAN13,
  matchProductByInternalBarcode,
} from '../../src/lib/barcodeFormat'

const weightedFormat29: BarcodeFormatRow = {
  id: '1',
  company_id: 'c1',
  terminal_id: 't1',
  flag_code: 29,
  type: 'weighted',
  integer_length: 2,
  decimal_length: 3,
  decimal_multiplier: 1,
  minimum_value: 1,
  is_active: true,
  label: 'Tartılı',
}

describe('parseBarcodeFormatsResponse', () => {
  it('camelCase API yanıtını normalize eder', () => {
    const rows = parseBarcodeFormatsResponse([{
      id: '1',
      companyId: 'c1',
      terminalId: 't1',
      flagCode: 29,
      type: 'weighted',
      integerLength: 2,
      decimalLength: 3,
      decimalMultiplier: 1,
      minimumValue: 1,
      isActive: true,
      label: 'Tartılı',
    }])
    expect(rows).toHaveLength(1)
    expect(rows[0].flag_code).toBe(29)
    expect(rows[0].integer_length).toBe(2)
  })

  it('data sarmalayıcısını açar', () => {
    const rows = parseBarcodeFormatsResponse({
      data: [{ id: '1', flag_code: 20, type: 'counted', is_active: 1 }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].flag_code).toBe(20)
  })
})

describe('parseBarcodeEAN13', () => {
  it('2901005003127 → ürün 01005, miktar 0.312', () => {
    const parsed = parseBarcodeEAN13('2901005003127', [weightedFormat29])
    expect(parsed).not.toBeNull()
    expect(parsed!.productBarcode).toBe('01005')
    expect(parsed!.quantity).toBeCloseTo(0.312)
  })

  it('format yoksa null döner', () => {
    expect(parseBarcodeEAN13('2901005003127', [])).toBeNull()
  })
})

describe('matchProductByInternalBarcode', () => {
  const products: ProductRow[] = [{
    id: 'p1',
    name: 'Elma',
    barcode: '1005',
    code: 'URN-1005',
    price: 10,
    vatRate: 1,
    unit: 'KG',
    stock: 1,
    syncedAt: '',
  }]

  it('baştaki sıfırları yok sayarak eşleşir', () => {
    expect(matchProductByInternalBarcode(products, '01005')?.id).toBe('p1')
  })
})

describe('normalizeBarcodeFormatRow', () => {
  it('snake_case alanları korur', () => {
    const row = normalizeBarcodeFormatRow({
      id: 'x',
      company_id: 'c',
      terminal_id: 't',
      flag_code: 29,
      type: 'weighted',
      integer_length: 2,
      decimal_length: 3,
      decimal_multiplier: 1,
      minimum_value: 1,
      is_active: 1,
      label: null,
    })
    expect(row.flag_code).toBe(29)
    expect(row.is_active).toBe(true)
  })
})

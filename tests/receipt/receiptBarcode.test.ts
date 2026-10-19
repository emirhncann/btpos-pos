import { describe, expect, it } from 'vitest'
import { applyAutoBarcodeFields } from '../../src/lib/receiptBarcode'

describe('fiş barkodu otomatik tür', () => {
  it('ürün barkodu ve sipariş no Code128 aynı otomatik seçime bağlanır', () => {
    const schemas = [[
      { name: 'productBarcode', type: 'ean13', content: '{sale_items.barcode}' },
      { name: 'orderNo', type: 'code128', content: '{sales.barcode}' },
      { name: 'qr', type: 'qrcode', content: '{sales.order_no}' },
      { name: 'title', type: 'text', content: 'Fiş' },
    ]]
    applyAutoBarcodeFields(schemas)
    expect(schemas[0][0]).toMatchObject({ type: 'btposBarcodeAuto', barcodeSymbology: 'auto', content: '{sale_items.barcode}' })
    expect(schemas[0][1]).toMatchObject({ type: 'btposBarcodeAuto', barcodeSymbology: 'auto', content: '{sales.barcode}' })
    expect(schemas[0][2]).toMatchObject({ type: 'qrcode' })
    expect(schemas[0][3]).toMatchObject({ type: 'text', content: 'Fiş' })
  })
})

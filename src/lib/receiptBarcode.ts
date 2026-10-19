/**
 * Fiş şablonundaki çizgisel barkod alanları, PDFME'nin otomatik tür seçimini kullanır.
 * Fiş verisindeki barkod metni değişmez; yalnızca basılacak semboloji seçilir.
 */

const LEGACY_LINEAR = new Set([
  'ean13',
  'ean8',
  'upca',
  'upce',
  'code128',
  'code39',
])

export function applyAutoBarcodeFields(schemas: Array<Array<Record<string, unknown>>>): void {
  for (const page of schemas) {
    for (const field of page) {
      const type = String(field.type ?? '')
      if (!LEGACY_LINEAR.has(type)) continue
      field.type = 'btposBarcodeAuto'
      field.barcodeSymbology = 'auto'
    }
  }
}

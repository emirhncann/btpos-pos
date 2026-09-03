export function normalizeBarcodeFormatRow(raw: Record<string, unknown>): BarcodeFormatRow {
  const isActiveRaw = raw.is_active ?? raw.isActive
  return {
    id:                 String(raw.id ?? ''),
    company_id:         String(raw.company_id ?? raw.companyId ?? ''),
    terminal_id:        String(raw.terminal_id ?? raw.terminalId ?? ''),
    flag_code:          Number(raw.flag_code ?? raw.flagCode ?? 0),
    type:               String(raw.type ?? 'counted') as BarcodeFormatRow['type'],
    integer_length:     Number(raw.integer_length ?? raw.integerLength ?? 0),
    decimal_length:     Number(raw.decimal_length ?? raw.decimalLength ?? 0),
    decimal_multiplier: Number(raw.decimal_multiplier ?? raw.decimalMultiplier ?? 1),
    minimum_value:      Number(raw.minimum_value ?? raw.minimumValue ?? 1),
    is_active:          isActiveRaw === undefined ? true : Boolean(isActiveRaw),
    label:              raw.label != null ? String(raw.label) : null,
  }
}

export function parseBarcodeFormatsResponse(json: unknown): BarcodeFormatRow[] {
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown })?.data)
      ? (json as { data: unknown[] }).data
      : Array.isArray((json as { items?: unknown })?.items)
        ? (json as { items: unknown[] }).items
        : []

  return list
    .map(item => normalizeBarcodeFormatRow(item as Record<string, unknown>))
    .filter(f => f.flag_code >= 20 && f.flag_code <= 29 && f.is_active)
}

function normalizeBarcodeKey(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.replace(/^0+/, '') || '0'
}

export function matchProductByInternalBarcode(
  products: ProductRow[],
  code: string,
): ProductRow | undefined {
  const trimmed = code.trim()
  const norm = normalizeBarcodeKey(trimmed)
  if (!norm) return undefined

  return products.find(p => {
    for (const field of [p.barcode, p.code]) {
      const v = (field ?? '').trim()
      if (!v) continue
      if (v === trimmed || normalizeBarcodeKey(v) === norm) return true
    }
    return false
  })
}

export function parseBarcodeEAN13(
  barcode: string,
  formats: BarcodeFormatRow[],
): {
  productBarcode: string
  quantity:       number
  isWeighted:     boolean
  format:         BarcodeFormatRow
} | null {
  if (barcode.length !== 13) return null

  const flagCode = parseInt(barcode.slice(0, 2), 10)
  if (flagCode < 20 || flagCode > 29) return null

  const format = formats.find(f => Number(f.flag_code) === flagCode)
  if (!format) return null

  const productBarcode = barcode.slice(2, 7)
  const quantityStr = barcode.slice(7, 12)

  let quantity: number
  if (format.type === 'counted' || format.decimal_length === 0) {
    quantity = parseInt(quantityStr, 10)
  } else {
    const intPart = parseInt(quantityStr.slice(0, format.integer_length), 10)
    const decPart = parseInt(quantityStr.slice(format.integer_length), 10)
    quantity = intPart + (decPart * format.decimal_multiplier) / 1000
  }

  // Tartılı: minimum_value ham miktar alanına (ör. gram) göre; adetli: parse edilmiş miktara göre
  const minCheck = format.type === 'weighted'
    ? parseInt(quantityStr, 10)
    : quantity
  if (minCheck < format.minimum_value) return null

  return {
    productBarcode,
    quantity,
    isWeighted: format.type === 'weighted',
    format,
  }
}

/** Şablon blokları ve yazdırma davranışı — renderer + main paylaşımı (tipler) */

export type PrintBehavior = 'default' | 'ask' | 'none'

export type TemplateBlockType =
  | 'text'
  | 'variable'
  | 'divider'
  | 'space'
  | 'logo'
  | 'barcode'

export interface TemplateBlock {
  id:     string
  type:   TemplateBlockType
  value?: string
  key?:   string
  label?: string
  align?: 'left' | 'center' | 'right'
  bold?:  boolean
  char?:  string
}

export type RenderData = Record<string, Record<string, unknown>>

const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg);base64,/i

export interface SaleReceiptCartItem {
  code:           string
  name:           string
  price:          number
  vatRate:        number
  unit:           string
  quantity:       number
  lineTotal:      number
  discountRate:   number
  discountAmount: number
  netTotal:       number
  barcode?:       string
}

export interface SaleReceiptCustomer {
  id?:       string
  code?:     string
  name?:     string
  phone?:    string
  taxNo?:    string
  address?:  string
  city?:     string
  district?: string
  email?:    string | null
  balance?:  number
}

export interface SaleReceiptPaymentLine {
  method:       'cash' | 'card' | 'meal_card' | 'other'
  amount:       number
  acquirerName?: string | null
}

/** product-list kolon sırası: [name, qty, price, discount, total, vat_rate, unit] */
export const SALE_ITEM_KEYS = [
  'name', 'qty', 'price', 'discount', 'total', 'vat_rate', 'unit',
] as const

function fmtItemDecimal(n: number): string {
  return n.toFixed(2)
}

function itemDiscountPct(c: SaleReceiptCartItem): string {
  if (c.discountRate > 0) return String(c.discountRate)
  const brut = c.price * c.quantity
  if (brut <= 0 || c.netTotal >= brut) return '0'
  return String(Math.round(((brut - c.netTotal) / brut) * 10000) / 100)
}

/** Sepet → product-list satır dizisi */
export function buildSaleItemRows(cart: SaleReceiptCartItem[]): string[][] {
  return cart.map(c => [
    c.name,
    String(c.quantity),
    fmtItemDecimal(c.price),
    itemDiscountPct(c),
    fmtItemDecimal(c.netTotal),
    String(c.vatRate),
    c.unit,
  ])
}

export function mapSaleItemsForColumns(
  rows: string[][],
  columns: Array<{ key: string; visible?: boolean }>,
): string[][] {
  const visibleKeys = columns.filter(c => c.visible !== false).map(c => c.key)
  return rows.map(row => {
    const byKey: Record<string, string> = {}
    SALE_ITEM_KEYS.forEach((k, i) => { byKey[k] = row[i] ?? '' })
    return visibleKeys.map(k => byKey[k] ?? '')
  })
}

export interface SaleReceiptWorkplace {
  name?:       string | null
  address?:    string | null
  phone?:      string | null
  city?:       string | null
  district?:   string | null
  taxOffice?:  string | null
  taxNo?:      string | null
}

export interface SaleReceiptInput {
  receiptNo:             string
  orderNo?:              string
  companyId:             string
  cashier:               { id: string; fullName: string }
  cart:                  SaleReceiptCartItem[]
  paymentType:           'cash' | 'card' | 'mixed'
  paymentLabel:          string
  cashAmount:            number
  cardAmount:            number
  paidAmount:            number
  docDiscountRate:       number
  docDiscountAmount:     number
  customer?:             SaleReceiptCustomer | null
  terminalId?:           string
  terminalName?:         string
  terminalNumber?:       string | null
  workplace?:            SaleReceiptWorkplace
  planName?:             string
  createdAt?:            string
  changeAmount?:         number
  paymentLines?:         SaleReceiptPaymentLine[]
  firstCardAcquirerName?: string
}

function calcVatBreakdown(
  cart: SaleReceiptCartItem[],
  lineSubtotal: number,
  grandTotal: number,
): { sale_vat: Record<string, string>; totalVat: number } {
  const ratio = lineSubtotal > 0 ? grandTotal / lineSubtotal : 1
  const buckets = new Map<number, { base: number; vat: number }>()

  for (const c of cart) {
    const vat = c.netTotal * c.vatRate / (100 + c.vatRate)
    const base = c.netTotal - vat
    const prev = buckets.get(c.vatRate) ?? { base: 0, vat: 0 }
    buckets.set(c.vatRate, { base: prev.base + base, vat: prev.vat + vat })
  }

  const sale_vat: Record<string, string> = {}
  let totalVat = 0

  for (const [rate, { base, vat }] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const adjBase = parseFloat((base * ratio).toFixed(2))
    const adjVat = parseFloat((vat * ratio).toFixed(2))
    totalVat += adjVat
    sale_vat[`rate_${rate}`] = formatPdfmeValue(adjVat)
    sale_vat[`base_${rate}`] = formatPdfmeValue(adjBase)
  }

  sale_vat.total = formatPdfmeValue(parseFloat(totalVat.toFixed(2)))
  return { sale_vat, totalVat: parseFloat(totalVat.toFixed(2)) }
}

/** Satış fişi — tüm şablon değişkenleri (KDV kırılımı dahil) */
export function buildSaleReceiptData(input: SaleReceiptInput): RenderData {
  const fmt = formatPdfmeValue
  const cart = input.cart

  const grossAmount = cart.reduce((s, c) => s + c.price * c.quantity, 0)
  const totalQty = cart.reduce((s, c) => s + c.quantity, 0)
  const lineDiscount = cart.reduce((s, c) => {
    const brut = c.price * c.quantity
    const lt = c.lineTotal ?? brut
    return s + Math.max(0, lt - c.netTotal)
  }, 0)
  const lineSubtotal = cart.reduce((s, c) => s + c.netTotal, 0)
  const docDiscount = input.docDiscountAmount
  const grandTotal = Math.max(0, parseFloat((lineSubtotal - docDiscount).toFixed(2)))
  const totalDiscount = lineDiscount + docDiscount
  const { sale_vat, totalVat } = calcVatBreakdown(cart, lineSubtotal, grandTotal)
  const createdAt = input.createdAt ?? new Date().toLocaleString('tr-TR')
  const customer = input.customer

  const paymentMethodLabel = (m: SaleReceiptPaymentLine['method']) =>
    m === 'cash' ? 'Nakit' : m === 'card' ? 'Kart' : m === 'meal_card' ? 'Yemek Kartı' : 'Diğer'

  const paymentsList = (input.paymentLines ?? []).map(p => [
    paymentMethodLabel(p.method),
    fmt(p.amount),
    p.acquirerName ?? '',
  ])

  const itemRows = buildSaleItemRows(cart)

  return {
    sale_items: {
      rows: itemRows,
    },
    sales: {
      receipt_no:           input.receiptNo,
      order_no:             input.orderNo ?? input.receiptNo,
      created_at:           createdAt,
      gross_amount:         grossAmount,
      subtotal_amount:      lineSubtotal,
      total_amount:         lineSubtotal,
      line_discount_amount: lineDiscount,
      discount_rate:        input.docDiscountRate,
      discount_amount:      docDiscount,
      total_discount_amount: totalDiscount,
      net_amount:           grandTotal,
      vat_amount:           totalVat,
      payment_type:         input.paymentLabel,
      cash_amount:          input.cashAmount,
      card_amount:          input.cardAmount,
      paid_amount:          input.paidAmount,
      change_amount:        input.changeAmount ?? 0,
      item_count:           cart.length,
      total_quantity:       totalQty,
      customer_name:        customer?.name ?? '',
      customer_code:        customer?.code ?? '',
      cashier_name:         input.cashier.fullName,
    },
    sale_vat,
    customers: customer
      ? {
          name:     customer.name ?? '',
          code:     customer.code ?? '',
          phone:    customer.phone ?? '',
          tax_no:   customer.taxNo ?? '',
          address:  customer.address ?? '',
          city:     customer.city ?? '',
          district: customer.district ?? '',
          email:    customer.email ?? '',
          balance:  customer.balance ?? 0,
        }
      : {},
    cashiers: {
      full_name:    input.cashier.fullName,
      cashier_code: input.cashier.id,
    },
    workplaces: {
      name:       input.workplace?.name ?? '',
      address:    input.workplace?.address ?? '',
      phone:      input.workplace?.phone ?? '',
      city:       input.workplace?.city ?? '',
      district:   input.workplace?.district ?? '',
      tax_office: input.workplace?.taxOffice ?? '',
      tax_no:     input.workplace?.taxNo ?? '',
    },
    terminals: {
      name:             input.terminalName ?? '',
      terminal_number:  input.terminalNumber ?? '',
    },
    activation: {
      terminal_id: input.terminalId ?? '',
      company_id:  input.companyId,
      plan_name:   input.planName ?? '',
    },
    sale_payments: {
      method:        input.paymentLabel,
      amount:        grandTotal,
      cash_amount:   input.cashAmount,
      card_amount:   input.cardAmount,
      acquirer_name: input.firstCardAcquirerName ?? '',
      payments:      JSON.stringify(paymentsList),
    },
  }
}

export function formatPdfmeValue(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'number') {
    return val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return String(val)
}

/** RenderData → düz değişken haritası (ESC/POS ve multiVariableText için) */
export function flattenRenderData(data: RenderData): Record<string, string> {
  const flat: Record<string, string> = {}

  for (const [table, cols] of Object.entries(data)) {
    if (!cols || typeof cols !== 'object' || Array.isArray(cols)) continue

    if (table === 'sale_items') {
      const bag = cols as Record<string, unknown>
      const rows = bag.rows ?? cols
      if (typeof rows === 'string') flat.sale_items = rows
      else if (Array.isArray(rows)) flat.sale_items = JSON.stringify(rows)
      continue
    }

    for (const [col, val] of Object.entries(cols)) {
      flat[`${table}.${col}`] = formatPdfmeValue(val)
    }
  }

  if (!flat['sales.cashier_name'] && data.cashiers?.full_name != null) {
    flat['sales.cashier_name'] = formatPdfmeValue(data.cashiers.full_name)
  }
  if (!flat['sales.customer_name'] && data.customers?.name != null) {
    flat['sales.customer_name'] = formatPdfmeValue(data.customers.name)
  }

  return flat
}

/** {sales.receipt_no} → gerçek değer */
export function resolveTemplateVariables(
  template: string,
  data: RenderData,
): string {
  const flat = flattenRenderData(data)
  return template.replace(/\{([^{}]+)\}/g, (match, key: string) => {
    const k = key.trim()
    const val = flat[k]
    return val !== undefined && val !== '' ? val : match
  })
}

type PdfmeSchemaField = {
  name: string
  type?: string
  content?: string
  text?: string
  columns?: Array<{ key: string; label?: string; visible?: boolean; widthPct?: number }>
}

function saleItemsJson(data: RenderData): string | undefined {
  const bag = data.sale_items
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return undefined
  const rows = (bag as Record<string, unknown>).rows ?? bag
  if (typeof rows === 'string') return rows
  if (Array.isArray(rows)) return JSON.stringify(rows)
  return undefined
}

function bindListField(
  field: PdfmeSchemaField,
  data: RenderData,
  flat: Record<string, string>,
): string | undefined {
  const raw = saleItemsJson(data) ?? flat.sale_items
  if (!raw) return undefined

  if (field.type === 'product-list' && field.columns?.length) {
    try {
      const rows = JSON.parse(raw) as string[][]
      return JSON.stringify(mapSaleItemsForColumns(rows, field.columns))
    } catch {
      return raw
    }
  }

  return raw
}

function fieldTemplateText(field: PdfmeSchemaField): string {
  return field.text ?? field.content ?? ''
}

/** RenderData → pdfme context (iç içe nesneler; {sales.cashier_name} MemberExpression için) */
export function buildNestedPdfmeContext(data: RenderData): Record<string, unknown> {
  const ctx: Record<string, unknown> = {}

  for (const [table, cols] of Object.entries(data)) {
    if (!cols || typeof cols !== 'object' || Array.isArray(cols)) continue

    if (table === 'sale_items') {
      const bag = cols as Record<string, unknown>
      const rows = bag.rows ?? cols
      if (typeof rows === 'string') ctx.sale_items = rows
      else if (Array.isArray(rows)) ctx.sale_items = JSON.stringify(rows)
      continue
    }

    const nested: Record<string, string> = {}
    for (const [col, val] of Object.entries(cols)) {
      nested[col] = formatPdfmeValue(val)
    }
    ctx[table] = nested
  }

  const sales = ctx.sales as Record<string, string> | undefined
  const cashiers = ctx.cashiers as Record<string, string> | undefined
  const customers = ctx.customers as Record<string, string> | undefined

  if (sales && cashiers && !sales.cashier_name && cashiers.full_name) {
    sales.cashier_name = cashiers.full_name
  }
  if (sales && customers && !sales.customer_name && customers.name) {
    sales.customer_name = customers.name
  }

  return ctx
}

/**
 * pdfme generate() inputs.
 * - İç içe nesneler: {sales.cashier_name} → inputs[0].sales.cashier_name
 * - sale_items: düz JSON string (tablo alanı)
 * - text (readOnly değil): inputs[field.name] = çözülmüş metin
 * - multiVariableText: inputs[field.name] = düz değişken JSON'u
 */
export function buildPdfmeInputs(
  data: RenderData,
  schema: PdfmeSchemaField[] = [],
): Record<string, unknown> {
  const flat = flattenRenderData(data)
  const inputs: Record<string, unknown> = buildNestedPdfmeContext(data)

  for (const field of schema) {
    const t = field.type ?? 'text'

    if (t === 'image') {
      const fromData = data[field.name]?.['content'] ?? data[field.name]?.['image']
      if (typeof fromData === 'string' && DATA_IMAGE_RE.test(fromData)) {
        inputs[field.name] = fromData
        continue
      }
      const raw = field.content ?? ''
      if (DATA_IMAGE_RE.test(raw)) inputs[field.name] = raw
      continue
    }

    if (t === 'table' || t === 'product-list') {
      const bound = bindListField(field, data, flat)
      if (bound) inputs[field.name] = bound
      continue
    }

    if (t === 'multiVariableText') {
      inputs[field.name] = JSON.stringify(flat)
      continue
    }

    if (t === 'text' || t === '') {
      const tpl = fieldTemplateText(field)
      if (tpl.includes('{')) {
        inputs[field.name] = resolveTemplateVariables(tpl, data)
      } else if (tpl) {
        inputs[field.name] = tpl
      }
    }
  }

  return inputs
}

function extractTemplateVar(content: string | undefined): string | null {
  if (!content) return null
  const m = content.match(/\{([^{}]+)\}/)
  if (!m) return null
  const key = m[1].trim()
  return key.includes('.') ? key.split('.')[0] : key
}

/** pdfme şablonu PDF üretimi gerektiriyor mu (görsel veya dinamik tablo) */
export function templateNeedsPdfPipeline(templateJson: unknown): boolean {
  const t = templateJson as { schemas?: { type?: string; content?: string }[][] }
  const fields = t.schemas?.[0] ?? []
  return fields.some(
    f =>
      f.type === 'table'
      || f.type === 'product-list'
      || (f.type === 'image'
        && typeof f.content === 'string'
        && DATA_IMAGE_RE.test(f.content)),
  )
}

export type PrintBehaviorMap = Record<string, PrintBehavior>

export const DEFAULT_PRINT_BEHAVIOR: PrintBehaviorMap = {
  satis:    'ask',
  tahsilat: 'ask',
  odeme:    'ask',
  iade:     'ask',
  gunsonu:  'default',
  etiket:   'none',
  manuel:   'none',
}

/** SQLite'ta print_behavior yokken kullanılır */
export const FALLBACK_PRINT_BEHAVIOR: PrintBehaviorMap = {
  satis:    'ask',
  tahsilat: 'ask',
  odeme:    'ask',
  iade:     'ask',
  gunsonu:  'default',
  etiket:   'none',
  manuel:   'none',
}

export function resolvePrintBehavior(raw: string | null | undefined): PrintBehaviorMap {
  if (!raw) return { ...FALLBACK_PRINT_BEHAVIOR }
  try {
    return normalizePrintBehavior(JSON.parse(raw))
  } catch {
    return { ...FALLBACK_PRINT_BEHAVIOR }
  }
}

export function normalizePrintBehavior(raw: unknown): PrintBehaviorMap {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PRINT_BEHAVIOR }
  const o = raw as Record<string, unknown>
  const out = { ...DEFAULT_PRINT_BEHAVIOR }
  for (const key of Object.keys(DEFAULT_PRINT_BEHAVIOR)) {
    const v = o[key]
    if (v === 'default' || v === 'ask' || v === 'none') {
      out[key] = v
    }
  }
  return out
}

export function parseTemplateSchema(raw: unknown): TemplateBlock[] {
  if (Array.isArray(raw)) return raw as TemplateBlock[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? (parsed as TemplateBlock[]) : []
    } catch {
      return []
    }
  }
  return []
}

export interface TemplateVariableDef {
  key:  string
  desc: string
}

export interface TemplateVariableGroup {
  label:   string
  trigger: string
  vars:    TemplateVariableDef[]
}

/** Şablon editörü — değişken havuzu */
export const TEMPLATE_VARIABLE_GROUPS: TemplateVariableGroup[] = [
  {
    label: 'Şube',
    trigger: 'all',
    vars: [
      { key: 'workplaces.name',           desc: 'Şube Adı' },
      { key: 'workplaces.address',        desc: 'Şube Adresi' },
      { key: 'workplaces.phone',          desc: 'Şube Telefonu' },
      { key: 'workplaces.tax_office',     desc: 'Vergi Dairesi' },
      { key: 'workplaces.tax_no',         desc: 'VKN/TCKN' },
      { key: 'terminals.terminal_number', desc: 'Kasa Numarası' },
    ],
  },
]

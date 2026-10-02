/** Kasa ve kasiyer ayarları. İki nesne birleştirilmez. */

export interface TerminalInfo {
  terminalName?: string
  terminalNumber?: string
  workplace?: Record<string, string>
}

export interface TerminalSettings {
  touchKeyboard: boolean
  customerDisplay: boolean
  invoiceType: 'e_archive' | 'paper'
  torbaCariId: string | null
  torbaCariName: string | null
  cariPaymentUsePavo: boolean
  enabledPaymentBrands: number[]
  loginWithCode: boolean
  loginWithCard: boolean
  defaultTemplateIds: Record<string, string>
  terminalInfo: TerminalInfo
  devtoolsEnabled: boolean
  devtoolsExpiresAt: string | null
}

export interface CashierSettings {
  duplicateItemAction: 'increase_qty' | 'add_new'
  minQtyPerLine: number
  allowExitWithHeldDocs: boolean
  allowLineDiscount: boolean
  maxLineDiscountPct: number
  allowDocDiscount: boolean
  maxDocDiscountPct: number
  pluCols: number
  pluRows: number
  fontSizeName: number
  fontSizePrice: number
  fontSizeCode: number
  showPrice: boolean
  showCode: boolean
  showBarcode: boolean
  printBehavior: Record<string, string>
}

export interface PaymentAccountCache {
  id: string
  paymentType: string
  pavoAcquirerId: string | null
  isbasiAccountCode: string
  isbasiAccountName: string
  isbasiAccountType: number
  isbasiAccountId: string | null
  isDefault: boolean
}

export interface SettingsBundle {
  terminal: TerminalSettings
  cashiers: Array<CashierSettings & { cashierId: string }>
  paymentAccounts: PaymentAccountCache[]
  /** null: yanıtta yok, mevcut barkod tablosuna dokunulmaz */
  barcodeFormats: Array<Record<string, unknown>> | null
}

export const DEFAULT_PRINT_BEHAVIOR: Record<string, string> = {
  satis: 'ask',
  tahsilat: 'ask',
  odeme: 'ask',
  iade: 'ask',
  gunsonu: 'default',
  etiket: 'none',
  manuel: 'none',
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  touchKeyboard: true,
  customerDisplay: false,
  invoiceType: 'e_archive',
  torbaCariId: null,
  torbaCariName: null,
  cariPaymentUsePavo: false,
  enabledPaymentBrands: [],
  loginWithCode: true,
  loginWithCard: false,
  defaultTemplateIds: {},
  terminalInfo: {},
  devtoolsEnabled: false,
  devtoolsExpiresAt: null,
}

export const DEFAULT_CASHIER_SETTINGS: CashierSettings = {
  duplicateItemAction: 'increase_qty',
  minQtyPerLine: 1,
  allowExitWithHeldDocs: true,
  allowLineDiscount: true,
  maxLineDiscountPct: 100,
  maxDocDiscountPct: 100,
  allowDocDiscount: true,
  pluCols: 4,
  pluRows: 3,
  fontSizeName: 12,
  fontSizePrice: 13,
  fontSizeCode: 9,
  showPrice: true,
  showCode: true,
  showBarcode: false,
  printBehavior: { ...DEFAULT_PRINT_BEHAVIOR },
}

export function asBool(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === '1' || v === 'true') return true
    if (v === '0' || v === 'false') return false
  }
  return fallback
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
    return null
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function strOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s ? s : null
}

function num(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function parsePrintBehavior(raw: unknown): Record<string, string> {
  const out = { ...DEFAULT_PRINT_BEHAVIOR }
  const rec = asRecord(raw)
  if (!rec) return out
  for (const [k, v] of Object.entries(rec)) {
    if (v === 'default' || v === 'ask' || v === 'none') out[k] = v
  }
  return out
}

export function parseTemplateIds(raw: unknown): Record<string, string> {
  const rec = asRecord(raw)
  if (!rec) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(rec)) {
    if (v != null && String(v).trim()) out[k] = String(v)
  }
  return out
}

export function parseBrandIds(raw: unknown): number[] {
  const list = Array.isArray(raw)
    ? raw
    : (() => {
        if (typeof raw !== 'string' || !raw.trim()) return []
        try {
          const parsed = JSON.parse(raw) as unknown
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })()
  const ids: number[] = []
  for (const item of list) {
    if (typeof item === 'number' || typeof item === 'string') {
      const n = Number(item)
      if (Number.isFinite(n)) ids.push(n)
      continue
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const n = Number(o.payment_provider_brand_id ?? o.id ?? o.brand_id)
      if (Number.isFinite(n)) ids.push(n)
    }
  }
  return ids
}

export function parseTerminalInfo(raw: unknown): TerminalInfo {
  const rec = asRecord(raw) ?? {}
  const wpRaw = asRecord(rec.workplace ?? rec.workplace_info) ?? {}
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = wpRaw[k]
      if (v != null && String(v).trim()) return String(v)
    }
    return ''
  }
  const workplace: Record<string, string> = {
    name: pick('name', 'workplace_name'),
    address: pick('address', 'workplace_address'),
    phone: pick('phone', 'workplace_phone'),
    city: pick('city', 'workplace_city'),
    district: pick('district', 'workplace_district'),
    taxOffice: pick('taxOffice', 'tax_office', 'taxOfficeName', 'workplace_tax_office'),
    taxNo: pick('taxNo', 'tax_no', 'workplace_tax_no'),
  }
  const hasWp = Object.values(workplace).some(v => v.trim())
  const terminalName = strOrNull(rec.terminalName ?? rec.terminal_name ?? rec.name)
  const terminalNumber = strOrNull(rec.terminalNumber ?? rec.terminal_number ?? rec.kasa_kodu)
  return {
    ...(terminalName ? { terminalName } : {}),
    ...(terminalNumber ? { terminalNumber } : {}),
    ...(hasWp ? { workplace } : {}),
  }
}

export function terminalInfoToJson(info: TerminalInfo): string {
  const wp = info.workplace ?? {}
  return JSON.stringify({
    terminal_name: info.terminalName ?? '',
    terminal_number: info.terminalNumber ?? '',
    workplace: {
      name: wp.name ?? '',
      address: wp.address ?? '',
      phone: wp.phone ?? '',
      city: wp.city ?? '',
      district: wp.district ?? '',
      tax_office: wp.taxOffice ?? '',
      tax_no: wp.taxNo ?? '',
    },
  })
}

function pickRow(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined) return row[k]
  }
  return undefined
}

export function parseTerminalSettings(row: Record<string, unknown>): TerminalSettings {
  const invoice = pickRow(row, 'invoiceType', 'invoice_type')
  return {
    touchKeyboard: asBool(pickRow(row, 'touchKeyboard', 'touch_keyboard'), true),
    customerDisplay: asBool(pickRow(row, 'customerDisplay', 'customer_display'), false),
    invoiceType: invoice === 'paper' ? 'paper' : 'e_archive',
    torbaCariId: strOrNull(pickRow(row, 'torbaCariId', 'torba_cari_id')),
    torbaCariName: strOrNull(pickRow(row, 'torbaCariName', 'torba_cari_name')),
    cariPaymentUsePavo: asBool(pickRow(row, 'cariPaymentUsePavo', 'cari_payment_use_pavo'), false),
    enabledPaymentBrands: parseBrandIds(pickRow(row, 'enabledPaymentBrands', 'enabled_payment_brands')),
    loginWithCode: asBool(pickRow(row, 'loginWithCode', 'login_with_code'), true),
    loginWithCard: asBool(pickRow(row, 'loginWithCard', 'login_with_card'), false),
    defaultTemplateIds: parseTemplateIds(pickRow(row, 'defaultTemplateIds', 'default_template_ids')),
    terminalInfo: parseTerminalInfo(pickRow(row, 'terminalInfo', 'terminal_info')),
    devtoolsEnabled: asBool(pickRow(row, 'devtoolsEnabled', 'devtools_enabled'), false),
    devtoolsExpiresAt: strOrNull(pickRow(row, 'devtoolsExpiresAt', 'devtools_expires_at')),
  }
}

/** Admin izni açık ve süre dolmamışsa true. Geliştirme ortamı istisnası burada yoktur. */
export function isDevtoolsPermitActive(
  settings: Pick<TerminalSettings, 'devtoolsEnabled' | 'devtoolsExpiresAt'>,
  now = new Date(),
): boolean {
  if (!settings.devtoolsEnabled) return false
  if (!settings.devtoolsExpiresAt) return true
  const exp = new Date(settings.devtoolsExpiresAt)
  if (Number.isNaN(exp.getTime())) return false
  return exp.getTime() > now.getTime()
}

export function parseCashierSettings(row: Record<string, unknown>): CashierSettings {
  const dup = pickRow(row, 'duplicateItemAction', 'duplicate_item_action')
  return {
    duplicateItemAction: dup === 'add_new' ? 'add_new' : 'increase_qty',
    minQtyPerLine: num(pickRow(row, 'minQtyPerLine', 'min_qty_per_line'), 1),
    allowExitWithHeldDocs: asBool(pickRow(row, 'allowExitWithHeldDocs', 'allow_exit_with_held_docs'), true),
    allowLineDiscount: asBool(pickRow(row, 'allowLineDiscount', 'allow_line_discount'), true),
    maxLineDiscountPct: num(pickRow(row, 'maxLineDiscountPct', 'max_line_discount_pct'), 100),
    allowDocDiscount: asBool(pickRow(row, 'allowDocDiscount', 'allow_doc_discount'), true),
    maxDocDiscountPct: num(pickRow(row, 'maxDocDiscountPct', 'max_doc_discount_pct'), 100),
    pluCols: num(pickRow(row, 'pluCols', 'plu_cols'), 4),
    pluRows: num(pickRow(row, 'pluRows', 'plu_rows'), 3),
    fontSizeName: num(pickRow(row, 'fontSizeName', 'font_size_name'), 12),
    fontSizePrice: num(pickRow(row, 'fontSizePrice', 'font_size_price'), 13),
    fontSizeCode: num(pickRow(row, 'fontSizeCode', 'font_size_code'), 9),
    showPrice: asBool(pickRow(row, 'showPrice', 'show_price'), true),
    showCode: asBool(pickRow(row, 'showCode', 'show_code'), true),
    showBarcode: asBool(pickRow(row, 'showBarcode', 'show_barcode'), false),
    printBehavior: parsePrintBehavior(pickRow(row, 'printBehavior', 'print_behavior')),
  }
}

export function parsePaymentAccount(row: Record<string, unknown>): PaymentAccountCache {
  return {
    id: String(pickRow(row, 'id') ?? ''),
    paymentType: String(pickRow(row, 'paymentType', 'payment_type') ?? ''),
    pavoAcquirerId: strOrNull(pickRow(row, 'pavoAcquirerId', 'pavo_acquirer_id')),
    isbasiAccountCode: String(pickRow(row, 'isbasiAccountCode', 'isbasi_account_code') ?? ''),
    isbasiAccountName: String(pickRow(row, 'isbasiAccountName', 'isbasi_account_name') ?? ''),
    isbasiAccountType: num(pickRow(row, 'isbasiAccountType', 'isbasi_account_type'), 0),
    isbasiAccountId: strOrNull(pickRow(row, 'isbasiAccountId', 'isbasi_account_id')),
    isDefault: asBool(pickRow(row, 'isDefault', 'is_default'), false),
  }
}

function unwrapPayload(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== 'object') return {}
  const root = json as Record<string, unknown>
  const data = root.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>
    if (d.terminal || d.terminal_settings || d.cashiers || d.cashier_settings || d.settings) return d
  }
  return root
}

function firstArray(root: Record<string, unknown>, ...keys: string[]): unknown[] | null {
  for (const k of keys) {
    if (Array.isArray(root[k])) return root[k] as unknown[]
  }
  return null
}

/** GET /pos/settings/{terminal_id} gövdesi. Eksik kasa bloğu hata sayılır. */
export function parseSettingsBundle(json: unknown): SettingsBundle {
  const root = unwrapPayload(json)
  const terminalRaw = root.terminal ?? root.terminal_settings ?? root.settings
  if (!terminalRaw || typeof terminalRaw !== 'object' || Array.isArray(terminalRaw)) {
    throw new Error('Ayar yanıtında kasa bloğu yok')
  }
  const terminalObj = terminalRaw as Record<string, unknown>
  const terminal = parseTerminalSettings(terminalObj)
  const siblingInfo = root.terminal_info ?? root.terminalInfo
  if (siblingInfo != null) {
    terminal.terminalInfo = parseTerminalInfo(siblingInfo)
  } else if (terminalObj.terminal_info == null && terminalObj.terminalInfo == null) {
    terminal.terminalInfo = parseTerminalInfo({
      terminal_name: terminalObj.terminal_name ?? terminalObj.terminalName,
      terminal_number: terminalObj.terminal_number ?? terminalObj.terminalNumber ?? terminalObj.kasa_kodu,
      workplace: terminalObj.workplace ?? {
        name: terminalObj.workplace_name,
        address: terminalObj.workplace_address,
        phone: terminalObj.workplace_phone,
        city: terminalObj.workplace_city,
        district: terminalObj.workplace_district,
        tax_office: terminalObj.workplace_tax_office,
        tax_no: terminalObj.workplace_tax_no,
      },
    })
  }

  const cashierList = firstArray(root, 'cashiers', 'cashier_settings', 'cashierSettings') ?? []
  const cashiers = cashierList.map(item => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const cashierId = String(row.cashier_id ?? row.cashierId ?? row.id ?? '').replace(/^cashier_/, '')
    return { cashierId, ...parseCashierSettings(row) }
  }).filter(c => c.cashierId)

  const accountList = firstArray(root, 'payment_accounts', 'paymentAccounts') ?? []
  const paymentAccounts = accountList.map(item =>
    parsePaymentAccount((item && typeof item === 'object' ? item : {}) as Record<string, unknown>),
  ).filter(a => a.id && a.paymentType)

  const barcodeRaw = firstArray(root, 'barcode_formats', 'barcodeFormats')
  return {
    terminal,
    cashiers,
    paymentAccounts,
    barcodeFormats: barcodeRaw
      ? barcodeRaw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      : null,
  }
}

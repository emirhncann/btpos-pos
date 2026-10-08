/** Kuyruk faturası — cari gönderim anında çözülür (payload'da customer_ref). */

export type CustomerRef =
  | { type: 'customer'; id: string }
  | { type: 'torba' }

export class QueueCustomerError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'QueueCustomerError'
    this.code = code
  }
}

export const TORBA_CARI_YOK = 'TORBA_CARI_YOK'
export const CARI_ERP_EKSIK = 'CARI_ERP_EKSIK'

export function customerRefFromCustomerRow(c: CustomerRow): CustomerRef {
  return { type: 'customer', id: c.id }
}

export function customerRefTorba(): CustomerRef {
  return { type: 'torba' }
}

export function customerRowToInvoicePayload(c: CustomerRow) {
  return {
    code:       c.code       || undefined,
    name:       c.name,
    firstName:  c.firstName  || undefined,
    lastName:   c.lastName   || undefined,
    taxNo:      c.taxNo      || undefined,
    address:    c.address    || undefined,
    phone:      c.phone      || undefined,
    email:      c.email      || undefined,
    postalCode: c.postalCode || undefined,
    city:       c.city       || undefined,
    district:   c.district   || undefined,
    isPerson:   c.isPerson ?? true,
  }
}

function erpIdFromCustomerRow(c: CustomerRow): number {
  return Number.parseInt(c.id, 10) || 0
}

function hasErpIdentity(code: string, erpId: number): boolean {
  return Boolean(code.trim()) || erpId > 0
}

/** Eski gömülü customer / sahte "Genel Müşteri" → torba veya customer ref */
export function inferCustomerRef(payload: Record<string, unknown>): CustomerRef {
  const ref = payload.customer_ref as CustomerRef | undefined
  if (ref?.type === 'customer' && ref.id) return ref
  if (ref?.type === 'torba') return { type: 'torba' }

  const c = payload.customer as Record<string, unknown> | undefined
  const name = String(c?.name ?? '').trim()
  const code = String(c?.code ?? '').trim()
  const erpTop = Number(payload.customer_erp_id ?? c?.erp_id ?? c?.id ?? 0)

  if (name === 'Genel Müşteri' || (c && !code && !(erpTop > 0))) {
    return { type: 'torba' }
  }

  if (code || erpTop > 0) {
    const id = String(c?.id ?? erpTop)
    if (id && id !== '0') return { type: 'customer', id }
  }

  return { type: 'torba' }
}

export async function resolveQueueCustomer(
  companyId: string,
  ref: CustomerRef,
): Promise<CustomerRow> {
  if (ref.type === 'customer') {
    const row = await window.electron.db.getCustomerById(companyId, ref.id)
    if (!row) {
      throw new QueueCustomerError(
        'CARI_BULUNAMADI',
        'Seçili cari yerel listede bulunamadı. Carileri senkronize edin.',
      )
    }
    const erpId = erpIdFromCustomerRow(row)
    if (!hasErpIdentity(row.code, erpId)) {
      throw new QueueCustomerError(
        CARI_ERP_EKSIK,
        `Cari ERP bilgisi eksik: ${row.name || row.code || ref.id}`,
      )
    }
    return row
  }

  const settings = await window.electron.db.getTerminalSettings()
  const torbaCode = settings.torbaCariId?.trim()
  if (!torbaCode) {
    throw new QueueCustomerError(
      TORBA_CARI_YOK,
      'Torba cari tanımlı değil. Yönetim panelinden kasa ayarlarına torba cari ekleyin.',
    )
  }

  const found = await window.electron.db.getCustomerByCode(companyId, torbaCode)
  if (found) {
    const erpId = erpIdFromCustomerRow(found)
    if (!hasErpIdentity(found.code, erpId)) {
      throw new QueueCustomerError(
        CARI_ERP_EKSIK,
        `Torba cari ERP bilgisi eksik: ${found.name || found.code}`,
      )
    }
    return found
  }

  throw new QueueCustomerError(
    CARI_ERP_EKSIK,
    `Torba cari (${torbaCode}) yerel listede yok. Carileri senkronize edin.`,
  )
}

/** Fatura gönderim gövdesine güncel cari yazar */
export async function applyCustomerToInvoicePayload(
  companyId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ref = inferCustomerRef(payload)
  const row = await resolveQueueCustomer(companyId, ref)
  const customer = customerRowToInvoicePayload(row)
  const customerErpId = erpIdFromCustomerRow(row)
  const next = { ...payload, customer, customer_erp_id: customerErpId }
  return next
}

/** Kasada torba cari seçimi (satış satırı / UI); sahte isim üretmez */
export async function tryResolveTorbaCustomer(companyId: string): Promise<CustomerRow | null> {
  try {
    return await resolveQueueCustomer(companyId, { type: 'torba' })
  } catch {
    return null
  }
}

export function queueCustomerErrorMessage(e: unknown): { code: string; message: string } {
  if (e instanceof QueueCustomerError) {
    return { code: e.code, message: `${e.code}: ${e.message}` }
  }
  return { code: 'HATA', message: String(e) }
}

export function payloadSummary(payload: Record<string, unknown>): {
  saleId: string
  expectedTotal: number | null
  customerHint: string
  invoiceDate: string
} {
  const c = payload.customer as { name?: string; code?: string } | undefined
  const ref = payload.customer_ref as CustomerRef | undefined
  let customerHint = '—'
  if (ref?.type === 'torba') customerHint = 'Torba cari (gönderimde çözülür)'
  else if (ref?.type === 'customer') customerHint = `Cari id: ${ref.id}`
  else if (c?.name) customerHint = `${c.name}${c.code ? ` (${c.code})` : ''}`

  return {
    saleId: String(payload.sale_id ?? payload.invoice_number ?? '—'),
    expectedTotal: payload.expected_total != null ? Number(payload.expected_total) : null,
    customerHint,
    invoiceDate: String(payload.invoice_date ?? '—'),
  }
}

/** Belge Aktarım — kuyruk gövdesindeki cari alanlarını yeniler. İşleyiciye bağlı değildir. */

export type QueueCustomerKind = 'torba' | 'cari' | 'other'

export function queueCustomerKind(type: string, payload: Record<string, unknown>): QueueCustomerKind {
  const kind = String(payload.doc_kind ?? '')
  if (kind === 'retail_invoice' || kind === 'retail_refund') return 'torba'
  if (kind === 'customer_invoice' || kind === 'customer_refund') return 'cari'
  if (type === 'day_end_invoice') return 'torba'
  const ref = payload.customer_ref as { type?: string } | undefined
  if (ref?.type === 'customer') return 'cari'
  if (ref?.type === 'torba') return 'torba'
  if (type === 'invoice' || type === 'return_invoice') return 'torba'
  return 'other'
}

export function editableQueueStatus(status: string): boolean {
  return status === 'pending' || status === 'failed'
}

export function payloadCustomerCode(payload: Record<string, unknown>): string {
  const customer = payload.customer as { code?: unknown } | undefined
  return String(customer?.code ?? payload.customer_code ?? '').trim()
}

export function payloadCustomerName(payload: Record<string, unknown>): string {
  const customer = payload.customer as { name?: unknown } | undefined
  return String(customer?.name ?? '').trim()
}

export function formatCariLine(payload: Record<string, unknown>): string {
  const ref = payload.customer_ref as { type?: string } | undefined
  const kind = String(payload.doc_kind ?? '')
  if (ref?.type === 'torba' || kind === 'retail_invoice' || kind === 'retail_refund') {
    return 'Torba cari (merkezden)'
  }
  const name = payloadCustomerName(payload)
  const code = payloadCustomerCode(payload)
  if (name && code) return `${name} · ${code}`
  if (name || code) return name || code
  return ''
}

export function isbasiIdOf(row: { id?: string | null; erpId?: string | null }): string {
  const erp = String(row.erpId ?? '').trim()
  if (erp && erp !== '0') return erp
  const id = String(row.id ?? '').trim()
  if (/^\d+$/.test(id) && id !== '0') return id
  return ''
}

export function customerErpNumber(row: { id?: string | null; erpId?: string | null }): number {
  const raw = isbasiIdOf(row)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function sameTorba(
  payload: Record<string, unknown>,
  next: { code: string; erpId: number },
): boolean {
  const code = payloadCustomerCode(payload)
  const nextCode = next.code.trim()
  if (!code || code !== nextCode) return false
  const erp = Number(payload.customer_erp_id ?? 0)
  if (next.erpId > 0 && erp > 0 && erp !== next.erpId) return false
  return true
}

export function invoiceCustomerBody(row: {
  code?: string | null
  name?: string | null
  firstName?: string | null
  lastName?: string | null
  taxNo?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  postalCode?: string | null
  city?: string | null
  district?: string | null
  isPerson?: boolean | null
}): Record<string, unknown> {
  return {
    code: row.code || undefined,
    name: row.name ?? '',
    firstName: row.firstName || undefined,
    lastName: row.lastName || undefined,
    taxNo: row.taxNo || undefined,
    address: row.address || undefined,
    phone: row.phone || undefined,
    email: row.email || undefined,
    postalCode: row.postalCode || undefined,
    city: row.city || undefined,
    district: row.district || undefined,
    isPerson: row.isPerson ?? true,
  }
}

export function customerUnchanged(
  payload: Record<string, unknown>,
  row: { id: string; code?: string | null; name?: string | null; taxNo?: string | null; erpId?: string | null },
): boolean {
  const customer = payload.customer as { taxNo?: unknown; name?: unknown } | undefined
  const ref = payload.customer_ref as { type?: string; id?: string } | undefined
  const erp = customerErpNumber(row)
  return payloadCustomerCode(payload) === String(row.code ?? '').trim()
    && String(customer?.name ?? '').trim() === String(row.name ?? '').trim()
    && String(customer?.taxNo ?? '').trim() === String(row.taxNo ?? '').trim()
    && Number(payload.customer_erp_id ?? 0) === erp
    && ref?.type === 'customer'
    && ref.id === row.id
}

export function applyCustomerPatch(
  payload: Record<string, unknown>,
  next: {
    ref: { type: 'torba' } | { type: 'customer'; id: string }
    customer: Record<string, unknown>
    customerErpId: number
    customerName?: string
    touchName: boolean
  },
  previousCode: string,
  nowIso: string,
): Record<string, unknown> {
  const prev = payload._meta
  const meta = prev && typeof prev === 'object' && !Array.isArray(prev)
    ? { ...(prev as Record<string, unknown>) }
    : {}
  meta.customer_updated_at = nowIso
  meta.previous_customer_code = previousCode
  const out: Record<string, unknown> = {
    ...payload,
    customer: next.customer,
    customer_erp_id: next.customerErpId,
    customer_ref: next.ref,
    _meta: meta,
  }
  if (next.touchName && next.customerName) out.customer_name = next.customerName
  return out
}

export function customerUpdatedAt(payload: Record<string, unknown>): string {
  const meta = payload._meta as { customer_updated_at?: unknown } | undefined
  return typeof meta?.customer_updated_at === 'string' ? meta.customer_updated_at : ''
}

export function isTorbaCariError(error: string | null | undefined): boolean {
  const text = String(error ?? '').toLocaleLowerCase('tr-TR')
  return text.includes('cari') || text.includes('bulunamadı') || text.includes('bulunamadi')
}

export function isDayEndQueueDoc(type: string, payload: Record<string, unknown>): boolean {
  if (type === 'day_end_invoice') return true
  if (payload.day_end_run_id) return true
  const kind = String(payload.doc_kind ?? '')
  return kind.startsWith('retail') || kind.startsWith('customer')
}

import { API_URL } from './api'
import { customerPatchRequest, customerPayload, customerTypeOf, splitPersonName, type CustomerForm } from './customerIdentity'

export type CustomerWriteResult =
  | { ok: true; customer: CustomerRow }
  | { ok: false; kind: 'validation'; fields: Record<string, string>; message: string }
  | { ok: false; kind: 'duplicate'; existing: CustomerRow; name: string }
  | { ok: false; kind: 'forbidden'; message: string }
  | { ok: false; kind: 'erp'; message: string }
  | { ok: false; kind: 'timeout'; message: string }
  | { ok: false; kind: 'offline'; message: string }

const OFFLINE_MSG = 'İnternet bağlantısı yok. Müşteri eklemek/düzenlemek için bağlantı gerekli.'

export function customerFromApi(raw: Record<string, unknown>, companyId: string): CustomerRow | null {
  const erpId = String(raw.erp_id ?? raw.erpId ?? '').trim()
  if (!erpId || erpId === '0') return null
  const id = erpId
  const rawType = String(raw.type ?? '').trim()
  const type = rawType === 'individual' || rawType === 'corporate'
    ? rawType
    : customerTypeOf({ taxNo: String(raw.tax_number ?? raw.tax_no ?? raw.taxNo ?? raw.vkn ?? ''), type: rawType })
  const isPerson = type === 'individual'
  const name = String(raw.name ?? raw.title ?? raw.unvan ?? '').trim()
  const split = splitPersonName(name)
  const explicitFirst = String(raw.first_name ?? raw.firstName ?? '').trim()
  const explicitLast = String(raw.last_name ?? raw.lastName ?? '').trim()
  const code = String(raw.code ?? raw.Code ?? raw.firm_code ?? '').trim()
  return {
    id,
    erpId,
    companyId,
    code,
    name,
    phone: String(raw.phone ?? raw.gsm ?? ''),
    taxNo: String(raw.tax_number ?? raw.tax_no ?? raw.taxNo ?? raw.vkn ?? ''),
    taxOffice: String(raw.tax_office ?? raw.taxOffice ?? ''),
    address: String(raw.address ?? ''),
    balance: Number(raw.balance ?? 0) || 0,
    isPerson,
    type,
    firstName: explicitFirst || (isPerson ? split.first_name : ''),
    lastName: explicitLast || (isPerson && !explicitFirst ? split.last_name : explicitLast),
    postalCode: String(raw.postal_code ?? raw.postalCode ?? ''),
    city: String(raw.city ?? ''),
    district: String(raw.district ?? ''),
    email: String(raw.email ?? raw.emailAddress ?? ''),
  }
}

function payloadOf(json: Record<string, unknown>): Record<string, unknown> {
  const data = json.data
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
  return json
}

function customerRecord(body: Record<string, unknown>): Record<string, unknown> | null {
  const nested = body.customer ?? body.firm ?? body.existing
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested as Record<string, unknown>
  if (body.id != null || body.erp_id != null) return body
  return null
}

export async function writePosCustomer(opts: {
  mode: 'create' | 'edit'
  erpId?: string
  cashierId: string
  terminalId: string
  form: CustomerForm
  before?: Record<string, unknown> | null
  companyId: string
}): Promise<CustomerWriteResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, kind: 'offline', message: OFFLINE_MSG }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  const isEdit = opts.mode === 'edit'
  const patch = customerPatchRequest(opts.erpId, opts.form, opts.cashierId, opts.before ?? null)
  const url = isEdit ? `${API_URL}${patch.path}` : `${API_URL}/pos/customers`
  const body = isEdit
    ? { ...patch.payload, terminal_id: opts.terminalId }
    : { ...customerPayload(opts.form, opts.cashierId), terminal_id: opts.terminalId }
  console.debug('[customer] payload', body)
  try {
    const res = await fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => ({})) as Record<string, unknown>
    const payload = payloadOf(json)
    const error = String(payload.error ?? json.error ?? '')
    const message = String(payload.message ?? json.message ?? '')
    if (error === 'missing_erp_id') {
      return { ok: false, kind: 'erp', message }
    }
    if (error === 'validation' || res.status === 422) {
      const fields = (payload.errors ?? payload.fields ?? json.errors ?? json.fields ?? {}) as Record<string, string>
      return { ok: false, kind: 'validation', fields, message: message || 'Bilgiler geçersiz.' }
    }
    if (error === 'duplicate' || res.status === 409) {
      const existingRaw = customerRecord({ existing: payload.existing ?? json.existing })
        ?? customerRecord(payload)
      const existing = existingRaw ? customerFromApi(existingRaw, opts.companyId) : null
      if (!existing) return { ok: false, kind: 'erp', message: message || 'Kayıtlı müşteri okunamadı.' }
      return { ok: false, kind: 'duplicate', existing, name: existing.name || 'müşteri' }
    }
    if (error === 'forbidden' || res.status === 403) {
      return { ok: false, kind: 'forbidden', message: message || 'Bu işlem için yetkiniz yok.' }
    }
    if (error === 'erp_unreachable') {
      return { ok: false, kind: 'erp', message: message || 'İşbaşına ulaşılamadı.' }
    }
    if (error === 'erp_error' || !res.ok) {
      return { ok: false, kind: 'erp', message: message || `Kayıt tamamlanamadı (HTTP ${res.status}).` }
    }
    const row = customerFromApi(customerRecord(payload) ?? payload, opts.companyId)
    if (!row) return { ok: false, kind: 'erp', message: 'İşbaşı müşteri kimliği dönmedi.' }
    return { ok: true, customer: row }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, kind: 'timeout', message: 'İstek zaman aşımına uğradı.' }
    }
    return { ok: false, kind: 'erp', message: 'İşbaşına ulaşılamadı.' }
  } finally {
    clearTimeout(timer)
  }
}

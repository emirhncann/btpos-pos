export function isValidTckn(s: string): boolean {
  if (!/^[1-9]\d{10}$/.test(s)) return false
  const d = s.split('').map(Number)
  const d10 = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10
  const d10n = (d10 + 10) % 10
  return d10n === d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10]
}

export function isValidVkn(s: string): boolean {
  if (!/^\d{10}$/.test(s)) return false
  const d = s.split('').map(Number)
  let sum = 0
  for (let i = 0; i < 9; i++) {
    const v = (d[i] + 9 - i) % 10
    let v2 = (v * 2 ** (9 - i)) % 9
    if (v !== 0 && v2 === 0) v2 = 9
    sum += v2
  }
  return (10 - (sum % 10)) % 10 === d[9]
}

export type CustomerType = 'individual' | 'corporate'

export type CustomerForm = {
  type: CustomerType
  first_name: string
  last_name: string
  name: string
  tax_number: string
  tax_office: string
  phone: string
  email: string
  city: string
  district: string
  address: string
}

export type CustomerField = 'first_name' | 'last_name' | 'name' | 'tax_number' | 'tax_office' | 'phone' | 'email'

export const CUSTOMER_FIELD_ORDER: CustomerField[] = [
  'first_name', 'last_name', 'name', 'tax_number', 'tax_office', 'phone', 'email',
]

export function emptyForm(city = ''): CustomerForm {
  return {
    type: 'individual',
    first_name: '',
    last_name: '',
    name: '',
    tax_number: '',
    tax_office: '',
    phone: '',
    email: '',
    city,
    district: '',
    address: '',
  }
}

/** Son kelime soyad. Tek kelimede soyad boş kalır. */
export function splitPersonName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first_name: '', last_name: '' }
  if (parts.length === 1) return { first_name: parts[0], last_name: '' }
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] }
}

/** Yerel kayıtta tür yoksa 10 haneli vergi no kurumsal sayılır. */
export function customerTypeOf(c: { type?: string | null; taxNo?: string | null }): CustomerType {
  const stored = String(c.type ?? '').trim()
  if (stored === 'individual' || stored === 'corporate') return stored
  return digitsOnly(String(c.taxNo ?? '')).length === 10 ? 'corporate' : 'individual'
}

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '')
}

export function prefillFromQuery(query: string, defaultCity = ''): CustomerForm {
  const draft = emptyForm(defaultCity)
  const q = query.trim()
  if (!q) return draft
  if (/^\d+$/.test(q)) {
    if (q.length === 11 && q[0] !== '0') {
      draft.tax_number = q
      return draft
    }
    if (q.length === 10 && q[0] !== '0' && q[0] !== '5') {
      draft.type = 'corporate'
      draft.tax_number = q
      return draft
    }
    draft.phone = q
    return draft
  }
  const split = splitPersonName(q)
  draft.first_name = split.first_name
  draft.last_name = split.last_name
  draft.name = q
  return draft
}

function emailOk(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

export function validateCustomerForm(d: CustomerForm): {
  errors: Partial<Record<CustomerField, string>>
  vknWarning: string
} {
  const errors: Partial<Record<CustomerField, string>> = {}
  const corporate = d.type === 'corporate'
  if (!corporate) {
    if (!d.first_name.trim()) errors.first_name = 'Ad zorunlu.'
    if (!d.last_name.trim()) errors.last_name = 'Soyad zorunlu.'
  } else if (d.name.trim().length < 2) {
    errors.name = 'Unvan en az 2 karakter olmalı.'
  }
  const tax = digitsOnly(d.tax_number)
  if (!corporate) {
    if (tax && !isValidTckn(tax)) errors.tax_number = 'TC Kimlik No geçersiz'
  } else if (!/^\d{10}$/.test(tax)) {
    errors.tax_number = 'Vergi no 10 hane olmalı.'
  }
  if (corporate && !d.tax_office.trim()) errors.tax_office = 'Vergi dairesi zorunlu.'
  const phone = digitsOnly(d.phone)
  if (phone && (phone.length < 10 || phone.length > 11)) errors.phone = 'Telefon 10 veya 11 hane olmalı.'
  const email = d.email.trim()
  if (email && !emailOk(email)) errors.email = 'E-posta geçersiz.'
  const vknWarning = corporate && /^\d{10}$/.test(tax) && !isValidVkn(tax)
    ? 'Vergi no kontrol hanesi tutmuyor, emin misiniz?'
    : ''
  return { errors, vknWarning }
}

function norm(d: CustomerForm): CustomerForm {
  return {
    type: d.type === 'corporate' ? 'corporate' : 'individual',
    first_name: d.first_name.trim(),
    last_name: d.last_name.trim(),
    name: d.name.trim(),
    tax_number: digitsOnly(d.tax_number),
    tax_office: d.tax_office.trim(),
    phone: digitsOnly(d.phone),
    email: d.email.trim(),
    city: d.city.trim(),
    district: d.district.trim(),
    address: d.address.trim(),
  }
}

export function formsEqual(a: CustomerForm, b: CustomerForm): boolean {
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/** Düzenleme öncesi yerel müşteri. PATCH gövdesindeki `before`. */
export function snapshotOf(c: {
  type?: string | null
  isPerson?: boolean
  firstName?: string | null
  lastName?: string | null
  name?: string | null
  taxNo?: string | null
  taxOffice?: string | null
  phone?: string | null
  email?: string | null
  city?: string | null
  district?: string | null
  address?: string | null
}): Record<string, string> {
  const type = c.type === 'corporate' || c.type === 'individual'
    ? c.type
    : (c.isPerson === false ? 'corporate' : 'individual')
  return {
    type,
    first_name: c.firstName ?? '',
    last_name: c.lastName ?? '',
    name: c.name ?? '',
    tax_number: String(c.taxNo ?? '').replace(/\D/g, ''),
    tax_office: c.taxOffice ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    city: c.city ?? '',
    district: c.district ?? '',
    address: c.address ?? '',
  }
}

/** PATCH yolu yalnız İşbaşı firma id'sini kullanır. Boşsa da gönderilir. */
export function customerPatchRequest(
  erpId: string | null | undefined,
  form: CustomerForm,
  cashierId: string,
  before: Record<string, unknown> | null,
): { path: string; payload: Record<string, unknown> } {
  const id = String(erpId ?? '').trim()
  return {
    path: `/pos/customers/${encodeURIComponent(id)}`,
    payload: { ...customerPayload(form, cashierId), erp_id: id || null, before },
  }
}

export function customerPayload(form: CustomerForm, cashierId: string): Record<string, string> {
  return {
    cashier_id: cashierId,
    type: form.type,
    first_name: form.type === 'individual' ? form.first_name.trim() : '',
    last_name: form.type === 'individual' ? form.last_name.trim() : '',
    name: form.type === 'individual'
      ? `${form.first_name} ${form.last_name}`.trim()
      : form.name.trim(),
    tax_number: form.tax_number.replace(/\D/g, ''),
    tax_office: form.type === 'corporate' ? form.tax_office.trim() : '',
    phone: form.phone,
    email: form.email,
    city: form.city,
    district: form.district,
    address: form.address,
  }
}

const SERVER_FIELD: Record<string, CustomerField> = {
  first_name: 'first_name',
  firstName: 'first_name',
  last_name: 'last_name',
  lastName: 'last_name',
  name: 'name',
  title: 'name',
  unvan: 'name',
  tax_number: 'tax_number',
  tax_no: 'tax_number',
  taxno: 'tax_number',
  taxNo: 'tax_number',
  vkn: 'tax_number',
  tckn: 'tax_number',
  tax_office: 'tax_office',
  taxoffice: 'tax_office',
  taxOffice: 'tax_office',
  phone: 'phone',
  email: 'email',
}

export function mapServerFields(raw: unknown): Partial<Record<CustomerField, string>> {
  const out: Partial<Record<CustomerField, string>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = SERVER_FIELD[k]
    if (!field) continue
    const msg = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')
    if (msg.trim()) out[field] = msg.trim()
  }
  return out
}

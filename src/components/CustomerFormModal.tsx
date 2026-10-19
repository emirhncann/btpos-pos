import { useEffect, useMemo, useRef, useState } from 'react'
import { writePosCustomer } from '../lib/customerApi'
import {
  customerTypeOf,
  formsEqual,
  mapServerFields,
  prefillFromQuery,
  snapshotOf,
  splitPersonName,
  validateCustomerForm,
  CUSTOMER_FIELD_ORDER,
  type CustomerForm,
  type CustomerField,
} from '../lib/customerIdentity'
import { districtsOf, filterPlaces, matchProvince, PROVINCES } from '../lib/provinces'

const OFFLINE_MSG = 'İnternet bağlantısı yok. Müşteri eklemek/düzenlemek için bağlantı gerekli.'

type Props = {
  mode: 'create' | 'edit'
  query?: string
  customer?: CustomerRow | null
  defaultCity?: string
  cashierId: string
  terminalId: string
  companyId: string
  online: boolean
  onClose: () => void
  onSaved: (row: CustomerRow, opts?: { select?: boolean; previousId?: string }) => void
  onForbidden: (message: string) => void
}

function formFromCustomer(c: CustomerRow, fallbackCity: string): CustomerForm {
  const storedFirst = (c.firstName ?? '').trim()
  const storedLast = (c.lastName ?? '').trim()
  const split = splitPersonName(c.name ?? '')
  const separate = storedFirst !== '' || storedLast !== ''
  return {
    type: customerTypeOf({ type: c.type, taxNo: c.taxNo }),
    first_name: separate ? storedFirst : split.first_name,
    last_name: separate ? storedLast : split.last_name,
    name: c.name ?? '',
    tax_number: c.taxNo ?? '',
    tax_office: c.taxOffice ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    city: matchProvince(c.city ?? '') || c.city || fallbackCity,
    district: c.district ?? '',
    address: c.address ?? '',
  }
}

export function CustomerFormModal({
  mode, query, customer, defaultCity, cashierId, terminalId, companyId, online, onClose, onSaved, onForbidden,
}: Props) {
  const cityDefault = matchProvince(defaultCity ?? '')
  const initial = useMemo(
    () => (mode === 'edit' && customer
      ? formFromCustomer(customer, cityDefault)
      : prefillFromQuery(query ?? '', cityDefault)),
    [mode, customer, query, cityDefault],
  )
  const [form, setForm] = useState<CustomerForm>(initial)
  const [errors, setErrors] = useState<Partial<Record<CustomerField, string>>>({})
  const [vknWarning, setVknWarning] = useState('')
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState('')
  const [duplicate, setDuplicate] = useState<CustomerRow | null>(null)
  const [cityQ, setCityQ] = useState(initial.city)
  const [districtQ, setDistrictQ] = useState(initial.district)
  const [openList, setOpenList] = useState<'city' | 'district' | null>(null)
  const lock = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setForm(initial)
    setCityQ(initial.city)
    setDistrictQ(initial.district)
  }, [initial])

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])

  const unchanged = mode === 'edit' && formsEqual(initial, form)
  const districts = districtsOf(form.city)
  const cityHits = filterPlaces(PROVINCES, cityQ)
  const districtHits = filterPlaces(districts, districtQ)

  function setField<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function setType(type: 'individual' | 'corporate') {
    setForm(prev => ({ ...prev, type }))
    setVknWarning('')
  }

  function focusField(field: CustomerField) {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)
    el?.focus()
  }

  async function save() {
    if (lock.current || saving) return
    if (!online) {
      setBanner(OFFLINE_MSG)
      return
    }
    const checked = validateCustomerForm(form)
    setErrors(checked.errors)
    setVknWarning(checked.vknWarning)
    const first = CUSTOMER_FIELD_ORDER.find(f => checked.errors[f])
    if (first) {
      focusField(first)
      return
    }
    if (mode === 'edit' && formsEqual(initial, form)) return
    lock.current = true
    setSaving(true)
    setBanner('')
    setDuplicate(null)
    try {
      const result = await writePosCustomer({
        mode,
        erpId: customer?.erpId ?? '',
        cashierId,
        terminalId,
        companyId,
        form,
        before: mode === 'edit' && customer ? snapshotOf(customer) : null,
      })
      if (result.ok) {
        onSaved(result.customer, { previousId: mode === 'edit' ? customer?.id : undefined })
        return
      }
      if (result.kind === 'validation') {
        const mapped = mapServerFields(result.fields)
        setErrors(mapped)
        setBanner(Object.keys(mapped).length ? '' : result.message)
        const hit = CUSTOMER_FIELD_ORDER.find(f => mapped[f])
        if (hit) focusField(hit)
        return
      }
      if (result.kind === 'duplicate') {
        setDuplicate(result.existing)
        setBanner('')
        return
      }
      if (result.kind === 'forbidden') {
        onForbidden(result.message)
        return
      }
      setBanner(result.message)
    } finally {
      lock.current = false
      setSaving(false)
    }
  }

  const individual = form.type === 'individual'
  const taxLabel = individual ? 'TC Kimlik' : 'Vergi No*'

  return (
    <div className="pos-modal-overlay" style={{ zIndex: 10020, background: 'rgba(0,0,0,0.45)', padding: 12 }}>
      <div
        ref={rootRef}
        className="pos-modal"
        data-pos-popup=""
        tabIndex={-1}
        onKeyDown={e => {
          if (e.key !== 'Enter' || e.shiftKey) return
          const target = e.target as HTMLElement
          if (target.tagName === 'TEXTAREA') return
          e.preventDefault()
          if (saving) return
          void save()
        }}
        style={{
          background: 'var(--pos-surface)',
          color: 'var(--pos-text)',
          borderRadius: 14,
          width: 'min(720px, 96vw)',
          border: '1px solid var(--pos-border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: 'var(--pos-surface-alt)', borderBottom: '1px solid var(--pos-border)', flexShrink: 0 }}>
          <span style={{ fontWeight: 800 }}>{mode === 'edit' ? 'Müşteri Düzenle' : 'Yeni Müşteri'}</span>
          <button type="button" className="pos-modal-close" data-pos-cancel="" onClick={onClose} disabled={saving} style={{ background: 'var(--pos-surface-alt)', color: 'var(--pos-text)', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
        <div className="pos-modal-body" style={{ padding: 16, opacity: saving ? 0.7 : 1 }}>
          {banner && (
            <div className="cf-error" style={{ marginBottom: 12, background: 'var(--pos-danger)', color: 'var(--pos-primary-text)', borderRadius: 8, padding: '10px 12px', fontSize: 14 }}>
              {banner}
            </div>
          )}
          <div className="customer-form">
            <div className="cf-label">Tür</div>
            <div className="seg" role="group" aria-label="Tür">
              <button type="button" aria-pressed={form.type === 'individual'} disabled={saving} onClick={() => setType('individual')}>👤 Bireysel</button>
              <button type="button" aria-pressed={form.type === 'corporate'} disabled={saving} onClick={() => setType('corporate')}>🏢 Kurumsal</button>
            </div>
            <label className="cf-label" htmlFor="cf-first" style={{ display: individual ? undefined : 'none' }}>Ad*</label>
            <input id="cf-first" aria-label="Ad" data-field="first_name" data-kb="text" data-autofocus={individual ? '' : undefined} disabled={saving} value={form.first_name} onChange={e => setField('first_name', e.target.value)} style={{ display: individual ? undefined : 'none' }} />
            {errors.first_name && individual && <div className="cf-error">{errors.first_name}</div>}
            <label className="cf-label" htmlFor="cf-last" style={{ display: individual ? undefined : 'none' }}>Soyad*</label>
            <input id="cf-last" aria-label="Soyad" data-field="last_name" data-kb="text" disabled={saving} value={form.last_name} onChange={e => setField('last_name', e.target.value)} style={{ display: individual ? undefined : 'none' }} />
            {errors.last_name && individual && <div className="cf-error">{errors.last_name}</div>}
            <label className="cf-label" htmlFor="cf-name" style={{ display: individual ? 'none' : undefined }}>Unvan*</label>
            <input id="cf-name" aria-label="Unvan" data-field="name" data-kb="text" data-autofocus={individual ? undefined : ''} disabled={saving} value={form.name} onChange={e => setField('name', e.target.value)} style={{ display: individual ? 'none' : undefined }} />
            {errors.name && !individual && <div className="cf-error">{errors.name}</div>}
            <label className="cf-label" htmlFor="cf-tax">{taxLabel}</label>
            <input
              id="cf-tax"
              aria-label={taxLabel}
              data-field="tax_number"
              data-kb="number"
              inputMode="numeric"
              disabled={saving}
              value={form.tax_number}
              onChange={e => setField('tax_number', e.target.value.replace(/\D/g, '').slice(0, individual ? 11 : 10))}
            />
            {errors.tax_number && <div className="cf-error">{errors.tax_number}</div>}
            {vknWarning && <div className="cf-warn">{vknWarning}</div>}
            <label className="cf-label" htmlFor="cf-office" style={{ display: individual ? 'none' : undefined }}>Vergi Dairesi*</label>
            <input
              id="cf-office"
              aria-label="Vergi Dairesi"
              data-field="tax_office"
              data-kb="text"
              disabled={saving}
              value={form.tax_office}
              onChange={e => setField('tax_office', e.target.value)}
              style={{ display: individual ? 'none' : undefined }}
            />
            {errors.tax_office && !individual && <div className="cf-error">{errors.tax_office}</div>}
            <label className="cf-label" htmlFor="cf-phone">Telefon</label>
            <input id="cf-phone" aria-label="Telefon" data-field="phone" data-kb="phone" inputMode="tel" placeholder="05__ ___ __ __" disabled={saving} value={form.phone} onChange={e => setField('phone', e.target.value)} />
            {errors.phone && <div className="cf-error">{errors.phone}</div>}
            <label className="cf-label" htmlFor="cf-email">E-posta</label>
            <input id="cf-email" aria-label="E-posta" data-field="email" data-kb="email" type="email" disabled={saving} value={form.email} onChange={e => setField('email', e.target.value)} />
            {errors.email && <div className="cf-error">{errors.email}</div>}
            <div className="cf-label">İl / İlçe</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <input
                  aria-label="İl"
                  data-kb="text"
                  disabled={saving}
                  value={cityQ}
                  onFocus={() => setOpenList('city')}
                  onChange={e => { setCityQ(e.target.value); setOpenList('city') }}
                  onBlur={() => {
                    const hit = matchProvince(cityQ)
                    if (hit) {
                      setField('city', hit)
                      setCityQ(hit)
                      if (hit !== form.city) { setField('district', ''); setDistrictQ('') }
                    }
                    setTimeout(() => setOpenList(cur => cur === 'city' ? null : cur), 150)
                  }}
                />
                {openList === 'city' && (
                  <div style={{ maxHeight: 160, overflow: 'auto', background: 'var(--pos-surface)', border: '1px solid var(--pos-border)', borderRadius: 8 }}>
                    {cityHits.slice(0, 12).map(name => (
                      <button key={name} type="button" className="cf-mini" onMouseDown={e => e.preventDefault()} onClick={() => {
                        setField('city', name)
                        setCityQ(name)
                        setField('district', '')
                        setDistrictQ('')
                        setOpenList(null)
                      }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'var(--pos-surface)', color: 'var(--pos-text)', border: 'none', cursor: 'pointer' }}>{name}</button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <input
                  aria-label="İlçe"
                  data-kb="text"
                  disabled={saving || !form.city}
                  value={districtQ}
                  onFocus={() => setOpenList('district')}
                  onChange={e => { setDistrictQ(e.target.value); setOpenList('district') }}
                  onBlur={() => {
                    const hit = districts.find(d => d.toLocaleLowerCase('tr-TR') === districtQ.trim().toLocaleLowerCase('tr-TR'))
                    if (hit) { setField('district', hit); setDistrictQ(hit) }
                    setTimeout(() => setOpenList(cur => cur === 'district' ? null : cur), 150)
                  }}
                />
                {openList === 'district' && (
                  <div style={{ maxHeight: 160, overflow: 'auto', background: 'var(--pos-surface)', border: '1px solid var(--pos-border)', borderRadius: 8 }}>
                    {districtHits.slice(0, 12).map(name => (
                      <button key={name} type="button" className="cf-mini" onMouseDown={e => e.preventDefault()} onClick={() => {
                        setField('district', name)
                        setDistrictQ(name)
                        setOpenList(null)
                      }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'var(--pos-surface)', color: 'var(--pos-text)', border: 'none', cursor: 'pointer' }}>{name}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <label className="cf-label" htmlFor="cf-address">Adres</label>
            <textarea id="cf-address" aria-label="Adres" data-kb="text" disabled={saving} value={form.address} onChange={e => setField('address', e.target.value)} rows={2} />
            {duplicate && (
              <div className="full" style={{ background: 'var(--pos-surface-alt)', borderRadius: 8, padding: 12 }}>
                <div>Bu vergi/TC no ile kayıtlı müşteri var: <b>{duplicate.name}</b></div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" onClick={() => onSaved(duplicate, { select: true })} style={{ background: 'var(--pos-primary)', color: 'var(--pos-primary-text)', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>Bu müşteriyi seç</button>
                  <button type="button" onClick={() => setDuplicate(null)} style={{ background: 'var(--pos-surface-alt)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 8, cursor: 'pointer' }}>Vazgeç</button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 16, flexShrink: 0, background: 'var(--pos-surface)' }}>
          <button type="button" onClick={onClose} disabled={saving} style={{ background: 'var(--pos-surface-alt)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 8, padding: '10px 16px', cursor: 'pointer' }}>Vazgeç</button>
          {online ? (
            <button type="button" onClick={() => void save()} disabled={saving || unchanged} style={{ background: 'var(--pos-primary)', color: 'var(--pos-primary-text)', border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 800, cursor: saving || unchanged ? 'default' : 'pointer', opacity: saving || unchanged ? 0.55 : 1 }}>
              {saving ? '⟳ Kaydediliyor…' : 'Kaydet'}
            </button>
          ) : (
            <div className="cf-error" style={{ alignSelf: 'center', maxWidth: 280 }}>{OFFLINE_MSG}</div>
          )}
          {banner && online && !saving && (banner.includes('ulaşılamadı') || banner.includes('zaman aşımı') || banner.includes('tamamlanamadı')) && (
            <button type="button" onClick={() => void save()} style={{ background: 'var(--pos-surface-alt)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>Tekrar dene</button>
          )}
        </div>
      </div>
    </div>
  )
}

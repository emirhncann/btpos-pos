import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { DateRangePicker } from '../components/DateRangePicker'
import { formatSentInvoice } from '../lib/invoiceMode'
import { isEditableField } from '../lib/keyboardInput'
import {
  dayHeading,
  dayShift,
  formatDayRange,
  inDayBounds,
  istanbulClock,
  istanbulDay,
  presetBounds,
  type DayPreset,
} from '../lib/commandView'

type DocFilter = 'all' | 'sale' | 'return' | 'cancel' | 'tahsilat' | 'odeme' | 'held'
type PayFilter = 'all' | 'cash' | 'card' | 'split' | 'other'
type ErpFilter = 'all' | 'sent' | 'waiting' | 'failed' | 'unsent'

const PRESETS: Array<{ id: DayPreset; label: string }> = [
  { id: 'today', label: 'Bugün' },
  { id: 'yesterday', label: 'Dün' },
  { id: '7', label: '7 gün' },
]

const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })

function payText(sale: SalesReportRow): string {
  const methods = new Set(sale.payments.map(p => p.method))
  const split = methods.size > 1 || (sale.cashAmount > 0 && sale.cardAmount > 0)
  if (split) return 'Parçalı'
  if (methods.has('card') || sale.cardAmount > 0) {
    const bank = sale.payments.find(p => p.acquirerName)?.acquirerName
    return bank ? `Kart · ${bank}` : 'Kart'
  }
  if (methods.has('meal_card')) return 'Yemek kartı'
  if (methods.has('other')) return 'Diğer'
  return 'Nakit'
}

function payKind(sale: SalesReportRow): PayFilter {
  const text = payText(sale)
  if (text === 'Parçalı') return 'split'
  if (text.startsWith('Kart')) return 'card'
  if (text === 'Nakit') return 'cash'
  return 'other'
}

function erpView(sale: SalesReportRow): { text: string; color: string; kind: 'sent' | 'waiting' | 'failed' } {
  if (sale.invoiceSent === 1) return { text: formatSentInvoice(sale.invoiceNumber), color: 'var(--pos-success)', kind: 'sent' }
  if (sale.invoiceSent === 2 || sale.invoiceError) return { text: 'ERP ⚠ hata', color: 'var(--pos-danger)', kind: 'failed' }
  if (sale.dayEndRunId) return { text: 'Gün sonu: gönderiliyor', color: 'var(--pos-primary)', kind: 'waiting' }
  if (sale.invoiceSent === 0) return { text: 'Gün sonu bekliyor', color: 'var(--pos-text-muted)', kind: 'waiting' }
  return { text: 'Gün sonu bekliyor', color: 'var(--pos-text-muted)', kind: 'waiting' }
}

function amountHit(amount: number, q: string): boolean {
  const norm = q.replace(/\s/g, '').replace(',', '.')
  if (/^\d+(\.\d+)?$/.test(norm) && Math.abs(amount - Number(norm)) < 0.001) return true
  const shown = Math.abs(amount).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return shown.replace(/\./g, '').includes(q.replace(/\./g, '').replace(/\s/g, ''))
}

export function SalesReportScreen({
  companyId,
  onClose,
  onOpenHeld,
}: {
  companyId: string
  onClose: () => void
  onOpenHeld: () => void
}) {
  const [sales, setSales] = useState<SalesReportRow[]>([])
  const [payments, setPayments] = useState<CariPaymentReportRow[]>([])
  const [held, setHeld] = useState<HeldDocRow[]>([])
  const [preset, setPreset] = useState<DayPreset>('today')
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [picker, setPicker] = useState(false)
  const [docFilter, setDocFilter] = useState<DocFilter>('all')
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [erpFilter, setErpFilter] = useState<ErpFilter>('all')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(200)
  const [openId, setOpenId] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)
  const [items, setItems] = useState<Record<string, SaleItemRow[]>>({})
  const [barcodeHits, setBarcodeHits] = useState<Set<string>>(new Set())

  const bounds = custom ?? presetBounds(preset)

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim().toLocaleLowerCase('tr-TR')), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    let stop = false
    const from = dayShift(bounds.from, -1)
    const to = dayShift(bounds.to, 1)
    Promise.all([
      window.electron.db.getSalesReport({ dateFrom: from, dateTo: to }),
      window.electron.db.getCariPayments({ dateFrom: from, dateTo: to, companyId }),
      window.electron.db.getHeldDocuments(companyId),
    ]).then(([s, p, h]) => {
      if (stop) return
      setSales(s.filter(row => inDayBounds(row.createdAt, bounds.from, bounds.to)))
      setPayments(p.filter(row => inDayBounds(row.created_at, bounds.from, bounds.to)))
      setHeld(h.filter(row => inDayBounds(row.createdAt, bounds.from, bounds.to)))
    }).catch(() => {})
    return () => { stop = true }
  }, [bounds.from, bounds.to, companyId])

  useEffect(() => {
    if (q.length < 4) {
      setBarcodeHits(new Set())
      return
    }
    let stop = false
    void (async () => {
      const products = await window.electron.db.getProducts().catch(() => [])
      const codes = new Set(
        products
          .filter(p => (p.barcode ?? '').toLocaleLowerCase('tr-TR').includes(q) || (p.code ?? '').toLocaleLowerCase('tr-TR').includes(q))
          .map(p => p.code ?? '')
          .filter(Boolean),
      )
      const hits = new Set<string>()
      for (const sale of sales) {
        if (stop) return
        const lines = items[sale.id] ?? await window.electron.db.getSaleItems(sale.id).catch(() => [])
        if (lines.some(line =>
          codes.has(line.productCode)
          || line.productCode.toLocaleLowerCase('tr-TR').includes(q)
        )) hits.add(sale.id)
      }
      if (!stop) setBarcodeHits(hits)
    })()
    return () => { stop = true }
  }, [q, sales, items])

  const counts = useMemo(() => ({
    sale: sales.filter(s => !s.isReturn).length,
    ret: sales.filter(s => s.isReturn).length,
    cancel: 0,
    held: held.length,
    erp: sales.filter(s => erpView(s).kind !== 'sent').length,
  }), [sales, held])

  const listed = useMemo(() => {
    type Row = { id: string; at: string; sale?: SalesReportRow; pay?: CariPaymentReportRow; held?: HeldDocRow }
    const rows: Row[] = []
    for (const sale of sales) {
      const erp = erpView(sale)
      if (docFilter === 'sale' && sale.isReturn) continue
      if (docFilter === 'return' && !sale.isReturn) continue
      if (docFilter === 'cancel' || docFilter === 'tahsilat' || docFilter === 'odeme' || docFilter === 'held') continue
      if (payFilter !== 'all' && payKind(sale) !== payFilter) continue
      if (erpFilter === 'sent' && erp.kind !== 'sent') continue
      if (erpFilter === 'waiting' && erp.kind !== 'waiting') continue
      if (erpFilter === 'failed' && erp.kind !== 'failed') continue
      if (erpFilter === 'unsent' && erp.kind === 'sent') continue
      if (q) {
        const receipt = String(sale.receiptNo ?? '').toLocaleLowerCase('tr-TR')
        const order = (sale.orderNo ?? '').toLocaleLowerCase('tr-TR')
        const customer = (sale.customerName ?? '').toLocaleLowerCase('tr-TR')
        const textHit = receipt.includes(q) || order.includes(q) || customer.includes(q) || amountHit(sale.netAmount, q)
        if (!textHit && !barcodeHits.has(sale.id)) continue
      }
      rows.push({ id: sale.id, at: sale.createdAt, sale })
    }
    if ((docFilter === 'all' || docFilter === 'tahsilat' || docFilter === 'odeme') && payFilter === 'all' && (erpFilter === 'all')) {
      for (const pay of payments) {
        if (docFilter === 'tahsilat' && pay.type !== 'tahsilat') continue
        if (docFilter === 'odeme' && pay.type !== 'odeme') continue
        if (q) {
          const name = (pay.customer_name ?? '').toLocaleLowerCase('tr-TR')
          if (!name.includes(q) && !amountHit(pay.amount, q)) continue
        }
        rows.push({ id: pay.id, at: pay.created_at, pay })
      }
    }
    if ((docFilter === 'all' || docFilter === 'held') && payFilter === 'all' && erpFilter === 'all') {
      for (const doc of held) {
        if (q) {
          const label = `${doc.label ?? ''} ${doc.receiptNo ?? ''} ${doc.customerName ?? ''}`.toLocaleLowerCase('tr-TR')
          if (!label.includes(q) && !amountHit(doc.totalAmount, q)) continue
        }
        rows.push({ id: doc.id, at: doc.createdAt, held: doc })
      }
    }
    rows.sort((a, b) => (a.at < b.at ? 1 : -1))
    return rows
  }, [sales, payments, held, docFilter, payFilter, erpFilter, q, barcodeHits])

  const page = listed.slice(0, limit)
  const groups = new Map<string, typeof page>()
  for (const row of page) {
    const day = istanbulDay(row.at) ?? 'tarihsiz'
    const bucket = groups.get(day) ?? []
    bucket.push(row)
    groups.set(day, bucket)
  }

  useEffect(() => {
    if (!openId || items[openId]) return
    void window.electron.db.getSaleItems(openId).then(lines => {
      setItems(prev => ({ ...prev, [openId]: lines }))
    }).catch(() => {})
  }, [openId, items])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        if (picker) return
        e.preventDefault()
        onClose()
        return
      }
      if (isEditableField(e.target) || picker || page.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocus(i => Math.min(page.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocus(i => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const row = page[Math.min(focus, page.length - 1)]
        if (!row) return
        if (row.held) onOpenHeld()
        else setOpenId(id => id === row.id ? null : row.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, page, onClose, onOpenHeld, picker])

  return (
    <div data-home-overlay="" style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'var(--pos-screen-bg)', color: 'var(--pos-text)',
      display: 'flex', flexDirection: 'column', fontVariantNumeric: 'tabular-nums',
    }}>
      <header style={head}>
        <button type="button" onClick={onClose} style={btn(false)}>← Ana Ekran</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Belge Raporu</div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>Bu kasada kesilen fiş, iade ve iptaller</div>
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
          <CountCard label="Satış" value={counts.sale} active={docFilter === 'sale'} onClick={() => setDocFilter('sale')} />
          <CountCard label="İade" value={counts.ret} active={docFilter === 'return'} onClick={() => setDocFilter('return')} />
          <CountCard label="İptal" value={counts.cancel} active={docFilter === 'cancel'} onClick={() => setDocFilter('cancel')} />
          <CountCard label="Beklemede" value={counts.held} tone={counts.held > 0 ? 'var(--pos-warning)' : undefined} active={docFilter === 'held'} onClick={() => setDocFilter('held')} />
          <CountCard label="ERP'ye gitmedi" value={counts.erp} tone={counts.erp > 0 ? 'var(--pos-danger)' : undefined} active={erpFilter === 'unsent'} onClick={() => { setDocFilter('all'); setErpFilter('unsent') }} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {([
            ['all', 'Tümü'], ['sale', 'Satış'], ['return', 'İade'], ['cancel', 'İptal'],
            ['tahsilat', 'Cari tahsilat'], ['odeme', 'Cari ödeme'],
          ] as Array<[DocFilter, string]>).map(([id, label]) => (
            <button key={id} type="button" style={btn(docFilter === id)} onClick={() => { setDocFilter(id); if (id !== 'all') setErpFilter('all') }}>{label}</button>
          ))}
          {PRESETS.map(item => (
            <button key={item.id} type="button" style={btn(!custom && preset === item.id)} onClick={() => { setCustom(null); setPreset(item.id) }}>{item.label}</button>
          ))}
          {custom ? (
            <button type="button" style={btn(true)} onClick={() => setPicker(true)}>
              📅 {formatDayRange(custom.from, custom.to)}
              <span style={{ marginLeft: 8 }} onClick={ev => { ev.stopPropagation(); setCustom(null); setPreset('today') }}>✕</span>
            </button>
          ) : (
            <button type="button" style={btn(false)} onClick={() => setPicker(true)}>📅 Tarih seç</button>
          )}
          <input data-kb="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Fiş no / tutar / müşteri / barkod" style={search} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ alignSelf: 'center', color: 'var(--pos-text-muted)', fontSize: 13 }}>Ödeme</span>
          {([
            ['all', 'Tümü'], ['cash', 'Nakit'], ['card', 'Kart'], ['split', 'Parçalı'], ['other', 'Diğer'],
          ] as Array<[PayFilter, string]>).map(([id, label]) => (
            <button key={id} type="button" style={btn(payFilter === id)} onClick={() => setPayFilter(id)}>{label}</button>
          ))}
          <span style={{ alignSelf: 'center', color: 'var(--pos-text-muted)', fontSize: 13 }}>ERP</span>
          {([
            ['all', 'Tümü'], ['sent', 'Gönderildi'], ['waiting', 'Bekliyor'], ['failed', 'Hatalı'],
          ] as Array<[ErpFilter, string]>).map(([id, label]) => (
            <button key={id} type="button" style={btn(erpFilter === id)} onClick={() => setErpFilter(id)}>{label}</button>
          ))}
        </div>

        {picker && (
          <DateRangePicker
            from={bounds.from}
            to={bounds.to}
            onClose={() => setPicker(false)}
            onApply={(from, to) => { setCustom({ from, to }); setPicker(false) }}
          />
        )}

        {page.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--pos-text-muted)', padding: 28 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🧾</div>
            Bu aralıkta belge yok
          </div>
        ) : [...groups.entries()].map(([day, rows]) => (
          <section key={day}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--pos-text-muted)', margin: '8px 0' }}>{dayHeading(day)}</div>
            {rows.map(row => {
              const index = page.indexOf(row)
              const open = openId === row.id
              if (row.held) {
                return (
                  <button key={row.id} type="button" onClick={onOpenHeld} style={{ ...card, ...rowBtn, width: '100%', marginBottom: 8, outline: focus === index ? '3px solid var(--pos-primary)' : 'none' }}>
                    <span>⏸</span>
                    <span style={{ flex: 1, textAlign: 'left', fontWeight: 700 }}>Beklemede {row.held.label || row.held.receiptNo || ''}</span>
                    <span>{istanbulClock(row.at)}</span>
                    <span>{money.format(row.held.totalAmount)}</span>
                    <span style={{ color: 'var(--pos-text-muted)' }}>Belge getir →</span>
                  </button>
                )
              }
              if (row.pay) {
                const sign = row.pay.type === 'odeme' ? -1 : 1
                return (
                  <div key={row.id} style={{ ...card, marginBottom: 8, outline: focus === index ? '3px solid var(--pos-primary)' : 'none' }}>
                    <button type="button" style={rowBtn} onClick={() => setOpenId(open ? null : row.id)}>
                      <span>{row.pay.type === 'tahsilat' ? '💰' : '💸'}</span>
                      <span style={{ flex: 1, textAlign: 'left', fontWeight: 700 }}>{row.pay.type === 'tahsilat' ? 'Cari tahsilat' : 'Cari ödeme'} {row.pay.customer_name ?? ''}</span>
                      <span>{istanbulClock(row.at)}</span>
                      <span>{money.format(sign * row.pay.amount)}</span>
                      <span>{open ? '▾' : '▸'}</span>
                    </button>
                    {open && (
                      <div style={{ padding: '4px 12px 12px', fontSize: 13, color: 'var(--pos-text-muted)' }}>
                        Kasiyer: {row.pay.cashier_name || '—'} · {row.pay.description || 'Açıklama yok'}
                      </div>
                    )}
                  </div>
                )
              }
              const sale = row.sale!
              const erp = erpView(sale)
              const lines = items[sale.id] ?? []
              return (
                <div key={row.id} style={{ ...card, marginBottom: 8, outline: focus === index ? '3px solid var(--pos-primary)' : 'none' }}>
                  <button type="button" style={rowBtn} onClick={() => { setFocus(index); setOpenId(open ? null : row.id) }}>
                    <span>{sale.isReturn ? '↩' : '🧾'}</span>
                    <span style={{ fontWeight: 700, minWidth: 110, textAlign: 'left' }}>{sale.isReturn ? 'İade' : 'Satış'} {sale.receiptNo}</span>
                    <span>{istanbulClock(sale.createdAt)}</span>
                    <span style={{ flex: 1, textAlign: 'left' }}>{payText(sale)}</span>
                    <span style={{ color: 'var(--pos-text-muted)' }}>{open && lines.length ? `${lines.length} kalem` : ''}</span>
                    <span>{money.format((sale.isReturn ? -1 : 1) * sale.netAmount)}</span>
                    <span style={{ color: erp.color, fontWeight: 700 }}>{erp.text}</span>
                    <span>{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div style={{ padding: '4px 12px 12px', fontSize: 13 }}>
                      <div>Kalemler: {lines.length === 0 ? '…' : lines.map(line => `${line.productName} ×${line.quantity} ${money.format(line.netAmount || line.price)} · KDV %${line.vatRate}`).join(' · ')}</div>
                      <div style={{ marginTop: 6 }}>
                        Ödemeler: {sale.payments.length
                          ? sale.payments.map(p => `${p.method === 'cash' ? 'Nakit' : p.method === 'card' ? 'Kart' : p.method}${p.acquirerName ? ` ${p.acquirerName}` : ''} ${money.format(p.amount)}`).join(' · ')
                          : `${sale.cashAmount ? `Nakit ${money.format(sale.cashAmount)}` : ''} ${sale.cardAmount ? `Kart ${money.format(sale.cardAmount)}` : ''}`}
                      </div>
                      <div style={{ marginTop: 6 }}>Pavo: {sale.orderNo ? `OrderNo ${sale.orderNo}` : 'OrderNo yok'} · {istanbulClock(sale.createdAt, true)}</div>
                      <div style={{ marginTop: 6 }}>Kasiyer: {sale.cashierName || '—'} · Müşteri: {sale.customerName || '—'}</div>
                      <div style={{ marginTop: 6 }}>
                        {sale.invoiceSent === 1 ? (
                          <span style={{ fontSize: 12, color: 'var(--pos-text-muted)' }}>
                            İşbaşı kimliği: {sale.invoiceId || '—'}
                          </span>
                        ) : (
                          <>ERP: {erp.text}</>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ))}
        {listed.length > limit && (
          <button type="button" style={{ ...btn(false), alignSelf: 'center' }} onClick={() => setLimit(n => n + 200)}>Daha eski kayıtlar</button>
        )}
      </div>
    </div>
  )
}

function CountCard({ label, value, tone, active, onClick }: { label: string; value: number; tone?: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...card, textAlign: 'left', cursor: 'pointer', minHeight: 72, borderColor: tone ?? 'var(--pos-border)', outline: active ? '3px solid var(--pos-primary)' : 'none' }}>
      <div style={{ fontSize: 13, color: 'var(--pos-text-muted)' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: tone ?? 'var(--pos-text)' }}>{value}</div>
    </button>
  )
}

const card: CSSProperties = {
  background: 'var(--pos-surface)',
  color: 'var(--pos-text)',
  border: '1px solid var(--pos-border)',
  borderRadius: 12,
  padding: 12,
}

const head: CSSProperties = {
  flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px',
  background: 'var(--pos-header-bg)', color: 'var(--pos-header-text)', borderBottom: '1px solid var(--pos-border)',
}

const rowBtn: CSSProperties = {
  width: '100%', minHeight: 56, display: 'flex', alignItems: 'center', gap: 10,
  background: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer', font: 'inherit',
  fontVariantNumeric: 'tabular-nums',
}

const search: CSSProperties = {
  minHeight: 48, minWidth: 220, flex: '1 1 220px', borderRadius: 8,
  border: '1px solid var(--pos-border)', background: 'var(--pos-surface)', color: 'var(--pos-text)',
  padding: '0 12px', font: 'inherit',
}

function btn(on: boolean): CSSProperties {
  return {
    minHeight: 48, padding: '0 12px', borderRadius: 8,
    border: '1px solid var(--pos-border)',
    background: on ? 'var(--pos-primary)' : 'var(--pos-surface)',
    color: on ? 'var(--pos-primary-text)' : 'var(--pos-text)',
    cursor: 'pointer', fontWeight: 700,
  }
}

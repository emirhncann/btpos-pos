import { useCallback, useEffect, useState } from 'react'

interface PaymentRow {
  method:       string
  amount:       number
  acquirerName: string | null
}

interface SalesReportRow {
  id:           string
  receiptNo:    string
  orderNo:      string | null
  type:         'sale' | 'return' | 'payment'
  netAmount:    number
  cashAmount:   number
  cardAmount:   number
  customerName: string | null
  cashierName:  string | null
  createdAt:    string
  invoiceSent:  number
  invoiceId:    string | null
  invoiceError: string | null
  isReturn:     number
  payments:     PaymentRow[]
}

interface CariPaymentRow {
  id:            string
  type:          'tahsilat' | 'odeme'
  amount:        number
  customer_name: string | null
  customer_code: string | null
  cashier_name:  string | null
  description:   string | null
  created_at:    string
}

const METHOD_LABEL: Record<string, string> = {
  cash:      '💵 Nakit',
  card:      '💳 Kart',
  meal_card: '🍽️ Yemek Kartı',
}

const INVOICE_STATUS = (sent: number, error: string | null) => {
  if (sent === 1) return { label: '✓ Gönderildi', color: '#2E7D32', bg: '#E8F5E9' }
  if (sent === 2 || error) return { label: '✗ Hata', color: '#C62828', bg: '#FFEBEE' }
  return { label: '⏳ Bekliyor', color: '#E65100', bg: '#FFF3E0' }
}

function todayStr() { return new Date().toISOString().slice(0, 10) }
function fmt(n: number) {
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺'
}

export function SalesReportScreen({ companyId }: { companyId: string }) {
  const [sales,      setSales]      = useState<SalesReportRow[]>([])
  const [payments,   setPayments]   = useState<CariPaymentRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [dateFrom,   setDateFrom]   = useState(todayStr())
  const [dateTo,     setDateTo]     = useState(todayStr())
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())
  const [typeFilter, setTypeFilter] = useState<'all' | 'sale' | 'return'>('all')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p] = await Promise.all([
        window.electron.db.getSalesReport({ dateFrom, dateTo }),
        window.electron.db.getCariPayments({ dateFrom, dateTo, companyId }),
      ])
      setSales(s as SalesReportRow[])
      setPayments(p as CariPaymentRow[])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, companyId])

  useEffect(() => { void reload() }, [reload])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = sales.filter(s =>
    typeFilter === 'all' ? true :
    typeFilter === 'return' ? s.isReturn === 1 :
    s.isReturn === 0,
  )

  const totalSales    = filtered.filter(s => !s.isReturn).reduce((a, s) => a + s.netAmount, 0)
  const totalReturns  = filtered.filter(s =>  s.isReturn).reduce((a, s) => a + s.netAmount, 0)
  const totalCash     = filtered.reduce((a, s) => a + s.cashAmount, 0)
  const totalCard     = filtered.reduce((a, s) => a + s.cardAmount, 0)
  const totalTahsilat = payments.filter(p => p.type === 'tahsilat').reduce((a, p) => a + p.amount, 0)
  const totalOdeme    = payments.filter(p => p.type === 'odeme').reduce((a, p) => a + p.amount, 0)

  return (
    <div style={{ padding: 20, maxWidth: 860, margin: '0 auto' }}>

      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Belge Raporu</h2>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '4px 0 0' }}>
            Satışlar, iadeler ve tahsilat/ödeme
          </p>
        </div>
        <button type="button" onClick={() => void reload()}
          style={{ background: '#F3F4F6', border: '1px solid #E5E7EB',
            borderRadius: 8, padding: '7px 14px', fontSize: 12,
            cursor: 'pointer', color: '#374151' }}>
          ↺ Yenile
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14,
        alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6,
            border: '1px solid #E5E7EB' }} />
        <span style={{ color: '#9CA3AF', fontSize: 12 }}>—</span>
        <input type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6,
            border: '1px solid #E5E7EB' }} />
        <button type="button"
          onClick={() => { setDateFrom(todayStr()); setDateTo(todayStr()) }}
          style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6,
            border: '1px solid #E5E7EB', background: 'white',
            color: '#6B7280', cursor: 'pointer' }}>
          Bugün
        </button>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {([['all','Tümü'],['sale','Satış'],['return','İade']] as const).map(([k,l]) => (
            <button key={k} type="button" onClick={() => setTypeFilter(k)}
              style={{ padding: '5px 10px', borderRadius: 16, fontSize: 11,
                border: '1px solid', cursor: 'pointer',
                background: typeFilter === k ? '#374151' : 'white',
                color:      typeFilter === k ? 'white'   : '#374151',
                borderColor:typeFilter === k ? '#374151' : '#E5E7EB' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Toplam Satış',  value: fmt(totalSales),    color: '#1565C0', bg: '#EFF6FF' },
          { label: 'Toplam İade',   value: fmt(totalReturns),  color: '#C62828', bg: '#FEF2F2' },
          { label: 'Nakit',         value: fmt(totalCash),     color: '#2E7D32', bg: '#E8F5E9' },
          { label: 'Kart',          value: fmt(totalCard),     color: '#6A1B9A', bg: '#F3E5F5' },
          { label: 'Tahsilat',      value: fmt(totalTahsilat), color: '#2E7D32', bg: '#E8F5E9' },
          { label: 'Ödeme',         value: fmt(totalOdeme),    color: '#C62828', bg: '#FEF2F2' },
        ].map(c => (
          <div key={c.label} style={{ background: c.bg, borderRadius: 10,
            padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: c.color, marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {payments.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            💰 Cari Tahsilat / Ödeme
          </div>
          {payments.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center',
              gap: 10, padding: '10px 14px', borderRadius: 8,
              background: 'white', border: '1px solid #E5E7EB', marginBottom: 4 }}>
              <div style={{ fontSize: 18 }}>
                {p.type === 'tahsilat' ? '💰' : '💸'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {p.type === 'tahsilat' ? 'Tahsilat' : 'Ödeme'}
                  {p.customer_name && ` — ${p.customer_name}`}
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                  {new Date(p.created_at).toLocaleString('tr-TR')}
                  {p.cashier_name && ` · ${p.cashier_name}`}
                  {p.description && ` · ${p.description}`}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700,
                color: p.type === 'tahsilat' ? '#2E7D32' : '#C62828' }}>
                {p.type === 'tahsilat' ? '+' : '−'}{fmt(p.amount)}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
          Yükleniyor...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>
          Bu tarihte işlem bulunamadı
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {filtered.map(sale => {
            const isExpanded = expanded.has(sale.id)
            const inv = INVOICE_STATUS(sale.invoiceSent, sale.invoiceError)

            return (
              <div key={sale.id} style={{ background: 'white',
                border: `1px solid ${sale.isReturn ? '#FECACA' : '#E5E7EB'}`,
                borderRadius: 10, overflow: 'hidden' }}>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpand(sale.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(sale.id) }}
                  style={{ padding: '12px 16px', display: 'flex',
                    alignItems: 'center', gap: 10, cursor: 'pointer',
                    background: sale.isReturn ? '#FFF5F5' : 'white' }}>

                  <div style={{ fontSize: 18 }}>
                    {sale.isReturn ? '↩️' : '🧾'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700,
                        color: sale.isReturn ? '#DC2626' : '#111827',
                        fontFamily: 'monospace' }}>
                        {sale.orderNo || `#${sale.receiptNo}`}
                      </span>
                      {sale.customerName && (
                        <span style={{ fontSize: 11, color: '#6B7280' }}>
                          · {sale.customerName}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>
                      {new Date(sale.createdAt).toLocaleString('tr-TR')}
                      {sale.cashierName && ` · ${sale.cashierName}`}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700,
                      color: sale.isReturn ? '#DC2626' : '#111827' }}>
                      {sale.isReturn ? '−' : ''}{fmt(sale.netAmount)}
                    </div>
                  </div>

                  <div style={{ background: inv.bg, color: inv.color,
                    borderRadius: 6, padding: '3px 8px',
                    fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                    {inv.label}
                  </div>

                  <div style={{ color: '#9CA3AF', fontSize: 12, flexShrink: 0 }}>
                    {isExpanded ? '▲' : '▼'}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid #F3F4F6',
                    padding: '8px 16px 12px', background: '#FAFAFA' }}>
                    {sale.payments.length > 0 ? (
                      sale.payments.map((p, i) => (
                        <div key={i} style={{ display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center', padding: '5px 0',
                          borderBottom: i < sale.payments.length - 1
                            ? '1px solid #F3F4F6' : 'none' }}>
                          <span style={{ fontSize: 12, color: '#374151' }}>
                            {METHOD_LABEL[p.method] ?? p.method}
                            {p.acquirerName && (
                              <span style={{ color: '#9CA3AF', marginLeft: 6 }}>
                                {p.acquirerName}
                              </span>
                            )}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600,
                            color: '#111827' }}>
                            {fmt(p.amount)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <>
                        {sale.cashAmount > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between',
                            padding: '5px 0' }}>
                            <span style={{ fontSize: 12 }}>💵 Nakit</span>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>
                              {fmt(sale.cashAmount)}
                            </span>
                          </div>
                        )}
                        {sale.cardAmount > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between',
                            padding: '5px 0' }}>
                            <span style={{ fontSize: 12 }}>💳 Kart</span>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>
                              {fmt(sale.cardAmount)}
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {sale.invoiceError && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#C62828',
                        background: '#FEF2F2', padding: '4px 8px', borderRadius: 4 }}>
                        ✕ {sale.invoiceError}
                      </div>
                    )}
                    {sale.invoiceId && (
                      <div style={{ marginTop: 4, fontSize: 11, color: '#2E7D32' }}>
                        Fatura No: {sale.invoiceId}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import logoGif from '../assets/logo.gif'

const fmt = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'

const DEFAULT_PAYLOAD: SecondScreenPayload = {
  mode: 'cart_and_btpos_gif',
  items: [],
  discounts: [],
  totals: {
    subtotal: 0,
    discountTotal: 0,
    grandTotal: 0,
    totalQty: 0,
  },
  branding: {
    btposGif: 'logo.gif',
  },
  updatedAt: new Date(0).toISOString(),
}

export default function CustomerDisplayScreen() {
  const [payload, setPayload] = useState<SecondScreenPayload>(DEFAULT_PAYLOAD)
  const hasDiscounts = payload.discounts.length > 0
  const showDiscountTotal = payload.totals.discountTotal > 0

  useEffect(() => {
    void window.electron.secondScreen.getLatest()
      .then(data => {
        if (data) setPayload(data)
      })
      .catch(() => {})

    const unsubscribe = window.electron.secondScreen.onData((data) => {
      setPayload(data)
    })
    return unsubscribe
  }, [])

  return (
    <div style={{
      height: '100vh',
      display: 'grid',
      gridTemplateRows: '1fr minmax(100px, 22vh)',
      background: '#0f172a',
      color: '#e2e8f0',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 22%)',
        gap: 16,
        padding: 16,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, flexShrink: 0 }}>Sepet</h1>
          <div style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            borderRadius: 12,
            border: '1px solid #1e293b',
            background: '#111827',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 120px', padding: '10px 14px', borderBottom: '1px solid #1f2937', color: '#94a3b8', fontSize: 12, position: 'sticky', top: 0, background: '#111827', zIndex: 1 }}>
              <span>Ürün</span>
              <span style={{ textAlign: 'center' }}>Adet</span>
              <span style={{ textAlign: 'right' }}>Tutar</span>
            </div>
            {payload.items.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Sepet bekleniyor...</div>
            ) : payload.items.map((item, idx) => (
              <div
                key={`${item.name}-${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 72px 120px',
                  padding: '10px 14px',
                  borderBottom: idx === payload.items.length - 1 ? 'none' : '1px solid #1f2937',
                }}
              >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                <span style={{ textAlign: 'center', color: '#93c5fd' }}>{item.qty}</span>
                <span style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.lineTotal)}</span>
              </div>
            ))}
          </div>
        </div>

        <aside style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 0,
          overflowY: 'auto',
          paddingLeft: 4,
          borderLeft: '1px solid #1e293b',
        }}>
          <div style={{ fontSize: 14, color: '#93c5fd', flexShrink: 0 }}>
            Toplam adet: <strong style={{ color: '#e2e8f0' }}>{payload.totals.totalQty}</strong>
          </div>

          {hasDiscounts && (
            <div style={{ borderRadius: 12, border: '1px solid #1e293b', background: '#111827', padding: 12, flexShrink: 0 }}>
              <div style={{ fontSize: 13, color: '#93c5fd', marginBottom: 8 }}>İndirimler</div>
              {payload.discounts.map((discount, idx) => (
                <div key={`${discount.label}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6, fontSize: 13 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {discount.scope === 'line' ? `Satır: ${discount.label}` : discount.label}
                  </span>
                  <span style={{ color: '#fca5a5', flexShrink: 0 }}>- {fmt(discount.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
            <div style={{ borderRadius: 10, padding: 12, background: '#111827', border: '1px solid #1e293b' }}>
              <div style={{ color: '#94a3b8', fontSize: 12 }}>Ara toplam</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(payload.totals.subtotal)}</div>
            </div>
            {showDiscountTotal && (
              <div style={{ borderRadius: 10, padding: 12, background: '#111827', border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 12 }}>Toplam indirim</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fca5a5' }}>{fmt(payload.totals.discountTotal)}</div>
              </div>
            )}
            <div style={{ borderRadius: 10, padding: 14, background: '#1e293b', border: '1px solid #334155' }}>
              <div style={{ color: '#bfdbfe', fontSize: 12 }}>Genel toplam</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc' }}>{fmt(payload.totals.grandTotal)}</div>
            </div>
          </div>
        </aside>
      </div>

      <div style={{
        borderTop: '1px solid #1f2937',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#020617',
        flexShrink: 0,
      }}>
        <img src={logoGif} alt="BTPOS Logo" style={{ maxHeight: 'min(120px, 18vh)', width: 'auto', objectFit: 'contain' }} />
      </div>
    </div>
  )
}

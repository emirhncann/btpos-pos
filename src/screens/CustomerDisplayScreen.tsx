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
      gridTemplateRows: '1fr 170px',
      background: '#0f172a',
      color: '#e2e8f0',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ padding: 20, overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr auto auto', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Sepet</h1>
          <span style={{ fontSize: 15, color: '#93c5fd' }}>Toplam Adet: {payload.totals.totalQty}</span>
        </div>

        <div style={{
          overflowY: 'auto',
          borderRadius: 12,
          border: '1px solid #1e293b',
          background: '#111827',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 140px', padding: '10px 14px', borderBottom: '1px solid #1f2937', color: '#94a3b8', fontSize: 12 }}>
            <span>Urun</span>
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
                gridTemplateColumns: '1fr 90px 140px',
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

        <div style={{ borderRadius: 12, border: '1px solid #1e293b', background: '#111827', padding: 12 }}>
          <div style={{ fontSize: 13, color: '#93c5fd', marginBottom: 8 }}>Indirimler</div>
          {payload.discounts.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>Indirim yok</div>
          ) : (
            payload.discounts.map((discount, idx) => (
              <div key={`${discount.label}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 }}>
                <span>{discount.scope === 'line' ? `Satir: ${discount.label}` : discount.label}</span>
                <span style={{ color: '#fca5a5' }}>- {fmt(discount.amount)}</span>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div style={{ borderRadius: 10, padding: 12, background: '#111827', border: '1px solid #1e293b' }}>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>Ara Toplam</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(payload.totals.subtotal)}</div>
          </div>
          <div style={{ borderRadius: 10, padding: 12, background: '#111827', border: '1px solid #1e293b' }}>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>Toplam Indirim</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fca5a5' }}>{fmt(payload.totals.discountTotal)}</div>
          </div>
          <div style={{ borderRadius: 10, padding: 12, background: '#1e293b', border: '1px solid #334155' }}>
            <div style={{ color: '#bfdbfe', fontSize: 12 }}>Genel Toplam</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc' }}>{fmt(payload.totals.grandTotal)}</div>
          </div>
        </div>
      </div>

      <div style={{
        borderTop: '1px solid #1f2937',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#020617',
      }}>
        <img src={logoGif} alt="BTPOS Logo" style={{ maxHeight: 120, width: 'auto', objectFit: 'contain' }} />
      </div>
    </div>
  )
}

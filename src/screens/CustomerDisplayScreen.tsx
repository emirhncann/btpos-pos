import { useEffect, useRef, useState } from 'react'
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
  const listRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (payload.items.length === 0) return
    const el = listRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [payload.items.length, payload.updatedAt])

  const stripColor = '#0f172a'

  return (
    <div style={{
      height: '100vh',
      display: 'grid',
      gridTemplateRows: 'minmax(72px, 18vh) 1fr 10px',
      background: '#f1f5f9',
      color: '#0f172a',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: stripColor,
        flexShrink: 0,
        padding: '8px 16px',
      }}>
        <img src={logoGif} alt="BTPOS Logo" style={{ maxHeight: 'min(100px, 16vh)', width: 'auto', objectFit: 'contain' }} />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 22%)',
        gap: 16,
        padding: 16,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, flexShrink: 0, color: '#0f172a' }}>Sepet</h1>
          <div
            ref={listRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
            }}
          >
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 72px 120px',
              padding: '10px 14px',
              borderBottom: '1px solid #e2e8f0',
              color: '#64748b',
              fontSize: 12,
              fontWeight: 600,
              position: 'sticky',
              top: 0,
              background: '#f8fafc',
              zIndex: 1,
            }}
            >
              <span>Ürün</span>
              <span style={{ textAlign: 'center' }}>Adet</span>
              <span style={{ textAlign: 'right' }}>Tutar</span>
            </div>
            {payload.items.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Sepet bekleniyor...</div>
            ) : payload.items.map((item, idx) => (
              <div
                key={`${item.name}-${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 72px 120px',
                  padding: '10px 14px',
                  borderBottom: idx === payload.items.length - 1 ? 'none' : '1px solid #f1f5f9',
                  background: idx % 2 === 0 ? '#ffffff' : '#fafbfc',
                }}
              >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#0f172a' }}>{item.name}</span>
                <span style={{ textAlign: 'center', color: '#2563eb', fontWeight: 600 }}>{item.qty}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{fmt(item.lineTotal)}</span>
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
          paddingLeft: 12,
          borderLeft: '1px solid #e2e8f0',
        }}>
          <div style={{ fontSize: 14, color: '#475569', flexShrink: 0 }}>
            Toplam adet: <strong style={{ color: '#0f172a' }}>{payload.totals.totalQty}</strong>
          </div>

          {hasDiscounts && (
            <div style={{
              borderRadius: 12,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              padding: 12,
              flexShrink: 0,
            }}
            >
              <div style={{ fontSize: 13, color: '#991b1b', marginBottom: 8, fontWeight: 600 }}>İndirimler</div>
              {payload.discounts.map((discount, idx) => (
                <div key={`${discount.label}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6, fontSize: 13 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#7f1d1d' }}>
                    {discount.scope === 'line' ? `Satır: ${discount.label}` : discount.label}
                  </span>
                  <span style={{ color: '#dc2626', flexShrink: 0, fontWeight: 600 }}>- {fmt(discount.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
            <div style={{ borderRadius: 10, padding: 12, background: '#ffffff', border: '1px solid #e2e8f0' }}>
              <div style={{ color: '#64748b', fontSize: 'clamp(10px, 0.8vw, 14px)' }}>Ara toplam</div>
              <div style={{ fontSize: 'clamp(14px, 1.5vw, 24px)', fontWeight: 700, color: '#0f172a', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(payload.totals.subtotal)}</div>
            </div>
            {showDiscountTotal && (
              <div style={{ borderRadius: 10, padding: 12, background: '#fef2f2', border: '1px solid #fecaca' }}>
                <div style={{ color: '#991b1b', fontSize: 'clamp(10px, 0.8vw, 14px)' }}>Toplam indirim</div>
                <div style={{ fontSize: 'clamp(14px, 1.5vw, 24px)', fontWeight: 700, color: '#dc2626', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(payload.totals.discountTotal)}</div>
              </div>
            )}
            <div style={{ borderRadius: 10, padding: 14, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
              <div style={{ color: '#1d4ed8', fontSize: 'clamp(10px, 0.8vw, 14px)', fontWeight: 600 }}>Genel toplam</div>
              <div style={{ fontSize: 'clamp(18px, 2.5vw, 48px)', fontWeight: 800, color: '#1e40af', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(payload.totals.grandTotal)}</div>
            </div>
          </div>
        </aside>
      </div>

      <div
        aria-hidden
        style={{
          background: stripColor,
          minHeight: 10,
          flexShrink: 0,
        }}
      />
    </div>
  )
}

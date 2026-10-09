import { useEffect, useRef, useState } from 'react'
import logoGif from '../assets/logo.gif'
import { DiscountLine } from '../components/DiscountLine'
import { C } from '../theme/colors'

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
  const docDiscounts = payload.discounts.filter(d => d.scope === 'document')

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
              gridTemplateColumns: '1fr 140px',
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
              <span style={{ textAlign: 'right' }}>Tutar</span>
            </div>
            {payload.items.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.disabledFg }}>Sepet bekleniyor...</div>
            ) : payload.items.map((item, idx) => {
              const gross = item.gross ?? item.lineTotal
              const disc = item.discountAmount ?? 0
              const hasDisc = disc > 0.009
              const rate = item.discountRate ?? 0
              return (
                <div
                  key={`${item.name}-${idx}`}
                  style={{
                    padding: '10px 14px',
                    borderBottom: idx === payload.items.length - 1 ? 'none' : '1px solid #f1f5f9',
                    background: idx % 2 === 0 ? C.surface : '#fafbfc',
                  }}
                >
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 140px',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: C.text, fontWeight: 700 }}>{item.name}</span>
                      <span style={{ display: 'block', color: C.textMuted, fontSize: 14, marginTop: 2 }}>
                        {item.qty}{item.unitPrice != null ? ` × ${fmt(item.unitPrice)}` : ''}
                      </span>
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      {hasDisc && (
                        <div style={{ fontSize: 13, color: C.textMuted, textDecoration: 'line-through', fontWeight: 500 }}>{fmt(gross)}</div>
                      )}
                      <div style={{ fontWeight: 700, color: C.text }}>{fmt(item.lineTotal)}</div>
                    </span>
                  </div>
                  {hasDisc && (
                    <div style={{ marginTop: 6 }}>
                      <DiscountLine
                        label={rate > 0 ? `İndirim %${rate}` : 'İndirim'}
                        amount={`−${fmt(disc)}`}
                        fontSize={16}
                      />
                    </div>
                  )}
                </div>
              )
            })}
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
            Toplam adet: <strong style={{ color: '#0f172a' }}>
              {Number.isInteger(payload.totals.totalQty)
                ? payload.totals.totalQty
                : parseFloat(payload.totals.totalQty.toFixed(3))}
            </strong>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
            <div style={{ borderRadius: 10, padding: 12, background: C.surface, border: `1px solid ${C.border}` }}>
              <div style={{ color: C.textMuted, fontSize: 'clamp(10px, 0.8vw, 14px)' }}>Ara toplam</div>
              <div style={{ fontSize: 'clamp(14px, 1.5vw, 24px)', fontWeight: 700, color: C.text, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(payload.totals.subtotal)}</div>
            </div>
            {docDiscounts.map((discount, idx) => (
              <DiscountLine
                key={`${discount.label}-${idx}`}
                label={discount.rate && discount.rate > 0 ? `Belge indirimi %${discount.rate}` : (discount.label || 'Belge indirimi')}
                amount={`−${fmt(discount.amount)}`}
                fontSize={16}
              />
            ))}
            <div style={{ borderRadius: 10, padding: 14, background: C.surface, border: `1px solid ${C.border}` }}>
              <div style={{ color: C.primary, fontSize: 'clamp(10px, 0.8vw, 14px)', fontWeight: 700 }}>TOPLAM</div>
              <div style={{ fontSize: 'clamp(18px, 2.5vw, 48px)', fontWeight: 800, color: C.primary, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(payload.totals.grandTotal)}</div>
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

import { useEffect, useState } from 'react'
import {
  getSaleCompleted,
  hideSaleCompleted,
  saleCompletedMs,
  subscribeSaleCompleted,
  type SaleCompletedPayload,
} from '../store/saleCompleted'

const money = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'

export function SaleCompletedDialog() {
  const [payload, setPayload] = useState<SaleCompletedPayload | null>(getSaleCompleted())

  useEffect(() => subscribeSaleCompleted(setPayload), [])

  useEffect(() => {
    if (!payload) return
    const ms = saleCompletedMs(payload.changeAmount)
    const timer = window.setTimeout(hideSaleCompleted, ms)
    let buf = ''
    let gap: ReturnType<typeof setTimeout> | null = null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const code = buf
        buf = ''
        if (gap) clearTimeout(gap)
        hideSaleCompleted()
        if (code.length >= 2) {
          window.dispatchEvent(new CustomEvent('btpos-completed-barcode', { detail: code }))
        }
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buf += e.key
        if (gap) clearTimeout(gap)
        gap = setTimeout(() => { buf = '' }, 150)
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(timer)
      if (gap) clearTimeout(gap)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [payload])

  if (!payload) return null
  const ms = saleCompletedMs(payload.changeAmount)
  const change = payload.changeAmount > 0.009

  return (
    <div
      onMouseDown={() => hideSaleCompleted()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <style>{`
        @keyframes saleDoneDrain {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }
      `}</style>
      <div
        style={{
          width: 'min(440px, 100%)',
          background: 'var(--pos-surface)',
          color: 'var(--pos-text)',
          borderRadius: 16,
          padding: '32px 28px 22px',
          textAlign: 'center',
          boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
        }}
      >
        <div style={{ fontSize: 48, color: 'var(--pos-success)', lineHeight: 1 }}>✓</div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>Satış tamamlandı</div>
        {payload.recovered && (
          <div style={{ fontSize: 13, color: 'var(--pos-text-muted)', marginTop: 6 }}>
            Yarım kalan satış tamamlandı
          </div>
        )}
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
          <Row label="Toplam" value={money(payload.total)} />
          {payload.payments.map((p, i) => (
            <Row key={`${p.label}-${i}`} label={p.label} value={money(p.amount)} />
          ))}
          {change && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 800 }}>PARA ÜSTÜ</span>
              <span style={{ fontSize: 28, fontWeight: 800 }}>{money(payload.changeAmount)}</span>
            </div>
          )}
        </div>
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--pos-text-muted)', wordBreak: 'break-all', lineHeight: 1.4 }}>
          Sipariş no: {payload.orderNo}
        </div>
        <button
          type="button"
          onClick={() => hideSaleCompleted()}
          style={{
            marginTop: 18,
            minWidth: 180,
            minHeight: 48,
            border: 'none',
            borderRadius: 10,
            background: 'var(--pos-success)',
            color: '#FFFFFF',
            fontWeight: 800,
            fontSize: 16,
            cursor: 'pointer',
          }}
        >Tamam</button>
        <div style={{ marginTop: 14, height: 8, borderRadius: 99, background: 'var(--pos-border)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: '100%',
            background: 'var(--pos-success)',
            transformOrigin: 'left center',
            animation: `saleDoneDrain ${ms}ms linear forwards`,
          }} />
        </div>
      </div>
    </div>
  )
}

function Row(props: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 16 }}>
      <span>{props.label}</span>
      <span style={{ fontWeight: 700 }}>{props.value}</span>
    </div>
  )
}

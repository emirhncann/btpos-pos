import { useEffect, useState } from 'react'
import { getPavoLockInfo, getPavoPhase, subscribePavoLock, type PavoPhase } from '../store/pavoLock'

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function PavoLockOverlay(props: {
  onQuery: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  const [phase, setPhase] = useState<PavoPhase>(getPavoPhase())
  const [now, setNow] = useState(() => Date.now())
  const [, bump] = useState(0)

  useEffect(() => subscribePavoLock(() => {
    setPhase(getPavoPhase())
    bump(n => n + 1)
  }), [])

  useEffect(() => {
    if (phase !== 'sending' && phase !== 'completing') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [phase])

  if (phase !== 'sending' && phase !== 'completing' && phase !== 'error') return null

  const info = getPavoLockInfo()
  const elapsed = clock(now - (info.startedAt ?? now))
  const showWaitActions = phase === 'sending' && now - (info.startedAt ?? now) >= 60_000
  const amount = info.amount != null
    ? info.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 10040,
      background: 'rgba(15, 23, 42, 0.72)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: 'min(520px, 100%)',
        background: 'var(--pos-surface)',
        color: 'var(--pos-text)',
        borderRadius: 16,
        padding: '36px 28px',
        textAlign: 'center',
        boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
      }}>
        <div style={{ fontSize: 42, marginBottom: 8 }}>{phase === 'error' ? '⚠' : '⏳'}</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
          {phase === 'completing'
            ? 'Satış kaydediliyor…'
            : phase === 'error'
              ? 'Pavo işlemi tamamlanamadı'
              : 'Pavo cihazında işlem bekleniyor'}
        </div>
        {phase === 'error' && info.message && (
          <div style={{ fontSize: 14, color: 'var(--pos-warning)', marginBottom: 14 }}>{info.message}</div>
        )}
        {phase === 'sending' && info.message && (
          <div style={{ fontSize: 14, marginBottom: 10 }}>{info.message}</div>
        )}
        {phase !== 'error' && (amount || info.method) && (
          <div style={{ fontSize: 16, marginBottom: 8 }}>
            {amount ? `Tutar: ${amount} ₺` : ''}
            {amount && info.method ? '   ·   ' : ''}
            {info.method ?? ''}
          </div>
        )}
        {phase !== 'error' && (
          <div style={{ fontSize: 14, color: 'var(--pos-text-muted)', marginBottom: 18 }}>
            Geçen süre: {elapsed}
          </div>
        )}
        {phase === 'error' && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <OverlayBtn label="Durumu sorgula" onClick={props.onQuery} />
            <OverlayBtn label="Tekrar dene" onClick={props.onRetry} primary />
            <OverlayBtn label="İşlemi iptal et" onClick={props.onCancel} />
          </div>
        )}
        {showWaitActions && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <OverlayBtn label="Durumu sorgula" onClick={props.onQuery} primary />
            <OverlayBtn label="İşlemi iptal et" onClick={props.onCancel} />
          </div>
        )}
      </div>
    </div>
  )
}

function OverlayBtn(props: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        minHeight: 44,
        padding: '10px 14px',
        borderRadius: 10,
        border: props.primary ? 'none' : '1px solid var(--pos-border)',
        background: props.primary ? 'var(--pos-primary)' : 'var(--pos-surface-alt)',
        color: props.primary ? 'var(--pos-primary-text)' : 'var(--pos-text)',
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >{props.label}</button>
  )
}

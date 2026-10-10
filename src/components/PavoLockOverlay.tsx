import { useEffect, useState } from 'react'
import { canCancelRecovery, getRecoveryInfo, requestRecoveryNow, shownRecoveryState, subscribeRecovery, type RecoveryInfo, type RecoveryView } from '../lib/pavoRecovery'
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
  onResend: () => void
  onCollect: () => void
}) {
  const [phase, setPhase] = useState<PavoPhase>(getPavoPhase())
  const [recovery, setRecovery] = useState<RecoveryInfo>(getRecoveryInfo())
  const [now, setNow] = useState(() => Date.now())
  const [, bump] = useState(0)

  useEffect(() => subscribePavoLock(() => {
    setPhase(getPavoPhase())
    bump(n => n + 1)
  }), [])

  useEffect(() => subscribeRecovery(setRecovery), [])

  useEffect(() => {
    if (phase !== 'sending' && phase !== 'completing' && phase !== 'error') return
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
        {phase === 'completing' && info.message && (
          <div style={{ fontSize: 14, marginBottom: 10 }}>{info.message}</div>
        )}
        {phase === 'error' && (
          <div style={{ fontSize: 15, lineHeight: 1.45, marginBottom: 12 }}>{recoveryText(shownRecoveryState(recovery, now), recovery)}</div>
        )}
        {phase === 'error' && info.message && (
          <div style={{ fontSize: 13, color: 'var(--pos-warning)', marginBottom: 12 }}>{info.message}</div>
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
          <>
            <div style={{ fontSize: 12, color: 'var(--pos-text-muted)', marginBottom: 8 }}>
              Otomatik kontrol · deneme {recovery.attempt || 0}
              {recovery.lastCheck ? ` · son kontrol ${recovery.lastCheck.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
              {` · sonraki ${Math.round(recovery.nextDelayMs / 1000)} sn`}
            </div>
            {now - (info.startedAt ?? now) >= 5 * 60 * 1000 && (
              <div style={{ fontSize: 13, color: 'var(--pos-warning)', marginBottom: 12 }}>
                Sorun sürüyorsa Pavo cihazını yeniden başlatın. Kasa otomatik denemeye devam edecek.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {recoveryButtons(shownRecoveryState(recovery, now), canCancelRecovery(recovery, now), props)}
            </div>
          </>
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

function money(n: number): string {
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'
}

function recoveryText(state: RecoveryView, info: RecoveryInfo): string {
  if (state === 'waiting_device') return '💳 Pavo cihazı ödeme bekliyor. Müşteri kartını okutsun.'
  if (state === 'stale_waiting') return '⚠ Pavo bu satışı hâlâ "ödeme bekliyor" gösteriyor ama cihazda işlem görünmüyor olabilir. Cihaz ekranına bakın.'
  if (state === 'no_payment') return 'ℹ️ Ödeme alınmamış.'
  if (state === 'partial') {
    const left = Math.max(0, info.saleTotal - info.paidTotal)
    return `💳 ${money(info.paidTotal)} alındı, kalan ${money(left)}.`
  }
  if (state === 'unreachable') return '📡 Pavo\'ya ulaşılamıyor. Cihazın açık ve ağa bağlı olduğunu kontrol edin. Otomatik denemeye devam ediliyor.'
  if (state === 'completing') return '✓ Ödeme alınmış, satış kaydediliyor…'
  return '🔄 Pavo\'dan satışın durumu soruluyor…'
}

function recoveryButtons(
  state: RecoveryView,
  cancelOk: boolean,
  props: { onCancel: () => void; onRetry: () => void; onResend: () => void; onCollect: () => void },
) {
  const query = <OverlayBtn key="q" label="Şimdi sorgula" onClick={() => requestRecoveryNow()} />
  const cancel = <OverlayBtn key="c" label="Satışı iptal et" onClick={props.onCancel} />
  if (state === 'stale_waiting') {
    return <>
      <OverlayBtn label="Ödemeyi tekrar gönder" onClick={props.onResend} primary />
      {cancel}
      {query}
    </>
  }
  if (state === 'no_payment') {
    return <>
      <OverlayBtn label="Tekrar dene" onClick={props.onRetry} primary />
      {cancel}
    </>
  }
  if (state === 'partial') {
    return <>
      <OverlayBtn label="Kalan ödemeyi al" onClick={props.onCollect} primary />
      {query}
    </>
  }
  if (state === 'unreachable') {
    return <>
      {query}
      {cancelOk ? cancel : null}
    </>
  }
  if (state === 'completing') return null
  return query
}

function OverlayBtn(props: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
      style={{
        minHeight: 44,
        padding: '10px 14px',
        borderRadius: 10,
        border: props.primary ? 'none' : '1px solid var(--pos-border)',
        background: props.disabled ? 'var(--pos-disabled-bg)' : props.primary ? 'var(--pos-primary)' : 'var(--pos-surface-alt)',
        color: props.disabled ? 'var(--pos-disabled-fg)' : props.primary ? 'var(--pos-primary-text)' : 'var(--pos-text)',
        fontWeight: 700,
        cursor: props.disabled ? 'default' : 'pointer',
      }}
    >{props.label}</button>
  )
}

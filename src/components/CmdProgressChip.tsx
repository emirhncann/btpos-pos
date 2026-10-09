import { useEffect, useRef, useState } from 'react'
import { cmdProgress, type CmdProgressState } from '../lib/cmdProgress'

const HIDE_MS = 4000

function statusMark(status: CmdProgressState['items'][number]['status']): string {
  if (status === 'done') return '✓'
  if (status === 'running') return '🔄'
  if (status === 'failed') return '✕'
  return '⏳'
}

function statusText(item: CmdProgressState['items'][number]): string {
  if (item.status === 'done') return 'tamamlandı'
  if (item.status === 'running') return 'güncelleniyor…'
  if (item.status === 'failed') return `hata: ${item.error ?? ''}`.trim()
  return 'sırada'
}

export function CmdProgressChip() {
  const [state, setState] = useState<CmdProgressState>({ items: [] })
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const btnRef = useRef<HTMLButtonElement>(null)
  const [box, setBox] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => cmdProgress.subscribe(setState), [])

  const failed = state.items.filter(i => i.status === 'failed').length
  const done = state.items.filter(i => i.status === 'done').length
  const total = state.items.length
  const runningIdx = state.items.findIndex(i => i.status === 'running')
  const waitingIdx = state.items.findIndex(i => i.status === 'waiting')
  const settled = total > 0 && state.items.every(i => i.status === 'done' || i.status === 'failed')
  const successReady = settled && failed === 0 && state.finishedAt != null

  useEffect(() => {
    if (!successReady || state.finishedAt == null) return
    const wait = Math.max(0, state.finishedAt + HIDE_MS - Date.now())
    const timer = setTimeout(() => setNow(Date.now()), wait)
    return () => clearTimeout(timer)
  }, [successReady, state.finishedAt])

  if (total === 0) return null
  if (successReady && state.finishedAt != null && now - state.finishedAt >= HIDE_MS) return null

  const running = runningIdx >= 0 ? state.items[runningIdx] : undefined
  const waiting = waitingIdx >= 0 ? state.items[waitingIdx] : undefined
  const hasError = settled && failed > 0

  let text = ''
  let pct = 0
  if (running) {
    const n = runningIdx + 1
    pct = Math.round((n / total) * 100)
    text = `🔄 ${n}/${total} · ${running.label} güncelleniyor…`
  } else if (waiting) {
    const n = waitingIdx + 1
    text = `⏳ ${n}/${total} · ${waiting.label} · sırada`
  } else if (hasError) {
    text = `⚠ ${done}/${total} tamamlandı · ${failed} hata`
  } else {
    text = `✓ ${done} güncelleme tamamlandı`
  }

  return (
    <div style={{ position: 'relative', maxWidth: 240, minWidth: 0, flexShrink: 1 }}>
      <button
        type="button"
        ref={btnRef}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect()
          if (r) setBox({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
          setOpen(v => !v)
        }}
        title={text}
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 2,
          width: '100%',
          maxWidth: 240,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: hasError ? 'var(--pos-warning)' : 'var(--pos-header-text)',
          fontSize: 11,
          lineHeight: 1.15,
          textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
        {running && (
          <span style={{ display: 'block', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }}>
            <span style={{ display: 'block', height: 3, width: `${pct}%`, borderRadius: 2, background: 'var(--pos-primary)' }} />
          </span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'fixed',
          top: box?.top ?? 48,
          right: box?.right ?? 8,
          width: 280,
          maxHeight: 320,
          overflowY: 'auto',
          zIndex: 10020,
          background: 'var(--pos-surface)',
          color: 'var(--pos-text)',
          border: '1px solid var(--pos-border)',
          borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          padding: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Merkezden gelen güncellemeler</div>
          {state.items.map(item => (
            <div key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, padding: '4px 0' }}>
              <span style={{ width: 16, flexShrink: 0 }}>{statusMark(item.status)}</span>
              <span style={{ flex: '0 0 108px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
              <span style={{
                flex: 1,
                minWidth: 0,
                color: item.status === 'failed' ? 'var(--pos-warning)' : 'var(--pos-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{statusText(item)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              type="button"
              onClick={() => { cmdProgress.clear(); setOpen(false) }}
              style={{
                border: '1px solid var(--pos-border)',
                background: 'var(--pos-surface-alt)',
                color: 'var(--pos-text)',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >Kapat</button>
          </div>
        </div>
      )}
    </div>
  )
}

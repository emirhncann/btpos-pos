import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { istanbulToday } from '../lib/commandView'

const WEEKDAYS = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']

function monthCells(year: number, month: number): Array<{ key: string; label: string; inMonth: boolean }> {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<{ key: string; label: string; inMonth: boolean }> = []
  for (let i = 0; i < lead; i++) cells.push({ key: `pad-${i}`, label: '', inMonth: false })
  for (let day = 1; day <= days; day++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({ key, label: String(day), inMonth: true })
  }
  return cells
}

export function DateRangePicker({
  from,
  to,
  onApply,
  onClose,
}: {
  from: string
  to: string
  onApply: (from: string, to: string) => void
  onClose: () => void
}) {
  const today = istanbulToday()
  const [cursor, setCursor] = useState(() => from.slice(0, 7) || today.slice(0, 7))
  const [start, setStart] = useState(from)
  const [end, setEnd] = useState(to)
  const [year, month] = cursor.split('-').map(Number)
  const cells = useMemo(() => monthCells(year, month), [year, month])
  const title = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1, 12)),
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function pick(key: string) {
    if (key > today) return
    if (!start || (start && end)) {
      setStart(key)
      setEnd('')
      return
    }
    if (key < start) {
      setEnd(start)
      setStart(key)
      return
    }
    setEnd(key)
  }

  function shiftMonth(delta: number) {
    const [y, m] = cursor.split('-').map(Number)
    const next = new Date(Date.UTC(y, m - 1 + delta, 1))
    setCursor(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div
      data-home-overlay=""
      style={{
        position: 'fixed', inset: 0, zIndex: 11000,
        background: 'var(--pos-scrim, rgba(0,0,0,.45))',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 360, maxWidth: '100%',
          background: 'var(--pos-surface)', color: 'var(--pos-text)',
          border: '1px solid var(--pos-border)', borderRadius: 12, padding: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button type="button" onClick={() => shiftMonth(-1)} style={navBtn}>‹</button>
          <strong style={{ textTransform: 'capitalize' }}>{title}</strong>
          <button type="button" onClick={() => shiftMonth(1)} style={navBtn}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {WEEKDAYS.map(day => (
            <div key={day} style={{ textAlign: 'center', fontSize: 12, color: 'var(--pos-text-muted)' }}>{day}</div>
          ))}
          {cells.map(cell => {
            const selected = cell.inMonth && (cell.key === start || cell.key === end || (start && end && cell.key > start && cell.key < end))
            const future = cell.inMonth && cell.key > today
            return (
              <button
                key={cell.key}
                type="button"
                disabled={!cell.inMonth || future}
                onClick={() => pick(cell.key)}
                style={{
                  minHeight: 40,
                  borderRadius: 8,
                  border: '1px solid transparent',
                  background: selected ? 'var(--pos-primary)' : 'transparent',
                  color: selected ? 'var(--pos-primary-text)' : future ? 'var(--pos-text-muted)' : 'var(--pos-text)',
                  cursor: cell.inMonth && !future ? 'pointer' : 'default',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >{cell.label}</button>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" style={navBtn} onClick={() => { setStart(''); setEnd('') }}>Temizle</button>
          <button
            type="button"
            disabled={!start || !end}
            style={{ ...navBtn, background: 'var(--pos-primary)', color: 'var(--pos-primary-text)' }}
            onClick={() => { if (start && end) onApply(start <= end ? start : end, start <= end ? end : start) }}
          >Uygula</button>
        </div>
      </div>
    </div>
  )
}

const navBtn: CSSProperties = {
  minHeight: 48,
  minWidth: 48,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid var(--pos-border)',
  background: 'var(--pos-surface)',
  color: 'var(--pos-text)',
  cursor: 'pointer',
  fontWeight: 700,
}

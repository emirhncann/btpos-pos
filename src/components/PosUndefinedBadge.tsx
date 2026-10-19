import { usePosReady } from '../store/posReady'

export function PosUndefinedBadge({ onClick }: { onClick: () => void }) {
  const ready = usePosReady()
  if (ready) return null
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'var(--pos-danger)',
        color: 'var(--pos-primary-text)',
        border: 'none',
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 800,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      ⚠ POS tanımlı değil — satış kapalı
    </button>
  )
}

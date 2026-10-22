import { useEffect, useRef } from 'react'

export interface QueueMenuItem {
  id: string
  label: string
  danger?: boolean
  separator?: boolean
}

export function QueueActionMenu({
  items,
  index,
  upward,
  anchor,
  onHover,
  onPick,
  onClose,
}: {
  items: QueueMenuItem[]
  index: number
  upward: boolean
  anchor: { top: number; left: number; bottom: number; right: number }
  onHover: (index: number) => void
  onPick: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const selectable = items.filter(item => !item.separator)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const top = upward ? undefined : anchor.bottom + 4
  const bottom = upward ? window.innerHeight - anchor.top + 4 : undefined
  const left = Math.max(8, Math.min(anchor.right - 280, window.innerWidth - 288))

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          onHover(Math.min(selectable.length - 1, index + 1))
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          onHover(Math.max(0, index - 1))
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const item = selectable[index]
          if (item) onPick(item.id)
        }
      }}
      style={{
        position: 'fixed',
        top,
        bottom,
        left,
        width: 280,
        zIndex: 10020,
        background: 'var(--pos-surface)',
        border: '1px solid var(--pos-border)',
        borderRadius: 12,
        boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
        padding: 6,
        outline: 'none',
      }}
    >
      {items.map(item => {
        if (item.separator) {
          return <div key={item.id} style={{ height: 1, margin: '6px 8px', background: 'var(--pos-border)' }} />
        }
        const selected = selectable[index]?.id === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onMouseEnter={() => onHover(selectable.findIndex(row => row.id === item.id))}
            onClick={() => onPick(item.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              minHeight: 52,
              padding: '0 12px',
              border: 'none',
              borderRadius: 8,
              background: selected ? 'var(--pos-surface-alt)' : 'transparent',
              color: item.danger ? 'var(--pos-danger)' : 'var(--pos-text)',
              font: 'inherit',
              fontSize: 15,
              fontWeight: 650,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

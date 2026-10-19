import { useEffect, useRef, useState, type ReactNode } from 'react'
import { C, solidBtn } from '../theme/colors'

const SIZES = {
  sm: 520,
  md: 720,
  lg: 960,
} as const

export function PosModal({
  title,
  size = 'md',
  onClose,
  children,
  footer,
  zIndex = 9998,
  themed = false,
}: {
  title: string
  size?: keyof typeof SIZES
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  zIndex?: number
  themed?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1280)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const root = panelRef.current
    const target = root?.querySelector<HTMLElement>('[data-autofocus]')
      ?? root?.querySelector<HTMLElement>('input, textarea, select')
      ?? root
    target?.focus()
    return () => {
      if (prev && document.contains(prev)) prev.focus()
      else document.querySelector<HTMLElement>('[data-pos-barcode]')?.focus()
    }
  }, [])

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1280)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div
      role="presentation"
      className="pos-modal-overlay"
      onClick={onClose}
      style={{
        zIndex,
        background: themed ? 'var(--pos-scrim)' : 'rgba(15,23,42,0.45)',
        padding: 16,
      }}
    >
      <div
        ref={panelRef}
        className="pos-modal"
        data-pos-popup=""
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{
          width: narrow ? '92vw' : SIZES[size],
          maxWidth: '92vw',
          background: 'var(--pos-surface)',
          borderRadius: 16,
          boxShadow: '0 18px 50px rgba(0,0,0,.28)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 20px',
          borderBottom: '1px solid var(--pos-border)',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pos-text)', lineHeight: 1.2 }}>{title}</div>
          <button
            type="button"
            className="pos-modal-close"
            data-pos-cancel=""
            onClick={onClose}
            aria-label="Kapat"
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              border: 'none',
              background: themed ? 'var(--pos-modal-close-bg)' : C.neutral,
              color: themed ? 'var(--pos-modal-close-text)' : '#FFFFFF',
              fontSize: 28,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >✕</button>
        </div>
        <div className="pos-modal-body" style={{ padding: 20, flex: 1, fontSize: 20, color: 'var(--pos-text)' }}>
          {children}
        </div>
        {footer && (
          <div style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            padding: '16px 20px 20px',
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function modalActionStyle(color: string, disabled = false): Record<string, string | number> {
  return {
    ...solidBtn(color, disabled),
    height: 72,
    minWidth: 160,
    fontSize: 20,
    padding: '0 20px',
  }
}

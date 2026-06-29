import AppLogo from './AppLogo'

export type AlertVariant = 'error' | 'warning' | 'info' | 'success'

const VARIANT_STYLE: Record<AlertVariant, {
  titleColor: string
  closeColor: string
  buttonBg:   string
}> = {
  error:   { titleColor: '#FCA5A5', closeColor: '#FCA5A5', buttonBg: '#B91C1C' },
  warning: { titleColor: '#FCD34D', closeColor: '#FCD34D', buttonBg: '#D97706' },
  info:    { titleColor: '#93C5FD', closeColor: '#93C5FD', buttonBg: '#1565C0' },
  success: { titleColor: '#86EFAC', closeColor: '#86EFAC', buttonBg: '#2E7D32' },
}

export interface AlertDialogProps {
  open:          boolean
  variant?:      AlertVariant
  title:         string
  message:       string
  confirmLabel?: string
  cancelLabel?:  string
  showCancel?:   boolean
  onConfirm:     () => void
  onCancel?:       () => void
}

export default function AlertDialog({
  open,
  variant = 'error',
  title,
  message,
  confirmLabel = 'Tamam',
  cancelLabel = 'İptal',
  showCancel = false,
  onConfirm,
  onCancel,
}: AlertDialogProps) {
  if (!open) return null

  const vs = VARIANT_STYLE[variant]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: 'white', borderRadius: 16,
        border: '1px solid #374151',
        boxShadow: '0 14px 32px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}>
        <div style={{
          background: '#111827', borderBottom: '1px solid #374151',
          padding: '12px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              height: 28, minWidth: 54, borderRadius: 8, padding: '0 8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AppLogo height={20} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: vs.titleColor }}>{title}</span>
          </div>
          <button
            type="button"
            onClick={onCancel ?? onConfirm}
            style={{ background: 'none', border: 'none', fontSize: 18, color: vs.closeColor, cursor: 'pointer' }}
          >✕</button>
        </div>

        <div style={{ padding: '14px 16px 6px', fontSize: 13, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {message}
        </div>

        <div style={{
          padding: '10px 16px 16px',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          {showCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '10px 16px', borderRadius: 9,
                border: '1px solid #D1D5DB', background: 'white',
                color: '#374151', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '10px 16px', borderRadius: 9, border: 'none',
              background: vs.buttonBg, color: 'white',
              fontWeight: 700, cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

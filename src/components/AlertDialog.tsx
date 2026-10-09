import { C } from '../theme/colors'
import { PosModal, modalActionStyle } from './PosModal'

export type AlertVariant = 'error' | 'warning' | 'info' | 'success'

const VARIANT_COLOR: Record<AlertVariant, string> = {
  error:   C.danger,
  warning: C.warning,
  info:    C.primary,
  success: C.success,
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

  return (
    <PosModal
      title={title}
      size="sm"
      zIndex={10100}
      onClose={onCancel ?? onConfirm}
      footer={
        <>
          {showCancel && (
            <button type="button" onClick={onCancel} style={modalActionStyle(C.neutral)}>
              {cancelLabel}
            </button>
          )}
          <button type="button" onClick={onConfirm} style={modalActionStyle(VARIANT_COLOR[variant])}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 20, lineHeight: 1.45, whiteSpace: 'pre-wrap', color: 'var(--pos-text)' }}>{message}</div>
    </PosModal>
  )
}

import { useCallback, useRef, useState } from 'react'
import type { AlertDialogProps, AlertVariant } from '../components/AlertDialog'

type DialogState = {
  variant:       AlertVariant
  title:         string
  message:       string
  showCancel:    boolean
  confirmLabel?: string
  cancelLabel?:  string
  resolve?:      (ok: boolean) => void
}

export function useAlertDialog() {
  const [state, setState] = useState<DialogState | null>(null)
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const close = useCallback((ok: boolean) => {
    resolveRef.current?.(ok)
    resolveRef.current = null
    setState(null)
  }, [])

  const openDialog = useCallback((opts: Omit<DialogState, 'resolve'> & { resolve?: (ok: boolean) => void }) => {
    resolveRef.current = opts.resolve ?? null
    setState({
      variant:      opts.variant,
      title:        opts.title,
      message:      opts.message,
      showCancel:   opts.showCancel,
      confirmLabel: opts.confirmLabel,
      cancelLabel:  opts.cancelLabel,
    })
  }, [])

  const showError = useCallback((title: string, message: string) => {
    openDialog({ variant: 'error', title, message, showCancel: false })
  }, [openDialog])

  const showWarning = useCallback((title: string, message: string) => {
    openDialog({ variant: 'warning', title, message, showCancel: false })
  }, [openDialog])

  const showInfo = useCallback((title: string, message: string) => {
    openDialog({ variant: 'info', title, message, showCancel: false })
  }, [openDialog])

  const showSuccess = useCallback((title: string, message: string) => {
    openDialog({ variant: 'success', title, message, showCancel: false })
  }, [openDialog])

  const confirm = useCallback((opts: {
    title?:         string
    message:        string
    confirmLabel?:  string
    cancelLabel?:   string
  }): Promise<boolean> => {
    return new Promise(resolve => {
      openDialog({
        variant:      'warning',
        title:        opts.title ?? 'Onay',
        message:      opts.message,
        showCancel:   true,
        confirmLabel: opts.confirmLabel ?? 'Evet',
        cancelLabel:  opts.cancelLabel ?? 'Hayır',
        resolve,
      })
    })
  }, [openDialog])

  const dialogProps: AlertDialogProps = {
    open:         state != null,
    variant:      state?.variant ?? 'error',
    title:        state?.title ?? '',
    message:      state?.message ?? '',
    showCancel:   state?.showCancel ?? false,
    confirmLabel: state?.confirmLabel,
    cancelLabel:  state?.cancelLabel,
    onConfirm:    () => close(true),
    onCancel:     () => close(false),
  }

  return {
    dialogProps,
    showError,
    showWarning,
    showInfo,
    showSuccess,
    confirm,
  }
}

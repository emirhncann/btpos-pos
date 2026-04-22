import { useCallback, useEffect, useRef } from 'react'
import { api, API_URL } from '../lib/api'

const POLL_INTERVAL = 15_000

export type QueueToastPayload = {
  id:     string
  type:   string
  label:  string | null
  status: 'success' | 'failed'
  error?: string | null
}

interface UseQueueWorkerOpts {
  companyId:  string
  isOnline:   boolean
  onToast:    (toast: QueueToastPayload) => void
}

export function useQueueWorker({ companyId, isOnline, onToast }: UseQueueWorkerOpts) {
  const runningRef = useRef(false)

  const processQueue = useCallback(async () => {
    if (!companyId || !isOnline || runningRef.current) return
    runningRef.current = true

    try {
      const pending = await window.electron.db.getPendingOperations(companyId)
      if (pending.length === 0) return

      for (const op of pending) {
        await window.electron.db.markOperationProcessing(op.id)
        const payload = JSON.parse(op.payload) as Record<string, unknown>

        try {
          let success = false
          let error: string | null = null

          if (op.type === 'invoice') {
            const res = await api.sendInvoiceToErp(companyId, payload as never)
            success = !!(res.success && res.invoice_id)
            error = res.message ?? null

            const sid = payload.sale_id
            if (typeof sid === 'string' && !sid.startsWith('gunsonu-')) {
              if (success && res.invoice_id) {
                await window.electron.db.markInvoiceSent(sid, String(res.invoice_id))
              } else if (!success) {
                await window.electron.db.markInvoiceError(sid, error ?? 'Hata')
              }
            }
          } else if (op.type === 'day_end_invoice') {
            const res = await api.sendInvoiceToErp(companyId, payload as never)
            success = !!(res.success && res.invoice_id)
            error = res.message ?? null

            const ids = payload.day_end_sale_ids
            if (Array.isArray(ids) && ids.every((x): x is string => typeof x === 'string')) {
              if (success && res.invoice_id) {
                for (const saleId of ids) {
                  await window.electron.db.markInvoiceSent(saleId, String(res.invoice_id))
                }
              } else if (!success) {
                for (const saleId of ids) {
                  await window.electron.db.markInvoiceError(saleId, error ?? 'Hata')
                }
              }
            }
          } else if (op.type === 'return_invoice') {
            const res = await fetch(`${API_URL}/integration/return-invoice/${companyId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
            const data = await res.json() as { success?: boolean; message?: string }
            success = data.success === true
            error = data.message ?? null
          } else if (op.type === 'customer') {
            const res = await fetch(`${API_URL}/integration/customers/${companyId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
            const data = await res.json() as { success?: boolean; message?: string }
            success = data.success === true
            error = data.message ?? null
          }

          if (success) {
            await window.electron.db.markOperationSuccess(op.id)
            onToast({ id: op.id, type: op.type, label: op.label, status: 'success' })
          } else {
            await window.electron.db.markOperationFailed(op.id, error ?? 'Hata')
            onToast({ id: op.id, type: op.type, label: op.label, status: 'failed', error })
          }
        } catch (e) {
          const errMsg = String(e)
          await window.electron.db.markOperationFailed(op.id, errMsg)
          onToast({ id: op.id, type: op.type, label: op.label, status: 'failed', error: errMsg })
        }
      }
    } finally {
      runningRef.current = false
    }
  }, [companyId, isOnline, onToast])

  useEffect(() => {
    if (isOnline) void processQueue()
  }, [isOnline, processQueue])

  useEffect(() => {
    if (!isOnline) return
    const t = setInterval(() => void processQueue(), POLL_INTERVAL)
    return () => clearInterval(t)
  }, [isOnline, processQueue])

  return { processQueue }
}

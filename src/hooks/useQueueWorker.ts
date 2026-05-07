import { useCallback, useEffect, useRef } from 'react'
import { api, API_URL } from '../lib/api'

const POLL_INTERVAL = 15_000

function pickInvoiceNumber(res: Record<string, unknown>): string {
  const direct = [
    res.invoice_number,
    res.invoiceNo,
    res.invoice_no,
    res.fatura_no,
  ]
  for (const val of direct) {
    if (typeof val === 'string' && val.trim().length > 0) return val.trim()
    if (typeof val === 'number') return String(val)
  }

  const data = (res.data ?? null) as Record<string, unknown> | null
  if (data) {
    const nested = [
      data.invoice_number,
      data.invoiceNo,
      data.invoice_no,
      data.fatura_no,
      data.no,
    ]
    for (const val of nested) {
      if (typeof val === 'string' && val.trim().length > 0) return val.trim()
      if (typeof val === 'number') return String(val)
    }
  }
  return ''
}

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
            const invoiceNumber = pickInvoiceNumber(res as unknown as Record<string, unknown>)

            if (success && res.invoice_id) {
              const cash_amount = Number((payload as { cash_amount?: unknown }).cash_amount ?? 0)
              const card_amount = Number((payload as { card_amount?: unknown }).card_amount ?? 0)
              const card_acquirer_id = ((payload as { card_acquirer_id?: unknown }).card_acquirer_id ?? null) as string | null
              console.log('[worker] invoice success, invoice_id:', res.invoice_id)
              console.log('[worker] payment payload:', { cash_amount, card_amount, card_acquirer_id })
              const saleData = payload as {
                sale_id?: string
                cash_amount?: number
                card_amount?: number
                card_acquirer_id?: string | null
                card_by_bank?: Record<string, { amount: number; acquirerName: string }>
                customer_erp_id?: unknown
                customer?: { id?: unknown; erp_id?: unknown; code?: unknown; name?: unknown }
              }
              const saleId = saleData.sale_id
              if (typeof saleId === 'string' && !saleId.startsWith('gunsonu-')) {
                const customer = saleData.customer ?? {}
                await window.electron.db.enqueueOperation({
                  id:        crypto.randomUUID(),
                  companyId,
                  type:      'payment',
                  payload:   {
                    invoice_id:       String(res.invoice_id),
                    invoice_number:   invoiceNumber,
                    invoice_date:     new Date().toISOString(),
                    customer_id:      Number(
                      saleData.customer_erp_id
                      ?? customer.erp_id
                      ?? customer.id
                      ?? 0,
                    ),
                    customer_code:    String(customer.code ?? ''),
                    customer_name:    String(customer.name ?? ''),
                    cash_amount:      Number(saleData.cash_amount ?? 0),
                    card_amount:      Number(saleData.card_amount ?? 0),
                    card_acquirer_id: saleData.card_acquirer_id ?? null,
                    card_by_bank:     saleData.card_by_bank ?? {},
                  },
                  label: `Tahsilat — ${String(customer.name ?? '')}`,
                })
              }
            }

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
            const invoiceNumber = pickInvoiceNumber(res as unknown as Record<string, unknown>)

            if (success && res.invoice_id) {
              const saleData = payload as {
                sale_id?: string
                cash_amount?: number
                card_amount?: number
                card_acquirer_id?: string | null
                card_by_bank?: Record<string, { amount: number; acquirerName: string }>
                customer_erp_id?: unknown
                customer?: { id?: unknown; erp_id?: unknown; code?: unknown; name?: unknown }
              }
              if (typeof saleData.sale_id === 'string') {
                const customer = saleData.customer ?? {}
                await window.electron.db.enqueueOperation({
                  id:        crypto.randomUUID(),
                  companyId,
                  type:      'payment',
                  payload:   {
                    invoice_id:       String(res.invoice_id),
                    invoice_number:   invoiceNumber,
                    invoice_date:     new Date().toISOString(),
                    customer_id:      Number(
                      saleData.customer_erp_id
                      ?? customer.erp_id
                      ?? customer.id
                      ?? 0,
                    ),
                    customer_code:    String(customer.code ?? ''),
                    customer_name:    String(customer.name ?? ''),
                    cash_amount:      Number(saleData.cash_amount ?? 0),
                    card_amount:      Number(saleData.card_amount ?? 0),
                    card_acquirer_id: saleData.card_acquirer_id ?? null,
                    card_by_bank:     saleData.card_by_bank ?? {},
                  },
                  label: `Tahsilat — ${String(customer.name ?? '')}`,
                })
              }
            }

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
          } else if (op.type === 'payment') {
            console.log('[worker] processing payment op:', op.id)
            const res = await fetch(`${API_URL}/integration/payment/${companyId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
            const data = await res.json() as { success?: boolean; message?: string }
            console.log('[worker] payment result:', JSON.stringify(data))
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

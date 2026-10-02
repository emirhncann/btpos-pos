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

interface ProcessQueueOpts {
  companyId:      string
  isOnline:       boolean
  onToast:        (toast: QueueToastPayload) => void
  includeDayEnd?: boolean
}

let queueRunning = false

export type ProcessQueueOptions = { includeDayEnd?: boolean }

export async function processOperationQueue({
  companyId,
  isOnline,
  onToast,
  includeDayEnd,
}: ProcessQueueOpts): Promise<void> {
  if (!companyId || !isOnline || queueRunning) return
  queueRunning = true

  try {
    const pending = await window.electron.db.getPendingOperations(companyId)
    const toProcess = pending.filter(op => {
      if (op.type === 'day_end_invoice') return includeDayEnd === true
      if (op.type === 'return_invoice') return includeDayEnd === true
      return true
    })
    if (toProcess.length === 0) return

    for (const op of toProcess) {
        await window.electron.db.markOperationProcessing(op.id)
        const payload = JSON.parse(op.payload) as Record<string, unknown>

        try {
          let success = false
          let error: string | null = null

          if (op.type === 'invoice') {
            const invItems = (payload.items ?? []) as Array<{
              product_code?: string
              vatRate?: number
              name?: string
            }>
            const badInv = invItems.filter(
              i => !String(i.product_code ?? '').trim() || !Number.isFinite(Number(i.vatRate)),
            )
            if (badInv.length > 0) {
              const errMsg = `Ürün kodu/KDV eksik: ${badInv.map(b => b.name ?? '?').join(', ')}`
              const sid = payload.sale_id
              if (typeof sid === 'string' && !sid.startsWith('gunsonu-')) {
                await window.electron.db.markInvoiceError(sid, errMsg)
              }
              await window.electron.db.markOperationFailed(op.id, errMsg)
              onToast({ id: op.id, type: op.type, label: op.label, status: 'failed', error: errMsg })
              continue
            }
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
              const saleId = saleData.sale_id
              // Koruma 5 — tahsilat SQLite ödeme satırlarından (ekran lines değil)
              let cash_amount = Number(saleData.cash_amount ?? 0)
              let card_amount = Number(saleData.card_amount ?? 0)
              let card_acquirer_id = saleData.card_acquirer_id ?? null
              let card_by_bank = saleData.card_by_bank ?? {}
              if (typeof saleId === 'string' && !saleId.startsWith('gunsonu-')) {
                try {
                  const rows = await window.electron.db.getSalePayments(saleId)
                  if (rows.length > 0) {
                    cash_amount = rows
                      .filter(p => p.method === 'cash')
                      .reduce((s, p) => s + Number(p.amount ?? 0), 0)
                    card_amount = rows
                      .filter(p => p.method !== 'cash')
                      .reduce((s, p) => s + Number(p.amount ?? 0), 0)
                    const firstCard = rows.find(p => p.method === 'card')
                    if (firstCard?.acquirerId != null) {
                      card_acquirer_id = String(firstCard.acquirerId)
                    }
                    const byBank: Record<string, { amount: number; acquirerName: string }> = {}
                    for (const p of rows.filter(r => r.method === 'card')) {
                      const key = String(p.acquirerId ?? 'unknown')
                      if (!byBank[key]) {
                        byBank[key] = { amount: 0, acquirerName: String(p.acquirerName ?? '') }
                      }
                      byBank[key].amount += Number(p.amount ?? 0)
                    }
                    if (Object.keys(byBank).length > 0) card_by_bank = byBank
                  }
                } catch (e) {
                  console.warn('[worker] getSalePayments fallback:', e)
                }
              }
              console.log('[worker] invoice success, invoice_id:', res.invoice_id)
              console.log('[worker] payment from SQLite:', { cash_amount, card_amount, card_acquirer_id })
              if (typeof saleId === 'string' && !saleId.startsWith('gunsonu-')) {
                const customer = saleData.customer ?? {}
                const terminalId = String(await window.electron.store.get('terminal_id').catch(() => '') ?? '')
                const paymentAccounts = await window.electron.db.matchPaymentAccounts({
                  cashAmount: cash_amount,
                  cardAmount: card_amount,
                  cardAcquirerId: card_acquirer_id,
                  cardByBank: card_by_bank,
                })
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
                    cash_amount,
                    card_amount,
                    card_acquirer_id,
                    card_by_bank,
                    terminal_id: terminalId,
                    payment_accounts: paymentAccounts,
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
            const dayItems = (payload.items ?? []) as Array<{
              product_code?: string
              vatRate?: number
              name?: string
            }>
            const badDay = dayItems.filter(
              i => !String(i.product_code ?? '').trim() || !Number.isFinite(Number(i.vatRate)),
            )
            if (badDay.length > 0) {
              const errMsg = `Ürün kodu/KDV eksik: ${badDay.map(b => b.name ?? '?').join(', ')}`
              const ids = payload.day_end_sale_ids
              if (Array.isArray(ids) && ids.every((x): x is string => typeof x === 'string')) {
                for (const saleId of ids) {
                  await window.electron.db.markInvoiceError(saleId, errMsg)
                }
              }
              await window.electron.db.markOperationFailed(op.id, errMsg)
              onToast({ id: op.id, type: op.type, label: op.label, status: 'failed', error: errMsg })
              continue
            }
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
                const terminalId = String(await window.electron.store.get('terminal_id').catch(() => '') ?? '')
                const dayCash = Number(saleData.cash_amount ?? 0)
                const dayCard = Number(saleData.card_amount ?? 0)
                const dayAcquirer = saleData.card_acquirer_id ?? null
                const dayByBank = saleData.card_by_bank ?? {}
                const paymentAccounts = await window.electron.db.matchPaymentAccounts({
                  cashAmount: dayCash,
                  cardAmount: dayCard,
                  cardAcquirerId: dayAcquirer,
                  cardByBank: dayByBank,
                })
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
                    cash_amount:      dayCash,
                    card_amount:      dayCard,
                    card_acquirer_id: dayAcquirer,
                    card_by_bank:     dayByBank,
                    terminal_id:      terminalId,
                    payment_accounts: paymentAccounts,
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
            const data = await res.json() as { success?: boolean; message?: string; invoice_id?: string }
            success = data.success === true
            error = data.message ?? null

            const returnSaleId = payload.sale_id
            if (typeof returnSaleId === 'string') {
              if (success && data.invoice_id) {
                await window.electron.db.markInvoiceSent(returnSaleId, String(data.invoice_id))
              } else if (!success) {
                await window.electron.db.markInvoiceError(returnSaleId, error ?? 'İade faturası gönderilemedi')
              }
            }
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
          } else if (op.type === 'terminal_local_settings' || op.type === 'payment_device' || op.type === 'app_report') {
            const endpoint = String(payload.endpoint ?? '')
            const method = String(payload.method ?? 'POST').toUpperCase()
            if (!endpoint.startsWith('/')) throw new Error('endpoint eksik')
            const token = await window.electron.store.get('token').catch(() => null) as string | null
            const res = await fetch(`${API_URL}${endpoint}`, {
              method,
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify(payload.body ?? {}),
            })
            const text = await res.text()
            let data: { success?: boolean; message?: string } = {}
            try { data = text ? JSON.parse(text) as { success?: boolean; message?: string } : {} } catch {
              data = { message: text.slice(0, 300) }
            }
            success = res.ok && data.success !== false
            error = success ? null : (data.message || `HTTP ${res.status}`)
          }

          if (success) {
            await window.electron.db.markOperationSuccess(op.id)
            if (op.type !== 'app_report') {
              onToast({ id: op.id, type: op.type, label: op.label, status: 'success' })
            }
          } else {
            await window.electron.db.markOperationFailed(op.id, error ?? 'Hata')
            if (op.type !== 'app_report') {
              onToast({ id: op.id, type: op.type, label: op.label, status: 'failed', error })
            }
          }
        } catch (e) {
          const errMsg = String(e)
          await window.electron.db.markOperationFailed(op.id, errMsg)
          onToast({ id: op.id, type: op.type, label: op.label, status: 'failed', error: errMsg })
        }
    }
  } finally {
    queueRunning = false
  }
}

export function scheduleProcessQueue(
  processQueue: (opts?: ProcessQueueOptions) => void | Promise<void>,
  delayMs = 500,
  opts?: ProcessQueueOptions,
): void {
  setTimeout(() => void processQueue(opts), delayMs)
}

export function useQueueWorker({ companyId, isOnline, onToast }: UseQueueWorkerOpts) {
  const processQueue = useCallback(
    (opts?: ProcessQueueOptions) =>
      processOperationQueue({ companyId, isOnline, onToast, includeDayEnd: opts?.includeDayEnd }),
    [companyId, isOnline, onToast],
  )

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

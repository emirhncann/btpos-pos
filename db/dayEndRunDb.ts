import { randomUUID } from 'crypto'
import { getSqlite } from './index'
import { matchPaymentAccounts, readTerminalSettings } from './settingsCache'
import { getSaleItems } from './operations'
import { formatIstanbulRange } from '../src/lib/commandView'
import { invoiceDateStamp } from '../src/lib/invoiceMode'
import {
  dayEndDocLabel,
  dayEndPaymentLabel,
  parseDayEndMode,
  paymentDocKey,
  planDayEndDocs,
  type DayEndSale,
} from '../src/lib/dayEndRun'

export interface ApplyDayEndRunInput {
  companyId: string
  terminalId: string
  runId: string
  rangeStart: string
  rangeEnd: string
  rangeLabel: string
  invoiceMode?: string
  terminalNo?: string
}

export interface ApplyDayEndRunResult {
  empty: boolean
  saleCount: number
  refundCount: number
  docCount: number
}

interface Tender {
  method: string
  acquirerId: string | null
  acquirerName: string
  amount: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function loadTenders(saleIds: string[]): Tender[] {
  if (saleIds.length === 0) return []
  const db = getSqlite()
  const placeholders = saleIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT method,
           acquirer_id,
           MAX(acquirer_name) AS acquirer_name,
           SUM(amount) AS total
    FROM sale_payments
    WHERE sale_id IN (${placeholders})
    GROUP BY method, COALESCE(acquirer_id, '')
  `).all(...saleIds) as Array<{
    method: string
    acquirer_id: string | null
    acquirer_name: string | null
    total: number
  }>
  return rows
    .map(row => ({
      method: String(row.method ?? ''),
      acquirerId: row.acquirer_id ? String(row.acquirer_id) : null,
      acquirerName: String(row.acquirer_name ?? '').trim(),
      amount: round2(Number(row.total ?? 0)),
    }))
    .filter(row => row.amount > 0.004)
}

function methodLabel(tender: Tender): string {
  if (tender.method === 'cash') return 'Nakit'
  if (tender.method === 'card') return tender.acquirerName || 'Kart'
  if (tender.method === 'meal_card') return tender.acquirerName || 'Yemek Kartı'
  return tender.acquirerName || 'Diğer'
}

export function applyDayEndRun(input: ApplyDayEndRunInput): ApplyDayEndRunResult {
  const db = getSqlite()
  const settings = readTerminalSettings(db)
  const invoiceType = settings.invoiceType === 'paper' ? 'paper' : 'e_archive'
  const endpointBase = invoiceType === 'paper' ? 'invoice-paper' : 'invoice'
  const mode = parseDayEndMode(input.invoiceMode)
  const rangeLabel = input.rangeLabel.trim() || formatIstanbulRange(input.rangeStart, input.rangeEnd) || input.rangeStart.slice(0, 10)

  const run = db.transaction(() => {
    const bound = db.prepare(`
      SELECT id, created_at, customer_id, customer_name, receipt_no, is_return, net_amount
      FROM sales
      WHERE day_end_run_id = ?
      ORDER BY julianday(created_at) ASC
    `).all(input.runId) as Array<Record<string, unknown>>

    let source = bound
    if (source.length === 0) {
      source = db.prepare(`
        SELECT id, created_at, customer_id, customer_name, receipt_no, is_return, net_amount
        FROM sales
        WHERE julianday(created_at) >= julianday(?)
          AND julianday(created_at) <= julianday(?)
          AND invoice_sent = 0
          AND day_end_run_id IS NULL
        ORDER BY julianday(created_at) ASC
      `).all(input.rangeStart, input.rangeEnd) as Array<Record<string, unknown>>
      if (source.length === 0) {
        return { empty: true, saleCount: 0, refundCount: 0, docCount: 0 }
      }
      const stamp = db.prepare(`UPDATE sales SET day_end_run_id = ? WHERE id = ? AND day_end_run_id IS NULL`)
      for (const row of source) stamp.run(input.runId, String(row.id))
    }

    const briefs: DayEndSale[] = source.map(row => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      customerId: row.customer_id ? String(row.customer_id) : null,
      customerName: row.customer_name ? String(row.customer_name) : null,
      receiptNo: String(row.receipt_no ?? ''),
      isReturn: Number(row.is_return ?? 0) === 1,
      netAmount: Math.abs(Number(row.net_amount ?? 0)),
    }))
    db.prepare(`DELETE FROM day_end_runs WHERE run_id = ? AND status = 'completed_empty'`).run(input.runId)
    const plans = planDayEndDocs(briefs, mode)
    const insert = db.prepare(`
      INSERT OR IGNORE INTO operation_queue (
        id, company_id, type, payload, status, attempts, max_attempts, created_at, label, day_end_run_id, doc_key
      ) VALUES (?, ?, ?, ?, 'pending', 0, 3, ?, ?, ?, ?)
    `)
    const now = new Date().toISOString()
    let inserted = 0
    for (const plan of plans) {
      const saleIds = plan.sales.map(s => s.id)
      const lines = new Map<string, Record<string, unknown>>()
      let expected = 0
      for (const sale of plan.sales) {
        expected = round2(expected + sale.netAmount)
        for (const item of getSaleItems(sale.id)) {
          const qty = Math.abs(Number(item.quantity) || 0)
          const unitPriceGross = Number(item.unitPriceGross ?? item.price)
          const grossAmount = Number(item.grossAmount ?? (unitPriceGross * qty).toFixed(2))
          const discountAmount = Number(item.discountAmount ?? 0)
          const netAmount = Number(item.netAmount ?? (grossAmount - discountAmount).toFixed(2))
          const rate = grossAmount > 0 ? round2((discountAmount / grossAmount) * 100) : 0
          const key = `${item.productCode}|${unitPriceGross}|${item.vatRate}|${rate}`
          const existing = lines.get(key)
          if (existing) {
            existing.quantity = round2(Number(existing.quantity) + qty)
            existing.gross_amount = round2(Number(existing.gross_amount) + grossAmount)
            existing.discount_amount = round2(Number(existing.discount_amount) + discountAmount)
            existing.net_amount = round2(Number(existing.net_amount) + netAmount)
          } else {
            lines.set(key, {
              product_code: item.productCode,
              name: item.productName ?? item.productCode,
              quantity: qty,
              vatRate: item.vatRate,
              unit: item.unit ?? 'Adet',
              product_id: item.productId ? Number.parseInt(item.productId, 10) || 0 : 0,
              unit_price_gross: unitPriceGross,
              gross_amount: grossAmount,
              discount_amount: discountAmount,
              net_amount: netAmount,
            })
          }
        }
      }
      const tenders = loadTenders(saleIds)
      const cashAmount = round2(tenders.filter(t => t.method === 'cash').reduce((s, t) => s + t.amount, 0))
      const cardTenders = tenders.filter(t => t.method === 'card')
      const cardByBank: Record<string, { amount: number; acquirerName: string }> = {}
      for (const tender of cardTenders) {
        const key = tender.acquirerId || 'unknown'
        const prev = cardByBank[key]
        cardByBank[key] = {
          amount: round2((prev?.amount ?? 0) + tender.amount),
          acquirerName: tender.acquirerName || prev?.acquirerName || '',
        }
      }
      const cardAmount = round2(Object.values(cardByBank).reduce((s, row) => s + row.amount, 0))
      const paymentAccounts = matchPaymentAccounts(db, {
        cashAmount,
        cardAmount,
        cardAcquirerId: null,
        cardByBank,
      })
      const last = plan.sales[plan.sales.length - 1]
      const customerId = plan.sales.find(s => s.customerId)?.customerId ?? null
      const customerName = plan.docKind.startsWith('retail')
        ? (plan.sales.find(s => s.customerName)?.customerName || 'Perakende')
        : (last.customerName || 'Cari')
      const label = dayEndDocLabel(rangeLabel, plan)
      const saleId = plan.sales.length === 1 ? plan.sales[0].id : `gunsonu-${plan.docKey}`
      const payload = {
        sale_id: saleId,
        day_end_sale_ids: saleIds,
        customer_ref: customerId ? { type: 'customer', id: customerId } : { type: 'torba' },
        items: [...lines.values()],
        expected_total: expected,
        invoice_date: invoiceDateStamp(last.createdAt),
        description: label,
        endpoint: plan.queueType === 'return_invoice'
          ? `/integration/return-invoice/${input.companyId}`
          : `/integration/${endpointBase}/${input.companyId}`,
        cash_amount: cashAmount,
        card_amount: cardAmount,
        card_acquirer_id: null,
        card_by_bank: cardByBank,
        terminal_id: input.terminalId,
        payment_accounts: paymentAccounts,
        day_end_run_id: input.runId,
        doc_key: plan.docKey,
        doc_kind: plan.docKind,
        terminal_amount: expected,
        sale_count: plan.sales.length,
        customer_name: customerName,
        range_label: rangeLabel,
        terminal_no: input.terminalNo ?? '',
      }
      const result = insert.run(
        randomUUID(),
        input.companyId,
        plan.queueType,
        JSON.stringify(payload),
        now,
        label,
        input.runId,
        plan.docKey,
      ) as { changes?: number }
      if (Number(result?.changes ?? 0) > 0) inserted += 1
    }
    const saleCount = briefs.filter(s => !s.isReturn).length
    const refundCount = briefs.filter(s => s.isReturn).length
    return { empty: false, saleCount, refundCount, docCount: inserted }
  })
  return run()
}

export function dayEndRunStatus(runId: string): string | null {
  const row = getSqlite().prepare(`SELECT status FROM day_end_runs WHERE run_id = ?`).get(runId) as { status: string } | undefined
  return row?.status ?? null
}

export function countDayEndProcessing(runId: string): number {
  const row = getSqlite().prepare(`
    SELECT COUNT(*) AS c FROM operation_queue
    WHERE day_end_run_id = ? AND status = 'processing'
  `).get(runId) as { c: number }
  return Number(row?.c ?? 0)
}

export function releaseDayEndRun(runId: string): void {
  const db = getSqlite()
  const run = db.transaction(() => {
    db.prepare(`
      UPDATE operation_queue
      SET status = 'cancelled'
      WHERE day_end_run_id = ? AND status != 'success'
    `).run(runId)
    db.prepare(`
      UPDATE sales
      SET day_end_run_id = NULL, invoice_sent = 0, invoice_id = NULL, invoice_number = NULL, invoice_error = NULL
      WHERE day_end_run_id = ?
    `).run(runId)
    db.prepare(`
      INSERT INTO day_end_runs (run_id, status, reported_at)
      VALUES (?, 'released', ?)
      ON CONFLICT(run_id) DO UPDATE SET status = 'released', reported_at = excluded.reported_at
    `).run(runId, new Date().toISOString())
  })
  run()
}

export function markDayEndRunStatus(runId: string, status: string): void {
  getSqlite().prepare(`
    INSERT INTO day_end_runs (run_id, status, reported_at)
    VALUES (?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET status = excluded.status, reported_at = excluded.reported_at
  `).run(runId, status, new Date().toISOString())
}

export function rememberQueueInvoice(queueId: string, invoiceId: string, invoiceNumber?: string | null): void {
  const number = String(invoiceNumber ?? '').trim()
  getSqlite().prepare(`
    UPDATE operation_queue
    SET invoice_number = COALESCE(NULLIF(?, ''), invoice_number),
        payload = json_set(
          payload,
          '$.erp_invoice_id', ?,
          '$.invoice_number', COALESCE(NULLIF(?, ''), json_extract(payload, '$.invoice_number'))
        )
    WHERE id = ?
  `).run(number, invoiceId, number, queueId)
}

export function enqueueDayEndPayments(input: {
  queueId: string
  invoiceId: string
  invoiceNumber?: string | null
  customerId?: number
  customerCode?: string
  customerName?: string
}): number {
  const db = getSqlite()
  const row = db.prepare(`SELECT payload, company_id, day_end_run_id, doc_key FROM operation_queue WHERE id = ?`).get(input.queueId) as {
    payload: string
    company_id: string
    day_end_run_id: string | null
    doc_key: string | null
  } | undefined
  if (!row?.day_end_run_id || !row.doc_key) return 0
  const payload = JSON.parse(row.payload) as {
    day_end_sale_ids?: string[]
    sale_id?: string
    range_label?: string
    invoice_date?: string
    terminal_id?: string
  }
  const saleIds = Array.isArray(payload.day_end_sale_ids)
    ? payload.day_end_sale_ids.filter(id => typeof id === 'string' && !id.startsWith('gunsonu-'))
    : []
  const tenders = loadTenders(saleIds)
  if (tenders.length === 0) return 0
  const rangeLabel = String(payload.range_label ?? '')
  const insert = db.prepare(`
    INSERT OR IGNORE INTO operation_queue (
      id, company_id, type, payload, status, attempts, max_attempts, created_at, label, day_end_run_id, doc_key, invoice_number
    ) VALUES (?, ?, 'payment', ?, 'pending', 0, 3, ?, ?, ?, ?, ?)
  `)
  let count = 0
  const txn = db.transaction(() => {
    for (const tender of tenders) {
      const docKey = paymentDocKey(row.doc_key!, tender.method, tender.acquirerId)
      const labelName = methodLabel(tender)
      const cardByBank = tender.method === 'cash'
        ? {}
        : {
          [tender.acquirerId || tender.method]: {
            amount: tender.amount,
            acquirerName: tender.acquirerName || methodLabel(tender),
          },
        }
      const body = {
        invoice_id: input.invoiceId,
        invoice_number: input.invoiceNumber ?? null,
        invoice_date: payload.invoice_date ?? new Date().toISOString(),
        customer_id: input.customerId ?? 0,
        customer_code: input.customerCode ?? '',
        customer_name: input.customerName ?? '',
        cash_amount: tender.method === 'cash' ? tender.amount : 0,
        card_amount: tender.method === 'cash' ? 0 : tender.amount,
        card_acquirer_id: tender.method === 'card' ? tender.acquirerId : null,
        card_by_bank: cardByBank,
        terminal_id: payload.terminal_id ?? '',
        payment_accounts: matchPaymentAccounts(db, {
          cashAmount: tender.method === 'cash' ? tender.amount : 0,
          cardAmount: tender.method === 'card' ? tender.amount : 0,
          cardAcquirerId: tender.acquirerId,
          cardByBank,
        }),
        day_end_run_id: row.day_end_run_id,
        doc_key: docKey,
        parent_doc_key: row.doc_key,
        payment_label: labelName,
        terminal_amount: tender.amount,
      }
      const result = insert.run(
        randomUUID(),
        row.company_id,
        JSON.stringify(body),
        new Date().toISOString(),
        dayEndPaymentLabel(rangeLabel, labelName),
        row.day_end_run_id,
        docKey,
        String(input.invoiceNumber ?? '').trim() || null,
      ) as { changes?: number }
      if (Number(result?.changes ?? 0) > 0) count += 1
    }
  })
  txn()
  return count
}

export interface DayEndStatusAction {
  runId: string
  body: Record<string, unknown>
}

export function settleDayEndRuns(companyId: string): DayEndStatusAction[] {
  const db = getSqlite()
  const runs = db.prepare(`
    SELECT DISTINCT day_end_run_id AS run_id
    FROM operation_queue
    WHERE company_id = ?
      AND day_end_run_id IS NOT NULL
      AND day_end_run_id NOT IN (
        SELECT run_id FROM day_end_runs
        WHERE status IN ('completed', 'failed', 'released', 'completed_empty')
      )
  `).all(companyId) as Array<{ run_id: string }>

  const actions: DayEndStatusAction[] = []
  for (const run of runs) {
    const rows = db.prepare(`
      SELECT id, type, status, label, error, payload
      FROM operation_queue
      WHERE day_end_run_id = ?
    `).all(run.run_id) as Array<{
      id: string
      type: string
      status: string
      label: string | null
      error: string | null
      payload: string
    }>
    if (rows.length === 0) continue
    if (rows.some(row => row.status === 'pending' || row.status === 'processing' || row.status === 'pending_dayend')) continue
    const failed = rows.find(row => row.status === 'failed')
    if (failed) {
      const name = failed.label || failed.type
      actions.push({
        runId: run.run_id,
        body: { status: 'failed', error: `${name}: ${failed.error ?? 'Hata'}` },
      })
      continue
    }
    if (!rows.every(row => row.status === 'success')) continue

    let saleCount = 0
    let refundCount = 0
    let customerDocCount = 0
    let terminalTotal = 0
    const mark = db.prepare(`
      UPDATE sales
      SET invoice_sent = 1, invoice_id = ?, invoice_number = COALESCE(NULLIF(?, ''), invoice_number),
          invoice_error = NULL, invoice_at = ?
      WHERE id = ? AND day_end_run_id = ?
    `)
    const at = new Date().toISOString()
    const apply = db.transaction(() => {
      for (const row of rows) {
        if (row.type === 'payment') continue
        const payload = JSON.parse(row.payload) as {
          doc_kind?: string
          terminal_amount?: number
          sale_count?: number
          erp_invoice_id?: string
          invoice_number?: string
          day_end_sale_ids?: string[]
        }
        const amount = Number(payload.terminal_amount ?? 0)
        const kind = String(payload.doc_kind ?? '')
        if (kind.endsWith('refund')) {
          refundCount += Number(payload.sale_count ?? 0)
          terminalTotal = round2(terminalTotal - amount)
        } else {
          saleCount += Number(payload.sale_count ?? 0)
          terminalTotal = round2(terminalTotal + amount)
        }
        if (kind.startsWith('customer')) customerDocCount += 1
        const invoiceId = String(payload.erp_invoice_id ?? '')
        const invoiceNumber = String(payload.invoice_number ?? '').trim()
        if (!invoiceId) continue
        for (const saleId of payload.day_end_sale_ids ?? []) {
          if (typeof saleId === 'string') mark.run(invoiceId, invoiceNumber, at, saleId, run.run_id)
        }
      }
    })
    apply()
    actions.push({
      runId: run.run_id,
      body: {
        status: 'completed',
        sale_count: saleCount,
        refund_count: refundCount,
        customer_doc_count: customerDocCount,
        terminal_total: terminalTotal,
      },
    })
  }
  return actions
}

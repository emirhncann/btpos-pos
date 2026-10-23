import { randomUUID } from 'crypto'
import { getSqlite } from './index'
import { matchPaymentAccounts, readTerminalSettings, resolveTenderAccount } from './settingsCache'
import { getSaleItems } from './operations'
import { formatIstanbulRange } from '../src/lib/commandView'
import { invoiceDateStamp, istanbulDayKey } from '../src/lib/invoiceMode'
import {
  cariMissingProblem,
  collectDayEndProblems,
  hasIsbasiId,
  type DayEndProblem,
} from '../src/lib/dayEndPrecheck'
import { customerErpNumber, invoiceCustomerBody, queueCustomerKind } from '../src/lib/queueCustomerPatch'
import {
  dayEndDocLabel,
  dayEndPaymentLabel,
  parseDayEndMode,
  paymentDocKey,
  nextDayEndReport,
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
  rejected: boolean
  problems: DayEndProblem[]
  saleCount: number
  refundCount: number
  docCount: number
  docsTotal: number
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
  const bound = db.prepare(`SELECT COUNT(*) AS c FROM sales WHERE day_end_run_id = ?`).get(input.runId) as { c: number }
  if (Number(bound?.c ?? 0) === 0) {
    const problems = problemsForUnboundRange(db, input)
    if (problems.length > 0) {
      return { empty: false, rejected: true, problems, saleCount: 0, refundCount: 0, docCount: 0, docsTotal: 0 }
    }
  }
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
        return { empty: true, rejected: false, problems: [], saleCount: 0, refundCount: 0, docCount: 0, docsTotal: 0 }
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
    let expectedPayments = 0
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
      expectedPayments += tenders.length
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
      const retail = plan.docKind === 'retail_invoice' || plan.docKind === 'retail_refund'
      const customerName = retail
        ? (plan.sales.find(s => s.customerName)?.customerName || 'Perakende')
        : (last.customerName || 'Cari')
      const label = dayEndDocLabel(rangeLabel, plan)
      const saleId = plan.sales.length === 1 ? plan.sales[0].id : `gunsonu-${plan.docKey}`
      const payload = {
        sale_id: saleId,
        day_end_sale_ids: saleIds,
        ...(retail
          ? {
            customer_ref: { type: 'torba', id: '-1' },
            customer_erp_id: -1,
            customer: { erp_id: -1, name: 'TORBA' },
          }
          : {
            customer_ref: customerId ? { type: 'customer', id: customerId } : { type: 'torba' },
          }),
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
        receipt_no: plan.sales[0]?.receiptNo ?? '',
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
    const docsTotal = inserted + expectedPayments
    if (docsTotal > 0) {
      db.prepare(`
        INSERT INTO day_end_runs (run_id, status, reported_at, docs_total, docs_sent)
        VALUES (?, 'processing', NULL, ?, 0)
        ON CONFLICT(run_id) DO UPDATE SET
          docs_total = CASE WHEN excluded.docs_total > COALESCE(day_end_runs.docs_total, 0)
            THEN excluded.docs_total ELSE day_end_runs.docs_total END
      `).run(input.runId, docsTotal)
    }
    return { empty: false, rejected: false, problems: [], saleCount, refundCount, docCount: inserted, docsTotal }
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

export function releaseDayEndRun(runId: string): { days: string[] } {
  const db = getSqlite()
  const existing = db.prepare(`SELECT status, summary_days FROM day_end_runs WHERE run_id = ?`).get(runId) as {
    status?: string
    summary_days?: string | null
  } | undefined
  if (existing?.status === 'released') {
    return { days: parseSummaryDays(existing.summary_days) }
  }
  const stamps = db.prepare(`SELECT created_at FROM sales WHERE day_end_run_id = ?`).all(runId) as Array<{ created_at: string }>
  const days = [...new Set(stamps.map(row => istanbulDayKey(String(row.created_at ?? ''))).filter(Boolean))].sort()
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
      INSERT INTO day_end_runs (run_id, status, reported_at, summary_days)
      VALUES (?, 'released', ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        status = 'released',
        reported_at = excluded.reported_at,
        summary_days = excluded.summary_days
    `).run(runId, new Date().toISOString(), JSON.stringify(days))
  })
  run()
  return { days }
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
    doc_kind?: string
    customer_ref?: { type?: string }
  }
  const torbaDoc = queueCustomerKind('invoice', payload) === 'torba'
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
        customer_id: torbaDoc ? -1 : (input.customerId ?? 0),
        customer_code: torbaDoc ? '' : (input.customerCode ?? ''),
        customer_name: torbaDoc ? 'TORBA' : (input.customerName ?? ''),
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
        range_label: rangeLabel,
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
    SELECT DISTINCT q.day_end_run_id AS run_id, r.status AS reported
    FROM operation_queue q
    LEFT JOIN day_end_runs r ON r.run_id = q.day_end_run_id
    WHERE q.company_id = ?
      AND q.day_end_run_id IS NOT NULL
      AND (r.status IS NULL OR r.status NOT IN ('completed', 'released', 'completed_empty'))
  `).all(companyId) as Array<{ run_id: string; reported: string | null }>

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
    const decision = nextDayEndReport(run.reported, rows.map(row => row.status))
    if (decision === 'processing') {
      const progress = dayEndProgress(run.run_id)
      actions.push({
        runId: run.run_id,
        body: { status: 'processing', docs_total: progress.docsTotal, docs_sent: progress.docsSent },
      })
      continue
    }
    if (decision === null) continue
    if (decision === 'failed') {
      const failed = rows.find(row => row.status === 'failed')
      const name = failed?.label || failed?.type || 'belge'
      actions.push({
        runId: run.run_id,
        body: { status: 'failed', error: `${name}: ${failed?.error ?? 'Hata'}` },
      })
      continue
    }

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

interface CustomerHit {
  id: string
  code: string
  name: string
  erpId: string
}

function customerHit(row: { id: string; code: string | null; name: string | null; erp_id: string | null } | undefined): CustomerHit | null {
  if (!row) return null
  return {
    id: String(row.id),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    erpId: String(row.erp_id ?? ''),
  }
}

function customerById(companyId: string, id: string): CustomerHit | null {
  const row = getSqlite().prepare(`
    SELECT id, code, name, erp_id FROM customers WHERE company_id = ? AND id = ?
  `).get(companyId, id) as { id: string; code: string | null; name: string | null; erp_id: string | null } | undefined
  return customerHit(row)
}

function problemsForUnboundRange(db: ReturnType<typeof getSqlite>, input: ApplyDayEndRunInput): DayEndProblem[] {
  const sales = db.prepare(`
    SELECT id, customer_id, customer_name, receipt_no
    FROM sales
    WHERE julianday(created_at) >= julianday(?)
      AND julianday(created_at) <= julianday(?)
      AND invoice_sent = 0
      AND day_end_run_id IS NULL
  `).all(input.rangeStart, input.rangeEnd) as Array<{
    id: string
    customer_id: string | null
    customer_name: string | null
    receipt_no: string | number | null
  }>
  if (sales.length === 0) return []
  const briefs = sales.map(sale => {
    const hit = sale.customer_id ? customerById(input.companyId, String(sale.customer_id)) : null
    return {
      receiptNo: String(sale.receipt_no ?? ''),
      customerName: String(sale.customer_name ?? hit?.name ?? ''),
      customerId: sale.customer_id ? String(sale.customer_id) : null,
      hasErp: hasIsbasiId(hit),
    }
  })
  const ids = sales.map(sale => String(sale.id))
  const tenders = loadTenders(ids).map(tender => ({
    method: tender.method,
    acquirerId: tender.acquirerId,
    acquirerName: tender.acquirerName || methodLabel(tender),
    accountMatched: resolveTenderAccount(db, tender) != null,
  }))
  const placeholders = ids.map(() => '?').join(',')
  const lines = db.prepare(`
    SELECT s.receipt_no AS receipt_no, si.product_name AS product_name, si.vat_rate AS vat_rate,
           p.code AS product_code, p.unit AS unit
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id IN (${placeholders})
  `).all(...ids) as Array<{
    receipt_no: string | number | null
    product_name: string | null
    vat_rate: number | null
    product_code: string | null
    unit: string | null
  }>
  return collectDayEndProblems({
    sales: briefs,
    tenders,
    lines: lines.map(line => ({
      receiptNo: String(line.receipt_no ?? ''),
      name: String(line.product_name ?? ''),
      productCode: String(line.product_code ?? ''),
      unit: String(line.unit ?? ''),
      vatRate: line.vat_rate == null ? null : Number(line.vat_rate),
    })),
  })
}

export interface DayEndProgressSnap {
  status: string | null
  docsTotal: number
  docsSent: number
  reportedTotal: number
  reportedSent: number
}

export function dayEndProgress(runId: string): DayEndProgressSnap {
  const db = getSqlite()
  const run = db.prepare(`SELECT status, docs_total, docs_sent FROM day_end_runs WHERE run_id = ?`).get(runId) as {
    status?: string
    docs_total?: number | null
    docs_sent?: number | null
  } | undefined
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS sent
    FROM operation_queue
    WHERE day_end_run_id = ?
  `).get(runId) as { total: number; sent: number | null }
  const storedTotal = Number(run?.docs_total ?? 0)
  const liveTotal = Number(counts?.total ?? 0)
  return {
    status: run?.status ?? null,
    docsTotal: storedTotal > 0 ? storedTotal : liveTotal,
    docsSent: Number(counts?.sent ?? 0),
    reportedTotal: storedTotal,
    reportedSent: Number(run?.docs_sent ?? 0),
  }
}

export function listDayEndProgress(companyId: string): Array<DayEndProgressSnap & { runId: string }> {
  const rows = getSqlite().prepare(`
    SELECT DISTINCT day_end_run_id AS run_id
    FROM operation_queue
    WHERE company_id = ? AND day_end_run_id IS NOT NULL
  `).all(companyId) as Array<{ run_id: string }>
  return rows.map(row => ({ runId: String(row.run_id), ...dayEndProgress(String(row.run_id)) }))
}

export function markDayEndProgress(runId: string, docsTotal: number, docsSent: number): void {
  getSqlite().prepare(`
    INSERT INTO day_end_runs (run_id, status, reported_at, docs_total, docs_sent)
    VALUES (?, 'processing', ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = 'processing',
      reported_at = excluded.reported_at,
      docs_total = excluded.docs_total,
      docs_sent = excluded.docs_sent
  `).run(runId, new Date().toISOString(), docsTotal, docsSent)
}

function parseSummaryDays(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]')) as unknown
    return Array.isArray(parsed) ? parsed.filter((day): day is string => typeof day === 'string' && day.trim() !== '') : []
  } catch {
    return []
  }
}

export function dayEndSummaryDays(runId: string): string[] {
  const row = getSqlite().prepare(`SELECT summary_days FROM day_end_runs WHERE run_id = ?`).get(runId) as {
    summary_days?: string | null
  } | undefined
  return parseSummaryDays(row?.summary_days)
}

function istanbulDayBounds(dayKey: string): { start: string; end: string } | null {
  const parts = dayKey.split('-').map(part => Number(part))
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null
  const [year, month, day] = parts
  const start = new Date(Date.UTC(year, month - 1, day, -3, 0, 0))
  const end = new Date(start.getTime() + 86_400_000)
  return { start: start.toISOString(), end: end.toISOString() }
}

export function buildDailySummary(dayKey: string): {
  date: string
  sale_count: number
  refund_count: number
  sale_total: number
  refund_total: number
  net_total: number
} | null {
  const bounds = istanbulDayBounds(dayKey)
  if (!bounds) return null
  const rows = getSqlite().prepare(`
    SELECT is_return, net_amount
    FROM sales
    WHERE julianday(created_at) >= julianday(?)
      AND julianday(created_at) < julianday(?)
  `).all(bounds.start, bounds.end) as Array<{ is_return: number | null; net_amount: number | null }>
  let saleCount = 0
  let refundCount = 0
  let saleTotal = 0
  let refundTotal = 0
  for (const row of rows) {
    const amount = round2(Math.abs(Number(row.net_amount ?? 0)))
    if (Number(row.is_return ?? 0) === 1) {
      refundCount += 1
      refundTotal = round2(refundTotal + amount)
    } else {
      saleCount += 1
      saleTotal = round2(saleTotal + amount)
    }
  }
  return {
    date: dayKey,
    sale_count: saleCount,
    refund_count: refundCount,
    sale_total: saleTotal,
    refund_total: refundTotal,
    net_total: round2(saleTotal - refundTotal),
  }
}

export interface DayEndRetryResult {
  ok: boolean
  pending: number
  problems: DayEndProblem[]
}

function paymentTenderOf(payload: Record<string, unknown>, docKey: string): { method: string; acquirerId: string | null; name: string } {
  const parent = String(payload.parent_doc_key ?? '')
  const prefix = parent ? `pay:${parent}:` : ''
  const rest = prefix && docKey.startsWith(prefix) ? docKey.slice(prefix.length) : ''
  const [methodRaw, acquirerRaw] = rest.split(':')
  if (methodRaw) {
    return { method: methodRaw, acquirerId: acquirerRaw ? acquirerRaw : null, name: String(payload.payment_label ?? methodRaw) }
  }
  if (Number(payload.cash_amount ?? 0) > 0) return { method: 'cash', acquirerId: null, name: 'Nakit' }
  const acquirerId = payload.card_acquirer_id ? String(payload.card_acquirer_id) : null
  return { method: 'card', acquirerId, name: String(payload.payment_label ?? 'Kart') }
}

export function rebuildDayEndRetry(companyId: string, runId: string): DayEndRetryResult {
  const db = getSqlite()
  const busy = db.prepare(`
    SELECT COUNT(*) AS c FROM operation_queue WHERE day_end_run_id = ? AND status = 'processing'
  `).get(runId) as { c: number }
  if (Number(busy?.c ?? 0) > 0) throw new Error('Gün sonu belgesi hâlâ gönderiliyor')
  const rows = db.prepare(`
    SELECT id, type, status, payload, doc_key
    FROM operation_queue
    WHERE day_end_run_id = ? AND status != 'success'
  `).all(runId) as Array<{ id: string; type: string; status: string; payload: string; doc_key: string | null }>
  if (rows.length === 0) return { ok: true, pending: 0, problems: [] }

  const problems: DayEndProblem[] = []
  const seen = new Set<string>()
  const add = (problem: DayEndProblem) => {
    if (seen.has(problem.message)) return
    seen.add(problem.message)
    problems.push(problem)
  }
  const rebuilt = new Map<string, Record<string, unknown>>()
  const customersByDoc = new Map<string, { id: number; code: string; name: string }>()

  for (const row of rows) {
    const payload = JSON.parse(row.payload) as Record<string, unknown>
    if (row.type === 'payment') continue
    const ref = payload.customer_ref as { type?: string; id?: string } | undefined
    const isCari = ref?.type === 'customer' || String(payload.doc_kind ?? '').startsWith('customer')
    let hit: CustomerHit | null = null
    const accounts = matchPaymentAccounts(db, {
      cashAmount: Number(payload.cash_amount ?? 0),
      cardAmount: Number(payload.card_amount ?? 0),
      cardAcquirerId: payload.card_acquirer_id ? String(payload.card_acquirer_id) : null,
      cardByBank: (payload.card_by_bank ?? {}) as Record<string, { amount?: number; acquirerName?: string }>,
    })
    if (!isCari) {
      rebuilt.set(row.id, { ...payload, payment_accounts: accounts })
      if (row.doc_key) customersByDoc.set(row.doc_key, { id: -1, code: '', name: 'TORBA' })
      continue
    }
    hit = ref?.id ? customerById(companyId, ref.id) : null
    if (!hasIsbasiId(hit)) {
      add(cariMissingProblem(String(payload.receipt_no ?? ''), String(payload.customer_name ?? hit?.name ?? '')))
      continue
    }
    if (!hit) continue
    const next: Record<string, unknown> = {
      ...payload,
      customer: invoiceCustomerBody(hit),
      customer_erp_id: customerErpNumber(hit),
      customer_ref: { type: 'customer', id: hit.id },
      customer_name: hit.name,
      payment_accounts: accounts,
    }
    rebuilt.set(row.id, next)
    if (row.doc_key) {
      customersByDoc.set(row.doc_key, {
        id: customerErpNumber(hit),
        code: hit.code,
        name: hit.name,
      })
    }
  }

  for (const row of rows) {
    if (row.type !== 'payment') continue
    const payload = JSON.parse(row.payload) as Record<string, unknown>
    const tender = paymentTenderOf(payload, String(row.doc_key ?? ''))
    const account = resolveTenderAccount(db, tender)
    if (!account) {
      if (tender.method === 'cash') add({ code: 'NAKIT_HESAP_YOK', message: 'Nakit kasa hesabı eşlenmemiş.' })
      else if (tender.method === 'card') {
        add({ code: 'BANKA_HESAP_YOK', message: `${tender.name || 'Banka'} (${tender.acquirerId || '—'}) için banka hesabı eşlenmemiş.` })
      } else {
        add({ code: 'ODEME_HESAP_YOK', message: `${tender.name || tender.method} için hesap eşlenmemiş.` })
      }
      continue
    }
    const parentKey = String(payload.parent_doc_key ?? '')
    let parent = customersByDoc.get(parentKey)
    if (!parent && parentKey) {
      const stored = db.prepare(`
        SELECT type, payload FROM operation_queue
        WHERE day_end_run_id = ? AND doc_key = ?
        LIMIT 1
      `).get(runId, parentKey) as { type: string; payload: string } | undefined
      if (stored) {
        const parentPayload = JSON.parse(stored.payload) as Record<string, unknown>
        if (queueCustomerKind(stored.type, parentPayload) === 'torba') {
          parent = { id: -1, code: '', name: 'TORBA' }
        }
      }
    }
    const accounts = tender.method === 'cash'
      ? { cash: account, cards: [] }
      : { cash: null, cards: [{ acquirer_id: tender.acquirerId ?? tender.method, amount: Number(payload.terminal_amount ?? payload.card_amount ?? payload.cash_amount ?? 0), account }] }
    rebuilt.set(row.id, {
      ...payload,
      payment_accounts: accounts,
      ...(parent ? { customer_id: parent.id, customer_code: parent.code, customer_name: parent.name } : {}),
    })
  }

  if (problems.length > 0) return { ok: false, pending: 0, problems }

  const update = db.prepare(`
    UPDATE operation_queue
    SET payload = ?, status = 'pending', attempts = 0, error = NULL
    WHERE id = ? AND day_end_run_id = ?
  `)
  const write = db.transaction(() => {
    for (const [id, payload] of rebuilt) update.run(JSON.stringify(payload), id, runId)
  })
  write()
  return { ok: true, pending: rebuilt.size, problems: [] }
}

export function prepareDayEndPayment(queueId: string): Record<string, unknown> | null {
  const db = getSqlite()
  const row = db.prepare(`SELECT payload, doc_key, day_end_run_id FROM operation_queue WHERE id = ?`).get(queueId) as {
    payload: string
    doc_key: string | null
    day_end_run_id: string | null
  } | undefined
  if (!row?.day_end_run_id) return null
  const payload = JSON.parse(row.payload) as Record<string, unknown>
  const tender = paymentTenderOf(payload, String(row.doc_key ?? ''))
  const account = resolveTenderAccount(db, tender)
  const accounts = tender.method === 'cash'
    ? { cash: account, cards: [] }
    : { cash: null, cards: [{ acquirer_id: tender.acquirerId ?? tender.method, amount: Number(payload.terminal_amount ?? payload.card_amount ?? 0), account }] }
  const next = { ...payload, payment_accounts: accounts }
  db.prepare(`UPDATE operation_queue SET payload = ? WHERE id = ?`).run(JSON.stringify(next), queueId)
  return next
}

import { formatReceiptNo } from './invoiceMode'

export type DayEndInvoiceMode = 'z_single' | 'per_sale'
export type DayEndDocKind = 'retail_invoice' | 'retail_refund' | 'customer_invoice' | 'customer_refund'

export interface DayEndSale {
  id: string
  createdAt: string
  customerId: string | null
  customerName: string | null
  receiptNo: string
  isReturn: boolean
  netAmount: number
}

export interface DayEndDocPlan {
  docKey: string
  docKind: DayEndDocKind
  queueType: 'invoice' | 'return_invoice'
  sales: DayEndSale[]
}

const PACKAGE_LIMIT = 200

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

export function parseDayEndMode(value: unknown): DayEndInvoiceMode {
  return String(value ?? '').trim() === 'per_sale' ? 'per_sale' : 'z_single'
}

/** Admin aralığındaki satışları belge planına böler. Aralık zaten komuttan gelir. */
export function planDayEndDocs(rows: DayEndSale[], mode: DayEndInvoiceMode): DayEndDocPlan[] {
  const sorted = [...rows].sort((a, b) => {
    const at = new Date(a.createdAt).getTime()
    const bt = new Date(b.createdAt).getTime()
    const delta = (Number.isNaN(at) ? 0 : at) - (Number.isNaN(bt) ? 0 : bt)
    return delta || a.id.localeCompare(b.id)
  })
  const anon = (sale: DayEndSale) => !sale.customerId
  const anonSale = sorted.filter(s => !s.isReturn && anon(s))
  const anonRefund = sorted.filter(s => s.isReturn && anon(s))
  const cariSale = sorted.filter(s => !s.isReturn && !anon(s))
  const cariRefund = sorted.filter(s => s.isReturn && !anon(s))
  const docs: DayEndDocPlan[] = []

  if (mode === 'per_sale') {
    for (const sale of anonSale) {
      docs.push({ docKey: `sale:${sale.id}`, docKind: 'retail_invoice', queueType: 'invoice', sales: [sale] })
    }
  } else {
    chunks(anonSale, PACKAGE_LIMIT).forEach((part, index) => {
      docs.push({ docKey: `retail:${index + 1}`, docKind: 'retail_invoice', queueType: 'invoice', sales: part })
    })
  }

  if (mode === 'per_sale') {
    for (const sale of anonRefund) {
      docs.push({ docKey: `refund:${sale.id}`, docKind: 'retail_refund', queueType: 'return_invoice', sales: [sale] })
    }
  } else {
    chunks(anonRefund, PACKAGE_LIMIT).forEach((part, index) => {
      docs.push({ docKey: `retail_refund:${index + 1}`, docKind: 'retail_refund', queueType: 'return_invoice', sales: part })
    })
  }

  for (const sale of cariSale) {
    docs.push({ docKey: `sale:${sale.id}`, docKind: 'customer_invoice', queueType: 'invoice', sales: [sale] })
  }
  for (const sale of cariRefund) {
    docs.push({ docKey: `refund:${sale.id}`, docKind: 'customer_refund', queueType: 'return_invoice', sales: [sale] })
  }
  return docs
}

export function dayEndDocLabel(rangeLabel: string, doc: DayEndDocPlan): string {
  const head = `Gün sonu ${rangeLabel}`
  if (doc.docKind === 'retail_invoice') return `${head} · Perakende faturası (${doc.sales.length} satış)`
  if (doc.docKind === 'retail_refund') return `${head} · İade faturası (${doc.sales.length})`
  const sale = doc.sales[0]
  const receipt = formatReceiptNo(sale?.receiptNo ?? '')
  const name = sale?.customerName?.trim() || 'Cari'
  if (doc.docKind === 'customer_refund') return `${head} · Cari iade · Fiş ${receipt} · ${name}`
  return `${head} · Cari fatura · Fiş ${receipt} · ${name}`
}

export function dayEndPaymentLabel(rangeLabel: string, methodLabel: string): string {
  return `Gün sonu ${rangeLabel} · Tahsilat · ${methodLabel}`
}

export function paymentDocKey(parentDocKey: string, method: string, acquirerId?: string | null): string {
  if (method === 'cash') return `pay:${parentDocKey}:cash`
  if (method === 'card') return `pay:${parentDocKey}:card:${acquirerId || 'unknown'}`
  return `pay:${parentDocKey}:${method}:${acquirerId || 'other'}`
}

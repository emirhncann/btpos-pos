import { api } from './api'
import type { RenderData } from './templateEngine'

export type BalanceSource = 'merkez' | 'kasa'

export interface BalanceMath {
  before: number
  after: number
  note: string
}

export interface BalancePrintSession {
  fetched: boolean
  fields: Record<string, string> | null
}

export function newBalancePrintSession(): BalancePrintSession {
  return { fetched: false, fields: null }
}

/** Yalnızca bu şablonun metninde bakiye alanı var mı. */
export function templateUsesBalance(schema: unknown): boolean {
  const text = typeof schema === 'string' ? schema : JSON.stringify(schema ?? '')
  return text.includes('customer.balance') || text.includes('customers.balance')
}

export function schemaWantsCustomerBalance(schemaText: string): boolean {
  return templateUsesBalance(schemaText)
}

export function roundMoney(n: number): number {
  return parseFloat(Number(n).toFixed(2))
}

/** Satışın cariye yazılan kısmı. Tamamı peşinse 0. */
export function onAccountAmount(saleTotal: number, paidTotal: number): number {
  return roundMoney(Math.max(0, saleTotal - paidTotal))
}

/**
 * Merkez bakiyesi satışı içeriyor olabilir.
 * ERP etkisi = (fatura gittiyse satış toplamı : 0) − gönderilmiş tahsilatlar.
 * Yerel kayıtta etki düşülmez.
 */
export function computeBeforeAfter(opts: {
  incoming: number
  source: BalanceSource
  saleTotal: number
  paidTotal: number
  invoiceSent: boolean
  paymentsSentTotal: number
}): BalanceMath {
  const onAccount = onAccountAmount(opts.saleTotal, opts.paidTotal)
  if (opts.source === 'kasa') {
    const before = roundMoney(opts.incoming)
    return {
      before,
      after: roundMoney(before + onAccount),
      note: '(kasa kaydı, güncel olmayabilir)',
    }
  }
  const erpEffect = roundMoney((opts.invoiceSent ? opts.saleTotal : 0) - opts.paymentsSentTotal)
  const before = roundMoney(opts.incoming - erpEffect)
  return { before, after: roundMoney(before + onAccount), note: '' }
}

export function formatTl(n: number): string {
  const abs = Math.abs(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (n < -0.004 ? '-' : '') + abs + ' ₺'
}

export function formatTlYon(n: number): string {
  const body = formatTl(Math.abs(n))
  if (n > 0.004) return `${body} Borç`
  if (n < -0.004) return `${body} Alacak`
  return formatTl(0)
}

export function formatBalanceAt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export const EMPTY_BALANCE_FIELDS: Record<string, string> = {
  balance_before: '',
  balance_after: '',
  balance_before_text: '',
  balance_after_text: '',
  balance_at: '',
  balance_note: '',
  balance: '',
}

export function balanceFields(opts: {
  before: number | null
  after: number | null
  asOf: string | null
  note: string
}): Record<string, string> {
  if (opts.before == null || opts.after == null || Number.isNaN(opts.before) || Number.isNaN(opts.after)) {
    return { ...EMPTY_BALANCE_FIELDS }
  }
  return {
    balance_before: formatTl(opts.before),
    balance_after: formatTl(opts.after),
    balance_before_text: formatTlYon(opts.before),
    balance_after_text: formatTlYon(opts.after),
    balance_at: formatBalanceAt(opts.asOf),
    balance_note: opts.note,
    balance: formatTl(opts.after),
  }
}

export function saleBalanceCacheKey(data: RenderData): string {
  const sales = data.sales ?? {}
  const customers = data.customers ?? {}
  return `${String(customers.id ?? '')}|${String(sales.order_no ?? sales.receipt_no ?? '')}`
}

function customerRefs(data: RenderData): { id: string; code: string } {
  const customers = data.customers ?? {}
  return {
    id: String(customers.id ?? '').trim(),
    code: String(customers.code ?? '').trim(),
  }
}

function isTorbaCustomer(id: string, code: string, torbaId: string | null): boolean {
  const torba = (torbaId ?? '').trim()
  return Boolean(torba) && (id === torba || code === torba)
}

/** Ağ isteği yalnızca basılacak şablon bakiye istiyorsa ve bu satışta daha önce sorulmadıysa. */
export function shouldFetchCustomerBalance(
  data: RenderData,
  template: { schema?: unknown },
  session: BalancePrintSession,
  torbaId: string | null,
): boolean {
  if (!templateUsesBalance(template.schema)) return false
  if (session.fetched) return false
  const { id, code } = customerRefs(data)
  if (!id && !code) return false
  if (isTorbaCustomer(id, code, torbaId)) return false
  if (!code) return false
  return true
}

export function mergeCustomerBalance(data: RenderData, fields: Record<string, string>): RenderData {
  return {
    ...data,
    customers: { ...(data.customers ?? {}), ...fields },
  }
}

function paidTotalOf(data: RenderData): number {
  const sales = data.sales ?? {}
  const tendered = Number(sales.tendered_amount)
  if (Number.isFinite(tendered) && tendered > 0) return roundMoney(tendered)
  const cash = Number(sales.cash_amount ?? 0)
  const card = Number(sales.card_amount ?? 0)
  const paid = Number(sales.paid_amount ?? 0)
  const fromParts = roundMoney((Number.isFinite(cash) ? cash : 0) + (Number.isFinite(card) ? card : 0))
  return roundMoney(Math.max(fromParts, Number.isFinite(paid) ? paid : 0))
}

function saleTotalOf(data: RenderData): number {
  const sales = data.sales ?? {}
  const net = Number(sales.net_amount ?? sales.total_amount ?? 0)
  return Number.isFinite(net) ? roundMoney(net) : 0
}

/**
 * Seçilen şablon basılmadan hemen önce. Şablon bakiye istemezse, cari yoksa
 * veya bu satışta sorgu zaten yapıldıysa istek atılmaz.
 */
export async function attachBalanceForTemplate(
  data: RenderData,
  template: { name: string; schema?: unknown },
  session: BalancePrintSession,
  opts: { companyId: string; terminalId: string; torbaId: string | null },
): Promise<RenderData> {
  if (!templateUsesBalance(template.schema)) return data
  if (session.fetched) {
    return session.fields ? mergeCustomerBalance(data, session.fields) : data
  }

  const { id: customerId, code } = customerRefs(data)
  if ((!customerId && !code) || isTorbaCustomer(customerId, code, opts.torbaId) || !code) {
    return data
  }

  session.fetched = true
  const saleNo = String((data.sales ?? {}).order_no ?? (data.sales ?? {}).receipt_no ?? '')
  const line = `[balance] sorgu cari=${code} sebep=sablon:"${template.name}" satis=${saleNo}`
  console.log(line)
  void window.electron.app.log(line).catch(() => {})

  const saleTotal = saleTotalOf(data)
  const paidTotal = paidTotalOf(data)
  let fields = { ...EMPTY_BALANCE_FIELDS }
  try {
    const remote = await api.getCustomerBalance(code, opts.terminalId)
    if (typeof remote.balance !== 'number' || !Number.isFinite(remote.balance)) {
      throw new Error('bakiye yok')
    }
    if (customerId) {
      await window.electron.db.updateCustomerBalance(customerId, remote.balance, remote.as_of)
    }
    const effect = saleNo
      ? await window.electron.db.getSaleErpEffect(saleNo)
      : { invoiceSent: false, paymentsSentTotal: 0 }
    const math = computeBeforeAfter({
      incoming: remote.balance,
      source: 'merkez',
      saleTotal,
      paidTotal,
      invoiceSent: effect.invoiceSent,
      paymentsSentTotal: effect.paymentsSentTotal,
    })
    fields = balanceFields({ before: math.before, after: math.after, asOf: remote.as_of, note: math.note })
  } catch {
    if (customerId) {
      const local = await window.electron.db.getCustomerById(opts.companyId, customerId)
      if (local?.balanceUpdatedAt) {
        const math = computeBeforeAfter({
          incoming: Number(local.balance),
          source: 'kasa',
          saleTotal,
          paidTotal,
          invoiceSent: false,
          paymentsSentTotal: 0,
        })
        fields = balanceFields({
          before: math.before,
          after: math.after,
          asOf: local.balanceUpdatedAt,
          note: math.note,
        })
      }
    }
  }
  session.fields = fields
  return mergeCustomerBalance(data, fields)
}

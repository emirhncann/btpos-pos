/** Carisiz satışın fatura paketi: ayar damgası ve gün sonu gruplama. */

export type InvoiceMode = 'z_single' | 'per_sale'
export type DayEndScope = 'z' | 'previous_days'

export const DAY_END_PACKAGE_LIMIT = 200

export function parseInvoiceMode(value: unknown): InvoiceMode {
  const raw = String(value ?? '').trim().toLowerCase()
  return raw === 'per_sale' ? 'per_sale' : 'z_single'
}

/** Europe/Istanbul takvim günü, YYYY-MM-DD. */
export function istanbulDayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export function formatTrDay(dayKey: string): string {
  const [y, m, d] = dayKey.split('-')
  if (!y || !m || !d) return dayKey
  return `${d}.${m}.${y}`
}

/** Kuyruk gövdesindeki `YYYY-MM-DD HH:MM:SS` damgasını UTC anına çevirir. */
export function invoiceStampToIso(stamp: string): string {
  const trimmed = stamp.trim()
  if (!trimmed) return ''
  if (trimmed.includes('T')) {
    return /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`
  }
  const withT = trimmed.replace(' ', 'T')
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(withT) ? withT : `${withT}Z`
}

export function invoiceDateStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.replace('T', ' ').slice(0, 19)
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

export function formatReceiptNo(receiptNo: string | number): string {
  const raw = String(receiptNo).trim()
  if (/^\d+$/.test(raw) && raw.length < 4) return raw.padStart(4, '0')
  return raw
}

export function formatMoneyTr(amount: number): string {
  return amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatSentInvoice(invoiceNumber: string | null | undefined): string {
  const number = String(invoiceNumber ?? '').trim()
  return number ? `✓ Fatura ${number}` : '✓ Gönderildi'
}

export function formatPerSaleInvoiceLabel(receiptNo: string | number): string {
  return `Fatura — Satış ${formatReceiptNo(receiptNo)}`
}

export function formatDayEndInvoiceLabel(dayKey: string, saleCount: number): string {
  return `Gün sonu faturası — ${formatTrDay(dayKey)} (${saleCount} satış)`
}

export function formatDayEndPaymentLabel(opts: {
  dayLabel: string
  cashAmount: number
  cardByBank: Record<string, { amount?: number; acquirerName?: string }>
}): string {
  const parts: string[] = []
  if (opts.cashAmount > 0.004) parts.push(`Nakit ${formatMoneyTr(opts.cashAmount)}`)
  for (const [id, row] of Object.entries(opts.cardByBank)) {
    const amount = Number(row?.amount ?? 0)
    if (amount <= 0.004) continue
    const name = String(row?.acquirerName ?? '').trim() || id
    parts.push(`${name} ${formatMoneyTr(amount)}`)
  }
  const tail = parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
  return `Tahsilat — Gün sonu ${opts.dayLabel}${tail}`
}

export function groupDayEndSales<T extends { createdAt: string }>(
  rows: T[],
  scope: DayEndScope,
  nowIso: string,
): Array<{ day: string; sales: T[] }> {
  const today = istanbulDayKey(nowIso)
  const filtered = rows.filter(row => {
    const day = istanbulDayKey(row.createdAt)
    if (!day) return false
    if (scope === 'previous_days' && day >= today) return false
    return true
  })
  const byDay = new Map<string, T[]>()
  for (const row of filtered) {
    const day = istanbulDayKey(row.createdAt)
    const list = byDay.get(day) ?? []
    list.push(row)
    byDay.set(day, list)
  }
  const packages: Array<{ day: string; sales: T[] }> = []
  const days = [...byDay.keys()].sort()
  for (const day of days) {
    const ordered = [...(byDay.get(day) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (let i = 0; i < ordered.length; i += DAY_END_PACKAGE_LIMIT) {
      packages.push({ day, sales: ordered.slice(i, i + DAY_END_PACKAGE_LIMIT) })
    }
  }
  return packages
}

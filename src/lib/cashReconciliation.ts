/** Kasa hesap alma: tutar karşılaştırması. Tolerans şimdilik sabit. */
export const RECONCILIATION_TOLERANCE = 5

export const UNKNOWN_BANK_KEY = '__unknown__'
export const UNKNOWN_BANK_LABEL = 'Diğer banka'

export const DENOMINATIONS: Array<{ key: string; label: string; value: number }> = [
  { key: '200', label: '200 TL', value: 200 },
  { key: '100', label: '100 TL', value: 100 },
  { key: '50', label: '50 TL', value: 50 },
  { key: '20', label: '20 TL', value: 20 },
  { key: '10', label: '10 TL', value: 10 },
  { key: '5', label: '5 TL', value: 5 },
  { key: '1', label: '1 TL', value: 1 },
  { key: '050', label: '50 kr', value: 0.5 },
  { key: '025', label: '25 kr', value: 0.25 },
  { key: '010', label: '10 kr', value: 0.1 },
  { key: '005', label: '5 kr', value: 0.05 },
]

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function money(n: number): string {
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** datetime-local (saniye dahil) → UTC ISO. Bitiş saniyesinin son milisaniyesi. */
export function periodBoundIso(localValue: string, edge: 'start' | 'end'): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localValue.trim())
  if (!m) return null
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? '0'),
    edge === 'end' ? 999 : 0,
  )
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function todayStartLocalInput(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00`
}

export function nowLocalInput(): string {
  return isoToLocalInput(new Date().toISOString())
}

export function denominationTotal(counts: Record<string, number>): number {
  return round2(DENOMINATIONS.reduce((sum, d) => sum + (Number(counts[d.key]) || 0) * d.value, 0))
}

export function expectedCash(parts: {
  opening: number
  cashSales: number
  cashCollections: number
  cashRefunds: number
  cashOut: number
}): number {
  return round2(
    parts.opening + parts.cashSales + parts.cashCollections - parts.cashRefunds - parts.cashOut,
  )
}

export function enteredDiff(entered: number, system: number): number {
  return round2(entered - system)
}

export type DiffTone = 'empty' | 'ok' | 'warn' | 'bad'

export function diffTone(diff: number | null, tolerance = RECONCILIATION_TOLERANCE): DiffTone {
  if (diff == null || !Number.isFinite(diff)) return 'empty'
  if (diff === 0) return 'ok'
  if (Math.abs(diff) <= tolerance + 0.001) return 'warn'
  return 'bad'
}

export function noteRequired(totalDiff: number, tolerance = RECONCILIATION_TOLERANCE): boolean {
  return Math.abs(totalDiff) > tolerance + 0.001
}

export interface ReconPaymentRow {
  saleId: string
  method: string
  amount: number
  mediator: number | null
  acquirerId: string | null
  acquirerName: string | null
  isReturn: boolean
}

export interface ReconSaleRow {
  id: string
  isReturn: boolean
  netAmount: number
  discountAmount: number
  cashAmount: number
  cardAmount: number
}

export interface ReconCariRow {
  amount: number
  method: string | null
}

export interface ReconBankDef {
  acquirerId: string
  label: string
}

export interface ReconBrandDef {
  brandId: number
  mediator: number
  label: string
}

export interface ReconSystemLine {
  group: 'card' | 'other'
  key: string
  label: string
  system: number
}

export interface ReconSnapshot {
  cards: ReconSystemLine[]
  others: ReconSystemLine[]
  cashSales: number
  cashCollections: number
  cashRefunds: number
  onAccount: number
  discount: number
  saleCount: number
  refundCount: number
}

export function aggregateReconciliation(input: {
  sales: ReconSaleRow[]
  payments: ReconPaymentRow[]
  collections: ReconCariRow[]
  banks: ReconBankDef[]
  brands: ReconBrandDef[]
}): ReconSnapshot {
  const bankById = new Map<string, { label: string; amount: number }>()
  for (const bank of input.banks) {
    const id = String(bank.acquirerId ?? '').trim()
    if (!id || bankById.has(id)) continue
    bankById.set(id, { label: bank.label || id, amount: 0 })
  }
  let unknown = 0

  const brandByMediator = new Map<number, { label: string; amount: number; brandId: number }>()
  const brands = [...input.brands].sort((a, b) => a.brandId - b.brandId)
  for (const brand of brands) {
    if (brand.brandId === 999) continue
    if (brand.mediator === 1 || brand.mediator === 2) continue
    if (brandByMediator.has(brand.mediator)) continue
    brandByMediator.set(brand.mediator, { label: brand.label, amount: 0, brandId: brand.brandId })
  }
  let otherUnknown = 0

  let cashSales = 0
  let cashRefunds = 0
  const paidBySale = new Map<string, number>()
  const salesWithPayments = new Set<string>()

  for (const pay of input.payments) {
    const amount = Number(pay.amount) || 0
    const signed = pay.isReturn ? -amount : amount
    salesWithPayments.add(pay.saleId)
    paidBySale.set(pay.saleId, round2((paidBySale.get(pay.saleId) ?? 0) + amount))
    const method = String(pay.method ?? '')
    if (method === 'cash') {
      if (pay.isReturn) cashRefunds = round2(cashRefunds + amount)
      else cashSales = round2(cashSales + amount)
      continue
    }
    if (method === 'card') {
      const id = String(pay.acquirerId ?? '').trim()
      const hit = id ? bankById.get(id) : undefined
      if (hit) hit.amount = round2(hit.amount + signed)
      else unknown = round2(unknown + signed)
      continue
    }
    const mediator = pay.mediator == null ? null : Number(pay.mediator)
    const brand = mediator != null && Number.isFinite(mediator) ? brandByMediator.get(mediator) : undefined
    if (brand) brand.amount = round2(brand.amount + signed)
    else otherUnknown = round2(otherUnknown + signed)
  }

  for (const sale of input.sales) {
    if (sale.isReturn || salesWithPayments.has(sale.id)) continue
    const cash = Number(sale.cashAmount) || 0
    const card = Number(sale.cardAmount) || 0
    if (cash) cashSales = round2(cashSales + cash)
    if (card) unknown = round2(unknown + card)
    paidBySale.set(sale.id, round2(cash + card))
  }

  let cashCollections = 0
  for (const row of input.collections) {
    const amount = Number(row.amount) || 0
    const method = String(row.method ?? 'cash')
    if (method === 'card') unknown = round2(unknown + amount)
    else cashCollections = round2(cashCollections + amount)
  }

  let onAccount = 0
  let discount = 0
  let saleCount = 0
  let refundCount = 0
  for (const sale of input.sales) {
    if (sale.isReturn) {
      refundCount += 1
      continue
    }
    saleCount += 1
    discount = round2(discount + (Number(sale.discountAmount) || 0))
    const paid = paidBySale.get(sale.id) ?? 0
    const gap = round2((Number(sale.netAmount) || 0) - paid)
    if (gap > 0) onAccount = round2(onAccount + gap)
  }

  const cards: ReconSystemLine[] = [...bankById.entries()].map(([key, row]) => ({
    group: 'card',
    key,
    label: row.label,
    system: row.amount,
  }))
  if (unknown !== 0) {
    cards.push({ group: 'card', key: UNKNOWN_BANK_KEY, label: UNKNOWN_BANK_LABEL, system: unknown })
  }

  const others: ReconSystemLine[] = [...brandByMediator.entries()]
    .sort((a, b) => a[1].brandId - b[1].brandId)
    .map(([mediator, row]) => ({
      group: 'other' as const,
      key: String(mediator),
      label: row.label,
      system: row.amount,
    }))
  if (otherUnknown !== 0) {
    others.push({ group: 'other', key: '__other__', label: 'Diğer', system: otherUnknown })
  }

  return {
    cards,
    others,
    cashSales,
    cashCollections,
    cashRefunds,
    onAccount,
    discount,
    saleCount,
    refundCount,
  }
}

export interface ReconCatalogItem {
  key: string
  label: string
}

/** Banka ve marka adları. Tutar içermez; kilitten önce gösterilebilir. */
export function catalogFromDefs(banks: ReconBankDef[], brands: ReconBrandDef[]): {
  banks: ReconCatalogItem[]
  others: ReconCatalogItem[]
} {
  const seenBanks = new Set<string>()
  const bankItems: ReconCatalogItem[] = []
  for (const bank of banks) {
    const key = String(bank.acquirerId ?? '').trim()
    if (!key || seenBanks.has(key)) continue
    seenBanks.add(key)
    bankItems.push({ key, label: bank.label || key })
  }
  bankItems.push({ key: UNKNOWN_BANK_KEY, label: UNKNOWN_BANK_LABEL })

  const seenMediators = new Set<number>()
  const others: ReconCatalogItem[] = [...brands]
    .filter(b => b.brandId !== 999 && b.mediator !== 1 && b.mediator !== 2)
    .sort((a, b) => a.brandId - b.brandId)
    .filter(b => {
      if (seenMediators.has(b.mediator)) return false
      seenMediators.add(b.mediator)
      return true
    })
    .map(b => ({ key: String(b.mediator), label: b.label }))
  return { banks: bankItems, others }
}

export interface LockedEntry {
  opening: number
  cashOut: number
  counted: number
  cards: Record<string, number>
  others: Record<string, number>
}

export interface ReconLine {
  group: 'card' | 'other' | 'cash'
  key: string
  label: string
  system: number
  entered: number
  diff: number
}

/** Kilit anındaki giriş ile o anda hesaplanan sistem tutarını karşılaştırır. */
export function buildLockedLines(
  snapshot: ReconSnapshot,
  banks: ReconCatalogItem[],
  others: ReconCatalogItem[],
  entry: LockedEntry,
): { lines: ReconLine[]; expected: number; totalDiff: number } {
  const cardSystem = new Map(snapshot.cards.map(row => [row.key, row.system]))
  const otherSystem = new Map(snapshot.others.map(row => [row.key, row.system]))
  const lines: ReconLine[] = []
  const usedCards = new Set<string>()
  for (const bank of banks) {
    usedCards.add(bank.key)
    const system = cardSystem.get(bank.key) ?? 0
    const entered = round2(entry.cards[bank.key] ?? 0)
    lines.push({ group: 'card', key: bank.key, label: bank.label, system, entered, diff: enteredDiff(entered, system) })
  }
  for (const row of snapshot.cards) {
    if (usedCards.has(row.key)) continue
    const entered = round2(entry.cards[row.key] ?? 0)
    lines.push({ group: 'card', key: row.key, label: row.label, system: row.system, entered, diff: enteredDiff(entered, row.system) })
  }
  const usedOthers = new Set<string>()
  for (const brand of others) {
    usedOthers.add(brand.key)
    const system = otherSystem.get(brand.key) ?? 0
    const entered = round2(entry.others[brand.key] ?? 0)
    lines.push({ group: 'other', key: brand.key, label: brand.label, system, entered, diff: enteredDiff(entered, system) })
  }
  for (const row of snapshot.others) {
    if (usedOthers.has(row.key)) continue
    const entered = round2(entry.others[row.key] ?? 0)
    lines.push({ group: 'other', key: row.key, label: row.label, system: row.system, entered, diff: enteredDiff(entered, row.system) })
  }
  const expected = expectedCash({
    opening: entry.opening,
    cashSales: snapshot.cashSales,
    cashCollections: snapshot.cashCollections,
    cashRefunds: snapshot.cashRefunds,
    cashOut: entry.cashOut,
  })
  lines.push({
    group: 'cash',
    key: 'counted',
    label: 'Sayılan nakit',
    system: expected,
    entered: round2(entry.counted),
    diff: enteredDiff(entry.counted, expected),
  })
  return {
    lines,
    expected,
    totalDiff: round2(lines.reduce((sum, line) => sum + line.diff, 0)),
  }
}

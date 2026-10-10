export type SaleCompletedPayment = {
  label: string
  amount: number
}

export type SaleCompletedPayload = {
  total: number
  payments: SaleCompletedPayment[]
  changeAmount: number
  receiptNo: string
  orderNo: string
  zNo: string | null
  recovered: boolean
}

const listeners = new Set<(p: SaleCompletedPayload | null) => void>()
let current: SaleCompletedPayload | null = null
const settledOrders = new Set<string>()

function emit() {
  const snap = current
  listeners.forEach(fn => { try { fn(snap) } catch { /* pencere satışı bozmasın */ } })
}

export function showSaleCompleted(payload: SaleCompletedPayload) {
  current = payload
  emit()
}

export function hideSaleCompleted() {
  if (!current) return
  current = null
  emit()
}

export function getSaleCompleted() {
  return current
}

export function isSaleCompletedOpen() {
  return current != null
}

export function subscribeSaleCompleted(fn: (p: SaleCompletedPayload | null) => void) {
  listeners.add(fn)
  fn(current)
  return () => { listeners.delete(fn) }
}

export function saleCompletedMs(changeAmount: number): number {
  return changeAmount > 0.009 ? 6000 : 3000
}

/** Aynı satışın iki kez yazılmasını engeller. Hata olursa bırakılır, yeniden denenebilir. */
export function claimSaleSettle(orderNo: string): boolean {
  if (!orderNo || settledOrders.has(orderNo)) return false
  settledOrders.add(orderNo)
  return true
}

export function releaseSaleSettle(orderNo: string) {
  settledOrders.delete(orderNo)
}

export function readZNo(raw: unknown): string | null {
  const seen = new Set<unknown>()
  const stack: unknown[] = [raw]
  const keys = ['ZNo', 'ZNumber', 'ZReportNo', 'zNo', 'z_no']
  while (stack.length) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue
    seen.add(cur)
    const row = cur as Record<string, unknown>
    for (const key of keys) {
      const v = row[key]
      if (v != null && String(v).trim()) return String(v).trim()
    }
    for (const v of Object.values(row)) {
      if (v && typeof v === 'object') stack.push(v)
    }
  }
  return null
}

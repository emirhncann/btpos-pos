import { getPavoPhase, subscribePavoLock } from '../store/pavoLock'

export type RecoveryView =
  | 'checking'
  | 'waiting_device'
  | 'stale_waiting'
  | 'no_payment'
  | 'unreachable'
  | 'partial'
  | 'completing'

export const STALE_WAITING_MS = 45_000
export const UNREACHABLE_CANCEL_MS = 120_000

export type RecoveryInfo = {
  attempt: number
  lastCheck: Date | null
  state: RecoveryView
  error?: string
  nextDelayMs: number
  paidTotal: number
  saleTotal: number
  mediator?: number
  saleId?: number
  saleNumber?: string
  waitingSince: number | null
  unreachableSince: number | null
  displayPayments?: DisplayPayment[]
}

export type DisplayPayment = {
  amount: number
  mediator: number
  status: 'done' | 'waiting' | 'failed'
  cardNo?: string
  name: string
}

export type RecoveryProbe = {
  success: boolean
  message?: string
  status?: string
  statusId?: number
  saleId?: number
  saleNumber?: string
  notFound?: boolean
  data?: unknown
}

export type PendingLookup = {
  kind: 'done' | 'waiting' | 'partial' | 'no_payment' | 'miss' | 'absent'
  paidTotal?: number
  saleTotal?: number
  saleId?: number
  saleNumber?: string
}

type Runtime = {
  probe: (orderNo: string) => Promise<RecoveryProbe>
  settle: (orderNo: string, probe: RecoveryProbe) => Promise<void>
  findPending: (orderNo: string) => Promise<PendingLookup>
  releaseMissing: (orderNo: string) => void
}

/** Cihaz bu OrderNo'yu tanımıyor ve askıda listede de yok. Kilit kalkmalı. */
export function saleGoneFromDevice(probe: Pick<RecoveryProbe, 'notFound'>, pending: Pick<PendingLookup, 'kind'>): boolean {
  return probe.notFound === true && pending.kind === 'absent'
}

const listeners = new Set<(info: RecoveryInfo) => void>()
let info: RecoveryInfo = {
  attempt: 0,
  lastCheck: null,
  state: 'checking',
  nextDelayMs: 5000,
  paidTotal: 0,
  saleTotal: 0,
  waitingSince: null,
  unreachableSince: null,
}
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
let attempt = 0
let activeOrder: string | null = null
let runtime: Runtime | null = null
let waitingSince: number | null = null
let unreachableSince: number | null = null

function emit() {
  const snap = { ...info }
  listeners.forEach(fn => { try { fn(snap) } catch { /* dinleyici döngüyü kesmesin */ } })
}

export function getRecoveryInfo() {
  return info
}

export function subscribeRecovery(fn: (info: RecoveryInfo) => void) {
  listeners.add(fn)
  fn({ ...info })
  return () => { listeners.delete(fn) }
}

export function setRecoveryInfo(next: Partial<RecoveryInfo>) {
  info = { ...info, ...next }
  emit()
}

export function recoveryDelayMs(n: number): number {
  return n <= 12 ? 5_000 : 15_000
}

export function isRecoveryActive() {
  return activeOrder != null && (timer != null || inFlight || getPavoPhase() === 'error')
}

export function setRecoveryRuntime(next: Runtime) {
  runtime = next
}

function clock(d: Date): string {
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function logRecovery(n: number, state: string) {
  console.log(`[pavo-recovery] #${n} ${state} ${clock(new Date())}`)
}

function paymentRows(data: unknown): Record<string, unknown>[] {
  const root = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const inner = root.Data && typeof root.Data === 'object' ? root.Data as Record<string, unknown> : root
  const list = [inner.AddedPayments, inner.Payments, root.AddedPayments, root.Payments]
    .find(Array.isArray) as unknown[] | undefined
  if (!list) return []
  return list.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
}

/** Ekran listesi. Tutar hesabına katılmaz; Alınan yalnız status done. */
export function displayPaymentsOf(data: unknown): DisplayPayment[] {
  return paymentRows(data).flatMap(p => {
    const amount = Number(p.PaymentAmount ?? p.Amount ?? 0)
    if (!(amount > 0)) return []
    const statusId = Number(p.StatusId)
    const mediator = Number(p.PaymentMediatorId ?? p.Mediator ?? 0)
    const online = p.OnlinePayment && typeof p.OnlinePayment === 'object'
      ? p.OnlinePayment as Record<string, unknown>
      : {}
    const cardNo = String(online.CardNo ?? p.CardNo ?? p.MaskedPan ?? '').trim()
    return [{
      amount,
      mediator,
      status: statusId === 2 ? 'done' as const : statusId === 1 ? 'waiting' as const : 'failed' as const,
      cardNo: cardNo || undefined,
      name: mediator === 1 ? 'Nakit' : mediator === 2 ? 'Kredi Kartı' : 'Diğer',
    }]
  })
}

/** Alınmış tutar yalnız StatusId 2. WaitingPayment (1) toplama girmez. */
export function paymentTotals(data: unknown): {
  paidTotal: number
  saleTotal: number
  hasWaiting: boolean
  remaining: number
  mediator?: number
} {
  const rows = paymentRows(data)
  const paidRows = rows.filter(p => Number(p.StatusId) === 2)
  const paidTotal = parseFloat(paidRows.reduce((s, p) => s + Number(p.PaymentAmount ?? p.Amount ?? 0), 0).toFixed(2))
  const waitingRow = rows.find(p => Number(p.StatusId) === 1)
  const saleTotal = saleTotalOf(data)
  const mediatorRaw = Number(
    (waitingRow ?? paidRows[paidRows.length - 1])?.PaymentMediatorId
    ?? (waitingRow ?? paidRows[paidRows.length - 1])?.Mediator,
  )
  return {
    paidTotal,
    saleTotal,
    hasWaiting: waitingRow != null,
    remaining: parseFloat(Math.max(0, saleTotal - paidTotal).toFixed(2)),
    mediator: Number.isFinite(mediatorRaw) && mediatorRaw > 0 ? mediatorRaw : undefined,
  }
}

function saleTotalOf(data: unknown): number {
  const root = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const inner = root.Data && typeof root.Data === 'object' ? root.Data as Record<string, unknown> : root
  const n = Number(inner.TotalPrice ?? inner.GrossPrice ?? root.TotalPrice ?? 0)
  return Number.isFinite(n) ? n : 0
}

export type ProbeSummary = {
  kind: 'completed' | 'waiting_device' | 'partial' | 'no_payment' | 'unreachable'
  paidTotal: number
  saleTotal: number
  hasWaiting: boolean
  mediator?: number
}

export function summarizeProbe(res: RecoveryProbe): ProbeSummary {
  if (!res.success) {
    return { kind: 'unreachable', paidTotal: 0, saleTotal: 0, hasWaiting: false }
  }
  const totals = paymentTotals(res.data)
  const paidTotal = totals.paidTotal
  const hasWaiting = totals.hasWaiting
  const saleTotal = totals.saleTotal
  const mediator = totals.mediator
  const completed = res.status === 'completed'
    || res.statusId === 4
    || res.statusId === 8
    || (saleTotal > 0 && paidTotal + 0.009 >= saleTotal)
  if (completed) return { kind: 'completed', paidTotal, saleTotal, hasWaiting, mediator }
  if (paidTotal > 0.009) return { kind: 'partial', paidTotal, saleTotal, hasWaiting, mediator }
  if (hasWaiting) return { kind: 'waiting_device', paidTotal, saleTotal, hasWaiting, mediator }
  return { kind: 'no_payment', paidTotal, saleTotal, hasWaiting, mediator }
}

export function classifyProbe(res: RecoveryProbe): ProbeSummary['kind'] {
  return summarizeProbe(res).kind
}

export function shownRecoveryState(snap: RecoveryInfo, now = Date.now()): RecoveryView {
  if (snap.state === 'waiting_device' && snap.waitingSince != null && now - snap.waitingSince > STALE_WAITING_MS) {
    return 'stale_waiting'
  }
  return snap.state
}

export function canCancelRecovery(snap: RecoveryInfo, now = Date.now()): boolean {
  const state = shownRecoveryState(snap, now)
  if (state === 'stale_waiting' || state === 'no_payment') return true
  if (state === 'unreachable' && snap.unreachableSince != null && now - snap.unreachableSince >= UNREACHABLE_CANCEL_MS) return true
  return false
}

export function startRecoveryPolling(ctx: { orderNo: string }) {
  if (!ctx.orderNo) return
  if (activeOrder === ctx.orderNo && (timer || inFlight)) return
  stopRecoveryPolling()
  activeOrder = ctx.orderNo
  attempt = 0
  void tick(ctx)
}

export function stopRecoveryPolling() {
  if (timer) clearTimeout(timer)
  timer = null
  activeOrder = null
  waitingSince = null
  unreachableSince = null
}

export function isRecoveryInFlight() {
  return inFlight
}

/** Açılışta zaten askıda kalan satış 45 sn daha bekletilmesin. */
export function primeStaleWaiting() {
  waitingSince = Date.now() - STALE_WAITING_MS - 1
}

export function requestRecoveryNow() {
  if (!activeOrder || inFlight) return
  if (timer) clearTimeout(timer)
  timer = null
  void tick({ orderNo: activeOrder })
}

function applyWaitingClock(kind: Exclude<ProbeSummary['kind'], 'completed'>): RecoveryView {
  if (kind === 'waiting_device') {
    waitingSince ??= Date.now()
    unreachableSince = null
    return Date.now() - waitingSince > STALE_WAITING_MS ? 'stale_waiting' : 'waiting_device'
  }
  waitingSince = null
  if (kind === 'unreachable') {
    unreachableSince ??= Date.now()
    return 'unreachable'
  }
  unreachableSince = null
  return kind
}

async function tick(ctx: { orderNo: string }) {
  if (inFlight) return
  if (getPavoPhase() !== 'error') return
  inFlight = true
  attempt += 1
  const n = attempt
  setRecoveryInfo({ attempt: n, lastCheck: new Date(), state: 'checking', error: undefined, nextDelayMs: recoveryDelayMs(n) })
  logRecovery(n, 'checking')
  let finished = false
  let saleNotFound = false
  try {
    if (!runtime) throw new Error('Kurtarma hazır değil')
    const probe = await runtime.probe(ctx.orderNo)
    if (!probe.success) {
      saleNotFound = probe.notFound === true
      throw new Error(probe.message ?? 'Sonuç alınamadı')
    }
    const summary = summarizeProbe(probe)
    if (summary.kind === 'completed') {
      waitingSince = null
      logRecovery(n, 'completing')
      setRecoveryInfo({ state: 'completing', paidTotal: summary.paidTotal, saleTotal: summary.saleTotal, waitingSince: null })
      await runtime.settle(ctx.orderNo, probe)
      finished = true
      stopRecoveryPolling()
      return
    }
    const view = applyWaitingClock(summary.kind)
    logRecovery(n, view)
    setRecoveryInfo({
      state: view,
      error: undefined,
      paidTotal: summary.paidTotal,
      saleTotal: summary.saleTotal,
      mediator: summary.mediator,
      saleId: probe.saleId,
      saleNumber: probe.saleNumber,
      waitingSince,
      unreachableSince: null,
      displayPayments: displayPaymentsOf(probe.data),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    let pending: PendingLookup = { kind: 'miss' }
    try {
      pending = await runtime?.findPending(ctx.orderNo) ?? { kind: 'miss' }
    } catch {
      pending = { kind: 'miss' }
    }
    if (pending.kind === 'done') {
      finished = true
      stopRecoveryPolling()
      return
    }
    if (saleGoneFromDevice({ notFound: saleNotFound }, pending)) {
      logRecovery(n, 'missing')
      finished = true
      stopRecoveryPolling()
      runtime?.releaseMissing(ctx.orderNo)
      return
    }
    const mapped: ProbeSummary['kind'] = pending.kind === 'waiting'
      ? 'waiting_device'
      : pending.kind === 'partial'
        ? 'partial'
        : pending.kind === 'no_payment'
          ? 'no_payment'
          : 'unreachable'
    const view = applyWaitingClock(mapped)
    logRecovery(n, view)
    setRecoveryInfo({
      state: view,
      error: message,
      paidTotal: pending.paidTotal ?? info.paidTotal,
      saleTotal: pending.saleTotal ?? info.saleTotal,
      saleId: pending.saleId ?? info.saleId,
      saleNumber: pending.saleNumber ?? info.saleNumber,
      waitingSince,
      unreachableSince,
    })
  } finally {
    inFlight = false
  }
  if (finished || getPavoPhase() !== 'error' || activeOrder !== ctx.orderNo) return
  const delay = recoveryDelayMs(n)
  setRecoveryInfo({ nextDelayMs: delay })
  timer = setTimeout(() => { void tick(ctx) }, delay)
}

subscribePavoLock(snap => {
  if (snap.phase === 'error' && snap.info.orderNo) startRecoveryPolling({ orderNo: snap.info.orderNo })
  else if (snap.phase !== 'error') stopRecoveryPolling()
})

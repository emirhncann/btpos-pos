import { useEffect, useState } from 'react'

export type PavoPhase =
  | 'idle'
  | 'sending'
  | 'open'
  | 'completing'
  | 'error'

export type PavoLockInfo = {
  amount?: number
  method?: string
  message?: string
  orderNo?: string
  startedAt?: number
}

type Snapshot = { phase: PavoPhase; info: PavoLockInfo }

const listeners = new Set<(s: Snapshot) => void>()
let phase: PavoPhase = 'idle'
let info: PavoLockInfo = {}
let lastNotify = 0
let notifier: (msg: string) => void = () => {}

export class CartLockedError extends Error {
  constructor() {
    super('Ödeme sürerken sepet değiştirilemez')
    this.name = 'CartLockedError'
  }
}

function emit() {
  const snap: Snapshot = { phase, info: { ...info } }
  listeners.forEach(l => { try { l(snap) } catch { /* dinleyici kilidi bozmasın */ } })
}

export const isCartLocked = () => phase !== 'idle'
export const isFullScreen = () => phase === 'sending' || phase === 'completing' || phase === 'error'
export const isBusy = () => isCartLocked()
export const getPavoPhase = () => phase
export const getPavoLockInfo = () => info

export function setPavoPhase(p: PavoPhase, next?: PavoLockInfo) {
  phase = p
  if (p === 'idle') {
    info = {}
  } else {
    const startedAt = info.startedAt ?? Date.now()
    info = { ...info, ...next, startedAt: next?.startedAt ?? startedAt }
  }
  emit()
}

export function setLockNotifier(fn: (msg: string) => void) {
  notifier = fn
}

export function notifyLocked() {
  const now = Date.now()
  if (now - lastNotify < 2000) return
  lastNotify = now
  try { notifier('Ödeme sürerken sepet değiştirilemez') } catch { /* uyarı akışı bozmasın */ }
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 440
    gain.gain.value = 0.04
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    osc.onended = () => { void ctx.close() }
  } catch { /* ses yoksa uyarı yeter */ }
}

export function assertCartEditable() {
  if (isCartLocked()) {
    notifyLocked()
    throw new CartLockedError()
  }
}

export function subscribePavoLock(fn: (s: Snapshot) => void) {
  listeners.add(fn)
  fn({ phase, info: { ...info } })
  return () => { listeners.delete(fn) }
}

export function usePavoLock() {
  const [snap, setSnap] = useState<Snapshot>({ phase: getPavoPhase(), info: { ...getPavoLockInfo() } })
  useEffect(() => subscribePavoLock(setSnap), [])
  return snap
}

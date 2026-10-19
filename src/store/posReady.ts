import { useEffect, useState } from 'react'
import { isPosDefined, type PosDeviceSnapshot } from '../services/pos/posReadiness'

let snap: PosDeviceSnapshot | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => {
    try { fn() } catch { /* dinleyici */ }
  })
}

export function getPosSnapshot(): PosDeviceSnapshot | null {
  return snap
}

export function isPosReady(): boolean {
  return isPosDefined(snap)
}

export function setPosSnapshot(next: PosDeviceSnapshot | null): void {
  snap = next
  emit()
}

export function subscribePosReady(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function usePosReady(): boolean {
  const [ready, setReady] = useState(isPosReady)
  useEffect(() => subscribePosReady(() => setReady(isPosReady())), [])
  return ready
}

export async function refreshPosReady(): Promise<PosDeviceSnapshot | null> {
  try {
    const row = await window.electron.db.getPaymentDeviceSettings('pavo')
    if (!row?.ipAddress && !row?.serialNo) {
      setPosSnapshot(null)
      return null
    }
    const next: PosDeviceSnapshot = {
      ipAddress: row?.ipAddress ?? '',
      serialNo: row?.serialNo ?? '',
      isActive: row?.isActive !== false,
      port: row?.port ?? 9100,
      cardReadTimeout: row?.cardReadTimeout ?? 30,
      printWidth: row?.printWidth === '58mm' ? '58mm' : '80mm',
    }
    setPosSnapshot(isPosDefined(next) ? next : null)
    return isPosDefined(next) ? next : null
  } catch {
    setPosSnapshot(null)
    return null
  }
}

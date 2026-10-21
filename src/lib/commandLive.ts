import { cmdProgress, type CmdProgressState } from './cmdProgress'

export type CommandExtra = {
  error?: string
  startedAt?: string
  seenAt?: string
}

const KEY = 'btpos.commandExtras'
const mem = new Map<string, CommandExtra>()
let hooked = false

function readStored(): void {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, CommandExtra>
    for (const [id, extra] of Object.entries(parsed)) {
      if (extra && typeof extra === 'object') mem.set(id, extra)
    }
  } catch { /* eski kayıt yok */ }
}

function writeStored(): void {
  try {
    const obj: Record<string, CommandExtra> = {}
    for (const [id, extra] of mem) obj[id] = extra
    localStorage.setItem(KEY, JSON.stringify(obj))
  } catch { /* depolama dolu */ }
}

function absorb(state: CmdProgressState): void {
  let changed = false
  for (const item of state.items) {
    const prev = mem.get(item.id) ?? {}
    const next: CommandExtra = { ...prev }
    if (!next.seenAt) {
      next.seenAt = new Date().toISOString()
      changed = true
    }
    if (item.status === 'running' && !next.startedAt) {
      next.startedAt = new Date().toISOString()
      changed = true
    }
    if (item.error && next.error !== item.error) {
      next.error = item.error
      changed = true
    }
    mem.set(item.id, next)
  }
  if (changed) writeStored()
}

/** İlerleme deposunu okur. Komut alma ve onay akışına yazmaz. */
export function watchCommandProgress(): void {
  if (hooked) return
  hooked = true
  readStored()
  cmdProgress.subscribe(absorb)
}

export function commandExtra(id: string): CommandExtra | undefined {
  return mem.get(id)
}

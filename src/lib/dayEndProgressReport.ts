import { postDayEndStatus } from './dayEndApi'

const GAP_MS = 5_000
const tail = new Map<string, Promise<void>>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const lastSentAt = new Map<string, number>()
const suppressed = new Set<string>()

/** Aynı run'ın durum POST'ları sırayı bozmaz. */
export function enqueueRunStatus(runId: string, job: () => Promise<void>): Promise<void> {
  const prev = tail.get(runId) ?? Promise.resolve()
  const next = prev.then(job, job)
  tail.set(runId, next.then(() => undefined, () => undefined))
  return next
}

export function holdDayEndProgress(runId: string): void {
  const id = runId.trim()
  if (!id) return
  suppressed.add(id)
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
}

export function scheduleDayEndProgress(runId: string): void {
  const id = runId.trim()
  if (!id || suppressed.has(id) || timers.has(id)) return
  const wait = Math.max(0, GAP_MS - (Date.now() - (lastSentAt.get(id) ?? 0)))
  timers.set(id, setTimeout(() => {
    timers.delete(id)
    void sendDayEndProgress(id)
  }, wait))
}

async function sendDayEndProgress(runId: string): Promise<void> {
  await enqueueRunStatus(runId, async () => {
    if (suppressed.has(runId)) return
    const snap = await window.electron.db.dayEndProgress(runId)
    if (!snap) return
    if (snap.status === 'completed' || snap.status === 'released' || snap.status === 'completed_empty' || snap.status === 'rejected') {
      return
    }
    if (
      snap.status === 'processing'
      && snap.docsSent === snap.reportedSent
      && snap.docsTotal === snap.reportedTotal
    ) return
    await postDayEndStatus(runId, {
      status: 'processing',
      docs_total: snap.docsTotal,
      docs_sent: snap.docsSent,
    })
    await window.electron.db.markDayEndProgress(runId, snap.docsTotal, snap.docsSent)
    lastSentAt.set(runId, Date.now())
  })
}

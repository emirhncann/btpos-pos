import { API_URL } from './api'

export async function postDayEndStatus(runId: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_URL}/pos/day-end/runs/${encodeURIComponent(runId)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Gün sonu durum bildirimi başarısız (HTTP ${res.status})`)
}

/** Failed bildirilmiş koşunun satırı yeniden pending olunca processing yollar. Aynı durum tekrar gitmez. */
export async function postDayEndProcessingIfFailed(runIds: Array<string | null | undefined>): Promise<void> {
  const unique = [...new Set(runIds.map(id => String(id ?? '').trim()).filter(Boolean))]
  for (const runId of unique) {
    try {
      const status = await window.electron.db.dayEndRunStatus(runId)
      if (status !== 'failed') continue
      const snap = await window.electron.db.dayEndProgress(runId)
      await postDayEndStatus(runId, {
        status: 'processing',
        docs_total: snap?.docsTotal ?? 0,
        docs_sent: snap?.docsSent ?? 0,
      })
      await window.electron.db.markDayEndProgress(runId, snap?.docsTotal ?? 0, snap?.docsSent ?? 0)
    } catch (e) {
      console.warn('[day-end] processing bildirimi:', runId, e)
    }
  }
}

export async function postDailySummary(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_URL}/pos/daily-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Günlük özet bildirimi başarısız (HTTP ${res.status})`)
}

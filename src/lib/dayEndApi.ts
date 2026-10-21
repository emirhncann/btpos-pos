import { API_URL } from './api'

export async function postDayEndStatus(runId: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_URL}/pos/day-end/runs/${encodeURIComponent(runId)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Gün sonu durum bildirimi başarısız (HTTP ${res.status})`)
}

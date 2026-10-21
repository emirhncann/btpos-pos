const SECRET = /password|pass|secret|token|hash|key|fingerprint/i

export type CommandRange = 'today' | '7' | '30'

export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET.test(key) ? '••••' : maskSecrets(item)
    }
    return out
  }
  return value
}

export function formatDetail(value: unknown): string {
  const masked = maskSecrets(value)
  if (masked == null) return ''
  if (typeof masked === 'string') {
    const trimmed = masked.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.stringify(maskSecrets(JSON.parse(trimmed)), null, 2) } catch { /* metin */ }
    }
    return masked
  }
  try { return JSON.stringify(masked, null, 2) } catch { return String(masked) }
}

export function istanbulDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find(p => p.type === 'year')?.value
  const m = parts.find(p => p.type === 'month')?.value
  const day = parts.find(p => p.type === 'day')?.value
  if (!y || !m || !day) return null
  return `${y}-${m}-${day}`
}

const IST_DATE_TIME: Intl.DateTimeFormatOptions = {
  timeZone: 'Europe/Istanbul',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}

export function formatIstanbulDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('tr-TR', IST_DATE_TIME).format(d)
}

export function formatIstanbulRange(start: string | null | undefined, end: string | null | undefined): string {
  const a = formatIstanbulDateTime(start)
  const b = formatIstanbulDateTime(end)
  if (!a || !b) return ''
  return `${a} – ${b}`
}

export function istanbulClock(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(d)
}

export function dayShift(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export function istanbulToday(): string {
  return istanbulDay(new Date().toISOString()) ?? '1970-01-01'
}

export function inCommandRange(iso: string | null | undefined, range: CommandRange): boolean {
  const day = istanbulDay(iso)
  if (!day) return false
  const today = istanbulToday()
  if (range === 'today') return day === today
  const span = range === '7' ? 6 : 29
  return day >= dayShift(today, -span) && day <= today
}

export type DayPreset = 'today' | 'yesterday' | '7' | '30'

export function presetBounds(preset: DayPreset): { from: string; to: string } {
  const today = istanbulToday()
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'yesterday') {
    const day = dayShift(today, -1)
    return { from: day, to: day }
  }
  if (preset === '7') return { from: dayShift(today, -6), to: today }
  return { from: dayShift(today, -29), to: today }
}

export function inDayBounds(iso: string | null | undefined, from: string, to: string): boolean {
  const day = istanbulDay(iso)
  if (!day) return false
  return day >= from && day <= to
}

export function formatDayRange(from: string, to: string): string {
  const a = from.split('-')
  const b = to.split('-')
  if (from === to) return `${a[2]}.${a[1]}.${a[0]}`
  if (a[0] === b[0]) return `${a[2]}.${a[1]} – ${b[2]}.${b[1]}.${b[0]}`
  return `${a[2]}.${a[1]}.${a[0]} – ${b[2]}.${b[1]}.${b[0]}`
}

export function dayHeading(day: string): string {
  const today = istanbulToday()
  if (day === today) return 'BUGÜN'
  if (day === dayShift(today, -1)) return 'DÜN'
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12))
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(date)
}

export function durationLabel(start?: string | null, end?: string | null): string {
  if (!start || !end) return ''
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} sn`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem ? `${min} dk ${rem} sn` : `${min} dk`
}

export function payloadSummary(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return ''
  const version = payload.version
  if (typeof version === 'string' && version.trim()) return version.trim()
  const groups = payload.groups ?? payload.plu_groups
  if (Array.isArray(groups)) return `${groups.length} grup`
  const templates = payload.template_ids
  if (Array.isArray(templates)) return `${templates.length} şablon`
  const text = payload.text ?? payload.message
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 42)
  return ''
}

export function shortId(id: string): string {
  if (id.length <= 12) return id
  return `${id.slice(0, 4)}…${id.slice(-3)}`
}

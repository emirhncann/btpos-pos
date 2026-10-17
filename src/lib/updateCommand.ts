/** update_app kararı. Komut döngüsünden bağımsız; poll sırasını değiştirmez. */

export interface UpdateCommandRef {
  targetId: string
  version: string
  createdAt: string
}

export interface UpdateAppContext {
  createdAt: string
  targetId: string
  requestedName: string | null
  batch: UpdateCommandRef[]
}

export type UpdateCommandDecision =
  | { action: 'done'; message: string }
  | { action: 'prompt' }

const NAME_KEYS = ['created_by_name', 'requested_by_name', 'requested_name', 'issuer_name', 'admin_name'] as const

export function formatTrDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ignoredUpdateMessage(version: string, createdAt: string): string {
  const when = createdAt ? formatTrDateTime(createdAt) : ''
  return when ? `Eski komut yok sayıldı (${version}, ${when})` : `Eski komut yok sayıldı (${version})`
}

function newestInBatch(batch: UpdateCommandRef[]): UpdateCommandRef | null {
  let best: UpdateCommandRef | null = null
  for (const item of batch) {
    if (!best || item.createdAt > best.createdAt || (item.createdAt === best.createdAt && item.targetId > best.targetId)) {
      best = item
    }
  }
  return best
}

export function decideUpdateCommand(input: {
  version: string
  current: string
  installedAt: string | null
  createdAt: string
  targetId: string
  batch: UpdateCommandRef[]
}): UpdateCommandDecision {
  if (input.version === input.current) {
    return { action: 'done', message: 'Bu sürüm zaten kurulu' }
  }

  const created = input.createdAt ? new Date(input.createdAt) : null
  const installed = input.installedAt ? new Date(input.installedAt) : null
  if (
    created && installed
    && !Number.isNaN(created.getTime())
    && !Number.isNaN(installed.getTime())
    && created < installed
  ) {
    return { action: 'done', message: ignoredUpdateMessage(input.version, input.createdAt) }
  }

  const newest = newestInBatch(input.batch)
  if (newest && newest.targetId !== input.targetId) {
    return { action: 'done', message: ignoredUpdateMessage(input.version, input.createdAt) }
  }

  return { action: 'prompt' }
}

function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const av = parse(a)
  const bv = parse(b)
  const n = Math.max(av.length, bv.length)
  for (let i = 0; i < n; i++) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Elle daha yeni sürüme geçildiyse açılışta bekleyen bant silinir. */
export function shouldClearPendingAdminUpdate(
  pending: { version?: string; created_at?: string } | null | undefined,
  current: string,
  installedAt: string | null,
): boolean {
  if (!pending?.version) return false
  if (pending.version === current) return true

  const created = pending.created_at ? new Date(pending.created_at) : null
  const installed = installedAt ? new Date(installedAt) : null
  if (
    created && installed
    && !Number.isNaN(created.getTime())
    && !Number.isNaN(installed.getTime())
  ) {
    return created < installed
  }

  return !pending.created_at && compareVersions(current, pending.version) > 0
}

export function requestedNameFrom(
  payload: Record<string, unknown> | null | undefined,
  command?: { created_by_name?: string | null },
): string | null {
  const values: unknown[] = [command?.created_by_name]
  if (payload) {
    for (const key of NAME_KEYS) values.push(payload[key])
  }
  for (const value of values) {
    if (typeof value !== 'string') continue
    const name = value.trim()
    if (!name) continue
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) continue
    return name
  }
  return null
}

export function downgradeBannerText(opts: {
  from: string
  to: string
  requestedName?: string | null
  createdAt?: string | null
}): string {
  const who = (opts.requestedName ?? '').trim()
  const when = opts.createdAt ? formatTrDateTime(opts.createdAt) : ''
  const detail = who && when ? `${who}, ${when}` : (who || when)
  const tail = detail ? ` (${detail})` : ''
  return `Yönetici bu kasanın sürümünü ${opts.from} → ${opts.to}'e düşürmek istiyor${tail}.`
}

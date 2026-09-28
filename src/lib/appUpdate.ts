import { API_URL } from './api'
import { sendPendingInvoices } from './invoiceSend'
import { pavoListPendingSales, type PavoSettings } from './pavoService'
import { processOperationQueue } from '../hooks/useQueueWorker'

export interface Release {
  id: string
  version: string
  base_url: string
  schema_version?: number
  published_at?: string
  channel?: string
  notes?: string
  is_mandatory?: boolean
}

export interface AdminUpdatePayload {
  release_id: string
  version: string
  base_url: string
  schema_version?: number
  mode?: 'prompt' | 'on_close'
  is_mandatory?: boolean
}

const BLOCKING_QUEUE = new Set([
  'invoice', 'return_invoice', 'customer', 'day_end_invoice', 'payment',
])

export function compareVersions(a: string, b: string): number {
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

export function semverLt(a: string, b: string): boolean {
  return compareVersions(a, b) < 0
}

function emit(phase: string, extra?: { percent?: number; message?: string }) {
  window.dispatchEvent(new CustomEvent('btpos-update-status', {
    detail: { phase, percent: extra?.percent, message: extra?.message },
  }))
}

async function companyAndTerminal(): Promise<{ companyId: string; terminalId: string }> {
  const companyId = String(await window.electron.store.get('company_id') ?? '')
  const terminalId = String(await window.electron.store.get('terminal_id') ?? '')
  return { companyId, terminalId }
}

async function enqueueReport(endpoint: string, body: Record<string, unknown>): Promise<void> {
  const { companyId } = await companyAndTerminal()
  if (!companyId) return
  await window.electron.db.enqueueOperation({
    id: crypto.randomUUID(),
    companyId,
    type: 'app_report',
    payload: { endpoint, method: 'POST', body },
    label: 'Sürüm bildirimi',
  })
}

export async function postUpdateLog(body: Record<string, unknown>): Promise<string> {
  const { terminalId } = await companyAndTerminal()
  const endpoint = `/terminals/${terminalId}/update-logs`
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { id?: string }
    return String(data.id ?? body.id ?? '')
  } catch {
    await enqueueReport(endpoint, body).catch(() => {})
    return String(body.id ?? '')
  }
}

export async function reportAppVersion(): Promise<void> {
  const { terminalId } = await companyAndTerminal()
  if (!terminalId) return
  const appVersion = await window.electron.update.getVersion()
  const schema = await window.electron.db.userVersion()
  const pending = await window.electron.store.get('pendingUpdateLogId')
  const body: Record<string, unknown> = {
    app_version: appVersion,
    db_schema_version: schema,
  }
  if (typeof pending === 'string' && pending) body.pending_update_log_id = pending
  const endpoint = `/terminals/${terminalId}/app-version`
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (body.pending_update_log_id) await window.electron.store.set('pendingUpdateLogId', null)
  } catch {
    await enqueueReport(endpoint, body).catch(() => {})
  }
}

async function assertSafeToUpdate(opts: {
  cartActive: boolean
  schemaVersion?: number
}): Promise<void> {
  if (opts.cartActive) throw new Error('Sepet doluyken güncelleme başlatılamaz.')

  const device = await window.electron.db.getPaymentDeviceSettings('pavo')
  if (device?.ipAddress && device.isActive) {
    const settings: PavoSettings = {
      ipAddress: device.ipAddress,
      port: device.port,
      serialNo: device.serialNo ?? '',
      cardReadTimeout: device.cardReadTimeout,
      printWidth: device.printWidth,
    }
    try {
      const seq = await window.electron.db.nextPavoSequence()
      const pending = await pavoListPendingSales(settings, seq)
      if (!pending.success) {
        throw new Error(pending.message || 'Pavo askıda satış kontrolü başarısız.')
      }
      if (pending.sales.length > 0) {
        throw new Error(`Pavo'da ${pending.sales.length} askıda satış var. Önce tamamlayın veya iptal edin.`)
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('askıda')) throw e
      throw new Error(`Pavo'ya ulaşılamadı, askıda satış kontrol edilemedi. ${e instanceof Error ? e.message : ''}`)
    }
  }

  const { companyId } = await companyAndTerminal()
  if (companyId) {
    const countBlocking = async () => {
      const ops = await window.electron.db.getPendingOperations(companyId)
      return ops.filter(op => op.status === 'pending' && BLOCKING_QUEUE.has(op.type)).length
    }
    let waiting = await countBlocking()
    if (waiting > 0) {
      await sendPendingInvoices(companyId, { silent: true }).catch(() => {})
      await processOperationQueue({
        companyId,
        isOnline: true,
        onToast: () => {},
        includeDayEnd: true,
      }).catch(() => {})
      waiting = await countBlocking()
      if (waiting > 0) throw new Error(`${waiting} iş bekliyor. Önce gönderin.`)
    }
  }

  if (opts.schemaVersion != null) {
    const local = await window.electron.db.userVersion()
    if (opts.schemaVersion < local) {
      throw new Error('Veritabanı uyumsuz, bu sürüme dönülemez.')
    }
  }
}

export async function runUpdate(
  release: Release,
  requestedBy: 'pos' | 'admin',
  opts: { logId?: string; cartActive?: boolean },
): Promise<void> {
  const from = await window.electron.update.getVersion()
  emit('checking')
  await assertSafeToUpdate({
    cartActive: opts.cartActive === true,
    schemaVersion: release.schema_version,
  })

  let logId = await postUpdateLog({
    id: opts.logId,
    release_id: release.id,
    from_version: from,
    to_version: release.version,
    is_downgrade: semverLt(release.version, from),
    requested_by: requestedBy,
    status: 'downloading',
    progress: 0,
  })

  const off = window.electron.update.onProgress(percent => {
    emit('downloading', { percent })
  })
  let bucket = 0
  const offLog = window.electron.update.onProgress(percent => {
    const step = Math.min(100, Math.floor(percent / 25) * 25)
    if (step > bucket && logId) {
      bucket = step
      void postUpdateLog({ id: logId, status: 'downloading', progress: step })
    }
  })

  try {
    await window.electron.update.prepare(release.base_url, release.version)
    emit('downloading', { percent: 0 })
    await window.electron.update.download()
    off()
    offLog()
    await postUpdateLog({ id: logId, status: 'downloaded', progress: 100 })

    emit('backup')
    await window.electron.db.backupNow(`pre-update-${from}-to-${release.version}`)

    emit('installing')
    await postUpdateLog({ id: logId, status: 'installing' })
    if (logId) await window.electron.store.set('pendingUpdateLogId', logId)
    await window.electron.store.set('pendingAdminUpdate', null)
    await window.electron.update.install()
  } catch (e) {
    off()
    offLog()
    const message = e instanceof Error ? e.message : String(e)
    await postUpdateLog({ id: logId, status: 'failed', error: message })
    emit('error', { message })
    throw e
  }
}

export function releaseFromAdmin(p: AdminUpdatePayload): Release {
  return {
    id: p.release_id,
    version: p.version,
    base_url: p.base_url,
    schema_version: p.schema_version,
    is_mandatory: p.is_mandatory,
  }
}

export async function readPendingAdminUpdate(): Promise<AdminUpdatePayload | null> {
  const raw = await window.electron.store.get('pendingAdminUpdate')
  if (!raw || typeof raw !== 'object') return null
  const p = raw as AdminUpdatePayload
  if (!p.version || !p.base_url || !p.release_id) return null
  return p
}

export async function maybeRunScheduledUpdate(opts: { cartActive: boolean }): Promise<void> {
  const pending = await readPendingAdminUpdate()
  if (!pending) return
  if (pending.mode !== 'on_close' && !pending.is_mandatory) return
  await runUpdate(releaseFromAdmin(pending), 'admin', { cartActive: opts.cartActive })
}

import { useEffect, useRef, useCallback, useState } from 'react'
import { api } from '../lib/api'
import { adminCommandError, isCommandAckResult, type CommandAckResult } from '../lib/commandResult'
import { requestedNameFrom, type UpdateAppContext } from '../lib/updateCommand'
import { cmdProgress } from '../lib/cmdProgress'
import { isBusy } from '../store/pavoLock'

export type SyncMode = 'full' | 'diff'

export function syncModeFromPayload(payload: unknown): SyncMode {
  const m = (payload as Record<string, unknown> | null | undefined)?.mode
  return m === 'diff' ? 'diff' : 'full'
}

export interface CommandHandlers {
  onSyncAll:            (mode?: SyncMode) => Promise<CommandAckResult | void>
  onSyncPrices:         () => Promise<CommandAckResult | void>
  onSyncCashiers:       (mode?: SyncMode) => Promise<CommandAckResult | void>
  onSyncPlu:            (mode?: SyncMode) => Promise<CommandAckResult | void>
  onSyncCustomers:      (mode?: SyncMode) => Promise<CommandAckResult | void>
  onSyncProducts:       (mode?: SyncMode) => Promise<CommandAckResult | void>
  onSyncSettings:       () => Promise<CommandAckResult | void>
  onSyncTemplates:      () => Promise<CommandAckResult | void>
  onSyncPaymentBrands:  () => Promise<CommandAckResult | void>
  onPairPavo:           (payload?: Record<string, unknown>) => Promise<CommandAckResult | void>
  onLogout:             () => void
  onMessage:            (text: string, duration?: number) => CommandAckResult | void
  onRestart:            () => void
  onLock:               (reason?: string) => void
  onUpdateApp:          (payload: Record<string, unknown>, ctx: UpdateAppContext) => Promise<CommandAckResult | void>
  onDayEndRun:          (payload: Record<string, unknown>) => Promise<CommandAckResult | void>
  onDayEndRetry:        (payload: Record<string, unknown>) => Promise<CommandAckResult | void>
  onDayEndRelease:      (payload: Record<string, unknown>) => Promise<CommandAckResult | void>
}

const ACK_OUTBOX_KEY = 'command_ack_outbox'

interface PendingCommandAck {
  targetId: string
  status: 'done' | 'failed'
  error?: string
  result?: CommandAckResult
}

async function readAckOutbox(): Promise<PendingCommandAck[]> {
  try {
    const raw = await window.electron.store.get(ACK_OUTBOX_KEY)
    if (!Array.isArray(raw)) return []
    return raw.filter((row): row is PendingCommandAck => {
      if (!row || typeof row !== 'object') return false
      const item = row as PendingCommandAck
      return typeof item.targetId === 'string' && (item.status === 'done' || item.status === 'failed')
    })
  } catch {
    return []
  }
}

async function writeAckOutbox(rows: PendingCommandAck[]): Promise<void> {
  await window.electron.store.set(ACK_OUTBOX_KEY, rows).catch(() => {})
}

async function enqueueAck(row: PendingCommandAck): Promise<void> {
  const rows = (await readAckOutbox()).filter(item => item.targetId !== row.targetId)
  rows.push(row)
  await writeAckOutbox(rows)
}

/** Bağlantı varken biriken done/failed bildirimlerini yollar. Komut sırasına girmez. */
async function flushAckOutbox(): Promise<Set<string>> {
  const rows = await readAckOutbox()
  if (!rows.length) return new Set()
  const left: PendingCommandAck[] = []
  const sent = new Set<string>()
  for (const row of rows) {
    try {
      await api.ackCommand(row.targetId, row.status, row.error, row.result)
      sent.add(row.targetId)
    } catch {
      left.push(row)
    }
  }
  await writeAckOutbox(left)
  return sent
}

async function sendAck(
  targetId: string,
  status: 'done' | 'failed',
  error?: string,
  result?: CommandAckResult,
): Promise<void> {
  try {
    await api.ackCommand(targetId, status, error, result)
    const rows = (await readAckOutbox()).filter(item => item.targetId !== targetId)
    await writeAckOutbox(rows)
  } catch {
    await enqueueAck({ targetId, status, error, result })
  }
}

const SYNC_KINDS = new Set([
  'sync_all',
  'sync_products',
  'sync_prices',
  'sync_plu',
  'sync_cashiers',
  'sync_customers',
  'sync_settings',
  'sync_templates',
  'sync_payment_brands',
])

/** API / panel farklı isim gönderebilir */
function normalizeCommandKind(raw: string): string {
  const kind = String(raw ?? '').toLowerCase().trim().replace(/-/g, '_')
  const aliases: Record<string, string> = {
    sync_template:          'sync_templates',
    templates_sync:         'sync_templates',
    sync_receipt_templates: 'sync_templates',
    receipt_templates_sync: 'sync_templates',
  }
  return aliases[kind] ?? kind
}

interface UseCommandPollerOptions {
  /** Komut geçmişi SQLite'a yazıldıktan sonra (feed yenileme vb.) */
  onCommandPersisted?: () => void
  /** Satış aktifken komut ertelendiğinde çağrılır */
  onCommandDeferred?: (command: string) => void
  /** Sepette ürün varken sync komutlarını işleme (ack yok, sonraki poll'da tekrar dener) */
  isCartActive?: () => boolean
}

export type PollNowResult =
  | { skipped: 'busy' | 'cooldown' }
  | { count: number }

export function useCommandPoller(
  terminalId: string | null,
  handlers: CommandHandlers,
  options?: UseCommandPollerOptions
) {
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<number>(30)
  const activeRef   = useRef(true)
  const pollingRef  = useRef(false)
  const lastManualRef = useRef(0)
  const [isPolling, setIsPolling] = useState(false)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const onPersistedRef = useRef(options?.onCommandPersisted)
  onPersistedRef.current = options?.onCommandPersisted
  const onDeferredRef = useRef(options?.onCommandDeferred)
  onDeferredRef.current = options?.onCommandDeferred
  const isCartActiveRef = useRef(options?.isCartActive)
  isCartActiveRef.current = options?.isCartActive
  const pollOnceRef = useRef<(source: 'timer' | 'manual') => Promise<PollNowResult>>(async () => ({ count: 0 }))

  const scheduleNext = useCallback(() => {
    if (!activeRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void pollOnceRef.current('timer').catch(() => {}) }, intervalRef.current * 1000)
  }, [])

  const doPoll = useCallback(async (): Promise<number> => {
    if (!terminalId || !activeRef.current) return 0

    console.log('[POLL] çalışıyor', new Date().toLocaleTimeString())

    const res = await api.pollCommands(terminalId)
    console.log('[POLL] komut sayısı:', res.commands?.length ?? 0)
    let ackedAlready = new Set<string>()
    try { ackedAlready = await flushAckOutbox() } catch { /* bildirim kuyruğu komut almayı durdurmasın */ }

    intervalRef.current = res.poll_interval ?? 30

    try {
      cmdProgress.received((res.commands ?? []).map(c => ({
        id: c.target_id ?? (c as { id?: string }).id ?? '',
        command: normalizeCommandKind(c.command ?? ''),
      })))
    } catch { /* sayaç komut akışını bozmasın */ }

    const h = handlersRef.current
    if (res.is_locked) {
      h.onLock(res.lock_reason ?? undefined)
    }

    let processed = 0
    for (const cmd of res.commands ?? []) {
      const kind = normalizeCommandKind(cmd.command ?? '')
      const mode = syncModeFromPayload(cmd.payload)
      console.log('[POLL] komut:', kind, '| raw:', cmd.command, '| target:', cmd.target_id)

      if (isBusy() || (SYNC_KINDS.has(kind) && isCartActiveRef.current?.())) {
        console.log('[POLL] Satış aktif — komut bekleniyor:', kind)
        onDeferredRef.current?.(kind)
        continue
      }

      if (ackedAlready.has(cmd.target_id)) {
        console.log('[POLL] bildirim iletildi, komut yeniden çalıştırılmadı:', kind)
        continue
      }

      processed += 1
      const progressId = cmd.target_id ?? (cmd as { id?: string }).id ?? ''
      let outcome: unknown
      try {
        try { cmdProgress.start(progressId) } catch { /* sayaç komut akışını bozmasın */ }
        switch (kind) {
          case 'sync_all':
            outcome = await h.onSyncAll(mode)
            break

          case 'sync_prices':
            outcome = await h.onSyncPrices()
            break

          case 'sync_cashiers':
            outcome = await h.onSyncCashiers(mode)
            break

          case 'sync_plu':
            outcome = await h.onSyncPlu(mode)
            break

          case 'sync_customers':
            outcome = await h.onSyncCustomers(mode)
            break

          case 'sync_products':
            outcome = await h.onSyncProducts(mode)
            break

          case 'sync_templates': {
            console.log('[POLL][sync_templates] komut alındı:', {
              targetId: cmd.target_id,
              createdAt: cmd.created_at,
              hasHandler: typeof h.onSyncTemplates === 'function',
            })
            if (typeof h.onSyncTemplates !== 'function') {
              throw new Error('onSyncTemplates handler tanımlı değil — uygulamayı yeniden başlatın')
            }
            outcome = await h.onSyncTemplates()
            console.log('[POLL][sync_templates] handler tamamlandı')
            break
          }

          case 'sync_settings':
            console.log('[POLL][sync_settings] komut alındı:', {
              targetId: cmd.target_id,
              createdAt: cmd.created_at,
            })
            outcome = await h.onSyncSettings()
            console.log('[POLL][sync_settings] handler tamamlandı')
            setTimeout(async () => {
              try {
                const s = await window.electron.db.getTerminalSettings()
                console.log('[POLL][sync_settings] 500ms sonra invoiceType:', s.invoiceType)
              } catch (e) {
                console.warn('[POLL][sync_settings] 500ms kontrol hatası:', e)
              }
            }, 500)
            setTimeout(async () => {
              try {
                const s = await window.electron.db.getTerminalSettings()
                console.log('[POLL][sync_settings] 3000ms sonra invoiceType:', s.invoiceType)
              } catch (e) {
                console.warn('[POLL][sync_settings] 3000ms kontrol hatası:', e)
              }
            }, 3000)
            break

          case 'sync_payment_brands':
            outcome = await h.onSyncPaymentBrands()
            break

          case 'pair_pavo':
            outcome = await h.onPairPavo(cmd.payload)
            break

          case 'logout':
            h.onLogout()
            break

          case 'message':
            outcome = h.onMessage(
              String(cmd.payload.text ?? ''),
              cmd.payload.duration ? Number(cmd.payload.duration) : undefined
            )
            break

          case 'restart':
            h.onRestart()
            break

          case 'lock':
            h.onLock(cmd.payload.reason ? String(cmd.payload.reason) : undefined)
            break

          case 'day_end_run':
            outcome = await h.onDayEndRun(cmd.payload ?? {})
            break

          case 'day_end_retry':
            outcome = await h.onDayEndRetry(cmd.payload ?? {})
            break

          case 'day_end_release':
            outcome = await h.onDayEndRelease(cmd.payload ?? {})
            break

          case 'update_app':
            outcome = await h.onUpdateApp(cmd.payload ?? {}, {
              createdAt: cmd.created_at ?? '',
              targetId: cmd.target_id,
              requestedName: requestedNameFrom(cmd.payload, cmd),
              batch: (res.commands ?? [])
                .filter(row => normalizeCommandKind(row.command ?? '') === 'update_app')
                .map(row => ({
                  targetId: row.target_id,
                  version: String((row.payload ?? {}).version ?? ''),
                  createdAt: row.created_at ?? '',
                })),
            })
            break

          default:
            console.warn('Bilinmeyen komut:', cmd.command)
        }

        const history = outcome && typeof outcome === 'object'
          ? outcome as { historyStatus?: string; problems?: Array<{ message?: string }> }
          : null
        const rejected = history?.historyStatus === 'rejected'
        const problemLines = rejected
          ? (history?.problems ?? []).map(problem => String(problem.message ?? '')).filter(Boolean)
          : []
        await window.electron.db.saveCommandHistory({
          id:         cmd.target_id,
          command:    kind || cmd.command,
          payload:    rejected ? { ...(cmd.payload ?? {}), problems: problemLines } : (cmd.payload ?? {}),
          status:     rejected ? 'rejected' : 'done',
          receivedAt: cmd.created_at,
          doneAt:     new Date().toISOString(),
        }).catch(() => {})

        onPersistedRef.current?.()

        const result = isCommandAckResult(outcome)
          ? { message: outcome.message, ...(outcome.count != null ? { count: outcome.count } : {}) }
          : undefined
        await sendAck(cmd.target_id, 'done', undefined, result)
        try { cmdProgress.done(progressId) } catch { /* sayaç komut akışını bozmasın */ }

      } catch (cmdErr) {
        const errMsg = adminCommandError(cmdErr)
        try { cmdProgress.fail(progressId, errMsg) } catch { /* sayaç komut akışını bozmasın */ }
        console.error('Komut işleme hatası:', cmd.command, errMsg)
        await window.electron.db.saveCommandHistory({
          id:         cmd.target_id,
          command:    kind || cmd.command,
          payload:    cmd.payload ?? {},
          status:     'failed',
          receivedAt: cmd.created_at,
          doneAt:     new Date().toISOString(),
        }).catch(() => {})

        onPersistedRef.current?.()

        await sendAck(cmd.target_id, 'failed', errMsg)
      }
    }

    return processed
  }, [terminalId])

  const pollOnce = useCallback(async (source: 'timer' | 'manual'): Promise<PollNowResult> => {
    if (pollingRef.current) return { skipped: 'busy' }
    pollingRef.current = true
    setIsPolling(true)
    try {
      const count = await doPoll()
      return { count }
    } finally {
      pollingRef.current = false
      setIsPolling(false)
      if (source === 'timer' || source === 'manual') scheduleNext()
    }
  }, [doPoll, scheduleNext])
  pollOnceRef.current = pollOnce

  const pollNow = useCallback(async (): Promise<PollNowResult> => {
    const now = Date.now()
    if (now - lastManualRef.current < 10_000) return { skipped: 'cooldown' }
    lastManualRef.current = now
    return pollOnce('manual')
  }, [pollOnce])

  useEffect(() => {
    if (!terminalId) return
    activeRef.current = true
    void pollOnce('timer').catch(() => {})

    return () => {
      activeRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [terminalId, pollOnce])

  return { pollNow, isPolling }
}

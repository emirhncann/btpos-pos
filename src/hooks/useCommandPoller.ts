import { useEffect, useRef, useCallback } from 'react'
import { api } from '../lib/api'

export type SyncMode = 'full' | 'diff'

export function syncModeFromPayload(payload: unknown): SyncMode {
  const m = (payload as Record<string, unknown> | null | undefined)?.mode
  return m === 'diff' ? 'diff' : 'full'
}

export interface CommandHandlers {
  onSyncAll:            (mode?: SyncMode) => Promise<void>
  onSyncPrices:         () => Promise<void>
  onSyncCashiers:       (mode?: SyncMode) => Promise<void>
  onSyncPlu:            (mode?: SyncMode) => Promise<void>
  onSyncCustomers:      (mode?: SyncMode) => Promise<void>
  onSyncProducts:       (mode?: SyncMode) => Promise<void>
  onSyncSettings:       () => Promise<void>
  onSyncTemplates:      () => Promise<void>
  onSyncPaymentBrands:  () => Promise<void>
  onPairPavo:           (payload?: Record<string, unknown>) => Promise<void>
  onLogout:             () => void
  onMessage:            (text: string, duration?: number) => void
  onRestart:            () => void
  onLock:               (reason?: string) => void
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

export function useCommandPoller(
  terminalId: string | null,
  handlers: CommandHandlers,
  options?: UseCommandPollerOptions
) {
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<number>(30)
  const activeRef   = useRef(true)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const onPersistedRef = useRef(options?.onCommandPersisted)
  onPersistedRef.current = options?.onCommandPersisted
  const onDeferredRef = useRef(options?.onCommandDeferred)
  onDeferredRef.current = options?.onCommandDeferred
  const isCartActiveRef = useRef(options?.isCartActive)
  isCartActiveRef.current = options?.isCartActive

  const poll = useCallback(async () => {
    if (!terminalId || !activeRef.current) return

    console.log('[POLL] çalışıyor', new Date().toLocaleTimeString())

    try {
      const res = await api.pollCommands(terminalId)
      console.log('[POLL] komut sayısı:', res.commands?.length ?? 0)

      intervalRef.current = res.poll_interval ?? 30

      const h = handlersRef.current
      if (res.is_locked) {
        h.onLock(res.lock_reason ?? undefined)
      }

      for (const cmd of res.commands ?? []) {
        const kind = normalizeCommandKind(cmd.command ?? '')
        const mode = syncModeFromPayload(cmd.payload)
        console.log('[POLL] komut:', kind, '| raw:', cmd.command, '| target:', cmd.target_id)

        if (SYNC_KINDS.has(kind) && isCartActiveRef.current?.()) {
          console.log('[POLL] Satış aktif — komut bekleniyor:', kind)
          onDeferredRef.current?.(kind)
          continue
        }

        try {
          switch (kind) {
            case 'sync_all':
              await h.onSyncAll(mode)
              break

            case 'sync_prices':
              await h.onSyncPrices()
              break

            case 'sync_cashiers':
              await h.onSyncCashiers(mode)
              break

            case 'sync_plu':
              await h.onSyncPlu(mode)
              break

            case 'sync_customers':
              await h.onSyncCustomers(mode)
              break

            case 'sync_products':
              await h.onSyncProducts(mode)
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
              await h.onSyncTemplates()
              console.log('[POLL][sync_templates] handler tamamlandı')
              break
            }

            case 'sync_settings':
              console.log('[POLL][sync_settings] komut alındı:', {
                targetId: cmd.target_id,
                createdAt: cmd.created_at,
              })
              await h.onSyncSettings()
              console.log('[POLL][sync_settings] handler tamamlandı')
              setTimeout(async () => {
                try {
                  const s = await window.electron.db.getPosSettings()
                  console.log('[POLL][sync_settings] 500ms sonra showPrice:', s.showPrice)
                } catch (e) {
                  console.warn('[POLL][sync_settings] 500ms kontrol hatası:', e)
                }
              }, 500)
              setTimeout(async () => {
                try {
                  const s = await window.electron.db.getPosSettings()
                  console.log('[POLL][sync_settings] 3000ms sonra showPrice:', s.showPrice)
                } catch (e) {
                  console.warn('[POLL][sync_settings] 3000ms kontrol hatası:', e)
                }
              }, 3000)
              break

            case 'sync_payment_brands':
              await h.onSyncPaymentBrands()
              break

            case 'pair_pavo':
              await h.onPairPavo(cmd.payload)
              break

            case 'logout':
              h.onLogout()
              break

            case 'message':
              h.onMessage(
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

            default:
              console.warn('Bilinmeyen komut:', cmd.command)
          }

          await window.electron.db.saveCommandHistory({
            id:         cmd.target_id,
            command:    kind || cmd.command,
            payload:    cmd.payload ?? {},
            status:     'done',
            receivedAt: cmd.created_at,
            doneAt:     new Date().toISOString(),
          }).catch(() => {})

          onPersistedRef.current?.()

          await api.ackCommand(cmd.target_id, 'done')

        } catch (cmdErr) {
          const errMsg = cmdErr instanceof Error ? cmdErr.message : 'Bilinmeyen hata'
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

          await api.ackCommand(cmd.target_id, 'failed', errMsg).catch(() => {})
        }
      }

    } catch {
      // API'ye ulaşılamazsa sessizce geç
    } finally {
      if (activeRef.current) {
        timerRef.current = setTimeout(poll, intervalRef.current * 1000)
      }
    }
  }, [terminalId])

  useEffect(() => {
    if (!terminalId) return
    activeRef.current = true
    poll()

    return () => {
      activeRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [terminalId, poll])
}

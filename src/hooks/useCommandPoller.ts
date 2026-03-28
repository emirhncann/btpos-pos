import { useEffect, useRef, useCallback } from 'react'
import { api } from '../lib/api'

interface CommandHandlers {
  onSyncAll:      () => Promise<void>
  onSyncPrices:   () => Promise<void>
  onSyncCashiers: () => Promise<void>
  onLogout:       () => void
  onMessage:      (text: string, duration?: number) => void
  onRestart:      () => void
  onLock:         (reason?: string) => void
}

export function useCommandPoller(
  terminalId: string | null,
  handlers: CommandHandlers
) {
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<number>(30)
  const activeRef   = useRef(true)

  const poll = useCallback(async () => {
    if (!terminalId || !activeRef.current) return

    try {
      const res = await api.pollCommands(terminalId)

      intervalRef.current = res.poll_interval ?? 30

      if (res.is_locked) {
        handlers.onLock(res.lock_reason ?? undefined)
      }

      for (const cmd of res.commands ?? []) {
        try {
          switch (cmd.command) {
            case 'sync_all':
              await handlers.onSyncAll()
              break

            case 'sync_prices':
              await handlers.onSyncPrices()
              break

            case 'sync_cashiers':
              await handlers.onSyncCashiers()
              break

            case 'logout':
              handlers.onLogout()
              break

            case 'message':
              handlers.onMessage(
                String(cmd.payload.text ?? ''),
                cmd.payload.duration ? Number(cmd.payload.duration) : undefined
              )
              break

            case 'restart':
              handlers.onRestart()
              break

            case 'lock':
              handlers.onLock(cmd.payload.reason ? String(cmd.payload.reason) : undefined)
              break

            default:
              console.warn('Bilinmeyen komut:', cmd.command)
          }

          await api.ackCommand(cmd.target_id, 'done')

        } catch (cmdErr) {
          const errMsg = cmdErr instanceof Error ? cmdErr.message : 'Bilinmeyen hata'
          console.error('Komut işleme hatası:', cmd.command, errMsg)
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

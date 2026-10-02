import { useEffect, useState } from 'react'
import AppLogo from './AppLogo'
import { buildMerkezCommandHandlers } from '../hooks/merkezCommandHandlers'

interface Props {
  companyId: string
  terminalId: string
  onDone: () => void
  onSettings: () => void
}

export default function InitialSyncScreen({ companyId, terminalId, onDone, onSettings }: Props) {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const handlers = buildMerkezCommandHandlers({
          companyId,
          terminalId,
          getCashierId: () => null,
          setCommandSyncing: () => {},
          onLogout: () => {},
          onShowMessage: () => {},
          onSettingsUpdated: onSettings,
          onLock: () => {},
          showToast: () => {},
          onPluUpdated: () => {},
        })
        await handlers.onSyncAll('full')
        if (!cancelled) onDone()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [companyId, terminalId])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      alignItems: 'center', justifyContent: 'center', background: '#0B1220', gap: 16,
    }}>
      <AppLogo height={48} />
      <div style={{ color: 'white', fontSize: 18, fontWeight: 600 }}>Veriler alınıyor…</div>
      {error && (
        <div style={{ color: '#FCA5A5', fontSize: 13, maxWidth: 420, textAlign: 'center' }}>
          {error}
          <div>
            <button
              type="button"
              onClick={onDone}
              style={{
                marginTop: 12, border: 'none', borderRadius: 8, padding: '8px 14px',
                background: '#1565C0', color: 'white', cursor: 'pointer',
              }}
            >Kasiyer girişine geç</button>
          </div>
        </div>
      )}
    </div>
  )
}

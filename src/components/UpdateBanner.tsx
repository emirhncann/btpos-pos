import { useCallback, useEffect, useState } from 'react'
import {
  compareVersions,
  readPendingAdminUpdate,
  releaseFromAdmin,
  runUpdate,
  type AdminUpdatePayload,
} from '../lib/appUpdate'

export default function UpdateBanner({
  cartActive,
}: {
  cartActive: boolean
}) {
  const [pending, setPending] = useState<AdminUpdatePayload | null>(null)
  const [installed, setInstalled] = useState('')
  const [hidden, setHidden] = useState(false)
  const [localSchema, setLocalSchema] = useState(0)
  const [status, setStatus] = useState<{ phase: string; percent?: number; message?: string } | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const row = await readPendingAdminUpdate()
    setPending(row)
    setHidden(false)
  }, [])

  useEffect(() => {
    void window.electron.update.getVersion().then(setInstalled).catch(() => {})
    void window.electron.db.userVersion().then(setLocalSchema).catch(() => {})
    void reload()
    const onAdmin = () => { void reload() }
    window.addEventListener('btpos-admin-update', onAdmin)
    const onStatus = (ev: Event) => {
      const detail = (ev as CustomEvent<{ phase: string; percent?: number; message?: string }>).detail
      setStatus(detail)
      if (detail.phase === 'error') setLastError(detail.message ?? 'Güncelleme başarısız')
      if (detail.phase === 'checking') setLastError(null)
    }
    window.addEventListener('btpos-update-status', onStatus)
    return () => {
      window.removeEventListener('btpos-admin-update', onAdmin)
      window.removeEventListener('btpos-update-status', onStatus)
    }
  }, [reload])

  async function start(requestedBy: 'pos' | 'admin' = 'admin') {
    if (!pending) return
    if (compareVersions(pending.version, installed) < 0) {
      const ok = window.confirm(
        `Yönetici bu kasanın sürümünü v${pending.version} olarak değiştirmek istiyor (v${installed} → v${pending.version}). Bu sürümden sonra eklenen özellikler kullanılamaz. Devam edilsin mi?`,
      )
      if (!ok) return
    }
    setLastError(null)
    try {
      await runUpdate(releaseFromAdmin(pending), requestedBy, { cartActive })
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e))
    }
  }

  const phaseText = status?.phase === 'downloading'
    ? `İndiriliyor %${status.percent ?? 0}`
    : status?.phase === 'backup'
      ? 'Yedek alınıyor'
      : status?.phase === 'installing'
        ? 'Kuruluyor… Program yeniden açılacak.'
        : status?.phase === 'checking'
          ? 'Kontrol ediliyor'
          : ''

  const downgrade = pending && installed ? compareVersions(pending.version, installed) < 0 : false
  const incompatible = pending?.schema_version != null && pending.schema_version < localSchema
  const showBanner = pending && !hidden && status?.phase !== 'downloading' && status?.phase !== 'backup' && status?.phase !== 'installing'

  return (
    <>
      {showBanner && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9000,
          background: downgrade ? '#FFF3E0' : '#E3F2FD',
          borderBottom: '1px solid #BBDEFB',
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 12, fontSize: 14,
        }}>
          <span>
            {downgrade
              ? `Yönetici bu kasanın sürümünü v${pending.version}’ye düşürmek istiyor`
              : `Güncelleme hazır: v${pending.version}`}
            {pending.mode === 'on_close' ? ' · gün sonunda kurulacak' : ''}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            disabled={incompatible}
            onClick={() => void start('admin')}
            style={{
              border: 'none', borderRadius: 8, padding: '6px 12px',
              background: incompatible ? '#E5E7EB' : '#1565C0', color: 'white',
              cursor: incompatible ? 'not-allowed' : 'pointer', fontWeight: 600,
            }}
          >Şimdi güncelle</button>
          {!pending.is_mandatory && (
            <button
              type="button"
              onClick={() => setHidden(true)}
              style={{ border: 'none', background: 'transparent', color: '#374151', cursor: 'pointer' }}
            >Sonra</button>
          )}
        </div>
      )}
      {lastError && status?.phase === 'error' && (
        <div style={{
          position: 'fixed', top: showBanner ? 48 : 0, left: 0, right: 0, zIndex: 9000,
          background: '#FFEBEE', color: '#C62828', padding: '8px 16px', fontSize: 13,
          display: 'flex', gap: 12,
        }}>
          <span style={{ flex: 1 }}>{lastError}</span>
          <button type="button" onClick={() => void start('admin')} style={{ border: 'none', background: 'transparent', color: '#1565C0', fontWeight: 600, cursor: 'pointer' }}>Tekrar dene</button>
        </div>
      )}
      {status && status.phase !== 'error' && phaseText && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
          fontSize: 22, fontWeight: 600,
        }}>
          {phaseText}
        </div>
      )}
    </>
  )
}

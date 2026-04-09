import { useState, useEffect } from 'react'
import AppLogo from '../components/AppLogo'
import { api } from '../lib/api'

interface Props {
  onActivated: (companyId: string) => void
}

export default function ActivationScreen({ onActivated }: Props) {
  const [email, setEmail] = useState('')
  const [licenseKey, setLicenseKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [dbPath, setDbPath] = useState('')
  const [dbPathSaved, setDbPathSaved] = useState(false)
  const [dbPathLoading, setDbPathLoading] = useState(false)

  useEffect(() => {
    window.electron.store.get('db_path').then(p => {
      if (p) setDbPath(p as string)
    })
  }, [])

  async function saveDbPath() {
    if (dbPathLoading) return
    setDbPathLoading(true)
    setError('')
    try {
      await window.electron.store.set('db_path', dbPath.trim())
      const r = await window.electron.app.reinitDb(dbPath.trim())
      if (!r.success) {
        setError(r.error ?? 'Veritabanı yeniden başlatılamadı.')
        return
      }
      setDbPathSaved(true)
      setTimeout(() => setDbPathSaved(false), 3000)
    } finally {
      setDbPathLoading(false)
    }
  }

  async function handleActivate() {
    if (!email.trim() || !email.includes('@')) {
      setError('Geçerli bir e-posta adresi girin.')
      return
    }
    if (!licenseKey.trim()) {
      setError('Lisans anahtarı boş olamaz.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const deviceInfo = await window.electron.device.info()
      const result = await api.activate(licenseKey.trim(), deviceInfo.device_uid, email.trim(), deviceInfo)

      if (!result.success) {
        setError(result.message || 'Aktivasyon başarısız.')
        return
      }

      const companyId = result.company_id

      await window.electron.store.set('activated', true)
      await window.electron.store.set('company_id', companyId)
      await window.electron.store.set('terminal_id', licenseKey.trim())
      await window.electron.store.set('workplace_id', result.workplace_id ?? null)
      await window.electron.store.set('device_uid', deviceInfo.device_uid)
      await window.electron.store.set('device_name', deviceInfo.device_name)
      await window.electron.store.set('mac_address', deviceInfo.mac_address)
      if (result.expiry_date) {
        await window.electron.store.set('expiry_date', result.expiry_date)
      }

      onActivated(companyId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Bağlantı hatası.'
      setError('Sunucuya ulaşılamadı: ' + msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-950 p-4">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: 440 }}>
        <div style={{
          background: 'white', borderRadius: 12, padding: '16px 20px',
          border: '1px solid #E5E7EB', marginBottom: 16, width: '100%',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            Veritabanı Konumu
          </div>
          <div style={{ fontSize: 11, color: '#9E9E9E', marginBottom: 10 }}>
            Boş bırakılırsa uygulama varsayılan konumu kullanır.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              value={dbPath}
              onChange={e => { setDbPath(e.target.value); setDbPathSaved(false) }}
              placeholder="Varsayılan konum"
              style={{
                flex: 1, minWidth: 120, border: '1px solid #E0E0E0', borderRadius: 7,
                padding: '8px 10px', fontSize: 12, outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => {
                void window.electron.app.selectFolder().then(p => {
                  if (p) { setDbPath(p); setDbPathSaved(false) }
                })
              }}
              style={{
                background: '#F3F4F6', border: '1px solid #E0E0E0', borderRadius: 7,
                padding: '8px 12px', cursor: 'pointer', fontSize: 11,
                color: '#374151', whiteSpace: 'nowrap',
              }}
            >Gözat</button>
            <button
              type="button"
              onClick={() => void saveDbPath()}
              disabled={dbPathLoading}
              style={{
                background: dbPathSaved ? '#E8F5E9' : '#1565C0',
                border: 'none', borderRadius: 7, padding: '8px 12px',
                cursor: 'pointer', fontSize: 11,
                color: dbPathSaved ? '#2E7D32' : 'white',
                whiteSpace: 'nowrap', opacity: dbPathLoading ? 0.6 : 1,
              }}
            >
              {dbPathLoading ? '...' : dbPathSaved ? 'Kaydedildi ✓' : 'Kaydet'}
            </button>
          </div>
        </div>

        <div className="w-full max-w-md bg-gray-900 rounded-2xl p-8 shadow-2xl border border-gray-800">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-3">
              <AppLogo height={48} className="mx-auto" />
            </div>
            <p className="text-gray-400 text-sm mt-1">Kasa Aktivasyonu</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Bayi E-posta Adresi</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                placeholder="bayi@email.com"
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Lisans Anahtarı</label>
              <input
                type="text"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={() => void handleActivate()}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
            >
              {loading ? 'Doğrulanıyor...' : 'Aktivasyonu Tamamla'}
            </button>
          </div>

          <p className="text-center text-gray-600 text-xs mt-6">
            Lisans anahtarınızı yönetici panelinizden alabilirsiniz.
          </p>
        </div>
      </div>
    </div>
  )
}

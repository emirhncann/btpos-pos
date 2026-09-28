import { useEffect, useState } from 'react'
import {
  compareVersions,
  runUpdate,
  type Release,
} from '../lib/appUpdate'
import { API_URL } from '../lib/api'

function formatDate(raw?: string): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

export default function UpdateSettingsPanel({
  companyId,
  cartActive,
}: {
  companyId: string
  cartActive: boolean
}) {
  const [installed, setInstalled] = useState('')
  const [localSchema, setLocalSchema] = useState(0)
  const [releases, setReleases] = useState<Release[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openNotes, setOpenNotes] = useState<string | null>(null)

  useEffect(() => {
    void window.electron.update.getVersion().then(setInstalled).catch(() => {})
    void window.electron.db.userVersion().then(setLocalSchema).catch(() => {})
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/releases/available/${companyId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as Release[] | { data?: Release[] }
        const list = Array.isArray(data) ? data : (data.data ?? [])
        setReleases(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sürüm listesi alınamadı')
      }
    })()
  }, [companyId])

  async function install(release: Release) {
    const down = compareVersions(release.version, installed) < 0
    if (down) {
      const ok = window.confirm(
        `Kasa sürümünü düşürüyorsunuz (v${installed} → v${release.version}). Bu sürümden sonra eklenen özellikler kullanılamaz. Devam edilsin mi?`,
      )
      if (!ok) return
    }
    setError(null)
    setBusy(release.id)
    try {
      await runUpdate(release, 'pos', { cartActive })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: '#374151' }}>
        Kurulu sürüm: <b>v{installed || '…'}</b>
      </div>
      {error && (
        <div style={{ background: '#FFEBEE', color: '#C62828', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ marginLeft: 8, border: 'none', background: 'transparent', color: '#1565C0', cursor: 'pointer', fontWeight: 600 }}
          >Tekrar dene</button>
        </div>
      )}
      <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>Mevcut sürümler</div>
      {releases.map(rel => {
        const cmp = installed ? compareVersions(rel.version, installed) : 0
        const current = Boolean(installed) && cmp === 0
        const incompatible = rel.schema_version != null && rel.schema_version < localSchema
        const label = current ? 'kurulu' : cmp > 0 ? 'Kur' : 'Geri dön'
        return (
          <div key={rel.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ color: current ? '#1565C0' : '#9CA3AF' }}>●</span>
              <b>v{rel.version}</b>
              <span style={{ color: '#6B7280' }}>{formatDate(rel.published_at)}</span>
              <span style={{ color: '#374151' }}>{rel.channel === 'beta' ? 'Deneme' : 'Kararlı'}</span>
              <span style={{ flex: 1 }} />
              {rel.notes && (
                <button
                  type="button"
                  onClick={() => setOpenNotes(openNotes === rel.id ? null : rel.id)}
                  style={{ border: 'none', background: 'transparent', color: '#1565C0', cursor: 'pointer' }}
                >Notlar</button>
              )}
              {current ? (
                <span style={{ color: '#6B7280' }}>kurulu</span>
              ) : (
                <button
                  type="button"
                  disabled={!installed || incompatible || busy != null}
                  title={incompatible ? 'Veritabanı uyumsuz, bu sürüme dönülemez.' : undefined}
                  onClick={() => void install(rel)}
                  style={{
                    border: 'none', borderRadius: 8, padding: '6px 12px',
                    background: incompatible ? '#E5E7EB' : '#1565C0',
                    color: incompatible ? '#6B7280' : 'white',
                    cursor: incompatible ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                  }}
                >{busy === rel.id ? '…' : label}</button>
              )}
            </div>
            {incompatible && (
              <div style={{ fontSize: 12, color: '#C62828', marginTop: 6 }}>
                Veritabanı uyumsuz, bu sürüme dönülemez.
              </div>
            )}
            {openNotes === rel.id && rel.notes && (
              <div style={{ fontSize: 12, color: '#374151', marginTop: 8, whiteSpace: 'pre-wrap' }}>{rel.notes}</div>
            )}
          </div>
        )
      })}
      {releases.length === 0 && !error && (
        <div style={{ fontSize: 13, color: '#6B7280' }}>Yüklenebilir sürüm yok.</div>
      )}
    </div>
  )
}

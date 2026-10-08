import { useEffect, useState } from 'react'

interface Props {
  disabled?: boolean
  disabledReason?: string
  /** true: yalnızca yol + kopyala (klasör değiştirme yok) */
  pathOnly?: boolean
}

export default function DbLocationPanel({ disabled, disabledReason, pathOnly }: Props) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.electron.db.getLocation().then(setPath).catch(() => {})
  }, [])

  async function changeFolder() {
    if (disabled || busy) return
    setInfo(null)
    const dir = await window.electron.db.selectFolder()
    if (!dir) return
    setBusy(true)
    try {
      const res = await window.electron.db.setLocation(dir, { moveExisting: true })
      if (!res.success) {
        setInfo({ ok: false, text: res.message ?? 'Konum değiştirilemedi. Eski konum geçerli.' })
        const current = await window.electron.db.getLocation().catch(() => path)
        setPath(current)
        return
      }
      setPath(res.path ?? '')
      setInfo({
        ok: true,
        text: res.existed
          ? 'Bu klasörde mevcut bir veritabanı bulundu, o kullanılacak.'
          : `Veritabanı burada oluşturuldu: ${res.path}`,
      })
    } catch (e) {
      setInfo({ ok: false, text: String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function copyPath() {
    if (!path) return
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setInfo({ ok: false, text: 'Kopyalanamadı' })
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        Veritabanı konumu
      </div>
      {!pathOnly && disabled && disabledReason && (
        <div style={{ fontSize: 12, color: '#B45309', marginBottom: 8 }}>{disabledReason}</div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{
          flex: 1, minWidth: 0, border: '1px solid #E0E0E0', borderRadius: 8,
          padding: '8px 10px', fontSize: 12, color: '#111', background: '#F9FAFB',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          userSelect: 'text',
        }} title={path || undefined}>
          {path || '…'}
        </div>
        <button
          type="button"
          disabled={!path}
          onClick={() => void copyPath()}
          style={{
            background: copied ? '#166534' : '#374151', color: 'white', border: 'none', borderRadius: 8,
            padding: '8px 12px', cursor: path ? 'pointer' : 'not-allowed',
            fontSize: 12, fontWeight: 600, opacity: path ? 1 : 0.6, whiteSpace: 'nowrap',
          }}
        >
          {copied ? 'Kopyalandı' : 'Kopyala'}
        </button>
        {!pathOnly && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void changeFolder()}
            style={{
              background: '#1565C0', color: 'white', border: 'none', borderRadius: 8,
              padding: '8px 12px', cursor: disabled || busy ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 600, opacity: disabled || busy ? 0.6 : 1, whiteSpace: 'nowrap',
            }}
          >
            {busy ? '…' : 'Değiştir…'}
          </button>
        )}
      </div>
      {info && (
        <div style={{ marginTop: 8, fontSize: 12, color: info.ok ? '#166534' : '#B91C1C' }}>
          {info.text}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'

export default function LicenseSettingsPanel() {
  const [licenseKey, setLicenseKey] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void (async () => {
      let dbKey = ''
      let dbExpiry = ''
      try {
        const row = await window.electron.db.getActivation()
        if (row?.licenseKey) dbKey = row.licenseKey
        if (row?.expiryDate) dbExpiry = row.expiryDate
      } catch {
        /* DB okunamadı */
      }

      const [storeKey, storeExpiry, companyId, terminalId, deviceUid] = await Promise.all([
        window.electron.store.get('license_key'),
        window.electron.store.get('expiry_date'),
        window.electron.store.get('company_id'),
        window.electron.store.get('terminal_id'),
        window.electron.store.get('device_uid'),
      ]).catch(() => [null, null, null, null, null] as const)

      const key = dbKey || (storeKey != null ? String(storeKey).trim() : '')
      const expiry = dbExpiry || (storeExpiry != null ? String(storeExpiry) : '')
      setLicenseKey(key)
      setExpiryDate(expiry)

      if (key && !dbKey && companyId && terminalId && deviceUid) {
        await window.electron.db.saveActivation({
          terminalId: String(terminalId),
          companyId: String(companyId),
          deviceUid: String(deviceUid),
          expiryDate: expiry || null,
          licenseKey: key,
        }).catch(() => {})
      }
      if (key && !storeKey) {
        await window.electron.store.set('license_key', key).catch(() => {})
      }
    })()
  }, [])

  async function copyKey() {
    if (!licenseKey) return
    try {
      await navigator.clipboard.writeText(licenseKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* panoya yazılamadı */
    }
  }

  const expiryLabel = (() => {
    if (!expiryDate) return null
    const d = new Date(expiryDate)
    if (Number.isNaN(d.getTime())) return expiryDate
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  })()

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        Lisans anahtarı
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{
          flex: 1, minWidth: 0, border: '1px solid #E0E0E0', borderRadius: 8,
          padding: '8px 10px', fontSize: 12, color: '#111', background: '#F9FAFB',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          userSelect: 'text',
        }} title={licenseKey || undefined}>
          {licenseKey || 'Kayıtlı lisans anahtarı yok'}
        </div>
        <button
          type="button"
          disabled={!licenseKey}
          onClick={() => void copyKey()}
          style={{
            background: copied ? '#166534' : '#374151', color: 'white', border: 'none', borderRadius: 8,
            padding: '8px 12px', cursor: licenseKey ? 'pointer' : 'not-allowed',
            fontSize: 12, fontWeight: 600, opacity: licenseKey ? 1 : 0.6, whiteSpace: 'nowrap',
          }}
        >
          {copied ? 'Kopyalandı' : 'Kopyala'}
        </button>
      </div>
      {expiryLabel && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#6B7280' }}>
          Bitiş tarihi: <span style={{ color: '#111', fontWeight: 600 }}>{expiryLabel}</span>
        </div>
      )}
      {!licenseKey && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#B45309' }}>
          Bu kasa aktivasyonundan önce kayıt yoksa anahtar burada görünmez. Yeniden aktivasyonda kaydedilir.
        </div>
      )}
    </div>
  )
}

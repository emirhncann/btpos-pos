import { useEffect, useState } from 'react'

// Lisans kontrolü artık API'ye gitmiyor.
// Aktivasyon bilgisi electron-store'da saklanıyor.
// Uyarı göstermek için expiry_date'e bakılır.

interface LicenseStatus {
  valid:      boolean
  daysLeft:   number
  planName:   string
  expiryDate: string
  warning:    boolean
}

export function useLicenseCheck(_companyId: string | null): LicenseStatus | null {
  // electron-store'dan lisans bilgisini oku
  // Aktivasyonda kaydedilen expiry_date'i kullan
  const [license, setLicense] = useState<LicenseStatus | null>(null)

  useEffect(() => {
    window.electron.store.get('expiry_date')
      .then(val => {
        if (!val) return
        const expiry   = new Date(String(val))
        const now      = new Date()
        const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        setLicense({
          valid:      daysLeft > 0,
          daysLeft,
          planName:   '',
          expiryDate: String(val),
          warning:    daysLeft <= 30,
        })
      })
      .catch(() => {})
  }, [_companyId])

  return license
}

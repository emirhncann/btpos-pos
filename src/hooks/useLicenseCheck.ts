import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface LicenseStatus {
  valid: boolean
  daysLeft: number
  planName: string
  expiryDate: string
  warning: boolean
}

export function useLicenseCheck(companyId: string | null) {
  const [license, setLicense] = useState<LicenseStatus | null>(null)

  useEffect(() => {
    if (!companyId) return
    check()
    const interval = setInterval(check, 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [companyId])

  async function check() {
    try {
      const data = await api.checkLicense(companyId!)
      const expiry = new Date(data.expiry_date)
      const now = new Date()
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

      setLicense({
        valid: daysLeft > 0 && data.license_id,
        daysLeft,
        planName: data.plan_name ?? '',
        expiryDate: data.expiry_date,
        warning: daysLeft <= 30,
      })
    } catch {
      setLicense(prev => prev ?? { valid: true, daysLeft: 999, planName: '', expiryDate: '', warning: false })
    }
  }

  return license
}

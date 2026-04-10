import { useEffect, useState } from 'react'

type Status = 'online' | 'offline' | 'checking'

export function useConnectionStatus(_intervalSec: number = 30): Status {
  const [status, setStatus] = useState<Status>(() =>
    typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
  )

  useEffect(() => {
    const sync = () => setStatus(navigator.onLine ? 'online' : 'offline')
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    sync()
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  return status
}

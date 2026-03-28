import { useState, useEffect, useRef } from 'react'

type Status = 'online' | 'offline' | 'checking'

export function useConnectionStatus(intervalSec: number = 30) {
  const [status, setStatus] = useState<Status>('checking')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function check() {
    setStatus('checking')
    try {
      const res = await fetch('https://api.btpos.com.tr/ping', {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      })
      const data = await res.json()
      setStatus(data.status === 'ok' ? 'online' : 'offline')
    } catch {
      setStatus('offline')
    } finally {
      timerRef.current = setTimeout(check, intervalSec * 1000)
    }
  }

  useEffect(() => {
    check()
    const goOnline  = () => check()
    const goOffline = () => setStatus('offline')
    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [intervalSec])

  return status
}

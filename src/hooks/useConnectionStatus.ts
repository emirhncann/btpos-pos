// Bağlantı durumu artık poller'dan gelecek
// Bu hook şimdilik sabit 'online' döndürüyor
// Sprint 28'de poller'dan türetilecek

type Status = 'online' | 'offline' | 'checking'

export function useConnectionStatus(_intervalSec: number = 30): Status {
  return 'online'
}

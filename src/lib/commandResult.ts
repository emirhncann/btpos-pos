/** Merkeze giden komut özeti. İşleyici döndürmezse ack gövdesine konmaz. */
export interface CommandAckResult {
  count?: number
  message: string
  historyStatus?: string
  problems?: Array<{ code?: string; message?: string }>
}

export function trCount(n: number): string {
  const value = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(value)
}

export function isCommandAckResult(value: unknown): value is CommandAckResult {
  if (!value || typeof value !== 'object') return false
  const message = (value as { message?: unknown }).message
  return typeof message === 'string' && message.trim() !== ''
}

export function adminCommandError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).trim()
  const low = raw.toLowerCase()
  if (
    low.includes('boş liste')
    || low.includes('bos liste')
    || low.includes('boş müşteri')
    || low.includes('boş kasiyer')
    || low.includes('boş plu')
    || low.includes('temp boş')
    || low.includes('temp tablo boş')
  ) {
    return 'Merkezden boş liste geldi'
  }
  if (
    low.includes('failed to fetch')
    || low.includes('networkerror')
    || low.includes('network error')
    || low.includes('econnrefused')
    || low.includes('enotfound')
    || low.includes('etimedout')
    || low.includes('timeout')
    || low.includes('zaman aşımı')
    || low.includes('bağlantı')
    || low.includes('erp bağlant')
    || /^get\w* http /.test(low)
    || low.includes('http 5')
    || low.includes('http 401')
    || low.includes('http 403')
    || low.includes('http 404')
  ) {
    return 'ERP bağlantısı yok'
  }
  if (
    low.includes('sqlite')
    || low.includes('database')
    || low.includes('constraint')
    || low.includes('yazılamadı')
    || low.includes('rollback')
    || low.includes('unique')
  ) {
    return raw.startsWith('Veritabanı yazılamadı') ? raw : `Veritabanı yazılamadı: ${raw}`
  }
  return raw || 'Komut uygulanamadı'
}

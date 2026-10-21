import { formatIstanbulRange } from './commandView'

/** Merkez komut türlerinin Türkçe adı. İşleme akışına bağlı değildir. */
export const COMMAND_LABELS: Record<string, { label: string; icon: string }> = {
  sync_all:            { label: 'Tüm verileri güncelle',        icon: 'package' },
  sync_products:       { label: 'Ürünleri güncelle',            icon: 'package' },
  sync_prices:         { label: 'Fiyatları güncelle',           icon: 'tag' },
  sync_plu:            { label: 'PLU gruplarını güncelle',      icon: 'grid' },
  sync_cashiers:       { label: 'Kasiyer listesini güncelle',   icon: 'users' },
  sync_customers:      { label: 'Müşterileri güncelle',         icon: 'contact' },
  sync_settings:       { label: 'POS ayarlarını güncelle',      icon: 'settings' },
  sync_templates:      { label: 'Fiş şablonlarını güncelle',    icon: 'file' },
  sync_payment_brands: { label: 'Ödeme tiplerini güncelle',     icon: 'bank' },
  pair_pavo:           { label: 'Ödeme cihazını eşle',          icon: 'link' },
  logout:              { label: 'Kasiyer çıkışı',               icon: 'logout' },
  message:             { label: 'Yönetici mesajı',              icon: 'message' },
  restart:             { label: 'Uygulamayı yeniden başlat',    icon: 'restart' },
  lock:                { label: 'Kasayı kilitle',               icon: 'lock' },
  update_app:          { label: 'Program güncellemesi',         icon: 'download' },
  day_end_run:         { label: 'Gün sonu (ERP) gönder',        icon: 'file' },
  day_end_release:     { label: 'Gün sonu iptali — satışlar serbest', icon: 'restart' },
}

export function commandTitle(command: string, payload?: Record<string, unknown> | null): string {
  if (command === 'day_end_run') {
    const range = formatIstanbulRange(
      payload?.range_start != null ? String(payload.range_start) : '',
      payload?.range_end != null ? String(payload.range_end) : '',
    )
    if (range) return `Gün sonu (ERP) gönder · ${range}`
    const label = String(payload?.range_label ?? '').trim()
    return label ? `Gün sonu (ERP) gönder · ${label}` : 'Gün sonu (ERP) gönder'
  }
  if (command === 'day_end_release') return 'Gün sonu iptali — satışlar serbest'
  return commandMeta(command).label
}

export function commandMeta(type: string): { label: string; icon: string } {
  const key = String(type ?? '').trim()
  return COMMAND_LABELS[key] ?? { label: key || 'Komut', icon: 'terminal' }
}

export const COMMAND_ICON_GLYPH: Record<string, string> = {
  settings: '⚙',
  users: '👥',
  grid: '▦',
  package: '📦',
  contact: '👤',
  bank: '🏦',
  download: '⬇',
  terminal: '▣',
  tag: '🏷',
  file: '🧾',
  link: '🔗',
  logout: '⎋',
  message: '💬',
  restart: '↻',
  lock: '🔒',
}

export function commandGlyph(type: string): string {
  const icon = commandMeta(type).icon
  return COMMAND_ICON_GLYPH[icon] ?? COMMAND_ICON_GLYPH.terminal
}

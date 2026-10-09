type Item = {
  id: string
  command: string
  label: string
  status: 'waiting' | 'running' | 'done' | 'failed'
  error?: string
}

export type CmdProgressState = { items: Item[]; finishedAt?: number }

const listeners = new Set<(s: CmdProgressState) => void>()
let state: CmdProgressState = { items: [] }

const emit = () => listeners.forEach(l => {
  try { l({ ...state, items: [...state.items] }) } catch { /* dinleyici sayacı bozmasın */ }
})

export const COMMAND_LABELS: Record<string, string> = {
  sync_products: 'Ürünler', sync_prices: 'Fiyatlar', sync_plu: 'PLU',
  sync_cashiers: 'Kasiyerler', sync_customers: 'Cariler', sync_settings: 'Ayarlar',
  sync_templates: 'Fiş şablonları', sync_payment_brands: 'Ödeme tipleri',
  sync_all: 'Tüm veriler', update_app: 'Program güncellemesi', message: 'Mesaj',
}

const label = (c: string) => COMMAND_LABELS[c] ?? c

function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}

export const cmdProgress = {
  /** Poll cevabı geldiğinde, komutlar çalışmaya başlamadan önce */
  received(cmds: { id: string; command: string }[]) {
    try {
      if (state.finishedAt) state = { items: [] }
      for (const c of cmds) {
        if (!state.items.some(i => i.id === c.id)) {
          state.items.push({ id: c.id, command: c.command, label: label(c.command), status: 'waiting' })
        }
      }
      emit()
    } catch { /* sayaç komut akışını bozmasın */ }
  },
  start(id: string) {
    try {
      const i = state.items.find(x => x.id === id)
      if (i) i.status = 'running'
      emit()
    } catch { /* sayaç komut akışını bozmasın */ }
  },
  done(id: string) {
    try {
      const i = state.items.find(x => x.id === id)
      if (i) i.status = 'done'
      check()
    } catch { /* sayaç komut akışını bozmasın */ }
  },
  fail(id: string, err: unknown) {
    try {
      const i = state.items.find(x => x.id === id)
      if (i) {
        i.status = 'failed'
        i.error = errText(err)
      }
      check()
    } catch { /* sayaç komut akışını bozmasın */ }
  },
  subscribe(fn: (s: CmdProgressState) => void) {
    listeners.add(fn)
    fn({ ...state, items: [...state.items] })
    return () => { listeners.delete(fn) }
  },
  clear() {
    state = { items: [] }
    emit()
  },
}

function check() {
  if (state.items.every(i => i.status === 'done' || i.status === 'failed')) state.finishedAt = Date.now()
  emit()
}

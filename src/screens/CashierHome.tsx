import { useEffect, useRef, useState, type CSSProperties } from 'react'
import AppLogo from '../components/AppLogo'
import { CmdProgressChip } from '../components/CmdProgressChip'
import { cmdProgress, type CmdProgressState } from '../lib/cmdProgress'
import { commandMeta } from '../lib/commandLabels'
import { inCommandRange, istanbulClock } from '../lib/commandView'
import { isBarcodeBurst, isEditableField } from '../lib/keyboardInput'
import type { PosBoot } from '../lib/posBoot'

export type HomeStats = {
  pending: number
  failed: number
  lastSent: string | null
  lastReceipt: string | null
  held: number
  saleCount: number
  cash: number
  card: number
  total: number
  printer: boolean
  scale: boolean
  lastReconAt: string | null
  lastReconDiff: number | null
}

const EMPTY: HomeStats = {
  pending: 0,
  failed: 0,
  lastSent: null,
  lastReceipt: null,
  held: 0,
  saleCount: 0,
  cash: 0,
  card: 0,
  total: 0,
  printer: false,
  scale: false,
  lastReconAt: null,
  lastReconDiff: null,
}

type Gate = 'settings' | 'amounts'

const TILES = ['queue', 'report', 'settings', 'recon', 'menu', 'dayend'] as const

function istanbulParts(d: Date): { clock: string; date: string } {
  const clock = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
  const date = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  }).format(d)
  return { clock, date }
}

function hhmm(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

function reconWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
  }).format(d)
  return `${day} ${hhmm(iso)}`
}

const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toLocaleUpperCase('tr-TR')
}

function kbd(label: string) {
  return (
    <span style={{
      fontSize: 12,
      fontVariantNumeric: 'tabular-nums',
      background: 'var(--pos-surface-alt)',
      border: '1px solid var(--pos-border)',
      color: 'var(--pos-text-muted)',
      borderRadius: 6,
      padding: '2px 6px',
      lineHeight: 1.4,
    }}>{label}</span>
  )
}

export function CashierHome({
  cashier,
  workplaceName,
  terminalNumber,
  appVersion,
  isOnline,
  posDefined,
  stats,
  amountsVisible,
  reconOpen,
  onSale,
  onLogout,
  onQueue,
  onReport,
  onAskSettings,
  onRecon,
  onReconHistory,
  onDayEnd,
  onReveal,
  onHideAmounts,
  onCommands,
  commandTick,
  keysEnabled,
}: {
  cashier: CashierRow
  workplaceName: string
  terminalNumber: string
  appVersion: string
  isOnline: boolean
  posDefined: boolean
  stats: HomeStats
  amountsVisible: boolean
  reconOpen: boolean
  onSale: (boot?: PosBoot) => void
  onLogout: () => void
  onQueue: () => void
  onReport: () => void
  onAskSettings: () => void
  onRecon: () => void
  onDayEnd: () => void
  onReconHistory: () => void
  onReveal: () => void
  onHideAmounts: () => void
  onCommands: () => void
  commandTick: number
  keysEnabled: boolean
}) {
  const [now, setNow] = useState(() => new Date())
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900)
  const [focus, setFocus] = useState<number | null>(null)
  const [cmdRows, setCmdRows] = useState<CommandHistoryRow[]>([])
  const [cmdLive, setCmdLive] = useState<CmdProgressState>({ items: [] })
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([])
  const mainRef = useRef<HTMLElement>(null)
  const [bandH, setBandH] = useState(160)
  const [tight, setTight] = useState(false)
  const buf = useRef('')
  const gaps = useRef<number[]>([])
  const lastAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => cmdProgress.subscribe(setCmdLive), [])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const measure = () => {
      const mainH = el.clientHeight
      const rows = window.innerWidth < 900 ? 3 : 2
      const g = window.innerWidth < 900 ? 12 : 16
      const extra = posDefined ? 0 : 22
      let band = Math.round(mainH * 0.26)
      band = Math.max(150, Math.min(220, band))
      if (band + extra + g * rows + 130 * rows > mainH) band = 150
      setBandH(band)
      setTight(150 + extra + g * rows + 130 * rows > mainH)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [posDefined, narrow])

  useEffect(() => {
    let stop = false
    const load = () => {
      window.electron.db.getCommandHistory(200)
        .then(list => { if (!stop) setCmdRows(list) })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 15_000)
    return () => { stop = true; clearInterval(t) }
  }, [commandTick, cmdLive.finishedAt, cmdLive.items.length])

  const runningIdx = cmdLive.items.findIndex(item => item.status === 'running')
  const runningCmd = runningIdx >= 0 ? cmdLive.items[runningIdx] : undefined
  const waitingCmd = cmdLive.items.filter(item => item.status === 'waiting').length
  const failedCmd = cmdRows.filter(row => row.status === 'failed' && inCommandRange(row.receivedAt, '7')).length
  const lastCmd = cmdRows.find(row => row.status === 'done')
  let cmdLeft = 'Henüz komut gelmedi'
  let cmdRight = ''
  let cmdTone: string | undefined
  if (runningCmd) {
    cmdLeft = `⟳ ${runningCmd.label} güncelleniyor ${runningIdx + 1}/${cmdLive.items.length}`
    cmdRight = 'Aç →'
    cmdTone = 'var(--pos-primary)'
  } else if (failedCmd > 0) {
    cmdLeft = `⚠ ${failedCmd} hatalı`
    cmdRight = 'Aç →'
    cmdTone = 'var(--pos-danger)'
  } else if (waitingCmd > 0) {
    cmdLeft = `Bekleyen: ${waitingCmd}`
    cmdRight = 'Aç →'
    cmdTone = 'var(--pos-warning)'
  } else if (lastCmd) {
    cmdLeft = `Son: ${commandMeta(lastCmd.command).label} ✓`
    cmdRight = istanbulClock(lastCmd.doneAt ?? lastCmd.receivedAt)
  }

  const clock = istanbulParts(now)
  const gap = narrow ? 12 : 16
  const showMoney = amountsVisible && !reconOpen
  const queueDot = stats.failed > 0 ? 'var(--pos-danger)' : stats.pending === 0 ? 'var(--pos-success)' : 'transparent'

  function runTile(i: number) {
    if (i === 0) onQueue()
    else if (i === 1) onReport()
    else if (i === 2) onAskSettings()
    else if (i === 3) onRecon()
    else if (i === 4) onCommands()
    else onDayEnd()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keysEnabled) return
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
        e.preventDefault()
        return
      }
      const overlay = document.querySelector('[data-home-overlay]')
      if (overlay) return

      const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
      if (printable && !isEditableField(e.target)) {
        const t = performance.now()
        const gapMs = buf.current.length === 0 ? 0 : t - lastAt.current
        if (buf.current.length > 0 && gapMs > 35) {
          buf.current = ''
          gaps.current = []
        }
        if (buf.current.length > 0) gaps.current.push(gapMs)
        buf.current += e.key
        lastAt.current = t
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { buf.current = ''; gaps.current = [] }, 180)
        return
      }

      if (e.key === 'Enter') {
        const code = buf.current
        const scan = isBarcodeBurst(gaps.current, code.length)
        buf.current = ''
        gaps.current = []
        if (timer.current) clearTimeout(timer.current)
        if (scan) {
          e.preventDefault()
          onSale({ barcode: code })
          return
        }
        if (isEditableField(e.target)) return
        if (e.target instanceof HTMLButtonElement) return
        e.preventDefault()
        onSale()
        return
      }

      if (isEditableField(e.target)) return

      const fn: Record<string, () => void> = {
        F2: () => onSale(),
        F3: () => onSale({ held: true }),
        F4: () => onQueue(),
        F6: () => onReport(),
        F8: () => onAskSettings(),
        F9: () => onRecon(),
        F10: () => onCommands(),
        F11: () => onDayEnd(),
      }
      if (fn[e.key]) {
        e.preventDefault()
        fn[e.key]()
        return
      }

      const cols = narrow ? 2 : 3
      if (e.key === 'ArrowRight') setFocus(i => Math.min(TILES.length - 1, (i ?? -1) + 1))
      else if (e.key === 'ArrowLeft') setFocus(i => Math.max(0, (i ?? 0) - 1))
      else if (e.key === 'ArrowDown') setFocus(i => Math.min(TILES.length - 1, (i ?? -cols) + cols))
      else if (e.key === 'ArrowUp') setFocus(i => Math.max(0, (i ?? 0) - cols))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keysEnabled, narrow, onAskSettings, onCommands, onDayEnd, onQueue, onRecon, onReport, onSale])

  useEffect(() => {
    if (focus == null) return
    tileRefs.current[focus]?.focus()
  }, [focus])

  const tileBtn = (i: number, tone: string, title: string, sub: string, shortcut: string, left: string, right: string, onClick: () => void, leftDanger = false, onRight?: () => void, leftTone?: string) => (
    <button
      key={title}
      type="button"
      ref={el => { tileRefs.current[i] = el }}
      onClick={onClick}
      title={title}
      style={{
        textAlign: 'left',
        background: 'var(--pos-surface)',
        color: 'var(--pos-text)',
        border: '1px solid var(--pos-border)',
        borderRadius: 12,
        boxShadow: '0 2px 0 0 var(--pos-border), 0 1px 3px rgb(0 0 0 / .08)',
        padding: tight ? 8 : 12,
        minHeight: tight ? 0 : 130,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: 'pointer',
        outline: focus === i ? '3px solid var(--pos-primary)' : 'none',
        outlineOffset: 2,
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'translateY(1.5px)'; e.currentTarget.style.boxShadow = 'none' }}
      onMouseUp={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 0 0 var(--pos-border), 0 1px 3px rgb(0 0 0 / .08)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 0 0 var(--pos-border), 0 1px 3px rgb(0 0 0 / .08)' }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          width: 48, height: 48, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${tone} 14%, var(--pos-surface))`,
          color: tone, fontSize: 22,
        }}>{['⇄', '🧾', '⚙', '∑', '▣', '▦'][i]}</span>
        {kbd(shortcut)}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{title}</span>
        {i === 0 && queueDot !== 'transparent' && (
          <span style={{ width: 8, height: 8, borderRadius: 99, background: queueDot }} />
        )}
      </span>
      <span style={{ fontSize: 13, color: 'var(--pos-text-muted)' }}>{sub}</span>
      <span style={{ borderTop: '1px solid var(--pos-border)', marginTop: 'auto' }} />
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: leftTone ?? (leftDanger ? 'var(--pos-danger)' : 'var(--pos-text)'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{left}</span>
        <span
          style={{ color: 'var(--pos-text-muted)', flexShrink: 0, textDecoration: onRight ? 'underline' : undefined }}
          onClick={onRight ? (ev) => { ev.stopPropagation(); onRight() } : undefined}
        >{right}</span>
      </span>
    </button>
  )

  const place = `${workplaceName || 'İşyeri'} · Kasa ${terminalNumber || '—'}`

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--pos-screen-bg)',
      color: 'var(--pos-text)',
      fontVariantNumeric: 'tabular-nums',
    }}>
      <header style={{
        flexShrink: 0,
        background: 'var(--pos-header-bg)',
        color: 'var(--pos-header-text)',
        borderBottom: '1px solid var(--pos-border)',
        padding: '8px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
          <AppLogo height={28} />
          <span style={{ fontWeight: 800, letterSpacing: 0.4 }}>BT POS</span>
          <span style={{ fontSize: 12, opacity: 0.8 }}>{appVersion ? `v${appVersion}` : ''}</span>
          <span title={place} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
            🏢 {place}
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, flexShrink: 0 }}>{clock.clock}</span>
          <span style={{ fontSize: 13, flexShrink: 0 }}>{clock.date}</span>
          <span style={{ color: isOnline ? 'var(--pos-success)' : 'var(--pos-warning)', fontWeight: 700, flexShrink: 0 }}>
            ● {isOnline ? 'Çevrimiçi' : `Çevrimdışı · ${stats.pending} belge bekliyor`}
          </span>
          <span title={cashier.fullName} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: 220 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 8, background: 'var(--pos-primary)', color: 'var(--pos-primary-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0,
            }}>{initials(cashier.fullName)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cashier.fullName}{cashier.cashierCode ? ` #${cashier.cashierCode}` : ''}
            </span>
          </span>
          <button type="button" onClick={onLogout} style={{
            minHeight: 48, padding: '0 12px', borderRadius: 8, border: '1px solid var(--pos-border)',
            background: 'transparent', color: 'inherit', cursor: 'pointer', fontWeight: 700, flexShrink: 0,
          }}>⎋ Kasiyer Çıkışı</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <CmdProgressChip />
          {!posDefined && (
            <span style={{ color: 'var(--pos-danger)', fontWeight: 700 }}>⚠ POS tanımlı değil — satış kapalı</span>
          )}
        </div>
      </header>

      <main ref={mainRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap, padding: gap, overflow: 'hidden' }}>
        <button type="button" onClick={() => onSale()} style={{
          height: bandH,
          flexShrink: 0,
          border: 'none',
          borderRadius: 12,
          background: 'var(--pos-primary)',
          color: 'var(--pos-primary-text)',
          boxShadow: '0 3px 0 0 color-mix(in srgb, var(--pos-primary) 70%, black)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 20px',
          cursor: 'pointer',
          textAlign: 'left',
        }}>
          <span style={{
            width: 88, height: 88, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--pos-primary-text) 16%, transparent)',
            fontSize: 40,
          }}>🛒</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: window.innerWidth >= 1366 ? 44 : 40, fontWeight: 800, lineHeight: 1.1 }}>{'satış başlat'.toLocaleUpperCase('tr-TR')}</span>
            <span style={{ display: 'block', fontSize: 16, opacity: 0.9 }}>Yeni sepet aç, barkod okut veya hızlı ürünlerden seç</span>
          </span>
          {kbd('F2')}
          <span style={{
            width: 72, height: 72, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--pos-primary-text) 16%, transparent)',
            fontSize: 32,
          }}>→</span>
        </button>
        {!posDefined && (
          <div style={{ color: 'var(--pos-danger)', fontSize: 13, marginTop: -8 }}>Ödeme alınamaz — POS tanımlı değil</div>
        )}

        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: narrow ? '1fr 1fr' : '1fr 1fr 1fr',
          gridTemplateRows: narrow
            ? `repeat(3, ${tight ? 'minmax(0, 1fr)' : 'minmax(130px, 1fr)'})`
            : `repeat(2, ${tight ? 'minmax(0, 1fr)' : 'minmax(130px, 1fr)'})`,
          gap,
          alignContent: 'start',
        }}>
          {tileBtn(0, 'var(--pos-primary)', 'Belge Aktarım', 'ERP\'ye gönderim', 'F4',
            stats.failed > 0 ? `⚠ ${stats.failed} hatalı` : `Bekleyen: ${stats.pending}`,
            `Son aktarım: ${hhmm(stats.lastSent)}`, onQueue, stats.failed > 0)}
          {tileBtn(1, 'var(--pos-warning)', 'Belge Raporu', 'Geçmiş fiş, iade, iptal', 'F6',
            `Son fiş: ${stats.lastReceipt ?? '—'}`, 'Ara / Yazdır →', onReport)}
          {tileBtn(2, 'var(--pos-text-muted)', 'Kasa Ayarları', 'Yazıcı, terazi, cihaz', 'F8',
            stats.printer ? '● Yazıcı tanımlı' : '○ Yazıcı yok',
            stats.scale ? 'Terazi: tanımlı' : 'Terazi: yok', onAskSettings)}
          {tileBtn(3, 'var(--pos-success)', 'Hesap Alma', 'Kör sayım, Z mutabakatı', 'F9',
            stats.lastReconAt ? `Son: ${reconWhen(stats.lastReconAt)} · Fark ${money.format(stats.lastReconDiff ?? 0)}` : 'Henüz yapılmadı',
            'Geçmiş', onRecon, false, onReconHistory)}
          {tileBtn(4, 'var(--pos-primary)', 'Komutlar', 'Merkezden gelen talimatlar', 'F10',
            cmdLeft, cmdRight, onCommands, false, undefined, cmdTone)}
          {tileBtn(5, 'var(--pos-text-muted)', 'Pavo Z Raporu', 'ERP faturaları yönetim panelinden gönderilir', 'F11',
            `Bugün: ${stats.saleCount} fiş`, 'Cihazdan al', onDayEnd)}
        </div>
      </main>

      <footer style={{
        flexShrink: 0,
        minHeight: 64,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        padding: '8px 16px',
        background: 'var(--pos-header-bg)',
        color: 'var(--pos-header-text)',
        borderTop: '1px solid var(--pos-border)',
      }}>
        <span style={{ fontWeight: 700 }}>Bugün: {stats.saleCount} fiş</span>
        {!reconOpen && (
          <>
            <AmountChip label="Nakit" tone="var(--pos-success)" value={showMoney ? money.format(stats.cash) : '••••••'} />
            <AmountChip label="Kart" tone="var(--pos-primary)" value={showMoney ? money.format(stats.card) : '••••••'} />
            <AmountChip label="Toplam" tone="var(--pos-primary)" emphasis value={showMoney ? money.format(stats.total) : '••••••'} />
            <button type="button" onClick={showMoney ? onHideAmounts : onReveal} style={footBtn}>👁 {showMoney ? 'Gizle' : 'Göster'}</button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => onSale({ held: true })} style={footBtn}>
          Bekleyen Belgeler
          {stats.held > 0 && <b style={{ background: 'var(--pos-warning)', color: 'var(--pos-surface)', borderRadius: 99, padding: '0 8px' }}>{stats.held}</b>}
          {kbd('F3')}
        </button>
      </footer>
    </div>
  )
}

function AmountChip({ label, value, tone, emphasis }: { label: string; value: string; tone: string; emphasis?: boolean }) {
  return (
    <span style={{
      background: 'var(--pos-surface)',
      color: 'var(--pos-text)',
      border: `1px solid ${emphasis ? 'var(--pos-primary)' : 'var(--pos-border)'}`,
      borderRadius: 8,
      padding: '6px 10px',
      minHeight: 48,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 16,
      fontWeight: 700,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: tone }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--pos-text-muted)' }}>{label}</span>
      {value}
    </span>
  )
}

const footBtn: CSSProperties = {
  minHeight: 52,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid var(--pos-border)',
  background: 'var(--pos-surface)',
  color: 'var(--pos-text)',
  cursor: 'pointer',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
}

export function ManagerGate({
  title,
  onCancel,
  onOk,
}: {
  title: string
  onCancel: () => void
  onOk: () => void
}) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit() {
    const row = await window.electron.db.verifyCashier(code.trim(), password)
    if (!row || row.role !== 'manager') {
      setError('Yetkili kodu veya şifre hatalı.')
      return
    }
    onOk()
  }

  return (
    <div data-home-overlay="" style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'var(--pos-scrim, rgba(0,0,0,.45))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <form onSubmit={e => { e.preventDefault(); void submit() }} style={{
        width: 360, background: 'var(--pos-surface)', color: 'var(--pos-text)',
        border: '1px solid var(--pos-border)', borderRadius: 12, padding: 16,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="Yetkili kodu" autoFocus style={field} />
        <input value={password} type="password" onChange={e => setPassword(e.target.value)} placeholder="Şifre" style={field} />
        {error && <div style={{ color: 'var(--pos-danger)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={footBtn}>Vazgeç</button>
          <button type="submit" style={{ ...footBtn, background: 'var(--pos-primary)', color: 'var(--pos-primary-text)' }}>Onayla</button>
        </div>
      </form>
    </div>
  )
}

const field: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--pos-border)',
  background: 'var(--pos-surface)',
  color: 'var(--pos-text)',
  fontSize: 16,
}

export { EMPTY as EMPTY_HOME_STATS }
export type { Gate }

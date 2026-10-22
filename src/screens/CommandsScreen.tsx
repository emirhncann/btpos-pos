import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { cmdProgress, type CmdProgressState } from '../lib/cmdProgress'
import { commandExtra } from '../lib/commandLive'
import { commandGlyph, commandMeta, commandTitle } from '../lib/commandLabels'
import { dayEndProgressCaption } from '../lib/dayEndPrecheck'
import { DateRangePicker } from '../components/DateRangePicker'
import { isEditableField } from '../lib/keyboardInput'
import {
  dayHeading,
  durationLabel,
  formatDayRange,
  formatDetail,
  formatIstanbulRange,
  inCommandRange,
  inDayBounds,
  istanbulClock,
  istanbulDay,
  istanbulToday,
  payloadSummary,
  presetBounds,
  shortId,
  type DayPreset,
} from '../lib/commandView'

type StatusFilter = 'all' | 'pending' | 'done' | 'failed'

type ViewRow = {
  id: string
  command: string
  payload: Record<string, unknown>
  status: string
  receivedAt: string
  doneAt?: string
  error?: string
  startedAt?: string
}

const PRESETS: Array<{ id: DayPreset; label: string }> = [
  { id: 'today', label: 'Bugün' },
  { id: 'yesterday', label: 'Dün' },
  { id: '7', label: '7 gün' },
  { id: '30', label: '30 gün' },
]

function badge(status: string): { text: string; color: string } {
  if (status === 'rejected') return { text: 'Gönderilmedi', color: 'var(--pos-danger)' }
  if (status === 'done') return { text: 'Tamamlandı', color: 'var(--pos-success)' }
  if (status === 'failed') return { text: 'Hata', color: 'var(--pos-danger)' }
  if (status === 'running') return { text: 'İşleniyor', color: 'var(--pos-primary)' }
  if (status === 'waiting' || status === 'pending') return { text: 'Bekliyor', color: 'var(--pos-warning)' }
  if (status === 'cancelled' || status === 'canceled' || status === 'iptal') {
    return { text: 'İptal edildi', color: 'var(--pos-text-muted)' }
  }
  return { text: status || 'Komut', color: 'var(--pos-text-muted)' }
}

function senderOf(payload: Record<string, unknown>): string {
  for (const key of ['created_by_name', 'requested_by_name', 'requested_name', 'issuer_name', 'admin_name']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function CommandsScreen({ isOnline, onClose }: { isOnline: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<CommandHistoryRow[]>([])
  const [limit, setLimit] = useState(200)
  const [live, setLive] = useState<CmdProgressState>({ items: [] })
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [preset, setPreset] = useState<DayPreset>('7')
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [fullId, setFullId] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [flash, setFlash] = useState<{ label: string; until: number } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, { docsSent: number; docsTotal: number }>>({})

  useEffect(() => cmdProgress.subscribe(setLive), [])

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim().toLocaleLowerCase('tr-TR')), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let stop = false
    const load = () => {
      window.electron.db.getCommandHistory(limit)
        .then(async list => {
          if (stop) return
          setRows(list)
          const ids = [...new Set(list.map(row => {
            const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {}
            return String(payload.run_id ?? '').trim()
          }).filter(Boolean))]
          const snaps = await Promise.all(ids.map(async id => {
            const snap = await window.electron.db.dayEndProgress(id)
            return [id, { docsSent: snap.docsSent, docsTotal: snap.docsTotal }] as const
          }))
          if (!stop) setProgress(Object.fromEntries(snaps))
        })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 3000)
    return () => { stop = true; clearInterval(t) }
  }, [limit, live.finishedAt, live.items.length])

  const runningIdx = live.items.findIndex(item => item.status === 'running')
  const running = runningIdx >= 0 ? live.items[runningIdx] : undefined
  const waiting = live.items.filter(item => item.status === 'waiting')

  useEffect(() => {
    if (running) {
      setFlash(null)
      return
    }
    if (!live.finishedAt || now - live.finishedAt > 2000) return
    const justDone = [...live.items].reverse().find(item => item.status === 'done')
    if (!justDone) return
    const until = live.finishedAt + 2000
    setFlash(prev => prev ?? { label: commandMeta(justDone.command).label, until })
  }, [running, live.finishedAt, live.items, now])

  const view = useMemo(() => {
    const known = new Set(rows.map(row => row.id))
    const history: ViewRow[] = rows.map(row => {
      const extra = commandExtra(row.id)
      return {
        id: row.id,
        command: row.command,
        payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {},
        status: row.status,
        receivedAt: row.receivedAt,
        doneAt: row.doneAt,
        error: extra?.error,
        startedAt: extra?.startedAt,
      }
    })
    for (const item of live.items) {
      if (item.status !== 'waiting' || !item.id || known.has(item.id)) continue
      const extra = commandExtra(item.id)
      history.push({
        id: item.id,
        command: item.command,
        payload: {},
        status: 'waiting',
        receivedAt: extra?.seenAt ?? new Date().toISOString(),
      })
    }
    return history
  }, [rows, live.items])

  const today = istanbulToday()
  const doneToday = view.filter(row => row.status === 'done' && istanbulDay(row.receivedAt) === today).length
  const failed7 = view.filter(row => row.status === 'failed' && inCommandRange(row.receivedAt, '7')).length

  const bounds = custom ?? presetBounds(preset)
  const listed = view
    .filter(row => inDayBounds(row.receivedAt, bounds.from, bounds.to))
    .filter(row => {
      if (filter === 'all') return row.status !== 'running'
      if (filter === 'pending') return row.status === 'waiting' || row.status === 'pending'
      if (filter === 'done') return row.status === 'done'
      return row.status === 'failed'
    })
    .filter(row => {
      if (!q) return true
      const label = commandTitle(row.command, row.payload).toLocaleLowerCase('tr-TR')
      const kind = row.command.toLocaleLowerCase('tr-TR')
      const id = row.id.toLocaleLowerCase('tr-TR')
      return label.includes(q) || kind.includes(q) || id.startsWith(q)
    })
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))

  const groups = new Map<string, ViewRow[]>()
  for (const row of listed) {
    const day = istanbulDay(row.receivedAt) ?? 'tarihsiz'
    const bucket = groups.get(day) ?? []
    bucket.push(row)
    groups.set(day, bucket)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        if (picker) return
        e.preventDefault()
        onClose()
        return
      }
      if (isEditableField(e.target) || picker) return
      if (listed.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocus(i => Math.min(listed.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocus(i => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const row = listed[Math.min(focus, listed.length - 1)]
        if (row) setOpenId(id => id === row.id ? null : row.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, listed, onClose, picker])

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      window.setTimeout(() => setCopied(current => current === id ? null : current), 1500)
    } catch { /* pano kapalı */ }
  }

  const showFlash = flash != null && now < flash.until
  const runningExtra = running ? commandExtra(running.id) : undefined
  const elapsed = runningExtra?.startedAt ? durationLabel(runningExtra.startedAt, new Date(now).toISOString()) : ''
  const pct = live.items.length > 0 && runningIdx >= 0
    ? Math.round(((runningIdx + 1) / live.items.length) * 100)
    : 0

  return (
    <div data-home-overlay="" style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'var(--pos-screen-bg)',
      color: 'var(--pos-text)',
      display: 'flex', flexDirection: 'column',
      fontVariantNumeric: 'tabular-nums',
    }}>
      <header style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '12px 16px',
        background: 'var(--pos-header-bg)',
        color: 'var(--pos-header-text)',
        borderBottom: '1px solid var(--pos-border)',
      }}>
        <button type="button" onClick={onClose} style={backBtn}>← Ana Ekran</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Komutlar</div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>Merkezden bu kasaya gönderilen talimatlar</div>
        </div>
        <span style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, opacity: 0.85 }}>Son kontrol: —</div>
          <div style={{ fontWeight: 700, color: isOnline ? 'var(--pos-success)' : 'var(--pos-warning)' }}>
            ● {isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}
          </div>
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <SummaryCard label="İşleniyor" value={running ? 1 : 0} active={filter === 'all' && !!running} onClick={() => setFilter('all')} />
          <SummaryCard label="Bekleyen" value={waiting.length} tone={waiting.length > 0 ? 'var(--pos-warning)' : undefined} active={filter === 'pending'} onClick={() => setFilter('pending')} />
          <SummaryCard label="Bugün tamamlanan" value={doneToday} active={filter === 'done'} onClick={() => { setFilter('done'); setCustom(null); setPreset('today') }} />
          <SummaryCard label="Hatalı (7 gün)" value={failed7} tone={failed7 > 0 ? 'var(--pos-danger)' : undefined} active={filter === 'failed'} onClick={() => { setFilter('failed'); setCustom(null); setPreset('7') }} />
        </div>

        {(running || showFlash) && (
          <section style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <strong style={{ fontSize: 18 }}>
                {showFlash && !running ? `✓ ${flash?.label ?? ''} tamamlandı` : `${commandGlyph(running?.command ?? '')}  ${commandMeta(running?.command ?? '').label}`}
              </strong>
              {running && (
                <span style={{ color: 'var(--pos-primary)', fontWeight: 700 }}>
                  ⟳ {runningIdx + 1}/{live.items.length}
                </span>
              )}
            </div>
            {running && (
              <>
                <div style={{ color: 'var(--pos-text-muted)', fontSize: 13, marginTop: 6 }}>
                  Alındı {istanbulClock(runningExtra?.seenAt, true)}
                  {elapsed ? ` · ${elapsed}` : ''}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--pos-surface-alt)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--pos-primary)' }} />
                  </div>
                  <span style={{ fontSize: 13 }}>{running.label} güncelleniyor…</span>
                </div>
              </>
            )}
          </section>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {([
            ['all', 'Tümü'],
            ['pending', 'Bekleyen'],
            ['done', 'Tamamlanan'],
            ['failed', 'Hatalı'],
          ] as Array<[StatusFilter, string]>).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} style={chip(filter === id)}>{label}</button>
          ))}
          <span style={{ flex: 1 }} />
          {PRESETS.map(item => (
            <button key={item.id} type="button" onClick={() => { setCustom(null); setPreset(item.id) }} style={chip(!custom && preset === item.id)}>{item.label}</button>
          ))}
          {custom ? (
            <button type="button" style={chip(true)} onClick={() => setPicker(true)}>
              📅 {formatDayRange(custom.from, custom.to)}
              <span
                style={{ marginLeft: 8 }}
                onClick={ev => { ev.stopPropagation(); setCustom(null); setPreset('7') }}
              >✕</span>
            </button>
          ) : (
            <button type="button" style={chip(false)} onClick={() => setPicker(true)}>📅 Tarih seç</button>
          )}
          <input
            data-kb="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Komut adı / no"
            style={{
              minHeight: 48, minWidth: 180, flex: '1 1 180px',
              borderRadius: 8, border: '1px solid var(--pos-border)',
              background: 'var(--pos-surface)', color: 'var(--pos-text)',
              padding: '0 12px', font: 'inherit',
            }}
          />
        </div>
        {picker && (
          <DateRangePicker
            from={bounds.from}
            to={bounds.to}
            onClose={() => setPicker(false)}
            onApply={(from, to) => { setCustom({ from, to }); setPicker(false) }}
          />
        )}

        {listed.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--pos-text-muted)', padding: 28 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>▣</div>
            Bu aralıkta komut yok
          </div>
        ) : [...groups.entries()].map(([day, items]) => (
          <section key={day}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: 'var(--pos-text-muted)', margin: '8px 0' }}>
              {dayHeading(day)}
            </div>
            {items.map(row => {
              const index = listed.indexOf(row)
              const meta = commandMeta(row.command)
              const mark = badge(row.status)
              const summary = payloadSummary(row.payload)
              const open = openId === row.id
              const detail = formatDetail({ payload: row.payload, error: row.error ?? null })
              const lines = detail.split('\n')
              const clipped = fullId === row.id ? detail : lines.slice(0, 12).join('\n')
              const dur = durationLabel(row.startedAt ?? row.receivedAt, row.doneAt)
              const rangeText = row.command === 'day_end_run' || row.command === 'day_end_retry'
                ? formatIstanbulRange(String(row.payload.range_start ?? ''), String(row.payload.range_end ?? ''))
                : ''
              const runId = String(row.payload.run_id ?? '').trim()
              const snap = runId ? progress[runId] : undefined
              const progressText = snap && (row.command === 'day_end_run' || row.command === 'day_end_retry')
                ? dayEndProgressCaption(String(row.payload.range_label ?? rangeText), snap.docsSent, snap.docsTotal)
                : ''
              const problems = Array.isArray(row.payload.problems)
                ? row.payload.problems.map(item => String(item)).filter(Boolean)
                : []
              return (
                <div key={row.id} style={{
                  ...card,
                  marginBottom: 8,
                  minHeight: 56,
                  outline: focus === index ? '3px solid var(--pos-primary)' : 'none',
                }}>
                  <button type="button" onClick={() => { setFocus(index); setOpenId(open ? null : row.id) }} style={rowBtn}>
                    <span style={{ color: mark.color, width: 22 }}>{row.status === 'failed' ? '⚠' : row.status === 'done' ? '✓' : '○'}</span>
                    <span style={{ width: 28 }}>{commandGlyph(row.command)}</span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <span style={{ fontWeight: 700 }}>{progressText || commandTitle(row.command, row.payload)}</span>
                      {summary ? <span style={{ color: 'var(--pos-text-muted)' }}> · {summary}</span> : null}
                    </span>
                    <span style={{ color: 'var(--pos-text-muted)', fontSize: 13 }}>{istanbulClock(row.receivedAt)}</span>
                    <span style={{ color: 'var(--pos-text-muted)', fontSize: 13, width: 72 }}>{dur}</span>
                    <span style={{ color: mark.color, fontWeight: 700, fontSize: 13 }}>{mark.text}</span>
                    <span>{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div style={{ padding: '4px 12px 12px', fontSize: 13 }}>
                      {row.error && (
                        <div style={{ color: 'var(--pos-danger)', fontWeight: 700, marginBottom: 8 }}>
                          Hata: {formatDetail(row.error)}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <span>Komut no {shortId(row.id)}</span>
                        <button type="button" style={chip(false)} onClick={() => void copyText(row.id, `${row.id}\n${detail}`)}>
                          {copied === row.id ? 'Kopyalandı' : 'Kopyala'}
                        </button>
                      </div>
                      <div style={{ color: 'var(--pos-text-muted)' }}>
                        Alındı {istanbulClock(row.receivedAt, true)}
                        {row.startedAt ? ` · Başladı ${istanbulClock(row.startedAt, true)}` : ''}
                        {row.doneAt ? ` · Bitti ${istanbulClock(row.doneAt, true)}` : ''}
                      </div>
                      {rangeText ? <div style={{ marginTop: 4 }}>Aralık: {rangeText}</div> : null}
                      {progressText ? <div style={{ marginTop: 4 }}>{progressText}</div> : null}
                      {problems.length > 0 && (
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--pos-danger)' }}>
                          {problems.map(problem => <li key={problem}>{problem}</li>)}
                        </ul>
                      )}
                      {senderOf(row.payload) && <div style={{ marginTop: 4 }}>Gönderen: {senderOf(row.payload)}</div>}
                      <div style={{ marginTop: 4 }}>Durum: {row.status}</div>
                      <pre style={pre}>{clipped}</pre>
                      {lines.length > 12 && fullId !== row.id && (
                        <button type="button" style={chip(false)} onClick={() => setFullId(row.id)}>Tamamını göster</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ))}

        {rows.length >= limit && (
          <button type="button" style={{ ...chip(false), alignSelf: 'center' }} onClick={() => setLimit(n => n + 200)}>
            Daha eski kayıtlar
          </button>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label, value, tone, active, onClick,
}: {
  label: string
  value: number
  tone?: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} style={{
      ...card,
      textAlign: 'left',
      cursor: 'pointer',
      minHeight: 72,
      borderColor: tone ?? 'var(--pos-border)',
      outline: active ? '3px solid var(--pos-primary)' : 'none',
    }}>
      <div style={{ fontSize: 13, color: 'var(--pos-text-muted)' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: tone ?? 'var(--pos-text)' }}>{value}</div>
    </button>
  )
}

const card: CSSProperties = {
  background: 'var(--pos-surface)',
  color: 'var(--pos-text)',
  border: '1px solid var(--pos-border)',
  borderRadius: 12,
  padding: 12,
}

const backBtn: CSSProperties = {
  minHeight: 48,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid var(--pos-border)',
  background: 'transparent',
  color: 'inherit',
  fontWeight: 700,
  cursor: 'pointer',
}

const rowBtn: CSSProperties = {
  width: '100%',
  minHeight: 56,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'transparent',
  color: 'inherit',
  border: 'none',
  cursor: 'pointer',
  font: 'inherit',
  fontVariantNumeric: 'tabular-nums',
}

const pre: CSSProperties = {
  margin: '8px 0 0',
  padding: 10,
  borderRadius: 8,
  background: 'var(--pos-surface-alt)',
  color: 'var(--pos-text)',
  border: '1px solid var(--pos-border)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 12,
  fontFamily: 'inherit',
}

function chip(on: boolean): CSSProperties {
  return {
    minHeight: 48,
    padding: '0 12px',
    borderRadius: 8,
    border: '1px solid var(--pos-border)',
    background: on ? 'var(--pos-primary)' : 'var(--pos-surface)',
    color: on ? 'var(--pos-primary-text)' : 'var(--pos-text)',
    cursor: 'pointer',
    fontWeight: 700,
  }
}

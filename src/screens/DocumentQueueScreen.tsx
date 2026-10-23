import { useCallback, useEffect, useState } from 'react'
import { C, solidBtn } from '../theme/colors'
import AlertDialog from '../components/AlertDialog'
import { QueueActionMenu } from '../components/QueueActionMenu'
import { useAlertDialog } from '../hooks/useAlertDialog'
import { formatIstanbulDateTime, istanbulClock, istanbulDay, istanbulToday } from '../lib/commandView'
import { postDayEndProcessingIfFailed } from '../lib/dayEndApi'
import { dayEndProgressCaption } from '../lib/dayEndPrecheck'
import { formatSentInvoice } from '../lib/invoiceMode'
import { payloadSummary } from '../lib/queueCustomer'
import {
  customerErpNumber,
  customerUnchanged,
  customerUpdatedAt,
  editableQueueStatus,
  formatCariLine,
  invoiceCustomerBody,
  isDayEndQueueDoc,
  payloadCustomerCode,
  queueCustomerKind,
} from '../lib/queueCustomerPatch'

type OpStatus = 'pending' | 'pending_dayend' | 'processing' | 'success' | 'failed' | 'done' | 'cancelled'

interface OpRow {
  id:          string
  type:        string
  label:       string | null
  status:      OpStatus
  attempts:    number
  maxAttempts: number
  error:       string | null
  createdAt:   string
  sentAt:      string | null
  payload:     string
  invoiceNumber: string | null
}

const TYPE_LABEL: Record<string, string> = {
  invoice:          'Satış Faturası',
  return_invoice:   'İade Fatura',
  customer:         'Yeni Cari',
  day_end_invoice:  'Gün Sonu Faturası',
  payment:          'Tahsilat/Ödeme',
}

const TYPE_ICON: Record<string, string> = {
  invoice:          '🧾',
  return_invoice:   '↩️',
  customer:         '👤',
  day_end_invoice:  '📊',
  payment:          '💰',
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending:        { bg: C.warning, color: '#FFFFFF', label: 'Bekliyor' },
  pending_dayend: { bg: C.online, color: '#FFFFFF', label: 'Gün Sonu Bekliyor' },
  processing:     { bg: C.primary, color: '#FFFFFF', label: 'Gönderiliyor' },
  success:        { bg: C.success, color: '#FFFFFF', label: 'Gönderildi' },
  failed:         { bg: C.danger, color: '#FFFFFF', label: 'Hata' },
  done:           { bg: '#F3F4F6', color: '#6B7280', label: 'Tamamlandı' },
  cancelled:      { bg: '#F3F4F6', color: '#6B7280', label: 'İptal edildi' },
}

type TypeFilter = 'all' | 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice' | 'payment'

function todayStr() {
  return istanbulToday()
}

function dayEndRunId(raw: string): string {
  return String(readPayload(raw).day_end_run_id ?? '').trim()
}

function readPayload(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw || '{}') as Record<string, unknown> } catch { return {} }
}

function erpIdentity(payload: string): string {
  try {
    const body = JSON.parse(payload) as { erp_invoice_id?: unknown; invoice_id?: unknown }
    return String(body.erp_invoice_id ?? body.invoice_id ?? '').trim()
  } catch {
    return ''
  }
}

function formatError(error: string): string {
  const trimmed = error.trim()
  if (trimmed.length <= 120) return trimmed
  return trimmed.slice(0, 117) + '…'
}

const INVOICE_TYPES = new Set(['invoice', 'day_end_invoice', 'return_invoice'])

export function DocumentQueueScreen({
  companyId,
  onRetryTrigger,
}: {
  companyId: string
  cashierRole?: string
  onRetryTrigger?: () => void
}) {
  const [ops,          setOps]          = useState<OpRow[]>([])
  const [runProgress, setRunProgress] = useState<Record<string, { docsSent: number; docsTotal: number }>>({})
  const [loading,      setLoading]      = useState(true)
  const [statusFilter, setStatusFilter] = useState<'waiting' | 'failed' | 'sent' | 'all'>('waiting')
  const [typeFilter,   setTypeFilter]   = useState<TypeFilter>('all')
  const [dateFrom,     setDateFrom]     = useState(todayStr())
  const [dateTo,       setDateTo]       = useState(todayStr())
  const [retrying,     setRetrying]     = useState<string | null>(null)
  const [detailOp,     setDetailOp]     = useState<OpRow | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{
    id: string
    upward: boolean
    anchor: { top: number; left: number; bottom: number; right: number }
  } | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const { dialogProps, showError, showInfo, confirm } = useAlertDialog()

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const all = await window.electron.db.getAllOperations(companyId, 500)
      setOps(all as OpRow[])
      const snaps = await window.electron.db.listDayEndProgress(companyId)
      setRunProgress(Object.fromEntries(snaps.map(snap => [snap.runId, { docsSent: snap.docsSent, docsTotal: snap.docsTotal }])))
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { void reload() }, [reload])

  const dateTypeFiltered = ops.filter(op => {
    const opDate = istanbulDay(op.createdAt) ?? ''
    if (dateFrom && opDate < dateFrom) return false
    if (dateTo   && opDate > dateTo)   return false
    if (typeFilter !== 'all' && op.type !== typeFilter) return false
    return true
  })

  const waitingRank = (status: string) => {
    if (status === 'failed') return 0
    if (status === 'processing') return 1
    if (status === 'pending') return 2
    if (status === 'pending_dayend') return 3
    return 4
  }
  const isWaiting = (status: string) => status !== 'success' && status !== 'done' && status !== 'cancelled'
  const filteredRaw = dateTypeFiltered.filter(op => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'failed') return op.status === 'failed'
    if (statusFilter === 'sent') return op.status === 'success' || op.status === 'done'
    return isWaiting(op.status)
  })
  const filtered = statusFilter === 'waiting'
    ? [...filteredRaw].sort((a, b) => {
        const rank = waitingRank(a.status) - waitingRank(b.status)
        if (rank !== 0) return rank
        return a.createdAt < b.createdAt ? -1 : 1
      })
    : filteredRaw

  const counts = {
    all:     dateTypeFiltered.length,
    waiting: dateTypeFiltered.filter(o => isWaiting(o.status)).length,
    failed:  dateTypeFiltered.filter(o => o.status === 'failed').length,
    sent:    dateTypeFiltered.filter(o => o.status === 'success' || o.status === 'done').length,
  }

  const handleRetry = async (id: string) => {
    setRetrying(id)
    try {
      const op = ops.find(row => row.id === id)
      await window.electron.db.retryOperation(id)
      await postDayEndProcessingIfFailed([op ? dayEndRunId(op.payload) : ''])
      await reload()
      onRetryTrigger?.()
    } finally {
      setRetrying(null)
    }
  }

  async function localCari(payload: Record<string, unknown>): Promise<CustomerRow | null> {
    const ref = payload.customer_ref as { type?: string; id?: string } | undefined
    if (ref?.type === 'customer' && ref.id) {
      const byId = await window.electron.db.getCustomerById(companyId, ref.id)
      if (byId) return byId
    }
    const code = payloadCustomerCode(payload)
    if (!code) return null
    return window.electron.db.getCustomerByCode(companyId, code)
  }

  async function handleRefreshCari(op: OpRow) {
    const payload = readPayload(op.payload)
    const row = await localCari(payload)
    if (!row) {
      showInfo('Cari', 'Bu cari kasada bulunamadı. Müşteri listesini yönetim panelinden kasaya gönderin.')
      return
    }
    if (customerUnchanged(payload, row)) {
      showInfo('Cari', `Bu belgedeki cari bilgisi zaten güncel (${row.name} · ${row.code}).`)
      return
    }
    const ok = await confirm({
      title: 'Cari bilgisi yenilensin mi?',
      message: `Eski: ${formatCariLine(payload) || 'gövdede cari yok'}\nYeni: ${row.name} · ${row.code}\nBelge yeni cariyle yeniden gönderilecek.`,
      confirmLabel: 'Güncelle ve Gönder',
      cancelLabel: 'Vazgeç',
    })
    if (!ok) return
    const previous = payloadCustomerCode(payload)
    const changed = await window.electron.db.refreshOperationCustomer(op.id, {
      ref: { type: 'customer', id: row.id },
      customer: invoiceCustomerBody(row),
      customerErpId: customerErpNumber(row),
      customerName: row.name,
      touchName: true,
    }, previous)
    if (changed) {
      console.log(`[belge-aktarim] cari yenilendi row=${op.id} eski=${previous || '—'} yeni=${row.code}`)
      await postDayEndProcessingIfFailed([dayEndRunId(op.payload)])
      await reload()
      onRetryTrigger?.()
    }
  }

  const handleDelete = async (op: OpRow) => {
    const payload = readPayload(op.payload)
    const dayEnd = isDayEndQueueDoc(op.type, payload)
    const ok = await confirm({
      title: 'Kayıt Sil',
      message: dayEnd
        ? 'Gün sonu belgesi silinirse gün sonu tamamlanmaz. Yönetim panelinden iptal etmeniz önerilir.'
        : 'Bu kaydı silmek istediğinize emin misiniz?',
      confirmLabel: 'Sil',
      cancelLabel: 'Vazgeç',
    })
    if (!ok) return
    await window.electron.db.deleteOperation(op.id)
    setSelected(prev => {
      const next = new Set(prev)
      next.delete(op.id)
      return next
    })
    await reload()
  }

  async function copyError(op: OpRow) {
    const text = op.error?.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      showInfo('Kopyalandı', 'Hata metni panoya alındı.')
    } catch {
      showError('Kopyalanamadı', text)
    }
  }

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedRows = filtered.filter(op => selected.has(op.id))

  return (
    <div style={{ padding: 20, maxWidth: 860, margin: '0 auto' }}>

      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Belge Aktarım</h2>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '4px 0 0' }}>
            Buluta gönderilecek / gönderilen işlemler
          </p>
        </div>
        <button type="button" onClick={() => void reload()}
          style={{ background: '#F3F4F6', border: '1px solid #E5E7EB',
            borderRadius: 8, padding: '7px 14px', fontSize: 12,
            cursor: 'pointer', color: '#374151' }}>
          ↺ Yenile
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#6B7280' }}>Tarih:</span>
        <input type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6,
            border: '1px solid #E5E7EB' }} />
        <span style={{ fontSize: 12, color: '#9CA3AF' }}>—</span>
        <input type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6,
            border: '1px solid #E5E7EB' }} />
        <button type="button"
          onClick={() => { setDateFrom(todayStr()); setDateTo(todayStr()) }}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6,
            border: '1px solid #E5E7EB', background: 'white',
            color: '#6B7280', cursor: 'pointer' }}>
          Bugün
        </button>
        <button type="button"
          onClick={() => { setDateFrom(''); setDateTo('') }}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6,
            border: '1px solid #E5E7EB', background: 'white',
            color: '#6B7280', cursor: 'pointer' }}>
          Tümü
        </button>
      </div>

      <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
        {([
          ['all',             'Tümü'],
          ['invoice',         '🧾 Satış'],
          ['return_invoice',  '↩️ İade'],
          ['day_end_invoice', '📊 Gün Sonu'],
          ['customer',        '👤 Cari'],
          ['payment',         '💰 Tahsilat'],
        ] as [TypeFilter, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTypeFilter(k)}
            style={{ padding: '4px 10px', borderRadius: 16, fontSize: 11,
              fontWeight: 500, border: '1px solid', cursor: 'pointer',
              background: typeFilter === k ? '#374151' : 'white',
              color:      typeFilter === k ? 'white'   : '#374151',
              borderColor:typeFilter === k ? '#374151' : '#E5E7EB' }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 5, marginBottom: 14, flexWrap: 'wrap' }}>
        {([
          ['waiting', 'Gönderilmeyi bekleyen'],
          ['failed',  'Hatalı'],
          ['sent',    'Gönderilen'],
          ['all',     'Tümü'],
        ] as Array<['waiting' | 'failed' | 'sent' | 'all', string]>).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatusFilter(k)}
            style={{
              ...(statusFilter === k ? solidBtn(C.primary, false, true) : solidBtn(C.neutral)),
              padding: '5px 12px', borderRadius: 20, fontSize: 12,
            }}>
            {l} ({counts[k]})
          </button>
        ))}
      </div>

      {selectedRows.length > 0 && (
        <div style={{
          marginBottom: 12, padding: '10px 14px', borderRadius: 8,
          background: 'var(--pos-surface)', border: '1px solid var(--pos-border)',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontWeight: 700, color: 'var(--pos-text)' }}>{selectedRows.length} belge seçili</span>
          <button type="button" onClick={() => {
            void (async () => {
              const runIds: string[] = []
              for (const op of selectedRows) {
                if (!editableQueueStatus(op.status)) continue
                await window.electron.db.retryOperation(op.id)
                runIds.push(dayEndRunId(op.payload))
              }
              await postDayEndProcessingIfFailed(runIds)
              await reload()
              onRetryTrigger?.()
            })()
          }} style={{ ...solidBtn(C.primary), borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
            ↻ Tekrar dene
          </button>
          <button type="button" onClick={() => setSelected(new Set())}
            style={{ ...solidBtn(C.neutral), borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
            Seçimi kaldır
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
          Yükleniyor...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>
          {statusFilter === 'waiting' ? (
            <>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
              Gönderilmeyi bekleyen belge yok
              <div>
                <button type="button" onClick={() => setStatusFilter('sent')}
                  style={{ marginTop: 12, ...solidBtn(C.primary), borderRadius: 8, padding: '8px 14px', fontSize: 13 }}>
                  Gönderilenleri göster
                </button>
              </div>
            </>
          ) : 'Bu filtrede işlem yok'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(op => {
            const ss = STATUS_STYLE[op.status] ?? STATUS_STYLE.pending
            const payload = readPayload(op.payload)
            const runId = dayEndRunId(op.payload)
            const snap = runId ? runProgress[runId] : undefined
            const progressText = snap
              ? dayEndProgressCaption(String(payload.range_label ?? op.label ?? ''), snap.docsSent, snap.docsTotal)
              : ''
            const cariLine = formatCariLine(payload)
            const updatedAt = customerUpdatedAt(payload)
            const menuItems = (() => {
              const kind = queueCustomerKind(op.type, payload)
              const editable = editableQueueStatus(op.status)
              const items: Array<{ id: string; label: string; danger?: boolean; separator?: boolean }> = []
              if (editable) items.push({ id: 'retry', label: '↻ Tekrar dene' })
              if (editable && kind === 'cari') items.push({ id: 'cari', label: '👤 Cari bilgisini yenile' })
              items.push({ id: 'detail', label: '📄 Belge ayrıntısı' })
              if (op.error?.trim()) items.push({ id: 'copy', label: '📋 Hatayı kopyala' })
              if (editable) {
                items.push({ id: 'sep', label: '', separator: true })
                items.push({ id: 'delete', label: '🗑 Sil', danger: true })
              }
              return items
            })()
            return (
              <div key={op.id} style={{ background: 'var(--pos-surface)',
                border: '1px solid var(--pos-border)', borderRadius: 10,
                padding: '12px 16px', display: 'flex',
                alignItems: 'center', gap: 12 }}>

                <label style={{ display: 'flex', alignItems: 'center', minWidth: 28, minHeight: 44 }}>
                  <input
                    type="checkbox"
                    checked={selected.has(op.id)}
                    onChange={() => toggleSelected(op.id)}
                    style={{ width: 20, height: 20 }}
                  />
                </label>

                <div style={{ fontSize: 20, flexShrink: 0 }}>
                  {TYPE_ICON[op.type] ?? '📄'}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {progressText || op.label || TYPE_LABEL[op.type] || op.type}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                    {TYPE_LABEL[op.type] ?? op.type}
                    {' · '}
                    {formatIstanbulDateTime(op.createdAt) || '—'}
                    {cariLine ? ` · Cari: ${cariLine}` : ''}
                    {updatedAt ? (
                      <span style={{
                        marginLeft: 6, padding: '1px 6px', borderRadius: 8,
                        background: 'var(--pos-surface-alt)', color: 'var(--pos-text-muted)',
                      }}>
                        güncellendi {istanbulClock(updatedAt)}
                      </span>
                    ) : null}
                    {op.sentAt && (
                      <span style={{ color: 'var(--pos-success)' }}>
                        {' · ✓ '}{formatIstanbulDateTime(op.sentAt)}
                      </span>
                    )}
                  </div>
                  {op.error && (
                    <div style={{ fontSize: 11, color: '#C62828', marginTop: 4,
                      background: '#FEF2F2', padding: '4px 8px',
                      borderRadius: 4, lineHeight: 1.4,
                      wordBreak: 'break-word' }}
                      title={op.error}>
                      ✕ {formatError(op.error)}
                    </div>
                  )}
                </div>

                {op.status === 'failed' && (
                  <div style={{ fontSize: 11, color: '#9CA3AF', flexShrink: 0 }}>
                    {op.attempts}/{op.maxAttempts}
                  </div>
                )}

                <div style={{ background: ss.bg, color: ss.color,
                  borderRadius: 6, padding: '3px 10px',
                  fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                  {(op.status === 'success' || op.status === 'done') && INVOICE_TYPES.has(op.type)
                    ? formatSentInvoice(op.invoiceNumber)
                    : ss.label}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                  {op.status === 'failed' && (
                    <button type="button"
                      onClick={() => void handleRetry(op.id)}
                      disabled={retrying === op.id}
                      style={{ ...solidBtn(C.primary, retrying === op.id),
                        borderRadius: 7, padding: '8px 10px', fontSize: 13, minHeight: 48 }}>
                      {retrying === op.id ? '...' : '↻ Tekrar dene'}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="İşlemler"
                    onClick={event => {
                      const rect = event.currentTarget.getBoundingClientRect()
                      const spaceBelow = window.innerHeight - rect.bottom
                      setMenuIndex(0)
                      setMenu({
                        id: op.id,
                        upward: spaceBelow < 340,
                        anchor: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
                      })
                    }}
                    style={{
                      width: 48, height: 48, borderRadius: 8, cursor: 'pointer',
                      border: '1px solid var(--pos-border)', background: 'var(--pos-surface)',
                      color: 'var(--pos-text)', fontSize: 22,
                    }}
                  >
                    ⋮
                  </button>
                </div>
                {menu?.id === op.id && (
                  <QueueActionMenu
                    items={menuItems}
                    index={menuIndex}
                    upward={menu.upward}
                    anchor={menu.anchor}
                    onHover={setMenuIndex}
                    onClose={() => setMenu(null)}
                    onPick={id => {
                      setMenu(null)
                      if (id === 'retry') void handleRetry(op.id)
                      if (id === 'cari') void handleRefreshCari(op)
                      if (id === 'detail') setDetailOp(op)
                      if (id === 'copy') void copyError(op)
                      if (id === 'delete') void handleDelete(op)
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
      {detailOp && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'var(--pos-surface)', color: 'var(--pos-text)',
            border: '1px solid var(--pos-border)',
            borderRadius: 12, padding: 20, maxWidth: 520, width: '100%',
            maxHeight: '80vh', overflow: 'auto',
            boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Belge ayrıntısı</h3>
            {(() => {
              const payload = readPayload(detailOp.payload)
              const summary = payloadSummary(payload)
              const lines = Array.isArray(payload.items) ? payload.items as Array<{ name?: string; quantity?: number; net_amount?: number }> : []
              return (
                <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                  <div><strong>Tür:</strong> {TYPE_LABEL[detailOp.type] ?? detailOp.type}</div>
                  <div><strong>Fiş / satış:</strong> {summary.saleId}</div>
                  <div><strong>Cari:</strong> {formatCariLine(payload) || summary.customerHint}</div>
                  <div><strong>Tutar:</strong> {summary.expectedTotal != null
                    ? `${summary.expectedTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`
                    : '—'}</div>
                  <div><strong>Tarih:</strong> {summary.invoiceDate}</div>
                  <div><strong>Kalem:</strong> {lines.length === 0 ? '—' : lines.map(line => `${line.name ?? 'Kalem'} ×${line.quantity ?? ''} ${line.net_amount ?? ''}`).join(' · ')}</div>
                  {payload.day_end_run_id ? (
                    <div><strong>Gün sonu:</strong> {String(payload.doc_key ?? '')} · {String(payload.range_label ?? payload.day_end_run_id)}</div>
                  ) : null}
                  {(detailOp.status === 'success' || detailOp.status === 'done') && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--pos-text-muted)' }}>
                      İşbaşı kimliği: {erpIdentity(detailOp.payload) || '—'}
                    </div>
                  )}
                  {detailOp.error && (
                    <div style={{ marginTop: 10, color: 'var(--pos-danger)', fontSize: 13,
                      background: 'var(--pos-surface-alt)', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                      {detailOp.error}
                    </div>
                  )}
                </div>
              )
            })()}
            <button type="button" onClick={() => setDetailOp(null)}
              style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8,
                border: '1px solid var(--pos-border)', background: 'var(--pos-surface-alt)',
                color: 'var(--pos-text)', cursor: 'pointer' }}>
              Kapat
            </button>
          </div>
        </div>
      )}

      <AlertDialog {...dialogProps} />
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { C, solidBtn } from '../theme/colors'
import AlertDialog from '../components/AlertDialog'
import { useAlertDialog } from '../hooks/useAlertDialog'
import { formatIstanbulDateTime, istanbulDay, istanbulToday } from '../lib/commandView'
import { formatSentInvoice } from '../lib/invoiceMode'
import {
  customerRefFromCustomerRow,
  customerRefTorba,
  payloadSummary,
  TORBA_CARI_YOK,
} from '../lib/queueCustomer'

type OpStatus = 'pending' | 'pending_dayend' | 'processing' | 'success' | 'failed' | 'done'

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
}

type TypeFilter = 'all' | 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice' | 'payment'

function todayStr() {
  return istanbulToday()
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
  cashierRole = 'cashier',
  onAfterEnqueue,
  onRetryTrigger,
}: {
  companyId: string
  cashierRole?: string
  onAfterEnqueue?: () => void
  onRetryTrigger?: () => void
}) {
  const [ops,          setOps]          = useState<OpRow[]>([])
  const [loading,      setLoading]      = useState(true)
  const [statusFilter, setStatusFilter] = useState<'waiting' | 'failed' | 'sent' | 'all'>('waiting')
  const [typeFilter,   setTypeFilter]   = useState<TypeFilter>('all')
  const [dateFrom,     setDateFrom]     = useState(todayStr())
  const [dateTo,       setDateTo]       = useState(todayStr())
  const [retrying,     setRetrying]     = useState<string | null>(null)
  const [sending,      setSending]      = useState(false)
  const [detailOp,     setDetailOp]     = useState<OpRow | null>(null)
  const [changeOp,     setChangeOp]     = useState<OpRow | null>(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerHits,  setCustomerHits]  = useState<CustomerRow[]>([])
  const { dialogProps, showError, showSuccess, confirm } = useAlertDialog()
  const isManager = cashierRole === 'manager'

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const all = await window.electron.db.getAllOperations(companyId, 500)
      setOps(all as OpRow[])
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

  const pendingReturns = ops.filter(o =>
    o.type === 'return_invoice' && o.status === 'pending_dayend',
  )

  const handleRetry = async (id: string) => {
    setRetrying(id)
    try {
      await window.electron.db.retryOperation(id)
      await reload()
      onRetryTrigger?.()
    } finally {
      setRetrying(null)
    }
  }

  const handleRetryAll = async () => {
    const failed = ops.filter(o => o.status === 'failed')
    for (const op of failed) await window.electron.db.retryOperation(op.id)
    await reload()
    onRetryTrigger?.()
  }

  const torbaFailed = ops.filter(
    o => o.status === 'failed' && (o.error ?? '').includes(TORBA_CARI_YOK),
  )

  const handleRetryTorbaAll = async () => {
    await window.electron.db.retryOperationsByErrorPrefix(companyId, TORBA_CARI_YOK)
    await reload()
    onRetryTrigger?.()
  }

  async function searchCustomers(q: string) {
    setCustomerQuery(q)
    if (!q.trim()) {
      setCustomerHits([])
      return
    }
    const list = await window.electron.db.getCustomers(companyId, q.trim())
    setCustomerHits(list.slice(0, 20))
  }

  async function applyCustomerRef(
    op: OpRow,
    ref: { type: 'customer'; id: string } | { type: 'torba' },
  ) {
    const raw = JSON.parse(op.payload || '{}') as Record<string, unknown>
    raw.customer_ref = ref
    delete raw.customer
    delete raw.customer_erp_id
    await window.electron.db.updateOperationPayload(op.id, raw)
    await window.electron.db.retryOperation(op.id)
    setChangeOp(null)
    setCustomerQuery('')
    setCustomerHits([])
    await reload()
    onRetryTrigger?.()
  }

  async function handleManualSent(op: OpRow) {
    const ok = await confirm({
      title: 'Gönderildi İşaretle',
      message:
        'Bu belge ERP\'ye elle girildiyse kuyruktan düşürülür. Emin misiniz?',
      confirmLabel: 'Evet, işaretle',
      cancelLabel:  'Vazgeç',
    })
    if (!ok) return
    const note = `Manuel — ${cashierRole} — ${new Date().toISOString()}`
    await window.electron.db.markOperationManuallySent(op.id, note)
    await reload()
    showSuccess('Tamam', 'Kayıt gönderildi olarak işaretlendi.')
  }

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title:   'Kayıt Sil',
      message: 'Bu kaydı silmek istediğinize emin misiniz?',
      confirmLabel: 'Evet, Sil',
      cancelLabel:  'Vazgeç',
    })
    if (!ok) return
    await window.electron.db.deleteOperation(id)
    await reload()
  }

  async function handleSendBatchReturn() {
    setSending(true)
    try {
      const { sendBatchReturnInvoice } = await import('../lib/invoiceSend')
      await sendBatchReturnInvoice(companyId)
      onAfterEnqueue?.()
      await reload()
      showSuccess('Başarılı', 'Toplu iade faturası oluşturuldu ve kuyruğa eklendi.')
    } catch (e) {
      showError('Hata', String(e))
    } finally {
      setSending(false)
    }
  }

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

      {pendingReturns.length > 0 && (
        <div style={{
          padding: '12px 16px', borderRadius: 10,
          background: C.online, border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>
              Bekleyen İadeler
            </div>
            <div style={{ fontSize: 12, color: '#FFFFFF' }}>
              {pendingReturns.length} iade — toplu fatura olarak gönderilecek
            </div>
          </div>
          <button type="button"
            onClick={() => void handleSendBatchReturn()}
            disabled={sending}
            style={{
              ...solidBtn(C.surface, sending),
              color: sending ? C.disabledFg : C.online,
              padding: '8px 16px', borderRadius: 8, fontSize: 13,
              cursor: sending ? 'default' : 'pointer',
            }}>
            {sending ? 'Gönderiliyor...' : 'Toplu İade Gönder'}
          </button>
        </div>
      )}

      {torbaFailed.length > 0 && (
        <div style={{
          marginBottom: 12, padding: '10px 14px', background: C.danger,
          border: 'none', borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, color: '#FFFFFF', fontWeight: 700, marginBottom: 8 }}>
            {torbaFailed.length} belge torba cari tanımlı olmadığı için gönderilemedi.
            Torba cari tanımlandıktan sonra &quot;Tümünü Yeniden Dene&quot; ile tekrar deneyin.
          </div>
          <button type="button" onClick={() => void handleRetryTorbaAll()}
            style={{ ...solidBtn(C.surface), color: C.danger,
              borderRadius: 7, padding: '6px 14px', fontSize: 12 }}>
            Tümünü Yeniden Dene
          </button>
        </div>
      )}

      {counts.failed > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: C.warning,
          border: 'none', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#FFFFFF', fontWeight: 700 }}>
            ⚠️ {counts.failed} hatalı işlem var
          </span>
          <button type="button" onClick={() => void handleRetryAll()}
            style={{ ...solidBtn(C.surface), color: C.warning,
              borderRadius: 7, padding: '6px 14px', fontSize: 12 }}>
            Tümünü Yeniden Dene
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
            return (
              <div key={op.id} style={{ background: 'white',
                border: '1px solid #E5E7EB', borderRadius: 10,
                padding: '12px 16px', display: 'flex',
                alignItems: 'center', gap: 12 }}>

                <div style={{ fontSize: 20, flexShrink: 0 }}>
                  {TYPE_ICON[op.type] ?? '📄'}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {op.label ?? TYPE_LABEL[op.type] ?? op.type}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                    {TYPE_LABEL[op.type] ?? op.type}
                    {' · '}
                    {formatIstanbulDateTime(op.createdAt) || '—'}
                    {op.sentAt && (
                      <span style={{ color: '#2E7D32' }}>
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

                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                  {(op.status === 'failed' || INVOICE_TYPES.has(op.type)) && (
                    <button type="button" onClick={() => setDetailOp(op)}
                      style={{ background: '#F3F4F6', border: '1px solid #E5E7EB',
                        borderRadius: 7, padding: '5px 8px', fontSize: 11, cursor: 'pointer' }}>
                      Detay
                    </button>
                  )}
                  {op.status === 'failed' && (
                    <button type="button"
                      onClick={() => void handleRetry(op.id)}
                      disabled={retrying === op.id}
                      style={{ ...solidBtn(C.primary, retrying === op.id),
                        borderRadius: 7, padding: '5px 10px', fontSize: 11 }}>
                      {retrying === op.id ? '...' : 'Yeniden Dene'}
                    </button>
                  )}
                  {op.status === 'failed' && INVOICE_TYPES.has(op.type) && (
                    <button type="button" onClick={() => { setChangeOp(op); setCustomerQuery('') }}
                      style={{ ...solidBtn(C.online),
                        borderRadius: 7, padding: '5px 8px', fontSize: 11 }}>
                      Cariyi Değiştir
                    </button>
                  )}
                  {op.status === 'failed' && isManager && (
                    <button type="button" onClick={() => void handleManualSent(op)}
                      style={{ ...solidBtn(C.success),
                        borderRadius: 7, padding: '5px 8px', fontSize: 11 }}>
                      Gönderildi İşaretle
                    </button>
                  )}
                  {op.status === 'success' && (
                    <button type="button" onClick={() => void handleDelete(op.id)}
                      style={{ background: 'none', border: 'none',
                        cursor: 'pointer', color: '#D1D5DB',
                        fontSize: 16, padding: '0 4px' }}>
                      ✕
                    </button>
                  )}
                </div>
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
            background: 'white', borderRadius: 12, padding: 20, maxWidth: 480, width: '100%',
            maxHeight: '80vh', overflow: 'auto',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Kayıt detayı</h3>
            {(() => {
              const full = ops.find(o => o.id === detailOp.id)
              let summary = { saleId: '—', expectedTotal: null as number | null, customerHint: '—', invoiceDate: '—' }
              try {
                if (full?.payload) {
                  summary = payloadSummary(JSON.parse(full.payload) as Record<string, unknown>)
                }
              } catch { /* parse hatası */ }
              return (
                <div style={{ fontSize: 13, lineHeight: 1.6, color: '#374151' }}>
                  <div><strong>Tür:</strong> {TYPE_LABEL[detailOp.type] ?? detailOp.type}</div>
                  <div><strong>Fiş / satış:</strong> {summary.saleId}</div>
                  <div><strong>Cari:</strong> {summary.customerHint}</div>
                  <div><strong>Tutar:</strong> {summary.expectedTotal != null
                    ? `${summary.expectedTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`
                    : '—'}</div>
                  <div><strong>Tarih:</strong> {summary.invoiceDate}</div>
                  {INVOICE_TYPES.has(detailOp.type) && (detailOp.status === 'success' || detailOp.status === 'done') && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#9CA3AF' }}>
                      İşbaşı kimliği: {erpIdentity(full?.payload ?? detailOp.payload) || '—'}
                    </div>
                  )}
                  {detailOp.error && (
                    <div style={{ marginTop: 10, color: '#C62828', fontSize: 12,
                      background: '#FEF2F2', padding: 8, borderRadius: 6 }}>
                      {detailOp.error}
                    </div>
                  )}
                </div>
              )
            })()}
            <button type="button" onClick={() => setDetailOp(null)}
              style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8,
                border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer' }}>
              Kapat
            </button>
          </div>
        </div>
      )}

      {changeOp && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'white', borderRadius: 12, padding: 20, maxWidth: 420, width: '100%',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Cariyi değiştir</h3>
            <input
              value={customerQuery}
              onChange={e => void searchCustomers(e.target.value)}
              placeholder="Cari ara (ad, kod, vergi no…)"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                border: '1px solid #E5E7EB', marginBottom: 8, boxSizing: 'border-box' }}
            />
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
              {customerHits.map(c => (
                <button key={c.id} type="button"
                  onClick={() => void applyCustomerRef(changeOp, customerRefFromCustomerRow(c))}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                    border: 'none', borderBottom: '1px solid #F3F4F6', background: 'white',
                    cursor: 'pointer', fontSize: 13,
                  }}>
                  {c.name} <span style={{ color: '#9CA3AF' }}>({c.code})</span>
                </button>
              ))}
            </div>
            <button type="button"
              onClick={() => void applyCustomerRef(changeOp, customerRefTorba())}
              style={{
                ...solidBtn(C.online),
                width: '100%', padding: '10px', borderRadius: 8, marginBottom: 8, fontSize: 14,
              }}>
              Torba cari kullan (gönderimde ayarlardan çözülür)
            </button>
            <button type="button" onClick={() => setChangeOp(null)}
              style={{ width: '100%', padding: '8px', borderRadius: 8,
                border: '1px solid #E5E7EB', background: '#F9FAFB', cursor: 'pointer' }}>
              Vazgeç
            </button>
          </div>
        </div>
      )}

      <AlertDialog {...dialogProps} />
    </div>
  )
}

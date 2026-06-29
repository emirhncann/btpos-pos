import { useCallback, useEffect, useState } from 'react'
import AlertDialog from '../components/AlertDialog'
import { useAlertDialog } from '../hooks/useAlertDialog'

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
  pending:        { bg: '#FFF3E0', color: '#E65100', label: 'Bekliyor' },
  pending_dayend: { bg: '#F3E5F5', color: '#6A1B9A', label: 'Gün Sonu Bekliyor' },
  processing:     { bg: '#E3F2FD', color: '#1565C0', label: 'Gönderiliyor' },
  success:        { bg: '#E8F5E9', color: '#2E7D32', label: 'Gönderildi' },
  failed:         { bg: '#FFEBEE', color: '#C62828', label: 'Hata' },
  done:           { bg: '#F3F4F6', color: '#6B7280', label: 'Tamamlandı' },
}

type TypeFilter = 'all' | 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice' | 'payment'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatError(error: string): string {
  const trimmed = error.trim()
  if (trimmed.length <= 120) return trimmed
  return trimmed.slice(0, 117) + '…'
}

export function DocumentQueueScreen({
  companyId,
  onAfterEnqueue,
}: {
  companyId: string
  onAfterEnqueue?: () => void
}) {
  const [ops,          setOps]          = useState<OpRow[]>([])
  const [loading,      setLoading]      = useState(true)
  const [statusFilter, setStatusFilter] = useState<OpStatus | 'all'>('all')
  const [typeFilter,   setTypeFilter]   = useState<TypeFilter>('all')
  const [dateFrom,     setDateFrom]     = useState(todayStr())
  const [dateTo,       setDateTo]       = useState(todayStr())
  const [retrying,     setRetrying]     = useState<string | null>(null)
  const [sending,      setSending]      = useState(false)
  const { dialogProps, showError, showSuccess, confirm } = useAlertDialog()

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
    const opDate = op.createdAt?.slice(0, 10) ?? ''
    if (dateFrom && opDate < dateFrom) return false
    if (dateTo   && opDate > dateTo)   return false
    if (typeFilter !== 'all' && op.type !== typeFilter) return false
    return true
  })

  const filtered = dateTypeFiltered.filter(op =>
    statusFilter === 'all' || op.status === statusFilter,
  )

  const counts = {
    all:            dateTypeFiltered.length,
    pending:        dateTypeFiltered.filter(o => o.status === 'pending').length,
    pending_dayend: dateTypeFiltered.filter(o => o.status === 'pending_dayend').length,
    failed:         dateTypeFiltered.filter(o => o.status === 'failed').length,
    success:        dateTypeFiltered.filter(o => o.status === 'success').length,
  }

  const pendingReturns = ops.filter(o =>
    o.type === 'return_invoice' && o.status === 'pending_dayend',
  )

  const handleRetry = async (id: string) => {
    setRetrying(id)
    try {
      await window.electron.db.retryOperation(id)
      await reload()
    } finally {
      setRetrying(null)
    }
  }

  const handleRetryAll = async () => {
    const failed = ops.filter(o => o.status === 'failed')
    for (const op of failed) await window.electron.db.retryOperation(op.id)
    await reload()
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
          ['all',            'Tümü'],
          ['pending',        'Bekliyor'],
          ['pending_dayend', 'Gün Sonu Bekliyor'],
          ['failed',         'Hata'],
          ['success',        'Gönderildi'],
        ] as [OpStatus | 'all', string][]).map(([k, l]) => {
          const count = k === 'all' ? counts.all
            : counts[k as keyof typeof counts] ?? 0
          return (
            <button key={k} type="button" onClick={() => setStatusFilter(k)}
              style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12,
                fontWeight: 500, border: '1px solid', cursor: 'pointer',
                background: statusFilter === k ? '#1565C0' : 'white',
                color:      statusFilter === k ? 'white'   : '#374151',
                borderColor:statusFilter === k ? '#1565C0' : '#E5E7EB' }}>
              {l} {count > 0 && <span style={{ opacity: 0.8 }}>({count})</span>}
            </button>
          )
        })}
      </div>

      {pendingReturns.length > 0 && (
        <div style={{
          padding: '12px 16px', borderRadius: 10,
          background: '#F3E5F5', border: '1px solid #CE93D8',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#6A1B9A' }}>
              Bekleyen İadeler
            </div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>
              {pendingReturns.length} iade — toplu fatura olarak gönderilecek
            </div>
          </div>
          <button type="button"
            onClick={() => void handleSendBatchReturn()}
            disabled={sending}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: '#7B1FA2', color: 'white', fontWeight: 600,
              fontSize: 13, cursor: sending ? 'not-allowed' : 'pointer',
              opacity: sending ? 0.6 : 1,
            }}>
            {sending ? 'Gönderiliyor...' : 'Toplu İade Gönder'}
          </button>
        </div>
      )}

      {counts.failed > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: '#FFF3E0',
          border: '1px solid #FFCC02', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#E65100', fontWeight: 600 }}>
            ⚠️ {counts.failed} hatalı işlem var
          </span>
          <button type="button" onClick={() => void handleRetryAll()}
            style={{ background: '#E65100', color: 'white', border: 'none',
              borderRadius: 7, padding: '6px 14px', fontSize: 12,
              fontWeight: 600, cursor: 'pointer' }}>
            Tümünü Tekrar Gönder
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
          Yükleniyor...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>
          Bu filtrede işlem yok
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
                    {new Date(op.createdAt).toLocaleString('tr-TR')}
                    {op.sentAt && (
                      <span style={{ color: '#2E7D32' }}>
                        {' · ✓ '}{new Date(op.sentAt).toLocaleString('tr-TR')}
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
                  {ss.label}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {op.status === 'failed' && (
                    <button type="button"
                      onClick={() => void handleRetry(op.id)}
                      disabled={retrying === op.id}
                      style={{ background: '#EFF6FF', border: '1px solid #BFDBFE',
                        borderRadius: 7, padding: '5px 10px', fontSize: 11,
                        fontWeight: 600, color: '#1D4ED8', cursor: 'pointer',
                        opacity: retrying === op.id ? 0.5 : 1 }}>
                      {retrying === op.id ? '...' : '↺ Tekrar'}
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
      <AlertDialog {...dialogProps} />
    </div>
  )
}

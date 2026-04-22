import { useCallback, useEffect, useState } from 'react'

type OpStatus = 'pending' | 'processing' | 'success' | 'failed'

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
}

const STATUS_STYLE: Record<OpStatus, { bg: string; color: string; label: string }> = {
  pending:    { bg: '#FFF3E0', color: '#E65100', label: 'Bekliyor' },
  processing: { bg: '#E3F2FD', color: '#1565C0', label: 'Gönderiliyor' },
  success:    { bg: '#E8F5E9', color: '#2E7D32', label: 'Gönderildi' },
  failed:     { bg: '#FFEBEE', color: '#C62828', label: 'Hata' },
}

export function DocumentQueueScreen({ companyId }: { companyId: string }) {
  const [ops, setOps]       = useState<OpRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]    = useState<OpStatus | 'all'>('all')
  const [retrying, setRetrying]  = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const all = await window.electron.db.getAllOperations(companyId, 200)
      setOps(all as OpRow[])
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { void reload() }, [reload])

  const handleRetry = async (id: string) => {
    setRetrying(id)
    try {
      await window.electron.db.retryOperation(id)
      await reload()
    } finally {
      setRetrying(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return
    await window.electron.db.deleteOperation(id)
    await reload()
  }

  const filtered = filter === 'all' ? ops : ops.filter(o => o.status === filter)

  const counts = {
    all:        ops.length,
    pending:    ops.filter(o => o.status === 'pending').length,
    processing: ops.filter(o => o.status === 'processing').length,
    success:    ops.filter(o => o.status === 'success').length,
    failed:     ops.filter(o => o.status === 'failed').length,
  }

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Belge Aktarım</h2>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '4px 0 0' }}>
            Buluta gönderilecek / gönderilen işlemler
          </p>
        </div>
        <button type="button" onClick={() => void reload()}
          style={{ background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: 8,
            padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
          ↺ Yenile
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {([['all', 'Tümü'], ['pending', 'Bekliyor'], ['failed', 'Hata'], ['success', 'Gönderildi']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
              border: '1px solid', cursor: 'pointer',
              background: filter === k ? '#1565C0' : 'white',
              color:      filter === k ? 'white'   : '#374151',
              borderColor:filter === k ? '#1565C0' : '#E5E7EB' }}>
            {l} {counts[k] > 0 && <span style={{ opacity: 0.8 }}>({counts[k]})</span>}
          </button>
        ))}
      </div>

      {counts.failed > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#FFF3E0',
          border: '1px solid #FFCC02', borderRadius: 8, display: 'flex',
          alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#E65100' }}>
            {counts.failed} hatalı işlem var
          </span>
          <button type="button" onClick={async () => {
            const failed = ops.filter(o => o.status === 'failed')
            for (const op of failed) await window.electron.db.retryOperation(op.id)
            await reload()
          }} style={{ background: '#E65100', color: 'white', border: 'none',
            borderRadius: 7, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Tümünü Tekrar Gönder
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>Yükleniyor...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>
          {filter === 'all' ? 'Henüz işlem yok' : 'Bu durumda işlem yok'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(op => {
            const ss = STATUS_STYLE[op.status]
            return (
              <div key={op.id} style={{ background: 'white', border: '1px solid #E5E7EB',
                borderRadius: 10, padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 12 }}>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                    {op.label ?? TYPE_LABEL[op.type] ?? op.type}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                    {TYPE_LABEL[op.type]} · {new Date(op.createdAt).toLocaleString('tr-TR')}
                    {op.sentAt && ` · Gönderildi: ${new Date(op.sentAt).toLocaleString('tr-TR')}`}
                  </div>
                  {op.error && (
                    <div style={{ fontSize: 11, color: '#C62828', marginTop: 3,
                      background: '#FEF2F2', padding: '2px 8px', borderRadius: 4, display: 'inline-block' }}>
                      {op.error}
                    </div>
                  )}
                </div>

                {op.status === 'failed' && (
                  <div style={{ fontSize: 11, color: '#9CA3AF', flexShrink: 0 }}>
                    {op.attempts}/{op.maxAttempts} deneme
                  </div>
                )}

                <div style={{ background: ss.bg, color: ss.color, borderRadius: 6,
                  padding: '3px 10px', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                  {ss.label}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {op.status === 'failed' && (
                    <button type="button" onClick={() => void handleRetry(op.id)} disabled={retrying === op.id}
                      style={{ background: '#EFF6FF', border: '1px solid #BFDBFE',
                        borderRadius: 7, padding: '5px 10px', fontSize: 11,
                        fontWeight: 600, color: '#1D4ED8', cursor: 'pointer',
                        opacity: retrying === op.id ? 0.5 : 1 }}>
                      {retrying === op.id ? '...' : '↺ Tekrar'}
                    </button>
                  )}
                  {op.status === 'success' && (
                    <button type="button" onClick={() => void handleDelete(op.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        color: '#D1D5DB', fontSize: 16, padding: '0 4px' }}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

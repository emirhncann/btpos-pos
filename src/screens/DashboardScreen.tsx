import { useState, useEffect, useCallback } from 'react'
import AppLogo from '../components/AppLogo'

const CMD_LABELS: Record<string, string> = {
  sync_all:       'Tüm veriler güncellendi',
  sync_products:  'Ürünler güncellendi',
  sync_prices:    'Fiyatlar güncellendi',
  sync_plu:       'PLU grupları güncellendi',
  sync_cashiers:  'Kasiyerler güncellendi',
  sync_customers: 'Cariler güncellendi',
  sync_settings:  'Ayarlar güncellendi',
  logout:         'Kasiyer çıkışı yapıldı',
  message:        'Yönetici mesajı alındı',
  restart:        'Uygulama yeniden başlatıldı',
  lock:           'Kasa kilitlendi',
}

const CMD_COLORS: Record<string, { bg: string; icon: string }> = {
  sync_all:       { bg: '#E3F2FD', icon: '📦' },
  sync_products:  { bg: '#E3F2FD', icon: '🔄' },
  sync_prices:    { bg: '#E8F5E9', icon: '💰' },
  sync_plu:       { bg: '#FFF8E1', icon: '🏷️' },
  sync_cashiers:  { bg: '#F3E5F5', icon: '👤' },
  sync_customers: { bg: '#FBE9E7', icon: '🏢' },
  sync_settings:  { bg: '#F5F5F5', icon: '⚙️' },
  logout:         { bg: '#FFF3E0', icon: '🚪' },
  message:        { bg: '#E8F5E9', icon: '💬' },
  restart:        { bg: '#FFF8E1', icon: '🔁' },
  lock:           { bg: '#FFEBEE', icon: '🔒' },
}

interface Props {
  companyId:              string
  cashier:                CashierRow
  terminalId:             string
  onStartSale:            () => void
  onLogout:               () => void
  onShowMessage:          (text: string) => void
  onPluUpdated:           (groups: PluGroupCacheRow[]) => void
  onSettingsUpdated:      (s: PosSettingsRow) => void
  commandSyncing?:        boolean
  merkezToast?:           string | null
  cmdPollTick?:           number
  cartSettings:           CartSettings
  onCartSettingsChange?:  (s: CartSettings) => void | Promise<void>
}

interface DailySummary {
  saleCount:  number
  totalSales: number
  totalCash:  number
  totalCard:  number
}

export default function DashboardScreen({
  companyId, cashier,
  onStartSale, onLogout, onShowMessage,
  onPluUpdated: _onPluUpdated,
  onSettingsUpdated: _onSettingsUpdated,
  commandSyncing = false,
  merkezToast = null,
  cmdPollTick = 0,
  cartSettings,
  onCartSettingsChange,
}: Props) {
  void _onPluUpdated
  void _onSettingsUpdated
  const [summary, setSummary]       = useState<DailySummary>({ saleCount: 0, totalSales: 0, totalCash: 0, totalCard: 0 })
  const [time, setTime]             = useState(new Date())
  const [toast, setToast]           = useState<string | null>(null)
  const [cmdHistory, setCmdHistory] = useState<CommandHistoryRow[]>([])
  const [heldCount, setHeldCount]   = useState(0)
  const [showSettings, setShowSettings] = useState(false)

  const refreshCmdHistory = useCallback(() => {
    window.electron.db.getCommandHistory(10).then(setCmdHistory).catch(() => {})
  }, [])

  useEffect(() => {
    loadDailySummary()
    const tick = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    refreshCmdHistory()
    window.electron.db.getHeldDocuments(companyId)
      .then(docs => setHeldCount(docs.length))
      .catch(() => {})
  }, [companyId, refreshCmdHistory, cmdPollTick])

  async function loadDailySummary() {
    try {
      const today = new Date().toISOString().split('T')[0]
      const sales = await window.electron.db.getSales(
        today + 'T00:00:00',
        today + 'T23:59:59'
      )
      const totalSales = sales.reduce((s, r) => s + r.totalAmount, 0)
      const totalCash  = sales.filter(r => r.paymentType === 'cash').reduce((s, r) => s + r.totalAmount, 0)
      const totalCard  = sales.filter(r => r.paymentType === 'card').reduce((s, r) => s + r.totalAmount, 0)
      setSummary({ saleCount: sales.length, totalSales, totalCash, totalCard })
    } catch {}
  }

  const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F0F2F5' }}>

      {/* Header — kasiyer girişi ile aynı koyu tema */}
      <div style={{
        background: '#030712',
        borderBottom: '1px solid #1f2937',
        padding: '0 24px',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <AppLogo height={30} />
          <span style={{ color: '#9ca3af', fontSize: 13 }}>Hoş geldiniz</span>
        </div>
        <span style={{ color: '#9ca3af', fontSize: 13 }}>
          {time.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
          {' — '}
          <span style={{ fontWeight: 600, fontSize: 15, color: '#e5e7eb' }}>
            {time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </span>
      </div>

      {/* Ana içerik — butonlar + feed yan yana */}
      <div style={{ flex: 1, display: 'flex', gap: 32, alignItems: 'flex-start', justifyContent: 'center', padding: 40, flexWrap: 'wrap' }}>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, flex: '0 1 auto' }}>

        {/* Kasiyer kartı */}
        <div style={{ background: 'white', borderRadius: 16, padding: '24px 40px', textAlign: 'center', border: '1px solid #E0E0E0', minWidth: 320 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#E3F2FD', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 28, fontWeight: 600, color: '#1565C0' }}>
            {cashier.fullName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#212121' }}>{cashier.fullName}</div>
          <div style={{ fontSize: 13, color: '#9E9E9E', marginTop: 4 }}>
            Kod: {cashier.cashierCode} · {cashier.role === 'manager' ? 'Yönetici' : 'Kasiyer'}
          </div>
        </div>

        {/* Günlük özet */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 160px)', gap: 16 }}>
          {[
            { label: 'Satış Sayısı', value: String(summary.saleCount), unit: 'adet', color: '#1565C0', bg: '#E3F2FD' },
            { label: 'Günlük Ciro',  value: fmt(summary.totalSales),   unit: '₺',    color: '#2E7D32', bg: '#E8F5E9' },
            { label: 'Nakit',        value: fmt(summary.totalCash),    unit: '₺',    color: '#E65100', bg: '#FFF8E1' },
            { label: 'Kart',         value: fmt(summary.totalCard),    unit: '₺',    color: '#6A1B9A', bg: '#F3E5F5' },
          ].map(card => (
            <div key={card.label} style={{ background: card.bg, borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: card.color, marginBottom: 6, fontWeight: 500 }}>{card.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: card.color }}>{card.value}</div>
              <div style={{ fontSize: 11, color: card.color, marginTop: 2 }}>{card.unit}</div>
            </div>
          ))}
        </div>

        {/* Butonlar */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
              background: '#F3F4F6', border: '1px solid #E0E0E0',
              fontSize: 13, fontWeight: 500, color: '#374151',
            }}
          >
            ⚙ Ekran Ayarları
          </button>
          <button
            type="button"
            onClick={onStartSale}
            style={{ background: '#1565C0', color: 'white', border: 'none', borderRadius: 16, cursor: 'pointer', width: 280, height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 22, fontWeight: 600 }}
          >
            <span style={{ fontSize: 36 }}>🛒</span>
            <span>Satış Başlat</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            style={{ background: 'white', color: '#C62828', border: '1px solid #FFCDD2', borderRadius: 16, cursor: 'pointer', width: 160, height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}
          >
            <span style={{ fontSize: 28 }}>🚪</span>
            <span>Kasiyer Çıkışı</span>
          </button>
        </div>

        </div>

        {/* Sağ — aktivite feed */}
        <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0 }}>

          {heldCount > 0 && (
            <div style={{ background: '#F3E5F5', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 24 }}>⏸</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#6A1B9A' }}>{heldCount} Bekletilen Belge</div>
                <div style={{ fontSize: 11, color: '#9C27B0' }}>Satış ekranından getirilebilir</div>
              </div>
            </div>
          )}

          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #E0E0E0', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F0F0F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#212121' }}>Son Komutlar</span>
              <span style={{ fontSize: 10, color: '#9E9E9E' }}>Son {cmdHistory.length} işlem</span>
            </div>
            {cmdHistory.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#BDBDBD', fontSize: 12 }}>
                Henüz komut alınmadı
              </div>
            ) : (
              cmdHistory.map(cmd => (
                <div key={cmd.id} style={{ padding: '10px 16px', borderBottom: '1px solid #F9F9F9', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: CMD_COLORS[cmd.command]?.bg ?? '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                    {CMD_COLORS[cmd.command]?.icon ?? '📋'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#212121' }}>
                      {CMD_LABELS[cmd.command] ?? cmd.command}
                      {cmd.command === 'message' && cmd.payload.text != null && String(cmd.payload.text).length > 0 && (
                        <span style={{ fontWeight: 400, color: '#757575' }}>
                          {` — "${String(cmd.payload.text).slice(0, 30)}${String(cmd.payload.text).length > 30 ? '...' : ''}"`}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#9E9E9E', marginTop: 1 }}>
                      {new Date(cmd.receivedAt).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cmd.status === 'done' ? '#4CAF50' : '#F44336', flexShrink: 0 }} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showSettings && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'white', borderRadius: 14, width: 480,
            maxHeight: '85vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid #F0F0F0',
            }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#111' }}>Ekran Ayarları</div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 20, color: '#9E9E9E', lineHeight: 1,
                }}
              >✕</button>
            </div>
            <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10,
              }}>
                Sepet Meta Bilgileri
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
                {([
                  { key: 'showBarkod' as const, label: 'Barkod' },
                  { key: 'showBirim' as const, label: 'Birim' },
                  { key: 'showFiyat' as const, label: 'B.Fiyat' },
                  { key: 'showIskonto' as const, label: 'İndirim' },
                  { key: 'showKdv' as const, label: 'KDV%' },
                ] as const).map(t => (
                  <button
                    type="button"
                    key={t.key}
                    onClick={() => onCartSettingsChange?.({
                      ...cartSettings,
                      [t.key]: !cartSettings[t.key],
                    })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                      fontSize: 12, fontWeight: 500, border: '1px solid',
                      background: cartSettings[t.key] ? '#E3F2FD' : 'white',
                      borderColor: cartSettings[t.key] ? '#90CAF9' : '#E0E0E0',
                      color: cartSettings[t.key] ? '#1565C0' : '#9ca3af',
                    }}
                  >
                    <span style={{ fontSize: 11 }}>{cartSettings[t.key] ? '✓' : '○'}</span>
                    {t.label}
                  </button>
                ))}
              </div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10,
              }}>
                Font Boyutları
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  { key: 'fsUrunAdi' as const, label: 'Ürün adı', min: 11, max: 18 },
                  { key: 'fsUrunKod' as const, label: 'Barkod', min: 9, max: 14 },
                  { key: 'fsMiktar' as const, label: 'Miktar', min: 11, max: 18 },
                  { key: 'fsTutar' as const, label: 'Tutar', min: 11, max: 18 },
                  { key: 'fsTutarSub' as const, label: 'Tutar alt', min: 9, max: 13 },
                  { key: 'fsPill' as const, label: 'Pill metin', min: 9, max: 12 },
                ] as const).map(f => (
                  <div key={f.key} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 14px', borderRadius: 8,
                    background: '#F8F9FA', border: '1px solid #F0F0F0',
                  }}>
                    <span style={{ fontSize: 13, color: '#374151', minWidth: 80, flexShrink: 0 }}>
                      {f.label}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                      <button
                        type="button"
                        onClick={() => {
                          const v = Math.max(f.min, cartSettings[f.key] - 1)
                          void onCartSettingsChange?.({ ...cartSettings, [f.key]: v })
                        }}
                        disabled={cartSettings[f.key] <= f.min}
                        style={{
                          width: 28, height: 28, borderRadius: 6,
                          border: '1px solid #E0E0E0', background: 'white',
                          cursor: 'pointer', fontSize: 16, fontWeight: 500,
                          color: '#374151', display: 'flex', alignItems: 'center',
                          justifyContent: 'center',
                          opacity: cartSettings[f.key] <= f.min ? 0.3 : 1,
                        }}
                      >−</button>
                      <span style={{
                        fontSize: 14, fontWeight: 600, color: '#111',
                        minWidth: 36, textAlign: 'center',
                      }}>
                        {cartSettings[f.key]}px
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const v = Math.min(f.max, cartSettings[f.key] + 1)
                          void onCartSettingsChange?.({ ...cartSettings, [f.key]: v })
                        }}
                        disabled={cartSettings[f.key] >= f.max}
                        style={{
                          width: 28, height: 28, borderRadius: 6,
                          border: '1px solid #E0E0E0', background: 'white',
                          cursor: 'pointer', fontSize: 16, fontWeight: 500,
                          color: '#374151', display: 'flex', alignItems: 'center',
                          justifyContent: 'center',
                          opacity: cartSettings[f.key] >= f.max ? 0.3 : 1,
                        }}
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #F0F0F0' }}>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                style={{
                  width: '100%', padding: '11px', borderRadius: 9,
                  background: '#1565C0', color: 'white', border: 'none',
                  cursor: 'pointer', fontSize: 14, fontWeight: 600,
                }}
              >Tamam</button>
            </div>
          </div>
        </div>
      )}

      {(toast || merkezToast) && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#212121', color: 'white', padding: '10px 20px', borderRadius: 8, fontSize: 13, zIndex: 10000, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast ?? merkezToast}
        </div>
      )}
    </div>
  )
}

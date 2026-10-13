import { useState, useEffect, useCallback, useRef } from 'react'
import AppLogo from '../components/AppLogo'
import { sendPendingInvoices } from '../lib/invoiceSend'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import { scheduleProcessQueue, useQueueWorker } from '../hooks/useQueueWorker'
import { DocumentQueueScreen } from './DocumentQueueScreen'
import { SalesReportScreen } from './SalesReportScreen'
import PrinterSettingsPanel, { type PrinterDraft } from '../components/PrinterSettingsPanel'
import ScaleSettings, { type ScaleDraft } from '../components/ScaleSettings'
import PaymentDeviceSettingsPanel from '../components/PaymentDeviceSettingsPanel'
import DbLocationPanel from '../components/DbLocationPanel'
import LicenseSettingsPanel from '../components/LicenseSettingsPanel'
import UpdateSettingsPanel from '../components/UpdateSettingsPanel'
import { scheduleLocalSettingsBackup } from '../lib/localSettings'
import AlertDialog from '../components/AlertDialog'
import { useAlertDialog } from '../hooks/useAlertDialog'
import { C, solidBtn } from '../theme/colors'

const CMD_LABELS: Record<string, string> = {
  sync_all:       'Tüm veriler güncellendi',
  sync_products:  'Ürünler güncellendi',
  sync_prices:    'Fiyatlar güncellendi',
  sync_plu:       'PLU grupları güncellendi',
  sync_cashiers:  'Kasiyerler güncellendi',
  sync_customers: 'Cariler güncellendi',
  sync_settings:  'Ayarlar güncellendi',
  sync_templates: 'Fiş şablonları güncellendi',
  logout:         'Kasiyer çıkışı yapıldı',
  message:        'Yönetici mesajı alındı',
  restart:        'Uygulama yeniden başlatıldı',
  lock:           'Kasa kilitlendi',
}

const CMD_COLORS: Record<string, { bg: string; icon: string }> = {
  sync_all:       { bg: C.primary, icon: '📦' },
  sync_products:  { bg: C.primary, icon: '🔄' },
  sync_prices:    { bg: C.success, icon: '💰' },
  sync_plu:       { bg: C.warning, icon: '🏷️' },
  sync_cashiers:  { bg: C.online, icon: '👤' },
  sync_customers: { bg: C.meal, icon: '🏢' },
  sync_settings:  { bg: C.neutral, icon: '⚙️' },
  sync_templates: { bg: C.success, icon: '🧾' },
  logout:         { bg: C.warning, icon: '🚪' },
  message:        { bg: C.success, icon: '💬' },
  restart:        { bg: C.warning, icon: '🔁' },
  lock:           { bg: C.danger, icon: '🔒' },
}

interface Props {
  companyId:              string
  cashier:                CashierRow
  terminalId:             string
  onStartSale:            () => void
  onLogout:               () => void
  onShowMessage:          (text: string) => void
  onPluUpdated:           (groups: PluGroupCacheRow[]) => void
  onSettingsUpdated:      () => void
  commandSyncing?:        boolean
  merkezToast?:           string | null
  cmdPollTick?:           number
  cartSettings:           CartSettings
  onCartSettingsChange?:  (s: CartSettings) => void | Promise<void>
  cartActive?:            boolean
}

interface DailySummary {
  saleCount:  number
  totalSales: number
  totalCash:  number
  totalCard:  number
}

export default function DashboardScreen({
  companyId, cashier, terminalId,
  onStartSale, onLogout, onShowMessage,
  onPluUpdated: _onPluUpdated,
  onSettingsUpdated: _onSettingsUpdated,
  commandSyncing = false,
  merkezToast = null,
  cmdPollTick = 0,
  cartSettings,
  onCartSettingsChange,
  cartActive = false,
}: Props) {
  void _onPluUpdated
  void _onSettingsUpdated
  const [summary, setSummary]       = useState<DailySummary>({ saleCount: 0, totalSales: 0, totalCash: 0, totalCard: 0 })
  const [time, setTime]             = useState(new Date())
  const [toast, setToast]           = useState<string | null>(null)
  const [cmdHistory, setCmdHistory] = useState<CommandHistoryRow[]>([])
  const [heldCount, setHeldCount]   = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'screen' | 'payment' | 'device' | 'general' | 'update' | 'license'>('screen')
  const [generalUnlocked, setGeneralUnlocked] = useState(false)
  const titleTapRef = useRef({ count: 0, at: 0 })
  const [draftCart, setDraftCart] = useState<CartSettings>(cartSettings)
  const [printerDraft, setPrinterDraft] = useState<PrinterDraft | null>(null)
  const [scaleDraft, setScaleDraft] = useState<ScaleDraft | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const printerSnap = useRef<string | null>(null)
  const scaleSnap = useRef<string | null>(null)
  const cartSnap = useRef<string>(JSON.stringify(cartSettings))
  const [pavoDeviceInfo, setPavoDeviceInfo] = useState<{ ip: string; port: number } | null>(null)
  const [showQueue, setShowQueue] = useState(false)
  const [showSalesReport, setShowSalesReport] = useState(false)
  const [invoiceSending, setInvoiceSending] = useState(false)

  const isOnline = useConnectionStatus(30) === 'online'
  const { processQueue } = useQueueWorker({
    companyId,
    isOnline,
    onToast: () => {},
  })
  const { dialogProps, showError } = useAlertDialog()

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

  useEffect(() => {
    const cleanup = window.electron.app.onExitBlocked(({ heldCount }) => {
      showError(
        'Çıkış Engellendi',
        `${heldCount} bekleyen belgeniz var. Belgeleri tamamlayın veya getirip iptal edin.`,
      )
    })
    return cleanup
  }, [showError])

  useEffect(() => {
    if (!showSettings || settingsTab !== 'payment') return
    window.electron.db.getPaymentDeviceSettings('pavo')
      .then(device => {
        if (device?.ipAddress) {
          setPavoDeviceInfo({ ip: device.ipAddress, port: device.port ?? 9100 })
        } else {
          setPavoDeviceInfo(null)
        }
      })
      .catch(() => setPavoDeviceInfo(null))
  }, [showSettings, settingsTab])

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

  async function handleSendPendingInvoices() {
    if (invoiceSending) return
    setInvoiceSending(true)
    try {
      await sendPendingInvoices(companyId, { silent: false })
      scheduleProcessQueue(processQueue, 500, { includeDayEnd: true })
      await loadDailySummary()
      window.dispatchEvent(new Event('btpos-day-end-done'))
    } catch {
      showError('Hata', 'Fatura gönderimi başlatılamadı.')
    } finally {
      setInvoiceSending(false)
    }
  }

  const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const onPrinterDraft = useCallback((d: PrinterDraft) => {
    setPrinterDraft(d)
    if (printerSnap.current == null) printerSnap.current = JSON.stringify(d)
  }, [])

  const onScaleDraft = useCallback((d: ScaleDraft) => {
    setScaleDraft(d)
    if (scaleSnap.current == null) scaleSnap.current = JSON.stringify(d)
  }, [])

  const settingsDirty =
    (printerDraft != null && printerSnap.current != null && JSON.stringify(printerDraft) !== printerSnap.current)
    || (scaleDraft != null && scaleSnap.current != null && JSON.stringify(scaleDraft) !== scaleSnap.current)
    || JSON.stringify(draftCart) !== cartSnap.current

  function requestCloseSettings() {
    if (settingsDirty && !window.confirm('Kaydedilmemiş değişiklikler var. Yine de çıkılsın mı?')) return
    setShowSettings(false)
    setGeneralUnlocked(false)
    titleTapRef.current = { count: 0, at: 0 }
    if (settingsTab === 'general') setSettingsTab('screen')
  }

  function onSettingsTitleTap() {
    const now = Date.now()
    const prev = titleTapRef.current
    const count = now - prev.at > 2000 ? 1 : prev.count + 1
    titleTapRef.current = { count, at: now }
    if (count < 5) return
    titleTapRef.current = { count: 0, at: 0 }
    setGeneralUnlocked(true)
    setSettingsTab('general')
  }

  async function saveKasaSettings() {
    if (savingSettings) return
    setSavingSettings(true)
    try {
      if (printerDraft) {
        await window.electron.printer.saveSettings({
          printer_type: printerDraft.printerType,
          printer_name: printerDraft.printerName || null,
          printer_ip:   printerDraft.printerIp || null,
          printer_port: printerDraft.printerPort,
          paper_width:  printerDraft.paperWidth,
          is_active:    printerDraft.enabled,
        })
        printerSnap.current = JSON.stringify(printerDraft)
        await window.electron.printer.saveDocSettings({
          printer_name: printerDraft.documentPrinterName || null,
        })
      }
      if (scaleDraft) {
        await window.electron.scale.saveSettings({
          portPath: scaleDraft.portPath,
          baudRate: scaleDraft.baudRate,
          enabled:  scaleDraft.enabled,
        })
        if (scaleDraft.enabled && scaleDraft.portPath) {
          const r = await window.electron.scale.connect({
            portPath: scaleDraft.portPath,
            baudRate: scaleDraft.baudRate,
          })
          if (!r.success) {
            setToast(`Terazi bağlanamadı: ${r.error ?? 'bilinmiyor'}`)
          }
        } else {
          await window.electron.scale.disconnect()
        }
        scaleSnap.current = JSON.stringify(scaleDraft)
      }
      if (JSON.stringify(draftCart) !== cartSnap.current) {
        await onCartSettingsChange?.(draftCart)
        cartSnap.current = JSON.stringify(draftCart)
      }
      scheduleLocalSettingsBackup()
      setToast('Ayarlar kaydedildi')
      window.setTimeout(() => setToast(null), 2500)
    } catch (e) {
      setToast(String(e))
    } finally {
      setSavingSettings(false)
    }
  }

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
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 28, fontWeight: 700, color: '#FFFFFF' }}>
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
            { label: 'Satış Sayısı', value: String(summary.saleCount), unit: 'adet', color: C.primary },
            { label: 'Günlük Ciro',  value: fmt(summary.totalSales),   unit: '₺',    color: C.success },
            { label: 'Nakit',        value: fmt(summary.totalCash),    unit: '₺',    color: C.meal },
            { label: 'Kart',         value: fmt(summary.totalCard),    unit: '₺',    color: C.online },
          ].map(card => (
            <div key={card.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: `4px solid ${card.color}`, borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
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
            onClick={() => {
              printerSnap.current = null
              scaleSnap.current = null
              cartSnap.current = JSON.stringify(cartSettings)
              setPrinterDraft(null)
              setScaleDraft(null)
              setDraftCart(cartSettings)
              setSettingsTab('screen')
              setGeneralUnlocked(false)
              titleTapRef.current = { count: 0, at: 0 }
              setShowSettings(true)
            }}
            style={{
              ...solidBtn(C.neutral),
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 10, fontSize: 13,
            }}
          >
            ⚙ Kasa Ayarları
          </button>
          <button
            type="button"
            disabled={invoiceSending}
            onClick={() => void handleSendPendingInvoices()}
            style={{
              ...solidBtn(C.success, invoiceSending),
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 10, fontSize: 13,
              cursor: invoiceSending ? 'wait' : 'pointer',
            }}
            title="Bekleyen POS faturalarını ERP’ye gönderir (Z raporu / toplu)"
          >
            {invoiceSending ? '⏳ Gönderiliyor…' : '📄 Bekleyen faturalar'}
          </button>
          <button
            type="button"
            onClick={() => setShowQueue(true)}
            style={{
              ...solidBtn(C.primary),
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 10, fontSize: 13,
            }}
          >
            📤 Belge Aktarım
          </button>
          <button
            type="button"
            onClick={() => setShowSalesReport(true)}
            style={{
              ...solidBtn(C.online),
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 10, fontSize: 13,
            }}
          >
            📈 Belge Raporu
          </button>
          <button
            type="button"
            onClick={onStartSale}
            style={{ ...solidBtn(C.primary), borderRadius: 16, width: 280, height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 22 }}
          >
            <span style={{ fontSize: 36 }}>🛒</span>
            <span>Satış Başlat</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            style={{ ...solidBtn(C.danger), borderRadius: 16, width: 160, height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14 }}
          >
            <span style={{ fontSize: 28 }}>🚪</span>
            <span>Kasiyer Çıkışı</span>
          </button>
        </div>

        </div>

        {/* Sağ — aktivite feed */}
        <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0 }}>

          {heldCount > 0 && (
            <div style={{ background: C.online, borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 24 }}>⏸</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>{heldCount} Bekletilen Belge</div>
                <div style={{ fontSize: 11, color: '#FFFFFF' }}>Satış ekranından getirilebilir</div>
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

      {showQueue && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
          overflow: 'auto',
        }}>
          <div style={{
            background: 'white', borderRadius: 14, width: '100%', maxWidth: 840,
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderBottom: '1px solid #F0F0F0', flexShrink: 0,
            }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Belge Aktarım</span>
              <button
                type="button"
                onClick={() => setShowQueue(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9E9E9E' }}
              >✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <DocumentQueueScreen
                companyId={companyId}
                cashierRole={cashier.role}
                onAfterEnqueue={() => scheduleProcessQueue(processQueue, 500, { includeDayEnd: true })}
                onRetryTrigger={() => scheduleProcessQueue(processQueue, 300, { includeDayEnd: true })}
              />
            </div>
          </div>
        </div>
      )}

      {showSalesReport && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
          overflow: 'auto',
        }}>
          <div style={{
            background: 'white', borderRadius: 14, width: '100%', maxWidth: 900,
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderBottom: '1px solid #F0F0F0', flexShrink: 0,
            }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Belge Raporu</span>
              <button
                type="button"
                onClick={() => setShowSalesReport(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9E9E9E' }}
              >✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <SalesReportScreen companyId={companyId} />
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'white', borderRadius: 14, width: 720,
            maxHeight: '85vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid #F0F0F0',
            }}>
              <div
                role="button"
                tabIndex={0}
                onClick={onSettingsTitleTap}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSettingsTitleTap() }}
                style={{ fontSize: 16, fontWeight: 600, color: '#111', cursor: 'default', userSelect: 'none' }}
              >
                Kasa Ayarları
              </div>
              <button
                type="button"
                onClick={() => requestCloseSettings()}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 20, color: '#9E9E9E', lineHeight: 1,
                }}
              >✕</button>
            </div>
            <div style={{
              display: 'flex', gap: 4, padding: '10px 16px 0',
              borderBottom: '1px solid #F0F0F0',
            }}>
              {([
                ...(generalUnlocked ? [{ id: 'general' as const, label: 'Genel' }] : []),
                { id: 'screen' as const, label: 'Ekran' },
                { id: 'device' as const, label: 'Ödeme Cihazı' },
                { id: 'payment' as const, label: 'Ödeme & Yazıcı' },
                { id: 'license' as const, label: 'Lisans' },
                { id: 'update' as const, label: 'Güncelleme' },
              ]).map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSettingsTab(tab.id)}
                  style={{
                    ...(settingsTab === tab.id ? solidBtn(C.primary, false, true) : { background: 'transparent', color: C.textMuted, border: 'none', fontWeight: 400, cursor: 'pointer', boxShadow: 'none' }),
                    flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
              {settingsTab === 'general' && generalUnlocked && (
                <DbLocationPanel pathOnly />
              )}
              {settingsTab === 'license' && (
                <LicenseSettingsPanel />
              )}
              {settingsTab === 'update' && (
                <UpdateSettingsPanel companyId={companyId} cartActive={cartActive} />
              )}
              {settingsTab === 'device' && (
                <PaymentDeviceSettingsPanel
                  companyId={companyId}
                  terminalId={terminalId}
                  saleLocked={cartActive || heldCount > 0}
                />
              )}
              {settingsTab === 'payment' && (
                <div style={{
                  padding: '12px 16px', background: C.bg, borderRadius: 10,
                  border: `1px solid ${C.border}`, fontSize: 12, color: C.text, marginBottom: 16,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Pavo ödeme cihazı</div>
                  {pavoDeviceInfo
                    ? <>Yerel kayıt: {pavoDeviceInfo.ip}:{pavoDeviceInfo.port}. Düzenlemek için Ödeme Cihazı sekmesini kullanın.</>
                    : 'Henüz yok. Ödeme Cihazı sekmesinden IP, port ve seri no girin.'}
                </div>
              )}
              <div style={{ display: settingsTab === 'payment' ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
                <PrinterSettingsPanel onDraft={onPrinterDraft} />
                <ScaleSettings onDraft={onScaleDraft} />
              </div>
              {settingsTab === 'screen' && (<>
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
                    onClick={() => setDraftCart({
                      ...draftCart,
                      [t.key]: !draftCart[t.key],
                    })}
                    style={{
                      ...(draftCart[t.key] ? solidBtn(C.primary, false, true) : solidBtn(C.neutral)),
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 12px', borderRadius: 7, fontSize: 12,
                    }}
                  >
                    <span style={{ fontSize: 11 }}>{draftCart[t.key] ? '✓' : '○'}</span>
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
                          const v = Math.max(f.min, draftCart[f.key] - 1)
                          setDraftCart({ ...draftCart, [f.key]: v })
                        }}
                        disabled={draftCart[f.key] <= f.min}
                        style={{
                          width: 28, height: 28, borderRadius: 6,
                          border: '1px solid #E0E0E0', background: 'white',
                          cursor: 'pointer', fontSize: 16, fontWeight: 500,
                          color: '#374151', display: 'flex', alignItems: 'center',
                          justifyContent: 'center',
                          opacity: draftCart[f.key] <= f.min ? 0.3 : 1,
                        }}
                      >−</button>
                      <span style={{
                        fontSize: 14, fontWeight: 600, color: '#111',
                        minWidth: 36, textAlign: 'center',
                      }}>
                        {draftCart[f.key]}px
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const v = Math.min(f.max, draftCart[f.key] + 1)
                          setDraftCart({ ...draftCart, [f.key]: v })
                        }}
                        disabled={draftCart[f.key] >= f.max}
                        style={{
                          width: 28, height: 28, borderRadius: 6,
                          border: '1px solid #E0E0E0', background: 'white',
                          cursor: 'pointer', fontSize: 16, fontWeight: 500,
                          color: '#374151', display: 'flex', alignItems: 'center',
                          justifyContent: 'center',
                          opacity: draftCart[f.key] >= f.max ? 0.3 : 1,
                        }}
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>
              </>)}
            </div>
            {settingsTab !== 'device' && settingsTab !== 'general' && settingsTab !== 'update' && settingsTab !== 'license' && (
            <div style={{ padding: '12px 20px', borderTop: '1px solid #F0F0F0' }}>
              <button
                type="button"
                disabled={savingSettings}
                onClick={() => void saveKasaSettings()}
                style={{
                  width: '100%', padding: '11px', borderRadius: 9,
                  background: '#1565C0', color: 'white', border: 'none',
                  cursor: savingSettings ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600,
                  opacity: savingSettings ? 0.7 : 1,
                }}
              >{savingSettings ? 'Kaydediliyor…' : 'Kaydet'}</button>
            </div>
            )}
          </div>
        </div>
      )}

      {(toast || merkezToast) && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#212121', color: 'white', padding: '10px 20px', borderRadius: 8, fontSize: 13, zIndex: 10000, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          {toast ?? merkezToast}
        </div>
      )}
      <AlertDialog {...dialogProps} />
    </div>
  )
}

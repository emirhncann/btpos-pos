import { useState, useEffect, useCallback, useRef } from 'react'
import { nowLocalInput, periodBoundIso } from '../lib/cashReconciliation'
import { setPosBoot, type PosBoot } from '../lib/posBoot'
import { useSettings } from '../hooks/useSettings'
import { CashierHome, EMPTY_HOME_STATS, ManagerGate, type Gate, type HomeStats } from './CashierHome'
import { CommandsScreen } from './CommandsScreen'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import { scheduleProcessQueue, useQueueWorker } from '../hooks/useQueueWorker'
import { DocumentQueueScreen } from './DocumentQueueScreen'
import CashReconciliationScreen, { CashReconciliationHistory, countPavoPendingSales } from './CashReconciliationScreen'
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
import { isPosDefined } from '../services/pos/posReadiness'
import { getPosSnapshot, refreshPosReady, usePosReady } from '../store/posReady'

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

function istanbulDayStart(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find(p => p.type === 'year')?.value ?? '1970'
  const m = parts.find(p => p.type === 'month')?.value ?? '01'
  const d = parts.find(p => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}T00:00:00`
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
  void commandSyncing
  const [toast, setToast]           = useState<string | null>(null)
  const [heldCount, setHeldCount]   = useState(0)
  const [home, setHome]             = useState<HomeStats>(EMPTY_HOME_STATS)
  const homeKey = useRef('')
  const [appVersion, setAppVersion] = useState('')
  const [gate, setGate]             = useState<Gate | null>(null)
  const [amountsUntil, setAmountsUntil] = useState(0)
  const overlayWas = useRef(false)
  const terminal = useSettings().terminal
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
  const [showCommands, setShowCommands] = useState(false)
  const [showRecon, setShowRecon] = useState(false)
  const [showReconHistory, setShowReconHistory] = useState(false)
  const [pavoPendingCount, setPavoPendingCount] = useState(0)
  const [reconBlock, setReconBlock] = useState(false)

  const isOnline = useConnectionStatus(30) === 'online'
  const [statsTick, setStatsTick] = useState(0)
  const { processQueue } = useQueueWorker({
    companyId,
    isOnline,
    onToast: () => setStatsTick(n => n + 1),
  })
  const { dialogProps, showError, showInfo } = useAlertDialog()
  usePosReady()
  const posDefined = isPosDefined(getPosSnapshot())

  const loadHome = useCallback(async () => {
    try {
      const startIso = periodBoundIso(istanbulDayStart(), 'start')
      const endIso = periodBoundIso(nowLocalInput(), 'end')
      const [ops, lastSale, held, printer, docPrinter, scale, recons, snap] = await Promise.all([
        window.electron.db.getAllOperations(companyId, 500),
        window.electron.db.getLastSale(),
        window.electron.db.getHeldDocuments(companyId),
        window.electron.printer.getSettings().catch(() => null),
        window.electron.printer.getDocSettings().catch(() => null),
        window.electron.scale.getSettings().catch(() => null),
        window.electron.db.listCashReconciliations(terminalId),
        startIso && endIso
          ? window.electron.db.computeCashReconciliation({ companyId, terminalId, startIso, endIso, cashierId: null })
          : Promise.resolve(null),
      ])
      let pending = 0
      let failed = 0
      let lastSent: string | null = null
      for (const op of ops) {
        if (op.status === 'pending' || op.status === 'pending_dayend' || op.status === 'processing') pending += 1
        else if (op.status === 'failed') failed += 1
        if (op.status === 'success' && op.sentAt && (!lastSent || op.sentAt > lastSent)) lastSent = op.sentAt
      }
      const card = snap ? snap.cards.reduce((s, line) => s + line.system, 0) : 0
      const other = snap ? snap.others.reduce((s, line) => s + line.system, 0) : 0
      const cash = snap ? snap.cashSales - snap.cashRefunds : 0
      const next: HomeStats = {
        pending,
        failed,
        lastSent,
        lastReceipt: lastSale?.receiptNo ?? null,
        held: held.length,
        saleCount: snap?.saleCount ?? 0,
        cash,
        card,
        total: cash + card + other,
        printer: Boolean(
          (printer && printer.is_active !== 0 && printer.is_active !== false && (printer.printer_name || printer.printer_ip))
          || docPrinter?.printer_name,
        ),
        scale: Boolean(scale && Number(scale.enabled) === 1 && scale.port_path),
        lastReconAt: recons[0]?.lockedAt || recons[0]?.createdAt || null,
        lastReconDiff: recons[0] ? recons[0].totalDiff : null,
      }
      const key = JSON.stringify(next)
      if (key === homeKey.current) return
      homeKey.current = key
      setHome(next)
      setHeldCount(next.held)
    } catch { /* yerel okuma */ }
  }, [companyId, terminalId])

  useEffect(() => {
    void countPavoPendingSales().then(setPavoPendingCount).catch(() => setPavoPendingCount(0))
    void refreshPosReady()
    window.electron.update.getVersion().then(setAppVersion).catch(() => {})
  }, [])

  useEffect(() => { void loadHome() }, [loadHome, statsTick, cmdPollTick])

  useEffect(() => {
    const tick = setInterval(() => void loadHome(), 15_000)
    const onFocus = () => void loadHome()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(tick)
      window.removeEventListener('focus', onFocus)
    }
  }, [loadHome])

  useEffect(() => {
    const open = showQueue || showRecon || showReconHistory || showSalesReport || showCommands
    if (overlayWas.current && !open) void loadHome()
    overlayWas.current = open
  }, [showQueue, showRecon, showReconHistory, showSalesReport, showCommands, loadHome])

  useEffect(() => {
    if (!amountsUntil) return
    const wait = Math.max(0, amountsUntil - Date.now())
    const t = setTimeout(() => setAmountsUntil(0), wait)
    return () => clearTimeout(t)
  }, [amountsUntil])

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

  function handlePavoDayEnd() {
    showInfo(
      'Pavo Z raporu',
      'Z raporu Pavo cihazından alınır. ERP faturaları yönetim panelinden gönderilir.',
    )
  }

  const hideAmounts = useCallback(() => setAmountsUntil(0), [])

  function openSettingsPanel() {
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
  }

  function openRecon() {
    hideAmounts()
    void countPavoPendingSales().then(n => {
      setPavoPendingCount(n)
      if (n > 0) {
        setReconBlock(true)
        return
      }
      setReconBlock(false)
      setShowRecon(true)
    }).catch(() => setShowRecon(true))
  }

  function goSale(boot?: PosBoot) {
    hideAmounts()
    if (boot) setPosBoot(boot)
    onStartSale()
  }

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

  const keysEnabled = !showSettings && !showQueue && !showRecon && !showReconHistory && !showSalesReport && !showCommands && !reconBlock && gate == null

  return (
    <>
      <CashierHome
        cashier={cashier}
        workplaceName={terminal.terminalInfo.workplace?.name ?? ''}
        terminalNumber={terminal.terminalInfo.terminalNumber ?? ''}
        appVersion={appVersion}
        isOnline={isOnline}
        posDefined={posDefined}
        stats={home}
        amountsVisible={amountsUntil > Date.now()}
        reconOpen={showRecon}
        keysEnabled={keysEnabled}
        onSale={goSale}
        onLogout={() => { hideAmounts(); onLogout() }}
        onQueue={() => setShowQueue(true)}
        onReport={() => setShowSalesReport(true)}
        onAskSettings={() => setGate('settings')}
        onRecon={openRecon}
        onReconHistory={() => setShowReconHistory(true)}
        onDayEnd={handlePavoDayEnd}
        onReveal={() => setGate('amounts')}
        onHideAmounts={hideAmounts}
        onCommands={() => setShowCommands(true)}
        commandTick={cmdPollTick}
      />
      {showCommands && (
        <CommandsScreen isOnline={isOnline} onClose={() => setShowCommands(false)} />
      )}
      {gate && (
        <ManagerGate
          title={gate === 'settings' ? 'Kasa ayarları için yetkili şifresi' : 'Tutarları görmek için yetkili şifresi'}
          onCancel={() => setGate(null)}
          onOk={() => {
            const which = gate
            setGate(null)
            if (which === 'settings') openSettingsPanel()
            else setAmountsUntil(Date.now() + 30_000)
          }}
        />
      )}


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

      {reconBlock && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--pos-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--pos-surface)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 16, padding: 20, maxWidth: 420 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Askıda satış var, önce tamamlayın</div>
            <button type="button" onClick={() => setReconBlock(false)} style={{ background: 'var(--pos-primary)', color: 'var(--pos-primary-text)', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>Tamam</button>
          </div>
        </div>
      )}

      {showRecon && (
        <CashReconciliationScreen
          companyId={companyId}
          terminalId={terminalId}
          cashier={cashier}
          onClose={() => setShowRecon(false)}
          onQueued={() => scheduleProcessQueue(processQueue)}
        />
      )}

      {showReconHistory && (
        <CashReconciliationHistory
          terminalId={terminalId}
          cashierId={cashier.id}
          onClose={() => setShowReconHistory(false)}
        />
      )}

      {showSalesReport && (
        <SalesReportScreen
          companyId={companyId}
          onClose={() => setShowSalesReport(false)}
          onOpenHeld={() => { setShowSalesReport(false); goSale({ held: true }) }}
        />
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
                <>
                  <DbLocationPanel pathOnly />
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16, fontSize: 13, color: 'var(--pos-text, #111)' }}>
                    Ekran klavyesi
                    <select
                      defaultValue={typeof localStorage !== 'undefined' ? (localStorage.getItem('btpos.screenKeyboard') || 'auto') : 'auto'}
                      onChange={e => {
                        localStorage.setItem('btpos.screenKeyboard', e.target.value)
                        window.dispatchEvent(new Event('btpos-keyboard-mode'))
                      }}
                      style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #E5E7EB' }}
                    >
                      <option value="auto">Otomatik</option>
                      <option value="always">Her zaman</option>
                      <option value="off">Kapalı</option>
                    </select>
                  </label>
                </>
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
    </>
  )
}

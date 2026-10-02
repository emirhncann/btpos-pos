import { useEffect, useState, useCallback, useMemo } from 'react'
import ActivationScreen   from './screens/ActivationScreen'
import CashierLoginScreen from './screens/CashierLoginScreen'
import DashboardScreen    from './screens/DashboardScreen'
import POSScreen          from './screens/POSScreen'
import CustomerDisplayScreen from './screens/CustomerDisplayScreen'
import AppLogo            from './components/AppLogo'
import SplashScreen       from './screens/SplashScreen'
import { useCommandPoller } from './hooks/useCommandPoller'
import { useConnectionStatus } from './hooks/useConnectionStatus'
import { buildMerkezCommandHandlers, noopCommandHandlers } from './hooks/merkezCommandHandlers'
import { sendPendingInvoices } from './lib/invoiceSend'
import { useQueueWorker, scheduleProcessQueue } from './hooks/useQueueWorker'
import { useGlobalClickSound } from './hooks/useGlobalClickSound'
import RestoreScreen from './screens/RestoreScreen'
import InitialSyncScreen from './components/InitialSyncScreen'
import UpdateBanner from './components/UpdateBanner'
import { publishLocalPavoIfCloudEmpty, scheduleLocalSettingsBackup } from './lib/localSettings'
import { maybeRunScheduledUpdate, reportAppVersion } from './lib/appUpdate'
import { reloadSettings, setActiveCashierId, useSettings } from './hooks/useSettings'

type AppState = 'loading' | 'activation' | 'restore' | 'initial_sync' | 'cashier_login' | 'dashboard' | 'pos'

const DEFAULT_CART_SETTINGS: CartSettings = {
  showBarkod: false,
  showBirim: false,
  showKdv: true,
  showFiyat: true,
  showIskonto: false,
  fsUrunAdi: 13,
  fsUrunKod: 10,
  fsMiktar: 13,
  fsTutar: 13,
  fsTutarSub: 10,
  fsPill: 10,
}

export default function App() {
  const isCustomerDisplay = new URLSearchParams(window.location.search).get('screen') === 'customer'
  if (isCustomerDisplay) {
    return <CustomerDisplayScreen />
  }

  const [state, setState]               = useState<AppState>('loading')
  const [companyId, setCompanyId]       = useState<string | null>(null)
  const [terminalId, setTerminalId]     = useState<string | null>(null)
  const [cashier, setCashier]           = useState<CashierRow | null>(null)
  const [allProducts, setAllProducts]   = useState<ProductRow[]>([])
  const [pluGroups, setPluGroups]       = useState<PluGroupCacheRow[]>([])
  const [syncedEnabledBrands, setSyncedEnabledBrands] = useState<PaymentProviderBrand[] | null>(null)
  const [syncedBarcodeFormats, setSyncedBarcodeFormats] = useState<BarcodeFormatRow[] | null>(null)
  const settings = useSettings()
  const [popupMessage, setPopupMessage] = useState<string | null>(null)
  const [terminalLocked, setTerminalLocked] = useState(false)
  const [terminalLockReason, setTerminalLockReason] = useState<string | null>(null)
  const [merkezToast, setMerkezToast]   = useState<string | null>(null)
  const [commandSyncing, setCommandSyncing] = useState(false)
  const [cmdPollTick, setCmdPollTick]   = useState(0)
  const [showCommandIndicator, setShowCommandIndicator] = useState(false)
  const [hasDeferredCommand, setHasDeferredCommand] = useState(false)
  const [cartActive, setCartActive]     = useState(false)
  const [cartSettings, setCartSettings] = useState<CartSettings>(DEFAULT_CART_SETTINGS)
  const [showSplash, setShowSplash]     = useState(true)
  const isOnline = useConnectionStatus(30) === 'online'
  const { processQueue } = useQueueWorker({
    companyId: companyId ?? '',
    isOnline:  Boolean(companyId) && isOnline,
    onToast:   () => {},
  })

  useGlobalClickSound()

  const showMerkezToast = useCallback((msg: string) => {
    setMerkezToast(msg)
    setTimeout(() => setMerkezToast(null), 3000)
  }, [])

  const showPopupMessage = useCallback((text: string) => {
    setPopupMessage(text)
  }, [])

  useEffect(() => {
    if (state === 'pos' || state === 'cashier_login') return

    window.__btpos_exit_check = async () => {
      const allowExit = settings.cashier.allowExitWithHeldDocs
      if (allowExit) return { canExit: true, heldCount: 0 }
      if (!companyId) return { canExit: true, heldCount: 0 }

      const docs = await window.electron.db.getHeldDocuments(companyId).catch(() => [])
      if (docs.length > 0) {
        return { canExit: false, heldCount: docs.length }
      }
      return { canExit: true, heldCount: 0 }
    }

    return () => {
      delete window.__btpos_exit_check
    }
  }, [state, settings.cashier.allowExitWithHeldDocs, companyId])

  const handleLogout = useCallback(() => {
    setCashier(null)
    setAllProducts([])
    setPluGroups([])
    setCartActive(false)
    setTerminalLocked(false)
    setTerminalLockReason(null)
    setMerkezToast(null)
    setCommandSyncing(false)
    setHasDeferredCommand(false)
    setActiveCashierId(null)
    setState('cashier_login')
  }, [])

  const merkezHandlers = useMemo(() => {
    if (!companyId || !terminalId) return noopCommandHandlers
    return buildMerkezCommandHandlers({
      companyId,
      terminalId,
      getCashierId: () => cashier?.id ?? null,
      setCommandSyncing,
      onLogout: handleLogout,
      onShowMessage: showPopupMessage,
      onSettingsUpdated: () => { void reloadSettings() },
      onLock: (reason) => {
        setTerminalLocked(true)
        setTerminalLockReason(reason ?? null)
      },
      showToast: showMerkezToast,
      onPluUpdated: setPluGroups,
      onEnabledBrandsUpdated: setSyncedEnabledBrands,
      onBarcodeFormatsUpdated: setSyncedBarcodeFormats,
      onAdminUpdate: () => window.dispatchEvent(new Event('btpos-admin-update')),
    })
  }, [
    companyId,
    terminalId,
    cashier,
    handleLogout,
    showMerkezToast,
    showPopupMessage,
    setPluGroups,
  ])

  const pollTerminalId =
    (state === 'dashboard' || state === 'pos') && terminalId && companyId ? terminalId : null

  const { pollNow, isPolling: commandPolling } = useCommandPoller(pollTerminalId, merkezHandlers, {
    onCommandPersisted: () => {
      setCmdPollTick(t => t + 1)
      setHasDeferredCommand(false)
    },
    onCommandDeferred: () => setHasDeferredCommand(true),
    isCartActive: () => cartActive,
  })

  useEffect(() => { checkActivation() }, [])

  useEffect(() => {
    if (!companyId || !terminalId) return
    void reportAppVersion()
  }, [companyId, terminalId])

  useEffect(() => {
    if (!companyId || !terminalId) return
    const off = window.electron.update.onRunScheduled(() => {
      void maybeRunScheduledUpdate({ cartActive }).catch(() => {})
    })
    const onDayEnd = () => {
      void maybeRunScheduledUpdate({ cartActive }).catch(() => {})
    }
    window.addEventListener('btpos-day-end-done', onDayEnd)
    return () => {
      off()
      window.removeEventListener('btpos-day-end-done', onDayEnd)
    }
  }, [companyId, terminalId, cartActive])

  useEffect(() => {
    if (!isOnline || !companyId) return
    window.electron.db.getPendingInvoices()
      .then(async pending => {
        if (pending.length > 0) {
          await sendPendingInvoices(companyId, { silent: true })
          scheduleProcessQueue(processQueue, 500, { includeDayEnd: true })
        }
      })
      .catch(() => {})
  }, [isOnline, companyId, processQueue])

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 5000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (cmdPollTick <= 0) return
    setShowCommandIndicator(true)
    const timer = setTimeout(() => setShowCommandIndicator(false), 5000)
    return () => clearTimeout(timer)
  }, [cmdPollTick])

  useEffect(() => {
    if (!pollTerminalId) setHasDeferredCommand(false)
  }, [pollTerminalId])

  useEffect(() => {
    if (showSplash) return
    void window.electron.display.apply(settings.terminal.customerDisplay).catch(() => {})
    if (!settings.terminal.customerDisplay || state !== 'dashboard') return
    const payload: SecondScreenPayload = {
      mode: 'cart_and_btpos_gif',
      items: [],
      discounts: [],
      totals: { subtotal: 0, discountTotal: 0, grandTotal: 0, totalQty: 0 },
      branding: { btposGif: 'logo.gif' },
      updatedAt: new Date().toISOString(),
    }
    void window.electron.secondScreen.update(payload).catch(() => {})
  }, [state, showSplash, settings.terminal.customerDisplay])

  async function checkActivation() {
    const activated        = await window.electron.store.get('activated')
    const storedCompanyId  = await window.electron.store.get('company_id') as string | null
    const storedTerminalId = await window.electron.store.get('terminal_id') as string | null

    if (activated && storedCompanyId) {
      setCompanyId(storedCompanyId)
      setTerminalId(storedTerminalId)
      void reloadSettings()
      window.electron.store.getCartSettings().then(setCartSettings).catch(() => {})
      setState('cashier_login')
      if (storedTerminalId) {
        void publishLocalPavoIfCloudEmpty(storedCompanyId, storedTerminalId)
      }
    } else {
      setState('activation')
    }
  }

  async function handleActivated(cId: string, hasHistory: boolean) {
    setCompanyId(cId)
    const tid = await window.electron.store.get('terminal_id') as string | null
    setTerminalId(tid)
    window.electron.store.getCartSettings().then(setCartSettings).catch(() => {})
    setState(hasHistory ? 'restore' : 'initial_sync')
  }

  async function handleCashierLogin(c: CashierRow, groups: PluGroupCacheRow[]) {
    setCashier(c)
    setPluGroups(groups)
    setActiveCashierId(c.id)
    setState('dashboard')
  }

  function handleStartSale() {
    window.electron.db.getProducts().then(async p => {
      setAllProducts(p)
      if (cashier?.id) setActiveCashierId(cashier.id)
      // PLU'yu da cashierId ile tazele
      if (companyId && cashier) {
        const wpRaw = await window.electron.store.get('workplace_id').catch(() => null)
        const workplaceId = (typeof wpRaw === 'string' && wpRaw) ? wpRaw : undefined
        const cashierIdForPlu = cashier.id
        window.electron.db.getPluGroups(companyId, workplaceId, cashierIdForPlu)
          .then(groups => { if (groups.length > 0) setPluGroups(groups) })
          .catch(() => {})
      }
      setState('pos')
    })
  }

  if (showSplash) return <SplashScreen />

  if (state === 'loading') return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#F0F2F5', gap: 16 }}>
      <AppLogo height={56} />
      <div style={{ color: '#9E9E9E', fontSize: 16 }}>BTPOS Yükleniyor...</div>
    </div>
  )

  if (state === 'activation')
    return <ActivationScreen onActivated={handleActivated} />

  if (state === 'initial_sync' && companyId && terminalId)
    return (
      <InitialSyncScreen
        companyId={companyId}
        terminalId={terminalId}
        onSettings={() => { void reloadSettings() }}
        onDone={() => setState('cashier_login')}
      />
    )

  if (state === 'restore' && companyId && terminalId)
    return (
      <RestoreScreen
        companyId={companyId}
        terminalId={terminalId}
        onSettings={() => { void reloadSettings() }}
        onDone={() => setState('cashier_login')}
      />
    )

  if (state === 'cashier_login')
    return (
      <CashierLoginScreen
        companyId={companyId!}
        terminalId={terminalId!}
        onLogin={handleCashierLogin}
      />
    )

  if (terminalLocked && cashier && (state === 'dashboard' || state === 'pos')) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1A237E', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <div style={{ fontSize: 64 }}>🔒</div>
        <div style={{ color: 'white', fontSize: 24, fontWeight: 600 }}>Kasa Kilitli</div>
        {terminalLockReason && <div style={{ color: '#90CAF9', fontSize: 15 }}>{terminalLockReason}</div>}
        <div style={{ color: '#5C6BC0', fontSize: 13, marginTop: 8 }}>Yöneticinizle iletişime geçin</div>
      </div>
    )
  }

  const commandListenerActive = Boolean(pollTerminalId)

  if (state === 'dashboard')
    return (
      <>
      <DashboardScreen
        companyId={companyId!}
        cashier={cashier!}
        terminalId={terminalId!}
        onStartSale={handleStartSale}
        onLogout={handleLogout}
        onShowMessage={showPopupMessage}
        onPluUpdated={setPluGroups}
        onSettingsUpdated={() => { void reloadSettings() }}
        commandSyncing={commandSyncing}
        merkezToast={merkezToast}
        cmdPollTick={cmdPollTick}
        cartSettings={cartSettings}
        onCartSettingsChange={async s => {
          setCartSettings(s)
          await window.electron.store.setCartSettings(s)
          scheduleLocalSettingsBackup()
        }}
        cartActive={cartActive}
      />
      <UpdateBanner cartActive={cartActive} />
      </>
    )

  return (
    <>
    <POSScreen
      companyId={companyId!}
      cashier={cashier!}
      allProducts={allProducts}
      pluGroups={pluGroups}
      syncedEnabledBrands={syncedEnabledBrands}
      syncedBarcodeFormats={syncedBarcodeFormats}
      onBack={() => {
        setCartActive(false)
        setState('dashboard')
      }}
      onLogout={handleLogout}
      pendingMessage={popupMessage ? { text: popupMessage } : null}
      onMessageClose={() => setPopupMessage(null)}
      merkezToast={merkezToast}
      onCartChange={setCartActive}
      cartSettings={cartSettings}
      commandListenerActive={commandListenerActive}
      commandSyncing={commandSyncing}
      commandPolling={commandPolling}
      onPollCommands={pollNow}
      commandRecentlyReceived={showCommandIndicator}
      commandDeferred={hasDeferredCommand}
    />
    <UpdateBanner cartActive={cartActive} />
    </>
  )
}

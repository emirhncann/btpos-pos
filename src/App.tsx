import { useEffect, useState, useCallback, useMemo } from 'react'
import ActivationScreen   from './screens/ActivationScreen'
import CashierLoginScreen from './screens/CashierLoginScreen'
import DashboardScreen    from './screens/DashboardScreen'
import POSScreen          from './screens/POSScreen'
import AppLogo            from './components/AppLogo'
import SplashScreen       from './screens/SplashScreen'
import { useCommandPoller } from './hooks/useCommandPoller'
import { buildMerkezCommandHandlers, noopCommandHandlers } from './hooks/merkezCommandHandlers'
import { api } from './lib/api'

type AppState = 'loading' | 'activation' | 'cashier_login' | 'dashboard' | 'pos'

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
  const [state, setState]               = useState<AppState>('loading')
  const [companyId, setCompanyId]       = useState<string | null>(null)
  const [terminalId, setTerminalId]     = useState<string | null>(null)
  const [cashier, setCashier]           = useState<CashierRow | null>(null)
  const [allProducts, setAllProducts]   = useState<ProductRow[]>([])
  const [pluGroups, setPluGroups]       = useState<PluGroupCacheRow[]>([])
  const [posSettings, setPosSettings]   = useState<PosSettingsRow>({
    showPrice: true, showCode: true, showBarcode: false,
    duplicateItemAction: 'increase_qty',
    minQtyPerLine: 1,
    allowLineDiscount: true,
    allowDocDiscount: true,
    maxLineDiscountPct: 100,
    maxDocDiscountPct: 100,
    pluCols: 4,
    pluRows: 3,
    fontSizeName: 12,
    fontSizePrice: 13,
    fontSizeCode: 9,
    source: 'default',
    pluMode: 'terminal',
    loginWithCode: true,
    loginWithCard: false,
  })
  const [terminalSettings, setTerminalSettings] = useState<PosSettingsRow>({
    showPrice: true, showCode: true, showBarcode: false,
    duplicateItemAction: 'increase_qty',
    minQtyPerLine: 1,
    allowLineDiscount: true,
    allowDocDiscount: true,
    maxLineDiscountPct: 100,
    maxDocDiscountPct: 100,
    pluCols: 4,
    pluRows: 3,
    fontSizeName: 12,
    fontSizePrice: 13,
    fontSizeCode: 9,
    source: 'default',
    pluMode: 'terminal',
    loginWithCode: true,
    loginWithCard: false,
  })
  const [popupMessage, setPopupMessage] = useState<string | null>(null)
  const [terminalLocked, setTerminalLocked] = useState(false)
  const [terminalLockReason, setTerminalLockReason] = useState<string | null>(null)
  const [merkezToast, setMerkezToast]   = useState<string | null>(null)
  const [commandSyncing, setCommandSyncing] = useState(false)
  const [cmdPollTick, setCmdPollTick]   = useState(0)
  const [cartActive, setCartActive]     = useState(false)
  const [cartSettings, setCartSettings] = useState<CartSettings>(DEFAULT_CART_SETTINGS)
  const [showSplash, setShowSplash]     = useState(true)

  const showMerkezToast = useCallback((msg: string) => {
    setMerkezToast(msg)
    setTimeout(() => setMerkezToast(null), 3000)
  }, [])

  const showPopupMessage = useCallback((text: string) => {
    setPopupMessage(text)
  }, [])

  const handleLogout = useCallback(() => {
    setCashier(null)
    setAllProducts([])
    setPluGroups([])
    setCartActive(false)
    setTerminalLocked(false)
    setTerminalLockReason(null)
    setMerkezToast(null)
    setCommandSyncing(false)
    // posSettings'i kasa default'una sıfırla — stale pluMode bir sonraki kasiyeri etkilemesin
    window.electron.db.getPosSettings().then(s => {
      setPosSettings(s)
    }).catch(() => {})
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
      onSettingsUpdated: setPosSettings,
      onLock: (reason) => {
        setTerminalLocked(true)
        setTerminalLockReason(reason ?? null)
      },
      showToast: showMerkezToast,
      onPluUpdated: setPluGroups,
    })
  }, [
    companyId,
    terminalId,
    cashier,
    handleLogout,
    showMerkezToast,
    showPopupMessage,
    setPluGroups,
    setPosSettings,
  ])

  const pollTerminalId =
    (state === 'dashboard' || state === 'pos') && terminalId && companyId ? terminalId : null

  useCommandPoller(pollTerminalId, merkezHandlers, {
    onCommandPersisted: () => setCmdPollTick(t => t + 1),
    isCartActive: () => cartActive,
  })

  useEffect(() => { checkActivation() }, [])

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 3500)
    return () => clearTimeout(timer)
  }, [])

  async function checkActivation() {
    const activated        = await window.electron.store.get('activated')
    const storedCompanyId  = await window.electron.store.get('company_id') as string | null
    const storedTerminalId = await window.electron.store.get('terminal_id') as string | null

    if (activated && storedCompanyId) {
      setCompanyId(storedCompanyId)
      setTerminalId(storedTerminalId)
      window.electron.db.getPosSettings().then(s => {
        setPosSettings(s)
        setTerminalSettings(s)
      }).catch(() => {})
      window.electron.store.getCartSettings().then(setCartSettings).catch(() => {})
      setState('cashier_login')
    } else {
      setState('activation')
    }
  }

  async function handleActivated(cId: string) {
    setCompanyId(cId)
    const tid = await window.electron.store.get('terminal_id') as string | null
    setTerminalId(tid)
    window.electron.store.getCartSettings().then(setCartSettings).catch(() => {})

    // Aktivasyon sonrası tek seferlik kasiyer çekimi
    try {
      const cashiers = await api.getCashiers(cId)
      await window.electron.db.syncCashiersAcid(cashiers, cId, 'full')
    } catch {
      // Başarısız olursa sorun değil — sync_cashiers komutuyla gelecek
    }

    try {
      const s = await window.electron.db.getPosSettings()
      setPosSettings(s)
      setTerminalSettings(s)
    } catch {
      /* mevcut default değerler kalır */
    }

    setState('cashier_login')
  }

  async function handleCashierLogin(c: CashierRow) {
    setCashier(c)
    if (companyId) {
      const wpRaw       = await window.electron.store.get('workplace_id').catch(() => null)
      const workplaceId = (typeof wpRaw === 'string' && wpRaw) ? wpRaw : undefined

      // 1. Settings — SQLite'tan oku (API'ye gitme)
      try {
        const cached = await window.electron.db.getPosSettings(c.id)
        setPosSettings(cached)
      } catch { /* mevcut state kalır */ }

      // 2. PLU — SQLite'tan oku (API'ye gitme)
      // cashierId'yi posSettings.pluMode'dan belirle
      // Not: getPosSettings sonrası fresh state henüz React'a yansımadı
      // Bu yüzden direkt db'den oku
      try {
        const fresh = await window.electron.db.getPosSettings(c.id)
        // pluMode=cashier -> o kasiyerin PLU'su, terminal -> terminal bazlı (null)
        const cashierIdForPlu = fresh.pluMode === 'cashier' ? c.id : null
        const cached = await window.electron.db.getPluGroups(
          companyId,
          workplaceId ?? null,
          cashierIdForPlu,
        )
        if (cached.length > 0) {
          setPluGroups(cached)
        } else {
          // Kasiyer bazlı PLU yoksa terminal/işyeri fallback'i tekrar dene
          const fallback = await window.electron.db.getPluGroups(
            companyId,
            workplaceId ?? null,
            null,
          )
          if (fallback.length > 0) setPluGroups(fallback)
        }
      } catch { /* PLU boş kalır, sync_plu komutu ile gelecek */ }
    }
    setState('dashboard')
  }

  function handleStartSale() {
    window.electron.db.getProducts().then(async p => {
      setAllProducts(p)
      let fresh: PosSettingsRow | undefined
      try {
        // Kasiyer bazlı settings oku
        fresh = await window.electron.db.getPosSettings(cashier?.id)
        setPosSettings(fresh)
      } catch {
        /* SQLite okunamazsa mevcut state kalır */
      }
      // PLU'yu da cashierId ile tazele
      if (companyId && cashier) {
        const wpRaw = await window.electron.store.get('workplace_id').catch(() => null)
        const workplaceId = (typeof wpRaw === 'string' && wpRaw) ? wpRaw : undefined
        const cashierIdForPlu = fresh?.pluMode === 'cashier' ? cashier.id : null
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

  if (state === 'cashier_login')
    return <CashierLoginScreen companyId={companyId!} posSettings={terminalSettings} onLogin={handleCashierLogin} />

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

  if (state === 'dashboard')
    return (
      <DashboardScreen
        companyId={companyId!}
        cashier={cashier!}
        terminalId={terminalId!}
        onStartSale={handleStartSale}
        onLogout={handleLogout}
        onShowMessage={showPopupMessage}
        onPluUpdated={setPluGroups}
        onSettingsUpdated={setPosSettings}
        commandSyncing={commandSyncing}
        merkezToast={merkezToast}
        cmdPollTick={cmdPollTick}
        cartSettings={cartSettings}
        onCartSettingsChange={async s => {
          setCartSettings(s)
          await window.electron.store.setCartSettings(s)
        }}
      />
    )

  return (
    <POSScreen
      companyId={companyId!}
      cashier={cashier!}
      allProducts={allProducts}
      pluGroups={pluGroups}
      posSettings={posSettings}
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
    />
  )
}

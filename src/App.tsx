import { useEffect, useState, useMemo, useCallback } from 'react'
import ActivationScreen   from './screens/ActivationScreen'
import CashierLoginScreen from './screens/CashierLoginScreen'
import DashboardScreen    from './screens/DashboardScreen'
import POSScreen          from './screens/POSScreen'
import { useCommandPoller } from './hooks/useCommandPoller'
import { buildMerkezCommandHandlers, noopCommandHandlers } from './hooks/merkezCommandHandlers'

type AppState = 'loading' | 'activation' | 'cashier_login' | 'dashboard' | 'pos'

export default function App() {
  const [state, setState]               = useState<AppState>('loading')
  const [companyId, setCompanyId]       = useState<string | null>(null)
  const [terminalId, setTerminalId]     = useState<string | null>(null)
  const [cashier, setCashier]           = useState<CashierRow | null>(null)
  const [allProducts, setAllProducts]   = useState<ProductRow[]>([])
  const [pluGroups, setPluGroups]       = useState<PluGroupCacheRow[]>([])
  const [posSettings, setPosSettings]   = useState<PosSettingsRow>({
    showPrice: true, showCode: true, showBarcode: false, source: 'default',
  })
  const [popupMessage, setPopupMessage] = useState<string | null>(null)
  const [terminalLocked, setTerminalLocked] = useState(false)
  const [terminalLockReason, setTerminalLockReason] = useState<string | null>(null)
  const [merkezToast, setMerkezToast]   = useState<string | null>(null)
  const [commandSyncing, setCommandSyncing] = useState(false)
  const [cmdPollTick, setCmdPollTick]   = useState(0)

  const showMerkezToast = useCallback((msg: string) => {
    setMerkezToast(msg)
    setTimeout(() => setMerkezToast(null), 3000)
  }, [])

  const showPopupMessage = useCallback((text: string) => {
    setPopupMessage(text)
  }, [])

  const loadPluFromCache = useCallback(async (cId: string) => {
    const workplaceId = localStorage.getItem('workplace_id') || undefined
    const cached = await window.electron.db.getPluGroups(cId, workplaceId)
    setPluGroups(cached)
  }, [])

  const handleLogout = useCallback(() => {
    setCashier(null)
    setAllProducts([])
    setPluGroups([])
    setTerminalLocked(false)
    setTerminalLockReason(null)
    setMerkezToast(null)
    setCommandSyncing(false)
    setState('cashier_login')
  }, [])

  const merkezHandlers = useMemo(() => {
    if (!companyId || !terminalId) return noopCommandHandlers
    return buildMerkezCommandHandlers({
      companyId,
      terminalId,
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
  }, [companyId, terminalId, handleLogout, showMerkezToast, showPopupMessage])

  const pollTerminalId =
    (state === 'dashboard' || state === 'pos') && terminalId && companyId ? terminalId : null

  useCommandPoller(pollTerminalId, merkezHandlers, {
    onCommandPersisted: () => setCmdPollTick(t => t + 1),
  })

  useEffect(() => { checkActivation() }, [])

  async function checkActivation() {
    const activated        = await window.electron.store.get('activated')
    const storedCompanyId  = await window.electron.store.get('company_id') as string | null
    const storedTerminalId = await window.electron.store.get('terminal_id') as string | null

    if (activated && storedCompanyId) {
      setCompanyId(storedCompanyId)
      setTerminalId(storedTerminalId)
      window.electron.db.getPosSettings().then(setPosSettings).catch(() => {})
      setState('cashier_login')
    } else {
      setState('activation')
    }
  }

  function handleActivated(cId: string) {
    setCompanyId(cId)
    window.electron.store.get('terminal_id').then(id => setTerminalId(id as string))
    setState('cashier_login')
  }

  function handleCashierLogin(c: CashierRow) {
    setCashier(c)
    if (companyId) void loadPluFromCache(companyId)
    setState('dashboard')
  }

  function handleStartSale() {
    window.electron.db.getProducts().then(p => {
      setAllProducts(p)
      setState('pos')
    })
  }

  if (state === 'loading') return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#F0F2F5' }}>
      <div style={{ color: '#9E9E9E', fontSize: 16 }}>BTPOS Yükleniyor...</div>
    </div>
  )

  if (state === 'activation')
    return <ActivationScreen onActivated={handleActivated} />

  if (state === 'cashier_login')
    return <CashierLoginScreen companyId={companyId!} onLogin={handleCashierLogin} />

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
      />
    )

  return (
    <POSScreen
      companyId={companyId!}
      cashier={cashier!}
      allProducts={allProducts}
      pluGroups={pluGroups}
      posSettings={posSettings}
      onBack={() => setState('dashboard')}
      onLogout={handleLogout}
      pendingMessage={popupMessage ? { text: popupMessage } : null}
      onMessageClose={() => setPopupMessage(null)}
      merkezToast={merkezToast}
    />
  )
}

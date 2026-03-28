import { useEffect, useState } from 'react'
import ActivationScreen   from './screens/ActivationScreen'
import CashierLoginScreen from './screens/CashierLoginScreen'
import DashboardScreen    from './screens/DashboardScreen'
import POSScreen          from './screens/POSScreen'

type AppState = 'loading' | 'activation' | 'cashier_login' | 'dashboard' | 'pos'

export default function App() {
  const [state, setState]               = useState<AppState>('loading')
  const [companyId, setCompanyId]       = useState<string | null>(null)
  const [terminalId, setTerminalId]     = useState<string | null>(null)
  const [cashier, setCashier]           = useState<CashierRow | null>(null)
  const [allProducts, setAllProducts]   = useState<ProductRow[]>([])
  const [popupMessage, setPopupMessage] = useState<string | null>(null)

  useEffect(() => { checkActivation() }, [])

  async function checkActivation() {
    const activated        = await window.electron.store.get('activated')
    const storedCompanyId  = await window.electron.store.get('company_id')
    const storedTerminalId = await window.electron.store.get('terminal_id')

    if (activated && storedCompanyId) {
      setCompanyId(storedCompanyId as string)
      setTerminalId(storedTerminalId as string)
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
    setState('dashboard')
  }

  function handleStartSale() {
    window.electron.db.getProducts().then(p => {
      setAllProducts(p)
      setState('pos')
    })
  }

  function handleLogout() {
    setCashier(null)
    setAllProducts([])
    setState('cashier_login')
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

  if (state === 'dashboard')
    return (
      <DashboardScreen
        companyId={companyId!}
        cashier={cashier!}
        terminalId={terminalId!}
        onStartSale={handleStartSale}
        onLogout={handleLogout}
        onShowMessage={(text) => setPopupMessage(text)}
      />
    )

  return (
    <>
      <POSScreen
        companyId={companyId!}
        cashier={cashier!}
        allProducts={allProducts}
        onBack={() => setState('dashboard')}
        onLogout={handleLogout}
        pollIntervalSec={30}
        pendingMessage={popupMessage ? { text: popupMessage } : null}
        onMessageClose={() => setPopupMessage(null)}
      />
    </>
  )
}

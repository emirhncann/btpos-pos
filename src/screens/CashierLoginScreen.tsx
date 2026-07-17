import { useEffect, useRef, useState, useCallback } from 'react'
import AppLogo from '../components/AppLogo'
import AlertDialog from '../components/AlertDialog'
import { useAlertDialog } from '../hooks/useAlertDialog'
import { syncCashierPluOnLogin } from '../hooks/merkezCommandHandlers'

interface Props {
  companyId:   string
  terminalId:  string
  posSettings: PosSettingsRow
  onLogin:     (cashier: CashierRow, pluGroups: PluGroupCacheRow[]) => void
}

// Barkod okuyucu tespiti — bu sürede tüm karakterler geldiyse kart olarak algıla
const BARCODE_TIMEOUT_MS = 150

type LoginStage = 'idle' | 'auth' | 'plu'

export default function CashierLoginScreen({ companyId, terminalId, posSettings, onLogin }: Props) {
  const initialMode = !posSettings.loginWithCode && posSettings.loginWithCard
    ? 'kart'
    : 'kod'

  const [mode, setMode] = useState<'kod' | 'kart'>(initialMode)
  const [code, setCode]         = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginStage, setLoginStage] = useState<LoginStage>('idle')
  const [showNumpad, setShowNumpad] = useState(false)
  const [numpadTarget, setNumpadTarget] = useState<'code' | 'password'>('password')
  const { dialogProps, showError } = useAlertDialog()

  const barcodeBuffer   = useRef('')
  const barcodeTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const codeRef         = useRef<HTMLInputElement>(null)
  const passwordRef     = useRef<HTMLInputElement>(null)

  useEffect(() => {
    codeRef.current?.focus()
  }, [])

  useEffect(() => {
    window.__btpos_exit_check = async () => {
      const allowExit = posSettings?.allowExitWithHeldDocs ?? true
      if (allowExit) return { canExit: true, heldCount: 0 }

      const docs = await window.electron.db.getHeldDocuments(companyId).catch(() => [])
      if (docs.length > 0) {
        return { canExit: false, heldCount: docs.length }
      }
      return { canExit: true, heldCount: 0 }
    }

    return () => {
      delete window.__btpos_exit_check
    }
  }, [companyId, posSettings?.allowExitWithHeldDocs])

  useEffect(() => {
    const cleanup = window.electron.app.onExitBlocked(({ heldCount }) => {
      showError(
        'Çıkış Engellendi',
        `${heldCount} bekleyen belgeniz var. Belgeleri tamamlayın veya getirip iptal edin.`,
      )
    })
    return cleanup
  }, [showError])

  const loadingLabel = loginStage === 'auth'
    ? 'Giriş yapılıyor...'
    : loginStage === 'plu'
      ? 'Ürünler yükleniyor...'
      : 'Doğrulanıyor...'

  async function finishLogin(cashier: CashierRow) {
    setLoginStage('plu')
    const wpRaw = await window.electron.store.get('workplace_id').catch(() => null)
    const workplaceId = (typeof wpRaw === 'string' && wpRaw) ? wpRaw : null
    const groups = await syncCashierPluOnLogin(companyId, workplaceId, terminalId, cashier.id)
    onLogin(cashier, groups)
  }

  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    if (!posSettings.loginWithCard || loggingIn) return
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    if (e.key === 'Enter') {
      const card = barcodeBuffer.current.trim()
      barcodeBuffer.current = ''
      if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
      if (card.length >= 4) void handleCardLogin(card)
      return
    }

    if (e.key.length === 1) {
      barcodeBuffer.current += e.key
      if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
      barcodeTimer.current = setTimeout(() => {
        barcodeBuffer.current = ''
      }, BARCODE_TIMEOUT_MS)
    }
  }, [posSettings.loginWithCard, loggingIn])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [handleGlobalKey])

  async function handleCardLogin(cardNumber: string) {
    if (!posSettings.loginWithCard) return
    if (loggingIn) return
    setLoggingIn(true)
    setLoginStage('auth')
    setError('')
    try {
      const cashier = await window.electron.db.verifyCashierByCard(cardNumber)
      if (!cashier) {
        setError('Kart tanınmadı.')
        setTimeout(() => setError(''), 2000)
        return
      }
      await finishLogin(cashier)
    } catch (e) {
      setError('Giriş yapılamadı: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoggingIn(false)
      setLoginStage('idle')
    }
  }

  async function handleLogin() {
    if (!code.trim() || !password.trim()) {
      setError('Kasiyer kodu ve şifre zorunludur.')
      return
    }
    setLoggingIn(true)
    setLoginStage('auth')
    setError('')
    try {
      const cashier = await window.electron.db.verifyCashier(code.trim(), password.trim())
      if (!cashier) {
        setError('Kasiyer kodu veya şifre hatalı.')
        setCode('')
        setPassword('')
        codeRef.current?.focus()
        return
      }
      await finishLogin(cashier)
    } catch (e) {
      setError('Giriş yapılamadı: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoggingIn(false)
      setLoginStage('idle')
    }
  }

  function handleNumpadKey(key: string) {
    if (loggingIn) return
    if (key === 'KAPAT') {
      setShowNumpad(false)
      return
    }

    const value = numpadTarget === 'code' ? code : password
    const setter = numpadTarget === 'code' ? setCode : setPassword

    if (key === 'C') {
      setter('')
      return
    }
    if (key === '⌫') {
      setter(value.slice(0, -1))
      return
    }
    if (key === 'GIRIS') {
      void handleLogin()
      return
    }
    if (key === 'ILERI') {
      setNumpadTarget('password')
      passwordRef.current?.focus()
      return
    }
    if (value.length >= 24) return
    setter(value + key)
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-8 shadow-2xl border border-gray-800">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <AppLogo height={48} className="mx-auto" />
          </div>
          <p className="text-gray-400 text-sm mt-1">Kasiyer Girişi</p>
        </div>

        {posSettings.loginWithCode && posSettings.loginWithCard && (
          <div className="flex gap-2 mb-6 p-1 bg-gray-800 rounded-lg">
            <button
              type="button"
              disabled={loggingIn}
              onClick={() => { setMode('kod'); setError('') }}
              className="flex-1 py-2 rounded-md text-sm font-medium transition-colors"
              style={{
                background: mode === 'kod' ? '#1565C0' : 'transparent',
                color: mode === 'kod' ? 'white' : '#9ca3af',
              }}
            >
              🔢 Kod & Şifre
            </button>
            <button
              type="button"
              disabled={loggingIn}
              onClick={() => { setMode('kart'); setError('') }}
              className="flex-1 py-2 rounded-md text-sm font-medium transition-colors"
              style={{
                background: mode === 'kart' ? '#1565C0' : 'transparent',
                color: mode === 'kart' ? 'white' : '#9ca3af',
              }}
            >
              🏷️ Kasiyer Kartı
            </button>
          </div>
        )}

        {!posSettings.loginWithCode && !posSettings.loginWithCard && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm text-center">
            ⚠️ Giriş yöntemi tanımlanmamış. Yöneticiye bildirin.
          </div>
        )}

        {posSettings.loginWithCode && mode === 'kod' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                type="button"
                disabled={loggingIn}
                onClick={() => {
                  setShowNumpad(true)
                  setNumpadTarget(code ? 'password' : 'code')
                }}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
              >
                Klavye
              </button>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-400 block">Kasiyer Kodu</label>
              </div>
              <input
                ref={codeRef}
                type="text"
                value={code}
                disabled={loggingIn}
                onChange={e => setCode(e.target.value)}
                onFocus={() => setNumpadTarget('code')}
                onKeyDown={e => e.key === 'Enter' && !loggingIn && (password
                  ? void handleLogin()
                  : document.getElementById('cashier-pw')?.focus()
                )}
                placeholder="Kasiyer kodu"
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-400 block">Şifre</label>
              </div>
              <input
                id="cashier-pw"
                ref={passwordRef}
                type="password"
                value={password}
                disabled={loggingIn}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setNumpadTarget('password')}
                onKeyDown={e => e.key === 'Enter' && !loggingIn && void handleLogin()}
                placeholder="••••••"
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleLogin()}
              disabled={loggingIn}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
              style={{ opacity: loggingIn ? 0.7 : 1 }}
            >
              {loggingIn ? loadingLabel : 'Giriş Yap'}
            </button>
          </div>
        )}

        {posSettings.loginWithCard && mode === 'kart' && (
          <div className="flex flex-col items-center gap-6 py-4">
            <div style={{
              width: 120, height: 120, borderRadius: 16,
              background: loggingIn ? '#1565C0' : '#1f2937',
              border: `2px solid ${loggingIn ? '#1565C0' : '#374151'}`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.2s',
            }}>
              <span style={{ fontSize: 40 }}>{loggingIn ? '⏳' : '🏷️'}</span>
              <span style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center', lineHeight: 1.3 }}>
                {loggingIn ? loadingLabel : 'Kartı okutun'}
              </span>
            </div>

            <p className="text-gray-500 text-xs text-center">
              Barkod okuyucuyu kasiyerin kartına tutun
            </p>

            {posSettings.loginWithCode && (
              <p className="text-gray-500 text-xs text-center">
                veya <button
                  type="button"
                  disabled={loggingIn}
                  onClick={() => setMode('kod')}
                  className="text-blue-400 underline"
                >kod ile giriş yapın</button>
              </p>
            )}

            {error && (
              <div className="w-full bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm text-center">
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {showNumpad && !loggingIn && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center p-3">
          <div className="w-full max-w-xs bg-gray-900 border border-gray-700 rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-300">
                Sayısal Klavye - {numpadTarget === 'code' ? 'Kasiyer Kodu' : 'Şifre'}
              </span>
              <button
                type="button"
                onClick={() => setShowNumpad(false)}
                className="text-gray-400 hover:text-white text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '⌫'].map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleNumpadKey(k)}
                  className="py-3 rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-semibold"
                >
                  {k}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                type="button"
                onClick={() => handleNumpadKey('KAPAT')}
                className="py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-semibold"
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={() => handleNumpadKey(numpadTarget === 'code' ? 'ILERI' : 'GIRIS')}
                className="py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
              >
                {numpadTarget === 'code' ? '→ Ileri' : 'Giris'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loggingIn && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(255,255,255,0.92)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, border: '3px solid #E5E7EB',
            borderTopColor: '#1565C0', borderRadius: '50%',
            animation: 'cashier-login-spin 0.8s linear infinite',
          }} />
          <div style={{ fontSize: 14, color: '#374151', fontWeight: 500 }}>
            {loadingLabel}
          </div>
          <style>{`@keyframes cashier-login-spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      <button
        type="button"
        onClick={() => { void window.electron.app.requestExit() }}
        style={{
          position: 'fixed',
          bottom: 20,
          left: 20,
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px solid #E5E7EB',
          background: '#F9FAFB',
          fontSize: 12,
          color: '#6B7280',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 2v10" />
          <path d="M7.5 7.5a7 7 0 1 0 9 0" />
        </svg>
        <span>Programı Kapat</span>
      </button>

      <AlertDialog {...dialogProps} />
    </div>
  )
}

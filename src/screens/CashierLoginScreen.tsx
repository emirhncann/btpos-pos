import { useEffect, useRef, useState, useCallback } from 'react'
import AppLogo from '../components/AppLogo'

interface Props {
  companyId:   string
  posSettings: PosSettingsRow
  onLogin:     (cashier: CashierRow) => void
}

// Barkod okuyucu tespiti — bu sürede tüm karakterler geldiyse kart olarak algıla
const BARCODE_TIMEOUT_MS = 150

export default function CashierLoginScreen({ companyId, posSettings, onLogin }: Props) {
  void companyId
  // Sadece kart açıksa → kart modu, yoksa kod modu başlangıç
  const initialMode = !posSettings.loginWithCode && posSettings.loginWithCard
    ? 'kart'
    : 'kod'

  const [mode, setMode] = useState<'kod' | 'kart'>(initialMode)
  const [code, setCode]         = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // Barkod buffer — hızlı tuş basımını yakalar
  const barcodeBuffer   = useRef('')
  const barcodeTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const codeRef         = useRef<HTMLInputElement>(null)

  useEffect(() => {
    codeRef.current?.focus()
  }, [])

  // Global keydown — barkod okuyucu tespiti
  // Her iki modda da (kod ve kart) çalışır
  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    if (!posSettings.loginWithCard) return
    // Input alanı odaktaysa normal klavye girişi, barkod değil
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
        // Timeout doldu — yeterince hızlı gelmedi, barkod değil
        barcodeBuffer.current = ''
      }, BARCODE_TIMEOUT_MS)
    }
  }, [posSettings.loginWithCard])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [handleGlobalKey])

  // Kart/barkod ile giriş — şifresiz
  async function handleCardLogin(cardNumber: string) {
    if (!posSettings.loginWithCard) return
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const cashier = await window.electron.db.verifyCashierByCard(cardNumber)
      if (!cashier) {
        setError('Kart tanınmadı.')
        setTimeout(() => setError(''), 2000)
        return
      }
      onLogin(cashier)
    } catch {
      setError('Kart okuma hatası.')
    } finally {
      setLoading(false)
    }
  }

  // Kod + şifre ile giriş
  async function handleLogin() {
    if (!code.trim() || !password.trim()) {
      setError('Kasiyer kodu ve şifre zorunludur.')
      return
    }
    setLoading(true)
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
      onLogin(cashier)
    } catch (e) {
      setError('Giriş hatası: ' + (e instanceof Error ? e.message : 'Bilinmeyen hata'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-8 shadow-2xl border border-gray-800">
        {/* Logo + başlık */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <AppLogo height={48} className="mx-auto" />
          </div>
          <p className="text-gray-400 text-sm mt-1">Kasiyer Girişi</p>
        </div>

        {/* İki yöntem de açıksa sekme göster, sadece biri açıksa sekme gizle */}
        {posSettings.loginWithCode && posSettings.loginWithCard && (
          <div className="flex gap-2 mb-6 p-1 bg-gray-800 rounded-lg">
            <button
              type="button"
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

        {/* Hiçbiri açık değilse uyarı */}
        {!posSettings.loginWithCode && !posSettings.loginWithCard && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm text-center">
            ⚠️ Giriş yöntemi tanımlanmamış. Yöneticiye bildirin.
          </div>
        )}

        {posSettings.loginWithCode && mode === 'kod' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Kasiyer Kodu</label>
              <input
                ref={codeRef}
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (password
                  ? void handleLogin()
                  : document.getElementById('cashier-pw')?.focus()
                )}
                placeholder="Kasiyer kodu"
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Şifre</label>
              <input
                id="cashier-pw"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void handleLogin()}
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
              onClick={() => void handleLogin()}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
            >
              {loading ? 'Doğrulanıyor...' : 'Giriş Yap'}
            </button>
          </div>
        )}

        {posSettings.loginWithCard && mode === 'kart' && (
          <div className="flex flex-col items-center gap-6 py-4">
            {/* Kart bekleniyor görseli */}
            <div style={{
              width: 120, height: 120, borderRadius: 16,
              background: loading ? '#1565C0' : '#1f2937',
              border: `2px solid ${loading ? '#1565C0' : '#374151'}`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.2s',
            }}>
              <span style={{ fontSize: 40 }}>{loading ? '⏳' : '🏷️'}</span>
              <span style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center', lineHeight: 1.3 }}>
                {loading ? 'Doğrulanıyor...' : 'Kartı okutun'}
              </span>
            </div>

            <p className="text-gray-500 text-xs text-center">
              Barkod okuyucuyu kasiyerin kartına tutun
            </p>

            {posSettings.loginWithCode && (
              <p className="text-gray-500 text-xs text-center">
                veya <button
                  type="button"
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
    </div>
  )
}

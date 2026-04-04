import { useEffect, useRef, useState } from 'react'
import AppLogo from '../components/AppLogo'
import { api } from '../lib/api'

interface Props {
  companyId: string
  onLogin: (cashier: CashierRow) => void
}

export default function CashierLoginScreen({ companyId, onLogin }: Props) {
  const [code, setCode]         = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [syncing, setSyncing]   = useState(false)
  const codeRef                 = useRef<HTMLInputElement>(null)

  useEffect(() => {
    syncCashiers()
    codeRef.current?.focus()
  }, [])

  async function syncCashiers() {
    setSyncing(true)
    try {
      const cashiers = await api.getCashiers(companyId)
      await window.electron.db.saveCashiers(cashiers)
    } catch {
      // API'ye ulaşılamazsa SQLite'taki eski liste kullanılır
    } finally {
      setSyncing(false)
    }
  }

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
      setError('Giriş sırasında hata oluştu: ' + (e instanceof Error ? e.message : 'Bilinmeyen hata'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-8 shadow-2xl border border-gray-800">

        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <AppLogo height={48} className="mx-auto" />
          </div>
          <p className="text-gray-400 text-sm mt-1">Kasiyer Girişi</p>
          {syncing && (
            <p className="text-gray-600 text-xs mt-1 animate-pulse">Kasiyer listesi güncelleniyor...</p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Kasiyer Kodu</label>
            <input
              ref={codeRef}
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (password ? handleLogin() : document.getElementById('cashier-pw')?.focus())}
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
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
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
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Doğrulanıyor...' : 'Giriş Yap'}
          </button>
        </div>
      </div>
    </div>
  )
}

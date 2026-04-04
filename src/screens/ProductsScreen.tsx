import { useEffect, useState } from 'react'
import AppLogo from '../components/AppLogo'
import { api } from '../lib/api'
import LicenseBanner from '../components/LicenseBanner'
import { useLicenseCheck } from '../hooks/useLicenseCheck'

interface Props {
  companyId: string
  cashier: CashierRow
  onStartSale: (products: ProductRow[]) => void
  onLogout: () => void
}

export default function ProductsScreen({ companyId, cashier, onStartSale, onLogout }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [isOffline, setIsOffline] = useState(false)
  const license = useLicenseCheck(companyId)

  useEffect(() => {
    loadFromDB()
  }, [])

  async function loadFromDB() {
    try {
      const local = await window.electron.db.getProducts()
      if (local.length > 0) {
        setProducts(local)
        setIsOffline(false)
        syncFromAPI()
      } else {
        await syncFromAPI()
      }
    } catch {
      await syncFromAPI()
    }
  }

  async function syncFromAPI() {
    setLoading(true)
    setError('')
    try {
      const data = await api.getProducts(companyId)
      const items: ProductRow[] = (data?.data?.items ?? data?.items ?? data ?? []).map((p: Record<string, unknown>) => ({
        id:       String(p.id ?? p.Id ?? crypto.randomUUID()),
        code:     String(p.code ?? p.Code ?? ''),
        name:     String(p.name ?? p.Name ?? p.description ?? ''),
        barcode:  String(p.barcode ?? p.Barcode ?? ''),
        price:    Number(p.price ?? p.Price ?? p.salesPrice ?? 0),
        vatRate:  Number(p.vatRate ?? p.VatRate ?? 18),
        unit:     String(p.unit ?? p.Unit ?? 'Adet'),
        stock:    Number(p.stock ?? p.Stock ?? 0),
        category: String(p.category ?? p.Category ?? ''),
      }))

      await window.electron.db.saveProducts(items)
      setProducts(items)
      setIsOffline(false)
      setLastSync(new Date().toLocaleTimeString('tr-TR'))
    } catch {
      setIsOffline(true)
      const local = await window.electron.db.getProducts()
      if (local.length > 0) {
        setProducts(local)
        setError('⚠️ Sunucuya ulaşılamadı — yerel veriler gösteriliyor.')
      } else {
        setError('Sunucuya ulaşılamadı ve yerel veri bulunamadı.')
      }
    } finally {
      setLoading(false)
    }
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.code ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.barcode ?? '').includes(search)
  )

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <AppLogo height={32} />
          <span className="text-xs text-gray-500 border border-gray-700 rounded-full px-2 py-0.5">
            {cashier.fullName}
          </span>
          {isOffline && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-1 rounded-full">
              Çevrimdışı
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastSync && <span className="text-xs text-gray-500">Son sync: {lastSync}</span>}
          <button
            onClick={syncFromAPI}
            disabled={loading}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors border border-gray-700"
          >
            {loading ? '⟳ Senkronize...' : '⟳ Senkronize Et'}
          </button>
          <button
            onClick={() => onStartSale(products)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
          >
            Satış Başlat →
          </button>
          <button
            onClick={onLogout}
            className="text-gray-500 hover:text-red-400 text-sm px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            Çıkış
          </button>
        </div>
      </div>

      {license?.warning && (
        <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />
      )}

      <div className="px-6 py-3 bg-gray-900 border-b border-gray-800">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Ürün adı, kodu veya barkod..."
          className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
          autoFocus
        />
      </div>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-yellow-400 text-sm mb-4">
            {error}
          </div>
        )}

        {loading && products.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-400 animate-pulse">Ürünler yükleniyor...</div>
          </div>
        ) : (
          <>
            <p className="text-gray-500 text-xs mb-3">{filtered.length} ürün</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map(product => (
                <div
                  key={product.id}
                  onClick={() => onStartSale([product])}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-blue-500/50 hover:bg-gray-800 cursor-pointer transition-all"
                >
                  <p className="text-xs text-gray-500 font-mono mb-1">{product.code}</p>
                  <p className="text-sm font-medium text-white leading-tight mb-2 line-clamp-2">{product.name}</p>
                  <p className="text-lg font-bold text-blue-400">
                    {product.price?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </p>
                  <p className="text-xs text-gray-600 mt-1">Stok: {product.stock} {product.unit}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

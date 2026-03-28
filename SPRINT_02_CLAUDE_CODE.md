# BTPOS Electron POS — Sprint 2
## Claude Code Görev Paketi

> **Önceki Sprint:** Aktivasyon ekranı + İşbaşı ürün çekme çalışıyor.
> **Bu Sprint Amacı:** SQLite'a ürün kaydet (çevrimdışı mod), ana satış ekranı (sepet + ödeme), barkod okuyucu desteği, lisans bitiş kontrolü.
> **Kural:** Kasa hiçbir zaman dışarıya doğrudan istek atmaz — her şey `api.btpos.com.tr` üzerinden geçer.

---

## ADIM 1 — SQLite Ürün Senkronizasyonu

`ProductsScreen.tsx`'te ürünler şu an sadece React state'inde tutuluyor. İnternet kesilince kayboluyorlar. Bunu düzelteceğiz.

### `electron/main.ts` — IPC handler'ları ekle (mevcut dosyaya ekle)

Mevcut IPC handler bloğunun sonuna şunları ekle:

```typescript
// DB işlemleri için IPC
ipcMain.handle('db:saveProducts', async (_e, products) => {
  const { saveProducts } = await import('../db/operations')
  return saveProducts(products)
})

ipcMain.handle('db:getProducts', async () => {
  const { getAllProducts } = await import('../db/operations')
  return getAllProducts()
})

ipcMain.handle('db:saveSale', async (_e, sale, items) => {
  const { saveSale } = await import('../db/operations')
  return saveSale(sale, items)
})

ipcMain.handle('db:getSales', async (_e, dateFrom, dateTo) => {
  const { getSales } = await import('../db/operations')
  return getSales(dateFrom, dateTo)
})
```

### `db/operations.ts` — YENİ DOSYA OLUŞTUR

```typescript
import { getDB } from './index'
import { products, sales, saleItems } from './schema'
import { eq, gte, lte, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'

export interface ProductRow {
  id: string
  code?: string
  name: string
  barcode?: string
  price: number
  vatRate: number
  unit: string
  stock: number
  category?: string
  syncedAt: string
}

export interface SaleItem {
  productId?: string
  productName: string
  quantity: number
  unitPrice: number
  vatRate: number
  lineTotal: number
}

export interface SaleRow {
  receiptNo: string
  totalAmount: number
  paymentType: 'cash' | 'card' | 'mixed'
  cashAmount: number
  cardAmount: number
}

// Ürünleri toplu kaydet (upsert mantığı)
export function saveProducts(items: ProductRow[]): number {
  const db = getDB()

  // Tüm ürünleri sil, yeniden yaz (basit sync stratejisi)
  db.delete(products).run()

  const now = new Date().toISOString()

  for (const item of items) {
    db.insert(products).values({
      id: item.id || randomUUID(),
      code: item.code ?? '',
      name: item.name,
      barcode: item.barcode ?? '',
      price: item.price ?? 0,
      vatRate: item.vatRate ?? 18,
      unit: item.unit ?? 'Adet',
      stock: item.stock ?? 0,
      category: item.category ?? '',
      syncedAt: now,
    }).run()
  }

  return items.length
}

// Tüm ürünleri getir
export function getAllProducts(): ProductRow[] {
  const db = getDB()
  return db.select().from(products).all() as ProductRow[]
}

// Barkod ile ürün bul
export function findByBarcode(barcode: string): ProductRow | null {
  const db = getDB()
  const result = db.select().from(products).where(eq(products.barcode, barcode)).get()
  return result as ProductRow | null
}

// Satış kaydet
export function saveSale(sale: SaleRow, items: SaleItem[]): string {
  const db = getDB()
  const saleId = randomUUID()
  const now = new Date().toISOString()

  db.insert(sales).values({
    id: saleId,
    receiptNo: sale.receiptNo,
    totalAmount: sale.totalAmount,
    paymentType: sale.paymentType,
    cashAmount: sale.cashAmount,
    cardAmount: sale.cardAmount,
    createdAt: now,
    synced: false,
  }).run()

  for (const item of items) {
    db.insert(saleItems).values({
      id: randomUUID(),
      saleId,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      lineTotal: item.lineTotal,
    }).run()
  }

  return saleId
}

// Satışları getir (tarih filtreli)
export function getSales(dateFrom?: string, dateTo?: string) {
  const db = getDB()

  if (dateFrom && dateTo) {
    return db.select().from(sales)
      .where(and(gte(sales.createdAt, dateFrom), lte(sales.createdAt, dateTo)))
      .all()
  }

  return db.select().from(sales).all()
}
```

### `electron/preload.ts` — DB ve barkod metodlarını ekle

Mevcut `contextBridge.exposeInMainWorld` bloğunu tamamen şununla değiştir:

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  device: {
    uid: () => ipcRenderer.invoke('device:uid'),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
  db: {
    saveProducts: (products: unknown[]) => ipcRenderer.invoke('db:saveProducts', products),
    getProducts: () => ipcRenderer.invoke('db:getProducts'),
    saveSale: (sale: unknown, items: unknown[]) => ipcRenderer.invoke('db:saveSale', sale, items),
    getSales: (dateFrom?: string, dateTo?: string) => ipcRenderer.invoke('db:getSales', dateFrom, dateTo),
  },
})
```

### `src/electron.d.ts` — Tip tanımlarını güncelle (dosyayı tamamen değiştir)

```typescript
export {}

declare global {
  interface Window {
    electron: {
      store: {
        get: (key: string) => Promise<unknown>
        set: (key: string, value: unknown) => Promise<void>
      }
      device: {
        uid: () => Promise<string>
      }
      app: {
        version: () => Promise<string>
      }
      db: {
        saveProducts: (products: unknown[]) => Promise<number>
        getProducts: () => Promise<ProductRow[]>
        saveSale: (sale: SaleRow, items: SaleItem[]) => Promise<string>
        getSales: (dateFrom?: string, dateTo?: string) => Promise<SaleRecord[]>
      }
    }
  }

  interface ProductRow {
    id: string
    code?: string
    name: string
    barcode?: string
    price: number
    vatRate: number
    unit: string
    stock: number
    category?: string
    syncedAt?: string
  }

  interface SaleItem {
    productId?: string
    productName: string
    quantity: number
    unitPrice: number
    vatRate: number
    lineTotal: number
  }

  interface SaleRow {
    receiptNo: string
    totalAmount: number
    paymentType: 'cash' | 'card' | 'mixed'
    cashAmount: number
    cardAmount: number
  }

  interface SaleRecord {
    id: string
    receiptNo: string
    totalAmount: number
    paymentType: string
    createdAt: string
  }
}
```

---

## ADIM 2 — ProductsScreen Güncelle (SQLite + Çevrimdışı)

`src/screens/ProductsScreen.tsx` dosyasını tamamen şununla değiştir:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Props {
  companyId: string
  onStartSale: (products: ProductRow[]) => void
}

export default function ProductsScreen({ companyId, onStartSale }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    loadFromDB()
  }, [])

  // Önce SQLite'tan yükle (anında görünür)
  async function loadFromDB() {
    try {
      const local = await window.electron.db.getProducts()
      if (local.length > 0) {
        setProducts(local)
        setIsOffline(false)
        // Arka planda API'den de güncelle
        syncFromAPI()
      } else {
        // SQLite boşsa doğrudan API'den çek
        await syncFromAPI()
      }
    } catch {
      await syncFromAPI()
    }
  }

  // API'den çek → SQLite'a yaz
  async function syncFromAPI() {
    setLoading(true)
    setError('')
    try {
      const data = await api.getProducts(companyId)
      const items: ProductRow[] = (data?.data?.items ?? data?.items ?? data ?? []).map((p: Record<string, unknown>) => ({
        id: String(p.id ?? p.Id ?? crypto.randomUUID()),
        code: String(p.code ?? p.Code ?? ''),
        name: String(p.name ?? p.Name ?? p.description ?? ''),
        barcode: String(p.barcode ?? p.Barcode ?? ''),
        price: Number(p.price ?? p.Price ?? p.salesPrice ?? 0),
        vatRate: Number(p.vatRate ?? p.VatRate ?? 18),
        unit: String(p.unit ?? p.Unit ?? 'Adet'),
        stock: Number(p.stock ?? p.Stock ?? 0),
        category: String(p.category ?? p.Category ?? ''),
      }))

      // SQLite'a kaydet
      await window.electron.db.saveProducts(items)
      setProducts(items)
      setIsOffline(false)
      setLastSync(new Date().toLocaleTimeString('tr-TR'))
    } catch {
      setIsOffline(true)
      // API başarısız → SQLite'tan okumaya devam et
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
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">BT<span className="text-blue-500">POS</span></h1>
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
        </div>
      </div>

      {/* Arama */}
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

      {/* İçerik */}
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
```

---

## ADIM 3 — Ana Satış Ekranı (Sepet + Ödeme)

### `src/screens/POSScreen.tsx` — YENİ DOSYA OLUŞTUR

```tsx
import { useState, useEffect, useRef } from 'react'

interface CartItem extends ProductRow {
  quantity: number
  lineTotal: number
}

interface Props {
  companyId: string
  allProducts: ProductRow[]
  onBack: () => void
}

let receiptCounter = parseInt(localStorage.getItem('receipt_counter') || '1000')

function nextReceiptNo(): string {
  receiptCounter++
  localStorage.setItem('receipt_counter', String(receiptCounter))
  return `FIS-${receiptCounter}`
}

export default function POSScreen({ allProducts, onBack }: Props) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [paymentMode, setPaymentMode] = useState(false)
  const [paymentType, setPaymentType] = useState<'cash' | 'card' | 'mixed'>('cash')
  const [cashInput, setCashInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastReceipt, setLastReceipt] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Barkod/arama ile ürün ekle
  useEffect(() => {
    if (search.length < 2) return

    const timeout = setTimeout(() => {
      // Barkod tam eşleşmesi
      const byBarcode = allProducts.find(p => p.barcode === search)
      if (byBarcode) {
        addToCart(byBarcode)
        setSearch('')
        return
      }
    }, 300)

    return () => clearTimeout(timeout)
  }, [search])

  function addToCart(product: ProductRow, qty = 1) {
    setCart(prev => {
      const existing = prev.find(c => c.id === product.id)
      if (existing) {
        return prev.map(c =>
          c.id === product.id
            ? { ...c, quantity: c.quantity + qty, lineTotal: (c.quantity + qty) * c.unitPrice }
            : c
        )
      }
      return [...prev, {
        ...product,
        quantity: qty,
        lineTotal: qty * product.price,
        unitPrice: product.price,
      }]
    })
  }

  function updateQty(id: string, delta: number) {
    setCart(prev => prev
      .map(c => c.id === id ? { ...c, quantity: c.quantity + delta, lineTotal: (c.quantity + delta) * c.price } : c)
      .filter(c => c.quantity > 0)
    )
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(c => c.id !== id))
  }

  const total = cart.reduce((sum, c) => sum + c.lineTotal, 0)
  const cashAmount = parseFloat(cashInput) || 0
  const change = cashAmount - total

  const filtered = search.length >= 2
    ? allProducts.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.code ?? '').toLowerCase().includes(search.toLowerCase())
      ).slice(0, 20)
    : []

  async function completeSale() {
    if (cart.length === 0) return
    setSaving(true)
    try {
      const receiptNo = nextReceiptNo()
      const saleData: SaleRow = {
        receiptNo,
        totalAmount: total,
        paymentType,
        cashAmount: paymentType === 'card' ? 0 : cashAmount || total,
        cardAmount: paymentType === 'cash' ? 0 : (paymentType === 'card' ? total : total - cashAmount),
      }

      const items: SaleItem[] = cart.map(c => ({
        productId: c.id,
        productName: c.name,
        quantity: c.quantity,
        unitPrice: c.price,
        vatRate: c.vatRate ?? 18,
        lineTotal: c.lineTotal,
      }))

      await window.electron.db.saveSale(saleData, items)

      setLastReceipt(receiptNo)
      setCart([])
      setPaymentMode(false)
      setCashInput('')
      setSearch('')
      searchRef.current?.focus()
    } catch (e) {
      alert('Satış kaydedilemedi: ' + (e instanceof Error ? e.message : 'Hata'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">

      {/* SOL — Ürün arama */}
      <div className="flex-1 flex flex-col border-r border-gray-800">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
          <button onClick={onBack} className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
            ← Ürünler
          </button>
          <h2 className="text-sm font-semibold text-gray-300">Satış Ekranı</h2>
          {lastReceipt && (
            <span className="ml-auto text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1 rounded-full">
              ✓ {lastReceipt} kaydedildi
            </span>
          )}
        </div>

        {/* Arama */}
        <div className="px-4 py-3 border-b border-gray-800">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Ürün adı, kodu veya barkod okut..."
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Arama sonuçları */}
        <div className="flex-1 overflow-auto p-4">
          {filtered.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {filtered.map(p => (
                <button
                  key={p.id}
                  onClick={() => { addToCart(p); setSearch(''); searchRef.current?.focus() }}
                  className="text-left bg-gray-900 border border-gray-800 hover:border-blue-500/50 hover:bg-gray-800 rounded-xl p-3 transition-all"
                >
                  <p className="text-xs text-gray-500 font-mono">{p.code}</p>
                  <p className="text-sm font-medium text-white mt-0.5 line-clamp-2">{p.name}</p>
                  <p className="text-blue-400 font-bold mt-1">
                    {p.price?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              {search.length < 2 ? 'Ürün aramak için yazmaya başlayın veya barkod okutun' : 'Sonuç bulunamadı'}
            </div>
          )}
        </div>
      </div>

      {/* SAĞ — Sepet */}
      <div className="w-96 flex flex-col bg-gray-900">
        {/* Sepet başlığı */}
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="font-semibold text-sm">Sepet {cart.length > 0 && <span className="text-gray-400 font-normal">({cart.length} ürün)</span>}</h3>
        </div>

        {/* Kalemler */}
        <div className="flex-1 overflow-auto">
          {cart.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              Sepet boş
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {cart.map(item => (
                <div key={item.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white leading-tight truncate">{item.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.price?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ / {item.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => updateQty(item.id, -1)} className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-bold flex items-center justify-center">−</button>
                    <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                    <button onClick={() => updateQty(item.id, 1)} className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-bold flex items-center justify-center">+</button>
                    <button onClick={() => removeFromCart(item.id)} className="w-7 h-7 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-400 text-sm flex items-center justify-center ml-1">✕</button>
                  </div>
                  <div className="w-20 text-right shrink-0">
                    <p className="text-sm font-bold text-white">
                      {item.lineTotal?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Toplam & Ödeme */}
        <div className="border-t border-gray-800 p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Toplam</span>
            <span className="text-2xl font-bold text-white">
              {total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
            </span>
          </div>

          {!paymentMode ? (
            <button
              onClick={() => setPaymentMode(true)}
              disabled={cart.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-3.5 rounded-xl transition-colors text-sm"
            >
              Ödeme Al
            </button>
          ) : (
            <div className="space-y-3">
              {/* Ödeme tipi */}
              <div className="grid grid-cols-3 gap-1.5">
                {(['cash', 'card', 'mixed'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setPaymentType(t)}
                    className={`py-2 rounded-lg text-xs font-semibold transition-colors ${paymentType === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                  >
                    {t === 'cash' ? '💵 Nakit' : t === 'card' ? '💳 Kart' : '🔀 Karma'}
                  </button>
                ))}
              </div>

              {/* Nakit tutarı */}
              {(paymentType === 'cash' || paymentType === 'mixed') && (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    {paymentType === 'mixed' ? 'Nakit Tutar (₺)' : 'Alınan Nakit (₺)'}
                  </label>
                  <input
                    type="number"
                    value={cashInput}
                    onChange={e => setCashInput(e.target.value)}
                    placeholder="0,00"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    autoFocus
                  />
                  {paymentType === 'cash' && cashAmount >= total && (
                    <p className="text-green-400 text-xs mt-1 font-medium">
                      Para Üstü: {(change).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setPaymentMode(false); setCashInput('') }}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-300 py-3 rounded-xl text-sm font-medium transition-colors"
                >
                  İptal
                </button>
                <button
                  onClick={completeSale}
                  disabled={saving || (paymentType === 'cash' && cashAmount < total)}
                  className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white py-3 rounded-xl text-sm font-bold transition-colors"
                >
                  {saving ? 'Kaydediliyor...' : 'Tamamla ✓'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

---

## ADIM 4 — App.tsx Güncelle (POS ekranını bağla)

`src/App.tsx` dosyasını tamamen şununla değiştir:

```tsx
import { useEffect, useState } from 'react'
import ActivationScreen from './screens/ActivationScreen'
import ProductsScreen from './screens/ProductsScreen'
import POSScreen from './screens/POSScreen'

type AppState = 'loading' | 'activation' | 'products' | 'pos'

export default function App() {
  const [state, setState] = useState<AppState>('loading')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [allProducts, setAllProducts] = useState<ProductRow[]>([])

  useEffect(() => {
    checkActivation()
  }, [])

  async function checkActivation() {
    const activated = await window.electron.store.get('activated')
    const storedCompanyId = await window.electron.store.get('company_id')

    if (activated && storedCompanyId) {
      setCompanyId(storedCompanyId as string)
      setState('products')
    } else {
      setState('activation')
    }
  }

  function handleActivated(cId: string) {
    setCompanyId(cId)
    setState('products')
  }

  function handleStartSale(products: ProductRow[]) {
    setAllProducts(products)
    setState('pos')
  }

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="text-white text-lg animate-pulse">BTPOS Yükleniyor...</div>
      </div>
    )
  }

  if (state === 'activation') {
    return <ActivationScreen onActivated={handleActivated} />
  }

  if (state === 'pos') {
    return (
      <POSScreen
        companyId={companyId!}
        allProducts={allProducts}
        onBack={() => setState('products')}
      />
    )
  }

  return (
    <ProductsScreen
      companyId={companyId!}
      onStartSale={handleStartSale}
    />
  )
}
```

---

## ADIM 5 — Lisans Bitiş Kontrolü

### `src/hooks/useLicenseCheck.ts` — YENİ DOSYA OLUŞTUR

```typescript
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface LicenseStatus {
  valid: boolean
  daysLeft: number
  planName: string
  expiryDate: string
  warning: boolean  // 30 günden az kaldıysa true
}

export function useLicenseCheck(companyId: string | null) {
  const [license, setLicense] = useState<LicenseStatus | null>(null)

  useEffect(() => {
    if (!companyId) return
    check()
    // Her saat başı kontrol et
    const interval = setInterval(check, 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [companyId])

  async function check() {
    try {
      const data = await api.checkLicense(companyId!)
      const expiry = new Date(data.expiry_date)
      const now = new Date()
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

      setLicense({
        valid: daysLeft > 0 && data.license_id,
        daysLeft,
        planName: data.plan_name ?? '',
        expiryDate: data.expiry_date,
        warning: daysLeft <= 30,
      })
    } catch {
      // API'ye ulaşılamazsa lisansı geçerli say (çevrimdışı mod)
      setLicense(prev => prev ?? { valid: true, daysLeft: 999, planName: '', expiryDate: '', warning: false })
    }
  }

  return license
}
```

### `src/components/LicenseBanner.tsx` — YENİ DOSYA OLUŞTUR

```tsx
interface Props {
  daysLeft: number
  planName: string
}

export default function LicenseBanner({ daysLeft, planName }: Props) {
  if (daysLeft > 30) return null

  return (
    <div className={`px-4 py-2 text-xs font-medium flex items-center justify-between ${
      daysLeft <= 7
        ? 'bg-red-500/20 text-red-400 border-b border-red-500/30'
        : 'bg-yellow-500/20 text-yellow-400 border-b border-yellow-500/30'
    }`}>
      <span>
        {daysLeft <= 0
          ? '⛔ Lisansınız sona erdi. Lütfen yöneticinizle iletişime geçin.'
          : `⚠️ Lisansınız ${daysLeft} gün içinde sona erecek. (Plan: ${planName})`
        }
      </span>
    </div>
  )
}
```

Lisans banner'ını `ProductsScreen` ve `POSScreen` header'larına ekle:

```tsx
// Her iki ekranın header'ının hemen altına (border-b'den sonra):
import LicenseBanner from '../components/LicenseBanner'
import { useLicenseCheck } from '../hooks/useLicenseCheck'

// Component içinde:
const license = useLicenseCheck(companyId)

// Header div'inden hemen sonra:
{license?.warning && (
  <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />
)}
```

---

## Sprint 2 Teslim Kriterleri (Definition of Done)

- [ ] Ürünler SQLite'a yazılıyor (`db:saveProducts` çalışıyor)
- [ ] Uygulama internet olmadan açıldığında SQLite'tan yükleniyor
- [ ] "Çevrimdışı" badge'i gösteriyor
- [ ] Satış ekranı açılıyor (Ürünler → Satış Başlat)
- [ ] Ürün arama / barkod ile sepete ekleme çalışıyor
- [ ] Adet artır/azalt / sil çalışıyor
- [ ] Nakit ödeme → para üstü hesaplıyor
- [ ] Kart ödeme → tamamla çalışıyor
- [ ] Satış SQLite'a kaydediliyor (db:saveSale)
- [ ] Lisans bitiş tarihi 30 günden azsa banner gösteriyor
- [ ] `npm run dev` hatasız çalışıyor

---

## Bilinen Sınırlamalar (Sprint 3'e bırakılan)

- Fiş yazdırma yok → Sprint 3
- Günlük satış raporu ekranı yok → Sprint 3
- Barkod okuyucu: şu an arama kutusu üzerinden çalışıyor, USB HID entegrasyonu → Sprint 3
- ERP'ye satış yazma (write_count) → Sprint 3

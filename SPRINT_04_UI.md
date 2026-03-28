# BTPOS — Sprint 4
## Claude Code Görev Paketi (UI Yenileme)

> **Bu Sprint Kapsamı:**
> 1. Electron — kiosk modu (tam ekran, taskbar gizli)
> 2. Yeni Dashboard ekranı (kasiyer girişi sonrası)
> 3. POSScreen komple yeniden tasarım (açık tema, geniş sepet, küçük PLU grid)
> 4. Tüm ekranlar açık tema (beyaz/gri)

---

## ADIM 1 — Kiosk Modu (`electron/main.ts`)

`createWindow()` fonksiyonunu tamamen şununla değiştir:

```typescript
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    kiosk: true,           // Tam ekran kiosk modu
    fullscreen: true,
    frame: false,          // Pencere çerçevesi yok
    show: false,
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    // Geliştirmede kiosk kapalı, DevTools açık
    mainWindow.setKiosk(false)
    mainWindow.setFullScreen(false)
    mainWindow.setSize(1280, 800)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
}
```

---

## ADIM 2 — Global CSS Güncelle (`src/index.css`)

Dosyayı tamamen şununla değiştir:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Segoe UI', Inter, system-ui, sans-serif;
  background: #F0F2F5;
  color: #212121;
  overflow: hidden;
  user-select: none;
}

/* Scrollbar — ince ve sade */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: #F0F2F5; }
::-webkit-scrollbar-thumb { background: #BDBDBD; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #9E9E9E; }

/* PLU buton hover efekti */
.plu-btn:hover { border-color: #1565C0 !important; background: #E3F2FD !important; }
.plu-btn:active { transform: scale(0.97); }

/* Grup sekme aktif */
.group-tab-active { background: #1565C0 !important; color: white !important; }
.group-tab { background: white; border: 1px solid #E0E0E0; color: #424242; cursor: pointer; }
.group-tab:hover { background: #E3F2FD; border-color: #90CAF9; color: #1565C0; }
```

---

## ADIM 3 — Yeni Dashboard Ekranı

### `src/screens/DashboardScreen.tsx` — YENİ DOSYA OLUŞTUR

```tsx
import { useState, useEffect } from 'react'
import { api } from '../lib/api'

interface Props {
  companyId: string
  cashier: CashierRow
  onStartSale: () => void
  onLogout: () => void
}

interface DailySummary {
  saleCount: number
  totalSales: number
  totalCash: number
  totalCard: number
}

export default function DashboardScreen({ companyId, cashier, onStartSale, onLogout }: Props) {
  const [summary, setSummary] = useState<DailySummary>({ saleCount: 0, totalSales: 0, totalCash: 0, totalCard: 0 })
  const [time, setTime] = useState(new Date())
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    loadDailySummary()
    const tick = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(tick)
  }, [])

  async function loadDailySummary() {
    try {
      // SQLite'tan günlük satışları oku
      const today = new Date().toISOString().split('T')[0]
      const sales = await window.electron.db.getSales(
        today + 'T00:00:00',
        today + 'T23:59:59'
      )
      const totalSales  = sales.reduce((s, r) => s + r.totalAmount, 0)
      const totalCash   = sales.reduce((s, r) => s + (r.paymentType === 'cash'  ? r.totalAmount : r.paymentType === 'mixed' ? r.totalAmount * 0.5 : 0), 0)
      const totalCard   = sales.reduce((s, r) => s + (r.paymentType === 'card'  ? r.totalAmount : r.paymentType === 'mixed' ? r.totalAmount * 0.5 : 0), 0)
      setSummary({ saleCount: sales.length, totalSales, totalCash, totalCard })
    } catch {
      // sessizce geç
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      await api.getProducts(companyId)
    } catch { /* sessiz */ }
    finally { setSyncing(false) }
  }

  const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F0F2F5' }}>

      {/* Header */}
      <div style={{ background: '#1565C0', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: 'white', fontWeight: 600, fontSize: 18 }}>BT<span style={{ color: '#90CAF9' }}>POS</span></span>
          <span style={{ color: '#90CAF9', fontSize: 13 }}>Hoş geldiniz</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ color: '#BBDEFB', fontSize: 13 }}>
            {time.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' — '}
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </span>
        </div>
      </div>

      {/* Ana içerik */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32, padding: 40 }}>

        {/* Kasiyer kartı */}
        <div style={{ background: 'white', borderRadius: 16, padding: '24px 40px', textAlign: 'center', border: '1px solid #E0E0E0', minWidth: 320 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: '#E3F2FD', display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px', fontSize: 28, fontWeight: 600, color: '#1565C0'
          }}>
            {cashier.fullName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#212121' }}>{cashier.fullName}</div>
          <div style={{ fontSize: 13, color: '#9E9E9E', marginTop: 4 }}>
            Kod: {cashier.cashierCode} · {cashier.role === 'manager' ? 'Yönetici' : 'Kasiyer'}
          </div>
        </div>

        {/* Günlük özet kartları */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 160px)', gap: 16 }}>
          {[
            { label: 'Satış Sayısı', value: String(summary.saleCount), unit: 'adet', color: '#1565C0', bg: '#E3F2FD' },
            { label: 'Günlük Ciro', value: fmt(summary.totalSales), unit: '₺', color: '#2E7D32', bg: '#E8F5E9' },
            { label: 'Nakit', value: fmt(summary.totalCash), unit: '₺', color: '#E65100', bg: '#FFF8E1' },
            { label: 'Kart', value: fmt(summary.totalCard), unit: '₺', color: '#6A1B9A', bg: '#F3E5F5' },
          ].map(card => (
            <div key={card.label} style={{
              background: card.bg, borderRadius: 12,
              padding: '16px 20px', textAlign: 'center',
              border: `1px solid ${card.bg}`
            }}>
              <div style={{ fontSize: 11, color: card.color, marginBottom: 6, fontWeight: 500 }}>{card.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: card.color }}>{card.value}</div>
              <div style={{ fontSize: 11, color: card.color, marginTop: 2 }}>{card.unit}</div>
            </div>
          ))}
        </div>

        {/* Ana butonlar */}
        <div style={{ display: 'flex', gap: 20 }}>
          {/* SATIŞ BAŞLAT — büyük ve dikkat çekici */}
          <button
            onClick={onStartSale}
            style={{
              background: '#1565C0', color: 'white',
              border: 'none', borderRadius: 16, cursor: 'pointer',
              width: 280, height: 120,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 22, fontWeight: 600,
              boxShadow: '0 4px 20px rgba(21,101,192,0.3)',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'
              ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 28px rgba(21,101,192,0.4)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'
              ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(21,101,192,0.3)'
            }}
          >
            <span style={{ fontSize: 36 }}>🛒</span>
            <span>Satış Başlat</span>
          </button>

          {/* Ürünleri Güncelle */}
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              background: 'white', color: '#424242',
              border: '1px solid #E0E0E0', borderRadius: 16, cursor: syncing ? 'default' : 'pointer',
              width: 160, height: 120,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 14, fontWeight: 500,
              opacity: syncing ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: 28 }}>🔄</span>
            <span>{syncing ? 'Güncelleniyor...' : 'Ürünleri Güncelle'}</span>
          </button>

          {/* Çıkış */}
          <button
            onClick={onLogout}
            style={{
              background: 'white', color: '#C62828',
              border: '1px solid #FFCDD2', borderRadius: 16, cursor: 'pointer',
              width: 160, height: 120,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 14, fontWeight: 500,
            }}
          >
            <span style={{ fontSize: 28 }}>🚪</span>
            <span>Kasiyer Çıkışı</span>
          </button>
        </div>
      </div>
    </div>
  )
}
```

---

## ADIM 4 — POSScreen Komple Yeniden Tasarım

### `src/screens/POSScreen.tsx` — Dosyayı tamamen değiştir

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useLicenseCheck } from '../hooks/useLicenseCheck'
import LicenseBanner from '../components/LicenseBanner'

interface CartItem {
  id: string
  code: string
  name: string
  category: string
  price: number
  vatRate: number
  unit: string
  quantity: number
  lineTotal: number
}

interface Props {
  companyId: string
  cashier: CashierRow
  allProducts: ProductRow[]
  onBack: () => void
  onLogout: () => void
}

// Fiş numarası
let receiptCounter = parseInt(localStorage.getItem('btpos_receipt') || '1000')
function nextReceiptNo(): string {
  receiptCounter++
  localStorage.setItem('btpos_receipt', String(receiptCounter))
  return `FIS-${String(receiptCounter).padStart(5, '0')}`
}

// Para formatı
const fmtMoney = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function POSScreen({ companyId, cashier, allProducts, onBack, onLogout }: Props) {
  const [cart, setCart]               = useState<CartItem[]>([])
  const [search, setSearch]           = useState('')
  const [activeGroup, setActiveGroup] = useState('Tümü')
  const [page, setPage]               = useState(0)
  const [paymentMode, setPaymentMode] = useState(false)
  const [paymentType, setPaymentType] = useState<'cash' | 'card' | 'mixed'>('cash')
  const [cashInput, setCashInput]     = useState('')
  const [saving, setSaving]           = useState(false)
  const [lastReceipt, setLastReceipt] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const license   = useLicenseCheck(companyId)

  const ITEMS_PER_PAGE = 25 // 5x5

  // Grupları ERP'deki category alanından çıkar
  const groups = ['Tümü', ...Array.from(new Set(allProducts.map(p => p.category || 'Diğer').filter(Boolean)))]

  // Filtrele
  const filtered = allProducts.filter(p => {
    const matchGroup  = activeGroup === 'Tümü' || (p.category || 'Diğer') === activeGroup
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.code ?? '').includes(search) || (p.barcode ?? '').includes(search)
    return matchGroup && matchSearch
  })

  const totalPages  = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated   = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE)

  // Grup değişince ilk sayfaya dön
  useEffect(() => { setPage(0) }, [activeGroup, search])

  // Barkod okuyucu — 300ms gecikme ile tam eşleşme
  useEffect(() => {
    if (search.length < 2) return
    const t = setTimeout(() => {
      const byBarcode = allProducts.find(p => p.barcode === search)
      if (byBarcode) { addToCart(byBarcode); setSearch('') }
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { searchRef.current?.focus() }, [])

  function addToCart(product: ProductRow) {
    setCart(prev => {
      const ex = prev.find(c => c.id === product.id)
      if (ex) {
        return prev.map(c => c.id === product.id
          ? { ...c, quantity: c.quantity + 1, lineTotal: (c.quantity + 1) * c.price }
          : c
        )
      }
      return [...prev, {
        id:        product.id,
        code:      product.code ?? '',
        name:      product.name,
        category:  product.category ?? '',
        price:     product.price,
        vatRate:   product.vatRate ?? 18,
        unit:      product.unit ?? 'Adet',
        quantity:  1,
        lineTotal: product.price,
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

  function clearCart() {
    setCart([])
    setPaymentMode(false)
    setCashInput('')
    setPaymentType('cash')
  }

  const subTotal   = cart.reduce((s, c) => s + c.lineTotal, 0)
  const vatTotal   = cart.reduce((s, c) => s + (c.lineTotal * c.vatRate / (100 + c.vatRate)), 0)
  const grandTotal = subTotal
  const cashAmount = parseFloat(cashInput) || 0
  const change     = cashAmount - grandTotal

  async function completeSale() {
    if (cart.length === 0) return
    setSaving(true)
    try {
      const receiptNo = nextReceiptNo()
      const saleData: SaleRow = {
        receiptNo,
        totalAmount: grandTotal,
        paymentType,
        cashAmount: paymentType === 'card'  ? 0 : (paymentType === 'cash' ? cashAmount || grandTotal : cashAmount),
        cardAmount: paymentType === 'cash'  ? 0 : (paymentType === 'card' ? grandTotal : grandTotal - cashAmount),
      }
      const items: SaleItem[] = cart.map(c => ({
        productId:   c.id,
        productName: c.name,
        quantity:    c.quantity,
        unitPrice:   c.price,
        vatRate:     c.vatRate,
        lineTotal:   c.lineTotal,
      }))
      await window.electron.db.saveSale(saleData, items)
      setLastReceipt(receiptNo)
      clearCart()
      searchRef.current?.focus()
    } catch (e) {
      alert('Satış kaydedilemedi: ' + (e instanceof Error ? e.message : 'Hata'))
    } finally {
      setSaving(false)
    }
  }

  // --- STYLES ---
  const S = {
    // Genel
    root: { display: 'flex', flexDirection: 'column' as const, height: '100vh', background: '#F0F2F5', overflow: 'hidden' },

    // Header
    header: { background: '#1565C0', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', flexShrink: 0 },
    headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
    headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
    logoText: { color: 'white', fontWeight: 700, fontSize: 16 },
    logoAccent: { color: '#90CAF9' },
    headerBtn: { background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, color: 'white', padding: '5px 12px', cursor: 'pointer', fontSize: 12 },
    cashierBadge: { background: 'rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 10px', color: '#BBDEFB', fontSize: 12 },

    // Ana alan
    body: { flex: 1, display: 'flex', overflow: 'hidden' },

    // SOL — PLU
    left: { width: 400, display: 'flex', flexDirection: 'column' as const, background: '#F0F2F5', flexShrink: 0 },

    // Arama
    searchWrap: { padding: '10px 10px 6px', flexShrink: 0 },
    searchInput: { width: '100%', background: 'white', border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },

    // Gruplar
    groupsWrap: { padding: '0 10px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' as const, flexShrink: 0 },
    groupBtn: { border: '1px solid #E0E0E0', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'white', color: '#424242', whiteSpace: 'nowrap' as const },
    groupBtnActive: { background: '#1565C0', color: 'white', border: '1px solid #1565C0' },

    // PLU grid
    pluGrid: { flex: 1, overflowY: 'auto' as const, padding: '0 10px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, alignContent: 'start' },
    pluBtn: { background: 'white', border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 4px', cursor: 'pointer', textAlign: 'center' as const, transition: 'border-color 0.15s, background 0.15s', minHeight: 70 },

    // Sayfalama
    pagination: { padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', borderTop: '1px solid #E0E0E0', flexShrink: 0 },
    pageBtn: { background: '#F0F2F5', border: '1px solid #E0E0E0', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#424242' },

    // SAĞ — Sepet
    right: { flex: 1, display: 'flex', flexDirection: 'column' as const, background: 'white', borderLeft: '1px solid #E0E0E0' },

    // Sepet header
    cartHeader: { padding: '10px 16px', borderBottom: '1px solid #F0F0F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },

    // Tablo başlığı
    tableHeader: { display: 'grid', gridTemplateColumns: '1fr 130px 100px 110px 40px', padding: '6px 16px', background: '#F8F9FA', borderBottom: '1px solid #E0E0E0', flexShrink: 0 },
    thCell: { fontSize: 10, color: '#9E9E9E', fontWeight: 500 },

    // Kalem listesi
    cartList: { flex: 1, overflowY: 'auto' as const },
    cartRow: { display: 'grid', gridTemplateColumns: '1fr 130px 100px 110px 40px', padding: '10px 16px', alignItems: 'center', borderBottom: '1px solid #F5F5F5' },

    // Tuş
    qtyBtn: { width: 26, height: 26, background: '#F0F2F5', border: '1px solid #E0E0E0', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#424242' },
    delBtn: { width: 26, height: 26, background: '#FFEBEE', border: '1px solid #FFCDD2', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#C62828' },

    // Özet
    summary: { borderTop: '1px solid #E0E0E0', padding: '12px 16px', flexShrink: 0 },
    summaryRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },

    // Ödeme
    payArea: { padding: '0 16px 12px', flexShrink: 0 },
    payBtns: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 },
    payBtn: { border: 'none', borderRadius: 10, padding: '12px 8px', cursor: 'pointer', textAlign: 'center' as const, fontSize: 13, fontWeight: 600 },
  }

  return (
    <div style={S.root}>
      {/* Lisans uyarısı */}
      {license?.warning && <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />}

      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <span style={S.logoText}>BT<span style={S.logoAccent}>POS</span></span>
          <button onClick={onBack} style={S.headerBtn}>← Dashboard</button>
          {lastReceipt && (
            <span style={{ background: '#E8F5E9', color: '#2E7D32', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 500 }}>
              ✓ {lastReceipt} kaydedildi
            </span>
          )}
        </div>
        <div style={S.headerRight}>
          <span style={S.cashierBadge}>{cashier.fullName} · {cashier.cashierCode}</span>
          <button onClick={onLogout} style={{ ...S.headerBtn, background: 'rgba(198,40,40,0.3)' }}>Çıkış</button>
        </div>
      </div>

      {/* Body */}
      <div style={S.body}>

        {/* SOL — PLU */}
        <div style={S.left}>
          {/* Arama */}
          <div style={S.searchWrap}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Barkod okut veya ürün ara..."
              style={S.searchInput}
            />
          </div>

          {/* Gruplar */}
          <div style={S.groupsWrap}>
            {groups.map(g => (
              <button
                key={g}
                onClick={() => setActiveGroup(g)}
                style={g === activeGroup ? { ...S.groupBtn, ...S.groupBtnActive } : S.groupBtn}
              >
                {g}
              </button>
            ))}
          </div>

          {/* PLU Grid */}
          <div style={S.pluGrid}>
            {paginated.map(p => (
              <button
                key={p.id}
                onClick={() => { addToCart(p); searchRef.current?.focus() }}
                className="plu-btn"
                style={S.pluBtn}
              >
                <div style={{ fontSize: 9, color: '#BDBDBD', marginBottom: 2 }}>{p.code}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: '#212121', lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1565C0' }}>{fmtMoney(p.price)} ₺</div>
              </button>
            ))}
          </div>

          {/* Sayfalama */}
          <div style={S.pagination}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ ...S.pageBtn, opacity: page === 0 ? 0.4 : 1 }}
            >← Önceki</button>
            <span style={{ fontSize: 11, color: '#757575' }}>
              Sayfa {page + 1} / {Math.max(1, totalPages)} · {filtered.length} ürün
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{ ...S.pageBtn, opacity: page >= totalPages - 1 ? 0.4 : 1 }}
            >Sonraki →</button>
          </div>
        </div>

        {/* SAĞ — Sepet */}
        <div style={S.right}>
          {/* Sepet başlık */}
          <div style={S.cartHeader}>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#212121' }}>
              Sepet <span style={{ fontWeight: 400, color: '#9E9E9E', fontSize: 12 }}>({cart.length} kalem)</span>
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  style={{ background: '#FFEBEE', border: '1px solid #FFCDD2', borderRadius: 6, color: '#C62828', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
                >
                  Sepeti Temizle
                </button>
              )}
            </div>
          </div>

          {/* Tablo başlığı */}
          <div style={S.tableHeader}>
            <span style={S.thCell}>Ürün</span>
            <span style={{ ...S.thCell, textAlign: 'center' }}>Adet</span>
            <span style={{ ...S.thCell, textAlign: 'right' }}>Birim Fiyat</span>
            <span style={{ ...S.thCell, textAlign: 'right' }}>Toplam</span>
            <span style={S.thCell}></span>
          </div>

          {/* Kalem listesi */}
          <div style={S.cartList}>
            {cart.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#BDBDBD', fontSize: 14 }}>
                Sepet boş — ürün seçin veya barkod okutun
              </div>
            ) : (
              cart.map(item => (
                <div key={item.id} style={S.cartRow}>
                  {/* Ürün bilgisi */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#212121' }}>{item.name}</div>
                    <div style={{ fontSize: 10, color: '#BDBDBD', marginTop: 2 }}>
                      {item.code && `${item.code} · `}{item.category}
                    </div>
                  </div>

                  {/* Adet */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <button onClick={() => updateQty(item.id, -1)} style={S.qtyBtn}>−</button>
                    <span style={{ fontSize: 14, fontWeight: 600, minWidth: 24, textAlign: 'center', color: '#212121' }}>{item.quantity}</span>
                    <button onClick={() => updateQty(item.id, 1)} style={S.qtyBtn}>+</button>
                  </div>

                  {/* Birim fiyat */}
                  <div style={{ textAlign: 'right', fontSize: 12, color: '#757575' }}>
                    {fmtMoney(item.price)} ₺
                  </div>

                  {/* Toplam */}
                  <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#212121' }}>
                    {fmtMoney(item.lineTotal)} ₺
                  </div>

                  {/* Sil */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button onClick={() => removeFromCart(item.id)} style={S.delBtn}>✕</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Özet */}
          <div style={S.summary}>
            <div style={S.summaryRow}>
              <span style={{ fontSize: 13, color: '#9E9E9E' }}>Ara Toplam</span>
              <span style={{ fontSize: 13, color: '#424242' }}>{fmtMoney(subTotal - vatTotal)} ₺</span>
            </div>
            <div style={S.summaryRow}>
              <span style={{ fontSize: 13, color: '#9E9E9E' }}>KDV</span>
              <span style={{ fontSize: 13, color: '#424242' }}>{fmtMoney(vatTotal)} ₺</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid #E0E0E0', marginTop: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 600, color: '#212121' }}>Genel Toplam</span>
              <span style={{ fontSize: 26, fontWeight: 700, color: '#1565C0' }}>{fmtMoney(grandTotal)} ₺</span>
            </div>
          </div>

          {/* Ödeme alanı */}
          <div style={S.payArea}>
            {!paymentMode ? (
              <div style={S.payBtns}>
                <button
                  onClick={() => { setPaymentType('cash'); setPaymentMode(true) }}
                  disabled={cart.length === 0}
                  style={{ ...S.payBtn, background: cart.length === 0 ? '#F5F5F5' : '#E8F5E9', color: cart.length === 0 ? '#BDBDBD' : '#2E7D32', border: '1px solid ' + (cart.length === 0 ? '#E0E0E0' : '#A5D6A7') }}
                >
                  Nakit Ödeme
                </button>
                <button
                  onClick={() => { setPaymentType('card'); completeSale() }}
                  disabled={cart.length === 0}
                  style={{ ...S.payBtn, background: cart.length === 0 ? '#F5F5F5' : '#E3F2FD', color: cart.length === 0 ? '#BDBDBD' : '#1565C0', border: '1px solid ' + (cart.length === 0 ? '#E0E0E0' : '#90CAF9') }}
                >
                  Kart Ödeme
                </button>
                <button
                  onClick={() => { setPaymentType('mixed'); setPaymentMode(true) }}
                  disabled={cart.length === 0}
                  style={{ ...S.payBtn, background: cart.length === 0 ? '#F5F5F5' : '#FFF8E1', color: cart.length === 0 ? '#BDBDBD' : '#E65100', border: '1px solid ' + (cart.length === 0 ? '#E0E0E0' : '#FFD54F') }}
                >
                  Karma Ödeme
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(paymentType === 'cash' || paymentType === 'mixed') && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <label style={{ fontSize: 13, color: '#757575', whiteSpace: 'nowrap' }}>
                      {paymentType === 'mixed' ? 'Nakit Tutar (₺):' : 'Alınan Nakit (₺):'}
                    </label>
                    <input
                      type="number"
                      value={cashInput}
                      onChange={e => setCashInput(e.target.value)}
                      autoFocus
                      style={{ flex: 1, border: '1px solid #90CAF9', borderRadius: 8, padding: '8px 12px', fontSize: 16, fontWeight: 600, outline: 'none', color: '#212121' }}
                    />
                    {paymentType === 'cash' && cashAmount >= grandTotal && cashAmount > 0 && (
                      <span style={{ fontSize: 13, color: '#2E7D32', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        Para üstü: {fmtMoney(change)} ₺
                      </span>
                    )}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                  <button
                    onClick={() => { setPaymentMode(false); setCashInput('') }}
                    style={{ ...S.payBtn, background: '#F5F5F5', color: '#424242', border: '1px solid #E0E0E0' }}
                  >
                    İptal
                  </button>
                  <button
                    onClick={completeSale}
                    disabled={saving || (paymentType === 'cash' && cashAmount < grandTotal)}
                    style={{
                      ...S.payBtn, fontSize: 15,
                      background: (saving || (paymentType === 'cash' && cashAmount < grandTotal)) ? '#F5F5F5' : '#2E7D32',
                      color: (saving || (paymentType === 'cash' && cashAmount < grandTotal)) ? '#BDBDBD' : 'white',
                      border: 'none',
                    }}
                  >
                    {saving ? 'Kaydediliyor...' : 'Satışı Tamamla ✓'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## ADIM 5 — App.tsx Güncelle (Dashboard ekranı ekle)

Dosyayı tamamen şununla değiştir:

```tsx
import { useEffect, useState } from 'react'
import ActivationScreen   from './screens/ActivationScreen'
import CashierLoginScreen from './screens/CashierLoginScreen'
import DashboardScreen    from './screens/DashboardScreen'
import POSScreen          from './screens/POSScreen'

type AppState = 'loading' | 'activation' | 'cashier_login' | 'dashboard' | 'pos'

export default function App() {
  const [state, setState]               = useState<AppState>('loading')
  const [companyId, setCompanyId]       = useState<string | null>(null)
  const [cashier, setCashier]           = useState<CashierRow | null>(null)
  const [allProducts, setAllProducts]   = useState<ProductRow[]>([])

  useEffect(() => { checkActivation() }, [])

  async function checkActivation() {
    const activated       = await window.electron.store.get('activated')
    const storedCompanyId = await window.electron.store.get('company_id')
    if (activated && storedCompanyId) {
      setCompanyId(storedCompanyId as string)
      setState('cashier_login')
    } else {
      setState('activation')
    }
  }

  function handleActivated(cId: string) {
    setCompanyId(cId)
    setState('cashier_login')
  }

  function handleCashierLogin(c: CashierRow) {
    setCashier(c)
    setState('dashboard')
  }

  function handleStartSale() {
    // Ürünleri SQLite'tan yükle
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
        onStartSale={handleStartSale}
        onLogout={handleLogout}
      />
    )

  return (
    <POSScreen
      companyId={companyId!}
      cashier={cashier!}
      allProducts={allProducts}
      onBack={() => setState('dashboard')}
      onLogout={handleLogout}
    />
  )
}
```

---

## ADIM 6 — `SaleRecord` tipine `totalAmount` alanı ekle

`src/electron.d.ts` içinde `SaleRecord` interface'ini şununla değiştir:

```typescript
interface SaleRecord {
  id:          string
  receiptNo:   string
  totalAmount: number
  paymentType: string
  createdAt:   string
}
```

---

## Sprint 4 Teslim Kriterleri

- [ ] `npm run dev` açıldığında kiosk modu çalışmıyor (geliştirme), build alınca çalışıyor
- [ ] Kasiyer girişi sonrası Dashboard ekranı açılıyor
- [ ] Dashboard'da saat, kasiyer adı, günlük özet kartları görünüyor
- [ ] "Satış Başlat" butonu büyük ve belirgin
- [ ] Satış ekranı açık renkli (beyaz/gri)
- [ ] Sol PLU alanı dar, 5 sütun, küçük butonlar
- [ ] Grup sekmeleri ERP'den gelen `category` alanından oluşuyor
- [ ] Sayfalama çalışıyor (25 ürün/sayfa)
- [ ] Barkod okuyucu çalışıyor (tam eşleşme → anında sepete)
- [ ] Sağ sepet geniş, tablo formatında
- [ ] Nakit → para üstü hesaplanıyor
- [ ] Kart → direkt tamamlanıyor (nakit girişi istenmiyor)
- [ ] Karma → nakit tutar girilince kart kısmı otomatik hesaplanıyor
- [ ] Satış tamamlanınca sepet temizleniyor, fiş no gösteriliyor
- [ ] Dashboard → Satış → Dashboard akışı çalışıyor
- [ ] Çıkış → Kasiyer giriş ekranına dönüyor

---

## Sprint 5 Önizlemesi

| Konu |
|------|
| Fiş yazdırma (ESC/POS termal yazıcı) |
| Günsonu ekranı (Z raporu) |
| Management paneline kasiyer yönetimi |
| İndirim / iskonto uygulama |

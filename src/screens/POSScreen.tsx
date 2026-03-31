import { useState, useEffect, useRef, useCallback } from 'react'
import { useLicenseCheck } from '../hooks/useLicenseCheck'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import LicenseBanner from '../components/LicenseBanner'
import ConnectionDot from '../components/ConnectionDot'
import { api } from '../lib/api'

interface CartItem {
  id:        string
  code:      string
  name:      string
  category:  string
  price:     number
  vatRate:   number
  unit:      string
  quantity:  number
  lineTotal: number
}

interface Props {
  companyId:       string
  cashier:         CashierRow
  allProducts:     ProductRow[]
  pluGroups:       PluGroupCacheRow[]
  posSettings:     PosSettingsRow
  onBack:          () => void
  onLogout:        () => void
  pendingMessage?: { text: string } | null
  onMessageClose?: () => void
  merkezToast?:    string | null
}

const fmt = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'

let receiptCounter = parseInt(localStorage.getItem('btpos_receipt') || '1000')
function nextReceiptNo(): string {
  receiptCounter++
  localStorage.setItem('btpos_receipt', String(receiptCounter))
  return `FIS-${String(receiptCounter).padStart(5, '0')}`
}

const PLU_PER_PAGE = 9  // 3 × 3 fix

export default function POSScreen({
  companyId, cashier, allProducts,
  pluGroups, posSettings,
  onBack, onLogout,
  pendingMessage, onMessageClose,
  merkezToast = null,
}: Props) {

  /* ── State ── */
  const [cart, setCart]                   = useState<CartItem[]>([])
  const [numBuf, setNumBuf]               = useState('')
  const [activeGroup, setActiveGroup]     = useState<string | null>(null)
  const [page, setPage]                   = useState(0)
  const [searchQ, setSearchQ]             = useState('')
  const [paymentMode, setPaymentMode]     = useState(false)
  const [paymentType, setPaymentType]     = useState<'cash' | 'card' | 'mixed'>('cash')
  const [cashInput, setCashInput]         = useState('')
  const [saving, setSaving]               = useState(false)
  const [lastReceipt, setLastReceipt]     = useState<string | null>(null)
  const [cancelMode, setCancelMode]       = useState(false)
  const [menuOpen, setMenuOpen]           = useState(false)
  const [heldDocs, setHeldDocs]           = useState<HeldDocRow[]>([])
  const [showHeld, setShowHeld]           = useState(false)
  const [showCustomer, setShowCustomer]   = useState(false)
  const [customers, setCustomers]         = useState<CustomerRow[]>([])
  const [customerQ, setCustomerQ]         = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const license   = useLicenseCheck(companyId)
  const conn      = useConnectionStatus(30)

  /* ── İlk grup seç ── */
  useEffect(() => {
    if (pluGroups.length > 0 && !activeGroup) {
      setActiveGroup(pluGroups[0].id)
    }
  }, [pluGroups])

  /* ── Bekletilen belgeler ── */
  const loadHeld = useCallback(async () => {
    const docs = await window.electron.db.getHeldDocuments(companyId).catch(() => [])
    setHeldDocs(docs)
  }, [companyId])

  useEffect(() => { loadHeld() }, [loadHeld])
  useEffect(() => { searchRef.current?.focus() }, [])

  /* ── Ürün listesi ── */
  const groupProducts = (() => {
    if (!activeGroup) return allProducts
    const g = pluGroups.find(x => x.id === activeGroup)
    if (!g || !g.plu_items?.length) return []
    return g.plu_items
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(item => allProducts.find(p => p.code === item.product_code))
      .filter(Boolean) as ProductRow[]
  })()

  const filtered = searchQ
    ? allProducts.filter(p =>
        p.name.toLowerCase().includes(searchQ.toLowerCase()) ||
        (p.code ?? '').toLowerCase().includes(searchQ.toLowerCase()) ||
        (p.barcode ?? '').includes(searchQ)
      )
    : groupProducts

  const totalPages = Math.max(1, Math.ceil(filtered.length / PLU_PER_PAGE))
  const safePage   = Math.min(page, totalPages - 1)
  const slice      = filtered.slice(safePage * PLU_PER_PAGE, (safePage + 1) * PLU_PER_PAGE)

  useEffect(() => { setPage(0) }, [activeGroup, searchQ])

  /* ── Barkod okuyucu ── */
  useEffect(() => {
    if (searchQ.length < 2) return
    const t = setTimeout(() => {
      const p = allProducts.find(x => x.barcode === searchQ)
      if (p) {
        addToCartWithQty(p, numBuf ? Math.max(1, parseInt(numBuf)) : 1)
        setNumBuf('')
        setSearchQ('')
      }
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ])

  /* ── Sepet işlemleri ── */
  function addToCartWithQty(product: ProductRow, qty: number) {
    setCart(prev => {
      const ex = prev.find(c => c.id === product.id)
      if (ex) return prev.map(c => c.id === product.id
        ? { ...c, quantity: c.quantity + qty, lineTotal: (c.quantity + qty) * c.price }
        : c
      )
      return [...prev, {
        id: product.id, code: product.code ?? '', name: product.name,
        category: product.category ?? '', price: product.price,
        vatRate: product.vatRate ?? 18, unit: product.unit ?? 'Adet',
        quantity: qty, lineTotal: product.price * qty,
      }]
    })
  }

  function handlePluClick(product: ProductRow) {
    const qty = numBuf ? Math.max(1, parseInt(numBuf)) : 1
    setNumBuf('')
    addToCartWithQty(product, qty)
    searchRef.current?.focus()
  }

  function updateQty(id: string, delta: number) {
    setCart(prev => prev
      .map(c => c.id === id
        ? { ...c, quantity: Math.max(1, c.quantity + delta), lineTotal: Math.max(1, c.quantity + delta) * c.price }
        : c
      )
    )
  }

  function removeFromCart(id: string) {
    setCart(prev => {
      const next = prev.filter(c => c.id !== id)
      if (cancelMode && next.length === 0) setCancelMode(false)
      return next
    })
  }

  function clearCart() {
    setCart([])
    setPaymentMode(false)
    setCashInput('')
    setPaymentType('cash')
    setNumBuf('')
    setCancelMode(false)
    setSelectedCustomer(null)
    setMenuOpen(false)
  }

  function handleNumKey(k: string) {
    if (k === 'C')  { setNumBuf(''); return }
    if (k === '⌫') { setNumBuf(p => p.slice(0, -1)); return }
    if (numBuf.length < 4) setNumBuf(p => p + k)
  }

  /* ── Menü işlemleri ── */
  function closeMenu() { setMenuOpen(false) }

  async function holdDoc() {
    if (!cart.length) return
    const label = selectedCustomer
      ? `Müşteri: ${selectedCustomer.name}`
      : `Bekletilen ${new Date().toLocaleTimeString('tr-TR')}`
    await window.electron.db.holdDocument({
      companyId, label, items: cart,
      totalAmount: cart.reduce((s, c) => s + c.lineTotal, 0),
    })
    clearCart()
    loadHeld()
    closeMenu()
  }

  async function retrieveDoc(doc: HeldDocRow) {
    setCart(doc.items)
    await window.electron.db.deleteHeldDocument(doc.id)
    loadHeld()
    setShowHeld(false)
  }

  async function loadCustomers() {
    setShowCustomer(true)
    closeMenu()
    if (customers.length > 0) return
    const list = await api.getCustomers(companyId).catch(() => [])
    setCustomers(list)
  }

  /* ── Ödeme ── */
  const grandTotal = cart.reduce((s, c) => s + c.lineTotal, 0)
  const vatTotal   = cart.reduce((s, c) => s + (c.lineTotal * c.vatRate / (100 + c.vatRate)), 0)
  const cashAmount = parseFloat(cashInput) || 0
  const change     = cashAmount - grandTotal

  async function completeSale() {
    if (!cart.length) return
    setSaving(true)
    try {
      const receiptNo = nextReceiptNo()
      await window.electron.db.saveSale({
        receiptNo, totalAmount: grandTotal, paymentType,
        cashAmount: paymentType === 'card'  ? 0 : (paymentType === 'cash' ? cashAmount || grandTotal : cashAmount),
        cardAmount: paymentType === 'cash'  ? 0 : (paymentType === 'card' ? grandTotal : grandTotal - cashAmount),
      }, cart.map(c => ({
        productId: c.id, productName: c.name, quantity: c.quantity,
        unitPrice: c.price, vatRate: c.vatRate, lineTotal: c.lineTotal,
      })))
      setLastReceipt(receiptNo)
      clearCart()
      searchRef.current?.focus()
    } catch (e) {
      alert('Satış kaydedilemedi: ' + (e instanceof Error ? e.message : 'Hata'))
    } finally {
      setSaving(false)
    }
  }

  /* ── Renkler ── */
  const activeColor = pluGroups.find(g => g.id === activeGroup)?.color ?? '#1565C0'
  const activeSoft  = (pluGroups.find(g => g.id === activeGroup) as { soft?: string } | undefined)?.soft ?? '#E3F2FD'

  /* ────────── RENDER ────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#e5e7eb', overflow: 'hidden' }}>

      {/* Lisans banner */}
      {license?.warning && <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />}

      {/* ── HEADER ── */}
      <div style={{ background: '#1565C0', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>
            BT<span style={{ color: '#90CAF9' }}>POS</span>
          </span>
          <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, color: 'white', padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
            ← Dashboard
          </button>
          {lastReceipt && (
            <span style={{ background: '#E8F5E9', color: '#2E7D32', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 500 }}>
              ✓ {lastReceipt}
            </span>
          )}
          {selectedCustomer && (
            <span style={{ background: 'rgba(255,255,255,0.15)', color: '#E3F2FD', borderRadius: 6, padding: '3px 8px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
              👤 {selectedCustomer.name}
              <button onClick={() => setSelectedCustomer(null)} style={{ background: 'none', border: 'none', color: '#90CAF9', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConnectionDot status={conn} />
          <span style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 6, padding: '3px 8px', color: '#BBDEFB', fontSize: 11 }}>
            {cashier.fullName}
          </span>
          <button onClick={onLogout} style={{ background: 'rgba(198,40,40,0.3)', border: 'none', borderRadius: 6, color: 'white', padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
            Çıkış
          </button>
        </div>
      </div>

      {/* ── MODALLER ── */}

      {/* Mesaj popup */}
      {pendingMessage && onMessageClose && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 16, padding: '36px 40px', maxWidth: 480, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Yönetici Mesajı</div>
            <div style={{ fontSize: 14, color: '#424242', lineHeight: 1.7, marginBottom: 28 }}>{pendingMessage.text}</div>
            <button onClick={onMessageClose} style={{ background: '#1565C0', color: 'white', border: 'none', borderRadius: 10, padding: '12px 40px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Tamam, Anlaşıldı
            </button>
          </div>
        </div>
      )}

      {/* Bekletilen belgeler */}
      {showHeld && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 14, padding: 24, width: 440, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Bekletilen Belgeler</span>
              <button onClick={() => setShowHeld(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9E9E9E' }}>✕</button>
            </div>
            {heldDocs.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#BDBDBD', padding: '32px 0', fontSize: 13 }}>Bekletilen belge yok</div>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {heldDocs.map(doc => (
                  <div key={doc.id} style={{ border: '1px solid #E0E0E0', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{doc.label ?? 'Belge'}</div>
                      <div style={{ fontSize: 11, color: '#9E9E9E', marginTop: 2 }}>
                        {doc.items.length} kalem · {fmt(doc.totalAmount)} · {new Date(doc.createdAt).toLocaleTimeString('tr-TR')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => retrieveDoc(doc)} style={{ background: '#E3F2FD', border: '1px solid #90CAF9', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#1565C0' }}>
                        Getir
                      </button>
                      <button onClick={async () => { await window.electron.db.deleteHeldDocument(doc.id); loadHeld() }} style={{ background: '#FFEBEE', border: '1px solid #FFCDD2', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontSize: 12, color: '#C62828' }}>
                        Sil
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Müşteri seç */}
      {showCustomer && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 14, padding: 24, width: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Müşteri Seç</span>
              <button onClick={() => setShowCustomer(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9E9E9E' }}>✕</button>
            </div>
            <input
              autoFocus
              value={customerQ}
              onChange={e => setCustomerQ(e.target.value)}
              placeholder="İsim veya kod ile ara..."
              style={{ border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', marginBottom: 12 }}
            />
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {customers
                .filter(c => !customerQ || c.name.toLowerCase().includes(customerQ.toLowerCase()) || c.code.includes(customerQ))
                .slice(0, 50)
                .map(c => (
                  <div key={c.id}
                    onClick={() => { setSelectedCustomer(c); setShowCustomer(false); setCustomerQ('') }}
                    style={{ border: '1px solid #F0F0F0', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#F0F4FF'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'white'}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: '#9E9E9E' }}>{c.code}{c.phone && ` · ${c.phone}`}</div>
                    </div>
                    {c.balance !== 0 && (
                      <span style={{ fontSize: 12, color: c.balance > 0 ? '#2E7D32' : '#C62828', fontWeight: 600 }}>
                        {fmt(c.balance)}
                      </span>
                    )}
                  </div>
                ))}
              {customers.length === 0 && (
                <div style={{ textAlign: 'center', color: '#BDBDBD', padding: '32px 0', fontSize: 13 }}>
                  Müşteriler yükleniyor...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 4 PANEL ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ① SEPET — flex:1, kalan alanı doldurur */}
        <div style={{ flex: 1, minWidth: 320, background: 'white', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e0e0e0' }}>

          {/* Başlık */}
          <div style={{ padding: '8px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 40, flexShrink: 0, background: '#f8f9fa' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>Satış Belgesi</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{cart.length > 0 ? `${cart.length} kalem` : 'Boş'}</span>
              {cart.length > 0 && (
                <>
                  <button
                    onClick={() => { if (!cancelMode && !cart.length) return; setCancelMode(m => !m) }}
                    style={{ background: cancelMode ? '#dc2626' : 'none', border: cancelMode ? 'none' : 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: cancelMode ? 'white' : '#9ca3af', padding: '2px 8px' }}
                  >
                    ✕ {cancelMode ? 'İptal Modunu Kapat' : 'İptal'}
                  </button>
                  <button onClick={clearCart} style={{ background: '#FFEBEE', border: '1px solid #FFCDD2', borderRadius: 5, cursor: 'pointer', fontSize: 10, color: '#C62828', padding: '2px 8px' }}>
                    Temizle
                  </button>
                </>
              )}
            </div>
          </div>

          {/* İptal banner */}
          {cancelMode && (
            <div style={{ background: '#dc2626', color: 'white', fontSize: 11, fontWeight: 600, textAlign: 'center', padding: 5, flexShrink: 0 }}>
              ✕ İptal Modu — Kaldırmak istediğiniz satıra tıklayın
            </div>
          )}

          {/* Sütun başlıkları */}
          <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 100px 80px 90px 36px', padding: '5px 14px', background: '#f0f2f4', borderBottom: '1px solid #e0e0e0', flexShrink: 0 }}>
            {['İşlem', 'Ürün Adı', 'Miktar', 'Birim Fiyat', 'Tutar', ''].map((h, i) => (
              <span key={i} style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px', textAlign: i >= 2 ? 'center' : 'left' }}>{h}</span>
            ))}
          </div>

          {/* Satır listesi */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {cart.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#d1d5db', fontSize: 13, flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 32 }}>🛒</span>
                <span>Sepet boş — ürün seçin veya barkod okutun</span>
              </div>
            ) : cart.map(item => (
              <div
                key={item.id}
                onClick={() => cancelMode && removeFromCart(item.id)}
                style={{ display: 'grid', gridTemplateColumns: '52px 1fr 100px 80px 90px 36px', padding: '8px 14px', alignItems: 'center', borderBottom: '1px solid #f5f5f5', cursor: cancelMode ? 'pointer' : 'default', background: cancelMode ? 'rgba(220,38,38,0.03)' : 'white', transition: 'background 0.1s' }}
                onMouseEnter={e => cancelMode && ((e.currentTarget as HTMLDivElement).style.background = 'rgba(220,38,38,0.08)')}
                onMouseLeave={e => cancelMode && ((e.currentTarget as HTMLDivElement).style.background = 'rgba(220,38,38,0.03)')}
              >
                {/* İşlem tipi */}
                <div style={{ fontSize: 10, color: cancelMode ? '#dc2626' : '#9ca3af', fontWeight: 500 }}>Satış</div>

                {/* Ürün adı + kod */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: cancelMode ? '#dc2626' : '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace', marginTop: 1 }}>{item.code}</div>
                </div>

                {/* Miktar +/− */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  {!cancelMode && (
                    <button onClick={e => { e.stopPropagation(); updateQty(item.id, -1) }}
                      style={{ width: 22, height: 22, border: '1px solid #e5e7eb', background: '#f3f4f6', borderRadius: 4, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151' }}>−</button>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 600, color: cancelMode ? '#dc2626' : '#374151', minWidth: 24, textAlign: 'center' }}>{item.quantity}</span>
                  {!cancelMode && (
                    <button onClick={e => { e.stopPropagation(); updateQty(item.id, 1) }}
                      style={{ width: 22, height: 22, border: '1px solid #e5e7eb', background: '#f3f4f6', borderRadius: 4, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151' }}>+</button>
                  )}
                </div>

                {/* Birim fiyat */}
                <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center' }}>{fmt(item.price)}</div>

                {/* Tutar */}
                <div style={{ fontSize: 13, fontWeight: 600, color: cancelMode ? '#dc2626' : '#111', textAlign: 'right' }}>{fmt(item.lineTotal)}</div>

                {/* Sil */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {cancelMode ? (
                    <div style={{ width: 20, height: 20, background: '#dc2626', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'white' }}>✕</div>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); removeFromCart(item.id) }}
                      style={{ width: 22, height: 22, background: '#fff5f5', border: '1px solid #fecdd3', borderRadius: 4, cursor: 'pointer', fontSize: 10, color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Özet + toplam */}
          <div style={{ borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
            <div style={{ padding: '5px 14px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>KDV Hariç</span>
                <span style={{ fontSize: 11, color: '#374151' }}>{fmt(grandTotal - vatTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>KDV</span>
                <span style={{ fontSize: 11, color: '#374151' }}>{fmt(vatTotal)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 14px 10px', borderTop: '1px solid #f0f0f0', marginTop: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>Genel Toplam</span>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#1565C0' }}>{fmt(grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* ② NUMPAD + MENÜ — FIX */}
        <div style={{ width: 185, background: '#f8f9fa', flexShrink: 0, display: 'flex', flexDirection: 'column', padding: 8, gap: 5, borderRight: '1px solid #e0e0e0', overflow: 'hidden' }}>

          {/* Ekran */}
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: '5px 10px', textAlign: 'right', fontSize: 22, fontWeight: 700, color: '#1565C0', height: 40, letterSpacing: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
            {numBuf || '—'}
          </div>

          {/* Numpad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, flexShrink: 0 }}>
            {['7','8','9','4','5','6','1','2','3','C','0','⌫'].map(k => (
              <button key={k} onClick={() => handleNumKey(k)}
                style={{ height: 42, border: '1px solid', borderRadius: 7, cursor: 'pointer', fontSize: k === '⌫' ? 16 : 20, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' as const,
                  background: k === 'C' ? '#fff5f5' : k === '⌫' ? '#fffbeb' : 'white',
                  color:      k === 'C' ? '#dc2626' : k === '⌫' ? '#d97706' : '#374151',
                  borderColor: k === 'C' ? '#fecdd3' : k === '⌫' ? '#fde68a' : '#e5e7eb',
                }}
              >{k}</button>
            ))}
          </div>

          {/* Miktar göstergesi */}
          <div style={{ borderRadius: 8, padding: 6, textAlign: 'center', border: `1px solid ${numBuf ? '#a5d6a7' : '#fde68a'}`, background: numBuf ? '#e8f5e9' : '#fff8e1', flexShrink: 0 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: numBuf ? '#2e7d32' : '#d97706', display: 'block', lineHeight: 1 }}>{numBuf || '—'}</span>
            <span style={{ fontSize: 9, color: '#9ca3af', marginTop: 2, display: 'block' }}>adet seçili</span>
          </div>

          <div style={{ height: 1, background: '#e5e7eb', flexShrink: 0 }} />

          {/* İşlemler menüsü */}
          <button
            onClick={() => setMenuOpen(m => !m)}
            style={{ border: `1.5px solid ${selectedCustomer ? '#a5d6a7' : '#e5e7eb'}`, borderRadius: 8, background: selectedCustomer ? '#e8f5e9' : 'white', cursor: 'pointer', padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: selectedCustomer ? '#2e7d32' : '#374151', flexShrink: 0 }}
          >
            <span>{selectedCustomer ? `👤 ${selectedCustomer.name.split(' ')[0]}` : 'İşlemler'}</span>
            <span style={{ fontSize: 9 }}>{menuOpen ? '▴' : '▾'}</span>
          </button>

          {menuOpen && (
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 9, overflow: 'hidden', flexShrink: 0 }}>
              {[
                { label: '👤 Müşteri Seç',      action: loadCustomers,                               danger: false, disabled: false },
                { label: '⏸ Belgeyi Beklet',    action: holdDoc,                                     danger: false, disabled: cart.length === 0 },
                { label: `▶ Belge Getir${heldDocs.length ? ` (${heldDocs.length})` : ''}`,
                  action: () => { setShowHeld(true); closeMenu() },  danger: false, disabled: false },
                { label: cancelMode ? '✕ Modu Kapat' : '✕ İptal Modu',
                  action: () => { if (!cancelMode && !cart.length) return; setCancelMode(m => !m); closeMenu() },
                  danger: true,  disabled: false, active: cancelMode },
              ].map((item, i) => (
                <div key={i}
                  onClick={item.disabled ? undefined : item.action}
                  style={{ padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 8, cursor: item.disabled ? 'default' : 'pointer', fontSize: 11, fontWeight: 'active' in item && item.active ? 600 : 500, borderBottom: i < 3 ? '1px solid #f5f5f5' : 'none', color: 'active' in item && item.active ? '#dc2626' : item.danger ? '#dc2626' : '#374151', background: 'active' in item && item.active ? '#fff5f5' : 'white', opacity: item.disabled ? 0.4 : 1, transition: 'background 0.1s' }}
                  onMouseEnter={e => { if (!item.disabled) (e.currentTarget as HTMLDivElement).style.background = item.danger ? '#fff5f5' : '#f3f4f6' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'active' in item && item.active ? '#fff5f5' : 'white' }}
                >
                  {item.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ③ PLU — FIX 340px */}
        <div style={{ width: 340, flexShrink: 0, background: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #e0e0e0' }}>

          {/* PLU başlık */}
          <div style={{ padding: '7px 10px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 6, height: 36, flexShrink: 0, background: '#f8f9fa' }}>
            <div style={{ width: 3, height: 14, borderRadius: 2, background: activeColor, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', flex: 1 }}>
              {pluGroups.find(g => g.id === activeGroup)?.name ?? '—'}
            </span>
            <span style={{ fontSize: 9, color: '#9ca3af' }}>{filtered.length} ürün</span>
            <button
              onClick={() => window.electron.app.openKeyboard().catch(() => {})}
              style={{ width: 24, height: 24, background: '#efefef', border: '1px solid #e5e7eb', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}
              title="Klavye Aç"
            >⌨</button>
          </div>

          {/* Arama */}
          <div style={{ padding: '4px 8px', flexShrink: 0, borderBottom: '1px solid #f5f5f5', height: 32 }}>
            <input
              ref={searchRef}
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchQ('') }}
              placeholder={numBuf ? `${numBuf} adet × ara...` : 'Ara veya barkod okut...'}
              style={{ width: '100%', border: `1px solid ${numBuf ? '#FFB300' : '#e5e7eb'}`, borderRadius: 6, padding: '3px 8px', fontSize: 11, outline: 'none', background: numBuf ? '#FFF8E1' : '#f9fafb', height: '100%' }}
            />
          </div>

          {/* PLU grid — 3 sütun fix, satır sayısı kalan alana göre */}
          {searchQ ? (
            // Arama modu — liste
            <div style={{ flex: 1, overflowY: 'auto', padding: '5px 8px' }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#BDBDBD', padding: '24px 0', fontSize: 12 }}>Ürün bulunamadı</div>
              ) : filtered.map(p => (
                <div key={p.id} onClick={() => handlePluClick(p)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', marginBottom: 3, borderRadius: 7, background: 'white', border: '1px solid #F0F0F0', cursor: 'pointer' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = activeColor; el.style.background = activeSoft }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = '#F0F0F0'; el.style.background = 'white' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#212121', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    {(posSettings.showCode || posSettings.showBarcode) && (
                      <div style={{ fontSize: 9, color: '#9ca3af', fontFamily: 'monospace', marginTop: 1 }}>
                        {posSettings.showCode && p.code}
                        {posSettings.showCode && posSettings.showBarcode && p.barcode && ' · '}
                        {posSettings.showBarcode && p.barcode}
                      </div>
                    )}
                  </div>
                  {posSettings.showPrice && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: activeColor, flexShrink: 0, marginLeft: 8 }}>{fmt(p.price)}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // PLU grid
            <div style={{ padding: 6, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '90px', gap: 5, flex: 1, overflow: 'hidden', alignContent: 'start' }}>
              {Array.from({ length: PLU_PER_PAGE }).map((_, i) => {
                const p = slice[i]
                if (!p) return <div key={`e${i}`} style={{ borderRadius: 8, background: '#fafafa', border: '1px dashed #f0f0f0' }} />
                return (
                  <div key={p.id} onClick={() => handlePluClick(p)}
                    style={{ borderRadius: 8, padding: '6px 4px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, border: '2px solid transparent', background: activeSoft, transition: 'all 0.15s', overflow: 'hidden', minHeight: 0 }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = activeColor; el.style.transform = 'scale(1.02)' }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'transparent'; el.style.transform = 'scale(1)' }}
                    onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(0.95)' }}
                    onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', textAlign: 'center', lineHeight: 1.2 }}>{p.name}</div>
                    {posSettings.showCode && <div style={{ fontSize: 8, color: '#9ca3af', fontFamily: 'monospace' }}>{p.code}</div>}
                    {posSettings.showBarcode && p.barcode && <div style={{ fontSize: 8, color: '#b0b0b0', fontFamily: 'monospace' }}>{p.barcode}</div>}
                    {posSettings.showPrice && <div style={{ fontSize: 12, fontWeight: 700, color: activeColor }}>{fmt(p.price)}</div>}
                  </div>
                )
              })}
            </div>
          )}

          {/* Sayfalama */}
          {!searchQ && (
            <div style={{ padding: '0 8px', borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 30, flexShrink: 0 }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, padding: '2px 8px', cursor: safePage === 0 ? 'default' : 'pointer', fontSize: 9, color: '#6b7280', opacity: safePage === 0 ? 0.3 : 1, height: 20 }}>
                ← Önceki
              </button>
              <span style={{ fontSize: 9, color: '#9ca3af' }}>{safePage + 1} / {totalPages} · {filtered.length} ürün</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, padding: '2px 8px', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer', fontSize: 9, color: '#6b7280', opacity: safePage >= totalPages - 1 ? 0.3 : 1, height: 20 }}>
                Sonraki →
              </button>
            </div>
          )}

          {/* Ödeme */}
          <div style={{ padding: '5px 8px 8px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
            {!paymentMode ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {[
                  { key: 'cash',  label: 'Nakit', bg: '#e8f5e9', color: '#2e7d32' },
                  { key: 'card',  label: 'Kart',  bg: '#e3f2fd', color: '#1565C0' },
                  { key: 'mixed', label: 'Karma Ödeme', bg: '#fff8e1', color: '#e65100', span: true },
                ].map(btn => (
                  <button key={btn.key}
                    onClick={() => { setPaymentType(btn.key as 'cash' | 'card' | 'mixed'); if (btn.key === 'card') completeSale(); else setPaymentMode(true) }}
                    disabled={cart.length === 0}
                    style={{ background: cart.length === 0 ? '#f5f5f5' : btn.bg, color: cart.length === 0 ? '#bdbdbd' : btn.color, border: 'none', borderRadius: 7, padding: '13px 4px', cursor: cart.length === 0 ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, gridColumn: btn.span ? 'span 2' : undefined }}
                  >{btn.label}</button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {(paymentType === 'cash' || paymentType === 'mixed') && (
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <label style={{ fontSize: 10, color: '#757575', whiteSpace: 'nowrap' }}>
                      {paymentType === 'mixed' ? 'Nakit:' : 'Alınan:'}
                    </label>
                    <input type="number" value={cashInput} onChange={e => setCashInput(e.target.value)} autoFocus
                      style={{ flex: 1, border: '1px solid #90CAF9', borderRadius: 6, padding: '5px 8px', fontSize: 14, fontWeight: 700, outline: 'none' }} />
                    {paymentType === 'cash' && cashAmount >= grandTotal && cashAmount > 0 && (
                      <span style={{ fontSize: 11, color: '#2E7D32', fontWeight: 600, whiteSpace: 'nowrap' }}>↩ {fmt(change)}</span>
                    )}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 4 }}>
                  <button onClick={() => { setPaymentMode(false); setCashInput('') }}
                    style={{ background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 7, padding: 8, cursor: 'pointer', fontSize: 11 }}>İptal</button>
                  <button onClick={completeSale}
                    disabled={saving || (paymentType === 'cash' && cashAmount < grandTotal)}
                    style={{ background: (saving || (paymentType === 'cash' && cashAmount < grandTotal)) ? '#f5f5f5' : '#2E7D32', color: (saving || (paymentType === 'cash' && cashAmount < grandTotal)) ? '#bdbdbd' : 'white', border: 'none', borderRadius: 7, padding: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                    {saving ? 'Kaydediliyor...' : 'Tamamla ✓'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ④ GRUPLAR EN SAĞDA */}
        <div style={{ width: 85, background: '#f3f4f6', flexShrink: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {pluGroups.map(g => (
            <button
              key={g.id}
              onClick={() => { setActiveGroup(g.id); setPage(0); setSearchQ('') }}
              style={{ height: 68, border: 'none', background: 'white', cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, color: activeGroup === g.id ? '#111' : '#6b7280', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.2px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, width: '100%', paddingRight: 5 }}
            >
              {/* Renk şeridi sağda */}
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: activeGroup === g.id ? 7 : 4, background: g.color, transition: 'width 0.15s' }} />
              {/* Ok solda */}
              {activeGroup === g.id && (
                <div style={{ position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)', borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: '6px solid white', zIndex: 3 }} />
              )}
              <div style={{ width: activeGroup === g.id ? 10 : 8, height: activeGroup === g.id ? 10 : 8, borderRadius: '50%', background: g.color, opacity: activeGroup === g.id ? 1 : 0.4, transition: 'all 0.15s' }} />
              <span>{g.name}</span>
            </button>
          ))}
          {pluGroups.length === 0 && (
            <div style={{ padding: 8, fontSize: 9, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>PLU grubu yok</div>
          )}
        </div>

      </div>

      {merkezToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#212121', color: 'white', padding: '10px 20px', borderRadius: 8, fontSize: 13, zIndex: 10001, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          {merkezToast}
        </div>
      )}
    </div>
  )
}

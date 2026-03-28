import { useState, useEffect, useRef, useCallback } from 'react'
import { useLicenseCheck } from '../hooks/useLicenseCheck'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import LicenseBanner from '../components/LicenseBanner'
import ConnectionDot from '../components/ConnectionDot'
import { api } from '../lib/api'

function softTint(hex: string, fallback = '#E3F2FD'): string {
  const raw = hex.replace('#', '').trim()
  if (raw.length !== 6) return fallback
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return fallback
  const mix = (x: number) => Math.round(x + (255 - x) * 0.88)
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`
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

export default function POSScreen({
  companyId, cashier, allProducts,
  pluGroups, posSettings,
  onBack, onLogout,
  pendingMessage, onMessageClose,
  merkezToast = null,
}: Props) {

  const [cart, setCart]                   = useState<CartItem[]>([])
  const [numBuf, setNumBuf]               = useState('')
  const [activeGroup, setActiveGroup]     = useState<string | null>(null)
  const [page, setPage]                   = useState(0)
  const [searchQ, setSearchQ]             = useState('')
  const [pluCols, setPluCols]             = useState(3)
  const [pluRows, setPluRows]             = useState(3)
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

  const searchRef   = useRef<HTMLInputElement>(null)
  const pluPanelRef = useRef<HTMLDivElement>(null)
  const license     = useLicenseCheck(companyId)
  const conn        = useConnectionStatus(30)

  const addToCartWithQty = useCallback((product: ProductRow, qty: number) => {
    setCart(prev => {
      const ex = prev.find(c => c.id === product.id)
      if (ex) {
        return prev.map(c => c.id === product.id
          ? { ...c, quantity: c.quantity + qty, lineTotal: (c.quantity + qty) * c.price }
          : c
        )
      }
      return [...prev, {
        id: product.id, code: product.code ?? '', name: product.name,
        category: product.category ?? '', price: product.price,
        vatRate: product.vatRate ?? 18, unit: product.unit ?? 'Adet',
        quantity: qty, lineTotal: product.price * qty,
      }]
    })
  }, [])

  useEffect(() => {
    if (pluGroups.length === 0) {
      setActiveGroup(null)
      return
    }
    if (!activeGroup || !pluGroups.some(g => g.id === activeGroup)) {
      setActiveGroup(pluGroups[0].id)
    }
  }, [pluGroups, activeGroup])

  useEffect(() => {
    const el = pluPanelRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width >= 700)      setPluCols(5)
      else if (width >= 520) setPluCols(4)
      else                   setPluCols(3)
      const gridH = height - 196
      const rows  = Math.max(1, Math.floor((gridH + 7) / (90 + 7)))
      setPluRows(rows)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const loadHeld = useCallback(async () => {
    const docs = await window.electron.db.getHeldDocuments(companyId).catch(() => [] as HeldDocRow[])
    setHeldDocs(docs)
  }, [companyId])

  useEffect(() => { loadHeld() }, [loadHeld])
  useEffect(() => { searchRef.current?.focus() }, [])

  const PER_PAGE = pluCols * pluRows

  const groupProducts = (() => {
    if (!activeGroup) return allProducts
    const g = pluGroups.find(x => x.id === activeGroup)
    if (!g || !g.plu_items?.length) return []
    return g.plu_items
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage   = Math.min(page, totalPages - 1)
  const slice      = filtered.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE)

  useEffect(() => { setPage(0) }, [activeGroup, searchQ, pluCols, pluRows])

  useEffect(() => {
    if (searchQ.length < 2) return
    const t = setTimeout(() => {
      const p = allProducts.find(x => x.barcode === searchQ)
      if (p) {
        addToCartWithQty(p, numBuf ? Math.max(1, parseInt(numBuf, 10) || 1) : 1)
        setNumBuf('')
        setSearchQ('')
      }
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ, numBuf, allProducts, addToCartWithQty])

  function handlePluClick(product: ProductRow) {
    const qty = numBuf ? Math.max(1, parseInt(numBuf, 10) || 1) : 1
    setNumBuf('')
    addToCartWithQty(product, qty)
    searchRef.current?.focus()
  }

  function handleNumKey(k: string) {
    if (k === 'C')  { setNumBuf(''); return }
    if (k === '⌫') { setNumBuf(p => p.slice(0, -1)); return }
    if (numBuf.length < 4) setNumBuf(p => p + k)
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
  }

  function closeMenu() { setMenuOpen(false) }

  async function holdDoc() {
    if (!cart.length) return
    const label = selectedCustomer
      ? `Müşteri: ${selectedCustomer.name}`
      : `Bekletilen ${new Date().toLocaleTimeString('tr-TR')}`
    const items = cart.map(c => ({
      id: c.id, code: c.code, name: c.name, category: c.category,
      price: c.price, vatRate: c.vatRate, unit: c.unit,
      quantity: c.quantity, lineTotal: c.lineTotal,
    }))
    await window.electron.db.holdDocument({
      companyId, label, items,
      totalAmount: cart.reduce((s, c) => s + c.lineTotal, 0),
    })
    clearCart()
    loadHeld()
    closeMenu()
  }

  async function loadCustomers() {
    setShowCustomer(true)
    closeMenu()
    if (customers.length > 0) return
    const list = await api.getCustomers(companyId).catch(() => [] as CustomerRow[])
    setCustomers(list)
  }

  async function retrieveDoc(doc: HeldDocRow) {
    setCart(doc.items as CartItem[])
    await window.electron.db.deleteHeldDocument(doc.id)
    loadHeld()
    setShowHeld(false)
  }

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
    } finally { setSaving(false) }
  }

  const activeGroupRow = pluGroups.find(g => g.id === activeGroup)
  const activeColor    = activeGroupRow?.color ?? '#1565C0'
  const activeSoft     = softTint(activeColor)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#e5e7eb', overflow: 'hidden' }}>

      {license?.warning && <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />}

      <div style={{ background: '#1565C0', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>BT<span style={{ color: '#90CAF9' }}>POS</span></span>
          <button type="button" onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, color: 'white', padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>← Dashboard</button>
          {lastReceipt && <span style={{ background: '#E8F5E9', color: '#2E7D32', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 500 }}>✓ {lastReceipt}</span>}
          {selectedCustomer && (
            <span style={{ background: 'rgba(255,255,255,0.15)', color: '#E3F2FD', borderRadius: 6, padding: '3px 8px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
              👤 {selectedCustomer.name}
              <button type="button" onClick={() => setSelectedCustomer(null)} style={{ background: 'none', border: 'none', color: '#90CAF9', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConnectionDot status={conn} />
          <span style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 6, padding: '3px 8px', color: '#BBDEFB', fontSize: 11 }}>{cashier.fullName}</span>
          <button type="button" onClick={onLogout} style={{ background: 'rgba(198,40,40,0.3)', border: 'none', borderRadius: 6, color: 'white', padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>Çıkış</button>
        </div>
      </div>

      {pendingMessage && onMessageClose && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 16, padding: '36px 40px', maxWidth: 480, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Yönetici Mesajı</div>
            <div style={{ fontSize: 14, color: '#424242', lineHeight: 1.7, marginBottom: 28 }}>{pendingMessage.text}</div>
            <button type="button" onClick={onMessageClose} style={{ background: '#1565C0', color: 'white', border: 'none', borderRadius: 10, padding: '12px 40px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Tamam, Anlaşıldı
            </button>
          </div>
        </div>
      )}

      {showHeld && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 14, padding: 24, width: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Bekletilen Belgeler</span>
              <button type="button" onClick={() => setShowHeld(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9E9E9E' }}>✕</button>
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
                      <button type="button" onClick={() => void retrieveDoc(doc)} style={{ background: '#E3F2FD', border: '1px solid #90CAF9', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#1565C0' }}>Getir</button>
                      <button type="button" onClick={() => void window.electron.db.deleteHeldDocument(doc.id).then(() => loadHeld())} style={{ background: '#FFEBEE', border: '1px solid #FFCDD2', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontSize: 12, color: '#C62828' }}>Sil</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showCustomer && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 14, padding: 24, width: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Müşteri Seç</span>
              <button type="button" onClick={() => setShowCustomer(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9E9E9E' }}>✕</button>
            </div>
            <input autoFocus value={customerQ} onChange={e => setCustomerQ(e.target.value)}
              placeholder="İsim veya kod ile ara..."
              style={{ border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', marginBottom: 12 }} />
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {customers
                .filter(c => !customerQ || c.name.toLowerCase().includes(customerQ.toLowerCase()) || (c.code ?? '').includes(customerQ))
                .slice(0, 50)
                .map(c => (
                  <div key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setSelectedCustomer(c); setShowCustomer(false); setCustomerQ('') }}
                    onKeyDown={e => { if (e.key === 'Enter') { setSelectedCustomer(c); setShowCustomer(false); setCustomerQ('') } }}
                    style={{ border: '1px solid #F0F0F0', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F0F4FF' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'white' }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: '#9E9E9E' }}>{c.code}{c.phone && ` · ${c.phone}`}</div>
                    </div>
                    {c.balance !== 0 && (
                      <span style={{ fontSize: 12, color: c.balance > 0 ? '#2E7D32' : '#C62828', fontWeight: 600 }}>{fmt(c.balance)}</span>
                    )}
                  </div>
                ))}
              {customers.length === 0 && (
                <div style={{ textAlign: 'center', color: '#BDBDBD', padding: '32px 0', fontSize: 13 }}>Müşteriler yükleniyor...</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        <div style={{ width: 270, background: 'white', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb' }}>

          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 38, flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Sepet</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: '#9ca3af' }}>{cart.length > 0 ? `${cart.length} kalem` : 'boş'}</span>
              {cart.length > 0 && (
                <button type="button" onClick={() => setCart([])} style={{ background: '#FFEBEE', border: '1px solid #FFCDD2', borderRadius: 5, color: '#C62828', padding: '2px 7px', cursor: 'pointer', fontSize: 10 }}>Temizle</button>
              )}
            </div>
          </div>

          {cancelMode && (
            <div style={{ background: '#dc2626', color: 'white', fontSize: 10, fontWeight: 600, textAlign: 'center', padding: 5, flexShrink: 0 }}>
              ✕ İptal Modu — kaleme tıklayın
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 36px 60px 20px', padding: '4px 10px', background: '#f8f9fa', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
            {['Ürün', 'Adet', 'Toplam', ''].map((h, i) => (
              <span key={h || String(i)} style={{ fontSize: 9, color: '#9ca3af', fontWeight: 500, textAlign: i === 2 ? 'right' : 'left' }}>{h}</span>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {cart.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#d1d5db', fontSize: 11 }}>Sepet boş</div>
            ) : cart.map(item => (
              <div key={item.id}
                role={cancelMode ? 'button' : undefined}
                onClick={() => cancelMode && removeFromCart(item.id)}
                style={{ display: 'grid', gridTemplateColumns: '1fr 36px 60px 20px', padding: '6px 10px', alignItems: 'center', borderBottom: '1px solid #f9f9f9', cursor: cancelMode ? 'pointer' : 'default', background: cancelMode ? 'rgba(220,38,38,0.04)' : 'white', transition: 'background 0.1s' }}
                onMouseEnter={e => { if (cancelMode) (e.currentTarget as HTMLDivElement).style.background = 'rgba(220,38,38,0.1)' }}
                onMouseLeave={e => { if (cancelMode) (e.currentTarget as HTMLDivElement).style.background = 'rgba(220,38,38,0.04)' }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: cancelMode ? '#dc2626' : '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                  <div style={{ fontSize: 8, color: '#9ca3af' }}>{item.code}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', textAlign: 'center' }}>{item.quantity}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: cancelMode ? '#dc2626' : '#111', textAlign: 'right' }}>{fmt(item.lineTotal)}</div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {cancelMode ? (
                    <div style={{ width: 15, height: 15, background: '#dc2626', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'white' }}>✕</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid #e5e7eb', padding: '7px 12px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 10, color: '#9ca3af' }}>KDV hariç</span>
              <span style={{ fontSize: 10, color: '#374151' }}>{fmt(grandTotal - vatTotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 10, color: '#9ca3af' }}>KDV</span>
              <span style={{ fontSize: 10, color: '#374151' }}>{fmt(vatTotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 5, borderTop: '1px solid #f0f0f0', marginTop: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>Toplam</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: '#1565C0' }}>{fmt(grandTotal)}</span>
            </div>
          </div>
        </div>

        <div style={{ width: 195, background: '#f8f9fa', flexShrink: 0, display: 'flex', flexDirection: 'column', padding: 8, gap: 5, borderRight: '1px solid #e5e7eb', overflow: 'hidden' }}>

          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: '5px 10px', textAlign: 'right', fontSize: 22, fontWeight: 700, color: '#1565C0', height: 40, letterSpacing: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
            {numBuf || '—'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, flexShrink: 0 }}>
            {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '⌫'].map(k => (
              <button key={k} type="button" onClick={() => handleNumKey(k)}
                style={{
                  height: 44, border: '1px solid', borderRadius: 7, cursor: 'pointer', fontSize: k === '⌫' ? 12 : 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none',
                  background: k === 'C' ? '#fff5f5' : k === '⌫' ? '#fffbeb' : 'white',
                  color:      k === 'C' ? '#dc2626' : k === '⌫' ? '#d97706' : '#374151',
                  borderColor:k === 'C' ? '#fecdd3' : k === '⌫' ? '#fde68a' : '#e5e7eb',
                }}>{k}</button>
            ))}
          </div>

          <div style={{ borderRadius: 8, padding: 6, textAlign: 'center', border: `1px solid ${numBuf ? '#a5d6a7' : '#fde68a'}`, background: numBuf ? '#e8f5e9' : '#fff8e1', flexShrink: 0 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: numBuf ? '#2e7d32' : '#d97706', display: 'block', lineHeight: 1 }}>{numBuf || '—'}</span>
            <span style={{ fontSize: 9, color: '#9ca3af', marginTop: 2, display: 'block' }}>adet seçili</span>
          </div>

          <div style={{ height: 1, background: '#e5e7eb', flexShrink: 0 }} />

          <button type="button"
            onClick={() => setMenuOpen(m => !m)}
            style={{ border: `1.5px solid ${selectedCustomer ? '#a5d6a7' : '#e5e7eb'}`, borderRadius: 9, background: selectedCustomer ? '#e8f5e9' : 'white', cursor: 'pointer', padding: '9px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: selectedCustomer ? '#2e7d32' : '#374151', flexShrink: 0 }}
          >
            <span>{selectedCustomer ? `👤 ${selectedCustomer.name.split(' ')[0]}` : 'İşlemler'}</span>
            <span style={{ fontSize: 9 }}>{menuOpen ? '▴' : '▾'}</span>
          </button>

          {menuOpen && (
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
              {[
                { label: '👤 Müşteri Seç',    action: () => void loadCustomers(),         cls: '', disabled: false },
                { label: '⏸ Belgeyi Beklet', action: () => void holdDoc(),               cls: '', disabled: cart.length === 0 },
                { label: `▶ Belge Getir${heldDocs.length ? ` (${heldDocs.length})` : ''}`,
                  action: () => { setShowHeld(true); closeMenu() },  cls: '', disabled: false },
                { label: cancelMode ? '✕ Modu Kapat' : '✕ İptal Modu',
                  action: () => { if (!cancelMode && !cart.length) return; setCancelMode(m => !m); closeMenu() },
                  cls: 'danger', active: cancelMode, disabled: !cancelMode && !cart.length },
              ].map((item, i) => (
                <div key={item.label}
                  role="button"
                  tabIndex={0}
                  onClick={() => { if (!item.disabled) item.action() }}
                  onKeyDown={e => { if (e.key === 'Enter' && !item.disabled) item.action() }}
                  style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 9, cursor: item.disabled ? 'default' : 'pointer', fontSize: 11, fontWeight: item.active ? 600 : 500, borderBottom: i < 3 ? '1px solid #f5f5f5' : 'none',
                    color: item.active ? '#dc2626' : item.cls === 'danger' ? '#dc2626' : '#374151',
                    background: item.active ? '#fff5f5' : 'white',
                    opacity: item.disabled ? 0.4 : 1,
                  }}
                  onMouseEnter={e => { if (!item.disabled) (e.currentTarget as HTMLDivElement).style.background = item.cls === 'danger' ? '#fff5f5' : '#f3f4f6' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = item.active ? '#fff5f5' : 'white' }}
                >
                  {item.label}
                </div>
              ))}
            </div>
          )}
        </div>

        <div ref={pluPanelRef} style={{ flex: 1, minWidth: 0, background: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #e5e7eb' }}>

          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8, height: 38, flexShrink: 0 }}>
            <div style={{ width: 4, height: 16, borderRadius: 2, background: activeColor, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#111', whiteSpace: 'nowrap' }}>
              {pluGroups.find(g => g.id === activeGroup)?.name ?? 'Tümü'}
            </span>
            <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>{filtered.length} ürün</span>
            <button type="button"
              onClick={() => void window.electron.app.openKeyboard().catch(() => {})}
              style={{ width: 26, height: 26, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}
              title="Klavye Aç"
            >⌨</button>
          </div>

          <div style={{ padding: '5px 10px', flexShrink: 0, borderBottom: '1px solid #f5f5f5', height: 34 }}>
            <input
              ref={searchRef}
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchQ('') }}
              placeholder={numBuf ? `${numBuf} adet × ara veya barkod okut...` : 'Barkod okut veya ara...'}
              style={{ width: '100%', border: `1px solid ${numBuf ? '#FFB300' : '#e5e7eb'}`, borderRadius: 7, padding: '4px 10px', fontSize: 11, outline: 'none', background: numBuf ? '#FFF8E1' : '#f9fafb', height: '100%' }}
            />
          </div>

          {searchQ ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#BDBDBD', padding: '32px 0', fontSize: 13 }}>Ürün bulunamadı</div>
              ) : filtered.map(p => (
                <div key={p.id} role="button" tabIndex={0} onClick={() => handlePluClick(p)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', marginBottom: 4, borderRadius: 8, background: 'white', border: '1px solid #F0F0F0', cursor: 'pointer' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = activeColor; el.style.background = activeSoft }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = '#F0F0F0'; el.style.background = 'white' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#212121', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    {(posSettings.showCode || posSettings.showBarcode) && (
                      <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace', marginTop: 1 }}>
                        {posSettings.showCode && p.code}
                        {posSettings.showCode && posSettings.showBarcode && p.barcode && ' · '}
                        {posSettings.showBarcode && p.barcode}
                      </div>
                    )}
                  </div>
                  {posSettings.showPrice && (
                    <div style={{ fontSize: 14, fontWeight: 700, color: activeColor, flexShrink: 0, marginLeft: 12 }}>{fmt(p.price)}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 8, display: 'grid', gridTemplateColumns: `repeat(${pluCols}, 1fr)`, gridTemplateRows: `repeat(${pluRows}, 1fr)`, gap: 7, flex: 1, overflow: 'hidden' }}>
              {Array.from({ length: PER_PAGE }).map((_, i) => {
                const p = slice[i]
                if (!p) return <div key={`e${i}`} style={{ borderRadius: 10, background: '#fafafa', border: '1.5px dashed #f0f0f0' }} />
                return (
                  <div key={p.id} role="button" tabIndex={0} onClick={() => handlePluClick(p)}
                    style={{ borderRadius: 10, padding: '8px 6px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, border: '2px solid transparent', background: activeSoft, transition: 'all 0.15s', overflow: 'hidden' }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = activeColor; el.style.transform = 'scale(1.02)' }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'transparent'; el.style.transform = 'scale(1)' }}
                    onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(0.96)' }}
                    onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.02)' }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', textAlign: 'center', lineHeight: 1.3 }}>{p.name}</div>
                    {posSettings.showCode && <div style={{ fontSize: 9, color: '#9ca3af', fontFamily: 'monospace' }}>{p.code}</div>}
                    {posSettings.showBarcode && p.barcode && <div style={{ fontSize: 8, color: '#b0b0b0', fontFamily: 'monospace' }}>{p.barcode}</div>}
                    {posSettings.showPrice && <div style={{ fontSize: 14, fontWeight: 700, color: activeColor }}>{fmt(p.price)}</div>}
                  </div>
                )
              })}
            </div>
          )}

          {!searchQ && (
            <div style={{ padding: '0 10px', borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 34, flexShrink: 0 }}>
              <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 5, padding: '3px 10px', cursor: safePage === 0 ? 'default' : 'pointer', fontSize: 10, color: '#6b7280', opacity: safePage === 0 ? 0.3 : 1, height: 24 }}>← Önceki</button>
              <span style={{ fontSize: 10, color: '#9ca3af' }}>{safePage + 1} / {totalPages} · {filtered.length} ürün</span>
              <button type="button" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 5, padding: '3px 10px', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer', fontSize: 10, color: '#6b7280', opacity: safePage >= totalPages - 1 ? 0.3 : 1, height: 24 }}>Sonraki →</button>
            </div>
          )}

          <div style={{ padding: '6px 10px 8px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 0 6px' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>Toplam</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: '#1565C0' }}>{fmt(grandTotal)}</span>
            </div>
            {!paymentMode ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {[
                  { key: 'cash' as const,  label: 'Nakit', bg: '#e8f5e9', color: '#2e7d32' },
                  { key: 'card' as const,  label: 'Kart',  bg: '#e3f2fd', color: '#1565C0' },
                  { key: 'mixed' as const, label: 'Karma Ödeme', bg: '#fff8e1', color: '#e65100', span: true },
                ].map(btn => (
                  <button key={btn.key} type="button"
                    onClick={() => { setPaymentType(btn.key); if (btn.key === 'card') void completeSale(); else setPaymentMode(true) }}
                    disabled={cart.length === 0}
                    style={{ background: cart.length === 0 ? '#f5f5f5' : btn.bg, color: cart.length === 0 ? '#bdbdbd' : btn.color, border: 'none', borderRadius: 8, padding: '10px 4px', cursor: cart.length === 0 ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, gridColumn: btn.span ? 'span 2' : undefined }}
                  >{btn.label}</button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(paymentType === 'cash' || paymentType === 'mixed') && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 5 }}>
                  <button type="button" onClick={() => { setPaymentMode(false); setCashInput('') }}
                    style={{ background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8, padding: 9, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>İptal</button>
                  <button type="button" onClick={() => void completeSale()}
                    disabled={saving || (paymentType === 'cash' && cashAmount < grandTotal)}
                    style={{ background: (saving || (paymentType === 'cash' && cashAmount < grandTotal)) ? '#f5f5f5' : '#2E7D32', color: (saving || (paymentType === 'cash' && cashAmount < grandTotal)) ? '#bdbdbd' : 'white', border: 'none', borderRadius: 8, padding: 9, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                    {saving ? 'Kaydediliyor...' : 'Tamamla ✓'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ width: 90, background: '#f3f4f6', flexShrink: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {pluGroups.map(g => (
            <button type="button"
              key={g.id}
              onClick={() => { setActiveGroup(g.id); setPage(0); setSearchQ('') }}
              style={{ height: 72, border: 'none', background: 'white', cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, color: activeGroup === g.id ? '#111' : '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.2px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, width: '100%', paddingRight: 6 }}
            >
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: activeGroup === g.id ? 8 : 5, background: g.color, transition: 'width 0.2s' }} />
              {activeGroup === g.id && (
                <div style={{ position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)', borderTop: '7px solid transparent', borderBottom: '7px solid transparent', borderLeft: '7px solid white', zIndex: 3 }} />
              )}
              <div style={{ width: activeGroup === g.id ? 10 : 8, height: activeGroup === g.id ? 10 : 8, borderRadius: '50%', background: g.color, opacity: activeGroup === g.id ? 1 : 0.4, transition: 'all 0.2s' }} />
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

import { useState, useEffect, useRef, useCallback } from 'react'
import { useLicenseCheck } from '../hooks/useLicenseCheck'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import LicenseBanner from '../components/LicenseBanner'
import ConnectionDot from '../components/ConnectionDot'
import { api } from '../lib/api'

function hexToSoft(hex: string): string {
  try {
    if (!hex?.startsWith('#') || hex.length < 7) return '#E3F2FD'
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    if ([r, g, b].some(n => Number.isNaN(n))) return '#E3F2FD'
    return `rgba(${r}, ${g}, ${b}, 0.12)`
  } catch {
    return '#E3F2FD'
  }
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
  onCartChange?:   (hasItems: boolean) => void
}

const fmt = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'

let receiptCounter = parseInt(localStorage.getItem('btpos_receipt') || '1000')
function nextReceiptNo(): string {
  receiptCounter++
  localStorage.setItem('btpos_receipt', String(receiptCounter))
  return `FIS-${String(receiptCounter).padStart(5, '0')}`
}

function calcLineDiscount(lineTotal: number, rate: number, amount: number): number {
  let net = lineTotal
  if (rate > 0) net = parseFloat((net * (1 - rate / 100)).toFixed(2))
  if (amount > 0) net = parseFloat((net - amount).toFixed(2))
  return Math.max(0, net)
}

function normalizeHeldCartItem(i: CartItem): CartItem {
  const lineTotal = i.lineTotal
  const discountRate = i.discountRate ?? 0
  const discountAmount = i.discountAmount ?? 0
  const netTotal = i.netTotal ?? calcLineDiscount(lineTotal, discountRate, discountAmount)
  return { ...i, lineTotal, discountRate, discountAmount, netTotal }
}

export default function POSScreen({
  companyId, cashier, allProducts,
  pluGroups, posSettings,
  onBack, onLogout,
  pendingMessage, onMessageClose,
  merkezToast = null,
  onCartChange,
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
  const [cancelWarning, setCancelWarning] = useState<string | null>(null)
  const [docDiscountMode, setDocDiscountMode] = useState(false)
  const [docDiscountRate, setDocDiscountRate] = useState(0)
  const [docDiscountAmt, setDocDiscountAmt]   = useState(0)
  const [lineDiscountTarget, setLineDiscountTarget] = useState<string | null>(null)
  const [lineDiscRateIn, setLineDiscRateIn]   = useState('')
  const [lineDiscAmtIn, setLineDiscAmtIn]     = useState('')
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

  useEffect(() => {
    onCartChange?.(cart.length > 0)
  }, [cart.length, onCartChange])

  useEffect(() => {
    return () => {
      onCartChange?.(false)
    }
  }, [onCartChange])

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

  const pluCols      = posSettings.pluCols ?? 4
  const pluRows      = posSettings.pluRows ?? 3
  const PLU_PER_PAGE = pluCols * pluRows
  const fontSizeName  = posSettings.fontSizeName ?? 12
  const fontSizePrice = posSettings.fontSizePrice ?? 13
  const fontSizeCode  = posSettings.fontSizeCode ?? 9

  const totalPages = Math.max(1, Math.ceil(filtered.length / PLU_PER_PAGE))
  const safePage   = Math.min(page, totalPages - 1)
  const slice      = filtered.slice(safePage * PLU_PER_PAGE, (safePage + 1) * PLU_PER_PAGE)

  useEffect(() => { setPage(0) }, [activeGroup, searchQ, pluCols, pluRows])

  function showCancelWarning(msg: string) {
    setCancelWarning(msg)
    setTimeout(() => setCancelWarning(null), 3000)
  }

  useEffect(() => {
    if (!lineDiscountTarget) {
      setLineDiscRateIn('')
      setLineDiscAmtIn('')
      return
    }
    const c = cart.find(x => x.id === lineDiscountTarget)
    if (c) {
      setLineDiscRateIn(c.discountRate ? String(c.discountRate) : '')
      setLineDiscAmtIn(c.discountAmount ? String(c.discountAmount) : '')
    }
  }, [lineDiscountTarget])

  /* ── Barkod okuyucu ── */
  useEffect(() => {
    if (searchQ.length < 2) return
    const t = setTimeout(() => {
      const byBarcode = allProducts.find(p => p.barcode === searchQ)
      if (!byBarcode) return
      const qty = numBuf ? Math.max(1, parseInt(numBuf, 10)) : 1
      setNumBuf('')
      setSearchQ('')

      if (cancelMode) {
        setCart(prev => {
          const ex = prev.find(c => c.id === byBarcode.id)
          if (!ex) {
            showCancelWarning('Bu ürün sepette yok.')
            return prev
          }
          if (ex.quantity < qty) {
            showCancelWarning(`Sepette ${ex.quantity} adet var, ${qty} adet düşülemez.`)
            return prev
          }
          if (ex.quantity === qty) {
            const next = prev.filter(c => c.id !== byBarcode.id)
            if (next.length === 0) setCancelMode(false)
            return next
          }
          const newQty = ex.quantity - qty
          const newTotal = parseFloat((newQty * ex.price).toFixed(2))
          const netTotal = calcLineDiscount(newTotal, ex.discountRate, ex.discountAmount)
          return prev.map(c => c.id === byBarcode.id
            ? { ...c, quantity: newQty, lineTotal: newTotal, netTotal }
            : c
          )
        })
        return
      }
      addToCartWithQty(byBarcode, qty)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ, cancelMode, numBuf, allProducts])

  /* ── Sepet işlemleri ── */
  function addToCartWithQty(product: ProductRow, qty: number) {
    setCart(prev => {
      const ex = prev.find(c => c.id === product.id)
      const dup = posSettings.duplicateItemAction ?? 'increase_qty'

      if (ex && dup === 'increase_qty') {
        const newQty = ex.quantity + qty
        const newTotal = parseFloat((newQty * ex.price).toFixed(2))
        const netTotal = calcLineDiscount(newTotal, ex.discountRate, ex.discountAmount)
        return prev.map(c => c.id === product.id
          ? { ...c, quantity: newQty, lineTotal: newTotal, netTotal }
          : c
        )
      }

      const lineTotal = parseFloat((product.price * qty).toFixed(2))
      return [...prev, {
        id: product.id, code: product.code ?? '', name: product.name,
        category: product.category ?? '', price: product.price,
        vatRate: product.vatRate ?? 18, unit: product.unit ?? 'Adet',
        quantity: qty, lineTotal,
        discountRate: 0, discountAmount: 0, netTotal: lineTotal,
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
    const minQty = posSettings.minQtyPerLine ?? 1
    setCart(prev => prev.map(c => {
      if (c.id !== id) return c
      const newQty = Math.max(minQty, c.quantity + delta)
      const newTotal = parseFloat((newQty * c.price).toFixed(2))
      const netTotal = calcLineDiscount(newTotal, c.discountRate, c.discountAmount)
      return { ...c, quantity: newQty, lineTotal: newTotal, netTotal }
    }))
  }

  function applyLineDiscount() {
    if (!lineDiscountTarget) return
    const rate = parseFloat(lineDiscRateIn) || 0
    const amt = parseFloat(lineDiscAmtIn) || 0
    const maxPct = posSettings.maxLineDiscountPct ?? 100
    if (rate > maxPct) {
      alert(`Maksimum satır iskontosu %${maxPct}`)
      return
    }
    setCart(prev => prev.map(c => {
      if (c.id !== lineDiscountTarget) return c
      const netTotal = calcLineDiscount(c.lineTotal, rate, amt)
      return { ...c, discountRate: rate, discountAmount: amt, netTotal }
    }))
    setLineDiscountTarget(null)
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
    setDocDiscountMode(false)
    setDocDiscountRate(0)
    setDocDiscountAmt(0)
    setLineDiscountTarget(null)
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
    const lineSub = cart.reduce((s, c) => s + c.netTotal, 0)
    await window.electron.db.holdDocument({
      companyId, label, items: cart,
      totalAmount: lineSub,
    })
    clearCart()
    loadHeld()
    closeMenu()
  }

  async function retrieveDoc(doc: HeldDocRow) {
    setCart(doc.items.map(normalizeHeldCartItem))
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

  /* ── Ödeme — satır netleri + belge iskontosu ── */
  const lineSubtotal = cart.reduce((s, c) => s + c.netTotal, 0)
  const docDiscountCalc = docDiscountRate > 0
    ? parseFloat((lineSubtotal * docDiscountRate / 100).toFixed(2))
    : docDiscountAmt
  const grandTotal = Math.max(0, parseFloat((lineSubtotal - docDiscountCalc).toFixed(2)))
  const vatTotal   = cart.reduce((s, c) => s + (c.netTotal * c.vatRate / (100 + c.vatRate)), 0)
  const discountFactor = lineSubtotal > 0 ? grandTotal / lineSubtotal : 1
  const vatAdjusted = parseFloat((vatTotal * discountFactor).toFixed(2))
  const cashAmount = parseFloat(cashInput) || 0
  const change     = cashAmount - grandTotal

  async function completeSale() {
    if (!cart.length) return
    setSaving(true)
    try {
      const receiptNo = nextReceiptNo()
      await window.electron.db.saveSale({
        receiptNo,
        totalAmount: lineSubtotal,
        discountRate: docDiscountRate,
        discountAmount: docDiscountCalc,
        netAmount: grandTotal,
        paymentType,
        cashAmount: paymentType === 'card'  ? 0 : (paymentType === 'cash' ? cashAmount || grandTotal : cashAmount),
        cardAmount: paymentType === 'cash'  ? 0 : (paymentType === 'card' ? grandTotal : grandTotal - cashAmount),
      }, cart.map(c => ({
        productId: c.id,
        productName: c.name,
        quantity: c.quantity,
        unitPrice: c.price,
        vatRate: c.vatRate,
        discountRate: c.discountRate,
        discountAmount: c.discountAmount,
        lineTotal: c.netTotal,
        appliedBy: cashier.id,
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
  const activeSoft  = hexToSoft(activeColor)

  /* ────────── RENDER ────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#e5e7eb', overflow: 'hidden' }}>

      {/* Lisans banner */}
      {license?.warning && <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />}

      {/* ── HEADER ── */}
      <div style={{
        background: cancelMode ? '#C62828' : '#1565C0',
        height: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        flexShrink: 0,
        position: 'relative',
        transition: 'background 0.3s',
      }}>
        {cancelMode && (
          <div style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.2)',
            borderRadius: 6,
            padding: '3px 16px',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
            color: 'white',
            pointerEvents: 'none',
          }}>
            ✕ İPTAL MODU AKTİF
          </div>
        )}
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

      {/* Satır iskontosu modal */}
      {lineDiscountTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 14, padding: 24, width: 360, maxWidth: '92vw' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Satır İskontosu</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#757575', display: 'block', marginBottom: 4 }}>Yüzde (%)</label>
              <input
                type="number"
                min={0}
                max={posSettings.maxLineDiscountPct ?? 100}
                placeholder="0"
                value={lineDiscRateIn}
                onChange={e => setLineDiscRateIn(e.target.value)}
                style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: '#757575', display: 'block', marginBottom: 4 }}>Tutar (₺)</label>
              <input
                type="number"
                min={0}
                placeholder="0,00"
                value={lineDiscAmtIn}
                onChange={e => setLineDiscAmtIn(e.target.value)}
                style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setLineDiscountTarget(null)}
                style={{ flex: 1, background: '#F5F5F5', border: '1px solid #E0E0E0', borderRadius: 8, padding: 10, cursor: 'pointer', fontSize: 13 }}
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => applyLineDiscount()}
                style={{ flex: 1, background: '#E65100', border: 'none', borderRadius: 8, padding: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'white' }}
              >
                Uygula
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── 4 PANEL — toplam %100 ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ① SEPET — %42 */}
        <div style={{ width: '42%', flexShrink: 0, boxSizing: 'border-box', background: cancelMode ? '#fff5f5' : 'white', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e0e0e0', transition: 'background 0.25s' }}>

          {/* Başlık */}
          <div style={{ padding: '8px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 40, flexShrink: 0, background: '#f8f9fa' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>Satış Belgesi</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{cart.length > 0 ? `${cart.length} kalem` : 'Boş'}</span>
              {cart.length > 0 && (
                <>
                  <button
                    onClick={() => {
                      if (!cancelMode && cart.length === 0) return
                      setCancelMode(m => !m)
                    }}
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

          {/* İptal ipucu */}
          {cancelMode && (
            <div style={{ background: 'rgba(198,40,40,0.12)', color: '#b71c1c', fontSize: 10, fontWeight: 600, textAlign: 'center', padding: 4, flexShrink: 0 }}>
              Satıra veya ✕ ile kaldırın · barkod ile adet düşürün
            </div>
          )}

          {/* Sütun başlıkları */}
          <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) 96px 62px 52px 78px 28px', gap: '0 4px', padding: '5px 10px', background: '#f0f2f4', borderBottom: '1px solid #e0e0e0', flexShrink: 0 }}>
            {['İşlem', 'Ürün', 'Miktar', 'B.Fiyat', 'İsk.', 'Tutar', ''].map((h, i) => (
              <span key={i} style={{ fontSize: 9, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.2px', textAlign: i >= 2 && i <= 5 ? 'center' : 'left' }}>{h}</span>
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
                onClick={() => {
                  if (cancelMode) removeFromCart(item.id)
                  else if (posSettings.allowLineDiscount) setLineDiscountTarget(item.id)
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '44px minmax(0,1fr) 96px 62px 52px 78px 28px',
                  gap: '0 4px',
                  padding: '8px 10px',
                  alignItems: 'center',
                  borderBottom: '1px solid #f5f5f5',
                  cursor: cancelMode || posSettings.allowLineDiscount ? 'pointer' : 'default',
                  background: cancelMode ? '#fff5f5' : 'white',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => {
                  if (cancelMode) (e.currentTarget as HTMLDivElement).style.background = '#ffebee'
                }}
                onMouseLeave={e => {
                  if (cancelMode) (e.currentTarget as HTMLDivElement).style.background = '#fff5f5'
                }}
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
                <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'center' }}>{fmt(item.price)}</div>

                {/* İskonto */}
                <div style={{ fontSize: 10, color: '#E65100', textAlign: 'center', fontWeight: 600 }}>
                  {item.discountRate > 0
                    ? `%${item.discountRate}`
                    : item.discountAmount > 0
                      ? `-${fmt(item.discountAmount)}`
                      : '—'}
                </div>

                {/* Tutar (iskonto sonrası) */}
                <div style={{ fontSize: 12, fontWeight: 600, color: cancelMode ? '#dc2626' : '#111', textAlign: 'right' }}>{fmt(item.netTotal)}</div>

                {/* Sil — yalnız iptal modunda */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {cancelMode && (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); removeFromCart(item.id) }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeFromCart(item.id) } }}
                      style={{ width: 20, height: 20, background: '#dc2626', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'white', cursor: 'pointer' }}
                    >✕</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Özet + toplam */}
          <div style={{ borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
            <div style={{ padding: '6px 14px 0' }}>
              {(posSettings.allowDocDiscount ?? true) && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <button
                      type="button"
                      onClick={() => setDocDiscountMode(m => !m)}
                      style={{ fontSize: 10, color: '#E65100', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                    >
                      {docDiscountMode ? 'İskonto Kapat' : '+ Belge İskontosu'}
                    </button>
                    {docDiscountCalc > 0 && (
                      <span style={{ fontSize: 10, color: '#E65100', fontWeight: 600 }}>-{fmt(docDiscountCalc)}</span>
                    )}
                  </div>
                  {docDiscountMode && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input
                        type="number"
                        min={0}
                        max={posSettings.maxDocDiscountPct ?? 100}
                        placeholder="% iskonto"
                        value={docDiscountRate || ''}
                        onChange={e => { setDocDiscountRate(parseFloat(e.target.value) || 0); setDocDiscountAmt(0) }}
                        style={{ flex: 1, border: '1px solid #FFB74D', borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none', minWidth: 0 }}
                      />
                      <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>veya</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="₺ iskonto"
                        value={docDiscountAmt || ''}
                        onChange={e => { setDocDiscountAmt(parseFloat(e.target.value) || 0); setDocDiscountRate(0) }}
                        style={{ flex: 1, border: '1px solid #FFB74D', borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none', minWidth: 0 }}
                      />
                    </div>
                  )}
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 10, color: '#9ca3af' }}>Ara Toplam</span>
                <span style={{ fontSize: 10, color: '#374151' }}>{fmt(lineSubtotal)}</span>
              </div>
              {docDiscountCalc > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: 10, color: '#E65100' }}>Belge İskontosu</span>
                  <span style={{ fontSize: 10, color: '#E65100', fontWeight: 600 }}>-{fmt(docDiscountCalc)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 10, color: '#9ca3af' }}>KDV</span>
                <span style={{ fontSize: 10, color: '#374151' }}>{fmt(vatAdjusted)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 14px 10px', borderTop: '1px solid #f0f0f0', marginTop: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>Genel Toplam</span>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#1565C0' }}>{fmt(grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* ② NUMPAD + MENÜ — %16 (PLU’dan pay) */}
        <div style={{ width: '16%', flexShrink: 0, boxSizing: 'border-box', background: '#f8f9fa', display: 'flex', flexDirection: 'column', padding: 10, gap: 8, borderRight: '1px solid #e0e0e0', overflow: 'hidden' }}>

          {/* İşlemler menüsü — üstte */}
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
                  action: () => { if (!cancelMode && cart.length === 0) return; setCancelMode(m => !m); closeMenu() },
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

          <div style={{ height: 1, background: '#e5e7eb', flexShrink: 0 }} />

          {/* Boşluk — seçili gösterge + numerik altta */}
          <div style={{ flex: 1, minHeight: 0 }} />

          {/* Miktar göstergesi (adet seçili) — tek gösterge */}
          <div style={{ borderRadius: 10, padding: '10px 8px', textAlign: 'center', border: `1px solid ${numBuf ? '#a5d6a7' : '#fde68a'}`, background: numBuf ? '#e8f5e9' : '#fff8e1', flexShrink: 0 }}>
            <span style={{ fontSize: 'clamp(22px, 1.8vw + 12px, 34px)', fontWeight: 700, color: numBuf ? '#2e7d32' : '#d97706', display: 'block', lineHeight: 1 }}>{numBuf || '—'}</span>
            <span style={{ fontSize: 12, color: '#6b7280', marginTop: 4, display: 'block', fontWeight: 500 }}>adet seçili</span>
          </div>

          {/* Numpad — büyük dokunma alanı (yaşlı kullanıcı dostu, min ~52px) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, flexShrink: 0 }}>
            {['7','8','9','4','5','6','1','2','3','C','0','⌫'].map(k => (
              <button key={k} onClick={() => handleNumKey(k)}
                type="button"
                style={{
                  minHeight: 52,
                  height: 'clamp(52px, 5.5vw, 84px)',
                  border: '2px solid',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontSize: 'clamp(22px, 1.7vw + 12px, 36px)',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  userSelect: 'none' as const,
                  background: k === 'C' ? '#fff5f5' : k === '⌫' ? '#fffbeb' : 'white',
                  color:      k === 'C' ? '#dc2626' : k === '⌫' ? '#d97706' : '#1f2937',
                  borderColor: k === 'C' ? '#fecdd3' : k === '⌫' ? '#fde68a' : '#d1d5db',
                }}
              >{k}</button>
            ))}
          </div>
        </div>

        {/* ③ PLU — %35 */}
        <div style={{ width: '35%', flexShrink: 0, boxSizing: 'border-box', background: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #e0e0e0', minWidth: 0 }}>

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

          {/* PLU grid — sütun/satır sayısı posSettings'ten */}
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
                    <div style={{ fontSize: fontSizeName, fontWeight: 500, color: '#212121', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    {(posSettings.showCode || posSettings.showBarcode) && (
                      <div style={{ fontSize: fontSizeCode, color: '#9ca3af', fontFamily: 'monospace', marginTop: 1 }}>
                        {posSettings.showCode && p.code}
                        {posSettings.showCode && posSettings.showBarcode && p.barcode && ' · '}
                        {posSettings.showBarcode && p.barcode}
                      </div>
                    )}
                  </div>
                  {posSettings.showPrice && (
                    <div style={{ fontSize: fontSizePrice, fontWeight: 700, color: activeColor, flexShrink: 0, marginLeft: 8 }}>{fmt(p.price)}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              padding: 6,
              display: 'grid',
              gridTemplateColumns: `repeat(${pluCols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${pluRows}, minmax(0, 1fr))`,
              gap: 5,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}>
              {Array.from({ length: PLU_PER_PAGE }).map((_, i) => {
                const p = slice[i]
                if (!p) return <div key={`e${i}`} style={{ borderRadius: 8, background: '#fafafa', border: '1px dashed #f0f0f0' }} />
                return (
                  <div key={p.id} onClick={() => handlePluClick(p)}
                    style={{ borderRadius: 8, padding: '6px 4px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, border: '2px solid transparent', background: activeSoft, transition: 'all 0.15s', overflow: 'hidden' }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = activeColor; el.style.transform = 'scale(1.02)' }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'transparent'; el.style.transform = 'scale(1)' }}
                    onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(0.95)' }}
                    onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                  >
                    <div style={{ fontSize: fontSizeName, fontWeight: 600, color: '#374151', textAlign: 'center', lineHeight: 1.2 }}>{p.name}</div>
                    {posSettings.showCode && <div style={{ fontSize: fontSizeCode, color: '#9ca3af', fontFamily: 'monospace' }}>{p.code}</div>}
                    {posSettings.showBarcode && p.barcode && <div style={{ fontSize: fontSizeCode, color: '#b0b0b0', fontFamily: 'monospace' }}>{p.barcode}</div>}
                    {posSettings.showPrice && <div style={{ fontSize: fontSizePrice, fontWeight: 700, color: activeColor }}>{fmt(p.price)}</div>}
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

        {/* ④ GRUPLAR — %7 */}
        <div style={{ width: '7%', flexShrink: 0, boxSizing: 'border-box', background: '#f3f4f6', display: 'flex', flexDirection: 'column', overflowY: 'auto', minWidth: 0 }}>
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

      {cancelWarning && (
        <div style={{
          position: 'fixed',
          bottom: merkezToast ? 72 : 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: '#C62828',
          color: 'white',
          borderRadius: 10,
          padding: '12px 24px',
          fontSize: 13,
          fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          maxWidth: '90vw',
          textAlign: 'center',
        }}>
          ⚠ {cancelWarning}
        </div>
      )}

      {merkezToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#212121', color: 'white', padding: '10px 20px', borderRadius: 8, fontSize: 13, zIndex: 10001, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          {merkezToast}
        </div>
      )}
    </div>
  )
}

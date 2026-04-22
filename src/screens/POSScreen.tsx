import { useState, useEffect, useRef, useCallback, type ReactNode, type CSSProperties } from 'react'
import { useLicenseCheck } from '../hooks/useLicenseCheck'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import { sendInvoiceForSale, enqueueCustomer } from '../lib/invoiceSend'
import { useQueueWorker, type QueueToastPayload } from '../hooks/useQueueWorker'
import AppLogo from '../components/AppLogo'
import LicenseBanner from '../components/LicenseBanner'
import ConnectionDot from '../components/ConnectionDot'

const CART_GRID = '24px 1fr 72px 82px'

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
  cartSettings:    CartSettings
  commandListenerActive?: boolean
  commandSyncing?: boolean
  commandRecentlyReceived?: boolean
  commandDeferred?: boolean
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
  return { ...i, lineTotal, discountRate, discountAmount, netTotal, barcode: i.barcode ?? '' }
}

export default function POSScreen({
  companyId, cashier, allProducts,
  pluGroups, posSettings,
  onBack, onLogout,
  pendingMessage, onMessageClose,
  merkezToast = null,
  onCartChange,
  cartSettings,
  commandListenerActive = false,
  commandSyncing = false,
  commandRecentlyReceived = false,
  commandDeferred = false,
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
  const [addCustomerModal, setAddCustomerModal] = useState(false)
  const [newCustPrefill, setNewCustPrefill] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!showCustomer || !companyId) return
    window.electron.db.getCustomers(companyId, customerQ)
      .then(setCustomers)
      .catch(() => setCustomers([]))
  }, [customerQ, showCustomer, companyId])
  const license   = useLicenseCheck(companyId)
  const conn      = useConnectionStatus(30)
  const isOnline  = conn === 'online'
  const [queueToasts, setQueueToasts] = useState<(QueueToastPayload & { shownAt: number })[]>([])

  const handleQueueToast = useCallback((toast: QueueToastPayload) => {
    setQueueToasts(prev => [...prev, { ...toast, shownAt: Date.now() }])
    setTimeout(() => {
      setQueueToasts(prev => prev.filter(t => t.id !== toast.id))
    }, 4000)
  }, [])

  useQueueWorker({
    companyId,
    isOnline,
    onToast: handleQueueToast,
  })

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
      const qty = numBuf ? Math.max(0.01, parseFloat(numBuf.replace(',', '.'))) : 1
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
        barcode: product.barcode ?? '',
      }]
    })
  }

  function handlePluClick(product: ProductRow) {
    const qty = numBuf ? Math.max(0.01, parseFloat(numBuf.replace(',', '.'))) : 1
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
      alert(`Maksimum satır indirimi %${maxPct}`)
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

    if (k === ',') {
      if (numBuf.includes(',')) return
      setNumBuf(p => (p === '' ? '0,' : p + ','))
      return
    }

    if (numBuf.includes(',')) {
      const dec = numBuf.split(',')[1] ?? ''
      if (dec.length >= 2) return
    }

    if (numBuf.replace(',', '').length < 6) {
      setNumBuf(p => p + k)
    }
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
    try {
      const list = await window.electron.db.getCustomers(companyId)
      setCustomers(list)
    } catch {
      setCustomers([])
    }
  }

  /* ── Ödeme — ara toplam, satır/belge indirimi, KDV, genel toplam ── */
  const araToplamBrut = cart.reduce((s, c) => s + c.price * c.quantity, 0)
  const satirIndirimi = cart.reduce((s, c) => {
    const brut = c.price * c.quantity
    const lt = c.lineTotal ?? brut
    return s + Math.max(0, lt - c.netTotal)
  }, 0)
  const lineSubtotal = cart.reduce((s, c) => s + c.netTotal, 0)
  const docDiscountCalc = docDiscountRate > 0
    ? parseFloat((lineSubtotal * docDiscountRate / 100).toFixed(2))
    : docDiscountAmt
  const belgeIndirimi = docDiscountCalc
  const grandTotal = Math.max(0, parseFloat((lineSubtotal - docDiscountCalc).toFixed(2)))
  const toplamIndirim = satirIndirimi + belgeIndirimi
  const vatFromLines = cart.reduce((s, c) => s + (c.netTotal * c.vatRate / (100 + c.vatRate)), 0)
  const toplamKdv = lineSubtotal > 0
    ? parseFloat((vatFromLines * (grandTotal / lineSubtotal)).toFixed(2))
    : 0
  const cashAmount = parseFloat(cashInput) || 0
  const change     = cashAmount - grandTotal
  const commandIconAnimation = commandSyncing
    ? 'merkezMailPulse 0.9s ease-in-out infinite, merkezMailShake 1.4s ease-in-out infinite'
    : commandDeferred
      ? 'merkezMailWaitPulse 1s ease-in-out infinite, merkezMailShake 2s ease-in-out infinite'
      : commandRecentlyReceived
      ? 'merkezMailPulse 1.2s ease-in-out infinite'
      : 'merkezMailIdle 2.6s ease-in-out infinite'

  async function completeSale() {
    if (!cart.length) return
    setSaving(true)
    try {
      const receiptNo = nextReceiptNo()
      const saleRow: SaleRow = {
        receiptNo,
        totalAmount: lineSubtotal,
        discountRate: docDiscountRate,
        discountAmount: docDiscountCalc,
        netAmount: grandTotal,
        paymentType,
        cashAmount: paymentType === 'card'  ? 0 : (paymentType === 'cash' ? cashAmount || grandTotal : cashAmount),
        cardAmount: paymentType === 'cash'  ? 0 : (paymentType === 'card' ? grandTotal : grandTotal - cashAmount),
        customerId:   selectedCustomer?.id   ?? null,
        customerName: selectedCustomer?.name ?? null,
        customerCode: selectedCustomer?.code ?? null,
      }
      const saleId = await window.electron.db.saveSale(saleRow, cart.map(c => ({
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
      const cust = selectedCustomer
      if (cust && saleId && companyId) {
        void sendInvoiceForSale(companyId, saleId, cust)
      }
      setLastReceipt(receiptNo)
      setSelectedCustomer(null)
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
      <style>{`
        @keyframes merkezMailPulse {
          0%   { transform: scale(1); box-shadow: 0 0 0 0 rgba(37,99,235,0.35); }
          70%  { transform: scale(1.08); box-shadow: 0 0 0 9px rgba(37,99,235,0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(37,99,235,0); }
        }
        @keyframes merkezMailShake {
          0%, 100% { transform: rotate(0deg); }
          25%      { transform: rotate(-8deg); }
          50%      { transform: rotate(8deg); }
          75%      { transform: rotate(-5deg); }
        }
        @keyframes merkezMailIdle {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-2px); }
        }
        @keyframes merkezMailWaitPulse {
          0%   { transform: scale(1); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.45); }
          70%  { transform: scale(1.1); box-shadow: 0 0 0 10px rgba(245, 158, 11, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
        }
      `}</style>

      {/* Lisans banner */}
      {license?.warning && <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />}

      {/* ── HEADER ── */}
      <div style={{
        background: cancelMode ? '#C62828' : '#030712',
        borderBottom: cancelMode ? 'none' : '1px solid #1f2937',
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
          <AppLogo height={28} />
          <button
            type="button"
            onClick={onBack}
            style={{
              background: cancelMode ? 'rgba(255,255,255,0.18)' : '#1f2937',
              border: cancelMode ? '1px solid rgba(255,255,255,0.28)' : '1px solid #374151',
              borderRadius: 6,
              color: cancelMode ? '#ffffff' : '#e5e7eb',
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            ← Dashboard
          </button>
          {lastReceipt && (
            <span style={{ background: '#E8F5E9', color: '#2E7D32', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 500 }}>
              ✓ {lastReceipt}
            </span>
          )}
          {selectedCustomer && (
            <span style={{
              background: cancelMode ? 'rgba(255,255,255,0.15)' : '#1f2937',
              color: cancelMode ? '#ffffff' : '#e5e7eb',
              border: cancelMode ? '1px solid rgba(255,255,255,0.25)' : '1px solid #374151',
              borderRadius: 6,
              padding: '3px 8px',
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              👤 {selectedCustomer.name}
              <button type="button" onClick={() => setSelectedCustomer(null)} style={{ background: 'none', border: 'none', color: cancelMode ? '#fecaca' : '#93c5fd', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConnectionDot status={conn} />
          {commandListenerActive && (
            <span
              title={
                commandSyncing
                  ? 'Merkez komutu işleniyor'
                  : (commandDeferred
                    ? 'Satış aktif: merkez komutu sırada bekliyor'
                    : (commandRecentlyReceived
                      ? 'Merkezden yeni komut alındı'
                      : 'Merkez komutları dinleniyor'))
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: '50%',
                fontSize: 12,
                border: commandSyncing
                  ? '1px solid #93C5FD'
                  : commandDeferred
                    ? '1px solid #FCD34D'
                  : commandRecentlyReceived
                    ? '1px solid #BFDBFE'
                    : '1px solid #4B5563',
                background: commandSyncing
                  ? '#1D4ED8'
                  : commandDeferred
                    ? '#B45309'
                  : commandRecentlyReceived
                    ? '#2563EB'
                    : '#111827',
                color: '#fff',
                boxShadow: commandSyncing
                  ? '0 0 0 4px rgba(37, 99, 235, 0.22)'
                  : commandDeferred
                    ? '0 0 0 4px rgba(245, 158, 11, 0.18)'
                  : 'none',
                animation: commandIconAnimation,
                position: 'relative',
              }}
            >
              ✉️
              {commandDeferred && (
                <span
                  style={{
                    position: 'absolute',
                    right: -1,
                    top: -1,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#F59E0B',
                    border: '1px solid #fff',
                  }}
                />
              )}
            </span>
          )}
          <span style={{
            background: cancelMode ? 'rgba(255,255,255,0.12)' : '#1f2937',
            border: cancelMode ? '1px solid rgba(255,255,255,0.22)' : '1px solid #374151',
            borderRadius: 6,
            padding: '3px 8px',
            color: cancelMode ? '#fecaca' : '#d1d5db',
            fontSize: 11,
          }}>
            {cashier.fullName}
          </span>
          <button
            type="button"
            onClick={onLogout}
            style={{
              background: cancelMode ? 'rgba(0,0,0,0.2)' : 'rgba(127, 29, 29, 0.45)',
              border: cancelMode ? '1px solid rgba(0,0,0,0.35)' : '1px solid #7f1d1d',
              borderRadius: 6,
              color: cancelMode ? '#ffffff' : '#fecaca',
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Çıkış
          </button>
        </div>
      </div>

      {/* Satır indirimi modal */}
      {lineDiscountTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 14, padding: 24, width: 360, maxWidth: '92vw' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Satır İndirimi</div>
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
              {customers.map(c => (
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
              {customers.length === 0 && customerQ.trim().length >= 2 && (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <div style={{ fontSize: 13, color: '#9E9E9E', marginBottom: 12 }}>
                    "{customerQ}" bulunamadı
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNewCustPrefill(customerQ)
                      setAddCustomerModal(true)
                      setShowCustomer(false)
                    }}
                    style={{
                      background: '#1565C0', color: 'white', border: 'none',
                      borderRadius: 8, padding: '8px 18px', fontSize: 13,
                      fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    + Yeni Müşteri Ekle
                  </button>
                </div>
              )}
              {customers.length === 0 && customerQ.trim().length < 2 && (
                <div style={{ textAlign: 'center', color: '#BDBDBD', padding: '32px 0', fontSize: 13 }}>
                  Müşteriler yükleniyor...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {addCustomerModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'white', borderRadius: 14, width: '100%', maxWidth: 480,
            maxHeight: '90vh', overflowY: 'auto', padding: 24,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Yeni Müşteri Ekle</span>
              <button onClick={() => setAddCustomerModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9E9E9E' }}>✕</button>
            </div>
            <AddCustomerForm
              prefillTaxNo={newCustPrefill}
              onClose={() => setAddCustomerModal(false)}
              onSuccess={async (customer) => {
                const newId = crypto.randomUUID()
                const parts = customer.name.trim().split(/\s+/).filter(Boolean)
                const firstName = parts[0] ?? ''
                const lastName = parts.slice(1).join(' ')
                await window.electron.db.upsertCustomer({
                  id:         newId,
                  companyId,
                  code:       '',
                  name:       customer.name,
                  phone:      customer.phone ?? '',
                  taxNo:      customer.taxNo ?? '',
                  address:    customer.address ?? '',
                  balance:    0,
                  isPerson:   customer.isPerson ?? true,
                  firstName,
                  lastName,
                  postalCode: '',
                  city:       customer.city ?? '',
                  district:   customer.district ?? '',
                  syncedAt:   new Date().toISOString(),
                })
                await enqueueCustomer(companyId, {
                  firmType:   1,
                  isPerson:   customer.isPerson ?? true,
                  name:       customer.name,
                  taxNo:      customer.taxNo ?? '',
                  taxOffice:  customer.taxOffice ?? '',
                  phone:      customer.phone ?? '',
                  email:      customer.email ?? '',
                  address:    customer.address ?? '',
                  city:       customer.city ?? '',
                  district:   customer.district ?? '',
                  postalCode: customer.postalCode ?? '',
                }, customer.name)
                setSelectedCustomer({
                  id:         newId,
                  companyId,
                  code:       '',
                  name:       customer.name,
                  phone:      customer.phone ?? '',
                  taxNo:      customer.taxNo ?? '',
                  address:    customer.address ?? '',
                  balance:    0,
                  isPerson:   customer.isPerson ?? true,
                  firstName,
                  lastName,
                  postalCode: '',
                  city:       customer.city ?? '',
                  district:   customer.district ?? '',
                })
                setAddCustomerModal(false)
              }}
            />
          </div>
        </div>
      )}

      {/* ── 4 PANEL — toplam %100 ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ① SEPET — %42 */}
        <div style={{ width: '42%', flexShrink: 0, boxSizing: 'border-box', background: cancelMode ? '#fff8f8' : '#f6f7f9', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e8eaef', transition: 'background 0.25s' }}>

          {/* Sepet header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 12px', height: 38, background: '#fafafa',
            borderBottom: '1px solid #e8eaef', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Satış Belgesi</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>
                {cart.length > 0 ? `${cart.length} kalem` : 'Boş'}
              </span>
              <button
                type="button"
                onClick={() => setCancelMode(p => !p)}
                style={{
                  fontSize: 11, color: cancelMode ? '#1565C0' : '#dc2626',
                  background: 'none', border: 'none', cursor: 'pointer',
                }}
              >
                {cancelMode ? '← Geri' : '✕ İptal'}
              </button>
              <button
                type="button"
                onClick={clearCart}
                style={{
                  fontSize: 11, background: '#dc2626', color: 'white',
                  border: 'none', borderRadius: 8, padding: '4px 12px',
                  cursor: 'pointer', fontWeight: 500,
                }}
              >Temizle</button>
            </div>
          </div>

          {/* İptal ipucu */}
          {cancelMode && (
            <div style={{ background: 'rgba(198,40,40,0.12)', color: '#b71c1c', fontSize: 10, fontWeight: 600, textAlign: 'center', padding: 4, flexShrink: 0 }}>
              Satıra tıklayarak kaldırın · barkod ile adet düşürün
            </div>
          )}

          <div style={{
            display: 'grid', gridTemplateColumns: CART_GRID,
            padding: '8px 14px', background: '#f0f1f4',
            borderBottom: '1px solid #e2e5eb', flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }} />
            <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Ürün Adı</span>
            <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', textAlign: 'center' }}>Miktar</span>
            <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>Tutar</span>
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: 0,
            background: cancelMode ? '#fff9f9' : '#f3f4f6',
            padding: '6px 10px 10px',
          }}>
            {cart.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#d1d5db', fontSize: 13, flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 32 }}>🛒</span>
                <span>Sepet boş — ürün seçin veya barkod okutun</span>
              </div>
            ) : cart.map((item, rowIdx) => {
              const dr = item.discountRate ?? 0
              const da = item.discountAmount ?? 0
              const rowBg = cancelMode
                ? (rowIdx % 2 === 0 ? '#fffdfd' : '#fff8f8')
                : (rowIdx % 2 === 0 ? '#ffffff' : '#fafbfc')
              const pills: ReactNode[] = []
              pills.push(
                <span key="kod" style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '0 5px', height: 16, borderRadius: 3,
                  fontSize: cartSettings.fsPill, whiteSpace: 'nowrap', flexShrink: 0,
                  background: '#F3F4F6', color: '#4B5563', border: '1px solid #E5E7EB',
                  fontFamily: 'monospace',
                }}>{item.code}</span>,
              )
              if (cartSettings.showBarkod && item.barcode?.trim()) pills.push(
                <span key="bar" style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '0 5px', height: 16, borderRadius: 3,
                  fontSize: cartSettings.fsPill, whiteSpace: 'nowrap', flexShrink: 0,
                  background: '#F3E5F5', color: '#4A148C', border: '1px solid #E1BEE7',
                  fontFamily: 'monospace',
                }}>{item.barcode}</span>,
              )
              if (cartSettings.showBirim) pills.push(
                <span key="birim" style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '0 5px', height: 16, borderRadius: 3,
                  fontSize: cartSettings.fsPill, whiteSpace: 'nowrap', flexShrink: 0,
                  background: '#E8F5E9', color: '#1B5E20', border: '1px solid #A5D6A7',
                }}>{item.unit ?? 'Adet'}</span>,
              )
              if (cartSettings.showFiyat) pills.push(
                <span key="fp" style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '0 5px', height: 16, borderRadius: 3,
                  fontSize: cartSettings.fsPill, whiteSpace: 'nowrap', flexShrink: 0,
                  background: '#E3F2FD', color: '#0D47A1', border: '1px solid #BBDEFB',
                }}>{fmt(item.price)}</span>,
              )
              if (cartSettings.showIskonto && (dr > 0 || da > 0)) pills.push(
                <span key="dis" style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '0 5px', height: 16, borderRadius: 3,
                  fontSize: cartSettings.fsPill, whiteSpace: 'nowrap', flexShrink: 0,
                  background: '#FCE4EC', color: '#880E4F', border: '1px solid #F8BBD0',
                }}>
                  {dr > 0 ? `-%${dr}` : `-${fmt(da)}`}
                </span>,
              )
              if (cartSettings.showKdv) pills.push(
                <span key="kdv" style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '0 5px', height: 16, borderRadius: 3,
                  fontSize: cartSettings.fsPill, whiteSpace: 'nowrap', flexShrink: 0,
                  background: '#FFF3E0', color: '#BF360C', border: '1px solid #FFCCBC',
                }}>KDV %{item.vatRate}</span>,
              )

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (cancelMode) removeFromCart(item.id)
                    else if (posSettings.allowLineDiscount) setLineDiscountTarget(item.id)
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: CART_GRID,
                    padding: '8px 12px',
                    alignItems: 'start',
                    cursor: cancelMode || posSettings.allowLineDiscount ? 'pointer' : 'default',
                    background: rowBg,
                    borderRadius: 11,
                    marginBottom: 5,
                    border: '1px solid #e8eaef',
                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.035)',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLDivElement
                    if (cancelMode) el.style.background = '#ffecf0'
                    else el.style.background = '#f2f4f7'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.background = rowBg
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    {cancelMode ? (
                      <div style={{
                        width: 20, height: 20, borderRadius: 6,
                        background: '#FFEBEE', border: '1.5px solid #EF9A9A',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, fontWeight: 700, color: '#C62828', marginTop: 2,
                      }}>İ</div>
                    ) : (
                      <div style={{
                        width: 20, height: 20, borderRadius: 6,
                        background: '#E8F5E9', border: '1.5px solid #A5D6A7',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, fontWeight: 700, color: '#2E7D32', marginTop: 2,
                      }}>S</div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      display: 'flex', gap: 3, marginBottom: 4, overflow: 'hidden', flexWrap: 'nowrap',
                    }}>
                      {pills}
                    </div>
                    <div style={{
                      fontSize: cartSettings.fsUrunAdi, fontWeight: 500,
                      color: cancelMode ? '#dc2626' : '#111',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      lineHeight: 1.3,
                    }}>{item.name}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 2 }}>
                    {!cancelMode && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); updateQty(item.id, -1) }}
                        style={{
                          width: 18, height: 18, border: '1px solid #e5e7eb',
                          background: '#ffffff', borderRadius: 6, cursor: 'pointer',
                          fontSize: 11, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: '#374151',
                        }}
                      >−</button>
                    )}
                    <span style={{
                      fontSize: cartSettings.fsMiktar, fontWeight: 600,
                      color: cancelMode ? '#dc2626' : '#374151',
                      minWidth: 16, textAlign: 'center',
                    }}>{item.quantity}</span>
                    {!cancelMode && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); updateQty(item.id, 1) }}
                        style={{
                          width: 18, height: 18, border: '1px solid #e5e7eb',
                          background: '#ffffff', borderRadius: 6, cursor: 'pointer',
                          fontSize: 11, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: '#374151',
                        }}
                      >+</button>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: cartSettings.fsTutar, fontWeight: 600,
                      color: cancelMode ? '#dc2626' : '#111',
                    }}>{fmt(item.netTotal)}</div>
                    <div style={{
                      fontSize: cartSettings.fsTutarSub, color: '#9ca3af', marginTop: 1,
                    }}>{fmt(item.price)}×{item.quantity}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Özet + toplam */}
          <div style={{
            margin: '4px 10px 10px',
            borderRadius: 12,
            border: '1px solid #e8eaef',
            background: '#fafbfc',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
            overflow: 'hidden',
            flexShrink: 0,
          }}>
            <div style={{ padding: '8px 14px 0' }}>
              {(posSettings.allowDocDiscount ?? true) && (
                <>
                  <button
                    type="button"
                    onClick={() => setDocDiscountMode(m => !m)}
                    style={{
                      fontSize: 11, color: '#E65100', background: 'none', border: 'none',
                      cursor: 'pointer', padding: '2px 0', display: 'block', marginBottom: 4,
                      textDecoration: docDiscountMode ? 'none' : 'underline',
                    }}
                  >
                    {docDiscountMode ? 'İndirimi Kapat' : '+ Belge İndirimi'}
                  </button>
                  {docDiscountMode && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                      <input
                        type="number"
                        min={0}
                        max={posSettings.maxDocDiscountPct ?? 100}
                        placeholder="% indirim"
                        value={docDiscountRate || ''}
                        onChange={e => { setDocDiscountRate(parseFloat(e.target.value) || 0); setDocDiscountAmt(0) }}
                        style={{ flex: 1, border: '1px solid #FFB74D', borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none', minWidth: 0 }}
                      />
                      <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>veya</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="₺ indirim"
                        value={docDiscountAmt || ''}
                        onChange={e => { setDocDiscountAmt(parseFloat(e.target.value) || 0); setDocDiscountRate(0) }}
                        style={{ flex: 1, border: '1px solid #FFB74D', borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none', minWidth: 0 }}
                      />
                    </div>
                  )}
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', padding: '2px 0' }}>
                <span>Ara Toplam</span>
                <span>{fmt(araToplamBrut)}</span>
              </div>
              {satirIndirimi > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#AD1457', padding: '2px 0' }}>
                  <span>Satır İndirimi</span>
                  <span>-{fmt(satirIndirimi)}</span>
                </div>
              )}
              {belgeIndirimi > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#AD1457', padding: '2px 0' }}>
                  <span>Belge İndirimi</span>
                  <span>-{fmt(belgeIndirimi)}</span>
                </div>
              )}
              {satirIndirimi > 0 && belgeIndirimi > 0 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: 12, color: '#880E4F', padding: '2px 0',
                  borderTop: '1px dashed #F8BBD0', marginTop: 2,
                }}>
                  <span>Toplam İndirim</span>
                  <span>-{fmt(toplamIndirim)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', padding: '2px 0' }}>
                <span>KDV</span>
                <span>{fmt(toplamKdv)}</span>
              </div>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '10px 14px 12px',
              borderTop: '1px solid #eceef2',
              marginTop: 2,
              background: '#ffffff',
              borderRadius: '0 0 11px 11px',
            }}>
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
                { label: '👤+ Müşteri Ekle',    action: () => { setNewCustPrefill(''); setAddCustomerModal(true); closeMenu() }, danger: false, disabled: false },
                { label: '⏸ Belgeyi Beklet',    action: holdDoc,                                     danger: false, disabled: cart.length === 0 },
                { label: `▶ Belge Getir${heldDocs.length ? ` (${heldDocs.length})` : ''}`,
                  action: () => { setShowHeld(true); closeMenu() },  danger: false, disabled: false },
                { label: cancelMode ? '✕ Modu Kapat' : '✕ İptal Modu',
                  action: () => { if (!cancelMode && cart.length === 0) return; setCancelMode(m => !m); closeMenu() },
                  danger: true,  disabled: false, active: cancelMode },
              ].map((item, i) => (
                <div key={i}
                  onClick={item.disabled ? undefined : item.action}
                  style={{ padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 8, cursor: item.disabled ? 'default' : 'pointer', fontSize: 11, fontWeight: 'active' in item && item.active ? 600 : 500, borderBottom: i < 4 ? '1px solid #f5f5f5' : 'none', color: 'active' in item && item.active ? '#dc2626' : item.danger ? '#dc2626' : '#374151', background: 'active' in item && item.active ? '#fff5f5' : 'white', opacity: item.disabled ? 0.4 : 1, transition: 'background 0.1s' }}
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
            <span style={{ fontSize: 12, color: '#6b7280', marginTop: 4, display: 'block', fontWeight: 500 }}>
              {numBuf.includes(',') ? 'miktar' : 'adet'} seçili
            </span>
          </div>

          {/* Numpad — büyük dokunma alanı (yaşlı kullanıcı dostu, min ~52px) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, flexShrink: 0, width: '100%' }}>
            {[
              { key: '7' }, { key: '8' }, { key: '9' },
              { key: '4' }, { key: '5' }, { key: '6' },
              { key: '1' }, { key: '2' }, { key: '3' },
              { key: ',' }, { key: '0' }, { key: '⌫' },
              { key: 'C', span: 3 },
            ].map(({ key, span }) => (
              <button
                key={key}
                type="button"
                onMouseDown={e => {
                  e.preventDefault()
                  handleNumKey(key)
                }}
                style={{
                  width: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  minHeight: 52,
                  height: 'clamp(52px, 5.5vw, 84px)',
                  border: '2px solid',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  userSelect: 'none' as const,
                  background: key === 'C' ? '#fff5f5' : key === '⌫' ? '#fffbeb' : 'white',
                  color:      key === 'C' ? '#dc2626' : key === '⌫' ? '#d97706' : '#1f2937',
                  borderColor: key === 'C' ? '#fecdd3' : key === '⌫' ? '#fde68a' : '#d1d5db',
                  gridColumn: span ? `span ${span}` : undefined,
                  fontSize: key === 'C' ? 'clamp(14px, 1vw + 8px, 20px)' : 'clamp(22px, 1.7vw + 12px, 36px)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >{key === 'C' ? 'Tümünü Sil' : key}</button>
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
                <div key={`search-${p.id}-${p.code}`} onClick={() => handlePluClick(p)}
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
                  <div key={`${p.id}-${i}`} onClick={() => handlePluClick(p)}
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

      <div style={{
        position: 'fixed', top: 16, right: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320,
        pointerEvents: 'none',
      }}>
        {queueToasts.map(t => (
          <div
            key={`${t.id}-${t.shownAt}`}
            style={{
              pointerEvents: 'auto',
              background: t.status === 'success' ? '#E8F5E9' : '#FFEBEE',
              border: `1px solid ${t.status === 'success' ? '#A5D6A7' : '#FFCDD2'}`,
              borderRadius: 10, padding: '10px 14px',
              fontSize: 13, fontWeight: 500,
              color: t.status === 'success' ? '#2E7D32' : '#C62828',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            <div>{t.status === 'success' ? '✓' : '✗'} {t.label ?? t.type}</div>
            {t.error && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{t.error}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

const CITY_OPTIONS = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin',
  'Aydın', 'Balıkesir', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale',
  'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan',
  'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Isparta',
  'İstanbul', 'İzmir', 'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri',
  'Kilis', 'Kırıkkale', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya',
  'Manisa', 'Mardin', 'Mersin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye',
  'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Şanlıurfa', 'Şırnak', 'Tekirdağ',
  'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak',
]

interface AddCustomerFormProps {
  prefillTaxNo?: string
  onClose: () => void
  onSuccess: (customer: {
    name: string
    phone?: string
    taxNo?: string
    taxOffice?: string
    email?: string
    address?: string
    city?: string
    district?: string
    postalCode?: string
    isPerson?: boolean
  }) => Promise<void>
}

/** firmType: 1 (Müşteri & Tedarikçi), code API'ye gönderilmez */
function AddCustomerForm({ prefillTaxNo, onClose, onSuccess }: AddCustomerFormProps) {
  const [isPerson, setIsPerson] = useState(true)
  const [name, setName] = useState('')
  const [taxNo, setTaxNo] = useState(prefillTaxNo ?? '')
  const [taxOffice, setTaxOffice] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [citySearch, setCitySearch] = useState('')
  const [showCityDD, setShowCityDD] = useState(false)
  const [district, setDistrict] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setTaxNo(prefillTaxNo ?? '')
  }, [prefillTaxNo])

  const filteredCities = CITY_OPTIONS.filter(c =>
    c.toLowerCase().includes(citySearch.toLowerCase()),
  )

  async function handleSave() {
    if (!name.trim()) {
      setError('Ad Soyad / Firma Adı zorunludur.')
      return
    }
    if (!taxNo.trim()) {
      setError('TC / VKN zorunludur.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSuccess({
        name: name.trim(),
        phone: phone.trim(),
        taxNo: taxNo.trim(),
        taxOffice: taxOffice.trim(),
        email: email.trim(),
        address: address.trim(),
        city,
        district: district.trim(),
        postalCode: postalCode.trim(),
        isPerson,
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const s: CSSProperties = {
    width: '100%',
    border: '1px solid #E0E0E0',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  }

  const lbl = (txt: string, req?: boolean) => (
    <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>
      {txt}{req && <span style={{ color: '#EF4444' }}> *</span>}
    </label>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      <div style={{ marginBottom: 14 }}>
        {lbl('Kişi Tipi')}
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ v: true, l: 'Bireysel' }, { v: false, l: 'Kurumsal' }].map(({ v, l }) => (
            <button
              key={l}
              type="button"
              onClick={() => setIsPerson(v)}
              style={{
                flex: 1, padding: '8px', borderRadius: 8, border: '1px solid',
                background: isPerson === v ? '#EFF6FF' : 'white',
                borderColor: isPerson === v ? '#3B82F6' : '#E0E0E0',
                color: isPerson === v ? '#1D4ED8' : '#6B7280',
                fontWeight: isPerson === v ? 600 : 400, fontSize: 13, cursor: 'pointer',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px' }}>

        <div style={{ gridColumn: 'span 2' }}>
          {lbl(isPerson ? 'Ad Soyad' : 'Firma Adı', true)}
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={s}
            placeholder={isPerson ? 'Ahmet Yılmaz' : 'ACME Ltd. Şti.'}
          />
        </div>

        <div>
          {lbl(isPerson ? 'TC Kimlik No' : 'VKN', true)}
          <input
            value={taxNo}
            onChange={e => setTaxNo(e.target.value)}
            style={s}
            placeholder={isPerson ? '11111111111' : '1234567890'}
          />
        </div>

        <div>
          {lbl('Vergi Dairesi')}
          <input value={taxOffice} onChange={e => setTaxOffice(e.target.value)} style={s} placeholder="Bolu" />
        </div>

        <div>
          {lbl('Telefon')}
          <input value={phone} onChange={e => setPhone(e.target.value)} style={s} placeholder="0555 000 0000" />
        </div>

        <div>
          {lbl('E-posta')}
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={s} placeholder="ornek@mail.com" />
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          {lbl('Adres')}
          <input
            value={address}
            onChange={e => setAddress(e.target.value)}
            style={s}
            placeholder="Sokak, No, Mahalle"
          />
        </div>

        <div style={{ position: 'relative' }}>
          {lbl('Şehir')}
          <input
            value={city || citySearch}
            onChange={e => {
              setCitySearch(e.target.value)
              setCity('')
              setShowCityDD(true)
            }}
            onFocus={() => setShowCityDD(true)}
            onBlur={() => setTimeout(() => setShowCityDD(false), 150)}
            style={s}
            placeholder="Bolu"
          />
          {showCityDD && filteredCities.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 9999,
              background: 'white',
              border: '1px solid #E0E0E0',
              borderRadius: 8,
              maxHeight: 160,
              overflowY: 'auto',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
            >
              {filteredCities.map(c => (
                <div
                  key={c}
                  onMouseDown={() => {
                    setCity(c)
                    setCitySearch(c)
                    setShowCityDD(false)
                  }}
                  style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F0F4FF' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'white' }}
                >
                  {c}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          {lbl('İlçe')}
          <input value={district} onChange={e => setDistrict(e.target.value)} style={s} placeholder="Merkez" />
        </div>

        <div>
          {lbl('Posta Kodu')}
          <input value={postalCode} onChange={e => setPostalCode(e.target.value)} style={s} placeholder="14100" />
        </div>

      </div>

      {error && (
        <div style={{
          background: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          color: '#B91C1C',
          marginTop: 12,
        }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            flex: 1,
            padding: '11px',
            borderRadius: 8,
            border: '1px solid #E0E0E0',
            background: 'white',
            cursor: 'pointer',
            fontSize: 13,
            color: '#6B7280',
          }}
        >
          İptal
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            flex: 2,
            padding: '11px',
            borderRadius: 8,
            border: 'none',
            background: saving ? '#93C5FD' : '#1565C0',
            color: 'white',
            cursor: saving ? 'wait' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {saving ? 'Kaydediliyor...' : 'Cari Ekle'}
        </button>
      </div>
    </div>
  )
}

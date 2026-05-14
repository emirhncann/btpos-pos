import { useState, useEffect, useRef, useCallback, type ReactNode, type CSSProperties } from 'react'
import { useLicenseCheck } from '../hooks/useLicenseCheck'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import { sendInvoiceForSale, enqueueCustomer } from '../lib/invoiceSend'
import { pavoCompleteSale, type PavoSettings } from '../lib/pavoService'
import type { PaymentDeviceResult } from '../lib/paymentDevice'
import { useQueueWorker, type QueueToastPayload } from '../hooks/useQueueWorker'
import { API_URL } from '../lib/api'
import AppLogo from '../components/AppLogo'
import LicenseBanner from '../components/LicenseBanner'
import ConnectionDot from '../components/ConnectionDot'

const CART_GRID = '84px 1fr 72px 82px'

/** SMS cep: 10 hane, 5 ile başlar; gösterim 555 555 55 55 */
const SMS_MOBILE_LEN = 10

function normalizeTrMobileForSms(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('90')) d = d.slice(2)
  while (d.startsWith('0')) d = d.slice(1)
  d = d.slice(0, SMS_MOBILE_LEN)
  if (d.length > 0 && d[0] !== '5') return ''
  return d
}

function formatTrMobileSmsDisplay(digits: string): string {
  const x = digits.replace(/\D/g, '').slice(0, SMS_MOBILE_LEN)
  if (!x) return '—'
  let out = x.slice(0, 3)
  if (x.length > 3) out += ' ' + x.slice(3, 6)
  if (x.length > 6) out += ' ' + x.slice(6, 8)
  if (x.length > 8) out += ' ' + x.slice(8, 10)
  return out
}

function isValidNotifyEmail(s: string): boolean {
  const t = s.trim()
  if (t.length < 5 || !t.includes('@')) return false
  const [a, b] = t.split('@')
  return Boolean(a && b && b.includes('.'))
}

function appendTrMobileSmsDigit(prev: string, k: string): string {
  const d = prev.replace(/\D/g, '').slice(0, SMS_MOBILE_LEN)
  if (d.length >= SMS_MOBILE_LEN) return d
  if (d.length === 0) return k === '5' ? '5' : ''
  return d + k
}

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

interface CardPaymentInfo {
  acquirerId: string
  amount: number
  acquirerName?: string
}

type PaymentMethodKey = 'cash' | 'card' | 'meal_card'

interface PaymentLine {
  id: string
  method: PaymentMethodKey
  amount: number
  label: string
  mediator: number
  acquirerId?: string | null
  acquirerName?: string | null
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

function localISOString(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  const local = new Date(now.getTime() - offset)
  return local.toISOString().replace('Z', '').slice(0, 26)
}

function PopupItem({ icon, label, disabled, danger, last, onClick }: {
  icon: string
  label: string
  disabled?: boolean
  danger?: boolean
  last?: boolean
  onClick?: () => void
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        padding: '13px 20px', cursor: disabled ? 'default' : 'pointer',
        fontSize: 13, fontWeight: 400,
        borderBottom: last ? 'none' : '0.5px solid #F3F4F6',
        color: danger ? '#DC2626' : disabled ? '#D1D5DB' : '#374151',
        display: 'flex', alignItems: 'center', gap: 10,
        opacity: disabled ? 0.5 : 1, userSelect: 'none',
      }}
      onMouseEnter={e => {
        if (!disabled)
          (e.currentTarget as HTMLDivElement).style.background = danger ? '#FFF5F5' : '#F9FAFB'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.background = 'white'
      }}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  )
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
  const [paymentLines, setPaymentLines]   = useState<PaymentLine[]>([])
  const [activeMethod, setActiveMethod]   = useState<PaymentMethodKey | null>(null)
  const [pendingAmount, setPendingAmount] = useState('')
  const [saving, setSaving]               = useState(false)
  const [lastReceipt, setLastReceipt]     = useState<string | null>(null)
  const [cancelMode, setCancelMode]       = useState(false)
  const [cancelWarning, setCancelWarning] = useState<string | null>(null)
  const [docDiscountMode, setDocDiscountMode] = useState(false)
  const [discMode, setDiscMode] = useState<'rate' | 'amt'>('rate')
  const [docDiscMode, setDocDiscMode] = useState<'rate' | 'amt'>('rate')
  const [docDiscInput, setDocDiscInput] = useState('')
  const [docDiscountRate, setDocDiscountRate] = useState(0)
  const [docDiscountAmt, setDocDiscountAmt]   = useState(0)
  const [lineDiscountTarget, setLineDiscountTarget] = useState<string | null>(null)
  const [lineDiscRateIn, setLineDiscRateIn]   = useState('')
  const [lineDiscAmtIn, setLineDiscAmtIn]     = useState('')
  const [menuOpen, setMenuOpen] = useState<'islemler' | 'belge' | 'musteri' | 'fiyatgor' | null>(null)
  const [fiyatGorQ, setFiyatGorQ] = useState('')
  const [fiyatGorItem, setFiyatGorItem] = useState<ProductRow | null>(null)
  const [cariPaymentModal, setCariPaymentModal] = useState<'tahsilat' | 'odeme' | null>(null)
  const [cariPaymentAmt, setCariPaymentAmt] = useState('')
  const [cariPaymentDesc, setCariPaymentDesc] = useState('')
  const [cariPaymentSaving, setCariPaymentSaving] = useState(false)
  const [cariPaymentResult, setCariPaymentResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [heldDocs, setHeldDocs]           = useState<HeldDocRow[]>([])
  const [showHeld, setShowHeld]           = useState(false)
  const [showCustomer, setShowCustomer]   = useState(false)
  const [customers, setCustomers]         = useState<CustomerRow[]>([])
  const [customerQ, setCustomerQ]         = useState('')
  const [addCustomerModal, setAddCustomerModal] = useState(false)
  const [newCustPrefill, setNewCustPrefill] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const [sendSms, setSendSms] = useState(false)
  const [sendEmail, setSendEmail] = useState(false)
  const [smsPhone, setSmsPhone] = useState('')
  const [mailAddr, setMailAddr] = useState('')
  const [smsModalOpen, setSmsModalOpen] = useState(false)
  const [mailModalOpen, setMailModalOpen] = useState(false)
  const [smsPhonePanelOpen, setSmsPhonePanelOpen] = useState(false)
  const [smsPhoneDraft, setSmsPhoneDraft] = useState('')
  const [invoiceType, setInvoiceType] = useState<'e_archive' | 'paper'>('e_archive')
  const [pavoSettings, setPavoSettings] = useState<PavoSettings | null>(null)
  const [pavoLoading, setPavoLoading] = useState(false)
  const [pavoError, setPavoError] = useState<string | null>(null)
  const [errorPopup, setErrorPopup] = useState<{ title: string; message: string } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const cartListRef = useRef<HTMLDivElement>(null)
  const prevCartLenRef = useRef(0)

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

  const applyCustomerSelection = useCallback((c: CustomerRow | null) => {
    setSelectedCustomer(c)
    if (!c) {
      setSendSms(false)
      setSendEmail(false)
      setSmsPhone('')
      setMailAddr('')
      setSmsModalOpen(false)
      setMailModalOpen(false)
      setSmsPhonePanelOpen(false)
      setSmsPhoneDraft('')
      setMenuOpen(null)
      setCariPaymentModal(null)
      setCariPaymentAmt('')
      setCariPaymentDesc('')
      setCariPaymentResult(null)
      setCariPaymentSaving(false)
      return
    }
    if (c.phone?.trim()) {
      setSmsPhone(c.phone.trim())
      setSendSms(true)
    } else {
      setSmsPhone('')
      setSendSms(false)
    }
    if (c.email?.trim()) {
      setMailAddr(c.email.trim())
      setSendEmail(true)
    } else {
      setMailAddr('')
      setSendEmail(false)
    }
    setMenuOpen(null)
  }, [])

  /** Cari seç + SMS/mail doldur; cari arama panelini kapat (sprint selectCustomer) */
  const selectCustomer = useCallback((c: CustomerRow) => {
    applyCustomerSelection(c)
    setShowCustomer(false)
  }, [applyCustomerSelection])

  useEffect(() => {
    if (!showCustomer || !companyId) return
    window.electron.db.getCustomers(companyId, customerQ)
      .then(setCustomers)
      .catch(() => setCustomers([]))
  }, [customerQ, showCustomer, companyId])

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
    void (async () => {
      try {
        const settings = await window.electron.db.getPosSettings()
        setInvoiceType(settings?.invoiceType === 'paper' ? 'paper' : 'e_archive')

        const device = await window.electron.db.getPaymentDeviceSettings('pavo')
        if (device?.ipAddress && device.isActive) {
          setPavoSettings({
            ipAddress:       device.ipAddress,
            port:            device.port,
            serialNo:        device.serialNo ?? '',
            cardReadTimeout: device.cardReadTimeout,
            printWidth:      device.printWidth,
          })
        } else {
          setPavoSettings(null)
        }
      } catch {
        setInvoiceType('e_archive')
        setPavoSettings(null)
      }
    })()
  }, [])

  useEffect(() => {
    if (!pavoSettings) return
    void (async () => {
      try {
        const seq = await window.electron.db.nextPavoSequence()
        const result = await fetch(`http://${pavoSettings.ipAddress}:${pavoSettings.port}/PaymentMediators`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            TransactionHandle: {
              SerialNumber: pavoSettings.serialNo,
              TransactionDate: localISOString(),
              TransactionSequence: seq,
              Fingerprint: 'test1',
            },
          }),
        }).then(r => r.json()) as Record<string, unknown>

        const handle = result.TransactionHandle as Record<string, unknown> | undefined
        const pavoSeq = Number(handle?.TransactionSequence)
        if (Number.isFinite(pavoSeq)) {
          await window.electron.db.updatePavoSequence(pavoSeq)
        }
      } catch {
        // Cihaz offline olabilir; normal akış bozulmamalı.
      }
    })()
  }, [pavoSettings])

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

  function showErrorPopup(title: string, message: string) {
    setErrorPopup({ title, message })
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

  useEffect(() => {
    if (cart.length > prevCartLenRef.current) {
      const el = cartListRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
    prevCartLenRef.current = cart.length
  }, [cart.length])

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
    const rate = discMode === 'rate' ? parseFloat(lineDiscRateIn.replace(',', '.')) || 0 : 0
    const amt = discMode === 'amt' ? parseFloat(lineDiscAmtIn.replace(',', '.')) || 0 : 0
    const maxPct = posSettings.maxLineDiscountPct ?? 100
    if (rate > maxPct) {
      showErrorPopup('İndirim Limiti', `Maksimum satır indirimi %${maxPct}`)
      return
    }
    if (amt > 0) {
      const target = cart.find(c => c.id === lineDiscountTarget)
      if (target && target.lineTotal > 0) {
        const effectivePct = (amt / target.lineTotal) * 100
        if (effectivePct > maxPct) {
          showErrorPopup('İndirim Limiti', `Bu tutar %${effectivePct.toFixed(1)} indirime karşılık geliyor. Maksimum %${maxPct}`)
          return
        }
      }
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
    setPaymentLines([])
    setActiveMethod(null)
    setPendingAmount('')
    setNumBuf('')
    setCancelMode(false)
    setDocDiscountMode(false)
    setDocDiscMode('rate')
    setDocDiscInput('')
    setDocDiscountRate(0)
    setDocDiscountAmt(0)
    setLineDiscountTarget(null)
    applyCustomerSelection(null)
    setMenuOpen(null)
  }

  function handleNumKey(k: string) {
    if (paymentMode && activeMethod !== null) {
      if (k === 'C')  { setPendingAmount(''); return }
      if (k === '⌫') { setPendingAmount(p => p.slice(0, -1)); return }
      if (k === ',') {
        if (pendingAmount.includes(',')) return
        setPendingAmount(p => (p === '' ? '0,' : p + ','))
        return
      }
      if (pendingAmount.replace(',', '').length < 8) {
        setPendingAmount(p => p + k)
      }
      return
    }

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

  function addPaymentLine(method: PaymentMethodKey) {
    const amt = parseFloat(pendingAmount.replace(',', '.')) || 0

    if (method === 'cash') {
      const cashAmt = amt > 0 ? amt : remaining
      setPaymentLines(prev => [...prev, {
        id: crypto.randomUUID(),
        method: 'cash',
        amount: parseFloat(cashAmt.toFixed(2)),
        label: 'Nakit',
        mediator: 1,
      }])
    } else if (method === 'card') {
      const cardAmt = amt > 0 ? Math.min(amt, remaining) : remaining
      if (cardAmt <= 0) return
      setPaymentLines(prev => [...prev, {
        id: crypto.randomUUID(),
        method: 'card',
        amount: parseFloat(cardAmt.toFixed(2)),
        label: 'Kart',
        mediator: 2,
      }])
    }

    setPendingAmount('')
    setActiveMethod(null)
  }

  function removePaymentLine(id: string) {
    setPaymentLines(prev => prev.filter(l => l.id !== id))
  }

  /* ── Menü işlemleri ── */

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
  }

  async function retrieveDoc(doc: HeldDocRow) {
    setCart(doc.items.map(normalizeHeldCartItem))
    await window.electron.db.deleteHeldDocument(doc.id)
    loadHeld()
    setShowHeld(false)
  }

  async function loadCustomers() {
    setShowCustomer(true)
    setMenuOpen(null)
    try {
      const list = await window.electron.db.getCustomers(companyId)
      setCustomers(list)
    } catch {
      setCustomers([])
    }
  }

  async function handleCariPayment() {
    if (!selectedCustomer || !cariPaymentModal || !companyId) return
    const amount = parseFloat(cariPaymentAmt.replace(',', '.'))
    if (!amount || amount <= 0) return

    setCariPaymentSaving(true)
    setCariPaymentResult(null)

    const terminalName = posSettings.source?.trim() || 'Kasa'
    const customerIdNum = Number.parseInt(selectedCustomer.id, 10) || 0

    try {
      const res = await fetch(`${API_URL}/integration/cari-payment/${companyId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          process_type:  cariPaymentModal === 'tahsilat' ? 1 : 2,
          amount,
          customer_id:   customerIdNum,
          customer_code: selectedCustomer.code ?? '',
          customer_name: selectedCustomer.name ?? '',
          cashier_name:  cashier.fullName,
          terminal_name: terminalName,
          description:   cariPaymentDesc.trim(),
          payment_date:  new Date().toISOString().replace('T', ' ').slice(0, 19),
        }),
      })
      const data = await res.json() as { success?: boolean; message?: string; label?: string }

      if (res.ok && data.success) {
        setCariPaymentResult({
          ok:  true,
          msg: `${data.label ?? (cariPaymentModal === 'tahsilat' ? 'Tahsilat' : 'Ödeme')} başarıyla kaydedildi. Tutar: ${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`,
        })
        setCariPaymentAmt('')
        setCariPaymentDesc('')
      } else {
        setCariPaymentResult({
          ok: false,
          msg: data.message ?? (res.ok ? 'İşlem başarısız.' : `HTTP ${res.status}`),
        })
      }
    } catch (e) {
      setCariPaymentResult({ ok: false, msg: String(e) })
    } finally {
      setCariPaymentSaving(false)
    }
  }

  /* ── Ödeme — ara toplam, satır/belge indirimi, KDV, genel toplam ── */
  const araToplamBrut = cart.reduce((s, c) => s + c.price * c.quantity, 0)
  const totalQty = cart.reduce((s, c) => s + c.quantity, 0)
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
  const paidTotal = paymentLines.reduce((s, l) => s + l.amount, 0)
  const remaining = Math.max(0, parseFloat((grandTotal - paidTotal).toFixed(2)))
  const canComplete = remaining === 0 && paymentLines.length > 0
  const commandIconAnimation = commandSyncing
    ? 'merkezMailPulse 0.9s ease-in-out infinite, merkezMailShake 1.4s ease-in-out infinite'
    : commandDeferred
      ? 'merkezMailWaitPulse 1s ease-in-out infinite, merkezMailShake 2s ease-in-out infinite'
      : commandRecentlyReceived
      ? 'merkezMailPulse 1.2s ease-in-out infinite'
      : 'merkezMailIdle 2.6s ease-in-out infinite'

  useEffect(() => {
    const discounts: SecondScreenDiscount[] = []
    for (const item of cart) {
      const brut = item.price * item.quantity
      const satirIskonto = Math.max(0, parseFloat((brut - item.netTotal).toFixed(2)))
      if (satirIskonto > 0) {
        discounts.push({
          label: item.name,
          amount: satirIskonto,
          scope: 'line',
        })
      }
    }

    if (docDiscountCalc > 0) {
      discounts.push({
        label: 'Belge indirimi',
        amount: docDiscountCalc,
        scope: 'document',
      })
    }

    const payload: SecondScreenPayload = {
      mode: 'cart_and_btpos_gif',
      items: cart.map(item => ({
        name: item.name,
        qty: item.quantity,
        lineTotal: item.netTotal,
      })),
      discounts,
      totals: {
        subtotal: lineSubtotal,
        discountTotal: toplamIndirim,
        grandTotal,
        totalQty,
      },
      branding: {
        btposGif: 'logo.gif',
      },
      updatedAt: new Date().toISOString(),
    }

    void window.electron.secondScreen.update(payload).catch(() => {})
  }, [cart, docDiscountCalc, grandTotal, lineSubtotal, toplamIndirim, totalQty])

  async function completeSale(forcedLines?: PaymentLine[]) {
    const lines = forcedLines ?? paymentLines
    if (!cart.length || lines.length === 0) return
    setSaving(true)
    setPavoError(null)
    let deviceResult: PaymentDeviceResult | undefined
    console.log('[completeSale] paymentLines:', JSON.stringify(lines))
    console.log('[completeSale] canComplete:', canComplete)

    try {
    const paidAmt = lines.reduce((s, l) => s + l.amount, 0)
    const cashAmt = lines
      .filter(l => l.method === 'cash')
      .reduce((s, l) => s + l.amount, 0)
    const cardAmt = lines
      .filter(l => l.method !== 'cash')
      .reduce((s, l) => s + l.amount, 0)
    const nonCashTotal = lines
      .filter(l => l.method !== 'cash')
      .reduce((s, l) => s + l.amount, 0)
    let cashRemaining = Math.max(0, grandTotal - nonCashTotal)
    const pavoPaymentsFinal = lines.map(l => {
      if (l.method === 'cash') {
        const cashPart = Math.min(l.amount, cashRemaining)
        cashRemaining = Math.max(0, cashRemaining - cashPart)
        return { Mediator: l.mediator, Amount: cashPart, CurrencyCode: 'TRY', ExchangeRate: 1 }
      }
      return { Mediator: l.mediator, Amount: l.amount, CurrencyCode: 'TRY', ExchangeRate: 1 }
    }).filter(p => p.Amount > 0)

    if (pavoSettings) {
      if (cardAmt > 0) setPavoLoading(true)

      try {
        const seq = await window.electron.db.nextPavoSequence()
        const orderNo = nextReceiptNo().padStart(17, '0')
        const round2 = (n: number) => parseFloat(n.toFixed(2))
        const salePriceEffect = docDiscountCalc > 0
          ? {
            Type: 2,
            Rate: docDiscountRate > 0 ? round2(docDiscountRate) : 0,
            Amount: docDiscountRate > 0 ? 0 : round2(docDiscountCalc),
          }
          : undefined
        const pavoItems = cart.map(c => {
          const brut = round2(c.price * c.quantity)
          const hasLineDiscount = c.discountRate > 0 || c.discountAmount > 0
          return {
            name: c.name,
            unitName: c.unit ?? 'Adet',
            vatRate: c.vatRate,
            quantity: c.quantity,
            unitPrice: c.price,
            grossPrice: brut,
            totalPrice: round2(c.netTotal),
            priceEffect: hasLineDiscount
              ? {
                  Type: 1,
                  Rate: c.discountRate > 0 ? round2(c.discountRate) : 0,
                  Amount: c.discountRate > 0 ? null : round2(c.discountAmount),
                }
              : undefined,
          }
        })

        const smsNorm =
          normalizeTrMobileForSms(smsPhone)
          || normalizeTrMobileForSms(selectedCustomer?.phone ?? '')
        if (sendSms && smsNorm.length !== SMS_MOBILE_LEN) {
          const msg = smsNorm.length === 0
            ? 'SMS için 5 ile başlayan 10 haneli cep numarası girin veya cari seçin.'
            : 'Cep numarası 5 ile başlamalı ve 10 hane olmalı (ör. 555 555 55 55).'
          showErrorPopup('SMS Bildirimi', msg)
          return
        }

        if (sendEmail && !isValidNotifyEmail(mailAddr)) {
          showErrorPopup('E-posta bildirimi', 'Geçerli bir e-posta girin veya Mail bildirimini kapatın.')
          return
        }

        deviceResult = await pavoCompleteSale(
          pavoSettings,
          seq,
          orderNo,
          round2(araToplamBrut),
          grandTotal,
          pavoItems,
          pavoPaymentsFinal,
          salePriceEffect,
          selectedCustomer,
          {
            sendSms: sendSms && smsNorm.length === SMS_MOBILE_LEN,
            smsPhone: smsNorm || '',
            sendEmail: sendEmail && isValidNotifyEmail(mailAddr),
            mailAddr: mailAddr.trim(),
          },
        )

        if (!deviceResult.success) {
          showErrorPopup('Ödeme Hatası', deviceResult.message ?? 'Pavo hatası')
          return
        }
      } catch (e) {
        showErrorPopup('Pavo Bağlantı Hatası', String(e))
        return
      } finally {
        setPavoLoading(false)
      }
    }

      const receiptNo = nextReceiptNo()
      type RawPayment = {
        StatusId?: unknown
        PaymentMediatorId?: unknown
        PaymentAmount?: unknown
        OnlinePayment?: { AcquirerId?: unknown; AcquirerName?: unknown }
        CashPayment?: { GivenAmount?: unknown }
      }
      const rawData = (deviceResult?.raw?.Data as { AddedPayments?: unknown[] } | undefined)
      const addedPayments = Array.isArray(rawData?.AddedPayments) ? rawData.AddedPayments : []
      const successPayments = addedPayments
        .map(p => p as RawPayment)
        .filter(p => Number(p.StatusId) === 2)
      const cashPayments = successPayments.filter(p => Number(p.PaymentMediatorId) === 1)
      const actualCashAmt = cashPayments.reduce((s, p) => s + Number(p.PaymentAmount ?? 0), 0)
      const cardPaymentsRaw = successPayments.filter(p => Number(p.PaymentMediatorId) === 2)

      const cardByBank: Record<string, { amount: number; acquirerName: string }> = {}
      for (const p of cardPaymentsRaw) {
        const acquirerId = String(p.OnlinePayment?.AcquirerId ?? 'unknown')
        const acquirerName = String(p.OnlinePayment?.AcquirerName ?? '')
        const amount = Number(p.PaymentAmount ?? 0)
        if (!cardByBank[acquirerId]) {
          cardByBank[acquirerId] = { amount: 0, acquirerName }
        }
        cardByBank[acquirerId].amount += amount
      }
      const cardPaymentInfos: CardPaymentInfo[] = Object.entries(cardByBank).map(([acquirerId, info]) => ({
        acquirerId,
        amount: info.amount,
        acquirerName: info.acquirerName,
      }))
      const firstCard = cardPaymentsRaw[0]
      const cardAcquirerId = firstCard?.OnlinePayment?.AcquirerId != null
        ? String(firstCard.OnlinePayment.AcquirerId)
        : null
      console.log('[completeSale] cardAcquirerId:', cardAcquirerId)
      console.log('[completeSale] addedPayments:', addedPayments)
      console.log('[completeSale] cardByBank:', cardByBank)
      console.log('[completeSale] cardPaymentInfos:', cardPaymentInfos)
      console.log('[completeSale] actualCashAmt:', actualCashAmt)

      const salePaymentType: 'cash' | 'card' | 'mixed' =
        cashAmt > 0 && cardAmt > 0 ? 'mixed' : cashAmt > 0 ? 'cash' : 'card'
      const saleRow = {
        receiptNo,
        totalAmount: lineSubtotal,
        discountRate: docDiscountRate,
        discountAmount: docDiscountCalc,
        netAmount: grandTotal,
        paymentType: salePaymentType,
        cashAmount: cashAmt,
        cardAmount: cardAmt,
        cardAcquirerId,
        cashierId: cashier.id,
        cashierName: cashier.fullName,
        customerId:   selectedCustomer?.id   ?? null,
        customerName: selectedCustomer?.name ?? null,
        customerCode: selectedCustomer?.code ?? null,
      }
      const saleId = await window.electron.db.saveSale(saleRow, cart.map(c => ({
        productId: c.id,
        productCode: c.code,
        productName: c.name,
        quantity: c.quantity,
        unitPrice: c.price,
        vatRate: c.vatRate,
        discountRate: c.discountRate,
        discountAmount: c.discountAmount,
        lineTotal: c.netTotal,
        appliedBy: cashier.id,
      })), deviceResult)

      const cardBankKeys = Object.keys(cardByBank)
      let cardIdx = 0
      const paymentRows: SalePaymentRow[] = lines.map(line => {
        if (line.method === 'card') {
          const bankKey = cardBankKeys[cardIdx] ?? null
          const bankInfo = bankKey ? cardByBank[bankKey] : null
          cardIdx += 1
          return {
            id: crypto.randomUUID(),
            saleId,
            method: line.method,
            amount: line.amount,
            mediator: line.mediator,
            acquirerId: bankKey,
            acquirerName: bankInfo?.acquirerName ?? null,
            cashierId: cashier.id,
            cashierName: cashier.fullName,
          }
        }
        return {
          id: crypto.randomUUID(),
          saleId,
          method: line.method,
          amount: line.amount,
          mediator: line.mediator,
          acquirerId: null,
          acquirerName: null,
          cashierId: cashier.id,
          cashierName: cashier.fullName,
        }
      })
      await window.electron.db.saveSalePayments(paymentRows)

      if (selectedCustomer && saleId && companyId) {
        void sendInvoiceForSale(companyId, saleId, selectedCustomer, invoiceType, {
          cashAmount: cashAmt,
          cardAmount: cardAmt,
          cardAcquirerId,
          cardByBank,
        })
      }
      setLastReceipt(receiptNo)
      setPaymentMode(false)
      setPaymentLines([])
      setActiveMethod(null)
      setPendingAmount('')
      clearCart()
      searchRef.current?.focus()
    } catch (e) {
      showErrorPopup('Satış Kaydedilemedi', e instanceof Error ? e.message : 'Bilinmeyen hata')
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
              <button type="button" onClick={() => applyCustomerSelection(null)} style={{ background: 'none', border: 'none', color: cancelMode ? '#fecaca' : '#93c5fd', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
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
      {lineDiscountTarget && (() => {
        const targetItem = cart.find(c => c.id === lineDiscountTarget)
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div style={{ background: 'white', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%', maxWidth: 420 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Satır İndirimi</div>
                  <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{targetItem?.name}</div>
                </div>
                <button onClick={() => { setLineDiscountTarget(null); setLineDiscRateIn(''); setLineDiscAmtIn('') }}
                  style={{ background: 'none', border: 'none', fontSize: 20, color: '#9CA3AF', cursor: 'pointer' }}>✕</button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[{ key: 'rate', label: 'Yüzde (%)' }, { key: 'amt', label: 'Tutar (₺)' }].map(m => (
                  <button key={m.key} type="button"
                    onClick={() => { setDiscMode(m.key as 'rate' | 'amt'); setLineDiscRateIn(''); setLineDiscAmtIn('') }}
                    style={{ flex: 1, padding: '8px', borderRadius: 8, border: '2px solid', borderColor: discMode === m.key ? '#E65100' : '#E0E0E0', background: discMode === m.key ? '#FFF3E0' : 'white', color: discMode === m.key ? '#E65100' : '#6B7280', fontWeight: discMode === m.key ? 700 : 400, fontSize: 13, cursor: 'pointer' }}>
                    {m.label}
                  </button>
                ))}
              </div>

              <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 32, fontWeight: 700, color: '#E65100', letterSpacing: 2, minHeight: 56 }}>
                {discMode === 'rate' ? `${lineDiscRateIn || '0'} %` : `${lineDiscAmtIn || '0'} ₺`}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(k => (
                  <button key={k} type="button"
                    onClick={() => {
                      const setter = discMode === 'rate' ? setLineDiscRateIn : setLineDiscAmtIn
                      const val = discMode === 'rate' ? lineDiscRateIn : lineDiscAmtIn
                      if (k === '⌫') { setter(val.slice(0, -1)); return }
                      if (k === ',') {
                        if (val.includes(',')) return
                        setter(val === '' ? '0,' : val + ',')
                        return
                      }
                      if (val.replace(',', '').length < 6) setter(val + k)
                    }}
                    style={{ padding: '14px 0', borderRadius: 10, border: '1px solid #E5E7EB', background: k === '⌫' ? '#FEF2F2' : '#F9FAFB', fontSize: 18, fontWeight: 600, color: k === '⌫' ? '#EF4444' : '#111827', cursor: 'pointer' }}>
                    {k}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 8 }}>
                <button type="button"
                  onClick={() => { setLineDiscRateIn(''); setLineDiscAmtIn('') }}
                  style={{ padding: '14px', borderRadius: 10, border: '1px solid #E0E0E0', background: '#F5F5F5', fontSize: 15, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                  C
                </button>
                <button type="button"
                  onClick={() => { applyLineDiscount(); setDiscMode('rate') }}
                  style={{ padding: '14px', borderRadius: 10, border: 'none', background: '#E65100', fontSize: 15, fontWeight: 700, color: 'white', cursor: 'pointer' }}>
                  Uygula
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {docDiscountMode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Belge İndirimi</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>Toplam belgeye uygulanır</div>
              </div>
              <button
                onClick={() => {
                  setDocDiscountMode(false)
                  setDocDiscInput('')
                  setDocDiscMode('rate')
                }}
                style={{ background: 'none', border: 'none', fontSize: 20, color: '#9CA3AF', cursor: 'pointer' }}
              >✕</button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {[{ key: 'rate', label: 'Yüzde (%)' }, { key: 'amt', label: 'Tutar (₺)' }].map(m => (
                <button key={m.key} type="button"
                  onClick={() => {
                    setDocDiscMode(m.key as 'rate' | 'amt')
                    setDocDiscInput('')
                    setDocDiscountRate(0)
                    setDocDiscountAmt(0)
                  }}
                  style={{ flex: 1, padding: '8px', borderRadius: 8, border: '2px solid', borderColor: docDiscMode === m.key ? '#E65100' : '#E0E0E0', background: docDiscMode === m.key ? '#FFF3E0' : 'white', color: docDiscMode === m.key ? '#E65100' : '#6B7280', fontWeight: docDiscMode === m.key ? 700 : 400, fontSize: 13, cursor: 'pointer' }}>
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 32, fontWeight: 700, color: '#E65100', letterSpacing: 2, minHeight: 56 }}>
              {docDiscMode === 'rate' ? `${docDiscInput || '0'} %` : `${docDiscInput || '0'} ₺`}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(k => (
                <button key={k} type="button"
                  onClick={() => {
                    if (k === '⌫') { setDocDiscInput(v => v.slice(0, -1)); return }
                    if (k === ',') {
                      setDocDiscInput(v => {
                        if (v.includes(',')) return v
                        return v === '' ? '0,' : v + ','
                      })
                      return
                    }
                    setDocDiscInput(v => (v.replace(',', '').length < 6 ? v + k : v))
                  }}
                  style={{ padding: '14px 0', borderRadius: 10, border: '1px solid #E5E7EB', background: k === '⌫' ? '#FEF2F2' : '#F9FAFB', fontSize: 18, fontWeight: 600, color: k === '⌫' ? '#EF4444' : '#111827', cursor: 'pointer' }}>
                  {k}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 8 }}>
              <button type="button"
                onClick={() => { setDocDiscInput(''); setDocDiscountRate(0); setDocDiscountAmt(0) }}
                style={{ padding: '14px', borderRadius: 10, border: '1px solid #E0E0E0', background: '#F5F5F5', fontSize: 15, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                C
              </button>
              <button type="button"
                onClick={() => {
                  const val = parseFloat(docDiscInput.replace(',', '.')) || 0
                  if (docDiscMode === 'rate') {
                    const maxPct = posSettings.maxDocDiscountPct ?? 100
                    if (val > maxPct) {
                      showErrorPopup('İndirim Limiti', `Maksimum belge indirimi %${maxPct}`)
                      return
                    }
                    setDocDiscountRate(val)
                    setDocDiscountAmt(0)
                  } else {
                    const maxPct = posSettings.maxDocDiscountPct ?? 100
                    if (lineSubtotal > 0) {
                      const effectivePct = (val / lineSubtotal) * 100
                      if (effectivePct > maxPct) {
                        showErrorPopup('İndirim Limiti', `Bu tutar %${effectivePct.toFixed(1)} indirime karşılık geliyor. Maksimum belge indirimi %${maxPct}`)
                        return
                      }
                    }
                    setDocDiscountAmt(val)
                    setDocDiscountRate(0)
                  }
                  setDocDiscountMode(false)
                }}
                style={{ padding: '14px', borderRadius: 10, border: 'none', background: '#E65100', fontSize: 15, fontWeight: 700, color: 'white', cursor: 'pointer' }}>
                Uygula
              </button>
            </div>
          </div>
        </div>
      )}

      {smsPhonePanelOpen && pavoSettings && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>SMS bildirimi</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>5 ile başlayan 10 hane — 555 555 55 55</div>
              </div>
              <button
                type="button"
                onClick={() => setSmsPhonePanelOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20, color: '#9CA3AF', cursor: 'pointer' }}
              >✕</button>
            </div>

            <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 26, fontWeight: 700, color: '#1565C0', letterSpacing: 0.5, minHeight: 52, wordBreak: 'break-all' }}>
              {formatTrMobileSmsDisplay(smsPhoneDraft)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(k => {
                const firstEmpty = smsPhoneDraft.replace(/\D/g, '').length === 0
                const disabledFirst = firstEmpty && k !== '5'
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={disabledFirst}
                    onClick={() => {
                      if (disabledFirst) return
                      setSmsPhoneDraft(prev => appendTrMobileSmsDigit(prev, k))
                    }}
                    style={{
                      padding: '14px 0',
                      borderRadius: 10,
                      border: '1px solid #E5E7EB',
                      background: '#F9FAFB',
                      fontSize: 18,
                      fontWeight: 600,
                      color: '#111827',
                      cursor: disabledFirst ? 'default' : 'pointer',
                      opacity: disabledFirst ? 0.38 : 1,
                    }}
                  >{k}</button>
                )
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setSmsPhoneDraft('')}
                style={{ padding: '14px 0', borderRadius: 10, border: '1px solid #E5E7EB', background: '#F5F5F5', fontSize: 15, fontWeight: 600, color: '#374151', cursor: 'pointer' }}
              >C</button>
              <button
                type="button"
                disabled={smsPhoneDraft.replace(/\D/g, '').length === 0}
                onClick={() => {
                  setSmsPhoneDraft(prev => appendTrMobileSmsDigit(prev, '0'))
                }}
                style={{
                  padding: '14px 0',
                  borderRadius: 10,
                  border: '1px solid #E5E7EB',
                  background: '#F9FAFB',
                  fontSize: 18,
                  fontWeight: 600,
                  color: '#111827',
                  cursor: smsPhoneDraft.replace(/\D/g, '').length === 0 ? 'default' : 'pointer',
                  opacity: smsPhoneDraft.replace(/\D/g, '').length === 0 ? 0.38 : 1,
                }}
              >0</button>
              <button
                type="button"
                onClick={() => setSmsPhoneDraft(prev => prev.replace(/\D/g, '').slice(0, -1))}
                style={{ padding: '14px 0', borderRadius: 10, border: '1px solid #E5E7EB', background: '#FEF2F2', fontSize: 18, fontWeight: 600, color: '#EF4444', cursor: 'pointer' }}
              >⌫</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setSendSms(false)
                  setSmsPhone('')
                  setSmsPhoneDraft('')
                  setSmsPhonePanelOpen(false)
                }}
                style={{ padding: '14px', borderRadius: 10, border: '1px solid #E0E0E0', background: '#F5F5F5', fontSize: 15, fontWeight: 600, color: '#374151', cursor: 'pointer' }}
              >
                SMS Kapat
              </button>
              <button
                type="button"
                onClick={() => {
                  const digits = normalizeTrMobileForSms(smsPhoneDraft)
                  if (digits.length !== SMS_MOBILE_LEN) {
                    showErrorPopup('SMS Bildirimi', '5 ile başlayan 10 haneli numarayı tamamlayın veya SMS Kapat kullanın.')
                    return
                  }
                  setSmsPhone(digits)
                  setSendSms(true)
                  setSmsPhonePanelOpen(false)
                }}
                style={{ padding: '14px', borderRadius: 10, border: 'none', background: '#1565C0', fontSize: 15, fontWeight: 700, color: 'white', cursor: 'pointer' }}
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

      {smsModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)', display: 'flex',
          alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setSmsModalOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: 20,
              width: 'min(320px, 90vw)',
              display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Başlık */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>SMS Numarası</div>
                {selectedCustomer && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{selectedCustomer.name}</div>
                )}
              </div>
              <button type="button" onClick={() => setSmsModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20,
                  cursor: 'pointer', color: '#9CA3AF', padding: 0, lineHeight: 1 }}>✕</button>
            </div>

            {/* Gösterge */}
            <div style={{ textAlign: 'center', padding: '14px 0',
              fontSize: 26, fontWeight: 600, color: '#E65100', letterSpacing: 2,
              minHeight: 56, borderTop: '1px solid #F3F4F6',
              borderBottom: '1px solid #F3F4F6' }}>
              {smsPhone || '—'}
            </div>

            {/* Numpad */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'clamp(6px,1.5vw,12px)' }}>
              {['7','8','9','4','5','6','1','2','3','+','0','⌫'].map(k => (
                <button key={k} type="button"
                  onMouseDown={e => {
                    e.preventDefault()
                    if (k === '⌫') setSmsPhone(p => p.slice(0,-1))
                    else setSmsPhone(p => p + k)
                  }}
                  style={{
                    padding: 'clamp(12px,2.5vw,18px) 0',
                    fontSize: k === '⌫' ? 'clamp(16px,2vw,22px)' : 'clamp(18px,2.5vw,26px)',
                    fontWeight: 500, borderRadius: 10,
                    border: '1px solid #E5E7EB', background: 'white', cursor: 'pointer',
                    color: k === '⌫' ? '#EF4444' : '#111',
                  }}>
                  {k}
                </button>
              ))}
            </div>

            {/* C + Uygula */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'clamp(6px,1.5vw,12px)' }}>
              <button type="button" onMouseDown={e => { e.preventDefault(); setSmsPhone('') }}
                style={{ padding: 'clamp(12px,2vw,16px) 0', fontSize: 'clamp(13px,1.6vw,16px)',
                  fontWeight: 500, borderRadius: 10, border: '1px solid #E5E7EB',
                  background: '#F9FAFB', cursor: 'pointer', color: '#374151' }}>
                C
              </button>
              <button type="button" onClick={() => { setSendSms(true); setSmsModalOpen(false) }}
                style={{ padding: 'clamp(12px,2vw,16px) 0', fontSize: 'clamp(13px,1.6vw,16px)',
                  fontWeight: 600, borderRadius: 10, border: 'none',
                  background: '#E65100', color: 'white', cursor: 'pointer' }}>
                Uygula
              </button>
            </div>
          </div>
        </div>
      )}

      {mailModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)', display: 'flex',
          alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setMailModalOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, padding: 20,
              width: 'min(480px, 94vw)',
              display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Başlık */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>E-Posta Adresi</div>
                {selectedCustomer && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{selectedCustomer.name}</div>
                )}
              </div>
              <button type="button" onClick={() => setMailModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20,
                  cursor: 'pointer', color: '#9CA3AF', padding: 0, lineHeight: 1 }}>✕</button>
            </div>

            {/* Gösterge */}
            <div style={{ textAlign: 'center', padding: '12px 0',
              fontSize: 18, fontWeight: 600, color: '#E65100', letterSpacing: 1,
              minHeight: 48, borderTop: '1px solid #F3F4F6',
              borderBottom: '1px solid #F3F4F6', wordBreak: 'break-all' }}>
              {mailAddr || '—'}
            </div>

            {/* Sayı satırı */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10,1fr)', gap: 'clamp(3px,1%,8px)' }}>
              {['1','2','3','4','5','6','7','8','9','0'].map(k => (
                <button key={k} type="button"
                  onMouseDown={e => { e.preventDefault(); setMailAddr(p => p + k) }}
                  style={{ padding: 'clamp(8px,2vw,14px) 0',
                    fontSize: 'clamp(13px,1.6vw,18px)', fontWeight: 500,
                    borderRadius: 8, border: '1px solid #E5E7EB',
                    background: '#F9FAFB', cursor: 'pointer', color: '#111' }}>
                  {k}
                </button>
              ))}
            </div>

            {/* QWERTY satır 1–3 */}
            {[
              ['q','w','e','r','t','y','u','i','o','p'],
              ['a','s','d','f','g','h','j','k','l'],
              ['z','x','c','v','b','n','m'],
            ].map((row, ri) => (
              <div key={ri} style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${row.length},1fr)`,
                gap: 'clamp(3px,1%,8px)',
                padding: ri === 1 ? '0 5%' : ri === 2 ? '0 10%' : '0',
              }}>
                {row.map(k => (
                  <button key={k} type="button"
                    onMouseDown={e => { e.preventDefault(); setMailAddr(p => p + k) }}
                    style={{ padding: 'clamp(10px,2.5vw,18px) 0',
                      fontSize: 'clamp(14px,1.8vw,20px)', fontWeight: 500,
                      borderRadius: 8, border: '1px solid #E5E7EB',
                      background: 'white', cursor: 'pointer', color: '#111' }}>
                    {k}
                  </button>
                ))}
              </div>
            ))}

            {/* Alt satır: @ . _ Temizle ⌫ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr 1fr', gap: 'clamp(3px,1%,8px)' }}>
              {[
                { k: '@',       style: { border: '1.5px solid #E65100', background: '#FFF3E0', color: '#E65100', fontWeight: 600 } },
                { k: '.' },
                { k: '_' },
                { k: 'C', label: 'Temizle', style: { background: '#F9FAFB' } },
                { k: '⌫',       style: { color: '#EF4444', background: '#F9FAFB' } },
              ].map(({ k, label, style: s }) => (
                <button key={k} type="button"
                  onMouseDown={e => {
                    e.preventDefault()
                    if (k === 'C') setMailAddr('')
                    else if (k === '⌫') setMailAddr(p => p.slice(0,-1))
                    else setMailAddr(p => p + k)
                  }}
                  style={Object.assign(
                    {
                      padding: 'clamp(10px,2.5vw,18px) 0',
                      fontSize: 'clamp(13px,1.6vw,18px)', fontWeight: 500,
                      borderRadius: 8, border: '1px solid #E5E7EB',
                      background: 'white', cursor: 'pointer', color: '#111',
                    },
                    s ?? {},
                  )}>
                  {label ?? k}
                </button>
              ))}
            </div>

            {/* Uygula */}
            <button type="button" onClick={() => { setSendEmail(true); setMailModalOpen(false) }}
              style={{ width: '100%', padding: 'clamp(12px,2vw,18px) 0',
                fontSize: 'clamp(14px,1.6vw,18px)', fontWeight: 600,
                borderRadius: 10, border: 'none',
                background: '#E65100', color: 'white', cursor: 'pointer' }}>
              Uygula
            </button>
          </div>
        </div>
      )}

      {errorPopup && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 420, background: 'white', borderRadius: 16, border: '1px solid #374151', boxShadow: '0 14px 32px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
            <div style={{ background: '#111827', borderBottom: '1px solid #374151', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  height: 28,
                  minWidth: 54,
                  borderRadius: 8,
                  padding: '0 8px',
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <AppLogo height={20} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#FCA5A5' }}>{errorPopup.title}</span>
              </div>
              <button onClick={() => setErrorPopup(null)} style={{ background: 'none', border: 'none', fontSize: 18, color: '#FCA5A5', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '14px 16px 6px', fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
              {errorPopup.message}
            </div>
            <div style={{ padding: '10px 16px 16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setErrorPopup(null)}
                style={{ padding: '10px 16px', borderRadius: 9, border: 'none', background: '#B91C1C', color: 'white', fontWeight: 700, cursor: 'pointer' }}
              >
                Tamam
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
                    onClick={() => { selectCustomer(c); setCustomerQ('') }}
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
                  email:      customer.email ?? '',
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
                selectCustomer({
                  id:         newId,
                  companyId,
                  code:       '',
                  name:       customer.name,
                  phone:      customer.phone ?? '',
                  email:      customer.email ?? '',
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

          <div ref={cartListRef} style={{
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
              if (posSettings.showCode && item.code?.trim()) pills.push(
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
                  {dr > 0 ? `-%${dr} indirim` : `-${fmt(da)} indirim`}
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
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: CART_GRID,
                    padding: '8px 12px',
                    alignItems: 'start',
                    cursor: cancelMode ? 'pointer' : 'default',
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
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <div style={{
                        minWidth: 14,
                        color: '#6b7280',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                      }}>
                        {rowIdx + 1}
                      </div>
                    {cancelMode ? (
                      <div style={{
                        width: 24, height: 24, borderRadius: 7,
                        background: '#FFEBEE', border: '1.5px solid #EF9A9A',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700, color: '#C62828',
                      }}>İ</div>
                    ) : posSettings.allowLineDiscount ? (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setSmsPhonePanelOpen(false)
                          setMenuOpen(null)
                          setLineDiscountTarget(item.id)
                        }}
                        style={{
                          minWidth: 38,
                          height: 34,
                          borderRadius: 8,
                          border: '1px solid #FFE0B2',
                          background: '#FFF8E1',
                          color: '#E65100',
                          padding: '3px 5px',
                          display: 'inline-flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          lineHeight: 1,
                        }}
                        title="Satır indirimi"
                      >
                        <span style={{ fontSize: 13, lineHeight: 1 }}>🏷️</span>
                        <span style={{ fontSize: 9, fontWeight: 700, marginTop: 2 }}>indirim</span>
                      </button>
                    ) : null}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: cartSettings.fsUrunAdi, fontWeight: 600,
                      color: cancelMode ? '#dc2626' : '#111',
                      whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip',
                      wordBreak: 'break-word',
                      lineHeight: 1.3, marginBottom: 3,
                    }}>{item.name}</div>
                    <div style={{
                      display: 'flex', gap: 3, flexWrap: 'wrap',
                    }}>
                      {pills}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 2 }}>
                    {!cancelMode && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); updateQty(item.id, -1) }}
                        style={{
                          width: 28, height: 28, border: '1px solid #e5e7eb',
                          background: '#ffffff', borderRadius: 7, cursor: 'pointer',
                          fontSize: 16, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: '#374151', fontWeight: 600,
                        }}
                      >−</button>
                    )}
                    <span style={{
                      fontSize: cartSettings.fsMiktar, fontWeight: 700,
                      color: cancelMode ? '#dc2626' : '#374151',
                      minWidth: 24, textAlign: 'center',
                    }}>{item.quantity}</span>
                    {!cancelMode && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); updateQty(item.id, 1) }}
                        style={{
                          width: 28, height: 28, border: '1px solid #e5e7eb',
                          background: '#ffffff', borderRadius: 7, cursor: 'pointer',
                          fontSize: 16, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: '#374151', fontWeight: 600,
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
                    onClick={() => {
                      if (docDiscountMode) {
                        setDocDiscountMode(false)
                        return
                      }
                      setSmsPhonePanelOpen(false)
                      setMenuOpen(null)
                      const openMode: 'rate' | 'amt' = docDiscountAmt > 0 ? 'amt' : 'rate'
                      setDocDiscMode(openMode)
                      setDocDiscInput(
                        openMode === 'rate'
                          ? (docDiscountRate > 0 ? String(docDiscountRate) : '')
                          : (docDiscountAmt > 0 ? String(docDiscountAmt) : ''),
                      )
                      setDocDiscountMode(true)
                    }}
                    style={{
                      fontSize: 11, color: '#E65100', background: 'none', border: 'none',
                      cursor: 'pointer', padding: '2px 0', display: 'block', marginBottom: 4,
                      textDecoration: docDiscountMode ? 'none' : 'underline',
                    }}
                  >
                    {docDiscountMode ? 'İndirimi Kapat' : '+ Belge İndirimi'}
                  </button>
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
                <span>KDV Tutarı</span>
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

        {/* ② NUMPAD KOLON — %22 */}
        <div style={{
          width: '22%',
          flexShrink: 0,
          boxSizing: 'border-box',
          background: '#f8f9fa',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.5%',
          gap: '1.5%',
          borderRight: '1px solid #e0e0e0',
          overflow: 'visible',
          position: 'relative',
        }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, flexShrink: 0 }}>

            {/* SMS */}
            <div style={{ borderRadius: 8, border: '1.5px solid',
              borderColor: sendSms ? '#2E7D32' : '#E5E7EB',
              background: sendSms ? '#E8F5E9' : '#FAFAFA',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, padding: '6% 4%', overflow: 'hidden' }}>
              <button type="button" onClick={() => setSendSms(p => !p)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 28, height: 16, borderRadius: 8,
                  background: sendSms ? '#2E7D32' : '#D1D5DB',
                  position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 2,
                    left: sendSms ? 14 : 2, width: 12, height: 12,
                    borderRadius: '50%', background: 'white' }} />
                </div>
                <span style={{ fontSize: 'clamp(12px, 1.2vw, 18px)' }}>📱</span>
              </button>
              <button type="button" onClick={() => setSmsModalOpen(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0, width: '100%', textAlign: 'center' as const }}>
                <span style={{ fontSize: 'clamp(8px, 0.7vw, 11px)', fontWeight: 600,
                  color: sendSms ? '#2E7D32' : '#9CA3AF',
                  whiteSpace: 'nowrap', overflow: 'hidden',
                  textOverflow: 'ellipsis', display: 'block' }}>
                  {smsPhone || 'SMS'}
                </span>
              </button>
            </div>

            {/* Mail */}
            <div style={{ borderRadius: 8, border: '1.5px solid',
              borderColor: sendEmail ? '#1565C0' : '#E5E7EB',
              background: sendEmail ? '#EFF6FF' : '#FAFAFA',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, padding: '6% 4%', overflow: 'hidden' }}>
              <button type="button" onClick={() => setSendEmail(p => !p)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 28, height: 16, borderRadius: 8,
                  background: sendEmail ? '#1565C0' : '#D1D5DB',
                  position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 2,
                    left: sendEmail ? 14 : 2, width: 12, height: 12,
                    borderRadius: '50%', background: 'white' }} />
                </div>
                <span style={{ fontSize: 'clamp(12px, 1.2vw, 18px)' }}>✉️</span>
              </button>
              <button type="button" onClick={() => setMailModalOpen(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0, width: '100%', textAlign: 'center' as const }}>
                <span style={{ fontSize: 'clamp(8px, 0.7vw, 11px)', fontWeight: 600,
                  color: sendEmail ? '#1565C0' : '#9CA3AF',
                  whiteSpace: 'nowrap', overflow: 'hidden',
                  textOverflow: 'ellipsis', display: 'block' }}>
                  {mailAddr || 'Mail'}
                </span>
              </button>
            </div>

          </div>

          {/* ── SATIR 2+3: 4 buton 2×2 + popup menüler (v2) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr', gap: '4%', flexShrink: 0 }}>

            {/* 1 — Menü: mavi tonu */}
            <button type="button"
              onClick={() => setMenuOpen(m => m === 'islemler' ? null : 'islemler')}
              style={{ padding: '8% 2%', borderRadius: 8,
                border: `1.5px solid ${menuOpen === 'islemler' ? '#1565C0' : '#BBDEFB'}`,
                background: menuOpen === 'islemler' ? '#E3F2FD' : '#F3F8FE',
                color: '#1565C0', fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>☰</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)' }}>Menü</span>
            </button>

            {/* 2 — Belge: mor tonu */}
            <button type="button"
              onClick={() => setMenuOpen(m => m === 'belge' ? null : 'belge')}
              style={{ padding: '8% 2%', borderRadius: 8,
                border: `1.5px solid ${menuOpen === 'belge' ? '#7C3AED' : '#DDD6FE'}`,
                background: menuOpen === 'belge' ? '#EDE9FE' : '#F5F3FF',
                color: '#7C3AED', fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>📄</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)' }}>Belge</span>
            </button>

            {/* 3 — Müşteri: yeşil tonu */}
            <button type="button"
              onClick={() => setMenuOpen(m => m === 'musteri' ? null : 'musteri')}
              style={{ padding: '8% 2%', borderRadius: 8,
                border: `1.5px solid ${menuOpen === 'musteri' || selectedCustomer ? '#2E7D32' : '#C8E6C9'}`,
                background: menuOpen === 'musteri' ? '#E8F5E9' : selectedCustomer ? '#F1F8F1' : '#F4FBF4',
                color: '#2E7D32', fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>👤</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)',
                whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis', width: '100%', textAlign: 'center' as const }}>
                {selectedCustomer ? selectedCustomer.name.split(' ')[0] : 'Müşteri'}
              </span>
            </button>

            {/* 4 — Fiyat Gör: amber tonu */}
            <button type="button"
              onClick={() => { setMenuOpen('fiyatgor'); setFiyatGorQ(''); setFiyatGorItem(null) }}
              style={{ padding: '8% 2%', borderRadius: 8,
                border: `1.5px solid ${menuOpen === 'fiyatgor' ? '#D97706' : '#FDE68A'}`,
                background: menuOpen === 'fiyatgor' ? '#FEF3C7' : '#FFFBEB',
                color: '#D97706', fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>🔍</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)' }}>Fiyat Gör</span>
            </button>

          </div>

          {menuOpen && menuOpen !== 'fiyatgor' && (
            <>
              <div
                role="presentation"
                style={{ position: 'fixed', inset: 0, zIndex: 9990 }}
                onClick={() => setMenuOpen(null)}
              />
              <div style={{
                position: 'absolute', top: 0, left: '102%', zIndex: 9991,
                background: 'white', border: '0.5px solid #E5E7EB',
                borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                minWidth: 240, overflow: 'hidden',
              }}>

                <div style={{ padding: '12px 20px 8px', fontSize: 11, fontWeight: 600,
                  color: '#9CA3AF', textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                  borderBottom: '0.5px solid #F3F4F6' }}>
                  {{ islemler: 'İşlemler', belge: 'Belge işlemleri', musteri: 'Müşteri işlemleri' }[menuOpen]}
                </div>

                {menuOpen === 'islemler' && [
                  { icon: '💰', label: 'Cari tahsilat', disabled: !selectedCustomer },
                  { icon: '💸', label: 'Cari ödeme', disabled: !selectedCustomer },
                  { icon: '⏸', label: 'Beklemeye al', disabled: cart.length === 0 },
                  { icon: '📂', label: `Belge getir${heldDocs.length ? ` (${heldDocs.length})` : ''}`, disabled: false },
                  { icon: '%', label: 'Belge indirim', disabled: cart.length === 0 },
                  { icon: '🚫', label: 'Belge iptal', disabled: cart.length === 0, danger: true },
                  { icon: '✕', label: cancelMode ? 'Ürün iptal (kapat)' : 'Ürün iptal', disabled: cart.length === 0 },
                ].map((item, i, arr) => (
                  <PopupItem key={i} icon={item.icon} label={item.label} disabled={item.disabled} danger={item.danger} last={i === arr.length - 1}
                    onClick={() => {
                      if (item.disabled) return
                      if (item.label.startsWith('Cari tah')) {
                        setCariPaymentModal('tahsilat')
                        setCariPaymentAmt('')
                        setCariPaymentDesc('')
                        setCariPaymentResult(null)
                        setMenuOpen(null)
                        return
                      }
                      if (item.label.startsWith('Cari öd')) {
                        setCariPaymentModal('odeme')
                        setCariPaymentAmt('')
                        setCariPaymentDesc('')
                        setCariPaymentResult(null)
                        setMenuOpen(null)
                        return
                      }
                      if (item.label.startsWith('Beklemeye')) { void holdDoc(); return }
                      if (item.label.startsWith('Belge getir')) { setShowHeld(true); setMenuOpen(null); return }
                      if (item.label.startsWith('Belge ind')) {
                        setSmsPhonePanelOpen(false)
                        setMenuOpen(null)
                        const openMode: 'rate' | 'amt' = docDiscountAmt > 0 ? 'amt' : 'rate'
                        setDocDiscMode(openMode)
                        setDocDiscInput(
                          openMode === 'rate'
                            ? (docDiscountRate > 0 ? String(docDiscountRate) : '')
                            : (docDiscountAmt > 0 ? String(docDiscountAmt) : ''),
                        )
                        setDocDiscountMode(true)
                        return
                      }
                      if (item.label.startsWith('Belge iptal')) { clearCart(); return }
                      if (item.label.startsWith('Ürün iptal')) {
                        setCancelMode(m => !m)
                        setMenuOpen(null)
                      }
                    }} />
                ))}

                {menuOpen === 'belge' && [
                  { icon: '↩️', label: 'İade al', disabled: false },
                ].map((item, i, arr) => (
                  <PopupItem key={i} icon={item.icon} label={item.label} disabled={item.disabled} last={i === arr.length - 1} onClick={() => setMenuOpen(null)} />
                ))}

                {menuOpen === 'musteri' && [
                  { icon: '🔍', label: 'Müşteri seç', disabled: false },
                  { icon: '👤+', label: 'Müşteri ekle', disabled: false },
                  { icon: '✏️', label: 'Müşteri düzenle', disabled: !selectedCustomer },
                  {
                    icon: '❌',
                    label: selectedCustomer
                      ? `${selectedCustomer.name.split(' ')[0]} — çıkar`
                      : 'Müşteri çıkar',
                    disabled: !selectedCustomer,
                    danger: true,
                  },
                ].map((item, i, arr) => (
                  <PopupItem key={i} icon={item.icon} label={item.label} disabled={item.disabled} danger={item.danger} last={i === arr.length - 1}
                    onClick={() => {
                      if (item.disabled) return
                      if (item.label === 'Müşteri seç') { void loadCustomers(); setMenuOpen(null); return }
                      if (item.label === 'Müşteri ekle') { setNewCustPrefill(''); setAddCustomerModal(true); setMenuOpen(null); return }
                      if (item.label === 'Müşteri düzenle') { setMenuOpen(null); return }
                      if (item.label.endsWith('— çıkar') || item.label === 'Müşteri çıkar') {
                        applyCustomerSelection(null)
                        setMenuOpen(null)
                      }
                    }} />
                ))}

              </div>
            </>
          )}

          {menuOpen === 'fiyatgor' && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.4)', display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setMenuOpen(null)}>
              <div onClick={e => e.stopPropagation()}
                style={{ background: 'white', borderRadius: 16, padding: 24,
                  width: 'min(520px, 94vw)', display: 'flex', flexDirection: 'column', gap: 16 }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 500, color: '#111',
                    display: 'flex', alignItems: 'center', gap: 8 }}>
                    🔍 Fiyat Gör
                  </div>
                  <button type="button" onClick={() => setMenuOpen(null)}
                    style={{ background: 'none', border: 'none', fontSize: 20,
                      cursor: 'pointer', color: '#9CA3AF', padding: 0 }}>✕</button>
                </div>

                <input
                  autoFocus
                  value={fiyatGorQ}
                  onChange={e => {
                    const v = e.target.value
                    setFiyatGorQ(v)
                    setFiyatGorItem(null)
                    const found = allProducts.find(p =>
                      p.barcode === v || p.code === v
                    )
                    if (found) setFiyatGorItem(found)
                  }}
                  placeholder="Barkod okut veya ürün adı gir..."
                  style={{ fontSize: 15, padding: '12px 14px', borderRadius: 10,
                    border: '1.5px solid #E5E7EB', outline: 'none',
                    width: '100%', boxSizing: 'border-box' as const }}
                />

                {!fiyatGorItem && fiyatGorQ.length > 1 && (
                  <div style={{ maxHeight: 240, overflowY: 'auto',
                    border: '0.5px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
                    {allProducts
                      .filter(p =>
                        (p.name?.toLowerCase().includes(fiyatGorQ.toLowerCase()) ?? false) ||
                        (p.code?.toLowerCase().includes(fiyatGorQ.toLowerCase()) ?? false)
                      )
                      .slice(0, 20)
                      .map((p, i, arr) => (
                        <div key={p.id} role="presentation" onClick={() => setFiyatGorItem(p)}
                          style={{ padding: '12px 16px', cursor: 'pointer',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            borderBottom: i < arr.length - 1 ? '0.5px solid #F3F4F6' : 'none' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F9FAFB' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'white' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', marginTop: 2 }}>{p.code}</div>
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 600, color: '#1565C0' }}>
                            {p.price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {fiyatGorItem && (
                  <div style={{ padding: 16, borderRadius: 12, background: '#F0F9FF',
                    border: '1.5px solid #BAE6FD',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: '#111' }}>{fiyatGorItem.name}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2, fontFamily: 'monospace' }}>{fiyatGorItem.code ?? ''}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>KDV %{fiyatGorItem.vatRate}</div>
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 600, color: '#1565C0' }}>
                      {fiyatGorItem.price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button type="button" onClick={() => setMenuOpen(null)}
                    style={{ padding: '14px 0', fontSize: 14, borderRadius: 10,
                      border: '1px solid #E5E7EB', background: 'white',
                      cursor: 'pointer', color: '#374151' }}>
                    Kapat
                  </button>
                  <button type="button"
                    disabled={!fiyatGorItem}
                    onClick={() => {
                      if (fiyatGorItem) {
                        addToCartWithQty(fiyatGorItem, 1)
                        setMenuOpen(null)
                      }
                    }}
                    style={{ padding: '14px 0', fontSize: 14, fontWeight: 600,
                      borderRadius: 10, border: 'none',
                      background: fiyatGorItem ? '#1565C0' : '#E5E7EB',
                      color: fiyatGorItem ? 'white' : '#9CA3AF',
                      cursor: fiyatGorItem ? 'pointer' : 'default' }}>
                    Fişe Ekle
                  </button>
                </div>
              </div>
            </div>
          )}

          {cariPaymentModal && selectedCustomer && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 10000,
              background: 'rgba(0,0,0,0.45)', display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}
              onClick={() => { if (!cariPaymentSaving) setCariPaymentModal(null) }}>
              <div onClick={e => e.stopPropagation()}
                style={{ background: 'white', borderRadius: 16, padding: 24,
                  width: 'min(380px, 94vw)', display: 'flex', flexDirection: 'column', gap: 16 }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#111' }}>
                      {cariPaymentModal === 'tahsilat' ? '💰 Cari Tahsilat' : '💸 Cari Ödeme'}
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3 }}>
                      {selectedCustomer.name}
                    </div>
                  </div>
                  <button type="button" onClick={() => setCariPaymentModal(null)} disabled={cariPaymentSaving}
                    style={{ background: 'none', border: 'none', fontSize: 20,
                      cursor: cariPaymentSaving ? 'default' : 'pointer', color: '#9CA3AF', padding: 0 }}>✕</button>
                </div>

                <div style={{ textAlign: 'center', padding: '14px 0',
                  fontSize: 30, fontWeight: 600, letterSpacing: 2,
                  color: cariPaymentModal === 'tahsilat' ? '#2E7D32' : '#C62828',
                  borderTop: '1px solid #F3F4F6', borderBottom: '1px solid #F3F4F6' }}>
                  {cariPaymentAmt || '—'} ₺
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
                  gap: 'clamp(6px,1.5vw,10px)' }}>
                  {['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(k => (
                    <button key={k} type="button"
                      onMouseDown={e => {
                        e.preventDefault()
                        if (k === '⌫') setCariPaymentAmt(p => p.slice(0, -1))
                        else if (k === ',') { if (!cariPaymentAmt.includes(',')) setCariPaymentAmt(p => p + ',') }
                        else setCariPaymentAmt(p => p + k)
                      }}
                      style={{ padding: 'clamp(12px,2vw,16px) 0',
                        fontSize: k === '⌫' ? 'clamp(16px,2vw,20px)' : 'clamp(18px,2.5vw,24px)',
                        fontWeight: 500, borderRadius: 10,
                        border: '1px solid #E5E7EB', background: 'white', cursor: 'pointer',
                        color: k === '⌫' ? '#EF4444' : '#111' }}>
                      {k}
                    </button>
                  ))}
                </div>

                <input
                  value={cariPaymentDesc}
                  onChange={e => setCariPaymentDesc(e.target.value)}
                  placeholder="Açıklama (opsiyonel)"
                  style={{ padding: '10px 14px', fontSize: 13, borderRadius: 10,
                    border: '1px solid #E5E7EB', outline: 'none',
                    width: '100%', boxSizing: 'border-box' as const }}
                />

                {cariPaymentResult && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13,
                    background: cariPaymentResult.ok ? '#F0FDF4' : '#FEF2F2',
                    border: `1px solid ${cariPaymentResult.ok ? '#BBF7D0' : '#FECACA'}`,
                    color: cariPaymentResult.ok ? '#166534' : '#991B1B' }}>
                    {cariPaymentResult.ok ? '✓' : '✗'} {cariPaymentResult.msg}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); setCariPaymentAmt('') }}
                    style={{ padding: '13px 0', fontSize: 14, fontWeight: 500,
                      borderRadius: 10, border: '1px solid #E5E7EB',
                      background: '#F9FAFB', cursor: 'pointer', color: '#374151' }}>
                    C
                  </button>
                  <button type="button"
                    disabled={cariPaymentSaving || !cariPaymentAmt || (() => {
                      const n = parseFloat(cariPaymentAmt.replace(',', '.'))
                      return !Number.isFinite(n) || n <= 0
                    })()}
                    onClick={() => void handleCariPayment()}
                    style={{ padding: '13px 0', fontSize: 14, fontWeight: 600,
                      borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: cariPaymentModal === 'tahsilat' ? '#2E7D32' : '#C62828',
                      color: 'white',
                      opacity: cariPaymentSaving || !cariPaymentAmt ? 0.6 : 1 }}>
                    {cariPaymentSaving ? 'Gönderiliyor...'
                      : cariPaymentModal === 'tahsilat' ? 'Tahsilat Yap' : 'Ödeme Yap'}
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* ── Adet göstergesi — ince ── */}
          <div style={{
            borderRadius: 7, padding: '3% 4%', textAlign: 'center',
            border: `1px solid ${numBuf ? '#a5d6a7' : '#fde68a'}`,
            background: numBuf ? '#e8f5e9' : '#fff8e1', flexShrink: 0,
          }}>
            <span style={{
              fontSize: 'clamp(13px, 1.1vw + 6px, 20px)',
              fontWeight: 700, color: numBuf ? '#2e7d32' : '#d97706',
              display: 'block', lineHeight: 1,
            }}>{numBuf || '—'}</span>
            <span style={{ fontSize: 'clamp(8px, 0.6vw, 10px)', color: '#6b7280', display: 'block', marginTop: 2 }}>
              {numBuf.includes(',') ? 'miktar' : 'adet'}
            </span>
          </div>

          {/* ── Numpad ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '3%',
            flex: 1,
            minHeight: 0,
          }}>
            {[
              '7', '8', '9',
              '4', '5', '6',
              '1', '2', '3',
              ',', '0', '⌫',
            ].map(k => (
              <button
                key={k}
                type="button"
                onMouseDown={e => { e.preventDefault(); handleNumKey(k) }}
                style={{
                  width: '100%', minWidth: 0,
                  boxSizing: 'border-box',
                  aspectRatio: '1 / 1',
                  border: '1.5px solid',
                  borderRadius: 9,
                  cursor: 'pointer',
                  fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  userSelect: 'none' as const,
                  background: k === '⌫' ? '#fffbeb' : 'white',
                  color: k === '⌫' ? '#d97706' : '#1f2937',
                  borderColor: k === '⌫' ? '#fde68a' : '#d1d5db',
                  fontSize: 'clamp(16px, 1.6vw + 6px, 30px)',
                }}
              >{k}</button>
            ))}

            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); handleNumKey('C') }}
              style={{
                gridColumn: 'span 3',
                width: '100%', boxSizing: 'border-box',
                padding: '4% 0',
                border: '1.5px solid #fecdd3',
                borderRadius: 9, cursor: 'pointer',
                fontWeight: 700, fontSize: 'clamp(12px, 1.1vw + 4px, 18px)',
                background: '#fff5f5', color: '#dc2626',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                userSelect: 'none' as const,
              }}
            >Temizle</button>
          </div>

        </div>

        {/* ③ PLU — %29 */}
        <div style={{ width: '29%', flexShrink: 0, boxSizing: 'border-box', background: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #e0e0e0', minWidth: 0 }}>

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
          <div style={{ padding: '8px', flexShrink: 0, borderBottom: '1px solid #f5f5f5' }}>
            <input
              ref={searchRef}
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchQ('') }}
              placeholder="Barkod veya ürün ara..."
              style={{
                width: '100%',
                border: '1px solid #E0E0E0',
                borderRadius: 9,
                padding: '10px 14px',
                fontSize: 15,
                outline: 'none',
                background: 'white',
              }}
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button
                  onClick={() => {
                    const amt = parseFloat(numBuf.replace(',', '.')) || grandTotal
                    const line: PaymentLine = {
                      id: crypto.randomUUID(),
                      method: 'cash',
                      amount: parseFloat(amt.toFixed(2)),
                      label: 'Nakit',
                      mediator: 1,
                    }
                    setPaymentLines([line])
                    void completeSale([line])
                  }}
                  disabled={cart.length === 0}
                  style={{
                    padding: '13px 4px',
                    borderRadius: 7,
                    border: 'none',
                    background: cart.length === 0 ? '#f5f5f5' : '#e8f5e9',
                    color: cart.length === 0 ? '#bdbdbd' : '#2e7d32',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: cart.length === 0 ? 'default' : 'pointer',
                  }}
                >
                  💵 Nakit
                </button>
                <button
                  onClick={() => {
                    const line: PaymentLine = {
                      id: crypto.randomUUID(),
                      method: 'card',
                      amount: grandTotal,
                      label: 'Kart',
                      mediator: 2,
                    }
                    setPaymentLines([line])
                    void completeSale([line])
                  }}
                  disabled={cart.length === 0 || !pavoSettings}
                  title={!pavoSettings ? 'Pavo cihazı ayarlı değil' : undefined}
                  style={{
                    padding: '13px 4px',
                    borderRadius: 7,
                    border: 'none',
                    background: cart.length === 0 || !pavoSettings ? '#f5f5f5' : '#e3f2fd',
                    color: cart.length === 0 || !pavoSettings ? '#bdbdbd' : '#1565C0',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: cart.length === 0 || !pavoSettings ? 'default' : 'pointer',
                  }}
                >
                  💳 Kart
                </button>
                <button
                  onClick={() => {
                    setPaymentLines([])
                    setActiveMethod(null)
                    setPendingAmount('')
                    setPaymentMode(true)
                  }}
                  disabled={cart.length === 0}
                  style={{
                    gridColumn: 'span 2',
                    padding: '11px 4px',
                    borderRadius: 7,
                    border: 'none',
                    background: cart.length === 0 ? '#f5f5f5' : '#fff8e1',
                    color: cart.length === 0 ? '#bdbdbd' : '#e65100',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: cart.length === 0 ? 'default' : 'pointer',
                  }}
                >
                  🔀 Karma Ödeme
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {paymentLines.map(line => (
                  <div key={line.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: line.method === 'cash' ? '#E8F5E9' : '#E3F2FD',
                    border: `1px solid ${line.method === 'cash' ? '#A5D6A7' : '#90CAF9'}`,
                  }}>
                    <span style={{ fontSize: 13, flex: 1, fontWeight: 500 }}>{line.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>
                      {line.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </span>
                    <button onClick={() => setPaymentLines(prev => prev.filter(l => l.id !== line.id))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 16 }}>
                      ✕
                    </button>
                  </div>
                ))}

                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '7px 12px',
                  borderRadius: 8,
                  background: remaining === 0 ? '#F0FDF4' : '#FFF8E1',
                  border: `1px solid ${remaining === 0 ? '#86EFAC' : '#FDE68A'}`,
                }}>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>Kalan</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: remaining === 0 ? '#2E7D32' : '#E65100' }}>
                    {remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </span>
                </div>

                {activeMethod && (
                  <div style={{ padding: '5px 12px', borderRadius: 8, background: '#F3F4F6', fontSize: 12, color: '#374151' }}>
                    {activeMethod === 'cash' ? '💵' : '💳'} Tutar: <strong>{pendingAmount || '(kalan tutar)'}</strong>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    onClick={() => {
                      if (activeMethod === 'cash') addPaymentLine('cash')
                      else { setActiveMethod('cash'); setPendingAmount('') }
                    }}
                    disabled={remaining <= 0 && activeMethod !== 'cash'}
                    style={{
                      padding: '10px', borderRadius: 8, border: '2px solid',
                      borderColor: activeMethod === 'cash' ? '#2E7D32' : '#A5D6A7',
                      background: activeMethod === 'cash' ? '#E8F5E9' : 'white',
                      color: '#2E7D32', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                    }}>
                    {activeMethod === 'cash' ? '✓ Nakit Ekle' : '💵 Nakit'}
                  </button>

                  <button
                    onClick={() => {
                      if (activeMethod === 'card') addPaymentLine('card')
                      else { setActiveMethod('card'); setPendingAmount('') }
                    }}
                    disabled={remaining <= 0 && activeMethod !== 'card'}
                    style={{
                      padding: '10px', borderRadius: 8, border: '2px solid',
                      borderColor: activeMethod === 'card' ? '#1565C0' : '#90CAF9',
                      background: activeMethod === 'card' ? '#E3F2FD' : 'white',
                      color: '#1565C0', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                    }}>
                    {activeMethod === 'card' ? '✓ Kart Ekle' : '💳 Kart'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 6 }}>
                  <button
                    onClick={() => {
                      setPaymentMode(false)
                      setPaymentLines([])
                      setActiveMethod(null)
                      setPendingAmount('')
                    }}
                    style={{ padding: '10px', borderRadius: 8, border: '1px solid #E0E0E0', background: 'white', cursor: 'pointer', fontSize: 12, color: '#374151' }}>
                    İptal
                  </button>
                  <button
                    onClick={() => void completeSale()}
                    disabled={remaining !== 0 || saving}
                    style={{
                      padding: '10px', borderRadius: 8, border: 'none',
                      background: remaining === 0 && !saving ? '#1565C0' : '#E5E7EB',
                      color: remaining === 0 && !saving ? 'white' : '#9CA3AF',
                      fontWeight: 700, fontSize: 13,
                      cursor: remaining === 0 && !saving ? 'pointer' : 'default',
                    }}>
                    {saving ? 'İşleniyor...' : `Tamamla ✓  ${grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`}
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

      {pavoLoading && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            background: 'white',
            borderRadius: 16,
            padding: '32px 48px',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 8 }}>
              Kartı Okutun
            </div>
            <div style={{ fontSize: 13, color: '#6B7280' }}>
              Pavo cihazında işlem bekleniyor...
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1565C0', marginTop: 12 }}>
              {grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
            </div>
          </div>
        </div>
      )}

      {pavoError && !pavoLoading && (
        <div style={{
          position: 'fixed',
          bottom: merkezToast || cancelWarning ? 72 : 24,
          right: 24,
          zIndex: 10002,
          background: '#FFEBEE',
          color: '#B71C1C',
          border: '1px solid #FFCDD2',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>
          Pavo: {pavoError}
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

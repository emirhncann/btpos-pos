import { useState, useEffect, useRef, useCallback, type ReactNode, type CSSProperties } from 'react'
import { useLicenseCheck } from '../hooks/useLicenseCheck'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import { sendInvoiceForSale, sendReturnInvoice, resolveTorbaCustomer, enqueueCustomer } from '../lib/invoiceSend'
import { pavoCompleteSale, type PavoSettings } from '../lib/pavoService'
import type { PaymentDeviceResult } from '../lib/paymentDevice'
import { useQueueWorker, type QueueToastPayload } from '../hooks/useQueueWorker'
import { API_URL } from '../lib/api'
import { PluButton, truncatePluName } from '../components/PluButton'
import AppLogo from '../components/AppLogo'
import LicenseBanner from '../components/LicenseBanner'
import ConnectionDot from '../components/ConnectionDot'
import { TouchKeyboard } from '../components/TouchKeyboard'
import { useTouchKeyboard, type OpenOpts } from '../hooks/useTouchKeyboard'
import { searchCustomers as rankCustomers } from '../lib/searchCustomers'
import { buildSaleReceiptData } from '../lib/templateEngine'
import { nextOrderNo } from '../lib/orderNo'
import QuickReturnModal, {
  type QuickReturnModalState,
  type RecentSalesFilter,
  type ReturnablePayment,
  type ReturnableSale,
  type ReturnableSaleItem,
} from '../components/QuickReturnModal'
import AlertDialog from '../components/AlertDialog'
import { useAlertDialog } from '../hooks/useAlertDialog'

function mapRawReturnableSale(data: {
  Id:           unknown
  SaleNumber:   unknown
  OrderNo?:     unknown
  CustomerInfo: unknown
  Items:        unknown[]
  Payments:     unknown[]
}): ReturnableSale {
  const items: ReturnableSaleItem[] = data.Items.map((row) => {
    const item = row as Record<string, unknown>
    // main process zaten map etmiş olabilir
    if (item.ProductName != null && item.ReturnableQuantity != null) {
      return item as unknown as ReturnableSaleItem
    }
    const qty = Number(item.ItemQuantity ?? item.Quantity ?? 0)
    return {
      Id:                 Number(item.Id ?? item.RelatedSaleItemId ?? item.SaleItemId ?? 0),
      ProductName:        String(item.Name ?? item.ProductName ?? ''),
      Quantity:           qty,
      ReturnableQuantity: Number(
        item.ReturnableQuantity ??
        item.RemainingReturnableQuantity ??
        item.ReturnableItemQuantity ??
        item.RemainingQuantity ??
        qty,
      ),
      UnitPrice:          Number(item.UnitPriceAmount ?? item.UnitPrice ?? item.GrossPriceAmount ?? 0),
      TotalPrice:         Number(item.TotalPriceAmount ?? item.TotalPrice ?? 0),
      VatRate:            Number(item.VATRate ?? item.VatRate ?? 20),
      UnitName:           String(item.UnitName ?? item.Unit ?? 'Adet'),
      TaxGroupId:         Number(item.TaxGroupId ?? 74),
      ProductCode:        String(item.ProductCode ?? item.Barcode ?? item.Code ?? ''),
      StockRef:           Number(item.StockRef ?? item.stockRef ?? 0) || undefined,
      ProductId:          Number(item.ProductId ?? item.productId ?? 0) || undefined,
    }
  })

  const payments: ReturnablePayment[] = data.Payments
    .filter(p => Number((p as Record<string, unknown>).StatusId ?? 2) === 2)
    .map((row) => {
      const p = row as Record<string, unknown>
      const amount = Number(p.PaymentAmount ?? p.Amount ?? 0)
      return {
        Mediator:         Number(p.PaymentMediatorId ?? p.Mediator ?? 0),
        Amount:           amount,
        ReturnableAmount: Number(p.RemainingVoidableAmount ?? p.ReturnableAmount ?? amount),
        PaymentId:        Number(p.Id ?? p.PaymentId ?? 0),
      }
    })

  const customerRaw = data.CustomerInfo
  const customerInfo = customerRaw && typeof customerRaw === 'object'
    ? customerRaw as {
        CustomerType?: number
        CompanyName?: string
        TaxNumber?:   string
        FirstName?:   string
      }
    : null

  return {
    Id:           Number(data.Id ?? 0),
    SaleNumber:   String(data.SaleNumber ?? ''),
    OrderNo:      data.OrderNo != null ? String(data.OrderNo) : null,
    CustomerInfo: customerInfo,
    Items:        items,
    Payments:     payments,
  }
}

function recalcPayments(
  sale:     ReturnableSale,
  selected: Record<number, number>,
  current:  Record<number, number>,
): Record<number, number> {
  const totalReturn = sale.Items.reduce((sum, item) => {
    const qty = selected[item.Id] ?? 0
    return sum + qty * item.UnitPrice
  }, 0)

  const returnablePmts = sale.Payments
    .filter(p => p.ReturnableAmount > 0)
    .sort((a, b) => a.ReturnableAmount - b.ReturnableAmount)

  if (returnablePmts.length === 0) return current

  const result: Record<number, number> = {}
  let remaining = Math.round(totalReturn * 100) / 100

  for (const p of returnablePmts) {
    const amount = Math.min(p.ReturnableAmount, remaining)
    result[p.PaymentId] = Math.round(amount * 100) / 100
    remaining = Math.round((remaining - amount) * 100) / 100
  }

  return result
}

function formatPaymentNumpadValue(amount: number): string {
  if (amount <= 0) return ''
  return amount.toFixed(2).replace('.', ',')
}

const CART_GRID = '84px 1fr 72px 82px'

/** SMS cep: 10 hane, 5 ile başlar; gösterim 555 555 55 55 */
const SMS_MOBILE_LEN = 10

function normalizeTrMobileForSms(raw: string): string {
  if (!raw) return ''

  let d = raw.replace(/\D/g, '')

  if (d.startsWith('90')) d = d.slice(2)

  if (d.startsWith('0')) d = d.slice(1)

  d = d.slice(0, SMS_MOBILE_LEN)

  if (!d.startsWith('5')) return ''

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
  customerDisplay?: boolean
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

function fmtQty(qty: number): string {
  return qty % 1 === 0 ? qty.toString() : qty.toFixed(3)
}

const WEIGHED_UNITS = new Set(['KG', 'GR', 'G', 'kg', 'gr', 'g', 'Kg'])

function isWeighedUnit(unit?: string): boolean {
  return WEIGHED_UNITS.has(unit ?? '')
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
  return {
    ...i,
    id:        i.id ?? crypto.randomUUID(),
    productId: i.productId ?? i.id,
    lineTotal,
    discountRate,
    discountAmount,
    netTotal,
    barcode: i.barcode ?? '',
  }
}

function localISOString(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  const local = new Date(now.getTime() - offset)
  return local.toISOString().replace('Z', '').slice(0, 26)
}

const MENU_ACCENT: Record<'islemler' | 'belge' | 'musteri', string> = {
  islemler: '#1565C0',
  belge:    '#7C3AED',
  musteri:  '#2E7D32',
}

const MAX_HELD_DOCS = 10

function PopupItem({ icon, label, disabled, danger, accent = '#1565C0', layout = 'row', onClick }: {
  icon:     string
  label:    string
  disabled?: boolean
  danger?:  boolean
  accent?:  string
  layout?:  'row' | 'stack'
  onClick?: () => void
}) {
  const tone = danger ? '#DC2626' : accent
  const stacked = layout === 'stack'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'center' : 'center',
        justifyContent: stacked ? 'center' : 'flex-start',
        gap: stacked ? 10 : 14,
        width: '100%',
        minHeight: stacked ? 100 : 60,
        padding: stacked ? '16px 12px' : '14px 16px',
        borderRadius: 14,
        border: `1.5px solid ${disabled ? '#E5E7EB' : danger ? '#FECACA' : `${tone}30`}`,
        background: disabled ? '#F9FAFB' : danger ? '#FFF5F5' : '#FFFFFF',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: stacked ? 'center' as const : 'left' as const,
        boxShadow: disabled ? 'none' : '0 2px 8px rgba(0,0,0,0.06)',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
      }}
    >
      <span style={{
        width: stacked ? 52 : 46,
        height: stacked ? 52 : 46,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: stacked ? 26 : 22,
        flexShrink: 0,
        background: disabled ? '#F3F4F6' : danger ? '#FEE2E2' : `${tone}12`,
      }}>
        {icon}
      </span>
      <span style={{
        fontSize: stacked ? 14 : 15,
        fontWeight: 600,
        color: disabled ? '#9CA3AF' : danger ? '#DC2626' : '#1F2937',
        lineHeight: 1.35,
        flex: stacked ? undefined : 1,
      }}>
        {label}
      </span>
      {!disabled && !stacked && (
        <span style={{ fontSize: 18, color: '#D1D5DB', flexShrink: 0 }}>›</span>
      )}
    </button>
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
  customerDisplay = true,
}: Props) {

  const touchEnabled = posSettings?.touchKeyboard ?? true
  const { openKeyboard, keyboardProps } = useTouchKeyboard(touchEnabled)

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
  const [returnMode, setReturnMode]       = useState(false)
  const [docDiscountMode, setDocDiscountMode] = useState(false)
  const [discMode, setDiscMode] = useState<'rate' | 'amt'>('rate')
  const [docDiscMode, setDocDiscMode] = useState<'rate' | 'amt'>('rate')
  const [docDiscInput, setDocDiscInput] = useState('')
  const [docDiscountRate, setDocDiscountRate] = useState(0)
  const [docDiscountAmt, setDocDiscountAmt]   = useState(0)
  const [lineDiscountTarget, setLineDiscountTarget] = useState<string | null>(null)
  const [lineDiscRateIn, setLineDiscRateIn]   = useState('')
  const [lineDiscAmtIn, setLineDiscAmtIn]     = useState('')
  const [priceEditTarget, setPriceEditTarget] = useState<string | null>(null)
  const [priceEditInput, setPriceEditInput]   = useState('')
  const [menuOpen, setMenuOpen] = useState<'islemler' | 'belge' | 'musteri' | 'fiyatgor' | null>(null)
  const [fiyatGorQ, setFiyatGorQ] = useState('')
  const [fiyatGorItem, setFiyatGorItem] = useState<ProductRow | null>(null)
  const [cariPaymentModal, setCariPaymentModal] = useState<'tahsilat' | 'odeme' | null>(null)
  const [cariPaymentAmt, setCariPaymentAmt] = useState('')
  const [cariPaymentDesc, setCariPaymentDesc] = useState('')
  const [cariPaymentSaving, setCariPaymentSaving] = useState(false)
  const [cariPaymentResult, setCariPaymentResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [cariPaymentCust, setCariPaymentCust] = useState<CustomerRow | null>(null)
  const [cariPaymentQ, setCariPaymentQ] = useState('')
  const [cariPaymentResults, setCariPaymentResults] = useState<CustomerRow[]>([])
  const [cariPaymentSearching, setCariPaymentSearching] = useState(false)
  const [printSelectModal, setPrintSelectModal] = useState<{
    trigger: string
    templates: { id: string; name: string; template_type: string; is_default: boolean }[]
    data: Record<string, Record<string, unknown>>
  } | null>(null)
  const [heldDocs, setHeldDocs]           = useState<HeldDocRow[]>([])
  const [showHeld, setShowHeld]           = useState(false)
  const [heldPreview, setHeldPreview]     = useState<HeldDocRow | null>(null)
  const [heldEdit, setHeldEdit]           = useState<{ id: string; label: string } | null>(null)
  const [currentOrderNo, setCurrentOrderNo] = useState<string | null>(null)
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  )
  const [showCustomer, setShowCustomer]   = useState(false)
  const [customers, setCustomers]         = useState<CustomerRow[]>([])
  const [customerQ, setCustomerQ]         = useState('')
  const [addCustomerModal, setAddCustomerModal] = useState(false)
  const [newCustPrefill, setNewCustPrefill] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const [smsPhone, setSmsPhone] = useState('')
  const [mailAddr, setMailAddr] = useState('')
  const [mailModalOpen, setMailModalOpen] = useState(false)
  const [smsPhonePanelOpen, setSmsPhonePanelOpen] = useState(false)
  const [smsPhoneDraft, setSmsPhoneDraft] = useState('')
  const [invoiceType, setInvoiceType] = useState<'e_archive' | 'paper'>('e_archive')
  const [pavoSettings, setPavoSettings] = useState<PavoSettings | null>(null)
  const [pavoLoading, setPavoLoading] = useState(false)
  const [pavoError, setPavoError] = useState<string | null>(null)
  const { dialogProps, showError, showSuccess, showInfo, confirm } = useAlertDialog()
  const [quickReturnModal, setQuickReturnModal] = useState<QuickReturnModalState | null>(null)
  const [scaleModal, setScaleModal] = useState<{
    product: CartItem
    weight:  number
    tare:    number
    stable:  boolean
  } | null>(null)
  const [scaleEnabled, setScaleEnabled] = useState(false)
  const [quickReturnLoading, setQuickReturnLoading] = useState(false)
  const [quickReturnError, setQuickReturnError]   = useState<string | null>(null)
  const [paymentNumpad, setPaymentNumpad] = useState<{
    paymentId: number
    max:       number
    value:     string
  } | null>(null)
  const [draftModal, setDraftModal] = useState<{
    cart:     CartItem[]
    customer: CustomerRow | null
    savedAt:  string
  } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const fiyatGorInputRef = useRef<HTMLInputElement>(null)
  const cartListRef = useRef<HTMLDivElement>(null)
  const prevCartLenRef = useRef(0)
  const [swipeState, setSwipeState] = useState<{
    id:       string
    startX:   number
    currentX: number
    locked:   boolean
  } | null>(null)
  const SLIDE_THRESHOLD = 60
  const SLIDE_THRESHOLD_MOUSE = 25
  const SLIDE_OPEN_X    = 72

  const license   = useLicenseCheck(companyId)
  const conn      = useConnectionStatus(30)
  const isOnline  = conn === 'online'
  const [queueToasts, setQueueToasts] = useState<(QueueToastPayload & { shownAt: number })[]>([])
  const [heldToast, setHeldToast] = useState<string | null>(null)
  const heldToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, _type: 'error' | 'success' = 'error') => {
    if (heldToastTimer.current) clearTimeout(heldToastTimer.current)
    setHeldToast(msg)
    heldToastTimer.current = setTimeout(() => setHeldToast(null), 4000)
  }, [])

  const handleQueueToast = useCallback((toast: QueueToastPayload) => {
    setQueueToasts(prev => [...prev, { ...toast, shownAt: Date.now() }])
    setTimeout(() => {
      setQueueToasts(prev => prev.filter(t => t.id !== toast.id))
    }, 4000)
  }, [])

  const { processQueue } = useQueueWorker({
    companyId,
    isOnline,
    onToast: handleQueueToast,
  })

  const applyCustomerSelection = useCallback((c: CustomerRow | null) => {
    setSelectedCustomer(c)
    if (!c) {
      setSmsPhone('')
      setMailAddr('')
      setMailModalOpen(false)
      setSmsPhonePanelOpen(false)
      setSmsPhoneDraft('')
      setMenuOpen(null)
      setCariPaymentModal(null)
      setCariPaymentAmt('')
      setCariPaymentDesc('')
      setCariPaymentResult(null)
      setCariPaymentSaving(false)
      setCariPaymentCust(null)
      setCariPaymentQ('')
      setCariPaymentResults([])
      setCariPaymentSearching(false)
      return
    }

    if (c.phone) {
      const normalized = normalizeTrMobileForSms(c.phone)
      if (normalized.length === SMS_MOBILE_LEN) {
        setSmsPhone(normalized)
        setSmsPhoneDraft(normalized)
      } else {
        setSmsPhone('')
        setSmsPhoneDraft('')
      }
    } else {
      setSmsPhone('')
      setSmsPhoneDraft('')
    }

    if (c.email && isValidNotifyEmail(c.email)) {
      setMailAddr(c.email)
    } else {
      setMailAddr('')
    }

    setMenuOpen(null)
  }, [])

  /** Cari seç + SMS/mail doldur; cari arama panelini kapat (sprint selectCustomer) */
  const selectCustomer = useCallback((c: CustomerRow) => {
    applyCustomerSelection(c)
    setShowCustomer(false)
  }, [applyCustomerSelection])

  const loadCustomersForModal = useCallback(async (q: string) => {
    if (!companyId) return
    try {
      const all = await window.electron.db.getCustomers(companyId)
      if (q.trim().length < 2) {
        setCustomers([])
      } else {
        setCustomers(rankCustomers(all, q))
      }
    } catch {
      setCustomers([])
    }
  }, [companyId])

  useEffect(() => {
    if (!showCustomer || !companyId) return
    void loadCustomersForModal(customerQ)
  }, [customerQ, showCustomer, companyId, loadCustomersForModal])

  /** Klavye onConfirm veya normal input — sonuçlar dropdown'da; tek eşleşmede otomatik seç */
  const searchCariPayment = useCallback(async (v: string) => {
    setCariPaymentQ(v)
    if (v.length < 2) {
      setCariPaymentResults([])
      return
    }
    setCariPaymentSearching(true)
    try {
      const all = await window.electron.db.getCustomers(companyId)
      const results = rankCustomers(all, v)
      setCariPaymentResults(results)
      if (results.length === 1) {
        setCariPaymentCust(results[0])
        setCariPaymentResults([])
        setCariPaymentQ('')
      }
    } catch {
      setCariPaymentResults([])
    } finally {
      setCariPaymentSearching(false)
    }
  }, [companyId])

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
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString('tr-TR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }))
    }, 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    void window.electron.scale.getSettings().then(s => {
      setScaleEnabled(!!s?.enabled)
    })
  }, [])

  useEffect(() => {
    if (!scaleEnabled) return

    const cleanup = window.electron.scale.onData(reading => {
      setScaleModal(prev => prev ? {
        ...prev,
        weight: reading.weight,
        stable: reading.stable,
      } : prev)
    })

    return cleanup
  }, [scaleEnabled])

  useEffect(() => {
    void (async () => {
      try {
        const draft = await window.electron.cart.loadDraft()
        if (!draft || !Array.isArray(draft.cart) || draft.cart.length === 0) return
        setDraftModal({
          cart:     draft.cart as CartItem[],
          customer: draft.customer as CustomerRow | null,
          savedAt:  new Date(draft.savedAt).toLocaleString('tr-TR'),
        })
      } catch { /* taslak yok */ }
    })()
  }, [])

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

  function resetSlide() {
    setSwipeState(null)
  }

  const beginMouseSwipe = useCallback((itemId: string, clientX: number) => {
    setSwipeState({ id: itemId, startX: clientX, currentX: 0, locked: false })

    const onMove = (e: MouseEvent) => {
      setSwipeState(s => {
        if (!s || s.id !== itemId) return s
        const dx = s.startX - e.clientX
        const cx = Math.max(0, Math.min(dx, SLIDE_OPEN_X))
        return { ...s, currentX: cx, locked: cx >= SLIDE_THRESHOLD_MOUSE }
      })
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setSwipeState(s => {
        if (!s || s.id !== itemId) return null
        if (s.locked || s.currentX >= SLIDE_THRESHOLD_MOUSE) {
          return { ...s, currentX: SLIDE_OPEN_X, locked: true }
        }
        return null
      })
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

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

  const applyFiyatGorScan = useCallback((code: string) => {
    setFiyatGorQ(code)
    setFiyatGorItem(null)
    const found = allProducts.find(p => p.barcode === code || p.code === code)
    if (found) setFiyatGorItem(found)
  }, [allProducts])

  useEffect(() => {
    if (menuOpen === 'fiyatgor') {
      setTimeout(() => fiyatGorInputRef.current?.focus(), 50)
    }
  }, [menuOpen])

  /* ── POS açılınca Electron penceresine focus — barkod hemen çalışsın ── */
  useEffect(() => {
    void window.electron.window.focusWindow()
  }, [])

  /* ── Global barkod okuyucu ── */
  useEffect(() => {
    let buf = ''
    let timer: ReturnType<typeof setTimeout> | null = null

    const onKey = (e: KeyboardEvent) => {
      if (paymentMode || quickReturnModal || cariPaymentModal) return

      // Fiyat Gör açıksa — barkodu oraya yönlendir (input odakta olsa bile)
      if (menuOpen === 'fiyatgor') {
        if (e.key === 'Enter') {
          if (buf.length >= 3) applyFiyatGorScan(buf)
          buf = ''
          if (timer) clearTimeout(timer)
          return
        }
        if (e.key.length === 1) {
          buf += e.key
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => { buf = '' }, 150)
        }
        return
      }

      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Enter') {
        if (buf.length >= 2) {
          setSearchQ(buf)
          setNumBuf('')
        } else if (numBuf.length >= 2) {
          setSearchQ(numBuf)
          setNumBuf('')
        }
        buf = ''
        if (timer) clearTimeout(timer)
        return
      }

      if (e.key.length === 1) {
        buf += e.key
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { buf = '' }, 150)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paymentMode, quickReturnModal, cariPaymentModal, menuOpen, applyFiyatGorScan, numBuf])

  /* ── Barkod okuyucu ── */
  useEffect(() => {
    if (searchQ.length < 2) return
    const t = setTimeout(() => {
      if (quickReturnModal?.step === 'search') {
        const scannedCode = searchQ
        setSearchQ('')
        setQuickReturnModal(m => m ? { ...m, saleNumber: scannedCode } : m)
        void searchReturnableSale(scannedCode, quickReturnModal.searchBy)
        return
      }

      const byBarcode = allProducts.find(p => p.barcode === searchQ)
      if (!byBarcode) return
      const qty = numBuf ? Math.max(0.01, parseFloat(numBuf.replace(',', '.'))) : 1
      setNumBuf('')
      setSearchQ('')
      addToCartWithQty(byBarcode, qty)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ, numBuf, allProducts, quickReturnModal?.step])

  /* ── Sepet işlemleri ── */
  function addToCartWithQty(product: ProductRow, qty: number) {
    if (cart.length === 0 && !currentOrderNo) {
      setCurrentOrderNo(nextOrderNo(posSettings.terminalNumber))
      setLastReceipt(null)
    }

    setCart(prev => {
      const dup = posSettings.duplicateItemAction ?? 'increase_qty'

      if (dup === 'increase_qty') {
        const exIdx = prev.findIndex(c => c.productId === product.id)
        if (exIdx !== -1) {
          const ex = prev[exIdx]
          const newQty = ex.quantity + qty
          const newTotal = parseFloat((newQty * ex.price).toFixed(2))
          const netTotal = calcLineDiscount(newTotal, ex.discountRate, ex.discountAmount)
          return prev.map((c, i) => i === exIdx
            ? { ...c, quantity: newQty, lineTotal: newTotal, netTotal }
            : c
          )
        }
      }

      const lineTotal = parseFloat((product.price * qty).toFixed(2))
      return [...prev, {
        id:          crypto.randomUUID(),
        productId:   product.id,
        code:        product.code ?? '',
        name:        product.name,
        category:    product.category ?? '',
        price:       product.price,
        vatRate:     product.vatRate ?? 18,
        unit:        product.unit ?? 'Adet',
        quantity:    qty,
        lineTotal,
        discountRate:   0,
        discountAmount: 0,
        netTotal:    lineTotal,
        barcode:     product.barcode ?? '',
      }]
    })
  }

  async function handlePluClick(product: ProductRow) {
    if (isWeighedUnit(product.unit) && scaleEnabled) {
      const last = await window.electron.scale.getLastReading()
      setScaleModal({
        product: {
          id:             crypto.randomUUID(),
          productId:      product.id,
          code:           product.code ?? '',
          name:           product.name,
          category:       product.category ?? '',
          price:          product.price,
          vatRate:        product.vatRate ?? 18,
          unit:           product.unit ?? 'KG',
          quantity:       0,
          lineTotal:      0,
          discountRate:   0,
          discountAmount: 0,
          netTotal:       0,
          barcode:        product.barcode ?? '',
        },
        weight: last?.weight ?? 0,
        tare:   0,
        stable: last?.stable ?? false,
      })
      return
    }

    const qty = numBuf ? Math.max(0.01, parseFloat(numBuf.replace(',', '.'))) : 1
    setNumBuf('')
    addToCartWithQty(product, qty)
    setSearchQ('')
    searchRef.current?.blur()
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
      showError('İndirim Limiti', `Maksimum satır indirimi %${maxPct}`)
      return
    }
    if (amt > 0) {
      const target = cart.find(c => c.id === lineDiscountTarget)
      if (target && target.lineTotal > 0) {
        const effectivePct = (amt / target.lineTotal) * 100
        if (effectivePct > maxPct) {
          showError('İndirim Limiti', `Bu tutar %${effectivePct.toFixed(1)} indirime karşılık geliyor. Maksimum %${maxPct}`)
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

  function applyPriceEdit() {
    if (!priceEditTarget) return
    const raw   = priceEditInput.replace(/\./g, '').replace(',', '.')
    const price = parseFloat(raw)
    if (isNaN(price) || price < 0) {
      setPriceEditTarget(null)
      setPriceEditInput('')
      return
    }

    setCart(prev => prev.map(c => {
      if (c.id !== priceEditTarget) return c
      const newTotal = parseFloat((c.quantity * price).toFixed(2))
      const netTotal = calcLineDiscount(newTotal, c.discountRate, c.discountAmount)
      return { ...c, price, lineTotal: newTotal, netTotal }
    }))

    setPriceEditTarget(null)
    setPriceEditInput('')
  }

  function openPriceEdit(itemId: string, price: number) {
    if (paymentMode) return
    setSmsPhonePanelOpen(false)
    setMenuOpen(null)
    setPriceEditTarget(itemId)
    setPriceEditInput(price.toFixed(2).replace('.', ','))
  }

  function cancelQtyFromNumBuf(): number {
    if (!numBuf) return 1
    const n = parseInt(numBuf.replace(',', '.').split('.')[0] ?? '', 10)
    return Math.max(1, n || 1)
  }

  function cancelOneFromCart(id: string) {
    const qty = cancelQtyFromNumBuf()

    setCart(prev => {
      const item = prev.find(c => c.id === id)
      if (!item) return prev

      if (item.quantity > qty) {
        return prev.map(c => {
          if (c.id !== id) return c
          const newQty   = c.quantity - qty
          const newTotal = parseFloat((newQty * c.price).toFixed(2))
          const netTotal = calcLineDiscount(newTotal, c.discountRate, c.discountAmount)
          return { ...c, quantity: newQty, lineTotal: newTotal, netTotal }
        })
      }

      return prev.filter(c => c.id !== id)
    })

    resetSlide()
    setNumBuf('')
  }

  function clearCart() {
    setCart([])
    setCurrentOrderNo(null)
    setLastReceipt(null)
    setPaymentMode(false)
    setPaymentLines([])
    setActiveMethod(null)
    setPendingAmount('')
    setNumBuf('')
    resetSlide()
    setDocDiscountMode(false)
    setDocDiscMode('rate')
    setDocDiscInput('')
    setDocDiscountRate(0)
    setDocDiscountAmt(0)
    setLineDiscountTarget(null)
    applyCustomerSelection(null)
    setMenuOpen(null)
    void window.electron.cart.clearDraft().catch(() => {})
  }

  useEffect(() => {
    if (!companyId) return

    if (cart.length === 0) {
      void window.electron.cart.clearDraft().catch(() => {})
      return
    }

    const timer = setTimeout(() => {
      void (async () => {
        const terminalId = await window.electron.store.get('terminal_id') as string | null
        await window.electron.cart.saveDraft({
          companyId,
          terminalId: terminalId ?? '',
          cashierId:  cashier.id,
          cart,
          customer: selectedCustomer ?? null,
        })
      })()
    }, 3000)

    return () => clearTimeout(timer)
  }, [cart, selectedCustomer, companyId, cashier.id])

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

    if (numBuf.replace(',', '').length < 20) {
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

    if (heldDocs.length >= MAX_HELD_DOCS) {
      setShowHeld(true)
      showToast(`Maksimum ${MAX_HELD_DOCS} belge bekletilebilir. Önce bir belgeyi getirin veya silin.`, 'error')
      return
    }

    const orderNo = currentOrderNo
      ?? nextOrderNo(posSettings.terminalNumber)

    const label = selectedCustomer
      ? selectedCustomer.name
      : `Belge ${new Date().toLocaleTimeString('tr-TR')}`

    await window.electron.db.holdDocument({
      companyId,
      label,
      items: cart,
      totalAmount: grandTotal,
      orderNo,
      customerName: selectedCustomer?.name,
      cashierName: cashier.fullName,
      customer: selectedCustomer ?? null,
    })
    clearCart()
    void loadHeld()
  }

  async function retrieveDoc(doc: HeldDocRow) {
    setCart(doc.items.map(normalizeHeldCartItem))
    if (doc.customer) {
      applyCustomerSelection(doc.customer)
    } else {
      applyCustomerSelection(null)
    }
    if ((doc.discountRate ?? 0) > 0) {
      setDocDiscountRate(doc.discountRate!)
      setDocDiscMode('rate')
    } else if ((doc.discountAmount ?? 0) > 0) {
      setDocDiscountAmt(doc.discountAmount!)
      setDocDiscMode('amt')
    }
    setCurrentOrderNo(doc.orderNo ?? null)
    await window.electron.db.deleteHeldDocument(doc.id)
    void loadHeld()
    setShowHeld(false)
  }

  async function saveHeldLabel() {
    if (!heldEdit) return
    await window.electron.db.updateHeldDocumentLabel(heldEdit.id, heldEdit.label)
    setHeldEdit(null)
    void loadHeld()
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

  async function printIfTemplate(
    trigger: string,
    data: Record<string, Record<string, unknown>>,
  ) {
    try {
      const result = await window.electron.templates.printWithBehavior({
        triggerType: trigger,
        data,
      })
      if (result.needsSelection && result.templates?.length) {
        setPrintSelectModal({
          trigger,
          templates: result.templates,
          data:      result.data ?? data,
        })
      } else if (!result.success && result.message) {
        console.warn('[Fiş]', result.message)
      }
    } catch (e) {
      console.warn('[Şablon]', e)
    }
  }

  async function handleCariPayment() {
    if (!cariPaymentCust || !cariPaymentModal || !companyId) return
    const amount = parseFloat(cariPaymentAmt.replace(',', '.'))
    if (!amount || amount <= 0) return

    setCariPaymentSaving(true)
    setCariPaymentResult(null)

    const terminalName = posSettings.source?.trim() || 'Kasa'
    const customerIdNum = Number.parseInt(cariPaymentCust.id, 10) || 0

    try {
      const res = await fetch(`${API_URL}/integration/cari-payment/${companyId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          process_type:  cariPaymentModal === 'tahsilat' ? 1 : 2,
          amount,
          customer_id:   customerIdNum,
          customer_code: cariPaymentCust.code ?? '',
          customer_name: cariPaymentCust.name ?? '',
          cashier_name:  cashier.fullName,
          terminal_name: terminalName,
          description:   cariPaymentDesc.trim(),
          payment_date:  new Date().toISOString().replace('T', ' ').slice(0, 19),
        }),
      })
      const data = await res.json() as { success?: boolean; message?: string; label?: string }

      if (res.ok && data.success) {
        const paymentDesc = cariPaymentDesc.trim()
        setCariPaymentResult({
          ok:  true,
          msg: `${cariPaymentModal === 'tahsilat' ? 'Tahsilat' : 'Ödeme'} başarıyla kaydedildi. Tutar: ${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`,
        })
        setCariPaymentAmt('')
        setCariPaymentDesc('')

        await window.electron.db.saveCariPayment({
          id:           crypto.randomUUID(),
          companyId,
          type:         cariPaymentModal,
          amount,
          customerId:   cariPaymentCust.id,
          customerName: cariPaymentCust.name,
          customerCode: cariPaymentCust.code ?? '',
          cashierId:    cashier.id,
          cashierName:  cashier.fullName,
          description:  paymentDesc || undefined,
          createdAt:    new Date().toISOString(),
        })

        void printIfTemplate(cariPaymentModal, {
          sale_payments: {
            amount,
            method:     'cash',
            created_at: new Date().toISOString(),
          },
          customers: {
            name: cariPaymentCust.name,
            code: cariPaymentCust.code ?? '',
          },
          cashiers:  { full_name: cashier.fullName },
          terminals: { name: terminalName ?? 'Kasa' },
        })
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
    if (!customerDisplay) return

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
  }, [cart, customerDisplay, docDiscountCalc, grandTotal, lineSubtotal, toplamIndirim, totalQty])

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
    const terminalLabel = posSettings.source?.trim() || 'Kasa'
    const orderNo = currentOrderNo
      ?? nextOrderNo(posSettings.terminalNumber)
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

        const smsNorm = normalizeTrMobileForSms(smsPhone)

        if (mailAddr.trim() && !isValidNotifyEmail(mailAddr)) {
          showError('E-posta bildirimi', 'Geçerli bir e-posta girin veya adresi temizleyin.')
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
            sendSms: smsNorm.length === SMS_MOBILE_LEN,
            smsPhone: smsNorm || '',
            sendEmail: isValidNotifyEmail(mailAddr),
            mailAddr: mailAddr.trim(),
          },
        )

        if (!deviceResult.success) {
          showError('Ödeme Hatası', deviceResult.message ?? 'Pavo hatası')
          return
        }
      } catch (e) {
        showError('Pavo Bağlantı Hatası', String(e))
        return
      } finally {
        setPavoLoading(false)
      }
    }

      const pavoData = deviceResult?.raw?.Data as Record<string, unknown> | undefined
      const printOrderNo = String(pavoData?.OrderNo ?? orderNo)

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
        orderNo: printOrderNo,
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
      const { saleId, receiptNo } = await window.electron.db.saveSale(saleRow, cart.map(c => ({
        productId: c.productId,
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
        }, printOrderNo)
      }

      const terminalId = await window.electron.store.get('terminal_id') as string | null
      const paymentLabel =
        salePaymentType === 'mixed' ? 'Karma'
          : salePaymentType === 'cash' ? 'Nakit' : 'Kart'
      const firstCardPayment = paymentRows.find(p => p.method === 'card')
      const cashGiven = cashPayments.reduce(
        (s, p) => s + Number(p.CashPayment?.GivenAmount ?? p.PaymentAmount ?? 0),
        0,
      )
      const changeAmount = Math.max(0, parseFloat((cashGiven - actualCashAmt).toFixed(2)))

      void printIfTemplate('satis', buildSaleReceiptData({
        receiptNo,
        orderNo: printOrderNo,
        companyId,
        cashier: { id: cashier.id, fullName: cashier.fullName },
        cart,
        paymentType: salePaymentType,
        paymentLabel,
        cashAmount: cashAmt,
        cardAmount: cardAmt,
        paidAmount: paidAmt,
        docDiscountRate: docDiscountRate,
        docDiscountAmount: docDiscountCalc,
        customer: selectedCustomer,
        terminalId: terminalId ?? '',
        terminalName: terminalLabel,
        terminalNumber: posSettings.terminalNumber,
        workplace: {
          name: posSettings.workplaceName,
          address: posSettings.workplaceAddress,
          phone: posSettings.workplacePhone,
          city: posSettings.workplaceCity,
          district: posSettings.workplaceDistrict,
          taxOffice: posSettings.workplaceTaxOffice,
          taxNo: posSettings.workplaceTaxNo,
        },
        planName: license?.planName ?? '',
        changeAmount,
        paymentLines: paymentRows,
        firstCardAcquirerName: firstCardPayment?.acquirerName ?? '',
      }))

      setPaymentMode(false)
      setPaymentLines([])
      setActiveMethod(null)
      setPendingAmount('')
      clearCart()
      setLastReceipt(printOrderNo)
      searchRef.current?.focus()
    } catch (e) {
      showError('Satış Kaydedilemedi', e instanceof Error ? e.message : 'Bilinmeyen hata')
    } finally {
      setSaving(false)
    }
  }

  async function searchReturnableSale(query: string, searchBy: 'order' | 'sale' = 'order') {
    if (!query.trim()) return
    setQuickReturnLoading(true)
    setQuickReturnError(null)

    try {
      const res = await window.electron.pavo.getReturnableSale({
        searchBy,
        query: query.trim(),
      })

      if (!res.success || !res.data) {
        setQuickReturnError(res.message ?? 'Satış bulunamadı')
        return
      }

      const sale = mapRawReturnableSale(res.data)

      if (sale.CustomerInfo && (
        sale.CustomerInfo.CompanyName ||
        sale.CustomerInfo.TaxNumber ||
        sale.CustomerInfo.FirstName
      )) {
        setQuickReturnError(
          'Bu satış cari hesaba ait. İade için karşı tarafın iade faturası düzenlemesi gerekir.',
        )
        return
      }

      const selected: Record<number, number> = {}
      for (const item of sale.Items) {
        if (item.ReturnableQuantity > 0) {
          selected[item.Id] = item.ReturnableQuantity
        }
      }

      const selectedPayments = recalcPayments(sale, selected, {})

      setQuickReturnModal({
        step:             'review',
        searchBy,
        saleNumber:       query.trim(),
        saleData:         sale,
        selected,
        selectedPayments,
      })
    } catch (e) {
      setQuickReturnError('Bağlantı hatası: ' + String(e))
    } finally {
      setQuickReturnLoading(false)
    }
  }

  async function loadRecentSales(filters: RecentSalesFilter) {
    setQuickReturnLoading(true)
    setQuickReturnError(null)
    try {
      const list = await window.electron.db.getRecentSales({
        limit:    20,
        dateFrom: filters.dateFrom || undefined,
        dateTo:   filters.dateTo   || undefined,
        timeFrom: filters.timeFrom || undefined,
        timeTo:   filters.timeTo   || undefined,
      })
      setQuickReturnModal(m => m ? {
        ...m,
        step: 'recent',
        recentSales: list,
        recentFilters: filters,
      } : m)
    } catch (e) {
      setQuickReturnError('Liste yüklenemedi: ' + String(e))
    } finally {
      setQuickReturnLoading(false)
    }
  }

  function openRecentSales() {
    const today = new Date().toISOString().slice(0, 10)
    const filters: RecentSalesFilter = {
      dateFrom: today,
      dateTo:   today,
      timeFrom: '',
      timeTo:   '',
    }
    setQuickReturnModal(m => m ? { ...m, step: 'recent', recentFilters: filters } : {
      step: 'recent',
      searchBy: 'order',
      saleNumber: '',
      selected: {},
      selectedPayments: {},
      recentFilters: filters,
    })
    void loadRecentSales(filters)
  }

  function handlePaymentAmountChange(paymentId: number, amount: number) {
    setQuickReturnModal(m => {
      if (!m || !m.saleData) return m

      const totalReturn = m.saleData.Items.reduce((sum, item) => {
        const qty = m.selected[item.Id] ?? 0
        return sum + qty * item.UnitPrice
      }, 0)

      const payments = m.saleData.Payments.filter(p => p.ReturnableAmount > 0)
      const thisPayment = payments.find(p => p.PaymentId === paymentId)
      const clamped = Math.min(amount, thisPayment?.ReturnableAmount ?? amount)

      const others = payments
        .filter(p => p.PaymentId !== paymentId)
        .sort((a, b) => a.ReturnableAmount - b.ReturnableAmount)
      const remaining = Math.round((totalReturn - clamped) * 100) / 100

      const newPayments: Record<number, number> = { [paymentId]: clamped }

      let leftover = remaining
      others.forEach((p, i) => {
        if (i === others.length - 1) {
          newPayments[p.PaymentId] = Math.max(0, Math.min(
            p.ReturnableAmount,
            Math.round(leftover * 100) / 100,
          ))
        } else {
          const share = Math.min(p.ReturnableAmount, Math.round(leftover * 100) / 100)
          newPayments[p.PaymentId] = Math.max(0, share)
          leftover = Math.round((leftover - share) * 100) / 100
        }
      })

      const allocated = Object.values(newPayments).reduce((s, v) => s + v, 0)
      if (Math.abs(allocated - totalReturn) > 0.01) {
        const shortfall = Math.round((totalReturn - allocated) * 100) / 100
        setQuickReturnError(
          `Ödeme kapasitesi yetersiz: ${shortfall.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ dağıtılamadı.`,
        )
      } else {
        setQuickReturnError(null)
      }

      return { ...m, selectedPayments: newPayments }
    })
  }

  function openPaymentNumpad(paymentId: number, max: number, current: number) {
    setPaymentNumpad({
      paymentId,
      max,
      value: formatPaymentNumpadValue(current),
    })
  }

  function handlePaymentNumpadKey(k: string) {
    setPaymentNumpad(prev => {
      if (!prev) return prev
      const v = prev.value

      if (k === '⌫') {
        return { ...prev, value: v.slice(0, -1) }
      }

      if (k === ',') {
        if (v.includes(',')) return prev
        return { ...prev, value: v === '' ? '0,' : v + ',' }
      }

      if (v.includes(',')) {
        const dec = v.split(',')[1] ?? ''
        if (dec.length >= 2) return prev
      }

      const next = (v === '' || v === '0') ? k : v + k
      const num  = parseFloat(next.replace(',', '.')) || 0

      if (num > prev.max) {
        const single = parseFloat(k) || 0
        if (single <= prev.max) return { ...prev, value: k }
        return prev
      }

      return { ...prev, value: next }
    })
  }

  function handleToggleItem(itemId: number, returnableQty: number, checked: boolean) {
    setQuickReturnModal(m => {
      if (!m || !m.saleData) return m
      const next = { ...m.selected }
      if (checked) next[itemId] = returnableQty
      else delete next[itemId]

      const selectedPayments = recalcPayments(m.saleData, next, m.selectedPayments ?? {})
      return { ...m, selected: next, selectedPayments }
    })
  }

  function handleQtyChange(itemId: number, delta: -1 | 1, maxQty: number) {
    setQuickReturnModal(m => {
      if (!m || !m.saleData) return m
      const cur  = m.selected[itemId] ?? 0
      const next = { ...m.selected, [itemId]: Math.min(maxQty, Math.max(1, cur + delta)) }
      const selectedPayments = recalcPayments(m.saleData, next, m.selectedPayments ?? {})
      return { ...m, selected: next, selectedPayments }
    })
  }

  async function confirmQuickReturn() {
    if (!quickReturnModal?.saleData) return
    const sale     = quickReturnModal.saleData
    const selected = quickReturnModal.selected

    setQuickReturnLoading(true)
    setQuickReturnError(null)

    try {
      const addedSaleItems = sale.Items
        .filter((item: ReturnableSaleItem) => (selected[item.Id] ?? 0) > 0)
        .map((item: ReturnableSaleItem) => {
          const qty       = selected[item.Id]
          const total     = Math.round(qty * item.UnitPrice * 100) / 100
          const vatAmount = Math.round(total * (item.VatRate ?? 20) / (100 + (item.VatRate ?? 20)) * 100) / 100
          return {
            relatedSaleItemId: item.Id,
            name:              item.ProductName,
            itemQuantity:      qty,
            unitPriceAmount:   item.UnitPrice,
            grossPriceAmount:  item.UnitPrice,
            totalPriceAmount:  total,
            vatAmount,
            vatRate:           item.VatRate ?? 20,
            unitName:          item.UnitName ?? 'Adet',
            taxGroupId:        item.TaxGroupId ?? 74,
            convertedTotal:    total,
            returnAmount:      total,
          }
        })

      const totalReturn = addedSaleItems.reduce((s, i) => s + i.totalPriceAmount, 0)

      const selectedPayments = quickReturnModal.selectedPayments ?? {}

      const paymentInformations = sale.Payments
        .map((p: ReturnablePayment) => {
          const amount = selectedPayments[p.PaymentId] ?? 0
          return {
            mediator: p.Mediator,
            amount:   Math.round(amount * 100) / 100,
            isVoid:   false,
          }
        })
        .filter(p => p.amount > 0)

      const paymentTotal = paymentInformations.reduce((s, p) => s + p.amount, 0)
      if (Math.abs(paymentTotal - totalReturn) > 0.01) {
        setQuickReturnError(
          `Ödeme toplamı (${paymentTotal.toFixed(2)} ₺) iade tutarıyla (${totalReturn.toFixed(2)} ₺) eşleşmiyor.`,
        )
        return
      }

      const res = await window.electron.pavo.partialReturn({
        relatedSaleId:       sale.Id,
        addedSaleItems,
        paymentInformations,
        receiptWidth:        pavoSettings?.printWidth,
      })

      if (!res.success) {
        setQuickReturnError(res.message ?? 'İade işlemi başarısız')
        return
      }

      const logoItems = await Promise.all(
        sale.Items
          .filter((item: ReturnableSaleItem) => (selected[item.Id] ?? 0) > 0)
          .map(async (item: ReturnableSaleItem) => {
            const qty = selected[item.Id] ?? 0

            const product = await window.electron.db.getProductByName(item.ProductName)
            if (!product) {
              console.warn('[iade] ürün bulunamadı:', item.ProductName)
            }

            const unitName = product?.unit ?? 'Adet'
            const unitCode = await window.electron.db.getUnitPavoCode(unitName)

            return {
              productCode: product?.code ?? '',
              productName: product?.name ?? item.ProductName,
              quantity:    qty,
              unitPrice:   item.UnitPrice,
              vatRate:     product?.vatRate ?? 20,
              unitName,
              unitCode,
            }
          }),
      )

      const notFound = logoItems.filter(i => !i.productCode?.trim())
      if (notFound.length > 0) {
        console.warn('[iade] eşleşmeyen ürünler:', notFound.map(i => i.productName))
      }

      console.log('[iade] pavo items:', sale.Items.length, 'logo items:', logoItems.length)

      const cashReturn = paymentInformations
        .filter(p => p.mediator === 0 || p.mediator === 1)
        .reduce((s, p) => s + p.amount, 0)
      const cardReturn = paymentInformations
        .filter(p => p.mediator !== 0 && p.mediator !== 1)
        .reduce((s, p) => s + p.amount, 0)

      const orderNo = nextOrderNo(posSettings.terminalNumber)
      const saleRow = {
        orderNo,
        totalAmount:    totalReturn,
        discountRate:   0,
        discountAmount: 0,
        netAmount:      totalReturn,
        paymentType:    cardReturn > 0 && cashReturn > 0 ? 'mixed' as const
                      : cardReturn > 0 ? 'card' as const
                      : 'cash' as const,
        cashAmount:     cashReturn,
        cardAmount:     cardReturn,
        cardAcquirerId: null,
        cashierId:      cashier.id,
        cashierName:    cashier.fullName,
        customerId:     null,
        customerName:   null,
        customerCode:   null,
        isReturn:       true,
      }

      const items = sale.Items
        .filter((item: ReturnableSaleItem) => (selected[item.Id] ?? 0) > 0)
        .map((item: ReturnableSaleItem) => {
          const qty = selected[item.Id] ?? 0
          const lineTotal = Math.round(qty * item.UnitPrice * 100) / 100
          return {
            productCode:    '',
            productName:    item.ProductName,
            quantity:       -qty,
            unitPrice:      item.UnitPrice,
            vatRate:        item.VatRate ?? 20,
            discountRate:   0,
            discountAmount: 0,
            lineTotal,
          }
        })

      const { saleId, receiptNo } = await window.electron.db.saveSale(saleRow, items, undefined)

      if (companyId) {
        try {
          const settings = await window.electron.db.getPosSettings()
          const queueInvoiceType: 'e_archive' | 'paper' =
            settings?.invoiceType === 'paper' ? 'paper' : 'e_archive'

          const { enqueueQuickReturnInvoice } = await import('../lib/invoiceSend')

          await enqueueQuickReturnInvoice(companyId, {
            receiptNo,
            orderNo,
            totalReturn,
            invoiceType: queueInvoiceType,
            cashAmount:  cashReturn,
            cardAmount:  cardReturn,
            items:       logoItems,
          })
          console.log('[hızlı iade] Logo iade faturası kuyruğa eklendi')
        } catch (e) {
          console.warn('[hızlı iade] Logo kuyruğa eklenemedi:', e)
        }
      }

      showSuccess(
        'İade Tamamlandı',
        `İade tamamlandı: ${totalReturn.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`,
      )
      setQuickReturnModal(null)
      setQuickReturnError(null)
    } catch (e) {
      setQuickReturnError('İade hatası: ' + String(e))
    } finally {
      setQuickReturnLoading(false)
    }
  }

  async function completeReturn(forcedLines?: PaymentLine[]) {
    const lines = forcedLines ?? paymentLines
    if (!cart.length || lines.length === 0) return
    setSaving(true)

    try {
      const cashAmt = lines.filter(l => l.method === 'cash').reduce((s, l) => s + l.amount, 0)
      const cardAmt = lines.filter(l => l.method !== 'cash').reduce((s, l) => s + l.amount, 0)

      if (cardAmt > 0 && pavoSettings) {
        showInfo('Bilgi', 'Kart iadesi için Pavo entegrasyonu bir sonraki adımda gelecek.')
        return
      }

      const invoiceCustomer = selectedCustomer ?? await resolveTorbaCustomer(companyId)
      const terminalLabel = posSettings.source?.trim() || 'Kasa'
      const orderNo = currentOrderNo
        ?? nextOrderNo(posSettings.terminalNumber)
      const salePaymentType: 'cash' | 'card' | 'mixed' =
        cashAmt > 0 && cardAmt > 0 ? 'mixed' : cashAmt > 0 ? 'cash' : 'card'
      const saleRow = {
        orderNo,
        totalAmount: lineSubtotal,
        discountRate: docDiscountRate,
        discountAmount: docDiscountCalc,
        netAmount: grandTotal,
        paymentType: salePaymentType,
        cashAmount: cashAmt,
        cardAmount: cardAmt,
        cardAcquirerId: null,
        cashierId: cashier.id,
        cashierName: cashier.fullName,
        customerId:   invoiceCustomer.id   || null,
        customerName: invoiceCustomer.name ?? null,
        customerCode: invoiceCustomer.code ?? null,
        isReturn: true,
      }

      const { saleId, receiptNo } = await window.electron.db.saveSale(saleRow, cart.map(c => ({
        productId: c.productId,
        productCode: c.code,
        productName: c.name,
        quantity: -Math.abs(c.quantity),
        unitPrice: c.price,
        vatRate: c.vatRate,
        discountRate: c.discountRate,
        discountAmount: c.discountAmount,
        lineTotal: c.netTotal,
        appliedBy: cashier.id,
      })), undefined)

      if (companyId) {
        try {
          const { sendReturnInvoice, resolveTorbaCustomer } = await import('../lib/invoiceSend')
          const settings = await window.electron.db.getPosSettings()
          const queueInvoiceType: 'e_archive' | 'paper' =
            settings?.invoiceType === 'paper' ? 'paper' : 'e_archive'

          const customer = selectedCustomer ?? await resolveTorbaCustomer(companyId)

          await sendReturnInvoice(
            companyId,
            saleId,
            customer,
            queueInvoiceType,
            {
              cashAmount: cashAmt,
              cardAmount: cardAmt,
            },
            orderNo,
          )
          console.log('[normal iade] Logo iade faturası kuyruğa eklendi')
        } catch (e) {
          console.warn('[normal iade] Logo iade faturası kuyruğa eklenemedi:', e)
        }
      }

      const terminalLabelIade = posSettings.source?.trim() || 'Kasa'
      void printIfTemplate('iade', buildSaleReceiptData({
        receiptNo,
        orderNo,
        companyId,
        cashier: { id: cashier.id, fullName: cashier.fullName },
        cart,
        paymentType: salePaymentType,
        paymentLabel: salePaymentType === 'cash' ? 'Nakit İade' : salePaymentType === 'card' ? 'Kart İade' : 'Karma İade',
        cashAmount: cashAmt,
        cardAmount: cardAmt,
        paidAmount: cashAmt + cardAmt,
        docDiscountRate: docDiscountRate,
        docDiscountAmount: docDiscountCalc,
        customer: invoiceCustomer,
        terminalId: (await window.electron.store.get('terminal_id') as string | null) ?? '',
        terminalName: terminalLabelIade,
        terminalNumber: posSettings.terminalNumber,
        workplace: {
          name: posSettings.workplaceName,
          address: posSettings.workplaceAddress,
          phone: posSettings.workplacePhone,
          city: posSettings.workplaceCity,
          district: posSettings.workplaceDistrict,
          taxOffice: posSettings.workplaceTaxOffice,
          taxNo: posSettings.workplaceTaxNo,
        },
        planName: license?.planName ?? '',
        changeAmount: 0,
        paymentLines: lines.map(l => ({
          method: l.method,
          amount: l.amount,
          acquirerName: l.acquirerName,
        })),
        firstCardAcquirerName: '',
      }))

      setReturnMode(false)
      clearCart()
      setPaymentLines([])
      setPaymentMode(false)
      setActiveMethod(null)
      setPendingAmount('')
      setLastReceipt(orderNo)
      searchRef.current?.focus()
    } catch (e) {
      showError('İade Kaydedilemedi', e instanceof Error ? e.message : 'Bilinmeyen hata')
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
        @keyframes pulse-yellow {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.7; }
        }
        @keyframes pulse-red {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.85; transform: scale(1.03); }
        }
      `}</style>

      {/* Lisans banner */}
      {license?.warning && <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />}

      {/* ── HEADER ── */}
      <div style={{
        background: '#030712',
        borderBottom: '1px solid #1f2937',
        height: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        flexShrink: 0,
        position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AppLogo height={28} />
          <button
            type="button"
            onClick={onBack}
            style={{
              background: '#1f2937',
              border: '1px solid #374151',
              borderRadius: 6,
              color: '#e5e7eb',
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            ← Dashboard
          </button>
          {heldDocs.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHeld(true)}
              style={{
                display:        'flex',
                alignItems:     'center',
                gap:            6,
                padding:        '4px 10px',
                borderRadius:   8,
                border:         'none',
                cursor:         'pointer',
                fontSize:       11,
                fontWeight:     700,
                transition:     'all 0.2s',
                ...(heldDocs.length >= MAX_HELD_DOCS ? {
                  background: '#C62828',
                  color:      'white',
                  animation:  'pulse-red 0.8s infinite',
                  boxShadow:  '0 0 0 2px rgba(198,40,40,0.3)',
                } : heldDocs.length <= 3 ? {
                  background: '#E8F5E9',
                  color:      '#2E7D32',
                } : heldDocs.length <= 6 ? {
                  background: '#FFF8E1',
                  color:      '#F57F17',
                  animation:  'pulse-yellow 2s infinite',
                } : {
                  background: '#FFEBEE',
                  color:      '#C62828',
                  animation:  'pulse-red 1s infinite',
                }),
              }}
            >
              <span style={{ fontSize: 14 }}>
                {heldDocs.length >= MAX_HELD_DOCS ? '🚨' : heldDocs.length <= 3 ? '📂' : heldDocs.length <= 6 ? '⚠️' : '🚨'}
              </span>
              <span>
                {heldDocs.length >= MAX_HELD_DOCS
                  ? `Belge limiti doldu! `
                  : heldDocs.length <= 3
                    ? `${heldDocs.length} Bekleyen Belge`
                    : heldDocs.length <= 6
                      ? `${heldDocs.length} Bekleyen Belge!`
                      : `${heldDocs.length} Bekleyen Belge — dolmak üzere!`}
              </span>
              <span style={{
                background: heldDocs.length >= MAX_HELD_DOCS ? 'white'
                  : heldDocs.length <= 3 ? '#2E7D32'
                    : heldDocs.length <= 6 ? '#F57F17'
                      : '#C62828',
                color: heldDocs.length >= MAX_HELD_DOCS ? '#C62828' : 'white',
                borderRadius: '50%',
                width:        18,
                height:       18,
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'center',
                fontSize:     10,
                fontWeight:   800,
                flexShrink:   0,
              }}>
                {heldDocs.length}
              </span>
            </button>
          )}
          {currentOrderNo && cart.length > 0 && (
            <span style={{ background: '#EFF6FF', color: '#1565C0', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 600 }}>
              # {currentOrderNo}
            </span>
          )}
          {lastReceipt && cart.length === 0 && (
            <span style={{ background: '#E8F5E9', color: '#2E7D32', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 500 }}>
              ✓ {lastReceipt}
            </span>
          )}
          {selectedCustomer && (
            <span style={{
              background: '#1f2937',
              color: '#e5e7eb',
              border: '1px solid #374151',
              borderRadius: 6,
              padding: '3px 8px',
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              👤 {selectedCustomer.name}
              <button type="button" onClick={() => applyCustomerSelection(null)} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
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
          <div style={{
            fontSize:      13,
            fontWeight:    600,
            color:         '#e5e7eb',
            fontFamily:    'monospace',
            letterSpacing: 1,
          }}>
            {clock}
          </div>
          <span style={{
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 6,
            padding: '3px 8px',
            color: '#d1d5db',
            fontSize: 11,
          }}>
            {cashier.fullName}
          </span>
          <button
            type="button"
            onClick={onLogout}
            style={{
              background: 'rgba(127, 29, 29, 0.45)',
              border: '1px solid #7f1d1d',
              borderRadius: 6,
              color: '#fecaca',
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

      {priceEditTarget && (() => {
        const targetItem = cart.find(c => c.id === priceEditTarget)
        return (
          <div style={{
            position:       'fixed',
            inset:          0,
            zIndex:         9998,
            background:     'rgba(0,0,0,0.5)',
            display:        'flex',
            alignItems:     'flex-end',
            justifyContent: 'center',
          }}>
            <div style={{
              background:   'white',
              borderRadius: '16px 16px 0 0',
              padding:      '20px 16px 32px',
              width:        '100%',
              maxWidth:     420,
            }}>
              <div style={{
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'center',
                marginBottom:   12,
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Birim Fiyat</div>
                  <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                    {targetItem?.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setPriceEditTarget(null); setPriceEditInput('') }}
                  style={{ background: 'none', border: 'none', fontSize: 20, color: '#9CA3AF', cursor: 'pointer' }}
                >✕</button>
              </div>

              <div style={{
                display:        'flex',
                justifyContent: 'space-between',
                padding:        '8px 12px',
                borderRadius:   8,
                background:     '#F9FAFB',
                marginBottom:   12,
                fontSize:       12,
                color:          '#6B7280',
              }}>
                <span>Mevcut fiyat</span>
                <span style={{ fontWeight: 700, color: '#374151' }}>
                  {fmt(targetItem?.price ?? 0)}
                </span>
              </div>

              <div style={{
                textAlign:   'center',
                padding:     '12px 0',
                fontSize:    32,
                fontWeight:  700,
                color:       '#1565C0',
                letterSpacing: 2,
                minHeight:   56,
              }}>
                {priceEditInput || '0'} ₺
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      if (k === '⌫') {
                        setPriceEditInput(v => v.slice(0, -1))
                        return
                      }
                      if (k === ',') {
                        setPriceEditInput(v => {
                          if (v.includes(',')) return v
                          return v === '' ? '0,' : v + ','
                        })
                        return
                      }
                      setPriceEditInput(v => {
                        if (v.includes(',') && (v.split(',')[1] ?? '').length >= 2) return v
                        if (v.replace(',', '').length >= 8) return v
                        return v + k
                      })
                    }}
                    style={{
                      padding:        '14px 0',
                      borderRadius:   10,
                      border:         '1px solid #E5E7EB',
                      background:     k === '⌫' ? '#FEF2F2' : '#F9FAFB',
                      fontSize:       18,
                      fontWeight:     600,
                      color:          k === '⌫' ? '#EF4444' : '#111827',
                      cursor:         'pointer',
                    }}
                  >{k}</button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setPriceEditInput('')}
                  style={{
                    padding:      '14px',
                    borderRadius: 10,
                    border:       '1px solid #E0E0E0',
                    background:   '#F5F5F5',
                    fontSize:     15,
                    fontWeight:   600,
                    color:        '#374151',
                    cursor:       'pointer',
                  }}
                >C</button>
                <button
                  type="button"
                  onClick={applyPriceEdit}
                  style={{
                    padding:      '14px',
                    borderRadius: 10,
                    border:       'none',
                    background:   '#1565C0',
                    fontSize:     15,
                    fontWeight:   700,
                    color:        'white',
                    cursor:       'pointer',
                  }}
                >Uygula</button>
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
                      showError('İndirim Limiti', `Maksimum belge indirimi %${maxPct}`)
                      return
                    }
                    setDocDiscountRate(val)
                    setDocDiscountAmt(0)
                  } else {
                    const maxPct = posSettings.maxDocDiscountPct ?? 100
                    if (lineSubtotal > 0) {
                      const effectivePct = (val / lineSubtotal) * 100
                      if (effectivePct > maxPct) {
                        showError('İndirim Limiti', `Bu tutar %${effectivePct.toFixed(1)} indirime karşılık geliyor. Maksimum belge indirimi %${maxPct}`)
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
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'white', borderRadius: 16, padding: '20px 16px 24px',
            width: 'min(360px, 94vw)',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>SMS Bildirimi</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                  5 ile başlayan 10 hane
                </div>
              </div>
              <button type="button" onClick={() => setSmsPhonePanelOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20,
                  color: '#9CA3AF', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{
              textAlign: 'center', padding: '10px 0',
              fontSize: 26, fontWeight: 700, color: '#1565C0',
              letterSpacing: 0.5, minHeight: 48, wordBreak: 'break-all',
            }}>
              {formatTrMobileSmsDisplay(smsPhoneDraft) || '—'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(k => {
                const firstEmpty = smsPhoneDraft.replace(/\D/g, '').length === 0
                const disabledFirst = firstEmpty && k !== '5'
                return (
                  <button key={k} type="button" disabled={disabledFirst}
                    onClick={() => {
                      if (!disabledFirst) setSmsPhoneDraft(p => appendTrMobileSmsDigit(p, k))
                    }}
                    style={{ padding: '14px 0', borderRadius: 10,
                      border: '1px solid #E5E7EB', background: '#F9FAFB',
                      fontSize: 18, fontWeight: 600, color: '#111827',
                      cursor: disabledFirst ? 'default' : 'pointer',
                      opacity: disabledFirst ? 0.38 : 1 }}>
                    {k}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <button type="button" onClick={() => setSmsPhoneDraft('')}
                style={{ padding: '14px 0', borderRadius: 10, border: '1px solid #E5E7EB',
                  background: '#F5F5F5', fontSize: 15, fontWeight: 600,
                  color: '#374151', cursor: 'pointer' }}>
                C
              </button>
              <button type="button"
                disabled={smsPhoneDraft.replace(/\D/g, '').length === 0}
                onClick={() => setSmsPhoneDraft(p => appendTrMobileSmsDigit(p, '0'))}
                style={{ padding: '14px 0', borderRadius: 10,
                  border: '1px solid #E5E7EB', background: '#F9FAFB',
                  fontSize: 18, fontWeight: 600, color: '#111827', cursor: 'pointer',
                  opacity: smsPhoneDraft.replace(/\D/g, '').length === 0 ? 0.38 : 1 }}>
                0
              </button>
              <button type="button"
                onClick={() => setSmsPhoneDraft(p => p.replace(/\D/g, '').slice(0, -1))}
                style={{ padding: '14px 0', borderRadius: 10,
                  border: '1px solid #E5E7EB', background: '#FEF2F2',
                  fontSize: 18, fontWeight: 600, color: '#EF4444', cursor: 'pointer' }}>
                ⌫
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 4 }}>
              <button type="button"
                onClick={() => {
                  setSmsPhone('')
                  setSmsPhoneDraft('')
                  setSmsPhonePanelOpen(false)
                }}
                style={{ padding: '14px', borderRadius: 10,
                  border: '1px solid #E0E0E0', background: '#F5F5F5',
                  fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                Gönderme
              </button>
              <button type="button"
                onClick={() => {
                  const digits = normalizeTrMobileForSms(smsPhoneDraft)
                  if (digits.length !== SMS_MOBILE_LEN) {
                    showError('SMS', '5 ile başlayan 10 haneli numara girin.')
                    return
                  }
                  setSmsPhone(digits)
                  setSmsPhonePanelOpen(false)
                }}
                style={{ padding: '14px', borderRadius: 10, border: 'none',
                  background: '#1565C0', fontSize: 15, fontWeight: 700,
                  color: 'white', cursor: 'pointer' }}>
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

      {mailModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'white', borderRadius: 16, padding: '20px 16px 24px',
            width: 'min(360px, 94vw)',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Mail Bildirimi</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                  ornek@mail.com
                </div>
              </div>
              <button type="button" onClick={() => setMailModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20,
                  color: '#9CA3AF', cursor: 'pointer' }}>✕</button>
            </div>

            <input
              type="email"
              value={mailAddr}
              onChange={e => setMailAddr(e.target.value)}
              placeholder="ornek@mail.com"
              autoFocus={!touchEnabled}
              readOnly={touchEnabled}
              onFocus={() => {
                if (!touchEnabled) return
                openKeyboard({
                  title: 'E-posta',
                  initial: mailAddr,
                  type: 'qwerty',
                  onConfirm: setMailAddr,
                })
              }}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 10,
                border: `1.5px solid ${mailAddr && isValidNotifyEmail(mailAddr) ? '#1565C0' : '#E5E7EB'}`,
                fontSize: 14, outline: 'none', boxSizing: 'border-box' as const,
                cursor: touchEnabled ? 'default' : 'text' }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 4 }}>
              <button type="button"
                onClick={() => {
                  setMailAddr('')
                  setMailModalOpen(false)
                }}
                style={{ padding: '14px', borderRadius: 10,
                  border: '1px solid #E0E0E0', background: '#F5F5F5',
                  fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                Gönderme
              </button>
              <button type="button"
                onClick={() => {
                  if (mailAddr.trim() && !isValidNotifyEmail(mailAddr)) {
                    showError('Mail', 'Geçerli bir e-posta adresi girin.')
                    return
                  }
                  setMailModalOpen(false)
                }}
                style={{ padding: '14px', borderRadius: 10, border: 'none',
                  background: '#1565C0', fontSize: 15, fontWeight: 700,
                  color: 'white', cursor: 'pointer' }}>
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

      {draftModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10002,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24,
            width: 'min(380px, 92vw)', display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div style={{ fontSize: 16, fontWeight: 700 }}>📂 Tamamlanmamış Satış</div>

            <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.5 }}>
              <strong>{draftModal.savedAt}</strong> tarihinde kaydedilmiş
              tamamlanmamış bir satış var.<br />
              <strong>{draftModal.cart.length} kalem</strong>
              {draftModal.customer ? `, müşteri: ${draftModal.customer.name}` : ''}.
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button"
                onClick={() => {
                  setCart(draftModal.cart.map(normalizeHeldCartItem))
                  if (draftModal.customer) applyCustomerSelection(draftModal.customer)
                  setDraftModal(null)
                }}
                style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                  background: '#1565C0', color: 'white', fontWeight: 700,
                  fontSize: 14, cursor: 'pointer' }}>
                Geri Yükle
              </button>
              <button type="button"
                onClick={() => {
                  void window.electron.cart.clearDraft()
                  setDraftModal(null)
                }}
                style={{ flex: 1, padding: '12px', borderRadius: 10,
                  border: '1px solid #E5E7EB', background: '#F9FAFB',
                  color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>
                Sil
              </button>
            </div>
          </div>
        </div>
      )}

      {scaleModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'white', borderRadius: 16, padding: 24,
            width: 'min(380px, 94vw)',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>⚖️ Terazi</div>
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                  {scaleModal.product.name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScaleModal(null)}
                style={{
                  background: 'none', border: 'none', fontSize: 20,
                  color: '#9CA3AF', cursor: 'pointer',
                }}
              >✕</button>
            </div>

            <div style={{
              background:   scaleModal.stable ? '#F0FDF4' : '#FFF8E1',
              border:       `2px solid ${scaleModal.stable ? '#86EFAC' : '#FDE68A'}`,
              borderRadius: 12, padding: '16px',
              textAlign:    'center',
            }}>
              <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>
                {scaleModal.stable ? '✓ Stabil' : '⟳ Ölçülüyor...'}
              </div>
              <div style={{
                fontSize:   42,
                fontWeight: 800,
                color:      scaleModal.stable ? '#15803D' : '#D97706',
                fontFamily: 'monospace',
                letterSpacing: 2,
              }}>
                {(scaleModal.weight / 1000).toFixed(3)}
                <span style={{ fontSize: 20, marginLeft: 6 }}>kg</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '8px 12px', borderRadius: 8,
                background: '#F9FAFB', border: '1px solid #E5E7EB',
              }}>
                <span style={{ fontSize: 12, color: '#6B7280' }}>Dara (Brüt Ağırlık)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    min={0}
                    value={scaleModal.tare / 1000}
                    onChange={e => setScaleModal(m => m ? {
                      ...m, tare: Math.round(parseFloat(e.target.value || '0') * 1000),
                    } : m)}
                    style={{
                      width: 70, padding: '4px 8px', borderRadius: 6,
                      border: '1px solid #E5E7EB', fontSize: 13,
                      textAlign: 'right',
                    }}
                  />
                  <span style={{ fontSize: 12, color: '#6B7280' }}>kg</span>
                </div>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '8px 12px', borderRadius: 8,
                background: '#EFF6FF', border: '1px solid #BFDBFE',
              }}>
                <span style={{ fontSize: 12, color: '#1D4ED8', fontWeight: 600 }}>Net Ağırlık</span>
                <span style={{
                  fontSize: 16, fontWeight: 800, color: '#1D4ED8', fontFamily: 'monospace',
                }}>
                  {(Math.max(0, scaleModal.weight - scaleModal.tare) / 1000).toFixed(3)} kg
                </span>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '8px 12px', borderRadius: 8,
                background: '#F9FAFB', border: '1px solid #E5E7EB',
              }}>
                <span style={{ fontSize: 12, color: '#6B7280' }}>Birim Fiyat (kg)</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>
                  {fmt(scaleModal.product.price)}
                </span>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '10px 12px', borderRadius: 8,
                background: '#111827', border: 'none',
              }}>
                <span style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>Tutar</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: 'white' }}>
                  {fmt(
                    Math.max(0, scaleModal.weight - scaleModal.tare) / 1000 * scaleModal.product.price,
                  )}
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={!scaleModal.stable || scaleModal.weight <= scaleModal.tare}
              onClick={() => {
                const netGram = Math.max(0, scaleModal.weight - scaleModal.tare)
                const netKg   = Math.round(netGram) / 1000
                if (netKg <= 0) return

                const item: CartItem = {
                  id:             crypto.randomUUID(),
                  productId:      scaleModal.product.productId,
                  code:           scaleModal.product.code,
                  name:           scaleModal.product.name,
                  category:       scaleModal.product.category,
                  price:          scaleModal.product.price,
                  vatRate:        scaleModal.product.vatRate,
                  unit:           scaleModal.product.unit,
                  quantity:       netKg,
                  lineTotal:      Math.round(netKg * scaleModal.product.price * 100) / 100,
                  discountRate:   0,
                  discountAmount: 0,
                  netTotal:       Math.round(netKg * scaleModal.product.price * 100) / 100,
                  barcode:        scaleModal.product.barcode,
                }

                setCart(prev => [...prev, item])
                setScaleModal(null)
              }}
              style={{
                padding:      '14px',
                borderRadius: 10,
                border:       'none',
                background:   scaleModal.stable && scaleModal.weight > scaleModal.tare
                  ? '#15803D' : '#D1D5DB',
                color:        'white',
                fontSize:     15,
                fontWeight:   700,
                cursor:       scaleModal.stable && scaleModal.weight > scaleModal.tare
                  ? 'pointer' : 'default',
              }}
            >
              {!scaleModal.stable ? '⟳ Terazi stabil değil...' : '✓ Sepete Ekle'}
            </button>
          </div>
        </div>
      )}

      {quickReturnModal && (
        <QuickReturnModal
          modal={quickReturnModal}
          loading={quickReturnLoading}
          error={quickReturnError}
          onClose={() => { setQuickReturnModal(null); setQuickReturnError(null) }}
          onSaleNumberChange={saleNumber =>
            setQuickReturnModal(m => m ? { ...m, saleNumber } : m)
          }
          onSearchByChange={searchBy =>
            setQuickReturnModal(m => m ? { ...m, searchBy, saleNumber: '' } : m)
          }
          onSearch={(query, searchBy) => void searchReturnableSale(query, searchBy)}
          onShowRecent={() => openRecentSales()}
          onReloadRecent={filters => void loadRecentSales(filters)}
          onRecentFiltersChange={filters =>
            setQuickReturnModal(m => m ? { ...m, recentFilters: filters } : m)
          }
          onSelectRecent={(query, searchBy) => void searchReturnableSale(query, searchBy)}
          onBackFromRecent={() => {
            setQuickReturnModal(m => m ? {
              ...m, step: 'search', recentSales: undefined, recentFilters: undefined,
            } : m)
            setQuickReturnError(null)
          }}
          onBack={() => {
            setQuickReturnModal(m => m ? {
              ...m, step: 'search', saleData: undefined, selected: {}, selectedPayments: {},
            } : m)
            setQuickReturnError(null)
          }}
          onConfirm={() => void confirmQuickReturn()}
          onOpenPaymentNumpad={openPaymentNumpad}
          onSelectAll={() => {
            if (!quickReturnModal.saleData) return
            const all: Record<number, number> = {}
            for (const item of quickReturnModal.saleData.Items) {
              if (item.ReturnableQuantity > 0) all[item.Id] = item.ReturnableQuantity
            }
            setQuickReturnModal(m => m && m.saleData ? {
              ...m,
              selected: all,
              selectedPayments: recalcPayments(m.saleData, all, m.selectedPayments ?? {}),
            } : m)
          }}
          onClearAll={() => {
            setQuickReturnModal(m => m && m.saleData ? {
              ...m,
              selected: {},
              selectedPayments: recalcPayments(m.saleData, {}, m.selectedPayments ?? {}),
            } : m)
          }}
          onToggleItem={handleToggleItem}
          onQtyChange={handleQtyChange}
          touchEnabled={touchEnabled}
          onOpenKeyboard={({ title, initial, onConfirm }) => {
            openKeyboard({ title, initial, type: 'qwerty', onConfirm })
          }}
        />
      )}

      {paymentNumpad && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10002,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'white', borderRadius: 16, padding: 20,
            width: 'min(300px, 92vw)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>İade Tutarı</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>
              Maksimum: {paymentNumpad.max.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
            </div>

            <div style={{
              background:   '#F9FAFB',
              border:       '1.5px solid #E5E7EB',
              borderRadius: 10,
              padding:      '12px 14px',
              textAlign:    'right',
              fontSize:     24,
              fontWeight:   700,
              color:        '#111827',
              letterSpacing: 1,
              minHeight:    52,
            }}>
              {paymentNumpad.value === '' ? (
                <span style={{ color: '#9CA3AF' }}>0</span>
              ) : (
                paymentNumpad.value
              )} ₺
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
              {['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(k => (
                <button key={k} type="button"
                  onClick={() => handlePaymentNumpadKey(k)}
                  style={{
                    padding:        '13px 0',
                    borderRadius:   9,
                    border:         '1.5px solid #E5E7EB',
                    background:     k === '⌫' ? '#FEF2F2' : 'white',
                    color:          k === '⌫' ? '#DC2626' : '#111827',
                    fontSize:       18,
                    fontWeight:     600,
                    cursor:         'pointer',
                  }}>
                  {k}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button"
                onClick={() => setPaymentNumpad(null)}
                style={{
                  flex: 1, padding: '11px', borderRadius: 10,
                  border: '1px solid #E5E7EB', background: '#F9FAFB',
                  fontSize: 14, cursor: 'pointer', color: '#6B7280',
                }}>
                Vazgeç
              </button>
              <button type="button"
                onClick={() => {
                  if (!paymentNumpad) return
                  const amount = parseFloat(paymentNumpad.value.replace(',', '.')) || 0
                  const clamped = Math.min(paymentNumpad.max, Math.max(0, amount))
                  handlePaymentAmountChange(paymentNumpad.paymentId, clamped)
                  setPaymentNumpad(null)
                }}
                style={{
                  flex: 2, padding: '11px', borderRadius: 10,
                  border: 'none', background: '#1565C0',
                  color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}>
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog {...dialogProps} />

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
        <div
          style={{
            position:       'fixed',
            inset:          0,
            zIndex:         9998,
            background:     'rgba(0,0,0,0.4)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowHeld(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background:    'white',
              borderRadius:  18,
              width:         'min(560px, 96vw)',
              maxHeight:     '88vh',
              display:       'flex',
              flexDirection: 'column',
              overflow:      'hidden',
              boxShadow:     '0 12px 40px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{
              padding:        '16px 20px',
              borderBottom:   '1px solid #F3F4F6',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              flexShrink:     0,
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>
                  Bekletilen Belgeler
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                  {heldDocs.length} / {MAX_HELD_DOCS}
                  {heldDocs.length >= MAX_HELD_DOCS && (
                    <span style={{ color: '#DC2626', fontWeight: 600, marginLeft: 4 }}>
                      — limit doldu
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHeld(false)}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 20, color: '#9CA3AF',
                }}
              >✕</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {heldDocs.length === 0 ? (
                <div style={{
                  textAlign: 'center', padding: '48px 0',
                  color: '#9CA3AF', fontSize: 13,
                }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                  Bekletilen belge yok
                </div>
              ) : heldDocs.map((doc, idx) => (
                <div
                  key={doc.id}
                  style={{
                    background:   idx % 2 === 0 ? 'white' : '#F9FAFB',
                    borderBottom: '1px solid #F3F4F6',
                    padding:      '14px 20px',
                    display:      'flex',
                    gap:          14,
                    alignItems:   'center',
                  }}
                >
                  <div style={{
                    width:          28,
                    height:         28,
                    borderRadius:   7,
                    background:     idx % 2 === 0 ? '#F3F4F6' : 'white',
                    color:          '#6B7280',
                    fontSize:       11,
                    fontWeight:     700,
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                    flexShrink:     0,
                    border:         '1px solid #E5E7EB',
                  }}>
                    {idx + 1}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display:        'flex',
                      justifyContent: 'space-between',
                      alignItems:     'center',
                      marginBottom:   4,
                    }}>
                      <span style={{
                        fontSize:   13,
                        fontWeight: 700,
                        color:      '#111827',
                        fontFamily: 'monospace',
                      }}>
                        {doc.orderNo || (doc.receiptNo ? `#${doc.receiptNo}` : doc.id.slice(0, 8).toUpperCase())}
                      </span>
                      <span style={{
                        fontSize:   14,
                        fontWeight: 700,
                        color:      '#111827',
                      }}>
                        {fmt(doc.totalAmount ?? 0)}
                      </span>
                    </div>

                    <div style={{
                      fontSize:     12,
                      color:        '#374151',
                      fontWeight:   500,
                      overflow:     'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace:   'nowrap',
                      marginBottom: 3,
                    }}>
                      {doc.label || '—'}
                    </div>

                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                      {doc.items.length} kalem
                      {doc.customerName && ` · ${doc.customerName}`}
                      {doc.cashierName  && ` · ${doc.cashierName}`}
                      {' · '}{new Date(doc.createdAt).toLocaleTimeString('tr-TR', {
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => setHeldPreview(doc)}
                      style={{
                        padding:      '6px 10px',
                        borderRadius: 7,
                        border:       '1px solid #E5E7EB',
                        background:   idx % 2 === 0 ? '#F9FAFB' : 'white',
                        fontSize:     11,
                        fontWeight:   600,
                        color:        '#374151',
                        cursor:       'pointer',
                      }}
                    >🔍 İncele</button>

                    <button
                      type="button"
                      onClick={() => setHeldEdit({ id: doc.id, label: doc.label ?? '' })}
                      style={{
                        padding:      '6px 10px',
                        borderRadius: 7,
                        border:       '1px solid #E5E7EB',
                        background:   idx % 2 === 0 ? '#F9FAFB' : 'white',
                        fontSize:     11,
                        fontWeight:   600,
                        color:        '#374151',
                        cursor:       'pointer',
                      }}
                    >✏️ İsim</button>

                    <button
                      type="button"
                      onClick={() => void retrieveDoc(doc)}
                      style={{
                        padding:      '6px 14px',
                        borderRadius: 7,
                        border:       '1px solid #BFDBFE',
                        background:   '#EFF6FF',
                        fontSize:     11,
                        fontWeight:   700,
                        color:        '#1D4ED8',
                        cursor:       'pointer',
                      }}
                    >📂 Getir</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {heldPreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setHeldPreview(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 14, padding: 20,
              width: 'min(420px, 94vw)', maxHeight: '80vh',
              display: 'flex', flexDirection: 'column', gap: 12 }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {heldPreview.orderNo || (heldPreview.receiptNo ? `#${heldPreview.receiptNo}` : heldPreview.id.slice(0, 8).toUpperCase())}
                </div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>
                  {heldPreview.label ?? '—'}
                </div>
              </div>
              <button type="button" onClick={() => setHeldPreview(null)}
                style={{ background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 18, color: '#9CA3AF' }}>✕</button>
            </div>

            {heldPreview.customerName && (
              <div style={{ padding: '8px 12px', borderRadius: 8,
                background: '#F0F9FF', fontSize: 12, color: '#0369A1' }}>
                👤 {heldPreview.customerName}
              </div>
            )}

            <div style={{ overflowY: 'auto', flex: 1,
              display: 'flex', flexDirection: 'column', gap: 4 }}>
              {heldPreview.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '8px 10px', borderRadius: 8,
                  background: i % 2 === 0 ? '#F9FAFB' : 'white',
                  border: '1px solid #F3F4F6' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#111827',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                      {fmtQty(item.quantity)} {item.unit ?? 'Adet'} × {fmt(item.price)}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111827',
                    flexShrink: 0, marginLeft: 8 }}>
                    {fmt(item.netTotal ?? item.lineTotal ?? item.price * item.quantity)}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: 8,
              background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Toplam</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1565C0' }}>
                {fmt(heldPreview.totalAmount ?? 0)}
              </span>
            </div>

            <button type="button"
              onClick={() => {
                void retrieveDoc(heldPreview)
                setHeldPreview(null)
              }}
              style={{ padding: '12px', borderRadius: 10, border: 'none',
                background: '#1565C0', color: 'white', fontWeight: 700,
                fontSize: 14, cursor: 'pointer' }}>
              📂 Belgeyi Getir
            </button>
          </div>
        </div>
      )}

      {heldEdit && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setHeldEdit(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 14, padding: 24,
              width: 'min(360px, 94vw)', display: 'flex',
              flexDirection: 'column', gap: 14 }}>

            <div style={{ fontSize: 15, fontWeight: 700 }}>Belge İsmini Düzenle</div>

            <input
              autoFocus={!touchEnabled}
              readOnly={touchEnabled}
              value={heldEdit.label}
              onChange={e => setHeldEdit(prev => prev ? { ...prev, label: e.target.value } : prev)}
              onClick={() => {
                if (!touchEnabled) return
                openKeyboard({
                  title:    'Belge İsmi',
                  initial:  heldEdit?.label ?? '',
                  type:     'qwerty',
                  onConfirm: (v) => setHeldEdit(prev => prev ? { ...prev, label: v } : prev),
                })
              }}
              placeholder="Belge ismi (örn: Masa 3, Ali Bey)"
              style={{ padding: '12px 14px', borderRadius: 10,
                border: '1.5px solid #E5E7EB', fontSize: 14,
                outline: 'none', width: '100%', boxSizing: 'border-box' }}
              onKeyDown={e => { if (e.key === 'Enter') void saveHeldLabel() }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setHeldEdit(null)}
                style={{ flex: 1, padding: '11px', borderRadius: 10,
                  border: '1px solid #E5E7EB', background: '#F9FAFB',
                  fontSize: 14, cursor: 'pointer', color: '#6B7280' }}>
                Vazgeç
              </button>
              <button type="button" onClick={() => void saveHeldLabel()}
                style={{ flex: 1, padding: '11px', borderRadius: 10,
                  border: 'none', background: '#1565C0', color: 'white',
                  fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Kaydet
              </button>
            </div>
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
              autoFocus={!touchEnabled}
              value={customerQ}
              readOnly={touchEnabled}
              onClick={() => openKeyboard({
                title:     'Müşteri ara',
                initial:   customerQ,
                type:      'qwerty',
                onSearch:  async (q) => {
                  const all = await window.electron.db.getCustomers(companyId)
                  return rankCustomers(all, q)
                },
                onSelectResult: (c) => {
                  selectCustomer(c)
                  setCustomerQ('')
                },
                onConfirm: (v) => setCustomerQ(v),
              })}
              onChange={e => {
                if (!touchEnabled) {
                  setCustomerQ(e.target.value)
                  void loadCustomersForModal(e.target.value)
                }
              }}
              placeholder="Ad veya kod ile ara..."
              style={{ border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', marginBottom: 12,
                cursor: touchEnabled ? 'pointer' : 'text' }}
            />
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {customers.map(c => (
                  <div key={c.id}
                    role="button"
                    tabIndex={0}
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
              touchEnabled={touchEnabled}
              openKeyboard={openKeyboard}
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
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>

        {/* ① SEPET — %42 */}
        <div style={{ width: '42%', flexShrink: 0, minWidth: 280, boxSizing: 'border-box', background: '#f6f7f9', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e8eaef' }}>

          {/* Sepet header */}
          <div style={{
            padding: '6px 12px',
            background: returnMode ? '#FEF2F2' : '#fafafa',
            borderBottom: `2px solid ${returnMode ? '#DC2626' : '#e8eaef'}`,
            display: 'flex', alignItems: 'center', gap: 8,
            flexShrink: 0,
          }}>
            {returnMode && (
              <span style={{
                background: '#DC2626', color: 'white',
                fontSize: 10, fontWeight: 700,
                padding: '2px 8px', borderRadius: 4,
                letterSpacing: '0.5px',
              }}>İADE</span>
            )}
            <span style={{
              fontSize: 13, fontWeight: 600,
              color: returnMode ? '#DC2626' : '#111',
            }}>
              {returnMode ? 'İade Belgesi' : 'Satış Belgesi'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>
                {cart.length > 0 ? `${cart.length} kalem` : 'Boş'}
              </span>
              {returnMode && (
                <button
                  type="button"
                  onClick={() => { setReturnMode(false); clearCart() }}
                  style={{ background: 'none', border: 'none',
                    cursor: 'pointer', color: '#9CA3AF', fontSize: 12 }}>
                  İptal
                </button>
              )}
            </div>
          </div>

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

          <div ref={cartListRef}
            onClick={() => { if (swipeState) setSwipeState(null) }}
            style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: 0,
            background: '#f3f4f6',
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
              const rowBg = returnMode
                ? '#FFF5F5'
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
                  style={{
                    position:     'relative',
                    overflow:     'hidden',
                    borderRadius: 11,
                    marginBottom: 5,
                    boxShadow:    '0 1px 2px rgba(15, 23, 42, 0.035)',
                  }}
                >
                  <div
                    style={{
                      position:       'absolute',
                      right:          0,
                      top:            0,
                      bottom:         0,
                      width:          SLIDE_OPEN_X,
                      background:     '#DC2626',
                      display:        'flex',
                      alignItems:     'center',
                      justifyContent: 'center',
                      cursor:         'pointer',
                    }}
                    onClick={() => {
                      cancelOneFromCart(item.id)
                      setSwipeState(null)
                    }}
                  >
                    <div style={{ color: 'white', fontSize: 11, fontWeight: 700,
                      textAlign: 'center', lineHeight: 1.3 }}>
                      🗑<br/>İptal
                    </div>
                  </div>

                  <div
                    onTouchStart={e => {
                      setSwipeState({
                        id:       item.id,
                        startX:   e.touches[0].clientX,
                        currentX: 0,
                        locked:   false,
                      })
                    }}
                    onTouchMove={e => {
                      setSwipeState(s => {
                        if (!s || s.id !== item.id) return s
                        const dx = s.startX - e.touches[0].clientX
                        const cx = Math.max(0, Math.min(dx, SLIDE_OPEN_X))
                        return { ...s, currentX: cx, locked: cx >= SLIDE_THRESHOLD }
                      })
                    }}
                    onTouchEnd={() => {
                      setSwipeState(s => {
                        if (!s || s.id !== item.id) return s
                        if (!s.locked) return null
                        return { ...s, currentX: SLIDE_OPEN_X }
                      })
                    }}
                    onMouseDown={e => {
                      if ((e.target as HTMLElement).closest('button')) return
                      e.preventDefault()
                      beginMouseSwipe(item.id, e.clientX)
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.background = rowBg
                    }}
                    style={{
                      display:             'grid',
                      gridTemplateColumns: CART_GRID,
                      padding:             '8px 12px',
                      alignItems:          'start',
                      background:          rowBg,
                      borderRadius:        11,
                      border:              '1px solid #e8eaef',
                      borderLeft:          returnMode ? '3px solid #DC2626' : '1px solid #e8eaef',
                      cursor:              'default',
                      transform:           swipeState?.id === item.id
                        ? `translateX(-${swipeState.currentX}px)`
                        : 'translateX(0)',
                      transition:          swipeState?.id === item.id && !swipeState.locked
                        ? 'none'
                        : 'transform 0.2s ease',
                      position:            'relative',
                      zIndex:              1,
                      userSelect:          'none',
                      touchAction:         'pan-y',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.background = '#f2f4f7'
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
                    {posSettings.allowLineDiscount ? (
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
                      color: '#111',
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
                    <span style={{
                      fontSize: cartSettings.fsMiktar, fontWeight: 700,
                      color: '#374151',
                      minWidth: 24, textAlign: 'center',
                    }}>{fmtQty(item.quantity)}</span>
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
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: cartSettings.fsTutar, fontWeight: 600,
                      color: '#111',
                    }}>{fmt(item.netTotal)}</div>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={e => {
                        e.stopPropagation()
                        openPriceEdit(item.id, item.price)
                      }}
                      onMouseDown={e => e.stopPropagation()}
                      style={{
                      fontSize: cartSettings.fsTutarSub, color: '#9ca3af', marginTop: 1,
                      cursor: paymentMode ? 'default' : 'pointer',
                      borderBottom: paymentMode ? 'none' : '1px dashed #D1D5DB',
                      display: 'inline-block',
                    }}>{fmt(item.price)}×{fmtQty(item.quantity)}</div>
                  </div>
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
          width: 'clamp(160px, 22%, 260px)',
          flexShrink: 0,
          minWidth: 160,
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
          background: '#f8f9fa',
          display: 'flex',
          flexDirection: 'column',
          padding: '6px 6px 0',
          gap: 0,
          borderRight: '1px solid #e0e0e0',
          overflow: 'hidden',
          position: 'relative',
        }}>

          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateRows: 'minmax(0, 38fr) minmax(0, 62fr)',
            gap: 5,
          }}>

          {/* Üst butonlar — kalan alanı doldurur */}
          <div style={{ minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: 5, overflow: 'hidden' }}>

          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>

            {/* SMS */}
            <button type="button"
              onClick={() => {
                if (!pavoSettings) return
                setSmsPhoneDraft(smsPhone || '')
                setSmsPhonePanelOpen(true)
              }}
              style={{ borderRadius: 8, border: '1.5px solid',
                borderColor: smsPhone ? '#1565C0' : '#E5E7EB',
                background: smsPhone ? '#EFF6FF' : '#FAFAFA',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center',
                gap: 4, padding: '4%', overflow: 'hidden', height: '100%',
                cursor: pavoSettings ? 'pointer' : 'default',
                opacity: pavoSettings ? 1 : 0.55 }}>
              <span style={{ fontSize: 'clamp(12px, 1.2vw, 18px)' }}>📱</span>
              <span style={{ fontSize: 'clamp(8px, 0.7vw, 11px)', fontWeight: 600,
                color: smsPhone ? '#1565C0' : '#9CA3AF',
                whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis', display: 'block', width: '100%', textAlign: 'center' as const }}>
                {smsPhone ? formatTrMobileSmsDisplay(smsPhone) : 'SMS'}
              </span>
            </button>

            {/* Mail */}
            <button type="button"
              onClick={() => setMailModalOpen(true)}
              style={{ borderRadius: 8, border: '1.5px solid',
                borderColor: mailAddr ? '#1565C0' : '#E5E7EB',
                background: mailAddr ? '#EFF6FF' : '#FAFAFA',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center',
                gap: 4, padding: '4%', overflow: 'hidden', height: '100%',
                cursor: 'pointer' }}>
              <span style={{ fontSize: 'clamp(12px, 1.2vw, 18px)' }}>✉️</span>
              <span style={{ fontSize: 'clamp(8px, 0.7vw, 11px)', fontWeight: 600,
                color: mailAddr ? '#1565C0' : '#9CA3AF',
                whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis', display: 'block', width: '100%', textAlign: 'center' as const }}>
                {mailAddr || 'Mail'}
              </span>
            </button>

          </div>

          {/* ── SATIR 2+3: 4 buton 2×2 + popup menüler (v2) ── */}
          <div style={{ flex: 2, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 5 }}>

            {/* 1 — Menü: mavi tonu */}
            <button type="button"
              onClick={() => setMenuOpen(m => m === 'islemler' ? null : 'islemler')}
              style={{ padding: '4% 2%', height: '100%', borderRadius: 8,
                border: `1.5px solid ${menuOpen === 'islemler' ? '#1565C0' : '#BBDEFB'}`,
                background: menuOpen === 'islemler' ? '#E3F2FD' : '#F3F8FE',
                color: '#1565C0', fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>☰</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)' }}>Menü</span>
            </button>

            {/* 2 — Belge: mor tonu */}
            <button type="button"
              onClick={() => setMenuOpen(m => m === 'belge' ? null : 'belge')}
              style={{ padding: '4% 2%', height: '100%', borderRadius: 8,
                border: `1.5px solid ${menuOpen === 'belge' ? '#7C3AED' : '#DDD6FE'}`,
                background: menuOpen === 'belge' ? '#EDE9FE' : '#F5F3FF',
                color: '#7C3AED', fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>📄</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)' }}>Belge</span>
            </button>

            {/* 3 — Müşteri: yeşil tonu */}
            <button type="button"
              onClick={() => setMenuOpen(m => m === 'musteri' ? null : 'musteri')}
              style={{ padding: '4% 2%', height: '100%', borderRadius: 8,
                border: `1.5px solid ${menuOpen === 'musteri' || selectedCustomer ? '#2E7D32' : '#C8E6C9'}`,
                background: menuOpen === 'musteri' ? '#E8F5E9' : selectedCustomer ? '#F1F8F1' : '#F4FBF4',
                color: '#2E7D32', fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4%' }}>
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
              style={{ padding: '4% 2%', height: '100%', borderRadius: 8,
                border: `1.5px solid ${menuOpen === 'fiyatgor' ? '#D97706' : '#FDE68A'}`,
                background: menuOpen === 'fiyatgor' ? '#FEF3C7' : '#FFFBEB',
                color: '#D97706', fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>🔍</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)' }}>Fiyat Gör</span>
            </button>

          </div>

          </div>

          <div style={{
            display:        'flex',
            flexDirection:  'column',
            gap:            5,
            flex:           1,
            minHeight:      0,
            height:         '100%',
            padding:        '4px',
            boxSizing:      'border-box',
            overflow:       'hidden',
          }}>

            {/* Satır 1: TEMİZLE + ⌫ */}
            <div style={{ display: 'flex', gap: 5, flexShrink: 0, height: 44 }}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); handleNumKey('C') }}
                style={{
                  flex:           1,
                  borderRadius:   9,
                  border:         '1.5px solid #fecdd3',
                  background:     '#fff5f5',
                  color:          '#dc2626',
                  fontSize:       13,
                  fontWeight:     700,
                  cursor:         'pointer',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  userSelect:     'none' as const,
                }}
              >TEMİZLE</button>

              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); handleNumKey('⌫') }}
                style={{
                  flex:           1,
                  borderRadius:   9,
                  border:         '1.5px solid #fde68a',
                  background:     '#fffbeb',
                  color:          '#d97706',
                  fontSize:       20,
                  fontWeight:     700,
                  cursor:         'pointer',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  userSelect:     'none' as const,
                  gap:            6,
                }}
              >⌫</button>
            </div>

            {/* Satır 2: numBuf göstergesi */}
            <div style={{
              flexShrink:     0,
              height:         40,
              borderRadius:   9,
              border:         `1.5px solid ${numBuf ? '#a5d6a7' : '#e5e7eb'}`,
              background:     numBuf ? '#e8f5e9' : '#f9fafb',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              padding:        '0 8px',
              overflow:       'hidden',
              userSelect:     'none' as const,
            }}>
              <span style={{
                fontSize: numBuf.length === 0
                  ? 'clamp(15px, 1.5vw + 4px, 24px)'
                  : numBuf.length <= 7
                    ? 'clamp(15px, 1.5vw + 4px, 24px)'
                    : numBuf.length <= 14
                      ? 'clamp(12px, 1.1vw + 2px, 18px)'
                      : numBuf.length <= 17
                        ? 'clamp(10px, 0.95vw + 1px, 16px)'
                        : 'clamp(8px, 0.8vw, 14px)',
                fontWeight:    700,
                color:         numBuf ? '#2e7d32' : '#9ca3af',
                letterSpacing: numBuf.length <= 4 ? 2 : numBuf.length <= 8 ? 1 : 0,
                whiteSpace:    'nowrap',
                overflow:      'hidden',
                textOverflow:  'ellipsis',
                maxWidth:      '100%',
                lineHeight:    1,
                textAlign:     'center',
              }}>
                {numBuf || '—'}
              </span>
            </div>

            {/* Numpad grid */}
            <div style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gridTemplateRows:    'repeat(4, minmax(0, 1fr))',
              gap:                 5,
              flex:                1,
              minHeight:           0,
            }}>
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0'].map(k => (
                <button
                  key={k}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); handleNumKey(k) }}
                  style={{
                    width:          '100%',
                    height:         '100%',
                    boxSizing:      'border-box',
                    border:         '1.5px solid #d1d5db',
                    borderRadius:   9,
                    cursor:         'pointer',
                    fontWeight:     700,
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                    userSelect:     'none' as const,
                    background:     'white',
                    color:          '#1f2937',
                    fontSize:       'clamp(14px, 1.4vw + 4px, 26px)',
                  }}
                >{k}</button>
              ))}

              <button
                type="button"
                onMouseDown={e => {
                  e.preventDefault()
                  if (!numBuf) return
                  setSearchQ(numBuf)
                  setNumBuf('')
                }}
                style={{
                  width:          '100%',
                  height:         '100%',
                  boxSizing:      'border-box',
                  border:         `1.5px solid ${numBuf ? '#BFDBFE' : '#e5e7eb'}`,
                  borderRadius:   9,
                  cursor:         numBuf ? 'pointer' : 'default',
                  fontWeight:     700,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  userSelect:     'none' as const,
                  background:     numBuf ? '#EFF6FF' : '#f9fafb',
                  color:          numBuf ? '#1565C0' : '#9ca3af',
                  fontSize:       'clamp(10px, 0.9vw + 3px, 14px)',
                }}
              >enter</button>
            </div>

          </div>

          </div>

          {menuOpen && menuOpen !== 'fiyatgor' && (
            <>
              <div
                role="presentation"
                style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'rgba(0,0,0,0.35)' }}
                onClick={() => setMenuOpen(null)}
              />
              <div
                style={{
                  position: 'fixed',
                  top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 9991,
                  background: 'white',
                  border: '0.5px solid #E5E7EB',
                  borderRadius: 20,
                  boxShadow: '0 12px 48px rgba(0,0,0,0.2)',
                  width: 'min(92vw, 520px)',
                  maxHeight: '85vh',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{
                  padding: '18px 20px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid #F3F4F6',
                  flexShrink: 0,
                  background: `${MENU_ACCENT[menuOpen]}08`,
                }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
                      {{ islemler: 'İşlemler', belge: 'Belge İşlemleri', musteri: 'Müşteri İşlemleri' }[menuOpen]}
                    </div>
                    <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 3 }}>
                      {{ islemler: 'Tahsilat, ödeme ve belge yönetimi', belge: 'İade işlemleri', musteri: 'Müşteri seçimi ve düzenleme' }[menuOpen]}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(null)}
                    style={{
                      width: 40, height: 40, borderRadius: 10,
                      border: '1px solid #E5E7EB', background: 'white',
                      fontSize: 18, color: '#6B7280', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >✕</button>
                </div>

                <div style={{
                  padding: 16,
                  overflowY: 'auto',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 10,
                }}>

                {menuOpen === 'islemler' && [
                  { icon: '💰', label: 'Cari tahsilat', disabled: false },
                  { icon: '💸', label: 'Cari ödeme', disabled: false },
                  { icon: '⏸', label: 'Beklemeye al', disabled: cart.length === 0 || heldDocs.length >= MAX_HELD_DOCS },
                  { icon: '📂', label: `Belge getir${heldDocs.length ? ` (${heldDocs.length})` : ''}`, disabled: false },
                  { icon: '%', label: 'Belge indirim', disabled: cart.length === 0 },
                  { icon: '🚫', label: 'Belge iptal', disabled: cart.length === 0, danger: true },
                ].map((item, i) => (
                  <PopupItem key={i} icon={item.icon} label={item.label} disabled={item.disabled} danger={item.danger} accent={MENU_ACCENT.islemler} layout="stack"
                    onClick={() => {
                      if (item.disabled) return
                      if (item.label.startsWith('Cari tah')) {
                        setCariPaymentModal('tahsilat')
                        setCariPaymentAmt('')
                        setCariPaymentDesc('')
                        setCariPaymentResult(null)
                        setCariPaymentQ('')
                        setCariPaymentResults([])
                        setCariPaymentCust(selectedCustomer ?? null)
                        setMenuOpen(null)
                        return
                      }
                      if (item.label.startsWith('Cari öd')) {
                        setCariPaymentModal('odeme')
                        setCariPaymentAmt('')
                        setCariPaymentDesc('')
                        setCariPaymentResult(null)
                        setCariPaymentQ('')
                        setCariPaymentResults([])
                        setCariPaymentCust(selectedCustomer ?? null)
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
                      if (item.label.startsWith('Belge iptal')) {
                        void confirm({
                          title:   'Belge İptal',
                          message: 'Belgeyi iptal etmek istediğinize emin misiniz?',
                          confirmLabel: 'Evet, İptal Et',
                          cancelLabel:  'Vazgeç',
                        }).then(ok => { if (ok) clearCart() })
                        return
                      }
                    }} />
                ))}

                {menuOpen === 'belge' && [
                  { icon: '↩️', label: 'İade Al', disabled: false },
                  { icon: '⚡', label: 'Hızlı İade', disabled: !pavoSettings },
                ].map((item, i) => (
                  <PopupItem key={i} icon={item.icon} label={item.label} disabled={item.disabled} accent={MENU_ACCENT.belge} layout="stack"
                    onClick={() => {
                      if (item.label === 'Hızlı İade') {
                        setQuickReturnModal({
                          step: 'search', searchBy: 'order', saleNumber: '', selected: {}, selectedPayments: {},
                        })
                        setQuickReturnError(null)
                        setMenuOpen(null)
                        return
                      }
                      setReturnMode(true)
                      clearCart()
                      setSelectedCustomer(null)
                      setMenuOpen(null)
                    }} />
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
                ].map((item, i) => (
                  <PopupItem key={i} icon={item.icon} label={item.label} disabled={item.disabled} danger={item.danger} accent={MENU_ACCENT.musteri} layout="stack"
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

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    ref={fiyatGorInputRef}
                    autoFocus
                    value={fiyatGorQ}
                    readOnly={touchEnabled}
                    onChange={e => {
                      if (!touchEnabled) {
                        const v = e.target.value
                        applyFiyatGorScan(v)
                      }
                    }}
                    placeholder="Barkod okut veya ürün adı gir..."
                    style={{ flex: 1, padding: '12px 14px', fontSize: 15, borderRadius: 10,
                      border: '1.5px solid #E5E7EB', outline: 'none',
                      boxSizing: 'border-box' as const,
                      cursor: touchEnabled ? 'default' : 'text' }}
                  />
                  <button
                    type="button"
                    onClick={() => openKeyboard({
                      title:     'Ürün ara',
                      initial:   fiyatGorQ,
                      type:      'qwerty',
                      onConfirm: (v) => applyFiyatGorScan(v),
                    })}
                    style={{ padding: '12px 14px', borderRadius: 10,
                      border: '1.5px solid #E5E7EB', background: '#F9FAFB',
                      cursor: 'pointer', color: '#6B7280', fontSize: 18,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0 }}>
                    ⌨️
                  </button>
                </div>

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
                        <div key={p.id} role="button" tabIndex={0} onClick={() => setFiyatGorItem(p)}
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

          {cariPaymentModal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.45)', display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}
              onClick={() => { if (!cariPaymentSaving) setCariPaymentModal(null) }}>
              <div onClick={e => e.stopPropagation()}
                style={{ background: 'white', borderRadius: 16, padding: 24,
                  width: 'min(400px, 94vw)', display: 'flex', flexDirection: 'column', gap: 14 }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#111' }}>
                    {cariPaymentModal === 'tahsilat' ? '💰 Cari Tahsilat' : '💸 Cari Ödeme'}
                  </div>
                  <button type="button" onClick={() => setCariPaymentModal(null)} disabled={cariPaymentSaving}
                    style={{ background: 'none', border: 'none', fontSize: 20,
                      cursor: 'pointer', color: '#9CA3AF', padding: 0 }}>✕</button>
                </div>

                {cariPaymentCust ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 14px', borderRadius: 10,
                    background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#166534', flex: 1 }}>
                      👤 {cariPaymentCust.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#6B7280', fontFamily: 'monospace' }}>
                      {cariPaymentCust.code}
                    </span>
                    <button type="button"
                      onClick={() => { setCariPaymentCust(null); setCariPaymentQ(''); setCariPaymentResults([]) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        color: '#9CA3AF', fontSize: 14, padding: 0 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      autoFocus={!touchEnabled}
                      value={cariPaymentQ}
                      readOnly={touchEnabled}
                      onClick={() => openKeyboard({
                        title:     'Cari ara',
                        initial:   cariPaymentQ,
                        type:      'qwerty',
                        onSearch:  async (q) => {
                          const all = await window.electron.db.getCustomers(companyId)
                          return rankCustomers(all, q)
                        },
                        onSelectResult: (c) => {
                          setCariPaymentCust(c)
                          setCariPaymentQ('')
                        },
                        onConfirm: (v) => setCariPaymentQ(v),
                      })}
                      onChange={e => {
                        if (!touchEnabled) void searchCariPayment(e.target.value)
                      }}
                      placeholder="Cari ara... (ad veya kod)"
                      style={{ width: '100%', padding: '10px 14px', fontSize: 13,
                        borderRadius: 10, border: '1px solid #E5E7EB', outline: 'none',
                        boxSizing: 'border-box' as const,
                        cursor: touchEnabled ? 'pointer' : 'text' }}
                    />
                    {cariPaymentSearching && (
                      <span style={{ position: 'absolute', right: 12, top: '50%',
                        transform: 'translateY(-50%)', color: '#9CA3AF', fontSize: 12 }}>⟳</span>
                    )}
                    {cariPaymentResults.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0,
                        zIndex: 100, background: 'white', border: '1px solid #E0E0E0',
                        borderRadius: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        maxHeight: 180, overflowY: 'auto' }}>
                        {cariPaymentResults.map(c => (
                          <div key={c.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setCariPaymentCust(c)
                              setCariPaymentQ('')
                              setCariPaymentResults([])
                            }}
                            style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                              borderBottom: '1px solid #F9FAFB',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F5F8FF' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'white' }}>
                            <span style={{ fontWeight: 500 }}>{c.name}</span>
                            <span style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace' }}>{c.code}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ textAlign: 'center', padding: '12px 0',
                  fontSize: 28, fontWeight: 600, letterSpacing: 2,
                  color: cariPaymentModal === 'tahsilat' ? '#2E7D32' : '#C62828',
                  borderTop: '1px solid #F3F4F6', borderBottom: '1px solid #F3F4F6' }}>
                  {cariPaymentAmt || '—'} ₺
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
                  gap: 'clamp(5px,1.2vw,8px)' }}>
                  {['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(k => (
                    <button key={k} type="button"
                      onMouseDown={e => {
                        e.preventDefault()
                        if (k === '⌫') setCariPaymentAmt(p => p.slice(0, -1))
                        else if (k === ',') {
                          if (!cariPaymentAmt.includes(','))
                            setCariPaymentAmt(p => p + ',')
                        }
                        else setCariPaymentAmt(p => p + k)
                      }}
                      style={{ padding: 'clamp(10px,2vw,14px) 0',
                        fontSize: k === '⌫' ? 'clamp(15px,2vw,20px)' : 'clamp(17px,2.2vw,22px)',
                        fontWeight: 500, borderRadius: 10,
                        border: '1px solid #E5E7EB', background: 'white', cursor: 'pointer',
                        color: k === '⌫' ? '#EF4444' : '#111' }}>
                      {k}
                    </button>
                  ))}
                </div>

                <div style={{ position: 'relative' }}>
                  <input
                    value={cariPaymentDesc}
                    readOnly={touchEnabled}
                    onClick={() => openKeyboard({
                      title:     'Açıklama',
                      initial:   cariPaymentDesc,
                      type:      'qwerty',
                      onConfirm: (v) => setCariPaymentDesc(v),
                    })}
                    onChange={e => { if (!touchEnabled) setCariPaymentDesc(e.target.value) }}
                    placeholder="Açıklama (opsiyonel)"
                    style={{ padding: '10px 14px', fontSize: 13, borderRadius: 10,
                      border: '1px solid #E5E7EB', outline: 'none',
                      width: '100%', boxSizing: 'border-box' as const,
                      cursor: touchEnabled ? 'pointer' : 'text' }}
                  />
                  {touchEnabled && (
                    <span style={{ position: 'absolute', right: 10, top: '50%',
                      transform: 'translateY(-50%)', color: '#9CA3AF', fontSize: 14,
                      pointerEvents: 'none' }}>
                      ⌨️
                    </span>
                  )}
                </div>

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
                    disabled={cariPaymentSaving || !cariPaymentCust ||
                      !cariPaymentAmt || parseFloat(cariPaymentAmt.replace(',', '.')) <= 0}
                    onClick={() => void handleCariPayment()}
                    style={{ padding: '13px 0', fontSize: 14, fontWeight: 600,
                      borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: cariPaymentModal === 'tahsilat' ? '#2E7D32' : '#C62828',
                      color: 'white',
                      opacity: (cariPaymentSaving || !cariPaymentCust || !cariPaymentAmt) ? 0.5 : 1 }}>
                    {cariPaymentSaving ? 'Gönderiliyor...'
                      : !cariPaymentCust ? 'Cari seçin'
                        : cariPaymentModal === 'tahsilat' ? 'Tahsilat Yap' : 'Ödeme Yap'}
                  </button>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* ③+④ PLU + GRUPLAR wrapper */}
        <div style={{
          flex:          1,
          minWidth:      180,
          boxSizing:     'border-box',
          display:       'flex',
          flexDirection: 'column',
          overflow:      'hidden',
          background:    'white',
        }}>

          {/* Arama — tam genişlik, en üstte */}
          <div style={{
            padding:      '6px 8px',
            flexShrink:   0,
            borderBottom: '1px solid #f0f0f0',
            background:   'white',
          }}>
            <input
              ref={searchRef}
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchQ('') }}
              placeholder="Barkod veya ürün ara..."
              style={{
                width:        '100%',
                border:       '1px solid #E0E0E0',
                borderRadius: 9,
                padding:      '9px 14px',
                fontSize:     14,
                outline:      'none',
                background:   'white',
                boxSizing:    'border-box',
              }}
            />
          </div>

          {/* PLU grid + Grup bar — yatay */}
          <div style={{
            flex:      1,
            display:   'flex',
            minHeight: 0,
            overflow:  'hidden',
          }}>

            {/* PLU panel */}
            <div style={{
              flex:          1,
              flexShrink:    1,
              minWidth:      0,
              boxSizing:     'border-box',
              display:       'flex',
              flexDirection: 'column',
              overflow:      'hidden',
            }}>

              {/* Grup adı + ürün sayısı — küçük başlık */}
              <div style={{
                padding:      '4px 10px',
                borderBottom: '1px solid #f3f4f6',
                display:      'flex',
                alignItems:   'center',
                gap:          6,
                height:       28,
                flexShrink:   0,
                background:   '#fafafa',
              }}>
                <div style={{ width: 3, height: 12, borderRadius: 2, background: activeColor, flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', flex: 1 }}>
                  {pluGroups.find(g => g.id === activeGroup)?.name ?? '—'}
                </span>
                <span style={{ fontSize: 9, color: '#9ca3af' }}>{filtered.length} ürün</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!openKeyboard({
                      title:    'Ürün ara',
                      initial:  searchQ,
                      type:     'qwerty',
                      onConfirm: (v) => setSearchQ(v),
                    })) {
                      void window.electron.app.openKeyboard().catch(() => {})
                    }
                  }}
                  style={{ width: 22, height: 22, background: '#efefef', border: '1px solid #e5e7eb', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}
                  title="Klavye Aç"
                >⌨</button>
              </div>

          {/* PLU grid — sütun/satır sayısı posSettings'ten */}
          {searchQ ? (
            // Arama modu — liste
            <div style={{ flex: 1, overflowY: 'auto', padding: '5px 8px' }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#BDBDBD', padding: '24px 0', fontSize: 12 }}>Ürün bulunamadı</div>
              ) : filtered.map(p => (
                <div key={`search-${p.id}-${p.code}`} role="button" tabIndex={0} onClick={() => handlePluClick(p)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', marginBottom: 3, borderRadius: 7, background: 'white', border: '1px solid #F0F0F0', cursor: 'pointer' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = activeColor; el.style.background = activeSoft }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = '#F0F0F0'; el.style.background = 'white' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: fontSizeName, fontWeight: 500, color: '#212121', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{truncatePluName(p.name)}</div>
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
                if (!p) return (
                  <div key={`e${i}`} style={{
                    borderRadius: 8,
                    background: '#fafafa',
                    border: '1px dashed #f0f0f0',
                  }} />
                )
                return (
                  <PluButton
                    key={`${p.id}-${p.code}-${i}`}
                    name={p.name}
                    price={p.price}
                    code={p.code ?? ''}
                    barcode={p.barcode ?? ''}
                    showPrice={posSettings.showPrice ?? true}
                    showCode={posSettings.showCode ?? true}
                    showBarcode={posSettings.showBarcode ?? false}
                    activeColor={activeColor}
                    activeSoft={activeSoft}
                    baseFontSize={fontSizeName}
                    onClick={() => handlePluClick(p)}
                  />
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

            </div>

            {/* ④ GRUPLAR — sağda, arama altından başlar */}
            <div
              className="plu-groups-bar"
              style={{
              width:         'clamp(68px, 11%, 104px)',
              flexShrink:    0,
              minWidth:      68,
              boxSizing:     'border-box',
              background:    'white',
              display:       'flex',
              flexDirection: 'column',
              overflowX:     'hidden',
              overflowY:     'auto',
              padding:       '4px 0',
              gap:           3,
            }}>
              {pluGroups.map(g => {
                const isActive = activeGroup === g.id
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setActiveGroup(g.id); setPage(0); setSearchQ('') }}
                    style={{
                      height:        68,
                      border:        'none',
                      background:    isActive ? g.color : '#f8f9fa',
                      cursor:        'pointer',
                      position:      'relative',
                      display:       'flex',
                      flexDirection: 'column',
                      alignItems:    'center',
                      justifyContent:'center',
                      gap:           3,
                      color:         isActive ? 'white' : '#6b7280',
                      fontSize:      10,
                      fontWeight:    600,
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.2px',
                      flexShrink:    0,
                      width:         '100%',
                      paddingRight:  5,
                      borderRadius:  '8px 0 0 8px',
                    }}
                  >
                    <div style={{
                      position: 'absolute', right: 0, top: 0, bottom: 0,
                      width: isActive ? 7 : 4, background: g.color, transition: 'width 0.15s',
                    }} />
                    {isActive && (
                      <div style={{
                        position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)',
                        borderTop: '6px solid transparent', borderBottom: '6px solid transparent',
                        borderLeft: `6px solid ${g.color}`, zIndex: 3,
                      }} />
                    )}
                    <div style={{
                      width: isActive ? 10 : 8, height: isActive ? 10 : 8,
                      borderRadius: '50%', background: isActive ? 'white' : g.color,
                      opacity: isActive ? 1 : 0.4, transition: 'all 0.15s',
                    }} />
                    <span>{g.name}</span>
                  </button>
                )
              })}
              {pluGroups.length === 0 && (
                <div style={{ padding: 8, fontSize: 9, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
                  PLU grubu yok
                </div>
              )}
            </div>

          </div>

          {/* Ödeme — wrapper altında, tam genişlik */}
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
                      label: returnMode ? 'Nakit İade' : 'Nakit',
                      mediator: 1,
                    }
                    setPaymentLines([line])
                    void (returnMode ? completeReturn([line]) : completeSale([line]))
                  }}
                  disabled={cart.length === 0}
                  style={{
                    padding: '13px 4px',
                    borderRadius: 7,
                    border: cart.length === 0
                      ? 'none'
                      : `1.5px solid ${returnMode ? '#FECACA' : '#A5D6A7'}`,
                    background: cart.length === 0 ? '#f5f5f5' : returnMode ? '#FEF2F2' : '#e8f5e9',
                    color: cart.length === 0 ? '#bdbdbd' : returnMode ? '#DC2626' : '#2e7d32',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: cart.length === 0 ? 'default' : 'pointer',
                  }}
                >
                  {returnMode ? '💵 Nakit İade' : '💵 Nakit'}
                </button>
                <button
                  onClick={() => {
                    const line: PaymentLine = {
                      id: crypto.randomUUID(),
                      method: 'card',
                      amount: grandTotal,
                      label: returnMode ? 'Kart İade' : 'Kart',
                      mediator: 2,
                    }
                    setPaymentLines([line])
                    void (returnMode ? completeReturn([line]) : completeSale([line]))
                  }}
                  disabled={cart.length === 0 || (!returnMode && !pavoSettings)}
                  title={!returnMode && !pavoSettings ? 'Pavo cihazı ayarlı değil' : undefined}
                  style={{
                    padding: '13px 4px',
                    borderRadius: 7,
                    border: cart.length === 0 || (!returnMode && !pavoSettings)
                      ? 'none'
                      : `1.5px solid ${returnMode ? '#FECACA' : '#90CAF9'}`,
                    background: cart.length === 0 || (!returnMode && !pavoSettings) ? '#f5f5f5' : returnMode ? '#FEF2F2' : '#e3f2fd',
                    color: cart.length === 0 || (!returnMode && !pavoSettings) ? '#bdbdbd' : returnMode ? '#DC2626' : '#1565C0',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: cart.length === 0 || (!returnMode && !pavoSettings) ? 'default' : 'pointer',
                  }}
                >
                  {returnMode ? '💳 Kart İade' : '💳 Kart'}
                </button>
                {!returnMode && (
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
                )}
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
                    onClick={() => void (returnMode ? completeReturn() : completeSale())}
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
      </div>

      {printSelectModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10001,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'white', borderRadius: 16, padding: 24,
            width: 'min(360px, 94vw)', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>
              🖨️ Fiş seçin
            </div>
            <div style={{ fontSize: 12, color: '#6B7280' }}>
              Hangi fişi basmak istiyorsunuz?
            </div>

            {printSelectModal.templates.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  const modal = printSelectModal
                  setPrintSelectModal(null)
                  void window.electron.templates.printWithBehavior({
                    triggerType: modal.trigger,
                    data:        modal.data,
                    templateId:  t.id,
                  })
                }}
                style={{
                  padding: '12px 16px', borderRadius: 10,
                  border: `1.5px solid ${t.is_default ? '#1565C0' : '#E5E7EB'}`,
                  background: t.is_default ? '#EFF6FF' : 'white',
                  cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <span style={{ fontSize: 18 }}>
                  {t.template_type === 'thermal' ? '🖨️' : '📄'}
                </span>
                <div>
                  <div style={{
                    fontSize: 13, fontWeight: 600,
                    color: t.is_default ? '#1565C0' : '#111',
                  }}>
                    {t.name}
                  </div>
                  {t.is_default && (
                    <div style={{ fontSize: 11, color: '#1565C0' }}>Varsayılan</div>
                  )}
                </div>
              </button>
            ))}

            <button
              type="button"
              onClick={() => setPrintSelectModal(null)}
              style={{
                padding: '10px', borderRadius: 10, marginTop: 4,
                border: '1px solid #E5E7EB', background: '#F9FAFB',
                cursor: 'pointer', fontSize: 13, color: '#6B7280',
              }}
            >
              Fiş Basma
            </button>
          </div>
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
          bottom: merkezToast ? 72 : 24,
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

      {heldToast && (
        <div style={{
          position: 'fixed', bottom: merkezToast ? 72 : 24, left: '50%', transform: 'translateX(-50%)',
          background: '#C62828', color: 'white', padding: '10px 20px', borderRadius: 8,
          fontSize: 13, fontWeight: 600, zIndex: 10001, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          maxWidth: 'min(480px, 94vw)', textAlign: 'center',
        }}>
          {heldToast}
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

      {keyboardProps.open && (
        <TouchKeyboard {...keyboardProps} />
      )}
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
  touchEnabled:  boolean
  openKeyboard:  (opts: OpenOpts) => boolean
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
function AddCustomerForm({ prefillTaxNo, touchEnabled, openKeyboard, onClose, onSuccess }: AddCustomerFormProps) {
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
    cursor: touchEnabled ? 'pointer' : 'text',
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
            readOnly={touchEnabled}
            onClick={() => openKeyboard({
              title:     isPerson ? 'Ad Soyad' : 'Firma Adı',
              initial:   name,
              type:      'qwerty',
              onConfirm: (v) => setName(v),
            })}
            onChange={e => { if (!touchEnabled) setName(e.target.value) }}
            style={s}
            placeholder={isPerson ? 'Ahmet Yılmaz' : 'ACME Ltd. Şti.'}
          />
        </div>

        <div>
          {lbl(isPerson ? 'TC Kimlik No' : 'VKN', true)}
          <input
            value={taxNo}
            readOnly={touchEnabled}
            onClick={() => openKeyboard({
              title:     isPerson ? 'TC Kimlik No' : 'VKN',
              initial:   taxNo,
              type:      'numeric',
              onConfirm: (v) => setTaxNo(v),
            })}
            onChange={e => { if (!touchEnabled) setTaxNo(e.target.value) }}
            style={s}
            placeholder={isPerson ? '11111111111' : '1234567890'}
          />
        </div>

        <div>
          {lbl('Vergi Dairesi')}
          <input
            value={taxOffice}
            readOnly={touchEnabled}
            onClick={() => openKeyboard({
              title:     'Vergi Dairesi',
              initial:   taxOffice,
              type:      'qwerty',
              onConfirm: (v) => setTaxOffice(v),
            })}
            onChange={e => { if (!touchEnabled) setTaxOffice(e.target.value) }}
            style={s}
            placeholder="Bolu"
          />
        </div>

        <div>
          {lbl('Telefon')}
          <input
            value={phone}
            readOnly={touchEnabled}
            onClick={() => openKeyboard({
              title:     'Telefon',
              initial:   phone,
              type:      'numeric',
              onConfirm: (v) => setPhone(v),
            })}
            onChange={e => { if (!touchEnabled) setPhone(e.target.value) }}
            style={s}
            placeholder="0555 000 0000"
          />
        </div>

        <div>
          {lbl('E-posta')}
          <input
            type="email"
            value={email}
            readOnly={touchEnabled}
            onClick={() => openKeyboard({
              title:     'E-posta',
              initial:   email,
              type:      'qwerty',
              onConfirm: (v) => setEmail(v),
            })}
            onChange={e => { if (!touchEnabled) setEmail(e.target.value) }}
            style={s}
            placeholder="ornek@mail.com"
          />
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          {lbl('Adres')}
          <input
            value={address}
            readOnly={touchEnabled}
            onClick={() => openKeyboard({
              title:     'Adres',
              initial:   address,
              type:      'qwerty',
              onConfirm: (v) => setAddress(v),
            })}
            onChange={e => { if (!touchEnabled) setAddress(e.target.value) }}
            style={s}
            placeholder="Sokak, No, Mahalle"
          />
        </div>

        <div style={{ position: 'relative' }}>
          {lbl('Şehir')}
          <input
            value={city || citySearch}
            readOnly={touchEnabled}
            onClick={() => openKeyboard({
              title:     'Şehir',
              initial:   city || citySearch,
              type:      'qwerty',
              onConfirm: (v) => {
                setCitySearch(v)
                setCity('')
                setShowCityDD(true)
              },
            })}
            onChange={e => {
              if (!touchEnabled) {
                setCitySearch(e.target.value)
                setCity('')
                setShowCityDD(true)
              }
            }}
            onFocus={() => { if (!touchEnabled) setShowCityDD(true) }}
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
          <input
            value={district}
            readOnly={touchEnabled}
            onClick={() => openKeyboard({
              title:     'İlçe',
              initial:   district,
              type:      'qwerty',
              onConfirm: (v) => setDistrict(v),
            })}
            onChange={e => { if (!touchEnabled) setDistrict(e.target.value) }}
            style={s}
            placeholder="Merkez"
          />
        </div>

        <div>
          {lbl('Posta Kodu')}
          <input
            value={postalCode}
            readOnly={touchEnabled}
            onClick={() => openKeyboard({
              title:     'Posta Kodu',
              initial:   postalCode,
              type:      'numeric',
              onConfirm: (v) => setPostalCode(v),
            })}
            onChange={e => { if (!touchEnabled) setPostalCode(e.target.value) }}
            style={s}
            placeholder="14100"
          />
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

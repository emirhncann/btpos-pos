import { useState, useEffect, useRef, useCallback, type ReactNode, type CSSProperties } from 'react'
import { useLicenseCheck } from '../hooks/useLicenseCheck'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import { sendInvoiceForSale, sendReturnInvoice, tryResolveTorbaCustomer } from '../lib/invoiceSend'
import { CustomerFormModal } from '../components/CustomerFormModal'
import {
  pavoCompleteSale,
  pavoStartSaleWithItems,
  pavoAddPayment,
  pavoFinalizeSale,
  pavoCheckPendingSale,
  pavoAbandonSuspendedSale,
  pavoGetSaleResult,
  pavoAdvanceSale,
  pavoCompleteUncompletedSale,
  pavoListPendingSales,
  normalizePavoSaleResult,
  type PavoSettings,
  type PavoFinalSale,
  type PavoFinalPayment,
} from '../lib/pavoService'
import { parsePavoResult, type PaymentDeviceResult, isSuccessfulPavoPayment } from '../lib/paymentDevice'
import { useQueueWorker, type QueueToastPayload } from '../hooks/useQueueWorker'
import { API_URL } from '../lib/api'
import { PluButton, truncatePluName } from '../components/PluButton'
import { DiscountLine } from '../components/DiscountLine'
import { PosModal, modalActionStyle } from '../components/PosModal'
import { C, solidBtn } from '../theme/colors'
import AppLogo from '../components/AppLogo'
import LicenseBanner from '../components/LicenseBanner'
import ConnectionDot from '../components/ConnectionDot'
import { CmdProgressChip } from '../components/CmdProgressChip'
import { PosUndefinedBadge } from '../components/PosUndefinedBadge'
import { isPosDefined, POS_UNDEFINED_MESSAGE } from '../services/pos/posReadiness'
import { getPosSnapshot, isPosReady, refreshPosReady, subscribePosReady, usePosReady } from '../store/posReady'
import { PavoLockOverlay } from '../components/PavoLockOverlay'
import { getRecoveryInfo, isRecoveryActive, isRecoveryInFlight, paymentTotals, primeStaleWaiting, setRecoveryRuntime, summarizeProbe, type PendingLookup, type RecoveryProbe } from '../lib/pavoRecovery'
import {
  attachBalanceForTemplate,
  newBalancePrintSession,
  shouldFetchCustomerBalance,
  type BalancePrintSession,
} from '../lib/customerBalance'
import { claimSaleSettle, hideSaleCompleted, readZNo, releaseSaleSettle, showSaleCompleted } from '../store/saleCompleted'
import {
  assertCartEditable,
  getPavoLockInfo,
  getPavoPhase,
  isCartLocked,
  notifyLocked,
  setLockNotifier,
  setPavoPhase,
  usePavoLock,
} from '../store/pavoLock'
import { ScreenKeyboardHost } from '../components/OnScreenKeyboard'
import { useTouchKeyboard } from '../hooks/useTouchKeyboard'
import { searchCustomers as rankCustomers } from '../lib/searchCustomers'
import { buildSaleReceiptData } from '../lib/templateEngine'
import { nextOrderNo } from '../lib/orderNo'
import { useSettings } from '../hooks/useSettings'
import { useButtonColor } from '../hooks/useButtonColor'
import { isDevtoolsPermitActive } from '../lib/settingsModel'
import QuickReturnModal, {
  type QuickReturnModalState,
  type RecentSalesFilter,
  type ReturnablePayment,
  type ReturnableSale,
  type ReturnableSaleItem,
} from '../components/QuickReturnModal'
import AlertDialog from '../components/AlertDialog'
import { useAlertDialog } from '../hooks/useAlertDialog'
import { playClickSound } from '../lib/clickSound'
import {
  matchProductByInternalBarcode,
  parseBarcodeEAN13 as parseEAN13,
  parseBarcodeFormatsResponse,
} from '../lib/barcodeFormat'

const WEIGHED_UNITS = new Set([
  'KG', 'KG.', 'KGS', 'KILO', 'KILOGRAM', 'KILOGRAMS',
  'G', 'G.', 'GR', 'GR.', 'GRS', 'GRAM', 'GRAMS', 'GRAMAJ',
])

function isWeighedUnit(unit?: string | null): boolean {
  const raw = (unit ?? '').trim()
  if (!raw) return false
  // Boşluk / nokta / Türkçe karakterleri normalize et → KILOGRAM, GRAM vb
  const norm = raw
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/İ/g, 'I')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
  return WEIGHED_UNITS.has(norm)
}

function normalizetr(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/ı/g, 'i')
}

function fmtQty(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(3)
}

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

const CART_GRID = '76px 1fr 104px 74px'

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

function hexToTint(hex: string, weight = 0.5): string {
  try {
    if (!hex?.startsWith('#') || hex.length < 7) return '#f8f9fa'
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    if ([r, g, b].some(n => Number.isNaN(n))) return '#f8f9fa'
    const mix = (c: number) => Math.round(c * weight + 255 * (1 - weight))
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
  } catch {
    return '#f8f9fa'
  }
}

interface Props {
  companyId:       string
  cashier:         CashierRow
  allProducts:     ProductRow[]
  pluGroups:       PluGroupCacheRow[]
  syncedEnabledBrands?: PaymentProviderBrand[] | null
  syncedBarcodeFormats?: BarcodeFormatRow[] | null
  onBack:          () => void
  onLogout:        () => void
  pendingMessage?: { text: string } | null
  onMessageClose?: () => void
  merkezToast?:    string | null
  onCartChange?:   (hasItems: boolean) => void
  cartSettings:    CartSettings
  commandListenerActive?: boolean
  commandSyncing?: boolean
  commandPolling?: boolean
  onPollCommands?: () => Promise<{ skipped: 'busy' | 'cooldown' } | { count: number }>
  commandRecentlyReceived?: boolean
  commandDeferred?: boolean
}

type PaymentMethodKey = 'cash' | 'card' | 'meal_card' | 'other'

interface PaymentLine {
  id: string
  method: PaymentMethodKey
  amount: number
  label: string
  mediator: number
  brand?: number
  acquirerId?: string | null
  acquirerName?: string | null
}

interface PendingSaleRow {
  saleId:                 number
  saleNumber:             string
  orderNo:                string
  totalPrice:             number
  remainingPaymentAmount: number
  paidAmount:             number
  items: Array<{
    code?:     string
    name:      string
    quantity:  number
    unitPrice: number
    vatRate:   number
    total:     number
  }>
}

const fmt = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'

function cardTailLabel(cardNo?: string): string | null {
  if (!cardNo) return null
  const digits = cardNo.replace(/\D/g, '')
  if (digits.length < 4) return null
  return `****${digits.slice(-4)}`
}

function payMethodIcon(method: string, label: string): string {
  const n = `${method} ${label}`.toLocaleLowerCase('tr-TR')
  if (n.includes('nakit') || n.includes('cash')) return '💵'
  if (n.includes('yemek')) return '🍽️'
  return '💳'
}

function payBrandColor(id: number, name: string): string {
  if (id === 999) return C.install
  const n = name.toLocaleLowerCase('tr-TR')
  if (n.includes('yemek')) return C.meal
  if (n.includes('online')) return C.online
  return C.online
}

function isPavoTimeoutMessage(msg: string): boolean {
  return msg.includes('zaman aşımı') || msg.includes('AbortError')
}

function isNetworkFetchError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('load failed') ||
    m.includes('network request failed') ||
    m.includes('err_connection') ||
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('fetch failed')
  )
}

function networkErrorParts(err: unknown): { title: string; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  if (isNetworkFetchError(message)) {
    return { title: 'Bağlantı kurulamadı', message }
  }
  return { title: 'Hata', message }
}

function deviceResultFromPavoData(data: unknown): PaymentDeviceResult {
  const raw = (data ?? {}) as Record<string, unknown>
  return parsePavoResult(
    raw.Data != null || raw.HasError != null
      ? raw
      : { HasError: false, Data: raw },
  )
}

/** Pavo mediator/brand → PaymentLine (addPaymentLineWithMethod ile ters eşleme) */
function paymentLineFromPavo(p: PavoFinalPayment): PaymentLine {
  const mediator = Number(p.mediator)
  const isCash = mediator === 1
  const isCard = mediator === 2
  return {
    id: crypto.randomUUID(),
    method: (isCash ? 'cash' : isCard ? 'card' : 'other') as PaymentMethodKey,
    amount: Number(p.amount ?? 0),
    label: isCash ? 'Nakit' : isCard ? 'Kredi Kartı' : 'Diğer',
    mediator,
    brand: p.brand,
  }
}

/** Kart/diğer net'i aşamaz; nakit sadece para üstü için ve yalnızca son satırsa aşabilir. */
function isPaymentLinesOverpaid(lines: PaymentLine[], net: number): boolean {
  const round2 = (n: number) => parseFloat(n.toFixed(2))
  const nonCash = round2(lines.filter(l => l.method !== 'cash').reduce((s, l) => s + l.amount, 0))
  const total = round2(lines.reduce((s, l) => s + l.amount, 0))
  const beforeLast = round2(total - (lines[lines.length - 1]?.amount ?? 0))
  return (
    nonCash > net + 0.01 ||
    (total > net + 0.01 && (lines[lines.length - 1]?.method !== 'cash' || beforeLast >= net - 0.01))
  )
}

function pavoSaleClosedFromAddRes(addRes: { data?: unknown; remainingPaymentAmount?: number }): boolean {
  const raw = (addRes.data ?? {}) as Record<string, unknown>
  const d = ((raw.Data && typeof raw.Data === 'object') ? raw.Data : raw) as Record<string, unknown>
  const statusId = Number(d.StatusId ?? 0)
  if (statusId === 4 || statusId === 8) return true
  const totals = paymentTotals(d)
  if (totals.saleTotal <= 0) return false
  return totals.remaining <= 0.009 && !totals.hasWaiting
}

type PavoAddedPayment = {
  StatusId?: unknown
  PaymentMediatorId?: unknown
  PaymentAmount?: unknown
  Brand?: unknown
}

function paymentLinesFromPavoData(data: unknown, fallback: PaymentLine[]): PaymentLine[] {
  const raw = (data ?? {}) as Record<string, unknown>
  const inner = (raw.Data && typeof raw.Data === 'object')
    ? raw.Data as Record<string, unknown>
    : raw
  const added = inner.AddedPayments
  if (!Array.isArray(added)) return fallback

  const realLines: PaymentLine[] = (added as PavoAddedPayment[])
    .filter(p => isSuccessfulPavoPayment(p))
    .map(p => {
      const mediator = Number(p.PaymentMediatorId ?? 0)
      const isCash = mediator === 1
      return {
        id: crypto.randomUUID(),
        method: (isCash ? 'cash' : 'card') as PaymentMethodKey,
        amount: Number(p.PaymentAmount ?? 0),
        label: isCash ? 'Nakit' : 'Kart',
        mediator,
        brand: p.Brand != null ? Number(p.Brand) : undefined,
      }
    })
    .filter(l => l.amount > 0)

  return realLines.length > 0 ? realLines : fallback
}

function paymentAmountsFromLines(lines: PaymentLine[]) {
  return {
    paidAmt: lines.reduce((s, l) => s + l.amount, 0),
    cashAmt: lines.filter(l => l.method === 'cash').reduce((s, l) => s + l.amount, 0),
    cardAmt: lines.filter(l => l.method !== 'cash').reduce((s, l) => s + l.amount, 0),
  }
}

function unwrapPavoInnerData(data: unknown): Record<string, unknown> | undefined {
  const raw = (data ?? {}) as Record<string, unknown>
  if (raw.Data && typeof raw.Data === 'object') return raw.Data as Record<string, unknown>
  return Object.keys(raw).length > 0 ? raw : undefined
}

function vatRateFromPavoItem(pi: Record<string, unknown>): number {
  if (pi.VATRate != null && pi.VATRate !== '') {
    const n = Number(pi.VATRate)
    if (Number.isFinite(n)) return n
  }
  if (pi.VatRate != null && pi.VatRate !== '') {
    const n = Number(pi.VatRate)
    if (Number.isFinite(n)) return n
  }
  const tg = String(pi.TaxGroupCode ?? '')
  const m = tg.match(/KDV(\d+)/i)
  if (m) return Number(m[1])
  return NaN
}

/** Pavo satırı → yerel ürün tablosundan kod/KDV/birim ile CartItem */
async function cartItemFromPavoLine(
  pi: Record<string, unknown>,
  lineEffectTl = 0,
): Promise<CartItem & { needsProductMatch?: boolean; pavoSaleItemId?: number }> {
  const round2 = (n: number) => parseFloat(n.toFixed(2))
  const code = String(pi.StockReference ?? pi.ItemCode ?? pi.code ?? '').trim()
  const nameHint = String(pi.Name ?? pi.ProductName ?? '')

  let product: ProductRow | null = null
  if (code) {
    try {
      product = await window.electron.db.getProductByCode(code)
    } catch { /* ignore */ }
  }
  if (!product && nameHint) {
    try {
      const byName = await window.electron.db.getProductByName(nameHint)
      if (byName) {
        product = {
          id: byName.id,
          code: byName.code,
          name: byName.name,
          price: Number(pi.UnitPriceAmount ?? 0),
          vatRate: byName.vatRate,
          unit: byName.unit,
          stock: 0,
          barcode: '',
          category: '',
        }
      }
    } catch { /* ignore */ }
  }

  if (!product) {
    console.error('[pavo→cart] Ürün bulunamadı', { code, name: nameHint })
  }

  const qty = Number(pi.ItemQuantity ?? pi.Quantity ?? 1)
  const unitPrice = Number(pi.UnitPriceAmount ?? pi.UnitPrice ?? product?.price ?? 0)
  const gross = round2(unitPrice * qty)
  // TotalPriceAmount iskonto sonrası olabilir; yoksa AddedPriceEffects satır tutarı düşülür
  const rawNet = Number(pi.TotalPriceAmount ?? pi.TotalPrice)
  const netTotal = Number.isFinite(rawNet)
    ? round2(rawNet)
    : round2(Math.max(0, gross - lineEffectTl))
  const discountAmount = Math.max(0, round2(gross - netTotal))
  const vatFromPavo = vatRateFromPavoItem(pi)
  const vatRate = product?.vatRate != null && Number.isFinite(Number(product.vatRate))
    ? Number(product.vatRate)
    : vatFromPavo
  // Eksik KDV'yi 0'a çevirme — gerçek %0 ürün yerel tablodan gelir; NaN broken/needsProductMatch yakalar
  const resolvedVat = Number.isFinite(vatRate) ? vatRate : Number.NaN

  const id = crypto.randomUUID()
  const pavoSaleItemId = Number(pi.Id ?? pi.SaleItemId ?? 0) || undefined
  return {
    id,
    productId:    product?.id ?? id,
    code:         (product?.code ?? code).trim(),
    name:         product?.name ?? nameHint,
    barcode:      product?.barcode ?? '',
    category:     product?.category ?? '',
    price:        unitPrice,
    vatRate:      resolvedVat,
    unit:         product?.unit ?? String(pi.UnitCode ?? pi.UnitName ?? 'Adet'),
    quantity:     qty,
    lineTotal:    gross,
    discountRate: 0,
    discountAmount,
    netTotal:     round2(netTotal),
    needsProductMatch: !product || !(product.code ?? code).trim() || !Number.isFinite(resolvedVat),
    pavoSaleItemId,
  }
}

/** Pavo AddedPriceEffects → satır iskontosu (SaleItemId) / belge iskontosu (bağsız) */
function priceEffectsFromPavoData(pavoData: Record<string, unknown> | undefined): {
  bySaleItemId: Map<number, number>
  docDiscountTl: number
} {
  const bySaleItemId = new Map<number, number>()
  let docDiscountTl = 0
  if (!pavoData) return { bySaleItemId, docDiscountTl }

  const rawEffects = (
    pavoData.AddedPriceEffects
    ?? (pavoData.Sale as Record<string, unknown> | undefined)?.AddedPriceEffects
    ?? []
  ) as Array<Record<string, unknown>>

  for (const eff of rawEffects) {
    const amt = Math.abs(Number(
      eff.PriceEffectAmount ?? eff.Amount ?? eff.EffectAmount ?? 0,
    ))
    if (!(amt > 0)) continue
    const saleItemId = Number(eff.SaleItemId ?? eff.RelatedSaleItemId ?? eff.ItemId ?? 0)
    if (saleItemId > 0) {
      bySaleItemId.set(saleItemId, (bySaleItemId.get(saleItemId) ?? 0) + amt)
    } else {
      docDiscountTl += amt
    }
  }

  // Belge seviyesi tek PriceEffect
  const salePe = (pavoData.PriceEffect
    ?? (pavoData.Sale as Record<string, unknown> | undefined)?.PriceEffect) as
    | Record<string, unknown>
    | undefined
  if (salePe && bySaleItemId.size === 0) {
    const amt = Math.abs(Number(salePe.Amount ?? salePe.PriceEffectAmount ?? 0))
    if (amt > 0) docDiscountTl = Math.max(docDiscountTl, amt)
  }

  return { bySaleItemId, docDiscountTl: parseFloat(docDiscountTl.toFixed(2)) }
}

async function cartFromPavoData(
  pavoData: Record<string, unknown> | undefined,
): Promise<Array<CartItem & { needsProductMatch?: boolean }>> {
  const items = (pavoData?.AddedSaleItems
    ?? (pavoData?.Sale as Record<string, unknown> | undefined)?.AddedSaleItems
    ?? []) as Array<Record<string, unknown>>
  const { bySaleItemId } = priceEffectsFromPavoData(pavoData)
  return Promise.all(items.map(pi => {
    const sid = Number(pi.Id ?? pi.SaleItemId ?? 0)
    const lineEffect = sid > 0 ? (bySaleItemId.get(sid) ?? 0) : 0
    return cartItemFromPavoLine(pi, lineEffect)
  }))
}

/** Askıdaki ödeme kalemlerini yerel ürüne bağla */
async function cartFromPendingSaleItems(
  items: PendingSaleRow['items'],
): Promise<Array<CartItem & { needsProductMatch?: boolean }>> {
  return Promise.all(items.map(item => cartItemFromPavoLine({
    StockReference: item.code ?? '',
    Name:           item.name,
    ItemQuantity:   item.quantity,
    UnitPriceAmount: item.unitPrice,
    TotalPriceAmount: item.total || item.unitPrice * item.quantity,
    VATRate:        item.vatRate,
  })))
}

function linesFromPavoData(pavoData: Record<string, unknown> | undefined): PaymentLine[] {
  const payments = (pavoData?.AddedPayments ?? []) as Array<Record<string, unknown>>
  return payments
    .filter(p => isSuccessfulPavoPayment(p))
    .map(p => ({
      id:       crypto.randomUUID(),
      method:   Number(p.PaymentMediatorId) === 1 ? 'cash' as const : 'card' as const,
      amount:   Number(p.PaymentAmount ?? 0),
      label:    Number(p.PaymentMediatorId) === 1 ? 'Nakit' : 'Kredi Kartı',
      mediator: Number(p.PaymentMediatorId),
      brand:    p.BrandId != null ? Number(p.BrandId)
        : p.Brand != null ? Number(p.Brand) : undefined,
    }))
    .filter(l => l.amount > 0)
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

const DEFAULT_HELD_LABEL = /^Bekleyen #\d+ · \d{2}:\d{2}$/

function defaultHeldLabel(seq: number, at = new Date()): string {
  const hm = at.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  return `Bekleyen #${seq} · ${hm}`
}

function PopupItem({ icon, label, hint, disabled, danger, accent = 'var(--pos-primary)', text, layout = 'row', onClick }: {
  icon:     string
  label:    string
  hint?:    string
  disabled?: boolean
  danger?:  boolean
  accent?:  string
  text?:    string
  layout?:  'row' | 'stack'
  onClick?: () => void
}) {
  const tone = danger ? C.danger : accent
  const stacked = layout === 'stack'
  const labelColor = text
    ? (disabled ? 'var(--pos-disabled-fg)' : danger ? '#FFFFFF' : text)
    : '#FFFFFF'
  const hintColor = text
    ? (disabled ? 'var(--pos-disabled-fg)' : 'var(--pos-text-muted)')
    : 'rgba(255,255,255,0.75)'
  return (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      onClick={onClick}
      style={{
        ...solidBtn(tone, !!disabled),
        color: labelColor,
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: stacked ? 8 : 14,
        width: '100%',
        minHeight: stacked ? 96 : 72,
        padding: '12px',
        fontSize: 20,
        textAlign: 'center' as const,
        touchAction: 'manipulation',
      }}
    >
      <span style={{ fontSize: stacked ? 28 : 22, lineHeight: 1 }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
        <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25, color: labelColor }}>{label}</span>
        {hint ? (
          <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.2, color: hintColor }}>{hint}</span>
        ) : null}
      </span>
    </button>
  )
}

export default function POSScreen({
  companyId, cashier, allProducts,
  pluGroups,
  syncedEnabledBrands = null,
  syncedBarcodeFormats = null,
  onBack, onLogout,
  pendingMessage, onMessageClose,
  merkezToast = null,
  onCartChange,
  cartSettings,
  commandListenerActive = false,
  commandSyncing = false,
  commandPolling = false,
  onPollCommands,
  commandRecentlyReceived = false,
  commandDeferred = false,
}: Props) {
  const settings = useSettings()
  const cashBtn = useButtonColor('cash')
  const cardBtn = useButtonColor('card')
  const splitBtn = useButtonColor('split')
  const otherPayBtn = useButtonColor('other_payment')
  const customerBtn = useButtonColor('customer')
  const priceCheckBtn = useButtonColor('price_check')
  const menuBtn = useButtonColor('menu')
  const documentsBtn = useButtonColor('documents')
  const customerDisplay = settings.terminal.customerDisplay

  const touchEnabled = settings.terminal.touchKeyboard
  const { openKeyboard } = useTouchKeyboard(touchEnabled)

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
  const [enabledBrands, setEnabledBrands] = useState<PaymentProviderBrand[]>([])
  const [barcodeFormats, setBarcodeFormats] = useState<BarcodeFormatRow[]>([])
  const [showOtherPayments, setShowOtherPayments] = useState(false)
  const [selectedBrand, setSelectedBrand] = useState<PaymentProviderBrand | null>(null)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [saving, setSaving]               = useState(false)
  const [lastReceipt, setLastReceipt]     = useState<string | null>(null)
  const [returnMode, setReturnMode]       = useState(false)
  const [docDiscountMode, setDocDiscountMode] = useState(false)
  const [cancelNextAdd, setCancelNextAdd] = useState(false)
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
  const [weightEditTarget, setWeightEditTarget] = useState<string | null>(null)
  const [weightEditInput, setWeightEditInput]   = useState('')
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
  const [cariPaymentMethod, setCariPaymentMethod] = useState<'cash' | 'card' | null>(null)
  const [scaleModal, setScaleModal] = useState<{
    product: ProductRow
    weight: number
    tare: number
    stable: boolean
    raw: string
  } | null>(null)
  const [scaleEnabled, setScaleEnabled] = useState(false)
  const [printSelectModal, setPrintSelectModal] = useState<{
    trigger: string
    templates: { id: string; name: string; template_type: string; is_default: boolean; schema?: string }[]
    data: Record<string, Record<string, unknown>>
    multi: boolean
    balanceSession: BalancePrintSession
  } | null>(null)
  const [printCards, setPrintCards] = useState<Record<string, { count: number; error: string | null; busy: boolean }>>({})
  const printBusyRef = useRef(new Map<string, number>())
  const [balanceWait, setBalanceWait] = useState(false)
  const printChainRef = useRef(Promise.resolve())
  const printGenRef = useRef(0)
  const [heldDocs, setHeldDocs]           = useState<HeldDocRow[]>([])
  const [showHeld, setShowHeld]           = useState(false)
  const [heldActiveTab, setHeldActiveTab] = useState<'held' | 'pending'>('held')
  const [pendingSales, setPendingSales]   = useState<PendingSaleRow[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingError, setPendingError]   = useState<string | null>(null)
  const [heldPreview, setHeldPreview]     = useState<HeldDocRow | null>(null)
  const [heldEdit, setHeldEdit]           = useState<{ id: string; label: string } | null>(null)
  const [holdDraft, setHoldDraft]         = useState<{ mode: 'new' | 'edit'; id?: string; note: string } | null>(null)
  const [resumeHoldNote, setResumeHoldNote] = useState('')
  const [barcodeToast, setBarcodeToast]   = useState<string | null>(null)
  const [flashLineId, setFlashLineId]     = useState<string | null>(null)
  const holdNoteRef                       = useRef<HTMLInputElement>(null)
  const barcodeScanRef                    = useRef<(code: string) => void>(() => {})
  const [currentOrderNo, setCurrentOrderNo] = useState<string | null>(null)
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  )
  const [showCustomer, setShowCustomer]   = useState(false)
  const [customers, setCustomers]         = useState<CustomerRow[]>([])
  const [customerQ, setCustomerQ]         = useState('')
  const [customerForm, setCustomerForm] = useState<null | { mode: 'create' | 'edit'; customer?: CustomerRow; query?: string }>(null)
  const [customerPickId, setCustomerPickId] = useState<string | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const [smsPhone, setSmsPhone] = useState('')
  const [mailAddr, setMailAddr] = useState('')
  const [mailModalOpen, setMailModalOpen] = useState(false)
  const [smsPhonePanelOpen, setSmsPhonePanelOpen] = useState(false)
  const [smsPhoneDraft, setSmsPhoneDraft] = useState('')
  const [invoiceType, setInvoiceType] = useState<'e_archive' | 'paper'>('e_archive')
  const [pavoSettings, setPavoSettings] = useState<PavoSettings | null>(null)
  const [pavoLoading, setPavoLoading] = useState(false)
  const pavoLock = usePavoLock()
  const cartLocked = pavoLock.phase !== 'idle'
  const pavoRetryRef = useRef<(() => Promise<void>) | null>(null)
  const recoveryRef = useRef<{
    probe: (orderNo: string) => Promise<RecoveryProbe>
    settle: (orderNo: string, probe: RecoveryProbe) => Promise<void>
    findPending: (orderNo: string) => Promise<PendingLookup>
    releaseMissing: (orderNo: string) => void
  }>({
    probe: async () => ({ success: false, message: 'Kurtarma hazır değil' }),
    settle: async () => {},
    findPending: async () => ({ kind: 'miss' as const }),
    releaseMissing: () => {},
  })
  const [pavoError, setPavoError] = useState<string | null>(null)
  const [pavoRecoveryState, setPavoRecoveryState] = useState<{
    ref: { saleId?: number | null; saleNumber?: string | null }
    orderNo: string
    totalPrice: number
    paidAmount: number
    remainingAmount: number
  } | null>(null)
  const [pavoPendingSaleRef, setPavoPendingSaleRef] = useState<{
    saleId:     number | null
    saleNumber: string | null
    orderNo:    string
    totalPrice: number
    paidAmount: number
  } | null>(null)
  const { dialogProps, showError, showSuccess, showInfo, confirm } = useAlertDialog()
  const posReady = usePosReady()
  const [quickReturnModal, setQuickReturnModal] = useState<QuickReturnModalState | null>(null)
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
  /** Taslak okunmadan sepet boş clearDraft çalışmasın (popup kayboluyordu) */
  const [draftReady, setDraftReady] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const fiyatGorInputRef = useRef<HTMLInputElement>(null)
  const cartListRef = useRef<HTMLDivElement>(null)
  const prevCartLenRef = useRef(0)
  const pavoBusyCheckRef = useRef(false)
  const pavoOpIdRef = useRef(0)
  const pavoIncompleteRef = useRef(false)
  const pavoPendingSaleRefLive = useRef(pavoPendingSaleRef)
  pavoPendingSaleRefLive.current = pavoPendingSaleRef
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

  const showToast = useCallback((msg: string, _type: 'error' | 'success' | 'info' = 'error', ms = 4000) => {
    if (heldToastTimer.current) clearTimeout(heldToastTimer.current)
    setHeldToast(msg)
    heldToastTimer.current = setTimeout(() => setHeldToast(null), ms)
  }, [])

  useEffect(() => { setLockNotifier(msg => showToast(msg, 'info')) }, [showToast])

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
    if (isCartLocked()) { notifyLocked(); return }
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
      setCariPaymentMethod(null)
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
    void window.electron.store.get('terminal_id').then(v => {
      setTerminalId((v as string | null) ?? null)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!terminalId) return
    void (async () => {
      try {
        const token = await window.electron.store.get('token').catch(() => null) as string | null
        const r = await fetch(`${API_URL}/payment-provider-brands/enabled/${terminalId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!r.ok) throw new Error('API başarısız')
        const brands = await r.json() as PaymentProviderBrand[]
        const list = Array.isArray(brands) ? brands : []
        setEnabledBrands(list)
        await window.electron.db.saveEnabledBrands(terminalId, list)
      } catch {
        try {
          const cached = await window.electron.db.getEnabledBrands(terminalId)
          setEnabledBrands(cached)
        } catch {
          /* yok say */
        }
      }
    })()
  }, [terminalId])

  useEffect(() => {
    if (!terminalId) return
    void (async () => {
      try {
        const token = await window.electron.store.get('token').catch(() => null) as string | null
        const r = await fetch(`${API_URL}/barcode-formats/${terminalId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!r.ok) throw new Error('API başarısız')
        const list = parseBarcodeFormatsResponse(await r.json())
        setBarcodeFormats(list)
        await window.electron.db.saveBarcodeFormats(terminalId, list)
      } catch {
        try {
          const cached = await window.electron.db.getBarcodeFormats(terminalId)
          setBarcodeFormats(parseBarcodeFormatsResponse(cached))
        } catch {
          /* yok say */
        }
      }
    })()
  }, [terminalId])

  useEffect(() => {
    if (syncedEnabledBrands !== null) {
      setEnabledBrands(syncedEnabledBrands)
    }
  }, [syncedEnabledBrands])

  useEffect(() => {
    if (syncedBarcodeFormats !== null) {
      setBarcodeFormats(syncedBarcodeFormats)
    }
  }, [syncedBarcodeFormats])

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
    window.__btpos_exit_check = async () => {
      if (isCartLocked()) return { canExit: false, heldCount: 0, pavoLocked: true }
      // Kapanmadan önce sepeti hemen kaydet (3 sn debounce kaçmasın)
      if (cart.length > 0) {
        try {
          const terminalId = await window.electron.store.get('terminal_id') as string | null
          await window.electron.cart.saveDraft({
            companyId,
            terminalId: terminalId ?? '',
            cashierId:  cashier.id,
            cart,
            customer: selectedCustomer ?? null,
          })
        } catch { /* kapanışta kayıt başarısız olsa da çıkış kontrolüne devam */ }
      }

      const allowExit = settings.cashier.allowExitWithHeldDocs ?? true
      if (allowExit) return { canExit: true, heldCount: 0 }

      const count = heldDocs.length
      if (count > 0) {
        return { canExit: false, heldCount: count }
      }
      return { canExit: true, heldCount: 0 }
    }

    return () => {
      delete window.__btpos_exit_check
    }
  }, [
    settings.cashier.allowExitWithHeldDocs,
    heldDocs.length,
    cart,
    companyId,
    cashier.id,
    selectedCustomer,
  ])

  useEffect(() => {
    const cleanup = window.electron.app.onExitBlocked(({ heldCount, pavoLocked }) => {
      if (pavoLocked) {
        showError('Çıkış Engellendi', "Pavo'da devam eden satış var. Önce satışı tamamlayın.")
        return
      }
      showError(
        'Çıkış Engellendi',
        `${heldCount} bekleyen belgeniz var. Belgeleri tamamlayın veya getirip iptal edin.`,
      )
    })
    return cleanup
  }, [showError])

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
    let cancelled = false
    void (async () => {
      try {
        const draft = await window.electron.cart.loadDraft()
        if (cancelled) return
        if (draft && Array.isArray(draft.cart) && draft.cart.length > 0) {
          setDraftModal({
            cart:     draft.cart as CartItem[],
            customer: draft.customer as CustomerRow | null,
            savedAt:  new Date(draft.savedAt).toLocaleString('tr-TR'),
          })
        }
      } catch { /* taslak yok */ }
      finally {
        if (!cancelled) setDraftReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    void window.electron.scale.getSettings()
      .then(s => setScaleEnabled(!!s?.enabled))
      .catch(() => setScaleEnabled(false))
  }, [])

  useEffect(() => {
    if (!scaleEnabled) return
    return window.electron.scale.onData(reading => {
      setScaleModal(prev => {
        if (!prev) return prev
        // Donanım darası tuttuysa (gösterge ~0) yazılımsal darayı bırak
        const tare =
          prev.tare > 0 && reading.weight <= 5 ? 0 : prev.tare
        return {
          ...prev,
          weight: reading.weight,
          stable: reading.stable,
          raw: reading.raw,
          tare,
        }
      })
    })
  }, [scaleEnabled])

  useEffect(() => {
    const apply = () => {
      const row = getPosSnapshot()
      if (isPosDefined(row) && row?.ipAddress && row.serialNo) {
        setPavoSettings({
          ipAddress:       row.ipAddress,
          port:            row.port ?? 9100,
          serialNo:        row.serialNo,
          cardReadTimeout: row.cardReadTimeout ?? 30,
          printWidth:      row.printWidth === '58mm' ? '58mm' : '80mm',
        })
        return
      }
      if (isRecoveryActive() || getPavoPhase() !== 'idle') return
      setPavoSettings(null)
    }
    void refreshPosReady().then(apply)
    return subscribePosReady(apply)
  }, [])

  useEffect(() => {
    setInvoiceType(settings.terminal.invoiceType === 'paper' ? 'paper' : 'e_archive')
  }, [settings.terminal.invoiceType])

  useEffect(() => {
    if (!pavoSettings) return
    if (isRecoveryActive() || getPavoPhase() !== 'idle') return

    void (async () => {
      let lastOrderNo: string | null = null
      try {
        lastOrderNo = await window.electron.store.get('last_pavo_order_no')
          .catch(() => null) as string | null

        if (!lastOrderNo) return
        let holdOrder = false

        console.log('[açılış] Son orderNo bulundu:', lastOrderNo)
        setPavoPhase('sending', { message: 'Askıdaki satış kontrol ediliyor', orderNo: lastOrderNo })

        const seq    = await window.electron.db.nextPavoSequence()
        const result = await pavoGetSaleResult(pavoSettings, seq, lastOrderNo)

        console.log('[açılış] GetSaleResult:', JSON.stringify(result))

        if (result.status === 'uncompleted') {
          console.log('[açılış] StatusId=23 → CompleteUncompletedSale')
          const compSeq = await window.electron.db.nextPavoSequence()
          const compRes = await pavoCompleteUncompletedSale(pavoSettings, compSeq, {
            saleId:     result.saleId     != null && result.saleId     > 0  ? result.saleId     : null,
            saleNumber: result.saleNumber !== '' ? result.saleNumber : null,
            orderNo:    lastOrderNo,
          })
          if (compRes.success) {
            const pavoData  = unwrapPavoInnerData(compRes.data) ?? unwrapPavoInnerData(result.data)
            const cartItems = await cartFromPavoData(pavoData)
            const pavoLines = linesFromPavoData(pavoData)
            const grandTotal = Number(pavoData?.TotalPrice ?? pavoData?.GrossPrice ?? 0)

            let deviceResult = deviceResultFromPavoData(compRes.data ?? result.data)
            try {
              for (let i = 0; i < 4; i++) {
                const seq2 = await window.electron.db.nextPavoSequence()
                const res2 = await pavoGetSaleResult(pavoSettings, seq2, lastOrderNo)
                const norm = normalizePavoSaleResult(res2.data ?? res2)
                const done = res2.statusId === 4 || res2.statusId === 8 || res2.status === 'completed'
                if (done && (norm.invoiceNo || norm.saleUid || norm.inquiryLink)) {
                  deviceResult = deviceResultFromPavoData(norm.raw)
                  break
                }
                if (done && i === 3) {
                  deviceResult = deviceResultFromPavoData(norm.raw)
                  break
                }
                await new Promise(r => setTimeout(r, 1500))
              }
            } catch (e) {
              console.warn('[açılış] fetchFinalPavoResult', e)
            }

            await finalizeSaleToSQLite({
              lines:              pavoLines,
              orderNo:            lastOrderNo,
              deviceResult,
              cartOverride:       cartItems,
              grandTotalOverride: grandTotal,
              recovered:          true,
            })
          } else {
            holdOrder = true
            setPavoPhase('error', { orderNo: lastOrderNo, message: compRes.message ?? 'Önceki satış kapatılamadı' })
            primeStaleWaiting()
          }

        } else if (result.status === 'completed') {
          const existing = await window.electron.db.getSaleByOrderNo(lastOrderNo)
          if (!existing) {
            const pavoData  = unwrapPavoInnerData(result.data)
            const cartItems = await cartFromPavoData(pavoData)
            const pavoLines = linesFromPavoData(pavoData)
            const grandTotal = Number(pavoData?.TotalPrice ?? 0)

            let deviceResult = deviceResultFromPavoData(result.data)
            try {
              for (let i = 0; i < 4; i++) {
                const seq2 = await window.electron.db.nextPavoSequence()
                const res2 = await pavoGetSaleResult(pavoSettings, seq2, lastOrderNo)
                const norm = normalizePavoSaleResult(res2.data ?? res2)
                const done = res2.statusId === 4 || res2.statusId === 8 || res2.status === 'completed'
                if (done && (norm.invoiceNo || norm.saleUid || norm.inquiryLink)) {
                  deviceResult = deviceResultFromPavoData(norm.raw)
                  break
                }
                if (done && i === 3) {
                  deviceResult = deviceResultFromPavoData(norm.raw)
                  break
                }
                await new Promise(r => setTimeout(r, 1500))
              }
            } catch (e) {
              console.warn('[açılış] fetchFinalPavoResult', e)
            }

            await finalizeSaleToSQLite({
              lines:              pavoLines,
              orderNo:            lastOrderNo,
              deviceResult,
              cartOverride:       cartItems,
              grandTotalOverride: grandTotal,
              recovered:          true,
            })
            console.log('[açılış] Tamamlanmış ama kaydedilmemiş satış bulundu, kaydedildi:', lastOrderNo)
          } else {
            console.log('[açılış] Satış zaten tamamlanmış:', lastOrderNo)
          }

        } else if (result.notFound) {
          const listSeq = await window.electron.db.nextPavoSequence()
          const listed = await pavoListPendingSales(pavoSettings, listSeq)
          const stillThere = listed.success && listed.sales.some(s => s.orderNo === lastOrderNo)
          if (!listed.success || stillThere) {
            holdOrder = true
            setPavoPhase('error', { orderNo: lastOrderNo, message: result.message ?? '' })
            primeStaleWaiting()
          } else {
            console.warn('[açılış] Satış cihazda yok, kilit açılmadı:', lastOrderNo)
          }
        } else if (result.status === 'suspended' || result.status === 'pending' || result.success === false) {
          holdOrder = true
          setPavoPhase('error', { orderNo: lastOrderNo, message: result.message ?? '' })
          primeStaleWaiting()
        }

        if (!holdOrder) void window.electron.store.set('last_pavo_order_no', null).catch(() => {})

      } catch (e) {
        console.warn('[açılış] Son satış kontrolü başarısız:', e)
        setPavoPhase('error', {
          orderNo: lastOrderNo ?? undefined,
          message: e instanceof Error ? e.message : String(e),
        })
      } finally {
        if (getPavoPhase() === 'sending' || getPavoPhase() === 'completing') setPavoPhase('idle')
      }
    })()
  }, [pavoSettings, showError, showInfo])

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
    ? (() => {
        const q = normalizetr(searchQ)
        return allProducts.filter(p =>
          normalizetr(p.name).includes(q) ||
          normalizetr(p.code ?? '').includes(q) ||
          (p.barcode ?? '').includes(searchQ)
        )
      })()
    : groupProducts

  const pluCols      = settings.cashier.pluCols
  const pluRows      = settings.cashier.pluRows
  const PLU_PER_PAGE = pluCols * pluRows
  const fontSizeName  = settings.cashier.fontSizeName
  const fontSizePrice = settings.cashier.fontSizePrice
  const fontSizeCode  = settings.cashier.fontSizeCode

  const totalPages = Math.max(1, Math.ceil(filtered.length / PLU_PER_PAGE))
  const safePage   = Math.min(page, totalPages - 1)
  const slice      = filtered.slice(safePage * PLU_PER_PAGE, (safePage + 1) * PLU_PER_PAGE)

  useEffect(() => { setPage(0) }, [activeGroup, pluCols, pluRows])

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

  const parseBarcodeEAN13 = useCallback((barcode: string) => {
    if (barcode.length === 13) {
      const digits = barcode.split('').map(Number)
      const checkSum = digits.slice(0, 12).reduce((sum, d, i) =>
        sum + d * (i % 2 === 0 ? 1 : 3), 0)
      const checkDigit = (10 - (checkSum % 10)) % 10
      if (checkDigit !== digits[12]) {
        console.warn('[barkod] Check digit hatalı:', barcode)
      }
    }
    return parseEAN13(barcode, barcodeFormats)
  }, [barcodeFormats])

  useEffect(() => {
    setRecoveryRuntime({
      probe: orderNo => recoveryRef.current.probe(orderNo),
      settle: (orderNo, probe) => recoveryRef.current.settle(orderNo, probe),
      findPending: orderNo => recoveryRef.current.findPending(orderNo),
      releaseMissing: orderNo => recoveryRef.current.releaseMissing(orderNo),
    })
    const onCode = (e: Event) => {
      const code = (e as CustomEvent<string>).detail
      if (typeof code === 'string') barcodeScanRef.current(code)
    }
    window.addEventListener('btpos-completed-barcode', onCode)
    return () => window.removeEventListener('btpos-completed-barcode', onCode)
  }, [])

  const closePrintSelectRef = useRef<() => void>(() => {})
  closePrintSelectRef.current = closePrintSelect
  useEffect(() => {
    if (!printSelectModal?.multi) return
    let buf = ''
    let gap: ReturnType<typeof setTimeout> | null = null
    const onScan = () => { closePrintSelectRef.current() }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePrintSelectRef.current()
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (e.key === 'Enter') {
        const code = buf
        buf = ''
        if (gap) clearTimeout(gap)
        if (code.length >= 2) {
          closePrintSelectRef.current()
          hideSaleCompleted()
          window.dispatchEvent(new CustomEvent('btpos-completed-barcode', { detail: code }))
        }
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buf += e.key
        if (gap) clearTimeout(gap)
        gap = setTimeout(() => { buf = '' }, 150)
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('btpos-completed-barcode', onScan)
    window.addEventListener('keydown', onKey, true)
    return () => {
      if (gap) clearTimeout(gap)
      window.removeEventListener('btpos-completed-barcode', onScan)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [printSelectModal?.multi])

  /* ── POS açılınca Electron penceresine focus — barkod hemen çalışsın ── */
  useEffect(() => {
    void window.electron.window.focusWindow()
  }, [])

  /* ── Global barkod okuyucu ── */
  useEffect(() => {
    let buf = ''
    let gaps: number[] = []
    let fast = true
    let lastAt = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const onKey = (e: KeyboardEvent) => {
      const lock = document.querySelector('[data-pavo-lock]')
      if (isCartLocked() && getPavoPhase() !== 'open') {
        if (lock && e.target instanceof Node && lock.contains(e.target)) return
        e.preventDefault()
        e.stopPropagation()
        notifyLocked()
        return
      }
      if (e.key === 'Escape') {
        if (lock) return
        const popup = [...document.querySelectorAll<HTMLElement>('[data-pos-popup], .pos-modal')].pop()
        if (popup) {
          popup.querySelector<HTMLElement>('[data-pos-cancel], .pos-modal-close')?.click()
          e.preventDefault()
        }
        return
      }
      if (paymentMode || quickReturnModal || cariPaymentModal) return

      const popup = [...document.querySelectorAll<HTMLElement>('[data-pos-popup], .pos-modal')].pop()
      if (e.key === 'Tab' && popup) {
        const items = [...popup.querySelectorAll<HTMLElement>('input, textarea, select, button')]
          .filter(el => !el.hasAttribute('disabled'))
        if (items.length > 0) {
          const i = items.indexOf(document.activeElement as HTMLElement)
          const next = e.shiftKey
            ? items[(i - 1 + items.length) % items.length]
            : items[(i + 1) % items.length]
          next?.focus()
          e.preventDefault()
        }
        return
      }

      const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
      if (printable) {
        const now = performance.now()
        const gap = buf.length === 0 ? 0 : now - lastAt
        if (buf.length > 0 && gap > 35) {
          buf = ''
          fast = true
        }
        if (buf.length > 0) gaps.push(gap)
        buf += e.key
        lastAt = now
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { buf = ''; gaps = []; fast = true }, 180)
        if (!popup && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          const search = searchRef.current
          if (search && e.key !== '*') {
            search.focus()
            const proto = HTMLInputElement.prototype
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
            setter?.call(search, search.value + e.key)
            search.dispatchEvent(new Event('input', { bubbles: true }))
            e.preventDefault()
          }
        }
        if (e.key === '*' && !popup && /^\d+([.,]\d+)?$/.test(buf.slice(0, -1))) {
          setNumBuf(buf.slice(0, -1).replace('.', ','))
          buf = ''
          e.preventDefault()
        }
        return
      }

      if (e.key !== 'Enter') return
      const code = buf
      const scan = fast && gaps.every(g => g <= 35) && code.length >= 4
      buf = ''
      gaps = []
      fast = true
      if (timer) clearTimeout(timer)
      if (!scan) return

      e.preventDefault()
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        if (active.value.endsWith(code)) {
          const proto = active instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          setter?.call(active, active.value.slice(0, -code.length))
          active.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
      if (menuOpen === 'fiyatgor') {
        applyFiyatGorScan(code)
        return
      }
      if (popup) {
        const inputs = [...popup.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
        const target = (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && popup.contains(active)
          ? active
          : inputs[0]
        if (!target) return
        const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(target, code)
        target.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      setNumBuf('')
      barcodeScanRef.current(code)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [paymentMode, quickReturnModal, cariPaymentModal, menuOpen, applyFiyatGorScan, numBuf])

  /* ── Barkod okuyucu ── */
  useEffect(() => {
    if (searchQ.length < 2) return
    const t = setTimeout(() => {
      if (isCartLocked()) { notifyLocked(); setSearchQ(''); return }
      if (quickReturnModal?.step === 'search') {
        const scannedCode = searchQ
        setSearchQ('')
        setQuickReturnModal(m => m ? { ...m, saleNumber: scannedCode } : m)
        void searchReturnableSale(scannedCode, quickReturnModal.searchBy)
        return
      }

      if (searchQ.length === 13) {
        const flagCode = parseInt(searchQ.slice(0, 2), 10)
        if (flagCode >= 20 && flagCode <= 29) {
          const parsed = parseBarcodeEAN13(searchQ)
          setSearchQ('')
          setNumBuf('')
          if (!parsed) {
            const hasFormat = barcodeFormats.some(f => Number(f.flag_code) === flagCode)
            if (!hasFormat) {
              showError(
                'Barkod Formatı Bulunamadı',
                `Bayrak kodu ${flagCode} bu kasada tanımlı değil. Yönetim panelinden format ekleyip senkronize edin.`,
              )
            } else {
              showError(
                'Barkod Okunamadı',
                `Bayrak ${flagCode} — miktar format kurallarına uymuyor olabilir.`,
              )
            }
            return
          }
          const product = matchProductByInternalBarcode(allProducts, parsed.productBarcode)
          if (!product) {
            showError(
              'Ürün Bulunamadı',
              `Dahili kod: ${parsed.productBarcode} — ürün kartında barkod/kod alanı bu değerle eşleşmiyor.`,
            )
            return
          }
          addToCartWithQty(product, parsed.quantity)
          return
        }
      }

      const byBarcode = allProducts.find(p => p.barcode === searchQ)
      if (!byBarcode) return

      if (isWeighedUnit(byBarcode.unit) && scaleEnabled) {
        setSearchQ('')
        setNumBuf('')
        void window.electron.scale.getLastReading().catch(() => null).then(last => {
          setScaleModal({
            product: byBarcode,
            weight: last?.weight ?? 0,
            tare: 0,
            stable: last?.stable ?? false,
            raw: last?.raw ?? '',
          })
        })
        return
      }

      const qty = numBuf ? Math.max(0.01, parseFloat(numBuf.replace(',', '.'))) : 1
      setNumBuf('')
      setSearchQ('')
      addToCartWithQty(byBarcode, qty)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ, numBuf, allProducts, barcodeFormats, quickReturnModal?.step, scaleEnabled, parseBarcodeEAN13, showError])

  /* ── Sepet işlemleri ── */
  function addToCartWithQty(product: ProductRow, qty: number): string {
    assertCartEditable()
    if (cancelNextAdd) {
      setCancelNextAdd(false)
      cancelOneFromCart(
        cart.find(c => c.productId === product.id)?.id ?? '',
      )
      return ''
    }

    if (cart.length === 0 && !currentOrderNo) {
      setCurrentOrderNo(nextOrderNo(settings.terminal.terminalInfo.terminalNumber))
      setLastReceipt(null)
    }

    let lineId = ''
    setCart(prev => {
      const dup = settings.cashier.duplicateItemAction

      if (dup === 'increase_qty') {
        const exIdx = prev.findIndex(c => c.productId === product.id)
        if (exIdx !== -1) {
          const ex = prev[exIdx]
          lineId = ex.id
          const newQty = ex.quantity + qty
          const newTotal = parseFloat((newQty * ex.price).toFixed(2))
          const netTotal = calcLineDiscount(newTotal, ex.discountRate, ex.discountAmount)
          return prev.map((c, i) => i === exIdx
            ? { ...c, quantity: newQty, lineTotal: newTotal, netTotal }
            : c
          )
        }
      }

      lineId = crypto.randomUUID()
      const lineTotal = parseFloat((product.price * qty).toFixed(2))
      return [...prev, {
        id:          lineId,
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
    return lineId
  }

  function flashCartLine(id: string) {
    if (!id) return
    setFlashLineId(id)
    window.setTimeout(() => {
      document.getElementById(`cart-row-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 40)
    window.setTimeout(() => setFlashLineId(cur => cur === id ? null : cur), 600)
  }

  function showBarcodeMiss(code: string) {
    const msg = `Barkod bulunamadı: ${code}`
    setBarcodeToast(msg)
    window.setTimeout(() => setBarcodeToast(cur => cur === msg ? null : cur), 2200)
  }

  barcodeScanRef.current = (code: string) => {
    if (isCartLocked()) { notifyLocked(); return }
    const scanned = code.trim()
    if (scanned.length < 2) return

    if (scanned.length === 13) {
      const flagCode = parseInt(scanned.slice(0, 2), 10)
      if (flagCode >= 20 && flagCode <= 29) {
        const parsed = parseBarcodeEAN13(scanned)
        if (!parsed) {
          showBarcodeMiss(scanned)
          return
        }
        const product = matchProductByInternalBarcode(allProducts, parsed.productBarcode)
        if (!product) {
          showBarcodeMiss(scanned)
          return
        }
        flashCartLine(addToCartWithQty(product, parsed.quantity))
        playClickSound()
        return
      }
    }

    const byBarcode = allProducts.find(p => p.barcode === scanned || p.code === scanned)
    if (!byBarcode) {
      showBarcodeMiss(scanned)
      return
    }

    if (isWeighedUnit(byBarcode.unit) && scaleEnabled) {
      void window.electron.scale.getLastReading().catch(() => null).then(last => {
        setScaleModal({
          product: byBarcode,
          weight: last?.weight ?? 0,
          tare: 0,
          stable: last?.stable ?? false,
          raw: last?.raw ?? '',
        })
      })
      return
    }

    const qty = numBuf ? Math.max(0.01, parseFloat(numBuf.replace(',', '.'))) : 1
    setNumBuf('')
    flashCartLine(addToCartWithQty(byBarcode, qty))
    playClickSound()
  }

  async function handlePluClick(product: ProductRow) {
    if (isCartLocked()) { notifyLocked(); return }
    if (isWeighedUnit(product.unit) && scaleEnabled) {
      setNumBuf('')
      setSearchQ('')
      searchRef.current?.blur()
      const last = await window.electron.scale.getLastReading().catch(() => null)
      setScaleModal({
        product,
        weight: last?.weight ?? 0,
        tare: 0,
        stable: last?.stable ?? false,
        raw: last?.raw ?? '',
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
    assertCartEditable()
    const minQty = settings.cashier.minQtyPerLine
    setCart(prev => prev.map(c => {
      if (c.id !== id) return c
      const newQty = Math.max(minQty, c.quantity + delta)
      const newTotal = parseFloat((newQty * c.price).toFixed(2))
      const netTotal = calcLineDiscount(newTotal, c.discountRate, c.discountAmount)
      return { ...c, quantity: newQty, lineTotal: newTotal, netTotal }
    }))
  }

  function applyLineDiscount() {
    assertCartEditable()
    if (!lineDiscountTarget) return
    const rate = discMode === 'rate' ? parseFloat(lineDiscRateIn.replace(',', '.')) || 0 : 0
    const amt = discMode === 'amt' ? parseFloat(lineDiscAmtIn.replace(',', '.')) || 0 : 0
    const maxPct = settings.cashier.maxLineDiscountPct
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
    assertCartEditable()
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
    if (isCartLocked()) { notifyLocked(); return }
    if (paymentMode) return
    setSmsPhonePanelOpen(false)
    setMenuOpen(null)
    setPriceEditTarget(itemId)
    setPriceEditInput(price.toFixed(2).replace('.', ','))
  }

  function applyWeightEdit() {
    assertCartEditable()
    if (!weightEditTarget) return
    const raw = weightEditInput.replace(',', '.')
    const qty = parseFloat(raw)
    if (isNaN(qty) || qty <= 0) {
      setWeightEditTarget(null)
      setWeightEditInput('')
      return
    }

    setCart(prev => prev.map(c => {
      if (c.id !== weightEditTarget) return c
      const newTotal = parseFloat((qty * c.price).toFixed(2))
      const netTotal = calcLineDiscount(newTotal, c.discountRate, c.discountAmount)
      return { ...c, quantity: qty, lineTotal: newTotal, netTotal }
    }))

    setWeightEditTarget(null)
    setWeightEditInput('')
  }

  function openWeightEdit(itemId: string, quantity: number) {
    if (isCartLocked()) { notifyLocked(); return }
    if (paymentMode) return
    setSmsPhonePanelOpen(false)
    setMenuOpen(null)
    setWeightEditTarget(itemId)
    setWeightEditInput(quantity.toFixed(3).replace('.', ','))
  }

  function cancelQtyFromNumBuf(): number {
    if (!numBuf) return 1
    const n = parseInt(numBuf.replace(',', '.').split('.')[0] ?? '', 10)
    return Math.max(1, n || 1)
  }

  function removeCartLine(id: string) {
    assertCartEditable()
    setCart(prev => prev.filter(c => c.id !== id))
    resetSlide()
  }

  function cancelOneFromCart(id: string) {
    assertCartEditable()
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
    assertCartEditable()
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
    setCancelNextAdd(false)
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
    if (!companyId || !draftReady) return
    // Popup açıkken boş sepet taslağı silmesin
    if (draftModal) return

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
    }, 800)

    return () => clearTimeout(timer)
  }, [cart, selectedCustomer, companyId, cashier.id, draftReady, draftModal])

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

  /* ── Menü işlemleri ── */

  function openHoldNote() {
    if (isCartLocked()) { notifyLocked(); return }
    if (!cart.length) return
    setMenuOpen(null)
    setHoldDraft({ mode: 'new', note: resumeHoldNote.slice(0, 60) })
  }

  async function commitHoldNote(noteRaw: string, skip: boolean) {
    if (holdDraft?.mode !== 'edit' && isCartLocked()) { notifyLocked(); return }
    if (!holdDraft) return
    const note = (skip ? '' : noteRaw).trim().slice(0, 60)

    if (holdDraft.mode === 'edit' && holdDraft.id) {
      const idx = heldDocs.findIndex(d => d.id === holdDraft.id)
      const label = note || defaultHeldLabel(Math.max(1, idx + 1))
      await window.electron.db.updateHeldDocumentLabel(holdDraft.id, label)
      setHoldDraft(null)
      void loadHeld()
      return
    }

    if (!cart.length) {
      setHoldDraft(null)
      return
    }

    const orderNo = currentOrderNo
      ?? nextOrderNo(settings.terminal.terminalInfo.terminalNumber)
    const label = note || defaultHeldLabel(heldDocs.length + 1)

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
    setResumeHoldNote('')
    setHoldDraft(null)
    clearCart()
    void loadHeld()
  }

  useEffect(() => {
    if (!holdDraft) return
    const t = window.setTimeout(() => holdNoteRef.current?.focus(), 40)
    if (touchEnabled) {
      openKeyboard({
        title: 'Not (isteğe bağlı)',
        initial: holdDraft.note,
        type: 'qwerty',
        onConfirm: (v) => { void commitHoldNote(v.slice(0, 60), false) },
      })
    }
    return () => window.clearTimeout(t)
  }, [holdDraft?.mode, holdDraft?.id, touchEnabled])

  async function retrieveDoc(doc: HeldDocRow) {
    assertCartEditable()
    const items = doc.items.map(normalizeHeldCartItem)
    setCart(items)
    if (doc.customer) {
      applyCustomerSelection(doc.customer)
    } else {
      applyCustomerSelection(null)
    }
    if ((doc.discountRate ?? 0) > 0) {
      setDocDiscountRate(doc.discountRate!)
      setDocDiscountAmt(0)
      setDocDiscMode('rate')
    } else if ((doc.discountAmount ?? 0) > 0) {
      setDocDiscountAmt(doc.discountAmount!)
      setDocDiscountRate(0)
      setDocDiscMode('amt')
    } else {
      // Belge iskontosu kolonlarda yoksa totalAmount ile satır netleri farkından geri yükle
      const lineSum = items.reduce((s, c) => s + c.netTotal, 0)
      const gap = parseFloat(Math.max(0, lineSum - Number(doc.totalAmount ?? 0)).toFixed(2))
      if (gap > 0.009) {
        setDocDiscountAmt(gap)
        setDocDiscountRate(0)
        setDocDiscMode('amt')
      } else {
        setDocDiscountAmt(0)
        setDocDiscountRate(0)
      }
    }
    setCurrentOrderNo(doc.orderNo ?? null)
    const kept = (doc.label ?? '').trim()
    setResumeHoldNote(DEFAULT_HELD_LABEL.test(kept) ? '' : kept.slice(0, 60))
    await window.electron.db.deleteHeldDocument(doc.id)
    void loadHeld()
    setShowHeld(false)
  }

  async function loadPendingSales() {
    if (!pavoSettings) {
      setPendingError('Pavo cihazı bağlı değil.')
      setPendingSales([])
      return
    }
    setPendingLoading(true)
    setPendingError(null)
    try {
      const seq    = await window.electron.db.nextPavoSequence()
      const result = await pavoListPendingSales(pavoSettings, seq)
      if (result.success) {
        setPendingSales(result.sales.map(s => ({
          ...s,
          paidAmount: Number.isFinite(s.paidAmount)
            ? s.paidAmount
            : parseFloat((s.totalPrice - s.remainingPaymentAmount).toFixed(2)),
        })))
        setPendingError(null)
      } else {
        setPendingSales([])
        setPendingError(result.message ?? 'Askıdaki satışlar alınamadı.')
      }
    } catch (e) {
      console.warn('[loadPendingSales] hata:', e)
      setPendingSales([])
      setPendingError(e instanceof Error ? e.message : String(e))
    } finally {
      setPendingLoading(false)
    }
  }

  function showCaughtError(fallbackTitle: string, err: unknown) {
    const parts = networkErrorParts(err)
    showError(
      parts.title === 'Bağlantı kurulamadı' ? parts.title : fallbackTitle,
      parts.message,
    )
  }

  function showApiError(fallbackTitle: string, message?: string | null) {
    const msg = message ?? 'Bilinmeyen hata'
    if (isNetworkFetchError(msg)) {
      showError('Bağlantı kurulamadı', msg)
    } else {
      showError(fallbackTitle, msg)
    }
  }

  function openHeldModal() {
    setShowHeld(true)
    setHeldActiveTab('held')
    void loadPendingSales()
  }

  async function saveHeldLabel() {
    if (!heldEdit) return
    const note = heldEdit.label.trim().slice(0, 60)
    const idx = heldDocs.findIndex(d => d.id === heldEdit.id)
    const label = note || defaultHeldLabel(Math.max(1, idx + 1))
    await window.electron.db.updateHeldDocumentLabel(heldEdit.id, label)
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

  async function printResolvedTemplate(
    trigger: string,
    data: Record<string, Record<string, unknown>>,
    template: { id: string; name: string; schema?: string },
    session: BalancePrintSession,
  ) {
    const terminalId = String(await window.electron.store.get('terminal_id').catch(() => '') ?? '')
    const willFetch = shouldFetchCustomerBalance(
      data,
      template,
      session,
      settings.terminal.torbaCariId,
    )
    if (willFetch) setBalanceWait(true)
    try {
      const payload = await attachBalanceForTemplate(data, template, session, {
        companyId,
        terminalId,
        torbaId: settings.terminal.torbaCariId,
      })
      const result = await window.electron.templates.printWithBehavior({
        triggerType: trigger,
        data: payload,
        templateId: template.id,
        cashierId: cashier.id,
      })
      if (!result.success && result.message) console.warn('[Fiş]', result.message)
      return result
    } finally {
      if (willFetch) setBalanceWait(false)
    }
  }

  async function printIfTemplate(
    trigger: string,
    data: Record<string, Record<string, unknown>>,
  ) {
    try {
      const session = newBalancePrintSession()
      const result = await window.electron.templates.printWithBehavior({
        triggerType: trigger,
        data,
        cashierId: cashier.id,
      })
      if (result.pendingPrint && result.template) {
        await printResolvedTemplate(trigger, data, result.template, session)
        return
      }
      if (result.needsSelection && result.templates?.length) {
        printGenRef.current += 1
        printBusyRef.current.clear()
        setPrintCards({})
        setPrintSelectModal({
          trigger,
          templates: result.templates,
          data:      result.data ?? data,
          multi:     settings.cashier.printMulti === true,
          balanceSession: session,
        })
      } else if (!result.success && result.message) {
        console.warn('[Fiş]', result.message)
      }
    } catch (e) {
      console.warn('[Şablon]', e)
    }
  }

  function closePrintSelect() {
    printGenRef.current += 1
    printBusyRef.current.clear()
    setPrintSelectModal(null)
    setPrintCards({})
  }

  function releasePrintCard(templateId: string, gen: number) {
    if (printBusyRef.current.get(templateId) === gen) printBusyRef.current.delete(templateId)
  }

  function queueTemplatePrint(templateId: string) {
    const modal = printSelectModal
    if (!modal) return
    const template = modal.templates.find(t => t.id === templateId)
    if (!template) return
    if (!modal.multi) {
      const session = modal.balanceSession
      closePrintSelect()
      void printResolvedTemplate(modal.trigger, modal.data, template, session)
      return
    }
    if (printBusyRef.current.has(templateId)) return
    const gen = printGenRef.current
    printBusyRef.current.set(templateId, gen)
    setPrintCards(prev => ({
      ...prev,
      [templateId]: { count: prev[templateId]?.count ?? 0, error: null, busy: true },
    }))
    printChainRef.current = printChainRef.current.then(async () => {
      if (printGenRef.current !== gen) {
        releasePrintCard(templateId, gen)
        return
      }
      try {
        const result = await printResolvedTemplate(
          modal.trigger,
          modal.data,
          template,
          modal.balanceSession,
        )
        if (printGenRef.current !== gen) return
        if (!result.success) {
          setPrintCards(prev => ({
            ...prev,
            [templateId]: {
              count: prev[templateId]?.count ?? 0,
              error: result.message ?? 'Yazdırılamadı',
              busy: false,
            },
          }))
          return
        }
        setPrintCards(prev => ({
          ...prev,
          [templateId]: {
            count: (prev[templateId]?.count ?? 0) + 1,
            error: null,
            busy: false,
          },
        }))
      } catch (e) {
        if (printGenRef.current !== gen) return
        setPrintCards(prev => ({
          ...prev,
          [templateId]: {
            count: prev[templateId]?.count ?? 0,
            error: e instanceof Error ? e.message : 'Yazdırılamadı',
            busy: false,
          },
        }))
      } finally {
        releasePrintCard(templateId, gen)
      }
    })
  }

  async function handleCariPayment() {
    if (!cariPaymentCust || !cariPaymentModal || !companyId) return
    const amount = parseFloat(cariPaymentAmt.replace(',', '.'))
    if (!amount || amount <= 0) return

    const isOdeme = cariPaymentModal === 'odeme'
    const paidMethod: 'cash' | 'card' = isOdeme
      ? 'cash'
      : (cariPaymentMethod === 'card' ? 'card' : 'cash')

    if (isOdeme) {
      const amtLabel = amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const ok = await confirm({
        title: 'Cari Ödeme Onayı',
        message:
          `Kasadan ${amtLabel} ₺ nakit çıkacak ve ${cariPaymentCust.name} carisine ödeme olarak işlenecek. Onaylıyor musunuz?`,
        confirmLabel: 'Onayla',
        cancelLabel: 'Vazgeç',
      })
      if (!ok) return
    }

    setCariPaymentSaving(true)
    setCariPaymentResult(null)

    const terminalName = settings.terminal.terminalInfo.terminalName?.trim() || 'Kasa'
    const customerIdNum = Number.parseInt(cariPaymentCust.id, 10) || 0
    const orderNo = nextOrderNo(settings.terminal.terminalInfo.terminalNumber)
    const reason = `${isOdeme ? 'Ödeme' : 'Tahsilat'} — ${cariPaymentCust.name}`

    try {
      // Cari ödeme Pavo'ya gitmez; yalnızca tahsilat (ayar açıksa) Pavo kullanır
      if (!isOdeme) {
        if (settings.terminal.cariPaymentUsePavo && !isPosReady()) {
          logPosBlocked()
          return
        }
        if (settings.terminal.cariPaymentUsePavo && pavoSettings) {
          const seq = await window.electron.db.nextPavoSequence()
          const nameParts = (cariPaymentCust.name ?? '').split(' ')

          const pavoRes = await pavoAdvanceSale(pavoSettings, seq, {
            orderNo,
            amount,
            reason: cariPaymentDesc.trim() || reason,
            mediator: cariPaymentMethod === 'cash' ? 1
                    : cariPaymentMethod === 'card' ? 2
                    : undefined,
            customer: {
              isPerson:    cariPaymentCust.isPerson ?? true,
              firstName:   cariPaymentCust.isPerson
                ? (cariPaymentCust.firstName || nameParts[0] || '')
                : '',
              lastName:    cariPaymentCust.isPerson
                ? (cariPaymentCust.lastName || nameParts.slice(1).join(' '))
                : '',
              companyName: !cariPaymentCust.isPerson ? cariPaymentCust.name : undefined,
              taxNo:       cariPaymentCust.taxNo ?? '',
              phone:       cariPaymentCust.phone ?? '',
              email:       cariPaymentCust.email ?? '',
              country:     'Türkiye',
              city:        cariPaymentCust.city ?? '',
              district:    cariPaymentCust.district ?? '',
              address:     cariPaymentCust.address ?? '',
            },
            notify: {
              sendSms:  Boolean(smsPhone),
              phone:    smsPhone,
              sendMail: Boolean(mailAddr),
              mail:     mailAddr,
            },
          })

          if (!pavoRes.success) {
            setCariPaymentResult({ ok: false, msg: pavoRes.message ?? 'Pavo tahsilat başarısız' })
            return
          }
        }
      }

      // ── Logo / İşbaşı API ───────────────────────────────────────
      const res = await fetch(`${API_URL}/integration/cari-payment/${companyId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          process_type:    isOdeme ? 2 : 1,
          amount,
          customer_id:     customerIdNum,
          customer_erp_id: cariPaymentCust.id,
          customer_code:   cariPaymentCust.code ?? '',
          customer_name:   cariPaymentCust.name ?? '',
          cashier_name:    cashier.fullName,
          terminal_name:   terminalName,
          description:     cariPaymentDesc.trim() || reason,
          payment_date:    new Date().toISOString().replace('T', ' ').slice(0, 19),
          order_no:        orderNo,
          type:            cariPaymentModal,
        }),
      })
      const data = await res.json() as { success?: boolean; message?: string; label?: string }

      if (!res.ok || !data.success) {
        setCariPaymentResult({
          ok: false,
          msg: data.message ?? (res.ok ? 'Logo kaydı başarısız' : `HTTP ${res.status}`),
        })
        return
      }

      // ── SQLite ──────────────────────────────────────────────────
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
        description:  cariPaymentDesc.trim() || reason,
        createdAt:    new Date().toISOString(),
        method:       paidMethod,
      })

      setCariPaymentResult({
        ok:  true,
        msg: `${isOdeme ? 'Ödeme' : 'Tahsilat'} başarıyla tamamlandı. Tutar: ${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`,
      })
      setCariPaymentAmt('')
      setCariPaymentDesc('')
      setCariPaymentMethod(isOdeme ? 'cash' : null)

      void printIfTemplate(cariPaymentModal, {
        sales: { order_no: orderNo },
        sale_payments: {
          amount,
          method:     paidMethod,
          created_at: new Date().toISOString(),
        },
        customers: {
          id:   cariPaymentCust.id,
          name: cariPaymentCust.name,
          code: cariPaymentCust.code ?? '',
        },
        cashiers:  { full_name: cashier.fullName },
        terminals: { name: terminalName ?? 'Kasa' },
      })
    } catch (e) {
      setCariPaymentResult({ ok: false, msg: String(e) })
    } finally {
      setCariPaymentSaving(false)
    }
  }

  /* ── Ödeme — ara toplam, satır/belge indirimi, KDV, genel toplam ── */
  const araToplamBrut = cart.reduce((s, c) => s + c.price * c.quantity, 0)
  const totalQtyRaw = cart.reduce((s, c) => s + c.quantity, 0)
  const totalQty = parseFloat(totalQtyRaw.toFixed(3))
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
  // Parçalı ödeme: sadece KK Taksit/Puan (999), Pavo yoksa hiçbiri
  const brandPool = settings.terminal.enabledPaymentBrands.length
    ? enabledBrands.filter(b => settings.terminal.enabledPaymentBrands.includes(b.payment_provider_brand_id))
    : enabledBrands
  const karmaVisibleBrands = pavoSettings
    ? brandPool.filter(b => b.payment_provider_brand_id === 999)
    : []
  const otherVisibleBrands = (
    pavoSettings
      ? brandPool
      : brandPool.filter(b => b.payment_provider_brand_id !== 999)
  ).slice().sort((a, b) => {
    if (a.payment_provider_brand_id === 999) return -1
    if (b.payment_provider_brand_id === 999) return 1
    return 0
  })
  const dueTotal = pavoPendingSaleRef
    ? Math.max(0, parseFloat((pavoPendingSaleRef.totalPrice - pavoPendingSaleRef.paidAmount).toFixed(2)))
    : grandTotal
  const remaining = Math.max(0, parseFloat((dueTotal - paidTotal).toFixed(2)))
  const canComplete = remaining === 0 && paymentLines.length > 0
  const commandIconAnimation = commandPolling
    ? 'merkezMailSpin 0.8s linear infinite'
    : commandSyncing
    ? 'merkezMailPulse 0.9s ease-in-out infinite, merkezMailShake 1.4s ease-in-out infinite'
    : commandDeferred
      ? 'merkezMailWaitPulse 1s ease-in-out infinite, merkezMailShake 2s ease-in-out infinite'
      : commandRecentlyReceived
      ? 'merkezMailPulse 1.2s ease-in-out infinite'
      : 'merkezMailIdle 2.6s ease-in-out infinite'
  const envelopeTapRef = useRef(0)
  const [envelopeToast, setEnvelopeToast] = useState<string | null>(null)

  async function handleManualPoll() {
    if (!onPollCommands) return
    try {
      const result = await onPollCommands()
      if ('skipped' in result) {
        if (result.skipped === 'cooldown') {
          setEnvelopeToast('Az önce kontrol edildi, lütfen birkaç saniye bekleyin')
        }
        return
      }
      setEnvelopeToast(result.count > 0 ? `${result.count} yeni komut alındı` : 'Yeni komut yok')
    } catch {
      setEnvelopeToast('Merkeze bağlanılamadı')
    }
  }

  function onEnvelopeTap() {
    const now = Date.now()
    if (now - envelopeTapRef.current < 350) {
      envelopeTapRef.current = 0
      void handleManualPoll()
      return
    }
    envelopeTapRef.current = now
  }

  useEffect(() => {
    if (!envelopeToast) return
    const timer = setTimeout(() => setEnvelopeToast(null), 2800)
    return () => clearTimeout(timer)
  }, [envelopeToast])

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
        label: docDiscountRate > 0 ? `Belge indirimi %${docDiscountRate}` : 'Belge indirimi',
        amount: docDiscountCalc,
        scope: 'document',
        rate: docDiscountRate,
      })
    }

    const payload: SecondScreenPayload = {
      mode: 'cart_and_btpos_gif',
      items: cart.map(item => {
        const gross = parseFloat((item.price * item.quantity).toFixed(2))
        const lineDisc = Math.max(0, parseFloat((gross - item.netTotal).toFixed(2)))
        return {
          name: item.name,
          qty: item.quantity,
          lineTotal: item.netTotal,
          unitPrice: item.price,
          gross,
          discountAmount: lineDisc,
          discountRate: item.discountRate ?? 0,
        }
      }),
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
  }, [cart, customerDisplay, docDiscountCalc, docDiscountRate, grandTotal, lineSubtotal, toplamIndirim, totalQty])

  async function handlePavoRecovery(
    saleRef: { saleId?: number | null; saleNumber?: string | null },
    orderNo: string,
  ) {
    if (!pavoSettings) return
    try {
      const seq = await window.electron.db.nextPavoSequence()
      const pending = await pavoCheckPendingSale(pavoSettings, seq, orderNo)

      if (pending.hasPending) {
        const abanSeq = await window.electron.db.nextPavoSequence()
        await pavoAbandonSuspendedSale(pavoSettings, abanSeq, {
          saleId: pending.saleId && pending.saleId > 0 ? pending.saleId : saleRef.saleId,
          saleNumber: pending.saleNumber ?? saleRef.saleNumber,
          orderNo,
        })
        console.log('[pavo] Recovery: AbandonSuspendedSale tamamlandı')
        setPaymentLines([])
        setActiveMethod(null)
        setPendingAmount('')
        setSelectedBrand(null)
      }
    } catch (e) {
      console.warn('[pavo] Recovery başarısız:', e)
    }
  }

  /** Satış Pavo'da kapandıysa belge alanları gelene kadar GetSaleResult ile kesin sonuç al. */
  async function fetchFinalPavoResult(orderNo: string): Promise<PavoFinalSale | null> {
    if (!pavoSettings) return null
    for (let i = 0; i < 4; i++) {
      try {
        const seq = await window.electron.db.nextPavoSequence()
        const res = await pavoGetSaleResult(pavoSettings, seq, orderNo)
        const norm = normalizePavoSaleResult(res.data ?? (res as unknown as Record<string, unknown>))
        const done = res.statusId === 4 || res.statusId === 8 || res.status === 'completed'
        if (done && (norm.invoiceNo || norm.saleUid || norm.inquiryLink)) return norm
        if (done && i === 3) return norm
      } catch (e) {
        console.warn('[fetchFinalPavoResult]', e)
      }
      await new Promise(r => setTimeout(r, 1500))
    }
    return null
  }

  async function resolvePavoTimeout(opts: {
    lines: PaymentLine[]
    orderNo: string
    cashAmt: number
    cardAmt: number
    paidAmt: number
    saleRef?: { saleId?: number | null; saleNumber?: string | null }
    reason?: 'timeout' | 'network'
    skipInitialDialog?: boolean
  }) {
    pavoIncompleteRef.current = true
    setPaymentLines([])
    setActiveMethod(null)
    setPendingAmount('')
    setSelectedBrand(null)
    void window.electron.store.set('last_pavo_order_no', opts.orderNo).catch(() => {})
    if (!opts.skipInitialDialog) {
      if (opts.reason === 'network') {
        showInfo('Bağlantı kurulamadı', 'Pavo yanıt vermedi. Satış sonucu sorgulanıyor...')
      } else {
        showInfo('Zaman Aşımı', 'Pavo yanıt vermedi. Satış sonucu sorgulanıyor...')
      }
    }
    try {
      const resultSeq = await window.electron.db.nextPavoSequence()
      const saleResult = await pavoGetSaleResult(pavoSettings!, resultSeq, opts.orderNo)

      if (saleResult.success === false) {
        const failMsg = saleResult.message ?? 'Sonuç alınamadı'
        setPavoPhase('error', { message: failMsg })
        if (isNetworkFetchError(failMsg) || opts.reason === 'network') {
          showApiError('Bağlantı kurulamadı', failMsg)
        } else {
          showApiError('Ödeme Alınamadı', failMsg)
        }
        return
      }

      if (saleResult.success && saleResult.status === 'completed') {
        const finalSale = await fetchFinalPavoResult(opts.orderNo)
        await finalizeSaleToSQLite({
          lines: opts.lines,
          orderNo: opts.orderNo,
          deviceResult: finalSale
            ? deviceResultFromPavoData(finalSale.raw)
            : deviceResultFromPavoData(saleResult.data),
          recovered: true,
        })
        return
      }

      if (saleResult.success && saleResult.status === 'uncompleted') {
        const compSeq = await window.electron.db.nextPavoSequence()
        const compRes = await pavoCompleteUncompletedSale(pavoSettings!, compSeq, {
          saleId:     saleResult.saleId     != null && saleResult.saleId     > 0  ? saleResult.saleId     : null,
          saleNumber: saleResult.saleNumber !== '' ? saleResult.saleNumber : null,
          orderNo:    opts.orderNo,
        })
        if (compRes.success) {
          const finalSale = await fetchFinalPavoResult(opts.orderNo)
          await finalizeSaleToSQLite({
            lines: opts.lines,
            orderNo: opts.orderNo,
            deviceResult: finalSale
              ? deviceResultFromPavoData(finalSale.raw)
              : deviceResultFromPavoData(compRes.data ?? saleResult.data),
            recovered: true,
          })
        } else {
          showApiError('Hata', compRes.message ?? 'Satış kapatılamadı.')
        }
        return
      }

      await handlePavoRecovery(
        opts.saleRef ?? { saleId: null, saleNumber: null },
        opts.orderNo,
      )
      setPavoPhase('idle')
      showError(
        'Satış Tamamlanamadı',
        'Ödeme alınamadı. Aynı ödeme yöntemine tekrar tıklayarak devam edebilirsiniz.',
      )
    } catch (e) {
      setPavoPhase('error', { message: e instanceof Error ? e.message : String(e) })
      showCaughtError('Bağlantı kurulamadı', e)
    }
  }

  async function handleDurumSorgula() {
    if (!pavoSettings || !currentOrderNo) return
    if (pavoBusyCheckRef.current) return
    pavoBusyCheckRef.current = true

    const lines = paymentLines.length > 0 ? paymentLines : [{
      id: crypto.randomUUID(),
      method: 'card' as const,
      amount: grandTotal,
      label: 'Kredi Kartı',
      mediator: 2,
    }]

    try {
      const seq = await window.electron.db.nextPavoSequence()
      const pending = await pavoCheckPendingSale(pavoSettings, seq, currentOrderNo)

      if (pending.success === false) {
        showApiError('Ödeme Alınamadı', pending.message ?? 'Sorgu başarısız')
        setSaving(false)
        setPavoLoading(false)
        return
      }

      if (pending.hasPending) {
        const remaining = pending.remainingPaymentAmount ?? 0
        const total = (pending.totalPrice && pending.totalPrice > 0)
          ? pending.totalPrice
          : grandTotal

        if (remaining <= 0) {
          pavoOpIdRef.current += 1
          const compSeq = await window.electron.db.nextPavoSequence()
          const compRes = await pavoCompleteUncompletedSale(pavoSettings, compSeq, {
            saleId: pending.saleId,
            saleNumber: pending.saleNumber,
            orderNo: currentOrderNo,
          })
          if (!compRes.success) {
            showApiError('Satış Tamamlanamadı', compRes.message ?? 'Askıdaki satış kapatılamadı.')
            setSaving(false)
            setPavoLoading(false)
            return
          }
          const resultSeq = await window.electron.db.nextPavoSequence()
          const saleResult = await pavoGetSaleResult(pavoSettings, resultSeq, currentOrderNo)
          const finalSale = await fetchFinalPavoResult(currentOrderNo)
          await finalizeSaleToSQLite({
            lines,
            orderNo: currentOrderNo,
            deviceResult: finalSale
              ? deviceResultFromPavoData(finalSale.raw)
              : deviceResultFromPavoData(compRes.data ?? saleResult.data),
            recovered: true,
          })
          setSaving(false)
          setPavoLoading(false)
          return
        }

        if (remaining >= total) {
          pavoOpIdRef.current += 1
          const abanSeq = await window.electron.db.nextPavoSequence()
          await pavoAbandonSuspendedSale(pavoSettings, abanSeq, {
            saleId: pending.saleId,
            saleNumber: pending.saleNumber,
            orderNo: currentOrderNo,
          })
          setPaymentLines([])
          setActiveMethod(null)
          setPendingAmount('')
          setSelectedBrand(null)
          setSaving(false)
          setPavoLoading(false)
          showInfo('Ödeme Alınamadı', 'Satış tamamlanamadı, tekrar deneyebilirsiniz.')
          return
        }

        pavoOpIdRef.current += 1
        setPaymentLines([])
        setActiveMethod(null)
        setPendingAmount(
          remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 }),
        )
        setSelectedBrand(null)
        setPavoRecoveryState({
          ref: { saleId: pending.saleId, saleNumber: pending.saleNumber },
          orderNo: currentOrderNo,
          totalPrice: total,
          paidAmount: parseFloat((total - remaining).toFixed(2)),
          remainingAmount: remaining,
        })
        setPavoPhase('open', { orderNo: currentOrderNo, amount: total })
        setSaving(false)
        setPavoLoading(false)
        return
      }

      const resultSeq = await window.electron.db.nextPavoSequence()
      const saleResult = await pavoGetSaleResult(pavoSettings, resultSeq, currentOrderNo)

      if (saleResult.success === false) {
        showApiError('Ödeme Alınamadı', saleResult.message ?? 'Sonuç alınamadı')
        setSaving(false)
        setPavoLoading(false)
        return
      }

      if (saleResult.status === 'completed') {
        pavoOpIdRef.current += 1
        const finalSale = await fetchFinalPavoResult(currentOrderNo)
        await finalizeSaleToSQLite({
          lines,
          orderNo: currentOrderNo,
          deviceResult: finalSale
            ? deviceResultFromPavoData(finalSale.raw)
            : deviceResultFromPavoData(saleResult.data),
        })
        setSaving(false)
        setPavoLoading(false)
        return
      }

      if (saleResult.status === 'uncompleted') {
        pavoOpIdRef.current += 1
        const compSeq = await window.electron.db.nextPavoSequence()
        const compRes = await pavoCompleteUncompletedSale(pavoSettings, compSeq, {
          saleId:     saleResult.saleId     != null && saleResult.saleId     > 0  ? saleResult.saleId     : null,
          saleNumber: saleResult.saleNumber !== '' ? saleResult.saleNumber : null,
          orderNo:    currentOrderNo,
        })
        if (compRes.success) {
          const pavoData  = unwrapPavoInnerData(compRes.data) ?? unwrapPavoInnerData(saleResult.data)
          const cartItems = await cartFromPavoData(pavoData)
          const finalSale = await fetchFinalPavoResult(currentOrderNo)
          await finalizeSaleToSQLite({
            lines,
            orderNo: currentOrderNo,
            deviceResult: finalSale
              ? deviceResultFromPavoData(finalSale.raw)
              : deviceResultFromPavoData(compRes.data ?? saleResult.data),
            cartOverride: cart.length > 0 ? undefined : (cartItems.length > 0 ? cartItems : undefined),
            grandTotalOverride: cart.length > 0 ? undefined : (pavoData?.TotalPrice != null ? Number(pavoData.TotalPrice) : undefined),
          })
        } else {
          showApiError('Hata', compRes.message ?? 'Satış kapatılamadı.')
        }
        setSaving(false)
        setPavoLoading(false)
        return
      }

      showInfo('Sonuç Alınamadı', 'Ödeme alınamadı, tekrar deneyebilirsiniz.')
      setSaving(false)
      setPavoLoading(false)
    } catch (e) {
      showCaughtError('Sorgu Hatası', e)
      setSaving(false)
      setPavoLoading(false)
    } finally {
      pavoBusyCheckRef.current = false
    }
  }

  async function finalizeSaleToSQLite(opts: {
    lines: PaymentLine[]
    orderNo: string
    deviceResult?: PaymentDeviceResult
    cashAmt?: number
    cardAmt?: number
    paidAmt?: number
    cartOverride?: CartItem[]
    grandTotalOverride?: number
    recovered?: boolean
  }) {
    if (!claimSaleSettle(opts.orderNo)) return
    if (getPavoPhase() !== 'idle') {
      setPavoPhase('completing', opts.recovered
        ? { message: 'Ödeme alınmış, satış kaydediliyor…' }
        : undefined)
    }
    try {
    const alreadySaved = await window.electron.db.getSaleByOrderNo(opts.orderNo).catch(() => null)
    if (alreadySaved) {
      setPavoPhase('idle')
      void window.electron.store.set('last_pavo_order_no', null).catch(() => {})
      return
    }
    const {
      orderNo, deviceResult,
      cartOverride, grandTotalOverride,
    } = opts
    void window.electron.store.set('last_pavo_order_no', opts.orderNo).catch(() => {})
    const terminalLabel = settings.terminal.terminalInfo.terminalName?.trim() || 'Kasa'

    const effectiveCart = cartOverride ?? cart
    const effectiveLineSubtotal = effectiveCart.reduce((s, c) => s + c.netTotal, 0)
    // Belge iskontosu: oran veya tutar; askı/Pavo'da grandTotalOverride ile kuruş farkı da burada kapanır
    const fromStateDocDisc = docDiscountRate > 0
      ? parseFloat((effectiveLineSubtotal * docDiscountRate / 100).toFixed(2))
      : docDiscountAmt
    const effectiveTotal = grandTotalOverride
      ?? Math.max(0, parseFloat((effectiveLineSubtotal - fromStateDocDisc).toFixed(2)))
    const effectiveDocDiscCalc = parseFloat(
      Math.max(0, effectiveLineSubtotal - effectiveTotal).toFixed(2),
    )

    const round2 = (n: number) => parseFloat(n.toFixed(2))
    const net = effectiveTotal

    // Koruma 3: Pavo satışında ödemeler SADECE Pavo'dan; lines'a asla düşme
    let pavoPayments =
      deviceResult?.payments
      ?? (deviceResult?.raw ? normalizePavoSaleResult(deviceResult.raw).payments : [])
      ?? []
    if (!Array.isArray(pavoPayments)) pavoPayments = []

    if (deviceResult && pavoPayments.length === 0) {
      const again = await fetchFinalPavoResult(opts.orderNo)
      pavoPayments = again?.payments ?? []
    }

    if (deviceResult && pavoPayments.length === 0) {
      const hasCardEvidence = !!(deviceResult.authCode || deviceResult.cardNo)
      console.error('[finalize] Pavo ödeme listesi boş', {
        orderNo: opts.orderNo, hasCardEvidence,
      })
      pavoPayments = hasCardEvidence
        ? [{ mediator: 2, amount: net }]
        : [{ mediator: 1, amount: net }]
    }

    const effectiveLines: PaymentLine[] = deviceResult
      ? pavoPayments.map(p => paymentLineFromPavo(p))
      : opts.lines

    const cashAmt = round2(
      effectiveLines.filter(l => l.method === 'cash').reduce((s, l) => s + l.amount, 0),
    )
    const cardAmt = round2(
      effectiveLines.filter(l => l.method !== 'cash').reduce((s, l) => s + l.amount, 0),
    )
    const paidAmt = round2(cashAmt + cardAmt)

    if (cardAmt > net + 0.01 || (deviceResult && paidAmt > net + 0.01)) {
      console.error('[finalize] Ödeme toplamı satış tutarını aşıyor', {
        net, effectiveLines, pavoPayments,
      })
    }

    const normFromDevice = deviceResult?.raw
      ? normalizePavoSaleResult(deviceResult.raw)
      : null
    const pavoData = (deviceResult?.raw?.Data as Record<string, unknown> | undefined)
      ?? (normFromDevice?.raw?.Data as Record<string, unknown> | undefined)
    const printOrderNo = String(
      pavoData?.OrderNo
      ?? (pavoData?.Sale as Record<string, unknown> | undefined)?.OrderNo
      ?? orderNo,
    )

    type RawPayment = {
      StatusId?: unknown
      PaymentMediatorId?: unknown
      PaymentAmount?: unknown
      OnlinePayment?: { AcquirerId?: unknown; AcquirerName?: unknown }
      CashPayment?: { GivenAmount?: unknown }
    }
    const rawData = (deviceResult?.raw?.Data as { AddedPayments?: unknown[]; IsOffline?: boolean } | undefined)
    const addedPayments = Array.isArray(rawData?.AddedPayments) ? rawData.AddedPayments : []
    const successPayments = addedPayments
      .map(p => p as RawPayment)
      .filter(p => isSuccessfulPavoPayment(p))
    const cashPayments = successPayments.filter(p => Number(p.PaymentMediatorId) === 1)
    const actualCashAmt = cashPayments.length > 0
      ? cashPayments.reduce((s, p) => s + Number(p.PaymentAmount ?? 0), 0)
      : cashAmt
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
    const firstCard = cardPaymentsRaw[0]
    const cardAcquirerId = firstCard?.OnlinePayment?.AcquirerId != null
      ? String(firstCard.OnlinePayment.AcquirerId)
      : null
    // deviceResult belge alanlarını zenginleştir (nakit kapanış dahil)
    const enrichedDevice: PaymentDeviceResult | undefined = deviceResult
      ? {
          ...deviceResult,
          invoiceNo:     deviceResult.invoiceNo ?? normFromDevice?.invoiceNo ?? null,
          documentUuid:  deviceResult.documentUuid ?? normFromDevice?.documentUuid ?? null,
          saleUid:       deviceResult.saleUid ?? normFromDevice?.saleUid ?? null,
          inquiryLink:   deviceResult.inquiryLink ?? normFromDevice?.inquiryLink ?? deviceResult.receiptUrl ?? null,
          saleNumber:    deviceResult.saleNumber ?? normFromDevice?.saleNumber ?? null,
          authCode:      deviceResult.authCode ?? normFromDevice?.authCode ?? undefined,
          cardNo:        deviceResult.cardNo ?? normFromDevice?.cardNo ?? undefined,
          acquirer:      deviceResult.acquirer ?? normFromDevice?.acquirer ?? undefined,
          batchNo:       deviceResult.batchNo ?? normFromDevice?.batchNo ?? undefined,
          isOffline:     deviceResult.isOffline ?? normFromDevice?.isOffline,
          receiptUrl:    deviceResult.receiptUrl ?? normFromDevice?.inquiryLink ?? undefined,
          payments:      pavoPayments,
        }
      : undefined

    const salePaymentType: 'cash' | 'card' | 'mixed' =
      cashAmt > 0 && cardAmt > 0 ? 'mixed' : cashAmt > 0 ? 'cash' : 'card'
    const saleRow = {
      orderNo: printOrderNo,
      totalAmount: effectiveLineSubtotal,
      discountRate: docDiscountRate,
      discountAmount: effectiveDocDiscCalc,
      netAmount: effectiveTotal,
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
    const { allocateDocDiscount, assertAllocatedTotal } = await import('../lib/saleDiscount')
    const allocated = allocateDocDiscount(
      effectiveCart.map(c => ({
        quantity: c.quantity,
        unitPrice: c.price,
        discountAmount: c.discountAmount,
        discountRate: c.discountRate,
        afterLineNet: c.netTotal,
        productId: c.productId,
        code: c.code,
        name: c.name,
        vatRate: c.vatRate,
      })),
      effectiveDocDiscCalc,
    )
    assertAllocatedTotal(allocated, effectiveTotal, '[finalize/iskonto]')

    const { saleId, receiptNo } = await window.electron.db.saveSale(saleRow, allocated.map(a => ({
      productId: a.source.productId,
      productCode: a.source.code,
      productName: a.source.name,
      quantity: a.quantity,
      unitPrice: a.unitPriceGross,
      vatRate: a.source.vatRate,
      discountRate: a.source.discountRate ?? 0,
      discountAmount: a.lineDiscount + a.docDiscountShare,
      lineTotal: a.netAmount,
      appliedBy: cashier.id,
      unitPriceGross: a.unitPriceGross,
      grossAmount: a.grossAmount,
      lineDiscount: a.lineDiscount,
      docDiscountShare: a.docDiscountShare,
      netAmount: a.netAmount,
    })), enrichedDevice)

    // Görev 2 — kodsuz/KDV'siz satır: satışı kaydet, ERP'ye ekleme
    const brokenItems = effectiveCart.filter(i =>
      !String(i.code ?? '').trim() || !Number.isFinite(Number(i.vatRate)),
    )
    const skipErp = brokenItems.length > 0
    if (skipErp) {
      console.error('[finalize] Kodsuz/KDV\'siz satır', brokenItems.map(b => ({
        name: b.name, code: b.code, vatRate: b.vatRate,
      })))
      try {
        await window.electron.db.markInvoiceError(
          saleId,
          `Ürün kodu/KDV eksik: ${brokenItems.map(b => b.name).join(', ')}`,
        )
      } catch (e) {
        console.warn('[finalize] markInvoiceError', e)
      }
      showError(
        'ERP\'ye Gönderilemedi',
        `Satış kaydedildi ama ürün eşleşmesi eksik: ${brokenItems.map(b => b.name).join(', ')}`,
      )
    }

    const cardBankKeys = Object.keys(cardByBank)
    let cardIdx = 0
    const paymentRows: SalePaymentRow[] = effectiveLines.map(line => {
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

    if (!skipErp && selectedCustomer && saleId && companyId) {
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
    const cashGiven = cashPayments.length > 0
      ? cashPayments.reduce(
          (s, p) => s + Number(p.CashPayment?.GivenAmount ?? p.PaymentAmount ?? 0),
          0,
        )
      : cashAmt
    const changeAmount = Math.max(0, parseFloat((cashGiven - actualCashAmt).toFixed(2)))

    const barcodeValue =
      enrichedDevice?.inquiryLink
      || enrichedDevice?.saleUid
      || enrichedDevice?.invoiceNo
      || printOrderNo

    const receiptBase = buildSaleReceiptData({
      receiptNo,
      orderNo: printOrderNo,
      companyId,
      cashier: { id: cashier.id, fullName: cashier.fullName },
      cart: effectiveCart,
      paymentType: salePaymentType,
      paymentLabel,
      cashAmount: cashAmt,
      cardAmount: cardAmt,
      paidAmount: paidAmt,
      docDiscountRate: docDiscountRate,
      docDiscountAmount: effectiveDocDiscCalc,
      customer: selectedCustomer,
      terminalId: terminalId ?? '',
      terminalName: terminalLabel,
      terminalNumber: settings.terminal.terminalInfo.terminalNumber,
      workplace: {
        name: settings.terminal.terminalInfo.workplace?.name,
        address: settings.terminal.terminalInfo.workplace?.address,
        phone: settings.terminal.terminalInfo.workplace?.phone,
        city: settings.terminal.terminalInfo.workplace?.city,
        district: settings.terminal.terminalInfo.workplace?.district,
        taxOffice: settings.terminal.terminalInfo.workplace?.taxOffice,
        taxNo: settings.terminal.terminalInfo.workplace?.taxNo,
      },
      planName: license?.planName ?? '',
      changeAmount,
      paymentLines: paymentRows,
      firstCardAcquirerName: firstCardPayment?.acquirerName ?? '',
    })

    void printIfTemplate('satis', {
      ...receiptBase,
      sales: {
        ...receiptBase.sales,
        pavo_invoice_no:   enrichedDevice?.invoiceNo ?? '',
        pavo_sale_uid:     enrichedDevice?.saleUid ?? '',
        pavo_inquiry_link: enrichedDevice?.inquiryLink ?? '',
        pavo_sale_number:  enrichedDevice?.saleNumber ?? '',
        barcode: barcodeValue,
      },
    })

    setPaymentMode(false)
    setPaymentLines([])
    setActiveMethod(null)
    setPendingAmount('')
    setSelectedBrand(null)
    pavoIncompleteRef.current = false
    setPavoPendingSaleRef(null)
    void window.electron.store.set('last_pavo_order_no', null).catch(() => {})
    setCurrentOrderNo(null)
    setPavoPhase('idle')
    clearCart()
    if (scaleEnabled) void window.electron.scale.write('T').catch(() => {})
    setLastReceipt(printOrderNo)
    searchRef.current?.focus()
    const shown = effectiveLines.map(line => ({ label: line.label, amount: line.amount, method: line.method }))
    if (changeAmount > 0.009) {
      for (let i = shown.length - 1; i >= 0; i--) {
        if (shown[i].method === 'cash') {
          shown[i] = { ...shown[i], amount: parseFloat((shown[i].amount + changeAmount).toFixed(2)) }
          break
        }
      }
    }
    showSaleCompleted({
      total: effectiveTotal,
      payments: shown.map(p => ({ label: p.label, amount: p.amount })),
      changeAmount,
      receiptNo: String(receiptNo),
      orderNo: printOrderNo,
      zNo: readZNo(deviceResult?.raw),
      recovered: opts.recovered === true,
    })
    } catch (e) {
      releaseSaleSettle(opts.orderNo)
      throw e
    }
  }

  function addPaymentLineWithMethod(
    method: PaymentMethodKey,
    brand: PaymentProviderBrand | null,
    forceAmount?: number,
  ) {
    const raw = forceAmount !== undefined
      ? forceAmount
      : parseFloat(pendingAmount.replace(/\./g, '').replace(',', '.')) || 0

    if (raw <= 0 || remaining <= 0) return

    const isTaksit = method === 'other' && brand?.payment_provider_brand_id === 999

    setPaymentLines(prev => [...prev, {
      id:       crypto.randomUUID(),
      method:   isTaksit ? 'card' : method,
      amount:   Math.round(raw * 100) / 100,
      label:    isTaksit ? 'KK Taksit/Puan'
        : method === 'cash' ? 'Nakit'
        : method === 'card' ? 'Kredi Kartı'
        : brand?.payment_provider_brand_nm ?? 'Diğer',
      mediator: isTaksit ? 2 : method === 'cash' ? 1
        : method === 'card' ? 2 : brand?.payment_mediator ?? 14,
      brand: isTaksit ? 999
        : method === 'other' ? brand?.payment_provider_brand_id : undefined,
    }])
    setPendingAmount('')
    setActiveMethod(null)
    setSelectedBrand(null)
  }

  function logPosBlocked() {
    console.log('[pos] blocked: no device defined')
    void window.electron.app.log('[pos] blocked: no device defined').catch(() => {})
    showInfo('Satış kapalı', POS_UNDEFINED_MESSAGE)
  }

  async function completeSale(forcedLines?: PaymentLine[]) {
    const lines = forcedLines ?? paymentLines
    if (!cart.length || lines.length === 0) return
    if (!isPosReady() && !isRecoveryActive() && getPavoPhase() === 'idle') {
      logPosBlocked()
      return
    }

    if (saving || pavoLoading) {
      await handleDurumSorgula()
      return
    }

    const round2 = (n: number) => parseFloat(n.toFixed(2))
    const pendingRef = pavoPendingSaleRefLive.current ?? pavoPendingSaleRef

    // Koruma 1 — ödeme satırları satış (veya kalan) tutarını aşamaz; Pavo'ya gitmeden önce
    const netCheck = pendingRef
      ? round2(Math.max(0, pendingRef.totalPrice - pendingRef.paidAmount))
      : round2(grandTotal)
    if (isPaymentLinesOverpaid(lines, netCheck)) {
      const total = round2(lines.reduce((s, l) => s + l.amount, 0))
      showError(
        'Ödeme Tutarı Hatalı',
        `Ödeme satırları (${total.toFixed(2)} ₺) satış tutarını (${netCheck.toFixed(2)} ₺) aşıyor. Satırları kontrol edin.`,
      )
      return
    }

    if (pendingRef && pavoSettings) {
      console.log('[completeSale] AddPayment pendingRef:', JSON.stringify(pendingRef))
      await completeSaleWithAddPayment(lines, pendingRef)
      return
    }

    if (currentOrderNo && pavoSettings && pavoIncompleteRef.current) {
      pavoIncompleteRef.current = false
      try {
        const seq = await window.electron.db.nextPavoSequence()
        const pending = await pavoCheckPendingSale(pavoSettings, seq, currentOrderNo)

        if (pending.hasPending) {
          const remaining = pending.remainingPaymentAmount ?? 0
          const total = (pending.totalPrice && pending.totalPrice > 0)
            ? pending.totalPrice
            : grandTotal

          if (remaining <= 0) {
            const compSeq = await window.electron.db.nextPavoSequence()
            const compRes = await pavoCompleteUncompletedSale(pavoSettings, compSeq, {
              saleId: pending.saleId,
              saleNumber: pending.saleNumber,
              orderNo: currentOrderNo,
            })
            if (!compRes.success) {
              pavoIncompleteRef.current = true
              showApiError('Satış Tamamlanamadı', compRes.message ?? 'Askıdaki satış kapatılamadı.')
              return
            }
            const finalSale = await fetchFinalPavoResult(currentOrderNo)
            await finalizeSaleToSQLite({
              lines,
              orderNo: currentOrderNo,
              deviceResult: finalSale
                ? deviceResultFromPavoData(finalSale.raw)
                : deviceResultFromPavoData(compRes.data),
            })
            return
          }

          if (remaining >= total * 0.99) {
            const abanSeq = await window.electron.db.nextPavoSequence()
            await pavoAbandonSuspendedSale(pavoSettings, abanSeq, {
              saleId: pending.saleId,
              saleNumber: pending.saleNumber,
              orderNo: currentOrderNo,
            })
            setPaymentLines([])
            setActiveMethod(null)
            setPendingAmount('')
            setSelectedBrand(null)
          } else {
            setPaymentLines([])
            setActiveMethod(null)
            setPendingAmount(
              remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 }),
            )
            setSelectedBrand(null)
            setPavoRecoveryState({
              ref: { saleId: pending.saleId, saleNumber: pending.saleNumber },
              orderNo: currentOrderNo,
              totalPrice: total,
              paidAmount: parseFloat((total - remaining).toFixed(2)),
              remainingAmount: remaining,
            })
            setPavoPhase('open', { orderNo: currentOrderNo, amount: total })
            return
          }
        } else {
          const resultSeq = await window.electron.db.nextPavoSequence()
          const saleResult = await pavoGetSaleResult(pavoSettings, resultSeq, currentOrderNo)

          console.log('[completeSale] GetSaleResult:', JSON.stringify(saleResult))

          if (saleResult.status === 'completed') {
            const finalSale = await fetchFinalPavoResult(currentOrderNo)
            await finalizeSaleToSQLite({
              lines,
              orderNo: currentOrderNo,
              deviceResult: finalSale
                ? deviceResultFromPavoData(finalSale.raw)
                : deviceResultFromPavoData(saleResult.data),
            })
            setCurrentOrderNo(null)
            return

          } else if (saleResult.status === 'uncompleted') {
            console.log('[completeSale] StatusId=23 → CompleteUncompletedSale')
            const compSeq = await window.electron.db.nextPavoSequence()
            const compRes = await pavoCompleteUncompletedSale(pavoSettings, compSeq, {
              saleId:     saleResult.saleId     != null && saleResult.saleId     > 0  ? saleResult.saleId     : null,
              saleNumber: saleResult.saleNumber !== '' ? saleResult.saleNumber : null,
              orderNo:    currentOrderNo,
            })
            if (compRes.success) {
              const pavoData = unwrapPavoInnerData(compRes.data) ?? unwrapPavoInnerData(saleResult.data)
              const cartItems = await cartFromPavoData(pavoData)
              const effectiveCart = cart.length > 0 ? undefined : cartItems
              const effectiveTotal = cart.length > 0
                ? grandTotal
                : Number(pavoData?.TotalPrice ?? grandTotal)

              const finalSale = await fetchFinalPavoResult(currentOrderNo)
              await finalizeSaleToSQLite({
                lines,
                orderNo: currentOrderNo,
                deviceResult: finalSale
                  ? deviceResultFromPavoData(finalSale.raw)
                  : deviceResultFromPavoData(compRes.data ?? saleResult.data),
                cartOverride: effectiveCart,
                grandTotalOverride: effectiveCart ? effectiveTotal : undefined,
              })
            } else {
              showApiError('Hata', compRes.message ?? 'Satış kapatılamadı.')
            }
            setCurrentOrderNo(null)
            return

          } else {
            setCurrentOrderNo(null)
          }
        }
      } catch (e) {
        console.warn('[completeSale] Pavo kontrol hatası:', e)
        pavoIncompleteRef.current = true
        setPaymentLines([])
        setActiveMethod(null)
        setPendingAmount('')
        setSelectedBrand(null)
      }
    }

    const isKarma = lines.length > 1
    console.log('[completeSale] paymentLines:', JSON.stringify(lines), 'isKarma:', isKarma)

    if (pavoSettings && isKarma) {
      await completeSaleKarma(lines)
    } else {
      await completeSaleSingle(lines)
    }
  }

  async function completeSaleWithAddPayment(
    lines: PaymentLine[],
    saleRef: {
      saleId:     number | null
      saleNumber: string | null
      orderNo:    string
      totalPrice: number
      paidAmount: number
    },
  ) {
    if (!pavoSettings) return
    setSaving(true)
    setPavoError(null)
    setPavoPhase('sending', {
      amount: saleRef.totalPrice,
      method: lines.length > 1 ? 'Parçalı' : (lines[0]?.method === 'cash' ? 'Nakit' : 'Kredi Kartı'),
      orderNo: saleRef.orderNo,
    })
    pavoRetryRef.current = () => completeSaleWithAddPayment(lines, saleRef)

    try {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const seq = await window.electron.db.nextPavoSequence()
        const isLast = i === lines.length - 1
        const endpoint = isLast ? 'AddPaymentAndFinalizeSale' : 'AddPayment'

        if (line.method !== 'cash') setPavoLoading(true)

        const addRes = await pavoAddPayment(
          pavoSettings,
          seq,
          {
            saleNumber: saleRef.saleNumber || undefined,
            orderNo:    saleRef.orderNo || undefined,
            saleId:     saleRef.saleNumber ? null : (saleRef.saleId ?? undefined),
          },
          {
            mediator: line.mediator,
            amount:   line.amount,
            ...(line.brand ? { brand: line.brand } : {}),
          },
          {
            grossPrice: saleRef.totalPrice,
            totalPrice: saleRef.totalPrice,
          },
          endpoint,
        )

        if (!addRes.success) {
          setPaymentLines([])
          setActiveMethod(null)
          setPendingAmount('')
          setSelectedBrand(null)
          console.error('[pavo-recovery] AddPayment reddedildi:', addRes.message ?? 'Ödeme eklenemedi.')
          setPavoPhase('error', { message: addRes.message ?? 'Ödeme eklenemedi.' })
          showApiError('Ödeme Hatası', addRes.message ?? 'Ödeme eklenemedi.')
          return
        }

        // Koruma 2 — kalan 0 / StatusId 4|8 → kalan satırları gönderme
        if (pavoSaleClosedFromAddRes(addRes)) break
      }

      const finalSale = await fetchFinalPavoResult(saleRef.orderNo)
      await finalizeSaleToSQLite({
        lines,
        orderNo:             saleRef.orderNo,
        deviceResult:        finalSale ? deviceResultFromPavoData(finalSale.raw) : undefined,
        grandTotalOverride:  saleRef.totalPrice,
      })

      setPavoPendingSaleRef(null)
    } catch (e) {
      setPaymentLines([])
      setActiveMethod(null)
      setPendingAmount('')
      setSelectedBrand(null)
      setPavoPhase('error', { message: e instanceof Error ? e.message : String(e) })
      showCaughtError('Hata', e)
    } finally {
      setSaving(false)
      setPavoLoading(false)
    }
  }

  async function completeSaleSingle(lines: PaymentLine[]) {
    const opId = ++pavoOpIdRef.current
    setSaving(true)
    setPavoError(null)
    let deviceResult: PaymentDeviceResult | undefined

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
      const orderNo = currentOrderNo
        ?? nextOrderNo(settings.terminal.terminalInfo.terminalNumber)
      const pavoPaymentsFinal = lines.map(l => {
        if (l.method === 'cash') {
          const cashPart = Math.min(l.amount, cashRemaining)
          cashRemaining = Math.max(0, cashRemaining - cashPart)
          return { Mediator: l.mediator, Amount: cashPart, CurrencyCode: 'TRY', ExchangeRate: 1 }
        }
        const p: {
          Mediator: number
          Amount: number
          CurrencyCode: string
          ExchangeRate: number
          Brand?: number
        } = { Mediator: l.mediator, Amount: l.amount, CurrencyCode: 'TRY', ExchangeRate: 1 }
        // brand 999 sadece ShowCreditCardMenu için; Pavo PaymentInformations'a Brand yazılmaz
        if (l.brand && l.brand !== 999) p.Brand = l.brand
        return p
      }).filter(p => p.Amount > 0)

      if (pavoSettings) {
        if (cardAmt > 0) setPavoLoading(true)
        void window.electron.store.set('last_pavo_order_no', orderNo).catch(() => {})

        try {
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
              code: c.code,
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

          const seq = await window.electron.db.nextPavoSequence()
          setPavoPhase('sending', {
            amount: grandTotal,
            method: cardAmt > 0 ? 'Kredi Kartı' : 'Nakit',
            orderNo,
          })
          pavoRetryRef.current = () => completeSaleSingle(lines)
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
            { showCreditCardMenu: lines.some(l => l.brand === 999) },
          )

          if (opId !== pavoOpIdRef.current) return

          if (!deviceResult.success) {
            const msg = deviceResult.message ?? ''
            if (isPavoTimeoutMessage(msg) || isNetworkFetchError(msg)) {
              pavoIncompleteRef.current = true
              setPaymentLines([])
              setActiveMethod(null)
              setPendingAmount('')
              setSelectedBrand(null)
              setSaving(false)
              setPavoLoading(false)
              await resolvePavoTimeout({
                lines, orderNo, cashAmt, cardAmt, paidAmt,
                reason: isNetworkFetchError(msg) ? 'network' : 'timeout',
              })
              return
            }
            setPaymentMode(false)
            setPaymentLines([])
            setActiveMethod(null)
            setPendingAmount('')
            setSelectedBrand(null)
            setPavoPhase('error', { message: deviceResult?.message ?? 'Sepet korundu, tekrar deneyebilirsiniz.' })
            showError(
              'Ödeme İptal Edildi',
              deviceResult?.message ?? 'Sepet korundu, tekrar deneyebilirsiniz.',
            )
            setPavoError(null)
            return
          }
        } catch (e) {
          if (opId !== pavoOpIdRef.current) return
          pavoIncompleteRef.current = true
          const msg = e instanceof Error ? e.message : String(e)
          if (isPavoTimeoutMessage(msg) || isNetworkFetchError(msg)) {
            setPaymentLines([])
            setActiveMethod(null)
            setPendingAmount('')
            setSelectedBrand(null)
            setSaving(false)
            setPavoLoading(false)
            await resolvePavoTimeout({
              lines, orderNo, cashAmt, cardAmt, paidAmt,
              reason: isNetworkFetchError(msg) ? 'network' : 'timeout',
            })
            return
          }
          setPaymentMode(false)
          setPaymentLines([])
          setActiveMethod(null)
          setPendingAmount('')
          setSelectedBrand(null)
          setPavoPhase('error', { message: msg })
          showApiError('Ödeme Hatası', msg)
          setPavoError(null)
          return
        } finally {
          setPavoLoading(false)
        }
      }

      if (opId !== pavoOpIdRef.current) return

      await finalizeSaleToSQLite({
        lines,
        orderNo,
        deviceResult,
        cashAmt,
        cardAmt,
        paidAmt,
      })
    } catch (e) {
      if (opId !== pavoOpIdRef.current) return
      pavoIncompleteRef.current = true
      setPaymentLines([])
      setActiveMethod(null)
      setPendingAmount('')
      setSelectedBrand(null)
      setPavoPhase('error', { message: e instanceof Error ? e.message : String(e) })
      showCaughtError('Satış Kaydedilemedi', e)
    } finally {
      if (opId === pavoOpIdRef.current) setSaving(false)
    }
  }

  async function completeSaleKarma(lines: PaymentLine[]) {
    const opId = ++pavoOpIdRef.current
    setSaving(true)
    setPavoLoading(true)
    setPavoError(null)

    const round2 = (n: number) => parseFloat(n.toFixed(2))
    const cashAmt = lines.filter(l => l.method === 'cash').reduce((s, l) => s + l.amount, 0)
    const cardAmt = lines.filter(l => l.method !== 'cash').reduce((s, l) => s + l.amount, 0)
    const paidAmt = lines.reduce((s, l) => s + l.amount, 0)
    const orderNo = currentOrderNo ?? nextOrderNo(settings.terminal.terminalInfo.terminalNumber)
    const smsNorm = normalizeTrMobileForSms(smsPhone)

    const pavoItems = cart.map(c => {
      const brut = round2(c.price * c.quantity)
      const hasLineDiscount = c.discountRate > 0 || c.discountAmount > 0
      return {
        name: c.name,
        code: c.code,
        unitName: c.unit ?? 'Adet',
        vatRate: c.vatRate,
        quantity: c.quantity,
        unitPrice: c.price,
        grossPrice: brut,
        totalPrice: round2(c.netTotal),
        priceEffect: hasLineDiscount ? {
          Type: 1,
          Rate: c.discountRate > 0 ? round2(c.discountRate) : 0,
          Amount: c.discountRate > 0 ? null : round2(c.discountAmount),
        } : undefined,
      }
    })

    const salePriceEffect = docDiscountCalc > 0 ? {
      Type: 2,
      Rate: docDiscountRate > 0 ? round2(docDiscountRate) : 0,
      Amount: docDiscountRate > 0 ? 0 : round2(docDiscountCalc),
    } : undefined

    if (mailAddr.trim() && !isValidNotifyEmail(mailAddr)) {
      showError('E-posta bildirimi', 'Geçerli bir e-posta girin veya adresi temizleyin.')
      setSaving(false)
      setPavoLoading(false)
      return
    }

    const notifyOpts = {
      sendSms: smsNorm.length === SMS_MOBILE_LEN,
      smsPhone: smsNorm || '',
      sendEmail: isValidNotifyEmail(mailAddr),
      mailAddr: mailAddr.trim(),
    }

    let pavoSaleId: number | null = null
    let pavoSaleNumber: string | null = null

    void window.electron.store.set('last_pavo_order_no', orderNo).catch(() => {})

    try {
      const startSeq = await window.electron.db.nextPavoSequence()
      setPavoPhase('sending', { amount: grandTotal, method: 'Parçalı', orderNo })
      pavoRetryRef.current = () => completeSaleKarma(lines)
      const startRes = await pavoStartSaleWithItems(
        pavoSettings!,
        startSeq,
        orderNo,
        round2(araToplamBrut),
        grandTotal,
        pavoItems,
        salePriceEffect,
        selectedCustomer,
        notifyOpts,
        { showCreditCardMenu: lines.some(l => l.brand === 999) },
      )

      if (opId !== pavoOpIdRef.current) return

      // Offline/askı satışta Id:0 olabilir; SaleNumber yeterli
      if (!startRes.success || (!(startRes.saleId && startRes.saleId > 0) && !startRes.saleNumber)) {
        if (isPavoTimeoutMessage(startRes.message ?? '') || isNetworkFetchError(startRes.message ?? '')) {
          setPaymentLines([])
          setActiveMethod(null)
          setPendingAmount('')
          setSelectedBrand(null)
          setSaving(false)
          setPavoLoading(false)
          await resolvePavoTimeout({
            lines, orderNo, cashAmt, cardAmt, paidAmt,
            reason: isNetworkFetchError(startRes.message ?? '') ? 'network' : 'timeout',
          })
          return
        }
        setPaymentMode(false)
        setPaymentLines([])
        setActiveMethod(null)
        setPendingAmount('')
        setSelectedBrand(null)
        setPavoPhase('error', { message: startRes.message ?? 'Sepet gönderilemedi' })
        showApiError('Pavo Hatası', startRes.message ?? 'Sepet gönderilemedi')
        return
      }

      pavoSaleId = startRes.saleId && startRes.saleId > 0 ? startRes.saleId : null
      pavoSaleNumber = startRes.saleNumber ?? null
      const saleRef = { saleId: pavoSaleId, saleNumber: pavoSaleNumber, orderNo }

      // Nakit önce, kart sonra; para üstü nakit satırından düşülür
      const orderedLines = [
        ...lines.filter(l => l.method === 'cash'),
        ...lines.filter(l => l.method !== 'cash'),
      ]
      const nonCashTotal = orderedLines
        .filter(l => l.method !== 'cash')
        .reduce((s, l) => s + l.amount, 0)
      let cashRemaining = Math.max(0, grandTotal - nonCashTotal)

      let lastAddResult: Awaited<ReturnType<typeof pavoAddPayment>> | null = null

      for (const line of orderedLines) {
        if (opId !== pavoOpIdRef.current) return
        if (line.method !== 'cash') setPavoLoading(true)

        let payAmount = round2(line.amount)
        if (line.method === 'cash') {
          payAmount = round2(Math.min(line.amount, cashRemaining))
          cashRemaining = Math.max(0, cashRemaining - payAmount)
        }
        if (payAmount <= 0) continue

        const addSeq = await window.electron.db.nextPavoSequence()
        const lineIdx = orderedLines.indexOf(line)
        pavoRetryRef.current = () => completeSaleWithAddPayment(orderedLines.slice(lineIdx), {
          saleId: pavoSaleId,
          saleNumber: pavoSaleNumber,
          orderNo,
          totalPrice: grandTotal,
          paidAmount: 0,
        })
        const addRes = await pavoAddPayment(
          pavoSettings!,
          addSeq,
          saleRef,
          {
            mediator: line.mediator,
            amount: payAmount,
            ...(line.brand ? { brand: line.brand } : {}),
          },
          { grossPrice: round2(araToplamBrut), totalPrice: grandTotal },
        )

        if (opId !== pavoOpIdRef.current) return

        if (!addRes.success) {
          if (isPavoTimeoutMessage(addRes.message ?? '') || isNetworkFetchError(addRes.message ?? '')) {
            setPaymentLines([])
            setActiveMethod(null)
            setPendingAmount('')
            setSelectedBrand(null)
            setSaving(false)
            setPavoLoading(false)
            await resolvePavoTimeout({
              lines, orderNo, cashAmt, cardAmt, paidAmt, saleRef,
              reason: isNetworkFetchError(addRes.message ?? '') ? 'network' : 'timeout',
            })
            return
          }
          await handlePavoRecovery(saleRef, orderNo)
          setPaymentMode(false)
          setPaymentLines([])
          setActiveMethod(null)
          setPendingAmount('')
          setSelectedBrand(null)
          console.error('[pavo-recovery] AddPayment reddedildi:', addRes.message ?? 'Ödeme eklenemedi')
          setPavoPhase('error', { message: addRes.message ?? 'Ödeme eklenemedi' })
          showApiError('Ödeme Hatası', addRes.message ?? 'Ödeme eklenemedi')
          return
        }

        lastAddResult = addRes
        // Koruma 2 — kalan 0 / StatusId 4|8 → kalan satırları gönderme
        if (pavoSaleClosedFromAddRes(addRes)) break
      }

      if (opId !== pavoOpIdRef.current) return

      if (lastAddResult && !lastAddResult.finalized) {
        const finalSeq = await window.electron.db.nextPavoSequence()
        const finalRes = await pavoFinalizeSale(pavoSettings!, finalSeq, saleRef)
        if (opId !== pavoOpIdRef.current) return
        if (!finalRes.success) {
          if (isPavoTimeoutMessage(finalRes.message ?? '')) {
            setPaymentLines([])
            setActiveMethod(null)
            setPendingAmount('')
            setSelectedBrand(null)
            setSaving(false)
            setPavoLoading(false)
            await resolvePavoTimeout({ lines, orderNo, cashAmt, cardAmt, paidAmt, saleRef })
            return
          }
          await handlePavoRecovery(saleRef, orderNo)
          setPaymentMode(false)
          setPaymentLines([])
          setActiveMethod(null)
          setPendingAmount('')
          setSelectedBrand(null)
          setPavoPhase('error', { message: finalRes.message ?? 'Satış kapatılamadı' })
          showApiError('Finalize Hatası', finalRes.message ?? 'Satış kapatılamadı')
          return
        }
      }

      const lastData = lastAddResult?.data as Record<string, unknown> | undefined
      const lastInner = (lastData?.Data as Record<string, unknown> | undefined) ?? lastData
      const statusId = Number(lastInner?.StatusId ?? 0)

      const closedTotals = paymentTotals(lastInner)
      const paidCoversSale = closedTotals.saleTotal > 0
        && closedTotals.remaining <= 0.009
        && !closedTotals.hasWaiting
      if (statusId === 4 || statusId === 8 || paidCoversSale) {
        const finalSale = await fetchFinalPavoResult(orderNo)
        await finalizeSaleToSQLite({
          lines,
          orderNo,
          deviceResult: finalSale
            ? deviceResultFromPavoData(finalSale.raw)
            : (lastData
              ? parsePavoResult(
                  lastData?.Data != null || lastData?.HasError != null
                    ? lastData
                    : { HasError: false, Data: lastInner ?? {} },
                )
              : undefined),
        })
        return
      }

      // Hâlâ bekliyor — GetSaleResult ile doğrula
      const resultSeq = await window.electron.db.nextPavoSequence()
      const saleResult = await pavoGetSaleResult(pavoSettings!, resultSeq, orderNo)

      if (opId !== pavoOpIdRef.current) return

      if (saleResult.status === 'uncompleted') {
        const compSeq = await window.electron.db.nextPavoSequence()
        const compRes = await pavoCompleteUncompletedSale(pavoSettings!, compSeq, {
          saleId:     saleResult.saleId     != null && saleResult.saleId     > 0  ? saleResult.saleId     : null,
          saleNumber: saleResult.saleNumber !== '' ? saleResult.saleNumber : null,
          orderNo,
        })
        if (!compRes.success) {
          await handlePavoRecovery(saleRef, orderNo)
          setPaymentMode(false)
          setPaymentLines([])
          setActiveMethod(null)
          setPendingAmount('')
          setSelectedBrand(null)
          showApiError('Satış Tamamlanamadı', compRes.message ?? 'Satış kapatılamadı')
          return
        }
      } else if (saleResult.status !== 'completed') {
        await handlePavoRecovery(saleRef, orderNo)
        setPaymentMode(false)
        setPaymentLines([])
        setActiveMethod(null)
        setPendingAmount('')
        setSelectedBrand(null)
        showApiError('Satış Tamamlanamadı', saleResult.message ?? 'Bilinmeyen durum')
        return
      }

      const finalSale = await fetchFinalPavoResult(orderNo)
      await finalizeSaleToSQLite({
        lines,
        orderNo,
        deviceResult: finalSale
          ? deviceResultFromPavoData(finalSale.raw)
          : deviceResultFromPavoData(saleResult.data),
      })
    } catch (e) {
      if (opId !== pavoOpIdRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setPaymentLines([])
      setActiveMethod(null)
      setPendingAmount('')
      setSelectedBrand(null)
      if (isPavoTimeoutMessage(msg)) {
        setSaving(false)
        setPavoLoading(false)
        await resolvePavoTimeout({
          lines,
          orderNo,
          cashAmt,
          cardAmt,
          paidAmt,
          saleRef: { saleId: pavoSaleId, saleNumber: pavoSaleNumber },
        })
        return
      }
      if (pavoSaleId || pavoSaleNumber) {
        await handlePavoRecovery({ saleId: pavoSaleId, saleNumber: pavoSaleNumber }, orderNo)
      }
      setPaymentMode(false)
      showApiError('Satış Kaydedilemedi', msg)
    } finally {
      if (opId === pavoOpIdRef.current) {
        setSaving(false)
        setPavoLoading(false)
      }
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

      const orderNo = nextOrderNo(settings.terminal.terminalInfo.terminalNumber)
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
          // Pavo iade: müşteriye ödenen (indirimli) tutar
          const unitNet = Number(item.UnitPrice) || 0
          const lineTotal = Math.round(qty * unitNet * 100) / 100
          return {
            productCode:    '',
            productName:    item.ProductName,
            quantity:       -qty,
            unitPrice:      unitNet,
            vatRate:        item.VatRate ?? 20,
            discountRate:   0,
            discountAmount: 0,
            lineTotal,
            unitPriceGross: unitNet,
            grossAmount: lineTotal,
            lineDiscount: 0,
            docDiscountShare: 0,
            netAmount: lineTotal,
          }
        })

      const { saleId, receiptNo } = await window.electron.db.saveSale(saleRow, items, undefined)

      if (companyId) {
        try {
          const queueInvoiceType: 'e_archive' | 'paper' =
            settings.terminal.invoiceType === 'paper' ? 'paper' : 'e_archive'

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
    if (!isPosReady()) {
      logPosBlocked()
      return
    }
    setSaving(true)

    try {
      const cashAmt = lines.filter(l => l.method === 'cash').reduce((s, l) => s + l.amount, 0)
      const cardAmt = lines.filter(l => l.method !== 'cash').reduce((s, l) => s + l.amount, 0)

      if (cardAmt > 0 && pavoSettings) {
        showInfo('Bilgi', 'Kart iadesi için Pavo entegrasyonu bir sonraki adımda gelecek.')
        return
      }

      const invoiceCustomer = selectedCustomer ?? await tryResolveTorbaCustomer(companyId)
      const terminalLabel = settings.terminal.terminalInfo.terminalName?.trim() || 'Kasa'
      const orderNo = currentOrderNo
        ?? nextOrderNo(settings.terminal.terminalInfo.terminalNumber)
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
        customerId:   invoiceCustomer?.id   || null,
        customerName: invoiceCustomer?.name ?? null,
        customerCode: invoiceCustomer?.code ?? null,
        isReturn: true,
      }

      const { allocateDocDiscount, assertAllocatedTotal, r2 } = await import('../lib/saleDiscount')
      const allocated = allocateDocDiscount(
        cart.map(c => ({
          quantity: Math.abs(c.quantity),
          unitPrice: c.price,
          discountAmount: c.discountAmount,
          discountRate: c.discountRate,
          afterLineNet: c.netTotal,
          productId: c.productId,
          code: c.code,
          name: c.name,
          vatRate: c.vatRate,
        })),
        docDiscountCalc,
      )
      assertAllocatedTotal(allocated, grandTotal, '[iade/iskonto]')

      const { saleId, receiptNo } = await window.electron.db.saveSale(saleRow, allocated.map(a => {
        const netUnit = a.quantity > 0 ? r2(a.netAmount / a.quantity) : a.unitPriceGross
        return {
          productId: a.source.productId,
          productCode: a.source.code,
          productName: a.source.name,
          quantity: -Math.abs(a.quantity),
          unitPrice: netUnit,
          vatRate: a.source.vatRate,
          discountRate: 0,
          discountAmount: 0,
          lineTotal: a.netAmount,
          appliedBy: cashier.id,
          unitPriceGross: netUnit,
          grossAmount: a.netAmount,
          lineDiscount: 0,
          docDiscountShare: 0,
          netAmount: a.netAmount,
        }
      }), undefined)

      if (companyId) {
        try {
          const { sendReturnInvoice } = await import('../lib/invoiceSend')
          const queueInvoiceType: 'e_archive' | 'paper' =
            settings.terminal.invoiceType === 'paper' ? 'paper' : 'e_archive'

          const customer = selectedCustomer ?? await tryResolveTorbaCustomer(companyId)

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

      const terminalLabelIade = settings.terminal.terminalInfo.terminalName?.trim() || 'Kasa'
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
        terminalNumber: settings.terminal.terminalInfo.terminalNumber,
        workplace: {
          name: settings.terminal.terminalInfo.workplace?.name,
          address: settings.terminal.terminalInfo.workplace?.address,
          phone: settings.terminal.terminalInfo.workplace?.phone,
          city: settings.terminal.terminalInfo.workplace?.city,
          district: settings.terminal.terminalInfo.workplace?.district,
          taxOffice: settings.terminal.terminalInfo.workplace?.taxOffice,
          taxNo: settings.terminal.terminalInfo.workplace?.taxNo,
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
  const activeColor = pluGroups.find(g => g.id === activeGroup)?.color ?? 'var(--pos-primary)'
  const activeSoft  = hexToTint(activeColor)
  const devtoolsOn = isDevtoolsPermitActive(settings.terminal)
  const devtoolsUntil = (() => {
    const raw = settings.terminal.devtoolsExpiresAt
    if (!raw) return ''
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return ''
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  })()

  function saleHasTakenPayment(data: unknown): boolean {
    const root = data && typeof data === 'object' ? data as Record<string, unknown> : {}
    const inner = root.Data && typeof root.Data === 'object' ? root.Data as Record<string, unknown> : root
    const lists = [inner.AddedPayments, inner.Payments, root.AddedPayments]
    for (const list of lists) {
      if (!Array.isArray(list)) continue
      if (list.some(p => Number((p as Record<string, unknown>).StatusId) === 2)) return true
    }
    return false
  }

  async function queryLockedSale() {
    const orderNo = getPavoLockInfo().orderNo || currentOrderNo
    if (!pavoSettings || !orderNo) {
      setPavoPhase('error', { message: 'Cihaza ulaşılamıyor' })
      return
    }
    const seq = await window.electron.db.nextPavoSequence()
    const res = await pavoGetSaleResult(pavoSettings, seq, orderNo)
    if (!res.success) {
      setPavoPhase('error', { message: res.message ?? 'Cihaza ulaşılamıyor' })
      return
    }
    const taken = saleHasTakenPayment(res.data) || res.status === 'completed' || res.statusId === 4 || res.statusId === 8
    if (taken) {
      setPavoPhase('completing', { message: '' })
      await finalizeSaleToSQLite({ lines: paymentLines, orderNo, recovered: true, deviceResult: deviceResultFromPavoData(res.data) })
      return
    }
    if (res.status === 'uncompleted') {
      setPavoPhase('completing')
      const compSeq = await window.electron.db.nextPavoSequence()
      const compRes = await pavoCompleteUncompletedSale(pavoSettings, compSeq, {
        saleId: res.saleId && res.saleId > 0 ? res.saleId : null,
        saleNumber: res.saleNumber || null,
        orderNo,
      })
      if (!compRes.success) {
        setPavoPhase('error', { message: compRes.message ?? 'Satış kapatılamadı' })
        return
      }
      await finalizeSaleToSQLite({ lines: paymentLines, orderNo, recovered: true, deviceResult: deviceResultFromPavoData(compRes.data ?? res.data) })
      return
    }
    setPavoPhase('error', { orderNo, message: '' })
  }

  async function resendLockedPayment() {
    if (isRecoveryInFlight()) return
    const orderNo = getPavoLockInfo().orderNo || currentOrderNo
    const snap = getRecoveryInfo()
    if (!pavoSettings || !orderNo) return
    setPavoPhase('sending', { orderNo, amount: snap.saleTotal || undefined, message: 'Ödeme yeniden gönderiliyor' })
    const probe = await probePavoSale(orderNo)
    const summary = summarizeProbe(probe)
    if (!probe.success) {
      setPavoPhase('error', { orderNo, message: "Pavo'ya ulaşılamadığı için ödeme gönderilemedi. Cihaz bağlantısını kontrol edin." })
      return
    }
    if (summary.kind === 'completed') {
      await settleRecoveredSale(orderNo, probe)
      return
    }
    const due = paymentTotals(probe.data)
    const saleTotal = due.saleTotal > 0
      ? due.saleTotal
      : (summary.saleTotal || snap.saleTotal || getPavoLockInfo().amount || 0)
    const paidTotal = due.saleTotal > 0 ? due.paidTotal : summary.paidTotal
    const amount = due.saleTotal > 0
      ? due.remaining
      : parseFloat(Math.max(0, saleTotal - paidTotal).toFixed(2))
    if (amount <= 0.009) {
      await settleRecoveredSale(orderNo, probe)
      return
    }
    if (paidTotal + amount > saleTotal + 0.009) {
      setPavoPhase('error', { orderNo, message: 'Ödeme tutarı satış toplamını aşamaz' })
      return
    }
    const mediator = summary.mediator
      ?? snap.mediator
      ?? (getPavoLockInfo().method?.toLocaleLowerCase('tr-TR').includes('nakit') ? 1 : 2)
    const seq = await window.electron.db.nextPavoSequence()
    const addRes = await pavoAddPayment(
      pavoSettings,
      seq,
      {
        orderNo,
        saleId: summary.kind === 'partial' ? (probe.saleId ?? snap.saleId) : (probe.saleId ?? snap.saleId),
        saleNumber: probe.saleNumber || snap.saleNumber || null,
      },
      { mediator, amount },
      { grossPrice: saleTotal, totalPrice: saleTotal },
      'AddPaymentAndFinalizeSale',
    )
    if (!addRes.success) {
      const message = addRes.message ?? 'Ödeme gönderilemedi'
      console.error('[pavo-recovery] AddPayment reddedildi:', message)
      setPavoPhase('error', { orderNo, message })
      return
    }
    const afterPay = paymentTotals(addRes.data)
    const stillOpen = afterPay.saleTotal > 0 && (afterPay.remaining > 0.009 || afterPay.hasWaiting)
    if (!stillOpen && (addRes.finalized || (addRes.remainingPaymentAmount ?? 0) <= 0.009)) {
      const finalSale = await fetchFinalPavoResult(orderNo)
      await finalizeSaleToSQLite({
        lines: paymentLines.length > 0 ? paymentLines : [{
          id: crypto.randomUUID(),
          method: mediator === 1 ? 'cash' : 'card',
          amount: saleTotal,
          label: mediator === 1 ? 'Nakit' : 'Kredi Kartı',
          mediator,
        }],
        orderNo,
        deviceResult: finalSale
          ? deviceResultFromPavoData(finalSale.raw)
          : deviceResultFromPavoData(addRes.data),
        recovered: true,
        grandTotalOverride: saleTotal > 0 ? saleTotal : undefined,
      })
      return
    }
    setPavoPhase('error', { orderNo, amount: saleTotal })
  }

  function collectRemainingPayment() {
    const orderNo = getPavoLockInfo().orderNo || currentOrderNo
    const snap = getRecoveryInfo()
    if (!orderNo) return
    const remaining = Math.max(0, parseFloat((snap.saleTotal - snap.paidTotal).toFixed(2)))
    setPavoRecoveryState({
      ref: { saleId: snap.saleId ?? null, saleNumber: snap.saleNumber ?? null },
      orderNo,
      totalPrice: snap.saleTotal,
      paidAmount: snap.paidTotal,
      remainingAmount: remaining,
    })
    setPavoPendingSaleRef({
      saleId: snap.saleNumber ? null : (snap.saleId ?? null),
      saleNumber: snap.saleNumber ?? null,
      orderNo,
      totalPrice: snap.saleTotal,
      paidAmount: snap.paidTotal,
    })
    setPaymentMode(true)
    setPendingAmount(remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 }))
    setPavoPhase('open', { orderNo, amount: snap.saleTotal })
  }

  async function cancelLockedSale() {
    const orderNo = getPavoLockInfo().orderNo || currentOrderNo
    if (!pavoSettings || !orderNo) {
      setPavoPhase('idle')
      return
    }
    const seq = await window.electron.db.nextPavoSequence()
    const res = await pavoGetSaleResult(pavoSettings, seq, orderNo)
    if (!res.success) {
      if (res.notFound) {
        const listSeq = await window.electron.db.nextPavoSequence()
        const listed = await pavoListPendingSales(pavoSettings, listSeq)
        if (listed.success && !listed.sales.some(s => s.orderNo === orderNo)) {
          releaseMissingPavoSale(orderNo)
          return
        }
      }
      setPavoPhase('error', {
        orderNo,
        message: "Pavo'ya ulaşılamadığı için iptal edilemedi. Cihaz bağlantısını kontrol edin.",
      })
      return
    }
    const summary = summarizeProbe({
      success: true,
      status: res.status,
      statusId: res.statusId,
      data: res.data,
      saleId: res.saleId,
      saleNumber: res.saleNumber,
    })
    if (summary.kind === 'completed') {
      setPavoPhase('completing', { message: 'Bu satışta alınmış ödeme var, iptal edilemez. Satış tamamlanıyor.', orderNo })
      await finalizeSaleToSQLite({ lines: paymentLines, orderNo, recovered: true, deviceResult: deviceResultFromPavoData(res.data) })
      return
    }
    if (summary.kind === 'partial') {
      setPavoPhase('error', { orderNo, message: 'Alınmış ödeme var, iptal edilemez.' })
      return
    }
    const ok = await confirm({
      title: 'Satışı iptal et',
      message: "Pavo'daki satış iptal edilecek. Cihaz ekranında bekleyen bir ödeme olmadığından emin olun.",
      confirmLabel: 'İptal et',
      cancelLabel: 'Vazgeç',
    })
    if (!ok) return
    const abanSeq = await window.electron.db.nextPavoSequence()
    const abandoned = await pavoAbandonSuspendedSale(pavoSettings, abanSeq, {
      saleId: res.saleId && res.saleId > 0 ? res.saleId : null,
      saleNumber: res.saleNumber || null,
      orderNo,
    })
    if (abandoned.success) {
      setPavoRecoveryState(null)
      setPavoPendingSaleRef(null)
      setPaymentMode(false)
      setPavoPhase('idle')
    } else {
      const msg = abandoned.message ?? ''
      setPavoPhase('error', {
        orderNo,
        message: isNetworkFetchError(msg)
          ? "Pavo'ya ulaşılamadığı için iptal edilemedi. Cihaz bağlantısını kontrol edin."
          : (msg || 'İptal başarısız'),
      })
    }
  }

  async function probePavoSale(orderNo: string): Promise<RecoveryProbe> {
    if (!pavoSettings) return { success: false, message: 'Pavo ayarı yok' }
    const seq = await window.electron.db.nextPavoSequence()
    const res = await pavoGetSaleResult(pavoSettings, seq, orderNo)
    return {
      success: res.success,
      message: res.message,
      status: res.status,
      statusId: res.statusId,
      saleId: res.saleId,
      saleNumber: res.saleNumber,
      notFound: res.notFound,
      data: res.data,
    }
  }

  function releaseMissingPavoSale(orderNo: string) {
    console.warn('[pavo-recovery] Satış cihazda yok, kilit kaldırıldı:', orderNo)
    setPavoRecoveryState(null)
    setPavoPendingSaleRef(null)
    setPaymentMode(false)
    setPavoError('Bu satış Pavo cihazında yok. Ekran kilidi kaldırıldı.')
    setPavoPhase('idle')
  }

  async function settleRecoveredSale(orderNo: string, probe: RecoveryProbe) {
    if (!pavoSettings) throw new Error('Pavo ayarı yok')
    let data = probe.data
    if (probe.status === 'uncompleted' || probe.statusId === 23) {
      const compSeq = await window.electron.db.nextPavoSequence()
      const compRes = await pavoCompleteUncompletedSale(pavoSettings, compSeq, {
        saleId: probe.saleId && probe.saleId > 0 ? probe.saleId : null,
        saleNumber: probe.saleNumber || null,
        orderNo,
      })
      if (!compRes.success) throw new Error(compRes.message ?? 'Satış kapatılamadı')
      data = compRes.data ?? data
    }
    const finalSale = await fetchFinalPavoResult(orderNo)
    await finalizeSaleToSQLite({
      lines: paymentLines,
      orderNo,
      deviceResult: finalSale
        ? deviceResultFromPavoData(finalSale.raw)
        : deviceResultFromPavoData(data),
      recovered: true,
    })
  }

  async function findPendingSale(orderNo: string): Promise<PendingLookup> {
    if (!pavoSettings) return { kind: 'miss' }
    const seq = await window.electron.db.nextPavoSequence()
    const listed = await pavoListPendingSales(pavoSettings, seq)
    if (!listed.success) return { kind: 'miss' }
    const mine = listed.sales.find(s => s.orderNo === orderNo)
    if (!mine) return { kind: 'absent' }
    const base = {
      paidTotal: mine.paidAmount,
      saleTotal: mine.totalPrice,
      saleId: mine.saleId,
      saleNumber: mine.saleNumber,
    }
    if (mine.totalPrice > 0 && mine.paidAmount + 0.009 >= mine.totalPrice) {
      await settleRecoveredSale(orderNo, {
        success: true,
        status: 'uncompleted',
        statusId: 23,
        saleId: mine.saleId,
        saleNumber: mine.saleNumber,
        data: undefined,
      })
      return { kind: 'done', ...base }
    }
    if (mine.paidAmount > 0.009) return { kind: 'partial', ...base }
    return { kind: 'waiting', ...base }
  }

  recoveryRef.current = {
    probe: probePavoSale,
    settle: settleRecoveredSale,
    findPending: findPendingSale,
    releaseMissing: releaseMissingPavoSale,
  }

  /* ────────── RENDER ────────── */
  return (
    <div className="pos-screen" style={{ display: 'flex', flexDirection: 'column', height: '100vh', color: 'var(--pos-text)', overflow: 'hidden' }}>
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
        @keyframes merkezMailSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes pulse-yellow {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.04); }
        }
        @keyframes pulse-red {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.06); }
        }
      `}</style>

      {/* Lisans banner */}
      {license?.warning && <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />}

      <PavoLockOverlay
        onQuery={() => { void queryLockedSale() }}
        onCancel={() => { void cancelLockedSale() }}
        onRetry={() => { void pavoRetryRef.current?.() }}
        onResend={() => { void resendLockedPayment() }}
        onCollect={() => collectRemainingPayment()}
      />

      {/* ── HEADER ── */}
      <div className="pos-header" style={{
        background: 'var(--pos-header-bg)',
        borderBottom: '1px solid var(--pos-header-border)',
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
            onClick={() => { if (cartLocked) { notifyLocked(); return } onBack() }}
            style={{
              background: '#1f2937',
              border: '1px solid #374151',
              borderRadius: 6,
              color: 'var(--pos-header-text)',
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
              onClick={() => openHeldModal()}
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
                ...(heldDocs.length <= 3
                  ? solidBtn(C.success)
                  : heldDocs.length <= 6
                    ? { ...solidBtn(C.warning), animation: 'pulse-yellow 2s infinite' }
                    : { ...solidBtn(C.danger), animation: 'pulse-red 1s infinite' }),
              }}
            >
              <span style={{ fontSize: 14 }}>
                {heldDocs.length <= 3 ? '🛒' : heldDocs.length <= 6 ? '⚠️' : '🚨'}
              </span>
              <span>
                {heldDocs.length <= 3
                  ? `${heldDocs.length} Bekleyen Belge`
                  : heldDocs.length <= 6
                    ? `${heldDocs.length} Bekleyen Belge!`
                    : `${heldDocs.length} Bekleyen Belge`}
              </span>
              <span style={{
                background: heldDocs.length <= 3 ? '#2E7D32'
                  : heldDocs.length <= 6 ? '#F57F17'
                    : '#C62828',
                color: 'white',
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
            <span style={{ background: C.primary, color: '#FFFFFF', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700 }}>
              # {currentOrderNo}
            </span>
          )}
          {lastReceipt && cart.length === 0 && (
            <span style={{ background: C.success, color: '#FFFFFF', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700 }}>
              ✓ {lastReceipt}
            </span>
          )}
          {selectedCustomer && (
            <span style={{
              background: 'var(--pos-surface-alt)',
              color: 'var(--pos-text)',
              border: '1px solid var(--pos-border)',
              borderRadius: 6,
              padding: '3px 8px',
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              👤 {selectedCustomer.name}
              {settings.cashier.canEditCustomer && (
                <button type="button" title="Düzenle" onClick={() => setCustomerForm({ mode: 'edit', customer: selectedCustomer })} style={{ background: 'none', border: 'none', color: 'var(--pos-text)', cursor: 'pointer', fontSize: 12, padding: 0 }}>✎</button>
              )}
              <button type="button" onClick={() => applyCustomerSelection(null)} style={{ background: 'none', border: 'none', color: 'var(--pos-text)', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
            </span>
          )}
        </div>
        <div className="pos-header-end" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {devtoolsOn && (
            <button
              type="button"
              onClick={() => { void window.electron.devtools.open() }}
              title="Geliştirici araçlarını aç"
              style={{
                background: '#F59E0B',
                color: '#1C1917',
                border: 'none',
                borderRadius: 999,
                padding: '3px 10px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              🛠 Hata ayıklama modu{devtoolsUntil ? ` · ${devtoolsUntil}'e kadar` : ''}
            </button>
          )}
          <ConnectionDot status={conn} />
          <PosUndefinedBadge onClick={logPosBlocked} />
          <CmdProgressChip />
          {commandListenerActive && (
            <button
              type="button"
              onClick={onEnvelopeTap}
              title={
                commandSyncing
                  ? 'Merkez komutu işleniyor'
                  : (commandDeferred
                    ? 'Satış aktif: merkez komutu sırada bekliyor'
                    : (commandRecentlyReceived
                      ? 'Merkezden yeni komut alındı'
                      : 'Komutları kontrol etmek için iki kez dokunun'))
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: '50%',
                fontSize: 12,
                border: commandPolling
                  ? '1px solid #93C5FD'
                  : commandSyncing
                  ? '1px solid #93C5FD'
                  : commandDeferred
                    ? '1px solid #FCD34D'
                  : commandRecentlyReceived
                    ? '1px solid #BFDBFE'
                    : '1px solid #4B5563',
                background: commandPolling
                  ? '#1D4ED8'
                  : commandSyncing
                  ? '#1D4ED8'
                  : commandDeferred
                    ? '#B45309'
                  : commandRecentlyReceived
                    ? '#2563EB'
                    : '#111827',
                color: '#fff',
                boxShadow: commandPolling || commandSyncing
                  ? '0 0 0 4px rgba(37, 99, 235, 0.22)'
                  : commandDeferred
                    ? '0 0 0 4px rgba(245, 158, 11, 0.18)'
                  : 'none',
                animation: commandIconAnimation,
                position: 'relative',
                padding: 0,
                cursor: 'pointer',
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
            </button>
          )}
          <div style={{
            fontSize:      13,
            fontWeight:    600,
            color:         'var(--pos-header-text)',
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
            color: 'var(--pos-header-text)',
            fontSize: 11,
          }}>
            {cashier.fullName}
          </span>
          <button
            type="button"
            onClick={() => { if (cartLocked) { notifyLocked(); return } onLogout() }}
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
            <div className="pos-modal" style={{ background: 'var(--pos-surface)', borderRadius: 16, padding: '20px 16px 32px', width: 'min(720px, 92vw)', maxWidth: '92vw' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Satır İndirimi</div>
                  <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>{targetItem?.name}</div>
                </div>
                <button onClick={() => { setLineDiscountTarget(null); setLineDiscRateIn(''); setLineDiscAmtIn('') }}
                  style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--pos-text-muted)', cursor: 'pointer' }}>✕</button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[{ key: 'rate', label: 'Yüzde (%)' }, { key: 'amt', label: 'Tutar (₺)' }].map(m => (
                  <button key={m.key} type="button"
                    onClick={() => { setDiscMode(m.key as 'rate' | 'amt'); setLineDiscRateIn(''); setLineDiscAmtIn('') }}
                    style={{ ...(discMode === m.key ? solidBtn(C.discountBar, false, true) : solidBtn(C.neutral)), flex: 1, padding: '8px', borderRadius: 8, fontSize: 13 }}>
                    {m.label}
                  </button>
                ))}
              </div>

              <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 32, fontWeight: 700, color: '#E65100', letterSpacing: 2, minHeight: 56 }}>
                {discMode === 'rate' ? `${lineDiscRateIn || '0'} %` : `${lineDiscAmtIn || '0'} ₺`}
              </div>

              <div className="pos-numpad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
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
                    style={{ padding: '14px 0', borderRadius: 10, border: '1px solid var(--pos-key-border)', background: 'var(--pos-key-bg)', fontSize: 18, fontWeight: 600, color: 'var(--pos-key-text)', cursor: 'pointer' }}>
                    {k}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 8 }}>
                <button type="button"
                  onClick={() => { setLineDiscRateIn(''); setLineDiscAmtIn('') }}
                  style={{ padding: '14px', borderRadius: 10, border: '1px solid var(--pos-key-border)', background: 'var(--pos-key-bg)', fontSize: 15, fontWeight: 600, color: 'var(--pos-key-text)', cursor: 'pointer' }}>
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
            <div className="pos-modal" style={{
              background: 'var(--pos-surface)',
              borderRadius: 16,
              padding:      '20px 16px 32px',
              width:        'min(720px, 92vw)',
              maxWidth:     '92vw',
            }}>
              <div style={{
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'center',
                marginBottom:   12,
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Birim Fiyat</div>
                  <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                    {targetItem?.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setPriceEditTarget(null); setPriceEditInput('') }}
                  style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--pos-text-muted)', cursor: 'pointer' }}
                >✕</button>
              </div>

              <div style={{
                display:        'flex',
                justifyContent: 'space-between',
                padding:        '8px 12px',
                borderRadius:   8,
                background:     'var(--pos-surface-alt)',
                marginBottom:   12,
                fontSize:       12,
                color:          'var(--pos-text-muted)',
              }}>
                <span>Mevcut fiyat</span>
                <span style={{ fontWeight: 700, color: 'var(--pos-text)' }}>
                  {fmt(targetItem?.price ?? 0)}
                </span>
              </div>

              <div style={{
                textAlign:   'center',
                padding:     '12px 0',
                fontSize:    32,
                fontWeight:  700,
                color:       'var(--pos-primary)',
                letterSpacing: 2,
                minHeight:   56,
              }}>
                {priceEditInput || '0'} ₺
              </div>

              <div className="pos-numpad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
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
                      border:         '1px solid var(--pos-key-border)',
                      background:     'var(--pos-key-bg)',
                      fontSize:       18,
                      fontWeight:     600,
                      color:          'var(--pos-key-text)',
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
                    border:       '1px solid var(--pos-key-border)',
                    background:   'var(--pos-key-bg)',
                    fontSize:     15,
                    fontWeight:   600,
                    color:        'var(--pos-key-text)',
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
                    background:   'var(--pos-key-action-bg)',
                    fontSize:     15,
                    fontWeight:   700,
                    color:        'var(--pos-key-action-text)',
                    cursor:       'pointer',
                  }}
                >Uygula</button>
              </div>
            </div>
          </div>
        )
      })()}

      {weightEditTarget && (() => {
        const targetItem = cart.find(c => c.id === weightEditTarget)
        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}>
            <div className="pos-modal" style={{
              background: 'var(--pos-surface)', borderRadius: 16,
              padding: '20px 16px 32px', width: 'min(720px, 92vw)', maxWidth: '92vw',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 12,
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Ağırlık Düzenle</div>
                  <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                    {targetItem?.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setWeightEditTarget(null); setWeightEditInput('') }}
                  style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--pos-text-muted)', cursor: 'pointer' }}
                >✕</button>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 8, background: 'var(--pos-surface-alt)',
                marginBottom: 12, fontSize: 12, color: 'var(--pos-text-muted)',
              }}>
                <span>Mevcut ağırlık</span>
                <span style={{ fontWeight: 700, color: 'var(--pos-text)', fontFamily: 'monospace' }}>
                  {(targetItem?.quantity ?? 0).toFixed(3)} kg
                </span>
              </div>

              <div style={{
                textAlign: 'center', padding: '12px 0', fontSize: 32, fontWeight: 700,
                color: '#1D4ED8', letterSpacing: 2, minHeight: 56, fontFamily: 'monospace',
              }}>
                {weightEditInput || '0'} kg
              </div>

              <div className="pos-numpad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      if (k === '⌫') {
                        setWeightEditInput(v => v.slice(0, -1))
                        return
                      }
                      if (k === ',') {
                        setWeightEditInput(v => {
                          if (v.includes(',')) return v
                          return v === '' ? '0,' : v + ','
                        })
                        return
                      }
                      setWeightEditInput(v => {
                        if (v.includes(',') && (v.split(',')[1] ?? '').length >= 3) return v
                        if (v.replace(',', '').length >= 6) return v
                        return v + k
                      })
                    }}
                    style={{
                      padding: '14px 0', borderRadius: 10, border: '1px solid var(--pos-key-border)',
                      background: 'var(--pos-key-bg)',
                      fontSize: 18, fontWeight: 600,
                      color: 'var(--pos-key-text)', cursor: 'pointer',
                    }}
                  >{k}</button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setWeightEditInput('')}
                  style={{
                    padding: 14, borderRadius: 10, border: '1px solid var(--pos-key-border)',
                    background: 'var(--pos-key-bg)', fontSize: 15, fontWeight: 600,
                    color: 'var(--pos-key-text)', cursor: 'pointer',
                  }}
                >C</button>
                <button
                  type="button"
                  onClick={applyWeightEdit}
                  style={{
                    padding: 14, borderRadius: 10, border: 'none',
                    background: 'var(--pos-key-action-bg)', fontSize: 15, fontWeight: 700,
                    color: 'var(--pos-key-action-text)', cursor: 'pointer',
                  }}
                >Uygula</button>
              </div>
            </div>
          </div>
        )
      })()}

      {docDiscountMode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div className="pos-modal" style={{ background: 'var(--pos-surface)', borderRadius: 16, padding: '20px 16px 32px', width: 'min(720px, 92vw)', maxWidth: '92vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Belge İndirimi</div>
                <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>Toplam belgeye uygulanır</div>
              </div>
              <button
                onClick={() => {
                  setDocDiscountMode(false)
                  setDocDiscInput('')
                  setDocDiscMode('rate')
                }}
                style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--pos-text-muted)', cursor: 'pointer' }}
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
                  style={{ ...(docDiscMode === m.key ? solidBtn(C.discountBar, false, true) : solidBtn(C.neutral)), flex: 1, padding: '8px', borderRadius: 8, fontSize: 13 }}>
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 32, fontWeight: 700, color: '#E65100', letterSpacing: 2, minHeight: 56 }}>
              {docDiscMode === 'rate' ? `${docDiscInput || '0'} %` : `${docDiscInput || '0'} ₺`}
            </div>

            <div className="pos-numpad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
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
                  style={{ padding: '14px 0', borderRadius: 10, border: '1px solid var(--pos-key-border)', background: 'var(--pos-key-bg)', fontSize: 18, fontWeight: 600, color: 'var(--pos-key-text)', cursor: 'pointer' }}>
                  {k}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 8 }}>
              <button type="button"
                onClick={() => { setDocDiscInput(''); setDocDiscountRate(0); setDocDiscountAmt(0) }}
                style={{ padding: '14px', borderRadius: 10, border: '1px solid var(--pos-key-border)', background: 'var(--pos-key-bg)', fontSize: 15, fontWeight: 600, color: 'var(--pos-key-text)', cursor: 'pointer' }}>
                C
              </button>
              <button type="button"
                onClick={() => {
                  assertCartEditable()
                  const val = parseFloat(docDiscInput.replace(',', '.')) || 0
                  if (docDiscMode === 'rate') {
                    const maxPct = settings.cashier.maxDocDiscountPct
                    if (val > maxPct) {
                      showError('İndirim Limiti', `Maksimum belge indirimi %${maxPct}`)
                      return
                    }
                    setDocDiscountRate(val)
                    setDocDiscountAmt(0)
                  } else {
                    const maxPct = settings.cashier.maxDocDiscountPct
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
          <div className="pos-modal" style={{
            background: 'var(--pos-surface)', borderRadius: 16, padding: '20px 16px 24px',
            width: 'min(720px, 92vw)',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>SMS Bildirimi</div>
                <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                  5 ile başlayan 10 hane
                </div>
              </div>
              <button type="button" onClick={() => setSmsPhonePanelOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20,
                  color: 'var(--pos-text-muted)', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{
              textAlign: 'center', padding: '10px 0',
              fontSize: 26, fontWeight: 700, color: 'var(--pos-primary)',
              letterSpacing: 0.5, minHeight: 48, wordBreak: 'break-all',
            }}>
              {formatTrMobileSmsDisplay(smsPhoneDraft) || '—'}
            </div>

            <div className="pos-numpad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(k => {
                const firstEmpty = smsPhoneDraft.replace(/\D/g, '').length === 0
                const disabledFirst = firstEmpty && k !== '5'
                return (
                  <button key={k} type="button" disabled={disabledFirst}
                    onClick={() => {
                      if (!disabledFirst) setSmsPhoneDraft(p => appendTrMobileSmsDigit(p, k))
                    }}
                    style={{ padding: '14px 0', borderRadius: 10,
                      border: '1px solid var(--pos-key-border)', background: 'var(--pos-key-bg)',
                      fontSize: 18, fontWeight: 600, color: 'var(--pos-key-text)',
                      cursor: disabledFirst ? 'default' : 'pointer',
                      opacity: disabledFirst ? 0.38 : 1 }}>
                    {k}
                  </button>
                )
              })}
            </div>
            <div className="pos-numpad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <button type="button" onClick={() => setSmsPhoneDraft('')}
                style={{ padding: '14px 0', borderRadius: 10, border: '1px solid var(--pos-key-border)',
                  background: 'var(--pos-key-bg)', fontSize: 15, fontWeight: 600,
                  color: 'var(--pos-key-text)', cursor: 'pointer' }}>
                C
              </button>
              <button type="button"
                disabled={smsPhoneDraft.replace(/\D/g, '').length === 0}
                onClick={() => setSmsPhoneDraft(p => appendTrMobileSmsDigit(p, '0'))}
                style={{ padding: '14px 0', borderRadius: 10,
                  border: '1px solid var(--pos-key-border)', background: 'var(--pos-key-bg)',
                  fontSize: 18, fontWeight: 600, color: 'var(--pos-key-text)', cursor: 'pointer',
                  opacity: smsPhoneDraft.replace(/\D/g, '').length === 0 ? 0.38 : 1 }}>
                0
              </button>
              <button type="button"
                onClick={() => setSmsPhoneDraft(p => p.replace(/\D/g, '').slice(0, -1))}
                style={{ padding: '14px 0', borderRadius: 10,
                  border: '1px solid var(--pos-key-border)', background: 'var(--pos-key-bg)',
                  fontSize: 18, fontWeight: 600, color: 'var(--pos-key-text)', cursor: 'pointer' }}>
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
                  border: '1px solid var(--pos-border)', background: 'var(--pos-surface-alt)',
                  fontSize: 13, fontWeight: 600, color: 'var(--pos-text)', cursor: 'pointer' }}>
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
                  background: 'var(--pos-key-action-bg)', fontSize: 15, fontWeight: 700,
                  color: 'var(--pos-key-action-text)', cursor: 'pointer' }}>
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
          <div className="pos-modal" style={{
            background: 'var(--pos-surface)', borderRadius: 16, padding: '20px 16px 24px',
            width: 'min(720px, 92vw)',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Mail Bildirimi</div>
                <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                  ornek@mail.com
                </div>
              </div>
              <button type="button" onClick={() => setMailModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20,
                  color: 'var(--pos-text-muted)', cursor: 'pointer' }}>✕</button>
            </div>

            <input
              type="email"
              value={mailAddr}
              onChange={e => setMailAddr(e.target.value)}
              placeholder="ornek@mail.com"
              autoFocus={!touchEnabled}
             
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
                border: `1.5px solid ${mailAddr && isValidNotifyEmail(mailAddr) ? 'var(--pos-primary)' : 'var(--pos-border)'}`,
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
                  border: '1px solid var(--pos-border)', background: 'var(--pos-surface-alt)',
                  fontSize: 13, fontWeight: 600, color: 'var(--pos-text)', cursor: 'pointer' }}>
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
                  background: 'var(--pos-primary)', fontSize: 15, fontWeight: 700,
                  color: 'var(--pos-primary-text)', cursor: 'pointer' }}>
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
          <div style={{ background: 'var(--pos-surface)', borderRadius: 16, padding: 24,
            width: 'min(380px, 92vw)', display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div style={{ fontSize: 16, fontWeight: 700 }}>📂 Tamamlanmamış Satış</div>

            <div style={{ fontSize: 13, color: 'var(--pos-text-muted)', lineHeight: 1.5 }}>
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
                  background: 'var(--pos-primary)', color: 'var(--pos-primary-text)', fontWeight: 700,
                  fontSize: 14, cursor: 'pointer' }}>
                Geri Yükle
              </button>
              <button type="button"
                onClick={() => {
                  void window.electron.cart.clearDraft()
                  setDraftModal(null)
                }}
                style={{ flex: 1, padding: '12px', borderRadius: 10,
                  border: '1px solid var(--pos-border)', background: 'var(--pos-surface-alt)',
                  color: 'var(--pos-text-muted)', fontSize: 14, cursor: 'pointer' }}>
                Sil
              </button>
            </div>
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
            background: 'var(--pos-surface)', borderRadius: 16, padding: 20,
            width: 'min(300px, 92vw)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>İade Tutarı</div>
            <div style={{ fontSize: 11, color: 'var(--pos-text-muted)' }}>
              Maksimum: {paymentNumpad.max.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
            </div>

            <div style={{
              background:   'var(--pos-surface-alt)',
              border:       '1.5px solid var(--pos-border)',
              borderRadius: 10,
              padding:      '12px 14px',
              textAlign:    'right',
              fontSize:     24,
              fontWeight:   700,
              color:        'var(--pos-text)',
              letterSpacing: 1,
              minHeight:    52,
            }}>
              {paymentNumpad.value === '' ? (
                <span style={{ color: 'var(--pos-text-muted)' }}>0</span>
              ) : (
                paymentNumpad.value
              )} ₺
            </div>

            <div className="pos-numpad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
              {['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(k => (
                <button key={k} type="button"
                  onClick={() => handlePaymentNumpadKey(k)}
                  style={{
                    padding:        '13px 0',
                    borderRadius:   9,
                    border:         '1.5px solid var(--pos-key-border)',
                    background:     'var(--pos-key-bg)',
                    color:          'var(--pos-key-text)',
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
                  border: '1px solid var(--pos-border)', background: 'var(--pos-surface-alt)',
                  fontSize: 14, cursor: 'pointer', color: 'var(--pos-text-muted)',
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
                  border: 'none', background: 'var(--pos-key-action-bg)',
                  color: 'var(--pos-key-action-text)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}>
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog {...dialogProps} />

      {/* ── Terazi modal ── */}
      {scaleModal && (() => {
        const netGram = Math.max(0, scaleModal.weight - scaleModal.tare)
        const netKg = Math.round(netGram) / 1000
        const scaleDisconnected = !scaleModal.raw && scaleModal.weight <= 0 && !scaleModal.stable
        return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="pos-modal" style={{
            background: 'var(--pos-surface)', borderRadius: 16, padding: 24,
            width: 'min(720px, 92vw)',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Terazi</div>
                <div style={{ fontSize: 12, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                  {scaleModal.product.name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScaleModal(null)}
                style={{
                  background: 'none', border: 'none', fontSize: 20,
                  color: 'var(--pos-text-muted)', cursor: 'pointer',
                }}
              >✕</button>
            </div>

            <div style={{
              background: scaleModal.stable ? 'var(--pos-soft-success)' : scaleDisconnected ? 'var(--pos-soft-danger)' : 'var(--pos-soft-warning)',
              border: `2px solid ${scaleModal.stable ? '#86EFAC' : scaleDisconnected ? '#FECACA' : '#FDE68A'}`,
              borderRadius: 12, padding: 16, textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginBottom: 4 }}>
                {scaleModal.stable ? 'Stabil (S)' : scaleDisconnected ? 'Bağlantı kurulamadı' : 'Ölçülüyor (U)...'}
                {scaleModal.tare > 0 ? ' · net' : ''}
              </div>
              <div style={{
                fontSize: 42, fontWeight: 800,
                color: scaleModal.stable ? '#15803D' : scaleDisconnected ? '#DC2626' : '#D97706',
                fontFamily: 'monospace', letterSpacing: 2,
              }}>
                {(Math.max(0, scaleModal.weight - scaleModal.tare) / 1000).toFixed(3)}
                <span style={{ fontSize: 20, marginLeft: 6 }}>kg</span>
              </div>
              {scaleModal.tare > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--pos-text-muted)', fontFamily: 'monospace' }}>
                  Brüt {(scaleModal.weight / 1000).toFixed(3)} − Dara {(scaleModal.tare / 1000).toFixed(3)}
                </div>
              )}
              {scaleModal.raw ? (
                <div style={{
                  marginTop: 8, fontSize: 12, fontFamily: 'monospace',
                  color: 'var(--pos-text-muted)', wordBreak: 'break-all',
                }}>
                  {scaleModal.raw}
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 11, color: scaleDisconnected ? '#DC2626' : 'var(--pos-text-muted)' }}>
                  {scaleDisconnected ? 'Terazi bağlantısı kurulamadı. Lütfen yeniden deneyin.' : 'Teraziden veri bekleniyor...'}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setScaleModal(m => m ? { ...m, tare: Math.max(0, m.weight) } : m)
                void window.electron.scale.write('T')
              }}
              style={{
                ...solidBtn(C.primary),
                padding: '12px 10px', borderRadius: 10, fontSize: 13,
              }}
            >
              Dara Al
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderRadius: 8,
                background: 'var(--pos-surface-alt)', border: '1px solid var(--pos-border)',
              }}>
                <span style={{ fontSize: 12, color: 'var(--pos-text-muted)' }}>Birim Fiyat (kg)</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pos-text)' }}>
                  {fmt(scaleModal.product.price)}
                </span>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px', borderRadius: 8, background: 'var(--pos-text)',
              }}>
                <span style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>Tutar</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: 'white' }}>
                  {fmt(Math.max(0, scaleModal.weight - scaleModal.tare) / 1000 * scaleModal.product.price)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (cart.length === 0 && !currentOrderNo) {
                  setCurrentOrderNo(nextOrderNo(settings.terminal.terminalInfo.terminalNumber))
                  setLastReceipt(null)
                }

                const lineTotal = Math.round(netKg * scaleModal.product.price * 100) / 100
                const item: CartItem = {
                  id: crypto.randomUUID(),
                  productId: scaleModal.product.id,
                  code: scaleModal.product.code ?? '',
                  name: scaleModal.product.name,
                  category: scaleModal.product.category ?? '',
                  price: scaleModal.product.price,
                  vatRate: scaleModal.product.vatRate ?? 18,
                  unit: scaleModal.product.unit ?? 'KG',
                  quantity: netKg,
                  lineTotal,
                  discountRate: 0,
                  discountAmount: 0,
                  netTotal: lineTotal,
                  barcode: scaleModal.product.barcode,
                }

                setCart(prev => [...prev, item])
                setScaleModal(null)
                playClickSound()
              }}
              style={{
                padding: 14, borderRadius: 10, border: 'none',
                background: scaleDisconnected ? 'var(--pos-primary)' : scaleModal.stable ? 'var(--pos-success)' : 'var(--pos-disabled-bg)',
                color: scaleDisconnected || scaleModal.stable ? 'var(--pos-primary-text)' : 'var(--pos-disabled-fg)',
                fontSize: 15, fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {scaleDisconnected ? '0 ile Sepete Ekle' : !scaleModal.stable ? 'Sepete Ekle' : 'Sepete Ekle'}
            </button>
          </div>
        </div>
        )
      })()}

      {/* ── MODALLER ── */}

      {/* Mesaj popup */}
      {pendingMessage && onMessageClose && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--pos-surface)', borderRadius: 16, padding: '36px 40px', maxWidth: 480, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Yönetici Mesajı</div>
            <div style={{ fontSize: 14, color: '#424242', lineHeight: 1.7, marginBottom: 28 }}>{pendingMessage.text}</div>
            <button onClick={onMessageClose} style={{ background: 'var(--pos-primary)', color: 'var(--pos-primary-text)', border: 'none', borderRadius: 10, padding: '12px 40px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
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
            className="pos-modal"
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--pos-surface)',
              borderRadius:  18,
              width:         'min(960px, 92vw)',
              maxHeight:     '88vh',
              display:       'flex',
              flexDirection: 'column',
              overflow:      'hidden',
              boxShadow:     '0 12px 40px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{
              padding:        '16px 20px',
              borderBottom:   '1px solid var(--pos-border)',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              flexShrink:     0,
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pos-text)' }}>
                  {heldActiveTab === 'held' ? 'Bekletilen Belgeler' : 'Askıdaki Ödemeler'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                  {heldActiveTab === 'held'
                    ? `${heldDocs.length} belge`
                    : `${pendingSales.length} askıdaki ödeme`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHeld(false)}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 20, color: 'var(--pos-text-muted)',
                }}
              >✕</button>
            </div>

            <div style={{
              display:      'flex',
              borderBottom: '2px solid var(--pos-border)',
              flexShrink:   0,
            }}>
              {[
                { id: 'held'    as const, label: '📋 Bekletilen', count: heldDocs.length },
                { id: 'pending' as const, label: '⏳ Askıdaki',   count: pendingSales.length },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setHeldActiveTab(tab.id)
                    if (tab.id === 'pending') void loadPendingSales()
                  }}
                  style={{
                    flex:         1,
                    padding:      '10px 0',
                    border:       'none',
                    background:   'transparent',
                    fontSize:     13,
                    fontWeight:   heldActiveTab === tab.id ? 700 : 500,
                    color:        heldActiveTab === tab.id ? 'var(--pos-text)' : 'var(--pos-text-muted)',
                    borderBottom: heldActiveTab === tab.id ? '2px solid var(--pos-text)' : '2px solid transparent',
                    marginBottom: -2,
                    cursor:       'pointer',
                    display:      'flex',
                    alignItems:   'center',
                    justifyContent: 'center',
                    gap:          6,
                  }}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span style={{
                      fontSize:     10,
                      fontWeight:   700,
                      background:   heldActiveTab === tab.id ? 'var(--pos-text)' : 'var(--pos-surface-alt)',
                      color:        heldActiveTab === tab.id ? 'var(--pos-surface)' : 'var(--pos-text-muted)',
                      borderRadius: 99,
                      padding:      '1px 6px',
                    }}>{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {heldActiveTab === 'held' && (
                <>
              {heldDocs.length === 0 ? (
                <div style={{
                  textAlign: 'center', padding: '48px 0',
                  color: 'var(--pos-text-muted)', fontSize: 13,
                }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                  Bekletilen belge yok
                </div>
              ) : heldDocs.map((doc, idx) => (
                <div
                  key={doc.id}
                  style={{
                    background:   idx % 2 === 0 ? 'var(--pos-surface)' : 'var(--pos-surface-alt)',
                    borderBottom: '1px solid var(--pos-border)',
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
                    background:     idx % 2 === 0 ? 'var(--pos-surface-alt)' : 'var(--pos-surface)',
                    color:          'var(--pos-text-muted)',
                    fontSize:       11,
                    fontWeight:     700,
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                    flexShrink:     0,
                    border:         '1px solid var(--pos-border)',
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
                        color:      'var(--pos-text)',
                        fontFamily: 'monospace',
                      }}>
                        {doc.orderNo || (doc.receiptNo ? `#${doc.receiptNo}` : doc.id.slice(0, 8).toUpperCase())}
                      </span>
                      <span style={{
                        fontSize:   14,
                        fontWeight: 700,
                        color:      'var(--pos-text)',
                      }}>
                        {fmt(doc.totalAmount ?? 0)}
                      </span>
                    </div>

                    <div style={{
                      fontSize:     20,
                      color:        'var(--pos-text)',
                      fontWeight:   700,
                      overflow:     'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace:   'nowrap',
                      marginBottom: 3,
                    }}>
                      {doc.label || '—'}
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--pos-text-muted)' }}>
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
                        border:       '1px solid var(--pos-border)',
                        background:   idx % 2 === 0 ? 'var(--pos-surface-alt)' : 'var(--pos-surface)',
                        fontSize:     11,
                        fontWeight:   600,
                        color:        'var(--pos-text)',
                        cursor:       'pointer',
                      }}
                    >🔍 İncele</button>

                    <button
                      type="button"
                      onClick={() => {
                        const raw = (doc.label ?? '').trim()
                        setHoldDraft({
                          mode: 'edit',
                          id: doc.id,
                          note: DEFAULT_HELD_LABEL.test(raw) ? '' : raw.slice(0, 60),
                        })
                      }}
                      style={{
                        padding:      '6px 10px',
                        borderRadius: 7,
                        border:       '1px solid var(--pos-border)',
                        background:   idx % 2 === 0 ? 'var(--pos-surface-alt)' : 'var(--pos-surface)',
                        fontSize:     11,
                        fontWeight:   600,
                        color:        'var(--pos-text)',
                        cursor:       'pointer',
                      }}
                    >✏️ İsim</button>

                    <button
                      type="button"
                      onClick={() => void retrieveDoc(doc)}
                      style={{
                        ...solidBtn(C.primary),
                        padding:      '6px 14px',
                        borderRadius: 7,
                        fontSize:     11,
                      }}
                    >📂 Getir</button>
                  </div>
                </div>
              ))}
                </>
              )}

              {heldActiveTab === 'pending' && (
                <>
                  {pendingLoading ? (
                    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--pos-text-muted)', fontSize: 13 }}>
                      <div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>
                      Yükleniyor...
                    </div>
                  ) : pendingError ? (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: '#B91C1C', fontSize: 13 }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>
                        {isNetworkFetchError(pendingError) ? 'Bağlantı kurulamadı' : 'Liste alınamadı'}
                      </div>
                      <div style={{ color: 'var(--pos-text-muted)', fontSize: 12 }}>{pendingError}</div>
                      <button
                        type="button"
                        onClick={() => void loadPendingSales()}
                        style={{
                          marginTop: 14, padding: '8px 14px', borderRadius: 8,
                          border: '1px solid #FECACA', background: 'var(--pos-soft-danger)',
                          color: '#B91C1C', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                        }}
                      >
                        Tekrar Dene
                      </button>
                    </div>
                  ) : pendingSales.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--pos-text-muted)', fontSize: 13 }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                      Askıdaki ödeme yok
                    </div>
                  ) : pendingSales.map(sale => (
                    <div key={sale.saleNumber || sale.orderNo || sale.saleId} style={{
                      borderBottom: '1px solid var(--pos-border)',
                      padding:      '14px 20px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'flex-start', marginBottom: 10 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pos-text)' }}>
                            {sale.orderNo}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                            Satış No: {sale.saleNumber}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pos-text)' }}>
                            {fmt(sale.totalPrice)}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                            Toplam
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        <div style={{ flex: 1, background: 'var(--pos-soft-success)', borderRadius: 7,
                          padding: '6px 10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--pos-text-muted)' }}>Ödenen</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#16A34A' }}>
                            {fmt(sale.paidAmount)}
                          </div>
                        </div>
                        <div style={{ flex: 1, background: 'var(--pos-soft-danger)', borderRadius: 7,
                          padding: '6px 10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--pos-text-muted)' }}>Kalan</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#DC2626' }}>
                            {fmt(sale.remainingPaymentAmount)}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => {
                            void (async () => {
                              if (!pavoSettings) return
                              try {
                                const seq = await window.electron.db.nextPavoSequence()
                                const res = await pavoAbandonSuspendedSale(pavoSettings, seq, {
                                  saleId:     sale.saleId,
                                  saleNumber: sale.saleNumber,
                                  orderNo:    sale.orderNo,
                                })
                                if (!res.success) {
                                  showApiError('Hata', res.message ?? 'İptal başarısız')
                                  return
                                }
                                setPaymentLines([])
                                setActiveMethod(null)
                                setPendingAmount('')
                                setSelectedBrand(null)
                                void loadPendingSales()
                              } catch (e) {
                                showCaughtError('Hata', e)
                              }
                            })()
                          }}
                          style={{
                            flex: 1, padding: '8px 0', borderRadius: 8,
                            border: '1px solid #FECACA', background: 'var(--pos-soft-danger)',
                            color: '#DC2626', fontWeight: 600, fontSize: 12, cursor: 'pointer',
                          }}
                        >
                          ✕ İptal Et
                        </button>

                        {sale.remainingPaymentAmount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              void (async () => {
                                if (!sale.items.length) {
                                  showError('Sepet Yüklenemedi', 'Bu satışın kalem bilgisi Pavo’dan gelmedi.')
                                  return
                                }
                                const enriched = await cartFromPendingSaleItems(sale.items)
                                const missing = enriched.filter(i => i.needsProductMatch)
                                if (missing.length) {
                                  showError(
                                    'Ürün Eşleşmedi',
                                    `Bu satıştaki ürün(ler) kasada bulunamadı, ERP'ye gönderilemez: ${missing.map(m => m.name).join(', ')}`,
                                  )
                                }
                                const cartOnly = enriched.map(({ needsProductMatch: _, ...c }) => c)
                                const lineSum = cartOnly.reduce((s, c) => s + c.netTotal, 0)
                                const docGap = parseFloat(
                                  Math.max(0, lineSum - Number(sale.totalPrice ?? 0)).toFixed(2),
                                )
                                setShowHeld(false)
                                setCart(cartOnly)
                                setDocDiscountAmt(docGap > 0.009 ? docGap : 0)
                                setDocDiscountRate(0)
                                if (docGap > 0.009) setDocDiscMode('amt')
                                setCurrentOrderNo(sale.orderNo || null)
                                setPaymentMode(true)
                                setPaymentLines([])
                                setActiveMethod(null)
                                setSelectedBrand(null)
                                setPendingAmount(
                                  sale.remainingPaymentAmount
                                    .toLocaleString('tr-TR', { minimumFractionDigits: 2 })
                                )
                                setPavoPendingSaleRef({
                                  saleId:     sale.saleId > 0 ? sale.saleId : null,
                                  saleNumber: sale.saleNumber || null,
                                  orderNo:    sale.orderNo,
                                  totalPrice: sale.totalPrice,
                                  paidAmount: sale.paidAmount,
                                })
                              })()
                            }}
                            style={{
                              flex: 2, padding: '8px 0', borderRadius: 8,
                              border: 'none', background: 'var(--pos-text)',
                              color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                            }}
                          >
                            💳 Kalan Ödemeyi Al ({fmt(sale.remainingPaymentAmount)})
                          </button>
                        )}

                        {sale.remainingPaymentAmount <= 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              void (async () => {
                                if (!pavoSettings) return
                                try {
                                  const seq = await window.electron.db.nextPavoSequence()
                                  const res = await pavoCompleteUncompletedSale(pavoSettings, seq, {
                                    saleId:     sale.saleId > 0 ? sale.saleId : null,
                                    saleNumber: sale.saleNumber || null,
                                    orderNo:    sale.orderNo,
                                  })
                                  if (!res.success) {
                                    showApiError('Hata', res.message ?? 'Satış kapatılamadı')
                                    return
                                  }

                                  const pavoData = unwrapPavoInnerData(res.data)
                                  const cartItems = await cartFromPavoData(pavoData)
                                  const pavoLines = linesFromPavoData(pavoData)
                                  const fallbackCart = await cartFromPendingSaleItems(sale.items)
                                  const effectiveCart = cartItems.length > 0 ? cartItems : fallbackCart
                                  const missing = effectiveCart.filter(i => (i as { needsProductMatch?: boolean }).needsProductMatch)
                                  if (missing.length) {
                                    showError(
                                      'Ürün Eşleşmedi',
                                      `Bu satıştaki ürün(ler) kasada bulunamadı: ${missing.map(m => m.name).join(', ')}`,
                                    )
                                  }
                                  const finalSale = await fetchFinalPavoResult(sale.orderNo)
                                  await finalizeSaleToSQLite({
                                    lines:              pavoLines.length > 0 ? pavoLines : [{
                                      id: crypto.randomUUID(),
                                      method: 'card' as const,
                                      amount: sale.totalPrice,
                                      label: 'Kredi Kartı',
                                      mediator: 2,
                                    }],
                                    orderNo:            sale.orderNo,
                                    deviceResult:       finalSale
                                      ? deviceResultFromPavoData(finalSale.raw)
                                      : deviceResultFromPavoData(res.data),
                                    cartOverride:       effectiveCart.map(({ needsProductMatch: _, ...c }) => c as CartItem),
                                    grandTotalOverride: sale.totalPrice,
                                    recovered:          true,
                                  })

                                  void loadPendingSales()
                                } catch (e) {
                                  showCaughtError('Hata', e)
                                }
                              })()
                            }}
                            style={{
                              flex: 2, padding: '8px 0', borderRadius: 8,
                              border: 'none', background: '#16A34A',
                              color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                            }}
                          >
                            ✓ Satışı Kapat
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
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
            style={{ background: 'var(--pos-surface)', borderRadius: 14, padding: 20,
              width: 'min(420px, 94vw)', maxHeight: '80vh',
              display: 'flex', flexDirection: 'column', gap: 12 }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {heldPreview.orderNo || (heldPreview.receiptNo ? `#${heldPreview.receiptNo}` : heldPreview.id.slice(0, 8).toUpperCase())}
                </div>
                <div style={{ fontSize: 12, color: 'var(--pos-text-muted)' }}>
                  {heldPreview.label ?? '—'}
                </div>
              </div>
              <button type="button" onClick={() => setHeldPreview(null)}
                style={{ background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 18, color: 'var(--pos-text-muted)' }}>✕</button>
            </div>

            {heldPreview.customerName && (
              <div style={{ padding: '8px 12px', borderRadius: 8,
                background: 'var(--pos-hover)', fontSize: 12, color: '#0369A1' }}>
                👤 {heldPreview.customerName}
              </div>
            )}

            <div style={{ overflowY: 'auto', flex: 1,
              display: 'flex', flexDirection: 'column', gap: 4 }}>
              {heldPreview.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '8px 10px', borderRadius: 8,
                  background: i % 2 === 0 ? 'var(--pos-surface-alt)' : 'var(--pos-surface)',
                  border: '1px solid var(--pos-border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pos-text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--pos-text-muted)' }}>
                      {fmtQty(item.quantity)} {item.unit ?? 'Adet'} × {fmt(item.price)}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pos-text)',
                    flexShrink: 0, marginLeft: 8 }}>
                    {fmt(item.netTotal ?? item.lineTotal ?? item.price * item.quantity)}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: 8,
              background: 'var(--pos-bg)', border: `1px solid var(--pos-border)` }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pos-text)' }}>Toplam</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.primary }}>
                {fmt(heldPreview.totalAmount ?? 0)}
              </span>
            </div>

            <button type="button"
              onClick={() => {
                void retrieveDoc(heldPreview)
                setHeldPreview(null)
              }}
                style={{ ...solidBtn(C.primary), padding: '12px', borderRadius: 10, fontSize: 14 }}>
              📂 Belgeyi Getir
            </button>
          </div>
        </div>
      )}

      {holdDraft && (
        <PosModal
          title="Beklemeye Al"
          size="sm"
          zIndex={10000}
          onClose={() => setHoldDraft(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  if (holdDraft.mode === 'edit') setHoldDraft(null)
                  else void commitHoldNote('', true)
                }}
                style={modalActionStyle(C.neutral)}
              >Atla</button>
              <button
                type="button"
                onClick={() => void commitHoldNote(holdDraft.note, false)}
                style={modalActionStyle(C.success)}
              >Kaydet</button>
            </>
          }
        >
          <label style={{ display: 'block', fontSize: 20, fontWeight: 600, marginBottom: 12, color: 'var(--pos-text)' }}>
            Not (isteğe bağlı)
          </label>
          <input
            ref={holdNoteRef}
            autoFocus={!touchEnabled}
           
            maxLength={60}
            value={holdDraft.note}
            onChange={e => setHoldDraft(prev => prev ? { ...prev, note: e.target.value.slice(0, 60) } : prev)}
            onClick={() => {
              if (!touchEnabled) return
              openKeyboard({
                title: 'Not (isteğe bağlı)',
                initial: holdDraft.note,
                type: 'qwerty',
                onConfirm: (v) => { void commitHoldNote(v.slice(0, 60), false) },
              })
            }}
            onKeyDown={e => { if (e.key === 'Enter') void commitHoldNote(holdDraft.note, false) }}
            placeholder="Masa 4 – Ahmet bey, paket bekliyor"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              borderRadius: 12,
              border: `1px solid var(--pos-border)`,
              padding: '0 16px',
              outline: 'none',
              color: 'var(--pos-text)',
            }}
          />
        </PosModal>
      )}

      {/* Müşteri seç */}
      {showCustomer && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="pos-modal" data-pos-popup="" tabIndex={-1} style={{ background: 'var(--pos-surface)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 14, width: 'min(720px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--pos-surface-alt)' }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Müşteri Seç</span>
              <button type="button" data-pos-cancel="" onClick={() => setShowCustomer(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--pos-text)' }}>✕</button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1 }}>
            <input
              data-autofocus=""
              data-kb="text"
              value={customerQ}
              onChange={e => {
                setCustomerQ(e.target.value)
                void loadCustomersForModal(e.target.value)
              }}
              placeholder="Ad, telefon, vergi no…"
              style={{ background: 'var(--pos-surface)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }}
            />
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {customers.map(c => {
                const active = (customerPickId ?? customers[0]?.id) === c.id
                const tax = c.taxNo ? `${c.isPerson === false ? 'VKN' : 'TC'} ${c.taxNo}` : ''
                return (
                  <div key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setCustomerPickId(c.id)}
                    onDoubleClick={() => { selectCustomer(c); setCustomerQ('') }}
                    style={{
                      border: `1px solid ${active ? 'var(--pos-primary)' : 'var(--pos-border)'}`,
                      background: active ? 'var(--pos-surface-alt)' : 'var(--pos-surface)',
                      color: 'var(--pos-text)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--pos-text-muted, var(--pos-text))', opacity: 0.75 }}>{[c.phone, tax].filter(Boolean).join(' · ')}</div>
                    </div>
                    {settings.cashier.canEditCustomer && (
                      <button type="button" title="Düzenle" onClick={e => { e.stopPropagation(); setCustomerForm({ mode: 'edit', customer: c }) }} style={{ background: 'var(--pos-surface-alt)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>✎</button>
                    )}
                  </div>
                )
              })}
              {customers.length === 0 && customerQ.trim().length >= 2 && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--pos-text)' }}>
                  Bulunamadı
                  {settings.cashier.canAddCustomer && (
                    <>
                      {' — '}
                      <button
                        type="button"
                        onClick={() => setCustomerForm({ mode: 'create', query: customerQ.trim() })}
                        style={{ background: 'none', border: 'none', color: 'var(--pos-primary)', fontWeight: 700, cursor: 'pointer' }}
                      >
                        + “{customerQ.trim()}” adıyla yeni müşteri
                      </button>
                    </>
                  )}
                </div>
              )}
              {customers.length === 0 && customerQ.trim().length < 2 && (
                <div style={{ textAlign: 'center', color: 'var(--pos-text)', opacity: 0.7, padding: '32px 0', fontSize: 13 }}>
                  Aramak için en az 2 karakter yazın
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              {settings.cashier.canAddCustomer ? (
                <button type="button" onClick={() => setCustomerForm({ mode: 'create', query: /^\d+$/.test(customerQ.trim()) || customerQ.trim().length >= 2 ? customerQ.trim() : '' })} style={{ background: 'var(--pos-surface-alt)', color: 'var(--pos-text)', border: '1px solid var(--pos-border)', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }}>+ Yeni Müşteri</button>
              ) : <span />}
              <button
                type="button"
                disabled={!customers.length}
                onClick={() => {
                  const row = customers.find(c => c.id === (customerPickId ?? customers[0]?.id))
                  if (!row) return
                  selectCustomer(row)
                  setCustomerQ('')
                }}
                style={{ background: 'var(--pos-primary)', color: 'var(--pos-primary-text)', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 800, cursor: customers.length ? 'pointer' : 'default', opacity: customers.length ? 1 : 0.5 }}
              >Seç</button>
            </div>
            </div>
          </div>
        </div>
      )}

      {customerForm && (
        <CustomerFormModal
          mode={customerForm.mode}
          query={customerForm.query}
          customer={customerForm.customer}
          defaultCity={settings.terminal.terminalInfo.workplace?.city ?? ''}
          cashierId={cashier.id}
          terminalId={terminalId ?? ''}
          companyId={companyId}
          online={isOnline}
          onClose={() => setCustomerForm(null)}
          onForbidden={message => {
            showToast(message, 'error')
            setCustomerForm(null)
          }}
          onSaved={(row, opts) => {
            void (async () => {
              await window.electron.db.upsertCustomer({
                ...row,
                previousId: opts?.previousId,
                companyId,
                email: row.email ?? '',
                taxOffice: row.taxOffice ?? '',
                syncedAt: new Date().toISOString(),
              })
              const selectIt = opts?.select === true || customerForm.mode === 'create' || selectedCustomer?.id === row.id || (!!opts?.previousId && selectedCustomer?.id === opts.previousId)
              if (selectIt) selectCustomer({ ...row, companyId })
              setCustomerForm(null)
              if (selectIt) setShowCustomer(false)
              void loadCustomersForModal(customerQ)
              showToast('✓ Müşteri kaydedildi', 'success', 2000)
            })()
          }}
        />
      )}

      {/* ── 4 PANEL — toplam %100 ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, minWidth: 0, background: 'transparent' }}>

        {/* ① SEPET — %42 */}
        <div className="pos-cart" style={{ width: '42%', flexShrink: 0, minWidth: 280, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--pos-border)', ...(cartLocked ? { pointerEvents: 'none', opacity: 0.55 } : {}) }}>

          {/* Sepet header */}
          <div style={{
            padding: '6px 12px',
            background: returnMode ? 'var(--pos-soft-danger)' : 'var(--pos-surface)',
            borderBottom: `2px solid ${returnMode ? '#DC2626' : 'var(--pos-border)'}`,
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
              color: returnMode ? '#DC2626' : 'var(--pos-text)',
            }}>
              {returnMode ? 'İade Belgesi' : 'Satış Belgesi'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <span style={{ fontSize: 11, color: 'var(--pos-text-muted)' }}>
                {cart.length > 0 ? `${cart.length} kalem` : 'Boş'}
              </span>
              {returnMode && (
                <button
                  type="button"
                  onClick={() => { setReturnMode(false); clearCart() }}
                  style={{ background: 'none', border: 'none',
                    cursor: 'pointer', color: 'var(--pos-text-muted)', fontSize: 12 }}>
                  İptal
                </button>
              )}
            </div>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: CART_GRID,
            padding: '8px 14px', background: 'var(--pos-surface)',
            borderBottom: '1px solid var(--pos-border)', flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, color: 'var(--pos-text-muted)', fontWeight: 600, textTransform: 'uppercase' }} />
            <span style={{ fontSize: 9, color: 'var(--pos-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Ürün Adı</span>
            <span style={{ fontSize: 9, color: 'var(--pos-text-muted)', fontWeight: 600, textTransform: 'uppercase', textAlign: 'center' }}>Miktar</span>
            <span style={{ fontSize: 9, color: 'var(--pos-text-muted)', fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>Tutar</span>
          </div>

          <div ref={cartListRef}
            onClick={() => { if (swipeState) setSwipeState(null) }}
            style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: 0,
            background: 'transparent',
            padding: '6px 10px 10px',
          }}>
            {cart.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--pos-text-muted)', fontSize: 13, flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 32 }}>🛒</span>
                <span>Sepet boş — ürün seçin veya barkod okutun</span>
              </div>
            ) : cart.map((item, rowIdx) => {
              const dr = item.discountRate ?? 0
              const gross = parseFloat((item.price * item.quantity).toFixed(2))
              const lineDiscTl = Math.max(0, parseFloat((gross - item.netTotal).toFixed(2)))
              const hasLineDisc = lineDiscTl > 0.009
              const discLabel = dr > 0 ? `İndirim %${dr}` : 'İndirim'
              const rowBg = returnMode
                ? 'var(--pos-soft-blush)'
                : (rowIdx % 2 === 0 ? 'var(--pos-surface)' : 'var(--pos-row-alt)')
              const metaPill = (key: string, text: string, mono = false) => (
                <span key={key} style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '0 5px', height: 16, borderRadius: 3,
                  fontSize: cartSettings.fsPill, whiteSpace: 'nowrap', flexShrink: 0,
                  background: 'var(--pos-bg)', color: 'var(--pos-text-muted)', border: `1px solid var(--pos-border)`,
                  fontFamily: mono ? 'monospace' : undefined,
                }}>{text}</span>
              )
              const pills: ReactNode[] = []
              if (settings.cashier.showCode && item.code?.trim()) pills.push(metaPill('kod', item.code, true))
              if (cartSettings.showBarkod && item.barcode?.trim()) pills.push(metaPill('bar', item.barcode, true))
              if (cartSettings.showBirim) pills.push(metaPill('birim', item.unit ?? 'Adet'))
              if (cartSettings.showFiyat) pills.push(metaPill('fp', fmt(item.price)))
              if (cartSettings.showKdv) pills.push(metaPill('kdv', `KDV %${item.vatRate}`))

              return (
                <div
                  key={item.id}
                  id={`cart-row-${item.id}`}
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
                      removeCartLine(item.id)
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
                      display:             'flex',
                      flexDirection:       'column',
                      background:          rowBg,
                      borderRadius:        11,
                      border:              '1px solid var(--pos-border)',
                      borderLeft:          returnMode ? '3px solid #DC2626' : '1px solid var(--pos-border)',
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
                      animation:           flashLineId === item.id ? 'cartLineFlash 0.6s ease' : undefined,
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.background = 'var(--pos-row-hover)'
                    }}
                  >
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: CART_GRID,
                    padding: '8px 12px',
                    alignItems: 'start',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <div style={{
                        minWidth: 14,
                        color: 'var(--pos-text-muted)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                      }}>
                        {rowIdx + 1}
                      </div>
                    {settings.cashier.allowLineDiscount ? (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setSmsPhonePanelOpen(false)
                          setMenuOpen(null)
                          setLineDiscountTarget(item.id)
                        }}
                        style={{
                          ...solidBtn(C.discountBar),
                          minWidth: 38,
                          height: 34,
                          borderRadius: 8,
                          padding: '3px 5px',
                          display: 'inline-flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: 1,
                          fontSize: 9,
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
                      color: 'var(--pos-text)',
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 2, minWidth: 0 }}>
                    {isWeighedUnit(item.unit) ? (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          openWeightEdit(item.id, item.quantity)
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        style={{
                          fontSize: cartSettings.fsMiktar,
                          fontWeight: 700,
                          color: paymentMode ? 'var(--pos-text)' : '#1D4ED8',
                          cursor: paymentMode ? 'default' : 'pointer',
                          border: 'none',
                          background: 'transparent',
                          borderBottom: paymentMode ? 'none' : '1px dashed #93C5FD',
                          fontFamily: 'monospace',
                          fontVariantNumeric: 'tabular-nums',
                          padding: '2px 0',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.quantity.toFixed(3)} kg
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); updateQty(item.id, -1) }}
                          style={{
                            width: 24, height: 24, flexShrink: 0, border: '1px solid var(--pos-border)',
                            background: 'var(--pos-surface)', borderRadius: 6, cursor: 'pointer',
                            fontSize: 14, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', color: 'var(--pos-text)', fontWeight: 600,
                          }}
                        >−</button>
                        <span style={{
                          fontSize: (() => {
                            const q = fmtQty(item.quantity)
                            const base = cartSettings.fsMiktar
                            if (q.length >= 8) return Math.min(base, 10)
                            if (q.length >= 6) return Math.min(base, 11)
                            return base
                          })(),
                          fontWeight: 700,
                          color: 'var(--pos-text)',
                          minWidth: 44,
                          maxWidth: 56,
                          textAlign: 'center',
                          fontVariantNumeric: 'tabular-nums',
                          lineHeight: 1.1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>{fmtQty(item.quantity)}</span>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); updateQty(item.id, 1) }}
                          style={{
                            width: 24, height: 24, flexShrink: 0, border: '1px solid var(--pos-border)',
                            background: 'var(--pos-surface)', borderRadius: 6, cursor: 'pointer',
                            fontSize: 14, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', color: 'var(--pos-text)', fontWeight: 600,
                          }}
                        >+</button>
                      </>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {hasLineDisc && (
                      <div style={{
                        fontSize: cartSettings.fsTutarSub,
                        color: 'var(--pos-text-muted)',
                        textDecoration: 'line-through',
                        fontWeight: 500,
                      }}>{fmt(gross)}</div>
                    )}
                    <div style={{
                      fontSize: cartSettings.fsTutar, fontWeight: 700,
                      color: 'var(--pos-text)',
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
                      fontSize: cartSettings.fsTutarSub, color: 'var(--pos-text-muted)', marginTop: 1,
                      cursor: paymentMode ? 'default' : 'pointer',
                      borderBottom: paymentMode ? 'none' : `1px dashed var(--pos-border)`,
                      display: 'inline-block',
                    }}>{fmtQty(item.quantity)} × {fmt(item.price)}</div>
                  </div>
                  </div>
                  {hasLineDisc && (
                    <div style={{ padding: '0 8px 8px' }}>
                      <DiscountLine
                        label={discLabel}
                        amount={`−${fmt(lineDiscTl)}`}
                        fontSize={cartSettings.fsUrunKod}
                      />
                    </div>
                  )}
                </div>
                </div>
              )
            })}
          </div>

          {/* Özet + toplam */}
          <div style={{
            margin: '4px 10px 10px',
            borderRadius: 12,
            border: '1px solid var(--pos-border)',
            background: 'var(--pos-surface)',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
            overflow: 'hidden',
            flexShrink: 0,
          }}>
            <div style={{ padding: '8px 14px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--pos-text-muted)', padding: '2px 0' }}>
                <span>Ara toplam</span>
                <span>{fmt(araToplamBrut)}</span>
              </div>
              {belgeIndirimi > 0 && (
                <div style={{ margin: '4px 0' }}>
                  <DiscountLine
                    label={docDiscountRate > 0 ? `Belge indirimi %${docDiscountRate}` : 'Belge indirimi'}
                    amount={`−${fmt(belgeIndirimi)}`}
                    fontSize={cartSettings.fsUrunKod}
                  />
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--pos-text-muted)', padding: '2px 0' }}>
                <span>KDV Tutarı</span>
                <span>{fmt(toplamKdv)}</span>
              </div>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '10px 14px 12px',
              borderTop: `1px solid var(--pos-border)`,
              marginTop: 2,
              background: 'var(--pos-surface)',
              borderRadius: '0 0 11px 11px',
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pos-text)' }}>TOPLAM</span>
              <span style={{ fontSize: 28, fontWeight: 700, color: C.primary }}>{fmt(grandTotal)}</span>
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
          background: 'var(--pos-surface)',
          display: 'flex',
          flexDirection: 'column',
          padding: '6px 6px 0',
          ...(cartLocked ? { pointerEvents: 'none' as const, opacity: 0.55 } : {}),
          gap: 0,
          borderRight: '2px solid #9CA3AF',
          borderLeft: '2px solid #9CA3AF',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)',
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
              style={{ ...(smsPhone ? solidBtn(C.primary, !pavoSettings, true) : solidBtn(C.neutral, !pavoSettings)),
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center',
                gap: 4, padding: '4%', overflow: 'hidden', height: '100%' }}>
              <span style={{ fontSize: 'clamp(12px, 1.2vw, 18px)' }}>📱</span>
              <span style={{ fontSize: 'clamp(8px, 0.7vw, 11px)', fontWeight: 600,
                color: '#FFFFFF',
                whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis', display: 'block', width: '100%', textAlign: 'center' as const }}>
                {smsPhone ? formatTrMobileSmsDisplay(smsPhone) : 'SMS'}
              </span>
            </button>

            {/* Mail */}
            <button type="button"
              onClick={() => setMailModalOpen(true)}
              style={{ ...(mailAddr ? solidBtn(C.primary, false, true) : solidBtn(C.neutral)),
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center',
                gap: 4, padding: '4%', overflow: 'hidden', height: '100%' }}>
              <span style={{ fontSize: 'clamp(12px, 1.2vw, 18px)' }}>✉️</span>
              <span style={{ fontSize: 'clamp(8px, 0.7vw, 11px)', fontWeight: 600,
                color: '#FFFFFF',
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
              style={{ ...solidBtn(menuBtn.bg, false, menuOpen === 'islemler'),
                color: menuBtn.text,
                padding: '4% 2%', height: '100%', borderRadius: 8,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>☰</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)' }}>Menü</span>
            </button>

            <button type="button"
              onClick={() => setMenuOpen(m => m === 'belge' ? null : 'belge')}
              style={{ ...solidBtn(documentsBtn.bg, false, menuOpen === 'belge'),
                color: documentsBtn.text,
                padding: '4% 2%', height: '100%', borderRadius: 8,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>📄</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)' }}>Belge</span>
            </button>

            <button type="button"
              onClick={() => setMenuOpen(m => m === 'musteri' ? null : 'musteri')}
              style={{ ...solidBtn(customerBtn.bg, false, menuOpen === 'musteri' || !!selectedCustomer),
                color: customerBtn.text,
                padding: '4% 2%', height: '100%', borderRadius: 8,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4%' }}>
              <span style={{ fontSize: 'clamp(14px,1.4vw,22px)' }}>👤</span>
              <span style={{ fontSize: 'clamp(8px,0.7vw,11px)',
                whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis', width: '100%', textAlign: 'center' as const }}>
                {selectedCustomer ? selectedCustomer.name.split(' ')[0] : 'Müşteri'}
              </span>
            </button>

            <button type="button"
              onClick={() => { setMenuOpen('fiyatgor'); setFiyatGorQ(''); setFiyatGorItem(null) }}
              style={{ ...solidBtn(priceCheckBtn.bg, false, menuOpen === 'fiyatgor'),
                color: priceCheckBtn.text,
                padding: '4% 2%', height: '100%', borderRadius: 8,
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

            {/* Satır 1: numBuf göstergesi */}
            <div style={{
              flexShrink:     0,
              height:         40,
              borderRadius:   9,
              border:         `1.5px solid ${numBuf ? 'var(--pos-success)' : 'var(--pos-border)'}`,
              background:     'var(--pos-surface-alt)',
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
                color:         numBuf ? 'var(--pos-text)' : 'var(--pos-text-muted)',
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

            {/* Satır 2: TEMİZLE + ⌫ */}
            <div style={{ display: 'flex', gap: 5, flexShrink: 0, height: 44 }}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); handleNumKey('C') }}
                style={{
                  background:     'var(--pos-danger)',
                  color:          '#FFFFFF',
                  border:         'none',
                  cursor:         'pointer',
                  flex:           1,
                  borderRadius:   9,
                  fontSize:       13,
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
                  background:     'var(--pos-warning)',
                  color:          '#FFFFFF',
                  border:         'none',
                  cursor:         'pointer',
                  flex:           1,
                  borderRadius:   9,
                  fontSize:       20,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  userSelect:     'none' as const,
                  gap:            6,
                }}
              >⌫</button>
            </div>

            {/* Numpad grid */}
            <div className="pos-numpad" style={{
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
                  className="pos-key"
                  onMouseDown={e => { e.preventDefault(); handleNumKey(k) }}
                  style={{
                    width:          '100%',
                    height:         '100%',
                    boxSizing:      'border-box',
                    border:         '1.5px solid var(--pos-key-border)',
                    borderRadius:   9,
                    cursor:         'pointer',
                    fontWeight:     700,
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                    userSelect:     'none' as const,
                    background:     'var(--pos-key-bg)',
                    color:          'var(--pos-key-text)',
                    fontSize:       'clamp(14px, 1.4vw + 4px, 26px)',
                  }}
                >{k}</button>
              ))}

              <button
                type="button"
                className="pos-key-action"
                onMouseDown={e => {
                  e.preventDefault()
                  if (!numBuf) return
                  setSearchQ(numBuf)
                  setNumBuf('')
                }}
                style={{
                  ...(!numBuf
                    ? solidBtn(C.primary, true)
                    : { background: 'var(--pos-key-action-bg)', color: 'var(--pos-key-action-text)', border: 'none', cursor: 'pointer' }),
                  width:          '100%',
                  height:         '100%',
                  boxSizing:      'border-box',
                  borderRadius:   9,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  userSelect:     'none' as const,
                  fontSize:       'clamp(10px, 0.9vw + 3px, 14px)',
                }}
              >enter</button>
            </div>

          </div>

          </div>

          {menuOpen && menuOpen !== 'fiyatgor' && (
            <PosModal
              title={{ islemler: 'İşlemler', belge: 'Belge İşlemleri', musteri: 'Müşteri İşlemleri' }[menuOpen]}
              size="md"
              zIndex={9991}
              themed
              onClose={() => setMenuOpen(null)}
            >
                <div className="pos-menu-grid">

                {menuOpen === 'islemler' && [
                  { icon: '💰', label: 'Cari tahsilat', hint: undefined as string | undefined, disabled: settings.terminal.cariPaymentUsePavo && !posReady, posLock: settings.terminal.cariPaymentUsePavo && !posReady },
                  { icon: '💸', label: 'Cari ödeme', hint: 'Kasadan nakit çıkışı', disabled: false, posLock: false },
                ].map((item, i) => (
                  <PopupItem key={i} icon={item.icon} label={item.label} hint={item.hint} disabled={item.disabled} accent="var(--pos-btn-menu-bg)" text="var(--pos-btn-menu-text)" layout="stack"
                    onClick={() => {
                      if (item.disabled) {
                        if (item.posLock) logPosBlocked()
                        return
                      }
                      if (item.label.startsWith('Cari tah')) {
                        setCariPaymentModal('tahsilat')
                        setCariPaymentAmt('')
                        setCariPaymentDesc('')
                        setCariPaymentResult(null)
                        setCariPaymentQ('')
                        setCariPaymentResults([])
                        setCariPaymentCust(selectedCustomer ?? null)
                        setCariPaymentMethod(null)
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
                        setCariPaymentMethod('cash')
                        setMenuOpen(null)
                      }
                    }} />
                ))}

                {menuOpen === 'belge' && [
                  { icon: '↩️', label: 'İade Al', disabled: !posReady, posLock: !posReady },
                  { icon: '⚡', label: 'Hızlı İade', disabled: !posReady, posLock: !posReady },
                  { icon: '%', label: docDiscountRate > 0 || docDiscountAmt > 0
                      ? `Belge İndirimi (${docDiscountRate > 0 ? `%${docDiscountRate}` : fmt(docDiscountAmt)})`
                      : 'Belge İndirimi',
                    disabled: cart.length === 0 || !(settings.cashier.allowDocDiscount), posLock: false },
                  { icon: '✕', label: 'Ürün İptal', disabled: cart.length === 0, posLock: false },
                  { icon: '⏸', label: 'Beklemeye al', disabled: cart.length === 0, posLock: false },
                  { icon: '🛒', label: `Belge getir${heldDocs.length ? ` (${heldDocs.length})` : ''}`, disabled: !posReady, posLock: !posReady },
                  { icon: '🚫', label: 'Belge iptal', disabled: !posReady || cart.length === 0, danger: true, posLock: !posReady },
                ].map((item, i) => (
                  <PopupItem key={i} icon={item.icon} label={item.label} disabled={item.disabled} danger={'danger' in item && item.danger} accent="var(--pos-btn-documents-bg)" text="var(--pos-btn-documents-text)" layout="stack"
                    onClick={() => {
                      if (item.disabled) {
                        if (item.posLock) logPosBlocked()
                        return
                      }
                      if (item.label.startsWith('Beklemeye')) { openHoldNote(); return }
                      if (item.label.startsWith('Belge getir')) { openHeldModal(); setMenuOpen(null); return }
                      if (item.label.startsWith('Belge iptal')) {
                        void confirm({
                          title:   'Belge İptal',
                          message: 'Belgeyi iptal etmek istediğinize emin misiniz?',
                          confirmLabel: 'Evet, İptal Et',
                          cancelLabel:  'Vazgeç',
                        }).then(ok => { if (ok) clearCart() })
                        return
                      }
                      if (item.label.startsWith('Belge İndirimi')) {
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
                      if (item.label === 'Ürün İptal') {
                        if (numBuf) {
                          setSearchQ(numBuf)
                          setCancelNextAdd(true)
                          setNumBuf('')
                        } else {
                          setCancelNextAdd(true)
                          showToast('Barkod okutun veya ürüne tıklayın — iptal edilecek', 'info')
                        }
                        setMenuOpen(null)
                        return
                      }
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
                  ...(settings.cashier.canAddCustomer ? [{ icon: '👤+', label: 'Müşteri ekle', disabled: false }] : []),
                  ...(settings.cashier.canEditCustomer ? [{ icon: '✏️', label: 'Müşteri düzenle', disabled: !selectedCustomer }] : []),
                  {
                    icon: '❌',
                    label: selectedCustomer
                      ? `${selectedCustomer.name.split(' ')[0]} — çıkar`
                      : 'Müşteri çıkar',
                    disabled: !selectedCustomer,
                    danger: true as boolean,
                  },
                ].map((item, i) => (
                  <PopupItem key={i} icon={item.icon} label={item.label} disabled={item.disabled} danger={'danger' in item && item.danger} accent="var(--pos-btn-customer-bg)" text="var(--pos-btn-customer-text)" layout="stack"
                    onClick={() => {
                      if (item.disabled) return
                      if (item.label === 'Müşteri seç') { void loadCustomers(); setMenuOpen(null); return }
                      if (item.label === 'Müşteri ekle') { setCustomerForm({ mode: 'create' }); setMenuOpen(null); return }
                      if (item.label === 'Müşteri düzenle') {
                        if (selectedCustomer) setCustomerForm({ mode: 'edit', customer: selectedCustomer })
                        setMenuOpen(null)
                        return
                      }
                      if (item.label.endsWith('— çıkar') || item.label === 'Müşteri çıkar') {
                        applyCustomerSelection(null)
                        setMenuOpen(null)
                      }
                    }} />
                ))}

                </div>
            </PosModal>
          )}

          {menuOpen === 'fiyatgor' && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.4)', display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setMenuOpen(null)}>
              <div className="pos-modal" onClick={e => e.stopPropagation()}
                style={{ background: 'var(--pos-surface)', borderRadius: 16, padding: 24,
                  width: 'min(720px, 92vw)', display: 'flex', flexDirection: 'column', gap: 16 }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--pos-text)',
                    display: 'flex', alignItems: 'center', gap: 8 }}>
                    🔍 Fiyat Gör
                  </div>
                  <button type="button" data-pos-cancel="" onClick={() => setMenuOpen(null)}
                    style={{ background: 'none', border: 'none', fontSize: 20,
                      cursor: 'pointer', color: 'var(--pos-text-muted)', padding: 0 }}>✕</button>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    ref={fiyatGorInputRef}
                    autoFocus
                    value={fiyatGorQ}
                    onChange={e => applyFiyatGorScan(e.target.value)}
                    placeholder="Barkod okut veya ürün adı gir..."
                    style={{ flex: 1, padding: '12px 14px', fontSize: 15, borderRadius: 10,
                      border: '1.5px solid var(--pos-border)', outline: 'none',
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
                      border: '1.5px solid var(--pos-border)', background: 'var(--pos-surface-alt)',
                      cursor: 'pointer', color: 'var(--pos-text-muted)', fontSize: 18,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0 }}>
                    ⌨️
                  </button>
                </div>

                {!fiyatGorItem && fiyatGorQ.length > 1 && (
                  <div style={{ maxHeight: 240, overflowY: 'auto',
                    border: '0.5px solid var(--pos-border)', borderRadius: 10, overflow: 'hidden' }}>
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
                            borderBottom: i < arr.length - 1 ? '0.5px solid var(--pos-border)' : 'none' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--pos-surface-alt)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--pos-surface)' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--pos-text)' }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', fontFamily: 'monospace', marginTop: 2 }}>{p.code}</div>
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--pos-primary)' }}>
                            {p.price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {fiyatGorItem && (
                  <div style={{ padding: 16, borderRadius: 12, background: 'var(--pos-hover)',
                    border: '1.5px solid #BAE6FD',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--pos-text)' }}>{fiyatGorItem.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--pos-text-muted)', marginTop: 2, fontFamily: 'monospace' }}>{fiyatGorItem.code ?? ''}</div>
                      <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginTop: 2 }}>KDV %{fiyatGorItem.vatRate}</div>
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--pos-primary)' }}>
                      {fiyatGorItem.price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button type="button" onClick={() => setMenuOpen(null)}
                    style={{ padding: '14px 0', fontSize: 14, borderRadius: 10,
                      border: '1px solid var(--pos-border)', background: 'var(--pos-surface)',
                      cursor: 'pointer', color: 'var(--pos-text)' }}>
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
                      background: fiyatGorItem ? 'var(--pos-primary)' : 'var(--pos-disabled-bg)',
                      color: fiyatGorItem ? 'var(--pos-primary-text)' : 'var(--pos-disabled-fg)',
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
              onClick={() => {
                if (cariPaymentSaving) return
                setCariPaymentModal(null)
                setCariPaymentMethod(null)
                setCariPaymentAmt('')
                setCariPaymentDesc('')
                setCariPaymentResult(null)
              }}>
              <div onClick={e => e.stopPropagation()}
                style={{ background: 'var(--pos-surface)', borderRadius: 16, padding: 24,
                  width: 'min(400px, 94vw)', display: 'flex', flexDirection: 'column', gap: 14 }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--pos-text)' }}>
                    {cariPaymentModal === 'tahsilat' ? '💰 Cari Tahsilat' : '💸 Cari Ödeme'}
                  </div>
                  <button type="button"
                    onClick={() => {
                      setCariPaymentModal(null)
                      setCariPaymentMethod(null)
                      setCariPaymentAmt('')
                      setCariPaymentDesc('')
                      setCariPaymentResult(null)
                    }}
                    disabled={cariPaymentSaving}
                    style={{ background: 'none', border: 'none', fontSize: 20,
                      cursor: 'pointer', color: 'var(--pos-text-muted)', padding: 0 }}>✕</button>
                </div>

                {cariPaymentModal === 'odeme' && (
                  <div style={{
                    background: 'var(--pos-surface-alt)',
                    borderLeft: '3px solid var(--pos-primary)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    color: 'var(--pos-text)',
                    fontSize: 16,
                    lineHeight: 1.45,
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                  }}>
                    <span style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }} aria-hidden>ℹ</span>
                    <div>
                      Cari ödeme, kasadan <strong>NAKİT</strong> para çıkışı içindir.
                      Müşteriye veya tedarikçiye kasadan para verdiğinizde kullanın.
                      Tutar kasadaki nakitten düşülür ve hesap almada &quot;kasadan çıkan&quot; olarak görünür.
                      Müşteriden para alıyorsanız &quot;Cari Tahsilat&quot;ı kullanın.
                    </div>
                  </div>
                )}

                {cariPaymentCust ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 14px', borderRadius: 10,
                    background: 'var(--pos-soft-success)', border: '1px solid #BBF7D0' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#166534', flex: 1 }}>
                      👤 {cariPaymentCust.name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--pos-text-muted)', fontFamily: 'monospace' }}>
                      {cariPaymentCust.code}
                    </span>
                    <button type="button"
                      onClick={() => { setCariPaymentCust(null); setCariPaymentQ(''); setCariPaymentResults([]) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--pos-text-muted)', fontSize: 14, padding: 0 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      autoFocus={!touchEnabled}
                      value={cariPaymentQ}
                     
                      onClick={() => {
                        if (!touchEnabled) return
                        openKeyboard({
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
                        })
                      }}
                      onChange={e => {
                        const v = e.target.value
                        setCariPaymentQ(v)
                        void searchCariPayment(v)
                      }}
                      placeholder="Cari ara... (ad veya kod)"
                      style={{ width: '100%', padding: '10px 14px', fontSize: 13,
                        borderRadius: 10, border: '1px solid var(--pos-border)', outline: 'none',
                        boxSizing: 'border-box' as const,
                        cursor: touchEnabled ? 'pointer' : 'text' }}
                    />
                    {cariPaymentSearching && (
                      <span style={{ position: 'absolute', right: 12, top: '50%',
                        transform: 'translateY(-50%)', color: 'var(--pos-text-muted)', fontSize: 12 }}>⟳</span>
                    )}
                    {cariPaymentResults.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0,
                        zIndex: 100, background: 'var(--pos-surface)', border: '1px solid var(--pos-border)',
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
                              borderBottom: '1px solid var(--pos-border)',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--pos-hover)' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--pos-surface)' }}>
                            <span style={{ fontWeight: 500 }}>{c.name}</span>
                            <span style={{ fontSize: 11, color: 'var(--pos-text-muted)', fontFamily: 'monospace' }}>{c.code}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ textAlign: 'center', padding: '12px 0',
                  fontSize: 28, fontWeight: 600, letterSpacing: 2,
                  color: cariPaymentModal === 'tahsilat' ? '#2E7D32' : '#C62828',
                  borderTop: '1px solid var(--pos-border)', borderBottom: '1px solid var(--pos-border)' }}>
                  {cariPaymentAmt || '—'} ₺
                </div>

                <div className="pos-numpad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
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
                        border: '1px solid var(--pos-key-border)', background: 'var(--pos-key-bg)', cursor: 'pointer',
                        color: 'var(--pos-key-text)' }}>
                      {k}
                    </button>
                  ))}
                </div>

                {/* Cari ödeme: yöntem sabit nakit. Tahsilat: Pavo açıksa nakit/kart seçimi */}
                {cariPaymentModal === 'odeme' ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--pos-border)',
                    background: 'var(--pos-surface-alt)',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pos-text-muted)' }}>Ödeme</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--pos-text)' }}>💵 Nakit</span>
                  </div>
                ) : settings.terminal.cariPaymentUsePavo && pavoSettings ? (
                  <div style={{ marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', marginBottom: 6, fontWeight: 600 }}>
                      Ödeme Yöntemi
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {([
                        { method: 'cash' as const, icon: '💵', label: 'Nakit', color: C.cash },
                        { method: 'card' as const, icon: '💳', label: 'Kart', color: C.card },
                      ]).map(btn => (
                        <button
                          key={btn.method}
                          type="button"
                          onClick={() => setCariPaymentMethod(
                            cariPaymentMethod === btn.method ? null : btn.method
                          )}
                          style={{
                            ...solidBtn(btn.color, false, cariPaymentMethod === btn.method),
                            padding: '10px',
                            borderRadius: 9,
                            fontSize: 13,
                          }}
                        >
                          {btn.icon} {btn.label}
                        </button>
                      ))}
                    </div>
                    {!cariPaymentMethod && (
                      <div style={{ fontSize: 10, color: 'var(--pos-text-muted)', marginTop: 4 }}>
                        Seçilmezse Pavo cihazından seçilir
                      </div>
                    )}
                  </div>
                ) : null}

                <div style={{ position: 'relative' }}>
                  <input
                    value={cariPaymentDesc}
                   
                    onClick={() => {
                      if (!touchEnabled) return
                      openKeyboard({
                        title:     'Açıklama',
                        initial:   cariPaymentDesc,
                        type:      'qwerty',
                        onConfirm: (v) => setCariPaymentDesc(v),
                      })
                    }}
                    onChange={e => setCariPaymentDesc(e.target.value)}
                    placeholder="Açıklama (opsiyonel)"
                    style={{ padding: '10px 14px', fontSize: 13, borderRadius: 10,
                      border: '1px solid var(--pos-border)', outline: 'none',
                      width: '100%', boxSizing: 'border-box' as const,
                      cursor: touchEnabled ? 'pointer' : 'text' }}
                  />
                  {touchEnabled && (
                    <span style={{ position: 'absolute', right: 10, top: '50%',
                      transform: 'translateY(-50%)', color: 'var(--pos-text-muted)', fontSize: 14,
                      pointerEvents: 'none' }}>
                      ⌨️
                    </span>
                  )}
                </div>

                {cariPaymentResult && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13,
                    background: cariPaymentResult.ok ? 'var(--pos-soft-success)' : 'var(--pos-soft-danger)',
                    border: `1px solid ${cariPaymentResult.ok ? '#BBF7D0' : '#FECACA'}`,
                    color: cariPaymentResult.ok ? '#166534' : '#991B1B' }}>
                    {cariPaymentResult.ok ? '✓' : '✗'} {cariPaymentResult.msg}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: cariPaymentModal === 'odeme' ? '1fr 1.4fr' : '1fr 2fr', gap: 10 }}>
                  {cariPaymentModal === 'odeme' ? (
                    <button type="button"
                      disabled={cariPaymentSaving}
                      onClick={() => {
                        if (cariPaymentSaving) return
                        setCariPaymentModal(null)
                        setCariPaymentMethod(null)
                        setCariPaymentAmt('')
                        setCariPaymentDesc('')
                        setCariPaymentResult(null)
                      }}
                      style={{ padding: '13px 0', fontSize: 14, fontWeight: 500,
                        borderRadius: 10, border: '1px solid var(--pos-border)',
                        background: 'var(--pos-surface-alt)', cursor: 'pointer', color: 'var(--pos-text)' }}>
                      Vazgeç
                    </button>
                  ) : (
                    <button type="button"
                      onMouseDown={e => { e.preventDefault(); setCariPaymentAmt('') }}
                      style={{ padding: '13px 0', fontSize: 14, fontWeight: 500,
                        borderRadius: 10, border: '1px solid var(--pos-border)',
                        background: 'var(--pos-surface-alt)', cursor: 'pointer', color: 'var(--pos-text)' }}>
                      C
                    </button>
                  )}
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
                        : cariPaymentModal === 'tahsilat' ? 'Tahsilat Yap' : 'Ödemeyi Yap'}
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
          background: 'transparent',
          ...(cartLocked ? { pointerEvents: 'none' as const, opacity: 0.55 } : {}),
        }}>

          {/* Arama — tam genişlik, en üstte */}
          <div style={{
            padding:      '6px 8px',
            flexShrink:   0,
            borderBottom: '1px solid var(--pos-border)',
            background: 'var(--pos-surface)',
          }}>
            <input
              ref={searchRef}
              data-pos-barcode=""
              data-kb="none"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchQ('') }}
              placeholder="Barkod veya ürün ara..."
              style={{
                width:        '100%',
                border:       '1px solid var(--pos-border)',
                borderRadius: 9,
                padding:      '9px 14px',
                fontSize:     14,
                outline:      'none',
                background: 'var(--pos-surface)',
                boxSizing:    'border-box',
              }}
            />
          </div>

          {/* PLU grid + Grup bar — yatay */}
          <div data-plu="" style={{
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
                borderBottom: '1px solid var(--pos-border)',
                display:      'flex',
                alignItems:   'center',
                gap:          6,
                height:       28,
                flexShrink:   0,
                background:   'var(--pos-surface)',
              }}>
                <div style={{ width: 3, height: 12, borderRadius: 2, background: activeColor, flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--pos-text)', whiteSpace: 'nowrap', flex: 1 }}>
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
                  style={{ width: 22, height: 22, background: 'var(--pos-surface-alt)', border: '1px solid var(--pos-border)', color: 'var(--pos-text)', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}
                  title="Klavye Aç"
                >⌨</button>
              </div>

          {/* PLU grid — sütun/satır sayısı kasiyer ayarından */}
          {searchQ ? (
            // Arama modu — liste
            <div style={{ flex: 1, overflowY: 'auto', padding: '5px 8px' }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#BDBDBD', padding: '24px 0', fontSize: 12 }}>Ürün bulunamadı</div>
              ) : filtered.map(p => (
                <div key={`search-${p.id}-${p.code}`} role="button" tabIndex={0} onClick={() => handlePluClick(p)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', marginBottom: 3, borderRadius: 7, background: 'var(--pos-surface)', border: '1px solid var(--pos-border)', cursor: 'pointer' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = activeColor; el.style.background = 'var(--pos-row-hover)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--pos-border)'; el.style.background = 'var(--pos-surface)' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: fontSizeName, fontWeight: 500, color: 'var(--pos-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{truncatePluName(p.name)}</div>
                    {(settings.cashier.showCode || settings.cashier.showBarcode) && (
                      <div style={{ fontSize: fontSizeCode, color: 'var(--pos-text-muted)', fontFamily: 'monospace', marginTop: 1 }}>
                        {settings.cashier.showCode && p.code}
                        {settings.cashier.showCode && settings.cashier.showBarcode && p.barcode && ' · '}
                        {settings.cashier.showBarcode && p.barcode}
                      </div>
                    )}
                  </div>
                  {settings.cashier.showPrice && (
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
                  <div key={`e${i}`} className="plu-key--empty" style={{
                    borderRadius: 8,
                    background: 'var(--pos-plu-empty-bg)',
                    border: '1px dashed var(--pos-border)',
                  }} />
                )
                return (
                  <PluButton
                    key={`${p.id}-${p.code}-${i}`}
                    name={p.name}
                    price={p.price}
                    code={p.code ?? ''}
                    barcode={p.barcode ?? ''}
                    showPrice={settings.cashier.showPrice ?? true}
                    showCode={settings.cashier.showCode ?? true}
                    showBarcode={settings.cashier.showBarcode ?? false}
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
            <div style={{
              padding: '6px 10px',
              borderTop: '1px solid var(--pos-border)',
              background: 'var(--pos-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              minHeight: 48,
              flexShrink: 0,
            }}>
              <button
                type="button"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={safePage === 0}
                style={{
                  background: safePage === 0 ? 'var(--pos-disabled-bg)' : 'var(--pos-primary)',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 16px',
                  cursor: safePage === 0 ? 'default' : 'pointer',
                  fontSize: 13,
                  fontWeight: 700,
                  color: safePage === 0 ? 'var(--pos-disabled-fg)' : 'var(--pos-primary-text)',
                  opacity: safePage === 0 ? 0.55 : 1,
                  minWidth: 110,
                  boxShadow: safePage === 0 ? 'none' : '0 2px 6px rgba(21,101,192,0.28)',
                }}
              >
                ← Önceki
              </button>
              <span style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--pos-text)',
                letterSpacing: '0.2px',
                textAlign: 'center',
                flex: 1,
              }}>
                {safePage + 1} / {totalPages}
                <span style={{ fontWeight: 500, color: 'var(--pos-text-muted)', marginLeft: 6 }}>
                  · {filtered.length} ürün
                </span>
              </span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                style={{
                  background: safePage >= totalPages - 1 ? 'var(--pos-disabled-bg)' : 'var(--pos-primary)',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 16px',
                  cursor: safePage >= totalPages - 1 ? 'default' : 'pointer',
                  fontSize: 13,
                  fontWeight: 700,
                  color: safePage >= totalPages - 1 ? 'var(--pos-disabled-fg)' : 'var(--pos-primary-text)',
                  opacity: safePage >= totalPages - 1 ? 0.55 : 1,
                  minWidth: 110,
                  boxShadow: safePage >= totalPages - 1 ? 'none' : '0 2px 6px rgba(21,101,192,0.28)',
                }}
              >
                Sonraki →
              </button>
            </div>
          )}

            </div>

            {/* ④ GRUPLAR — sağda, arama altından başlar */}
            <div
              className="plu-groups-bar"
              style={{
              width:         'clamp(84px, 13%, 128px)',
              flexShrink:    0,
              minWidth:      84,
              boxSizing:     'border-box',
              background:    'var(--pos-surface)',
              display:       'flex',
              flexDirection: 'column',
              overflowX:     'hidden',
              overflowY:     'auto',
              padding:       '5px 0',
              gap:           4,
            }}>
              {pluGroups.map(g => {
                const isActive = activeGroup === g.id
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setActiveGroup(g.id); setPage(0); setSearchQ('') }}
                    style={{
                      height:        84,
                      border:        'none',
                      background:    isActive ? g.color : hexToTint(g.color),
                      cursor:        'pointer',
                      position:      'relative',
                      display:       'flex',
                      flexDirection: 'column',
                      alignItems:    'center',
                      justifyContent:'center',
                      gap:           4,
                      color:         isActive ? 'white' : '#1f2937',
                      fontSize:      10,
                      fontWeight:    600,
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.2px',
                      flexShrink:    0,
                      width:         '100%',
                      paddingRight:  6,
                      borderRadius:  '8px 0 0 8px',
                    }}
                  >
                    <div style={{
                      position: 'absolute', right: 0, top: 0, bottom: 0,
                      width: isActive ? 8 : 5, background: g.color, transition: 'width 0.15s',
                    }} />
                    {isActive && (
                      <div style={{
                        position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)',
                        borderTop: '7px solid transparent', borderBottom: '7px solid transparent',
                        borderLeft: `7px solid ${g.color}`, zIndex: 3,
                      }} />
                    )}
                    <div style={{
                      width: isActive ? 12 : 10, height: isActive ? 12 : 10,
                      borderRadius: '50%', background: isActive ? 'white' : g.color,
                      opacity: 1, transition: 'all 0.15s',
                    }} />
                    <span>{g.name}</span>
                  </button>
                )
              })}
              {pluGroups.length === 0 && (
                <div style={{ padding: 8, fontSize: 10, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
                  PLU grubu yok
                </div>
              )}
            </div>

          </div>

          {/* Ödeme — wrapper altında, tam genişlik */}
          <div style={{ padding: '5px 8px 8px', borderTop: '1px solid var(--pos-border)', flexShrink: 0 }}>
            {!paymentMode && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button
                  onClick={() => {
                    if (!posReady) { logPosBlocked(); return }
                    const amt = parseFloat(numBuf.replace(',', '.')) || dueTotal
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
                  disabled={posReady && cart.length === 0}
                  style={{
                    ...solidBtn(returnMode ? C.danger : cashBtn.bg, !posReady || cart.length === 0),
                    color: (!posReady || cart.length === 0) ? 'var(--pos-disabled-fg)' : returnMode ? '#FFFFFF' : cashBtn.text,
                    padding: '13px 4px',
                    borderRadius: 7,
                    fontSize: 13,
                  }}
                >
                  {posReady ? (returnMode ? '💵 Nakit İade' : '💵 Nakit') : '🔒 Nakit'}
                </button>
                <button
                  onClick={() => {
                    if (!posReady) { logPosBlocked(); return }
                    const line: PaymentLine = {
                      id: crypto.randomUUID(),
                      method: 'card',
                      amount: dueTotal,
                      label: returnMode ? 'Kart İade' : 'Kart',
                      mediator: 2,
                    }
                    setPaymentLines([line])
                    void (returnMode ? completeReturn([line]) : completeSale([line]))
                  }}
                  disabled={posReady && (cart.length === 0 || (!returnMode && !pavoSettings))}
                  title={!returnMode && !pavoSettings ? 'Pavo cihazı ayarlı değil' : undefined}
                  style={{
                    ...solidBtn(returnMode ? C.danger : cardBtn.bg, !posReady || cart.length === 0 || (!returnMode && !pavoSettings)),
                    color: (!posReady || cart.length === 0 || (!returnMode && !pavoSettings)) ? 'var(--pos-disabled-fg)' : returnMode ? '#FFFFFF' : cardBtn.text,
                    padding: '13px 4px',
                    borderRadius: 7,
                    fontSize: 13,
                  }}
                >
                  {posReady ? (returnMode ? '💳 Kart İade' : '💳 Kart') : '🔒 Kart'}
                </button>
                {!returnMode && (
                <button
                  onClick={() => {
                    if (!posReady) { logPosBlocked(); return }
                    setPaymentLines([])
                    setActiveMethod(null)
                    setPendingAmount('')
                    setPaymentMode(true)
                  }}
                  disabled={posReady && cart.length === 0}
                  style={{
                    ...solidBtn(splitBtn.bg, !posReady || cart.length === 0),
                    color: (!posReady || cart.length === 0) ? 'var(--pos-disabled-fg)' : splitBtn.text,
                    gridColumn: otherVisibleBrands.length > 0 ? undefined : 'span 2',
                    padding: '11px 4px',
                    borderRadius: 7,
                    fontSize: 13,
                  }}
                >
                  {posReady ? '🔀 Parçalı Ödeme' : '🔒 Parçalı'}
                </button>
                )}
                {!returnMode && (otherVisibleBrands.length > 0 || !posReady) && (
                  <button
                    onClick={() => {
                      if (!posReady) { logPosBlocked(); return }
                      if (cart.length === 0) return
                      setShowOtherPayments(true)
                      setSelectedBrand(null)
                    }}
                    disabled={posReady && cart.length === 0}
                    style={{
                      ...solidBtn(otherPayBtn.bg, !posReady || cart.length === 0),
                      color: (!posReady || cart.length === 0) ? 'var(--pos-disabled-fg)' : otherPayBtn.text,
                      padding: '11px 4px',
                      borderRadius: 7,
                      fontSize: 13,
                    }}
                  >
                    {posReady ? '🔖 Diğer' : '🔒 Diğer'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {paymentMode && !returnMode && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(23,26,32,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '2vh 2vw',
        }}>
          <div className="pos-modal" style={{
            width: '96%', maxWidth: 1200,
            height: 'auto',
            maxHeight: '80vh',
            background: 'var(--pos-surface)', border: '1px solid var(--pos-border)',
            borderRadius: 16, boxShadow: '0 20px 50px rgba(24,28,38,0.22)',
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '1.6vh 2.2vw', borderBottom: '1px solid var(--pos-border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3457D5' }} />
                <div>
                  <div style={{ fontSize: 'clamp(14px, 1.8vh, 17px)', fontWeight: 600, color: 'var(--pos-text)' }}>
                    Parçalı Ödeme
                  </div>
                  <div style={{ fontSize: 'clamp(11px, 1.3vh, 12px)', color: 'var(--pos-text-muted)', marginTop: 2 }}>
                    {cart.length} kalem · {fmt(grandTotal)}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => {
                setPaymentMode(false); setPaymentLines([]); setActiveMethod(null);
                setPendingAmount(''); setSelectedBrand(null);
              }}
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--pos-surface-alt)', border: '1px solid var(--pos-border)', borderRadius: 8,
                  color: 'var(--pos-text-muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
            </div>

            {/* Body: 3 kolon — sol özet | orta yöntemler | sağ numpad */}
            <div style={{
              display:             'grid',
              gridTemplateColumns: 'minmax(340px, 38%) 1fr clamp(200px, 24%, 280px)',
              flex:                1,
              minHeight:           'min(420px, calc(80vh - 12vh))',
              maxHeight:           'calc(80vh - 12vh)',
              overflow:            'hidden',
            }}>

              {/* ── 1. KOLON: Özet + Eklenen ödemeler ── */}
              <div style={{
                background:    'var(--pos-pane)',
                borderRight:   '1px solid var(--pos-border)',
                display:       'flex',
                flexDirection: 'column',
                overflow:      'hidden',
                minHeight:     0,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pos-text-muted)',
                  letterSpacing: '0.04em', textTransform: 'uppercase' as const,
                  padding: '12px 14px 8px', flexShrink: 0 }}>
                  Eklenen ödemeler
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--pos-surface)' }}>
                  {(() => {
                    const pavoRows = pavoPendingSaleRef
                      ? (getRecoveryInfo().displayPayments ?? [])
                      : []
                    const showLump = pavoRows.length === 0 && (pavoPendingSaleRef?.paidAmount ?? 0) > 0
                    const empty = pavoRows.length === 0 && !showLump && paymentLines.length === 0
                    if (empty) {
                      return (
                        <div style={{ color: 'var(--pos-text-muted)', fontSize: 16, textAlign: 'center', padding: '18px 14px' }}>
                          Henüz ödeme eklenmedi.
                        </div>
                      )
                    }
                    const statusMark = {
                      done: { glyph: '✓', color: 'var(--pos-success)' },
                      waiting: { glyph: '⏳', color: 'var(--pos-warning)' },
                      failed: { glyph: '✕', color: 'var(--pos-danger)' },
                    }
                    const rowStyle = {
                      display: 'flex', alignItems: 'center', gap: 10,
                      height: 56, padding: '0 14px', boxSizing: 'border-box' as const,
                      borderBottom: '1px solid var(--pos-border)',
                      background: 'var(--pos-surface)', color: 'var(--pos-text)',
                    }
                    return (
                      <>
                        {showLump && pavoPendingSaleRef && (
                          <div style={rowStyle}>
                            <span style={{ fontSize: 20, width: 28, textAlign: 'center' as const }}>💳</span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              Pavo'da alınan
                            </span>
                            <span style={{ fontSize: 22, fontWeight: 700 }}>{fmt(pavoPendingSaleRef.paidAmount)}</span>
                            <span style={{ fontSize: 22, fontWeight: 700, color: statusMark.done.color, width: 28, textAlign: 'center' as const }}>✓</span>
                          </div>
                        )}
                        {pavoRows.map((row, idx) => {
                          const mark = statusMark[row.status]
                          const dim = row.status !== 'done'
                          const tail = cardTailLabel(row.cardNo)
                          return (
                            <div key={`pavo-${idx}`} style={rowStyle}>
                              <span style={{ fontSize: 20, width: 28, textAlign: 'center' as const, flexShrink: 0 }}>
                                {payMethodIcon(String(row.mediator), row.name)}
                              </span>
                              <span style={{ flex: 1, minWidth: 0, fontSize: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {row.name}{tail ? `  ${tail}` : ''}
                              </span>
                              <span style={{ fontSize: 22, fontWeight: 700, opacity: dim ? 0.45 : 1 }}>{fmt(row.amount)}</span>
                              <span style={{ fontSize: 22, fontWeight: 700, color: mark.color, width: 28, textAlign: 'center' as const, flexShrink: 0 }}>{mark.glyph}</span>
                            </div>
                          )
                        })}
                        {paymentLines.map(line => (
                          <div key={line.id} style={rowStyle}>
                            <span style={{ fontSize: 20, width: 28, textAlign: 'center' as const, flexShrink: 0 }}>
                              {payMethodIcon(line.method, line.label)}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {line.label}
                            </span>
                            <span style={{ fontSize: 22, fontWeight: 700 }}>{fmt(line.amount)}</span>
                            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--pos-success)', width: 28, textAlign: 'center' as const, flexShrink: 0 }}>✓</span>
                            <button type="button" onClick={() => setPaymentLines(prev => prev.filter(l => l.id !== line.id))}
                              style={{ border: 'none', background: 'transparent', color: 'var(--pos-text-muted)', cursor: 'pointer', fontSize: 13, padding: 0 }}>
                              Sil
                            </button>
                          </div>
                        ))}
                      </>
                    )
                  })()}
                </div>
                <div style={{ flexShrink: 0, borderTop: '1px solid var(--pos-border)', background: 'var(--pos-surface)', padding: '8px 14px 12px' }}>
                  {(() => {
                    const pavoRows = pavoPendingSaleRef
                      ? (getRecoveryInfo().displayPayments ?? [])
                      : []
                    const takenFromDevice = pavoRows.length > 0
                      ? pavoRows.filter(row => row.status === 'done').reduce((s, row) => s + row.amount, 0)
                      : (pavoPendingSaleRef?.paidAmount ?? 0)
                    const takenShown = takenFromDevice + paidTotal
                    const totalShown = pavoPendingSaleRef?.totalPrice || grandTotal
                    const summaryRow = (label: string, value: string, extra?: CSSProperties) => (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 20, color: 'var(--pos-text)', ...extra }}>
                        <span>{label}</span>
                        <span>{value}</span>
                      </div>
                    )
                    return (
                      <>
                        {summaryRow('Toplam', fmt(totalShown))}
                        {summaryRow('Alınan', fmt(takenShown))}
                        {remaining <= 0
                          ? <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--pos-success)', marginTop: 4 }}>Tamamı alındı ✓</div>
                          : summaryRow('KALAN', fmt(remaining), { fontSize: 28, fontWeight: 700, color: 'var(--pos-primary)', marginTop: 4 })}
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* ── 2. KOLON: Seçili yöntem + hızlı butonlar + Yöntemler ── */}
              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
                borderRight: '1px solid var(--pos-border)' }}>

                <div style={{ padding: '1.2vh 3%', borderBottom: '1px solid var(--pos-border)', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 'clamp(11px, 1.4vh, 13px)', fontWeight: 600,
                    color: activeMethod ? 'var(--pos-text)' : 'var(--pos-text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {activeMethod === 'cash' ? '💵 Nakit'
                      : activeMethod === 'card' ? '💳 Kart'
                      : activeMethod === 'other' && selectedBrand
                        ? (selectedBrand.payment_provider_brand_id === 999
                          ? 'KK Taksit/Puan'
                          : selectedBrand.payment_provider_brand_nm)
                        : 'Ödeme yöntemi seçin'}
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    <button type="button"
                      onClick={() => setPendingAmount(remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 }))}
                      disabled={remaining <= 0}
                      style={{ ...solidBtn(C.neutral, remaining <= 0),
                        padding: '0.5vh 0.8vw', borderRadius: 6,
                        fontSize: 'clamp(10px, 1.2vh, 11px)' }}>
                      Kalanı
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, padding: '1.5vh 3%', overflowY: 'auto' }}>
                  <div style={{ fontSize: 'clamp(10px, 1.2vh, 11px)', fontWeight: 600,
                    textTransform: 'uppercase' as const, color: 'var(--pos-text-muted)', letterSpacing: '0.04em', marginBottom: '1.2vh' }}>
                    Ödeme Yöntemi
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: '1.2vh' }}>
                    <button type="button"
                      onClick={() => addPaymentLineWithMethod('cash', null, pendingAmount ? undefined : remaining)}
                      style={{
                        ...solidBtn(cashBtn.bg, remaining <= 0, paymentLines[paymentLines.length - 1]?.method === 'cash'),
                        color: remaining <= 0 ? C.disabledFg : cashBtn.text,
                        aspectRatio: '1 / 0.8', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: '0.4vh',
                        padding: '8%',
                      }}>
                      <span style={{ fontSize: 18, lineHeight: 1 }}>💵</span>
                      <span style={{ fontSize: 'clamp(10px, 1.25vh, 11px)', textAlign: 'center' as const, lineHeight: 1.2 }}>Nakit</span>
                    </button>

                    <button type="button"
                      onClick={() => addPaymentLineWithMethod('card', null, pendingAmount ? undefined : remaining)}
                      style={{
                        ...solidBtn(cardBtn.bg, remaining <= 0, paymentLines[paymentLines.length - 1]?.method === 'card' && paymentLines[paymentLines.length - 1]?.brand == null),
                        color: remaining <= 0 ? C.disabledFg : cardBtn.text,
                        aspectRatio: '1 / 0.8', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: '0.4vh',
                        padding: '8%',
                      }}>
                      <span style={{ fontSize: 18, lineHeight: 1 }}>💳</span>
                      <span style={{ fontSize: 'clamp(10px, 1.25vh, 11px)', textAlign: 'center' as const, lineHeight: 1.2 }}>Kredi Kartı</span>
                    </button>

                    {karmaVisibleBrands.map(brand => {
                      const isTaksit = brand.payment_provider_brand_id === 999
                      const color = payBrandColor(brand.payment_provider_brand_id, brand.payment_provider_brand_nm)
                      const label = isTaksit ? 'KK Taksit/Puan' : brand.payment_provider_brand_nm
                      const selected = paymentLines[paymentLines.length - 1]?.brand === brand.payment_provider_brand_id
                      return (
                        <button key={brand.payment_provider_brand_id} type="button"
                          onClick={() => addPaymentLineWithMethod('other', brand, pendingAmount ? undefined : remaining)}
                          style={{
                            ...solidBtn(color, remaining <= 0, selected),
                            aspectRatio: '1 / 0.8', display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: '0.4vh',
                            padding: '8%',
                          }}>
                          <span style={{ fontSize: 18, lineHeight: 1 }}>{payMethodIcon('other', label)}</span>
                          <span style={{ fontSize: 'clamp(10px, 1.25vh, 11px)', textAlign: 'center' as const, lineHeight: 1.2,
                            overflow: 'hidden', display: '-webkit-box',
                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, width: '100%' }}>
                            {label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* ── 3. KOLON: Numpad — satıştaki birebir ── */}
              <div className="pos-pay-numpad" style={{
                background:    'var(--pos-surface)',
                display:       'flex',
                flexDirection: 'column',
                padding:       '6px 6px 0',
                gap:           0,
                borderLeft:    '2px solid #9CA3AF',
                boxShadow:     'inset 0 0 0 1px rgba(0,0,0,0.04)',
                overflow:      'hidden',
              }}>
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
                  gap: 5, padding: '4px', boxSizing: 'border-box' as const, overflow: 'hidden' }}>

                  <div style={{
                    flexShrink: 0, height: 40, borderRadius: 9,
                    border: `1.5px solid ${pendingAmount ? 'var(--pos-success)' : 'var(--pos-border)'}`,
                    background: 'var(--pos-surface-alt)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 8px', overflow: 'hidden', userSelect: 'none' as const,
                  }}>
                    <span style={{
                      fontSize: pendingAmount.length <= 7 ? 'clamp(15px, 1.5vw + 4px, 24px)'
                        : pendingAmount.length <= 14 ? 'clamp(12px, 1.1vw + 2px, 18px)'
                        : 'clamp(10px, 0.95vw + 1px, 16px)',
                      fontWeight: 700,
                      color: pendingAmount ? 'var(--pos-text)' : 'var(--pos-text-muted)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      maxWidth: '100%', lineHeight: 1, textAlign: 'center' as const,
                    }}>
                      {pendingAmount || '—'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 5, flexShrink: 0, height: 44 }}>
                    <button type="button"
                      onClick={() => setPendingAmount('')}
                      style={{
                        background: 'var(--pos-danger)', color: '#FFFFFF', border: 'none', cursor: 'pointer',
                        flex: 1, borderRadius: 9, fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        userSelect: 'none' as const,
                      }}>TEMİZLE</button>

                    <button type="button"
                      onClick={() => setPendingAmount(v => v.slice(0, -1))}
                      style={{
                        background: 'var(--pos-warning)', color: '#FFFFFF', border: 'none', cursor: 'pointer',
                        flex: 1, borderRadius: 9, fontSize: 20,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        userSelect: 'none' as const,
                      }}>⌫</button>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gridTemplateRows: 'repeat(4, minmax(0, 1fr))',
                    gap: 5, flex: 1, minHeight: 0,
                  }}>
                    {['7','8','9','4','5','6','1','2','3',',','0'].map(k => (
                      <button key={k} type="button" className="pos-key"
                        onClick={() => {
                          setPendingAmount(v => {
                            if (k === ',') return v.includes(',') ? v : (v === '' ? '0,' : v + ',')
                            if (v.replace(/[,.]/g,'').length >= 9) return v
                            return v + k
                          })
                        }}
                        style={{
                          width: '100%', height: '100%', boxSizing: 'border-box' as const,
                          border: '1.5px solid var(--pos-key-border)', borderRadius: 9,
                          cursor: 'pointer', fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          userSelect: 'none' as const,
                          background: 'var(--pos-key-bg)', color: 'var(--pos-key-text)',
                          fontSize: 'clamp(14px, 1.4vw + 4px, 26px)',
                        }}>{k}</button>
                    ))}

                    <button type="button"
                      className="pos-key-action"
                      disabled={remaining <= 0}
                      onClick={() => setPendingAmount((remaining / 2).toLocaleString('tr-TR', { minimumFractionDigits: 2 }))}
                      style={{
                        ...(remaining <= 0
                          ? solidBtn(C.primary, true)
                          : { background: 'var(--pos-key-action-bg)', color: 'var(--pos-key-action-text)', border: 'none', cursor: 'pointer' }),
                        width: '100%', height: '100%', boxSizing: 'border-box' as const,
                        borderRadius: 9,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        userSelect: 'none' as const,
                        fontSize: 'clamp(10px, 0.9vw + 3px, 14px)',
                      }}>Yarısı</button>
                  </div>
                </div>
              </div>

            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, padding: '1.4vh 2.2vw', borderTop: '1px solid var(--pos-border)', flexShrink: 0 }}>
              <span style={{ fontSize: 'clamp(11px, 1.3vh, 12px)', color: 'var(--pos-text-muted)' }}>
                {cartLocked && ((pavoPendingSaleRef?.paidAmount ?? 0) > 0.009 || (pavoRecoveryState?.paidAmount ?? 0) > 0.009)
                  ? 'Alınmış ödeme var, iptal edilemez'
                  : remaining <= 0
                  ? 'Tutarın tamamı karşılandı, işlemi tamamlayabilirsiniz.'
                  : 'Toplam tutarın tamamı karşılanmadan işlem tamamlanamaz.'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button"
                  disabled={cartLocked && ((pavoPendingSaleRef?.paidAmount ?? 0) > 0.009 || (pavoRecoveryState?.paidAmount ?? 0) > 0.009)}
                  onClick={() => {
                    if (cartLocked) { void cancelLockedSale(); return }
                    setPaymentMode(false); setPaymentLines([]); setActiveMethod(null);
                    setPendingAmount(''); setSelectedBrand(null);
                  }}
                  style={{ padding: '1vh 1.5vw', borderRadius: 8, fontSize: 'clamp(12px, 1.5vh, 13px)',
                    fontWeight: 600, cursor: 'pointer', border: '1px solid var(--pos-border)', background: 'var(--pos-surface)', color: 'var(--pos-text-muted)' }}>
                  {cartLocked ? 'Satışı iptal et' : 'İptal'}
                </button>
                <button type="button" disabled={!canComplete || saving} onClick={() => void completeSale()}
                  style={{
                    padding: '1vh 1.5vw', borderRadius: 8, fontSize: 'clamp(12px, 1.5vh, 13px)',
                    fontWeight: 600, border: 'none', cursor: canComplete && !saving ? 'pointer' : 'default',
                    background: canComplete && !saving ? '#232733' : 'var(--pos-disabled-bg)',
                    color:      canComplete && !saving ? 'white' : 'var(--pos-disabled-fg)',
                  }}>
                  {saving ? 'İşleniyor...' : 'Ödemeyi Tamamla'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showOtherPayments && !paymentMode && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(23,26,32,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '2vh 2vw',
        }}>
          <div className="pos-modal" style={{
            background: 'var(--pos-surface)', borderRadius: 16, padding: '2.2vh 2vw',
            width: 'min(960px, 92vw)', maxHeight: '86vh',
            display: 'flex', flexDirection: 'column', gap: '1.6vh',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pos-text)' }}>Ödeme Yöntemi Seç</div>
                <div style={{ fontSize: 12, color: 'var(--pos-text-muted)', marginTop: 2 }}>
                  Tutar: {fmt(grandTotal)}
                </div>
              </div>
              <button onClick={() => { setShowOtherPayments(false); setSelectedBrand(null) }}
                style={{
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--pos-surface-alt)', border: '1px solid var(--pos-border)', borderRadius: 8,
                  color: 'var(--pos-text-muted)', cursor: 'pointer', fontSize: 13,
                }}>✕</button>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 12,
              overflowY: 'auto',
              minHeight: 0,
              padding: 2,
            }}>
              {otherVisibleBrands.map(brand => {
                const isTaksit = brand.payment_provider_brand_id === 999
                const color = payBrandColor(brand.payment_provider_brand_id, brand.payment_provider_brand_nm)
                const label = isTaksit ? 'KK Taksit/Puan' : brand.payment_provider_brand_nm
                return (
                <button
                  key={brand.payment_provider_brand_id}
                  onClick={() => {
                    setShowOtherPayments(false)
                    const line: PaymentLine = isTaksit
                      ? {
                          id:       crypto.randomUUID(),
                          method:   'card',
                          amount:   dueTotal,
                          label:    'KK Taksit/Puan',
                          mediator: 2,
                          brand:    999,
                        }
                      : {
                          id:       crypto.randomUUID(),
                          method:   'other',
                          amount:   dueTotal,
                          label:    brand.payment_provider_brand_nm,
                          mediator: brand.payment_mediator,
                          brand:    brand.payment_provider_brand_id,
                        }
                    void completeSale([line])
                  }}
                  style={{
                    ...solidBtn(color),
                    aspectRatio: '1',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    padding: 12,
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{payMethodIcon('other', label)}</span>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#FFFFFF',
                    textAlign: 'center' as const,
                    lineHeight: 1.25,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                    width: '100%',
                  }}>
                    {label}
                  </span>
                </button>
                )
              })}
            </div>

            <div style={{ fontSize: 11, color: 'var(--pos-text-muted)', textAlign: 'center' as const, flexShrink: 0 }}>
              Seçilen yöntemle {fmt(grandTotal)} tahsil edilecektir.
            </div>
          </div>
        </div>
      )}

      {balanceWait && (
        <div style={{
          position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10060,
          background: 'var(--pos-surface)', color: 'var(--pos-text)',
          border: '1px solid var(--pos-border)', borderRadius: 10,
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          boxShadow: '0 8px 24px rgba(0,0,0,.18)',
        }}>
          Bakiye alınıyor…
        </div>
      )}

      {printSelectModal && !printSelectModal.multi && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10001,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--pos-surface)', borderRadius: 16, padding: 24,
            width: 'min(360px, 94vw)', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--pos-text)' }}>
              🖨️ Fiş seçin
            </div>
            <div style={{ fontSize: 12, color: 'var(--pos-text-muted)' }}>
              Hangi fişi basmak istiyorsunuz?
            </div>

            {printSelectModal.templates.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { queueTemplatePrint(t.id) }}
                style={{
                  padding: '12px 16px', borderRadius: 10,
                  ...(t.is_default ? solidBtn(C.primary, false, true) : solidBtn(C.neutral)),
                  cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                }}
              >
                <span style={{ fontSize: 18 }}>
                  {t.template_type === 'thermal' ? '🖨️' : '📄'}
                </span>
                <div>
                  <div style={{
                    fontSize: 13, fontWeight: 600,
                    color: '#FFFFFF',
                  }}>
                    {t.name}
                  </div>
                  {t.is_default && (
                    <div style={{ fontSize: 11, color: '#FFFFFF' }}>Varsayılan</div>
                  )}
                </div>
              </button>
            ))}

            <button
              type="button"
              onClick={() => closePrintSelect()}
              style={{
                padding: '10px', borderRadius: 10, marginTop: 4,
                border: '1px solid var(--pos-border)', background: 'var(--pos-surface-alt)',
                cursor: 'pointer', fontSize: 13, color: 'var(--pos-text-muted)',
              }}
            >
              Fiş Basma
            </button>
          </div>
        </div>
      )}

      {printSelectModal?.multi && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10001,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            background: 'var(--pos-surface)', color: 'var(--pos-text)',
            border: '1px solid var(--pos-border)', borderRadius: 16, padding: 24,
            width: 'min(560px, 94vw)', display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {balanceWait ? 'Bakiye alınıyor…' : 'Fiş Yazdır'}{(() => {
                const sales = printSelectModal.data.sales
                const orderNo = sales ? String(sales.order_no ?? sales.orderNo ?? '').trim() : ''
                return orderNo ? ` — Sipariş no: ${orderNo}` : ''
              })()}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 10,
            }}>
              {printSelectModal.templates.map(t => {
                const card = printCards[t.id]
                const busy = card?.busy === true
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={busy}
                    onClick={() => { queueTemplatePrint(t.id) }}
                    style={{
                      padding: '14px 16px', borderRadius: 12, textAlign: 'left',
                      border: '1px solid var(--pos-border)',
                      background: 'var(--pos-surface)',
                      color: 'var(--pos-text)',
                      cursor: busy ? 'default' : 'pointer',
                      opacity: busy ? 0.72 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 22 }}>
                        {t.template_type === 'thermal' ? '🧾' : '📄'}
                      </span>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div>
                    </div>
                    {busy && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--pos-text-muted)' }}>
                        Yazdırılıyor…
                      </div>
                    )}
                    {!busy && card?.error && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--pos-danger)', lineHeight: 1.35 }}>
                        ✕ Yazdırılamadı
                        <div>{card.error}</div>
                      </div>
                    )}
                    {!busy && !card?.error && (card?.count ?? 0) > 0 && (
                      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--pos-success)' }}>
                        ✓ Yazdırıldı ({card?.count})
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => closePrintSelect()}
                style={{
                  minWidth: 180, minHeight: 44, padding: '10px 18px', borderRadius: 10,
                  border: 'none', background: 'var(--pos-primary)', color: 'var(--pos-primary-text)',
                  fontWeight: 800, fontSize: 15, cursor: 'pointer',
                }}
              >
                Bitti
              </button>
            </div>
          </div>
        </div>
      )}

      {pavoLoading && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--pos-surface)',
            borderRadius: 16,
            padding: '32px 48px',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pos-text)', marginBottom: 8 }}>
              Kartı Okutun
            </div>
            <div style={{ fontSize: 13, color: 'var(--pos-text-muted)' }}>
              Pavo cihazında işlem bekleniyor...
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--pos-primary)', marginTop: 12 }}>
              {grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
            </div>
            <button
              type="button"
              onClick={() => void handleDurumSorgula()}
              style={{
                ...solidBtn(C.primary),
                marginTop: 18,
                padding: '10px 16px',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              Durumu Sorgula
            </button>
          </div>
        </div>
      )}

      {pavoRecoveryState && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--pos-surface)', borderRadius: 16, padding: 24,
            width: 'min(420px, 94vw)', display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#D97706' }}>
              ⚠️ Tamamlanmamış Ödeme
            </div>

            <div style={{
              background: 'var(--pos-bg)', borderRadius: 9, padding: '12px 14px',
              border: `1px solid ${C.warning}`, fontSize: 13, color: 'var(--pos-text)',
            }}>
              <div>Sipariş No: <strong>{pavoRecoveryState.orderNo}</strong></div>
              <div style={{ marginTop: 6 }}>
                Toplam: <strong>{fmt(pavoRecoveryState.totalPrice)}</strong>
                {' · '}Ödenen: <strong>{fmt(pavoRecoveryState.paidAmount)}</strong>
                {' · '}Kalan: <strong style={{ color: '#DC2626' }}>
                  {fmt(pavoRecoveryState.remainingAmount)}
                </strong>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--pos-text-muted)' }}>
              {pavoRecoveryState.paidAmount > 0.009
                ? `${fmt(pavoRecoveryState.paidAmount)} alındı, ${fmt(pavoRecoveryState.remainingAmount)} kaldı.`
                : 'Bu satış için tamamlanmış ödeme yok. Ödemeyi yeniden gönderebilir ya da satışı iptal edebilirsiniz.'}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {pavoRecoveryState.paidAmount <= 0.009 && (
                <>
                  <button
                    type="button"
                    onClick={() => { void resendLockedPayment() }}
                    style={{
                      flex: 1, padding: '10px', borderRadius: 9, border: 'none',
                      background: 'var(--pos-primary)', color: 'var(--pos-primary-text)',
                      fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    }}>
                    Ödemeyi tekrar gönder
                  </button>
                  <button
                    type="button"
                    onClick={() => { void cancelLockedSale() }}
                    style={{
                      flex: 1, padding: '10px', borderRadius: 9,
                      border: '1px solid var(--pos-border)', background: 'var(--pos-surface-alt)',
                      color: 'var(--pos-text)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    }}>
                    Satışı iptal et
                  </button>
                </>
              )}
              {pavoRecoveryState.paidAmount > 0.009 && (
              <button
                type="button"
                onClick={() => {
                  const rec = pavoRecoveryState
                  if (!rec) return
                  setPavoRecoveryState(null)
                  setPaymentMode(true)
                  setPaymentLines([])
                  setActiveMethod(null)
                  setSelectedBrand(null)
                  setPendingAmount(
                    rec.remainingAmount
                      .toLocaleString('tr-TR', { minimumFractionDigits: 2 })
                  )
                  setPavoPendingSaleRef({
                    saleId:     rec.ref.saleNumber ? null : (rec.ref.saleId ?? null),
                    saleNumber: rec.ref.saleNumber ?? null,
                    orderNo:    rec.orderNo,
                    totalPrice: rec.totalPrice,
                    paidAmount: rec.paidAmount,
                  })
                  setPavoPhase('open', { orderNo: rec.orderNo, amount: rec.totalPrice })
                }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 9,
                  border: 'none', background: 'var(--pos-text)',
                  color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}>
                Kalan ödemeyi al
              </button>
              )}
            </div>
          </div>
        </div>
      )}

      {barcodeToast && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10003,
          background: C.danger,
          color: '#FFFFFF',
          borderRadius: 12,
          padding: '14px 22px',
          fontSize: 20,
          fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,.25)',
          maxWidth: '92vw',
        }}>
          {barcodeToast}
        </div>
      )}

      {pavoError && !pavoLoading && (
        <div style={{
          position: 'fixed',
          bottom: merkezToast ? 72 : 24,
          right: 24,
          zIndex: 10002,
          background: C.danger,
          color: '#FFFFFF',
          border: 'none',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>
          Pavo: {pavoError}
        </div>
      )}

      {envelopeToast && (
        <div style={{
          position: 'fixed',
          bottom: merkezToast || heldToast ? 72 : 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1E3A8A',
          color: 'white',
          padding: '10px 20px',
          borderRadius: 8,
          fontSize: 13,
          zIndex: 10002,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>
          {envelopeToast}
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
              background: t.status === 'success' ? C.success : C.danger,
              border: 'none',
              borderRadius: 10, padding: '10px 14px',
              fontSize: 13, fontWeight: 700,
              color: '#FFFFFF',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            <div>{t.status === 'success' ? '✓' : '✗'} {t.label ?? t.type}</div>
            {t.error && <div style={{ fontSize: 11, color: '#FFFFFF', marginTop: 2 }}>{t.error}</div>}
          </div>
        ))}
      </div>

      <ScreenKeyboardHost />
    </div>
  )
}

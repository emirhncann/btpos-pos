// Pavo REST API ile iletisim
import { parsePavoResult, type PaymentDeviceResult } from './paymentDevice'

export interface PavoSettings {
  ipAddress: string
  port: number
  serialNo: string
  cardReadTimeout: number
  printWidth: '58mm' | '80mm'
}

/** Pavo CompleteSale: SMS + e-posta bildirimi */
export interface PavoSaleNotifyOptions {
  sendSms?: boolean
  smsPhone?: string | null
  sendEmail?: boolean
  mailAddr?: string | null
}

function normalizeTrMobilePavo(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('90')) d = d.slice(2)
  while (d.startsWith('0')) d = d.slice(1)
  d = d.slice(0, 10)
  if (d.length > 0 && d[0] !== '5') return ''
  return d
}

function isValidNotificationEmail(s: string): boolean {
  const t = s.trim()
  if (t.length < 5 || !t.includes('@')) return false
  const [a, b] = t.split('@')
  return Boolean(a && b && b.includes('.'))
}

export function notificationPhoneDigitCount(s: string): number {
  return s.replace(/\D/g, '').length
}

export interface PavoSaleItem {
  name: string
  unitName?: string
  vatRate: number
  quantity: number
  unitPrice: number
  grossPrice: number
  totalPrice: number
  priceEffect?: {
    Type: number
    Rate: number
    Amount: number | null
  }
}

const TAX_GROUP: Record<number, string> = {
  0: 'KDV0',
  1: 'KDV1',
  8: 'KDV8',
  10: 'KDV10',
  18: 'KDV18',
  20: 'KDV20',
}

function taxGroupCode(vatRate: number): string {
  return TAX_GROUP[vatRate] ?? `KDV${vatRate}`
}

function buildCustomerParty(
  customer?: CustomerRow | null,
  notify?: PavoSaleNotifyOptions | null,
): Record<string, unknown> | undefined {
  if (!customer) return undefined
  const parts = (customer.name ?? '').split(' ')
  const partyMail = (() => {
    const m = String(notify?.mailAddr ?? '').trim()
    if (notify?.sendEmail && isValidNotificationEmail(m)) return m
    return String(customer.email ?? '').trim()
  })()
  return {
    CustomerType:  customer.isPerson ? 1 : 2,
    FirstName:     customer.isPerson ? (parts[0] ?? '') : '',
    MiddleName:    '',
    FamilyName:    customer.isPerson ? parts.slice(1).join(' ') : '',
    CompanyName:   customer.isPerson ? '' : (customer.name ?? ''),
    TaxOfficeCode: '',
    TaxNumber:     customer.taxNo  ?? '',
    Phone:         customer.phone  ?? '',
    EMail:         partyMail,
    Country:       'Türkiye',
    City:          customer.city     ?? '',
    District:      customer.district ?? '',
    Neighborhood:  '',
    Address:       customer.address  ?? '',
  }
}

function buildNotifyPhone(notify?: PavoSaleNotifyOptions | null): string {
  const raw = String(notify?.smsPhone ?? '')
  const norm = normalizeTrMobilePavo(raw)
  return Boolean(notify?.sendSms) && norm.length === 10 ? norm : ''
}

function buildNotifyMail(notify?: PavoSaleNotifyOptions | null): string {
  const m = String(notify?.mailAddr ?? '').trim()
  return Boolean(notify?.sendEmail) && isValidNotificationEmail(m) ? m : ''
}

/** CompleteSale ile aynı cihaz UI bayrakları — puanlı satış / müşteri sorularını atla */
function pavoDeviceUiFlags(settings: PavoSettings) {
  return {
    ShowCreditCardMenu: false,
    SelectedSlots: ['rf', 'icc', 'manual'],
    AllowDismissCardRead: false,
    CardReadTimeout: settings.cardReadTimeout,
    SkipAmountCash: true,
    CancelPaymentLater: true,
    AskCustomer: false,
    ShowLoyalty: false,
    SkipLoyalty: true,
    SendResponseBeforePrint: false,
  }
}

/** Fiş altına OrderNo barkodu — Pavo BottomPrintableItems */
export function buildOrderNoBottomPrintItems(
  orderNo: string,
  printWidth: '58mm' | '80mm',
): Array<{
  type:         string
  barcodeData:  string
  alignment:    string
  barcodeType:  string
  showText:     boolean
  fontSize:     number
  height:       number
  width:        number
}> {
  const width = printWidth === '58mm' ? 280 : 384
  const height = printWidth === '58mm' ? 150 : 200
  return [
    {
      type:        'dBarcode',
      barcodeData: orderNo,
      alignment:   'center',
      barcodeType: 'Code128',
      showText:    true,
      fontSize:    25.0,
      height,
      width,
    },
  ]
}

function pavoBaseUrl(settings: PavoSettings): string {
  return `http://${settings.ipAddress}:${settings.port}`
}

function localISOString(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  const local = new Date(now.getTime() - offset)
  return local.toISOString().replace('Z', '').slice(0, 26)
}

function transactionHandle(settings: PavoSettings, seq: number) {
  return {
    SerialNumber: settings.serialNo,
    TransactionDate: localISOString(),
    TransactionSequence: seq,
    Fingerprint: 'test1',
  }
}

function isPavoSequenceError(data: Record<string, unknown>): boolean {
  if ([72, 73].includes(Number(data.ErrorCode))) return true
  const msg = String(data.ErrorMessage ?? data.Message ?? '').toLocaleLowerCase('tr-TR')
  return msg.includes('sıra') || msg.includes('sequence') || msg.includes('seq')
}

function pavoRetryHandle(data: Record<string, unknown>): Record<string, unknown> | null {
  const handle = data.TransactionHandle as Record<string, unknown> | undefined
  if (!handle) return null
  if (handle.TransactionDate == null || handle.TransactionSequence == null) return null
  return handle
}

async function pavoRequest(url: string, body: object): Promise<Record<string, unknown>> {
  const postJson = async (payload: object): Promise<Record<string, unknown>> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.json() as Promise<Record<string, unknown>>
  }

  let data = await postJson(body)

  for (let attempt = 0; attempt < 2; attempt++) {
    const hasError = data.HasError === true || data.IsError === true
    if (!hasError) break
    if (!isPavoSequenceError(data)) break

    const handle = pavoRetryHandle(data)
    if (!handle) break

    await syncPavoSequenceFromResponse(data)

    const retryBody = {
      ...(body as Record<string, unknown>),
      TransactionHandle: {
        ...((body as Record<string, unknown>).TransactionHandle as object),
        TransactionDate:     handle.TransactionDate,
        TransactionSequence: handle.TransactionSequence,
      },
    }
    data = await postJson(retryBody)
  }

  await syncPavoSequenceFromResponse(data)

  return data
}

export async function pavoPair(settings: PavoSettings, seq: number): Promise<PaymentDeviceResult> {
  try {
    const data = await pavoRequest(`${pavoBaseUrl(settings)}/Pairing`, {
      TransactionHandle: transactionHandle(settings, seq),
    })
    return parsePavoResult(data)
  } catch (e) {
    return { success: false, provider: 'pavo', message: String(e), raw: {} }
  }
}

export async function pavoCompleteSale(
  settings: PavoSettings,
  seq: number,
  orderNo: string,
  grossAmount: number,
  amount: number,
  items: PavoSaleItem[],
  payments: Array<{
    Mediator: number
    Amount: number
    CurrencyCode: string
    ExchangeRate: number
  }>,
  explicitPriceEffect?: {
    Type: number
    Rate: number
    Amount: number
  },
  customer?: CustomerRow | null,
  notify?: PavoSaleNotifyOptions | null,
): Promise<PaymentDeviceResult> {
  const customerParty = buildCustomerParty(customer, notify)

  const saleItems = await Promise.all(items.map(async i => {
    const unitCode = await window.electron.db.getUnitPavoCode(i.unitName ?? 'Adet')
    return {
      Name:             i.name,
      IsGeneric:        false,
      UnitCode:         unitCode,
      TaxGroupCode:     taxGroupCode(i.vatRate),
      ItemQuantity:     i.quantity,
      UnitPriceAmount:  i.unitPrice,
      GrossPriceAmount: i.grossPrice,
      TotalPriceAmount: i.totalPrice,
      ...(i.priceEffect ? { PriceEffect: i.priceEffect } : {}),
    }
  }))
  const itemsTotal = saleItems.reduce((sum, item) => sum + Number(item.TotalPriceAmount ?? 0), 0)
  const priceEffectAmount = Math.max(0, parseFloat((itemsTotal - amount).toFixed(2)))
  const computedPriceEffect = priceEffectAmount > 0
    ? { Type: 2, Rate: 0, Amount: priceEffectAmount }
    : undefined
  const priceEffect = explicitPriceEffect ?? computedPriceEffect

  const phoneNorm = buildNotifyPhone(notify)
  const mailTrim = buildNotifyMail(notify)

  const body = {
    TransactionHandle: transactionHandle(settings, seq),
    Sale: {
      RefererApp: 'BTPOS',
      RefererAppVersion: '1.0.0',
      OrderNo: orderNo,
      MainDocumentType: 1,
      GrossPrice: grossAmount,
      TotalPrice: amount,
      CurrencyCode: 'TRY',
      ExchangeRate: 1,
      SendPhoneNotification: Boolean(phoneNorm),
      ...(phoneNorm ? { NotificationPhone: phoneNorm } : {}),
      SendEMailNotification: Boolean(mailTrim),
      ...(mailTrim ? { NotificationEMail: mailTrim } : {}),
      ...pavoDeviceUiFlags(settings),
      AddedSaleItems: saleItems,
      ...(priceEffect ? { PriceEffect: priceEffect } : {}),
      PaymentInformations: payments,
      ReceiptInformation: {
        ReceiptImageEnabled: false,
        ReceiptWidth: settings.printWidth,
        PrintCustomerReceipt: true,
        PrintCustomerReceiptCopy: false,
        PrintMerchantReceipt: true,
      },
      BottomPrintableItems: buildOrderNoBottomPrintItems(orderNo, settings.printWidth),
      ...(customerParty ? { CustomerParty: customerParty } : {}),
    },
  }

  try {
    const data = await pavoRequest(`${pavoBaseUrl(settings)}/CompleteSale`, body)
    return parsePavoResult(data)
  } catch (e) {
    return { success: false, provider: 'pavo', message: String(e), raw: {} }
  }
}

function buildPavoSaleRef(ref: {
  saleId?: number | null
  saleNumber?: string | null
  orderNo?: string | null
}): Record<string, unknown> {
  if (ref.saleId != null && Number(ref.saleId) > 0) return { SaleId: Number(ref.saleId) }
  const saleNumber = String(ref.saleNumber ?? '').trim()
  if (saleNumber) return { SaleNumber: saleNumber }
  const orderNo = String(ref.orderNo ?? '').trim()
  if (orderNo) return { OrderNo: orderNo }
  return {}
}

export async function pavoStartSaleWithItems(
  settings: PavoSettings,
  seq: number,
  orderNo: string,
  grossAmount: number,
  amount: number,
  items: PavoSaleItem[],
  explicitPriceEffect?: {
    Type: number
    Rate: number
    Amount: number
  } | null,
  customer?: CustomerRow | null,
  notify?: PavoSaleNotifyOptions | null,
): Promise<{
  success: boolean
  message?: string
  saleId?: number
  saleNumber?: string
  remainingPaymentAmount?: number
  data?: unknown
}> {
  try {
    const saleItems = await Promise.all(items.map(async i => {
      const unitCode = await window.electron.db.getUnitPavoCode(i.unitName ?? 'Adet')
      return {
        Name:             i.name,
        IsGeneric:        false,
        UnitCode:         unitCode,
        TaxGroupCode:     taxGroupCode(i.vatRate),
        ItemQuantity:     i.quantity,
        UnitPriceAmount:  i.unitPrice,
        GrossPriceAmount: i.grossPrice,
        TotalPriceAmount: i.totalPrice,
        ...(i.priceEffect ? { PriceEffect: i.priceEffect } : {}),
      }
    }))

    const itemsTotal = saleItems.reduce((sum, item) => sum + Number(item.TotalPriceAmount ?? 0), 0)
    const priceEffectAmount = Math.max(0, parseFloat((itemsTotal - amount).toFixed(2)))
    const computedPriceEffect = priceEffectAmount > 0
      ? { Type: 2, Rate: 0, Amount: priceEffectAmount }
      : undefined
    const priceEffect = explicitPriceEffect ?? computedPriceEffect

    const customerParty = buildCustomerParty(customer, notify)
    const phoneNorm     = buildNotifyPhone(notify)
    const mailTrim      = buildNotifyMail(notify)

    const body = {
      TransactionHandle: transactionHandle(settings, seq),
      Sale: {
        RefererApp:            'BTPOS',
        RefererAppVersion:     '1.0.0',
        OrderNo:               orderNo,
        MainDocumentType:      1,
        GrossPrice:            grossAmount,
        TotalPrice:            amount,
        CurrencyCode:          'TRY',
        ExchangeRate:          1,
        SendPhoneNotification: Boolean(phoneNorm),
        ...(phoneNorm ? { NotificationPhone: phoneNorm } : {}),
        SendEMailNotification: Boolean(mailTrim),
        ...(mailTrim ? { NotificationEMail: mailTrim } : {}),
        ...pavoDeviceUiFlags(settings),
        ...(priceEffect ? { PriceEffect: priceEffect } : {}),
        AddedSaleItems:        saleItems,
        ReceiptInformation: {
          ReceiptWidth:             settings.printWidth,
          PrintCustomerReceipt:     true,
          PrintCustomerReceiptCopy: false,
          PrintMerchantReceipt:     true,
        },
        BottomPrintableItems: buildOrderNoBottomPrintItems(orderNo, settings.printWidth),
        ...(customerParty ? { CustomerParty: customerParty } : {}),
      },
    }

    console.log('[StartSaleWithItems] body:', JSON.stringify(body, null, 2))

    const data = await pavoRequest(`${pavoBaseUrl(settings)}/StartSaleWithItems`, body)

    console.log('[StartSaleWithItems] response:', JSON.stringify(data, null, 2))
    await syncPavoSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      return { success: false, message: pavoErrorMessage(data, 'Sepet oluşturulamadı') }
    }

    const d = data.Data as Record<string, unknown> | undefined
    const saleId = Number(d?.SaleId ?? d?.Id ?? 0)
    const saleNumber = String(d?.SaleNumber ?? '').trim() || undefined
    const remainingPaymentAmount = Number(d?.RemainingPaymentAmount ?? amount)

    // Offline/askı satışta Id: 0 gelebilir; SaleNumber yeterli referans
    if (!(saleId > 0 || saleNumber)) {
      return { success: false, message: 'Sepet oluşturuldu ama satış referansı alınamadı' }
    }

    return { success: true, saleId, saleNumber, remainingPaymentAmount, data }
  } catch (e) {
    return { success: false, message: String(e) }
  }
}

export async function pavoAddPayment(
  settings: PavoSettings,
  seq: number,
  saleRef: {
    saleId?: number | null
    saleNumber?: string | null
    orderNo?: string | null
  },
  payment: {
    mediator: number
    amount: number
    currencyCode?: string
  },
  saleTotals?: {
    grossPrice: number
    totalPrice: number
  },
): Promise<{
  success: boolean
  message?: string
  remainingPaymentAmount?: number
  finalized?: boolean
  data?: unknown
}> {
  try {
    const ref = buildPavoSaleRef(saleRef)
    if (Object.keys(ref).length === 0) {
      return { success: false, message: 'Ödeme için satış referansı yok' }
    }

    const body = {
      TransactionHandle: transactionHandle(settings, seq),
      Sale: {
        ...ref,
        ...(saleTotals ? {
          GrossPrice: saleTotals.grossPrice,
          TotalPrice: saleTotals.totalPrice,
        } : {}),
        PaymentInformations: [{
          Mediator:     payment.mediator,
          Amount:       payment.amount,
          CurrencyCode: payment.currencyCode ?? 'TRY',
          ExchangeRate: 1,
          IsVoid:       false,
        }],
        ...pavoDeviceUiFlags(settings),
        ReceiptInformation: {
          ReceiptImageEnabled: false,
          ReceiptWidth: settings.printWidth,
          PrintCustomerReceipt: true,
          PrintCustomerReceiptCopy: false,
          PrintMerchantReceipt: true,
        },
      },
    }

    console.log('[AddPayment] body:', JSON.stringify(body, null, 2))
    const data = await pavoRequest(`${pavoBaseUrl(settings)}/AddPayment`, body)
    console.log('[AddPayment] response:', JSON.stringify(data, null, 2))
    await syncPavoSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      return { success: false, message: pavoErrorMessage(data, 'Ödeme eklenemedi') }
    }

    const d = data.Data as Record<string, unknown> | undefined
    const remaining = Number(d?.RemainingPaymentAmount ?? 0)
    const finalized = remaining <= 0

    return { success: true, remainingPaymentAmount: remaining, finalized, data }
  } catch (e) {
    return { success: false, message: String(e) }
  }
}

export async function pavoFinalizeSale(
  settings: PavoSettings,
  seq: number,
  saleRef: {
    saleId?: number | null
    saleNumber?: string | null
    orderNo?: string | null
  },
): Promise<{ success: boolean; message?: string; data?: unknown }> {
  try {
    const ref = buildPavoSaleRef(saleRef)
    if (Object.keys(ref).length === 0) {
      return { success: false, message: 'Finalize için satış referansı yok' }
    }

    const body = {
      TransactionHandle: transactionHandle(settings, seq),
      Sale: ref,
    }

    const data = await pavoRequest(`${pavoBaseUrl(settings)}/FinalizeSale`, body)
    await syncPavoSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      return { success: false, message: pavoErrorMessage(data, 'Satış kapatılamadı') }
    }

    return { success: true, data }
  } catch (e) {
    return { success: false, message: String(e) }
  }
}

export async function pavoCheckPendingSale(
  settings: PavoSettings,
  seq: number,
  orderNo: string,
): Promise<{
  success: boolean
  message?: string
  hasPending?: boolean
  saleId?: number
  saleNumber?: string
  remainingPaymentAmount?: number
  data?: unknown
}> {
  try {
    const body = {
      TransactionHandle: transactionHandle(settings, seq),
      Sale: { OrderNo: orderNo },
    }

    const data = await pavoRequest(`${pavoBaseUrl(settings)}/CheckPendingSale`, body)
    await syncPavoSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      const msg = pavoErrorMessage(data, 'Kontrol başarısız')
      const notFound = msg.toLowerCase().includes('bulunamadı') || Number(data.ErrorCode) === 404
      return { success: true, hasPending: false, message: notFound ? 'Satış bulunamadı' : msg }
    }

    const d = data.Data as Record<string, unknown> | undefined
    return {
      success: true,
      hasPending: true,
      saleId: Number(d?.SaleId ?? d?.Id ?? 0),
      saleNumber: String(d?.SaleNumber ?? '').trim() || undefined,
      remainingPaymentAmount: Number(d?.RemainingPaymentAmount ?? 0),
      data,
    }
  } catch (e) {
    return { success: false, message: String(e) }
  }
}

export async function pavoAbandonSuspendedSale(
  settings: PavoSettings,
  seq: number,
  saleRef: {
    saleId?: number | null
    saleNumber?: string | null
    orderNo?: string | null
  },
): Promise<{ success: boolean; message?: string; data?: unknown }> {
  try {
    const ref = buildPavoSaleRef(saleRef)
    if (Object.keys(ref).length === 0) {
      return { success: false, message: 'İptal için satış referansı yok' }
    }

    const body = {
      TransactionHandle: transactionHandle(settings, seq),
      Sale: ref,
    }

    const data = await pavoRequest(`${pavoBaseUrl(settings)}/AbandonSuspendedSale`, body)
    await syncPavoSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      return { success: false, message: pavoErrorMessage(data, 'İptal başarısız') }
    }

    return { success: true, data }
  } catch (e) {
    return { success: false, message: String(e) }
  }
}

export async function pavoGetSaleResult(
  settings: PavoSettings,
  seq: number,
  orderNo: string,
): Promise<{
  success: boolean
  message?: string
  status?: 'completed' | 'pending' | 'cancelled' | 'failed'
  saleId?: number
  data?: unknown
}> {
  try {
    const body = {
      TransactionHandle: transactionHandle(settings, seq),
      Sale: { OrderNo: orderNo },
    }

    const data = await pavoRequest(`${pavoBaseUrl(settings)}/GetSaleResult`, body)
    await syncPavoSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      return { success: false, message: pavoErrorMessage(data, 'Sonuç alınamadı') }
    }

    const d = data.Data as Record<string, unknown> | undefined
    const statusId = Number(d?.StatusId ?? d?.SaleStatusId ?? 0)
    const status: 'completed' | 'pending' | 'cancelled' | 'failed' =
      statusId === 4 ? 'completed' :
      statusId === 5 ? 'cancelled' :
      statusId === 23 ? 'pending'  : 'failed'

    return {
      success: true,
      status,
      saleId: Number(d?.SaleId ?? d?.Id ?? 0),
      data,
    }
  } catch (e) {
    return { success: false, message: String(e) }
  }
}

export interface PavoReturnableSaleItem {
  Id:                 number
  ProductName:        string
  Quantity:           number
  ReturnableQuantity: number
  UnitPrice:          number
  TotalPrice:         number
}

export interface PavoReturnableSale {
  Id:           number
  SaleNumber:   string
  CustomerInfo: { CustomerType?: number; CompanyName?: string } | null
  Items:        PavoReturnableSaleItem[]
  Payments:     Array<{
    Mediator:         number
    Amount:           number
    ReturnableAmount: number
    PaymentId:        number
  }>
}

function pavoErrorMessage(data: Record<string, unknown>, fallback: string): string {
  return String(data.ErrorMessage ?? data.Message ?? fallback)
}

function extractPavoSale(data: Record<string, unknown>): Record<string, unknown> | null {
  if (data.Sale && typeof data.Sale === 'object') {
    return data.Sale as Record<string, unknown>
  }
  const inner = data.Data as Record<string, unknown> | undefined
  if (inner?.Sale && typeof inner.Sale === 'object') {
    return inner.Sale as Record<string, unknown>
  }
  if (inner && typeof inner === 'object' && inner.Id != null) {
    return inner
  }
  return null
}

function pavoSaleItems(sale: Record<string, unknown>): unknown[] {
  const raw = sale.AddedSaleItems ?? sale.Items
  return Array.isArray(raw) ? raw : []
}

function pavoSalePayments(sale: Record<string, unknown>): unknown[] {
  const raw = sale.AddedPayments ?? sale.Payments
  return Array.isArray(raw) ? raw : []
}

function mapPavoReturnableItems(sale: Record<string, unknown>): PavoReturnableSaleItem[] {
  return pavoSaleItems(sale).map((row) => {
    const item = row as Record<string, unknown>
    const qty = Number(item.ItemQuantity ?? item.Quantity ?? 0)
    return {
      Id:                 Number(item.Id ?? item.RelatedSaleItemId ?? 0),
      ProductName:        String(item.Name ?? item.ProductName ?? ''),
      Quantity:           qty,
      ReturnableQuantity: Number(item.ReturnableQuantity ?? qty),
      UnitPrice:          Number(item.UnitPriceAmount ?? item.UnitPrice ?? 0),
      TotalPrice:         Number(item.TotalPriceAmount ?? item.TotalPrice ?? 0),
    }
  })
}

function mapPavoReturnablePayments(sale: Record<string, unknown>) {
  return pavoSalePayments(sale)
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
}

async function syncPavoSequenceFromResponse(data: Record<string, unknown>): Promise<void> {
  const handle = data.TransactionHandle as Record<string, unknown> | undefined
  const pavoSeq = Number(handle?.TransactionSequence)
  if (Number.isFinite(pavoSeq)) {
    await window.electron.db.updatePavoSequence(pavoSeq)
  }
}

export async function pavoGetReturnableSale(
  settings: PavoSettings,
  seq: number,
  opts: { searchBy: 'order' | 'sale'; query: string },
): Promise<{ success: boolean; message?: string; data?: PavoReturnableSale }> {
  try {
    const query = opts.query.trim()
    const salePayload: Record<string, unknown> = {
      ReceiptImageEnabled: false,
      ReceiptJsonEnabled:  false,
      ReceiptTextEnabled:  false,
    }
    if (opts.searchBy === 'sale') {
      salePayload.SaleNumber = query
    } else {
      salePayload.OrderNo = query
    }

    const data = await pavoRequest(`${pavoBaseUrl(settings)}/GetReturnableSale`, {
      TransactionHandle: transactionHandle(settings, seq),
      Sale: salePayload,
    })

    await syncPavoSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      return { success: false, message: pavoErrorMessage(data, 'Satış bulunamadı') }
    }

    const sale = extractPavoSale(data)
    if (!sale) {
      return { success: false, message: 'Satış bulunamadı' }
    }

    const items = mapPavoReturnableItems(sale)
    const payments = mapPavoReturnablePayments(sale)

    const customerRaw = sale.CustomerInfo ?? sale.CustomerParty
    const customerInfo = customerRaw && typeof customerRaw === 'object'
      ? customerRaw as { CustomerType?: number; CompanyName?: string }
      : null

    return {
      success: true,
      data: {
        Id:           Number(sale.Id ?? 0),
        SaleNumber:   String(sale.SaleNumber ?? (opts.searchBy === 'sale' ? query : '')),
        CustomerInfo: customerInfo ?? null,
        Items:        items,
        Payments:     payments,
      },
    }
  } catch (e) {
    return { success: false, message: String(e) }
  }
}

export async function pavoPartialReturn(
  settings: PavoSettings,
  seq: number,
  opts: Record<string, unknown>,
): Promise<{ success: boolean; message?: string; data?: unknown }> {
  try {
    const printWidth = opts.ReceiptWidth ?? settings.printWidth

    const data = await pavoRequest(`${pavoBaseUrl(settings)}/PartialReturn`, {
      TransactionHandle: transactionHandle(settings, seq),
      Sale: {
        RefererApp:            'BTPOS',
        RefererAppVersion:     '1.0.0',
        IntegrationSaleType:   6,
        ...opts,
        ReceiptWidth:          printWidth,
        PrintCustomerReceipt:  opts.PrintCustomerReceipt ?? true,
        PrintMerchantReceipt:  opts.PrintMerchantReceipt ?? true,
      },
    })

    await syncPavoSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      return { success: false, message: pavoErrorMessage(data, 'İade başarısız') }
    }

    return { success: true, data }
  } catch (e) {
    return { success: false, message: String(e) }
  }
}

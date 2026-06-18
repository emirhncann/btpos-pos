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
  1: 'KDV1',
  8: 'KDV8',
  10: 'KDV10',
  18: 'KDV18',
  20: 'KDV20',
}

function taxGroupCode(vatRate: number): string {
  return TAX_GROUP[vatRate] ?? `KDV${vatRate}`
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

async function pavoRequest(url: string, body: object): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as Record<string, unknown>

  if (data.HasError === true && [72, 73].includes(Number(data.ErrorCode))) {
    const handle = data.TransactionHandle as Record<string, unknown> | undefined
    if (handle) {
      const retryBody = {
        ...(body as Record<string, unknown>),
        TransactionHandle: {
          ...((body as Record<string, unknown>).TransactionHandle as object),
          TransactionDate: handle.TransactionDate,
          TransactionSequence: handle.TransactionSequence,
        },
      }
      const res2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryBody),
      })
      return res2.json() as Promise<Record<string, unknown>>
    }
  }

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
  let customerParty: Record<string, unknown> | undefined
  if (customer) {
    const parts = (customer.name ?? '').split(' ')
    const partyMail = (() => {
      const m = String(notify?.mailAddr ?? '').trim()
      if (notify?.sendEmail && isValidNotificationEmail(m)) return m
      return String(customer.email ?? '').trim()
    })()
    customerParty = {
      CustomerType: customer.isPerson ? 1 : 2,
      FirstName:    customer.isPerson ? (parts[0] ?? '') : '',
      MiddleName:   '',
      FamilyName:   customer.isPerson ? parts.slice(1).join(' ') : '',
      CompanyName:  customer.isPerson ? '' : (customer.name ?? ''),
      TaxOfficeCode: '',
      TaxNumber:    customer.taxNo ?? '',
      Phone:        customer.phone ?? '',
      EMail:        partyMail,
      Country:      'Türkiye',
      City:         customer.city ?? '',
      District:     customer.district ?? '',
      Neighborhood: '',
      Address:      customer.address ?? '',
    }
  }

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

  const phoneNorm = normalizeTrMobilePavo(String(notify?.smsPhone ?? ''))
  const sendPhoneNotification = Boolean(notify?.sendSms) && phoneNorm.length === 10

  const mailTrim = String(notify?.mailAddr ?? '').trim()
  const sendEmailNotification = Boolean(notify?.sendEmail) && isValidNotificationEmail(mailTrim)

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
      SendPhoneNotification: sendPhoneNotification,
      ...(sendPhoneNotification ? { NotificationPhone: phoneNorm } : {}),
      SendEMailNotification: sendEmailNotification,
      ...(sendEmailNotification ? { NotificationEMail: mailTrim } : {}),
      ShowCreditCardMenu: false,
      SelectedSlots: ['rf', 'icc', 'manual'],
      AllowDismissCardRead: false,
      CardReadTimeout: settings.cardReadTimeout,
      SkipAmountCash: true,
      CancelPaymentLater: true,
      AskCustomer: false,
      SendResponseBeforePrint: false,
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
  saleNumber: string,
): Promise<{ success: boolean; message?: string; data?: PavoReturnableSale }> {
  try {
    const data = await pavoRequest(`${pavoBaseUrl(settings)}/GetReturnableSale`, {
      TransactionHandle: transactionHandle(settings, seq),
      Sale: {
        SaleNumber: saleNumber,
        ReceiptImageEnabled: false,
        ReceiptJsonEnabled:  false,
        ReceiptTextEnabled:  false,
      },
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
        SaleNumber:   String(sale.SaleNumber ?? saleNumber),
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

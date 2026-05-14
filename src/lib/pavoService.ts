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

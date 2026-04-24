// Pavo REST API ile iletisim
import { parsePavoResult, type PaymentDeviceResult } from './paymentDevice'

export interface PavoSettings {
  ipAddress: string
  port: number
  serialNo: string
  cardReadTimeout: number
  printWidth: '58mm' | '80mm'
}

export interface PavoSaleItem {
  name: string
  unitName?: string
  vatRate: number
  quantity: number
  unitPrice: number
  grossPrice: number
  totalPrice: number
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
  amount: number,
  items: PavoSaleItem[],
  cashAmount: number,
  cardAmount: number,
  customer?: CustomerRow | null,
): Promise<PaymentDeviceResult> {
  const payments: Array<{
    Mediator: number
    Amount: number
    CurrencyCode: string
    ExchangeRate: number
  }> = []
  if (cashAmount > 0) {
    payments.push({ Mediator: 1, Amount: cashAmount, CurrencyCode: 'TRY', ExchangeRate: 1 })
  }
  if (cardAmount > 0) {
    payments.push({ Mediator: 2, Amount: cardAmount, CurrencyCode: 'TRY', ExchangeRate: 1 })
  }

  let customerParty: Record<string, unknown> | undefined
  if (customer) {
    const parts = (customer.name ?? '').split(' ')
    customerParty = {
      CustomerType: customer.isPerson ? 1 : 2,
      FirstName:    customer.isPerson ? (parts[0] ?? '') : '',
      MiddleName:   '',
      FamilyName:   customer.isPerson ? parts.slice(1).join(' ') : '',
      CompanyName:  customer.isPerson ? '' : (customer.name ?? ''),
      TaxOfficeCode: '',
      TaxNumber:    customer.taxNo ?? '',
      Phone:        customer.phone ?? '',
      EMail:        '',
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
    }
  }))

  const body = {
    TransactionHandle: transactionHandle(settings, seq),
    Sale: {
      RefererApp: 'BTPOS',
      RefererAppVersion: '1.0.0',
      OrderNo: orderNo,
      MainDocumentType: 1,
      GrossPrice: amount,
      TotalPrice: amount,
      CurrencyCode: 'TRY',
      ExchangeRate: 1,
      SendPhoneNotification: false,
      SendEMailNotification: false,
      ShowCreditCardMenu: false,
      SelectedSlots: ['rf', 'icc', 'manual'],
      AllowDismissCardRead: false,
      CardReadTimeout: settings.cardReadTimeout,
      SkipAmountCash: true,
      CancelPaymentLater: true,
      AskCustomer: false,
      SendResponseBeforePrint: false,
      AddedSaleItems: saleItems,
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

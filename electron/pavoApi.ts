import { getPaymentDeviceSettings, nextPavoSequence, updatePavoSequence } from '../db/operations'

function localISOString(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  const local = new Date(now.getTime() - offset)
  return local.toISOString().replace('Z', '').slice(0, 26)
}

interface PavoDeviceConfig {
  ipAddress: string
  port: number
  serialNo: string
}

function transactionHandle(settings: PavoDeviceConfig, seq: number) {
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

async function syncSequenceFromResponse(data: Record<string, unknown>): Promise<void> {
  const handle = data.TransactionHandle as Record<string, unknown> | undefined
  const pavoSeq = Number(handle?.TransactionSequence)
  if (Number.isFinite(pavoSeq)) {
    updatePavoSequence(pavoSeq)
  }
}

async function getActivePavoDevice(): Promise<PavoDeviceConfig | null> {
  const device = await getPaymentDeviceSettings('pavo')
  if (!device?.ipAddress || !device.isActive) return null
  return {
    ipAddress: device.ipAddress,
    port: device.port,
    serialNo: device.serialNo ?? '',
  }
}

function pavoBaseUrl(settings: PavoDeviceConfig): string {
  return `http://${settings.ipAddress}:${settings.port}`
}

function extractSale(data: Record<string, unknown>): Record<string, unknown> | null {
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

function pavoErrorMessage(data: Record<string, unknown>, fallback: string): string {
  return String(data.ErrorMessage ?? data.Message ?? fallback)
}

export async function pavoGetReturnableSale(opts: {
  searchBy: 'order' | 'sale'
  query:    string
}): Promise<{
  success: boolean
  message?: string
  data?: {
    Id: number
    SaleNumber: string
    CustomerInfo: { CustomerType?: number; CompanyName?: string } | null
    Items: Array<{
      Id: number
      ProductName: string
      Quantity: number
      ReturnableQuantity: number
      UnitPrice: number
      TotalPrice: number
    }>
    Payments: Array<{
      Mediator: number
      Amount: number
      ReturnableAmount: number
      PaymentId: number
    }>
  }
}> {
  try {
    const settings = await getActivePavoDevice()
    if (!settings) return { success: false, message: 'Pavo ayarı yok veya cihaz pasif' }

    const query = opts.query.trim()
    if (!query) return { success: false, message: 'Arama değeri boş' }

    const seq = nextPavoSequence()
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

    await syncSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      return { success: false, message: pavoErrorMessage(data, 'Satış bulunamadı') }
    }

    const sale = extractSale(data)
    if (!sale) {
      return { success: false, message: 'Satış bulunamadı' }
    }

    const rawItems = sale.AddedSaleItems ?? sale.Items
    const items = (Array.isArray(rawItems) ? rawItems : []).map((row) => {
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

    const rawPayments = sale.AddedPayments ?? sale.Payments
    const payments = (Array.isArray(rawPayments) ? rawPayments : [])
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

export async function pavoPartialReturn(opts: Record<string, unknown>): Promise<{
  success: boolean
  message?: string
  data?: unknown
}> {
  try {
    const settings = await getActivePavoDevice()
    if (!settings) return { success: false, message: 'Pavo ayarı yok veya cihaz pasif' }

    const seq = nextPavoSequence()
    const printWidth = opts.ReceiptWidth ?? '80mm'

    const body = {
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
    }

    const data = await pavoRequest(`${pavoBaseUrl(settings)}/PartialReturn`, body)
    await syncSequenceFromResponse(data)

    if (data.HasError === true || data.IsError === true) {
      return { success: false, message: pavoErrorMessage(data, 'İade başarısız') }
    }

    return { success: true, data }
  } catch (e) {
    return { success: false, message: String(e) }
  }
}

import {
  customerRefFromCustomerRow,
  customerRefTorba,
  tryResolveTorbaCustomer,
} from './queueCustomer'
import { formatPerSaleInvoiceLabel, type DayEndScope } from './invoiceMode'

export type SendPendingInvoicesOpts = { silent?: boolean; scope?: DayEndScope }

export { tryResolveTorbaCustomer }

async function withTerminalPayment(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const terminalId = String(await window.electron.store.get('terminal_id').catch(() => '') ?? '')
  const cardByBank = payload.card_by_bank && typeof payload.card_by_bank === 'object'
    ? payload.card_by_bank as Record<string, { amount?: number; acquirerName?: string }>
    : {}
  const paymentAccounts = await window.electron.db.matchPaymentAccounts({
    cashAmount: Number(payload.cash_amount ?? 0),
    cardAmount: Number(payload.card_amount ?? 0),
    cardAcquirerId: payload.card_acquirer_id != null ? String(payload.card_acquirer_id) : null,
    cardByBank,
  })
  return { ...payload, terminal_id: terminalId, payment_accounts: paymentAccounts }
}

/** Gün sonu: carisiz bekleyen fişler tek ERP faturasında birleştirilir; gönderim kuyruğa yazılır */
export async function sendPendingInvoices(
  companyId: string,
  opts?: SendPendingInvoicesOpts,
): Promise<{ ok: number; fail: number }> {
  const settings = await window.electron.db.getTerminalSettings()
  const invoiceType: 'e_archive' | 'paper' = settings.invoiceType === 'paper' ? 'paper' : 'e_archive'
  const torbaRef = customerRefTorba()
  const now = new Date()
  const saatStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const tarihStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  type DayEndLineItem = {
    product_code: string
    name:         string
    quantity:     number
    vatRate:      number
    unit:         string
    product_id:   number
    unit_code?:   string
    unit_price_gross: number
    gross_amount: number
    discount_amount: number
    net_amount: number
  }

  let returnBatchCount = 0
  const pendingReturns = await window.electron.db.getPendingReturnInvoices(companyId)

  if (pendingReturns.length > 0) {
    const returnItems: DayEndLineItem[] = []

    for (const op of pendingReturns) {
      const payload = JSON.parse(op.payload) as {
        items?: DayEndLineItem[]
      }
      for (const item of payload.items ?? []) {
        const unitPriceGross = Number(item.unit_price_gross ?? 0)
        const qty = Math.abs(Number(item.quantity) || 0)
        const grossAmount = Number(item.gross_amount ?? (unitPriceGross * qty).toFixed(2))
        const discountAmount = Number(item.discount_amount ?? 0)
        const netAmount = Number(item.net_amount ?? (grossAmount - discountAmount).toFixed(2))
        const key = `${item.product_code}|${unitPriceGross}|${item.vatRate}`
        const existing = returnItems.find(r =>
          `${r.product_code}|${r.unit_price_gross}|${r.vatRate}` === key,
        )
        if (existing) {
          existing.quantity += qty
          existing.gross_amount = Math.round((existing.gross_amount + grossAmount) * 100) / 100
          existing.discount_amount = Math.round((existing.discount_amount + discountAmount) * 100) / 100
          existing.net_amount = Math.round((existing.net_amount + netAmount) * 100) / 100
        } else {
          returnItems.push({
            product_code: item.product_code,
            name: item.name,
            quantity: qty,
            vatRate: item.vatRate,
            unit: item.unit,
            product_id: item.product_id,
            unit_code: item.unit_code,
            unit_price_gross: unitPriceGross,
            gross_amount: grossAmount,
            discount_amount: discountAmount,
            net_amount: netAmount,
          })
        }
      }
    }

    if (returnItems.length > 0) {
      const returnDate   = now.toISOString().replace('T', ' ').slice(0, 19)
      const returnSaleId = 'iade-gunsonu-' + now.toISOString().slice(0, 10)
      const returnLabel  = `İade Gün Sonu ${tarihStr}`
      const returnDesc   = `Toplu İade — ${tarihStr} ${saatStr} (${pendingReturns.length} iade)`
      const returnCardAmt = pendingReturns.reduce((s, op) => {
        const p = JSON.parse(op.payload) as { card_amount?: number }
        return s + (p.card_amount ?? 0)
      }, 0)
      const returnCashAmt = pendingReturns.reduce((s, op) => {
        const p = JSON.parse(op.payload) as { cash_amount?: number }
        return s + (p.cash_amount ?? 0)
      }, 0)

      await window.electron.db.enqueueOperation({
        id:        crypto.randomUUID(),
        companyId,
        type:      'return_invoice',
        payload: await withTerminalPayment({
          sale_id:         returnSaleId,
          customer_ref:    torbaRef,
          items:           returnItems,
          invoice_date:    returnDate,
          description:     returnDesc,
          invoice_type:    invoiceType,
          cash_amount:     returnCashAmt,
          card_amount:     returnCardAmt,
        }),
        label: returnLabel,
      })

      for (const op of pendingReturns) {
        await window.electron.db.markOperationDone(op.id)
      }

      returnBatchCount = pendingReturns.length
      console.log(`[gün sonu] ${pendingReturns.length} iade toplandı, kuyruğa eklendi`)
    }
  }

  const dayEnd = await window.electron.db.enqueueDayEndInvoicePackage(
    companyId,
    opts?.scope === 'z' ? 'z' : 'previous_days',
  )

  if (!dayEnd.queued && dayEnd.fail > 0) {
    if (!opts?.silent) {
      window.alert(`✕ Gün sonu oluşturulamadı\n${dayEnd.error ?? 'Hata'}`)
    }
    return { ok: returnBatchCount, fail: dayEnd.fail }
  }

  if (!dayEnd.queued && returnBatchCount === 0) return { ok: 0, fail: 0 }

  if (!dayEnd.queued) {
    if (!opts?.silent && returnBatchCount > 0) {
      window.alert(
        `✓ Gün sonu iade kuyruğa eklendi\n${returnBatchCount} iade işlenecek\nİnternet bağlantısında otomatik gönderilecek.`,
      )
    }
    return { ok: returnBatchCount, fail: 0 }
  }

  if (!opts?.silent) {
    const parts = [`${dayEnd.saleCount} fiş`]
    if (returnBatchCount > 0) parts.push(`${returnBatchCount} iade`)
    window.alert(
      `✓ Gün sonu kuyruğa eklendi\n${parts.join(', ')} işlenecek\nİnternet bağlantısında otomatik gönderilecek.`,
    )
  }

  return { ok: dayEnd.saleCount + returnBatchCount, fail: 0 }
}

/** Cari seçili satış sonrası fatura — kuyruğa yazılır */
export async function sendInvoiceForSale(
  companyId: string,
  saleId: string,
  customer: CustomerRow,
  invoiceType: 'e_archive' | 'paper' = 'e_archive',
  payment?: {
    cashAmount: number
    cardAmount: number
    cardAcquirerId: string | null
    cardByBank?: Record<string, { amount: number; acquirerName: string }>
  },
  invoiceNumber?: string,
): Promise<void> {
  const endpoint = invoiceType === 'paper'
    ? `/integration/invoice-paper/${companyId}`
    : `/integration/invoice/${companyId}`

  const items = await window.electron.db.getSaleItems(saleId)
  const mappedItems = await Promise.all(items.map(async i => {
    let productId = 0
    let unitCode = 'C62'
    if (invoiceType === 'paper') {
      const product = await window.electron.db.getProductByCode(i.productCode)
      const productIdRaw = await window.electron.db.getProductIdByCode(i.productCode)
      productId = Number.parseInt(productIdRaw ?? '0', 10) || 0
      unitCode = await window.electron.db.getUnitPavoCode(product?.unit ?? 'Adet')
    }
    const qty = Math.abs(Number(i.quantity) || 0)
    const unitPriceGross = Number(i.unitPriceGross ?? i.price)
    const grossAmount = Number(i.grossAmount ?? (unitPriceGross * qty).toFixed(2))
    const discountAmount = Number(i.discountAmount ?? 0)
    const netAmount = Number(i.netAmount ?? (grossAmount - discountAmount).toFixed(2))
    return {
      product_code: i.productCode,
      name:         i.productName ?? i.productCode,
      quantity:     qty,
      vatRate:      i.vatRate,
      unit:         i.unit ?? 'Adet',
      product_id:   productId,
      unit_code:    unitCode,
      unit_price_gross: unitPriceGross,
      gross_amount: grossAmount,
      discount_amount: discountAmount,
      net_amount: netAmount,
    }
  }))
  const expectedTotal = Math.round(
    mappedItems.reduce((s, i) => s + Number(i.net_amount), 0) * 100,
  ) / 100
  const payload = {
    sale_id:      saleId,
    customer_ref: customerRefFromCustomerRow(customer),
    items:        mappedItems,
    expected_total: expectedTotal,
    invoice_number: invoiceNumber,
    invoice_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    description:  `POS Satışı — ${customer.name}`,
    endpoint,
    cash_amount:      payment?.cashAmount ?? 0,
    card_amount:      payment?.cardAmount ?? 0,
    card_acquirer_id: payment?.cardAcquirerId ?? null,
    card_by_bank:     payment?.cardByBank ?? {},
  }

  const badInvoiceItems = (payload.items as Array<{ product_code?: string; vatRate?: number; name?: string }>).filter(
    i => !String(i.product_code ?? '').trim() || !Number.isFinite(Number(i.vatRate)),
  )
  if (badInvoiceItems.length > 0) {
    const msg = `Ürün kodu/KDV eksik: ${badInvoiceItems.map(b => b.name ?? '?').join(', ')}`
    await window.electron.db.markInvoiceError(saleId, msg)
    return
  }

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'invoice',
    payload:   await withTerminalPayment(payload),
    label:     `${customer.name} faturası`,
  })
}

/** Carisiz per_sale: tek satış, müşteri gün sonu faturasındaki torba cari. */
export async function sendAnonymousPerSaleInvoice(
  companyId: string,
  saleId: string,
  receiptNo: string,
  invoiceType: 'e_archive' | 'paper' = 'e_archive',
  payment?: {
    cashAmount: number
    cardAmount: number
    cardAcquirerId: string | null
    cardByBank?: Record<string, { amount: number; acquirerName: string }>
  },
): Promise<void> {
  const endpoint = invoiceType === 'paper'
    ? `/integration/invoice-paper/${companyId}`
    : `/integration/invoice/${companyId}`
  const items = await window.electron.db.getSaleItems(saleId)
  const mappedItems = await Promise.all(items.map(async i => {
    let productId = 0
    let unitCode = 'C62'
    if (invoiceType === 'paper') {
      const product = await window.electron.db.getProductByCode(i.productCode)
      const productIdRaw = await window.electron.db.getProductIdByCode(i.productCode)
      productId = Number.parseInt(productIdRaw ?? '0', 10) || 0
      unitCode = await window.electron.db.getUnitPavoCode(product?.unit ?? 'Adet')
    }
    const qty = Math.abs(Number(i.quantity) || 0)
    const unitPriceGross = Number(i.unitPriceGross ?? i.price)
    const grossAmount = Number(i.grossAmount ?? (unitPriceGross * qty).toFixed(2))
    const discountAmount = Number(i.discountAmount ?? 0)
    const netAmount = Number(i.netAmount ?? (grossAmount - discountAmount).toFixed(2))
    return {
      product_code: i.productCode,
      name:         i.productName ?? i.productCode,
      quantity:     qty,
      vatRate:      i.vatRate,
      unit:         i.unit ?? 'Adet',
      product_id:   productId,
      unit_code:    unitCode,
      unit_price_gross: unitPriceGross,
      gross_amount: grossAmount,
      discount_amount: discountAmount,
      net_amount: netAmount,
    }
  }))
  const expectedTotal = Math.round(
    mappedItems.reduce((s, i) => s + Number(i.net_amount), 0) * 100,
  ) / 100
  const badInvoiceItems = mappedItems.filter(
    i => !String(i.product_code ?? '').trim() || !Number.isFinite(Number(i.vatRate)),
  )
  if (badInvoiceItems.length > 0) {
    const msg = `Ürün kodu/KDV eksik: ${badInvoiceItems.map(b => b.name ?? '?').join(', ')}`
    await window.electron.db.markInvoiceError(saleId, msg)
    return
  }
  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'invoice',
    payload:   await withTerminalPayment({
      sale_id:          saleId,
      customer_ref:     customerRefTorba(),
      items:            mappedItems,
      expected_total:   expectedTotal,
      invoice_date:     new Date().toISOString().replace('T', ' ').slice(0, 19),
      description:      formatPerSaleInvoiceLabel(receiptNo),
      endpoint,
      cash_amount:      payment?.cashAmount ?? 0,
      card_amount:      payment?.cardAmount ?? 0,
      card_acquirer_id: payment?.cardAcquirerId ?? null,
      card_by_bank:     payment?.cardByBank ?? {},
    }),
    label: formatPerSaleInvoiceLabel(receiptNo),
  })
}

/** İade sonrası fatura — kuyruğa yazılır (worker → return-invoice API) */
export interface QuickReturnInvoiceLine {
  productCode?: string
  productName:  string
  quantity:     number
  unitPrice:    number
  vatRate?:     number
  unitName?:    string
  unitCode?:    string
  stockRef?:    number
  productId?:   number
}

/** Hızlı iade — Pavo item'larından Logo payload'ı (boş productCode ile getProductIdByCode çağırmaz) */
export async function enqueueQuickReturnInvoice(
  companyId: string,
  opts: {
    receiptNo:   string
    orderNo?:    string
    totalReturn: number
    invoiceType: 'e_archive' | 'paper'
    cashAmount?: number
    cardAmount?: number
    items:       QuickReturnInvoiceLine[]
  },
): Promise<void> {
  const returnItems = await Promise.all(opts.items.map(async item => {
    let productId = item.stockRef ?? item.productId ?? 0
    const productCode = item.productCode?.trim() ?? ''
    if (productId <= 0 && productCode) {
      const fromDb = await window.electron.db.getProductIdByCode(productCode)
      productId = Number.parseInt(fromDb ?? '0', 10) || 0
    }

    const qty = Math.abs(Number(item.quantity) || 0)
    const unitPriceGross = Number(item.unitPrice)
    const grossAmount = Math.round(unitPriceGross * qty * 100) / 100
    return {
      product_code: productCode,
      name:         item.productName,
      quantity:     qty,
      vatRate:      item.vatRate ?? 20,
      unit:         item.unitName ?? 'Adet',
      unit_code:    item.unitCode ?? await window.electron.db.getUnitPavoCode(item.unitName ?? 'Adet'),
      product_id:   productId,
      unit_price_gross: unitPriceGross,
      gross_amount: grossAmount,
      discount_amount: 0,
      net_amount: grossAmount,
    }
  }))
  const expectedTotal = Math.round(
    returnItems.reduce((s, i) => s + Number(i.net_amount), 0) * 100,
  ) / 100

  const payload = {
    sale_id:         opts.receiptNo,
    invoice_number:  opts.orderNo ?? opts.receiptNo,
    customer_ref:    customerRefTorba(),
    items:           returnItems,
    expected_total:  expectedTotal,
    invoice_date:    new Date().toISOString().replace('T', ' ').slice(0, 19),
    description:     `İade — ${opts.orderNo ?? opts.receiptNo}`,
    invoice_type:    opts.invoiceType,
    cash_amount:     opts.cashAmount ?? 0,
    card_amount:     opts.cardAmount ?? opts.totalReturn,
  }

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'return_invoice',
    status:    'pending_dayend',
    payload:   await withTerminalPayment(payload),
    label:     `İade — ${opts.orderNo ?? opts.receiptNo}`,
  })
}

export interface ReturnInvoiceItem {
  product_code: string
  name:         string
  quantity:     number
  vatRate:      number
  unit:         string
  unit_code:    string
  product_id:   number
  unit_price_gross: number
  gross_amount: number
  discount_amount: number
  net_amount: number
}

/** Gün sonu — bekleyen iade kalemlerini tek faturada birleştir */
export async function sendBatchReturnInvoice(companyId: string): Promise<void> {
  const ops = await window.electron.db.getPendingReturnInvoices(companyId)
  if (!ops.length) return

  const allItems: ReturnInvoiceItem[] = []
  let totalCard = 0
  let totalCash = 0

  for (const op of ops) {
    const payload = JSON.parse(op.payload) as {
      items?:       ReturnInvoiceItem[]
      cash_amount?: number
      card_amount?: number
    }
    if (Array.isArray(payload.items)) {
      allItems.push(...payload.items)
    }
    totalCash += payload.cash_amount ?? 0
    totalCard += payload.card_amount ?? 0
  }

  if (!allItems.length) return

  const settings    = await window.electron.db.getTerminalSettings()
  const invoiceType: 'e_archive' | 'paper' =
    settings?.invoiceType === 'paper' ? 'paper' : 'e_archive'
  const dateLabel = new Date().toLocaleDateString('tr-TR')

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'return_invoice',
    status:    'pending',
    payload: await withTerminalPayment({
      sale_id:         `TOPLU-IADE-${dateLabel.replace(/\./g, '')}`,
      customer_ref:    customerRefTorba(),
      items:           allItems,
      invoice_date:    new Date().toISOString().replace('T', ' ').slice(0, 19),
      description:     `Toplu İade — ${dateLabel}`,
      invoice_type:    invoiceType,
      cash_amount:     totalCash,
      card_amount:     totalCard,
    }),
    label: `Toplu İade — ${dateLabel}`,
  })

  for (const op of ops) {
    await window.electron.db.markOperationDone(op.id)
  }
}

export async function sendReturnInvoice(
  companyId:   string,
  saleId:      string,
  customer:    CustomerRow | null,
  invoiceType: 'e_archive' | 'paper' = 'e_archive',
  payment?: {
    cashAmount: number
    cardAmount: number
  },
  invoiceNumber?: string,
): Promise<void> {
  const items = await window.electron.db.getSaleItems(saleId)

  const mappedItems = await Promise.all(items.map(async i => {
    const productCode = i.productCode?.trim() ?? ''
    let productId = 0
    if (productCode) {
      const fromDb = await window.electron.db.getProductIdByCode(productCode)
      productId = Number.parseInt(fromDb ?? '0', 10) || 0
    }
    const qty = Math.abs(Number(i.quantity) || 0)
    // İade: net birim fiyat (indirimli tutar müşteriye/ERP'ye)
    const netAmount = Math.abs(Number(i.netAmount ?? i.price * qty))
    const netUnit = qty > 0 ? Math.round((netAmount / qty) * 100) / 100 : Number(i.unitPriceGross ?? i.price)
    return {
      product_code: productCode,
      name:         i.productName ?? productCode,
      quantity:     qty,
      vatRate:      i.vatRate,
      unit:         i.unit ?? 'Adet',
      product_id:   productId,
      unit_code:    await window.electron.db.getUnitPavoCode(i.unit ?? 'Adet'),
      unit_price_gross: netUnit,
      gross_amount: netAmount,
      discount_amount: 0,
      net_amount: netAmount,
    }
  }))
  const expectedTotal = Math.round(
    mappedItems.reduce((s, i) => s + Number(i.net_amount), 0) * 100,
  ) / 100

  const customerRef = customer
    ? customerRefFromCustomerRow(customer)
    : customerRefTorba()
  const customerLabel = customer?.name ?? 'Torba cari'

  const payload = {
    sale_id:         saleId,
    invoice_number:  invoiceNumber,
    customer_ref:    customerRef,
    items: mappedItems,
    expected_total: expectedTotal,
    invoice_date:  new Date().toISOString().replace('T', ' ').slice(0, 19),
    description:   `POS İade — ${customerLabel}`,
    invoice_type:  invoiceType,
    cash_amount:   payment?.cashAmount ?? 0,
    card_amount:   payment?.cardAmount ?? 0,
  }

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'return_invoice',
    status:    'pending_dayend',
    payload:   await withTerminalPayment(payload),
    label:     `${customerLabel} iade faturası`,
  })
}

export async function enqueueCustomer(
  companyId: string,
  customerData: Record<string, unknown>,
  label: string,
): Promise<void> {
  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'customer',
    payload:   customerData,
    label:     `${label} cari kaydı`,
  })
}

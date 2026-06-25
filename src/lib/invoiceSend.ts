export type SendPendingInvoicesOpts = { silent?: boolean }

/** ERP fatura `customer` gövdesi — `api.sendInvoiceToErp` ile uyumlu */
function customerRowToInvoicePayload(c: CustomerRow) {
  return {
    code:       c.code       || undefined,
    name:       c.name,
    firstName:  c.firstName  || undefined,
    lastName:   c.lastName   || undefined,
    taxNo:      c.taxNo      || undefined,
    address:    c.address    || undefined,
    phone:      c.phone      || undefined,
    email:      c.email      || undefined,
    postalCode: c.postalCode || undefined,
    city:       c.city       || undefined,
    district:   c.district   || undefined,
    isPerson:   c.isPerson ?? true,
  }
}

/** Cari seçilmediğinde fatura/iade için torba cari (POS ayarlarından) */
export async function resolveTorbaCustomer(companyId: string): Promise<CustomerRow> {
  const settings = await window.electron.db.getPosSettings()
  const torbaKey = settings.torbaCariId?.trim()

  if (torbaKey) {
    const allCustomers = await window.electron.db.getCustomers(companyId)
    const found = allCustomers.find(c => c.code === torbaKey)
    if (found) return found

    return {
      id:         '',
      companyId,
      code:       torbaKey,
      name:       settings.torbaCariName ?? 'Genel Müşteri',
      phone:      '',
      taxNo:      '',
      address:    '',
      balance:    0,
      isPerson:   true,
      firstName:  '',
      lastName:   '',
      postalCode: '',
      city:       '',
      district:   '',
    }
  }

  return {
    id:         '',
    companyId,
    code:       '',
    name:       'Genel Müşteri',
    phone:      '',
    taxNo:      '',
    address:    '',
    balance:    0,
    isPerson:   true,
    firstName:  '',
    lastName:   '',
    postalCode: '',
    city:       '',
    district:   '',
  }
}

/** Gün sonu: carisiz bekleyen fişler tek ERP faturasında birleştirilir; gönderim kuyruğa yazılır */
export async function sendPendingInvoices(
  companyId: string,
  opts?: SendPendingInvoicesOpts,
): Promise<{ ok: number; fail: number }> {
  const pending = await window.electron.db.getPendingInvoices(true)
  if (pending.length === 0) return { ok: 0, fail: 0 }

  const settings = await window.electron.db.getPosSettings()
  const invoiceType: 'e_archive' | 'paper' = settings.invoiceType === 'paper' ? 'paper' : 'e_archive'
  let torbaCari: {
    code?: string
    name: string
    erp_id?: number
    taxNo?: string
    address?: string
    phone?: string
    isPerson: boolean
    firstName?: string
    lastName?: string
    postalCode?: string
    city?: string
    district?: string
  }

  const torbaKey = settings.torbaCariId?.trim()
  if (torbaKey) {
    const allCustomers = await window.electron.db.getCustomers(companyId)
    const found = allCustomers.find(c => c.code === torbaKey)
    if (found) {
      torbaCari = {
        code:       found.code || undefined,
        name:       found.name,
        erp_id:     found.id ? Number.parseInt(found.id, 10) || 0 : 0,
        taxNo:      found.taxNo || undefined,
        address:    found.address || undefined,
        phone:      found.phone || undefined,
        isPerson:   found.isPerson ?? true,
        firstName:  found.firstName || undefined,
        lastName:   found.lastName || undefined,
        postalCode: found.postalCode || undefined,
        city:       found.city || undefined,
        district:   found.district || undefined,
      }
    } else {
      torbaCari = {
        code:     torbaKey,
        name:     settings.torbaCariName ?? 'Genel Müşteri',
        isPerson: true,
      }
    }
  } else {
    torbaCari = { name: 'Genel Müşteri', isPerson: true }
  }

  const groupMap = new Map<string, {
    product_code: string
    name:         string
    quantity:     number
    price:        number
    vatRate:      number
    unit:         string
    discountRate: number
    product_id:   number
  }>()

  for (const sale of pending) {
    const items = await window.electron.db.getSaleItems(sale.id)
    for (const i of items) {
      const key = `${i.productCode}|${i.price}`
      const existing = groupMap.get(key)
      if (existing) {
        existing.quantity += i.quantity
        if (existing.product_id === 0 && i.productId) {
          existing.product_id = Number.parseInt(i.productId, 10) || 0
        }
      } else {
        groupMap.set(key, {
          product_code: i.productCode,
          name:         i.productName ?? i.productCode,
          quantity:     i.quantity,
          price:        i.price,
          vatRate:      i.vatRate ?? 0,
          unit:         i.unit ?? 'Adet',
          discountRate: i.discountRate ?? 0,
          product_id:   i.productId ? Number.parseInt(i.productId, 10) || 0 : 0,
        })
      }
    }
  }

  const allItems = Array.from(groupMap.values())

  const now = new Date()
  const saatStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const tarihStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  type DayEndLineItem = {
    product_code: string
    name:         string
    quantity:     number
    price:        number
    vatRate:      number
    unit:         string
    discountRate: number
    product_id:   number
    unit_code?:   string
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
        const key = `${item.product_code}|${item.price}`
        const existing = returnItems.find(r =>
          `${r.product_code}|${r.price}` === key,
        )
        if (existing) {
          existing.quantity += item.quantity
        } else {
          returnItems.push({ ...item })
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
        payload: {
          sale_id:         returnSaleId,
          customer:        torbaCari,
          customer_erp_id: Number(torbaCari.erp_id ?? 0),
          items:           returnItems,
          invoice_date:    returnDate,
          description:     returnDesc,
          invoice_type:    invoiceType,
          cash_amount:     returnCashAmt,
          card_amount:     returnCardAmt,
        },
        label: returnLabel,
      })

      for (const op of pendingReturns) {
        await window.electron.db.markOperationDone(op.id)
      }

      returnBatchCount = pendingReturns.length
      console.log(`[gün sonu] ${pendingReturns.length} iade toplandı, kuyruğa eklendi`)
    }
  }

  if (allItems.length === 0 && returnBatchCount === 0) return { ok: 0, fail: 0 }

  if (allItems.length === 0) {
    if (!opts?.silent && returnBatchCount > 0) {
      window.alert(
        `✓ Gün sonu iade kuyruğa eklendi\n${returnBatchCount} iade işlenecek\nİnternet bağlantısında otomatik gönderilecek.`,
      )
    }
    return { ok: returnBatchCount, fail: 0 }
  }

  const description = `Gün Sonu — ${tarihStr} ${saatStr} (${pending.length} fiş)`
  const invoiceDate = now.toISOString().replace('T', ' ').slice(0, 19)
  const daySaleId = 'gunsonu-' + now.toISOString().slice(0, 10)
  const endpoint = invoiceType === 'paper'
    ? `/integration/invoice-paper/${companyId}`
    : `/integration/invoice/${companyId}`
  const pendingSaleIds = pending.map(s => s.id)
  const cardByBank = await window.electron.db.getCardTotalsByBank(pendingSaleIds)
  const cashTotal = await window.electron.db.getCashTotal(pendingSaleIds)

  const payload = {
    sale_id:           daySaleId,
    day_end_sale_ids:  pending.map(s => s.id),
    customer:          torbaCari,
    customer_erp_id:   Number(torbaCari.erp_id ?? 0),
    items:             allItems,
    invoice_date:      invoiceDate,
    description,
    endpoint,
    cash_amount: cashTotal,
    card_amount: pending.reduce((sum, s) => sum + Number(s.cardAmount ?? 0), 0),
    card_acquirer_id: null as string | null,
    card_by_bank: cardByBank,
  }

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'day_end_invoice',
    payload,
    label:     `Gün Sonu ${tarihStr} (${invoiceType === 'paper' ? 'Kağıt' : 'E-Arşiv'})`,
  })

  if (!opts?.silent) {
    const parts = [`${pending.length} fiş`]
    if (returnBatchCount > 0) parts.push(`${returnBatchCount} iade`)
    window.alert(
      `✓ Gün sonu kuyruğa eklendi\n${parts.join(', ')} işlenecek\nİnternet bağlantısında otomatik gönderilecek.`,
    )
  }

  return { ok: pending.length + returnBatchCount, fail: 0 }
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
): Promise<void> {
  const endpoint = invoiceType === 'paper'
    ? `/integration/invoice-paper/${companyId}`
    : `/integration/invoice/${companyId}`

  const items = await window.electron.db.getSaleItems(saleId)
  const payload = {
    sale_id:      saleId,
    customer:     customerRowToInvoicePayload(customer),
    customer_erp_id: Number.parseInt(customer.id ?? '0', 10) || 0,
    items:        await Promise.all(items.map(async i => {
      let productId = 0
      let unitCode = 'C62'
      if (invoiceType === 'paper') {
        const product = await window.electron.db.getProductByCode(i.productCode)
        const productIdRaw = await window.electron.db.getProductIdByCode(i.productCode)
        productId = Number.parseInt(productIdRaw ?? '0', 10) || 0
        unitCode = await window.electron.db.getUnitPavoCode(product?.unit ?? 'Adet')
      }
      return {
        product_code: i.productCode,
        name:         i.productName ?? i.productCode,
        quantity:     i.quantity,
        price:        i.price,
        vatRate:      i.vatRate ?? 0,
        unit:         i.unit ?? 'Adet',
        discountRate: i.discountRate ?? 0,
        product_id:   productId,
        unit_code:    unitCode,
      }
    })),
    invoice_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    description:  `POS Satışı — ${customer.name}`,
    endpoint,
    cash_amount:      payment?.cashAmount ?? 0,
    card_amount:      payment?.cardAmount ?? 0,
    card_acquirer_id: payment?.cardAcquirerId ?? null,
    card_by_bank:     payment?.cardByBank ?? {},
  }

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'invoice',
    payload,
    label:     `${customer.name} faturası`,
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
    totalReturn: number
    invoiceType: 'e_archive' | 'paper'
    cashAmount?: number
    cardAmount?: number
    items:       QuickReturnInvoiceLine[]
  },
): Promise<void> {
  const torbaCari = await resolveTorbaCustomer(companyId)

  const returnItems = await Promise.all(opts.items.map(async item => {
    let productId = item.stockRef ?? item.productId ?? 0
    const productCode = item.productCode?.trim() ?? ''
    if (productId <= 0 && productCode) {
      const fromDb = await window.electron.db.getProductIdByCode(productCode)
      productId = Number.parseInt(fromDb ?? '0', 10) || 0
    }

    return {
      product_code: productCode,
      name:         item.productName,
      quantity:     item.quantity,
      price:        item.unitPrice,
      vatRate:      item.vatRate ?? 20,
      unit:         item.unitName ?? 'Adet',
      unit_code:    item.unitCode ?? await window.electron.db.getUnitPavoCode(item.unitName ?? 'Adet'),
      discountRate: 0,
      product_id:   productId,
    }
  }))

  const payload = {
    sale_id:         opts.receiptNo,
    customer:        customerRowToInvoicePayload(torbaCari),
    customer_erp_id: Number.parseInt(torbaCari.id ?? '0', 10) || 0,
    items:           returnItems,
    invoice_date:    new Date().toISOString().replace('T', ' ').slice(0, 19),
    description:     `İade — ${opts.receiptNo}`,
    invoice_type:    opts.invoiceType,
    cash_amount:     opts.cashAmount ?? 0,
    card_amount:     opts.cardAmount ?? opts.totalReturn,
  }

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'return_invoice',
    status:    'pending_dayend',
    payload,
    label:     `İade — ${opts.receiptNo}`,
  })
}

export interface ReturnInvoiceItem {
  product_code: string
  name:         string
  quantity:     number
  price:        number
  vatRate:      number
  unit:         string
  unit_code:    string
  discountRate: number
  product_id:   number
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

  const torbaCari   = await resolveTorbaCustomer(companyId)
  const settings    = await window.electron.db.getPosSettings()
  const invoiceType: 'e_archive' | 'paper' =
    settings?.invoiceType === 'paper' ? 'paper' : 'e_archive'
  const dateLabel = new Date().toLocaleDateString('tr-TR')

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'return_invoice',
    status:    'pending',
    payload: {
      sale_id:         `TOPLU-IADE-${dateLabel.replace(/\./g, '')}`,
      customer:        customerRowToInvoicePayload(torbaCari),
      customer_erp_id: Number.parseInt(torbaCari.id ?? '0', 10) || 0,
      items:           allItems,
      invoice_date:    new Date().toISOString().replace('T', ' ').slice(0, 19),
      description:     `Toplu İade — ${dateLabel}`,
      invoice_type:    invoiceType,
      cash_amount:     totalCash,
      card_amount:     totalCard,
    },
    label: `Toplu İade — ${dateLabel}`,
  })

  for (const op of ops) {
    await window.electron.db.markOperationDone(op.id)
  }
}

export async function sendReturnInvoice(
  companyId:   string,
  saleId:      string,
  customer:    CustomerRow,
  invoiceType: 'e_archive' | 'paper' = 'e_archive',
  payment?: {
    cashAmount: number
    cardAmount: number
  },
): Promise<void> {
  const items = await window.electron.db.getSaleItems(saleId)

  const payload = {
    sale_id:         saleId,
    customer:        customerRowToInvoicePayload(customer),
    customer_erp_id: Number.parseInt(customer.id ?? '0', 10) || 0,
    items: await Promise.all(items.map(async i => {
      const productCode = i.productCode?.trim() ?? ''
      let productId = 0
      if (productCode) {
        const fromDb = await window.electron.db.getProductIdByCode(productCode)
        productId = Number.parseInt(fromDb ?? '0', 10) || 0
      }
      return {
        product_code: productCode,
        name:         i.productName ?? productCode,
        quantity:     Math.abs(i.quantity),
        price:        i.price,
        vatRate:      i.vatRate ?? 0,
        unit:         i.unit ?? 'Adet',
        discountRate: i.discountRate ?? 0,
        product_id:   productId,
        unit_code:    await window.electron.db.getUnitPavoCode(i.unit ?? 'Adet'),
      }
    })),
    invoice_date:  new Date().toISOString().replace('T', ' ').slice(0, 19),
    description:   `POS İade — ${customer.name}`,
    invoice_type:  invoiceType,
    cash_amount:   payment?.cashAmount ?? 0,
    card_amount:   payment?.cardAmount ?? 0,
  }

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'return_invoice',
    status:    'pending_dayend',
    payload,
    label:     `${customer.name} iade faturası`,
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

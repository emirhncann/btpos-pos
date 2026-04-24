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
    postalCode: c.postalCode || undefined,
    city:       c.city       || undefined,
    district:   c.district   || undefined,
    isPerson:   c.isPerson ?? true,
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
  let invoiceType: 'e_archive' | 'paper' = 'e_archive'
  try {
    const device = await window.electron.db.getPaymentDeviceSettings('pavo')
    if (device?.isActive && device.invoiceType) {
      invoiceType = device.invoiceType
    }
  } catch {
    // default e_archive
  }
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
  if (allItems.length === 0) return { ok: 0, fail: 0 }

  const now = new Date()
  const saatStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const tarihStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const description = `Gün Sonu — ${tarihStr} ${saatStr} (${pending.length} fiş)`
  const invoiceDate = now.toISOString().replace('T', ' ').slice(0, 19)
  const daySaleId = 'gunsonu-' + now.toISOString().slice(0, 10)
  const endpoint = invoiceType === 'paper'
    ? `/integration/invoice-paper/${companyId}`
    : `/integration/invoice/${companyId}`

  const payload = {
    sale_id:           daySaleId,
    day_end_sale_ids:  pending.map(s => s.id),
    customer:          torbaCari,
    items:             allItems,
    invoice_date:      invoiceDate,
    description,
    endpoint,
  }

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'day_end_invoice',
    payload,
    label:     `Gün Sonu ${tarihStr} (${invoiceType === 'paper' ? 'Kağıt' : 'E-Arşiv'})`,
  })

  if (!opts?.silent) {
    window.alert(
      `✓ Gün sonu kuyruğa eklendi\n${pending.length} fiş işlenecek\nİnternet bağlantısında otomatik gönderilecek.`,
    )
  }

  return { ok: pending.length, fail: 0 }
}

/** Cari seçili satış sonrası fatura — kuyruğa yazılır */
export async function sendInvoiceForSale(
  companyId: string,
  saleId: string,
  customer: CustomerRow,
  invoiceType: 'e_archive' | 'paper' = 'e_archive',
): Promise<void> {
  const endpoint = invoiceType === 'paper'
    ? `/integration/invoice-paper/${companyId}`
    : `/integration/invoice/${companyId}`

  const items = await window.electron.db.getSaleItems(saleId)
  const payload = {
    sale_id:      saleId,
    customer:     customerRowToInvoicePayload(customer),
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
  }

  await window.electron.db.enqueueOperation({
    id:        crypto.randomUUID(),
    companyId,
    type:      'invoice',
    payload,
    label:     `${customer.name} faturası`,
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

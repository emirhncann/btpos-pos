import { api } from './api'

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

/** Gün sonu: carisiz bekleyen fişlerin tümünü tek ERP faturasında birleştirir */
export async function sendPendingInvoices(
  companyId: string,
  opts?: SendPendingInvoicesOpts,
): Promise<{ ok: number; fail: number }> {
  const pending = await window.electron.db.getPendingInvoices(true)
  if (pending.length === 0) return { ok: 0, fail: 0 }

  const settings = await window.electron.db.getPosSettings()
  let torbaCari: {
    code?: string
    name: string
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
  }>()

  for (const sale of pending) {
    const items = await window.electron.db.getSaleItems(sale.id)
    for (const i of items) {
      const key = `${i.productCode}|${i.price}`
      const existing = groupMap.get(key)
      if (existing) {
        existing.quantity += i.quantity
      } else {
        groupMap.set(key, {
          product_code: i.productCode,
          name:         i.productName ?? i.productCode,
          quantity:     i.quantity,
          price:        i.price,
          vatRate:      i.vatRate ?? 0,
          unit:         i.unit ?? 'Adet',
          discountRate: i.discountRate ?? 0,
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

  try {
    const result = await api.sendInvoiceToErp(companyId, {
      sale_id:      'gunsonu-' + now.toISOString().slice(0, 10),
      customer:     torbaCari,
      items:        allItems,
      invoice_date: invoiceDate,
      description,
    })

    if (result.success && result.invoice_id) {
      for (const sale of pending) {
        await window.electron.db.markInvoiceSent(sale.id, result.invoice_id)
      }
      if (!opts?.silent) {
        window.alert(`✓ Gün sonu faturası gönderildi\n${pending.length} fiş → 1 fatura\nFatura No: ${result.invoice_id}`)
      }
      return { ok: pending.length, fail: 0 }
    } else {
      for (const sale of pending) {
        await window.electron.db.markInvoiceError(sale.id, result.message ?? 'Gün sonu hatası')
      }
      if (!opts?.silent) {
        window.alert(`✗ Gün sonu faturası gönderilemedi\n${result.message}`)
      }
      return { ok: 0, fail: pending.length }
    }
  } catch (e) {
    for (const sale of pending) {
      await window.electron.db.markInvoiceError(sale.id, String(e))
    }
    if (!opts?.silent) {
      window.alert(`✗ Bağlantı hatası: ${String(e)}`)
    }
    return { ok: 0, fail: pending.length }
  }
}

/** Cari seçili satış sonrası anında fatura */
export async function sendInvoiceForSale(
  companyId: string,
  saleId: string,
  customer: CustomerRow,
): Promise<void> {
  try {
    const items = await window.electron.db.getSaleItems(saleId)
    const result = await api.sendInvoiceToErp(companyId, {
      sale_id: saleId,
      customer: customerRowToInvoicePayload(customer),
      items: items.map(i => ({
        product_code: i.productCode,
        name:         i.productName ?? i.productCode,
        quantity:     i.quantity,
        price:        i.price,
        vatRate:      i.vatRate ?? 0,
        unit:         i.unit ?? 'Adet',
        discountRate: i.discountRate ?? 0,
      })),
      invoice_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
      description:  `POS Satışı — ${customer.name}`,
    })

    if (result.success && result.invoice_id) {
      await window.electron.db.markInvoiceSent(saleId, result.invoice_id)
    } else {
      await window.electron.db.markInvoiceError(saleId, result.message ?? 'Bilinmeyen hata')
    }
  } catch (e) {
    await window.electron.db.markInvoiceError(saleId, String(e))
  }
}

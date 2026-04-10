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

/** Torba cari: ayarlardaki ID ile `customers` tablosundan kayıt; yoksa eski kod/isim fallback */
async function resolveTorbaInvoiceCustomer(
  companyId: string,
  settings: PosSettingsRow,
): Promise<ReturnType<typeof customerRowToInvoicePayload>> {
  const torbaId = settings.torbaCariId?.trim()
  if (!torbaId) {
    return {
      code:       undefined,
      name:       'Genel Müşteri',
      firstName:  undefined,
      lastName:   undefined,
      taxNo:      undefined,
      address:    undefined,
      phone:      undefined,
      postalCode: undefined,
      city:       undefined,
      district:   undefined,
      isPerson:   true,
    }
  }

  const row = await window.electron.db.getCustomerById(companyId, torbaId)
  if (row) return customerRowToInvoicePayload(row)

  return {
    code:       torbaId,
    name:       settings.torbaCariName ?? 'Genel Müşteri',
    firstName:  undefined,
    lastName:   undefined,
    taxNo:      undefined,
    address:    undefined,
    phone:      undefined,
    postalCode: undefined,
    city:       undefined,
    district:   undefined,
    isPerson:   true,
  }
}

/** Z raporu / toplu: bekleyen veya hatalı faturaları ERP’ye gönderir */
export async function sendPendingInvoices(
  companyId: string,
  opts?: SendPendingInvoicesOpts,
): Promise<{ ok: number; fail: number }> {
  const pending = await window.electron.db.getPendingInvoices()
  if (pending.length === 0) return { ok: 0, fail: 0 }

  const settings = await window.electron.db.getPosSettings()
  const torbaCustomer = await resolveTorbaInvoiceCustomer(companyId, settings)

  let ok = 0
  let fail = 0
  for (const sale of pending) {
    try {
      const items = await window.electron.db.getSaleItems(sale.id)
      let customer: ReturnType<typeof customerRowToInvoicePayload>
      if (sale.customerId) {
        const row = await window.electron.db.getCustomerById(companyId, sale.customerId)
        customer = row
          ? customerRowToInvoicePayload(row)
          : {
              code:       sale.customerCode ?? undefined,
              name:       sale.customerName ?? '',
              firstName:  undefined,
              lastName:   undefined,
              taxNo:      undefined,
              address:    undefined,
              phone:      undefined,
              postalCode: undefined,
              city:       undefined,
              district:   undefined,
              isPerson:   true,
            }
      } else {
        customer = torbaCustomer
      }

      const result = await api.sendInvoiceToErp(companyId, {
        sale_id: sale.id,
        customer,
        items: items.map(i => ({
          product_code: i.productCode,
          name:         i.productName ?? i.productCode,
          quantity:     i.quantity,
          price:        i.price,
          vatRate:      i.vatRate ?? 0,
          unit:         i.unit ?? 'Adet',
        })),
        invoice_date: sale.createdAt.replace('T', ' ').slice(0, 19),
        description: sale.customerId
          ? `POS Satışı — ${sale.customerName ?? ''}`
          : 'Z Raporu Toplu Satış',
      })

      if (result.success && result.invoice_id) {
        await window.electron.db.markInvoiceSent(sale.id, result.invoice_id)
        ok++
      } else {
        await window.electron.db.markInvoiceError(sale.id, result.message ?? 'Hata')
        fail++
      }
    } catch (e) {
      await window.electron.db.markInvoiceError(sale.id, String(e))
      fail++
    }
  }

  if (!opts?.silent && (ok > 0 || fail > 0)) {
    window.alert(`Fatura gönderimi: ${ok} başarılı, ${fail} hatalı`)
  }
  return { ok, fail }
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

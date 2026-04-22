# Sprint — Operation Queue: invoiceSend.ts Güncelleme
**Dosya:** `src/lib/invoiceSend.ts`

## Değişiklik — direkt göndermek yerine queue'ya ekle

### `sendInvoiceForSale` — queue'ya yaz

```ts
import { v4 as uuidv4 } from 'uuid'

export async function sendInvoiceForSale(
  companyId: string,
  saleId:    string,
  customer:  CustomerRow,
): Promise<void> {
  const items = await window.electron.db.getSaleItems(saleId)
  const payload = {
    sale_id:      saleId,
    customer:     customerRowToInvoicePayload(customer),
    items:        items.map(i => ({
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
  }

  await window.electron.db.enqueueOperation({
    id:        uuidv4(),
    companyId,
    type:      'invoice',
    payload,
    label:     `${customer.name} faturası`,
  })
}
```

### `sendPendingInvoices` — gün sonu queue'ya yaz

```ts
export async function sendPendingInvoices(
  companyId: string,
  opts?: SendPendingInvoicesOpts,
): Promise<{ ok: number; fail: number }> {
  const pending = await window.electron.db.getPendingInvoices(true)
  if (pending.length === 0) return { ok: 0, fail: 0 }

  // ... mevcut torbaCari ve groupMap mantığı aynı kalır ...

  const now = new Date()
  const saatStr  = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const tarihStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const description  = `Gün Sonu — ${tarihStr} ${saatStr} (${pending.length} fiş)`
  const invoiceDate  = now.toISOString().replace('T', ' ').slice(0, 19)
  const daySaleId    = 'gunsonu-' + now.toISOString().slice(0, 10)

  const payload = {
    sale_id:      daySaleId,
    customer:     torbaCari,
    items:        allItems,
    invoice_date: invoiceDate,
    description,
  }

  await window.electron.db.enqueueOperation({
    id:        uuidv4(),
    companyId,
    type:      'day_end_invoice',
    payload,
    label:     `Gün Sonu ${tarihStr}`,
  })

  if (!opts?.silent) {
    window.alert(`✓ Gün sonu kuyruğa eklendi\n${pending.length} fiş işlenecek\nİnternet bağlantısında otomatik gönderilecek.`)
  }

  return { ok: pending.length, fail: 0 }
}
```

### Yeni `enqueueCustomer` fonksiyonu ekle

```ts
export async function enqueueCustomer(
  companyId: string,
  customerData: Record<string, unknown>,
  label: string,
): Promise<void> {
  await window.electron.db.enqueueOperation({
    id:        uuidv4(),
    companyId,
    type:      'customer',
    payload:   customerData,
    label:     `${label} cari kaydı`,
  })
}
```

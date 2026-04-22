# Sprint — Operation Queue: POSScreen Entegrasyonu
**Dosya:** `src/screens/POSScreen.tsx`

---

## 1 — useQueueWorker hook'u bağla

```tsx
import { useQueueWorker, QueueToastPayload } from '../hooks/useQueueWorker'
import { useConnectionStatus } from '../hooks/useConnectionStatus'

// POSScreen içinde:
const isOnline = useConnectionStatus() === 'online'
const [queueToasts, setQueueToasts] = useState<(QueueToastPayload & { shownAt: number })[]>([])

const handleQueueToast = useCallback((toast: QueueToastPayload) => {
  setQueueToasts(prev => [...prev, { ...toast, shownAt: Date.now() }])
  // 4 saniye sonra temizle
  setTimeout(() => {
    setQueueToasts(prev => prev.filter(t => t.id !== toast.id))
  }, 4000)
}, [])

useQueueWorker({
  companyId: companyId ?? '',
  isOnline,
  onToast: handleQueueToast,
})
```

---

## 2 — Toast bildirimleri göster

Ekranın sağ üstüne ekle:

```tsx
{/* Queue Toast Bildirimleri */}
<div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999,
  display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
  {queueToasts.map(t => (
    <div key={t.id + t.shownAt} style={{
      background: t.status === 'success' ? '#E8F5E9' : '#FFEBEE',
      border: `1px solid ${t.status === 'success' ? '#A5D6A7' : '#FFCDD2'}`,
      borderRadius: 10, padding: '10px 14px',
      fontSize: 13, fontWeight: 500,
      color: t.status === 'success' ? '#2E7D32' : '#C62828',
      boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      animation: 'slideIn 0.2s ease',
    }}>
      <div>{t.status === 'success' ? '✓' : '✗'} {t.label ?? t.type}</div>
      {t.error && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{t.error}</div>}
    </div>
  ))}
</div>
```

---

## 3 — Yeni cari eklenince SQLite'a da yaz + queue'ya ekle

`AddCustomerForm`'un `onSuccess` callback'inde:

```tsx
onSuccess={async (customer) => {
  // 1. SQLite'a hemen yaz (offline-first)
  await window.electron.db.upsertCustomer({
    id:        crypto.randomUUID(),
    companyId: companyId!,
    code:      '',
    name:      customer.name,
    phone:     customer.phone ?? '',
    taxNo:     customer.taxNo ?? '',
    address:   customer.address ?? '',
    balance:   0,
    isPerson:  customer.isPerson ?? true,
    firstName: customer.name.split(' ')[0] ?? '',
    lastName:  customer.name.split(' ').slice(1).join(' ') ?? '',
    postalCode:'',
    city:      customer.city ?? '',
    district:  customer.district ?? '',
    syncedAt:  new Date().toISOString(),
  })

  // 2. İşbaşı'na queue ile gönder
  const { enqueueCustomer } = await import('../lib/invoiceSend')
  await enqueueCustomer(companyId!, {
    isPerson:  customer.isPerson ?? true,
    name:      customer.name,
    taxNo:     customer.taxNo ?? '',
    phone:     customer.phone ?? '',
    address:   customer.address ?? '',
    city:      customer.city ?? '',
    district:  customer.district ?? '',
  }, customer.name)

  // 3. Müşteriyi direkt seç
  setSelectedCustomer({
    id:        crypto.randomUUID(),
    companyId: companyId!,
    code:      '',
    name:      customer.name,
    phone:     customer.phone ?? '',
    taxNo:     customer.taxNo ?? '',
    address:   customer.address ?? '',
    balance:   0,
    isPerson:  customer.isPerson ?? true,
    firstName: customer.name.split(' ')[0] ?? '',
    lastName:  customer.name.split(' ').slice(1).join(' ') ?? '',
    postalCode:'',
    city:      customer.city ?? '',
    district:  customer.district ?? '',
  })
  setAddCustomerModal(false)
}}
```

---

## 4 — `upsertCustomer` operations'a ekle

**Dosya:** `db/operations.ts`

```ts
export function upsertCustomer(db: BetterSqlite3.Database, row: CustomerRow) {
  db.prepare(`
    INSERT INTO customers (id, company_id, code, name, phone, tax_no, address, balance,
      is_person, first_name, last_name, postal_code, city, district, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, phone=excluded.phone, tax_no=excluded.tax_no,
      address=excluded.address, city=excluded.city, district=excluded.district,
      synced_at=excluded.synced_at
  `).run(
    row.id, row.companyId, row.code, row.name, row.phone,
    row.taxNo, row.address, row.balance,
    row.isPerson ? 1 : 0, row.firstName, row.lastName,
    row.postalCode, row.city, row.district, row.syncedAt,
  )
}
```

**IPC handler:**
```ts
ipcMain.handle('db:upsertCustomer', (_, row) => upsertCustomer(db, row))
```

**electron.d.ts:**
```ts
upsertCustomer(row: CustomerRow): Promise<void>
```

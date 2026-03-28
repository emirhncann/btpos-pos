# BTPOS — Sprint 6 / Electron
## Eksik Kalan Tüm Electron Değişiklikleri

---

## DOSYA 1 — `src/components/MessagePopup.tsx` — YENİ DOSYA

```tsx
interface Props {
  text: string
  onClose: () => void
}

export default function MessagePopup({ text, onClose }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'white', borderRadius: 16,
        padding: '36px 40px', maxWidth: 480, width: '90%',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#212121', marginBottom: 8 }}>
          Yönetici Mesajı
        </div>
        <div style={{ fontSize: 14, color: '#424242', lineHeight: 1.7, marginBottom: 28 }}>
          {text}
        </div>
        <button
          onClick={onClose}
          style={{
            background: '#1565C0', color: 'white', border: 'none',
            borderRadius: 10, padding: '12px 40px', fontSize: 14,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          Tamam, Anlaşıldı
        </button>
      </div>
    </div>
  )
}
```

---

## DOSYA 2 — `src/components/ConnectionDot.tsx` — YENİ DOSYA

```tsx
interface Props {
  status: 'online' | 'offline' | 'checking'
}

const CONFIG = {
  online:   { color: '#4CAF50', label: 'Bağlı' },
  offline:  { color: '#FF9800', label: 'Bağlantı yok' },
  checking: { color: '#9E9E9E', label: 'Kontrol ediliyor' },
}

export default function ConnectionDot({ status }: Props) {
  const cfg = CONFIG[status]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={cfg.label}>
      <div style={{
        width: 10, height: 10, borderRadius: '50%',
        background: cfg.color,
        boxShadow: status === 'online' ? `0 0 0 3px ${cfg.color}30` : 'none',
        transition: 'background 0.4s',
      }} />
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{cfg.label}</span>
    </div>
  )
}
```

---

## DOSYA 3 — `src/hooks/useConnectionStatus.ts` — YENİ DOSYA

```typescript
import { useState, useEffect, useRef } from 'react'

type Status = 'online' | 'offline' | 'checking'

export function useConnectionStatus(intervalSec: number = 30) {
  const [status, setStatus] = useState<Status>('checking')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function check() {
    setStatus('checking')
    try {
      const res = await fetch('https://api.btpos.com.tr/management/licenses/plans', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      setStatus(res.ok || res.status === 401 ? 'online' : 'offline')
    } catch {
      setStatus('offline')
    } finally {
      timerRef.current = setTimeout(check, intervalSec * 1000)
    }
  }

  useEffect(() => {
    check()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [intervalSec])

  return status
}
```

---

## DOSYA 4 — `src/hooks/useCommandPoller.ts` — YENİ DOSYA

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { api } from '../lib/api'

interface CommandHandlers {
  onSyncAll:      () => Promise<void>
  onSyncPrices:   () => Promise<void>
  onSyncCashiers: () => Promise<void>
  onLogout:       () => void
  onMessage:      (text: string, duration?: number) => void
  onRestart:      () => void
  onLock:         (reason?: string) => void
}

export function useCommandPoller(
  terminalId: string | null,
  handlers: CommandHandlers
) {
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<number>(30)
  const activeRef   = useRef(true)

  const poll = useCallback(async () => {
    if (!terminalId || !activeRef.current) return

    try {
      const res = await api.pollCommands(terminalId)

      intervalRef.current = res.poll_interval ?? 30

      if (res.is_locked) {
        handlers.onLock(res.lock_reason ?? undefined)
      }

      for (const cmd of res.commands ?? []) {
        try {
          switch (cmd.command) {
            case 'sync_all':      await handlers.onSyncAll();      break
            case 'sync_prices':   await handlers.onSyncPrices();   break
            case 'sync_cashiers': await handlers.onSyncCashiers(); break
            case 'logout':        handlers.onLogout();             break
            case 'message':
              handlers.onMessage(
                String(cmd.payload.text ?? ''),
                cmd.payload.duration ? Number(cmd.payload.duration) : undefined
              )
              break
            case 'restart': handlers.onRestart(); break
            case 'lock':    handlers.onLock(cmd.payload.reason ? String(cmd.payload.reason) : undefined); break
            default:        console.warn('Bilinmeyen komut:', cmd.command)
          }
          await api.ackCommand(cmd.target_id, 'done')
        } catch (cmdErr) {
          const errMsg = cmdErr instanceof Error ? cmdErr.message : 'Bilinmeyen hata'
          await api.ackCommand(cmd.target_id, 'failed', errMsg).catch(() => {})
        }
      }
    } catch {
      // API'ye ulaşılamazsa sessizce geç
    } finally {
      if (activeRef.current) {
        timerRef.current = setTimeout(poll, intervalRef.current * 1000)
      }
    }
  }, [terminalId])

  useEffect(() => {
    if (!terminalId) return
    activeRef.current = true
    poll()
    return () => {
      activeRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [terminalId, poll])
}
```

---

## DOSYA 5 — `src/lib/api.ts` — KOMPLE DEĞİŞTİR

```typescript
const API_URL = 'https://api.btpos.com.tr'

export const api = {

  async activate(licenseKey: string, deviceUid: string, email: string, deviceInfo: DeviceInfo) {
    const res = await fetch(`${API_URL}/management/licenses/terminals/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key:  licenseKey,
        device_uid:   deviceUid,
        email,
        device_name:  deviceInfo.device_name,
        mac_address:  deviceInfo.mac_address,
        os_info:      deviceInfo.os_info,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async checkLicense(companyId: string) {
    const res = await fetch(`${API_URL}/management/licenses/check/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getProducts(companyId: string) {
    const res = await fetch(`${API_URL}/integration/products/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getCashiers(companyId: string): Promise<CashierRow[]> {
    const res = await fetch(`${API_URL}/cashiers/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data.map((c: Record<string, unknown>) => ({
      id:          String(c.id),
      fullName:    String(c.full_name),
      cashierCode: String(c.cashier_code),
      password:    String(c.password),
      role:        String(c.role ?? 'cashier'),
      isActive:    Boolean(c.is_active ?? true),
    }))
  },

  // PLU gruplarını getir — workplace öncelikli
  async getPluGroups(companyId: string, workplaceId?: string | null): Promise<PluGroup[]> {
    const url = workplaceId
      ? `${API_URL}/workplaces/${workplaceId}/plu`
      : `${API_URL}/plu/groups/${companyId}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? data : []
  },

  // Komutları dinle (poll)
  async pollCommands(terminalId: string) {
    const res = await fetch(`${API_URL}/pos/commands/poll/${terminalId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<{
      success:       boolean
      poll_interval: number
      is_locked:     boolean
      lock_reason:   string | null
      commands: Array<{
        target_id:  string
        command_id: string
        command:    string
        payload:    Record<string, unknown>
        created_at: string
      }>
    }>
  },

  // Komutu tamamlandı/hata olarak işaretle
  async ackCommand(targetId: string, status: 'done' | 'failed', error?: string) {
    const res = await fetch(`${API_URL}/pos/commands/ack/${targetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, error }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getDailySummary(companyId: string, date?: string) {
    const query = date ? `?date=${date}` : ''
    const res   = await fetch(`${API_URL}/pos/sales/summary/${companyId}${query}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
}
```

---

## DOSYA 6 — `src/electron.d.ts` — KOMPLE DEĞİŞTİR

```typescript
export {}

declare global {
  interface Window {
    electron: {
      store: {
        get: (key: string) => Promise<unknown>
        set: (key: string, value: unknown) => Promise<void>
      }
      device: {
        uid:  () => Promise<string>
        info: () => Promise<DeviceInfo>
      }
      app: {
        version: () => Promise<string>
        restart: () => Promise<void>
      }
      db: {
        saveProducts:  (products: unknown[]) => Promise<number>
        getProducts:   () => Promise<ProductRow[]>
        saveSale:      (sale: SaleRow, items: SaleItem[]) => Promise<string>
        getSales:      (dateFrom?: string, dateTo?: string) => Promise<SaleRecord[]>
        saveCashiers:  (cashiers: unknown[]) => Promise<number>
        verifyCashier: (code: string, password: string) => Promise<CashierRow | null>
        getCashiers:   () => Promise<CashierRow[]>
      }
    }
  }

  interface DeviceInfo {
    device_name: string
    mac_address: string
    os_info:     string
    device_uid:  string
  }

  interface PluGroup {
    id:         string
    name:       string
    color:      string
    sort_order: number
    is_active:  boolean
    plu_items:  Array<{ id: string; product_code: string; sort_order: number }>
  }

  interface CashierRow {
    id:          string
    fullName:    string
    cashierCode: string
    password:    string
    role:        string
    isActive:    boolean
  }

  interface ProductRow {
    id:        string
    code?:     string
    name:      string
    barcode?:  string
    price:     number
    vatRate:   number
    unit:      string
    stock:     number
    category?: string
    syncedAt?: string
  }

  interface SaleItem {
    productId?:  string
    productName: string
    quantity:    number
    unitPrice:   number
    vatRate:     number
    lineTotal:   number
  }

  interface SaleRow {
    receiptNo:   string
    totalAmount: number
    paymentType: 'cash' | 'card' | 'mixed'
    cashAmount:  number
    cardAmount:  number
  }

  interface SaleRecord {
    id:          string
    receiptNo:   string
    totalAmount: number
    paymentType: string
    createdAt:   string
  }
}
```

---

## DOSYA 7 — `src/screens/DashboardScreen.tsx` — KOMPLE DEĞİŞTİR

```tsx
import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useCommandPoller } from '../hooks/useCommandPoller'

interface Props {
  companyId:     string
  cashier:       CashierRow
  terminalId:    string
  onStartSale:   () => void
  onLogout:      () => void
  onShowMessage: (text: string) => void
}

interface DailySummary {
  saleCount:   number
  totalSales:  number
  totalCash:   number
  totalCard:   number
}

export default function DashboardScreen({
  companyId, cashier, terminalId,
  onStartSale, onLogout, onShowMessage,
}: Props) {
  const [summary, setSummary]   = useState<DailySummary>({ saleCount: 0, totalSales: 0, totalCash: 0, totalCard: 0 })
  const [time, setTime]         = useState(new Date())
  const [syncing, setSyncing]   = useState(false)
  const [locked, setLocked]     = useState(false)
  const [lockReason, setLockReason] = useState<string | null>(null)

  useEffect(() => {
    loadDailySummary()
    const tick = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(tick)
  }, [])

  async function loadDailySummary() {
    try {
      const today = new Date().toISOString().split('T')[0]
      const sales = await window.electron.db.getSales(
        today + 'T00:00:00',
        today + 'T23:59:59'
      )
      const totalSales = sales.reduce((s, r) => s + r.totalAmount, 0)
      const totalCash  = sales.filter(r => r.paymentType === 'cash').reduce((s, r) => s + r.totalAmount, 0)
      const totalCard  = sales.filter(r => r.paymentType === 'card').reduce((s, r) => s + r.totalAmount, 0)
      setSummary({ saleCount: sales.length, totalSales, totalCash, totalCard })
    } catch {}
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const data    = await api.getProducts(companyId)
      const rawList = data?.data?.data ?? []
      const items: ProductRow[] = rawList.map((p: Record<string, unknown>) => {
        const cat = p.category as Record<string, unknown> | null
        return {
          id:       String(p.id ?? ''),
          code:     String(p.code ?? ''),
          name:     String(p.name ?? ''),
          barcode:  String(p.barcode ?? ''),
          price:    Number(p.salesPriceTaxIncluded ?? 0),
          vatRate:  Number(p.vatRate ?? 20),
          unit:     String(p.mainUnitName ?? 'Adet'),
          stock:    Number(p.stock ?? 0),
          category: String(cat?.name ?? 'Diğer'),
        }
      })
      await window.electron.db.saveProducts(items)
    } catch {}
    finally { setSyncing(false) }
  }

  useCommandPoller(terminalId, {
    onSyncAll: async () => {
      setSyncing(true)
      try {
        const data    = await api.getProducts(companyId)
        const rawList = data?.data?.data ?? []
        const items: ProductRow[] = rawList.map((p: Record<string, unknown>) => {
          const cat = p.category as Record<string, unknown> | null
          return {
            id:       String(p.id ?? ''),
            code:     String(p.code ?? ''),
            name:     String(p.name ?? ''),
            barcode:  String(p.barcode ?? ''),
            price:    Number(p.salesPriceTaxIncluded ?? 0),
            vatRate:  Number(p.vatRate ?? 20),
            unit:     String(p.mainUnitName ?? 'Adet'),
            stock:    Number(p.stock ?? 0),
            category: String(cat?.name ?? 'Diğer'),
          }
        })
        await window.electron.db.saveProducts(items)
      } finally { setSyncing(false) }
    },

    onSyncPrices: async () => {
      const data    = await api.getProducts(companyId)
      const rawList = data?.data?.data ?? []
      const local   = await window.electron.db.getProducts()
      const localMap = new Map(local.map(p => [p.id, p]))
      const changed = rawList
        .filter((p: Record<string, unknown>) => {
          const lp = localMap.get(String(p.id))
          return lp && lp.price !== Number(p.salesPriceTaxIncluded ?? 0)
        })
        .map((p: Record<string, unknown>) => {
          const cat = p.category as Record<string, unknown> | null
          return {
            id: String(p.id), code: String(p.code ?? ''), name: String(p.name ?? ''),
            barcode: String(p.barcode ?? ''), price: Number(p.salesPriceTaxIncluded ?? 0),
            vatRate: Number(p.vatRate ?? 20), unit: String(p.mainUnitName ?? 'Adet'),
            stock: Number(p.stock ?? 0), category: String(cat?.name ?? 'Diğer'),
          }
        })
      if (changed.length > 0) {
        const all = local.map(lp => changed.find((c: ProductRow) => c.id === lp.id) ?? lp)
        await window.electron.db.saveProducts(all)
      }
    },

    onSyncCashiers: async () => {
      const cashiers = await api.getCashiers(companyId)
      await window.electron.db.saveCashiers(cashiers)
    },

    onLogout: () => onLogout(),

    onMessage: (text) => onShowMessage(text),

    onRestart: () => window.electron.app.restart(),

    onLock: (reason) => {
      setLocked(true)
      setLockReason(reason ?? null)
    },
  })

  const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Kilit ekranı
  if (locked) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1A237E', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <div style={{ fontSize: 64 }}>🔒</div>
        <div style={{ color: 'white', fontSize: 24, fontWeight: 600 }}>Kasa Kilitli</div>
        {lockReason && <div style={{ color: '#90CAF9', fontSize: 15 }}>{lockReason}</div>}
        <div style={{ color: '#5C6BC0', fontSize: 13, marginTop: 8 }}>Yöneticinizle iletişime geçin</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F0F2F5' }}>

      {/* Header */}
      <div style={{ background: '#1565C0', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: 'white', fontWeight: 700, fontSize: 18 }}>BT<span style={{ color: '#90CAF9' }}>POS</span></span>
          <span style={{ color: '#90CAF9', fontSize: 13 }}>Hoş geldiniz</span>
        </div>
        <span style={{ color: '#BBDEFB', fontSize: 13 }}>
          {time.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
          {' — '}
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </span>
      </div>

      {/* Ana içerik */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, padding: 40 }}>

        {/* Kasiyer kartı */}
        <div style={{ background: 'white', borderRadius: 16, padding: '24px 40px', textAlign: 'center', border: '1px solid #E0E0E0', minWidth: 320 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#E3F2FD', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 28, fontWeight: 600, color: '#1565C0' }}>
            {cashier.fullName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#212121' }}>{cashier.fullName}</div>
          <div style={{ fontSize: 13, color: '#9E9E9E', marginTop: 4 }}>
            Kod: {cashier.cashierCode} · {cashier.role === 'manager' ? 'Yönetici' : 'Kasiyer'}
          </div>
        </div>

        {/* Günlük özet */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 160px)', gap: 16 }}>
          {[
            { label: 'Satış Sayısı', value: String(summary.saleCount), unit: 'adet', color: '#1565C0', bg: '#E3F2FD' },
            { label: 'Günlük Ciro',  value: fmt(summary.totalSales),   unit: '₺',    color: '#2E7D32', bg: '#E8F5E9' },
            { label: 'Nakit',        value: fmt(summary.totalCash),    unit: '₺',    color: '#E65100', bg: '#FFF8E1' },
            { label: 'Kart',         value: fmt(summary.totalCard),    unit: '₺',    color: '#6A1B9A', bg: '#F3E5F5' },
          ].map(card => (
            <div key={card.label} style={{ background: card.bg, borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: card.color, marginBottom: 6, fontWeight: 500 }}>{card.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: card.color }}>{card.value}</div>
              <div style={{ fontSize: 11, color: card.color, marginTop: 2 }}>{card.unit}</div>
            </div>
          ))}
        </div>

        {/* Butonlar */}
        <div style={{ display: 'flex', gap: 20 }}>
          <button
            onClick={onStartSale}
            style={{ background: '#1565C0', color: 'white', border: 'none', borderRadius: 16, cursor: 'pointer', width: 280, height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 22, fontWeight: 600 }}
          >
            <span style={{ fontSize: 36 }}>🛒</span>
            <span>Satış Başlat</span>
          </button>

          <button
            onClick={handleSync}
            disabled={syncing}
            style={{ background: 'white', color: '#424242', border: '1px solid #E0E0E0', borderRadius: 16, cursor: syncing ? 'default' : 'pointer', width: 160, height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 500, opacity: syncing ? 0.6 : 1 }}
          >
            <span style={{ fontSize: 28 }}>🔄</span>
            <span>{syncing ? 'Güncelleniyor...' : 'Ürünleri Güncelle'}</span>
          </button>

          <button
            onClick={onLogout}
            style={{ background: 'white', color: '#C62828', border: '1px solid #FFCDD2', borderRadius: 16, cursor: 'pointer', width: 160, height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}
          >
            <span style={{ fontSize: 28 }}>🚪</span>
            <span>Kasiyer Çıkışı</span>
          </button>
        </div>
      </div>
    </div>
  )
}
```

---

## DOSYA 8 — `src/screens/POSScreen.tsx` — KOMPLE DEĞİŞTİR

```tsx
import { useState, useEffect, useRef } from 'react'
import { useLicenseCheck } from '../hooks/useLicenseCheck'
import { useConnectionStatus } from '../hooks/useConnectionStatus'
import LicenseBanner from '../components/LicenseBanner'
import ConnectionDot from '../components/ConnectionDot'
import { api } from '../lib/api'

interface CartItem {
  id:        string
  code:      string
  name:      string
  category:  string
  price:     number
  vatRate:   number
  unit:      string
  quantity:  number
  lineTotal: number
}

interface Props {
  companyId:        string
  cashier:          CashierRow
  allProducts:      ProductRow[]
  onBack:           () => void
  onLogout:         () => void
  pollIntervalSec?: number
  pendingMessage?:  { text: string } | null
  onMessageClose?:  () => void
}

const fmtMoney = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let receiptCounter = parseInt(localStorage.getItem('btpos_receipt') || '1000')
function nextReceiptNo(): string {
  receiptCounter++
  localStorage.setItem('btpos_receipt', String(receiptCounter))
  return `FIS-${String(receiptCounter).padStart(5, '0')}`
}

export default function POSScreen({
  companyId, cashier, allProducts,
  onBack, onLogout,
  pollIntervalSec = 30,
  pendingMessage, onMessageClose,
}: Props) {
  const [cart, setCart]                   = useState<CartItem[]>([])
  const [search, setSearch]               = useState('')
  const [numBuffer, setNumBuffer]         = useState('')
  const [activeGroup, setActiveGroup]     = useState<string | null>(null)
  const [pluGroups, setPluGroups]         = useState<PluGroup[]>([])
  const [page, setPage]                   = useState(0)
  const [paymentMode, setPaymentMode]     = useState(false)
  const [paymentType, setPaymentType]     = useState<'cash' | 'card' | 'mixed'>('cash')
  const [cashInput, setCashInput]         = useState('')
  const [saving, setSaving]               = useState(false)
  const [lastReceipt, setLastReceipt]     = useState<string | null>(null)
  const [confirmClear, setConfirmClear]   = useState(false)
  const [selectedItem, setSelectedItem]   = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const searchRef  = useRef<HTMLInputElement>(null)
  const license    = useLicenseCheck(companyId)
  const connStatus = useConnectionStatus(pollIntervalSec)

  const ITEMS_PER_PAGE = 25

  // PLU gruplarını yükle
  useEffect(() => {
    const workplaceId = localStorage.getItem('workplace_id') || null
    api.getPluGroups(companyId, workplaceId)
      .then(groups => {
        setPluGroups(groups)
        if (groups.length > 0) setActiveGroup(groups[0].id)
      })
      .catch(() => {})
  }, [companyId])

  // Aktif gruba göre ürün listesi
  const groupProducts = (() => {
    if (!activeGroup) return allProducts
    const group = pluGroups.find(g => g.id === activeGroup)
    if (!group || !group.plu_items?.length) return []
    const ordered = group.plu_items
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(item => allProducts.find(p => p.code === item.product_code))
      .filter(Boolean) as ProductRow[]
    return ordered
  })()

  const filtered   = search
    ? allProducts.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.code ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (p.barcode ?? '').includes(search)
      )
    : groupProducts

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated  = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE)

  useEffect(() => { setPage(0) }, [activeGroup, search])
  useEffect(() => { searchRef.current?.focus() }, [])

  // Barkod okuyucu
  useEffect(() => {
    if (search.length < 2) return
    const t = setTimeout(() => {
      const byBarcode = allProducts.find(p => p.barcode === search)
      if (byBarcode) {
        const qty = numBuffer ? Math.max(1, parseInt(numBuffer)) : 1
        setNumBuffer('')
        addToCartWithQty(byBarcode, qty)
        setSearch('')
      }
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  function addToCartWithQty(product: ProductRow, qty: number = 1) {
    setCart(prev => {
      const ex = prev.find(c => c.id === product.id)
      if (ex) {
        return prev.map(c => c.id === product.id
          ? { ...c, quantity: c.quantity + qty, lineTotal: (c.quantity + qty) * c.price }
          : c
        )
      }
      return [...prev, {
        id: product.id, code: product.code ?? '', name: product.name,
        category: product.category ?? '', price: product.price,
        vatRate: product.vatRate ?? 18, unit: product.unit ?? 'Adet',
        quantity: qty, lineTotal: product.price * qty,
      }]
    })
  }

  function handleProductClick(product: ProductRow) {
    const qty = numBuffer ? Math.max(1, parseInt(numBuffer)) : 1
    setNumBuffer('')
    addToCartWithQty(product, qty)
    searchRef.current?.focus()
  }

  function handleNumKey(key: string) {
    if (key === 'C')  { setNumBuffer(''); return }
    if (key === '⌫') { setNumBuffer(p => p.slice(0, -1)); return }
    if (numBuffer.length < 4) setNumBuffer(p => p + key)
  }

  function updateQty(id: string, delta: number) {
    setCart(prev => prev
      .map(c => c.id === id
        ? { ...c, quantity: c.quantity + delta, lineTotal: (c.quantity + delta) * c.price }
        : c
      )
      .filter(c => c.quantity > 0)
    )
  }

  function requestDelete(id: string) {
    setSelectedItem(id)
    setConfirmDelete(true)
  }

  function confirmDeleteItem() {
    if (selectedItem) setCart(prev => prev.filter(c => c.id !== selectedItem))
    setSelectedItem(null)
    setConfirmDelete(false)
  }

  function clearCart() {
    setCart([])
    setPaymentMode(false)
    setCashInput('')
    setPaymentType('cash')
    setConfirmClear(false)
    setNumBuffer('')
  }

  const subTotal   = cart.reduce((s, c) => s + c.lineTotal, 0)
  const vatTotal   = cart.reduce((s, c) => s + (c.lineTotal * c.vatRate / (100 + c.vatRate)), 0)
  const grandTotal = subTotal
  const cashAmount = parseFloat(cashInput) || 0
  const change     = cashAmount - grandTotal

  async function completeSale() {
    if (cart.length === 0) return
    setSaving(true)
    try {
      const receiptNo = nextReceiptNo()
      const saleData: SaleRow = {
        receiptNo,
        totalAmount: grandTotal,
        paymentType,
        cashAmount: paymentType === 'card'  ? 0 : (paymentType === 'cash' ? cashAmount || grandTotal : cashAmount),
        cardAmount: paymentType === 'cash'  ? 0 : (paymentType === 'card' ? grandTotal : grandTotal - cashAmount),
      }
      const items: SaleItem[] = cart.map(c => ({
        productId: c.id, productName: c.name, quantity: c.quantity,
        unitPrice: c.price, vatRate: c.vatRate, lineTotal: c.lineTotal,
      }))
      await window.electron.db.saveSale(saleData, items)
      setLastReceipt(receiptNo)
      clearCart()
      searchRef.current?.focus()
    } catch (e) {
      alert('Satış kaydedilemedi: ' + (e instanceof Error ? e.message : 'Hata'))
    } finally {
      setSaving(false)
    }
  }

  const activeGroupColor = pluGroups.find(g => g.id === activeGroup)?.color ?? '#1565C0'

  const listItem = (p: ProductRow) => (
    <div
      key={p.id}
      onClick={() => handleProductClick(p)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', border: '1px solid #F0F0F0', borderRadius: 8, padding: '8px 12px', marginBottom: 4, cursor: 'pointer' }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = activeGroupColor; el.style.background = activeGroupColor + '10' }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = '#F0F0F0'; el.style.background = 'white' }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#212121', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{p.name}</div>
        <div style={{ fontSize: 10, color: '#BDBDBD', marginTop: 1 }}>{p.code}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: activeGroupColor, flexShrink: 0, marginLeft: 8 }}>
        {fmtMoney(p.price)} ₺
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F0F2F5', overflow: 'hidden' }}>

      {license?.warning && <LicenseBanner daysLeft={license.daysLeft} planName={license.planName} />}

      {/* Mesaj popup */}
      {pendingMessage && onMessageClose && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 16, padding: '36px 40px', maxWidth: 480, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#212121', marginBottom: 8 }}>Yönetici Mesajı</div>
            <div style={{ fontSize: 14, color: '#424242', lineHeight: 1.7, marginBottom: 28 }}>{pendingMessage.text}</div>
            <button onClick={onMessageClose} style={{ background: '#1565C0', color: 'white', border: 'none', borderRadius: 10, padding: '12px 40px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Tamam, Anlaşıldı
            </button>
          </div>
        </div>
      )}

      {/* Sepet temizleme onayı */}
      {confirmClear && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 14, padding: '32px 36px', textAlign: 'center', maxWidth: 360 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🗑️</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#212121', marginBottom: 8 }}>Sepeti Temizle</div>
            <div style={{ fontSize: 13, color: '#757575', marginBottom: 24 }}>Sepetteki {cart.length} kalem silinecek. Emin misiniz?</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmClear(false)} style={{ flex: 1, background: '#F5F5F5', border: '1px solid #E0E0E0', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13 }}>İptal</button>
              <button onClick={clearCart} style={{ flex: 1, background: '#C62828', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'white' }}>Evet, Temizle</button>
            </div>
          </div>
        </div>
      )}

      {/* Kalem silme onayı */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 14, padding: '28px 32px', textAlign: 'center', maxWidth: 320 }}>
            <div style={{ fontSize: 13, color: '#424242', marginBottom: 20 }}>
              <strong>{cart.find(c => c.id === selectedItem)?.name}</strong> sepetten kaldırılsın mı?
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setConfirmDelete(false); setSelectedItem(null) }} style={{ flex: 1, background: '#F5F5F5', border: '1px solid #E0E0E0', borderRadius: 8, padding: '9px', cursor: 'pointer', fontSize: 13 }}>İptal</button>
              <button onClick={confirmDeleteItem} style={{ flex: 1, background: '#C62828', border: 'none', borderRadius: 8, padding: '9px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'white' }}>Kaldır</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: '#1565C0', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>BT<span style={{ color: '#90CAF9' }}>POS</span></span>
          <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, color: 'white', padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>← Dashboard</button>
          {lastReceipt && (
            <span style={{ background: '#E8F5E9', color: '#2E7D32', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 500 }}>✓ {lastReceipt}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ConnectionDot status={connStatus} />
          <span style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 10px', color: '#BBDEFB', fontSize: 12 }}>{cashier.fullName}</span>
          <button onClick={onLogout} style={{ background: 'rgba(198,40,40,0.3)', border: 'none', borderRadius: 6, color: 'white', padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>Çıkış</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* SOL — PLU / Arama */}
        <div style={{ width: 420, display: 'flex', flexDirection: 'column', background: '#F0F2F5', flexShrink: 0 }}>

          {/* Arama */}
          <div style={{ padding: '10px 10px 6px' }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
              placeholder={numBuffer ? `${numBuffer} adet × barkod okut veya ara...` : 'Barkod okut veya ara...'}
              style={{
                width: '100%', background: numBuffer ? '#FFF8E1' : 'white',
                border: `1px solid ${numBuffer ? '#FFB300' : '#E0E0E0'}`,
                borderRadius: 8, padding: '8px 14px', fontSize: 13,
                outline: 'none', boxSizing: 'border-box' as const,
              }}
            />
          </div>

          {/* PLU modu — numerik + gruplar */}
          {!search && (
            <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
              {/* Numerik tuş */}
              <div style={{ padding: '6px 6px 6px 10px', flexShrink: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 38px)', gap: 4 }}>
                  {['7','8','9','4','5','6','1','2','3','C','0','⌫'].map(k => (
                    <button key={k} onClick={() => handleNumKey(k)}
                      style={{ width: 38, height: 34, border: '1px solid #E0E0E0', borderRadius: 6, cursor: 'pointer', fontSize: k === '⌫' ? 11 : 13, fontWeight: 600, background: k === 'C' ? '#FFEBEE' : k === '⌫' ? '#FFF8E1' : 'white', color: k === 'C' ? '#C62828' : k === '⌫' ? '#F57F17' : '#212121' }}>
                      {k}
                    </button>
                  ))}
                </div>
                {numBuffer && (
                  <div style={{ textAlign: 'center', marginTop: 4, fontSize: 14, fontWeight: 700, color: '#F57F17' }}>× {numBuffer}</div>
                )}
              </div>

              {/* Grup sekmeleri */}
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: 150, padding: '6px 6px 6px 2px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={() => { setActiveGroup(null); setPage(0) }}
                  style={{ border: `1px solid ${!activeGroup ? '#1565C0' : '#E0E0E0'}`, background: !activeGroup ? '#E3F2FD' : 'white', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: !activeGroup ? 600 : 400, color: !activeGroup ? '#1565C0' : '#424242', textAlign: 'left' as const }}>
                  Tümü
                </button>
                {pluGroups.map(g => (
                  <button key={g.id} onClick={() => { setActiveGroup(g.id); setPage(0) }}
                    style={{ border: `1px solid ${activeGroup === g.id ? g.color : '#E0E0E0'}`, background: activeGroup === g.id ? g.color + '22' : 'white', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: activeGroup === g.id ? 600 : 400, color: activeGroup === g.id ? g.color : '#424242', textAlign: 'left' as const, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ürün listesi */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px' }}>
            {(search ? filtered : paginated).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#BDBDBD', padding: '24px 0', fontSize: 13 }}>
                {search ? 'Ürün bulunamadı' : pluGroups.length === 0 ? 'PLU grubu tanımlı değil' : 'Bu grupta ürün yok'}
              </div>
            ) : (
              (search ? filtered : paginated).map(p => listItem(p))
            )}
          </div>

          {/* Sayfalama — sadece PLU modunda */}
          {!search && (
            <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', borderTop: '1px solid #E0E0E0', flexShrink: 0 }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ background: '#F0F2F5', border: '1px solid #E0E0E0', borderRadius: 6, padding: '3px 10px', cursor: page === 0 ? 'default' : 'pointer', fontSize: 11, color: '#424242', opacity: page === 0 ? 0.4 : 1 }}>←</button>
              <span style={{ fontSize: 10, color: '#757575' }}>{page + 1}/{Math.max(1, totalPages)} · {(search ? filtered : groupProducts).length} ürün</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                style={{ background: '#F0F2F5', border: '1px solid #E0E0E0', borderRadius: 6, padding: '3px 10px', cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontSize: 11, color: '#424242', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>→</button>
            </div>
          )}
        </div>

        {/* SAĞ — Sepet */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'white', borderLeft: '1px solid #E0E0E0' }}>

          {/* Sepet header */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #F0F0F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#212121' }}>
              Sepet <span style={{ fontWeight: 400, color: '#9E9E9E', fontSize: 12 }}>({cart.length} kalem)</span>
            </span>
            {cart.length > 0 && (
              <button onClick={() => setConfirmClear(true)} style={{ background: '#FFEBEE', border: '1px solid #FFCDD2', borderRadius: 6, color: '#C62828', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
                Sepeti Temizle
              </button>
            )}
          </div>

          {/* Tablo başlığı */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 100px 110px 40px', padding: '6px 16px', background: '#F8F9FA', borderBottom: '1px solid #E0E0E0', flexShrink: 0 }}>
            {['Ürün','Adet','Birim Fiyat','Toplam',''].map((h, i) => (
              <span key={i} style={{ fontSize: 10, color: '#9E9E9E', fontWeight: 500, textAlign: i > 0 ? 'center' : 'left' as any }}>{h}</span>
            ))}
          </div>

          {/* Kalemler */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {cart.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#BDBDBD', fontSize: 14 }}>
                Sepet boş — ürün seçin veya barkod okutun
              </div>
            ) : cart.map(item => (
              <div key={item.id}
                style={{ display: 'grid', gridTemplateColumns: '1fr 130px 100px 110px 40px', padding: '10px 16px', alignItems: 'center', borderBottom: '1px solid #F5F5F5', background: selectedItem === item.id ? '#FFF8E1' : 'white', cursor: 'pointer' }}
                onClick={() => setSelectedItem(item.id === selectedItem ? null : item.id)}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#212121' }}>{item.name}</div>
                  <div style={{ fontSize: 10, color: '#BDBDBD', marginTop: 2 }}>{item.code}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <button onClick={e => { e.stopPropagation(); updateQty(item.id, -1) }}
                    style={{ width: 26, height: 26, background: '#F0F2F5', border: '1px solid #E0E0E0', borderRadius: 5, cursor: 'pointer', fontSize: 14, color: '#424242', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                  <span style={{ fontSize: 14, fontWeight: 600, minWidth: 24, textAlign: 'center', color: '#212121' }}>{item.quantity}</span>
                  <button onClick={e => { e.stopPropagation(); updateQty(item.id, 1) }}
                    style={{ width: 26, height: 26, background: '#F0F2F5', border: '1px solid #E0E0E0', borderRadius: 5, cursor: 'pointer', fontSize: 14, color: '#424242', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                </div>
                <div style={{ textAlign: 'center', fontSize: 12, color: '#757575' }}>{fmtMoney(item.price)} ₺</div>
                <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#212121' }}>{fmtMoney(item.lineTotal)} ₺</div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button onClick={e => { e.stopPropagation(); requestDelete(item.id) }}
                    style={{ width: 26, height: 26, background: '#FFEBEE', border: '1px solid #FFCDD2', borderRadius: 5, cursor: 'pointer', fontSize: 12, color: '#C62828', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Özet */}
          <div style={{ borderTop: '1px solid #E0E0E0', padding: '12px 16px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: '#9E9E9E' }}>Ara Toplam (KDV hariç)</span>
              <span style={{ fontSize: 12, color: '#424242' }}>{fmtMoney(subTotal - vatTotal)} ₺</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#9E9E9E' }}>KDV</span>
              <span style={{ fontSize: 12, color: '#424242' }}>{fmtMoney(vatTotal)} ₺</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid #E0E0E0' }}>
              <span style={{ fontSize: 17, fontWeight: 600, color: '#212121' }}>Genel Toplam</span>
              <span style={{ fontSize: 26, fontWeight: 700, color: '#1565C0' }}>{fmtMoney(grandTotal)} ₺</span>
            </div>
          </div>

          {/* Ödeme */}
          <div style={{ padding: '0 16px 12px', flexShrink: 0 }}>
            {!paymentMode ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                  { key: 'cash',  label: 'Nakit', bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7' },
                  { key: 'card',  label: 'Kart',  bg: '#E3F2FD', color: '#1565C0', border: '#90CAF9' },
                  { key: 'mixed', label: 'Karma', bg: '#FFF8E1', color: '#E65100', border: '#FFD54F' },
                ].map(btn => (
                  <button key={btn.key}
                    onClick={() => { setPaymentType(btn.key as any); if (btn.key === 'card') completeSale(); else setPaymentMode(true) }}
                    disabled={cart.length === 0}
                    style={{ background: cart.length === 0 ? '#F5F5F5' : btn.bg, color: cart.length === 0 ? '#BDBDBD' : btn.color, border: `1px solid ${cart.length === 0 ? '#E0E0E0' : btn.border}`, borderRadius: 10, padding: '12px 8px', cursor: cart.length === 0 ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                    {btn.label}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(paymentType === 'cash' || paymentType === 'mixed') && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <label style={{ fontSize: 13, color: '#757575', whiteSpace: 'nowrap' }}>
                      {paymentType === 'mixed' ? 'Nakit (₺):' : 'Alınan Nakit (₺):'}
                    </label>
                    <input type="number" value={cashInput} onChange={e => setCashInput(e.target.value)} autoFocus
                      style={{ flex: 1, border: '1px solid #90CAF9', borderRadius: 8, padding: '8px 12px', fontSize: 16, fontWeight: 600, outline: 'none', color: '#212121' }} />
                    {paymentType === 'cash' && cashAmount >= grandTotal && cashAmount > 0 && (
                      <span style={{ fontSize: 13, color: '#2E7D32', fontWeight: 600, whiteSpace: 'nowrap' }}>Üstü: {fmtMoney(change)} ₺</span>
                    )}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                  <button onClick={() => { setPaymentMode(false); setCashInput('') }}
                    style={{ background: '#F5F5F5', border: '1px solid #E0E0E0', borderRadius: 10, padding: '12px', cursor: 'pointer', fontSize: 13, color: '#424242', fontWeight: 500 }}>İptal</button>
                  <button onClick={completeSale}
                    disabled={saving || (paymentType === 'cash' && cashAmount < grandTotal)}
                    style={{ background: (saving || (paymentType === 'cash' && cashAmount < grandTotal)) ? '#F5F5F5' : '#2E7D32', color: (saving || (paymentType === 'cash' && cashAmount < grandTotal)) ? '#BDBDBD' : 'white', border: 'none', borderRadius: 10, padding: '12px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                    {saving ? 'Kaydediliyor...' : 'Satışı Tamamla ✓'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## DOSYA 9 — `src/App.tsx` — KOMPLE DEĞİŞTİR

```tsx
import { useEffect, useState } from 'react'
import ActivationScreen   from './screens/ActivationScreen'
import CashierLoginScreen from './screens/CashierLoginScreen'
import DashboardScreen    from './screens/DashboardScreen'
import POSScreen          from './screens/POSScreen'

type AppState = 'loading' | 'activation' | 'cashier_login' | 'dashboard' | 'pos'

export default function App() {
  const [state, setState]             = useState<AppState>('loading')
  const [companyId, setCompanyId]     = useState<string | null>(null)
  const [terminalId, setTerminalId]   = useState<string | null>(null)
  const [cashier, setCashier]         = useState<CashierRow | null>(null)
  const [allProducts, setAllProducts] = useState<ProductRow[]>([])
  const [popupMessage, setPopupMessage] = useState<string | null>(null)

  useEffect(() => { checkActivation() }, [])

  async function checkActivation() {
    const activated       = await window.electron.store.get('activated')
    const storedCompanyId = await window.electron.store.get('company_id')
    const storedTerminalId = await window.electron.store.get('terminal_id')

    if (activated && storedCompanyId) {
      setCompanyId(storedCompanyId as string)
      setTerminalId(storedTerminalId as string)
      setState('cashier_login')
    } else {
      setState('activation')
    }
  }

  function handleActivated(cId: string) {
    setCompanyId(cId)
    window.electron.store.get('terminal_id').then(id => setTerminalId(id as string))
    setState('cashier_login')
  }

  function handleCashierLogin(c: CashierRow) {
    setCashier(c)
    setState('dashboard')
  }

  function handleStartSale() {
    window.electron.db.getProducts().then(p => {
      setAllProducts(p)
      setState('pos')
    })
  }

  function handleLogout() {
    setCashier(null)
    setAllProducts([])
    setState('cashier_login')
  }

  if (state === 'loading') return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#F0F2F5' }}>
      <div style={{ color: '#9E9E9E', fontSize: 16 }}>BTPOS Yükleniyor...</div>
    </div>
  )

  if (state === 'activation')
    return <ActivationScreen onActivated={handleActivated} />

  if (state === 'cashier_login')
    return <CashierLoginScreen companyId={companyId!} onLogin={handleCashierLogin} />

  if (state === 'dashboard')
    return (
      <DashboardScreen
        companyId={companyId!}
        cashier={cashier!}
        terminalId={terminalId!}
        onStartSale={handleStartSale}
        onLogout={handleLogout}
        onShowMessage={(text) => setPopupMessage(text)}
      />
    )

  return (
    <>
      <POSScreen
        companyId={companyId!}
        cashier={cashier!}
        allProducts={allProducts}
        onBack={() => setState('dashboard')}
        onLogout={handleLogout}
        pollIntervalSec={30}
        pendingMessage={popupMessage ? { text: popupMessage } : null}
        onMessageClose={() => setPopupMessage(null)}
      />
    </>
  )
}
```

---

## Teslim Kriterleri

- [ ] `MessagePopup` — popup açılıyor, "Tamam" ile kapanıyor
- [ ] `ConnectionDot` — header'da yeşil/turuncu/gri nokta görünüyor
- [ ] `useConnectionStatus` — 30 sn'de bir API'ye ping atıyor
- [ ] `useCommandPoller` — terminal komutlarını dinliyor, işleyip ack gönderiyor
- [ ] `DashboardScreen` — poller aktif, kilit ekranı çalışıyor
- [ ] `POSScreen` — arama boşken numerik tuş + PLU grupları görünüyor
- [ ] `POSScreen` — yazmaya başlayınca PLU kaybolup liste geliyor
- [ ] `POSScreen` — numeriğe basıp ürüne tıklayınca o miktar ekleniyor
- [ ] `POSScreen` — X butonuna basınca onay modal'ı çıkıyor
- [ ] `POSScreen` — "Sepeti Temizle" onay modal'ı çalışıyor
- [ ] `App.tsx` — mesaj popup'ı dashboard ve POS ekranında gösteriyor

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
  saleCount:  number
  totalSales: number
  totalCash:  number
  totalCard:  number
}

export default function DashboardScreen({
  companyId, cashier, terminalId,
  onStartSale, onLogout, onShowMessage,
}: Props) {
  const [summary, setSummary]       = useState<DailySummary>({ saleCount: 0, totalSales: 0, totalCash: 0, totalCard: 0 })
  const [time, setTime]             = useState(new Date())
  const [syncing, setSyncing]       = useState(false)
  const [locked, setLocked]         = useState(false)
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

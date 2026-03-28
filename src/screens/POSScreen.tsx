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

const MOCK_PRODUCTS: ProductRow[] = [
  { id: 'm01', code: 'P001', name: 'Türk Kahvesi',          barcode: '8690000000001', price: 45.00,  vatRate: 10, unit: 'Adet',     stock: 100, category: 'İçecek' },
  { id: 'm02', code: 'P002', name: 'Çay (Bardak)',           barcode: '8690000000002', price: 15.00,  vatRate: 10, unit: 'Adet',     stock: 500, category: 'İçecek' },
  { id: 'm03', code: 'P003', name: 'Espresso',               barcode: '8690000000003', price: 55.00,  vatRate: 10, unit: 'Adet',     stock: 80,  category: 'İçecek' },
  { id: 'm04', code: 'P004', name: 'Kapuçino',               barcode: '8690000000004', price: 65.00,  vatRate: 10, unit: 'Adet',     stock: 80,  category: 'İçecek' },
  { id: 'm05', code: 'P005', name: 'Ayran (200ml)',          barcode: '8690000000005', price: 20.00,  vatRate: 10, unit: 'Adet',     stock: 200, category: 'İçecek' },
  { id: 'm06', code: 'P006', name: 'Su (0.5L)',              barcode: '8690000000006', price: 10.00,  vatRate: 10, unit: 'Adet',     stock: 300, category: 'İçecek' },
  { id: 'm07', code: 'P007', name: 'Portakallı Taze Sıkma',  barcode: '8690000000007', price: 70.00,  vatRate: 10, unit: 'Adet',     stock: 50,  category: 'İçecek' },
  { id: 'm08', code: 'P008', name: 'Tost (Kaşarlı)',         barcode: '8690000000008', price: 80.00,  vatRate: 10, unit: 'Adet',     stock: 40,  category: 'Yiyecek' },
  { id: 'm09', code: 'P009', name: 'Sandviç (Tavuklu)',      barcode: '8690000000009', price: 95.00,  vatRate: 10, unit: 'Adet',     stock: 30,  category: 'Yiyecek' },
  { id: 'm10', code: 'P010', name: 'Poğaça',                 barcode: '8690000000010', price: 25.00,  vatRate: 10, unit: 'Adet',     stock: 60,  category: 'Yiyecek' },
  { id: 'm11', code: 'P011', name: 'Simit',                  barcode: '8690000000011', price: 15.00,  vatRate: 10, unit: 'Adet',     stock: 100, category: 'Yiyecek' },
  { id: 'm12', code: 'P012', name: 'Cheesecake',             barcode: '8690000000012', price: 85.00,  vatRate: 10, unit: 'Adet',     stock: 20,  category: 'Tatlı' },
  { id: 'm13', code: 'P013', name: 'Brownie',                barcode: '8690000000013', price: 60.00,  vatRate: 10, unit: 'Adet',     stock: 25,  category: 'Tatlı' },
  { id: 'm14', code: 'P014', name: 'Fıstıklı Baklava',      barcode: '8690000000014', price: 120.00, vatRate: 10, unit: 'Porsiyon', stock: 30,  category: 'Tatlı' },
  { id: 'm15', code: 'P015', name: 'Dondurma (Top)',         barcode: '8690000000015', price: 35.00,  vatRate: 10, unit: 'Adet',     stock: 50,  category: 'Tatlı' },
  { id: 'm16', code: 'P016', name: 'Izgara Köfte',           barcode: '8690000000016', price: 180.00, vatRate: 10, unit: 'Porsiyon', stock: 25,  category: 'Ana Yemek' },
  { id: 'm17', code: 'P017', name: 'Tavuk Şiş',             barcode: '8690000000017', price: 160.00, vatRate: 10, unit: 'Porsiyon', stock: 20,  category: 'Ana Yemek' },
  { id: 'm18', code: 'P018', name: 'Mercimek Çorbası',       barcode: '8690000000018', price: 75.00,  vatRate: 10, unit: 'Porsiyon', stock: 40,  category: 'Ana Yemek' },
  { id: 'm19', code: 'P019', name: 'Çoban Salata',           barcode: '8690000000019', price: 65.00,  vatRate: 10, unit: 'Porsiyon', stock: 35,  category: 'Ana Yemek' },
  { id: 'm20', code: 'P020', name: 'Pide (Kaşarlı)',         barcode: '8690000000020', price: 130.00, vatRate: 10, unit: 'Adet',     stock: 15,  category: 'Ana Yemek' },
]

export default function POSScreen({
  companyId, cashier, allProducts: rawProducts,
  onBack, onLogout,
  pollIntervalSec = 30,
  pendingMessage, onMessageClose,
}: Props) {
  const allProducts = rawProducts.length > 0 ? rawProducts : MOCK_PRODUCTS

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

  // Aktif gruba göre ürün listesi
  const groupProducts = (() => {
    if (!activeGroup) return allProducts
    const group = pluGroups.find(g => g.id === activeGroup)
    if (!group || !group.plu_items?.length) {
      // plu_items yoksa category eşleştir
      return allProducts.filter(p => (p.category || 'Diğer') === group?.name)
    }
    return group.plu_items
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(item => allProducts.find(p => p.code === item.product_code))
      .filter(Boolean) as ProductRow[]
  })()

  const filtered = search
    ? allProducts.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.code ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (p.barcode ?? '').includes(search)
      )
    : groupProducts

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated  = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE)

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
      .map(c => c.id === id ? { ...c, quantity: c.quantity + delta, lineTotal: (c.quantity + delta) * c.price } : c)
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
              <span style={{ fontSize: 10, color: '#757575' }}>{page + 1}/{Math.max(1, totalPages)} · {groupProducts.length} ürün</span>
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
              <span key={i} style={{ fontSize: 10, color: '#9E9E9E', fontWeight: 500, textAlign: i === 0 ? 'left' : 'center' }}>{h}</span>
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
                    onClick={() => { setPaymentType(btn.key as 'cash' | 'card' | 'mixed'); if (btn.key === 'card') completeSale(); else setPaymentMode(true) }}
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

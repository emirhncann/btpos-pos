import type { CSSProperties } from 'react'

export interface ReturnableSaleItem {
  Id:                 number
  ProductName:        string
  Quantity:           number
  ReturnableQuantity: number
  UnitPrice:          number
  TotalPrice:         number
  VatRate?:           number
  UnitName?:          string
  TaxGroupId?:        number
  ProductCode?:       string
  StockRef?:          number
  ProductId?:         number
}

export interface ReturnablePayment {
  Mediator:           number
  Amount:             number
  ReturnableAmount:   number
  PaymentId:          number
  CurrencyCode?:      string
  ExchangeRate?:      number
}

export type ReturnSearchBy = 'order' | 'sale'

export interface ReturnableSale {
  Id:           number
  SaleNumber:   string
  OrderNo?:     string | null
  CustomerInfo: {
    CustomerType?: number
    CompanyName?: string
    TaxNumber?:   string
    FirstName?:   string
  } | null
  Items:        ReturnableSaleItem[]
  Payments:     ReturnablePayment[]
}

export interface RecentSalesFilter {
  dateFrom: string
  dateTo:   string
  timeFrom: string
  timeTo:   string
}

export interface RecentSaleOption {
  id:             string
  receiptNo:      string
  pavoSaleNumber: string | null
  orderNo:        string | null
  netAmount:      number
  createdAt:      string
  customerName:   string | null
  cashierName:    string | null
}

export interface QuickReturnModalState {
  step:              'search' | 'recent' | 'review'
  searchBy:          ReturnSearchBy
  saleNumber:        string
  saleData?:         ReturnableSale
  selected:          Record<number, number>
  selectedPayments:  Record<number, number>
  recentSales?:      RecentSaleOption[]
  recentFilters?:    RecentSalesFilter
}

interface Props {
  modal:          QuickReturnModalState
  loading:        boolean
  error:          string | null
  onClose:        () => void
  onSaleNumberChange: (saleNumber: string) => void
  onSearchByChange:   (searchBy: ReturnSearchBy) => void
  onSearch:       (query: string, searchBy: ReturnSearchBy) => void
  onShowRecent:   () => void
  onReloadRecent: (filters: RecentSalesFilter) => void
  onRecentFiltersChange: (filters: RecentSalesFilter) => void
  onSelectRecent: (query: string, searchBy: ReturnSearchBy) => void
  onBackFromRecent: () => void
  onBack:         () => void
  onConfirm:      () => void
  onSelectAll:    () => void
  onClearAll:     () => void
  onToggleItem:   (itemId: number, returnableQty: number, checked: boolean) => void
  onQtyChange:    (itemId: number, delta: -1 | 1, maxQty: number) => void
  onOpenPaymentNumpad: (paymentId: number, max: number, current: number) => void
  touchEnabled:    boolean
  onOpenKeyboard:  (opts: { title: string; initial: string; onConfirm: (v: string) => void }) => void
}

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10001,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const panel: CSSProperties = {
  background: 'white',
  borderRadius: 16,
  width: '60vw',
  maxWidth: 'calc(100vw - 32px)',
  display: 'flex',
  flexDirection: 'column',
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function offsetDateStr(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const inputSm: CSSProperties = {
  fontSize: 12,
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid #E5E7EB',
}

const chipBtn = (active: boolean): CSSProperties => ({
  padding: '4px 10px',
  borderRadius: 16,
  fontSize: 11,
  fontWeight: 500,
  border: '1px solid',
  cursor: 'pointer',
  background: active ? '#374151' : 'white',
  color: active ? 'white' : '#374151',
  borderColor: active ? '#374151' : '#E5E7EB',
})

export default function QuickReturnModal({
  modal,
  loading,
  error,
  onClose,
  onSaleNumberChange,
  onSearchByChange,
  onSearch,
  onShowRecent,
  onReloadRecent,
  onRecentFiltersChange,
  onSelectRecent,
  onBackFromRecent,
  onBack,
  onConfirm,
  onSelectAll,
  onClearAll,
  onToggleItem,
  onQtyChange,
  onOpenPaymentNumpad,
  touchEnabled,
  onOpenKeyboard,
}: Props) {
  function recentSearchValue(s: RecentSaleOption, searchBy: ReturnSearchBy) {
    if (searchBy === 'order') {
      return s.orderNo ?? s.receiptNo
    }
    return s.pavoSaleNumber ?? s.receiptNo
  }

  const searchLabel = modal.searchBy === 'order' ? 'Sipariş No' : 'Satış No'
  const searchPlaceholder = modal.searchBy === 'order'
    ? 'Sipariş No (örn: 001250624143052)'
    : 'Satış No (örn: 0001-000123)'

  if (modal.step === 'recent') {
    const list = modal.recentSales ?? []
    const filters = modal.recentFilters ?? {
      dateFrom: todayStr(),
      dateTo:   todayStr(),
      timeFrom: '',
      timeTo:   '',
    }

    const setFilters = (next: RecentSalesFilter) => {
      onRecentFiltersChange(next)
    }

    const applyQuick = (dateFrom: string, dateTo: string) => {
      const next = { ...filters, dateFrom, dateTo }
      setFilters(next)
      onReloadRecent(next)
    }

    return (
      <div style={overlay}>
        <div style={{ ...panel, padding: 24, gap: 12, maxHeight: '90vh' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>📋 Son Satışlar</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                En fazla 20 kayıt · İade edilecek satışı seçin
              </div>
            </div>
            <button type="button" onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="return-search-by-recent"
                checked={modal.searchBy === 'order'}
                onChange={() => onSearchByChange('order')}
              />
              Sipariş No ile ara
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="return-search-by-recent"
                checked={modal.searchBy === 'sale'}
                onChange={() => onSearchByChange('sale')}
              />
              Satış No ile ara
            </label>
          </div>

          {/* Hızlı tarih filtreleri */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {([
              ['today',    'Bugün',     todayStr(),     todayStr()],
              ['yesterday','Dün',       offsetDateStr(-1), offsetDateStr(-1)],
              ['week',     'Son 7 Gün', offsetDateStr(-6), todayStr()],
              ['all',      'Tümü',      '',             ''],
            ] as const).map(([key, label, from, to]) => {
              const active = key === 'all'
                ? !filters.dateFrom && !filters.dateTo
                : filters.dateFrom === from && filters.dateTo === to
              return (
                <button key={key} type="button"
                  onClick={() => applyQuick(from, to)}
                  style={chipBtn(active)}>
                  {label}
                </button>
              )
            })}
          </div>

          {/* Tarih + saat */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="date" value={filters.dateFrom}
              onChange={e => setFilters({ ...filters, dateFrom: e.target.value })}
              style={inputSm} />
            <span style={{ color: '#9CA3AF', fontSize: 12 }}>—</span>
            <input type="date" value={filters.dateTo}
              onChange={e => setFilters({ ...filters, dateTo: e.target.value })}
              style={inputSm} />
            <span style={{ color: '#D1D5DB', fontSize: 12 }}>|</span>
            <span style={{ fontSize: 11, color: '#6B7280' }}>Saat</span>
            <input type="time" value={filters.timeFrom}
              onChange={e => setFilters({ ...filters, timeFrom: e.target.value })}
              style={inputSm} />
            <span style={{ color: '#9CA3AF', fontSize: 12 }}>—</span>
            <input type="time" value={filters.timeTo}
              onChange={e => setFilters({ ...filters, timeTo: e.target.value })}
              style={inputSm} />
            <button type="button"
              disabled={loading}
              onClick={() => onReloadRecent(filters)}
              style={{
                padding: '5px 12px', borderRadius: 8, border: 'none',
                background: '#1565C0', color: 'white',
                fontSize: 12, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}>
              {loading ? '...' : 'Listele'}
            </button>
            {(filters.timeFrom || filters.timeTo) && (
              <button type="button"
                onClick={() => {
                  const next = { ...filters, timeFrom: '', timeTo: '' }
                  setFilters(next)
                  onReloadRecent(next)
                }}
                style={{
                  padding: '5px 10px', borderRadius: 8,
                  border: '1px solid #E5E7EB', background: 'white',
                  fontSize: 11, color: '#6B7280', cursor: 'pointer',
                }}>
                Saati temizle
              </button>
            )}
          </div>

          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
            }}>
              {error}
            </div>
          )}

          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            {list.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#9CA3AF', fontSize: 13 }}>
                Bu filtreye uygun satış bulunamadı
              </div>
            ) : list.map(s => {
              const searchValue = recentSearchValue(s, modal.searchBy)
              return (
              <button
                key={s.id}
                type="button"
                disabled={loading}
                onClick={() => onSelectRecent(searchValue, modal.searchBy)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 10,
                  border: '1px solid #E5E7EB', background: 'white',
                  cursor: loading ? 'wait' : 'pointer', textAlign: 'left',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                <div style={{ fontSize: 20 }}>🧾</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: '#111827' }}>
                    {searchValue}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                    {new Date(s.createdAt).toLocaleString('tr-TR')}
                    {s.customerName && ` · ${s.customerName}`}
                    {s.cashierName && ` · ${s.cashierName}`}
                  </div>
                  {modal.searchBy === 'order' && s.pavoSaleNumber && (
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
                      Satış: {s.pavoSaleNumber}
                    </div>
                  )}
                  {modal.searchBy === 'sale' && s.orderNo && (
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
                      Sipariş: {s.orderNo}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1565C0', flexShrink: 0 }}>
                  {s.netAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                </div>
              </button>
            )})}
          </div>

          <button type="button" onClick={onBackFromRecent}
            style={{
              padding: '12px 16px', borderRadius: 10,
              border: '1px solid #E5E7EB', background: '#F9FAFB',
              color: '#6B7280', fontSize: 14, cursor: 'pointer',
            }}>
            ← Geri
          </button>
        </div>
      </div>
    )
  }

  if (modal.step === 'search') {
    return (
      <div style={overlay}>
        <div style={{ ...panel, padding: 24, gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>⚡ Hızlı İade</div>
            <button type="button" onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          <div style={{ fontSize: 12, color: '#6B7280' }}>
            {searchLabel} girin veya barkod okutun
          </div>

          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="return-search-by"
                checked={modal.searchBy === 'order'}
                onChange={() => onSearchByChange('order')}
              />
              Sipariş No
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="return-search-by"
                checked={modal.searchBy === 'sale'}
                onChange={() => onSearchByChange('sale')}
              />
              Satış No
            </label>
          </div>

          <input
            value={modal.saleNumber}
            onChange={e => onSaleNumberChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSearch(modal.saleNumber, modal.searchBy) }}
            onClick={() => {
              if (!touchEnabled) return
              onOpenKeyboard({
                title:     searchLabel,
                initial:   modal.saleNumber,
                onConfirm: (v) => {
                  onSaleNumberChange(v)
                  onSearch(v, modal.searchBy)
                },
              })
            }}
            readOnly={touchEnabled}
            placeholder={searchPlaceholder}
            autoFocus={!touchEnabled}
            style={{
              padding: '12px 14px', borderRadius: 10, border: '1.5px solid #E5E7EB',
              fontSize: 15, fontFamily: 'monospace',
              cursor: touchEnabled ? 'default' : 'text',
            }}
          />

          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button"
              onClick={() => onSearch(modal.saleNumber, modal.searchBy)}
              disabled={!modal.saleNumber.trim() || loading}
              style={{
                flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                background: '#1565C0', color: 'white', fontWeight: 600, fontSize: 14,
                cursor: 'pointer', opacity: loading ? 0.6 : 1,
              }}>
              {loading ? 'Aranıyor...' : 'Ara'}
            </button>
            <button type="button"
              onClick={onShowRecent}
              disabled={loading}
              style={{
                flex: 1, padding: '12px', borderRadius: 10,
                border: '1px solid #E5E7EB', background: '#F9FAFB',
                color: '#374151', fontWeight: 500, fontSize: 14, cursor: 'pointer',
              }}>
              📋 Son Satışlar
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!modal.saleData) return null

  const sale = modal.saleData
  const selected = modal.selected

  const totalReturn = sale.Items.reduce((sum, item) => {
    const qty = selected[item.Id] ?? 0
    return sum + qty * item.UnitPrice
  }, 0)

  return (
    <div style={overlay}>
      <div style={{
        ...panel,
        padding: 20,
        gap: 12,
        maxHeight: '90vh',
        overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>İade Önizleme</div>
            <div style={{ fontSize: 12, color: '#6B7280', fontFamily: 'monospace' }}>
              {sale.OrderNo && <span>Sipariş: {sale.OrderNo}</span>}
              {sale.OrderNo && sale.SaleNumber && ' · '}
              {sale.SaleNumber && <span>Satış: {sale.SaleNumber}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onSelectAll}
            style={{
              flex: 1, padding: '8px', borderRadius: 8, fontSize: 12,
              border: '1px solid #BFDBFE', background: '#EFF6FF', color: '#1565C0', cursor: 'pointer',
            }}>
            Tümünü Seç
          </button>
          <button type="button" onClick={onClearAll}
            style={{
              flex: 1, padding: '8px', borderRadius: 8, fontSize: 12,
              border: '1px solid #E5E7EB', background: '#F9FAFB', color: '#6B7280', cursor: 'pointer',
            }}>
            Tümünü Temizle
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sale.Items.map(item => {
            const isReturnable = item.ReturnableQuantity > 0
            const qty = selected[item.Id] ?? 0
            const checked = qty > 0

            return (
              <div key={item.Id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 10,
                  border: `1.5px solid ${checked ? '#BFDBFE' : '#E5E7EB'}`,
                  background: checked ? '#EFF6FF' : isReturnable ? 'white' : '#F9FAFB',
                  opacity: isReturnable ? 1 : 0.5,
                }}>

                <input type="checkbox"
                  checked={checked}
                  disabled={!isReturnable}
                  onChange={e => onToggleItem(item.Id, item.ReturnableQuantity, e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{item.ProductName}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                    {item.UnitPrice.toFixed(2)} ₺ × iade edilebilir {item.ReturnableQuantity}
                  </div>
                </div>

                {checked && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button type="button"
                      onClick={() => onQtyChange(item.Id, -1, item.ReturnableQuantity)}
                      style={{
                        width: 24, height: 24, borderRadius: 6, border: '1px solid #E5E7EB',
                        background: 'white', cursor: 'pointer', fontSize: 14,
                      }}>−</button>
                    <span style={{ minWidth: 24, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>
                      {qty}
                    </span>
                    <button type="button"
                      onClick={() => onQtyChange(item.Id, 1, item.ReturnableQuantity)}
                      style={{
                        width: 24, height: 24, borderRadius: 6, border: '1px solid #E5E7EB',
                        background: 'white', cursor: 'pointer', fontSize: 14,
                      }}>+</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {sale.Payments.length > 0 && (
          <div style={{
            borderRadius: 10,
            border: '1px solid #E5E7EB',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '8px 12px',
              background: '#F9FAFB',
              borderBottom: '1px solid #E5E7EB',
              fontSize: 11,
              fontWeight: 700,
              color: '#6B7280',
              textTransform: 'uppercase' as const,
              letterSpacing: 0.5,
            }}>
              Ödemeler
            </div>
            {sale.Payments.map((p, i) => {
              const mediatorLabel: Record<number, string> = {
                0: '💵 Nakit',
                1: '💵 Nakit',
                2: '💳 Kredi Kartı',
                3: '💳 Banka Kartı',
                4: '🍽️ Yemek Kartı',
              }
              const label        = mediatorLabel[p.Mediator] ?? `Ödeme (${p.Mediator})`
              const isReturnable = p.ReturnableAmount > 0
              const currentAmt   = modal.selectedPayments?.[p.PaymentId] ?? p.ReturnableAmount

              return (
                <div key={i} style={{
                  display:        'flex',
                  justifyContent: 'space-between',
                  alignItems:     'center',
                  padding:        '10px 12px',
                  borderBottom:   i < sale.Payments.length - 1 ? '1px solid #F3F4F6' : 'none',
                  opacity:        isReturnable ? 1 : 0.45,
                  gap:            12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
                      Maks: {p.ReturnableAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                      {!isReturnable && ' · İade edilemez'}
                    </div>
                  </div>

                  {isReturnable ? (
                    <button
                      type="button"
                      onClick={() => onOpenPaymentNumpad(p.PaymentId, p.ReturnableAmount, currentAmt)}
                      style={{
                        padding:      '6px 12px',
                        borderRadius: 8,
                        border:       '1.5px solid #BFDBFE',
                        background:   '#EFF6FF',
                        color:        '#1565C0',
                        fontSize:     14,
                        fontWeight:   700,
                        cursor:       'pointer',
                        minWidth:     80,
                        textAlign:    'right',
                      }}
                    >
                      {currentAmt.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </button>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#9CA3AF' }}>
                      —
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '12px 14px', borderRadius: 10, background: '#FFF5F5',
          border: '1px solid #FECACA',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#991B1B' }}>İade Toplam</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#DC2626' }}>
            {totalReturn.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
          </span>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onBack}
            style={{
              padding: '12px 16px', borderRadius: 10,
              border: '1px solid #E5E7EB', background: '#F9FAFB',
              color: '#6B7280', fontSize: 14, cursor: 'pointer',
            }}>
            ← Geri
          </button>
          <button type="button"
            onClick={onConfirm}
            disabled={Object.keys(selected).length === 0 || loading}
            style={{
              flex: 1, padding: '12px', borderRadius: 10, border: 'none',
              background: '#DC2626', color: 'white', fontWeight: 700, fontSize: 14,
              cursor: 'pointer', opacity: Object.keys(selected).length === 0 ? 0.5 : 1,
            }}>
            {loading ? 'İade İşleniyor...' : '↩️ İadeyi Onayla'}
          </button>
        </div>
      </div>
    </div>
  )
}

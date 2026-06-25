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
}

export interface ReturnableSale {
  Id:           number
  SaleNumber:   string
  CustomerInfo: {
    CustomerType?: number
    CompanyName?: string
    TaxNumber?:   string
    FirstName?:   string
  } | null
  Items:        ReturnableSaleItem[]
  Payments:     ReturnablePayment[]
}

export interface QuickReturnModalState {
  step:       'search' | 'review'
  saleNumber: string
  saleData?:  ReturnableSale
  selected:   Record<number, number>
}

interface Props {
  modal:          QuickReturnModalState
  loading:        boolean
  error:          string | null
  onClose:        () => void
  onSaleNumberChange: (saleNumber: string) => void
  onSearch:       (saleNumber: string) => void
  onSearchLast:   () => void
  onBack:         () => void
  onConfirm:      () => void
  onSelectAll:    () => void
  onClearAll:     () => void
  onToggleItem:   (itemId: number, returnableQty: number, checked: boolean) => void
  onQtyChange:    (itemId: number, delta: -1 | 1, maxQty: number) => void
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

export default function QuickReturnModal({
  modal,
  loading,
  error,
  onClose,
  onSaleNumberChange,
  onSearch,
  onSearchLast,
  onBack,
  onConfirm,
  onSelectAll,
  onClearAll,
  onToggleItem,
  onQtyChange,
}: Props) {
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
            Satış numarasını girin veya barkod okutun
          </div>

          <input
            value={modal.saleNumber}
            onChange={e => onSaleNumberChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSearch(modal.saleNumber) }}
            placeholder="Satış No (örn: 0001-000123)"
            autoFocus
            style={{
              padding: '12px 14px', borderRadius: 10, border: '1.5px solid #E5E7EB',
              fontSize: 15, fontFamily: 'monospace',
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
              onClick={() => onSearch(modal.saleNumber)}
              disabled={!modal.saleNumber.trim() || loading}
              style={{
                flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                background: '#1565C0', color: 'white', fontWeight: 600, fontSize: 14,
                cursor: 'pointer', opacity: loading ? 0.6 : 1,
              }}>
              {loading ? 'Aranıyor...' : 'Ara'}
            </button>
            <button type="button"
              onClick={onSearchLast}
              disabled={loading}
              style={{
                flex: 1, padding: '12px', borderRadius: 10,
                border: '1px solid #E5E7EB', background: '#F9FAFB',
                color: '#374151', fontWeight: 500, fontSize: 14, cursor: 'pointer',
              }}>
              📋 Son Satış
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
              {sale.SaleNumber}
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

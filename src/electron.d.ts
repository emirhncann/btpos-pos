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
      window: {
        isFullscreen:    () => Promise<boolean>
        toggleFullscreen: () => Promise<void>
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

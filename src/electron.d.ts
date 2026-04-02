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
        version:      () => Promise<string>
        restart:      () => Promise<void>
        openKeyboard: () => Promise<void>
      }
      window: {
        isFullscreen:    () => Promise<boolean>
        toggleFullscreen: () => Promise<void>
      }
      db: {
        saveProducts:       (products: unknown[]) => Promise<number>
        getProducts:        () => Promise<ProductRow[]>
        saveSale:           (sale: SaleRow, items: SaleItem[]) => Promise<string>
        getSales:           (dateFrom?: string, dateTo?: string) => Promise<SaleRecord[]>
        saveCashiers:       (cashiers: unknown[]) => Promise<number>
        verifyCashier:      (code: string, password: string) => Promise<CashierRow | null>
        getCashiers:        () => Promise<CashierRow[]>
        holdDocument:       (doc: unknown) => Promise<string>
        getHeldDocuments:   (companyId: string) => Promise<HeldDocRow[]>
        deleteHeldDocument: (id: string) => Promise<void>
        savePluGroups:      (groups: unknown[]) => Promise<void>
        getPluGroups:       (companyId: string, wpId?: string) => Promise<PluGroupCacheRow[]>
        savePosSettings:    (settings: PosSettingsRow) => Promise<void>
        getPosSettings:     () => Promise<PosSettingsRow>
        saveCommandHistory: (row: CommandHistoryRow) => Promise<void>
        getCommandHistory:  (limit?: number) => Promise<CommandHistoryRow[]>
        syncProductsAcid:   (items: ProductRow[], mode?: 'full' | 'diff') => Promise<SyncResult>
        syncPluGroupsAcid:  (groups: PluGroupCacheRow[], mode?: 'full' | 'diff') => Promise<SyncResult>
        syncCashiersAcid:   (cashiers: CashierRow[], companyId: string, mode?: 'full' | 'diff') => Promise<SyncResult>
      }
    }
  }

  interface CommandHistoryRow {
    id:         string
    command:    string
    payload:    Record<string, unknown>
    status:     string
    receivedAt: string
    doneAt?:    string
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

  interface SyncResult {
    success:  boolean
    inserted: number
    updated:  number
    deleted:  number
    error?:   string
  }

  interface CashierRow {
    id:          string
    companyId?:  string
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
    productId?:      string
    productName:     string
    quantity:        number
    unitPrice:       number
    vatRate:         number
    discountRate?:   number
    discountAmount?: number
    lineTotal:       number
    appliedBy?:      string
  }

  interface SaleRow {
    receiptNo:       string
    totalAmount:     number
    discountRate?:   number
    discountAmount?: number
    netAmount:       number
    paymentType:     'cash' | 'card' | 'mixed'
    cashAmount:      number
    cardAmount:      number
  }

  interface SaleRecord {
    id:          string
    receiptNo:   string
    totalAmount: number
    paymentType: string
    createdAt:   string
  }

  interface CartItem {
    id:             string
    code:           string
    name:           string
    category:       string
    price:          number
    vatRate:        number
    unit:           string
    quantity:       number
    lineTotal:      number
    discountRate:   number
    discountAmount: number
    netTotal:       number
  }

  interface HeldDocRow {
    id:          string
    companyId:   string
    label?:      string
    items:       CartItem[]
    totalAmount: number
    createdAt:   string
  }

  interface CustomerRow {
    id:      string
    code:    string
    name:    string
    phone:   string
    taxNo:   string
    balance: number
  }

  interface PluGroupCacheRow {
    id:          string
    companyId:   string
    workplaceId?: string
    name:        string
    color:       string
    sortOrder:   number
    plu_items:   Array<{ id: string; product_code: string; sort_order: number }>
  }

  interface PosSettingsRow {
    showPrice:            boolean
    showCode:             boolean
    showBarcode:          boolean
    duplicateItemAction:  'increase_qty' | 'add_new'
    minQtyPerLine:        number
    allowLineDiscount:    boolean
    allowDocDiscount:     boolean
    maxLineDiscountPct:   number
    maxDocDiscountPct:    number
    pluCols:              number
    pluRows:              number
    fontSizeName:         number
    fontSizePrice:        number
    fontSizeCode:         number
    source:               string
  }
}

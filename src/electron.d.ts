export {}

declare global {
  interface CartSettings {
    showBarkod: boolean
    showBirim: boolean
    showKdv: boolean
    showFiyat: boolean
    showIskonto: boolean
    fsUrunAdi: number
    fsUrunKod: number
    fsMiktar: number
    fsTutar: number
    fsTutarSub: number
    fsPill: number
  }

  interface Window {
    electron: {
      store: {
        get: (key: string) => Promise<unknown>
        set: (key: string, value: unknown) => Promise<void>
        getCartSettings: () => Promise<CartSettings>
        setCartSettings: (s: CartSettings) => Promise<{ success: boolean }>
      }
      device: {
        uid:  () => Promise<string>
        info: () => Promise<DeviceInfo>
      }
      app: {
        version:      () => Promise<string>
        restart:      () => Promise<void>
        openKeyboard: () => Promise<void>
        selectFolder: () => Promise<string | null>
        reinitDb:     (path: string) => Promise<{ success: boolean; error?: string }>
      }
      window: {
        isFullscreen:     () => Promise<boolean>
        toggleFullscreen: () => Promise<void>
        toggleDevTools:   () => Promise<void>
      }
      db: {
        saveProducts:       (products: unknown[]) => Promise<number>
        getProducts:        () => Promise<ProductRow[]>
        saveSale:           (sale: SaleRow, items: SaleItem[]) => Promise<string>
        getSales:           (dateFrom?: string, dateTo?: string) => Promise<SaleRecord[]>
        saveCashiers:       (cashiers: unknown[]) => Promise<number>
        verifyCashier:      (code: string, password: string) => Promise<CashierRow | null>
        verifyCashierByCard: (cardNumber: string) => Promise<CashierRow | null>
        getAllCashiers:     () => Promise<CashierRow[]>
        getCashiers:        () => Promise<CashierRow[]>
        holdDocument:       (doc: unknown) => Promise<string>
        getHeldDocuments:   (companyId: string) => Promise<HeldDocRow[]>
        deleteHeldDocument: (id: string) => Promise<void>
        savePluGroups:      (groups: unknown[]) => Promise<void>
        getPluGroups:       (companyId: string, wpId?: string | null, cashierId?: string | null) => Promise<PluGroupCacheRow[]>
        savePosSettings:    (settings: PosSettingsRow, cashierId?: string) => Promise<SyncResult>
        getPosSettings:     (cashierId?: string) => Promise<PosSettingsRow>
        saveCommandHistory: (row: CommandHistoryRow) => Promise<void>
        getCommandHistory:  (limit?: number) => Promise<CommandHistoryRow[]>
        syncProductsAcid:   (items: ProductRow[], mode?: 'full' | 'diff') => Promise<SyncResult>
        syncPluGroupsAcid:  (groups: PluGroupCacheRow[], mode?: 'full' | 'diff') => Promise<SyncResult>
        syncCashiersAcid:   (cashiers: CashierRow[], companyId: string, mode?: 'full' | 'diff') => Promise<SyncResult>
        syncCustomersAcid:  (items: CustomerRow[], companyId: string, mode?: 'full' | 'diff') => Promise<SyncResult>
        getCustomers:       (companyId: string, query?: string) => Promise<CustomerRow[]>
        getCustomerById:    (companyId: string, id: string) => Promise<CustomerRow | null>
        getPendingInvoices: (onlyAnonymous?: boolean) => Promise<SaleDbRow[]>
        markInvoiceSent:   (saleId: string, invoiceId: string) => Promise<void>
        markInvoiceError:  (saleId: string, error: string) => Promise<void>
        getSaleItems:      (saleId: string) => Promise<SaleItemRow[]>
        upsertCustomer:    (row: CustomerRow) => Promise<void>
        enqueueOperation:  (params: {
          id: string
          companyId: string
          type: 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice'
          payload: Record<string, unknown>
          label?: string
        }) => Promise<void>
        getPendingOperations: (companyId: string) => Promise<OperationQueueRow[]>
        getAllOperations:  (companyId: string, limit?: number) => Promise<OperationQueueRow[]>
        markOperationProcessing: (id: string) => Promise<void>
        markOperationSuccess: (id: string) => Promise<void>
        markOperationFailed: (id: string, error: string) => Promise<void>
        retryOperation:    (id: string) => Promise<void>
        deleteOperation:   (id: string) => Promise<void>
      }
    }
  }

  interface OperationQueueRow {
    id:          string
    companyId:   string
    type:        'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice'
    payload:     string
    status:      'pending' | 'processing' | 'success' | 'failed'
    attempts:    number
    maxAttempts: number
    error:       string | null
    createdAt:   string
    sentAt:      string | null
    label:       string | null
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
    id:           string
    companyId?:   string
    fullName:     string
    cashierCode:  string
    password:     string
    role:         string
    isActive:     boolean
    cardNumber?:  string | null
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
    customerId?:     string | null
    customerName?:   string | null
    customerCode?:   string | null
  }

  /** SQLite sales satırı (fatura / listeler) */
  interface SaleDbRow {
    id:             string
    receiptNo:      string
    totalAmount:    number
    discountRate:   number | null
    discountAmount: number | null
    netAmount:      number
    paymentType:    string
    cashAmount:     number | null
    cardAmount:     number | null
    createdAt:      string
    synced:         boolean
    customerId:     string | null
    customerName:   string | null
    customerCode:   string | null
    invoiceSent:    number
    invoiceId:      string | null
    invoiceError:   string | null
    invoiceAt:      string | null
  }

  interface SaleItemRow {
    productCode:  string
    productName:  string
    quantity:     number
    price:        number
    vatRate:      number
    unit:         string
    discountRate?: number
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
    barcode?:       string
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
    id:        string
    companyId: string
    code:      string
    name:      string
    phone:     string
    taxNo:     string
    address:   string
    balance:   number
    isPerson:  boolean
    /** true = tedarikçi, false/undefined = müşteri */
    isSupplier?: boolean
    firstName: string
    lastName:  string
    postalCode: string
    city:       string
    district:   string
    syncedAt?: string
  }

  interface PluGroupCacheRow {
    id:           string
    companyId:    string
    workplaceId?: string
    terminalId?:  string
    cashierId?:   string
    name:         string
    color:        string
    sortOrder:    number
    plu_items:    Array<{ id: string; product_code: string; sort_order: number }>
  }

  type PluMode = 'terminal' | 'cashier'

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
    pluMode:              PluMode
    loginWithCode:        boolean
    loginWithCard:        boolean
    torbaCariId?:         string | null
    torbaCariName?:       string | null
  }
}

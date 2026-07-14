export {}

declare global {
  interface SecondScreenCartItem {
    name: string
    qty: number
    lineTotal: number
  }

  interface SecondScreenDiscount {
    label: string
    amount: number
    scope: 'line' | 'document'
  }

  interface SecondScreenPayload {
    mode: 'cart_and_btpos_gif'
    items: SecondScreenCartItem[]
    discounts: SecondScreenDiscount[]
    totals: {
      subtotal: number
      discountTotal: number
      grandTotal: number
      totalQty: number
    }
    branding: {
      btposGif: string
    }
    updatedAt: string
  }

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
        focusWindow:      () => Promise<void>
        toggleDevTools:   () => Promise<void>
      }
      printer: {
        list: () => Promise<{ name: string; isDefault: boolean }[]>
        print: (printerName: string, dataB64: string) => Promise<{ success: boolean; message?: string }>
        printRaw: (config: {
          type: 'usb' | 'network'
          printerName?: string
          ip?: string
          port?: number
        }, dataB64: string) => Promise<{ success: boolean; message?: string }>
        getSettings: () => Promise<PrinterSettingsDbRow | undefined>
        saveSettings: (s: Record<string, unknown>) => Promise<{ success: boolean }>
        printPaymentReceipt: (opts: PaymentReceiptPrintOpts) => Promise<{ success: boolean; message?: string }>
        testPrint: (settings: Record<string, unknown>) => Promise<{ success: boolean; message?: string }>
      }
      templates: {
        getAll: () => Promise<Record<string, unknown>[]>
        getByTrigger: (triggerType: string) => Promise<Record<string, unknown>[]>
        getDefault: (triggerType: string) => Promise<Record<string, unknown> | undefined>
        save: (templates: Record<string, unknown>[]) => Promise<{ success: boolean; count: number }>
        printThermal: (opts: {
          triggerType: string
          data: Record<string, Record<string, unknown>>
        }) => Promise<{ success: boolean; message?: string }>
        printPdf: (opts: {
          triggerType: string
          data: Record<string, Record<string, unknown>>
        }) => Promise<{ success: boolean; message?: string }>
        printWithBehavior: (opts: {
          triggerType: string
          data:        Record<string, Record<string, unknown>>
          templateId?: string
        }) => Promise<TemplatePrintResult>
      }
      secondScreen: {
        open: () => Promise<{ success: boolean; error?: string }>
        update: (payload: SecondScreenPayload) => Promise<{ success: boolean; error?: string }>
        close: () => Promise<{ success: boolean; error?: string }>
        getLatest: () => Promise<SecondScreenPayload | null>
        onData: (listener: (payload: SecondScreenPayload) => void) => () => void
      }
      db: {
        saveProducts:       (products: unknown[]) => Promise<number>
        getProducts:        () => Promise<ProductRow[]>
        saveSale:           (sale: SaleRow, items: SaleItem[], device?: PaymentDeviceResult) => Promise<SaveSaleResult>
        getSales:           (dateFrom?: string, dateTo?: string) => Promise<SaleRecord[]>
        saveCashiers:       (cashiers: unknown[]) => Promise<number>
        verifyCashier:      (code: string, password: string) => Promise<CashierRow | null>
        verifyCashierByCard: (cardNumber: string) => Promise<CashierRow | null>
        getAllCashiers:     () => Promise<CashierRow[]>
        getCashiers:        () => Promise<CashierRow[]>
        holdDocument:       (doc: unknown) => Promise<string>
        getHeldDocuments:   (companyId: string) => Promise<HeldDocRow[]>
        deleteHeldDocument: (id: string) => Promise<void>
        updateHeldDocumentLabel(id: string, label: string): Promise<{ success: boolean }>
        savePluGroups:      (groups: unknown[]) => Promise<void>
        getPluGroups:       (companyId: string, wpId?: string | null, cashierId?: string | null) => Promise<PluGroupCacheRow[]>
        savePosSettings:    (settings: PosSettingsRow, cashierId?: string) => Promise<SyncResult>
        getPosSettings:     (cashierId?: string) => Promise<PosSettingsRow>
        updatePosWorkplaceTerminal: (data: Pick<
          PosSettingsRow,
          | 'terminalNumber' | 'workplaceName' | 'workplaceAddress' | 'workplacePhone'
          | 'workplaceCity' | 'workplaceDistrict' | 'workplaceTaxOffice' | 'workplaceTaxNo'
        >) => Promise<void>
        saveCommandHistory: (row: CommandHistoryRow) => Promise<void>
        getCommandHistory:  (limit?: number) => Promise<CommandHistoryRow[]>
        syncProductsAcid:   (items: ProductRow[], mode?: 'full' | 'diff') => Promise<SyncResult>
        syncPluGroupsAcid:  (groups: PluGroupCacheRow[], mode?: 'full' | 'diff') => Promise<SyncResult>
        deleteCashierPluForTerminal(terminalId: string): Promise<{ success: boolean }>
        syncCashiersAcid:   (cashiers: CashierRow[], companyId: string, mode?: 'full' | 'diff') => Promise<SyncResult>
        syncCustomersAcid:  (items: CustomerRow[], companyId: string, mode?: 'full' | 'diff') => Promise<SyncResult>
        getCustomers:       (companyId: string, query?: string) => Promise<CustomerRow[]>
        getCustomerById:    (companyId: string, id: string) => Promise<CustomerRow | null>
        getPendingInvoices: (onlyAnonymous?: boolean) => Promise<SaleDbRow[]>
        markInvoiceSent:   (saleId: string, invoiceId: string) => Promise<void>
        markInvoiceError:  (saleId: string, error: string) => Promise<void>
        getSaleItems:      (saleId: string) => Promise<SaleItemRow[]>
        getSaleByReceiptNo(receiptNo: string): Promise<{ id: string; receiptNo: string } | null>
        saveSalePayments:  (payments: SalePaymentRow[]) => Promise<void>
        getSalePayments:   (saleId: string) => Promise<SalePaymentRow[]>
        getCardTotalsByBank: (saleIds: string[]) => Promise<Record<string, { amount: number; acquirerName: string }>>
        getCashTotal:      (saleIds: string[]) => Promise<number>
        getProductByCode:  (code: string) => Promise<ProductRow | null>
        getProductByName:  (name: string) => Promise<{
          id: string; code: string; name: string; vatRate: number; unit: string
        } | null>
        getProductIdByCode: (code: string) => Promise<string | null>
        upsertCustomer:    (row: CustomerRow) => Promise<void>
        enqueueOperation:  (params: {
          id: string
          companyId: string
          type: 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice' | 'payment'
          payload: Record<string, unknown>
          label?: string
          status?: 'pending' | 'pending_dayend'
        }) => Promise<void>
        getPendingReturnInvoices(companyId: string): Promise<OperationQueueRow[]>
        markOperationDone(id: string): Promise<{ success: boolean }>
        getPendingOperations: (companyId: string) => Promise<OperationQueueRow[]>
        getAllOperations:  (companyId: string, limit?: number) => Promise<OperationQueueRow[]>
        markOperationProcessing: (id: string) => Promise<void>
        markOperationSuccess: (id: string) => Promise<void>
        markOperationFailed: (id: string, error: string) => Promise<void>
        retryOperation:    (id: string) => Promise<void>
        deleteOperation:   (id: string) => Promise<void>
        getSalesReport: (opts: { dateFrom: string; dateTo: string }) => Promise<SalesReportRow[]>
        getDayEndReport: (opts: { dateFrom: string; dateTo: string }) => Promise<Array<{
          id: string
          label: string | null
          status: string
          created_at: string
          sent_at: string | null
          error: string | null
        }>>
        saveCariPayment(row: {
          id: string
          companyId: string
          type: 'tahsilat' | 'odeme'
          amount: number
          customerId?: string
          customerName?: string
          customerCode?: string
          cashierId?: string
          cashierName?: string
          description?: string
          createdAt: string
        }): Promise<{ success: boolean }>
        getCariPayments(opts: { dateFrom: string; dateTo: string; companyId: string }): Promise<CariPaymentReportRow[]>
        getPaymentDeviceSettings: (provider?: string) => Promise<PaymentDeviceRow | undefined>
        upsertPaymentDeviceSettings: (row: PaymentDeviceRow) => Promise<void>
        nextPavoSequence: () => Promise<number>
        updatePavoSequence: (seq: number) => Promise<void>
        getUnitPavoCode: (unitName: string) => Promise<string>
        upsertUnitMapping: (row: { companyId: string; unitName: string; pavoCode: string }) => Promise<void>
        getAllUnitMappings: (companyId: string) => Promise<unknown[]>
        getLastSale: () => Promise<{ receiptNo: string; pavoSaleNumber: string | null; orderNo: string | null } | null>
        getRecentSales: (opts?: {
          limit?: number
          dateFrom?: string
          dateTo?: string
          timeFrom?: string
          timeTo?: string
        }) => Promise<RecentSaleRow[]>
      }
      cart: {
        saveDraft(opts: {
          companyId:  string
          terminalId: string
          cashierId:  string
          cart:       unknown[]
          customer:   unknown | null
        }): Promise<{ success: boolean }>
        loadDraft(): Promise<{
          cart:     unknown[]
          customer: unknown | null
          savedAt:  string
        } | null>
        clearDraft(): Promise<{ success: boolean }>
      }
      pavo: {
        getReturnableSale(opts: { searchBy: 'order' | 'sale'; query: string }): Promise<{
          success: boolean
          message?: string
          data?: {
            Id:           number
            SaleNumber:   string
            OrderNo?:     string | null
            CustomerInfo: { CustomerType?: number; CompanyName?: string; TaxNumber?: string; FirstName?: string } | null
            Items: Array<{
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
            }>
            Payments: Array<{
              Mediator:         number
              Amount:           number
              ReturnableAmount: number
              PaymentId:        number
            }>
          }
        }>
        partialReturn(opts: {
          relatedSaleId:  number
          addedSaleItems: Array<{
            relatedSaleItemId: number
            name:              string
            itemQuantity:      number
            unitPriceAmount:   number
            grossPriceAmount:  number
            totalPriceAmount:  number
            vatAmount:         number
            vatRate:           number
            unitName:          string
            taxGroupId:        number
            convertedTotal:    number
            returnAmount:      number
          }>
          paymentInformations: Array<{
            mediator:          number
            amount:            number
            isVoid:            boolean
            relatedPaymentId?: number
          }>
          receiptWidth?: '58mm' | '80mm'
        }): Promise<{ success: boolean; message?: string; data?: unknown }>
      }
      scale: {
        listPorts():  Promise<string[]>
        connect(opts: { portPath: string; baudRate: number }): Promise<{ success: boolean }>
        disconnect(): Promise<{ success: boolean }>
        getLastReading(): Promise<ScaleReading | null>
        saveSettings(s: { portPath: string; baudRate: number; enabled: boolean }): Promise<{ success: boolean }>
        getSettings(): Promise<{ port_path: string; baud_rate: number; enabled: number } | null>
        onData(cb: (reading: ScaleReading) => void): () => void
      }
    }
  }

  interface ScaleReading {
    weight:  number
    stable:  boolean
    unit:    'kg' | 'g'
    raw:     string
  }

  interface RecentSaleRow {
    id:             string
    receiptNo:      string
    pavoSaleNumber: string | null
    orderNo:        string | null
    netAmount:      number
    createdAt:      string
    customerName:   string | null
    cashierName:    string | null
  }

  interface CariPaymentReportRow {
    id:            string
    type:          'tahsilat' | 'odeme'
    amount:        number
    customer_name: string | null
    customer_code: string | null
    cashier_name:  string | null
    description:   string | null
    created_at:    string
  }

  interface SalesReportRow {
    id:           string
    receiptNo:    string
    orderNo:      string | null
    type:         'sale' | 'return' | 'payment'
    netAmount:    number
    cashAmount:   number
    cardAmount:   number
    customerName: string | null
    cashierName:  string | null
    createdAt:    string
    invoiceSent:  number
    invoiceId:    string | null
    invoiceError: string | null
    isReturn:     number
    payments: Array<{
      method:       string
      amount:       number
      acquirerName: string | null
    }>
  }

  interface OperationQueueRow {
    id:          string
    companyId:   string
    type:        'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice' | 'payment'
    payload:     string
    status:      'pending' | 'pending_dayend' | 'processing' | 'success' | 'failed' | 'done'
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
    productCode?:    string
    productName:     string
    quantity:        number
    unitPrice:       number
    vatRate:         number
    discountRate?:   number
    discountAmount?: number
    lineTotal:       number
    appliedBy?:      string
  }

  interface SaveSaleResult {
    saleId:    string
    receiptNo: string
  }

  interface SaleRow {
    receiptNo?:      string
    orderNo?:        string | null
    totalAmount:     number
    discountRate?:   number
    discountAmount?: number
    netAmount:       number
    paymentType:     'cash' | 'card' | 'mixed'
    cashAmount:      number
    cardAmount:      number
    cardAcquirerId?: string | null
    customerId?:     string | null
    customerName?:   string | null
    customerCode?:   string | null
    isReturn?:       boolean
  }

  /** SQLite sales satırı (fatura / listeler) */
  interface SaleDbRow {
    id:             string
    receiptNo:      string
    orderNo?:       string | null
    totalAmount:    number
    discountRate:   number | null
    discountAmount: number | null
    netAmount:      number
    paymentType:    string
    cashAmount:     number | null
    cardAmount:     number | null
    cardAcquirerId: string | null
    createdAt:      string
    synced:         boolean
    customerId:     string | null
    customerName:   string | null
    customerCode:   string | null
    invoiceSent:    number
    invoiceId:      string | null
    invoiceError:   string | null
    invoiceAt:      string | null
    paymentProvider: string | null
    paymentDeviceData: string | null
  }

  interface SaleItemRow {
    productId:    string | null
    productCode:  string
    productName:  string
    quantity:     number
    price:        number
    vatRate:      number
    unit:         string
    discountRate?: number
  }

  interface SalePaymentRow {
    id:            string
    saleId:        string
    method:        'cash' | 'card' | 'meal_card'
    amount:        number
    mediator?:     number | null
    acquirerId?:   string | null
    acquirerName?: string | null
    createdAt?:    string | null
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
    productId:      string
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
    id:            string
    companyId:     string
    receiptNo?:    string
    orderNo?:      string
    label?:        string
    items:         CartItem[]
    customer?:     CustomerRow | null
    customerName?: string
    cashierName?:  string
    totalAmount:   number
    discountRate?: number
    discountAmount?: number
    createdAt:     string
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
    email?:     string | null
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

  interface PaymentReceiptPrintOpts {
    terminalName:  string
    cashierName:   string
    date:          string
    customerName:  string
    customerCode:  string
    processType:   'tahsilat' | 'odeme'
    amount:        number
    description?:  string
  }

  interface PrinterSettingsDbRow {
    id?:            string
    terminal_id?:   string | null
    printer_type?:  'usb' | 'network'
    printer_name?:  string | null
    printer_ip?:    string | null
    printer_port?:  number
    paper_width?:   number
    is_active?:     number | boolean
    updated_at?:    string
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
    pluMode:              PluMode
    loginWithCode:        boolean
    loginWithCard:        boolean
    torbaCariId:          string | null
    torbaCariName:        string | null
    invoiceType:          'e_archive' | 'paper'
    touchKeyboard?:       boolean
    customerDisplay?:     boolean
    printBehavior?:       Record<string, 'default' | 'ask' | 'none'>
    defaultTemplateIds?:  Record<string, string>
    terminalNumber?:      string | null
    workplaceName?:       string | null
    workplaceAddress?:    string | null
    workplacePhone?:      string | null
    workplaceCity?:       string | null
    workplaceDistrict?:   string | null
    workplaceTaxOffice?:  string | null
    workplaceTaxNo?:      string | null
  }

  type PrintBehavior = 'default' | 'ask' | 'none'

  interface TemplateListItem {
    id:            string
    name:          string
    template_type: string
    is_default:    boolean
  }

  interface TemplatePrintResult {
    success:         boolean
    skipped?:        boolean
    needsSelection?: boolean
    templates?:      TemplateListItem[]
    data?:           Record<string, Record<string, unknown>>
    message?:        string
  }

  interface PaymentDeviceRow {
    id:              string
    companyId:       string
    terminalId:      string
    provider:        'pavo' | 'ingenico' | 'pax'
    ipAddress:       string | null
    port:            number
    serialNo:        string | null
    cardReadTimeout: number
    printWidth:      '58mm' | '80mm'
    isActive:        boolean
    syncedAt:        string | null
  }

  interface PaymentDeviceResult {
    success:      boolean
    provider:     'pavo' | 'ingenico' | 'pax' | string
    errorCode?:   number | string
    message?:     string
    authCode?:    string
    cardNo?:      string
    cardBrand?:   string
    cardType?:    string
    acquirer?:    string
    batchNo?:     string
    isOffline?:   boolean
    receiptUrl?:  string
    raw:          Record<string, unknown>
  }
}

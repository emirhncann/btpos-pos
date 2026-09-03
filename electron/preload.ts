import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
    getCartSettings: () => ipcRenderer.invoke('store:getCartSettings'),
    setCartSettings: (s: unknown) => ipcRenderer.invoke('store:setCartSettings', s),
  },
  device: {
    uid:  () => ipcRenderer.invoke('device:uid'),
    info: () => ipcRenderer.invoke('device:info'),
  },
  app: {
    version:      () => ipcRenderer.invoke('app:version'),
    restart:      () => ipcRenderer.invoke('app:restart'),
    requestExit:  () => ipcRenderer.invoke('app:requestExit'),
    onExitBlocked: (cb: (data: { heldCount: number }) => void) => {
      const handler = (_: IpcRendererEvent, data: { heldCount: number }) => cb(data)
      ipcRenderer.on('app:exit-blocked', handler)
      return () => { ipcRenderer.removeListener('app:exit-blocked', handler) }
    },
    openKeyboard: () => ipcRenderer.invoke('app:openKeyboard'),
    selectFolder: () => ipcRenderer.invoke('app:selectFolder'),
    reinitDb:     (p: string) => ipcRenderer.invoke('app:reinitDb', p),
  },
  window: {
    isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
    focusWindow: () => ipcRenderer.invoke('window:focus'),
    toggleDevTools: () => ipcRenderer.invoke('window:toggleDevTools'),
  },
  printer: {
    list: () => ipcRenderer.invoke('printer:list'),
    print: (printerName: string, dataB64: string) =>
      ipcRenderer.invoke('printer:print', printerName, dataB64),
    printRaw: (config: {
      type: 'usb' | 'network'
      printerName?: string
      ip?: string
      port?: number
    }, dataB64: string) => ipcRenderer.invoke('printer:printRaw', config, dataB64),
    getSettings: () => ipcRenderer.invoke('printer:getSettings'),
    saveSettings: (s: Record<string, unknown>) => ipcRenderer.invoke('printer:saveSettings', s),
    printPaymentReceipt: (opts: PaymentReceiptPrintOpts) =>
      ipcRenderer.invoke('printer:printPaymentReceipt', opts),
    testPrint: (settings: Record<string, unknown>) =>
      ipcRenderer.invoke('printer:testPrint', settings),
  },
  templates: {
    getAll: () => ipcRenderer.invoke('templates:getAll'),
    getByTrigger: (triggerType: string) => ipcRenderer.invoke('templates:getByTrigger', triggerType),
    getDefault: (triggerType: string) => ipcRenderer.invoke('templates:getDefault', triggerType),
    save: (templates: Record<string, unknown>[]) => ipcRenderer.invoke('templates:save', templates),
    printThermal: (opts: { triggerType: string; data: Record<string, Record<string, unknown>> }) =>
      ipcRenderer.invoke('templates:printThermal', opts),
    printPdf: (opts: { triggerType: string; data: Record<string, Record<string, unknown>> }) =>
      ipcRenderer.invoke('templates:printPdf', opts),
    printWithBehavior: (opts: {
      triggerType: string
      data: Record<string, Record<string, unknown>>
      templateId?: string
    }) => ipcRenderer.invoke('templates:printWithBehavior', opts),
  },
  secondScreen: {
    open: () => ipcRenderer.invoke('secondScreen:open'),
    update: (payload: SecondScreenPayload) => ipcRenderer.invoke('secondScreen:update', payload),
    close: () => ipcRenderer.invoke('secondScreen:close'),
    getLatest: () => ipcRenderer.invoke('secondScreen:getLatest'),
    onData: (listener: (payload: SecondScreenPayload) => void) => {
      const handler = (_event: unknown, payload: SecondScreenPayload) => listener(payload)
      ipcRenderer.on('secondScreen:data', handler)
      return () => ipcRenderer.removeListener('secondScreen:data', handler)
    },
  },
  db: {
    saveProducts:       (products: unknown[])                => ipcRenderer.invoke('db:saveProducts', products),
    getProducts:        ()                                   => ipcRenderer.invoke('db:getProducts'),
    saveSale:           (sale: unknown, items: unknown[], device?: unknown) =>
      ipcRenderer.invoke('db:saveSale', sale, items, device),
    getSales:           (dateFrom?: string, dateTo?: string) => ipcRenderer.invoke('db:getSales', dateFrom, dateTo),
    saveCashiers:       (cashiers: unknown[])                => ipcRenderer.invoke('db:saveCashiers', cashiers),
    verifyCashier:      (code: string, password: string)     => ipcRenderer.invoke('db:verifyCashier', code, password),
    verifyCashierByCard: (cardNumber: string) =>
      ipcRenderer.invoke('db:verifyCashierByCard', cardNumber),
    getAllCashiers:    ()                                   => ipcRenderer.invoke('db:getAllCashiers'),
    getCashiers:        ()                                   => ipcRenderer.invoke('db:getCashiers'),
    holdDocument:       (doc: unknown)                       => ipcRenderer.invoke('db:holdDocument', doc),
    getHeldDocuments:   (companyId: string)                  => ipcRenderer.invoke('db:getHeldDocuments', companyId),
    deleteHeldDocument: (id: string)                          => ipcRenderer.invoke('db:deleteHeldDocument', id),
    updateHeldDocumentLabel: (id: string, label: string)     => ipcRenderer.invoke('db:updateHeldDocumentLabel', id, label),
    savePluGroups:      (groups: unknown[])                  => ipcRenderer.invoke('db:savePluGroups', groups),
    getPluGroups:       (companyId: string, wpId?: string | null, cashierId?: string | null) =>
      ipcRenderer.invoke('db:getPluGroups', companyId, wpId, cashierId),
    savePosSettings:    (settings: unknown, cashierId?: string) =>
      ipcRenderer.invoke('db:savePosSettings', settings, cashierId),
    getPosSettings:     (cashierId?: string) =>
      ipcRenderer.invoke('db:getPosSettings', cashierId),
    updatePosWorkplaceTerminal: (data: unknown) =>
      ipcRenderer.invoke('db:updatePosWorkplaceTerminal', data),
    saveCommandHistory: (row: unknown)                        => ipcRenderer.invoke('db:saveCommandHistory', row),
    getCommandHistory:  (limit?: number)                     => ipcRenderer.invoke('db:getCommandHistory', limit),
    syncProductsAcid:   (items: unknown[], mode?: string)                      => ipcRenderer.invoke('db:syncProductsAcid', items, mode ?? 'full'),
    syncPluGroupsAcid:  (groups: unknown[], mode?: string)                    => ipcRenderer.invoke('db:syncPluGroupsAcid', groups, mode ?? 'full'),
    deleteCashierPluForTerminal: (terminalId: string) =>
      ipcRenderer.invoke('db:deleteCashierPluForTerminal', terminalId),
    syncCashiersAcid:   (cashiers: unknown[], companyId: string, mode?: string) => ipcRenderer.invoke('db:syncCashiersAcid', cashiers, companyId, mode ?? 'full'),
    syncCustomersAcid:  (items: unknown[], companyId: string, mode?: string) =>
      ipcRenderer.invoke('db:syncCustomersAcid', items, companyId, mode ?? 'full'),
    getCustomers:       (companyId: string, query?: string) =>
      ipcRenderer.invoke('db:getCustomers', companyId, query),
    getCustomerById:    (companyId: string, id: string) =>
      ipcRenderer.invoke('db:getCustomerById', companyId, id),
    getPendingInvoices: (onlyAnonymous?: boolean) =>
      ipcRenderer.invoke('db:getPendingInvoices', onlyAnonymous),
    markInvoiceSent:   (saleId: string, invoiceId: string) =>
      ipcRenderer.invoke('db:markInvoiceSent', saleId, invoiceId),
    markInvoiceError:  (saleId: string, error: string) =>
      ipcRenderer.invoke('db:markInvoiceError', saleId, error),
    getSaleItems:      (saleId: string) => ipcRenderer.invoke('db:getSaleItems', saleId),
    getSaleByReceiptNo: (receiptNo: string) => ipcRenderer.invoke('db:getSaleByReceiptNo', receiptNo),
    saveSalePayments: (payments: unknown) => ipcRenderer.invoke('db:saveSalePayments', payments),
    getSalePayments: (saleId: string) => ipcRenderer.invoke('db:getSalePayments', saleId),
    getCardTotalsByBank: (saleIds: string[]) => ipcRenderer.invoke('db:getCardTotalsByBank', saleIds),
    getCashTotal: (saleIds: string[]) => ipcRenderer.invoke('db:getCashTotal', saleIds),
    getProductByCode:  (code: string) => ipcRenderer.invoke('db:getProductByCode', code),
    getProductByName:  (name: string) => ipcRenderer.invoke('db:getProductByName', name),
    getProductIdByCode: (code: string) => ipcRenderer.invoke('db:getProductIdByCode', code),
    upsertCustomer:    (row: unknown) => ipcRenderer.invoke('db:upsertCustomer', row),
    enqueueOperation:  (params: unknown) => ipcRenderer.invoke('db:enqueueOperation', params),
    getPendingReturnInvoices: (companyId: string) =>
      ipcRenderer.invoke('db:getPendingReturnInvoices', companyId),
    markOperationDone: (id: string) =>
      ipcRenderer.invoke('db:markOperationDone', id),
    getPendingOperations: (companyId: string) =>
      ipcRenderer.invoke('db:getPendingOperations', companyId),
    getAllOperations:  (companyId: string, limit?: number) =>
      ipcRenderer.invoke('db:getAllOperations', companyId, limit),
    markOperationProcessing: (id: string) =>
      ipcRenderer.invoke('db:markOperationProcessing', id),
    markOperationSuccess: (id: string) =>
      ipcRenderer.invoke('db:markOperationSuccess', id),
    markOperationFailed: (id: string, error: string) =>
      ipcRenderer.invoke('db:markOperationFailed', id, error),
    retryOperation:    (id: string) => ipcRenderer.invoke('db:retryOperation', id),
    deleteOperation:   (id: string) => ipcRenderer.invoke('db:deleteOperation', id),
    getSalesReport: (opts: { dateFrom: string; dateTo: string }) =>
      ipcRenderer.invoke('db:getSalesReport', opts),
    getDayEndReport: (opts: { dateFrom: string; dateTo: string }) =>
      ipcRenderer.invoke('db:getDayEndReport', opts),
    saveCariPayment: (row: {
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
    }) => ipcRenderer.invoke('db:saveCariPayment', row),
    getCariPayments: (opts: { dateFrom: string; dateTo: string; companyId: string }) =>
      ipcRenderer.invoke('db:getCariPayments', opts),
    getPaymentDeviceSettings: (provider?: string) =>
      ipcRenderer.invoke('db:getPaymentDeviceSettings', provider),
    upsertPaymentDeviceSettings: (row: unknown) =>
      ipcRenderer.invoke('db:upsertPaymentDeviceSettings', row),
    nextPavoSequence: () => ipcRenderer.invoke('db:nextPavoSequence'),
    updatePavoSequence: (seq: number) => ipcRenderer.invoke('db:updatePavoSequence', seq),
    getUnitPavoCode: (unitName: string) => ipcRenderer.invoke('db:getUnitPavoCode', unitName),
    upsertUnitMapping: (row: { companyId: string; unitName: string; pavoCode: string }) =>
      ipcRenderer.invoke('db:upsertUnitMapping', row),
    getAllUnitMappings: (companyId: string) => ipcRenderer.invoke('db:getAllUnitMappings', companyId),
    getLastSale: () => ipcRenderer.invoke('db:getLastSale'),
    getRecentSales: (opts?: {
      limit?: number
      dateFrom?: string
      dateTo?: string
      timeFrom?: string
      timeTo?: string
    }) => ipcRenderer.invoke('db:getRecentSales', opts),
    saveEnabledBrands: (terminalId: string, brands: unknown[]) =>
      ipcRenderer.invoke('db:saveEnabledBrands', terminalId, brands),
    getEnabledBrands: (terminalId: string) =>
      ipcRenderer.invoke('db:getEnabledBrands', terminalId),
    saveBarcodeFormats: (terminalId: string, formats: unknown[]) =>
      ipcRenderer.invoke('db:saveBarcodeFormats', terminalId, formats),
    getBarcodeFormats: (terminalId: string) =>
      ipcRenderer.invoke('db:getBarcodeFormats', terminalId),
  },
  cart: {
    saveDraft: (opts: {
      companyId:  string
      terminalId: string
      cashierId:  string
      cart:       unknown[]
      customer:   unknown | null
    }) => ipcRenderer.invoke('cart:saveDraft', opts),
    loadDraft: () => ipcRenderer.invoke('cart:loadDraft'),
    clearDraft: () => ipcRenderer.invoke('cart:clearDraft'),
  },
  pavo: {
    log: (entry: {
      direction:   'REQUEST' | 'RESPONSE'
      endpoint:    string
      data:        unknown
      durationMs?: number
    }) => ipcRenderer.invoke('pavo:log', entry),
    getReturnableSale: (opts: { searchBy: 'order' | 'sale'; query: string }) =>
      ipcRenderer.invoke('pavo:getReturnableSale', opts),
    partialReturn: (opts: {
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
    }) => ipcRenderer.invoke('pavo:partialReturn', opts),
  },
  scale: {
    listPorts: () => ipcRenderer.invoke('scale:listPorts'),
    connect: (opts: { portPath: string; baudRate: number }) =>
      ipcRenderer.invoke('scale:connect', opts),
    disconnect: () => ipcRenderer.invoke('scale:disconnect'),
    getLastReading: () => ipcRenderer.invoke('scale:getLastReading'),
    write: (data: string) => ipcRenderer.invoke('scale:write', data),
    saveSettings: (s: { portPath: string; baudRate: number; enabled: boolean }) =>
      ipcRenderer.invoke('scale:saveSettings', s),
    getSettings: () => ipcRenderer.invoke('scale:getSettings'),
    onData: (cb: (reading: ScaleReading) => void) => {
      const handler = (_: unknown, r: ScaleReading) => cb(r)
      ipcRenderer.on('scale:data', handler)
      return () => ipcRenderer.removeListener('scale:data', handler)
    },
    onRaw: (cb: (raw: string) => void) => {
      const handler = (_: unknown, raw: string) => cb(raw)
      ipcRenderer.on('scale:raw', handler)
      return () => ipcRenderer.removeListener('scale:raw', handler)
    },
  },
})

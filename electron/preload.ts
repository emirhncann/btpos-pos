import { contextBridge, ipcRenderer } from 'electron'

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
    openKeyboard: () => ipcRenderer.invoke('app:openKeyboard'),
    selectFolder: () => ipcRenderer.invoke('app:selectFolder'),
    reinitDb:     (p: string) => ipcRenderer.invoke('app:reinitDb', p),
  },
  window: {
    isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
    toggleDevTools: () => ipcRenderer.invoke('window:toggleDevTools'),
  },
  db: {
    saveProducts:       (products: unknown[])                => ipcRenderer.invoke('db:saveProducts', products),
    getProducts:        ()                                   => ipcRenderer.invoke('db:getProducts'),
    saveSale:           (sale: unknown, items: unknown[])    => ipcRenderer.invoke('db:saveSale', sale, items),
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
    savePluGroups:      (groups: unknown[])                  => ipcRenderer.invoke('db:savePluGroups', groups),
    getPluGroups:       (companyId: string, wpId?: string | null, cashierId?: string | null) =>
      ipcRenderer.invoke('db:getPluGroups', companyId, wpId, cashierId),
    savePosSettings:    (settings: unknown, cashierId?: string) =>
      ipcRenderer.invoke('db:savePosSettings', settings, cashierId),
    getPosSettings:     (cashierId?: string) =>
      ipcRenderer.invoke('db:getPosSettings', cashierId),
    saveCommandHistory: (row: unknown)                        => ipcRenderer.invoke('db:saveCommandHistory', row),
    getCommandHistory:  (limit?: number)                     => ipcRenderer.invoke('db:getCommandHistory', limit),
    syncProductsAcid:   (items: unknown[], mode?: string)                      => ipcRenderer.invoke('db:syncProductsAcid', items, mode ?? 'full'),
    syncPluGroupsAcid:  (groups: unknown[], mode?: string)                    => ipcRenderer.invoke('db:syncPluGroupsAcid', groups, mode ?? 'full'),
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
  },
})

"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electron", {
  store: {
    get: (key) => electron.ipcRenderer.invoke("store:get", key),
    set: (key, value) => electron.ipcRenderer.invoke("store:set", key, value),
    getCartSettings: () => electron.ipcRenderer.invoke("store:getCartSettings"),
    setCartSettings: (s) => electron.ipcRenderer.invoke("store:setCartSettings", s)
  },
  device: {
    uid: () => electron.ipcRenderer.invoke("device:uid"),
    info: () => electron.ipcRenderer.invoke("device:info")
  },
  app: {
    version: () => electron.ipcRenderer.invoke("app:version"),
    restart: () => electron.ipcRenderer.invoke("app:restart"),
    openKeyboard: () => electron.ipcRenderer.invoke("app:openKeyboard"),
    selectFolder: () => electron.ipcRenderer.invoke("app:selectFolder"),
    reinitDb: (p) => electron.ipcRenderer.invoke("app:reinitDb", p)
  },
  window: {
    isFullscreen: () => electron.ipcRenderer.invoke("window:isFullscreen"),
    toggleFullscreen: () => electron.ipcRenderer.invoke("window:toggleFullscreen"),
    focusWindow: () => electron.ipcRenderer.invoke("window:focus"),
    toggleDevTools: () => electron.ipcRenderer.invoke("window:toggleDevTools")
  },
  printer: {
    list: () => electron.ipcRenderer.invoke("printer:list"),
    print: (printerName, dataB64) => electron.ipcRenderer.invoke("printer:print", printerName, dataB64),
    printRaw: (config, dataB64) => electron.ipcRenderer.invoke("printer:printRaw", config, dataB64),
    getSettings: () => electron.ipcRenderer.invoke("printer:getSettings"),
    saveSettings: (s) => electron.ipcRenderer.invoke("printer:saveSettings", s),
    printPaymentReceipt: (opts) => electron.ipcRenderer.invoke("printer:printPaymentReceipt", opts),
    testPrint: (settings) => electron.ipcRenderer.invoke("printer:testPrint", settings)
  },
  templates: {
    getAll: () => electron.ipcRenderer.invoke("templates:getAll"),
    getByTrigger: (triggerType) => electron.ipcRenderer.invoke("templates:getByTrigger", triggerType),
    getDefault: (triggerType) => electron.ipcRenderer.invoke("templates:getDefault", triggerType),
    save: (templates) => electron.ipcRenderer.invoke("templates:save", templates),
    printThermal: (opts) => electron.ipcRenderer.invoke("templates:printThermal", opts),
    printPdf: (opts) => electron.ipcRenderer.invoke("templates:printPdf", opts),
    printWithBehavior: (opts) => electron.ipcRenderer.invoke("templates:printWithBehavior", opts)
  },
  secondScreen: {
    open: () => electron.ipcRenderer.invoke("secondScreen:open"),
    update: (payload) => electron.ipcRenderer.invoke("secondScreen:update", payload),
    close: () => electron.ipcRenderer.invoke("secondScreen:close"),
    getLatest: () => electron.ipcRenderer.invoke("secondScreen:getLatest"),
    onData: (listener) => {
      const handler = (_event, payload) => listener(payload);
      electron.ipcRenderer.on("secondScreen:data", handler);
      return () => electron.ipcRenderer.removeListener("secondScreen:data", handler);
    }
  },
  db: {
    saveProducts: (products) => electron.ipcRenderer.invoke("db:saveProducts", products),
    getProducts: () => electron.ipcRenderer.invoke("db:getProducts"),
    saveSale: (sale, items, device) => electron.ipcRenderer.invoke("db:saveSale", sale, items, device),
    getSales: (dateFrom, dateTo) => electron.ipcRenderer.invoke("db:getSales", dateFrom, dateTo),
    saveCashiers: (cashiers) => electron.ipcRenderer.invoke("db:saveCashiers", cashiers),
    verifyCashier: (code, password) => electron.ipcRenderer.invoke("db:verifyCashier", code, password),
    verifyCashierByCard: (cardNumber) => electron.ipcRenderer.invoke("db:verifyCashierByCard", cardNumber),
    getAllCashiers: () => electron.ipcRenderer.invoke("db:getAllCashiers"),
    getCashiers: () => electron.ipcRenderer.invoke("db:getCashiers"),
    holdDocument: (doc) => electron.ipcRenderer.invoke("db:holdDocument", doc),
    getHeldDocuments: (companyId) => electron.ipcRenderer.invoke("db:getHeldDocuments", companyId),
    deleteHeldDocument: (id) => electron.ipcRenderer.invoke("db:deleteHeldDocument", id),
    updateHeldDocumentLabel: (id, label) => electron.ipcRenderer.invoke("db:updateHeldDocumentLabel", id, label),
    savePluGroups: (groups) => electron.ipcRenderer.invoke("db:savePluGroups", groups),
    getPluGroups: (companyId, wpId, cashierId) => electron.ipcRenderer.invoke("db:getPluGroups", companyId, wpId, cashierId),
    savePosSettings: (settings, cashierId) => electron.ipcRenderer.invoke("db:savePosSettings", settings, cashierId),
    getPosSettings: (cashierId) => electron.ipcRenderer.invoke("db:getPosSettings", cashierId),
    updatePosWorkplaceTerminal: (data) => electron.ipcRenderer.invoke("db:updatePosWorkplaceTerminal", data),
    saveCommandHistory: (row) => electron.ipcRenderer.invoke("db:saveCommandHistory", row),
    getCommandHistory: (limit) => electron.ipcRenderer.invoke("db:getCommandHistory", limit),
    syncProductsAcid: (items, mode) => electron.ipcRenderer.invoke("db:syncProductsAcid", items, mode ?? "full"),
    syncPluGroupsAcid: (groups, mode) => electron.ipcRenderer.invoke("db:syncPluGroupsAcid", groups, mode ?? "full"),
    deleteCashierPluForTerminal: (terminalId) => electron.ipcRenderer.invoke("db:deleteCashierPluForTerminal", terminalId),
    syncCashiersAcid: (cashiers, companyId, mode) => electron.ipcRenderer.invoke("db:syncCashiersAcid", cashiers, companyId, mode ?? "full"),
    syncCustomersAcid: (items, companyId, mode) => electron.ipcRenderer.invoke("db:syncCustomersAcid", items, companyId, mode ?? "full"),
    getCustomers: (companyId, query) => electron.ipcRenderer.invoke("db:getCustomers", companyId, query),
    getCustomerById: (companyId, id) => electron.ipcRenderer.invoke("db:getCustomerById", companyId, id),
    getPendingInvoices: (onlyAnonymous) => electron.ipcRenderer.invoke("db:getPendingInvoices", onlyAnonymous),
    markInvoiceSent: (saleId, invoiceId) => electron.ipcRenderer.invoke("db:markInvoiceSent", saleId, invoiceId),
    markInvoiceError: (saleId, error) => electron.ipcRenderer.invoke("db:markInvoiceError", saleId, error),
    getSaleItems: (saleId) => electron.ipcRenderer.invoke("db:getSaleItems", saleId),
    getSaleByReceiptNo: (receiptNo) => electron.ipcRenderer.invoke("db:getSaleByReceiptNo", receiptNo),
    saveSalePayments: (payments) => electron.ipcRenderer.invoke("db:saveSalePayments", payments),
    getSalePayments: (saleId) => electron.ipcRenderer.invoke("db:getSalePayments", saleId),
    getCardTotalsByBank: (saleIds) => electron.ipcRenderer.invoke("db:getCardTotalsByBank", saleIds),
    getCashTotal: (saleIds) => electron.ipcRenderer.invoke("db:getCashTotal", saleIds),
    getProductByCode: (code) => electron.ipcRenderer.invoke("db:getProductByCode", code),
    getProductByName: (name) => electron.ipcRenderer.invoke("db:getProductByName", name),
    getProductIdByCode: (code) => electron.ipcRenderer.invoke("db:getProductIdByCode", code),
    upsertCustomer: (row) => electron.ipcRenderer.invoke("db:upsertCustomer", row),
    enqueueOperation: (params) => electron.ipcRenderer.invoke("db:enqueueOperation", params),
    getPendingReturnInvoices: (companyId) => electron.ipcRenderer.invoke("db:getPendingReturnInvoices", companyId),
    markOperationDone: (id) => electron.ipcRenderer.invoke("db:markOperationDone", id),
    getPendingOperations: (companyId) => electron.ipcRenderer.invoke("db:getPendingOperations", companyId),
    getAllOperations: (companyId, limit) => electron.ipcRenderer.invoke("db:getAllOperations", companyId, limit),
    markOperationProcessing: (id) => electron.ipcRenderer.invoke("db:markOperationProcessing", id),
    markOperationSuccess: (id) => electron.ipcRenderer.invoke("db:markOperationSuccess", id),
    markOperationFailed: (id, error) => electron.ipcRenderer.invoke("db:markOperationFailed", id, error),
    retryOperation: (id) => electron.ipcRenderer.invoke("db:retryOperation", id),
    deleteOperation: (id) => electron.ipcRenderer.invoke("db:deleteOperation", id),
    getSalesReport: (opts) => electron.ipcRenderer.invoke("db:getSalesReport", opts),
    getDayEndReport: (opts) => electron.ipcRenderer.invoke("db:getDayEndReport", opts),
    saveCariPayment: (row) => electron.ipcRenderer.invoke("db:saveCariPayment", row),
    getCariPayments: (opts) => electron.ipcRenderer.invoke("db:getCariPayments", opts),
    getPaymentDeviceSettings: (provider) => electron.ipcRenderer.invoke("db:getPaymentDeviceSettings", provider),
    upsertPaymentDeviceSettings: (row) => electron.ipcRenderer.invoke("db:upsertPaymentDeviceSettings", row),
    nextPavoSequence: () => electron.ipcRenderer.invoke("db:nextPavoSequence"),
    updatePavoSequence: (seq) => electron.ipcRenderer.invoke("db:updatePavoSequence", seq),
    getUnitPavoCode: (unitName) => electron.ipcRenderer.invoke("db:getUnitPavoCode", unitName),
    upsertUnitMapping: (row) => electron.ipcRenderer.invoke("db:upsertUnitMapping", row),
    getAllUnitMappings: (companyId) => electron.ipcRenderer.invoke("db:getAllUnitMappings", companyId),
    getLastSale: () => electron.ipcRenderer.invoke("db:getLastSale"),
    getRecentSales: (opts) => electron.ipcRenderer.invoke("db:getRecentSales", opts)
  },
  cart: {
    saveDraft: (opts) => electron.ipcRenderer.invoke("cart:saveDraft", opts),
    loadDraft: () => electron.ipcRenderer.invoke("cart:loadDraft"),
    clearDraft: () => electron.ipcRenderer.invoke("cart:clearDraft")
  },
  pavo: {
    getReturnableSale: (opts) => electron.ipcRenderer.invoke("pavo:getReturnableSale", opts),
    partialReturn: (opts) => electron.ipcRenderer.invoke("pavo:partialReturn", opts)
  },
  scale: {
    listPorts: () => electron.ipcRenderer.invoke("scale:listPorts"),
    connect: (opts) => electron.ipcRenderer.invoke("scale:connect", opts),
    disconnect: () => electron.ipcRenderer.invoke("scale:disconnect"),
    getLastReading: () => electron.ipcRenderer.invoke("scale:getLastReading"),
    saveSettings: (s) => electron.ipcRenderer.invoke("scale:saveSettings", s),
    getSettings: () => electron.ipcRenderer.invoke("scale:getSettings"),
    onData: (cb) => {
      const handler = (_, r) => cb(r);
      electron.ipcRenderer.on("scale:data", handler);
      return () => electron.ipcRenderer.removeListener("scale:data", handler);
    },
    onRaw: (cb) => {
      const handler = (_, raw) => cb(raw);
      electron.ipcRenderer.on("scale:raw", handler);
      return () => electron.ipcRenderer.removeListener("scale:raw", handler);
    }
  }
});

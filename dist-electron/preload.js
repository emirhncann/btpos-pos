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
    toggleDevTools: () => electron.ipcRenderer.invoke("window:toggleDevTools")
  },
  db: {
    saveProducts: (products) => electron.ipcRenderer.invoke("db:saveProducts", products),
    getProducts: () => electron.ipcRenderer.invoke("db:getProducts"),
    saveSale: (sale, items) => electron.ipcRenderer.invoke("db:saveSale", sale, items),
    getSales: (dateFrom, dateTo) => electron.ipcRenderer.invoke("db:getSales", dateFrom, dateTo),
    saveCashiers: (cashiers) => electron.ipcRenderer.invoke("db:saveCashiers", cashiers),
    verifyCashier: (code, password) => electron.ipcRenderer.invoke("db:verifyCashier", code, password),
    verifyCashierByCard: (cardNumber) => electron.ipcRenderer.invoke("db:verifyCashierByCard", cardNumber),
    getAllCashiers: () => electron.ipcRenderer.invoke("db:getAllCashiers"),
    getCashiers: () => electron.ipcRenderer.invoke("db:getCashiers"),
    holdDocument: (doc) => electron.ipcRenderer.invoke("db:holdDocument", doc),
    getHeldDocuments: (companyId) => electron.ipcRenderer.invoke("db:getHeldDocuments", companyId),
    deleteHeldDocument: (id) => electron.ipcRenderer.invoke("db:deleteHeldDocument", id),
    savePluGroups: (groups) => electron.ipcRenderer.invoke("db:savePluGroups", groups),
    getPluGroups: (companyId, wpId, cashierId) => electron.ipcRenderer.invoke("db:getPluGroups", companyId, wpId, cashierId),
    savePosSettings: (settings, cashierId) => electron.ipcRenderer.invoke("db:savePosSettings", settings, cashierId),
    getPosSettings: (cashierId) => electron.ipcRenderer.invoke("db:getPosSettings", cashierId),
    saveCommandHistory: (row) => electron.ipcRenderer.invoke("db:saveCommandHistory", row),
    getCommandHistory: (limit) => electron.ipcRenderer.invoke("db:getCommandHistory", limit),
    syncProductsAcid: (items, mode) => electron.ipcRenderer.invoke("db:syncProductsAcid", items, mode ?? "full"),
    syncPluGroupsAcid: (groups, mode) => electron.ipcRenderer.invoke("db:syncPluGroupsAcid", groups, mode ?? "full"),
    syncCashiersAcid: (cashiers, companyId, mode) => electron.ipcRenderer.invoke("db:syncCashiersAcid", cashiers, companyId, mode ?? "full"),
    syncCustomersAcid: (items, companyId, mode) => electron.ipcRenderer.invoke("db:syncCustomersAcid", items, companyId, mode ?? "full"),
    getCustomers: (companyId, query) => electron.ipcRenderer.invoke("db:getCustomers", companyId, query),
    getCustomerById: (companyId, id) => electron.ipcRenderer.invoke("db:getCustomerById", companyId, id),
    getPendingInvoices: (onlyAnonymous) => electron.ipcRenderer.invoke("db:getPendingInvoices", onlyAnonymous),
    markInvoiceSent: (saleId, invoiceId) => electron.ipcRenderer.invoke("db:markInvoiceSent", saleId, invoiceId),
    markInvoiceError: (saleId, error) => electron.ipcRenderer.invoke("db:markInvoiceError", saleId, error),
    getSaleItems: (saleId) => electron.ipcRenderer.invoke("db:getSaleItems", saleId),
    upsertCustomer: (row) => electron.ipcRenderer.invoke("db:upsertCustomer", row),
    enqueueOperation: (params) => electron.ipcRenderer.invoke("db:enqueueOperation", params),
    getPendingOperations: (companyId) => electron.ipcRenderer.invoke("db:getPendingOperations", companyId),
    getAllOperations: (companyId, limit) => electron.ipcRenderer.invoke("db:getAllOperations", companyId, limit),
    markOperationProcessing: (id) => electron.ipcRenderer.invoke("db:markOperationProcessing", id),
    markOperationSuccess: (id) => electron.ipcRenderer.invoke("db:markOperationSuccess", id),
    markOperationFailed: (id, error) => electron.ipcRenderer.invoke("db:markOperationFailed", id, error),
    retryOperation: (id) => electron.ipcRenderer.invoke("db:retryOperation", id),
    deleteOperation: (id) => electron.ipcRenderer.invoke("db:deleteOperation", id)
  }
});

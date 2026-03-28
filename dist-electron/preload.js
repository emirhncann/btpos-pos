"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electron", {
  store: {
    get: (key) => electron.ipcRenderer.invoke("store:get", key),
    set: (key, value) => electron.ipcRenderer.invoke("store:set", key, value)
  },
  device: {
    uid: () => electron.ipcRenderer.invoke("device:uid"),
    info: () => electron.ipcRenderer.invoke("device:info")
  },
  app: {
    version: () => electron.ipcRenderer.invoke("app:version"),
    restart: () => electron.ipcRenderer.invoke("app:restart")
  },
  window: {
    isFullscreen: () => electron.ipcRenderer.invoke("window:isFullscreen"),
    toggleFullscreen: () => electron.ipcRenderer.invoke("window:toggleFullscreen")
  },
  db: {
    saveProducts: (products) => electron.ipcRenderer.invoke("db:saveProducts", products),
    getProducts: () => electron.ipcRenderer.invoke("db:getProducts"),
    saveSale: (sale, items) => electron.ipcRenderer.invoke("db:saveSale", sale, items),
    getSales: (dateFrom, dateTo) => electron.ipcRenderer.invoke("db:getSales", dateFrom, dateTo),
    saveCashiers: (cashiers) => electron.ipcRenderer.invoke("db:saveCashiers", cashiers),
    verifyCashier: (code, password) => electron.ipcRenderer.invoke("db:verifyCashier", code, password),
    getCashiers: () => electron.ipcRenderer.invoke("db:getCashiers")
  }
});

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  device: {
    uid:  () => ipcRenderer.invoke('device:uid'),
    info: () => ipcRenderer.invoke('device:info'),
  },
  app: {
    version:      () => ipcRenderer.invoke('app:version'),
    restart:      () => ipcRenderer.invoke('app:restart'),
    openKeyboard: () => ipcRenderer.invoke('app:openKeyboard'),
  },
  window: {
    isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  },
  db: {
    saveProducts:       (products: unknown[])                => ipcRenderer.invoke('db:saveProducts', products),
    getProducts:        ()                                   => ipcRenderer.invoke('db:getProducts'),
    saveSale:           (sale: unknown, items: unknown[])    => ipcRenderer.invoke('db:saveSale', sale, items),
    getSales:           (dateFrom?: string, dateTo?: string) => ipcRenderer.invoke('db:getSales', dateFrom, dateTo),
    saveCashiers:       (cashiers: unknown[])                => ipcRenderer.invoke('db:saveCashiers', cashiers),
    verifyCashier:      (code: string, password: string)     => ipcRenderer.invoke('db:verifyCashier', code, password),
    getCashiers:        ()                                   => ipcRenderer.invoke('db:getCashiers'),
    holdDocument:       (doc: unknown)                       => ipcRenderer.invoke('db:holdDocument', doc),
    getHeldDocuments:   (companyId: string)                  => ipcRenderer.invoke('db:getHeldDocuments', companyId),
    deleteHeldDocument: (id: string)                          => ipcRenderer.invoke('db:deleteHeldDocument', id),
    savePluGroups:      (groups: unknown[])                  => ipcRenderer.invoke('db:savePluGroups', groups),
    getPluGroups:       (companyId: string, wpId?: string)   => ipcRenderer.invoke('db:getPluGroups', companyId, wpId),
    savePosSettings:    (settings: unknown)                  => ipcRenderer.invoke('db:savePosSettings', settings),
    getPosSettings:     ()                                   => ipcRenderer.invoke('db:getPosSettings'),
    saveCommandHistory: (row: unknown)                        => ipcRenderer.invoke('db:saveCommandHistory', row),
    getCommandHistory:  (limit?: number)                     => ipcRenderer.invoke('db:getCommandHistory', limit),
  },
})

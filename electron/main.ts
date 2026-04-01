import { app, BrowserWindow, ipcMain, globalShortcut, Menu } from 'electron'
import { exec } from 'child_process'
import { join } from 'path'
import Store from 'electron-store'
import { initDB } from '../db/index'

import { getDeviceUID, getDeviceInfo } from './device'

const store = new Store()

let mainWindow: BrowserWindow | null = null

const isDev = !!process.env.VITE_DEV_SERVER_URL

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    kiosk:      !isDev,   // Production'da kiosk
    fullscreen: !isDev,   // Production'da tam ekran
    frame:      isDev,    // Geliştirmede çerçeve göster
    show: false,
  })

  // Menü çubuğunu (File/Edit/View/Help) kaldır
  Menu.setApplicationMenu(null)

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // F11 → tam ekran aç/kapat
  globalShortcut.register('F11', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })
}

app.whenReady().then(async () => {
  await initDB()

  createWindow()

  ipcMain.handle('app:restart', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('window:isFullscreen',   () => mainWindow?.isFullScreen() ?? false)
  ipcMain.handle('window:toggleFullscreen', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })

  ipcMain.handle('store:get', (_e, key) => store.get(key))
  ipcMain.handle('store:set', (_e, key, value) => store.set(key, value))
  ipcMain.handle('device:uid', () => getDeviceUID())
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('db:saveProducts', async (_e, prods) => {
    const { saveProducts } = await import('../db/operations')
    return saveProducts(prods)
  })

  ipcMain.handle('db:getProducts', async () => {
    const { getAllProducts } = await import('../db/operations')
    return getAllProducts()
  })

  ipcMain.handle('db:saveSale', async (_e, sale, items) => {
    const { saveSale } = await import('../db/operations')
    return saveSale(sale, items)
  })

  ipcMain.handle('db:getSales', async (_e, dateFrom, dateTo) => {
    const { getSales } = await import('../db/operations')
    return getSales(dateFrom, dateTo)
  })

  ipcMain.handle('device:info', () => {
    return getDeviceInfo()
  })

  ipcMain.handle('db:saveCashiers', async (_e, cashierList) => {
    const { saveCashiers } = await import('../db/operations')
    return saveCashiers(cashierList)
  })

  ipcMain.handle('db:verifyCashier', async (_e, code, password) => {
    const { verifyCashier } = await import('../db/operations')
    return verifyCashier(code, password)
  })

  ipcMain.handle('db:getCashiers', async () => {
    const { getAllCashiers } = await import('../db/operations')
    return getAllCashiers()
  })

  ipcMain.handle('app:openKeyboard', () => {
    if (process.platform !== 'win32') return
    exec('C:\\Windows\\System32\\osk.exe', err => {
      if (err) {
        exec('C:\\Program Files\\Common Files\\microsoft shared\\ink\\TabTip.exe')
      }
    })
  })

  ipcMain.handle('db:holdDocument', async (_e, doc) => {
    const { holdDocument } = await import('../db/operations')
    return holdDocument(doc)
  })

  ipcMain.handle('db:getHeldDocuments', async (_e, companyId: string) => {
    const { getHeldDocuments } = await import('../db/operations')
    return getHeldDocuments(companyId)
  })

  ipcMain.handle('db:deleteHeldDocument', async (_e, id: string) => {
    const { deleteHeldDocument } = await import('../db/operations')
    return deleteHeldDocument(id)
  })

  ipcMain.handle('db:savePluGroups', async (_e, groups: unknown) => {
    const { savePluGroups } = await import('../db/operations')
    savePluGroups(groups as import('../db/operations').PluGroupCacheRow[])
  })

  ipcMain.handle('db:getPluGroups', async (_e, companyId: string, wpId?: string | null) => {
    const { getPluGroups } = await import('../db/operations')
    return getPluGroups(companyId, wpId)
  })

  ipcMain.handle('db:savePosSettings', async (_e, settings: unknown) => {
    const { savePosSettings } = await import('../db/operations')
    savePosSettings(settings as import('../db/operations').PosSettingsRow)
  })

  ipcMain.handle('db:getPosSettings', async () => {
    const { getPosSettings } = await import('../db/operations')
    return getPosSettings()
  })

  ipcMain.handle('db:saveCommandHistory', async (_e, row: unknown) => {
    const { saveCommandHistory } = await import('../db/operations')
    saveCommandHistory(row as import('../db/operations').CommandHistoryRow)
  })

  ipcMain.handle('db:getCommandHistory', async (_e, limit?: number) => {
    const { getCommandHistory } = await import('../db/operations')
    return getCommandHistory(limit ?? 20)
  })

  ipcMain.handle('db:syncProductsAcid', async (_e, items, mode) => {
    const { syncProductsAcid } = await import('../db/operations')
    return syncProductsAcid(items as import('../db/operations').ProductRow[], (mode === 'diff' ? 'diff' : 'full'))
  })

  ipcMain.handle('db:syncPluGroupsAcid', async (_e, groups, mode) => {
    const { syncPluGroupsAcid } = await import('../db/operations')
    return syncPluGroupsAcid(groups as import('../db/operations').PluGroupCacheRow[], (mode === 'diff' ? 'diff' : 'full'))
  })

  ipcMain.handle('db:syncCashiersAcid', async (_e, cashierList, companyId, mode) => {
    const { syncCashiersAcid } = await import('../db/operations')
    return syncCashiersAcid(cashierList as import('../db/operations').CashierRow[], companyId, (mode === 'diff' ? 'diff' : 'full'))
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') app.quit()
})

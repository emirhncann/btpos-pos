import { app, BrowserWindow, ipcMain, globalShortcut, Menu, dialog } from 'electron'
import { exec } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import Store from 'electron-store'

import { getDeviceUID, getDeviceInfo } from './device'

const store = new Store()

interface CartSettingsMain {
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

const DEFAULT_CART_SETTINGS: CartSettingsMain = {
  showBarkod: false,
  showBirim: false,
  showKdv: true,
  showFiyat: true,
  showIskonto: false,
  fsUrunAdi: 13,
  fsUrunKod: 10,
  fsMiktar: 13,
  fsTutar: 13,
  fsTutarSub: 10,
  fsPill: 10,
}

function mergeCartSettings(raw: unknown): CartSettingsMain {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    showBarkod:  Boolean(o.showBarkod ?? DEFAULT_CART_SETTINGS.showBarkod),
    showBirim:   Boolean(o.showBirim ?? DEFAULT_CART_SETTINGS.showBirim),
    showKdv:     Boolean(o.showKdv ?? DEFAULT_CART_SETTINGS.showKdv),
    showFiyat:   Boolean(o.showFiyat ?? DEFAULT_CART_SETTINGS.showFiyat),
    showIskonto: Boolean(o.showIskonto ?? DEFAULT_CART_SETTINGS.showIskonto),
    fsUrunAdi:   Math.max(11, Math.min(18, Number(o.fsUrunAdi) || DEFAULT_CART_SETTINGS.fsUrunAdi)),
    fsUrunKod:   Math.max(9, Math.min(14, Number(o.fsUrunKod) || DEFAULT_CART_SETTINGS.fsUrunKod)),
    fsMiktar:    Math.max(11, Math.min(18, Number(o.fsMiktar) || DEFAULT_CART_SETTINGS.fsMiktar)),
    fsTutar:     Math.max(11, Math.min(18, Number(o.fsTutar) || DEFAULT_CART_SETTINGS.fsTutar)),
    fsTutarSub:  Math.max(9, Math.min(13, Number(o.fsTutarSub) || DEFAULT_CART_SETTINGS.fsTutarSub)),
    fsPill:      Math.max(9, Math.min(12, Number(o.fsPill) || DEFAULT_CART_SETTINGS.fsPill)),
  }
}

let mainWindow: BrowserWindow | null = null

const isDev = !!process.env.VITE_DEV_SERVER_URL

/** DevTools — kiosk/tam ekranda globalShortcut güvenilir olmadığı için odaklı pencerede tuş yakalanır. */
function toggleDevTools(): void {
  if (!mainWindow) return
  const wc = mainWindow.webContents
  if (wc.isDevToolsOpened()) {
    wc.closeDevTools()
  } else {
    wc.openDevTools({ mode: 'detach' })
  }
}

/** Görev çubuğu / pencere ikonu — dev: kaynak dosya, paket: extraResources */
function resolveAppIconPath(): string | undefined {
  if (app.isPackaged) {
    const p = join(process.resourcesPath, 'logo_bt.png')
    return existsSync(p) ? p : undefined
  }
  const devPath = join(__dirname, '..', 'src', 'assets', 'logo_bt.png')
  return existsSync(devPath) ? devPath : undefined
}

function createWindow() {
  const icon = resolveAppIconPath()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    ...(icon ? { icon } : {}),
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

  // F12 / Ctrl+Shift+I — before-input-event kiosk’ta globalShortcut’tan güvenilir
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') {
      event.preventDefault()
      toggleDevTools()
      return
    }
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (mod && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault()
      toggleDevTools()
    }
  })

  // DevTools için globalShortcut kullanma: odaklı pencerede F12 ile çift tetiklenme riski var.
  // Konsol gerekirse: pencereye tıklayıp F12 / Ctrl+Shift+I veya renderer’dan window.toggleDevTools().

  // F11 → tam ekran aç/kapat
  globalShortcut.register('F11', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })
}

if (process.platform === 'win32') {
  app.setAppUserModelId('tr.bolutekno.btpos')
}

app.whenReady().then(async () => {
  const savedDbDir = (store.get('db_path') as string | undefined)?.trim()
  const dbDir = savedDbDir && savedDbDir.length > 0 ? savedDbDir : app.getPath('userData')
  const { initDatabase } = await import('../db/index')
  initDatabase(join(dbDir, 'btpos.db'))

  createWindow()

  ipcMain.handle('app:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Veritabanı Klasörü Seç',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:reinitDb', async (_e, newPath: string) => {
    try {
      const { reinitDatabase } = await import('../db/index')
      reinitDatabase(newPath?.trim() || undefined)
      return { success: true as const }
    } catch (e) {
      return { success: false as const, error: String(e) }
    }
  })

  ipcMain.handle('store:getCartSettings', () => mergeCartSettings(store.get('cart_settings')))

  ipcMain.handle('store:setCartSettings', (_e, s: unknown) => {
    const merged = mergeCartSettings(s)
    store.set('cart_settings', merged)
    return { success: true as const }
  })

  ipcMain.handle('app:restart', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('window:isFullscreen',   () => mainWindow?.isFullScreen() ?? false)
  ipcMain.handle('window:toggleFullscreen', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })
  ipcMain.handle('window:toggleDevTools', () => {
    toggleDevTools()
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

  ipcMain.handle('db:getAllCashiers', async () => {
    const { getAllCashiers } = await import('../db/operations')
    return getAllCashiers()
  })

  ipcMain.handle('db:verifyCashier', async (_e, code, password) => {
    const { verifyCashier } = await import('../db/operations')
    return verifyCashier(code, password)
  })

  ipcMain.handle('db:verifyCashierByCard', async (_e, cardNumber: string) => {
    const { verifyCashierByCard } = await import('../db/operations')
    return verifyCashierByCard(cardNumber)
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

  ipcMain.handle('db:getPluGroups', async (_e, companyId: string, wpId?: string | null, cashierId?: string | null) => {
    const { getPluGroups } = await import('../db/operations')
    return getPluGroups(companyId, wpId, cashierId)
  })

  ipcMain.handle('db:savePosSettings', async (_e, settings: unknown, cashierId?: string) => {
    const { syncPosSettingsAcid } = await import('../db/operations')
    return syncPosSettingsAcid({
      ...(settings as import('../db/operations').PosSettingsRow),
      cashierId: cashierId ?? null,
    })
  })

  ipcMain.handle('db:getPosSettings', async (_e, cashierId?: string) => {
    const { getPosSettings } = await import('../db/operations')
    return getPosSettings(cashierId ?? null)
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

import { app, BrowserWindow, ipcMain, globalShortcut, Menu, dialog, screen } from 'electron'
import { exec } from 'child_process'
import { existsSync, mkdirSync, appendFileSync } from 'fs'
import { join, dirname } from 'path'
import type Database from 'better-sqlite3'
import Store from 'electron-store'

import { getDeviceUID, getDeviceInfo } from './device'
import { registerPrinterIpc } from './printerNative'
import { registerTemplatesIpc } from './templatesIpc'
import {
  listSerialPorts,
  connectScale,
  disconnectScale,
  getLastReading,
  writeScale,
  type ScaleReading,
} from './scaleService'

function pavoLocalISOString(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  const local = new Date(now.getTime() - offset)
  return local.toISOString().replace('Z', '').slice(0, 26)
}

function getPavoLogPath(): string {
  const exeDir  = dirname(process.execPath)
  const logsDir = join(exeDir, 'logs')

  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
  }

  const date = new Date().toISOString().slice(0, 10)
  return join(logsDir, `pavo_${date}.txt`)
}

function pavoTransactionHandle(serialNo: string, seq: number) {
  return {
    SerialNumber:        serialNo,
    TransactionDate:     pavoLocalISOString(),
    TransactionSequence: seq,
    Fingerprint:         'test1',
  }
}

function normalizePrintWidth(width: unknown): '58mm' | '80mm' {
  const raw = String(width ?? '').toLowerCase().trim()
  if (raw === '58' || raw === '58mm' || raw.includes('58')) return '58mm'
  return '80mm'
}

function getPavoPrinterCfg(db: Database.Database): {
  serial_no:   string
  ip_address:  string
  port:        number
  print_width: '58mm' | '80mm'
} | undefined {
  const row = db.prepare(`
    SELECT serial_no, ip_address, port, print_width FROM payment_device_settings
    WHERE provider = 'pavo' AND is_active = 1
    LIMIT 1
  `).get() as {
    serial_no?:   string
    ip_address?:  string
    port?:        number
    print_width?: string
  } | undefined
  if (!row?.ip_address) return undefined
  return {
    serial_no:   row.serial_no ?? '',
    ip_address:  row.ip_address,
    port:        row.port ?? 9100,
    print_width: normalizePrintWidth(row.print_width),
  }
}

function pavoBaseUrl(cfg: { ip_address: string; port: number }): string {
  return `http://${cfg.ip_address}:${cfg.port}`
}

function pavoReceiptInformation(printWidth: '58mm' | '80mm') {
  return {
    ReceiptImageEnabled:      false,
    ReceiptWidth:             printWidth,
    PrintCustomerReceipt:     true,
    PrintCustomerReceiptCopy: false,
    PrintMerchantReceipt:     true,
  }
}

function isPavoSequenceError(data: Record<string, unknown>): boolean {
  if ([72, 73].includes(Number(data.ErrorCode))) return true
  const msg = String(data.ErrorMessage ?? data.Message ?? '').toLocaleLowerCase('tr-TR')
  return msg.includes('sıra') || msg.includes('sequence') || msg.includes('seq')
}

function pavoRetryHandle(data: Record<string, unknown>): Record<string, unknown> | null {
  const handle = data.TransactionHandle as Record<string, unknown> | undefined
  if (!handle) return null
  if (handle.TransactionDate == null || handle.TransactionSequence == null) return null
  return handle
}

async function pavoPost(
  url: string,
  body: object,
  db?: Database.Database,
): Promise<Record<string, unknown>> {
  const postJson = async (payload: object): Promise<Record<string, unknown>> => {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const text = await res.text()
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      const preview = text.trim().slice(0, 160) || '(boş yanıt)'
      throw new Error(
        res.ok
          ? `Pavo JSON yanıtı bekleniyordu: ${preview}`
          : `Pavo HTTP ${res.status} — ${preview}`,
      )
    }
  }

  let data = await postJson(body)

  for (let attempt = 0; attempt < 2; attempt++) {
    const hasError = data.HasError === true || data.IsError === true
    if (!hasError) break

    if (db) syncPavoSequence(db, data)

    if (!isPavoSequenceError(data)) break

    const handle = pavoRetryHandle(data)
    if (!handle) break

    const retryBody = {
      ...(body as Record<string, unknown>),
      TransactionHandle: {
        ...((body as Record<string, unknown>).TransactionHandle as object),
        TransactionDate:     handle.TransactionDate,
        TransactionSequence: handle.TransactionSequence,
      },
    }
    data = await postJson(retryBody)
  }

  if (db) syncPavoSequence(db, data)

  return data
}

function allocPavoSequence(db: Database.Database): number {
  const row = db.prepare('SELECT seq FROM pavo_sequence WHERE id = 1').get() as { seq: number } | undefined
  const nextSeq = (row?.seq ?? 0) + 1
  db.prepare('UPDATE pavo_sequence SET seq = ? WHERE id = 1').run(nextSeq)
  return nextSeq
}

function syncPavoSequence(db: Database.Database, data: Record<string, unknown>): void {
  const handle = data.TransactionHandle as Record<string, unknown> | undefined
  const pavoSeq = Number(handle?.TransactionSequence)
  if (Number.isFinite(pavoSeq)) {
    db.prepare('UPDATE pavo_sequence SET seq = ? WHERE id = 1').run(pavoSeq)
  }
}

function extractPavoSale(data: Record<string, unknown>): Record<string, unknown> | null {
  if (data.Sale && typeof data.Sale === 'object') {
    return data.Sale as Record<string, unknown>
  }
  const inner = data.Data as Record<string, unknown> | undefined
  if (inner?.Sale && typeof inner.Sale === 'object') {
    return inner.Sale as Record<string, unknown>
  }
  if (inner && typeof inner === 'object' && inner.Id != null) {
    return inner
  }
  return null
}

function mapReturnableSaleItems(sale: Record<string, unknown>) {
  const rawItems = sale.AddedSaleItems ?? sale.Items ?? sale.SaleItems
  return (Array.isArray(rawItems) ? rawItems : []).map((row) => {
    const item = row as Record<string, unknown>
    const qty = Number(item.ItemQuantity ?? item.Quantity ?? 0)
    const returnableQty = Number(
      item.ReturnableQuantity ??
      item.RemainingReturnableQuantity ??
      item.ReturnableItemQuantity ??
      item.RemainingQuantity ??
      qty,
    )
    return {
      Id:                 Number(item.Id ?? item.RelatedSaleItemId ?? item.SaleItemId ?? 0),
      ProductName:        String(item.Name ?? item.ProductName ?? ''),
      Quantity:           qty,
      ReturnableQuantity: returnableQty,
      UnitPrice:          Number(item.UnitPriceAmount ?? item.UnitPrice ?? item.GrossPriceAmount ?? 0),
      TotalPrice:         Number(item.TotalPriceAmount ?? item.TotalPrice ?? 0),
      VatRate:            Number(item.VATRate ?? item.VatRate ?? 20),
      UnitName:           String(item.UnitName ?? item.Unit ?? 'Adet'),
      TaxGroupId:         Number(item.TaxGroupId ?? 74),
      ProductCode:        String(item.ProductCode ?? item.Barcode ?? item.Code ?? ''),
      StockRef:           Number(item.StockRef ?? item.stockRef ?? 0) || undefined,
      ProductId:          Number(item.ProductId ?? item.productId ?? 0) || undefined,
    }
  })
}

function mapReturnableSalePayments(sale: Record<string, unknown>) {
  const rawPayments = sale.AddedPayments ?? sale.Payments ?? sale.PaymentInformations
  return (Array.isArray(rawPayments) ? rawPayments : [])
    .filter(p => Number((p as Record<string, unknown>).StatusId ?? 2) === 2)
    .map((row) => {
      const p = row as Record<string, unknown>
      const amount = Number(p.PaymentAmount ?? p.Amount ?? 0)
      return {
        Mediator:         Number(p.PaymentMediatorId ?? p.Mediator ?? 0),
        Amount:           amount,
        ReturnableAmount: Number(
          p.RemainingVoidableAmount ?? p.ReturnableAmount ?? p.RemainingReturnableAmount ?? amount,
        ),
        PaymentId:        Number(p.Id ?? p.PaymentId ?? 0),
      }
    })
}

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
let customerWindow: BrowserWindow | null = null
let latestSecondScreenPayload: unknown = null
let isAppQuitting = false

type ExitCheckResult = { canExit: boolean; heldCount: number } | null

async function runExitCheck(win: BrowserWindow): Promise<ExitCheckResult> {
  return win.webContents.executeJavaScript(
    'window.__btpos_exit_check?.()',
  ).catch(() => null) as Promise<ExitCheckResult>
}

function notifyExitBlocked(win: BrowserWindow, heldCount: number): void {
  win.webContents.send('app:exit-blocked', { heldCount })
}

function setupMainWindowExitGuard(win: BrowserWindow) {
  win.on('close', (e) => {
    if (isAppQuitting) return

    e.preventDefault()
    void (async () => {
      const result = await runExitCheck(win)
      if (result && !result.canExit) {
        notifyExitBlocked(win, result.heldCount)
        return
      }
      isAppQuitting = true
      win.close()
    })()
  })

  win.on('focus', () => {
    if (!globalShortcut.isRegistered('Alt+F4')) {
      globalShortcut.register('Alt+F4', () => {
        void (async () => {
          if (!mainWindow || mainWindow.isDestroyed()) return
          const result = await runExitCheck(mainWindow)
          if (result?.canExit === false) {
            notifyExitBlocked(mainWindow, result.heldCount)
            return
          }
          isAppQuitting = true
          mainWindow.close()
        })()
      })
    }
  })

  win.on('blur', () => {
    if (globalShortcut.isRegistered('Alt+F4')) {
      globalShortcut.unregister('Alt+F4')
    }
  })
}

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

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.focus()
  })

  setupMainWindowExitGuard(mainWindow)

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

function getCustomerDisplayUrl(): { devUrl?: string; filePath?: string; query: Record<string, string> } {
  return {
    devUrl: process.env.VITE_DEV_SERVER_URL,
    filePath: join(__dirname, '../dist/index.html'),
    query: { screen: 'customer' },
  }
}

async function openCustomerWindow() {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const external = displays.find(d =>
    d.id !== primary.id ||
    d.bounds.x !== primary.bounds.x ||
    d.bounds.y !== primary.bounds.y ||
    d.bounds.width !== primary.bounds.width ||
    d.bounds.height !== primary.bounds.height,
  ) ?? null
  const targetBounds = external?.bounds

  if (customerWindow && !customerWindow.isDestroyed()) {
    if (external && targetBounds) {
      customerWindow.setBounds(targetBounds)
      customerWindow.setFullScreen(true)
      customerWindow.setKiosk(true)
      customerWindow.setAlwaysOnTop(true, 'screen-saver')
    } else {
      customerWindow.maximize()
    }
    customerWindow.show()
    customerWindow.focus()
    return
  }
  const icon = resolveAppIconPath()

  customerWindow = new BrowserWindow({
    x: targetBounds?.x,
    y: targetBounds?.y,
    width: targetBounds?.width ?? 1024,
    height: targetBounds?.height ?? 768,
    autoHideMenuBar: true,
    fullscreen: Boolean(external),
    kiosk: Boolean(external),
    frame: external ? false : isDev,
    show: false,
    alwaysOnTop: Boolean(external),
    resizable: !external,
    minimizable: !external,
    maximizable: !external,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const target = getCustomerDisplayUrl()
  if (isDev && target.devUrl) {
    const url = new URL(target.devUrl)
    url.searchParams.set('screen', 'customer')
    await customerWindow.loadURL(url.toString())
  } else if (target.filePath) {
    await customerWindow.loadFile(target.filePath, { query: target.query })
  }

  customerWindow.once('ready-to-show', () => {
    if (!customerWindow) return
    if (external && targetBounds) {
      customerWindow.setBounds(targetBounds)
      customerWindow.setFullScreen(true)
      customerWindow.setKiosk(true)
      customerWindow.setAlwaysOnTop(true, 'screen-saver')
    } else {
      customerWindow.maximize()
    }
    customerWindow.show()
  })
  customerWindow.on('closed', () => {
    customerWindow = null
  })
  customerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

function pushSecondScreenPayload(payload: unknown) {
  latestSecondScreenPayload = payload
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.webContents.send('secondScreen:data', payload)
  }
}

if (process.platform === 'win32') {
  app.setAppUserModelId('tr.bolutekno.btpos')
}

app.whenReady().then(async () => {
  const savedDbDir = (store.get('db_path') as string | undefined)?.trim()
  const dbDir = savedDbDir && savedDbDir.length > 0 ? savedDbDir : app.getPath('userData')
  const { initDatabase, getSqlite } = await import('../db/index')
  initDatabase(join(dbDir, 'btpos.db'))
  const db = getSqlite()
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_device_settings (
      id                TEXT PRIMARY KEY,
      company_id        TEXT NOT NULL,
      terminal_id       TEXT NOT NULL,
      provider          TEXT NOT NULL DEFAULT 'pavo',
      ip_address        TEXT,
      port              INTEGER DEFAULT 9100,
      serial_no         TEXT,
      card_read_timeout INTEGER DEFAULT 30,
      print_width       TEXT DEFAULT '80mm',
      is_active         INTEGER DEFAULT 1,
      synced_at         TEXT
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS unit_mappings (
      id          TEXT PRIMARY KEY,
      company_id  TEXT NOT NULL,
      unit_name   TEXT NOT NULL,
      pavo_code   TEXT NOT NULL DEFAULT 'C62',
      UNIQUE(company_id, unit_name)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pavo_sequence (
      id  INTEGER PRIMARY KEY,
      seq INTEGER NOT NULL DEFAULT 0
    )
  `)
  db.prepare('INSERT OR IGNORE INTO pavo_sequence (id, seq) VALUES (1, 0)').run()
  const salesCols = (db.prepare("PRAGMA table_info(sales)").all() as { name: string }[]).map(c => c.name)
  if (!salesCols.includes('card_acquirer_id')) db.exec(`ALTER TABLE sales ADD COLUMN card_acquirer_id TEXT`)
  if (!salesCols.includes('payment_provider')) db.exec(`ALTER TABLE sales ADD COLUMN payment_provider TEXT`)
  if (!salesCols.includes('payment_device_data')) db.exec(`ALTER TABLE sales ADD COLUMN payment_device_data TEXT`)
  if (!salesCols.includes('cashier_id')) db.exec(`ALTER TABLE sales ADD COLUMN cashier_id TEXT`)
  if (!salesCols.includes('cashier_name')) db.exec(`ALTER TABLE sales ADD COLUMN cashier_name TEXT`)
  if (!salesCols.includes('is_return')) db.exec(`ALTER TABLE sales ADD COLUMN is_return INTEGER DEFAULT 0`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_payments (
      id            TEXT PRIMARY KEY,
      sale_id       TEXT NOT NULL,
      method        TEXT NOT NULL,
      amount        REAL NOT NULL,
      mediator      INTEGER,
      acquirer_id   TEXT,
      acquirer_name TEXT,
      cashier_id    TEXT,
      cashier_name  TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `)
  const spCols = (db.prepare("PRAGMA table_info(sale_payments)").all() as { name: string }[]).map(c => c.name)
  if (!spCols.includes('cashier_id')) db.exec(`ALTER TABLE sale_payments ADD COLUMN cashier_id TEXT`)
  if (!spCols.includes('cashier_name')) db.exec(`ALTER TABLE sale_payments ADD COLUMN cashier_name TEXT`)

  const custCols = (db.prepare('PRAGMA table_info(customers)').all() as { name: string }[]).map(c => c.name)
  if (!custCols.includes('email')) db.exec(`ALTER TABLE customers ADD COLUMN email TEXT`)
  const custTempCols = (db.prepare('PRAGMA table_info(customers_temp)').all() as { name: string }[]).map(c => c.name)
  if (!custTempCols.includes('email')) db.exec(`ALTER TABLE customers_temp ADD COLUMN email TEXT`)

  const posCols = (db.prepare('PRAGMA table_info(pos_settings_cache)').all() as { name: string }[]).map(c => c.name)
  if (!posCols.includes('touch_keyboard')) {
    db.exec('ALTER TABLE pos_settings_cache ADD COLUMN touch_keyboard INTEGER DEFAULT 1')
  }
  const posTempCols = (db.prepare('PRAGMA table_info(pos_settings_temp)').all() as { name: string }[]).map(c => c.name)
  if (!posTempCols.includes('touch_keyboard')) {
    db.exec('ALTER TABLE pos_settings_temp ADD COLUMN touch_keyboard INTEGER DEFAULT 1')
  }
  if (!posCols.includes('customer_display')) {
    db.exec('ALTER TABLE pos_settings_cache ADD COLUMN customer_display INTEGER DEFAULT 1')
  }
  if (!posTempCols.includes('customer_display')) {
    db.exec('ALTER TABLE pos_settings_temp ADD COLUMN customer_display INTEGER DEFAULT 1')
  }
  const workplaceCols = [
    'terminal_number', 'workplace_name', 'workplace_address',
    'workplace_phone', 'workplace_city', 'workplace_district',
    'workplace_tax_office', 'workplace_tax_no',
  ] as const
  for (const col of workplaceCols) {
    if (!posCols.includes(col)) {
      db.exec(`ALTER TABLE pos_settings_cache ADD COLUMN ${col} TEXT`)
    }
    if (!posTempCols.includes(col)) {
      db.exec(`ALTER TABLE pos_settings_temp ADD COLUMN ${col} TEXT`)
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS cart_draft (
      id          TEXT PRIMARY KEY DEFAULT 'current',
      company_id  TEXT,
      terminal_id TEXT,
      cashier_id  TEXT,
      cart        TEXT NOT NULL DEFAULT '[]',
      customer    TEXT,
      saved_at    TEXT
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS cari_payments (
      id            TEXT PRIMARY KEY,
      company_id    TEXT NOT NULL,
      type          TEXT NOT NULL,
      amount        REAL NOT NULL,
      customer_id   TEXT,
      customer_name TEXT,
      customer_code TEXT,
      cashier_id    TEXT,
      cashier_name  TEXT,
      description   TEXT,
      created_at    TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scale_settings (
      id        INTEGER PRIMARY KEY DEFAULT 1,
      port_path TEXT,
      baud_rate INTEGER DEFAULT 9600,
      enabled   INTEGER DEFAULT 0
    )
  `)
  db.prepare('INSERT OR IGNORE INTO scale_settings (id) VALUES (1)').run()

  function broadcastScaleData(reading: ScaleReading) {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('scale:data', reading)
    })
  }

  function broadcastScaleRaw(raw: string) {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('scale:raw', raw)
    })
  }

  function autoConnectScale() {
    try {
      const settings = db.prepare('SELECT * FROM scale_settings WHERE id=1').get() as {
        port_path: string | null
        baud_rate: number | null
        enabled: number | null
      } | undefined
      if (!settings?.enabled || !settings.port_path) return

      void connectScale({
        portPath: settings.port_path,
        baudRate: settings.baud_rate ?? 9600,
        onData: broadcastScaleData,
        onRaw: broadcastScaleRaw,
      }).then(r => {
        if (r.success) console.log('[scale] Otomatik bağlandı:', settings.port_path)
        else console.warn('[scale] Otomatik bağlantı başarısız:', r.error)
      })
    } catch (e) {
      console.warn('[scale] Otomatik bağlantı hatası:', e)
    }
  }

  registerPrinterIpc(ipcMain, db)
  registerTemplatesIpc(ipcMain, db)

  ipcMain.handle('scale:listPorts', async () => listSerialPorts())

  ipcMain.handle('scale:connect', async (_e, opts: { portPath: string; baudRate: number }) => {
    return connectScale({
      portPath: opts.portPath,
      baudRate: opts.baudRate,
      onData: broadcastScaleData,
      onRaw: broadcastScaleRaw,
    })
  })

  ipcMain.handle('scale:disconnect', () => {
    disconnectScale()
    return { success: true }
  })

  ipcMain.handle('scale:getLastReading', () => getLastReading())

  ipcMain.handle('scale:write', (_e, data: string) => writeScale(data))

  ipcMain.handle('scale:saveSettings', (_e, settings: {
    portPath: string
    baudRate: number
    enabled: boolean
  }) => {
    db.prepare(`
      UPDATE scale_settings SET port_path=?, baud_rate=?, enabled=? WHERE id=1
    `).run(settings.portPath, settings.baudRate, settings.enabled ? 1 : 0)
    return { success: true }
  })

  ipcMain.handle('scale:getSettings', () => {
    try {
      return db.prepare('SELECT * FROM scale_settings WHERE id=1').get() ?? null
    } catch {
      return null
    }
  })

  createWindow()
  void autoConnectScale()

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

  ipcMain.handle('app:requestExit', () => {
    mainWindow?.close()
  })

  ipcMain.handle('window:isFullscreen',   () => mainWindow?.isFullScreen() ?? false)
  ipcMain.handle('window:toggleFullscreen', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })
  ipcMain.handle('window:focus', () => {
    if (!mainWindow) return
    mainWindow.focus()
    mainWindow.webContents.focus()
  })
  ipcMain.handle('window:toggleDevTools', () => {
    toggleDevTools()
  })

  ipcMain.handle('secondScreen:open', async () => {
    try {
      await openCustomerWindow()
      if (latestSecondScreenPayload && customerWindow && !customerWindow.isDestroyed()) {
        customerWindow.webContents.send('secondScreen:data', latestSecondScreenPayload)
      }
      return { success: true as const }
    } catch (error) {
      return { success: false as const, error: String(error) }
    }
  })
  ipcMain.handle('secondScreen:update', async (_e, payload: unknown) => {
    try {
      pushSecondScreenPayload(payload)
      return { success: true as const }
    } catch (error) {
      return { success: false as const, error: String(error) }
    }
  })
  ipcMain.handle('secondScreen:close', () => {
    try {
      if (customerWindow && !customerWindow.isDestroyed()) {
        customerWindow.close()
      }
      customerWindow = null
      return { success: true as const }
    } catch (error) {
      return { success: false as const, error: String(error) }
    }
  })
  ipcMain.handle('secondScreen:getLatest', () => latestSecondScreenPayload)

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

  ipcMain.handle('db:saveSale', async (_e, sale, items, device) => {
    const { saveSale } = await import('../db/operations')
    return saveSale(sale, items, device)
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

  ipcMain.handle('db:verifyCashierByCard', async (_e, cardNumber: string) => {
    const { verifyCashierByCard } = await import('../db/operations')
    return verifyCashierByCard(cardNumber)
  })

  ipcMain.handle('db:getCashiers', async () => {
    const { getAllCashiers } = await import('../db/operations')
    return getAllCashiers()
  })

  ipcMain.handle('db:getAllCashiers', async () => {
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

  ipcMain.handle('db:updateHeldDocumentLabel', async (_e, id: string, label: string) => {
    const { updateHeldDocumentLabel } = await import('../db/operations')
    updateHeldDocumentLabel(id, label)
    return { success: true as const }
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

  ipcMain.handle('db:updatePosWorkplaceTerminal', async (_e, data: unknown) => {
    const { updatePosWorkplaceTerminalCache } = await import('../db/operations')
    updatePosWorkplaceTerminalCache(data as import('../db/operations').PosSettingsRow)
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

  ipcMain.handle('db:deleteCashierPluForTerminal', async (_e, terminalId: string) => {
    const { deleteCashierPluForTerminal } = await import('../db/operations')
    deleteCashierPluForTerminal(terminalId)
    return { success: true }
  })

  ipcMain.handle('db:syncCashiersAcid', async (_e, cashierList, companyId, mode) => {
    const { syncCashiersAcid } = await import('../db/operations')
    return syncCashiersAcid(cashierList as import('../db/operations').CashierRow[], companyId, (mode === 'diff' ? 'diff' : 'full'))
  })

  ipcMain.handle('db:syncCustomersAcid', async (_e, items, companyId, mode) => {
    const { syncCustomersAcid } = await import('../db/operations')
    return syncCustomersAcid(items as import('../db/operations').CustomerRow[], companyId, (mode === 'diff' ? 'diff' : 'full'))
  })

  ipcMain.handle('db:getCustomers', async (_e, companyId: string, query?: string) => {
    const { getCustomers } = await import('../db/operations')
    return getCustomers(companyId, query)
  })

  ipcMain.handle('db:getCustomerById', async (_e, companyId: string, id: string) => {
    const { getCustomerById } = await import('../db/operations')
    return getCustomerById(companyId, id)
  })

  ipcMain.handle('db:getPendingInvoices', async (_e, onlyAnonymous = false) => {
    const { getPendingInvoices } = await import('../db/operations')
    return getPendingInvoices(onlyAnonymous)
  })
  ipcMain.handle('db:markInvoiceSent', async (_e, saleId: string, invoiceId: string) => {
    const { markInvoiceSent } = await import('../db/operations')
    markInvoiceSent(saleId, invoiceId)
  })
  ipcMain.handle('db:markInvoiceError', async (_e, saleId: string, error: string) => {
    const { markInvoiceError } = await import('../db/operations')
    markInvoiceError(saleId, error)
  })
  ipcMain.handle('db:getSaleItems', async (_e, saleId: string) => {
    const { getSaleItems } = await import('../db/operations')
    return getSaleItems(saleId)
  })
  ipcMain.handle('db:getSaleByReceiptNo', async (_e, receiptNo: string) => {
    const { getSaleByReceiptNo } = await import('../db/operations')
    return getSaleByReceiptNo(receiptNo)
  })
  ipcMain.handle('db:saveSalePayments', async (_e, payments: unknown) => {
    const { saveSalePayments } = await import('../db/operations')
    saveSalePayments(db, payments as import('../db/operations').SalePaymentRow[])
  })
  ipcMain.handle('db:getSalePayments', async (_e, saleId: string) => {
    const { getSalePayments } = await import('../db/operations')
    return getSalePayments(db, saleId)
  })
  ipcMain.handle('db:getCardTotalsByBank', async (_e, saleIds: string[]) => {
    const { getCardTotalsByBank } = await import('../db/operations')
    return getCardTotalsByBank(db, saleIds)
  })
  ipcMain.handle('db:getCashTotal', async (_e, saleIds: string[]) => {
    const { getCashTotal } = await import('../db/operations')
    return getCashTotal(db, saleIds)
  })
  ipcMain.handle('db:getProductByCode', async (_e, code: string) => {
    const { getProductByCode } = await import('../db/operations')
    return getProductByCode(code)
  })
  ipcMain.handle('db:getProductByName', async (_e, name: string) => {
    const { getProductByName } = await import('../db/operations')
    return getProductByName(name)
  })
  ipcMain.handle('db:getProductIdByCode', async (_e, code: string) => {
    const { getProductIdByCode } = await import('../db/operations')
    return getProductIdByCode(code)
  })

  ipcMain.handle('db:upsertCustomer', async (_e, row: unknown) => {
    const { upsertCustomer } = await import('../db/operations')
    upsertCustomer(row as import('../db/operations').CustomerRow)
  })

  ipcMain.handle('db:enqueueOperation', async (_e, params: {
    id: string
    companyId: string
    type: 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice' | 'payment'
    payload: Record<string, unknown>
    label?: string
    status?: 'pending' | 'pending_dayend'
  }) => {
    const { enqueueOperation } = await import('../db/operations')
    enqueueOperation(params)
  })

  ipcMain.handle('db:getPendingReturnInvoices', async (_e, companyId: string) => {
    const { getPendingReturnInvoices } = await import('../db/operations')
    return getPendingReturnInvoices(companyId)
  })

  ipcMain.handle('db:markOperationDone', async (_e, id: string) => {
    const { markOperationDone } = await import('../db/operations')
    markOperationDone(id)
    return { success: true as const }
  })

  ipcMain.handle('db:getPendingOperations', async (_e, companyId: string) => {
    const { getPendingOperations } = await import('../db/operations')
    return getPendingOperations(companyId)
  })

  ipcMain.handle('db:getAllOperations', async (_e, companyId: string, limit?: number) => {
    const { getAllOperations } = await import('../db/operations')
    return getAllOperations(companyId, limit ?? 100)
  })

  ipcMain.handle('db:markOperationProcessing', async (_e, id: string) => {
    const { markOperationProcessing } = await import('../db/operations')
    markOperationProcessing(id)
  })

  ipcMain.handle('db:markOperationSuccess', async (_e, id: string) => {
    const { markOperationSuccess } = await import('../db/operations')
    markOperationSuccess(id)
  })

  ipcMain.handle('db:markOperationFailed', async (_e, id: string, error: string) => {
    const { markOperationFailed } = await import('../db/operations')
    markOperationFailed(id, error)
  })

  ipcMain.handle('db:retryOperation', async (_e, id: string) => {
    const { retryOperation } = await import('../db/operations')
    retryOperation(id)
  })

  ipcMain.handle('db:deleteOperation', async (_e, id: string) => {
    const { deleteOperation } = await import('../db/operations')
    deleteOperation(id)
  })

  ipcMain.handle('db:getSalesReport', async (_e, opts: { dateFrom: string; dateTo: string }) => {
    const { getSalesReport } = await import('../db/operations')
    return getSalesReport(opts)
  })

  ipcMain.handle('db:getDayEndReport', async (_e, opts: { dateFrom: string; dateTo: string }) => {
    const { getDayEndReport } = await import('../db/operations')
    return getDayEndReport(opts)
  })

  ipcMain.handle('db:saveCariPayment', async (_e, row: unknown) => {
    const { saveCariPayment } = await import('../db/operations')
    saveCariPayment(row as import('../db/operations').CariPaymentSaveRow)
    return { success: true }
  })

  ipcMain.handle('db:getCariPayments', async (_e, opts: { dateFrom: string; dateTo: string; companyId: string }) => {
    const { getCariPayments } = await import('../db/operations')
    return getCariPayments(opts)
  })

  ipcMain.handle('db:getPaymentDeviceSettings', async (_e, provider?: string) => {
    const { getPaymentDeviceSettings } = await import('../db/operations')
    return getPaymentDeviceSettings(provider ?? 'pavo')
  })

  ipcMain.handle('db:upsertPaymentDeviceSettings', async (_e, row: unknown) => {
    const { upsertPaymentDeviceSettings } = await import('../db/operations')
    upsertPaymentDeviceSettings(row as import('../db/operations').PaymentDeviceRow)
  })

  ipcMain.handle('db:nextPavoSequence', async () => {
    const { nextPavoSequence } = await import('../db/operations')
    return nextPavoSequence()
  })
  ipcMain.handle('db:updatePavoSequence', async (_e, seq: number) => {
    const { updatePavoSequence } = await import('../db/operations')
    updatePavoSequence(seq)
  })
  ipcMain.handle('db:getUnitPavoCode', async (_e, unitName: string) => {
    const { getUnitPavoCode } = await import('../db/operations')
    return getUnitPavoCode(db, unitName)
  })
  ipcMain.handle('db:upsertUnitMapping', async (_e, row: { companyId: string; unitName: string; pavoCode: string }) => {
    const { upsertUnitMapping } = await import('../db/operations')
    upsertUnitMapping(db, row)
  })
  ipcMain.handle('db:getAllUnitMappings', async (_e, companyId: string) => {
    const { getAllUnitMappings } = await import('../db/operations')
    return getAllUnitMappings(db, companyId)
  })

  ipcMain.handle('db:getLastSale', async () => {
    const { getLastSale } = await import('../db/operations')
    return getLastSale()
  })

  ipcMain.handle('db:getRecentSales', async (_e, opts?: import('../db/operations').GetRecentSalesOpts) => {
    const { getRecentSales } = await import('../db/operations')
    return getRecentSales(opts ?? { limit: 20 })
  })

  ipcMain.handle('cart:saveDraft', (_e, opts: {
    companyId:  string
    terminalId: string
    cashierId:  string
    cart:       unknown[]
    customer:   unknown | null
  }) => {
    db.prepare(`
      INSERT INTO cart_draft (id, company_id, terminal_id, cashier_id, cart, customer, saved_at)
      VALUES ('current', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        company_id  = excluded.company_id,
        terminal_id = excluded.terminal_id,
        cashier_id  = excluded.cashier_id,
        cart        = excluded.cart,
        customer    = excluded.customer,
        saved_at    = excluded.saved_at
    `).run(
      opts.companyId,
      opts.terminalId,
      opts.cashierId,
      JSON.stringify(opts.cart),
      opts.customer ? JSON.stringify(opts.customer) : null,
      new Date().toISOString(),
    )
    return { success: true as const }
  })

  ipcMain.handle('cart:loadDraft', () => {
    const row = db.prepare('SELECT * FROM cart_draft WHERE id = ?').get('current') as Record<string, unknown> | undefined
    if (!row) return null
    return {
      cart:     row.cart     ? JSON.parse(row.cart as string)     : [],
      customer: row.customer ? JSON.parse(row.customer as string) : null,
      savedAt:  row.saved_at as string,
    }
  })

  ipcMain.handle('cart:clearDraft', () => {
    db.prepare('DELETE FROM cart_draft WHERE id = ?').run('current')
    return { success: true as const }
  })

  ipcMain.handle('pavo:log', (_e, entry: {
    direction:   'REQUEST' | 'RESPONSE'
    endpoint:    string
    data:        unknown
    durationMs?: number
  }) => {
    try {
      const now = new Date()
      const ts  = now.toLocaleString('tr-TR', {
        year:   'numeric', month:  '2-digit', day:    '2-digit',
        hour:   '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      })

      const lines: string[] = []
      lines.push(`[${ts}] ${entry.direction} — ${entry.endpoint}`)

      if (entry.direction === 'RESPONSE' && entry.durationMs !== undefined) {
        lines.push(`         Süre: ${entry.durationMs}ms`)
      }

      lines.push(
        JSON.stringify(entry.data, null, 2)
          .split('\n')
          .map(l => '  ' + l)
          .join('\n')
      )

      lines.push('─'.repeat(80))

      appendFileSync(getPavoLogPath(), lines.join('\n') + '\n')
    } catch (e) {
      console.warn('[pavo:log] Yazma hatası:', e)
    }
  })

  ipcMain.handle('pavo:getReturnableSale', async (_e, opts: {
    searchBy: 'order' | 'sale'
    query:    string
  }) => {
    try {
      const printerCfg = getPavoPrinterCfg(db)
      if (!printerCfg) return { success: false, message: 'Pavo ayarı yok veya cihaz pasif' }

      const query = opts.query.trim()
      if (!query) return { success: false, message: 'Arama değeri boş' }

      const nextSeq = allocPavoSequence(db)

      const salePayload: Record<string, unknown> = {
        ReceiptImageEnabled: false,
        ReceiptJsonEnabled:  false,
        ReceiptTextEnabled:  false,
      }
      if (opts.searchBy === 'sale') {
        salePayload.SaleNumber = query
      } else {
        salePayload.OrderNo = query
      }

      const body = {
        TransactionHandle: pavoTransactionHandle(printerCfg.serial_no, nextSeq),
        Sale: salePayload,
      }

      const data = await pavoPost(`${pavoBaseUrl(printerCfg)}/GetReturnableSale`, body, db)

      if (data.HasError || data.IsError) {
        return {
          success: false,
          message: String(data.ErrorMessage ?? data.Message ?? 'Satış bulunamadı'),
        }
      }

      const sale = extractPavoSale(data)
      if (!sale) {
        return { success: false, message: 'Satış bulunamadı' }
      }

      const customerRaw = sale.CustomerInfo ?? sale.CustomerParty
      const customerInfo = customerRaw && typeof customerRaw === 'object'
        ? customerRaw as {
            CustomerType?: number
            CompanyName?: string
            TaxNumber?:   string
            FirstName?:   string
          }
        : null

      return {
        success: true,
        data: {
          Id:           Number(sale.Id ?? 0),
          SaleNumber:   String(sale.SaleNumber ?? (opts.searchBy === 'sale' ? query : '')),
          OrderNo:      sale.OrderNo != null ? String(sale.OrderNo) : null,
          CustomerInfo: customerInfo ?? null,
          Items:        mapReturnableSaleItems(sale),
          Payments:     mapReturnableSalePayments(sale),
        },
      }
    } catch (e) {
      return { success: false, message: String(e) }
    }
  })

  ipcMain.handle('pavo:partialReturn', async (_e, opts: {
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
  }) => {
    try {
      const printerCfg = getPavoPrinterCfg(db)
      if (!printerCfg) return { success: false, message: 'Pavo ayarı yok veya cihaz pasif' }

      const printWidth = normalizePrintWidth(opts.receiptWidth ?? printerCfg.print_width)

      const nextSeq = allocPavoSequence(db)

      const body = {
        TransactionHandle: pavoTransactionHandle(printerCfg.serial_no, nextSeq),
        Sale: {
          RefererApp:            'BTPOS',
          RefererAppVersion:     '1.0.0',
          RelatedSaleId:         opts.relatedSaleId,
          SendPhoneNotification: false,
          SendEMailNotification: false,
          SkipAmountCash:        true,
          ReceiptInformation:    pavoReceiptInformation(printWidth),
          AddedSaleItems: opts.addedSaleItems.map(i => ({
            RelatedSaleItemId: i.relatedSaleItemId,
            Name:              i.name,
            ItemQuantity:      i.itemQuantity,
            UnitPriceAmount:   i.unitPriceAmount,
            GrossPriceAmount:  i.grossPriceAmount,
            TotalPriceAmount:  i.totalPriceAmount,
            VATAmount:         i.vatAmount,
            VATRate:           i.vatRate,
            UnitName:          i.unitName,
            TaxGroupId:        i.taxGroupId,
            IsGeneric:         false,
            ConvertedTotal:    i.convertedTotal,
            ReturnAmount:      i.returnAmount,
          })),
          PaymentInformations: opts.paymentInformations.map(p => ({
            Mediator:        p.mediator,
            Amount:          p.amount,
            CurrencyCode:    'TRY',
            ExchangeRate:    1.0,
            IsVoid:          p.isVoid,
            ...(p.relatedPaymentId ? { RelatedPaymentId: p.relatedPaymentId } : {}),
          })),
        },
      }

      const data = await pavoPost(`${pavoBaseUrl(printerCfg)}/PartialReturn`, body, db)

      if (data.HasError || data.IsError) {
        return {
          success: false,
          message: String(data.ErrorMessage ?? data.Message ?? 'İade başarısız'),
        }
      }

      return { success: true, data }
    } catch (e) {
      return { success: false, message: String(e) }
    }
  })
})

app.on('window-all-closed', () => {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.close()
  }
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

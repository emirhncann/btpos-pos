import { randomUUID } from 'crypto'
import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  buildPaymentReceipt,
  isPrinterActive,
  listPrinters,
  printPaymentReceiptFromSettings,
  printReceipt,
  settingsRowToConfig,
  type PaymentReceiptOpts,
  type PrinterSettingsRow,
} from './printerService'

export function registerPrinterIpc(ipcMain: IpcMain, db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS printer_settings (
      id           TEXT PRIMARY KEY,
      terminal_id  TEXT,
      printer_type TEXT DEFAULT 'usb',
      printer_name TEXT,
      printer_ip   TEXT,
      printer_port INTEGER DEFAULT 9100,
      paper_width  INTEGER DEFAULT 80,
      is_active    INTEGER DEFAULT 1,
      updated_at   TEXT
    )
  `)

  ipcMain.handle('printer:list', () => listPrinters())

  ipcMain.handle('printer:printRaw', async (_e, config: {
    type: 'usb' | 'network'
    printerName?: string
    ip?: string
    port?: number
  }, dataBase64: string) => {
    try {
      await printReceipt(
        {
          type:        config.type,
          printerName: config.printerName,
          ip:          config.ip,
          port:        config.port ?? 9100,
        },
        Buffer.from(dataBase64, 'base64'),
      )
      return { success: true as const }
    } catch (e) {
      return { success: false as const, message: String(e) }
    }
  })

  ipcMain.handle('printer:print', async (_e, printerName: string, dataBase64: string) => {
    try {
      await printReceipt(
        { type: 'usb', printerName },
        Buffer.from(dataBase64, 'base64'),
      )
      return { success: true as const }
    } catch (e) {
      return { success: false as const, message: String(e) }
    }
  })

  ipcMain.handle('printer:getSettings', () => {
    return db.prepare('SELECT * FROM printer_settings LIMIT 1').get()
  })

  ipcMain.handle('printer:saveSettings', (_e, settings: Record<string, unknown>) => {
    const existing = db.prepare('SELECT id FROM printer_settings LIMIT 1').get() as { id: string } | undefined
    const now = new Date().toISOString()
    const isActive = settings.is_active === false || settings.is_active === 0 ? 0 : 1

    if (existing) {
      db.prepare(`
        UPDATE printer_settings SET
          printer_type = ?, printer_name = ?, printer_ip = ?,
          printer_port = ?, paper_width = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        settings.printer_type ?? 'usb',
        settings.printer_name ?? null,
        settings.printer_ip ?? null,
        settings.printer_port ?? 9100,
        settings.paper_width ?? 80,
        isActive,
        now,
        existing.id,
      )
    } else {
      db.prepare(`
        INSERT INTO printer_settings (
          id, printer_type, printer_name, printer_ip, printer_port, paper_width, is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        settings.printer_type ?? 'usb',
        settings.printer_name ?? null,
        settings.printer_ip ?? null,
        settings.printer_port ?? 9100,
        settings.paper_width ?? 80,
        isActive,
        now,
      )
    }
    return { success: true as const }
  })

  ipcMain.handle('printer:printPaymentReceipt', async (_e, opts: PaymentReceiptOpts) => {
    try {
      const settings = db.prepare('SELECT * FROM printer_settings LIMIT 1').get() as PrinterSettingsRow | undefined
      if (!settings || !isPrinterActive(settings)) {
        return { success: false as const, message: 'Yazıcı ayarı yok' }
      }
      await printPaymentReceiptFromSettings(settings, opts)
      return { success: true as const }
    } catch (e) {
      return { success: false as const, message: String(e) }
    }
  })

  ipcMain.handle('printer:testPrint', async (_e, settings: Record<string, unknown>) => {
    try {
      const row: PrinterSettingsRow = {
        printer_type: settings.printer_type as 'usb' | 'network',
        printer_name: settings.printer_name as string | null,
        printer_ip:   settings.printer_ip as string | null,
        printer_port: Number(settings.printer_port ?? 9100),
        paper_width:  Number(settings.paper_width ?? 80),
        is_active:    1,
      }
      if (!isPrinterActive(row)) {
        return { success: false as const, message: 'Yazıcı seçilmedi' }
      }
      const data = buildPaymentReceipt({
        terminalName: 'Test Kasa',
        cashierName:  'Test Kasiyer',
        date:         new Date().toLocaleString('tr-TR'),
        customerName: 'TEST MÜŞTERİ',
        customerCode: 'TEST001',
        processType:  'tahsilat',
        amount:       99.99,
        description:  'Test fişi',
        paperWidth:   row.paper_width,
      })
      await printReceipt(settingsRowToConfig(row), data)
      return { success: true as const }
    } catch (e) {
      return { success: false as const, message: String(e) }
    }
  })
}

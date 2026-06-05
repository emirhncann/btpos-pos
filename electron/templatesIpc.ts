import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  DEFAULT_PRINT_BEHAVIOR,
  normalizePrintBehavior,
  parseTemplateSchema,
  type PrintBehavior,
  type RenderData,
} from '../src/lib/templateEngine'
import { renderHtml, renderThermal } from './templateRenderer'
import { isPdfmeTemplate, renderPdfme, renderThermalReceipt } from './pdfmeRenderer'
import {
  isPrinterActive,
  printReceipt,
  settingsRowToConfig,
  type PrinterSettingsRow,
} from './printerService'

function getPrintBehavior(db: Database.Database): Record<string, PrintBehavior> {
  const row = db.prepare(
    `SELECT print_behavior FROM pos_settings_cache WHERE id = 'local'`,
  ).get() as { print_behavior?: string | null } | undefined
  if (!row?.print_behavior) return { ...DEFAULT_PRINT_BEHAVIOR }
  try {
    return normalizePrintBehavior(JSON.parse(row.print_behavior))
  } catch {
    return { ...DEFAULT_PRINT_BEHAVIOR }
  }
}

function getDefaultTemplateIds(db: Database.Database): Record<string, string> {
  const row = db.prepare(
    `SELECT default_template_ids FROM pos_settings_cache WHERE id = 'local'`,
  ).get() as { default_template_ids?: string | null } | undefined
  if (!row?.default_template_ids) return {}
  try {
    const parsed = JSON.parse(row.default_template_ids) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (v != null && String(v).trim()) out[k] = String(v)
    }
    return out
  } catch {
    return {}
  }
}

async function doPrint(
  db: Database.Database,
  templateId: string,
  data: RenderData,
): Promise<{ success: boolean; message?: string }> {
  try {
    const tpl = db.prepare('SELECT * FROM receipt_templates WHERE id = ?').get(templateId) as {
      id: string
      schema: string
      paper_width_mm: number
      paper_height_mm: number | null
      template_type: string
    } | undefined

    if (!tpl) return { success: false, message: 'Şablon bulunamadı' }

    const printerCfg = getPrinterRow(db)
    if (!printerCfg || !isPrinterActive(printerCfg)) {
      return { success: false, message: 'Yazıcı ayarı yok' }
    }

    let templateJson: unknown
    try {
      templateJson = typeof tpl.schema === 'string'
        ? JSON.parse(tpl.schema)
        : tpl.schema
    } catch {
      return { success: false, message: 'Şablon JSON parse hatası' }
    }

    if (!isPdfmeTemplate(templateJson)) {
      return { success: false, message: 'Geçersiz pdfme şablonu — schemas veya basePdf eksik' }
    }

    const config = settingsRowToConfig(printerCfg)
    const paperW = Number(tpl.paper_width_mm ?? 80)
    const isThermal = paperW <= 120

    console.log('[doPrint] paper:', paperW, 'mm, termal:', isThermal)

    if (isThermal) {
      console.log('[doPrint] pdfme → ESC/POS')
      const escBuf = await renderThermalReceipt(templateJson, data, paperW)
      console.log('[doPrint] ESC/POS boyut:', escBuf.length, 'bytes')
      await printReceipt(config, escBuf)
    } else {
      console.log('[doPrint] pdfme → PDF')
      const pdfBuf = await renderPdfme(templateJson, data)
      console.log('[doPrint] PDF boyut:', pdfBuf.length, 'bytes')

      if (printerCfg.printer_type === 'network') {
        console.log('[doPrint] PDF yazıcıya gönderiliyor (ağ)...')
        await printReceipt(config, pdfBuf)
      } else {
        console.log('[doPrint] PDF yazıcıya gönderiliyor...')
        await printPdfBuffer(db, pdfBuf, printerCfg)
      }
    }

    return { success: true }
  } catch (e) {
    console.error('[doPrint]', e)
    return { success: false, message: String(e) }
  }
}

function getPrinterRow(db: Database.Database): PrinterSettingsRow | undefined {
  return db.prepare('SELECT * FROM printer_settings LIMIT 1').get() as PrinterSettingsRow | undefined
}

async function printRawBuffer(db: Database.Database, buf: Buffer): Promise<void> {
  const printerCfg = getPrinterRow(db)
  if (!printerCfg || !isPrinterActive(printerCfg)) {
    throw new Error('Yazıcı ayarı yok')
  }
  await printReceipt(settingsRowToConfig(printerCfg), buf)
}

export async function renderPdfBuffer(
  html: string,
  widthMm: number,
  heightMm: number | null,
): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true },
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const h = heightMm ?? 297
    const pdfBuf = await win.webContents.printToPDF({
      pageSize: {
        width:  (widthMm / 25.4) * 72,
        height: (h / 25.4) * 72,
      },
      printBackground: true,
    })
    return Buffer.from(pdfBuf)
  } finally {
    if (!win.isDestroyed()) win.close()
  }
}

async function printPdfBuffer(
  db: Database.Database,
  pdfBuf: Buffer,
  printerCfg: PrinterSettingsRow,
): Promise<void> {
  const win = new BrowserWindow({ show: false })
  const tmpPath = join(tmpdir(), `btpos-receipt-${Date.now()}.pdf`)
  writeFileSync(tmpPath, pdfBuf)
  try {
    await win.loadURL(`file://${tmpPath.replace(/\\/g, '/')}`)
    await new Promise<void>((resolve, reject) => {
      const deviceName = printerCfg.printer_name
        ? String(printerCfg.printer_name)
        : undefined
      win.webContents.print(
        { silent: true, printBackground: true, deviceName },
        (success, failureReason) => {
          if (success) resolve()
          else reject(new Error(failureReason ?? 'PDF yazdırılamadı'))
        },
      )
    })
  } finally {
    if (!win.isDestroyed()) win.close()
    try {
      unlinkSync(tmpPath)
    } catch {
      /* yok say */
    }
  }
}

function normalizeTemplateRow(t: Record<string, unknown>) {
  return {
    id:              String(t.id ?? ''),
    name:            String(t.name ?? ''),
    trigger_type:    String(t.trigger_type ?? t.triggerType ?? ''),
    template_type:   String(t.template_type ?? t.templateType ?? 'thermal'),
    paper_width_mm:  Number(t.paper_width_mm ?? t.paperWidthMm ?? 80),
    paper_height_mm: t.paper_height_mm != null || t.paperHeightMm != null
      ? Number(t.paper_height_mm ?? t.paperHeightMm)
      : null,
    schema: typeof t.schema === 'string' ? t.schema : JSON.stringify(t.schema ?? []),
    is_default:      t.is_default === true || t.is_default === 1 || t.isDefault === true ? 1 : 0,
  }
}

export function registerTemplatesIpc(ipcMain: IpcMain, db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipt_templates (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      trigger_type     TEXT NOT NULL,
      template_type    TEXT NOT NULL DEFAULT 'thermal',
      paper_width_mm   INTEGER NOT NULL DEFAULT 80,
      paper_height_mm  INTEGER,
      schema           TEXT NOT NULL DEFAULT '[]',
      is_default       INTEGER DEFAULT 0,
      synced_at        TEXT
    )
  `)

  const posCols = (db.prepare('PRAGMA table_info(pos_settings_cache)').all() as { name: string }[]).map(c => c.name)
  if (!posCols.includes('print_behavior')) {
    db.exec(`ALTER TABLE pos_settings_cache ADD COLUMN print_behavior TEXT DEFAULT NULL`)
  }
  const posTempCols = (db.prepare('PRAGMA table_info(pos_settings_temp)').all() as { name: string }[]).map(c => c.name)
  if (!posTempCols.includes('print_behavior')) {
    db.exec(`ALTER TABLE pos_settings_temp ADD COLUMN print_behavior TEXT DEFAULT NULL`)
  }
  if (!posCols.includes('default_template_ids')) {
    db.exec(`ALTER TABLE pos_settings_cache ADD COLUMN default_template_ids TEXT DEFAULT NULL`)
  }
  if (!posTempCols.includes('default_template_ids')) {
    db.exec(`ALTER TABLE pos_settings_temp ADD COLUMN default_template_ids TEXT DEFAULT NULL`)
  }

  ipcMain.handle('templates:getAll', () => {
    return db.prepare(
      'SELECT * FROM receipt_templates ORDER BY trigger_type, name',
    ).all()
  })

  ipcMain.handle('templates:getByTrigger', (_e, triggerType: string) => {
    return db.prepare(`
      SELECT * FROM receipt_templates
      WHERE trigger_type = ?
      ORDER BY is_default DESC, name
    `).all(triggerType)
  })

  ipcMain.handle('templates:getDefault', (_e, triggerType: string) => {
    return db.prepare(`
      SELECT * FROM receipt_templates
      WHERE trigger_type = ? AND is_default = 1
      LIMIT 1
    `).get(triggerType)
  })

  ipcMain.handle('templates:save', (_e, templates: unknown[]) => {
    const stmt = db.prepare(`
      INSERT INTO receipt_templates
        (id, name, trigger_type, template_type, paper_width_mm, paper_height_mm, schema, is_default, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name            = excluded.name,
        trigger_type    = excluded.trigger_type,
        template_type   = excluded.template_type,
        paper_width_mm  = excluded.paper_width_mm,
        paper_height_mm = excluded.paper_height_mm,
        schema          = excluded.schema,
        is_default      = excluded.is_default,
        synced_at       = excluded.synced_at
    `)
    const syncedAt = new Date().toISOString()
    const upsertMany = db.transaction((rows: unknown[]) => {
      for (const raw of rows) {
        const t = normalizeTemplateRow(raw as Record<string, unknown>)
        stmt.run(
          t.id, t.name, t.trigger_type, t.template_type,
          t.paper_width_mm, t.paper_height_mm,
          t.schema, t.is_default, syncedAt,
        )
      }
    })
    upsertMany(templates)
    return { success: true as const, count: templates.length }
  })

  ipcMain.handle('templates:printThermal', async (_e, opts: {
    triggerType: string
    data: RenderData
  }) => {
    try {
      const tpl = db.prepare(`
        SELECT * FROM receipt_templates
        WHERE trigger_type = ? AND is_default = 1 AND template_type = 'thermal'
        LIMIT 1
      `).get(opts.triggerType) as Record<string, unknown> | undefined

      if (!tpl) return { success: false as const, message: 'Şablon bulunamadı' }

      const schema = parseTemplateSchema(tpl.schema)
      const escBuf = renderThermal(schema, opts.data, Number(tpl.paper_width_mm ?? 80))
      await printRawBuffer(db, escBuf)
      return { success: true as const }
    } catch (e) {
      return { success: false as const, message: String(e) }
    }
  })

  ipcMain.handle('templates:printPdf', async (_e, opts: {
    triggerType: string
    data: RenderData
  }) => {
    try {
      const tpl = db.prepare(`
        SELECT * FROM receipt_templates
        WHERE trigger_type = ? AND is_default = 1 AND template_type = 'pdf'
        LIMIT 1
      `).get(opts.triggerType) as Record<string, unknown> | undefined

      if (!tpl) return { success: false as const, message: 'Şablon bulunamadı' }

      const schema = parseTemplateSchema(tpl.schema)
      const paperW = Number(tpl.paper_width_mm ?? 80)
      const paperH = tpl.paper_height_mm != null ? Number(tpl.paper_height_mm) : null
      const html   = renderHtml(schema, opts.data, paperW, paperH)
      const pdfBuf = await renderPdfBuffer(html, paperW, paperH)

      const printerCfg = getPrinterRow(db)
      if (!printerCfg || !isPrinterActive(printerCfg)) {
        return { success: false as const, message: 'Yazıcı ayarı yok' }
      }
      await printPdfBuffer(db, pdfBuf, printerCfg)
      return { success: true as const }
    } catch (e) {
      return { success: false as const, message: String(e) }
    }
  })

  ipcMain.handle('templates:printWithBehavior', async (_e, opts: {
    triggerType: string
    data:        RenderData
    templateId?: string
  }) => {
    try {
      const pb       = getPrintBehavior(db)
      const behavior = pb[opts.triggerType] ?? 'none'

      if (behavior === 'none') {
        return { success: true as const, skipped: true as const }
      }

      const templates = db.prepare(`
        SELECT id, name, template_type, is_default
        FROM receipt_templates
        WHERE trigger_type = ?
        ORDER BY is_default DESC, name
      `).all(opts.triggerType) as Array<{
        id: string; name: string; template_type: string; is_default: number
      }>

      if (!templates.length) {
        return { success: false as const, message: 'Şablon bulunamadı' }
      }

      if (opts.templateId) {
        const tpl = templates.find(t => String(t.id) === opts.templateId)
        if (!tpl) return { success: false as const, message: 'Şablon bulunamadı' }
        return await doPrint(db, tpl.id, opts.data)
      }

      if (templates.length === 1) {
        return await doPrint(db, String(templates[0].id), opts.data)
      }

      if (behavior === 'default') {
        const defaultIds = getDefaultTemplateIds(db)
        const configuredId = defaultIds[opts.triggerType]
        const def = (configuredId
          ? templates.find(t => String(t.id) === configuredId)
          : undefined)
          ?? templates.find(t => t.is_default === 1)
          ?? templates[0]
        return await doPrint(db, String(def.id), opts.data)
      }

      if (behavior === 'ask') {
        return {
          success:        true as const,
          needsSelection: true as const,
          templates:      templates.map(t => ({
            id:            String(t.id),
            name:          String(t.name),
            template_type: String(t.template_type),
            is_default:    t.is_default === 1,
          })),
          data: opts.data,
        }
      }

      return { success: true as const, skipped: true as const }
    } catch (e) {
      return { success: false as const, message: String(e) }
    }
  })
}

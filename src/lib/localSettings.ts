/** POS'ta yazılan, buluta yedeklenen yerel ayarlar. */

export type LocalSettings = Record<string, unknown>

/** electron-store anahtarları. Yazıcı/terazi SQLite'ta; buluta receiptPrinter / scale olarak gider. */
export const BACKED_UP_KEYS = ['cart_settings'] as const

/** Yeni PC'de ad/port tutmayabilir — geri yüklemede kontrol uyarısı. */
export const HARDWARE_REVIEW_KEYS = ['receiptPrinter', 'scale'] as const

/** SQLite printer_settings → bulut. Yalnızca tabloda olan alanlar. */
export interface ReceiptPrinterSettings {
  enabled:     boolean
  connection:  'usb' | 'network'
  printerName?: string
  ip?:          string
  port?:        number
  paperWidth:   '58mm' | '80mm'
}

/** SQLite scale_settings → bulut. Yalnızca tabloda olan alanlar (CAS RS232 seri). */
export interface ScaleSettings {
  enabled:    boolean
  connection: 'serial'
  comPort?:   string
  baudRate?:  number
}

type PrinterRow = {
  printer_type?: string | null
  printer_name?: string | null
  printer_ip?: string | null
  printer_port?: number | null
  paper_width?: number | null
  is_active?: number | boolean | null
}

type ScaleRow = {
  port_path?: string | null
  portPath?: string | null
  baud_rate?: number | null
  baudRate?: number | null
  enabled?: number | boolean | null
}

export function toCloudPrinter(row: PrinterRow | null | undefined): ReceiptPrinterSettings | null {
  if (!row) return null
  const connection: ReceiptPrinterSettings['connection'] = row.printer_type === 'network' ? 'network' : 'usb'
  const out: ReceiptPrinterSettings = {
    enabled: row.is_active !== 0 && row.is_active !== false,
    connection,
    paperWidth: Number(row.paper_width ?? 80) <= 58 ? '58mm' : '80mm',
  }
  const name = row.printer_name != null ? String(row.printer_name).trim() : ''
  if (name) out.printerName = name
  const ip = row.printer_ip != null ? String(row.printer_ip).trim() : ''
  if (ip) out.ip = ip
  if (row.printer_port != null && Number.isFinite(Number(row.printer_port))) {
    out.port = Number(row.printer_port)
  }
  return out
}

export function fromCloudPrinter(s: ReceiptPrinterSettings): Record<string, unknown> {
  const connection = s.connection === 'network' ? 'network' : 'usb'
  return {
    printer_type: connection,
    printer_name: s.printerName ?? null,
    printer_ip:   s.ip ?? null,
    printer_port: s.port ?? 9100,
    paper_width:  s.paperWidth === '58mm' ? 58 : 80,
    is_active:    s.enabled !== false,
  }
}

export function toCloudScale(row: ScaleRow | null | undefined): ScaleSettings | null {
  if (!row) return null
  const out: ScaleSettings = {
    enabled: row.enabled === true || row.enabled === 1,
    connection: 'serial',
  }
  const com = String(row.port_path ?? row.portPath ?? '').trim()
  if (com) out.comPort = com
  const baud = row.baud_rate ?? row.baudRate
  if (baud != null && Number.isFinite(Number(baud))) out.baudRate = Number(baud)
  return out
}

export function fromCloudScale(s: ScaleSettings): { portPath: string; baudRate: number; enabled: boolean } {
  return {
    portPath: s.comPort ?? '',
    baudRate: s.baudRate ?? 9600,
    enabled:  s.enabled === true,
  }
}

async function readReceiptPrinterSettings() {
  return window.electron.printer.getSettings()
}

async function saveReceiptPrinterSettings(row: Record<string, unknown>) {
  await window.electron.printer.saveSettings(row)
}

async function readScaleSettings() {
  return window.electron.scale.getSettings()
}

async function saveScaleSettings(row: { portPath: string; baudRate: number; enabled: boolean }) {
  await window.electron.scale.saveSettings(row)
}

async function getTerminalIdentity(): Promise<{ companyId: string; terminalId: string }> {
  const companyId = String(await window.electron.store.get('company_id') ?? '')
  const terminalId = String(await window.electron.store.get('terminal_id') ?? '')
  return { companyId, terminalId }
}

export async function collectLocalSettings(): Promise<LocalSettings> {
  const out: LocalSettings = {}
  for (const k of BACKED_UP_KEYS) {
    out[k] = await window.electron.store.get(k)
  }
  try {
    out.receiptPrinter = toCloudPrinter(await readReceiptPrinterSettings())
  } catch {
    out.receiptPrinter = null
  }
  try {
    out.scale = toCloudScale(await readScaleSettings())
  } catch {
    out.scale = null
  }
  try {
    out.paymentDevices = await window.electron.db.getAllPaymentDeviceSettings()
  } catch {
    out.paymentDevices = []
  }
  out._hardwareReview = [...HARDWARE_REVIEW_KEYS]
  return out
}

export async function applyLocalSettings(s: LocalSettings): Promise<void> {
  const cart = s.cart_settings
  if (cart && typeof cart === 'object') {
    await window.electron.store.setCartSettings(cart as CartSettings)
  }
  const printer = (s.receiptPrinter ?? s.printer_settings) as ReceiptPrinterSettings | Record<string, unknown> | null | undefined
  if (printer && typeof printer === 'object') {
    const cloud = 'paperWidth' in printer || 'connection' in printer
      ? printer as ReceiptPrinterSettings
      : toCloudPrinter(printer as PrinterRow)
    if (cloud) await saveReceiptPrinterSettings(fromCloudPrinter(cloud))
  }
  const scale = (s.scale ?? s.scale_settings) as ScaleSettings | ScaleRow | null | undefined
  if (scale && typeof scale === 'object') {
    const cloud = 'connection' in scale || 'comPort' in scale
      ? scale as ScaleSettings
      : toCloudScale(scale as ScaleRow)
    if (cloud) await saveScaleSettings(fromCloudScale(cloud))
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

export function scheduleLocalSettingsBackup() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void backupNow() }, 3000)
}

async function backupNow() {
  const { companyId, terminalId } = await getTerminalIdentity()
  if (!companyId || !terminalId) return
  const settings = await collectLocalSettings()
  let machineName = ''
  try {
    machineName = await window.electron.app.hostname()
  } catch { /* ignore */ }
  let appVersion = ''
  try {
    appVersion = await window.electron.app.version()
  } catch { /* ignore */ }
  await window.electron.db.enqueueOperation({
    id: crypto.randomUUID(),
    companyId,
    type: 'terminal_local_settings',
    payload: {
      endpoint: `/terminal-local-settings/${companyId}/${terminalId}`,
      method: 'PUT',
      body: { settings, app_version: appVersion, machine_name: machineName },
    },
    label: 'Kasa ayarları yedeği',
  })
}

export async function enqueuePaymentDeviceBackup(body: Record<string, unknown>): Promise<void> {
  const { companyId, terminalId } = await getTerminalIdentity()
  if (!companyId || !terminalId) return
  await window.electron.db.enqueueOperation({
    id: crypto.randomUUID(),
    companyId,
    type: 'payment_device',
    payload: {
      endpoint: `/payment-devices/${companyId}/${terminalId}`,
      method: 'POST',
      body,
    },
    label: 'Pavo ayarı yedeği',
  })
}

/** Yerel Pavo var, bulutta yoksa bir kez kuyruğa alır. */
export async function publishLocalPavoIfCloudEmpty(companyId: string, terminalId: string): Promise<void> {
  try {
    const local = await window.electron.db.getPaymentDeviceSettings('pavo')
    if (!local?.ipAddress || !local.isActive) return
    const cloud = await (await import('./api')).api.getPaymentDeviceSettings(companyId, terminalId)
    const cloudHas = Array.isArray(cloud) && cloud.some(d => d?.ip_address)
    if (cloudHas) return
    await enqueuePaymentDeviceBackup({
      provider: 'pavo',
      ip_address: local.ipAddress,
      port: local.port,
      serial_no: local.serialNo,
      card_read_timeout: local.cardReadTimeout,
      print_width: local.printWidth,
      updated_from: 'pos',
      last_paired_at: local.lastPairedAt ?? null,
      is_active: true,
    })
  } catch (e) {
    console.warn('[pavo] bulut yedek kontrolü:', e)
  }
}

import net from 'net'
import { Receipt, align, bold, fontSmall, text } from './escpos'

export interface PrinterConfig {
  type:        'usb' | 'network'
  printerName?: string
  ip?:          string
  port?:        number
  paperWidth?:  number
}

export interface PrinterSettingsRow {
  id?:            string
  terminal_id?:   string | null
  printer_type?:  'usb' | 'network'
  printer_name?:  string | null
  printer_ip?:    string | null
  printer_port?:  number
  paper_width?:   number
  is_active?:     boolean | number
  updated_at?:    string
}

export interface PaymentReceiptOpts {
  terminalName:  string
  cashierName:   string
  date:          string
  customerName:  string
  customerCode:  string
  processType:   'tahsilat' | 'odeme'
  amount:        number
  description?:  string
  paperWidth?:   number
}

type NodePrinterModule = {
  getPrinters: () => Array<{ name: string; isDefault?: boolean }>
  printDirect: (opts: {
    data: Buffer
    printer: string
    type: string
    success: (jobID: string) => void
    error: (err: Error) => void
  }) => void
}

let nodePrinter: NodePrinterModule | null = null

function loadNodePrinter(): NodePrinterModule | null {
  if (nodePrinter) return nodePrinter
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nodePrinter = require('@thiagoelg/node-printer') as NodePrinterModule
    return nodePrinter
  } catch (e) {
    console.warn('[printer] node-printer yüklenemedi:', e)
    return null
  }
}

function sendToNetwork(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    socket.setTimeout(5000)
    socket.connect(port, ip, () => {
      socket.write(data, () => {
        socket.destroy()
        resolve()
      })
    })
    socket.on('error', reject)
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('Yazıcı zaman aşımı'))
    })
  })
}

function printUsb(printerName: string, data: Buffer): Promise<void> {
  const pr = loadNodePrinter()
  if (!pr) {
    throw new Error('USB yazıcı modülü kullanılamıyor (node-printer derlenmemiş olabilir)')
  }
  return new Promise((resolve, reject) => {
    pr.printDirect({
      data,
      printer: printerName,
      type: 'RAW',
      success: () => resolve(),
      error: (err: Error) => reject(err),
    })
  })
}

export function listPrinters(): Array<{ name: string; isDefault: boolean }> {
  try {
    const pr = loadNodePrinter()
    if (!pr) return []
    return pr.getPrinters().map(p => ({
      name:      p.name,
      isDefault: Boolean(p.isDefault),
    }))
  } catch {
    return []
  }
}

export function settingsRowToConfig(row: PrinterSettingsRow): PrinterConfig {
  return {
    type:        row.printer_type === 'network' ? 'network' : 'usb',
    printerName: row.printer_name ? String(row.printer_name) : undefined,
    ip:          row.printer_ip ? String(row.printer_ip) : undefined,
    port:        Number(row.printer_port ?? 9100),
    paperWidth:  Number(row.paper_width ?? 80),
  }
}

export function isPrinterActive(row: PrinterSettingsRow | undefined | null): boolean {
  if (!row) return false
  if (row.is_active === false || row.is_active === 0) return false
  const type = row.printer_type === 'network' ? 'network' : 'usb'
  if (type === 'network') return Boolean(row.printer_ip?.toString().trim())
  return Boolean(row.printer_name?.toString().trim())
}

export async function printReceipt(config: PrinterConfig, data: Buffer): Promise<void> {
  if (config.type === 'network' && config.ip) {
    await sendToNetwork(config.ip, config.port ?? 9100, data)
    return
  }
  if (config.type === 'usb' && config.printerName) {
    await printUsb(config.printerName, data)
    return
  }
  throw new Error('Yazıcı ayarı eksik')
}

/** 80mm kağıtta ASCII logo; 58mm'de metin logo (dar kağıt) */
const LOGO_ASCII = [
  '  ____  _____  ____   ___  ____ ',
  ' | __ )_   _||  _ \\ / _ \\/ ___|',
  ' |  _ \\ | |  | |_) | | | \\___ \\',
  ' | |_) || |  |  __/| |_| |___) |',
  ' |____/ |_|  |_|    \\___/|____/ ',
]

export function buildPaymentReceipt(opts: PaymentReceiptOpts): Buffer {
  const w     = opts.paperWidth === 58 ? 32 : 42
  const label = opts.processType === 'tahsilat' ? 'TAHSİLAT' : 'ÖDEME'
  const amt   = opts.amount.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' TL'

  const col = (l: string, r: string) => {
    const pad = w - l.length - r.length
    return l + ' '.repeat(Math.max(1, pad)) + r
  }

  const r = new Receipt().init()

  r.br()
  r.center('='.repeat(w))

  if (w >= 42) {
    r.add(align('center'))
    r.add(bold(true))
    r.add(text('       BTPOS'))
    r.add(bold(false))
    r.add(fontSmall(true))
    for (const line of LOGO_ASCII) {
      r.add(text(line))
    }
    r.add(fontSmall(false))
  } else {
    r.center('** BTPOS **')
    r.center('Satış Noktası Sistemi')
  }

  r.center('='.repeat(w))
  r.br()

  r.add(align('center'))
  r.add(bold(true))
  r.add(text(label))
  r.add(bold(false))
  r.center('='.repeat(w))
  r.br()

  r.add(align('left'))
  r.add(text(col('Kasa    :', opts.terminalName)))
  r.add(text(col('Kasiyer :', opts.cashierName)))
  r.add(text(col('Tarih   :', opts.date)))
  r.add(text('-'.repeat(w)))
  r.add(bold(true))
  r.add(text(col('Müşteri :', opts.customerName)))
  r.add(bold(false))
  r.add(text(col('Kod     :', opts.customerCode)))
  r.add(text('='.repeat(w)))
  r.add(bold(true))
  r.add(text(col('TUTAR   :', amt)))
  r.add(bold(false))
  r.add(text('='.repeat(w)))

  if (opts.description?.trim()) {
    r.add(text(col('Açıklama:', opts.description.trim())))
    r.add(text('-'.repeat(w)))
  }

  r.br()
  r.center('Teşekkür ederiz')
  r.center('www.btpos.com.tr')
  r.br(3)
  r.cut()

  return r.build()
}

export async function printPaymentReceiptFromSettings(
  settings: PrinterSettingsRow,
  opts: PaymentReceiptOpts,
): Promise<void> {
  if (!isPrinterActive(settings)) {
    throw new Error('Yazıcı ayarı yok')
  }
  const paperWidth = Number(settings.paper_width ?? 80)
  const data = buildPaymentReceipt({ ...opts, paperWidth })
  await printReceipt(settingsRowToConfig(settings), data)
}

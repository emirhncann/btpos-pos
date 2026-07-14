import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'

export interface ScaleReading {
  weight: number   // gram
  stable: boolean
  unit:   'kg' | 'g'
  raw:    string
}

let port:   SerialPort | null = null
let parser: ReadlineParser | null = null
let lastReading: ScaleReading | null = null
let listeners: ((r: ScaleReading) => void)[] = []

function parseCasOutput(raw: string): ScaleReading | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const fmt1 = trimmed.match(/^(ST|US),(GS|NT),([+\-\s]+)([\d.]+)(kg|g)\s*$/)
  if (fmt1) {
    const stable = fmt1[1] === 'ST'
    const unit   = fmt1[5] as 'kg' | 'g'
    let weight   = parseFloat(fmt1[4])
    if (unit === 'kg') weight = Math.round(weight * 1000)
    if (fmt1[3].includes('-')) weight = -weight
    return { weight, stable, unit, raw: trimmed }
  }

  const fmt2 = trimmed.match(/^S\s*(\d+)\s*$/)
  if (fmt2) {
    const weight = parseInt(fmt2[1], 10)
    return { weight, stable: true, unit: 'g', raw: trimmed }
  }

  const fmt3 = trimmed.match(/^([+\-]?)\s*([\d.]+)\s*(kg|g)\s*$/)
  if (fmt3) {
    const unit   = fmt3[3] as 'kg' | 'g'
    let weight   = parseFloat(fmt3[2])
    if (unit === 'kg') weight = Math.round(weight * 1000)
    if (fmt3[1] === '-') weight = -weight
    return { weight, stable: true, unit, raw: trimmed }
  }

  return null
}

export async function listSerialPorts(): Promise<string[]> {
  const ports = await SerialPort.list()
  return ports.map(p => p.path)
}

export function connectScale(opts: {
  portPath: string
  baudRate: number
  onData:   (r: ScaleReading) => void
}): void {
  disconnectScale()

  port = new SerialPort({
    path:     opts.portPath,
    baudRate: opts.baudRate,
    dataBits: 8,
    stopBits: 1,
    parity:   'none',
    autoOpen: true,
  })

  parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))

  parser.on('data', (line: string) => {
    const reading = parseCasOutput(line)
    if (reading) {
      lastReading = reading
      opts.onData(reading)
      listeners.forEach(fn => fn(reading))
    }
  })

  port.on('error', (err) => {
    console.error('[scale] Port hatası:', err.message)
  })
}

export function disconnectScale(): void {
  if (port?.isOpen) port.close()
  port        = null
  parser      = null
  lastReading = null
}

export function getLastReading(): ScaleReading | null {
  return lastReading
}

export function addScaleListener(fn: (r: ScaleReading) => void): void {
  listeners.push(fn)
}

export function removeScaleListener(fn: (r: ScaleReading) => void): void {
  listeners = listeners.filter(l => l !== fn)
}

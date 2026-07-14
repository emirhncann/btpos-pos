import { SerialPort } from 'serialport'

export interface ScaleReading {
  weight: number // gram
  stable: boolean
  unit: 'kg' | 'g'
  raw: string
}

let port: SerialPort | null = null
let lastReading: ScaleReading | null = null
let listeners: ((r: ScaleReading) => void)[] = []
let rawListeners: ((raw: string) => void)[] = []
let lineBuf = ''
let flushTimer: ReturnType<typeof setTimeout> | null = null

function toGrams(value: string, unit: 'kg' | 'g'): number {
  const n = parseFloat(value.replace(',', '.'))
  if (Number.isNaN(n)) return NaN
  return unit === 'kg' ? Math.round(n * 1000) : Math.round(n)
}

/**
 * CAS / genel terazi formatlarını parse et
 *   "S  0.000kg" / "U  1.234kg"  → birincil CAS formatı (S=stabil, U=unstabil)
 *   "ST,GS,+  0.250kg" / "US,GS,..."
 *   "S 00250" (yalnızca tam sayı gram)
 *   "WN+0000.250kg"
 */
export function parseCasOutput(raw: string): ScaleReading | null {
  const trimmed = raw.trim().replace(/\0/g, '')
  if (!trimmed) return null

  // Format 0 (birincil): "S  0.000kg" / "U  1.234kg" / "S+0.250kg" / "U  -0.010kg"
  const fmt0 = trimmed.match(/^(S|U)\s*([+\-]?)\s*([\d.,]+)\s*(kg|g)\s*$/i)
  if (fmt0) {
    const stable = fmt0[1]!.toUpperCase() === 'S'
    const unit = fmt0[4]!.toLowerCase() as 'kg' | 'g'
    let weight = toGrams(fmt0[3]!, unit)
    if (Number.isNaN(weight)) return null
    if (fmt0[2] === '-') weight = -weight
    return { weight, stable, unit, raw: trimmed }
  }

  // Format 1: "ST,GS,+  0.250kg" (virgül veya boşluk ayracı)
  const fmt1 = trimmed.match(
    /^(ST|US|OL)[,\s]+(GS|NT)[,\s]+([+\-\s]*)([\d.,]+)\s*(kg|g)\s*$/i,
  )
  if (fmt1) {
    const stable = fmt1[1]!.toUpperCase() === 'ST'
    const unit = fmt1[5]!.toLowerCase() as 'kg' | 'g'
    let weight = toGrams(fmt1[4]!, unit)
    if (Number.isNaN(weight)) return null
    if (fmt1[3]!.includes('-')) weight = -weight
    return { weight, stable, unit, raw: trimmed }
  }

  // Format 1b: "STGS + 0.250kg" (ayırıcısız)
  const fmt1b = trimmed.match(
    /^(ST|US)(GS|NT)\s*([+\-]?)\s*([\d.,]+)\s*(kg|g)\s*$/i,
  )
  if (fmt1b) {
    const stable = fmt1b[1]!.toUpperCase() === 'ST'
    const unit = fmt1b[5]!.toLowerCase() as 'kg' | 'g'
    let weight = toGrams(fmt1b[4]!, unit)
    if (Number.isNaN(weight)) return null
    if (fmt1b[3] === '-') weight = -weight
    return { weight, stable, unit, raw: trimmed }
  }

  // Format 2: yalnız "S 00250" / "S00250" (tam sayı gram — ondalık/kg yok)
  const fmt2 = trimmed.match(/^S\s+(\d+)\s*$/i)
  if (fmt2) {
    return { weight: parseInt(fmt2[1]!, 10), stable: true, unit: 'g', raw: trimmed }
  }

  // Format 3: "+  0.250 kg" veya "0.250kg"
  const fmt3 = trimmed.match(/^([+\-]?)\s*([\d.,]+)\s*(kg|g)\s*$/i)
  if (fmt3) {
    const unit = fmt3[3]!.toLowerCase() as 'kg' | 'g'
    let weight = toGrams(fmt3[2]!, unit)
    if (Number.isNaN(weight)) return null
    if (fmt3[1] === '-') weight = -weight
    return { weight, stable: true, unit, raw: trimmed }
  }

  // Format 4: "WN+0000.250kg" / "WT+0001.234kg"
  const fmt4 = trimmed.match(/^(WN|WT|GS|NT|NW|GW)\s*([+\-])\s*([\d.,]+)\s*(kg|g)?\s*$/i)
  if (fmt4) {
    const unit = (fmt4[4]?.toLowerCase() as 'kg' | 'g' | undefined) ?? 'kg'
    let weight = toGrams(fmt4[3]!, unit)
    if (Number.isNaN(weight)) return null
    if (fmt4[2] === '-') weight = -weight
    return { weight, stable: true, unit, raw: trimmed }
  }

  // Format 5: satır içinde "±0.250kg" — baştaki S/U’yu da dikkate al
  const fmt5 = trimmed.match(/([+\-]?)\s*([\d.,]+)\s*(kg|g)\b/i)
  if (fmt5) {
    const unit = fmt5[3]!.toLowerCase() as 'kg' | 'g'
    let weight = toGrams(fmt5[2]!, unit)
    if (Number.isNaN(weight)) return null
    if (fmt5[1] === '-') weight = -weight
    const status = trimmed.match(/^(S|U|ST|US)\b/i)
    const statusChar = status?.[1]?.toUpperCase()
    const stable = statusChar === 'S' || statusChar === 'ST'
      ? true
      : statusChar === 'U' || statusChar === 'US'
        ? false
        : !/\bunstable|unst\b/i.test(trimmed)
    return { weight, stable, unit, raw: trimmed }
  }

  // Format 6: sadece sayı
  const fmt6 = trimmed.match(/^([+\-]?)\s*([\d]+[.,]\d+|[\d]+)\s*$/)
  if (fmt6) {
    let weight = parseFloat(fmt6[2]!.replace(',', '.'))
    if (Number.isNaN(weight)) return null
    if (Math.abs(weight) < 50) weight = Math.round(weight * 1000)
    else weight = Math.round(weight)
    if (fmt6[1] === '-') weight = -weight
    return { weight, stable: true, unit: 'g', raw: trimmed }
  }

  return null
}

function clearFlushTimer() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

function emitRaw(raw: string) {
  rawListeners.forEach(fn => {
    try { fn(raw) } catch { /* ignore */ }
  })
}

function handleLine(line: string) {
  const cleaned = line.replace(/\0/g, '')
  if (!cleaned.trim()) return

  console.log('[scale] ham satır:', JSON.stringify(cleaned))
  emitRaw(cleaned)

  const reading = parseCasOutput(cleaned)
  if (reading) {
    lastReading = reading
    listeners.forEach(fn => {
      try { fn(reading) } catch { /* ignore */ }
    })
  } else {
    console.warn('[scale] parse edilemedi:', JSON.stringify(cleaned))
  }
}

function scheduleFlush() {
  clearFlushTimer()
  // Bazı teraziler \r/\n göndermeden sürekli basar — 80ms sessizlikte flush
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (lineBuf.trim()) {
      const leftover = lineBuf
      lineBuf = ''
      handleLine(leftover)
    }
  }, 80)
}

function onPortData(chunk: Buffer) {
  // \r\n, \r, \n hepsini satır ayracı say
  lineBuf += chunk.toString('latin1')
  lineBuf = lineBuf.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  let idx: number
  while ((idx = lineBuf.indexOf('\n')) >= 0) {
    const line = lineBuf.slice(0, idx)
    lineBuf = lineBuf.slice(idx + 1)
    handleLine(line)
  }
  if (lineBuf.length > 0) scheduleFlush()
}

export async function listSerialPorts(): Promise<string[]> {
  const ports = await SerialPort.list()
  return ports.map(p => p.path)
}

export function connectScale(opts: {
  portPath: string
  baudRate: number
  onData: (r: ScaleReading) => void
  onRaw?: (raw: string) => void
}): Promise<{ success: boolean; error?: string }> {
  disconnectScale()

  // Windows'ta "COM1" / "com1" / "\\.\COM1" tutarlı olsun
  let path = opts.portPath.trim()
  if (/^COM\d+$/i.test(path)) {
    path = `\\\\.\\${path.toUpperCase()}`
  }

  return new Promise(resolve => {
    try {
      port = new SerialPort({
        path,
        baudRate: opts.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        autoOpen: false,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      resolve({ success: false, error: msg })
      return
    }

    const onReading = (r: ScaleReading) => {
      opts.onData(r)
    }
    const onRaw = opts.onRaw
    addScaleListener(onReading)
    if (onRaw) addRawListener(onRaw)

    type ScalePort = SerialPort & {
      _scaleOnReading?: (r: ScaleReading) => void
      _scaleOnRaw?: (raw: string) => void
    }
    const p = port as ScalePort
    p._scaleOnReading = onReading
    p._scaleOnRaw = onRaw

    port.on('data', onPortData)
    port.on('error', (err: Error) => {
      console.error('[scale] Port hatası:', err.message)
    })

    port.open(err => {
      if (err) {
        console.error('[scale] Açma hatası:', err.message)
        removeScaleListener(onReading)
        if (onRaw) removeRawListener(onRaw)
        try { port?.removeAllListeners() } catch { /* ignore */ }
        port = null
        const tip = /access denied|çok kullanılıyor|in use|EACCES|EBUSY|cannot open/i.test(err.message)
          ? ' — COM port başka programda açık olabilir (Serial Monitörü kapatın)'
          : ''
        resolve({ success: false, error: err.message + tip })
        return
      }
      console.log('[scale] Bağlandı:', path, opts.baudRate)
      resolve({ success: true })
    })
  })
}

export function disconnectScale(): void {
  clearFlushTimer()
  lineBuf = ''

  if (port) {
    type ScalePort = SerialPort & {
      _scaleOnReading?: (r: ScaleReading) => void
      _scaleOnRaw?: (raw: string) => void
    }
    const p = port as ScalePort
    if (p._scaleOnReading) {
      removeScaleListener(p._scaleOnReading)
      p._scaleOnReading = undefined
    }
    if (p._scaleOnRaw) {
      removeRawListener(p._scaleOnRaw)
      p._scaleOnRaw = undefined
    }
    try {
      port.removeAllListeners('data')
      port.removeAllListeners('error')
      if (port.isOpen) port.close()
    } catch {
      /* ignore close errors */
    }
  }
  port = null
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

export function addRawListener(fn: (raw: string) => void): void {
  rawListeners.push(fn)
}

export function removeRawListener(fn: (raw: string) => void): void {
  rawListeners = rawListeners.filter(l => l !== fn)
}

export function isScaleConnected(): boolean {
  return !!port?.isOpen
}

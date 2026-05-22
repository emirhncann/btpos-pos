// ESC/POS komutları (main process)
export const ESC = 0x1b
export const GS  = 0x1d

// Türkçe → CP857 karakter dönüşüm tablosu
const TR_MAP: Record<string, number> = {
  'ş': 0x9F, 'Ş': 0x9E,
  'ı': 0x8D, 'İ': 0x98,
  'ğ': 0xA6, 'Ğ': 0xA7,
  'ü': 0x81, 'Ü': 0x9A,
  'ö': 0x94, 'Ö': 0x99,
  'ç': 0x87, 'Ç': 0x80,
}

function encodeText(s: string): Buffer {
  const bytes: number[] = []
  for (const ch of s) {
    const code = TR_MAP[ch]
    if (code !== undefined) {
      bytes.push(code)
    } else {
      const c = ch.charCodeAt(0)
      bytes.push(c < 256 ? c : 0x3F)
    }
  }
  bytes.push(0x0A)
  return Buffer.from(bytes)
}

export function init(): Buffer {
  return Buffer.from([
    ESC, 0x40,       // initialize
    ESC, 0x74, 0x04, // code page CP857 (Türkçe)
  ])
}

export function cut(): Buffer {
  return Buffer.from([GS, 0x56, 0x41, 0x03])
}

export function bold(on: boolean): Buffer {
  return Buffer.from([ESC, 0x45, on ? 1 : 0])
}

export function align(a: 'left' | 'center' | 'right'): Buffer {
  return Buffer.from([ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2])
}

export function feed(n = 1): Buffer {
  return Buffer.from([ESC, 0x64, n])
}

/** Font B / küçük font (Epson uyumlu) */
export function fontSmall(on: boolean): Buffer {
  return Buffer.from([ESC, 0x4D, on ? 0x01 : 0x00])
}

export function text(s: string): Buffer {
  return encodeText(s)
}

export function divider(width = 42): Buffer {
  return text('─'.repeat(width))
}

export class Receipt {
  private buf: Buffer[] = []

  init() { this.buf.push(init()); return this }
  cut()  { this.buf.push(cut()); return this }

  build(): Buffer {
    return Buffer.concat(this.buf)
  }

  add(b: Buffer) { this.buf.push(b); return this }
  br(n = 1)     { this.buf.push(feed(n)); return this }
  div(w = 42)   { return this.add(text('─'.repeat(w))) }

  center(s: string) {
    return this.add(align('center')).add(text(s))
  }

  left(s: string) {
    return this.add(align('left')).add(text(s))
  }
}

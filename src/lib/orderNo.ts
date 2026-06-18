/**
 * OrderNo: KKK + YY + MM + DD + HH + mm + ss (15 karakter)
 * KKK — pos_settings.terminal_number (merkezden sync)
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** pos_settings.terminal_number → 3 hane (örn. 1 → 001, 42 → 042) */
export function normalizeTerminalNumber(raw: string | null | undefined): string {
  const t = String(raw ?? '').trim()
  if (!t) return '000'
  const digits = t.replace(/\D/g, '')
  if (digits.length > 0) {
    return digits.slice(-3).padStart(3, '0')
  }
  const alnum = t.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (!alnum) return '000'
  return alnum.slice(0, 3).padEnd(3, '0')
}

export function buildOrderNo(terminalNumber: string | null | undefined, date = new Date()): string {
  const code = normalizeTerminalNumber(terminalNumber)
  const yy = String(date.getFullYear()).slice(-2)
  return `${code}${yy}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
}

let lastOrderKey = ''
let seqInSecond = 0

/** Aynı kasa + aynı saniye içinde ikinci satışta saniyeyi +1..+9 kaydırır */
export function nextOrderNo(
  terminalNumber: string | null | undefined,
  date = new Date(),
): string {
  const code = normalizeTerminalNumber(terminalNumber)
  const key = `${code}-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`

  if (key === lastOrderKey) {
    seqInSecond = Math.min(seqInSecond + 1, 9)
  } else {
    lastOrderKey = key
    seqInSecond = 0
  }

  const d = new Date(date)
  if (seqInSecond > 0) {
    d.setSeconds(d.getSeconds() + seqInSecond)
  }

  return buildOrderNo(terminalNumber, d)
}

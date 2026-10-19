/** Kasada mali cihaz tanımı. Bağlı olmak gerekmez; adres ve kimlik dolu olmalı. */
export type PosDeviceSnapshot = {
  ipAddress?: string | null
  serialNo?: string | null
  isActive?: boolean
  enabled?: boolean
  port?: number
  cardReadTimeout?: number
  printWidth?: '58mm' | '80mm'
}

export const POS_UNDEFINED_MESSAGE =
  'Bu kasaya ödeme cihazı (POS) tanımlı değil. Satış yapılamaz. Yöneticinize başvurun.'

export function isPosDefined(s: PosDeviceSnapshot | null | undefined): boolean {
  if (!s) return false
  if (s.enabled === false || s.isActive === false) return false
  const addr = String(s.ipAddress ?? '').trim()
  const id = String(s.serialNo ?? '').trim()
  return addr.length > 0 && id.length > 0
}

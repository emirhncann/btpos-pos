/** Ana ekrandan satış ekranına tek seferlik açılış isteği. Satış akışını değiştirmez. */
export type PosBoot = {
  barcode?: string
  menu?: 'islemler'
  held?: boolean
}

let pending: PosBoot | null = null

export function setPosBoot(boot: PosBoot): void {
  pending = boot
}

export function takePosBoot(): PosBoot | null {
  const boot = pending
  pending = null
  return boot
}

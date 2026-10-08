/** Satır / belge iskontosu — fiş ile ERP aynı tutarı görsün. */

export const r2 = (x: number) => Math.round(Number(x) * 100) / 100

export interface DiscountSourceLine {
  quantity: number
  /** KDV dahil liste birim fiyatı */
  unitPrice: number
  /** Satır iskontosu tutarı (TL); yoksa oran kullanılır */
  discountAmount?: number
  discountRate?: number
  /** Varsa doğrudan satır neti (iskonto sonrası, belge iskontosu öncesi) */
  afterLineNet?: number
}

export interface AllocatedSaleLine<T extends DiscountSourceLine = DiscountSourceLine> {
  source: T
  quantity: number
  unitPriceGross: number
  grossAmount: number
  lineDiscount: number
  docDiscountShare: number
  netAmount: number
}

/** Satır iskontosu (KDV dahil TL). Tutar varsa onu kullan; yoksa oran. */
export function lineDiscountTl(line: DiscountSourceLine, gross: number): number {
  if (line.afterLineNet != null && Number.isFinite(line.afterLineNet)) {
    return Math.max(0, r2(gross - line.afterLineNet))
  }
  const amt = Number(line.discountAmount ?? 0)
  if (amt > 0) return r2(Math.min(amt, gross))
  const rate = Number(line.discountRate ?? 0)
  if (rate > 0) return r2(gross * rate / 100)
  return 0
}

/**
 * Belge iskontosunu satırlara oransal dağıtır; kuruş farkı son satıra.
 * `docDiscountAmount` KDV dahil TL.
 */
export function allocateDocDiscount<T extends DiscountSourceLine>(
  lines: T[],
  docDiscountAmount: number,
): AllocatedSaleLine<T>[] {
  const docDisc = r2(Math.max(0, docDiscountAmount))
  const prepared = lines.map(src => {
    const qty = Number(src.quantity) || 0
    const unitPriceGross = r2(Number(src.unitPrice) || 0)
    const grossAmount = r2(unitPriceGross * qty)
    const lineDiscount = lineDiscountTl(src, grossAmount)
    const afterLine = r2(Math.max(0, grossAmount - lineDiscount))
    return { source: src, quantity: qty, unitPriceGross, grossAmount, lineDiscount, afterLine }
  })

  const base = r2(prepared.reduce((s, l) => s + l.afterLine, 0))
  let given = 0
  return prepared.map((l, idx) => {
    const share = prepared.length === 0
      ? 0
      : idx === prepared.length - 1
        ? r2(docDisc - given)
        : r2(base > 0 ? docDisc * l.afterLine / base : 0)
    given = r2(given + share)
    const netAmount = r2(Math.max(0, l.afterLine - share))
    return {
      source: l.source,
      quantity: l.quantity,
      unitPriceGross: l.unitPriceGross,
      grossAmount: l.grossAmount,
      lineDiscount: l.lineDiscount,
      docDiscountShare: share,
      netAmount,
    }
  })
}

export function assertAllocatedTotal(
  lines: AllocatedSaleLine[],
  expectedNet: number,
  tag = '[iskonto]',
): number {
  const sumNet = r2(lines.reduce((s, l) => s + l.netAmount, 0))
  if (Math.abs(sumNet - r2(expectedNet)) > 0.009) {
    console.error(`${tag} toplam tutmuyor`, { sumNet, expectedNet: r2(expectedNet) })
  }
  return sumNet
}

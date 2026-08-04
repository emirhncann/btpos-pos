import { getDB, getSqlite } from './index'
import { products, sales, saleItems, cashiers, heldDocuments, pluGroupsCache, pluItemsCache, posSettingsCache, commandHistory } from './schema'
import { eq, gte, lte, and, asc, desc, inArray, or, isNull } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import type BetterSqlite3 from 'better-sqlite3'

export interface ProductRow {
  id: string
  code?: string
  name: string
  barcode?: string
  price: number
  vatRate: number
  unit: string
  stock: number
  category?: string
  syncedAt: string
  modificationDate?: string | null
}

export interface SaleItem {
  productId?: string
  productCode?: string
  productName: string
  quantity: number
  unitPrice: number
  vatRate: number
  discountRate?: number
  discountAmount?: number
  lineTotal: number
  appliedBy?: string
}

export interface SalePaymentRow {
  id:            string
  saleId:        string
  method:        'cash' | 'card' | 'meal_card' | 'other'
  amount:        number
  mediator?:     number | null
  acquirerId?:   string | null
  acquirerName?: string | null
  cashierId?:    string | null
  cashierName?:  string | null
  createdAt?:    string | null
}

export interface SaleRow {
  receiptNo?: string
  orderNo?: string | null
  totalAmount: number
  discountRate?: number
  discountAmount?: number
  netAmount: number
  paymentType: 'cash' | 'card' | 'mixed'
  cashAmount: number
  cardAmount: number
  cardAcquirerId?: string | null
  cashierId?:   string | null
  cashierName?: string | null
  customerId?:   string | null
  customerName?: string | null
  customerCode?: string | null
  isReturn?:    boolean
}

export interface PaymentDeviceResult {
  success: boolean
  provider: 'pavo' | 'ingenico' | 'pax' | string
  errorCode?: number | string
  message?: string
  authCode?: string
  cardNo?: string
  cardBrand?: string
  cardType?: string
  acquirer?: string
  batchNo?: string
  isOffline?: boolean
  receiptUrl?: string
  raw: Record<string, unknown>
}

export function saveProducts(items: ProductRow[]): number {
  const db = getDB()
  db.delete(products).run()

  const now = new Date().toISOString()

  for (const item of items) {
    db.insert(products).values({
      id: item.id || randomUUID(),
      code: item.code ?? '',
      name: item.name,
      barcode: item.barcode ?? '',
      price: item.price ?? 0,
      vatRate: item.vatRate ?? 18,
      unit: item.unit ?? 'Adet',
      stock: item.stock ?? 0,
      category: item.category ?? '',
      syncedAt: now,
      modificationDate: item.modificationDate ?? null,
    }).run()
  }

  return items.length
}

export function getAllProducts(): ProductRow[] {
  const db = getDB()
  return db.select().from(products).all() as ProductRow[]
}

export function findByBarcode(barcode: string): ProductRow | null {
  const db = getDB()
  const result = db.select().from(products).where(eq(products.barcode, barcode)).get()
  return result as ProductRow | null
}

export interface SaveSaleResult {
  saleId:    string
  receiptNo: string
}

export function saveSale(sale: SaleRow, items: SaleItem[], device?: PaymentDeviceResult): SaveSaleResult {
  const db = getDB()
  const sqlite = getSqlite()
  const saleId = randomUUID()
  const now = new Date().toISOString()
  const paymentDeviceData = device ? JSON.stringify({
    authCode:   device.authCode,
    cardNo:     device.cardNo,
    cardBrand:  device.cardBrand,
    cardType:   device.cardType,
    acquirer:   device.acquirer,
    batchNo:    device.batchNo,
    isOffline:  device.isOffline,
    receiptUrl: device.receiptUrl,
    raw:        device.raw,
  }) : null

  sqlite.prepare(`
    INSERT INTO sales (
      id, receipt_no, order_no,
      total_amount, discount_rate, discount_amount, net_amount,
      payment_type, cash_amount, card_amount,
      created_at, synced,
      customer_id, customer_name, customer_code,
      cashier_id, cashier_name,
      invoice_sent, invoice_id, invoice_error, invoice_at,
      card_acquirer_id, payment_provider, payment_device_data, is_return
    ) VALUES (
      ?,
      (SELECT COALESCE(MAX(receipt_no), 0) + 1 FROM sales),
      ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, 0,
      ?, ?, ?,
      ?, ?,
      0, NULL, NULL, NULL,
      ?, ?, ?, ?
    )
  `).run(
    saleId,
    sale.orderNo ?? null,
    sale.totalAmount,
    sale.discountRate ?? 0,
    sale.discountAmount ?? 0,
    sale.netAmount,
    sale.paymentType,
    sale.cashAmount,
    sale.cardAmount,
    now,
    sale.customerId ?? null,
    sale.customerName ?? null,
    sale.customerCode ?? null,
    sale.cashierId ?? null,
    sale.cashierName ?? null,
    sale.cardAcquirerId ?? null,
    device?.provider ?? null,
    paymentDeviceData,
    sale.isReturn ? 1 : 0,
  )

  for (const item of items) {
    const productRow = item.productCode
      ? sqlite.prepare(
        'SELECT id FROM products WHERE code = ? LIMIT 1',
      ).get(item.productCode) as { id: string } | undefined
      : undefined

    db.insert(saleItems).values({
      id: randomUUID(),
      saleId,
      productId: productRow?.id ?? null,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      discountRate: item.discountRate ?? 0,
      discountAmount: item.discountAmount ?? 0,
      lineTotal: item.lineTotal,
      appliedBy: item.appliedBy ?? null,
    }).run()
  }

  const inserted = sqlite.prepare(
    'SELECT receipt_no FROM sales WHERE id = ?',
  ).get(saleId) as { receipt_no: number }

  return { saleId, receiptNo: String(inserted.receipt_no) }
}

/** Bekleyen veya hatalı (yeniden denenecek) fatura kayıtları */
export function getPendingInvoices(onlyAnonymous = false): (typeof sales.$inferSelect)[] {
  const db = getDB()
  if (onlyAnonymous) {
    return db.select().from(sales)
      .where(and(
        eq(sales.invoiceSent, 0),
        or(isNull(sales.customerId), eq(sales.customerId, '')),
        or(isNull(sales.isReturn), eq(sales.isReturn, 0)),
      ))
      .orderBy(asc(sales.createdAt))
      .limit(200)
      .all()
  }
  return db.select().from(sales)
    .where(and(
      inArray(sales.invoiceSent, [0, 2]),
      or(isNull(sales.isReturn), eq(sales.isReturn, 0)),
    ))
    .orderBy(asc(sales.createdAt))
    .limit(50)
    .all()
}

export function markInvoiceSent(saleId: string, invoiceId: string): void {
  const db = getDB()
  const at = new Date().toISOString()
  db.update(sales)
    .set({
      invoiceSent:  1,
      invoiceId,
      invoiceAt:    at,
      invoiceError: null,
    })
    .where(eq(sales.id, saleId))
    .run()
}

export function markInvoiceError(saleId: string, error: string): void {
  const db = getDB()
  const at = new Date().toISOString()
  db.update(sales)
    .set({ invoiceSent: 2, invoiceError: error, invoiceAt: at })
    .where(eq(sales.id, saleId))
    .run()
}

/** ERP faturası için satır verisi (ürün kodu/birim products ile zenginleştirilir) */
export interface SaleItemInvoiceRow {
  productId:     string | null
  productCode:   string
  productName:   string
  quantity:      number
  price:         number
  vatRate:       number
  unit:          string
  discountRate:  number
}

export function getSaleItems(saleId: string): SaleItemInvoiceRow[] {
  const sqlite = getSqlite()
  const rows = sqlite.prepare(`
    SELECT
      si.product_id   AS product_id,
      si.product_name AS product_name,
      si.quantity     AS quantity,
      si.unit_price   AS unit_price,
      si.vat_rate     AS vat_rate,
      si.discount_rate AS discount_rate,
      p.code          AS p_code,
      p.unit          AS p_unit
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ?
  `).all(saleId) as Array<{
    product_id:      string | null
    product_name:    string
    quantity:        number
    unit_price:      number
    vat_rate:        number | null
    discount_rate:   number | null
    p_code:          string | null
    p_unit:          string | null
  }>

  return rows.map(r => ({
    productId:    r.product_id ?? null,
    productCode:  r.p_code || r.product_id || '',
    productName:  r.product_name,
    quantity:     r.quantity,
    price:        r.unit_price,
    vatRate:      r.vat_rate ?? 0,
    unit:         r.p_unit?.trim() ? r.p_unit : 'Adet',
    discountRate: r.discount_rate ?? 0,
  }))
}

export function getSaleByReceiptNo(receiptNo: string): { id: string; receiptNo: string } | null {
  const sqlite = getSqlite()
  return sqlite.prepare(
    'SELECT id, receipt_no AS receiptNo FROM sales WHERE receipt_no = ? LIMIT 1',
  ).get(receiptNo) as { id: string; receiptNo: string } | null
}

export function saveSalePayments(
  db: BetterSqlite3.Database,
  payments: SalePaymentRow[],
): void {
  const stmt = db.prepare(`
    INSERT INTO sale_payments (id, sale_id, method, amount, mediator, acquirer_id, acquirer_name, cashier_id, cashier_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const p of payments) {
    stmt.run(
      p.id,
      p.saleId,
      p.method,
      p.amount,
      p.mediator ?? null,
      p.acquirerId ?? null,
      p.acquirerName ?? null,
      p.cashierId ?? null,
      p.cashierName ?? null,
      p.createdAt ?? new Date().toISOString(),
    )
  }
}

export function getSalePayments(
  db: BetterSqlite3.Database,
  saleId: string,
): SalePaymentRow[] {
  return db.prepare(`
    SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY created_at
  `).all(saleId) as SalePaymentRow[]
}

export function getCardTotalsByBank(
  db: BetterSqlite3.Database,
  saleIds: string[],
): Record<string, { amount: number; acquirerName: string }> {
  if (saleIds.length === 0) return {}
  const placeholders = saleIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT acquirer_id, acquirer_name, SUM(amount) as total
    FROM sale_payments
    WHERE sale_id IN (${placeholders})
      AND method = 'card'
      AND acquirer_id IS NOT NULL
    GROUP BY acquirer_id
  `).all(...saleIds) as Array<{ acquirer_id: string; acquirer_name: string | null; total: number }>

  const result: Record<string, { amount: number; acquirerName: string }> = {}
  for (const r of rows) {
    result[r.acquirer_id] = {
      amount: Number(r.total ?? 0),
      acquirerName: r.acquirer_name ?? '',
    }
  }
  return result
}

export function getCashTotal(
  db: BetterSqlite3.Database,
  saleIds: string[],
): number {
  if (saleIds.length === 0) return 0
  const placeholders = saleIds.map(() => '?').join(',')
  const row = db.prepare(`
    SELECT SUM(amount) as total
    FROM sale_payments
    WHERE sale_id IN (${placeholders})
      AND method = 'cash'
  `).get(...saleIds) as { total: number | null } | undefined
  return Number(row?.total ?? 0)
}

export function getSales(dateFrom?: string, dateTo?: string) {
  const db = getDB()

  if (dateFrom && dateTo) {
    return db.select().from(sales)
      .where(and(gte(sales.createdAt, dateFrom), lte(sales.createdAt, dateTo)))
      .all()
  }

  return db.select().from(sales).all()
}

export interface LastSaleRow {
  receiptNo:       string
  pavoSaleNumber:  string | null
  orderNo:         string | null
}

export interface RecentSaleRow {
  id:             string
  receiptNo:      string
  pavoSaleNumber: string | null
  orderNo:        string | null
  netAmount:      number
  createdAt:      string
  customerName:   string | null
  cashierName:    string | null
}

function parsePavoFromPaymentData(paymentDeviceData: string | null | undefined): {
  pavoSaleNumber: string | null
  orderNo:        string | null
} {
  let pavoSaleNumber: string | null = null
  let orderNo: string | null = null
  if (!paymentDeviceData) return { pavoSaleNumber, orderNo }
  try {
    const pd = JSON.parse(paymentDeviceData) as Record<string, unknown>
    const raw = (pd.raw ?? pd) as Record<string, unknown>
    const data = raw.Data as Record<string, unknown> | undefined
    const sale = data?.Sale as Record<string, unknown> | undefined
    const saleNum = data?.SaleNumber ?? sale?.SaleNumber
    if (saleNum != null && String(saleNum).trim()) {
      pavoSaleNumber = String(saleNum).trim()
    }
    const ord = data?.OrderNo ?? sale?.OrderNo
    if (ord != null && String(ord).trim()) {
      orderNo = String(ord).trim()
    }
  } catch {
    // payment_device_data parse hatası — receiptNo kullanılır
  }
  return { pavoSaleNumber, orderNo }
}

/** Son satışlar — hızlı iade listesi (iade olmayan, yeniden eskiye) */
export interface GetRecentSalesOpts {
  limit?:    number
  dateFrom?: string
  dateTo?:   string
  timeFrom?: string
  timeTo?:   string
}

export function getRecentSales(opts: GetRecentSalesOpts = {}): RecentSaleRow[] {
  const db = getSqlite()
  const limit = opts.limit ?? 20
  const conditions = ['is_return = 0']
  const params: unknown[] = []

  if (opts.dateFrom) {
    conditions.push('date(created_at) >= ?')
    params.push(opts.dateFrom)
  }
  if (opts.dateTo) {
    conditions.push('date(created_at) <= ?')
    params.push(opts.dateTo)
  }
  if (opts.timeFrom) {
    conditions.push(`strftime('%H:%M', datetime(created_at)) >= ?`)
    params.push(opts.timeFrom)
  }
  if (opts.timeTo) {
    conditions.push(`strftime('%H:%M', datetime(created_at)) <= ?`)
    params.push(opts.timeTo)
  }

  const rows = db.prepare(`
    SELECT * FROM sales
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, limit) as Record<string, unknown>[]

  return rows.map(row => {
    const { pavoSaleNumber, orderNo: pavoOrderNo } = parsePavoFromPaymentData(
      row.payment_device_data as string | null | undefined,
    )
    return {
      id:             String(row.id),
      receiptNo:      String(row.receipt_no),
      pavoSaleNumber,
      orderNo:        row.order_no != null ? String(row.order_no) : pavoOrderNo,
      netAmount:      Number(row.net_amount),
      createdAt:      String(row.created_at),
      customerName:   row.customer_name != null ? String(row.customer_name) : null,
      cashierName:    row.cashier_name  != null ? String(row.cashier_name)  : null,
    }
  })
}

/** Son satış — hızlı iade için Pavo satış numarası varsa döner */
export function getLastSale(): LastSaleRow | null {
  const recent = getRecentSales({ limit: 1 })[0]
  if (!recent) return null
  return {
    receiptNo:      recent.receiptNo,
    pavoSaleNumber: recent.pavoSaleNumber,
    orderNo:        recent.orderNo,
  }
}

export interface CashierRow {
  id:           string
  companyId?:   string
  fullName:     string
  cashierCode:  string
  password:     string
  role:         string
  isActive:     boolean
  cardNumber?:  string | null
}

export function saveCashiers(items: CashierRow[]): number {
  const db = getDB()
  db.delete(cashiers).run()

  const now = new Date().toISOString()
  for (const item of items) {
    db.insert(cashiers).values({
      id:          item.id,
      companyId:   item.companyId ?? '',
      fullName:    item.fullName,
      cashierCode: item.cashierCode,
      password:    item.password,
      role:        item.role ?? 'cashier',
      isActive:    item.isActive ?? true,
      cardNumber:  item.cardNumber ?? null,
      syncedAt:    now,
    }).run()
  }
  return items.length
}

export function verifyCashier(code: string, password: string): CashierRow | null {
  const db = getDB()
  const result = db.select().from(cashiers)
    .where(and(
      eq(cashiers.cashierCode, code),
      eq(cashiers.password, password),
      eq(cashiers.isActive, true)
    ))
    .get()
  return result as CashierRow | null
}

/**
 * Kart numarası (barkod/RFID) ile kasiyer doğrula.
 * Şifre gerekmez — kart sahipliği yeterli.
 */
export function verifyCashierByCard(cardNumber: string): CashierRow | null {
  if (!cardNumber.trim()) return null
  const db     = getDB()
  const result = db.select().from(cashiers)
    .where(and(
      eq(cashiers.cardNumber, cardNumber.trim()),
      eq(cashiers.isActive, true)
    ))
    .get()
  return result ? {
    id:          result.id,
    companyId:   result.companyId,
    fullName:    result.fullName,
    cashierCode: result.cashierCode,
    password:    result.password,
    role:        result.role ?? 'cashier',
    isActive:    result.isActive ?? true,
    cardNumber:  result.cardNumber ?? null,
  } : null
}

export function getAllCashiers(): CashierRow[] {
  const db = getDB()
  return db.select().from(cashiers)
    .where(eq(cashiers.isActive, true))
    .all()
    .map(r => ({
      id:          r.id,
      companyId:   r.companyId,
      fullName:    r.fullName,
      cashierCode: r.cashierCode,
      password:    r.password,
      role:        r.role ?? 'cashier',
      isActive:    r.isActive ?? true,
      cardNumber:  r.cardNumber ?? null,
    }))
}

export interface HeldCartLine {
  id:             string
  code:           string
  name:           string
  category:       string
  price:          number
  vatRate:        number
  unit:           string
  quantity:       number
  lineTotal:      number
  discountRate?:  number
  discountAmount?: number
  netTotal?:      number
}

export interface HeldDoc {
  id:           string
  companyId:    string
  receiptNo?:   string
  orderNo?:     string
  label?:       string
  items:        HeldCartLine[]
  totalAmount:  number
  customerName?: string
  cashierName?:  string
  customer?:     unknown
  createdAt:    string
}

export function holdDocument(doc: Omit<HeldDoc, 'id' | 'createdAt'>): string {
  const db  = getDB()
  const id  = randomUUID()
  const now = new Date().toISOString()
  db.insert(heldDocuments).values({
    id,
    companyId:    doc.companyId,
    receiptNo:    doc.receiptNo ?? null,
    orderNo:      doc.orderNo ?? null,
    label:        doc.label ?? null,
    items:        JSON.stringify(doc.items),
    totalAmount:  doc.totalAmount,
    customerName: doc.customerName ?? null,
    cashierName:  doc.cashierName ?? null,
    customer:     doc.customer != null ? JSON.stringify(doc.customer) : null,
    createdAt:    now,
  }).run()
  return id
}

export function getHeldDocuments(companyId: string): HeldDoc[] {
  const db = getDB()
  const rows = db.select().from(heldDocuments)
    .where(eq(heldDocuments.companyId, companyId))
    .orderBy(asc(heldDocuments.createdAt))
    .all()
  return rows.map(r => ({
    id:           r.id,
    companyId:    r.companyId,
    receiptNo:    r.receiptNo ?? undefined,
    orderNo:      r.orderNo ?? undefined,
    label:        r.label ?? undefined,
    items:        JSON.parse(r.items) as HeldCartLine[],
    totalAmount:  r.totalAmount ?? 0,
    customerName: r.customerName ?? undefined,
    cashierName:  r.cashierName ?? undefined,
    customer:     r.customer ? JSON.parse(r.customer) as unknown : undefined,
    createdAt:    r.createdAt,
  }))
}

export function deleteHeldDocument(id: string): void {
  const db = getDB()
  db.delete(heldDocuments).where(eq(heldDocuments.id, id)).run()
}

export function updateHeldDocumentLabel(id: string, label: string): void {
  const db = getDB()
  db.update(heldDocuments)
    .set({ label: label || null })
    .where(eq(heldDocuments.id, id))
    .run()
}

export interface PluGroupCacheRow {
  id:           string
  companyId:    string
  workplaceId?: string
  terminalId?:  string
  cashierId?:   string
  name:         string
  color:        string
  sortOrder:    number
  plu_items:    Array<{ id: string; product_code: string; sort_order: number }>
}

export type DuplicateItemAction = 'increase_qty' | 'add_new'

export interface PosSettingsRow {
  showPrice:            boolean
  showCode:             boolean
  showBarcode:          boolean
  duplicateItemAction:  DuplicateItemAction
  minQtyPerLine:        number
  allowLineDiscount:    boolean
  allowDocDiscount:     boolean
  maxLineDiscountPct:   number
  maxDocDiscountPct:    number
  pluCols:              number
  pluRows:              number
  fontSizeName:         number
  fontSizePrice:        number
  fontSizeCode:         number
  source:               string
  loginWithCode:        boolean
  loginWithCard:        boolean
  torbaCariId:          string | null
  torbaCariName:        string | null
  invoiceType:          'e_archive' | 'paper'
  touchKeyboard?:       boolean
  customerDisplay?:     boolean
  printBehavior?:       Record<string, 'default' | 'ask' | 'none'>
  defaultTemplateIds?:  Record<string, string>
  allowExitWithHeldDocs?: boolean
  /** true = cari tahsilat/ödemede Pavo AdvanceSale kullan */
  cariPaymentUsePavo?:  boolean
  terminalNumber?:      string | null
  workplaceName?:       string | null
  workplaceAddress?:    string | null
  workplacePhone?:      string | null
  workplaceCity?:       string | null
  workplaceDistrict?:   string | null
  workplaceTaxOffice?:  string | null
  workplaceTaxNo?:      string | null
}

export interface PosSettingsAcidRow extends PosSettingsRow {
  cashierId?: string | null
}

export interface PaymentDeviceRow {
  id:              string
  companyId:       string
  terminalId:      string
  provider:        'pavo' | 'ingenico' | 'pax'
  ipAddress:       string | null
  port:            number
  serialNo:        string | null
  cardReadTimeout: number
  printWidth:      '58mm' | '80mm'
  isActive:        boolean
  syncedAt:        string | null
}

function normalizePrintWidth(width: unknown): '58mm' | '80mm' {
  const raw = String(width ?? '').toLowerCase().trim()
  if (raw === '58' || raw === '58mm' || raw.includes('58')) return '58mm'
  return '80mm'
}

export function savePluGroups(groups: PluGroupCacheRow[]): void {
  const db  = getDB()
  const now = new Date().toISOString()

  if (groups.length === 0) return

  const companyId = groups[0].companyId

  const existingGroups = db.select({ id: pluGroupsCache.id })
    .from(pluGroupsCache)
    .where(eq(pluGroupsCache.companyId, companyId))
    .all()

  for (const g of existingGroups) {
    db.delete(pluItemsCache).where(eq(pluItemsCache.groupId, g.id)).run()
  }
  db.delete(pluGroupsCache).where(eq(pluGroupsCache.companyId, companyId)).run()

  for (const group of groups) {
    db.insert(pluGroupsCache).values({
      id:          group.id,
      companyId:   group.companyId,
      workplaceId: group.workplaceId ?? null,
      terminalId:  group.terminalId ?? null,
      cashierId:   group.cashierId ?? null,
      name:        group.name,
      color:       group.color,
      sortOrder:   group.sortOrder ?? 0,
      syncedAt:    now,
    }).run()

    for (const item of (group.plu_items ?? [])) {
      db.insert(pluItemsCache).values({
        id:          item.id && item.id.length > 0 ? item.id : randomUUID(),
        groupId:     group.id,
        productCode: item.product_code,
        sortOrder:   item.sort_order ?? 0,
      }).run()
    }
  }
}

function mapPluGroups(
  db: ReturnType<typeof getDB>,
  groups: typeof pluGroupsCache.$inferSelect[]
): PluGroupCacheRow[] {
  return groups.map(g => {
    const items = db.select().from(pluItemsCache)
      .where(eq(pluItemsCache.groupId, g.id))
      .orderBy(asc(pluItemsCache.sortOrder))
      .all()
    return {
      id:          g.id,
      companyId:   g.companyId,
      workplaceId: g.workplaceId ?? undefined,
      terminalId:  g.terminalId ?? undefined,
      cashierId:   g.cashierId ?? undefined,
      name:        g.name,
      color:       g.color,
      sortOrder:   g.sortOrder ?? 0,
      plu_items:   items.map(i => ({
        id:           i.id,
        product_code: i.productCode,
        sort_order:   i.sortOrder ?? 0,
      })),
    }
  })
}

export function deleteCashierPluForTerminal(terminalId: string): void {
  const sqlite = getSqlite()

  const groupIds = sqlite.prepare(`
    SELECT id FROM plu_groups_cache
    WHERE terminal_id = ? AND cashier_id IS NOT NULL
  `).all(terminalId) as { id: string }[]

  if (groupIds.length === 0) return

  const ids = groupIds.map(g => g.id)
  const placeholders = ids.map(() => '?').join(',')

  sqlite.prepare(`
    DELETE FROM plu_items_cache WHERE group_id IN (${placeholders})
  `).run(...ids)

  sqlite.prepare(`
    DELETE FROM plu_groups_cache WHERE id IN (${placeholders})
  `).run(...ids)

  console.log(`[plu] ${ids.length} kasiyer bazlı grup temizlendi (terminal: ${terminalId})`)
}

export function getPluGroups(
  companyId: string,
  workplaceId?: string | null,
  cashierId?: string | null,
): PluGroupCacheRow[] {
  const db     = getDB()
  const sqlite = getSqlite()

  // 1. Kasiyer bazlı — cashierId verilmişse sadece o kasiyerin grupları
  if (cashierId) {
    const groups = db.select().from(pluGroupsCache)
      .where(and(
        eq(pluGroupsCache.companyId, companyId),
        eq(pluGroupsCache.cashierId, cashierId),
      ))
      .orderBy(asc(pluGroupsCache.sortOrder))
      .all()
    if (groups.length > 0) return mapPluGroups(db, groups)
  }

  // 2. İşyeri bazlı — cashier_id IS NULL zorunlu (kasiyer grupları karışmasın)
  if (workplaceId) {
    const rows = sqlite.prepare(`
      SELECT * FROM plu_groups_cache
      WHERE company_id = ? AND workplace_id = ? AND cashier_id IS NULL
      ORDER BY sort_order
    `).all(companyId, workplaceId) as typeof pluGroupsCache.$inferSelect[]
    if (rows.length > 0) return mapPluGroups(db, rows)
  }

  // 3. Şirket geneli — cashier_id IS NULL ve terminal_id IS NULL
  const rows = sqlite.prepare(`
    SELECT * FROM plu_groups_cache
    WHERE company_id = ? AND cashier_id IS NULL AND terminal_id IS NULL
    ORDER BY sort_order
  `).all(companyId) as typeof pluGroupsCache.$inferSelect[]
  return mapPluGroups(db, rows)
}

export function savePosSettings(settings: PosSettingsRow): void {
  const db = getDB()
  const now = new Date().toISOString()
  db.insert(posSettingsCache).values({
    id:                   'local',
    showPrice:            settings.showPrice,
    showCode:             settings.showCode,
    showBarcode:          settings.showBarcode,
    duplicateItemAction:  settings.duplicateItemAction,
    minQtyPerLine:        settings.minQtyPerLine,
    allowLineDiscount:    settings.allowLineDiscount,
    allowDocDiscount:     settings.allowDocDiscount,
    maxLineDiscountPct:   settings.maxLineDiscountPct,
    maxDocDiscountPct:    settings.maxDocDiscountPct,
    pluCols:              settings.pluCols ?? 4,
    pluRows:              settings.pluRows ?? 3,
    fontSizeName:         settings.fontSizeName ?? 12,
    fontSizePrice:        settings.fontSizePrice ?? 13,
    fontSizeCode:         settings.fontSizeCode ?? 9,
    source:               settings.source,
    pluMode:              'cashier',
    loginWithCode:        settings.loginWithCode ?? true,
    loginWithCard:        settings.loginWithCard ?? false,
    syncedAt:             now,
    torbaCariId:          settings.torbaCariId   ?? null,
    torbaCariName:        settings.torbaCariName ?? null,
    invoiceType:          settings.invoiceType ?? 'e_archive',
    touchKeyboard:        settings.touchKeyboard ?? true,
    customerDisplay:      settings.customerDisplay ?? true,
    printBehavior:        settings.printBehavior
      ? JSON.stringify(settings.printBehavior)
      : null,
    defaultTemplateIds: settings.defaultTemplateIds
      ? JSON.stringify(settings.defaultTemplateIds)
      : null,
    allowExitWithHeldDocs: settings.allowExitWithHeldDocs !== false,
    cariPaymentUsePavo:  Boolean(settings.cariPaymentUsePavo),
    terminalNumber:      settings.terminalNumber      ?? null,
    workplaceName:       settings.workplaceName       ?? null,
    workplaceAddress:    settings.workplaceAddress    ?? null,
    workplacePhone:      settings.workplacePhone      ?? null,
    workplaceCity:       settings.workplaceCity       ?? null,
    workplaceDistrict:   settings.workplaceDistrict   ?? null,
    workplaceTaxOffice:  settings.workplaceTaxOffice  ?? null,
    workplaceTaxNo:      settings.workplaceTaxNo      ?? null,
  }).onConflictDoUpdate({
    target: posSettingsCache.id,
    set: {
      showPrice:            settings.showPrice,
      showCode:             settings.showCode,
      showBarcode:          settings.showBarcode,
      duplicateItemAction:  settings.duplicateItemAction,
      minQtyPerLine:        settings.minQtyPerLine,
      allowLineDiscount:    settings.allowLineDiscount,
      allowDocDiscount:     settings.allowDocDiscount,
      maxLineDiscountPct:   settings.maxLineDiscountPct,
      maxDocDiscountPct:    settings.maxDocDiscountPct,
      pluCols:              settings.pluCols ?? 4,
      pluRows:              settings.pluRows ?? 3,
      fontSizeName:         settings.fontSizeName ?? 12,
      fontSizePrice:        settings.fontSizePrice ?? 13,
      fontSizeCode:         settings.fontSizeCode ?? 9,
      source:               settings.source,
      pluMode:              'cashier',
      loginWithCode:        settings.loginWithCode ?? true,
      loginWithCard:        settings.loginWithCard ?? false,
      syncedAt:             now,
      torbaCariId:          settings.torbaCariId   ?? null,
      torbaCariName:        settings.torbaCariName ?? null,
      invoiceType:          settings.invoiceType ?? 'e_archive',
      touchKeyboard:        settings.touchKeyboard ?? true,
      customerDisplay:      settings.customerDisplay ?? true,
      printBehavior:        settings.printBehavior
        ? JSON.stringify(settings.printBehavior)
        : null,
      defaultTemplateIds: settings.defaultTemplateIds
        ? JSON.stringify(settings.defaultTemplateIds)
        : null,
      allowExitWithHeldDocs: settings.allowExitWithHeldDocs !== false,
      cariPaymentUsePavo:  Boolean(settings.cariPaymentUsePavo),
      terminalNumber:      settings.terminalNumber      ?? null,
      workplaceName:       settings.workplaceName       ?? null,
      workplaceAddress:    settings.workplaceAddress    ?? null,
      workplacePhone:      settings.workplacePhone      ?? null,
      workplaceCity:       settings.workplaceCity       ?? null,
      workplaceDistrict:   settings.workplaceDistrict   ?? null,
      workplaceTaxOffice:  settings.workplaceTaxOffice  ?? null,
      workplaceTaxNo:      settings.workplaceTaxNo      ?? null,
    },
  }).run()
}

export function syncPosSettingsAcid(settings: PosSettingsAcidRow): SyncResult {
  const sqlite = getSqlite()
  const now    = new Date().toISOString()
  const rowId  = settings.cashierId ? `cashier_${settings.cashierId}` : 'local'
  const isLocal = rowId === 'local'

  const txn = sqlite.transaction(() => {
    // 1. Temp'e yaz
    sqlite.prepare(`
      INSERT OR REPLACE INTO pos_settings_temp (
        id, cashier_id, show_price, show_code, show_barcode,
        duplicate_item_action, min_qty_per_line,
        allow_line_discount, allow_doc_discount,
        max_line_discount_pct, max_doc_discount_pct,
        plu_cols, plu_rows, font_size_name, font_size_price, font_size_code,
        source, plu_mode, login_with_code, login_with_card, synced_at,
        torba_cari_id, torba_cari_name, invoice_type, touch_keyboard, customer_display, print_behavior, default_template_ids,
        allow_exit_with_held_docs, cari_payment_use_pavo,
        terminal_number, workplace_name, workplace_address, workplace_phone, workplace_city, workplace_district, workplace_tax_office, workplace_tax_no
      ) VALUES (
        @id, @cashierId, @showPrice, @showCode, @showBarcode,
        @duplicateItemAction, @minQtyPerLine,
        @allowLineDiscount, @allowDocDiscount,
        @maxLineDiscountPct, @maxDocDiscountPct,
        @pluCols, @pluRows, @fontSizeName, @fontSizePrice, @fontSizeCode,
        @source, @pluMode, @loginWithCode, @loginWithCard, @syncedAt,
        @torbaCariId, @torbaCariName, @invoiceType, @touchKeyboard, @customerDisplay, @printBehavior, @defaultTemplateIds,
        @allowExitWithHeldDocs, @cariPaymentUsePavo,
        @terminalNumber, @workplaceName, @workplaceAddress, @workplacePhone, @workplaceCity, @workplaceDistrict, @workplaceTaxOffice, @workplaceTaxNo
      )
    `).run({
      id:                  rowId,
      cashierId:           settings.cashierId ?? null,
      showPrice:           settings.showPrice ? 1 : 0,
      showCode:            settings.showCode ? 1 : 0,
      showBarcode:         settings.showBarcode ? 1 : 0,
      duplicateItemAction: settings.duplicateItemAction,
      minQtyPerLine:       settings.minQtyPerLine,
      allowLineDiscount:   settings.allowLineDiscount ? 1 : 0,
      allowDocDiscount:    settings.allowDocDiscount ? 1 : 0,
      maxLineDiscountPct:  settings.maxLineDiscountPct,
      maxDocDiscountPct:   settings.maxDocDiscountPct,
      pluCols:             settings.pluCols,
      pluRows:             settings.pluRows,
      fontSizeName:        settings.fontSizeName,
      fontSizePrice:       settings.fontSizePrice,
      fontSizeCode:        settings.fontSizeCode,
      source:              settings.source,
      pluMode:             'cashier',
      loginWithCode:       settings.loginWithCode ? 1 : 0,
      loginWithCard:       settings.loginWithCard ? 1 : 0,
      syncedAt:            now,
      torbaCariId:         settings.torbaCariId   ?? null,
      torbaCariName:       settings.torbaCariName ?? null,
      invoiceType:         settings.invoiceType ?? 'e_archive',
      touchKeyboard:       settings.touchKeyboard !== false ? 1 : 0,
      customerDisplay:     settings.customerDisplay !== false ? 1 : 0,
      printBehavior:       settings.printBehavior
        ? JSON.stringify(settings.printBehavior)
        : null,
      defaultTemplateIds: settings.defaultTemplateIds
        ? JSON.stringify(settings.defaultTemplateIds)
        : null,
      allowExitWithHeldDocs: settings.allowExitWithHeldDocs !== false ? 1 : 0,
      cariPaymentUsePavo:  settings.cariPaymentUsePavo ? 1 : 0,
      terminalNumber:     isLocal ? (settings.terminalNumber ?? null) : null,
      workplaceName:      isLocal ? (settings.workplaceName ?? null) : null,
      workplaceAddress:   isLocal ? (settings.workplaceAddress ?? null) : null,
      workplacePhone:     isLocal ? (settings.workplacePhone ?? null) : null,
      workplaceCity:      isLocal ? (settings.workplaceCity ?? null) : null,
      workplaceDistrict:  isLocal ? (settings.workplaceDistrict ?? null) : null,
      workplaceTaxOffice: isLocal ? (settings.workplaceTaxOffice ?? null) : null,
      workplaceTaxNo:     isLocal ? (settings.workplaceTaxNo ?? null) : null,
    })

    // 2. Doğrula
    const check = sqlite.prepare(
      'SELECT COUNT(*) as c FROM pos_settings_temp WHERE id = ?'
    ).get(rowId) as { c: number }
    if (check.c === 0) throw new Error('pos_settings_temp boş — rollback')

    // 3. Ana tabloya taşı
    sqlite.prepare(`
      INSERT OR REPLACE INTO pos_settings_cache (
        id, cashier_id, show_price, show_code, show_barcode,
        duplicate_item_action, min_qty_per_line,
        allow_line_discount, allow_doc_discount,
        max_line_discount_pct, max_doc_discount_pct,
        plu_cols, plu_rows, font_size_name, font_size_price, font_size_code,
        source, plu_mode, login_with_code, login_with_card, synced_at,
        torba_cari_id, torba_cari_name, invoice_type, touch_keyboard, customer_display, print_behavior, default_template_ids,
        allow_exit_with_held_docs, cari_payment_use_pavo,
        terminal_number, workplace_name, workplace_address, workplace_phone, workplace_city, workplace_district, workplace_tax_office, workplace_tax_no
      )
      SELECT
        id, cashier_id, show_price, show_code, show_barcode,
        duplicate_item_action, min_qty_per_line,
        allow_line_discount, allow_doc_discount,
        max_line_discount_pct, max_doc_discount_pct,
        plu_cols, plu_rows, font_size_name, font_size_price, font_size_code,
        source, plu_mode, login_with_code, login_with_card, synced_at,
        torba_cari_id, torba_cari_name, invoice_type, touch_keyboard, customer_display, print_behavior, default_template_ids,
        allow_exit_with_held_docs, cari_payment_use_pavo,
        terminal_number, workplace_name, workplace_address, workplace_phone, workplace_city, workplace_district, workplace_tax_office, workplace_tax_no
      FROM pos_settings_temp WHERE id = ?
    `).run(rowId)

    // 4. Temp temizle
    sqlite.prepare('DELETE FROM pos_settings_temp WHERE id = ?').run(rowId)
  })

  try {
    txn()
    return { success: true, inserted: 1, updated: 0, deleted: 0 }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

function normalizeDuplicateAction(v: string | null | undefined): DuplicateItemAction {
  return v === 'add_new' ? 'add_new' : 'increase_qty'
}

export function updatePosWorkplaceTerminalCache(data: Pick<
  PosSettingsRow,
  | 'terminalNumber' | 'workplaceName' | 'workplaceAddress' | 'workplacePhone'
  | 'workplaceCity' | 'workplaceDistrict' | 'workplaceTaxOffice' | 'workplaceTaxNo'
>): void {
  const sqlite = getSqlite()
  sqlite.prepare(`
    UPDATE pos_settings_cache SET
      terminal_number = ?, workplace_name = ?, workplace_address = ?,
      workplace_phone = ?, workplace_city = ?, workplace_district = ?,
      workplace_tax_office = ?, workplace_tax_no = ?
    WHERE id = 'local'
  `).run(
    data.terminalNumber ?? null,
    data.workplaceName ?? null,
    data.workplaceAddress ?? null,
    data.workplacePhone ?? null,
    data.workplaceCity ?? null,
    data.workplaceDistrict ?? null,
    data.workplaceTaxOffice ?? null,
    data.workplaceTaxNo ?? null,
  )
}

export function getPosSettings(cashierId?: string | null): PosSettingsRow {
  const db = getDB()

  const localRow = db.select().from(posSettingsCache)
    .where(eq(posSettingsCache.id, 'local'))
    .get()

  // Önce kasiyer bazlı ara
  let row: typeof posSettingsCache.$inferSelect | undefined = undefined

  if (cashierId) {
    const cashierRowId = `cashier_${cashierId}`
    row = db.select().from(posSettingsCache)
      .where(eq(posSettingsCache.id, cashierRowId))
      .get()
  }

  // Kasiyer ayarı yoksa kasa default'una düş
  if (!row) {
    row = localRow
  }

  const wp = localRow ?? row

  return {
    showPrice:            row?.showPrice            ?? true,
    showCode:             row?.showCode             ?? true,
    showBarcode:          row?.showBarcode          ?? false,
    duplicateItemAction:  normalizeDuplicateAction(row?.duplicateItemAction as string | undefined),
    minQtyPerLine:        row?.minQtyPerLine        ?? 1,
    allowLineDiscount:    row?.allowLineDiscount    ?? true,
    allowDocDiscount:     row?.allowDocDiscount     ?? true,
    maxLineDiscountPct:   row?.maxLineDiscountPct   ?? 100,
    maxDocDiscountPct:    row?.maxDocDiscountPct    ?? 100,
    pluCols:              row?.pluCols              ?? 4,
    pluRows:              row?.pluRows              ?? 3,
    fontSizeName:         row?.fontSizeName         ?? 12,
    fontSizePrice:        row?.fontSizePrice        ?? 13,
    fontSizeCode:         row?.fontSizeCode         ?? 9,
    source:               row?.source               ?? 'default',
    loginWithCode:        row?.loginWithCode        ?? true,
    loginWithCard:        row?.loginWithCard        ?? false,
    torbaCariId:          row?.torbaCariId          ?? null,
    torbaCariName:        row?.torbaCariName        ?? null,
    invoiceType:          (row?.invoiceType === 'paper' ? 'paper' : 'e_archive'),
    touchKeyboard:        row?.touchKeyboard ?? true,
    customerDisplay:      row?.customerDisplay ?? true,
    printBehavior:        parsePrintBehaviorField(row?.printBehavior),
    defaultTemplateIds: parseDefaultTemplateIdsField(row?.defaultTemplateIds),
    allowExitWithHeldDocs: row?.allowExitWithHeldDocs ?? true,
    cariPaymentUsePavo:   Boolean(row?.cariPaymentUsePavo),
    terminalNumber:    wp?.terminalNumber     ?? null,
    workplaceName:      wp?.workplaceName       ?? null,
    workplaceAddress:   wp?.workplaceAddress    ?? null,
    workplacePhone:     wp?.workplacePhone      ?? null,
    workplaceCity:      wp?.workplaceCity       ?? null,
    workplaceDistrict:  wp?.workplaceDistrict   ?? null,
    workplaceTaxOffice: wp?.workplaceTaxOffice  ?? null,
    workplaceTaxNo:     wp?.workplaceTaxNo      ?? null,
  }
}

function parseDefaultTemplateIdsField(
  raw: string | null | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (v != null && String(v).trim()) out[k] = String(v)
    }
    return Object.keys(out).length > 0 ? out : undefined
  } catch {
    return undefined
  }
}

function parsePrintBehaviorField(
  raw: string | null | undefined,
): PosSettingsRow['printBehavior'] {
  if (!raw) {
    return { satis: 'ask', tahsilat: 'ask', odeme: 'ask', iade: 'ask', gunsonu: 'default', etiket: 'none', manuel: 'none' }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, 'default' | 'ask' | 'none'> = {
      satis: 'ask', tahsilat: 'ask', odeme: 'ask', iade: 'ask', gunsonu: 'default', etiket: 'none', manuel: 'none',
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'default' || v === 'ask' || v === 'none') out[k] = v
    }
    return out
  } catch {
    return { satis: 'ask', tahsilat: 'ask', odeme: 'ask', iade: 'ask', gunsonu: 'default', etiket: 'none', manuel: 'none' }
  }
}

// Odeme cihazi ayarlarini getir
export function getPaymentDeviceSettings(provider = 'pavo'): PaymentDeviceRow | undefined {
  const db = getSqlite()
  const row = db.prepare(`
    SELECT * FROM payment_device_settings
    WHERE provider = ? AND is_active = 1
    LIMIT 1
  `).get(provider) as Record<string, unknown> | undefined
  if (!row) return undefined
  return {
    id:              String(row.id ?? ''),
    companyId:       String(row.company_id ?? ''),
    terminalId:      String(row.terminal_id ?? ''),
    provider:        String(row.provider ?? 'pavo') as PaymentDeviceRow['provider'],
    ipAddress:       row.ip_address != null ? String(row.ip_address) : null,
    port:            Number(row.port ?? 9100),
    serialNo:        row.serial_no != null ? String(row.serial_no) : null,
    cardReadTimeout: Number(row.card_read_timeout ?? 30),
    printWidth:      normalizePrintWidth(row.print_width),
    isActive:        Number(row.is_active ?? 1) === 1,
    syncedAt:        row.synced_at != null ? String(row.synced_at) : null,
  }
}

// Odeme cihazi ayarlarini kaydet (upsert)
export function upsertPaymentDeviceSettings(row: PaymentDeviceRow): void {
  const db = getSqlite()
  const printWidth = normalizePrintWidth(row.printWidth)
  db.prepare(`
    INSERT INTO payment_device_settings
      (id, company_id, terminal_id, provider, ip_address, port, serial_no, card_read_timeout, print_width, is_active, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id=excluded.company_id,
      terminal_id=excluded.terminal_id,
      provider=excluded.provider,
      ip_address=excluded.ip_address,
      port=excluded.port,
      serial_no=excluded.serial_no,
      card_read_timeout=excluded.card_read_timeout,
      print_width=excluded.print_width,
      is_active=excluded.is_active,
      synced_at=excluded.synced_at
  `).run(
    row.id,
    row.companyId,
    row.terminalId,
    row.provider,
    row.ipAddress,
    row.port,
    row.serialNo,
    row.cardReadTimeout,
    printWidth,
    row.isActive ? 1 : 0,
    row.syncedAt,
  )
}

export function getUnitPavoCode(db: BetterSqlite3.Database, unitName: string): string {
  const row = db.prepare(`
    SELECT pavo_code FROM unit_mappings WHERE unit_name = ? LIMIT 1
  `).get(unitName) as { pavo_code: string } | undefined
  return row?.pavo_code ?? 'C62'
}

export function upsertUnitMapping(
  db: BetterSqlite3.Database,
  row: { companyId: string; unitName: string; pavoCode: string },
): void {
  db.prepare(`
    INSERT INTO unit_mappings (id, company_id, unit_name, pavo_code)
    VALUES (lower(hex(randomblob(16))), ?, ?, ?)
    ON CONFLICT(company_id, unit_name) DO UPDATE SET pavo_code = excluded.pavo_code
  `).run(row.companyId, row.unitName, row.pavoCode)
}

export function getAllUnitMappings(db: BetterSqlite3.Database, companyId: string) {
  return db.prepare(`SELECT * FROM unit_mappings WHERE company_id = ?`).all(companyId)
}

export function getProductByCode(code: string): ProductRow | null {
  const db = getDB()
  const result = db.select().from(products).where(eq(products.code, code)).get()
  return (result as ProductRow | undefined) ?? null
}

export function getProductIdByCode(code: string): string | null {
  const sqlite = getSqlite()
  const row = sqlite.prepare(
    'SELECT id FROM products WHERE code = ? LIMIT 1',
  ).get(code) as { id: string } | undefined
  return row?.id ?? null
}

export function getProductByName(name: string): {
  id:      string
  code:    string
  name:    string
  vatRate: number
  unit:    string
} | null {
  const sqlite = getSqlite()

  const mapRow = (row: {
    id:       string
    code:     string
    name:     string
    vat_rate: number | null
    unit:     string | null
  }) => ({
    id:      row.id,
    code:    row.code ?? '',
    name:    row.name,
    vatRate: row.vat_rate ?? 20,
    unit:    row.unit?.trim() || 'Adet',
  })

  const exact = sqlite.prepare(
    'SELECT id, code, name, vat_rate, unit FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1',
  ).get(name) as {
    id: string; code: string; name: string; vat_rate: number | null; unit: string | null
  } | undefined
  if (exact) return mapRow(exact)

  const like = sqlite.prepare(
    'SELECT id, code, name, vat_rate, unit FROM products WHERE LOWER(name) LIKE LOWER(?) LIMIT 1',
  ).get(`%${name.trim()}%`) as {
    id: string; code: string; name: string; vat_rate: number | null; unit: string | null
  } | undefined

  return like ? mapRow(like) : null
}

// Pavo sequence — her islemde +1
export function nextPavoSequence(): number {
  const db = getSqlite()
  db.prepare('UPDATE pavo_sequence SET seq = seq + 1 WHERE id = 1').run()
  const row = db.prepare('SELECT seq FROM pavo_sequence WHERE id = 1').get() as { seq: number } | undefined
  return Number(row?.seq ?? 0)
}

export function updatePavoSequence(seq: number): void {
  const db = getSqlite()
  const safeSeq = Number.isFinite(seq) ? Math.max(0, Math.floor(seq)) : 0
  db.prepare('UPDATE pavo_sequence SET seq = ? WHERE id = 1').run(safeSeq)
}

export interface CommandHistoryRow {
  id:         string
  command:    string
  payload:    Record<string, unknown>
  status:     string
  receivedAt: string
  doneAt?:    string
}

export function saveCommandHistory(row: CommandHistoryRow): void {
  const sqlite = getSqlite()
  sqlite.prepare(`
    INSERT OR IGNORE INTO command_history (id, command, payload, status, received_at, done_at)
    VALUES (@id, @command, @payload, @status, @receivedAt, @doneAt)
  `).run({
    id:         row.id,
    command:    row.command,
    payload:    JSON.stringify(row.payload ?? {}),
    status:     row.status,
    receivedAt: row.receivedAt,
    doneAt:     row.doneAt ?? null,
  })
}

export function getCommandHistory(limit = 20): CommandHistoryRow[] {
  const db   = getDB()
  const rows = db.select().from(commandHistory)
    .orderBy(desc(commandHistory.receivedAt))
    .limit(limit)
    .all()
  return rows.map(r => ({
    id:         r.id,
    command:    r.command,
    payload:    JSON.parse(r.payload ?? '{}'),
    status:     r.status,
    receivedAt: r.receivedAt,
    doneAt:     r.doneAt ?? undefined,
  }))
}

export type SyncMode = 'full' | 'diff'

export interface SyncResult {
  success:  boolean
  inserted: number
  updated:  number
  deleted:  number
  error?:   string
}

/* ─────────────── PRODUCTS ─────────────── */

export function syncProductsAcid(items: ProductRow[], mode: SyncMode = 'full'): SyncResult {
  const db  = getSqlite()
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0
  let deleted = 0

  if (items.length === 0) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş liste — sync iptal' }
  }

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM products_temp').run()

    const insertTemp = db.prepare(`
      INSERT OR IGNORE INTO products_temp (id, code, name, barcode, price, vat_rate, unit, stock, category, synced_at, modification_date)
      VALUES (@id, @code, @name, @barcode, @price, @vatRate, @unit, @stock, @category, @syncedAt, @modificationDate)
    `)
    for (const item of items) {
      insertTemp.run({
        id: item.id,
        code: item.code ?? '',
        name: item.name,
        barcode: item.barcode ?? '',
        price: item.price ?? 0,
        vatRate: item.vatRate ?? 18,
        unit: item.unit ?? 'Adet',
        stock: item.stock ?? 0,
        category: item.category ?? '',
        syncedAt: now,
        modificationDate: item.modificationDate ?? null,
      })
    }

    const countRow = db.prepare('SELECT COUNT(*) as c FROM products_temp').get() as { c: number }
    if (countRow.c === 0) throw new Error('Temp tablo boş — rollback')

    if (mode === 'full') {
      const prevRow = db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }
      deleted = prevRow.c
      db.prepare('DELETE FROM products').run()
      db.prepare('INSERT INTO products SELECT * FROM products_temp').run()
      inserted = items.length
    } else {
      inserted = 0
      updated = 0
      const existing = new Map(
        (db.prepare('SELECT id, price, name FROM products').all() as { id: string; price: number; name: string }[])
          .map(r => [r.id, r])
      )
      const insertMain = db.prepare(`
        INSERT OR REPLACE INTO products (id, code, name, barcode, price, vat_rate, unit, stock, category, synced_at, modification_date)
        VALUES (@id, @code, @name, @barcode, @price, @vatRate, @unit, @stock, @category, @syncedAt, @modificationDate)
      `)
      for (const item of items) {
        const ex = existing.get(item.id)
        if (!ex || ex.price !== item.price || ex.name !== item.name) {
          insertMain.run({
            id: item.id,
            code: item.code ?? '',
            name: item.name,
            barcode: item.barcode ?? '',
            price: item.price ?? 0,
            vatRate: item.vatRate ?? 18,
            unit: item.unit ?? 'Adet',
            stock: item.stock ?? 0,
            category: item.category ?? '',
            syncedAt: now,
            modificationDate: item.modificationDate ?? null,
          })
          if (ex) updated++
          else inserted++
        }
      }
    }

    db.prepare('DELETE FROM products_temp').run()
  })

  try {
    txn()
    return { success: true, inserted, updated, deleted }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

/* ─────────────── PLU GROUPS ─────────────── */

export function syncPluGroupsAcid(groups: PluGroupCacheRow[], mode: SyncMode = 'full'): SyncResult {
  const db  = getSqlite()
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0
  let deleted = 0

  if (groups.length === 0) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş PLU listesi — sync iptal' }
  }

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM plu_groups_temp').run()
    db.prepare('DELETE FROM plu_items_temp').run()

    const insertGrp = db.prepare(`
      INSERT INTO plu_groups_temp (id, company_id, workplace_id, terminal_id, cashier_id, name, color, sort_order, synced_at)
      VALUES (@id, @companyId, @workplaceId, @terminalId, @cashierId, @name, @color, @sortOrder, @syncedAt)
    `)
    const insertItem = db.prepare(`
      INSERT INTO plu_items_temp (id, group_id, product_code, sort_order)
      VALUES (@id, @groupId, @productCode, @sortOrder)
    `)

    for (const g of groups) {
      insertGrp.run({
        id:          g.id,
        companyId:   g.companyId,
        workplaceId: g.workplaceId ?? null,
        terminalId:  g.terminalId ?? null,
        cashierId:   g.cashierId ?? null,
        name:        g.name,
        color:       g.color,
        sortOrder:   g.sortOrder ?? 0,
        syncedAt:    now,
      })
      inserted++
      for (const item of (g.plu_items ?? [])) {
        insertItem.run({
          id: item.id,
          groupId: g.id,
          productCode: item.product_code,
          sortOrder: item.sort_order ?? 0,
        })
      }
    }

    const grpCount = (db.prepare('SELECT COUNT(*) as c FROM plu_groups_temp').get() as { c: number }).c
    if (grpCount === 0) throw new Error('PLU temp boş — rollback')

    if (mode === 'full') {
      const companyId  = groups[0].companyId
      const cashierId  = groups[0].cashierId ?? null
      const terminalId = groups[0].terminalId ?? null

      // Scope'a göre sadece ilgili kayıtları sil
      let scopeWhere: string
      let scopeParams: unknown[]

      if (cashierId) {
        scopeWhere  = 'company_id = ? AND cashier_id = ?'
        scopeParams = [companyId, cashierId]
      } else if (terminalId) {
        scopeWhere  = 'company_id = ? AND terminal_id = ? AND cashier_id IS NULL'
        scopeParams = [companyId, terminalId]
      } else {
        scopeWhere  = 'company_id = ? AND terminal_id IS NULL AND cashier_id IS NULL'
        scopeParams = [companyId]
      }

      const existingIds = (
        db.prepare(`SELECT id FROM plu_groups_cache WHERE ${scopeWhere}`)
          .all(...scopeParams) as { id: string }[]
      ).map(r => r.id)

      deleted = existingIds.length

      if (existingIds.length > 0) {
        const ph = existingIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM plu_items_cache WHERE group_id IN (${ph})`).run(...existingIds)
        db.prepare(`DELETE FROM plu_groups_cache WHERE ${scopeWhere}`).run(...scopeParams)
      }

      db.prepare('INSERT INTO plu_groups_cache SELECT * FROM plu_groups_temp').run()
      db.prepare('INSERT INTO plu_items_cache SELECT * FROM plu_items_temp').run()
    } else {
      db.prepare(`
        INSERT OR REPLACE INTO plu_groups_cache
        SELECT * FROM plu_groups_temp
      `).run()
      db.prepare(`
        INSERT OR REPLACE INTO plu_items_cache
        SELECT * FROM plu_items_temp
      `).run()
      updated = inserted
      inserted = 0
    }

    db.prepare('DELETE FROM plu_groups_temp').run()
    db.prepare('DELETE FROM plu_items_temp').run()
  })

  try {
    txn()
    return { success: true, inserted, updated, deleted }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

/* ─────────────── CASHIERS ─────────────── */

export function syncCashiersAcid(cashierList: CashierRow[], companyId: string, mode: SyncMode = 'full'): SyncResult {
  const db = getSqlite()
  const now = new Date().toISOString()
  let inserted = 0
  let deleted = 0

  if (cashierList.length === 0) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş kasiyer listesi — sync iptal' }
  }

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM cashiers_temp').run()

    const ins = db.prepare(`
      INSERT INTO cashiers_temp (id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at)
      VALUES (@id, @companyId, @fullName, @cashierCode, @password, @role, @isActive, @cardNumber, @syncedAt)
    `)
    for (const c of cashierList) {
      ins.run({
        id:          c.id,
        companyId,
        fullName:    c.fullName,
        cashierCode: c.cashierCode,
        password:    c.password,
        role:        c.role ?? 'cashier',
        isActive:    c.isActive ? 1 : 0,
        cardNumber:  c.cardNumber ?? null,
        syncedAt:    now,
      })
      inserted++
    }

    const count = (db.prepare('SELECT COUNT(*) as c FROM cashiers_temp').get() as { c: number }).c
    if (count === 0) throw new Error('Kasiyer temp boş — rollback')

    // Aynı id başka company_id ile (ör. migration öncesi '') duruyorsa UNIQUE çakışır; önce bu id'leri temizle
    const delById = db.prepare('DELETE FROM cashiers WHERE id IN (SELECT id FROM cashiers_temp)').run() as { changes: number }

    if (mode === 'full') {
      const delByCompany = db.prepare('DELETE FROM cashiers WHERE company_id = ?').run(companyId) as { changes: number }
      deleted = delById.changes + delByCompany.changes
      db.prepare(`
        INSERT INTO cashiers (id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at)
        SELECT id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at FROM cashiers_temp
      `).run()
    } else {
      db.prepare(`
        INSERT INTO cashiers (id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at)
        SELECT id, company_id, full_name, cashier_code, password, role, is_active, card_number, synced_at FROM cashiers_temp
      `).run()
      deleted = delById.changes
    }

    db.prepare('DELETE FROM cashiers_temp').run()
  })

  try {
    txn()
    return { success: true, inserted, updated: 0, deleted }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

export interface CustomerRow {
  id:        string
  companyId: string
  code:      string
  name:      string
  phone:     string
  taxNo:     string
  address:   string
  balance:   number
  isPerson:  boolean
  firstName: string
  lastName:  string
  postalCode: string
  city:       string
  district:   string
  email:      string
  syncedAt?: string
}

function mapCustomerRow(r: Record<string, unknown>): CustomerRow {
  const ip = r.is_person
  const isPerson = !(ip === 0 || ip === false || ip === '0')
  return {
    id:        String(r.id ?? ''),
    companyId: String(r.company_id ?? ''),
    code:      String(r.code ?? ''),
    name:      String(r.name ?? ''),
    phone:     String(r.phone ?? ''),
    taxNo:     String(r.tax_no ?? ''),
    address:   String(r.address ?? ''),
    balance:   Number(r.balance ?? 0),
    isPerson,
    firstName: String(r.first_name ?? ''),
    lastName:  String(r.last_name ?? ''),
    postalCode: String(r.postal_code ?? ''),
    city:       String(r.city ?? ''),
    district:   String(r.district ?? ''),
    email:      String(r.email ?? ''),
    syncedAt:  r.synced_at != null ? String(r.synced_at) : undefined,
  }
}

export function syncCustomersAcid(
  items: CustomerRow[],
  companyId: string,
  mode: SyncMode = 'full',
): SyncResult {
  const db  = getSqlite()
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0
  let deleted = 0

  if (items.length === 0) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: 'Boş müşteri listesi' }
  }

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM customers_temp').run()

    const ins = db.prepare(`
      INSERT INTO customers_temp (id, company_id, code, name, phone, tax_no, address, balance,
        is_person, first_name, last_name, postal_code, city, district, email, synced_at)
      VALUES (@id, @companyId, @code, @name, @phone, @taxNo, @address, @balance,
        @isPerson, @firstName, @lastName, @postalCode, @city, @district, @email, @syncedAt)
    `)

    for (const c of items) {
      ins.run({
        id:        c.id,
        companyId,
        code:      c.code    ?? '',
        name:      c.name    ?? '',
        phone:     c.phone   ?? '',
        taxNo:     c.taxNo   ?? '',
        address:   c.address ?? '',
        balance:   c.balance ?? 0,
        isPerson:  c.isPerson ? 1 : 0,
        firstName: c.firstName ?? '',
        lastName:  c.lastName  ?? '',
        postalCode: c.postalCode ?? '',
        city:       c.city       ?? '',
        district:   c.district   ?? '',
        email:      c.email      ?? '',
        syncedAt:  now,
      })
      inserted++
    }

    const cnt = (db.prepare('SELECT COUNT(*) as c FROM customers_temp').get() as { c: number }).c
    if (cnt === 0) throw new Error('customers_temp boş — rollback')

    if (mode === 'full') {
      deleted = (db.prepare('SELECT COUNT(*) as c FROM customers WHERE company_id = ?').get(companyId) as { c: number }).c
      db.prepare('DELETE FROM customers WHERE company_id = ?').run(companyId)
      db.prepare('INSERT INTO customers SELECT * FROM customers_temp').run()
      inserted = items.length
    } else {
      db.prepare('INSERT OR REPLACE INTO customers SELECT * FROM customers_temp').run()
      updated = inserted
      inserted = 0
    }

    db.prepare('DELETE FROM customers_temp').run()
  })

  try {
    txn()
    return { success: true, inserted, updated, deleted }
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, deleted: 0, error: String(e) }
  }
}

export function getCustomerById(companyId: string, id: string): CustomerRow | null {
  if (!id.trim()) return null
  const db = getSqlite()
  const r = db.prepare(`
    SELECT * FROM customers WHERE company_id = ? AND id = ?
  `).get(companyId, id.trim()) as Record<string, unknown> | undefined
  if (!r) return null
  return mapCustomerRow(r)
}

export function getCustomers(companyId: string, query?: string): CustomerRow[] {
  const db = getSqlite()
  if (query && query.trim()) {
    const q = `%${query.trim().toLowerCase()}%`
    const rows = db.prepare(`
      SELECT * FROM customers
      WHERE company_id = ?
        AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(tax_no) LIKE ? OR LOWER(IFNULL(email,'')) LIKE ?)
      ORDER BY name
      LIMIT 100
    `).all(companyId, q, q, q, q, q) as Record<string, unknown>[]
    return rows.map(mapCustomerRow)
  }
  const rows = db.prepare(`
    SELECT * FROM customers WHERE company_id = ? ORDER BY name LIMIT 500
  `).all(companyId) as Record<string, unknown>[]
  return rows.map(mapCustomerRow)
}

export type OperationQueueType = 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice' | 'payment'

export interface OperationQueueRow {
  id:          string
  companyId:   string
  type:        OperationQueueType
  payload:     string
  status:      'pending' | 'pending_dayend' | 'processing' | 'success' | 'failed' | 'done'
  attempts:    number
  maxAttempts: number
  error:       string | null
  createdAt:   string
  sentAt:      string | null
  label:       string | null
}

function mapOperationQueueRow(r: Record<string, unknown>): OperationQueueRow {
  const st = String(r.status ?? 'pending')
  const status: OperationQueueRow['status'] =
    st === 'pending_dayend' || st === 'processing' || st === 'success' || st === 'failed' || st === 'done'
      ? st
      : 'pending'
  const tp = String(r.type ?? '')
  const type = (['invoice', 'return_invoice', 'customer', 'day_end_invoice', 'payment'].includes(tp)
    ? tp
    : 'invoice') as OperationQueueType
  return {
    id:          String(r.id ?? ''),
    companyId:   String(r.company_id ?? ''),
    type,
    payload:     String(r.payload ?? '{}'),
    status,
    attempts:    Number(r.attempts ?? 0),
    maxAttempts: Number(r.max_attempts ?? 3),
    error:       r.error != null ? String(r.error) : null,
    createdAt:   String(r.created_at ?? ''),
    sentAt:      r.sent_at != null ? String(r.sent_at) : null,
    label:       r.label != null ? String(r.label) : null,
  }
}

export function upsertCustomer(row: CustomerRow): void {
  const db = getSqlite()
  const synced = row.syncedAt ?? new Date().toISOString()
  db.prepare(`
    INSERT INTO customers (id, company_id, code, name, phone, tax_no, address, balance,
      is_person, first_name, last_name, postal_code, city, district, email, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, phone=excluded.phone, tax_no=excluded.tax_no,
      address=excluded.address, city=excluded.city, district=excluded.district,
      email=excluded.email,
      synced_at=excluded.synced_at
  `).run(
    row.id,
    row.companyId,
    row.code,
    row.name,
    row.phone,
    row.taxNo,
    row.address,
    row.balance,
    row.isPerson ? 1 : 0,
    row.firstName,
    row.lastName,
    row.postalCode,
    row.city,
    row.district,
    row.email ?? '',
    synced,
  )
}

export function enqueueOperation(params: {
  id:        string
  companyId: string
  type:      OperationQueueType
  payload:   Record<string, unknown>
  label?:    string
  status?:   'pending' | 'pending_dayend'
}): void {
  const db = getSqlite()
  const status = params.status ?? 'pending'
  db.prepare(`
    INSERT INTO operation_queue (id, company_id, type, payload, status, attempts, created_at, label)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    params.id,
    params.companyId,
    params.type,
    JSON.stringify(params.payload),
    status,
    new Date().toISOString(),
    params.label ?? null,
  )
}

export function markOperationDone(id: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue SET status = 'done', sent_at = ? WHERE id = ?
  `).run(new Date().toISOString(), id)
}

export function getPendingReturnInvoices(companyId: string): OperationQueueRow[] {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT * FROM operation_queue
    WHERE company_id = ?
      AND type = 'return_invoice'
      AND status = 'pending_dayend'
    ORDER BY created_at ASC
  `).all(companyId) as Record<string, unknown>[]
  return rows.map(mapOperationQueueRow)
}

export function getPendingOperations(companyId: string): OperationQueueRow[] {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT * FROM operation_queue
    WHERE company_id = ? AND status = 'pending' AND attempts < max_attempts
    ORDER BY created_at ASC
  `).all(companyId) as Record<string, unknown>[]
  return rows.map(mapOperationQueueRow)
}

export function getAllOperations(companyId: string, limit = 100): OperationQueueRow[] {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT * FROM operation_queue
    WHERE company_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(companyId, limit) as Record<string, unknown>[]
  return rows.map(mapOperationQueueRow)
}

export function markOperationProcessing(id: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ?
  `).run(id)
}

export function markOperationSuccess(id: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue SET status = 'success', sent_at = ?, error = NULL WHERE id = ?
  `).run(new Date().toISOString(), id)
}

export function markOperationFailed(id: string, error: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        error = ?
    WHERE id = ?
  `).run(error, id)
}

export function retryOperation(id: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE operation_queue SET status = 'pending', attempts = 0, error = NULL WHERE id = ?
  `).run(id)
}

export function deleteOperation(id: string): void {
  const db = getSqlite()
  db.prepare(`DELETE FROM operation_queue WHERE id = ?`).run(id)
}

export interface SalesReportRow {
  id:           string
  receiptNo:    string
  orderNo:      string | null
  type:         'sale' | 'return' | 'payment'
  netAmount:    number
  cashAmount:   number
  cardAmount:   number
  customerName: string | null
  cashierName:  string | null
  createdAt:    string
  invoiceSent:  number
  invoiceId:    string | null
  invoiceError: string | null
  isReturn:     number
  payments: Array<{
    method:       string
    amount:       number
    acquirerName: string | null
  }>
}

export function getSalesReport(opts: {
  dateFrom: string
  dateTo:   string
}): SalesReportRow[] {
  const db = getSqlite()

  const rows = db.prepare(`
    SELECT
      s.id, s.receipt_no, s.order_no, s.net_amount, s.cash_amount, s.card_amount,
      s.customer_name, s.cashier_name, s.created_at,
      s.invoice_sent, s.invoice_id, s.invoice_error, s.is_return
    FROM sales s
    WHERE date(s.created_at) >= ? AND date(s.created_at) <= ?
    ORDER BY s.created_at DESC
  `).all(opts.dateFrom, opts.dateTo) as Record<string, unknown>[]

  const payStmt = db.prepare(`
    SELECT method, amount, acquirer_name
    FROM sale_payments WHERE sale_id = ?
  `)

  return rows.map(s => {
    const payments = payStmt.all(String(s.id)) as {
      method: string
      amount: number
      acquirer_name: string | null
    }[]

    return {
      id:           String(s.id),
      receiptNo:    String(s.receipt_no),
      orderNo:      s.order_no != null ? String(s.order_no) : null,
      type:         s.is_return ? 'return' as const : 'sale' as const,
      netAmount:    Number(s.net_amount),
      cashAmount:   Number(s.cash_amount ?? 0),
      cardAmount:   Number(s.card_amount ?? 0),
      customerName: s.customer_name ? String(s.customer_name) : null,
      cashierName:  s.cashier_name  ? String(s.cashier_name)  : null,
      createdAt:    String(s.created_at),
      invoiceSent:  Number(s.invoice_sent ?? 0),
      invoiceId:    s.invoice_id    ? String(s.invoice_id)    : null,
      invoiceError: s.invoice_error ? String(s.invoice_error) : null,
      isReturn:     Number(s.is_return ?? 0),
      payments: payments.map(p => ({
        method:       p.method,
        amount:       p.amount,
        acquirerName: p.acquirer_name,
      })),
    }
  })
}

export function getDayEndReport(opts: {
  dateFrom: string
  dateTo:   string
}): Array<{
  id: string
  label: string | null
  status: string
  created_at: string
  sent_at: string | null
  error: string | null
}> {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT id, label, status, created_at, sent_at, error
    FROM operation_queue
    WHERE type = 'day_end_invoice'
      AND date(created_at) >= ? AND date(created_at) <= ?
    ORDER BY created_at DESC
  `).all(opts.dateFrom, opts.dateTo) as Record<string, unknown>[]

  return rows.map(r => ({
    id:         String(r.id),
    label:      r.label != null ? String(r.label) : null,
    status:     String(r.status),
    created_at: String(r.created_at),
    sent_at:    r.sent_at != null ? String(r.sent_at) : null,
    error:      r.error != null ? String(r.error) : null,
  }))
}

export interface CariPaymentSaveRow {
  id:           string
  companyId:    string
  type:         'tahsilat' | 'odeme'
  amount:       number
  customerId?:  string
  customerName?: string
  customerCode?: string
  cashierId?:   string
  cashierName?: string
  description?: string
  createdAt:    string
}

export interface CariPaymentReportRow {
  id:            string
  type:          'tahsilat' | 'odeme'
  amount:        number
  customer_name: string | null
  customer_code: string | null
  cashier_name:  string | null
  description:   string | null
  created_at:    string
}

export function saveCariPayment(row: CariPaymentSaveRow): void {
  const db = getSqlite()
  db.prepare(`
    INSERT INTO cari_payments
      (id, company_id, type, amount, customer_id, customer_name,
       customer_code, cashier_id, cashier_name, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.companyId, row.type, row.amount,
    row.customerId ?? null, row.customerName ?? null,
    row.customerCode ?? null, row.cashierId ?? null,
    row.cashierName ?? null, row.description ?? null,
    row.createdAt,
  )
}

export function getCariPayments(opts: {
  dateFrom:  string
  dateTo:    string
  companyId: string
}): CariPaymentReportRow[] {
  const db = getSqlite()
  const rows = db.prepare(`
    SELECT * FROM cari_payments
    WHERE company_id = ?
      AND date(created_at) >= ?
      AND date(created_at) <= ?
    ORDER BY created_at DESC
  `).all(opts.companyId, opts.dateFrom, opts.dateTo) as Record<string, unknown>[]

  return rows.map(r => ({
    id:            String(r.id),
    type:          String(r.type) as 'tahsilat' | 'odeme',
    amount:        Number(r.amount),
    customer_name: r.customer_name != null ? String(r.customer_name) : null,
    customer_code: r.customer_code != null ? String(r.customer_code) : null,
    cashier_name:  r.cashier_name  != null ? String(r.cashier_name)  : null,
    description:   r.description   != null ? String(r.description)   : null,
    created_at:    String(r.created_at),
  }))
}

export function saveEnabledBrands(
  terminalId: string,
  brands: Array<{ payment_provider_brand_id: number; payment_provider_brand_nm: string; payment_mediator: number }>
): void {
  const db = getSqlite()
  db.prepare(`DELETE FROM enabled_payment_brands WHERE terminal_id = ?`).run(terminalId)
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO enabled_payment_brands
      (terminal_id, payment_provider_brand_id, payment_provider_brand_nm, payment_mediator, synced_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  for (const b of brands) {
    stmt.run(terminalId, b.payment_provider_brand_id, b.payment_provider_brand_nm, b.payment_mediator, new Date().toISOString())
  }
}

export function getEnabledBrands(terminalId: string): Array<{
  payment_provider_brand_id: number
  payment_provider_brand_nm: string
  payment_mediator:          number
}> {
  return getSqlite().prepare(
    `SELECT payment_provider_brand_id, payment_provider_brand_nm, payment_mediator
     FROM enabled_payment_brands WHERE terminal_id = ? ORDER BY payment_provider_brand_id ASC`
  ).all(terminalId) as Array<{ payment_provider_brand_id: number; payment_provider_brand_nm: string; payment_mediator: number }>
}

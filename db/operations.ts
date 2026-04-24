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

export interface SaleRow {
  receiptNo: string
  totalAmount: number
  discountRate?: number
  discountAmount?: number
  netAmount: number
  paymentType: 'cash' | 'card' | 'mixed'
  cashAmount: number
  cardAmount: number
  customerId?:   string | null
  customerName?: string | null
  customerCode?: string | null
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

export function saveSale(sale: SaleRow, items: SaleItem[], device?: PaymentDeviceResult): string {
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

  db.insert(sales).values({
    id: saleId,
    receiptNo: sale.receiptNo,
    totalAmount: sale.totalAmount,
    discountRate: sale.discountRate ?? 0,
    discountAmount: sale.discountAmount ?? 0,
    netAmount: sale.netAmount,
    paymentType: sale.paymentType,
    cashAmount: sale.cashAmount,
    cardAmount: sale.cardAmount,
    createdAt: now,
    synced: false,
    customerId:   sale.customerId   ?? null,
    customerName: sale.customerName ?? null,
    customerCode: sale.customerCode ?? null,
    invoiceSent:  0,
    invoiceId:    null,
    invoiceError: null,
    invoiceAt:    null,
    paymentProvider: device?.provider ?? null,
    paymentDeviceData,
  }).run()

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

  return saleId
}

/** Bekleyen veya hatalı (yeniden denenecek) fatura kayıtları */
export function getPendingInvoices(onlyAnonymous = false): (typeof sales.$inferSelect)[] {
  const db = getDB()
  if (onlyAnonymous) {
    return db.select().from(sales)
      .where(and(
        eq(sales.invoiceSent, 0),
        or(isNull(sales.customerId), eq(sales.customerId, '')),
      ))
      .orderBy(asc(sales.createdAt))
      .limit(200)
      .all()
  }
  return db.select().from(sales)
    .where(inArray(sales.invoiceSent, [0, 2]))
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

export function getSales(dateFrom?: string, dateTo?: string) {
  const db = getDB()

  if (dateFrom && dateTo) {
    return db.select().from(sales)
      .where(and(gte(sales.createdAt, dateFrom), lte(sales.createdAt, dateTo)))
      .all()
  }

  return db.select().from(sales).all()
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
  id:          string
  companyId:   string
  label?:      string
  items:       HeldCartLine[]
  totalAmount: number
  createdAt:   string
}

export function holdDocument(doc: Omit<HeldDoc, 'id' | 'createdAt'>): string {
  const db  = getDB()
  const id  = randomUUID()
  const now = new Date().toISOString()
  db.insert(heldDocuments).values({
    id,
    companyId:   doc.companyId,
    label:       doc.label ?? null,
    items:       JSON.stringify(doc.items),
    totalAmount: doc.totalAmount,
    createdAt:   now,
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
    id:          r.id,
    companyId:   r.companyId,
    label:       r.label ?? undefined,
    items:       JSON.parse(r.items) as HeldCartLine[],
    totalAmount: r.totalAmount ?? 0,
    createdAt:   r.createdAt,
  }))
}

export function deleteHeldDocument(id: string): void {
  const db = getDB()
  db.delete(heldDocuments).where(eq(heldDocuments.id, id)).run()
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

export type PluMode = 'terminal' | 'cashier'

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
  pluMode:              PluMode
  loginWithCode:        boolean
  loginWithCard:        boolean
  torbaCariId:          string | null
  torbaCariName:        string | null
  invoiceType:          'e_archive' | 'paper'
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
  invoiceType:     'e_archive' | 'paper'
  isActive:        boolean
  syncedAt:        string | null
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
    pluMode:              settings.pluMode ?? 'terminal',
    loginWithCode:        settings.loginWithCode ?? true,
    loginWithCard:        settings.loginWithCard ?? false,
    syncedAt:             now,
    torbaCariId:          settings.torbaCariId   ?? null,
    torbaCariName:        settings.torbaCariName ?? null,
    invoiceType:          settings.invoiceType ?? 'e_archive',
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
      pluMode:              settings.pluMode ?? 'terminal',
      loginWithCode:        settings.loginWithCode ?? true,
      loginWithCard:        settings.loginWithCard ?? false,
      syncedAt:             now,
      torbaCariId:          settings.torbaCariId   ?? null,
      torbaCariName:        settings.torbaCariName ?? null,
      invoiceType:          settings.invoiceType ?? 'e_archive',
    },
  }).run()
}

export function syncPosSettingsAcid(settings: PosSettingsAcidRow): SyncResult {
  const sqlite = getSqlite()
  const now    = new Date().toISOString()
  const rowId  = settings.cashierId ? `cashier_${settings.cashierId}` : 'local'

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
        torba_cari_id, torba_cari_name, invoice_type
      ) VALUES (
        @id, @cashierId, @showPrice, @showCode, @showBarcode,
        @duplicateItemAction, @minQtyPerLine,
        @allowLineDiscount, @allowDocDiscount,
        @maxLineDiscountPct, @maxDocDiscountPct,
        @pluCols, @pluRows, @fontSizeName, @fontSizePrice, @fontSizeCode,
        @source, @pluMode, @loginWithCode, @loginWithCard, @syncedAt,
        @torbaCariId, @torbaCariName, @invoiceType
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
      pluMode:             settings.pluMode,
      loginWithCode:       settings.loginWithCode ? 1 : 0,
      loginWithCard:       settings.loginWithCard ? 1 : 0,
      syncedAt:            now,
      torbaCariId:         settings.torbaCariId   ?? null,
      torbaCariName:       settings.torbaCariName ?? null,
      invoiceType:         settings.invoiceType ?? 'e_archive',
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
        torba_cari_id, torba_cari_name, invoice_type
      )
      SELECT
        id, cashier_id, show_price, show_code, show_barcode,
        duplicate_item_action, min_qty_per_line,
        allow_line_discount, allow_doc_discount,
        max_line_discount_pct, max_doc_discount_pct,
        plu_cols, plu_rows, font_size_name, font_size_price, font_size_code,
        source, plu_mode, login_with_code, login_with_card, synced_at,
        torba_cari_id, torba_cari_name, invoice_type
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

export function getPosSettings(cashierId?: string | null): PosSettingsRow {
  const db = getDB()

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
    row = db.select().from(posSettingsCache)
      .where(eq(posSettingsCache.id, 'local'))
      .get()
  }

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
    pluMode:              (row?.pluMode === 'cashier' ? 'cashier' : 'terminal') as PluMode,
    loginWithCode:        row?.loginWithCode        ?? true,
    loginWithCard:        row?.loginWithCard        ?? false,
    torbaCariId:          row?.torbaCariId          ?? null,
    torbaCariName:        row?.torbaCariName        ?? null,
    invoiceType:          (row?.invoiceType === 'paper' ? 'paper' : 'e_archive'),
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
    printWidth:      (row.print_width === '58mm' ? '58mm' : '80mm'),
    invoiceType:     (row.invoice_type === 'paper' ? 'paper' : 'e_archive'),
    isActive:        Number(row.is_active ?? 1) === 1,
    syncedAt:        row.synced_at != null ? String(row.synced_at) : null,
  }
}

// Odeme cihazi ayarlarini kaydet (upsert)
export function upsertPaymentDeviceSettings(row: PaymentDeviceRow): void {
  const db = getSqlite()
  db.prepare(`
    INSERT INTO payment_device_settings
      (id, company_id, terminal_id, provider, ip_address, port, serial_no, card_read_timeout, print_width, invoice_type, is_active, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      company_id=excluded.company_id,
      terminal_id=excluded.terminal_id,
      provider=excluded.provider,
      ip_address=excluded.ip_address,
      port=excluded.port,
      serial_no=excluded.serial_no,
      card_read_timeout=excluded.card_read_timeout,
      print_width=excluded.print_width,
      invoice_type=excluded.invoice_type,
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
    row.printWidth,
    row.invoiceType,
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

// Pavo sequence — her islemde +1
export function nextPavoSequence(): number {
  const db = getSqlite()
  db.prepare('UPDATE pavo_sequence SET seq = seq + 1 WHERE id = 1').run()
  const row = db.prepare('SELECT seq FROM pavo_sequence WHERE id = 1').get() as { seq: number } | undefined
  return Number(row?.seq ?? 0)
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
      INSERT OR IGNORE INTO products_temp (id, code, name, barcode, price, vat_rate, unit, stock, category, synced_at)
      VALUES (@id, @code, @name, @barcode, @price, @vatRate, @unit, @stock, @category, @syncedAt)
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
        INSERT OR REPLACE INTO products (id, code, name, barcode, price, vat_rate, unit, stock, category, synced_at)
        VALUES (@id, @code, @name, @barcode, @price, @vatRate, @unit, @stock, @category, @syncedAt)
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
        is_person, first_name, last_name, postal_code, city, district, synced_at)
      VALUES (@id, @companyId, @code, @name, @phone, @taxNo, @address, @balance,
        @isPerson, @firstName, @lastName, @postalCode, @city, @district, @syncedAt)
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
        AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(tax_no) LIKE ?)
      ORDER BY name
      LIMIT 100
    `).all(companyId, q, q, q, q) as Record<string, unknown>[]
    return rows.map(mapCustomerRow)
  }
  const rows = db.prepare(`
    SELECT * FROM customers WHERE company_id = ? ORDER BY name LIMIT 500
  `).all(companyId) as Record<string, unknown>[]
  return rows.map(mapCustomerRow)
}

export type OperationQueueType = 'invoice' | 'return_invoice' | 'customer' | 'day_end_invoice'

export interface OperationQueueRow {
  id:          string
  companyId:   string
  type:        OperationQueueType
  payload:     string
  status:      'pending' | 'processing' | 'success' | 'failed'
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
    st === 'processing' || st === 'success' || st === 'failed' ? st : 'pending'
  const tp = String(r.type ?? '')
  const type = (['invoice', 'return_invoice', 'customer', 'day_end_invoice'].includes(tp)
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
      is_person, first_name, last_name, postal_code, city, district, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, phone=excluded.phone, tax_no=excluded.tax_no,
      address=excluded.address, city=excluded.city, district=excluded.district,
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
    synced,
  )
}

export function enqueueOperation(params: {
  id:        string
  companyId: string
  type:      OperationQueueType
  payload:   Record<string, unknown>
  label?:    string
}): void {
  const db = getSqlite()
  db.prepare(`
    INSERT INTO operation_queue (id, company_id, type, payload, status, attempts, created_at, label)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(
    params.id,
    params.companyId,
    params.type,
    JSON.stringify(params.payload),
    new Date().toISOString(),
    params.label ?? null,
  )
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

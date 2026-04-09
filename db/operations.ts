import { getDB, getSqlite } from './index'
import { products, sales, saleItems, cashiers, heldDocuments, pluGroupsCache, pluItemsCache, posSettingsCache, commandHistory } from './schema'
import { eq, gte, lte, and, asc, desc } from 'drizzle-orm'
import { randomUUID } from 'crypto'

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

export function saveSale(sale: SaleRow, items: SaleItem[]): string {
  const db = getDB()
  const saleId = randomUUID()
  const now = new Date().toISOString()

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
  }).run()

  for (const item of items) {
    db.insert(saleItems).values({
      id: randomUUID(),
      saleId,
      productId: item.productId,
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
    .all() as CashierRow[]
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
}

export interface PosSettingsAcidRow extends PosSettingsRow {
  cashierId?: string | null
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
  const db = getDB()

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

  if (workplaceId) {
    const groups = db.select().from(pluGroupsCache)
      .where(and(
        eq(pluGroupsCache.companyId, companyId),
        eq(pluGroupsCache.workplaceId, workplaceId),
      ))
      .orderBy(asc(pluGroupsCache.sortOrder))
      .all()
    if (groups.length > 0) return mapPluGroups(db, groups)
  }

  const groups = db.select().from(pluGroupsCache)
    .where(eq(pluGroupsCache.companyId, companyId))
    .orderBy(asc(pluGroupsCache.sortOrder))
    .all()
  return mapPluGroups(db, groups)
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
        source, plu_mode, login_with_code, login_with_card, synced_at
      ) VALUES (
        @id, @cashierId, @showPrice, @showCode, @showBarcode,
        @duplicateItemAction, @minQtyPerLine,
        @allowLineDiscount, @allowDocDiscount,
        @maxLineDiscountPct, @maxDocDiscountPct,
        @pluCols, @pluRows, @fontSizeName, @fontSizePrice, @fontSizeCode,
        @source, @pluMode, @loginWithCode, @loginWithCard, @syncedAt
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
        source, plu_mode, login_with_code, login_with_card, synced_at
      )
      SELECT
        id, cashier_id, show_price, show_code, show_barcode,
        duplicate_item_action, min_qty_per_line,
        allow_line_discount, allow_doc_discount,
        max_line_discount_pct, max_doc_discount_pct,
        plu_cols, plu_rows, font_size_name, font_size_price, font_size_code,
        source, plu_mode, login_with_code, login_with_card, synced_at
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
  }
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
        scopeWhere  = 'cashier_id = ?'
        scopeParams = [cashierId]
      } else if (terminalId) {
        scopeWhere  = 'terminal_id = ? AND cashier_id IS NULL'
        scopeParams = [terminalId]
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

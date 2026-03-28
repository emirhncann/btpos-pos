import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const activation = sqliteTable('activation', {
  id: integer('id').primaryKey(),
  terminalId: text('terminal_id').notNull(),
  companyId: text('company_id').notNull(),
  deviceUid: text('device_uid').notNull(),
  activatedAt: text('activated_at').notNull(),
  planName: text('plan_name'),
  expiryDate: text('expiry_date'),
})

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  code: text('code'),
  name: text('name').notNull(),
  barcode: text('barcode'),
  price: real('price').default(0),
  vatRate: real('vat_rate').default(18),
  unit: text('unit').default('Adet'),
  stock: real('stock').default(0),
  category: text('category'),
  syncedAt: text('synced_at'),
})

export const sales = sqliteTable('sales', {
  id: text('id').primaryKey(),
  receiptNo: text('receipt_no').notNull(),
  totalAmount: real('total_amount').notNull(),
  paymentType: text('payment_type').notNull(),
  cashAmount: real('cash_amount').default(0),
  cardAmount: real('card_amount').default(0),
  createdAt: text('created_at').notNull(),
  synced: integer('synced', { mode: 'boolean' }).default(false),
})

export const saleItems = sqliteTable('sale_items', {
  id: text('id').primaryKey(),
  saleId: text('sale_id').notNull().references(() => sales.id),
  productId: text('product_id'),
  productName: text('product_name').notNull(),
  quantity: real('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
  vatRate: real('vat_rate').default(18),
  lineTotal: real('line_total').notNull(),
})

// Kasiyerler (Supabase'den çekilip yerel cache olarak saklanır)
export const cashiers = sqliteTable('cashiers', {
  id:          text('id').primaryKey(),
  fullName:    text('full_name').notNull(),
  cashierCode: text('cashier_code').notNull(),
  password:    text('password').notNull(),
  role:        text('role').default('cashier'),
  isActive:    integer('is_active', { mode: 'boolean' }).default(true),
  syncedAt:    text('synced_at'),
})

export const heldDocuments = sqliteTable('held_documents', {
  id:          text('id').primaryKey(),
  companyId:   text('company_id').notNull(),
  label:       text('label'),
  items:       text('items').notNull(),
  totalAmount: real('total_amount').default(0),
  createdAt:   text('created_at').notNull(),
})

// PLU grupları (Supabase / API cache)
export const pluGroupsCache = sqliteTable('plu_groups_cache', {
  id:          text('id').primaryKey(),
  companyId:   text('company_id').notNull(),
  workplaceId: text('workplace_id'),
  name:        text('name').notNull(),
  color:       text('color').notNull().default('#90CAF9'),
  sortOrder:   integer('sort_order').default(0),
  syncedAt:    text('synced_at').notNull(),
})

// PLU kalemleri (cache)
export const pluItemsCache = sqliteTable('plu_items_cache', {
  id:          text('id').primaryKey(),
  groupId:     text('group_id').notNull(),
  productCode: text('product_code').notNull(),
  sortOrder:   integer('sort_order').default(0),
})

// POS ayarları (cache)
export const posSettingsCache = sqliteTable('pos_settings_cache', {
  id:          text('id').primaryKey(),
  showPrice:   integer('show_price', { mode: 'boolean' }).default(true),
  showCode:    integer('show_code', { mode: 'boolean' }).default(true),
  showBarcode: integer('show_barcode', { mode: 'boolean' }).default(false),
  source:      text('source').default('default'),
  syncedAt:    text('synced_at'),
})

// Kasanın aldığı komutların lokal geçmişi
export const commandHistory = sqliteTable('command_history', {
  id:          text('id').primaryKey(),
  command:     text('command').notNull(),
  payload:     text('payload').default('{}'),
  status:      text('status').notNull(),
  receivedAt:  text('received_at').notNull(),
  doneAt:      text('done_at'),
})

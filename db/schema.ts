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
  id:             text('id').primaryKey(),
  receiptNo:      text('receipt_no').notNull(),
  totalAmount:    real('total_amount').notNull(),
  discountRate:   real('discount_rate').default(0),
  discountAmount: real('discount_amount').default(0),
  netAmount:      real('net_amount').notNull(),
  paymentType:    text('payment_type').notNull(),
  cashAmount:     real('cash_amount').default(0),
  cardAmount:     real('card_amount').default(0),
  createdAt:      text('created_at').notNull(),
  synced:         integer('synced', { mode: 'boolean' }).default(false),
  customerId:     text('customer_id'),
  customerName:   text('customer_name'),
  customerCode:   text('customer_code'),
  invoiceSent:    integer('invoice_sent').notNull().default(0),
  invoiceId:      text('invoice_id'),
  invoiceError:   text('invoice_error'),
  invoiceAt:      text('invoice_at'),
})

export const saleItems = sqliteTable('sale_items', {
  id:             text('id').primaryKey(),
  saleId:         text('sale_id').notNull().references(() => sales.id),
  productId:      text('product_id'),
  productName:    text('product_name').notNull(),
  quantity:       real('quantity').notNull(),
  unitPrice:      real('unit_price').notNull(),
  vatRate:        real('vat_rate').default(18),
  discountRate:   real('discount_rate').default(0),
  discountAmount: real('discount_amount').default(0),
  lineTotal:      real('line_total').notNull(),
  appliedBy:      text('applied_by'),
})

// Kasiyerler (Supabase'den çekilip yerel cache olarak saklanır)
export const cashiers = sqliteTable('cashiers', {
  id:          text('id').primaryKey(),
  companyId:   text('company_id').notNull().default(''),
  fullName:    text('full_name').notNull(),
  cashierCode: text('cashier_code').notNull(),
  password:    text('password').notNull(),
  role:        text('role').default('cashier'),
  isActive:    integer('is_active', { mode: 'boolean' }).default(true),
  cardNumber:  text('card_number'),
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
  terminalId:  text('terminal_id'),
  cashierId:   text('cashier_id'),
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

export const customers = sqliteTable('customers', {
  id:        text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  code:      text('code').notNull().default(''),
  name:      text('name').notNull(),
  phone:     text('phone').notNull().default(''),
  taxNo:     text('tax_no').notNull().default(''),
  address:   text('address').notNull().default(''),
  balance:   real('balance').notNull().default(0),
  isPerson:  integer('is_person').notNull().default(1),
  firstName: text('first_name').notNull().default(''),
  lastName:  text('last_name').notNull().default(''),
  postalCode: text('postal_code').notNull().default(''),
  city:       text('city').notNull().default(''),
  district:   text('district').notNull().default(''),
  syncedAt:  text('synced_at').notNull(),
})

export const customersTemp = sqliteTable('customers_temp', {
  id:        text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  code:      text('code').notNull().default(''),
  name:      text('name').notNull(),
  phone:     text('phone').notNull().default(''),
  taxNo:     text('tax_no').notNull().default(''),
  address:   text('address').notNull().default(''),
  balance:   real('balance').notNull().default(0),
  isPerson:  integer('is_person').notNull().default(1),
  firstName: text('first_name').notNull().default(''),
  lastName:  text('last_name').notNull().default(''),
  postalCode: text('postal_code').notNull().default(''),
  city:       text('city').notNull().default(''),
  district:   text('district').notNull().default(''),
  syncedAt:  text('synced_at').notNull(),
})

// POS ayarları (cache)
export const posSettingsCache = sqliteTable('pos_settings_cache', {
  id:                   text('id').primaryKey(),
  cashierId:            text('cashier_id'),
  showPrice:            integer('show_price', { mode: 'boolean' }).default(true),
  showCode:             integer('show_code', { mode: 'boolean' }).default(true),
  showBarcode:          integer('show_barcode', { mode: 'boolean' }).default(false),
  duplicateItemAction:  text('duplicate_item_action').default('increase_qty'),
  minQtyPerLine:        integer('min_qty_per_line').default(1),
  allowLineDiscount:    integer('allow_line_discount', { mode: 'boolean' }).default(true),
  allowDocDiscount:     integer('allow_doc_discount', { mode: 'boolean' }).default(true),
  maxLineDiscountPct:   real('max_line_discount_pct').default(100),
  maxDocDiscountPct:    real('max_doc_discount_pct').default(100),
  pluCols:              integer('plu_cols').default(4),
  pluRows:              integer('plu_rows').default(3),
  fontSizeName:         integer('font_size_name').default(12),
  fontSizePrice:        integer('font_size_price').default(13),
  fontSizeCode:         integer('font_size_code').default(9),
  source:               text('source').default('default'),
  pluMode:              text('plu_mode').default('terminal'),
  loginWithCode:        integer('login_with_code', { mode: 'boolean' }).default(true),
  loginWithCard:        integer('login_with_card', { mode: 'boolean' }).default(false),
  syncedAt:             text('synced_at'),
  torbaCariId:          text('torba_cari_id'),
  torbaCariName:        text('torba_cari_name'),
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

// Temp tablolar — sync sırasında kullanılır, başarılı olunca ana tabloya geçer
export const productsTemp = sqliteTable('products_temp', {
  id:        text('id').primaryKey(),
  code:      text('code'),
  name:      text('name').notNull(),
  barcode:   text('barcode'),
  price:     real('price').default(0),
  vatRate:   real('vat_rate').default(18),
  unit:      text('unit').default('Adet'),
  stock:     real('stock').default(0),
  category:  text('category'),
  syncedAt:  text('synced_at'),
})

export const pluGroupsTemp = sqliteTable('plu_groups_temp', {
  id:          text('id').primaryKey(),
  companyId:   text('company_id').notNull(),
  workplaceId: text('workplace_id'),
  terminalId:  text('terminal_id'),
  cashierId:   text('cashier_id'),
  name:        text('name').notNull(),
  color:       text('color').notNull().default('#90CAF9'),
  sortOrder:   integer('sort_order').default(0),
  syncedAt:    text('synced_at').notNull(),
})

export const pluItemsTemp = sqliteTable('plu_items_temp', {
  id:          text('id').primaryKey(),
  groupId:     text('group_id').notNull(),
  productCode: text('product_code').notNull(),
  sortOrder:   integer('sort_order').default(0),
})

export const cashiersTemp = sqliteTable('cashiers_temp', {
  id:          text('id').primaryKey(),
  companyId:   text('company_id').notNull(),
  fullName:    text('full_name').notNull(),
  cashierCode: text('cashier_code').notNull(),
  password:    text('password').notNull(),
  role:        text('role').default('cashier'),
  isActive:    integer('is_active', { mode: 'boolean' }).default(true),
  cardNumber:  text('card_number'),
  syncedAt:    text('synced_at'),
})

// POS ayarları temp — ACID sync için
export const posSettingsTemp = sqliteTable('pos_settings_temp', {
  id:                   text('id').primaryKey(),
  cashierId:            text('cashier_id'),
  showPrice:            integer('show_price',   { mode: 'boolean' }).default(true),
  showCode:             integer('show_code',    { mode: 'boolean' }).default(true),
  showBarcode:          integer('show_barcode', { mode: 'boolean' }).default(false),
  duplicateItemAction:  text('duplicate_item_action').default('increase_qty'),
  minQtyPerLine:        integer('min_qty_per_line').default(1),
  allowLineDiscount:    integer('allow_line_discount', { mode: 'boolean' }).default(true),
  allowDocDiscount:     integer('allow_doc_discount',  { mode: 'boolean' }).default(true),
  maxLineDiscountPct:   real('max_line_discount_pct').default(100),
  maxDocDiscountPct:    real('max_doc_discount_pct').default(100),
  pluCols:              integer('plu_cols').default(4),
  pluRows:              integer('plu_rows').default(3),
  fontSizeName:         integer('font_size_name').default(12),
  fontSizePrice:        integer('font_size_price').default(13),
  fontSizeCode:         integer('font_size_code').default(9),
  source:               text('source').default('default'),
  pluMode:              text('plu_mode').default('terminal'),
  loginWithCode:        integer('login_with_code', { mode: 'boolean' }).default(true),
  loginWithCard:        integer('login_with_card', { mode: 'boolean' }).default(false),
  syncedAt:             text('synced_at'),
  torbaCariId:          text('torba_cari_id'),
  torbaCariName:        text('torba_cari_name'),
})

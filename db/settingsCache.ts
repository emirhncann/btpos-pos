import {
  DEFAULT_CASHIER_SETTINGS,
  DEFAULT_PRINT_BEHAVIOR,
  DEFAULT_TERMINAL_SETTINGS,
  parseCashierSettings,
  parsePaymentAccount,
  parseTerminalInfo,
  parseTerminalSettings,
  terminalInfoToJson,
  type CashierSettings,
  type PaymentAccountCache,
  type SettingsBundle,
  type TerminalSettings,
} from '../src/lib/settingsModel'

export interface SqliteLike {
  prepare(sql: string): {
    run(...args: unknown[]): unknown
    get(...args: unknown[]): unknown
    all(...args: unknown[]): unknown[]
  }
  exec(sql: string): void
  transaction<T>(fn: () => T): () => T
}

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS terminal_settings_cache (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  touch_keyboard         INTEGER NOT NULL DEFAULT 1,
  customer_display       INTEGER NOT NULL DEFAULT 0,
  invoice_type           TEXT    NOT NULL DEFAULT 'e_archive',
  torba_cari_id          TEXT,
  torba_cari_name        TEXT,
  cari_payment_use_pavo  INTEGER NOT NULL DEFAULT 0,
  enabled_payment_brands TEXT    NOT NULL DEFAULT '[]',
  login_with_code        INTEGER NOT NULL DEFAULT 1,
  login_with_card        INTEGER NOT NULL DEFAULT 0,
  default_template_ids   TEXT    NOT NULL DEFAULT '{}',
  terminal_info          TEXT    NOT NULL DEFAULT '{}',
  devtools_enabled       INTEGER NOT NULL DEFAULT 0,
  devtools_expires_at    TEXT,
  synced_at              TEXT
);

CREATE TABLE IF NOT EXISTS cashier_settings_cache (
  cashier_id                TEXT PRIMARY KEY,
  duplicate_item_action     TEXT    NOT NULL DEFAULT 'increase_qty',
  min_qty_per_line          INTEGER NOT NULL DEFAULT 1,
  allow_exit_with_held_docs INTEGER NOT NULL DEFAULT 1,
  allow_line_discount       INTEGER NOT NULL DEFAULT 1,
  max_line_discount_pct     REAL    NOT NULL DEFAULT 100,
  allow_doc_discount        INTEGER NOT NULL DEFAULT 1,
  max_doc_discount_pct      REAL    NOT NULL DEFAULT 100,
  plu_cols                  INTEGER NOT NULL DEFAULT 4,
  plu_rows                  INTEGER NOT NULL DEFAULT 3,
  font_size_name            INTEGER NOT NULL DEFAULT 12,
  font_size_price           INTEGER NOT NULL DEFAULT 13,
  font_size_code            INTEGER NOT NULL DEFAULT 9,
  show_price                INTEGER NOT NULL DEFAULT 1,
  show_code                 INTEGER NOT NULL DEFAULT 1,
  show_barcode              INTEGER NOT NULL DEFAULT 0,
  print_behavior            TEXT    NOT NULL DEFAULT '{"satis":"ask","tahsilat":"ask","odeme":"ask","iade":"ask","gunsonu":"default","etiket":"none","manuel":"none"}',
  synced_at                 TEXT
);

CREATE TABLE IF NOT EXISTS payment_accounts_cache (
  id TEXT PRIMARY KEY,
  payment_type TEXT NOT NULL,
  pavo_acquirer_id TEXT,
  isbasi_account_code TEXT NOT NULL,
  isbasi_account_name TEXT NOT NULL,
  isbasi_account_type INTEGER NOT NULL,
  isbasi_account_id TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);
`

export function tableExists(sqlite: SqliteLike, name: string): boolean {
  const row = sqlite.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(name) as { name?: string } | undefined
  return Boolean(row?.name)
}

function countRows(sqlite: SqliteLike, name: string): number {
  if (!tableExists(sqlite, name)) return 0
  const row = sqlite.prepare(`SELECT COUNT(*) as c FROM ${name}`).get() as { c: number }
  return Number(row?.c ?? 0)
}

function columnSet(sqlite: SqliteLike, name: string): Set<string> {
  if (!tableExists(sqlite, name)) return new Set()
  const rows = sqlite.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]
  return new Set(rows.map(r => r.name))
}

export function ensureSettingsTables(sqlite: SqliteLike): void {
  sqlite.exec(CREATE_SQL)
  const cols = columnSet(sqlite, 'terminal_settings_cache')
  if (!cols.has('devtools_enabled')) {
    sqlite.exec(`ALTER TABLE terminal_settings_cache ADD COLUMN devtools_enabled INTEGER NOT NULL DEFAULT 0`)
  }
  if (!cols.has('devtools_expires_at')) {
    sqlite.exec(`ALTER TABLE terminal_settings_cache ADD COLUMN devtools_expires_at TEXT`)
  }
}

export function dropLegacySettingsTables(sqlite: SqliteLike): void {
  sqlite.exec(`
    DROP TABLE IF EXISTS pos_settings;
    DROP TABLE IF EXISTS pos_settings_cache;
    DROP TABLE IF EXISTS pos_settings_temp;
  `)
}

function legacySource(sqlite: SqliteLike): string | null {
  if (countRows(sqlite, 'pos_settings') > 0) return 'pos_settings'
  if (countRows(sqlite, 'pos_settings_cache') > 0) return 'pos_settings_cache'
  return null
}

function bit(value: unknown, fallback: number): number {
  if (value == null) return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  return Number(value) === 0 ? 0 : 1
}

function legacyTerminalInfo(row: Record<string, unknown>, cols: Set<string>): string {
  const get = (name: string) => (cols.has(name) ? row[name] : null)
  const source = String(get('source') ?? '').trim()
  const generic = new Set(['', 'default', 'terminal', 'cashier'])
  const named = String(get('terminal_name') ?? get('kasa_adi') ?? '').trim()
  const terminalName = named || (generic.has(source) ? '' : source)
  const terminalNumber = String(get('terminal_number') ?? get('kasa_kodu') ?? '').trim()
  return terminalInfoToJson({
    ...(terminalName ? { terminalName } : {}),
    ...(terminalNumber ? { terminalNumber } : {}),
    workplace: {
      name: String(get('workplace_name') ?? ''),
      address: String(get('workplace_address') ?? ''),
      phone: String(get('workplace_phone') ?? ''),
      city: String(get('workplace_city') ?? ''),
      district: String(get('workplace_district') ?? ''),
      taxOffice: String(get('workplace_tax_office') ?? ''),
      taxNo: String(get('workplace_tax_no') ?? ''),
    },
  })
}

/** Eski pos_settings / pos_settings_cache satırlarını yeni tablolara bir kerelik taşır. */
export function migrateLegacySettings(sqlite: SqliteLike): void {
  ensureSettingsTables(sqlite)
  const source = legacySource(sqlite)
  const terminalEmpty = countRows(sqlite, 'terminal_settings_cache') === 0
  const cashierEmpty = countRows(sqlite, 'cashier_settings_cache') === 0

  if (source && terminalEmpty && cashierEmpty) {
    const cols = columnSet(sqlite, source)
    const rows = sqlite.prepare(`SELECT * FROM ${source}`).all() as Record<string, unknown>[]
    const now = new Date().toISOString()
    const insertTerminal = sqlite.prepare(`
      INSERT OR REPLACE INTO terminal_settings_cache (
        id, touch_keyboard, customer_display, invoice_type,
        torba_cari_id, torba_cari_name, cari_payment_use_pavo,
        enabled_payment_brands, login_with_code, login_with_card,
        default_template_ids, terminal_info, synced_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)
    `)
    const insertCashier = sqlite.prepare(`
      INSERT OR REPLACE INTO cashier_settings_cache (
        cashier_id, duplicate_item_action, min_qty_per_line,
        allow_exit_with_held_docs, allow_line_discount, max_line_discount_pct,
        allow_doc_discount, max_doc_discount_pct, plu_cols, plu_rows,
        font_size_name, font_size_price, font_size_code,
        show_price, show_code, show_barcode, print_behavior, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const copy = sqlite.transaction(() => {
      const local = rows.find(r => String(r.id ?? '') === 'local')
        ?? rows.find(r => !String(r.id ?? '').startsWith('cashier_') && r.cashier_id == null)
      if (local) {
        const templates = cols.has('default_template_ids') && local.default_template_ids
          ? String(local.default_template_ids)
          : '{}'
        insertTerminal.run(
          bit(local.touch_keyboard, 1),
          bit(local.customer_display, 0),
          local.invoice_type === 'paper' ? 'paper' : 'e_archive',
          local.torba_cari_id ?? null,
          local.torba_cari_name ?? null,
          bit(local.cari_payment_use_pavo, 0),
          bit(local.login_with_code, 1),
          bit(local.login_with_card, 0),
          templates,
          legacyTerminalInfo(local, cols),
          local.synced_at ?? now,
        )
      }
      for (const row of rows) {
        const rawId = String(row.id ?? '')
        const cashierId = rawId.startsWith('cashier_')
          ? rawId.slice('cashier_'.length)
          : (row.cashier_id != null && rawId !== 'local' ? String(row.cashier_id) : '')
        if (!cashierId) continue
        const behavior = row.print_behavior != null && String(row.print_behavior).trim()
          ? String(row.print_behavior)
          : JSON.stringify(DEFAULT_PRINT_BEHAVIOR)
        insertCashier.run(
          cashierId,
          row.duplicate_item_action === 'add_new' ? 'add_new' : 'increase_qty',
          Number(row.min_qty_per_line ?? 1),
          bit(row.allow_exit_with_held_docs, 1),
          bit(row.allow_line_discount, 1),
          Number(row.max_line_discount_pct ?? 100),
          bit(row.allow_doc_discount, 1),
          Number(row.max_doc_discount_pct ?? 100),
          Number(row.plu_cols ?? 4),
          Number(row.plu_rows ?? 3),
          Number(row.font_size_name ?? 12),
          Number(row.font_size_price ?? 13),
          Number(row.font_size_code ?? 9),
          bit(row.show_price, 1),
          bit(row.show_code, 1),
          bit(row.show_barcode, 0),
          behavior,
          row.synced_at ?? now,
        )
      }
    })
    copy()
  }

  if (countRows(sqlite, 'terminal_settings_cache') === 0) {
    sqlite.prepare(`INSERT INTO terminal_settings_cache (id) VALUES (1)`).run()
  }

  const legacyLeft = (tableExists(sqlite, 'pos_settings') ? countRows(sqlite, 'pos_settings') : 0)
    + (tableExists(sqlite, 'pos_settings_cache') ? countRows(sqlite, 'pos_settings_cache') : 0)
  if (countRows(sqlite, 'terminal_settings_cache') > 0 && legacyLeft === 0) {
    dropLegacySettingsTables(sqlite)
  }
}

function mapTerminalRow(row: Record<string, unknown> | undefined): TerminalSettings {
  if (!row) return { ...DEFAULT_TERMINAL_SETTINGS, terminalInfo: {}, defaultTemplateIds: {}, enabledPaymentBrands: [] }
  return parseTerminalSettings({
    touch_keyboard: row.touch_keyboard,
    customer_display: row.customer_display,
    invoice_type: row.invoice_type,
    torba_cari_id: row.torba_cari_id,
    torba_cari_name: row.torba_cari_name,
    cari_payment_use_pavo: row.cari_payment_use_pavo,
    enabled_payment_brands: row.enabled_payment_brands,
    login_with_code: row.login_with_code,
    login_with_card: row.login_with_card,
    default_template_ids: row.default_template_ids,
    terminal_info: row.terminal_info,
    devtools_enabled: row.devtools_enabled,
    devtools_expires_at: row.devtools_expires_at,
  })
}

export function readTerminalSettings(sqlite: SqliteLike): TerminalSettings {
  if (!tableExists(sqlite, 'terminal_settings_cache')) return { ...DEFAULT_TERMINAL_SETTINGS, terminalInfo: {} }
  const row = sqlite.prepare(`SELECT * FROM terminal_settings_cache WHERE id = 1`).get() as
    | Record<string, unknown>
    | undefined
  return mapTerminalRow(row)
}

export function readCashierSettings(sqlite: SqliteLike, cashierId: string | null | undefined): CashierSettings {
  if (!cashierId || !tableExists(sqlite, 'cashier_settings_cache')) {
    return { ...DEFAULT_CASHIER_SETTINGS, printBehavior: { ...DEFAULT_PRINT_BEHAVIOR } }
  }
  const row = sqlite.prepare(`SELECT * FROM cashier_settings_cache WHERE cashier_id = ?`).get(cashierId) as
    | Record<string, unknown>
    | undefined
  if (!row) return { ...DEFAULT_CASHIER_SETTINGS, printBehavior: { ...DEFAULT_PRINT_BEHAVIOR } }
  return parseCashierSettings({
    duplicate_item_action: row.duplicate_item_action,
    min_qty_per_line: row.min_qty_per_line,
    allow_exit_with_held_docs: row.allow_exit_with_held_docs,
    allow_line_discount: row.allow_line_discount,
    max_line_discount_pct: row.max_line_discount_pct,
    allow_doc_discount: row.allow_doc_discount,
    max_doc_discount_pct: row.max_doc_discount_pct,
    plu_cols: row.plu_cols,
    plu_rows: row.plu_rows,
    font_size_name: row.font_size_name,
    font_size_price: row.font_size_price,
    font_size_code: row.font_size_code,
    show_price: row.show_price,
    show_code: row.show_code,
    show_barcode: row.show_barcode,
    print_behavior: row.print_behavior,
  })
}

export function readPaymentAccounts(sqlite: SqliteLike): PaymentAccountCache[] {
  if (!tableExists(sqlite, 'payment_accounts_cache')) return []
  const rows = sqlite.prepare(`SELECT * FROM payment_accounts_cache`).all() as Record<string, unknown>[]
  return rows.map(parsePaymentAccount)
}

function sameType(stored: string, wanted: string): boolean {
  const a = stored.trim().toLowerCase()
  const b = wanted.trim().toLowerCase()
  if (a === b) return true
  const cash = new Set(['cash', 'nakit'])
  const card = new Set(['card', 'kredi', 'credit', 'kart'])
  if (cash.has(a) && cash.has(b)) return true
  if (card.has(a) && card.has(b)) return true
  return false
}

function pickAccount(rows: PaymentAccountCache[], type: string, acquirerId?: string | null): PaymentAccountCache | null {
  const typed = rows.filter(r => sameType(r.paymentType, type))
  if (acquirerId) {
    const byAcquirer = typed.find(r => r.pavoAcquirerId != null && String(r.pavoAcquirerId) === String(acquirerId))
    if (byAcquirer) return byAcquirer
  }
  return typed.find(r => r.isDefault) ?? typed[0] ?? null
}

function toPayloadAccount(row: PaymentAccountCache | null) {
  if (!row) return null
  return {
    id: row.id,
    payment_type: row.paymentType,
    pavo_acquirer_id: row.pavoAcquirerId,
    isbasi_account_code: row.isbasiAccountCode,
    isbasi_account_name: row.isbasiAccountName,
    isbasi_account_type: row.isbasiAccountType,
    isbasi_account_id: row.isbasiAccountId,
    is_default: row.isDefault,
  }
}

export function matchPaymentAccounts(
  sqlite: SqliteLike,
  opts: {
    cashAmount?: number
    cardAmount?: number
    cardAcquirerId?: string | null
    cardByBank?: Record<string, { amount?: number; acquirerName?: string }>
  },
): {
  cash: ReturnType<typeof toPayloadAccount>
  cards: Array<{ acquirer_id: string; amount: number; account: ReturnType<typeof toPayloadAccount> }>
} {
  const rows = readPaymentAccounts(sqlite)
  const cashAmount = Number(opts.cashAmount ?? 0)
  const cards: Array<{ acquirer_id: string; amount: number; account: ReturnType<typeof toPayloadAccount> }> = []
  const byBank = opts.cardByBank ?? {}
  const bankKeys = Object.keys(byBank)
  if (bankKeys.length > 0) {
    for (const key of bankKeys) {
      cards.push({
        acquirer_id: key,
        amount: Number(byBank[key]?.amount ?? 0),
        account: toPayloadAccount(pickAccount(rows, 'card', key === 'unknown' ? null : key)),
      })
    }
  } else if (Number(opts.cardAmount ?? 0) > 0 || opts.cardAcquirerId) {
    cards.push({
      acquirer_id: opts.cardAcquirerId ?? '',
      amount: Number(opts.cardAmount ?? 0),
      account: toPayloadAccount(pickAccount(rows, 'card', opts.cardAcquirerId)),
    })
  }
  return {
    cash: cashAmount > 0 ? toPayloadAccount(pickAccount(rows, 'cash')) : null,
    cards,
  }
}

const INSERT_TERMINAL = `
  INSERT OR REPLACE INTO terminal_settings_cache (
    id, touch_keyboard, customer_display, invoice_type,
    torba_cari_id, torba_cari_name, cari_payment_use_pavo,
    enabled_payment_brands, login_with_code, login_with_card,
    default_template_ids, terminal_info, devtools_enabled, devtools_expires_at, synced_at
  ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const INSERT_CASHIER = `
  INSERT INTO cashier_settings_cache (
    cashier_id, duplicate_item_action, min_qty_per_line,
    allow_exit_with_held_docs, allow_line_discount, max_line_discount_pct,
    allow_doc_discount, max_doc_discount_pct, plu_cols, plu_rows,
    font_size_name, font_size_price, font_size_code,
    show_price, show_code, show_barcode, print_behavior, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

/** Tek transaction. Hata fırlatır; çağıran rollback görür, eski satırlar kalır. */
export function applySettingsBundle(
  sqlite: SqliteLike,
  bundle: SettingsBundle,
  terminalId: string,
): void {
  if (!bundle.terminal) throw new Error('Kasa ayarı yok')
  ensureSettingsTables(sqlite)
  const now = new Date().toISOString()
  const t = bundle.terminal
  const txn = sqlite.transaction(() => {
    sqlite.prepare(INSERT_TERMINAL).run(
      t.touchKeyboard ? 1 : 0,
      t.customerDisplay ? 1 : 0,
      t.invoiceType === 'paper' ? 'paper' : 'e_archive',
      t.torbaCariId,
      t.torbaCariName,
      t.cariPaymentUsePavo ? 1 : 0,
      JSON.stringify(t.enabledPaymentBrands ?? []),
      t.loginWithCode ? 1 : 0,
      t.loginWithCard ? 1 : 0,
      JSON.stringify(t.defaultTemplateIds ?? {}),
      terminalInfoToJson(t.terminalInfo ?? {}),
      t.devtoolsEnabled ? 1 : 0,
      t.devtoolsExpiresAt,
      now,
    )

    sqlite.prepare(`DELETE FROM cashier_settings_cache`).run()
    const insertCashier = sqlite.prepare(INSERT_CASHIER)
    for (const c of bundle.cashiers) {
      insertCashier.run(
        c.cashierId,
        c.duplicateItemAction,
        c.minQtyPerLine,
        c.allowExitWithHeldDocs ? 1 : 0,
        c.allowLineDiscount ? 1 : 0,
        c.maxLineDiscountPct,
        c.allowDocDiscount ? 1 : 0,
        c.maxDocDiscountPct,
        c.pluCols,
        c.pluRows,
        c.fontSizeName,
        c.fontSizePrice,
        c.fontSizeCode,
        c.showPrice ? 1 : 0,
        c.showCode ? 1 : 0,
        c.showBarcode ? 1 : 0,
        JSON.stringify(c.printBehavior ?? DEFAULT_PRINT_BEHAVIOR),
        now,
      )
    }

    sqlite.prepare(`DELETE FROM payment_accounts_cache`).run()
    const insertAccount = sqlite.prepare(`
      INSERT INTO payment_accounts_cache (
        id, payment_type, pavo_acquirer_id, isbasi_account_code, isbasi_account_name,
        isbasi_account_type, isbasi_account_id, is_default
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const a of bundle.paymentAccounts) {
      insertAccount.run(
        a.id,
        a.paymentType,
        a.pavoAcquirerId,
        a.isbasiAccountCode,
        a.isbasiAccountName,
        a.isbasiAccountType,
        a.isbasiAccountId,
        a.isDefault ? 1 : 0,
      )
    }

    if (bundle.barcodeFormats) {
      sqlite.prepare(`DELETE FROM barcode_formats_cache WHERE terminal_id = ?`).run(terminalId)
      const insertFmt = sqlite.prepare(`
        INSERT OR REPLACE INTO barcode_formats_cache
          (id, company_id, terminal_id, flag_code, type,
           integer_length, decimal_length, decimal_multiplier,
           minimum_value, is_active, label, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const raw of bundle.barcodeFormats) {
        const f = raw
        const active = f.is_active === false || f.is_active === 0 ? 0 : 1
        insertFmt.run(
          String(f.id ?? ''),
          String(f.company_id ?? f.companyId ?? ''),
          String(f.terminal_id ?? f.terminalId ?? terminalId),
          Number(f.flag_code ?? f.flagCode ?? 0),
          String(f.type ?? 'counted'),
          Number(f.integer_length ?? f.integerLength ?? 0),
          Number(f.decimal_length ?? f.decimalLength ?? 0),
          Number(f.decimal_multiplier ?? f.decimalMultiplier ?? 1),
          Number(f.minimum_value ?? f.minimumValue ?? 1),
          active,
          f.label != null ? String(f.label) : null,
          now,
        )
      }
    }

    const check = sqlite.prepare(`SELECT COUNT(*) as c FROM terminal_settings_cache WHERE id = 1`).get() as { c: number }
    if (!check?.c) throw new Error('terminal_settings_cache boş — rollback')
  })
  txn()
}

export function legacyTerminalInfoFromRow(row: Record<string, unknown>): ReturnType<typeof parseTerminalInfo> {
  return parseTerminalInfo(row)
}

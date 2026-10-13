import { describe, expect, it } from 'vitest'
import { createBetterSqliteShim } from '../betterSqliteShim'
import {
  applySettingsBundle,
  dropLegacySettingsTables,
  ensureSettingsTables,
  migrateLegacySettings,
  readCashierSettings,
  readTerminalSettings,
  tableExists,
  type SqliteLike,
} from '../../db/settingsCache'
import { DEFAULT_CASHIER_SETTINGS, parseSettingsBundle } from '../../src/lib/settingsModel'

function db(): SqliteLike {
  return createBetterSqliteShim() as unknown as SqliteLike
}

const LEGACY = `
  CREATE TABLE pos_settings_cache (
    id TEXT PRIMARY KEY,
    cashier_id TEXT,
    show_price INTEGER,
    show_code INTEGER,
    show_barcode INTEGER,
    duplicate_item_action TEXT,
    min_qty_per_line INTEGER,
    allow_line_discount INTEGER,
    allow_doc_discount INTEGER,
    max_line_discount_pct REAL,
    max_doc_discount_pct REAL,
    plu_cols INTEGER,
    plu_rows INTEGER,
    font_size_name INTEGER,
    font_size_price INTEGER,
    font_size_code INTEGER,
    source TEXT,
    login_with_code INTEGER,
    login_with_card INTEGER,
    synced_at TEXT,
    torba_cari_id TEXT,
    torba_cari_name TEXT,
    invoice_type TEXT,
    touch_keyboard INTEGER,
    customer_display INTEGER,
    print_behavior TEXT,
    default_template_ids TEXT,
    allow_exit_with_held_docs INTEGER,
    cari_payment_use_pavo INTEGER,
    terminal_number TEXT,
    workplace_name TEXT,
    workplace_address TEXT,
    workplace_phone TEXT,
    workplace_city TEXT,
    workplace_district TEXT,
    workplace_tax_office TEXT,
    workplace_tax_no TEXT
  );
`

describe('kasa / kasiyer ayar ayrımı', () => {
  it('eski satırları yeni tablolara taşır ve kasa kolonlarını terminal_info içinde tutar', () => {
    const sqlite = db()
    sqlite.exec(LEGACY)
    sqlite.prepare(`
      INSERT INTO pos_settings_cache (
        id, invoice_type, touch_keyboard, customer_display, login_with_code, login_with_card,
        torba_cari_id, torba_cari_name, cari_payment_use_pavo, default_template_ids,
        terminal_number, workplace_name, workplace_city, source
      ) VALUES ('local', 'paper', 1, 1, 1, 1, 'T1', 'Torba', 1, '{"satis":"tpl"}', '007', 'Merkez', 'İstanbul', 'Kasa 1')
    `).run()
    sqlite.prepare(`
      INSERT INTO pos_settings_cache (
        id, cashier_id, plu_cols, plu_rows, duplicate_item_action, print_behavior, show_price
      ) VALUES ('cashier_ahmet', 'ahmet', 5, 6, 'add_new', '{"satis":"none"}', 0)
    `).run()

    migrateLegacySettings(sqlite)

    const terminal = readTerminalSettings(sqlite)
    expect(terminal.invoiceType).toBe('paper')
    expect(terminal.touchKeyboard).toBe(true)
    expect(terminal.customerDisplay).toBe(true)
    expect(terminal.loginWithCard).toBe(true)
    expect(terminal.torbaCariId).toBe('T1')
    expect(terminal.cariPaymentUsePavo).toBe(true)
    expect(terminal.defaultTemplateIds.satis).toBe('tpl')
    expect(terminal.terminalInfo.terminalNumber).toBe('007')
    expect(terminal.terminalInfo.terminalName).toBe('Kasa 1')
    expect(terminal.terminalInfo.workplace?.name).toBe('Merkez')
    expect(terminal.terminalInfo.workplace?.city).toBe('İstanbul')

    const ahmet = readCashierSettings(sqlite, 'ahmet')
    expect(ahmet.pluCols).toBe(5)
    expect(ahmet.pluRows).toBe(6)
    expect(ahmet.duplicateItemAction).toBe('add_new')
    expect(ahmet.printBehavior.satis).toBe('none')
    expect(ahmet.showPrice).toBe(false)
    expect(readCashierSettings(sqlite, 'yok').pluCols).toBe(DEFAULT_CASHIER_SETTINGS.pluCols)
    expect(tableExists(sqlite, 'pos_settings_cache')).toBe(true)
  })

  it('sync tek transaction ile yazar; hata olursa eski ayar kalır', () => {
    const sqlite = db()
    sqlite.exec(LEGACY)
    sqlite.prepare(`INSERT INTO pos_settings_cache (id, invoice_type) VALUES ('local', 'paper')`).run()
    migrateLegacySettings(sqlite)

    expect(() => applySettingsBundle(sqlite, {
      terminal: {
        ...readTerminalSettings(sqlite),
        invoiceType: 'e_archive',
      },
      cashiers: [{ ...DEFAULT_CASHIER_SETTINGS, cashierId: 'ayse', pluCols: 2 }],
      paymentAccounts: [{
        id: 'acc-card',
        paymentType: 'card',
        pavoAcquirerId: '12',
        isbasiAccountCode: '108',
        isbasiAccountName: 'POS',
        isbasiAccountType: 1,
        isbasiAccountId: null,
        isDefault: true,
      }],
      barcodeFormats: [{ id: 'fmt', flag_code: 21, type: 'weighted' }],
    }, 'term-1')).toThrow()

    expect(readTerminalSettings(sqlite).invoiceType).toBe('paper')
    expect(readCashierSettings(sqlite, 'ayse').pluCols).toBe(DEFAULT_CASHIER_SETTINGS.pluCols)
  })

  it('başarılı sync sonrası eski tabloyu siler', () => {
    const sqlite = db()
    sqlite.exec(LEGACY)
    sqlite.prepare(`INSERT INTO pos_settings_cache (id, invoice_type) VALUES ('local', 'e_archive')`).run()
    sqlite.exec(`
      CREATE TABLE barcode_formats_cache (
        id TEXT PRIMARY KEY, company_id TEXT, terminal_id TEXT, flag_code INTEGER,
        type TEXT, integer_length INTEGER, decimal_length INTEGER,
        decimal_multiplier INTEGER, minimum_value INTEGER, is_active INTEGER,
        label TEXT, synced_at TEXT
      );
    `)
    migrateLegacySettings(sqlite)
    applySettingsBundle(sqlite, parseSettingsBundle({
      terminal: {
        invoice_type: 'paper',
        touch_keyboard: 0,
        login_with_code: 1,
        login_with_card: 0,
        terminal_info: { terminal_name: 'Kasa A', terminal_number: '003' },
      },
      cashiers: [{ cashier_id: 'ahmet', plu_cols: 5, plu_rows: 6 }],
      payment_accounts: [],
      barcode_formats: [],
    }), 'term-1')
    dropLegacySettingsTables(sqlite)

    expect(readTerminalSettings(sqlite).invoiceType).toBe('paper')
    expect(readTerminalSettings(sqlite).touchKeyboard).toBe(false)
    expect(readTerminalSettings(sqlite).terminalInfo.terminalName).toBe('Kasa A')
    expect(readCashierSettings(sqlite, 'ahmet').pluCols).toBe(5)
    expect(readCashierSettings(sqlite, 'ahmet').pluRows).toBe(6)
    expect(tableExists(sqlite, 'pos_settings_cache')).toBe(false)
    expect(tableExists(sqlite, 'pos_settings_temp')).toBe(false)
  })

  it('kökteki terminal_info kasa numarası olarak okunur', () => {
    const bundle = parseSettingsBundle({
      terminal: { customer_display: true, invoice_type: 'e_archive' },
      terminal_info: { terminal_number: '12', terminal_name: 'Kasa A' },
      cashiers: [],
      payment_accounts: [],
    })
    expect(bundle.terminal.customerDisplay).toBe(true)
    expect(bundle.terminal.terminalInfo.terminalNumber).toBe('12')
    expect(bundle.terminal.terminalInfo.terminalName).toBe('Kasa A')
  })

  it('devtools iznini terminale yazar ve eski tabloya kolon ekler', () => {
    const sqlite = db()
    sqlite.exec(`
      CREATE TABLE terminal_settings_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        touch_keyboard INTEGER NOT NULL DEFAULT 1,
        customer_display INTEGER NOT NULL DEFAULT 0,
        invoice_type TEXT NOT NULL DEFAULT 'e_archive',
        torba_cari_id TEXT,
        torba_cari_name TEXT,
        cari_payment_use_pavo INTEGER NOT NULL DEFAULT 0,
        enabled_payment_brands TEXT NOT NULL DEFAULT '[]',
        login_with_code INTEGER NOT NULL DEFAULT 1,
        login_with_card INTEGER NOT NULL DEFAULT 0,
        default_template_ids TEXT NOT NULL DEFAULT '{}',
        terminal_info TEXT NOT NULL DEFAULT '{}',
        synced_at TEXT
      );
    `)
    ensureSettingsTables(sqlite)
    const cols = new Set(
      (sqlite.prepare(`PRAGMA table_info(terminal_settings_cache)`).all() as { name: string }[]).map(c => c.name),
    )
    expect(cols.has('devtools_enabled')).toBe(true)
    expect(cols.has('devtools_expires_at')).toBe(true)

    applySettingsBundle(sqlite, parseSettingsBundle({
      terminal: {
        invoice_type: 'e_archive',
        devtools_enabled: true,
        devtools_expires_at: '2026-10-03T13:25:00.000Z',
      },
      terminal_info: { terminal_number: '7' },
      cashiers: [],
      payment_accounts: [],
    }), 'term-1')
    const saved = readTerminalSettings(sqlite)
    expect(saved.devtoolsEnabled).toBe(true)
    expect(saved.devtoolsExpiresAt).toBe('2026-10-03T13:25:00.000Z')
    expect(saved.terminalInfo.terminalNumber).toBe('7')
  })
})

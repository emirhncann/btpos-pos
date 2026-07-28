export const API_URL = 'https://api.btpos.com.tr'

function parseApiPrintBehavior(raw: unknown): PosSettingsRow['printBehavior'] {
  if (!raw || typeof raw !== 'object') {
    return { satis: 'ask', tahsilat: 'ask', odeme: 'ask', iade: 'ask', gunsonu: 'default', etiket: 'none', manuel: 'none' }
  }
  const out: Record<string, 'default' | 'ask' | 'none'> = {
    satis: 'ask', tahsilat: 'ask', odeme: 'ask', iade: 'ask', gunsonu: 'default', etiket: 'none', manuel: 'none',
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === 'default' || v === 'ask' || v === 'none') out[k] = v
  }
  return out
}

function parseApiDefaultTemplateIds(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v != null && String(v).trim()) out[k] = String(v)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export const api = {

  async activate(licenseKey: string, deviceUid: string, email: string, deviceInfo: DeviceInfo) {
    const res = await fetch(`${API_URL}/management/licenses/terminals/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: licenseKey,
        device_uid:  deviceUid,
        email,
        device_name: deviceInfo.device_name,
        mac_address: deviceInfo.mac_address,
        os_info:     deviceInfo.os_info,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async checkLicense(companyId: string) {
    const res = await fetch(`${API_URL}/management/licenses/check/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getProducts(companyId: string) {
    const res = await fetch(`${API_URL}/integration/products/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getCustomers(companyId: string): Promise<CustomerRow[]> {
    const res = await fetch(`${API_URL}/integration/customers/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const list = data?.data?.data ?? data?.data?.items ?? data?.items ?? data ?? []
    return list.map((c: Record<string, unknown>) => {
      const isPersonRaw = c.isPerson
      const isPerson =
        isPersonRaw === false || isPersonRaw === 0 || isPersonRaw === '0' ? false : true
      return {
        id:        String(c.id ?? ''),
        companyId,
        code:      String(c.code ?? c.Code ?? ''),
        name:      String(c.name ?? c.Name ?? c.title ?? ''),
        phone:     String(c.phone ?? c.Phone ?? c.gsm ?? ''),
        taxNo:     String(c.taxNo ?? c.vkn ?? ''),
        address:   String(c.address ?? c.Address ?? ''),
        balance:   Number(c.balance ?? c.Balance ?? 0),
        isPerson,
        firstName: String(c.firstName ?? ''),
        lastName:  String(c.lastName ?? ''),
        postalCode: String(c.postalCode ?? c.postal_code ?? ''),
        city:       String(c.city ?? ''),
        district:   String(c.district ?? ''),
        email:      String(c.emailAddress ?? c.email ?? c.Email ?? ''),
      }
    })
  },

  async getCashiers(companyId: string): Promise<CashierRow[]> {
    const res = await fetch(`${API_URL}/cashiers/${companyId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data.map((c: Record<string, unknown>) => ({
      id:          String(c.id),
      fullName:    String(c.full_name),
      cashierCode: String(c.cashier_code),
      password:    String(c.password),
      role:        String(c.role ?? 'cashier'),
      isActive:    Boolean(c.is_active ?? true),
      cardNumber:  c.card_number ? String(c.card_number) : null,
    }))
  },

  /** Kasiyer girişi — terminal erişim kontrolü dahil */
  async loginCashier(
    cashierCode: string,
    password: string,
    companyId: string,
    terminalId: string,
  ): Promise<{
    ok: boolean
    status: number
    success?: boolean
    code?: string
    message?: string
    error?: string
    cashier_id?: string
    full_name?: string
    cashier_code?: string
    role?: string
    cashier?: Record<string, unknown>
  }> {
    const res = await fetch(`${API_URL}/cashiers/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cashier_code: cashierCode,
        password,
        company_id: companyId,
        terminal_id: terminalId,
      }),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, ...data }
  },

  // Komutları dinle (poll)
  async pollCommands(terminalId: string) {
    const res = await fetch(`${API_URL}/pos/commands/poll/${terminalId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<{
      success:       boolean
      poll_interval: number
      is_locked:     boolean
      lock_reason:   string | null
      commands: Array<{
        target_id:  string
        command_id: string
        command:    string
        payload:    Record<string, unknown>
        created_at: string
      }>
    }>
  },

  // Komutu tamamlandı/hata olarak işaretle
  async ackCommand(targetId: string, status: 'done' | 'failed', error?: string) {
    const res = await fetch(`${API_URL}/pos/commands/ack/${targetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, error }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getDailySummary(companyId: string, date?: string) {
    const query = date ? `?date=${date}` : ''
    const res   = await fetch(`${API_URL}/pos/sales/summary/${companyId}${query}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async getPosSettings(
    companyId:   string,
    workplaceId?: string | null,
    terminalId?:  string | null,
    cashierId?:   string | null,
  ): Promise<PosSettingsRow> {
    const params = new URLSearchParams({ company_id: companyId })
    if (workplaceId) params.append('workplace_id', workplaceId)
    if (terminalId)  params.append('terminal_id',  terminalId)
    if (cashierId)   params.append('cashier_id',   cashierId)
    const res = await fetch(`${API_URL}/pos-settings/resolve?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    return {
      showPrice:           Boolean(d.show_price            ?? true),
      showCode:            Boolean(d.show_code             ?? true),
      showBarcode:         Boolean(d.show_barcode          ?? false),
      duplicateItemAction: d.duplicate_item_action === 'add_new' ? 'add_new' : 'increase_qty',
      minQtyPerLine:       Number(d.min_qty_per_line      ?? 1),
      allowLineDiscount:   Boolean(d.allow_line_discount   ?? true),
      allowDocDiscount:    Boolean(d.allow_doc_discount    ?? true),
      maxLineDiscountPct:  Number(d.max_line_discount_pct ?? 100),
      maxDocDiscountPct:   Number(d.max_doc_discount_pct  ?? 100),
      pluCols:             Number(d.plu_cols              ?? 4),
      pluRows:             Number(d.plu_rows              ?? 3),
      fontSizeName:        Number(d.font_size_name        ?? 12),
      fontSizePrice:       Number(d.font_size_price       ?? 13),
      fontSizeCode:        Number(d.font_size_code        ?? 9),
      source:              String(d.source                ?? 'default'),
      loginWithCode:       Boolean(d.login_with_code      ?? true),
      loginWithCard:       Boolean(d.login_with_card      ?? false),
      torbaCariId:         d.torba_cari_id != null && String(d.torba_cari_id).trim() !== ''
        ? String(d.torba_cari_id)
        : null,
      torbaCariName:       d.torba_cari_name != null && String(d.torba_cari_name).trim() !== ''
        ? String(d.torba_cari_name)
        : null,
      invoiceType:         d.invoice_type === 'paper' ? 'paper' : 'e_archive',
      touchKeyboard:       d.touch_keyboard == null ? true : Boolean(d.touch_keyboard),
      customerDisplay:     d.customer_display == null ? true : Boolean(d.customer_display),
      printBehavior:       parseApiPrintBehavior(d.print_behavior),
      defaultTemplateIds:  parseApiDefaultTemplateIds(d.default_template_ids),
      allowExitWithHeldDocs: Boolean(d.allow_exit_with_held_docs ?? true),
      cariPaymentUsePavo:  Boolean(d.cari_payment_use_pavo ?? false),
      terminalNumber:    d.terminal_number != null ? String(d.terminal_number) : null,
      workplaceName:      d.workplace_name ?? null,
      workplaceAddress:   d.workplace_address ?? null,
      workplacePhone:     d.workplace_phone ?? null,
      workplaceCity:      d.workplace_city ?? null,
      workplaceDistrict:  d.workplace_district ?? null,
      workplaceTaxOffice: d.workplace_tax_office ?? null,
      workplaceTaxNo:     d.workplace_tax_no ?? null,
    }
  },

  async getTemplates(companyId: string): Promise<Record<string, unknown>[]> {
    const url = `${API_URL}/templates/${companyId}`
    console.log('[api.getTemplates] GET', url)
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`getTemplates HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.data)) return data.data
    if (Array.isArray(data?.templates)) return data.templates
    if (Array.isArray(data?.data?.templates)) return data.data.templates
    console.warn('[api.getTemplates] beklenmeyen JSON yapısı:', Object.keys(data ?? {}))
    return []
  },

  async getPaymentDeviceSettings(companyId: string, terminalId: string) {
    const res = await fetch(`${API_URL}/payment-devices/${companyId}/${terminalId}`)
    if (!res.ok) return []
    return res.json() as Promise<Array<{
      id: string
      company_id: string
      terminal_id: string
      provider: 'pavo' | 'ingenico' | 'pax'
      ip_address: string | null
      port: number | null
      serial_no: string | null
      card_read_timeout: number | null
      print_width: '58mm' | '80mm' | null
      is_active: boolean | null
    }>>
  },

  async sendInvoiceToErp(
    companyId: string,
    payload: {
      sale_id:      string
      customer:     {
        code?:      string
        name:       string
        firstName?: string
        lastName?:  string
        taxNo?:     string
        address?:    string
        phone?:      string
        isPerson?:   boolean
        postalCode?: string
        city?:       string
        district?:   string
      }
      items:        { product_code: string; name: string; quantity: number; price: number; vatRate: number; unit: string; discountRate?: number }[]
      invoice_date: string
      description?: string
      endpoint?: string
    },
  ): Promise<{ success: boolean; invoice_id?: string; invoice_number?: string; message?: string }> {
    const endpoint = payload.endpoint && payload.endpoint.trim().length > 0
      ? payload.endpoint
      : `/integration/invoice/${companyId}`
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
}

/** Sunucudan PLU listesi — yalnızca sync_plu (veya benzeri komut) işlenirken; POS doğrudan SQLite okur. */
export async function fetchPluGroupsFromServer(
  companyId: string,
  _workplaceId?: string | null,
  _terminalId?: string | null,
  cashierId?: string | null,
): Promise<PluGroup[]> {
  const params = new URLSearchParams()
  params.append('cashier_id', cashierId ?? '')

  const res = await fetch(
    `${API_URL}/plu/groups/${companyId}?${params.toString()}`,
  )
  if (!res.ok) throw new Error(`PLU fetch failed: ${res.status}`)
  return res.json()
}

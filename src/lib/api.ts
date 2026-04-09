export const API_URL = 'https://api.btpos.com.tr'

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
    return list.map((c: Record<string, unknown>) => ({
      id:      String(c.id ?? ''),
      code:    String(c.code ?? c.Code ?? ''),
      name:    String(c.name ?? c.Name ?? c.title ?? ''),
      phone:   String(c.phone ?? c.Phone ?? c.gsm ?? ''),
      taxNo:   String(c.taxNo ?? c.vkn ?? ''),
      balance: Number(c.balance ?? c.Balance ?? 0),
    }))
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
      pluMode:             d.plu_mode === 'cashier' ? 'cashier' : 'terminal',
      loginWithCode:       Boolean(d.login_with_code      ?? true),
      loginWithCard:       Boolean(d.login_with_card      ?? false),
    }
  },
}

/** Sunucudan PLU listesi — yalnızca sync_plu (veya benzeri komut) işlenirken; POS doğrudan SQLite okur. */
export async function fetchPluGroupsFromServer(
  companyId: string,
  workplaceId?: string | null,
  terminalId?: string | null,
  cashierId?: string | null,
): Promise<PluGroup[]> {
  const params = new URLSearchParams()
  if (cashierId)   params.append('cashier_id',  cashierId)
  if (terminalId)  params.append('terminal_id', terminalId)
  if (workplaceId) params.append('workplace_id', workplaceId)

  const res = await fetch(
    `${API_URL}/plu/groups/${companyId}?${params.toString()}`,
  )
  if (!res.ok) throw new Error(`PLU fetch failed: ${res.status}`)
  return res.json()
}

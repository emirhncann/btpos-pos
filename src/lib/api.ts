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

  async getPosSettings(companyId: string, workplaceId?: string | null, terminalId?: string | null): Promise<PosSettingsRow> {
    const params = new URLSearchParams({ company_id: companyId })
    if (workplaceId) params.append('workplace_id', workplaceId)
    if (terminalId)  params.append('terminal_id',  terminalId)
    const res = await fetch(`${API_URL}/pos-settings/resolve?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return {
      showPrice:   Boolean(data.show_price ?? true),
      showCode:    Boolean(data.show_code ?? true),
      showBarcode: Boolean(data.show_barcode ?? false),
      source:      String(data.source ?? 'default'),
    }
  },
}

/** Sunucudan PLU listesi — yalnızca sync_plu (veya benzeri komut) işlenirken; POS doğrudan SQLite okur. */
export async function fetchPluGroupsFromServer(companyId: string, workplaceId?: string | null): Promise<PluGroup[]> {
  const url = workplaceId
    ? `${API_URL}/workplaces/${workplaceId}/plu`
    : `${API_URL}/plu/groups/${companyId}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

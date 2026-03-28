const API_URL = 'https://api.btpos.com.tr'

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

  // PLU gruplarını getir — workplace öncelikli
  async getPluGroups(companyId: string, workplaceId?: string | null): Promise<PluGroup[]> {
    const url = workplaceId
      ? `${API_URL}/workplaces/${workplaceId}/plu`
      : `${API_URL}/plu/groups/${companyId}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? data : []
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
}

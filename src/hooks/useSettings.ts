import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  DEFAULT_CASHIER_SETTINGS,
  DEFAULT_TERMINAL_SETTINGS,
  type CashierSettings,
  type TerminalSettings,
} from '../lib/settingsModel'

export type { CashierSettings, TerminalSettings }
export { DEFAULT_CASHIER_SETTINGS, DEFAULT_TERMINAL_SETTINGS }

type SettingsPair = { terminal: TerminalSettings; cashier: CashierSettings }

const SettingsContext = createContext<SettingsPair>({
  terminal: DEFAULT_TERMINAL_SETTINGS,
  cashier: DEFAULT_CASHIER_SETTINGS,
})

let activeCashierId: string | null = null
let publish: ((pair: SettingsPair) => void) | null = null

function freshCashier(): CashierSettings {
  return { ...DEFAULT_CASHIER_SETTINGS, printBehavior: { ...DEFAULT_CASHIER_SETTINGS.printBehavior } }
}

/** Kasa satırını (ve varsa aktif kasiyeri) SQLite'tan yeniden okur. */
export async function reloadSettings(): Promise<void> {
  const terminal = await window.electron.db.getTerminalSettings()
  const cashier = activeCashierId
    ? await window.electron.db.getCashierSettings(activeCashierId)
    : freshCashier()
  publish?.({ terminal, cashier })
}

/** Kasiyer giriş/çıkış. Satır yoksa varsayılan kasiyer ayarı yüklenir. */
export function setActiveCashierId(id: string | null): void {
  activeCashierId = id
  void reloadSettings()
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [pair, setPair] = useState<SettingsPair>({
    terminal: DEFAULT_TERMINAL_SETTINGS,
    cashier: freshCashier(),
  })

  useEffect(() => {
    publish = setPair
    void reloadSettings().catch(() => {})
    return () => {
      if (publish === setPair) publish = null
    }
  }, [])

  return createElement(SettingsContext.Provider, { value: pair }, children)
}

export function useSettings(): { terminal: TerminalSettings; cashier: CashierSettings } {
  return useContext(SettingsContext)
}

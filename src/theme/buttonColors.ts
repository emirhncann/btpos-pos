import { THEMES, resolveButtonColor as resolveFromTheme } from './themes'

export type ButtonColorKey =
  'cash' | 'card' | 'split' | 'other_payment' | 'customer' | 'price_check' | 'menu' | 'documents'

export const DEFAULT_BUTTON_COLORS = THEMES.klasik.buttons

export function resolveButtonColor(
  key: ButtonColorKey,
  overrides: Record<string, { bg?: string; text?: string | null }> | undefined,
  themeKey?: unknown,
): { bg: string; text: string } {
  return resolveFromTheme(themeKey, key, overrides)
}

export function buttonColorsToJson(raw: unknown): string {
  if (raw == null) return '{}'
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t ? raw : '{}'
  }
  if (typeof raw === 'object') {
    try { return JSON.stringify(raw) } catch { return '{}' }
  }
  return '{}'
}

export function safeParseButtonColors(
  raw: unknown,
): Record<string, { bg?: string; text?: string | null }> {
  let value = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return {}
    try { value = JSON.parse(raw) as unknown } catch { return {} }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, { bg?: string; text?: string | null }>
}

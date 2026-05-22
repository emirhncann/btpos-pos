/** Şablon blokları ve yazdırma davranışı — renderer + main paylaşımı (tipler) */

export type PrintBehavior = 'default' | 'ask' | 'none'

export type TemplateBlockType =
  | 'text'
  | 'variable'
  | 'divider'
  | 'space'
  | 'logo'
  | 'barcode'

export interface TemplateBlock {
  id:     string
  type:   TemplateBlockType
  value?: string
  key?:   string
  label?: string
  align?: 'left' | 'center' | 'right'
  bold?:  boolean
  char?:  string
}

export type RenderData = Record<string, Record<string, unknown>>

export type PrintBehaviorMap = Record<string, PrintBehavior>

export const DEFAULT_PRINT_BEHAVIOR: PrintBehaviorMap = {
  satis:    'ask',
  tahsilat: 'ask',
  odeme:    'ask',
  iade:     'ask',
  gunsonu:  'default',
  etiket:   'none',
  manuel:   'none',
}

/** SQLite'ta print_behavior yokken kullanılır */
export const FALLBACK_PRINT_BEHAVIOR: PrintBehaviorMap = {
  satis:    'ask',
  tahsilat: 'ask',
  odeme:    'ask',
  iade:     'ask',
  gunsonu:  'default',
  etiket:   'none',
  manuel:   'none',
}

export function resolvePrintBehavior(raw: string | null | undefined): PrintBehaviorMap {
  if (!raw) return { ...FALLBACK_PRINT_BEHAVIOR }
  try {
    return normalizePrintBehavior(JSON.parse(raw))
  } catch {
    return { ...FALLBACK_PRINT_BEHAVIOR }
  }
}

export function normalizePrintBehavior(raw: unknown): PrintBehaviorMap {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PRINT_BEHAVIOR }
  const o = raw as Record<string, unknown>
  const out = { ...DEFAULT_PRINT_BEHAVIOR }
  for (const key of Object.keys(DEFAULT_PRINT_BEHAVIOR)) {
    const v = o[key]
    if (v === 'default' || v === 'ask' || v === 'none') {
      out[key] = v
    }
  }
  return out
}

export function parseTemplateSchema(raw: unknown): TemplateBlock[] {
  if (Array.isArray(raw)) return raw as TemplateBlock[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? (parsed as TemplateBlock[]) : []
    } catch {
      return []
    }
  }
  return []
}

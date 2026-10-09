/**
 * BTPOS — Kasiyer Temaları
 * Bu dosya Electron (src/theme/themes.ts) ve Admin (src/constants/themes.ts) tarafında BİREBİR aynı olmalı.
 *
 * KLASIK = bugünkü görünüm. Değerleri Electron sprintinin 1. adımında koddan çıkarılıp buraya yazılır.
 * Diğer temaların değerleri hazırdır.
 *
 * v2: + Kiraz Çiçeği, Gül Kurusu · + süsleme (decor) · + galeri bilgileri (description, tag)
 */

export type ThemeKey =
  | 'klasik' | 'okyanus' | 'galaksi' | 'orman' | 'gunbatimi'
  | 'kiraz' | 'gulkurusu' | 'gecesekeri'

export type ButtonColorKey =
  | 'cash' | 'card' | 'split' | 'other_payment'
  | 'customer' | 'price_check' | 'menu' | 'documents'

export interface ThemeTokens {
  bg: string
  surface: string
  surfaceAlt: string
  text: string
  textMuted: string
  border: string
  primary: string
  primaryText: string
  success: string
  warning: string
  danger: string
  discountText: string
  discountBg: string
  discountBar: string
  disabledBg: string
  disabledFg: string
  keyBg: string
  keyText: string
  keyBorder: string
  keyPressedBg: string
  keyActionBg: string
  keyActionText: string
  pluEmptyBg: string
}

/** Süsleme — sadece görsel katman, düzeni/boyutu DEĞİŞTİRMEZ */
export interface ThemeDecor {
  bgImage?: string
  headerBg?: string
  headerText?: string
  accentLine?: string
  ornament?: string
}

export interface PosTheme {
  key: ThemeKey
  label: string
  emoji: string
  dark: boolean
  description: string
  tag: 'Sade' | 'Renkli' | 'Koyu' | 'Süslü'
  experimental?: boolean
  tokens: ThemeTokens
  decor?: ThemeDecor
  buttons: Record<ButtonColorKey, { bg: string; text: string }>
}

export const THEMES: Record<ThemeKey, PosTheme> = {
  klasik: {
    key: 'klasik', label: 'Klasik', emoji: '⚪', dark: false,
    description: 'Bugünkü görünüm. Sade ve tanıdık.', tag: 'Sade',
    tokens: {
      bg: '#E5E7EB', surface: '#FFFFFF', surfaceAlt: '#F8FAFC',
      text: '#0F172A', textMuted: '#475569', border: '#CBD5E1',
      primary: '#1D4ED8', primaryText: '#FFFFFF',
      success: '#15803D', warning: '#D97706', danger: '#DC2626',
      discountText: '#C2410C', discountBg: '#FFF7ED', discountBar: '#F97316',
      disabledBg: '#E2E8F0', disabledFg: '#94A3B8',
      keyBg: '#FFFFFF', keyText: '#1F2937', keyBorder: '#CBD5E1',
      keyPressedBg: '#E5E7EB', keyActionBg: '#1D4ED8', keyActionText: '#FFFFFF',
      pluEmptyBg: '#FAFAFA',
    },
    buttons: {
      cash:          { bg: '#15803D', text: '#FFFFFF' },
      card:          { bg: '#1D4ED8', text: '#FFFFFF' },
      split:         { bg: '#4338CA', text: '#FFFFFF' },
      other_payment: { bg: '#334155', text: '#FFFFFF' },
      customer:      { bg: '#15803D', text: '#FFFFFF' },
      price_check:   { bg: '#D97706', text: '#FFFFFF' },
      menu:          { bg: '#1D4ED8', text: '#FFFFFF' },
      documents:     { bg: '#7C3AED', text: '#FFFFFF' },
    },
  },

  okyanus: {
    key: 'okyanus', label: 'Okyanus', emoji: '🌊', dark: false,
    description: 'Ferah mavi tonlar, göz yormayan açık zemin.', tag: 'Renkli',
    tokens: {
      bg: '#F0F9FF', surface: '#FFFFFF', surfaceAlt: '#E0F2FE',
      text: '#0C4A6E', textMuted: '#64748B', border: '#BAE6FD',
      primary: '#0369A1', primaryText: '#FFFFFF',
      success: '#059669', warning: '#D97706', danger: '#DC2626',
      discountText: '#C2410C', discountBg: '#FFF7ED', discountBar: '#F97316',
      disabledBg: '#E2E8F0', disabledFg: '#94A3B8',
      keyBg: '#FFFFFF', keyText: '#0C4A6E', keyBorder: '#BAE6FD', keyPressedBg: '#E0F2FE', keyActionBg: '#0369A1', keyActionText: '#FFFFFF',
      pluEmptyBg: 'rgba(255,255,255,0.45)',
    },
    buttons: {
      cash:          { bg: '#047857', text: '#FFFFFF' },
      card:          { bg: '#0369A1', text: '#FFFFFF' },
      split:         { bg: '#4338CA', text: '#FFFFFF' },
      other_payment: { bg: '#0E7490', text: '#FFFFFF' },
      customer:      { bg: '#1E40AF', text: '#FFFFFF' },
      price_check:   { bg: '#6D28D9', text: '#FFFFFF' },
      menu:          { bg: '#334155', text: '#FFFFFF' },
      documents:     { bg: '#075985', text: '#FFFFFF' },
    },
  },

  galaksi: {
    key: 'galaksi', label: 'Galaksi', emoji: '🌌', dark: true,
    description: 'Koyu mor zemin, gece vardiyası ve loş ortam için.', tag: 'Koyu',
    tokens: {
      bg: '#0F0A1E', surface: '#1A1035', surfaceAlt: '#251848',
      text: '#EDE9FE', textMuted: '#A1A1AA', border: '#3B2F6E',
      primary: '#A78BFA', primaryText: '#0F0A1E',
      success: '#34D399', warning: '#FBBF24', danger: '#F87171',
      discountText: '#FDBA74', discountBg: '#3A1F12', discountBar: '#F97316',
      disabledBg: '#2A2245', disabledFg: '#6B6489',
      keyBg: '#251848', keyText: '#EDE9FE', keyBorder: '#3B2F6E', keyPressedBg: '#3B2F6E', keyActionBg: '#6D28D9', keyActionText: '#FFFFFF',
      pluEmptyBg: 'rgba(37,24,72,0.45)',
    },
    decor: {
      bgImage: 'radial-gradient(rgba(237,233,254,.35) 1px, transparent 1.5px) 0 0 / 46px 46px, radial-gradient(rgba(167,139,250,.25) 1px, transparent 1.5px) 23px 23px / 46px 46px',
      headerBg: 'linear-gradient(90deg, #1A1035 0%, #2E1A5C 60%, #4C1D95 100%)',
      headerText: '#EDE9FE',
      accentLine: '#A78BFA',
      ornament: '✦',
    },
    buttons: {
      cash:          { bg: '#047857', text: '#FFFFFF' },
      card:          { bg: '#4F46E5', text: '#FFFFFF' },
      split:         { bg: '#7C3AED', text: '#FFFFFF' },
      other_payment: { bg: '#BE185D', text: '#FFFFFF' },
      customer:      { bg: '#0E7490', text: '#FFFFFF' },
      price_check:   { bg: '#A21CAF', text: '#FFFFFF' },
      menu:          { bg: '#3B2F6E', text: '#EDE9FE' },
      documents:     { bg: '#475569', text: '#FFFFFF' },
    },
  },

  orman: {
    key: 'orman', label: 'Orman', emoji: '🌿', dark: false,
    description: 'Doğal yeşiller, sakin ve dengeli.', tag: 'Renkli',
    tokens: {
      bg: '#F0FDF4', surface: '#FFFFFF', surfaceAlt: '#DCFCE7',
      text: '#14532D', textMuted: '#6B7280', border: '#BBF7D0',
      primary: '#15803D', primaryText: '#FFFFFF',
      success: '#047857', warning: '#B45309', danger: '#DC2626',
      discountText: '#C2410C', discountBg: '#FFF7ED', discountBar: '#F97316',
      disabledBg: '#E5E7EB', disabledFg: '#9CA3AF',
      keyBg: '#FFFFFF', keyText: '#14532D', keyBorder: '#BBF7D0', keyPressedBg: '#DCFCE7', keyActionBg: '#15803D', keyActionText: '#FFFFFF',
      pluEmptyBg: 'rgba(255,255,255,0.45)',
    },
    buttons: {
      cash:          { bg: '#15803D', text: '#FFFFFF' },
      card:          { bg: '#1D4ED8', text: '#FFFFFF' },
      split:         { bg: '#854D0E', text: '#FFFFFF' },
      other_payment: { bg: '#0F766E', text: '#FFFFFF' },
      customer:      { bg: '#3F6212', text: '#FFFFFF' },
      price_check:   { bg: '#B45309', text: '#FFFFFF' },
      menu:          { bg: '#374151', text: '#FFFFFF' },
      documents:     { bg: '#57534E', text: '#FFFFFF' },
    },
  },

  gunbatimi: {
    key: 'gunbatimi', label: 'Gün Batımı', emoji: '🌅', dark: false,
    description: 'Sıcak turuncu ve mercan tonları.', tag: 'Renkli',
    tokens: {
      bg: '#FFF7ED', surface: '#FFFFFF', surfaceAlt: '#FFEDD5',
      text: '#7C2D12', textMuted: '#78716C', border: '#FED7AA',
      primary: '#C2410C', primaryText: '#FFFFFF',
      success: '#15803D', warning: '#CA8A04', danger: '#BE123C',
      discountText: '#BE123C', discountBg: '#FFF1F2', discountBar: '#E11D48',
      disabledBg: '#E7E5E4', disabledFg: '#A8A29E',
      keyBg: '#FFFFFF', keyText: '#7C2D12', keyBorder: '#FED7AA', keyPressedBg: '#FFEDD5', keyActionBg: '#C2410C', keyActionText: '#FFFFFF',
      pluEmptyBg: 'rgba(255,255,255,0.45)',
    },
    buttons: {
      cash:          { bg: '#15803D', text: '#FFFFFF' },
      card:          { bg: '#1D4ED8', text: '#FFFFFF' },
      split:         { bg: '#C2410C', text: '#FFFFFF' },
      other_payment: { bg: '#BE185D', text: '#FFFFFF' },
      customer:      { bg: '#9A3412', text: '#FFFFFF' },
      price_check:   { bg: '#A16207', text: '#FFFFFF' },
      menu:          { bg: '#57534E', text: '#FFFFFF' },
      documents:     { bg: '#7C2D12', text: '#FFFFFF' },
    },
  },

  kiraz: {
    key: 'kiraz', label: 'Kiraz Çiçeği', emoji: '🌸', dark: false,
    description: 'Pembe tonlar, puantiyeli zemin ve çiçek süsü. Neşeli ve sevimli.', tag: 'Süslü',
    tokens: {
      bg: '#FFF1F5', surface: '#FFFFFF', surfaceAlt: '#FFE4EE',
      text: '#831843', textMuted: '#9D5C7D', border: '#FBCFE8',
      primary: '#BE185D', primaryText: '#FFFFFF',
      success: '#047857', warning: '#B45309', danger: '#BE123C',
      discountText: '#A21CAF', discountBg: '#FDF4FF', discountBar: '#D946EF',
      disabledBg: '#F5E6EC', disabledFg: '#B48DA0',
      keyBg: '#FFFFFF', keyText: '#831843', keyBorder: '#FBCFE8', keyPressedBg: '#FFE4EE', keyActionBg: '#BE185D', keyActionText: '#FFFFFF',
      pluEmptyBg: 'rgba(255,255,255,0.40)',
    },
    decor: {
      bgImage: 'radial-gradient(#FBCFE8 2px, transparent 2.5px) 0 0 / 24px 24px, radial-gradient(#F5D0FE 1.5px, transparent 2px) 12px 12px / 24px 24px',
      headerBg: 'linear-gradient(90deg, #F9A8D4 0%, #F472B6 50%, #C084FC 100%)',
      headerText: '#FFFFFF',
      accentLine: '#F472B6',
      ornament: '🌸',
    },
    buttons: {
      cash:          { bg: '#047857', text: '#FFFFFF' },
      card:          { bg: '#9D174D', text: '#FFFFFF' },
      split:         { bg: '#A21CAF', text: '#FFFFFF' },
      other_payment: { bg: '#6D28D9', text: '#FFFFFF' },
      customer:      { bg: '#BE185D', text: '#FFFFFF' },
      price_check:   { bg: '#86198F', text: '#FFFFFF' },
      menu:          { bg: '#831843', text: '#FFFFFF' },
      documents:     { bg: '#9F1239', text: '#FFFFFF' },
    },
  },

  gulkurusu: {
    key: 'gulkurusu', label: 'Gül Kurusu', emoji: '🌹', dark: false,
    description: 'Pudra ve gül kurusu tonları, altın detaylar. Zarif ve şık.', tag: 'Süslü',
    tokens: {
      bg: '#FAF3F0', surface: '#FFFDFB', surfaceAlt: '#F5E1DC',
      text: '#5B2A33', textMuted: '#85646A', border: '#E8C9C1',
      primary: '#9E4F5C', primaryText: '#FFFFFF',
      success: '#3F7D58', warning: '#A16207', danger: '#B42318',
      discountText: '#9E4F5C', discountBg: '#FBEDEA', discountBar: '#C9A227',
      disabledBg: '#EFE4E1', disabledFg: '#B39C98',
      keyBg: '#FFFDFB', keyText: '#5B2A33', keyBorder: '#E8C9C1', keyPressedBg: '#F5E1DC', keyActionBg: '#9E4F5C', keyActionText: '#FFFFFF',
      pluEmptyBg: 'rgba(255,253,251,0.45)',
    },
    decor: {
      bgImage: 'radial-gradient(circle, rgba(201,162,39,.22) 1.5px, transparent 2px) 0 0 / 30px 30px, radial-gradient(circle, rgba(158,79,92,.10) 3px, transparent 3.5px) 15px 15px / 30px 30px',
      headerBg: 'linear-gradient(90deg, #7A3E48 0%, #9E4F5C 55%, #B07A5A 100%)',
      headerText: '#FFF8F0',
      accentLine: '#C9A227',
      ornament: '🌹',
    },
    buttons: {
      cash:          { bg: '#3F7D58', text: '#FFFFFF' },
      card:          { bg: '#6B4E71', text: '#FFFFFF' },
      split:         { bg: '#9E4F5C', text: '#FFFFFF' },
      other_payment: { bg: '#8A5A44', text: '#FFFFFF' },
      customer:      { bg: '#7A3E48', text: '#FFFFFF' },
      price_check:   { bg: '#8C6A1F', text: '#FFFFFF' },
      menu:          { bg: '#5B2A33', text: '#FFFFFF' },
      documents:     { bg: '#6E5A63', text: '#FFFFFF' },
    },
  },

  gecesekeri: {
    key: 'gecesekeri', label: 'Gece Şekeri', emoji: '🦇', dark: true, experimental: true,
    description: 'Koyu mor zemin, pembe vurgular, yıldız ve kalp desenli. Tatlı ama karanlık.', tag: 'Süslü',
    tokens: {
      bg: '#1E1626', surface: '#2A1F35', surfaceAlt: '#3A2A4A',
      text: '#F5E9FF', textMuted: '#B9A6C9', border: '#4B3860',
      primary: '#F472B6', primaryText: '#1E1626',
      success: '#34D399', warning: '#FBBF24', danger: '#FB7185',
      discountText: '#F9A8D4', discountBg: '#3B1D33', discountBar: '#EC4899',
      disabledBg: '#33283F', disabledFg: '#7A6A8A',
      keyBg: '#3A2A4A', keyText: '#F5E9FF', keyBorder: '#4B3860', keyPressedBg: '#4B3860', keyActionBg: '#BE185D', keyActionText: '#FFFFFF',
      pluEmptyBg: 'rgba(42,31,53,0.45)',
    },
    decor: {
      bgImage: 'radial-gradient(rgba(244,114,182,.45) 1.5px, transparent 2px) 0 0 / 34px 34px, radial-gradient(rgba(216,180,254,.35) 1px, transparent 1.5px) 17px 17px / 34px 34px',
      headerBg: 'linear-gradient(90deg, #1E1626 0%, #4A1D4F 55%, #9D174D 100%)',
      headerText: '#FCE7F3',
      accentLine: '#F472B6',
      ornament: '🦇',
    },
    buttons: {
      cash:          { bg: '#047857', text: '#FFFFFF' },
      card:          { bg: '#6D28D9', text: '#FFFFFF' },
      split:         { bg: '#BE185D', text: '#FFFFFF' },
      other_payment: { bg: '#86198F', text: '#FFFFFF' },
      customer:      { bg: '#4C1D95', text: '#FFFFFF' },
      price_check:   { bg: '#9D174D', text: '#FFFFFF' },
      menu:          { bg: '#3A2A4A', text: '#F5E9FF' },
      documents:     { bg: '#475569', text: '#FFFFFF' },
    },
  },
}

export const DEFAULT_THEME: ThemeKey = 'klasik'
export const THEME_KEYS: ThemeKey[] = ['klasik', 'okyanus', 'galaksi', 'orman', 'gunbatimi', 'kiraz', 'gulkurusu', 'gecesekeri']

const HEX = /^#[0-9A-Fa-f]{6}$/

export function isThemeKey(v: unknown): v is ThemeKey {
  return typeof v === 'string' && (THEME_KEYS as string[]).includes(v)
}

const THEME_ALIASES: Record<string, ThemeKey> = {
  gun_batimi: 'gunbatimi', kiraz_cicegi: 'kiraz', gul_kurusu: 'gulkurusu',
}

export function normalizeThemeKey(v: unknown): ThemeKey {
  if (typeof v !== 'string') return DEFAULT_THEME
  const k = THEME_ALIASES[v] ?? v
  return isThemeKey(k) ? k : DEFAULT_THEME
}

export function autoText(bg: string): string {
  const n = parseInt(bg.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#0F172A' : '#FFFFFF'
}

/** Tema varsayılanı + kasiyerin özel buton rengi (varsa) */
export function resolveButtonColor(
  themeKey: unknown,
  key: ButtonColorKey,
  overrides?: Record<string, { bg?: string; text?: string | null }>,
): { bg: string; text: string } {
  const theme = THEMES[normalizeThemeKey(themeKey)]
  const base = theme.buttons[key]
  const o = overrides?.[key]
  if (!o?.bg || !HEX.test(o.bg)) return base
  return { bg: o.bg, text: o.text && HEX.test(o.text) ? o.text : autoText(o.bg) }
}

/** CSS değişkenleri: --pos-bg, --pos-surface, ... --pos-btn-cash-bg, --pos-btn-cash-text */
export function themeCssVars(
  themeKey: unknown,
  overrides?: Record<string, { bg?: string; text?: string | null }>,
): Record<string, string> {
  const theme = THEMES[normalizeThemeKey(themeKey)]
  const vars: Record<string, string> = {}
  const kebab = (s: string) => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase())
  for (const [k, v] of Object.entries(theme.tokens)) vars[`--pos-${kebab(k)}`] = v
  const d = theme.decor ?? {}
  vars['--pos-bg-image']    = d.bgImage    ?? 'none'
  vars['--pos-screen-bg']   = d.bgImage ? `${d.bgImage}, ${theme.tokens.bg}` : theme.tokens.bg
  vars['--pos-cart-bg']     = d.bgImage ? `${d.bgImage}, ${theme.tokens.surface}` : theme.tokens.surface
  vars['--pos-header-bg']   = d.headerBg   ?? theme.tokens.surface
  vars['--pos-header-text'] = d.headerText ?? theme.tokens.text
  vars['--pos-accent-line'] = d.accentLine ?? theme.tokens.border
  vars['--pos-ornament']    = d.ornament ? `"${d.ornament}"` : '""'
  for (const k of Object.keys(theme.buttons) as ButtonColorKey[]) {
    const c = resolveButtonColor(theme.key, k, overrides)
    const name = k.replace(/_/g, '-')
    vars[`--pos-btn-${name}-bg`] = c.bg
    vars[`--pos-btn-${name}-text`] = c.text
  }
  return vars
}

/** Satış ekranında kullanılan ek değişkenler. Ortak tema dosyasının üstüne yazılmaz. */
function saleChromeVars(themeKey: ThemeKey): Record<string, string> {
  const theme = THEMES[themeKey]
  const t = theme.tokens
  const headerSet = Boolean(theme.decor?.headerBg)
  return {
    '--pos-header-border': theme.decor?.accentLine ?? (theme.dark ? t.border : '#1F2937'),
    '--pos-hover': theme.dark ? '#334155' : '#F0F9FF',
    '--pos-pane': theme.dark ? t.surfaceAlt : '#FAFAFB',
    '--pos-row-alt': theme.dark ? t.surfaceAlt : '#FAFBFC',
    '--pos-row-hover': theme.dark ? '#334155' : '#F2F4F7',
    '--pos-cart-head': theme.dark ? t.surfaceAlt : '#F0F1F4',
    '--pos-soft-danger': theme.dark ? '#3F1518' : '#FEF2F2',
    '--pos-soft-blush': theme.dark ? '#3F1518' : '#FFF5F5',
    '--pos-soft-success': theme.dark ? '#052E16' : '#F0FDF4',
    '--pos-soft-warning': theme.dark ? '#422006' : '#FFF8E1',
    ...(headerSet ? {} : {
      '--pos-header-bg': '#030712',
      '--pos-header-text': '#E5E7EB',
      '--pos-accent-line': '#1F2937',
      '--pos-header-border': '#1F2937',
    }),
  }
}

export function applyPosTheme(
  themeKey: unknown,
  buttonColorsJson: string | undefined,
  el: HTMLElement = document.documentElement,
) {
  let overrides: Record<string, { bg?: string; text?: string | null }> = {}
  if (buttonColorsJson && buttonColorsJson.trim()) {
    try {
      const parsed = JSON.parse(buttonColorsJson) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        overrides = parsed as Record<string, { bg?: string; text?: string | null }>
      }
    } catch {
      overrides = {}
    }
  }
  const key = normalizeThemeKey(themeKey)
  const vars = { ...themeCssVars(key, overrides), ...saleChromeVars(key) }
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value)
  el.setAttribute('data-pos-theme', key)
  el.setAttribute('data-pos-dark', String(THEMES[key].dark))
  el.setAttribute('data-pos-ornament', THEMES[key].decor?.ornament ? '1' : '0')
}

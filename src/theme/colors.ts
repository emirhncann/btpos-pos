export const C = {
  cash:      '#15803D',
  card:      '#1D4ED8',
  meal:      '#C2410C',
  online:    '#7C3AED',
  install:   '#0F766E',
  split:     '#4338CA',

  primary:   '#1D4ED8',
  success:   '#15803D',
  danger:    '#DC2626',
  warning:   '#D97706',
  neutral:   '#334155',

  discountText: '#C2410C',
  discountBg:   '#FFF7ED',
  discountBar:  '#F97316',

  bg:         '#F1F5F9',
  surface:    '#FFFFFF',
  text:       '#0F172A',
  textMuted:  '#475569',
  border:     '#CBD5E1',
  disabledBg: '#E2E8F0',
  disabledFg: '#94A3B8',
} as const

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.replace('#', '').trim()
  const full = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw
  if (full.length !== 6) return null
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n)) return null
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const rgb = hexToRgb(hex)
  if (!rgb) return { h: 0.58, s: 0.7, l: 0.42 }
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h / 6, s, l }
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t0: number) => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let r = l
  let g = l
  let b = l
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue(p, q, h + 1 / 3)
    g = hue(p, q, h)
    b = hue(p, q, h - 1 / 3)
  }
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${ch(r)}${ch(g)}${ch(b)}`
}

/** Pastel rengi aynı tonda canlı yapar: doygunluk artar, açıklık %42'yi geçmez. */
export function vivid(hex: string): string {
  const { h, s, l } = hexToHsl(hex)
  return hslToHex(h, Math.max(s, 0.65), Math.min(l, 0.42))
}

/** Aynı rengin koyusu — seçili / basılı durum. */
export function darken(hex: string, amt = 0.12): string {
  const raw = hex.replace('#', '').trim()
  const full = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n) || full.length !== 6) return hex
  const scale = (channel: number) => Math.max(0, Math.min(255, Math.round(channel * (1 - amt))))
  const r = scale((n >> 16) & 255)
  const g = scale((n >> 8) & 255)
  const b = scale(n & 255)
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

/** Dolu renk, beyaz yazı. Pasif gri; seçili koyu + beyaz iç çerçeve. */
export function solidBtn(
  color: string,
  disabled = false,
  selected = false,
): Record<string, string | number> {
  return {
    background: disabled ? C.disabledBg : selected ? darken(color) : color,
    color: disabled ? C.disabledFg : '#FFFFFF',
    border: 'none',
    borderRadius: 12,
    fontWeight: 700,
    fontSize: 18,
    boxShadow: disabled
      ? 'none'
      : selected
        ? 'inset 0 0 0 3px rgba(255,255,255,.6), 0 2px 0 rgba(0,0,0,.18)'
        : '0 2px 0 rgba(0,0,0,.18)',
    opacity: 1,
    cursor: disabled ? 'default' : 'pointer',
  }
}

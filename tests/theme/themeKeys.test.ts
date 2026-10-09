import { describe, expect, it } from 'vitest'
import { applyPosTheme, themeCssVars, THEMES } from '../../src/theme/themes'

function fakeRoot() {
  const attrs = new Map<string, string>()
  return {
    style: { setProperty() {} },
    setAttribute(name: string, value: string) { attrs.set(name, value) },
    getAttribute(name: string) { return attrs.get(name) ?? null },
  }
}

describe('tema anahtarları', () => {
  it('Gün Batımı, Kiraz Çiçeği ve Gül Kurusu data-pos-theme yazar', () => {
    const el = fakeRoot()
    const root = el as unknown as HTMLElement
    for (const key of ['gunbatimi', 'kiraz', 'gulkurusu'] as const) {
      applyPosTheme(key, '{}', root)
      expect(el.getAttribute('data-pos-theme')).toBe(key)
    }
  })

  it('Kiraz Çiçeği zemin deseni background kısaltmasında radial-gradient olur', () => {
    const vars = themeCssVars('kiraz')
    expect(vars['--pos-screen-bg'].startsWith('radial-gradient(')).toBe(true)
    expect(vars['--pos-cart-bg'].startsWith('radial-gradient(')).toBe(true)
    expect(vars['--pos-screen-bg']).not.toBe('none')
  })

  it('Gece Şekeri koyu desenli temadır', () => {
    const vars = themeCssVars('gecesekeri')
    expect(THEMES.gecesekeri.dark).toBe(true)
    expect(vars['--pos-screen-bg'].startsWith('radial-gradient(')).toBe(true)
    expect(vars['--pos-cart-bg'].startsWith('radial-gradient(')).toBe(true)
    expect(vars['--pos-key-bg']).toBe('#3A2A4A')
    expect(vars['--pos-plu-empty-bg']).toBe('rgba(42,31,53,0.45)')
  })

  it('eski anahtarlar yeni ada düşer', () => {
    const el = fakeRoot()
    const root = el as unknown as HTMLElement
    const pairs = [
      ['gun_batimi', 'gunbatimi'],
      ['kiraz_cicegi', 'kiraz'],
      ['gul_kurusu', 'gulkurusu'],
    ] as const
    for (const [sent, expected] of pairs) {
      applyPosTheme(sent, '{}', root)
      expect(el.getAttribute('data-pos-theme')).toBe(expected)
    }
  })
})

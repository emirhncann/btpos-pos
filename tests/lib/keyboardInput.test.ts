import { describe, expect, it } from 'vitest'
import { isBarcodeBurst, trUpper } from '../../src/lib/keyboardInput'

describe('klavye', () => {
  it('Türkçe büyük harf', () => {
    expect(trUpper('i')).toBe('İ')
    expect(trUpper('ı')).toBe('I')
    expect(trUpper('ş')).toBe('Ş')
    expect(trUpper('ğ')).toBe('Ğ')
  })

  it('35 ms altı Enter ile biten dizi barkoddur', () => {
    expect(isBarcodeBurst([10, 12, 20], 4)).toBe(true)
    expect(isBarcodeBurst([10, 40], 3)).toBe(false)
    expect(isBarcodeBurst([10, 36, 10], 4)).toBe(false)
  })
})

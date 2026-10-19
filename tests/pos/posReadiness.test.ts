import { describe, expect, it } from 'vitest'
import { isPosDefined } from '../../src/services/pos/posReadiness'

describe('isPosDefined', () => {
  it('adres ve seri no birlikte doluysa tanımlı', () => {
    expect(isPosDefined({ ipAddress: '10.0.0.5', serialNo: 'PAV123', isActive: true })).toBe(true)
  })

  it('boş, IP’siz veya serisiz kayıt tanımsız', () => {
    expect(isPosDefined(null)).toBe(false)
    expect(isPosDefined({ ipAddress: '10.0.0.5', serialNo: '' })).toBe(false)
    expect(isPosDefined({ ipAddress: '', serialNo: 'PAV123' })).toBe(false)
    expect(isPosDefined({ ipAddress: '10.0.0.5', serialNo: 'PAV123', isActive: false })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { adminCommandError, isCommandAckResult, trCount } from '../../src/lib/commandResult'

describe('komut sonuç özeti', () => {
  it('sayıyı Türkçe binlik ayırır', () => {
    expect(trCount(1240)).toBe('1.240')
    expect(trCount(6)).toBe('6')
  })

  it('özet yoksa result sayılmaz', () => {
    expect(isCommandAckResult(undefined)).toBe(false)
    expect(isCommandAckResult({ message: '  ' })).toBe(false)
    expect(isCommandAckResult({ count: 3, message: '3 kasiyer' })).toBe(true)
  })

  it('hata metnini yönetici diline çevirir', () => {
    expect(adminCommandError(new Error('Boş müşteri listesi'))).toBe('Merkezden boş liste geldi')
    expect(adminCommandError(new Error('Failed to fetch'))).toBe('ERP bağlantısı yok')
    expect(adminCommandError(new Error('SQLITE_CONSTRAINT: cashiers'))).toBe('Veritabanı yazılamadı: SQLITE_CONSTRAINT: cashiers')
    expect(adminCommandError(new Error('onSyncTemplates handler tanımlı değil'))).toBe('onSyncTemplates handler tanımlı değil')
  })
})

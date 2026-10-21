import { describe, expect, it } from 'vitest'
import { formatIstanbulRange } from '../../src/lib/commandView'
import { commandTitle } from '../../src/lib/commandLabels'

describe('gün sonu aralığı İstanbul saati', () => {
  it('UTC Z aralığını Europe/Istanbul olarak yazar', () => {
    const start = '2026-10-20T21:00:00Z'
    const end = '2026-10-21T12:30:00Z'
    expect(formatIstanbulRange(start, end)).toBe('21.10.2026 00:00 – 21.10.2026 15:30')
    expect(commandTitle('day_end_run', { range_start: start, range_end: end })).toBe(
      'Gün sonu (ERP) gönder · 21.10.2026 00:00 – 21.10.2026 15:30',
    )
  })
})

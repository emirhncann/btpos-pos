import { describe, expect, it } from 'vitest'
import {
  decideUpdateCommand,
  downgradeBannerText,
  formatTrDateTime,
  shouldClearPendingAdminUpdate,
  type UpdateCommandRef,
} from '../../src/lib/updateCommand'

const installedAt = '2026-10-16T10:00:00.000Z'
const before = '2026-10-12T11:05:00.000Z'
const after = '2026-10-16T12:00:00.000Z'

function ref(targetId: string, version: string, createdAt: string): UpdateCommandRef {
  return { targetId, version, createdAt }
}

describe('update_app kararı', () => {
  it('aynı sürümü zaten kurulu diye kapatır', () => {
    const decision = decideUpdateCommand({
      version: '1.0.10',
      current: '1.0.10',
      installedAt,
      createdAt: after,
      targetId: 'a',
      batch: [ref('a', '1.0.10', after)],
    })
    expect(decision).toEqual({ action: 'done', message: 'Bu sürüm zaten kurulu' })
  })

  it('kurulumdan önce verilen eski komutu yok sayar', () => {
    const decision = decideUpdateCommand({
      version: '1.0.3',
      current: '1.0.10',
      installedAt,
      createdAt: before,
      targetId: 'old',
      batch: [ref('old', '1.0.3', before)],
    })
    expect(decision.action).toBe('done')
    if (decision.action === 'done') {
      expect(decision.message).toBe(`Eski komut yok sayıldı (1.0.3, ${formatTrDateTime(before)})`)
    }
  })

  it('kurulumdan sonra verilen düşürmeyi banda bırakır', () => {
    const decision = decideUpdateCommand({
      version: '1.0.3',
      current: '1.0.10',
      installedAt,
      createdAt: after,
      targetId: 'down',
      batch: [ref('down', '1.0.3', after)],
    })
    expect(decision).toEqual({ action: 'prompt' })
  })

  it('aynı sorguda yalnızca en yeni update_app işlenir', () => {
    const batch = [
      ref('older', '1.0.8', '2026-10-16T11:00:00.000Z'),
      ref('newer', '1.0.9', after),
    ]
    const older = decideUpdateCommand({
      version: '1.0.8',
      current: '1.0.10',
      installedAt,
      createdAt: batch[0].createdAt,
      targetId: 'older',
      batch,
    })
    const newer = decideUpdateCommand({
      version: '1.0.9',
      current: '1.0.10',
      installedAt,
      createdAt: after,
      targetId: 'newer',
      batch,
    })
    expect(older.action).toBe('done')
    expect(newer).toEqual({ action: 'prompt' })
  })

  it('elle daha yeni sürüme geçince eski bandı temizler, sonraki düşürmeyi tutar', () => {
    expect(shouldClearPendingAdminUpdate(
      { version: '1.0.3', created_at: before },
      '1.0.10',
      installedAt,
    )).toBe(true)
    expect(shouldClearPendingAdminUpdate(
      { version: '1.0.3' },
      '1.0.10',
      installedAt,
    )).toBe(true)
    expect(shouldClearPendingAdminUpdate(
      { version: '1.0.10' },
      '1.0.10',
      installedAt,
    )).toBe(true)
    expect(shouldClearPendingAdminUpdate(
      { version: '1.0.3', created_at: after },
      '1.0.10',
      installedAt,
    )).toBe(false)
  })

  it('düşürme metninde isteyen ve tarih görünür', () => {
    const text = downgradeBannerText({
      from: '1.0.10',
      to: '1.0.3',
      requestedName: 'Ahmet',
      createdAt: before,
    })
    expect(text).toBe(`Yönetici bu kasanın sürümünü 1.0.10 → 1.0.3'e düşürmek istiyor (Ahmet, ${formatTrDateTime(before)}).`)
  })
})

import { describe, expect, it } from 'vitest'
import { canCancelRecovery, classifyProbe, displayPaymentsOf, paymentTotals, recoveryDelayMs, shownRecoveryState, type RecoveryInfo } from '../../src/lib/pavoRecovery'
import { saleCompletedMs } from '../../src/store/saleCompleted'

describe('satış tamamlandı süresi', () => {
  it('para üstü yoksa 3 sn, varsa 6 sn', () => {
    expect(saleCompletedMs(0)).toBe(3000)
    expect(saleCompletedMs(0.5)).toBe(6000)
  })
})

describe('pavo kurtarma sınıflaması', () => {
  it('ilk dakika 5 sn, sonrası 15 sn bekler', () => {
    expect(recoveryDelayMs(1)).toBe(5000)
    expect(recoveryDelayMs(12)).toBe(5000)
    expect(recoveryDelayMs(13)).toBe(15000)
  })

  it('ödeme alınmış satışı tamamlanmış sayar', () => {
    expect(classifyProbe({
      success: true,
      status: 'completed',
      statusId: 4,
      data: { TotalPrice: 100, AddedPayments: [{ StatusId: 2, PaymentAmount: 100 }] },
    })).toBe('completed')
  })

  it('kart bekleyen satışı cihaz bekliyor sayar', () => {
    expect(classifyProbe({
      success: true,
      status: 'pending',
      statusId: 2,
      data: { TotalPrice: 100, AddedPayments: [{ StatusId: 1, PaymentAmount: 100 }] },
    })).toBe('waiting_device')
  })

  it('ödemesiz satışı iptale açık sayar', () => {
    expect(classifyProbe({
      success: true,
      status: 'uncompleted',
      statusId: 23,
      data: { TotalPrice: 80, AddedPayments: [] },
    })).toBe('no_payment')
  })

  it('cihaz cevap vermezse ulaşılamaz sayar', () => {
    expect(classifyProbe({ success: false, message: 'Failed to fetch' })).toBe('unreachable')
  })

  it('alınmış ödeme varken kalan tutarı parçalı sayar', () => {
    expect(classifyProbe({
      success: true,
      status: 'pending',
      statusId: 2,
      data: {
        TotalPrice: 250,
        AddedPayments: [
          { StatusId: 2, PaymentAmount: 150 },
          { StatusId: 1, PaymentAmount: 100 },
        ],
      },
    })).toBe('partial')
  })

  it('bekleyen kart kalan tutara katılmaz', () => {
    const data = {
      StatusId: 23,
      TotalPrice: 260,
      AddedPayments: [
        { StatusId: 2, PaymentAmount: 172, PaymentMediatorId: 1 },
        { StatusId: 2, PaymentAmount: 44, PaymentMediatorId: 2 },
        { StatusId: 1, PaymentAmount: 44, PaymentMediatorId: 2 },
      ],
    }
    expect(paymentTotals(data)).toMatchObject({ paidTotal: 216, saleTotal: 260, remaining: 44, hasWaiting: true })
    expect(classifyProbe({ success: true, status: 'uncompleted', statusId: 23, data })).toBe('partial')
    const shown = displayPaymentsOf({
      ...data,
      AddedPayments: [
        data.AddedPayments[0],
        { ...data.AddedPayments[1], OnlinePayment: { CardNo: '5262********7510' } },
        data.AddedPayments[2],
      ],
    })
    expect(shown.map(row => row.status)).toEqual(['done', 'done', 'waiting'])
    expect(shown[1]?.cardNo).toBe('5262********7510')
    expect(shown.filter(row => row.status === 'done').reduce((s, row) => s + row.amount, 0)).toBe(216)
  })

  it('45 sn aynı bekleyişten sonra iptal açılır, parçalıda açılmaz', () => {
    const base: RecoveryInfo = {
      attempt: 1,
      lastCheck: new Date(),
      state: 'waiting_device',
      nextDelayMs: 5000,
      paidTotal: 0,
      saleTotal: 100,
      waitingSince: Date.now() - 46_000,
      unreachableSince: null,
    }
    expect(shownRecoveryState(base)).toBe('stale_waiting')
    expect(canCancelRecovery(base)).toBe(true)
    expect(canCancelRecovery({ ...base, state: 'partial', waitingSince: null, paidTotal: 150 })).toBe(false)
    expect(canCancelRecovery({
      ...base,
      state: 'unreachable',
      waitingSince: null,
      unreachableSince: Date.now() - 121_000,
    })).toBe(true)
  })
})

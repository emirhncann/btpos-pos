import { describe, expect, it } from 'vitest'
import { planCustomerSyncRepair } from '../../src/lib/customerSyncRepair'
import { customerFromApi } from '../../src/lib/customerApi'

describe('müşteri erp eşleme', () => {
  it('vergi no eşleşince erp düzelir, eşleşmeyen boş erp silinir', () => {
    const plan = planCustomerSyncRepair(
      [
        { id: 'uuid-eski', taxNo: '1234567890', erpId: '' },
        { id: '55', taxNo: '10000000146', erpId: '' },
        { id: 'yerel-bos', taxNo: '', erpId: '' },
        { id: '77', taxNo: '1111111111', erpId: '77' },
      ],
      [
        { id: '55', taxNo: '10000000146', erpId: '55' },
        { id: '90', taxNo: '1234567890', erpId: '90' },
      ],
    )
    expect(plan.deleteIds).toEqual(['uuid-eski', 'yerel-bos'])
    expect(plan.erpUpdates).toEqual([{ id: '55', erpId: '55' }])
  })

  it('oluşturma cevabında erp_id yoksa satır kurulmaz', () => {
    expect(customerFromApi({ id: 'yerel-1', name: 'Ahmet' }, 'c1')).toBeNull()
    expect(customerFromApi({ id: '1', name: 'Ahmet' }, 'c1')).toBeNull()
    const row = customerFromApi({ erp_id: '90', name: 'Bolu Gıda', tax_number: '1234567890' }, 'c1')
    expect(row?.erpId).toBe('90')
    expect(row?.id).toBe('90')
  })
})

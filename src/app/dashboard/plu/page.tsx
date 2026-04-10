/**
 * Admin Dashboard — PLU yönetimi (şablon)
 * Next.js admin projenizde bu dosyayı kullanacaksanız: `apiFetch`, `companyId` ve grup yükleme
 * mantığını kendi uygulamanıza göre bağlayın. Aşağıdaki parçalar istenen spec ile uyumludur:
 * - PluItem (+ product_name, product_barcode)
 * - addItem(productCode, product?) → POST /plu/items
 * - Arama modalında addItem(p.code, p)
 * - Liste satırında ad + kod + barkod
 */

import { useCallback, useEffect, useState } from 'react'

/** ERP arama sonucu — alan adları admin API’nize göre uyarlayın */
export interface ErpProduct {
  code: string
  name?: string
  barcode?: string
}

export interface PluItem {
  id: string
  product_code: string
  sort_order: number
  product_name?: string
  product_barcode?: string
}

export interface PluGroup {
  id: string
  name?: string
  plu_items?: PluItem[]
}

type SelectedNode =
  | { type: 'terminal'; id: string }
  | { type: 'cashier'; id: string }
  | { type: 'company'; id: string }
  | { type: 'workplace'; id: string }

/** Admin uygulamanızdaki merkezi fetch — burada göreli URL örneği */
async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    },
  })
  return res.json()
}

export default function PluDashboardPage() {
  const [companyId] = useState<string>(() => {
    // Next.js: searchParams / session; burada placeholder
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('company_id')
      if (q) return q
    }
    return ''
  })

  const [groups, setGroups] = useState<PluGroup[]>([])
  const [activeGroup, setActiveGroup] = useState<PluGroup | null>(null)
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null)

  const [newCode, setNewCode] = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const [itemError, setItemError] = useState('')

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchHits, setSearchHits] = useState<ErpProduct[]>([])

  const reloadGroups = useCallback(async () => {
    if (!companyId) return
    // TODO: kendi endpoint’iniz — örnek:
    // const data = await apiFetch(`/plu/groups?company_id=${companyId}`)
    // setGroups(data.groups ?? [])
    void companyId
  }, [companyId])

  useEffect(() => {
    void reloadGroups()
  }, [reloadGroups])

  useEffect(() => {
    if (!activeGroup && groups.length > 0) setActiveGroup(groups[0] ?? null)
  }, [groups, activeGroup])

  const addItem = async (productCode: string, product?: ErpProduct) => {
    if (!activeGroup || !productCode.trim()) return
    setAddingItem(true)
    setItemError('')
    try {
      const body: Record<string, unknown> = {
        group_id: activeGroup.id,
        company_id: companyId,
        product_code: productCode.trim(),
      }
      if (product?.name) body.product_name = product.name
      if (product?.barcode) body.product_barcode = product.barcode
      if (selectedNode?.type === 'terminal') body.terminal_id = selectedNode.id
      if (selectedNode?.type === 'cashier') body.cashier_id = selectedNode.id

      const data = await apiFetch('/plu/items', { method: 'POST', body: JSON.stringify(body) })
      if ((data as { success?: boolean; message?: string }).success === false) {
        setItemError((data as { message?: string }).message ?? 'Hata.')
        return
      }
      setNewCode('')
      await reloadGroups()
    } finally {
      setAddingItem(false)
    }
  }

  const items = activeGroup?.plu_items ?? []

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>PLU</h1>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
        Şablon: <code>company_id</code> için URL&apos;ye <code>?company_id=...</code> ekleyin veya state&apos;i
        kendi auth akışınıza bağlayın.
      </p>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setSearchOpen(true)}>
          ERP ile ürün ara
        </button>
        <input
          placeholder="Manuel ürün kodu"
          value={newCode}
          onChange={e => setNewCode(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: '6px 8px' }}
        />
        <button type="button" disabled={addingItem} onClick={() => void addItem(newCode)}>
          Kod ile ekle
        </button>
      </div>
      {itemError ? <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 8 }}>{itemError}</div> : null}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map(item => (
          <li
            key={item.id}
            style={{
              borderBottom: '1px solid #e5e7eb',
              padding: '10px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {item.product_name ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{item.product_name}</span>
              ) : null}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    background: '#F3F4F6',
                    color: '#374151',
                    padding: '1px 6px',
                    borderRadius: 3,
                  }}
                >
                  {item.product_code}
                </span>
                {item.product_barcode ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: 'monospace',
                      background: '#EFF6FF',
                      color: '#1D4ED8',
                      padding: '1px 6px',
                      borderRadius: 3,
                    }}
                  >
                    {item.product_barcode}
                  </span>
                ) : null}
              </div>
            </div>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>#{item.sort_order}</span>
          </li>
        ))}
      </ul>

      {searchOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div style={{ background: 'white', borderRadius: 8, padding: 16, maxWidth: 480, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong>ERP arama</strong>
              <button type="button" onClick={() => setSearchOpen(false)}>
                Kapat
              </button>
            </div>
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              Demo: aşağıdaki listeyi kendi ERP arama API’nizle doldurun (<code>setSearchHits</code>).
            </p>
            <ul style={{ listStyle: 'none', padding: 0, maxHeight: 280, overflow: 'auto' }}>
              {searchHits.map(p => (
                <li
                  key={p.code}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid #f3f4f6',
                  }}
                >
                  <span style={{ fontSize: 13 }}>
                    {p.name ?? p.code} <span style={{ color: '#9ca3af' }}>({p.code})</span>
                  </span>
                  <button type="button" onClick={() => void addItem(p.code, p)} disabled={addingItem}>
                    + Ekle
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}

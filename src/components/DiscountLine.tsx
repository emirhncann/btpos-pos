import { C } from '../theme/colors'

export function DiscountLine({
  label,
  amount,
  fontSize = 12,
}: {
  label: string
  amount: string
  fontSize?: number
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      padding: '4px 8px',
      borderLeft: `4px solid ${C.discountBar}`,
      background: C.discountBg,
      color: C.discountText,
      fontWeight: 600,
      fontSize,
      borderRadius: 4,
    }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ flexShrink: 0 }}>{amount}</span>
    </div>
  )
}

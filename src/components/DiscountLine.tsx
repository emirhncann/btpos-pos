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
      borderLeft: '4px solid var(--pos-discount-bar)',
      background: 'var(--pos-discount-bg)',
      color: 'var(--pos-discount-text)',
      fontWeight: 600,
      fontSize,
      borderRadius: 4,
    }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ flexShrink: 0 }}>{amount}</span>
    </div>
  )
}

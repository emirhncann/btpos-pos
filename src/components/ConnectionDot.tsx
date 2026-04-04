interface Props {
  status: 'online' | 'offline' | 'checking'
}

const CONFIG = {
  online:   { color: '#4CAF50', label: 'Bağlı' },
  offline:  { color: '#FF9800', label: 'Bağlantı yok' },
  checking: { color: '#9E9E9E', label: 'Kontrol ediliyor' },
}

export default function ConnectionDot({ status }: Props) {
  const cfg = CONFIG[status]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={cfg.label}>
      <div style={{
        width: 10, height: 10, borderRadius: '50%',
        background: cfg.color,
        boxShadow: status === 'online' ? `0 0 0 3px ${cfg.color}30` : 'none',
        transition: 'background 0.4s',
      }} />
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)' }}>{cfg.label}</span>
    </div>
  )
}

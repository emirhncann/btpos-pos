interface Props {
  text: string
  onClose: () => void
}

export default function MessagePopup({ text, onClose }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--pos-surface)', borderRadius: 16, color: 'var(--pos-text)',
        padding: '36px 40px', maxWidth: 480, width: '90%',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--pos-text)', marginBottom: 8 }}>
          Yönetici Mesajı
        </div>
        <div style={{ fontSize: 14, color: 'var(--pos-text-muted)', lineHeight: 1.7, marginBottom: 28 }}>
          {text}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'var(--pos-primary)', color: 'var(--pos-primary-text)', border: 'none',
            borderRadius: 10, padding: '12px 40px', fontSize: 14,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          Tamam, Anlaşıldı
        </button>
      </div>
    </div>
  )
}

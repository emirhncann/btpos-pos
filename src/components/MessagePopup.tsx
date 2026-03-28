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
        background: 'white', borderRadius: 16,
        padding: '36px 40px', maxWidth: 480, width: '90%',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#212121', marginBottom: 8 }}>
          Yönetici Mesajı
        </div>
        <div style={{ fontSize: 14, color: '#424242', lineHeight: 1.7, marginBottom: 28 }}>
          {text}
        </div>
        <button
          onClick={onClose}
          style={{
            background: '#1565C0', color: 'white', border: 'none',
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

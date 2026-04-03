import logoGif from '../assets/logo.gif'

export default function SplashScreen() {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-950"
    >
      <img
        src={logoGif}
        alt="BTPOS"
        style={{
          maxWidth: '60%',
          maxHeight: '60%',
          objectFit: 'contain',
        }}
      />
    </div>
  )
}

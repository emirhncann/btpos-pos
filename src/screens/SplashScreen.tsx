import { useEffect } from 'react'
import logoGif from '../assets/logo.gif'
import introWav from '../assets/intro.wav'

export default function SplashScreen() {
  useEffect(() => {
    const audio = new Audio(introWav)
    void audio.play().catch(() => {})
  }, [])

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

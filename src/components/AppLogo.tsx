import logoPng from '../assets/logo.png'

type Props = {
  height?: number
  className?: string
  alt?: string
}

export default function AppLogo({ height = 40, className, alt = 'BTPOS' }: Props) {
  return (
    <img
      src={logoPng}
      alt={alt}
      className={className}
      style={{
        height,
        width: 'auto',
        maxWidth: '100%',
        objectFit: 'contain',
        display: 'block',
      }}
    />
  )
}

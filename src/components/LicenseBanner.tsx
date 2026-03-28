interface Props {
  daysLeft: number
  planName: string
}

export default function LicenseBanner({ daysLeft, planName }: Props) {
  if (daysLeft > 30) return null

  return (
    <div className={`px-4 py-2 text-xs font-medium flex items-center justify-between ${
      daysLeft <= 7
        ? 'bg-red-500/20 text-red-400 border-b border-red-500/30'
        : 'bg-yellow-500/20 text-yellow-400 border-b border-yellow-500/30'
    }`}>
      <span>
        {daysLeft <= 0
          ? '⛔ Lisansınız sona erdi. Lütfen yöneticinizle iletişime geçin.'
          : `⚠️ Lisansınız ${daysLeft} gün içinde sona erecek. (Plan: ${planName})`
        }
      </span>
    </div>
  )
}

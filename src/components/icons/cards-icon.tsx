"use client"

/**
 * Игральная карта с «пипом» и второй картой позади — иконка Glitch Cards.
 * Нарисована в идиоме lucide (24×24, currentColor, stroke, круглые концы),
 * потому что в наборе нет ничего, что читалось бы как карты.
 */
export function CardsIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* карта позади */}
      <path d="M8.5 6.5H6.2A1.7 1.7 0 0 0 4.5 8.2v11.1A1.7 1.7 0 0 0 6.2 21h7.6a1.7 1.7 0 0 0 1.7-1.7v-1.6" />
      {/* передняя карта */}
      <rect x="8.5" y="3" width="11" height="15" rx="2" />
      {/* пип */}
      <path d="M14 7.8l2.1 2.7-2.1 2.7-2.1-2.7z" />
    </svg>
  )
}

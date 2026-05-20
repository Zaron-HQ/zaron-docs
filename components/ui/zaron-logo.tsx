'use client'

import { cn } from '@/lib/utils'

interface ZaronLogoProps {
  className?: string
}

/**
 * Zaron icon mark only.
 * Uses the brand blue (#0070F3).
 */
export function ZaronLogo({ className }: ZaronLogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-7 w-7', className)}
      aria-label="Zaron"
    >
      <rect width="32" height="32" rx="7" fill="#0070F3" />
      <path
        d="M8 11.5h10.5L8 22h16v-2.5H13.5L24 9H8v2.5z"
        fill="white"
      />
    </svg>
  )
}

/**
 * Full Zaron logo with icon and "Zaron" text.
 * Icon uses brand blue (#0070F3), text adapts to light/dark mode.
 */
export function ZaronLogoFull({ className }: ZaronLogoProps) {
  return (
    <div className={cn('flex items-center gap-2', className)} aria-label="Zaron">
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-7 w-7 shrink-0"
      >
        <rect width="32" height="32" rx="7" fill="#0070F3" />
        <path
          d="M8 11.5h10.5L8 22h16v-2.5H13.5L24 9H8v2.5z"
          fill="white"
        />
      </svg>
      <span className="text-[18px] font-semibold tracking-[-0.02em] text-neutral-900 dark:text-white">
        Zaron
      </span>
    </div>
  )
}

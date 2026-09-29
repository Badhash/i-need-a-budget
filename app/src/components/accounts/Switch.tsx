import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Piste + pastille d'un interrupteur (purement visuel, pilote par `checked`). */
export function SwitchTrack({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 ring-1 ring-inset transition-colors duration-200 ease-spring',
        checked ? 'bg-accent ring-accent/40' : 'bg-ink/[0.12] ring-ink/[0.06]',
        className,
      )}
    >
      <span
        className={cn(
          'h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-spring',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </span>
  )
}

/**
 * Ligne interrupteur : TOUTE la ligne bascule (cible tactile >= 56px), titre,
 * explication optionnelle, piste a droite. role="switch" pour les lecteurs
 * d'ecran.
 */
export function SwitchRow({
  checked,
  onCheckedChange,
  title,
  description,
  icon,
  disabled,
  className,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors duration-150 hover:bg-ink/[0.03] disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-snug text-ink">{title}</span>
        {description && <span className="mt-0.5 block text-[13px] leading-snug text-soft">{description}</span>}
      </span>
      <SwitchTrack checked={checked} />
    </button>
  )
}

import { cn } from '@/lib/utils'

/**
 * Interrupteur (role switch) : piste arrondie, pastille qui glisse. Zone de
 * toucher etendue a 44px (le controle visible en fait 24). Etat porte par
 * aria-checked ET la position de la pastille, jamais la couleur seule.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Nom accessible (le libelle visible voisin ne suffit pas aux lecteurs d'ecran). */
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onCheckedChange(!checked)
      }}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ease-spring after:absolute after:-inset-2.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40",
        checked ? 'bg-accent shadow-button' : 'bg-ink/15',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-spring',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  )
}

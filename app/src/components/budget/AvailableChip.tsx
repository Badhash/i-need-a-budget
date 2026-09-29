import { useEffect, useRef, useState } from 'react'
import { fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'

export type AvailableTone = 'positive' | 'zero' | 'negative' | 'underfunded'

/**
 * Ton semantique d'un Disponible : dans le rouge (depassement), sous-finance
 * (objectif pas encore atteint ce mois), positif ou nul.
 */
export function availableTone(cents: number, underfunded = false): AvailableTone {
  if (cents < 0) return 'negative'
  if (underfunded) return 'underfunded'
  return cents > 0 ? 'positive' : 'zero'
}

const TONES: Record<AvailableTone, string> = {
  positive: 'bg-success/10 text-success ring-success/15',
  zero: 'bg-ink/[0.05] text-soft ring-transparent',
  negative: 'bg-danger/10 text-danger ring-danger/20',
  underfunded: 'bg-warning/10 text-warning ring-warning/20',
}

/**
 * Pastille du Disponible d'une enveloppe (liste mobile, section des enveloppes
 * masquees) : montant tabulaire, couleur semantique rare (vert = de l'argent,
 * ambre = objectif sous-finance, rouge = depassement, gris = rien).
 */
export function AvailableChip({
  cents,
  underfunded = false,
  size = 'md',
  pulse = false,
  className,
}: {
  cents: number
  underfunded?: boolean
  size?: 'sm' | 'md'
  /** Petit rebond quand le montant change (retour visuel d'une assignation). */
  pulse?: boolean
  className?: string
}) {
  // Compteur de changements : la cle du contenu rejoue l'animation, jamais au
  // premier rendu (seulement quand la valeur bouge ensuite).
  const previous = useRef(cents)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    if (!pulse || previous.current === cents) return
    previous.current = cents
    setBump((b) => b + 1)
  }, [cents, pulse])

  return (
    <span
      key={bump}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full font-semibold tnum ring-1 ring-inset transition-colors',
        size === 'md' ? 'px-2.5 py-1 text-[13.5px]' : 'px-2 py-0.5 text-[12.5px]',
        TONES[availableTone(cents, underfunded)],
        bump > 0 && 'animate-pop',
        className,
      )}
    >
      {fmtEUR(cents)}
    </span>
  )
}

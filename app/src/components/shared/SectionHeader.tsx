import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionHeaderProps {
  title: ReactNode
  /** Sur-titre en petites capitales (optionnel). */
  eyebrow?: ReactNode
  /** Une ligne d'explication sous le titre (optionnel). */
  description?: ReactNode
  /** Action a droite (bouton, lien, filtre). */
  action?: ReactNode
  as?: 'h2' | 'h3'
  className?: string
}

/** Titre de section (17-19px, 600) avec action optionnelle alignee a droite. */
export function SectionHeader({ title, eyebrow, description, action, as: Heading = 'h2', className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-3 px-1', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="label-caps mb-1">{eyebrow}</p>}
        <Heading className="truncate text-[17px] font-semibold leading-tight tracking-tight text-ink lg:text-[19px]">
          {title}
        </Heading>
        {description && <p className="mt-1 text-[13px] leading-snug text-soft">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

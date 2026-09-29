// Carte d'un reglage : medaillon d'icone, titre, description, action a droite
// optionnelle, puis contenu. Brique commune des sections de la page Reglages.

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type SettingsTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral'

// Classes statiques par ton (JIT Tailwind).
export const TONE_MEDALLION: Record<SettingsTone, string> = {
  accent: 'bg-accent/10 text-accent-ink ring-accent/15 dark:text-accent',
  success: 'bg-success/10 text-success ring-success/15',
  warning: 'bg-warning/10 text-warning ring-warning/20',
  danger: 'bg-danger/10 text-danger ring-danger/15',
  neutral: 'bg-surface2 text-soft ring-edge',
}

export function Medallion({
  icon: Icon,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  icon: LucideIcon
  tone?: SettingsTone
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl shadow-highlight ring-1 ring-inset',
        size === 'sm' && 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4',
        size === 'md' && 'h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]',
        size === 'lg' && 'h-12 w-12 rounded-2xl [&_svg]:h-5 [&_svg]:w-5',
        TONE_MEDALLION[tone],
        className,
      )}
    >
      <Icon strokeWidth={2} />
    </span>
  )
}

export function SettingsCard({
  icon,
  tone = 'neutral',
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  icon: LucideIcon
  tone?: SettingsTone
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex items-start gap-3.5 p-5 pb-0">
        <Medallion icon={icon} tone={tone} />
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="text-[15.5px] font-semibold leading-snug tracking-tight text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-soft">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children !== undefined && <div className={cn('p-5', contentClassName)}>{children}</div>}
    </Card>
  )
}

import {
  Banknote,
  Car,
  CircleHelp,
  Home,
  Repeat,
  Sparkles,
  Sprout,
  type LucideIcon,
} from 'lucide-react'
import type { CategoryGroup, GroupIcon } from '@/types/domain'
import { cn } from '@/lib/utils'

// La cle 'piggy' est HISTORIQUE : elle vit dans les payloads chiffres des
// groupes existants, on ne la migre pas. Seule l'icone rendue change (pousse).
const ICONS: Record<GroupIcon, LucideIcon> = {
  home: Home,
  car: Car,
  sparkles: Sparkles,
  repeat: Repeat,
  piggy: Sprout,
  banknote: Banknote,
}

interface GroupPillProps {
  group?: CategoryGroup
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = {
  sm: 'h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5',
  md: 'h-9 w-9 [&_svg]:h-4 [&_svg]:w-4',
  lg: 'h-11 w-11 [&_svg]:h-5 [&_svg]:w-5',
}

/** Pastille ronde pastel avec l'icone du groupe de categories. */
export function GroupPill({ group, size = 'md', className }: GroupPillProps) {
  const Icon = group ? ICONS[group.icon] : CircleHelp
  const style = group
    ? {
        backgroundColor: `var(--cat-${group.color}-bg)`,
        color: `var(--cat-${group.color}-fg)`,
      }
    : undefined
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        !group && 'bg-warning/10 text-warning',
        SIZES[size],
        className,
      )}
      style={style}
    >
      <Icon />
    </span>
  )
}

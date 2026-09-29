import type { CategoryGroup } from '@/types/domain'
import { cn } from '@/lib/utils'

/**
 * Pastille d'un marchand : son initiale sur la teinte pastel de son groupe de
 * categories dominant (meme couleurs que GroupPill), neutre sans categorie.
 */
export function MerchantAvatar({
  initial,
  group,
  className,
}: {
  initial: string
  group: CategoryGroup | null
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold shadow-highlight ring-1 ring-inset ring-ink/[0.05]',
        !group && 'bg-surface2 text-soft',
        className,
      )}
      style={group ? { backgroundColor: `var(--cat-${group.color}-bg)`, color: `var(--cat-${group.color}-fg)` } : undefined}
    >
      {initial}
    </span>
  )
}

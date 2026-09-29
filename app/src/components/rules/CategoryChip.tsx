import { useCategoriesMap, useGroupsMap } from '@/lib/data'
import { GroupPill } from '@/components/shared/GroupPill'
import { cn } from '@/lib/utils'

interface CategoryChipProps {
  categoryId: string | null | undefined
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Categorie en pastille : icone du groupe + nom, aux couleurs pastel du groupe
 * (--cat-*), lisible en clair comme en sombre. Categorie introuvable (supprimee
 * entre-temps) : pastille d'attention neutre.
 */
export function CategoryChip({ categoryId, size = 'md', className }: CategoryChipProps) {
  const categories = useCategoriesMap()
  const groups = useGroupsMap()
  const category = categoryId ? categories.get(categoryId) : undefined
  const group = category ? groups.get(category.groupId) : undefined
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full font-medium',
        size === 'sm' ? 'py-px pl-px pr-2 text-[12px]' : 'py-0.5 pl-0.5 pr-2.5 text-[13px]',
        !group && 'bg-warning/10 text-warning',
        className,
      )}
      style={group ? { backgroundColor: `var(--cat-${group.color}-bg)`, color: `var(--cat-${group.color}-fg)` } : undefined}
    >
      <GroupPill group={group} size="sm" className={cn('bg-surface/60', size === 'sm' && 'h-5 w-5 [&_svg]:h-3 [&_svg]:w-3')} />
      <span className="truncate">{category ? category.name : 'Catégorie supprimée'}</span>
    </span>
  )
}

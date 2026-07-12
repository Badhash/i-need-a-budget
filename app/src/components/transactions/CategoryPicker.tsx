import type { ReactNode } from 'react'
import { useCategoriesList, useGroupsList } from '@/lib/data'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface CategoryPickerProps {
  children: ReactNode
  onSelect: (categoryId: string | null) => void
  includeIncome?: boolean
}

/** Menu de categorisation rapide (2 taps) groupe par groupe de categories. */
export function CategoryPicker({ children, onSelect, includeIncome = false }: CategoryPickerProps) {
  const allCategories = useCategoriesList()
  const allGroups = useGroupsList()
  const catVisible = (groupId: string) =>
    allCategories.filter((c) => c.groupId === groupId && (includeIncome || !c.isIncome))
  const groups = allGroups
    .filter((g) => catVisible(g.id).length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        {groups.map((group, i) => (
          <div key={group.id}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
            {catVisible(group.id)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((cat) => (
                <DropdownMenuItem key={cat.id} onSelect={() => onSelect(cat.id)}>
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: `var(--cat-${group.color}-fg)` }}
                  />
                  {cat.name}
                </DropdownMenuItem>
              ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onSelect(null)} className="text-soft">
          Sans catégorie
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

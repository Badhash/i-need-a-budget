import type { BudgetGroupBlock } from '@/lib/budget'
import type { Category } from '@/types/domain'
import type { Target } from '@/lib/targets'

export interface GridProps {
  groups: BudgetGroupBlock[]
  month: string
  targets: Map<string, Target>
  onOpenTarget: (category: Category) => void
  // Clic sur une activite non nulle : ouvre la liste des transactions filtree
  // sur cette categorie et le mois affiche.
  onViewActivity: (categoryId: string) => void
  // Masque les lignes d'enveloppes entierement vides (les trois colonnes a 0).
  hideEmptyRows: boolean
}

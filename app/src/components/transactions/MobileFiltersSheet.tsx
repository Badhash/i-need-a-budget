import { Button } from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { MonthPicker } from '@/components/ui/month-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface MobileFiltersSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categoryOptions: ComboboxOption[]
  accountOptions: ComboboxOption[]
  categoryFilter: string
  onCategoryChange: (v: string) => void
  accountFilter: string
  onAccountChange: (v: string) => void
  monthFilter: string
  onMonthChange: (v: string) => void
  monthMin?: string
  monthMax?: string
  hasFilters: boolean
  onClear: () => void
  /** Nombre de transactions correspondant aux filtres (bouton de validation). */
  resultCount: number
}

/**
 * Feuille basse des filtres (mobile uniquement) : reprend les memes controles
 * categorie / compte / mois que la barre desktop, sur le meme etat partage.
 */
export function MobileFiltersSheet({
  open,
  onOpenChange,
  categoryOptions,
  accountOptions,
  categoryFilter,
  onCategoryChange,
  accountFilter,
  onAccountChange,
  monthFilter,
  onMonthChange,
  monthMin,
  monthMax,
  hasFilters,
  onClear,
  resultCount,
}: MobileFiltersSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="lg:hidden">
        <DialogHeader>
          <DialogTitle>Filtres</DialogTitle>
          <DialogDescription>Affine la liste par catégorie, compte ou mois.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-5 pt-2">
          <label className="flex flex-col gap-1.5">
            <span className="label-caps">Catégorie</span>
            <Combobox
              options={categoryOptions}
              value={categoryFilter}
              onChange={onCategoryChange}
              placeholder="Toutes les catégories"
              searchPlaceholder="Rechercher une catégorie…"
              className="w-full"
              aria-label="Filtrer par catégorie"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-caps">Compte</span>
            <Combobox
              options={accountOptions}
              value={accountFilter}
              onChange={onAccountChange}
              placeholder="Tous les comptes"
              searchPlaceholder="Rechercher un compte…"
              className="w-full"
              aria-label="Filtrer par compte"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-caps">Mois</span>
            <MonthPicker
              value={monthFilter}
              onChange={onMonthChange}
              min={monthMin}
              max={monthMax}
              allowAll
              direction="up"
              className="w-full"
              aria-label="Filtrer par mois"
            />
          </label>
        </div>
        <DialogFooter className="mt-3 flex-row gap-2 sm:justify-stretch">
          {hasFilters && (
            <Button variant="secondary" className="h-12 flex-1" onClick={onClear}>
              Effacer
            </Button>
          )}
          <Button className="h-12 flex-1" onClick={() => onOpenChange(false)}>
            {resultCount === 0
              ? 'Aucun résultat'
              : `Voir ${resultCount} transaction${resultCount > 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useRef } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { ChevronRight, EyeOff, FolderInput, MoreHorizontal, Pencil, Target as TargetIcon, Trash2 } from 'lucide-react'
import type { CategoryGroup } from '@/types/domain'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { GroupPill } from '@/components/shared/GroupPill'
import { cn } from '@/lib/utils'

/** Actions d'une enveloppe (menu de ligne de la grille desktop). */
export interface CategoryMenuModel {
  kind: 'category'
  name: string
  hasTarget: boolean
  /** Groupes de destination possibles (hors groupe actuel, masques et revenus). */
  moveGroups: CategoryGroup[]
  onRename: () => void
  onMoveToGroup: (group: CategoryGroup) => void
  onOpenTarget: () => void
  onHide: () => void
  onDelete: () => void
}

/** Actions d'un en-tete de groupe. */
export interface GroupMenuModel {
  kind: 'group'
  name: string
  onRename: () => void
  onHide: () => void
}

export type GridMenuModel = CategoryMenuModel | GroupMenuModel

// Meme habillage que DropdownMenuContent (verre, grand rayon, ombre elevee)
// pour le sous-menu des groupes.
const SUB_CONTENT =
  'glass z-50 min-w-[220px] max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto rounded-2xl border border-edge p-1.5 shadow-elevated outline-none data-[state=closed]:animate-scale-out data-[state=open]:animate-scale-in'

/**
 * Differe une action apres la fermeture du menu : un champ (renommage) ou un
 * dialog qui prend le focus ne doit pas etre repris par le piege a focus du
 * menu pendant son animation de sortie.
 */
function afterClose(action: () => void) {
  window.setTimeout(action, 0)
}

/**
 * Entrees du menu. `onHandoff` signale qu'une action gere elle-meme le focus
 * (renommage inline, dialog) : le menu ne le rend alors pas a son declencheur.
 */
function GridMenuItems({ model, onHandoff }: { model: GridMenuModel; onHandoff: () => void }) {
  const run = (action: () => void, handsOffFocus: boolean) => () => {
    if (handsOffFocus) onHandoff()
    afterClose(action)
  }

  if (model.kind === 'group') {
    return (
      <>
        <DropdownMenuLabel className="max-w-[240px] truncate">{model.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={run(model.onRename, true)}>
          <Pencil className="h-4 w-4 text-soft" />
          Renommer le groupe
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run(model.onHide, false)}>
          <EyeOff className="h-4 w-4 text-soft" />
          Masquer le groupe
        </DropdownMenuItem>
      </>
    )
  }

  return (
    <>
      <DropdownMenuLabel className="max-w-[240px] truncate">{model.name}</DropdownMenuLabel>
      <DropdownMenuItem onSelect={run(model.onRename, true)}>
        <Pencil className="h-4 w-4 text-soft" />
        Renommer
      </DropdownMenuItem>
      <DropdownMenuPrimitive.Sub>
        <DropdownMenuPrimitive.SubTrigger
          disabled={model.moveGroups.length === 0}
          className="flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-[14px] text-ink outline-none transition-colors focus-visible:ring-0 focus-visible:ring-offset-0 data-[disabled]:pointer-events-none data-[highlighted]:bg-ink/[0.06] data-[state=open]:bg-ink/[0.06] data-[disabled]:opacity-45"
        >
          <FolderInput className="h-4 w-4 shrink-0 text-soft" />
          <span className="flex-1">Déplacer vers le groupe</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-soft" />
        </DropdownMenuPrimitive.SubTrigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.SubContent sideOffset={6} alignOffset={-6} className={SUB_CONTENT}>
            {model.moveGroups.map((group) => (
              <DropdownMenuItem key={group.id} onSelect={run(() => model.onMoveToGroup(group), false)}>
                <GroupPill group={group} size="sm" className="h-6 w-6 [&_svg]:h-3 [&_svg]:w-3" />
                <span className="truncate">{group.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuPrimitive.SubContent>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Sub>
      <DropdownMenuItem onSelect={run(model.onOpenTarget, true)}>
        <TargetIcon className="h-4 w-4 text-soft" />
        {model.hasTarget ? "Modifier l'objectif…" : 'Objectif…'}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={run(model.onHide, false)}>
        <EyeOff className="h-4 w-4 text-soft" />
        Masquer l'enveloppe
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={run(model.onDelete, true)}
        className="text-danger data-[highlighted]:bg-danger/10"
      >
        <Trash2 className="h-4 w-4" />
        Supprimer…
      </DropdownMenuItem>
    </>
  )
}

/**
 * Bouton « ... » d'une ligne (enveloppe ou groupe), revele au survol ou au
 * focus de la ligne (toujours visible sur ecran tactile).
 */
export function RowMenuButton({ model, className }: { model: GridMenuModel; className?: string }) {
  const handoff = useRef(false)
  const label = model.kind === 'category' ? `Actions pour ${model.name}` : `Actions du groupe ${model.name}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title="Actions"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-soft opacity-0 transition-[opacity,background-color,color] duration-150 after:absolute after:-inset-1.5 after:content-[''] hover:bg-ink/[0.06] hover:text-ink focus-visible:opacity-100 focus-visible:ring-offset-surface group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:bg-ink/[0.06] data-[state=open]:text-ink data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => {
          if (handoff.current) e.preventDefault()
          handoff.current = false
        }}
      >
        <GridMenuItems model={model} onHandoff={() => (handoff.current = true)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Menu contextuel (clic droit) ouvert au point du curseur : meme contenu que
 * le bouton « ... », ancre sur un declencheur invisible pose a ce point. Non
 * modal : un clic droit sur une autre ligne rouvre directement son menu.
 */
export function PointMenu({
  x,
  y,
  model,
  onClose,
}: {
  x: number
  y: number
  model: GridMenuModel
  onClose: () => void
}) {
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden tabIndex={-1} style={{ position: 'fixed', left: x, top: y, width: 1, height: 1 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        collisionPadding={12}
        // Pas de retour du focus sur le declencheur invisible.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <GridMenuItems model={model} onHandoff={() => undefined} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

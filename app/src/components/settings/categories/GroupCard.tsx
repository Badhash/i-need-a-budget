// Carte d'un groupe de categories (Reglages > Categories) : en-tete (pastille =
// couleur et icone, nom renommable, masquer, menu), lignes des categories
// visibles, sous-section « Masquées » attenuee, ajout rapide. Toutes les
// actions passent par les mutations optimistes de lib/taxonomy.ts.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import type { Category, CategoryGroup } from '@/types/domain'
import { newTempId } from '@/lib/mutationQueue'
import { renderKey, useCreateCategoryMutation, useUpdateCategoryMutation, useUpdateGroupMutation } from '@/lib/taxonomy'
import { toast } from '@/lib/toast'
import { GroupPill } from '@/components/shared/GroupPill'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Champs de saisie
// ---------------------------------------------------------------------------

/** Renommage inline : Entree/blur valide, Echap annule. */
export function InlineNameInput({
  initial,
  onCommit,
  onCancel,
  placeholder,
  label,
  className,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
  placeholder?: string
  label: string
  className?: string
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  // Echap declenche blur : ce drapeau evite de committer apres une annulation.
  const cancelled = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = () => {
    if (cancelled.current) return
    const name = value.trim().slice(0, 80)
    if (!name || name === initial) onCancel()
    else onCommit(name)
  }

  return (
    <Input
      ref={ref}
      value={value}
      maxLength={80}
      placeholder={placeholder}
      aria-label={label}
      enterKeyHint="done"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') ref.current?.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          onCancel()
        }
      }}
      className={cn('h-10 min-w-0 flex-1', className)}
    />
  )
}

/**
 * Ajout rapide de categories : Entree cree et garde le champ ouvert (saisie en
 * rafale), blur cree la derniere saisie puis ferme, Echap ferme.
 */
function AddCategoryInput({ onAdd, onDone }: { onAdd: (name: string) => void; onDone: () => void }) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const closing = useRef(false)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const flush = () => {
    const name = value.trim().slice(0, 80)
    if (name) onAdd(name)
    setValue('')
  }

  return (
    <Input
      ref={ref}
      value={value}
      maxLength={80}
      placeholder="Nom de la catégorie"
      aria-label="Nom de la nouvelle catégorie"
      enterKeyHint="next"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (!closing.current) flush()
        onDone()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          flush()
        }
        if (e.key === 'Escape') {
          closing.current = true
          onDone()
        }
      }}
      className="h-10"
    />
  )
}

// ---------------------------------------------------------------------------
// Boutons d'action
// ---------------------------------------------------------------------------

/**
 * Bouton rond discret (32px a l'oeil) : zone de toucher etendue a 44px par un
 * pseudo-element, sans changer la mise en page.
 */
function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  pressed?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-soft transition-[background-color,color,transform] duration-150 ease-spring after:absolute after:-inset-1 after:content-[''] hover:bg-ink/[0.06] hover:text-ink active:scale-90 disabled:pointer-events-none disabled:opacity-30 lg:h-8 lg:w-8",
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Declencheur du menu « … » (meme gabarit que IconButton, compatible Radix asChild). */
const MENU_TRIGGER =
  "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-soft transition-[background-color,color,transform] duration-150 ease-spring after:absolute after:-inset-1 after:content-[''] hover:bg-ink/[0.06] hover:text-ink active:scale-90 data-[state=open]:bg-ink/[0.06] data-[state=open]:text-ink lg:h-8 lg:w-8"

// ---------------------------------------------------------------------------
// Ligne categorie
// ---------------------------------------------------------------------------

export interface CategoryActions {
  onMove: (category: Category) => void
  onDelete: (category: Category) => void
}

function CategoryRow({
  category,
  group,
  canUp,
  canDown,
  onReorder,
  actions,
}: {
  category: Category
  group: CategoryGroup
  canUp: boolean
  canDown: boolean
  onReorder: (category: Category, dir: -1 | 1) => void
  actions: CategoryActions
}) {
  const [editing, setEditing] = useState(false)
  const update = useUpdateCategoryMutation()
  const hidden = category.hidden === true
  const income = category.isIncome
  // Action du menu qui deplace le focus (champ de renommage, feuille) : le menu
  // ne doit pas le rendre a son declencheur en se fermant.
  const keepFocus = useRef(false)
  const handoff = (fn: () => void) => () => {
    keepFocus.current = true
    fn()
  }

  const toggleHidden = () => {
    update.mutate({ categoryId: category.id, hidden: !hidden })
    if (!hidden) {
      toast({
        message: `« ${category.name} » masquée`,
        description: 'Retirée du budget et des sélecteurs, son disponible reste compté.',
        action: { label: 'Annuler', onClick: () => update.mutate({ categoryId: category.id, hidden: false }) },
      })
    }
  }

  return (
    <li
      className={cn(
        'group/row flex min-h-[52px] items-center gap-2 py-1.5 pl-4 pr-2 lg:min-h-[46px] lg:pl-5 lg:pr-3',
        hidden && 'text-soft',
      )}
    >
      <span
        aria-hidden
        className={cn('h-2 w-2 shrink-0 rounded-full', hidden && 'opacity-40')}
        style={{ backgroundColor: `var(--cat-${group.color}-fg)` }}
      />
      {editing ? (
        <InlineNameInput
          initial={category.name}
          label={`Renommer « ${category.name} »`}
          onCommit={(name) => {
            update.mutate({ categoryId: category.id, name })
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
          className="ml-1 max-w-sm"
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Renommer"
            className={cn(
              'min-w-0 truncate rounded-lg px-1.5 py-1.5 text-left text-[15px] transition-colors hover:bg-ink/[0.04]',
              hidden ? 'text-soft' : 'text-ink',
            )}
          >
            {category.name}
          </button>
          {income && (
            <Badge variant="success" size="sm" className="shrink-0">
              Revenus
            </Badge>
          )}
        </div>
      )}
      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5">
          {!hidden && (
            <span className="hidden items-center gap-0.5 lg:flex lg:opacity-0 lg:transition-opacity lg:duration-150 lg:focus-within:opacity-100 lg:group-hover/row:opacity-100">
              <IconButton label="Monter" onClick={() => onReorder(category, -1)} disabled={!canUp}>
                <ChevronUp className="h-4 w-4" />
              </IconButton>
              <IconButton label="Descendre" onClick={() => onReorder(category, 1)} disabled={!canDown}>
                <ChevronDown className="h-4 w-4" />
              </IconButton>
            </span>
          )}
          {!income && (
            <IconButton
              label={hidden ? `Afficher « ${category.name} »` : `Masquer « ${category.name} »`}
              pressed={hidden}
              onClick={toggleHidden}
              className={cn(hidden && 'bg-ink/[0.06] text-ink')}
            >
              {hidden ? <EyeOff className="h-[17px] w-[17px]" /> : <Eye className="h-[17px] w-[17px]" />}
            </IconButton>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger className={MENU_TRIGGER} aria-label={`Actions pour « ${category.name} »`}>
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-60"
              onCloseAutoFocus={(e) => {
                if (keepFocus.current) e.preventDefault()
                keepFocus.current = false
              }}
            >
              <DropdownMenuLabel className="truncate normal-case tracking-normal">{category.name}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={handoff(() => setEditing(true))}>
                <Pencil className="h-4 w-4 text-soft" />
                Renommer
              </DropdownMenuItem>
              {!hidden && (
                <>
                  <DropdownMenuItem disabled={!canUp} onSelect={() => onReorder(category, -1)}>
                    <ArrowUp className="h-4 w-4 text-soft" />
                    Monter
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!canDown} onSelect={() => onReorder(category, 1)}>
                    <ArrowDown className="h-4 w-4 text-soft" />
                    Descendre
                  </DropdownMenuItem>
                </>
              )}
              {!income && (
                <>
                  <DropdownMenuItem onSelect={handoff(() => actions.onMove(category))}>
                    <ArrowRightLeft className="h-4 w-4 text-soft" />
                    Déplacer vers…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={toggleHidden}>
                    {hidden ? <Eye className="h-4 w-4 text-soft" /> : <EyeOff className="h-4 w-4 text-soft" />}
                    {hidden ? 'Afficher' : 'Masquer'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={handoff(() => actions.onDelete(category))}
                    className="text-danger data-[highlighted]:bg-danger/10"
                  >
                    <Trash2 className="h-4 w-4" />
                    Supprimer…
                  </DropdownMenuItem>
                </>
              )}
              {income && (
                <p className="px-2.5 pb-1.5 pt-1 text-[12px] leading-snug text-soft">
                  Catégorie de revenus : elle ne se masque, ne se déplace ni ne se supprime.
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Carte groupe
// ---------------------------------------------------------------------------

export interface GroupActions extends CategoryActions {
  onStyle: (group: CategoryGroup) => void
  onDeleteGroup: (group: CategoryGroup) => void
  onReorderGroup: (group: CategoryGroup, dir: -1 | 1) => void
  onReorderCategory: (category: Category, dir: -1 | 1) => void
}

export function GroupCard({
  group,
  categories,
  canUp,
  canDown,
  actions,
}: {
  group: CategoryGroup
  /** Toutes les categories du groupe, triees. */
  categories: Category[]
  canUp: boolean
  canDown: boolean
  actions: GroupActions
}) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const updateGroup = useUpdateGroupMutation()
  const createCategory = useCreateCategoryMutation()
  const keepFocus = useRef(false)
  const handoff = (fn: () => void) => () => {
    keepFocus.current = true
    fn()
  }

  const visible = categories.filter((c) => !c.hidden)
  const hiddenCats = categories.filter((c) => c.hidden)
  const hasIncome = categories.some((c) => c.isIncome)
  // Groupe de revenus pur : pas d'ajout (une nouvelle categorie y serait une
  // enveloppe de depenses, source de confusion).
  const incomeOnly = categories.length > 0 && categories.every((c) => c.isIncome)
  const groupHidden = group.hidden === true
  const empty = categories.length === 0

  const toggleHidden = () => {
    updateGroup.mutate({ groupId: group.id, hidden: !groupHidden })
    if (!groupHidden) {
      toast({
        message: `« ${group.name} » masqué`,
        description: 'Ses catégories sont retirées du budget et des sélecteurs.',
        action: { label: 'Annuler', onClick: () => updateGroup.mutate({ groupId: group.id, hidden: false }) },
      })
    }
  }

  const countLabel = [
    `${categories.length} catégorie${categories.length > 1 ? 's' : ''}`,
    hiddenCats.length > 0 ? `${hiddenCats.length} masquée${hiddenCats.length > 1 ? 's' : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card className={cn('overflow-hidden', groupHidden && 'bg-surface/70 shadow-none')}>
      <div className="flex items-center gap-3 py-3 pl-4 pr-2 lg:pl-5 lg:pr-3">
        <button
          type="button"
          onClick={() => actions.onStyle(group)}
          aria-label={`Couleur et icône de « ${group.name} »`}
          title="Couleur et icône"
          className="group/pill relative shrink-0 rounded-full transition-transform duration-150 ease-spring after:absolute after:-inset-1 after:content-[''] active:scale-95"
        >
          <GroupPill group={group} size="lg" className={cn(groupHidden && 'opacity-50 saturate-50')} />
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-edge bg-surface3 text-soft shadow-card transition-colors group-hover/pill:text-accent-ink">
            <Palette className="h-3 w-3" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <InlineNameInput
              initial={group.name}
              label={`Renommer le groupe « ${group.name} »`}
              onCommit={(name) => {
                updateGroup.mutate({ groupId: group.id, name })
                setEditing(false)
              }}
              onCancel={() => setEditing(false)}
              className="max-w-sm"
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Renommer"
                className={cn(
                  '-ml-1.5 block max-w-full truncate rounded-lg px-1.5 py-0.5 text-left text-[16px] font-semibold tracking-tight transition-colors hover:bg-ink/[0.04]',
                  groupHidden ? 'text-soft' : 'text-ink',
                )}
              >
                {group.name}
              </button>
              <p className="text-[12.5px] text-soft">{empty ? 'Aucune catégorie' : countLabel}</p>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center gap-0.5">
            {!hasIncome && (
              <IconButton
                label={groupHidden ? `Afficher le groupe « ${group.name} »` : `Masquer le groupe « ${group.name} »`}
                pressed={groupHidden}
                onClick={toggleHidden}
                className={cn(groupHidden && 'bg-ink/[0.06] text-ink')}
              >
                {groupHidden ? <EyeOff className="h-[17px] w-[17px]" /> : <Eye className="h-[17px] w-[17px]" />}
              </IconButton>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className={MENU_TRIGGER} aria-label={`Actions du groupe « ${group.name} »`}>
                <MoreHorizontal className="h-[18px] w-[18px]" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-64"
                onCloseAutoFocus={(e) => {
                  if (keepFocus.current) e.preventDefault()
                  keepFocus.current = false
                }}
              >
                <DropdownMenuLabel className="truncate normal-case tracking-normal">{group.name}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={handoff(() => setEditing(true))}>
                  <Pencil className="h-4 w-4 text-soft" />
                  Renommer
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handoff(() => actions.onStyle(group))}>
                  <Palette className="h-4 w-4 text-soft" />
                  Couleur et icône…
                </DropdownMenuItem>
                {!groupHidden && (
                  <>
                    <DropdownMenuItem disabled={!canUp} onSelect={() => actions.onReorderGroup(group, -1)}>
                      <ArrowUp className="h-4 w-4 text-soft" />
                      Monter le groupe
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!canDown} onSelect={() => actions.onReorderGroup(group, 1)}>
                      <ArrowDown className="h-4 w-4 text-soft" />
                      Descendre le groupe
                    </DropdownMenuItem>
                  </>
                )}
                {!hasIncome && (
                  <DropdownMenuItem onSelect={toggleHidden}>
                    {groupHidden ? <Eye className="h-4 w-4 text-soft" /> : <EyeOff className="h-4 w-4 text-soft" />}
                    {groupHidden ? 'Afficher le groupe' : 'Masquer le groupe'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!empty}
                  onSelect={handoff(() => actions.onDeleteGroup(group))}
                  className="text-danger data-[highlighted]:bg-danger/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Supprimer le groupe…
                </DropdownMenuItem>
                {!empty && (
                  <p className="px-2.5 pb-1.5 pt-0.5 text-[12px] leading-snug text-soft">
                    {hasIncome
                      ? 'Groupe de revenus : il reste toujours visible.'
                      : 'Déplace ou supprime d’abord ses catégories pour pouvoir le supprimer.'}
                  </p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {visible.length > 0 && (
        <ul className="divide-y divide-line/50 border-t border-line/60">
          {visible.map((cat, i) => (
            <CategoryRow
              key={renderKey(cat.id)}
              category={cat}
              group={group}
              canUp={i > 0}
              canDown={i < visible.length - 1}
              onReorder={actions.onReorderCategory}
              actions={actions}
            />
          ))}
        </ul>
      )}

      {hiddenCats.length > 0 && (
        <div className="border-t border-line/60 bg-surface2/40">
          <p className="flex items-center gap-1.5 px-4 pb-0.5 pt-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-soft lg:px-5">
            <EyeOff className="h-3.5 w-3.5" />
            Masquées · {hiddenCats.length}
          </p>
          <ul className="divide-y divide-line/40">
            {hiddenCats.map((cat) => (
              <CategoryRow
                key={renderKey(cat.id)}
                category={cat}
                group={group}
                canUp={false}
                canDown={false}
                onReorder={actions.onReorderCategory}
                actions={actions}
              />
            ))}
          </ul>
        </div>
      )}

      {!incomeOnly && (
        <div className="border-t border-line/60 px-3 py-2 lg:px-4">
          {adding ? (
            <div className="px-1 py-1">
              <AddCategoryInput
                onAdd={(name) => createCategory.mutate({ groupId: group.id, name, tempId: newTempId() })}
                onDone={() => setAdding(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-[14px] font-medium text-soft transition-colors hover:bg-ink/[0.04] hover:text-accent-ink lg:min-h-10"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-accent-ink">
                <Plus className="h-3.5 w-3.5" />
              </span>
              Ajouter une catégorie
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

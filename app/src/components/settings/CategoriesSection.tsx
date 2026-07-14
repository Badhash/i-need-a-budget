// Section Reglages > Categories : edition complete de la taxonomie (groupes et
// categories) — renommage inline, ajout, suppression avec confirmation,
// reordonnancement par fleches. Toutes les mutations sont optimistes sur le
// cache ['bootstrap'] (voir lib/taxonomy.ts).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Banknote,
  Car,
  ChevronDown,
  ChevronUp,
  Home,
  Pencil,
  PiggyBank,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useBootstrap } from '@/lib/data'
import { newTempId } from '@/lib/mutationQueue'
import type { Category, CategoryGroup, GroupIcon } from '@/mocks/data'
import type { CatColor } from '@/styles/themes'
import {
  useCreateCategoryMutation,
  useCreateGroupMutation,
  useDeleteCategoryMutation,
  useDeleteGroupMutation,
  useReorderCategoriesMutation,
  useReorderGroupsMutation,
  useUpdateCategoryMutation,
  useUpdateGroupMutation,
} from '@/lib/taxonomy'
import { GroupPill } from '@/components/shared/GroupPill'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Icones et couleurs autorisees pour les groupes (memes valeurs que le serveur).
const GROUP_ICONS: { value: GroupIcon; Icon: LucideIcon }[] = [
  { value: 'home', Icon: Home },
  { value: 'car', Icon: Car },
  { value: 'sparkles', Icon: Sparkles },
  { value: 'repeat', Icon: Repeat },
  { value: 'piggy', Icon: PiggyBank },
  { value: 'banknote', Icon: Banknote },
]
const GROUP_COLORS: CatColor[] = ['blue', 'green', 'amber', 'pink', 'purple', 'teal']

// ---------------------------------------------------------------------------
// Renommage inline : Enter/blur valide, Echap annule
// ---------------------------------------------------------------------------

function InlineNameInput({
  initial,
  onCommit,
  onCancel,
  placeholder,
  className,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
  placeholder?: string
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
    const name = value.trim()
    if (!name || name === initial) onCancel()
    else onCommit(name)
  }

  return (
    <Input
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') ref.current?.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          onCancel()
        }
      }}
      className={cn('h-9', className)}
    />
  )
}

// Petit bouton d'action discret (crayon, poubelle, fleches) — cible >=44px
// sur mobile via la zone etendue after.
function RowAction({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative rounded-lg p-2 text-soft/70 transition-colors after:absolute after:-inset-1.5 after:content-['']",
        'hover:bg-surface2 hover:text-ink disabled:pointer-events-none disabled:opacity-30',
        danger && 'hover:text-danger',
      )}
    >
      {children}
    </button>
  )
}

interface PendingDelete {
  kind: 'category' | 'group'
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Ligne categorie
// ---------------------------------------------------------------------------

function CategoryRow({
  category,
  index,
  siblings,
  onAskDelete,
}: {
  category: Category
  index: number
  siblings: Category[]
  onAskDelete: (p: PendingDelete) => void
}) {
  const [editing, setEditing] = useState(false)
  const update = useUpdateCategoryMutation()
  const reorder = useReorderCategoriesMutation()

  const move = (dir: -1 | 1) => {
    const ids = siblings.map((c) => c.id)
    const j = index + dir
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    reorder.mutate({ groupId: category.groupId, orderedIds: ids })
  }

  return (
    <li className="group/row flex min-h-[44px] items-center gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-surface2/60">
      {editing ? (
        <InlineNameInput
          initial={category.name}
          onCommit={(name) => {
            update.mutate({ categoryId: category.id, name })
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
          className="max-w-xs"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[14px]">{category.name}</span>
      )}
      {!editing && (
        <span className="flex items-center gap-0.5 lg:opacity-0 lg:transition-opacity lg:group-hover/row:opacity-100 lg:focus-within:opacity-100">
          <RowAction label="Monter" onClick={() => move(-1)} disabled={index === 0}>
            <ChevronUp className="h-4 w-4" />
          </RowAction>
          <RowAction label="Descendre" onClick={() => move(1)} disabled={index === siblings.length - 1}>
            <ChevronDown className="h-4 w-4" />
          </RowAction>
          <RowAction label="Renommer" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
          </RowAction>
          {!category.isIncome && (
            <RowAction
              label="Supprimer"
              danger
              onClick={() => onAskDelete({ kind: 'category', id: category.id, name: category.name })}
            >
              <Trash2 className="h-4 w-4" />
            </RowAction>
          )}
        </span>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Bloc groupe
// ---------------------------------------------------------------------------

function GroupBlock({
  group,
  categories,
  index,
  groups,
  onAskDelete,
}: {
  group: CategoryGroup
  categories: Category[]
  index: number
  groups: CategoryGroup[]
  onAskDelete: (p: PendingDelete) => void
}) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const updateGroup = useUpdateGroupMutation()
  const createCategory = useCreateCategoryMutation()
  const reorderGroups = useReorderGroupsMutation()

  const move = (dir: -1 | 1) => {
    const ids = groups.map((g) => g.id)
    const j = index + dir
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    reorderGroups.mutate({ orderedIds: ids })
  }

  return (
    <div className="rounded-2xl border border-line p-3">
      <div className="group/row flex min-h-[44px] items-center gap-3 px-1">
        <GroupPill group={group} size="sm" />
        {editing ? (
          <InlineNameInput
            initial={group.name}
            onCommit={(name) => {
              updateGroup.mutate({ groupId: group.id, name })
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
            className="max-w-xs"
          />
        ) : (
          <span className="label-caps min-w-0 flex-1 truncate">{group.name}</span>
        )}
        {!editing && (
          <span className="flex items-center gap-0.5 lg:opacity-0 lg:transition-opacity lg:group-hover/row:opacity-100 lg:focus-within:opacity-100">
            <RowAction label="Monter le groupe" onClick={() => move(-1)} disabled={index === 0}>
              <ChevronUp className="h-4 w-4" />
            </RowAction>
            <RowAction
              label="Descendre le groupe"
              onClick={() => move(1)}
              disabled={index === groups.length - 1}
            >
              <ChevronDown className="h-4 w-4" />
            </RowAction>
            <RowAction label="Renommer le groupe" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
            </RowAction>
            <RowAction
              label="Supprimer le groupe"
              danger
              onClick={() => onAskDelete({ kind: 'group', id: group.id, name: group.name })}
            >
              <Trash2 className="h-4 w-4" />
            </RowAction>
          </span>
        )}
      </div>

      <ul className="mt-1 space-y-0.5">
        {categories.map((cat, i) => (
          <CategoryRow
            key={cat.id}
            category={cat}
            index={i}
            siblings={categories}
            onAskDelete={onAskDelete}
          />
        ))}
      </ul>

      {adding ? (
        <div className="mt-1 px-2">
          <InlineNameInput
            initial=""
            placeholder="Nom de la catégorie"
            onCommit={(name) => {
              createCategory.mutate({ groupId: group.id, name, tempId: newTempId() })
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
            className="max-w-xs"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] text-soft transition-colors hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter une catégorie
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formulaire nouveau groupe : nom + pastille couleur + icone
// ---------------------------------------------------------------------------

function NewGroupForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<CatColor>('blue')
  const [icon, setIcon] = useState<GroupIcon>('sparkles')
  const createGroup = useCreateGroupMutation()

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    createGroup.mutate({ name: trimmed, color, icon, tempId: newTempId() })
    onDone()
  }

  return (
    <div className="space-y-4 rounded-2xl border border-dashed border-line p-4">
      <Input
        autoFocus
        value={name}
        placeholder="Nom du groupe"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onDone()
        }}
        className="max-w-xs"
      />
      <div>
        <p className="label-caps mb-2">Couleur</p>
        <div className="flex flex-wrap gap-2">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Couleur ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn(
                'h-8 w-8 rounded-full transition-[transform,box-shadow] duration-150',
                color === c && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
              )}
              style={{ backgroundColor: `var(--cat-${c}-fg)` }}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="label-caps mb-2">Icône</p>
        <div className="flex flex-wrap gap-2">
          {GROUP_ICONS.map(({ value, Icon }) => (
            <button
              key={value}
              type="button"
              aria-label={`Icône ${value}`}
              aria-pressed={icon === value}
              onClick={() => setIcon(value)}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full transition-all',
                icon === value
                  ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
                  : 'hover:bg-surface2',
              )}
              style={{
                backgroundColor: `var(--cat-${color}-bg)`,
                color: `var(--cat-${color}-fg)`,
              }}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={!name.trim()}>
          Créer le groupe
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Annuler
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section principale
// ---------------------------------------------------------------------------

export function CategoriesSection() {
  const boot = useBootstrap()
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const deleteCategory = useDeleteCategoryMutation()
  const deleteGroup = useDeleteGroupMutation()

  const confirmDelete = () => {
    if (!pendingDelete) return
    const onError = (err: unknown) => {
      setDeleteError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    }
    if (pendingDelete.kind === 'category') {
      deleteCategory.mutate({ categoryId: pendingDelete.id }, { onError })
    } else {
      deleteGroup.mutate({ groupId: pendingDelete.id }, { onError })
    }
    setPendingDelete(null)
  }

  const groups = (boot.data?.groups ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder)
  const catsOf = (groupId: string) =>
    (boot.data?.categories ?? [])
      .filter((c) => c.groupId === groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catégories</CardTitle>
        <p className="text-[13px] text-soft">
          Renomme, réorganise, ajoute ou supprime tes groupes et catégories d'enveloppes.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {deleteError && (
          <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            {deleteError}
          </p>
        )}

        {boot.isPending && (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        )}

        {groups.map((group, i) => (
          <GroupBlock
            key={group.id}
            group={group}
            categories={catsOf(group.id)}
            index={i}
            groups={groups}
            onAskDelete={(p) => {
              setDeleteError(null)
              setPendingDelete(p)
            }}
          />
        ))}

        {boot.data &&
          (creatingGroup ? (
            <NewGroupForm onDone={() => setCreatingGroup(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setCreatingGroup(true)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] text-soft transition-colors hover:text-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              Nouveau groupe
            </button>
          ))}
      </CardContent>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Supprimer « {pendingDelete?.name} » ?
            </DialogTitle>
            <DialogDescription>
              {pendingDelete?.kind === 'category'
                ? 'Les transactions de cette catégorie repasseront « À catégoriser » et les montants assignés seront supprimés. Cette action est irréversible.'
                : 'Le groupe sera supprimé. Un groupe contenant encore des catégories ne peut pas être supprimé.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 p-5 pt-3">
            <DialogClose asChild>
              <Button variant="ghost">Annuler</Button>
            </DialogClose>
            <Button variant="danger" onClick={confirmDelete}>
              Supprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

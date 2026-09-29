// Section Reglages > Categories : gestion complete de la taxonomie (groupes et
// categories). Renommage inline, ajout rapide, ordre, masquage (oeil, avec
// sous-section « Masquées » et groupes masques en fin de liste), deplacement
// vers un autre groupe, couleur et icone des groupes, suppression avec
// reaffectation optionnelle des transactions. Les categories de revenus ne se
// masquent, ne se deplacent ni ne se suppriment (regles serveur). Toutes les
// mutations sont optimistes (bootstrap + budgets, cf. lib/taxonomy.ts).

import { useMemo, useState } from 'react'
import { EyeOff, FolderPlus, Plus, Shapes } from 'lucide-react'
import { useBootstrap } from '@/lib/data'
import { newTempId } from '@/lib/mutationQueue'
import type { Category, CategoryGroup, GroupIcon } from '@/types/domain'
import type { CatColor } from '@/styles/themes'
import {
  renderKey,
  useCreateGroupMutation,
  useDeleteGroupMutation,
  useReorderCategoriesMutation,
  useReorderGroupsMutation,
  useUpdateCategoryMutation,
} from '@/lib/taxonomy'
import { toast } from '@/lib/toast'
import { GroupPill } from '@/components/shared/GroupPill'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { GroupCard, type GroupActions } from '@/components/settings/categories/GroupCard'
import { ColorSwatches, IconChoices } from '@/components/settings/categories/groupStyle'
import { GroupStyleDialog } from '@/components/settings/categories/GroupStyleDialog'
import { MoveCategoryDialog } from '@/components/settings/categories/MoveCategoryDialog'
import { DeleteCategoryDialog } from '@/components/settings/categories/DeleteCategoryDialog'
import { useLatched } from '@/components/settings/shared/useLatched'

const bySort = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder

/**
 * Deplace `id` a la place de son voisin VISIBLE (dir -1/+1) dans l'ordre
 * complet (masques compris) : renvoie le nouvel ordre ou null si impossible.
 */
function moveAmongVisible<T extends { id: string; hidden?: boolean }>(
  all: T[],
  id: string,
  dir: -1 | 1,
): string[] | null {
  const visible = all.filter((x) => !x.hidden)
  const vi = visible.findIndex((x) => x.id === id)
  const neighbour = visible[vi + dir]
  if (vi === -1 || !neighbour) return null
  const ids = all.map((x) => x.id)
  const from = ids.indexOf(id)
  const to = ids.indexOf(neighbour.id)
  ids.splice(from, 1)
  ids.splice(to, 0, id)
  return ids
}

// ---------------------------------------------------------------------------
// Nouveau groupe : nom + couleur + icone
// ---------------------------------------------------------------------------

function NewGroupCard({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<CatColor>('blue')
  const [icon, setIcon] = useState<GroupIcon>('sparkles')
  const createGroup = useCreateGroupMutation()

  const submit = () => {
    const trimmed = name.trim().slice(0, 80)
    if (!trimmed) return
    createGroup.mutate({ name: trimmed, color, icon, tempId: newTempId() })
    onDone()
  }

  return (
    <Card variant="raised" className="animate-fade-up space-y-5 p-5">
      <div className="flex items-center gap-3">
        <GroupPill group={{ id: 'new', name, color, icon, sortOrder: 0 }} size="lg" />
        <Input
          autoFocus
          value={name}
          maxLength={80}
          placeholder="Nom du groupe"
          aria-label="Nom du nouveau groupe"
          enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onDone()
          }}
        />
      </div>
      <div>
        <p className="label-caps mb-2.5">Couleur</p>
        <ColorSwatches value={color} onChange={setColor} />
      </div>
      <div>
        <p className="label-caps mb-2.5">Icône</p>
        <IconChoices value={icon} color={color} onChange={setIcon} />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button onClick={submit} disabled={!name.trim()}>
          <FolderPlus className="h-4 w-4" />
          Créer le groupe
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Suppression d'un groupe (vide)
// ---------------------------------------------------------------------------

function DeleteGroupDialog({ group: openGroup, onClose }: { group: CategoryGroup | null; onClose: () => void }) {
  const group = useLatched(openGroup)
  const deleteGroup = useDeleteGroupMutation()
  return (
    <Dialog open={openGroup !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {group && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">Supprimer le groupe « {group.name} » ?</DialogTitle>
              <DialogDescription>
                Il ne contient plus aucune catégorie. Cette action est irréversible.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Annuler
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  deleteGroup.mutate({ groupId: group.id })
                  toast({ message: `Groupe « ${group.name} » supprimé`, tone: 'success' })
                  onClose()
                }}
              >
                Supprimer
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Section principale
// ---------------------------------------------------------------------------

export function CategoriesSection() {
  const boot = useBootstrap()
  const updateCategory = useUpdateCategoryMutation()
  const reorderCategories = useReorderCategoriesMutation()
  const reorderGroups = useReorderGroupsMutation()
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [styleGroupId, setStyleGroupId] = useState<string | null>(null)
  const [moveId, setMoveId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null)

  const groups = useMemo(() => (boot.data?.groups ?? []).slice().sort(bySort), [boot.data?.groups])
  const categories = useMemo(() => boot.data?.categories ?? [], [boot.data?.categories])
  const catsByGroup = useMemo(() => {
    const map = new Map<string, Category[]>()
    for (const c of categories) {
      const list = map.get(c.groupId) ?? []
      list.push(c)
      map.set(c.groupId, list)
    }
    for (const list of map.values()) list.sort(bySort)
    return map
  }, [categories])
  const catsOf = (groupId: string) => catsByGroup.get(groupId) ?? []

  const visibleGroups = groups.filter((g) => !g.hidden)
  const hiddenGroups = groups.filter((g) => g.hidden)
  const hiddenCount = categories.filter((c) => c.hidden).length
  const byId = (id: string | null) => (id ? (categories.find((c) => c.id === id) ?? null) : null)
  const styleGroup = styleGroupId ? (groups.find((g) => g.id === styleGroupId) ?? null) : null
  const deleteGroup = deleteGroupId ? (groups.find((g) => g.id === deleteGroupId) ?? null) : null

  // Cibles d'un deplacement : tous les groupes sauf les groupes de revenus purs.
  const moveTargets = groups.filter((g) => {
    const cats = catsOf(g.id)
    return !(cats.length > 0 && cats.every((c) => c.isIncome))
  })

  const moveCategory = (category: Category, groupId: string) => {
    const from = groups.find((g) => g.id === category.groupId)
    const to = groups.find((g) => g.id === groupId)
    // Ordre d'origine : l'annulation remet la categorie a sa place exacte.
    const originalOrder = catsOf(category.groupId).map((c) => c.id)
    updateCategory.mutate({ categoryId: category.id, groupId })
    setMoveId(null)
    toast({
      message: `« ${category.name} » déplacée`,
      description: to ? `Dans « ${to.name} »` : undefined,
      action: from
        ? {
            label: 'Annuler',
            onClick: () => {
              updateCategory.mutate({ categoryId: category.id, groupId: from.id })
              reorderCategories.mutate({ groupId: from.id, orderedIds: originalOrder })
            },
          }
        : undefined,
    })
  }

  const actions: GroupActions = {
    onStyle: (g) => setStyleGroupId(g.id),
    onDeleteGroup: (g) => setDeleteGroupId(g.id),
    onMove: (c) => setMoveId(c.id),
    onDelete: (c) => setDeleteId(c.id),
    onReorderGroup: (g, dir) => {
      const next = moveAmongVisible(groups, g.id, dir)
      if (next) reorderGroups.mutate({ orderedIds: next })
    },
    onReorderCategory: (c, dir) => {
      const next = moveAmongVisible(catsOf(c.groupId), c.id, dir)
      if (next) reorderCategories.mutate({ groupId: c.groupId, orderedIds: next })
    },
  }

  if (boot.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[13px] text-soft tnum">
          {visibleGroups.length} groupe{visibleGroups.length > 1 ? 's' : ''} · {categories.length} catégorie
          {categories.length > 1 ? 's' : ''}
          {hiddenCount > 0 && (
            <>
              {' · '}
              <span className="inline-flex items-center gap-1 align-[-1px]">
                <EyeOff className="h-3 w-3" />
                {hiddenCount} masquée{hiddenCount > 1 ? 's' : ''}
              </span>
            </>
          )}
        </p>
        {!creatingGroup && groups.length > 0 && (
          <Button variant="soft" size="sm" onClick={() => setCreatingGroup(true)}>
            <Plus className="h-4 w-4" />
            Nouveau groupe
          </Button>
        )}
      </div>

      {groups.length === 0 && !creatingGroup && (
        <Card>
          <EmptyState
            compact
            icon={Shapes}
            title="Aucune catégorie"
            description="Crée un premier groupe pour ranger tes enveloppes."
            actionLabel="Nouveau groupe"
            onAction={() => setCreatingGroup(true)}
          />
        </Card>
      )}

      {visibleGroups.map((group, i) => (
        <GroupCard
          key={renderKey(group.id)}
          group={group}
          categories={catsOf(group.id)}
          canUp={i > 0}
          canDown={i < visibleGroups.length - 1}
          actions={actions}
        />
      ))}

      {creatingGroup && <NewGroupCard onDone={() => setCreatingGroup(false)} />}

      {hiddenGroups.length > 0 && (
        <div className="space-y-3 pt-3">
          <p className="flex items-center gap-1.5 px-1 text-[12px] font-medium uppercase tracking-[0.08em] text-soft">
            <EyeOff className="h-3.5 w-3.5" />
            Groupes masqués · {hiddenGroups.length}
          </p>
          {hiddenGroups.map((group) => (
            <GroupCard
              key={renderKey(group.id)}
              group={group}
              categories={catsOf(group.id)}
              canUp={false}
              canDown={false}
              actions={actions}
            />
          ))}
        </div>
      )}

      <GroupStyleDialog
        group={styleGroup}
        categoryNames={styleGroup ? catsOf(styleGroup.id).map((c) => c.name) : []}
        onClose={() => setStyleGroupId(null)}
      />
      <MoveCategoryDialog
        category={byId(moveId)}
        groups={moveTargets}
        countOf={(groupId) => catsOf(groupId).length}
        onMove={moveCategory}
        onClose={() => setMoveId(null)}
      />
      <DeleteCategoryDialog
        category={byId(deleteId)}
        groups={groups}
        categories={categories}
        onClose={() => setDeleteId(null)}
      />
      <DeleteGroupDialog group={deleteGroup} onClose={() => setDeleteGroupId(null)} />
    </div>
  )
}

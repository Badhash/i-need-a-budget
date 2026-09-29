import { useDeferredValue, useMemo, useState } from 'react'
import { Brain, ChevronDown, Search, UserRound, X } from 'lucide-react'
import { useBootstrap, useCategoriesMap, useGroupsMap } from '@/lib/data'
import { useTransactions } from '@/lib/queries'
import { payeeLabelFor, usePayeeCounts, usePayeeDefault } from '@/lib/payees'
import { normalizeLabel } from '@/lib/rules'
import { haptic } from '@/lib/haptics'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { toast } from '@/lib/toast'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { EmptyState } from '@/components/shared/EmptyState'
import { GroupPill } from '@/components/shared/GroupPill'
import { countLabel } from '@/components/rules/RulePreviewPanel'
import { focusCategorySearch } from '@/components/rules/focusCategorySearch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const PAGE = 8

/** Phrase unique qui explique l'apprentissage (regle « 2 des 3 derniers »). */
export const PAYEE_MEMORY_EXPLAINER =
  "Chaque catégorisation manuelle nourrit la mémoire : dès que 2 de tes 3 derniers choix pour un tiers concordent, ils deviennent sa catégorie par défaut à l'import."

/**
 * « Tiers mémorisés » : la memoire de tiers apprise par le serveur
 * (bootstrap.payees), cherchable, avec « Changer » (categories hors revenus)
 * et « Oublier » (annulable). Optimiste, rollback de la seule cle touchee.
 */
export function PayeeMemory({ className }: { className?: string }) {
  const boot = useBootstrap().data
  const { data: transactions } = useTransactions()
  const categories = useCategoriesMap()
  const groups = useGroupsMap()
  const counts = usePayeeCounts()
  const setDefault = usePayeeDefault()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const isDesktop = useIsDesktop()
  const deferredQuery = useDeferredValue(query)

  const payees = boot?.payees
  const sorted = useMemo(
    () =>
      (payees ?? [])
        .slice()
        .sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0) || a.key.localeCompare(b.key, 'fr')),
    [payees, counts],
  )
  const filtered = useMemo(() => {
    const q = normalizeLabel(deferredQuery)
    if (!q) return sorted
    return sorted.filter((p) => {
      const name = categories.get(p.categoryId)?.name ?? ''
      return p.key.includes(q) || normalizeLabel(name).includes(q)
    })
  }, [sorted, deferredQuery, categories])

  const visible = expanded || deferredQuery ? filtered : filtered.slice(0, PAGE)

  const change = (key: string, categoryId: string | null) => {
    const label = payeeLabelFor(key, transactions)
    if (!label) return
    const previous = payees?.find((p) => p.key === key)?.categoryId ?? null
    if (previous === categoryId) return
    haptic(8)
    setDefault.mutate({ key, label, categoryId })
    if (categoryId === null) {
      toast({
        id: `payee-forget-${key}`,
        message: `« ${key} » oublié`,
        description: 'Plus de classement automatique pour ce tiers, sauf règle.',
        action: previous
          ? { label: 'Annuler', onClick: () => setDefault.mutate({ key, label, categoryId: previous }) }
          : undefined,
      })
    }
  }

  if (!boot) return null

  if (sorted.length === 0) {
    return (
      <div className={className}>
        <EmptyState
          compact
          icon={Brain}
          title="Aucun tiers mémorisé"
          description="La mémoire se construit à chaque catégorisation manuelle : les imports suivants arrivent déjà classés."
        />
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft/80" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tiers ou catégorie"
          aria-label="Chercher dans les tiers mémorisés"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="pl-10 pr-11"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Effacer la recherche"
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-soft transition-colors hover:text-ink lg:h-9 lg:w-9"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-1 py-6 text-center text-[13.5px] text-soft">Aucun tiers ne correspond à « {query.trim()} ».</p>
      ) : (
        <ul className="-mx-1 divide-y divide-line/60">
          {visible.map((payee) => {
            const category = categories.get(payee.categoryId)
            const group = category ? groups.get(category.groupId) : undefined
            const count = counts.get(payee.key) ?? 0
            const editable = payeeLabelFor(payee.key, transactions) !== null
            const open = isDesktop || openKey === payee.key
            const identity = (
              <>
                <GroupPill group={group} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium text-ink first-letter:uppercase">
                    {payee.key}
                  </span>
                  <span className="block truncate text-[12.5px] text-soft">
                    <span className={cn(!category && 'text-warning')}>{category?.name ?? 'Catégorie supprimée'}</span>
                    {count > 0 && <span className="tnum"> · {countLabel(count, 'transaction', 'transactions')}</span>}
                  </span>
                </span>
              </>
            )
            const actions = editable ? (
              <div className="flex shrink-0 items-center gap-1">
                <CategoryPicker onSelect={(id) => id && change(payee.key, id)}>
                  <Button
                    variant="soft"
                    size="sm"
                    onClick={focusCategorySearch}
                    className="after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] lg:after:hidden"
                  >
                    Changer
                  </Button>
                </CategoryPicker>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => change(payee.key, null)}
                  className="after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] hover:text-danger lg:after:hidden"
                >
                  Oublier
                </Button>
              </div>
            ) : (
              <span
                className="flex shrink-0 items-center gap-1 text-[12px] text-soft"
                title="Aucune transaction de ce tiers dans l'historique chargé : modifiable depuis une transaction."
              >
                <UserRound className="h-3.5 w-3.5" />
                Non modifiable
              </span>
            )
            // Desktop : actions en ligne. Mobile : la ligne entiere (lisible,
            // non tronquee par deux boutons) deplie ses actions au toucher.
            return isDesktop ? (
              <li key={payee.key} className="flex items-center gap-3 px-1 py-2.5">
                {identity}
                {actions}
              </li>
            ) : (
              <li key={payee.key} className="px-1">
                <button
                  type="button"
                  onClick={() => setOpenKey((k) => (k === payee.key ? null : payee.key))}
                  aria-expanded={open}
                  className="flex min-h-[60px] w-full items-center gap-3 py-2 text-left"
                >
                  {identity}
                  <ChevronDown
                    className={cn('h-4 w-4 shrink-0 text-soft transition-transform duration-200', open && 'rotate-180')}
                  />
                </button>
                {open && <div className="flex animate-fade-in pb-3 pl-12">{actions}</div>}
              </li>
            )
          })}
        </ul>
      )}

      {!deferredQuery && filtered.length > PAGE && (
        <Button variant="ghost" className="w-full" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Afficher moins' : `Afficher les ${filtered.length - PAGE} autres`}
        </Button>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, Info, Plus, X } from 'lucide-react'
import { merchantLabel, monthsRangePhrase } from '@/lib/analytics'
import type { ScopeItem } from '@/lib/exceptional'
import { useAccountsMap, useCategoriesMap, useGroupsMap } from '@/lib/data'
import { scopeToggle, useReportScope, useSetReportSettings } from '@/lib/reportScope'
import { fmtDateShort, fmtEUR, fmtPercent, monthOf } from '@/lib/format'
import { Amount } from '@/components/shared/Amount'
import { GroupPill } from '@/components/shared/GroupPill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { MerchantAvatar } from '@/components/reports/MerchantAvatar'
import { cn } from '@/lib/utils'

// Virements internes affiches avant « Voir les autres » (souvent nombreux).
const INTERNAL_VISIBLE = 4

/** Phrase d'echelle d'une operation exceptionnelle : « ≈ 14 mois de dépenses habituels ». */
function scaleOf(item: ScopeItem): string {
  const what = item.kind === 'income' ? 'revenus' : 'dépenses'
  if (!item.typical) return `Aucun mois de ${what} comparable`
  const ratio = Math.abs(item.tx.amount) / item.typical
  if (ratio < 1.5) return `${fmtPercent(ratio)} d’un mois habituel de ${what}`
  return `≈ ${Math.round(ratio).toLocaleString('fr-FR')} mois habituels de ${what}`
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="label-caps px-1">{title}</h3>
      {hint && <p className="mt-1 px-1 text-[12.5px] leading-snug text-soft">{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

/**
 * Feuille « Ce que les rapports écartent » : categories hors depenses (choix
 * de l'utilisateur) et operations ecartees sur la periode affichee
 * (exceptionnelles, virements internes non relies, choix manuels), chacune
 * avec son interrupteur. Les rapports se recalculent a chaque bascule
 * (mutation optimiste).
 */
export function ScopeSheet({
  open,
  onOpenChange,
  months,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Mois affiches par la page (periode + mois de reference). */
  months: string[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        {open && <ScopeBody months={months} />}
      </DialogContent>
    </Dialog>
  )
}

function ScopeBody({ months }: { months: string[] }) {
  const { scope, settings, editable } = useReportScope()
  const mutation = useSetReportSettings()
  const categoryById = useCategoriesMap()
  const groupById = useGroupsMap()
  const accountById = useAccountsMap()
  const [showAllInternal, setShowAllInternal] = useState(false)

  const first = months[0] ?? ''
  const last = months[months.length - 1] ?? ''
  const inWindow = useMemo(
    () => (scope?.items ?? []).filter((i) => monthOf(i.tx.date) >= first && monthOf(i.tx.date) <= last),
    [scope, first, last],
  )
  const large = inWindow.filter((i) => i.reason === 'large')
  const internal = inWindow.filter((i) => i.reason === 'internal' && i.tx.amount < 0)
  const manual = inWindow.filter((i) => i.reason === 'manual')
  const excludedSpending = inWindow
    .filter((i) => i.excluded && i.kind === 'spending' && i.reason !== 'internal')
    .reduce((s, i) => s - i.tx.amount, 0)
  const excludedIncome = inWindow
    .filter((i) => i.excluded && i.kind === 'income' && i.reason !== 'internal')
    .reduce((s, i) => s + i.tx.amount, 0)

  const toggle = (item: ScopeItem, excluded: boolean) =>
    mutation.mutate({ overrides: scopeToggle(item.tx, item, !excluded) })
  const setCategories = (ids: string[]) => mutation.mutate({ excludedCategories: ids })

  const categoryLabel = (id: string | null) => (id ? (categoryById.get(id)?.name ?? 'Catégorie supprimée') : 'Sans catégorie')
  const groupOf = (id: string | null) => {
    const groupId = id ? categoryById.get(id)?.groupId : undefined
    return groupId ? (groupById.get(groupId) ?? null) : null
  }

  const row = (item: ScopeItem, title: React.ReactNode, subtitle: React.ReactNode, initial: string) => (
    <li key={item.tx.id} className="flex min-h-[60px] items-center gap-3 px-3.5 py-2.5">
      <MerchantAvatar initial={initial} group={groupOf(item.tx.categoryId)} />
      <div className={cn('min-w-0 flex-1', !item.excluded && 'opacity-60')}>
        <p className="truncate text-[14px] font-medium text-ink">{title}</p>
        <p className="text-[12px] leading-snug text-soft">{subtitle}</p>
      </div>
      <Amount
        cents={item.reason === 'internal' ? Math.abs(item.tx.amount) : item.tx.amount}
        signed={item.tx.amount > 0 && item.reason !== 'internal'}
        className={cn(
          'shrink-0 text-[14px] font-semibold',
          item.tx.amount > 0 && item.reason !== 'internal' ? 'text-success' : 'text-ink',
          !item.excluded && 'opacity-60',
        )}
      />
      <Switch
        checked={item.excluded}
        disabled={!editable}
        onCheckedChange={(v) => toggle(item, v)}
        label={`${item.excluded ? 'Écartée' : 'Comptée'} : ${typeof title === 'string' ? title : 'opération'}`}
      />
    </li>
  )

  const initialOf = (text: string) => text.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'
  const visibleInternal = showAllInternal ? internal : internal.slice(0, INTERNAL_VISIBLE)

  return (
    <>
      <DialogHeader className="px-6 pb-2 pt-7">
        <DialogTitle className="text-[19px]">Ce que les rapports écartent</DialogTitle>
        <DialogDescription className="text-[13.5px] leading-snug">
          Pour des moyennes justes, les opérations hors norme ne comptent ni dans les dépenses ni dans les revenus.
          Ton patrimoine, lui, les garde toujours.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-2">
        {!editable && (
          <p className="mb-4 flex items-start gap-2 rounded-xl bg-surface2 px-3 py-2.5 text-[12.5px] leading-snug text-soft">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            La détection automatique est active. Les choix manuels arriveront avec la prochaine mise à jour du serveur.
          </p>
        )}

        <Section
          title="Catégories hors dépenses"
          hint="Leurs sorties ne comptent pas comme des dépenses : épargne, investissement, argent mis de côté ou avancé pour un proche."
        >
          <div className="flex flex-wrap items-center gap-2">
            {settings.excludedCategories.map((id) => (
              <span
                key={id}
                className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full bg-surface2 py-1 pl-1 pr-1 text-[13px] font-medium text-ink ring-1 ring-inset ring-edge"
              >
                <GroupPill group={groupOf(id) ?? undefined} size="sm" />
                <span className="max-w-[12rem] truncate">{categoryLabel(id)}</span>
                <button
                  type="button"
                  disabled={!editable}
                  aria-label={`Recompter ${categoryLabel(id)} dans les dépenses`}
                  onClick={() => setCategories(settings.excludedCategories.filter((c) => c !== id))}
                  className="relative flex h-7 w-7 items-center justify-center rounded-full text-soft transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-ink/[0.07] hover:text-ink disabled:opacity-40"
                >
                  <X aria-hidden className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <CategoryPicker
              disabled={!editable}
              onSelect={(id) => {
                if (id && !settings.excludedCategories.includes(id)) setCategories([...settings.excludedCategories, id])
              }}
            >
              <Button type="button" variant="soft" disabled={!editable} className="rounded-full">
                <Plus aria-hidden className="h-4 w-4" />
                Ajouter une catégorie
              </Button>
            </CategoryPicker>
          </div>
        </Section>

        <Section
          title={`Opérations écartées ${first && last ? monthsRangePhrase(first, last) : ''}`.trim()}
          hint={
            excludedSpending > 0 || excludedIncome > 0
              ? [
                  excludedSpending > 0 ? `${fmtEUR(excludedSpending)} de dépenses` : null,
                  excludedIncome > 0 ? `${fmtEUR(excludedIncome)} de revenus` : null,
                ]
                  .filter(Boolean)
                  .join(' et ') + ' hors moyennes.'
              : undefined
          }
        >
          {large.length === 0 && internal.length === 0 && manual.length === 0 ? (
            <p className="rounded-2xl bg-surface2 px-4 py-3.5 text-[13px] leading-snug text-soft">
              Rien d’exceptionnel sur la période : toutes tes opérations comptent.
            </p>
          ) : (
            <div className="space-y-4">
              {large.length > 0 && (
                <div>
                  <p className="px-1 pb-1.5 text-[13px] font-semibold text-ink">Opérations exceptionnelles</p>
                  <ul className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface">
                    {large.map((item) => {
                      const name = merchantLabel(item.tx.label || categoryLabel(item.tx.categoryId))
                      return row(item, name, `${fmtDateShort(item.tx.date)} · ${scaleOf(item)}`, initialOf(name))
                    })}
                  </ul>
                </div>
              )}

              {internal.length > 0 && (
                <div>
                  <p className="px-1 text-[13px] font-semibold text-ink">Virements entre tes comptes</p>
                  <p className="px-1 pb-1.5 text-[12px] leading-snug text-soft">
                    Le même montant sort d’un compte et entre sur l’autre : c’est ton argent qui change de compte, ni
                    une dépense ni un revenu.
                  </p>
                  <ul className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface">
                    {visibleInternal.map((item) => {
                      const from = accountById.get(item.tx.accountId)?.name ?? 'Compte'
                      const to = item.partner ? (accountById.get(item.partner.accountId)?.name ?? 'Compte') : 'Compte'
                      return row(
                        item,
                        <span className="inline-flex max-w-full items-center gap-1.5">
                          <span className="truncate">{from}</span>
                          <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-soft" />
                          <span className="truncate">{to}</span>
                        </span>,
                        `${fmtDateShort(item.tx.date)} · ${categoryLabel(item.tx.categoryId)} / ${categoryLabel(item.partner?.categoryId ?? null)}`,
                        initialOf(from),
                      )
                    })}
                  </ul>
                  {internal.length > INTERNAL_VISIBLE && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="mt-1 w-full"
                      aria-expanded={showAllInternal}
                      onClick={() => setShowAllInternal((v) => !v)}
                    >
                      {showAllInternal ? 'Afficher moins' : `Voir les ${internal.length - INTERNAL_VISIBLE} autres`}
                      <ChevronDown
                        aria-hidden
                        className={cn('h-4 w-4 transition-transform duration-200', showAllInternal && 'rotate-180')}
                      />
                    </Button>
                  )}
                </div>
              )}

              {manual.length > 0 && (
                <div>
                  <p className="px-1 pb-1.5 text-[13px] font-semibold text-ink">Écartées à la main</p>
                  <ul className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface">
                    {manual.map((item) => {
                      const name = merchantLabel(item.tx.label || categoryLabel(item.tx.categoryId))
                      return row(item, name, `${fmtDateShort(item.tx.date)} · ${categoryLabel(item.tx.categoryId)}`, initialOf(name))
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Section>

        <p className="mt-5 flex items-start gap-2 px-1 text-[12.5px] leading-snug text-soft">
          <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Pour écarter une autre opération (un déménagement, un gros achat), ouvre-la depuis Transactions puis active
          « Écartée des rapports ».
        </p>
      </div>
    </>
  )
}

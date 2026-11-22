import { memo, useState } from 'react'
import { ChevronRight, EyeOff, Trophy } from 'lucide-react'
import { inMonth, type Analytics, type BigTx } from '@/lib/analytics'
import { fmtDateShort, fmtPercent } from '@/lib/format'
import { scopeToggle, useReportScope, useSetReportSettings } from '@/lib/reportScope'
import { toast } from '@/lib/toast'
import { useUiStore } from '@/stores/ui'
import { Amount } from '@/components/shared/Amount'
import { GroupPill } from '@/components/shared/GroupPill'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { SegmentedControl } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { MerchantAvatar } from '@/components/reports/MerchantAvatar'
import { CaptionSkeleton, WidgetCard } from '@/components/reports/WidgetCard'
import { cn } from '@/lib/utils'

type Tab = 'merchants' | 'operations'
const TABS = [
  { value: 'merchants' as const, label: 'Marchands' },
  { value: 'operations' as const, label: 'Opérations' },
]
const TOP = 5
// Liste a hauteur FIXE (5 lignes de 52px) dans les deux onglets : rien ne
// bouge au changement d'onglet ni a l'arrivee des donnees.
const LIST = 'min-h-[276px]'
const ROW = 'flex h-[52px] items-center gap-3'

function question(reference: string, currentMonth: string): string {
  return `Où je dépense le plus ${inMonth(reference, currentMonth)} ?`
}

/**
 * « Où je dépense le plus » : les marchands du mois (regroupes par cle de
 * tiers, part de chacun) ou ses plus grosses operations. Une operation s'ouvre
 * d'un appui ; un achat hors norme (demenagement, gros equipement) s'ecarte
 * des rapports en un geste, avec « Annuler ».
 */
export const SpendingLeaders = memo(function SpendingLeaders({
  a,
  currentMonth,
  className,
}: {
  a: Analytics
  currentMonth: string
  className?: string
}) {
  const [tab, setTab] = useState<Tab>('merchants')
  const purchases = a.merchants.reduce((s, m) => s + m.total, 0)
  const count = a.merchants.length
  const buys = a.merchants.reduce((s, m) => s + m.count, 0)
  const caption =
    count === 0
      ? 'Aucun achat sur le mois'
      : `${buys} achat${buys > 1 ? 's' : ''} chez ${count} marchand${count > 1 ? 's' : ''}`
  return (
    <WidgetCard icon={Trophy} question={question(a.reference, currentMonth)} caption={caption} className={className}>
      <SegmentedControl aria-label="Classer par" options={TABS} value={tab} onChange={setTab} size="sm" block />
      <div className={LIST}>
        {tab === 'merchants' ? (
          <MerchantList a={a} purchases={purchases} />
        ) : (
          <OperationList a={a} />
        )}
      </div>
    </WidgetCard>
  )
})

function Empty({ a }: { a: Analytics }) {
  return (
    <p className="flex h-full min-h-[200px] items-center justify-center text-center text-[13.5px] text-soft">
      {a.isCurrentMonth ? 'Aucun achat pour l’instant ce mois-ci.' : 'Aucun achat ce mois-là.'}
    </p>
  )
}

function MerchantList({ a, purchases }: { a: Analytics; purchases: number }) {
  const top = a.merchants.slice(0, TOP)
  if (top.length === 0) return <Empty a={a} />
  const max = top[0]!.total
  return (
    <ol className="flex flex-col">
      {top.map((m, i) => (
        <li key={m.key} className={ROW}>
          <MerchantAvatar initial={m.initial} group={m.group} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[14px] font-medium text-ink">
                <span className="sr-only">{i + 1}. </span>
                {m.label}
              </span>
              <Amount cents={m.total} className="shrink-0 text-[14px] font-semibold text-ink" />
            </div>
            <div className="mt-1.5 flex items-center gap-2.5">
              <ProgressBar value={m.total / max} tone="accent" size="sm" className="flex-1" />
              <span className="w-[7.5rem] shrink-0 text-right text-[11.5px] text-soft tnum">
                {m.count} {m.count > 1 ? 'achats' : 'achat'} · {fmtPercent(purchases > 0 ? m.total / purchases : 0)}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function OperationList({ a }: { a: Analytics }) {
  const setEditTx = useUiStore((s) => s.setEditTx)
  const { scope, editable } = useReportScope()
  const mutation = useSetReportSettings()
  const top = a.biggest.slice(0, TOP)
  if (top.length === 0) return <Empty a={a} />

  const exclude = (b: BigTx) => {
    const item = scope?.items.find((i) => i.tx.id === b.tx.id) ?? null
    mutation.mutate({ overrides: scopeToggle(b.tx, item, false) })
    toast({
      message: 'Écartée des rapports',
      description: `${b.label} ne compte plus dans les moyennes.`,
      action: { label: 'Annuler', onClick: () => mutation.mutate({ overrides: scopeToggle(b.tx, item, true) }) },
    })
  }

  return (
    <ul className="-mx-2 flex flex-col">
      {top.map((b) => {
        const content = (
          <>
            <GroupPill group={b.group ?? undefined} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">{b.label}</span>
              <span className="block truncate text-[12px] text-soft">
                {fmtDateShort(b.tx.date)} · {b.categoryName ?? 'À catégoriser'}
              </span>
            </span>
            <Amount cents={b.amount} className="shrink-0 text-[14px] font-semibold text-ink" />
          </>
        )
        return (
          <li key={b.tx.id} className="flex items-center gap-1">
            {/* Une moitie de virement ne se modifie pas depuis le formulaire
                (meme regle que la liste des transactions). */}
            {b.tx.transferGroupId ? (
              <div className={cn(ROW, 'min-w-0 flex-1 px-2')}>{content}</div>
            ) : (
              <button
                type="button"
                onClick={() => setEditTx(b.tx)}
                className={cn(ROW, 'pressable group min-w-0 flex-1 rounded-xl px-2 text-left transition-colors hover:bg-surface2/70')}
              >
                {content}
                <ChevronRight
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-soft/60 transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </button>
            )}
            {editable && (
              <button
                type="button"
                onClick={() => exclude(b)}
                title="Écarter des rapports"
                aria-label={`Écarter ${b.label} des rapports`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-soft transition-colors hover:bg-surface2/70 hover:text-ink lg:h-10 lg:w-10"
              >
                <EyeOff aria-hidden className="h-[18px] w-[18px]" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function SpendingLeadersSkeleton({
  reference,
  currentMonth,
  className,
}: {
  reference: string
  currentMonth: string
  className?: string
}) {
  return (
    <WidgetCard
      icon={Trophy}
      question={question(reference, currentMonth)}
      caption={<CaptionSkeleton className="w-52" />}
      className={className}
    >
      <Skeleton aria-hidden className="h-9 w-full rounded-xl" />
      <div aria-hidden className={cn('flex flex-col', LIST)}>
        {Array.from({ length: TOP }).map((_, i) => (
          <div key={i} className={ROW}>
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="mt-2 flex items-center gap-2.5">
                <Skeleton className="h-1.5 flex-1 rounded-full" />
                <Skeleton className="h-3 w-[7.5rem]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  )
}

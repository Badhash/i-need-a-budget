import { forwardRef, type CSSProperties, type PointerEventHandler } from 'react'
import { ArrowLeftRight, CalendarDays, MessageSquareText, UserRound } from 'lucide-react'
import type { Transaction } from '@/types/domain'
import { parseBankLabel } from '@/lib/bankLabel'
import { fmtDayLong } from '@/lib/format'
import { normalizeLabel } from '@/lib/rules'
import { TxKindChip } from '@/components/transactions/TxKindChip'
import { Amount } from '@/components/shared/Amount'
import { CategoryChip } from '@/components/rules/CategoryChip'
import { cn } from '@/lib/utils'

export interface TransferInfo {
  /** Compte de l'autre moitie du virement (compte de suivi). */
  otherAccount: string
}

interface TriageCardProps {
  tx: Transaction
  accountName?: string
  transfer?: TransferInfo | null
  /** Carte deja passee pendant la session (revue des passees). */
  skipped?: boolean
  /** Tampon affiche sur la carte qui s'en va (categorie choisie ou « Passée »). */
  stamp?: { kind: 'pick'; categoryId: string } | { kind: 'skip' } | null
  className?: string
  style?: CSSProperties
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerMove?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerCancel?: PointerEventHandler<HTMLDivElement>
}

/**
 * Carte d'une transaction a trier : type d'operation, compte, date, libelle
 * lisible (et brut), montant heros ; virement budget <-> suivi et contrepartie
 * quand ils existent. Sert aussi de carte « qui s'en va » (tampon).
 */
export const TriageCard = forwardRef<HTMLDivElement, TriageCardProps>(function TriageCard(
  { tx, accountName, transfer, skipped, stamp, className, style, ...pointer },
  ref,
) {
  const parsed = parseBankLabel(tx.label)
  const inflow = tx.amount > 0
  // Libelle brut et contrepartie seulement s'ils apprennent quelque chose.
  const squash = (s: string) => normalizeLabel(s).replace(/\s/g, '')
  const showRaw = squash(parsed.short) !== squash(tx.label)
  const counterparty =
    tx.counterparty && !squash(tx.label).includes(squash(tx.counterparty)) ? tx.counterparty : null
  return (
    <div
      ref={ref}
      style={style}
      {...pointer}
      className={cn(
        'relative select-none overflow-hidden rounded-3xl border border-edge bg-surface3 p-4 shadow-raised sm:p-5 lg:p-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-soft">
        <TxKindChip kind={parsed.kind} />
        {accountName && (
          <span className="inline-flex max-w-[60%] items-center truncate rounded-full bg-surface2 px-2.5 py-0.5 text-[12px] font-medium text-ink ring-1 ring-inset ring-edge">
            {accountName}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 tnum">
          <CalendarDays className="h-3.5 w-3.5" />
          {fmtDayLong(tx.date)}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 text-[21px] font-semibold leading-tight tracking-tight text-ink lg:mt-4 lg:text-[23px]">
        {parsed.short}
      </p>
      {showRaw && (
        <p className="mt-1 truncate font-mono text-[12px] text-soft" title={tx.label}>
          {tx.label}
        </p>
      )}

      <Amount cents={tx.amount} signed colored size="hero" className="mt-3 block lg:mt-4" />

      {(transfer || counterparty || tx.note || skipped) && (
        <div className="mt-3 space-y-1.5 text-[13px] leading-snug text-soft lg:mt-4">
          {transfer && (
            <p className="flex items-start gap-2">
              <ArrowLeftRight className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink dark:text-accent" />
              <span>
                {inflow ? (
                  <>
                    Virement depuis <strong className="font-medium text-ink">{transfer.otherAccount}</strong> : il
                    entre dans le budget (revenus ou enveloppe).
                  </>
                ) : (
                  <>
                    Virement vers <strong className="font-medium text-ink">{transfer.otherAccount}</strong> : il sort
                    du budget, choisis l'enveloppe qui le finance.
                  </>
                )}
              </span>
            </p>
          )}
          {counterparty && (
            <p className="flex items-center gap-2">
              <UserRound className="h-4 w-4 shrink-0" />
              <span className="truncate">{counterparty}</span>
            </p>
          )}
          {tx.note && (
            <p className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 shrink-0" />
              <span className="truncate">{tx.note}</span>
            </p>
          )}
          {skipped && <p className="text-[12.5px] italic">Passée une première fois pendant ce tri.</p>}
        </div>
      )}

      {stamp && (
        <div
          aria-hidden
          className={cn(
            'absolute right-4 top-4 flex rotate-[8deg] items-center gap-1.5 rounded-full px-1 py-1 shadow-raised ring-2',
            stamp.kind === 'pick' ? 'bg-surface3 ring-success/60' : 'bg-surface3 px-3 ring-soft/40',
          )}
        >
          {stamp.kind === 'pick' ? (
            <CategoryChip categoryId={stamp.categoryId} />
          ) : (
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-soft">Passée</span>
          )}
        </div>
      )}
    </div>
  )
})

/** Cartes suivantes esquissees sous la carte courante (profondeur du paquet). */
export function DeckLayers({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-x-3 -bottom-2 top-3 -z-10 rounded-3xl border border-edge bg-surface shadow-card"
      />
      {count > 1 && (
        <div
          aria-hidden
          className="absolute inset-x-6 -bottom-4 top-6 -z-20 rounded-3xl border border-edge bg-surface/70"
        />
      )}
    </>
  )
}

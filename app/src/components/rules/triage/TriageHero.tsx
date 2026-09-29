import { CheckCircle2, Info, SkipForward, Undo2, X } from 'lucide-react'
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber'
import { fmtPercent } from '@/lib/format'
import { ProgressRing } from '@/components/shared/ProgressRing'
import { CategoryChip } from '@/components/rules/CategoryChip'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type TriageReceipt =
  | { kind: 'pick'; label: string; categoryId: string }
  | { kind: 'skip'; label: string }

export interface PayeeSwitchState {
  /** Cle de tiers (rappelee a cote de la bascule). */
  payeeKey: string
  on: boolean
  onToggle: () => void
}

interface TriageHeroProps {
  remaining: number
  done: number
  receipt: TriageReceipt | null
  /** Bascule « Toujours pour ce tiers » (null : non applicable). */
  payeeSwitch: PayeeSwitchState | null
  /** Pourquoi la bascule est absente (revenus, virement, libelle sans tiers). */
  payeeNote: string | null
  showKeys: boolean
  onUndo: () => void
  onClose: () => void
}

/**
 * Heros du tri : compteur des transactions restantes (anime), anneau de
 * progression de la session, puis la derniere action (« Annuler », bascule
 * « Toujours pour ce tiers ») dans une zone de hauteur fixe : rien ne saute
 * sous le doigt d'une carte a l'autre. Desktop : une seule rangee.
 */
export function TriageHero({
  remaining,
  done,
  receipt,
  payeeSwitch,
  payeeNote,
  showKeys,
  onUndo,
  onClose,
}: TriageHeroProps) {
  const shown = useAnimatedNumber(remaining, 380)
  const total = remaining + done
  const ratio = total > 0 ? done / total : 0

  const counter = (
    <div className="flex min-w-0 items-center gap-4">
      <ProgressRing value={ratio} size={showKeys ? 64 : 54} strokeWidth={6} label="Progression du tri">
        <span className="text-[12px] font-semibold text-ink">{fmtPercent(ratio)}</span>
      </ProgressRing>
      <div className="min-w-0">
        <p className="label-caps">Tri rapide</p>
        <p className="mt-0.5 flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-[32px] font-semibold leading-none tracking-[-0.02em] text-ink tnum lg:text-[40px]">
            {shown}
          </span>
          <span className="text-[15px] text-soft">{remaining > 1 ? 'restantes' : 'restante'}</span>
        </p>
        {showKeys && (
          <p className="mt-1 h-4 text-[12.5px] leading-4 text-soft tnum">
            {done > 0 ? `${done} ${done > 1 ? 'triées' : 'triée'} pendant cette session` : ''}
          </p>
        )}
      </div>
    </div>
  )

  const receiptArea = receipt ? (
    <div key={`${receipt.kind}-${receipt.label}`} className="animate-fade-in space-y-1">
      <div className="flex min-h-8 items-center gap-2">
        {receipt.kind === 'pick' ? (
          <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-success" />
        ) : (
          <SkipForward className="h-[18px] w-[18px] shrink-0 text-soft" />
        )}
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px] text-ink">
          <span className="truncate">{receipt.label}</span>
          {receipt.kind === 'pick' ? (
            <CategoryChip categoryId={receipt.categoryId} size="sm" className="max-w-[55%] shrink-0" />
          ) : (
            <span className="shrink-0 text-soft">passée</span>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onUndo}
          className="shrink-0 gap-1.5 text-accent-ink after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] dark:text-accent lg:after:hidden"
        >
          <Undo2 className="h-4 w-4" />
          Annuler
          {showKeys && <Kbd>U</Kbd>}
        </Button>
      </div>
      {payeeSwitch ? (
        <button
          type="button"
          role="switch"
          aria-checked={payeeSwitch.on}
          onClick={payeeSwitch.onToggle}
          className="relative flex min-h-9 max-w-full items-center gap-2.5 rounded-xl pr-2 text-left after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] lg:after:hidden"
        >
          <span
            aria-hidden
            className={cn(
              'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 ring-1 ring-inset transition-colors duration-200',
              payeeSwitch.on ? 'bg-brand ring-transparent' : 'bg-ink/10 ring-edge',
            )}
          >
            <span
              className={cn(
                'h-5 w-5 rounded-full bg-surface shadow-card transition-transform duration-200 ease-spring',
                payeeSwitch.on ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </span>
          <span className="shrink-0 text-[13.5px] font-medium text-ink">Toujours pour ce tiers</span>
          <span className="truncate text-[12.5px] text-soft">« {payeeSwitch.payeeKey} »</span>
        </button>
      ) : (
        <p className="flex min-h-9 items-center gap-2 text-[12.5px] leading-snug text-soft">
          <Info className="h-4 w-4 shrink-0" />
          {receipt.kind === 'skip' ? 'Elle reviendra en fin de tri.' : payeeNote}
        </p>
      )}
    </div>
  ) : (
    <p className="text-[13px] leading-snug text-soft">
      {showKeys
        ? 'Choisis une catégorie : la transaction suivante arrive aussitôt. Chaque choix est annulable.'
        : 'Touche une catégorie, ou glisse la carte à gauche pour la passer.'}
    </p>
  )

  return (
    <Card variant="hero" className="p-4 sm:p-5">
      {showKeys ? (
        <div className="flex items-center gap-6">
          {counter}
          <div
            role="status"
            aria-live="polite"
            className="flex min-h-[88px] min-w-0 flex-1 flex-col justify-center border-l border-line/70 pl-6"
          >
            {receiptArea}
          </div>
          <Button variant="ghost" size="icon" aria-label="Fermer le tri" onClick={onClose} className="self-start">
            <X className="h-5 w-5" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">{counter}</div>
            <Button variant="ghost" size="icon" aria-label="Fermer le tri" onClick={onClose} className="-mr-1 -mt-1">
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div
            role="status"
            aria-live="polite"
            className="mt-3 flex min-h-[80px] flex-col justify-center border-t border-line/70 pt-2"
          >
            {receiptArea}
          </div>
        </>
      )}
    </Card>
  )
}

export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-surface2 px-1 font-sans text-[11px] font-semibold text-soft shadow-[inset_0_-1px_0_rgb(var(--ink)/0.08)]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

import { useMemo, useState } from 'react'
import { Moon } from 'lucide-react'
import { useTransactions } from '@/lib/queries'
import { evalAmountCents, fmtDateNumeric, fmtEUR, today } from '@/lib/format'
import { Amount } from '@/components/shared/Amount'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { WidgetCard } from '@/components/reports/WidgetCard'

// Zakat : independante du mois affiche (date de calcul et nisab choisis par
// l'utilisateur, memorises sur l'appareil).
const ZAKAT_RATE = 0.025
const ZAKAT_RATE_SOLAR = 0.02577
const USER_RATE = 0.03
const NISAB_KEY = 'inab-zakat-nisab'
const ZAKAT_DATE_KEY = 'inab-zakat-date'

function readLS(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* stockage indisponible */
  }
}

function eurToCents(input: string): number {
  // Parser strict partage (symbole euro tolere) : « 1.234,56 » n'est plus lu 1,23.
  return evalAmountCents(input.replace(/€/g, '')) ?? 0
}

export function ZakatWidget({ className }: { className?: string }) {
  const { data: txs } = useTransactions()
  const [date, setDate] = useState(() => readLS(ZAKAT_DATE_KEY, `${today().slice(0, 4)}-01-01`))
  const [nisab, setNisab] = useState(() => readLS(NISAB_KEY, ''))

  // Valeur nette a la date choisie : somme de toutes les transactions (tous
  // comptes) jusqu'a cette date.
  const base = useMemo(() => {
    let sum = 0
    for (const t of txs ?? []) {
      if (t.date <= date) sum += t.amount
    }
    return sum
  }, [txs, date])

  const nisabCents = eurToCents(nisab)
  const hasNisab = nisabCents > 0
  const belowNisab = hasNisab && base < nisabCents
  const zakatBase = base > 0 && !belowNisab ? base : 0
  const due = Math.round(zakatBase * ZAKAT_RATE)

  return (
    <WidgetCard
      icon={Moon}
      question="Combien de Zakat dois-je verser ?"
      caption="Indépendant du mois affiché"
      action={
        <Badge variant="accent" className="py-1 font-semibold">
          2,5 % du net
        </Badge>
      }
      className={className}
    >
      <div>
        <Amount cents={due} animate className="block text-[26px] font-semibold tracking-[-0.015em]" />
        {belowNisab ? (
          <p className="mt-0.5 text-[12.5px] text-soft">
            En dessous du nisab (<span className="tnum">{fmtEUR(nisabCents)}</span>) au {fmtDateNumeric(date)} : aucune
            zakât due.
          </p>
        ) : (
          <p className="mt-0.5 text-[12.5px] text-soft">
            Sur une valeur nette de <Amount cents={base} className="font-medium text-ink" /> au {fmtDateNumeric(date)}.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">Date de calcul</span>
          <Input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => {
              setDate(e.target.value)
              writeLS(ZAKAT_DATE_KEY, e.target.value)
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">Nisab (85 g d’or, €)</span>
          <Input
            type="text"
            inputMode="decimal"
            value={nisab}
            placeholder="ex. 6 000"
            onChange={(e) => {
              setNisab(e.target.value)
              writeLS(NISAB_KEY, e.target.value)
            }}
          />
        </label>
      </div>

      <div className="space-y-1.5 border-t border-line/70 pt-3 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-soft">Année solaire (2,577 %)</span>
          <Amount cents={Math.round(zakatBase * ZAKAT_RATE_SOLAR)} className="font-medium text-ink" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-soft">Ta méthode (3 %)</span>
          <Amount cents={Math.round((base > 0 ? base : 0) * USER_RATE)} className="font-medium text-ink" />
        </div>
      </div>

      {!hasNisab && (
        <p className="text-[12px] leading-relaxed text-soft">
          Renseigne le nisab (valeur de 85 g d’or du moment) pour savoir si tu dépasses le seuil.
        </p>
      )}
    </WidgetCard>
  )
}

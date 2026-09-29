import { useCallback, useState, type ReactNode } from 'react'
import {
  DEFAULT_REPORT_PERIOD,
  monthsRangePhrase,
  REPORT_PERIODS,
  type ReportPeriod,
} from '@/lib/analytics'
import { SegmentedControl } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'

// Periode memorisee PAR APPAREIL (preference de lecture, pas une donnee du
// budget) : stockage local, tolerant a son absence (navigation privee).
const STORAGE_KEY = 'inab-reports-period'

function readPeriod(): ReportPeriod {
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEY))
    return (REPORT_PERIODS as readonly number[]).includes(raw) ? (raw as ReportPeriod) : DEFAULT_REPORT_PERIOD
  } catch {
    return DEFAULT_REPORT_PERIOD
  }
}

export function useReportPeriod(): [ReportPeriod, (period: ReportPeriod) => void] {
  const [period, setPeriod] = useState<ReportPeriod>(readPeriod)
  const update = useCallback((next: ReportPeriod) => {
    setPeriod(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      /* stockage indisponible : la periode vaut pour la session */
    }
  }, [])
  return [period, update]
}

const OPTIONS = REPORT_PERIODS.map((p) => ({ value: String(p) as `${ReportPeriod}`, label: `${p} mois` }))

/** Phrase de comparaison : 'Comparé à la moyenne de mars à août 2026.' */
export function comparisonPhrase(averageMonths: string[], period: ReportPeriod): string {
  if (averageMonths.length === 0) return 'Pas encore d’historique pour comparer : les moyennes arriveront le mois prochain.'
  const range = monthsRangePhrase(averageMonths[0]!, averageMonths[averageMonths.length - 1]!)
  const short = averageMonths.length < period ? ` (${averageMonths.length} mois d’historique)` : ''
  return `Comparé à la moyenne ${range}${short}.`
}

/**
 * Filtre de periode, AU-DESSUS de tout ce qu'il pilote (moyennes, tableau des
 * categories, graphes de tendance) : 3, 6 ou 12 mois precedant le mois affiche.
 */
export function PeriodToolbar({
  period,
  onChange,
  caption,
  className,
}: {
  period: ReportPeriod
  onChange: (period: ReportPeriod) => void
  caption: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6', className)}>
      <div className="order-2 min-w-0 px-1 lg:order-1">
        <p className="hidden text-[15px] font-semibold tracking-tight text-ink lg:block">Moyennes et tendances</p>
        <p className="text-center text-[12.5px] leading-snug text-soft lg:mt-0.5 lg:text-left lg:text-[13.5px]">{caption}</p>
      </div>
      <SegmentedControl
        aria-label="Période de comparaison"
        options={OPTIONS}
        value={String(period) as `${ReportPeriod}`}
        onChange={(v) => onChange(Number(v) as ReportPeriod)}
        className="order-1 w-full lg:order-2 lg:w-auto lg:min-w-[19rem]"
      />
    </div>
  )
}

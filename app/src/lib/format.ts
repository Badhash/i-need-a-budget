// Formatage fr-FR : montants en centimes -> "1 234,56 €", dates, mois.

export const MIN_MONTH = '2026-02'
export const MAX_MONTH = '2026-12'
export const CURRENT_MONTH = '2026-07'
export const TODAY = '2026-07-12'

const eur = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

const eurSigned = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  signDisplay: 'always',
})

export function fmtEUR(cents: number): string {
  return eur.format(cents / 100)
}

export function fmtEURSigned(cents: number): string {
  return eurSigned.format(cents / 100)
}

export function fmtPercent(ratio: number, digits = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(ratio)
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** '2026-07' -> 'juillet 2026' */
export function fmtMonthLong(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** '2026-07' -> 'Juillet 2026' */
export function fmtMonthTitle(month: string): string {
  return capitalize(fmtMonthLong(month))
}

/** '2026-07' -> 'juil.' */
export function fmtMonthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  return d.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })
}

/** '2026-07-12' -> 'Samedi 12 juillet' */
export function fmtDayLong(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  return capitalize(
    d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
  )
}

/** '2026-07-12' -> '12 juil.' */
export function fmtDateShort(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** '2026-07-12' -> '2026-07' */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** addMonths('2026-07', -1) -> '2026-06' */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

/** Liste des mois de a a b inclus */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  while (cur <= to) {
    out.push(cur)
    cur = addMonths(cur, 1)
  }
  return out
}

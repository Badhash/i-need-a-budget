// Formatage fr-FR : montants en centimes -> "1 234,56 €", dates, mois.

// Dates dynamiques (fuseau local) : l'app doit rester juste au fil des jours.
function isoLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export const TODAY = isoLocal(new Date())
export const CURRENT_MONTH = TODAY.slice(0, 7)
export const MIN_MONTH = '2026-02'
// Assignation sur les mois futurs autorisee : horizon glissant de 6 mois.
export const MAX_MONTH = isoLocal(new Date(new Date().getFullYear(), new Date().getMonth() + 6, 1)).slice(0, 7)

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

const relTime = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' })

/**
 * Horodatage ISO -> distance relative en francais ("il y a 3 heures", "hier").
 * Compare deux instants absolus : independant du fuseau. Renvoie null si la date
 * est invalide. Une date dans le futur (dérive d'horloge) retombe sur "à l'instant".
 */
export function fmtRelativeTime(iso: string): string | null {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const sec = Math.round((Date.now() - then) / 1000)
  if (Math.abs(sec) < 60) return "à l'instant"
  const min = Math.round(sec / 60)
  if (Math.abs(min) < 60) return relTime.format(-min, 'minute')
  const hr = Math.round(sec / 3600)
  if (Math.abs(hr) < 24) return relTime.format(-hr, 'hour')
  const day = Math.round(sec / 86400)
  return relTime.format(-day, 'day')
}

/**
 * Horodatage ISO -> date + heure lisibles au fuseau Europe/Paris ("12 juil. 07:30").
 * L'affichage absolu est fige sur Paris (fuseau de l'utilisateur), independamment
 * du fuseau de l'appareil. Renvoie null si la date est invalide.
 */
export function fmtDateTimeParis(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  })
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

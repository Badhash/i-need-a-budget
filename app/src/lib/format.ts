// Formatage fr-FR : montants en centimes -> "1 234,56 €", dates, mois.

// Dates dynamiques (fuseau local) : l'app doit rester juste au fil des jours.
// Date du jour au fuseau Europe/Paris, comme le serveur (todayParis dans
// /api). Avec l'heure de l'appareil, un telephone dans un autre fuseau
// divergeait du serveur autour de minuit : mois courant, badge « À
// catégoriser », date de saisie refusee comme future.
const parisDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function isoParis(d: Date): string {
  const parts = parisDate.formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// FONCTIONS et non constantes de module : une PWA iOS reste residente des
// jours durant, une constante figee au chargement ferait basculer la date du
// jour, le mois courant et l'horizon d'assignation sur ceux du lancement
// (date de saisie « hier », aujourd'hui refuse comme futur, mois non remis a
// jour au 1er). Chaque appel relit l'horloge.
export function today(): string {
  return isoParis(new Date())
}
export function currentMonth(): string {
  return today().slice(0, 7)
}
export const MIN_MONTH = '2026-02'
// Assignation sur les mois futurs autorisee : horizon glissant de 6 mois.
export function maxMonth(): string {
  return addMonths(currentMonth(), 6)
}

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
  if (!Number.isFinite(cents)) return '—'
  // -0 (ex. -activity d'un mois sans mouvement) s'afficherait « -0,00 € ».
  return eur.format((cents === 0 ? 0 : cents) / 100)
}

export function fmtEURSigned(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  // Zero n'a pas de signe : « +0,00 € » (ou « -0,00 € » pour -0) n'a aucun sens.
  if (cents === 0) return eur.format(0)
  return eurSigned.format(cents / 100)
}

export function fmtPercent(ratio: number, digits = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(ratio)
}

/**
 * Evalue un montant saisi qui peut contenir une expression arithmetique simple :
 * "200,00+152" -> 352 (euros), "50*3" -> 150, "(20+5)*2" -> 50. Supporte + - * /
 * et parentheses, virgule OU point comme separateur decimal, espaces ignores.
 * Renvoie null si l'expression est invalide. Sert aux champs de montant du budget
 * (saisie rapide type "loyer + courses"). Parser recursif maison : aucun eval(),
 * seuls chiffres et operateurs sont acceptes.
 */
export function evalAmountExpr(raw: string): number | null {
  // Tolere ce que l'app affiche elle-meme et ce qu'un collage apporte : espaces
  // (insecables compris), symbole euro, signe moins typographique (U+2212).
  const s = raw.replace(/[\s€]/g, '').replace(/\u2212/g, '-')
  if (s === '') return 0
  // Un « - » seul est une saisie en cours, pas zero : le valider remettait le
  // montant a 0 (assignation, ajustement de solde).
  if (s === '-') return null
  if (!/^[0-9.,+\-*/()]+$/.test(s)) return null

  let pos = 0
  const peek = () => s[pos]

  function parseExpr(): number {
    let v = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = s[pos++]
      const r = parseTerm()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  function parseTerm(): number {
    let v = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = s[pos++]
      const r = parseFactor()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  function parseFactor(): number {
    if (peek() === '+') {
      pos++
      return parseFactor()
    }
    if (peek() === '-') {
      pos++
      return -parseFactor()
    }
    if (peek() === '(') {
      pos++
      const v = parseExpr()
      if (peek() !== ')') throw new Error('parenthese non fermee')
      pos++
      return v
    }
    const start = pos
    while (pos < s.length && /[0-9.,]/.test(s[pos])) pos++
    if (pos === start) throw new Error('nombre attendu')
    return parseNumberToken(s.slice(start, pos))
  }

  try {
    const v = parseExpr()
    if (pos !== s.length) return null
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Lit un nombre saisi a la francaise. Leve si la saisie est invalide ou AMBIGUE :
 * mieux vaut refuser un montant que d'en enregistrer un faux.
 *   "12,5" / "12.5" / "5," -> decimal ; "1.234,56" -> 1234,56 (points de milliers)
 *   "1.000" / "12.345"     -> refuse : mille euros ou un euro ? (le point etait
 *                             lu comme decimale, soit 1,00 EUR pour un loyer)
 */
function parseNumberToken(token: string): number {
  let normalized: string
  if (token.includes(',')) {
    // Virgule = decimale. Les points eventuels doivent etre des milliers.
    const [whole, frac, ...rest] = token.split(',')
    if (rest.length > 0) throw new Error('nombre invalide')
    if (whole.includes('.') && !/^\d{1,3}(?:\.\d{3})+$/.test(whole)) throw new Error('nombre invalide')
    if (frac.includes('.')) throw new Error('nombre invalide')
    normalized = `${whole.replace(/\./g, '')}.${frac}`
  } else {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(token)) throw new Error('nombre ambigu')
    normalized = token
  }
  // Un seul separateur decimal ; un separateur final (« 5, ») est tolere.
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) throw new Error('nombre invalide')
  const num = Number.parseFloat(normalized)
  if (Number.isNaN(num)) throw new Error('nombre invalide')
  return num
}

/**
 * Comme evalAmountExpr mais renvoie des CENTIMES entiers (arrondi au centime).
 * Renvoie null si l'expression est invalide.
 */
export function evalAmountCents(raw: string): number | null {
  const euros = evalAmountExpr(raw)
  // « + 0 » : ramene -0 (ex. « -0,001 ») a 0.
  return euros === null ? null : Math.round(euros * 100) + 0
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

/** '2026-07-12' -> '12/07/2026' (fuseau fixe : une date seule ne glisse jamais d'un jour). */
export function fmtDateNumeric(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  return d.toLocaleDateString('fr-FR', { timeZone: 'UTC' })
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

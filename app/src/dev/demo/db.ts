// Mode demonstration : modele de la base en memoire et utilitaires partages
// (PRNG a graine, identifiants, dates). Les lignes reprennent EXACTEMENT les
// payloads dechiffres de l'Edge Function /api (contrat du CLAUDE.md), plus
// quelques colonnes techniques en clair (txHash) jamais renvoyees au front.

export type AccountKind = 'checking' | 'savings' | 'investment' | 'card_deferred'
export const ACCOUNT_KINDS: readonly AccountKind[] = ['checking', 'savings', 'investment', 'card_deferred']

export interface DemoAccount {
  id: string
  name: string
  institution: string
  kind: AccountKind
  onBudget: boolean
  closed: boolean
  connectionId: string | null
  providerAccountUid: string | null
}

export interface DemoGroup {
  id: string
  name: string
  color: string
  icon: string
  sortOrder: number
  hidden: boolean
}

export interface DemoCategory {
  id: string
  groupId: string
  name: string
  isIncome: boolean
  sortOrder: number
  hidden: boolean
}

export interface DemoTransaction {
  id: string
  accountId: string
  categoryId: string | null
  bookingDate: string // YYYY-MM-DD
  bookingMonth: string // YYYY-MM
  amount: number // centimes, negatif = depense
  label: string
  counterparty: string | null
  transferGroupId: string | null
  notes: string | null
  /** Colonne en clair cote serveur : non nul = import bancaire (jamais expose). */
  txHash: string | null
}

export interface DemoAssignment {
  id: string
  categoryId: string
  month: string
  amount: number
}

export type TargetType = 'monthly' | 'byDate' | 'refill'

export interface DemoTarget {
  id: string
  categoryId: string
  type: TargetType
  amount: number
  dueMonth: string | null
}

export type RuleOp = 'contains' | 'equals' | 'startsWith'
export const RULE_OPS: readonly RuleOp[] = ['contains', 'equals', 'startsWith']

export interface DemoRule {
  id: string
  matcher: { field: 'label'; op: RuleOp; value: string }
  categoryId: string
  priority: number
}

export interface DemoPayee {
  key: string
  categoryId: string
  /** 3 dernieres categories choisies, plus recente en tete. */
  history: string[]
}

export interface DemoBankConnection {
  id: string
  institution: string
  validUntil: string | null
  sessionState: string
  accounts: { uid: string; name?: string; iban?: string; product?: string }[]
}

export interface DemoSyncLog {
  id: string
  runAt: string
  status: 'ok' | 'error'
  importedCount: number
  error: string | null
  connectionId: string | null
}

export interface DemoDb {
  accounts: DemoAccount[]
  groups: DemoGroup[]
  categories: DemoCategory[]
  transactions: DemoTransaction[]
  assignments: DemoAssignment[]
  targets: DemoTarget[]
  rules: DemoRule[]
  /** Memoire de tiers (REF N), ordre d'insertion conserve. */
  payees: DemoPayee[]
  bankConnections: DemoBankConnection[]
  syncLogs: DemoSyncLog[]
  budgetStartMonth: string | null
}

// ---------------------------------------------------------------------------
// Aleatoire deterministe
// ---------------------------------------------------------------------------

/** PRNG mulberry32 : rapide, 32 bits, suffisant pour un jeu de demonstration. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hachage FNV-1a 32 bits (graine derivee d'un nom stable). */
function fnv1a(s: string, offset = 0x811c9dc5): number {
  let h = offset >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function toUuid(bytes: number[]): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variante RFC 4122
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * UUID v4 DETERMINISTE derive d'un nom : les identifiants du jeu de donnees
 * restent identiques d'un lancement a l'autre (liens de captures stables).
 */
export function stableUuid(name: string): string {
  const a = mulberry32(fnv1a(name))
  const b = mulberry32(fnv1a(name, 0x01234567))
  const bytes: number[] = []
  for (let i = 0; i < 16; i++) bytes.push(Math.floor((i % 2 === 0 ? a() : b()) * 256))
  return toUuid(bytes)
}

/** UUID v4 aleatoire pour les entites creees pendant la session. */
export function randomUuid(): string {
  const bytes: number[] = []
  for (let i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 256))
  return toUuid(bytes)
}

// ---------------------------------------------------------------------------
// Dates (fuseau local de l'appareil, comme le front)
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0')

export function isoLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Jour `day` du mois (borne au dernier jour du mois). */
export function dateInMonth(month: string, day: number): string {
  return `${month}-${pad2(Math.max(1, Math.min(day, daysInMonth(month))))}`
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return isoLocalDate(new Date(y, m - 1, d + delta))
}

/** 0 = dimanche ... 6 = samedi. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** Jour ouvre (lundi-vendredi) le plus proche AVANT ou egal a la date. */
export function businessDayOnOrBefore(date: string): string {
  let cur = date
  while (weekdayOf(cur) === 0 || weekdayOf(cur) === 6) cur = addDays(cur, -1)
  return cur
}

/** « 12/09 » : date d'achat telle qu'imprimee dans un libelle carte. */
export function ddmm(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

/**
 * Horodatage ISO (UTC) d'une heure donnee a Paris, heure d'ete/hiver comprise :
 * sert aux runs de synchronisation (07:30 et 19:30 Europe/Paris).
 */
export function parisTimeToIso(date: string, hour: number, minute: number, second = 0): string {
  const guess = new Date(`${date}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}Z`)
  const parisHour = Number(
    guess.toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }),
  )
  let offset = parisHour - hour
  if (offset > 12) offset -= 24
  if (offset < -12) offset += 24
  return new Date(guess.getTime() - offset * 3_600_000).toISOString()
}

/** Copie profonde JSON : reponses et parametres voyagent comme sur le reseau. */
export function jsonClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

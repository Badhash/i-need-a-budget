import type { Account, Category, CategoryGroup, Transaction } from '@/types/domain'
import { parseBankLabel, type ParsedLabel } from '@/lib/bankLabel'
import { isUnconfirmedTx } from '@/lib/transactions'
import { txRowKey } from '@/lib/txIds'

export interface TxRow {
  tx: Transaction
  /** Cle React stable (l'id temporaire d'un ajout survit a sa confirmation). */
  key: string
  account: Account
  category: Category | null
  group: CategoryGroup | null
  parsed: ParsedLabel
  /** Nom affiche (libelle court sans prefixe de moyen de paiement). */
  name: string
  /** Moitie cote budget d'un virement budget <-> suivi (serveur recent) : categorisable. */
  cross: boolean
  /** Autre compte d'un virement, si la moitie miroir est connue. */
  peerAccount: Account | null
  /** Compte dans le badge « À catégoriser ». */
  uncategorized: boolean
  /** Creation en vol : suppression et conversion attendent la confirmation. */
  pending: boolean
}

export type Maps = {
  accountById: Map<string, Account>
  categoryById: Map<string, Category>
  groupById: Map<string, CategoryGroup>
}

/** Contexte optionnel : virements croises, miroirs et badge (calcules par la page). */
export interface RowContext {
  isCross?: (t: Transaction) => boolean
  peerOf?: (t: Transaction) => Transaction | undefined
  isUncat?: (t: Transaction) => boolean
}

// Prefixes de moyen de paiement frequents dans les exports bancaires francais
// (affichage seulement : le libelle brut reste la source de verite).
const QUALIFIER = String.raw`(?:sepa|inst(?:antan[eé])?|re[cç]u|[eé]mis)`
const PAYMENT_PREFIX = new RegExp(
  String.raw`^(?:(?:paiement|achat)\s+)?(?:cb|carte\s+x\d{4}|prlv(?:\s+sepa)?|pr[eé]l[eè]vement\s+sepa|vir(?:\s+${QUALIFIER})*(?:\s+(?:de|du|des|vers))?|virement(?:\s+${QUALIFIER})+(?:\s+(?:de|du|des|vers))?)\s+`,
  'i',
)

/** Libelle court debarrasse de son prefixe de paiement (« CB Leroy Merlin » -> « Leroy Merlin »). */
export function merchantName(parsed: ParsedLabel): string {
  const stripped = parsed.short.replace(PAYMENT_PREFIX, '').trim()
  if (!stripped || stripped === '…') return parsed.short
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

/** Initiale affichee dans la pastille d'une ligne sans categorie. */
export function merchantInitial(name: string): string {
  const m = name.normalize('NFD').match(/[a-z0-9]/i)
  return m ? m[0].toUpperCase() : '?'
}

// Analyse d'un libelle memorisee : les libelles se repetent (un marchand, un
// prelevement mensuel) et la liste est recalculee a chaque action.
const labelCache = new Map<string, { parsed: ParsedLabel; name: string }>()
const LABEL_CACHE_MAX = 5000

// Libelle saisi a la main (minuscules majoritaires, « Boulangerie du coin ») :
// affiche tel quel, sans la casse titre destinee aux libelles bancaires.
function isHandwritten(label: string): boolean {
  const letters = label.replace(/[^a-zA-ZÀ-ÿ]/g, '')
  if (letters.length === 0) return false
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, '').length
  return upper / letters.length < 0.4 && label.trim().length <= 48
}

function readLabel(label: string): { parsed: ParsedLabel; name: string } {
  const hit = labelCache.get(label)
  if (hit) return hit
  const parsed = parseBankLabel(label)
  const entry = { parsed, name: isHandwritten(label) ? label.trim() : merchantName(parsed) }
  if (labelCache.size >= LABEL_CACHE_MAX) labelCache.clear()
  labelCache.set(label, entry)
  return entry
}

export function toRow(tx: Transaction, maps: Maps, ctx: RowContext = {}): TxRow | null {
  const account = maps.accountById.get(tx.accountId)
  if (!account) return null
  const category = tx.categoryId ? (maps.categoryById.get(tx.categoryId) ?? null) : null
  const group = category ? (maps.groupById.get(category.groupId) ?? null) : null
  const { parsed, name } = readLabel(tx.label)
  const peer = tx.transferGroupId ? ctx.peerOf?.(tx) : undefined
  return {
    tx,
    key: txRowKey(tx.id),
    account,
    category,
    group,
    parsed,
    name,
    cross: ctx.isCross?.(tx) ?? false,
    peerAccount: peer ? (maps.accountById.get(peer.accountId) ?? null) : null,
    uncategorized: ctx.isUncat?.(tx) ?? false,
    pending: isUnconfirmedTx(tx.id),
  }
}

/** Ligne categorisable : compte budget, hors virement (sauf moitie croisee). */
export function canCategorize(row: TxRow): boolean {
  return row.account.onBudget && (!row.tx.transferGroupId || row.cross)
}

/** Ligne selectionnable (categorisation en lot) : categorisable et confirmee. */
export function canSelect(row: TxRow): boolean {
  return canCategorize(row) && !row.pending
}

/** Ligne secondaire discrete : contrepartie et/ou note, quand elles existent. */
export function detailLine(row: TxRow): string | null {
  const parts: string[] = []
  // Contrepartie deja lisible dans le nom affiche (« Salaire ACME SAS » /
  // « ACME SAS ») : pas de redite.
  const counterparty = row.tx.counterparty?.trim()
  const name = normSearch(row.name)
  const party = counterparty ? normSearch(counterparty) : ''
  if (counterparty && !name.includes(party) && !party.includes(name)) parts.push(counterparty)
  const note = row.tx.note?.trim()
  if (note) parts.push(note)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Libelle d'un virement : sens et compte miroir (« Vers Livret A »). */
export function transferLabel(row: TxRow): string {
  if (!row.peerAccount) return 'Virement'
  return row.tx.amount < 0 ? `Vers ${row.peerAccount.name}` : `Depuis ${row.peerAccount.name}`
}

export const PAGE_SIZE = 50

/** Recherche insensible a la casse ET aux accents (« epargne » trouve « Épargne »). */
export function normSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export const MOBILE_CHUNK = 50

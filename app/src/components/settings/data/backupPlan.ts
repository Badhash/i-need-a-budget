// Restauration d'une sauvegarde : lecture du JSON produit par l'export
// (action exportData : exportedAt, budgetStartMonth, accounts, groups,
// categories, transactions, assignments, targets, rules, payees, chaque
// element avec son id) et traduction en plan de remplacement, execute par le
// meme orchestrateur que l'import YNAB (lib/ynabImport.ts). Rien n'est
// envoye ici : lecture et validation locales uniquement.

import type { AccountKind, GroupIcon } from '@/types/domain'
import type { CatColor } from '@/styles/themes'
import type { BankConnection } from '@/lib/bank'
import { fmtMonthLong } from '@/lib/format'
import {
  DATE_RE,
  MONTH_RE,
  isRestorableStartMonth,
  newUuid,
  optionalText,
  requiredText,
  type ImportPlan,
  type PlanAccount,
  type PlanAssignment,
  type PlanCategory,
  type PlanGroup,
  type PlanRule,
  type PlanTarget,
  type PlanTransaction,
} from '@/lib/ynabImport'

const ACCOUNT_KINDS: AccountKind[] = ['checking', 'savings', 'investment', 'card_deferred']
const COLORS: CatColor[] = ['blue', 'green', 'amber', 'pink', 'purple', 'teal']
const ICONS: GroupIcon[] = ['home', 'car', 'sparkles', 'repeat', 'piggy', 'banknote']
const RULE_OPS = ['contains', 'equals', 'startsWith'] as const
const TARGET_TYPES = ['monthly', 'byDate', 'refill'] as const

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)

interface BAccount {
  id: string
  name: string
  institution: string | null
  kind: AccountKind | null
  onBudget: boolean
  closed: boolean
  connectionId: string | null
  providerAccountUid: string | null
}
interface BGroup {
  id: string
  name: string
  color: CatColor | null
  icon: GroupIcon | null
  sortOrder: number
  hidden: boolean
}
interface BCategory {
  id: string
  groupId: string | null
  name: string
  isIncome: boolean
  sortOrder: number
  hidden: boolean
}
interface BTransaction {
  accountId: string
  categoryId: string | null
  date: string
  amount: number
  label: unknown
  counterparty: unknown
  notes: unknown
  transferGroupId: string | null
}
interface BAssignment {
  categoryId: string
  month: string
  amount: number
}
interface BTarget {
  categoryId: string
  type: (typeof TARGET_TYPES)[number]
  amount: number
  dueMonth: string | null
}
interface BRule {
  categoryId: string
  op: (typeof RULE_OPS)[number]
  value: string
  priority: number | null
}

export interface ParsedBackup {
  exportedAt: string | null
  budgetStartMonth: string | null
  accounts: BAccount[]
  groups: BGroup[]
  categories: BCategory[]
  transactions: BTransaction[]
  assignments: BAssignment[]
  targets: BTarget[]
  rules: BRule[]
  payees: number
  /** Elements illisibles ecartes a la lecture. */
  invalid: number
  dateRange: { min: string; max: string } | null
}

function list(root: Obj, key: string, required: boolean): unknown[] {
  const v = root[key]
  if (Array.isArray(v)) return v
  if (required)
    throw new Error(
      'Ce fichier ne ressemble pas à une sauvegarde de l’app : comptes, catégories ou transactions manquants.',
    )
  return []
}

/** Lit et valide une sauvegarde JSON ; leve une erreur lisible sinon. */
export function parseBackup(text: string): ParsedBackup {
  let root: unknown
  try {
    root = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    throw new Error('Ce fichier n’est pas un JSON lisible. Choisis une sauvegarde exportée depuis l’app.')
  }
  if (!isObj(root)) throw new Error('Ce fichier ne ressemble pas à une sauvegarde de l’app.')
  let invalid = 0
  const keep = <T>(raw: unknown[], read: (o: Obj) => T | null): T[] => {
    const out: T[] = []
    for (const item of raw) {
      const v = isObj(item) ? read(item) : null
      if (v === null) invalid++
      else out.push(v)
    }
    return out
  }

  const accounts = keep(list(root, 'accounts', true), (o): BAccount | null => {
    const id = str(o.id)
    const name = str(o.name)
    if (!id || !name) return null
    return {
      id,
      name,
      institution: str(o.institution),
      kind: ACCOUNT_KINDS.includes(o.kind as AccountKind) ? (o.kind as AccountKind) : null,
      onBudget: o.onBudget !== false,
      closed: o.closed === true,
      connectionId: str(o.connectionId),
      providerAccountUid: str(o.providerAccountUid),
    }
  })
  const groups = keep(list(root, 'groups', true), (o): BGroup | null => {
    const id = str(o.id)
    const name = str(o.name)
    if (!id || !name) return null
    return {
      id,
      name,
      color: COLORS.includes(o.color as CatColor) ? (o.color as CatColor) : null,
      icon: ICONS.includes(o.icon as GroupIcon) ? (o.icon as GroupIcon) : null,
      sortOrder: typeof o.sortOrder === 'number' ? o.sortOrder : 0,
      hidden: o.hidden === true,
    }
  })
  const categories = keep(list(root, 'categories', true), (o): BCategory | null => {
    const id = str(o.id)
    const name = str(o.name)
    if (!id || !name) return null
    return {
      id,
      groupId: str(o.groupId),
      name,
      isIncome: o.isIncome === true,
      sortOrder: typeof o.sortOrder === 'number' ? o.sortOrder : 0,
      hidden: o.hidden === true,
    }
  })
  let minDate: string | null = null
  let maxDate: string | null = null
  const transactions = keep(list(root, 'transactions', true), (o): BTransaction | null => {
    const accountId = str(o.accountId)
    const date = typeof o.bookingDate === 'string' ? o.bookingDate : typeof o.date === 'string' ? o.date : ''
    const amount = int(o.amount)
    if (!accountId || !DATE_RE.test(date) || amount === null) return null
    if (!minDate || date < minDate) minDate = date
    if (!maxDate || date > maxDate) maxDate = date
    return {
      accountId,
      categoryId: str(o.categoryId),
      date,
      amount,
      label: o.label,
      counterparty: o.counterparty,
      notes: o.notes ?? o.note,
      transferGroupId: str(o.transferGroupId),
    }
  })
  const assignments = keep(list(root, 'assignments', false), (o): BAssignment | null => {
    const categoryId = str(o.categoryId)
    const month = typeof o.month === 'string' ? o.month : ''
    const amount = int(o.amount)
    if (!categoryId || !MONTH_RE.test(month) || amount === null) return null
    return { categoryId, month, amount }
  })
  const targets = keep(list(root, 'targets', false), (o): BTarget | null => {
    const categoryId = str(o.categoryId)
    const amount = int(o.amount)
    const type = TARGET_TYPES.find((t) => t === o.type)
    if (!categoryId || !type || amount === null || amount <= 0) return null
    const dueMonth = typeof o.dueMonth === 'string' && MONTH_RE.test(o.dueMonth) ? o.dueMonth : null
    if (type === 'byDate' && !dueMonth) return null
    return { categoryId, type, amount, dueMonth: type === 'byDate' ? dueMonth : null }
  })
  const rules = keep(list(root, 'rules', false), (o): BRule | null => {
    const categoryId = str(o.categoryId)
    const matcher = isObj(o.matcher) ? o.matcher : null
    const op = RULE_OPS.find((x) => x === matcher?.op)
    const value = str(matcher?.value)
    if (!categoryId || !op || !value || value.length > 200) return null
    const priority = int(o.priority)
    return { categoryId, op, value: value.trim(), priority: priority !== null && priority >= 0 ? priority : null }
  })
  const startMonth =
    typeof root.budgetStartMonth === 'string' && MONTH_RE.test(root.budgetStartMonth) ? root.budgetStartMonth : null

  return {
    exportedAt: typeof root.exportedAt === 'string' ? root.exportedAt : null,
    budgetStartMonth: startMonth,
    accounts,
    groups,
    categories,
    transactions,
    assignments,
    targets,
    rules,
    payees: Array.isArray(root.payees) ? root.payees.length : 0,
    invalid,
    dateRange: minDate && maxDate ? { min: minDate, max: maxDate } : null,
  }
}

export interface BackupOptions {
  /** Serveur importTransfers : les paires de virements sont reliees. */
  transfers: boolean
  /** Serveur accountFlags : les comptes clos sont re-archives. */
  accountFlags: boolean
  /** Serveur refillTargets : les objectifs « recharger » sont restaures. */
  refillTargets: boolean
  /** Connexions bancaires actuelles (conservees par l'import), si connues. */
  connections: BankConnection[] | undefined
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

/** Traduit une sauvegarde en plan de remplacement (cles courtes, lignes pretes). */
export function buildBackupPlan(backup: ParsedBackup, opts: BackupOptions): ImportPlan {
  const notes: string[] = []
  let ignored = backup.invalid

  // Groupes dans leur ordre ; un groupe manquant regroupe ses orphelines.
  const groupKey = new Map<string, string>()
  const groups: PlanGroup[] = backup.groups
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g, i) => {
      const key = `g${i + 1}`
      groupKey.set(g.id, key)
      return {
        key,
        name: requiredText(g.name, 80, 'Groupe'),
        color: g.color ?? undefined,
        icon: g.icon ?? undefined,
        hidden: g.hidden,
      }
    })
  const groupRank = new Map(backup.groups.map((g) => [g.id, g.sortOrder]))
  let orphanGroup: string | null = null
  const categoryKey = new Map<string, string>()
  const incomeIds = new Set(backup.categories.filter((c) => c.isIncome).map((c) => c.id))
  const categories: PlanCategory[] = backup.categories
    .slice()
    .sort(
      (a, b) =>
        (groupRank.get(a.groupId ?? '') ?? Number.MAX_SAFE_INTEGER) -
          (groupRank.get(b.groupId ?? '') ?? Number.MAX_SAFE_INTEGER) || a.sortOrder - b.sortOrder,
    )
    .map((c, i) => {
      const key = `c${i + 1}`
      categoryKey.set(c.id, key)
      let gKey = c.groupId ? groupKey.get(c.groupId) : undefined
      if (!gKey) {
        if (!orphanGroup) {
          orphanGroup = 'g0'
          groups.push({ key: orphanGroup, name: 'Sans groupe', hidden: false })
        }
        gKey = orphanGroup
      }
      return {
        key,
        groupKey: gKey,
        name: requiredText(c.name, 80, 'Catégorie'),
        isIncome: c.isIncome,
        hidden: c.hidden,
      }
    })

  const accountKey = new Map<string, string>()
  const onBudget = new Map<string, boolean>()
  const accounts: PlanAccount[] = backup.accounts.map((a, i) => {
    const key = `a${i + 1}`
    accountKey.set(a.id, key)
    onBudget.set(a.id, a.onBudget)
    return {
      key,
      name: requiredText(a.name, 80, 'Compte'),
      institution: requiredText(a.institution, 80, 'Import'),
      kind: a.kind ?? undefined,
      onBudget: a.onBudget,
    }
  })

  // Virements : un groupe complet (deux moities restaurees) recoit un nouvel
  // identifiant commun ; une moitie orpheline redevient ordinaire.
  const halves = new Map<string, number>()
  for (const t of backup.transactions) {
    if (t.transferGroupId && accountKey.has(t.accountId))
      halves.set(t.transferGroupId, (halves.get(t.transferGroupId) ?? 0) + 1)
  }
  const newGroupIds = new Map<string, string>()
  let transferPairs = 0
  let transferHalves = 0
  for (const [id, count] of halves) {
    if (count !== 2) continue
    transferHalves += 2
    if (opts.transfers) {
      newGroupIds.set(id, newUuid())
      transferPairs++
    }
  }

  let lostCategories = 0
  const transactions: PlanTransaction[] = []
  for (const t of backup.transactions) {
    const aKey = accountKey.get(t.accountId)
    if (!aKey) {
      ignored++
      continue
    }
    let cKey: string | null = null
    if (t.categoryId) {
      cKey = categoryKey.get(t.categoryId) ?? null
      if (!cKey) lostCategories++
    }
    transactions.push({
      accountKey: aKey,
      categoryKey: cKey,
      date: t.date,
      amount: t.amount,
      label: requiredText(t.label, 200, '(sans libellé)'),
      counterparty: optionalText(t.counterparty, 200),
      notes: optionalText(t.notes, 500),
      transferGroupId: t.transferGroupId ? (newGroupIds.get(t.transferGroupId) ?? null) : null,
    })
  }
  if (lostCategories > 0) {
    notes.push(
      `${plural(lostCategories, 'transaction revient', 'transactions reviennent')} sans catégorie (catégorie absente de la sauvegarde).`,
    )
  }
  if (transferHalves > 0 && !opts.transfers) {
    notes.push(
      `${plural(transferHalves / 2, 'virement restauré', 'virements restaurés')} comme des transactions ordinaires : le serveur déployé ne sait pas encore relier les deux moitiés. Celles sans catégorie apparaîtront dans « À catégoriser ».`,
    )
  }

  // Assignations : une par (categorie, mois), jamais sur une categorie de revenus.
  const asgByKey = new Map<string, PlanAssignment>()
  let lostAssignments = 0
  for (const a of backup.assignments) {
    const cKey = categoryKey.get(a.categoryId)
    if (!cKey || incomeIds.has(a.categoryId)) {
      lostAssignments++
      continue
    }
    asgByKey.set(`${cKey}\u0000${a.month}`, { categoryKey: cKey, month: a.month, amount: a.amount })
  }
  if (lostAssignments > 0) {
    notes.push(
      `${plural(lostAssignments, 'montant assigné ignoré', 'montants assignés ignorés')} (catégorie absente ou de revenus).`,
    )
  }

  const targets: PlanTarget[] = []
  let refillSkipped = 0
  for (const t of backup.targets) {
    const cKey = categoryKey.get(t.categoryId)
    if (!cKey || incomeIds.has(t.categoryId)) continue
    if (t.type === 'refill' && !opts.refillTargets) {
      refillSkipped++
      continue
    }
    targets.push({ categoryKey: cKey, type: t.type, amount: t.amount, dueMonth: t.dueMonth })
  }
  if (refillSkipped > 0) {
    notes.push(
      `${plural(refillSkipped, 'objectif « recharger » non restauré', 'objectifs « recharger » non restaurés')} : le serveur déployé ne connaît pas encore ce type.`,
    )
  }

  const rules: PlanRule[] = backup.rules
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.priority ?? a.i) - (b.r.priority ?? b.i))
    .flatMap(({ r, i }) => {
      const cKey = categoryKey.get(r.categoryId)
      if (!cKey || incomeIds.has(r.categoryId)) return []
      return [{ categoryKey: cKey, op: r.op, value: r.value, priority: r.priority ?? i }]
    })

  let startMonth: string | null = null
  if (backup.budgetStartMonth) {
    if (isRestorableStartMonth(backup.budgetStartMonth)) startMonth = backup.budgetStartMonth
    else notes.push(`Le mois de départ du budget (${fmtMonthLong(backup.budgetStartMonth)}) ne peut pas être rétabli.`)
  }

  const closed = backup.accounts.filter((a) => a.closed)
  const closeAccounts = opts.accountFlags ? closed.map((a) => accountKey.get(a.id)!) : []
  if (closed.length > 0 && !opts.accountFlags) {
    notes.push(
      `${plural(closed.length, 'compte clos sera restauré ouvert', 'comptes clos seront restaurés ouverts')} : le serveur déployé ne sait pas encore archiver un compte.`,
    )
  }

  // Associations bancaires : seulement vers une connexion toujours presente
  // (l'import conserve les connexions Enable Banking) qui expose ce compte.
  const bankLinks: ImportPlan['bankLinks'] = []
  let linksLost = 0
  for (const a of backup.accounts) {
    if (!a.connectionId || !a.providerAccountUid) continue
    const connection = opts.connections?.find((c) => c.id === a.connectionId)
    if (connection && connection.accounts.some((x) => x.uid === a.providerAccountUid)) {
      bankLinks.push({
        accountKey: accountKey.get(a.id)!,
        connectionId: a.connectionId,
        providerAccountUid: a.providerAccountUid,
      })
    } else {
      linksLost++
    }
  }
  if (linksLost > 0) {
    notes.push(
      `${plural(linksLost, 'association bancaire', 'associations bancaires')} à refaire dans « Banque » (connexion expirée ou retirée).`,
    )
  }
  if (backup.payees > 0) {
    notes.push('La mémoire des tiers n’est pas restaurée : elle se réapprend au fil de tes catégorisations.')
  }

  return {
    source: 'backup',
    accounts,
    groups,
    categories,
    transactions,
    assignments: [...asgByKey.values()],
    startMonth,
    targets,
    rules,
    closeAccounts,
    bankLinks,
    transferPairs,
    ignored,
    notes,
  }
}

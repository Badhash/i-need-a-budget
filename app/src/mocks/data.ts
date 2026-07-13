// Donnees de demonstration : 6 mois d'historique (fevrier -> juillet 2026).
// Les mois passes sont generes de facon deterministe (RNG seede) pour rester
// stables entre deux rechargements. Aucune donnee bancaire reelle.

import type { CatColor } from '@/styles/themes'
import { monthRange, MIN_MONTH, CURRENT_MONTH } from '@/lib/format'

export type GroupIcon = 'home' | 'car' | 'sparkles' | 'repeat' | 'piggy' | 'banknote'
export type AccountKind = 'checking' | 'savings' | 'investment' | 'card_deferred'

export interface Account {
  id: string
  name: string
  institution: string
  kind: AccountKind
  onBudget: boolean
  openingBalance: number // centimes, au 31/01/2026
}

export interface CategoryGroup {
  id: string
  name: string
  color: CatColor
  icon: GroupIcon
  sortOrder: number
}

export interface Category {
  id: string
  groupId: string
  name: string
  sortOrder: number
  /** true = categorie de revenus (contrat du moteur : porte par la categorie) */
  isIncome: boolean
}

export interface Transaction {
  id: string
  accountId: string
  date: string // YYYY-MM-DD
  label: string
  categoryId: string | null
  amount: number // centimes, negatif = depense
  /** non nul = moitie d'un transfert lie (contrat du moteur) */
  transferGroupId?: string | null
  note?: string
}

export const INCOME_GROUP_ID = 'grp-income'

export const accounts: Account[] = [
  {
    id: 'acc-checking',
    name: 'Compte courant',
    institution: 'Ma banque',
    kind: 'checking',
    onBudget: true,
    openingBalance: 185000,
  },
  {
    id: 'acc-livret',
    name: 'Livret A',
    institution: 'Ma banque',
    kind: 'savings',
    onBudget: true,
    openingBalance: 460000,
  },
  {
    id: 'acc-pea',
    name: 'PEA',
    institution: 'Ma banque',
    kind: 'investment',
    onBudget: false,
    openingBalance: 1220000,
  },
]

export const categoryGroups: CategoryGroup[] = [
  { id: 'grp-essentials', name: 'Essentiels', color: 'blue', icon: 'home', sortOrder: 1 },
  { id: 'grp-transport', name: 'Transport', color: 'amber', icon: 'car', sortOrder: 2 },
  { id: 'grp-lifestyle', name: 'Plaisirs', color: 'pink', icon: 'sparkles', sortOrder: 3 },
  { id: 'grp-subscriptions', name: 'Abonnements', color: 'purple', icon: 'repeat', sortOrder: 4 },
  { id: 'grp-savings', name: 'Épargne & objectifs', color: 'green', icon: 'piggy', sortOrder: 5 },
  { id: INCOME_GROUP_ID, name: 'Revenus', color: 'teal', icon: 'banknote', sortOrder: 6 },
]

const categorySeeds: Omit<Category, 'isIncome'>[] = [
  { id: 'cat-rent', groupId: 'grp-essentials', name: 'Loyer', sortOrder: 1 },
  { id: 'cat-groceries', groupId: 'grp-essentials', name: 'Courses', sortOrder: 2 },
  { id: 'cat-utilities', groupId: 'grp-essentials', name: 'Électricité & gaz', sortOrder: 3 },
  { id: 'cat-internet', groupId: 'grp-essentials', name: 'Internet & mobile', sortOrder: 4 },
  { id: 'cat-insurance', groupId: 'grp-essentials', name: 'Assurances', sortOrder: 5 },
  { id: 'cat-transit', groupId: 'grp-transport', name: 'Transports en commun', sortOrder: 1 },
  { id: 'cat-fuel', groupId: 'grp-transport', name: 'Essence', sortOrder: 2 },
  { id: 'cat-taxi', groupId: 'grp-transport', name: 'VTC & taxi', sortOrder: 3 },
  { id: 'cat-restaurants', groupId: 'grp-lifestyle', name: 'Restaurants', sortOrder: 1 },
  { id: 'cat-shopping', groupId: 'grp-lifestyle', name: 'Shopping', sortOrder: 2 },
  { id: 'cat-leisure', groupId: 'grp-lifestyle', name: 'Sorties & loisirs', sortOrder: 3 },
  { id: 'cat-holidays', groupId: 'grp-lifestyle', name: 'Vacances', sortOrder: 4 },
  { id: 'cat-streaming', groupId: 'grp-subscriptions', name: 'Streaming', sortOrder: 1 },
  { id: 'cat-music', groupId: 'grp-subscriptions', name: 'Musique', sortOrder: 2 },
  { id: 'cat-cloud', groupId: 'grp-subscriptions', name: 'Stockage cloud', sortOrder: 3 },
  { id: 'cat-emergency', groupId: 'grp-savings', name: "Fonds d'urgence", sortOrder: 1 },
  { id: 'cat-gifts', groupId: 'grp-savings', name: 'Cadeaux', sortOrder: 2 },
  { id: 'cat-projects', groupId: 'grp-savings', name: 'Projets', sortOrder: 3 },
  { id: 'cat-salary', groupId: INCOME_GROUP_ID, name: 'Salaire', sortOrder: 1 },
  { id: 'cat-other-income', groupId: INCOME_GROUP_ID, name: 'Autres revenus', sortOrder: 2 },
]

export const categories: Category[] = categorySeeds.map((c) => ({
  ...c,
  isIncome: c.groupId === INCOME_GROUP_ID,
}))

// Allocation mensuelle de base (centimes) par categorie hors revenus
const BASE_ASSIGNED: Record<string, number> = {
  'cat-rent': 87000,
  'cat-groceries': 40000,
  'cat-utilities': 9000,
  'cat-internet': 5000,
  'cat-insurance': 3800,
  'cat-transit': 8860,
  'cat-fuel': 6000,
  'cat-taxi': 3000,
  'cat-restaurants': 12000,
  'cat-shopping': 10000,
  'cat-leisure': 8000,
  'cat-holidays': 15000,
  'cat-streaming': 2000,
  'cat-music': 1099,
  'cat-cloud': 299,
  'cat-emergency': 20000,
  'cat-gifts': 5000,
  'cat-projects': 10000,
}

// Groupes assignes en juillet (mois en cours, avant l'arrivee du salaire)
const JULY_ASSIGNED_GROUPS = new Set(['grp-essentials', 'grp-transport', 'grp-subscriptions'])

export type Assignments = Record<string, Record<string, number>> // month -> categoryId -> centimes

export function buildAssignments(): Assignments {
  const out: Assignments = {}
  const pastMonths = monthRange(MIN_MONTH, '2026-06')
  for (const m of pastMonths) {
    out[m] = { ...BASE_ASSIGNED }
  }
  const july: Record<string, number> = {}
  for (const cat of categories) {
    if (JULY_ASSIGNED_GROUPS.has(cat.groupId) && BASE_ASSIGNED[cat.id] !== undefined) {
      july[cat.id] = BASE_ASSIGNED[cat.id]
    }
  }
  out[CURRENT_MONTH] = july
  return out
}

// ---------------------------------------------------------------------------
// Generation deterministe des mois passes
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface SpendSpec {
  categoryId: string
  merchants: string[]
  monthlyTotal: number // centimes (positif, sera negatif en transaction)
  txCount: number
  fixedDay?: number // si defini : une seule transaction ce jour-la
}

const PAST_SPEND_SPECS: SpendSpec[] = [
  { categoryId: 'cat-rent', merchants: ['Loyer appartement'], monthlyTotal: 87000, txCount: 1, fixedDay: 2 },
  {
    categoryId: 'cat-groceries',
    merchants: ['Carrefour City', 'Monoprix', 'Biocoop', 'Picard', 'Lidl'],
    monthlyTotal: 38500,
    txCount: 7,
  },
  { categoryId: 'cat-utilities', merchants: ['EDF'], monthlyTotal: 8420, txCount: 1, fixedDay: 5 },
  { categoryId: 'cat-internet', merchants: ['Free Mobile', 'Freebox'], monthlyTotal: 4998, txCount: 2, fixedDay: 7 },
  { categoryId: 'cat-insurance', merchants: ['MAIF Assurance'], monthlyTotal: 3800, txCount: 1, fixedDay: 4 },
  { categoryId: 'cat-transit', merchants: ['Transports en commun'], monthlyTotal: 8860, txCount: 1, fixedDay: 1 },
  { categoryId: 'cat-fuel', merchants: ['TotalEnergies', 'Esso Express'], monthlyTotal: 5800, txCount: 2 },
  { categoryId: 'cat-taxi', merchants: ['Uber', 'G7 Taxi'], monthlyTotal: 2800, txCount: 2 },
  {
    categoryId: 'cat-restaurants',
    merchants: ['Deliveroo', 'Brasserie Le Zinc', 'Sushi Shop', 'Big Mamma', 'Café Oberkampf'],
    monthlyTotal: 11800,
    txCount: 6,
  },
  {
    categoryId: 'cat-shopping',
    merchants: ['Fnac', 'Zara', 'Amazon', 'Décathlon'],
    monthlyTotal: 9500,
    txCount: 3,
  },
  {
    categoryId: 'cat-leisure',
    merchants: ['UGC Ciné Cité', 'Basic-Fit', 'Fever Billetterie'],
    monthlyTotal: 7800,
    txCount: 3,
  },
  { categoryId: 'cat-streaming', merchants: ['Netflix', 'Disney+'], monthlyTotal: 1948, txCount: 2, fixedDay: 8 },
  { categoryId: 'cat-music', merchants: ['Spotify'], monthlyTotal: 1099, txCount: 1, fixedDay: 9 },
  { categoryId: 'cat-cloud', merchants: ['Apple iCloud'], monthlyTotal: 299, txCount: 1, fixedDay: 3 },
  { categoryId: 'cat-gifts', merchants: ['Etsy', 'Nature & Découvertes'], monthlyTotal: 4600, txCount: 1 },
]

function centsSplit(total: number, parts: number, rand: () => number): number[] {
  if (parts === 1) return [total]
  const weights = Array.from({ length: parts }, () => 0.6 + rand())
  const sum = weights.reduce((a, b) => a + b, 0)
  const out = weights.map((w) => Math.round((total * w) / sum))
  const drift = total - out.reduce((a, b) => a + b, 0)
  out[0] += drift
  return out
}

function generatePastTransactions(): Transaction[] {
  const rand = mulberry32(20260712)
  const txs: Transaction[] = []
  const pastMonths = monthRange(MIN_MONTH, '2026-06')
  let seq = 0

  for (const month of pastMonths) {
    // Salaire le 28
    txs.push({
      id: `tx-gen-${seq++}`,
      accountId: 'acc-checking',
      date: `${month}-28`,
      label: 'Virement ACME SAS',
      categoryId: 'cat-salary',
      amount: 285000,
    })

    // Virement epargne mensuel le 1er (transfert lie, hors budget)
    txs.push({
      id: `tx-gen-${seq++}`,
      accountId: 'acc-checking',
      date: `${month}-01`,
      label: 'Virement vers Livret A',
      categoryId: null,
      amount: -20000,
      transferGroupId: `tr-${month}`,
    })
    txs.push({
      id: `tx-gen-${seq++}`,
      accountId: 'acc-livret',
      date: `${month}-01`,
      label: 'Virement depuis Compte courant',
      categoryId: null,
      amount: 20000,
      transferGroupId: `tr-${month}`,
    })

    for (const spec of PAST_SPEND_SPECS) {
      const amounts = centsSplit(spec.monthlyTotal, spec.txCount, rand)
      for (let i = 0; i < amounts.length; i++) {
        const day = spec.fixedDay !== undefined ? spec.fixedDay + i : 2 + Math.floor(rand() * 24)
        const merchant = spec.merchants[Math.floor(rand() * spec.merchants.length)]
        txs.push({
          id: `tx-gen-${seq++}`,
          accountId: 'acc-checking',
          date: `${month}-${String(day).padStart(2, '0')}`,
          label: merchant,
          categoryId: spec.categoryId,
          amount: -amounts[i],
        })
      }
    }
  }

  // Evenements ponctuels
  txs.push({
    id: `tx-gen-${seq++}`,
    accountId: 'acc-checking',
    date: '2026-04-15',
    label: 'Virement revenu complémentaire',
    categoryId: 'cat-other-income',
    amount: 45000,
  })
  txs.push({
    id: `tx-gen-${seq++}`,
    accountId: 'acc-checking',
    date: '2026-06-18',
    label: 'SNCF Connect',
    categoryId: 'cat-holidays',
    amount: -14600,
  })
  txs.push({
    id: `tx-gen-${seq++}`,
    accountId: 'acc-checking',
    date: '2026-06-20',
    label: 'Airbnb',
    categoryId: 'cat-holidays',
    amount: -17400,
  })

  return txs
}

// ---------------------------------------------------------------------------
// Juillet 2026 (mois en cours, arrete au 12) : ecrit a la main
// ---------------------------------------------------------------------------

const JULY_TRANSACTIONS: Transaction[] = [
  { id: 'tx-jul-01', accountId: 'acc-checking', date: '2026-07-01', label: 'Transports en commun', categoryId: 'cat-transit', amount: -8860 },
  { id: 'tx-jul-02', accountId: 'acc-checking', date: '2026-07-01', label: 'Virement vers Livret A', categoryId: null, amount: -20000, transferGroupId: 'tr-2026-07' },
  { id: 'tx-jul-03', accountId: 'acc-livret', date: '2026-07-01', label: 'Virement depuis Compte courant', categoryId: null, amount: 20000, transferGroupId: 'tr-2026-07' },
  { id: 'tx-jul-04', accountId: 'acc-checking', date: '2026-07-02', label: 'Loyer appartement', categoryId: 'cat-rent', amount: -87000 },
  { id: 'tx-jul-05', accountId: 'acc-checking', date: '2026-07-03', label: 'Carrefour City', categoryId: 'cat-groceries', amount: -3245 },
  { id: 'tx-jul-06', accountId: 'acc-checking', date: '2026-07-03', label: 'Apple iCloud', categoryId: 'cat-cloud', amount: -299 },
  { id: 'tx-jul-07', accountId: 'acc-checking', date: '2026-07-04', label: 'MAIF Assurance', categoryId: 'cat-insurance', amount: -3800 },
  { id: 'tx-jul-08', accountId: 'acc-checking', date: '2026-07-04', label: 'Deliveroo', categoryId: 'cat-restaurants', amount: -2450 },
  { id: 'tx-jul-09', accountId: 'acc-checking', date: '2026-07-05', label: 'EDF', categoryId: 'cat-utilities', amount: -8420 },
  { id: 'tx-jul-10', accountId: 'acc-checking', date: '2026-07-05', label: 'Uber', categoryId: 'cat-taxi', amount: -1420 },
  { id: 'tx-jul-11', accountId: 'acc-checking', date: '2026-07-06', label: 'Monoprix', categoryId: 'cat-groceries', amount: -5612 },
  { id: 'tx-jul-12', accountId: 'acc-checking', date: '2026-07-07', label: 'Free Mobile', categoryId: 'cat-internet', amount: -1999 },
  { id: 'tx-jul-13', accountId: 'acc-checking', date: '2026-07-07', label: 'Freebox', categoryId: 'cat-internet', amount: -2999 },
  { id: 'tx-jul-14', accountId: 'acc-checking', date: '2026-07-08', label: 'Netflix', categoryId: 'cat-streaming', amount: -1349 },
  { id: 'tx-jul-15', accountId: 'acc-checking', date: '2026-07-08', label: 'Fnac', categoryId: 'cat-shopping', amount: -4990 },
  { id: 'tx-jul-16', accountId: 'acc-checking', date: '2026-07-08', label: 'Virement revenu complémentaire', categoryId: 'cat-other-income', amount: 38000 },
  { id: 'tx-jul-17', accountId: 'acc-checking', date: '2026-07-09', label: 'Spotify', categoryId: 'cat-music', amount: -1099 },
  { id: 'tx-jul-18', accountId: 'acc-checking', date: '2026-07-09', label: 'Biocoop', categoryId: 'cat-groceries', amount: -2890 },
  { id: 'tx-jul-19', accountId: 'acc-checking', date: '2026-07-10', label: 'Brasserie Le Zinc', categoryId: 'cat-restaurants', amount: -6800 },
  { id: 'tx-jul-20', accountId: 'acc-checking', date: '2026-07-10', label: 'SNCF CONNECT INTERNET', categoryId: null, amount: -5800 },
  { id: 'tx-jul-21', accountId: 'acc-checking', date: '2026-07-11', label: 'Carrefour City', categoryId: 'cat-groceries', amount: -4156 },
  { id: 'tx-jul-22', accountId: 'acc-checking', date: '2026-07-11', label: 'AMAZON PAYMENTS EU', categoryId: null, amount: -2349 },
  { id: 'tx-jul-23', accountId: 'acc-checking', date: '2026-07-12', label: 'CB PHARMACIE LAFAYETTE', categoryId: null, amount: -1875 },
  { id: 'tx-jul-24', accountId: 'acc-checking', date: '2026-07-12', label: 'Sushi Shop', categoryId: 'cat-restaurants', amount: -3200 },
]

export function buildTransactions(): Transaction[] {
  return [...generatePastTransactions(), ...JULY_TRANSACTIONS].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  )
}

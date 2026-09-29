// Mode demonstration : jeu de donnees factice (INAB_DEMO_MODULE).
//
// Un budget realiste de 7 mois (mois courant inclus) : salaire, loyer,
// prelevements, courses, restaurants, carte a debit differe et son releve
// mensuel, virements vers le Livret A et le PEA, remboursements, transactions
// recentes a categoriser, assignations de chaque mois, objectifs, regles,
// memoire de tiers, connexion bancaire et journaux de synchronisation.
//
// DETERMINISTE (PRNG a graine fixe, identifiants derives de noms stables) mais
// ANCRE sur la date reelle du jour : les captures sont toujours d'actualite.
// Aucune donnee bancaire reelle : libelles, montants, IBAN et noms inventes.
//
// Calibrage : le solde d'ouverture du Livret A est ajuste pour que le Pret a
// assigner du mois courant tombe toujours a 412,35 € (quel que soit le jour
// du mois), avec un depassement sur Restaurants.

import { addMonths, computeBudget } from '../../../../packages/engine/src/index'
import { SERVER_FEATURES } from '@/lib/features'
import {
  addDays,
  businessDayOnOrBefore,
  dateInMonth,
  daysInMonth,
  ddmm,
  isoLocalDate,
  mulberry32,
  parisTimeToIso,
  stableUuid,
  type DemoAccount,
  type DemoCategory,
  type DemoDb,
  type DemoGroup,
  type DemoTransaction,
} from './db'
import { engineInput, learnPayee } from './logic'

const SEED = 0x1d3a5eed
/** Pret a assigner vise pour le mois courant (centimes). */
const TARGET_RTA = 41_235

const id = (name: string) => stableUuid(`inab-demo:${name}`)

type CatKey =
  | 'salaire'
  | 'ouverture'
  | 'loyer'
  | 'electricite'
  | 'internet'
  | 'assurance'
  | 'courses'
  | 'restaurants'
  | 'transports'
  | 'sante'
  | 'streaming'
  | 'telephone'
  | 'sport'
  | 'presse'
  | 'sorties'
  | 'voyages'
  | 'shopping'
  | 'cadeaux'
  | 'urgence'
  | 'vacances'
  | 'investissement'
  | 'creditAuto'

interface GroupSpec {
  key: string
  name: string
  color: string
  icon: string
  hidden?: boolean
  cats: { key: CatKey; name: string; hidden?: boolean }[]
}

// Taxonomie : couleurs et icones parmi celles acceptees par le serveur.
const GROUPS: GroupSpec[] = [
  {
    key: 'logement',
    name: 'Logement',
    color: 'blue',
    icon: 'home',
    cats: [
      { key: 'loyer', name: 'Loyer' },
      { key: 'electricite', name: 'Électricité' },
      { key: 'internet', name: 'Internet' },
      { key: 'assurance', name: 'Assurance habitation' },
    ],
  },
  {
    key: 'quotidien',
    name: 'Quotidien',
    color: 'amber',
    icon: 'car',
    cats: [
      { key: 'courses', name: 'Courses' },
      { key: 'restaurants', name: 'Restaurants' },
      { key: 'transports', name: 'Transports' },
      { key: 'sante', name: 'Santé' },
    ],
  },
  {
    key: 'abonnements',
    name: 'Abonnements',
    color: 'purple',
    icon: 'repeat',
    cats: [
      { key: 'streaming', name: 'Streaming' },
      { key: 'telephone', name: 'Téléphone' },
      { key: 'sport', name: 'Salle de sport' },
      { key: 'presse', name: 'Abonnement presse', hidden: true },
    ],
  },
  {
    key: 'loisirs',
    name: 'Loisirs',
    color: 'pink',
    icon: 'sparkles',
    cats: [
      { key: 'sorties', name: 'Sorties' },
      { key: 'voyages', name: 'Voyages' },
      { key: 'shopping', name: 'Shopping' },
      { key: 'cadeaux', name: 'Cadeaux' },
    ],
  },
  {
    key: 'epargne',
    name: 'Épargne',
    color: 'green',
    icon: 'piggy',
    cats: [
      { key: 'urgence', name: "Fonds d'urgence" },
      { key: 'vacances', name: "Vacances d'été" },
      { key: 'investissement', name: 'Investissement' },
    ],
  },
  {
    key: 'revenus',
    name: 'Revenus',
    color: 'teal',
    icon: 'banknote',
    cats: [
      { key: 'salaire', name: 'Salaire' },
      { key: 'ouverture', name: "Solde d'ouverture" },
    ],
  },
  {
    key: 'archivees',
    name: 'Archivées',
    color: 'blue',
    icon: 'car',
    hidden: true,
    cats: [{ key: 'creditAuto', name: 'Ancien crédit auto', hidden: true }],
  },
]

const INCOME_CATS = new Set<CatKey>(['salaire', 'ouverture'])

// Assignations d'un mois « normal » (centimes). Les depassements des mois
// passes sont couverts apres coup (comme on le fait dans YNAB).
const PLAN: Partial<Record<CatKey, number>> = {
  loyer: 95_000,
  electricite: 7_000,
  internet: 3_300,
  assurance: 1_900,
  courses: 45_000,
  restaurants: 15_000,
  transports: 11_000,
  sante: 4_000,
  streaming: 2_600,
  telephone: 2_000,
  sport: 3_500,
  sorties: 8_000,
  voyages: 10_000,
  shopping: 10_000,
  cadeaux: 4_000,
  urgence: 25_000,
  vacances: 15_000,
  investissement: 30_000,
}

// Reliquat maximal garde en fin de mois passe sur les enveloppes variables :
// l'excedent est reaffecte ailleurs (pas de report qui gonfle sans fin).
const BUFFER: Partial<Record<CatKey, number>> = {
  courses: 6_000,
  transports: 3_000,
  sante: 6_000,
  sorties: 8_000,
  shopping: 5_000,
}

// Mois courant : les charges fixes et l'epargne sont financees, le reste
// seulement a hauteur du besoin (mois « partiellement finance »).
const CURRENT_FIXED: Partial<Record<CatKey, number>> = {
  loyer: 95_000,
  electricite: 7_000,
  internet: 3_300,
  assurance: 1_900,
  streaming: 2_600,
  telephone: 2_000,
  sport: 3_500,
  transports: 11_000,
  sante: 4_000,
  urgence: 10_000,
  vacances: 15_000,
  investissement: 30_000,
}

const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step
const roundTo = (value: number, step: number) => Math.round(value / step) * step

export function createDemoDb(features: ReadonlySet<string>, now: Date = new Date()): DemoDb {
  const rng = mulberry32(SEED)
  const rand = (min: number, max: number) => min + rng() * (max - min)
  const eur = (min: number, max: number) => Math.round(rand(min, max) * 100)
  const int = (min: number, max: number) => Math.floor(rand(min, max + 1))
  const chance = (p: number) => rng() < p

  const crossBudget = features.has(SERVER_FEATURES.crossBudgetTransfers)
  const refillTargets = features.has(SERVER_FEATURES.refillTargets)

  const today = isoLocalDate(now)
  const M0 = today.slice(0, 7)
  const months = Array.from({ length: 7 }, (_, i) => addMonths(M0, i - 6))
  const M1 = addMonths(M0, 1)

  // --- Comptes ---------------------------------------------------------------
  const connectionId = id('connection:ma-banque')
  const ebChecking = id('eb-account:courant')
  const ebCard = id('eb-account:carte')
  const account = (key: string, fields: Omit<DemoAccount, 'id'>): DemoAccount => ({ id: id(`account:${key}`), ...fields })
  const courant = account('courant', {
    name: 'Compte courant',
    institution: 'Ma Banque',
    kind: 'checking',
    onBudget: true,
    closed: false,
    connectionId,
    providerAccountUid: ebChecking,
  })
  const carte = account('carte', {
    name: 'Carte Visa différée',
    institution: 'Ma Banque',
    kind: 'card_deferred',
    onBudget: true,
    closed: false,
    connectionId,
    providerAccountUid: ebCard,
  })
  const livret = account('livret', {
    name: 'Livret A',
    institution: 'Ma Banque',
    kind: 'savings',
    onBudget: true,
    closed: false,
    connectionId: null,
    providerAccountUid: null,
  })
  const pea = account('pea', {
    name: 'PEA',
    institution: 'Mon Courtier',
    kind: 'investment',
    onBudget: false,
    closed: false,
    connectionId: null,
    providerAccountUid: null,
  })
  const joint = account('joint', {
    name: 'Ancien compte joint',
    institution: 'Banque Régionale',
    kind: 'checking',
    onBudget: true,
    closed: true,
    connectionId: null,
    providerAccountUid: null,
  })
  const accounts = [courant, carte, livret, pea, joint]
  // Comptes relies a Enable Banking : leurs ecritures sont des imports bancaires.
  const bankFed = new Set([courant.id, carte.id])

  // --- Taxonomie -------------------------------------------------------------
  const groups: DemoGroup[] = []
  const categories: DemoCategory[] = []
  const catIds = new Map<CatKey, string>()
  GROUPS.forEach((g, gi) => {
    const groupId = id(`group:${g.key}`)
    groups.push({ id: groupId, name: g.name, color: g.color, icon: g.icon, sortOrder: gi + 1, hidden: g.hidden === true })
    g.cats.forEach((c, ci) => {
      const catId = id(`category:${c.key}`)
      catIds.set(c.key, catId)
      categories.push({
        id: catId,
        groupId,
        name: c.name,
        isIncome: INCOME_CATS.has(c.key),
        sortOrder: ci + 1,
        hidden: c.hidden === true,
      })
    })
  })
  const cat = (key: CatKey) => catIds.get(key)!

  // --- Transactions ----------------------------------------------------------
  // Chaque ecriture consomme un numero de sequence (donc un identifiant stable)
  // meme si sa date est encore a venir : les identifiants ne dependent pas du
  // jour du mois. Seules les ecritures datees au plus tard aujourd'hui sont gardees.
  const transactions: DemoTransaction[] = []
  let seq = 0
  interface TxInput {
    account: DemoAccount
    cat: CatKey | null
    date: string
    amount: number
    label: string
    counterparty?: string
    notes?: string
    transferGroupId?: string
    imported?: boolean
  }
  const push = (o: TxInput): DemoTransaction | null => {
    const n = seq++
    if (o.date > today) return null
    const imported = o.imported ?? bankFed.has(o.account.id)
    const tx: DemoTransaction = {
      id: id(`tx:${n}`),
      accountId: o.account.id,
      categoryId: o.cat ? cat(o.cat) : null,
      bookingDate: o.date,
      bookingMonth: o.date.slice(0, 7),
      amount: o.amount,
      label: o.label,
      counterparty: o.counterparty ?? null,
      transferGroupId: o.transferGroupId ?? null,
      notes: o.notes ?? null,
      txHash: imported ? `demo-hash-${n}` : null,
    }
    transactions.push(tx)
    return tx
  }
  // Paiement carte : libelle date du jour d'achat (la veille de l'ecriture).
  const cb = (merchant: string, bookingDate: string) => `CB ${merchant} ${ddmm(addDays(bookingDate, -1))}`
  const transfer = (
    from: DemoAccount,
    to: DemoAccount,
    date: string,
    amount: number,
    labels: [string, string],
    fromCat: CatKey | null = null,
  ) => {
    const group = id(`transfer:${seq}`)
    push({ account: from, cat: fromCat, date, amount: -amount, label: labels[0], transferGroupId: group })
    push({ account: to, cat: null, date, amount, label: labels[1], transferGroupId: group })
  }

  // Soldes d'ouverture (debut de l'historique). Celui du Livret A est calibre
  // plus bas (Pret a assigner vise).
  const start = dateInMonth(months[0], 1)
  push({ account: courant, cat: 'ouverture', date: start, amount: 48_530, label: "Solde d'ouverture", imported: false })
  const livretOpening = push({ account: livret, cat: 'ouverture', date: start, amount: 0, label: "Solde d'ouverture" })!
  push({ account: joint, cat: 'ouverture', date: start, amount: 34_000, label: "Solde d'ouverture" })
  push({ account: pea, cat: null, date: start, amount: 1_248_000, label: "Solde d'ouverture" })
  transfer(joint, courant, dateInMonth(months[0], 3), 34_000, [
    'VIR SEPA CLOTURE COMPTE JOINT',
    'VIR SEPA RECU CLOTURE COMPTE JOINT',
  ])

  const groceries: { name: string; min: number; max: number; count: () => number }[] = [
    { name: 'CARREFOUR MARKET', min: 28, max: 92, count: () => 4 },
    { name: 'BOULANGERIE DU MARCHE', min: 2.4, max: 12.8, count: () => int(4, 6) },
    { name: 'PICARD SURGELES', min: 18, max: 42, count: () => 1 },
    { name: 'MONOPRIX', min: 12, max: 46, count: () => int(1, 2) },
    { name: 'LIDL', min: 22, max: 56, count: () => 1 },
    { name: 'GRAND FRAIS', min: 20, max: 44, count: () => (chance(0.6) ? 1 : 0) },
  ]
  const restaurants: { name: string; min: number; max: number }[] = [
    { name: 'LE PETIT BISTROT', min: 18, max: 46 },
    { name: 'SUSHI SHOP', min: 16, max: 34 },
    { name: 'BIG FERNAND', min: 14, max: 22 },
    { name: 'DELIVEROO', min: 19, max: 32 },
    { name: 'CAFE DE LA PAIX', min: 3.8, max: 9.5 },
    { name: 'PIZZERIA NAPOLI', min: 15, max: 38 },
  ]

  months.forEach((m, k) => {
    const last = daysInMonth(m)
    const d = (day: number) => dateInMonth(m, day)
    const anyDay = () => d(int(1, last))

    // Revenus : salaire le dernier jour ouvre avant le 28.
    const salaryDate = businessDayOnOrBefore(d(28))
    push({
      account: courant,
      cat: 'salaire',
      date: salaryDate,
      amount: 318_000 + int(0, 4_200),
      label: 'VIR SEPA SALAIRE ACME SAS',
      counterparty: 'ACME SAS',
    })
    if (k === 3) {
      push({
        account: courant,
        cat: 'salaire',
        date: salaryDate,
        amount: 60_000,
        label: 'VIR SEPA ACME SAS PRIME',
        counterparty: 'ACME SAS',
        notes: 'Prime de vacances',
      })
    }

    // Epargne : virements permanents vers le Livret A et le PEA (virement croise).
    transfer(courant, livret, d(2), 40_000, ['VIR SEPA VERS LIVRET A', 'VIR SEPA RECU DU COMPTE COURANT'])
    transfer(
      courant,
      pea,
      d(10),
      30_000,
      ['VIR SEPA VERS PEA MON COURTIER', 'VIR SEPA RECU COMPTE COURANT'],
      crossBudget ? 'investissement' : null,
    )
    if (k === 3) {
      transfer(livret, courant, d(19), 50_000, ['VIR SEPA VERS COMPTE COURANT', 'VIR SEPA RECU DU LIVRET A'])
    }
    if (k === 2) push({ account: pea, cat: null, date: d(15), amount: 4_218, label: 'COUPON ETF MONDE' })

    // Logement et abonnements : prelevements a date fixe.
    push({ account: courant, cat: 'loyer', date: d(3), amount: -95_000, label: 'PRLV SEPA SCI LES TILLEULS LOYER', counterparty: 'SCI LES TILLEULS' })
    push({ account: courant, cat: 'electricite', date: d(10), amount: -6_400, label: 'PRLV SEPA EDF CLIENTS PARTICULIERS', counterparty: 'EDF' })
    push({ account: courant, cat: 'internet', date: d(12), amount: -3_299, label: 'PRLV SEPA BOUYGUES TELECOM BBOX', counterparty: 'BOUYGUES TELECOM' })
    push({ account: courant, cat: 'assurance', date: d(8), amount: -1_872, label: 'PRLV SEPA MUTUELLE DU LOGIS ASSURANCE HABITATION', counterparty: 'MUTUELLE DU LOGIS' })
    push({ account: courant, cat: 'telephone', date: d(16), amount: -1_999, label: 'PRLV SEPA FREE MOBILE', counterparty: 'FREE MOBILE' })
    push({ account: courant, cat: 'streaming', date: d(18), amount: -1_199, label: 'PRLV SEPA SPOTIFY', counterparty: 'SPOTIFY AB' })
    push({ account: courant, cat: 'sport', date: d(6), amount: -3_495, label: 'PRLV SEPA FITNESS PARK', counterparty: 'FITNESS PARK' })
    push({ account: courant, cat: 'transports', date: d(7), amount: -8_880, label: 'PRLV SEPA NAVIGO MENSUEL', counterparty: 'COMUTITRES' })
    push({ account: carte, cat: 'streaming', date: d(21), amount: -1_349, label: cb('NETFLIX.COM', d(21)) })
    if (k <= 1) {
      push({ account: courant, cat: 'presse', date: d(20), amount: -999, label: 'PRLV SEPA JOURNAL DU MATIN ABONNEMENT', counterparty: 'JOURNAL DU MATIN' })
    }
    if (k === 0) {
      push({
        account: courant,
        cat: 'creditAuto',
        date: d(15),
        amount: -18_900,
        label: 'PRLV SEPA AUTOFINANCE ECHEANCE FINALE',
        counterparty: 'AUTOFINANCE',
        notes: 'Dernière échéance du crédit auto',
      })
    }

    // Courses (carte de debit immediat du compte courant), plafonnees ~440 €.
    let groceryTotal = 0
    for (const g of groceries) {
      const count = g.count()
      for (let i = 0; i < count; i++) {
        const date = anyDay()
        const amount = eur(g.min, g.max)
        if (groceryTotal + amount > 44_000) continue
        groceryTotal += amount
        push({ account: courant, cat: 'courses', date, amount: -amount, label: cb(g.name, date) })
      }
    }

    // Sante : pharmacie, consultation et remboursement CPAM (remboursement
    // positif sur une categorie de depense).
    if (chance(0.7)) {
      const date = anyDay()
      push({ account: courant, cat: 'sante', date, amount: -eur(6, 32), label: cb('PHARMACIE DU CENTRE', date) })
    }
    if (chance(0.45)) {
      const day = int(1, Math.max(1, last - 6))
      push({ account: courant, cat: 'sante', date: d(day), amount: -3_000, label: cb('CABINET MEDICAL DR LEROY', d(day)) })
      push({
        account: courant,
        cat: 'sante',
        date: d(day + 5),
        amount: 2_100,
        label: 'VIR SEPA CPAM PARIS REMBT SOINS',
        counterparty: 'CPAM DE PARIS',
      })
    }
    if (chance(0.35)) {
      const date = anyDay()
      push({ account: courant, cat: 'sorties', date, amount: chance(0.5) ? -4_000 : -6_000, label: `RETRAIT DAB ${ddmm(date)} PARIS 11E` })
    }

    // Carte a debit differe : restaurants, transports, loisirs, shopping.
    const restoCount = int(5, 7)
    for (let i = 0; i < restoCount; i++) {
      const r = restaurants[int(0, restaurants.length - 1)]
      const date = anyDay()
      push({ account: carte, cat: 'restaurants', date, amount: -eur(r.min, r.max), label: cb(r.name, date) })
    }
    const uberCount = int(1, 2)
    for (let i = 0; i < uberCount; i++) {
      const date = anyDay()
      push({ account: carte, cat: 'transports', date, amount: -eur(9, 26), label: cb('UBER *TRIP', date) })
    }
    if (k === 3) {
      push({
        account: carte,
        cat: 'transports',
        date: d(4),
        amount: -12_840,
        label: cb('SNCF CONNECT', d(4)),
        notes: 'Paris - Marseille aller-retour',
      })
    } else if (chance(0.45)) {
      const date = anyDay()
      push({ account: carte, cat: 'transports', date, amount: -eur(35, 95), label: cb('SNCF CONNECT', date) })
    }
    if (chance(0.7)) {
      const date = anyDay()
      push({ account: carte, cat: 'sorties', date, amount: chance(0.5) ? -1_190 : -2_380, label: cb('UGC CINE CITE', date) })
    }
    if (chance(0.5)) {
      const date = anyDay()
      push({ account: carte, cat: 'sorties', date, amount: -eur(16, 32), label: cb('LE COMPTOIR DU CANAL', date) })
    }
    if (k === 2) {
      push({ account: carte, cat: 'sorties', date: d(14), amount: -5_400, label: cb('FNAC SPECTACLES', d(14)), notes: 'Concert' })
    }
    const amazonCount = int(1, 2)
    for (let i = 0; i < amazonCount; i++) {
      const date = anyDay()
      push({ account: carte, cat: 'shopping', date, amount: -eur(12, 68), label: cb('AMAZON PAYMENTS', date) })
    }
    if (chance(0.35)) {
      const date = anyDay()
      push({ account: carte, cat: 'shopping', date, amount: -eur(24, 89), label: cb('DECATHLON', date) })
    }
    if (chance(0.3)) {
      const date = anyDay()
      push({ account: carte, cat: 'shopping', date, amount: -eur(29, 79), label: cb('ZARA', date) })
    }
    if (k === 4) {
      // Achat rendu puis rembourse : montant positif sur Shopping.
      push({ account: carte, cat: 'shopping', date: d(6), amount: -3_999, label: cb('DECATHLON', d(6)) })
      push({ account: carte, cat: 'shopping', date: d(18), amount: 3_999, label: `REMBOURSEMENT CB DECATHLON ${ddmm(d(17))}`, notes: 'Article retourné' })
    }
    if (k === 1) push({ account: carte, cat: 'cadeaux', date: d(12), amount: -4_690, label: cb('NATURE ET DECOUVERTES', d(12)) })
    if (k === 4) push({ account: carte, cat: 'cadeaux', date: d(23), amount: -3_250, label: cb('CULTURA', d(23)) })
    if (k === 2) push({ account: carte, cat: 'voyages', date: d(9), amount: -18_436, label: cb('EASYJET', d(9)) })
    if (k === 3) push({ account: carte, cat: 'voyages', date: d(11), amount: -61_200, label: cb('AIRBNB', d(11)), notes: 'Location à Marseille, 5 nuits' })
    if (k === 5) push({ account: carte, cat: 'voyages', date: d(13), amount: -14_200, label: cb('HOTEL DU PORT', d(13)) })
  })

  // Mois courant : un diner qui fait deborder l'enveloppe Restaurants.
  const dinnerDate = addDays(today, -2) < `${M0}-01` ? `${M0}-01` : addDays(today, -2)
  push({
    account: carte,
    cat: 'restaurants',
    date: dinnerDate,
    amount: -7_840,
    label: cb('LA TABLE D ALEXANDRE', dinnerDate),
    notes: 'Dîner anniversaire',
  })

  // Transactions recentes a categoriser (badge « À catégoriser », mode Tri).
  const recent: { offset: number; account: DemoAccount; amount: number; label: (date: string) => string; counterparty?: string }[] = [
    { offset: 0, account: carte, amount: -2_347, label: (dt) => cb('CARREFOUR CITY', dt) },
    { offset: 1, account: courant, amount: -680, label: (dt) => cb('BOULANGERIE DU MARCHE', dt) },
    { offset: 1, account: carte, amount: -1_790, label: (dt) => cb('UBER *TRIP', dt) },
    { offset: 2, account: carte, amount: -6_490, label: (dt) => cb('LEROY MERLIN', dt) },
    { offset: 3, account: courant, amount: 2_500, label: () => 'VIR INSTANTANE RECU LUCAS MARTIN', counterparty: 'LUCAS MARTIN' },
    { offset: 4, account: carte, amount: -3_499, label: (dt) => cb('AMAZON PAYMENTS', dt) },
    { offset: 5, account: courant, amount: -1_260, label: (dt) => cb('PHARMACIE DU CENTRE', dt) },
    { offset: 6, account: carte, amount: -1_850, label: (dt) => cb('PAYPAL *VINTED', dt) },
    { offset: 7, account: courant, amount: -6_000, label: (dt) => `RETRAIT DAB ${ddmm(dt)} PARIS 11E` },
    { offset: 8, account: carte, amount: -8_999, label: (dt) => cb('DARTY', dt) },
    { offset: 9, account: carte, amount: -786, label: (dt) => cb('LA POSTE', dt) },
    { offset: 11, account: carte, amount: -1_350, label: (dt) => cb('PATHE BEAUGRENELLE', dt) },
    { offset: 12, account: courant, amount: -2_735, label: (dt) => cb('MONOPRIX', dt) },
  ]
  for (const r of recent) {
    const date = addDays(today, -r.offset)
    push({ account: r.account, cat: null, date, amount: r.amount, label: r.label(date), counterparty: r.counterparty })
  }

  // Releves mensuels de la carte a debit differe (mois termines) : virement
  // du compte courant vers la carte, qui remet son solde a zero.
  months.slice(0, 6).forEach((m) => {
    const spent = transactions
      .filter((t) => t.accountId === carte.id && t.bookingMonth === m && !t.transferGroupId)
      .reduce((s, t) => s + t.amount, 0)
    if (spent === 0) return
    const date = dateInMonth(m, daysInMonth(m))
    transfer(courant, carte, date, -spent, ['PRELEVEMENT CARTE X4521 DEPENSES DU MOIS', 'REGLEMENT RELEVE CARTE X4521'])
  })

  transactions.sort((a, b) => (a.bookingDate < b.bookingDate ? -1 : a.bookingDate > b.bookingDate ? 1 : 0))

  const db: DemoDb = {
    accounts,
    groups,
    categories,
    transactions,
    assignments: [],
    targets: [],
    rules: [],
    payees: [],
    bankConnections: [],
    syncLogs: [],
    budgetStartMonth: null,
  }

  // --- Assignations ----------------------------------------------------------
  const setAssigned = (key: CatKey, month: string, amount: number) => {
    const categoryId = cat(key)
    const existing = db.assignments.find((a) => a.categoryId === categoryId && a.month === month)
    if (existing) existing.amount = amount
    else db.assignments.push({ id: id(`assignment:${key}:${month}`), categoryId, month, amount })
  }
  const rowsOf = (month: string) => {
    const budget = computeBudget(engineInput(db, month, crossBudget))
    return new Map(budget.categories.map((r) => [r.categoryId, r]))
  }
  const plannedKeys = Object.keys(PLAN) as CatKey[]

  // Mois passes : le plan, puis couverture des depassements (Restaurants
  // « ajuste au centime pres » : son report reste quasi nul).
  months.slice(0, 6).forEach((m, k) => {
    for (const key of plannedKeys) setAssigned(key, m, PLAN[key]!)
    if (k === 0) {
      setAssigned('urgence', m, PLAN.urgence! + 100_000)
      setAssigned('creditAuto', m, 18_900)
    }
    if (k <= 1) setAssigned('presse', m, 999)
    const rows = rowsOf(m)
    for (const key of [...plannedKeys, 'presse', 'creditAuto'] as CatKey[]) {
      const r = rows.get(cat(key))
      if (!r) continue
      const buffer = BUFFER[key]
      if (key === 'restaurants') {
        setAssigned(key, m, Math.max(0, ceilTo(-(r.rollover + r.activity), 500)))
      } else if (r.available < 0) {
        setAssigned(key, m, r.assigned + ceilTo(-r.available, 500))
      } else if (buffer !== undefined && r.available > buffer) {
        setAssigned(key, m, Math.max(0, r.assigned - Math.floor((r.available - buffer) / 500) * 500))
      }
    }
  })

  // Mois courant : charges fixes et epargne financees (au moins la depense du
  // mois), Courses sous son objectif mensuel, Loisirs a hauteur de la depense
  // (rien si aucune), Restaurants volontairement en depassement.
  const current = rowsOf(M0)
  const spentOf = (key: CatKey) => {
    const r = current.get(cat(key))!
    return { rollover: r.rollover, spent: -r.activity }
  }
  for (const [key, amount] of Object.entries(CURRENT_FIXED) as [CatKey, number][]) {
    setAssigned(key, M0, Math.max(amount, ceilTo(spentOf(key).spent, 500)))
  }
  setAssigned('courses', M0, Math.min(45_000, Math.max(30_000, ceilTo(spentOf('courses').spent, 1_000) + 1_000)))
  for (const key of ['sorties', 'voyages', 'shopping', 'cadeaux'] as CatKey[]) {
    const { spent } = spentOf(key)
    if (spent > 0) setAssigned(key, M0, ceilTo(spent, 500))
  }
  {
    const { rollover, spent } = spentOf('restaurants')
    setAssigned('restaurants', M0, Math.max(0, roundTo(spent - rollover, 1_000) - 5_000))
  }

  // Mois prochain : le loyer et l'epargne vacances sont deja prevus ; une fois
  // le salaire du mois tombe, tout le mois prochain est budgete d'avance.
  const salaryReceived = transactions.some(
    (t) => t.bookingMonth === M0 && t.categoryId === cat('salaire') && t.amount > 0,
  )
  if (salaryReceived) {
    for (const key of plannedKeys) setAssigned(key, M1, PLAN[key]!)
  } else {
    setAssigned('loyer', M1, 95_000)
    setAssigned('vacances', M1, 15_000)
  }

  // Calibrage : le solde d'ouverture du Livret A fixe le Pret a assigner.
  const rta = computeBudget(engineInput(db, M0, crossBudget)).readyToAssign
  livretOpening.amount = TARGET_RTA - rta

  // --- Objectifs, regles, memoire de tiers -----------------------------------
  const year = Number(M0.slice(0, 4))
  const december = `${year}-12`
  db.targets.push(
    { id: id('target:courses'), categoryId: cat('courses'), type: 'monthly', amount: 45_000, dueMonth: null },
    { id: id('target:vacances'), categoryId: cat('vacances'), type: 'byDate', amount: 180_000, dueMonth: addMonths(M0, 8) },
    { id: id('target:cadeaux'), categoryId: cat('cadeaux'), type: 'byDate', amount: 25_000, dueMonth: december },
  )
  if (refillTargets) {
    db.targets.push({ id: id('target:urgence'), categoryId: cat('urgence'), type: 'refill', amount: 300_000, dueMonth: null })
  }

  const rules: [string, CatKey][] = [
    ['carrefour', 'courses'],
    ['edf', 'electricite'],
    ['netflix', 'streaming'],
    ['sncf', 'transports'],
    ['free mobile', 'telephone'],
  ]
  rules.forEach(([value, key], priority) => {
    db.rules.push({
      id: id(`rule:${value}`),
      matcher: { field: 'label', op: 'contains', value },
      categoryId: cat(key),
      priority,
    })
  })

  // Memoire de tiers : rejoue les categorisations (meme payeeKey que le serveur).
  const onBudget = new Set(accounts.filter((a) => a.onBudget).map((a) => a.id))
  const income = new Set(categories.filter((c) => c.isIncome).map((c) => c.id))
  for (const t of transactions) {
    if (!t.categoryId || t.transferGroupId || !onBudget.has(t.accountId) || income.has(t.categoryId)) continue
    learnPayee(db, t.label, t.categoryId)
  }

  // --- Banque ----------------------------------------------------------------
  db.bankConnections.push({
    id: connectionId,
    institution: 'Ma Banque',
    validUntil: new Date(now.getTime() + 120 * 86_400_000).toISOString(),
    sessionState: 'active',
    accounts: [
      { uid: ebChecking, name: 'COMPTE CHEQUES', iban: 'FR7612548029981234567890161', product: 'Compte de dépôt' },
      { uid: ebCard, name: 'CARTE VISA PREMIER', product: 'Carte à débit différé' },
    ],
  })

  // 10 derniers runs de synchronisation (07:30 et 19:30, heure de Paris).
  const runs: string[] = []
  for (let back = 0; runs.length < 10 && back < 10; back++) {
    const date = addDays(today, -back)
    for (const [hour, minute] of [
      [19, 30],
      [7, 30],
    ] as const) {
      const iso = parisTimeToIso(date, hour, minute, 3 + ((back * 7 + hour) % 40))
      if (new Date(iso).getTime() <= now.getTime() && runs.length < 10) runs.push(iso)
    }
  }
  const imported = [2, 0, 1, 0, 3, 0, 2, 1, 0, 4]
  runs.forEach((runAt, i) => {
    const failed = i === 3
    db.syncLogs.push({
      id: id(`sync-log:${i}`),
      runAt,
      status: failed ? 'error' : 'ok',
      importedCount: failed ? 0 : imported[i],
      error: failed ? 'Délai de réponse de la banque dépassé (504)' : null,
      connectionId,
    })
  })

  return db
}

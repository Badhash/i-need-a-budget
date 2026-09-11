import { describe, expect, it } from 'vitest'
import {
  addMonths,
  computeBudget,
  monthRange,
  type BudgetInput,
  type CategoryMonth,
} from './index.ts'

const CHECKING = { id: 'acc-checking', onBudget: true }
const SAVINGS = { id: 'acc-savings', onBudget: true }
const PEA = { id: 'acc-pea', onBudget: false }

const INCOME = { id: 'cat-income', isIncome: true }
const FOOD = { id: 'cat-food', isIncome: false }
const RENT = { id: 'cat-rent', isIncome: false }

function base(overrides: Partial<BudgetInput>): BudgetInput {
  return {
    month: '2026-03',
    accounts: [CHECKING, SAVINGS, PEA],
    categories: [INCOME, FOOD, RENT],
    transactions: [],
    assignments: [],
    ...overrides,
  }
}

function cat(result: { categories: CategoryMonth[] }, id: string): CategoryMonth {
  const found = result.categories.find((c) => c.categoryId === id)
  if (!found) throw new Error(`categorie absente du resultat : ${id}`)
  return found
}

function salary(month: string, amount = 200_000) {
  return {
    id: `tx-salary-${month}`,
    accountId: CHECKING.id,
    categoryId: INCOME.id,
    month,
    amount,
  }
}

describe('helpers de mois', () => {
  it('addMonths traverse les annees dans les deux sens', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2025-12', 1)).toBe('2026-01')
    expect(addMonths('2026-03', 10)).toBe('2027-01')
  })

  it('monthRange est inclusif et vide si bornes inversees', () => {
    expect(monthRange('2026-01', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(monthRange('2026-03', '2026-01')).toEqual([])
  })

  it('computeBudget rejette un mois cible mal forme', () => {
    expect(() => computeBudget(base({ month: '2026-13' }))).toThrow()
    expect(() => computeBudget(base({ month: '202603' }))).toThrow()
  })
})

describe('available = rollover + assigned + activity', () => {
  it('calcule un mois simple sans historique', () => {
    const result = computeBudget(
      base({
        month: '2026-02',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: -12_000 },
        ],
        assignments: [{ categoryId: FOOD.id, month: '2026-02', amount: 30_000 }],
      }),
    )
    expect(cat(result, FOOD.id)).toEqual({
      categoryId: FOOD.id,
      rollover: 0,
      assigned: 30_000,
      activity: -12_000,
      available: 18_000,
    })
    expect(result.readyToAssign).toBe(200_000 - 30_000)
  })

  it('reporte le disponible positif sur le mois suivant (rollover)', () => {
    const result = computeBudget(
      base({
        month: '2026-03',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: -10_000 },
        ],
        assignments: [{ categoryId: FOOD.id, month: '2026-02', amount: 30_000 }],
      }),
    )
    const food = cat(result, FOOD.id)
    expect(food.rollover).toBe(20_000)
    expect(food.assigned).toBe(0)
    expect(food.available).toBe(20_000)
  })
})

describe('overspending', () => {
  it('remet le disponible a zero le mois suivant et le deduit du RTA', () => {
    const result = computeBudget(
      base({
        month: '2026-03',
        transactions: [
          salary('2026-02'),
          // depassement de 3 000 en fevrier
          { id: 't1', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: -8_000 },
        ],
        assignments: [{ categoryId: FOOD.id, month: '2026-02', amount: 5_000 }],
      }),
    )
    const food = cat(result, FOOD.id)
    expect(food.rollover).toBe(0)
    expect(food.available).toBe(0)
    // RTA(mars) = 200 000 - 5 000 assignes - 3 000 d'overspending de fevrier
    expect(result.readyToAssign).toBe(200_000 - 5_000 - 3_000)
  })

  it("l'overspending du mois cible n'est pas deduit du RTA de ce mois", () => {
    const result = computeBudget(
      base({
        month: '2026-02',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: -8_000 },
        ],
        assignments: [{ categoryId: FOOD.id, month: '2026-02', amount: 5_000 }],
      }),
    )
    expect(cat(result, FOOD.id).available).toBe(-3_000)
    expect(result.readyToAssign).toBe(200_000 - 5_000)
  })

  it('un depassement couvert plus tard ne compte qu une fois', () => {
    const result = computeBudget(
      base({
        month: '2026-04',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: -8_000 },
        ],
        assignments: [
          { categoryId: FOOD.id, month: '2026-02', amount: 5_000 },
          { categoryId: FOOD.id, month: '2026-03', amount: 10_000 },
        ],
      }),
    )
    const food = cat(result, FOOD.id)
    // mars : 0 (rollover) + 10 000 - 0 = 10 000 -> avril : rollover 10 000
    expect(food.available).toBe(10_000)
    // un seul overspending historique (fevrier, 3 000)
    expect(result.readyToAssign).toBe(200_000 - 15_000 - 3_000)
  })
})

describe('Ready to Assign', () => {
  it('cumule les inflows de la categorie revenus jusqu au mois cible', () => {
    const result = computeBudget(
      base({
        month: '2026-03',
        transactions: [salary('2026-02'), salary('2026-03'), salary('2026-04')],
      }),
    )
    // le salaire d'avril (mois futur) ne compte pas encore
    expect(result.readyToAssign).toBe(400_000)
  })

  it('peut etre negatif si on assigne plus que les revenus', () => {
    const result = computeBudget(
      base({
        month: '2026-02',
        transactions: [salary('2026-02', 100_000)],
        assignments: [{ categoryId: RENT.id, month: '2026-02', amount: 150_000 }],
      }),
    )
    expect(result.readyToAssign).toBe(-50_000)
  })

  it('deduit les assignations sur les mois futurs du RTA courant', () => {
    const result = computeBudget(
      base({
        month: '2026-02',
        transactions: [salary('2026-02')],
        assignments: [
          { categoryId: FOOD.id, month: '2026-02', amount: 30_000 },
          { categoryId: FOOD.id, month: '2026-05', amount: 25_000 },
        ],
      }),
    )
    expect(result.readyToAssign).toBe(200_000 - 30_000 - 25_000)
    // et l'assignation future n'apparait pas dans l'enveloppe du mois courant
    expect(cat(result, FOOD.id).assigned).toBe(30_000)
  })

  it('un mois vide ne change rien : memes soldes, RTA stable', () => {
    const input = base({
      month: '2026-02',
      transactions: [
        salary('2026-02'),
        { id: 't1', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: -10_000 },
      ],
      assignments: [{ categoryId: FOOD.id, month: '2026-02', amount: 30_000 }],
    })
    const feb = computeBudget(input)
    const may = computeBudget({ ...input, month: '2026-05' })
    expect(cat(may, FOOD.id).available).toBe(cat(feb, FOOD.id).available)
    expect(may.readyToAssign).toBe(feb.readyToAssign)
  })
})

describe('remboursements et assignation retroactive', () => {
  it('un remboursement augmente le disponible sans toucher au RTA', () => {
    const result = computeBudget(
      base({
        month: '2026-02',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: -8_000 },
          { id: 't2', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: 3_000 },
        ],
        assignments: [{ categoryId: FOOD.id, month: '2026-02', amount: 5_000 }],
      }),
    )
    const food = cat(result, FOOD.id)
    expect(food.activity).toBe(-5_000)
    expect(food.available).toBe(0)
    // le remboursement n'est PAS un revenu : le RTA ne bouge pas
    expect(result.readyToAssign).toBe(200_000 - 5_000)
  })

  it('un remboursement net positif se reporte via le rollover', () => {
    const result = computeBudget(
      base({
        month: '2026-03',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: -2_000 },
          { id: 't2', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: 5_000 },
        ],
      }),
    )
    const food = cat(result, FOOD.id)
    expect(food.rollover).toBe(3_000)
    expect(food.available).toBe(3_000)
    expect(result.readyToAssign).toBe(200_000)
  })

  it("couvrir un depassement en reassignant le mois MEME annule l'overspending", () => {
    const result = computeBudget(
      base({
        month: '2026-03',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-02', amount: -8_000 },
        ],
        // l'assignation de fevrier a ete portee apres coup a 8 000
        assignments: [{ categoryId: FOOD.id, month: '2026-02', amount: 8_000 }],
      }),
    )
    expect(cat(result, FOOD.id).available).toBe(0)
    // plus aucune deduction d'overspending : le depassement est couvert
    expect(result.readyToAssign).toBe(200_000 - 8_000)
  })

  it('un revenu negatif (remboursement de salaire) reduit le RTA', () => {
    const result = computeBudget(
      base({
        month: '2026-02',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: INCOME.id, month: '2026-02', amount: -50_000 },
        ],
      }),
    )
    expect(result.readyToAssign).toBe(150_000)
  })
})

describe('cas limites', () => {
  it('mois cible anterieur a toutes les donnees : enveloppes vides, assignations comptees en futur', () => {
    const result = computeBudget(
      base({
        month: '2026-01',
        transactions: [salary('2026-02')],
        assignments: [{ categoryId: FOOD.id, month: '2026-02', amount: 30_000 }],
      }),
    )
    expect(cat(result, FOOD.id)).toEqual({
      categoryId: FOOD.id,
      rollover: 0,
      assigned: 0,
      activity: 0,
      available: 0,
    })
    // aucun inflow en janvier, l'assignation de fevrier decompte deja le RTA
    expect(result.readyToAssign).toBe(-30_000)
  })

  it('un categoryId inconnu est ignore silencieusement (transaction et assignation)', () => {
    const result = computeBudget(
      base({
        month: '2026-02',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: 'cat-deleted', month: '2026-02', amount: -9_000 },
        ],
        assignments: [{ categoryId: 'cat-deleted', month: '2026-02', amount: 4_000 }],
      }),
    )
    expect(result.totals.activity).toBe(0)
    expect(result.totals.assigned).toBe(0)
    expect(result.readyToAssign).toBe(200_000)
  })
})

describe('transferts et comptes hors budget', () => {
  it('un transfert lie est neutre pour activity et RTA', () => {
    const withTransfer = base({
      month: '2026-02',
      transactions: [
        salary('2026-02'),
        { id: 'out', accountId: CHECKING.id, categoryId: null, month: '2026-02', amount: -20_000, transferGroupId: 'tr-1' },
        { id: 'in', accountId: SAVINGS.id, categoryId: null, month: '2026-02', amount: 20_000, transferGroupId: 'tr-1' },
      ],
    })
    const result = computeBudget(withTransfer)
    expect(result.totals.activity).toBe(0)
    expect(result.readyToAssign).toBe(200_000)
  })

  it('les transactions des comptes tracking sont exclues (depenses ET revenus)', () => {
    const result = computeBudget(
      base({
        month: '2026-02',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: PEA.id, categoryId: FOOD.id, month: '2026-02', amount: -50_000 },
          { id: 't2', accountId: PEA.id, categoryId: INCOME.id, month: '2026-02', amount: 90_000 },
        ],
      }),
    )
    expect(cat(result, FOOD.id).activity).toBe(0)
    expect(result.readyToAssign).toBe(200_000)
  })

  it('une transaction a categoriser est ignoree par les enveloppes et le RTA', () => {
    const result = computeBudget(
      base({
        month: '2026-02',
        transactions: [
          salary('2026-02'),
          { id: 't1', accountId: CHECKING.id, categoryId: null, month: '2026-02', amount: -7_000 },
        ],
      }),
    )
    expect(result.totals.activity).toBe(0)
    expect(result.readyToAssign).toBe(200_000)
  })
})

describe('nouveau budget (startMonth)', () => {
  const history = [
    salary('2026-01', 300_000),
    { id: 'tx-food-01', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-01', amount: -50_000 },
    // non categorisee : hors moteur normalement, mais elle a fait le solde du compte
    { id: 'tx-uncat-01', accountId: CHECKING.id, categoryId: null, month: '2026-01', amount: -20_000 },
    // transfert vers le PEA (hors budget) : l'argent a quitte les comptes budget
    { id: 'tx-tr-a', accountId: CHECKING.id, categoryId: null, month: '2026-02', amount: -30_000, transferGroupId: 'g1' },
    { id: 'tx-tr-b', accountId: PEA.id, categoryId: null, month: '2026-02', amount: 30_000, transferGroupId: 'g1' },
    // le PEA lui-meme ne compte jamais
    { id: 'tx-pea', accountId: PEA.id, categoryId: null, month: '2026-02', amount: 1_000_000 },
  ]
  const oldAssignments = [
    { categoryId: FOOD.id, month: '2026-01', amount: 40_000 },
    { categoryId: RENT.id, month: '2026-02', amount: 90_000 },
  ]

  it('le RTA du mois de depart vaut le solde brut des comptes budget au 1er du mois', () => {
    const r = computeBudget(
      base({ month: '2026-03', startMonth: '2026-03', transactions: history, assignments: oldAssignments }),
    )
    // 300 000 - 50 000 - 20 000 - 30 000 = 200 000 ; assignations passees ignorees
    expect(r.readyToAssign).toBe(200_000)
    expect(cat(r, FOOD.id)).toMatchObject({ rollover: 0, assigned: 0, activity: 0, available: 0 })
    expect(cat(r, RENT.id).available).toBe(0)
  })

  it('l identite comptes budget = RTA + disponibles tient apres le depart', () => {
    const txs = [
      ...history,
      salary('2026-03', 200_000),
      { id: 'tx-food-03', accountId: CHECKING.id, categoryId: FOOD.id, month: '2026-03', amount: -30_000 },
    ]
    const r = computeBudget(
      base({
        month: '2026-03',
        startMonth: '2026-03',
        transactions: txs,
        assignments: [...oldAssignments, { categoryId: FOOD.id, month: '2026-03', amount: 50_000 }],
      }),
    )
    // solde des comptes budget : 200 000 + 200 000 - 30 000 = 370 000
    expect(r.readyToAssign).toBe(200_000 + 200_000 - 50_000)
    expect(cat(r, FOOD.id).available).toBe(20_000)
    expect(r.readyToAssign + r.totals.available).toBe(370_000)
  })

  it('un mois anterieur au depart est vide', () => {
    const r = computeBudget(
      base({ month: '2026-02', startMonth: '2026-03', transactions: history, assignments: oldAssignments }),
    )
    expect(r.readyToAssign).toBe(0)
    expect(r.categories.every((c) => c.available === 0 && c.assigned === 0)).toBe(true)
  })

  it('sans startMonth le comportement historique est inchange', () => {
    const a = computeBudget(base({ month: '2026-03', transactions: history, assignments: oldAssignments }))
    const b = computeBudget(
      base({ month: '2026-03', startMonth: null, transactions: history, assignments: oldAssignments }),
    )
    expect(b).toEqual(a)
  })

  it('rejette un mois de depart mal forme', () => {
    expect(() => computeBudget(base({ month: '2026-03', startMonth: '2026-3' }))).toThrow()
  })
})

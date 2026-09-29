// Mode demonstration : Edge Function sync-bank factice (Enable Banking), en
// memoire. Memes actions et formes de reponse que supabase/functions/sync-bank :
// liste des banques, consentement (URL inoffensive), synchronisation (quelques
// transactions du jour importees une fois, categorisees par les regles puis
// la memoire de tiers), reconciliation (soldes deja exacts).

import { ApiError } from '@/lib/api'
import { today } from '@/lib/format'
import { payeeKey } from '../../../../packages/crypto/src/payee'
import { addDays, ddmm, jsonClone, randomUuid, type DemoDb, type DemoTransaction } from './db'
import { matchLabel, payeeDefaults } from './logic'
import { demoDb, simulateCall } from './state'

type Params = Record<string, unknown>

// Banques proposees au consentement (noms inventes, tries comme le serveur).
const ASPSPS = [
  'Banque Régionale',
  'Caisse Mutuelle',
  'Crédit du Centre',
  'Ma Banque',
  'Néobanque Express',
  'Société Financière du Sud',
]
  .sort((a, b) => a.localeCompare(b))
  .map((name) => ({ name, country: 'FR', logo: null }))

let syncCount = 0

// Categorisation a l'import (sync-bank) : regles d'abord, puis memoire de
// tiers ; comptes budget uniquement, categories connues hors revenus.
function categorizeImport(db: DemoDb, tx: DemoTransaction): void {
  const account = db.accounts.find((a) => a.id === tx.accountId)
  if (!account?.onBudget) return
  const known = new Set(db.categories.filter((c) => !c.isIncome).map((c) => c.id))
  const rules = db.rules.slice().sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))
  const rule = rules.find((r) => matchLabel(tx.label, r.matcher))
  const categoryId = rule?.categoryId ?? payeeDefaults(db).get(payeeKey(tx.label)) ?? null
  if (categoryId && known.has(categoryId)) tx.categoryId = categoryId
}

function sync(db: DemoDb, params: Params) {
  const connectionId = typeof params.connectionId === 'string' && params.connectionId ? params.connectionId : null
  // Comptes lies (un compte clos n'est plus synchronise).
  const linked = db.accounts.filter(
    (a) => a.providerAccountUid && !a.closed && (!connectionId || a.connectionId === connectionId),
  )
  let imported = 0
  if (linked.length > 0 && syncCount === 0) {
    // Premier run de la session : deux paiements carte d'hier arrivent.
    const date = today()
    const purchase = ddmm(addDays(date, -1))
    const fresh: { label: string; amount: number; kind: 'checking' | 'card_deferred' }[] = [
      { label: `CB CARREFOUR MARKET ${purchase}`, amount: -4_127, kind: 'checking' },
      { label: `CB FNAC ${purchase}`, amount: -2_499, kind: 'card_deferred' },
    ]
    for (const f of fresh) {
      const account = linked.find((a) => a.kind === f.kind) ?? linked[0]
      const tx: DemoTransaction = {
        id: randomUuid(),
        accountId: account.id,
        categoryId: null,
        bookingDate: date,
        bookingMonth: date.slice(0, 7),
        amount: f.amount,
        label: f.label,
        counterparty: null,
        transferGroupId: null,
        notes: null,
        txHash: `demo-sync-${randomUuid()}`,
      }
      categorizeImport(db, tx)
      db.transactions.push(tx)
      imported += 1
    }
  }
  if (linked.length > 0) syncCount += 1
  db.syncLogs.push({
    id: randomUuid(),
    runAt: new Date().toISOString(),
    status: 'ok',
    importedCount: imported,
    error: null,
    connectionId: connectionId ?? db.bankConnections[0]?.id ?? null,
  })
  const result: Record<string, unknown> = { imported, linked: linked.length, transfersLinked: 0, errors: [] }
  // Import d'historique : la reconciliation des soldes est enchainee cote serveur.
  if (typeof params.sinceDays === 'number') result.adjusted = []
  return result
}

function handle(db: DemoDb, action: string, p: Params): unknown {
  let result: unknown
  switch (action) {
    case 'listAspsps':
      result = { aspsps: ASPSPS }
      break
    case 'startAuth': {
      const redirectUrl = typeof p.redirectUrl === 'string' ? p.redirectUrl.trim() : ''
      if (!redirectUrl) throw new ApiError(400, 'redirectUrl manquante')
      const aspspName = typeof p.aspspName === 'string' ? p.aspspName.trim() : ''
      if (!aspspName) throw new ApiError(400, 'nom ASPSP manquant (ENABLE_BANKING_ASPSP_NAME)')
      // Aucune banque reelle : le « consentement » ramene simplement aux reglages.
      result = { url: '#/reglages' }
      break
    }
    case 'finalizeAuth': {
      const code = typeof p.code === 'string' ? p.code.trim() : ''
      if (!code) throw new ApiError(400, 'code d autorisation manquant')
      // Re-consentement : la connexion existante est prolongee de 90 jours.
      const validUntil = new Date(Date.now() + 90 * 86_400_000).toISOString()
      let connection = db.bankConnections[0]
      if (connection) {
        connection.validUntil = validUntil
        connection.sessionState = 'active'
      } else {
        connection = { id: randomUuid(), institution: 'Ma Banque', validUntil, sessionState: 'active', accounts: [] }
        db.bankConnections.push(connection)
      }
      result = { ok: true, connectionId: connection.id }
      break
    }
    case 'sync':
      result = sync(db, p)
      break
    case 'reconcile':
      result = { adjusted: [] }
      break
    default:
      throw new ApiError(400, 'action inconnue')
  }
  return result
}

/** Remplace l'appel a l'Edge Function sync-bank en mode demonstration (cf. lib/bank.ts). */
export async function demoSyncBankCall<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const p = jsonClone(params ?? {})
  return simulateCall(action, () => jsonClone(handle(demoDb(), action, p)) as T)
}

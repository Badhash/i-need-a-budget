// Mode demonstration : Edge Function sync-bank factice (Enable Banking), en
// memoire. Memes actions et formes de reponse que supabase/functions/sync-bank :
// liste des banques, consentement (aller-retour simule par un rechargement de
// la page), synchronisation (quelques transactions du jour importees une fois,
// categorisees par les regles puis la memoire de tiers), reconciliation
// (soldes deja exacts).

import { ApiError } from '@/lib/api'
import { today } from '@/lib/format'
import { addDays, ddmm, jsonClone, randomUuid, type DemoDb, type DemoTransaction } from './db'
import { applyConsent, autoCategorizer } from './logic'
import { consentReturnUrl, demoDb, simulateCall } from './state'

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

function sync(db: DemoDb, params: Params) {
  const connectionId = typeof params.connectionId === 'string' && params.connectionId ? params.connectionId : null
  // Comptes lies (un compte clos n'est plus synchronise).
  const linked = db.accounts.filter(
    (a) => a.providerAccountUid && !a.closed && (!connectionId || a.connectionId === connectionId),
  )
  let imported = 0
  if (linked.length > 0) {
    // Deux paiements carte d'hier arrivent. Dedoublonnage par empreinte, comme
    // tx_hash cote serveur : un run suivant (ou apres un retour de
    // consentement) ne les importe pas une seconde fois.
    const date = today()
    const purchase = ddmm(addDays(date, -1))
    const fresh: { label: string; amount: number; kind: 'checking' | 'card_deferred' }[] = [
      { label: `CB CARREFOUR MARKET ${purchase}`, amount: -4_127, kind: 'checking' },
      { label: `CB FNAC ${purchase}`, amount: -2_499, kind: 'card_deferred' },
    ]
    // Categorisation a l'import : regles d'abord, puis memoire de tiers.
    const categorize = autoCategorizer(db)
    for (const f of fresh) {
      const account = linked.find((a) => a.kind === f.kind) ?? linked[0]
      const txHash = `demo-sync:${account.id}:${date}:${f.amount}:${f.label}`
      if (db.transactions.some((t) => t.txHash === txHash)) continue
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
        txHash,
      }
      tx.categoryId = categorize(tx)
      db.transactions.push(tx)
      imported += 1
    }
  }
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
      // Aucune banque reelle : « retour de la banque » immediat, consentement
      // accorde pour aspspName (vrai rechargement, retour sur les reglages).
      result = { url: consentReturnUrl(aspspName) }
      break
    }
    case 'finalizeAuth': {
      const code = typeof p.code === 'string' ? p.code.trim() : ''
      if (!code) throw new ApiError(400, 'code d autorisation manquant')
      // Le code ne porte pas la banque : re-consentement de la premiere connexion.
      const connectionId = applyConsent(db, db.bankConnections[0]?.institution ?? 'Ma Banque')
      result = { ok: true, connectionId }
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

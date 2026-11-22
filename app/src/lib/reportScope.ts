// Perimetre des rapports cote front : calcul memoise (un seul par version des
// transactions et de la taxonomie, partage par la page Rapports et le detail
// d'une transaction), mutation optimiste du reglage (bootstrap.reportSettings)
// et bascule « compter / ecarter » d'une operation.

import { useMemo } from 'react'
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { Transaction } from '@/types/domain'
import {
  apiSetReportSettings,
  BOOTSTRAP_KEY,
  EMPTY_REPORT_SETTINGS,
  useBootstrap,
  useServerFeatures,
  useTransactions,
  type Bootstrap,
  type ReportOverride,
  type ReportSettings,
} from '@/lib/data'
import { SERVER_FEATURES } from '@/lib/features'
import { buildReportScope, taxonomyFrom } from '@/lib/analytics'
import type { ReportScope, ScopeItem } from '@/lib/exceptional'
import { enqueue, isTempId, resolveId } from '@/lib/mutationQueue'
import { pauseReads } from '@/lib/pauseReads'

// Cache module : la detection parcourt tout l'historique (quelques dizaines de
// ms sur des milliers d'operations), on ne la refait que si les transactions
// ou le bootstrap changent de reference.
const cache = new WeakMap<Transaction[], { boot: Bootstrap; crossBudget: boolean; scope: ReportScope }>()

function scopeOf(txs: Transaction[], boot: Bootstrap, crossBudget: boolean): ReportScope {
  const hit = cache.get(txs)
  if (hit && hit.boot === boot && hit.crossBudget === crossBudget) return hit.scope
  const settings = boot.features.includes(SERVER_FEATURES.reportSettings) ? boot.reportSettings : EMPTY_REPORT_SETTINGS
  const scope = buildReportScope(txs, taxonomyFrom(boot), { crossBudget, settings })
  cache.set(txs, { boot, crossBudget, scope })
  return scope
}

export interface ReportScopeState {
  /** null tant que transactions et bootstrap ne sont pas charges. */
  scope: ReportScope | null
  settings: ReportSettings
  /** Le serveur deploye enregistre les choix (reportSettings) : sinon, detection seule. */
  editable: boolean
}

export function useReportScope(): ReportScopeState {
  const txs = useTransactions().data
  const boot = useBootstrap().data
  const features = useServerFeatures()
  const crossBudget = features.has(SERVER_FEATURES.crossBudgetTransfers)
  const editable = features.has(SERVER_FEATURES.reportSettings)
  const scope = useMemo(() => (txs && boot ? scopeOf(txs, boot, crossBudget) : null), [txs, boot, crossBudget])
  return { scope, settings: editable && boot ? boot.reportSettings : EMPTY_REPORT_SETTINGS, editable }
}

/** Element du perimetre pour une transaction (detectee ou ecartee a la main), sinon null. */
export function scopeItemOf(scope: ReportScope | null, txId: string): ScopeItem | null {
  return scope?.items.find((i) => i.tx.id === txId) ?? null
}

export interface ReportSettingsPatch {
  /** Liste COMPLETE des categories hors depenses. */
  excludedCategories?: string[]
  overrides?: { transactionId: string; flag: ReportOverride | null }[]
}

function applyPatch(settings: ReportSettings, patch: ReportSettingsPatch): ReportSettings {
  const overrides = { ...settings.overrides }
  for (const { transactionId, flag } of patch.overrides ?? []) {
    if (flag === null) delete overrides[transactionId]
    else overrides[transactionId] = flag
  }
  return { excludedCategories: patch.excludedCategories ?? settings.excludedCategories, overrides }
}

function patchCache(queryClient: QueryClient, update: (s: ReportSettings) => ReportSettings): void {
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => (old ? { ...old, reportSettings: update(old.reportSettings) } : old))
}

interface PatchContext {
  previous: ReportSettings | null
}

/**
 * Modifie le perimetre des rapports. Optimiste sur bootstrap.reportSettings :
 * les rapports se recalculent aussitot ; rollback discret en cas d'echec.
 * Serialise dans la file (une transaction tout juste creee a un id temporaire,
 * resolu a l'envoi).
 */
export function useSetReportSettings(): UseMutationResult<unknown, Error, ReportSettingsPatch, PatchContext> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: ReportSettingsPatch) => {
      const deps = (patch.overrides ?? []).map((o) => o.transactionId).filter(isTempId)
      return enqueue(
        () =>
          apiSetReportSettings({
            excludedCategories: patch.excludedCategories?.map(resolveId),
            overrides: patch.overrides?.map((o) => ({ ...o, transactionId: resolveId(o.transactionId) })),
          }),
        { deps },
      )
    },
    onMutate: async (patch) => {
      await pauseReads(queryClient, BOOTSTRAP_KEY)
      const previous = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)?.reportSettings ?? null
      patchCache(queryClient, (s) => applyPatch(s, patch))
      return { previous }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) patchCache(queryClient, () => ctx.previous!)
    },
  })
}

/**
 * Choix a poser pour qu'une operation soit comptee (`count`) ou ecartee. Une
 * detection automatique se contredit par 'include' et se retablit en
 * retirant le choix ; une operation ordinaire s'ecarte par 'exclude'. Un
 * virement interne bascule ses deux moities ensemble.
 */
export function scopeToggle(
  tx: Transaction,
  item: ScopeItem | null,
  count: boolean,
): { transactionId: string; flag: ReportOverride | null }[] {
  const auto = item !== null && item.reason !== 'manual'
  const flag: ReportOverride | null = auto ? (count ? 'include' : null) : count ? null : 'exclude'
  const ids = [tx.id, ...(item?.reason === 'internal' && item.partner ? [item.partner.id] : [])]
  return ids.map((transactionId) => ({ transactionId, flag }))
}


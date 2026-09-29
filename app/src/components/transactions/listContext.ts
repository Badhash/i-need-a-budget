import { createContext, useContext } from 'react'
import type { TxRow } from './txRow'

/**
 * Actions de la page partagees par les lignes (liste mobile, tableau desktop,
 * feuille de detail). Contexte plutot que props : les cellules du tableau
 * desktop sont definies au niveau module.
 */
export interface TxListActions {
  /** Categorise une ligne a la main (optimiste) avec son toast « Annuler » et ses suites. */
  categorizeRow: (row: TxRow, categoryId: string | null) => void
  /** Ouvre le detail d'une ligne. */
  openDetail: (row: TxRow) => void
  /** Ouvre la creation d'une regle pre-remplie. */
  openCreateRule: (value: string, categoryId?: string) => void
  /** Filtre compte actif : le compte de chaque ligne est alors implicite. */
  singleAccount: boolean
}

export const TxListContext = createContext<TxListActions>({
  categorizeRow: () => {},
  openDetail: () => {},
  openCreateRule: () => {},
  singleAccount: false,
})

export function useTxList(): TxListActions {
  return useContext(TxListContext)
}

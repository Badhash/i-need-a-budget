import { useQuery } from '@tanstack/react-query'
import {
  apiGetAccounts,
  apiGetBudgetMonth,
  apiGetReports,
  apiGetTransactions,
} from '@/mocks/api'

export function useBudgetMonth(month: string) {
  return useQuery({
    queryKey: ['budget', month],
    queryFn: () => apiGetBudgetMonth(month),
  })
}

export function useTransactions() {
  return useQuery({
    queryKey: ['transactions'],
    queryFn: apiGetTransactions,
  })
}

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: apiGetAccounts,
  })
}

export function useReports(month: string) {
  return useQuery({
    queryKey: ['reports', month],
    queryFn: () => apiGetReports(month),
  })
}

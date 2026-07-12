// Point d'entree historique des hooks de lecture. L'implementation reelle vit
// dans @/lib/data (couche /api). Ce module reste pour conserver les chemins
// d'import existants des pages.

export { useBudgetMonth, useTransactions, useAccounts, useReports } from '@/lib/data'
